//  RENDER – główna funkcja renderująca aplikację
// ══════════════════════════════════════════════════════════════
function render() {
  const app = document.getElementById('app');
  if (!app) return;

  // ── Zachowaj pozycję scrolla modali przed re-renderem ────────────────────────
  // Gdy wizard/modal jest otwarty i użytkownik wpisuje coś w pole, zmiana stanu
  // (np. wybór węzła drzewa, wyszukiwanie materiału) wywołuje render() i modal
  // "skakał" na sam dół/górę. Zapamiętujemy scrollTop każdego .modal i
  // .modal-overlay, a po zastąpieniu innerHTML przywracamy je.
  const scrollSnapshot = [];
  app.querySelectorAll('.modal, .modal-overlay').forEach(el => {
    if (el.scrollTop > 0) scrollSnapshot.push({ sel: '#' + el.id || '.' + el.className.split(' ')[0], top: el.scrollTop });
  });
  // Zapamiętaj też po tagNAME+klasie (id może nie istnieć)
  const modalScrolls = [];
  app.querySelectorAll('.modal').forEach(el => modalScrolls.push(el.scrollTop));
  const overlayScrolls = [];
  app.querySelectorAll('.modal-overlay').forEach(el => overlayScrolls.push(el.scrollTop));

  app.innerHTML = renderContent();

  // ── Przywróć scroll ──────────────────────────────────────────────────────────
  app.querySelectorAll('.modal').forEach((el, i) => { if (modalScrolls[i]) el.scrollTop = modalScrolls[i]; });
  app.querySelectorAll('.modal-overlay').forEach((el, i) => { if (overlayScrolls[i]) el.scrollTop = overlayScrolls[i]; });
}
// ══════════════════════════════════════════════════════════════
