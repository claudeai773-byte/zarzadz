/* =========================================================
   Stawki per zlecenie – moduł UI
   Wymaga: globalne zmienne SERVER_URL, API_KEY
   ========================================================= */
(function(){
  'use strict';
  const ZMODYFIKOWANY_STYLE = 'background:rgba(232,160,32,0.12);';

  window.__stawkiZl_currentZid = null;

  function _getServerUrl() {
    // Priorytet: window.SERVER_URL (let z index.html) → localStorage
    if (typeof window.SERVER_URL !== 'undefined' && window.SERVER_URL) return window.SERVER_URL;
    try {
      const cfg = JSON.parse(localStorage.getItem('produkcja_config') || '{}');
      return cfg.server_url || '';
    } catch(_) { return ''; }
  }

  function _getApiKey() {
    if (typeof window.API_KEY !== 'undefined' && window.API_KEY) return window.API_KEY;
    try {
      const cfg = JSON.parse(localStorage.getItem('produkcja_config') || '{}');
      return cfg.api_key || '';
    } catch(_) { return ''; }
  }

  async function _api(path, opts = {}) {
    const url = _getServerUrl().replace(/\/$/, '') + path;
    const headers = { 'x-api-key': _getApiKey(), ...(opts.headers || {}) };
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, { ...opts, headers });
    if (!res.ok) {
      const txt = await res.text();
      let msg = txt;
      try { const p = JSON.parse(txt); if (p.detail) msg = p.detail; } catch(_){}
      throw new Error(`API ${res.status}: ${msg}`);
    }
    return res.json();
  }

  window.openStawkiZleceniaModal = async function(zid, zlNumer, zlNazwa) {
    window.__stawkiZl_currentZid = zid;
    const existing = document.getElementById('stawki-zl-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'stawki-zl-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);';
    overlay.innerHTML = `
      <div style="background:#1a1f2e;color:#e8eaf0;border-radius:12px;width:100%;max-width:900px;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        <div style="padding:20px 24px;border-bottom:1px solid #2a3040;display:flex;align-items:center;gap:12px;">
          <div style="flex:1">
            <h2 style="margin:0;font-size:20px;">⚙ Stawki zlecenia <span style="color:#e8a020">${zlNumer||''}</span></h2>
            <div style="color:#888;font-size:13px;margin-top:4px;">${zlNazwa||''}</div>
          </div>
          <button id="stawki-zl-close" style="background:#2a3040;color:#e8eaf0;border:none;border-radius:8px;width:36px;height:36px;cursor:pointer;font-size:18px;">✕</button>
        </div>
        <div style="padding:16px 24px;border-bottom:1px solid #2a3040;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <button id="stawki-zl-sync-add" style="background:#2a3040;color:#e8eaf0;border:1px solid #3a4050;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;">➕ Dodaj brakujące</button>
          <button id="stawki-zl-sync-force" style="background:#5a3a1a;color:#e8a020;border:1px solid #8a5a2a;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;">🔄 Nadpisz globalnymi</button>
          <div style="flex:1"></div>
          <small style="color:#888;font-size:12px;">💡 <span style="background:rgba(232,160,32,0.2);padding:2px 6px;border-radius:4px;">pomarańczowe</span> = zmodyfikowane</small>
        </div>
        <div style="flex:1;overflow-y:auto;padding:0 24px 24px;">
          <div id="stawki-zl-body" style="padding:16px 0;color:#888;text-align:center;">Ładowanie stawek...</div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#stawki-zl-close').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.querySelector('#stawki-zl-sync-add').onclick = () => syncStawki(zid, false);
    overlay.querySelector('#stawki-zl-sync-force').onclick = () => syncStawki(zid, true);
    await loadStawki(zid);
  };

  async function loadStawki(zid) {
    const body = document.getElementById('stawki-zl-body');
    if (!body) return;
    body.innerHTML = 'Ładowanie...';
    try {
      const stawki = await _api(`/api/zlecenia/${zid}/stawki`);
      if (!stawki.length) {
        body.innerHTML = '<div style="padding:30px;text-align:center;color:#888;"><div style="font-size:40px;margin-bottom:10px;">📭</div><div>Brak stanowisk w tym zleceniu.</div><div style="margin-top:8px;font-size:12px;">Dodaj najpierw operacje ze stanowiskami.</div></div>';
        return;
      }
      body.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead><tr style="background:#2a3040;color:#888;font-size:12px;text-transform:uppercase;">
            <th style="padding:10px;text-align:left;">Stanowisko</th>
            <th style="padding:10px;text-align:right;">Stawka [zł/h]</th>
            <th style="padding:10px;text-align:right;">Zbrojenie [zł/h]</th>
            <th style="padding:10px;text-align:right;color:#666;">Globalna</th>
            <th style="padding:10px;width:40px;"></th>
          </tr></thead>
          <tbody id="stawki-zl-tbody">
            ${stawki.map(s => renderRow(zid, s)).join('')}
          </tbody>
        </table>`;
      body.querySelectorAll('input[data-sid]').forEach(inp => {
        let t = null;
        inp.addEventListener('input', () => {
          clearTimeout(t);
          t = setTimeout(() => {
            const sid = parseInt(inp.dataset.sid);
            saveStawka(zid, sid, inp);
          }, 600);
        });
      });
    } catch (err) {
      body.innerHTML = '<div style="color:#ff6b6b;padding:20px;">Błąd: '+err.message+'</div>';
    }
  }

  function renderRow(zid, s) {
    const isModified = s.modified_stawka || s.modified_zbrojenie;
    return `
      <tr data-sid="${s.id}" style="${isModified ? ZMODYFIKOWANY_STYLE : ''} border-bottom:1px solid #2a3040;">
        <td style="padding:10px;"><strong>${s.stanowisko}</strong>${isModified ? ' <span style="color:#e8a020;font-size:11px;">● zmodyfikowana</span>' : ''}</td>
        <td style="padding:10px;text-align:right;"><input type="number" step="0.01" min="0" value="${s.stawka_godz}" data-sid="${s.id}" data-field="stawka_godz" style="width:90px;background:#2a3040;color:#e8eaf0;border:1px solid #3a4050;padding:6px 8px;border-radius:6px;text-align:right;"></td>
        <td style="padding:10px;text-align:right;"><input type="number" step="0.01" min="0" value="${s.zbrojenie_stawka_godz||0}" data-sid="${s.id}" data-field="zbrojenie_stawka_godz" style="width:90px;background:#2a3040;color:#e8eaf0;border:1px solid #3a4050;padding:6px 8px;border-radius:6px;text-align:right;"></td>
        <td style="padding:10px;text-align:right;color:#666;font-size:12px;">${s.global_stawka ?? '—'}${s.global_stawka != null ? ' zł/h' : ''}</td>
        <td style="padding:10px;text-align:center;">
          ${isModified && s.global_stawka != null ? `<button class="stawki-zl-reset" data-sid="${s.id}" data-global-stawka="${s.global_stawka}" data-global-zbrojenie="${s.global_zbrojenie||0}" title="Przywróć globalną" style="background:transparent;border:none;color:#e8a020;cursor:pointer;font-size:16px;">↺</button>` : ''}
        </td>
      </tr>`;
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.stawki-zl-reset');
    if (!btn) return;
    const zid = window.__stawkiZl_currentZid;
    if (!zid) return;
    const sid = parseInt(btn.dataset.sid);
    try {
      await _api(`/api/zlecenia/${zid}/stawki/${sid}`, {
        method: 'PUT',
        body: { stawka_godz: parseFloat(btn.dataset.globalStawka), zbrojenie_stawka_godz: parseFloat(btn.dataset.globalZbrojenie) }
      });
      await loadStawki(zid);
    } catch (err) { alert('Błąd: ' + err.message); }
  });

  async function saveStawka(zid, sid, inp) {
    const row = inp.closest('tr');
    const inputs = row.querySelectorAll('input[data-sid]');
    const body = {
      stawka_godz: parseFloat(inputs[0].value) || 0,
      zbrojenie_stawka_godz: parseFloat(inputs[1].value) || 0
    };
    try {
      await _api(`/api/zlecenia/${zid}/stawki/${sid}`, { method: 'PUT', body });
      inp.style.borderColor = '#27ae60';
      setTimeout(() => { inp.style.borderColor = '#3a4050'; }, 800);
      setTimeout(() => loadStawki(zid), 500);
    } catch (err) {
      inp.style.borderColor = '#ff6b6b';
      console.error('Błąd zapisu stawki:', err);
    }
  }

  async function syncStawki(zid, force) {
    const msg = force
      ? 'UWAGA: Wszystkie stawki zlecenia zostaną NADPISANE globalnymi. Kontynuować?'
      : 'Dodać brakujące stanowiska z globalnych stawek?';
    if (!confirm(msg)) return;
    try {
      const data = await _api(`/api/zlecenia/${zid}/stawki/sync?force=${force?'true':'false'}`, { method: 'POST' });
      alert(`✓ Zsynchronizowano: ${data.updated} stanowisk`);
      await loadStawki(zid);
    } catch (err) { alert('Błąd synchronizacji: ' + err.message); }
  }

  console.log('✓ Moduł stawki_zlecenia.js załadowany');
})();
