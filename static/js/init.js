//  INIT
// ══════════════════════════════════════════════════════════════
// Wczytaj historię QR
state.qrLastCodes = JSON.parse(localStorage.getItem('qr_historia')||'[]');

// Załaduj info produkcji na ekran logowania
let _wh_interval = null;
async function loadWarehouseLoginInfo() {
  if (!SERVER_URL || !API_KEY) return;
  try {
    const data = await get('/api/status/produkcja');
    setState({warehouseInfo: data}, true);
    render();
  } catch(e) {
    try {
      const ops = await get('/api/operacje/zakonczone-do-transportu');
      setState({warehouseInfo: {zakonczone: ops, aktywne:[], nastepne:[], next_map:{}}}, true);
      render();
    } catch(_) {}
  }
}
function startWHRefresh() {
  loadWarehouseLoginInfo();
  if (_wh_interval) clearInterval(_wh_interval);
  _wh_interval = setInterval(loadWarehouseLoginInfo, 120000);
}
function stopWHRefresh() {
  if (_wh_interval) { clearInterval(_wh_interval); _wh_interval = null; }
}
if (SERVER_URL) startWHRefresh();
if (SERVER_URL && API_KEY) startServerResetMonitor();

// Auto-refresh co 30s
setInterval(() => {
  if (state.screen === 'main' && !state.loading) {
    if (state.activeTab === 'majster') loadMajster();
  }
}, 30000);

// ── Auto-odświeżanie magazynu co 60s ──────────────────────────
let _magazynRefreshInterval = null;

function startMagazynAutoRefresh() {
  if (_magazynRefreshInterval) clearInterval(_magazynRefreshInterval);
  _magazynRefreshInterval = setInterval(async () => {
    if (state.screen !== 'main' || state.activeTab !== 'magazyn') return;
    const subTab = state.magazynSubTab || 'transport';
    const teraz = new Date().toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'});
    // Transport – odśwież operacje
    if (subTab === 'transport') {
      try {
        const ops = await get('/api/operacje/zakonczone-do-transportu');
        setState({transportOps: ops, magazynLastRefresh: teraz}, true);
        render();
      } catch(_) {}
    }
    // Zapotrzebowanie – odśwież dane BOM
    if (subTab === 'zapotrzebowanie') {
      setState({magazynLastRefresh: teraz}, true);
      await loadMagazynZapotrzebowanie();
    }
    // Rezerwacje – synchronizuj z serwera
    if (subTab === 'rezerwacje') {
      setState({magazynLastRefresh: teraz}, true);
      await loadRezerwacjeZSerwera();
      render();
    }
    // Materiały – odśwież wyniki wyszukiwania jeśli było zapytanie
    if (subTab === 'materialy' && state.magazynMatSearch) {
      setState({magazynLastRefresh: teraz}, true);
      await loadMagazynMaterialySearch();
    }
    // Zawsze sprawdź braki (dla ikony !)
    await loadMagazynBraki();
  }, 60000);
}

// ── Synchronizacja rezerwacji z serwera (przy starcie i odświeżeniu) ──────────
async function backupRezerwacjeDoSerwera() {
  // Zachowane dla kompatybilności – teraz ładujemy z serwera zamiast pushować
  await loadRezerwacjeZSerwera();
}

// Odświeżaj rezerwacje z serwera co 2 minuty
setInterval(() => {
  if (state.screen === 'main') loadRezerwacjeZSerwera();
}, 2 * 60 * 1000);


render();

// ══════════════════════════════════════════════════════════════
