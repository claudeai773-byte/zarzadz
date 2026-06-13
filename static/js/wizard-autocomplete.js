// ═══════════════════════════════════════════════════════════════════════════════
// PATCH 1 – Autocomplete historii zleceń w Kroku 1 Wizarda
// Dodaj ten plik po wizard-nz.js
// ═══════════════════════════════════════════════════════════════════════════════
//
// Jak działa:
//  • Przy wpisywaniu numeru G lub P wyszukuje w /api/zlecenia (cache lokalny)
//  • Pokazuje dropdown z pasującymi zleceniami z historii
//  • Po wyborze → załadowuje całą strukturę drzewa G/P i materiały (tak jak
//    nzOpenEdit), ale pozostaje w kroku 1 (użytkownik może edytować dane przed
//    przejściem do kroku 2).
//
// INTEGRACJA: w renderNzWizard() – w bloku `if (step === 1)` zamień pole
// "Numer zlecenia" na poniższy helper:  nzRenderNumerField()
// Lub: wstaw wywołanie nzInitAutocomplete() po wyrenderowaniu formularza kroku 1.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Cache zleceń (odświeżany przy otwarciu wizarda) ───────────────────────────
let _nzHistoriaCache = [];   // [{id, numer, nazwa, ...}]
let _nzAcTimer = null;

async function nzLoadHistoria() {
  try {
    _nzHistoriaCache = await get('/api/zlecenia');
  } catch(e) {
    _nzHistoriaCache = state.zlecenia || [];
  }
}

// ── Wywołaj po wyrenderowaniu kroku 1 ─────────────────────────────────────────
function nzInitAutocomplete() {
  // Ładuj historię (nieblokująco)
  nzLoadHistoria();

  const input = document.getElementById('nz-numer');
  if (!input) return;

  // Stwórz kontener autocomplete jeśli jeszcze nie ma
  if (!document.getElementById('nz-ac-list')) {
    const ul = document.createElement('ul');
    ul.id = 'nz-ac-list';
    ul.style.cssText = [
      'position:absolute','z-index:9999',
      'background:#0f172a','border:1px solid #334155',
      'border-radius:8px','margin:2px 0 0 0','padding:0',
      'list-style:none','max-height:220px','overflow-y:auto',
      'width:100%','box-shadow:0 8px 24px #00000066',
      'display:none',
    ].join(';');
    // Ustaw wrapper z position:relative
    const wrapper = input.closest('.field') || input.parentElement;
    wrapper.style.position = 'relative';
    wrapper.appendChild(ul);
  }

  input.addEventListener('input', _nzAcOnInput);
  input.addEventListener('keydown', _nzAcOnKeydown);
  // Zamknij po kliknięciu poza
  document.addEventListener('mousedown', _nzAcClickOutside, { once: false });
}

function _nzAcOnInput(e) {
  clearTimeout(_nzAcTimer);
  _nzAcTimer = setTimeout(() => nzAcSearch(e.target.value), 220);
}

function nzAcSearch(query) {
  const q = (query || '').trim().toLowerCase();
  const ul = document.getElementById('nz-ac-list');
  if (!ul) return;

  if (q.length < 1) { _nzAcHide(); return; }

  const lista = _nzHistoriaCache.filter(z =>
    (z.numer || '').toLowerCase().includes(q) ||
    (z.nazwa  || '').toLowerCase().includes(q)
  ).slice(0, 12);

  if (!lista.length) { _nzAcHide(); return; }

  ul.innerHTML = lista.map((z, i) => {
    const statusCol = {
      w_toku: '#f59e0b', zakonczone: '#4ade80', nowe: '#60a5fa',
      wstrzymane: '#f87171', anulowane: '#6b7280'
    }[z.status] || '#94a3b8';

    const dots = i === 0 ? '' : '';
    return `<li data-idx="${i}"
      style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;
             border-bottom:1px solid #1e293b;font-size:13px;transition:background .1s"
      onmouseover="this.style.background='#1e293b'"
      onmouseout="this.style.background=''"
      onmousedown="event.preventDefault();nzAcSelect(${z.id})">
      <span style="flex-shrink:0;width:8px;height:8px;border-radius:50%;background:${statusCol}"></span>
      <span style="font-family:monospace;color:#60a5fa;flex-shrink:0;min-width:100px">${_nzHl(z.numer||'',query)}</span>
      <span style="color:#cbd5e1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${_nzHl(z.nazwa||'',query)}</span>
      <span style="color:#475569;font-size:11px;flex-shrink:0">${z.ilosc_sztuk||'?'} szt</span>
    </li>`;
  }).join('');

  ul.style.display = 'block';
}

// Podświetl fragment pasujący do query
function _nzHl(text, q) {
  if (!q) return _esc(text);
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return _esc(text);
  return _esc(text.slice(0, idx))
    + `<mark style="background:#3b82f633;color:#93c5fd;border-radius:2px">${_esc(text.slice(idx, idx + q.length))}</mark>`
    + _esc(text.slice(idx + q.length));
}
function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function _nzAcHide() {
  const ul = document.getElementById('nz-ac-list');
  if (ul) ul.style.display = 'none';
}

function _nzAcClickOutside(e) {
  const ul = document.getElementById('nz-ac-list');
  const input = document.getElementById('nz-numer');
  if (ul && !ul.contains(e.target) && e.target !== input) {
    _nzAcHide();
  }
}

function _nzAcOnKeydown(e) {
  const ul = document.getElementById('nz-ac-list');
  if (!ul || ul.style.display === 'none') return;
  const items = ul.querySelectorAll('li');
  if (!items.length) return;
  let active = ul.querySelector('li.nz-ac-active');
  let idx = active ? parseInt(active.dataset.idx) : -1;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    idx = Math.min(idx + 1, items.length - 1);
    _nzAcSetActive(items, idx);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    idx = Math.max(idx - 1, 0);
    _nzAcSetActive(items, idx);
  } else if (e.key === 'Enter' && active) {
    e.preventDefault();
    active.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  } else if (e.key === 'Escape') {
    _nzAcHide();
  }
}

function _nzAcSetActive(items, idx) {
  items.forEach(li => li.classList.remove('nz-ac-active'));
  if (idx >= 0 && idx < items.length) {
    items[idx].classList.add('nz-ac-active');
    items[idx].style.background = '#1e3a5f';
    items[idx].scrollIntoView({ block: 'nearest' });
  }
}

// ── Główna akcja: wybierz zlecenie z listy ────────────────────────────────────
async function nzAcSelect(zlecenieId) {
  _nzAcHide();

  // Pokaż spinner w polu
  const input = document.getElementById('nz-numer');
  if (input) { input.disabled = true; input.placeholder = 'Ładuję strukturę...'; }

  try {
    const all = _nzHistoriaCache;
    let z = all.find(x => x.id === zlecenieId);
    if (!z) {
      const lista = await get('/api/zlecenia');
      _nzHistoriaCache = lista;
      z = lista.find(x => x.id === zlecenieId);
    }
    if (!z) { alert('Nie znaleziono zlecenia'); return; }

    // ── Załaduj strukturę (identycznie jak nzOpenEdit) ─────────────────────
    let zapotrz = [], opsG = [], matsG = [];
    try {
      [zapotrz, opsG, matsG] = await Promise.all([
        get(`/api/zlecenia/${zlecenieId}/zapotrzebowania`).catch(() => []),
        get(`/api/zlecenia/${zlecenieId}/operacje`).catch(() => []),
        get(`/api/zlecenia/${zlecenieId}/materialy-zlecenia`).catch(() => []),
      ]);
    } catch(_) {}

    // Buduj drzewo (ta sama logika co w nzOpenEdit)
    function apiOpsToNz(apiOps) {
      return (apiOps || []).map(op => ({
        _id: nzNewId(),
        _existingId: op.id,
        nazwa: op.nazwa || '',
        stanowisko: op.stanowisko || '',
        czas_norma: op.czas_norma || 0,
        czas_zbrojenia: op.czas_zbrojenia_min || 0,
        opis_czynnosci: op.opis_czynnosci || '',
      }));
    }

    async function buildPNode(zleceniePId, symbol, nazwa, ilosc) {
      let pOps = [], pMats = [], pSubZapotrz = [];
      try {
        [pOps, pMats, pSubZapotrz] = await Promise.all([
          get(`/api/zlecenia/${zleceniePId}/operacje`).catch(() => []),
          get(`/api/zlecenia/${zleceniePId}/materialy-zlecenia`).catch(() => []),
          get(`/api/zlecenia/${zleceniePId}/zapotrzebowania`).catch(() => []),
        ]);
      } catch(_) {}

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
        symbol, nazwa, ilosc, jednostka: 'szt',
        _zlecenie_p_id: zleceniePId,
        ops: apiOpsToNz(pOps),
        children: [...subPNodes, ...mChildren],
      };
    }

    const pNodes = [];
    const seenPIds = new Set();
    const seenPSymbols = new Set();
    for (const zap of (zapotrz || [])) {
      if (zap.zlecenie_p_id) {
        if (seenPIds.has(zap.zlecenie_p_id)) continue;
        seenPIds.add(zap.zlecenie_p_id);
        pNodes.push(await buildPNode(
          zap.zlecenie_p_id,
          zap.wyrob_p_symbol || '',
          zap.wyrob_nazwa || zap.wyrob_p_symbol || '',
          zap.ilosc_wymagana || 1
        ));
      } else {
        const sym = zap.wyrob_p_symbol || '';
        if (seenPSymbols.has(sym)) continue;
        seenPSymbols.add(sym);
        pNodes.push({
          _id: nzNewId(), typ: 'P',
          symbol: sym, nazwa: zap.wyrob_nazwa || sym,
          ilosc: zap.ilosc_wymagana || 1, jednostka: 'szt',
          _zlecenie_p_id: null, ops: [], children: [],
        });
      }
    }

    const gMChildren = matsG.map(m => ({
      _id: nzNewId(), typ: 'M',
      material_indeks: m.indeks || '',
      material_opis: m.opis || '',
      mat_ilosc_szt: m.ilosc || 1,
      material_jm: m.jednostka || 'kg',
      _existingMatId: m.id,
    }));

    const root = {
      _id: nzNewId(), typ: 'G',
      symbol: z.numer, nazwa: z.nazwa,
      ilosc: z.ilosc_sztuk || 1, jednostka: 'szt',
      ops: apiOpsToNz(opsG),
      children: [...pNodes, ...gMChildren],
    };

    // ── Wstaw dane do kroku 1 (NIE przechodź do kroku 2) ──────────────────
    // Tworzymy NOWE zlecenie na bazie szablonu, więc nzEditId = null
    setState({
      // dane formularza kroku 1
      nzNumer: z.numer,
      nzNazwa: z.nazwa,
      nzOpis:  z.opis || '',
      nzTermin: '',             // termin celowo pusty – nowe zlecenie
      nzIlosc: z.ilosc_sztuk || 1,
      nzCena:  z.cena_brutto_szt || 0,
      nzMatKlienta: !!z.material_od_klienta,
      // drzewo wczytane z historii
      nzTree: root,
      nzEditId: null,           // tryb: NOWE zlecenie (szablon z historii)
      nzEditNode: null,
      nzMatSearch: '', nzMatResults: [],
      // znacznik – załadowano z historii (do wyświetlenia baneru)
      nzFromHistory: { id: zlecenieId, numer: z.numer, nazwa: z.nazwa },
    });

    // Odśwież DOM pól formularza (setState wywołuje render(), więc pola zostaną przebudowane)
    // Musimy ponownie podpiąć autocomplete po re-renderze
    requestAnimationFrame(() => nzInitAutocomplete());

  } catch(e) {
    alert('Błąd ładowania historii: ' + e.message);
  } finally {
    if (input) { input.disabled = false; input.placeholder = 'np. ZL-2024/001'; }
  }
}

// ── Baner informacyjny (wklej do renderNzWizard() w kroku 1) ─────────────────
// Wywołaj nzRenderFromHistoryBanner() jeśli state.nzFromHistory jest ustawione.
function nzRenderFromHistoryBanner() {
  const h = state.nzFromHistory;
  if (!h) return '';
  return `
  <div style="background:rgba(59,130,246,0.1);border:1px solid #3b82f655;border-radius:8px;
              padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px">
    <span style="font-size:18px">📋</span>
    <div style="flex:1">
      <div style="font-size:12px;font-weight:700;color:#60a5fa">Szablon z historii zleceń</div>
      <div style="font-size:11px;color:#94a3b8">${_esc(h.numer)} – ${_esc(h.nazwa)}</div>
      <div style="font-size:11px;color:#475569;margin-top:2px">
        Załadowano strukturę G/P i materiały. Możesz zmienić numer i termin, następnie zapisz jako nowe zlecenie.
      </div>
    </div>
    <button onclick="setState({nzFromHistory:null,nzTree:null})"
      style="background:none;border:none;color:#475569;cursor:pointer;font-size:18px;padding:0;line-height:1"
      title="Wyczyść szablon">✕</button>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INSTRUKCJA INTEGRACJI – wizard-nz.js → renderNzWizard() → blok step===1
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. Na początku funkcji nzOpen() dodaj wywołanie:
//       setState({ ..., nzFromHistory: null });
//
// 2. W renderNzWizard(), if (step === 1) { body = `...` } – na początku body dodaj:
//       ${nzRenderFromHistoryBanner()}
//
// 3. W polu "Numer zlecenia" dodaj oninput aby inicjować podpowiedzi:
//    Zamień obecny input id="nz-numer" na:
//
//    <div style="position:relative">
//      <input id="nz-numer" type="text" placeholder="np. ZL-2024/001"
//             value="${s.nzNumer}"
//             oninput="clearTimeout(window._nzAcTimer2);window._nzAcTimer2=setTimeout(()=>nzAcSearch(this.value),220)"
//             onfocus="nzAcSearch(this.value)"
//             onblur="setTimeout(_nzAcHide,200)"
//             style="background:var(--panel);color:var(--text);border:1px solid var(--border);
//                    border-radius:6px;padding:8px 10px;width:100%;box-sizing:border-box;font-size:14px">
//    </div>
//
// 4. Na końcu bloku step===1, po ustawieniu body, dodaj (lub w render() po renderze):
//       requestAnimationFrame(() => nzInitAutocomplete());
//    Możesz też wywołać nzLoadHistoria() przy otwieraniu wizarda (nzOpen/nzOpenEdit).
// ═══════════════════════════════════════════════════════════════════════════════
