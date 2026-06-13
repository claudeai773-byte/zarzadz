//  ZLECENIA CRUD
// ══════════════════════════════════════════════════════════════
let _savingZlecenie = false;

// ══════════════════════════════════════════════════════════════
//  Drzewo G→P dla zlecenia – modal w zakładce Zlecenia
// ══════════════════════════════════════════════════════════════
async function openZlDrzewoModal(zid, numer, nazwa, ilosc_sztuk) {
  setState({ zlDrzewoModal: { id: zid, numer, nazwa, ilosc_sztuk: ilosc_sztuk || 1,
    tree: null, loading: true, error: null } });
  try {
    const wyroby = await get('/api/wyroby?typ=G&q=' + encodeURIComponent(numer));
    const wg = wyroby.find(w => w.symbol === numer);
    if (!wg) {
      setState({ zlDrzewoModal: { ...state.zlDrzewoModal, loading: false, tree: 'brak', wyrobId: null } });
      return;
    }
    const tree = await get('/api/wyroby/' + wg.id + '/drzewo');
    setState({ zlDrzewoModal: { ...state.zlDrzewoModal, loading: false, tree, wyrobId: wg.id } });
  } catch(e) {
    setState({ zlDrzewoModal: { ...state.zlDrzewoModal, loading: false, tree: 'brak', error: e.message } });
  }
}

function renderZlDrzewoModal() {
  const m = state.zlDrzewoModal;
  if (!m) return '';
  let inner = '';
  if (m.loading) {
    inner = '<div style="text-align:center;padding:40px;color:var(--dim)">⏳ Ładowanie drzewa G→P...</div>';
  } else if (!m.tree || m.tree === 'brak') {
    inner = '<div style="text-align:center;padding:40px">'
      + '<div style="font-size:36px;margin-bottom:12px">🌳</div>'
      + '<div style="color:var(--dim);font-size:14px;margin-bottom:8px">Brak struktury G→P dla zlecenia <strong>' + m.numer + '</strong></div>'
      + '<div style="font-size:12px;color:var(--dim)">Utwórz zlecenie przez wizard G→P lub zaimportuj z PDF.</div>'
      + '<div style="margin-top:16px;display:flex;gap:8px;justify-content:center">'
      + '<button onclick="setState({zlDrzewoModal:null});nzOpen()" style="background:#3b82f6;color:#fff;border:none;border-radius:8px;padding:10px 18px;cursor:pointer;font-size:13px;font-weight:700">+ Nowe zlecenie G→P</button>'
      + '</div></div>';
  } else {
    const nodeCount = (function cnt(n){return 1+(n.children||[]).reduce((s,c)=>s+cnt(c),0);})(m.tree);
    inner = '<div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap">'
      + '<span style="font-size:12px;color:var(--dim)">' + nodeCount + ' węzłów</span>'
      + '<div style="flex:1"></div>'
      + '<button onclick="zlDrzewoDodajP()" style="background:#2d1f5e;color:#a78bfa;border:1px solid #8b5cf633;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer;font-weight:600">+ Dodaj podzlecenie P</button>'
      + '<button onclick="openZlDrzewoModal(' + m.id + ',\'' + m.numer.replace(/'/g,"\\'") + '\',\'' + (m.nazwa||'').replace(/'/g,"\\'") + '\',' + m.ilosc_sztuk + ')" style="background:var(--entry);color:var(--dim);border:1px solid var(--border);border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer">↺ Odśwież</button>'
      + '</div>'
      + '<div style="background:var(--entry);border-radius:10px;padding:12px;overflow-x:auto;max-height:60vh;overflow-y:auto">'
      + renderDrzewoNode(m.tree, 0, m.ilosc_sztuk || 1)
      + '</div>';
  }

  return '<div class="modal-overlay" onclick="if(event.target===this)setState({zlDrzewoModal:null})">'
    + '<div class="modal" style="max-height:90vh;overflow-y:auto;max-width:680px">'
    + '<button class="modal-close" onclick="setState({zlDrzewoModal:null})">×</button>'
    + '<div style="font-size:16px;font-weight:700;margin-bottom:2px">🌳 Drzewo G→P</div>'
    + '<div style="color:var(--dim);font-size:13px;margin-bottom:16px">' + m.numer + ' · ' + (m.nazwa||'') + '</div>'
    + inner
    + '</div></div>';
}

async function zlDrzewoDodajP() {
  const m = state.zlDrzewoModal;
  if (!m || !m.wyrobId) { alert('Brak wyrobu G – nie można dodać P'); return; }
  const pSymbol = prompt('Symbol nowego podzlecenia P (np. ' + m.numer + '-P1):');
  if (!pSymbol || !pSymbol.trim()) return;
  const pNazwa  = prompt('Nazwa podzlecenia P:', pSymbol.trim()) || pSymbol.trim();
  const pIlosc  = parseFloat(prompt('Ilość (szt):', '1') || '1') || 1;
  try {
    // 1. Utwórz wyrób P
    let wyrob_p_id = null;
    try {
      const wp = await post('/api/wyroby', { symbol: pSymbol.trim(), typ: 'P', nazwa: pNazwa, jednostka: 'szt' });
      wyrob_p_id = wp.id;
    } catch(e) {
      const list = await get('/api/wyroby?typ=P&q=' + encodeURIComponent(pSymbol.trim()));
      const found = list.find(w => w.symbol === pSymbol.trim());
      if (found) wyrob_p_id = found.id;
      else throw new Error('Nie można utworzyć wyrobu P: ' + e.message);
    }
    // 2. Dodaj do BOM wyrobu G
    await post('/api/wyroby/' + m.wyrobId + '/bom', {
      skladnik_id: wyrob_p_id, typ_skladnika: 'P',
      ilosc: pIlosc, jednostka: 'szt', pozycja: 0,
    });
    // 3. Utwórz zlecenie P
    let zlecenie_p_id = null;
    try {
      const zp = await post('/api/zlecenia', {
        numer: pSymbol.trim(), nazwa: pNazwa, opis: '', termin: null,
        ilosc_sztuk: Math.max(1, Math.round(pIlosc)), cena_brutto_szt: 0, material_od_klienta: 0,
      });
      zlecenie_p_id = zp.id;
    } catch(e) {
      const allZl = await get('/api/zlecenia');
      const found = allZl.find(z => z.numer === pSymbol.trim());
      if (found) zlecenie_p_id = found.id;
    }
    // 4. Utwórz i zlinkuj zapotrzebowanie G→P (atomowo)
    if (zlecenie_p_id) {
      try {
        await post('/api/zlecenia/' + m.id + '/zapotrzebowania', {
          zlecenie_g_id: m.id, wyrob_p_symbol: pSymbol.trim(),
          ilosc_wymagana: pIlosc, zlecenie_p_id: zlecenie_p_id,
        });
      } catch(_) {}
    }
    await loadZlecenia();
    await openZlDrzewoModal(m.id, m.numer, m.nazwa, m.ilosc_sztuk);
    alert('✅ Podzlecenie P "' + pSymbol.trim() + '" zostało dodane!');
  } catch(e) {
    alert('Błąd: ' + e.message);
  }
}

async function saveZlecenie(data) {
  if (_savingZlecenie) return;
  _savingZlecenie = true;
  try {
    if (data.id) {
      await put(`/api/zlecenia/${data.id}`, data);
      setState({zlecenieModal:null});
      await loadZlecenia();
      // Wyczyść cache drzewa dla tego zlecenia – dane odświeżą się przy kolejnym otwarciu
      const updDrzewa = {...(state.zlecenieDrzewa || {})};
      delete updDrzewa[data.id];
      setState({zlecenieDrzewa: updDrzewa}, true);
    } else {
      const result = await post('/api/zlecenia', data);
      const newId = result.id;
      // Skopiuj operacje ze wzorcowego zlecenia
      const ops = state.autofillOperacje || [];
      if (ops.length && state.autofillSourceId && newId) {
        for (const op of ops) {
          try {
            await post('/api/operacje', {
              zlecenie_id: newId,
              nazwa: op.nazwa,
              kolejnosc: op.kolejnosc,
              czas_norma: op.czas_norma,
              stanowisko: op.stanowisko || '',
              opis_czynnosci: op.opis_czynnosci || '',
              czas_zbrojenia_min: op.czas_zbrojenia_min || 0,
            });
          } catch(e2) { console.error('Błąd kopiowania operacji:', e2); }
        }
      }
      // Skopiuj produkty ze wzorcowego zlecenia
      const prods = state.autofillProdukty || [];
      if (prods.length && state.autofillSourceId && newId) {
        for (const p of prods) {
          try {
            await post(`/api/zlecenia/${newId}/produkty`, {
              nazwa: p.nazwa,
              ilosc: p.ilosc,
              cena: p.cena,
            });
          } catch(e2) { console.error('Błąd kopiowania produktu:', e2); }
        }
      }
      // Najpierw odśwież listę zleceń, potem zamknij modal
      await loadZlecenia();
      setState({zlecenieModal:null, autofillSourceId:null, autofillOperacje:[], autofillProdukty:[], autofillStepUrl:null, bomSelectedMat:null, bomSearch:'', bomSearchResults:[]});
    }
  } catch(e) {
    alert('Błąd: ' + e.message);
  } finally {
    _savingZlecenie = false;
  }
}

async function deleteZlecenie(id) {
  if (!confirm('Usunąć zlecenie i wszystkie jego operacje?')) return;
  try {
    await del(`/api/zlecenia/${id}`);
    // Odśwież zakładkę Zlecenia
    await loadZlecenia();
    // Zawsze synchronizuj stan drzewa G/P (żeby po przejściu do zakładki Drzewo zlecenie już znikło)
    const [g, p, zl] = await Promise.all([
      get('/api/wyroby?typ=G'),
      get('/api/wyroby?typ=P'),
      get('/api/zlecenia'),
    ]);
    const zlG = zl.filter(z => g.some(wg => wg.symbol === z.numer));
    setState({drzewoWyrobyG: g, drzewoWyrobyP: p, drzewoZleceniaG: zlG}, true);
    // Jeśli zakładka drzewo aktywna – przeładuj pełne drzewo
    if (state.activeTab === 'drzewo') loadDrzewoGP();
  } catch(e) {
    alert('Błąd: ' + e.message);
  }
}

async function changeZlecenieStatus(id, status) {
  try {
    await patch(`/api/zlecenia/${id}/status`, {status});
    await loadZlecenia();
  } catch(e) {
    alert('Błąd: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════
