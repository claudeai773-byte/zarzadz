//  MODAL SZCZEGÓŁÓW PODZLECENIA P
// ══════════════════════════════════════════════════════════════

// Otwórz modal operacji dla podzlecenia P (z zamknięciem modalu szczegółów)
async function openPodZlecenieOperacje(zid, numer, nazwa) {
  setState({ podZlecenieModal: null });
  const zlecenie = { id: zid, numer, nazwa };
  setState({ operacjeModal: { zlecenie, operacje: [], loading: true } });
  try {
    const ops = await get(`/api/zlecenia/${zid}/operacje`);
    setState({ operacjeModal: { zlecenie, operacje: ops, loading: false } });
  } catch(e) { alert(e.message); }
}

async function openPodZlecenieModal(zid, parentGid) {
  // Zachowaj parentGid z poprzedniego stanu jeśli nie przekazano nowego
  const prevGid = parentGid || (state.podZlecenieModal && state.podZlecenieModal.parentGid) || null;
  setState({ podZlecenieModal: { loading: true, zid, parentGid: prevGid } });
  try {
    const [zlecenie, operacje, drzewo, zapotrz, matsM] = await Promise.all([
      get(`/api/zlecenia/${zid}`),
      get(`/api/zlecenia/${zid}/operacje`),
      get(`/api/zlecenia/${zid}/drzewo`).catch(() => ({ polprodukty: [], materialy: [], operacje: [] })),
      get(`/api/zlecenia/${zid}/zapotrzebowania`).catch(() => []),
      get(`/api/zlecenia/${zid}/materialy-zlecenia`).catch(() => []),
    ]);
    // Użyj materiałów z /drzewo; jeśli puste – fallback do /materialy-zlecenia
    const materialy = (drzewo.materialy && drzewo.materialy.length)
      ? drzewo.materialy
      : (matsM || []);
    setState({
      podZlecenieModal: {
        loading: false, zid,
        parentGid: prevGid,
        zlecenie,
        operacje: operacje || [],
        materialy,
        polprodukty: drzewo.polprodukty || [],
        zapotrzebowania: zapotrz || [],
      }
    });
  } catch(e) {
    setState({ podZlecenieModal: null });
    alert('Blad ladowania podzlecenia: ' + e.message);
  }
}

function renderPodZlecenieModal() {
  const m = state.podZlecenieModal;
  if (!m) return '';

  if (m.loading) {
    return `<div class="modal-overlay" onclick="if(event.target===this)setState({podZlecenieModal:null})">
      <div class="modal" style="text-align:center;padding:40px">
        <div style="font-size:32px;margin-bottom:12px">⏳</div>
        <div style="color:var(--dim)">Ladowanie podzlecenia...</div>
      </div>
    </div>`;
  }

  const z = m.zlecenie || {};
  const ops = m.operacje || [];
  const mats = m.materialy || [];
  const pols = m.polprodukty || [];
  const zaps = m.zapotrzebowania || [];

  const statusColors = {
    nowe: 'var(--blue)', w_toku: 'var(--accent)', zakonczone: 'var(--green)',
    anulowane: 'var(--dim)', wstrzymane: 'var(--red)'
  };
  const stCol = statusColors[z.status] || 'var(--dim)';

  // Operacje
  let opsHtml = '';
  if (ops.length) {
    opsHtml = ops.map(op => {
      const stColor = op.status === 'zakonczona' ? 'var(--green)' : op.status === 'oczekuje' ? 'var(--dim)' : 'var(--accent)';
      const done = op.status === 'zakonczona';
      return `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid rgba(46,53,72,0.5)">
        <span style="color:${stColor};font-size:16px;margin-top:1px">${done ? '✓' : '○'}</span>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:${done ? 'var(--dim)' : 'var(--text)'};${done ? 'text-decoration:line-through' : ''}">${op.kolejnosc}. ${op.nazwa}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:3px">
            ${op.stanowisko ? `<span style="font-size:11px;color:var(--blue);background:rgba(52,152,219,.1);border-radius:4px;padding:1px 6px">${op.stanowisko}</span>` : ''}
            ${op.czas_norma ? `<span style="font-size:11px;color:var(--dim)">⏱ ${op.czas_norma} min/szt</span>` : ''}
            ${op.czas_zbrojenia_min > 0 ? `<span style="font-size:11px;color:var(--orange)">⚙ zbr: ${op.czas_zbrojenia_min} min</span>` : ''}
          </div>
          ${op.opis_czynnosci ? `<div style="font-size:11px;color:var(--dim);margin-top:3px;font-style:italic">${op.opis_czynnosci}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  } else {
    opsHtml = `<div style="color:var(--dim);font-size:12px;padding:8px 0;text-align:center">Brak operacji</div>`;
  }

  // Materialy M
  let matsHtml = '';
  if (mats.length) {
    matsHtml = mats.map(mat => `
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(46,53,72,0.4)">
        <span style="color:var(--orange);font-size:12px">■</span>
        <span style="font-size:12px;font-weight:600;color:var(--orange);min-width:60px">${mat.indeks}</span>
        <span style="font-size:12px;flex:1;color:var(--text)">${mat.opis}</span>
        <span style="font-size:11px;color:var(--dim)">${mat.ilosc} ${mat.jednostka}</span>
      </div>`).join('');
  }

  // Polprodukty
  let polsHtml = '';
  if (pols.length) {
    polsHtml = pols.map(p => `
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(46,53,72,0.4)">
        <span style="color:#a78bfa;font-size:12px">◆</span>
        <span style="font-size:12px;font-weight:600;color:#a78bfa;min-width:60px">${p.symbol}</span>
        <span style="font-size:12px;flex:1;color:var(--text)">${p.nazwa}</span>
        <span style="font-size:11px;color:var(--dim)">${p.ilosc} ${p.jednostka}</span>
      </div>`).join('');
  }

  // Podzlecenia P (zagniezdzone)
  let zapsHtml = '';
  if (zaps.length) {
    zapsHtml = zaps.map(zap => {
      const ps = zap.zlecenie_p_status || '—';
      const pCol = ps === 'zakonczone' ? 'var(--green)' : ps === 'w_toku' ? 'var(--accent)' : 'var(--dim)';
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(46,53,72,0.4);${zap.zlecenie_p_id ? 'cursor:pointer' : ''}"
        ${zap.zlecenie_p_id ? `onclick="setState({podZlecenieModal:null});openPodZlecenieModal(${zap.zlecenie_p_id})"` : ''}>
        <span style="color:#a78bfa;font-size:12px">◆</span>
        <span style="font-size:12px;font-weight:600;color:#a78bfa;flex:1">${zap.wyrob_p_symbol}</span>
        <span style="font-size:11px;color:var(--dim)">${zap.ilosc_wymagana} szt.</span>
        <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(139,92,246,0.12);color:${pCol}">${ps}</span>
        ${zap.zlecenie_p_id ? '<span style="font-size:10px;color:var(--dim)">▶</span>' : ''}
      </div>`;
    }).join('');
  }

  const canEdit = ['admin', 'technolog', 'majster'].includes(state.user?.role);

  return `<div class="modal-overlay" onclick="if(event.target===this)setState({podZlecenieModal:null})">
    <div class="modal" style="max-width:540px;padding:0;display:flex;flex-direction:column;max-height:92vh">

      <!-- Header -->
      <div style="padding:16px 18px 12px;border-bottom:1px solid var(--border);flex-shrink:0">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1">
            <div style="font-size:11px;color:#a78bfa;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Podzlecenie P</div>
            <div style="font-size:18px;font-weight:700;color:#a78bfa">${z.numer || '—'}</div>
            <div style="font-size:12px;color:var(--dim);margin-top:2px">${z.nazwa || ''}</div>
            <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;align-items:center">
              <span style="font-size:11px;font-weight:700;color:${stCol};background:rgba(0,0,0,.2);padding:2px 8px;border-radius:10px">${z.status || '—'}</span>
              <span style="font-size:11px;color:var(--dim)">📦 ${z.ilosc_sztuk || 1} szt.</span>
              ${z.termin ? `<span style="font-size:11px;color:var(--dim)">📅 ${z.termin.slice(0,10)}</span>` : ''}
              <span style="font-size:11px;color:var(--dim)">${ops.length} operacji</span>
            </div>
          </div>
          <button onclick="setState({podZlecenieModal:null})" style="background:var(--entry);border:none;color:var(--text);font-size:20px;width:36px;height:36px;border-radius:50%;cursor:pointer;flex-shrink:0">×</button>
        </div>
      </div>

      <!-- Body -->
      <div style="flex:1;overflow-y:auto;padding:16px 18px">

        <!-- Operacje -->
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--dim);letter-spacing:.8px;margin-bottom:6px">🔧 Operacje (${ops.length})</div>
        <div style="margin-bottom:16px">${opsHtml}</div>

        <!-- Materiały M -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--dim);letter-spacing:.8px;flex:1">📦 Materiały M (${mats.length})</div>
          ${canEdit ? `<button onclick="setState({pmModal:{typ:'material',zid:${z.id},item:null}})" style="background:rgba(243,156,18,0.15);color:var(--orange);border:1px solid rgba(243,156,18,0.3);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;font-weight:600">+ Dodaj</button>` : ''}
        </div>
        <div style="margin-bottom:16px">
          ${mats.length ? matsHtml : `<div style="color:var(--dim);font-size:12px;padding:6px 0;font-style:italic">Brak materiałów</div>`}
        </div>

        ${pols.length ? `
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--dim);letter-spacing:.8px;margin-bottom:6px">🔩 Polprodukty P (${pols.length})</div>
        <div style="margin-bottom:16px">${polsHtml}</div>` : ''}

        ${zaps.length ? `
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--dim);letter-spacing:.8px;margin-bottom:6px">🔩 Podzlecenia zagniezdzone (${zaps.length})</div>
        <div style="margin-bottom:16px">${zapsHtml}</div>` : ''}

      </div>

      <!-- Footer -->
      <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0">
        ${canEdit ? `
        <button onclick="openPodZlecenieOperacje(${z.id},'${(z.numer||'').replace(/'/g,"\\'")}','${(z.nazwa||'').replace(/'/g,"\\'")}')"
          style="background:var(--blue);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;font-weight:600">🔧 Edytuj operacje</button>
        ` : ''}
        <button onclick="setState({podZlecenieModal:null});openPodZlecenieModal(${z.id})"
          style="background:var(--entry);color:var(--dim);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer">↺ Odswiezz</button>
        <button onclick="setState({podZlecenieModal:null})"
          style="background:var(--entry);color:var(--dim);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;margin-left:auto">Zamknij</button>
      </div>
    </div>
  </div>`;
}

// (Funkcja render() została scalona z tą w render.js – zobacz tam.
//  Wcześniej druga, niezależna definicja render() w tym pliku nadpisywała
//  render.js i przez to autouzupełnianie fraz nigdy się nie podpinało.)


// ══════════════════════════════════════════════════════════════
