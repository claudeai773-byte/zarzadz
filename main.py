"""
Serwer FastAPI dla Systemu Zarządzania Produkcją
Deploy na Railway.app (darmowy plan)
"""

from fastapi import FastAPI, HTTPException, Header, Depends, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Any, Optional
import sqlite3, os, json, hashlib, time
from contextlib import contextmanager

# ─── Konfiguracja ──────────────────────────────────────────────────────────────
# Railway daje /data jako persistent volume (dodaj w Railway → Variables)
DB_PATH  = os.environ.get("DB_PATH",  "/data/produkcja.db")
API_KEY  = os.environ.get("API_KEY",  "zmien-mnie-na-bezpieczny-klucz")
PORT     = int(os.environ.get("PORT", 8000))

# Fallback dla lokalnych testów
if not os.path.exists(os.path.dirname(DB_PATH)):
    DB_PATH = os.path.join(os.path.dirname(__file__), "produkcja.db")

app = FastAPI(title="Produkcja API", version="3.0")

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

# ─── SQL Proxy (dla aplikacji PC – drop-in replacement) ────────────────────────
class SQLRequest(BaseModel):
    sql: str
    params: List[Any] = []
    write: bool = False
    many: bool = False
    params_list: List[List[Any]] = []

class TransactionRequest(BaseModel):
    operations: List[dict]  # [{sql, params}]

@app.post("/sql", dependencies=[Depends(verify_key)])
def execute_sql(req: SQLRequest):
    """
    Proxy SQL – używany przez aplikację PC (RemoteConnection).
    Każda operacja jest atomowa (auto-commit).
    """
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
    """
    Transakcja atomowa – wiele operacji w jednym commicie.
    Zwraca lastrowid każdej operacji.
    """
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


# ─── REST API dla aplikacji mobilnej ──────────────────────────────────────────

# Auth
class LoginRequest(BaseModel):
    username: str
    password: str

def _hash(p): return hashlib.sha256(p.encode()).hexdigest()

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


# Zlecenia
@app.get("/api/zlecenia")
def get_zlecenia(status: Optional[str] = None, _=Depends(verify_key)):
    with get_db() as conn:
        if status:
            rows = conn.execute(
                "SELECT * FROM zlecenia WHERE status=? ORDER BY created_at DESC", (status,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM zlecenia ORDER BY created_at DESC"
            ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/zlecenia/{zid}/operacje")
def get_operacje(zid: int, _=Depends(verify_key)):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM operacje WHERE zlecenie_id=? ORDER BY kolejnosc", (zid,)
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/operacje/aktywne")
def get_aktywne_operacje(_=Depends(verify_key)):
    """Operacje dostępne do pracy (oczekuje lub w_toku)"""
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


@app.get("/api/operacje/zakonczone-do-transportu")
def get_zakonczone_transport(_=Depends(verify_key)):
    """Dla magazyniera – operacje zakończone czekające na transport"""
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


# Sesje pracy
class StartSesjaRequest(BaseModel):
    operacja_id: int
    user_id: int
    typ: str = "operacja"

class StopSesjaRequest(BaseModel):
    sesja_id: int
    ilosc_sztuk: int
    uwagi: Optional[str] = ""

@app.post("/api/sesje/start", dependencies=[Depends(verify_key)])
def start_sesja(req: StartSesjaRequest):
    import datetime
    now = datetime.datetime.now().isoformat()
    with get_db() as conn:
        # Sprawdź czy nie ma aktywnej sesji dla tego użytkownika
        existing = conn.execute(
            "SELECT id FROM sesje_pracy WHERE user_id=? AND status='aktywna'",
            (req.user_id,)
        ).fetchone()
        if existing:
            raise HTTPException(400, "Masz już aktywną sesję. Zakończ ją najpierw.")

        cur = conn.execute(
            "INSERT INTO sesje_pracy (operacja_id, user_id, typ, start_time, status) VALUES (?,?,?,?,?)",
            (req.operacja_id, req.user_id, req.typ, now, "aktywna")
        )
        sesja_id = cur.lastrowid
        # Ustaw operację na 'w_toku'
        conn.execute(
            "UPDATE operacje SET status='w_toku' WHERE id=? AND status='oczekuje'",
            (req.operacja_id,)
        )
    return {"sesja_id": sesja_id, "start_time": now}


@app.post("/api/sesje/stop", dependencies=[Depends(verify_key)])
def stop_sesja(req: StopSesjaRequest):
    import datetime
    now = datetime.datetime.now().isoformat()
    with get_db() as conn:
        sesja = conn.execute(
            "SELECT * FROM sesje_pracy WHERE id=?", (req.sesja_id,)
        ).fetchone()
        if not sesja:
            raise HTTPException(404, "Sesja nie znaleziona")

        conn.execute(
            "UPDATE sesje_pracy SET end_time=?, ilosc_sztuk=?, uwagi=?, status='zakonczona' WHERE id=?",
            (now, req.ilosc_sztuk, req.uwagi, req.sesja_id)
        )
        # Zaktualizuj ilosc_wykonana w operacji
        conn.execute(
            "UPDATE operacje SET ilosc_wykonana = ilosc_wykonana + ? WHERE id=?",
            (req.ilosc_sztuk, sesja["operacja_id"])
        )
        # Sprawdź czy operacja jest ukończona
        op = conn.execute(
            "SELECT o.ilosc_wykonana, z.ilosc_sztuk FROM operacje o JOIN zlecenia z ON o.zlecenie_id=z.id WHERE o.id=?",
            (sesja["operacja_id"],)
        ).fetchone()
        if op and op[0] >= op[1]:
            conn.execute(
                "UPDATE operacje SET status='zakonczona' WHERE id=?",
                (sesja["operacja_id"],)
            )

    return {"status": "ok", "end_time": now}


@app.get("/api/sesje/aktywna/{user_id}", dependencies=[Depends(verify_key)])
def get_aktywna_sesja(user_id: int):
    with get_db() as conn:
        row = conn.execute("""
            SELECT s.*, o.nazwa as op_nazwa, o.stanowisko,
                   z.numer as zl_numer, z.nazwa as zl_nazwa
            FROM sesje_pracy s
            JOIN operacje o ON s.operacja_id = o.id
            JOIN zlecenia z ON o.zlecenie_id = z.id
            WHERE s.user_id=? AND s.status='aktywna'
        """, (user_id,)).fetchone()
    return dict(row) if row else None


@app.get("/api/sesje/historia/{user_id}", dependencies=[Depends(verify_key)])
def get_historia(user_id: int):
    with get_db() as conn:
        rows = conn.execute("""
            SELECT s.*, o.nazwa as op_nazwa, o.stanowisko,
                   z.numer as zl_numer, z.nazwa as zl_nazwa
            FROM sesje_pracy s
            LEFT JOIN operacje o ON s.operacja_id = o.id
            LEFT JOIN zlecenia z ON o.zlecenie_id = z.id
            WHERE s.user_id=? AND s.status='zakonczona'
            ORDER BY s.end_time DESC LIMIT 50
        """, (user_id,)).fetchall()
    return [dict(r) for r in rows]


# Stawki
@app.get("/api/stawki", dependencies=[Depends(verify_key)])
def get_stawki():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM stawki ORDER BY stanowisko").fetchall()
    return [dict(r) for r in rows]


# Użytkownicy (admin)
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


# Powiadomienia
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


# Statystyki dla majstra
@app.get("/api/stats/majster", dependencies=[Depends(verify_key)])
def majster_stats():
    with get_db() as conn:
        # Aktywne sesje
        aktywne = conn.execute("""
            SELECT s.start_time, u.full_name, o.nazwa as op_nazwa,
                   o.stanowisko, z.numer as zl_numer, z.nazwa as zl_nazwa,
                   s.id as sesja_id
            FROM sesje_pracy s
            JOIN users u ON s.user_id = u.id
            JOIN operacje o ON s.operacja_id = o.id
            JOIN zlecenia z ON o.zlecenie_id = z.id
            WHERE s.status='aktywna'
            ORDER BY s.start_time
        """).fetchall()

        # Dzisiaj ukończone
        dzis = conn.execute("""
            SELECT COUNT(*) as cnt, SUM(s.ilosc_sztuk) as sztuki
            FROM sesje_pracy s
            WHERE s.status='zakonczona'
              AND date(s.end_time) = date('now')
        """).fetchone()

        # Postęp zleceń
        zlecenia = conn.execute("""
            SELECT z.numer, z.nazwa, z.status, z.ilosc_sztuk,
                   COUNT(o.id) as op_total,
                   SUM(CASE WHEN o.status='zakonczona' THEN 1 ELSE 0 END) as op_done
            FROM zlecenia z
            LEFT JOIN operacje o ON o.zlecenie_id = z.id
            WHERE z.status IN ('nowe','w_toku')
            GROUP BY z.id
            ORDER BY z.numer
        """).fetchall()

    return {
        "aktywne_sesje": [dict(r) for r in aktywne],
        "dzis_sesji": dzis[0] if dzis else 0,
        "dzis_sztuk": dzis[1] or 0,
        "zlecenia": [dict(r) for r in zlecenia]
    }


# ─── Inicjalizacja bazy danych ────────────────────────────────────────────────
def init_db_on_start():
    """Tworzy tabele i dane startowe przy pierwszym uruchomieniu."""
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


# ─── Serwowanie aplikacji mobilnej ────────────────────────────────────────────
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(STATIC_DIR, exist_ok=True)

if os.path.exists(os.path.join(STATIC_DIR, "index.html")):
    app.mount("/app", StaticFiles(directory=STATIC_DIR, html=True), name="static")

@app.get("/", response_class=HTMLResponse)
def root():
    return """
    <html><body style="font-family:monospace;background:#1a1f2e;color:#e8eaf0;padding:40px">
    <h2>⚙ Produkcja API v3.0</h2>
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
