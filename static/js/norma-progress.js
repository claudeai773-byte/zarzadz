// ═══════════════════════════════════════════════════════════════════════════════
// PATCH 2 – Pasek postępu normy dla pracownika podczas sesji
// Dodaj do pliku z renderowaniem zakładki "Praca" (renderPracownik / renderSesje)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Wymagania:
//  • Sesja (obiekt z state.aktywnesje) musi zawierać:
//      czas_norma     – norma operacji w min/szt (z operacji)
//      ilosc_sztuk    – docelowa ilość zlecenia
//      czas_start     – ISO timestamp startu sesji
//  • Czas bieżący obliczamy z state.timers (istniejący mechanizm timerów)
//    lub z Date.now() na bieżąco.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Oblicz postęp normy dla jednej sesji ─────────────────────────────────────
// Zwraca obiekt:
//   { elapsed_min, norma_total_min, pct, color, label, eta_label }
function nzNormaProgress(sesja) {
  if (!sesja) return null;

  // Czas trwania sesji w minutach (bez pauz)
  const elapsed_min = _sesjaElapsedMin(sesja);

  // Norma całkowita = czas_norma (min/szt) × ilosc_sztuk
  // sesja.czas_norma może być bezpośrednio na sesji lub na operacji
  const normaSzt  = parseFloat(sesja.czas_norma || sesja.op_czas_norma || 0);
  const ilosc     = parseInt(sesja.ilosc_sztuk || sesja.op_ilosc_sztuk || 1);
  const norma_total_min = normaSzt * ilosc;

  if (norma_total_min <= 0) return null;   // brak normy – nie pokazuj

  const pct = Math.min(100, Math.round(elapsed_min / norma_total_min * 100));
  const over = elapsed_min > norma_total_min;
  const remaining = Math.max(0, norma_total_min - elapsed_min);

  // Kolor
  let color;
  if (pct < 70)      color = 'var(--green, #4ade80)';
  else if (pct < 90) color = 'var(--accent, #f59e0b)';
  else if (pct < 100)color = 'var(--orange, #f97316)';
  else               color = 'var(--red, #f87171)';

  // Etykiety
  const label     = over
    ? `+${fmtMin(elapsed_min - norma_total_min)} ponad normę`
    : `zostało ~${fmtMin(remaining)}`;

  const eta_label = over
    ? `⚠ Przekroczono normę o ${fmtMin(elapsed_min - norma_total_min)}`
    : `⏱ Czas w normie: ${fmtMin(elapsed_min)} / ${fmtMin(norma_total_min)}`;

  return { elapsed_min, norma_total_min, pct, color, label, eta_label, over };
}

// ── Formatuj minuty → "Xh Ym" lub "Xm" ──────────────────────────────────────
function fmtMin(min) {
  const m = Math.round(min);
  if (m >= 60) return `${Math.floor(m/60)}h ${m%60}m`;
  return `${m}m`;
}

// ── Elapsed bez pauz (korzysta z istniejącego state.timers) ──────────────────
function _sesjaElapsedMin(sesja) {
  // Preferuj istniejący timer z state (np. { elapsed_s: X })
  const timer = (state.timers || {})[sesja.id];
  if (timer && timer.elapsed_s != null) {
    return timer.elapsed_s / 60;
  }
  // Fallback: oblicz z czas_start
  if (sesja.czas_start) {
    const diffMs = Date.now() - new Date(sesja.czas_start).getTime();
    const pausaMs = (sesja.pauza_laczna_s || 0) * 1000;
    return Math.max(0, (diffMs - pausaMs) / 60000);
  }
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── Render paska normy – wklej w kartę sesji w renderPracownik() ─────────────
// ═══════════════════════════════════════════════════════════════════════════════
function renderNormaBar(sesja) {
  const p = nzNormaProgress(sesja);
  if (!p) return '';     // brak normy → nic nie pokazuj

  const pctCapped = Math.min(100, p.pct);

  // Animowany pasek gdy >90%
  const pulse = p.pct >= 90
    ? `animation:norma-pulse 1.2s ease-in-out infinite`
    : '';

  return `
  <div style="margin-top:10px;padding:10px 12px;background:rgba(15,23,42,0.6);
              border:1px solid #1e293b;border-radius:8px">

    <!-- Nagłówek -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px">
        📊 Norma czasu
      </span>
      <span style="font-size:11px;font-weight:700;color:${p.color}">
        ${p.pct}%
      </span>
    </div>

    <!-- Pasek postępu -->
    <div style="height:8px;background:#1e293b;border-radius:4px;overflow:hidden;position:relative">
      <div style="height:100%;width:${pctCapped}%;background:${p.color};
                  border-radius:4px;transition:width .5s ease;${pulse}"></div>
      ${p.pct > 100 ? `
      <!-- Pasek nadgodzin (drugi, czerwony warstwy) -->
      <div style="position:absolute;top:0;right:0;height:100%;width:${Math.min(30, p.pct-100)}%;
                  background:repeating-linear-gradient(45deg,#f8717133 0,#f8717133 4px,transparent 4px,transparent 8px);
                  border-radius:0 4px 4px 0"></div>` : ''}
    </div>

    <!-- Szczegóły -->
    <div style="display:flex;justify-content:space-between;margin-top:5px">
      <span style="font-size:11px;color:${p.over ? p.color : '#64748b'}">${p.eta_label}</span>
      <span style="font-size:11px;color:#475569">${p.label}</span>
    </div>

    ${p.over ? `
    <div style="margin-top:6px;font-size:11px;color:#f87171;font-weight:600;
                background:rgba(248,113,113,0.08);border-radius:4px;padding:4px 8px">
      ⚠ Czas normy przekroczony – zgłoś majstrowi
    </div>` : ''}
  </div>

  <style>
    @keyframes norma-pulse {
      0%,100% { opacity:1 }
      50%      { opacity:.65 }
    }
  </style>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INSTRUKCJA INTEGRACJI – zakładka Praca (renderPracownik)
// ═══════════════════════════════════════════════════════════════════════════════
//
// W miejscu gdzie renderujesz kartę aktywnej sesji pracownika (zwykle w pętli
// po state.aktywnesje), po linii z paskiem postępu ilości sztuk dodaj:
//
//   ${renderNormaBar(sesja)}
//
// Przykład (wewnątrz karty sesji):
//
//   <!-- istniejący timer/czas -->
//   <div>⏱ ${formatTimer(sesja)}</div>
//
//   <!-- NOWY pasek normy -->
//   ${renderNormaBar(sesja)}
//
// Upewnij się, że obiekt sesji zawiera pola:
//   sesja.czas_norma    (min/szt, z operacji)
//   sesja.ilosc_sztuk   (z zlecenia)
//   sesja.czas_start    (ISO timestamp)
//
// Jeśli API nie zwraca czas_norma w sesji, pobierz z powiązanej operacji:
//   const op = (state.operacje||[]).find(o => o.id === sesja.operacja_id);
//   sesja.czas_norma = op?.czas_norma || 0;
//   sesja.ilosc_sztuk = op?.ilosc_sztuk || 1;
// ═══════════════════════════════════════════════════════════════════════════════
