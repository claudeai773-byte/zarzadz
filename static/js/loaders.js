//  DATA LOADERS
// ══════════════════════════════════════════════════════════════
async function loadPracownik() {
  setState({loading:true, error:null});
  try {
    const [ops, sesje] = await Promise.all([
      get('/api/operacje/aktywne'),
      get(`/api/sesje/aktywne/${state.user.id}`),
    ]);
    stopAllTimers();
    for (const s of sesje) startTimerFor(s);
    setState({operacje:ops, aktywnesje:sesje, loading:false});
  } catch(e) {
    setState({loading:false, error:e.message});
  }
}

async function loadMajster() {
  setState({loading:true, error:null, majsterOpsCache:{}});
  try {
    const stats = await get('/api/stats/majster');
    setState({majsterStats:stats, loading:false});
  } catch(e) {
    setState({loading:false, error:e.message});
  }
}

async function loadMagazynier() {
  setState({loading:true, error:null});
  try {
    const ops = await get('/api/operacje/zakonczone-do-transportu');
    setState({transportOps:ops, loading:false});
  } catch(e) {
    setState({loading:false, error:e.message});
  }
}

async function loadZlecenia() {
  setState({loading:true, error:null});
  try {
    const zl = await get('/api/zlecenia');
    // Zbierz ID wszystkich podzleceń P równolegle (tylko aktywne zlecenia – nie zakończone/anulowane)
    // żeby odfiltrować je z głównej listy
    const aktywne = (zl || []).filter(z => z.status !== 'zakonczone' && z.status !== 'anulowane');
    const zapResults = await Promise.all(
      aktywne.map(z => get(`/api/zlecenia/${z.id}/zapotrzebowania`).catch(() => []))
    );
    const podzlecenieIds = new Set(state.podzlecenieIds || []);
    zapResults.forEach(zapotrz => {
      (zapotrz || []).forEach(zap => {
        if (zap.zlecenie_p_id) podzlecenieIds.add(zap.zlecenie_p_id);
      });
    });
    setState({zlecenia: zl, podzlecenieIds, loading: false});
  } catch(e) {
    setState({loading:false, error:e.message});
  }
}

async function loadAdmin() {
  setState({loading:true, error:null});
  try {
    const [users, stawki, katalog, userPermissions] = await Promise.all([
      get('/api/users'), get('/api/stawki'), get('/api/katalog'), get('/api/permissions/all')
    ]);
    setState({users, stawki, katalog, userPermissions, loading:false});
  } catch(e) {
    setState({loading:false, error:e.message});
  }
}

// ── Sprawdź braki magazynowe (dla ikony !) ────────────────────
async function loadMagazynBraki() {
  try {
    const data = await get('/api/zlecenia');
    const aktywne = (data||[]).filter(z => z.status !== 'zakonczone' && z.status !== 'anulowane');
    let braki = false;
    for (const z of aktywne.slice(0,10)) {
      try {
        const bom = await get(`/api/zlecenia/${z.id}/bom`);
        for (const p of bom) {
          const dostepne = p.do_dyspozycji ?? p.stan_rzeczywisty ?? 0;
          const brakuje = p.masa_kg > 0 ? p.masa_kg - dostepne : p.ilosc - dostepne;
          if (brakuje > 0.001) { braki = true; break; }
        }
        if (braki) break;
      } catch(_) {}
    }
    setState({magazynBraki: braki}, true);
    render();
  } catch(_) {}
}

// ── Zapotrzebowanie produkcyjne ─────────────────────────────────
async function loadMagazynZapotrzebowanie() {
  setState({magazynZapotrzebowanieLoading: true, magazynZapotrzebowanie: null});
  try {
    const zlecenia = await get('/api/zlecenia');
    const aktywne = (zlecenia||[]).filter(z => z.status !== 'zakonczone' && z.status !== 'anulowane');
    const wyniki = [];
    for (const z of aktywne) {
      try {
        const bom = await get(`/api/zlecenia/${z.id}/bom`);
        if (bom && bom.length) {
          wyniki.push({zlecenie: z, bom});
        }
      } catch(_) {}
    }
    setState({magazynZapotrzebowanie: wyniki, magazynZapotrzebowanieLoading: false});
  } catch(e) {
    setState({magazynZapotrzebowanie: [], magazynZapotrzebowanieLoading: false});
  }
}

// ── Materiały w Magazynie ───────────────────────────────────────
async function loadMagazynMaterialyCount() {
  try {
    const res = await get('/api/materialy/count');
    setState({magazynMatCount: res.count ?? res ?? 0});
  } catch(_) {
    try {
      const res = await get('/api/materialy?q=&limit=1');
      setState({magazynMatCount: '?'});
    } catch(_2) {}
  }
}

async function loadMagazynMaterialySearch() {
  const q = document.getElementById('mag-mat-search')?.value?.trim() || state.magazynMatSearch;
  if (!q) return;
  setState({magazynMatSearching: true, magazynMatSearch: q});
  try {
    const res = await get(`/api/materialy?q=${encodeURIComponent(q)}&limit=30`);
    setState({magazynMatResults: res, magazynMatSearching: false});
  } catch(e) { setState({magazynMatSearching: false}); }
}

// ── Rezerwacje (serwer API – trwałe przez restarty) ─────────────────────────
function loadRezerwacje() {
  // Zwraca aktualny stan z pamięci (synchronicznie dla renderowania)
  return state.magazynRezerwacje || [];
}
async function loadRezerwacjeZSerwera() {
  if (!SERVER_URL || !API_KEY) return;
  try {
    const res = await get('/api/mag-rezerwacje');
    if (Array.isArray(res)) {
      setState({magazynRezerwacje: res});
      // Migracja jednorazowa – przenies lokalne rezerwacje na serwer
      const lokalne = JSON.parse(localStorage.getItem('mag_rezerwacje') || '[]');
      if (lokalne.length > 0) {
        try {
          await post('/api/mag-rezerwacje/import-local', {rezerwacje: lokalne});
          localStorage.removeItem('mag_rezerwacje');
          const res2 = await get('/api/mag-rezerwacje');
          if (Array.isArray(res2)) setState({magazynRezerwacje: res2});
          console.log(`✓ Zmigrowano ${lokalne.length} rezerwacji z localStorage na serwer`);
        } catch(_) {}
      }
    }
  } catch(_) {
    // Fallback: użyj localStorage jeśli serwer niedostępny
    try { setState({magazynRezerwacje: JSON.parse(localStorage.getItem('mag_rezerwacje') || '[]')}); } catch(_2){}
  }
}

// ── Ręczny CRUD materiałów ───────────────────────────────────────────────────
function otworzFormularzDodajMaterial() {
  // Czyść pola
  ['mat-f-indeks','mat-f-kod','mat-f-opis','mat-f-kp'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = '';
  });
  const dysp = document.getElementById('mat-f-dysp'); if(dysp) dysp.value = '0';
  const stan = document.getElementById('mat-f-stan'); if(stan) stan.value = '0';
  const jm = document.getElementById('mat-f-jm'); if(jm) jm.value = 'kg';
  const eid = document.getElementById('mat-f-edit-id'); if(eid) eid.value = '';
  const title = document.getElementById('mag-dodaj-title'); if(title) title.textContent = '➕ Dodaj nowy materiał';
  const btn = document.getElementById('mat-f-save-btn'); if(btn) btn.textContent = '✅ Dodaj materiał';
  showPanel('mag-dodaj-panel');
  // Scroll do formularza
  setTimeout(() => document.getElementById('mag-dodaj-panel')?.scrollIntoView({behavior:'smooth', block:'start'}), 50);
}
function otworzEdycjeMaterialu(mat) {
  const f = id => document.getElementById(id);
  if(f('mat-f-indeks')) f('mat-f-indeks').value = mat.indeks || '';
  if(f('mat-f-kod'))    f('mat-f-kod').value    = mat.kod || '';
  if(f('mat-f-opis'))   f('mat-f-opis').value   = mat.opis || '';
  if(f('mat-f-dysp'))   f('mat-f-dysp').value   = mat.do_dyspozycji ?? 0;
  if(f('mat-f-stan'))   f('mat-f-stan').value   = mat.stan_rzeczywisty ?? 0;
  if(f('mat-f-kp'))     f('mat-f-kp').value     = mat.kod_paskowy || '';
  if(f('mat-f-jm'))     f('mat-f-jm').value     = mat.jm || 'kg';
  if(f('mat-f-edit-id')) f('mat-f-edit-id').value = mat.id;
  const title = document.getElementById('mag-dodaj-title'); if(title) title.textContent = '✏️ Edytuj materiał';
  const btn = document.getElementById('mat-f-save-btn'); if(btn) btn.textContent = '💾 Zapisz zmiany';
  showPanel('mag-dodaj-panel');
  setTimeout(() => document.getElementById('mag-dodaj-panel')?.scrollIntoView({behavior:'smooth', block:'start'}), 50);
}
function zamknijFormularzMaterialu() {
  hidePanel('mag-dodaj-panel');
}
async function zapiszMaterial() {
  const f = id => document.getElementById(id)?.value?.trim();
  const indeks = f('mat-f-indeks');
  const opis   = f('mat-f-opis');
  const mid    = f('mat-f-edit-id');
  if (!indeks) { alert('Indeks jest wymagany'); return; }
  if (!opis)   { alert('Opis artykułu jest wymagany'); return; }
  const body = {
    indeks,
    opis,
    kod:             f('mat-f-kod') || '',
    jm:              document.getElementById('mat-f-jm')?.value || 'kg',
    do_dyspozycji:   parseFloat(document.getElementById('mat-f-dysp')?.value) || 0,
    stan_rzeczywisty:parseFloat(document.getElementById('mat-f-stan')?.value) || 0,
    kod_paskowy:     f('mat-f-kp') || '',
  };
  const btn = document.getElementById('mat-f-save-btn');
  if(btn) { btn.disabled = true; btn.textContent = '⏳ Zapisuję...'; }
  try {
    if (mid) {
      await put('/api/materialy/' + mid, body);
    } else {
      await post('/api/materialy', body);
    }
    hidePanel('mag-dodaj-panel');
    await loadMagazynMaterialyCount();
    if (state.magazynMatSearch) await loadMagazynMaterialySearch();
    else { state.magazynMatSearch = indeks; await loadMagazynMaterialySearch(); }
  } catch(e) {
    alert('Błąd: ' + (e.message || JSON.stringify(e)));
    if(btn) { btn.disabled = false; btn.textContent = mid ? '💾 Zapisz zmiany' : '✅ Dodaj materiał'; }
  }
}
async function zapiszNabyMaterial() { return zapiszMaterial(); }
async function zapiszEdycjeMaterialu(mid) { return zapiszMaterial(); }
async function usunMaterial(mid) {
  const mat = (state.magazynMatResults||[]).find(m => m.id === mid);
  const opis = mat ? mat.opis : 'ten materiał';
  if (!confirm(`Usunąć materiał:\n"${opis}"?\n\nUwaga: zostaną usunięte też powiązane pozycje BOM i rezerwacje.`)) return;
  try {
    await del('/api/materialy/' + mid);
    await loadMagazynMaterialyCount();
    await loadMagazynMaterialySearch();
  } catch(e) {
    alert('Błąd: ' + (e.message || JSON.stringify(e)));
  }
}

function openRezerwacjaModal(mat) {
  setState({rezerwacjaModal: {
    material_id: mat.id,
    material_opis: mat.opis,
    material_indeks: mat.indeks,
    stan: mat.do_dyspozycji ?? mat.stan_rzeczywisty ?? 0,
    jm: mat.jm || 'szt',
  }});
}
async function dodajRezerwacje() {
  const m = state.rezerwacjaModal;
  if (!m) return;
  const zlecenie = document.getElementById('rez-zlecenie')?.value?.trim();
  const ilosc = parseFloat(document.getElementById('rez-ilosc')?.value) || 0;
  const uwagi = document.getElementById('rez-uwagi')?.value?.trim() || '';
  if (!zlecenie) { alert('Wpisz numer zlecenia G... lub P... (lub cel zakładowy)'); return; }
  if (ilosc <= 0) { alert('Podaj ilość > 0'); return; }
  try {
    await post('/api/mag-rezerwacje', {
      id: 'rez_' + Date.now(),
      material_id: m.material_id,
      ilosc,
      zlecenie_nr: zlecenie,
      uwagi,
    });
    const res = await get('/api/mag-rezerwacje');
    if (Array.isArray(res)) setState({magazynRezerwacje: res, rezerwacjaModal: null});
    else setState({rezerwacjaModal: null});
    // Odśwież też stany materiałów
    if (state.magazynMatSearch) loadMagazynMaterialySearch();
  } catch(e) {
    alert('Błąd zapisu rezerwacji: ' + (e.message || e));
  }
}
async function usunRezerwacje(id) {
  if (!confirm('Usunąć rezerwację?')) return;
  try {
    await del('/api/mag-rezerwacje/' + id);
    const res = await get('/api/mag-rezerwacje');
    if (Array.isArray(res)) setState({magazynRezerwacje: res});
    if (state.magazynMatSearch) loadMagazynMaterialySearch();
  } catch(e) { alert('Błąd: ' + (e.message||e)); }
}
async function zwolnijRezerwacje(id) {
  try {
    await patch('/api/mag-rezerwacje/' + id + '/zwolnij', {});
    const res = await get('/api/mag-rezerwacje');
    if (Array.isArray(res)) setState({magazynRezerwacje: res});
    if (state.magazynMatSearch) loadMagazynMaterialySearch();
  } catch(e) { alert('Błąd: ' + (e.message||e)); }
}


async function loadPracownikWydajnosc(okres) {
  const o = okres || state.pracaWydOkres;
  setState({pracaWydOkres: o});
  try {
    const w = await get(`/api/stats/wydajnosc/${state.user.id}?okres=${o}`);
    setState({pracaWydajnosc: w});
  } catch(e) { alert(e.message); }
}

async function loadWydajnoscMajster(okres) {
  const o = okres || state.wydajnoscOkres;
  setState({wydajnoscOkres: o, wydajnoscMajster: null});
  try {
    const w = await get(`/api/stats/wydajnosc?okres=${o}`);
    setState({wydajnoscMajster: w});
  } catch(e) {
    setState({wydajnoscMajster: {pracownicy: [], error: e.message}});
  }
}

// ══════════════════════════════════════════════════════════════
