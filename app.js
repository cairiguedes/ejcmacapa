/* ═══════════════════════════════════════════════════
   EJC GINCANA — app.js  (v4 — auth + relatório)
   Supabase Auth + RLS + Roles + Report Export
═══════════════════════════════════════════════════ */

// ─── CONFIGURE SEU SUPABASE AQUI ────────────────────
const SUPABASE_URL  = 'https://ghcishjqgycpflwgaxwv.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdoY2lzaGpxZ3ljcGZsd2dheHd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTQwNzYsImV4cCI6MjA5MzIzMDA3Nn0.YHx6ZLj3yQm1Hul_bzbMXVJjnB1ebZ4Z3YRrlg5vyOE';
// E-mail do super-administrador (você). Pode adicionar mais separando por vírgula.
const SUPER_ADMINS  = ['cairiguedes77@gmail.com'];
// ────────────────────────────────────────────────────

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── STATE ──────────────────────────────────────────
let teams    = [];
let entries  = [];
let gincanas = [];
let profiles = [];
let events   = [];   // { id, title, description, event_date, location, created_by }

// Filtro de mês da agenda: { year, month } — null = todos
let calFilterMonth = null;

let currentUser    = null;  // objeto do Supabase Auth
let currentProfile = null;  // { id, email, name, username, role }
let isGuest        = false; // visitante sem login

// Helper central — retorna true se pode escrever dados
function canWrite() {
  if (isGuest) return false;
  return ['admin','superadmin'].includes(currentProfile?.role);
}

// Guard: bloqueia ação e avisa o visitante
function requireAdmin(action) {
  if (!canWrite()) {
    showToast('🔒 Acesso restrito. Faça login como administrador.', 'error');
    return false;
  }
  return true;
}

let barChart = null, lineChart = null;
let historyFilter = '';
let editingTeamId = null;
let editingGinId  = null;
let confirmCallback = null;
let calcSimResult   = [];

// ─── FILTRO GLOBAL ──────────────────────────────────
const filterState = {
  mode:       'period',
  period:     'today',
  ginId:      '',
  customFrom: '',
  customTo:   ''
};

function getFilteredEntries() {
  if (filterState.mode === 'gin') {
    if (!filterState.ginId) return [];
    return entries.filter(e => e.gin_id === filterState.ginId);
  }
  let start, end;
  if (filterState.mode === 'custom') {
    if (!filterState.customFrom || !filterState.customTo) return entries;
    start = filterState.customFrom; end = filterState.customTo;
  } else {
    switch (filterState.period) {
      case 'today': start = end = today(); break;
      case 'week':  { const w=getWeekRange();  start=w.start; end=w.end; break; }
      case 'month': { const m=getMonthRange(); start=m.start; end=m.end; break; }
      case 'year':  { const y=getYearRange();  start=y.start; end=y.end; break; }
      case 'all': default: return entries;
    }
  }
  return entries.filter(e => (e.data_entry||'') >= start && (e.data_entry||'') <= end);
}

function getFilterLabel() {
  if (filterState.mode === 'gin') {
    const g = ginById(filterState.ginId);
    return g ? `🎯 ${g.name}` : '🎯 Nenhuma competição selecionada';
  }
  if (filterState.mode === 'custom') {
    if (!filterState.customFrom || !filterState.customTo) return '✂️ Defina o período e clique em Filtrar';
    return `✂️ ${fmtDate(filterState.customFrom)} → ${fmtDate(filterState.customTo)}`;
  }
  const labels = { today:'Hoje', week:'Esta semana', month:'Este mês', year:'Este ano 🏆', all:'Todo o histórico' };
  return `📅 ${labels[filterState.period] || ''}`;
}

// ─── AUTH: BOOT PRINCIPAL ───────────────────────────
async function boot() {
  if (SUPABASE_URL.includes('SEU_PROJECT') || SUPABASE_KEY.includes('SUA_ANON')) {
    hideSplash();
    showDiagnostic('⚙️ Configure o Supabase',
      'Abra o <strong>app.js</strong> e preencha <code>SUPABASE_URL</code>, <code>SUPABASE_KEY</code> e <code>SUPER_ADMINS</code>.');
    return;
  }

  // Timeout de segurança para a splash nunca travar
  const splashTimeout = setTimeout(() => {
    hideSplash();
    showAuthScreen();
  }, 6000);

  try {
    // Verifica sessão existente
    const { data: { session } } = await sb.auth.getSession();
    clearTimeout(splashTimeout);

    if (session) {
      currentUser = session.user;
      await resolveUserRole();
    } else {
      hideSplash();
      showAuthScreen();
    }
  } catch(e) {
    clearTimeout(splashTimeout);
    hideSplash();
    showAuthScreen();
    console.error('Boot error:', e);
  }
}

// Resolve o papel do usuário após login
async function resolveUserRole() {
  const email = currentUser.email;

  // Superadmin definido no código — acesso imediato
  if (SUPER_ADMINS.includes(email)) {
    const { data: existingProfile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
    currentProfile = {
      id: currentUser.id, email,
      name:     existingProfile?.name     || email,
      username: existingProfile?.username || '',
      role: 'superadmin'
    };
    await sb.from('profiles').upsert({
      id: currentUser.id, email,
      name: currentProfile.name,
      username: currentProfile.username,
      role: 'superadmin'
    }, { onConflict: 'id' });
    await launchApp();
    return;
  }

  // Busca perfil no banco
  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();

  if (!profile) {
    // Cria perfil como pending e aguarda aprovação em tempo real
    await sb.from('profiles').insert({
      id: currentUser.id, email,
      name: currentUser.user_metadata?.name || email,
      username: currentUser.user_metadata?.username || '',
      role: 'pending'
    });
    hideSplash();
    showPendingScreen();
    watchPendingProfile(); // ← escuta o banco em tempo real
    return;
  }

  currentProfile = profile;

  if (profile.role === 'pending') {
    hideSplash();
    showPendingScreen();
    watchPendingProfile(); // ← escuta o banco em tempo real
    return;
  }
  if (profile.role === 'blocked') {
    hideSplash();
    showAuthScreen();
    showAuthError('login', 'Seu acesso foi bloqueado pelo administrador.');
    await sb.auth.signOut();
    return;
  }

  // admin ou superadmin
  await launchApp();
}

// Polling do perfil pendente — verifica a cada 4s se foi aprovado.
let pendingWatcher = null;

function watchPendingProfile() {
  if (pendingWatcher) { clearInterval(pendingWatcher); pendingWatcher = null; }

  // Faz uma verificação imediata e depois a cada 4 segundos
  const checkRole = async () => {
    if (!currentUser) { clearInterval(pendingWatcher); return; }

    try {
      // Garante que a sessão está ativa antes de consultar
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { clearInterval(pendingWatcher); return; }

      const { data: profile, error } = await sb
        .from('profiles')
        .select('role, name, username')
        .eq('id', currentUser.id)
        .single();

      if (error) {
        console.warn('Polling erro (ignorado):', error.message);
        return;
      }

      if (!profile) return;

      const role = profile.role;
      console.log('Polling: role atual =', role); // diagnóstico

      if (role === 'admin' || role === 'superadmin') {
        clearInterval(pendingWatcher);
        pendingWatcher = null;

        // Carrega perfil completo
        const { data: fullProfile } = await sb
          .from('profiles').select('*').eq('id', currentUser.id).single();
        currentProfile = fullProfile || { ...profile, id: currentUser.id, email: currentUser.email };

        showToast('✅ Acesso aprovado! Bem-vindo(a)!', 'success');
        await launchApp();

      } else if (role === 'blocked') {
        clearInterval(pendingWatcher);
        pendingWatcher = null;
        await sb.auth.signOut();
        currentUser = null; currentProfile = null;
        showAuthScreen();
        showAuthError('login', 'Seu acesso foi bloqueado pelo administrador.');
      }
      // 'pending' → continua aguardando
    } catch(e) {
      console.warn('Polling exceção:', e);
    }
  };

  // Verifica imediatamente na primeira vez, depois a cada 4s
  checkRole();
  pendingWatcher = setInterval(checkRole, 4000);
}

// ─── LANÇAR O APP ───────────────────────────────────
async function launchApp() {
  hideAllScreens();
  await Promise.all([loadTeams(), loadEntries(), loadGincanas(), loadProfiles(), loadEvents()]);
  applyRoleUI();
  renderAll();
  subscribeRealtime();
  const splash = document.getElementById('splash');
  splash.classList.add('fade-out');
  setTimeout(() => splash.classList.add('hidden'), 550);
  document.getElementById('app').classList.remove('hidden');
}

function applyRoleUI() {
  const role = isGuest ? 'visitor' : (currentProfile?.role || 'visitor');
  const isAdmin = ['admin','superadmin'].includes(role);

  // Adiciona/remove classe no body para controlar visibilidade via CSS
  document.body.classList.toggle('is-admin', isAdmin);

  // Badge de papel
  const badge = document.getElementById('user-badge');
  if (isGuest) {
    badge.textContent = '👁 VISITANTE';
    badge.className = 'user-badge visitor';
  } else if (role === 'superadmin') {
    badge.textContent = '⭐ SUPER ADMIN';
    badge.className = 'user-badge superadmin';
  } else {
    badge.textContent = '🔑 ADMIN';
    badge.className = 'user-badge admin';
  }

  // Oculta aba admin para não-superadmin
  const adminTab = document.querySelector('[data-tab="adminpanel"]');
  if (adminTab) adminTab.style.display = role === 'superadmin' ? '' : 'none';
}

// ─── TELAS DE AUTH ──────────────────────────────────
function showAuthScreen()   { hideAllScreens(); document.getElementById('auth-screen').classList.remove('hidden'); }
function showPendingScreen() { hideAllScreens(); document.getElementById('pending-screen').classList.remove('hidden'); }
function hideAllScreens() {
  ['auth-screen','pending-screen'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
}
function hideSplash() {
  const s = document.getElementById('splash');
  s.classList.add('fade-out');
  setTimeout(() => s.classList.add('hidden'), 550);
}
function showAuthError(panel, msg) {
  const el = document.getElementById(panel === 'login' ? 'login-error' : 'reg-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function clearAuthErrors() {
  ['login-error','reg-error'].forEach(id => document.getElementById(id).classList.add('hidden'));
}

// ─── AUTH ACTIONS ───────────────────────────────────
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-password').value;
  clearAuthErrors();
  if (!email || !pass) return showAuthError('login', 'Preencha e-mail e senha.');

  const btn = document.getElementById('btn-login');
  btn.textContent = 'Entrando...';
  btn.disabled = true;

  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });

  // Se deu erro, restaura o botão e mostra a mensagem
  if (error) {
    btn.textContent = 'Entrar →';
    btn.disabled = false;
    return showAuthError('login', traduzirErroAuth(error.message));
  }

  if (!data.session) {
    btn.textContent = 'Entrar →';
    btn.disabled = false;
    return showAuthError('login', 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.');
  }

  // Login OK — esconde a tela imediatamente e carrega o app
  document.getElementById('auth-screen').classList.add('hidden');
  currentUser = data.user;
  await resolveUserRole();
}

// Traduz mensagens de erro do Supabase para português
function traduzirErroAuth(msg) {
  if (!msg) return 'Erro desconhecido.';
  if (msg.includes('Invalid login')) return 'E-mail ou senha incorretos.';
  if (msg.includes('Email not confirmed')) return 'Confirme seu e-mail antes de entrar.';
  if (msg.includes('Too many requests')) return 'Muitas tentativas. Aguarde alguns minutos.';
  if (msg.includes('User not found')) return 'Usuário não encontrado.';
  return msg;
}

async function doRegister() {
  const name     = document.getElementById('reg-name').value.trim();
  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const pass     = document.getElementById('reg-password').value;
  clearAuthErrors();
  if (!name || !email || !pass) return showAuthError('reg', 'Preencha todos os campos.');
  if (pass.length < 6)          return showAuthError('reg', 'Senha deve ter mínimo 6 caracteres.');

  const { data, error } = await sb.auth.signUp({
    email, password: pass,
    options: { data: { name, username } }
  });
  if (error) return showAuthError('reg', error.message || 'Erro ao criar conta.');

  if (data.user) {
    await sb.from('profiles').insert({
      id: data.user.id, email, name, username: username||name, role: 'pending'
    });
  }

  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('[data-auth="login"]').classList.add('active');
  document.getElementById('auth-panel-login').classList.remove('hidden');
  document.getElementById('auth-panel-register').classList.add('hidden');
  showToast('Cadastro enviado! Aguarde aprovação do admin. 🎉', 'success');
}

async function saveUsername() {
  if (!requireAdmin()) return;
  const username = document.getElementById('my-username-input').value.trim();
  if (!username) return showToast('Digite um nome de usuário!', 'error');
  const { error } = await sb.from('profiles').update({ username }).eq('id', currentProfile.id);
  if (error) return showToast('Erro ao salvar: ' + error.message, 'error');
  currentProfile.username = username;
  showToast(`Assinatura salva como "${username}"! ✅`, 'success');
}

function populateMyProfile() {
  const input = document.getElementById('my-username-input');
  if (input && currentProfile) {
    input.value = currentProfile.username || currentProfile.name || '';
  }
}

async function doLogout() {
  if (pendingWatcher) { clearInterval(pendingWatcher); pendingWatcher = null; }
  await sb.auth.signOut();
  currentUser = null; currentProfile = null; isGuest = false;
  document.body.classList.remove('is-admin');
  document.getElementById('app').classList.add('hidden');
  showAuthScreen();
}

function doGuestAccess() {
  isGuest = true;
  currentUser = null;
  currentProfile = null;
  boot_guest();
}

async function boot_guest() {
  await Promise.all([loadTeams(), loadEntries(), loadGincanas(), loadEvents()]);
  applyRoleUI();
  renderAll();
  subscribeRealtime();
  hideSplash();
  hideAllScreens();
  document.getElementById('app').classList.remove('hidden');
}

// ─── ADMIN: gerenciar usuários ───────────────────────
async function loadProfiles() {
  const { data } = await sb.from('profiles').select('*').order('created_at');
  profiles = data || [];
}

async function approveUser(id) {
  await sb.from('profiles').update({ role: 'admin' }).eq('id', id);
  await loadProfiles();
  renderAdminPanel();
  showToast('Usuário aprovado como Admin! ✅', 'success');
}

async function blockUser(id) {
  await sb.from('profiles').update({ role: 'blocked' }).eq('id', id);
  await loadProfiles();
  renderAdminPanel();
  showToast('Usuário bloqueado.', 'info');
}

async function revokeAdmin(id) {
  await sb.from('profiles').update({ role: 'pending' }).eq('id', id);
  await loadProfiles();
  renderAdminPanel();
  showToast('Acesso revogado.', 'info');
}

function renderAdminPanel() {
  const pending = profiles.filter(p => p.role === 'pending');
  const admins  = profiles.filter(p => ['admin','superadmin'].includes(p.role));

  const pendCount = document.getElementById('pending-count');
  pendCount.textContent = pending.length || '';

  const pendList = document.getElementById('pending-list');
  if (!pending.length) {
    pendList.innerHTML = `<div class="empty-state"><span class="empty-icon">✅</span>Nenhuma solicitação pendente.</div>`;
  } else {
    pendList.innerHTML = pending.map(p => `
      <div class="admin-user-item">
        <div class="admin-user-info">
          <div class="admin-user-name">${escHtml(p.name||p.email)}</div>
          <div class="admin-user-email">${escHtml(p.email)}</div>
        </div>
        <span class="admin-user-role role-pending">PENDENTE</span>
        <div class="admin-user-actions">
          <button class="btn-approve" data-approve="${p.id}">✅ Aprovar</button>
          <button class="btn-block"   data-block="${p.id}">🚫</button>
        </div>
      </div>`).join('');
    pendList.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => approveUser(b.dataset.approve)));
    pendList.querySelectorAll('[data-block]').forEach(b => b.addEventListener('click', () => blockUser(b.dataset.block)));
  }

  const adminList = document.getElementById('admins-list');
  adminList.innerHTML = admins.map(p => `
    <div class="admin-user-item">
      <div class="admin-user-info">
        <div class="admin-user-name">${escHtml(p.name||p.email)}</div>
        <div class="admin-user-email">${escHtml(p.email)}</div>
      </div>
      <span class="admin-user-role ${p.role==='superadmin'?'role-superadmin':'role-admin'}">
        ${p.role==='superadmin'?'SUPER ADMIN':'ADMIN'}
      </span>
      ${p.role !== 'superadmin' ? `
      <div class="admin-user-actions">
        <button class="btn-block" data-revoke="${p.id}" title="Revogar">↩️</button>
      </div>` : ''}
    </div>`).join('');
  adminList.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', () => revokeAdmin(b.dataset.revoke)));
}

// ─── SUPABASE DATA ───────────────────────────────────
async function loadTeams() {
  const { data, error } = await sb.from('teams').select('*').order('created_at');
  if (error) return { error };
  teams = data || [];
}
async function loadEntries() {
  const { data, error } = await sb.from('entries').select('*').order('created_at', { ascending: false });
  if (error) return { error };
  entries = data || [];
}
async function loadGincanas() {
  const { data, error } = await sb.from('gincanas').select('*').order('data_gin', { ascending: false });
  if (error) return { error };
  gincanas = data || [];
}
async function loadEvents() {
  const { data, error } = await sb.from('events').select('*').order('event_date', { ascending: true });
  if (error) return { error };
  events = data || [];
}

function subscribeRealtime() {
  sb.channel('ejc-realtime')
    .on('postgres_changes', { event:'*', schema:'public', table:'teams' },    async () => { await loadTeams();    renderAll(); })
    .on('postgres_changes', { event:'*', schema:'public', table:'entries' },  async () => { await loadEntries();  renderAll(); })
    .on('postgres_changes', { event:'*', schema:'public', table:'gincanas' }, async () => { await loadGincanas(); renderAll(); })
    .on('postgres_changes', { event:'*', schema:'public', table:'events' },   async () => { await loadEvents();   renderCalendar(); })
    .on('postgres_changes', { event:'*', schema:'public', table:'profiles' }, async () => { await loadProfiles(); renderAdminPanel(); })
    .subscribe();
}

// ─── DATE UTILS ─────────────────────────────────────
const today = () => new Date().toISOString().slice(0,10);
function getWeekRange() {
  const now=new Date(), mon=new Date(now);
  mon.setDate(now.getDate()-((now.getDay()+6)%7));
  const sun=new Date(mon); sun.setDate(mon.getDate()+6);
  return { start:mon.toISOString().slice(0,10), end:sun.toISOString().slice(0,10) };
}
function getMonthRange() {
  const now=new Date(), y=now.getFullYear(), m=now.getMonth();
  return { start:`${y}-${String(m+1).padStart(2,'0')}-01`, end:`${y}-${String(m+1).padStart(2,'0')}-${new Date(y,m+1,0).getDate()}` };
}
function getYearRange() { const y=new Date().getFullYear(); return { start:`${y}-01-01`, end:`${y}-12-31` }; }
function fmtDate(iso) { if(!iso) return ''; const [y,m,d]=iso.split('-'); return `${d}/${m}/${y}`; }
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ─── HELPERS ────────────────────────────────────────
function teamById(id) { return teams.find(t=>t.id===id); }
function ginById(id)  { return gincanas.find(g=>g.id===id); }

function calcRanking(entryList) {
  const totals = {};
  teams.forEach(t => { totals[t.id]=0; });
  entryList.forEach(e => { if(e.team_id in totals) totals[e.team_id]+=Number(e.points); });
  return teams.map(t=>({ id:t.id, name:t.name, color:t.color, pts:totals[t.id]||0 })).sort((a,b)=>b.pts-a.pts);
}

// ─── MASTER RENDER ──────────────────────────────────
function renderAll() {
  updateGlobalFilterUI();
  renderHome();
  renderRanking();
  renderHistory();
  renderCalendar();
  renderEquipesTab();
  renderGincanasTab();
  renderCalcTab();
  renderReport();
  if (currentProfile?.role === 'superadmin') { renderAdminPanel(); populateMyProfile(); }
  populateSelects();
  if (!document.getElementById('tab-charts').classList.contains('hidden')) renderCharts();
}

function updateGlobalFilterUI() {
  document.getElementById('gf-active-label').textContent = getFilterLabel();
  const sel=document.getElementById('gf-gin-select'), cur=sel.value;
  sel.innerHTML='<option value="">— escolha a competição —</option>'+
    gincanas.map(g=>`<option value="${g.id}">${escHtml(g.name)}${g.data_gin?' — '+fmtDate(g.data_gin):''}</option>`).join('');
  if(cur&&sel.querySelector(`option[value="${cur}"]`)) sel.value=cur;
}

function toggleFilterBarVisibility(tabName) {
  const bar=document.getElementById('global-filter-bar');
  const hiddenTabs=['equipes','gincanas','calc','adminpanel','report','calendar'];
  bar.classList.toggle('hidden-filter', hiddenTabs.includes(tabName));
}

// ─── HOME ────────────────────────────────────────────
function renderHome() {
  document.getElementById('home-period-label').textContent = getFilterLabel();
  const filtered = getFilteredEntries();
  document.getElementById('home-entries-label').textContent = filtered.length ? `${filtered.length} lançamento${filtered.length>1?'s':''}` : '';
  renderTop3(calcRanking(filtered));

  // Alerta de evento próximo na Home (só uma vez por sessão)
  if (!renderHome._alerted && events.length) {
    renderHome._alerted = true;
    setTimeout(calendarAlert, 1500); // delay para o app terminar de carregar
  }

  const sorted = [...filtered].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
  const list=document.getElementById('today-list');
  if(!sorted.length) { list.innerHTML=`<div class="empty-state"><span class="empty-icon">🎯</span>Nenhum lançamento neste período.</div>`; return; }
  list.innerHTML=sorted.map(e=>{
    const neg=e.points<0, team=teamById(e.team_id), gin=e.gin_id?ginById(e.gin_id):null;
    return `<div class="score-item ${neg?'punishment':''}">
      <div>
        <div class="score-team">${escHtml(team?.name||'?')}${neg?'<span class="score-badge-pun">PUNIÇÃO</span>':''}</div>
        ${gin?`<div class="score-desc">🎯 ${escHtml(gin.name)}</div>`:''}
        ${e.descricao?`<div class="score-desc">${escHtml(e.descricao)}</div>`:''}
        <div class="score-desc">📅 ${fmtDate(e.data_entry)}</div>
      </div>
      <div class="score-pts ${neg?'negative':''}">${e.points>0?'+':''}${e.points}</div>
    </div>`;
  }).join('');
}

function renderTop3(ranking) {
  const medals=['🥇','🥈','🥉'], labels=['1º','2º','3º'], top=ranking.slice(0,3);
  const grid=document.getElementById('top3-cards');
  if(!top.length){grid.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><span class="empty-icon">👥</span>Cadastre equipes!</div>`;return;}
  grid.innerHTML=top.map((t,i)=>`<div class="top3-card rank-${i+1}"><span class="top3-medal">${medals[i]}</span><div class="top3-name" title="${escHtml(t.name)}">${escHtml(t.name)}</div><div class="top3-pts ${t.pts<0?'negative':''}">${t.pts}</div><span class="top3-badge">${labels[i]}</span></div>`).join('');
}

// ─── RANKING ─────────────────────────────────────────
function renderRanking() {
  const ranking=calcRanking(getFilteredEntries());
  const list=document.getElementById('ranking-list');
  if(!ranking.length){list.innerHTML=`<div class="empty-state"><span class="empty-icon">🏆</span>Nenhum dado para este filtro.</div>`;return;}
  const posClass=i=>['gold','silver','bronze'][i]||'normal';
  list.innerHTML=ranking.map((t,i)=>`<div class="rank-item ${i<3?'rank-'+(i+1):''}"><span class="rank-pos ${posClass(i)}">${i+1}</span><span class="rank-dot" style="background:${t.color}"></span><span class="rank-name">${escHtml(t.name)}</span><div><div class="rank-pts ${t.pts<0?'negative':''}">${t.pts}</div><div class="rank-sub">pts</div></div></div>`).join('');
}

// ─── CHARTS ──────────────────────────────────────────
function renderCharts() {
  const filtered=getFilteredEntries(), ranking=calcRanking(filtered);
  let days;
  if(filterState.mode==='gin'){const g=ginById(filterState.ginId);days=g?.data_gin?[g.data_gin]:(filtered.length?getDaysInRange(filtered.map(e=>e.data_entry||today()).sort()[0],filtered.map(e=>e.data_entry||today()).sort().slice(-1)[0]):[today()]);}
  else if(filterState.mode==='custom'&&filterState.customFrom&&filterState.customTo){days=getDaysInRange(filterState.customFrom,filterState.customTo);}
  else{switch(filterState.period){case'today':days=[today()];break;case'week':{const w=getWeekRange();days=getDaysInRange(w.start,w.end);break;}case'month':{const m=getMonthRange();days=getDaysInRange(m.start,m.end);break;}case'year':{const y=getYearRange();days=getDaysInRange(y.start,y.end);break;}case'all':default:days=filtered.length?getDaysInRange(filtered.map(e=>e.data_entry||today()).sort()[0],filtered.map(e=>e.data_entry||today()).sort().slice(-1)[0]):[today()];}}
  const barCtx=document.getElementById('chart-bar').getContext('2d');
  if(barChart)barChart.destroy();
  barChart=new Chart(barCtx,{type:'bar',data:{labels:ranking.map(t=>t.name),datasets:[{data:ranking.map(t=>t.pts),backgroundColor:ranking.map(t=>t.color+'bb'),borderColor:ranking.map(t=>t.color),borderWidth:2,borderRadius:8}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>` ${c.raw} pts`}}},scales:{x:{grid:{color:'rgba(255,255,255,.05)'},ticks:{color:'#a78bb5',font:{family:'Nunito'}}},y:{grid:{display:false},ticks:{color:'#f0e6ff',font:{family:'Nunito',weight:'700'},maxRotation:0}}}}});
  const datasets=teams.map(team=>({label:team.name,data:days.map(d=>filtered.filter(e=>e.team_id===team.id&&(e.data_entry||'')<=d).reduce((s,e)=>s+Number(e.points),0)),borderColor:team.color||'#888',backgroundColor:(team.color||'#888')+'22',tension:.4,fill:true,pointRadius:3,pointBackgroundColor:team.color||'#888'}));
  const lineCtx=document.getElementById('chart-line').getContext('2d');
  if(lineChart)lineChart.destroy();
  lineChart=new Chart(lineCtx,{type:'line',data:{labels:days.map(d=>d.slice(5).replace('-','/')),datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#a78bb5',font:{family:'Nunito',size:11},boxWidth:12}}},scales:{x:{grid:{color:'rgba(255,255,255,.05)'},ticks:{color:'#a78bb5',font:{family:'Nunito',size:11}}},y:{grid:{color:'rgba(255,255,255,.05)'},ticks:{color:'#a78bb5',font:{family:'Nunito'}}}}}});
}
function getDaysInRange(start,end){const days=[],cur=new Date(start),last=new Date(end);while(cur<=last){days.push(cur.toISOString().slice(0,10));cur.setDate(cur.getDate()+1);}return days;}

// ─── HISTORY ─────────────────────────────────────────
function renderHistory() {
  const isAdmin = canWrite();
  const base=getFilteredEntries();
  const all=base.filter(e=>{
    if(!historyFilter)return true;
    return(teamById(e.team_id)?.name||'').toLowerCase().includes(historyFilter.toLowerCase());
  }).sort((a,b)=>{
    const da=a.data_entry||'', db=b.data_entry||'';
    const dc=db.localeCompare(da);
    return dc!==0?dc:new Date(b.created_at||0)-new Date(a.created_at||0);
  });
  const list=document.getElementById('history-list');
  if(!all.length){list.innerHTML=`<div class="empty-state"><span class="empty-icon">📋</span>Nenhum lançamento encontrado.</div>`;return;}
  list.innerHTML=all.map(e=>{
    const neg=e.points<0, team=teamById(e.team_id), gin=e.gin_id?ginById(e.gin_id):null;
    const parts=(e.data_entry||'--').split('-'), [y,m,d]=parts.length===3?parts:['?','?','?'];
    const lancadoPor = e.launched_by_name ? `✍️ ${escHtml(e.launched_by_name)}` : '';
    return `<div class="history-item ${neg?'punishment':''}">
      <div class="history-main">
        <div class="history-team">${escHtml(team?.name||'?')}${neg?'<span class="score-badge-pun">PUNIÇÃO</span>':''}</div>
        <div class="history-meta">${d}/${m}/${y} · ${e.tipo==='punishment'?'Punição':'Pontuação'}${lancadoPor?' · '+lancadoPor:''}</div>
        ${gin?`<div class="history-gin">🎯 ${escHtml(gin.name)}</div>`:''}
        ${e.descricao?`<div class="history-desc">${escHtml(e.descricao)}</div>`:''}
      </div>
      <div class="history-right">
        <div class="history-pts ${neg?'negative':''}">${e.points>0?'+':''}${e.points}</div>
        ${e.completion_time?`<div class="history-time">⏱ ${escHtml(e.completion_time)}</div>`:''}
        ${isAdmin?`<div class="history-actions"><button class="btn-edit" data-edit-entry="${e.id}">✏️</button><button class="btn-delete" data-del-entry="${e.id}">🗑</button></div>`:''}
      </div>
    </div>`;
  }).join('');
  if(isAdmin){
    list.querySelectorAll('[data-edit-entry]').forEach(btn=>btn.addEventListener('click',()=>openEditEntry(btn.dataset.editEntry)));
    list.querySelectorAll('[data-del-entry]').forEach(btn=>btn.addEventListener('click',()=>confirmDeleteEntry(btn.dataset.delEntry)));
  }
}

// ─── RELATÓRIO / EXPORTAÇÃO ──────────────────────────
function renderReport() {
  const period  = document.getElementById('report-period-select')?.value || 'week';
  const customRange = document.getElementById('report-custom-range');

  // Mostra/oculta os campos de data personalizada
  if (customRange) {
    customRange.classList.toggle('hidden', period !== 'custom');
  }

  let start, end, label;
  switch(period) {
    case 'today':  start=end=today(); label='Hoje — '+fmtDate(today()); break;
    case 'week':   { const w=getWeekRange();  start=w.start; end=w.end; label=`Semana: ${fmtDate(w.start)} – ${fmtDate(w.end)}`; break; }
    case 'month':  { const m=getMonthRange(); start=m.start; end=m.end; const n=new Date(); label=`${n.toLocaleString('pt-BR',{month:'long'})} ${n.getFullYear()}`; break; }
    case 'year':   { const y=getYearRange();  start=y.start; end=y.end; label=`Ano ${new Date().getFullYear()}`; break; }
    case 'all':    start=null; end=null; label='Todo o histórico'; break;
    case 'custom': {
      const from = document.getElementById('report-date-from')?.value;
      const to   = document.getElementById('report-date-to')?.value;
      if (!from || !to) {
        // Ainda não aplicou — mostra o card vazio com instrução
        document.getElementById('report-period-label').textContent = 'Selecione as datas e clique em Aplicar';
        document.getElementById('report-date-gen').textContent = new Date().toLocaleString('pt-BR');
        document.getElementById('report-ranking-list').innerHTML =
          `<div style="text-align:center;padding:1.5rem 0;color:var(--muted);font-size:.88rem">
            ✂️ Escolha as datas acima e clique em <strong>Aplicar Período</strong>
          </div>`;
        return;
      }
      start = from; end = to;
      label = `${fmtDate(from)} → ${fmtDate(to)}`;
      break;
    }
  }

  const filtered = start ? entries.filter(e=>(e.data_entry||'')>=start&&(e.data_entry||'')<=end) : entries;
  const ranking  = calcRanking(filtered);
  const posClass = i=>['gold','silver','bronze'][i]||'normal';
  const medals   = ['🥇','🥈','🥉'];

  document.getElementById('report-period-label').textContent = label;
  document.getElementById('report-date-gen').textContent = new Date().toLocaleString('pt-BR');
  document.getElementById('report-ranking-list').innerHTML = ranking.map((t,i)=>`
    <div class="report-rank-item ${i<3?'rr-'+(i+1):''}">
      <span class="rr-pos ${posClass(i)}">${medals[i]||i+1+'º'}</span>
      <span class="rr-dot" style="background:${t.color}"></span>
      <span class="rr-name">${escHtml(t.name)}</span>
      <span class="rr-pts ${t.pts<0?'negative':''}">${t.pts>0?'+':''}${t.pts}</span>
    </div>`).join('');
}

async function exportImage() {
  const card = document.getElementById('report-card');
  showToast('Gerando imagem...', 'info');
  try {
    const canvas = await html2canvas(card, {
      backgroundColor: '#1a0533', scale: 2,
      useCORS: true, allowTaint: true
    });
    const link = document.createElement('a');
    link.download = `ranking-ejc-${today()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('Imagem salva! 📸', 'success');
  } catch(e) { showToast('Erro ao gerar imagem.', 'error'); console.error(e); }
}

async function exportPDF() {
  const card = document.getElementById('report-card');
  showToast('Gerando PDF...', 'info');
  try {
    const canvas = await html2canvas(card, { backgroundColor: '#1a0533', scale: 2, useCORS: true });
    const { jsPDF } = window.jspdf;
    const pdf  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const imgW = 190, imgH = (canvas.height * imgW) / canvas.width;
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 10, imgW, imgH);
    pdf.save(`ranking-ejc-${today()}.pdf`);
    showToast('PDF salvo! 📄', 'success');
  } catch(e) { showToast('Erro ao gerar PDF.', 'error'); console.error(e); }
}

// ─── EQUIPES CRUD ────────────────────────────────────
function renderEquipesTab() {
  const list=document.getElementById('teams-list'), count=document.getElementById('teams-count');
  count.textContent=teams.length||'';
  if(!teams.length){list.innerHTML=`<div class="empty-state"><span class="empty-icon">👥</span>Nenhuma equipe.</div>`;return;}
  const totals={};
  entries.forEach(e=>{totals[e.team_id]=(totals[e.team_id]||0)+Number(e.points);});
  list.innerHTML=teams.map(t=>{const pts=totals[t.id]||0;return`<div class="team-entity-item"><span class="team-dot" style="background:${t.color}"></span><div class="team-entity-info"><div class="team-entity-name">${escHtml(t.name)}</div><div class="team-entity-sub">Saldo acumulado</div></div><div class="team-entity-pts ${pts<0?'negative':''}">${pts>=0?'+':''}${pts}</div><div class="entity-actions"><button class="btn-edit" data-edit-team="${t.id}">✏️</button><button class="btn-delete" data-del-team="${t.id}">🗑</button></div></div>`;}).join('');
  list.querySelectorAll('[data-edit-team]').forEach(btn=>btn.addEventListener('click',()=>startEditTeam(btn.dataset.editTeam)));
  list.querySelectorAll('[data-del-team]').forEach(btn=>btn.addEventListener('click',()=>confirmDeleteTeam(btn.dataset.delTeam)));
}
function startEditTeam(id){const t=teams.find(x=>x.id===id);if(!t)return;editingTeamId=id;document.getElementById('team-name-input').value=t.name;document.getElementById('team-color-input').value=t.color;document.getElementById('team-form-title').textContent='✏️ Editar Equipe';document.getElementById('team-form-title').classList.add('editing-mode');document.getElementById('team-form-card').classList.add('editing');document.getElementById('btn-team-save').textContent='Salvar Alterações';document.getElementById('btn-team-save').classList.add('blue-mode');document.getElementById('btn-team-cancel').style.display='';document.getElementById('team-form-card').scrollIntoView({behavior:'smooth',block:'start'});}
function cancelEditTeam(){editingTeamId=null;document.getElementById('team-name-input').value='';document.getElementById('team-color-input').value='#f59e0b';document.getElementById('team-form-title').textContent='✨ Nova Equipe';document.getElementById('team-form-title').classList.remove('editing-mode');document.getElementById('team-form-card').classList.remove('editing');document.getElementById('btn-team-save').textContent='+ Adicionar Equipe';document.getElementById('btn-team-save').classList.remove('blue-mode');document.getElementById('btn-team-cancel').style.display='none';}
async function saveTeam(){
  if (!requireAdmin()) return;
  const name=document.getElementById('team-name-input').value.trim(),color=document.getElementById('team-color-input').value;if(!name)return showToast('Digite o nome!','error');const dup=teams.find(t=>t.name.toLowerCase()===name.toLowerCase()&&t.id!==editingTeamId);if(dup)return showToast('Nome já existe!','error');if(editingTeamId){const{error}=await sb.from('teams').update({name,color}).eq('id',editingTeamId);if(error){console.error(error);return showToast('Erro: '+error.message,'error');}showToast(`"${name}" atualizada! ✅`,'success');cancelEditTeam();}else{const{error}=await sb.from('teams').insert({name,color});if(error){console.error(error);return showToast('Erro: '+error.message,'error');}showToast(`Equipe "${name}" criada! 🙌`,'success');document.getElementById('team-name-input').value='';}
}
function confirmDeleteTeam(id){if(!requireAdmin())return;const t=teams.find(x=>x.id===id);if(!t)return;const n=entries.filter(e=>e.team_id===id).length;document.getElementById('confirm-title').textContent='Excluir Equipe';document.getElementById('confirm-message').innerHTML=`Excluir <strong>${escHtml(t.name)}</strong>?`+(n>0?`<br><br>⚠️ <strong>${n} lançamentos</strong> vinculados não serão apagados.`:'');confirmCallback=()=>deleteTeam(id);openModal('modal-confirm');}
async function deleteTeam(id){const{error}=await sb.from('teams').delete().eq('id',id);if(error){console.error(error);return showToast('Erro: '+error.message,'error');}if(editingTeamId===id)cancelEditTeam();showToast('Equipe excluída.','info');}

// ─── GINCANAS CRUD ───────────────────────────────────
function renderGincanasTab(){const list=document.getElementById('gincanas-list'),count=document.getElementById('gincanas-count');count.textContent=gincanas.length||'';if(!gincanas.length){list.innerHTML=`<div class="empty-state"><span class="empty-icon">🎯</span>Nenhuma gincana.</div>`;return;}list.innerHTML=gincanas.map(g=>{const hasObs=g.obs&&g.obs.trim().length>0;return`<div class="gin-entity-item"><div class="gin-entity-header"><span class="gin-entity-name">🎯 ${escHtml(g.name)}</span><div class="entity-actions"><button class="btn-edit" data-edit-gin="${g.id}">✏️</button><button class="btn-delete" data-del-gin="${g.id}">🗑</button></div></div><div class="gin-entity-meta">${g.data_gin?`<span class="gin-entity-date">📅 ${fmtDate(g.data_gin)}</span>`:''}${g.max_pts?`<span class="gin-entity-maxpts">${g.max_pts} pts máx.</span>`:''}${g.scoring_type?`<span class="gin-entity-maxpts">${g.scoring_type==='time'?'⏱ TEMPO':'🏅 PONTOS'}</span>`:''}</div>${hasObs?`<div class="gin-entity-obs-preview">${escHtml(g.obs)}</div><button class="gin-see-more" data-view-gin="${g.id}">Ver dinâmica →</button>`:''}</div>`;}).join('');list.querySelectorAll('[data-edit-gin]').forEach(btn=>btn.addEventListener('click',()=>startEditGin(btn.dataset.editGin)));list.querySelectorAll('[data-del-gin]').forEach(btn=>btn.addEventListener('click',()=>confirmDeleteGin(btn.dataset.delGin)));list.querySelectorAll('[data-view-gin]').forEach(btn=>btn.addEventListener('click',()=>viewGinDetail(btn.dataset.viewGin)));}
function startEditGin(id){const g=gincanas.find(x=>x.id===id);if(!g)return;editingGinId=id;document.getElementById('gin-name-input').value=g.name;document.getElementById('gin-date-input').value=g.data_gin||'';document.getElementById('gin-maxpts-input').value=g.max_pts||'';document.getElementById('gin-obs-input').value=g.obs||'';const st=g.scoring_type||'points';document.getElementById('gin-scoring-type').value=st;document.querySelectorAll('.scoring-btn').forEach(b=>b.classList.remove('active'));document.getElementById(st==='time'?'gin-type-time':'gin-type-points').classList.add('active');document.getElementById('gin-form-title').textContent='✏️ Editar Gincana';document.getElementById('gin-form-title').classList.add('editing-mode');document.getElementById('gin-form-card').classList.add('editing');document.getElementById('btn-gin-save').textContent='Salvar Alterações';document.getElementById('btn-gin-save').classList.add('blue-mode');document.getElementById('btn-gin-cancel').style.display='';document.getElementById('gin-form-card').scrollIntoView({behavior:'smooth',block:'start'});}
function cancelEditGin(){editingGinId=null;document.getElementById('gin-name-input').value='';document.getElementById('gin-date-input').value=today();document.getElementById('gin-maxpts-input').value='';document.getElementById('gin-obs-input').value='';document.getElementById('gin-scoring-type').value='points';document.querySelectorAll('.scoring-btn').forEach(b=>b.classList.remove('active'));document.getElementById('gin-type-points').classList.add('active');document.getElementById('gin-form-title').textContent='✨ Nova Gincana';document.getElementById('gin-form-title').classList.remove('editing-mode');document.getElementById('gin-form-card').classList.remove('editing');document.getElementById('btn-gin-save').textContent='+ Criar Gincana';document.getElementById('btn-gin-save').classList.remove('blue-mode');document.getElementById('btn-gin-cancel').style.display='none';}
async function saveGincana(){
  if(!requireAdmin())return;
  const name=document.getElementById('gin-name-input').value.trim(),date=document.getElementById('gin-date-input').value,maxPts=document.getElementById('gin-maxpts-input').value,obs=document.getElementById('gin-obs-input').value.trim(),scoringType=document.getElementById('gin-scoring-type').value||'points';if(!name)return showToast('Digite o nome!','error');const payload={name,data_gin:date||null,max_pts:maxPts?Number(maxPts):null,obs:obs||null,scoring_type:scoringType};if(editingGinId){const{error}=await sb.from('gincanas').update(payload).eq('id',editingGinId);if(error){console.error(error);return showToast('Erro: '+error.message,'error');}showToast(`"${name}" atualizada! ✅`,'success');cancelEditGin();}else{const{error}=await sb.from('gincanas').insert(payload);if(error){console.error(error);return showToast('Erro: '+error.message,'error');}showToast(`Gincana "${name}" criada! 🎯`,'success');document.getElementById('gin-name-input').value='';document.getElementById('gin-maxpts-input').value='';document.getElementById('gin-obs-input').value='';}
}
function confirmDeleteGin(id){if(!requireAdmin())return;const g=gincanas.find(x=>x.id===id);if(!g)return;const n=entries.filter(e=>e.gin_id===id).length;document.getElementById('confirm-title').textContent='Excluir Gincana';document.getElementById('confirm-message').innerHTML=`Excluir <strong>${escHtml(g.name)}</strong>?`+(n>0?`<br><br>⚠️ <strong>${n} lançamentos</strong> vinculados não serão apagados.`:'');confirmCallback=()=>deleteGincana(id);openModal('modal-confirm');}
async function deleteGincana(id){const{error}=await sb.from('gincanas').delete().eq('id',id);if(error){console.error(error);return showToast('Erro: '+error.message,'error');}if(editingGinId===id)cancelEditGin();showToast('Gincana excluída.','info');}
function viewGinDetail(id){const g=gincanas.find(x=>x.id===id);if(!g)return;document.getElementById('gin-detail-title').textContent=`🎯 ${g.name}`;document.getElementById('gin-detail-body').innerHTML=`<div class="gin-detail-meta">${g.data_gin?`<span class="gin-detail-chip">📅 ${fmtDate(g.data_gin)}</span>`:''}${g.max_pts?`<span class="gin-detail-chip">🏅 ${g.max_pts} pts</span>`:''}${g.scoring_type?`<span class="gin-detail-chip">${g.scoring_type==='time'?'⏱ TEMPO':'🏅 PONTOS'}</span>`:''}</div>${g.obs?`<div class="gin-detail-obs-label">📝 Dinâmica</div><div class="gin-detail-obs">${escHtml(g.obs)}</div>`:'<p style="color:var(--muted)">Sem observações.</p>'}`;openModal('modal-gin-detail');}

// ─── CALCULADORA ─────────────────────────────────────
function renderCalcTab(){const sel=document.getElementById('calc-gin-select'),cur=sel.value;sel.innerHTML='<option value="">— escolha a gincana —</option>'+gincanas.map(g=>{const icon=g.scoring_type==='time'?'⏱':'🏅';return`<option value="${g.id}">${icon} ${escHtml(g.name)}${g.data_gin?' — '+fmtDate(g.data_gin):''}</option>`;}).join('');if(cur&&sel.querySelector(`option[value="${cur}"]`)){sel.value=cur;onCalcGinChange(cur);}}
function onCalcGinChange(ginId){const g=ginById(ginId),badge=document.getElementById('calc-type-badge'),area=document.getElementById('calc-teams-area'),actions=document.getElementById('calc-actions'),resultEl=document.getElementById('calc-result');calcSimResult=[];resultEl.classList.add('hidden');if(!g){badge.classList.add('hidden');area.innerHTML='';actions.style.display='none';return;}const isTime=g.scoring_type==='time';badge.className=`calc-type-badge${isTime?' time-mode':''}`;badge.classList.remove('hidden');badge.textContent=isTime?'⏱ Modo TEMPO — vence quem for mais rápido':'🏅 Modo PONTOS — vence quem somar mais';area.innerHTML=teams.length?`<div class="calc-teams-area">${teams.map(t=>`<div class="calc-team-row"><span class="calc-team-dot" style="background:${t.color}"></span><span class="calc-team-name">${escHtml(t.name)}</span>${isTime?`<div class="calc-time-wrap" data-team="${t.id}"><input class="calc-time-inp" data-team="${t.id}" data-part="min" type="text" inputmode="numeric" placeholder="00" maxlength="2"/><span class="calc-time-dot">:</span><input class="calc-time-inp" data-team="${t.id}" data-part="sec" type="text" inputmode="numeric" placeholder="00" maxlength="2"/><span class="calc-time-dot">:</span><input class="calc-time-inp" data-team="${t.id}" data-part="ms" type="text" inputmode="numeric" placeholder="00" maxlength="2"/></div>`:`<input class="calc-pts-input" data-team="${t.id}" type="number" placeholder="Pts" min="0"/>`}</div>`).join('')}</div>`:`<div class="empty-state">Cadastre equipes primeiro.</div>`;if(isTime)area.querySelectorAll('.calc-time-inp').forEach(inp=>{inp.addEventListener('input',()=>{inp.value=inp.value.replace(/\D/,'').slice(0,2);});});actions.style.display=teams.length?'':'none';}
function timeToMs(str){if(!str)return Infinity;const[mm,ss,ms]=str.split(':').map(Number);return((mm||0)*60*1000)+((ss||0)*1000)+(ms||0)*10;}
function simulateCalc(){const ginId=document.getElementById('calc-gin-select').value,g=ginById(ginId);if(!g)return showToast('Selecione uma gincana!','error');const isTime=g.scoring_type==='time';const rows=teams.map(t=>{if(isTime){const min=document.querySelector(`.calc-time-inp[data-team="${t.id}"][data-part="min"]`)?.value||'',sec=document.querySelector(`.calc-time-inp[data-team="${t.id}"][data-part="sec"]`)?.value||'',ms=document.querySelector(`.calc-time-inp[data-team="${t.id}"][data-part="ms"]`)?.value||'';const timeStr=(min||sec||ms)?`${(min||'00').padStart(2,'0')}:${(sec||'00').padStart(2,'0')}:${(ms||'00').padStart(2,'0')}`:null;return{teamId:t.id,name:t.name,color:t.color,time:timeStr,value:timeToMs(timeStr)};}else{const val=Number(document.querySelector(`.calc-pts-input[data-team="${t.id}"]`)?.value||0);return{teamId:t.id,name:t.name,color:t.color,value:val,time:null};}});const filled=rows.filter(r=>isTime?r.time!==null:r.value>0);if(!filled.length)return showToast(isTime?'Preencha o tempo de pelo menos uma equipe!':'Preencha a pontuação de pelo menos uma equipe!','error');filled.sort((a,b)=>isTime?a.value-b.value:b.value-a.value);const pts=[100,80,60,40,30,20,10];calcSimResult=filled.map((r,i)=>({...r,pts:isTime?(pts[i]??5):r.value,pos:i+1}));renderCalcResult(isTime);document.getElementById('calc-result').classList.remove('hidden');document.getElementById('calc-result').scrollIntoView({behavior:'smooth',block:'start'});}
function renderCalcResult(isTime){const posClass=i=>['gold','silver','bronze'][i]||'normal',medals=['🥇','🥈','🥉'];document.getElementById('calc-result-list').innerHTML=calcSimResult.map((r,i)=>`<div class="calc-result-item ${i<3?'rank-'+(i+1):''}"><span class="calc-res-pos ${posClass(i)}">${medals[i]||r.pos+'º'}</span><span class="calc-res-dot" style="background:${r.color}"></span><div class="calc-res-info"><div class="calc-res-name">${escHtml(r.name)}</div>${r.time?`<div class="calc-res-time">⏱ ${r.time}</div>`:''}${!isTime?`<div class="calc-res-time">Bruto: ${r.value}</div>`:''}</div><div class="calc-res-pts">+${r.pts}</div></div>`).join('');}
async function oficializarCalc(){
  if(!requireAdmin())return;
  const ginId=document.getElementById('calc-gin-select').value,g=ginById(ginId);if(!g||!calcSimResult.length)return showToast('Nada para oficializar!','error');const btn=document.getElementById('btn-calc-oficializar');btn.disabled=true;btn.textContent='⏳ Salvando...';
  const launchedByName = currentProfile?.username || currentProfile?.name || currentProfile?.email || '';
  const launchedById   = currentProfile?.id || null;
  let erros=0;for(const r of calcSimResult){const{error}=await sb.from('entries').insert({team_id:r.teamId,gin_id:ginId,points:r.pts,descricao:`Calculadora — ${g.name} — ${r.pos}º lugar`,data_entry:today(),tipo:'bonus',completion_time:r.time||null,launched_by_id:launchedById,launched_by_name:launchedByName});if(error){console.error(error);erros++;}}btn.disabled=false;btn.textContent='✅ Oficializar Resultados';if(erros>0){showToast(`${erros} erro(s) ao salvar.`,'error');}else{showToast(`${calcSimResult.length} lançamentos oficializados! 🎉`,'success');calcSimResult=[];document.getElementById('calc-result').classList.add('hidden');document.getElementById('calc-gin-select').value='';document.getElementById('calc-type-badge').classList.add('hidden');document.getElementById('calc-teams-area').innerHTML='';document.getElementById('calc-actions').style.display='none';}
}

// ─── ENTRY EDIT/DELETE ───────────────────────────────
function openEditEntry(id){const e=entries.find(x=>x.id===id);if(!e)return;const teamOpts=teams.map(t=>`<option value="${t.id}" ${t.id===e.team_id?'selected':''}>${escHtml(t.name)}</option>`).join('');const ginOpts=gincanas.map(g=>`<option value="${g.id}" ${g.id===e.gin_id?'selected':''}>${escHtml(g.name)}</option>`).join('');document.getElementById('edit-entry-id').value=e.id;document.getElementById('edit-entry-team').innerHTML='<option value="">— selecione —</option>'+teamOpts;document.getElementById('edit-entry-gin').innerHTML='<option value="">— nenhuma —</option>'+ginOpts;document.getElementById('edit-entry-pts').value=e.points;document.getElementById('edit-entry-desc').value=e.descricao||'';document.getElementById('edit-entry-date').value=e.data_entry;if(e.completion_time){const parts=e.completion_time.split(':');document.getElementById('edit-time-min').value=parts[0]||'';document.getElementById('edit-time-sec').value=parts[1]||'';document.getElementById('edit-time-ms').value=parts[2]||'';}else{document.getElementById('edit-time-min').value='';document.getElementById('edit-time-sec').value='';document.getElementById('edit-time-ms').value='';}const box=document.getElementById('modal-edit-entry').querySelector('.modal-box');if(e.tipo==='punishment'){box.classList.add('punishment-box');document.getElementById('edit-entry-modal-title').textContent='⚠️ Editar Punição';}else{box.classList.remove('punishment-box');document.getElementById('edit-entry-modal-title').textContent='✏️ Editar Lançamento';}openModal('modal-edit-entry');}
async function saveEditEntry(){
  if(!requireAdmin())return;
  const id=document.getElementById('edit-entry-id').value,team_id=document.getElementById('edit-entry-team').value,gin_id=document.getElementById('edit-entry-gin').value,points=Number(document.getElementById('edit-entry-pts').value),descricao=document.getElementById('edit-entry-desc').value.trim(),data_entry=document.getElementById('edit-entry-date').value;const min=document.getElementById('edit-time-min').value,sec=document.getElementById('edit-time-sec').value,ms=document.getElementById('edit-time-ms').value;const completionTime=(min||sec||ms)?`${(min||'00').padStart(2,'0')}:${(sec||'00').padStart(2,'0')}:${(ms||'00').padStart(2,'0')}`:null;if(!team_id)return showToast('Selecione uma equipe!','error');if(!points||isNaN(points))return showToast('Informe a pontuação!','error');if(!data_entry)return showToast('Informe a data!','error');const entry=entries.find(x=>x.id===id);const tipo=entry?.tipo||(points<0?'punishment':'bonus');const{error}=await sb.from('entries').update({team_id,gin_id:gin_id||null,points,descricao,data_entry,tipo,completion_time:completionTime||null}).eq('id',id);if(error){console.error(error);return showToast('Erro: '+error.message,'error');}closeModal('modal-edit-entry');showToast('Lançamento atualizado! ✅','success');
}
function confirmDeleteEntry(id){if(!requireAdmin())return;const e=entries.find(x=>x.id===id);if(!e)return;const team=teamById(e.team_id);document.getElementById('confirm-title').textContent='Excluir Lançamento';document.getElementById('confirm-message').innerHTML=`Excluir lançamento de <strong>${e.points>0?'+':''}${e.points} pts</strong> para <strong>${escHtml(team?.name||'?')}</strong> em <strong>${fmtDate(e.data_entry)}</strong>?<br><br>⚠️ Ação <strong>não pode ser desfeita</strong>.`;confirmCallback=()=>deleteEntry(id);openModal('modal-confirm');}
async function deleteEntry(id){const{error}=await sb.from('entries').delete().eq('id',id);if(error){console.error(error);return showToast('Erro: '+error.message,'error');}showToast('Lançamento excluído.','info');}

// ─── ENTRY SAVE ──────────────────────────────────────
async function saveEntry({teamId,ginId,points,desc,date,type,completionTime}){
  if (!requireAdmin()) return;
  // Assinatura: usa username se definido, senão nome, senão email
  const launchedByName = currentProfile?.username || currentProfile?.name || currentProfile?.email || '';
  const launchedById   = currentProfile?.id || null;
  const payload={
    team_id:          teamId,
    gin_id:           ginId||null,
    points:           Number(points),
    descricao:        desc||'',
    data_entry:       date,
    tipo:             type,
    completion_time:  completionTime||null,
    launched_by_id:   launchedById,
    launched_by_name: launchedByName
  };
  const{error}=await sb.from('entries').insert(payload);
  if(error){console.error(error);showToast('Erro: '+error.message,'error');}
}

// ════════════════════════════════════════════════════
//   CALENDÁRIO / AGENDA DE EVENTOS
// ════════════════════════════════════════════════════

// Monta a lista de meses disponíveis baseado nos eventos cadastrados
function getEventMonths() {
  const seen = new Set();
  const now = new Date();
  const months = [];

  // Sempre inclui o mês atual e o próximo, mesmo sem eventos
  for (let i = 0; i <= 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!seen.has(key)) {
      seen.add(key);
      months.push({ year: d.getFullYear(), month: d.getMonth() });
    }
  }

  // Adiciona meses de eventos existentes
  events.forEach(ev => {
    if (!ev.event_date) return;
    const d = new Date(ev.event_date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!seen.has(key)) {
      seen.add(key);
      months.push({ year: d.getFullYear(), month: d.getMonth() });
    }
  });

  return months.sort((a,b) => a.year !== b.year ? a.year-b.year : a.month-b.month);
}

function monthLabel(year, month) {
  const d = new Date(year, month, 1);
  return d.toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
          .replace(/^\w/, c => c.toUpperCase());
}

function renderCalendar() {
  const list  = document.getElementById('calendar-list');
  const label = document.getElementById('cal-next-label');
  const nav   = document.getElementById('cal-month-nav');
  if (!list) return;

  const now = new Date();

  // Inicializa filtro no mês atual se null
  if (!calFilterMonth) {
    calFilterMonth = { year: now.getFullYear(), month: now.getMonth() };
  }

  // Renderiza navegação de meses
  if (nav) {
    const months = getEventMonths();
    nav.innerHTML = months.map(m => {
      const active = m.year === calFilterMonth.year && m.month === calFilterMonth.month;
      return `<button class="cal-month-chip ${active ? 'active' : ''}"
        data-cy="${m.year}" data-cm="${m.month}">
        ${monthLabel(m.year, m.month)}
      </button>`;
    }).join('');

    nav.querySelectorAll('.cal-month-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        calFilterMonth = { year: Number(btn.dataset.cy), month: Number(btn.dataset.cm) };
        renderCalendar();
      });
    });
  }

  // Filtra eventos pelo mês selecionado
  const filtered = events.filter(ev => {
    if (!ev.event_date) return false;
    const d = new Date(ev.event_date);
    return d.getFullYear() === calFilterMonth.year && d.getMonth() === calFilterMonth.month;
  });

  // Ordena: futuros primeiro, passados depois
  const upcoming = filtered.filter(e => new Date(e.event_date) >= now)
    .sort((a,b) => new Date(a.event_date) - new Date(b.event_date));
  const past = filtered.filter(e => new Date(e.event_date) < now)
    .sort((a,b) => new Date(b.event_date) - new Date(a.event_date));
  const ordered = [...upcoming, ...past];

  // Label do próximo evento (global, não filtrado)
  const allUpcoming = events
    .filter(e => e.event_date && new Date(e.event_date) >= now)
    .sort((a,b) => new Date(a.event_date) - new Date(b.event_date));

  if (allUpcoming.length) {
    const next = allUpcoming[0];
    const diff = diffDays(now, new Date(next.event_date));
    label.textContent = diff === 0
      ? '🔴 Hoje!'
      : `próximo em ${diff} dia${diff>1?'s':''}`;
  } else {
    label.textContent = '';
  }

  if (!ordered.length) {
    list.innerHTML = `<div class="empty-state">
      <span class="empty-icon">📅</span>
      Nenhum evento em ${monthLabel(calFilterMonth.year, calFilterMonth.month)}.
    </div>`;
    return;
  }

  const isAdmin = canWrite();

  list.innerHTML = ordered.map(ev => {
    const evDate  = new Date(ev.event_date);
    const isPast  = evDate < now;
    const diff    = diffDays(now, evDate);

    const dayNum  = String(evDate.getDate()).padStart(2,'0');
    const monStr  = evDate.toLocaleString('pt-BR', { month:'short' }).toUpperCase().replace('.','');
    const timeStr = evDate.toLocaleString('pt-BR', { hour:'2-digit', minute:'2-digit' });
    const yearStr = evDate.getFullYear();

    let urgencyBadge = '';
    if (!isPast) {
      if (diff === 0)     urgencyBadge = '<span class="ev-badge ev-today">HOJE</span>';
      else if (diff <= 6) urgencyBadge = `<span class="ev-badge ev-soon">Em ${diff}d</span>`;
    }

    return `<div class="cal-event-item ${isPast ? 'ev-past' : ''}">
      <div class="cal-date-badge">
        <div class="cal-day">${dayNum}</div>
        <div class="cal-mon">${monStr}</div>
        <div class="cal-year">${yearStr}</div>
      </div>
      <div class="cal-event-info">
        <div class="cal-event-title">${escHtml(ev.title)} ${urgencyBadge}</div>
        ${timeStr    ? `<div class="cal-event-meta">🕐 ${timeStr}</div>` : ''}
        ${ev.location? `<div class="cal-event-meta">📍 ${escHtml(ev.location)}</div>` : ''}
        ${ev.description ? `<div class="cal-event-desc">${escHtml(ev.description)}</div>` : ''}
      </div>
      ${isAdmin ? `<div class="entity-actions" style="flex-shrink:0;align-self:flex-start">
        <button class="btn-edit"   data-edit-ev="${ev.id}">✏️</button>
        <button class="btn-delete" data-del-ev="${ev.id}">🗑</button>
      </div>` : ''}
    </div>`;
  }).join('');

  if (isAdmin) {
    list.querySelectorAll('[data-edit-ev]').forEach(btn =>
      btn.addEventListener('click', () => openEventModal(btn.dataset.editEv)));
    list.querySelectorAll('[data-del-ev]').forEach(btn =>
      btn.addEventListener('click', () => confirmDeleteEvent(btn.dataset.delEv)));
  }
}

// Alerta in-app ao abrir a aba
function calendarAlert() {
  const now = new Date();
  const upcoming = events
    .filter(e => e.event_date && new Date(e.event_date) >= now)
    .sort((a,b) => new Date(a.event_date) - new Date(b.event_date));

  if (!upcoming.length) return;

  const next = upcoming[0];
  const diff = diffDays(now, new Date(next.event_date));

  if (diff === 0) {
    showToast(`🔴 HOJE tem evento: "${next.title}"!`, 'error');
  } else if (diff <= 6) {
    showToast(`📅 "${next.title}" em ${diff} dia${diff>1?'s':''}!`, 'info');
  }
}

// Diferença em dias inteiros entre duas datas
function diffDays(from, to) {
  const msDay = 1000 * 60 * 60 * 24;
  return Math.max(0, Math.floor((to - from) / msDay));
}

// ── Modal de evento ────────────────────────────────
function openEventModal(editId) {
  if (!requireAdmin()) return;
  const input = document.getElementById('event-editing-id');
  const titleEl = document.getElementById('modal-event-title');

  // Limpa campos
  document.getElementById('event-title').value       = '';
  document.getElementById('event-datetime').value    = '';
  document.getElementById('event-location').value    = '';
  document.getElementById('event-description').value = '';
  input.value = '';

  if (editId) {
    const ev = events.find(e => e.id === editId);
    if (!ev) return;
    input.value = editId;
    document.getElementById('event-title').value       = ev.title || '';
    // Converte UTC para local para o input datetime-local
    if (ev.event_date) {
      const local = new Date(ev.event_date);
      const offset = local.getTimezoneOffset();
      const adjusted = new Date(local.getTime() - offset * 60000);
      document.getElementById('event-datetime').value = adjusted.toISOString().slice(0,16);
    }
    document.getElementById('event-location').value    = ev.location    || '';
    document.getElementById('event-description').value = ev.description || '';
    titleEl.textContent = '✏️ Editar Evento';
  } else {
    titleEl.textContent = '📅 Novo Evento';
  }

  openModal('modal-event');
}

async function saveEvent() {
  if (!requireAdmin()) return;
  const editId   = document.getElementById('event-editing-id').value;
  const title    = document.getElementById('event-title').value.trim();
  const datetime = document.getElementById('event-datetime').value;
  const location = document.getElementById('event-location').value.trim();
  const desc     = document.getElementById('event-description').value.trim();

  if (!title)    return showToast('Digite o nome do evento!', 'error');
  if (!datetime) return showToast('Informe a data e hora!', 'error');

  const payload = {
    title,
    event_date:  new Date(datetime).toISOString(),
    location:    location || null,
    description: desc     || null,
    created_by:  currentProfile?.id || null   // UUID, não o nome
  };

  if (editId) {
    const { error } = await sb.from('events').update(payload).eq('id', editId);
    if (error) return showToast('Erro: ' + error.message, 'error');
    showToast('Evento atualizado! ✅', 'success');
  } else {
    const { error } = await sb.from('events').insert(payload);
    if (error) return showToast('Erro: ' + error.message, 'error');
    showToast('Evento criado! 📅', 'success');
  }

  closeModal('modal-event');
}

function confirmDeleteEvent(id) {
  if (!requireAdmin()) return;
  const ev = events.find(e => e.id === id);
  if (!ev) return;
  document.getElementById('confirm-title').textContent = 'Excluir Evento';
  document.getElementById('confirm-message').innerHTML =
    `Excluir o evento <strong>${escHtml(ev.title)}</strong>?<br><br>⚠️ Ação não pode ser desfeita.`;
  confirmCallback = async () => {
    const { error } = await sb.from('events').delete().eq('id', id);
    if (error) return showToast('Erro: ' + error.message, 'error');
    showToast('Evento excluído.', 'info');
  };
  openModal('modal-confirm');
}

// ─── SELECTS ─────────────────────────────────────────
function populateSelects(){const teamOpts=teams.length?teams.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join(''):'<option disabled>Nenhuma equipe</option>';const ginOpts=gincanas.map(g=>`<option value="${g.id}">${escHtml(g.name)}</option>`).join('');function rebuild(id,prefix,extra){const sel=document.getElementById(id),cur=sel.value;sel.innerHTML=prefix+extra;if(cur&&sel.querySelector(`option[value="${cur}"]`))sel.value=cur;}rebuild('score-team','<option value="">— selecione a equipe —</option>',teamOpts);rebuild('pun-team','<option value="">— selecione a equipe —</option>',teamOpts);rebuild('score-gin','<option value="">— nenhuma —</option>',ginOpts);}

// ─── TIME HELPERS ────────────────────────────────────
function buildCompletionTime(minId,secId,msId){const min=document.getElementById(minId).value.trim(),sec=document.getElementById(secId).value.trim(),ms=document.getElementById(msId).value.trim();if(!min&&!sec&&!ms)return null;return`${(min||'00').padStart(2,'0')}:${(sec||'00').padStart(2,'0')}:${(ms||'00').padStart(2,'0')}`;}
function applyTimeMask(el,maxVal){el.addEventListener('input',()=>{el.value=el.value.replace(/\D/g,'').slice(0,2);if(maxVal&&Number(el.value)>maxVal)el.value=String(maxVal).padStart(2,'0');});}

// ─── MODAL HELPERS ───────────────────────────────────
function openModal(id){document.getElementById(id).classList.remove('hidden');}
function closeModal(id){document.getElementById(id).classList.add('hidden');}

// ─── SHOW DIAGNOSTIC ─────────────────────────────────
function showDiagnostic(title,msg){const app=document.getElementById('app');app.classList.remove('hidden');const icon=title.split(' ')[0];const rest=title.replace(/^\S+\s/,'');app.innerHTML=`<div style="min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:1.5rem"><div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1.75rem;max-width:480px;width:100%;text-align:center"><div style="font-size:2.5rem;margin-bottom:.75rem">${icon}</div><div style="font-family:'Bebas Neue',sans-serif;font-size:1.4rem;color:var(--gold);letter-spacing:.06em;margin-bottom:1rem">${rest}</div><p style="color:var(--muted);font-size:.88rem;line-height:1.7;text-align:left">${msg}</p><button onclick="location.reload()" style="margin-top:1.25rem;background:linear-gradient(135deg,var(--gold),var(--gold2));color:var(--bg);border:none;border-radius:var(--radius-sm);padding:.8rem 2rem;font-family:'Nunito',sans-serif;font-weight:900;font-size:.95rem;cursor:pointer;width:100%">🔄 Tentar Novamente</button></div></div>`;}

// ─── TOAST ───────────────────────────────────────────
let toastTimer=null;
function showToast(msg,type=''){const t=document.getElementById('toast');if(!t)return;t.textContent=msg;t.className=`toast ${type}`;t.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add('hidden'),3200);}

// ─── EVENTS ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  document.getElementById('gin-date-input').value = today();

  // Máscaras de tempo
  ['score-time-min','score-time-sec','score-time-ms','edit-time-min','edit-time-sec','edit-time-ms'].forEach((id,i) => {
    const maxVals = [99,59,99,99,59,99];
    applyTimeMask(document.getElementById(id), maxVals[i]);
  });

  // ── Auth tabs ──
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      const panel = tab.dataset.auth;
      document.getElementById('auth-panel-login').classList.toggle('hidden', panel!=='login');
      document.getElementById('auth-panel-register').classList.toggle('hidden', panel!=='register');
      clearAuthErrors();
    });
  });

  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('login-password').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
  document.getElementById('btn-register').addEventListener('click', doRegister);
  document.getElementById('btn-guest').addEventListener('click', doGuestAccess);
  document.getElementById('btn-pending-guest').addEventListener('click', doGuestAccess);
  document.getElementById('btn-pending-logout').addEventListener('click', doLogout);
  document.getElementById('btn-logout').addEventListener('click', doLogout);

  // ── App tabs ──
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s=>s.classList.add('hidden'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      document.getElementById('tab-'+name).classList.remove('hidden');
      toggleFilterBarVisibility(name);
      if(name==='charts')   renderCharts();
      if(name==='report')   renderReport();
      if(name==='calendar') { renderCalendar(); calendarAlert(); }
    });
  });

  // ── Filtro global ──
  document.querySelectorAll('.gf-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.gf-mode-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      filterState.mode = btn.dataset.mode;
      document.querySelectorAll('.gf-panel').forEach(p=>p.classList.add('hidden'));
      document.getElementById('gf-panel-'+filterState.mode).classList.remove('hidden');
      renderAll();
    });
  });
  document.querySelectorAll('.gf-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.gf-chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active');
      filterState.period = chip.dataset.period;
      renderAll();
    });
  });
  document.getElementById('gf-gin-select').addEventListener('change', e => { filterState.ginId=e.target.value; renderAll(); });
  document.getElementById('gf-custom-apply').addEventListener('click', () => {
    filterState.customFrom = document.getElementById('gf-date-from').value;
    filterState.customTo   = document.getElementById('gf-date-to').value;
    if(!filterState.customFrom||!filterState.customTo) return showToast('Defina as duas datas!','error');
    if(filterState.customFrom>filterState.customTo) return showToast('Data inicial deve ser anterior!','error');
    renderAll();
  });

  // ── Modais score / punição ──
  const openScoreModal = () => {
    document.getElementById('score-pts').value='';
    document.getElementById('score-desc').value='';
    document.getElementById('score-date').value=today();
    document.getElementById('score-team').value='';
    document.getElementById('score-gin').value='';
    document.querySelectorAll('#modal-score .qpt').forEach(b=>b.classList.remove('selected'));
    document.getElementById('score-time-min').value='';
    document.getElementById('score-time-sec').value='';
    document.getElementById('score-time-ms').value='';
    openModal('modal-score');
  };
  document.getElementById('btn-header-score').addEventListener('click', openScoreModal);
  document.getElementById('fab-score').addEventListener('click', openScoreModal);

  const openPunModal = () => {
    document.getElementById('pun-pts').value='';
    document.getElementById('pun-desc').value='';
    document.getElementById('pun-date').value=today();
    document.getElementById('pun-team').value='';
    document.querySelectorAll('#modal-punishment .qpt').forEach(b=>b.classList.remove('selected'));
    openModal('modal-punishment');
  };
  document.getElementById('btn-header-pun').addEventListener('click', openPunModal);
  document.getElementById('fab-punishment').addEventListener('click', openPunModal);

  // ── Fechar modais ──
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.close;
      closeModal(id);
      if(id==='modal-score'){
        document.getElementById('score-time-min').value='';
        document.getElementById('score-time-sec').value='';
        document.getElementById('score-time-ms').value='';
      }
    });
  });
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => {
      if(e.target===m){
        closeModal(m.id);
        if(m.id==='modal-score'){
          document.getElementById('score-time-min').value='';
          document.getElementById('score-time-sec').value='';
          document.getElementById('score-time-ms').value='';
        }
      }
    });
  });

  document.getElementById('btn-confirm-ok').addEventListener('click', () => { closeModal('modal-confirm'); if(confirmCallback){confirmCallback();confirmCallback=null;} });

  // ── Quick pts ──
  document.querySelectorAll('#modal-score .qpt').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('#modal-score .qpt').forEach(b=>b.classList.remove('selected'));btn.classList.add('selected');document.getElementById('score-pts').value=btn.dataset.v;}));
  document.querySelectorAll('#modal-punishment .qpt').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('#modal-punishment .qpt').forEach(b=>b.classList.remove('selected'));btn.classList.add('selected');document.getElementById('pun-pts').value=btn.dataset.v;}));

  // ── Salvar pontos ──
  document.getElementById('btn-save-score').addEventListener('click', async()=>{
    const teamId=document.getElementById('score-team').value, ginId=document.getElementById('score-gin').value;
    const pts=Number(document.getElementById('score-pts').value), desc=document.getElementById('score-desc').value.trim(), date=document.getElementById('score-date').value;
    const completionTime=buildCompletionTime('score-time-min','score-time-sec','score-time-ms');
    if(!teamId)return showToast('Selecione uma equipe!','error');
    if(!pts||isNaN(pts)||pts<=0)return showToast('Pontuação inválida!','error');
    if(!date)return showToast('Informe a data!','error');
    await saveEntry({teamId,ginId,points:pts,desc,date,type:'bonus',completionTime});
    closeModal('modal-score');
    showToast(`+${pts} pts para ${teamById(teamId)?.name}!${completionTime?' ⏱ '+completionTime:''} 🎉`,'success');
  });

  // ── Salvar punição ──
  document.getElementById('btn-save-pun').addEventListener('click', async()=>{
    const teamId=document.getElementById('pun-team').value, raw=Number(document.getElementById('pun-pts').value), pts=raw>0?-raw:raw;
    const desc=document.getElementById('pun-desc').value.trim(), date=document.getElementById('pun-date').value;
    if(!teamId)return showToast('Selecione uma equipe!','error');
    if(!pts||isNaN(pts)||pts>=0)return showToast('Penalidade inválida!','error');
    if(!date)return showToast('Informe a data!','error');
    await saveEntry({teamId,points:pts,desc,date,type:'punishment'});
    closeModal('modal-punishment');
    showToast(`⚠️ Punição de ${pts} pts aplicada!`,'error');
  });

  // ── Equipes ──
  document.getElementById('btn-team-save').addEventListener('click', saveTeam);
  document.getElementById('btn-team-cancel').addEventListener('click', cancelEditTeam);
  document.getElementById('team-name-input').addEventListener('keydown', e=>{if(e.key==='Enter')saveTeam();});

  // ── Gincanas ──
  document.getElementById('btn-gin-save').addEventListener('click', saveGincana);
  document.getElementById('btn-gin-cancel').addEventListener('click', cancelEditGin);
  document.getElementById('gin-name-input').addEventListener('keydown', e=>{if(e.key==='Enter')saveGincana();});
  document.querySelectorAll('.scoring-btn').forEach(btn=>{btn.addEventListener('click',()=>{document.querySelectorAll('.scoring-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');document.getElementById('gin-scoring-type').value=btn.dataset.type;});});

  // ── Calculadora ──
  document.getElementById('calc-gin-select').addEventListener('change', e=>onCalcGinChange(e.target.value));
  document.getElementById('btn-calc-simulate').addEventListener('click', simulateCalc);
  document.getElementById('btn-calc-oficializar').addEventListener('click', oficializarCalc);

  // ── Editar lançamento ──
  document.getElementById('btn-save-edit-entry').addEventListener('click', saveEditEntry);

  // ── Relatório ──
  document.getElementById('report-period-select').addEventListener('change', renderReport);
  document.getElementById('btn-export-img').addEventListener('click', exportImage);
  document.getElementById('btn-export-pdf').addEventListener('click', exportPDF);
  document.getElementById('btn-report-custom-apply')?.addEventListener('click', () => {
    const from = document.getElementById('report-date-from').value;
    const to   = document.getElementById('report-date-to').value;
    if (!from || !to) return showToast('Preencha as duas datas!', 'error');
    if (from > to)    return showToast('A data inicial deve ser anterior à final!', 'error');
    renderReport();
  });

  // ── Calendário ──
  document.getElementById('fab-new-event')?.addEventListener('click', () => openEventModal(null));
  document.getElementById('btn-save-event').addEventListener('click', saveEvent);

  // ── History search ──
  document.getElementById('history-search').addEventListener('input', e=>{historyFilter=e.target.value;renderHistory();});

  // ── Username / assinatura ──
  document.getElementById('btn-save-username')?.addEventListener('click', saveUsername);
  document.getElementById('my-username-input')?.addEventListener('keydown', e=>{if(e.key==='Enter')saveUsername();});

  // ── Boot ──
  boot();
});

// ─── SERVICE WORKER ──────────────────────────────────
if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').catch(()=>{});});}
