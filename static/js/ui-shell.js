//  TOPBAR & NAV
// ══════════════════════════════════════════════════════════════
function renderTopbar() {
  const notifyDot = state.majsterStats?.alerty_norm?.length > 0 ? ' 🔴' : '';
  return `
  <div class="topbar">
    <h1>⚙ PRODUKCJA</h1>
    <div style="display:flex;align-items:center;gap:10px">
      <div style="display:flex;align-items:center;gap:6px">
        <div style="display:flex;gap:2px" title="Oceń aplikację">
          ${[1,2,3,4,5].map(n => `<span onclick="setFeedbackRating(${n})" style="font-size:18px;cursor:pointer;color:${(state.feedbackRating||0)>=n?'var(--accent)':'var(--border)'}">★</span>`).join('')}
        </div>
        <button onclick="openFeedbackModal()" style="background:var(--entry);color:var(--dim);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;white-space:nowrap">💬 Co brakuje?</button>
      </div>
      <div class="user-info">
        <div style="color:var(--text)">${state.user.full_name}</div>
        <div>${roleName(state.user.role)}</div>
      </div>
      <button class="logout-btn" onclick="logout()">🔒</button>
    </div>
  </div>`;
}

function renderBottomNav() {
  const role = state.user?.role;
  const customTabs = state.currentUserTabs || [];
  const hasCustom = customTabs.length > 0;

  let tabs = [];
  if (hasCustom) {
    // Użytkownik ma niestandardowe uprawnienia
    ALL_TABS_DEF.forEach(td => {
      if (customTabs.includes(td.id)) tabs.push({id:td.id, icon:td.label.split(' ')[0], label:td.label.split(' ').slice(1).join(' ')});
    });
    // Ustawienia zawsze dostępne
    if (!customTabs.includes('ustawienia')) tabs.push({id:'ustawienia',icon:'🔩',label:'Ustawienia'});
  } else {
    // Domyślne wg roli
    if (role !== 'magazynier') tabs.push({id:'praca',icon:'👷',label:'Praca'});
    if (role === 'magazynier' || role === 'admin') tabs.push({id:'magazyn',icon:'📦',label:'Magazyn'});
    if (role === 'majster' || role === 'admin')    tabs.push({id:'majster',icon:'🔧',label:'Majster'});
    if (role !== 'pracownik' && role !== 'magazynier') tabs.push({id:'zlecenia',icon:'📋',label:'Zlecenia'});
    if (role === 'majster' || role === 'admin' || role === 'technolog') tabs.push({id:'drzewo',icon:'🌳',label:'Drzewo'});
    if (role === 'admin' || role === 'technolog')  tabs.push({id:'admin',icon:'⚙',label:'Admin'});
    tabs.push({id:'ustawienia',icon:'🔩',label:'Ustawienia'});
  }
  return `
  <nav class="bottom-nav">
    ${tabs.map(t => {
      const isMag = t.id === 'magazyn';
      const showAlert = isMag && state.magazynBraki;
      return `
      <button class="nav-btn ${state.activeTab===t.id?'active':''}" onclick="switchTab('${t.id}')">
        <span class="icon" style="position:relative">${t.icon}${showAlert ? '<span style="position:absolute;top:-2px;right:-4px;background:var(--red);color:#fff;font-size:9px;font-weight:700;border-radius:50%;width:14px;height:14px;display:flex;align-items:center;justify-content:center;line-height:1">!</span>' : ''}</span>${t.label}
      </button>`;
    }).join('')}
  </nav>`;
}

// ══════════════════════════════════════════════════════════════
