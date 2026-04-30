// ─── CONFIGURAÇÃO SUPABASE ──────────────────────────────────────────
const SUPABASE_URL = 'https://SUA_URL.supabase.co';
const SUPABASE_KEY = 'SUA_ANON_KEY';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── ESTADO GLOBAL DO APP ───────────────────────────────────────────
let teams = [];
let scores = [];
let chartBar = null;
let chartLine = null;

// ─── INICIALIZAÇÃO ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // Esconder Splash após 2 segundos
    setTimeout(() => {
        document.getElementById('splash').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
    }, 2000);

    initTabs();
    initModals();
    await loadData();
    renderAll();
});

// ─── CARREGAMENTO DE DADOS ──────────────────────────────────────────
async function loadData() {
    // Busca equipes
    let { data: teamsData } = await _supabase.from('equipes').select('*');
    teams = teamsData || [];

    // Busca lançamentos
    let { data: scoresData } = await _supabase.from('lancamentos').select('*, equipes(nome, cor)');
    scores = scoresData || [];
    
    renderAll();
}

// ─── FUNÇÕES DE RENDERIZAÇÃO ────────────────────────────────────────
function renderAll() {
    renderTeamSelects();
    renderTop3();
    renderTodayList();
    renderRanking('day');
    renderHistory();
    updateCharts();
}

function renderTeamSelects() {
    const selects = [document.getElementById('score-team'), document.getElementById('pun-team')];
    const options = teams.map(t => `<option value="${t.id}">${t.nome}</option>`).join('');
    selects.forEach(s => s.innerHTML = options);
}

function renderTop3() {
   document.getElementById('btn-filter-custom').addEventListener('click', () => {
    const start = document.getElementById('rank-start').value;
    const end = document.getElementById('rank-end').value;

    if (!start || !end) {
        alert("Por favor, selecione as duas datas!");
        return;
    }

    // Chama a função de renderizar o ranking passando o período personalizado
    renderRanking('custom', { start, end });
});

// ─── LÓGICA DE CÁLCULO (PONTOS - PUNIÇÕES) ──────────────────────────
function calculateRanking(period = 'year') {
    const now = new Date();
    let filtered = scores;

    if (period === 'day') {
        filtered = scores.filter(s => s.data === now.toISOString().split('T')[0]);
    } else if (period === 'month') {
        filtered = scores.filter(s => s.data.startsWith(now.toISOString().substring(0, 7)));
    }

    const ranking = teams.map(team => {
        const teamScores = filtered.filter(s => s.equipe_id === team.id);
        const total = teamScores.reduce((acc, curr) => acc + curr.pontos, 0);
        return { ...team, total };
    });

    return ranking.sort((a, b) => b.total - a.total);
}

// ─── SALVAR DADOS NO SUPABASE ───────────────────────────────────────
async function saveScore(type) {
    const isPunishment = type === 'punishment';
    const teamId = document.getElementById(isPunishment ? 'pun-team' : 'score-team').value;
    const pts = parseInt(document.getElementById(isPunishment ? 'pun-pts' : 'score-pts').value);
    const desc = document.getElementById(isPunishment ? 'pun-desc' : 'score-desc').value;
    const date = document.getElementById(isPunishment ? 'pun-date' : 'score-date').value || new Date().toISOString().split('T')[0];

    if (!teamId || !pts) return showToast("Preencha os campos obrigatórios!", "error");

    const { error } = await _supabase.from('lancamentos').insert([{
        equipe_id: teamId,
        pontos: isPunishment ? (pts > 0 ? pts * -1 : pts) : pts,
        descricao: desc,
        data: date
    }]);

    if (!error) {
        showToast(isPunishment ? "Punição aplicada!" : "Pontos computados!");
        closeAllModals();
        await loadData();
    }
}

async function addTeam() {
    const name = document.getElementById('team-name-input').value;
    const color = document.getElementById('team-color-input').value;

    if (!name) return;

    const { error } = await _supabase.from('equipes').insert([{ nome: name, cor: color }]);
    if (!error) {
        document.getElementById('team-name-input').value = '';
        showToast("Equipe cadastrada!");
        await loadData();
    }
}

// ─── UTILITÁRIOS DE INTERFACE ────────────────────────────────────────
function showToast(msg, type = "success") {
    const toast = document.getElementById('toast');
    toast.innerText = msg;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

// Configurações de cliques e abas (simplificado para o exemplo)
function initTabs() {
    document.querySelectorAll('.tab').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.tab, .tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            
            btn.classList.add('active');
            const target = document.getElementById('tab-' + btn.dataset.tab);
            target.classList.remove('hidden');
            target.classList.add('active');
        };
    });
}

// Bind dos botões de salvar
document.getElementById('btn-save-score').onclick = () => saveScore('bonus');
document.getElementById('btn-save-pun').onclick = () => saveScore('punishment');
document.getElementById('btn-add-team-confirm').onclick = addTeam;

// Funções de Modal (Abre/Fecha)
function initModals() {
    document.getElementById('btn-add-score').onclick = () => document.getElementById('modal-score').classList.remove('hidden');
    document.getElementById('fab-score').onclick = () => document.getElementById('modal-score').classList.remove('hidden');
    document.getElementById('btn-add-team').onclick = () => document.getElementById('modal-teams').classList.remove('hidden');
    document.getElementById('fab-punishment').onclick = () => document.getElementById('modal-punishment').classList.remove('hidden');
    
    document.querySelectorAll('.close-btn, .btn-cancel').forEach(b => {
        b.onclick = () => closeAllModals();
    });
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}