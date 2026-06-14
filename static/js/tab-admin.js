//  TAB: ADMIN
// ══════════════════════════════════════════════════════════════
function renderAdmin() {
  if (state.loading) return '<div class="spinner">⏳</div>';
  const subTabs = [{id:'uzytkownicy',label:'👤 Użytkownicy'},{id:'uprawnienia',label:'🔐 Uprawnienia'},{id:'import_pdf',label:'📄 Import PDF'},{id:'oceny',label:'⭐ Oceny'},{id:'logi',label:'📋 Logi'}];
  let html = `
  <div class="tabs">
    ${subTabs.map(t => `<button class="tab ${state.adminTab===t.id?'active':''}"
      onclick="setState({adminTab:'${t.id}'})${t.id==='oceny'?';loadAdminFeedbacks()':t.id==='logi'?';loadAdminLogi()':''}">${t.label}</button>`).join('')}
  </div>`;

  if (state.adminTab === 'uzytkownicy') {
    html += `
    <button class="btn btn-accent" style="margin-bottom:12px" onclick="setState({userModal:{}})">+ Nowy użytkownik</button>`;
    (state.users||[]).forEach(u => {
      html += `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">👤 ${u.full_name}</div>
            <div class="card-sub">@${u.username} | ${roleName(u.role)}${u.is_kj?` | <span style="color:#3498db;font-weight:700">🔍 KJ</span>`:''}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn-sm btn-blue" onclick="setState({userModal:${JSON.stringify(u).replace(/"/g,'&quot;')}})">✏</button>
            <button class="btn-sm btn-accent" style="background:#8e44ad;color:#fff" onclick="adminResetPassword(${u.id})">🔑 Reset</button>
            <button class="btn-sm btn-red" onclick="deleteUser(${u.id})">🗑</button>
          </div>
        </div>
      </div>`;
    });

    if (state.userModal !== null) {
      const u = state.userModal;
      html += `
      <div class="modal-overlay">
        <div class="modal">
          <button class="modal-close" onclick="setState({userModal:null})">×</button>
          <h3>${u.id?'✏ Edytuj':'+ Nowy użytkownik'}</h3>
          ${!u.id ? `<div class="field"><label>Login</label><input id="u-login" type="text" value="${u.username||''}"></div>` : ''}
          <div class="field"><label>Imię i nazwisko</label><input id="u-name" type="text" value="${u.full_name||''}"></div>
          <div class="field">
            <label>Rola</label>
            <select id="u-role">
              ${['pracownik','majster','technolog','magazynier','admin'].map(r =>
                `<option value="${r}" ${u.role===r?'selected':''}>${roleName(r)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="display:flex;align-items:center;gap:10px;background:rgba(52,152,219,0.08);border:1px solid #3498db55;border-radius:8px;padding:10px 14px">
            <input type="checkbox" id="u-is-kj" style="width:18px;height:18px;cursor:pointer" ${u.is_kj?'checked':''}>
            <div>
              <label for="u-is-kj" style="cursor:pointer;font-weight:600;color:#3498db">🔍 Kontrola Jakości (KJ)</label>
              <div style="font-size:11px;color:var(--dim);margin-top:2px">Po zeskanowaniu QR użytkownik widzi operacje i może ocenić: ZGODNY / NIEZGODNY</div>
            </div>
          </div>
          <div class="field"><label>${u.id?'Nowe hasło (puste = bez zmiany)':'Hasło'}</label><input id="u-pass" type="password"></div>
          <button class="btn btn-accent" onclick="saveUserForm(${u.id||0})">💾 Zapisz</button>
        </div>
      </div>`;
    }
  }

  if (state.adminTab === 'uprawnienia') {
    const perms = state.userPermissions || {};
    const users = state.users || [];
    html += `
    <div style="font-size:12px;color:var(--dim);margin-bottom:12px;line-height:1.6">
      🔐 Uprawnienia niestandardowe nadpisują domyślny dostęp wynikający z roli.<br>
      Puste = domyślne zakładki wg roli. Zaznacz wybrane zakładki i kliknij <b>Zapisz</b>.
    </div>`;
    users.filter(u => u.role !== 'admin').forEach(u => {
      const uid = u.id;
      const savedTabs = perms[uid] || [];
      const hasCustom = savedTabs.length > 0;
      html += `
      <div class="card" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div>
            <div class="card-title">👤 ${u.full_name}</div>
            <div class="card-sub">@${u.username} | ${roleName(u.role)} ${hasCustom ? '| <span style="color:var(--orange)">🔐 niestandardowe</span>' : '| <span style="color:var(--dim)">domyślne wg roli</span>'}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn-sm btn-accent" onclick="savePermissions(${uid})">💾 Zapisz</button>
            ${hasCustom ? `<button class="btn-sm btn-red" onclick="resetPermissions(${uid})">↩ Reset</button>` : ''}
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${ALL_TABS_DEF.map(td => {
            const checked = hasCustom ? savedTabs.includes(td.id) : td.roles.includes(u.role);
            return `<label style="display:flex;align-items:center;gap:6px;font-size:13px;background:var(--entry);padding:5px 10px;border-radius:6px;cursor:pointer;border:1px solid var(--border)">
              <input type="checkbox" id="perm-${uid}-${td.id}" ${checked ? 'checked' : ''} style="width:15px;height:15px">
              ${td.label}
            </label>`;
          }).join('')}
        </div>
      </div>`;
    });
  }

  if (state.adminTab === 'import_pdf') {
    const res    = state.importPdfResult;
    const prev   = state.importPdfPreview;
    const bom    = state.importPdfBom || [];
    const parsing = state.importPdfParsing;

    html += '<div style="max-width:600px">';

    // ── KROK 1: Wybór pliku ─────────────────────────────────────────────────
    if (!prev && !res) {
      html += '<div style="font-size:13px;color:var(--dim);margin-bottom:16px;line-height:1.6">Wgraj kartę technologiczną w formacie PDF. System rozpozna operacje, stanowiska, czasy normatywne oraz <b>wykaz materiałów (BOM)</b>.</div>';
      html += '<div class="card" style="padding:20px;text-align:center;border:2px dashed var(--border)">';
      html += '<div style="font-size:40px;margin-bottom:10px">📄</div>';
      html += '<div style="font-size:15px;font-weight:600;margin-bottom:6px">Karta technologiczna (.pdf)</div>';
      html += '<div style="font-size:12px;color:var(--dim);margin-bottom:16px">Format: KARTA TECHNOLOGICZNA z polem Wykaz materiałów, operacjami i stanowiskami</div>';
      html += '<input type="file" id="pdf-import-input" accept=".pdf" style="display:none" onchange="handlePdfParse(this)">';
      html += '<button class="btn btn-accent" onclick="document.getElementById(\'pdf-import-input\').click()" ' + (parsing ? 'disabled' : '') + '>';
      html += parsing ? '⏳ Analizuję...' : '📂 Wybierz plik PDF';
      html += '</button></div>';
    }

    // ── KROK 2: Podgląd i potwierdzenie ────────────────────────────────────
    if (prev && !res) {
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">';
      html += '<div style="font-size:15px;font-weight:700">📋 Podgląd importu</div>';
      html += '<button class="btn-outline" onclick="setState({importPdfPreview:null,importPdfBom:[]})">← Wróć</button></div>';

      html += '<div class="card" style="margin-bottom:10px">';
      html += '<div style="font-size:13px"><b>' + prev.numer + '</b> – ' + prev.nazwa + '</div>';
      html += '<div style="font-size:12px;color:var(--dim);margin-top:4px">' + prev.operacje.length + ' operacji</div></div>';

      // Operacje
      html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--dim);margin-bottom:6px">Operacje</div>';
      html += '<div style="max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:14px">';
      prev.operacje.forEach(o => {
        html += '<div style="display:flex;justify-content:space-between;padding:6px 10px;border-bottom:1px solid var(--border);font-size:12px;background:var(--panel)">';
        html += '<span><b>' + String(o.kolejnosc).padStart(3,'0') + '</b> ' + o.nazwa + '</span>';
        html += '<span style="color:var(--dim);white-space:nowrap;margin-left:8px">' + o.stanowisko + (o.czas_norma > 0 ? ' · ' + o.czas_norma + ' min' : '') + '</span>';
        html += '</div>';
      });
      html += '</div>';

      // BOM
      const bomIncluded = bom.filter(b => b.included !== false).length;
      html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--dim);margin-bottom:6px">';
      html += '📦 Wykaz materiałów BOM';
      if (bom.length) html += ' <span style="color:var(--green);margin-left:6px">' + bomIncluded + ' / ' + bom.length + ' zaznaczonych</span>';
      html += '</div>';

      if (!bom.length) {
        html += '<div style="font-size:12px;color:var(--dim);background:var(--entry);border-radius:8px;padding:12px;margin-bottom:14px;text-align:center">⚠ Nie wykryto wykazu materiałów w tym PDF.<br><span style="font-size:11px">Możesz dodać materiały ręcznie po imporcie w zakładce Zlecenia.</span></div>';
      } else {
        // Grupowanie po gatunku stali
        const byGrade = {};
        bom.forEach(m => {
          const g = m.gatunek_stali || 'S235';
          if (!byGrade[g]) byGrade[g] = 0;
          if (m.included !== false) byGrade[g] += (m.masa_kg || 0);
        });
        const totalKg = Object.values(byGrade).reduce((a,b)=>a+b,0);

        html += '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px;padding:8px 10px;background:rgba(39,174,96,0.06);border:1px solid rgba(39,174,96,0.2);border-radius:8px">';
        html += '<span style="font-size:11px;color:var(--dim);font-weight:700;margin-right:4px">⚖ Zapotrzebowanie:</span>';
        Object.entries(byGrade).forEach(([g, kg]) => {
          html += '<span style="background:rgba(232,160,32,0.15);border:1px solid rgba(232,160,32,0.3);border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;color:var(--accent)">' + g + ': <b>' + kg.toFixed(1) + ' kg</b></span>';
        });
        html += '<span style="margin-left:auto;font-size:12px;font-weight:700;color:var(--green)">Σ ' + totalKg.toFixed(1) + ' kg</span></div>';

        html += '<div style="border:1px solid var(--border);border-radius:8px;margin-bottom:10px;overflow:hidden">';
        html += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
        html += '<thead><tr style="background:var(--panel);border-bottom:1px solid var(--border)"><th style="padding:6px 8px;text-align:left;width:28px"></th><th style="padding:6px 8px;text-align:left">Materiał</th><th style="padding:6px 8px;text-align:right">Masa</th><th style="padding:6px 8px;text-align:center">Status</th></tr></thead><tbody>';
        bom.forEach((m, idx) => {
          const included = m.included !== false;
          const masaStr = m.masa_kg > 0 ? '<b>' + m.masa_kg.toFixed(2) + '</b> kg' : '<b>' + m.ilosc + '</b> ' + m.jm;
          const statusHtml = m.w_bazie
            ? '<span style="color:var(--green);font-size:10px;font-weight:700">✓ w bazie</span>'
            : '<span style="color:var(--blue);font-size:10px;font-weight:700">+ nowy</span>';
          const subParts = [
            m.indeks_bazy || m.kod,
            m.gatunek_stali ? '<span style="color:var(--accent)">' + m.gatunek_stali + '</span>' : '',
            m.wymiary_str ? '<span style="color:var(--dim)">' + m.wymiary_str + '</span>' : '',
            m.ilosc > 1 ? m.ilosc + ' szt.' : '',
          ].filter(Boolean).join(' · ');
          html += '<tr style="border-bottom:1px solid var(--border);opacity:' + (included ? 1 : 0.4) + '">';
          html += '<td style="padding:6px 8px;text-align:center"><input type="checkbox" ' + (included ? 'checked' : '') + ' onchange="toggleBomItem(' + idx + ',this.checked)"></td>';
          html += '<td style="padding:6px 8px"><div style="font-weight:600">' + (m.opis_bazy || m.opis) + '</div>';
          html += '<div style="font-size:10px;color:var(--dim)">' + subParts + '</div></td>';
          html += '<td style="padding:6px 8px;text-align:right;white-space:nowrap">' + masaStr + '</td>';
          html += '<td style="padding:6px 8px;text-align:center">' + statusHtml + '</td></tr>';
        });
        html += '</tbody></table></div>';
        html += '<div style="font-size:11px;color:var(--dim);margin-bottom:14px">✏ Niebieskie pozycje (<b>+ nowy</b>) zostaną automatycznie dodane do bazy materiałów ze stanem 0. Masa obliczona z wymiarów (ρ=7850 kg/m³).</div>';
      }

      const bomLabel = bomIncluded > 0 ? ' + BOM (' + bomIncluded + ' poz.)' : '';
      html += '<div style="display:flex;gap:8px;margin-top:4px">';
      html += '<button class="btn btn-accent" style="flex:1" onclick="confirmPdfImport()">✅ Importuj technologię' + bomLabel + '</button>';
      html += '<button class="btn-outline" onclick="setState({importPdfPreview:null,importPdfBom:[]})">✕ Anuluj</button>';
      html += '</div>';
    }

    // ── KROK 3: Wynik ─────────────────────────────────────────────────────
    if (res) {
      const hasErrors = res.errors && res.errors.length;
      html += '<div class="card" style="padding:16px;background:' + (hasErrors ? 'rgba(231,76,60,0.06)' : 'rgba(39,174,96,0.06)') + ';border:1px solid ' + (hasErrors ? 'var(--red)' : 'var(--green)') + '">';
      html += '<div style="font-size:15px;font-weight:700;margin-bottom:10px">' + (hasErrors ? '⚠ Import z ostrzeżeniami' : '✅ Import zakończony pomyślnie') + '</div>';
      html += '<div style="font-size:13px;line-height:2">';
      html += '📋 Zlecenie: <b>' + res.numer + '</b> – ' + res.nazwa + '<br>';
      html += '🔢 Operacje: <b>' + res.operacje_created + '</b><br>';
      html += '📦 BOM: <b>' + (res.bom_added || 0) + '</b> pozycji' + (res.bom_new_materialy > 0 ? ' (' + res.bom_new_materialy + ' nowych w bazie)' : '') + '<br>';
      if (res.nowe_stanowiska && res.nowe_stanowiska.length) html += '🏭 Nowe stanowiska: <b>' + res.nowe_stanowiska.join(', ') + '</b><br>';
      if (hasErrors) html += '<span style="color:var(--red)">⛔ Błędy: ' + res.errors.join('; ') + '</span>';
      html += '</div>';
      if (res.nowe_stanowiska && res.nowe_stanowiska.length) {
        html += '<div style="font-size:12px;background:rgba(230,126,0,0.1);border:1px solid var(--orange);border-radius:6px;padding:8px 12px;margin-top:10px">⚠ Uzupełnij stawki dla nowych stanowisk w zakładce <b>Stawki</b></div>';
      }
      html += '<div style="display:flex;gap:8px;margin-top:12px">';
      html += '<button class="btn btn-green" onclick="setState({activeTab:\'zlecenia\'});loadTabData(\'zlecenia\')">📋 Przejdź do zleceń →</button>';
      html += '<button class="btn-outline" onclick="setState({importPdfResult:null,importPdfPreview:null,importPdfBom:[]})">+ Importuj kolejny</button>';
      html += '</div></div>';
    }

    html += '</div>';
  }

  if (state.adminTab === 'stawki') {
    html += `<button class="btn btn-accent" style="margin-bottom:12px" onclick="setState({stawkaModal:{}})">+ Nowa stawka</button>`;
    (state.stawki||[]).forEach(s => {
      html += `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">${s.stanowisko}</div>
            <div class="card-sub">${fmtPLN(s.stawka_godz)}/h</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn-sm btn-blue" onclick="setState({stawkaModal:${JSON.stringify(s).replace(/"/g,'&quot;')}})">✏</button>
            <button class="btn-sm btn-red" onclick="deleteStawka(${s.id})">🗑</button>
          </div>
        </div>
        ${s.zbrojenie_aktywne ? `<div style="margin-top:6px;font-size:12px;color:var(--orange)">⚙ Zbrojenie: ${fmtPLN(s.zbrojenie_stawka_godz)}/h</div>` : ''}
      </div>`;
    });
    if (state.stawkaModal !== null) {
      html += renderStawkaModal();
    }
  }

  if (state.adminTab === 'oceny') {
    const feedbacks = state.adminFeedbacks;
    if (!feedbacks) {
      html += '<div class="spinner">⏳ Ładowanie ocen...</div>';
    } else if (!feedbacks.length) {
      html += '<div class="empty">Brak ocen i opinii.</div>';
    } else {
      // Statystyki
      const avgRating = (feedbacks.reduce((s,f) => s + f.ocena, 0) / feedbacks.length).toFixed(1);
      const dist = [5,4,3,2,1].map(n => ({n, cnt: feedbacks.filter(f=>f.ocena===n).length}));
      html += `
      <div class="card" style="margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <div style="text-align:center">
            <div style="font-size:40px;font-weight:700;color:var(--accent);font-family:Consolas,monospace">${avgRating}</div>
            <div style="color:var(--accent);font-size:20px">${'★'.repeat(Math.round(parseFloat(avgRating)))}${'☆'.repeat(5-Math.round(parseFloat(avgRating)))}</div>
            <div style="font-size:11px;color:var(--dim)">${feedbacks.length} ocen</div>
          </div>
          <div style="flex:1;min-width:160px">
            ${dist.map(d => `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-size:12px;color:var(--dim);width:12px">${d.n}</span>
              <span style="color:var(--accent);font-size:13px">★</span>
              <div style="flex:1;background:var(--border);border-radius:4px;height:8px;overflow:hidden">
                <div style="width:${feedbacks.length?Math.round(d.cnt/feedbacks.length*100):0}%;height:100%;background:var(--accent);border-radius:4px"></div>
              </div>
              <span style="font-size:11px;color:var(--dim);width:20px;text-align:right">${d.cnt}</span>
            </div>`).join('')}
          </div>
        </div>
      </div>`;

      // Lista wpisów
      feedbacks.forEach(f => {
        const stars = '★'.repeat(f.ocena) + '☆'.repeat(5-f.ocena);
        const dt = f.created_at ? new Date(f.created_at.replace('Z','+00:00')).toLocaleString('pl-PL',{timeZone:'Europe/Warsaw',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
        html += `
        <div class="card" style="margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <span style="color:var(--accent);font-size:16px;letter-spacing:1px">${stars}</span>
              ${f.user_name ? `<span style="font-size:12px;color:var(--dim);margin-left:8px">👤 ${f.user_name}</span>` : ''}
            </div>
            <span style="font-size:11px;color:var(--dim)">${dt}</span>
          </div>
          ${f.wiadomosc ? `<div style="margin-top:8px;font-size:13px;color:var(--text);line-height:1.5;background:var(--entry);padding:8px 12px;border-radius:6px">${f.wiadomosc.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>` : ''}
        </div>`;
      });
    }
    html += `<button class="btn-outline" style="margin-top:4px" onclick="loadAdminFeedbacks()">🔄 Odśwież</button>`;
  }

  if (state.adminTab === 'logi') {
    const logi = state.adminLogi;
    const logiFiltr = state.adminLogiFiltr || '';
    html += `
    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
      <input id="logi-filtr" type="text" placeholder="Szukaj w logach (użytkownik, akcja...)"
        value="${logiFiltr}"
        style="flex:1;min-width:180px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 10px;font-size:13px"
        onkeyup="setState({adminLogiFiltr:this.value})">
      <button class="btn btn-accent" style="padding:7px 14px" onclick="loadAdminLogi()">🔄 Odśwież</button>
    </div>`;
    if (!logi) {
      html += `<div class="empty">⏳ Ładowanie logów...</div>`;
    } else if (!logi.length) {
      html += `<div class="empty">Brak wpisów w logach.</div>`;
    } else {
      const filtr = (state.adminLogiFiltr||'').toLowerCase();
      const filtered = filtr ? logi.filter(l =>
        (l.username||'').toLowerCase().includes(filtr) ||
        (l.akcja||'').toLowerCase().includes(filtr) ||
        (l.szczegoly||'').toLowerCase().includes(filtr)
      ) : logi;
      const ikonaTypu = (typ) => {
        if (typ==='LOGIN_OK') return '🟢';
        if (typ==='LOGIN_FAIL') return '🔴';
        if (typ==='LOGOUT') return '⚪';
        if (typ==='ADMIN') return '🔐';
        if (typ==='SESJA_START') return '▶️';
        if (typ==='SESJA_STOP') return '⏹️';
        if (typ==='PAUZA') return '⏸️';
        return '📌';
      };
      const kolorTypu = (typ) => {
        if (typ==='LOGIN_OK'||typ==='SESJA_START') return 'var(--green)';
        if (typ==='LOGIN_FAIL') return 'var(--red)';
        if (typ==='ADMIN') return '#8e44ad';
        return 'var(--dim)';
      };
      html += `<div style="font-size:11px;color:var(--dim);margin-bottom:8px">Pokazano ${filtered.length} z ${logi.length} wpisów</div>`;
      filtered.forEach(l => {
        const dt = l.czas ? new Date(l.czas.replace('Z','+00:00')).toLocaleString('pl-PL',{timeZone:'Europe/Warsaw',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '';
        html += `
        <div class="card" style="padding:8px 12px;margin-bottom:6px;border-left:3px solid ${kolorTypu(l.typ)}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:700">${ikonaTypu(l.typ)} <span style="color:${kolorTypu(l.typ)}">${l.typ}</span> &nbsp;<span style="color:var(--text)">👤 ${l.username||'—'}</span></div>
              <div style="font-size:12px;color:var(--text);margin-top:3px">${l.akcja||''}</div>
              ${l.szczegoly ? `<div style="font-size:11px;color:var(--dim);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l.szczegoly}</div>` : ''}
            </div>
            <div style="font-size:10px;color:var(--dim);white-space:nowrap;margin-top:2px">${dt}</div>
          </div>
        </div>`;
      });
    }
  }

  return html;
}

function saveUserForm(id) {
  const data = {
    full_name: document.getElementById('u-name')?.value?.trim(),
    role: document.getElementById('u-role')?.value,
    password: document.getElementById('u-pass')?.value || undefined,
    is_kj: document.getElementById('u-is-kj')?.checked ? 1 : 0,
  };
  if (!data.full_name) { alert('Podaj imię i nazwisko'); return; }
  if (id) { data.id = id; }
  else { data.username = document.getElementById('u-login')?.value?.trim(); data.password = document.getElementById('u-pass')?.value; }
  saveUser(data);
}
function selectTypMaszyny(val) {
  const hidden = document.getElementById('st-typ');
  if (!hidden) return;
  const prev = hidden.value;
  const next = (prev === val) ? '' : val;
  hidden.value = next;
  const typyDef = [
    {val:'frezarka_cnc',   label:'🔵 Frezarka CNC'},
    {val:'tokarka_cnc',    label:'🟢 Tokarka CNC'},
    {val:'frezarka_konw',  label:'🔷 Frezarka konw.'},
    {val:'tokarka_konw',   label:'🟩 Tokarka konw.'},
    {val:'szlifierka',     label:'🟡 Szlifierka'},
    {val:'operacja',       label:'🔧 Operacja'},
  ];
  typyDef.forEach(t => {
    const btn = document.getElementById('st-typ-btn-' + t.val);
    if (!btn) return;
    const active = (next === t.val);
    btn.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
    btn.style.background = active ? 'rgba(232,160,32,0.15)' : 'var(--panel)';
    btn.style.color = active ? 'var(--accent)' : 'var(--dim)';
  });
  // Aktualizuj sticky header
  const headerEl = document.getElementById('st-typ-sticky-label');
  const headerWrap = document.getElementById('st-typ-sticky-wrap');
  if (headerEl && headerWrap) {
    const aktywny = typyDef.find(t => t.val === next);
    if (aktywny) {
      headerEl.textContent = aktywny.label;
      headerEl.style.color = 'var(--accent)';
      headerEl.style.fontStyle = 'normal';
      headerWrap.style.borderColor = 'var(--accent)';
    } else {
      headerEl.textContent = '— nie wybrano —';
      headerEl.style.color = 'var(--dim)';
      headerEl.style.fontStyle = 'italic';
      headerWrap.style.borderColor = 'var(--border)';
    }
  }
}

function renderStawkaModal() {
  const s = state.stawkaModal;
  if (!s) return '';
  const zbrAkt = s.zbrojenie_aktywne ? true : false;
  const typyMaszyn = [
    {val:'frezarka_cnc',   label:'🔵 Frezarka CNC'},
    {val:'tokarka_cnc',    label:'🟢 Tokarka CNC'},
    {val:'frezarka_konw',  label:'🔷 Frezarka konw.'},
    {val:'tokarka_konw',   label:'🟩 Tokarka konw.'},
    {val:'szlifierka',     label:'🟡 Szlifierka'},
    {val:'operacja',       label:'🔧 Operacja'},
  ];
  const aktywnyTyp = typyMaszyn.find(t => t.val === (s.typ_maszyny || ''));
  const stickyBorder = aktywnyTyp ? 'var(--accent)' : 'var(--border)';
  const stickyLabelColor = aktywnyTyp ? 'var(--accent)' : 'var(--dim)';
  const stickyLabelStyle = aktywnyTyp ? 'font-size:14px;font-weight:700' : 'font-size:13px;font-style:italic';
  const stickyLabelText = aktywnyTyp ? aktywnyTyp.label : '\u2014 nie wybrano \u2014';

  let btns = '';
  typyMaszyn.forEach(t => {
    const active = s.typ_maszyny === t.val;
    btns += '<button type="button" id="st-typ-btn-' + t.val + '" onclick="selectTypMaszyny(\'' + t.val + '\')" style="padding:6px 12px;border-radius:20px;border:2px solid ' + (active ? 'var(--accent)' : 'var(--border)') + ';background:' + (active ? 'rgba(232,160,32,0.15)' : 'var(--panel)') + ';color:' + (active ? 'var(--accent)' : 'var(--dim)') + ';cursor:pointer;font-size:12px;font-weight:600;transition:all .15s">' + t.label + '</button>';
  });

  return '<div class="modal-overlay">'
    + '<div class="modal" style="padding:0;display:flex;flex-direction:column;max-height:90vh;">'
    // Sticky header – osobny div PRZED scrollable body, nie wewnątrz niego
    + '<div style="background:var(--panel);border-radius:20px 20px 0 0;padding:20px 20px 12px;border-bottom:1px solid var(--border);flex-shrink:0;">'
    + '<button class="modal-close" onclick="setState({stawkaModal:null})">\u00D7</button>'
    + '<h3 style="margin-bottom:10px">' + (s.id ? '\u270F Edytuj stawk\u0119' : '+ Nowa stawka') + '</h3>'
    + '<div id="st-typ-sticky-wrap" style="background:var(--entry);border:1px solid ' + stickyBorder + ';border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:10px;">'
    + '<div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;white-space:nowrap;">Typ maszyny:</div>'
    + '<div id="st-typ-sticky-label" style="' + stickyLabelStyle + ';color:' + stickyLabelColor + '">' + stickyLabelText + '</div>'
    + '</div>'
    + '</div>'
    // Scrollable body
    + '<div style="flex:1;overflow-y:auto;padding:16px 20px 24px;">'
    + '<div class="field"><label>Stanowisko</label><input id="st-stan" type="text" value="' + (s.stanowisko||'') + '"></div>'
    + '<div class="field"><label>Stawka (z\u0142/h)</label><input id="st-stawka" type="number" step="0.5" value="' + (s.stawka_godz||0) + '"></div>'
    + '<div class="field"><label>Opis</label><input id="st-opis" type="text" value="' + (s.opis||'') + '"></div>'
    + '<div style="background:var(--entry);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px">'
    + '<div style="font-size:12px;font-weight:700;color:var(--dim);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">🏭 Typ maszyny / operacji</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:6px" id="st-typ-wrap">' + btns + '</div>'
    + '<input type="hidden" id="st-typ" value="' + (s.typ_maszyny||'') + '">'
    + '<div style="font-size:11px;color:var(--dim);margin-top:8px">Typ maszyny okre\u015Bla grup\u0119 alternatyw przy uruchamianiu sesji (zak\u0142adka Praca).</div>'
    + '</div>'
    + '<div style="background:var(--entry);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px">'
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
    + '<input type="checkbox" id="st-zbr-akt" ' + (zbrAkt ? 'checked' : '') + ' onchange="document.getElementById(\'zbr-stawka-wrap\').style.display=this.checked?\'block\':\'none\'" style="width:18px;height:18px;cursor:pointer">'
    + '<label for="st-zbr-akt" style="font-size:14px;cursor:pointer">\u2699 Aktywuj zbrojenie</label>'
    + '</div>'
    + '<div id="zbr-stawka-wrap" style="display:' + (zbrAkt ? 'block' : 'none') + '">'
    + '<div class="field" style="margin-bottom:0"><label>Stawka zbrojenia (z\u0142/h)</label><input id="st-zbr-stawka" type="number" step="0.5" min="0" value="' + (s.zbrojenie_stawka_godz||0) + '"></div>'
    + '</div>'
    + '</div>'
    + '<button class="btn btn-accent" onclick="saveStawkaForm(' + (s.id||0) + ')">💾 Zapisz</button>'
    + '</div>'
    + '</div>'
    + '</div>';
}

function renderZmianaMaszynyModal() {
  const m = state.zmianaMaszynyModal;
  if (!m) return '';
  const lista = m.stanowiskoLista || [];

  let btns = '';
  lista.forEach(st => {
    const isOryg = st === m.stanowiskoOryginalne;
    const safeVal = st.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    btns += '<button class="btn ' + (isOryg ? 'btn-green' : '') + '" '
      + 'style="text-align:left;display:flex;align-items:center;gap:8px;' + (isOryg ? '' : 'background:var(--entry);color:var(--text);border:1px solid var(--border);') + '" '
      + 'onclick="zmianaMaszynyPotwierdzenie(' + m.operacjaId + ', \'' + safeVal + '\')">'
      + '<span style="font-size:16px">' + (isOryg ? '\u2705' : '\uD83D\uDD04') + '</span>'
      + '<span style="flex:1"><b>' + st + '</b>' + (isOryg ? ' <span style="font-size:11px;opacity:.75">(docelowa)</span>' : '') + '</span>'
      + '</button>';
  });

  return '<div class="modal-overlay">'
    + '<div class="modal" style="padding:0;display:flex;flex-direction:column;max-height:90vh;">'
    // Stały header (flex-shrink:0, NIE sticky - sticky nie działa w overflow:auto)
    + '<div style="flex-shrink:0;background:var(--panel);border-radius:20px 20px 0 0;padding:20px 20px 12px;border-bottom:1px solid var(--border);">'
    + '<button class="modal-close" onclick="setState({zmianaMaszynyModal:null})">\u00D7</button>'
    + '<h3 style="margin-bottom:8px">\uD83D\uDD27 Wyb\u00F3r maszyny</h3>'
    + '<div style="background:var(--entry);border:1px solid var(--accent);border-radius:8px;padding:10px 14px;">'
    + '<div style="font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Operacja przypisana do:</div>'
    + '<div style="font-weight:700;font-size:15px;color:var(--accent)">' + m.stanowiskoOryginalne + '</div>'
    + '<div style="font-size:11px;color:var(--dim);margin-top:3px">Typ: ' + (m.typMaszyny || m.kategoria || '\u2014') + '</div>'
    + '</div>'
    + '</div>'
    // Scrollable lista
    + '<div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 20px 24px;">'
    + '<div style="font-size:12px;color:var(--dim);margin-bottom:10px">'
    + lista.length + ' maszyn\u0105 tego samego typu:'
    + '</div>'
    + '<div style="display:flex;flex-direction:column;gap:8px;">'
    + btns
    + '<button class="btn btn-outline" onclick="setState({zmianaMaszynyModal:null})">\u2716 Anuluj</button>'
    + '</div>'
    + '</div>'
    + '</div>'
    + '</div>';
}


function saveStawkaForm(id) {
  const zbrAkt = document.getElementById('st-zbr-akt')?.checked ? 1 : 0;
  const data = {
    stanowisko: document.getElementById('st-stan')?.value?.trim(),
    stawka_godz: parseFloat(document.getElementById('st-stawka')?.value)||0,
    opis: document.getElementById('st-opis')?.value||'',
    zbrojenie_aktywne: zbrAkt,
    zbrojenie_stawka_godz: zbrAkt ? (parseFloat(document.getElementById('st-zbr-stawka')?.value)||0) : 0,
    typ_maszyny: document.getElementById('st-typ')?.value || '',
  };
  if (!data.stanowisko) { alert('Podaj nazwę stanowiska'); return; }
  if (id) data.id = id;
  saveStawka(data);
}
function renderKjParams(json, style) {
  try {
    return JSON.parse(json).map(function(p){ return '<div style="' + style + '">' + p + '</div>'; }).join('');
  } catch(e) { return ''; }
}

function renderKjParamsBlock(json) {
  try {
    return '<div style="background:var(--entry);border-radius:6px;padding:8px 12px;font-size:12px;margin-bottom:12px">' + JSON.parse(json).join('<br>') + '</div>';
  } catch(e) { return ''; }
}

// Trzymaj ostatni wybrany plik PDF w pamięci
let _lastPdfFile = null;

async function handlePdfParse(input) {
  const file = input.files[0];
  if (!file) return;
  _lastPdfFile = file;
  setState({importPdfParsing: true, importPdfPreview: null, importPdfBom: [], importPdfResult: null});
  const formData = new FormData();
  formData.append('file', file);
  try {
    const url = (SERVER_URL.replace(/\/$/,'')) + '/api/import-technologia/parse';
    const response = await fetch(url, {method:'POST', headers:{'x-api-key':API_KEY}, body:formData});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Błąd parsowania');
    const bom = (data.bom||[]).map(m => ({...m, included: true}));
    setState({importPdfPreview: data, importPdfBom: bom, importPdfParsing: false});
    input.value = '';
  } catch(e) {
    setState({importPdfParsing: false});
    alert('Błąd odczytu PDF: ' + e.message);
    input.value = '';
  }
}

function toggleBomItem(idx, checked) {
  const bom = [...state.importPdfBom];
  bom[idx] = {...bom[idx], included: checked};
  setState({importPdfBom: bom});
}

async function confirmPdfImport(force) {
  if (!_lastPdfFile) { alert('Wybierz plik PDF ponownie'); return; }
  const bom = state.importPdfBom.filter(m => m.included !== false);
  await _doPdfImport(_lastPdfFile, bom, force);
}

async function _doPdfImport(file, bomItems, force) {
  const formData = new FormData();
  formData.append('file', file);
  if (bomItems && bomItems.length) {
    formData.append('bom_json', JSON.stringify(bomItems));
  }
  const url = (SERVER_URL.replace(/\/$/,'')) + '/api/import-technologia' + (force ? '?force=true' : '');
  try {
    const response = await fetch(url, {method:'POST', headers:{'x-api-key':API_KEY}, body:formData});
    const data = await response.json();
    if (response.status === 409) {
      const ok = confirm((data.detail||'Zlecenie o tym numerze już istnieje.') + '\n\nUtwrzyć duplikat?');
      if (ok) await _doPdfImport(file, bomItems, true);
      return;
    }
    if (!response.ok) throw new Error(data.detail || 'Błąd importu');
    setState({importPdfResult: data, importPdfPreview: null});
    _lastPdfFile = null;
    if (state.activeTab === 'zlecenia') loadZlecenia();
  } catch(e) {
    alert('Błąd importu PDF: ' + e.message);
  }
}

async function majsterZatwierdzKooperacje(opId) {
  if (!confirm('Zatwierdzić wykonanie kooperacji?')) return;
  try {
    await fetch((SERVER_URL.replace(/\/$/,'')) + '/api/operacje/' + opId + '/kj', {
      method: 'PATCH',
      headers: {'Content-Type':'application/json', 'x-api-key': API_KEY},
      body: JSON.stringify({wynik: 'zgodny', uwagi: 'Kooperacja zatwierdzona przez majstra'}),
    });
    setState({qrZleceniePickerModal: null});
    await loadPracownik();
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function kjWynik(opId, wynik) {
  const uwagi = document.getElementById('kj-uwagi')?.value || '';
  try {
    await fetch((SERVER_URL.replace(/\/$/,'')) + '/api/operacje/' + opId + '/kj', {
      method: 'PATCH',
      headers: {'Content-Type':'application/json', 'x-api-key': API_KEY},
      body: JSON.stringify({wynik, uwagi, user_id: state.user?.id, user_name: state.user?.full_name}),
    });
    setState({kjModal: null, qrZleceniePickerModal: null});
    await loadPracownik();
  } catch(e) {
    alert('Błąd: ' + e.message);
  }
}

async function savePermissions(uid) {
  const tabs = ALL_TABS_DEF
    .filter(td => document.getElementById('perm-' + uid + '-' + td.id)?.checked)
    .map(td => td.id);
  try {
    await put('/api/users/' + uid + '/permissions', {tabs});
    await loadAdmin();
    // Jeśli to aktualny użytkownik – odśwież jego widoczne zakładki
    if (state.user && state.user.id === uid) {
      setState({currentUserTabs: tabs});
    }
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function resetPermissions(uid) {
  if (!confirm('Przywrócić domyślne uprawnienia (wg roli) dla tego użytkownika?')) return;
  try {
    await del('/api/users/' + uid + '/permissions');
    await loadAdmin();
    if (state.user && state.user.id === uid) {
      setState({currentUserTabs: []});
    }
  } catch(e) { alert('Błąd: ' + e.message); }
}

function saveProduktForm(id) {
  const data = {
    nazwa: document.getElementById('pr-nazwa')?.value?.trim(),
    opis: document.getElementById('pr-opis')?.value||'',
    ilosc_domyslna: parseInt(document.getElementById('pr-ilosc')?.value)||1,
    cena_szt: parseFloat(document.getElementById('pr-cena')?.value)||0,
  };
  if (!data.nazwa) { alert('Podaj nazwę produktu'); return; }
  if (id) data.id = id;
  saveProdukt(data);
}

// ══════════════════════════════════════════════════════════════

async function loadAdminLogi() {
  setState({adminLogi: null});
  render();
  try {
    const data = await get('/api/admin/logi');
    setState({adminLogi: data.logi || []});
  } catch(e) {
    setState({adminLogi: []});
    console.error('Błąd ładowania logów:', e);
  }
  render();
}
