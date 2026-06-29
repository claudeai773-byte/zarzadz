//  TAB: NARZĘDZIA SKRAWAJĄCE (Tool Manager)
// ══════════════════════════════════════════════════════════════
// Baza narzędzi skrawających (frezy, wytaczadła, głowice itd.) z ilością,
// średnicą, stanem (sprawne/zepsute/zamówione), zdjęciem i pełną historią
// wypożyczeń/zwrotów (kto i kiedy). Typy narzędzi są w pełni edytowalne
// (dodawanie / zmiana nazwy / usuwanie) z poziomu interfejsu.

const NARZ_SKRAW_TYPY_FALLBACK = [
  "Frez wykańczający", "Frez zgrubny", "Frez kulowy", "Frez do gwintów",
  "Głowica frezarska", "Płytka do głowicy",
  "Wytaczadło zgrubne", "Wytaczadło wykańczające",
  "Nóż tokarski zgrubny", "Nóż tokarski wykańczający", "Nóż do gwintowania",
  "Nóż do przecinania", "Płytka tokarska",
  "Wiertło", "Wiertło centrujące", "Pogłębiacz",
  "Gwintownik", "Narzynka", "Rozwiertak",
  "Imadło / oprawka", "Tuleja zaciskowa", "Inne",
].map((nazwa, i) => ({id: -(i + 1), nazwa}));

function narzSkrawStatusMeta(status) {
  if (status === 'zepsute')   return {label: 'Zepsute',   color: 'var(--red)',    bg: 'rgba(231,76,60,.12)',  icon: '🔴'};
  if (status === 'zamowione') return {label: 'Zamówione', color: 'var(--orange)', bg: 'rgba(230,126,0,.12)',  icon: '🟠'};
  return {label: 'Sprawne', color: 'var(--green)', bg: 'rgba(39,174,96,.12)', icon: '🟢'};
}

// Lista nazw typów (string[]) – do <select> i filtrowania, niezależnie od tego
// czy state.narzSkrawTypy to obiekty {id,nazwa} (z bazy) czy fallback.
function narzSkrawTypyNazwy() {
  const typy = state.narzSkrawTypy || NARZ_SKRAW_TYPY_FALLBACK;
  return typy.map(t => (typeof t === 'string' ? t : t.nazwa));
}

// ─── Loaders ────────────────────────────────────────────────────────────────
async function loadNarzSkrawTypy(force) {
  if (state.narzSkrawTypy && !force) return;
  try {
    const r = await get('/api/narzedzia-skrawajace/typy');
    setState({narzSkrawTypy: r}, true);
  } catch (e) {
    setState({narzSkrawTypy: NARZ_SKRAW_TYPY_FALLBACK}, true);
  }
}

async function loadNarzSkrawAll() {
  setState({narzSkrawSearching: true}, true);
  _renderNarzSkrawListaWrap();
  try {
    const q = state.narzSkrawSearch || '';
    const typ = state.narzSkrawFiltrTyp || '';
    const status = state.narzSkrawFiltrStatus || '';
    const r = await get(`/api/narzedzia-skrawajace?q=${encodeURIComponent(q)}&typ=${encodeURIComponent(typ)}&status=${encodeURIComponent(status)}`);
    setState({narzSkrawResults: r, narzSkrawSearching: false}, true);
  } catch (e) {
    setState({narzSkrawResults: [], narzSkrawSearching: false}, true);
  }
  _renderNarzSkrawListaWrap();
}

async function loadNarzSkrawCount() {
  try {
    const r = await get('/api/narzedzia-skrawajace/count');
    setState({narzSkrawCount: r}, true);
  } catch (e) { /* ignoruj */ }
}

// Po każdej akcji (dodaj/edytuj/usuń/wypożycz/zwróć) trzeba odświeżyć i listę,
// i licznik w nagłówku. To dwa niezależne GET-y – odpalone po sobie (await,
// await) sumują czas oczekiwania na sieci; równolegle przez Promise.all to
// w praktyce czas tylko jednego z nich. Na końcu jeden render() – loadNarzSkrawCount
// ustawia stan z noRender:true (żeby nie przerywać ewentualnego "searching"
// w trakcie loadNarzSkrawAll), więc bez tego ręcznego render() na końcu liczniki
// w nagłówku (zepsute/zamówione/wypożyczone/do regeneracji) nie odświeżałyby się
// wizualnie od razu po akcji.
async function narzSkrawOdswiezListeIicznik() {
  await Promise.all([loadNarzSkrawAll(), loadNarzSkrawCount()]);
  render();
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

async function loadNarzSkrawRegeneracja() {
  setState({narzSkrawRegenLoading: true}, true);
  try {
    const r = await get('/api/narzedzia-skrawajace-regeneracja');
    setState({narzSkrawRegenLista: r, narzSkrawRegenLoading: false});
  } catch (e) {
    setState({narzSkrawRegenLista: [], narzSkrawRegenLoading: false});
  }
}

// ── Wyszukiwanie: aktualizujemy TYLKO kontener wyników, nigdy cały input ──────
// To jest kluczowa naprawa: poprzednio każdy znak wpisany w polu szukania
// wywoływał setState(...) BEZ noRender, co przebudowywało cały <input> w DOM
// (przez app.innerHTML = ...) i na telefonie to natychmiast chowa klawiaturę /
// "wyrzuca" z pola. Teraz pole tekstowe nigdy nie jest przerysowywane podczas
// pisania – tylko karty wyników pod nim, przez bezpośrednie innerHTML małego
// kontenera.
function _renderNarzSkrawListaWrap() {
  const wrap = document.getElementById('nskr-lista-wrap');
  if (!wrap) return; // np. user zmienił widok w międzyczasie – nic nie robimy
  wrap.innerHTML = renderNarzSkrawListaWynikow();
}

function searchNarzSkraw() {
  const el = document.getElementById('nskr-search');
  setState({narzSkrawSearch: el ? el.value : ''}, true);
  loadNarzSkrawAll();
}

function switchNarzSkrawView(view) {
  setState({narzSkrawView: view}, true);
  if (view === 'lista')       loadNarzSkrawAll();
  if (view === 'dobor')       { loadNarzSkrawAll(); loadOprawki(); }
  if (view === 'oprawki')     loadOprawki();
  if (view === 'wypozyczenia') loadNarzSkrawWypozyczenia();
  if (view === 'historia')    loadNarzSkrawHistoria();
  if (view === 'regeneracja') loadNarzSkrawRegeneracja();
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
      ${cnt && cnt.do_regeneracji > 0 ? `<span style="background:rgba(155,89,182,.15);color:var(--purple);border-radius:10px;padding:3px 10px;font-size:11px;font-weight:700">🔧 ${cnt.do_regeneracji} do regeneracji</span>` : ''}
      <span style="font-size:11px;color:var(--dim)">${cnt ? cnt.total+' poz.' : ''}</span>
    </div>
  </div>
  <div class="sub-tabs" style="margin-bottom:12px">
    <button class="sub-tab ${view==='lista'?'active':''}" onclick="switchNarzSkrawView('lista')">📦 Baza narzędzi</button>
    <button class="sub-tab ${view==='oprawki'?'active':''}" onclick="switchNarzSkrawView('oprawki')">🔩 Oprawki</button>
    <button class="sub-tab ${view==='dobor'?'active':''}" onclick="switchNarzSkrawView('dobor')">🎯 Dobór narzędzia</button>
    <button class="sub-tab ${view==='wypozyczenia'?'active':''}" onclick="switchNarzSkrawView('wypozyczenia')">📤 Aktywne wypożyczenia${cnt && cnt.wypozyczone ? ' ('+cnt.wypozyczone+')' : ''}</button>
    <button class="sub-tab ${view==='regeneracja'?'active':''}" onclick="switchNarzSkrawView('regeneracja')">🔧 Do regeneracji${cnt && cnt.do_regeneracji ? ' ('+cnt.do_regeneracji+')' : ''}</button>
    <button class="sub-tab ${view==='historia'?'active':''}" onclick="switchNarzSkrawView('historia')">📋 Historia</button>
  </div>`;

  if (view === 'lista')         html += renderNarzSkrawLista();
  if (view === 'oprawki')       html += renderOprawkiWidok();
  if (view === 'dobor')         html += renderNarzSkrawDobor();
  if (view === 'wypozyczenia')  html += renderNarzSkrawWypozyczeniaList();
  if (view === 'regeneracja')   html += renderNarzSkrawRegeneracjaList();
  if (view === 'historia')      html += renderNarzSkrawHistoriaList();

  if (state.narzSkrawWypozyczModal) html += renderNarzSkrawWypozyczModal();
  if (state.narzSkrawZwrotModal)    html += renderNarzSkrawZwrotModal();
  if (state.narzSkrawEditModal)     html += renderNarzSkrawEditModal();
  if (state.narzSkrawHistModal)     html += renderNarzSkrawHistModal();
  if (state.narzSkrawTypyModal)     html += renderNarzSkrawTypyModal();
  html += renderNarzSkrawDodajModal();

  return html;
}

// ─── Widok: Baza narzędzi ───────────────────────────────────────────────────
// Podzielony na: stały "szkielet" (search input + filtry, renderowany tylko
// przez główny render()) i renderNarzSkrawListaWynikow() (tylko karty wyników,
// odświeżane samodzielnie przez _renderNarzSkrawListaWrap() bez ruszania inputa).
function renderNarzSkrawLista() {
  const typyNazwy = narzSkrawTypyNazwy();

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
      ${typyNazwy.map(t => `<option value="${t}" ${state.narzSkrawFiltrTyp===t?'selected':''}>${t}</option>`).join('')}
    </select>
    <select onchange="setState({narzSkrawFiltrStatus:this.value},true);loadNarzSkrawAll()"
      style="flex:1;min-width:140px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:7px 8px;font-size:12px">
      <option value="">Wszystkie statusy</option>
      <option value="sprawne" ${state.narzSkrawFiltrStatus==='sprawne'?'selected':''}>🟢 Sprawne</option>
      <option value="zepsute" ${state.narzSkrawFiltrStatus==='zepsute'?'selected':''}>🔴 Zepsute</option>
      <option value="zamowione" ${state.narzSkrawFiltrStatus==='zamowione'?'selected':''}>🟠 Zamówione</option>
    </select>
    <button class="btn-sm btn-outline" style="white-space:nowrap" onclick="setState({narzSkrawTypyModal:true})">🏷 Typy narzędzi</button>
  </div>
  <div id="nskr-lista-wrap">${renderNarzSkrawListaWynikow()}</div>`;

  return html;
}

function renderNarzSkrawListaWynikow() {
  const items = state.narzSkrawResults || [];

  if (state.narzSkrawSearching) {
    return `<div style="text-align:center;padding:30px;color:var(--dim)">⏳</div>`;
  }
  if (!items.length) {
    return `<div class="card" style="text-align:center;padding:30px">
      <div style="font-size:36px;margin-bottom:8px">📭</div>
      <div style="color:var(--dim)">Brak narzędzi – dodaj pierwszą pozycję</div>
    </div>`;
  }

  const byTyp = {};
  items.forEach(n => { (byTyp[n.typ] = byTyp[n.typ] || []).push(n); });

  let html = '';
  Object.keys(byTyp).sort().forEach(typ => {
    html += `<div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;
      letter-spacing:.06em;margin:14px 0 6px;padding-left:4px">${typ}</div>`;
    byTyp[typ].forEach(n => {
      const meta = narzSkrawStatusMeta(n.status);
      const brakDostepnych = n.dostepne <= 0;
      html += `
      <div class="card" style="padding:10px 12px;margin-bottom:6px;${n.status==='zepsute'?'border-left:3px solid var(--red)':n.status==='zamowione'?'border-left:3px solid var(--orange)':''}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          ${n.zdjecie_url ? `<img src="${n.zdjecie_url}" alt="" style="width:46px;height:46px;border-radius:8px;object-fit:cover;flex-shrink:0;border:1px solid var(--border);cursor:pointer" onclick="window.open('${n.zdjecie_url}','_blank')">` : ''}
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
          onclick='setState({narzSkrawZwrotModal:${JSON.stringify(w).replace(/'/g,"&#39;")}})'>↩ Zwróć</button>
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
    const doRegen = w.status === 'do_regeneracji';
    const badge = doRegen
      ? {bg: 'rgba(155,89,182,.12)', color: 'var(--purple)', label: (w.stan_zwrotu === 'uszkodzone' ? '🔴 uszkodzone' : '🟣 do regeneracji')}
      : zwrocone
        ? {bg: 'rgba(39,174,96,.12)', color: 'var(--green)', label: '↩ zwrócono'}
        : {bg: 'rgba(52,152,219,.12)', color: 'var(--blue)', label: '📤 wypożyczone'};
    html += `
    <div class="card" style="padding:10px 12px;margin-bottom:6px;opacity:${zwrocone?0.75:1}">
      <div style="font-weight:700;font-size:13px">${w.narzedzie_oznaczenie || w.narzedzie_typ}${w.narzedzie_srednica?` · ⌀${w.narzedzie_srednica}mm`:''}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:5px;align-items:center">
        <span style="background:${badge.bg};color:${badge.color};border-radius:8px;padding:2px 8px;font-size:12px;font-weight:700">
          ${badge.label} · ${w.ilosc} szt.
        </span>
        <span style="font-size:11px;color:var(--accent)">👤 ${w.wypozyczyl_imie}</span>
        ${w.zlecenie_nr ? `<span style="font-size:11px;color:var(--dim)">${w.zlecenie_nr}</span>` : ''}
      </div>
      <div style="font-size:10px;color:var(--dim);margin-top:4px">
        Wypożyczono: ${(w.data_wypozyczenia||'').slice(0,16).replace('T',' ')}
        ${(zwrocone || doRegen) ? ` · Zwrócono: ${(w.data_zwrotu||'').slice(0,16).replace('T',' ')} przez ${w.zwrocil_imie||'-'}` : ''}
      </div>
      ${w.uwagi ? `<div style="font-size:11px;color:var(--dim);margin-top:3px;font-style:italic">${w.uwagi}</div>` : ''}
      ${w.uwagi_zwrotu ? `<div style="font-size:11px;color:${badge.color};margin-top:3px;font-style:italic">💬 ${w.uwagi_zwrotu}</div>` : ''}
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

// ─── Widok: Do regeneracji ───────────────────────────────────────────────────
function renderNarzSkrawRegeneracjaList() {
  if (state.narzSkrawRegenLoading) return `<div class="spinner">⏳</div>`;
  const lista = state.narzSkrawRegenLista || [];
  let html = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div class="section-hdr" style="margin-bottom:0">🔧 Do regeneracji (${lista.length})</div>
    <button class="btn-sm btn-accent" onclick="loadNarzSkrawRegeneracja()">🔄</button>
  </div>`;
  if (!lista.length) return html + `<div class="card" style="text-align:center;padding:28px">
    <div style="font-size:36px;margin-bottom:8px">✅</div>
    <div style="color:var(--dim)">Brak narzędzi czekających na regenerację</div>
  </div>`;

  lista.forEach(w => {
    const isUszkodzone = w.stan_zwrotu === 'uszkodzone';
    const meta = isUszkodzone
      ? {label: 'Uszkodzone', color: 'var(--red)', icon: '🔴'}
      : {label: 'Do regeneracji', color: 'var(--purple)', icon: '🟣'};
    html += `
    <div class="card" style="padding:10px 12px;margin-bottom:6px;border-left:3px solid ${meta.color}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        ${w.narzedzie_zdjecie_url ? `<img src="${w.narzedzie_zdjecie_url}" alt="" style="width:42px;height:42px;border-radius:8px;object-fit:cover;flex-shrink:0;border:1px solid var(--border)">` : ''}
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px">${w.narzedzie_oznaczenie || w.narzedzie_typ}${w.narzedzie_srednica?` · ⌀${w.narzedzie_srednica}mm`:''}</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:5px;align-items:center">
            <span style="background:${meta.color}22;color:${meta.color};border-radius:8px;padding:2px 8px;font-size:12px;font-weight:700">${meta.icon} ${meta.label}</span>
            <span style="font-size:11px;color:var(--dim)">${w.ilosc} szt.</span>
          </div>
        </div>
      </div>
      <div style="margin-top:8px;font-size:12px;line-height:1.5">
        <div>👤 Wypożyczył: <b style="color:var(--accent)">${w.wypozyczyl_imie}</b></div>
        <div>↩ Zwrócił: <b style="color:var(--accent)">${w.zwrocil_imie || '-'}</b> · ${(w.data_zwrotu||'').slice(0,16).replace('T',' ')}</div>
      </div>
      ${w.uwagi_zwrotu ? `<div style="font-size:12px;color:var(--text);margin-top:6px;background:var(--entry);border-radius:8px;padding:8px 10px;font-style:italic">💬 ${w.uwagi_zwrotu}</div>` : ''}
      <button class="btn btn-accent" style="width:100%;margin-top:10px;padding:8px;font-size:12px" onclick="narzSkrawRegeneracjaZakonczona(${w.id})">✅ Oznacz jako sprawne</button>
    </div>`;
  });
  return html;
}

async function narzSkrawRegeneracjaZakonczona(wid) {
  if (!confirm('Oznaczyć narzędzie jako naprawione i ponownie sprawne?')) return;
  try {
    await patch(`/api/narzedzia-skrawajace-wypozyczenia/${wid}/regeneracja-zakonczona`, {
      user_id: state.user ? state.user.id : null, user_name: (state.user && state.user.full_name) || ''
    });
    await loadNarzSkrawRegeneracja();
    await loadNarzSkrawCount();
  } catch (e) {
    alert('Błąd: ' + e.message);
  }
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

// ─── Modal: Zwrot (ok / uszkodzone / regeneracja) ───────────────────────────
// Zmiana radiobuttona NIE wywołuje setState/render – to przebudowałoby cały
// modal i wymazało tekst już wpisany w polu "Uwagi" (ten sam problem co przy
// wyszukiwaniu – patrz komentarz wyżej). Zamiast tego narzSkrawZwrotZmianaStanu()
// tylko podświetla wybraną opcję i przełącza etykietę/placeholder pola uwag
// bezpośrednio w DOM. Wybrany stan trzymamy w zmiennej module-scope (nie w
// state), bo to czysto UI-lokalna sprawa modalu, zerowana przy zamknięciu.
let _nskrZwrotStan = 'ok';

function renderNarzSkrawZwrotModal() {
  const w = state.narzSkrawZwrotModal;
  if (!w) return '';
  _nskrZwrotStan = 'ok'; // reset przy każdym otwarciu modalu dla innego wypożyczenia
  const opcje = [
    {v: 'ok',          label: '🟢 Sprawne',     desc: 'Narzędzie wraca w dobrym stanie'},
    {v: 'uszkodzone',  label: '🔴 Uszkodzone',  desc: 'Trafia do zakładki „Do regeneracji”'},
    {v: 'regeneracja', label: '🟣 Regeneracja', desc: 'Wymaga ostrzenia/serwisu – też do „Do regeneracji”'},
  ];
  return `
  <div class="modal-overlay" onclick="if(event.target===this){setState({narzSkrawZwrotModal:null})}">
    <div class="modal">
      <button class="modal-close" onclick="setState({narzSkrawZwrotModal:null})">×</button>
      <h3>↩ Zwrot narzędzia</h3>
      <div style="background:var(--entry);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:16px">
        <div style="font-weight:700;font-size:15px">${w.narzedzie_oznaczenie || w.narzedzie_typ}</div>
        <div style="font-size:11px;color:var(--dim);margin-top:2px">${w.narzedzie_typ}${w.narzedzie_srednica?` · ⌀${w.narzedzie_srednica}mm`:''} · ${w.ilosc} szt.</div>
        <div style="font-size:11px;color:var(--accent);margin-top:4px">👤 wypożyczył: ${w.wypozyczyl_imie}</div>
      </div>
      <div class="field">
        <label>W jakim stanie wraca narzędzie? *</label>
        <div id="nskr-zwrot-opcje" style="display:flex;flex-direction:column;gap:6px">
          ${opcje.map(o => `
            <label data-stan="${o.v}" style="display:flex;align-items:center;gap:10px;background:${o.v==='ok'?'var(--entry)':'transparent'};border:1px solid ${o.v==='ok'?'var(--accent)':'var(--border)'};border-radius:10px;padding:10px 12px;cursor:pointer">
              <input type="radio" name="nskr-zwrot-stan" value="${o.v}" ${o.v==='ok'?'checked':''}
                onchange="narzSkrawZwrotZmianaStanu('${o.v}')" style="width:auto;margin:0">
              <div>
                <div style="font-weight:700;font-size:13px">${o.label}</div>
                <div style="font-size:11px;color:var(--dim)">${o.desc}</div>
              </div>
            </label>`).join('')}
        </div>
      </div>
      <div class="field">
        <label id="nskr-zwrot-uwagi-label">Uwagi (opcjonalnie)</label>
        <input id="nskr-zwrot-uwagi" type="text" placeholder="opcjonalnie"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-accent" style="flex:1;padding:14px" onclick="zwrocNarzSkraw(${w.id})">↩ Zatwierdź zwrot</button>
        <button class="btn btn-outline" style="padding:14px 18px" onclick="setState({narzSkrawZwrotModal:null})">Anuluj</button>
      </div>
    </div>
  </div>`;
}

function narzSkrawZwrotZmianaStanu(stan) {
  _nskrZwrotStan = stan;
  // Podświetl wybraną opcję
  document.querySelectorAll('#nskr-zwrot-opcje label[data-stan]').forEach(el => {
    const active = el.getAttribute('data-stan') === stan;
    el.style.background = active ? 'var(--entry)' : 'transparent';
    el.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
  });
  // Przełącz etykietę/placeholder pola uwag – bez ruszania jego wartości
  const label = document.getElementById('nskr-zwrot-uwagi-label');
  const input = document.getElementById('nskr-zwrot-uwagi');
  const wymagane = stan !== 'ok';
  if (label) label.textContent = wymagane ? 'Uwagi * (co się stało?)' : 'Uwagi (opcjonalnie)';
  if (input) input.placeholder = wymagane ? 'np. pękła płytka, stępione ostrze...' : 'opcjonalnie';
}

// ─── Modal: Edytuj ───────────────────────────────────────────────────────────
function renderNarzSkrawEditModal() {
  const n = state.narzSkrawEditModal;
  if (!n) return '';
  const typyNazwy = narzSkrawTypyNazwy();
  const zdjecieUrl = n._zdjecieNoweUrl !== undefined ? n._zdjecieNoweUrl : (n.zdjecie_url || '');
  return `
  <div class="modal-overlay" onclick="if(event.target===this)setState({narzSkrawEditModal:null})">
    <div class="modal">
      <button class="modal-close" onclick="setState({narzSkrawEditModal:null})">×</button>
      <h3>✏ Edytuj narzędzie</h3>
      <div class="field">
        <label>Typ</label>
        <select id="nske-typ" style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 8px;font-size:13px">
          ${typyNazwy.map(t=>`<option ${t===n.typ?'selected':''}>${t}</option>`).join('')}
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
          <label>Dł. robocza (mm)</label>
          <input id="nske-dlr" type="number" min="0" step="0.1" value="${n.dlugosc_robocza||0}"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
        </div>
      </div>
      <div class="field">
        <label>Do wykonania (operacje)</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          ${['otwór zgrubny','otwór wykańczający','planowanie/kieszeń','gwintowanie'].map(o =>
            `<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
              <input type="checkbox" value="${o}" ${(n.operacje||'').split(',').map(x=>x.trim()).includes(o)?'checked':''} onchange="nskrSyncOperacje('nske-operacje')">
              ${o}
            </label>`
          ).join('')}
        </div>
        <input type="hidden" id="nske-operacje" value="${n.operacje||''}">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="field">
          <label>Typ oprawki</label>
          <select id="nske-typ-opr" style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 8px;font-size:13px">
            <option value="">— brak / nie dotyczy —</option>
            ${['ER16','ER20','ER25','ER32','ER40','Weldon','Uchwyt wiertarski','Trzpień do głowic','Oprawka wytaczadła'].map(t=>`<option value="${t}" ${(n.typ_oprawki||'')==t?'selected':''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Średnica chwytu (mm)</label>
          <input id="nske-sr-chwytu" type="number" min="0" step="0.01" value="${n.srednica_chwytu||0}"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
        </div>
      </div>
      <div class="field">
        <label>Ilość (łącznie)</label>
        <input id="nske-ilosc" type="number" min="0" step="1" value="${n.ilosc}"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
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
      <div class="field">
        <label>Zdjęcie</label>
        <input type="hidden" id="nske-zdjecie-url" value="${zdjecieUrl}">
        <div id="nske-zdjecie-preview" style="margin-bottom:8px;${zdjecieUrl?'':'display:none'}">
          <img src="${zdjecieUrl}" style="max-width:100%;max-height:160px;border-radius:8px;border:1px solid var(--border);display:block">
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn-sm btn-outline" style="flex:1" onclick="document.getElementById('nske-foto-input').click()">📷 ${zdjecieUrl?'Zmień':'Dodaj'} zdjęcie</button>
          ${zdjecieUrl ? `<button type="button" class="btn-sm btn-red" onclick="narzSkrawUsunZdjecieEdit()">🗑</button>` : ''}
        </div>
        <input type="file" id="nske-foto-input" accept="image/*" capture="environment" style="display:none" onchange="narzSkrawZdjecieWybrane(this,'nske')">
        <div id="nske-foto-status" style="font-size:11px;color:var(--dim);margin-top:4px"></div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-accent" style="flex:1" onclick="saveNarzSkrawEdit(${n.id})">💾 Zapisz</button>
        <button class="btn btn-outline" style="padding:14px 18px" onclick="setState({narzSkrawEditModal:null})">Anuluj</button>
      </div>
    </div>
  </div>`;
}

function narzSkrawUsunZdjecieEdit() {
  document.getElementById('nske-zdjecie-url').value = '';
  document.getElementById('nske-zdjecie-preview').style.display = 'none';
  const status = document.getElementById('nske-foto-status');
  if (status) status.textContent = '';
  // odśwież przycisk z "Zmień" na "Dodaj"
  const btn = document.querySelector('#nske-foto-input').parentElement.querySelector('button');
  if (btn) btn.textContent = '📷 Dodaj zdjęcie';
}

// ─── Modal: Zarządzanie typami narzędzi ─────────────────────────────────────
function renderNarzSkrawTypyModal() {
  const typy = state.narzSkrawTypy || NARZ_SKRAW_TYPY_FALLBACK;
  const editId = state.narzSkrawTypEditId;
  return `
  <div class="modal-overlay" onclick="if(event.target===this)setState({narzSkrawTypyModal:null,narzSkrawTypEditId:null})">
    <div class="modal">
      <button class="modal-close" onclick="setState({narzSkrawTypyModal:null,narzSkrawTypEditId:null})">×</button>
      <h3>🏷 Typy narzędzi</h3>
      <div style="display:flex;gap:6px;margin-bottom:14px">
        <input id="nskt-nowy" type="text" placeholder="Nazwa nowego typu, np. Frez fazujący"
          style="flex:1;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px"
          onkeyup="if(event.key==='Enter')dodajTypNarzSkraw()">
        <button class="btn-sm btn-accent" onclick="dodajTypNarzSkraw()">＋</button>
      </div>
      <div style="max-height:340px;overflow-y:auto">
        ${typy.map(t => {
          const isFallback = t.id < 0;
          const isEditing = editId === t.id;
          if (isEditing) {
            return `
            <div style="display:flex;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
              <input id="nskt-edit-${t.id}" type="text" value="${t.nazwa}"
                style="flex:1;background:var(--entry);color:var(--text);border:1px solid var(--accent);border-radius:8px;padding:8px 10px;font-size:13px"
                onkeyup="if(event.key==='Enter')zapiszTypNarzSkraw(${t.id})">
              <button class="btn-sm btn-accent" onclick="zapiszTypNarzSkraw(${t.id})">💾</button>
              <button class="btn-sm btn-outline" onclick="setState({narzSkrawTypEditId:null})">✕</button>
            </div>`;
          }
          return `
          <div style="display:flex;gap:6px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
            <span style="flex:1;font-size:13px">${t.nazwa}</span>
            ${isFallback ? `<span style="font-size:10px;color:var(--dim)">domyślny</span>` : `
              <button class="btn-sm" style="background:rgba(52,152,219,.12);color:var(--blue);border-color:var(--blue)" onclick="setState({narzSkrawTypEditId:${t.id}})">✏</button>
              <button class="btn-sm btn-red" onclick="usunTypNarzSkraw(${t.id},'${t.nazwa.replace(/'/g,"&#39;")}')">🗑</button>
            `}
          </div>`;
        }).join('')}
      </div>
      ${typy.some(t => t.id < 0) ? `<div style="font-size:11px;color:var(--dim);margin-top:10px">
        ⚠ Lista typów nie wczytała się z serwera – pokazano wartości domyślne (tylko do odczytu). Sprawdź połączenie i otwórz to okno ponownie.
      </div>` : ''}
      <button class="btn btn-outline" style="margin-top:14px" onclick="setState({narzSkrawTypyModal:null,narzSkrawTypEditId:null})">Zamknij</button>
    </div>
  </div>`;
}

async function dodajTypNarzSkraw() {
  const el = document.getElementById('nskt-nowy');
  const nazwa = el ? el.value.trim() : '';
  if (!nazwa) { alert('Podaj nazwę typu'); return; }
  try {
    await post('/api/narzedzia-skrawajace/typy', {nazwa});
    if (el) el.value = '';
    await loadNarzSkrawTypy(true);
    render();
  } catch (e) {
    alert('Błąd dodawania typu: ' + e.message);
  }
}

async function zapiszTypNarzSkraw(id) {
  const el = document.getElementById('nskt-edit-' + id);
  const nazwa = el ? el.value.trim() : '';
  if (!nazwa) { alert('Podaj nazwę typu'); return; }
  try {
    await put('/api/narzedzia-skrawajace/typy/' + id, {nazwa});
    setState({narzSkrawTypEditId: null}, true);
    await loadNarzSkrawTypy(true);
    await loadNarzSkrawAll();
    render();
  } catch (e) {
    alert('Błąd zapisu typu: ' + e.message);
  }
}

async function usunTypNarzSkraw(id, nazwa) {
  if (!confirm(`Usunąć typ "${nazwa}"? Możliwe tylko jeśli żadne narzędzie nie ma już tego typu.`)) return;
  try {
    await del('/api/narzedzia-skrawajace/typy/' + id);
    await loadNarzSkrawTypy(true);
    render();
  } catch (e) {
    alert('Błąd usuwania typu: ' + e.message);
  }
}

// ─── Zdjęcie z aparatu / galerii (wspólne dla "Dodaj" i "Edytuj") ───────────
// input[type=file][accept="image/*"][capture="environment"] na telefonie
// otwiera bezpośrednio aparat (zamiast okna wyboru pliku) – capture="environment"
// wybiera tylną kamerę. Po zrobieniu zdjęcia plik jest od razu wgrywany na
// Cloudinary przez nasz backend (multipart -> /api/zdjecie-upload), a w pole
// hidden wpisujemy zwrócony URL.
// Zdjęcia z aparatu telefonu mają zwykle 3-8 MB (pełna rozdzielczość sensora).
// Wysyłanie tak dużego pliku 1:1 (telefon -> nasz serwer -> Cloudinary) to
// główna przyczyna kilkusekundowego oczekiwania. Zmniejszamy obraz w samej
// przeglądarce (canvas) do maks. 1600px po dłuższej stronie i kompresujemy
// do JPEG q=0.82 – to z reguły daje plik 100-400 KB, czyli upload 10-20x
// szybszy, bez zauważalnej utraty jakości na ekranie/wydruku karty narzędzia.
function _narzSkrawSciesnijObraz(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = () => resolve(file); // w razie błędu wysyłamy oryginał
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim; }
        else { width = Math.round(width * maxDim / height); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        resolve(blob || file); // jeśli toBlob zawiedzie, wysyłamy oryginał
      }, 'image/jpeg', quality);
    };
    img.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

async function narzSkrawZdjecieWybrane(input, prefix) {
  const file = input.files[0];
  if (!file) return;
  const statusEl = document.getElementById(prefix + '-foto-status');
  const urlInput = document.getElementById(prefix + '-zdjecie-url');
  const previewWrap = document.getElementById(prefix + '-zdjecie-preview');

  const MAX = 15 * 1024 * 1024;
  if (file.size > MAX) {
    if (statusEl) { statusEl.textContent = '✗ Plik za duży (maks. 15 MB)'; statusEl.style.color = 'var(--red)'; }
    return;
  }

  if (statusEl) { statusEl.textContent = '⏳ Przygotowywanie zdjęcia...'; statusEl.style.color = 'var(--dim)'; }
  input.disabled = true;

  try {
    // Kompresja po stronie przeglądarki – patrz komentarz przy _narzSkrawSciesnijObraz.
    const toUpload = file.type && file.type.startsWith('image/')
      ? await _narzSkrawSciesnijObraz(file)
      : file;

    if (statusEl) statusEl.textContent = '⏳ Wgrywanie zdjęcia...';
    const buf = await toUpload.arrayBuffer();
    const result = await new Promise((res, rej) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', SERVER_URL.replace(/\/$/, '') + '/api/zdjecie-upload');
      xhr.setRequestHeader('x-api-key', API_KEY);
      xhr.setRequestHeader('Content-Type', toUpload.type || 'image/jpeg');
      xhr.upload.onprogress = e => {
        if (e.lengthComputable && statusEl)
          statusEl.textContent = '⏳ Wgrywanie... ' + Math.round(e.loaded/e.total*100) + '%';
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) res(JSON.parse(xhr.responseText));
        else rej(new Error(xhr.responseText || 'HTTP ' + xhr.status));
      };
      xhr.onerror = () => rej(new Error('Błąd sieci'));
      xhr.send(buf);
    });

    if (result.ok && result.url) {
      if (urlInput) urlInput.value = result.url;
      if (previewWrap) {
        previewWrap.style.display = '';
        const img = previewWrap.querySelector('img');
        if (img) img.src = result.url;
      }
      if (statusEl) { statusEl.textContent = '✅ Zdjęcie dodane'; statusEl.style.color = 'var(--green)'; }
      // Zmień etykietę przycisku na "Zmień zdjęcie" jeśli to pierwsze dodanie
      const btn = input.parentElement.querySelector('button[type="button"]');
      if (btn && btn.textContent.includes('Dodaj')) btn.textContent = '📷 Zmień zdjęcie';
    } else {
      throw new Error(result.error || 'Nieznany błąd');
    }
  } catch (e) {
    if (statusEl) { statusEl.textContent = '✗ Błąd: ' + e.message; statusEl.style.color = 'var(--red)'; }
  } finally {
    input.disabled = false;
    input.value = '';
  }
}

function narzSkrawUsunZdjecieDodaj() {
  document.getElementById('nskr-zdjecie-url').value = '';
  document.getElementById('nskr-zdjecie-preview').style.display = 'none';
  const status = document.getElementById('nskr-foto-status');
  if (status) status.textContent = '';
  const btn = document.querySelector('#nskr-foto-input').parentElement.querySelector('button[type="button"]');
  if (btn) btn.textContent = '📷 Dodaj zdjęcie';
}

// ─── Modal: Dodaj ────────────────────────────────────────────────────────────
function renderNarzSkrawDodajModal() {
  const typyNazwy = narzSkrawTypyNazwy();
  return `
  <div id="nskr-dodaj-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)hidePanel('nskr-dodaj-modal')">
    <div class="modal">
      <button class="modal-close" onclick="hidePanel('nskr-dodaj-modal')">×</button>
      <h3>＋ Dodaj narzędzie skrawające</h3>
      <div class="field">
        <label>Typ *</label>
        <select id="nskr-typ" style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 8px;font-size:13px">
          ${typyNazwy.map(t=>`<option>${t}</option>`).join('')}
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
          <label>Dł. robocza (mm)</label>
          <input id="nskr-dlr" type="number" min="0" step="0.1" placeholder="np. 50" autocomplete="off"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
        </div>
      </div>
      <div class="field">
        <label>Do wykonania (operacje)</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          ${['otwór zgrubny','otwór wykańczający','planowanie/kieszeń','gwintowanie'].map(o =>
            `<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
              <input type="checkbox" value="${o}" onchange="nskrSyncOperacje('nskr-operacje')">
              ${o}
            </label>`
          ).join('')}
        </div>
        <input type="hidden" id="nskr-operacje" value="">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="field">
          <label>Typ oprawki</label>
          <select id="nskr-typ-opr" style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 8px;font-size:13px">
            <option value="">— brak / nie dotyczy —</option>
            ${['ER16','ER20','ER25','ER32','ER40','Weldon','Uchwyt wiertarski','Trzpień do głowic','Oprawka wytaczadła'].map(t=>`<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Średnica chwytu (mm)</label>
          <input id="nskr-sr-chwytu" type="number" min="0" step="0.01" value="0" autocomplete="off"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
        </div>
      </div>
      <div class="field">
        <label>Ilość *</label>
        <input id="nskr-ilosc" type="number" min="1" step="1" value="1" autocomplete="off"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
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
      <div class="field">
        <label>Zdjęcie (opcjonalnie)</label>
        <input type="hidden" id="nskr-zdjecie-url" value="">
        <div id="nskr-zdjecie-preview" style="margin-bottom:8px;display:none">
          <img src="" style="max-width:100%;max-height:160px;border-radius:8px;border:1px solid var(--border);display:block">
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn-sm btn-outline" style="flex:1" onclick="document.getElementById('nskr-foto-input').click()">📷 Dodaj zdjęcie</button>
          <button type="button" class="btn-sm btn-red" onclick="narzSkrawUsunZdjecieDodaj()">🗑</button>
        </div>
        <input type="file" id="nskr-foto-input" accept="image/*" capture="environment" style="display:none" onchange="narzSkrawZdjecieWybrane(this,'nskr')">
        <div id="nskr-foto-status" style="font-size:11px;color:var(--dim);margin-top:4px"></div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-accent" style="flex:1" onclick="saveNarzSkrawDodaj()">＋ Dodaj</button>
        <button class="btn btn-outline" style="padding:14px 18px" onclick="hidePanel('nskr-dodaj-modal')">Anuluj</button>
      </div>
    </div>
  </div>`;
}

// ─── Oprawki – loader ────────────────────────────────────────────────────────
async function loadOprawki() {
  try {
    const r = await get('/api/oprawki');
    setState({oprawki: r}, true);
    render();
  } catch(e) { setState({oprawki: []}, true); }
}

const OPRAWKI_ER_ZAKRESY = {
  'ER16': {min:1, max:10}, 'ER20': {min:1, max:13},
  'ER25': {min:1, max:16}, 'ER32': {min:3, max:20}, 'ER40': {min:3, max:26},
};
const TYPY_OPRAWEK = ['ER16','ER20','ER25','ER32','ER40','Weldon','Uchwyt wiertarski','Trzpień do głowic','Oprawka wytaczadła'];

function oprawkaPasujeDoNarzedzia(oprawka, narzedzie) {
  const typOpr = oprawka.typ || '';
  const typNar = (narzedzie.typ_oprawki || '').trim();
  if (!typNar) return false;
  const oBase = typOpr.replace(/\d+/g,'').trim().toLowerCase();
  const nBase = typNar.replace(/\d+/g,'').trim().toLowerCase();
  if (oBase !== nBase) return false;
  const chwyt = narzedzie.srednica_chwytu || 0;
  if (!chwyt) return true;
  if (typOpr.startsWith('ER')) {
    const z = OPRAWKI_ER_ZAKRESY[typOpr];
    if (z) return chwyt >= z.min && chwyt <= z.max;
    return chwyt >= (oprawka.srednica_min||0) && chwyt <= (oprawka.srednica_max||oprawka.srednica_min||999);
  }
  if (typOpr.toLowerCase().includes('weldon')) {
    const oSr = oprawka.srednica_min || oprawka.srednica_max || 0;
    return oSr > 0 && Math.abs(oSr - chwyt) <= 0.1;
  }
  if (typOpr.toLowerCase().includes('uchwyt')) {
    return chwyt >= (oprawka.srednica_min||0) && chwyt <= (oprawka.srednica_max||999);
  }
  return true;
}

// ─── Widok: Oprawki ──────────────────────────────────────────────────────────
function renderOprawkiWidok() {
  const oprawki = state.oprawki || null;
  const inp = (id, ph='', type='text', val='', extra='') =>
    `<input id="${id}" type="${type}" placeholder="${ph}" value="${val}" autocomplete="off" ${extra}
      style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;box-sizing:border-box">`;
  const typOpts = TYPY_OPRAWEK.map(t=>`<option value="${t}">${t}</option>`).join('');

  let html = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div style="font-weight:700;font-size:14px">🔩 Oprawki narzędziowe</div>
    <button class="btn btn-accent" onclick="setState({oprawkaDodajOpen:!state.oprawkaDodajOpen});render()">
      ${state.oprawkaDodajOpen ? '✕ Zamknij' : '＋ Dodaj oprawkę'}
    </button>
  </div>`;

  if (state.oprawkaDodajOpen) {
    html += `
    <div class="card" style="border:1px solid var(--accent);margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;margin-bottom:10px">➕ Nowa oprawka</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div><div style="font-size:11px;color:var(--dim);margin-bottom:3px">Typ *</div>
          <select id="opr-dodaj-typ" style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px;font-size:13px">${typOpts}</select></div>
        <div><div style="font-size:11px;color:var(--dim);margin-bottom:3px">Oznaczenie</div>${inp('opr-dodaj-ozn','np. ER32 A100')}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:8px;margin-bottom:10px">
        <div><div style="font-size:11px;color:var(--dim);margin-bottom:3px">Śr. min (mm)</div>${inp('opr-dodaj-srmin','','number','0','step=0.01 min=0')}</div>
        <div><div style="font-size:11px;color:var(--dim);margin-bottom:3px">Śr. max (mm)</div>${inp('opr-dodaj-srmax','','number','0','step=0.01 min=0')}</div>
        <div><div style="font-size:11px;color:var(--dim);margin-bottom:3px">Długość (mm)</div>${inp('opr-dodaj-dl','','number','0','step=0.1 min=0')}</div>
        <div><div style="font-size:11px;color:var(--dim);margin-bottom:3px">Ilość</div>${inp('opr-dodaj-ilosc','','number','1','step=1 min=0')}</div>
        <div><div style="font-size:11px;color:var(--dim);margin-bottom:3px">Lokalizacja</div>${inp('opr-dodaj-lok','')}</div>
      </div>
      <button class="btn btn-accent" style="width:100%" onclick="saveOprawkaDodaj()">✅ Dodaj</button>
    </div>`;
  }

  if (!oprawki) return html + `<div style="text-align:center;padding:30px;color:var(--dim)">⏳</div>`;
  if (!oprawki.length) return html + `<div class="card" style="text-align:center;padding:28px"><div style="font-size:36px;margin-bottom:8px">🔩</div><div style="color:var(--dim)">Brak oprawek – dodaj pierwszą</div></div>`;

  const byTyp = {};
  oprawki.forEach(o => { (byTyp[o.typ] = byTyp[o.typ]||[]).push(o); });
  Object.keys(byTyp).sort().forEach(typ => {
    html += `<div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin:12px 0 6px">${typ}</div>`;
    byTyp[typ].forEach(o => {
      const dostepna = o.ilosc > 0;
      const srInfo = o.srednica_max > 0 ? `⌀${o.srednica_min||0}–${o.srednica_max} mm` : (o.srednica_min > 0 ? `⌀${o.srednica_min} mm` : '');
      if (state.oprawkaEditId === o.id) {
        html += `<div class="card" style="margin-bottom:6px;border:1px solid var(--accent)">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
            <div><div style="font-size:10px;color:var(--dim);margin-bottom:2px">Typ</div>
              <select id="opr-edit-typ" style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 8px;font-size:12px">
                ${TYPY_OPRAWEK.map(t=>`<option value="${t}" ${t===o.typ?'selected':''}>${t}</option>`).join('')}
              </select></div>
            <div><div style="font-size:10px;color:var(--dim);margin-bottom:2px">Oznaczenie</div>${inp('opr-edit-ozn','','text',o.oznaczenie||'')}</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:6px;margin-bottom:8px">
            <div><div style="font-size:10px;color:var(--dim);margin-bottom:2px">Śr.min</div>${inp('opr-edit-srmin','','number',o.srednica_min||0,'step=0.01 min=0')}</div>
            <div><div style="font-size:10px;color:var(--dim);margin-bottom:2px">Śr.max</div>${inp('opr-edit-srmax','','number',o.srednica_max||0,'step=0.01 min=0')}</div>
            <div><div style="font-size:10px;color:var(--dim);margin-bottom:2px">Dł.(mm)</div>${inp('opr-edit-dl','','number',o.dlugosc||0,'step=0.1 min=0')}</div>
            <div><div style="font-size:10px;color:var(--dim);margin-bottom:2px">Ilość</div>${inp('opr-edit-ilosc','','number',o.ilosc||1,'step=1 min=0')}</div>
            <div><div style="font-size:10px;color:var(--dim);margin-bottom:2px">Lok.</div>${inp('opr-edit-lok','','text',o.lokalizacja||'')}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-accent" style="flex:1;font-size:12px;padding:8px" onclick="saveOprawkaEdit(${o.id})">💾 Zapisz</button>
            <button class="btn-outline" style="padding:8px 14px;font-size:12px" onclick="setState({oprawkaEditId:null})">✕</button>
          </div>
        </div>`;
      } else {
        html += `<div class="card" style="padding:8px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px">${o.oznaczenie||o.typ}</div>
            <div style="font-size:11px;color:var(--dim);margin-top:1px">${srInfo}${o.dlugosc>0?' · L '+o.dlugosc+' mm':''}${o.lokalizacja?' · 📍'+o.lokalizacja:''}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:16px;font-weight:800;color:${dostepna?'var(--green)':'var(--red)'}">${o.ilosc}</div>
            <div style="font-size:10px;color:var(--dim)">szt.</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <button class="btn-sm" style="background:rgba(52,152,219,.12);color:var(--blue);border-color:var(--blue)" onclick="setState({oprawkaEditId:${o.id}})">✏</button>
            <button class="btn-sm btn-red" onclick="deleteOprawka(${o.id})">🗑</button>
          </div>
        </div>`;
      }
    });
  });
  return html;
}

// ─── Widok: Dobór narzędzia do operacji ─────────────────────────────────────
function renderNarzSkrawDobor() {
  const d = state.nskrDobor || {};
  const operacja = d.operacja || '';

  const OPERACJE = [
    { id:'otw_zgr', label:'🔵 Otwór zgrubny',       typy:['wiertło','wiertła','wiertło centrujące','pogłębiacz'] },
    { id:'otw_wyk', label:'🟢 Otwór wykańczający',   typy:['wytaczadło zgrubne','wytaczadło wykańczające','wytaczadło','rozwiertak'] },
    { id:'plan_ki', label:'🟡 Planowanie / kieszeń', typy:['frez wykańczający','frez zgrubny','frez kulowy','głowica frezarska','płytka do głowicy'] },
    { id:'gwint',   label:'🔩 Gwintowanie',           typy:['gwintownik','narzynka','frez do gwintów','wiertło','wiertła'] },
  ];

  const opcje = OPERACJE.map(o =>
    `<button onclick="setState({nskrDobor:{...state.nskrDobor||{},operacja:'${o.id}'}});render()"
      style="padding:10px 14px;border-radius:10px;border:2px solid ${operacja===o.id?'var(--accent)':'var(--border)'};
             background:${operacja===o.id?'rgba(52,152,219,.15)':'var(--panel)'};
             color:${operacja===o.id?'var(--accent)':'var(--text)'};font-size:13px;
             font-weight:${operacja===o.id?700:400};cursor:pointer;text-align:left;width:100%">
      ${o.label}
    </button>`
  ).join('');

  let wyniki = '';
  if (operacja) {
    const op = OPERACJE.find(o => o.id === operacja);
    const srednica = parseFloat(d.srednica) || 0;
    const glebokos = parseFloat(d.glebokos) || 0;

    let pasujaceNarz = (state.narzSkrawResults || []).filter(n => {
      const typLc = (n.typ || '').toLowerCase();
      const typMatch = op.typy.some(t => typLc.includes(t));
      const opsMatch = n.operacje && n.operacje.split(',').some(o => o.trim().toLowerCase() === operacja.replace('_',' '));
      if (!typMatch && !opsMatch) return false;
      if (srednica > 0 && n.srednica > 0 && Math.abs(n.srednica - srednica) > 0.05) return false;
      if (glebokos > 0 && n.dlugosc_robocza > 0 && n.dlugosc_robocza < glebokos) return false;
      return true;
    });

    pasujaceNarz.sort((a,b) => {
      const aOk = a.status==='sprawne' && a.dostepne>0 ? 0 : 1;
      const bOk = b.status==='sprawne' && b.dostepne>0 ? 0 : 1;
      if (aOk!==bOk) return aOk-bOk;
      if (srednica) return Math.abs((a.srednica||0)-srednica)-Math.abs((b.srednica||0)-srednica);
      return 0;
    });

    const allOprawki = state.oprawki || [];

    if (!pasujaceNarz.length) {
      wyniki = `<div class="card" style="text-align:center;padding:24px;margin-top:12px">
        <div style="font-size:30px;margin-bottom:8px">🔍</div>
        <div style="color:var(--dim);font-weight:600">Brak pasujących narzędzi</div>
      </div>`;
    } else {
      wyniki = `<div style="font-size:12px;color:var(--dim);margin:12px 0 8px"><b style="color:var(--text)">${pasujaceNarz.length}</b> pasujących narzędzi:</div>`;
      pasujaceNarz.forEach(n => {
        const meta = narzSkrawStatusMeta(n.status);
        const dostepne = n.dostepne > 0 && n.status === 'sprawne';
        const params = [];
        if (n.srednica)         params.push(`⌀${n.srednica} mm`);
        if (n.dlugosc_robocza)  params.push(`L rob. ${n.dlugosc_robocza} mm`);
        if (n.srednica_chwytu)  params.push(`chwyt ⌀${n.srednica_chwytu} mm`);
        if (n.typ_oprawki)      params.push(`🔩 ${n.typ_oprawki}`);
        const pasOprawki = allOprawki.filter(o => oprawkaPasujeDoNarzedzia(o, n));
        const oprawkiHtml = pasOprawki.length
          ? pasOprawki.map(o => {
              const srI = o.srednica_max>0?`⌀${o.srednica_min||0}–${o.srednica_max}mm`:(o.srednica_min>0?`⌀${o.srednica_min}mm`:'');
              const ok = o.ilosc > 0;
              return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border-radius:6px;background:${ok?'rgba(39,174,96,.08)':'rgba(231,76,60,.08)'};margin-top:4px">
                <span style="font-size:11px">${ok?'🟢':'🔴'} ${o.oznaczenie||o.typ} ${srI}${o.dlugosc?` L${o.dlugosc}mm`:''}</span>
                <span style="font-size:12px;font-weight:700;color:${ok?'var(--green)':'var(--red)'}">${o.ilosc} szt.</span>
              </div>`;
            }).join('')
          : n.typ_oprawki
            ? `<div style="font-size:11px;color:var(--orange);padding:4px 0">⚠ Brak oprawki ${n.typ_oprawki}${n.srednica_chwytu?' ⌀'+n.srednica_chwytu:''}  na stanie</div>`
            : '';
        wyniki += `
        <div class="card" style="padding:10px 12px;margin-bottom:8px;border-left:4px solid ${dostepne?'var(--green)':meta.color}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            ${n.zdjecie_url?`<img src="${n.zdjecie_url}" style="width:38px;height:38px;border-radius:6px;object-fit:cover;flex-shrink:0">`:''}
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:13px">${meta.icon} ${n.oznaczenie||n.typ}${n.srednica?` · ⌀${n.srednica}mm`:''}</div>
              <div style="font-size:11px;color:var(--dim)">${n.typ}${n.lokalizacja?' · 📍'+n.lokalizacja:''}</div>
              ${params.length?`<div style="font-size:11px;color:var(--accent);margin-top:2px">${params.join(' · ')}</div>`:''}
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:18px;font-weight:800;color:${dostepne?'var(--green)':'var(--red)'}">${n.dostepne}/${n.ilosc}</div>
              <div style="font-size:10px;color:var(--dim)">szt.</div>
            </div>
          </div>
          ${oprawkiHtml?`<div style="margin-top:6px;border-top:1px solid var(--border);padding-top:6px">
            <div style="font-size:10px;color:var(--dim);margin-bottom:2px;font-weight:600">OPRAWKI:</div>${oprawkiHtml}</div>`:''}
          ${dostepne
            ?`<button class="btn btn-accent" style="width:100%;margin-top:8px;padding:8px;font-size:12px"
                onclick='setState({narzSkrawWypozyczModal:${JSON.stringify(n).replace(/'/g,"&#39;")}})'>📤 Wypożycz</button>`
            :`<div style="margin-top:6px;font-size:11px;color:${meta.color};text-align:center;font-weight:600">${meta.icon} ${meta.label}</div>`}
        </div>`;
      });
    }
  }

  return `
  <div class="card" style="margin-bottom:14px">
    <div style="font-size:14px;font-weight:700;margin-bottom:14px">🎯 Dobór narzędzia do operacji</div>
    <div style="font-size:11px;color:var(--dim);margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">1. Rodzaj operacji</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:16px">${opcje}</div>
    ${operacja ? `
    <div style="font-size:11px;color:var(--dim);margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">2. Parametry (opcjonalne)</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px">
      <div>
        <div style="font-size:11px;color:var(--dim);margin-bottom:3px">Średnica ⌀ (mm)</div>
        <input id="nskr-dobor-sr" type="number" step="0.01" min="0" placeholder="np. 12" value="${d.srednica||''}"
          onchange="setState({nskrDobor:{...state.nskrDobor||{},srednica:this.value}});render()"
          style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:16px;font-weight:700;box-sizing:border-box;text-align:center">
      </div>
      <div>
        <div style="font-size:11px;color:var(--dim);margin-bottom:3px">Głębokość (mm)</div>
        <input id="nskr-dobor-gl" type="number" step="0.1" min="0" placeholder="np. 50" value="${d.glebokos||''}"
          onchange="setState({nskrDobor:{...state.nskrDobor||{},glebokos:this.value}});render()"
          style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:16px;font-weight:700;box-sizing:border-box;text-align:center">
      </div>
    </div>
    <div style="font-size:10px;color:var(--dim);margin-bottom:14px">💡 Filtrowanie uruchamia się po opuszczeniu pola (Tab lub kliknięcie gdzieś indziej).</div>
    ` : ''}
    ${wyniki}
  </div>`;
}

function nskrSyncOperacje(hiddenId) {
  const hidden = document.getElementById(hiddenId);
  if (!hidden) return;
  const container = hidden.parentElement;
  const checked = [...container.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
  hidden.value = checked.join(',');
}

// ─── Oprawki – akcje ─────────────────────────────────────────────────────────
async function saveOprawkaDodaj() {
  const g  = id => document.getElementById(id)?.value?.trim() || '';
  const gf = id => parseFloat(document.getElementById(id)?.value) || 0;
  const typ = document.getElementById('opr-dodaj-typ')?.value;
  if (!typ) { alert('Wybierz typ oprawki'); return; }
  try {
    await post('/api/oprawki', {
      typ, oznaczenie: g('opr-dodaj-ozn'),
      srednica_min: gf('opr-dodaj-srmin'), srednica_max: gf('opr-dodaj-srmax'),
      dlugosc: gf('opr-dodaj-dl'), ilosc: parseInt(g('opr-dodaj-ilosc'))||1,
      lokalizacja: g('opr-dodaj-lok'),
    });
    setState({oprawkaDodajOpen: false}, true);
    await loadOprawki();
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function saveOprawkaEdit(id) {
  const g  = id => document.getElementById(id)?.value?.trim() || '';
  const gf = id => parseFloat(document.getElementById(id)?.value) || 0;
  const typ = document.getElementById('opr-edit-typ')?.value;
  try {
    await put('/api/oprawki/' + id, {
      typ, oznaczenie: g('opr-edit-ozn'),
      srednica_min: gf('opr-edit-srmin'), srednica_max: gf('opr-edit-srmax'),
      dlugosc: gf('opr-edit-dl'), ilosc: parseInt(document.getElementById('opr-edit-ilosc')?.value)||1,
      lokalizacja: g('opr-edit-lok'),
    });
    setState({oprawkaEditId: null}, true);
    await loadOprawki();
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function deleteOprawka(id) {
  if (!confirm('Usunąć tę oprawkę?')) return;
  try {
    await del('/api/oprawki/' + id);
    await loadOprawki();
  } catch(e) { alert('Błąd: ' + e.message); }
}

// ─── Actions ─────────────────────────────────────────────────────────────────
async function saveNarzSkrawDodaj() {
  const typ = document.getElementById('nskr-typ').value;
  const oznaczenie = document.getElementById('nskr-oznaczenie').value.trim();
  const srednicaRaw = document.getElementById('nskr-srednica').value;
  const dlrRaw = document.getElementById('nskr-dlr')?.value;
  const operacje = document.getElementById('nskr-operacje')?.value || '';
  const ilosc = parseInt(document.getElementById('nskr-ilosc').value, 10) || 1;
  const status = document.getElementById('nskr-status').value;
  const lokalizacja = document.getElementById('nskr-lok').value.trim();
  const uwagi = document.getElementById('nskr-uwagi').value.trim();
  const zdjecie_url = (document.getElementById('nskr-zdjecie-url')||{}).value || '';
  const typ_oprawki     = document.getElementById('nskr-typ-opr')?.value || '';
  const srednica_chwytu = parseFloat(document.getElementById('nskr-sr-chwytu')?.value) || 0;
  try {
    await post('/api/narzedzia-skrawajace', {
      typ, oznaczenie, srednica: srednicaRaw ? parseFloat(srednicaRaw) : null,
      dlugosc_robocza: dlrRaw ? parseFloat(dlrRaw) : 0,
      operacje, typ_oprawki, srednica_chwytu,
      ilosc, status, lokalizacja, uwagi, zdjecie_url
    });
    hidePanel('nskr-dodaj-modal');
    ['nskr-oznaczenie','nskr-srednica','nskr-dlr','nskr-lok','nskr-uwagi'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
    document.getElementById('nskr-ilosc').value = '1';
    const op = document.getElementById('nskr-operacje'); if(op) op.value='';
    document.querySelectorAll('#nskr-operacje ~ div input[type=checkbox]').forEach(c => c.checked = false);
    narzSkrawUsunZdjecieDodaj();
    await narzSkrawOdswiezListeIicznik();
  } catch (e) {
    alert('Błąd dodawania: ' + e.message);
  }
}

async function saveNarzSkrawEdit(id) {
  const typ = document.getElementById('nske-typ').value;
  const oznaczenie = document.getElementById('nske-oznaczenie').value.trim();
  const srednicaRaw = document.getElementById('nske-srednica').value;
  const dlrRaw = document.getElementById('nske-dlr')?.value;
  const operacje = document.getElementById('nske-operacje')?.value || '';
  const ilosc = parseInt(document.getElementById('nske-ilosc').value, 10);
  const status = document.getElementById('nske-status').value;
  const lokalizacja = document.getElementById('nske-lok').value.trim();
  const uwagi = document.getElementById('nske-uwagi').value.trim();
  const zdjecie_url = (document.getElementById('nske-zdjecie-url')||{}).value || '';
  const typ_oprawki     = document.getElementById('nske-typ-opr')?.value || '';
  const srednica_chwytu = parseFloat(document.getElementById('nske-sr-chwytu')?.value) || 0;
  try {
    await put(`/api/narzedzia-skrawajace/${id}`, {
      typ, oznaczenie, srednica: srednicaRaw ? parseFloat(srednicaRaw) : null,
      dlugosc_robocza: dlrRaw ? parseFloat(dlrRaw) : 0,
      operacje, typ_oprawki, srednica_chwytu,
      ilosc, status, lokalizacja, uwagi, zdjecie_url
    });
    setState({narzSkrawEditModal: null}, true);
    await narzSkrawOdswiezListeIicznik();
  } catch (e) {
    alert('Błąd zapisu: ' + e.message);
  }
}

async function usunNarzSkraw(id) {
  if (!confirm('Usunąć to narzędzie z bazy?')) return;
  try {
    await del('/api/narzedzia-skrawajace/' + id);
    await narzSkrawOdswiezListeIicznik();
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
    await narzSkrawOdswiezListeIicznik();
  } catch (e) {
    alert('Błąd wypożyczenia: ' + e.message);
  }
}

async function zwrocNarzSkraw(wypozyczenieId) {
  const stan = _nskrZwrotStan || 'ok';
  const uwagiEl = document.getElementById('nskr-zwrot-uwagi');
  const uwagi = uwagiEl ? uwagiEl.value.trim() : '';
  if (stan !== 'ok' && !uwagi) {
    alert('Podaj uwagi – co się stało z narzędziem');
    return;
  }
  const kto = (state.user && state.user.full_name) || prompt('Kto zwraca narzędzie?') || '';
  try {
    await patch(`/api/narzedzia-skrawajace-wypozyczenia/${wypozyczenieId}/zwrot`, {
      user_id: state.user ? state.user.id : null, user_name: kto,
      stan_zwrotu: stan, uwagi_zwrotu: uwagi
    });
    setState({narzSkrawZwrotModal: null}, true);
    await Promise.all([loadNarzSkrawWypozyczenia(), narzSkrawOdswiezListeIicznik()]);
  } catch (e) {
    alert('Błąd zwrotu: ' + e.message);
  }
}
