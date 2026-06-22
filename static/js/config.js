//  CONFIG
// ══════════════════════════════════════════════════════════════
// ── Auto-config z linku (hash #cfg=BASE64) ─────────────────
(function() {
  try {
    const hash = window.location.hash;
    const m = hash.match(/[#&]cfg=([A-Za-z0-9+/=_-]+)/);
    if (m) {
      const decoded = JSON.parse(atob(m[1].replace(/-/g,'+').replace(/_/g,'/')));
      if (decoded.s && decoded.k) {
        localStorage.setItem('produkcja_config', JSON.stringify({server_url: decoded.s, api_key: decoded.k}));
      }
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } catch(e) { /* nieprawidłowy hash – ignoruj */ }
})();

let CONFIG = JSON.parse(localStorage.getItem('produkcja_config') || '{}');
let SERVER_URL = CONFIG.server_url || '';
let API_KEY    = CONFIG.api_key    || '';
// Token sesji – ustawiany po zalogowaniu przez doLogin() w actions.js.
// Zapamiętany w localStorage, żeby przeżył odświeżenie strony (patrz
// attemptSessionRestore() w actions.js, wołane przy starcie aplikacji).
let SESSION_TOKEN = localStorage.getItem('produkcja_session_token') || '';

const HEADERS  = () => {
  const h = {'Content-Type':'application/json','x-api-key':API_KEY};
  if (SESSION_TOKEN) h['x-session-token'] = SESSION_TOKEN;
  return h;
};

async function api(path, opts={}) {
  const url = SERVER_URL.replace(/\/$/, '') + path;
  const res = await fetch(url, {headers: HEADERS(), ...opts});
  if (!res.ok) {
    const t = await res.text().catch(() => 'Błąd serwera');
    let msg = t;
    try {
      const parsed = JSON.parse(t);
      if (typeof parsed.detail === 'string') msg = parsed.detail;
      else if (Array.isArray(parsed.detail)) msg = parsed.detail.map(e => e.msg || JSON.stringify(e)).join('; ');
      else msg = JSON.stringify(parsed);
    } catch(_) {}
    console.error(`API ERROR ${res.status} ${path}:`, t);
    throw new Error(`[${res.status}] ${msg}`);
  }
  return res.json();
}
const get  = p => api(p);
const post = (p,b) => api(p, {method:'POST', body:JSON.stringify(b)});
const put  = (p,b) => api(p, {method:'PUT', body:JSON.stringify(b)});
const del  = p => api(p, {method:'DELETE'});
const patch= (p,b) => api(p, {method:'PATCH', body:JSON.stringify(b)});

// ══════════════════════════════════════════════════════════════
