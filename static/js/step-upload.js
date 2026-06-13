//  STEP UPLOAD DO CLOUDINARY
// ══════════════════════════════════════════════════════════════
function stepModelRemove() {
  const urlInput = document.getElementById('zl-model3d');
  if (urlInput) urlInput.value = '';
  const info = document.getElementById('zl-model3d-info');
  if (info) info.style.display = 'none';
  const area = document.getElementById('zl-model3d-upload-area');
  if (area) { area.style.display = ''; area.innerHTML = '<input type="file" id="zl-model3d-file" accept=".step,.stp,.STEP,.STP,model/step,application/step,application/octet-stream,*/*" style="font-size:13px;width:100%" onchange="uploadStepFile(this)">'; }
  const status = document.getElementById('zl-model3d-status');
  if (status) { status.textContent = ''; }
}

async function uploadStepFile(input) {
  const file = input.files[0];
  if (!file) return;
  const statusEl = document.getElementById('zl-model3d-status');
  const urlInput = document.getElementById('zl-model3d');
  const infoEl   = document.getElementById('zl-model3d-info');
  const areaEl   = document.getElementById('zl-model3d-upload-area');

  const MAX = 100 * 1024 * 1024;
  if (file.size > MAX) {
    statusEl.textContent = '✗ Plik za duży (maks. 100 MB)';
    statusEl.style.color = 'var(--red, #e05555)';
    return;
  }

  statusEl.textContent = '⏳ Wgrywanie... 0%';
  statusEl.style.color = 'var(--dim)';
  input.disabled = true;

  try {
    const buf = await file.arrayBuffer();
    const result = await new Promise((res, rej) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', SERVER_URL.replace(/\/$/, '') + '/api/step-upload');
      xhr.setRequestHeader('x-api-key', API_KEY);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
      xhr.upload.onprogress = e => {
        if (e.lengthComputable)
          statusEl.textContent = '⏳ Wgrywanie... ' + Math.round(e.loaded/e.total*100) + '%';
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) res(JSON.parse(xhr.responseText));
        else rej(new Error(xhr.responseText || 'HTTP ' + xhr.status));
      };
      xhr.onerror = () => rej(new Error('Błąd sieci'));
      xhr.send(buf);
    });

    if (result.ok && result.url) {
      urlInput.value = result.url;
      statusEl.textContent = '✅ Wgrano: ' + file.name + ' (' + Math.round((result.bytes||file.size)/1024) + ' KB)';
      statusEl.style.color = '#27ae60';
      if (areaEl) areaEl.style.display = 'none';
      if (infoEl) infoEl.style.display = 'flex';
    } else {
      throw new Error(result.error || 'Nieznany błąd');
    }
  } catch(e) {
    statusEl.textContent = '✗ Błąd uploadu: ' + e.message;
    statusEl.style.color = 'var(--red, #e05555)';
    input.disabled = false;
  }
}

// ── Upload STEP dla podzlecenia P z widoku drzewa ─────────────────────────────
function drzewoOpenStepNode(btn) {
  const url = btn.getAttribute('data-url');
  if (url) openStep3DViewer(url);
}

async function uploadStepForZlecenie(zlecenieId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.step,.stp,.STEP,.STP,model/step,application/step,application/octet-stream,*/*';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = async function() {
    const file = this.files[0];
    document.body.removeChild(input);
    if (!file) return;
    const MAX = 100 * 1024 * 1024;
    if (file.size > MAX) { alert('Plik za duży (maks. 100 MB)'); return; }
    // Pokaż progress w toaście
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:10000;background:#1e3a5f;border:1px solid #3b82f6;color:#e8eaf0;padding:10px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 12px #0008;min-width:220px';
    toast.textContent = '⏳ Wgrywanie STEP... 0%';
    document.body.appendChild(toast);
    try {
      const buf = await file.arrayBuffer();
      const result = await new Promise((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', SERVER_URL.replace(/\/$/, '') + '/api/step-upload');
        xhr.setRequestHeader('x-api-key', API_KEY);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
        xhr.upload.onprogress = e => {
          if (e.lengthComputable)
            toast.textContent = '⏳ Wgrywanie STEP... ' + Math.round(e.loaded/e.total*100) + '%';
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) res(JSON.parse(xhr.responseText));
          else rej(new Error(xhr.responseText || 'HTTP ' + xhr.status));
        };
        xhr.onerror = () => rej(new Error('Błąd sieci'));
        xhr.send(buf);
      });
      if (result.ok && result.url) {
        await patch('/api/zlecenia/' + zlecenieId + '/model3d', {model_3d_url: result.url});
        toast.style.background = '#1a3a1a';
        toast.style.borderColor = '#4ade80';
        toast.textContent = '✅ Wgrano: ' + file.name;
        setTimeout(() => toast.remove(), 3000);
        // Odśwież drzewo
        if (state.drzewoSelectedG) {
          try {
            const tree = await get('/api/wyroby/' + state.drzewoSelectedG.id + '/drzewo');
            setState({drzewoTree: tree});
          } catch(_) {}
        }
        // Odśwież modal zlecenia jeśli otwarty
        if (state.zlecenieModal?.zlTree && state.zlecenieModal?.zlWyrobId) {
          try {
            const tree2 = await get('/api/wyroby/' + state.zlecenieModal.zlWyrobId + '/drzewo');
            setState({zlecenieModal: {...state.zlecenieModal, zlTree: tree2}});
          } catch(_) {}
        }
      } else {
        throw new Error(result.error || 'Nieznany błąd');
      }
    } catch(e) {
      toast.style.background = '#3a1a1a';
      toast.style.borderColor = '#f87171';
      toast.textContent = '✗ Błąd: ' + e.message;
      setTimeout(() => toast.remove(), 4000);
    }
  };
  input.click();
}

// ── Upload STEP dla wyrobu G/P (niezależnie od zlecenia) ──────────────────────
async function uploadStepForWyrob(wyrobId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.step,.stp,.STEP,.STP,model/step,application/step,application/octet-stream,*/*';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = async function() {
    const file = this.files[0];
    document.body.removeChild(input);
    if (!file) return;
    const MAX = 100 * 1024 * 1024;
    if (file.size > MAX) { alert('Plik za duży (maks. 100 MB)'); return; }
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:10000;background:#1e3a5f;border:1px solid #3b82f6;color:#e8eaf0;padding:10px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 12px #0008;min-width:220px';
    toast.textContent = '⏳ Wgrywanie STEP... 0%';
    document.body.appendChild(toast);
    try {
      const buf = await file.arrayBuffer();
      const result = await new Promise((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', SERVER_URL.replace(/\/$/, '') + '/api/step-upload');
        xhr.setRequestHeader('x-api-key', API_KEY);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
        xhr.upload.onprogress = e => {
          if (e.lengthComputable)
            toast.textContent = '⏳ Wgrywanie STEP... ' + Math.round(e.loaded/e.total*100) + '%';
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) res(JSON.parse(xhr.responseText));
          else rej(new Error(xhr.responseText || 'HTTP ' + xhr.status));
        };
        xhr.onerror = () => rej(new Error('Błąd sieci'));
        xhr.send(buf);
      });
      if (result.ok && result.url) {
        await patch('/api/wyroby/' + wyrobId + '/model3d', {model_3d_url: result.url});
        toast.style.background = '#1a3a1a';
        toast.style.borderColor = '#4ade80';
        toast.textContent = '✅ Wgrano: ' + file.name;
        setTimeout(() => toast.remove(), 3000);
        // Odśwież drzewo
        if (state.drzewoSelectedG) {
          try {
            const tree = await get('/api/wyroby/' + state.drzewoSelectedG.id + '/drzewo');
            setState({drzewoTree: tree});
          } catch(_) {}
        }
        // Odśwież modal zlecenia jeśli otwarty
        if (state.zlecenieModal?.zlTree && state.zlecenieModal?.zlWyrobId) {
          try {
            const tree2 = await get('/api/wyroby/' + state.zlecenieModal.zlWyrobId + '/drzewo');
            setState({zlecenieModal: {...state.zlecenieModal, zlTree: tree2}});
          } catch(_) {}
        }
      } else {
        throw new Error(result.error || 'Nieznany błąd');
      }
    } catch(e) {
      toast.style.background = '#3a1a1a';
      toast.style.borderColor = '#f87171';
      toast.textContent = '✗ Błąd: ' + e.message;
      setTimeout(() => toast.remove(), 4000);
    }
  };
  input.click();
}

// ══════════════════════════════════════════════════════════════
