//  MAIN RENDER
// ══════════════════════════════════════════════════════════════
function renderContent() {
  if (state.screen === 'config') return renderConfig();
  if (state.screen === 'restoring') return renderRestoring();
  if (state.screen === 'login')  return renderLogin();

  const tabContent = {
    praca:      renderPraca,
    majster:    renderMajster,
    magazyn:    renderMagazyn,
    zlecenia:   renderZlecenia,
    drzewo:     renderDrzewoGP,
    admin:      renderAdmin,
    ustawienia: renderUstawienia,
  }[state.activeTab] || (() => '');

  return `
    ${renderTopbar()}
    <div class="content">
      ${state.error ? `<div class="error-banner">⚠ ${state.error}</div>` : ''}
      ${tabContent()}
    </div>
    ${renderBottomNav()}
    ${renderFeedbackModal()}
    ${renderQRGenModal()}
    ${renderPrintModal()}
    ${renderKartaModal()}
    ${renderQRZleceniePickerModal()}
    ${renderEditSesjaModalHtml()}
    ${renderOblozenieZlecenieModal()}`;
}



// ═══════════════════════════════════════════════════════════════════════════════
// MODUŁ: FAKTUROWANIE
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Stan ─────────────────────────────────────────────────────────────────────
// Dodaj do state: fakturyList:[], fakturyLoading:false, fakturaModal:null,
// fakturaPreview:null, kontrahenciList:[], kontrahentModal:null,
// fakturySubTab:'lista', fakturyFilterStatus:'wszystkie', fakturyFilterRok:new Date().getFullYear()
// fakturaForm: null  (roboczy obiekt formularza)

// ─── Ładowanie danych ─────────────────────────────────────────────────────────
async function loadFakturowanie(filterStatus, filterRok) {
  const status = filterStatus ?? (state.fakturyFilterStatus || 'wszystkie');
  const rok = filterRok ?? (state.fakturyFilterRok || new Date().getFullYear());
  setState({fakturyLoading: true}, true);
  try {
    const [faktury, kontrahenci] = await Promise.all([
      get(`/api/faktury?status=${status}&rok=${rok}`),
      state.kontrahenciList?.length ? Promise.resolve(state.kontrahenciList) : get('/api/kontrahenci')
    ]);
    setState({fakturyList: faktury, kontrahenciList: kontrahenci,
              fakturyLoading: false, fakturyFilterStatus: status, fakturyFilterRok: rok});
  } catch(e) { setState({fakturyLoading: false}); alert('Błąd: ' + e.message); }
}

async function loadKontrahenci() {
  const k = await get('/api/kontrahenci');
  setState({kontrahenciList: k});
}

// ─── Akcje: Kontrahenci ───────────────────────────────────────────────────────
async function saveKontrahent() {
  const m = state.kontrahentModal;
  const form = {};
  ['nazwa','nip','adres','kod_pocztowy','miasto','kraj','email','telefon','uwagi'].forEach(f => {
    form[f] = document.getElementById('kf-'+f)?.value?.trim() || '';
  });
  if (!form.nazwa) { alert('Nazwa jest wymagana'); return; }
  try {
    if (m.id) { await patch('/api/kontrahenci/' + m.id, form); }
    else       { await post('/api/kontrahenci', form); }
    await loadKontrahenci();
    setState({kontrahentModal: null});
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function deleteKontrahent(id) {
  const k = state.kontrahenciList.find(x => x.id === id);
  if (!confirm(`Usunąć kontrahenta "${k?.nazwa}"?`)) return;
  try { await del('/api/kontrahenci/' + id); await loadKontrahenci(); render(); }
  catch(e) { alert('Błąd: ' + e.message); }
}

// ─── Akcje: Faktura ───────────────────────────────────────────────────────────
function openNowaFaktura() {
  const today = new Date().toISOString().slice(0,10);
  const termin = new Date(Date.now() + 14*864e5).toISOString().slice(0,10);
  setState({
    fakturaModal: 'new',
    fakturaForm: {
      kontrahent_id: '', zlecenie_id: '', data_wystawienia: today,
      data_sprzedazy: today, termin_platnosci: termin,
      forma_platnosci: 'przelew', uwagi: '', waluta: 'PLN',
      pozycje: [{lp:1, nazwa:'', jm:'szt', ilosc:1, cena_netto:0, vat_procent:23}]
    }
  });
}

async function autoFillFromZlecenie() {
  const zid = document.getElementById('ff-zlecenie-id')?.value;
  if (!zid) { alert('Wpisz ID zlecenia'); return; }
  try {
    const data = await get('/api/zlecenia/' + zid + '/faktura-template');
    const f = state.fakturaForm || {};
    setState({
      fakturaForm: {
        ...f,
        zlecenie_id: zid,
        pozycje: data.pozycje.map((p,i) => ({lp:i+1,...p}))
      }
    });
  } catch(e) { alert('Nie znaleziono zlecenia ' + zid); }
}

function addPozycjaFaktury() {
  const f = state.fakturaForm;
  const newLp = (f.pozycje?.length || 0) + 1;
  setState({fakturaForm: {...f, pozycje: [...(f.pozycje||[]),
    {lp:newLp, nazwa:'', jm:'szt', ilosc:1, cena_netto:0, vat_procent:23}
  ]}});
}

function removePozycjaFaktury(idx) {
  const f = state.fakturaForm;
  const poz = f.pozycje.filter((_,i) => i !== idx).map((p,i) => ({...p, lp:i+1}));
  setState({fakturaForm: {...f, pozycje: poz}});
}

function updatePozycja(idx, field, value) {
  const f = state.fakturaForm;
  const poz = f.pozycje.map((p,i) => i===idx ? {...p, [field]: field==='nazwa'||field==='jm' ? value : parseFloat(value)||0} : p);
  setState({fakturaForm: {...f, pozycje: poz}}, true);
  document.getElementById('faktura-total')?.replaceWith(renderFakturaTotal(poz));
}

function getFakturaFormData() {
  const f = state.fakturaForm || {};
  const readField = id => document.getElementById(id)?.value?.trim() || '';
  return {
    kontrahent_id: parseInt(readField('ff-kontrahent')) || null,
    zlecenie_id: parseInt(readField('ff-zlecenie-id')) || null,
    data_wystawienia: readField('ff-data-wyst'),
    data_sprzedazy: readField('ff-data-sprzed'),
    termin_platnosci: readField('ff-termin'),
    forma_platnosci: readField('ff-forma'),
    uwagi: readField('ff-uwagi'),
    waluta: readField('ff-waluta') || 'PLN',
    created_by: state.user?.id || null,
    pozycje: f.pozycje || []
  };
}

async function saveFaktura() {
  const data = getFakturaFormData();
  if (!data.data_wystawienia) { alert('Podaj datę wystawienia'); return; }
  if (!data.pozycje.length) { alert('Dodaj przynajmniej jedną pozycję'); return; }
  const empty = data.pozycje.find(p => !p.nazwa?.trim());
  if (empty) { alert('Uzupełnij nazwy wszystkich pozycji'); return; }
  try {
    const r = await post('/api/faktury', data);
    await loadFakturowanie();
    setState({fakturaModal: null, fakturaForm: null});
    alert(`Faktura ${r.numer} została zapisana!`);
  } catch(e) { alert('Błąd zapisu: ' + e.message); }
}

async function openFakturaPreview(id) {
  try {
    const data = await get('/api/faktury/' + id);
    setState({fakturaPreview: data});
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function setFakturaStatus(id, status) {
  const labels = {wystawiona:'Wystawiona', oplacona:'Opłacona', anulowana:'Anulowana', szkic:'Szkic'};
  if (!confirm(`Zmienić status faktury na "${labels[status]}"?`)) return;
  try {
    await patch('/api/faktury/' + id + '/status', {status});
    await loadFakturowanie();
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function deleteFaktura(id) {
  if (!confirm('Usunąć fakturę? Tej operacji nie można cofnąć.')) return;
  try { await del('/api/faktury/' + id); await loadFakturowanie(); }
  catch(e) { alert('Błąd: ' + e.message); }
}

// ─── Eksport CSV ──────────────────────────────────────────────────────────────
async function exportFakturCSV() {
  try {
    const data = await get('/api/faktury/export/all');
    const rows = [
      ['Nr_faktury','Data_wystawienia','Data_sprzedazy','Termin_platnosci','Forma_platnosci',
       'Status','Waluta','Nabywca','NIP','Adres','Kod_pocztowy','Miasto','Kraj',
       'Lp','Nazwa_pozycji','JM','Ilosc','Cena_netto','VAT_%','Wartosc_netto','Wartosc_brutto',
       'Total_netto_faktury','Total_VAT_faktury','Total_brutto_faktury','Uwagi']
    ];
    data.forEach(f => {
      if (!f.pozycje?.length) {
        rows.push([f.numer,f.data_wystawienia,f.data_sprzedazy||'',f.termin_platnosci||'',
          f.forma_platnosci||'',f.status,f.waluta,f.k_nazwa||'',f.k_nip||'',
          f.k_adres||'',f.k_kp||'',f.k_miasto||'',f.k_kraj||'',
          '','','','','','','','',f.total_netto,f.total_vat,f.total_brutto,f.uwagi||'']);
      } else {
        f.pozycje.forEach(p => {
          rows.push([f.numer,f.data_wystawienia,f.data_sprzedazy||'',f.termin_platnosci||'',
            f.forma_platnosci||'',f.status,f.waluta,f.k_nazwa||'',f.k_nip||'',
            f.k_adres||'',f.k_kp||'',f.k_miasto||'',f.k_kraj||'',
            p.lp,p.nazwa,p.jm,p.ilosc,p.cena_netto,p.vat_procent,p.wartosc_netto,p.wartosc_brutto,
            f.total_netto,f.total_vat,f.total_brutto,f.uwagi||'']);
        });
      }
    });
    const csv = rows.map(r => r.map(v => '"' + String(v??'').replace(/"/g,'""') + '"').join(';')).join('\r\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], {type:'text/csv;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `faktury_${state.fakturyFilterRok||'all'}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  } catch(e) { alert('Błąd eksportu: ' + e.message); }
}

// ─── Eksport XML (JPK-FA uproszczony) ────────────────────────────────────────
async function exportFakturaXML() {
  try {
    const data = await get('/api/faktury/export/all');
    const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const dzisiaj = new Date().toISOString().slice(0,10);
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<JPK xmlns="http://crd.gov.pl/wzor/2021/11/29/11089/" xmlns:etd="http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2021/11/29/eD/DefinicjeTypy/">\n`;
    xml += `  <Naglowek>\n`;
    xml += `    <DataWytworzeniaJPK>${dzisiaj}</DataWytworzeniaJPK>\n`;
    xml += `    <NazwaSystemu>ERP-System</NazwaSystemu>\n`;
    xml += `  </Naglowek>\n`;
    xml += `  <Faktury>\n`;
    data.forEach(f => {
      xml += `    <Faktura>\n`;
      xml += `      <P_1>${esc(f.numer)}</P_1>\n`;
      xml += `      <P_1M>${esc(f.data_wystawienia)}</P_1M>\n`;
      xml += `      <P_2A>${esc(f.data_sprzedazy||f.data_wystawienia)}</P_2A>\n`;
      xml += `      <P_3B>${esc(f.k_nazwa)}</P_3B>\n`;
      xml += `      <P_3C>${esc(f.k_adres+' '+f.k_kp+' '+f.k_miasto)}</P_3C>\n`;
      xml += `      <P_4B>${esc(f.k_nip)}</P_4B>\n`;
      xml += `      <P_6>${esc(f.termin_platnosci)}</P_6>\n`;
      xml += `      <P_15>${esc(String(f.total_brutto))}</P_15>\n`;
      xml += `      <Waluta>${esc(f.waluta||'PLN')}</Waluta>\n`;
      xml += `      <StatusFaktury>${esc(f.status)}</StatusFaktury>\n`;
      if (f.pozycje?.length) {
        xml += `      <FakturaWiersz>\n`;
        f.pozycje.forEach(p => {
          xml += `        <P_7>${esc(p.nazwa)}</P_7>\n`;
          xml += `        <P_8A>${esc(p.jm)}</P_8A>\n`;
          xml += `        <P_8B>${esc(String(p.ilosc))}</P_8B>\n`;
          xml += `        <P_9A>${esc(String(p.cena_netto))}</P_9A>\n`;
          xml += `        <P_11>${esc(String(p.wartosc_netto))}</P_11>\n`;
          xml += `        <P_12>${esc(String(p.vat_procent))}</P_12>\n`;
        });
        xml += `      </FakturaWiersz>\n`;
      }
      xml += `    </Faktura>\n`;
    });
    xml += `  </Faktury>\n</JPK>\n`;
    const blob = new Blob([xml], {type:'application/xml;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `JPK_FA_${new Date().toISOString().slice(0,10)}.xml`;
    a.click();
  } catch(e) { alert('Błąd eksportu XML: ' + e.message); }
}

// ─── Drukowanie faktury ───────────────────────────────────────────────────────
function printFaktura() {
  const d = state.fakturaPreview;
  if (!d) return;
  const f = d.faktura, poz = d.pozycje || [];
  const fmtPLN = v => parseFloat(v||0).toFixed(2).replace('.',',') + ' ' + (f.waluta||'PLN');
  const fmtD = s => (s||'').slice(0,10);
  const vatGroups = {};
  poz.forEach(p => {
    const k = p.vat_procent;
    if (!vatGroups[k]) vatGroups[k] = {netto:0, vat:0, brutto:0};
    vatGroups[k].netto  += parseFloat(p.wartosc_netto||0);
    vatGroups[k].vat    += parseFloat(p.wartosc_brutto||0) - parseFloat(p.wartosc_netto||0);
    vatGroups[k].brutto += parseFloat(p.wartosc_brutto||0);
  });
  let vatRows = '';
  Object.entries(vatGroups).forEach(([vat, g]) => {
    vatRows += `<tr><td>VAT ${vat}%</td><td>${fmtPLN(g.netto)}</td><td>${fmtPLN(g.vat)}</td><td>${fmtPLN(g.brutto)}</td></tr>`;
  });
  const statusColor = {wystawiona:'#1a73e8',oplacona:'#1e8a4c',anulowana:'#c0392b',szkic:'#888'}[f.status]||'#666';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Faktura ${f.numer}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,sans-serif;font-size:12px;color:#222;margin:0;padding:24px}
  h1{font-size:22px;margin:0 0 4px} .sub{color:#666;font-size:11px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:20px 0}
  .box{background:#f8f8f8;border:1px solid #ddd;border-radius:6px;padding:14px}
  .box-title{font-weight:700;font-size:11px;color:#888;text-transform:uppercase;margin-bottom:8px;letter-spacing:.5px}
  table{width:100%;border-collapse:collapse;margin:16px 0;font-size:11px}
  th{background:#222;color:#fff;padding:7px 10px;text-align:left;font-size:11px}
  td{padding:6px 10px;border-bottom:1px solid #eee}
  tr:nth-child(even) td{background:#fafafa}
  .num{text-align:right} .totals{margin-top:12px}
  .total-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #eee;font-size:12px}
  .total-final{font-size:16px;font-weight:700;color:#222;padding:8px 0;border-top:2px solid #222;margin-top:4px}
  .status-badge{display:inline-block;background:${statusColor};color:#fff;border-radius:4px;padding:2px 10px;font-size:11px;font-weight:700;text-transform:uppercase}
  .footer{margin-top:32px;display:grid;grid-template-columns:1fr 1fr;gap:40px;font-size:11px;color:#666}
  .sig-line{border-top:1px solid #999;margin-top:40px;padding-top:4px;text-align:center}
  @media print{body{padding:12px}.no-print{display:none}}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #222;padding-bottom:16px;margin-bottom:8px">
  <div>
    <h1>FAKTURA VAT</h1>
    <div style="font-size:20px;font-weight:700;color:#1a73e8">${f.numer}</div>
    <div class="sub">Data wystawienia: <b>${fmtD(f.data_wystawienia)}</b>
      ${f.data_sprzedazy ? ' &nbsp;|&nbsp; Data sprzedaży: <b>'+fmtD(f.data_sprzedazy)+'</b>' : ''}
    </div>
  </div>
  <div style="text-align:right">
    <div class="status-badge">${f.status?.toUpperCase()}</div>
    <div class="sub" style="margin-top:6px">Termin płatności: <b>${fmtD(f.termin_platnosci)||'—'}</b></div>
    <div class="sub">Forma płatności: <b>${f.forma_platnosci||'—'}</b></div>
    ${f.zlecenie_numer ? '<div class="sub">Zlecenie: <b>'+f.zlecenie_numer+'</b></div>' : ''}
  </div>
</div>
<div class="grid2">
  <div class="box">
    <div class="box-title">Sprzedawca</div>
    <div style="font-size:13px;font-weight:700">Twoja firma</div>
    <div class="sub">Uzupełnij dane sprzedawcy w konfiguracji</div>
  </div>
  <div class="box">
    <div class="box-title">Nabywca</div>
    <div style="font-size:13px;font-weight:700">${f.kontrahent_nazwa||'—'}</div>
    ${f.kontrahent_nip ? '<div class="sub">NIP: <b>'+f.kontrahent_nip+'</b></div>' : ''}
    ${f.kontrahent_adres ? '<div class="sub">'+f.kontrahent_adres+'</div>' : ''}
    ${f.kontrahent_kp||f.kontrahent_miasto ? '<div class="sub">'+(f.kontrahent_kp||'')+' '+(f.kontrahent_miasto||'')+'</div>' : ''}
    ${f.kontrahent_email ? '<div class="sub">✉ '+f.kontrahent_email+'</div>' : ''}
  </div>
</div>
<table>
  <thead><tr>
    <th style="width:30px">Lp</th>
    <th>Nazwa usługi / towaru</th>
    <th style="width:40px">JM</th>
    <th class="num" style="width:60px">Ilość</th>
    <th class="num" style="width:90px">Cena netto</th>
    <th class="num" style="width:50px">VAT %</th>
    <th class="num" style="width:90px">Wart. netto</th>
    <th class="num" style="width:90px">Wart. brutto</th>
  </tr></thead>
  <tbody>
    ${poz.map((p,i) => `<tr>
      <td>${i+1}</td><td>${p.nazwa}</td><td>${p.jm}</td>
      <td class="num">${parseFloat(p.ilosc).toLocaleString('pl-PL')}</td>
      <td class="num">${fmtPLN(p.cena_netto)}</td>
      <td class="num">${p.vat_procent}%</td>
      <td class="num">${fmtPLN(p.wartosc_netto)}</td>
      <td class="num"><b>${fmtPLN(p.wartosc_brutto)}</b></td>
    </tr>`).join('')}
  </tbody>
</table>
<div style="display:grid;grid-template-columns:1fr 280px;gap:24px;margin-top:8px">
  <div>
    <div class="box" style="font-size:11px">
      <div class="box-title">Stawki VAT</div>
      <table style="margin:0;font-size:11px">
        <tr style="background:#222;color:#fff"><th>Stawka</th><th>Netto</th><th>VAT</th><th>Brutto</th></tr>
        ${vatRows}
      </table>
    </div>
    ${f.uwagi ? '<div class="box" style="margin-top:8px;font-size:11px"><div class="box-title">Uwagi</div>'+f.uwagi+'</div>' : ''}
  </div>
  <div class="totals">
    <div class="total-row"><span>Razem netto</span><span>${fmtPLN(f.total_netto)}</span></div>
    <div class="total-row"><span>Razem VAT</span><span>${fmtPLN(f.total_vat)}</span></div>
    <div class="total-row total-final"><span>RAZEM BRUTTO</span><span style="color:#1a73e8">${fmtPLN(f.total_brutto)}</span></div>
  </div>
</div>
<div class="footer">
  <div><div class="sig-line">Wystawił(a): ${f.wystawil||'—'}</div></div>
  <div><div class="sig-line">Odebrał(a) / pieczątka nabywcy</div></div>
</div>
<div class="no-print" style="margin-top:20px;text-align:center">
  <button onclick="window.print()" style="padding:10px 28px;background:#1a73e8;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer">🖨 Drukuj</button>
</div>
</body></html>`;
  const w = window.open('','_blank','width=960,height=720');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 500);
}

// ─── Renderowanie: helper sumy pozycji ────────────────────────────────────────
function renderFakturaTotal(poz) {
  const totN = poz.reduce((s,p) => s + (p.ilosc||0)*(p.cena_netto||0), 0);
  const totV = poz.reduce((s,p) => s + (p.ilosc||0)*(p.cena_netto||0)*(p.vat_procent||0)/100, 0);
  const el = document.createElement('div');
  el.id = 'faktura-total';
  el.style.cssText = 'display:flex;justify-content:flex-end;gap:20px;padding:10px 8px;background:var(--panel);border-radius:6px;font-size:13px;font-weight:600;margin-top:4px';
  el.innerHTML = `<span>Netto: <span style="color:var(--accent)">${totN.toFixed(2)} PLN</span></span>
    <span>VAT: <span style="color:var(--accent)">${totV.toFixed(2)} PLN</span></span>
    <span style="font-size:15px">Brutto: <span style="color:var(--accent)">${(totN+totV).toFixed(2)} PLN</span></span>`;
  return el;
}

// ─── Render: lista faktur ─────────────────────────────────────────────────────
function renderFakturowanie() {
  const subTab = state.fakturySubTab || 'lista';
  const role = state.user?.role;
  const canFaktura = ['admin','technolog'].includes(role);

  let html = `<div style="display:flex;gap:6px;margin-bottom:14px;border-bottom:1px solid var(--border);padding-bottom:10px">
    <button onclick="setState({fakturySubTab:'lista'})"
      style="padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:600;
             background:${subTab==='lista'?'var(--accent)':'var(--panel)'};color:${subTab==='lista'?'#1a1f2e':'var(--dim)'}">
      🧾 Faktury
    </button>
    <button onclick="setState({fakturySubTab:'kontrahenci'});loadKontrahenci()"
      style="padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:600;
             background:${subTab==='kontrahenci'?'var(--accent)':'var(--panel)'};color:${subTab==='kontrahenci'?'#1a1f2e':'var(--dim)'}">
      🏢 Kontrahenci
    </button>
  </div>`;

  if (subTab === 'kontrahenci') return html + renderKontrahenci();

  // ── Lista faktur ──
  const lista = state.fakturyList || [];
  const statusColors = {szkic:'#888',wystawiona:'#1a73e8',oplacona:'#1e8a4c',anulowana:'#c0392b'};
  const statusLabels = {szkic:'Szkic',wystawiona:'Wystawiona',oplacona:'Opłacona',anulowana:'Anulowana'};
  const roks = [];
  const curYear = new Date().getFullYear();
  for (let y = curYear; y >= curYear-3; y--) roks.push(y);

  html += `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">`;
  if (canFaktura) {
    html += `<button class="btn btn-accent" onclick="openNowaFaktura()">+ Nowa faktura</button>`;
  }
  html += `<select id="faktura-filter-status" onchange="loadFakturowanie(this.value)"
    style="padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--panel);color:var(--text);font-size:13px">
    ${['wszystkie','szkic','wystawiona','oplacona','anulowana'].map(s =>
      `<option value="${s}" ${(state.fakturyFilterStatus||'wszystkie')===s?'selected':''}>${s==='wszystkie'?'Wszystkie statusy':statusLabels[s]}</option>`
    ).join('')}
  </select>
  <select id="faktura-filter-rok" onchange="loadFakturowanie(null,parseInt(this.value))"
    style="padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--panel);color:var(--text);font-size:13px">
    ${roks.map(y => `<option value="${y}" ${(state.fakturyFilterRok||curYear)===y?'selected':''}>${y}</option>`).join('')}
  </select>
  <button class="btn-sm btn-accent" onclick="loadFakturowanie()">🔄</button>
  <div style="margin-left:auto;display:flex;gap:6px">
    <button class="btn-sm" onclick="exportFakturCSV()"
      style="background:rgba(30,138,76,.12);color:#1e8a4c;border-color:#1e8a4c">⬇ CSV</button>
    <button class="btn-sm" onclick="exportFakturaXML()"
      style="background:rgba(26,115,232,.12);color:#1a73e8;border-color:#1a73e8">⬇ XML</button>
  </div>
  </div>`;

  if (state.fakturyLoading) { html += '<div class="spinner">⏳</div>'; return html; }

  if (!lista.length) {
    html += `<div style="text-align:center;color:var(--dim);padding:40px">
      <div style="font-size:36px">🧾</div>
      <div style="margin-top:8px">Brak faktur. ${canFaktura ? 'Kliknij <b>+ Nowa faktura</b> aby zacząć.' : ''}</div>
    </div>`;
    return html;
  }

  // Podsumowanie
  const totalBrutto = lista.filter(f => f.status !== 'anulowana').reduce((s,f) => s + (f.total_brutto||0), 0);
  const oplacone   = lista.filter(f => f.status === 'oplacona').reduce((s,f) => s + (f.total_brutto||0), 0);
  const wystawione = lista.filter(f => f.status === 'wystawiona').reduce((s,f) => s + (f.total_brutto||0), 0);
  html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
    <div style="background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:11px;color:var(--dim)">ŁĄCZNIE BRUTTO</div>
      <div style="font-size:18px;font-weight:700;color:var(--accent)">${totalBrutto.toFixed(2)} PLN</div>
    </div>
    <div style="background:var(--panel);border:1px solid #1a73e8;border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:11px;color:var(--dim)">DO ZAPŁATY</div>
      <div style="font-size:18px;font-weight:700;color:#1a73e8">${wystawione.toFixed(2)} PLN</div>
    </div>
    <div style="background:var(--panel);border:1px solid #1e8a4c;border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:11px;color:var(--dim)">OPŁACONE</div>
      <div style="font-size:18px;font-weight:700;color:#1e8a4c">${oplacone.toFixed(2)} PLN</div>
    </div>
  </div>`;

  html += `<div style="display:flex;flex-direction:column;gap:8px">`;
  lista.forEach(f => {
    const sc = statusColors[f.status] || '#888';
    const sl = statusLabels[f.status] || f.status;
    const isOverdue = f.status==='wystawiona' && f.termin_platnosci && f.termin_platnosci < new Date().toISOString().slice(0,10);
    html += `<div style="background:var(--panel);border:1px solid ${isOverdue?'#c0392b':'var(--border)'};border-radius:8px;padding:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--accent)">${f.numer}
            ${isOverdue ? '<span style="color:#c0392b;font-size:11px;margin-left:6px">⚠ PRZETERMINOWANA</span>' : ''}
          </div>
          <div style="font-size:12px;color:var(--dim);margin-top:2px">
            ${f.kontrahent_nazwa ? '<b>'+f.kontrahent_nazwa+'</b>' : '<i>brak kontrahenta</i>'}
            ${f.kontrahent_nip ? ' · NIP: '+f.kontrahent_nip : ''}
            ${f.zlecenie_numer ? ' · Zlecenie: <b>'+f.zlecenie_numer+'</b>' : ''}
          </div>
          <div style="font-size:11px;color:var(--dim);margin-top:2px">
            Wystawiona: ${(f.data_wystawienia||'').slice(0,10)}
            ${f.termin_platnosci ? ' · Termin: '+f.termin_platnosci : ''}
            · ${f.forma_platnosci||''}
          </div>
        </div>
        <div style="text-align:right">
          <span style="background:${sc};color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700">${sl}</span>
          <div style="font-size:18px;font-weight:700;margin-top:4px">${parseFloat(f.total_brutto||0).toFixed(2)} PLN</div>
          <div style="font-size:11px;color:var(--dim)">netto: ${parseFloat(f.total_netto||0).toFixed(2)} + VAT: ${parseFloat(f.total_vat||0).toFixed(2)}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        <button class="btn-sm btn-accent" onclick="openFakturaPreview(${f.id})">🔍 Podgląd / Drukuj</button>
        ${f.status==='szkic' ? `<button class="btn-sm" onclick="setFakturaStatus(${f.id},'wystawiona')" style="background:rgba(26,115,232,.12);color:#1a73e8;border-color:#1a73e8">📤 Wystaw</button>` : ''}
        ${f.status==='wystawiona' ? `<button class="btn-sm" onclick="setFakturaStatus(${f.id},'oplacona')" style="background:rgba(30,138,76,.12);color:#1e8a4c;border-color:#1e8a4c">✅ Oznacz jako opłaconą</button>` : ''}
        ${['szkic','wystawiona'].includes(f.status) ? `<button class="btn-sm" onclick="setFakturaStatus(${f.id},'anulowana')" style="background:rgba(192,57,43,.08);color:#c0392b;border-color:#c0392b">✕ Anuluj</button>` : ''}
        ${['szkic','anulowana'].includes(f.status) ? `<button class="btn-sm btn-red" onclick="deleteFaktura(${f.id})">🗑</button>` : ''}
      </div>
    </div>`;
  });
  html += '</div>';
  return html;
}

// ─── Render: Kontrahenci ──────────────────────────────────────────────────────
function renderKontrahenci() {
  const lista = state.kontrahenciList || [];
  let html = `<div style="display:flex;gap:8px;margin-bottom:12px">
    <button class="btn btn-accent" onclick="setState({kontrahentModal:{}})">+ Dodaj kontrahenta</button>
    <button class="btn-sm btn-accent" onclick="loadKontrahenci()">🔄</button>
  </div>`;
  if (!lista.length) return html + `<div style="text-align:center;color:var(--dim);padding:40px">Brak kontrahentów</div>`;
  html += `<div style="display:flex;flex-direction:column;gap:8px">`;
  lista.forEach(k => {
    html += `<div style="background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-weight:700;font-size:14px">${k.nazwa}</div>
        <div style="font-size:11px;color:var(--dim)">
          ${k.nip ? 'NIP: '+k.nip+' · ' : ''}
          ${k.adres ? k.adres+', ' : ''}${k.kod_pocztowy||''} ${k.miasto||''}
          ${k.email ? ' · '+k.email : ''}
          ${k.telefon ? ' · ☎ '+k.telefon : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn-sm btn-accent" onclick="setState({kontrahentModal:${JSON.stringify(k).replace(/'/g,"&#39;")}})">✏ Edytuj</button>
        <button class="btn-sm btn-red" onclick="deleteKontrahent(${k.id})">🗑</button>
      </div>
    </div>`;
  });
  return html + '</div>' + renderKontrahentModal();
}

function renderKontrahentModal() {
  const m = state.kontrahentModal;
  if (!m) return '';
  const v = (f) => m[f] || '';
  return `<div class="modal-overlay" onclick="if(event.target===this)setState({kontrahentModal:null})">
  <div class="modal-box" style="max-width:500px">
    <div class="modal-header"><span>${m.id ? 'Edytuj kontrahenta' : 'Nowy kontrahent'}</span>
      <button class="modal-close" onclick="setState({kontrahentModal:null})">✕</button></div>
    <div class="modal-body" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="grid-column:1/-1">
        <label class="field-label">Nazwa firmy *</label>
        <input class="field-input" id="kf-nazwa" value="${v('nazwa')}" placeholder="np. ACME Sp. z o.o.">
      </div>
      <div>
        <label class="field-label">NIP</label>
        <input class="field-input" id="kf-nip" value="${v('nip')}" placeholder="0000000000">
      </div>
      <div>
        <label class="field-label">Telefon</label>
        <input class="field-input" id="kf-telefon" value="${v('telefon')}" placeholder="+48 ...">
      </div>
      <div style="grid-column:1/-1">
        <label class="field-label">Adres</label>
        <input class="field-input" id="kf-adres" value="${v('adres')}" placeholder="ul. Przykładowa 1">
      </div>
      <div>
        <label class="field-label">Kod pocztowy</label>
        <input class="field-input" id="kf-kod_pocztowy" value="${v('kod_pocztowy')}" placeholder="00-000">
      </div>
      <div>
        <label class="field-label">Miasto</label>
        <input class="field-input" id="kf-miasto" value="${v('miasto')}" placeholder="Warszawa">
      </div>
      <div>
        <label class="field-label">Kraj</label>
        <input class="field-input" id="kf-kraj" value="${v('kraj')||'PL'}" placeholder="PL">
      </div>
      <div>
        <label class="field-label">E-mail</label>
        <input class="field-input" id="kf-email" value="${v('email')}" placeholder="biuro@firma.pl">
      </div>
      <div style="grid-column:1/-1">
        <label class="field-label">Uwagi</label>
        <input class="field-input" id="kf-uwagi" value="${v('uwagi')}" placeholder="opcjonalne">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-accent" onclick="saveKontrahent()">💾 Zapisz</button>
      <button class="btn" onclick="setState({kontrahentModal:null})">Anuluj</button>
    </div>
  </div></div>`;
}

// ─── Render: Modal nowej faktury ──────────────────────────────────────────────
function renderFakturaModal() {
  if (!state.fakturaModal) return '';
  const f = state.fakturaForm || {};
  const poz = f.pozycje || [];
  const kont = state.kontrahenciList || [];
  const vatOpts = [0,5,8,23].map(v => `<option value="${v}">${v}%</option>`).join('');
  const jmOpts = ['szt','godz','kg','m','m2','m3','mb','kpl','usługa'].map(j => `<option value="${j}">${j}</option>`).join('');

  let pozRows = poz.map((p,i) => `
    <tr style="background:${i%2?'var(--bg)':'var(--panel)'}">
      <td style="padding:4px;text-align:center;color:var(--dim);font-size:11px">${i+1}</td>
      <td style="padding:4px"><input class="field-input" style="width:100%;min-width:140px" value="${(p.nazwa||'').replace(/"/g,'&quot;')}"
        oninput="updatePozycja(${i},'nazwa',this.value)" placeholder="Nazwa pozycji"></td>
      <td style="padding:4px"><select class="field-input" style="width:70px" onchange="updatePozycja(${i},'jm',this.value)">
        ${['szt','godz','kg','m','m2','m3','mb','kpl','usługa'].map(j=>`<option value="${j}" ${p.jm===j?'selected':''}>${j}</option>`).join('')}
      </select></td>
      <td style="padding:4px"><input type="number" class="field-input" style="width:70px;text-align:right" value="${p.ilosc||1}" min="0.001" step="0.001"
        oninput="updatePozycja(${i},'ilosc',this.value)"></td>
      <td style="padding:4px"><input type="number" class="field-input" style="width:90px;text-align:right" value="${p.cena_netto||0}" min="0" step="0.01"
        oninput="updatePozycja(${i},'cena_netto',this.value)"></td>
      <td style="padding:4px"><select class="field-input" style="width:65px" onchange="updatePozycja(${i},'vat_procent',this.value)">
        ${[0,5,8,23].map(v=>`<option value="${v}" ${p.vat_procent==v?'selected':''}>${v}%</option>`).join('')}
      </select></td>
      <td style="padding:4px;text-align:right;font-size:12px;white-space:nowrap">${((p.ilosc||0)*(p.cena_netto||0)).toFixed(2)}</td>
      <td style="padding:4px;text-align:right;font-size:12px;font-weight:600;white-space:nowrap">${((p.ilosc||0)*(p.cena_netto||0)*(1+(p.vat_procent||0)/100)).toFixed(2)}</td>
      <td style="padding:4px"><button class="btn-sm btn-red" style="padding:2px 8px" onclick="removePozycjaFaktury(${i})">✕</button></td>
    </tr>`).join('');

  const totN = poz.reduce((s,p)=>s+(p.ilosc||0)*(p.cena_netto||0),0);
  const totV = poz.reduce((s,p)=>s+(p.ilosc||0)*(p.cena_netto||0)*(p.vat_procent||0)/100,0);

  return `<div class="modal-overlay" onclick="if(event.target===this)setState({fakturaModal:null,fakturaForm:null})">
  <div class="modal-box" style="max-width:900px;width:95vw">
    <div class="modal-header"><span>🧾 Nowa faktura VAT</span>
      <button class="modal-close" onclick="setState({fakturaModal:null,fakturaForm:null})">✕</button></div>
    <div class="modal-body">

      <!-- Nagłówek faktury -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div>
          <label class="field-label">Kontrahent (nabywca)</label>
          <select class="field-input" id="ff-kontrahent" style="width:100%">
            <option value="">— wybierz —</option>
            ${kont.map(k=>`<option value="${k.id}" ${f.kontrahent_id==k.id?'selected':''}>${k.nazwa}${k.nip?' (NIP: '+k.nip+')':''}</option>`).join('')}
          </select>
          <div style="font-size:11px;color:var(--dim);margin-top:3px">
            Brak? <a href="#" onclick="setState({fakturySubTab:'kontrahenci'});setState({fakturaModal:null,fakturaForm:null})" style="color:var(--accent)">Dodaj kontrahenta</a>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <label class="field-label">Data wystawienia *</label>
            <input type="date" class="field-input" id="ff-data-wyst" value="${f.data_wystawienia||''}">
          </div>
          <div>
            <label class="field-label">Data sprzedaży</label>
            <input type="date" class="field-input" id="ff-data-sprzed" value="${f.data_sprzedazy||''}">
          </div>
          <div>
            <label class="field-label">Termin płatności</label>
            <input type="date" class="field-input" id="ff-termin" value="${f.termin_platnosci||''}">
          </div>
          <div>
            <label class="field-label">Forma płatności</label>
            <select class="field-input" id="ff-forma">
              ${['przelew','gotówka','karta','kompensata'].map(fm=>`<option value="${fm}" ${f.forma_platnosci===fm?'selected':''}>${fm}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Powiązanie ze zleceniem -->
      <div style="background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:12px;display:flex;gap:10px;align-items:flex-end">
        <div style="flex:0 0 auto">
          <label class="field-label">Auto-uzupełnij ze zlecenia</label>
          <input type="number" class="field-input" id="ff-zlecenie-id" value="${f.zlecenie_id||''}" placeholder="ID zlecenia" style="width:130px">
        </div>
        <button class="btn-sm btn-accent" onclick="autoFillFromZlecenie()" style="margin-bottom:1px">⚡ Wczytaj pozycje</button>
        <div style="font-size:11px;color:var(--dim)">Automatycznie wypełni pozycje na podstawie danych zlecenia</div>
      </div>

      <!-- Tabela pozycji -->
      <div style="font-weight:600;margin-bottom:6px;font-size:13px">Pozycje faktury</div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:var(--panel-dark,#1a1f2e);color:#aaa">
            <th style="padding:6px 4px;width:28px">#</th>
            <th style="padding:6px 4px;text-align:left">Nazwa</th>
            <th style="padding:6px 4px;width:75px">JM</th>
            <th style="padding:6px 4px;width:75px;text-align:right">Ilość</th>
            <th style="padding:6px 4px;width:100px;text-align:right">Cena netto</th>
            <th style="padding:6px 4px;width:65px">VAT</th>
            <th style="padding:6px 4px;width:90px;text-align:right">W. netto</th>
            <th style="padding:6px 4px;width:90px;text-align:right">W. brutto</th>
            <th style="padding:6px 4px;width:34px"></th>
          </tr></thead>
          <tbody id="poz-tbody">${pozRows}</tbody>
        </table>
      </div>
      <button class="btn-sm btn-accent" onclick="addPozycjaFaktury()" style="margin-top:8px">+ Dodaj pozycję</button>
      <div id="faktura-total" style="display:flex;justify-content:flex-end;gap:20px;padding:10px 8px;background:var(--panel);border-radius:6px;font-size:13px;font-weight:600;margin-top:8px">
        <span>Netto: <span style="color:var(--accent)">${totN.toFixed(2)} PLN</span></span>
        <span>VAT: <span style="color:var(--accent)">${totV.toFixed(2)} PLN</span></span>
        <span style="font-size:15px">Brutto: <span style="color:var(--accent)">${(totN+totV).toFixed(2)} PLN</span></span>
      </div>

      <!-- Uwagi + waluta -->
      <div style="display:grid;grid-template-columns:1fr 120px;gap:10px;margin-top:12px">
        <div>
          <label class="field-label">Uwagi</label>
          <input class="field-input" id="ff-uwagi" value="${f.uwagi||''}" placeholder="opcjonalne uwagi na fakturze">
        </div>
        <div>
          <label class="field-label">Waluta</label>
          <select class="field-input" id="ff-waluta">
            ${['PLN','EUR','USD','GBP'].map(w=>`<option value="${w}" ${(f.waluta||'PLN')===w?'selected':''}>${w}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-accent" onclick="saveFaktura()">💾 Zapisz fakturę</button>
      <button class="btn" onclick="setState({fakturaModal:null,fakturaForm:null})">Anuluj</button>
    </div>
  </div></div>`;
}

// ─── Render: Podgląd faktury ──────────────────────────────────────────────────
function renderFakturaPreview() {
  const d = state.fakturaPreview;
  if (!d) return '';
  const f = d.faktura, poz = d.pozycje || [];
  const fmtPLN = v => parseFloat(v||0).toFixed(2) + ' ' + (f.waluta||'PLN');
  const statusColors = {szkic:'#888',wystawiona:'#1a73e8',oplacona:'#1e8a4c',anulowana:'#c0392b'};
  const sc = statusColors[f.status]||'#888';

  return `<div class="modal-overlay" onclick="if(event.target===this)setState({fakturaPreview:null})">
  <div class="modal-box" style="max-width:800px;width:95vw">
    <div class="modal-header">
      <span>🧾 ${f.numer} <span style="background:${sc};color:#fff;border-radius:4px;padding:1px 8px;font-size:11px;margin-left:6px">${f.status?.toUpperCase()}</span></span>
      <button class="modal-close" onclick="setState({fakturaPreview:null})">✕</button>
    </div>
    <div class="modal-body">

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div style="background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px">
          <div style="font-size:10px;color:var(--dim);font-weight:700;text-transform:uppercase;margin-bottom:6px">Nabywca</div>
          <div style="font-weight:700">${f.kontrahent_nazwa||'— brak —'}</div>
          ${f.kontrahent_nip ? `<div style="font-size:12px;color:var(--dim)">NIP: ${f.kontrahent_nip}</div>` : ''}
          ${f.kontrahent_adres ? `<div style="font-size:12px;color:var(--dim)">${f.kontrahent_adres}</div>` : ''}
          ${(f.kontrahent_kp||f.kontrahent_miasto) ? `<div style="font-size:12px;color:var(--dim)">${f.kontrahent_kp||''} ${f.kontrahent_miasto||''}</div>` : ''}
        </div>
        <div style="background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:12px">
          <div style="font-size:10px;color:var(--dim);font-weight:700;text-transform:uppercase;margin-bottom:6px">Dane faktury</div>
          <div><b>Data wystawienia:</b> ${(f.data_wystawienia||'').slice(0,10)}</div>
          ${f.data_sprzedazy ? `<div><b>Data sprzedaży:</b> ${f.data_sprzedazy.slice(0,10)}</div>` : ''}
          <div><b>Termin płatności:</b> ${(f.termin_platnosci||'').slice(0,10)||'—'}</div>
          <div><b>Forma płatności:</b> ${f.forma_platnosci||'—'}</div>
          ${f.zlecenie_numer ? `<div><b>Zlecenie:</b> ${f.zlecenie_numer}</div>` : ''}
          ${f.wystawil ? `<div><b>Wystawił:</b> ${f.wystawil}</div>` : ''}
        </div>
      </div>

      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#1a1f2e;color:#ccc">
            <th style="padding:8px;width:30px">#</th>
            <th style="padding:8px;text-align:left">Nazwa</th>
            <th style="padding:8px;width:40px">JM</th>
            <th style="padding:8px;width:55px;text-align:right">Ilość</th>
            <th style="padding:8px;width:90px;text-align:right">Cena netto</th>
            <th style="padding:8px;width:50px;text-align:center">VAT</th>
            <th style="padding:8px;width:90px;text-align:right">W. netto</th>
            <th style="padding:8px;width:90px;text-align:right">W. brutto</th>
          </tr></thead>
          <tbody>
            ${poz.map((p,i) => `<tr style="background:${i%2?'var(--bg)':'var(--panel)'}">
              <td style="padding:6px 8px;text-align:center;color:var(--dim)">${i+1}</td>
              <td style="padding:6px 8px">${p.nazwa}</td>
              <td style="padding:6px 8px;text-align:center">${p.jm}</td>
              <td style="padding:6px 8px;text-align:right">${parseFloat(p.ilosc).toLocaleString('pl-PL')}</td>
              <td style="padding:6px 8px;text-align:right">${fmtPLN(p.cena_netto)}</td>
              <td style="padding:6px 8px;text-align:center">${p.vat_procent}%</td>
              <td style="padding:6px 8px;text-align:right">${fmtPLN(p.wartosc_netto)}</td>
              <td style="padding:6px 8px;text-align:right;font-weight:700">${fmtPLN(p.wartosc_brutto)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div style="display:flex;justify-content:flex-end;margin-top:12px">
        <div style="background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:14px;min-width:260px">
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px"><span style="color:var(--dim)">Razem netto</span><b>${fmtPLN(f.total_netto)}</b></div>
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px"><span style="color:var(--dim)">Razem VAT</span><b>${fmtPLN(f.total_vat)}</b></div>
          <div style="display:flex;justify-content:space-between;padding:8px 0 4px;font-size:17px;font-weight:700;border-top:2px solid var(--accent);margin-top:4px">
            <span>BRUTTO</span><span style="color:var(--accent)">${fmtPLN(f.total_brutto)}</span>
          </div>
        </div>
      </div>
      ${f.uwagi ? `<div style="margin-top:10px;font-size:12px;color:var(--dim)"><b>Uwagi:</b> ${f.uwagi}</div>` : ''}
    </div>
    <div class="modal-footer" style="flex-wrap:wrap;gap:8px">
      <button class="btn btn-accent" onclick="printFaktura()">🖨 Drukuj / PDF</button>
      ${f.status==='szkic' ? `<button class="btn" onclick="setFakturaStatus(${f.id},'wystawiona');setState({fakturaPreview:null})" style="background:rgba(26,115,232,.15);color:#1a73e8;border-color:#1a73e8">📤 Wystaw fakturę</button>` : ''}
      ${f.status==='wystawiona' ? `<button class="btn" onclick="setFakturaStatus(${f.id},'oplacona');setState({fakturaPreview:null})" style="background:rgba(30,138,76,.15);color:#1e8a4c;border-color:#1e8a4c">✅ Oznacz opłaconą</button>` : ''}
      <button class="btn" onclick="setState({fakturaPreview:null})">Zamknij</button>
    </div>
  </div></div>`;
}


// ══════════════════════════════════════════════════════════════
