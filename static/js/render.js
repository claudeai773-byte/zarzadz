//  RENDER – główna funkcja renderująca aplikację
// ══════════════════════════════════════════════════════════════

// ── Globalny tracker naciśnięcia TAB ─────────────────────────────────────────
// Gdy użytkownik wciska TAB, onchange/onblur odpala się PRZED przeniesieniem
// focusu do nowego elementu. Śledzimy: czy TAB był wciśnięty i zapisujemy
// następny element docelowy, żeby po re-renderze prawidłowo go sfokusować.

let _tabState = null; // { shiftKey, timestamp, srcIndex, srcId, srcName }
let _pendingRender = null; // ID setTimeout dla odroczonego rendera

document.addEventListener('keydown', function(e) {
  if (e.key !== 'Tab') return;
  const active = document.activeElement;
  const app = document.getElementById('app');
  if (!app || !active || !app.contains(active)) return;

  const focusable = _getFocusable(app);
  const idx = focusable.indexOf(active);

  _tabState = {
    shiftKey: e.shiftKey,
    timestamp: Date.now(),
    srcIndex: idx,
    srcId: active.id || null,
    srcName: active.name || null,
  };
}, true);

// Gdy focus faktycznie dotrze do nowego elementu po TAB – resetuj stan
document.addEventListener('focusin', function(e) {
  if (_tabState && Date.now() - _tabState.timestamp < 500) {
    // TAB się powiódł naturalnie (bez re-renderu) – czyść stan
    // ale tylko jeśli focus trafił na INNY element niż źródłowy
    const sameEl = (e.target.id && e.target.id === _tabState.srcId) ||
                   (e.target.name && e.target.name === _tabState.srcName);
    if (!sameEl) _tabState = null;
  }
}, true);

function _getFocusable(app) {
  return Array.from(app.querySelectorAll(
    'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(el => el.offsetParent !== null);
}

// ── Główna funkcja render() ───────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  if (!app) return;

  // Jeśli właśnie był TAB (w ciągu 150ms) – odrocz render żeby
  // przeglądarka mogła najpierw przenieść focus naturalnie.
  // Gdy render się wtedy odpali, wiemy dokąd focus powinien trafić.
  const tabEvent = (_tabState && Date.now() - _tabState.timestamp < 150)
    ? { ..._tabState } : null;

  if (tabEvent) {
    // Anuluj poprzedni odroczonny render
    if (_pendingRender) clearTimeout(_pendingRender);
    _pendingRender = setTimeout(() => {
      _pendingRender = null;
      _doRender(tabEvent);
    }, 50); // 50ms – wystarczy żeby przeglądarka zaktualizowała activeElement
    return;
  }

  _doRender(null);
}

function _doRender(tabEvent) {
  const app = document.getElementById('app');
  if (!app) return;

  // ── Zachowaj scroll przed re-renderem ────────────────────────────────────────
  const pageScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  const pageScrollX = window.scrollX || document.documentElement.scrollLeft || 0;

  const modalScrolls = [];
  app.querySelectorAll('.modal').forEach(el => modalScrolls.push(el.scrollTop));
  const overlayScrolls = [];
  app.querySelectorAll('.modal-overlay').forEach(el => overlayScrolls.push(el.scrollTop));

  // ── Zachowaj focus gdy NIE był TAB ───────────────────────────────────────────
  const activeEl = document.activeElement;
  let savedFocusId = null, savedFocusName = null;
  let savedSelStart = null, savedSelEnd = null;

  if (!tabEvent && activeEl && app.contains(activeEl)) {
    savedFocusId = activeEl.id || null;
    savedFocusName = activeEl.name || null;
    if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {
      try { savedSelStart = activeEl.selectionStart; savedSelEnd = activeEl.selectionEnd; } catch(e) {}
    }
  }

  // ── Pobierz pozycję kolejnego elementu po TAB przed re-renderem ───────────────
  let nextTargetId = null, nextTargetName = null, nextTargetIndex = -1;
  if (tabEvent) {
    const focusable = _getFocusable(app);
    let srcIdx = tabEvent.srcIndex;

    // Fallback – szukaj po id/name jeśli index się nie zgadza
    if (srcIdx < 0 || srcIdx >= focusable.length) {
      if (tabEvent.srcId) srcIdx = focusable.findIndex(el => el.id === tabEvent.srcId);
      if (srcIdx < 0 && tabEvent.srcName) srcIdx = focusable.findIndex(el => el.name === tabEvent.srcName);
    }

    if (srcIdx >= 0 && focusable.length > 1) {
      const nextIdx = tabEvent.shiftKey
        ? (srcIdx - 1 + focusable.length) % focusable.length
        : (srcIdx + 1) % focusable.length;
      const nextEl = focusable[nextIdx];
      if (nextEl) {
        nextTargetId = nextEl.id || null;
        nextTargetName = nextEl.name || null;
        nextTargetIndex = nextIdx;
      }
    }
    _tabState = null; // zużyty
  }

  // ── Re-render DOM ─────────────────────────────────────────────────────────────
  app.innerHTML = renderContent();

  // ── Przywróć scroll ───────────────────────────────────────────────────────────
  app.querySelectorAll('.modal').forEach((el, i) => { if (modalScrolls[i]) el.scrollTop = modalScrolls[i]; });
  app.querySelectorAll('.modal-overlay').forEach((el, i) => { if (overlayScrolls[i]) el.scrollTop = overlayScrolls[i]; });
  if (pageScrollY > 0 || pageScrollX > 0) window.scrollTo(pageScrollX, pageScrollY);

  // ── Przywróć / ustaw focus ────────────────────────────────────────────────────
  requestAnimationFrame(() => {
    if (tabEvent && (nextTargetId || nextTargetName || nextTargetIndex >= 0)) {
      // Był TAB → szukaj docelowego elementu po id lub name
      const focusable = _getFocusable(app);
      let el = null;
      if (nextTargetId) el = document.getElementById(nextTargetId);
      if (!el && nextTargetName) el = app.querySelector(`[name="${nextTargetName}"]`);
      if (!el && nextTargetIndex >= 0 && nextTargetIndex < focusable.length) {
        el = focusable[nextTargetIndex];
      }
      if (el && typeof el.focus === 'function') {
        el.focus({ preventScroll: true });
        // Zaznacz tekst w inputach dla szybszego edytowania
        if (el.tagName === 'INPUT' && el.type !== 'number' && el.type !== 'date') {
          try { el.select(); } catch(e) {}
        }
      }
    } else if (!tabEvent && (savedFocusId || savedFocusName)) {
      // Nie było TAB → wróć na ten sam element
      let el = null;
      if (savedFocusId) el = document.getElementById(savedFocusId);
      if (!el && savedFocusName) el = app.querySelector(`[name="${savedFocusName}"]`);
      if (el && typeof el.focus === 'function') {
        el.focus({ preventScroll: true });
        if (savedSelStart !== null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
          try { el.setSelectionRange(savedSelStart, savedSelEnd); } catch(e) {}
        }
      }
    }
  });
}
// ══════════════════════════════════════════════════════════════
