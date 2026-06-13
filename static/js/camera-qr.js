//  CAMERA QR SCANNER
// ══════════════════════════════════════════════════════════════
let _qrStream = null;
let _qrAnimFrame = null;

function stopQRCamera() {
  if (_qrStream) { _qrStream.getTracks().forEach(t => t.stop()); _qrStream = null; }
  if (_qrAnimFrame) { cancelAnimationFrame(_qrAnimFrame); _qrAnimFrame = null; }
}

async function startQRCamera() {
  const video  = document.getElementById('qr-video');
  const canvas = document.getElementById('qr-cam-canvas');
  const status = document.getElementById('qr-scan-status');
  if (!video) return;
  try {
    if (!window.jsQR) {
      await new Promise((res,rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {facingMode:'environment'}
    });
    _qrStream = stream;
    video.srcObject = stream;
    await video.play();
    if (status) status.textContent = '🔍 Skanuję...';
    const ctx = canvas.getContext('2d');
    function tick() {
      if (!document.getElementById('qr-video')) { stopQRCamera(); return; }
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = window.jsQR(img.data, img.width, img.height, {inversionAttempts:'dontInvert'});
        if (code && code.data) {
          stopQRCamera();
          scanQR(code.data);
          return;
        }
      }
      _qrAnimFrame = requestAnimationFrame(tick);
    }
    tick();
  } catch(err) {
    if (status) status.textContent = 'Brak dostępu do aparatu. Wpisz kod ręcznie.';
    setState({qrManualMode: true});
  }
}

// Wywoływane przez render() aby uruchomić kamerę po re-renderze
function _afterRender() {
  stopQRCamera();
  const hasCam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  if (state.qrScanMode && !state.qrManualMode && hasCam) {
    setTimeout(startQRCamera, 120);
  }
}

// ══════════════════════════════════════════════════════════════
