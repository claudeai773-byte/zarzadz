//  TAB: NARZĘDZIA SKRAWAJĄCE (Tool Manager)
// ══════════════════════════════════════════════════════════════
// Baza narzędzi skrawających (frezy, wytaczadła, głowice itd.) z ilością,
// średnicą, stanem (sprawne/zepsute/zamówione) i pełną historią
// wypożyczeń/zwrotów (kto i kiedy).

const NARZ_SKRAW_TYPY_FALLBACK = [
  "Frez wykańczający", "Frez zgrubny", "Frez kulowy", "Frez do gwintów",
  "Głowica frezarska", "Płytka do głowicy",
  "Wytaczadło zgrubne", "Wytaczadło wykańczające",
  "Nóż tokarski zgrubny", "Nóż tokarski wykańczający", "Nóż do gwintowania",
  "Nóż do przecinania", "Płytka tokarska",
  "Wiertło", "Wiertło centrujące", "Pogłębiacz",
  "Gwintownik", "Narzynka", "Rozwiertak",
  "Imadło / oprawka", "Tuleja zaciskowa", "Inne",
];

function narzSkrawStatusMeta(status) {
  if (status === 'zepsute')   return {label: 'Zepsute',   color: 'var(--red)',    bg: 'rgba(231,76,60,.12)',  icon: '🔴'};
  if (status === 'zamowione') return {label: 'Zamówione', color: 'var(--orange)', bg: 'rgba(230,126,0,.12)',  icon: '🟠'};
  return {label: 'Sprawne', color: 'var(--green)', bg: 'rgba(39,174,96,.12)', icon: '🟢'};
}

// ─── Loaders ────────────────────────────────────────────────────────────────
async function loadNarzSkrawTypy() {
  if (state.narzSkrawTypy) return;
  try {
    const r = await get('/api/narzedzia-skrawajace/typy');
    setState({narzSkrawTypy: r}, true);
  } catch (e) {
    setState({narzSkrawTypy: NARZ_SKRAW_TYPY_FALLBACK}, true);
  }
}

async function loadNarzSkrawAll() {
  setState({narzSkrawSearching: true}, true);
  try {
    const q = state.narzSkrawSearch || '';
    const typ = state.narzSkrawFiltrTyp || '';
    const status = state.narzSkrawFiltrStatus || '';
    const r = await get(`/api/narzedzia-skrawajace?q=${encodeURIComponent(q)}&typ=${encodeURIComponent(typ)}&status=${encodeURIComponent(status)}`);
    setState({narzSkrawResults: r, narzSkrawSearching: false});
  } catch (e) {
    setState({narzSkrawResults: [], narzSkrawSearching: false});
  }
}

async function loadNarzSkrawCount() {
  try {
    const r = await get('/api/narzedzia-skrawajace/count');
    setState({narzSkrawCount: r}, true);
  } catch (e) { /* ignoruj */ }
}

async function loadNarzSkrawWypozyczenia() {
  setState({narzSkrawWypLoading: true}, true);
  try {
    const r = await get('/api/narzedzia-skrawajace-wypozyczenia?status=wypozyczone&limit=200');
    setState({narzSkrawWypAktywne: r, narzSkrawWypLoading: false});
  } catch (e) {
    setState({narzSkrawWypAktywne: [], narzSkrawWypLoading: false});
  }
}

async function loadNarzSkrawHistoria() {
  setState({narzSkrawHistLoading: true}, true);
  try {
    const r = await get('/api/narzedzia-skrawajace-wypozyczenia?limit=300');
    setState({narzSkrawHistoria: r, narzSkrawHistLoading: false});
  } catch (e) {
    setState({narzSkrawHistoria: [], narzSkrawHistLoading: false});
  }
}

function searchNarzSkraw() {
  const el = document.getElementById('nskr-search');
  setState({narzSkrawSearch: el ? el.value : ''}, true);
  loadNarzSkrawAll();
}

function switchNarzSkrawView(view) {
  setState({narzSkrawView: view}, true);
  if (view === 'lista') loadNarzSkrawAll();
  if (view === 'wypozyczenia') loadNarzSkrawWypozyczenia();
  if (view === 'historia') loadNarzSkrawHistoria();
  render();
}

// ─── Main render ──────────────────────────────────────────────────────────
function renderNarzSkraw() {
  loadNarzSkrawTypy();
  const view = state.narzSkrawView || 'lista';
  const cnt  = state.narzSkrawCount;

  let html = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
    <div style="font-weight:700;font-size:15px">⚙ Narzędzia skrawające</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      ${cnt && cnt.zepsute > 0 ? `<span style="background:rgba(231,76,60,.15);color:var(--red);border-radius:10px;padding:3px 10px;font-size:11px;font-weight:700">🔴 ${cnt.zepsute} zepsute</span>` : ''}
      ${cnt && cnt.zamowione > 0 ? `<span style="background:rgba(230,126,0,.15);color:var(--orange);border-radius:10px;padding:3px 10px;font-size:11px;font-weight:700">🟠 ${cnt.zamowione} zamówione</span>` : ''}
      ${cnt && cnt.wypozyczone > 0 ? `<span style="background:rgba(52,152,219,.15);color:var(--blue);border-radius:10px;padding:3px 10px;font-size:11px;font-weight:700">📤 ${cnt.wypozyczone} wypożyczone</span>` : ''}
      <span style="font-size:11px;color:var(--dim)">${cnt ? cnt.total+' poz.' : ''}</span>
    </div>
  </div>
  <div class="sub-tabs" style="margin-bottom:12px">
    <button class="sub-tab ${view==='lista'?'active':''}" onclick="switchNarzSkrawView('lista')">📦 Baza narzędzi</button>
    <button class="sub-tab ${view==='wypozyczenia'?'active':''}" onclick="switchNarzSkrawView('wypozyczenia')">📤 Aktywne wypożyczenia${cnt && cnt.wypozyczone ? ' ('+cnt.wypozyczone+')' : ''}</button>
    <button class="sub-tab ${view==='historia'?'active':''}" onclick="switchNarzSkrawView('historia')">📋 Historia</button>
  </div>`;

  if (view === 'lista')         html += renderNarzSkrawLista();
  if (view === 'wypozyczenia')  html += renderNarzSkrawWypozyczeniaList();
  if (view === 'historia')      html += renderNarzSkrawHistoriaList();

  if (state.narzSkrawWypozyczModal) html += renderNarzSkrawWypozyczModal();
  if (state.narzSkrawEditModal)     html += renderNarzSkrawEditModal();
  if (state.narzSkrawHistModal)     html += renderNarzSkrawHistModal();
  html += renderNarzSkrawDodajModal();

  return html;
}

// ─── Widok: Baza narzędzi ───────────────────────────────────────────────────
function renderNarzSkrawLista() {
  const items = state.narzSkrawResults || [];
  const typy = state.narzSkrawTypy || NARZ_SKRAW_TYPY_FALLBACK;

  let html = `
  <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
    <input id="nskr-search" type="text" placeholder="🔍 Szukaj typu, oznaczenia, lokalizacji..."
      value="${state.narzSkrawSearch||''}"
      style="flex:1;min-width:160px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px"
      oninput="clearTimeout(window._nskrSt);window._nskrSt=setTimeout(searchNarzSkraw,350)"
      onkeyup="if(event.key==='Enter')searchNarzSkraw()">
    <button class="btn btn-accent" style="white-space:nowrap;padding:0 14px" onclick="showPanel('nskr-dodaj-modal')">＋ Dodaj</button>
  </div>
  <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
    <select onchange="setState({narzSkrawFiltrTyp:this.value},true);loadNarzSkrawAll()"
      style="flex:1;min-width:140px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:7px 8px;font-size:12px">
      <option value="">Wszystkie typy</option>
      ${typy.map(t => `<option value="${t}" ${state.narzSkrawFiltrTyp===t?'selected':''}>${t}</option>`).join('')}
    </select>
    <select onchange="setState({narzSkrawFiltrStatus:this.value},true);loadNarzSkrawAll()"
      style="flex:1;min-width:140px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:7px 8px;font-size:12px">
      <option value="">Wszystkie statusy</option>
      <option value="sprawne" ${state.narzSkrawFiltrStatus==='sprawne'?'selected':''}>🟢 Sprawne</option>
      <option value="zepsute" ${state.narzSkrawFiltrStatus==='zepsute'?'selected':''}>🔴 Zepsute</option>
      <option value="zamowione" ${state.narzSkrawFiltrStatus==='zamowione'?'selected':''}>🟠 Zamówione</option>
    </select>
  </div>`;

  if (state.narzSkrawSearching) {
    return html + `<div style="text-align:center;padding:30px;color:var(--dim)">⏳</div>`;
  }
  if (!items.length) {
    return html + `<div class="card" style="text-align:center;padding:30px">
      <div style="font-size:36px;margin-bottom:8px">📭</div>
      <div style="color:var(--dim)">Brak narzędzi – dodaj pierwszą pozycję</div>
    </div>`;
  }

  const byTyp = {};
  items.forEach(n => { (byTyp[n.typ] = byTyp[n.typ] || []).push(n); });

  Object.keys(byTyp).sort().forEach(typ => {
    html += `<div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;
      letter-spacing:.06em;margin:14px 0 6px;padding-left:4px">${typ}</div>`;
    byTyp[typ].forEach(n => {
      const meta = narzSkrawStatusMeta(n.status);
      const brakDostepnych = n.dostepne <= 0;
      html += `
      <div class="card" style="padding:10px 12px;margin-bottom:6px;${n.status==='zepsute'?'border-left:3px solid var(--red)':n.status==='zamowione'?'border-left:3px solid var(--orange)':''}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="min-width:0;flex:1">
            <div style="font-weight:700;font-size:13px">
              ${meta.icon} ${n.oznaczenie ? n.oznaczenie : n.typ}${n.srednica ? ` · ⌀${n.srednica}mm` : ''}
            </div>
            <div style="font-size:11px;color:var(--dim);margin-top:1px">
              ${n.lokalizacja ? '📍 '+n.lokalizacja : 'brak lokalizacji'}
            </div>
            ${n.uwagi ? `<div style="font-size:11px;color:var(--dim);margin-top:2px;font-style:italic">${n.uwagi}</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:17px;font-weight:800;color:${brakDostepnych?'var(--red)':'var(--green)'};line-height:1">${n.dostepne}/${n.ilosc}</div>
            <div style="font-size:10px;color:var(--dim)">dostępne</div>
          </div>
        </div>
        <div style="margin-top:6px">
          <span style="background:${meta.bg};color:${meta.color};border-radius:8px;padding:2px 8px;font-size:11px;font-weight:700">${meta.icon} ${meta.label}</span>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
          <button class="btn btn-accent" style="flex:1;min-width:90px;padding:8px;font-size:12px" ${brakDostepnych||n.status==='zepsute'?'disabled style="opacity:.4"':''}
            onclick='setState({narzSkrawWypozyczModal:${JSON.stringify(n).replace(/'/g,"&#39;")}})'>
            📤 Wypożycz
          </button>
          <button class="btn-sm" style="background:rgba(52,152,219,.12);color:var(--blue);border-color:var(--blue)"
            onclick="setState({narzSkrawHistModal:${n.id}})">📋</button>
          <button class="btn-sm" style="background:rgba(52,152,219,.12);color:var(--blue);border-color:var(--blue)"
            onclick='setState({narzSkrawEditModal:${JSON.stringify(n).replace(/'/g,"&#39;")}})'>✏</button>
          <button class="btn-sm btn-red" onclick="usunNarzSkraw(${n.id})">🗑</button>
        </div>
      </div>`;
    });
  });
  return html;
}

// ─── Widok: Aktywne wypożyczenia ────────────────────────────────────────────
function renderNarzSkrawWypozyczeniaList() {
  if (state.narzSkrawWypLoading) return `<div class="spinner">⏳</div>`;
  const lista = state.narzSkrawWypAktywne || [];
  let html = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div class="section-hdr" style="margin-bottom:0">📤 Aktywne wypożyczenia (${lista.length})</div>
    <button class="btn-sm btn-accent" onclick="loadNarzSkrawWypozyczenia()">🔄</button>
  </div>`;
  if (!lista.length) return html + `<div class="card" style="text-align:center;padding:28px">
    <div style="font-size:36px;margin-bottom:8px">✅</div>
    <div style="color:var(--dim)">Brak aktywnych wypożyczeń – wszystko zwrócone</div>
  </div>`;

  lista.forEach(w => {
    const dni = Math.floor((Date.now() - new Date(w.data_wypozyczenia.replace(' ','T'))) / 86400000);
    const dlugo = dni >= 7;
    html += `
    <div class="card" style="padding:10px 12px;margin-bottom:6px;${dlugo?'border-left:3px solid var(--orange)':''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px">${w.narzedzie_oznaczenie || w.narzedzie_typ}${w.narzedzie_srednica?` · ⌀${w.narzedzie_srednica}mm`:''}</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:5px;align-items:center">
            <span style="background:rgba(52,152,219,.12);color:var(--blue);border-radius:8px;padding:2px 8px;font-size:12px;font-weight:700">
              📤 ${w.ilosc} szt.
            </span>
            <span style="font-size:11px;color:var(--accent);font-weight:600">👤 ${w.wypozyczyl_imie}</span>
            ${w.zlecenie_nr ? `<span style="font-size:11px;color:var(--dim)">${w.zlecenie_nr}</span>` : ''}
            <span style="font-size:10px;color:${dlugo?'var(--orange)':'var(--dim)'};font-weight:${dlugo?700:400}">
              ${(w.data_wypozyczenia||'').slice(0,16).replace('T',' ')} ${dlugo?`(${dni} dni)`:''}
            </span>
          </div>
          ${w.uwagi ? `<div style="font-size:11px;color:var(--dim);margin-top:3px;font-style:italic">${w.uwagi}</div>` : ''}
        </div>
        <button class="btn-sm" style="flex-shrink:0;margin-left:8px;background:rgba(39,174,96,.1);color:var(--green);border-color:var(--green)"
          onclick="zwrocNarzSkraw(${w.id})">↩ Zwróć</button>
      </div>
    </div>`;
  });
  return html;
}

// ─── Widok: Historia ─────────────────────────────────────────────────────────
function renderNarzSkrawHistoriaList() {
  if (state.narzSkrawHistLoading) return `<div class="spinner">⏳</div>`;
  const lista = state.narzSkrawHistoria || [];
  let html = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div class="section-hdr" style="margin-bottom:0">📋 Historia wypożyczeń (${lista.length})</div>
    <button class="btn-sm btn-accent" onclick="loadNarzSkrawHistoria()">🔄</button>
  </div>`;
  if (!lista.length) return html + `<div class="card" style="text-align:center;padding:24px;color:var(--dim)">Brak historii</div>`;

  lista.forEach(w => {
    const zwrocone = w.status === 'zwrocone';
    html += `
    <div class="card" style="padding:10px 12px;margin-bottom:6px;opacity:${zwrocone?0.75:1}">
      <div style="font-weight:700;font-size:13px">${w.narzedzie_oznaczenie || w.narzedzie_typ}${w.narzedzie_srednica?` · ⌀${w.narzedzie_srednica}mm`:''}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:5px;align-items:center">
        <span style="background:${zwrocone?'rgba(39,174,96,.12)':'rgba(52,152,219,.12)'};color:${zwrocone?'var(--green)':'var(--blue)'};border-radius:8px;padding:2px 8px;font-size:12px;font-weight:700">
          ${zwrocone?'↩ zwrócono':'📤 wypożyczone'} · ${w.ilosc} szt.
        </span>
        <span style="font-size:11px;color:var(--accent)">👤 ${w.wypozyczyl_imie}</span>
        ${w.zlecenie_nr ? `<span style="font-size:11px;color:var(--dim)">${w.zlecenie_nr}</span>` : ''}
      </div>
      <div style="font-size:10px;color:var(--dim);margin-top:4px">
        Wypożyczono: ${(w.data_wypozyczenia||'').slice(0,16).replace('T',' ')}
        ${zwrocone ? ` · Zwrócono: ${(w.data_zwrotu||'').slice(0,16).replace('T',' ')} przez ${w.zwrocil_imie||'-'}` : ''}
      </div>
      ${w.uwagi ? `<div style="font-size:11px;color:var(--dim);margin-top:3px;font-style:italic">${w.uwagi}</div>` : ''}
    </div>`;
  });
  return html;
}

// ─── Modal: szczegóły / historia jednego narzędzia ──────────────────────────
function renderNarzSkrawHistModal() {
  const nid = state.narzSkrawHistModal;
  if (!nid) return '';
  if (!state['_nskrHist_'+nid]) {
    get(`/api/narzedzia-skrawajace/${nid}/historia`).then(r => {
      setState({['_nskrHist_'+nid]: r}, true);
      render();
    }).catch(() => setState({['_nskrHist_'+nid]: []}, true));
  }
  const hist = state['_nskrHist_'+nid] || [];
  return `
  <div class="modal-overlay" onclick="if(event.target===this)setState({narzSkrawHistModal:null})">
    <div class="modal">
      <button class="modal-close" onclick="setState({narzSkrawHistModal:null})">×</button>
      <h3>📋 Historia narzędzia</h3>
      ${!hist.length ? `<div style="color:var(--dim);padding:16px 0;text-align:center">Brak wypożyczeń tego narzędzia</div>` : hist.map(w => `
        <div style="border-bottom:1px solid var(--border);padding:8px 0;font-size:12px">
          <b>${w.wypozyczyl_imie}</b> · ${w.ilosc} szt. · ${(w.data_wypozyczenia||'').slice(0,16).replace('T',' ')}
          ${w.status==='zwrocone' ? `<br><span style="color:var(--green)">↩ zwrot ${(w.data_zwrotu||'').slice(0,16).replace('T',' ')} (${w.zwrocil_imie||'-'})</span>` : `<br><span style="color:var(--blue)">📤 w użyciu</span>`}
        </div>`).join('')}
      <button class="btn btn-outline" style="margin-top:14px" onclick="setState({narzSkrawHistModal:null})">Zamknij</button>
    </div>
  </div>`;
}

// ─── Modal: Wypożycz ─────────────────────────────────────────────────────────
function renderNarzSkrawWypozyczModal() {
  const n = state.narzSkrawWypozyczModal;
  if (!n) return '';
  return `
  <div class="modal-overlay" onclick="if(event.target===this)setState({narzSkrawWypozyczModal:null})">
    <div class="modal">
      <button class="modal-close" onclick="setState({narzSkrawWypozyczModal:null})">×</button>
      <h3>📤 Wypożycz narzędzie</h3>
      <div style="background:var(--entry);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:16px">
        <div style="font-weight:700;font-size:15px">${n.oznaczenie || n.typ}</div>
        <div style="font-size:11px;color:var(--dim);margin-top:2px">${n.typ}${n.srednica?` · ⌀${n.srednica}mm`:''}</div>
        <div style="margin-top:8px;font-size:13px">Dostępne: <b style="color:var(--green)">${n.dostepne}</b> / ${n.ilosc} szt.</div>
      </div>
      <div class="field">
        <label>Kto wypożycza *</label>
        <input id="nskr-wyp-kto" type="text" placeholder="Imię i nazwisko" value="${(state.user && state.user.full_name) || ''}"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div class="field">
        <label>Ilość</label>
        <input id="nskr-wyp-ilosc" type="number" min="1" step="1" max="${n.dostepne}" value="1"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:18px;font-weight:700;box-sizing:border-box;text-align:center">
      </div>
      <div class="field">
        <label>Nr zlecenia (opcjonalnie)</label>
        <input id="nskr-wyp-zlecenie" type="text" placeholder="np. G24-001"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div class="field">
        <label>Uwagi</label>
        <input id="nskr-wyp-uwagi" type="text" placeholder="opcjonalnie"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-accent" style="flex:1;padding:14px" onclick="wypozyczNarzSkraw(${n.id})">📤 Wypożycz</button>
        <button class="btn btn-outline" style="padding:14px 18px" onclick="setState({narzSkrawWypozyczModal:null})">Anuluj</button>
      </div>
    </div>
  </div>`;
}

// ─── Modal: Edytuj ───────────────────────────────────────────────────────────
function renderNarzSkrawEditModal() {
  const n = state.narzSkrawEditModal;
  if (!n) return '';
  const typy = state.narzSkrawTypy || NARZ_SKRAW_TYPY_FALLBACK;
  return `
  <div class="modal-overlay" onclick="if(event.target===this)setState({narzSkrawEditModal:null})">
    <div class="modal">
      <button class="modal-close" onclick="setState({narzSkrawEditModal:null})">×</button>
      <h3>✏ Edytuj narzędzie</h3>
      <div class="field">
        <label>Typ</label>
        <select id="nske-typ" style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 8px;font-size:13px">
          ${typy.map(t=>`<option ${t===n.typ?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Oznaczenie / kod</label>
        <input id="nske-oznaczenie" type="text" value="${n.oznaczenie||''}"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="field">
          <label>Średnica (mm)</label>
          <input id="nske-srednica" type="number" min="0" step="0.01" value="${n.srednica??''}"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
        </div>
        <div class="field">
          <label>Ilość (łącznie)</label>
          <input id="nske-ilosc" type="number" min="0" step="1" value="${n.ilosc}"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
        </div>
      </div>
      <div class="field">
        <label>Stan</label>
        <select id="nske-status" style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 8px;font-size:13px">
          <option value="sprawne" ${n.status==='sprawne'?'selected':''}>🟢 Sprawne</option>
          <option value="zepsute" ${n.status==='zepsute'?'selected':''}>🔴 Zepsute</option>
          <option value="zamowione" ${n.status==='zamowione'?'selected':''}>🟠 Zamówione</option>
        </select>
      </div>
      <div class="field">
        <label>Lokalizacja</label>
        <input id="nske-lok" type="text" value="${n.lokalizacja||''}" placeholder="np. Szafa A, Półka 3"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div class="field">
        <label>Uwagi</label>
        <input id="nske-uwagi" type="text" value="${n.uwagi||''}"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-accent" style="flex:1" onclick="saveNarzSkrawEdit(${n.id})">💾 Zapisz</button>
        <button class="btn btn-outline" style="padding:14px 18px" onclick="setState({narzSkrawEditModal:null})">Anuluj</button>
      </div>
    </div>
  </div>`;
}

// ─── Modal: Dodaj ────────────────────────────────────────────────────────────
function renderNarzSkrawDodajModal() {
  const typy = state.narzSkrawTypy || NARZ_SKRAW_TYPY_FALLBACK;
  return `
  <div id="nskr-dodaj-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)hidePanel('nskr-dodaj-modal')">
    <div class="modal">
      <button class="modal-close" onclick="hidePanel('nskr-dodaj-modal')">×</button>
      <h3>＋ Dodaj narzędzie skrawające</h3>
      <div class="field">
        <label>Typ *</label>
        <select id="nskr-typ" style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 8px;font-size:13px">
          ${typy.map(t=>`<option>${t}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Oznaczenie / kod (opcjonalnie)</label>
        <input id="nskr-oznaczenie" type="text" placeholder="np. HSS-Z8, P25-CCMT09" autocomplete="off"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="field">
          <label>Średnica (mm)</label>
          <input id="nskr-srednica" type="number" min="0" step="0.01" placeholder="np. 8" autocomplete="off"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
        </div>
        <div class="field">
          <label>Ilość *</label>
          <input id="nskr-ilosc" type="number" min="1" step="1" value="1" autocomplete="off"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
        </div>
      </div>
      <div class="field">
        <label>Stan</label>
        <select id="nskr-status" style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 8px;font-size:13px">
          <option value="sprawne">🟢 Sprawne</option>
          <option value="zepsute">🔴 Zepsute</option>
          <option value="zamowione">🟠 Zamówione</option>
        </select>
      </div>
      <div class="field">
        <label>Lokalizacja</label>
        <input id="nskr-lok" type="text" placeholder="np. Szafa A, Półka 2" autocomplete="off"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div class="field">
        <label>Uwagi</label>
        <input id="nskr-uwagi" type="text" placeholder="opcjonalnie" autocomplete="off"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-accent" style="flex:1" onclick="saveNarzSkrawDodaj()">＋ Dodaj</button>
        <button class="btn btn-outline" style="padding:14px 18px" onclick="hidePanel('nskr-dodaj-modal')">Anuluj</button>
      </div>
    </div>
  </div>`;
}

// ─── Actions ─────────────────────────────────────────────────────────────────
async function saveNarzSkrawDodaj() {
  const typ = document.getElementById('nskr-typ').value;
  const oznaczenie = document.getElementById('nskr-oznaczenie').value.trim();
  const srednicaRaw = document.getElementById('nskr-srednica').value;
  const ilosc = parseInt(document.getElementById('nskr-ilosc').value, 10) || 1;
  const status = document.getElementById('nskr-status').value;
  const lokalizacja = document.getElementById('nskr-lok').value.trim();
  const uwagi = document.getElementById('nskr-uwagi').value.trim();
  try {
    await post('/api/narzedzia-skrawajace', {
      typ, oznaczenie, srednica: srednicaRaw ? parseFloat(srednicaRaw) : null,
      ilosc, status, lokalizacja, uwagi
    });
    hidePanel('nskr-dodaj-modal');
    ['nskr-oznaczenie','nskr-srednica','nskr-lok','nskr-uwagi'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
    document.getElementById('nskr-ilosc').value = '1';
    await loadNarzSkrawAll();
    await loadNarzSkrawCount();
  } catch (e) {
    alert('Błąd dodawania: ' + e.message);
  }
}

async function saveNarzSkrawEdit(id) {
  const typ = document.getElementById('nske-typ').value;
  const oznaczenie = document.getElementById('nske-oznaczenie').value.trim();
  const srednicaRaw = document.getElementById('nske-srednica').value;
  const ilosc = parseInt(document.getElementById('nske-ilosc').value, 10);
  const status = document.getElementById('nske-status').value;
  const lokalizacja = document.getElementById('nske-lok').value.trim();
  const uwagi = document.getElementById('nske-uwagi').value.trim();
  try {
    await put(`/api/narzedzia-skrawajace/${id}`, {
      typ, oznaczenie, srednica: srednicaRaw ? parseFloat(srednicaRaw) : null,
      ilosc, status, lokalizacja, uwagi
    });
    setState({narzSkrawEditModal: null}, true);
    await loadNarzSkrawAll();
    await loadNarzSkrawCount();
  } catch (e) {
    alert('Błąd zapisu: ' + e.message);
  }
}

async function usunNarzSkraw(id) {
  if (!confirm('Usunąć to narzędzie z bazy?')) return;
  try {
    await del('/api/narzedzia-skrawajace/' + id);
    await loadNarzSkrawAll();
    await loadNarzSkrawCount();
  } catch (e) {
    alert('Błąd usuwania: ' + e.message);
  }
}

async function wypozyczNarzSkraw(id) {
  const kto = document.getElementById('nskr-wyp-kto').value.trim();
  const ilosc = parseInt(document.getElementById('nskr-wyp-ilosc').value, 10) || 1;
  const zlecenie_nr = document.getElementById('nskr-wyp-zlecenie').value.trim();
  const uwagi = document.getElementById('nskr-wyp-uwagi').value.trim();
  if (!kto) { alert('Podaj kto wypożycza narzędzie'); return; }
  try {
    await post(`/api/narzedzia-skrawajace/${id}/wypozycz`, {
      ilosc, user_id: state.user ? state.user.id : null, user_name: kto, zlecenie_nr, uwagi
    });
    setState({narzSkrawWypozyczModal: null}, true);
    await loadNarzSkrawAll();
    await loadNarzSkrawCount();
  } catch (e) {
    alert('Błąd wypożyczenia: ' + e.message);
  }
}

async function zwrocNarzSkraw(wypozyczenieId) {
  const kto = (state.user && state.user.full_name) || prompt('Kto zwraca narzędzie?') || '';
  try {
    await patch(`/api/narzedzia-skrawajace-wypozyczenia/${wypozyczenieId}/zwrot`, {
      user_id: state.user ? state.user.id : null, user_name: kto
    });
    await loadNarzSkrawWypozyczenia();
    await loadNarzSkrawAll();
    await loadNarzSkrawCount();
  } catch (e) {
    alert('Błąd zwrotu: ' + e.message);
  }
}
