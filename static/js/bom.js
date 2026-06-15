//  BOM – Bill of Materials
// ══════════════════════════════════════════════════════════════
async function loadBom(zlecenieId) {
  try {
    const data = await get(`/api/zlecenia/${zlecenieId}/bom`);
    setState({bomData: {...state.bomData, [zlecenieId]: data}});
  } catch(e) { console.error('BOM load error:', e.message); }
}

async function bomSearchMat() {
  const q = state.bomSearch.trim();
  if (q.length < 2) { setState({bomSearchResults:[]}); return; }
  setState({bomSearching: true});
  try {
    const res = await get(`/api/materialy?q=${encodeURIComponent(q)}&limit=20`);
    setState({bomSearchResults: res, bomSearching: false});
  } catch(e) { setState({bomSearching:false}); }
}

async function bomAddPozycja(zlecenieId, materialId) {
  const ilosc = parseFloat(document.getElementById('bom-qty')?.value || state.bomQty) || 1;
  const uwagi = document.getElementById('bom-uwagi')?.value || '';
  try {
    await post(`/api/zlecenia/${zlecenieId}/bom`, {material_id: materialId, ilosc, uwagi});
    setState({bomSearch:'', bomSearchResults:[], bomQty:1, bomUwagi:''});
    await loadBom(zlecenieId);
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function bomDeletePozycja(bomId, zlecenieId) {
  if (!confirm('Usunąć tę pozycję z BOM?')) return;
  try {
    await del(`/api/bom/${bomId}`);
    await loadBom(zlecenieId);
  } catch(e) { alert('Błąd: ' + e.message); }
}

function renderBomSection(zlecenieId) {
  const pozycje = state.bomData[zlecenieId];
  if (!pozycje) {
    // Ładuj dane jeśli jeszcze nie załadowane
    loadBom(zlecenieId);
    return '<div style="text-align:center;padding:12px;color:var(--dim);font-size:12px">⏳ Ładowanie BOM...</div>';
  }

  let html = `<div style="background:var(--entry);border:1px solid var(--accent);border-radius:10px;padding:14px;margin-bottom:14px">
    <div style="font-weight:700;font-size:13px;color:var(--accent);margin-bottom:10px">📦 BOM – Lista materiałów</div>`;

  // Istniejące pozycje
  if (pozycje.length) {
    // Grupowanie po gatunku stali
    const byGrade = {};
    for (const p of pozycje) {
      const g = p.gatunek_stali || 'S235';
      byGrade[g] = (byGrade[g] || 0) + (p.masa_kg || 0);
    }
    const totalKg = Object.values(byGrade).reduce((a,b)=>a+b,0);
    if (totalKg > 0) {
      html += `<div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:10px;padding:7px 10px;background:rgba(39,174,96,0.06);border:1px solid rgba(39,174,96,0.2);border-radius:8px">
        <span style="font-size:11px;color:var(--dim);font-weight:700;margin-right:2px">⚖ Zapotrzebowanie:</span>`;
      for (const [g, kg] of Object.entries(byGrade)) {
        html += `<span style="background:rgba(232,160,32,0.15);border:1px solid rgba(232,160,32,0.3);border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;color:var(--accent)">${g}: ${kg.toFixed(1)} kg</span>`;
      }
      html += `<span style="margin-left:auto;font-size:12px;font-weight:700;color:var(--green)">Σ ${totalKg.toFixed(1)} kg</span></div>`;
    }

    html += `<div style="margin-bottom:12px">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="border-bottom:1px solid var(--border)">
          <th style="text-align:left;padding:4px 6px;color:var(--dim)">Materiał</th>
          <th style="text-align:right;padding:4px 6px;color:var(--dim)">Masa</th>
          <th style="text-align:right;padding:4px 6px;color:var(--dim)">Dostępne</th>
          <th style="text-align:right;padding:4px 6px;color:var(--dim)">Status</th>
          <th style="padding:4px 2px"></th>
        </tr></thead><tbody>`;
    for (const p of pozycje) {
      const dostepneKg = p.do_dyspozycji ?? p.stan_rzeczywisty ?? 0;
      const masaKg = p.masa_kg || 0;
      const useKg = masaKg > 0;

      // Kolumna "Masa" — zapotrzebowanie zlecenia
      const masaStr = useKg ? `<b>${masaKg.toFixed(2)}</b> kg` : `<b>${p.ilosc}</b> ${p.jm}`;
      // Dostępne — ze stanu magazynu (już w kg gdy jm=kg, lub w szt gdy jm=szt)
      const dostepneStr = useKg
        ? `${dostepneKg.toFixed(2)} kg`
        : `${dostepneKg.toFixed(p.jm === 'szt' ? 0 : 3)} ${p.jm}`;
      // Brakuje = zapotrzebowanie_kg - stan_kg (lub szt jeśli brak masy)
      const brakuje = useKg ? masaKg - dostepneKg : p.ilosc - dostepneKg;
      const statusColor = brakuje > 0.001 ? 'var(--red)' : 'var(--green)';
      const statusLabel = brakuje > 0.001
        ? (useKg ? `⚠ brak ${brakuje.toFixed(2)} kg` : `⚠ brak ${brakuje.toFixed(p.jm === 'szt' ? 0 : 2)} ${p.jm}`)
        : '✓ dostępny';
      const subParts = [
        p.indeks,
        p.gatunek_stali ? `<span style="color:var(--accent)">${p.gatunek_stali}</span>` : '',
        p.wymiary_str ? `<span style="color:var(--dim)">${p.wymiary_str}</span>` : '',
        useKg ? `<span style="color:var(--dim)">${p.ilosc} ${p.jm}</span>` : '',
        p.uwagi ? `<span style="color:var(--dim)">${p.uwagi}</span>` : '',
      ].filter(Boolean).join(' · ');
      html += `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:5px 6px">
          <div style="font-weight:600">${p.opis}</div>
          <div style="color:var(--dim);font-size:10px">${subParts}</div>
        </td>
        <td style="text-align:right;padding:5px 6px;white-space:nowrap">${masaStr}</td>
        <td style="text-align:right;padding:5px 6px;white-space:nowrap;color:var(--dim)">${dostepneStr}</td>
        <td style="text-align:right;padding:5px 6px;white-space:nowrap;color:${statusColor};font-size:10px;font-weight:700">${statusLabel}</td>
        <td style="padding:5px 2px">
          <button onclick="bomDeletePozycja(${p.id},${zlecenieId})"
            style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:2px 4px">×</button>
        </td>
      </tr>`;
    }
    html += '</tbody></table></div>';

    // Podsumowanie niedoborów
    const braki = pozycje.filter(p => {
      const dostepne = p.do_dyspozycji ?? p.stan_rzeczywisty ?? 0;
      return p.masa_kg > 0 ? (p.masa_kg - dostepne) > 0.001 : p.ilosc > dostepne;
    });
    if (braki.length) {
      html += `<div style="background:rgba(220,50,50,.1);border:1px solid var(--red);border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:11px;color:var(--red)">
        ⚠ <b>${braki.length} pozycj${braki.length===1?'a':braki.length<5?'e':'i'} z niedoborem</b> – sprawdź stan magazynu przed uruchomieniem produkcji
      </div>`;
    } else {
      html += `<div style="background:rgba(30,180,100,.1);border:1px solid var(--green);border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:11px;color:var(--green)">
        ✓ Wszystkie materiały dostępne
      </div>`;
    }
  } else {
    html += `<div style="color:var(--dim);font-size:12px;text-align:center;padding:8px;margin-bottom:10px">Brak pozycji – dodaj materiały poniżej</div>`;
  }

  // Dodaj materiał – wyszukiwarka
  html += `<div style="border-top:1px solid var(--border);padding-top:12px">
    <div style="font-size:11px;color:var(--dim);font-weight:700;text-transform:uppercase;margin-bottom:8px">+ Dodaj materiał</div>
    <div style="display:flex;gap:6px;margin-bottom:8px">
      <input id="bom-search-input" type="text" placeholder="Szukaj wg opisu lub indeksu..."
        value="${state.bomSearch||''}"
        oninput="setState({bomSearch:this.value},true)"
        onkeyup="if(event.key==='Enter'||this.value.length>=3)bomSearchMat()"
        style="flex:1;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px">
      <button onclick="bomSearchMat()" style="background:var(--accent);color:#000;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px">🔍</button>
    </div>`;

  // Wyniki wyszukiwania
  if (state.bomSearching) {
    html += `<div style="font-size:12px;color:var(--dim);text-align:center;padding:8px">⏳ Szukam...</div>`;
  } else if (state.bomSearchResults.length) {
    html += `<div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">`;
    for (const m of state.bomSearchResults) {
      const dostepne = m.do_dyspozycji ?? m.stan_rzeczywisty ?? 0;
      const alreadyInBom = pozycje.some(p => p.material_id === m.id);
      html += `<div style="padding:8px 10px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:var(--panel)">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.opis}</div>
          <div style="font-size:10px;color:var(--dim)">${m.indeks} · stan: <b style="color:${dostepne>0?'var(--green)':'var(--red)'}">${dostepne.toFixed(3)} ${m.jm}</b></div>
        </div>
        <button onclick="setState({bomSelectedMat:${JSON.stringify(m).replace(/"/g,'&quot;')}});render()"
          ${alreadyInBom?'disabled title="Już w BOM"':''} 
          style="margin-left:8px;background:${alreadyInBom?'var(--border)':'var(--accent)'};color:${alreadyInBom?'var(--dim)':'#000'};border:none;border-radius:6px;padding:4px 10px;cursor:${alreadyInBom?'default':'pointer'};font-size:12px;white-space:nowrap">
          ${alreadyInBom?'✓ Dodany':'+ Wybierz'}
        </button>
      </div>`;
    }
    html += `</div>`;
  }

  // Formularz po wybraniu materiału
  const sel = state.bomSelectedMat;
  if (sel) {
    html += `<div style="background:var(--panel);border:1px solid var(--accent);border-radius:8px;padding:10px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700;margin-bottom:8px">📦 ${sel.opis} <span style="font-size:10px;color:var(--dim)">${sel.indeks}</span></div>
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div style="flex:0 0 100px">
          <div style="font-size:10px;color:var(--dim);margin-bottom:3px">Ilość (${sel.jm})</div>
          <input id="bom-qty" type="number" min="0.001" step="0.001" value="${state.bomQty||1}"
            oninput="setState({bomQty:parseFloat(this.value)||1},true)"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px;font-size:13px">
        </div>
        <div style="flex:1;min-width:120px">
          <div style="font-size:10px;color:var(--dim);margin-bottom:3px">Uwagi (opcjonalnie)</div>
          <input id="bom-uwagi" type="text" placeholder="np. gatunek, wymiar..."
            value="${state.bomUwagi||''}"
            oninput="setState({bomUwagi:this.value},true)"
            style="width:100%;background:var(--entry);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px;font-size:13px;box-sizing:border-box">
        </div>
        <button onclick="bomAddPozycja(${zlecenieId}, ${sel.id})"
          style="background:var(--green);color:#fff;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px;white-space:nowrap">✓ Dodaj do BOM</button>
        <button onclick="setState({bomSelectedMat:null})"
          style="background:var(--entry);color:var(--dim);border:1px solid var(--border);border-radius:6px;padding:6px 10px;cursor:pointer;font-size:13px">✕</button>
      </div>
    </div>`;
  }

  html += `</div></div>`; // close dodaj + outer BOM div
  return html;
}

// ──────────────────────────────────────────────────────────────
function renderFeedbackModal() {
  if (!state.feedbackModal) return '';
  return `
  <div class="modal-overlay" onclick="if(event.target===this)setState({feedbackModal:false,feedbackMsg:''})">
    <div class="modal">
      <button class="modal-close" onclick="setState({feedbackModal:false,feedbackMsg:''})">×</button>
      <h3>💬 Co brakuje w aplikacji?</h3>
      <div style="margin-bottom:14px">
        <div style="font-size:13px;color:var(--dim);margin-bottom:10px">Twoja ocena:</div>
        <div style="display:flex;gap:8px;justify-content:center">
          ${[1,2,3,4,5].map(n => `<span onclick="setState({feedbackRating:${n}})" style="font-size:34px;cursor:pointer;color:${(state.feedbackRating||0)>=n?'var(--accent)':'var(--border)'};transition:color .1s">★</span>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>Wiadomość (opcjonalnie)</label>
        <textarea id="feedback-msg" placeholder="Opisz czego brakuje lub co można poprawić..."
          style="min-height:100px"
          oninput="setState({feedbackMsg:this.value},true)">${state.feedbackMsg||''}</textarea>
      </div>
      <button class="btn btn-accent" onclick="sendFeedback(true)">📤 Wyślij opinię</button>
    </div>
  </div>`;
}

async function toggleMajsterZlecenie(zid) {
  if (state.majsterExpandedZlecenie === zid) {
    setState({majsterExpandedZlecenie: null});
    return;
  }
  setState({majsterExpandedZlecenie: zid});
  // Zawsze przeładuj przy rozwijaniu dla aktualnych danych
  try {
    const [drzewo, matsM] = await Promise.all([
      get(`/api/zlecenia/${zid}/drzewo`),
      get(`/api/zlecenia/${zid}/materialy-zlecenia`).catch(() => []),
    ]);
    if (!drzewo.materialy || drzewo.materialy.length === 0) drzewo.materialy = matsM || [];
    const newCache = {...(state.majsterOpsCache || {}), [zid]: drzewo.operacje || []};
    setState({
      majsterOpsCache: newCache,
      zlecenieDrzewa: { ...(state.zlecenieDrzewa || {}), [zid]: drzewo },
    });
  } catch(e) {
    const newCache = {...(state.majsterOpsCache || {}), [zid]: []};
    setState({majsterOpsCache: newCache});
  }
}

// ─── Helper date functions ────────────────────────────────────────────────────
function getToday() {
  return new Date().toISOString().slice(0,10);
}
function getTodayMinus(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0,10);
}

// ─── Raport PDF – Zlecenia ────────────────────────────────────────────────────
async function generateRaportSingleZlecenie(zid, numer) {
  try {
    const data = await get('/api/raporty/zlecenia?zlecenie_id=' + zid);
    const od = '', doDt = '';
    printRaportZlecenia(data, od, doDt, numer);
  } catch(e) {
    alert('Błąd generowania raportu: ' + e.message);
  }
}

async function generateRaportZleceniaPDF() {
  const od = document.getElementById('raport-od')?.value || getTodayMinus(30);
  const do_ = document.getElementById('raport-do')?.value || getToday();
  setState({raportOkres: {od, do: do_}});
  try {
    const data = await get('/api/raporty/zlecenia?data_od=' + od + '&data_do=' + do_);
    printRaportZlecenia(data, od, do_);
  } catch(e) {
    alert('Błąd generowania raportu: ' + e.message);
  }
}

// ─── Formatowanie czasu hh:mm:ss / mm:ss ──────────────────────────────────────
function fmtHMS(totalMin) {
  // Przyjmuje minuty (może być ułamkowe), zwraca mm:ss lub hh:mm:ss
  const totalSec = Math.round((totalMin || 0) * 60);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = ('0'+m).slice(-2);
  const ss = ('0'+s).slice(-2);
  if (h > 0) return ('0'+h).slice(-2) + ':' + mm + ':' + ss;
  return mm + ':' + ss;
}

function printRaportZlecenia(data, od, doDt, pojedynczeNumer) {
  const zl = data.zlecenia || [];
  const totalWartosc = zl.reduce((a,z)=>a+(z.wartosc||0),0);
  const isSingle = !!pojedynczeNumer;
  const totalKoszt   = zl.reduce((a,z)=>a+(z.koszt_total||0),0);
  const totalZysk    = zl.reduce((a,z)=>a+(z.zysk||0),0);

  const statusColor = {aktywne:'#1a73e8', zakonczone:'#1e8a4c', anulowane:'#888', wstrzymane:'#e67e00', oczekuje_potwierdzenia:'#8e44ad'};
  const fmtPLNr = v => (parseFloat(v)||0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' zł';
  const fmtMinr = v => fmtHMS(v);

  let zlHtml = '';
  zl.forEach(z => {
    const isZysk = z.zysk >= 0;
    const sesjeByOp = {};
    (z.sesje||[]).forEach(s => {
      if (!sesjeByOp[s.operacja]) sesjeByOp[s.operacja] = [];
      sesjeByOp[s.operacja].push(s);
    });
    zlHtml += `
    <div style="border:1px solid #ddd;border-radius:6px;margin-bottom:16px;overflow:hidden;break-inside:avoid">
      <div style="background:#f5f7fa;padding:10px 14px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between;align-items:center">
        <div>
          <span style="font-size:15px;font-weight:700">${z.numer}</span>
          <span style="font-size:13px;color:#555;margin-left:10px">${z.nazwa||''}</span>
        </div>
        <span style="background:${statusColor[z.status]||'#888'};color:#fff;font-size:11px;padding:2px 10px;border-radius:99px;font-weight:600">${z.status||''}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:0;border-bottom:1px solid #ddd">
        <div style="padding:8px 12px;border-right:1px solid #ddd;font-size:12px"><div style="color:#888;font-size:10px">ILOŚĆ</div>${z.ilosc_sztuk||0} szt.</div>
        <div style="padding:8px 12px;border-right:1px solid #ddd;font-size:12px"><div style="color:#888;font-size:10px">WARTOŚĆ</div>${fmtPLNr(z.wartosc)}</div>
        <div style="padding:8px 12px;border-right:1px solid #ddd;font-size:12px"><div style="color:#888;font-size:10px">KOSZT PRACY</div>${fmtPLNr(z.koszt_pracy)}</div>
        ${z.koszt_zbrojenia>0?`<div style="padding:8px 12px;border-right:1px solid #ddd;font-size:12px"><div style="color:#e67e00;font-size:10px">⚙ ZBROJENIE</div>${fmtPLNr(z.koszt_zbrojenia)}</div>`:`<div style="padding:8px 12px;border-right:1px solid #ddd;font-size:12px"><div style="color:#888;font-size:10px">KOSZT ŁĄCZNY</div>${fmtPLNr(z.koszt_total)}</div>`}
        <div style="padding:8px 12px;font-size:12px"><div style="color:#888;font-size:10px">ZYSK</div><span style="color:${isZysk?'#1e8a4c':'#c0392b'};font-weight:700">${fmtPLNr(z.zysk)}</span></div>
      </div>`;
    if (Object.keys(sesjeByOp).length) {
      zlHtml += `<div style="padding:8px 14px">
        <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:6px">Sesje pracy</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr style="background:#f5f7fa">
            <th style="padding:4px 8px;text-align:left;border:1px solid #eee">Operacja</th>
            <th style="padding:4px 8px;text-align:left;border:1px solid #eee">Pracownik</th>
            <th style="padding:4px 8px;text-align:center;border:1px solid #eee">Data</th>
            <th style="padding:4px 8px;text-align:center;border:1px solid #eee">Czas łączny</th>
            <th style="padding:4px 8px;text-align:center;border:1px solid #eee">Czas/szt.</th>
            <th style="padding:4px 8px;text-align:center;border:1px solid #eee">Szt.</th>
            <th style="padding:4px 8px;text-align:right;border:1px solid #eee">Koszt</th>
            <th style="padding:4px 8px;text-align:center;border:1px solid #eee">KJ</th>
            <th style="padding:4px 8px;text-align:left;border:1px solid #eee">Uwagi</th>
          </tr></thead><tbody>`;
      (z.sesje||[]).forEach(s => {
        const isNieprod = s.typ === 'nieprodukcyjna';
        const isInne = s.typ === 'inne_zlecenie';
        const isZbr = s.typ === 'zbrojenie';
        const isKJOnly = s._kj_only;
        // Sprawdź czy w normie: czas_norma × ilosc_sztuk vs czas_min (czas_norma w min/szt)
        const normaCalk = (!isNieprod && !isInne && !isKJOnly) ? (s.czas_norma||0) * (s.ilosc_sztuk||1) : 0;
        const wNormie = normaCalk > 0 && s.czas_min <= normaCalk;
        const przekroczone = normaCalk > 0 && s.czas_min > normaCalk;
        let rowBg = przekroczone ? 'background:#fff3f3' : wNormie ? 'background:#f3fff6' : '';
        if (isNieprod) rowBg = 'background:#f9f5ff';
        if (isInne) rowBg = 'background:#f0f7ff';
        if (isKJOnly) rowBg = s.kj_wynik === 'zgodny' ? 'background:#f0fff4' : 'background:#fff0f0';
        const normaBadge = normaCalk > 0
          ? (wNormie
              ? `<span style="color:#1e8a4c;font-weight:700;font-size:10px">✓ OK</span>`
              : `<span style="color:#c0392b;font-weight:700;font-size:10px">⚠ PRZEKR.</span>`)
          : '';
        const typBadge = isNieprod
          ? `<span style="font-size:9px;background:#9b59b6;color:#fff;padding:1px 5px;border-radius:3px;margin-left:4px">NIEPRODUKCYJNA</span>`
          : isInne
          ? `<span style="font-size:9px;background:#2980b9;color:#fff;padding:1px 5px;border-radius:3px;margin-left:4px">INNE ZLECENIE</span>`
          : isZbr
          ? `<span style="font-size:9px;background:#e67e00;color:#fff;padding:1px 5px;border-radius:3px;margin-left:4px">ZBROJENIE</span>`
          : isKJOnly
          ? `<span style="font-size:9px;background:#3498db;color:#fff;padding:1px 5px;border-radius:3px;margin-left:4px">KJ</span>`
          : '';
        const opNazwa = s.operacja || (isNieprod ? '⏸ Praca nieprodukcyjna' : isInne ? '🔧 Inne zlecenie' : '—');
        const sztuk = s.ilosc_sztuk || 1;
        const avgMinVal = (!isNieprod && !isKJOnly && sztuk > 0) ? s.czas_min / sztuk : s.czas_min;
        const totalHMS = isKJOnly ? '—' : fmtHMS(s.czas_min);
        const normaTotalHMS = normaCalk > 0 ? fmtHMS(normaCalk) : null;
        const avgHMS = isKJOnly ? '—' : fmtHMS(avgMinVal);
        const normaPieceFmt = normaCalk > 0 ? fmtHMS(s.czas_norma||0) : null;
        // KJ badge w kolumnie KJ
        let kjCellHtml = '—';
        if (s.kj_wynik === 'zgodny') {
          kjCellHtml = `<span style="color:#1e8a4c;font-weight:700;font-size:10px">✅ ZGODNY</span>${s.kj_user_name?`<br><span style="color:#888;font-size:9px">${s.kj_user_name}</span>`:''}${s.kj_data?`<br><span style="color:#888;font-size:9px">${s.kj_data}</span>`:''}`;
        } else if (s.kj_wynik === 'niezgodny') {
          kjCellHtml = `<span style="color:#c0392b;font-weight:700;font-size:10px">❌ NIEZGODNY</span>${s.kj_user_name?`<br><span style="color:#888;font-size:9px">${s.kj_user_name}</span>`:''}${s.kj_data?`<br><span style="color:#888;font-size:9px">${s.kj_data}</span>`:''}`;
        }
        zlHtml += `<tr style="${rowBg}">
          <td style="padding:3px 8px;border:1px solid #eee">${opNazwa}${typBadge} ${normaBadge}</td>
          <td style="padding:3px 8px;border:1px solid #eee">${isKJOnly ? (s.kj_user_name||'KJ') : (s.pracownik||'—')}</td>
          <td style="padding:3px 8px;border:1px solid #eee;text-align:center">${isKJOnly ? (s.kj_data||'—') : (s.data||'—')}</td>
          <td style="padding:3px 8px;border:1px solid #eee;text-align:center;font-family:monospace;color:${przekroczone?'#c0392b':wNormie?'#1e8a4c':'inherit'};font-weight:${przekroczone||wNormie?'700':'400'}">${totalHMS}${normaTotalHMS?' / norma: '+normaTotalHMS:''}</td>
          <td style="padding:3px 8px;border:1px solid #eee;text-align:center;font-family:monospace;color:#555">${isNieprod || isKJOnly ? '—' : avgHMS}${normaPieceFmt&&!isNieprod&&!isKJOnly?' <span style="color:#aaa;font-size:9px">/ '+normaPieceFmt+'</span>':''}</td>
          <td style="padding:3px 8px;border:1px solid #eee;text-align:center">${isNieprod || isKJOnly ? '—' : (s.ilosc_sztuk||0)}</td>
          <td style="padding:3px 8px;border:1px solid #eee;text-align:right">${isKJOnly ? '—' : fmtPLNr(s.koszt)}</td>
          <td style="padding:3px 8px;border:1px solid #eee;text-align:center;line-height:1.4">${kjCellHtml}</td>
          <td style="padding:3px 8px;border:1px solid #eee;color:#555;font-style:italic">${s.uwagi||'—'}</td>
        </tr>`;
      });
      zlHtml += `</tbody></table></div>`;
    }
    if (z.produkty && z.produkty.length) {
      zlHtml += `<div style="padding:6px 14px 10px">
        <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:4px">Produkty / Zakupy</div>`;
      z.produkty.forEach(p => {
        zlHtml += `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;border-bottom:1px solid #f0f0f0">
          <span>${p.nazwa}</span><span style="color:#888">${p.ilosc} szt. × ${fmtPLNr(p.cena)} = <b>${fmtPLNr(p.ilosc*p.cena)}</b></span></div>`;
      });
      zlHtml += `</div>`;
    }
    zlHtml += `</div>`;
  });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Raport zleceń ${od} – ${doDt}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; color: #222; }
    @media print { body { padding: 0; } }
  </style>
  </head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #222;padding-bottom:10px;margin-bottom:18px">
    <div>
      <div style="font-size:22px;font-weight:700">Raport zleceń produkcyjnych</div>
      <div style="font-size:13px;color:#555">Okres: ${od} – ${doDt} | Wygenerowano: ${new Date().toLocaleString('pl-PL')}</div>
    </div>
    <div style="text-align:right;font-size:13px">
      <div>Zleceń: <b>${zl.length}</b></div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
    <div style="background:#f5f7fa;border-radius:6px;padding:12px;text-align:center">
      <div style="font-size:11px;color:#888;text-transform:uppercase">Łączna wartość</div>
      <div style="font-size:20px;font-weight:700;color:#1a73e8">${fmtPLNr(totalWartosc)}</div>
    </div>
    <div style="background:#f5f7fa;border-radius:6px;padding:12px;text-align:center">
      <div style="font-size:11px;color:#888;text-transform:uppercase">Łączne koszty</div>
      <div style="font-size:20px;font-weight:700;color:#e67e00">${fmtPLNr(totalKoszt)}</div>
    </div>
    <div style="background:#f5f7fa;border-radius:6px;padding:12px;text-align:center">
      <div style="font-size:11px;color:#888;text-transform:uppercase">Łączny zysk</div>
      <div style="font-size:20px;font-weight:700;color:${totalZysk>=0?'#1e8a4c':'#c0392b'}">${fmtPLNr(totalZysk)}</div>
    </div>
  </div>
  ${zlHtml}
  </body></html>`;

  const w = window.open('','_blank','width=900,height=700');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 600);
}

// ─── Raport PDF – Wydajność pracowników ──────────────────────────────────────
async function generateRaportWydajnoscPDF() {
  const od = document.getElementById('rwd-od')?.value || getTodayMinus(7);
  const do_ = document.getElementById('rwd-do')?.value || getToday();
  const typ = document.getElementById('rwd-typ')?.value || 'skrocony';
  setState({raportWydOkres:{od,do:do_}, raportWydTyp:typ});
  try {
    const data = await get('/api/stats/wydajnosc_raport?data_od=' + od + '&data_do=' + do_);
    printRaportWydajnosc(data, od, do_, typ);
  } catch(e) {
    alert('Błąd generowania raportu: ' + e.message);
  }
}

function printRaportWydajnosc(data, od, doDt, typ) {
  const pr = data.pracownicy || [];
  const ZMIANA_MIN = 450;
  const fmtPLNr = v => (parseFloat(v)||0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' zł';

  // ── Pomocnicze: oblicz efektywność dla zbioru sesji ──────────────────────────
  function calcEfekt(p) {
    const efektNormy = p.norma_wydajnosc_pct !== null && p.norma_wydajnosc_pct !== undefined
      ? p.norma_wydajnosc_pct : null;
    const normy_ok = p.normy_ok || 0;
    const normy_total = p.normy_total || 0;
    const razem = (p.min_roboczy||0) + (p.min_zbrojenie||0) + (p.min_nieproduktywny||0);
    const efektCzas = razem > 0 ? Math.round((p.min_roboczy||0) / razem * 100) : null;
    const efekt = efektNormy !== null ? efektNormy
                : normy_total > 0 ? Math.round(normy_ok / normy_total * 100)
                : efektCzas !== null ? efektCzas : 0;
    const hasNorma = efektNormy !== null;
    const label = hasNorma
      ? efekt + '% norm (' + Math.round(p.suma_norma_min||0) + '/' + Math.round(p.suma_fakty_min||0) + ' min)'
      : normy_total > 0 ? Math.round(normy_ok/normy_total*100) + '% norm'
      : efektCzas !== null ? efekt + '% czasu' : '—';
    const kolor = efekt >= 80 ? '#1e8a4c' : efekt >= 60 ? '#e67e00' : '#c0392b';
    return {efekt, label, kolor};
  }

  // ── Zbierz wszystkie unikalne daty z sesji pracowników ──────────────────────
  const allDates = new Set();
  pr.forEach(p => (p.sesje||[]).forEach(s => { if (s.data) allDates.add(s.data); }));
  const sortedDates = Array.from(allDates).sort();

  // ── Dla każdego pracownika i każdej daty oblicz agregaty ────────────────────
  // dayStats[data][user_id] = {min_roboczy, min_zbrojenie, min_nieproduktywny, norma_min, fakty_min, sesje}
  const dayStats = {};
  sortedDates.forEach(d => { dayStats[d] = {}; });
  pr.forEach(p => {
    (p.sesje||[]).forEach(s => {
      const d = s.data;
      if (!d) return;
      if (!dayStats[d][p.user_id]) {
        dayStats[d][p.user_id] = {
          full_name: p.full_name, min_roboczy:0, min_zbrojenie:0,
          min_nieproduktywny:0, norma_min:0, fakty_min:0, sesje:[],
          koszt_pracy:0, koszt_zbrojenia:0
        };
      }
      const ds = dayStats[d][p.user_id];
      const m = parseFloat(s.czas_min) || 0;
      if (s.typ === 'zbrojenie') { ds.min_zbrojenie += m; ds.koszt_zbrojenia += (parseFloat(s.koszt)||0); }
      else if (s.typ === 'nieprodukcyjna') ds.min_nieproduktywny += m;
      else { ds.min_roboczy += m; ds.koszt_pracy += (parseFloat(s.koszt)||0); }
      if (s.norma_min && s.norma_min > 0 && s.typ !== 'zbrojenie' && s.sesja_glowna !== 0) {
        ds.norma_min += (s.norma_min * (s.ilosc_sztuk || 1));
        ds.fakty_min += m;
      }
      ds.sesje.push(s);
    });
  });

  function fmtDatePL(d) {
    if (!d) return d;
    const [y,m,dd] = d.split('-');
    const dni = ['niedziela','poniedziałek','wtorek','środa','czwartek','piątek','sobota'];
    const dow = new Date(d).getDay();
    return `${parseInt(dd,10)}.${parseInt(m,10)}.${y} (${dni[dow]})`;
  }

  // ── Buduj HTML raportu ───────────────────────────────────────────────────────
  let tabelaHtml = '';

  // ────── Sekcje dzienne ──────────────────────────────────────────────────────
  sortedDates.forEach(date => {
    const dzienPracownicy = pr.filter(p => dayStats[date][p.user_id]);
    if (!dzienPracownicy.length) return;

    tabelaHtml += `
    <div style="margin-bottom:4px;margin-top:20px;page-break-inside:avoid">
      <div style="background:#2e3548;color:#fff;padding:8px 14px;border-radius:6px 6px 0 0;font-size:14px;font-weight:700">
        📅 ${fmtDatePL(date)}
      </div>`;

    if (typ === 'skrocony') {
      tabelaHtml += `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#3d4a63;color:#fff">
          <th style="padding:7px 10px;text-align:left">Pracownik</th>
          <th style="padding:7px 10px;text-align:center">Roboczy (min)</th>
          <th style="padding:7px 10px;text-align:center">Zbrojenie (min)</th>
          <th style="padding:7px 10px;text-align:center">Nieprodukt. (min)</th>
          <th style="padding:7px 10px;text-align:center">Razem (min)</th>
          <th style="padding:7px 10px;text-align:center">Zmian</th>
          <th style="padding:7px 10px;text-align:center">Efektywność</th>
        </tr></thead><tbody>`;
      dzienPracownicy.forEach((p, i) => {
        const ds = dayStats[date][p.user_id];
        const razem = ds.min_roboczy + ds.min_zbrojenie + ds.min_nieproduktywny;
        const zmiany = razem > 0 ? (razem / ZMIANA_MIN).toFixed(2) : '0';
        const efPct = ds.fakty_min > 0 ? Math.round(ds.norma_min / ds.fakty_min * 100) : null;
        const efLabel = efPct !== null ? efPct + '% norm' : (razem > 0 ? Math.round(ds.min_roboczy/razem*100) + '% czasu' : '—');
        const efVal = efPct !== null ? efPct : (razem > 0 ? Math.round(ds.min_roboczy/razem*100) : 0);
        const efKolor = efVal >= 80 ? '#1e8a4c' : efVal >= 60 ? '#e67e00' : '#c0392b';
        tabelaHtml += `<tr style="background:${i%2?'#fff':'#f9fafb'}">
          <td style="padding:6px 10px;border:1px solid #e0e0e0;font-weight:600">${p.full_name}</td>
          <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center;color:#1a73e8">${Math.round(ds.min_roboczy)}</td>
          <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center;color:#e67e00">${Math.round(ds.min_zbrojenie)}</td>
          <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center;color:#888">${Math.round(ds.min_nieproduktywny)}</td>
          <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center;font-weight:700">${Math.round(razem)}</td>
          <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center">${zmiany}</td>
          <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center;font-weight:700;color:${efKolor}">${efLabel}</td>
        </tr>`;
      });
      tabelaHtml += `</tbody></table>`;
    } else if (typ === 'zarobki') {
      // ZAROBKI – zestawienie per zlecenie: przychód - koszty = marża
      // Przychód liczony od FAKTYCZNIE WYKONANEJ ilości (ostatnia operacja produkcyjna
      // zlecenia danego dnia), a nie od całej zleconej ilości sztuk.
      // Zbierz sesje tego dnia ze wszystkich pracowników
      const zlecMap = {}; // zlecenie_id -> {numer, cena_szt, wykonano, koszt_pracy, koszt_zbrojenia}
      dzienPracownicy.forEach(p => {
        const ds = dayStats[date][p.user_id];
        if (!ds) return;
        ds.sesje.forEach(s => {
          if (!s.zlecenie_id || !s.zl_numer || s.zl_numer === '—') return;
          if (s.typ === 'nieprodukcyjna') return;
          const zid = s.zlecenie_id;
          if (!zlecMap[zid]) {
            zlecMap[zid] = {
              id: zid,
              numer: s.zl_numer,
              cena_szt: s.cena_brutto_szt || 0,
              wykonano: 0,
              koszt_pracy: 0,
              koszt_zbrojenia: 0,
            };
          }
          if (s.typ === 'zbrojenie') zlecMap[zid].koszt_zbrojenia += (parseFloat(s.koszt)||0);
          else zlecMap[zid].koszt_pracy += (parseFloat(s.koszt)||0);
          // Faktycznie wykonana ilość – tylko sesje ostatniej operacji produkcyjnej
          if (s.jest_ostatnia_operacja) zlecMap[zid].wykonano += (s.ilosc_sztuk || 0);
        });
      });
      // Zbuduj mapę: zlecenie_id -> lista pracowników z kosztami
      const zlecPracMap = {}; // zlecenie_id -> [{imie, koszt_pracy, koszt_zbrojenia}]
      dzienPracownicy.forEach(p => {
        const ds = dayStats[date][p.user_id];
        if (!ds) return;
        ds.sesje.forEach(s => {
          if (!s.zlecenie_id || !s.zl_numer || s.zl_numer === '—') return;
          if (s.typ === 'nieprodukcyjna') return;
          const zid = s.zlecenie_id;
          if (!zlecPracMap[zid]) zlecPracMap[zid] = {};
          if (!zlecPracMap[zid][p.user_id]) zlecPracMap[zid][p.user_id] = { imie: p.full_name || p.imie || p.login || ('ID:'+p.user_id), koszt_pracy: 0, koszt_zbrojenia: 0 };
          if (s.typ === 'zbrojenie') zlecPracMap[zid][p.user_id].koszt_zbrojenia += (parseFloat(s.koszt)||0);
          else zlecPracMap[zid][p.user_id].koszt_pracy += (parseFloat(s.koszt)||0);
        });
      });

      const zlecList = Object.values(zlecMap).sort((a,b) => a.numer.localeCompare(b.numer));
      if (!zlecList.length) {
        tabelaHtml += `<div style="color:#888;font-size:12px;padding:12px">Brak danych o zleceniach w tym dniu.</div>`;
      } else {
        tabelaHtml += `
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#3d4a63;color:#fff">
            <th style="padding:7px 10px;text-align:left">Zlecenie</th>
            <th style="padding:7px 10px;text-align:center">Cena/szt</th>
            <th style="padding:7px 10px;text-align:center">Wykonano</th>
            <th style="padding:7px 10px;text-align:center">Przychód</th>
            <th style="padding:7px 10px;text-align:center">Koszt pracy</th>
            <th style="padding:7px 10px;text-align:center">Koszt zbrojenia</th>
            <th style="padding:7px 10px;text-align:center;background:#1e3a1e">Marża</th>
          </tr></thead><tbody>`;
        let dzienPrzychod = 0, dzienKoszt = 0, dzienMarza = 0;
        zlecList.forEach((z, i) => {
          const przychod = z.cena_szt * z.wykonano;
          const koszt = z.koszt_pracy + z.koszt_zbrojenia;
          const marza = przychod - koszt;
          const marzaKolor = marza >= 0 ? '#1e8a4c' : '#c0392b';
          dzienPrzychod += przychod; dzienKoszt += koszt; dzienMarza += marza;
          tabelaHtml += `<tr style="background:${i%2?'#fff':'#f9fafb'}">
            <td style="padding:6px 10px;border:1px solid #e0e0e0;font-weight:600">${z.numer}</td>
            <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center">${fmtPLNr(z.cena_szt)}</td>
            <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center">${z.wykonano}</td>
            <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center;color:#1a73e8;font-weight:600">${fmtPLNr(przychod)}</td>
            <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center;color:#e67e00">${fmtPLNr(z.koszt_pracy)}</td>
            <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center;color:#e67e00">${fmtPLNr(z.koszt_zbrojenia)}</td>
            <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center;font-weight:700;color:${marzaKolor}">${fmtPLNr(marza)}</td>
          </tr>`;
          // Udział pracowników w zleceniu
          const pracZlec = Object.values(zlecPracMap[z.id] || {});
          if (pracZlec.length > 0) {
            const totalKoszt = koszt || 1; // unikaj dzielenia przez 0
            pracZlec.sort((a,b) => (b.koszt_pracy+b.koszt_zbrojenia) - (a.koszt_pracy+a.koszt_zbrojenia));
            tabelaHtml += `<tr style="background:#f0f4ff">
              <td colspan="7" style="padding:4px 10px 4px 24px;border:1px solid #e0e0e0">
                <table style="width:100%;border-collapse:collapse;font-size:11px">
                  <thead><tr style="color:#475569">
                    <th style="text-align:left;padding:2px 6px;font-weight:600">👷 Pracownik</th>
                    <th style="text-align:center;padding:2px 6px;font-weight:600">Koszt pracy</th>
                    <th style="text-align:center;padding:2px 6px;font-weight:600">Koszt zbrojenia</th>
                    <th style="text-align:center;padding:2px 6px;font-weight:600">Razem koszt</th>
                    <th style="text-align:center;padding:2px 6px;font-weight:600">Udział %</th>
                  </tr></thead><tbody>
                  ${pracZlec.map(pw => {
                    const kRazem = pw.koszt_pracy + pw.koszt_zbrojenia;
                    const udzial = totalKoszt > 0 ? ((kRazem / totalKoszt) * 100).toFixed(1) : '0.0';
                    return `<tr>
                      <td style="padding:2px 6px;color:#334155">${pw.imie}</td>
                      <td style="padding:2px 6px;text-align:center;color:#e67e00">${fmtPLNr(pw.koszt_pracy)}</td>
                      <td style="padding:2px 6px;text-align:center;color:#e67e00">${fmtPLNr(pw.koszt_zbrojenia)}</td>
                      <td style="padding:2px 6px;text-align:center;font-weight:600;color:#c0392b">${fmtPLNr(kRazem)}</td>
                      <td style="padding:2px 6px;text-align:center;color:#475569">${udzial}%</td>
                    </tr>`;
                  }).join('')}
                  </tbody>
                </table>
              </td>
            </tr>`;
          }
        });
        const dzienMarzaKol = dzienMarza >= 0 ? '#1e8a4c' : '#c0392b';
        tabelaHtml += `<tr style="background:#eef3ff;font-weight:700">
          <td style="padding:6px 10px;border:1px solid #e0e0e0" colspan="3">Razem za dzień</td>
          <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center;color:#1a73e8">${fmtPLNr(dzienPrzychod)}</td>
          <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center;color:#e67e00" colspan="2">${fmtPLNr(dzienKoszt)}</td>
          <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center;font-weight:700;color:${dzienMarzaKol}">${fmtPLNr(dzienMarza)}</td>
        </tr>`;
        tabelaHtml += `</tbody></table>`;
      }
    } else if (typ === 'zarobki_pracownicy') {
      // ZAROBKI PRACOWNIKÓW – ile każdy pracownik zarobił danego dnia
      tabelaHtml += `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#3d4a63;color:#fff">
          <th style="padding:7px 10px;text-align:left">Pracownik</th>
          <th style="padding:7px 10px;text-align:center">Zarobek za pracę</th>
          <th style="padding:7px 10px;text-align:center">Zarobek za zbrojenie</th>
          <th style="padding:7px 10px;text-align:center;background:#1e3a1e">Zarobek razem</th>
        </tr></thead><tbody>`;
      let dzienZarobek = 0, dzienZarobekPracy = 0, dzienZarobekZbr = 0;
      dzienPracownicy.forEach((p, i) => {
        const ds = dayStats[date][p.user_id];
        const zarobek = ds.koszt_pracy + ds.koszt_zbrojenia;
        dzienZarobek += zarobek; dzienZarobekPracy += ds.koszt_pracy; dzienZarobekZbr += ds.koszt_zbrojenia;
        tabelaHtml += `<tr style="background:${i%2?'#fff':'#f9fafb'}">
          <td style="padding:6px 10px;border:1px solid #e0e0e0;font-weight:600">${p.full_name}</td>
          <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center">${fmtPLNr(ds.koszt_pracy)}</td>
          <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center">${fmtPLNr(ds.koszt_zbrojenia)}</td>
          <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center;font-weight:700;color:#1e8a4c">${fmtPLNr(zarobek)}</td>
        </tr>`;
      });
      tabelaHtml += `<tr style="background:#eef3ff;font-weight:700">
        <td style="padding:6px 10px;border:1px solid #e0e0e0">Razem za dzień</td>
        <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center">${fmtPLNr(dzienZarobekPracy)}</td>
        <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center">${fmtPLNr(dzienZarobekZbr)}</td>
        <td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center;color:#1e8a4c">${fmtPLNr(dzienZarobek)}</td>
      </tr>`;
      tabelaHtml += `</tbody></table>`;
    } else {
      // PEŁNY – każdy pracownik z rozpiską sesji dla tego dnia
      dzienPracownicy.forEach(p => {
        const ds = dayStats[date][p.user_id];
        const razem = ds.min_roboczy + ds.min_zbrojenie + ds.min_nieproduktywny;
        const zmiany = razem > 0 ? (razem / ZMIANA_MIN).toFixed(2) : '0';
        const efPct = ds.fakty_min > 0 ? Math.round(ds.norma_min / ds.fakty_min * 100) : null;
        const efLabel = efPct !== null ? efPct + '% norm' : (razem > 0 ? Math.round(ds.min_roboczy/razem*100) + '% czasu' : '—');
        const efVal = efPct !== null ? efPct : (razem > 0 ? Math.round(ds.min_roboczy/razem*100) : 0);
        const efKolor = efVal >= 80 ? '#1e8a4c' : efVal >= 60 ? '#e67e00' : '#c0392b';
        tabelaHtml += `
        <div style="border:1px solid #ddd;margin-bottom:10px;break-inside:avoid;overflow:hidden">
          <div style="background:#4a5568;color:#fff;padding:6px 12px;display:flex;justify-content:space-between;align-items:center">
            <span style="font-weight:700;font-size:13px">${p.full_name}</span>
            <span style="font-size:11px">${Math.round(razem)} min | ${zmiany} zmian | efektywność: <b style="color:${efKolor}">${efLabel}</b></span>
          </div>`;
        if (ds.sesje.length) {
          tabelaHtml += `<table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr style="background:#f5f7fa">
              <th style="padding:4px 8px;text-align:left;border:1px solid #eee">Operacja / Typ</th>
              <th style="padding:4px 8px;text-align:left;border:1px solid #eee">Zlecenie</th>
              <th style="padding:4px 8px;text-align:center;border:1px solid #eee">Czas/szt.</th>
              <th style="padding:4px 8px;text-align:center;border:1px solid #eee">Czas łączny</th>
              <th style="padding:4px 8px;text-align:center;border:1px solid #eee">Szt.</th>
            </tr></thead><tbody>`;
          ds.sesje.forEach((s, i) => {
            const sztuk = s.ilosc_sztuk || 1;
            const avgHMS = fmtHMS(parseFloat(s.czas_min) / sztuk);
            const totalHMS = fmtHMS(parseFloat(s.czas_min));
            const isNieprod = s.typ === 'nieprodukcyjna';
            const isInne = s.typ === 'inne_zlecenie';
            const isZbr = s.typ === 'zbrojenie';
            const rowBg = isNieprod ? '#f5f0ff' : isInne ? '#f0f7ff' : (i%2?'#fff':'#f9fafb');
            const typBadge = isNieprod
              ? `<span style="font-size:9px;background:#9b59b6;color:#fff;padding:1px 5px;border-radius:3px;margin-left:4px">NIEPRODUKCYJNA</span>`
              : isInne ? `<span style="font-size:9px;background:#2980b9;color:#fff;padding:1px 5px;border-radius:3px;margin-left:4px">INNE ZLECENIE</span>`
              : isZbr ? `<span style="font-size:9px;background:#e67e00;color:#fff;padding:1px 5px;border-radius:3px;margin-left:4px">ZBROJENIE</span>` : '';
            const opNazwa = s.op_nazwa || (isNieprod ? '⏸ Praca nieprodukcyjna' : isInne ? '🔧 Inne zlecenie' : '—');
            tabelaHtml += `<tr style="background:${rowBg}">
              <td style="padding:3px 8px;border:1px solid #eee">${opNazwa}${typBadge}</td>
              <td style="padding:3px 8px;border:1px solid #eee">${isNieprod ? '—' : (s.zl_numer||'—')}</td>
              <td style="padding:3px 8px;border:1px solid #eee;text-align:center;font-family:monospace">${isNieprod ? totalHMS : avgHMS}</td>
              <td style="padding:3px 8px;border:1px solid #eee;text-align:center;font-family:monospace;color:#888">${isNieprod ? '—' : totalHMS}</td>
              <td style="padding:3px 8px;border:1px solid #eee;text-align:center">${isNieprod ? '—' : (s.ilosc_sztuk||'—')}</td>
            </tr>`;
          });
          tabelaHtml += `</tbody></table>`;
        }
        tabelaHtml += `</div>`;
      });
    }

    tabelaHtml += `</div>`; // koniec sekcji dnia
  });

  // ────── Tabelka podsumowania: pracownicy × dni ──────────────────────────────
  if (sortedDates.length > 0 && pr.length > 0) {
    const tytulPodsum = typ === 'zarobki'
      ? `💰 Podsumowanie marży — ${od} – ${doDt}`
      : typ === 'zarobki_pracownicy'
      ? `💵 Podsumowanie zarobków pracowników — ${od} – ${doDt}`
      : `📊 Podsumowanie wydajności — ${od} – ${doDt}`;
    tabelaHtml += `
    <div style="margin-top:30px;page-break-before:auto">
      <div style="background:#1a2233;color:#fff;padding:9px 14px;border-radius:6px 6px 0 0;font-size:14px;font-weight:700">
        ${tytulPodsum}
      </div>`;

    if (typ === 'zarobki') {
      // Podsumowanie: per zlecenie przez cały okres
      // Przychód liczony od FAKTYCZNIE WYKONANEJ ilości (ostatnia operacja produkcyjna)
      const zlecTotals = {}; // zlecenie_id -> {numer, cena_szt, wykonano, koszt_pracy, koszt_zbrojenia}
      pr.forEach(p => {
        (p.sesje||[]).forEach(s => {
          if (!s.zlecenie_id || !s.zl_numer || s.zl_numer === '—') return;
          if (s.typ === 'nieprodukcyjna') return;
          const zid = s.zlecenie_id;
          if (!zlecTotals[zid]) {
            zlecTotals[zid] = {numer:s.zl_numer, cena_szt:s.cena_brutto_szt||0, wykonano:0, koszt_pracy:0, koszt_zbrojenia:0};
          }
          if (s.typ === 'zbrojenie') zlecTotals[zid].koszt_zbrojenia += (parseFloat(s.koszt)||0);
          else zlecTotals[zid].koszt_pracy += (parseFloat(s.koszt)||0);
          if (s.jest_ostatnia_operacja) zlecTotals[zid].wykonano += (s.ilosc_sztuk || 0);
        });
      });
      // Zbuduj globalną mapę pracownicy per zlecenie
      const zlecPracTotals = {}; // zlecenie_id -> {user_id -> {imie, koszt_pracy, koszt_zbrojenia}}
      pr.forEach(p => {
        (p.sesje||[]).forEach(s => {
          if (!s.zlecenie_id || !s.zl_numer || s.zl_numer === '—') return;
          if (s.typ === 'nieprodukcyjna') return;
          const zid = s.zlecenie_id;
          if (!zlecPracTotals[zid]) zlecPracTotals[zid] = {};
          if (!zlecPracTotals[zid][p.user_id]) zlecPracTotals[zid][p.user_id] = { imie: p.full_name || p.imie || p.login || ('ID:'+p.user_id), koszt_pracy: 0, koszt_zbrojenia: 0 };
          if (s.typ === 'zbrojenie') zlecPracTotals[zid][p.user_id].koszt_zbrojenia += (parseFloat(s.koszt)||0);
          else zlecPracTotals[zid][p.user_id].koszt_pracy += (parseFloat(s.koszt)||0);
        });
      });

      const zlecArr = Object.entries(zlecTotals).sort((a,b) => a[1].numer.localeCompare(b[1].numer));
      let gPrzychod=0, gKoszt=0, gMarza=0;
      tabelaHtml += `
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="background:#2e3548;color:#fff">
          <th style="padding:7px 10px;text-align:left;border:1px solid #3d4a63">Zlecenie</th>
          <th style="padding:7px 6px;text-align:center;border:1px solid #3d4a63">Cena/szt</th>
          <th style="padding:7px 6px;text-align:center;border:1px solid #3d4a63">Wykonano</th>
          <th style="padding:7px 6px;text-align:center;border:1px solid #3d4a63">Przychód</th>
          <th style="padding:7px 6px;text-align:center;border:1px solid #3d4a63">Koszty pracy</th>
          <th style="padding:7px 6px;text-align:center;border:1px solid #3d4a63;background:#1e3a1e">Marża</th>
        </tr></thead><tbody>`;
      zlecArr.forEach(([zid, z], i) => {
        const przychod = z.cena_szt * z.wykonano;
        const koszt = z.koszt_pracy + z.koszt_zbrojenia;
        const marza = przychod - koszt;
        const marzaKol = marza >= 0 ? '#1e8a4c' : '#c0392b';
        gPrzychod += przychod; gKoszt += koszt; gMarza += marza;
        tabelaHtml += `<tr style="background:${i%2?'#fff':'#f9fafb'}">
          <td style="padding:6px 10px;border:1px solid #e0e0e0;font-weight:600">${z.numer}</td>
          <td style="padding:6px 6px;border:1px solid #e0e0e0;text-align:center">${fmtPLNr(z.cena_szt)}</td>
          <td style="padding:6px 6px;border:1px solid #e0e0e0;text-align:center">${z.wykonano}</td>
          <td style="padding:6px 6px;border:1px solid #e0e0e0;text-align:center;color:#1a73e8;font-weight:600">${fmtPLNr(przychod)}</td>
          <td style="padding:6px 6px;border:1px solid #e0e0e0;text-align:center;color:#e67e00">${fmtPLNr(koszt)}</td>
          <td style="padding:6px 6px;border:1px solid #e0e0e0;text-align:center;font-weight:700;color:${marzaKol}">${fmtPLNr(marza)}</td>
        </tr>`;
        // Udział pracowników w zleceniu (globalny)
        const pracZlec = Object.values(zlecPracTotals[zid] || {});
        if (pracZlec.length > 0) {
          const totalKoszt = koszt || 1;
          pracZlec.sort((a,b) => (b.koszt_pracy+b.koszt_zbrojenia) - (a.koszt_pracy+a.koszt_zbrojenia));
          tabelaHtml += `<tr style="background:#f0f4ff">
            <td colspan="6" style="padding:3px 10px 3px 20px;border:1px solid #e0e0e0">
              <table style="width:100%;border-collapse:collapse;font-size:10px">
                <thead><tr style="color:#475569">
                  <th style="text-align:left;padding:2px 6px;font-weight:600">👷 Pracownik</th>
                  <th style="text-align:center;padding:2px 6px;font-weight:600">Koszt pracy</th>
                  <th style="text-align:center;padding:2px 6px;font-weight:600">Koszt zbrojenia</th>
                  <th style="text-align:center;padding:2px 6px;font-weight:600">Razem</th>
                  <th style="text-align:center;padding:2px 6px;font-weight:600">Udział %</th>
                </tr></thead><tbody>
                ${pracZlec.map(pw => {
                  const kRazem = pw.koszt_pracy + pw.koszt_zbrojenia;
                  const udzial = totalKoszt > 0 ? ((kRazem / totalKoszt) * 100).toFixed(1) : '0.0';
                  return `<tr>
                    <td style="padding:2px 6px;color:#334155">${pw.imie}</td>
                    <td style="padding:2px 6px;text-align:center;color:#e67e00">${fmtPLNr(pw.koszt_pracy)}</td>
                    <td style="padding:2px 6px;text-align:center;color:#e67e00">${fmtPLNr(pw.koszt_zbrojenia)}</td>
                    <td style="padding:2px 6px;text-align:center;font-weight:600;color:#c0392b">${fmtPLNr(kRazem)}</td>
                    <td style="padding:2px 6px;text-align:center;color:#475569">${udzial}%</td>
                  </tr>`;
                }).join('')}
                </tbody>
              </table>
            </td>
          </tr>`;
        }
      });
      const gMarzaKol = gMarza >= 0 ? '#1e8a4c' : '#c0392b';
      tabelaHtml += `<tr style="background:#1a2233;color:#fff;font-weight:700">
        <td style="padding:7px 10px;border:1px solid #3d4a63" colspan="3">RAZEM</td>
        <td style="padding:7px 6px;border:1px solid #3d4a63;text-align:center">${fmtPLNr(gPrzychod)}</td>
        <td style="padding:7px 6px;border:1px solid #3d4a63;text-align:center">${fmtPLNr(gKoszt)}</td>
        <td style="padding:7px 6px;border:1px solid #3d4a63;text-align:center;color:${gMarzaKol}">${fmtPLNr(gMarza)}</td>
      </tr>`;
      tabelaHtml += `</tbody></table>`;
    } else if (typ === 'zarobki_pracownicy') {
      // Tabela zarobków: pracownicy × dni
      tabelaHtml += `
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="background:#2e3548;color:#fff">
          <th style="padding:7px 10px;text-align:left;border:1px solid #3d4a63;min-width:120px">Pracownik</th>`;
      sortedDates.forEach(d => {
        const [y,m,dd] = d.split('-');
        tabelaHtml += `<th style="padding:7px 6px;text-align:center;border:1px solid #3d4a63;min-width:68px">${parseInt(dd,10)}.${parseInt(m,10)}</th>`;
      });
      tabelaHtml += `<th style="padding:7px 10px;text-align:center;border:1px solid #3d4a63;background:#1e3a1e">Łącznie</th>
        </tr></thead><tbody>`;
      let sumaWszyscy = 0;
      const sumaDniWszyscy = {}; sortedDates.forEach(d => sumaDniWszyscy[d] = 0);
      pr.forEach((p, pi) => {
        let totalZarobek = 0;
        tabelaHtml += `<tr style="background:${pi%2?'#fff':'#f9fafb'}">
          <td style="padding:6px 10px;border:1px solid #e0e0e0;font-weight:600">${p.full_name}</td>`;
        sortedDates.forEach(d => {
          const ds = dayStats[d][p.user_id];
          if (!ds) {
            tabelaHtml += `<td style="padding:6px 6px;border:1px solid #e0e0e0;text-align:center;color:#bbb">—</td>`;
          } else {
            const zarobek = ds.koszt_pracy + ds.koszt_zbrojenia;
            totalZarobek += zarobek;
            sumaDniWszyscy[d] += zarobek;
            tabelaHtml += `<td style="padding:6px 6px;border:1px solid #e0e0e0;text-align:center">${fmtPLNr(zarobek)}</td>`;
          }
        });
        sumaWszyscy += totalZarobek;
        tabelaHtml += `<td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center;font-weight:700;background:#eafaf0;color:#1e8a4c">${fmtPLNr(totalZarobek)}</td></tr>`;
      });
      tabelaHtml += `<tr style="background:#1a2233;color:#fff;font-weight:700">
        <td style="padding:7px 10px;border:1px solid #3d4a63">RAZEM</td>`;
      sortedDates.forEach(d => {
        tabelaHtml += `<td style="padding:7px 6px;border:1px solid #3d4a63;text-align:center">${fmtPLNr(sumaDniWszyscy[d])}</td>`;
      });
      tabelaHtml += `<td style="padding:7px 10px;border:1px solid #3d4a63;text-align:center">${fmtPLNr(sumaWszyscy)}</td></tr>`;
      tabelaHtml += `</tbody></table>`;
    } else {
    // Tabela wydajności: pracownicy × dni
    tabelaHtml += `
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="background:#2e3548;color:#fff">
        <th style="padding:7px 10px;text-align:left;border:1px solid #3d4a63;min-width:120px">Pracownik</th>`;
    sortedDates.forEach(d => {
      const [y,m,dd] = d.split('-');
      tabelaHtml += `<th style="padding:7px 6px;text-align:center;border:1px solid #3d4a63;min-width:68px">${parseInt(dd,10)}.${parseInt(m,10)}</th>`;
    });
    tabelaHtml += `<th style="padding:7px 10px;text-align:center;border:1px solid #3d4a63">Łącznie</th>
      </tr></thead><tbody>`;
    pr.forEach((p, pi) => {
      let totalMin = 0;
      tabelaHtml += `<tr style="background:${pi%2?'#fff':'#f9fafb'}">
        <td style="padding:6px 10px;border:1px solid #e0e0e0;font-weight:600">${p.full_name}</td>`;
      sortedDates.forEach(d => {
        const ds = dayStats[d][p.user_id];
        if (!ds) {
          tabelaHtml += `<td style="padding:6px 6px;border:1px solid #e0e0e0;text-align:center;color:#bbb">—</td>`;
        } else {
          const razem = ds.min_roboczy + ds.min_zbrojenie + ds.min_nieproduktywny;
          totalMin += razem;
          const efPct = ds.fakty_min > 0 ? Math.round(ds.norma_min / ds.fakty_min * 100)
                      : razem > 0 ? Math.round(ds.min_roboczy / razem * 100) : 0;
          const efKolor = efPct >= 80 ? '#1e8a4c' : efPct >= 60 ? '#e67e00' : '#c0392b';
          const zmiany = (razem / ZMIANA_MIN).toFixed(1);
          tabelaHtml += `<td style="padding:6px 6px;border:1px solid #e0e0e0;text-align:center">
            <div style="font-weight:700;color:${efKolor};font-size:12px">${efPct}%</div>
            <div style="font-size:10px;color:#666">${Math.round(razem)} min</div>
            <div style="font-size:10px;color:#999">${zmiany} zm.</div>
          </td>`;
        }
      });
      const totalZmiany = (totalMin / ZMIANA_MIN).toFixed(1);
      tabelaHtml += `<td style="padding:6px 10px;border:1px solid #e0e0e0;text-align:center;font-weight:700;background:#f0f4ff">
        <div style="font-size:12px">${Math.round(totalMin)} min</div>
        <div style="font-size:10px;color:#666">${totalZmiany} zmian</div>
      </td></tr>`;
    });
    tabelaHtml += `</tbody></table>`;
    }

    tabelaHtml += `</div>`;
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Raport wydajności ${od} – ${doDt}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; color: #222; }
    @media print { body { padding: 0; } .no-print { display:none; } }
  </style>
  </head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #222;padding-bottom:10px;margin-bottom:18px">
    <div>
      <div style="font-size:22px;font-weight:700">${typ==='zarobki_pracownicy'?'Raport zarobków pracowników':'Raport wydajności pracowników'}</div>
      <div style="font-size:13px;color:#555">${typ==='skrocony'?'Raport skrócony':typ==='zarobki'?'Raport marży zleceń (przychód od faktycznie wykonanej ilości – koszty pracy)':typ==='zarobki_pracownicy'?'Zarobki pracowników wg dni':'Raport pełny'} | Okres: ${od} – ${doDt} | Wygenerowano: ${new Date().toLocaleString('pl-PL')}</div>
    </div>
    <div style="text-align:right;font-size:13px">Pracowników: <b>${pr.length}</b> | Zmiana = <b>${ZMIANA_MIN} min</b></div>
  </div>
  ${tabelaHtml}
  </body></html>`;

  const w = window.open('','_blank','width=1000,height=800');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 600);
}


// ─── Funkcje backupu danych ───────────────────────────────────────────────────
async function adminBackupNow() {
  const msg = document.getElementById('backup-status-msg');
  if (msg) msg.textContent = '⏳ Tworzenie backupu...';
  try {
    const r = await get('/api/admin/backup');
    const total = Object.values(r.rows||{}).reduce((a,b)=>a+b,0);
    if (msg) msg.innerHTML = `✅ Backup zapisany: <b>${total}</b> rekordów | ${r.ts?.slice(0,19)||''}`;
  } catch(e) {
    if (msg) msg.textContent = '❌ Błąd backupu: ' + e.message;
  }
}

function adminBackupDownload() {
  const msg = document.getElementById('backup-status-msg');
  if (msg) msg.textContent = '⏳ Pobieranie backupu...';
  const a = document.createElement('a');
  a.href = (SERVER_URL.replace(/\/$/, '')) + '/api/admin/backup/download?x-api-key=' + encodeURIComponent(API_KEY);
  a.download = 'produkcja_backup_' + new Date().toISOString().slice(0,10) + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  if (msg) msg.textContent = '✅ Plik backupu pobrany.';
}

async function adminBackupRestore() {
  const msg = document.getElementById('backup-status-msg');
  const statusR = await get('/api/admin/backup/status').catch(() => null);
  const path = statusR?.backup_path || 'serwer';
  const ts = statusR?.backup_ts?.slice(0,19) || '?';
  if (!confirm(`Przywrócić dane z backupu na serwerze?\n📁 ${path}\n🕐 Ostatni zapis: ${ts}\n\nUwaga: nadpisze istniejące dane!`)) return;
  if (msg) msg.textContent = '⏳ Przywracanie backupu z serwera...';
  try {
    const r = await fetch((SERVER_URL.replace(/\/$/, '')) + '/api/admin/backup/restore', {
      method: 'POST',
      headers: {'x-api-key': API_KEY, 'Content-Type': 'application/json'},
    });
    const d = await r.json();
    if (d.ok) {
      if (msg) msg.innerHTML = '✅ Backup przywrócony ze ścieżki: <b>' + path + '</b><br>Odśwież stronę aby zobaczyć dane.';
    } else {
      if (msg) msg.textContent = '❌ Błąd przywracania: ' + (d.error || 'nieznany');
    }
  } catch(e) {
    if (msg) msg.textContent = '❌ Błąd: ' + e.message;
  }
}

async function adminBackupStatus() {
  const msg = document.getElementById('backup-status-msg');
  try {
    const r = await get('/api/admin/backup/status');
    if (msg) msg.innerHTML = r.backup_exists
      ? `✅ Backup: <b>${r.backup_size_kb} KB</b> | Ostatni: ${r.backup_ts?.slice(0,19)||'?'} | Interwał: co ${r.backup_interval_sec}s<br><span style="color:var(--dim);font-size:10px">📁 ${r.backup_path} (DB: ${r.db_path})</span>`
      : '⚠ Brak pliku backupu – kliknij "Zapisz backup teraz"';
  } catch(e) {
    if (msg) msg.textContent = '❌ ' + e.message;
  }
}

// ─── Wczytaj backup z dysku (plik JSON) ───────────────────────────────────────
function adminBackupRestoreFromDisk() {
  const msg = document.getElementById('backup-status-msg');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    if (!confirm(`Wczytać backup z pliku:\n📄 ${file.name}\n\nUwaga: nadpisze istniejące dane na serwerze!`)) return;
    if (msg) msg.textContent = '⏳ Wczytywanie pliku...';
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (msg) msg.textContent = '⏳ Wysyłanie do serwera...';
      const r = await fetch((SERVER_URL.replace(/\/$/, '')) + '/api/admin/backup/restore-upload', {
        method: 'POST',
        headers: {'x-api-key': API_KEY, 'Content-Type': 'application/json'},
        body: JSON.stringify(data)
      });
      const d = await r.json();
      if (d.ok) {
        const total = Object.values(d.rows||{}).reduce((a,b)=>a+b,0);
        if (msg) msg.innerHTML = `✅ Backup z dysku przywrócony! Wczytano <b>${total}</b> rekordów z pliku <b>${file.name}</b>.<br><button class="btn btn-sm" style="background:var(--accent);color:#1a1f2e;margin-top:4px" onclick="location.reload()">🔄 Odśwież stronę</button>`;
      } else {
        if (msg) msg.textContent = '❌ Błąd przywracania: ' + (d.error || 'nieznany');
      }
    } catch(e) {
      if (msg) msg.textContent = '❌ Błąd: ' + (e.message.includes('JSON') ? 'Nieprawidłowy plik JSON' : e.message);
    }
  };
  input.click();
}

// ─── Auto-monitoring resetu serwera i auto-restore ────────────────────────────
let _serverResetMonitor = null;
let _serverResetDetected = false;
let _autoRestoreInProgress = false;

async function checkServerReset() {
  if (!SERVER_URL || !API_KEY || _autoRestoreInProgress) return;
  try {
    // Pobierz status backupu – jeśli serwer zwraca brak danych lub liczbę użytkowników = 0,
    // to znaczy że dane zostały zresetowane
    const r = await fetch((SERVER_URL.replace(/\/$/, '')) + '/api/admin/backup/status', {
      headers: {'x-api-key': API_KEY}
    });
    if (!r.ok) return; // serwer niedostępny – czekamy
    const d = await r.json();

    // Sprawdź czy serwer ma dane (liczba użytkowników > 0)
    const usersCheck = await fetch((SERVER_URL.replace(/\/$/, '')) + '/api/users', {
      headers: {'x-api-key': API_KEY}
    }).catch(() => null);
    if (!usersCheck || !usersCheck.ok) return;
    const users = await usersCheck.json();

    // Jeśli lista użytkowników jest pusta a backup istnieje → reset wykryty
    if (Array.isArray(users) && users.length === 0 && d.backup_exists) {
      if (!_serverResetDetected && !_autoRestoreInProgress) {
        _serverResetDetected = true;
        await autoRestoreAfterReset(d);
      }
    } else {
      _serverResetDetected = false; // serwer ma dane – wszystko OK
    }
  } catch(e) {
    // Błąd sieci – ignorujemy, spróbujemy za chwilę
  }
}

async function autoRestoreAfterReset(backupStatus) {
  _autoRestoreInProgress = true;
  console.warn('[AUTO-RESTORE] Wykryto reset serwera – automatyczne przywracanie backupu...');

  // Pokaż baner użytkownikowi
  showResetBanner('⏳ Wykryto reset serwera – przywracam dane z backupu...');

  try {
    const r = await fetch((SERVER_URL.replace(/\/$/, '')) + '/api/admin/backup/restore', {
      method: 'POST',
      headers: {'x-api-key': API_KEY, 'Content-Type': 'application/json'},
    });
    const d = await r.json();
    if (d.ok) {
      showResetBanner('✅ Dane przywrócone automatycznie po restarcie serwera! Odświeżam...');
      setTimeout(() => {
        _autoRestoreInProgress = false;
        _serverResetDetected = false;
        hideResetBanner();
        location.reload();
      }, 2500);
    } else {
      showResetBanner('⚠ Auto-restore nie powiódł się: ' + (d.error || 'błąd') + '. Wczytaj backup ręcznie w Ustawieniach → Backup.');
      _autoRestoreInProgress = false;
    }
  } catch(e) {
    showResetBanner('⚠ Błąd auto-restore: ' + e.message + '. Wczytaj backup ręcznie.');
    _autoRestoreInProgress = false;
  }
}

function showResetBanner(msg) {
  let banner = document.getElementById('server-reset-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'server-reset-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#b94600;color:#fff;padding:12px 16px;font-size:14px;font-weight:700;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.5);';
    document.body.prepend(banner);
  }
  banner.textContent = msg;
}

function hideResetBanner() {
  const banner = document.getElementById('server-reset-banner');
  if (banner) banner.remove();
}

function startServerResetMonitor() {
  if (_serverResetMonitor) clearInterval(_serverResetMonitor);
  // Sprawdzaj co 20 sekund
  _serverResetMonitor = setInterval(checkServerReset, 20000);
  // Pierwsze sprawdzenie po 10s od startu (gdy serwer jest już gotowy)
  setTimeout(checkServerReset, 10000);
}

function renderMajsterPodsumowanie(stats) {
  const aktywne  = (stats?.zlecenia || []);
  const hist     = (stats?.wszystkie_zlecenia || []);
  const zakonczone = hist.filter(z => z.status === 'zakonczone');
  const anulowane  = hist.filter(z => z.status === 'anulowane');

  const ro = state.raportOkres;
  let html = '<div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">'
    + '<div class="stat-box"><div class="stat-val" style="color:var(--blue)">' + aktywne.length + '</div><div class="stat-lbl">Aktywnych</div></div>'
    + '<div class="stat-box"><div class="stat-val" style="color:var(--green)">' + zakonczone.length + '</div><div class="stat-lbl">Zakończonych</div></div>'
    + '<div class="stat-box"><div class="stat-val" style="color:var(--red)">' + anulowane.length + '</div><div class="stat-lbl">Anulowanych</div></div>'
    + '<div class="stat-box"><div class="stat-val">' + (stats.dzis_sztuk||0) + '</div><div class="stat-lbl">Sztuk dziś</div></div>'
    + '</div>';

  // Raport PDF zleceń
  html += '<div style="background:var(--entry);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:14px">'
        + '<div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;margin-bottom:8px">📄 Raport PDF zleceń</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:end">'
        + '<div><div style="font-size:11px;color:var(--dim);margin-bottom:3px">Od</div>'
        + '<input type="date" id="raport-od" value="' + (ro.od||getTodayMinus(30)) + '" style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 8px;font-size:12px;box-sizing:border-box"></div>'
        + '<div><div style="font-size:11px;color:var(--dim);margin-bottom:3px">Do</div>'
        + '<input type="date" id="raport-do" value="' + (ro.do||getToday()) + '" style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 8px;font-size:12px;box-sizing:border-box"></div>'
        + '<button class="btn btn-accent" style="padding:8px 14px;white-space:nowrap" onclick="generateRaportZleceniaPDF()">📥 Generuj PDF</button>'
        + '</div></div>';

  html += '<div class="section-hdr">📋 Historia zleceń – kliknij po szczegóły</div>';

  const wszystkie = [...aktywne, ...zakonczone, ...anulowane]
    .filter((z,i,a) => a.findIndex(x=>x.id===z.id)===i)
    .sort((a,b) => (b.id||0)-(a.id||0));

  if (!wszystkie.length) {
    html += '<div class="empty">Brak zleceń</div>';
  } else {
    wszystkie.forEach(z => {
      const isZak = z.status === 'zakonczone';
      const isAnu = z.status === 'anulowane';
      const przet = z.termin && new Date(z.termin) < new Date() && !isZak && !isAnu;
      const prog  = z.op_total > 0 ? Math.round((z.op_done/z.op_total)*100) : 0;
      const wartosc = (z.cena_brutto_szt||0)*(z.ilosc_sztuk||0);
      const border  = przet ? 'var(--red)' : isZak ? 'var(--green)' : isAnu ? 'var(--dim)' : '';
      html += '<div class="card" style="cursor:pointer;' + (border?'border-color:'+border+';':'') + '"'
            + ' onclick="openZlecenieModal(' + z.id + ')">'
            + '<div class="card-header">'
            + '<div style="flex:1;min-width:0">'
            + '<div class="card-title">' + z.numer + (przet ? ' <span class="badge badge-red">⚠</span>' : '') + '</div>'
            + '<div class="card-sub">' + z.nazwa + '</div>'
            + (z.termin ? '<div class="card-sub">📅 ' + fmtDate(z.termin) + '</div>' : '')
            + '</div>'
            + '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;margin-left:8px">'
            + statusBadge(z.status)
            + '<span style="font-size:11px;color:var(--dim)">' + (z.op_done||0) + '/' + (z.op_total||0) + ' op.</span>'
            + (wartosc ? '<span style="font-size:11px;color:var(--accent)">' + fmtPLN(wartosc) + '</span>' : '')
            + '</div></div>'
            + '<div class="progress-wrap" style="margin-top:6px">'
            + '<div class="progress-bar" style="width:' + prog + '%;background:' + (isZak?'var(--green)':prog>=100?'var(--green)':'var(--accent)') + '"></div>'
            + '</div>'
            + '<div style="font-size:11px;color:var(--dim);margin-top:4px;display:flex;justify-content:space-between">'
            + '<span>' + prog + '% · ' + (z.sztuki_wykonane||0) + '/' + z.ilosc_sztuk + ' szt.</span>'
            + '<span style="color:var(--accent)">▶ szczegóły</span>'
            + '</div></div>';
    });
  }

  // Modal szczegółów zlecenia
  if (state.zlecenieModal) {
    const m = state.zlecenieModal;
    const zlTab = m.zlModalTab || 'sesje';
    
    // Zakładki
    const zlTabs = [
      {id:'sesje', label:'📋 Sesje i koszty'},
      {id:'drzewo', label:'🌳 Drzewo G→P'},
    ];
    const tabsHtml = zlTabs.map(t => {
      const active = zlTab === t.id;
      return '<button onclick="setState({zlecenieModal:{...state.zlecenieModal,zlModalTab:\''+t.id+'\'}}'+        (t.id==='drzewo'&&!state.zlecenieModal.zlTree?';zlModalLoadTree()':'') + ')" '+
        'style="padding:7px 14px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:'+
        (active?'700':'400')+';background:'+        (active?'var(--accent)':' transparent')+';color:'+        (active?'#1a1f2e':'var(--dim)')+'">'+t.label+'</button>';
    }).join('');

    html += '<div class="modal-overlay" onclick="if(event.target===this)setState({zlecenieModal:null})">'
          + '<div class="modal" style="max-height:85vh;overflow-y:auto">'
          + '<button class="modal-close" onclick="setState({zlecenieModal:null})">×</button>'
          + '<div style="font-size:16px;font-weight:700;margin-bottom:4px">' + (m.numer||'') + '</div>'
          + '<div style="color:var(--dim);font-size:13px;margin-bottom:14px">' + (m.nazwa||'') + '</div>'
          + '<div style="display:flex;gap:4px;margin-bottom:16px;background:var(--entry);padding:4px;border-radius:8px">' + tabsHtml + '</div>';

    if (m.loading) {
      html += '<div style="text-align:center;padding:20px;color:var(--dim)">⏳ Ładowanie...</div>';
    } else if (zlTab === 'drzewo') {
      // Zakładka: Drzewo G→P
      if (m.zlTreeLoading) {
        html += '<div style="text-align:center;padding:30px;color:var(--dim)">⏳ Ładowanie drzewa...</div>';
      } else if (!m.zlTree) {
        html += '<div style="text-align:center;padding:30px">' +
          '<div style="font-size:32px;margin-bottom:10px">🌳</div>' +
          '<div style="color:var(--dim);font-size:13px;margin-bottom:12px">Załaduj strukturę drzewa G→P dla tego zlecenia</div>' +
          '<button onclick="zlModalLoadTree()" style="background:var(--blue);color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">Wczytaj drzewo</button>' +
          '</div>';
      } else if (m.zlTree === 'brak') {
        html += '<div style="text-align:center;padding:30px;color:var(--dim)">' +
          '<div style="font-size:32px;margin-bottom:10px">❌</div>' +
          '<div style="font-size:13px">Brak wyrobu G o numerze <strong>' + m.numer + '</strong> w bazie drzew.<br>' +
          '<span style="font-size:11px">Utwórz zlecenie przez wizard G→P lub zaimportuj z PDF.</span></div>' +
          '</div>';
      } else {
        // Render drzewa
        const nodeCount = (function cnt(n){return 1+(n.children||[]).reduce((s,c)=>s+cnt(c),0);})(m.zlTree);
        html += '<div style="display:flex;gap:6px;margin-bottom:10px;align-items:center">' +
          '<span style="color:var(--dim);font-size:11px">' + nodeCount + ' węzłów</span>' +
          '<div style="flex:1"></div>' +
          '<button onclick="setState({zlecenieModal:{...state.zlecenieModal,zlTree:null,zlTreeLoading:false}})" ' +
          'style="background:var(--entry);color:var(--dim);border:1px solid var(--border);border-radius:5px;padding:3px 10px;font-size:11px;cursor:pointer">↺ Odśwież</button>' +
          '</div>' +
          '<div style="background:var(--entry);border-radius:10px;padding:12px;overflow-x:auto">' +
          renderDrzewoNode(m.zlTree, 0, m.ilosc_sztuk || 1) +
          '</div>';
      }
    } else {
      if (m.koszt_total != null) {
        const kosztProd = m.koszt_produktow || 0;
        const kosztZbr = m.koszt_zbrojenia || 0;
        const kosztTotal = (m.koszt_total||0) + kosztProd + kosztZbr;
        const zysk = (m.wartosc||0) - kosztTotal;
        const kolor = zysk >= 0 ? 'var(--green)' : 'var(--red)';
        html += '<div style="background:var(--entry);border-radius:8px;padding:12px;margin-bottom:14px">'
              + '<div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;margin-bottom:8px">💰 Podsumowanie finansowe</div>'
              + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px">'
              + '<span style="color:var(--dim)">Wartość zlecenia</span><span style="color:var(--accent);font-weight:700">' + fmtPLN(m.wartosc||0) + '</span>'
              + '<span style="color:var(--dim)">Koszt pracy</span><span>' + fmtPLN(m.koszt_total||0) + '</span>'
              + (kosztZbr > 0 ? '<span style="color:var(--orange)">⚙ Koszt zbrojenia</span><span style="color:var(--orange)">' + fmtPLN(kosztZbr) + '</span>' : '')
              + (kosztProd > 0 ? '<span style="color:var(--dim)">Koszt produktów</span><span>' + fmtPLN(kosztProd) + '</span>' : '')
              + (kosztTotal !== (m.koszt_total||0) ? '<span style="color:var(--dim)">Koszt łącznie</span><span style="font-weight:700">' + fmtPLN(kosztTotal) + '</span>' : '')
              + '<span style="color:var(--dim)">Zysk</span><span style="color:' + kolor + ';font-weight:700">' + fmtPLN(zysk) + '</span>'
              + '</div></div>';
        // Tabela produktów zlecenia
        if (m.produkty && m.produkty.length) {
          html += '<div style="background:var(--entry);border-radius:8px;padding:12px;margin-bottom:14px">'
                + '<div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;margin-bottom:8px">🛒 Produkty / Zakupy</div>';
          m.produkty.forEach(p => {
            const w = (parseFloat(p.ilosc)||0)*(parseFloat(p.cena)||0);
            html += '<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid rgba(46,53,72,.3)">'
                  + '<span>' + p.nazwa + '</span>'
                  + '<span style="color:var(--dim)">' + p.ilosc + ' szt. × ' + fmtPLN(p.cena) + '</span>'
                  + '<span style="color:var(--accent);font-weight:600">' + fmtPLN(w) + '</span>'
                  + '</div>';
          });
          html += '</div>';
        }
      }

      const sesje = m.sesje || [];
      if (sesje.length) {
        const ops = {};
        sesje.forEach(s => {
          const k = (s.kolejnosc||999) + '::' + (s.op_nazwa||'Inne');
          if (!ops[k]) ops[k] = {sesje:[], total_sec:0, total_szt:0, kolejnosc:s.kolejnosc||999, nazwa:s.op_nazwa||'Inne'};
          let el = 0;
          if (s.start_time && s.end_time) {
            el = (parseServerDT(s.end_time)-parseServerDT(s.start_time))/1000;
            (JSON.parse(s.pauzy||'[]')).forEach(p=>{if(p.koniec)el-=(parseServerDT(p.koniec)-parseServerDT(p.start))/1000;});
            el = Math.max(0, el);
          }
          ops[k].sesje.push({...s, elapsed_sec:el});
          ops[k].total_sec += el;
          ops[k].total_szt += s.ilosc_sztuk||0;
        });

        Object.values(ops).sort((a,b)=>a.kolejnosc-b.kolejnosc).forEach(op => {
          const normMin = op.sesje[0]?.czas_norma||null;
          const wydPct = normMin && op.total_szt>0 ? Math.round((normMin*op.total_szt)/(op.total_sec/60)*100) : null;
          const wKolor = wydPct===null?'var(--dim)':wydPct>=90?'var(--green)':wydPct>=70?'var(--orange)':'var(--red)';
          const kosztOp = op.sesje.reduce((a,s)=>a+(s.koszt_sesji||0),0);
          html += '<div style="margin-bottom:10px;border:1px solid var(--border);border-radius:8px;overflow:hidden">'
                + '<div style="background:var(--entry);padding:8px 12px;display:flex;justify-content:space-between;align-items:center">'
                + '<div style="font-weight:600;font-size:13px">' + (op.kolejnosc<999?op.kolejnosc+'. ':'') + op.nazwa + '</div>'
                + '<div style="font-size:11px;color:var(--dim);text-align:right">'
                + fmtTime(Math.round(op.total_sec)) + ' · ' + op.total_szt + ' szt.'
                + (wydPct!==null?' · <span style="color:'+wKolor+'">'+wydPct+'%</span>':'')
                + (kosztOp?' · <span style="color:var(--accent)">'+fmtPLN(kosztOp)+'</span>':'')
                + '</div></div>';
          op.sesje.forEach(s => {
            const dt = s.end_time ? (s.end_time||'').substring(0,16).replace('T',' ') : '—';
            const normMin = s.czas_norma || op.sesje[0]?.czas_norma || 0;
            const sztuk = s.ilosc_sztuk || 1;
            const elapsedMin = s.elapsed_sec / 60;
            // norma = czas na 1 szt. – porównujemy śr. czas/szt z normą
            const avgSecPerPiece = Math.round(s.elapsed_sec / sztuk);
            const avgMinPerPiece = elapsedMin / sztuk;
            const czasPrzekroczony = normMin > 0 && avgMinPerPiece > normMin;
            const timeColor = czasPrzekroczony ? 'var(--red)' : 'var(--green)';
            const rowBg = czasPrzekroczony ? 'background:rgba(231,76,60,0.08);' : '';
            html += '<div style="padding:7px 12px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;' + rowBg + '">'
                  + '<div><div style="font-size:13px;font-weight:500">' + (s.full_name||'—') + (s.typ==='zbrojenie'?' <span style="font-size:10px;color:var(--orange);font-weight:700;background:rgba(230,126,0,0.12);border-radius:3px;padding:1px 4px">⚙ zbr</span>':'') + (czasPrzekroczony?' <span style="font-size:10px;color:var(--red);font-weight:700">⚠ PRZEKROCZONO</span>':'') + '</div>'
                  + '<div style="font-size:11px;color:var(--dim)">🕐 ' + dt + '</div>'
                  + (s.uwagi?'<div style="font-size:11px;color:var(--orange)">💬 '+s.uwagi+'</div>':'')
                  + '</div><div style="text-align:right">'
                  + '<div style="font-family:Consolas;color:' + timeColor + ';font-size:14px;font-weight:700">' + fmtTime(avgSecPerPiece) + '<span style="font-family:inherit;font-size:10px;color:var(--dim);font-weight:400"> /szt.</span></div>'
                  + '<div style="font-size:11px;color:var(--dim)">łącznie: ' + fmtTime(Math.round(s.elapsed_sec)) + ' · ' + sztuk + ' szt.</div>'
                  + (normMin?'<div style="font-size:10px;color:var(--dim)">norma: ' + normMin + ' min/szt.</div>':'')
                  + (s.koszt_sesji?'<div style="font-size:11px;color:var(--accent)">'+fmtPLN(s.koszt_sesji)+'</div>':'')
                  + '</div></div>';
          });
          html += '</div>';
        });
      } else {
        html += '<div class="empty">Brak zarejestrowanych sesji dla tego zlecenia</div>';
      }
    }
    const canDelete = state.user?.role === 'admin' || state.user?.role === 'majster';
const canEditStawki = ['admin','technolog','majster'].includes(state.user?.role);
html += '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">';
if (canEditStawki) {
html += '<button class="btn btn-accent" style="flex:1;background:var(--orange,#e67e00);color:#1a1f2e" onclick="openStawkiZleceniaModal(' + m.id + ', \'' + (m.numer||'').replace(/'/g,"\\'") + '\', \'' + (m.nazwa||'').replace(/'/g,"\\'") + '\')">⚙ Stawki zlecenia</button>';
}
if (canDelete) {
html += '<button class="btn btn-red" style="flex:1" onclick="deleteZlecenieFromModal(' + m.id + ')">🗑 Usuń zlecenie</button>';
}
html += '<button class="btn btn-outline" style="flex:1" onclick="setState({zlecenieModal:null})">Zamknij</button>';
html += '</div></div></div>';
  }

  return html;
}

async function deleteZlecenieFromModal(zid) {
  if (!confirm('Na pewno usunąć to zlecenie? Zostaną usunięte wszystkie sesje i operacje!')) return;
  try {
    await del('/api/zlecenia/' + zid);
    setState({zlecenieModal: null});
    await loadMajster();
    // Odśwież drzewo – zlecenie znika automatycznie
    if (state.tab === 'drzewo' || true) {
      const [g, p, zl] = await Promise.all([
        get('/api/wyroby?typ=G'), get('/api/wyroby?typ=P'), get('/api/zlecenia'),
      ]);
      const zlG = zl.filter(z => g.some(wg => wg.symbol === z.numer));
      setState({drzewoWyrobyG: g, drzewoWyrobyP: p, drzewoZleceniaG: zlG});
    }
    alert('Zlecenie zostało usunięte.');
  } catch(e) {
    alert('Błąd usuwania: ' + e.message);
  }
}


async function openZlecenieModal(zid) {
  const all = [...(state.majsterStats?.zlecenia||[]), ...(state.majsterStats?.wszystkie_zlecenia||[])];
  const z = all.find(x=>x.id===zid) || {id:zid, numer:'#'+zid, nazwa:'', cena_brutto_szt:0, ilosc_sztuk:0};
  setState({zlecenieModal:{id:zid, numer:z.numer, nazwa:z.nazwa,
    wartosc:(z.cena_brutto_szt||0)*(z.ilosc_sztuk||0), loading:true, sesje:null, koszt_total:null,
    zlModalTab: 'sesje', zlTree: null, zlTreeLoading: false, ilosc_sztuk: z.ilosc_sztuk||1}});
  try {
    const data = await get('/api/zlecenia/' + zid + '/szczegoly');
    setState({zlecenieModal:{...state.zlecenieModal, loading:false,
      sesje:data.sesje, koszt_total:data.koszt_total, koszt_produktow:data.koszt_produktow||0,
      koszt_zbrojenia:data.koszt_zbrojenia||0,
      produkty:data.produkty||[], wartosc:data.wartosc||state.zlecenieModal.wartosc}});
  } catch(e) {
    setState({zlecenieModal:{...state.zlecenieModal, loading:false, sesje:[]}});
  }
}

async function zlModalLoadTree() {
  const m = state.zlecenieModal;
  if (!m || m.zlTreeLoading) return;
  setState({zlecenieModal:{...m, zlTreeLoading:true, zlTree:null}});
  try {
    // Szukaj wyrobu G po numerze zlecenia
    const wyroby = await get('/api/wyroby?typ=G&q=' + encodeURIComponent(m.numer));
    const wg = wyroby.find(w => w.symbol === m.numer);
    if (!wg) {
      setState({zlecenieModal:{...state.zlecenieModal, zlTreeLoading:false, zlTree:'brak'}});
      return;
    }
    const tree = await get('/api/wyroby/' + wg.id + '/drzewo');
    setState({zlecenieModal:{...state.zlecenieModal, zlTreeLoading:false, zlTree:tree, zlWyrobId:wg.id}});
  } catch(e) {
    setState({zlecenieModal:{...state.zlecenieModal, zlTreeLoading:false, zlTree:'brak'}});
  }
}


function renderMajsterWydajnosc() {
  const w = state.wydajnoscMajster;
  const okres = state.wydajnoscOkres;
  const okresLabels = {dzis:'Dziś', tydzien:'7 dni', miesiac:'30 dni'};
  const rwo = state.raportWydOkres;

  let html = `
  <div class="chip-row">
    ${Object.entries(okresLabels).map(([k,v]) =>
      `<div class="chip ${okres===k?'active':''}" onclick="loadWydajnoscMajster('${k}')">${v}</div>`
    ).join('')}
  </div>`;

  // Raport PDF wydajności
  html += '<div style="background:var(--entry);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:14px">'
        + '<div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;margin-bottom:8px">📄 Raport PDF wydajności</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;align-items:end">'
        + '<div><div style="font-size:11px;color:var(--dim);margin-bottom:3px">Od</div>'
        + '<input type="date" id="rwd-od" value="' + (rwo.od||getTodayMinus(7)) + '" style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 8px;font-size:12px;box-sizing:border-box"></div>'
        + '<div><div style="font-size:11px;color:var(--dim);margin-bottom:3px">Do</div>'
        + '<input type="date" id="rwd-do" value="' + (rwo.do||getToday()) + '" style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 8px;font-size:12px;box-sizing:border-box"></div>'
        + '<div><div style="font-size:11px;color:var(--dim);margin-bottom:3px">Typ raportu</div>'
        + '<select id="rwd-typ" style="width:100%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 8px;font-size:12px">'
        + '<option value="skrocony" ' + (state.raportWydTyp==='skrocony'?'selected':'') + '>Skrócony</option>'
        + '<option value="pelny" ' + (state.raportWydTyp==='pelny'?'selected':'') + '>Pełny</option>'
        + '<option value="zarobki" ' + (state.raportWydTyp==='zarobki'?'selected':'') + '>Marża zleceń</option>'
        + '</select></div>'
        + '<button class="btn btn-accent" style="padding:8px 14px;white-space:nowrap" onclick="generateRaportWydajnoscPDF()">📥 Generuj PDF</button>'
        + '</div></div>';

  // Panel backupu danych
  html += '<div style="background:var(--entry);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:14px">'
        + '<div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;margin-bottom:8px">🛡 Backup danych (ochrona przed utratą po restarcie)</div>'
        + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">'
        + '<button class="btn" style="padding:7px 12px;font-size:12px;background:#1e8a4c;color:#fff" onclick="adminBackupNow()">💾 Zapisz backup teraz</button>'
        + '<button class="btn" style="padding:7px 12px;font-size:12px;background:#1a73e8;color:#fff" onclick="adminBackupDownload()">⬇ Pobierz backup</button>'
        + '<button class="btn" style="padding:7px 12px;font-size:12px;background:var(--orange,#e67e00);color:#fff" onclick="adminBackupRestore()">⬆ Wczytaj backup z serwera</button>'
        + '<button class="btn" style="padding:7px 12px;font-size:12px;background:#7b3fa0;color:#fff" onclick="adminBackupRestoreFromDisk()">📂 Wczytaj backup z dysku</button>'
        + '<button class="btn" style="padding:7px 12px;font-size:12px" onclick="adminBackupStatus()">ℹ Status</button>'
        + '</div>'
        + '<div id="backup-status-msg" style="margin-top:6px;font-size:11px;color:var(--dim)">✅ Backup zapisywany automatycznie przy każdej zmianie sesji (start/stop/pauza) oraz co 2 min jako fallback.</div>'
        + '<div style="margin-top:3px;font-size:10px;color:var(--dim)">🔁 Auto-monitoring resetu serwera aktywny – dane zostaną przywrócone automatycznie po restarcie.</div>'
        + '</div>';

  if (!w) {
    html += `<div class="empty">⏳ Ładowanie danych wydajności...</div>`;
    return html;
  }

  if (w.error) {
    html += `<div class="error-banner">⚠ Błąd ładowania danych: ${w.error}</div>`;
    html += `<button class="btn-outline" onclick="loadWydajnoscMajster()">🔄 Spróbuj ponownie</button>`;
    return html;
  }

  if (!w.pracownicy.length) {
    html += `<div class="empty">Brak danych za wybrany okres</div>`;
    return html;
  }

  html += `<div class="section-hdr">🏆 Ranking pracowników – ${okresLabels[okres]}</div>`;

  // Sortuj malejąco wg % norm (najwyższy % = 1. miejsce)
  const pracownicy_sorted = [...w.pracownicy].sort((a, b) => {
    const pctA = (a.norma_wydajnosc_pct !== null && a.norma_wydajnosc_pct !== undefined)
      ? a.norma_wydajnosc_pct
      : (a.normy_total > 0 ? Math.round(a.normy_ok / a.normy_total * 100) : -1);
    const pctB = (b.norma_wydajnosc_pct !== null && b.norma_wydajnosc_pct !== undefined)
      ? b.norma_wydajnosc_pct
      : (b.normy_total > 0 ? Math.round(b.normy_ok / b.normy_total * 100) : -1);
    return pctB - pctA;
  });

  pracownicy_sorted.forEach((p, idx) => {
    const medal = idx===0?'🥇':idx===1?'🥈':idx===2?'🥉':'';
    const wydPct = (p.norma_wydajnosc_pct !== null && p.norma_wydajnosc_pct !== undefined)
      ? p.norma_wydajnosc_pct
      : (p.normy_total > 0 ? Math.round(p.normy_ok/p.normy_total*100) : null);
    const barColor = wydPct===null ? 'var(--dim)' : wydPct>=90 ? 'var(--green)' : wydPct>=70 ? 'var(--orange)' : 'var(--red)';
    const expanded = state.majsterExpandedUser === p.user_id;

    html += `
    <div class="card" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer"
           onclick="setState({majsterExpandedUser: ${expanded ? 'null' : p.user_id}})">
        <div>
          <div style="font-weight:700">${medal} ${p.full_name}</div>
          <div style="font-size:12px;color:var(--dim)">
            ${p.sesji} sesji | ${p.sztuki} szt. | ${p.godz}h
            ${wydPct!==null ? ` | normy: <span style="color:${barColor}">${wydPct}%</span>` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          ${wydPct !== null ? `
          <div style="text-align:right">
            <div style="font-size:20px;font-weight:700;color:${barColor}">${wydPct}%</div>
            <div style="font-size:10px;color:var(--dim)">${p.normy_ok}/${p.normy_total} norm</div>
          </div>` : ''}
          <span style="color:var(--dim)">${expanded?'▲':'▼'}</span>
        </div>
      </div>
      ${wydPct !== null ? `
      <div class="wyd-bar-wrap" style="margin-top:8px">
        <div class="wyd-bar" style="width:${wydPct}%;background:${barColor}"></div>
      </div>` : ''}
      ${expanded && p.sesje.length ? `
      <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px">
        <div style="font-size:11px;color:var(--dim);margin-bottom:8px">Sesje (${p.sesje.length}):</div>
        ${p.sesje.slice(0,15).map(s => {
          const wColor = s.wyd_pct===null ? 'var(--dim)' : s.wyd_pct>=90 ? 'var(--green)' : s.wyd_pct>=70 ? 'var(--orange)' : 'var(--red)';
          const isGlownaSesja = s.sesja_glowna === 1 || s.sesja_glowna === undefined;
          const avgMin = s.ilosc_sztuk > 0 ? (s.czas_min / s.ilosc_sztuk).toFixed(1) : s.czas_min;
          return `
          <div style="padding:6px 0;border-bottom:1px solid rgba(46,53,72,.3)">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.op_nazwa}${s.typ==='zbrojenie'?' <span style="font-size:10px;color:var(--orange);font-weight:700;background:rgba(230,126,0,0.12);border-radius:3px;padding:1px 3px">⚙ zbr</span>':''}${!isGlownaSesja?' <span style="font-size:10px;color:#e67e00;background:rgba(230,126,0,0.12);border-radius:3px;padding:1px 4px">➕ dod.</span>':''}</div>
                <div style="font-size:11px;color:var(--accent)">📋 ${s.zl_numer}${s.zl_nazwa && s.zl_nazwa!==s.zl_numer ? ' – '+s.zl_nazwa : ''}</div>
                <div style="font-size:11px;color:var(--dim)">📅 ${s.data||'—'} | 🏭 ${s.stanowisko||'—'} | 📦 ${s.ilosc_sztuk||0} szt.</div>
              </div>
              <div style="text-align:right;margin-left:8px;white-space:nowrap">
                <div style="font-family:Consolas;font-size:13px;font-weight:700;color:var(--text)">${avgMin}<span style="font-size:10px;color:var(--dim);font-weight:400"> min/szt</span></div>
                ${s.norma_min?`<div style="font-size:10px;color:var(--dim)">norma: ${s.norma_min} min</div>`:''}
                ${s.wyd_pct!==null?`<div style="font-weight:700;font-size:14px;color:${wColor}">${s.wyd_pct}%</div>`:''}
                ${s.sesja_id?`<button class="btn-sm" style="font-size:10px;margin-top:4px"
                  onclick="openEditSesjaModal(${s.sesja_id},'${s.start_time||''}','${s.end_time||''}')">✏ Koryguj czas</button>
                <button class="btn-sm" style="font-size:10px;margin-top:2px;background:rgba(231,76,60,0.15);color:var(--red);border-color:var(--red)"
                  onclick="deleteSesjaConfirm(${s.sesja_id})">🗑 Usuń sesję</button>`:''}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>` : ''}
    </div>`;
  });

  html += renderMarzaPracownikow();

  return html;
}

// ─── Marża zleceń – wkład pracowników ───────────────────────────────────────
function renderMarzaPracownikow() {
  const m = state.marzaPracownikow;
  const okres = state.wydajnoscOkres;
  const okresLabels = {dzis:'Dziś', tydzien:'7 dni', miesiac:'30 dni'};

  let html = `<div class="section-hdr" style="margin-top:18px">💵 Marża zleceń – wkład pracowników (${okresLabels[okres]})</div>`;

  if (!m) {
    return html + `<div class="empty">⏳ Ładowanie danych marży...</div>`;
  }
  if (m.error) {
    return html + `<div class="error-banner">⚠ Błąd ładowania danych: ${m.error}</div>`;
  }
  if (!m.pracownicy.length) {
    return html + `<div class="empty">Brak danych o marży za wybrany okres</div>`;
  }

  m.pracownicy.forEach(p => {
    const expanded = state.marzaExpandedUser === p.user_id;
    const marzaColor = p.marza_total >= 0 ? 'var(--green)' : 'var(--red)';
    html += `
    <div class="card" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer"
           onclick="setState({marzaExpandedUser: ${expanded ? 'null' : p.user_id}})">
        <div>
          <div style="font-weight:700">${p.full_name}</div>
          <div style="font-size:12px;color:var(--dim)">${p.zlecenia.length} zlec. w okresie</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="font-size:20px;font-weight:700;color:${marzaColor}">${fmtPLN(p.marza_total)}</div>
          <span style="color:var(--dim)">${expanded?'▲':'▼'}</span>
        </div>
      </div>
      ${expanded ? `
      <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px">
        ${p.zlecenia.map(z => {
          const zColor = z.marza_pracownika >= 0 ? 'var(--green)' : 'var(--red)';
          return `
          <div style="padding:6px 0;border-bottom:1px solid rgba(46,53,72,.3);display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-size:12px;font-weight:600;color:var(--accent)">📋 ${z.numer}${z.nazwa && z.nazwa!==z.numer ? ' – '+z.nazwa : ''}</div>
              <div style="font-size:11px;color:var(--dim)">Marża zlecenia: ${fmtPLN(z.marza_zlecenia)} | udział: ${z.udzial_pct}%</div>
            </div>
            <div style="font-weight:700;font-size:14px;color:${zColor};white-space:nowrap;margin-left:8px">${fmtPLN(z.marza_pracownika)}</div>
          </div>`;
        }).join('')}
      </div>` : ''}
    </div>`;
  });

  return html;
}

// ══════════════════════════════════════════════════════════════
