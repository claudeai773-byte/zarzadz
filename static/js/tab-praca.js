//  TAB: PRACA
// ══════════════════════════════════════════════════════════════
function renderPraca() {
  if (state.loading) return '<div class="spinner">⏳</div>';

  const subTabs = [{id:'praca',label:'🔧 Praca'},{id:'wydajnosc',label:'📊 Wydajność'}];
  let html = `
  <div class="sub-tabs">
    ${subTabs.map(t => `<button class="sub-tab ${state.pracaSubTab===t.id?'active':''}"
      onclick="switchPracaTab('${t.id}')">${t.label}</button>`).join('')}
  </div>`;

  if (state.pracaSubTab === 'wydajnosc') return html + renderPracaWydajnosc();
  return html + renderPracaGlowna();
}

function switchPracaTab(tab) {
  setState({pracaSubTab: tab}, true);
  if (tab === 'wydajnosc' && !state.pracaWydajnosc) {
    loadPracownikWydajnosc(state.pracaWydOkres);
  }
  render();
}

function renderPracaWydajnosc() {
  const w = state.pracaWydajnosc;
  const okres = state.pracaWydOkres;
  const okresLabels = {dzis:'Dziś', tydzien:'7 dni', miesiac:'30 dni'};

  let html = `
  <div class="chip-row">
    ${Object.entries(okresLabels).map(([k,v]) =>
      `<div class="chip ${okres===k?'active':''}" onclick="loadPracownikWydajnosc('${k}')">${v}</div>`
    ).join('')}
  </div>`;

  if (!w) {
    html += `<div class="empty">⏳ Ładowanie wydajności...</div>`;
    return html;
  }

  const wydPct = (w.norma_wydajnosc_pct !== null && w.norma_wydajnosc_pct !== undefined)
    ? w.norma_wydajnosc_pct
    : (w.normy_total > 0 ? Math.round(w.normy_ok/w.normy_total*100) : null);
  const barColor = wydPct === null ? 'var(--dim)' : wydPct >= 90 ? 'var(--green)' : wydPct >= 70 ? 'var(--orange)' : 'var(--red)';

  html += `
  <div class="stats-grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:14px">
    <div class="stat-box"><div class="stat-val">${w.sesji}</div><div class="stat-lbl">Sesji</div></div>
    <div class="stat-box"><div class="stat-val">${w.sztuki}</div><div class="stat-lbl">Sztuk</div></div>
    <div class="stat-box"><div class="stat-val">${w.godz}h</div><div class="stat-lbl">Godz.</div></div>
  </div>`;

  if (wydPct !== null) {
    html += `
    <div class="card" style="margin-bottom:14px;border-color:${barColor}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:13px;color:var(--dim)">Realizacja norm (${w.normy_ok}/${w.normy_total})</span>
        <span style="font-weight:700;color:${barColor};font-size:18px">${wydPct}%</span>
      </div>
      <div class="wyd-bar-wrap"><div class="wyd-bar" style="width:${wydPct}%;background:${barColor}"></div></div>
    </div>`;
  }

  html += `<div class="section-hdr">Historia sesji (${w.sesje.length})</div>`;
  if (!w.sesje.length) {
    html += `<div class="empty">Brak danych za wybrany okres</div>`;
  } else {
    w.sesje.forEach(s => {
      const wPct = s.wyd_pct;
      const wColor = wPct===null ? 'var(--dim)' : wPct>=90 ? 'var(--green)' : wPct>=70 ? 'var(--orange)' : 'var(--red)';
      const sztuk = s.ilosc_sztuk || 1;
      const avgMin = sztuk > 0 ? (s.czas_min / sztuk).toFixed(1) : s.czas_min;
      html += `
      <div class="card" style="padding:10px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px">${s.op_nazwa}</div>
            <div style="font-size:11px;color:var(--accent)">📋 ${s.zl_numer}${s.zl_nazwa && s.zl_nazwa!==s.zl_numer ? ' – '+s.zl_nazwa : ''}</div>
            <div style="font-size:11px;color:var(--dim)">🏭 ${s.stanowisko||'—'} | 📅 ${s.data||s.end_time?.substring(0,10)||'—'}</div>
            <div style="font-size:11px;color:var(--dim);margin-top:2px">
              ⏱ ${avgMin} min/szt.${s.norma_min ? ' | norma: '+s.norma_min+' min' : ''} | 📦 ${sztuk} szt.
            </div>
          </div>
          ${wPct !== null ? `
          <div style="text-align:right;margin-left:8px">
            <div style="font-weight:700;font-size:18px;color:${wColor}">${wPct}%</div>
            <div style="font-size:10px;color:var(--dim)">normy</div>
          </div>` : ''}
        </div>
        ${wPct !== null ? `
        <div class="wyd-bar-wrap" style="margin-top:6px">
          <div class="wyd-bar" style="width:${Math.min(100,wPct)}%;background:${wColor}"></div>
        </div>` : ''}
      </div>`;
    });
  }

  html += `<button class="btn-outline" style="margin-top:8px" onclick="loadPracownikWydajnosc()">🔄 Odśwież</button>`;
  return html;
}

function renderPracaGlowna() {
  let html = '';

  // QR skaner
  if (state.qrScanMode) {
    const hist = JSON.parse(localStorage.getItem('qr_historia')||'[]');
    const hasCameraAPI = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    html += `
    <div class="card" style="border-color:var(--blue)">
      <div class="section-hdr" style="margin-bottom:12px">📷 Skaner QR</div>`;
    if (hasCameraAPI && !state.qrManualMode) {
      html += `
      <video id="qr-video" style="width:100%;border-radius:8px;background:#000;display:block" playsinline autoplay muted></video>
      <canvas id="qr-cam-canvas" style="display:none"></canvas>
      <div id="qr-scan-status" style="text-align:center;color:var(--dim);font-size:13px;padding:6px">Uruchamiam aparat...</div>
      <button class="btn btn-outline" style="margin-top:6px" onclick="setState({qrManualMode:true})">⌨ Wpisz ręcznie</button>`;
    } else {
      html += `
      <div class="field" style="margin-bottom:10px;display:flex;gap:6px">
        <input id="qr-input" type="text" placeholder="Wpisz kod QR i naciśnij Enter" style="flex:1"
               autofocus onkeydown="if(event.key==='Enter')scanQR(this.value)">
        <button class="btn btn-accent" onclick="scanQR(document.getElementById('qr-input').value)">▶</button>
      </div>
      ${hasCameraAPI ? '<button class="btn btn-outline" style="margin-bottom:8px" onclick="setState({qrManualMode:false})">📷 Użyj aparatu</button>' : ''}`;
    }
    html += `
      ${hist.length ? `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <div class="section-hdr" style="margin-bottom:0">Historia QR</div>
        <button class="btn-sm btn-red" onclick="clearQRHistory()" style="font-size:11px">🗑 Wyczyść</button>
      </div>
      <div style="margin-top:8px">
      ${hist.map(c => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
          <span class="tag">${c}</span>
          <button class="btn-sm btn-blue" onclick="scanQR('${c}')">Użyj</button>
        </div>`).join('')}
      </div>
      ` : ''}
      <button class="btn btn-outline" style="margin-top:10px"
              onclick="stopQRCamera();setState({qrScanMode:false,qrManualMode:false})">✕ Zamknij</button>
    </div>`;
  } else {
    const zlList = state.pracaZlecenia || [];
    html += `
    <div class="btn-row" style="margin-bottom:12px">
      <button class="btn btn-blue" onclick="setState({qrScanMode:true,qrManualMode:false})">📷 Skanuj QR</button>
      <button class="btn btn-purple" onclick="setState({nieprodukcyjnaModal:true})">⏸ Nieprodukcyjna</button>
    </div>
    <div class="field" style="margin-bottom:12px">
      <label>Lub wybierz aktywne zlecenie z listy</label>
      <select id="praca-zlecenie-select" onchange="if(this.value)wybierzZlecenieAktywne(this.value);this.value=''">
        <option value="">— wybierz zlecenie —</option>
        ${zlList.map(z => `<option value="${z.id}">${z.numer}${z.nazwa ? ' – ' + z.nazwa : ''}</option>`).join('')}
      </select>
      ${!zlList.length ? '<div style="color:var(--dim);font-size:12px;margin-top:4px">Brak aktywnych zleceń</div>' : ''}
    </div>`;
  }

  // Aktywne sesje (wielokrotne)
  if (state.aktywnesje.length) {
    html += `<div class="section-hdr">⏱ Aktywne sesje (${state.aktywnesje.length})</div>`;
    state.aktywnesje.forEach(sesja => {
      const paused = isPaused(sesja);
      const isNieprod = sesja.typ === 'nieprodukcyjna';
      const isZbrojenie = sesja.typ === 'zbrojenie';
      const cardStyle = isZbrojenie
        ? 'background:linear-gradient(135deg,#2e2a1a,#2a2510);border:2px solid var(--orange)'
        : (isNieprod ? '' : '');
      const isGlowna = sesja.sesja_glowna === 1 || sesja.sesja_glowna === undefined;
      const labelTxt = isZbrojenie ? '⚙ ZBROJENIE' : (isNieprod ? '⏸ PRACA NIEPRODUKCYJNA' : (paused ? '⏸ PAUZA' : (isGlowna ? '⏱ GŁÓWNA' : '⏱ DODATKOWA')));
      const timerColor = isZbrojenie ? 'var(--orange)' : (paused ? 'var(--orange)' : 'var(--green)');
      html += `
      <div class="timer-card ${paused?'paused':''} ${isNieprod?'nieprodukcyjna-card':''}" ${cardStyle?`style="${cardStyle}"`:''}> 
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div class="timer-label" style="${isZbrojenie ? 'color:var(--orange)' : (!isGlowna ? 'color:var(--dim)' : '')}">${labelTxt}</div>
          ${(!isNieprod && !isZbrojenie) ? '<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:' + (isGlowna ? 'rgba(39,174,96,0.2)' : 'rgba(255,165,0,0.15)') + ';color:' + (isGlowna ? 'var(--green)' : 'var(--orange)') + '">' + (isGlowna ? '⭐ Główna' : '➕ Dodatkowa') + '</span>' : ''}
        </div>
        <div class="timer-display" id="timer-${sesja.id}" style="color:${timerColor}">00:00:00</div>
        <div class="timer-op">${sesja.op_nazwa || sesja.uwagi || '—'}</div>
        ${sesja.zl_numer ? `<div class="timer-zl">📋 ${sesja.zl_numer} – ${sesja.zl_nazwa}</div>` : ''}
        <div style="color:var(--dim);font-size:12px;margin:4px 0 8px">${sesja.stanowisko||''}</div>
        ${(!isNieprod && !isZbrojenie) ? renderNormaBar(sesja) : ''}
        <div class="btn-row">
          ${!isNieprod && !isZbrojenie ? `<button class="btn ${paused?'btn-green':'btn-accent'}" onclick="togglePauza(${JSON.stringify(sesja).replace(/"/g,'&quot;')})">
            ${paused ? '▶ Wznów' : '⏸ Pauza'}
          </button>` : ''}
          <button class="btn btn-red" onclick="setState({stopModal:${JSON.stringify(sesja).replace(/"/g,'&quot;')}})">
            ⏹ Zakończ ${isZbrojenie?'zbrojenie':''}
          </button>
        </div>
        ${sesja.zlecenie_id ? `<button class="btn btn-outline" style="width:100%;margin-top:6px;font-size:12px" onclick="openKartaFromSesja(${sesja.zlecenie_id})">📋 Karta zlecenia</button>` : ''}
      </div>`;
    });
  } else {
    html += `
    <div class="card" style="text-align:center;padding:20px">
      <div style="font-size:36px;margin-bottom:8px">⏸</div>
      <div style="color:var(--dim);font-size:14px">Brak aktywnej sesji</div>
    </div>`;
  }

  html += `<button class="btn-outline" style="margin-top:8px" onclick="loadPracownik()">🔄 Odśwież</button>`;

  // Modal stop
  if (state.stopModal) {
    const s = state.stopModal;
    html += `
    <div class="modal-overlay">
      <div class="modal">
        <button class="modal-close" onclick="setState({stopModal:null})">×</button>
        <h3>⏹ Zakończ sesję</h3>
        <p style="color:var(--dim);font-size:13px;margin-bottom:16px">${s.op_nazwa || s.uwagi || '—'}</p>
        ${s.typ === 'zbrojenie' ? `
        <div style="background:rgba(243,156,18,0.1);border:1px solid var(--orange);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:13px;color:var(--orange)">
          ⚙ Zakończenie zbrojenia – po potwierdzeniu będzie możliwe uruchomienie operacji
        </div>` : ''}
        ${s.typ !== 'nieprodukcyjna' && s.typ !== 'zbrojenie' ? `
        <div class="field">
          <label>Liczba wykonanych sztuk</label>
          <input type="number" id="stop-ilosc" value="1" min="0">
        </div>` : ''}
        <div class="field">
          <label>Uwagi</label>
          <textarea id="stop-uwagi" placeholder="opcjonalnie..."></textarea>
        </div>
        <button class="btn btn-red" onclick="stopSesjaModal()">
          ✅ Potwierdź zakończenie
        </button>
      </div>
    </div>`;
  }

  // Modal KJ – potwierdzenie wyniku kontroli jakości
  if (state.kjModal) {
    const {op, wynik} = state.kjModal;
    const isZgodny = wynik === 'zgodny';
    html += `
    <div class="modal-overlay">
      <div class="modal">
        <button class="modal-close" onclick="setState({kjModal:null})">×</button>
        <h3>🔍 Kontrola jakości</h3>
        <div style="font-size:14px;font-weight:600;margin-bottom:6px">${op.nazwa}</div>
        ${op.parametry_kj ? renderKjParamsBlock(op.parametry_kj) : ''}
        <div style="background:${isZgodny?'rgba(39,174,96,0.1)':'rgba(231,76,60,0.1)'};border:1px solid ${isZgodny?'var(--green)':'var(--red)'};border-radius:8px;padding:12px;margin-bottom:14px;font-size:15px;font-weight:700;color:${isZgodny?'var(--green)':'var(--red)'};text-align:center">
          ${isZgodny ? '✅ WYNIK: ZGODNY' : '❌ WYNIK: NIEZGODNY'}
        </div>
        ${!isZgodny ? `
        <div class="field">
          <label>Opis niezgodności (opcjonalnie)</label>
          <textarea id="kj-uwagi" placeholder="Opisz stwierdzoną niezgodność..."></textarea>
        </div>` : ''}
        <div style="display:flex;gap:8px">
          <button class="btn" style="flex:1" onclick="setState({kjModal:null})">Anuluj</button>
          <button class="btn ${isZgodny?'btn-green':'btn-red'}" style="flex:2"
            onclick="kjWynik(${op.id}, '${wynik}')">
            Potwierdź ${isZgodny ? '✅ ZGODNY' : '❌ NIEZGODNY'}
          </button>
        </div>
      </div>
    </div>`;
  }

  // Modal: kontynuacja operacji innego pracownika
  if (state.kontynuacjaModal) {
    const m = state.kontynuacjaModal;
    const inni = (m.aktywne || []).map(s => `${s.full_name} (od ${(s.start_time||'').slice(0,16).replace('T',' ')})`).join(', ');
    html += `
    <div class="modal-overlay">
      <div class="modal">
        <button class="modal-close" onclick="setState({kontynuacjaModal:null})">×</button>
        <h3>⚡ Operacja w toku</h3>
        <p style="font-size:14px;margin-bottom:6px">Tę operację wykonuje już:</p>
        <div style="background:var(--entry);border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:14px">
          ${inni}
        </div>
        <p style="font-size:13px;color:var(--dim);margin-bottom:16px">
          Możesz dołączyć jako sesja dodatkowa. Twoje sztuki będą liczone niezależnie, 
          a koszt zostanie obliczony na podstawie normy czasowej.
        </p>
        <div style="display:flex;gap:8px;flex-direction:column">
          <button class="btn btn-accent" onclick="kontynuujOperacje(${m.operacjaId})">
            ✅ Dołącz do operacji (sesja dodatkowa)
          </button>
          <button class="btn" onclick="setState({kontynuacjaModal:null})">
            ✖ Anuluj
          </button>
        </div>
      </div>
    </div>`;
  }

  // Modal: wybór sesji głównej przy równoległych
  if (state.sesjaGlownaModal) {
    const m = state.sesjaGlownaModal;
    const aktywneLabels = (m.aktywne || []).map(s =>
      `${s.op_nazwa || s.uwagi || '—'} (${s.zl_numer || 'brak zlecenia'})`
    ).join('<br>');
    html += `
    <div class="modal-overlay">
      <div class="modal">
        <button class="modal-close" onclick="setState({sesjaGlownaModal:null})">×</button>
        <h3>⭐ Wybierz sesję główną</h3>
        <p style="font-size:13px;color:var(--dim);margin-bottom:10px">
          Masz już aktywne sesje produkcyjne:<br>
          <span style="font-size:12px">${aktywneLabels}</span>
        </p>
        <div style="background:var(--entry);border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:16px;line-height:1.6">
          <b>Sesja główna</b> – norma i wydajność liczone na podstawie czasu faktycznego<br>
          <b>Sesja dodatkowa</b> – koszt liczony normatywnie (sztuki × czas normy)
        </div>
        <p style="font-size:14px;font-weight:600;margin-bottom:12px">Którą sesją ma być <u>nowa</u> operacja?</p>
        <div style="display:flex;gap:8px;flex-direction:column">
          <button class="btn btn-green" onclick="potwierdzWyborGlownej(${m.operacjaId}, true)">
            ⭐ Nowa jest GŁÓWNA (tamte stają się dodatkowymi)
          </button>
          <button class="btn btn-accent" onclick="potwierdzWyborGlownej(${m.operacjaId}, false)">
            ➕ Nowa jest DODATKOWA (dotychczasowe główne bez zmian)
          </button>
          <button class="btn" onclick="setState({sesjaGlownaModal:null})">
            ✖ Anuluj
          </button>
        </div>
      </div>
    </div>`;
  }

  // ── Modal: obróbka równoległa na dwa stanowiska ──────────────
  if (state.parallelModal) {
    const m = state.parallelModal;
    const inni = (m.aktywne || []).map(s =>
      `<b>${s.full_name}</b> (od ${(s.start_time||'').slice(0,16).replace('T',' ')})`
    ).join('<br>');
    html += `
    <div class="modal-overlay">
      <div class="modal">
        <button class="modal-close" onclick="setState({parallelModal:null})">×</button>
        <h3>🔀 Operacja w toku</h3>
        <div style="background:rgba(232,160,32,0.1);border:1px solid var(--accent);border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:12px">
          <div style="font-weight:700;margin-bottom:4px">Stanowisko: ${m.stanowisko}</div>
          <div style="color:var(--dim)">Aktualnie pracuje:<br>${inni}</div>
        </div>
        <p style="font-size:13px;margin-bottom:16px">
          Czy chcesz uruchomić <b>obróbkę równoległą na dwa stanowiska</b>?<br>
          <span style="font-size:12px;color:var(--dim)">Twój czas będzie liczony niezależnie i dołączony do kosztów tego zlecenia.</span>
        </p>
        <div style="display:flex;gap:8px;flex-direction:column">
          <button class="btn btn-green" onclick="potwierdzRownolegle(${m.operacjaId}, ${JSON.stringify(m.rzeczywisteSt)})">
            ✅ Tak – obróbka równoległa
          </button>
          <button class="btn" onclick="setState({parallelModal:null})">
            ✖ Anuluj
          </button>
        </div>
      </div>
    </div>`;
  }

  // ── Modal: zmiana maszyny ──────────────────────────────────────
  if (state.zmianaMaszynyModal) {
    html += renderZmianaMaszynyModal();
  }

  // Modal nieprodukcyjna
  if (state.nieprodukcyjnaModal) {
    const opcje = ['Awaria maszyny','Brak materiału','Szkolenie','Spotkanie','Przerwa obiadowa','Sprzątanie','Inne'];
    html += `
    <div class="modal-overlay">
      <div class="modal">
        <button class="modal-close" onclick="setState({nieprodukcyjnaModal:false})">×</button>
        <h3>⏸ Praca nieprodukcyjna</h3>
        <div class="chip-row">
          ${opcje.map(o => `<div class="chip" onclick="document.getElementById('np-opis').value='${o}'">${o}</div>`).join('')}
        </div>
        <div class="field">
          <label>Opis</label>
          <input id="np-opis" type="text" placeholder="Co się dzieje?">
        </div>
        <button class="btn btn-purple" onclick="startNieprodukcyjna(document.getElementById('np-opis').value)">
          ▶ Rozpocznij rejestrację
        </button>
      </div>
    </div>`;
  }

  return html;
}


// ──────────────────────────────────────────────────────────────
//  HELPER: szacowany czas zakończenia zlecenia
// ──────────────────────────────────────────────────────────────
function szacowanyKoniec(z, ops) {
  // ops = lista operacji z cache (lub null)
  // z = zlecenie z polami: ilosc_sztuk, op_done, op_total
  if (!z) return null;
  const ilosc = z.ilosc_sztuk || 1;

  // Oblicz pozostały czas na bazie operacji z cache
  if (ops && ops.length > 0) {
    let pozostaleMin = 0;
    ops.forEach(op => {
      if (op.status === 'zakonczona') return;
      const norma = op.czas_norma || 0;
      const wykonano = op.ilosc_wykonana || 0;
      const pozostaloSztuk = Math.max(0, ilosc - wykonano);
      if (norma) pozostaleMin += norma * pozostaloSztuk;
      // zbrojenie: dolicz tylko jeśli nie ma aktywnej/zakończonej sesji zbrojenia dla tej op
      const zbrMin = op.czas_zbrojenia_min || 0;
      if (zbrMin) {
        // Sprawdź czy zbrojenie jest już aktywne lub wykonane (przez aktywne sesje)
        const zbrJuzAkt = (state.aktywnesje||[]).some(s => s.operacja_id === op.id && s.typ === 'zbrojenie');
        // Jeśli nie aktywne, zakładamy że zbrojenie jest do zrobienia (serwer weryfikuje czy zakończone)
        if (!zbrJuzAkt) pozostaleMin += zbrMin;
      }
    });
    if (pozostaleMin <= 0) return null;
    const koniec = new Date(Date.now() + pozostaleMin * 60 * 1000);
    return koniec;
  }

  // Fallback: brak szczegółów ops – nie szacuj
  return null;
}

function fmtEstimatedKoniec(dt) {
  if (!dt) return null;
  const today = new Date();
  const isToday = dt.toDateString() === today.toDateString();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
  const isTomorrow = dt.toDateString() === tomorrow.toDateString();
  const hm = dt.toLocaleTimeString('pl-PL', {hour:'2-digit',minute:'2-digit'});
  if (isToday) return `dziś ~${hm}`;
  if (isTomorrow) return `jutro ~${hm}`;
  return dt.toLocaleDateString('pl-PL', {day:'2-digit',month:'2-digit'}) + ` ~${hm}`;
}

// ══════════════════════════════════════════════════════════════
