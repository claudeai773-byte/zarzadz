// ═══════════════════════════════════════════════════════════════════════════════
// Autouzupełnianie fraz – nazwy/opisy operacji, opisy zleceń
// ═══════════════════════════════════════════════════════════════════════════════
//
// Działanie:
//  • Aplikacja zapamiętuje zwroty użyte w polach "Nazwa operacji", "Opis czynności"
//    i "Opis zlecenia" (backend: tabela frazy_slownik, endpointy /api/frazy).
//  • Przy wpisywaniu tekstu (od 2 znaków) pole pokazuje dopowiedzenie "ghost text"
//    (resztę najlepiej pasującej frazy, wyszarzoną) ORAZ rozwijaną listę do 6
//    podpowiedzi pod polem.
//  • Obsługa klawiatury:
//      → (Strzałka w prawo) / Tab  – przyjmuje cały ghost-text (uzupełnia od kursora)
//      ↓ / ↑                        – przechodzi między propozycjami na liście
//      Enter (gdy lista aktywna)    – zatwierdza wybraną propozycję i kontynuuje pisanie
//      Esc                          – zamyka podpowiedzi, nie zmienia tekstu
//  • Frazy są zapisywane do słownika automatycznie przez backend w momencie
//    zapisu operacji/zlecenia (POST/PUT /api/operacje, /api/zlecenia) – nic
//    dodatkowego nie trzeba robić przy samym zapisie.
//
// UŻYCIE – po wyrenderowaniu pola w DOM:
//    attachTextAutocomplete(document.getElementById('op-nazwa'), 'op_nazwa');
//    attachTextAutocomplete(document.getElementById('op-opis'),  'op_opis');
//    attachTextAutocomplete(document.getElementById('zl-opis'),  'zl_opis');
//
// Działa na <input type="text"> i <textarea>. Dla textarea podpowiada na bazie
// aktualnie edytowanej linii (od ostatniego \n do kursora), żeby nie psuć
// wielolinijkowych opisów typu "Frezować wybranie...\nWiercić otwory...".
// ═══════════════════════════════════════════════════════════════════════════════

const _tac = new WeakMap(); // element -> { typ, cache:[], ghost:'', timer, listEl, wrapEl }

function attachTextAutocomplete(el, typ) {
  if (!el || _tac.has(el)) return;

  // Owijamy pole w relative-wrapper (bez zmiany layoutu otaczającego kodu) jeśli
  // rodzic nie jest już position:relative.
  let wrap = el.parentElement;
  if (!wrap || getComputedStyle(wrap).position === 'static') {
    wrap = document.createElement('div');
    wrap.style.position = 'relative';
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
  }

  // Overlay do "ghost text" – widoczny tylko dla input (textarea: tylko lista, bo
  // wieloliniowy ghost-text overlay jest zbyt zawodny przy zawijaniu tekstu)
  let ghostEl = null;
  if (el.tagName === 'INPUT') {
    ghostEl = document.createElement('div');
    ghostEl.className = 'tac-ghost';
    const cs = getComputedStyle(el);
    ghostEl.style.cssText = `
      position:absolute; left:0; top:0; right:0; bottom:0;
      pointer-events:none; white-space:pre; overflow:hidden;
      font:${cs.fontSize} ${cs.fontFamily}; line-height:${cs.lineHeight};
      padding:${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft};
      box-sizing:${cs.boxSizing}; color:transparent;
    `;
    wrap.appendChild(ghostEl);
  }

  const list = document.createElement('ul');
  list.className = 'tac-list';
  list.style.cssText = [
    'position:absolute', 'z-index:9999', 'top:100%', 'left:0',
    'background:#0f172a', 'border:1px solid #334155',
    'border-radius:8px', 'margin:2px 0 0 0', 'padding:0',
    'list-style:none', 'max-height:200px', 'overflow-y:auto',
    'width:100%', 'box-shadow:0 8px 24px #00000066',
    'display:none', 'box-sizing:border-box',
  ].join(';');
  wrap.appendChild(list);

  const data = { typ, cache: [], ghost: '', timer: null, listEl: list, ghostEl, activeIdx: -1 };
  _tac.set(el, data);

  el.addEventListener('input', () => _tacOnInput(el));
  el.addEventListener('keydown', (e) => _tacOnKeydown(el, e));
  el.addEventListener('blur', () => setTimeout(() => _tacHide(el), 150));
  el.addEventListener('scroll', () => _tacSyncGhostScroll(el));
}

// ── Wyznacz aktualnie edytowany "token" (cały input, albo ostatnia linia textarea aż do kursora)
function _tacCurrentFragment(el) {
  const pos = el.selectionStart ?? el.value.length;
  const before = el.value.slice(0, pos);
  const lastNl = before.lastIndexOf('\n');
  return { text: before.slice(lastNl + 1), start: lastNl + 1, pos };
}

function _tacOnInput(el) {
  const data = _tac.get(el);
  if (!data) return;
  clearTimeout(data.timer);
  data.timer = setTimeout(() => _tacSearch(el), 150);
}

async function _tacSearch(el) {
  const data = _tac.get(el);
  if (!data) return;
  const frag = _tacCurrentFragment(el);
  const q = frag.text.trim();

  if (q.length < 2) { _tacHide(el); return; }

  let results = [];
  try {
    results = await get(`/api/frazy?typ=${encodeURIComponent(data.typ)}&q=${encodeURIComponent(q)}&limit=6`);
  } catch (e) {
    results = [];
  }
  // Nie pokazuj propozycji identycznej z tym co już jest wpisane
  results = results.filter(r => r.tekst.toLowerCase() !== q.toLowerCase());
  data.cache = results;
  data.activeIdx = -1;

  _tacRenderList(el, q);
  _tacRenderGhost(el, q, results[0]?.tekst || '');
}

function _tacRenderGhost(el, q, bestMatch) {
  const data = _tac.get(el);
  if (!data || !data.ghostEl) { if (data) data.ghost = ''; return; }
  if (bestMatch && bestMatch.toLowerCase().startsWith(q.toLowerCase()) && q.length > 0) {
    const suffix = bestMatch.slice(q.length);
    data.ghost = suffix;
    const cs = getComputedStyle(el);
    data.ghostEl.innerHTML =
      `<span style="visibility:hidden">${_tacEsc(el.value)}</span>` +
      `<span style="color:${cs.color === 'rgb(226, 232, 240)' ? '#475569' : '#9ca3af'}">${_tacEsc(suffix)}</span>`;
  } else {
    data.ghost = '';
    data.ghostEl.innerHTML = '';
  }
}

function _tacSyncGhostScroll(el) {
  const data = _tac.get(el);
  if (data && data.ghostEl) data.ghostEl.scrollLeft = el.scrollLeft;
}

function _tacRenderList(el, q) {
  const data = _tac.get(el);
  const ul = data.listEl;
  if (!data.cache.length) { ul.style.display = 'none'; return; }

  ul.innerHTML = data.cache.map((r, i) => `
    <li data-idx="${i}"
        style="display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;
               border-bottom:1px solid #1e293b;font-size:13px;color:#cbd5e1;transition:background .1s"
        onmouseover="this.style.background='#1e293b'"
        onmouseout="this.style.background=''"
        onmousedown="event.preventDefault();_tacApplyByIdx(window._tacCurEl, ${i})">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${_tacHl(r.tekst, q)}</span>
      ${r.uzycia > 1 ? `<span style="color:#475569;font-size:11px;flex-shrink:0">×${r.uzycia}</span>` : ''}
    </li>`).join('');
  ul.style.display = 'block';
  window._tacCurEl = el; // referencja do elementu na potrzeby onmousedown (inline handler)
}

function _tacHl(text, q) {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return _tacEsc(text);
  return _tacEsc(text.slice(0, idx))
    + `<mark style="background:#3b82f633;color:#93c5fd;border-radius:2px">${_tacEsc(text.slice(idx, idx + q.length))}</mark>`
    + _tacEsc(text.slice(idx + q.length));
}
function _tacEsc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function _tacHide(el) {
  const data = _tac.get(el);
  if (!data) return;
  data.listEl.style.display = 'none';
  data.activeIdx = -1;
  if (data.ghostEl) { data.ghostEl.innerHTML = ''; data.ghost = ''; }
}

function _tacSetActive(el, idx) {
  const data = _tac.get(el);
  const items = data.listEl.querySelectorAll('li');
  items.forEach(li => li.style.background = '');
  data.activeIdx = idx;
  if (idx >= 0 && idx < items.length) {
    items[idx].style.background = '#1e3a5f';
    items[idx].scrollIntoView({ block: 'nearest' });
  }
}

// ── Wstawia wybraną frazę w miejsce aktualnie edytowanego fragmentu i kontynuuje pisanie
function _tacApplyByIdx(el, idx) {
  const data = _tac.get(el);
  if (!data || !data.cache[idx]) return;
  const tekst = data.cache[idx].tekst;
  const frag = _tacCurrentFragment(el);
  const after = el.value.slice(frag.pos);
  el.value = el.value.slice(0, frag.start) + tekst + after;
  const newPos = frag.start + tekst.length;
  el.setSelectionRange(newPos, newPos);
  el.focus();
  _tacHide(el);
  el.dispatchEvent(new Event('input', { bubbles: true })); // odśwież ewentualne bindowanie stanu
}

// ── Przyjęcie ghost-textu (strzałka w prawo / Tab) – tylko jeśli kursor jest na końcu fragmentu
function _tacAcceptGhost(el) {
  const data = _tac.get(el);
  if (!data || !data.ghost) return false;
  const pos = el.selectionStart;
  if (pos !== el.selectionEnd) return false; // brak zaznaczenia – wymagane
  const after = el.value.slice(pos);
  el.value = el.value.slice(0, pos) + data.ghost + after;
  const newPos = pos + data.ghost.length;
  el.setSelectionRange(newPos, newPos);
  _tacHide(el);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function _tacOnKeydown(el, e) {
  const data = _tac.get(el);
  if (!data) return;
  const listOpen = data.listEl.style.display !== 'none' && data.cache.length;

  // Strzałka w prawo / Tab → przyjmij ghost-text, tylko gdy kursor jest na końcu wpisanego tekstu
  if ((e.key === 'ArrowRight' || e.key === 'Tab') && data.ghost) {
    const atEnd = el.selectionStart === el.value.length;
    if (atEnd) {
      e.preventDefault();
      _tacAcceptGhost(el);
      return;
    }
  }

  if (!listOpen) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const items = data.listEl.querySelectorAll('li');
    _tacSetActive(el, Math.min(data.activeIdx + 1, items.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _tacSetActive(el, Math.max(data.activeIdx - 1, 0));
  } else if (e.key === 'Enter' && data.activeIdx >= 0) {
    e.preventDefault();
    _tacApplyByIdx(el, data.activeIdx);
  } else if (e.key === 'Escape') {
    _tacHide(el);
  }
}

// ── Inicjalizacja wielu pól naraz, np. po wyrenderowaniu modala ───────────────
function initTextAutocomplete(map) {
  // map: { 'css-id-or-selector': 'typ_frazy', ... }
  Object.entries(map).forEach(([sel, typ]) => {
    const el = sel.startsWith('#') || sel.startsWith('.') ? document.querySelector(sel) : document.getElementById(sel);
    if (el) attachTextAutocomplete(el, typ);
  });
}
