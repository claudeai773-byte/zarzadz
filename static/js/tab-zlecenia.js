//  TAB: ZLECENIA (planowanie)
// ══════════════════════════════════════════════════════════════
function loadStawkiZlecenia() {
  // Stawki są już ładowane w loadAdmin, ale dla zakładki zlecenia też potrzebujemy
  if (!state.stawki || !state.stawki.length) {
    get('/api/stawki').then(d => setState({stawki: d}, true)).catch(()=>{});
  }
}

function renderStawkiPanel() {
  let html = `<button class="btn btn-accent" style="margin-bottom:12px" onclick="setState({stawkaModal:{}})">+ Nowa stawka</button>`;
  if (!state.stawki || !state.stawki.length) {
    html += '<div class="empty">Brak stawek – dodaj stanowisko</div>';
    return html;
  }
  (state.stawki||[]).forEach(s => {
    html += `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">${s.stanowisko}</div>
          <div class="card-sub">${fmtPLN(s.stawka_godz)}/h${s.opis ? ' · '+s.opis : ''}${s.typ_maszyny ? ' · <span style="background:rgba(232,160,32,0.15);color:var(--accent);padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700">' + {frezarka_cnc:'🔵 Frez.CNC',tokarka_cnc:'🟢 Tok.CNC',frezarka_konw:'🔷 Frez.konw',tokarka_konw:'🟩 Tok.konw',szlifierka:'🟡 Szlif.',operacja:'🔧 Oper.'}[s.typ_maszyny] + '</span>' : ''}</div>
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
    const s = state.stawkaModal;
    const zbrAkt = s.zbrojenie_aktywne ? true : false;
    html += `
    <div class="modal-overlay">
      <div class="modal">
        <button class="modal-close" onclick="setState({stawkaModal:null})">×</button>
        <h3>${s.id?'✏ Edytuj stawkę':'+ Nowa stawka'}</h3>
        <div class="field"><label>Stanowisko</label><input id="st-stan" type="text" value="${s.stanowisko||''}"></div>
        <div class="field"><label>Stawka (zł/h)</label><input id="st-stawka" type="number" step="0.5" value="${s.stawka_godz||0}"></div>
        <div class="field"><label>Opis</label><input id="st-opis" type="text" value="${s.opis||''}"></div>
        <div style="background:var(--entry);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px">
          <div style="font-size:12px;font-weight:700;color:var(--dim);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">🏭 Typ maszyny / operacji</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px" id="st-typ-wrap">
            ${[
              {val:'frezarka_cnc',   label:'🔵 Frezarka CNC'},
              {val:'tokarka_cnc',    label:'🟢 Tokarka CNC'},
              {val:'frezarka_konw',  label:'🔷 Frezarka konw.'},
              {val:'tokarka_konw',   label:'🟩 Tokarka konw.'},
              {val:'szlifierka',     label:'🟡 Szlifierka'},
              {val:'operacja',       label:'🔧 Operacja'},
            ].map(t => `
              <button type="button"
                id="st-typ-btn-${t.val}"
                onclick="selectTypMaszyny('${t.val}')"
                style="padding:6px 12px;border-radius:20px;border:2px solid ${(s.typ_maszyny||''===t.val)?'var(--accent)':'var(--border)'};
                       background:${(s.typ_maszyny||''===t.val)?'rgba(232,160,32,0.15)':'var(--panel)'};
                       color:${(s.typ_maszyny||''===t.val)?'var(--accent)':'var(--dim)'};
                       cursor:pointer;font-size:12px;font-weight:600;transition:all .15s">
                ${t.label}
              </button>`).join('')}
          </div>
          <input type="hidden" id="st-typ" value="${s.typ_maszyny||''}">
          <div style="font-size:11px;color:var(--dim);margin-top:8px">Typ maszyny określa grupę alternatyw przy uruchamianiu sesji (zakładka Praca).</div>
        </div>
        <div style="background:var(--entry);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <input type="checkbox" id="st-zbr-akt" ${zbrAkt?'checked':''} onchange="document.getElementById('zbr-stawka-wrap').style.display=this.checked?'block':'none'" style="width:18px;height:18px;cursor:pointer">
            <label for="st-zbr-akt" style="font-size:14px;cursor:pointer">⚙ Aktywuj zbrojenie</label>
          </div>
          <div id="zbr-stawka-wrap" style="display:${zbrAkt?'block':'none'}">
            <div class="field" style="margin-bottom:0"><label>Stawka zbrojenia (zł/h)</label><input id="st-zbr-stawka" type="number" step="0.5" min="0" value="${s.zbrojenie_stawka_godz||0}"></div>
          </div>
        </div>
        <button class="btn btn-accent" onclick="saveStawkaForm(${s.id||0})">💾 Zapisz</button>
      </div>
    </div>`;
  }
  return html;
}

function renderZlecenia() {
  if (state.loading) return '<div class="spinner">⏳</div>';

  const role = state.user?.role;
  const canEdit = ['admin','technolog','majster'].includes(role);
  const zSubTab = state.zlecenieSubTab || 'lista';

  let html = '';

  // Pod-zakładki: Lista zleceń | Stawki
  if (canEdit) {
    html += `<div style="display:flex;gap:6px;margin-bottom:14px;border-bottom:1px solid var(--border);padding-bottom:10px">
      <button onclick="setState({zlecenieSubTab:'lista'})"
        style="padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:600;
               background:${zSubTab==='lista'?'var(--accent)':'var(--panel)'};color:${zSubTab==='lista'?'#1a1f2e':'var(--dim)'}">
        📋 Lista zleceń
      </button>
      <button onclick="setState({zlecenieSubTab:'stawki'});loadStawkiZlecenia()"
        style="padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:600;
               background:${zSubTab==='stawki'?'var(--accent)':'var(--panel)'};color:${zSubTab==='stawki'?'#1a1f2e':'var(--dim)'}">
        💰 Stawki
      </button>
      <button onclick="setState({zlecenieSubTab:'fakturowanie'});loadFakturowanie()"
        style="padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:600;
               background:${zSubTab==='fakturowanie'?'var(--accent)':'var(--panel)'};color:${zSubTab==='fakturowanie'?'#1a1f2e':'var(--dim)'}">
        🧾 Fakturowanie
      </button>
    </div>`;
  }

  if ((state.zlecenieSubTab || 'lista') === 'stawki') {
    return html + renderStawkiPanel();
  }

  if ((state.zlecenieSubTab || 'lista') === 'fakturowanie') {
    return html + renderFakturowanie() + renderFakturaModal() + renderFakturaPreview();
  }

  if (canEdit) {
    html += `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <button class="btn btn-accent" onclick="nzOpen()">+ Nowe zlecenie</button>
      <button class="btn btn-blue" onclick="document.getElementById('pdf-import-zlecenia').click()">📄 Import PDF</button>
      <input type="file" id="pdf-import-zlecenia" accept=".pdf" style="display:none"
        onchange="handlePdfParse(this)">
      <span style="font-size:11px;color:var(--dim);align-self:center;padding:4px 8px;background:rgba(232,160,32,0.08);border:1px dashed var(--border);border-radius:6px;line-height:1.4">📝 <em>PDF z technologią zrobioną w Grafiti</em></span>
    </div>`;
    // ── BOM Preview modal (po parsowaniu z zakładki Zlecenia) ──────────────
    if (state.importPdfPreview && !state.importPdfResult) {
      const prev = state.importPdfPreview;
      const bom  = state.importPdfBom || [];
      const bomIncluded = bom.filter(b => b.included !== false).length;
      html += `<div class="modal-overlay" style="z-index:500;align-items:center">
        <div style="background:var(--panel);border-radius:16px;width:100%;max-width:600px;max-height:88vh;overflow-y:auto;margin:20px;padding:20px 16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <div style="font-size:15px;font-weight:700">📋 Podgląd importu</div>
            <button class="modal-close" onclick="setState({importPdfPreview:null,importPdfBom:[]})">✕</button>
          </div>
          <div class="card" style="margin-bottom:10px;padding:12px 14px">
            <div style="font-size:13px"><b>${prev.numer}</b> – ${prev.nazwa}</div>
            <div style="font-size:12px;color:var(--dim);margin-top:4px">${prev.operacje.length} operacji</div>
          </div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--dim);margin-bottom:6px">Operacje</div>
          <div style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:14px">
            ${prev.operacje.map(o => `
              <div style="display:flex;justify-content:space-between;padding:6px 10px;border-bottom:1px solid var(--border);font-size:12px;background:var(--panel)">
                <span><b>${String(o.kolejnosc).padStart(3,'0')}</b> ${o.nazwa}</span>
                <span style="color:var(--dim);white-space:nowrap;margin-left:8px">${o.stanowisko}${o.czas_norma > 0 ? ' · ' + o.czas_norma + ' min' : ''}</span>
              </div>`).join('')}
          </div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--dim);margin-bottom:6px">
            📦 Wykaz materiałów BOM
            ${bom.length ? `<span style="color:var(--green);margin-left:6px">${bomIncluded} / ${bom.length} zaznaczonych</span>` : ''}
          </div>
          ${!bom.length
            ? `<div style="font-size:12px;color:var(--dim);background:var(--entry);border-radius:8px;padding:12px;margin-bottom:14px;text-align:center">⚠ Nie wykryto wykazu materiałów w tym PDF.<br><span style="font-size:11px">Możesz dodać materiały ręcznie po imporcie.</span></div>`
            : (() => {
                // Grupowanie po gatunku stali
                const byGrade = {};
                bom.forEach(m => {
                  const g = m.gatunek_stali || 'S235';
                  if (!byGrade[g]) byGrade[g] = 0;
                  if (m.included !== false) byGrade[g] += (m.masa_kg || 0);
                });
                const gradeRows = Object.entries(byGrade).map(([g, kg]) =>
                  `<span style="background:rgba(232,160,32,0.15);border:1px solid rgba(232,160,32,0.3);border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;color:var(--accent)">${g}: <b>${kg.toFixed(1)} kg</b></span>`
                ).join(' ');
                const totalKg = Object.values(byGrade).reduce((a,b)=>a+b,0);
                return `
                <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px;padding:8px 10px;background:rgba(39,174,96,0.06);border:1px solid rgba(39,174,96,0.2);border-radius:8px">
                  <span style="font-size:11px;color:var(--dim);font-weight:700;margin-right:4px">⚖ Zapotrzebowanie:</span>
                  ${gradeRows}
                  <span style="margin-left:auto;font-size:12px;font-weight:700;color:var(--green)">Σ ${totalKg.toFixed(1)} kg</span>
                </div>
                <div style="border:1px solid var(--border);border-radius:8px;margin-bottom:10px;overflow:hidden">
                <table style="width:100%;border-collapse:collapse;font-size:12px">
                  <thead><tr style="background:var(--panel);border-bottom:1px solid var(--border)">
                    <th style="padding:6px 8px;width:28px"></th>
                    <th style="padding:6px 8px;text-align:left">Materiał</th>
                    <th style="padding:6px 8px;text-align:right">Masa</th>
                    <th style="padding:6px 8px;text-align:center">Status</th>
                  </tr></thead><tbody>
                  ${bom.map((m, idx) => {
                    const included = m.included !== false;
                    const masaStr = m.masa_kg > 0 ? `<b>${m.masa_kg.toFixed(2)}</b> kg` : `<b>${m.ilosc}</b> ${m.jm}`;
                    let statusHtml = m.w_bazie
                      ? `<span style="color:var(--green);font-size:10px;font-weight:700">✓ w bazie</span>`
                      : `<span style="color:var(--blue);font-size:10px;font-weight:700">+ nowy</span>`;
                    const subInfo = [
                      m.indeks_bazy || m.kod,
                      m.gatunek_stali ? `<span style="color:var(--accent)">${m.gatunek_stali}</span>` : '',
                      m.wymiary_str ? `<span style="color:var(--dim)">${m.wymiary_str}</span>` : '',
                      m.ilosc > 1 ? `${m.ilosc} szt.` : '',
                    ].filter(Boolean).join(' · ');
                    return `<tr style="border-bottom:1px solid var(--border);opacity:${included ? 1 : 0.4}">
                      <td style="padding:6px 8px;text-align:center"><input type="checkbox" ${included ? 'checked' : ''} onchange="toggleBomItem(${idx},this.checked)"></td>
                      <td style="padding:6px 8px">
                        <div style="font-weight:600">${m.opis_bazy || m.opis}</div>
                        <div style="font-size:10px;color:var(--dim)">${subInfo}</div>
                      </td>
                      <td style="padding:6px 8px;text-align:right;white-space:nowrap">${masaStr}</td>
                      <td style="padding:6px 8px;text-align:center">${statusHtml}</td>
                    </tr>`;
                  }).join('')}
                  </tbody>
                </table>
              </div>
              <div style="font-size:11px;color:var(--dim);margin-bottom:14px">✏ Niebieskie pozycje (<b>+ nowy</b>) zostaną automatycznie dodane do bazy materiałów ze stanem 0. Masa obliczona z wymiarów (ρ=7850 kg/m³).</div>`;
              })()
          }
          <div style="display:flex;gap:8px;margin-top:4px">
            <button class="btn btn-accent" style="flex:1" onclick="confirmPdfImport()">✅ Importuj technologię${bomIncluded > 0 ? ' + BOM (' + bomIncluded + ' poz.)' : ''}</button>
            <button class="btn-outline" onclick="setState({importPdfPreview:null,importPdfBom:[]})">✕ Anuluj</button>
          </div>
        </div>
      </div>`;
    }

    if (state.importPdfParsing) {
      html += `<div style="background:rgba(232,160,32,0.08);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:12px;font-size:13px;text-align:center">⏳ Analizuję PDF...</div>`;
    }

    if (state.importPdfResult) {
      const res = state.importPdfResult;
      html += `<div style="background:${res.errors&&res.errors.length?'rgba(231,76,60,0.06)':'rgba(39,174,96,0.06)'};border:1px solid ${res.errors&&res.errors.length?'var(--red)':'var(--green)'};border-radius:8px;padding:12px 14px;margin-bottom:12px;font-size:13px">
        ${res.errors&&res.errors.length ? '⚠ Import z ostrzeżeniami' : '✅ Import zakończony'}:
        <b>${res.numer}</b> – ${res.nazwa}, <b>${res.operacje_created}</b> operacji
        · BOM: <b>${res.bom_added || 0}</b> poz.${res.bom_new_materialy > 0 ? ' (' + res.bom_new_materialy + ' nowych)' : ''}
        ${res.nowe_stanowiska&&res.nowe_stanowiska.length ? `· nowe stanowiska: <b>${res.nowe_stanowiska.join(', ')}</b>` : ''}
        ${res.errors&&res.errors.length ? `· <span style="color:var(--red)">${res.errors.join('; ')}</span>` : ''}
        <button class="btn-sm" style="margin-left:10px;background:transparent;border:none;color:var(--dim);cursor:pointer" onclick="setState({importPdfResult:null});loadZlecenia()">✕</button>
      </div>`;
    }
  }

  const zl = state.zlecenia || [];
  // Filtruj podzlecenia P – pokazuj tylko zlecenia główne G
  const podzlecenieIds = state.podzlecenieIds instanceof Set ? state.podzlecenieIds : new Set(state.podzlecenieIds || []);
  const zlGlowne = zl.filter(z => !podzlecenieIds.has(z.id));
  if (!zlGlowne.length) {
    html += `<div class="empty">Brak zleceń</div>`;
  } else {
    zlGlowne.forEach(z => {
      const przeterminowane = z.termin && new Date(z.termin) < new Date() && z.status !== 'zakonczone';
      const expanded = (state.zlecenieExpanded || {})[z.id];
      const drzewo = (state.zlecenieDrzewa || {})[z.id];

      // ── Drzewko G→P inline (hierarchiczne) ──────────────────────────────────
      let drzewoHtml = '';
      if (expanded) {
        if (!drzewo) {
          drzewoHtml = `<div style="padding:10px;text-align:center;color:var(--dim);font-size:12px">⏳ Ładowanie...</div>`;
        } else {
          const operacje       = drzewo.operacje       || [];
          const materialy      = drzewo.materialy      || [];
          const polprodukty    = drzewo.polprodukty    || [];
          const podzlecenia    = drzewo.podzlecenia_drzewo || [];

          // Pomocnik: wiersz operacji
          const renderOp = (op, indent) => {
            const stColor = op.status==='zakonczona'?'var(--green)':op.status==='oczekuje'?'var(--dim)':'var(--accent)';
            const done = op.status==='zakonczona';
            return `<div style="display:flex;align-items:center;gap:8px;padding:4px 10px 4px ${indent}px;border-bottom:1px solid rgba(46,53,72,0.4);${done?'opacity:.6':''}">
              <span style="color:${stColor};font-size:10px">●</span>
              <span style="font-size:12px;flex:1;${done?'text-decoration:line-through':''}">${op.kolejnosc}. ${op.nazwa}</span>
              ${op.stanowisko?`<span style="font-size:10px;color:var(--blue);background:rgba(52,152,219,.1);border-radius:3px;padding:1px 5px">${op.stanowisko}</span>`:''}
              ${op.czas_norma?`<span style="font-size:10px;color:var(--accent)">⏱${op.czas_norma}min</span>`:''}
              ${(op.czas_zbrojenia_min>0)?`<span style="font-size:10px;color:var(--orange)">⚙${op.czas_zbrojenia_min}min</span>`:''}
            </div>`;
          };

          // Pomocnik: wiersz materiału
          const renderMat = (m, indent) => `<div style="display:flex;align-items:center;gap:8px;padding:3px 10px 3px ${indent}px;border-bottom:1px solid rgba(46,53,72,0.3);background:rgba(243,156,18,0.03)">
            <span style="font-size:10px;color:var(--orange)">■</span>
            <span style="font-size:11px;font-weight:600;color:var(--orange);min-width:60px">${m.indeks||''}</span>
            <span style="font-size:11px;flex:1">${m.opis||''}</span>
            <span style="font-size:10px;color:var(--dim)">${m.ilosc} ${m.jednostka||''}</span>
          </div>`;

          // Pomocnik: nagłówek sekcji
          const hdr = (icon, label, indent, color) => `<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:${color||'var(--dim)'};letter-spacing:.7px;padding:5px 10px 2px ${indent}px;background:rgba(0,0,0,.12)">${icon} ${label}</div>`;

          let treeRows = '';

          // ── OPERACJE ZLECENIA GŁÓWNEGO G ─────────────────────────────────────
          if (operacje.length) {
            treeRows += hdr('🔧', `Operacje G (${operacje.length})`, 10, 'var(--dim)');
            operacje.forEach(op => { treeRows += renderOp(op, 22); });
          }

          // ── PODZLECENIA P (z zapotrzebowań wizarda) ──────────────────────────
          podzlecenia.forEach(pd => {
            const zap = pd.zap || {};
            const pid = pd.zlecenie_p_id;
            const pNumer = zap.zp_numer || zap.zlecenie_p_numer || '';
            const pNazwa = zap.zp_nazwa || zap.wyrob_nazwa || zap.wyrob_p_symbol || '';
            const pStatus = zap.zp_status || zap.zlecenie_p_status || '—';
            const pIlosc = zap.ilosc_wymagana || '';
            const pSymbol = zap.wyrob_p_symbol || pNumer;
            const stCol = pStatus==='zakonczone'?'var(--green)':pStatus==='w_toku'?'var(--accent)':'var(--dim)';
            const pOps = pd.operacje || [];
            const pMats = pd.materialy || [];
            const pSubs = pd.podzlecenia || [];

            // ── Nagłówek podzlecenia P (klikalny → modal szczegółów) ──
            const pClickAttr = pid ? `onclick="openPodZlecenieModal(${pid},${z.id})" style="display:flex;align-items:center;gap:8px;padding:6px 10px 6px 14px;border-bottom:1px solid rgba(139,92,246,0.2);border-top:1px solid rgba(139,92,246,0.15);background:rgba(139,92,246,0.08);margin-top:2px;cursor:pointer"` : `style="display:flex;align-items:center;gap:8px;padding:6px 10px 6px 14px;border-bottom:1px solid rgba(139,92,246,0.2);border-top:1px solid rgba(139,92,246,0.15);background:rgba(139,92,246,0.06);margin-top:2px"`;
            treeRows += `<div ${pClickAttr}>
              <span style="font-size:13px">◆</span>
              <span style="font-size:13px;font-weight:700;color:#a78bfa;flex:1">
                ${pNumer ? `<span style="color:#a78bfa">${pNumer}</span>` : `<span style="color:#a78bfa">${pSymbol}</span>`}
                ${pNazwa ? `<span style="color:var(--dim);font-weight:400;font-size:12px"> – ${pNazwa}</span>` : ''}
              </span>
              ${pIlosc ? `<span style="font-size:10px;color:var(--dim)">${pIlosc} szt.</span>` : ''}
              <span style="font-size:10px;padding:1px 7px;border-radius:4px;background:rgba(139,92,246,0.15);color:${stCol};font-weight:700">${pStatus}</span>
              ${pid ? `<span style="font-size:10px;color:#a78bfa;margin-left:2px">▶</span>` : ''}
            </div>`;

            // Operacje podzlecenia P
            if (pOps.length) {
              treeRows += hdr('🔧', `Operacje (${pOps.length})`, 28, '#8b7fd0');
              pOps.forEach(op => { treeRows += renderOp(op, 36); });
            } else if (pid) {
              treeRows += `<div style="padding:4px 10px 4px 28px;font-size:11px;color:var(--dim);font-style:italic">Brak operacji – <span style="color:#a78bfa;cursor:pointer" onclick="openPodZlecenieModal(${pid},${z.id})">kliknij ◆ by edytować</span></div>`;
            }

            // Materiały podzlecenia P
            if (pMats.length) {
              treeRows += hdr('📦', `Materiały (${pMats.length})`, 28, '#8b7fd0');
              pMats.forEach(m => { treeRows += renderMat(m, 36); });
            } else if (pid) {
              treeRows += `<div style="padding:2px 10px 4px 28px;font-size:11px;color:var(--dim);font-style:italic">Brak materiałów</div>`;
            }

            // Zagnieżdżone sub-podzlecenia P
            pSubs.forEach(sub => {
              const szap = sub.zap || {};
              const sNumer = szap.zp_numer || szap.zlecenie_p_numer || '';
              const sNazwa = szap.zp_nazwa || szap.wyrob_nazwa || szap.wyrob_p_symbol || '';
              const sStatus = szap.zp_status || szap.zlecenie_p_status || '—';
              const sSymbol = szap.wyrob_p_symbol || sNumer;
              const sCol = sStatus==='zakonczone'?'var(--green)':sStatus==='w_toku'?'var(--accent)':'var(--dim)';
              const sOps = sub.operacje || [];
              const sMats = sub.materialy || [];
              const subPid = szap.zlecenie_p_id || szap.zp_id || sub.zlecenie_p_id;

              // Nagłówek sub-podzlecenia (klikalny)
              const sClickAttr = subPid ? `onclick="openPodZlecenieModal(${subPid},${z.id})" style="display:flex;align-items:center;gap:8px;padding:5px 10px 5px 28px;border-bottom:1px solid rgba(139,92,246,0.12);background:rgba(139,92,246,0.04);cursor:pointer"` : `style="display:flex;align-items:center;gap:8px;padding:5px 10px 5px 28px;border-bottom:1px solid rgba(139,92,246,0.12);background:rgba(139,92,246,0.03)"`;
              treeRows += `<div ${sClickAttr}>
                <span style="font-size:11px;color:#7c68c8">◆</span>
                <span style="font-size:12px;font-weight:700;color:#9b8be8;flex:1">
                  ${sNumer ? sNumer : sSymbol}
                  ${sNazwa ? `<span style="color:var(--dim);font-weight:400;font-size:11px"> – ${sNazwa}</span>` : ''}
                </span>
                <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(139,92,246,0.1);color:${sCol};font-weight:700">${sStatus}</span>
                ${subPid ? `<span style="font-size:10px;color:#9b8be8;margin-left:2px">▶</span>` : ''}
              </div>`;

              // Operacje sub-podzlecenia
              if (sOps.length) {
                treeRows += hdr('🔧', `Operacje (${sOps.length})`, 42, '#6b5fa0');
                sOps.forEach(op => { treeRows += renderOp(op, 50); });
              } else if (subPid) {
                treeRows += `<div style="padding:3px 10px 3px 42px;font-size:11px;color:var(--dim);font-style:italic">Brak operacji</div>`;
              }

              // Materiały sub-podzlecenia
              if (sMats.length) {
                treeRows += hdr('📦', `Materiały (${sMats.length})`, 42, '#6b5fa0');
                sMats.forEach(m => { treeRows += renderMat(m, 50); });
              } else if (subPid) {
                treeRows += `<div style="padding:2px 10px 3px 42px;font-size:11px;color:var(--dim);font-style:italic">Brak materiałów</div>`;
              }
            });
          });

          // ── PÓŁPRODUKTY P (stare – z tablicy zlecenie_polprodukty, bez powiązanego zlecenia) ──
          if (polprodukty.length) {
            treeRows += hdr('🔩', `Półprodukty P (${polprodukty.length})`, 10, 'var(--dim)');
            polprodukty.forEach(p => {
              treeRows += `<div style="display:flex;align-items:center;gap:8px;padding:4px 10px 4px 22px;border-bottom:1px solid rgba(46,53,72,0.5)">
                <span style="font-size:11px;color:#a78bfa">◆</span>
                <span style="font-size:12px;flex:1"><b style="color:#a78bfa">${p.symbol}</b> – ${p.nazwa}</span>
                <span style="font-size:11px;color:var(--dim)">${p.ilosc} ${p.jednostka}</span>
                ${canEdit ? `<button onclick="openEditPolprodukt(${z.id},${JSON.stringify(p).replace(/"/g,'&quot;')})" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:13px;padding:0 4px">✏</button>
                <button onclick="deletePolprodukt(${z.id},${p.id})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:13px;padding:0 4px">🗑</button>` : ''}
              </div>`;
            });
          }

          // ── MATERIAŁY BEZPOŚREDNIO DLA G ─────────────────────────────────────
          if (materialy.length) {
            treeRows += hdr('📦', `Materiały G (${materialy.length})`, 10, 'var(--dim)');
            materialy.forEach(m => {
              treeRows += `<div style="display:flex;align-items:center;gap:8px;padding:4px 10px 4px 22px;border-bottom:1px solid rgba(46,53,72,0.5)">
                <span style="font-size:11px;color:var(--orange)">■</span>
                <span style="font-size:12px;flex:1"><b style="color:var(--orange)">${m.indeks}</b> – ${m.opis}</span>
                <span style="font-size:11px;color:var(--dim)">${m.ilosc} ${m.jednostka}</span>
                ${canEdit ? `<button onclick="openEditMaterial(${z.id},${JSON.stringify(m).replace(/"/g,'&quot;')})" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:13px;padding:0 4px">✏</button>
                <button onclick="deleteMaterialZlecenia(${z.id},${m.id})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:13px;padding:0 4px">🗑</button>` : ''}
              </div>`;
            });
          }

          if (!treeRows) {
            treeRows = `<div style="text-align:center;padding:12px;color:var(--dim);font-size:12px">Brak operacji, podzleceń ani materiałów.</div>`;
          }

          drzewoHtml = `<div style="background:var(--entry);border-radius:0 0 8px 8px;border-top:1px solid var(--border);margin-top:4px">
            ${treeRows}
          </div>`;
        }
      }

      html += `
      <div class="card" style="${przeterminowane?'border-color:var(--red)':''}padding-bottom:${expanded?'0':''}">
        <div class="card-header" style="cursor:pointer" onclick="toggleZlecenieExpand(${z.id})">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:13px;color:var(--dim);transition:transform .2s;display:inline-block;transform:${expanded?'rotate(90deg)':'rotate(0deg)'}">▶</span>
              <span class="card-title">${z.numer} ${przeterminowane?'<span class="badge badge-red">TERMIN!</span>':''}</span>
            </div>
            <div class="card-sub" style="margin-left:21px">${z.nazwa}</div>
            ${z.termin ? `<div class="card-sub" style="margin-left:21px">📅 ${fmtDate(z.termin)}</div>` : ''}
            ${(() => { if (!z.pozostale_min || z.status==='zakonczone') return ''; const est = new Date(Date.now() + z.pozostale_min*60*1000); return `<div class="card-sub" style="color:var(--blue);margin-left:21px">🕐 Szac. koniec: ${fmtEstimatedKoniec(est)}</div>`; })()}
            <div class="card-sub" style="margin-left:21px">📦 ${z.ilosc_sztuk} szt. ${z.cena_brutto_szt ? '| '+fmtPLN(z.cena_brutto_szt)+'/szt' : ''}</div>
          </div>
          ${statusBadge(z.status)}
        </div>
        ${drzewoHtml}
        ${canEdit ? `
        <div class="btn-row" style="margin-top:8px;flex-wrap:wrap;gap:6px">
          <button class="btn-sm btn-blue" onclick="nzOpenEdit(${z.id})">✏ Edytuj</button>
          <button class="btn-sm btn-accent" onclick="openOperacje(${JSON.stringify(z).replace(/"/g,'&quot;')})">🔧 Operacje</button>
          <button class="btn-sm btn-green" onclick="loadKoszty(${z.id})">💰 Koszty</button>
          <button class="btn-sm" style="background:#1a6b3a;color:#fff" onclick="generateRaportSingleZlecenie(${z.id}, '${(z.numer||'').replace(/'/g,"\\'")}')">📊 Raport</button>
          <button class="btn-sm btn-accent" style="background:var(--orange,#e67e00);color:#1a1f2e" onclick="openStawkiZleceniaModal(${z.id}, '${(z.numer||'').replace(/'/g,"\\'")}', '${(z.nazwa||'').replace(/'/g,"\\'")}')">⚙ Stawki</button>
          <select style="background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:12px"
                  onchange="changeZlecenieStatus(${z.id},this.value);this.value='${z.status}'">
            <option value="${z.status}" disabled selected>▶ Status</option>
            <option value="nowe">nowe</option>
            <option value="w_toku">w_toku</option>
            <option value="zakonczone">zakonczone</option>
            <option value="anulowane">anulowane</option>
          </select>
          <button class="btn-sm btn-accent" onclick="showQRForZlecenie(${JSON.stringify(z).replace(/"/g,'&quot;')})">📷 QR</button>
          <button class="btn-sm btn-green" onclick="openKartaModal(${JSON.stringify(z).replace(/"/g,'&quot;')})">🖨 Karta</button>
          <button class="btn-sm btn-red" onclick="deleteZlecenie(${z.id})">🗑</button>
        </div>` : ''}
      </div>`;
    });
  }

  // Modal P/M (dodawanie/edycja inline)
  html += renderPolproduktModal();
  html += renderMaterialZleceniaModal();
  html += renderPodZlecenieModal();

  // Modal wizard nowe zlecenie
  if (state.nzModal) {
    html += renderNzWizard();
  }

  // Modal drzewa G→P zlecenia
  html += renderZlDrzewoModal();

  // Modal zlecenie
  if (state.zlecenieModal !== null) {
    const z = state.zlecenieModal;
    const isNew = !z.id;

    // ── Kolumna PRAWA: Struktura G→P z przyciskami STEP ──────────────────────
    const rightColContent = (() => {
      const headerBtns = z.id && z.zlTree && z.zlTree !== 'brak'
        ? `<button class="btn-sm" style="background:var(--entry);color:var(--dim);border:1px solid var(--border)" onclick="setState({zlecenieModal:{...state.zlecenieModal,zlTree:null,zlTreeLoading:false}})">↺</button>`
        : '';
      let treeHtml;
      if (!z.id) {
        treeHtml = `<div style="background:var(--entry);border:1px dashed var(--border);border-radius:8px;padding:12px;font-size:12px;color:var(--dim);text-align:center">Zapisz zlecenie, aby zobaczyć strukturę G→P</div>`;
      } else if (z.zlTreeLoading) {
        treeHtml = `<div style="text-align:center;padding:24px;color:var(--dim);font-size:12px">⏳ Ładowanie struktury...</div>`;
      } else if (!z.zlTree) {
        treeHtml = `<div style="background:var(--entry);border:1px dashed var(--border);border-radius:8px;padding:12px;text-align:center">
          <button onclick="zlModalLoadTree()" style="background:var(--blue);color:#fff;border:none;padding:8px 18px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700">🌳 Wczytaj strukturę G→P</button>
        </div>`;
      } else if (z.zlTree === 'brak') {
        treeHtml = `<div style="background:var(--entry);border:1px dashed var(--border);border-radius:8px;padding:12px;font-size:12px;color:var(--dim)">Brak struktury G→P dla wyrobu <strong>${z.numer}</strong> w bazie drzew.</div>`;
      } else {
        treeHtml = `<div style="background:var(--entry);border-radius:10px;padding:8px;overflow-x:auto;max-height:calc(100vh - 240px);overflow-y:auto">${renderZlModalGPTree(z.zlTree, z.id, z.ilosc_sztuk || 1)}</div>`;
      }

      // STEP dla głównego zlecenia G
      const stepG = z.model_3d_url;
      const stepGRow = `
        <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:8px 10px;margin-bottom:10px">
          <div style="font-size:11px;font-weight:700;color:#60a5fa;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">📐 Plik STEP – G: ${z.numer||'—'}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            ${stepG
              ? `<button onclick="openStep3DViewer('${stepG.replace(/'/g,"\\'")}') " style="background:rgba(59,130,246,0.15);border:1px solid #3b82f640;color:#60a5fa;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer">🧊 Podgląd</button>
                 <button onclick="zlModalUploadStepG(${z.id})" style="background:rgba(139,92,246,0.12);border:1px solid #8b5cf640;color:#a78bfa;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer">📎 Zmień STEP</button>
                 <span style="font-size:11px;color:var(--dim)">✅ Wgrany</span>`
              : `<button onclick="zlModalUploadStepG(${z.id})" style="background:rgba(139,92,246,0.15);border:1px solid #8b5cf660;color:#a78bfa;border-radius:6px;padding:5px 14px;font-size:12px;cursor:pointer;font-weight:700">📎 Wgraj plik STEP</button>`
            }
            <div id="zl-stepg-status" style="font-size:11px;color:var(--dim)"></div>
          </div>
          <input type="hidden" id="zl-model3d" value="${stepG||''}">
        </div>`;

      return `
        <div style="font-size:12px;font-weight:700;color:#60a5fa;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;display:flex;align-items:center;gap:6px">
          🌳 Struktura G → P ${headerBtns}
        </div>
        ${stepGRow}
        ${treeHtml}`;
    })();

    html += `
    <div class="modal-overlay" style="align-items:flex-start;padding:10px">
      <div style="background:var(--panel);border-radius:14px;width:100%;max-width:1100px;max-height:96vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px #000a">
        <!-- Nagłówek -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px 12px;border-bottom:1px solid var(--border);flex-shrink:0">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:18px">🔧</span>
            <div>
              <div style="font-size:16px;font-weight:700;color:var(--accent)">${z.id ? '✏ Edytuj zlecenie produkcyjne' : '+ Nowe zlecenie produkcyjne'}</div>
              ${z.id ? `<div style="font-size:12px;color:var(--dim)">${z.numer} – ${z.nazwa||''}</div>` : ''}
            </div>
          </div>
          <button onclick="setState({zlecenieModal:null})" style="background:var(--entry);border:none;color:var(--text);font-size:20px;width:36px;height:36px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">×</button>
        </div>

        <!-- Dwie kolumny -->
        <div style="display:flex;flex:1;overflow:hidden;gap:0">

          <!-- LEWA: Dane zlecenia -->
          <div style="flex:0 0 380px;min-width:280px;max-width:400px;overflow-y:auto;padding:14px 16px;border-right:1px solid var(--border)">
            <div style="font-size:10px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px;display:flex;align-items:center;gap:6px">
              📋 Dane zlecenia
            </div>

            ${isNew ? `
            <div style="background:var(--entry);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:12px">
              <div style="font-size:11px;color:var(--dim);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">📂 Autouzupełnienie ze wzorca</div>
              <input id="zl-search" type="text" placeholder="Wpisz numer lub nazwę..."
                     style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box"
                     oninput="filterZleceniaSearch(this.value)" onfocus="filterZleceniaSearch(this.value)">
              <div id="zl-search-results" style="margin-top:6px"></div>
              ${state.autofillOperacje && state.autofillOperacje.length ? `
              <div style="margin-top:8px;background:rgba(39,174,96,0.08);border:1px solid var(--green);border-radius:6px;padding:8px 10px;">
                <div style="font-size:11px;font-weight:700;color:var(--green);margin-bottom:4px">✅ Operacje (${state.autofillOperacje.length}):</div>
                ${state.autofillOperacje.slice(0,4).map(op => `<div style="font-size:11px;padding:1px 0;color:var(--dim)">${op.kolejnosc}. ${op.nazwa}</div>`).join('')}
                ${state.autofillOperacje.length > 4 ? `<div style="font-size:11px;color:var(--dim)">+ ${state.autofillOperacje.length - 4} więcej...</div>` : ''}
              </div>` : ''}
              ${state.autofillStepUrl ? `<div style="margin-top:6px;font-size:11px;color:#9b59b6;background:rgba(155,89,182,0.08);border:1px solid #9b59b6;border-radius:6px;padding:6px 10px;font-weight:700">📐 Plik STEP zostanie przypisany z wzorca</div>` : ''}
            </div>` : ''}

            <div class="field"><label>Numer zlecenia *</label><input id="zl-numer" type="text" value="${z.numer||''}"></div>
            <div class="field"><label>Nazwa zlecenia *</label><input id="zl-nazwa" type="text" value="${z.nazwa||''}"></div>
            <div class="field"><label>Opis</label><textarea id="zl-opis" style="min-height:56px">${z.opis||''}</textarea></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div class="field"><label>Termin</label><input id="zl-termin" type="date" value="${z.termin||''}"></div>
              <div class="field"><label>Ilość sztuk</label><input id="zl-ilosc" type="number" value="${z.ilosc_sztuk||1}" min="1"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div class="field"><label>Cena brutto/szt (zł)</label><input id="zl-cena" type="number" step="0.01" value="${z.cena_brutto_szt||0}"></div>
              <div class="field">
                <label>Materiał od klienta</label>
                <select id="zl-mat" onchange="toggleBomSection(this.value)">
                  <option value="0" ${!z.material_od_klienta?'selected':''}>Nie – definiuję materiał</option>
                  <option value="1" ${z.material_od_klienta?'selected':''}>Tak – klient dostarcza</option>
                </select>
              </div>
            </div>

            <!-- BOM -->
            <div id="zl-bom-section" style="display:${z.material_od_klienta ? 'none' : 'block'}">
              ${z.id ? renderBomSection(z.id) : '<div style="background:var(--entry);border:1px dashed var(--accent);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:var(--dim)">📦 <b>BOM</b> – Zapisz zlecenie, aby zdefiniować materiały</div>'}
            </div>

            <!-- Półprodukty P -->
            <div style="margin-bottom:10px">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#a78bfa;letter-spacing:.5px;margin-bottom:6px;display:flex;align-items:center;gap:6px">
                🔩 Półprodukty P
                ${z.id ? `<button class="btn-sm" style="background:rgba(167,139,250,0.15);color:#a78bfa;border:1px solid rgba(167,139,250,0.3);margin-left:auto" onclick="openAddPolprodukt(${z.id})">+ Dodaj</button>` : ''}
              </div>
              ${z.id ? `<div id="pm-polprodukty-list-${z.id}">${renderPolproduktList(z.id)}</div>`
                     : `<div style="background:var(--entry);border:1px dashed rgba(167,139,250,0.4);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--dim)">Zapisz zlecenie, aby dodać półprodukty P</div>`}
            </div>

            <!-- Materiały M -->
            <div style="margin-bottom:10px">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--orange);letter-spacing:.5px;margin-bottom:6px;display:flex;align-items:center;gap:6px">
                📦 Materiały M
                ${z.id ? `<button class="btn-sm" style="background:rgba(243,156,18,0.12);color:var(--orange);border:1px solid rgba(243,156,18,0.3);margin-left:auto" onclick="openAddMaterial(${z.id})">+ Dodaj</button>` : ''}
              </div>
              ${z.id ? `<div id="pm-materialy-list-${z.id}">${renderMaterialList(z.id)}</div>`
                     : `<div style="background:var(--entry);border:1px dashed rgba(243,156,18,0.4);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--dim)">Zapisz zlecenie, aby dodać materiały M</div>`}
            </div>

            <!-- Produkty/Zakupy -->
            ${z.id ? renderProduktyZleceniaForm(z.id) : '<div style="background:var(--entry);border:1px dashed var(--border);border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:var(--dim)">💡 Zapisz zlecenie, aby móc dodać produkty/zakupy</div>'}

            <button class="btn btn-accent" style="width:100%;margin-top:6px" onclick="saveZlecenieForm(${z.id||0})">💾 Zapisz zlecenie</button>
          </div>

          <!-- PRAWA: Struktura G→P -->
          <div style="flex:1;min-width:0;overflow-y:auto;padding:14px 16px">
            ${rightColContent}
          </div>

        </div>
      </div>
    </div>`;
  }

  // Modal operacje
  if (state.operacjeModal) {
    html += renderOperacjeModal();
  }

  // Modal korekty czasu sesji – renderowany globalnie przez renderEditSesjaModalHtml()

  // Modal koszty
  if (state.zlecenieKoszty) {
    html += renderKosztyModal();
  }

  return html;
}

function renderEditSesjaModalHtml() {
  if (!state.editSesjaModal) return '';
  const esm = state.editSesjaModal;
  const toLocal = (iso) => {
    if (!iso) return '';
    // Jeśli string nie ma Z ani +, traktuj jako lokalny (serwer zwraca czas lokalny bez strefy)
    const hasTimezone = iso.endsWith('Z') || iso.includes('+') || /[0-9]-[0-9]{2}:[0-9]{2}$/.test(iso);
    const d = hasTimezone ? new Date(iso) : new Date(iso.replace('T',' '));
    if (isNaN(d)) return '';
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return `<div class="modal-overlay" onclick="if(event.target===this)setState({editSesjaModal:null})">
      <div class="modal">
        <button class="modal-close" onclick="setState({editSesjaModal:null})">×</button>
        <h3>✏ Korekta czasu sesji #${esm.sesja_id}</h3>
        <div style="font-size:12px;color:var(--dim);margin-bottom:14px">Dostępne dla majstra i admina. Wpisz skorygowane czasy w strefie lokalnej.</div>
        <div class="field"><label>Czas rozpoczęcia</label>
          <input id="esm-start" type="datetime-local" value="${toLocal(esm.start_time)}"
                 style="background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px;width:100%;box-sizing:border-box">
        </div>
        <div class="field"><label>Czas zakończenia <span style="color:var(--dim)">(zostaw puste jeśli sesja aktywna)</span></label>
          <input id="esm-end" type="datetime-local" value="${toLocal(esm.end_time)}"
                 style="background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px;width:100%;box-sizing:border-box">
        </div>
        <button class="btn btn-accent" onclick="saveEditSesjaModal()">💾 Zapisz korektę</button>
      </div>
    </div>`;
}

function openEditSesjaModal(sesjaId, startTime, endTime) {
  setState({editSesjaModal: {sesja_id: sesjaId, start_time: startTime, end_time: endTime || ''}});
}

async function saveEditSesjaModal() {
  const esm = state.editSesjaModal;
  if (!esm) return;
  const toISO = (localVal) => {
    if (!localVal) return null;
    // datetime-local daje "YYYY-MM-DDTHH:MM" w strefie lokalnej – konwertujemy do UTC
    const d = new Date(localVal + ':00');
    return d.toISOString();
  };
  const startVal = document.getElementById('esm-start')?.value;
  const endVal   = document.getElementById('esm-end')?.value;
  if (!startVal) { alert('Czas rozpoczęcia jest wymagany'); return; }
  try {
    const r = await fetch(SERVER_URL.replace(/\/$/, '') + '/api/sesje/' + esm.sesja_id + '/czas', {
      method: 'PATCH',
      headers: {'Content-Type':'application/json','x-api-key': API_KEY},
      body: JSON.stringify({
        start_time: toISO(startVal),
        end_time:   toISO(endVal) || null,
      })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({detail: r.statusText}));
      throw new Error(err.detail || r.statusText);
    }
    setState({editSesjaModal: null});
    // Odśwież widok, z którego otwarto modal
    if (state.majsterSubTab === 'wydajnosc') {
      await loadWydajnoscMajster(state.wydajnoscOkres);
    } else {
      await loadMajster();
    }
  } catch(e) {
    alert('Błąd korekty czasu: ' + e.message);
  }
}

async function deleteSesjaConfirm(sesjaId) {
  if (!confirm('Na pewno usunąć tę sesję pracy? Operacja jest nieodwracalna.')) return;
  try {
    const r = await fetch(SERVER_URL.replace(/\/$/, '') + '/api/sesje/' + sesjaId, {
      method: 'DELETE',
      headers: {'x-api-key': API_KEY}
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({detail: r.statusText}));
      throw new Error(err.detail || r.statusText);
    }
    if (state.majsterSubTab === 'wydajnosc') {
      await loadWydajnoscMajster(state.wydajnoscOkres);
    } else {
      await loadMajster();
    }
  } catch(e) {
    alert('Błąd usuwania sesji: ' + e.message);
  }
}

function filterZleceniaSearch(query) {
  const container = document.getElementById('zl-search-results');
  if (!container) return;
  const q = query.trim().toLowerCase();
  const zl = state.zlecenia || [];
  const filtered = q.length < 1 ? [] : zl.filter(z =>
    z.numer.toLowerCase().includes(q) || z.nazwa.toLowerCase().includes(q)
  ).slice(0, 8);
  if (!filtered.length) { container.innerHTML = ''; return; }
  container.innerHTML = filtered.map(z => `
    <div onclick="autofillZlecenie(${z.id})"
         style="padding:8px 10px;cursor:pointer;border-radius:6px;border:1px solid var(--border);
                background:var(--panel);margin-bottom:4px;font-size:13px;
                display:flex;justify-content:space-between;align-items:center"
         onmouseover="this.style.borderColor='var(--accent)'"
         onmouseout="this.style.borderColor='var(--border)'">
      <div>
        <span style="font-weight:700;color:var(--accent)">${z.numer}</span>
        <span style="color:var(--dim);margin-left:8px">${z.nazwa}</span>
      </div>
      <span style="font-size:11px;color:var(--dim)">📋 wczytaj</span>
    </div>`).join('');
}

function autofillZlecenie(id) {
  const z = (state.zlecenia||[]).find(x => x.id === id);
  if (!z) return;
  // Numer: sugeruj nowy numer na podstawie wzorca (z sufiksem -K + pełny timestamp)
  const baseNumer = (z.numer || '').replace(/-K\d+$/, '');
  const numerSufx = baseNumer + '-K' + Date.now();
  // Zapisz dane autouzupełnienia do state.zlecenieModal – dzięki temu
  // po re-renderze (np. po załadowaniu operacji) pola nie zostaną wyczyszczone
  const autofillData = {
    numer: numerSufx,
    nazwa: z.nazwa || '',
    opis: z.opis || '',
    termin: z.termin ? z.termin.substring(0,10) : '',
    ilosc_sztuk: z.ilosc_sztuk || 1,
    cena_brutto_szt: z.cena_brutto_szt || 0,
    material_od_klienta: z.material_od_klienta || 0,
  };
  // Aktualizuj zlecenieModal (bez id – to nowe zlecenie) tak aby re-render
  // użył tych wartości zamiast pustych
  setState({
    zlecenieModal: autofillData,
    autofillSourceId: id,
    autofillOperacje: [],
  });
  // Focus na polu numeru po renderze
  setTimeout(() => { const el = document.getElementById('zl-numer'); if (el) { el.focus(); el.select(); } }, 80);
  // Załaduj operacje z wzorcowego zlecenia
  fetchAutofillOperacje(id);
}

let _autofillToken = 0;

async function fetchAutofillOperacje(zid) {
  const myToken = ++_autofillToken;
  try {
    const [ops, produkty] = await Promise.all([
      get(`/api/zlecenia/${zid}/operacje`),
      get(`/api/zlecenia/${zid}/produkty`).catch(() => []),
    ]);
    // Ignoruj wynik jeśli w międzyczasie wybrano inne zlecenie do autofill
    if (myToken !== _autofillToken) return;
    // Pobierz też plik STEP ze wzorcowego zlecenia
    const srcZlecenie = (state.zlecenia||[]).find(z => z.id === zid);
    const stepUrl = srcZlecenie?.model_3d_url || null;
    // Aktualizuj dane autofill + zapowiedź produktów i STEP
    const currentModal = state.zlecenieModal || {};
    setState({
      autofillOperacje: ops,
      autofillProdukty: produkty,
      autofillStepUrl: stepUrl,
      zlecenieModal: {...currentModal, model_3d_url: stepUrl},
    });
    // Zaktualizuj ukryty input model_3d i info-box
    setTimeout(() => {
      const hiddenInput = document.getElementById('zl-model3d');
      const infoBox = document.getElementById('zl-model3d-info');
      const uploadArea = document.getElementById('zl-model3d-upload-area');
      if (hiddenInput) hiddenInput.value = stepUrl || '';
      if (infoBox && uploadArea) {
        if (stepUrl) {
          infoBox.style.display = 'flex';
          uploadArea.style.display = 'none';
        } else {
          infoBox.style.display = 'none';
          uploadArea.style.display = '';
        }
      }
    }, 100);
  } catch(e) {
    if (myToken !== _autofillToken) return;
    setState({autofillOperacje: [], autofillProdukty: [], autofillStepUrl: null});
  }
}

function renderProduktyZleceniaForm(zid) {
  const produkty = state.produktyZlecenia || [];
  const koszt = produkty.reduce((a, p) => a + (parseFloat(p.ilosc)||0)*(parseFloat(p.cena)||0), 0);
  let html = '<div style="background:var(--entry);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:14px">'
    + '<div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">🛒 Produkty / Zakupy pod zlecenie</div>';
  if (produkty.length) {
    produkty.forEach(p => {
      const wartosc = (parseFloat(p.ilosc)||0)*(parseFloat(p.cena)||0);
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:12px">'
        + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + p.nazwa + '</span>'
        + '<span style="color:var(--dim);white-space:nowrap">' + p.ilosc + ' szt. × ' + fmtPLN(p.cena) + '</span>'
        + '<span style="color:var(--accent);font-weight:700;white-space:nowrap;min-width:70px;text-align:right">' + fmtPLN(wartosc) + '</span>'
        + '<button class="btn-sm btn-red" style="padding:2px 7px;font-size:11px" onclick="deleteProduktZlecenia(' + zid + ',' + p.id + ')">✕</button>'
        + '</div>';
    });
    html += '<div style="border-top:1px solid var(--border);padding-top:6px;font-size:12px;display:flex;justify-content:space-between">'
      + '<span style="color:var(--dim)">Łączny koszt produktów:</span>'
      + '<span style="color:var(--accent);font-weight:700">' + fmtPLN(koszt) + '</span>'
      + '</div>';
  } else {
    html += '<div style="font-size:12px;color:var(--dim);margin-bottom:8px">Brak dodanych produktów</div>';
  }
  html += '<div style="display:grid;grid-template-columns:1fr auto auto;gap:6px;margin-top:10px;align-items:end">'
    + '<div><div style="font-size:11px;color:var(--dim);margin-bottom:3px">Nazwa produktu</div>'
    + '<input id="pr-zl-nazwa" type="text" placeholder="np. Frez R4, Wiertło..." style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 8px;font-size:12px;box-sizing:border-box"></div>'
    + '<div><div style="font-size:11px;color:var(--dim);margin-bottom:3px">Ilość</div>'
    + '<input id="pr-zl-ilosc" type="number" value="1" min="0.01" step="0.01" style="width:70px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 8px;font-size:12px"></div>'
    + '<div><div style="font-size:11px;color:var(--dim);margin-bottom:3px">Cena (zł)</div>'
    + '<input id="pr-zl-cena" type="number" value="0" min="0" step="0.01" style="width:80px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 8px;font-size:12px"></div>'
    + '</div>'
    + '<button class="btn btn-green" style="margin-top:8px;padding:8px" onclick="addProduktZlecenia(' + zid + ')">+ Dodaj produkt</button>'
    + '</div>';
  return html;
}

async function loadProduktyZlecenia(zid) {
  try {
    const data = await get('/api/zlecenia/' + zid + '/produkty');
    setState({produktyZlecenia: data});
  } catch(e) { setState({produktyZlecenia: []}); }
}

async function addProduktZlecenia(zid) {
  const nazwa = document.getElementById('pr-zl-nazwa')?.value?.trim();
  if (!nazwa) { alert('Podaj nazwę produktu'); return; }
  const ilosc = parseFloat(document.getElementById('pr-zl-ilosc')?.value)||1;
  const cena = parseFloat(document.getElementById('pr-zl-cena')?.value)||0;
  try {
    await post('/api/zlecenia/' + zid + '/produkty', {zlecenie_id: zid, nazwa, ilosc, cena});
    await loadProduktyZlecenia(zid);
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function deleteProduktZlecenia(zid, pid) {
  if (!confirm('Usunąć produkt?')) return;
  try {
    await del('/api/zlecenia/' + zid + '/produkty/' + pid);
    await loadProduktyZlecenia(zid);
  } catch(e) { alert('Błąd: ' + e.message); }
}


function toggleBomSection(val) {
  // Przełącz widoczność sekcji BOM bez re-renderowania całego modalu
  const bomSection = document.getElementById('zl-bom-section');
  if (bomSection) {
    bomSection.style.display = (val === '1') ? 'none' : 'block';
  }
}

function saveZlecenieForm(id) {
  const data = {
    numer: document.getElementById('zl-numer').value.trim(),
    nazwa: document.getElementById('zl-nazwa').value.trim(),
    opis: document.getElementById('zl-opis').value,
    termin: document.getElementById('zl-termin').value || null,
    ilosc_sztuk: parseInt(document.getElementById('zl-ilosc').value)||1,
    cena_brutto_szt: parseFloat(document.getElementById('zl-cena').value)||0,
    material_od_klienta: parseInt(document.getElementById('zl-mat').value)||0,
    model_3d_url: document.getElementById('zl-model3d')?.value?.trim() || null,
  };
  if (!data.numer||!data.nazwa) { alert('Numer i nazwa są wymagane'); return; }
  if (id) data.id = id;
  saveZlecenie(data);
}

async function openEditZlecenie(z) {
  if (z && z.id) {
    await loadProduktyZlecenia(z.id);
    // Załaduj drzewo P/M/operacje – bez tego renderPolproduktList i renderMaterialList są puste
    try {
      const [drzewo, matsM] = await Promise.all([
        get(`/api/zlecenia/${z.id}/drzewo`),
        get(`/api/zlecenia/${z.id}/materialy-zlecenia`).catch(() => []),
      ]);
      if (!drzewo.materialy || drzewo.materialy.length === 0) {
        drzewo.materialy = matsM || [];
      }
      setState({ zlecenieDrzewa: { ...(state.zlecenieDrzewa || {}), [z.id]: drzewo } }, true);
    } catch(_) {}
    // Przeładuj BOM jeśli był w cache
    loadBom(z.id);
  }
  setState({zlecenieModal: z});
}

async function openEditZlecenieById(zid) {
  // Zawsze pobierz bezpośrednio z API – unika błędów gdy zlecenie P nie jest w state.zlecenia
  let z = null;
  try {
    z = await get(`/api/zlecenia/${zid}`);
  } catch(e) {
    try {
      const lista = await get('/api/zlecenia');
      setState({zlecenia: lista}, true);
      z = lista.find(x => x.id === zid);
    } catch(e2) { alert('Blad: ' + e2.message); return; }
  }
  if (!z) { alert('Nie znaleziono zlecenia #' + zid); return; }
  await loadProduktyZlecenia(z.id);
  try {
    const [drzewo, matsM] = await Promise.all([
      get(`/api/zlecenia/${zid}/drzewo`),
      get(`/api/zlecenia/${zid}/materialy-zlecenia`).catch(() => []),
    ]);
    if (!drzewo.materialy || drzewo.materialy.length === 0) {
      drzewo.materialy = matsM || [];
    }
    setState({ zlecenieDrzewa: { ...(state.zlecenieDrzewa || {}), [zid]: drzewo } }, true);
  } catch(_) {}
  loadBom(z.id);
  setState({zlecenieModal: z});
}

async function openOperacje(zlecenie) {
  setState({operacjeModal:{zlecenie, operacje:[], loading:true}});
  try {
    const ops = await get(`/api/zlecenia/${zlecenie.id}/operacje`);
    setState({operacjeModal:{zlecenie, operacje:ops, loading:false}});
  } catch(e) { alert(e.message); }
}

function renderOperacjeModal() {
  const m = state.operacjeModal;
  if (!m) return '';
  const zl = m.zlecenie;
  const ops = m.operacje || [];

  let html = `
  <div class="modal-overlay" onclick="if(event.target===this)setState({operacjeModal:null})">
    <div class="modal" style="padding:0;display:flex;flex-direction:column;max-height:92vh">

      <!-- Nagłówek przyklejony -->
      <div style="padding:16px 18px 12px;border-bottom:1px solid var(--border);flex-shrink:0">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1;min-width:0;padding-right:12px">
            <div style="font-size:11px;color:var(--dim);margin-bottom:2px;text-transform:uppercase;letter-spacing:.5px">Operacje zlecenia</div>
            <div style="font-size:17px;font-weight:700;color:var(--accent)">${zl.numer}</div>
            <div style="font-size:12px;color:var(--dim);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${zl.nazwa}</div>
          </div>
          <button onclick="setState({operacjeModal:null})" style="background:var(--entry);border:none;color:var(--text);font-size:20px;width:38px;height:38px;border-radius:50%;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center">×</button>
        </div>
      </div>

      <!-- Treść przewijana -->
      <div style="flex:1;overflow-y:auto;padding:14px 16px 8px">`;

  if (m.loading) {
    html += `<div style="text-align:center;padding:40px;color:var(--dim)">⏳ Ładowanie...</div>`;
  } else {

    // Lista istniejących operacji
    if (ops.length === 0) {
      html += `<div style="text-align:center;padding:20px 0 8px;color:var(--dim);font-size:13px">Brak operacji – dodaj pierwszą poniżej</div>`;
    } else {
      html += `<div style="font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Zdefiniowane operacje (${ops.length})</div>`;
      ops.forEach((op) => {
        const hasZbr = op.czas_zbrojenia_min > 0;
        html += `
        <div style="background:var(--entry);border-radius:10px;padding:12px 14px;margin-bottom:8px;border-left:3px solid var(--blue)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:700;margin-bottom:4px">${op.kolejnosc}. ${op.nazwa}</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
                ${op.stanowisko ? `<span style="background:rgba(52,152,219,.15);color:var(--blue);border-radius:6px;padding:2px 8px;font-size:11px;font-weight:600">${op.stanowisko}</span>` : ''}
                ${op.czas_norma ? `<span style="background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:2px 7px;font-size:11px;color:var(--dim)">⏱ ${op.czas_norma} min/szt</span>` : ''}
                ${hasZbr ? `<span style="background:rgba(243,156,18,.12);color:var(--orange);border-radius:6px;padding:2px 7px;font-size:11px;font-weight:600">⚙ zbr: ${op.czas_zbrojenia_min} min</span>` : ''}
              </div>
              ${op.opis_czynnosci ? `<div style="font-size:11px;color:var(--dim);margin-top:5px;font-style:italic">${op.opis_czynnosci}</div>` : ''}
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <button onclick="editOperacja(${JSON.stringify(op).replace(/"/g,'&quot;')})"
                style="background:rgba(52,152,219,.15);border:1px solid var(--blue);color:var(--blue);border-radius:8px;padding:7px 10px;font-size:13px;cursor:pointer">✏</button>
              <button onclick="deleteOp(${op.id},${zl.id})"
                style="background:rgba(231,76,60,.1);border:1px solid var(--red);color:var(--red);border-radius:8px;padding:7px 10px;font-size:13px;cursor:pointer">🗑</button>
            </div>
          </div>
        </div>`;
      });
    }

    // Separator
    html += `<div style="height:1px;background:var(--border);margin:16px 0 14px"></div>
    <div style="font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">➕ Dodaj operację</div>`;

    // Formularz dodawania
    html += `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div>
        <div style="font-size:12px;color:var(--dim);margin-bottom:4px">Nazwa operacji <span style="color:var(--red)">*</span></div>
        <input id="op-nazwa" type="text" placeholder="np. Toczenie wału" autocomplete="off"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:11px 12px;font-size:15px;box-sizing:border-box">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <div style="font-size:12px;color:var(--dim);margin-bottom:4px">Kolejność</div>
          <input id="op-kol" type="number" value="${ops.length+1}" min="1" autocomplete="off"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:11px 12px;font-size:15px;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:12px;color:var(--dim);margin-bottom:4px">Czas norma (min/szt)</div>
          <input id="op-norma" type="number" step="0.5" value="0" min="0" autocomplete="off"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:11px 12px;font-size:15px;box-sizing:border-box">
        </div>
      </div>
      <div>
        <div style="font-size:12px;color:var(--dim);margin-bottom:4px">Stanowisko / operacja</div>
        <select id="op-stan" onchange="updateZbrojenieField()"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:11px 12px;font-size:15px;-webkit-appearance:none;appearance:none">
          <option value="">— wybierz —</option>
          ${(state.stawki||[]).map(s=>`<option value="${s.stanowisko}" data-zbr="${s.zbrojenie_aktywne||0}" data-zbr-stawka="${s.zbrojenie_stawka_godz||0}">${s.stanowisko}${s.zbrojenie_aktywne?' ⚙':''}</option>`).join('')}
        </select>
      </div>
      <div id="zbrojenie-field-wrap" style="display:none">
        <div style="background:rgba(243,156,18,.08);border:1px solid var(--orange);border-radius:8px;padding:12px 14px">
          <div style="font-size:12px;color:var(--orange);font-weight:700;margin-bottom:8px">⚙ Zbrojenie (1× na operację, niezależnie od ilości)</div>
          <div style="font-size:12px;color:var(--dim);margin-bottom:4px">Czas zbrojenia (min)</div>
          <input id="op-zbrojenie" type="number" step="1" value="0" min="0" autocomplete="off"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:11px 12px;font-size:15px;box-sizing:border-box">
        </div>
      </div>
      <div>
        <div style="font-size:12px;color:var(--dim);margin-bottom:4px">Opis czynności (opcjonalny)</div>
        <textarea id="op-opis"
          style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:11px 12px;font-size:14px;box-sizing:border-box;min-height:70px;resize:vertical"></textarea>
      </div>
      <button onclick="addOperacja(${zl.id})"
        style="width:100%;background:var(--green);color:#fff;border:none;border-radius:10px;padding:15px;font-size:16px;font-weight:700;cursor:pointer;margin-top:2px">
        ＋ Dodaj operację
      </button>
    </div>`;
  }

  html += `</div></div></div>`;
  return html;
}

function updateZbrojenieField() {
  const s = document.getElementById('op-stan');
  const wrap = document.getElementById('zbrojenie-field-wrap');
  if (!s || !wrap) return;
  const selOpt = s.options[s.selectedIndex];
  const zbrAkt = selOpt ? selOpt.getAttribute('data-zbr') : '0';
  wrap.style.display = (zbrAkt === '1') ? 'block' : 'none';
}

async function addOperacja(zlecenieId) {
  const nazwa = document.getElementById('op-nazwa')?.value?.trim();
  if (!nazwa) { alert('Podaj nazwę operacji'); return; }
  try {
    await post('/api/operacje', {
      zlecenie_id: zlecenieId,
      nazwa,
      kolejnosc: parseInt(document.getElementById('op-kol').value)||1,
      stanowisko: document.getElementById('op-stan').value,
      czas_norma: parseFloat(document.getElementById('op-norma').value)||0,
      opis_czynnosci: document.getElementById('op-opis').value,
      czas_zbrojenia_min: parseFloat(document.getElementById('op-zbrojenie')?.value)||0,
    });
    await openOperacje(state.operacjeModal.zlecenie);
    // Odśwież drzewo G jeśli edytujemy podzlecenie P
    const pdm = state.podZlecenieModal;
    if (pdm && pdm.parentGid) refreshZlecenieDrzewo(pdm.parentGid);
    else refreshZlecenieDrzewo(zlecenieId);
  } catch(e) { alert('Błąd: '+e.message); }
}

async function deleteOp(opId, zlecenieId) {
  if (!confirm('Usunąć operację?')) return;
  try {
    await del(`/api/operacje/${opId}`);
    await openOperacje(state.operacjeModal.zlecenie);
    // Odśwież drzewo G jeśli edytujemy podzlecenie P
    const pdm = state.podZlecenieModal;
    if (pdm && pdm.parentGid) refreshZlecenieDrzewo(pdm.parentGid);
    else refreshZlecenieDrzewo(zlecenieId);
  } catch(e) { alert('Błąd: '+e.message); }
}

function showQRForZlecenie(z) {
  if (!z.qr_code) { alert('Brak kodu QR dla zlecenia'); return; }
  setState({qrGenModal:true, qrGenKod:z.qr_code, qrGenTitle: z.numer + ' – ' + z.nazwa});
}

function renderQRGenModal() {
  if (!state.qrGenModal) return '';
  const kod = state.qrGenKod;
  const title = state.qrGenTitle || kod;
  return `
  <div class="modal-overlay">
    <div class="modal" style="text-align:center">
      <button class="modal-close" onclick="setState({qrGenModal:false})">×</button>
      <h3>📷 Kod QR zlecenia</h3>
      <div style="font-family:Consolas;font-size:13px;color:var(--accent);margin-bottom:4px">${title}</div>
      <div style="font-family:Consolas;font-size:11px;color:var(--dim);margin-bottom:16px">${kod}</div>
      <canvas id="qr-canvas" style="background:white;padding:10px;border-radius:10px;display:block;margin:0 auto"></canvas>
      <div id="qr-err" style="display:none;color:var(--red);font-size:13px;margin-top:8px">Błąd generowania QR</div>
      <div style="font-size:12px;color:var(--dim);margin-top:12px">Zrób zdjęcie lub wydrukuj</div>
      <button class="btn btn-outline" style="margin-top:16px;width:auto;padding:10px 24px" onclick="setState({qrGenModal:false})">Zamknij</button>
    </div>
  </div>`;
}

function drawQRCanvas(kod) {
  // Simple QR rendering via server fetch with auth header, drawn onto canvas
  const canvas = document.getElementById('qr-canvas');
  if (!canvas) return;
  const url = `${SERVER_URL.replace(/\/$/,'')}/api/qr/${encodeURIComponent(kod)}`;
  fetch(url, {headers: {'x-api-key': API_KEY}})
    .then(r => { if (!r.ok) throw new Error('HTTP '+r.status); return r.blob(); })
    .then(blob => {
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width; canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(blob);
    })
    .catch(() => {
      canvas.style.display = 'none';
      const err = document.getElementById('qr-err');
      if (err) err.style.display = 'block';
    });
}

// ─── Karta zlecenia – wybór rodzaju wydruku ──────────────────
async function openKartaModal(z) {
  setState({kartaModal: {zlecenie: z, mode: 'choice'}, kartaSubZlecenia: [], kartaSubLoading: true});
  try {
    // Załaduj operacje zlecenia G
    let opsG = [];
    try { opsG = await get('/api/zlecenia/' + z.id + '/operacje'); } catch(e){}
    // Załaduj zapotrzebowania (podzlecenia P)
    const zapotrz = await get('/api/zlecenia/' + z.id + '/zapotrzebowania');
    const allZl = await get('/api/zlecenia');
    const subList = [{
      id: z.id, numer: z.numer, nazwa: z.nazwa, ilosc_sztuk: z.ilosc_sztuk,
      status: z.status, qr_code: z.qr_code, typ: 'G',
      operacje: opsG,
      materialy: [],
    }];
    // Ładuj tylko podzlecenia P które są osobnymi zleceniami (nie półprodukty wbudowane w strukturę G)
    const processedIds = new Set();
    for (const zap of (zapotrz || [])) {
      if (!zap.zlecenie_p_id) continue;
      if (processedIds.has(zap.zlecenie_p_id)) continue;
      const zp = allZl.find(x => x.id === zap.zlecenie_p_id);
      if (!zp) continue;
      // Pomiń jeśli to zlecenie P nie ma żadnych operacji (jest tylko kartą materiałową/półproduktem)
      let opsP = [];
      try { opsP = await get('/api/zlecenia/' + zp.id + '/operacje'); } catch(e){}
      let matsP = [];
      try { matsP = await get('/api/zlecenia/' + zp.id + '/bom'); } catch(e){}
      // Pobierz też materiały M przypisane bezpośrednio do zlecenia P
      let matsM = [];
      try { matsM = await get('/api/zlecenia/' + zp.id + '/materialy-zlecenia'); } catch(e){}
      processedIds.add(zap.zlecenie_p_id);
      subList.push({
        id: zp.id, numer: zp.numer, nazwa: zp.nazwa, ilosc_sztuk: zp.ilosc_sztuk,
        status: zp.status, qr_code: zp.qr_code, typ: 'P',
        operacje: opsP,
        materialy: matsP.length ? matsP : matsM,
        // Flaga: P bez operacji = karta materiałowa (półprodukt z materiałem)
        kartaMaterialowa: opsP.length === 0 && (matsP.length > 0 || matsM.length > 0),
      });
    }
    setState({kartaSubZlecenia: subList, kartaSubLoading: false});
  } catch(e) {
    setState({kartaSubLoading: false, error: 'Błąd ładowania danych karty: ' + e.message});
  }
}

function renderKartaModal() {
  const m = state.kartaModal;
  if (!m) return '';
  const subs = state.kartaSubZlecenia || [];
  const loading = state.kartaSubLoading;
  const mode = m.mode;

  if (mode === 'choice') {
    return `<div class="modal-overlay" style="z-index:300;align-items:center">
      <div class="modal" style="max-width:440px;border-radius:16px;padding:24px 20px;max-height:80vh;overflow-y:auto">
        <button class="modal-close" onclick="setState({kartaModal:null})">×</button>
        <h3 style="color:var(--accent);margin-bottom:4px">🖨 Karta zlecenia</h3>
        <div style="color:var(--dim);font-size:13px;margin-bottom:20px">${m.zlecenie.numer} – ${m.zlecenie.nazwa}</div>
        ${loading ? '<div style="text-align:center;padding:20px;color:var(--dim)">Ładowanie danych…</div>' : `
        <div style="display:flex;flex-direction:column;gap:10px">
          <button onclick="kartaPrintCalosc()" style="background:#1a3a1a;color:#4ade80;border:1px solid #4ade8044;border-radius:10px;padding:14px 16px;cursor:pointer;text-align:left">
            <div style="font-weight:700;font-size:14px;margin-bottom:4px">📋 Całościowa</div>
            <div style="font-size:12px;color:#86efac;opacity:.8">Karta G + wszystkie podzlecenia P z operacjami i QR kodami</div>
          </button>
          <button onclick="setState({kartaModal:{...state.kartaModal,mode:'partial-pick'}},true);render()" style="background:#1e3a5f;color:#60a5fa;border:1px solid #3b82f640;border-radius:10px;padding:14px 16px;cursor:pointer;text-align:left">
            <div style="font-weight:700;font-size:14px;margin-bottom:4px">📄 Częściowa – pojedyncze zlecenie</div>
            <div style="font-size:12px;color:#93c5fd;opacity:.8">Wybierz jedno zlecenie G lub podzlecenie P (z operacjami i QR)</div>
          </button>
          <button onclick="setState({kartaModal:{...state.kartaModal,mode:'materials-pick'}},true);render()" style="background:#2d1f5e;color:#a78bfa;border:1px solid #8b5cf633;border-radius:10px;padding:14px 16px;cursor:pointer;text-align:left">
            <div style="font-weight:700;font-size:14px;margin-bottom:4px">📦 Materiały (podzlecenia P)</div>
            <div style="font-size:12px;color:#c4b5fd;opacity:.8">Lista materiałów z BOM podzleceń P bez QR kodów, z podziałem na P</div>
          </button>
        </div>`}
      </div>
    </div>`;
  }

  if (mode === 'partial-pick') {
    return `<div class="modal-overlay" style="z-index:300;align-items:center">
      <div class="modal" style="max-width:440px;border-radius:16px;padding:24px 20px;max-height:80vh;overflow-y:auto">
        <button class="modal-close" onclick="setState({kartaModal:{...state.kartaModal,mode:'choice'}},true);render()">←</button>
        <h3 style="color:var(--blue);margin-bottom:16px">📄 Wybierz zlecenie do karty</h3>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${subs.map(s => `<button onclick="kartaPrintSingle(${s.id})"
            style="background:${s.typ==='G'?'#1e3a5f':'#2d1f5e'};color:${s.typ==='G'?'#60a5fa':'#a78bfa'};border:1px solid ${s.typ==='G'?'#3b82f640':'#8b5cf633'};border-radius:8px;padding:10px 14px;cursor:pointer;text-align:left">
            <span style="font-weight:700;font-family:monospace">${s.numer}</span>
            <span style="font-size:12px;color:var(--dim);margin-left:8px">${s.nazwa}</span>
            <span style="float:right;font-size:11px;background:${s.typ==='G'?'#1e3a5f':'#3a2060'};border:1px solid ${s.typ==='G'?'#3b82f655':'#8b5cf655'};border-radius:4px;padding:1px 6px">${s.typ}</span>
          </button>`).join('')}
        </div>
      </div>
    </div>`;
  }

  if (mode === 'materials-pick') {
    const pSubs = subs.filter(s => s.typ === 'P');
    return `<div class="modal-overlay" style="z-index:300;align-items:center">
      <div class="modal" style="max-width:440px;border-radius:16px;padding:24px 20px;max-height:80vh;overflow-y:auto">
        <button class="modal-close" onclick="setState({kartaModal:{...state.kartaModal,mode:'choice'}},true);render()">←</button>
        <h3 style="color:#a78bfa;margin-bottom:8px">📦 Karta materiałów P</h3>
        <div style="color:var(--dim);font-size:12px;margin-bottom:16px">Wydruk listy materiałów BOM z podziałem na podzlecenia P (bez QR kodów)</div>
        ${pSubs.length === 0 ? '<div style="color:var(--dim);text-align:center;padding:20px">Brak podzleceń P w tym zleceniu.</div>' :
          `<button onclick="kartaPrintMaterials()" style="background:#2d1f5e;color:#a78bfa;border:1px solid #8b5cf640;border-radius:10px;padding:12px 16px;width:100%;cursor:pointer;font-weight:700;font-size:14px">
            📦 Drukuj materiały (${pSubs.length} podzleceń P)
          </button>
          <div style="margin-top:12px;border:1px solid var(--border);border-radius:8px;overflow:hidden">
            ${pSubs.map(s => `<div style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
              <span style="color:#a78bfa;font-family:monospace;font-weight:700;font-size:12px">${s.numer}</span>
              <span style="color:var(--dim);font-size:11px">${(s.materialy||[]).length} mat.</span>
            </div>`).join('')}
          </div>`}
      </div>
    </div>`;
  }

  return '';
}

async function kartaPrintCalosc() {
  const subs = state.kartaSubZlecenia || [];
  if (!subs.length) return;
  _doPrintKarta('whole', subs);
}

async function kartaPrintSingle(zid) {
  const subs = state.kartaSubZlecenia || [];
  const sub = subs.find(s => s.id === zid);
  if (!sub) return;
  _doPrintKarta('single', [sub]);
}

async function kartaPrintMaterials() {
  const subs = (state.kartaSubZlecenia || []).filter(s => s.typ === 'P');
  if (!subs.length) return;
  _doPrintKarta('materials', subs);
}

function _buildKartaHtml(subs, mode) {
  const mainZ = state.kartaModal?.zlecenie;

  function buildOpsTable(ops) {
    if (!ops || !ops.length) return '<div style="color:#666;font-size:12px;margin-bottom:12px">Brak zdefiniowanych operacji</div>';
    const rows = [];
    ops.forEach(op => {
      const isZbrojenie = op.typ_operacji === 'zbrojenie';
      const hasLegacyZbr = !isZbrojenie && (op.czas_zbrojenia_min > 0);
      if (hasLegacyZbr) {
        rows.push(`<tr style="background:#fff8e8;border-left:3px solid #e8a020">
          <td style="padding:7px 8px;border:1px solid #ddd;font-weight:700;color:#e8a020">${op.kolejnosc}z</td>
          <td style="padding:7px 8px;border:1px solid #ddd"><div style="font-weight:700;color:#c07000">⚙ ZBROJENIE – ${op.nazwa}</div></td>
          <td style="padding:7px 8px;border:1px solid #ddd">${op.stanowisko||'—'}</td>
          <td style="padding:7px 8px;border:1px solid #ddd;text-align:center;font-weight:700;color:#c07000">${op.czas_zbrojenia_min} min</td>
          <td style="border:1px solid #ddd;width:60px"></td><td style="border:1px solid #ddd;width:30px"></td></tr>`);
      }
      if (isZbrojenie) {
        rows.push(`<tr style="background:#fff8e8;border-left:3px solid #e8a020">
          <td style="padding:7px 8px;border:1px solid #ddd;font-weight:700;color:#e8a020">${op.kolejnosc}</td>
          <td style="padding:7px 8px;border:1px solid #ddd"><div style="font-weight:700;color:#c07000">⚙ ZBROJENIE – ${op.nazwa}</div>${op.opis_czynnosci?`<div style="font-size:11px;color:#888">${op.opis_czynnosci}</div>`:''}</td>
          <td style="padding:7px 8px;border:1px solid #ddd">${op.stanowisko||'—'}</td>
          <td style="padding:7px 8px;border:1px solid #ddd;text-align:center;font-weight:700;color:#c07000">${op.czas_zbrojenia_min||'—'} min</td>
          <td style="border:1px solid #ddd;width:60px"></td><td style="border:1px solid #ddd;width:30px"></td></tr>`);
      } else {
        rows.push(`<tr>
          <td style="padding:7px 8px;border:1px solid #ddd;font-weight:700">${op.kolejnosc}</td>
          <td style="padding:7px 8px;border:1px solid #ddd"><div style="font-weight:600">${op.nazwa}</div>${op.opis_czynnosci?`<div style="font-size:11px;color:#555">${op.opis_czynnosci}</div>`:''}</td>
          <td style="padding:7px 8px;border:1px solid #ddd">${op.stanowisko||'—'}</td>
          <td style="padding:7px 8px;border:1px solid #ddd;text-align:center">${op.czas_norma||'—'} min</td>
          <td style="border:1px solid #ddd;width:60px"></td><td style="border:1px solid #ddd;width:30px"></td></tr>`);
      }
    });
    return `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px">
      <thead><tr style="background:#222;color:#fff">
        <th style="padding:6px 8px;text-align:left;width:30px">Lp.</th>
        <th style="padding:6px 8px;text-align:left">Operacja</th>
        <th style="padding:6px 8px;text-align:left">Stanowisko</th>
        <th style="padding:6px 8px;text-align:center">Norma</th>
        <th style="padding:6px 8px;text-align:center">Wyk.</th>
        <th style="padding:6px 8px;text-align:center">✓</th>
      </tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  if (mode === 'materials') {
    // Karta materiałów – bez QR, z podziałem na P
    let html = `<div style="text-align:center;border-bottom:3px solid #000;padding-bottom:12px;margin-bottom:16px">
      <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#555">Wykaz materiałów – podzlecenia P</div>
      <div style="font-size:24px;font-weight:900;font-family:Consolas,monospace;margin:4px 0">${mainZ?.numer||''}</div>
      <div style="font-size:14px;font-weight:600">${mainZ?.nazwa||''}</div>
    </div>`;
    subs.forEach(s => {
      const mats = s.materialy || [];
      html += `<div style="margin-bottom:20px">
        <div style="font-weight:800;font-size:13px;letter-spacing:.5px;border-left:4px solid #7c3aed;padding-left:10px;margin-bottom:8px;background:#f5f0ff;padding:6px 10px;border-radius:4px">
          ${s.numer} <span style="font-weight:400;color:#555;font-size:12px">– ${s.nazwa}</span>
          <span style="float:right;font-size:11px;color:#888">${s.ilosc_sztuk} szt.</span>
        </div>`;
      if (mats.length === 0) {
        html += `<div style="color:#888;font-size:12px;padding:4px 12px">Brak materiałów BOM</div>`;
      } else {
        html += `<table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#f0f0f0">
            <th style="padding:5px 8px;text-align:left;border:1px solid #ddd">Indeks</th>
            <th style="padding:5px 8px;text-align:left;border:1px solid #ddd">Opis</th>
            <th style="padding:5px 8px;text-align:right;border:1px solid #ddd">Ilość</th>
            <th style="padding:5px 8px;text-align:left;border:1px solid #ddd">JM</th>
          </tr></thead><tbody>`;
        mats.forEach((m,i) => {
          html += `<tr style="background:${i%2===0?'#fff':'#fafafa'}">
            <td style="padding:5px 8px;border:1px solid #ddd;font-family:Consolas;font-size:11px">${m.material_indeks||m.indeks||''}</td>
            <td style="padding:5px 8px;border:1px solid #ddd">${m.material_opis||m.opis||''}</td>
            <td style="padding:5px 8px;border:1px solid #ddd;text-align:right;font-weight:700">${m.ilosc||''}</td>
            <td style="padding:5px 8px;border:1px solid #ddd;color:#555">${m.material_jm||m.jm||''}</td>
          </tr>`;
        });
        html += `</tbody></table>`;
      }
      html += `</div>`;
    });
    return html;
  }

  // Tryb 'whole' lub 'single' – karty z operacjami i QR
  let html = '';
  subs.forEach((s, idx) => {
    if (idx > 0) html += `<div style="page-break-before:always;margin-top:24px"></div>`;
    const isMaterialCard = s.kartaMaterialowa; // P bez operacji, tylko z materiałem
    const hasOps = (s.operacje || []).length > 0;
    const hasMats = (s.materialy || []).length > 0;

    // Sekcja materiałów (dla kart obróbkowych P z materiałem lub kart materiałowych)
    let matsSection = '';
    if (hasMats) {
      const matsRows = (s.materialy || []).map((m, i) => `<tr style="background:${i%2===0?'#fff':'#fafafa'}">
        <td style="padding:5px 8px;border:1px solid #ddd;font-family:Consolas;font-size:11px">${m.material_indeks||m.indeks||''}</td>
        <td style="padding:5px 8px;border:1px solid #ddd">${m.material_opis||m.opis||''}</td>
        <td style="padding:5px 8px;border:1px solid #ddd;text-align:right;font-weight:700">${m.ilosc||''}</td>
        <td style="padding:5px 8px;border:1px solid #ddd;color:#555">${m.material_jm||m.jm||m.jednostka||''}</td>
      </tr>`).join('');
      matsSection = `<div style="font-weight:800;font-size:13px;margin-bottom:8px;margin-top:16px;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #000;padding-bottom:4px">Materiały (${(s.materialy||[]).length})</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px">
        <thead><tr style="background:#f0f0f0">
          <th style="padding:5px 8px;text-align:left;border:1px solid #ddd">Indeks</th>
          <th style="padding:5px 8px;text-align:left;border:1px solid #ddd">Opis</th>
          <th style="padding:5px 8px;text-align:right;border:1px solid #ddd">Ilość</th>
          <th style="padding:5px 8px;text-align:left;border:1px solid #ddd">JM</th>
        </tr></thead><tbody>${matsRows}</tbody></table>`;
    }

    html += `<div>
      <div style="text-align:center;border-bottom:3px solid #000;padding-bottom:12px;margin-bottom:16px">
        <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#555">${isMaterialCard ? 'Karta Materiałowa – Półprodukt P' : ('Karta Zlecenia Produkcyjnego' + (s.typ==='P' ? ' – Podzlecenie P' : ''))}</div>
        <div style="font-size:28px;font-weight:900;font-family:Consolas,monospace;margin:4px 0">${s.numer}</div>
        <div style="font-size:16px;font-weight:600">${s.nazwa}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px">
        <tr style="background:#f5f5f5"><td style="padding:7px 10px;font-weight:700;width:35%;border:1px solid #ccc">Ilość sztuk</td>
          <td style="padding:7px 10px;border:1px solid #ccc;font-size:20px;font-weight:900">${s.ilosc_sztuk} szt.</td></tr>
        <tr><td style="padding:7px 10px;font-weight:700;border:1px solid #ccc">Status</td>
          <td style="padding:7px 10px;border:1px solid #ccc;text-transform:uppercase">${s.status||'—'}</td></tr>
        ${isMaterialCard ? `<tr><td style="padding:7px 10px;font-weight:700;border:1px solid #ccc">Typ karty</td>
          <td style="padding:7px 10px;border:1px solid #ccc;color:#7c3aed;font-weight:700">📦 Karta materiałowa (bez operacji obróbkowych)</td></tr>` : ''}
      </table>
      ${!isMaterialCard ? `<div style="font-weight:800;font-size:13px;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #000;padding-bottom:4px">
        Operacje produkcyjne (${(s.operacje||[]).length})
      </div>
      ${buildOpsTable(s.operacje)}` : ''}
      ${matsSection}
      <div style="display:flex;justify-content:space-between;align-items:flex-end;border-top:2px solid #000;padding-top:12px;margin-top:8px">
        <div>
          ${s.qr_code && !isMaterialCard ? `<div style="margin-bottom:6px">
            <div style="font-size:10px;font-weight:700;letter-spacing:1px;margin-bottom:4px">KOD QR ZLECENIA</div>
            <canvas id="karta-qr-canvas-${s.id}" style="display:block;border:1px solid #ccc;padding:4px"></canvas>
            <div style="font-family:Consolas;font-size:9px;margin-top:2px;color:#555">${s.qr_code}</div>
          </div>` : ''}
        </div>
        <div style="text-align:right;font-size:12px">
          <div style="margin-bottom:20px"><div style="font-weight:700">Wydał</div>
            <div style="border-top:1px solid #000;margin-top:20px;width:150px;text-align:center;padding-top:3px;font-size:10px">podpis i data</div></div>
          <div><div style="font-weight:700">Przyjął</div>
            <div style="border-top:1px solid #000;margin-top:20px;width:150px;text-align:center;padding-top:3px;font-size:10px">podpis i data</div></div>
        </div>
      </div>
    </div>`;
  });
  return html;
}

async function _doPrintKarta(mode, subs) {
  setState({kartaModal: null});
  const mainZ = state.kartaModal?.zlecenie || subs[0];
  const contentHtml = _buildKartaHtml(subs, mode);

  const win = window.open('', '_blank', 'width=720,height=1020');
  if (!win) { alert('Zablokowano otwieranie okna. Zezwól na pop-upy dla tej strony.'); return; }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Karta zlecenia</title>
    <style>
      body{font-family:Arial,sans-serif;margin:10mm;background:#fff;color:#000;}
      @media print{body{margin:5mm;} @page{margin:10mm;}}
      table{border-collapse:collapse;}
    </style></head><body id="kbody">${contentHtml}<div style="margin-top:20px;text-align:center"><button onclick="window.print()" style="padding:10px 24px;font-size:14px;cursor:pointer">🖨 Drukuj</button></div></body></html>`);
  win.document.close();
  win.focus();
  // Rysuj QR kody dla każdego zlecenia z qr_code
  if (mode !== 'materials') {
    await new Promise(r => setTimeout(r, 400));
    for (const s of subs) {
      if (!s.qr_code) continue;
      const canvas = win.document.getElementById('karta-qr-canvas-' + s.id);
      if (!canvas) continue;
      try {
        const url = `${SERVER_URL.replace(/\/$/,'')}/api/qr/${encodeURIComponent(s.qr_code)}`;
        const res = await fetch(url, {headers:{'x-api-key':API_KEY}});
        const blob = await res.blob();
        const img = new win.Image();
        img.onload = () => {
          canvas.width = img.width; canvas.height = img.height;
          canvas.getContext('2d').drawImage(img, 0, 0);
        };
        img.src = URL.createObjectURL(blob);
      } catch(e){}
    }
  }
}

// ─── Karta zlecenia (druk) – pojedyncze ────────────────────────────────────

async function printZlecenie(z) {
  let ops = [];
  try { ops = await get(`/api/zlecenia/${z.id}/operacje`); } catch(e) {}
  setState({printModal: {zlecenie: z, operacje: ops}});
}

function renderPrintModal() {
  const m = state.printModal;
  if (!m) return '';
  const z = m.zlecenie;
  const ops = m.operacje || [];

  return `
  <div class="modal-overlay" id="print-overlay">
    <div class="modal" style="max-height:92vh;overflow-y:auto">
      <button class="modal-close no-print" onclick="setState({printModal:null})">×</button>
      <h3 class="no-print" style="margin-bottom:12px">🖨 Podgląd karty zlecenia</h3>

      <div id="print-content" style="background:#fff;color:#000;padding:20px;border-radius:8px;border:1px solid #ddd">
        <!-- NAGŁÓWEK -->
        <div style="text-align:center;border-bottom:3px solid #000;padding-bottom:12px;margin-bottom:16px">
          <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#555">Karta Zlecenia Produkcyjnego</div>
          <div style="font-size:28px;font-weight:900;font-family:Consolas,monospace;margin:4px 0">${z.numer}</div>
          <div style="font-size:16px;font-weight:600">${z.nazwa}</div>
        </div>

        <!-- INFO O ZLECENIU -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px">
          <tr style="background:#f5f5f5">
            <td style="padding:7px 10px;font-weight:700;width:35%;border:1px solid #ccc">Ilość sztuk</td>
            <td style="padding:7px 10px;border:1px solid #ccc;font-size:20px;font-weight:900;color:#000">${z.ilosc_sztuk} szt.</td>
          </tr>
          ${z.termin ? `<tr><td style="padding:7px 10px;font-weight:700;border:1px solid #ccc">Termin realizacji</td><td style="padding:7px 10px;border:1px solid #ccc">${fmtDate(z.termin)}</td></tr>` : ''}
          ${z.opis ? `<tr><td style="padding:7px 10px;font-weight:700;border:1px solid #ccc">Opis</td><td style="padding:7px 10px;border:1px solid #ccc">${z.opis}</td></tr>` : ''}
          <tr>
            <td style="padding:7px 10px;font-weight:700;border:1px solid #ccc">Status</td>
            <td style="padding:7px 10px;border:1px solid #ccc;text-transform:uppercase">${z.status}</td>
          </tr>
          <tr>
            <td style="padding:7px 10px;font-weight:700;border:1px solid #ccc">Materiał od klienta</td>
            <td style="padding:7px 10px;border:1px solid #ccc">${z.material_od_klienta ? '✓ Tak' : 'Nie'}</td>
          </tr>
        </table>

        <!-- OPERACJE -->
        ${ops.length ? `
        <div style="font-weight:800;font-size:13px;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #000;padding-bottom:4px">
          Operacje produkcyjne (${ops.length})
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px">
          <thead>
            <tr style="background:#222;color:#fff">
              <th style="padding:6px 8px;text-align:left;width:30px">Lp.</th>
              <th style="padding:6px 8px;text-align:left">Operacja</th>
              <th style="padding:6px 8px;text-align:left">Stanowisko</th>
              <th style="padding:6px 8px;text-align:center">Norma</th>
              <th style="padding:6px 8px;text-align:center">Wyk.</th>
              <th style="padding:6px 8px;text-align:center">✓</th>
            </tr>
          </thead>
          <tbody>
            ${(()=>{
              // Rozwin operacje: przed kazdą operacją z czas_zbrojenia_min > 0 wstaw wiersz zbrojenia
              // oraz operacje typ='zbrojenie' wyswietlaj jako osobny wiersz
              const rows = [];
              let lp = 0;
              ops.forEach((op) => {
                // Dla starych operacji (typ != 'zbrojenie') z czas_zbrojenia_min > 0
                // wstaw sztuczny wiersz zbrojenia przed operacją (stare zlecenia)
                const isZbrojenie = op.typ_operacji === 'zbrojenie';
                const hasLegacyZbr = !isZbrojenie && (op.czas_zbrojenia_min > 0);
                if (hasLegacyZbr) {
                  lp++;
                  rows.push(`<tr style="background:#fff8e8;border-left:3px solid #e8a020">
                    <td style="padding:7px 8px;border:1px solid #ddd;font-weight:700;color:#e8a020">${op.kolejnosc}z</td>
                    <td style="padding:7px 8px;border:1px solid #ddd">
                      <div style="font-weight:700;color:#c07000">⚙ ZBROJENIE – ${op.nazwa}</div>
                    </td>
                    <td style="padding:7px 8px;border:1px solid #ddd">${op.stanowisko||'—'}</td>
                    <td style="padding:7px 8px;border:1px solid #ddd;text-align:center;font-weight:700;color:#c07000">${op.czas_zbrojenia_min} min</td>
                    <td style="padding:7px 8px;border:1px solid #ddd;width:60px"></td>
                    <td style="padding:7px 8px;border:1px solid #ddd;width:30px"></td>
                  </tr>`);
                }
                if (isZbrojenie) {
                  lp++;
                  rows.push(`<tr style="background:#fff8e8;border-left:3px solid #e8a020">
                    <td style="padding:7px 8px;border:1px solid #ddd;font-weight:700;color:#e8a020">${op.kolejnosc}</td>
                    <td style="padding:7px 8px;border:1px solid #ddd">
                      <div style="font-weight:700;color:#c07000">⚙ ZBROJENIE – ${op.nazwa}</div>
                      ${op.opis_czynnosci ? `<div style="font-size:11px;color:#888;margin-top:3px">${op.opis_czynnosci}</div>` : ''}
                    </td>
                    <td style="padding:7px 8px;border:1px solid #ddd">${op.stanowisko||'—'}</td>
                    <td style="padding:7px 8px;border:1px solid #ddd;text-align:center;font-weight:700;color:#c07000">${op.czas_zbrojenia_min||'—'} min</td>
                    <td style="padding:7px 8px;border:1px solid #ddd;text-align:center;width:60px"></td>
                    <td style="padding:7px 8px;border:1px solid #ddd;text-align:center;width:30px"></td>
                  </tr>`);
                } else {
                  lp++;
                  const bg = lp%2===0?'#f9f9f9':'#fff';
                  rows.push(`<tr style="background:${bg}">
                    <td style="padding:7px 8px;border:1px solid #ddd;font-weight:700">${op.kolejnosc}</td>
                    <td style="padding:7px 8px;border:1px solid #ddd">
                      <div style="font-weight:600">${op.nazwa}</div>
                      ${op.opis_czynnosci ? `<div style="font-size:11px;color:#555;margin-top:4px;line-height:1.7">${op.opis_czynnosci.split(/\n|(?<=;)\s*(?=[A-ZŚŹŻĆŃÓĄĘ])/g).map(l=>l.trim()).filter(Boolean).map(l=>`<div style="display:flex;gap:5px"><span style="color:#999;flex-shrink:0">•</span><span>${l}</span></div>`).join('')}</div>` : ''}
                    </td>
                    <td style="padding:7px 8px;border:1px solid #ddd">${op.stanowisko||'—'}</td>
                    <td style="padding:7px 8px;border:1px solid #ddd;text-align:center">${op.czas_norma||'—'} min</td>
                    <td style="padding:7px 8px;border:1px solid #ddd;text-align:center;width:60px"></td>
                    <td style="padding:7px 8px;border:1px solid #ddd;text-align:center;width:30px"></td>
                  </tr>`);
                }
              });
              return rows.join('');
            })()}
          </tbody>
        </table>` : '<div style="color:#666;font-size:13px;margin-bottom:16px">Brak zdefiniowanych operacji</div>'}

        <!-- QR KOD + PODPISY -->
        <div style="display:flex;justify-content:space-between;align-items:flex-end;border-top:2px solid #000;padding-top:12px;margin-top:8px">
          <div>
            ${z.qr_code ? `
            <div style="margin-bottom:6px">
              <div style="font-size:10px;font-weight:700;letter-spacing:1px;margin-bottom:4px">KOD QR ZLECENIA</div>
              <canvas id="print-qr-canvas" style="display:block;border:1px solid #ccc;padding:4px"></canvas>
              <div style="font-family:Consolas;font-size:9px;margin-top:2px;color:#555">${z.qr_code}</div>
            </div>` : ''}
          </div>
          <div style="text-align:right;font-size:12px">
            <div style="margin-bottom:20px">
              <div style="font-weight:700">Wydał</div>
              <div style="border-top:1px solid #000;margin-top:20px;width:150px;text-align:center;padding-top:3px;font-size:10px">podpis i data</div>
            </div>
            <div>
              <div style="font-weight:700">Przyjął</div>
              <div style="border-top:1px solid #000;margin-top:20px;width:150px;text-align:center;padding-top:3px;font-size:10px">podpis i data</div>
            </div>
          </div>
        </div>
      </div>

      <div class="btn-row no-print" style="margin-top:14px">
        <button class="btn btn-accent" onclick="doPrint()">🖨 Drukuj kartę</button>
        <button class="btn btn-outline" onclick="setState({printModal:null})">Zamknij</button>
      </div>
    </div>
  </div>`;
}

function doPrint() {
  const contentEl = document.getElementById('print-content');
  if (!contentEl) return;

  // Zamień canvas QR na data URL PRZED kopiowaniem HTML
  const qrCanvas = document.getElementById('print-qr-canvas');
  let qrImgSrc = null;
  if (qrCanvas && qrCanvas.width > 0) {
    qrImgSrc = qrCanvas.toDataURL('image/png');
  } else if (window._printQrDataUrl) {
    qrImgSrc = window._printQrDataUrl;
  }

  // Klonuj element żeby nie modyfikować DOM
  const clone = contentEl.cloneNode(true);

  // Podmień canvas na <img> w klonie
  const cloneCanvas = clone.querySelector('#print-qr-canvas');
  if (cloneCanvas && qrImgSrc) {
    const img = document.createElement('img');
    img.src = qrImgSrc;
    img.style.cssText = cloneCanvas.style.cssText || 'display:block;border:1px solid #ccc;padding:4px';
    cloneCanvas.parentNode.replaceChild(img, cloneCanvas);
  } else if (cloneCanvas) {
    // Canvas pusty (QR jeszcze się ładuje) – ukryj
    cloneCanvas.style.display = 'none';
  }

  const win = window.open('', '_blank', 'width=720,height=1020');
  if (!win) { alert('Zablokowano otwieranie okna. Zezwól na pop-upy dla tej strony.'); return; }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Karta zlecenia – ${state.printModal?.zlecenie?.numer||''}</title>
    <style>
      body{font-family:Arial,sans-serif;margin:10mm;background:#fff;color:#000;}
      @media print{body{margin:5mm;} @page{margin:10mm;} .no-print{display:none!important;}}
      table{border-collapse:collapse;}
    </style></head><body>${clone.outerHTML}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 600);
}

// ─── Edycja operacji ─────────────────────────────────────────
function editOperacja(op) {
  const n = document.getElementById('op-nazwa');
  const k = document.getElementById('op-kol');
  const s = document.getElementById('op-stan');
  const norma = document.getElementById('op-norma');
  const opis = document.getElementById('op-opis');
  const zbr = document.getElementById('op-zbrojenie');
  const zbrWrap = document.getElementById('zbrojenie-field-wrap');
  if (n) n.value = op.nazwa;
  if (k) k.value = op.kolejnosc;
  if (s) { s.value = op.stanowisko || ''; }
  if (norma) norma.value = op.czas_norma || 0;
  if (opis) opis.value = op.opis_czynnosci || '';
  if (zbr) zbr.value = op.czas_zbrojenia_min || 0;
  // show zbrojenie field if this stanowisko has zbrojenie active
  if (zbrWrap && s) {
    const selOpt = s.options[s.selectedIndex];
    const zbrAkt = selOpt ? selOpt.getAttribute('data-zbr') : '0';
    zbrWrap.style.display = (zbrAkt === '1' || op.czas_zbrojenia_min > 0) ? 'block' : 'none';
  }
  // swap button to update
  const addBtn = document.querySelector('[onclick^="addOperacja"]');
  if (addBtn) {
    addBtn.textContent = '💾 Zapisz zmiany';
    addBtn.setAttribute('onclick', `updateOperacja(${op.id}, ${state.operacjeModal.zlecenie.id})`);
  }
}

async function updateOperacja(opId, zlecenieId) {
  const nazwa = document.getElementById('op-nazwa')?.value?.trim();
  if (!nazwa) { alert('Podaj nazwę operacji'); return; }
  try {
    await put(`/api/operacje/${opId}`, {
      zlecenie_id: zlecenieId,
      nazwa,
      kolejnosc: parseInt(document.getElementById('op-kol').value)||1,
      stanowisko: document.getElementById('op-stan').value,
      czas_norma: parseFloat(document.getElementById('op-norma').value)||0,
      opis_czynnosci: document.getElementById('op-opis')?.value||'',
      czas_zbrojenia_min: parseFloat(document.getElementById('op-zbrojenie')?.value)||0,
    });
    await openOperacje(state.operacjeModal.zlecenie);
  } catch(e) { alert('Błąd: '+e.message); }
}

async function loadKoszty(zlecenieId) {
  setState({loading:true});
  try {
    const k = await get(`/api/zlecenia/${zlecenieId}/koszty`);
    setState({zlecenieKoszty:k, loading:false});
  } catch(e) { setState({loading:false}); alert(e.message); }
}

function renderKosztyProdukty(k) {
  if (!k.koszt_produktow || k.koszt_produktow <= 0) return '';
  let html = '<div style="background:var(--entry);border-radius:8px;padding:10px;margin-bottom:12px">'
    + '<div class="section-hdr" style="margin-bottom:8px">🛒 Produkty / Zakupy</div>';
  (k.produkty||[]).forEach(p => {
    html += '<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid rgba(46,53,72,.3)">'
          + '<span>' + p.nazwa + '</span>'
          + '<span style="color:var(--dim)">' + p.ilosc + ' szt. × ' + fmtPLN(p.cena) + '</span>'
          + '<span style="color:var(--accent);font-weight:600">' + fmtPLN(p.ilosc*p.cena) + '</span>'
          + '</div>';
  });
  html += '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-top:6px">'
        + '<span>Suma produktów</span><span style="color:var(--accent)">' + fmtPLN(k.koszt_produktow) + '</span>'
        + '</div></div>';
  return html;
}


function renderKosztyModal() {
  const k = state.zlecenieKoszty;
  if (!k) return '';
  return `
  <div class="modal-overlay">
    <div class="modal">
      <button class="modal-close" onclick="setState({zlecenieKoszty:null})">×</button>
      <h3>💰 Koszty – ${k.zlecenie.numer}</h3>
      <div class="stats-grid" style="margin-bottom:16px">
        <div class="stat-box"><div class="stat-val" style="font-size:20px">${fmtPLN(k.total_koszty||k.total_koszt)}</div><div class="stat-lbl">Koszt łączny</div></div>
        <div class="stat-box"><div class="stat-val" style="font-size:20px">${fmtPLN(k.przychod)}</div><div class="stat-lbl">Przychód</div></div>
        <div class="stat-box"><div class="stat-val" style="font-size:20px;color:${k.marza>=0?'var(--green)':'var(--red)'}">${fmtPLN(k.marza)}</div><div class="stat-lbl">Zysk / Marża</div></div>
        <div class="stat-box"><div class="stat-val">${k.total_godz}h</div><div class="stat-lbl">Godz. pracy</div></div>
      </div>
      ${renderKosztyProdukty(k)}
      ${k.koszt_zbrojenia > 0 ? `
      <div style="background:rgba(243,156,18,0.1);border:1px solid var(--orange);border-radius:8px;padding:10px 12px;margin-bottom:12px">
        <div class="section-hdr" style="margin-bottom:8px;color:var(--orange)">⚙ Zbrojenie</div>
        ${(k.zbrojenia||[]).map(z => `
        <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0">
          <span style="color:var(--dim)">${z.czas_min} min @ ${fmtPLN(z.stawka_godz)}/h</span>
          <span style="color:var(--orange);font-weight:600">${fmtPLN(z.koszt)}</span>
        </div>`).join('')}
        <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-top:6px;border-top:1px solid rgba(243,156,18,0.3);padding-top:6px">
          <span>Suma zbrojenia</span><span style="color:var(--orange)">${fmtPLN(k.koszt_zbrojenia)}</span>
        </div>
      </div>` : ''}
      <div class="section-hdr">Sesje pracy</div>
      ${k.sesje.map(s => `
      <div class="card" style="padding:10px;margin-bottom:6px">
        <div style="font-weight:600;font-size:13px">${s.pracownik}</div>
        <div style="font-size:12px;color:var(--dim)">${s.operacja} | ${s.stanowisko||'—'}</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px">
          <span>${s.godz}h @ ${fmtPLN(s.stawka_godz)}/h</span>
          <span style="color:var(--accent)">${fmtPLN(s.koszt)}</span>
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════


// ─── Render drzewa G→P w modalu zlecenia z przyciskami STEP ──────────────────
function renderZlModalGPTree(node, rootZlecenieId, ilocZlecona, depth) {
  depth = depth || 0;
  if (!node) return '';
  const isM = node.typ === 'M';
  const isG = node.typ === 'G';
  const hasChildren = node.children && node.children.length > 0;
  const indent = depth * 18;
  const ilocBOM = node._bom_ilosc != null ? node._bom_ilosc : node.ilosc;
  const ilocEfekt = (ilocZlecona != null && ilocBOM != null) ? ilocBOM * ilocZlecona : ilocBOM;
  const stepUrl = (node.model_3d_url || '').replace(/'/g,"\\'");
  const nodeId = node.id || 0;
  const borderColor = isG ? '#3b82f6' : isM ? '#6b7280' : '#8b5cf6';
  const typeColor   = isG ? '#60a5fa' : isM ? '#9ca3af' : '#a78bfa';
  const typeBg      = isG ? '59,130,246' : isM ? '107,114,128' : '139,92,246';

  let stepBtns = '';
  if (!isM && nodeId) {
    const previewBtn = stepUrl
      ? `<button onclick="event.stopPropagation();openStep3DViewer('${stepUrl}')" title="Podgląd STEP" style="background:rgba(59,130,246,0.12);border:1px solid #3b82f640;color:#60a5fa;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;white-space:nowrap">🧊 Podgląd</button>`
      : '';
    const uploadLbl = stepUrl ? '📎 Zmień STEP' : '📎 Wgraj STEP';
    const typeArg = isG ? "'wyrob'" : "'zlecenie'";
    const uploadBtn = `<button onclick="event.stopPropagation();zlModalUploadStepNode(${nodeId},${typeArg})" title="${uploadLbl}" style="background:rgba(139,92,246,0.12);border:1px solid #8b5cf640;color:#a78bfa;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;white-space:nowrap;font-weight:600">${uploadLbl}</button>`;
    const okMark = stepUrl ? '<span style="font-size:10px;color:var(--green)">✅</span>' : '';
    stepBtns = `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${previewBtn}${uploadBtn}${okMark}</div>`;
  }

  const nodeHtml = `
    <div style="margin-left:${indent}px;border-left:2px solid ${borderColor};padding:6px 10px;margin-bottom:4px;background:rgba(${typeBg},0.04);border-radius:0 6px 6px 0">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;background:rgba(${typeBg},0.15);color:${typeColor}">${node.typ||'?'}</span>
        <span style="font-size:13px;font-weight:700;color:${typeColor};font-family:Consolas">${node.symbol||node.numer||''}</span>
        <span style="font-size:12px;color:var(--dim);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${node.nazwa||node.opis||''}</span>
        ${ilocEfekt != null ? `<span style="font-size:11px;color:var(--dim);white-space:nowrap">${ilocEfekt} ${node.jednostka||'szt.'}</span>` : ''}
      </div>
      ${stepBtns}
    </div>`;

  const childrenHtml = hasChildren
    ? node.children.map(c => renderZlModalGPTree(c, rootZlecenieId, ilocEfekt || ilocZlecona, depth + 1)).join('')
    : '';

  return nodeHtml + childrenHtml;
}

// ─── Upload STEP w modalu zlecenia dla węzła wyrobu (G) lub zlecenia P ────────
async function zlModalUploadStepG(zlecenieId) {
  // Wrapper dla głównego G - używa wyrob przez hidden input
  await zlModalUploadStepNode(zlecenieId, 'wyrob');
}

async function zlModalUploadStepNode(nodeId, nodeTyp) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.step,.stp,.STEP,.STP,model/step,application/step,application/octet-stream,*/*';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = async function() {
    const file = this.files[0];
    document.body.removeChild(input);
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) { alert('Plik za duży (maks. 100 MB)'); return; }
    const statusEl = document.getElementById('zl-stepg-status');
    const setStatus = (msg, color) => { if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color || 'var(--dim)'; } };
    setStatus('⏳ Wgrywanie... 0%');
    try {
      const buf = await file.arrayBuffer();
      const result = await new Promise((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', SERVER_URL.replace(/\/$/, '') + '/api/step-upload');
        xhr.setRequestHeader('x-api-key', API_KEY);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
        xhr.upload.onprogress = e => { if (e.lengthComputable) setStatus('⏳ Wgrywanie... ' + Math.round(e.loaded/e.total*100) + '%'); };
        xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) res(JSON.parse(xhr.responseText)); else rej(new Error(xhr.responseText||'HTTP '+xhr.status)); };
        xhr.onerror = () => rej(new Error('Błąd sieci'));
        xhr.send(buf);
      });
      if (!result.ok || !result.url) throw new Error(result.error || 'Nieznany błąd');
      const endpoint = nodeTyp === 'wyrob'
        ? '/api/wyroby/' + nodeId + '/model3d'
        : '/api/zlecenia/' + nodeId + '/model3d';
      await patch(endpoint, {model_3d_url: result.url});
      setStatus('✅ Wgrano: ' + file.name, 'var(--green)');
      // Zaktualizuj hidden input dla głównego zlecenia G
      const hiddenInput = document.getElementById('zl-model3d');
      if (hiddenInput && nodeTyp === 'wyrob') {
        hiddenInput.value = result.url;
        const m = state.zlecenieModal;
        if (m) setState({zlecenieModal: {...m, model_3d_url: result.url}});
      }
      // Odśwież drzewo
      const m = state.zlecenieModal;
      if (m?.zlWyrobId) {
        try {
          const tree2 = await get('/api/wyroby/' + m.zlWyrobId + '/drzewo');
          setState({zlecenieModal: {...state.zlecenieModal, zlTree: tree2}});
        } catch(_) {}
      }
    } catch(e) {
      setStatus('✗ Błąd: ' + e.message, 'var(--red)');
    }
  };
  input.click();
}
