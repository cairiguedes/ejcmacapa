/* ═══════════════════════════════════════════════════
   EJC GINCANA — app.js  (Supabase edition)
   Vanilla JS SPA + Supabase Realtime
═══════════════════════════════════════════════════ */

// ─── CONFIGURE SEU SUPABASE AQUI ────────────────────
const SUPABASE_URL  = 'https://ghcishjqgycpflwgaxwv.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdoY2lzaGpxZ3ljcGZsd2dheHd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTQwNzYsImV4cCI6MjA5MzIzMDA3Nn0.YHx6ZLj3yQm1Hul_bzbMXVJjnB1ebZ4Z3YRrlg5vyOE';
// ────────────────────────────────────────────────────

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── STATE ──────────────────────────────────────────
let teams    = [];   // [ { id, name, color, created_at } ]
let entries  = [];   // [ { id, team_id, gin_id, points, date, desc, type, created_at } ]
let gincanas = [];   // [ { id, name, date, max_pts, obs, created_at } ]

let barChart = null, lineChart = null;
let currentChartPeriod = 'week';
let currentPeriod      = 'day';
let historyFilter      = '';

// Edit state
let editingTeamId  = null;
let editingGinId   = null;

// Confirm callback
let confirmCallback = null;

// ─── BOOT ───────────────────────────────────────────
async function boot() {
  // Detectar credenciais nao configuradas
  if (SUPABASE_URL.includes('SEU_PROJECT') || SUPABASE_KEY.includes('SUA_ANON')) {
    hideSplash();
    showDiagnostic(
      '⚙️ Configure o Supabase',
      'Abra o arquivo <strong>app.js</strong> e substitua <code>SUPABASE_URL</code> e <code>SUPABASE_KEY</code> pelas credenciais do seu projeto em <strong>supabase.com → Settings → API</strong>.'
    );
    return;
  }

  const results = await Promise.all([loadTeams(), loadEntries(), loadGincanas()]);
  const firstError = results.find(r => r && r.error);
  if (firstError) {
    hideSplash();
    const msg = firstError.error.message || JSON.stringify(firstError.error);
    showDiagnostic(
      '❌ Erro de conexão',
      'Não foi possível carregar dados do Supabase.<br><br>' +
      '<strong>Erro:</strong> <code>' + msg + '</code><br><br>' +
      'Causas comuns: tabelas não criadas, RLS bloqueando, URL ou chave erradas.'
    );
    return;
  }

  renderAll();
  subscribeRealtime();
  hideSplash();
}

function showDiagnostic(title, msg) {
  const app = document.getElementById('app');
  app.classList.remove('hidden');
  const icon = title.split(' ')[0];
  const rest = title.replace(/^\S+\s/, '');
  app.innerHTML = `
    <div style="min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:1.5rem">
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);
                  padding:1.75rem;max-width:480px;width:100%;text-align:center">
        <div style="font-size:2.5rem;margin-bottom:.75rem">${icon}</div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:1.4rem;color:var(--gold);
                    letter-spacing:.06em;margin-bottom:1rem">${rest}</div>
        <p style="color:var(--muted);font-size:.88rem;line-height:1.7;text-align:left">${msg}</p>
        <div style="margin-top:1.25rem;background:var(--card2);border:1px solid var(--border);
                    border-radius:var(--radius-sm);padding:1rem;text-align:left">
          <div style="font-size:.72rem;font-weight:900;color:var(--accent2);text-transform:uppercase;
                      letter-spacing:.06em;margin-bottom:.5rem">Checklist</div>
          <div style="font-size:.82rem;color:var(--text);line-height:1.9">
            ✅ Projeto criado no supabase.com<br>
            ✅ Tabelas criadas (SQL do SUPABASE_SETUP.md)<br>
            ✅ Realtime ativo nas 3 tabelas<br>
            ✅ RLS policies configuradas<br>
            ✅ URL e anon key colados no app.js
          </div>
        </div>
        <button onclick="location.reload()"
          style="margin-top:1.25rem;background:linear-gradient(135deg,var(--gold),var(--gold2));
                 color:var(--bg);border:none;border-radius:var(--radius-sm);padding:.8rem 2rem;
                 font-family:'Nunito',sans-serif;font-weight:900;font-size:.95rem;cursor:pointer;width:100%">
          Tentar Novamente
        </button>
      </div>
    </div>`;
}

function hideSplash() {
  setTimeout(() => {
    const splash = document.getElementById('splash');
    splash.classList.add('fade-out');
    setTimeout(() => {
      splash.classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
    }, 650);
  }, 1200);
}

// ─── SUPABASE LOAD ──────────────────────────────────
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

// ─── SUPABASE REALTIME ──────────────────────────────
function subscribeRealtime() {
  sb.channel('ejc-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, async () => {
      await loadTeams(); renderAll();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, async () => {
      await loadEntries(); renderAll();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'gincanas' }, async () => {
      await loadGincanas(); renderAll();
    })
    .subscribe();
}

// ─── DATE UTILS ─────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);

function getWeekRange() {
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { start: mon.toISOString().slice(0,10), end: sun.toISOString().slice(0,10) };
}
function getMonthRange() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  return {
    start: `${y}-${String(m+1).padStart(2,'0')}-01`,
    end:   `${y}-${String(m+1).padStart(2,'0')}-${new Date(y,m+1,0).getDate()}`
  };
}
function getYearRange() {
  const y = new Date().getFullYear();
  return { start:`${y}-01-01`, end:`${y}-12-31` };
}
function filterEntries(start, end) {
  return entries.filter(e => e.data_entry >= start && e.data_entry <= end);
}
function weekLabel() {
  const { start, end } = getWeekRange();
  const fmt = s => { const [,m,d] = s.split('-'); return `${d}/${m}`; };
  return `${fmt(start)} – ${fmt(end)}`;
}
function fmtDate(iso) {
  if (!iso) return '';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function escHtml(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── AGGREGATION ────────────────────────────────────
function teamById(id) { return teams.find(t => t.id === id); }
function ginById(id)  { return gincanas.find(g => g.id === id); }

function calcRanking(entryList) {
  const totals = {};
  teams.forEach(t => { totals[t.id] = 0; });
  entryList.forEach(e => {
    if (e.team_id in totals) totals[e.team_id] += Number(e.points);
  });
  return teams
    .map(t => ({ id: t.id, name: t.name, color: t.color, pts: totals[t.id] || 0 }))
    .sort((a, b) => b.pts - a.pts);
}

// ─── MASTER RENDER ──────────────────────────────────
function renderAll() {
  renderHome();
  renderRanking();
  renderHistory();
  renderEquipesTab();
  renderGincanasTab();
  populateSelects();
  if (!document.getElementById('tab-charts').classList.contains('hidden')) {
    renderCharts();
  }
}

// ── HOME ────────────────────────────────────────────
function renderHome() {
  document.getElementById('week-label').textContent = weekLabel();
  const { start, end } = getWeekRange();
  renderTop3(calcRanking(filterEntries(start, end)));

  const todayEntries = entries
    .filter(e => e.data_entry === today())
    .sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

  const list = document.getElementById('today-list');
  if (!todayEntries.length) {
    list.innerHTML = `<div class="empty-state">
      <span class="empty-icon">🎯</span>
      Nenhuma pontuação hoje ainda.<br>Bora começar a gincana!
    </div>`;
    return;
  }
  list.innerHTML = todayEntries.map(e => {
    const neg  = e.points < 0;
    const team = teamById(e.team_id);
    const gin  = e.gin_id ? ginById(e.gin_id) : null;
    return `<div class="score-item ${neg ? 'punishment' : ''}">
      <div>
        <div class="score-team">${escHtml(team?.name || '?')}
          ${neg ? '<span class="score-badge-pun">PUNIÇÃO</span>' : ''}
        </div>
        ${gin  ? `<div class="score-desc">🎯 ${escHtml(gin.name)}</div>` : ''}
        ${e.descricao ? `<div class="score-desc">${escHtml(e.descricao)}</div>` : ''}
      </div>
      <div class="score-pts ${neg ? 'negative' : ''}">${e.points > 0 ? '+' : ''}${e.points}</div>
    </div>`;
  }).join('');
}

function renderTop3(ranking) {
  const medals = ['🥇','🥈','🥉'];
  const labels = ['1º','2º','3º'];
  const top    = ranking.slice(0, 3);
  const grid   = document.getElementById('top3-cards');

  if (!top.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <span class="empty-icon">👥</span>Cadastre equipes para começar!
    </div>`;
    return;
  }
  grid.innerHTML = top.map((t, i) => `
    <div class="top3-card rank-${i+1}">
      <span class="top3-medal">${medals[i]}</span>
      <div class="top3-name" title="${escHtml(t.name)}">${escHtml(t.name)}</div>
      <div class="top3-pts ${t.pts < 0 ? 'negative' : ''}">${t.pts}</div>
      <span class="top3-badge">${labels[i]}</span>
    </div>`).join('');
}

// ── RANKING ─────────────────────────────────────────
function renderRanking() {
  let range;
  switch (currentPeriod) {
    case 'day':   range = { start: today(), end: today() }; break;
    case 'week':  range = getWeekRange();  break;
    case 'month': range = getMonthRange(); break;
    case 'year':  range = getYearRange();  break;
  }
  const ranking = calcRanking(filterEntries(range.start, range.end));
  const list = document.getElementById('ranking-list');

  if (!ranking.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">🏆</span>Nenhum dado para o período.</div>`;
    return;
  }
  const posClass = i => ['gold','silver','bronze'][i] || 'normal';
  list.innerHTML = ranking.map((t, i) => `
    <div class="rank-item ${i < 3 ? 'rank-'+(i+1) : ''}">
      <span class="rank-pos ${posClass(i)}">${i+1}</span>
      <span class="rank-dot" style="background:${t.color}"></span>
      <span class="rank-name">${escHtml(t.name)}</span>
      <div>
        <div class="rank-pts ${t.pts < 0 ? 'negative' : ''}">${t.pts}</div>
        <div class="rank-sub">pts</div>
      </div>
    </div>`).join('');
}

// ── CHARTS ──────────────────────────────────────────
function renderCharts() {
  const range    = currentChartPeriod === 'week' ? getWeekRange() : getMonthRange();
  const filtered = filterEntries(range.start, range.end);
  const ranking  = calcRanking(filtered);

  // Horizontal bar
  const barCtx = document.getElementById('chart-bar').getContext('2d');
  if (barChart) barChart.destroy();
  barChart = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: ranking.map(t => t.name),
      datasets: [{
        data: ranking.map(t => t.pts),
        backgroundColor: ranking.map(t => t.color + 'bb'),
        borderColor: ranking.map(t => t.color),
        borderWidth: 2, borderRadius: 8
      }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend:{display:false}, tooltip:{callbacks:{label:c=>` ${c.raw} pts`}} },
      scales: {
        x: { grid:{color:'rgba(255,255,255,.05)'}, ticks:{color:'#a78bb5',font:{family:'Nunito'}} },
        y: { grid:{display:false}, ticks:{color:'#f0e6ff',font:{family:'Nunito',weight:'700'},maxRotation:0} }
      }
    }
  });

  // Line chart — cumulative evolution
  const days = getDaysInRange(range.start, range.end);
  const datasets = teams.map(team => {
    const color = team.color || '#888';
    return {
      label: team.name,
      data: days.map(d =>
        filtered.filter(e => e.team_id === team.id && e.data_entry <= d)
                .reduce((s,e) => s + Number(e.points), 0)
      ),
      borderColor: color,
      backgroundColor: color + '22',
      tension: .4, fill: true,
      pointRadius: 3, pointBackgroundColor: color
    };
  });

  const lineCtx = document.getElementById('chart-line').getContext('2d');
  if (lineChart) lineChart.destroy();
  lineChart = new Chart(lineCtx, {
    type: 'line',
    data: { labels: days.map(d => d.slice(5).replace('-','/')), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend:{labels:{color:'#a78bb5',font:{family:'Nunito',size:11},boxWidth:12}} },
      scales: {
        x: { grid:{color:'rgba(255,255,255,.05)'}, ticks:{color:'#a78bb5',font:{family:'Nunito',size:11}} },
        y: { grid:{color:'rgba(255,255,255,.05)'}, ticks:{color:'#a78bb5',font:{family:'Nunito'}} }
      }
    }
  });
}

function getDaysInRange(start, end) {
  const days = []; let cur = new Date(start); const last = new Date(end);
  while (cur <= last) { days.push(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate()+1); }
  return days;
}

// ── HISTORY ─────────────────────────────────────────
function renderHistory() {
  const all = entries
    .filter(e => {
      if (!historyFilter) return true;
      return (teamById(e.team_id)?.name || '').toLowerCase().includes(historyFilter.toLowerCase());
    })
    .sort((a,b) => {
      const dc = b.date.localeCompare(a.date);
      return dc !== 0 ? dc : new Date(b.created_at) - new Date(a.created_at);
    });

  const list = document.getElementById('history-list');
  if (!all.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">📋</span>Nenhum lançamento encontrado.</div>`;
    return;
  }
  list.innerHTML = all.map(e => {
    const neg  = e.points < 0;
    const team = teamById(e.team_id);
    const gin  = e.gin_id ? ginById(e.gin_id) : null;
    const [y,m,d] = (e.data_entry || '').split('-');
    return `<div class="history-item ${neg ? 'punishment' : ''}">
      <div class="history-team">${escHtml(team?.name||'?')} ${neg ? '⚠️' : ''}</div>
      <div class="history-pts ${neg ? 'negative' : ''}" style="grid-row:1/4">${e.points > 0 ? '+' : ''}${e.points}</div>
      <div class="history-meta">${d}/${m}/${y} · ${e.tipo === 'punishment' ? 'Punição' : 'Pontuação'}</div>
      ${gin   ? `<div class="history-gin">🎯 ${escHtml(gin.name)}</div>` : ''}
      ${e.descricao ? `<div class="history-desc">${escHtml(e.descricao)}</div>`  : ''}
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════
//   ABA EQUIPES — CRUD completo
// ════════════════════════════════════════════════════
function renderEquipesTab() {
  const list  = document.getElementById('teams-list');
  const count = document.getElementById('teams-count');
  count.textContent = teams.length || '';

  if (!teams.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">👥</span>Nenhuma equipe cadastrada ainda.</div>`;
    return;
  }

  // Total de pontos por equipe (all time)
  const totals = {};
  entries.forEach(e => {
    totals[e.team_id] = (totals[e.team_id]||0) + Number(e.points);
  });

  list.innerHTML = teams.map(t => {
    const pts = totals[t.id] || 0;
    return `<div class="team-entity-item">
      <span class="team-dot" style="background:${t.color}"></span>
      <div class="team-entity-info">
        <div class="team-entity-name">${escHtml(t.name)}</div>
        <div class="team-entity-sub">Saldo acumulado</div>
      </div>
      <div class="team-entity-pts ${pts < 0 ? 'negative' : ''}">${pts >= 0 ? '+' : ''}${pts}</div>
      <div class="entity-actions">
        <button class="btn-edit"   data-edit-team="${t.id}" title="Editar">✏️</button>
        <button class="btn-delete" data-del-team="${t.id}"  title="Excluir">🗑</button>
      </div>
    </div>`;
  }).join('');

  // Bind edit
  list.querySelectorAll('[data-edit-team]').forEach(btn => {
    btn.addEventListener('click', () => startEditTeam(btn.dataset.editTeam));
  });
  // Bind delete
  list.querySelectorAll('[data-del-team]').forEach(btn => {
    btn.addEventListener('click', () => confirmDeleteTeam(btn.dataset.delTeam));
  });
}

function startEditTeam(id) {
  const team = teams.find(t => t.id === id);
  if (!team) return;
  editingTeamId = id;

  document.getElementById('team-name-input').value  = team.name;
  document.getElementById('team-color-input').value = team.color;
  document.getElementById('team-form-title').textContent = '✏️ Editar Equipe';
  document.getElementById('team-form-title').classList.add('editing-mode');
  document.getElementById('team-form-card').classList.add('editing');
  document.getElementById('btn-team-save').textContent = 'Salvar Alterações';
  document.getElementById('btn-team-save').classList.add('blue-mode');
  document.getElementById('btn-team-cancel').style.display = '';

  // Scroll form into view
  document.getElementById('team-form-card').scrollIntoView({ behavior:'smooth', block:'start' });
}

function cancelEditTeam() {
  editingTeamId = null;
  document.getElementById('team-name-input').value  = '';
  document.getElementById('team-color-input').value = '#f59e0b';
  document.getElementById('team-form-title').textContent = '✨ Nova Equipe';
  document.getElementById('team-form-title').classList.remove('editing-mode');
  document.getElementById('team-form-card').classList.remove('editing');
  document.getElementById('btn-team-save').textContent = '+ Adicionar Equipe';
  document.getElementById('btn-team-save').classList.remove('blue-mode');
  document.getElementById('btn-team-cancel').style.display = 'none';
}

async function saveTeam() {
  const name  = document.getElementById('team-name-input').value.trim();
  const color = document.getElementById('team-color-input').value;

  if (!name) return showToast('Digite o nome da equipe!', 'error');

  // Check duplicate (excluding self when editing)
  const dup = teams.find(t =>
    t.name.toLowerCase() === name.toLowerCase() && t.id !== editingTeamId
  );
  if (dup) return showToast('Já existe uma equipe com esse nome!', 'error');

  if (editingTeamId) {
    const { error } = await sb.from('teams')
      .update({ name, color })
      .eq('id', editingTeamId);
    if (error) {
      console.error('Supabase update error:', error);
      return showToast('Erro: ' + (error.message || 'falha ao atualizar'), 'error');
    }
    showToast(`Equipe "${name}" atualizada! ✅`, 'success');
    cancelEditTeam();
  } else {
    const { error } = await sb.from('teams').insert({ name, color });
    if (error) {
      console.error('Supabase insert error:', error);
      return showToast('Erro: ' + (error.message || 'falha ao criar'), 'error');
    }
    showToast(`Equipe "${name}" criada! 🙌`, 'success');
    document.getElementById('team-name-input').value = '';
  }
}

function confirmDeleteTeam(id) {
  const team = teams.find(t => t.id === id);
  if (!team) return;
  const entriesCount = entries.filter(e => e.team_id === id).length;

  document.getElementById('confirm-title').textContent = 'Excluir Equipe';
  document.getElementById('confirm-message').innerHTML =
    `Tem certeza que deseja excluir a equipe <strong>${escHtml(team.name)}</strong>?` +
    (entriesCount > 0
      ? `<br><br>⚠️ Existem <strong>${entriesCount} lançamentos</strong> vinculados a ela. Os lançamentos <strong>não serão apagados</strong>, mas ficarão sem equipe.`
      : '');

  confirmCallback = () => deleteTeam(id);
  openModal('modal-confirm');
}

async function deleteTeam(id) {
  const { error } = await sb.from('teams').delete().eq('id', id);
  if (error) { console.error(error); return showToast('Erro: ' + (error.message || 'falha ao excluir'), 'error'); }
  if (editingTeamId === id) cancelEditTeam();
  showToast('Equipe excluída.', 'info');
}

// ════════════════════════════════════════════════════
//   ABA GINCANAS — CRUD completo
// ════════════════════════════════════════════════════
function renderGincanasTab() {
  const list  = document.getElementById('gincanas-list');
  const count = document.getElementById('gincanas-count');
  count.textContent = gincanas.length || '';

  if (!gincanas.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">🎯</span>Nenhuma gincana cadastrada ainda.</div>`;
    return;
  }

  list.innerHTML = gincanas.map(g => {
    const hasObs = g.obs && g.obs.trim().length > 0;
    return `<div class="gin-entity-item">
      <div class="gin-entity-header">
        <span class="gin-entity-name">🎯 ${escHtml(g.name)}</span>
        <div class="entity-actions">
          <button class="btn-edit"   data-edit-gin="${g.id}" title="Editar">✏️</button>
          <button class="btn-delete" data-del-gin="${g.id}"  title="Excluir">🗑</button>
        </div>
      </div>
      <div class="gin-entity-meta">
        ${g.data_gin ? `<span class="gin-entity-date">📅 ${fmtDate(g.data_gin)}</span>` : ''}
        ${g.max_pts ? `<span class="gin-entity-maxpts">${g.max_pts} pts máx.</span>` : ''}
      </div>
      ${hasObs
        ? `<div class="gin-entity-obs-preview">${escHtml(g.obs)}</div>
           <button class="gin-see-more" data-view-gin="${g.id}">Ver dinâmica completa →</button>`
        : ''}
    </div>`;
  }).join('');

  // Bind edit
  list.querySelectorAll('[data-edit-gin]').forEach(btn => {
    btn.addEventListener('click', () => startEditGin(btn.dataset.editGin));
  });
  // Bind delete
  list.querySelectorAll('[data-del-gin]').forEach(btn => {
    btn.addEventListener('click', () => confirmDeleteGin(btn.dataset.delGin));
  });
  // Bind view obs
  list.querySelectorAll('[data-view-gin]').forEach(btn => {
    btn.addEventListener('click', () => viewGinDetail(btn.dataset.viewGin));
  });
}

function startEditGin(id) {
  const g = gincanas.find(x => x.id === id);
  if (!g) return;
  editingGinId = id;

  document.getElementById('gin-name-input').value   = g.name;
  document.getElementById('gin-date-input').value   = g.data_gin || '';
  document.getElementById('gin-maxpts-input').value = g.max_pts || '';
  document.getElementById('gin-obs-input').value    = g.obs || '';

  document.getElementById('gin-form-title').textContent = '✏️ Editar Gincana';
  document.getElementById('gin-form-title').classList.add('editing-mode');
  document.getElementById('gin-form-card').classList.add('editing');
  document.getElementById('btn-gin-save').textContent = 'Salvar Alterações';
  document.getElementById('btn-gin-save').classList.add('blue-mode');
  document.getElementById('btn-gin-cancel').style.display = '';

  document.getElementById('gin-form-card').scrollIntoView({ behavior:'smooth', block:'start' });
}

function cancelEditGin() {
  editingGinId = null;
  document.getElementById('gin-name-input').value   = '';
  document.getElementById('gin-date-input').value   = today();
  document.getElementById('gin-maxpts-input').value = '';
  document.getElementById('gin-obs-input').value    = '';

  document.getElementById('gin-form-title').textContent = '✨ Nova Gincana';
  document.getElementById('gin-form-title').classList.remove('editing-mode');
  document.getElementById('gin-form-card').classList.remove('editing');
  document.getElementById('btn-gin-save').textContent = '+ Criar Gincana';
  document.getElementById('btn-gin-save').classList.remove('blue-mode');
  document.getElementById('btn-gin-cancel').style.display = 'none';
}

async function saveGincana() {
  const name   = document.getElementById('gin-name-input').value.trim();
  const date   = document.getElementById('gin-date-input').value;
  const maxPts = document.getElementById('gin-maxpts-input').value;
  const obs    = document.getElementById('gin-obs-input').value.trim();

  if (!name) return showToast('Digite o nome da gincana!', 'error');

  const payload = {
    name,
    data_gin: date || null,
    max_pts:  maxPts ? Number(maxPts) : null,
    obs:      obs || null
  };

  if (editingGinId) {
    // UPDATE
    const { error } = await sb.from('gincanas').update(payload).eq('id', editingGinId);
    if (error) { console.error(error); return showToast('Erro: ' + (error.message || 'falha ao atualizar'), 'error'); }
    showToast(`Gincana "${name}" atualizada! ✅`, 'success');
    cancelEditGin();
  } else {
    // INSERT
    const { error } = await sb.from('gincanas').insert(payload);
    if (error) { console.error(error); return showToast('Erro: ' + (error.message || 'falha ao criar'), 'error'); }
    showToast(`Gincana "${name}" criada! 🎯`, 'success');
    document.getElementById('gin-name-input').value   = '';
    document.getElementById('gin-maxpts-input').value = '';
    document.getElementById('gin-obs-input').value    = '';
  }
}

function confirmDeleteGin(id) {
  const g = gincanas.find(x => x.id === id);
  if (!g) return;
  const linked = entries.filter(e => e.gin_id === id).length;

  document.getElementById('confirm-title').textContent = 'Excluir Gincana';
  document.getElementById('confirm-message').innerHTML =
    `Tem certeza que deseja excluir a gincana <strong>${escHtml(g.name)}</strong>?` +
    (linked > 0
      ? `<br><br>⚠️ Ela está vinculada a <strong>${linked} lançamentos</strong>. Os lançamentos <strong>não serão apagados</strong>.`
      : '');

  confirmCallback = () => deleteGincana(id);
  openModal('modal-confirm');
}

async function deleteGincana(id) {
  const { error } = await sb.from('gincanas').delete().eq('id', id);
  if (error) { console.error(error); return showToast('Erro: ' + (error.message || 'falha ao excluir'), 'error'); }
  if (editingGinId === id) cancelEditGin();
  showToast('Gincana excluída.', 'info');
}

function viewGinDetail(id) {
  const g = gincanas.find(x => x.id === id);
  if (!g) return;
  document.getElementById('gin-detail-title').textContent = `🎯 ${g.name}`;
  document.getElementById('gin-detail-body').innerHTML = `
    <div class="gin-detail-meta">
      ${g.data_gin ? `<span class="gin-detail-chip">📅 ${fmtDate(g.data_gin)}</span>` : ''}
      ${g.max_pts ? `<span class="gin-detail-chip">🏅 ${g.max_pts} pts máx.</span>` : ''}
    </div>
    ${g.obs
      ? `<div class="gin-detail-obs-label">📝 Dinâmica / Observações</div>
         <div class="gin-detail-obs">${escHtml(g.obs)}</div>`
      : `<div style="color:var(--muted);font-size:.88rem">Sem observações registradas.</div>`}
  `;
  openModal('modal-gin-detail');
}

// ─── SELECTS ────────────────────────────────────────
function populateSelects() {
  const teamOpts = teams.length
    ? teams.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('')
    : '<option value="" disabled>Nenhuma equipe cadastrada</option>';

  const ginOpts = gincanas
    .map(g => `<option value="${g.id}">${escHtml(g.name)}</option>`)
    .join('');

  function rebuild(id, prefix, extra) {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = prefix + extra;
    if (cur && sel.querySelector(`option[value="${cur}"]`)) sel.value = cur;
  }

  rebuild('score-team', '<option value="">— selecione a equipe —</option>', teamOpts);
  rebuild('pun-team',   '<option value="">— selecione a equipe —</option>', teamOpts);
  rebuild('score-gin',  '<option value="">— nenhuma —</option>',            ginOpts);
}

// ─── SUPABASE ENTRIES ───────────────────────────────
async function saveEntry({ teamId, ginId, points, desc, date, type }) {
  const payload = {
    team_id:    teamId,
    gin_id:     ginId || null,
    points:     Number(points),
    descricao:  desc || '',
    data_entry: date,
    tipo:       type
  };
  const { error } = await sb.from('entries').insert(payload);
  if (error) { console.error(error); showToast('Erro: ' + (error.message || 'falha ao salvar'), 'error'); }
}

// ─── MODAL HELPERS ──────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// ─── EVENTS ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Set default dates
  document.getElementById('gin-date-input').value = today();

  // ── Main Tabs ──
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.remove('hidden');
      if (tab.dataset.tab === 'charts') renderCharts();
    });
  });

  // ── Ranking filters ──
  document.querySelectorAll('.filter-btn[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn[data-period]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      renderRanking();
    });
  });

  // ── Chart filters ──
  document.querySelectorAll('.filter-btn[data-chart-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn[data-chart-period]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentChartPeriod = btn.dataset.chartPeriod;
      renderCharts();
    });
  });

  // ── Open Score modal ──
  const openScoreModal = () => {
    document.getElementById('score-pts').value  = '';
    document.getElementById('score-desc').value = '';
    document.getElementById('score-date').value = today();
    document.getElementById('score-team').value = '';
    document.getElementById('score-gin').value  = '';
    document.querySelectorAll('#modal-score .qpt').forEach(b => b.classList.remove('selected'));
    openModal('modal-score');
  };
  document.getElementById('btn-header-score').addEventListener('click', openScoreModal);
  document.getElementById('fab-score').addEventListener('click', openScoreModal);

  // ── Open Punishment modal ──
  const openPunModal = () => {
    document.getElementById('pun-pts').value  = '';
    document.getElementById('pun-desc').value = '';
    document.getElementById('pun-date').value = today();
    document.getElementById('pun-team').value = '';
    document.querySelectorAll('#modal-punishment .qpt').forEach(b => b.classList.remove('selected'));
    openModal('modal-punishment');
  };
  document.getElementById('btn-header-pun').addEventListener('click', openPunModal);
  document.getElementById('fab-punishment').addEventListener('click', openPunModal);

  // ── Close modals ──
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
  });

  // ── Confirm modal OK ──
  document.getElementById('btn-confirm-ok').addEventListener('click', () => {
    closeModal('modal-confirm');
    if (confirmCallback) { confirmCallback(); confirmCallback = null; }
  });

  // ── Quick pts — Score ──
  document.querySelectorAll('#modal-score .qpt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#modal-score .qpt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('score-pts').value = btn.dataset.v;
    });
  });

  // ── Quick pts — Punishment ──
  document.querySelectorAll('#modal-punishment .qpt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#modal-punishment .qpt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('pun-pts').value = btn.dataset.v;
    });
  });

  // ── Save Score ──
  document.getElementById('btn-save-score').addEventListener('click', async () => {
    const teamId = document.getElementById('score-team').value;
    const ginId  = document.getElementById('score-gin').value;
    const pts    = Number(document.getElementById('score-pts').value);
    const desc   = document.getElementById('score-desc').value.trim();
    const date   = document.getElementById('score-date').value;

    if (!teamId) return showToast('Selecione uma equipe!', 'error');
    if (!pts || isNaN(pts) || pts <= 0) return showToast('Informe uma pontuação válida!', 'error');
    if (!date) return showToast('Informe a data!', 'error');

    await saveEntry({ teamId, ginId, points: pts, desc, date, type: 'bonus' });
    closeModal('modal-score');
    showToast(`+${pts} pts para ${teamById(teamId)?.name}! 🎉`, 'success');
  });

  // ── Save Punishment ──
  document.getElementById('btn-save-pun').addEventListener('click', async () => {
    const teamId = document.getElementById('pun-team').value;
    const raw    = Number(document.getElementById('pun-pts').value);
    const pts    = raw > 0 ? -raw : raw;
    const desc   = document.getElementById('pun-desc').value.trim();
    const date   = document.getElementById('pun-date').value;

    if (!teamId) return showToast('Selecione uma equipe!', 'error');
    if (!pts || isNaN(pts) || pts >= 0) return showToast('Informe uma penalidade válida!', 'error');
    if (!date) return showToast('Informe a data!', 'error');

    await saveEntry({ teamId, points: pts, desc, date, type: 'punishment' });
    closeModal('modal-punishment');
    showToast(`⚠️ Punição de ${pts} pts aplicada!`, 'error');
  });

  // ── Equipes: save / cancel ──
  document.getElementById('btn-team-save').addEventListener('click', saveTeam);
  document.getElementById('btn-team-cancel').addEventListener('click', cancelEditTeam);
  document.getElementById('team-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveTeam();
  });

  // ── Gincanas: save / cancel ──
  document.getElementById('btn-gin-save').addEventListener('click', saveGincana);
  document.getElementById('btn-gin-cancel').addEventListener('click', cancelEditGin);
  document.getElementById('gin-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveGincana();
  });

  // ── History search ──
  document.getElementById('history-search').addEventListener('input', e => {
    historyFilter = e.target.value;
    renderHistory();
  });

  // ── Boot ──
  boot();
});

// ─── TOAST ──────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

// ─── SERVICE WORKER ─────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
