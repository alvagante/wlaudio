// ── State ──────────────────────────────────────────────────────────────────
const state = {
  sessions: new Map(),      // sessionId → ActiveSession
  stats:    new Map(),      // sessionId → SessionStats
  turns:    new Map(),      // sessionId → Turn[]
  globalStats: null,
  selectedId:  null,
};

let tokenChart    = null;
let sparklineChart = null;

// ── WebSocket ──────────────────────────────────────────────────────────────
function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);

  ws.onopen = () => setConn(true);
  ws.onclose = () => { setConn(false); setTimeout(connect, 3000); };
  ws.onerror = () => ws.close();

  ws.onmessage = (e) => {
    try { dispatch(JSON.parse(e.data)); }
    catch { /* ignore parse errors */ }
  };
}

function setConn(up) {
  document.getElementById('conn-dot').className   = `dot ${up ? 'connected' : 'disconnected'}`;
  document.getElementById('conn-label').textContent = up ? 'LIVE' : 'RECONNECTING';
}

// ── Message dispatcher ─────────────────────────────────────────────────────
function dispatch({ type, data }) {
  switch (type) {
    case 'initial_state':  onInitialState(data);  break;
    case 'session_added':  onSessionAdded(data);  break;
    case 'session_removed':onSessionRemoved(data);break;
    case 'turns_updated':  onTurnsUpdated(data);  break;
    case 'stats_updated':  onStatsUpdated(data);  break;
  }
}

function onInitialState({ activeSessions, sessionStats, turns, globalStats }) {
  state.sessions.clear(); state.stats.clear(); state.turns.clear();

  for (const s of activeSessions)           state.sessions.set(s.sessionId, s);
  for (const [id, st] of Object.entries(sessionStats)) state.stats.set(id, st);
  for (const [id, ts] of Object.entries(turns))        state.turns.set(id, ts);
  state.globalStats = globalStats;

  if (!state.selectedId && state.sessions.size > 0) {
    state.selectedId = [...state.sessions.keys()][0];
  }
  renderAll();
}

function onSessionAdded({ session, stats }) {
  state.sessions.set(session.sessionId, session);
  state.stats.set(session.sessionId, stats);
  state.turns.set(session.sessionId, []);
  if (!state.selectedId) state.selectedId = session.sessionId;
  renderSidebar();
  if (state.selectedId === session.sessionId) renderDetail();
}

function onSessionRemoved(sessionId) {
  state.sessions.delete(sessionId);
  state.stats.delete(sessionId);
  state.turns.delete(sessionId);
  if (state.selectedId === sessionId) {
    state.selectedId = state.sessions.size > 0 ? [...state.sessions.keys()][0] : null;
    renderDetail();
  }
  renderSidebar();
}

function onTurnsUpdated({ sessionId, newTurns, stats }) {
  const existing = state.turns.get(sessionId) ?? [];
  existing.push(...newTurns);
  state.turns.set(sessionId, existing);
  state.stats.set(sessionId, stats);

  renderSidebar();
  if (state.selectedId === sessionId) {
    updateMetrics();
    appendTurnsToTimeline(newTurns);
  }
}

function onStatsUpdated(stats) {
  state.globalStats = stats;
  renderGlobalStats();
}

// ── Full render ────────────────────────────────────────────────────────────
function renderAll() {
  renderSidebar();
  renderDetail();
  renderGlobalStats();
}

// ── Sidebar ────────────────────────────────────────────────────────────────
function renderSidebar() {
  const list  = document.getElementById('session-list');
  const count = document.getElementById('session-count');
  count.textContent = state.sessions.size;

  list.innerHTML = '';
  for (const [id, session] of state.sessions) {
    const stats = state.stats.get(id);
    const li    = document.createElement('li');
    li.className = `session-item${id === state.selectedId ? ' active' : ''}`;
    li.dataset.id = id;

    const models = stats ? Object.keys(stats.models) : [];
    const tok    = stats ? fmtTokens(totalTokenCount(stats.totalTokens)) : '—';
    const cost   = stats ? `$${stats.estimatedCostUSD.toFixed(4)}` : '—';

    li.innerHTML = `
      <div class="si-header">
        <span class="si-dot"></span>
        <span class="si-name">${projectName(session.cwd)}</span>
        <span class="si-age">${timeAgo(session.startedAt)}</span>
      </div>
      <div class="si-tokens">${tok} tok &nbsp;<span class="si-cost">${cost}</span></div>
      <div class="si-models">${models.map(m => `<span class="model-badge">${shortModel(m)}</span>`).join('')}</div>
    `;
    li.addEventListener('click', () => selectSession(id));
    list.appendChild(li);
  }
}

function selectSession(id) {
  state.selectedId = id;
  renderSidebar();
  renderDetail();
}

// ── Detail view ────────────────────────────────────────────────────────────
function renderDetail() {
  const empty  = document.getElementById('empty-state');
  const detail = document.getElementById('session-detail');

  if (!state.selectedId || !state.sessions.has(state.selectedId)) {
    empty.classList.remove('hidden');
    detail.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  detail.classList.remove('hidden');

  const session = state.sessions.get(state.selectedId);
  const stats   = state.stats.get(state.selectedId);
  const turns   = state.turns.get(state.selectedId) ?? [];

  document.getElementById('detail-project').textContent = projectName(session.cwd);
  document.getElementById('detail-meta').textContent =
    `${session.cwd}  •  started ${timeAgo(session.startedAt)}  •  ${session.kind}`;

  updateMetrics();

  // Full timeline rebuild on session switch
  const timeline = document.getElementById('timeline');
  timeline.innerHTML = '';
  appendTurnsToTimeline(turns);
}

function updateMetrics() {
  const stats = state.stats.get(state.selectedId);
  if (!stats) return;

  const t = stats.totalTokens;
  document.getElementById('m-input').textContent   = fmtTokens(t.inputTokens);
  document.getElementById('m-output').textContent  = fmtTokens(t.outputTokens);
  document.getElementById('m-cache-r').textContent = fmtTokens(t.cacheReadInputTokens);
  document.getElementById('m-cache-w').textContent = fmtTokens(t.cacheCreationInputTokens);
  document.getElementById('m-tools').textContent   = stats.toolCallCount;
  document.getElementById('m-duration').textContent = fmtDuration(stats.durationMs);
  document.getElementById('detail-cost').textContent = `$${stats.estimatedCostUSD.toFixed(4)}`;

  updateTokenChart(stats);
  updateToolBars(stats);
}

// ── Token doughnut ─────────────────────────────────────────────────────────
function updateTokenChart(stats) {
  const t   = stats.totalTokens;
  const ctx = document.getElementById('token-chart').getContext('2d');
  const data = {
    labels:   ['Input', 'Output', 'Cache R', 'Cache W'],
    datasets: [{
      data: [t.inputTokens, t.outputTokens, t.cacheReadInputTokens, t.cacheCreationInputTokens],
      backgroundColor: ['#89b4fa55', '#a6e3a155', '#cba6f755', '#f9e2af55'],
      borderColor:     ['#89b4fa',   '#a6e3a1',   '#cba6f7',   '#f9e2af'],
      borderWidth: 1,
    }],
  };

  if (tokenChart) {
    tokenChart.data = data;
    tokenChart.update('none');
    return;
  }

  tokenChart = new Chart(ctx, {
    type: 'doughnut',
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${fmtTokens(ctx.parsed)}`,
          },
        },
      },
    },
  });
}

// ── Tool frequency bars ────────────────────────────────────────────────────
function updateToolBars(stats) {
  const container = document.getElementById('tool-bars');
  const entries = Object.entries(stats.toolFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  if (entries.length === 0) { container.innerHTML = '<span class="dim" style="font-size:0.75rem">No tool calls yet</span>'; return; }

  const max = entries[0]?.[1] ?? 1;
  container.innerHTML = entries.map(([name, count]) => `
    <div class="tool-bar-row">
      <span class="tool-bar-name">${name}</span>
      <div class="tool-bar-bg">
        <div class="tool-bar-fill" style="width:${(count/max*100).toFixed(1)}%;background:${toolColor(name)}"></div>
      </div>
      <span class="tool-bar-val">${count}</span>
    </div>
  `).join('');
}

// ── Timeline ───────────────────────────────────────────────────────────────
function appendTurnsToTimeline(turns) {
  const timeline = document.getElementById('timeline');
  const counter  = document.getElementById('timeline-count');
  let count = parseInt(counter.textContent, 10) || 0;

  for (const turn of turns) {
    if (!turn.toolCalls?.length) continue;
    for (const tc of turn.toolCalls) {
      const row = buildToolRow(tc, turn.isSidechain);
      timeline.appendChild(row);
      count++;
    }
  }

  counter.textContent = count;
  // Auto-scroll to bottom
  timeline.scrollTop = timeline.scrollHeight;
}

function buildToolRow(tc, isSidechain) {
  const row = document.createElement('div');
  row.className = `turn-row${isSidechain ? ' sidechain' : ''}`;

  const time   = tc.timestamp ? new Date(tc.timestamp).toLocaleTimeString('en', { hour12: false }) : '—';
  const desc   = fmtToolInput(tc.name, tc.input);
  const dur    = tc.durationMs != null ? fmtMs(tc.durationMs) : '';
  const errCls = tc.result?.isError ? ' turn-err' : '';
  const tagCls = `tool-tag tag-${tc.name} tag-${tc.name in TAG_COLORS ? tc.name : 'default'}`;

  row.innerHTML = `
    ${isSidechain ? '<span class="sidechain-marker">└─</span>' : ''}
    <span class="turn-time">${time}</span>
    <span class="${tagCls}">${tc.name}</span>
    <span class="turn-desc${errCls}">${escHtml(desc)}</span>
    <span class="turn-dur">${dur}</span>
  `;
  return row;
}

const TAG_COLORS = { Read:1, Write:1, Edit:1, Bash:1, Grep:1, Glob:1, Agent:1, WebFetch:1, WebSearch:1 };

// ── Global stats ───────────────────────────────────────────────────────────
function renderGlobalStats() {
  const gs = state.globalStats;
  if (!gs) return;

  const today = gs.dailyActivity?.slice(-1)[0] ?? {};
  document.getElementById('gs-sessions').textContent = gs.totalSessions ?? '—';
  document.getElementById('gs-messages').textContent = gs.totalMessages ?? '—';

  let inp = 0, out = 0, cacheR = 0;
  for (const m of Object.values(gs.modelUsage ?? {})) {
    inp    += m.inputTokens ?? 0;
    out    += m.outputTokens ?? 0;
    cacheR += m.cacheReadInputTokens ?? 0;
  }
  document.getElementById('gs-input').textContent   = fmtTokens(inp);
  document.getElementById('gs-output').textContent  = fmtTokens(out);
  document.getElementById('gs-cache').textContent   = fmtTokens(cacheR);

  updateSparkline(gs.dailyActivity ?? []);
}

function updateSparkline(activity) {
  const canvas = document.getElementById('sparkline');
  const ctx    = canvas.getContext('2d');
  const last14 = activity.slice(-14);
  const labels = last14.map(d => d.date?.slice(5) ?? '');
  const msgs   = last14.map(d => d.messageCount ?? 0);

  if (sparklineChart) {
    sparklineChart.data.labels = labels;
    sparklineChart.data.datasets[0].data = msgs;
    sparklineChart.update('none');
    return;
  }
  sparklineChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: msgs,
        backgroundColor: '#89b4fa44',
        borderColor: '#89b4fa',
        borderWidth: 1,
        borderRadius: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false },
      },
    },
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function projectName(cwd) {
  return cwd.split('/').filter(Boolean).pop() ?? cwd;
}

function shortModel(m) {
  if (m.includes('opus'))   return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku'))  return 'haiku';
  return m.split('-').slice(-2).join('-');
}

function totalTokenCount(t) {
  return t.inputTokens + t.outputTokens + t.cacheReadInputTokens + t.cacheCreationInputTokens;
}

function fmtTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtDuration(ms) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0)  return `${h}h ${m % 60}m`;
  if (m > 0)  return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtMs(ms) {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  if (ms >= 1000)  return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function timeAgo(ts) {
  const ms  = Date.now() - ts;
  const s   = Math.floor(ms / 1000);
  const m   = Math.floor(s / 60);
  const h   = Math.floor(m / 60);
  if (h > 0)  return `${h}h`;
  if (m > 0)  return `${m}m`;
  return `${s}s`;
}

function fmtToolInput(name, input) {
  const shortPath = (p) => {
    const parts = p.split('/').filter(Boolean);
    return parts.length > 3 ? '…/' + parts.slice(-2).join('/') : p;
  };
  switch (name) {
    case 'Read':   return input.file_path  ? shortPath(String(input.file_path))  : '';
    case 'Write':  return input.file_path  ? shortPath(String(input.file_path))  : '';
    case 'Edit':   return input.file_path  ? shortPath(String(input.file_path))  : '';
    case 'Bash':   return String(input.command ?? '').slice(0, 72);
    case 'Grep':   return `"${input.pattern ?? ''}" ${input.path ?? ''}`;
    case 'Glob':   return String(input.pattern ?? '');
    case 'Agent':  return String(input.description ?? input.prompt ?? '').slice(0, 60);
    case 'WebFetch': return String(input.url ?? '');
    case 'WebSearch':return String(input.query ?? '');
    default: return JSON.stringify(input).slice(0, 60);
  }
}

function toolColor(name) {
  const map = {
    Read:'#89b4fa', Write:'#a6e3a1', Edit:'#f9e2af', Bash:'#fab387',
    Grep:'#94e2d5', Glob:'#94e2d5', Agent:'#cba6f7', WebFetch:'#f5c2e7', WebSearch:'#f5c2e7',
  };
  return map[name] ?? '#585b70';
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Refresh timers ─────────────────────────────────────────────────────────
// Refresh "X ago" timestamps every 30 seconds
setInterval(() => renderSidebar(), 30_000);

// ── Boot ───────────────────────────────────────────────────────────────────
connect();
