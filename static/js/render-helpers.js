//  RENDER HELPERS
// ══════════════════════════════════════════════════════════════
function statusBadge(s) {
  const map = {
    'w_toku':    ['badge-orange','🔄 w toku'],
    'oczekuje':  ['badge-dim',   '⏳ oczekuje'],
    'zakonczona':['badge-green', '✅ ukończona'],
    'zakonczone':['badge-green', '✅ ukończone'],
    'nowe':      ['badge-blue',  '🆕 nowe'],
    'anulowane': ['badge-red',   '❌ anulowane'],
  };
  const [cls, label] = map[s] || ['badge-dim', s];
  return `<span class="badge ${cls}">${label}</span>`;
}
function roleName(r) {
  return {admin:'Administrator',technolog:'Technolog',pracownik:'Pracownik',
          magazynier:'Magazynier',majster:'Majster'}[r] || r;
}
function fmtPLN(n) { return (n||0).toFixed(2)+' zł'; }
function fmtDate(d) { return d ? d.substring(0,10) : '—'; }

// ══════════════════════════════════════════════════════════════
//  SCREEN: CONFIG
// ══════════════════════════════════════════════════════════════
function generateWorkerLink() {
  if (!SERVER_URL || !API_KEY) { alert('Najpierw skonfiguruj serwer i klucz API'); return; }
  const payload = btoa(JSON.stringify({s: SERVER_URL.replace(/\/$/, ''), k: API_KEY}))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const base = window.location.origin + window.location.pathname;
  const link = base + '#cfg=' + payload;
  const box = document.getElementById('worker-link-box');
  const input = document.getElementById('worker-link-input');
  if (box && input) { input.value = link; box.style.display = 'block'; input.select(); }
}
function copyWorkerLink() {
  const input = document.getElementById('worker-link-input');
  if (!input) return;
  navigator.clipboard.writeText(input.value).then(() => {
    const copied = document.getElementById('worker-link-copied');
    if (copied) { copied.style.display = 'block'; setTimeout(() => { copied.style.display = 'none'; }, 2000); }
  }).catch(() => { input.select(); document.execCommand('copy'); });
}

function renderConfig() {
  return `
  <div class="config-wrap">
    <h2>⚙ Konfiguracja</h2>
    <p>Wpisz adres serwera Railway i klucz API.</p>
    <div class="field">
      <label>URL Serwera</label>
      <input id="cfg-url" type="url" placeholder="https://produkcja-xxx.railway.app" value="${SERVER_URL}">
    </div>
    <div class="field">
      <label>Klucz API</label>
      <input id="cfg-key" type="password" placeholder="klucz-api" value="${API_KEY}">
    </div>
    <button class="btn btn-accent" onclick="saveConfig()">💾 Zapisz i połącz</button>
  </div>`;
}
function saveConfig() {
  const url = document.getElementById('cfg-url').value.trim();
  const key = document.getElementById('cfg-key').value.trim();
  if (!url||!key) { alert('Wypełnij oba pola'); return; }
  SERVER_URL=url; API_KEY=key;
  localStorage.setItem('produkcja_config', JSON.stringify({server_url:url, api_key:key}));
  setState({screen:'login'});
}

// ══════════════════════════════════════════════════════════════
//  SCREEN: LOGIN
// ══════════════════════════════════════════════════════════════
function renderLogin() {
  const wi = state.warehouseInfo;
  return `
  <div style="padding:16px;max-width:500px;margin:0 auto">
    ${wi ? renderWarehouseLoginPanel(wi) : ''}
    <div class="login-card">
      <h2>⚙ PRODUKCJA JANUS</h2>
      <p class="subtitle">System Zarządzania Produkcją</p>
      ${state.error ? `<div class="error-banner">⚠ ${state.error}</div>` : ''}
      <div class="field">
        <label>Login</label>
        <input id="lg-user" type="text" placeholder="np. piotr.p" autocomplete="username"
               onkeydown="if(event.key==='Enter')document.getElementById('lg-pass').focus()">
      </div>
      <div class="field">
        <label>Hasło</label>
        <input id="lg-pass" type="password" autocomplete="current-password"
               onkeydown="if(event.key==='Enter')doLogin(document.getElementById('lg-user').value,this.value)">
      </div>
      <button class="btn btn-accent" style="margin-top:8px"
              onclick="doLogin(document.getElementById('lg-user').value,document.getElementById('lg-pass').value)"
              ${state.loading?'disabled':''}>
        ${state.loading ? '⏳ Łączenie...' : '🔑 Zaloguj się'}
      </button>
      <button class="btn-outline" style="margin-top:10px" onclick="setState({screen:'config'})">⚙ Zmień serwer</button>
    </div>
  </div>`;
}

function renderWarehouseLoginPanel(wi) {
  // Pokazujemy TYLKO zakończone operacje oczekujące na następną (coś do odbioru/przewiezienia)
  const zakonczone = (wi.zakonczone || []).filter(op => {
    const nxt = (wi.next_map || {})[String(op.id)];
    return true; // pokaż wszystkie zakończone – nawet ostatnią (żeby wiedzieć że gotowe)
  });
  const next_map = wi.next_map || {};
  let html = '';

  if (!zakonczone.length) {
    html += '<div style="background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px;text-align:center">'
          + '<div style="font-size:22px;margin-bottom:6px">✅</div>'
          + '<div style="font-size:13px;color:var(--dim)">Brak zakończonych operacji do odbioru</div>'
          + '</div>';
    return html;
  }

  html += '<div style="background:rgba(39,174,96,.10);border:1px solid var(--green);border-radius:12px;padding:14px 16px;margin-bottom:10px">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'
        + '<span style="font-size:11px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:1px">📦 Do odbioru (' + zakonczone.length + ')</span>'
        + '<span style="font-size:10px;color:var(--dim)">odśwież co 2 min</span>'
        + '</div>';

  zakonczone.forEach((op, i) => {
    const nxt = next_map[String(op.id)];
    const isLast = !nxt;
    html += '<div style="padding:8px 0;' + (i < zakonczone.length-1 ? 'border-bottom:1px solid rgba(39,174,96,.2)' : '') + '">'
          + '<div style="display:flex;justify-content:space-between;align-items:flex-start">'
          + '<div style="flex:1">'
          + '<div style="font-weight:700;font-size:13px">' + op.kolejnosc + '. ' + op.nazwa + '</div>'
          + '<div style="font-size:12px;color:var(--dim);margin-top:2px">📋 ' + op.zl_numer + ' – ' + op.zl_nazwa + '</div>'
          + '<div style="font-size:12px;color:var(--dim)">🏭 ' + (op.stanowisko||'—') + '</div>'
          + '</div>'
          + '<div style="text-align:right;margin-left:8px;white-space:nowrap">'
          + '<span style="font-size:13px;font-weight:700;color:var(--green)">' + op.ilosc_wykonana + '/' + op.ilosc_sztuk + ' szt.</span>'
          + '</div></div>'
          + '<div style="margin-top:5px;padding:5px 8px;border-radius:6px;font-size:12px;' + (isLast ? 'background:rgba(39,174,96,.15);color:var(--green)' : 'background:rgba(232,160,32,.12);color:var(--accent)') + '">'
          + (isLast
              ? '✅ Gotowe – ostatnia operacja, możliwy odbiór końcowy'
              : '▶ Następna: <b>' + nxt.kolejnosc + '. ' + nxt.nazwa + '</b>' + (nxt.stanowisko ? ' → <b>' + nxt.stanowisko + '</b>' : ''))
          + '</div></div>';
  });

  html += '</div>';
  return html;
}

// ══════════════════════════════════════════════════════════════
