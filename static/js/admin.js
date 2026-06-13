//  ADMIN CRUD helpers
// ══════════════════════════════════════════════════════════════
async function changeOwnPassword() {
  const oldP = document.getElementById('pass-old')?.value || '';
  const newP = document.getElementById('pass-new')?.value || '';
  const newP2 = document.getElementById('pass-new2')?.value || '';
  if (!oldP) { alert('Wpisz aktualne hasło'); return; }
  if (!newP) { alert('Wpisz nowe hasło'); return; }
  if (newP !== newP2) { alert('Nowe hasła nie są takie same'); return; }
  if (newP.length < 4) { alert('Hasło musi mieć co najmniej 4 znaki'); return; }
  try {
    await post(`/api/users/${state.user.id}/change-password`, {
      old_password: oldP, new_password: newP
    });
    document.getElementById('pass-old').value = '';
    document.getElementById('pass-new').value = '';
    document.getElementById('pass-new2').value = '';
    alert('✅ Hasło zostało zmienione');
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function adminResetPassword(uid) {
  if (!confirm('Zresetować hasło tego użytkownika?')) return;
  try {
    const res = await post(`/api/users/${uid}/reset-password`, {});
    alert(`✅ Hasło zresetowane\n\nUżytkownik: ${res.full_name}\nNowe hasło: ${res.new_password}\n\nZapisz to hasło i przekaż użytkownikowi.`);
  } catch(e) { alert('Błąd: ' + e.message); }
}

async function openKartaFromSesja(zlecenieId) {
  try {
    // Pobierz dane zlecenia i operacje
    const [allZl, ops] = await Promise.all([
      get('/api/zlecenia'),
      get(`/api/zlecenia/${zlecenieId}/operacje`)
    ]);
    const zl = allZl.find(z => z.id === zlecenieId);
    if (zl) {
      setState({printModal: {zlecenie: zl, operacje: ops}});
    } else {
      alert('Nie znaleziono zlecenia');
    }
  } catch(e) { alert('Błąd ładowania karty: ' + e.message); }
}

async function saveUser(data) {
  try {
    if (data.id) { await put(`/api/users/${data.id}`, data); }
    else { await post('/api/users', data); }
    setState({userModal:null});
    await loadAdmin();
  } catch(e) { alert('Błąd: '+e.message); }
}
async function deleteUser(id) {
  if (!confirm('Usunąć użytkownika?')) return;
  try { await del(`/api/users/${id}`); await loadAdmin(); }
  catch(e) { alert('Błąd: '+e.message); }
}
async function saveStawka(data) {
  try {
    if (data.id) { await put(`/api/stawki/${data.id}`, data); }
    else { await post('/api/stawki', data); }
    setState({stawkaModal:null});
    const fresh = await get('/api/stawki');
    setState({stawki: fresh});
    if (state.activeTab === 'admin') await loadAdmin();
  } catch(e) { alert('Błąd: '+e.message); }
}
async function deleteStawka(id) {
  if (!confirm('Usunąć stawkę?')) return;
  try {
    await del(`/api/stawki/${id}`);
    const fresh = await get('/api/stawki');
    setState({stawki: fresh});
    if (state.activeTab === 'admin') await loadAdmin();
  } catch(e) { alert('Błąd: '+e.message); }
}
async function saveProdukt(data) {
  try {
    if (data.id) { await put(`/api/katalog/${data.id}`, data); }
    else { await post('/api/katalog', data); }
    setState({produktModal:null});
    await loadAdmin();
  } catch(e) { alert('Błąd: '+e.message); }
}
async function deleteProdukt(id) {
  if (!confirm('Usunąć produkt?')) return;
  try { await del(`/api/katalog/${id}`); await loadAdmin(); }
  catch(e) { alert('Błąd: '+e.message); }
}

// ══════════════════════════════════════════════════════════════
