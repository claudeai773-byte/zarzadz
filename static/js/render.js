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

  app.innerHTML = renderContent();

  // ── Przywróć scroll ──────────────────────────────────────────────────────────
  app.querySelectorAll('.modal').forEach((el, i) => { if (modalScrolls[i]) el.scrollTop = modalScrolls[i]; });
  app.querySelectorAll('.modal-overlay').forEach((el, i) => { if (overlayScrolls[i]) el.scrollTop = overlayScrolls[i]; });

  // Przywróć scroll strony (zapobiega skokowi do góry przy każdym render())
  if (pageScrollY > 0 || pageScrollX > 0) {
    window.scrollTo(pageScrollX, pageScrollY);
  }
}
// ══════════════════════════════════════════════════════════════
