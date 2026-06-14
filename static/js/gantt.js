// ══════════════════════════════════════════════════════════════
//  GANTT – Graficzne obłożenie stanowisk (drag & drop)
//  v2.0: Auto-przeliczanie dat, rozszerzona kolorystyka statusów,
//        obsługa przenoszenia między maszynami
// ══════════════════════════════════════════════════════════════

// ── Stałe ────────────────────────────────────────────────────
const GANTT_WORK_START = 6;   // godzina początku zmiany
const GANTT_WORK_END   = 22;  // godzina końca zmiany
const GANTT_DAYS_AHEAD = 7;   // ile dni do przodu rysujemy

// ── Paleta statusów ───────────────────────────────────────────
// Zamiast koloru per-zlecenie, używamy semantycznej palety statusów
const GANTT_STATUS_COLORS = {
  w_toku:       'var(--green)',       // aktywna operacja
  w_toku_over:  'var(--orange)',      // aktywna, przekroczona norma
  planowana:    '#4a90d9',            // zaplanowana (oczekuje)
  opozniona:    'var(--red)',         // po terminie
  pilna:        '#e67e22',            // ≤ 3 dni do terminu
  zbrojenie:    '#8e44ad',            // operacja zbrojeniowa
  koop:         '#16a085',            // kooperacja (zewnętrzna)
};

// Paleta kolorów per-zlecenie (fallback dla oczekujących bez wyraźnego statusu)
const GANTT_PALETTE = [
  '#3498db','#27ae60','#9b59b6','#e67e22','#1abc9c',
  '#e74c3c','#2980b9','#8e44ad','#16a085','#d35400',
  '#2ecc71','#f39c12','#c0392b','#7f8c8d','#e8a020'
];
const _ganttColorCache = {};
function ganttColor(zlecenieId) {
  if (!_ganttColorCache[zlecenieId]) {
    const keys = Object.keys(_ganttColorCache).length;
    _ganttColorCache[zlecenieId] = GANTT_PALETTE[keys % GANTT_PALETTE.length];
  }
  return _ganttColorCache[zlecenieId];
}

/**
 * Wyznacza kolor paska Gantta na podstawie statusu i terminu.
 * Priorytet: w_toku > opozniona > pilna > planowana > zbrojenie/koop
 */
function ganttBarColor(op, sched) {
  const isWToku = op.op_status === 'w_toku';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const termin = op.termin ? new Date(op.termin) : null;
  const daysLeft = termin ? Math.ceil((termin - today) / 86400000) : null;

  if (isWToku && sched?.overTime) return GANTT_STATUS_COLORS.w_toku_over;
  if (isWToku)                    return GANTT_STATUS_COLORS.w_toku;
  if (daysLeft !== null && daysLeft < 0) return GANTT_STATUS_COLORS.opozniona;
  if (daysLeft !== null && daysLeft <= 3) return GANTT_STATUS_COLORS.pilna;

  // Zbrojenie / kooperacja z nazwy operacji
  const n = (op.op_nazwa || '').toLowerCase();
  if (n.includes('zbrojenie') || n.includes('zbroj')) return GANTT_STATUS_COLORS.zbrojenie;
  if (n.includes('koop') || n.includes('kooperacja'))  return GANTT_STATUS_COLORS.koop;

  return GANTT_STATUS_COLORS.planowana;
}

/**
 * Etykieta tekstowa statusu do legenDy / tooltipa.
 */
function ganttStatusLabel(op, sched) {
  if (op.op_status === 'w_toku' && sched?.overTime) return 'W toku (przekroczona norma)';
  if (op.op_status === 'w_toku') return 'W toku';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const termin = op.termin ? new Date(op.termin) : null;
  const daysLeft = termin ? Math.ceil((termin - today) / 86400000) : null;
  if (daysLeft !== null && daysLeft < 0) return `Opóźniona (${Math.abs(daysLeft)}d po terminie)`;
  if (daysLeft !== null && daysLeft <= 3) return `Pilna (${daysLeft}d)`;
  return 'Planowana';
}

// Drag state
let _ganttDrag = null;

// ── Pomocnicze: obliczenia czasu pracy ───────────────────────
function ganttNow() {
  return new Date();
}

function ganttAddWorkMinutes(from, minutes) {
  let d = new Date(from);
  let rem = minutes;
  const maxIter = 100000;
  let iter = 0;
  while (rem > 0 && iter++ < maxIter) {
    const h = d.getHours(), m = d.getMinutes();
    if (h < GANTT_WORK_START) { d.setHours(GANTT_WORK_START, 0, 0, 0); continue; }
    if (h >= GANTT_WORK_END)  { d.setDate(d.getDate()+1); d.setHours(GANTT_WORK_START,0,0,0); continue; }
    const minsToDayEnd = (GANTT_WORK_END - h) * 60 - m;
    if (rem <= minsToDayEnd) { d = new Date(d.getTime() + rem*60000); rem = 0; }
    else { rem -= minsToDayEnd; d.setDate(d.getDate()+1); d.setHours(GANTT_WORK_START,0,0,0); }
  }
  return d;
}

function ganttWorkMinsBetween(a, b) {
  if (b <= a) return 0;
  let total = 0;
  let cur = new Date(a);
  while (cur < b) {
    const h = cur.getHours();
    if (h < GANTT_WORK_START) { cur.setHours(GANTT_WORK_START, 0, 0, 0); continue; }
    if (h >= GANTT_WORK_END)  { cur.setDate(cur.getDate()+1); cur.setHours(GANTT_WORK_START,0,0,0); continue; }
    const dayEnd = new Date(cur); dayEnd.setHours(GANTT_WORK_END, 0, 0, 0);
    const segEnd = b < dayEnd ? b : dayEnd;
    total += (segEnd - cur) / 60000;
    cur = segEnd;
    if (cur.getHours() >= GANTT_WORK_END) { cur.setDate(cur.getDate()+1); cur.setHours(GANTT_WORK_START,0,0,0); }
  }
  return total;
}

function ganttCalcElapsedMin(startStr, pauzyStr) {
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

// ── Budowanie harmonogramu dla stanowiska ─────────────────────
/**
 * Przelicza daty START i END dla każdej operacji na stanowisku.
 * Wywołaj ponownie po każdej zmianie kolejności lub przeniesienia
 * operacji między maszynami – to jest "auto-przeliczanie dat".
 */
function ganttBuildSchedule(stData) {
  const allOps = stData.operacje || [];
  const wToku   = allOps.filter(o => o.op_status === 'w_toku');
  const oczekuje = allOps.filter(o => o.op_status === 'oczekuje');

  const schedule = {}; // op_id -> {start, end, totalMin, remainingMin, overTime}
  const now = ganttNow();

  // ── 1. Operacje w toku: zaczynają "teraz", kończą za pozostały czas ──
  let maxEnd = new Date(now);
  for (const o of wToku) {
    const ilosc = Math.max(1, (o.ilosc_sztuk||1) - (o.ilosc_wykonana||0));
    const totalMin = (o.czas_norma||0) * ilosc + (o.czas_zbrojenia_min||0);
    if (totalMin <= 0) continue;
    const elapsed = ganttCalcElapsedMin(o.sesja_start, o.sesja_pauzy);
    const remaining = Math.max(0, totalMin - elapsed);
    const overTime = elapsed > totalMin;
    const end = ganttAddWorkMinutes(new Date(now), remaining);
    schedule[o.op_id] = { start: new Date(now), end, totalMin, remainingMin: remaining, overTime };
    if (end > maxEnd) maxEnd = end;
  }

  // ── 2. Operacje oczekujące: sekwencyjne od końca operacji w toku ──
  // Wskaźnik czasu – automatycznie przesuwa się po każdej operacji.
  let ptr = new Date(maxEnd);
  if (ptr.getHours() < GANTT_WORK_START) ptr.setHours(GANTT_WORK_START, 0, 0, 0);
  else if (ptr.getHours() >= GANTT_WORK_END) {
    ptr.setDate(ptr.getDate()+1);
    ptr.setHours(GANTT_WORK_START, 0, 0, 0);
  }

  for (const o of oczekuje) {
    const ilosc = Math.max(1, (o.ilosc_sztuk||1) - (o.ilosc_wykonana||0));
    const totalMin = (o.czas_norma||0) * ilosc + (o.czas_zbrojenia_min||0);
    if (totalMin <= 0) continue;
    const start = new Date(ptr);
    const end = ganttAddWorkMinutes(start, totalMin);
    schedule[o.op_id] = { start, end, totalMin };
    ptr = new Date(end); // ← każda kolejna operacja zaczyna się po poprzedniej
  }

  return schedule;
}

// ── Główny renderer ───────────────────────────────────────────
function renderGantt() {
  if (state.oblozenieLading) return '<div class="spinner" style="padding:40px;text-align:center">⏳ Ładowanie harmonogramu…</div>';
  const ob = state.oblozenie;
  if (!ob) return '<div style="text-align:center;padding:40px;color:var(--dim)">Kliknij zakładkę aby załadować dane.</div>';
  if (ob.error) return `<div class="error-banner">⚠ ${ob.error}</div><button class="btn-outline" style="margin-top:8px" onclick="loadOblozenie()">🔄 Spróbuj ponownie</button>`;
  if (!ob.length) return '<div class="empty">Brak stanowisk – dodaj stanowiska w ustawieniach lub przypisz do operacji.</div>';

  // Reset palety przy każdym renderze
  Object.keys(_ganttColorCache).forEach(k => delete _ganttColorCache[k]);

  const now = ganttNow();
  const daysAhead = _ganttDaysAheadOverride || GANTT_DAYS_AHEAD;
  const viewStart = new Date(now); viewStart.setHours(GANTT_WORK_START, 0, 0, 0);
  const viewEnd = new Date(viewStart);
  viewEnd.setDate(viewEnd.getDate() + daysAhead);
  viewEnd.setHours(GANTT_WORK_END, 0, 0, 0);

  const totalWorkMins = ganttWorkMinsBetween(viewStart, viewEnd);
  const dayHeaders = _ganttDayHeaders(viewStart, viewEnd);

  let html = `
  <div id="gantt-root" style="position:relative">

  <!-- Toolbar -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px;flex-wrap:wrap">
    <div style="font-size:12px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.6px">
      📅 Harmonogram produkcji
    </div>
    <div style="display:flex;gap:6px;align-items:center">
      <button class="btn-outline" style="padding:6px 10px;font-size:11px;width:auto" onclick="ganttZoom(-1)">🔍−</button>
      <button class="btn-outline" style="padding:6px 10px;font-size:11px;width:auto" onclick="ganttZoom(1)">🔍+</button>
      <button class="btn-outline" style="padding:6px 10px;font-size:11px;width:auto" onclick="loadOblozenie()">🔄</button>
    </div>
  </div>

  <!-- Legenda statusów – pełna semantyczna -->
  <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;padding:8px 10px;background:var(--panel);border-radius:8px;border:1px solid var(--border)">
    <span style="font-size:10px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;align-self:center">Status:</span>
    ${_ganttLegendItem(GANTT_STATUS_COLORS.w_toku, 'W toku')}
    ${_ganttLegendItem(GANTT_STATUS_COLORS.w_toku_over, 'Przekroczona norma')}
    ${_ganttLegendItem(GANTT_STATUS_COLORS.planowana, 'Planowana')}
    ${_ganttLegendItem(GANTT_STATUS_COLORS.opozniona, 'Opóźniona')}
    ${_ganttLegendItem(GANTT_STATUS_COLORS.pilna, 'Pilna (≤3d)')}
    ${_ganttLegendItem(GANTT_STATUS_COLORS.zbrojenie, 'Zbrojenie')}
    ${_ganttLegendItem(GANTT_STATUS_COLORS.koop, 'Kooperacja')}
  </div>

  <!-- Tabela Gantta -->
  <div id="gantt-scroll" style="overflow-x:auto;overflow-y:visible;border-radius:10px;border:1px solid var(--border)">
    <div id="gantt-inner" style="min-width:600px">

      <!-- Wiersz nagłówka -->
      <div style="display:flex;border-bottom:1px solid var(--border)">
        <div style="width:140px;min-width:140px;flex-shrink:0;padding:8px 10px;font-size:10px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;background:var(--panel);border-right:1px solid var(--border)">
          Stanowisko
        </div>
        <div id="gantt-timeline-header" style="flex:1;position:relative;background:var(--panel);overflow:hidden;min-height:36px">
          ${dayHeaders}
        </div>
      </div>

      <!-- Wiersze stanowisk -->
      ${ob.map((st, rowIdx) => _ganttRow(st, rowIdx, viewStart, viewEnd, totalWorkMins)).join('')}

    </div>
  </div>

  <!-- Tooltip -->
  <div id="gantt-tooltip" style="display:none;position:fixed;z-index:9999;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:10px 12px;max-width:280px;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,.4);pointer-events:none"></div>

  <!-- Pasek zapisu (pojawia się po drag & drop) -->
  <div id="gantt-save-bar" style="display:none;position:sticky;bottom:8px;left:0;right:0;z-index:200;margin-top:10px">
    <div style="background:var(--accent);color:#1a1f2e;border-radius:10px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:700;box-shadow:0 4px 16px rgba(232,160,32,.4)">
      <span id="gantt-save-label">💾 Kolejność operacji zmieniona</span>
      <div style="display:flex;gap:8px">
        <button onclick="ganttDiscardChanges()" style="background:rgba(0,0,0,.2);border:none;color:#1a1f2e;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700">Odrzuć</button>
        <button onclick="ganttSaveChanges()" style="background:#1a1f2e;color:var(--accent);border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700">Zapisz zmiany</button>
      </div>
    </div>
  </div>

  </div>`;

  return html;
}

function _ganttLegendItem(color, label) {
  return `<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--dim)">
    <span style="width:12px;height:12px;border-radius:3px;background:${color};display:inline-block;flex-shrink:0"></span>${label}
  </div>`;
}

// ── Nagłówki osi czasu ────────────────────────────────────────
function _ganttDayHeaders(viewStart, viewEnd) {
  const days = [];
  let d = new Date(viewStart); d.setHours(0,0,0,0);
  const endDay = new Date(viewEnd); endDay.setHours(0,0,0,0);
  const totalWorkMins = ganttWorkMinsBetween(viewStart, viewEnd);

  while (d <= endDay) {
    const dayStart = new Date(d); dayStart.setHours(GANTT_WORK_START,0,0,0);
    const dayEnd   = new Date(d); dayEnd.setHours(GANTT_WORK_END,0,0,0);
    const visStart = dayStart > viewStart ? dayStart : viewStart;
    const visEnd   = dayEnd   < viewEnd   ? dayEnd   : viewEnd;
    if (visEnd <= visStart) { d.setDate(d.getDate()+1); continue; }

    const dayMins = ganttWorkMinsBetween(visStart, visEnd);
    const pct = (dayMins / totalWorkMins * 100).toFixed(2);
    const label = d.toLocaleDateString('pl-PL',{weekday:'short',day:'numeric',month:'numeric'});
    const isToday = d.toDateString() === new Date().toDateString();

    days.push(`<div style="display:inline-flex;flex-direction:column;width:${pct}%;border-right:1px solid var(--border);padding:4px 4px 2px;box-sizing:border-box;overflow:hidden">
      <div style="font-size:10px;font-weight:${isToday?'800':'600'};color:${isToday?'var(--accent)':'var(--dim)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${isToday?'🔵 ':''} ${label}</div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--border)">${GANTT_WORK_START}:00<span>${GANTT_WORK_END}:00</span></div>
    </div>`);

    d.setDate(d.getDate()+1);
  }
  return `<div style="display:flex;width:100%;height:100%">${days.join('')}</div>`;
}

// ── Wiersz stanowiska ─────────────────────────────────────────
function _ganttRow(st, rowIdx, viewStart, viewEnd, totalWorkMins) {
  const schedule = ganttBuildSchedule(st); // ← auto-przeliczone daty dla tego stanowiska
  const bg = rowIdx % 2 === 0 ? 'var(--bg)' : 'var(--entry)';
  const ROW_H = 56; // px

  let bars = '';

  // Linia "teraz"
  const now = ganttNow();
  if (now >= viewStart && now <= viewEnd) {
    const nowPct = (ganttWorkMinsBetween(viewStart, now) / totalWorkMins * 100).toFixed(2);
    bars += `<div style="position:absolute;left:${nowPct}%;top:0;bottom:0;width:2px;background:var(--orange);opacity:.8;z-index:5;pointer-events:none">
      <div style="position:absolute;top:0;left:2px;font-size:8px;color:var(--orange);white-space:nowrap;font-weight:700">▼ teraz</div>
    </div>`;
  }

  // Siatka dni
  {
    let d = new Date(viewStart); d.setHours(0,0,0,0);
    const endDay = new Date(viewEnd); endDay.setHours(0,0,0,0);
    while (d <= endDay) {
      const dayStart = new Date(d); dayStart.setHours(GANTT_WORK_START,0,0,0);
      const dayEnd   = new Date(d); dayEnd.setHours(GANTT_WORK_END,0,0,0);
      const visStart = dayStart > viewStart ? dayStart : viewStart;
      const visEnd   = dayEnd   < viewEnd   ? dayEnd   : viewEnd;
      if (visEnd > visStart) {
        const leftPct  = (ganttWorkMinsBetween(viewStart, visStart) / totalWorkMins * 100).toFixed(2);
        const widthPct = (ganttWorkMinsBetween(visStart, visEnd)   / totalWorkMins * 100).toFixed(2);
        bars += `<div style="position:absolute;left:${leftPct}%;width:${widthPct}%;top:0;bottom:0;border-left:1px solid var(--border);box-sizing:border-box;pointer-events:none"></div>`;
      }
      d.setDate(d.getDate()+1);
    }
  }

  // Paski operacji
  const opsWithSched = (st.operacje||[]).filter(o => schedule[o.op_id]);
  opsWithSched.forEach((o, barIdx) => {
    const sched = schedule[o.op_id];
    const opStart = sched.start < viewStart ? viewStart : sched.start;
    const opEnd   = sched.end   > viewEnd   ? viewEnd   : sched.end;
    if (opEnd <= opStart) return;

    const leftPct  = (ganttWorkMinsBetween(viewStart, opStart) / totalWorkMins * 100).toFixed(2);
    const widthPct = (ganttWorkMinsBetween(opStart, opEnd)     / totalWorkMins * 100).toFixed(2);

    const barBg = ganttBarColor(o, sched);
    const statusLabel = ganttStatusLabel(o, sched);
    const isWToku = o.op_status === 'w_toku';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const termin = o.termin ? new Date(o.termin) : null;
    const daysLeft = termin ? Math.ceil((termin - today) / 86400000) : null;
    const prog = o.ilosc_sztuk > 0 ? Math.min(100, Math.round(((o.ilosc_wykonana||0)/o.ilosc_sztuk)*100)) : 0;
    const label = `${o.zlecenie_numer ? o.zlecenie_numer+': ' : ''}${o.op_nazwa}`;

    const tooltipData = JSON.stringify({
      opId: o.op_id,
      zlNr: o.zlecenie_numer,
      zlNazwa: o.zlecenie_nazwa,
      opNazwa: o.op_nazwa,
      status: o.op_status,
      statusLabel,
      prog,
      ilosWyk: o.ilosc_wykonana||0,
      ilosSzt: o.ilosc_sztuk||0,
      termin: o.termin ? o.termin.slice(0,10) : null,
      daysLeft,
      totalMin: sched.totalMin,
      overTime: sched.overTime||false,
      startFmt: _ganttFmtDT(sched.start),
      endFmt: _ganttFmtDT(sched.end),
      stanowisko: st.stanowisko
    }).replace(/"/g,'&quot;');

    // Wzór paska – różny dla w_toku vs planowana
    const barBorder = isWToku
      ? '2px solid rgba(255,255,255,.3)'
      : '1px solid rgba(255,255,255,.12)';

    bars += `<div
      class="gantt-bar"
      data-op-id="${o.op_id}"
      data-stanowisko="${_esc(st.stanowisko)}"
      data-bar-idx="${barIdx}"
      data-zlecenie-id="${o.zlecenie_id}"
      data-total-min="${sched.totalMin}"
      data-status="${o.op_status}"
      data-tooltip="${tooltipData}"
      style="position:absolute;left:${leftPct}%;width:${widthPct}%;top:8px;height:${ROW_H-16}px;
             background:${barBg};opacity:${isWToku?0.97:0.82};border-radius:5px;
             cursor:${isWToku?'default':'grab'};box-sizing:border-box;overflow:hidden;z-index:10;
             border:${barBorder};
             transition:opacity .15s,box-shadow .15s;"
      onmouseenter="ganttBarHover(event,true)"
      onmouseleave="ganttBarHover(event,false)"
      ontouchstart="ganttTouchStart(event)"
      onmousedown="ganttMouseDown(event)">
      <!-- Pasek postępu -->
      ${prog > 0 ? `<div style="position:absolute;bottom:0;left:0;width:${prog}%;height:3px;background:rgba(255,255,255,.55);border-radius:0 0 0 4px"></div>` : ''}
      <!-- Wzór ukośny dla zbrojenia -->
      ${(o.op_nazwa||'').toLowerCase().includes('zbrojenie') ? '<div style="position:absolute;inset:0;background:repeating-linear-gradient(45deg,transparent,transparent 4px,rgba(255,255,255,.08) 4px,rgba(255,255,255,.08) 8px);pointer-events:none"></div>' : ''}
      <!-- Etykieta -->
      <div style="position:absolute;inset:0;display:flex;align-items:center;padding:0 6px;font-size:10px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 3px rgba(0,0,0,.6)">
        ${isWToku ? '▶ ' : ''}${_escText(label)}
      </div>
      <!-- Ikona opóźnienia -->
      ${daysLeft !== null && daysLeft < 0 ? '<div style="position:absolute;top:2px;right:3px;font-size:9px">⚠</div>' : ''}
    </div>`;
  });

  // Puste stanowisko
  if (!opsWithSched.length) {
    bars += `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--border);pointer-events:none">brak zaplanowanych operacji</div>`;
  }

  return `<div style="display:flex;border-bottom:1px solid var(--border);min-height:${ROW_H}px;background:${bg}"
    data-stanowisko="${_esc(st.stanowisko)}"
    class="gantt-row">

    <!-- Label stanowiska -->
    <div style="width:140px;min-width:140px;flex-shrink:0;padding:8px 10px;border-right:1px solid var(--border);background:var(--panel);display:flex;flex-direction:column;justify-content:center">
      <div style="font-size:11px;font-weight:700;color:var(--text);line-height:1.2">${_escText(st.stanowisko)}</div>
      <div style="font-size:9px;color:var(--dim);margin-top:2px">${(st.operacje||[]).length} op.</div>
    </div>

    <!-- Obszar wykresu -->
    <div style="flex:1;position:relative;overflow:hidden;min-height:${ROW_H}px"
      data-stanowisko="${_esc(st.stanowisko)}"
      class="gantt-track"
      onmousemove="ganttTrackMouseMove(event)"
      onmouseup="ganttMouseUp(event)">
      ${bars}
    </div>
  </div>`;
}

function _ganttFmtDT(date) {
  if (!date) return '—';
  return date.toLocaleDateString('pl-PL',{weekday:'short',day:'numeric',month:'numeric'})
    + ' ' + ('0'+date.getHours()).slice(-2)+':'+('0'+date.getMinutes()).slice(-2);
}

function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function _escText(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Zoom ─────────────────────────────────────────────────────
let _ganttZoomDays = GANTT_DAYS_AHEAD;
let _ganttDaysAheadOverride = null;

function ganttZoom(dir) {
  _ganttZoomDays = Math.max(2, Math.min(21, _ganttZoomDays - dir));
  _ganttDaysAheadOverride = _ganttZoomDays;
  const root = document.getElementById('gantt-root');
  if (!root || !state.oblozenie) return;
  root.outerHTML = renderGantt();
  ganttAttachEvents();
}

// ── Tooltip ───────────────────────────────────────────────────
function ganttBarHover(e, show) {
  const tip = document.getElementById('gantt-tooltip');
  if (!tip) return;
  if (!show) { tip.style.display = 'none'; return; }
  const bar = e.currentTarget;
  const raw = bar.getAttribute('data-tooltip');
  if (!raw) return;
  let d;
  try { d = JSON.parse(raw.replace(/&quot;/g,'"')); } catch(_) { return; }

  const terminHtml = d.termin
    ? `<div style="margin-top:4px;padding:4px 6px;border-radius:4px;background:${d.daysLeft<0?'rgba(231,76,60,.15)':d.daysLeft<=3?'rgba(230,126,34,.15)':'rgba(39,174,96,.1)'};color:${d.daysLeft<0?'var(--red)':d.daysLeft<=3?'var(--orange)':'var(--green)'}">📅 Termin: ${d.termin} (${d.daysLeft<0?'⚠ '+Math.abs(d.daysLeft)+'d po terminie':d.daysLeft===0?'dziś':d.daysLeft+'d'})</div>`
    : '';

  tip.innerHTML = `
    <div style="font-weight:700;font-size:13px;color:var(--text);margin-bottom:2px">${_escText(d.zlNr||'')} ${_escText(d.opNazwa||'')}</div>
    <div style="color:var(--dim);font-size:11px;margin-bottom:6px">${_escText(d.zlNazwa||'')}</div>
    <div style="font-size:10px;color:var(--dim);margin-bottom:6px">🏭 ${_escText(d.stanowisko||'')}</div>
    <div style="font-size:11px;display:flex;flex-direction:column;gap:3px">
      <div style="font-weight:600;color:var(--text)">${d.statusLabel||d.status}${d.overTime?' <span style="color:var(--orange)">⚠ po normie</span>':''}</div>
      <div>🕐 Start: <b>${d.startFmt}</b></div>
      <div>🏁 Koniec: <b>${d.endFmt}</b></div>
      <div style="color:var(--dim)">⏱ Czas: ${d.totalMin >= 60 ? (d.totalMin/60).toFixed(1)+'h' : d.totalMin+' min'}</div>
      ${d.ilosSzt > 0 ? `<div>📦 ${d.ilosWyk}/${d.ilosSzt} szt. (${d.prog}%)</div>` : ''}
      ${terminHtml}
      ${d.status === 'oczekuje' ? '<div style="color:var(--dim);font-size:10px;margin-top:4px;padding-top:4px;border-top:1px solid var(--border)">✋ Przeciągnij aby zmienić kolejność lub stanowisko</div>' : ''}
    </div>`;
  tip.style.display = 'block';
  _ganttPositionTooltip(e);
}

function _ganttPositionTooltip(e) {
  const tip = document.getElementById('gantt-tooltip');
  if (!tip || tip.style.display==='none') return;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = e.clientX + 14, top = e.clientY + 14;
  if (left + 290 > vw) left = e.clientX - 290;
  if (top + 220 > vh) top = e.clientY - 220;
  tip.style.left = left + 'px';
  tip.style.top  = top  + 'px';
}

function ganttTrackMouseMove(e) {
  if (_ganttDrag && _ganttDrag.dragging) return;
  _ganttPositionTooltip(e);
}

// ── Drag & Drop ───────────────────────────────────────────────
// Po upuszczeniu operacji na stanowisko:
//   1. Operacja przenosi się do nowego stanowiska (lub zmienia kolejność)
//   2. Daty wszystkich operacji na obu stanowiskach są **automatycznie przeliczane**
//      przez ganttBuildSchedule() wywołane przy kolejnym renderze.

let _ganttPendingChanges = [];

function ganttMouseDown(e) {
  const bar = e.currentTarget;
  const status = bar.getAttribute('data-status');
  if (status === 'w_toku') return;
  e.preventDefault();

  const opId = parseInt(bar.getAttribute('data-op-id'));
  const stanowisko = bar.getAttribute('data-stanowisko');

  _ganttDrag = {
    opId, stanowisko,
    startX: e.clientX,
    startY: e.clientY,
    bar,
    dragging: false,
    ghost: null
  };

  document.addEventListener('mousemove', ganttGlobalMouseMove);
  document.addEventListener('mouseup', ganttGlobalMouseUp);
}

function ganttGlobalMouseMove(e) {
  if (!_ganttDrag) return;
  const dx = e.clientX - _ganttDrag.startX;
  const dy = e.clientY - _ganttDrag.startY;

  if (!_ganttDrag.dragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
    _ganttDrag.dragging = true;
    const ghost = document.createElement('div');
    const rect = _ganttDrag.bar.getBoundingClientRect();
    ghost.style.cssText = `position:fixed;z-index:9998;pointer-events:none;
      width:${rect.width}px;height:${rect.height}px;
      background:var(--accent);color:#1a1f2e;
      border-radius:5px;font-size:10px;font-weight:700;
      display:flex;align-items:center;padding:0 6px;
      opacity:.85;box-shadow:0 4px 20px rgba(0,0,0,.5);
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
    ghost.textContent = _ganttDrag.bar.querySelector('div[style*="font-size:10px"]')?.textContent?.trim() || '…';
    document.body.appendChild(ghost);
    _ganttDrag.ghost = ghost;
    _ganttDrag.bar.style.opacity = '0.3';
    const tip = document.getElementById('gantt-tooltip');
    if (tip) tip.style.display = 'none';
  }

  if (_ganttDrag.dragging && _ganttDrag.ghost) {
    _ganttDrag.ghost.style.left = (e.clientX - 20) + 'px';
    _ganttDrag.ghost.style.top  = (e.clientY - 16) + 'px';

    // Podświetl target track
    document.querySelectorAll('.gantt-track').forEach(t => t.style.background = '');
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el) {
      const track = el.closest('.gantt-track');
      if (track) {
        const isSameSt = track.getAttribute('data-stanowisko') === _ganttDrag.stanowisko;
        track.style.background = isSameSt
          ? 'rgba(74,144,217,.12)'
          : 'rgba(232,160,32,.15)'; // żółty = zmiana stanowiska
      }
    }
  }
}

function ganttGlobalMouseUp(e) {
  document.removeEventListener('mousemove', ganttGlobalMouseMove);
  document.removeEventListener('mouseup', ganttGlobalMouseUp);
  if (!_ganttDrag) return;

  if (_ganttDrag.dragging) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const targetTrack = el ? el.closest('.gantt-track') : null;
    const targetStanowisko = targetTrack ? targetTrack.getAttribute('data-stanowisko') : null;

    if (targetStanowisko) {
      const rect = targetTrack.getBoundingClientRect();
      const xRel = (e.clientX - rect.left) / rect.width;
      const bars = Array.from(targetTrack.querySelectorAll('.gantt-bar:not([data-status="w_toku"])'));
      let insertBefore = bars.length;
      for (let i = 0; i < bars.length; i++) {
        const br = bars[i].getBoundingClientRect();
        const barCenterRel = (br.left + br.width/2 - rect.left) / rect.width;
        if (xRel < barCenterRel) { insertBefore = i; break; }
      }
      _ganttApplyDragChange(_ganttDrag.opId, _ganttDrag.stanowisko, targetStanowisko, insertBefore);
    }

    if (_ganttDrag.ghost) _ganttDrag.ghost.remove();
    document.querySelectorAll('.gantt-track').forEach(t => t.style.background = '');
    if (_ganttDrag.bar) _ganttDrag.bar.style.opacity = '';
  }

  _ganttDrag = null;
}

/**
 * Zastosuj zmianę pozycji operacji.
 * Po każdej zmianie ganttBuildSchedule() przeliczy daty wszystkich operacji
 * na obu stanowiskach automatycznie przy kolejnym renderze.
 */
function _ganttApplyDragChange(opId, fromSt, toSt, insertIdx) {
  const ob = state.oblozenie;
  if (!ob) return;

  let srcStData = ob.find(s => s.stanowisko === fromSt);
  let tgtStData = ob.find(s => s.stanowisko === toSt);
  if (!srcStData || !tgtStData) return;

  const opIdx = srcStData.operacje.findIndex(o => o.op_id === opId);
  if (opIdx === -1) return;
  const op = srcStData.operacje[opIdx];
  if (op.op_status === 'w_toku') return;

  const changedSt = fromSt !== toSt;

  // Usuń ze źródła
  srcStData.operacje.splice(opIdx, 1);

  // Wstaw do celu (za operacje w_toku)
  const tgtWToku    = tgtStData.operacje.filter(o => o.op_status === 'w_toku');
  const tgtOczekuje = tgtStData.operacje.filter(o => o.op_status !== 'w_toku');
  const clampedIdx = Math.max(0, Math.min(insertIdx, tgtOczekuje.length));

  if (changedSt) op.stanowisko = toSt;
  tgtOczekuje.splice(clampedIdx, 0, op);
  tgtStData.operacje = [...tgtWToku, ...tgtOczekuje];

  // Przelicz kolejnosc (1-based)
  tgtStData.operacje.forEach((o, i) => { o._newKolejnosc = i + 1; });
  if (changedSt && srcStData.operacje.length) {
    srcStData.operacje.forEach((o, i) => { o._newKolejnosc = i + 1; });
  }

  _ganttPendingChanges.push({ opId, fromSt, toSt, newKolejnosc: clampedIdx + 1, op });

  // Aktualizuj etykietę paska zapisu
  const changedCount = new Set(_ganttPendingChanges.map(c => c.opId)).size;
  const movedStations = _ganttPendingChanges.filter(c => c.fromSt !== c.toSt).length;

  // ── Przerenduj (ganttBuildSchedule wykona auto-przeliczenie dat) ──
  setState({ oblozenie: [...ob] }, true);
  const root = document.getElementById('gantt-root');
  if (root) {
    root.outerHTML = renderGantt();
    ganttAttachEvents();
  }

  // Aktualizuj etykietę
  const saveLabel = document.getElementById('gantt-save-label');
  if (saveLabel) {
    const parts = [`💾 ${changedCount} op. zmodyfikowanych`];
    if (movedStations > 0) parts.push(`• ${movedStations} przeniesień`);
    saveLabel.textContent = parts.join(' ');
  }

  const saveBar = document.getElementById('gantt-save-bar');
  if (saveBar) saveBar.style.display = _ganttPendingChanges.length ? 'block' : 'none';
}

// ── Touch ─────────────────────────────────────────────────────
function ganttTouchStart(e) {
  const touch = e.touches[0];
  const fakeEvt = { clientX: touch.clientX, clientY: touch.clientY, currentTarget: e.currentTarget, preventDefault: ()=>e.preventDefault() };
  ganttMouseDown(fakeEvt);
  document.addEventListener('touchmove', _ganttTouchMove, {passive:false});
  document.addEventListener('touchend', _ganttTouchEnd);
}
function _ganttTouchMove(e) {
  e.preventDefault();
  const touch = e.touches[0];
  ganttGlobalMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
}
function _ganttTouchEnd(e) {
  document.removeEventListener('touchmove', _ganttTouchMove);
  document.removeEventListener('touchend', _ganttTouchEnd);
  const touch = e.changedTouches[0];
  ganttGlobalMouseUp({ clientX: touch.clientX, clientY: touch.clientY });
}

// ── Zapis zmian ───────────────────────────────────────────────
async function ganttSaveChanges() {
  if (!_ganttPendingChanges.length) return;
  const saveBar = document.getElementById('gantt-save-bar');
  if (saveBar) saveBar.innerHTML = '<div style="text-align:center;padding:10px;color:#1a1f2e;font-weight:700">⏳ Zapisywanie…</div>';

  const ob = state.oblozenie;
  const errors = [];
  const changedOps = new Set(_ganttPendingChanges.map(c => c.opId));
  const allOps = (ob||[]).flatMap(st => st.operacje.map(o => ({...o, stanowisko: st.stanowisko})));

  for (const op of allOps) {
    if (!changedOps.has(op.op_id)) continue;
    try {
      await put(`/api/operacje/${op.op_id}`, {
        zlecenie_id: op.zlecenie_id,
        nazwa: op.op_nazwa,
        kolejnosc: op._newKolejnosc ?? op.op_kolejnosc,
        czas_norma: op.czas_norma || 0,
        stanowisko: op.stanowisko,
        opis_czynnosci: op.opis_czynnosci || '',
        czas_zbrojenia_min: op.czas_zbrojenia_min || 0
      });
    } catch(err) {
      errors.push(`Op #${op.op_id}: ${err.message}`);
    }
  }

  _ganttPendingChanges = [];

  if (errors.length) {
    alert('Błędy podczas zapisu:\n' + errors.join('\n'));
  }

  await loadOblozenie();
}

function ganttDiscardChanges() {
  _ganttPendingChanges = [];
  loadOblozenie();
}

// ── Mouse up na tracku ────────────────────────────────────────
function ganttMouseUp(e) {
  // Obsługa przez ganttGlobalMouseUp
}

// ── Attach events po renderze ─────────────────────────────────
function ganttAttachEvents() {
  const root = document.getElementById('gantt-root');
  if (!root) return;
  root.addEventListener('mousemove', e => {
    if (_ganttDrag && _ganttDrag.dragging) return;
    _ganttPositionTooltip(e);
  });
}
