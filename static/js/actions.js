//  ACTIONS
// ══════════════════════════════════════════════════════════════
async function doLogin(username, password) {
  setState({loading:true, error:null});
  try {
    const user = await post('/api/login', {username, password});
    stopWHRefresh();
    // Zapisz token sesji do globalnej zmiennej (używanej przez HEADERS w config.js)
    if (user.token) {
      SESSION_TOKEN = user.token;
    }
    // Pobierz uprawnienia użytkownika
    let userTabs = [];
    try {
      const perm = await get('/api/users/' + user.id + '/permissions');
      userTabs = perm.tabs || [];
    } catch(e) { /* brak uprawnień = domyślne */ }
    const tab = defaultTabWithPerms(user.role, userTabs);
    setState({user, screen:'main', loading:false, activeTab:tab, currentUserTabs: userTabs});
    loadTabData(tab);
    startMagazynAutoRefresh();
    // ── Uruchom WebSocket (powiadomienia real-time) ──────────
    if (typeof wsInit === 'function') wsInit();
  } catch(e) {
    setState({loading:false, error:'Nieprawidłowy login lub hasło'});
  }
}

function defaultTab(role) {
  if (role === 'magazynier') return 'magazyn';
  if (role === 'majster')    return 'majster';
  if (role === 'admin')      return 'admin';
  return 'praca';
}

function defaultTabWithPerms(role, allowedTabs) {
  if (!allowedTabs || allowedTabs.length === 0) return defaultTab(role);
  const preferred = defaultTab(role);
  return allowedTabs.includes(preferred) ? preferred : allowedTabs[0];
}

// Stałe zakładki z opisami dla systemu uprawnień
const ALL_TABS_DEF = [
  {id:'praca',     label:'👷 Praca',     roles:['pracownik','majster','technolog','admin']},
  {id:'magazyn',   label:'📦 Magazyn',   roles:['magazynier','admin']},
  {id:'majster',   label:'🔧 Majster',   roles:['majster','admin']},
  {id:'zlecenia',  label:'📋 Zlecenia',  roles:['majster','admin','technolog']},
  {id:'drzewo',    label:'🌳 Drzewo G/P',roles:['majster','admin','technolog']},
  {id:'admin',     label:'⚙ Admin',      roles:['admin','technolog']},
  {id:'ustawienia',label:'🔩 Ustawienia',roles:['pracownik','majster','technolog','magazynier','admin']},
];

async function startSesja(operacjaId, opcje = {}) {
  // opcje: { rzeczywisteSt: string|null }
  try {
    // Sprawdź czy operacja ma już aktywne sesje
    const aktywne = await get('/api/sesje/aktywne_operacja/' + operacjaId);
    const cudzeSesje = aktywne.filter(s => s.user_id !== state.user.id);
    const mojaSesja  = aktywne.find(s => s.user_id === state.user.id);

    if (mojaSesja) {
      alert('Masz już aktywną sesję tej operacji.');
      return;
    }

    const sesjeOp = aktywne.filter(s => s.typ === 'operacja' || s.typ === 'inne_zlecenie');
    const sesjeZbr = aktywne.filter(s => s.typ === 'zbrojenie');

    // Jeśli trwa zbrojenie na tej operacji przez kogoś innego – blokada równoległa nie ma sensu
    if (sesjeZbr.length > 0 && sesjeOp.length === 0) {
      setState({kontynuacjaModal: {
        operacjaId,
        pracownik: sesjeZbr[0].full_name,
        sesjaGlownaId: null,
        aktywne: sesjeZbr,
        trwaZbrojenie: true
      }});
      return;
    }

    if (sesjeOp.length > 0) {
      // Operacja jest w toku → zapytaj o obróbkę równoległą na dwa stanowiska
      const op = state.qrZleceniePickerModal?.operacje?.find(o => o.id === operacjaId);
      setState({parallelModal: {
        operacjaId,
        stanowisko: op?.stanowisko || '—',
        aktywne: sesjeOp,
        rzeczywisteSt: opcje.rzeczywisteSt || null
      }});
      return;
    }

    // Brak innych sesji – sprawdź czy moje własne równoległe sesje istnieją
    const mojeAktywne = (state.aktywnesje || []).filter(s =>
      s.typ === 'operacja' || s.typ === 'inne_zlecenie'
    );

    if (mojeAktywne.length > 0) {
      // Już mam inne aktywne sesje → pytaj która jest główna
      setState({sesjaGlownaModal: {
        operacjaId,
        aktywne: mojeAktywne,
        nowaJestGlowna: null  // null = jeszcze nie wybrano
      }});
      return;
    }

    // Czysta sytuacja – start normalnej sesji głównej
    await _doStartSesja(operacjaId, 1);
  } catch(e) {
    alert('Błąd: ' + e.message);
  }
}

async function _doStartSesja(operacjaId, sesjaGlowna, rzeczywisteSt = null) {
  try {
    const body = {
      operacja_id: operacjaId,
      user_id: state.user.id,
      typ: 'operacja',
      sesja_glowna: sesjaGlowna
    };
    if (rzeczywisteSt) body.rzeczywiste_stanowisko = rzeczywisteSt;
    await post('/api/sesje/start', body);
    await loadPracownik();
  } catch(e) {
    if (e.message && e.message.startsWith('GLOWNA_ZAJETA:')) {
      const parts = e.message.split(':');
      const pracownik = parts[1] || '?';
      alert(`Sesja główna tej operacji jest już zajęta przez ${pracownik}. Operacja anulowana.`);
    } else {
      alert('Błąd: ' + e.message);
    }
  }
}

async function kontynuujOperacje(operacjaId, rzeczywisteSt = null) {
  // Pracownik potwierdził kontynuację – startuje jako sesja dodatkowa
  setState({kontynuacjaModal: null});
  const mojeAktywne = (state.aktywnesje || []).filter(s =>
    s.typ === 'operacja' || s.typ === 'inne_zlecenie'
  );
  if (mojeAktywne.length > 0) {
    setState({sesjaGlownaModal: {
      operacjaId,
      aktywne: mojeAktywne,
      nowaJestGlowna: null,
      rzeczywisteSt
    }});
  } else {
    await _doStartSesja(operacjaId, 0, rzeczywisteSt);
  }
}

async function potwierdzWyborGlownej(operacjaId, nowaJestGlowna) {
  const rzeczywisteSt = state.sesjaGlownaModal?.rzeczywisteSt || null;
  setState({sesjaGlownaModal: null});
  await _doStartSesja(operacjaId, nowaJestGlowna ? 1 : 0, rzeczywisteSt);
}

async function startZbrojenie(operacjaId) {
  try {
    await post('/api/sesje/start', {operacja_id:operacjaId, user_id:state.user.id, typ:'zbrojenie'});
    setState({qrZleceniePickerModal:null});
    await loadPracownik();
  } catch(e) {
    alert('Błąd: ' + e.message);
  }
}

async function startNieprodukcyjna(opis) {
  try {
    await post('/api/sesje/start', {user_id:state.user.id, typ:'nieprodukcyjna', opis_nieprodukcyjnej:opis});
    setState({nieprodukcyjnaModal:false});
    await loadPracownik();
  } catch(e) {
    alert('Błąd: ' + e.message);
  }
}

async function togglePauza(sesja) {
  try {
    const paused = isPaused(sesja);
    if (paused) {
      await post('/api/sesje/pauza/stop', {sesja_id:sesja.id});
    } else {
      await post('/api/sesje/pauza/start', {sesja_id:sesja.id, powod:''});
    }
    await loadPracownik();
  } catch(e) {
    alert('Błąd: ' + e.message);
  }
}

async function stopSesja(sesjaId, ilosc, uwagi) {
  const sesja = state.stopModal;
  const wasZbrojenie = sesja && sesja.typ === 'zbrojenie';
  const zbrojOpId = sesja && sesja.operacja_id;
  try {
    await post('/api/sesje/stop', {sesja_id:sesjaId, ilosc_sztuk:parseInt(ilosc)||0, uwagi:uwagi||''});
    setState({stopModal:null});
    await loadPracownik();
    // Po zakończeniu zbrojenia: odśwież dane operacji w otwartym QR modal
    if (wasZbrojenie && state.qrZleceniePickerModal) {
      const m = state.qrZleceniePickerModal;
      const zl = m.zlecenie;
      // Pobierz świeżą listę operacji i oznacz zbrojenie jako wykonane
      try {
        const ops = await get(`/api/zlecenia/${zl.id}/operacje`);
        // Uzupełnij zbrojenie_wykonane: jeśli op nie ma aktywnej sesji zbrojenia, a miała czas_zbrojenia_min, uznaj za wykonane
        const updatedOps = ops.map(op => ({
          ...op,
          zbrojenie_wykonane: op.id === zbrojOpId ? true : (op.zbrojenie_wykonane || false),
        }));
        setState({qrZleceniePickerModal: {...m, operacje: updatedOps}});
      } catch(e2) {}
    }
  } catch(e) {
    alert('Błąd: ' + e.message);
  }
}

function stopSesjaModal() {
  const s = state.stopModal;
  if (!s) return;
  const isZbrojenie = s.typ === 'zbrojenie';
  const isNieprod = s.typ === 'nieprodukcyjna';
  const ilosc = (isZbrojenie || isNieprod) ? 0 : (parseInt(document.getElementById('stop-ilosc')?.value)||0);
  const uwagi = document.getElementById('stop-uwagi')?.value || '';
  stopSesja(s.id, ilosc, uwagi);
}

function clearQRHistory() {
  localStorage.removeItem('qr_historia');
  setState({qrLastCodes: []});
}

async function wybierzZlecenieAktywne(zid) {
  const zl = (state.pracaZlecenia || []).find(z => String(z.id) === String(zid));
  if (!zl) return;
  if (zl.qr_code) {
    await scanQR(zl.qr_code);
    return;
  }
  // Brak qr_code – pobierz zlecenie i operacje bezpośrednio
  try {
    const [zlecenie, operacje] = await Promise.all([
      get('/api/zlecenia/' + zl.id),
      get('/api/zlecenia/' + zl.id + '/operacje'),
    ]);
    showQRResult({type: 'zlecenie', data: zlecenie, operacje: operacje || []});
  } catch(e) {
    alert('Błąd ładowania zlecenia: ' + e.message);
  }
}

async function scanQR(kod) {
  if (!kod.trim()) return;
  try {
    const res = await get('/api/scan/' + encodeURIComponent(kod.trim()));
    // dodaj do historii
    const hist = [kod.trim(), ...state.qrLastCodes.filter(c=>c!==kod.trim())].slice(0,10);
    setState({qrLastCodes: hist, qrScanMode:false});
    localStorage.setItem('qr_historia', JSON.stringify(hist));
    showQRResult(res);
  } catch(e) {
    alert('Nie znaleziono kodu QR: ' + kod);
  }
}

async function kjOcenOperacje(opId, wynik, opNazwa) {
  const label = wynik === 'zgodny' ? 'ZGODNY ✅' : 'NIEZGODNY ❌';
  if (!confirm(`Oznaczyć operację "${opNazwa}" jako ${label}?`)) return;
  try {
    await fetch((SERVER_URL.replace(/\/$/,'')) + '/api/operacje/' + opId + '/kj', {
      method: 'PATCH',
      headers: {'Content-Type':'application/json','x-api-key': API_KEY},
      body: JSON.stringify({
        wynik,
        uwagi: '',
        user_id: state.user?.id,
        user_name: state.user?.full_name,
      })
    });
    // Odśwież operacje w modalu
    const m = state.qrZleceniePickerModal;
    if (m?.zlecenie?.id) {
      try {
        const fresh = await get('/api/scan/' + encodeURIComponent(m.zlecenie.numer));
        if (fresh?.operacje) {
          setState({qrZleceniePickerModal: {...m, operacje: fresh.operacje}});
        }
      } catch(e) { /* ignoruj */ }
    }
    render();
  } catch(e) { alert('Błąd zapisu KJ: ' + e.message); }
}


function showQRResult(res) {
  if (res.type === 'operacja') {
    const op = res.data;
    setState({qrZleceniePickerModal: {
      zlecenie: {numer: op.zl_numer, nazwa: op.zl_nazwa, id: op.zlecenie_id, ilosc_sztuk: op.ilosc_sztuk, model_3d_url: op.zl_model3d_url || null, wyrob_model_3d_url: op.wyrob_model_3d_url || null},
      operacje: [op],
    }});
  } else if (res.type === 'zlecenie') {
    setState({qrZleceniePickerModal: {zlecenie: res.data, operacje: res.operacje}});
  }
}

function renderQRZleceniePickerModal() {
  const m = state.qrZleceniePickerModal;
  if (!m) return '';
  const z = m.zlecenie;
  const ops = m.operacje || [];

  // ── TRYB KJ: użytkownik z flagą is_kj widzi inny widok ─────────────────
  const isKJ = !!(state.user?.is_kj);
  if (isKJ) {
    const allOps = ops.filter(o => o.typ_operacji !== 'zbrojenie');
    let kjHtml = `
    <div class="modal-overlay">
      <div class="modal">
        <button class="modal-close" onclick="setState({qrZleceniePickerModal:null,kjModal:null})">×</button>
        <div style="background:rgba(52,152,219,0.12);border:1px solid #3498db55;border-radius:8px;padding:8px 14px;margin-bottom:12px;display:flex;align-items:center;gap:8px">
          <span style="font-size:18px">🔍</span>
          <div>
            <div style="font-size:12px;font-weight:700;color:#3498db">TRYB KONTROLI JAKOŚCI</div>
            <div style="font-size:11px;color:var(--dim)">${state.user.full_name}</div>
          </div>
        </div>
        <h3>📋 ${z.numer}</h3>
        <div style="color:var(--dim);font-size:13px;margin-bottom:14px">${z.nazwa||''}</div>`;
    if (!allOps.length) {
      kjHtml += `<div class="empty">Brak operacji w tym zleceniu</div>`;
    } else {
      kjHtml += `<div style="color:var(--dim);font-size:12px;margin-bottom:10px">Wybierz operację do oceny jakości:</div>`;
      allOps.forEach(op => {
        const kjDone = op.kj_wynik === 'zgodny' || op.kj_wynik === 'niezgodny';
        const kjColor = op.kj_wynik === 'zgodny' ? 'var(--green)' : op.kj_wynik === 'niezgodny' ? 'var(--red)' : 'var(--dim)';
        const kjIcon = op.kj_wynik === 'zgodny' ? '✅' : op.kj_wynik === 'niezgodny' ? '❌' : '';
        kjHtml += `
        <div class="card" style="padding:12px;margin-bottom:10px;border-color:${kjDone ? kjColor : 'var(--border)'}">
          <div style="font-weight:700;font-size:15px;margin-bottom:4px;display:flex;align-items:center;gap:8px">
            <span>${op.kolejnosc}. ${op.nazwa}</span>
            ${kjDone ? `<span title="Sprawdzone${op.kj_data?' ('+op.kj_data.substring(0,16)+')':''}">${kjIcon}</span>` : ''}
          </div>
          <div style="font-size:12px;color:var(--dim);margin-bottom:8px">${op.stanowisko||'—'}${op.czas_norma?' | norma: '+op.czas_norma+' min/szt':''}</div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-green" style="flex:1;font-size:14px;padding:10px"
              onclick="kjOcenOperacje(${op.id},'zgodny','${(op.nazwa||'').replace(/'/g,"\\'")}')">
              ✅ ZGODNY
            </button>
            <button class="btn btn-red" style="flex:1;font-size:14px;padding:10px"
              onclick="kjOcenOperacje(${op.id},'niezgodny','${(op.nazwa||'').replace(/'/g,"\\'")}')">
              ❌ NIEZGODNY
            </button>
          </div>
        </div>`;
      });
    }
    kjHtml += `
        <button class="btn btn-outline" style="margin-top:8px"
                onclick="setState({qrZleceniePickerModal:null})">Zamknij</button>
      </div>
    </div>`;
    return kjHtml;
  }
  // ── KONIEC TRYBU KJ ──────────────────────────────────────────────────────

  // Operacje typ='zbrojenie' są obsługiwane jako przycisk przy operacji produkcji
  const dostepne = ops.filter(o =>
    o.status !== 'zakonczone' && o.status !== 'anulowane' && o.typ_operacji !== 'zbrojenie'
  );
  // Zbuduj mapę: dla każdej op produkcji znajdź odpowiadające zbrojenie (po kolejnosc-1 lub stanowisku)
  const zbrojeniaMap = {};
  ops.filter(o => o.typ_operacji === 'zbrojenie').forEach(zbr => {
    // Przypisz do najbliższej kolejnej operacji produkcji
    const nastepna = ops
      .filter(o => o.typ_operacji !== 'zbrojenie' && o.kolejnosc > zbr.kolejnosc)
      .sort((a,b) => a.kolejnosc - b.kolejnosc)[0];
    if (nastepna) {
      if (!zbrojeniaMap[nastepna.id]) zbrojeniaMap[nastepna.id] = [];
      zbrojeniaMap[nastepna.id].push(zbr);
    }
  });
  // Oblicz ile sztuk pozostało do zrobienia
  const iloscTotal = z.ilosc_sztuk || 0;
  const iloscWykonana = ops.reduce((sum, op) => sum + (op.ilosc_wykonana||0), 0);
  const iloscPozostalo = Math.max(0, iloscTotal - (ops.length ? Math.min(...ops.map(op => op.ilosc_wykonana||0)) : 0));

  const stepUrlZl = z.model_3d_url || null;
  const stepUrlWyrob = (z.wyrob_model_3d_url && z.wyrob_model_3d_url !== stepUrlZl) ? z.wyrob_model_3d_url : null;

  let html = `
  <div class="modal-overlay">
    <div class="modal">
      <button class="modal-close" onclick="setState({qrZleceniePickerModal:null})">×</button>
      <h3>📋 ${z.numer}</h3>
      <div style="color:var(--dim);font-size:13px;margin-bottom:10px">${z.nazwa}</div>
      ${stepUrlWyrob ? `
      <button class="btn btn-blue" style="width:100%;margin-bottom:8px;font-size:14px"
              onclick="openStep3DViewer('${stepUrlWyrob.replace(/'/g,"\\'")}')">
        🧊 Podgląd modelu 3D wyrobu G/P (.STEP)
      </button>` : ''}
      ${stepUrlZl ? `
      <button class="btn btn-blue" style="width:100%;margin-bottom:8px;font-size:14px"
              onclick="openStep3DViewer('${stepUrlZl.replace(/'/g,"\\'")}')">
        🧊 Podgląd modelu 3D zlecenia (.STEP)
      </button>` : ''}
      <button class="btn" style="width:100%;margin-bottom:12px;font-size:13px;background:rgba(139,92,246,0.12);border:1px solid #8b5cf640;color:#a78bfa"
              onclick="uploadStepFromQR(${z.id})">
        📎 ${stepUrlZl ? 'Zmień plik STEP zlecenia' : 'Dodaj plik STEP (.step/.stp) do zlecenia'}
      </button>
      <div style="background:var(--entry);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:12px;color:var(--dim)">Zlecona ilość:</span>
          <span style="font-weight:700;font-size:16px;color:var(--text)">${iloscTotal} szt.</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:12px;color:var(--dim)">Do wykonania:</span>
          <span style="font-weight:700;font-size:20px;color:${iloscPozostalo===0?'var(--green)':'var(--accent)'}">${iloscPozostalo} szt.</span>
        </div>
      </div>`;
  if (!dostepne.length) {
    html += `<div class="empty">Brak dostępnych operacji do rozpoczęcia</div>`;
  } else {
    html += `<div style="color:var(--dim);font-size:12px;margin-bottom:10px">Wybierz operację:</div>`;
    dostepne.forEach(op => {
      const opWykonana = op.ilosc_wykonana || 0;
      const opPozostalo = Math.max(0, iloscTotal - opWykonana);
      const opProg = iloscTotal > 0 ? Math.min(100, Math.round(opWykonana / iloscTotal * 100)) : 0;
      const opZbrMin = op.czas_zbrojenia_min || 0;
      // Zbrojenia z nowego systemu (osobne operacje typ='zbrojenie') dla tej operacji produkcji
      const linkedZbrojenia = zbrojeniaMap[op.id] || [];
      // Sesja zbrojenia może być na op.id lub na zbrojeniu linked
      const linkedZbrIds = linkedZbrojenia.map(z => z.id);

      // Stan sesji dla tej operacji
      const sesjaOp = (state.aktywnesje||[]).find(s => s.operacja_id === op.id && s.typ === 'operacja');
      const sesjaZbr = (state.aktywnesje||[]).find(s =>
        (s.operacja_id === op.id || linkedZbrIds.includes(s.operacja_id)) && s.typ === 'zbrojenie'
      );
      const czyOpAktywna = !!sesjaOp;
      const czyZbrAktywne = !!sesjaZbr;

      // Czy zbrojenie zostało już wykonane (flaga z serwera)
      const zbrWykonane = !!op.zbrojenie_wykonane;

      html += `<div class="card" style="padding:12px;margin-bottom:10px">`;

      // Nagłówek operacji
      html += `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div style="flex:1">
            <div style="font-weight:700;font-size:15px">${op.kolejnosc}. ${op.nazwa}</div>
            <div style="font-size:12px;color:var(--dim)">${op.stanowisko||'—'}${op.czas_norma?' | norma: '+op.czas_norma+' min/szt':''}</div>
            <div style="font-size:12px;margin-top:4px">
              <span style="color:var(--dim)">Wykonano: </span>
              <span style="font-weight:600">${opWykonana}/${iloscTotal} szt.</span>
              ${opPozostalo > 0 ? `<span style="color:var(--accent);margin-left:6px">zostało: <b>${opPozostalo}</b></span>` : '<span style="color:var(--green);margin-left:6px">✅</span>'}
            </div>
            <div class="progress-wrap" style="height:4px;margin-top:6px"><div class="progress-bar" style="width:${opProg}%;background:${opProg>=100?'var(--green)':'var(--accent)'}"></div></div>
          </div>
        </div>`;

      // Przyciski akcji - zbrojenie pierwsze jeśli jest i nie zostało wykonane
      const hasZbrojenie = opZbrMin > 0 || linkedZbrojenia.length > 0;
      if (hasZbrojenie) {
        // ── Zbrojenie skonfigurowane: pokaż oba przyciski niezależnie ──────
        // Reguła: albo aktywne zbrojenie ALBO aktywna operacja – nigdy oba naraz
        if (czyZbrAktywne) {
          // Zbrojenie trwa → pokaż status + stop zbrojenia; operacja zablokowana
          html += `
          <div style="background:rgba(243,156,18,0.12);border:1px solid var(--orange);border-radius:8px;padding:8px 12px;margin-bottom:8px">
            <div style="font-size:12px;color:var(--orange);font-weight:700">⚙ Zbrojenie w toku (norma: ${opZbrMin} min)</div>
            <div style="font-size:11px;color:var(--dim);margin-top:2px">Zakończ zbrojenie, aby uruchomić operację</div>
          </div>
          <div style="display:flex;gap:8px;flex-direction:column">
            <button class="btn btn-red" onclick="setState({stopModal:${JSON.stringify(sesjaZbr).replace(/"/g,'&quot;')}})">⏹ Zakończ zbrojenie</button>
            <button class="btn btn-outline" style="opacity:0.35;cursor:not-allowed" disabled>▶ Uruchom operację (zbrojenie w toku)</button>
          </div>`;
        } else if (czyOpAktywna) {
          // Operacja trwa → pokaż status + stop operacji; zbrojenie zablokowane
          html += `
          <div style="background:rgba(39,174,96,0.1);border:1px solid var(--green);border-radius:8px;padding:8px 12px;margin-bottom:8px">
            <div style="font-size:12px;color:var(--green);font-weight:700">▶ Operacja w toku</div>
          </div>
          <div style="display:flex;gap:8px;flex-direction:column">
            <button class="btn btn-red" onclick="setState({stopModal:${JSON.stringify(sesjaOp).replace(/"/g,'&quot;')}})">⏹ Zakończ operację</button>
            <button class="btn btn-outline" style="opacity:0.35;cursor:not-allowed" disabled>⚙ Uruchom zbrojenie (operacja w toku)</button>
          </div>`;
        } else {
          // Nic nie aktywne → oba przyciski dostępne swobodnie
          const zbrMin = opZbrMin || (linkedZbrojenia[0]?.czas_zbrojenia_min || 0);
          const zbrOpId = linkedZbrojenia.length > 0 ? linkedZbrojenia[0].id : op.id;
          const zbrLabel = zbrWykonane
            ? `⚙ Zbrojenie ponownie (${zbrMin} min)`
            : `⚙ Uruchom zbrojenie (${zbrMin} min)`;
          html += `
          <div style="display:flex;gap:8px;flex-direction:column">
            <button class="btn btn-green" onclick="pickOperacjaFromQR(${op.id})">▶ Uruchom operację</button>
            <button class="btn btn-accent" style="background:var(--orange);color:#1a1f2e" onclick="startZbrojenie(${zbrOpId})">${zbrLabel}</button>
          </div>`;
        }
      } else {
        // Brak zbrojenia – sprawdź typ operacji
        const typOp = op.typ_operacji || 'produkcja';
        if (typOp === 'kj') {
          // Operacja KJ – przyciski Zgodny / Niezgodny
          const kjWynikPrev = op.kj_wynik;
          const kjDone = kjWynikPrev === 'zgodny' || kjWynikPrev === 'niezgodny';
          html += `
          <div style="background:rgba(52,152,219,0.08);border:1px solid #3498db;border-radius:8px;padding:10px 12px;margin-bottom:8px">
            <div style="font-size:12px;color:#2980b9;font-weight:700;margin-bottom:4px;display:flex;align-items:center;gap:6px">
              <span>🔍 KONTROLA JAKOŚCI</span>
              ${kjDone ? `<span title="Sprawdzone${op.kj_data?' ('+op.kj_data.substring(0,16)+')':''}">${kjWynikPrev==='zgodny'?'✅':'❌'}</span>` : ''}
            </div>
            ${op.parametry_kj ? renderKjParams(op.parametry_kj, 'font-size:11px;color:var(--dim)') : ''}
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-green" style="flex:1" onclick="setState({kjModal:{op:${JSON.stringify(op).replace(/"/g,'&quot;')},wynik:'zgodny'}})">
              ✅ ZGODNY
            </button>
            <button class="btn btn-red" style="flex:1" onclick="setState({kjModal:{op:${JSON.stringify(op).replace(/"/g,'&quot;')},wynik:'niezgodny'}})">
              ❌ NIEZGODNY
            </button>
          </div>`;
        } else if (typOp === 'kooperacja') {
          // Kooperacja – majster zatwierdza ręcznie
          const koop_done = op.status === 'zakonczona';
          html += `
          <div style="background:rgba(155,89,182,0.08);border:1px solid #9b59b6;border-radius:8px;padding:10px 12px">
            <div style="font-size:12px;color:#8e44ad;font-weight:700">🤝 KOOPERACJA</div>
            <div style="font-size:11px;color:var(--dim);margin:4px 0">${op.opis_czynnosci||''}</div>
            ${koop_done
              ? `<div style="color:var(--green);font-size:12px">✅ Wykonane</div>`
              : `<button class="btn btn-accent" style="background:#9b59b6;color:#fff;margin-top:8px" onclick="majsterZatwierdzKooperacje(${op.id})">✅ Zatwierdź wykonanie kooperacji</button>`
            }
          </div>`;
        } else {
          if (czyOpAktywna) {
            html += `<div class="btn-row">
              <button class="btn btn-red" onclick="setState({stopModal:${JSON.stringify(sesjaOp).replace(/"/g,'&quot;')}})">⏹ Zakończ operację</button>
            </div>`;
          } else {
            html += `<button class="btn btn-green" onclick="pickOperacjaFromQR(${op.id})">▶ Uruchom operację</button>`;
          }
        }
      }

      html += `</div>`;
    });
  }
  // Opcja INNE
  if (!state.qrInneMode) {
    html += `
    <div class="card" style="padding:12px;margin-bottom:8px;cursor:pointer;border-color:var(--accent)"
         onclick="setState({qrInneMode:true})">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:600;color:var(--accent)">⚡ Inne</div>
          <div style="font-size:12px;color:var(--dim)">Wpisz co robisz i rozpocznij rejestrację</div>
        </div>
        <span style="font-size:20px">+</span>
      </div>
    </div>`;
  } else {
    html += `
    <div class="card" style="padding:12px;margin-bottom:8px;border-color:var(--accent)">
      <div style="font-weight:600;color:var(--accent);margin-bottom:10px">⚡ Inne – wpisz co robisz</div>
      <div class="field" style="margin-bottom:10px">
        <input id="qr-inne-opis" type="text" placeholder="Np. ustawianie maszyny, regulacja..."
               onkeydown="if(event.key==='Enter')startQRInne()">
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-accent" onclick="startQRInne()">▶ Start</button>
        <button class="btn btn-outline" onclick="setState({qrInneMode:false})">Anuluj</button>
      </div>
    </div>`;
  }

  html += `
      <button class="btn btn-outline" style="margin-top:8px"
              onclick="setState({qrZleceniePickerModal:null,qrInneMode:false})">Zamknij</button>
    </div>
  </div>`;
  return html;
}

// INNE – sesja produkcyjna przypisana do zlecenia
async function startQRInne() {
  const opis = document.getElementById('qr-inne-opis')?.value?.trim();
  if (!opis) { alert('Wpisz opis'); return; }
  const m = state.qrZleceniePickerModal;
  const zid = m?.zlecenie?.id || null;
  setState({qrZleceniePickerModal:null, qrInneMode:false});
  try {
    const body = {user_id: state.user.id, typ: 'nieprodukcyjna', opis_nieprodukcyjnej: opis};
    if (zid) { body.typ = 'inne_zlecenie'; body.zlecenie_id_inne = zid; }
    await post('/api/sesje/start', body);
    await loadPracownik();
  } catch(e) { alert('Błąd: ' + (e.message||e)); }
}

function statusBadge_txt(s) {
  const m = {nowe:'Nowe', w_toku:'W toku', zakonczone:'Zakończone', oczekuje:'Oczekuje', anulowane:'Anulowane', wstrzymane:'Wstrzymane', oczekuje_potwierdzenia:'⏳ Oczekuje potwierdzenia'};
  return m[s]||s;
}

const FREZARKI = ['frezarka','vmc','mazak','wytaczarka','centrum obróbcze','frezarki'];
const TOKARKI  = ['tokarka','tokarki'];

// Mapa typ_maszyny → kategoria (dla alternatyw w pickOperacjaFromQR)
const TYP_DO_KATEGORII = {
  'frezarka_cnc':    'frezarka',
  'tokarka_cnc':     'tokarka',
  'frezarka_konw':   'frezarka',
  'tokarka_konw':    'tokarka',
  'szlifierka':      'szlifierka',
  'operacja':        'operacja',
};

function _kategoriaMaszyny(stanowisko) {
  // Sprawdź najpierw czy stawka ma przypisany typ_maszyny (nowy system)
  const stawki = state.stawki || [];
  const stawka = stawki.find(s => s.stanowisko === stanowisko);
  if (stawka && stawka.typ_maszyny && TYP_DO_KATEGORII[stawka.typ_maszyny]) {
    return TYP_DO_KATEGORII[stawka.typ_maszyny];
  }
  // Fallback: rozpoznawanie po nazwie (stary system)
  if (!stanowisko) return null;
  const s = stanowisko.toLowerCase();
  if (FREZARKI.some(k => s.includes(k))) return 'frezarka';
  if (TOKARKI.some(k => s.includes(k))) return 'tokarka';
  return null;
}

async function pickOperacjaFromQR(opId) {
  const op = state.qrZleceniePickerModal?.operacje?.find(o => o.id === opId);
  if (!op) { setState({qrZleceniePickerModal:null}); await startSesja(opId); return; }

  try {
    // Zawsze pobierz świeże stawki z API (state.stawki może być puste w zakładce Praca)
    const stawki = await get('/api/stawki');

    // Znajdź stawkę dla maszyny docelowej
    const stawkaOryginal = stawki.find(s => s.stanowisko === op.stanowisko);
    const typMaszyny = stawkaOryginal ? stawkaOryginal.typ_maszyny : null;

    if (!typMaszyny) {
      // Brak typu maszyny → start bez wyboru
      setState({qrZleceniePickerModal:null});
      await startSesja(opId);
      return;
    }

    // Wszystkie stawki z tym samym typem maszyny (włącznie z docelową)
    const lista = stawki
      .filter(s => s.typ_maszyny === typMaszyny)
      .map(s => s.stanowisko);

    // Jeśli tylko jedna maszyna tego typu → start bez wyboru
    if (lista.length <= 1) {
      setState({qrZleceniePickerModal:null});
      await startSesja(opId);
      return;
    }

    setState({
      qrZleceniePickerModal: null,
      zmianaMaszynyModal: {
        operacjaId: opId,
        stanowiskoOryginalne: op.stanowisko,
        typMaszyny: typMaszyny,
        stanowiskoLista: lista
      }
    });
  } catch(e) {
    setState({qrZleceniePickerModal:null});
    await startSesja(opId);
  }
}

async function zmianaMaszynyPotwierdzenie(operacjaId, innaM) {
  // innaM = null → docelowa maszyna; string → inna maszyna
  setState({zmianaMaszynyModal: null});
  await startSesja(operacjaId, { rzeczywisteSt: innaM });
}

async function potwierdzRownolegle(operacjaId, rzeczywisteSt) {
  setState({parallelModal: null});
  // Sprawdź własne aktywne sesje → wybór głównej
  const mojeAktywne = (state.aktywnesje || []).filter(s =>
    s.typ === 'operacja' || s.typ === 'inne_zlecenie'
  );
  if (mojeAktywne.length > 0) {
    setState({sesjaGlownaModal: {
      operacjaId,
      aktywne: mojeAktywne,
      nowaJestGlowna: null,
      rzeczywisteSt: rzeczywisteSt || null
    }});
  } else {
    await _doStartSesja(operacjaId, 1, rzeczywisteSt || null);
  }
}

function loadTabData(tab) {
  if (tab==='praca')    loadPracownik();
  if (tab==='majster')  loadMajster();
  if (tab==='magazyn')  {
    loadMagazynier();
    loadMagazynBraki();
    loadRezerwacjeZSerwera();
    setState({magazynLastRefresh: new Date().toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})}, true);
  }
  if (tab==='zlecenia') { loadZlecenia(); get('/api/stawki').then(d=>setState({stawki:d},true)).catch(()=>{}); }
  if (tab==='drzewo')   loadDrzewoGP();
  if (tab==='admin')    loadAdmin();
}

function switchTab(tab) {
  setState({activeTab:tab, error:null});
  loadTabData(tab);
  // Przy wejściu na magazyn – natychmiast odśwież dane i ikony braki
  if (tab === 'magazyn') {
    setState({magazynLastRefresh: new Date().toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})}, true);
  }
}

function logout() {
  // Modal potwierdzenia dla magazyniera
  if (state.user?.role === 'magazynier' && state.transportOps.length > 0) {
    const n = state.transportOps.length;
    if (!confirm(`⚠ Uwaga!\n\nMasz ${n} operacji czekających na transport.\nCzy na pewno chcesz się wylogować?`)) return;
  }
  stopAllTimers();
  if (typeof wsDisconnect === 'function') wsDisconnect();
  // Unieważnij sesję na serwerze
  if (SESSION_TOKEN) {
    post('/api/logout', {}).catch(() => {});
    SESSION_TOKEN = '';
  }
  setState({user:null, screen:'login', aktywnesje:[], operacje:[], timers:{}});
}

// ══════════════════════════════════════════════════════════════
