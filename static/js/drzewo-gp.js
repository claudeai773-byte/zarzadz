// MODUŁ: DRZEWO G/P – Struktura technologiczna
// ═══════════════════════════════════════════════════════════════════════════════

async function loadDrzewoGP() {
  if (state.drzewoLoading) return;
  setState({drzewoLoading: true}, true);
  try {
    const [g, p, zl] = await Promise.all([
      get('/api/wyroby?typ=G'),
      get('/api/wyroby?typ=P'),
      get('/api/zlecenia'),
    ]);
    const zlG = zl.filter(z => g.some(wg => wg.symbol === z.numer));
    setState({drzewoWyrobyG: g, drzewoWyrobyP: p, drzewoZleceniaG: zlG, drzewoLoading: false});
  } catch(e) {
    setState({drzewoLoading: false, error: 'Błąd ładowania drzewa: ' + e.message});
  }
}

async function drzewoSelectG(wyrob) {
  setState({drzewoSelectedG: wyrob, drzewoPanel: 'drzewo', drzewoTree: null, drzewoTreeLoading: true, drzewoMrp: null, drzewoMrpView: 'zbiorczy', drzewoZleceniaP: [], drzewoZleceniaPLoading: true});
  try {
    const tree = await get('/api/wyroby/' + wyrob.id + '/drzewo');
    setState({drzewoTree: tree, drzewoTreeLoading: false});
  } catch(e) {
    setState({drzewoTreeLoading: false});
  }
  // Załaduj zlecenia P (przez zapotrzebowania zlecenia G)
  try {
    const allZl = state.drzewoZleceniaG;
    const zlecenieG = allZl.find(z => z.numer === wyrob.symbol);
    if (zlecenieG) {
      const zapotrz = await get('/api/zlecenia/' + zlecenieG.id + '/zapotrzebowania');
      const zleceniaAll = await get('/api/zlecenia');
      const zleceniaP = (zapotrz || [])
        .filter(z => z.zlecenie_p_id)
        .map(z => {
          const zl = zleceniaAll.find(x => x.id === z.zlecenie_p_id);
          return zl ? {...zl, _zap_id: z.id, _wyrob_p_symbol: z.wyrob_p_symbol} : null;
        })
        .filter(Boolean);
      setState({drzewoZleceniaP: zleceniaP, drzewoZleceniaPLoading: false});
    } else {
      setState({drzewoZleceniaP: [], drzewoZleceniaPLoading: false});
    }
  } catch(e) {
    setState({drzewoZleceniaP: [], drzewoZleceniaPLoading: false});
  }
}

async function drzewoLoadMrp(gid) {
  setState({drzewoMrpLoading: true, drzewoMrp: null}, true); render();
  try {
    const d = await get('/api/zlecenia/' + gid + '/mrp');
    setState({drzewoMrp: d, drzewoMrpLoading: false});
  } catch(e) {
    setState({drzewoMrpLoading: false, error: 'Błąd MRP: ' + e.message});
  }
}

function drzewoToggleNode(key) {
  const expanded = {...state.drzewoExpanded};
  expanded[key] = !expanded[key];
  setState({drzewoExpanded: expanded}, true); render();
}

async function drzewoUploadPdf(file) {
  setState({drzewoImportUploading: true, drzewoImportResult: null, drzewoImportError: null}, true); render();
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await fetch(SERVER_URL.replace(/\/$/, '') + '/api/import-drzewo-gp', {
      method: 'POST',
      headers: {'x-api-key': API_KEY},
      body: fd,
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || 'Błąd importu');
    setState({drzewoImportResult: d, drzewoImportUploading: false});
    loadDrzewoGP();
  } catch(e) {
    setState({drzewoImportError: e.message, drzewoImportUploading: false});
  }
}

async function drzewoSaveNowy() {
  const f = state.drzewoNowyForm;
  if (!f || !f.symbol || !f.nazwa) { alert('Symbol i nazwa są wymagane'); return; }
  try {
    await post('/api/wyroby', f);
    setState({drzewoNowyForm: null, drzewoPanel: 'drzewo'});
    loadDrzewoGP();
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function drzewoDeleteZlecenieP(zapId, zlecenieId, numer, selG) {
  if (!confirm(`Usunąć podzlecenie P: ${numer}?\n\nZostanie usunięte zlecenie P wraz z jego operacjami oraz powiązanie z zleceniem G.`)) return;
  try {
    // Usuń powiązanie zapotrzebowanie
    await del('/api/zapotrzebowania/' + zapId);
    // Usuń zlecenie P
    await del('/api/zlecenia/' + zlecenieId);
    alert(`✓ Podzlecenie ${numer} usunięte.`);
    // Odśwież
    await drzewoSelectG(selG);
  } catch(e) { alert('Błąd: ' + e.message); }
}


async function drzewoDeleteZlecenie(zid, numer) {
  if (!confirm(`Usunąć zlecenie ${numer}?\n\nZostaną usunięte wszystkie operacje i sesje pracy. Struktura BOM (wyrób G i powiązane P) pozostanie nienaruszona.`)) return;
  try {
    await del('/api/zlecenia/' + zid);
    // Odśwież zarówno zakładkę Drzewo jak i Zlecenia (synchronizacja między zakładkami)
    await loadZlecenia();
    const [g, p, zl] = await Promise.all([
      get('/api/wyroby?typ=G'),
      get('/api/wyroby?typ=P'),
      get('/api/zlecenia'),
    ]);
    const zlG = zl.filter(z => g.some(wg => wg.symbol === z.numer));
    setState({drzewoWyrobyG: g, drzewoWyrobyP: p, drzewoZleceniaG: zlG});
    alert(`✓ Zlecenie ${numer} usunięte.`);
  } catch(e) { alert('Błąd: ' + e.message); }
}

// ─── Usuwanie wyrobu (struktury) z listy po lewej stronie ─────────────────────
async function drzewoDeleteWyrob(wid, symbol, typ) {
  const ostrzezenie = typ === 'G'
    ? `Usunąć wyrób ${symbol}?\n\nZostanie usunięta cała struktura BOM tego wyrobu (powiązania ze składnikami). Powiązane zlecenia produkcyjne NIE zostaną usunięte – jeśli chcesz je usunąć, zrób to z poziomu zlecenia.`
    : `Usunąć półprodukt ${symbol}?\n\nZostanie usunięty wraz z jego strukturą BOM oraz powiązaniami jako składnik w innych wyrobach.`;
  if (!confirm(ostrzezenie)) return;
  try {
    await del('/api/wyroby/' + wid);
    if (state.drzewoSelectedG?.id === wid) {
      setState({drzewoSelectedG: null, drzewoTree: null, drzewoPanel: 'drzewo'});
    }
    await loadDrzewoGP();
    render();
  } catch(e) { alert('Błąd usuwania: ' + e.message); }
}

// ─── Helpers: rozwiń / zwiń całe drzewo ───────────────────────────────────────
function _collectNodeKeys(node, depth, acc) {
  if (!node) return;
  const key = node._bom_id ? ('b' + node._bom_id) : (node.id ? ('w' + node.id + 'd' + depth) : (node.symbol || node.material_indeks || '') + depth);
  acc[key] = true;
  if (node.children) node.children.forEach(c => _collectNodeKeys(c, depth + 1, acc));
}

function drzewoExpandAll() {
  const tree = state.drzewoTree;
  if (!tree) return;
  const exp = {};
  _collectNodeKeys(tree, 0, exp);
  setState({drzewoExpanded: exp}, true); render();
}

function drzewoCollapseAll() {
  const tree = state.drzewoTree;
  if (!tree) return;
  const exp = {};
  const key0 = tree._bom_id ? ('b' + tree._bom_id) : (tree.id ? ('w' + tree.id + 'd0') : (tree.symbol || '') + '0');
  exp[key0] = true; // zostaw tylko korzeń
  setState({drzewoExpanded: exp}, true); render();
}

// ─── Render węzła drzewa ───────────────────────────────────────────────────────
function renderDrzewoNode(node, depth, ilocZlecona, parentWyrobId) {
  if (!node) return '';
  const key = node._bom_id ? ('b' + node._bom_id) : (node.id ? ('w' + node.id + 'd' + depth) : (node.symbol || node.material_indeks || '') + depth);
  const isM = node.typ === 'M';
  const isG = node.typ === 'G';
  const hasChildren = node.children && node.children.length > 0;
  // Domyślnie rozwiń tylko głębokość 0 (korzeń G). depth>=1 collapsed dla wydajności z dużymi drzewami.
  const isOpen = depth < 1 ? (state.drzewoExpanded[key] !== false) : !!state.drzewoExpanded[key];

  const indent = depth * 22;
  const borderColor = isG ? '#3b82f6' : isM ? '#6b7280' : '#8b5cf6';
  const bgAlpha = Math.max(0.02, 0.12 - depth * 0.02);

  const zlecenie = node.zlecenia && node.zlecenia[0];
  const opDone  = zlecenie?.op_done || 0;
  const opTotal = zlecenie?.op_total || 0;
  const progPct = opTotal > 0 ? Math.round(opDone / opTotal * 100) : 0;
  const progColor = progPct === 100 ? '#4ade80' : '#3b82f6';

  const ilocBOM = node._bom_ilosc != null ? node._bom_ilosc : node.ilosc;
  const ilocEfekt = (ilocZlecona != null && ilocBOM != null) ? ilocBOM * ilocZlecona : ilocBOM;

  const statusDef = {
    nowe:{bg:'#1e3a5f',text:'#60a5fa',label:'Nowe'},
    w_toku:{bg:'#1a3a1a',text:'#4ade80',label:'W toku'},
    zakonczone:{bg:'#1a2a1a',text:'#86efac',label:'Zakończone'},
    oczekuje:{bg:'#2d2d1a',text:'#fbbf24',label:'Oczekuje'},
    wstrzymane:{bg:'#3a1a1a',text:'#f87171',label:'Wstrzymane'},
    oczekuje_potwierdzenia:{bg:'#1a1a3a',text:'#a78bfa',label:'Do potw.'},
    anulowane:{bg:'#2a2a2a',text:'#6b7280',label:'Anulowane'},
  };

  const badgeHtml = (status) => {
    const s = statusDef[status] || statusDef.nowe;
    return `<span style="background:${s.bg};color:${s.text};font-size:0.65rem;font-weight:700;padding:2px 7px;border-radius:4px;border:1px solid ${s.text}33;white-space:nowrap">${s.label}</span>`;
  };

  if (isM) {
    const ilocStr = ilocEfekt != null
      ? `<span style="color:#d1d5db;font-weight:600;margin-left:auto">${(+ilocEfekt).toLocaleString('pl-PL',{maximumFractionDigits:2})} ${node.material_jm || node.jednostka || ''}</span>`
      : '';
    const pozStr = node._bom_pozycja != null && node._bom_pozycja !== 0
      ? `<span style="color:#4b5563;font-size:.61rem;font-family:monospace;min-width:28px">P${String(node._bom_pozycja).padStart(2,'0')}</span>`
      : '<span style="min-width:28px"></span>';
    const opisStr = node.material_opis && node.material_opis !== node.material_indeks
      ? node.material_opis
      : (node._bom_uwagi || node.material_opis || '—');
    const delMBtn = (node._bom_id && parentWyrobId)
      ? `<button onclick="event.stopPropagation();drzewoDeleteBomNode(${node._bom_id},${parentWyrobId})"
           title="Usuń z drzewa" style="background:transparent;border:none;color:#6b7280;cursor:pointer;font-size:.78rem;padding:0 2px;line-height:1;flex-shrink:0" onmouseover="this.style.color='#f87171'" onmouseout="this.style.color='#6b7280'">✕</button>`
      : '';
    return `<div style="margin-left:${indent}px;margin-bottom:2px;background:rgba(107,114,128,0.06);border-left:2px solid #6b728040;border-radius:4px;padding:4px 10px;display:flex;align-items:center;gap:8px;font-size:0.73rem;color:#9ca3af">
      ${pozStr}
      <span style="opacity:.5;font-size:.62rem">▣</span>
      <span style="color:#6b7280;min-width:70px;font-family:monospace">${node.material_indeks||''}</span>
      <span style="flex:1;color:#9ca3af">${opisStr}</span>
      ${ilocStr}
      ${delMBtn}
    </div>`;
  }

  const ilocStr = ilocEfekt != null
    ? `<span style="font-size:.73rem;color:#94a3b8;white-space:nowrap">${(+ilocEfekt).toLocaleString('pl-PL',{maximumFractionDigits:2})} ${node.jednostka||'szt'}</span>`
    : '';
  const progHtml = opTotal > 0
    ? `<div style="display:flex;flex-direction:column;gap:2px;min-width:80px;align-items:flex-end">
        <span style="font-size:.62rem;color:#64748b">${opDone}/${opTotal} op. · ${progPct}%</span>
        <div style="background:#ffffff14;border-radius:2px;height:4px;width:100%;overflow:hidden">
          <div style="width:${progPct}%;height:100%;background:${progColor};border-radius:2px"></div>
        </div>
       </div>`
    : '';
  const noZlHtml = (!zlecenie && !isG)
    ? `<span style="font-size:.65rem;color:#f59e0b;border:1px solid #f59e0b44;border-radius:3px;padding:1px 6px;white-space:nowrap">Brak zlecenia</span>`
    : '';
  const chevron = hasChildren
    ? `<span style="width:16px;text-align:center;color:#94a3b8;font-size:.62rem;display:inline-block;transition:transform .2s;transform:${isOpen?'rotate(90deg)':'none'}"
         onclick="drzewoToggleNode('${key.replace(/'/g,"\\'")}');event.stopPropagation()">▶</span>`
    : '<span style="width:16px"></span>';
  const countBadge = hasChildren
    ? `<span style="font-size:.62rem;color:#475569;background:#ffffff10;border-radius:10px;padding:1px 6px;min-width:24px;text-align:center">${node.children.length}</span>`
    : '';

  const childrenHtml = (isOpen && hasChildren)
    ? `<div style="margin-top:2px">${node.children.map((c,i) => renderDrzewoNode(c, depth+1, ilocEfekt || ilocZlecona, node.id)).join('')}</div>`
    : '';

  return `<div style="margin-left:${indent}px;margin-bottom:4px">
    <div style="background:rgba(255,255,255,${bgAlpha});border-left:3px solid ${borderColor};border-radius:4px;padding:7px 12px;cursor:${hasChildren?'pointer':'default'};display:flex;align-items:center;gap:10px;user-select:none"
      onclick="if(${hasChildren})drzewoToggleNode('${key.replace(/'/g,"\\'")}')">
      ${chevron}
      <span style="font-family:monospace;font-weight:700;color:${isG?'#60a5fa':'#a78bfa'};font-size:.78rem;min-width:70px">${node.symbol||''}</span>
      <span style="flex:1;font-size:.81rem;color:#e2e8f0;line-height:1.3">${node.nazwa||''}</span>
      ${ilocStr}
      ${zlecenie ? badgeHtml(zlecenie.status) : ''}
      ${progHtml}
      ${noZlHtml}
      ${countBadge}
      ${(!isG && node._bom_id && parentWyrobId) ? `<button onclick="event.stopPropagation();drzewoDeleteBomNode(${node._bom_id},${parentWyrobId})" title="Usuń z drzewa" style="background:transparent;border:none;color:#475569;cursor:pointer;font-size:.8rem;padding:0 2px;flex-shrink:0" onmouseover="this.style.color='#f87171'" onmouseout="this.style.color='#475569'">✕</button>` : ''}
      ${!isM ? (() => {
        const stepUrl = node.model_3d_url || zlecenie?.model_3d_url || '';
        const previewBtn = stepUrl
          ? `<button onclick="event.stopPropagation();drzewoOpenStepNode(this)" data-url="${stepUrl.replace(/"/g,'&quot;')}" title="Podgląd STEP" style="background:rgba(59,130,246,0.15);border:1px solid #3b82f640;color:#60a5fa;border-radius:4px;padding:2px 7px;font-size:.67rem;cursor:pointer;white-space:nowrap;flex-shrink:0">🧊</button>`
          : '';
        const uploadBtn = `<button onclick="event.stopPropagation();uploadStepForWyrob(${node.id})" title="${stepUrl ? 'Zmień plik STEP' : 'Wgraj plik STEP'}" style="background:rgba(139,92,246,0.12);border:1px solid #8b5cf640;color:#a78bfa;border-radius:4px;padding:2px 7px;font-size:.67rem;cursor:pointer;white-space:nowrap;flex-shrink:0">${stepUrl ? '📎' : '📎 STEP'}</button>`;
        return previewBtn + uploadBtn;
      })() : ''}
    </div>
    ${childrenHtml}
  </div>`;
}

// ─── Render główny Drzewa G/P ─────────────────────────────────────────────────
function renderDrzewoGP() {
  const {
    drzewoWyrobyG: wyrobyG, drzewoWyrobyP: wyrobyP, drzewoLoading: loading,
    drzewoSelectedG: selG, drzewoTree: tree, drzewoTreeLoading: treeLoading,
    drzewoPanel: panel, drzewoSearch: search, drzewoZleceniaG: zleceniaG,
    drzewoMrp: mrp, drzewoMrpLoading: mrpLoading, drzewoMrpView: mrpView,
    drzewoImportResult: importResult, drzewoImportError: importError, drzewoImportUploading: uploading,
    drzewoNowyForm: nowyForm,
  } = state;

  const filteredG = wyrobyG.filter(w =>
    !search ||
    w.symbol.toLowerCase().includes(search.toLowerCase()) ||
    w.nazwa.toLowerCase().includes(search.toLowerCase())
  );

  const zlecenieG = selG ? (zleceniaG.find(z => z.numer === selG.symbol) || null) : null;

  // ── Lewa kolumna ──
  const listaHtml = loading
    ? '<div style="display:flex;justify-content:center;padding:40px"><div class="spinner" style="border:2px solid #fff2;border-top:2px solid #3b82f6;border-radius:50%;width:24px;height:24px;animation:spin .8s linear infinite"></div></div>'
    : filteredG.length === 0
      ? '<div style="color:#475569;text-align:center;padding:24px;font-size:.78rem">Brak wyrobów G.<br>Zaimportuj drzewo z PDF<br>lub utwórz ręcznie.</div>'
      : filteredG.map(wg => {
          const isActive = selG?.id === wg.id;
          const zl = zleceniaG.find(z => z.numer === wg.symbol);
          const statusDot = zl
            ? `<span style="width:7px;height:7px;border-radius:50%;background:${{nowe:'#60a5fa',w_toku:'#4ade80',zakonczone:'#86efac',wstrzymane:'#f87171',anulowane:'#6b7280'}[zl.status]||'#60a5fa'};display:inline-block;flex-shrink:0"></span>`
            : '';
          return `<div onclick="drzewoSelectG(${JSON.stringify(wg).replace(/"/g,'&quot;')})"
            style="padding:9px 12px;border-radius:6px;cursor:pointer;margin-bottom:3px;position:relative;
              background:${isActive?'#1e3a5f':'transparent'};
              border:1px solid ${isActive?'#3b82f640':'transparent'};transition:all .15s"
            onmouseenter="if(!${isActive})this.style.background='#ffffff08'"
            onmouseleave="if(!${isActive})this.style.background='transparent'">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
              ${statusDot}
              <span style="color:#60a5fa;font-weight:700;font-size:.77rem;font-family:monospace">${wg.symbol}</span>
              <div style="flex:1"></div>
              <button onclick="event.stopPropagation();drzewoDeleteWyrob(${wg.id},'${(wg.symbol||'').replace(/'/g,"\\'")}','${wg.typ||'G'}')"
                title="Usuń wyrób / strukturę" style="background:transparent;border:none;color:#475569;cursor:pointer;font-size:.8rem;padding:0 2px;flex-shrink:0;line-height:1"
                onmouseover="this.style.color='#f87171'" onmouseout="this.style.color='#475569'">✕</button>
            </div>
            <div style="color:#94a3b8;font-size:.71rem;line-height:1.3">${(wg.nazwa||'').slice(0,52)}${(wg.nazwa||'').length>52?'…':''}</div>
          </div>`;
        }).join('');

  // ── Panel prawy ──
  let rightHtml = '';

  if (!selG && panel !== 'import' && panel !== 'nowy') {
    rightHtml = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:70vh;gap:12px;color:#334155">
      <div style="font-size:3rem;opacity:.25">⬡</div>
      <div style="font-size:.84rem">Wybierz wyrób G z listy po lewej</div>
      <div style="font-size:.74rem;color:#1e3a5f">lub zaimportuj / utwórz nowy</div>
    </div>`;
  }

  // Panel: Nowy wyrób ──
  if (panel === 'nowy') {
    const f = nowyForm || {symbol:'',nazwa:'',typ:'G',jednostka:'szt',numer_rysunku:''};
    rightHtml = `<div style="max-width:480px">
      <div style="font-size:.9rem;font-weight:700;color:#60a5fa;margin-bottom:16px">Nowy wyrób</div>
      ${[
        ['Symbol','symbol','text','np. G.100.001'],
        ['Nazwa','nazwa','text','Pełna nazwa wyrobu'],
        ['Jedn.','jednostka','text','szt'],
        ['Nr rysunku','numer_rysunku','text','opcjonalnie'],
      ].map(([lbl,fld,type,ph]) => `
        <div style="margin-bottom:12px">
          <label style="color:#64748b;font-size:.75rem;display:block;margin-bottom:4px">${lbl}</label>
          <input type="${type}" value="${(f[fld]||'').replace(/"/g,'&quot;')}" placeholder="${ph}"
            oninput="setState({drzewoNowyForm:{...state.drzewoNowyForm||{symbol:'',nazwa:'',typ:'G',jednostka:'szt',numer_rysunku:''},'${fld}':this.value}},true)"
            style="background:#ffffff0a;border:1px solid #ffffff20;border-radius:6px;padding:7px 10px;color:#e2e8f0;font-size:.8rem;width:100%;outline:none">
        </div>`).join('')}
      <div style="margin-bottom:16px">
        <label style="color:#64748b;font-size:.75rem;display:block;margin-bottom:4px">Typ</label>
        <div style="display:flex;gap:8px">
          ${['G','P'].map(t => `<button onclick="setState({drzewoNowyForm:{...state.drzewoNowyForm||{symbol:'',nazwa:'',typ:'G',jednostka:'szt',numer_rysunku:''},typ:'${t}'}},true);render()"
            style="flex:1;padding:7px;border:1px solid ${(f.typ||'G')===t?'#3b82f6':'#ffffff20'};border-radius:6px;background:${(f.typ||'G')===t?'#1e3a5f':'transparent'};color:${(f.typ||'G')===t?'#60a5fa':'#64748b'};cursor:pointer;font-weight:700;font-family:monospace">${t} – ${t==='G'?'Wyrób gotowy':'Półprodukt'}</button>`).join('')}
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="drzewoSaveNowy()" style="background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:8px 20px;cursor:pointer;font-weight:600;font-size:.8rem">Zapisz</button>
        <button onclick="setState({drzewoPanel:'drzewo',drzewoNowyForm:null})" style="background:#ffffff10;color:#94a3b8;border:none;border-radius:6px;padding:8px 20px;cursor:pointer;font-size:.8rem">Anuluj</button>
      </div>
    </div>`;
  }

  // Panel: Import PDF (globalny) ──
  if (!selG && panel === 'import') {
    rightHtml = renderDrzewoImportPanel();
  }

  // Panel: wybrany G ──
  if (selG) {
    const tabsHtml = ['drzewo','mrp','import'].map(t => {
      const labels = {drzewo:'🌲 Drzewo BOM', mrp:'📊 MRP / Materiały', import:'📄 Import PDF'};
      const clickAction = t === 'mrp' && zlecenieG
        ? `setState({drzewoPanel:'mrp',drzewoMrp:null,drzewoMrpView:'zbiorczy',drzewoMrpLoading:true},true);render();drzewoLoadMrp(${zlecenieG.id});`
        : `setState({drzewoPanel:'${t}'})`;
      return `<button onclick="${clickAction}"
        style="background:${panel===t?'#3b82f6':'transparent'};color:${panel===t?'#fff':'#64748b'};border:none;border-radius:6px;padding:6px 14px;font-size:.76rem;cursor:pointer;font-weight:600;transition:all .15s">${labels[t]}</button>`;
    }).join('');

    const ilocSztuk = zlecenieG?.ilosc_sztuk || 1;
    const headerRight = zlecenieG
      ? `<div style="margin-left:auto;background:#ffffff08;border-radius:8px;padding:8px 16px;display:flex;gap:20px">
          <div style="text-align:center">
            <div style="color:#60a5fa;font-weight:700;font-size:1.1rem">${zlecenieG.ilosc_sztuk}</div>
            <div style="color:#64748b;font-size:.67rem">sztuk</div>
          </div>
          ${zlecenieG.termin ? `<div style="text-align:center">
            <div style="color:#f59e0b;font-weight:700;font-size:.84rem">${zlecenieG.termin}</div>
            <div style="color:#64748b;font-size:.67rem">termin</div>
          </div>` : ''}
        </div>`
      : '';

    const statusDef = {nowe:{bg:'#1e3a5f',text:'#60a5fa',label:'Nowe'},w_toku:{bg:'#1a3a1a',text:'#4ade80',label:'W toku'},zakonczone:{bg:'#1a2a1a',text:'#86efac',label:'Zakończone'},wstrzymane:{bg:'#3a1a1a',text:'#f87171',label:'Wstrzymane'},anulowane:{bg:'#2a2a2a',text:'#6b7280',label:'Anulowane'}};
    const s = zlecenieG && (statusDef[zlecenieG.status]||statusDef.nowe);
    const statusBadge = s ? `<span style="background:${s.bg};color:${s.text};font-size:.65rem;font-weight:700;padding:2px 7px;border-radius:4px;border:1px solid ${s.text}33">${s.label}</span>` : '';

    let panelContent = '';

    if (panel === 'drzewo') {
      if (treeLoading) {
        panelContent = '<div style="display:flex;align-items:center;gap:12px;color:#475569;padding:24px"><div class="spinner" style="border:2px solid #fff2;border-top:2px solid #3b82f6;border-radius:50%;width:20px;height:20px;animation:spin .8s linear infinite"></div><span style="font-size:.79rem">Ładowanie drzewa…</span></div>';
      } else if (tree) {
        const nodeCount = (function cnt(n){return 1 + (n.children||[]).reduce((s,c)=>s+cnt(c),0);})(tree);
        const treeToolbar = `<div style="display:flex;gap:6px;margin-bottom:10px;align-items:center">
          <span style="color:#475569;font-size:.72rem">${nodeCount} węzłów</span>
          <div style="flex:1"></div>
          <button onclick="drzewoExpandAll()" style="background:#ffffff0a;color:#94a3b8;border:1px solid #ffffff15;border-radius:5px;padding:3px 10px;font-size:.71rem;cursor:pointer">⊕ Rozwiń wszystko</button>
          <button onclick="drzewoCollapseAll()" style="background:#ffffff0a;color:#94a3b8;border:1px solid #ffffff15;border-radius:5px;padding:3px 10px;font-size:.71rem;cursor:pointer">⊖ Zwiń wszystko</button>
        </div>`;
        panelContent = treeToolbar + renderDrzewoNode(tree, 0, ilocSztuk);
      } else {
        panelContent = '<div style="color:#475569;padding:24px;font-size:.79rem">Brak struktury BOM. Zaimportuj drzewo z PDF lub uzupełnij ręcznie.</div>';
      }
      // Dodaj sekcję zleceń P
      const zlP = state.drzewoZleceniaP || [];
      const zlPloading = state.drzewoZleceniaPLoading;
      const statusDefP = {nowe:{bg:'#1e3a5f',text:'#60a5fa',label:'Nowe'},w_toku:{bg:'#1a3a1a',text:'#4ade80',label:'W toku'},zakonczone:{bg:'#1a2a1a',text:'#86efac',label:'Zakończone'},wstrzymane:{bg:'#3a1a1a',text:'#f87171',label:'Wstrzymane'},anulowane:{bg:'#2a2a2a',text:'#6b7280',label:'Anulowane'}};
      const zlPSection = `<div style="margin-top:18px;border-top:1px solid #ffffff12;padding-top:14px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="color:#a78bfa;font-weight:700;font-size:.74rem;letter-spacing:.07em;text-transform:uppercase">◆ Zlecenia P w tym zleceniu</span>
          ${zlPloading ? '<div class="spinner" style="border:2px solid #fff2;border-top:2px solid #a78bfa;border-radius:50%;width:14px;height:14px;animation:spin .8s linear infinite"></div>' : `<span style="color:#475569;font-size:.7rem">(${zlP.length})</span>`}
        </div>
        ${!zlPloading && zlP.length === 0 ? '<div style="color:#334155;font-size:.73rem;padding:8px 0">Brak podzleceń P powiązanych z tym zleceniem G.</div>' : ''}
        ${zlP.map(zp => {
          const s = statusDefP[zp.status] || statusDefP.nowe;
          const selGObj = state.drzewoSelectedG;
          return `<div style="display:flex;align-items:center;gap:8px;background:#ffffff06;border:1px solid #a78bfa22;border-radius:6px;padding:7px 12px;margin-bottom:5px">
            <span style="color:#a78bfa;font-family:monospace;font-weight:700;font-size:.78rem;min-width:80px">${zp.numer}</span>
            <span style="flex:1;color:#e2e8f0;font-size:.77rem">${zp.nazwa||''}</span>
            <span style="color:#94a3b8;font-size:.71rem">${zp.ilosc_sztuk||1} szt.</span>
            <span style="background:${s.bg};color:${s.text};font-size:.63rem;font-weight:700;padding:2px 7px;border-radius:4px;border:1px solid ${s.text}33">${s.label}</span>
            <button onclick="drzewoDeleteZlecenieP(${zp._zap_id},${zp.id},'${(zp.numer||'').replace(/'/g,"\\'")}',${JSON.stringify(selGObj).replace(/"/g,'&quot;')})"
              title="Usuń podzlecenie P"
              style="background:transparent;border:none;color:#475569;cursor:pointer;font-size:.8rem;padding:0 2px;flex-shrink:0"
              onmouseover="this.style.color='#f87171'" onmouseout="this.style.color='#475569'">🗑</button>
          </div>`;
        }).join('')}
      </div>`;
      panelContent += zlPSection;
    }

    if (panel === 'mrp') {
      if (!zlecenieG) {
        const zlP = state.drzewoZleceniaP || [];
        panelContent = `<div style="color:#475569;padding:24px;font-size:.79rem">Brak aktywnego zlecenia G dla wyrobu <strong style="color:#60a5fa">${selG.symbol}</strong>.<br>Utwórz zlecenie o tym numerze w zakładce Zlecenia.
        ${zlP.length > 0 ? `<div style="margin-top:12px;color:#94a3b8;font-size:.75rem">Znaleziono ${zlP.length} podzleceń P – MRP wymaga zlecenia G.</div>` : ''}
        </div>`;
      } else if (mrpLoading) {
        panelContent = '<div style="display:flex;align-items:center;gap:12px;color:#475569;padding:40px;justify-content:center"><div class="spinner" style="border:2px solid #fff2;border-top:2px solid #3b82f6;border-radius:50%;width:28px;height:28px;animation:spin .8s linear infinite"></div><span style="font-size:.79rem">Obliczanie MRP…</span></div>';
      } else if (mrp) {
        const refreshBtn = `<button onclick="drzewoLoadMrp(${zlecenieG.id})" title="Odśwież" style="background:transparent;border:1px solid #ffffff15;border-radius:5px;padding:3px 8px;color:#64748b;font-size:.71rem;cursor:pointer;margin-left:auto">↻ Odśwież</button>`;
        panelContent = `<div style="display:flex;justify-content:flex-end;margin-bottom:6px">${refreshBtn}</div>` + renderDrzewoMrp(mrp);
      } else {
        // Auto-start ładowania od razu zamiast pokazywać przycisk
        const _autoGid = zlecenieG.id;
        setTimeout(() => { if (state.drzewoPanel==='mrp' && !state.drzewoMrp && !state.drzewoMrpLoading) drzewoLoadMrp(_autoGid); }, 0);
        panelContent = '<div style="display:flex;align-items:center;gap:12px;color:#475569;padding:40px;justify-content:center"><div class="spinner" style="border:2px solid #fff2;border-top:2px solid #3b82f6;border-radius:50%;width:28px;height:28px;animation:spin .8s linear infinite"></div><span style="font-size:.79rem">Ładowanie MRP…</span></div>';
      }
    }

    if (panel === 'import') {
      panelContent = `<div style="max-width:540px">
        <div style="color:#64748b;font-size:.77rem;margin-bottom:12px">Import zaktualizuje strukturę BOM wyrobu <strong style="color:#60a5fa">${selG.symbol}</strong></div>
        ${renderDrzewoImportPanel()}
      </div>`;
    }

    const deleteZlecenieBtn = zlecenieG
      ? `<button onclick="drzewoDeleteZlecenie(${zlecenieG.id},'${(zlecenieG.numer||'').replace(/'/g,"\'")}')"
           title="Usuń zlecenie"
           style="margin-left:auto;background:#3a1a1a;color:#f87171;border:1px solid #f8717133;border-radius:6px;padding:5px 12px;font-size:.72rem;cursor:pointer;font-weight:600;white-space:nowrap">
           🗑 Usuń zlecenie
         </button>`
      : '';

    rightHtml = `<div>
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:16px;flex-wrap:wrap">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="color:#60a5fa;font-weight:700;font-size:1.1rem;font-family:monospace">${selG.symbol}</span>
            ${statusBadge}
          </div>
          <div style="color:#94a3b8;font-size:.81rem;margin-top:4px">${selG.nazwa}</div>
          ${selG.numer_rysunku ? `<div style="color:#475569;font-size:.71rem;margin-top:2px">Rys. ${selG.numer_rysunku}</div>` : ''}
        </div>
        ${headerRight}
        ${deleteZlecenieBtn}
      </div>
      <div style="display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid #ffffff10;padding-bottom:8px">
        ${tabsHtml}
      </div>
      ${panelContent}
    </div>`;
  }

  return `
  <style>
    @keyframes spin{to{transform:rotate(360deg)}}
    .drzewo-left-item:hover{background:#ffffff08 !important}
  </style>
  <div style="display:flex;align-items:center;gap:16px;padding:10px 20px;border-bottom:1px solid #ffffff10;background:#ffffff04;flex-wrap:wrap">
    <div style="font-size:1rem;font-weight:700;color:#60a5fa;letter-spacing:.05em;font-family:monospace">STRUKTURA G/P</div>
    <div style="color:#334155;font-size:.73rem">${wyrobyG.length} wyrobów G · ${wyrobyP.length} półproduktów P</div>
    <div style="flex:1;min-width:120px"></div>
    <input value="${search.replace(/"/g,'&quot;')}" oninput="setState({drzewoSearch:this.value},true);render()"
      placeholder="Szukaj G/P…"
      style="background:#ffffff0a;border:1px solid #ffffff15;border-radius:6px;padding:5px 12px;color:#e2e8f0;font-size:.77rem;width:180px;outline:none">
    <button onclick="setState({drzewoSelectedG:null,drzewoPanel:'nowy',drzewoNowyForm:{symbol:'',nazwa:'',typ:'G',jednostka:'szt',numer_rysunku:''}})"
      style="background:#1a3a1a;color:#4ade80;border:1px solid #4ade8040;border-radius:6px;padding:5px 14px;font-size:.75rem;cursor:pointer;font-weight:600">
      + Nowy wyrób
    </button>
    <button onclick="setState({drzewoSelectedG:null,drzewoPanel:'import'})"
      style="background:#1e3a5f;color:#60a5fa;border:1px solid #3b82f660;border-radius:6px;padding:5px 14px;font-size:.75rem;cursor:pointer;font-weight:600">
      + Import PDF
    </button>
  </div>

  <div style="display:flex;height:calc(100vh - 110px)">
    <div style="width:250px;border-right:1px solid #ffffff10;overflow-y:auto;padding:10px 8px;background:#ffffff03;flex-shrink:0">
      ${listaHtml}
    </div>
    <div style="flex:1;overflow-y:auto;padding:22px 28px;font-family:'IBM Plex Mono',monospace">
      ${rightHtml}
    </div>
  </div>`;
}

// ─── MRP card ──────────────────────────────────────────────────────────────────
function renderDrzewoMrp(data) {
  const { summary, materialy_zbiorczy, zapotrzebowania_p, czasy_stanowisk } = data;
  const MRP_COLOR = { ok: '#4ade80', czesciowo: '#fbbf24', brak: '#f87171' };
  const mrpView = state.drzewoMrpView;

  const listaZakupow = (materialy_zbiorczy || []).filter(m => (m.braki || 0) > 0);

  const statsHtml = [
    {label:'Materiałów', val:summary.material_count, color:'#94a3b8'},
    {label:'OK',          val:summary.ok_count,       color:MRP_COLOR.ok},
    {label:'Częściowo',   val:summary.czesciowo_count, color:MRP_COLOR.czesciowo},
    {label:'Brak',        val:summary.brak_count,      color:MRP_COLOR.brak},
    {label:'Do zakupu',   val:listaZakupow.length,     color:'#f97316'},
  ].map(s => `<div style="background:#ffffff08;border:1px solid ${s.color}33;border-radius:8px;padding:10px 18px;text-align:center">
    <div style="color:${s.color};font-size:1.5rem;font-weight:700">${s.val}</div>
    <div style="color:#64748b;font-size:.71rem;margin-top:2px">${s.label}</div>
  </div>`).join('');

  const tabsHtml = [
    {id:'zbiorczy',      label:'Materiały (zbiorczy)'},
    {id:'lista-zakupow', label:`🛒 Lista zakupów (${listaZakupow.length})`},
    {id:'p-status',      label:`Półprodukty P (${(zapotrzebowania_p||[]).length})`},
    {id:'czasy',         label:'⏱ Czasy operacji'},
  ].map(t => `<button onclick="setState({drzewoMrpView:'${t.id}'},true);render()"
    style="background:${mrpView===t.id?'#3b82f6':'#ffffff10'};color:${mrpView===t.id?'#fff':'#94a3b8'};border:none;border-radius:6px;padding:5px 13px;font-size:.74rem;cursor:pointer;font-weight:600">${t.label}</button>`).join('');

  let listHtml = '';

  if (mrpView === 'zbiorczy') {
    if (!materialy_zbiorczy || materialy_zbiorczy.length === 0) {
      listHtml = '<div style="color:#475569;text-align:center;padding:24px;font-size:.79rem">Brak zdefiniowanego BOM. Zaimportuj drzewo lub uzupełnij ręcznie.</div>';
    } else {
      const rows = materialy_zbiorczy.map((m, i) => {
        const braki = m.braki || 0;
        const brakHtml = braki > 0
          ? `<span style="color:${MRP_COLOR.brak};font-weight:700">-${(+braki).toLocaleString('pl-PL',{maximumFractionDigits:2})}</span>`
          : `<span style="color:${MRP_COLOR.ok}">OK</span>`;
        return `<tr style="border-bottom:1px solid #ffffff08;background:${i%2===0?'transparent':'#ffffff04'}">
          <td style="padding:5px 10px;color:#64748b;font-family:monospace;font-size:.71rem">${m.material_indeks||''}</td>
          <td style="padding:5px 10px;color:#cbd5e1;font-size:.76rem">${m.material_opis||''}</td>
          <td style="padding:5px 10px;color:#e2e8f0;text-align:right;font-size:.76rem">${(+m.ilosc_wymagana).toLocaleString('pl-PL',{maximumFractionDigits:2})} ${m.material_jm||''}</td>
          <td style="padding:5px 10px;color:#94a3b8;text-align:right;font-size:.76rem">${(+(m.material_stan||0)).toLocaleString('pl-PL',{maximumFractionDigits:2})}</td>
          <td style="padding:5px 10px;text-align:right;font-size:.76rem">${brakHtml}</td>
          <td style="padding:5px 10px"><div style="width:8px;height:8px;border-radius:50%;background:${MRP_COLOR[m.status_dostepnosci]||'#94a3b8'};display:inline-block"></div></td>
        </tr>`;
      }).join('');
      listHtml = `<div style="max-height:400px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.75rem">
          <thead><tr style="border-bottom:1px solid #ffffff15">
            ${['Indeks','Opis','Wymagane','Dostępne','Brak',''].map(h=>`<th style="padding:6px 10px;color:#64748b;text-align:left;font-weight:600;white-space:nowrap">${h}</th>`).join('')}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    }
  }

  if (mrpView === 'lista-zakupow') {
    if (listaZakupow.length === 0) {
      listHtml = `<div style="color:#4ade80;text-align:center;padding:32px;font-size:.86rem">✓ Wszystkie materiały dostępne na stanie – brak pozycji do zamówienia.</div>`;
    } else {
      const rows = listaZakupow.map((m, i) => {
        const statusColor = m.material_stan > 0 ? MRP_COLOR.czesciowo : MRP_COLOR.brak;
        const statusLabel = m.material_stan > 0 ? 'Częściowo' : 'Brak';
        return `<tr style="border-bottom:1px solid #ffffff08;background:${i%2===0?'transparent':'#ffffff04'}">
          <td style="padding:6px 10px;color:#64748b;font-family:monospace;font-size:.71rem">${m.material_indeks||''}</td>
          <td style="padding:6px 10px;color:#e2e8f0;font-size:.76rem">${m.material_opis||''}</td>
          <td style="padding:6px 10px;color:#e2e8f0;text-align:right;font-size:.76rem;font-weight:700">${(+m.ilosc_wymagana).toLocaleString('pl-PL',{maximumFractionDigits:3})} ${m.material_jm||''}</td>
          <td style="padding:6px 10px;color:#94a3b8;text-align:right;font-size:.76rem">${(+(m.material_stan||0)).toLocaleString('pl-PL',{maximumFractionDigits:3})}</td>
          <td style="padding:6px 10px;color:${MRP_COLOR.brak};text-align:right;font-size:.76rem;font-weight:700">${(+m.braki).toLocaleString('pl-PL',{maximumFractionDigits:3})} ${m.material_jm||''}</td>
          <td style="padding:6px 10px"><span style="background:${statusColor}22;color:${statusColor};font-size:.63rem;padding:2px 6px;border-radius:4px">${statusLabel}</span></td>
        </tr>`;
      }).join('');

      // Export do schowka jako TSV
      const exportTsv = () => {
        const header = 'Indeks\tOpis\tWymagane\tJM\tNa stanie\tBrakuje\n';
        const body = listaZakupow.map(m =>
          `${m.material_indeks||''}\t${m.material_opis||''}\t${(+m.ilosc_wymagana).toFixed(3)}\t${m.material_jm||''}\t${(+(m.material_stan||0)).toFixed(3)}\t${(+m.braki).toFixed(3)}`
        ).join('\n');
        navigator.clipboard.writeText(header + body).then(() => {
          alert(`Skopiowano ${listaZakupow.length} pozycji do schowka (format TSV – wklej do Excela)`);
        });
      };
      window._mrpExportTsv = exportTsv;

      // Rezerwacja materiałów
      const _gidForReserve = (state.drzewoZleceniaG||[]).find(z => z.numer === (state.drzewoSelectedG||{}).symbol);
      window._mrpRezerwuj = async function() {
        if (!_gidForReserve) { alert('Brak zlecenia G'); return; }
        const pozycje = (data.materialy_zbiorczy || [])
          .filter(m => (m.ilosc_wymagana||0) > 0)
          .map(m => ({material_indeks: m.material_indeks, ilosc_do_rezerwacji: m.ilosc_wymagana}));
        if (!pozycje.length) { alert('Brak materiałów'); return; }
        if (!confirm(`Zarezerwować dostępne stany dla ${pozycje.length} materiałów?\nTo zmniejszy "do dyspozycji" na magazynie.`)) return;
        try {
          const res = await post('/api/zlecenia/' + _gidForReserve.id + '/mrp/rezerwuj', {pozycje, tryb:'dostepne'});
          alert('✓ Zarezerwowano: ' + res.zarezerwowane + ' poz.\nPominięto: ' + res.pominięte);
          drzewoLoadMrp(_gidForReserve.id);
        } catch(e) { alert('Błąd: ' + e.message); }
      };

      listHtml = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
          <span style="color:#f97316;font-weight:700;font-size:.82rem">⚠ ${listaZakupow.length} pozycji do zamówienia</span>
          <div style="flex:1"></div>
          <button onclick="window._mrpExportTsv()"
            style="background:#1a3a1a;color:#4ade80;border:1px solid #4ade8040;border-radius:6px;padding:5px 12px;font-size:.73rem;cursor:pointer">📋 Kopiuj TSV</button>
          ${_gidForReserve ? `<button onclick="window._mrpRezerwuj()"
            style="background:#1a2a4a;color:#60a5fa;border:1px solid #3b82f640;border-radius:6px;padding:5px 12px;font-size:.73rem;cursor:pointer"
            title="Blokuje dostępne stany magazynowe pod to zlecenie">🔒 Zarezerwuj dostępne stany</button>` : ''}
        </div>
        <div style="max-height:420px;overflow-y:auto">
          <table style="width:100%;border-collapse:collapse;font-size:.75rem">
            <thead><tr style="border-bottom:1px solid #ffffff15">
              ${['Indeks','Opis','Wymagane','Dostępne','Brakuje','Status'].map(h=>`<th style="padding:6px 10px;color:#64748b;text-align:left;font-weight:600;white-space:nowrap">${h}</th>`).join('')}
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }
  }

  if (mrpView === 'p-status') {
    const zps = zapotrzebowania_p || [];
    if (zps.length === 0) {
      listHtml = '<div style="color:#475569;text-align:center;padding:24px;font-size:.79rem">Brak zapotrzebowań P.</div>';
    } else {
      const statusDef = {nowe:{bg:'#1e3a5f',text:'#60a5fa',label:'Nowe'},w_toku:{bg:'#1a3a1a',text:'#4ade80',label:'W toku'},zakonczone:{bg:'#1a2a1a',text:'#86efac',label:'Zakończone'},wstrzymane:{bg:'#3a1a1a',text:'#f87171',label:'Wstrzymane'},anulowane:{bg:'#2a2a2a',text:'#6b7280',label:'Anulowane'}};
      listHtml = `<div style="display:flex;flex-direction:column;gap:6px">` + zps.map(z => {
        const s = statusDef[z.p_status] || null;
        const badge = z.p_numer && s
          ? `<span style="background:${s.bg};color:${s.text};font-size:.64rem;font-weight:700;padding:2px 7px;border-radius:4px">${s.label}</span>`
          : `<span style="font-size:.65rem;color:#f59e0b;border:1px solid #f59e0b44;border-radius:3px;padding:1px 6px">Brak zlecenia P</span>`;
        return `<div style="background:#ffffff06;border:1px solid #ffffff10;border-radius:6px;padding:8px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="color:#a78bfa;font-family:monospace;font-weight:700;min-width:80px;font-size:.8rem">${z.wyrob_p_symbol||''}</span>
          <span style="color:#e2e8f0;flex:1;font-size:.79rem">${z.wyrob_nazwa||'—'}</span>
          <span style="color:#94a3b8;font-size:.74rem">${z.ilosc_wymagana||0} szt.</span>
          ${badge}
        </div>`;
      }).join('') + '</div>';
    }
  }

  if (mrpView === 'czasy') {
    const czasy = czasy_stanowisk || [];
    if (czasy.length === 0) {
      listHtml = `<div style="color:#475569;text-align:center;padding:32px;font-size:.79rem">
        Brak danych o operacjach.<br>
        <span style="font-size:.72rem">Upewnij się że zlecenia P mają zdefiniowane operacje ze stanowiskami i czasami normy.</span>
      </div>`;
    } else {
      const totalMin = czasy.reduce((s, c) => s + (c.czas_razem_min || 0), 0);
      const totalH = (totalMin / 60).toFixed(1);
      const maxMin = Math.max(...czasy.map(c => c.czas_razem_min || 0), 1);

      const rows = czasy.map((c, i) => {
        const pct = Math.round((c.czas_razem_min / maxMin) * 100);
        const hNorma = ((c.czas_norma_min || 0) / 60).toFixed(2);
        const hZbroj = ((c.zbrojenie_min || 0) / 60).toFixed(2);
        const hRazem = ((c.czas_razem_min || 0) / 60).toFixed(2);
        return `<div style="background:#ffffff06;border:1px solid #ffffff10;border-radius:6px;padding:10px 14px;margin-bottom:6px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
            <span style="color:#60a5fa;font-weight:700;font-size:.82rem;min-width:120px">${c.stanowisko}</span>
            <span style="color:#e2e8f0;font-size:.78rem;font-weight:600">${hRazem} h razem</span>
            <span style="color:#64748b;font-size:.72rem">(norma: ${hNorma} h + zbrojenie: ${hZbroj} h)</span>
          </div>
          <div style="background:#ffffff0a;border-radius:3px;height:6px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:#3b82f6;border-radius:3px;transition:width .3s"></div>
          </div>
        </div>`;
      }).join('');

      listHtml = `
        <div style="display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap">
          <div style="background:#ffffff08;border:1px solid #3b82f633;border-radius:8px;padding:10px 18px;text-align:center">
            <div style="color:#60a5fa;font-size:1.4rem;font-weight:700">${totalH} h</div>
            <div style="color:#64748b;font-size:.71rem;margin-top:2px">Łączny czas</div>
          </div>
          <div style="background:#ffffff08;border:1px solid #8b5cf633;border-radius:8px;padding:10px 18px;text-align:center">
            <div style="color:#a78bfa;font-size:1.4rem;font-weight:700">${czasy.length}</div>
            <div style="color:#64748b;font-size:.71rem;margin-top:2px">Stanowisk</div>
          </div>
        </div>
        <div>${rows}</div>`;
    }
  }

  return `<div>
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">${statsHtml}</div>
    <div style="display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap">${tabsHtml}</div>
    ${listHtml}
  </div>`;
}

// ─── Usuwanie węzłów z drzewa BOM ─────────────────────────────────────────────
async function drzewoDeleteBomNode(bomId, parentWyrobId) {
  if (!confirm('Usunąć ten węzeł z drzewa BOM? Operacja jest nieodwracalna.')) return;
  try {
    await del(`/api/wyroby/${parentWyrobId}/bom/${bomId}`);
    // Odśwież drzewo
    if (state.drzewoSelectedG) {
      setState({drzewoTree: null, drzewoTreeLoading: true}, true); render();
      const tree = await get('/api/wyroby/' + state.drzewoSelectedG.id + '/drzewo');
      setState({drzewoTree: tree, drzewoTreeLoading: false});
    }
  } catch(e) { alert('Błąd usuwania: ' + e.message); }
}

// ─── Import PDF panel ──────────────────────────────────────────────────────────
function renderDrzewoImportPanel() {
  const { drzewoImportUploading: uploading, drzewoImportResult: result, drzewoImportError: error } = state;

  const dropHtml = uploading
    ? `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:32px">
        <div class="spinner" style="border:2px solid #fff2;border-top:2px solid #3b82f6;border-radius:50%;width:28px;height:28px;animation:spin .8s linear infinite"></div>
        <span style="color:#64748b;font-size:.79rem">Parsowanie PDF…</span>
       </div>`
    : `<div style="font-size:1.7rem;margin-bottom:8px">📄</div>
       <div style="color:#94a3b8;font-size:.81rem;line-height:1.6">
         Przeciągnij PDF drzewa technologicznego z Graffiti ERP<br>lub kliknij, by wybrać plik
       </div>`;

  const resultHtml = result
    ? `<div style="background:#1a3a1a;border:1px solid #4ade8044;border-radius:6px;padding:12px;margin-top:10px;font-size:.77rem;color:#86efac">
        ✓ Import zakończony: <strong>${result.symbol_glowny}</strong> · ${result.wyroby_created} nowych wyrobów · ${result.bom_created} pozycji BOM · ${result.items_parsed} pozycji w PDF
        ${result.errors?.length ? `<div style="color:#fbbf24;margin-top:6px">Ostrzeżenia: ${result.errors.slice(0,3).join(', ')}</div>` : ''}
       </div>` : '';

  const errorHtml = error
    ? `<div style="color:#f87171;font-size:.77rem;margin-top:10px">✗ ${error}</div>` : '';

  return `<div>
    <input type="file" id="drzewo-pdf-input" accept=".pdf" style="display:none"
      onchange="if(this.files[0])drzewoUploadPdf(this.files[0])">
    <div
      onclick="document.getElementById('drzewo-pdf-input').click()"
      ondragover="event.preventDefault();this.style.borderColor='#3b82f6'"
      ondragleave="this.style.borderColor='#ffffff20'"
      ondrop="event.preventDefault();this.style.borderColor='#ffffff20';if(event.dataTransfer.files[0])drzewoUploadPdf(event.dataTransfer.files[0])"
      style="border:2px dashed #ffffff20;border-radius:8px;padding:32px 24px;text-align:center;cursor:pointer;transition:all .2s">
      ${dropHtml}
    </div>
    ${resultHtml}
    ${errorHtml}
  </div>`;
}

