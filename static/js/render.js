//  RENDER – główna funkcja renderująca aplikację
// ══════════════════════════════════════════════════════════════
function render() {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = renderContent();
}
// ══════════════════════════════════════════════════════════════
