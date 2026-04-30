/* ═══════════════════════════════════════════════════
   EJC GINCANA — app.js
   Vanilla JS SPA + Firebase Realtime Database
═══════════════════════════════════════════════════ */

// ─── STATE ──────────────────────────────────────────
let teams   = {};   // { id: { name, color } }
let entries = {};   // { id: { teamId, points, date, desc, type } }
let barChart = null, lineChart = null;
let currentChartPeriod = 'week';

// ─── FIREBASE BOOTSTRAP ─────────────────────────────
document.addEventListener('firebase-ready', () => {
  const { db, ref, onValue } = window._fb;

  // Listen teams
  onValue(ref(db, 'teams'), snap => {
    teams = snap.val() || {};
    renderAll();
  });

  // Listen entries
  onValue(ref(db, 'entries'), snap => {
    entries = snap.val() || {};
    renderAll();
  });

  // Show app after brief splash
  setTimeout(() => {
    const splash = document.getElementById('splash');
    splash.classList.add('fade-out');
    setTimeout(() => {
      splash.classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
    }, 650);
  }, 1400);
});

// ─── DATE UTILS ─────────────────────────────────────
const today    = () => new Date().toISOString().slice(0, 10);
const todayStr = () => {
  const d = new Date();
  return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}`;
};

function getWeekRange() {
  const now  = new Date();
  const day  = now.getDay(); // 0=Sun
  const mon  = new Date(now); mon.setDate(now.getDate() - ((day + 6) % 7));
  const sun  = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { start: mon.toISOString().slice(0,10), end: sun.toISOString().slice(0,10) };
}

function getMonthRange() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  return {
    start: `${y}-${String(m+1).padStart(2,'0')}-01`,
    end:   `${y}-${String(m+1).padStart(2,'0')}-${new Date(y,m+1,0).getDate()}`
  };
}

function getYearRange() {
  const y = new Date().getFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

function filterEntries(start, end) {
  return Object.values(entries).filter(e => e.date >= start && e.date <= end);
}

// ─── AGGREGATION ────────────────────────────────────
function calcRanking(entryList) {
  const totals = {};
  for (const t in teams) totals[t] = 0;
  entryList.forEach(e => {
    if (e.teamId && totals[e.teamId] !== undefined) {
      totals[e.teamId] = (totals[e.teamId] || 0) + Number(e.points);
    }
  });
  return Object.entries(totals)
    .map(([id, pts]) => ({ id, name: teams[id]?.name || '?', color: teams[id]?.color || '#888', pts }))
    .sort((a, b) => b.pts - a.pts);
}

function weekLabel() {
  const { start, end } = getWeekRange();
  const fmt = s => { const [,m,d] = s.split('-'); return `${d}/${m}`; };
  return `${fmt(start)} – ${fmt(end)}`;
}

// ─── RENDER ALL ─────────────────────────────────────
function renderAll() {
  renderHome();
  renderRanking();
  renderCharts();
  renderHistory();
  populateSelects();
}

// ── HOME ──
function renderHome() {
  document.getElementById('week-label').textContent = weekLabel();

  const { start, end } = getWeekRange();
  const weekEntries = filterEntries(start, end);
  const ranking = calcRanking(weekEntries);
  renderTop3(ranking);

  // Today list
  const todayEntries = Object.values(entries)
    .filter(e => e.date === today())
    .sort((a,b) => new Date(b._ts||0) - new Date(a._ts||0));

  const list = document.getElementById('today-list');
  if (!todayEntries.length) {
    list.innerHTML = `<div class="empty-state">
      <span class="empty-icon">🎯</span>
      Nenhuma pontuação hoje ainda.<br>Bora começar a gincana!
    </div>`;
    return;
  }
  list.innerHTML = todayEntries.map(e => {
    const neg = e.points < 0;
    const teamName = teams[e.teamId]?.name || 'Equipe';
    return `<div class="score-item ${neg ? 'punishment' : ''}">
      <div>
        <div class="score-team">${teamName}
          ${neg ? '<span class="score-badge-pun">PUNIÇÃO</span>' : ''}
        </div>
        ${e.desc ? `<div class="score-desc">${e.desc}</div>` : ''}
      </div>
      <div class="score-pts ${neg ? 'negative' : ''}">${e.points > 0 ? '+' : ''}${e.points}</div>
    </div>`;
  }).join('');
}

function renderTop3(ranking) {
  const medals = ['🥇','🥈','🥉'];
  const labels = ['1º','2º','3º'];
  const top = ranking.slice(0, 3);
  const grid = document.getElementById('top3-cards');

  if (!top.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <span class="empty-icon">👥</span>Cadastre equipes para começar!
    </div>`;
    return;
  }

  grid.innerHTML = top.map((t, i) => `
    <div class="top3-card rank-${i+1}">
      <span class="top3-medal">${medals[i] || labels[i]}</span>
      <div class="top3-name" title="${t.name}">${t.name}</div>
      <div class="top3-pts ${t.pts < 0 ? 'negative' : ''}">${t.pts}</div>
      <span class="top3-badge">${labels[i]}</span>
    </div>
  `).join('');
}

// ── RANKING ──
let currentPeriod = 'day';

// Adicione essa variável no topo do arquivo junto com as outras
let customRange = null; 

function renderRanking() {
  let range;
  
  if (currentPeriod === 'custom' && customRange) {
    range = customRange;
  } else {
    switch (currentPeriod) {
      case 'day':   range = { start: today(), end: today() }; break;
      case 'week':  range = getWeekRange(); break;
      case 'month': range = getMonthRange(); break;
      case 'year':  range = getYearRange(); break;
    }
  }

  const ranking = calcRanking(filterEntries(range.start, range.end));
  const list = document.getElementById('ranking-list');

  if (!ranking.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">🏆</span>Nenhum dado para o período.</div>`;
    return;
  }

  const posClass = i => i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : 'normal';

  list.innerHTML = ranking.map((t, i) => `
    <div class="rank-item ${i < 3 ? 'rank-'+(i+1) : ''}">
      <span class="rank-pos ${posClass(i)}">${i+1}</span>
      <span class="rank-dot" style="background:${t.color}"></span>
      <span class="rank-name">${t.name}</span>
      <div>
        <div class="rank-pts ${t.pts < 0 ? 'negative' : ''}">${t.pts}</div>
        <div class="rank-change">pts</div>
      </div>
    </div>
  `).join('');
} // <--- ESTA CHAVE ESTAVA FALTANDO!

// ── CHARTS ──
function renderCharts() {
  let range;
  if (currentChartPeriod === 'week') range = getWeekRange();
  else range = getMonthRange();

  const filtered = filterEntries(range.start, range.end);
  const ranking  = calcRanking(filtered);

  const labels  = ranking.map(t => t.name);
  const data    = ranking.map(t => t.pts);
  const colors  = ranking.map(t => t.color);

  const defaults = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: {
      label: ctx => ` ${ctx.raw} pts`
    }}},
    scales: {
      x: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#a78bb5', font: { family: 'Nunito' } } },
      y: { grid: { display: false }, ticks: { color: '#f0e6ff', font: { family: 'Nunito', weight: '700' }, maxRotation: 0 } }
    }
  };

  // Bar chart
  const barCtx = document.getElementById('chart-bar').getContext('2d');
  if (barChart) barChart.destroy();
  barChart = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.map(c => c + 'bb'),
        borderColor: colors,
        borderWidth: 2,
        borderRadius: 8,
      }]
    },
    options: { ...defaults }
  });

  // Line chart — evolução por dia no período
  const days = getDaysInRange(range.start, range.end);
  const teamColors = Object.fromEntries(Object.entries(teams).map(([id,t])=>[id,t.color]));
  const datasets = Object.keys(teams).map(tid => {
    const cumData = days.map(d => {
      const dayEntries = filtered.filter(e => e.teamId === tid && e.date <= d);
      return dayEntries.reduce((s, e) => s + Number(e.points), 0);
    });
    return {
      label: teams[tid]?.name || tid,
      data: cumData,
      borderColor: teamColors[tid] || '#888',
      backgroundColor: (teamColors[tid] || '#888') + '22',
      tension: .4, fill: true,
      pointRadius: 3, pointBackgroundColor: teamColors[tid] || '#888'
    };
  });

  const lineCtx = document.getElementById('chart-line').getContext('2d');
  if (lineChart) lineChart.destroy();
  lineChart = new Chart(lineCtx, {
    type: 'line',
    data: { labels: days.map(d => d.slice(5).replace('-','/')), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#a78bb5', font: { family: 'Nunito', size: 11 }, boxWidth: 12 } } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#a78bb5', font: { family: 'Nunito', size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#a78bb5', font: { family: 'Nunito' } } }
      }
    }
  });
}

function getDaysInRange(start, end) {
  const days = []; let cur = new Date(start);
  const last = new Date(end);
  while (cur <= last) {
    days.push(cur.toISOString().slice(0,10));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

// ── HISTORY ──
let historyFilter = '';
function renderHistory() {
  const all = Object.entries(entries)
    .map(([id, e]) => ({ ...e, id }))
    .filter(e => {
      if (!historyFilter) return true;
      const name = (teams[e.teamId]?.name || '').toLowerCase();
      return name.includes(historyFilter.toLowerCase());
    })
    .sort((a,b) => {
      const dc = b.date.localeCompare(a.date);
      return dc !== 0 ? dc : (b._ts||0) - (a._ts||0);
    });

  const list = document.getElementById('history-list');
  if (!all.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">📋</span>Nenhum lançamento encontrado.</div>`;
    return;
  }

  list.innerHTML = all.map(e => {
    const neg  = e.points < 0;
    const team = teams[e.teamId]?.name || '?';
    const [y,m,d] = e.date.split('-');
    return `<div class="history-item ${neg ? 'punishment' : ''}">
      <div class="history-team">${team} ${neg ? '⚠️' : ''}</div>
      <div class="history-pts ${neg ? 'negative' : ''}" style="grid-row:1/3">${e.points > 0 ? '+' : ''}${e.points}</div>
      <div class="history-meta">${d}/${m}/${y} · ${e.type === 'punishment' ? 'Punição' : 'Pontuação'}</div>
      ${e.desc ? `<div class="history-desc" style="grid-column:1">${e.desc}</div>` : ''}
    </div>`;
  }).join('');
}

// ─── SELECTS ────────────────────────────────────────
function populateSelects() {
  const opts = Object.entries(teams)
    .map(([id,t]) => `<option value="${id}">${t.name}</option>`)
    .join('');
  document.getElementById('score-team').innerHTML = opts || '<option value="">— sem equipes —</option>';
  document.getElementById('pun-team').innerHTML   = opts || '<option value="">— sem equipes —</option>';
  renderTeamsList();
}

function renderTeamsList() {
  const list = document.getElementById('teams-list');
  list.innerHTML = Object.entries(teams).map(([id,t]) => `
    <div class="team-manage-item">
      <span class="team-dot" style="background:${t.color}"></span>
      <span class="team-manage-name">${t.name}</span>
      <button class="team-delete" data-id="${id}" title="Remover">🗑</button>
    </div>
  `).join('') || '<div class="empty-state" style="padding:1rem">Nenhuma equipe cadastrada.</div>';

  list.querySelectorAll('.team-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteTeam(btn.dataset.id));
  });
}

// ─── FIREBASE ACTIONS ───────────────────────────────
function saveEntry({ teamId, points, desc, date, type }) {
  const { db, ref, push } = window._fb;
  push(ref(db, 'entries'), { teamId, points: Number(points), desc, date, type, _ts: Date.now() });
}

function addTeam(name, color) {
  const { db, ref, push } = window._fb;
  push(ref(db, 'teams'), { name, color });
}

function deleteTeam(id) {
  if (!confirm(`Remover equipe "${teams[id]?.name}"? Os lançamentos não serão apagados.`)) return;
  const { db, ref, remove } = window._fb;
  remove(ref(db, `teams/${id}`));
  showToast('Equipe removida', 'success');
}

// ─── MODAL HELPERS ──────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function setupModal(modalId, inputPtsId, saveId, type) {
  // Preload date
  const dateInput = type === 'punishment'
    ? document.getElementById('pun-date')
    : document.getElementById('score-date');
  if (dateInput) dateInput.value = today();

  // Quick-pt buttons
  document.querySelectorAll(`#modal-${type === 'punishment' ? 'punishment' : 'score'} .qpt`)
    .forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll(`#modal-${type === 'punishment' ? 'punishment' : 'score'} .qpt`)
          .forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById(inputPtsId).value = btn.dataset.v;
      });
    });
}

// ─── EVENTS ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

// Adicione junto com os outros eventos no final do arquivo
document.getElementById('btn-filter-home').addEventListener('click', () => {
  const start = document.getElementById('home-date-start').value;
  const end = document.getElementById('home-date-end').value;

  if (!start || !end) {
    showToast('Selecione o período!', 'error');
    return;
  }

  // Filtra e calcula o ranking para o Top 3
  const filtered = filterEntries(start, end);
  const ranking = calcRanking(filtered);
  renderTop3(ranking);
  
  showToast('Top 3 atualizado!', 'success');
});

  // TABS
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.add('hidden'));
      tab.classList.add('active');
      const target = document.getElementById('tab-' + tab.dataset.tab);
      target.classList.remove('hidden');
      if (tab.dataset.tab === 'charts') renderCharts();
    });
  });

  // RANKING FILTERS
  document.querySelectorAll('.filter-btn[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn[data-period]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      renderRanking();
    });
  });

  // CHART PERIOD FILTERS
  document.querySelectorAll('.filter-btn[data-chart-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn[data-chart-period]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentChartPeriod = btn.dataset.chartPeriod;
      renderCharts();
    });
  });

  // SCORE MODAL OPEN
  const openScore = () => {
    document.getElementById('score-type').value = 'bonus';
    document.getElementById('modal-score-title').textContent = '⚡ Lançar Pontos';
    document.getElementById('score-pts').value = '';
    document.getElementById('score-desc').value = '';
    document.getElementById('score-date').value = today();
    document.querySelectorAll('#modal-score .qpt').forEach(b => b.classList.remove('selected'));
    openModal('modal-score');
    setupModal('modal-score', 'score-pts', 'btn-save-score', 'bonus');
  };
  document.getElementById('btn-add-score').addEventListener('click', openScore);
  document.getElementById('fab-score').addEventListener('click', openScore);

  // PUNISHMENT MODAL OPEN
  const openPunishment = () => {
    document.getElementById('pun-pts').value = '';
    document.getElementById('pun-desc').value = '';
    document.getElementById('pun-date').value = today();
    document.querySelectorAll('#modal-punishment .qpt').forEach(b => b.classList.remove('selected'));
    openModal('modal-punishment');
    setupModal('modal-punishment', 'pun-pts', 'btn-save-pun', 'punishment');
  };
  document.getElementById('fab-punishment').addEventListener('click', openPunishment);

  // TEAMS MODAL
  document.getElementById('btn-add-team').addEventListener('click', () => {
    openModal('modal-teams');
    renderTeamsList();
  });

  // CLOSE BUTTONS
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
  });

  // SAVE SCORE
  document.getElementById('btn-save-score').addEventListener('click', () => {
    const teamId = document.getElementById('score-team').value;
    const pts    = Number(document.getElementById('score-pts').value);
    const desc   = document.getElementById('score-desc').value.trim();
    const date   = document.getElementById('score-date').value;

    if (!teamId) return showToast('Selecione uma equipe!', 'error');
    if (!pts || isNaN(pts)) return showToast('Informe a pontuação!', 'error');
    if (!date) return showToast('Informe a data!', 'error');

    saveEntry({ teamId, points: Math.abs(pts), desc, date, type: 'bonus' });
    closeModal('modal-score');
    showToast(`+${Math.abs(pts)} pts para ${teams[teamId]?.name}! 🎉`, 'success');
  });

  // SAVE PUNISHMENT
  document.getElementById('btn-save-pun').addEventListener('click', () => {
    const teamId = document.getElementById('pun-team').value;
    const raw    = Number(document.getElementById('pun-pts').value);
    const pts    = raw > 0 ? -raw : raw; // sempre negativo
    const desc   = document.getElementById('pun-desc').value.trim();
    const date   = document.getElementById('pun-date').value;

    if (!teamId) return showToast('Selecione uma equipe!', 'error');
    if (!pts || isNaN(pts)) return showToast('Informe a penalidade!', 'error');
    if (!date) return showToast('Informe a data!', 'error');

    saveEntry({ teamId, points: pts, desc, date, type: 'punishment' });
    closeModal('modal-punishment');
    showToast(`⚠️ Punição de ${pts} aplicada!`, 'error');
  });

  // ADD TEAM
  document.getElementById('btn-add-team-confirm').addEventListener('click', () => {
    const name  = document.getElementById('team-name-input').value.trim();
    const color = document.getElementById('team-color-input').value;
    if (!name) return showToast('Digite o nome da equipe!', 'error');
    addTeam(name, color);
    document.getElementById('team-name-input').value = '';
    showToast(`Equipe "${name}" criada! 🙌`, 'success');
  });
  document.getElementById('team-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-add-team-confirm').click();
  });

  // HISTORY SEARCH
// Lógica do botão de filtro personalizado
  document.getElementById('btn-filter-custom').addEventListener('click', () => {
    const start = document.getElementById('rank-start').value;
    const end = document.getElementById('rank-end').value;

    if (!start || !end) {
      showToast('Selecione o início e o fim!', 'error');
      return;
    }

    // Define o estado para "custom" e guarda as datas
    currentPeriod = 'custom';
    customRange = { start, end };
    
    // Remove o destaque dos botões fixos
    document.querySelectorAll('.filter-btn[data-period]').forEach(b => b.classList.remove('active'));
    
    renderRanking();
  });
  document.getElementById('history-search').addEventListener('input', e => {
    historyFilter = e.target.value;
    renderHistory();
  });

  // Quick-pts for score modal (re-bind since modal is already in DOM)
  document.querySelectorAll('#modal-score .qpt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#modal-score .qpt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('score-pts').value = btn.dataset.v;
    });
  });
  document.querySelectorAll('#modal-punishment .qpt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#modal-punishment .qpt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('pun-pts').value = btn.dataset.v;
    });
  });

});

// ─── TOAST ──────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}

// ─── SERVICE WORKER ─────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
