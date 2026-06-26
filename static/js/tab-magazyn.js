//  TAB: MAGAZYN
// ══════════════════════════════════════════════════════════════
function renderMagazyn() {
  if (state.loading) return '<div class="spinner">⏳</div>';

  const subTab = state.magazynSubTab || 'transport';
  const subTabs = [
    {id:'transport',       label:'🚚 Transport'},
    {id:'materialy',       label:'🏗 Materiały'},
    {id:'rezerwacje',      label:'🔒 Rez. mat.'},
    {id:'zapotrzebowanie', label:'📋 Zapotrz.'},
    {id:'narzedzialnia',   label:'🔧 Narzędziownia'},
    {id:'narzskraw',       label:'⚙ Narz. skrawające'},
  ];

  const refreshTime = state.magazynLastRefresh;
  let html = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <div style="font-size:10px;color:var(--dim)">
      ${refreshTime ? `🔄 odświeżono o ${refreshTime}` : ''}
    </div>
    <div style="font-size:10px;color:var(--dim)">auto co 1 min</div>
  </div>
  <div class="sub-tabs">
    ${subTabs.map(t => `<button class="sub-tab ${subTab===t.id?'active':''}"
      onclick="switchMagazynTab('${t.id}')">${t.label}</button>`).join('')}
  </div>`;

  if (subTab === 'transport') {
    html += renderMagazynTransport();
  } else if (subTab === 'materialy') {
    html += renderMagazynMaterialy();
  } else if (subTab === 'rezerwacje') {
    html += renderMagazynRezerwacje();
  } else if (subTab === 'zapotrzebowanie') {
    html += renderMagazynZapotrzebowanie();
  } else if (subTab === 'narzedzialnia') {
    html += renderNarzedzialnia();
  } else if (subTab === 'narzskraw') {
    html += renderNarzSkraw();
  }

  // Modal rezerwacji
  if (state.rezerwacjaModal) html += renderRezerwacjaModal();

  return html;
}

function switchMagazynTab(tab) {
  setState({magazynSubTab: tab}, true);
  if (tab === 'materialy' && state.magazynMatCount === null) loadMagazynMaterialyCount();
  if (tab === 'materialy') loadMagazynMaterialySearch();
  if (tab === 'rezerwacje') { loadRezerwacjeZSerwera(); }
  if (tab === 'zapotrzebowanie' && !state.magazynZapotrzebowanie && !state.magazynZapotrzebowanieLoading) {
    loadMagazynZapotrzebowanie();
  }
  if (tab === 'narzedzialnia' && !state.narzResults?.length) { loadNarzCount(); loadNarzAll(); }
  if (tab === 'narzskraw' && !state.narzSkrawResults) { loadNarzSkrawAll(); loadNarzSkrawCount(); }
  render();
}

// ─── Sub-tab: Transport ───────────────────────────────────────────────────────
// Ukryte operacje – zachowane w state, resetowane przy odświeżeniu
function transportDismiss(opId) {
  const hidden = new Set(state.transportHidden || []);
  hidden.add(opId);
  setState({ transportHidden: [...hidden] }, true);
  render();
  // Zapisz trwałe odrzucenie na serwerze – operacja nie wróci po odświeżeniu
  // ani na ekranie logowania.
  post(`/api/operacje/${opId}/transport-dismiss`, {}).catch(err => {
    console.error('Nie udało się zapisać odrzucenia operacji:', err);
  });
}

function renderMagazynTransport() {
  const hidden = new Set(state.transportHidden || []);

  // Filtruj: wyklucz operacje ukryte przez użytkownika oraz operacje z KJ
  // (operacja zatwierdzona przez KJ to taka, gdzie ilosc_wykonana === 0
  //  ale status === 'zakonczona' – oznacza odbiór KJ, nie faktyczną produkcję)
  const wszystkie = (state.transportOps || []).filter(op => {
    if (hidden.has(op.id)) return false;
    // Pomiń jeśli to operacja kontroli jakości (KJ): wykonano 0 szt, a zlecenie wymaga >0
    const ilocWyk = op.ilosc_wykonana ?? 0;
    const ilocSzt = op.ilosc_sztuk ?? 1;
    if (ilocWyk === 0 && ilocSzt > 0) return false;
    return true;
  });

  let html = `<div class="section-hdr">📦 Operacje zakończone – do transportu (${wszystkie.length})</div>`;

  if (!wszystkie.length) {
    html += `<div class="card" style="text-align:center;padding:30px">
      <div style="font-size:40px;margin-bottom:10px">✅</div>
      <div style="color:var(--green);font-size:16px;font-weight:600">Brak operacji do transportu</div>
    </div>`;
  } else {
    wszystkie.forEach(op => {
      html += `
      <div class="card" style="position:relative">
        <button onclick="transportDismiss(${op.id})"
          title="Usuń z widoku"
          style="position:absolute;top:8px;right:8px;background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.3);
                 color:#f87171;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:13px;font-weight:700;
                 z-index:1;line-height:1.4">✕</button>
        <div class="card-header" style="padding-right:40px">
          <div>
            <div class="card-title">${op.kolejnosc}. ${op.nazwa}</div>
            <div class="card-sub">📋 ${op.zl_numer} – ${op.zl_nazwa}</div>
          </div>
          <span class="badge badge-green">✅ ukończona</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;margin-top:6px">
          <span style="color:var(--dim)">🏭 Stanowisko</span><span>${op.stanowisko||'—'}</span>
          <span style="color:var(--dim)">📦 Wykonano</span><span style="color:var(--green);font-weight:600">${op.ilosc_wykonana}/${op.ilosc_sztuk} szt.</span>
        </div>
      </div>`;
    });
  }

  html += `<button class="btn-outline" style="margin-top:8px" onclick="setState({transportHidden:[]},true);loadMagazynier()">🔄 Odśwież</button>`;
  return html;
}

// ─── Sub-tab: Materiały ───────────────────────────────────────────────────────
function renderMagazynMaterialy() {
  const cnt = state.magazynMatCount;

  // Formularz dodawania – zawsze w DOM, pokazywany przez showPanel/hidePanel
  const jmOpts = ['kg','szt','mb','m2','m3','t','l','kpl'].map(u => `<option value="${u}">${u}</option>`).join('');

  let html = `
  <div id="mag-dodaj-panel" style="display:none;margin-bottom:14px">
    <div class="card" style="border:1px solid var(--accent)">
      <div style="font-size:13px;font-weight:700;margin-bottom:12px" id="mag-dodaj-title">➕ Dodaj nowy materiał</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div>
          <div style="font-size:11px;color:var(--dim);margin-bottom:3px">Indeks <span style="color:var(--red)">*</span></div>
          <input id="mat-f-indeks" placeholder="np. M04497" autocomplete="off"
            style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 9px;font-size:13px;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:11px;color:var(--dim);margin-bottom:3px">Kod materiału (opcjonalny)</div>
          <input id="mat-f-kod" placeholder="np. 0311" autocomplete="off"
            style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 9px;font-size:13px;box-sizing:border-box">
        </div>
      </div>
      <div style="margin-bottom:8px">
        <div style="font-size:11px;color:var(--dim);margin-bottom:3px">Nazwa artykułu <span style="color:var(--red)">*</span></div>
        <input id="mat-f-opis" placeholder="np. BLACHA 1 GAT.DC.01." autocomplete="off"
          style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 9px;font-size:13px;box-sizing:border-box">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
        <div>
          <div style="font-size:11px;color:var(--dim);margin-bottom:3px">J.M.</div>
          <select id="mat-f-jm" onchange="matFormJmChange()"
            style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 9px;font-size:13px">
            ${jmOpts}
          </select>
        </div>
        <div>
          <div style="font-size:11px;color:var(--dim);margin-bottom:3px">Stan do dyspozycji</div>
          <input id="mat-f-dysp" type="number" step="0.001" min="0" value="0" autocomplete="off"
            style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 9px;font-size:13px;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:11px;color:var(--dim);margin-bottom:3px">Stan rzeczywisty</div>
          <input id="mat-f-stan" type="number" step="0.001" min="0" value="0" autocomplete="off"
            style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 9px;font-size:13px;box-sizing:border-box">
        </div>
      </div>
      <div id="mat-f-wymiary-row" style="display:none;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
        <div>
          <div style="font-size:11px;color:var(--dim);margin-bottom:3px">Szerokość (mm)</div>
          <input id="mat-f-szerokosc" type="number" step="0.1" min="0" value="0" autocomplete="off"
            style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 9px;font-size:13px;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:11px;color:var(--dim);margin-bottom:3px">Długość (mm)</div>
          <input id="mat-f-dlugosc" type="number" step="0.1" min="0" value="0" autocomplete="off"
            style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 9px;font-size:13px;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:11px;color:var(--dim);margin-bottom:3px">Ciężar jedn. (kg)</div>
          <input id="mat-f-ciezar" type="number" step="0.001" min="0" value="0" autocomplete="off"
            style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 9px;font-size:13px;box-sizing:border-box">
        </div>
      </div>
      <input type="hidden" id="mat-f-edit-id" value="">
      <div style="display:flex;gap:8px">
        <button class="btn btn-accent" onclick="zapiszMaterial()" style="flex:1" id="mat-f-save-btn">✅ Dodaj materiał</button>
        <button class="btn-outline" onclick="zamknijFormularzMaterialu()" style="flex:1">Anuluj</button>
      </div>
    </div>
  </div>
`;
  html += `
  <div class="card" style="margin-bottom:14px">
    <div style="font-size:13px;font-weight:700;margin-bottom:12px">📂 Import bazy materiałów (.xlsx)</div>
    <div style="font-size:12px;color:var(--dim);margin-bottom:10px;line-height:1.5">
      Wczytaj plik Excel z bazą materiałów. Obsługuje format xlsm z systemu magazynowego.<br>
      Wymagane kolumny: <b>Indeks</b>, <b>Nazwa artykułu (materiału)</b>.<br>
      Opcjonalne: J.M., Stan do dyspozycji, Stan rzeczywisty, Rezerwacje, Kod materiału, Szerokość, Długość, Ciężar jedn.
    </div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <input type="file" id="mag-xlsx-file" accept=".xlsx,.xls,.xlsm"
        style="font-size:12px;color:var(--text);background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:6px">
      <button class="btn btn-accent" onclick="importMaterialyXlsx()">📥 Importuj</button>
    </div>
    <div id="mat-import-status" style="font-size:12px;margin-top:8px;color:var(--dim)"></div>
  </div>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:13px;font-weight:700">🔍 Baza materiałów</div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:12px;color:var(--dim)">${cnt !== null ? cnt + ' pozycji' : '...'}</span>
        <button class="btn-sm btn-accent" onclick="otworzFormularzDodajMaterial()" style="font-size:11px;padding:4px 10px">➕ Dodaj</button>
      </div>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:10px">
      <input id="mag-mat-search" type="text" placeholder="Szukaj wg opisu lub indeksu..."
        value="${state.magazynMatSearch||''}"
        style="flex:1;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px"
        onkeyup="if(event.key==='Enter')loadMagazynMaterialySearch()">
      <button class="btn-outline" onclick="loadMagazynMaterialySearch()">🔍</button>
    </div>`;

  if (state.magazynMatSearching) {
    html += `<div style="text-align:center;padding:16px;color:var(--dim)">⏳ Szukam...</div>`;
  } else if (state.magazynMatResults.length) {
    html += `<div style="margin-top:4px">`;
    for (const m of state.magazynMatResults) {
      const dostepne = m.do_dyspozycji ?? m.stan_rzeczywisty ?? 0;
      const rez = (state.magazynRezerwacje||[]).filter(r => r.material_id === m.id && r.status === 'aktywna');
      const rezSum = rez.reduce((a,r)=>a+r.ilosc, 0);
      const wolne = dostepne - rezSum;
      // Buduj info o wymiarach dla materiałów kg
      let wymInfo = '';
      if (m.jm === 'kg') {
        const parts = [];
        if (m.szerokosc > 0) parts.push(`szer: ${m.szerokosc} mm`);
        if (m.dlugosc > 0) parts.push(`dł: ${m.dlugosc} mm`);
        if (m.ciezar_jedn > 0) parts.push(`cięż: ${m.ciezar_jedn} kg/m`);
        if (parts.length) wymInfo = ` · <span style="color:var(--blue);font-size:10px">${parts.join(' · ')}</span>`;
      }
      html += `
      <div class="card" style="padding:10px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px">${m.opis}</div>
            <div style="font-size:11px;color:var(--dim);margin-top:2px">${m.indeks||''}${m.kod?' · <span style="color:var(--dim)">'+m.kod+'</span>':''}${wymInfo}</div>
          </div>
          <div style="text-align:right;margin-left:8px;white-space:nowrap">
            <div style="font-size:13px;font-weight:700;color:${dostepne>0?'var(--green)':'var(--red)'}">${dostepne.toFixed(dostepne%1===0?0:3)} ${m.jm}</div>
            ${rezSum > 0 ? `<div style="font-size:10px;color:var(--orange)">🔒 ${rezSum.toFixed(rezSum%1===0?0:2)} zarezerwowane</div>` : ''}
            ${wolne < dostepne ? `<div style="font-size:10px;color:var(--dim)">wolne: ${wolne.toFixed(wolne%1===0?0:2)} ${m.jm}</div>` : ''}
          </div>
        </div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn-sm btn-accent" onclick="openRezerwacjaModal(${JSON.stringify(m).replace(/"/g,'&quot;')})">🔒 Zarezerwuj</button>
          <button class="btn-sm" style="background:var(--panel);border:1px solid var(--border);color:var(--text)" onclick="otworzEdycjeMaterialu(${JSON.stringify(m).replace(/"/g,'&quot;')})">✏️ Edytuj</button>
          <button class="btn-sm" style="background:var(--panel);border:1px solid var(--red);color:var(--red)" onclick="usunMaterial(${m.id})">🗑</button>
        </div>
      </div>`;
    }
    html += `</div>`;
  } else if (state.magazynMatSearch && !state.magazynMatResults.length) {
    html += `<div style="color:var(--dim);font-size:12px;text-align:center;padding:14px">Brak wyników dla frazy „${state.magazynMatSearch}"</div>`;
  } else if (!state.magazynMatResults.length) {
    html += `<div style="color:var(--dim);font-size:12px;text-align:center;padding:14px">${cnt===0?'Baza pusta – zaimportuj plik xlsx.':'⏳ Ładowanie listy...'}</div>`;
  }
  html += `</div>`;
  return html;
}

// ─── Sub-tab: Rezerwacje ──────────────────────────────────────────────────────
function renderMagazynRezerwacje() {
  const lista = state.magazynRezerwacje || [];
  const aktywne = lista.filter(r => r.status === 'aktywna');
  const zwolnione = lista.filter(r => r.status === 'zwolniona');

  let html = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div class="section-hdr" style="margin-bottom:0">🔒 Rezerwacje materiałów (${aktywne.length} aktywnych)</div>
    <button class="btn-sm btn-accent" onclick="switchMagazynTab('materialy')">+ Nowa</button>
  </div>`;

  if (!aktywne.length) {
    html += `<div class="card" style="text-align:center;padding:24px">
      <div style="font-size:32px;margin-bottom:8px">📭</div>
      <div style="color:var(--dim);font-size:14px">Brak aktywnych rezerwacji</div>
      <div style="font-size:12px;color:var(--dim);margin-top:4px">Znajdź materiał w zakładce Materiały i kliknij Zarezerwuj</div>
    </div>`;
  } else {
    aktywne.forEach(r => {
      const jm = r.material_jm || r.jm || '';
      const zlecNr = r.zlecenie_nr || r.zlecenie || '';
      const dataStr = (r.created_at || r.data || '').slice(0,10);
      html += `
      <div class="card" style="padding:12px;margin-bottom:8px;border-left:3px solid var(--blue)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:14px;color:var(--accent)">${zlecNr}</div>
            <div style="font-size:13px;margin-top:2px">${r.material_opis}</div>
            <div style="font-size:11px;color:var(--dim);margin-top:2px">${r.material_indeks||''}</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center">
              <span style="background:rgba(52,152,219,0.15);color:var(--blue);border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700">${r.ilosc} ${jm}</span>
              <span style="font-size:11px;color:var(--dim)">📅 ${dataStr}</span>
            </div>
            ${r.uwagi ? `<div style="font-size:11px;color:var(--dim);margin-top:4px;font-style:italic">${r.uwagi}</div>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:10px">
          <button class="btn-sm" style="background:rgba(39,174,96,0.15);color:var(--green);border-color:var(--green)" onclick="zwolnijRezerwacje('${r.id}')">✓ Zwolnij</button>
          <button class="btn-sm btn-red" onclick="usunRezerwacje('${r.id}')">🗑 Usuń</button>
        </div>
      </div>`;
    });
  }

  if (zwolnione.length) {
    html += `<div class="section-hdr" style="margin-top:16px">Historia zwolnionych (${zwolnione.length})</div>`;
    zwolnione.slice(-5).reverse().forEach(r => {
      const jm = r.material_jm || r.jm || '';
      const zlecNr = r.zlecenie_nr || r.zlecenie || '';
      const dataStr = (r.created_at || r.data || '').slice(0,10);
      html += `
      <div class="card" style="padding:10px;margin-bottom:6px;opacity:0.6">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:12px;font-weight:700;color:var(--dim)">${zlecNr} – ${r.material_opis}</div>
            <div style="font-size:11px;color:var(--dim)">${r.ilosc} ${jm} | ${dataStr}</div>
          </div>
          <button class="btn-sm btn-red" onclick="usunRezerwacje('${r.id}')">🗑</button>
        </div>
      </div>`;
    });
  }

  return html;
}

// ─── Sub-tab: Zapotrzebowanie produkcyjne ─────────────────────────────────────
function renderMagazynZapotrzebowanie() {
  if (state.magazynZapotrzebowanieLoading) {
    return `<div class="spinner">⏳ Ładuję zapotrzebowanie...</div>`;
  }

  let html = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div class="section-hdr" style="margin-bottom:0">📋 Zapotrzebowanie materiałowe</div>
    <button class="btn-sm btn-accent" onclick="loadMagazynZapotrzebowanie();render()">🔄</button>
  </div>`;

  if (!state.magazynZapotrzebowanie) {
    return html + `<div class="card" style="text-align:center;padding:24px">
      <div style="font-size:32px;margin-bottom:8px">📦</div>
      <div style="font-size:14px;color:var(--dim)">Ładuję dane zleceń...</div>
    </div>`;
  }

  const wyniki = state.magazynZapotrzebowanie;
  if (!wyniki.length) {
    return html + `<div class="card" style="text-align:center;padding:24px">
      <div style="font-size:32px;margin-bottom:8px">✅</div>
      <div style="font-size:14px;color:var(--green)">Brak aktywnych zleceń z BOM</div>
    </div>`;
  }

  // Zbiorczy widok braków
  const allBraki = [];
  wyniki.forEach(({zlecenie, bom}) => {
    bom.forEach(p => {
      const dostepne = p.do_dyspozycji ?? p.stan_rzeczywisty ?? 0;
      const brakuje = p.masa_kg > 0 ? p.masa_kg - dostepne : p.ilosc - dostepne;
      if (brakuje > 0.001) {
        allBraki.push({zlecenie, material: p, brakuje});
      }
    });
  });

  if (allBraki.length) {
    html += `
    <div style="background:rgba(231,76,60,.1);border:1px solid var(--red);border-radius:10px;padding:12px 14px;margin-bottom:14px">
      <div style="font-weight:700;color:var(--red);font-size:13px;margin-bottom:8px">⚠ ${allBraki.length} braków materiałowych w aktywnych zleceniach</div>
      ${allBraki.map(b => {
        const jednostka = b.material.masa_kg > 0 ? 'kg' : (b.material.jm || '');
        return `<div style="padding:6px 0;border-bottom:1px solid rgba(231,76,60,.2);font-size:12px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <span style="color:var(--accent);font-weight:700">${b.zlecenie.numer}</span>
              <span style="color:var(--dim);margin-left:6px">${b.zlecenie.nazwa}</span>
              <div style="margin-top:2px">${b.material.opis}</div>
              <div style="font-size:10px;color:var(--dim)">${b.material.indeks||''}</div>
            </div>
            <div style="text-align:right;white-space:nowrap;margin-left:8px">
              <span style="color:var(--red);font-weight:700">brak ${b.brakuje.toFixed(2)} ${jednostka}</span>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  } else {
    html += `
    <div style="background:rgba(39,174,96,.1);border:1px solid var(--green);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--green);font-weight:600">
      ✅ Wszystkie materiały do aktywnych zleceń są dostępne
    </div>`;
  }

  // Lista zleceń z ich BOM
  html += `<div class="section-hdr">Szczegóły wg zleceń (${wyniki.length})</div>`;
  wyniki.forEach(({zlecenie, bom}) => {
    const braki = bom.filter(p => {
      const d = p.do_dyspozycji ?? p.stan_rzeczywisty ?? 0;
      return p.masa_kg > 0 ? p.masa_kg - d > 0.001 : p.ilosc - d > 0.001;
    });
    const hasBrak = braki.length > 0;
    html += `
    <div class="card" style="margin-bottom:10px;${hasBrak?'border-color:var(--red)':''}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div>
          <div style="font-weight:700;font-size:14px;color:var(--accent)">${zlecenie.numer}</div>
          <div style="font-size:12px;color:var(--dim)">${zlecenie.nazwa}</div>
        </div>
        ${hasBrak
          ? `<span class="badge badge-red">⚠ ${braki.length} braków</span>`
          : `<span class="badge badge-green">✓ OK</span>`}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="border-bottom:1px solid var(--border)">
          <th style="text-align:left;padding:3px 6px;color:var(--dim)">Materiał</th>
          <th style="text-align:right;padding:3px 6px;color:var(--dim)">Potrzeba</th>
          <th style="text-align:right;padding:3px 6px;color:var(--dim)">Stan</th>
          <th style="text-align:right;padding:3px 6px;color:var(--dim)">Status</th>
        </tr></thead><tbody>
        ${bom.map(p => {
          const dostepne = p.do_dyspozycji ?? p.stan_rzeczywisty ?? 0;
          const masaKg = p.masa_kg || 0;
          const useKg = masaKg > 0;
          const potrzeba = useKg ? masaKg : p.ilosc;
          const brakuje = potrzeba - dostepne;
          const ok = brakuje <= 0.001;
          const jednostka = useKg ? 'kg' : (p.jm||'');
          return `<tr style="border-bottom:1px solid rgba(46,53,72,.3)">
            <td style="padding:4px 6px">
              <div style="font-weight:600">${p.opis}</div>
              <div style="color:var(--dim);font-size:10px">${p.indeks||''}${p.gatunek_stali?' · '+p.gatunek_stali:''}</div>
            </td>
            <td style="padding:4px 6px;text-align:right;white-space:nowrap;font-weight:700">${potrzeba.toFixed(2)} ${jednostka}</td>
            <td style="padding:4px 6px;text-align:right;white-space:nowrap;color:${dostepne>0?'var(--green)':'var(--red)'}">${dostepne.toFixed(2)} ${jednostka}</td>
            <td style="padding:4px 6px;text-align:right;white-space:nowrap;font-size:10px;font-weight:700;color:${ok?'var(--green)':'var(--red)'}">
              ${ok ? '✓' : `⚠ -${Math.abs(brakuje).toFixed(2)}`}
            </td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>`;
  });

  return html;
}

// ══════════════════════════════════════════════════════════════
//  NARZĘDZIOWNIA – zarządzanie materiałami eksploatacyjnymi
//  (frezy, płytki, tarcze, rękawice, noże tokarskie, itp.)
// ══════════════════════════════════════════════════════════════

// ─── Ładowanie danych ─────────────────────────────────────────
async function loadNarzCount() {
  try {
    const r = await get('/api/narzedzia/count');
    setState({narzCount: r.count, narzNiskie: r.niskie_stany}, true);
  } catch(_) {}
}

async function loadNarzAll() {
  setState({narzSearching: true});
  try {
    const q = state.narzSearch || '';
    const r = await get(`/api/narzedzia?q=${encodeURIComponent(q)}&limit=200`);
    setState({narzResults: r, narzSearching: false});
  } catch(e) { setState({narzSearching: false}); }
}

async function searchNarz() {
  const q = document.getElementById('narz-search')?.value?.trim() ?? '';
  setState({narzSearch: q});
  await loadNarzAll();
  render();
}

async function loadNarzHistoria() {
  setState({narzHistoriaLoading: true});
  try {
    const r = await get('/api/narzedzia-pobrania?limit=100');
    setState({narzHistoria: r, narzHistoriaLoading: false});
  } catch(_) { setState({narzHistoriaLoading: false, narzHistoria: []}); }
}

async function loadNarzNiskeStany() {
  try {
    const niskie = await get('/api/narzedzia/niskie-stany');
    setState({narzNiskeStany: niskie, narzNiskie: niskie.length}, true);
    render();
  } catch(_) { setState({narzNiskeStany: []}, true); render(); }
}

// ─── Akcje ────────────────────────────────────────────────────
async function pobierzNarz() {
  const m = state.narzPobierzModal;
  if (!m) return;
  const zlecenie = document.getElementById('np-zlecenie')?.value?.trim() || '';
  const ilosc    = parseFloat(document.getElementById('np-ilosc')?.value) || 0;
  const uwagi    = document.getElementById('np-uwagi')?.value?.trim() || '';
  if (ilosc <= 0) { alert('Podaj ilość > 0'); return; }
  if (ilosc > m.stan) { alert(`Brak wystarczającego stanu. Dostępne: ${m.stan} ${m.jm}`); return; }
  try {
    await post('/api/narzedzia-pobrania', {
      narzedzie_id: m.id,
      zlecenie_nr: zlecenie || '—',
      ilosc,
      uwagi,
    });
    setState({narzPobierzModal: null});
    await loadNarzAll();
    await loadNarzCount();
    if (state.narzSubView === 'historia') await loadNarzHistoria();
    if (state.narzNiskeStany !== null) await loadNarzNiskeStany();
    render();
  } catch(e) { alert('Błąd: ' + (e.message || e)); }
}

async function zwrocNarz(pobId, narzId, ilosc) {
  if (!confirm(`Zwrócić ${ilosc} szt. do narzędziowni?`)) return;
  try {
    await fetch((SERVER_URL||'').replace(/\/$/,'') + '/api/narzedzia-pobrania/' + pobId + '/zwrot',
      {method:'PATCH', headers:{'x-api-key': API_KEY}});
    await loadNarzAll();
    await loadNarzCount();
    await loadNarzHistoria();
    if (state.narzNiskeStany !== null) await loadNarzNiskeStany();
    render();
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function saveNarzEdit() {
  const m = state.narzEditModal;
  if (!m) return;
  const stan     = parseFloat(document.getElementById('ne-stan')?.value) || 0;
  const stan_min = parseFloat(document.getElementById('ne-stan-min')?.value) || 1;
  const lok      = document.getElementById('ne-lok')?.value?.trim() || '';
  const uwagi    = document.getElementById('ne-uwagi')?.value?.trim() || '';
  try {
    await fetch((SERVER_URL||'').replace(/\/$/,'') + '/api/narzedzia/' + m.id,
      {method:'PUT', headers:{'Content-Type':'application/json','x-api-key':API_KEY},
       body: JSON.stringify({stan, stan_min, lokalizacja: lok, uwagi})});
    setState({narzEditModal: null});
    await loadNarzAll();
    await loadNarzCount();
    if (state.narzNiskeStany !== null) await loadNarzNiskeStany();
    render();
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function saveNarzDodaj() {
  const indeks = document.getElementById('nd-indeks')?.value?.trim();
  const nazwa  = document.getElementById('nd-nazwa')?.value?.trim();
  const typ    = document.getElementById('nd-typ')?.value?.trim() || '';
  const jm     = document.getElementById('nd-jm')?.value?.trim() || 'szt';
  const stan   = parseFloat(document.getElementById('nd-stan')?.value) || 0;
  const stan_min = parseFloat(document.getElementById('nd-stan-min')?.value) || 1;
  const lok    = document.getElementById('nd-lok')?.value?.trim() || '';
  if (!indeks || !nazwa) { alert('Indeks i Nazwa są wymagane'); return; }
  try {
    await post('/api/narzedzia', {indeks, nazwa, typ, jm, stan, stan_min, lokalizacja: lok});
    hidePanel('narz-dodaj-modal');
    await loadNarzAll();
    await loadNarzCount();
    render();
  } catch(e) { alert('Błąd: ' + (e.message || e)); }
}

async function usunNarz(id) {
  const n = (state.narzResults || []).find(x => x.id === id);
  const nazwa = n?.nazwa || ('#' + id);
  if (!confirm(`Usunąć "${nazwa}" z bazy?`)) return;
  try {
    await del('/api/narzedzia/' + id);
    await loadNarzAll();
    await loadNarzCount();
    render();
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function importNarzedziaXlsx() {
  const fileInput = document.getElementById('narz-xlsx-file');
  const statusEl  = document.getElementById('narz-import-status');
  if (!fileInput?.files?.length) { alert('Wybierz plik xlsx'); return; }
  const file = fileInput.files[0];
  if (statusEl) statusEl.textContent = '⏳ Importuję...';
  try {
    const fd = new FormData();
    fd.append('file', file);
    const resp = await fetch((SERVER_URL||'').replace(/\/$/,'') + '/api/narzedzia/import', {
      method: 'POST', headers:{'x-api-key': API_KEY}, body: fd
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || 'Błąd importu');
    if (statusEl) statusEl.innerHTML =
      `<span style="color:var(--green)">✅ Zaimportowano ${data.imported} pozycji${data.skipped?' · pominięto '+data.skipped:''}</span>`;
    await loadNarzAll();
    await loadNarzCount();
    render();
  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--red)">❌ ${e.message}</span>`;
  }
}

// ─── Render główny ────────────────────────────────────────────
function renderNarzedzialnia() {
  const view   = state.narzSubView || 'stany';
  const niskie = state.narzNiskie  || 0;
  const cnt    = state.narzCount;

  // Auto-init
  if (!state.narzResults?.length && !state.narzSearching && view === 'stany') {
    loadNarzAll();
  }

  let html = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <div style="font-weight:700;font-size:15px">🔧 Narzędziownia</div>
    <div style="display:flex;gap:6px;align-items:center">
      ${niskie > 0 ? `<span style="background:rgba(231,76,60,.15);color:var(--red);border-radius:10px;padding:3px 10px;font-size:11px;font-weight:700">⚠ ${niskie} niskich stanów</span>` : ''}
      <span style="font-size:11px;color:var(--dim)">${cnt !== null ? cnt+' poz.' : ''}</span>
    </div>
  </div>
  <div class="sub-tabs" style="margin-bottom:12px">
    <button class="sub-tab ${view==='stany'?'active':''}" onclick="switchNarzView('stany')">📦 Stany</button>
    <button class="sub-tab ${view==='historia'?'active':''}" onclick="switchNarzView('historia')">📋 Historia</button>
    <button class="sub-tab ${view==='niskie'?'active':''}" style="${niskie>0?'color:var(--red);font-weight:700':''}"
      onclick="switchNarzView('niskie')">⚠ Alerty${niskie>0?' ('+niskie+')':''}</button>
    <button class="sub-tab ${view==='import'?'active':''}" onclick="switchNarzView('import')">📥 Import</button>
  </div>`;

  if (view === 'stany')   html += renderNarzStany();
  if (view === 'historia') html += renderNarzHistoria();
  if (view === 'niskie')  html += renderNarzNiskie();
  if (view === 'import')  html += renderNarzImport();

  // Modals
  if (state.narzPobierzModal) html += renderNarzPobierzModal();
  if (state.narzEditModal)    html += renderNarzEditModal();
  html += renderNarzDodajModal();  // zawsze w DOM, pokazywany przez showPanel

  return html;
}

function switchNarzView(view) {
  setState({narzSubView: view}, true);
  if (view === 'stany'   && !state.narzResults?.length) loadNarzAll();
  if (view === 'historia') loadNarzHistoria();
  if (view === 'niskie')   { setState({narzNiskeStany: null}, true); loadNarzNiskeStany(); }
  render();
}

// ─── Widok: Stany magazynowe ──────────────────────────────────
function renderNarzStany() {
  // Grupowanie wg kategorii (typ)
  const items = state.narzResults || [];

  const byTyp = {};
  items.forEach(n => {
    const t = n.typ || 'Inne';
    if (!byTyp[t]) byTyp[t] = [];
    byTyp[t].push(n);
  });

  let html = `
  <div style="display:flex;gap:6px;margin-bottom:12px">
    <input id="narz-search" type="text" placeholder="🔍 Szukaj nazwy, indeksu, typu..."
      value="${state.narzSearch||''}"
      style="flex:1;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:14px"
      oninput="clearTimeout(window._nst);window._nst=setTimeout(searchNarz,350)"
      onkeyup="if(event.key==='Enter')searchNarz()">
    <button class="btn btn-accent" style="white-space:nowrap;padding:0 14px"
      onclick="showPanel('narz-dodaj-modal')">＋ Dodaj</button>
  </div>`;

  if (state.narzSearching) {
    return html + `<div style="text-align:center;padding:30px;color:var(--dim)">⏳</div>`;
  }
  if (!items.length) {
    return html + `<div class="card" style="text-align:center;padding:30px">
      <div style="font-size:36px;margin-bottom:8px">📭</div>
      <div style="color:var(--dim)">Baza pusta – zaimportuj xlsx lub dodaj ręcznie</div>
    </div>`;
  }

  const typy = Object.keys(byTyp).sort();
  typy.forEach(typ => {
    html += `<div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;
      letter-spacing:.06em;margin:14px 0 6px;padding-left:4px">${typ}</div>`;
    byTyp[typ].forEach(n => {
      const alarm = n.stan < n.stan_min;
      const brak  = n.stan <= 0;
      const statusColor = brak ? 'var(--red)' : alarm ? 'var(--orange)' : 'var(--green)';
      const statusIcon  = brak ? '🔴' : alarm ? '🟡' : '🟢';
      html += `
      <div class="card" style="padding:10px 12px;margin-bottom:6px;${alarm?'border-left:3px solid '+(brak?'var(--red)':'var(--orange)'):''}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="min-width:0;flex:1">
            <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${statusIcon} ${n.nazwa}</div>
            <div style="font-size:11px;color:var(--dim);margin-top:1px">
              ${n.indeks}${n.lokalizacja ? ' · 📍 '+n.lokalizacja : ''}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:17px;font-weight:800;color:${statusColor};line-height:1">${n.stan}</div>
            <div style="font-size:10px;color:var(--dim)">${n.jm} · min:${n.stan_min}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn btn-accent" style="flex:1;padding:8px;font-size:12px"
            onclick='setState({narzPobierzModal:${JSON.stringify(n).replace(/'/g,"&#39;")}})'>
            📤 Pobierz
          </button>
          <button class="btn-sm" style="background:rgba(52,152,219,.12);color:var(--blue);border-color:var(--blue)"
            onclick='setState({narzEditModal:${JSON.stringify(n).replace(/'/g,"&#39;")}})'>✏</button>
          <button class="btn-sm btn-red"
            onclick="usunNarz(${n.id})">🗑</button>
        </div>
      </div>`;
    });
  });
  return html;
}

// ─── Widok: Historia pobrań ───────────────────────────────────
function renderNarzHistoria() {
  if (state.narzHistoriaLoading) return `<div class="spinner">⏳</div>`;
  const lista = state.narzHistoria || [];
  let html = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div class="section-hdr" style="margin-bottom:0">📋 Historia pobrań (${lista.length})</div>
    <button class="btn-sm btn-accent" onclick="loadNarzHistoria()">🔄</button>
  </div>`;
  if (!lista.length) return html + `<div class="card" style="text-align:center;padding:24px;color:var(--dim)">Brak historii pobrań</div>`;

  lista.forEach(p => {
    const zwrocone = p.status === 'zwrocone';
    html += `
    <div class="card" style="padding:10px 12px;margin-bottom:6px;opacity:${zwrocone?0.6:1}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px">${p.narzedzie_nazwa}</div>
          <div style="font-size:11px;color:var(--dim)">${p.narzedzie_indeks||''}</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:5px;align-items:center">
            <span style="background:rgba(52,152,219,.12);color:var(--blue);border-radius:8px;padding:2px 8px;font-size:12px;font-weight:700">
              ${zwrocone?'↩ zwrócono':'📤 pobrano'} ${p.ilosc} ${p.jm}
            </span>
            ${p.zlecenie_nr && p.zlecenie_nr !== '—' ? `<span style="font-size:11px;color:var(--accent);font-weight:600">${p.zlecenie_nr}</span>` : ''}
            <span style="font-size:10px;color:var(--dim)">${(p.created_at||'').slice(0,16).replace('T',' ')}</span>
            <span style="font-size:10px;color:var(--dim)">${p.user_name||''}</span>
          </div>
          ${p.uwagi ? `<div style="font-size:11px;color:var(--dim);margin-top:3px;font-style:italic">${p.uwagi}</div>` : ''}
        </div>
        ${!zwrocone ? `<button class="btn-sm" style="flex-shrink:0;margin-left:8px;background:rgba(39,174,96,.1);color:var(--green);border-color:var(--green)"
          onclick="zwrocNarz(${p.id},${p.narzedzie_id},${p.ilosc})">↩ Zwróć</button>` : ''}
      </div>
    </div>`;
  });
  return html;
}

// ─── Widok: Alerty niskiego stanu ─────────────────────────────
function renderNarzNiskie() {
  const niskie = state.narzNiskeStany;
  if (niskie === undefined || niskie === null) {
    loadNarzNiskeStany();
    return `<div class="spinner">⏳</div>`;
  }
  let html = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div class="section-hdr" style="margin-bottom:0">⚠ Niskie stany – wymaga uzupełnienia</div>
    <button class="btn-sm btn-accent" onclick="setState({narzNiskeStany:null});loadNarzNiskeStany()">🔄</button>
  </div>`;
  if (!niskie.length) return html + `<div class="card" style="text-align:center;padding:28px">
    <div style="font-size:36px;margin-bottom:8px">✅</div>
    <div style="font-weight:600;color:var(--green)">Wszystkie stany powyżej minimum</div>
  </div>`;

  niskie.forEach(n => {
    const brak = n.stan <= 0;
    html += `
    <div class="card" style="padding:12px;margin-bottom:8px;border-left:4px solid ${brak?'var(--red)':'var(--orange)'}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700">${brak?'🔴':'🟡'} ${n.nazwa}</div>
          <div style="font-size:11px;color:var(--dim)">${n.indeks} · ${n.typ||''}${n.lokalizacja?' · 📍'+n.lokalizacja:''}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:10px">
          <div style="font-size:20px;font-weight:800;color:${brak?'var(--red)':'var(--orange)'}">${n.stan}</div>
          <div style="font-size:10px;color:var(--dim)">${n.jm} (min: ${n.stan_min})</div>
        </div>
      </div>
      <div style="margin-top:8px;display:flex;gap:6px">
        <button class="btn btn-accent" style="flex:1;padding:8px;font-size:12px"
          onclick='setState({narzEditModal:${JSON.stringify(n).replace(/'/g,"&#39;")}})'>
          ✏ Uzupełnij stan
        </button>
      </div>
    </div>`;
  });
  return html;
}

// ─── Widok: Import xlsx ───────────────────────────────────────
function renderNarzImport() {
  return `
  <div class="card">
    <div style="font-size:14px;font-weight:700;margin-bottom:10px">📥 Import z pliku Excel (.xlsx)</div>
    <div style="font-size:12px;color:var(--dim);line-height:1.7;margin-bottom:14px">
      Wczytaj bazę materiałów narzędziowni z pliku Excel.<br>
      <b>Wymagane kolumny:</b> <code style="background:var(--panel);padding:1px 5px;border-radius:4px">Indeks</code>
      <code style="background:var(--panel);padding:1px 5px;border-radius:4px">Nazwa</code><br>
      <b>Opcjonalne:</b> Typ / Kategoria, Jm, Stan, Stan_min, Lokalizacja, Uwagi, Kod_paskowy<br>
      <b>Przykładowe typy:</b> Frezy, Płytki, Noże tokarskie, Tarcze, Ściernice, Ochrona osobista, Materiały pomocnicze
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <input type="file" id="narz-xlsx-file" accept=".xlsx,.xls"
        style="flex:1;min-width:0;font-size:12px;color:var(--text);background:var(--panel);
          border:1px solid var(--border);border-radius:8px;padding:8px">
      <button class="btn btn-accent" style="white-space:nowrap" onclick="importNarzedziaXlsx()">📥 Importuj</button>
    </div>
    <div id="narz-import-status" style="font-size:12px;min-height:18px"></div>
  </div>
  <div class="card" style="margin-top:12px">
    <div style="font-size:13px;font-weight:700;margin-bottom:8px">📄 Przykład struktury xlsx</div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="background:var(--panel)">
          ${['Indeks','Nazwa','Typ','Jm','Stan','Stan_min','Lokalizacja'].map(h=>`<th style="padding:5px 8px;text-align:left;border:1px solid var(--border)">${h}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${[
            ['FRZ-001','Frez palcowy HSS fi8','Frezy','szt','10','3','Szafa A/1'],
            ['PLY-042','Płytka CCMT 09T304','Płytki','szt','48','10','Szuflada B'],
            ['TAR-015','Tarcza szlif. 230x2','Tarcze','szt','6','2','Regał C/2'],
            ['OCH-001','Rękawice robocze','Ochrona osobista','par','20','5','Wejście'],
          ].map(r=>`<tr>${r.map(c=>`<td style="padding:4px 8px;border:1px solid var(--border)">${c}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

// ─── Modals ────────────────────────────────────────────────────
function renderNarzPobierzModal() {
  const n = state.narzPobierzModal;
  if (!n) return '';
  const alarm = n.stan < n.stan_min;
  return `
  <div class="modal-overlay" onclick="if(event.target===this)setState({narzPobierzModal:null})">
    <div class="modal">
      <button class="modal-close" onclick="setState({narzPobierzModal:null})">×</button>
      <h3>📤 Pobierz z narzędziowni</h3>
      <div style="background:var(--entry);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:16px">
        <div style="font-weight:700;font-size:15px">${n.nazwa}</div>
        <div style="font-size:11px;color:var(--dim);margin-top:2px">${n.indeks} · ${n.typ||''}</div>
        <div style="margin-top:8px;display:flex;gap:16px">
          <div>
            <div style="font-size:22px;font-weight:800;color:${alarm?'var(--orange)':'var(--green)'};line-height:1">${n.stan}</div>
            <div style="font-size:10px;color:var(--dim)">${n.jm} w magazynie</div>
          </div>
          <div>
            <div style="font-size:22px;font-weight:800;color:var(--dim);line-height:1">${n.stan_min}</div>
            <div style="font-size:10px;color:var(--dim)">minimum</div>
          </div>
        </div>
        ${alarm ? `<div style="margin-top:8px;font-size:11px;color:var(--orange);font-weight:600">⚠ Stan poniżej minimum!</div>` : ''}
      </div>
      <div class="field">
        <label>Ilość do pobrania (${n.jm})</label>
        <input id="np-ilosc" type="number" min="0.01" step="${n.jm==='szt'||n.jm==='par'?'1':'0.01'}"
          value="1" max="${n.stan}"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);
            border-radius:8px;padding:12px;font-size:20px;font-weight:700;box-sizing:border-box;text-align:center">
      </div>
      <div class="field">
        <label>Nr zlecenia (opcja)</label>
        <input id="np-zlecenie" type="text" placeholder="np. G24-001, P25-032 lub cel zakładowy"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);
            border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div class="field">
        <label>Uwagi</label>
        <input id="np-uwagi" type="text" placeholder="opcjonalnie"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);
            border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-accent" style="flex:1;padding:14px" onclick="pobierzNarz()">📤 Pobierz</button>
        <button class="btn btn-outline" style="padding:14px 18px" onclick="setState({narzPobierzModal:null})">Anuluj</button>
      </div>
    </div>
  </div>`;
}

function renderNarzEditModal() {
  const n = state.narzEditModal;
  if (!n) return '';
  return `
  <div class="modal-overlay" onclick="if(event.target===this)setState({narzEditModal:null})">
    <div class="modal">
      <button class="modal-close" onclick="setState({narzEditModal:null})">×</button>
      <h3>✏ Edytuj / Uzupełnij stan</h3>
      <div style="font-weight:700;margin-bottom:4px">${n.nazwa}</div>
      <div style="font-size:11px;color:var(--dim);margin-bottom:16px">${n.indeks}</div>
      <div class="field">
        <label>Stan aktualny (${n.jm})</label>
        <input id="ne-stan" type="number" min="0" step="0.01" value="${n.stan}"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);
            border-radius:8px;padding:12px;font-size:20px;font-weight:700;box-sizing:border-box;text-align:center">
        <div style="font-size:11px;color:var(--dim);margin-top:4px">Wpisz aktualną ilość po inwentaryzacji lub uzupełnieniu</div>
      </div>
      <div class="field">
        <label>Stan minimalny – próg alarmu (${n.jm})</label>
        <input id="ne-stan-min" type="number" min="0" step="0.01" value="${n.stan_min}"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);
            border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div class="field">
        <label>Lokalizacja / półka</label>
        <input id="ne-lok" type="text" value="${n.lokalizacja||''}" placeholder="np. Szafa A, Półka 3"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);
            border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div class="field">
        <label>Uwagi</label>
        <input id="ne-uwagi" type="text" value="${n.uwagi||''}"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);
            border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-accent" style="flex:1" onclick="saveNarzEdit()">💾 Zapisz</button>
        <button class="btn btn-outline" style="padding:14px 18px" onclick="setState({narzEditModal:null})">Anuluj</button>
      </div>
    </div>
  </div>`;
}

function renderNarzDodajModal() {
  const TYPY = ['Frezy','Płytki wymienne','Noże tokarskie','Tarcze szlifierskie',
    'Ściernice','Wiertła','Gwintowniki','Ochrona osobista','Materiały pomocnicze','Inne'];
  return `
  <div id="narz-dodaj-modal" class="modal-overlay" style="display:none" onclick="if(event.target===this)hidePanel('narz-dodaj-modal')">
    <div class="modal">
      <button class="modal-close" onclick="hidePanel('narz-dodaj-modal')">×</button>
      <h3>＋ Dodaj pozycję</h3>
      <div class="field">
        <label>Indeks / kod *</label>
        <input id="nd-indeks" type="text" placeholder="np. FRZ-001" autocomplete="off"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);
            border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div class="field">
        <label>Nazwa *</label>
        <input id="nd-nazwa" type="text" placeholder="np. Frez palcowy HSS fi8" autocomplete="off"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);
            border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="field">
          <label>Kategoria</label>
          <select id="nd-typ"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);
              border-radius:8px;padding:10px 8px;font-size:13px">
            ${TYPY.map(t=>`<option>${t}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Jednostka</label>
          <select id="nd-jm"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);
              border-radius:8px;padding:10px 8px;font-size:13px">
            ${['szt','par','opak','m','mb','kg','l','kpl'].map(j=>`<option>${j}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="field">
          <label>Stan magazynowy</label>
          <input id="nd-stan" type="number" min="0" step="0.01" value="0" autocomplete="off"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);
              border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
        </div>
        <div class="field">
          <label>Stan minimalny (alarm)</label>
          <input id="nd-stan-min" type="number" min="0" step="0.01" value="1" autocomplete="off"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);
              border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
        </div>
      </div>
      <div class="field">
        <label>Lokalizacja</label>
        <input id="nd-lok" type="text" placeholder="np. Szafa A, Półka 2" autocomplete="off"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);
            border-radius:8px;padding:10px 12px;font-size:14px;box-sizing:border-box">
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-accent" style="flex:1" onclick="saveNarzDodaj()">＋ Dodaj</button>
        <button class="btn btn-outline" style="padding:14px 18px" onclick="hidePanel('narz-dodaj-modal')">Anuluj</button>
      </div>
    </div>
  </div>`;
}


function renderRezerwacjaModal() {
  const m = state.rezerwacjaModal;
  if (!m) return '';
  return `
  <div class="modal-overlay" onclick="if(event.target===this)setState({rezerwacjaModal:null})">
    <div class="modal">
      <button class="modal-close" onclick="setState({rezerwacjaModal:null})">×</button>
      <h3>🔒 Rezerwacja materiału</h3>
      <div style="background:var(--entry);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:14px">
        <div style="font-weight:700;font-size:13px">${m.material_opis}</div>
        <div style="font-size:11px;color:var(--dim);margin-top:2px">${m.material_indeks||''}</div>
        <div style="font-size:12px;margin-top:4px">Stan dostępny: <b style="color:var(--green)">${parseFloat(m.stan).toFixed(3)} ${m.jm}</b></div>
      </div>
      <div class="field">
        <label>Nr zlecenia / cel</label>
        <input id="rez-zlecenie" type="text" placeholder="np. G24-001, P25-032 lub Serwis własny"
          style="background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;width:100%;box-sizing:border-box;font-size:14px">
        <div style="font-size:11px;color:var(--dim);margin-top:4px">Zlecenia produkcyjne: G... lub P... | Cele zakładowe: wpisz opis</div>
      </div>
      <div class="field">
        <label>Cel rezerwacji</label>
        <select id="rez-cel" style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:14px">
          <option value="produkcja">🔧 Produkcja (zlecenie G/P)</option>
          <option value="zakładowe">🏭 Cel zakładowy</option>
          <option value="serwis">🔩 Serwis / naprawa</option>
          <option value="inne">📦 Inne</option>
        </select>
      </div>
      <div class="field">
        <label>Ilość (${m.jm})</label>
        <input id="rez-ilosc" type="number" min="0.001" step="0.001" value="1"
          style="background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;width:100%;box-sizing:border-box;font-size:14px">
      </div>
      <div class="field">
        <label>Uwagi (opcjonalnie)</label>
        <input id="rez-uwagi" type="text" placeholder="np. pilne, termin do 15.06"
          style="background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;width:100%;box-sizing:border-box;font-size:14px">
      </div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="btn btn-accent" style="flex:1" onclick="dodajRezerwacje()">🔒 Zarezerwuj</button>
        <button class="btn btn-outline" style="flex:0 0 auto;width:auto;padding:14px 18px" onclick="setState({rezerwacjaModal:null})">Anuluj</button>
      </div>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════
