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
  return `
  <div class="modal-overlay" onclick="if(event.target===this)setState({pmModal:null})">
    <div class="modal" style="max-width:420px">
      <button class="modal-close" onclick="setState({pmModal:null})">×</button>
      <h3>${it.id ? '✏ Edytuj materiał M' : '+ Dodaj materiał M'}</h3>
      <div class="field"><label>Indeks materiału</label>
        <input id="pm-m-indeks" type="text" value="${it.indeks||''}" placeholder="np. 78111">
      </div>
      <div class="field"><label>Opis</label>
        <input id="pm-m-opis" type="text" value="${it.opis||''}" placeholder="Blacha 40x405x4390">
      </div>
      <div style="display:flex;gap:10px">
        <div class="field" style="flex:1"><label>Ilość</label>
          <input id="pm-m-ilosc" type="number" step="0.01" min="0.01" value="${it.ilosc||1}">
        </div>
        <div class="field" style="flex:1"><label>Jednostka</label>
          <select id="pm-m-jm" style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:12px 14px;font-size:15px">
            ${['kg','szt','m','m²','m³','kpl','l'].map(j => `<option value="${j}" ${(it.jednostka||'kg')===j?'selected':''}>${j}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field"><label>Uwagi</label>
        <input id="pm-m-uwagi" type="text" value="${it.uwagi||''}" placeholder="Opcjonalne uwagi">
      </div>
      <button class="btn btn-accent" onclick="saveMaterialZlecenia(${m.zid},${it.id||0})">💾 Zapisz</button>
    </div>
  </div>`;
}

async function saveMaterialZlecenia(zid, mid) {
  const indeks = document.getElementById('pm-m-indeks')?.value?.trim();
  const opis   = document.getElementById('pm-m-opis')?.value?.trim();
  const ilosc  = parseFloat(document.getElementById('pm-m-ilosc')?.value) || 1;
  const jm     = document.getElementById('pm-m-jm')?.value || 'kg';
  const uwagi  = document.getElementById('pm-m-uwagi')?.value?.trim() || '';
  if (!indeks) { alert('Wpisz indeks materiału'); return; }
  if (!opis)   { alert('Wpisz opis'); return; }
  try {
    if (mid) {
      await put(`/api/zlecenia/${zid}/materialy-zlecenia/${mid}`, { indeks, opis, ilosc, jednostka: jm, uwagi });
    } else {
      await post(`/api/zlecenia/${zid}/materialy-zlecenia`, { indeks, opis, ilosc, jednostka: jm, uwagi });
    }
    setState({ pmModal: null });
    // Jeśli modal podzlecenia był otwarty dla tego zid – odśwież go ORAZ drzewo zlecenia G
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
