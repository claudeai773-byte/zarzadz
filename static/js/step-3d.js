//  STEP 3D VIEWER
// ══════════════════════════════════════════════════════════════
let _step3dOverlay = null;

function openStep3DViewer(url) {
  if (_step3dOverlay) _step3dOverlay.remove();
  _step3dOverlay = document.createElement('div');
  _step3dOverlay.id = 'step3d-overlay';
  _step3dOverlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0d1117;display:flex;flex-direction:column;font-family:sans-serif';
  _step3dOverlay.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:10px 14px;background:#161b22;border-bottom:1px solid #30363d;flex-shrink:0">
      <span style="color:#e6edf3;font-weight:700;font-size:14px">🧊 Podgląd modelu 3D</span>
      <div style="display:flex;gap:8px;align-items:center">
        <span id="step3d-status" style="color:#e6a020;font-size:12px">⏳ Ładowanie...</span>
        <button onclick="closeStep3DViewer()"
                style="background:#21262d;border:1px solid #30363d;color:#e6edf3;
                       border-radius:6px;padding:5px 12px;cursor:pointer;font-size:13px">✕</button>
      </div>
    </div>
    <div id="step3d-hint" style="display:none;padding:6px 14px;background:#161b22;
         border-bottom:1px solid #30363d;font-size:11px;color:#8b949e;flex-shrink:0;text-align:center">
      Obracaj: przeciągnij &nbsp;|&nbsp; Zoom: scroll / szczypnij &nbsp;|&nbsp; Przesuń: PPM / 2 palce
    </div>
    <canvas id="step3d-canvas" style="flex:1;display:block;width:100%;height:100%;touch-action:none;outline:none"></canvas>
  `;
  document.body.appendChild(_step3dOverlay);
  _initStep3DScene(url);
}

function closeStep3DViewer() {
  if (_step3dOverlay) { _step3dOverlay.remove(); _step3dOverlay = null; }
}

function _setStep3dStatus(msg, color) {
  const el = document.getElementById('step3d-status');
  if (el) { el.textContent = msg; el.style.color = color || '#8b949e'; }
}

function _loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector('script[src="' + src + '"]')) { res(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = res;
    s.onerror = () => rej(new Error('Nie można załadować: ' + src));
    document.head.appendChild(s);
  });
}

async function _initStep3DScene(stepUrl) {
  try {
    // 1. Biblioteki Three.js
    _setStep3dStatus('⏳ Ładowanie Three.js...', '#e6a020');
    await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js');
    await _loadScript('https://cdn.jsdelivr.net/npm/three@0.128/examples/js/controls/OrbitControls.js');

    // 2. Pobranie pliku STEP przez proxy (dłuższy timeout dla telefonu)
    _setStep3dStatus('⏳ Pobieranie pliku STEP...', '#e6a020');
    const proxyUrl = SERVER_URL.replace(/\/$/, '') + '/api/step-proxy?url=' + encodeURIComponent(stepUrl);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000); // 2 min timeout
    let stepData;
    try {
      const resp = await fetch(proxyUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error('Serwer zwrócił błąd HTTP ' + resp.status);
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('text/html')) throw new Error('Plik niedostępny – sprawdź uprawnienia na Cloudinary');
      stepData = new Uint8Array(await resp.arrayBuffer());
    } catch(e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('Timeout – plik za duży lub wolne łącze');
      throw e;
    }
    if (!stepData.length) throw new Error('Pobrano pusty plik');

    // 3. OCCT parser – używamy nowszego API (obsługuje SolidWorks AP214)
    _setStep3dStatus('⏳ Parsowanie modelu STEP...', '#e6a020');
    // GitHub raw blokuje jako script (MIME text/plain) – ładujemy przez fetch+blob
    const OCCT_BASE = 'https://cdn.jsdelivr.net/gh/kovacsv/occt-import-js@master/dist/';
    if (typeof occtimportjs === 'undefined') {
      const jsText = await fetch(OCCT_BASE + 'occt-import-js.js').then(r => {
        if (!r.ok) throw new Error('Błąd pobierania biblioteki OCCT: ' + r.status);
        return r.text();
      });
      const blob = new Blob([jsText], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      await _loadScript(blobUrl);
      URL.revokeObjectURL(blobUrl);
    }
    const occt = await occtimportjs({
      locateFile: (f) => OCCT_BASE + f,
    });
    const result = occt.ReadStepFile(stepData, null);

    if (!result || !result.meshes || result.meshes.length === 0)
      throw new Error('Brak geometrii w pliku – plik STEP jest pusty lub uszkodzony');

    // Zlicz wierzchołki – obsługa obu wersji API:
    // Stare (0.0.19): mesh.breps[].vertices / .normals / .triangles
    // Nowe (0.0.20+): mesh.attributes.position.array / .normal.array + mesh.index.array
    function _meshHasGeometry(mesh) {
      if (Array.isArray(mesh.breps) && mesh.breps.length > 0)
        return mesh.breps.some(b => b.vertices?.length > 0);
      return mesh.attributes?.position?.array?.length > 0;
    }
    const totalVerts = result.meshes.reduce((sum, m) => {
      if (Array.isArray(m.breps))
        return sum + m.breps.reduce((s, b) => s + (b.vertices?.length || 0), 0);
      return sum + (m.attributes?.position?.array?.length || 0);
    }, 0);

    if (totalVerts === 0)
      throw new Error('Plik STEP nie zawiera geometrii. Sprawdź czy plik jest poprawny (zapisz ponownie z SolidWorks/FreeCAD).');

    // 4. Scena Three.js
    _setStep3dStatus('⏳ Renderowanie...', '#e6a020');
    const canvas = document.getElementById('step3d-canvas');
    if (!canvas) throw new Error('Brak elementu canvas');

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0d1117, 1);
    renderer.shadowMap.enabled = false;

    const scene = new THREE.Scene();
    const w = canvas.clientWidth || 400;
    const h = canvas.clientHeight || 500;
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.0001, 10000000);

    const controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.screenSpacePanning = true;
    controls.zoomSpeed = 1.2;

    // Światła
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dl1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dl1.position.set(5, 10, 7); scene.add(dl1);
    const dl2 = new THREE.DirectionalLight(0x6688cc, 0.4);
    dl2.position.set(-5, -3, -5); scene.add(dl2);

    // Buduj geometrię – obsługa obu API
    const group = new THREE.Group();
    const defaultMat = new THREE.MeshPhongMaterial({
      color: 0x4a90d9, shininess: 80, specular: 0x224466, side: THREE.DoubleSide
    });

    for (const mesh of result.meshes) {
      let posArr, normArr, idxArr;

      if (Array.isArray(mesh.breps) && mesh.breps.length > 0) {
        // Stare API: breps[]
        const verts = [], norms = [], idxs = [];
        let vOff = 0;
        for (const brep of mesh.breps) {
          if (!brep.vertices?.length) continue;
          for (let v = 0; v < brep.vertices.length; v += 3)
            verts.push(brep.vertices[v], brep.vertices[v+1], brep.vertices[v+2]);
          if (brep.normals)
            for (let n = 0; n < brep.normals.length; n += 3)
              norms.push(brep.normals[n], brep.normals[n+1], brep.normals[n+2]);
          for (const i of brep.triangles) idxs.push(i + vOff);
          vOff += brep.vertices.length / 3;
        }
        posArr = verts; normArr = norms; idxArr = idxs;
      } else {
        // Nowe API: attributes + index
        posArr  = Array.from(mesh.attributes?.position?.array || []);
        normArr = Array.from(mesh.attributes?.normal?.array   || []);
        idxArr  = Array.from(mesh.index?.array                || []);
      }

      if (!posArr.length || !idxArr.length) continue;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
      if (normArr.length === posArr.length)
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(normArr, 3));
      geo.setIndex(idxArr);
      if (!normArr.length) geo.computeVertexNormals();

      let mat = defaultMat;
      if (mesh.color && mesh.color.length >= 3) {
        mat = defaultMat.clone();
        mat.color.setRGB(mesh.color[0], mesh.color[1], mesh.color[2]);
        if (mesh.color[3] !== undefined && mesh.color[3] < 0.99) {
          mat.transparent = true; mat.opacity = mesh.color[3];
        }
      }
      group.add(new THREE.Mesh(geo, mat));
    }

    if (group.children.length === 0) throw new Error('Nie udało się zbudować geometrii 3D');
    scene.add(group);

    // Centrum i kamera – kluczowe dla czarnego ekranu
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let camDist = Math.abs(maxDim / Math.sin(fov / 2)) * 0.8;
    if (camDist === 0 || !isFinite(camDist)) camDist = 100;

    camera.position.set(
      center.x + camDist * 0.7,
      center.y + camDist * 0.5,
      center.z + camDist * 0.7
    );
    camera.near = camDist * 0.0001;
    camera.far  = camDist * 100;
    camera.updateProjectionMatrix();
    camera.lookAt(center);
    controls.target.copy(center);
    controls.minDistance = camDist * 0.01;
    controls.maxDistance = camDist * 50;
    controls.update();

    // Resize
    function _resize() {
      if (!canvas || !_step3dOverlay) return;
      const cw = canvas.clientWidth  || 400;
      const ch = canvas.clientHeight || 500;
      renderer.setSize(cw, ch, false);
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
    }
    renderer.setSize(w, h, false);
    new ResizeObserver(_resize).observe(canvas);

    // Pętla
    let _running = true;
    (function _anim() {
      if (!_running || !document.getElementById('step3d-overlay')) { _running = false; return; }
      requestAnimationFrame(_anim);
      controls.update();
      renderer.render(scene, camera);
    })();

    _setStep3dStatus('✓ Model załadowany (' + group.children.length + ' bryły)', '#27ae60');
    const hint = document.getElementById('step3d-hint');
    if (hint) hint.style.display = 'block';

  } catch(e) {
    _setStep3dStatus('✗ ' + e.message, '#e05555');
    console.error('[STEP viewer]', e);
  }
}


