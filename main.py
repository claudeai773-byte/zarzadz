"""
Serwer FastAPI dla Systemu Zarządzania Produkcją v4.0
Deploy na Railway.app
"""

from fastapi import FastAPI, HTTPException, Header, Depends, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Any, Optional
import sqlite3, os, json, hashlib, time, io
from contextlib import contextmanager

# ─── Konfiguracja ──────────────────────────────────────────────────────────────
DB_PATH  = os.environ.get("DB_PATH",  "/data/produkcja.db")
API_KEY  = os.environ.get("API_KEY",  "zmien-mnie-na-bezpieczny-klucz")
PORT     = int(os.environ.get("PORT", 8000))

if not os.path.exists(os.path.dirname(DB_PATH)):
    DB_PATH = os.path.join(os.path.dirname(__file__), "produkcja.db")

app = FastAPI(title="Produkcja API", version="4.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Auth ──────────────────────────────────────────────────────────────────────
def verify_key(x_api_key: str = Header(..., alias="x-api-key")):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Nieprawidłowy klucz API")
    return True

# ─── Database helpers ──────────────────────────────────────────────────────────
@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def _hash(p): return hashlib.sha256(p.encode()).hexdigest()

# ─── SQL Proxy ────────────────────────────────────────────────────────────────
class SQLRequest(BaseModel):
    sql: str
    params: List[Any] = []
    write: bool = False
    many: bool = False
    params_list: List[List[Any]] = []

class TransactionRequest(BaseModel):
    operations: List[dict]

@app.post("/sql", dependencies=[Depends(verify_key)])
def execute_sql(req: SQLRequest):
    try:
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        cur = conn.cursor()
        if req.many and req.params_list:
            cur.executemany(req.sql, req.params_list)
            conn.commit()
            conn.close()
            return {"rowcount": cur.rowcount, "lastrowid": cur.lastrowid}
        cur.execute(req.sql, req.params)
        is_read = req.sql.strip().upper().startswith(("SELECT", "PRAGMA", "WITH"))
        if is_read:
            rows = cur.fetchall()
            conn.close()
            return {"rows": [list(r) for r in rows]}
        else:
            conn.commit()
            lastrowid = cur.lastrowid
            rowcount  = cur.rowcount
            conn.close()
            return {"lastrowid": lastrowid, "rowcount": rowcount}
    except sqlite3.Error as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/transaction", dependencies=[Depends(verify_key)])
def execute_transaction(req: TransactionRequest):
    try:
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        results = []
        for op in req.operations:
            cur = conn.cursor()
            cur.execute(op["sql"], op.get("params", []))
            results.append({"lastrowid": cur.lastrowid, "rowcount": cur.rowcount})
        conn.commit()
        conn.close()
        return {"results": results}
    except sqlite3.Error as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── REST API ─────────────────────────────────────────────────────────────────

# Auth
class LoginRequest(BaseModel):
    username: str
    password: str

@app.post("/api/login")
def login(req: LoginRequest):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, username, full_name, role FROM users WHERE username=? AND password=?",
            (req.username, _hash(req.password))
        ).fetchone()
    if not row:
        raise HTTPException(401, "Nieprawidłowy login lub hasło")
    return {"id": row[0], "username": row[1], "full_name": row[2], "role": row[3]}


# ─── QR Code scan ─────────────────────────────────────────────────────────────
@app.get("/api/scan/{qr}", dependencies=[Depends(verify_key)])
def scan_qr(qr: str):
    """Szuka operacji lub zlecenia po QR kodzie"""
    with get_db() as conn:
        # szukaj operacji
        op = conn.execute("""
            SELECT o.*, z.numer as zl_numer, z.nazwa as zl_nazwa, z.ilosc_sztuk
            FROM operacje o
            JOIN zlecenia z ON o.zlecenie_id = z.id
            WHERE o.qr_code=?
        """, (qr,)).fetchone()
        if op:
            return {"type": "operacja", "data": dict(op)}

        # szukaj zlecenia
        zl = conn.execute("SELECT * FROM zlecenia WHERE qr_code=?", (qr,)).fetchone()
        if zl:
            ops = conn.execute(
                "SELECT * FROM operacje WHERE zlecenie_id=? ORDER BY kolejnosc", (zl["id"],)
            ).fetchall()
            return {"type": "zlecenie", "data": dict(zl), "operacje": [dict(o) for o in ops]}

    raise HTTPException(404, "Nie znaleziono kodu QR: " + qr)


# ─── Zlecenia CRUD ────────────────────────────────────────────────────────────
@app.get("/api/zlecenia")
def get_zlecenia(status: Optional[str] = None, _=Depends(verify_key)):
    with get_db() as conn:
        if status:
            rows = conn.execute(
                "SELECT * FROM zlecenia WHERE status=? ORDER BY created_at DESC", (status,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM zlecenia ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]

class ZlecenieRequest(BaseModel):
    numer: str
    nazwa: str
    opis: Optional[str] = ""
    status: Optional[str] = "nowe"
    termin: Optional[str] = None
    ilosc_sztuk: Optional[int] = 1
    cena_brutto_szt: Optional[float] = 0
    material_od_klienta: Optional[int] = 0

@app.post("/api/zlecenia", dependencies=[Depends(verify_key)])
def create_zlecenie(req: ZlecenieRequest):
    import uuid
    qr = "ZL-" + str(uuid.uuid4())[:8].upper()
    with get_db() as conn:
        try:
            cur = conn.execute(
                """INSERT INTO zlecenia (numer,nazwa,opis,status,termin,ilosc_sztuk,
                   cena_brutto_szt,material_od_klienta,qr_code)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (req.numer, req.nazwa, req.opis, req.status, req.termin,
                 req.ilosc_sztuk, req.cena_brutto_szt, req.material_od_klienta, qr)
            )
            return {"id": cur.lastrowid, "qr_code": qr}
        except sqlite3.IntegrityError:
            raise HTTPException(400, "Zlecenie o tym numerze już istnieje")

@app.put("/api/zlecenia/{zid}", dependencies=[Depends(verify_key)])
def update_zlecenie(zid: int, req: ZlecenieRequest):
    with get_db() as conn:
        conn.execute(
            """UPDATE zlecenia SET numer=?,nazwa=?,opis=?,status=?,termin=?,
               ilosc_sztuk=?,cena_brutto_szt=?,material_od_klienta=? WHERE id=?""",
            (req.numer, req.nazwa, req.opis, req.status, req.termin,
             req.ilosc_sztuk, req.cena_brutto_szt, req.material_od_klienta, zid)
        )
    return {"ok": True}

@app.delete("/api/zlecenia/{zid}", dependencies=[Depends(verify_key)])
def delete_zlecenie(zid: int):
    with get_db() as conn:
        conn.execute("DELETE FROM operacje WHERE zlecenie_id=?", (zid,))
        conn.execute("DELETE FROM zlecenia WHERE id=?", (zid,))
    return {"ok": True}

@app.patch("/api/zlecenia/{zid}/status", dependencies=[Depends(verify_key)])
def change_zlecenie_status(zid: int, body: dict):
    status = body.get("status")
    if status not in ("nowe","w_toku","zakonczone","anulowane"):
        raise HTTPException(400, "Nieprawidłowy status")
    with get_db() as conn:
        conn.execute("UPDATE zlecenia SET status=? WHERE id=?", (status, zid))
    return {"ok": True}


# ─── Operacje CRUD ────────────────────────────────────────────────────────────
@app.get("/api/zlecenia/{zid}/operacje", dependencies=[Depends(verify_key)])
def get_operacje(zid: int):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM operacje WHERE zlecenie_id=? ORDER BY kolejnosc", (zid,)
        ).fetchall()
    return [dict(r) for r in rows]

class OperacjaRequest(BaseModel):
    zlecenie_id: int
    nazwa: str
    kolejnosc: Optional[int] = 0
    czas_norma: Optional[float] = 0
    stanowisko: Optional[str] = ""
    opis_czynnosci: Optional[str] = ""

@app.post("/api/operacje", dependencies=[Depends(verify_key)])
def create_operacja(req: OperacjaRequest):
    import uuid
    qr = "OP-" + str(uuid.uuid4())[:8].upper()
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO operacje (zlecenie_id,nazwa,kolejnosc,czas_norma,
               stanowisko,opis_czynnosci,qr_code)
               VALUES (?,?,?,?,?,?,?)""",
            (req.zlecenie_id, req.nazwa, req.kolejnosc, req.czas_norma,
             req.stanowisko, req.opis_czynnosci, qr)
        )
        return {"id": cur.lastrowid, "qr_code": qr}

@app.put("/api/operacje/{oid}", dependencies=[Depends(verify_key)])
def update_operacja(oid: int, req: OperacjaRequest):
    with get_db() as conn:
        conn.execute(
            """UPDATE operacje SET nazwa=?,kolejnosc=?,czas_norma=?,
               stanowisko=?,opis_czynnosci=? WHERE id=?""",
            (req.nazwa, req.kolejnosc, req.czas_norma,
             req.stanowisko, req.opis_czynnosci, oid)
        )
    return {"ok": True}

@app.delete("/api/operacje/{oid}", dependencies=[Depends(verify_key)])
def delete_operacja(oid: int):
    with get_db() as conn:
        conn.execute("DELETE FROM operacje WHERE id=?", (oid,))
    return {"ok": True}

@app.get("/api/operacje/aktywne", dependencies=[Depends(verify_key)])
def get_aktywne_operacje():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT o.*, z.numer as zl_numer, z.nazwa as zl_nazwa, z.ilosc_sztuk
            FROM operacje o
            JOIN zlecenia z ON o.zlecenie_id = z.id
            WHERE o.status IN ('oczekuje','w_toku')
              AND z.status IN ('nowe','w_toku')
            ORDER BY z.numer, o.kolejnosc
        """).fetchall()
    return [dict(r) for r in rows]

@app.get("/api/operacje/zakonczone-do-transportu", dependencies=[Depends(verify_key)])
def get_zakonczone_transport():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT o.*, z.numer as zl_numer, z.nazwa as zl_nazwa, z.ilosc_sztuk
            FROM operacje o
            JOIN zlecenia z ON o.zlecenie_id = z.id
            WHERE o.status = 'zakonczona'
              AND z.status IN ('nowe','w_toku')
            ORDER BY z.numer, o.kolejnosc
        """).fetchall()
    return [dict(r) for r in rows]


# ─── Sesje pracy (z pauzami + równoległe + praca nieprodukcyjna) ──────────────
class StartSesjaRequest(BaseModel):
    operacja_id: Optional[int] = None
    user_id: int
    typ: str = "operacja"   # operacja | nieprodukcyjna
    opis_nieprodukcyjnej: Optional[str] = ""

class StopSesjaRequest(BaseModel):
    sesja_id: int
    ilosc_sztuk: int
    uwagi: Optional[str] = ""

class PauzaRequest(BaseModel):
    sesja_id: int
    powod: Optional[str] = ""

@app.post("/api/sesje/start", dependencies=[Depends(verify_key)])
def start_sesja(req: StartSesjaRequest):
    import datetime
    now = datetime.datetime.now().isoformat()
    with get_db() as conn:
        # Dla pracy nieprodukcyjnej pozwalamy na równoległe sesje
        if req.typ == "operacja" and req.operacja_id:
            # sprawdź czy ta konkretna operacja nie jest już aktywna przez tego usera
            existing = conn.execute(
                "SELECT id FROM sesje_pracy WHERE user_id=? AND operacja_id=? AND status='aktywna'",
                (req.user_id, req.operacja_id)
            ).fetchone()
            if existing:
                raise HTTPException(400, "Masz już aktywną sesję tej operacji.")

        cur = conn.execute(
            """INSERT INTO sesje_pracy (operacja_id, user_id, typ, start_time, status, uwagi)
               VALUES (?,?,?,?,?,?)""",
            (req.operacja_id, req.user_id, req.typ, now, "aktywna",
             req.opis_nieprodukcyjnej or "")
        )
        sesja_id = cur.lastrowid
        if req.operacja_id and req.typ == "operacja":
            conn.execute(
                "UPDATE operacje SET status='w_toku' WHERE id=? AND status='oczekuje'",
                (req.operacja_id,)
            )
    return {"sesja_id": sesja_id, "start_time": now}

@app.post("/api/sesje/pauza/start", dependencies=[Depends(verify_key)])
def pauza_start(req: PauzaRequest):
    import datetime
    now = datetime.datetime.now().isoformat()
    with get_db() as conn:
        sesja = conn.execute("SELECT * FROM sesje_pracy WHERE id=?", (req.sesja_id,)).fetchone()
        if not sesja:
            raise HTTPException(404, "Sesja nie znaleziona")
        pauzy = json.loads(sesja["pauzy"] or "[]")
        # sprawdź czy nie ma otwartej pauzy
        if pauzy and pauzy[-1].get("koniec") is None:
            raise HTTPException(400, "Pauza już aktywna")
        pauzy.append({"start": now, "koniec": None, "powod": req.powod or ""})
        conn.execute("UPDATE sesje_pracy SET pauzy=? WHERE id=?",
                     (json.dumps(pauzy), req.sesja_id))
    return {"ok": True, "pauza_start": now}

@app.post("/api/sesje/pauza/stop", dependencies=[Depends(verify_key)])
def pauza_stop(req: PauzaRequest):
    import datetime
    now = datetime.datetime.now().isoformat()
    with get_db() as conn:
        sesja = conn.execute("SELECT * FROM sesje_pracy WHERE id=?", (req.sesja_id,)).fetchone()
        if not sesja:
            raise HTTPException(404, "Sesja nie znaleziona")
        pauzy = json.loads(sesja["pauzy"] or "[]")
        if not pauzy or pauzy[-1].get("koniec") is not None:
            raise HTTPException(400, "Brak aktywnej pauzy")
        pauzy[-1]["koniec"] = now
        conn.execute("UPDATE sesje_pracy SET pauzy=? WHERE id=?",
                     (json.dumps(pauzy), req.sesja_id))
    return {"ok": True, "pauza_koniec": now}

@app.post("/api/sesje/stop", dependencies=[Depends(verify_key)])
def stop_sesja(req: StopSesjaRequest):
    import datetime
    now = datetime.datetime.now().isoformat()
    with get_db() as conn:
        sesja = conn.execute("SELECT * FROM sesje_pracy WHERE id=?", (req.sesja_id,)).fetchone()
        if not sesja:
            raise HTTPException(404, "Sesja nie znaleziona")

        # zamknij ewentualną otwartą pauzę
        pauzy = json.loads(sesja["pauzy"] or "[]")
        if pauzy and pauzy[-1].get("koniec") is None:
            pauzy[-1]["koniec"] = now

        conn.execute(
            "UPDATE sesje_pracy SET end_time=?, ilosc_sztuk=?, uwagi=?, status='zakonczona', pauzy=? WHERE id=?",
            (now, req.ilosc_sztuk, req.uwagi, json.dumps(pauzy), req.sesja_id)
        )
        if sesja["operacja_id"] and sesja["typ"] == "operacja":
            conn.execute(
                "UPDATE operacje SET ilosc_wykonana = ilosc_wykonana + ? WHERE id=?",
                (req.ilosc_sztuk, sesja["operacja_id"])
            )
            op = conn.execute(
                "SELECT o.ilosc_wykonana, z.ilosc_sztuk, o.zlecenie_id FROM operacje o JOIN zlecenia z ON o.zlecenie_id=z.id WHERE o.id=?",
                (sesja["operacja_id"],)
            ).fetchone()
            if op and op[0] >= op[1]:
                conn.execute("UPDATE operacje SET status='zakonczona' WHERE id=?", (sesja["operacja_id"],))
                # Sprawdź czy wszystkie operacje zlecenia są zakończone → auto-zakończ zlecenie
                zlecenie_id = op[2]
                pozostale = conn.execute(
                    "SELECT COUNT(*) FROM operacje WHERE zlecenie_id=? AND status NOT IN ('zakonczona','anulowane')",
                    (zlecenie_id,)
                ).fetchone()[0]
                if pozostale == 0:
                    conn.execute(
                        "UPDATE zlecenia SET status='zakonczone' WHERE id=? AND status NOT IN ('zakonczone','anulowane')",
                        (zlecenie_id,)
                    )

    return {"status": "ok", "end_time": now}

@app.get("/api/sesje/aktywne/{user_id}", dependencies=[Depends(verify_key)])
def get_aktywne_sesje(user_id: int):
    """Zwraca WSZYSTKIE aktywne sesje użytkownika (może być wiele)"""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT s.*, o.nazwa as op_nazwa, o.stanowisko,
                   z.numer as zl_numer, z.nazwa as zl_nazwa
            FROM sesje_pracy s
            LEFT JOIN operacje o ON s.operacja_id = o.id
            LEFT JOIN zlecenia z ON o.zlecenie_id = z.id
            WHERE s.user_id=? AND s.status='aktywna'
            ORDER BY s.start_time
        """, (user_id,)).fetchall()
    return [dict(r) for r in rows]

# backward compat
@app.get("/api/sesje/aktywna/{user_id}", dependencies=[Depends(verify_key)])
def get_aktywna_sesja(user_id: int):
    with get_db() as conn:
        row = conn.execute("""
            SELECT s.*, o.nazwa as op_nazwa, o.stanowisko,
                   z.numer as zl_numer, z.nazwa as zl_nazwa
            FROM sesje_pracy s
            LEFT JOIN operacje o ON s.operacja_id = o.id
            LEFT JOIN zlecenia z ON o.zlecenie_id = z.id
            WHERE s.user_id=? AND s.status='aktywna'
            ORDER BY s.start_time LIMIT 1
        """, (user_id,)).fetchone()
    return dict(row) if row else None

@app.get("/api/sesje/historia/{user_id}", dependencies=[Depends(verify_key)])
def get_historia(user_id: int, limit: int = 100):
    with get_db() as conn:
        rows = conn.execute("""
            SELECT s.*, o.nazwa as op_nazwa, o.stanowisko,
                   z.numer as zl_numer, z.nazwa as zl_nazwa
            FROM sesje_pracy s
            LEFT JOIN operacje o ON s.operacja_id = o.id
            LEFT JOIN zlecenia z ON o.zlecenie_id = z.id
            WHERE s.user_id=? AND s.status='zakonczona'
            ORDER BY s.end_time DESC LIMIT ?
        """, (user_id, limit)).fetchall()
    return [dict(r) for r in rows]


# ─── Stawki CRUD ──────────────────────────────────────────────────────────────
@app.get("/api/stawki", dependencies=[Depends(verify_key)])
def get_stawki():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM stawki ORDER BY stanowisko").fetchall()
    return [dict(r) for r in rows]

class StawkaRequest(BaseModel):
    stanowisko: str
    stawka_godz: float
    czas_norma_min: Optional[float] = 0
    opis: Optional[str] = ""

@app.post("/api/stawki", dependencies=[Depends(verify_key)])
def create_stawka(req: StawkaRequest):
    with get_db() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO stawki (stanowisko,stawka_godz,czas_norma_min,opis) VALUES (?,?,?,?)",
                (req.stanowisko, req.stawka_godz, req.czas_norma_min, req.opis)
            )
            return {"id": cur.lastrowid}
        except sqlite3.IntegrityError:
            raise HTTPException(400, "Stanowisko już istnieje")

@app.put("/api/stawki/{sid}", dependencies=[Depends(verify_key)])
def update_stawka(sid: int, req: StawkaRequest):
    with get_db() as conn:
        conn.execute(
            "UPDATE stawki SET stanowisko=?,stawka_godz=?,czas_norma_min=?,opis=? WHERE id=?",
            (req.stanowisko, req.stawka_godz, req.czas_norma_min, req.opis, sid)
        )
    return {"ok": True}

@app.delete("/api/stawki/{sid}", dependencies=[Depends(verify_key)])
def delete_stawka(sid: int):
    with get_db() as conn:
        conn.execute("DELETE FROM stawki WHERE id=?", (sid,))
    return {"ok": True}


# ─── Użytkownicy CRUD ─────────────────────────────────────────────────────────
@app.get("/api/users", dependencies=[Depends(verify_key)])
def get_users():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, username, full_name, role FROM users ORDER BY full_name"
        ).fetchall()
    return [dict(r) for r in rows]

class NewUserRequest(BaseModel):
    username: str
    password: str
    full_name: str
    role: str

@app.post("/api/users", dependencies=[Depends(verify_key)])
def create_user(req: NewUserRequest):
    with get_db() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO users (username, password, full_name, role) VALUES (?,?,?,?)",
                (req.username, _hash(req.password), req.full_name, req.role)
            )
            return {"id": cur.lastrowid}
        except sqlite3.IntegrityError:
            raise HTTPException(400, "Użytkownik już istnieje")

class EditUserRequest(BaseModel):
    full_name: str
    role: str
    password: Optional[str] = None

@app.put("/api/users/{uid}", dependencies=[Depends(verify_key)])
def update_user(uid: int, req: EditUserRequest):
    with get_db() as conn:
        if req.password:
            conn.execute(
                "UPDATE users SET full_name=?,role=?,password=? WHERE id=?",
                (req.full_name, req.role, _hash(req.password), uid)
            )
        else:
            conn.execute(
                "UPDATE users SET full_name=?,role=? WHERE id=?",
                (req.full_name, req.role, uid)
            )
    return {"ok": True}

@app.delete("/api/users/{uid}", dependencies=[Depends(verify_key)])
def delete_user(uid: int):
    with get_db() as conn:
        conn.execute("DELETE FROM users WHERE id=?", (uid,))
    return {"ok": True}


# ─── Katalog produktów CRUD ──────────────────────────────────────────────────
@app.get("/api/katalog", dependencies=[Depends(verify_key)])
def get_katalog():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM katalog_produktow ORDER BY nazwa").fetchall()
    return [dict(r) for r in rows]

class KatalogRequest(BaseModel):
    nazwa: str
    opis: Optional[str] = ""
    ilosc_domyslna: Optional[int] = 1
    cena_szt: Optional[float] = 0.0

@app.post("/api/katalog", dependencies=[Depends(verify_key)])
def create_produkt(req: KatalogRequest):
    with get_db() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO katalog_produktow (nazwa,opis,ilosc_domyslna,cena_szt) VALUES (?,?,?,?)",
                (req.nazwa, req.opis, req.ilosc_domyslna, req.cena_szt)
            )
            return {"id": cur.lastrowid}
        except sqlite3.IntegrityError:
            raise HTTPException(400, "Produkt już istnieje")

@app.put("/api/katalog/{kid}", dependencies=[Depends(verify_key)])
def update_produkt(kid: int, req: KatalogRequest):
    with get_db() as conn:
        conn.execute(
            "UPDATE katalog_produktow SET nazwa=?,opis=?,ilosc_domyslna=?,cena_szt=? WHERE id=?",
            (req.nazwa, req.opis, req.ilosc_domyslna, req.cena_szt, kid)
        )
    return {"ok": True}

@app.delete("/api/katalog/{kid}", dependencies=[Depends(verify_key)])
def delete_produkt(kid: int):
    with get_db() as conn:
        conn.execute("DELETE FROM katalog_produktow WHERE id=?", (kid,))
    return {"ok": True}


# ─── QR Code generation ──────────────────────────────────────────────────────
@app.get("/api/qr/{kod}", dependencies=[Depends(verify_key)])
def generate_qr(kod: str):
    """Generuje QR code PNG dla podanego kodu"""
    try:
        import qrcode
        qr = qrcode.QRCode(version=1, box_size=10, border=4)
        qr.add_data(kod)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return StreamingResponse(buf, media_type="image/png",
                                 headers={"Content-Disposition": f"inline; filename=\"{kod}.png\""})
    except ImportError:
        raise HTTPException(500, "Brak biblioteki qrcode. Zainstaluj: pip install qrcode[pil]")


# ─── Statystyki dla majstra (rozszerzone) ─────────────────────────────────────
@app.get("/api/stats/majster", dependencies=[Depends(verify_key)])
def majster_stats():
    with get_db() as conn:
        aktywne = conn.execute("""
            SELECT s.start_time, s.pauzy, s.id as sesja_id, s.typ,
                   u.full_name, u.id as user_id,
                   o.nazwa as op_nazwa, o.stanowisko, o.czas_norma,
                   o.ilosc_wykonana, o.id as op_id,
                   z.numer as zl_numer, z.nazwa as zl_nazwa, z.ilosc_sztuk
            FROM sesje_pracy s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN operacje o ON s.operacja_id = o.id
            LEFT JOIN zlecenia z ON o.zlecenie_id = z.id
            WHERE s.status='aktywna'
            ORDER BY s.start_time
        """).fetchall()

        dzis = conn.execute("""
            SELECT COUNT(*) as cnt, COALESCE(SUM(s.ilosc_sztuk),0) as sztuki,
                   COALESCE(SUM(
                     (strftime('%s', COALESCE(s.end_time, datetime('now'))) -
                      strftime('%s', s.start_time)) / 3600.0
                   ), 0) as godz
            FROM sesje_pracy s
            WHERE s.status='zakonczona' AND date(s.end_time) = date('now')
              AND s.typ = 'operacja'
        """).fetchone()

        # postęp zleceń z detalami operacji - aktywne
        zlecenia = conn.execute("""
            SELECT z.id, z.numer, z.nazwa, z.status, z.ilosc_sztuk, z.termin,
                   z.cena_brutto_szt,
                   COUNT(o.id) as op_total,
                   SUM(CASE WHEN o.status='zakonczona' THEN 1 ELSE 0 END) as op_done,
                   SUM(o.ilosc_wykonana) as sztuki_wykonane
            FROM zlecenia z
            LEFT JOIN operacje o ON o.zlecenie_id = z.id
            WHERE z.status IN ('nowe','w_toku')
            GROUP BY z.id
            ORDER BY z.numer
        """).fetchall()

        # wszystkie zlecenia (do historii)
        wszystkie_zlecenia = conn.execute("""
            SELECT z.id, z.numer, z.nazwa, z.status, z.ilosc_sztuk, z.termin,
                   z.cena_brutto_szt, z.created_at,
                   COUNT(o.id) as op_total,
                   SUM(CASE WHEN o.status='zakonczona' THEN 1 ELSE 0 END) as op_done,
                   SUM(o.ilosc_wykonana) as sztuki_wykonane
            FROM zlecenia z
            LEFT JOIN operacje o ON o.zlecenie_id = z.id
            GROUP BY z.id
            ORDER BY z.created_at DESC
        """).fetchall()

        # alerty norm (sesje przekraczające normę)
        alerty = conn.execute("""
            SELECT s.id as sesja_id, u.full_name, o.nazwa as op_nazwa,
                   o.czas_norma, s.start_time, s.pauzy,
                   z.numer as zl_numer
            FROM sesje_pracy s
            JOIN users u ON s.user_id = u.id
            JOIN operacje o ON s.operacja_id = o.id
            JOIN zlecenia z ON o.zlecenie_id = z.id
            WHERE s.status='aktywna' AND o.czas_norma > 0
        """).fetchall()

        import datetime
        alert_list = []
        for a in alerty:
            elapsed_min = (datetime.datetime.now() - datetime.datetime.fromisoformat(a["start_time"])).total_seconds() / 60
            # odejmij pauzy
            pauzy = json.loads(a["pauzy"] or "[]")
            for p in pauzy:
                if p.get("koniec"):
                    pause_sec = (datetime.datetime.fromisoformat(p["koniec"]) -
                                 datetime.datetime.fromisoformat(p["start"])).total_seconds()
                    elapsed_min -= pause_sec / 60
            if elapsed_min > a["czas_norma"] * 1.2:  # alert przy 120% normy
                alert_list.append({
                    "sesja_id": a["sesja_id"],
                    "pracownik": a["full_name"],
                    "operacja": a["op_nazwa"],
                    "zlecenie": a["zl_numer"],
                    "norma_min": a["czas_norma"],
                    "elapsed_min": round(elapsed_min, 1),
                    "przekroczenie_pct": round((elapsed_min / a["czas_norma"] - 1) * 100)
                })

        # podsumowanie kosztów dzisiaj
        koszty = conn.execute("""
            SELECT s.user_id, u.full_name, o.stanowisko,
                   SUM((strftime('%s', COALESCE(s.end_time, datetime('now'))) -
                        strftime('%s', s.start_time)) / 3600.0 * st.stawka_godz) as koszt,
                   SUM((strftime('%s', COALESCE(s.end_time, datetime('now'))) -
                        strftime('%s', s.start_time)) / 3600.0) as godz
            FROM sesje_pracy s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN operacje o ON s.operacja_id = o.id
            LEFT JOIN stawki st ON o.stanowisko = st.stanowisko
            WHERE date(s.start_time) = date('now') AND s.typ='operacja'
            GROUP BY s.user_id, o.stanowisko
        """).fetchall()

    return {
        "aktywne_sesje": [dict(r) for r in aktywne],
        "dzis_sesji": dzis[0] if dzis else 0,
        "dzis_sztuk": dzis[1] or 0,
        "dzis_godz": round(dzis[2] or 0, 2),
        "zlecenia": [dict(r) for r in zlecenia],
        "wszystkie_zlecenia": [dict(r) for r in wszystkie_zlecenia],
        "alerty_norm": alert_list,
        "koszty_dzis": [dict(r) for r in koszty],
    }


# ─── Wydajność pracowników ────────────────────────────────────────────────────
@app.get("/api/stats/wydajnosc", dependencies=[Depends(verify_key)])
def stats_wydajnosc(okres: str = "dzis"):
    import datetime
    if okres == "tydzien":
        filter_sql = "s.end_time >= datetime('now', '-7 days')"
    elif okres == "miesiac":
        filter_sql = "s.end_time >= datetime('now', '-30 days')"
    else:
        filter_sql = "date(s.end_time) = date('now')"

    with get_db() as conn:
        users_rows = conn.execute(f"""
            SELECT u.id, u.full_name,
                   COUNT(s.id) as sesji,
                   COALESCE(SUM(s.ilosc_sztuk), 0) as sztuki,
                   COALESCE(SUM(
                     (strftime('%s', s.end_time) - strftime('%s', s.start_time)) / 60.0
                   ), 0) as min_total
            FROM sesje_pracy s
            JOIN users u ON s.user_id = u.id
            WHERE s.status='zakonczona' AND s.typ='operacja' AND {filter_sql}
            GROUP BY u.id ORDER BY sztuki DESC
        """).fetchall()

        wyniki = []
        for r in users_rows:
            sesje = conn.execute(f"""
                SELECT s.ilosc_sztuk, s.start_time, s.end_time, s.pauzy,
                       o.nazwa as op_nazwa, o.czas_norma, o.stanowisko,
                       z.numer as zl_numer
                FROM sesje_pracy s
                JOIN operacje o ON s.operacja_id = o.id
                JOIN zlecenia z ON o.zlecenie_id = z.id
                WHERE s.user_id=? AND s.status='zakonczona' AND s.typ='operacja'
                  AND {filter_sql}
                ORDER BY s.end_time DESC LIMIT 30
            """, (r["id"],)).fetchall()

            sesje_list = []
            normy_ok = 0
            normy_total = 0
            for s in sesje:
                elapsed = (datetime.datetime.fromisoformat(s["end_time"]) -
                           datetime.datetime.fromisoformat(s["start_time"])).total_seconds() / 60
                pauzy = json.loads(s["pauzy"] or "[]")
                for p in pauzy:
                    if p.get("koniec"):
                        elapsed -= (datetime.datetime.fromisoformat(p["koniec"]) -
                                    datetime.datetime.fromisoformat(p["start"])).total_seconds() / 60
                elapsed = max(0.1, elapsed)
                wyd_pct = round(s["czas_norma"] / elapsed * 100) if s["czas_norma"] else None
                if wyd_pct is not None:
                    normy_total += 1
                    if wyd_pct >= 90:
                        normy_ok += 1
                sesje_list.append({
                    "op_nazwa": s["op_nazwa"],
                    "stanowisko": s["stanowisko"],
                    "zl_numer": s["zl_numer"],
                    "ilosc_sztuk": s["ilosc_sztuk"],
                    "czas_min": round(elapsed, 1),
                    "norma_min": s["czas_norma"],
                    "wyd_pct": wyd_pct,
                })

            wyniki.append({
                "user_id": r["id"],
                "full_name": r["full_name"],
                "sesji": r["sesji"],
                "sztuki": r["sztuki"],
                "godz": round(r["min_total"] / 60, 2),
                "normy_ok": normy_ok,
                "normy_total": normy_total,
                "sesje": sesje_list,
            })

    return {"okres": okres, "pracownicy": wyniki}


# ─── Wydajność jednego pracownika (historia + statystyki) ─────────────────────
@app.get("/api/stats/wydajnosc/{user_id}", dependencies=[Depends(verify_key)])
def stats_wydajnosc_user(user_id: int, okres: str = "tydzien"):
    import datetime
    if okres == "dzis":
        filter_sql = "date(s.end_time) = date('now')"
    elif okres == "miesiac":
        filter_sql = "s.end_time >= datetime('now', '-30 days')"
    else:
        filter_sql = "s.end_time >= datetime('now', '-7 days')"

    with get_db() as conn:
        summary = conn.execute(f"""
            SELECT COUNT(s.id) as sesji,
                   COALESCE(SUM(s.ilosc_sztuk), 0) as sztuki,
                   COALESCE(SUM(
                     (strftime('%s', s.end_time) - strftime('%s', s.start_time)) / 60.0
                   ), 0) as min_total
            FROM sesje_pracy s
            WHERE s.user_id=? AND s.status='zakonczona' AND s.typ='operacja' AND {filter_sql}
        """, (user_id,)).fetchone()

        sesje = conn.execute(f"""
            SELECT s.ilosc_sztuk, s.start_time, s.end_time, s.pauzy,
                   o.nazwa as op_nazwa, o.czas_norma, o.stanowisko,
                   z.numer as zl_numer, z.nazwa as zl_nazwa
            FROM sesje_pracy s
            JOIN operacje o ON s.operacja_id = o.id
            JOIN zlecenia z ON o.zlecenie_id = z.id
            WHERE s.user_id=? AND s.status='zakonczona' AND s.typ='operacja'
              AND {filter_sql}
            ORDER BY s.end_time DESC
        """, (user_id,)).fetchall()

    sesje_list = []
    normy_ok = 0
    normy_total = 0
    for s in sesje:
        elapsed = (datetime.datetime.fromisoformat(s["end_time"]) -
                   datetime.datetime.fromisoformat(s["start_time"])).total_seconds() / 60
        pauzy = json.loads(s["pauzy"] or "[]")
        for p in pauzy:
            if p.get("koniec"):
                elapsed -= (datetime.datetime.fromisoformat(p["koniec"]) -
                            datetime.datetime.fromisoformat(p["start"])).total_seconds() / 60
        elapsed = max(0.1, elapsed)
        wyd_pct = round(s["czas_norma"] / elapsed * 100) if s["czas_norma"] else None
        if wyd_pct is not None:
            normy_total += 1
            if wyd_pct >= 90:
                normy_ok += 1
        sesje_list.append({
            "op_nazwa": s["op_nazwa"],
            "stanowisko": s["stanowisko"],
            "zl_numer": s["zl_numer"],
            "zl_nazwa": s["zl_nazwa"],
            "ilosc_sztuk": s["ilosc_sztuk"],
            "czas_min": round(elapsed, 1),
            "norma_min": s["czas_norma"],
            "wyd_pct": wyd_pct,
            "end_time": s["end_time"],
        })

    return {
        "okres": okres,
        "sesji": summary["sesji"] if summary else 0,
        "sztuki": summary["sztuki"] if summary else 0,
        "godz": round((summary["min_total"] or 0) / 60, 2),
        "normy_ok": normy_ok,
        "normy_total": normy_total,
        "sesje": sesje_list,
    }


@app.get("/api/zlecenia/{zid}/sesje", dependencies=[Depends(verify_key)])
def get_zlecenie_sesje(zid: int):
    """Zwraca szczegóły sesji pracy dla zlecenia (historia operacji)"""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT s.id, s.start_time, s.end_time, s.pauzy, s.ilosc_sztuk, s.uwagi, s.typ,
                   u.full_name, u.id as user_id,
                   o.nazwa as op_nazwa, o.stanowisko, o.kolejnosc,
                   z.numer as zl_numer
            FROM sesje_pracy s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN operacje o ON s.operacja_id = o.id
            LEFT JOIN zlecenia z ON o.zlecenie_id = z.id
            WHERE o.zlecenie_id=? AND s.status='zakonczona'
            ORDER BY s.end_time DESC
        """, (zid,)).fetchall()
    return [dict(r) for r in rows]


# ─── Podsumowanie kosztów zlecenia ────────────────────────────────────────────
@app.get("/api/zlecenia/{zid}/koszty", dependencies=[Depends(verify_key)])
def koszty_zlecenia(zid: int):
    with get_db() as conn:
        zl = conn.execute("SELECT * FROM zlecenia WHERE id=?", (zid,)).fetchone()
        if not zl:
            raise HTTPException(404, "Zlecenie nie znalezione")

        sesje = conn.execute("""
            SELECT s.*, u.full_name, o.stanowisko, o.nazwa as op_nazwa, o.czas_norma,
                   st.stawka_godz
            FROM sesje_pracy s
            JOIN users u ON s.user_id = u.id
            JOIN operacje o ON s.operacja_id = o.id
            LEFT JOIN stawki st ON o.stanowisko = st.stanowisko
            WHERE o.zlecenie_id=? AND s.status='zakonczona'
        """, (zid,)).fetchall()

        total_koszt = 0
        total_godz = 0
        rows = []
        for s in sesje:
            import datetime
            elapsed = (datetime.datetime.fromisoformat(s["end_time"]) -
                       datetime.datetime.fromisoformat(s["start_time"])).total_seconds() / 3600
            # odejmij pauzy
            pauzy = json.loads(s["pauzy"] or "[]")
            for p in pauzy:
                if p.get("koniec"):
                    pause_sec = (datetime.datetime.fromisoformat(p["koniec"]) -
                                 datetime.datetime.fromisoformat(p["start"])).total_seconds()
                    elapsed -= pause_sec / 3600
            koszt = elapsed * (s["stawka_godz"] or 0)
            total_koszt += koszt
            total_godz += elapsed
            rows.append({
                "sesja_id": s["id"],
                "pracownik": s["full_name"],
                "operacja": s["op_nazwa"],
                "stanowisko": s["stanowisko"],
                "godz": round(elapsed, 2),
                "stawka_godz": s["stawka_godz"],
                "koszt": round(koszt, 2),
                "ilosc_sztuk": s["ilosc_sztuk"],
            })

        przychod = (zl["cena_brutto_szt"] or 0) * (zl["ilosc_sztuk"] or 0)
        return {
            "zlecenie": dict(zl),
            "sesje": rows,
            "total_godz": round(total_godz, 2),
            "total_koszt": round(total_koszt, 2),
            "przychod": round(przychod, 2),
            "marza": round(przychod - total_koszt, 2),
        }


# ─── Powiadomienia ────────────────────────────────────────────────────────────
@app.get("/api/powiadomienia/{rola}", dependencies=[Depends(verify_key)])
def get_powiadomienia(rola: str):
    with get_db() as conn:
        rows = conn.execute("""
            SELECT p.*, o.nazwa as op_nazwa, z.numer as zl_numer
            FROM powiadomienia p
            LEFT JOIN operacje o ON p.operacja_id = o.id
            LEFT JOIN zlecenia z ON p.zlecenie_id = z.id
            WHERE (p.dla_roli=? OR p.dla_roli='all') AND p.odczytane=0
            ORDER BY p.created_at DESC LIMIT 50
        """, (rola,)).fetchall()
    return [dict(r) for r in rows]

@app.post("/api/powiadomienia/{pid}/przeczytaj", dependencies=[Depends(verify_key)])
def mark_read(pid: int):
    with get_db() as conn:
        conn.execute("UPDATE powiadomienia SET odczytane=1 WHERE id=?", (pid,))
    return {"ok": True}


# ─── Inicjalizacja bazy danych ────────────────────────────────────────────────
def init_db_on_start():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("""CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
        full_name TEXT NOT NULL, role TEXT NOT NULL)""")

    c.execute("""CREATE TABLE IF NOT EXISTS zlecenia (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numer TEXT UNIQUE NOT NULL, nazwa TEXT NOT NULL, opis TEXT,
        status TEXT DEFAULT 'nowe', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER, termin TEXT, ilosc_sztuk INTEGER DEFAULT 1,
        cena_brutto_szt REAL DEFAULT 0, material_od_klienta INTEGER DEFAULT 0,
        qr_code TEXT)""")

    c.execute("""CREATE TABLE IF NOT EXISTS operacje (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zlecenie_id INTEGER NOT NULL, nazwa TEXT NOT NULL,
        kolejnosc INTEGER DEFAULT 0, czas_norma REAL DEFAULT 0,
        stanowisko TEXT, status TEXT DEFAULT 'oczekuje', qr_code TEXT,
        ilosc_wykonana INTEGER DEFAULT 0, opis_czynnosci TEXT DEFAULT '',
        FOREIGN KEY (zlecenie_id) REFERENCES zlecenia(id))""")

    c.execute("""CREATE TABLE IF NOT EXISTS sesje_pracy (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operacja_id INTEGER, user_id INTEGER NOT NULL,
        typ TEXT NOT NULL, start_time TIMESTAMP, end_time TIMESTAMP,
        pauzy TEXT DEFAULT '[]', ilosc_sztuk INTEGER DEFAULT 0,
        uwagi TEXT, status TEXT DEFAULT 'aktywna',
        FOREIGN KEY (user_id) REFERENCES users(id))""")

    c.execute("""CREATE TABLE IF NOT EXISTS stawki (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stanowisko TEXT UNIQUE NOT NULL, stawka_godz REAL NOT NULL,
        czas_norma_min REAL DEFAULT 0, opis TEXT DEFAULT '')""")

    c.execute("""CREATE TABLE IF NOT EXISTS katalog_produktow (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nazwa TEXT UNIQUE NOT NULL, opis TEXT,
        ilosc_domyslna INTEGER DEFAULT 1, cena_szt REAL DEFAULT 0.0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""")

    c.execute("""CREATE TABLE IF NOT EXISTS opcje_zlecen (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zlecenie_id INTEGER NOT NULL, typ TEXT NOT NULL,
        opis TEXT, kwota REAL DEFAULT 0, ilosc REAL DEFAULT 0)""")

    c.execute("""CREATE TABLE IF NOT EXISTS powiadomienia (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zlecenie_id INTEGER, operacja_id INTEGER, typ TEXT NOT NULL,
        tytul TEXT, tresc TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        odczytane INTEGER DEFAULT 0, dla_roli TEXT DEFAULT 'all')""")

    # Dane startowe
    c.execute("SELECT id FROM users WHERE username='admin'")
    if not c.fetchone():
        def h(p): return hashlib.sha256(p.encode()).hexdigest()
        users = [
            ('admin',     h('admin123'),   'Administrator',     'admin'),
            ('jan.tech',  h('tech123'),    'Jan Kowalski',      'technolog'),
            ('piotr.p',   h('pracownik1'), 'Piotr Nowak',       'pracownik'),
            ('anna.p',    h('pracownik2'), 'Anna Wiśniewska',   'pracownik'),
            ('mag.jan',   h('magazyn123'), 'Jan Magazynowski',  'magazynier'),
            ('majster.k', h('majster123'), 'Krzysztof Majster', 'majster'),
        ]
        c.executemany("INSERT INTO users (username,password,full_name,role) VALUES (?,?,?,?)", users)

    c.execute("SELECT id FROM stawki LIMIT 1")
    if not c.fetchone():
        stawki = [
            ('Toczenie konwencjonalne',     65.0, 15.0),
            ('Toczenie CNC',                90.0, 10.0),
            ('Frezowanie konwencjonalne',   70.0, 20.0),
            ('Frezowanie CNC - mała brama', 95.0, 12.0),
            ('Frezowanie CNC - duża brama',110.0, 18.0),
            ('Cięcie na pile',              45.0,  5.0),
            ('Wypalanie laserowe',         120.0,  8.0),
            ('Wypalanie plazmowe',          80.0, 10.0),
            ('Prace ślusarskie',            60.0, 25.0),
            ('Szlifowanie',                 75.0, 12.0),
        ]
        c.executemany("INSERT INTO stawki (stanowisko,stawka_godz,czas_norma_min) VALUES (?,?,?)", stawki)

    conn.commit()
    conn.close()
    print(f"✓ Baza danych gotowa: {DB_PATH}")


# ─── Serwowanie aplikacji ──────────────────────────────────────────────────────
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(STATIC_DIR, exist_ok=True)

if os.path.exists(os.path.join(STATIC_DIR, "index.html")):
    app.mount("/app", StaticFiles(directory=STATIC_DIR, html=True), name="static")

@app.get("/", response_class=HTMLResponse)
def root():
    return """
    <html><body style="font-family:monospace;background:#1a1f2e;color:#e8eaf0;padding:40px">
    <h2>⚙ Produkcja API v4.0</h2>
    <p>Status: <span style="color:#27ae60">● online</span></p>
    <p><a href="/docs" style="color:#e8a020">/docs</a> – dokumentacja API</p>
    <p><a href="/app" style="color:#e8a020">/app</a> – aplikacja mobilna</p>
    </body></html>
    """

@app.get("/health")
def health():
    return {"status": "ok", "db": os.path.exists(DB_PATH)}


# ─── Start ─────────────────────────────────────────────────────────────────────
init_db_on_start()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
