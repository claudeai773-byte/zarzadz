// ═══════════════════════════════════════════════════════════════════════════════
// PATCH 3 – Widok priorytetów dla majstra
// Dodaj do pliku majster (renderMajster lub tab-majster.js)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Widok pokazuje:
//  • Listę AKTYWNYCH zleceń posortowanych wg priorytetu
//  • Dla każdego zlecenia: termin, status, postęp sztuk, kto pracuje
//  • Kolory terminów: zielony (>3 dni), żółty (≤3 dni), czerwony (po terminie)
//  • Ręczna zmiana priorytetu (strzałki ↑↓ lub pin 📌)
//  • Filtr: Wszystkie | Opóźnione | Dziś | Bez operatora
// ═══════════════════════════════════════════════════════════════════════════════

// ── State rozszerzenie ────────────────────────────────────────────────────────
// Dodaj do initialState (lub setState przy logowaniu):
//   majsterPriorytety: {},    // { [zlecenie_id]: number } – ręczne priorytety
//   majsterPriorFilter: 'all' // 'all' | 'opoznione' | 'dzis' | 'bez_op'

// ── Loader (wywołaj w loadMajster() obok istniejących fetch-ów) ──────────────
async function loadMajsterPriorytety() {
  try {
    // Pobierz zlecenia jeśli nie załadowane
    if (!state.zlecenia || !state.zlecenia.length) {
      const zl = await get('/api/zlecenia');
      setState({ zlecenia: zl }, true);
    }
    // Pobierz aktywne sesje dla wszystkich pracowników
    const sesje = await get('/api/sesje/aktywne');
    setState({ majsterSesjeAktywne: sesje }, true);
  } catch(e) { console.warn('loadMajsterPriorytety:', e.message); }
}

// ── Priorytety persystowane w localStorage ────────────────────────────────────
function _mpLoad() {
  try { return JSON.parse(localStorage.getItem('majster_priorytety') || '{}'); } catch(e) { return {}; }
}
function _mpSave(p) {
  try { localStorage.setItem('majster_priorytety', JSON.stringify(p)); } catch(e) {}
}
function mpSetPriority(id, val) {
  const p = { ...(state.majsterPriorytety || _mpLoad()), [id]: val };
  _mpSave(p);
  setState({ majsterPriorytety: p });
}
function mpPin(id) {
  const p = state.majsterPriorytety || _mpLoad();
  const pinned = p[id] === 0 ? 1 : 0;  // toggle: 0=przypięte na górze, wyższe=niżej
  mpSetPriority(id, pinned);
}

// ── Ranking automatyczny (termin + postęp) ───────────────────────────────────
function _mpAutoScore(z) {
  const teraz = Date.now();
  const termin = z.termin ? new Date(z.termin).getTime() : null;
  const dniDo  = termin ? (termin - teraz) / 86400000 : 999;

  // Oblicz postęp: min z ilosc_wykonana / ilosc_sztuk wg sesji
  const ilosc  = z.ilosc_sztuk || 1;
  const wykon  = z.sztuki_wykonane ?? z._wykonano ?? 0;
  const postep = wykon / ilosc;

  // Wynik: mniejszy → ważniejszy
  let score = 0;
  if (dniDo < 0)       score -= 1000;   // po terminie – na górę
  else if (dniDo < 1)  score -= 500;    // dziś
  else if (dniDo < 3)  score -= 200;    // pilne
  score -= postep * 50;                  // mniej zrobione → wyżej
  return score;
}

// ── Render główny widoku priorytetów ─────────────────────────────────────────
function renderMajsterPriorytety() {
  const zlecenia  = (state.zlecenia || []).filter(z =>
    z.status !== 'zakonczone' && z.status !== 'anulowane'
  );
  const sesjeAkt  = state.majsterSesjeAktywne || [];
  const priorytety = state.majsterPriorytety || _mpLoad();
  const filter    = state.majsterPriorFilter || 'all';
  const teraz     = Date.now();

  // Wzbogać zlecenia o dane sesji
  const wzbogacone = zlecenia.map(z => {
    const sesjeZl = sesjeAkt.filter(s => s.zlecenie_id === z.id || s.zlecenie_id_inne === z.id);
    const operatorzy = [...new Set(sesjeZl.map(s => s.full_name || s.user_name).filter(Boolean))];
    const wykonano = sesjeZl.reduce((sum, s) => sum + (s.ilosc_sztuk || 0), 0);
    const termin = z.termin ? new Date(z.termin) : null;
    const dniDo  = termin ? (termin.getTime() - teraz) / 86400000 : null;
    return { ...z, _operatorzy: operatorzy, _wykonano: wykonano, _dniDo: dniDo, _sesje: sesjeZl };
  });

  // Filtrowanie
  let lista = wzbogacone;
  if (filter === 'opoznione') lista = lista.filter(z => z._dniDo !== null && z._dniDo < 0);
  if (filter === 'dzis')      lista = lista.filter(z => z._dniDo !== null && z._dniDo >= 0 && z._dniDo < 1);
  if (filter === 'bez_op')    lista = lista.filter(z => z._sesje.length === 0);

  // Sortowanie: ręczny priorytet (pin) → auto score
  lista.sort((a, b) => {
    const pa = priorytety[a.id] != null ? priorytety[a.id] : 100;
    const pb = priorytety[b.id] != null ? priorytety[b.id] : 100;
    if (pa !== pb) return pa - pb;
    return _mpAutoScore(b) - _mpAutoScore(a);  // wyższy score → wyżej
  });

  // ── Statystyki nagłówka ────────────────────────────────────────────────────
  const opoznioneN = wzbogacone.filter(z => z._dniDo !== null && z._dniDo < 0).length;
  const dzisN      = wzbogacone.filter(z => z._dniDo !== null && z._dniDo >= 0 && z._dniDo < 1).length;
  const bezOpN     = wzbogacone.filter(z => z._sesje.length === 0 && z.status === 'w_toku').length;

  // ── Filtry ─────────────────────────────────────────────────────────────────
  const fBtn = (id, lbl, badge) => `
    <button onclick="setState({majsterPriorFilter:'${id}'})"
      style="padding:5px 11px;border-radius:20px;border:1.5px solid ${filter===id?'var(--accent)':'var(--border)'};
             background:${filter===id?'rgba(232,160,32,0.15)':'var(--panel)'};
             color:${filter===id?'var(--accent)':'var(--dim)'};
             cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap">
      ${lbl}${badge ? ` <span style="background:${filter===id?'var(--accent)':'#334155'};color:${filter===id?'#1a1f2e':'var(--text)'};border-radius:10px;padding:1px 6px;font-size:11px;margin-left:4px">${badge}</span>` : ''}
    </button>`;

  let html = `
  <div>
    <!-- Nagłówek -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="font-size:15px;font-weight:700">🎯 Priorytety zleceń</div>
      <button onclick="loadMajsterPriorytety();render()"
        style="background:var(--panel);border:1px solid var(--border);border-radius:6px;
               padding:5px 10px;cursor:pointer;font-size:12px;color:var(--dim)">
        🔄 Odśwież
      </button>
    </div>

    <!-- Skróty statystyk -->
    <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
      <div style="background:rgba(248,113,113,0.1);border:1px solid #f8717133;border-radius:8px;
                  padding:8px 14px;text-align:center;min-width:70px">
        <div style="font-size:20px;font-weight:700;color:#f87171">${opoznioneN}</div>
        <div style="font-size:10px;color:#f87171;text-transform:uppercase;letter-spacing:.5px">Opóźnione</div>
      </div>
      <div style="background:rgba(245,158,11,0.1);border:1px solid #f59e0b33;border-radius:8px;
                  padding:8px 14px;text-align:center;min-width:70px">
        <div style="font-size:20px;font-weight:700;color:#f59e0b">${dzisN}</div>
        <div style="font-size:10px;color:#f59e0b;text-transform:uppercase;letter-spacing:.5px">Na dziś</div>
      </div>
      <div style="background:rgba(96,165,250,0.1);border:1px solid #60a5fa33;border-radius:8px;
                  padding:8px 14px;text-align:center;min-width:70px">
        <div style="font-size:20px;font-weight:700;color:#60a5fa">${bezOpN}</div>
        <div style="font-size:10px;color:#60a5fa;text-transform:uppercase;letter-spacing:.5px">Bez operatora</div>
      </div>
      <div style="background:var(--entry);border:1px solid var(--border);border-radius:8px;
                  padding:8px 14px;text-align:center;min-width:70px">
        <div style="font-size:20px;font-weight:700;color:var(--text)">${zlecenia.length}</div>
        <div style="font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px">Łącznie</div>
      </div>
    </div>

    <!-- Filtry -->
    <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">
      ${fBtn('all',       'Wszystkie')}
      ${fBtn('opoznione', '🔴 Opóźnione', opoznioneN || '')}
      ${fBtn('dzis',      '🟡 Na dziś',   dzisN || '')}
      ${fBtn('bez_op',    '👤 Bez operatora', bezOpN || '')}
    </div>`;

  if (!lista.length) {
    html += `<div style="text-align:center;color:var(--dim);padding:30px 0;font-size:14px">
      ✅ Brak zleceń w tym filtrze
    </div>`;
  }

  lista.forEach((z, rank) => {
    const isPinned   = priorytety[z.id] === 0;
    const dniDo      = z._dniDo;
    const postepPct  = z.ilosc_sztuk > 0
      ? Math.min(100, Math.round(((z.sztuki_wykonane ?? z._wykonano ?? 0) / z.ilosc_sztuk) * 100))
      : 0;

    // Kolor terminu
    let terminColor = 'var(--green, #4ade80)';
    let terminLabel = '—';
    let terminBg    = 'rgba(74,222,128,0.08)';
    if (dniDo !== null) {
      if (dniDo < 0) {
        terminColor = '#f87171'; terminBg = 'rgba(248,113,113,0.1)';
        terminLabel = `${Math.round(-dniDo)}d po terminie`;
      } else if (dniDo < 1) {
        terminColor = '#f59e0b'; terminBg = 'rgba(245,158,11,0.1)';
        terminLabel = 'Dziś!';
      } else if (dniDo < 3) {
        terminColor = '#f97316'; terminBg = 'rgba(249,115,22,0.1)';
        terminLabel = `${Math.round(dniDo)}d`;
      } else {
        terminLabel = `${Math.round(dniDo)}d`;
      }
    }

    // Kolor paska postępu
    const barColor = postepPct >= 100 ? '#4ade80'
                   : postepPct > 60  ? '#3b82f6'
                   : '#f59e0b';

    // Operatorzy
    const opsHtml = z._operatorzy.length
      ? z._operatorzy.map(n => `<span style="background:#1e293b;border-radius:10px;padding:2px 8px;font-size:11px;color:#94a3b8">${_esc(n)}</span>`).join(' ')
      : `<span style="color:#475569;font-size:11px">– brak operatora –</span>`;

    html += `
    <div style="background:var(--panel);border:1.5px solid ${isPinned ? 'var(--accent)' : 'var(--border)'};
                border-radius:10px;margin-bottom:10px;overflow:hidden;
                ${isPinned ? 'box-shadow:0 0 0 1px rgba(232,160,32,0.2)' : ''}">

      <!-- Pasek koloru terminu -->
      <div style="height:3px;background:${terminColor};opacity:.7"></div>

      <div style="padding:12px 14px">
        <!-- Nagłówek karty -->
        <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">
          <!-- Rank -->
          <div style="flex-shrink:0;width:24px;height:24px;border-radius:50%;
                      background:${isPinned?'var(--accent)':'#1e293b'};
                      color:${isPinned?'#1a1f2e':'#475569'};
                      font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center">
            ${isPinned ? '📌' : rank + 1}
          </div>

          <!-- Tytuł -->
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              <span style="font-family:monospace;color:#60a5fa">${_esc(z.numer)}</span>
              <span style="color:var(--text);margin-left:6px;font-size:13px">${_esc(z.nazwa)}</span>
            </div>
            <div style="font-size:11px;color:var(--dim);margin-top:2px">
              ${z.ilosc_sztuk} szt.
              ${z.status === 'w_toku' ? '<span style="color:#4ade80;margin-left:6px">● w toku</span>'
                : z.status === 'nowe' ? '<span style="color:#60a5fa;margin-left:6px">● nowe</span>'
                : `<span style="color:#64748b;margin-left:6px">${z.status}</span>`}
            </div>
          </div>

          <!-- Termin badge -->
          <div style="flex-shrink:0;background:${terminBg};border:1px solid ${terminColor}33;
                      border-radius:6px;padding:4px 8px;text-align:center;min-width:52px">
            <div style="font-size:11px;font-weight:700;color:${terminColor}">${terminLabel}</div>
            <div style="font-size:9px;color:${terminColor};opacity:.7">termin</div>
          </div>
        </div>

        <!-- Postęp sztuk -->
        <div style="margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;font-size:11px;
                      color:var(--dim);margin-bottom:3px">
            <span>Postęp</span>
            <span style="color:var(--text);font-weight:600">${(z.sztuki_wykonane ?? z._wykonano ?? 0)} / ${z.ilosc_sztuk} szt. (${postepPct}%)</span>
          </div>
          <div style="height:6px;background:#1e293b;border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${postepPct}%;background:${barColor};
                        border-radius:3px;transition:width .4s ease"></div>
          </div>
        </div>

        <!-- Operatorzy -->
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px">
          <span style="font-size:11px;color:#475569">👤</span>
          ${opsHtml}
        </div>

        <!-- Akcje -->
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button onclick="mpPin(${z.id})"
            style="background:${isPinned?'rgba(232,160,32,0.15)':'var(--entry)'};
                   border:1px solid ${isPinned?'var(--accent)':'var(--border)'};
                   color:${isPinned?'var(--accent)':'var(--dim)'};
                   border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px">
            ${isPinned ? '📌 Odpnij' : '📌 Przypnij na górę'}
          </button>

          <button onclick="mpSetPriority(${z.id}, ${Math.max(0, (priorytety[z.id]||100) - 1)})"
            title="Wyższy priorytet"
            style="background:var(--entry);border:1px solid var(--border);
                   color:var(--dim);border-radius:6px;padding:5px 8px;cursor:pointer;font-size:13px">
            ↑
          </button>

          <button onclick="mpSetPriority(${z.id}, (priorytety && priorytety[${z.id}]!=null ? priorytety[${z.id}] : 100) + 1)"
            title="Niższy priorytet"
            style="background:var(--entry);border:1px solid var(--border);
                   color:var(--dim);border-radius:6px;padding:5px 8px;cursor:pointer;font-size:13px">
            ↓
          </button>

          <!-- Otwórz widok zlecenia (istniejąca funkcja) -->
          ${typeof openEditZlecenieById === 'function' ? `
          <button onclick="openEditZlecenieById(${z.id})"
            style="background:rgba(59,130,246,0.08);border:1px solid #3b82f633;
                   color:#60a5fa;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px;margin-left:auto">
            🔍 Szczegóły
          </button>` : ''}
        </div>
      </div>
    </div>`;
  });

  html += `</div>`;
  return html;
}

// ── Pomocnik (duplikat jeśli już jest w scope) ────────────────────────────────
// Jeśli _esc() już istnieje globalnie, usuń tę definicję:
if (typeof _esc === 'undefined') {
  function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INSTRUKCJA INTEGRACJI – zakładka Majster
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. W loadMajster() dodaj wywołanie:
//      await loadMajsterPriorytety();
//
// 2. W renderMajster() – dodaj pod-zakładkę "Priorytety":
//
//    const majSubTab = state.majsterSubTab || 'operatorzy';
//
//    <!-- pod-zakładki -->
//    <button onclick="setState({majsterSubTab:'operatorzy'})">👷 Operatorzy</button>
//    <button onclick="setState({majsterSubTab:'priorytety'});loadMajsterPriorytety()">🎯 Priorytety</button>
//
//    <!-- treść -->
//    if (majSubTab === 'priorytety') return renderMajsterPriorytety();
//
// 3. Stan startowy (initialState / setState przy login):
//    majsterPriorytety: _mpLoad(),
//    majsterPriorFilter: 'all',
//    majsterSesjeAktywne: [],
//
// 4. API wymagane:
//    GET /api/sesje/aktywne  → tablica sesji z polami:
//      { id, user_id, full_name, zlecenie_id, ilosc_sztuk, typ, ... }
//    (To samo endpoint co dla istniejącego widoku majstra – brak nowych endpointów)
// ═══════════════════════════════════════════════════════════════════════════════
