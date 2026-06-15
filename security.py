"""
security.py – Moduł zabezpieczeń dla Systemu Zarządzania Produkcją
==================================================================
Zastępuje/uzupełnia mechanizmy bezpieczeństwa w main.py.

UŻYCIE W main.py:
  from security import (
      hash_password, verify_password,
      create_session, verify_session, revoke_session,
      verify_key, verify_admin,
      RateLimiter, rate_limit_login,
      SecurityHeaders, get_allowed_origins,
      AuditLogger, audit,
      sanitize_sql_readonly,
  )

WYMAGANE PACZKI (dodaj do requirements.txt):
  bcrypt==4.1.3
  python-jose[cryptography]==3.3.0
"""

import os, time, hashlib, secrets, json, logging, re
from datetime import datetime, timedelta
from collections import defaultdict
from functools import wraps
from typing import Optional

import bcrypt
from fastapi import HTTPException, Header, Request, Depends
from fastapi.responses import JSONResponse

# ══════════════════════════════════════════════════════════════════════════════
# 1. KONFIGURACJA BEZPIECZEŃSTWA
# ══════════════════════════════════════════════════════════════════════════════

API_KEY          = os.environ.get("API_KEY", "")
SESSION_SECRET   = os.environ.get("SESSION_SECRET", secrets.token_hex(32))
ALLOWED_ORIGINS  = os.environ.get("ALLOWED_ORIGINS", "")   # np. "https://moja-app.railway.app"
SESSION_TTL_SEC  = int(os.environ.get("SESSION_TTL_SEC", 8 * 3600))   # 8h domyślnie
MAX_LOGIN_TRIES  = int(os.environ.get("MAX_LOGIN_TRIES", 5))
LOGIN_BLOCK_SEC  = int(os.environ.get("LOGIN_BLOCK_SEC", 300))         # 5 min blokady

# Walidacja klucza API przy starcie
if not API_KEY or API_KEY == "zmien-mnie-na-bezpieczny-klucz":
    import sys
    print(
        "\n[BŁĄD BEZPIECZEŃSTWA] Zmienna środowiskowa API_KEY nie jest ustawiona "
        "lub ma wartość domyślną.\n"
        "Ustaw ją np.:  API_KEY=$(openssl rand -hex 32)\n",
        file=sys.stderr
    )
    # W trybie produkcyjnym zatrzymaj serwer
    if os.environ.get("ENVIRONMENT", "").lower() in ("production", "prod", "railway"):
        sys.exit(1)

# ══════════════════════════════════════════════════════════════════════════════
# 2. HASZOWANIE HASEŁ – bcrypt (zamiast SHA-256)
# ══════════════════════════════════════════════════════════════════════════════

def hash_password(plain: str) -> str:
    """Haszuje hasło bcryptem (12 rund). Zwraca string do zapisu w DB."""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(plain: str, stored: str) -> bool:
    """Weryfikuje hasło. Obsługuje stare SHA-256 (migracja) i nowe bcrypt."""
    if not plain or not stored:
        return False
    # Nowy format bcrypt
    if stored.startswith("$2b$") or stored.startswith("$2a$"):
        return bcrypt.checkpw(plain.encode("utf-8"), stored.encode("utf-8"))
    # Stary format SHA-256 – zwróć True, ale zasygnalizuj potrzebę migracji
    return hashlib.sha256(plain.encode()).hexdigest() == stored


def needs_rehash(stored: str) -> bool:
    """Zwraca True jeśli hasło wymaga migracji z SHA-256 na bcrypt."""
    return not (stored.startswith("$2b$") or stored.startswith("$2a$"))


# ══════════════════════════════════════════════════════════════════════════════
# 3. SESJE SERWEROWE (token w pamięci – zastępuje API_KEY w logins)
# ══════════════════════════════════════════════════════════════════════════════

# Format: { token: {"user_id": int, "role": str, "username": str, "expires": float, "ip": str} }
_sessions: dict[str, dict] = {}


def create_session(user_id: int, username: str, role: str, ip: str = "") -> str:
    """Tworzy sesję i zwraca unikalny token (64-znakowy hex)."""
    token = secrets.token_hex(32)
    _sessions[token] = {
        "user_id":  user_id,
        "username": username,
        "role":     role,
        "expires":  time.time() + SESSION_TTL_SEC,
        "ip":       ip,
        "created":  time.time(),
    }
    _cleanup_sessions()
    return token


def verify_session(token: str, ip: str = "") -> dict:
    """
    Weryfikuje token sesji. Rzuca HTTPException 401 jeśli nieważny.
    Zwraca dict z danymi użytkownika.
    """
    sess = _sessions.get(token)
    if not sess:
        raise HTTPException(401, "Sesja wygasła lub nieważna. Zaloguj się ponownie.")
    if time.time() > sess["expires"]:
        del _sessions[token]
        raise HTTPException(401, "Sesja wygasła. Zaloguj się ponownie.")
    # Opcjonalne: sprawdź IP (wyłącz jeśli użytkownicy mają dynamic IP)
    # if sess["ip"] and ip and sess["ip"] != ip:
    #     raise HTTPException(401, "Sesja unieważniona (zmiana IP).")
    # Przedłuż sesję przy aktywności
    sess["expires"] = time.time() + SESSION_TTL_SEC
    return sess


def revoke_session(token: str):
    """Wylogowanie – usuwa sesję."""
    _sessions.pop(token, None)


def revoke_all_user_sessions(user_id: int):
    """Unieważnia wszystkie sesje danego użytkownika (np. po resecie hasła)."""
    to_del = [t for t, s in _sessions.items() if s["user_id"] == user_id]
    for t in to_del:
        del _sessions[t]


def get_active_sessions() -> list[dict]:
    """Zwraca listę aktywnych sesji (dla admina)."""
    now = time.time()
    return [
        {
            "username":  s["username"],
            "role":      s["role"],
            "ip":        s.get("ip", ""),
            "created":   datetime.fromtimestamp(s["created"]).isoformat(),
            "expires_in_min": round((s["expires"] - now) / 60, 1),
        }
        for t, s in _sessions.items()
        if s["expires"] > now
    ]


def _cleanup_sessions():
    """Usuwa wygasłe sesje (wołana przy każdym tworzeniu nowej)."""
    now = time.time()
    expired = [t for t, s in _sessions.items() if s["expires"] <= now]
    for t in expired:
        del _sessions[t]


# ══════════════════════════════════════════════════════════════════════════════
# 4. ZALEŻNOŚCI FastAPI – auth + role
# ══════════════════════════════════════════════════════════════════════════════

def verify_key(x_api_key: str = Header(..., alias="x-api-key")):
    """Sprawdza klucz API (dla backendu / integracji)."""
    if not API_KEY or x_api_key != API_KEY:
        raise HTTPException(401, "Nieprawidłowy klucz API")
    return True


def get_session_user(
    request: Request,
    x_session_token: Optional[str] = Header(None, alias="x-session-token"),
):
    """
    Dependency: wyciąga użytkownika z nagłówka X-Session-Token.
    Rzuca 401 jeśli brak lub nieważny token.
    """
    if not x_session_token:
        raise HTTPException(401, "Brak tokenu sesji. Zaloguj się.")
    ip = request.client.host if request.client else ""
    return verify_session(x_session_token, ip)


def require_role(*allowed_roles: str):
    """
    Dependency factory: sprawdza czy zalogowany użytkownik ma wymaganą rolę.
    Przykład:  dependencies=[Depends(require_role("admin"))]
    """
    def _check(session: dict = Depends(get_session_user)):
        if session.get("role") not in allowed_roles:
            raise HTTPException(403, f"Brak uprawnień. Wymagana rola: {', '.join(allowed_roles)}")
        return session
    return _check


# Skróty dla najczęstszych przypadków
verify_admin      = require_role("admin")
verify_admin_or_majster = require_role("admin", "majster")


# ══════════════════════════════════════════════════════════════════════════════
# 5. RATE LIMITING – ochrona przed brute-force
# ══════════════════════════════════════════════════════════════════════════════

class RateLimiter:
    """
    Prosty rate limiter in-memory.
    Przechowuje (liczba_prób, czas_blokady) dla każdego klucza (IP lub username).
    """
    def __init__(self, max_tries: int = MAX_LOGIN_TRIES, block_sec: int = LOGIN_BLOCK_SEC):
        self.max_tries = max_tries
        self.block_sec = block_sec
        self._attempts: dict[str, list[float]] = defaultdict(list)
        self._blocked:  dict[str, float]       = {}

    def check(self, key: str, raise_on_blocked: bool = True) -> bool:
        """
        Sprawdza czy klucz jest zablokowany.
        Jeśli raise_on_blocked=True, rzuca HTTPException 429.
        """
        now = time.time()
        # Czy aktualnie zablokowany?
        if key in self._blocked:
            if now < self._blocked[key]:
                remaining = int(self._blocked[key] - now)
                if raise_on_blocked:
                    raise HTTPException(
                        429,
                        f"Zbyt wiele nieudanych prób. Spróbuj za {remaining} sekund."
                    )
                return False
            else:
                del self._blocked[key]
                self._attempts[key] = []
        return True

    def record_failure(self, key: str):
        """Rejestruje nieudaną próbę."""
        now = time.time()
        # Usuń próby starsze niż okno blokady
        self._attempts[key] = [t for t in self._attempts[key] if now - t < self.block_sec]
        self._attempts[key].append(now)
        if len(self._attempts[key]) >= self.max_tries:
            self._blocked[key] = now + self.block_sec
            audit.warning(f"RATE_LIMIT_BLOCKED key={key!r} after {self.max_tries} attempts")

    def record_success(self, key: str):
        """Czyści licznik po udanej próbie."""
        self._attempts.pop(key, None)
        self._blocked.pop(key, None)


# Globalny limiter dla logowania
rate_limit_login = RateLimiter(max_tries=MAX_LOGIN_TRIES, block_sec=LOGIN_BLOCK_SEC)

# Ogólny limiter API (opcjonalnie – mniej restrykcyjny)
rate_limit_api = RateLimiter(max_tries=200, block_sec=60)


# ══════════════════════════════════════════════════════════════════════════════
# 6. NAGŁÓWKI BEZPIECZEŃSTWA HTTP
# ══════════════════════════════════════════════════════════════════════════════

SECURITY_HEADERS = {
    "X-Content-Type-Options":    "nosniff",
    "X-Frame-Options":           "DENY",
    "X-XSS-Protection":          "1; mode=block",
    "Referrer-Policy":           "strict-origin-when-cross-origin",
    "Permissions-Policy":        "geolocation=(), microphone=(), camera=(self)",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob: https://res.cloudinary.com; "
        "connect-src 'self' wss: ws:; "
        "font-src 'self'; "
        "object-src 'none'; "
        "frame-ancestors 'none';"
    ),
}


def get_allowed_origins() -> list[str]:
    """
    Zwraca listę dozwolonych originów dla CORS.
    Ustaw zmienną ALLOWED_ORIGINS jako przecinkami oddzieloną listę URL.
    Jeśli pusta – CORS jest zamknięty (bezpieczne dla prod).
    """
    if ALLOWED_ORIGINS:
        return [o.strip() for o in ALLOWED_ORIGINS.split(",") if o.strip()]
    # UWAGA: puste = tylko same-origin (bezpieczne)
    return []


class SecurityHeadersMiddleware:
    """
    ASGI middleware dodające nagłówki bezpieczeństwa do każdej odpowiedzi.
    Użycie w main.py:
        from starlette.middleware.base import BaseHTTPMiddleware
        app.add_middleware(BaseHTTPMiddleware, dispatch=SecurityHeadersMiddleware())
    LUB:
        app.add_middleware(SecurityHeadersMiddlewareClass)
    """
    async def __call__(self, request: Request, call_next):
        response = await call_next(request)
        for key, value in SECURITY_HEADERS.items():
            response.headers[key] = value
        # Nie ujawniaj wersji frameworka
        response.headers.pop("server", None)
        response.headers.pop("x-powered-by", None)
        return response


# ══════════════════════════════════════════════════════════════════════════════
# 7. AUDIT LOGGER – ślad audytowy
# ══════════════════════════════════════════════════════════════════════════════

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [AUDIT] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
audit = logging.getLogger("audit")
audit.setLevel(logging.INFO)

# Opcjonalnie: zapisuj do pliku
_audit_file = os.environ.get("AUDIT_LOG_FILE", "")
if _audit_file:
    _fh = logging.FileHandler(_audit_file, encoding="utf-8")
    _fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    audit.addHandler(_fh)


def log_login(username: str, success: bool, ip: str, reason: str = ""):
    level = logging.INFO if success else logging.WARNING
    msg = f"LOGIN {'OK' if success else 'FAIL'} user={username!r} ip={ip}"
    if reason:
        msg += f" reason={reason!r}"
    audit.log(level, msg)


def log_action(user: str, action: str, detail: str = "", ip: str = ""):
    audit.info(f"ACTION user={user!r} action={action!r} detail={detail!r} ip={ip}")


def log_admin(user: str, action: str, target: str = "", ip: str = ""):
    audit.warning(f"ADMIN user={user!r} action={action!r} target={target!r} ip={ip}")


# ══════════════════════════════════════════════════════════════════════════════
# 8. OCHRONA ENDPOINTU /sql – whitelist SQL
# ══════════════════════════════════════════════════════════════════════════════

# Wyrażenia zakazane w zapytaniach READ (SELECT)
_DANGEROUS_SQL_PATTERNS = re.compile(
    r"""
    \b(
        DROP | DELETE | INSERT | UPDATE | REPLACE | ALTER | CREATE |
        ATTACH | DETACH | PRAGMA\s+(?!table_info|index_list|foreign_key_list|journal_mode) |
        LOAD_EXTENSION | RANDOMBLOB | ZEROBLOB
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)


def sanitize_sql_readonly(sql: str) -> str:
    """
    Sprawdza czy SQL jest tylko do odczytu.
    Rzuca HTTPException 400 jeśli wykryje niebezpieczne operacje.
    """
    clean = sql.strip()
    if not clean.upper().startswith(("SELECT", "WITH", "PRAGMA table_info", "PRAGMA index_list")):
        raise HTTPException(400, "Endpoint /sql akceptuje wyłącznie zapytania SELECT.")
    if _DANGEROUS_SQL_PATTERNS.search(clean):
        raise HTTPException(400, "Zapytanie zawiera niedozwolone operacje SQL.")
    # Limit długości zapytania
    if len(clean) > 4000:
        raise HTTPException(400, "Zapytanie SQL jest zbyt długie (max 4000 znaków).")
    return clean


# ══════════════════════════════════════════════════════════════════════════════
# 9. WALIDACJA HASEŁ
# ══════════════════════════════════════════════════════════════════════════════

MIN_PASSWORD_LEN = int(os.environ.get("MIN_PASSWORD_LEN", 8))

def validate_password_strength(password: str) -> tuple[bool, str]:
    """
    Sprawdza siłę hasła.
    Zwraca (True, "") jeśli OK lub (False, "komunikat błędu").
    """
    if len(password) < MIN_PASSWORD_LEN:
        return False, f"Hasło musi mieć co najmniej {MIN_PASSWORD_LEN} znaków."
    if not re.search(r"[A-Z]", password):
        return False, "Hasło musi zawierać co najmniej jedną wielką literę."
    if not re.search(r"[0-9]", password):
        return False, "Hasło musi zawierać co najmniej jedną cyfrę."
    # Opcjonalne: znaki specjalne
    # if not re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>?/]", password):
    #     return False, "Hasło musi zawierać co najmniej jeden znak specjalny."
    return True, ""


# ══════════════════════════════════════════════════════════════════════════════
# 10. POMOCNICZE – IP z Requesta
# ══════════════════════════════════════════════════════════════════════════════

def get_client_ip(request: Request) -> str:
    """Bezpiecznie wyciąga IP klienta (obsługuje Railway/Render proxy)."""
    # Railway i Render przekazują prawdziwe IP przez X-Forwarded-For
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        # Bierz pierwszy IP z listy (klient, proxy1, proxy2, ...)
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
