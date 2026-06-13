//  TIMERS (multi-sesja)
// ══════════════════════════════════════════════════════════════
function startTimerFor(sesja) {
  if (state.timers[sesja.id]?.interval) clearInterval(state.timers[sesja.id].interval);
  const isPaused = () => {
    const pauzy = JSON.parse(sesja.pauzy || '[]');
    return pauzy.length > 0 && !pauzy[pauzy.length-1].koniec;
  };
  const update = () => {
    const el = document.getElementById('timer-'+sesja.id);
    if (!el) return;
    const paused = isPaused();
    // calc elapsed minus pauses
    const start = parseServerDT(sesja.start_time);
    let elapsed = Math.floor((Date.now() - start) / 1000);
    const pauzy = JSON.parse(sesja.pauzy || '[]');
    for (const p of pauzy) {
      if (p.koniec) {
        elapsed -= Math.floor((parseServerDT(p.koniec) - parseServerDT(p.start)) / 1000);
      } else {
        elapsed -= Math.floor((Date.now() - parseServerDT(p.start)) / 1000);
      }
    }
    el.textContent = fmtTime(Math.max(0,elapsed));
    el.style.color = paused ? 'var(--orange)' : 'var(--green)';
  };
  update();
  const interval = setInterval(update, 1000);
  state.timers[sesja.id] = {interval, sesja};
}

function stopAllTimers() {
  for (const t of Object.values(state.timers)) {
    if (t.interval) clearInterval(t.interval);
  }
  state.timers = {};
}

function fmtTime(sec) {
  const h = String(Math.floor(sec/3600)).padStart(2,'0');
  const m = String(Math.floor((sec%3600)/60)).padStart(2,'0');
  const s = String(sec%60).padStart(2,'0');
  return `${h}:${m}:${s}`;
}

// Serwer zwraca UTC z 'Z'. Dla starszych rekordów bez 'Z' – local time.
function parseServerDT(s) {
  if (!s) return new Date(NaN);
  if (/Z$|[+-]\d{2}:\d{2}$/.test(s)) return new Date(s);
  return new Date(s.replace(' ','T')); // stary rekord – local
}

function isPaused(sesja) {
  const pauzy = JSON.parse(sesja.pauzy || '[]');
  return pauzy.length > 0 && !pauzy[pauzy.length-1].koniec;
}

// ══════════════════════════════════════════════════════════════
