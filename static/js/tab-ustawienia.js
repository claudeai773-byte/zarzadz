//  TAB: USTAWIENIA
// ══════════════════════════════════════════════════════════════
function renderUstawienia() {
  return `
  <div class="card">
    <div class="card-title" style="margin-bottom:12px">⚙ Połączenie</div>
    <div style="font-size:13px;color:var(--dim);word-break:break-all;margin-bottom:8px">
      Serwer: <span style="color:var(--text)">${SERVER_URL||'(nie ustawiony)'}</span>
    </div>
    <button class="btn btn-blue" onclick="setState({screen:'config'})">🔧 Zmień serwer</button>
  </div>
  <div class="card" style="margin-top:10px">
    <div class="card-title" style="margin-bottom:10px">🔗 Link dla pracowników</div>
    <div style="font-size:13px;color:var(--dim);margin-bottom:10px">
      Wygeneruj gotowy link – pracownik klika i od razu trafia do logowania, bez konfiguracji.
    </div>
    <button class="btn btn-accent" onclick="generateWorkerLink()">🔗 Generuj link</button>
    <div id="worker-link-box" style="display:none;margin-top:10px">
      <div style="font-size:11px;color:var(--dim);margin-bottom:4px">Skopiuj i wyślij pracownikom:</div>
      <div style="display:flex;gap:6px;align-items:center">
        <input id="worker-link-input" type="text" readonly
               style="flex:1;font-size:11px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 8px;word-break:break-all"
               onclick="this.select()">
        <button class="btn-sm" onclick="copyWorkerLink()">📋</button>
      </div>
      <div id="worker-link-copied" style="display:none;font-size:12px;color:#27ae60;margin-top:4px">✓ Skopiowano!</div>
    </div>
  </div>
  <div class="card" style="margin-top:10px">
    <div class="card-title" style="margin-bottom:12px">🔑 Zmiana hasła</div>
    <div class="field"><label style="font-size:12px">Aktualne hasło</label>
      <input id="pass-old" type="password" placeholder="Aktualne hasło" style="background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px 10px;width:100%;box-sizing:border-box">
    </div>
    <div class="field"><label style="font-size:12px">Nowe hasło</label>
      <input id="pass-new" type="password" placeholder="Min. 4 znaki" style="background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px 10px;width:100%;box-sizing:border-box">
    </div>
    <div class="field"><label style="font-size:12px">Powtórz nowe hasło</label>
      <input id="pass-new2" type="password" placeholder="Powtórz hasło" style="background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px 10px;width:100%;box-sizing:border-box">
    </div>
    <button class="btn btn-green" onclick="changeOwnPassword()">🔑 Zmień hasło</button>
  </div>
  <div class="card" style="margin-top:10px">
    <div class="card-title" style="margin-bottom:6px">ℹ O aplikacji</div>
    <div style="font-size:13px;color:var(--dim);line-height:2">
      System Zarządzania Produkcją v4.0<br>
      Wielokrotne sesje równoległe ✅<br>
      Pauzy sesji ✅<br>
      Skaner QR ✅<br>
      Praca nieprodukcyjna ✅<br>
      Alerty norm ✅<br>
      Wydajność pracowników ✅<br>
      Podsumowanie zleceń (majster) ✅<br>
      Wydruk karty zlecenia z QR ✅<br>
      Pełna administracja ✅
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════
