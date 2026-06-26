//  ZLECENIE – DRZEWKO P/M (półprodukty i materiały)
// ══════════════════════════════════════════════════════════════

// Rozwiń/zwiń drzewko zlecenia inline
async function toggleZlecenieExpand(zid) {
  const expanded = state.zlecenieExpanded || {};
  const isOpen   = !!expanded[zid];

  if (isOpen) {
    setState({ zlecenieExpanded: { ...expanded, [zid]: false } });
    return;
  }

  // Rozwiń i zawsze przeładuj dane (żeby pokazać zmiany po edycji)
  setState({ zlecenieExpanded: { ...expanded, [zid]: true } });
  try {
    const [data, matsM] = await Promise.all([
      get(`/api/zlecenia/${zid}/drzewo`),
      get(`/api/zlecenia/${zid}/materialy-zlecenia`).catch(() => []),
    ]);

    // Uzupełnij materiały M jeśli /drzewo ich nie zwraca
    if (!data.materialy || data.materialy.length === 0) {
      data.materialy = matsM || [];
    }

    // Zaktualizuj podzlecenieIds – ukryj podzlecenia P z głównej listy
    const updatedPodzlecenieIds = new Set(state.podzlecenieIds || []);
    (data.podzlecenia_drzewo || []).forEach(pd => {
      if (pd.zlecenie_p_id) updatedPodzlecenieIds.add(pd.zlecenie_p_id);
      (pd.podzlecenia || []).forEach(sub => {
        const subId = sub.zap?.zlecenie_p_id || sub.zap?.zp_id;
        if (subId) updatedPodzlecenieIds.add(subId);
      });
    });

    setState({ zlecenieDrzewa: { ...(state.zlecenieDrzewa || {}), [zid]: data }, podzlecenieIds: updatedPodzlecenieIds });
  } catch(e) {
    setState({ zlecenieDrzewa: { ...(state.zlecenieDrzewa || {}), [zid]: { polprodukty:[], materialy:[], operacje:[], podzlecenia_drzewo:[], error: e.message } } });
  }
}

// Odśwież dane drzewka dla jednego zlecenia
async function refreshZlecenieDrzewo(zid) {
  try {
    const [data, matsM] = await Promise.all([
      get(`/api/zlecenia/${zid}/drzewo`),
      get(`/api/zlecenia/${zid}/materialy-zlecenia`).catch(() => []),
    ]);
    if (!data.materialy || data.materialy.length === 0) {
      data.materialy = matsM || [];
    }
    // Zaktualizuj podzlecenieIds
    const updatedPodzlecenieIds = new Set(state.podzlecenieIds || []);
    (data.podzlecenia_drzewo || []).forEach(pd => {
      if (pd.zlecenie_p_id) updatedPodzlecenieIds.add(pd.zlecenie_p_id);
      (pd.podzlecenia || []).forEach(sub => {
        const subId = sub.zap?.zlecenie_p_id || sub.zap?.zp_id;
        if (subId) updatedPodzlecenieIds.add(subId);
      });
    });
    setState({ zlecenieDrzewa: { ...(state.zlecenieDrzewa || {}), [zid]: data }, podzlecenieIds: updatedPodzlecenieIds });
  } catch(e) { /* cicho */ }
}

// ── Renderowanie listy P w formularzu edycji ─────────────────────────────────
function renderPolproduktList(zid) {
  const drzewo = (state.zlecenieDrzewa || {})[zid];
  const lista  = drzewo?.polprodukty || [];
  if (!lista.length) return `<div style="color:var(--dim);font-size:12px;padding:6px 0">Brak półproduktów</div>`;
  return lista.map(p => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--entry);border-radius:6px;margin-bottom:4px">
      <span style="color:#a78bfa;font-size:12px;font-weight:700;min-width:60px">${p.symbol}</span>
      <span style="font-size:12px;flex:1">${p.nazwa}</span>
      <span style="font-size:11px;color:var(--dim)">${p.ilosc} ${p.jednostka}</span>
      <button onclick="openEditPolprodukt(${zid},${JSON.stringify(p).replace(/"/g,'&quot;')})" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:13px">✏</button>
      <button onclick="deletePolprodukt(${zid},${p.id})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:13px">🗑</button>
    </div>`).join('');
}

// ── Renderowanie listy M w formularzu edycji ─────────────────────────────────
function renderMaterialList(zid) {
  const drzewo = (state.zlecenieDrzewa || {})[zid];
  const lista  = drzewo?.materialy || [];
  if (!lista.length) return `<div style="color:var(--dim);font-size:12px;padding:6px 0">Brak materiałów</div>`;
  return lista.map(m => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--entry);border-radius:6px;margin-bottom:4px">
      <span style="color:var(--orange);font-size:12px;font-weight:700;min-width:60px">${m.indeks}</span>
      <span style="font-size:12px;flex:1">${m.opis}</span>
      <span style="font-size:11px;color:var(--dim)">${m.ilosc} ${m.jednostka}</span>
      <button onclick="openEditMaterial(${zid},${JSON.stringify(m).replace(/"/g,'&quot;')})" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:13px">✏</button>
      <button onclick="deleteMaterialZlecenia(${zid},${m.id})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:13px">🗑</button>
    </div>`).join('');
}

// ── Modal: dodaj/edytuj półprodukt P ─────────────────────────────────────────
function openAddPolprodukt(zid) {
  setState({ pmModal: { typ: 'polprodukt', zid, item: null } });
}
function openEditPolprodukt(zid, item) {
  setState({ pmModal: { typ: 'polprodukt', zid, item } });
}

function renderPolproduktModal() {
  const m = state.pmModal;
  if (!m || m.typ !== 'polprodukt') return '';
  const it = m.item || {};
  return `
  <div class="modal-overlay" onclick="if(event.target===this)setState({pmModal:null})">
    <div class="modal" style="max-width:420px">
      <button class="modal-close" onclick="setState({pmModal:null})">×</button>
      <h3>${it.id ? '✏ Edytuj półprodukt P' : '+ Dodaj półprodukt P'}</h3>
      <div class="field"><label>Symbol P (np. P18653)</label>
        <input id="pm-p-symbol" type="text" value="${it.symbol||''}" placeholder="P00001">
      </div>
      <div class="field"><label>Nazwa</label>
        <input id="pm-p-nazwa" type="text" value="${it.nazwa||''}" placeholder="Nazwa półproduktu">
      </div>
      <div style="display:flex;gap:10px">
        <div class="field" style="flex:1"><label>Ilość</label>
          <input id="pm-p-ilosc" type="number" step="0.01" min="0.01" value="${it.ilosc||1}">
        </div>
        <div class="field" style="flex:1"><label>Jednostka</label>
          <select id="pm-p-jm" style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:12px 14px;font-size:15px">
            ${['szt','kpl','m','m²','m³','kg'].map(j => `<option value="${j}" ${(it.jednostka||'szt')===j?'selected':''}>${j}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field"><label>Uwagi</label>
        <input id="pm-p-uwagi" type="text" value="${it.uwagi||''}" placeholder="Opcjonalne uwagi">
      </div>
      <button class="btn btn-accent" onclick="savePolprodukt(${m.zid},${it.id||0})">💾 Zapisz</button>
    </div>
  </div>`;
}

async function savePolprodukt(zid, pid) {
  const symbol = document.getElementById('pm-p-symbol')?.value?.trim();
  const nazwa  = document.getElementById('pm-p-nazwa')?.value?.trim();
  const ilosc  = parseFloat(document.getElementById('pm-p-ilosc')?.value) || 1;
  const jm     = document.getElementById('pm-p-jm')?.value || 'szt';
  const uwagi  = document.getElementById('pm-p-uwagi')?.value?.trim() || '';
  if (!symbol) { alert('Wpisz symbol P'); return; }
  if (!nazwa)  { alert('Wpisz nazwę'); return; }
  try {
    if (pid) {
      await put(`/api/zlecenia/${zid}/polprodukty/${pid}`, { symbol, nazwa, ilosc, jednostka: jm, uwagi });
    } else {
      await post(`/api/zlecenia/${zid}/polprodukty`, { symbol, nazwa, ilosc, jednostka: jm, uwagi });
    }
    setState({ pmModal: null });
    const pdm = state.podZlecenieModal;
    if (pdm && !pdm.loading && pdm.zid === zid) {
      const gid = pdm.parentGid;
      await openPodZlecenieModal(zid, gid);
      if (gid) await refreshZlecenieDrzewo(gid);
    } else {
      await refreshZlecenieDrzewo(zid);
    }
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function deletePolprodukt(zid, pid) {
  if (!confirm('Usunąć ten półprodukt?')) return;
  try {
    await del(`/api/zlecenia/${zid}/polprodukty/${pid}`);
    const pdm = state.podZlecenieModal;
    if (pdm && !pdm.loading && pdm.zid === zid) {
      const gid = pdm.parentGid;
      await openPodZlecenieModal(zid, gid);
      if (gid) await refreshZlecenieDrzewo(gid);
    } else {
      await refreshZlecenieDrzewo(zid);
    }
  } catch(e) { alert('Błąd: ' + e.message); }
}

// ── Modal: dodaj/edytuj materiał M ───────────────────────────────────────────
function openAddMaterial(zid) {
  setState({ pmModal: { typ: 'material', zid, item: null } });
}
function openEditMaterial(zid, item) {
  setState({ pmModal: { typ: 'material', zid, item } });
}

function renderMaterialZleceniaModal() {
  const m = state.pmModal;
  if (!m || m.typ !== 'material') return '';
  const it = m.item || {};
  const jmVal = it.jednostka || 'kg';
  // Szukaj danych materiału z bazy (jeśli wczytano)
  const matBaza = (state.magazynMatResults || []).find(x => x.indeks === it.indeks) || null;
  const matJm = matBaza?.jm || jmVal;
  const isSzt = matJm === 'szt' || matJm === 'kpl';
  const isKg  = matJm === 'kg' || matJm === 't';

  // Podpowiedź wymiarów z bazy materiałów
  let wymPodpowiedz = '';
  if (isKg && matBaza) {
    const parts = [];
    if (matBaza.szerokosc > 0) parts.push(`szer: ${matBaza.szerokosc} mm`);
    if (matBaza.dlugosc > 0) parts.push(`dł: ${matBaza.dlugosc} mm`);
    if (matBaza.ciezar_jedn > 0) parts.push(`cięż. jedn.: ${matBaza.ciezar_jedn} kg/m`);
    if (parts.length) wymPodpowiedz = `<div style="font-size:10px;color:var(--blue);margin-top:4px">📐 Dane z bazy: ${parts.join(' · ')}</div>`;
  }

  const jmOpts = ['kg','szt','m','m²','m³','kpl','l','t'].map(j =>
    `<option value="${j}" ${jmVal===j?'selected':''}>${j}</option>`).join('');

  return `
  <div class="modal-overlay" onclick="if(event.target===this)setState({pmModal:null})">
    <div class="modal" style="max-width:440px">
      <button class="modal-close" onclick="setState({pmModal:null})">×</button>
      <h3>${it.id ? '✏ Edytuj materiał M' : '+ Dodaj materiał M'}</h3>
      <div class="field"><label>Indeks materiału</label>
        <input id="pm-m-indeks" type="text" value="${it.indeks||''}" placeholder="np. M04497"
          oninput="pmMIndeksChange()" autocomplete="off">
      </div>
      <div class="field"><label>Opis / nazwa</label>
        <input id="pm-m-opis" type="text" value="${it.opis||''}" placeholder="np. BLACHA 1 GAT.DC.01." autocomplete="off">
      </div>
      <div class="field"><label>Jednostka (J.M.)</label>
        <select id="pm-m-jm" onchange="pmMJmChange()"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:12px 14px;font-size:15px">
          ${jmOpts}
        </select>
      </div>

      <!-- Tryb: szt / kpl – tylko ilość -->
      <div id="pm-m-szt-row" style="${isSzt?'':'display:none'}">
        <div class="field">
          <label>Ilość (szt)</label>
          <input id="pm-m-ilosc-szt" type="number" step="1" min="1"
            value="${isSzt ? Math.round(it.ilosc||1) : 1}"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:20px;font-weight:700;box-sizing:border-box;text-align:center">
        </div>
      </div>

      <!-- Tryb: kg / t – długość + opcjonalnie szerokość → oblicza wagę -->
      <div id="pm-m-kg-row" style="${isKg?'':'display:none'}">
        <div style="font-size:11px;color:var(--dim);margin-bottom:8px">Wpisz wymiary do obliczenia masy, lub wpisz masę bezpośrednio:</div>
        ${wymPodpowiedz}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <div class="field" style="margin-bottom:0">
            <label>Długość (mm)</label>
            <input id="pm-m-dlugosc" type="number" step="1" min="0" value="${it.dlugosc||''}"
              placeholder="np. 6000" oninput="pmMObliczKg()"
              style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:15px;box-sizing:border-box">
          </div>
          <div class="field" style="margin-bottom:0">
            <label>Szerokość (mm) <span style="color:var(--dim);font-size:10px">opcja</span></label>
            <input id="pm-m-szerokosc" type="number" step="1" min="0" value="${it.szerokosc||''}"
              placeholder="np. 200" oninput="pmMObliczKg()"
              style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:15px;box-sizing:border-box">
          </div>
        </div>
        <div class="field">
          <label>Masa (kg) – wynik lub wpis ręczny</label>
          <input id="pm-m-ilosc-kg" type="number" step="0.001" min="0.001"
            value="${isKg ? (it.ilosc||1) : 1}"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:20px;font-weight:700;box-sizing:border-box;text-align:center">
          <div id="pm-m-kg-hint" style="font-size:10px;color:var(--dim);margin-top:4px"></div>
        </div>
      </div>

      <!-- Tryb: inne jednostki -->
      <div id="pm-m-inne-row" style="${(!isSzt && !isKg)?'':'display:none'}">
        <div class="field"><label>Ilość</label>
          <input id="pm-m-ilosc" type="number" step="0.01" min="0.01"
            value="${(!isSzt && !isKg) ? (it.ilosc||1) : 1}"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:20px;font-weight:700;box-sizing:border-box;text-align:center">
        </div>
      </div>

      <div class="field"><label>Uwagi</label>
        <input id="pm-m-uwagi" type="text" value="${it.uwagi||''}" placeholder="Opcjonalne uwagi">
      </div>
      <button class="btn btn-accent" onclick="saveMaterialZlecenia(${m.zid},${it.id||0})">💾 Zapisz</button>
    </div>
  </div>`;
}

function pmMJmChange() {
  const jm = document.getElementById('pm-m-jm')?.value || 'kg';
  const isSzt = jm === 'szt' || jm === 'kpl';
  const isKg  = jm === 'kg'  || jm === 't';
  const show = (id, v) => { const el = document.getElementById(id); if(el) el.style.display = v?'':'none'; };
  show('pm-m-szt-row', isSzt);
  show('pm-m-kg-row', isKg);
  show('pm-m-inne-row', !isSzt && !isKg);
}

function pmMIndeksChange() {
  const indeks = document.getElementById('pm-m-indeks')?.value?.trim();
  if (!indeks) return;
  // Uzupełnij opis jeśli materiał jest w bazie i pole opis jest puste
  const mat = (state.magazynMatResults || []).find(x => x.indeks === indeks);
  if (mat) {
    const opis = document.getElementById('pm-m-opis');
    if (opis && !opis.value) opis.value = mat.opis;
    // Ustaw właściwą JM
    const jmEl = document.getElementById('pm-m-jm');
    if (jmEl && mat.jm) { jmEl.value = mat.jm; pmMJmChange(); }
    // Zapisz dane materiału w window dla obliczenia kg
    window._pmMatBaza = mat;
  }
}

function pmMObliczKg() {
  const mat = window._pmMatBaza;
  const dlugosc = parseFloat(document.getElementById('pm-m-dlugosc')?.value) || 0;
  const szerokosc = parseFloat(document.getElementById('pm-m-szerokosc')?.value) || 0;
  if (!dlugosc) return;
  let masa = 0;
  let hint = '';
  if (mat && mat.ciezar_jedn > 0) {
    // ciezar_jedn w kg/m – dlugosc w mm
    masa = (dlugosc / 1000) * mat.ciezar_jedn;
    hint = `${dlugosc} mm × ${mat.ciezar_jedn} kg/m = ${masa.toFixed(3)} kg`;
    // Jeśli podano też szerokość i baza ma tylko ciężar/mb – można pominąć szer
  } else if (mat && mat.szerokosc > 0 && mat.dlugosc > 0) {
    // Brak ciężaru jedn – spróbuj z gęstości stali ~7.85 kg/dm³
    hint = 'Brak ciężaru jedn. – wpisz masę ręcznie';
  }
  if (masa > 0) {
    const el = document.getElementById('pm-m-ilosc-kg');
    if (el) el.value = masa.toFixed(3);
    const hintEl = document.getElementById('pm-m-kg-hint');
    if (hintEl) hintEl.textContent = hint;
  }
}

async function saveMaterialZlecenia(zid, mid) {
  const indeks = document.getElementById('pm-m-indeks')?.value?.trim();
  const opis   = document.getElementById('pm-m-opis')?.value?.trim();
  const jm     = document.getElementById('pm-m-jm')?.value || 'kg';
  const uwagi  = document.getElementById('pm-m-uwagi')?.value?.trim() || '';
  if (!indeks) { alert('Wpisz indeks materiału'); return; }
  if (!opis)   { alert('Wpisz opis'); return; }

  let ilosc = 1;
  const isSzt = jm === 'szt' || jm === 'kpl';
  const isKg  = jm === 'kg'  || jm === 't';
  if (isSzt) {
    ilosc = parseInt(document.getElementById('pm-m-ilosc-szt')?.value) || 1;
  } else if (isKg) {
    ilosc = parseFloat(document.getElementById('pm-m-ilosc-kg')?.value) || 1;
  } else {
    ilosc = parseFloat(document.getElementById('pm-m-ilosc')?.value) || 1;
  }

  try {
    if (mid) {
      await put(`/api/zlecenia/${zid}/materialy-zlecenia/${mid}`, { indeks, opis, ilosc, jednostka: jm, uwagi });
    } else {
      await post(`/api/zlecenia/${zid}/materialy-zlecenia`, { indeks, opis, ilosc, jednostka: jm, uwagi });
    }
    setState({ pmModal: null });
    const pdm = state.podZlecenieModal;
    if (pdm && !pdm.loading && pdm.zid === zid) {
      const gid = pdm.parentGid;
      await openPodZlecenieModal(zid, gid);
      if (gid) await refreshZlecenieDrzewo(gid);
    } else {
      await refreshZlecenieDrzewo(zid);
    }
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function deleteMaterialZlecenia(zid, mid) {
  if (!confirm('Usunąć ten materiał?')) return;
  try {
    await del(`/api/zlecenia/${zid}/materialy-zlecenia/${mid}`);
    const pdm = state.podZlecenieModal;
    if (pdm && !pdm.loading && pdm.zid === zid) {
      const gid = pdm.parentGid;
      await openPodZlecenieModal(zid, gid);
      if (gid) await refreshZlecenieDrzewo(gid);
    } else {
      await refreshZlecenieDrzewo(zid);
    }
  } catch(e) { alert('Błąd: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════
