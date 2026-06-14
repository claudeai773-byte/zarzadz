// ══════════════════════════════════════════════════════════════
//  WebSocket – Powiadomienia real-time
//  Łączy się z /ws/powiadomienia i wyświetla toast-y dla majstrów
// ══════════════════════════════════════════════════════════════

let _ws = null;
let _wsReconnectTimer = null;
let _wsConnected = false;

// ── Toast UI ──────────────────────────────────────────────────
function _showToast(opts) {
  // opts: { title, body, color, icon, duration }
  let container = document.getElementById('ws-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'ws-toast-container';
    container.style.cssText = `
      position:fixed;bottom:20px;right:16px;z-index:99999;
      display:flex;flex-direction:column-reverse;gap:8px;
      max-width:320px;pointer-events:none;
    `;
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.style.cssText = `
    background:var(--panel,#1e2430);
    border:1px solid ${opts.color||'var(--accent)'};
    border-left:4px solid ${opts.color||'var(--accent)'};
    border-radius:10px;
    padding:12px 14px;
    box-shadow:0 6px 24px rgba(0,0,0,.5);
    font-size:13px;
    color:var(--text,#eee);
    pointer-events:all;
    cursor:pointer;
    transition:opacity .3s,transform .3s;
    transform:translateX(20px);
    opacity:0;
  `;
  toast.innerHTML = `
    <div style="font-weight:700;font-size:13px;margin-bottom:3px">${opts.icon||'🔔'} ${opts.title||''}</div>
    ${opts.body ? `<div style="font-size:11px;color:var(--dim,#888)">${opts.body}</div>` : ''}
  `;
  toast.onclick = () => toast.remove();
  container.appendChild(toast);

  // Animacja wejścia
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    });
  });

  // Auto-usuń
  const dur = opts.duration || 6000;
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 350);
  }, dur);
}

// ── Wskaźnik połączenia WS ────────────────────────────────────
function _setWsIndicator(connected) {
  _wsConnected = connected;
  let dot = document.getElementById('ws-status-dot');
  if (!dot) {
    dot = document.createElement('div');
    dot.id = 'ws-status-dot';
    dot.title = connected ? 'Real-time: połączono' : 'Real-time: rozłączono';
    dot.style.cssText = `
      position:fixed;bottom:16px;left:16px;z-index:9990;
      width:8px;height:8px;border-radius:50%;
      transition:background .4s;
      opacity:.7;
    `;
    document.body.appendChild(dot);
  }
  dot.style.background = connected ? '#27ae60' : '#e74c3c';
  dot.title = connected ? 'Real-time: połączono' : 'Real-time: rozłączono';
}

// ── Obsługa wiadomości WS ──────────────────────────────────────
function _handleWsMessage(event) {
  let msg;
  try { msg = JSON.parse(event.data); } catch(_) { return; }

  switch (msg.type) {
    case 'connected':
      _setWsIndicator(true);
      break;

    case 'nowe_zlecenie':
      // Powiadomienie dla majstra o nowym zleceniu
      _showToast({
        title: `Nowe zlecenie: ${msg.numer || '—'}`,
        body: `${msg.nazwa || ''} · status: ${msg.status || '?'}${msg.termin ? ' · termin: '+msg.termin.slice(0,10) : ''}`,
        icon: '📋',
        color: 'var(--accent,#e8a020)',
        duration: 9000
      });
      // Jeśli jesteśmy na zakładce majster – odśwież dane
      if (state.screen === 'main' && state.activeTab === 'majster') {
        setTimeout(() => loadMajster(), 800);
      }
      // Aktualizuj badge na navbarze jeśli istnieje
      _wsUpdateZleceniesBadge();
      break;

    default:
      // Inne zdarzenia – rozszerzalne w przyszłości
      break;
  }
}

function _wsUpdateZleceniesBadge() {
  // Mały znacznik na ikonie zakładki Zlecenia
  const tabs = document.querySelectorAll('[data-tab="zlecenia"] .tab-badge, .tab-badge-zlecenia');
  tabs.forEach(b => {
    b.style.display = 'inline-block';
    setTimeout(() => { b.style.display = 'none'; }, 10000);
  });
}

// ── Połączenie i reconnect ─────────────────────────────────────
function wsConnect() {
  if (!SERVER_URL) return; // brak konfiguracji
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;

  const wsUrl = SERVER_URL
    .replace(/^https?:\/\//, m => m === 'https://' ? 'wss://' : 'ws://')
    .replace(/\/$/, '')
    + '/ws/powiadomienia'
    + (SESSION_TOKEN ? '?token=' + encodeURIComponent(SESSION_TOKEN) : '');

  try {
    _ws = new WebSocket(wsUrl);
  } catch(e) {
    console.warn('[WS] Nie można nawiązać połączenia:', e.message);
    return;
  }

  _ws.onopen = () => {
    _setWsIndicator(true);
    // Ping co 25s, żeby połączenie nie wygasło
    _ws._pingInterval = setInterval(() => {
      if (_ws.readyState === WebSocket.OPEN) _ws.send('ping');
    }, 25000);
  };

  _ws.onmessage = _handleWsMessage;

  _ws.onerror = (e) => {
    console.warn('[WS] Błąd połączenia');
    _setWsIndicator(false);
  };

  _ws.onclose = () => {
    _setWsIndicator(false);
    if (_ws._pingInterval) clearInterval(_ws._pingInterval);
    // Reconnect po 5s
    if (_wsReconnectTimer) clearTimeout(_wsReconnectTimer);
    _wsReconnectTimer = setTimeout(wsConnect, 5000);
  };
}

function wsDisconnect() {
  if (_wsReconnectTimer) clearTimeout(_wsReconnectTimer);
  if (_ws) { _ws.onclose = null; _ws.close(); _ws = null; }
  _setWsIndicator(false);
}

// ── Eksportowane API ───────────────────────────────────────────
// Inicjalizacja – wywołaj po zalogowaniu (z init.js lub loaders.js)
function wsInit() {
  if (SERVER_URL && API_KEY) {
    wsConnect();
  }
}

// ══════════════════════════════════════════════════════════════
