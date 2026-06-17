//  RENDER – główna funkcja renderująca aplikację
// ══════════════════════════════════════════════════════════════
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

  // ── Zachowaj focus i wartość aktywnego inputa (fix: TAB po wpisaniu tekstu) ──
  const activeEl = document.activeElement;
  let savedFocusId = null;
  let savedFocusName = null;
  let savedFocusType = null;
  let savedFocusValue = null;
  let savedSelStart = null;
  let savedSelEnd = null;
  if (activeEl && app.contains(activeEl)) {
    savedFocusId = activeEl.id || null;
    savedFocusName = activeEl.name || null;
    savedFocusType = activeEl.tagName + (activeEl.type ? ':' + activeEl.type : '');
    if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {
      savedFocusValue = activeEl.value;
      try { savedSelStart = activeEl.selectionStart; savedSelEnd = activeEl.selectionEnd; } catch(e) {}
    }
  }

  app.innerHTML = renderContent();

  // ── Przywróć scroll ──────────────────────────────────────────────────────────
  app.querySelectorAll('.modal').forEach((el, i) => { if (modalScrolls[i]) el.scrollTop = modalScrolls[i]; });
  app.querySelectorAll('.modal-overlay').forEach((el, i) => { if (overlayScrolls[i]) el.scrollTop = overlayScrolls[i]; });

  // Przywróć scroll strony (zapobiega skokowi do góry przy każdym render())
  if (pageScrollY > 0 || pageScrollX > 0) {
    window.scrollTo(pageScrollX, pageScrollY);
  }

  // ── Przywróć focus na aktywny element po re-renderze ────────────────────────
  if (savedFocusId || savedFocusName) {
    requestAnimationFrame(() => {
      let el = null;
      if (savedFocusId) el = document.getElementById(savedFocusId);
      if (!el && savedFocusName) el = app.querySelector(`[name="${savedFocusName}"]`);
      if (el && typeof el.focus === 'function') {
        el.focus({ preventScroll: true });
        // Przywróć pozycję kursora w polach tekstowych
        if (savedSelStart !== null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
          try { el.setSelectionRange(savedSelStart, savedSelEnd); } catch(e) {}
        }
      }
    });
  }
}
// ══════════════════════════════════════════════════════════════
