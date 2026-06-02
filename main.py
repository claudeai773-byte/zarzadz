"""
Serwer FastAPI dla Systemu Zarządzania Produkcją v4.0
Deploy na Railway.app
"""

from fastapi import FastAPI, HTTPException, Header, Depends, Request, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Any, Optional
import sqlite3, os, json, hashlib, time, io, datetime as _dt, traceback, urllib.request, urllib.error
from contextlib import contextmanager

def _now():
    """Bieżący czas UTC jako ISO string z 'Z' (JS-kompatybilny)."""
    return _dt.datetime.utcnow().isoformat() + "Z"

def _parse(s):
    """Parsuje ISO datetime string (obsługuje 'Z', Python <3.11)."""
    if not s: return _dt.datetime.utcnow()
    return _dt.datetime.fromisoformat(str(s).replace("Z","").replace("+00:00",""))

# ─── Konfiguracja ──────────────────────────────────────────────────────────────
DB_PATH       = os.environ.get("DB_PATH",  "/data/produkcja.db")
API_KEY       = os.environ.get("API_KEY",  "zmien-mnie-na-bezpieczny-klucz")
PORT          = int(os.environ.get("PORT", 8000))
BACKUP_PATH   = os.environ.get("BACKUP_PATH", "/data/backup.json")   # persystentny backup JSON
BACKUP_INTERVAL = int(os.environ.get("BACKUP_INTERVAL", 120))        # co ile sekund auto-backup (domyślnie 2 min)

# ── Cloudinary – storage plików STEP ──────────────────────────────────────────
CLOUDINARY_CLOUD = os.environ.get("CLOUDINARY_CLOUD_NAME", "")
CLOUDINARY_KEY   = os.environ.get("CLOUDINARY_API_KEY", "")
CLOUDINARY_SECRET= os.environ.get("CLOUDINARY_API_SECRET", "")

# ── GitHub Gist backup (zalecany na Render bez dysku) ─────────────────────────
GIST_TOKEN   = os.environ.get("GIST_TOKEN", "")   # Personal Access Token (scope: gist)
GIST_ID      = os.environ.get("GIST_ID", "")      # ID Gista – opcjonalnie, wykrywane automatycznie
GIST_ID_FILE = os.path.join(os.path.dirname(__file__), ".gist_id")  # cache ID w kontenerze

# Jeżeli /data nie istnieje (Render bez dysku), używamy katalogu lokalnego
if not os.path.exists(os.path.dirname(DB_PATH)):
    _local = os.path.dirname(__file__)
    DB_PATH     = os.path.join(_local, "produkcja.db")
    BACKUP_PATH = os.path.join(_local, "backup.json")

app = FastAPI(title="Produkcja API", version="4.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    print(f"[500] {request.method} {request.url.path}\n{tb}", flush=True)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Błąd serwera [{type(exc).__name__}]: {str(exc)}"}
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



@app.get("/api/status/produkcja", dependencies=[Depends(verify_key)])
def status_produkcja():
    """Status produkcji na ekran logowania – zakończone/aktywne/następne operacje."""
    with get_db() as conn:
        zakonczone = conn.execute("""
            SELECT o.id, o.nazwa, o.kolejnosc, o.stanowisko, o.ilosc_wykonana,
                   z.ilosc_sztuk, z.numer as zl_numer, z.nazwa as zl_nazwa,
                   o.czas_norma, z.id as zlecenie_id
            FROM operacje o JOIN zlecenia z ON o.zlecenie_id=z.id
            WHERE o.status='zakonczona' AND z.status IN ('nowe','w_toku')
            ORDER BY z.numer, o.kolejnosc
        """).fetchall()
        aktywne = conn.execute("""
            SELECT DISTINCT o.id, o.nazwa, o.kolejnosc, o.stanowisko, o.ilosc_wykonana,
                   z.ilosc_sztuk, z.numer as zl_numer, z.nazwa as zl_nazwa, o.czas_norma
            FROM sesje_pracy s
            JOIN operacje o ON s.operacja_id=o.id
            JOIN zlecenia z ON o.zlecenie_id=z.id
            WHERE s.status='aktywna' AND s.typ IN ('operacja','inne_zlecenie')
            ORDER BY z.numer, o.kolejnosc
        """).fetchall()
        nastepne = conn.execute("""
            SELECT o.id, o.nazwa, o.kolejnosc, o.stanowisko, o.ilosc_wykonana,
                   z.ilosc_sztuk, z.numer as zl_numer, z.nazwa as zl_nazwa, o.czas_norma
            FROM operacje o JOIN zlecenia z ON o.zlecenie_id=z.id
            WHERE o.status='oczekuje' AND z.status IN ('nowe','w_toku')
            ORDER BY z.numer, o.kolejnosc LIMIT 15
        """).fetchall()
        # Dla każdej zakończonej op – następna w zleceniu
        next_map = {}
        for op in zakonczone:
            nxt = conn.execute("""
                SELECT nazwa, kolejnosc, stanowisko, czas_norma FROM operacje
                WHERE zlecenie_id=? AND kolejnosc>? AND status!='anulowane'
                ORDER BY kolejnosc LIMIT 1
            """, (op["zlecenie_id"], op["kolejnosc"])).fetchone()
            if nxt:
                next_map[str(op["id"])] = dict(nxt)
    return {
        "zakonczone": [dict(r) for r in zakonczone],
        "aktywne":    [dict(r) for r in aktywne],
        "nastepne":   [dict(r) for r in nastepne],
        "next_map":   next_map,
    }

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
            od = dict(op)
            zbr_done = conn.execute(
                "SELECT COUNT(*) FROM sesje_pracy WHERE operacja_id=? AND typ='zbrojenie' AND status='zakonczona'",
                (op["id"],)
            ).fetchone()[0]
            od["zbrojenie_wykonane"] = bool(zbr_done)
            return {"type": "operacja", "data": od}

        # szukaj zlecenia
        zl = conn.execute("SELECT * FROM zlecenia WHERE qr_code=?", (qr,)).fetchone()
        if zl:
            ops = conn.execute(
                "SELECT * FROM operacje WHERE zlecenie_id=? ORDER BY kolejnosc", (zl["id"],)
            ).fetchall()
            ops_list = []
            for o in ops:
                od = dict(o)
                zbr_done = conn.execute(
                    "SELECT COUNT(*) FROM sesje_pracy WHERE operacja_id=? AND typ='zbrojenie' AND status='zakonczona'",
                    (o["id"],)
                ).fetchone()[0]
                od["zbrojenie_wykonane"] = bool(zbr_done)
                ops_list.append(od)
            return {"type": "zlecenie", "data": dict(zl), "operacje": ops_list}

    raise HTTPException(404, "Nie znaleziono kodu QR: " + qr)


# ─── Zlecenia CRUD ────────────────────────────────────────────────────────────
@app.get("/api/zlecenia", dependencies=[Depends(verify_key)])
def get_zlecenia(status: Optional[str] = None):
    with get_db() as conn:
        if status:
            rows = conn.execute(
                "SELECT * FROM zlecenia WHERE status=? ORDER BY created_at DESC", (status,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM zlecenia ORDER BY created_at DESC").fetchall()
        result = []
        for z in rows:
            zd = dict(z)
            # Oblicz pozostały czas w minutach na bazie norm operacji
            ops = conn.execute("""
                SELECT id, status, czas_norma, ilosc_wykonana, czas_zbrojenia_min FROM operacje WHERE zlecenie_id=?
            """, (z["id"],)).fetchall()
            ilosc = z["ilosc_sztuk"] or 1
            pozostale_min = 0
            for op in ops:
                if op["status"] == "zakonczona": continue
                norma = op["czas_norma"] or 0
                wykonano = op["ilosc_wykonana"] or 0
                zbrojenie = op["czas_zbrojenia_min"] or 0
                if norma:
                    pozostale_min += norma * max(0, ilosc - wykonano)
                # zbrojenie: dolicz tylko jeśli nie zostało jeszcze wykonane
                if zbrojenie:
                    # sprawdź czy dla tej operacji jest zakończona sesja zbrojenia
                    zbr_done = conn.execute(
                        "SELECT COUNT(*) FROM sesje_pracy WHERE operacja_id=? AND typ='zbrojenie' AND status='zakonczona'",
                        (op["id"],)
                    ).fetchone()[0]
                    if not zbr_done:
                        pozostale_min += zbrojenie
            zd["pozostale_min"] = round(pozostale_min, 1)
            result.append(zd)
    return result

class ZlecenieRequest(BaseModel):
    numer: str
    nazwa: str
    opis: Optional[str] = ""
    status: Optional[str] = "nowe"
    termin: Optional[str] = None
    ilosc_sztuk: Optional[int] = 1
    cena_brutto_szt: Optional[float] = 0
    material_od_klienta: Optional[int] = 0
    model_3d_url: Optional[str] = None

@app.post("/api/zlecenia", dependencies=[Depends(verify_key)])
def create_zlecenie(req: ZlecenieRequest):
    import uuid
    qr = "ZL-" + str(uuid.uuid4())[:8].upper()
    with get_db() as conn:
        try:
            cur = conn.execute(
                """INSERT INTO zlecenia (numer,nazwa,opis,status,termin,ilosc_sztuk,
                   cena_brutto_szt,material_od_klienta,qr_code,model_3d_url)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (req.numer, req.nazwa, req.opis, req.status, req.termin,
                 req.ilosc_sztuk, req.cena_brutto_szt, req.material_od_klienta, qr,
                 req.model_3d_url)
            )
            return {"id": cur.lastrowid, "qr_code": qr}
        except sqlite3.IntegrityError:
            raise HTTPException(400, "Zlecenie o tym numerze już istnieje")
        except Exception as e:
            raise HTTPException(500, f"Błąd bazy danych: {str(e)}")

@app.put("/api/zlecenia/{zid}", dependencies=[Depends(verify_key)])
def update_zlecenie(zid: int, req: ZlecenieRequest):
    with get_db() as conn:
        conn.execute(
            """UPDATE zlecenia SET numer=?,nazwa=?,opis=?,status=?,termin=?,
               ilosc_sztuk=?,cena_brutto_szt=?,material_od_klienta=?,model_3d_url=? WHERE id=?""",
            (req.numer, req.nazwa, req.opis, req.status, req.termin,
             req.ilosc_sztuk, req.cena_brutto_szt, req.material_od_klienta,
             req.model_3d_url, zid)
        )
    return {"ok": True}

@app.delete("/api/zlecenia/{zid}", dependencies=[Depends(verify_key)])
def delete_zlecenie(zid: int):
    with get_db() as conn:
        conn.execute("DELETE FROM sesje_pracy WHERE operacja_id IN (SELECT id FROM operacje WHERE zlecenie_id=?)", (zid,))
        conn.execute("DELETE FROM produkty_zlecenia WHERE zlecenie_id=?", (zid,))
        conn.execute("DELETE FROM operacje WHERE zlecenie_id=?", (zid,))
        conn.execute("DELETE FROM zlecenia WHERE id=?", (zid,))
    return {"ok": True}

@app.patch("/api/zlecenia/{zid}/status", dependencies=[Depends(verify_key)])
def change_zlecenie_status(zid: int, body: dict):
    status = body.get("status")
    if status not in ("nowe","w_toku","zakonczone","anulowane","oczekuje_potwierdzenia","wstrzymane"):
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
    czas_zbrojenia_min: Optional[float] = 0.0

@app.post("/api/operacje", dependencies=[Depends(verify_key)])
def create_operacja(req: OperacjaRequest):
    import uuid
    qr = "OP-" + str(uuid.uuid4())[:8].upper()
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO operacje (zlecenie_id,nazwa,kolejnosc,czas_norma,
               stanowisko,opis_czynnosci,qr_code,czas_zbrojenia_min)
               VALUES (?,?,?,?,?,?,?,?)""",
            (req.zlecenie_id, req.nazwa, req.kolejnosc, req.czas_norma,
             req.stanowisko, req.opis_czynnosci, qr, req.czas_zbrojenia_min or 0.0)
        )
        return {"id": cur.lastrowid, "qr_code": qr}

@app.put("/api/operacje/{oid}", dependencies=[Depends(verify_key)])
def update_operacja(oid: int, req: OperacjaRequest):
    with get_db() as conn:
        conn.execute(
            """UPDATE operacje SET nazwa=?,kolejnosc=?,czas_norma=?,
               stanowisko=?,opis_czynnosci=?,czas_zbrojenia_min=? WHERE id=?""",
            (req.nazwa, req.kolejnosc, req.czas_norma,
             req.stanowisko, req.opis_czynnosci, req.czas_zbrojenia_min or 0.0, oid)
        )
    return {"ok": True}

@app.delete("/api/operacje/{oid}", dependencies=[Depends(verify_key)])
def delete_operacja(oid: int):
    with get_db() as conn:
        conn.execute("DELETE FROM operacje WHERE id=?", (oid,))
    return {"ok": True}

# Endpoint KJ – zapis wyniku kontroli jakości
class KJRequest(BaseModel):
    wynik: str  # 'zgodny' | 'niezgodny'
    uwagi: Optional[str] = ""

@app.patch("/api/operacje/{oid}/kj", dependencies=[Depends(verify_key)])
def zapisz_wynik_kj(oid: int, req: KJRequest):
    if req.wynik not in ("zgodny", "niezgodny"):
        raise HTTPException(400, "Wynik musi być: zgodny lub niezgodny")
    with get_db() as conn:
        op = conn.execute("SELECT * FROM operacje WHERE id=?", (oid,)).fetchone()
        if not op:
            raise HTTPException(404, "Operacja nie istnieje")
        nowy_status = "zakonczona" if req.wynik == "zgodny" else "niezgodna_kj"
        conn.execute(
            "UPDATE operacje SET kj_wynik=?, status=?, opis_czynnosci=CASE WHEN ?!='' THEN opis_czynnosci||'\n[KJ '||datetime('now')||']: '||? ELSE opis_czynnosci END WHERE id=?",
            (req.wynik, nowy_status, req.uwagi, req.uwagi, oid)
        )
        # Jeśli niezgodny – zatrzymaj dalsze operacje (status zlecenia -> wstrzymane)
        if req.wynik == "niezgodny":
            conn.execute(
                "UPDATE zlecenia SET status='wstrzymane' WHERE id=(SELECT zlecenie_id FROM operacje WHERE id=?)",
                (oid,)
            )
    _threading.Thread(target=_db_backup_to_json, daemon=True).start()
    return {"ok": True, "wynik": req.wynik}


# ─── Import technologii z PDF ─────────────────────────────────────────────────
def _parse_technologia_pdf(pdf_bytes: bytes) -> dict:
    """Parsuje kartę technologiczną PDF → dict z numerem, nazwą i operacjami."""
    import re, io
    try:
        from pdfminer.high_level import extract_text as _extract
        text = _extract(io.BytesIO(pdf_bytes))
    except Exception as e:
        raise ValueError(f"Nie można odczytać PDF: {e}")

    # Nagłówek – numer i nazwa
    hdr = re.search(r'WYRÓB / DETAL:.*?\n(\S+)\s*\n(.+?)\n', text, re.DOTALL)
    numer = hdr.group(1).strip() if hdr else ""
    nazwa = hdr.group(2).strip() if hdr else ""
    if not numer:
        # fallback: pierwsza linia po WYRÓB / DETAL:
        m2 = re.search(r'\n(P\d+)\n', text)
        numer = m2.group(1) if m2 else "IMPORT"
    if not nazwa:
        m3 = re.search(numer + r'\s*\n(.+?)\n', text)
        nazwa = m3.group(1).strip() if m3 else "Importowana technologia"

    # Operacje
    op_pattern = re.compile(
        r'(\d{3})\s*\n\s*(OT-[A-Z0-9]+-\d+\s*-\s*[^\n]+?)\s*\n'
        r'\s*([\d\s,\.]+)\s*\n\s*([\d\s,\.]+)\s*\n\s*([^\n]+?)\s*\n'
        r'\s*Uwagi:\s*\n\s*(.*?)(?=\n\d{3}\s*\n|Suma Tj:|\Z)',
        re.DOTALL
    )

    operacje = []
    for m in op_pattern.finditer(text):
        nr_str   = m.group(1)
        kod_nazwa = m.group(2).strip()
        tj_str   = m.group(3).strip().replace(' ','').replace(',','.')
        tpz_str  = m.group(4).strip().replace(' ','').replace(',','.')
        stanowisko_raw = m.group(5).strip()
        opis_raw = m.group(6).strip()

        try: tj  = float(re.search(r'[\d\.]+', tj_str).group())
        except: tj = 0.0
        try: tpz = float(re.search(r'[\d\.]+', tpz_str).group())
        except: tpz = 0.0

        # Wyciągnij czyste stanowisko (po myślniku)
        st_match = re.match(r'^[A-Z0-9]+ - (.+)$', stanowisko_raw)
        stanowisko = st_match.group(1).strip() if st_match else stanowisko_raw

        # Kod operacji – fragment przed myślnikiem i numerem
        kod_match = re.match(r'(OT-[A-Z]+)-\d+', kod_nazwa)
        kod_prefix = kod_match.group(1) if kod_match else "OT"

        # Klasyfikacja operacji
        if 'KJ' in kod_prefix or 'KJ' in stanowisko_raw:
            typ_op = 'kj'
        elif 'KOOP' in kod_prefix or 'KOOP' in stanowisko_raw:
            typ_op = 'kooperacja'
        elif 'ZP' in kod_prefix or 'Zbrojenie' in stanowisko or 'zbrojenie' in opis_raw.lower():
            typ_op = 'zbrojenie_zewn'
        else:
            typ_op = 'produkcja'

        # Nazwa operacji (bez kodu OT-XXX-000)
        nazwa_op_match = re.match(r'OT-[A-Z0-9]+-\d+\s*-\s*(.+)', kod_nazwa)
        nazwa_op = nazwa_op_match.group(1).strip() if nazwa_op_match else kod_nazwa

        # Parametry KJ z opisu
        kj_params = []
        for line in opis_raw.splitlines():
            if 'Niezgodny' in line and 'Zgodny' in line:
                kj_params.append(line.strip())

        # Opis – usuń parametry KJ (zostaną w parametry_kj)
        opis_clean = re.sub(r'Parametry KJ:.*', '', opis_raw, flags=re.DOTALL).strip()

        operacje.append({
            "kolejnosc": int(nr_str),
            "nazwa": nazwa_op,
            "stanowisko_raw": stanowisko_raw,
            "stanowisko": stanowisko,
            "czas_norma": tj,
            "czas_tpz_min": tpz,
            "opis_czynnosci": opis_clean,
            "typ_operacji": typ_op,
            "parametry_kj": json.dumps(kj_params, ensure_ascii=False) if kj_params else None,
        })

    # Op 010 (lista materiałów) – dodaj ją ręcznie jeśli nie złapana
    if not any(o["kolejnosc"] == 10 for o in operacje):
        m010 = re.search(r'010\s*\n\s*(OT-[^\n]+)\s*\n.*?([\d,]+)\s*\n\s*([\d,]+)\s*\n\s*([^\n]+?)\s*\n', text, re.DOTALL)
        if m010:
            nazwa_010 = re.sub(r'OT-[A-Z0-9]+-\d+\s*-\s*','', m010.group(1).strip())
            operacje.insert(0, {
                "kolejnosc": 10, "nazwa": nazwa_010,
                "stanowisko_raw": m010.group(4).strip(),
                "stanowisko": re.sub(r'^[A-Z0-9]+ - ','', m010.group(4).strip()),
                "czas_norma": 0.0, "czas_tpz_min": 0.0,
                "opis_czynnosci": "Kontrola jakości materiału",
                "typ_operacji": "kj",
                "parametry_kj": json.dumps(["Materiał wejściowy: Niezgodny - Zgodny"], ensure_ascii=False),
            })

    operacje.sort(key=lambda x: x["kolejnosc"])
    return {"numer": numer, "nazwa": nazwa, "operacje": operacje}


class ImportTechnologiaResponse(BaseModel):
    zlecenie_id: int
    numer: str
    nazwa: str
    operacje_created: int
    nowe_stanowiska: List[str]
    errors: List[str]

@app.post("/api/import-technologia", dependencies=[Depends(verify_key)])
async def import_technologia(file: UploadFile = File(...)):
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(400, "Pusty plik")
    try:
        parsed = _parse_technologia_pdf(pdf_bytes)
    except ValueError as e:
        raise HTTPException(400, str(e))

    errors = []
    nowe_stanowiska = []

    with get_db() as conn:
        # Sprawdź czy zlecenie już istnieje
        existing = conn.execute(
            "SELECT id FROM zlecenia WHERE numer=?", (parsed["numer"],)
        ).fetchone()
        if existing:
            raise HTTPException(400, f"Zlecenie {parsed['numer']} już istnieje w systemie")

        # Utwórz zlecenie ze statusem 'oczekuje_potwierdzenia'
        import uuid as _uuid
        qr_zl = "ZL-" + str(_uuid.uuid4())[:8].upper()
        cur = conn.execute(
            """INSERT INTO zlecenia (numer, nazwa, opis, status, ilosc_sztuk, qr_code)
               VALUES (?, ?, ?, 'oczekuje_potwierdzenia', 1, ?)""",
            (parsed["numer"], parsed["nazwa"],
             f"Zaimportowano z karty technologicznej {_now()[:10]}", qr_zl)
        )
        zlecenie_id = cur.lastrowid

        # Zapewnij istnienie stanowisk (utwórz jeśli brak)
        istniejace_stanowiska = {
            r["stanowisko"] for r in conn.execute("SELECT stanowisko FROM stawki").fetchall()
        }

        for op in parsed["operacje"]:
            st = op["stanowisko"]
            if st and st not in istniejace_stanowiska:
                try:
                    conn.execute(
                        "INSERT INTO stawki (stanowisko, stawka_godz, opis) VALUES (?, 0.0, ?)",
                        (st, f"Dodano automatycznie podczas importu {_now()[:10]}")
                    )
                    istniejace_stanowiska.add(st)
                    nowe_stanowiska.append(st)
                except Exception as e:
                    errors.append(f"Nie można dodać stanowiska {st}: {e}")

        # Utwórz operacje
        op_count = 0
        for op in parsed["operacje"]:
            try:
                qr_op = "OP-" + str(_uuid.uuid4())[:8].upper()
                # Dla zbrojenia – czas normy idzie do czas_zbrojenia_min
                czas_norma = op["czas_norma"] if op["typ_operacji"] != "zbrojenie_zewn" else 0.0
                czas_zbrojenia = op["czas_tpz_min"] if op["typ_operacji"] == "zbrojenie_zewn" else 0.0
                conn.execute(
                    """INSERT INTO operacje
                        (zlecenie_id, nazwa, kolejnosc, czas_norma, stanowisko,
                         opis_czynnosci, qr_code, czas_zbrojenia_min,
                         typ_operacji, parametry_kj, czas_tpz_min)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (zlecenie_id, op["nazwa"], op["kolejnosc"],
                     czas_norma, op["stanowisko"], op["opis_czynnosci"],
                     qr_op, czas_zbrojenia,
                     op["typ_operacji"], op["parametry_kj"], op["czas_tpz_min"])
                )
                op_count += 1
            except Exception as e:
                errors.append(f"Operacja {op['kolejnosc']} {op['nazwa']}: {e}")

    _threading.Thread(target=_db_backup_to_json, daemon=True).start()
    return {
        "zlecenie_id": zlecenie_id,
        "numer": parsed["numer"],
        "nazwa": parsed["nazwa"],
        "operacje_created": op_count,
        "nowe_stanowiska": nowe_stanowiska,
        "errors": errors,
    }


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
    typ: str = "operacja"   # operacja | nieprodukcyjna | inne_zlecenie
    opis_nieprodukcyjnej: Optional[str] = ""
    zlecenie_id_inne: Optional[int] = None  # dla typ='inne_zlecenie'
    sesja_glowna: int = 1   # 1=główna (liczy normę), 0=równoległa dodatkowa

class StopSesjaRequest(BaseModel):
    sesja_id: int
    ilosc_sztuk: int
    uwagi: Optional[str] = ""

class PauzaRequest(BaseModel):
    sesja_id: int
    powod: Optional[str] = ""

@app.get("/api/sesje/aktywne_operacja/{operacja_id}", dependencies=[Depends(verify_key)])
def get_aktywne_sesje_operacja(operacja_id: int):
    """Zwraca aktywne sesje dla danej operacji (do dialogu kontynuacji/wyboru głównej)."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT s.id, s.user_id, s.typ, s.start_time, s.sesja_glowna, s.pauzy,
                   u.full_name
            FROM sesje_pracy s
            JOIN users u ON s.user_id = u.id
            WHERE s.operacja_id=? AND s.status='aktywna'
            ORDER BY s.start_time
        """, (operacja_id,)).fetchall()
    return [dict(r) for r in rows]

@app.post("/api/sesje/start", dependencies=[Depends(verify_key)])
def start_sesja(req: StartSesjaRequest):
    now = _now()
    with get_db() as conn:
        if req.typ in ("operacja", "inne_zlecenie", "zbrojenie") and req.operacja_id:
            aktywne = conn.execute(
                """SELECT s.id, s.typ, s.user_id, s.sesja_glowna, u.full_name
                   FROM sesje_pracy s JOIN users u ON s.user_id=u.id
                   WHERE s.operacja_id=? AND s.status='aktywna'""",
                (req.operacja_id,)
            ).fetchall()

            zbrojenie_akt = [r for r in aktywne if r["typ"] == "zbrojenie"]
            operacja_akt  = [r for r in aktywne if r["typ"] in ("operacja", "inne_zlecenie")]

            # Zbrojenie blokuje operację i vice versa
            if req.typ == "zbrojenie":
                if zbrojenie_akt:
                    raise HTTPException(400, "Zbrojenie tej operacji jest już aktywne.")
                if operacja_akt:
                    raise HTTPException(400, "Operacja jest już w toku – nie można uruchomić zbrojenia.")
            elif req.typ in ("operacja", "inne_zlecenie"):
                if zbrojenie_akt:
                    raise HTTPException(400, "Trwa zbrojenie tej operacji – najpierw je zakończ.")
                # Sesje równoległe są dozwolone – frontend zarządza wyborem głównej
                # Jeśli sesja_glowna=1 a inna główna już istnieje → error
                if req.sesja_glowna == 1:
                    glowna_akt = [r for r in operacja_akt if r["sesja_glowna"] == 1]
                    if glowna_akt:
                        raise HTTPException(400,
                            f"GLOWNA_ZAJETA:{glowna_akt[0]['full_name']}:{glowna_akt[0]['id']}")
                # Ten sam pracownik nie może mieć dwóch sesji na tej samej operacji
                moja = [r for r in operacja_akt if r["user_id"] == req.user_id]
                if moja:
                    raise HTTPException(400, "Masz już aktywną sesję tej operacji.")

        cur = conn.execute(
            """INSERT INTO sesje_pracy
                   (operacja_id, user_id, typ, start_time, status, uwagi, zlecenie_id_inne, sesja_glowna)
               VALUES (?,?,?,?,?,?,?,?)""",
            (req.operacja_id, req.user_id, req.typ, now, "aktywna",
             req.opis_nieprodukcyjnej or "",
             req.zlecenie_id_inne if req.typ == "inne_zlecenie" else None,
             req.sesja_glowna)
        )
        sesja_id = cur.lastrowid
        if req.operacja_id and req.typ in ("operacja", "inne_zlecenie"):
            conn.execute(
                "UPDATE operacje SET status='w_toku' WHERE id=? AND status='oczekuje'",
                (req.operacja_id,)
            )
    _threading.Thread(target=_db_backup_to_json, daemon=True).start()
    return {"sesja_id": sesja_id, "start_time": now}

@app.post("/api/sesje/pauza/start", dependencies=[Depends(verify_key)])
def pauza_start(req: PauzaRequest):
    now = _now()
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
    _threading.Thread(target=_db_backup_to_json, daemon=True).start()
    return {"ok": True, "pauza_start": now}

@app.post("/api/sesje/pauza/stop", dependencies=[Depends(verify_key)])
def pauza_stop(req: PauzaRequest):
    now = _now()
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
    _threading.Thread(target=_db_backup_to_json, daemon=True).start()
    return {"ok": True, "pauza_koniec": now}

@app.post("/api/sesje/stop", dependencies=[Depends(verify_key)])
def stop_sesja(req: StopSesjaRequest):
    now = _now()
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
        if sesja["operacja_id"] and sesja["typ"] in ("operacja", "inne_zlecenie"):
            conn.execute(
                "UPDATE operacje SET ilosc_wykonana = ilosc_wykonana + ? WHERE id=?",
                (req.ilosc_sztuk, sesja["operacja_id"])
            )
        # dla zbrojenia – nic nie zmieniamy w operacji (nie liczy się jako sztuki)
            op = conn.execute(
                "SELECT o.ilosc_wykonana, z.ilosc_sztuk FROM operacje o JOIN zlecenia z ON o.zlecenie_id=z.id WHERE o.id=?",
                (sesja["operacja_id"],)
            ).fetchone()
            if op and op[0] >= op[1]:
                conn.execute("UPDATE operacje SET status='zakonczona' WHERE id=?", (sesja["operacja_id"],))
                zl_id = conn.execute("SELECT zlecenie_id FROM operacje WHERE id=?", (sesja["operacja_id"],)).fetchone()[0]
                pozostale = conn.execute(
                    "SELECT COUNT(*) FROM operacje WHERE zlecenie_id=? AND status NOT IN ('zakonczona','anulowane')",
                    (zl_id,)
                ).fetchone()[0]
                if pozostale == 0:
                    conn.execute(
                        "UPDATE zlecenia SET status='zakonczone' WHERE id=? AND status NOT IN ('zakonczone','anulowane')",
                        (zl_id,)
                    )

    _threading.Thread(target=_db_backup_to_json, daemon=True).start()
    return {"status": "ok", "end_time": now}

class EditSesjaTimeRequest(BaseModel):
    start_time: Optional[str] = None
    end_time: Optional[str] = None

@app.patch("/api/sesje/{sesja_id}/czas", dependencies=[Depends(verify_key)])
def edit_sesja_czas(sesja_id: int, req: EditSesjaTimeRequest):
    """Korekta czasu sesji – dostępna dla majstra i admina."""
    with get_db() as conn:
        sesja = conn.execute("SELECT * FROM sesje_pracy WHERE id=?", (sesja_id,)).fetchone()
        if not sesja:
            raise HTTPException(404, "Sesja nie istnieje")
        new_start = req.start_time or sesja["start_time"]
        new_end   = req.end_time   or sesja["end_time"]
        # Walidacja: start musi być przed end (jeśli end już ustawiony)
        if new_end:
            try:
                dt_start = _parse(new_start)
                dt_end   = _parse(new_end)
                if dt_end <= dt_start:
                    raise HTTPException(400, "Czas zakończenia musi być późniejszy niż rozpoczęcia")
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(400, "Nieprawidłowy format czasu")
        conn.execute(
            "UPDATE sesje_pracy SET start_time=?, end_time=? WHERE id=?",
            (new_start, new_end, sesja_id)
        )
    return {"status": "ok", "sesja_id": sesja_id, "start_time": new_start, "end_time": new_end}

@app.delete("/api/sesje/{sesja_id}", dependencies=[Depends(verify_key)])
def delete_sesja(sesja_id: int):
    """Usunięcie sesji pracy – dostępne dla majstra i admina."""
    with get_db() as conn:
        sesja = conn.execute("SELECT * FROM sesje_pracy WHERE id=?", (sesja_id,)).fetchone()
        if not sesja:
            raise HTTPException(404, "Sesja nie istnieje")
        if sesja["status"] == "aktywna":
            raise HTTPException(400, "Nie można usunąć aktywnej sesji – najpierw ją zakończ")
        conn.execute("DELETE FROM sesje_pracy WHERE id=?", (sesja_id,))
    return {"status": "ok", "deleted": sesja_id}

@app.get("/api/sesje/aktywne/{user_id}", dependencies=[Depends(verify_key)])
def get_aktywne_sesje(user_id: int):
    """Zwraca WSZYSTKIE aktywne sesje użytkownika (może być wiele)"""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT s.*, o.nazwa as op_nazwa, o.stanowisko,
                   COALESCE(z.numer, zi.numer) as zl_numer,
                   COALESCE(z.nazwa, zi.nazwa) as zl_nazwa
            FROM sesje_pracy s
            LEFT JOIN operacje o ON s.operacja_id = o.id
            LEFT JOIN zlecenia z ON o.zlecenie_id = z.id
            LEFT JOIN zlecenia zi ON s.zlecenie_id_inne = zi.id
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
    opis: Optional[str] = ""
    zbrojenie_aktywne: Optional[int] = 0
    zbrojenie_stawka_godz: Optional[float] = 0.0

@app.post("/api/stawki", dependencies=[Depends(verify_key)])
def create_stawka(req: StawkaRequest):
    with get_db() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO stawki (stanowisko,stawka_godz,opis,zbrojenie_aktywne,zbrojenie_stawka_godz) VALUES (?,?,?,?,?)",
                (req.stanowisko, req.stawka_godz, req.opis, req.zbrojenie_aktywne or 0, req.zbrojenie_stawka_godz or 0.0)
            )
            return {"id": cur.lastrowid}
        except sqlite3.IntegrityError:
            raise HTTPException(400, "Stanowisko już istnieje")

@app.put("/api/stawki/{sid}", dependencies=[Depends(verify_key)])
def update_stawka(sid: int, req: StawkaRequest):
    with get_db() as conn:
        conn.execute(
            "UPDATE stawki SET stanowisko=?,stawka_godz=?,opis=?,zbrojenie_aktywne=?,zbrojenie_stawka_godz=? WHERE id=?",
            (req.stanowisko, req.stawka_godz, req.opis, req.zbrojenie_aktywne or 0, req.zbrojenie_stawka_godz or 0.0, sid)
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


# ─── Uprawnienia użytkowników (dostęp do zakładek) ───────────────────────────
@app.get("/api/users/{uid}/permissions", dependencies=[Depends(verify_key)])
def get_user_permissions(uid: int):
    with get_db() as conn:
        row = conn.execute(
            "SELECT tabs FROM user_permissions WHERE user_id=?", (uid,)
        ).fetchone()
    if row:
        return {"user_id": uid, "tabs": json.loads(row["tabs"])}
    return {"user_id": uid, "tabs": []}

@app.get("/api/permissions/all", dependencies=[Depends(verify_key)])
def get_all_permissions():
    with get_db() as conn:
        rows = conn.execute("SELECT user_id, tabs FROM user_permissions").fetchall()
    return {r["user_id"]: json.loads(r["tabs"]) for r in rows}

class PermissionsRequest(BaseModel):
    tabs: List[str]

@app.put("/api/users/{uid}/permissions", dependencies=[Depends(verify_key)])
def set_user_permissions(uid: int, req: PermissionsRequest):
    with get_db() as conn:
        conn.execute("""
            INSERT INTO user_permissions (user_id, tabs, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET tabs=excluded.tabs, updated_at=excluded.updated_at
        """, (uid, json.dumps(req.tabs), _now()))
    return {"ok": True, "user_id": uid, "tabs": req.tabs}

@app.delete("/api/users/{uid}/permissions", dependencies=[Depends(verify_key)])
def reset_user_permissions(uid: int):
    with get_db() as conn:
        conn.execute("DELETE FROM user_permissions WHERE user_id=?", (uid,))
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
            SELECT s.start_time, s.pauzy, s.id as sesja_id, s.typ, s.uwagi,
                   u.full_name, u.id as user_id,
                   o.nazwa as op_nazwa, o.stanowisko, o.czas_norma,
                   o.ilosc_wykonana, o.id as op_id,
                   COALESCE(z.numer, zi.numer) as zl_numer,
                   COALESCE(z.nazwa, zi.nazwa) as zl_nazwa,
                   COALESCE(z.ilosc_sztuk, zi.ilosc_sztuk) as ilosc_sztuk
            FROM sesje_pracy s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN operacje o ON s.operacja_id = o.id
            LEFT JOIN zlecenia z ON o.zlecenie_id = z.id
            LEFT JOIN zlecenia zi ON s.zlecenie_id_inne = zi.id
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

        # postęp zleceń z detalami operacji
        # sztuki_wykonane = MIN(ilosc_wykonana) bo każda operacja musi być zrobiona dla każdej sztuki
        zlecenia = conn.execute("""
            SELECT z.id, z.numer, z.nazwa, z.status, z.ilosc_sztuk, z.termin,
                   z.cena_brutto_szt,
                   COUNT(o.id) as op_total,
                   SUM(CASE WHEN o.status='zakonczona' THEN 1 ELSE 0 END) as op_done,
                   MIN(o.ilosc_wykonana) as sztuki_wykonane
            FROM zlecenia z
            LEFT JOIN operacje o ON o.zlecenie_id = z.id
            WHERE z.status IN ('nowe','w_toku')
            GROUP BY z.id
            ORDER BY z.numer
        """).fetchall()

        wszystkie_zlecenia = conn.execute("""
            SELECT z.id, z.numer, z.nazwa, z.status, z.ilosc_sztuk, z.termin,
                   z.cena_brutto_szt,
                   COUNT(o.id) as op_total,
                   SUM(CASE WHEN o.status='zakonczona' THEN 1 ELSE 0 END) as op_done,
                   MIN(o.ilosc_wykonana) as sztuki_wykonane
            FROM zlecenia z
            LEFT JOIN operacje o ON o.zlecenie_id = z.id
            GROUP BY z.id
            ORDER BY z.id DESC
        """).fetchall()

        # alerty norm (sesje przekraczające normę całościową = czas_norma × ilosc_sztuk)
        alerty = conn.execute("""
            SELECT s.id as sesja_id, u.full_name, o.nazwa as op_nazwa,
                   o.czas_norma, s.start_time, s.pauzy,
                   z.numer as zl_numer, z.ilosc_sztuk
            FROM sesje_pracy s
            JOIN users u ON s.user_id = u.id
            JOIN operacje o ON s.operacja_id = o.id
            JOIN zlecenia z ON o.zlecenie_id = z.id
            WHERE s.status='aktywna' AND o.czas_norma > 0
        """).fetchall()
        alert_list = []
        for a in alerty:
            elapsed_min = (_dt.datetime.utcnow() - _parse(a["start_time"])).total_seconds() / 60
            # odejmij pauzy
            pauzy = json.loads(a["pauzy"] or "[]")
            for p in pauzy:
                if p.get("koniec"):
                    pause_sec = (_parse(p["koniec"]) -
                                 _parse(p["start"])).total_seconds()
                    elapsed_min -= pause_sec / 60
            # norma całkowita = czas_norma × liczba_sztuk
            ilosc_sztuk = max(1, a["ilosc_sztuk"] or 1)
            norma_calkowita = a["czas_norma"] * ilosc_sztuk
            if elapsed_min > norma_calkowita:  # alert dopiero po przekroczeniu pełnej normy
                alert_list.append({
                    "sesja_id": a["sesja_id"],
                    "pracownik": a["full_name"],
                    "operacja": a["op_nazwa"],
                    "zlecenie": a["zl_numer"],
                    "norma_min": a["czas_norma"],
                    "norma_calkowita_min": round(norma_calkowita, 1),
                    "ilosc_sztuk": ilosc_sztuk,
                    "elapsed_min": round(elapsed_min, 1),
                    "przekroczenie_pct": round((elapsed_min / norma_calkowita - 1) * 100)
                })

        # podsumowanie kosztów dzisiaj (operacje + zbrojenia)
        koszty = conn.execute("""
            SELECT s.user_id, u.full_name, o.stanowisko,
                   SUM(CASE WHEN s.typ='operacja' THEN
                     (strftime('%s', COALESCE(s.end_time, datetime('now'))) -
                      strftime('%s', s.start_time)) / 3600.0 * COALESCE(st.stawka_godz,0)
                   ELSE
                     (strftime('%s', COALESCE(s.end_time, datetime('now'))) -
                      strftime('%s', s.start_time)) / 3600.0 * COALESCE(st.zbrojenie_stawka_godz,0)
                   END) as koszt,
                   SUM((strftime('%s', COALESCE(s.end_time, datetime('now'))) -
                        strftime('%s', s.start_time)) / 3600.0) as godz
            FROM sesje_pracy s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN operacje o ON s.operacja_id = o.id
            LEFT JOIN stawki st ON o.stanowisko = st.stanowisko
            WHERE date(s.start_time) = date('now') AND s.typ IN ('operacja','zbrojenie')
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
            WHERE s.status='zakonczona' AND s.typ IN ('operacja','inne_zlecenie') AND {filter_sql}
            GROUP BY u.id ORDER BY sztuki DESC
        """).fetchall()

        wyniki = []
        for r in users_rows:
            sesje = conn.execute(f"""
                SELECT s.id, s.ilosc_sztuk, s.start_time, s.end_time, s.pauzy,
                       o.nazwa as op_nazwa, o.czas_norma, o.czas_zbrojenia_min, o.stanowisko,
                       z.numer as zl_numer, z.nazwa as zl_nazwa, s.typ,
                       COALESCE(st.stawka_godz,0) as stawka_godz,
                       COALESCE(st.zbrojenie_stawka_godz,0) as zbrojenie_stawka_godz
                FROM sesje_pracy s
                LEFT JOIN operacje o ON s.operacja_id = o.id
                LEFT JOIN zlecenia z ON o.zlecenie_id = z.id
                LEFT JOIN stawki st ON o.stanowisko = st.stanowisko
                WHERE s.user_id=? AND s.status='zakonczona' AND s.typ IN ('operacja','zbrojenie')
                  AND s.start_time IS NOT NULL AND s.end_time IS NOT NULL
                  AND {filter_sql}
                ORDER BY s.end_time DESC LIMIT 30
            """, (r["id"],)).fetchall()

            sesje_list = []
            normy_ok = 0
            normy_total = 0
            koszt_pracy = 0.0; koszt_zbrojenia = 0.0
            for s in sesje:
                try:
                    elapsed = (_parse(s["end_time"]) -
                               _parse(s["start_time"])).total_seconds() / 60
                except Exception:
                    continue
                pauzy = json.loads(s["pauzy"] or "[]")
                for p in pauzy:
                    if p.get("koniec"):
                        elapsed -= (_parse(p["koniec"]) -
                                    _parse(p["start"])).total_seconds() / 60
                elapsed = max(0.1, elapsed)
                czas_norma = s["czas_norma"]
                ilosc = s["ilosc_sztuk"] or 1
                czas_zbrojenia_min = s["czas_zbrojenia_min"] or 0
                if s["typ"] == "operacja" and czas_norma:
                    wyd_pct = round(czas_norma * ilosc / elapsed * 100)
                elif s["typ"] == "zbrojenie" and czas_zbrojenia_min:
                    wyd_pct = round(czas_zbrojenia_min / elapsed * 100)
                else:
                    wyd_pct = None
                if wyd_pct is not None:
                    normy_total += 1
                    if wyd_pct >= 90:
                        normy_ok += 1
                if s["typ"] == "operacja":
                    koszt_pracy += (elapsed / 60.0) * float(s["stawka_godz"] or 0)
                elif s["typ"] == "zbrojenie":
                    koszt_zbrojenia += (elapsed / 60.0) * float(s["zbrojenie_stawka_godz"] or 0)
                sesje_list.append({
                    "sesja_id": s["id"],
                    "op_nazwa": s["op_nazwa"],
                    "stanowisko": s["stanowisko"],
                    "zl_numer": s["zl_numer"],
                    "zl_nazwa": (dict(s).get("zl_nazwa") or s["zl_numer"]),
                    "ilosc_sztuk": s["ilosc_sztuk"],
                    "czas_min": round(elapsed, 1),
                    "norma_min": czas_norma,
                    "wyd_pct": wyd_pct,
                    "data": (s["end_time"] or "")[:10],
                    "start_time": s["start_time"],
                    "end_time": s["end_time"],
                    "typ": s["typ"],
                })

            wyniki.append({
                "user_id": r["id"],
                "full_name": r["full_name"],
                "sesji": r["sesji"],
                "sztuki": r["sztuki"],
                "godz": round(r["min_total"] / 60, 2),
                "normy_ok": normy_ok,
                "normy_total": normy_total,
                "koszt_pracy": round(koszt_pracy, 2),
                "koszt_zbrojenia": round(koszt_zbrojenia, 2),
                "koszt_total": round(koszt_pracy + koszt_zbrojenia, 2),
                "sesje": sesje_list,
            })

    return {"okres": okres, "pracownicy": wyniki}


# ─── Wydajność jednego pracownika (historia + statystyki) ─────────────────────
@app.get("/api/stats/wydajnosc/{user_id}", dependencies=[Depends(verify_key)])
def stats_wydajnosc_user(user_id: int, okres: str = "tydzien"):
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
            WHERE s.user_id=? AND s.status='zakonczona' AND s.typ IN ('operacja','inne_zlecenie') AND {filter_sql}
        """, (user_id,)).fetchone()

        sesje = conn.execute(f"""
            SELECT s.id, s.ilosc_sztuk, s.start_time, s.end_time, s.pauzy, s.typ,
                   o.nazwa as op_nazwa, o.czas_norma, o.czas_zbrojenia_min, o.stanowisko,
                   z.numer as zl_numer, z.nazwa as zl_nazwa
            FROM sesje_pracy s
            LEFT JOIN operacje o ON s.operacja_id = o.id
            LEFT JOIN zlecenia z ON o.zlecenie_id = z.id
            WHERE s.user_id=? AND s.status='zakonczona' AND s.typ IN ('operacja','zbrojenie')
              AND s.start_time IS NOT NULL AND s.end_time IS NOT NULL
              AND {filter_sql}
            ORDER BY s.end_time DESC
        """, (user_id,)).fetchall()

    sesje_list = []
    normy_ok = 0
    normy_total = 0
    for s in sesje:
        try:
            elapsed = (_parse(s["end_time"]) -
                       _parse(s["start_time"])).total_seconds() / 60
        except Exception:
            continue
        pauzy = json.loads(s["pauzy"] or "[]")
        for p in pauzy:
            if p.get("koniec"):
                elapsed -= (_parse(p["koniec"]) -
                            _parse(p["start"])).total_seconds() / 60
        elapsed = max(0.1, elapsed)
        czas_norma = s["czas_norma"]
        ilosc = s["ilosc_sztuk"] or 1
        czas_zbrojenia_min = s["czas_zbrojenia_min"] or 0
        if s["typ"] == "operacja" and czas_norma:
            wyd_pct = round(czas_norma * ilosc / elapsed * 100)
        elif s["typ"] == "zbrojenie" and czas_zbrojenia_min:
            wyd_pct = round(czas_zbrojenia_min / elapsed * 100)
        else:
            wyd_pct = None
        if wyd_pct is not None:
            normy_total += 1
            if wyd_pct >= 90:
                normy_ok += 1
        sesje_list.append({
            "sesja_id": s["id"],
            "op_nazwa": s["op_nazwa"],
            "stanowisko": s["stanowisko"],
            "zl_numer": s["zl_numer"],
            "zl_nazwa": s["zl_nazwa"],
            "ilosc_sztuk": s["ilosc_sztuk"],
            "czas_min": round(elapsed, 1),
            "norma_min": czas_norma if s["typ"] == "operacja" else czas_zbrojenia_min or None,
            "wyd_pct": wyd_pct,
            "typ": s["typ"],
            "data": (s["end_time"] or "")[:10],
            "start_time": s["start_time"],
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
    """Historia sesji pracy dla zlecenia (szczegóły dla majstra)."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT s.id, s.start_time, s.end_time, s.pauzy, s.ilosc_sztuk, s.uwagi, s.typ,
                   u.full_name, o.nazwa as op_nazwa, o.stanowisko, o.kolejnosc
            FROM sesje_pracy s
            JOIN users u ON s.user_id=u.id
            LEFT JOIN operacje o ON s.operacja_id=o.id
            WHERE o.zlecenie_id=? AND s.status='zakonczona'
            ORDER BY s.end_time DESC
        """, (zid,)).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/zlecenia/{zid}/szczegoly", dependencies=[Depends(verify_key)])
def get_zlecenie_szczegoly(zid: int):
    """Szczegóły zlecenia: historia sesji + koszt pracy + zysk."""
    with get_db() as conn:
        zlecenie = conn.execute("""
            SELECT z.*, (z.cena_brutto_szt * z.ilosc_sztuk) as wartosc_total
            FROM zlecenia z WHERE z.id=?
        """, (zid,)).fetchone()
        if not zlecenie:
            raise HTTPException(404, "Zlecenie nie znaleziono")

        # Sesje dla wszystkich operacji tego zlecenia + sesje "inne" powiązane z tym zleceniem
        sesje = conn.execute("""
            SELECT s.id, s.start_time, s.end_time, s.pauzy, s.ilosc_sztuk, s.uwagi, s.typ,
                   u.full_name, COALESCE(st.stawka_godz, 0) as stawka_godz,
                   COALESCE(o.nazwa, s.uwagi) as op_nazwa,
                   COALESCE(o.kolejnosc, 999) as kolejnosc,
                   COALESCE(o.stanowisko, '') as stanowisko,
                   COALESCE(o.czas_norma, 0) as czas_norma,
                   z2.numer as zl_numer
            FROM sesje_pracy s
            JOIN users u ON s.user_id=u.id
            LEFT JOIN operacje o ON s.operacja_id=o.id
            LEFT JOIN zlecenia z2 ON o.zlecenie_id=z2.id
            LEFT JOIN stawki st ON o.stanowisko=st.stanowisko
            WHERE (o.zlecenie_id=? OR s.zlecenie_id_inne=?) AND s.status='zakonczona'
            ORDER BY COALESCE(o.kolejnosc,999), s.end_time
        """, (zid, zid)).fetchall()

        # Oblicz koszt każdej sesji
        result_sesje = []
        koszt_total = 0.0
        for s in sesje:
            sd = dict(s)
            elapsed_sec = 0.0
            if sd['start_time'] and sd['end_time']:
                elapsed_sec = (_parse(sd['end_time']) - _parse(sd['start_time'])).total_seconds()
                for p in json.loads(sd['pauzy'] or '[]'):
                    if p.get('koniec'):
                        elapsed_sec -= (_parse(p['koniec']) - _parse(p['start'])).total_seconds()
                elapsed_sec = max(0, elapsed_sec)
            stawka = sd.get('stawka_godz') or 0
            koszt = (elapsed_sec / 3600.0) * float(stawka)
            sd['koszt_sesji'] = round(koszt, 2)
            sd['elapsed_sec'] = round(elapsed_sec, 1)
            koszt_total += koszt
            result_sesje.append(sd)

        # Produkty zlecenia
        produkty = conn.execute(
            "SELECT * FROM produkty_zlecenia WHERE zlecenie_id=? ORDER BY id",
            (zid,)
        ).fetchall()
        produkty_list = [dict(p) for p in produkty]
        koszt_produktow = sum(float(p['ilosc']) * float(p['cena']) for p in produkty_list)

    return {
        "sesje": result_sesje,
        "koszt_total": round(koszt_total, 2),
        "koszt_produktow": round(koszt_produktow, 2),
        "produkty": produkty_list,
        "wartosc": float(zlecenie['wartosc_total'] or 0),
    }

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
        # Pobierz sesje zbrojenia (osobne sesje typ='zbrojenie') dla tego zlecenia
        sesje_zbrojenie = conn.execute("""
            SELECT s.start_time, s.end_time, s.pauzy,
                   COALESCE(o.nazwa,'—') as op_nazwa,
                   COALESCE(st.zbrojenie_stawka_godz, 0) as zbr_stawka
            FROM sesje_pracy s
            LEFT JOIN operacje o ON s.operacja_id = o.id
            LEFT JOIN stawki st ON o.stanowisko = st.stanowisko
            WHERE o.zlecenie_id=? AND s.typ='zbrojenie' AND s.status='zakonczona'
        """, (zid,)).fetchall()

        koszt_zbrojenia_total = 0.0
        zbrojenia_info = []
        for sz in sesje_zbrojenie:
            if not sz["end_time"]: continue
            elapsed_zb = (_parse(sz["end_time"]) - _parse(sz["start_time"])).total_seconds() / 3600
            for p in json.loads(sz["pauzy"] or "[]"):
                if p.get("koniec"):
                    elapsed_zb -= (_parse(p["koniec"]) - _parse(p["start"])).total_seconds() / 3600
            elapsed_zb = max(0, elapsed_zb)
            koszt_zb = elapsed_zb * (sz["zbr_stawka"] or 0)
            koszt_zbrojenia_total += koszt_zb
            zbrojenia_info.append({
                "op_nazwa": sz["op_nazwa"],
                "czas_min": round(elapsed_zb * 60, 1),
                "stawka_godz": sz["zbr_stawka"],
                "koszt": round(koszt_zb, 2)
            })

        for s in sesje:
            elapsed = (_parse(s["end_time"]) -
                       _parse(s["start_time"])).total_seconds() / 3600
            # odejmij pauzy
            pauzy = json.loads(s["pauzy"] or "[]")
            for p in pauzy:
                if p.get("koniec"):
                    pause_sec = (_parse(p["koniec"]) -
                                 _parse(p["start"])).total_seconds()
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
        produkty = conn.execute(
            "SELECT * FROM produkty_zlecenia WHERE zlecenie_id=? ORDER BY id", (zid,)
        ).fetchall()
        produkty_list = [dict(p) for p in produkty]
        koszt_produktow = sum(float(p['ilosc']) * float(p['cena']) for p in produkty_list)
        total_koszty = total_koszt + koszt_produktow
        total_koszty_z_zbrojeniem = total_koszt + koszt_produktow + koszt_zbrojenia_total
        return {
            "zlecenie": dict(zl),
            "sesje": rows,
            "produkty": produkty_list,
            "total_godz": round(total_godz, 2),
            "total_koszt": round(total_koszt, 2),
            "koszt_produktow": round(koszt_produktow, 2),
            "koszt_zbrojenia": round(koszt_zbrojenia_total, 2),
            "zbrojenia": zbrojenia_info,
            "total_koszty": round(total_koszty_z_zbrojeniem, 2),
            "przychod": round(przychod, 2),
            "marza": round(przychod - total_koszty_z_zbrojeniem, 2),
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



# ─── Produkty zlecenia (zakupy/narzędzia) ────────────────────────────────────
class ProduktZleceniaRequest(BaseModel):
    zlecenie_id: int
    nazwa: str
    ilosc: float = 1
    cena: float = 0

@app.get("/api/zlecenia/{zid}/produkty", dependencies=[Depends(verify_key)])
def get_produkty_zlecenia(zid: int):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM produkty_zlecenia WHERE zlecenie_id=? ORDER BY id", (zid,)
        ).fetchall()
    return [dict(r) for r in rows]

@app.post("/api/zlecenia/{zid}/produkty", dependencies=[Depends(verify_key)])
def add_produkt_zlecenia(zid: int, req: ProduktZleceniaRequest):
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO produkty_zlecenia (zlecenie_id, nazwa, ilosc, cena) VALUES (?,?,?,?)",
            (zid, req.nazwa, req.ilosc, req.cena)
        )
        return {"id": cur.lastrowid}

@app.put("/api/zlecenia/{zid}/produkty/{pid}", dependencies=[Depends(verify_key)])
def update_produkt_zlecenia(zid: int, pid: int, req: ProduktZleceniaRequest):
    with get_db() as conn:
        conn.execute(
            "UPDATE produkty_zlecenia SET nazwa=?, ilosc=?, cena=? WHERE id=? AND zlecenie_id=?",
            (req.nazwa, req.ilosc, req.cena, pid, zid)
        )
    return {"ok": True}

@app.delete("/api/zlecenia/{zid}/produkty/{pid}", dependencies=[Depends(verify_key)])
def delete_produkt_zlecenia(zid: int, pid: int):
    with get_db() as conn:
        conn.execute("DELETE FROM produkty_zlecenia WHERE id=? AND zlecenie_id=?", (pid, zid))
    return {"ok": True}



# ─── Wydajność majstra – raport z dowolnego zakresu dat ──────────────────────
@app.get("/api/stats/wydajnosc_raport", dependencies=[Depends(verify_key)])
def stats_wydajnosc_raport(data_od: str = "", data_do: str = ""):
    """Wydajność pracowników w podanym zakresie dat (YYYY-MM-DD)."""
    if not data_od:
        data_od = (_dt.datetime.utcnow() - _dt.timedelta(days=30)).strftime("%Y-%m-%d")
    if not data_do:
        data_do = _dt.datetime.utcnow().strftime("%Y-%m-%d")
    filter_sql = f"date(s.end_time) BETWEEN '{data_od}' AND '{data_do}'"

    with get_db() as conn:
        users_rows = conn.execute(f"""
            SELECT u.id, u.full_name,
                   COUNT(CASE WHEN s.typ IN ('operacja','inne_zlecenie') THEN 1 END) as sesji,
                   COALESCE(SUM(CASE WHEN s.typ IN ('operacja','inne_zlecenie') THEN s.ilosc_sztuk ELSE 0 END),0) as sztuki,
                   COALESCE(SUM(CASE WHEN s.typ IN ('operacja','inne_zlecenie') THEN
                     (strftime('%s', s.end_time) - strftime('%s', s.start_time)) / 60.0 ELSE 0 END), 0) as min_roboczy,
                   COALESCE(SUM(CASE WHEN s.typ='zbrojenie' THEN
                     (strftime('%s', s.end_time) - strftime('%s', s.start_time)) / 60.0 ELSE 0 END), 0) as min_zbrojenie,
                   COALESCE(SUM(CASE WHEN s.typ='nieprodukcyjna' THEN
                     (strftime('%s', s.end_time) - strftime('%s', s.start_time)) / 60.0 ELSE 0 END), 0) as min_nieproduktywny,
                   COUNT(DISTINCT date(s.start_time)) as dni_pracy
            FROM sesje_pracy s
            JOIN users u ON s.user_id = u.id
            WHERE s.status='zakonczona' AND {filter_sql}
            GROUP BY u.id ORDER BY min_roboczy DESC
        """).fetchall()

        wyniki = []
        for r in users_rows:
            sesje = conn.execute(f"""
                SELECT s.ilosc_sztuk, s.start_time, s.end_time, s.pauzy, s.typ,
                       s.uwagi,
                       o.nazwa as op_nazwa, o.czas_norma, o.stanowisko,
                       z.numer as zl_numer,
                       zi.numer as zl_inne_numer,
                       COALESCE(st.stawka_godz, 0) as stawka_godz,
                       COALESCE(st.zbrojenie_stawka_godz, 0) as zbrojenie_stawka_godz
                FROM sesje_pracy s
                LEFT JOIN operacje o ON s.operacja_id = o.id
                LEFT JOIN zlecenia z ON o.zlecenie_id = z.id
                LEFT JOIN zlecenia zi ON s.zlecenie_id_inne = zi.id
                LEFT JOIN stawki st ON o.stanowisko = st.stanowisko
                WHERE s.user_id=? AND s.status='zakonczona' AND {filter_sql}
                ORDER BY s.end_time DESC
            """, (r["id"],)).fetchall()

            sesje_list = []
            normy_ok = 0; normy_total = 0
            koszt_pracy = 0.0; koszt_zbrojenia = 0.0
            # Agregaty do liczenia zbiorczej wydajności vs normy
            suma_norma_min = 0.0   # łączny czas normatywny (czas_norma × ilosc_sztuk)
            suma_fakty_min = 0.0   # łączny czas faktyczny sesji produkcyjnych z normą
            for s in sesje:
                elapsed = (_parse(s["end_time"]) - _parse(s["start_time"])).total_seconds() / 60
                pauzy = json.loads(s["pauzy"] or "[]")
                for p in pauzy:
                    if p.get("koniec"):
                        elapsed -= (_parse(p["koniec"]) - _parse(p["start"])).total_seconds() / 60
                elapsed = max(0.1, elapsed)
                czas_norma = s["czas_norma"]
                ilosc = s["ilosc_sztuk"] or 1
                sesja_glowna = s["sesja_glowna"] if s["sesja_glowna"] is not None else 1
                wyd_pct = round(czas_norma * ilosc / elapsed * 100) if czas_norma else None
                if s["typ"] in ("operacja", "inne_zlecenie"):
                    if sesja_glowna == 1 and czas_norma and czas_norma > 0:
                        # Tylko sesja główna wchodzi do licznika norm
                        normy_total += 1
                        suma_norma_min += czas_norma * ilosc
                        suma_fakty_min += elapsed
                        if wyd_pct is not None and wyd_pct >= 90:
                            normy_ok += 1
                # Koszt sesji
                if s["typ"] in ("operacja", "inne_zlecenie"):
                    if sesja_glowna == 1:
                        # Sesja główna: koszt = faktyczny czas × stawka
                        koszt_pracy += (elapsed / 60.0) * float(s["stawka_godz"] or 0)
                    else:
                        # Sesja dodatkowa: koszt = czas_norma × ilosc × stawka (normatywny)
                        if czas_norma and czas_norma > 0:
                            koszt_pracy += (czas_norma * ilosc / 60.0) * float(s["stawka_godz"] or 0)
                        else:
                            koszt_pracy += (elapsed / 60.0) * float(s["stawka_godz"] or 0)
                elif s["typ"] == "zbrojenie":
                    koszt_zbrojenia += (elapsed / 60.0) * float(s["zbrojenie_stawka_godz"] or 0)
                # Nazwa operacji i zlecenia zależnie od typu
                typ = s["typ"]
                if typ == "nieprodukcyjna":
                    display_op = s["uwagi"] or s["op_nazwa"] or "—"
                    display_zl = ""  # puste dla nieprodukcyjnych
                elif typ == "inne_zlecenie":
                    display_op = s["uwagi"] or s["op_nazwa"] or "—"
                    display_zl = s["zl_inne_numer"] or s["zl_numer"] or "—"
                elif typ == "zbrojenie":
                    display_op = (s["op_nazwa"] + " (zbr.)") if s["op_nazwa"] else "— (zbr.)"
                    display_zl = s["zl_numer"] or "—"
                else:
                    display_op = s["op_nazwa"] or "—"
                    display_zl = s["zl_numer"] or "—"
                sesje_list.append({
                    "op_nazwa": display_op,
                    "stanowisko": s["stanowisko"] or "—",
                    "zl_numer": display_zl,
                    "ilosc_sztuk": s["ilosc_sztuk"],
                    "czas_min": round(elapsed, 1),
                    "norma_min": czas_norma,
                    "wyd_pct": wyd_pct,
                    "typ": s["typ"],
                    "data": (s["end_time"] or "")[:10],
                    "sesja_glowna": sesja_glowna,
                })

            # Zbiorcza wydajność vs norma: ile % normy osiągnięto łącznie
            norma_wydajnosc_pct = round(suma_norma_min / suma_fakty_min * 100) if suma_fakty_min > 0 else None

            wyniki.append({
                "user_id": r["id"],
                "full_name": r["full_name"],
                "sesji": r["sesji"],
                "sztuki": r["sztuki"],
                "min_roboczy": round(r["min_roboczy"], 1),
                "min_zbrojenie": round(r["min_zbrojenie"], 1),
                "min_nieproduktywny": round(r["min_nieproduktywny"], 1),
                "dni_pracy": r["dni_pracy"],
                "normy_ok": normy_ok,
                "normy_total": normy_total,
                "norma_wydajnosc_pct": norma_wydajnosc_pct,  # zbiorcze % normy
                "suma_norma_min": round(suma_norma_min, 1),
                "suma_fakty_min": round(suma_fakty_min, 1),
                "koszt_pracy": round(koszt_pracy, 2),
                "koszt_zbrojenia": round(koszt_zbrojenia, 2),
                "koszt_total": round(koszt_pracy + koszt_zbrojenia, 2),
                "sesje": sesje_list,
            })
    return {"data_od": data_od, "data_do": data_do, "pracownicy": wyniki}

# ─── Raport zleceń PDF-data – dane dla wybranego okresu ──────────────────────
@app.get("/api/raporty/zlecenia", dependencies=[Depends(verify_key)])
def raport_zlecenia(data_od: str = "", data_do: str = ""):
    if not data_od:
        data_od = (_dt.datetime.utcnow() - _dt.timedelta(days=30)).strftime("%Y-%m-%d")
    if not data_do:
        data_do = _dt.datetime.utcnow().strftime("%Y-%m-%d")
    with get_db() as conn:
        zlecenia = conn.execute("""
            SELECT z.*, 
                   COUNT(DISTINCT o.id) as op_total,
                   COALESCE(SUM(o.ilosc_wykonana),0) as sztuki_done
            FROM zlecenia z
            LEFT JOIN operacje o ON o.zlecenie_id=z.id
            WHERE date(z.created_at) BETWEEN ? AND ?

            GROUP BY z.id ORDER BY z.id DESC
        """, (data_od, data_do)).fetchall()

        result = []
        for z in zlecenia:
            zid = z["id"]
            sesje = conn.execute("""
                SELECT s.start_time, s.end_time, s.pauzy, s.ilosc_sztuk, s.uwagi, s.typ,
                       u.full_name,
                       COALESCE(o.nazwa, s.uwagi) as op_nazwa,
                       COALESCE(o.kolejnosc, 999) as kolejnosc,
                       COALESCE(o.stanowisko, '') as stanowisko,
                       COALESCE(o.czas_norma, 0) as czas_norma,
                       COALESCE(st.stawka_godz,0) as stawka_godz,
                       COALESCE(st.zbrojenie_stawka_godz,0) as zbrojenie_stawka_godz
                FROM sesje_pracy s
                JOIN users u ON s.user_id=u.id
                LEFT JOIN operacje o ON s.operacja_id=o.id
                LEFT JOIN stawki st ON o.stanowisko=st.stanowisko
                WHERE (o.zlecenie_id=? OR s.zlecenie_id_inne=?) AND s.status='zakonczona'
                ORDER BY COALESCE(o.kolejnosc,999), s.end_time
            """, (zid, zid)).fetchall()

            sesje_list = []
            koszt_pracy = 0
            koszt_zbrojenia = 0.0
            for s in sesje:
                elapsed = (_parse(s["end_time"]) - _parse(s["start_time"])).total_seconds() / 3600
                pauzy = json.loads(s["pauzy"] or "[]")
                for p in pauzy:
                    if p.get("koniec"):
                        elapsed -= (_parse(p["koniec"]) - _parse(p["start"])).total_seconds() / 3600
                elapsed = max(0, elapsed)
                if s["typ"] == "zbrojenie":
                    koszt = round(elapsed * float(s["zbrojenie_stawka_godz"] or 0), 2)
                    koszt_zbrojenia += koszt
                else:
                    koszt = round(elapsed * float(s["stawka_godz"] or 0), 2)
                    koszt_pracy += koszt
                sesje_list.append({
                    "pracownik": s["full_name"],
                    "operacja": (s["op_nazwa"] + " (zbr.)" if s["typ"] == "zbrojenie" else s["op_nazwa"]) or "—",
                    "kolejnosc": s["kolejnosc"],
                    "typ": s["typ"],
                    "data": (s["end_time"] or "")[:16].replace("T"," "),
                    "czas_min": round(elapsed * 60, 1),
                    "ilosc_sztuk": s["ilosc_sztuk"],
                    "czas_norma": s["czas_norma"] or 0,
                    "koszt": koszt,
                    "uwagi": s["uwagi"] or "",
                })

            produkty = conn.execute(
                "SELECT * FROM produkty_zlecenia WHERE zlecenie_id=?", (zid,)
            ).fetchall()
            produkty_list = [dict(p) for p in produkty]
            koszt_produktow = sum(float(p["ilosc"])*float(p["cena"]) for p in produkty_list)
            wartosc = (z["cena_brutto_szt"] or 0) * (z["ilosc_sztuk"] or 0)
            koszt_total = koszt_pracy + koszt_zbrojenia + koszt_produktow
            zysk = wartosc - koszt_total

            result.append({
                "id": zid,
                "numer": z["numer"],
                "nazwa": z["nazwa"],
                "status": z["status"],
                "ilosc_sztuk": z["ilosc_sztuk"],
                "cena_szt": z["cena_brutto_szt"],
                "wartosc": round(wartosc, 2),
                "created_at": (z["created_at"] or "")[:10],
                "sesje": sesje_list,
                "produkty": produkty_list,
                "koszt_pracy": round(koszt_pracy, 2),
                "koszt_zbrojenia": round(koszt_zbrojenia, 2),
                "koszt_produktow": round(koszt_produktow, 2),
                "koszt_total": round(koszt_total, 2),
                "zysk": round(zysk, 2),
            })
    return {"data_od": data_od, "data_do": data_do, "zlecenia": result}


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

    # Migracja zlecenia – dodaj kolumnę model_3d_url jeśli nie istnieje
    try: c.execute("ALTER TABLE zlecenia ADD COLUMN model_3d_url TEXT DEFAULT NULL")
    except: pass

    c.execute("""CREATE TABLE IF NOT EXISTS operacje (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zlecenie_id INTEGER NOT NULL, nazwa TEXT NOT NULL,
        kolejnosc INTEGER DEFAULT 0, czas_norma REAL DEFAULT 0,
        stanowisko TEXT, status TEXT DEFAULT 'oczekuje', qr_code TEXT,
        ilosc_wykonana INTEGER DEFAULT 0, opis_czynnosci TEXT DEFAULT '',
        czas_zbrojenia_min REAL DEFAULT 0.0,
        FOREIGN KEY (zlecenie_id) REFERENCES zlecenia(id))""")
    # Migracja operacje
    try: c.execute("ALTER TABLE operacje ADD COLUMN czas_zbrojenia_min REAL DEFAULT 0.0")
    except: pass
    try: c.execute("ALTER TABLE operacje ADD COLUMN typ_operacji TEXT DEFAULT 'produkcja'")
    except: pass  # produkcja | kj | kooperacja | zbrojenie_zewn
    try: c.execute("ALTER TABLE operacje ADD COLUMN parametry_kj TEXT DEFAULT NULL")
    except: pass  # JSON lista parametrów KJ np. ["Wyrób: Niezgodny - Zgodny"]
    try: c.execute("ALTER TABLE operacje ADD COLUMN kj_wynik TEXT DEFAULT NULL")
    except: pass  # NULL | 'zgodny' | 'niezgodny'
    try: c.execute("ALTER TABLE operacje ADD COLUMN czas_tpz_min REAL DEFAULT 0.0")
    except: pass  # czas przygotowawczo-zakończeniowy (Tpz)

    c.execute("""CREATE TABLE IF NOT EXISTS sesje_pracy (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operacja_id INTEGER, user_id INTEGER NOT NULL,
        typ TEXT NOT NULL, start_time TIMESTAMP, end_time TIMESTAMP,
        pauzy TEXT DEFAULT '[]', ilosc_sztuk INTEGER DEFAULT 0,
        uwagi TEXT, status TEXT DEFAULT 'aktywna',
        zlecenie_id_inne INTEGER DEFAULT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id))""")

    # Migracja: dodaj kolumnę zlecenie_id_inne jeśli nie istnieje (dla starych baz)
    try:
        c.execute("ALTER TABLE sesje_pracy ADD COLUMN zlecenie_id_inne INTEGER DEFAULT NULL")
    except Exception:
        pass  # kolumna już istnieje

    c.execute("""CREATE TABLE IF NOT EXISTS stawki (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stanowisko TEXT UNIQUE NOT NULL, stawka_godz REAL NOT NULL,
        czas_norma_min REAL DEFAULT 0, opis TEXT DEFAULT '',
        zbrojenie_aktywne INTEGER DEFAULT 0,
        zbrojenie_stawka_godz REAL DEFAULT 0.0)""")
    # Migracja stawki
    for col, typ in [("zbrojenie_aktywne","INTEGER DEFAULT 0"), ("zbrojenie_stawka_godz","REAL DEFAULT 0.0")]:
        try: c.execute(f"ALTER TABLE stawki ADD COLUMN {col} {typ}")
        except: pass

    c.execute("""CREATE TABLE IF NOT EXISTS katalog_produktow (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nazwa TEXT UNIQUE NOT NULL, opis TEXT,
        ilosc_domyslna INTEGER DEFAULT 1, cena_szt REAL DEFAULT 0.0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""")

    c.execute("""CREATE TABLE IF NOT EXISTS produkty_zlecenia (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zlecenie_id INTEGER NOT NULL,
        nazwa TEXT NOT NULL,
        ilosc REAL DEFAULT 1,
        cena REAL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (zlecenie_id) REFERENCES zlecenia(id))""")

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

    # Migracja sesje_pracy – kolumna sesja_glowna (1=główna, 0=równoległa dodatkowa)
    try: c.execute("ALTER TABLE sesje_pracy ADD COLUMN sesja_glowna INTEGER DEFAULT 1")
    except: pass

    c.execute("""CREATE TABLE IF NOT EXISTS user_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        tabs TEXT NOT NULL DEFAULT '[]',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)""")

    conn.commit()
    conn.close()
    print(f"✓ Baza danych gotowa: {DB_PATH}")


# ─── System backupu i przywracania danych ─────────────────────────────────────
import threading as _threading

_TABLES_TO_BACKUP = [
    "zlecenia", "operacje", "sesje_pracy", "users", "stawki",
    "katalog_produktow", "produkty_zlecenia", "opcje_zlecen", "user_permissions"
]

# ── GitHub Gist helpers ────────────────────────────────────────────────────────

def _gist_get_id() -> str:
    """Zwraca ID Gista: env > plik cache > szuka po nazwie > pusty string."""
    if GIST_ID:
        return GIST_ID
    if os.path.exists(GIST_ID_FILE):
        try:
            return open(GIST_ID_FILE).read().strip()
        except Exception:
            pass
    # Szukaj istniejącego Gista po nazwie pliku
    if not GIST_TOKEN:
        return ""
    try:
        req = urllib.request.Request(
            "https://api.github.com/gists",
            headers={"Authorization": f"token {GIST_TOKEN}", "Accept": "application/vnd.github+json"}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            gists = json.loads(r.read())
        for g in gists:
            if "produkcja_backup.json" in g.get("files", {}):
                gid = g["id"]
                open(GIST_ID_FILE, "w").write(gid)
                print(f"✓ Znaleziono istniejący Gist: {gid}")
                return gid
    except Exception as e:
        print(f"  Gist search error: {e}")
    return ""

def _gist_save(data: dict) -> bool:
    """Zapisuje dane backupu do GitHub Gist (tworzy nowy lub aktualizuje istniejący)."""
    if not GIST_TOKEN:
        return False
    content = json.dumps(data, ensure_ascii=False, default=str)
    gist_id = _gist_get_id()
    try:
        payload = json.dumps({
            "description": "Produkcja DB backup – auto",
            "public": False,
            "files": {"produkcja_backup.json": {"content": content}}
        }).encode()
        if gist_id:
            # PATCH – aktualizuj istniejący
            req = urllib.request.Request(
                f"https://api.github.com/gists/{gist_id}",
                data=payload,
                method="PATCH",
                headers={
                    "Authorization": f"token {GIST_TOKEN}",
                    "Accept": "application/vnd.github+json",
                    "Content-Type": "application/json"
                }
            )
        else:
            # POST – utwórz nowy
            req = urllib.request.Request(
                "https://api.github.com/gists",
                data=payload,
                method="POST",
                headers={
                    "Authorization": f"token {GIST_TOKEN}",
                    "Accept": "application/vnd.github+json",
                    "Content-Type": "application/json"
                }
            )
        with urllib.request.urlopen(req, timeout=15) as r:
            resp = json.loads(r.read())
        new_id = resp.get("id", gist_id)
        if new_id and new_id != gist_id:
            open(GIST_ID_FILE, "w").write(new_id)
            print(f"✓ Gist utworzony: {new_id}")
        print(f"✓ Gist backup zapisany ({len(content)} B, {data.get('_ts','?')})")
        return True
    except Exception as e:
        print(f"✗ Błąd zapisu Gist: {e}")
        return False

def _gist_load() -> dict | None:
    """Pobiera dane backupu z GitHub Gist. Zwraca dict lub None."""
    if not GIST_TOKEN:
        return None
    gist_id = _gist_get_id()
    if not gist_id:
        print("  Gist: brak ID – nie można pobrać backupu")
        return None
    try:
        req = urllib.request.Request(
            f"https://api.github.com/gists/{gist_id}",
            headers={"Authorization": f"token {GIST_TOKEN}", "Accept": "application/vnd.github+json"}
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            resp = json.loads(r.read())
        file_info = resp.get("files", {}).get("produkcja_backup.json", {})
        raw_url = file_info.get("raw_url")
        if not raw_url:
            print("  Gist: brak pliku produkcja_backup.json")
            return None
        with urllib.request.urlopen(raw_url, timeout=15) as r:
            data = json.loads(r.read())
        print(f"✓ Gist backup pobrany (ts: {data.get('_ts','?')})")
        return data
    except Exception as e:
        print(f"✗ Błąd odczytu Gist: {e}")
        return None

# ── Główne funkcje backup/restore ─────────────────────────────────────────────

def _db_backup_to_json(path: str = None) -> dict:
    """Eksportuje wszystkie tabele – zapisuje lokalnie ORAZ do GitHub Gist."""
    path = path or BACKUP_PATH
    data = {"_ts": _now(), "_ver": "v18", "tables": {}}
    try:
        conn = sqlite3.connect(DB_PATH, timeout=10)
        conn.row_factory = sqlite3.Row
        for tbl in _TABLES_TO_BACKUP:
            try:
                rows = conn.execute(f"SELECT * FROM {tbl}").fetchall()
                data["tables"][tbl] = [dict(r) for r in rows]
            except Exception:
                data["tables"][tbl] = []
        conn.close()
        # Zapis lokalny (fallback gdy Gist niedostępny)
        try:
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, default=str)
            print(f"✓ Backup lokalny: {path}")
        except Exception as e:
            print(f"  Backup lokalny nieudany: {e}")
        # Zapis do Gist
        _gist_save(data)
    except Exception as e:
        print(f"✗ Błąd backupu: {e}")
    return data

def _db_restore_from_json(path: str = None) -> bool:
    """Przywraca dane z pliku JSON backupu do bazy SQLite."""
    path = path or BACKUP_PATH
    if not os.path.exists(path):
        print(f"  Brak pliku backupu: {path}")
        return False
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return _db_restore_from_dict(data)
    except Exception as e:
        print(f"✗ Błąd przywracania z pliku: {e}")
        return False

def _db_restore_from_dict(data: dict) -> bool:
    """Przywraca dane ze słownika (backupu) do bazy SQLite."""
    tables = data.get("tables", {})
    try:
        conn = sqlite3.connect(DB_PATH, timeout=10)
        conn.execute("PRAGMA foreign_keys = OFF")
        for tbl, rows in tables.items():
            if not rows:
                continue
            try:
                cols = list(rows[0].keys())
                placeholders = ",".join(["?" for _ in cols])
                col_list = ",".join(cols)
                conn.executemany(
                    f"INSERT OR REPLACE INTO {tbl} ({col_list}) VALUES ({placeholders})",
                    [[r.get(c) for c in cols] for r in rows]
                )
            except Exception as e:
                print(f"  Błąd przywracania tabeli {tbl}: {e}")
        conn.execute("PRAGMA foreign_keys = ON")
        conn.commit()
        conn.close()
        total = sum(len(v) for v in tables.values())
        aktywne = len([r for r in tables.get("sesje_pracy", []) if r.get("status") == "aktywna"])
        print(f"✓ Przywrócono {total} rekordów (ts: {data.get('_ts','?')})")
        if aktywne:
            print(f"  ↳ W tym {aktywne} aktywnych sesji pracy")
        return True
    except Exception as e:
        print(f"✗ Błąd przywracania: {e}")
        return False

def _auto_backup_loop():
    """Wątek tła – backup co BACKUP_INTERVAL sekund jeśli baza zmieniona."""
    import time as _time
    _time.sleep(60)  # pierwsze uruchomienie po 60s
    while True:
        try:
            db_mtime  = os.path.getmtime(DB_PATH) if os.path.exists(DB_PATH) else 0
            bak_mtime = os.path.getmtime(BACKUP_PATH) if os.path.exists(BACKUP_PATH) else 0
            if db_mtime > bak_mtime:
                _db_backup_to_json()
            elif db_mtime > 0 and (_time.time() - bak_mtime > 3600):
                _db_backup_to_json()
        except Exception as e:
            print(f"auto-backup loop error: {e}")
        _time.sleep(BACKUP_INTERVAL)

# ─── Endpointy backupu ────────────────────────────────────────────────────────
@app.get("/api/admin/backup", dependencies=[Depends(verify_key)])
def admin_backup():
    """Natychmiastowy backup bazy do pliku JSON. Zwraca podsumowanie."""
    data = _db_backup_to_json()
    summary = {tbl: len(rows) for tbl, rows in data.get("tables", {}).items()}
    return {"ok": True, "ts": data["_ts"], "path": BACKUP_PATH, "rows": summary}

@app.get("/api/admin/backup/download")
def admin_backup_download(
    x_api_key: str = "",
    x_api_key_h: str = Header(None, alias="x-api-key")
):
    """Pobierz plik backupu JSON (generowany w pamięci – działa bez dysku na Render)."""
    key = x_api_key or x_api_key_h or ""
    if key != API_KEY:
        raise HTTPException(403, "Nieprawidłowy klucz API")
    data = _db_backup_to_json()
    content = json.dumps(data, ensure_ascii=False, default=str, indent=2)
    return StreamingResponse(
        iter([content.encode("utf-8")]),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="produkcja_backup.json"'}
    )

@app.post("/api/admin/backup/restore", dependencies=[Depends(verify_key)])
async def admin_backup_restore(request: Request):
    """Przywróć dane z przesłanego pliku JSON backupu."""
    body = await request.body()
    if not body:
        # Przywróć z pliku lokalnego
        ok = _db_restore_from_json()
        return {"ok": ok, "source": "local_file"}
    # Przywróć z przesłanego JSON
    tmp_path = BACKUP_PATH + ".tmp"
    try:
        with open(tmp_path, "wb") as f:
            f.write(body)
        ok = _db_restore_from_json(tmp_path)
        os.remove(tmp_path)
        return {"ok": ok, "source": "uploaded"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.post("/api/admin/backup/restore-upload", dependencies=[Depends(verify_key)])
async def admin_backup_restore_upload(request: Request):
    """Przywróć dane z pliku JSON przesłanego przez klienta (z dysku użytkownika)."""
    try:
        body = await request.body()
        data = json.loads(body)
        ok = _db_restore_from_dict(data)
        if ok:
            rows = {k: len(v) if isinstance(v, list) else 1
                    for k, v in data.items() if not k.startswith("_")}
            return {"ok": True, "source": "disk_upload", "rows": rows}
        return {"ok": False, "error": "Przywracanie nie powiodło się"}
    except json.JSONDecodeError:
        return {"ok": False, "error": "Nieprawidłowy format JSON"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/api/admin/backup/status", dependencies=[Depends(verify_key)])
def admin_backup_status():
    """Status backupu: kiedy ostatni, rozmiar pliku, status Gist."""
    exists = os.path.exists(BACKUP_PATH)
    size = os.path.getsize(BACKUP_PATH) if exists else 0
    ts = None
    if exists:
        try:
            with open(BACKUP_PATH, "r") as f:
                d = json.load(f)
            ts = d.get("_ts")
        except Exception:
            pass
    gist_id = _gist_get_id() if GIST_TOKEN else None
    return {
        "backup_path": BACKUP_PATH,
        "db_path": DB_PATH,
        "backup_exists": exists,
        "backup_size_kb": round(size / 1024, 1),
        "backup_ts": ts,
        "backup_interval_sec": BACKUP_INTERVAL,
        "gist_enabled": bool(GIST_TOKEN),
        "gist_id": gist_id or None,
    }


@app.get("/api/oblozenie", dependencies=[Depends(verify_key)])
def get_oblozenie():
    """Zwraca oblozenie stanowisk: lista stanowisk + operacje z terminem i postepem."""
    with get_db() as conn:
        stawki_rows = conn.execute(
            "SELECT stanowisko, stawka_godz, opis FROM stawki ORDER BY stanowisko"
        ).fetchall()
        stawki_set = {r["stanowisko"]: dict(r) for r in stawki_rows}

        op_stanowiska = conn.execute("""
            SELECT DISTINCT o.stanowisko
            FROM operacje o JOIN zlecenia z ON o.zlecenie_id = z.id
            WHERE z.status IN ('nowe','w_realizacji')
              AND o.stanowisko IS NOT NULL AND o.stanowisko != ''
              AND o.status != 'zakonczona'
        """).fetchall()
        extra = [r["stanowisko"] for r in op_stanowiska if r["stanowisko"] not in stawki_set]

        ops = conn.execute("""
            SELECT o.id, o.nazwa, o.stanowisko, o.status, o.kolejnosc,
                   o.ilosc_wykonana, o.czas_norma,
                   z.id as zlecenie_id, z.numer, z.nazwa as zlecenie_nazwa,
                   z.termin, z.ilosc_sztuk, z.status as zlecenie_status
            FROM operacje o JOIN zlecenia z ON o.zlecenie_id = z.id
            WHERE z.status IN ('nowe','w_realizacji')
              AND o.status != 'zakonczona'
              AND o.stanowisko IS NOT NULL AND o.stanowisko != ''
            ORDER BY z.termin ASC, z.id ASC, o.kolejnosc ASC
        """).fetchall()

        stanowiska_ops = {}
        for o in ops:
            st = o["stanowisko"]
            if st not in stanowiska_ops:
                stanowiska_ops[st] = []
            stanowiska_ops[st].append({
                "op_id": o["id"], "op_nazwa": o["nazwa"], "op_status": o["status"],
                "op_kolejnosc": o["kolejnosc"], "ilosc_wykonana": o["ilosc_wykonana"],
                "czas_norma": o["czas_norma"], "zlecenie_id": o["zlecenie_id"],
                "zlecenie_numer": o["numer"], "zlecenie_nazwa": o["zlecenie_nazwa"],
                "zlecenie_status": o["zlecenie_status"],
                "termin": o["termin"], "ilosc_sztuk": o["ilosc_sztuk"],
            })

        result = []
        all_names = sorted(set(list(stawki_set.keys()) + extra))
        for name in all_names:
            info = stawki_set.get(name, {})
            result.append({
                "stanowisko": name, "stawka_godz": info.get("stawka_godz"),
                "opis": info.get("opis", ""), "in_stawki": name in stawki_set,
                "operacje": stanowiska_ops.get(name, []),
            })
        return result

# ─── Upload pliku STEP do Cloudinary ──────────────────────────────────────────
@app.post("/api/step-upload", dependencies=[Depends(verify_key)])
async def step_upload(request: Request):
    """Przyjmuje plik STEP (raw body), wgrywa na Cloudinary, zwraca URL do podglądu."""
    import hashlib as _hl, hmac as _hmac, base64 as _b64, time as _time
    if not (CLOUDINARY_CLOUD and CLOUDINARY_KEY and CLOUDINARY_SECRET):
        raise HTTPException(503, "Cloudinary nie skonfigurowany – dodaj CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET w zmiennych środowiskowych Render")

    body = await request.body()
    if not body:
        raise HTTPException(400, "Brak danych pliku")
    if len(body) > 100 * 1024 * 1024:
        raise HTTPException(413, "Plik za duży (maks. 100 MB)")

    # Parametry uploadu
    ts = str(int(_time.time()))
    public_id = "produkcja_step/step_" + _hl.md5(body[:1024]).hexdigest()[:12]

    # Podpis – parametry MUSZĄ być posortowane alfabetycznie, bez resource_type w stringu
    sign_params = f"public_id={public_id}&timestamp={ts}"
    sig = _hl.sha1(f"{sign_params}{CLOUDINARY_SECRET}".encode()).hexdigest()

    # Multipart upload
    boundary = "----CLD" + _hl.md5(ts.encode()).hexdigest()[:16]
    def _field(name, value):
        return f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode()

    fname = request.headers.get("x-filename", "model.step")
    try:
        import urllib.parse as _up
        fname = _up.unquote(fname)
    except Exception:
        pass

    multipart = (
        _field("api_key", CLOUDINARY_KEY) +
        _field("timestamp", ts) +
        _field("signature", sig) +
        _field("public_id", public_id) +
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{fname}\"\r\nContent-Type: application/octet-stream\r\n\r\n".encode() +
        body + f"\r\n--{boundary}--\r\n".encode()
    )

    try:
        req = urllib.request.Request(
            f"https://api.cloudinary.com/v1_1/{CLOUDINARY_CLOUD}/raw/upload",
            data=multipart,
            method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            resp = json.loads(r.read())
        url = resp.get("secure_url", "")
        if not url:
            raise HTTPException(500, "Cloudinary nie zwrócił URL")
        return {"ok": True, "url": url, "public_id": resp.get("public_id"), "bytes": resp.get("bytes")}
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        raise HTTPException(502, f"Cloudinary error: {err}")
    except Exception as e:
        raise HTTPException(502, f"Upload error: {e}")

# ─── Proxy pobierania pliku STEP (omija CORS dla Google Drive / OneDrive) ─────
@app.get("/api/step-proxy")
async def step_proxy(url: str):
    """Pobiera plik STEP z zewnętrznego URL i przesyła do przeglądarki.
    Obsługuje linki Google Drive (konwertuje na link bezpośredniego pobrania)."""
    import re as _re
    # Konwersja linku Google Drive: /file/d/ID/view → /uc?export=download&id=ID
    gdrive = _re.search(r'drive\.google\.com/file/d/([^/?]+)', url)
    if gdrive:
        file_id = gdrive.group(1)
        url = f"https://drive.google.com/uc?export=download&id={file_id}"
    # Konwersja linku OneDrive: ?e=xxx → dodaj &download=1
    elif 'onedrive.live.com' in url or '1drv.ms' in url:
        sep = '&' if '?' in url else '?'
        url = url + sep + 'download=1'
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "*/*",
            "Cache-Control": "no-cache"
        })
        # Streaming – czytamy chunkami żeby nie blokować na dużych plikach
        response = urllib.request.urlopen(req, timeout=120)
        ct = response.headers.get("Content-Type", "application/octet-stream")
        # Jeśli dostaliśmy HTML (redirect/captcha) – to błąd
        if "text/html" in ct:
            response.close()
            raise HTTPException(502, "Plik niedostępny – serwer zwrócił stronę HTML zamiast pliku STEP")

        def _stream():
            try:
                while True:
                    chunk = response.read(65536)  # 64KB chunks
                    if not chunk: break
                    yield chunk
            finally:
                response.close()

        return StreamingResponse(
            _stream(),
            media_type="application/octet-stream",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Content-Disposition": "inline; filename=model.step",
                "Cache-Control": "public, max-age=3600",
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Nie można pobrać pliku STEP: {e}")

# ─── Serwowanie aplikacji ──────────────────────────────────────────────────────
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(STATIC_DIR, exist_ok=True)

# Wersja buildu – używana do cache-bustingu (zmienia się przy każdym deployu)
BUILD_VERSION = os.environ.get("BUILD_VERSION", _dt.datetime.utcnow().strftime("%Y%m%d%H%M%S"))

@app.get("/app", response_class=HTMLResponse)
@app.get("/app/", response_class=HTMLResponse)
def serve_app():
    """Serwuje index.html z nagłówkami no-cache – wymusza odświeżenie po każdym deployu."""
    html_path = os.path.join(STATIC_DIR, "index.html")
    if not os.path.exists(html_path):
        raise HTTPException(404, "Brak pliku index.html")
    with open(html_path, "r", encoding="utf-8") as f:
        content = f.read()
    return HTMLResponse(
        content=content,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
            "ETag": f'"{BUILD_VERSION}"',
        }
    )

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

# Przywróć dane z backupu jeśli baza jest pusta (nowy kontener po restarcie)
try:
    _conn_chk = sqlite3.connect(DB_PATH, timeout=5)
    _row_count = _conn_chk.execute("SELECT COUNT(*) FROM zlecenia").fetchone()[0]
    _conn_chk.close()
    if _row_count == 0:
        print("⚠ Baza pusta – próbuję przywrócić dane...")
        _restored = False
        # 1. Najpierw spróbuj GitHub Gist (przeżywa restarty kontenera)
        if GIST_TOKEN:
            _gist_data = _gist_load()
            if _gist_data:
                init_db_on_start()  # upewnij się że tabele istnieją
                _restored = _db_restore_from_dict(_gist_data)
                if _restored:
                    # Zapisz lokalnie jako cache na wypadek braku sieci
                    try:
                        with open(BACKUP_PATH, "w", encoding="utf-8") as _f:
                            json.dump(_gist_data, _f, ensure_ascii=False, default=str)
                    except Exception:
                        pass
                    print("✓ Dane przywrócone z GitHub Gist")
        # 2. Fallback: lokalny plik (działa tylko gdy kontener ma persystentny dysk)
        if not _restored and os.path.exists(BACKUP_PATH):
            _restored = _db_restore_from_json()
            if _restored:
                print("✓ Dane przywrócone z lokalnego backupu")
        if not _restored:
            print("  Brak backupu – serwer startuje z pustą bazą")
    else:
        print(f"✓ Baza zawiera {_row_count} zleceń – backup nie jest potrzebny")
except Exception as _e:
    print(f"⚠ Nie sprawdzono stanu bazy: {_e}")

# Uruchom wątek auto-backup w tle
_bk_thread = _threading.Thread(target=_auto_backup_loop, daemon=True, name="auto-backup")
_bk_thread.start()
print(f"✓ Auto-backup uruchomiony co {BACKUP_INTERVAL}s → {BACKUP_PATH}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
