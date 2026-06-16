// ═══════════════════════════════════════════════════════════════════════════════
// MODUŁ: WIZARD – Nowe zlecenie z drzewem G→P
// ═══════════════════════════════════════════════════════════════════════════════

let _nzIdCounter = 1;
function nzNewId() { return 'nz_' + (_nzIdCounter++); }

function nzOpen() {
  setState({
    nzModal: true, nzStep: 1,
    nzNumer: '', nzNazwa: '', nzOpis: '', nzTermin: '',
    nzIlosc: 1, nzCena: 0, nzMatKlienta: false,
    nzTree: null, nzEditNode: null,
    nzEditId: null,   // null = nowe zlecenie
    nzMatSearch: '', nzMatResults: [], nzSaving: false,
    nzFromHistory: null,   // wyczyść szablon z historii
  });
  nzLoadHistoria();   // załaduj historię do autocomplete
}

function nzClose() {
  if (state.nzSaving) return;
  setState({ nzModal: false });
}

// ── Otwiera wizard w trybie EDYCJI istniejącego zlecenia ─────────────────────
async function nzOpenEdit(zid) {
  const all = state.zlecenia || [];
  let z = all.find(x => x.id === zid);
  if (!z) {
    try {
      const lista = await get('/api/zlecenia');
      setState({zlecenia: lista});
      z = lista.find(x => x.id === zid);
    } catch(e) { alert('Błąd: ' + e.message); return; }
  }
  if (!z) { alert('Nie znaleziono zlecenia #' + zid); return; }

  // Pomocnik: konwersja operacji z API na format wizarda
  function apiOpsToNz(apiOps) {
    return (apiOps || []).map(op => ({
      _id: nzNewId(),
      _existingId: op.id,           // zachowaj id istniejącej operacji
      nazwa: op.nazwa || '',
      stanowisko: op.stanowisko || '',
      czas_norma: op.czas_norma || 0,
      czas_zbrojenia: op.czas_zbrojenia_min || 0,
      opis_czynnosci: op.opis_czynnosci || '',
    }));
  }

  // Wczytaj wszystko równolegle
  let zapotrz = [], opsG = [], matsG = [];
  try {
    [zapotrz, opsG, matsG] = await Promise.all([
      get(`/api/zlecenia/${zid}/zapotrzebowania`).catch(() => []),
      get(`/api/zlecenia/${zid}/operacje`).catch(() => []),
      get(`/api/zlecenia/${zid}/materialy-zlecenia`).catch(() => []),
    ]);
  } catch(_) {}

  // Rekurencyjne ładowanie węzła P (łącznie z zagnieżdżonymi P i M)
  async function buildPNode(zleceniePId, symbol, nazwa, ilosc) {
    let pOps = [], pMats = [], pSubZapotrz = [], pZlecenie = null;
    try {
      [pOps, pMats, pSubZapotrz, pZlecenie] = await Promise.all([
        get(`/api/zlecenia/${zleceniePId}/operacje`).catch(() => []),
        get(`/api/zlecenia/${zleceniePId}/materialy-zlecenia`).catch(() => []),
        get(`/api/zlecenia/${zleceniePId}/zapotrzebowania`).catch(() => []),
        get(`/api/zlecenia/${zleceniePId}`).catch(() => null),
      ]);
    } catch(_) {}

    // Zagnieżdżone podzlecenia P (P → P)
    const subPNodes = [];
    for (const subZap of (pSubZapotrz || [])) {
      if (subZap.zlecenie_p_id) {
        const subNode = await buildPNode(
          subZap.zlecenie_p_id,
          subZap.wyrob_p_symbol || '',
          subZap.wyrob_nazwa || subZap.wyrob_p_symbol || '',
          subZap.ilosc_wymagana || 1
        );
        subPNodes.push(subNode);
      }
    }

    const mChildren = pMats.map(m => ({
      _id: nzNewId(), typ: 'M',
      material_indeks: m.indeks || '',
      material_opis: m.opis || '',
      mat_ilosc_szt: m.ilosc || 1,
      material_jm: m.jednostka || 'kg',
      _existingMatId: m.id,
    }));

    return {
      _id: nzNewId(), typ: 'P',
      symbol: symbol,
      nazwa: nazwa,
      ilosc: ilosc, jednostka: 'szt',
      _zlecenie_p_id: zleceniePId,
      model_3d_url: (pZlecenie && pZlecenie.model_3d_url) || '',
      ops: apiOpsToNz(pOps),
      children: [...subPNodes, ...mChildren],
    };
  }

  // Wczytaj operacje i materiały każdego podzlecenia P (z rekurencją)
  // POPRAWKA: deduplikacja po zlecenie_p_id i wyrob_p_symbol – zapobiega duplikatom
  const pNodes = [];
  const seenPIds = new Set();
  const seenPSymbols = new Set();
  for (const zap of (zapotrz || [])) {
    if (zap.zlecenie_p_id) {
      // Pomiń duplikat tego samego podzlecenia P
      if (seenPIds.has(zap.zlecenie_p_id)) continue;
      seenPIds.add(zap.zlecenie_p_id);
      const pNode = await buildPNode(
        zap.zlecenie_p_id,
        zap.wyrob_p_symbol || '',
        zap.wyrob_nazwa || zap.wyrob_p_symbol || '',
        zap.ilosc_wymagana || 1
      );
      pNodes.push(pNode);
    } else {
      // P bez zlecenia (tylko zapotrzebowanie, brak zlecenia P)
      const sym = zap.wyrob_p_symbol || '';
      if (seenPSymbols.has(sym)) continue; // pomiń duplikat symbolu
      seenPSymbols.add(sym);
      pNodes.push({
        _id: nzNewId(), typ: 'P',
        symbol: sym,
        nazwa: zap.wyrob_nazwa || sym,
        ilosc: zap.ilosc_wymagana || 1, jednostka: 'szt',
        _zlecenie_p_id: null,
        ops: [],
        children: [],
      });
    }
  }

  // Materiały M przypisane do zlecenia G
  const gMChildren = matsG.map(m => ({
    _id: nzNewId(), typ: 'M',
    material_indeks: m.indeks || '',
    material_opis: m.opis || '',
    mat_ilosc_szt: m.ilosc || 1,
    material_jm: m.jednostka || 'kg',
    _existingMatId: m.id,
  }));

  // Korzeń G
  const root = {
    _id: nzNewId(), typ: 'G',
    symbol: z.numer, nazwa: z.nazwa,
    ilosc: z.ilosc_sztuk || 1, jednostka: 'szt',
    model_3d_url: z.model_3d_url || '',
    ops: apiOpsToNz(opsG),
    children: [...pNodes, ...gMChildren],
  };

  setState({
    nzModal: true, nzStep: 1,
    nzEditId: zid,
    nzNumer: z.numer, nzNazwa: z.nazwa,
    nzOpis: z.opis || '', nzTermin: z.termin ? z.termin.slice(0,10) : '',
    nzIlosc: z.ilosc_sztuk || 1, nzCena: z.cena_brutto_szt || 0,
    nzMatKlienta: !!z.material_od_klienta,
    nzTree: root, nzEditNode: null,
    nzMatSearch: '', nzMatResults: [], nzSaving: false,
  });
}

// ── Krok 1 → 2: buduj korzeń G na podstawie numeru/nazwy zlecenia ────────────
function nzGoStep2() {
  const numer = (document.getElementById('nz-numer')?.value || '').trim();
  const nazwa = (document.getElementById('nz-nazwa')?.value || '').trim();
  const opis  = (document.getElementById('nz-opis')?.value  || '');
  const termin= (document.getElementById('nz-termin')?.value|| '');
  const ilosc = parseInt(document.getElementById('nz-ilosc')?.value) || 1;
  const cena  = parseFloat(document.getElementById('nz-cena')?.value) || 0;
  const matKl = document.getElementById('nz-mat')?.value === '1';
  if (!numer || !nazwa) { alert('Numer i nazwa zlecenia są wymagane'); return; }

  // W trybie edycji: zaktualizuj symbol/nazwę korzenia ale zachowaj dzieci (P/M)
  let tree = state.nzTree;
  if (tree) {
    tree = JSON.parse(JSON.stringify(tree));
    tree.symbol = numer;
    tree.nazwa  = nazwa;
    tree.ilosc  = ilosc;
  } else {
    // Korzeń G – symbol = numer zlecenia
    tree = {
      _id: nzNewId(), typ: 'G',
      symbol: numer, nazwa: nazwa,
      ilosc: ilosc, jednostka: 'szt',
      ops: [],
      children: [],
    };
  }

  setState({
    nzStep: 2,
    nzNumer: numer, nzNazwa: nazwa, nzOpis: opis,
    nzTermin: termin, nzIlosc: ilosc, nzCena: cena, nzMatKlienta: matKl,
    nzTree: tree,
    nzEditNode: null,
  });
}

// ── Pomocniki operacje na drzewie ────────────────────────────────────────────

function nzFindNode(node, id) {
  if (!node) return null;
  if (node._id === id) return node;
  for (const c of (node.children || [])) {
    const found = nzFindNode(c, id);
    if (found) return found;
  }
  return null;
}

function nzFindParent(root, id) {
  if (!root) return null;
  for (const c of (root.children || [])) {
    if (c._id === id) return root;
    const found = nzFindParent(c, id);
    if (found) return found;
  }
  return null;
}

function nzDeleteNode(id) {
  const root = state.nzTree;
  if (!root || root._id === id) return;
  function del(node) {
    if (!node.children) return;
    node.children = node.children.filter(c => c._id !== id);
    node.children.forEach(del);
  }
  const clone = JSON.parse(JSON.stringify(root));
  del(clone);
  const editNode = state.nzEditNode === id ? null : state.nzEditNode;
  setState({ nzTree: clone, nzEditNode: editNode });
}

function nzMoveNode(id, dir) {
  const root = JSON.parse(JSON.stringify(state.nzTree));
  const parent = nzFindParent(root, id);
  if (!parent) return;
  const idx = parent.children.findIndex(c => c._id === id);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= parent.children.length) return;
  [parent.children[idx], parent.children[newIdx]] = [parent.children[newIdx], parent.children[idx]];
  setState({ nzTree: root });
}

// ── Dodaj węzeł ──────────────────────────────────────────────────────────────

function nzAddP(parentId) {
  // Dodaj pusty węzeł P (półprodukt/podzespół) jako dziecko wskazanego węzła
  const root = JSON.parse(JSON.stringify(state.nzTree));
  const parent = nzFindNode(root, parentId);
  if (!parent) return;
  const newNode = {
    _id: nzNewId(), typ: 'P',
    symbol: '', nazwa: '',
    ilosc: 1, jednostka: 'szt',
    ops: [],      // lista operacji dla tego węzła P
    children: [],
  };
  parent.children.push(newNode);
  setState({ nzTree: root, nzEditNode: newNode._id });
}

// ── Operacje (wielokrotne) na węźle G lub P ───────────────────────────────────
function nzAddOp(nodeId) {
  const root = JSON.parse(JSON.stringify(state.nzTree));
  const node = nzFindNode(root, nodeId);
  if (!node) return;
  if (!node.ops) node.ops = [];
  const newOp = { _id: nzNewId(), nazwa: '', stanowisko: '', czas_norma: 0, czas_zbrojenia: 0, opis_czynnosci: '' };
  node.ops.push(newOp);
  setState({ nzTree: root });
}

function nzDeleteOp(nodeId, opId) {
  const root = JSON.parse(JSON.stringify(state.nzTree));
  const node = nzFindNode(root, nodeId);
  if (!node || !node.ops) return;
  node.ops = node.ops.filter(o => o._id !== opId);
  setState({ nzTree: root });
}

function nzUpdateOp(nodeId, opId, field, value) {
  const root = JSON.parse(JSON.stringify(state.nzTree));
  const node = nzFindNode(root, nodeId);
  if (!node || !node.ops) return;
  const op = node.ops.find(o => o._id === opId);
  if (!op) return;
  op[field] = value;
  setState({ nzTree: root });
}

function nzAddM(parentId) {
  // Dodaj pusty węzeł M (materiał) jako dziecko wskazanego węzła
  const root = JSON.parse(JSON.stringify(state.nzTree));
  const parent = nzFindNode(root, parentId);
  if (!parent) return;
  const newNode = {
    _id: nzNewId(), typ: 'M',
    material_indeks: '', material_opis: '', material_jm: 'szt',
    ilosc: 1, jednostka: 'szt',
    // pola zapotrzebowania materiałowego
    mat_tryb: 'sztuki',      // 'dlugosc' | 'wymiary' | 'sztuki'
    mat_dlugosc: 0,          // mm – przy trybie 'dlugosc'
    mat_szer: 0,             // mm – szerokość przy trybie 'wymiary'
    mat_wys: 0,              // mm – wysokość/długość przy trybie 'wymiary'
    mat_ilosc_szt: 1,        // ilość na 1 sztukę wyrobu
  };
  parent.children.push(newNode);
  setState({ nzTree: root, nzEditNode: newNode._id,
             nzMatSearch: '', nzMatResults: [] });
}

// ── Wylicz zapotrzebowanie materiałowe węzła M ────────────────────────────────
function nzCalcZapotrzebowanie(node, ilocZlecenia) {
  const tryb = node.mat_tryb || 'sztuki';
  const qty = ilocZlecenia || 1;
  if (tryb === 'dlugosc') {
    const dlMm = parseFloat(node.mat_dlugosc) || 0;
    const razem = dlMm * (parseFloat(node.mat_ilosc_szt) || 1) * qty;
    return { wartosc: razem, jm: 'mm', opis: `${dlMm} mm/szt × ${parseFloat(node.mat_ilosc_szt)||1} szt/wyrób × ${qty} wyrobów = ${razem.toLocaleString('pl-PL')} mm` };
  }
  if (tryb === 'wymiary') {
    const l = parseFloat(node.mat_wys) || 0;
    const w = parseFloat(node.mat_szer) || 0;
    const razem = l * w * (parseFloat(node.mat_ilosc_szt) || 1) * qty;
    return { wartosc: razem, jm: 'mm²', opis: `${l}×${w} mm × ${parseFloat(node.mat_ilosc_szt)||1} szt/wyrób × ${qty} wyrobów = ${razem.toLocaleString('pl-PL')} mm²` };
  }
  // sztuki
  const szt = (parseFloat(node.mat_ilosc_szt) || 1) * qty;
  return { wartosc: szt, jm: node.material_jm || 'szt', opis: `${parseFloat(node.mat_ilosc_szt)||1} szt/wyrób × ${qty} wyrobów = ${szt.toLocaleString('pl-PL')} szt` };
}

// ── Panel edycji węzła ───────────────────────────────────────────────────────

function nzUpdateField(id, field, value) {
  const root = JSON.parse(JSON.stringify(state.nzTree));
  const node = nzFindNode(root, id);
  if (!node) return;
  node[field] = value;
  setState({ nzTree: root });
}

// ── Plik STEP przypisany do węzła G/P ────────────────────────────────────────
function nzRenderStepBox(node) {
  const url = node.model_3d_url || '';
  const fname = url ? decodeURIComponent(url.split('/').pop().split('?')[0]) : '';
  return `
    <div class="nz-step-box">
      <div style="font-size:.7rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">🧊 Plik STEP (podgląd 3D)</div>
      ${url ? `
        <div style="font-size:.74rem;color:#4ade80;margin-bottom:6px;word-break:break-all">✓ ${fname}</div>
        <div class="nz-step-row">
          <button class="nz-step-btn view" onclick="openStep3DViewer('${url.replace(/'/g,"\\'")}')">🧊 Podgląd</button>
          <button class="nz-step-btn" onclick="nzUploadStepForNode('${node._id}')">📎 Zamień plik</button>
          <button class="nz-step-btn remove" onclick="nzUpdateField('${node._id}','model_3d_url','')">🗑 Usuń</button>
        </div>
      ` : `
        <div style="font-size:.7rem;color:#475569;margin-bottom:6px">Brak pliku STEP dla tego elementu.</div>
        <div class="nz-step-row">
          <button class="nz-step-btn" onclick="nzUploadStepForNode('${node._id}')">📎 Wgraj plik STEP</button>
        </div>
      `}
      <div id="nz-step-status-${node._id}" style="font-size:.7rem;margin-top:6px"></div>
    </div>`;
}

// ── Zapisz model_3d_url węzła do zlecenia (G/P) i odpowiadającego wyrobu BOM ──
async function nzSyncStep3D(node, zlecenieIdForNode, symbol) {
  const url = node && node.model_3d_url ? node.model_3d_url : null;
  if (zlecenieIdForNode) {
    try { await patch(`/api/zlecenia/${zlecenieIdForNode}/model3d`, {model_3d_url: url}); } catch(_) {}
  }
  if (symbol) {
    try {
      const list = await get('/api/wyroby?q=' + encodeURIComponent(symbol)).catch(() => []);
      const found = (list || []).find(w => w.symbol === symbol);
      if (found) await patch(`/api/wyroby/${found.id}/model3d`, {model_3d_url: url});
    } catch(_) {}
  }
}

// ── Wgraj/zamień plik STEP dla węzła G/P (zapisany przy zapisie zlecenia) ────
function nzUploadStepForNode(nodeId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.step,.stp,.STEP,.STP,model/step,application/step,application/octet-stream,*/*';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = async function() {
    const file = this.files[0];
    document.body.removeChild(input);
    if (!file) return;
    const statusEl = document.getElementById('nz-step-status-' + nodeId);
    const MAX = 100 * 1024 * 1024;
    if (file.size > MAX) {
      if (statusEl) { statusEl.textContent = '✗ Plik za duży (maks. 100 MB)'; statusEl.style.color = '#f87171'; }
      return;
    }
    if (statusEl) { statusEl.textContent = '⏳ Wgrywanie... 0%'; statusEl.style.color = '#8892a4'; }
    try {
      const buf = await file.arrayBuffer();
      const result = await new Promise((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', SERVER_URL.replace(/\/$/, '') + '/api/step-upload');
        xhr.setRequestHeader('x-api-key', API_KEY);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
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
        nzUpdateField(nodeId, 'model_3d_url', result.url);
      } else {
        throw new Error(result.error || 'Nieznany błąd');
      }
    } catch(e) {
      if (statusEl) { statusEl.textContent = '✗ Błąd uploadu: ' + e.message; statusEl.style.color = '#f87171'; }
    }
  };
  input.click();
}

async function nzSearchMat() {
  const q = (document.getElementById('nz-mat-search')?.value || state.nzMatSearch || '').trim();
  if (q.length < 2) { setState({ nzMatResults: [] }); return; }
  setState({ nzMatSearching: true });
  try {
    const res = await get(`/api/materialy?q=${encodeURIComponent(q)}&limit=20`);
    setState({ nzMatResults: res, nzMatSearching: false });
  } catch(e) { setState({ nzMatSearching: false }); }
}

function nzSelectMat(nodeId, mat) {
  const root = JSON.parse(JSON.stringify(state.nzTree));
  const node = nzFindNode(root, nodeId);
  if (!node) return;
  node.material_indeks = mat.indeks;
  node.material_opis   = mat.opis;
  node.material_jm     = mat.jm;
  node.jednostka       = mat.jm;
  node.nazwa           = mat.opis; // pomocnicze
  setState({ nzTree: root, nzMatResults: [], nzMatSearch: '' });
}

// ── Zapis do bazy ────────────────────────────────────────────────────────────

async function nzSave() {
  if (state.nzSaving) return;
  const tree = state.nzTree;
  if (!tree) { alert('Brak drzewa do zapisu'); return; }

  // Walidacja – korzeń G musi mieć symbol i nazwę
  if (!tree.symbol || !tree.nazwa) { alert('Numer i nazwa zlecenia są wymagane'); return; }

  setState({ nzSaving: true });
  try {
    const isEdit = !!state.nzEditId;
    let zlecenieId;

    if (isEdit) {
      // TRYB EDYCJI – aktualizuj istniejące zlecenie G
      await put(`/api/zlecenia/${state.nzEditId}`, {
        numer: state.nzNumer,
        nazwa: state.nzNazwa,
        opis: state.nzOpis || '',
        termin: state.nzTermin || null,
        ilosc_sztuk: state.nzIlosc,
        cena_brutto_szt: state.nzCena,
        material_od_klienta: state.nzMatKlienta ? 1 : 0,
      });
      zlecenieId = state.nzEditId;

      // Zapisz/zaktualizuj plik STEP węzła G (zlecenie + wyrób BOM)
      await nzSyncStep3D(tree, zlecenieId, state.nzNumer);

      // Pomocnik: synchronizuje operacje węzła z API
      async function syncNodeOps(nzOps, targetZlId) {
        const apiOps = await get(`/api/zlecenia/${targetZlId}/operacje`).catch(() => []);
        
        // BEZPIECZEŃSTWO: jeśli wizard nie załadował żadnych operacji z _existingId,
        // a w API są operacje – nie kasuj (prawdopodobnie błąd ładowania drzewa)
        const hasExistingIds = (nzOps || []).some(o => o._existingId);
        // POPRAWKA: chroń też gdy nzOps ma elementy ale żaden nie ma _existingId
        // a w API są operacje – to znaczy że wizard nie załadował istniejących
        if (!hasExistingIds && apiOps.length > 0) {
          // Jeśli wizard nie ma ŻADNYCH referencji do istniejących operacji,
          // a API ma operacje – nie kasuj, tylko dodaj nowe (bez ID)
          let kolejnosc = (apiOps.length > 0 ? Math.max(...apiOps.map(o => o.kolejnosc || 0)) : 0) + 1;
          for (const op of (nzOps || [])) {
            if (!op.nazwa && !op.stanowisko) continue;
            // Sprawdź czy nie istnieje już operacja o tej samej nazwie i stanowisku
            const dup = apiOps.find(a => a.nazwa === (op.nazwa||op.stanowisko||'Operacja') && a.stanowisko === (op.stanowisko||''));
            if (dup) continue; // nie duplikuj
            try { await post('/api/operacje', {
              zlecenie_id: targetZlId,
              nazwa: op.nazwa || op.stanowisko || 'Operacja',
              kolejnosc: kolejnosc++,
              czas_norma: parseFloat(op.czas_norma) || 0,
              stanowisko: op.stanowisko || '',
              opis_czynnosci: op.opis_czynnosci || '',
              czas_zbrojenia_min: parseFloat(op.czas_zbrojenia) || 0,
            }); } catch(_) {}
          }
          return; // nie nadpisuj – brak danych w wizardzie nie znaczy "usuń wszystko"
        }
        if (!hasExistingIds && (nzOps || []).length === 0) {
          return; // całkowicie pusta lista – nic nie rób
        }

        const existingIds = new Set(apiOps.map(o => o.id));
        const wizardExistingIds = new Set((nzOps || []).filter(o => o._existingId).map(o => o._existingId));

        // Usuń operacje które były w API ale nie ma ich już w wizardzie
        for (const apiOp of apiOps) {
          if (!wizardExistingIds.has(apiOp.id)) {
            try { await del(`/api/operacje/${apiOp.id}`); } catch(_) {}
          }
        }
        // Aktualizuj istniejące / dodaj nowe
        let kolejnosc = 1;
        for (const op of (nzOps || [])) {
          if (!op.nazwa && !op.stanowisko) { kolejnosc++; continue; }
          const body = {
            zlecenie_id: targetZlId,
            nazwa: op.nazwa || op.stanowisko || 'Operacja',
            kolejnosc: kolejnosc++,
            czas_norma: parseFloat(op.czas_norma) || 0,
            stanowisko: op.stanowisko || '',
            opis_czynnosci: op.opis_czynnosci || '',
            czas_zbrojenia_min: parseFloat(op.czas_zbrojenia) || 0,
          };
          if (op._existingId && existingIds.has(op._existingId)) {
            try { await put(`/api/operacje/${op._existingId}`, body); } catch(_) {}
          } else {
            try { await post('/api/operacje', body); } catch(_) {}
          }
        }
      }

      // Pomocnik: synchronizuje materiały M węzła z API (pełny replace)
      async function syncNodeMats(nzMNodes, targetZlId) {
        // nzMNodes – już przefiltrowane węzły M (bez P)
        const existingMats = await get(`/api/zlecenia/${targetZlId}/materialy-zlecenia`).catch(() => []);

        // BEZPIECZEŃSTWO: jeśli wizard nie ma żadnych M z _existingMatId
        // a w API są materiały – nie kasuj (ochrona przed błędem ładowania)
        const hasExistingMatIds = (nzMNodes || []).some(m => m._existingMatId);
        // POPRAWKA: chroń też gdy nzMNodes ma elementy ale żaden nie ma _existingMatId
        if (!hasExistingMatIds && (existingMats || []).length > 0) {
          // Dodaj tylko nowe materiały (bez kasowania istniejących) – unikaj duplikatów
          for (const node of (nzMNodes || [])) {
            if (node.typ === 'M' && node.material_indeks) {
              const dup = (existingMats || []).find(m => m.indeks === node.material_indeks);
              if (dup) continue; // nie duplikuj
              try {
                await post(`/api/zlecenia/${targetZlId}/materialy-zlecenia`, {
                  indeks: node.material_indeks,
                  opis: node.material_opis || '',
                  ilosc: parseFloat(node.mat_ilosc_szt) || 1,
                  jednostka: node.material_jm || 'kg',
                });
              } catch(e) { console.warn('syncNodeMats (safe add):', e.message); }
            }
          }
          return; // nie kasuj istniejących
        }
        if (!hasExistingMatIds && (nzMNodes || []).length === 0) {
          return; // całkowicie pusta lista – nic nie rób
        }

        // Usuń stare materiały
        for (const m of (existingMats || [])) {
          try { await del(`/api/zlecenia/${targetZlId}/materialy-zlecenia/${m.id}`); } catch(_) {}
        }
        // Zapisz nowe
        for (const node of (nzMNodes || [])) {
          if (node.typ === 'M' && node.material_indeks) {
            try {
              await post(`/api/zlecenia/${targetZlId}/materialy-zlecenia`, {
                indeks: node.material_indeks,
                opis: node.material_opis || '',
                ilosc: parseFloat(node.mat_ilosc_szt) || 1,
                jednostka: node.material_jm || 'kg',
              });
            } catch(e) { console.warn('syncNodeMats:', e.message); }
          }
        }
      }

      // Synchronizuj operacje G
      await syncNodeOps(tree.ops || [], zlecenieId);
      // Synchronizuj materiały M bezpośrednio przypisane do G (tylko węzły M, nie P)
      const gMOnly = (tree.children || []).filter(c => c.typ === 'M');
      await syncNodeMats(gMOnly, zlecenieId);

      // ── Rekurencyjne synchronizowanie podzleceń P ────────────────────────────
      // Obsługuje istniejące P (_zlecenie_p_id) i nowe P (bez ID).
      // Nie duplikuje: istniejące P są aktualizowane po ID, nowe są tworzone
      // tylko jeśli zapotrzebowanie o tym symbolu jeszcze nie istnieje.
      let _pAutoIdx = 1;

      async function syncPNodes(children, parentGId) {
        for (const pNode of (children || [])) {
          if (pNode.typ !== 'P') continue;

          const pSymbol = (pNode.symbol || '').trim() || (state.nzNumer + '-P' + _pAutoIdx);
          const pNazwa  = (pNode.nazwa  || '').trim() || pSymbol;
          _pAutoIdx++;

          let pid = pNode._zlecenie_p_id || null;

          if (pid) {
            // ── Istniejące zlecenie P – tylko aktualizuj, nigdy nie twórz nowego ──
            try {
              await put(`/api/zlecenia/${pid}`, {
                numer: pSymbol,
                nazwa: pNazwa,
                ilosc_sztuk: Math.max(1, Math.round(parseFloat(pNode.ilosc) || 1)),
                termin: state.nzTermin || null,
              });
            } catch(_) {}
          } else {
            // ── Nowe P – sprawdź czy zlecenie o tym numerze już istnieje ──────────
            // (zabezpieczenie przed duplikacją przy wielokrotnym zapisie)
            try {
              const existing = await get('/api/zlecenia').catch(() => []);
              const found = (existing || []).find(z => z.numer === pSymbol);
              if (found) {
                pid = found.id;
              } else {
                const zpRes = await post('/api/zlecenia', {
                  numer: pSymbol, nazwa: pNazwa,
                  opis: '', termin: state.nzTermin || null,
                  ilosc_sztuk: Math.max(1, Math.round(parseFloat(pNode.ilosc) || 1)),
                  cena_brutto_szt: 0, material_od_klienta: 0,
                });
                pid = zpRes.id;
              }
            } catch(_) {}

            // Dodaj wyrób P do BOM (ignoruj błąd jeśli już istnieje)
            if (pid) {
              try {
                await post('/api/wyroby', { symbol: pSymbol, typ: 'P', nazwa: pNazwa, jednostka: pNode.jednostka || 'szt' });
              } catch(_) {}
            }

            // Utwórz zapotrzebowanie G→P tylko jeśli jeszcze nie istnieje
            if (pid && parentGId) {
              try {
                const zapExisting = await get(`/api/zlecenia/${parentGId}/zapotrzebowania`).catch(() => []);
                const zapFound = (zapExisting || []).find(z => z.zlecenie_p_id === pid || z.wyrob_p_symbol === pSymbol);
                if (!zapFound) {
                  await post(`/api/zlecenia/${parentGId}/zapotrzebowania`, {
                    zlecenie_g_id: parentGId,
                    wyrob_p_symbol: pSymbol,
                    ilosc_wymagana: parseFloat(pNode.ilosc) || 1,
                    zlecenie_p_id: pid,
                  });
                }
              } catch(_) {}
            }
          }

          if (!pid) continue;

          // Zapisz/zaktualizuj plik STEP węzła P (zlecenie P + wyrób BOM)
          await nzSyncStep3D(pNode, pid, pSymbol);

          // Synchronizuj operacje P
          await syncNodeOps(pNode.ops || [], pid);
          // Synchronizuj materiały M dzieci P (tylko węzły M)
          const pMOnly = (pNode.children || []).filter(c => c.typ === 'M');
          await syncNodeMats(pMOnly, pid);
          // Rekurencja dla zagnieżdżonych P pod P
          await syncPNodes(pNode.children || [], pid);
        }
      }

      await syncPNodes(tree.children || [], zlecenieId);

      // POPRAWKA: wyczyść zduplikowane zapotrzebowania z bazy
      // (mogły powstać przy wcześniejszych wielokrotnych zapisach)
      try {
        const allZap = await get(`/api/zlecenia/${zlecenieId}/zapotrzebowania`).catch(() => []);
        const seenPIdsClean = new Set();
        const seenSymbolsClean = new Set();
        for (const zap of (allZap || [])) {
          const key = zap.zlecenie_p_id || zap.wyrob_p_symbol;
          const alreadySeen = zap.zlecenie_p_id
            ? seenPIdsClean.has(zap.zlecenie_p_id)
            : seenSymbolsClean.has(zap.wyrob_p_symbol || '');
          if (alreadySeen) {
            // Usuń duplikat
            try { await del(`/api/zapotrzebowania/${zap.id}`); } catch(_) {}
          } else {
            if (zap.zlecenie_p_id) seenPIdsClean.add(zap.zlecenie_p_id);
            else seenSymbolsClean.add(zap.wyrob_p_symbol || '');
          }
        }
      } catch(_) {}

      setState({ nzModal: false, nzSaving: false, nzEditId: null });
      await loadZlecenia();
      // Odswiezz drzewo i zachowaj rozwiniety widok
      try {
        const [upd, matsM] = await Promise.all([
          get(`/api/zlecenia/${zlecenieId}/drzewo`),
          get(`/api/zlecenia/${zlecenieId}/materialy-zlecenia`).catch(() => []),
        ]);
        if (!upd.materialy || upd.materialy.length === 0) upd.materialy = matsM || [];
        const updPIds2 = new Set(state.podzlecenieIds || []);
        (upd.podzlecenia_drzewo || []).forEach(pd => {
          if (pd.zlecenie_p_id) updPIds2.add(pd.zlecenie_p_id);
          (pd.podzlecenia || []).forEach(sub => {
            const sid = sub.zap?.zlecenie_p_id || sub.zap?.zp_id;
            if (sid) updPIds2.add(sid);
          });
        });
        setState({
          zlecenieDrzewa: { ...(state.zlecenieDrzewa || {}), [zlecenieId]: upd },
          zlecenieExpanded: { ...(state.zlecenieExpanded || {}), [zlecenieId]: true },
          podzlecenieIds: updPIds2,
        });
      } catch(_) {}
      return;
    }

    // TRYB TWORZENIA – utwórz zlecenie główne (G)
    const zl = await post('/api/zlecenia', {
      numer: state.nzNumer,
      nazwa: state.nzNazwa,
      opis: state.nzOpis || '',
      termin: state.nzTermin || null,
      ilosc_sztuk: state.nzIlosc,
      cena_brutto_szt: state.nzCena,
      material_od_klienta: state.nzMatKlienta ? 1 : 0,
    });
    zlecenieId = zl.id;

    // Zapisz plik STEP węzła G (jeśli wgrany przed zapisem)
    await nzSyncStep3D(tree, zlecenieId, state.nzNumer);

    // 2. Utwórz lub pobierz wyrób G w drzewie BOM
    let wyrob_g_id = null;
    try {
      const wg = await post('/api/wyroby', {
        symbol: state.nzNumer,
        typ: 'G',
        nazwa: state.nzNazwa,
        jednostka: 'szt',
      });
      wyrob_g_id = wg.id;
    } catch(e) {
      // Może już istnieć – pobierz po symbolu
      const list = await get('/api/wyroby?typ=G&q=' + encodeURIComponent(state.nzNumer));
      const found = list.find(w => w.symbol === state.nzNumer);
      if (found) wyrob_g_id = found.id;
      else throw new Error('Nie udało się utworzyć wyrobu G: ' + e.message);
    }

    // 3. Rekurencyjnie przetwórz drzewo – tworząc operacje, wyroby P, BOM
    let opKolejnosc = 1;   // kolejność operacji w zleceniu
    let pKolejnosc = 1;    // numer auto-symbolu węzłów P (niezależny od op)

    // Zapisz listę operacji (ops[]) danego węzła do bazy jako operacje zlecenia
    // targetZlId – opcjonalne: ID zlecenia docelowego (domyślnie zlecenie G)
    async function saveNodeOps(nodeOps, targetZlId) {
      const destId = targetZlId || zlecenieId;
      for (const op of (nodeOps || [])) {
        if (!op.nazwa && !op.stanowisko) continue; // pomiń puste
        try {
          await post('/api/operacje', {
            zlecenie_id: destId,
            nazwa: op.nazwa || op.stanowisko || 'Operacja',
            kolejnosc: opKolejnosc++,
            czas_norma: parseFloat(op.czas_norma) || 0,
            stanowisko: op.stanowisko || '',
            opis_czynnosci: op.opis_czynnosci || '',
            czas_zbrojenia_min: parseFloat(op.czas_zbrojenia) || 0,
          });
        } catch(e) { console.warn('Operacja zapis:', e); }
      }
    }

    async function processChildren(parentWyrob_id, children, parentZlId) {
      if (!parentWyrob_id) { console.error('processChildren: brak parentWyrob_id'); return; }
      for (const node of (children || [])) {
        if (node.typ === 'P') {
          // a) Utwórz wyrób P w drzewie BOM – zawsze (auto-symbol jeśli brak)
          const pSymbol = (node.symbol || '').trim() || (state.nzNumer + '-P' + pKolejnosc);
          const pNazwa  = (node.nazwa  || '').trim() || pSymbol;
          pKolejnosc++;
          let wyrob_p_id = null;
          try {
            const wp = await post('/api/wyroby', {
              symbol: pSymbol, typ: 'P', nazwa: pNazwa,
              jednostka: node.jednostka || 'szt',
            });
            wyrob_p_id = wp.id;
          } catch(e) {
            // Symbol już istnieje – pobierz id
            try {
              const list = await get('/api/wyroby?typ=P&q=' + encodeURIComponent(pSymbol));
              const found = list.find(w => w.symbol === pSymbol);
              if (found) wyrob_p_id = found.id;
            } catch(_) {}
          }
          if (wyrob_p_id) {
            // b) Dodaj do BOM rodzica
            try {
              await post(`/api/wyroby/${parentWyrob_id}/bom`, {
                skladnik_id: wyrob_p_id,
                typ_skladnika: 'P',
                ilosc: parseFloat(node.ilosc) || 1,
                jednostka: node.jednostka || 'szt',
                pozycja: pKolejnosc - 1,
              });
            } catch(e) { console.warn('BOM P dodanie:', e.message); }

            // c) Utwórz zlecenie P (osobne zlecenie dla każdego węzła P)
            let zlecenie_p_id = null;
            try {
              const zpRes = await post('/api/zlecenia', {
                numer: pSymbol, nazwa: pNazwa,
                opis: '', termin: state.nzTermin || null,
                ilosc_sztuk: Math.max(1, Math.round(parseFloat(node.ilosc) || 1)),
                cena_brutto_szt: 0, material_od_klienta: 0,
              });
              zlecenie_p_id = zpRes.id;
            } catch(e) {
              // Może już istnieć o tym numerze
              try {
                const allZl = await get('/api/zlecenia');
                const found = allZl.find(z => z.numer === pSymbol);
                if (found) zlecenie_p_id = found.id;
              } catch(_) {}
            }

            // Operacje P-węzła trafiają do zlecenia P
            await saveNodeOps(node.ops, zlecenie_p_id || zlecenieId);

            // Zapisz plik STEP węzła P (jeśli wgrany przed zapisem)
            if (zlecenie_p_id) {
              await nzSyncStep3D(node, zlecenie_p_id, pSymbol);
            }

            // Zapisz materiały M dzieci P do materialy-zlecenia zlecenia P
            if (zlecenie_p_id) {
              for (const child of (node.children || [])) {
                if (child.typ === 'M' && child.material_indeks) {
                  try {
                    await post(`/api/zlecenia/${zlecenie_p_id}/materialy-zlecenia`, {
                      indeks: child.material_indeks,
                      opis: child.material_opis || '',
                      ilosc: parseFloat(child.mat_ilosc_szt) || 1,
                      jednostka: child.material_jm || 'kg',
                    });
                  } catch(e) { console.warn('Mat P zapis:', e.message); }
                }
              }
            }

            // Utwórz zapotrzebowanie G→P i od razu zlinkuj do zlecenia P
            if (zlecenie_p_id) {
              try {
                await post(`/api/zlecenia/${zlecenieId}/zapotrzebowania`, {
                  zlecenie_g_id: zlecenieId,
                  wyrob_p_symbol: pSymbol,
                  ilosc_wymagana: parseFloat(node.ilosc) || 1,
                  zlecenie_p_id: zlecenie_p_id,
                });
              } catch(_) {}
            }

            // d) Rekurencja dla zagnieżdżonych P (pomiń M – już zapisane wyżej)
            const pChildrenOnly = (node.children || []).filter(c => c.typ === 'P');
            if (pChildrenOnly.length) {
              await processChildren(wyrob_p_id, pChildrenOnly, zlecenie_p_id);
            }
          } else {
            console.warn('Nie udało się utworzyć/znaleźć wyrobu P:', pSymbol);
          }
        } else if (node.typ === 'M' && node.material_indeks) {
          const zap = nzCalcZapotrzebowanie(node, state.nzIlosc || 1);
          try {
            await post(`/api/wyroby/${parentWyrob_id}/bom`, {
              typ_skladnika: 'M',
              material_indeks: node.material_indeks,
              ilosc: zap.wartosc,
              jednostka: zap.jm,
              uwagi: node.material_opis || '',
              pozycja: pKolejnosc,
            });
          } catch(e) { console.warn('BOM M:', e.message); }
          // Zapisz też do materialy-zlecenia rodzica (zlecenie G lub P)
          if (parentZlId) {
            try {
              await post(`/api/zlecenia/${parentZlId}/materialy-zlecenia`, {
                indeks: node.material_indeks,
                opis: node.material_opis || '',
                ilosc: parseFloat(node.mat_ilosc_szt) || 1,
                jednostka: node.material_jm || 'kg',
              });
            } catch(e) { console.warn('Mat zapis do zlecenia:', e.message); }
          }
        }
      }
    }

    if (!wyrob_g_id) throw new Error('Nie można zapisać drzewa: brak wyrobu G');

    // Zapisz operacje węzła G (głównego), potem przetwórz dzieci
    await saveNodeOps(tree.ops);
    await processChildren(wyrob_g_id, tree.children, zlecenieId);

    // 4. Odśwież listę zleceń i drzewo
    await loadZlecenia();
    if (state.activeTab === 'drzewo') loadDrzewoGP();

    setState({ nzModal: false, nzSaving: false });
    const hasChildren = tree.children && tree.children.length > 0;
    const hasGOp = !!(tree.stanowisko || tree.nazwa_operacji);
    alert(`✅ Zlecenie ${state.nzNumer} zostało utworzone!`);
    // Otwórz edytor nowo utworzonego zlecenia
    await openEditZlecenieById(zlecenieId);
  } catch(e) {
    setState({ nzSaving: false });
    alert('Błąd zapisu: ' + e.message);
  }
}

// ── Render Wizarda ────────────────────────────────────────────────────────────

function renderNzWizard() {
  const s = state;
  const tree = s.nzTree;
  const editId = s.nzEditNode;
  const editNode = editId ? nzFindNode(tree, editId) : null;

  // ── Panel edycji węzła ────────────────────────────────────────────────────
  let editPanel = '';
  if (editNode) {
    if (editNode.typ === 'G') {
      const gOps = editNode.ops || [];
      const stanOptionsForOp = (stanowisko) => (state.stawki||[]).map(st =>
        `<option value="${st.stanowisko}" ${stanowisko===st.stanowisko?'selected':''}>${st.stanowisko}</option>`
      ).join('');
      const opsHtml = gOps.map((op,i) => `
          <div style="background:#0a1628;border:1px solid #1e3a5f44;border-radius:6px;padding:8px 10px;margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
              <span style="color:#60a5fa;font-size:.7rem;font-weight:700">Op. ${i+1}</span>
              <button onclick="nzDeleteOp('${editNode._id}','${op._id}')"
                      style="margin-left:auto;background:transparent;border:none;color:#475569;cursor:pointer;font-size:.78rem" title="Usuń operację">✕</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:5px">
              <input type="text" placeholder="Nazwa operacji" value="${op.nazwa||''}"
                     onchange="nzUpdateOp('${editNode._id}','${op._id}','nazwa',this.value)"
                     style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:4px;padding:5px 7px;width:100%;box-sizing:border-box;font-size:.78rem">
              <select onchange="nzUpdateOp('${editNode._id}','${op._id}','stanowisko',this.value)"
                      style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:4px;padding:5px 7px;width:100%;box-sizing:border-box;font-size:.78rem">
                <option value="">— stanowisko —</option>
                ${stanOptionsForOp(op.stanowisko)}
              </select>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
                <input type="number" step="0.5" min="0" placeholder="Czas min/szt" value="${op.czas_norma||0}"
                       onchange="nzUpdateOp('${editNode._id}','${op._id}','czas_norma',+this.value)"
                       style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:4px;padding:5px 7px;width:100%;box-sizing:border-box;font-size:.78rem">
                <input type="number" step="1" min="0" placeholder="Zbrojenie min" value="${op.czas_zbrojenia||0}"
                       onchange="nzUpdateOp('${editNode._id}','${op._id}','czas_zbrojenia',+this.value)"
                       style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:4px;padding:5px 7px;width:100%;box-sizing:border-box;font-size:.78rem">
              </div>
              <textarea placeholder="Opis czynności (opcjonalnie)"
                     oninput="nzUpdateOp('${editNode._id}','${op._id}','opis_czynnosci',this.value)"
                     style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:4px;padding:5px 7px;width:100%;box-sizing:border-box;font-size:.78rem;resize:vertical;min-height:52px;font-family:inherit">${(op.opis_czynnosci||'').replace(/</g,'&lt;')}</textarea>
            </div>
          </div>`).join('');
      editPanel = `
          <div style="font-size:.78rem;font-weight:700;color:#60a5fa;margin-bottom:6px">🌳 Wyrób główny G</div>
          <div style="font-size:.74rem;color:#64748b">Symbol: <b style="color:#e2e8f0">${editNode.symbol}</b> &nbsp;·&nbsp; ${editNode.nazwa}</div>
          <div style="margin-top:12px;border-top:1px solid #1e293b;padding-top:10px">
            <div style="display:flex;align-items:center;margin-bottom:8px">
              <span style="font-size:.72rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.5px">⚙ Operacje (${gOps.length})</span>
              <button onclick="nzAddOp('${editNode._id}')"
                      style="margin-left:auto;background:#1e3a5f;color:#60a5fa;border:1px solid #3b82f644;border-radius:5px;padding:3px 10px;font-size:.72rem;cursor:pointer;font-weight:700">+ Dodaj operację</button>
            </div>
            ${gOps.length === 0
              ? '<div style="color:#334155;font-size:.75rem;padding:6px 0">Brak operacji. Kliknij "+ Dodaj operację" aby dodać cięcie, toczenie, frezowanie itp.</div>'
              : opsHtml}
          </div>
          <div style="margin-top:10px;border-top:1px solid #1e293b;padding-top:10px;display:flex;gap:6px">
            <button onclick="nzAddP('${editNode._id}')"
                    style="flex:1;background:#2d1f5e;color:#a78bfa;border:1px solid #8b5cf644;border-radius:6px;padding:7px;cursor:pointer;font-size:.78rem;font-weight:600">
              + Półprodukt (P)
            </button>
            <button onclick="nzAddM('${editNode._id}')"
                    style="flex:1;background:#1a1f2e;color:#6b7280;border:1px solid #6b728044;border-radius:6px;padding:7px;cursor:pointer;font-size:.78rem">
              + Materiał (M)
            </button>
          </div>
          ${nzRenderStepBox(editNode)}`;

    } else if (editNode.typ === 'P') {
      const pOps = editNode.ops || [];
      const stanOptsP = (stanowisko) => (state.stawki||[]).map(st =>
        `<option value="${st.stanowisko}" ${stanowisko===st.stanowisko?'selected':''}>${st.stanowisko}</option>`
      ).join('');
      const pOpsHtml = pOps.map((op,i) => `
          <div style="background:#1a0f2e;border:1px solid #8b5cf622;border-radius:6px;padding:8px 10px;margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
              <span style="color:#a78bfa;font-size:.7rem;font-weight:700">Op. ${i+1}</span>
              <button onclick="nzDeleteOp('${editNode._id}','${op._id}')"
                      style="margin-left:auto;background:transparent;border:none;color:#475569;cursor:pointer;font-size:.78rem" title="Usuń">✕</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:5px">
              <input type="text" placeholder="Nazwa operacji" value="${op.nazwa||''}"
                     onchange="nzUpdateOp('${editNode._id}','${op._id}','nazwa',this.value)"
                     style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:4px;padding:5px 7px;width:100%;box-sizing:border-box;font-size:.78rem">
              <select onchange="nzUpdateOp('${editNode._id}','${op._id}','stanowisko',this.value)"
                      style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:4px;padding:5px 7px;width:100%;box-sizing:border-box;font-size:.78rem">
                <option value="">— stanowisko —</option>
                ${stanOptsP(op.stanowisko)}
              </select>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
                <input type="number" step="0.5" min="0" placeholder="Czas min/szt" value="${op.czas_norma||0}"
                       onchange="nzUpdateOp('${editNode._id}','${op._id}','czas_norma',+this.value)"
                       style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:4px;padding:5px 7px;width:100%;box-sizing:border-box;font-size:.78rem">
                <input type="number" step="1" min="0" placeholder="Zbrojenie min" value="${op.czas_zbrojenia||0}"
                       onchange="nzUpdateOp('${editNode._id}','${op._id}','czas_zbrojenia',+this.value)"
                       style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:4px;padding:5px 7px;width:100%;box-sizing:border-box;font-size:.78rem">
              </div>
              <textarea placeholder="Opis czynności (opcjonalnie)"
                     oninput="nzUpdateOp('${editNode._id}','${op._id}','opis_czynnosci',this.value)"
                     style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:4px;padding:5px 7px;width:100%;box-sizing:border-box;font-size:.78rem;resize:vertical;min-height:52px;font-family:inherit">${(op.opis_czynnosci||'').replace(/</g,'&lt;')}</textarea>
            </div>
          </div>`).join('');
      editPanel = `
          <div style="font-size:.78rem;font-weight:700;color:#a78bfa;margin-bottom:6px">⚙ Półprodukt / Podzespół P</div>
          <div style="display:flex;flex-direction:column;gap:7px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              <div>
                <label style="font-size:.72rem;color:#64748b;display:block;margin-bottom:3px">Symbol (BOM)</label>
                <input type="text" placeholder="np. P-001" value="${editNode.symbol||''}"
                       onchange="nzUpdateField('${editNode._id}','symbol',this.value)"
                       style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:5px;padding:6px 8px;width:100%;box-sizing:border-box;font-size:.8rem">
              </div>
              <div>
                <label style="font-size:.72rem;color:#64748b;display:block;margin-bottom:3px">Nazwa</label>
                <input type="text" placeholder="np. Wał Ø50" value="${editNode.nazwa||''}"
                       onchange="nzUpdateField('${editNode._id}','nazwa',this.value)"
                       style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:5px;padding:6px 8px;width:100%;box-sizing:border-box;font-size:.8rem">
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              <div>
                <label style="font-size:.72rem;color:#64748b;display:block;margin-bottom:3px">Ilość (BOM)</label>
                <input type="number" step="0.01" min="0.01" value="${editNode.ilosc||1}"
                       onchange="nzUpdateField('${editNode._id}','ilosc',+this.value)"
                       style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:5px;padding:6px 8px;width:100%;box-sizing:border-box;font-size:.8rem">
              </div>
              <div>
                <label style="font-size:.72rem;color:#64748b;display:block;margin-bottom:3px">Jednostka</label>
                <input type="text" value="${editNode.jednostka||'szt'}"
                       onchange="nzUpdateField('${editNode._id}','jednostka',this.value)"
                       style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:5px;padding:6px 8px;width:100%;box-sizing:border-box;font-size:.8rem">
              </div>
            </div>
            <div style="border-top:1px solid #1e293b;padding-top:8px">
              <div style="display:flex;align-items:center;margin-bottom:6px">
                <span style="font-size:.72rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.5px">⚙ Operacje (${pOps.length})</span>
                <button onclick="nzAddOp('${editNode._id}')"
                        style="margin-left:auto;background:#2d1f5e;color:#a78bfa;border:1px solid #8b5cf644;border-radius:5px;padding:3px 10px;font-size:.72rem;cursor:pointer;font-weight:700">+ Dodaj</button>
              </div>
              ${pOps.length === 0
                ? '<div style="color:#334155;font-size:.75rem;padding:4px 0">Brak operacji. Dodaj toczenie, frezowanie, spawanie itp.</div>'
                : pOpsHtml}
            </div>
            <div style="display:flex;gap:6px">
              <button onclick="nzAddP('${editNode._id}')"
                      style="flex:1;background:#2d1f5e;color:#a78bfa;border:1px solid #8b5cf633;border-radius:5px;padding:6px;cursor:pointer;font-size:.75rem">+ Pod-P</button>
              <button onclick="nzAddM('${editNode._id}')"
                      style="flex:1;background:#1a1f2e;color:#6b7280;border:1px solid #6b728033;border-radius:5px;padding:6px;cursor:pointer;font-size:.75rem">+ Materiał</button>
              <button onclick="nzDeleteNode('${editNode._id}')"
                      style="background:#3a1a1a;color:#f87171;border:1px solid #f8717133;border-radius:5px;padding:6px 10px;cursor:pointer;font-size:.75rem">✕ Usuń</button>
            </div>
            ${nzRenderStepBox(editNode)}
          </div>`;

    } else if (editNode.typ === 'M') {
      const matResults = state.nzMatResults || [];
      const matSearching = state.nzMatSearching;
      const tryb = editNode.mat_tryb || 'sztuki';
      const ilocZlecenia = s.nzIlosc || 1;
      const zap = nzCalcZapotrzebowanie(editNode, ilocZlecenia);
      const trybBtns = ['dlugosc','wymiary','sztuki'].map(t => {
        const labels = {dlugosc:'📏 Długość', wymiary:'📐 Wymiary L×W', sztuki:'🔩 Sztuki'};
        const active = tryb === t;
        return `<button onclick="nzUpdateField('${editNode._id}','mat_tryb','${t}')"
          style="flex:1;padding:6px 4px;border-radius:5px;cursor:pointer;font-size:.72rem;font-weight:${active?700:400};
                 background:${active?'#3b82f6':'#0f172a'};color:${active?'#fff':'#64748b'};
                 border:1px solid ${active?'#3b82f6':'#1e293b'}">${labels[t]}</button>`;
      }).join('');
      let trybFields = '';
      if (tryb === 'dlugosc') {
        trybFields = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <div><label style="font-size:.72rem;color:#64748b;display:block;margin-bottom:3px">Długość na 1 szt (mm)</label>
            <input type="number" step="0.1" min="0" value="${editNode.mat_dlugosc||0}"
                   onchange="nzUpdateField('${editNode._id}','mat_dlugosc',+this.value)"
                   style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:5px;padding:6px 8px;width:100%;box-sizing:border-box;font-size:.8rem"></div>
          <div><label style="font-size:.72rem;color:#64748b;display:block;margin-bottom:3px">Ilość pręt./el. na wyrób</label>
            <input type="number" step="0.01" min="0.01" value="${editNode.mat_ilosc_szt||1}"
                   onchange="nzUpdateField('${editNode._id}','mat_ilosc_szt',+this.value)"
                   style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:5px;padding:6px 8px;width:100%;box-sizing:border-box;font-size:.8rem"></div>
        </div>`;
      } else if (tryb === 'wymiary') {
        trybFields = `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
          <div><label style="font-size:.72rem;color:#64748b;display:block;margin-bottom:3px">Długość (mm)</label>
            <input type="number" step="0.1" min="0" value="${editNode.mat_wys||0}"
                   onchange="nzUpdateField('${editNode._id}','mat_wys',+this.value)"
                   style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:5px;padding:6px 8px;width:100%;box-sizing:border-box;font-size:.8rem"></div>
          <div><label style="font-size:.72rem;color:#64748b;display:block;margin-bottom:3px">Szerokość (mm)</label>
            <input type="number" step="0.1" min="0" value="${editNode.mat_szer||0}"
                   onchange="nzUpdateField('${editNode._id}','mat_szer',+this.value)"
                   style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:5px;padding:6px 8px;width:100%;box-sizing:border-box;font-size:.8rem"></div>
          <div><label style="font-size:.72rem;color:#64748b;display:block;margin-bottom:3px">Szt na wyrób</label>
            <input type="number" step="0.01" min="0.01" value="${editNode.mat_ilosc_szt||1}"
                   onchange="nzUpdateField('${editNode._id}','mat_ilosc_szt',+this.value)"
                   style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:5px;padding:6px 8px;width:100%;box-sizing:border-box;font-size:.8rem"></div>
        </div>`;
      } else {
        trybFields = `<div><label style="font-size:.72rem;color:#64748b;display:block;margin-bottom:3px">Ilość sztuk na 1 wyrób</label>
          <input type="number" step="0.01" min="0.01" value="${editNode.mat_ilosc_szt||1}"
                 onchange="nzUpdateField('${editNode._id}','mat_ilosc_szt',+this.value)"
                 style="background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:5px;padding:6px 8px;width:100%;box-sizing:border-box;font-size:.8rem"></div>`;
      }
      editPanel = `
          <div style="font-size:.78rem;font-weight:700;color:#6b7280;margin-bottom:10px">📦 Materiał M</div>
          ${editNode.material_indeks ? `
            <div style="background:#0f172a;border:1px solid #1e3a2f;border-radius:6px;padding:8px 10px;margin-bottom:10px">
              <div style="font-size:.7rem;color:#4ade80;font-weight:700">✓ Wybrany materiał</div>
              <div style="font-family:monospace;font-size:.78rem;color:#e2e8f0;margin-top:2px">${editNode.material_indeks}</div>
              <div style="font-size:.76rem;color:#94a3b8">${editNode.material_opis||''}</div>
            </div>` : ''}
          <div style="display:flex;flex-direction:column;gap:8px">
            <div>
              <label style="font-size:.72rem;color:#64748b;display:block;margin-bottom:3px">🔍 Szukaj materiału</label>
              <div style="display:flex;gap:6px">
                <input id="nz-mat-search" type="text" placeholder="Wpisz indeks lub opis..."
                       value="${state.nzMatSearch||''}"
                       oninput="setState({nzMatSearch:this.value},true);clearTimeout(window._nzMatTimer);window._nzMatTimer=setTimeout(function(){if((document.getElementById('nz-mat-search')||{value:''}).value.trim().length>=2)nzSearchMat();},500)"
                       onkeydown="if(event.key==='Enter'){event.preventDefault();clearTimeout(window._nzMatTimer);nzSearchMat();}"
                       style="flex:1;background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:5px;padding:6px 8px;font-size:.8rem;outline:none">
                <button onclick="nzSearchMat()"
                        style="background:#3b82f6;color:#fff;border:none;border-radius:5px;padding:6px 10px;cursor:pointer;font-size:.8rem">🔍</button>
              </div>
            </div>
            ${matSearching ? '<div style="color:#64748b;font-size:.78rem;padding:4px">Szukam...</div>' : ''}
            ${matResults.length ? `
              <div style="max-height:140px;overflow-y:auto;display:flex;flex-direction:column;gap:2px">
                ${matResults.map(m => `
                  <div onclick="nzSelectMat('${editNode._id}',${JSON.stringify(m).replace(/"/g,'&quot;')})"
                       style="padding:5px 8px;border-radius:4px;border:1px solid #1e293b;background:#0f172a;cursor:pointer;font-size:.75rem"
                       onmouseover="this.style.borderColor='#3b82f6'"
                       onmouseout="this.style.borderColor='#1e293b'">
                    <span style="font-family:monospace;color:#60a5fa">${m.indeks||'—'}</span>
                    <span style="color:#cbd5e1;margin-left:6px">${m.opis||''}</span>
                    <span style="color:#475569;margin-left:6px">${m.jm||''}</span>
                    <span style="color:#4ade80;margin-left:auto;float:right">${(m.do_dyspozycji||0).toLocaleString('pl-PL',{maximumFractionDigits:2})} ${m.jm||'szt'}</span>
                  </div>`).join('')}
              </div>` : ''}
            <div>
              <label style="font-size:.72rem;color:#64748b;display:block;margin-bottom:5px">📊 Typ zapotrzebowania</label>
              <div style="display:flex;gap:4px">${trybBtns}</div>
            </div>
            ${trybFields}
            <div style="background:#0a1628;border:1px solid #1e3a5f;border-radius:6px;padding:8px 10px">
              <div style="font-size:.7rem;color:#60a5fa;font-weight:700;margin-bottom:3px">📋 Zapotrzebowanie dla zlecenia (${ilocZlecenia} szt)</div>
              <div style="font-size:.82rem;color:#e2e8f0;font-weight:700">${zap.wartosc.toLocaleString('pl-PL',{maximumFractionDigits:3})} ${zap.jm}</div>
              <div style="font-size:.68rem;color:#475569;margin-top:2px">${zap.opis}</div>
            </div>
            <button onclick="nzDeleteNode('${editNode._id}')"
                    style="background:#3a1a1a;color:#f87171;border:1px solid #f8717133;border-radius:5px;padding:6px;cursor:pointer;font-size:.78rem;margin-top:2px">
              ✕ Usuń ten materiał
            </button>
          </div>`;
    }
  } else {
    editPanel = `
      <div style="color:#334155;text-align:center;padding:20px 10px;font-size:.8rem">
        <div style="font-size:1.6rem;margin-bottom:8px">👆</div>
        Kliknij węzeł w drzewie<br>aby go edytować
      </div>`;
  }

  // ── Render drzewa ─────────────────────────────────────────────────────────
  function renderNzNode(node, depth) {
    const indent = depth * 18;
    const isG = node.typ === 'G';
    const isP = node.typ === 'P';
    const isM = node.typ === 'M';
    const isEditing = node._id === editId;
    const borderCol = isG ? '#3b82f6' : isP ? '#8b5cf6' : '#6b7280';
    const bg = isEditing ? 'rgba(59,130,246,0.12)' : (isG ? 'rgba(59,130,246,0.06)' : isP ? 'rgba(139,92,246,0.06)' : 'rgba(107,114,128,0.05)');
    const pOpsCount = isP ? (node.ops||[]).length : 0;
    const gOpsCount = isG ? (node.ops||[]).length : 0;
    const label = isG ? `<span style="color:#60a5fa;font-family:monospace;font-weight:700">${node.symbol}</span> <span style="color:#e2e8f0">${node.nazwa}</span>${gOpsCount>0?` <span style="font-size:.62rem;color:#475569;background:#1e3a5f;padding:1px 5px;border-radius:3px">${gOpsCount} op.</span>`:''}`
                : isP ? `<span style="color:#a78bfa;font-size:.72rem;font-family:monospace">${node.symbol||'—'}</span> <span style="color:#e2e8f0;font-size:.8rem">${node.nazwa||'(bez nazwy)'}</span>${pOpsCount>0?` <span style="font-size:.62rem;color:#475569;background:#2d1f5e;padding:1px 5px;border-radius:3px">${pOpsCount} op.</span>`:''}`
                : `<span style="color:#9ca3af;font-family:monospace;font-size:.7rem">${node.material_indeks||'—'}</span> <span style="color:#9ca3af;font-size:.78rem">${node.material_opis||''}</span>`;
    const ilocStr = (() => {
      if (isM) {
        const zap = nzCalcZapotrzebowanie(node, s.nzIlosc || 1);
        return `<span style="color:#94a3b8;font-size:.7rem;margin-left:auto">${(+node.mat_ilosc_szt||1).toLocaleString('pl-PL',{maximumFractionDigits:2})} ${node.material_jm||'szt'}/wyrób → <b style="color:#60a5fa">${zap.wartosc.toLocaleString('pl-PL',{maximumFractionDigits:3})} ${zap.jm}</b></span>`;
      }
      return `<span style="color:#94a3b8;font-size:.7rem;margin-left:auto">${(+node.ilosc).toLocaleString('pl-PL',{maximumFractionDigits:2})} ${node.jednostka||node.material_jm||'szt'}</span>`;
    })();
    const badge = isG ? `<span style="font-size:.6rem;padding:1px 5px;border-radius:3px;background:#1e3a5f;color:#60a5fa;border:1px solid #3b82f633">G</span>`
                 : isP ? `<span style="font-size:.6rem;padding:1px 5px;border-radius:3px;background:#2d1f5e;color:#a78bfa;border:1px solid #8b5cf633">P</span>`
                 : `<span style="font-size:.6rem;padding:1px 5px;border-radius:3px;background:#1a1f2e;color:#6b7280;border:1px solid #6b728033">M</span>`;
    const actBtns = isG ? `
        <button onclick="nzAddP('${node._id}')" title="Dodaj operację/półprodukt P"
                style="background:#2d1f5e;color:#a78bfa;border:1px solid #8b5cf633;border-radius:4px;padding:2px 7px;font-size:.67rem;cursor:pointer">+ P</button>
        <button onclick="nzAddM('${node._id}')" title="Dodaj materiał M"
                style="background:#1a1f2e;color:#6b7280;border:1px solid #6b728033;border-radius:4px;padding:2px 7px;font-size:.67rem;cursor:pointer">+ M</button>`
      : isP ? `
        <button onclick="nzAddP('${node._id}')" title="Dodaj pod-operację"
                style="background:#2d1f5e;color:#a78bfa;border:1px solid #8b5cf633;border-radius:4px;padding:2px 7px;font-size:.67rem;cursor:pointer">+ P</button>
        <button onclick="nzAddM('${node._id}')" title="Dodaj materiał"
                style="background:#1a1f2e;color:#6b7280;border:1px solid #6b728033;border-radius:4px;padding:2px 7px;font-size:.67rem;cursor:pointer">+ M</button>
        <button onclick="nzDeleteNode('${node._id}')" title="Usuń"
                style="background:#3a1a1a;color:#f87171;border:1px solid #f8717133;border-radius:4px;padding:2px 7px;font-size:.67rem;cursor:pointer">✕</button>`
      : `
        <button onclick="nzDeleteNode('${node._id}')" title="Usuń"
                style="background:#3a1a1a;color:#f87171;border:1px solid #f8717133;border-radius:4px;padding:2px 7px;font-size:.67rem;cursor:pointer">✕</button>`;
    const rowHtml = `
      <div style="margin-left:${indent}px;margin-bottom:3px;background:${bg};border-left:2px solid ${borderCol};
                  border-radius:4px;padding:5px 8px;display:flex;align-items:center;gap:6px;cursor:pointer"
           onclick="setState({nzEditNode:'${node._id}',nzMatSearch:'',nzMatResults:[]})">
        ${badge}
        <div style="flex:1;display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden">${label}</div>
        ${ilocStr}
        <div style="display:flex;gap:3px;flex-shrink:0" onclick="event.stopPropagation()">${actBtns}</div>
      </div>`;
    const childHtml = (node.children||[]).map(c => renderNzNode(c, depth+1)).join('');
    return rowHtml + childHtml;
  }

  const treeHtml = tree ? renderNzNode(tree, 0) : '';

  const body = `
    ${nzRenderFromHistoryBanner()}
    <div class="nz-grid">
    <div class="nz-col-left">
    <!-- Dane zlecenia -->
    <div style="background:var(--entry);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">📋 Dane zlecenia</div>
      <div class="field"><label>Numer zlecenia *</label>
        <div style="position:relative">
          <input id="nz-numer" type="text" placeholder="np. ZL-2024/001" value="${s.nzNumer}"
                 style="background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px 10px;width:100%;box-sizing:border-box;font-size:14px">
        </div>
      </div>
      <div class="field"><label>Nazwa zlecenia *</label>
        <input id="nz-nazwa" type="text" placeholder="np. Wał napędowy Ø50" value="${s.nzNazwa}"
               style="background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px 10px;width:100%;box-sizing:border-box;font-size:14px">
      </div>
      <div class="field"><label>Opis</label>
        <textarea id="nz-opis" rows="2"
                  style="background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px 10px;width:100%;box-sizing:border-box;font-size:13px;resize:vertical">${s.nzOpis||''}</textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="field"><label>Termin</label>
          <input id="nz-termin" type="date" value="${s.nzTermin||''}"
                 style="background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px 10px;width:100%;box-sizing:border-box;font-size:13px">
        </div>
        <div class="field"><label>Ilość sztuk</label>
          <input id="nz-ilosc" type="number" value="${s.nzIlosc||1}" min="1"
                 style="background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px 10px;width:100%;box-sizing:border-box;font-size:13px">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="field"><label>Cena brutto/szt (zł)</label>
          <input id="nz-cena" type="number" step="0.01" value="${s.nzCena||0}"
                 style="background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px 10px;width:100%;box-sizing:border-box;font-size:13px">
        </div>
        <div class="field"><label>Materiał od klienta</label>
          <select id="nz-mat"
                  style="background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px 10px;width:100%;box-sizing:border-box;font-size:13px">
            <option value="0" ${!s.nzMatKlienta?'selected':''}>Nie – definiuję materiały</option>
            <option value="1" ${s.nzMatKlienta?'selected':''}>Tak – klient dostarcza</option>
          </select>
        </div>
      </div>
    </div>

    </div>

    <div class="nz-col-right">
    <!-- Struktura G→P -->
    <div style="background:var(--entry);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">🌳 Struktura G→P</div>
      <div style="display:flex;flex-direction:column;gap:14px;min-height:200px">
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:10px;overflow-y:auto;max-height:280px;min-height:60px;overflow-x:auto">
            ${treeHtml || '<div style="color:#334155;font-size:.78rem;padding:8px">Brak węzłów</div>'}
          </div>
          <div style="font-size:.7rem;color:#334155;line-height:1.6">
            <span style="color:#60a5fa">G</span> = wyrób główny &nbsp;
            <span style="color:#a78bfa">P</span> = operacja/półprodukt &nbsp;
            <span style="color:#6b7280">M</span> = materiał
          </div>
          <div style="font-size:.68rem;color:#334155;line-height:1.6;border-top:1px solid #1e293b;padding-top:6px">
            ⌨ Skróty (gdy żadne pole tekstowe nie jest aktywne):
            <b style="color:#60a5fa">O</b> dodaj operację ·
            <b style="color:#6b7280">M</b> dodaj materiał ·
            <b style="color:#a78bfa">P</b> dodaj P do aktywnego węzła ·
            <b style="color:#a78bfa">Shift+P</b> dodaj P do głównego G
          </div>
        </div>
        <div id="nz-edit-panel" style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:12px;overflow-y:auto;max-height:420px">
          ${editPanel}
        </div>
      </div>
    </div>
    </div>
    </div>

    <div style="display:flex;gap:10px;margin-top:8px">
      <button onclick="nzClose()"
              style="flex:1;background:#ffffff10;color:#94a3b8;border:1px solid #ffffff15;border-radius:6px;padding:10px;cursor:pointer;font-size:.9rem">
        Anuluj
      </button>
      <button onclick="nzSaveFromSinglePage()" ${s.nzSaving?'disabled':''}
              style="flex:2;background:${s.nzSaving?'#1e293b':'#16a34a'};color:${s.nzSaving?'#475569':'#fff'};border:none;border-radius:6px;padding:10px;cursor:${s.nzSaving?'wait':'pointer'};font-weight:700;font-size:.9rem">
        ${s.nzSaving ? '⏳ Zapisuję...' : (s.nzEditId ? '💾 Zapisz zmiany' : '💾 Utwórz zlecenie')}
      </button>
    </div>`;

  requestAnimationFrame(() => nzInitAutocomplete());

  return `
    <div class="modal-overlay" onclick="if(event.target===this&&!state.nzSaving)nzClose()">
      <div class="modal nz-modal-wide" style="width:97vw">
        <button class="modal-close" onclick="nzClose()">×</button>
        <h3 style="margin-bottom:18px">${s.nzEditId ? '✏ Edytuj zlecenie produkcyjne' : '🏭 Nowe zlecenie produkcyjne'}</h3>
        ${body}
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SKRÓTY KLAWISZOWE – szybkie tworzenie O / M / P w drzewie wizarda
// ═══════════════════════════════════════════════════════════════════════════════
// O → dodaj operację do aktywnego węzła (G lub P)
// M → dodaj materiał do aktywnego węzła (G lub P)
// P → dodaj podzlecenie P do aktywnego węzła:
//      - jeśli aktywny węzeł to G → nowe P na poziomie głównym
//      - jeśli aktywny węzeł to P → nowe P zagnieżdżone w tym P
// Shift+P → zawsze dodaj P na poziomie głównym (do korzenia G),
//           niezależnie od tego, który węzeł jest aktywnie edytowany
//
// Aktywny węzeł = ten, którego panel edycji jest aktualnie otwarty (state.nzEditNode).
// Jeśli aktywny jest węzeł M (materiał), kontenerem jest jego rodzic (G/P).
// Jeśli nic nie jest jeszcze wybrane, kontenerem jest korzeń G.

function nzGetActiveContainer() {
  const tree = state.nzTree;
  if (!tree) return null;
  const node = state.nzEditNode ? nzFindNode(tree, state.nzEditNode) : null;
  if (!node) return tree;
  if (node.typ === 'M') {
    return nzFindParent(tree, node._id) || tree;
  }
  return node; // G lub P
}

// Po dodaniu O/M/P od razu ustaw focus na pierwszym polu do wypełnienia,
// żeby można pisać dalej bez sięgania po mysz.
function nzFocusAfterAdd(kind) {
  requestAnimationFrame(() => {
    const panel = document.getElementById('nz-edit-panel');
    if (!panel) return;
    let el = null;
    if (kind === 'op') {
      const inputs = panel.querySelectorAll('input[placeholder="Nazwa operacji"]');
      el = inputs[inputs.length - 1] || null;
    } else if (kind === 'mat') {
      el = document.getElementById('nz-mat-search');
    } else if (kind === 'p') {
      el = panel.querySelector('input[placeholder="np. P-001"]');
    }
    if (el) { el.focus(); if (el.select) el.select(); }
  });
}

function nzShortcutKeydown(e) {
  // Nigdy nie przechwytuj kombinacji z Ctrl/Cmd/Alt (np. Ctrl+P = drukuj)
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = (e.key || '').toLowerCase();
  if (key !== 'o' && key !== 'm' && key !== 'p') return;
  // Nie przeszkadzaj w pisaniu w polach tekstowych
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;

  // Tryb 1: wizard nowego zlecenia (krok 2)
  const inWizard = state.nzModal && state.nzStep === 2 && state.nzTree && !state.nzSaving;
  // Tryb 2: zakładka Struktura G/P z wybranym wyrobem G
  const inDrzewo = !inWizard && state.activeTab === 'drzewoGP' && state.drzewoSelectedG;

  if (!inWizard && !inDrzewo) return;
  e.preventDefault();

  // ── Tryb wizard ──────────────────────────────────────────────────────────────
  if (inWizard) {
    const container = nzGetActiveContainer();
    if (!container) return;
    if (key === 'o') {
      nzAddOp(container._id);
      nzFocusAfterAdd('op');
    } else if (key === 'm') {
      nzAddM(container._id);
      nzFocusAfterAdd('mat');
    } else if (key === 'p') {
      const targetId = e.shiftKey ? state.nzTree._id : container._id;
      nzAddP(targetId);
      nzFocusAfterAdd('p');
    }
    return;
  }

  // ── Tryb Struktura G/P ───────────────────────────────────────────────────────
  // O i M – otwórz panel nowego wyrobu z odpowiednim typem
  // P       – nowy półprodukt P
  // Shift+P – nowy wyrób G (poziom główny)
  if (key === 'p') {
    const typ = e.shiftKey ? 'G' : 'P';
    setState({
      drzewoPanel: 'nowy',
      drzewoNowyForm: { symbol: '', nazwa: '', typ, jednostka: 'szt', numer_rysunku: '' }
    });
    render();
    // Ustaw focus na pole Symbol
    requestAnimationFrame(() => {
      const input = document.querySelector('[placeholder="np. G.100.001"], [placeholder="np. P-001"]');
      if (input) { input.focus(); input.select(); }
    });
  } else if (key === 'o' || key === 'm') {
    // O/M w kontekście G/P – otwórz panel nowego wyrobu (P dla operacji/materiałów)
    setState({
      drzewoPanel: 'nowy',
      drzewoNowyForm: { symbol: '', nazwa: '', typ: 'P', jednostka: 'szt', numer_rysunku: '' }
    });
    render();
    requestAnimationFrame(() => {
      const input = document.querySelector('[placeholder="np. G.100.001"], [placeholder="np. P-001"]');
      if (input) { input.focus(); input.select(); }
    });
  }
}

document.addEventListener('keydown', nzShortcutKeydown);

// Helper: zbiera dane z formularza jednej strony i wywołuje nzSave
function nzSaveFromSinglePage() {
  const numer = (document.getElementById('nz-numer')?.value || '').trim();
  const nazwa = (document.getElementById('nz-nazwa')?.value || '').trim();
  const opis  = (document.getElementById('nz-opis')?.value  || '');
  const termin= (document.getElementById('nz-termin')?.value|| '');
  const ilosc = parseInt(document.getElementById('nz-ilosc')?.value) || 1;
  const cena  = parseFloat(document.getElementById('nz-cena')?.value) || 0;
  const matKl = document.getElementById('nz-mat')?.value === '1';
  if (!numer || !nazwa) { alert('Numer i nazwa zlecenia są wymagane'); return; }
  let tree = state.nzTree;
  if (tree) {
    tree = JSON.parse(JSON.stringify(tree));
    tree.symbol = numer;
    tree.nazwa  = nazwa;
    tree.ilosc  = ilosc;
  } else {
    tree = { _id: nzNewId(), typ: 'G', symbol: numer, nazwa: nazwa, ilosc: ilosc, jednostka: 'szt', ops: [], children: [] };
  }
  setState({ nzNumer: numer, nzNazwa: nazwa, nzOpis: opis, nzTermin: termin, nzIlosc: ilosc, nzCena: cena, nzMatKlienta: matKl, nzTree: tree }, false);
  nzSave();
}
