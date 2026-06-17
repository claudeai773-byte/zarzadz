//  RENDER – główna funkcja renderująca aplikację
// ══════════════════════════════════════════════════════════════

// ── Globalny tracker ostatniego naciśnięcia TAB ──────────────────────────────
// Gdy użytkownik wciska TAB w inpucie, onchange odpala się PRZED przeniesieniem
// focusu. Musimy wiedzieć: "czy właśnie był TAB?" i jeśli tak – przenieść focus
// na kolejny element, a nie przywrócić na bieżący.
let _lastTabEvent = null; // { shiftKey, sourceId, sourceIndex, timestamp }

document.addEventListener('keydown', function(e) {
  if (e.key !== 'Tab') return;
  const active = document.activeElement;
  if (!active) return;
  const app = document.getElementById('app');
  if (!app || !app.contains(active)) return;

  // Zbierz wszystkie focusowalne elementy w app (poza ukrytymi/disabled)
  const focusable = Array.from(app.querySelectorAll(
    'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(el => el.offsetParent !== null);

  const idx = focusable.indexOf(active);
  _lastTabEvent = {
    shiftKey: e.shiftKey,
    sourceId: active.id || null,
    sourceName: active.name || null,
    sourceIndex: idx,
    focusableCount: focusable.length,
    timestamp: Date.now()
  };
}, true); // capture – przed innymi handlerami

// ── Helper: znajdź focusowalne elementy w app ─────────────────────────────────
function _getFocusable(app) {
  return Array.from(app.querySelectorAll(
    'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(el => el.offsetParent !== null);
}

function render() {
  const app = document.getElementById('app');
  if (!app) return;

  // ── Zachowaj pozycję scrolla strony i modali przed re-renderem ───────────────
  const pageScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  const pageScrollX = window.scrollX || document.documentElement.scrollLeft || 0;

  const modalScrolls = [];
  app.querySelectorAll('.modal').forEach(el => modalScrolls.push(el.scrollTop));
  const overlayScrolls = [];
  app.querySelectorAll('.modal-overlay').forEach(el => overlayScrolls.push(el.scrollTop));

  // ── Zapamiętaj czy właśnie był TAB (świeży – max 200ms temu) ─────────────────
  const tabEvent = (_lastTabEvent && Date.now() - _lastTabEvent.timestamp < 200)
    ? _lastTabEvent : null;

  // ── Zachowaj focus aktywnego elementu (gdy NIE było TAB) ─────────────────────
  const activeEl = document.activeElement;
  let savedFocusId = null;
  let savedFocusName = null;
  let savedSelStart = null;
  let savedSelEnd = null;
  if (!tabEvent && activeEl && app.contains(activeEl)) {
    savedFocusId = activeEl.id || null;
    savedFocusName = activeEl.name || null;
    if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {
      try { savedSelStart = activeEl.selectionStart; savedSelEnd = activeEl.selectionEnd; } catch(e) {}
    }
  }

  app.innerHTML = renderContent();

  // ── Przywróć scroll ──────────────────────────────────────────────────────────
  app.querySelectorAll('.modal').forEach((el, i) => { if (modalScrolls[i]) el.scrollTop = modalScrolls[i]; });
  app.querySelectorAll('.modal-overlay').forEach((el, i) => { if (overlayScrolls[i]) el.scrollTop = overlayScrolls[i]; });

  if (pageScrollY > 0 || pageScrollX > 0) {
    window.scrollTo(pageScrollX, pageScrollY);
  }

  // ── Przywróć focus ────────────────────────────────────────────────────────────
  requestAnimationFrame(() => {
    if (tabEvent) {
      // Był TAB → przenieś focus na następny/poprzedni element
      const focusable = _getFocusable(app);
      if (focusable.length === 0) return;

      // Spróbuj znaleźć element źródłowy po id lub name
      let srcIdx = tabEvent.sourceIndex;
      if (srcIdx < 0 || srcIdx >= focusable.length) {
        // Fallback: szukaj po id/name
        if (tabEvent.sourceId) {
          const src = focusable.findIndex(el => el.id === tabEvent.sourceId);
          if (src !== -1) srcIdx = src;
        }
        if (srcIdx < 0 && tabEvent.sourceName) {
          const src = focusable.findIndex(el => el.name === tabEvent.sourceName);
          if (src !== -1) srcIdx = src;
        }
      }

      let nextIdx;
      if (tabEvent.shiftKey) {
        nextIdx = (srcIdx - 1 + focusable.length) % focusable.length;
      } else {
        nextIdx = (srcIdx + 1) % focusable.length;
      }

      const next = focusable[nextIdx];
      if (next && typeof next.focus === 'function') {
        next.focus({ preventScroll: true });
      }
      _lastTabEvent = null; // zużyty
    } else if (savedFocusId || savedFocusName) {
      // Nie było TAB → przywróć focus na ten sam element
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
