//  TAB: MAJSTER
// ══════════════════════════════════════════════════════════════
function renderMajster() {
  if (state.loading) return '<div class="spinner">⏳</div>';
  const stats = state.majsterStats;

  const subTabs = [{id:'live',label:'📡 Live'},{id:'zlecenia',label:'📋 Zlecenia'},{id:'priorytety',label:'🎯 Priorytety'},{id:'oblozenie',label:'🏭 Obłożenie'},{id:'podsumowanie',label:'📊 Podsumowanie'},{id:'wydajnosc',label:'🏆 Wydajność'},{id:'koszty',label:'💰 Koszty'},{id:'alerty',label:'⚠ Alerty'}];
  const tabBar = `
  <div class="tabs" style="flex-wrap:wrap;gap:2px">
    ${subTabs.map(t => `<button class="tab ${state.majsterSubTab===t.id?'active':''}"
      onclick="switchMajsterTab('${t.id}')">${t.label}</button>`).join('')}
  </div>`;

  // Zakładka Priorytety nie potrzebuje majsterStats
  if (state.majsterSubTab === 'priorytety') {
    return tabBar + renderMajsterPriorytety()
      + `<button class="btn-outline no-print" style="margin-top:8px" onclick="loadMajsterPriorytety();render()">🔄 Odśwież</button>`;
  }

  if (!stats) return tabBar + '<div class="empty">Ładowanie danych...</div>';

  let html = tabBar;

  if (state.majsterSubTab === 'live') {
    html += `
    <div class="stats-grid-3">
      <div class="stat-box"><div class="stat-val">${stats.aktywne_sesje.length}</div><div class="stat-lbl">online</div></div>
      <div class="stat-box"><div class="stat-val">${stats.dzis_sztuk}</div><div class="stat-lbl">sztuk dziś</div></div>
      <div class="stat-box"><div class="stat-val">${(stats.dzis_godz||0).toFixed(1)}</div><div class="stat-lbl">godz. dziś</div></div>
    </div>
    <div class="section-hdr">🟢 Pracownicy aktywni</div>`;
    if (!stats.aktywne_sesje.length) {
      html += `<div class="empty" style="padding:20px">Brak aktywnych sesji</div>`;
    } else {
      stats.aktywne_sesje.forEach(s => {
        const pauzList = JSON.parse(s.pauzy||'[]');
        const hasPauza = pauzList.length > 0 && !pauzList[pauzList.length-1].koniec;
        let elapsed = Math.floor((Date.now() - parseServerDT(s.start_time))/1000);
        for (const p of pauzList) {
          if (p.koniec) {
            elapsed -= Math.floor((parseServerDT(p.koniec) - parseServerDT(p.start))/1000);
          } else {
            elapsed -= Math.floor((Date.now() - parseServerDT(p.start))/1000);
          }
        }
        elapsed = Math.max(0, elapsed);
        html += `
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">👤 ${s.full_name} ${hasPauza?'<span class="badge badge-orange">PAUZA</span>':''}</div>
              <div class="card-sub">${s.typ==='nieprodukcyjna'?'⏸ Nieprodukcyjna':s.typ==='zbrojenie'?'⚙ Zbrojenie: '+(s.op_nazwa||'—'):s.typ==='inne_zlecenie'?'🔧 Inne: '+(s.uwagi||s.op_nazwa||'—'):'🔧 '+s.op_nazwa}</div>
              ${s.zl_numer?`<div class="card-sub">📋 ${s.zl_numer} – ${s.zl_nazwa}</div>`:''}
            </div>
            <div style="text-align:right">
              <div style="font-family:Consolas;color:var(--green);font-size:16px">${fmtTime(elapsed)}</div>
              ${s.czas_norma?`<div style="font-size:11px;color:var(--dim)">norma: ${s.czas_norma}min</div>`:''}
              <button class="btn-sm" style="margin-top:4px;font-size:11px" onclick="openEditSesjaModal(${s.sesja_id},'${s.start_time}','${s.end_time||''}')">✏ Koryguj czas</button>
              <button class="btn-sm" style="margin-top:2px;font-size:11px;background:rgba(231,76,60,0.15);color:var(--red);border-color:var(--red)" onclick="deleteSesjaConfirm(${s.sesja_id})">🗑 Usuń</button>
            </div>
          </div>
        </div>`;
      });
    }
  }

  if (state.majsterSubTab === 'zlecenia') {
    html += `<div class="section-hdr">📋 Zlecenia w toku</div>`;

    // Wyszukiwarka
    const zlSearch = (state.majsterZleceniaSearch || '').toLowerCase().trim();
    html += `
    <div style="position:relative;margin-bottom:12px">
      <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--dim);font-size:14px;pointer-events:none">🔍</span>
      <input
        id="mz-search-input"
        type="text"
        placeholder="Szukaj zlecenia (numer / nazwa)…"
        value="${(state.majsterZleceniaSearch||'').replace(/"/g,'&quot;')}"
        oninput="state.majsterZleceniaSearch=this.value; render(); requestAnimationFrame(()=>{ const el=document.getElementById('mz-search-input'); if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);} })"
        style="width:100%;box-sizing:border-box;padding:8px 10px 8px 34px;background:var(--entry);
               border:1.5px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none"
        onfocus="this.style.borderColor='var(--accent)'"
        onblur="this.style.borderColor='var(--border)'"
      >
      ${state.majsterZleceniaSearch ? `<button onclick="state.majsterZleceniaSearch=''; render();"
        style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;
               color:var(--dim);cursor:pointer;font-size:16px;line-height:1;padding:2px 4px">×</button>` : ''}
    </div>`;

    // Show all started operations (even multiple from same zlecenie)
    const wTokuOps = (stats.aktywne_sesje || []).filter(s => s.op_nazwa);
    if (wTokuOps.length) {
      html += `<div class="section-hdr" style="margin-top:8px;color:var(--green)">▶ Aktywne operacje (${wTokuOps.length})</div>`;
      wTokuOps.forEach(s => {
        const pauzy = JSON.parse(s.pauzy||'[]');
        const hasPauza = pauzy.length > 0 && !pauzy[pauzy.length-1].koniec;
        html += `<div class="card" style="border-color:var(--green);margin-bottom:6px">
          <div class="card-header">
            <div style="flex:1;min-width:0">
              <div class="card-title" style="font-size:13px">${s.op_nazwa||'—'} ${hasPauza?'<span class="badge badge-orange">PAUZA</span>':''}</div>
              <div class="card-sub">📋 ${s.zl_numer||'—'} – ${s.zl_nazwa||''}</div>
              <div class="card-sub">👤 ${s.full_name||'—'}</div>
            </div>
            ${s.czas_norma?`<div style="font-size:11px;color:var(--dim);text-align:right">norma: ${s.czas_norma}min</div>`:''}
          </div>
        </div>`;
      });
      html += `<div class="section-hdr" style="margin-top:10px">📋 Postęp zleceń</div>`;
    }

    // Filtruj podzlecenia P – pokazuj tylko zlecenia główne G (tak jak w zakładce Zlecenia)
    const majsterPodzlecenieIds = state.podzlecenieIds instanceof Set ? state.podzlecenieIds : new Set(state.podzlecenieIds || []);
    let zleceniaGlowne = (stats.zlecenia || []).filter(z => !majsterPodzlecenieIds.has(z.id));

    // Filtr wyszukiwania
    if (zlSearch) {
      zleceniaGlowne = zleceniaGlowne.filter(z =>
        (z.numer || '').toLowerCase().includes(zlSearch) ||
        (z.nazwa || '').toLowerCase().includes(zlSearch)
      );
    }

    if (!zleceniaGlowne.length) {
      html += `<div class="empty">Brak aktywnych zleceń</div>`;
    } else {
      zleceniaGlowne.forEach(z => {
        const prog = z.op_total > 0 ? Math.round((z.op_done/z.op_total)*100) : 0;
        const sztProg = z.ilosc_sztuk > 0 ? Math.round(((z.sztuki_wykonane||0)/z.ilosc_sztuk)*100) : 0;
        const przeterminowane = z.termin && new Date(z.termin) < new Date();
        const expanded = state.majsterExpandedZlecenie === z.id;
        const drzewo = (state.zlecenieDrzewa || {})[z.id];

        // Drzewko G→P inline – identyczne jak w zakładce Zlecenia
        let drzewoHtml = '';
        if (expanded) {
          if (!drzewo) {
            drzewoHtml = `<div style="padding:10px;text-align:center;color:var(--dim);font-size:12px">⏳ Ładowanie...</div>`;
          } else {
            const operacje    = drzewo.operacje || [];
            const materialy   = drzewo.materialy || [];
            const polprodukty = drzewo.polprodukty || [];
            const podzlecenia = drzewo.podzlecenia_drzewo || [];

            const renderOp = (op, indent) => {
              const stColor = op.status==='zakonczona'?'var(--green)':op.status==='oczekuje'?'var(--dim)':'var(--accent)';
              const done = op.status==='zakonczona';
              return `<div style="display:flex;align-items:center;gap:8px;padding:4px 10px 4px ${indent}px;border-bottom:1px solid rgba(46,53,72,0.4);${done?'opacity:.6':''}">
                <span style="color:${stColor};font-size:10px">●</span>
                <span style="font-size:12px;flex:1;${done?'text-decoration:line-through':''}">${op.kolejnosc}. ${op.nazwa}</span>
                ${op.stanowisko?`<span style="font-size:10px;color:var(--blue);background:rgba(52,152,219,.1);border-radius:3px;padding:1px 5px">${op.stanowisko}</span>`:''}
                ${op.czas_norma?`<span style="font-size:10px;color:var(--accent)">⏱${op.czas_norma}min</span>`:''}
                <span style="font-size:12px;font-weight:700;color:${stColor}">${op.ilosc_wykonana||0}/${z.ilosc_sztuk}</span>
              </div>`;
            };

            const renderMat = (m, indent) => `<div style="display:flex;align-items:center;gap:8px;padding:3px 10px 3px ${indent}px;border-bottom:1px solid rgba(46,53,72,0.3);background:rgba(243,156,18,0.03)">
              <span style="font-size:10px;color:var(--orange)">■</span>
              <span style="font-size:11px;font-weight:600;color:var(--orange);min-width:60px">${m.indeks||''}</span>
              <span style="font-size:11px;flex:1">${m.opis||''}</span>
              <span style="font-size:10px;color:var(--dim)">${m.ilosc} ${m.jednostka||''}</span>
            </div>`;

            const hdr = (icon, label, indent, color) => `<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:${color||'var(--dim)'};letter-spacing:.7px;padding:5px 10px 2px ${indent}px;background:rgba(0,0,0,.12)">${icon} ${label}</div>`;

            let treeRows = '';

            if (operacje.length) {
              treeRows += hdr('🔧', `Operacje G (${operacje.length})`, 10, 'var(--dim)');
              operacje.forEach(op => { treeRows += renderOp(op, 22); });
            }

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

              treeRows += `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px 6px 14px;border-bottom:1px solid rgba(139,92,246,0.2);border-top:1px solid rgba(139,92,246,0.15);background:rgba(139,92,246,0.08);margin-top:2px">
                <span style="font-size:13px">◆</span>
                <span style="font-size:13px;font-weight:700;color:#a78bfa;flex:1">
                  ${pNumer ? `<span style="color:#a78bfa">${pNumer}</span>` : `<span style="color:#a78bfa">${pSymbol}</span>`}
                  ${pNazwa ? `<span style="color:var(--dim);font-weight:400;font-size:12px"> – ${pNazwa}</span>` : ''}
                </span>
                ${pIlosc ? `<span style="font-size:10px;color:var(--dim)">${pIlosc} szt.</span>` : ''}
                <span style="font-size:10px;padding:1px 7px;border-radius:4px;background:rgba(139,92,246,0.15);color:${stCol};font-weight:700">${pStatus}</span>
              </div>`;

              if (pOps.length) {
                treeRows += hdr('🔧', `Operacje (${pOps.length})`, 28, '#8b7fd0');
                pOps.forEach(op => { treeRows += renderOp(op, 36); });
              } else if (pid) {
                treeRows += `<div style="padding:4px 10px 4px 28px;font-size:11px;color:var(--dim);font-style:italic">Brak operacji</div>`;
              }

              if (pMats.length) {
                treeRows += hdr('📦', `Materiały (${pMats.length})`, 28, '#8b7fd0');
                pMats.forEach(m => { treeRows += renderMat(m, 36); });
              }

              pSubs.forEach(sub => {
                const szap = sub.zap || {};
                const sNumer = szap.zp_numer || szap.zlecenie_p_numer || '';
                const sNazwa = szap.zp_nazwa || szap.wyrob_nazwa || szap.wyrob_p_symbol || '';
                const sStatus = szap.zp_status || szap.zlecenie_p_status || '—';
                const sSymbol = szap.wyrob_p_symbol || sNumer;
                const sCol = sStatus==='zakonczone'?'var(--green)':sStatus==='w_toku'?'var(--accent)':'var(--dim)';
                const sOps = sub.operacje || [];
                const sMats = sub.materialy || [];

                treeRows += `<div style="display:flex;align-items:center;gap:8px;padding:5px 10px 5px 28px;border-bottom:1px solid rgba(139,92,246,0.12);background:rgba(139,92,246,0.04)">
                  <span style="font-size:11px;color:#7c68c8">◆</span>
                  <span style="font-size:12px;font-weight:700;color:#9b8be8;flex:1">
                    ${sNumer ? sNumer : sSymbol}
                    ${sNazwa ? `<span style="color:var(--dim);font-weight:400;font-size:11px"> – ${sNazwa}</span>` : ''}
                  </span>
                  <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(139,92,246,0.1);color:${sCol};font-weight:700">${sStatus}</span>
                </div>`;
                if (sOps.length) {
                  treeRows += hdr('🔧', `Operacje (${sOps.length})`, 42, '#6b5fa0');
                  sOps.forEach(op => { treeRows += renderOp(op, 50); });
                }
                if (sMats.length) {
                  treeRows += hdr('📦', `Materiały (${sMats.length})`, 42, '#6b5fa0');
                  sMats.forEach(m => { treeRows += renderMat(m, 50); });
                }
              });
            });

            if (polprodukty.length) {
              treeRows += hdr('🔩', `Półprodukty P (${polprodukty.length})`, 10, 'var(--dim)');
              polprodukty.forEach(p => {
                treeRows += `<div style="display:flex;align-items:center;gap:8px;padding:4px 10px 4px 22px;border-bottom:1px solid rgba(46,53,72,0.5)">
                  <span style="font-size:11px;color:#a78bfa">◆</span>
                  <span style="font-size:12px;flex:1"><b style="color:#a78bfa">${p.symbol}</b> – ${p.nazwa}</span>
                  <span style="font-size:11px;color:var(--dim)">${p.ilosc} ${p.jednostka}</span>
                </div>`;
              });
            }

            if (materialy.length) {
              treeRows += hdr('📦', `Materiały G (${materialy.length})`, 10, 'var(--dim)');
              materialy.forEach(m => {
                treeRows += `<div style="display:flex;align-items:center;gap:8px;padding:4px 10px 4px 22px;border-bottom:1px solid rgba(46,53,72,0.5)">
                  <span style="font-size:11px;color:var(--orange)">■</span>
                  <span style="font-size:12px;flex:1"><b style="color:var(--orange)">${m.indeks}</b> – ${m.opis}</span>
                  <span style="font-size:11px;color:var(--dim)">${m.ilosc} ${m.jednostka}</span>
                </div>`;
              });
            }

            if (!treeRows) {
              treeRows = `<div style="text-align:center;padding:12px;color:var(--dim);font-size:12px">Brak operacji, podzleceń ani materiałów.</div>`;
            }

            drzewoHtml = `<div style="background:var(--entry);border-radius:0 0 8px 8px;border-top:1px solid var(--border);margin-top:4px">${treeRows}</div>`;
          }
        }

        html += `
        <div class="card" style="${przeterminowane?'border-color:var(--red)':''}padding-bottom:${expanded?'0':''}">
          <div class="card-header" style="cursor:pointer" onclick="toggleMajsterZlecenie(${z.id})">
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:13px;color:var(--dim);transition:transform .2s;display:inline-block;transform:${expanded?'rotate(90deg)':'rotate(0deg)'}">▶</span>
                <span class="card-title">${z.numer} ${przeterminowane?'<span class="badge badge-red">TERMIN!</span>':''}</span>
              </div>
              <div class="card-sub" style="margin-left:21px">${z.nazwa}</div>
              ${z.termin?`<div class="card-sub" style="margin-left:21px">📅 Termin: ${fmtDate(z.termin)}</div>`:''}
              ${(() => { const estOps = (state.majsterOpsCache&&state.majsterOpsCache[z.id])||null; const est=szacowanyKoniec(z,estOps); return est?`<div class="card-sub" style="color:var(--blue);margin-left:21px">🕐 Szac. koniec: ${fmtEstimatedKoniec(est)}</div>`:''; })()}
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              ${statusBadge(z.status)}
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--dim);margin-bottom:4px">
            <span>Operacje: ${z.op_done}/${z.op_total}</span><span>${prog}%</span>
          </div>
          <div class="progress-wrap">
            <div class="progress-bar" style="width:${prog}%;background:${prog>=100?'var(--green)':'var(--accent)'}"></div>
          </div>
          <div style="font-size:12px;color:var(--dim);margin-top:4px">
            📦 Sztuki: <b style="color:${sztProg>=100?'var(--green)':'var(--text)'}">${z.sztuki_wykonane||0}/${z.ilosc_sztuk}</b> (${sztProg}%)
          </div>
          ${drzewoHtml}
        </div>`;
      });
    }
  }

    if (state.majsterSubTab === 'koszty') {
    html += `<div class="section-hdr">💰 Koszty pracowników dziś</div>`;
    const koszty = stats.koszty_dzis || [];
    if (!koszty.length) {
      html += `<div class="empty">Brak danych</div>`;
    } else {
      let total = 0;
      html += `<table class="data-table"><thead><tr><th>Pracownik</th><th>Stanowisko</th><th>Min.</th><th>Koszt</th></tr></thead><tbody>`;
      koszty.forEach(k => {
        const koszt = k.koszt || 0;
        total += koszt;
        const min = Math.round((k.godz||0) * 60);
        html += `<tr>
          <td>${k.full_name}</td>
          <td style="font-size:11px">${k.stanowisko||'—'}</td>
          <td>${min}</td>
          <td style="color:var(--accent)">${fmtPLN(koszt)}</td>
        </tr>`;
      });
      html += `</tbody></table>
      <div class="card" style="margin-top:10px;text-align:center">
        <div style="font-size:12px;color:var(--dim)">ŁĄCZNIE DZIŚ</div>
        <div style="font-size:28px;font-weight:700;color:var(--accent)">${fmtPLN(total)}</div>
      </div>`;
    }
  }

  if (state.majsterSubTab === 'alerty') {
    const alerty = stats.alerty_norm || [];
    html += `<div class="section-hdr">⚠ Alerty norm (${alerty.length})</div>`;
    if (!alerty.length) {
      html += `<div class="card" style="text-align:center;padding:20px;border-color:var(--green)">
        <div style="font-size:32px">✅</div>
        <div style="color:var(--green);margin-top:8px">Wszystkie operacje w normie</div>
      </div>`;
    } else {
      alerty.forEach(a => {
        html += `
        <div class="alert-banner">
          <div style="font-weight:700">⚠ Przekroczono normę – ${a.zlecenie}, operacja: ${a.operacja}</div>
          <div style="font-size:12px;margin-top:2px">👤 ${a.pracownik}</div>
          <div>Norma: ${a.norma_min} min/szt. × ${a.ilosc_sztuk} szt. = ${a.norma_calkowita_min} min | Czas: ${a.elapsed_min} min | <strong style="font-size:15px">+${a.przekroczenie_pct}%</strong></div>
        </div>`;
      });
    }
  }

  if (state.majsterSubTab === 'priorytety') {
    html += renderMajsterPriorytety();
  }

  if (state.majsterSubTab === 'oblozenie') {
    html += renderGantt();
    // Attach gantt events after DOM update
    setTimeout(() => ganttAttachEvents(), 0);
  }

  if (state.majsterSubTab === 'wydajnosc') {
    html += renderMajsterWydajnosc();
  }

  if (state.majsterSubTab === 'podsumowanie') {
    html += renderMajsterPodsumowanie(stats);
  }

  html += `<button class="btn-outline no-print" style="margin-top:8px" onclick="loadMajster()">🔄 Odśwież</button>`;
  return html;
}

function switchMajsterTab(tab) {
  setState({majsterSubTab: tab}, true);
  if (tab === 'wydajnosc' && !state.wydajnoscMajster) {
    loadWydajnoscMajster(state.wydajnoscOkres);
  }
  if (tab === 'oblozenie') {
    loadOblozenie();
  }
  if (tab === 'priorytety') {
    loadMajsterPriorytety();
  }
  render();
}

// ─── Obłożenie stanowisk ───────────────────────────────────────────────────────
async function loadOblozenie() {
  setState({oblozenieLading: true, oblozenie: null});
  render();
  try {
    const data = await get('/api/oblozenie');
    setState({oblozenie: data, oblozenieLading: false});
  } catch(e) {
    setState({oblozenie: {error: e.message}, oblozenieLading: false});
  }
  render();
}

function renderOblozenie() {
  if (state.oblozenieLading) return '<div class="spinner">⏳</div>';
  const ob = state.oblozenie;
  if (!ob) return '<div style="text-align:center;padding:30px;color:var(--dim)">Kliknij zakładkę aby załadować dane.</div>';
  if (ob.error) return `<div class="error-banner">⚠ ${ob.error}</div><button class="btn-outline" onclick="loadOblozenie()">🔄 Spróbuj ponownie</button>`;
  if (!ob.length) return '<div class="empty">Brak stanowisk – dodaj stanowiska w ustawieniach Stawki lub przypisz stanowisko do operacji.</div>';

  const selected = state.oblozenieSelected;
  let html = '';

  // Lista stanowisk jako karty/przyciski
  html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">';
  ob.forEach(st => {
    const opCount = st.operacje.length;
    const isActive = selected === st.stanowisko;
    const urgentCount = st.operacje.filter(o => {
      if (!o.termin) return false;
      const days = Math.ceil((new Date(o.termin) - new Date()) / 86400000);
      return days <= 3;
    }).length;
    const dotColor = urgentCount > 0 ? 'var(--red)' : opCount > 0 ? 'var(--green)' : 'var(--border)';
    html += `<button onclick="setState({oblozenieSelected:'${st.stanowisko.replace(/'/g,"\'")}'}); render();"
      style="display:flex;flex-direction:column;align-items:flex-start;padding:10px 14px;border:2px solid ${isActive ? 'var(--accent)' : 'var(--border)'};
             border-radius:10px;background:${isActive ? 'rgba(232,160,32,.1)' : 'var(--panel)'};cursor:pointer;text-align:left;min-width:130px;">
      <span style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:13px;color:${isActive ? 'var(--accent)' : 'var(--text)'}">
        <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};display:inline-block"></span>
        ${st.stanowisko}
      </span>
      <span style="font-size:10px;color:var(--dim);margin-top:3px">${opCount} operacji${urgentCount > 0 ? ` · <span style="color:var(--red)">${urgentCount} pilnych</span>` : ''}</span>
    </button>`;
  });
  html += '</div>';

  // Szczegóły wybranego stanowiska
  if (!selected) {
    html += '<div class="empty" style="padding:20px">👆 Wybierz stanowisko aby zobaczyć operacje</div>';
    return html;
  }

  const stData = ob.find(s => s.stanowisko === selected);
  if (!stData) return html;

  html += `<div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">
    🏭 ${stData.stanowisko}${stData.stawka_godz ? ' · ' + stData.stawka_godz.toFixed(2) + ' zł/h' : ''}
    ${stData.opis ? '<span style="font-weight:400;text-transform:none;margin-left:6px">'+stData.opis+'</span>' : ''}
  </div>`;

  if (!stData.operacje.length) {
    html += '<div class="empty" style="padding:20px">Brak aktywnych operacji na tym stanowisku.</div>';
    return html;
  }

  // ── Pomocnicze funkcje harmonogramu (czas Europe/Warsaw = CEST) ──────────
  const WORK_START = 6, WORK_END = 22;
  function nowCEST() {
    // Używamy jawnej strefy Europa/Warszawa
    const now = new Date();
    // getTimezoneOffset w minutach; dla CEST to -120 (UTC+2)
    const warsawOffset = -120; // UTC+2
    const localOffset = now.getTimezoneOffset(); // min, negative for east
    const diff = (localOffset - warsawOffset) * 60000;
    return new Date(now.getTime() + diff);
  }
  function addWorkMinutes(fromDate, minutes) {
    let d = new Date(fromDate);
    let rem = minutes;
    while (rem > 0) {
      const h = d.getHours(), m = d.getMinutes();
      if (h < WORK_START) { d.setHours(WORK_START, 0, 0, 0); continue; }
      if (h >= WORK_END)  { d.setDate(d.getDate()+1); d.setHours(WORK_START,0,0,0); continue; }
      const minsToDayEnd = (WORK_END - h) * 60 - m;
      if (rem <= minsToDayEnd) { d = new Date(d.getTime() + rem*60000); rem = 0; }
      else { rem -= minsToDayEnd; d.setDate(d.getDate()+1); d.setHours(WORK_START,0,0,0); }
    }
    return d;
  }
  function fmtHHMM(date) {
    const h = ('0'+date.getHours()).slice(-2), m = ('0'+date.getMinutes()).slice(-2);
    const day = date.toLocaleDateString('pl-PL',{timeZone:'Europe/Warsaw',weekday:'short',day:'numeric',month:'numeric'});
    return `${day} ${h}:${m}`;
  }
  function calcElapsedMin(startStr, pauzyStr) {
    if (!startStr) return 0;
    const start = parseServerDT(startStr);
    let elapsed = (Date.now() - start.getTime()) / 60000;
    try {
      const pauzy = JSON.parse(pauzyStr || '[]');
      for (const p of pauzy) {
        const pStart = parseServerDT(p.start);
        const pEnd = p.koniec ? parseServerDT(p.koniec) : new Date();
        elapsed -= (pEnd - pStart) / 60000;
      }
    } catch(_) {}
    return Math.max(0, elapsed);
  }

  // ── Pre-obliczanie harmonogramu dla CAŁEGO stanowiska ─────────────────────
  // Porządek: najpierw operacje w_toku (blokują maszynę teraz), potem oczekujące sekwencyjnie
  const allOps = stData.operacje;
  const wTokuOps = allOps.filter(o => o.op_status === 'w_toku');
  const oczekujeOps = allOps.filter(o => o.op_status === 'oczekuje');

  const opSchedule = {}; // op_id -> {start, end, remainingMin, overTime}
  const now = nowCEST();

  // Operacje w toku – szacowany koniec na podstawie pozostałego czasu
  let maxWTokuEnd = new Date(now);
  for (const o of wTokuOps) {
    const ilosc = Math.max(1, (o.ilosc_sztuk||1) - (o.ilosc_wykonana||0));
    const totalMin = (o.czas_norma||0) * ilosc + (o.czas_zbrojenia_min||0);
    if (totalMin > 0) {
      const elapsed = calcElapsedMin(o.sesja_start, o.sesja_pauzy);
      const remaining = Math.max(0, totalMin - elapsed);
      const overTime = elapsed > totalMin;
      const end = addWorkMinutes(new Date(now), remaining);
      opSchedule[o.op_id] = { start: new Date(now), end, remainingMin: remaining, totalMin, overTime };
      if (end > maxWTokuEnd) maxWTokuEnd = end;
    }
  }

  // Operacje oczekujące – kolejka zaczyna się gdy skończy się ostatnia w_toku
  let ptr = new Date(maxWTokuEnd);
  const h = ptr.getHours();
  if (h < WORK_START) ptr.setHours(WORK_START, 0, 0, 0);
  else if (h >= WORK_END) { ptr.setDate(ptr.getDate()+1); ptr.setHours(WORK_START,0,0,0); }

  // oczekujeOps są już posortowane wg kolejności z API (termin, zlecenie, kolejnosc)
  for (const o of oczekujeOps) {
    const ilosc = Math.max(1, (o.ilosc_sztuk||1) - (o.ilosc_wykonana||0));
    const totalMin = (o.czas_norma||0) * ilosc + (o.czas_zbrojenia_min||0);
    if (totalMin > 0) {
      const start = new Date(ptr);
      const end = addWorkMinutes(start, totalMin);
      opSchedule[o.op_id] = { start, end, totalMin };
      ptr = new Date(end);
    }
  }

  // ── Grupuj po zleceniu (może być wiele operacji z jednego zlecenia) ────────
  const byZlecenie = {};
  stData.operacje.forEach(o => {
    const key = o.zlecenie_id;
    if (!byZlecenie[key]) byZlecenie[key] = {zlecenie_numer: o.zlecenie_numer, zlecenie_nazwa: o.zlecenie_nazwa, termin: o.termin, ilosc_sztuk: o.ilosc_sztuk, zlecenie_status: o.zlecenie_status, ops: []};
    byZlecenie[key].ops.push(o);
  });

  // Sortuj grupy wg terminu
  const groups = Object.values(byZlecenie).sort((a,b) => {
    if (!a.termin && !b.termin) return 0;
    if (!a.termin) return 1;
    if (!b.termin) return -1;
    return new Date(a.termin) - new Date(b.termin);
  });

  // Przechowaj grupy globalnie – dblclick odwołuje się przez indeks
  window._oblozenieGroups = groups;

  groups.forEach((g, gIdx) => {
    const today = new Date(); today.setHours(0,0,0,0);
    const termin = g.termin ? new Date(g.termin) : null;
    const daysLeft = termin ? Math.ceil((termin - today) / 86400000) : null;
    let terminColor = 'var(--dim)';
    let terminLabel = g.termin ? g.termin.slice(0,10) : '—';
    if (daysLeft !== null) {
      if (daysLeft < 0) { terminColor = 'var(--red)'; terminLabel += ' ⚠ PRZEKROCZONY'; }
      else if (daysLeft === 0) { terminColor = 'var(--red)'; terminLabel += ' (dziś)'; }
      else if (daysLeft <= 3) { terminColor = 'var(--orange)'; terminLabel += ` (${daysLeft}d)`; }
      else { terminColor = 'var(--green)'; terminLabel += ` (${daysLeft}d)`; }
    }

    const statusColors = {nowe:'var(--blue)',w_realizacji:'var(--green)',zakonczone:'var(--dim)',anulowane:'var(--red)'};
    const zStatusColor = statusColors[g.zlecenie_status] || 'var(--dim)';

    html += `<div style="background:var(--entry);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;border-left:3px solid ${terminColor};cursor:pointer;user-select:none"
      title="Kliknij dwukrotnie aby zobaczyć operacje"
      ondblclick="openOblozenieZlecenieModal(${gIdx})"
      >
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div>
          <div style="font-weight:700;font-size:14px">${g.zlecenie_numer} <span style="font-size:10px;color:var(--dim);font-weight:400;margin-left:4px">↩ 2× klik = operacje</span></div>
          <div style="color:var(--dim);font-size:12px;margin-top:1px">${g.zlecenie_nazwa}</div>
        </div>
        <div style="text-align:right;font-size:11px">
          <div style="color:${terminColor};font-weight:700">📅 ${terminLabel}</div>
          <div style="color:var(--dim);margin-top:2px">Ilość: <b style="color:var(--text)">${g.ilosc_sztuk} szt.</b></div>
        </div>
      </div>`;

    g.ops.forEach(o => {
      const prog = g.ilosc_sztuk > 0 ? Math.min(100, Math.round((o.ilosc_wykonana / g.ilosc_sztuk) * 100)) : 0;
      const opStatusColors = {oczekuje:'var(--dim)',w_toku:'var(--blue)',zakonczona:'var(--green)'};
      const opStatusLabels = {oczekuje:'⏳ oczekuje',w_toku:'▶ w toku',zakonczona:'✅ zakończona'};
      const opColor = opStatusColors[o.op_status] || 'var(--dim)';

      // Czas trwania operacji
      const ilosc = Math.max(1, g.ilosc_sztuk - (o.ilosc_wykonana||0));
      const czNorma = o.czas_norma || 0;
      const czZbr = o.czas_zbrojenia_min || 0;
      const totalMin = czNorma * ilosc + czZbr;
      const czLabel = totalMin > 0
        ? (czNorma > 0 ? `${czNorma} min/szt` : '') + (czZbr > 0 ? (czNorma>0?' + ':'')+`zbr ${czZbr} min` : '')
        : '';

      // Harmonogram z pre-obliczonego rozkładu
      let scheduleHtml = '';
      const sched = opSchedule[o.op_id];
      if (o.op_status === 'w_toku' && sched) {
        const remH = (sched.remainingMin/60).toFixed(1);
        const remMin = Math.round(sched.remainingMin);
        scheduleHtml = `<div style="font-size:10px;color:var(--green);margin-top:3px">
          ▶ W toku · koniec: <b>${fmtHHMM(sched.end)}</b>
          ${sched.overTime ? '<span style="color:var(--orange)">⚠ przekroczona norma</span>'
            : sched.remainingMin >= 60 ? `<span style="color:var(--dim)">(${remH}h)</span>`
            : `<span style="color:var(--dim)">(${remMin} min)</span>`}
        </div>`;
      } else if (o.op_status === 'oczekuje' && sched) {
        const durMin = sched.totalMin;
        scheduleHtml = `<div style="font-size:10px;color:var(--blue);margin-top:3px">
          🕐 <b>${fmtHHMM(sched.start)}</b> → <b>${fmtHHMM(sched.end)}</b>
          ${durMin >= 60 ? `<span style="color:var(--dim)">(${(durMin/60).toFixed(1)}h)</span>` : `<span style="color:var(--dim)">(${durMin} min)</span>`}
        </div>`;
      }

      html += `<div style="padding:8px 10px;background:var(--panel);border-radius:7px;margin-top:6px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:${g.ilosc_sztuk > 1 ? 5 : 2}px">
          <div style="flex:1">
            <span style="font-size:12px;font-weight:600">#${o.op_kolejnosc} ${o.op_nazwa}</span>
            ${czLabel ? `<span style="font-size:10px;color:var(--dim);margin-left:6px">(${czLabel})</span>` : ''}
            ${o.opis_czynnosci ? `<div style="font-size:10px;color:var(--dim);margin-top:2px;line-height:1.4">${o.opis_czynnosci.slice(0,120)}${o.opis_czynnosci.length>120?'…':''}</div>` : ''}
            ${scheduleHtml}
          </div>
          <span style="font-size:10px;color:${opColor};font-weight:700;margin-left:8px;white-space:nowrap">${opStatusLabels[o.op_status]||o.op_status}</span>
        </div>`;

      if (g.ilosc_sztuk > 1 || o.ilosc_wykonana > 0) {
        html += `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">
          <div style="flex:1;background:var(--border);border-radius:4px;height:5px;overflow:hidden">
            <div style="width:${prog}%;height:100%;border-radius:4px;background:${prog>=100?'var(--green)':prog>0?'var(--blue)':'var(--border)'}"></div>
          </div>
          <span style="font-size:10px;color:var(--dim);white-space:nowrap">${o.ilosc_wykonana}/${g.ilosc_sztuk} szt.</span>
        </div>`;
      }
      html += '</div>';
    });

    html += '</div>';
  });

  html += `<button class="btn-outline" style="margin-top:4px" onclick="loadOblozenie()">🔄 Odśwież</button>`;
  return html;
}

// ══════════════════════════════════════════════════════════════
//  MODAL – Operacje zlecenia w obłożeniu (dblclick)
// ══════════════════════════════════════════════════════════════
function openOblozenieZlecenieModal(gIdx) {
  const g = (window._oblozenieGroups || [])[gIdx];
  if (!g) return;
  setState({ oblozenieZlecenieModal: g });
}

function renderOblozenieZlecenieModal() {
  const g = state.oblozenieZlecenieModal;
  if (!g) return '';

  const opStatusColors = {oczekuje:'var(--dim)', w_toku:'var(--blue)', zakonczona:'var(--green)'};
  const opStatusLabels = {oczekuje:'⏳ oczekuje', w_toku:'▶ w toku', zakonczona:'✅ zakończona'};

  let opsHtml = '';
  (g.ops || []).forEach(o => {
    const prog = g.ilosc_sztuk > 0 ? Math.min(100, Math.round(((o.ilosc_wykonana||0) / g.ilosc_sztuk) * 100)) : 0;
    const opColor = opStatusColors[o.op_status] || 'var(--dim)';
    const czNorma = o.czas_norma || 0;
    const czZbr = o.czas_zbrojenia_min || 0;
    const ilosc = Math.max(1, (g.ilosc_sztuk||1) - (o.ilosc_wykonana||0));
    const totalMin = czNorma * ilosc + czZbr;
    const czLabel = totalMin > 0
      ? (czNorma > 0 ? `${czNorma} min/szt` : '') + (czZbr > 0 ? (czNorma>0?' + ':'')+`zbr ${czZbr} min` : '')
      : '';

    opsHtml += `
    <div style="background:var(--entry);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div style="flex:1">
          <div style="font-weight:700;font-size:13px">#${o.op_kolejnosc} ${o.op_nazwa}</div>
          ${o.stanowisko ? `<div style="font-size:11px;color:var(--blue);margin-top:2px">🏭 ${o.stanowisko}</div>` : ''}
          ${czLabel ? `<div style="font-size:10px;color:var(--dim);margin-top:2px">⏱ ${czLabel}</div>` : ''}
          ${o.opis_czynnosci ? `<div style="font-size:10px;color:var(--dim);margin-top:3px;line-height:1.4">${o.opis_czynnosci.slice(0,150)}${o.opis_czynnosci.length>150?'…':''}</div>` : ''}
        </div>
        <span style="font-size:11px;color:${opColor};font-weight:700;margin-left:10px;white-space:nowrap">${opStatusLabels[o.op_status]||o.op_status}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="flex:1;background:var(--border);border-radius:4px;height:5px;overflow:hidden">
          <div style="width:${prog}%;height:100%;border-radius:4px;background:${prog>=100?'var(--green)':prog>0?'var(--blue)':'var(--border)'}"></div>
        </div>
        <span style="font-size:10px;color:var(--dim);white-space:nowrap">${o.ilosc_wykonana||0}/${g.ilosc_sztuk} szt. (${prog}%)</span>
      </div>
    </div>`;
  });

  return `
  <div class="modal-overlay" onclick="if(event.target===this)setState({oblozenieZlecenieModal:null})">
    <div class="modal" style="max-width:520px;width:95%">
      <div class="modal-header">
        <div>
          <div style="font-weight:700;font-size:15px">📋 ${g.zlecenie_numer}</div>
          <div style="color:var(--dim);font-size:12px;margin-top:2px">${g.zlecenie_nazwa}</div>
        </div>
        <button class="modal-close" onclick="setState({oblozenieZlecenieModal:null})">×</button>
      </div>
      <div style="padding:14px 16px;max-height:70vh;overflow-y:auto">
        <div style="font-size:12px;color:var(--dim);margin-bottom:12px">
          Ilość: <b style="color:var(--text)">${g.ilosc_sztuk} szt.</b>
          ${g.termin ? ` · Termin: <b style="color:var(--text)">${g.termin.slice(0,10)}</b>` : ''}
          · Operacji: <b style="color:var(--text)">${(g.ops||[]).length}</b>
        </div>
        ${opsHtml || '<div class="empty">Brak operacji</div>'}
      </div>
      <div style="padding:10px 16px;border-top:1px solid var(--border)">
        <button class="btn btn-outline" style="width:100%" onclick="setState({oblozenieZlecenieModal:null})">Zamknij</button>
      </div>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════
//  FEEDBACK / OCENY
// ══════════════════════════════════════════════════════════════
function setFeedbackRating(n) {
  setState({feedbackRating: n});
}

function openFeedbackModal() {
  setState({feedbackModal: true});
}

async function sendFeedback(fromModal) {
  const ocena = state.feedbackRating;
  if (!ocena) { alert('Wybierz ocenę (1-5 gwiazdek)'); return; }
  const wiadomosc = state.feedbackMsg || '';
  try {
    await post('/api/feedback', {
      user_id: state.user?.id,
      user_name: state.user?.full_name,
      ocena,
      wiadomosc
    });
    setState({feedbackModal: false, feedbackRating: 0, feedbackMsg: ''});
    alert('✅ Dziękujemy za opinię!');
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function loadMaterialyCount() {
  try {
    const r = await get('/api/materialy/count');
    setState({materialyCount: r.count});
  } catch(e) {}
}

async function importMaterialyXlsx() {
  // Szukaj input w magazynie (mag-xlsx-file) lub w adminie (mat-xlsx-file)
  const fileInput = document.getElementById('mag-xlsx-file') || document.getElementById('mat-xlsx-file');
  const statusEl = document.getElementById('mat-import-status');
  if (!fileInput?.files?.length) { alert('Wybierz plik xlsx'); return; }
  const file = fileInput.files[0];
  if (statusEl) statusEl.textContent = '⏳ Importuję...';
  try {
    const fd = new FormData();
    fd.append('file', file);
    const resp = await fetch((SERVER_URL.replace(/\/$/,'')) + '/api/materialy/import', {
      method: 'POST',
      headers: {'x-api-key': API_KEY},
      body: fd
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || 'Błąd importu');
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--green)">✅ Zaimportowano ${data.imported} pozycji${data.skipped?' · pominięto '+data.skipped:''}</span>`;
    await loadMaterialyCount();
    await loadMagazynMaterialyCount();
    render();
  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--red)">❌ ${e.message}</span>`;
  }
}

async function loadMaterialyPreview() {
  const q = document.getElementById('mat-preview-q')?.value || '';
  const el = document.getElementById('mat-preview-results');
  if (el) el.textContent = '⏳ Szukam...';
  try {
    const data = await get(`/api/materialy?q=${encodeURIComponent(q)}&limit=30`);
    if (!el) return;
    if (!data.length) { el.textContent = 'Brak wyników.'; return; }
    el.innerHTML = `<table style="width:100%;border-collapse:collapse">
      <thead><tr style="border-bottom:1px solid var(--border)">
        <th style="text-align:left;padding:4px 8px;color:var(--dim)">Indeks</th>
        <th style="text-align:left;padding:4px 8px;color:var(--dim)">Opis</th>
        <th style="text-align:right;padding:4px 8px;color:var(--dim)">Dostępne</th>
        <th style="text-align:right;padding:4px 8px;color:var(--dim)">Stan rzecz.</th>
        <th style="text-align:center;padding:4px 8px;color:var(--dim)">Jm</th>
      </tr></thead><tbody>
      ${data.map(m => `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:4px 8px;font-family:monospace;font-size:11px">${m.indeks}</td>
        <td style="padding:4px 8px;font-size:12px">${m.opis}</td>
        <td style="padding:4px 8px;text-align:right;color:${m.do_dyspozycji>0?'var(--green)':'var(--red)'}"><b>${(m.do_dyspozycji??0).toFixed(3)}</b></td>
        <td style="padding:4px 8px;text-align:right;color:var(--dim)">${(m.stan_rzeczywisty??0).toFixed(3)}</td>
        <td style="padding:4px 8px;text-align:center;color:var(--dim)">${m.jm}</td>
      </tr>`).join('')}
      </tbody></table>`;
  } catch(e) { if (el) el.textContent = 'Błąd: ' + e.message; }
}

async function loadAdminFeedbacks() {
  setState({adminFeedbacks: null});
  try {
    const data = await get('/api/feedback');
    setState({adminFeedbacks: data});
  } catch(e) {
    setState({adminFeedbacks: []});
    console.error('Błąd ładowania ocen:', e.message);
  }
}

// ══════════════════════════════════════════════════════════════
