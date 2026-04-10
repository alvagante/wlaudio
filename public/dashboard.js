// ── Dashboard — High Contrast v2 ──────────────────────────────────────────

// ── Focus Mode ────────────────────────────────────────────────────────────

function initFocusMode() {
  const btn    = document.getElementById('focus-btn');
  const layout = document.querySelector('.app-layout');
  if (!btn || !layout) return;

  btn.addEventListener('click', () => {
    const isOn = layout.classList.toggle('focus-on');
    btn.textContent = isOn ? 'ON' : 'OFF';
    btn.setAttribute('aria-pressed', String(isOn));
  });
}

// ── Hero stats ────────────────────────────────────────────────────────────

function renderHeroStats() {
  // Find the most active session (most tokens)
  let best = null, bestSt = null, bestTokens = -1;
  for (const [id, session] of state.sessions) {
    const st  = state.stats.get(id);
    const tok = st ? (st.totalTokens?.inputTokens ?? 0) + (st.totalTokens?.outputTokens ?? 0) : 0;
    if (tok > bestTokens) { bestTokens = tok; best = session; bestSt = st; }
  }

  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? '—'; };

  if (best && bestSt) {
    setText('db-hs-tokens',   fmtTokens(bestTokens));
    setText('db-hs-tools',    fmtNum(bestSt.toolCallCount));
    setText('db-hs-duration', fmtDuration(bestSt.durationMs));
    setText('db-hs-project',  projectName(best.cwd));
  } else {
    ['db-hs-tokens', 'db-hs-tools', 'db-hs-duration', 'db-hs-project'].forEach(id => setText(id, '—'));
  }

  // Live badge count
  const countEl = document.getElementById('db-live-count');
  if (countEl) countEl.textContent = state.sessions.size > 0 ? String(state.sessions.size) : '';
}

// ── Dashboard ─────────────────────────────────────────────────────────────

// ── State ─────────────────────────────────────────────────────────────────
const state = {
  sessions:    new Map(),   // sessionId → ActiveSession (active)
  stats:       new Map(),   // sessionId → SessionStats
  turns:       new Map(),   // sessionId → Turn[]
  globalStats: null,
  projects:    [],
  configs:     null,
};

// ── Helpers ───────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString();
}

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(ts) {
  const diff = Date.now() - (typeof ts === 'string' ? new Date(ts).getTime() : ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' }); }
  catch { return iso; }
}

function fmtDuration(ms) {
  if (!ms) return '—';
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

function projectName(cwd) {
  return (cwd ?? '').split('/').filter(Boolean).pop() ?? cwd ?? '—';
}

function truncate(str, max) {
  if (!str || str.length <= max) return str ?? '';
  return str.slice(0, max) + '…';
}

// ── WebSocket ─────────────────────────────────────────────────────────────

function connect() {
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${wsProtocol}//${location.host}/ws`);
  ws.onopen    = () => setConn(true);
  ws.onclose   = () => { setConn(false); setTimeout(connect, 3000); };
  ws.onerror   = () => ws.close();
  ws.onmessage = (e) => {
    try { dispatch(JSON.parse(e.data)); } catch { /* ignore */ }
  };
}

function setConn(up) {
  document.getElementById('conn-dot').className     = `dot ${up ? 'connected' : 'disconnected'}`;
  document.getElementById('conn-label').textContent = up ? 'LIVE' : 'RECONNECTING';
}

function dispatch({ type, data }) {
  switch (type) {
    case 'initial_state':
      state.sessions.clear(); state.stats.clear(); state.turns.clear();
      for (const s of data.activeSessions)                      state.sessions.set(s.sessionId, s);
      for (const [id, st] of Object.entries(data.sessionStats)) state.stats.set(id, st);
      if (data.turns) {
        for (const [id, ts] of Object.entries(data.turns)) state.turns.set(id, ts);
      }
      state.globalStats = data.globalStats;
      renderLive();
      renderStats();
      renderActivityChart();
      break;
    case 'session_added':
      state.sessions.set(data.session.sessionId, data.session);
      state.stats.set(data.session.sessionId, data.stats);
      renderLive();
      renderStats();
      break;
    case 'session_removed':
      state.sessions.delete(data);
      state.turns.delete(data);
      renderLive();
      break;
    case 'turns_updated':
      state.stats.set(data.sessionId, data.stats);
      if (data.newTurns?.length) {
        const existing = state.turns.get(data.sessionId) ?? [];
        state.turns.set(data.sessionId, [...existing, ...data.newTurns]);
      }
      renderLive();
      break;
    case 'stats_updated':
      state.globalStats = data;
      renderStats();
      renderActivityChart();
      break;
  }
}

// ── Live sessions ─────────────────────────────────────────────────────────

const TOOL_ICON = {
  Bash:       '▶',
  Edit:       '✎',
  Write:      '✎',
  Read:       '◎',
  Glob:       '⊕',
  Grep:       '⊕',
  WebSearch:  '⊞',
  WebFetch:   '⊞',
  Agent:      '◈',
  TodoWrite:  '☑',
};

function toolIcon(name) {
  return TOOL_ICON[name] ?? '◆';
}

function latestActivities(turns, limit = 4) {
  if (!turns?.length) return [];
  const activities = [];
  for (let i = turns.length - 1; i >= 0 && activities.length < limit; i--) {
    const t = turns[i];
    if (t.type !== 'assistant') continue;
    for (const tc of (t.toolCalls ?? [])) {
      if (activities.length >= limit) break;
      activities.push({ name: tc.name, ts: tc.timestamp, isError: tc.result?.isError ?? false });
    }
  }
  return activities;
}

function renderSessionPanel(id, session, st, turns) {
  const tok  = st ? fmtTokens((st.totalTokens?.inputTokens ?? 0) + (st.totalTokens?.outputTokens ?? 0)) : '—';
  const dur  = st ? fmtDuration(st.durationMs) : '—';
  const tools = st ? fmtNum(st.toolCallCount) : '—';
  const name  = projectName(session.cwd);
  const acts  = latestActivities(turns);

  const actHtml = acts.length
    ? acts.map(a => `
        <div class="db-sp-act${a.isError ? ' db-sp-act--err' : ''}">
          <span class="db-sp-act-icon">${toolIcon(a.name)}</span>
          <span class="db-sp-act-name">${escHtml(a.name)}</span>
        </div>`).join('')
    : `<div class="db-sp-act db-sp-act--dim">waiting…</div>`;

  return `
    <a class="db-session-panel" href="/sessions.html?session=${encodeURIComponent(id)}">
      <div class="db-sp-header">
        <span class="db-sp-pulse"></span>
        <span class="db-sp-name">${escHtml(name)}</span>
        <span class="db-sp-kind">${escHtml(session.kind ?? '')}</span>
      </div>
      <div class="db-sp-stats">
        <div class="db-sp-stat"><span class="db-sp-val">${tok}</span><span class="db-sp-lbl">tok</span></div>
        <div class="db-sp-stat"><span class="db-sp-val">${tools}</span><span class="db-sp-lbl">tools</span></div>
        <div class="db-sp-stat"><span class="db-sp-val">${dur}</span><span class="db-sp-lbl">active</span></div>
      </div>
      <div class="db-sp-acts">${actHtml}</div>
    </a>`;
}

function renderLive() {
  const container = document.getElementById('db-live-container');

  renderHeroStats();

  if (state.sessions.size === 0) {
    container.innerHTML = `
      <div class="db-no-sessions">
        <span class="db-no-sessions-icon">⬡</span>
        <span>No active sessions — start Claude Code to see live data</span>
      </div>`;
    return;
  }

  let html = '';
  for (const [id, session] of state.sessions) {
    html += renderSessionPanel(id, session, state.stats.get(id), state.turns.get(id));
  }
  container.innerHTML = html;
}

// ── Summary stats ─────────────────────────────────────────────────────────

function renderStats() {
  const gs = state.globalStats;

  setText('db-total-sessions', fmtNum(gs?.totalSessions));
  setText('db-total-messages', fmtNum(gs?.totalMessages));

  // Aggregate from projects data
  if (state.projects.length) {
    const totalCommits = state.projects.reduce((s, p) => s + (p.totalGitCommits ?? 0), 0);
    const totalAdded   = state.projects.reduce((s, p) => s + (p.totalLinesAdded  ?? 0), 0);
    const topProject   = [...state.projects].sort((a, b) => b.sessionCount - a.sessionCount)[0];

    setText('db-total-commits', fmtNum(totalCommits));
    setText('db-total-lines',   `+${fmtNum(totalAdded)}`);
    setText('db-top-project',   topProject?.projectName ?? '—');
    setText('db-total-projects', fmtNum(state.projects.length));
  }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '—';
}

// ── Activity sparkline ────────────────────────────────────────────────────

let activityChart = null;

function renderActivityChart() {
  const ctx    = document.getElementById('db-activity-chart')?.getContext('2d');
  if (!ctx) return;
  const last14 = (state.globalStats?.dailyActivity ?? []).slice(-14);
  const labels = last14.map(d => d.date?.slice(5) ?? '');
  const msgs   = last14.map(d => d.messageCount ?? 0);

  if (activityChart) {
    activityChart.data.labels = labels;
    activityChart.data.datasets[0].data = msgs;
    activityChart.update('none');
    return;
  }

  activityChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: msgs, backgroundColor: '#00D1FF28', borderColor: '#00D1FF', borderWidth: 1, borderRadius: 3 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#12161F',
        borderColor: '#1e2a3a',
        borderWidth: 1,
        titleColor: '#8899aa',
        bodyColor: '#00D1FF',
        callbacks: {
          title: (items) => last14[items[0].dataIndex]?.date ?? '',
          label: (item)  => ` ${item.parsed.y} messages`,
        },
      }},
      scales: {
        x: { grid: { color: '#1c223320' }, ticks: { color: '#445566', font: { size: 10 } } },
        y: { grid: { color: '#1c223340' }, ticks: { color: '#445566', font: { size: 10 } }, beginAtZero: true },
      },
    },
  });
}

// ── Recent sessions ───────────────────────────────────────────────────────

const OUTCOME_CLASS = {
  achieved: 'green', mostly_achieved: 'yellow',
  partially_achieved: 'orange', not_achieved: 'red',
};

function renderRecentSessions() {
  const container = document.getElementById('db-recent-sessions');

  // Flatten all sessions from all projects, sort by start time, take 8
  const allSessions = state.projects
    .flatMap(p => (p.sessions ?? []).map(s => ({ ...s, projectName: p.projectName })))
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, 8);

  if (!allSessions.length) {
    container.innerHTML = '<div class="db-empty">No session history yet</div>';
    return;
  }

  container.innerHTML = allSessions.map(s => {
    const cls   = OUTCOME_CLASS[s.outcome] ?? 'dim';
    const badge = s.outcome ? `<span class="db-sr-outcome ${cls}">${escHtml(s.outcome.replace(/_/g, ' '))}</span>` : '';
    const label = truncate(s.briefSummary || s.firstPrompt, 60);
    return `
      <a class="db-session-row" href="/sessions.html?session=${encodeURIComponent(s.sessionId)}">
        <span class="db-sr-date">${fmtDate(s.startTime)}</span>
        <span class="db-sr-project">${escHtml(s.projectName)}</span>
        <span class="db-sr-prompt" title="${escHtml(s.briefSummary || s.firstPrompt)}">${escHtml(label)}</span>
        ${badge}
      </a>`;
  }).join('');
}

// ── Top projects ──────────────────────────────────────────────────────────

function renderTopProjects() {
  const container = document.getElementById('db-top-projects');
  const top = [...state.projects]
    .sort((a, b) => new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime())
    .slice(0, 5);

  if (!top.length) {
    container.innerHTML = '<div class="db-empty">No projects yet</div>';
    return;
  }

  container.innerHTML = top.map(p => {
    const topLang = Object.entries(p.languages ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    return `
      <div class="db-project-row">
        <div class="db-pr-name-wrap">
          <div class="db-pr-name">${escHtml(p.projectName)}</div>
          <div class="db-pr-sub">${timeAgo(p.lastActive)}${topLang ? ` · ${escHtml(topLang)}` : ''}</div>
        </div>
        <div class="db-pr-stats">
          <div class="db-pr-stat">
            <span class="db-pr-stat-val">${fmtNum(p.sessionCount)}</span>
            <span class="db-pr-stat-lbl">sessions</span>
          </div>
          <div class="db-pr-stat">
            <span class="db-pr-stat-val">${fmtNum(p.totalGitCommits)}</span>
            <span class="db-pr-stat-lbl">commits</span>
          </div>
          <div class="db-pr-stat">
            <span class="db-pr-stat-val">+${fmtNum(p.totalLinesAdded)}</span>
            <span class="db-pr-stat-lbl">lines</span>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Config health ─────────────────────────────────────────────────────────

function renderConfigHealth() {
  const container = document.getElementById('db-config-health');
  const cfg = state.configs;

  if (!cfg?.global) {
    container.innerHTML = '<div class="db-empty">No config data</div>';
    return;
  }

  const g = cfg.global;
  const hookCount  = Object.values(g.hooks ?? {}).reduce((s, entries) => s + entries.reduce((a, e) => a + (e.hooks?.length ?? 0), 0), 0);
  const mcpCount   = Object.keys(g.mcpServers ?? {}).length;
  const plugCount  = cfg.plugins?.length ?? 0;
  const projCount  = cfg.projects?.length ?? 0;
  const allowCount = g.allow?.length ?? 0;
  const denyCount  = g.deny?.length  ?? 0;

  container.innerHTML = `
    <div class="db-config-grid">
      <div class="db-cfg-tile">
        <div class="db-cfg-tile-val">${hookCount}</div>
        <div class="db-cfg-tile-lbl">Hooks</div>
      </div>
      <div class="db-cfg-tile">
        <div class="db-cfg-tile-val">${mcpCount}</div>
        <div class="db-cfg-tile-lbl">MCP servers</div>
      </div>
      <div class="db-cfg-tile">
        <div class="db-cfg-tile-val">${plugCount}</div>
        <div class="db-cfg-tile-lbl">Plugins</div>
      </div>
    </div>
    <div class="db-cfg-row"><span class="db-cfg-key">Allowed rules</span><span class="db-cfg-val green">${allowCount}</span></div>
    <div class="db-cfg-row"><span class="db-cfg-key">Denied rules</span><span class="db-cfg-val red">${denyCount}</span></div>
    <div class="db-cfg-row"><span class="db-cfg-key">Global CLAUDE.md</span><span class="db-cfg-val ${cfg.globalClaudeMd ? 'green' : 'dim'}">${cfg.globalClaudeMd ? 'present' : 'none'}</span></div>
    <div class="db-cfg-row"><span class="db-cfg-key">Project configs</span><span class="db-cfg-val yellow">${projCount}</span></div>
    ${Object.entries(g.hooks ?? {}).map(([event, entries]) => {
      const n = entries.reduce((a, e) => a + (e.hooks?.length ?? 0), 0);
      return `<div class="db-cfg-row"><span class="db-cfg-key">${escHtml(event)}</span><span class="db-cfg-val">${n} hook${n !== 1 ? 's' : ''}</span></div>`;
    }).join('')}
  `;
}

// ── Boot ──────────────────────────────────────────────────────────────────

async function init() {
  // Fetch projects + configs in parallel
  const [projectsRes, configsRes] = await Promise.all([
    fetch('/api/v1/projects').catch(() => null),
    fetch('/api/v1/configs').catch(() => null),
  ]);

  if (projectsRes?.ok) state.projects = await projectsRes.json();
  if (configsRes?.ok)  state.configs  = await configsRes.json();

  renderStats();
  renderRecentSessions();
  renderTopProjects();
  renderConfigHealth();

  // Focus mode toggle
  initFocusMode();

  // WebSocket for live data
  connect();

  // Refresh session age labels every 30s
  setInterval(renderLive, 30_000);
}

document.addEventListener('DOMContentLoaded', init);
