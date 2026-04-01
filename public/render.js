// ── Session detail: metrics, charts, timeline, prompts, tasks ─────────────
import {
  TAG_COLORS, fmtTokens, fmtDuration, fmtMs,
  fmtToolInput, fmtTimestamp, toolColor, escHtml,
} from './utils.js';

let tokenChart = null;
let activeTab  = 'tools';

// ── Tabs ───────────────────────────────────────────────────────────────────

export function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

export function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c =>
    c.classList.toggle('hidden', c.id !== `tab-${tab}`));
}

// ── Detail header ──────────────────────────────────────────────────────────

export function updateDetailHeader(session) {
  const name = session.cwd.split('/').filter(Boolean).pop() ?? session.cwd;
  const age  = (() => {
    const ms = Date.now() - session.startedAt;
    const m  = Math.floor(ms / 60000);
    const h  = Math.floor(m / 60);
    return h > 0 ? `${h}h ${m % 60}m ago` : m > 0 ? `${m}m ago` : 'just now';
  })();
  document.getElementById('detail-project').textContent = name;
  document.getElementById('detail-meta').textContent =
    `${session.cwd}  •  started ${age}  •  ${session.kind}`;
}

// ── Metrics ────────────────────────────────────────────────────────────────

export function updateMetrics(stats) {
  if (!stats) return;
  const t = stats.totalTokens;
  document.getElementById('m-input').textContent    = fmtTokens(t.inputTokens);
  document.getElementById('m-output').textContent   = fmtTokens(t.outputTokens);
  document.getElementById('m-cache-r').textContent  = fmtTokens(t.cacheReadInputTokens);
  document.getElementById('m-cache-w').textContent  = fmtTokens(t.cacheCreationInputTokens);
  document.getElementById('m-tools').textContent    = stats.toolCallCount;
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
  if (tokenChart) { tokenChart.data = data; tokenChart.update('none'); return; }
  tokenChart = new Chart(ctx, {
    type: 'doughnut', data,
    options: {
      responsive: true, maintainAspectRatio: true, cutout: '60%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmtTokens(c.parsed)}` } },
      },
    },
  });
}

// ── Tool bars ──────────────────────────────────────────────────────────────

function updateToolBars(stats) {
  const container = document.getElementById('tool-bars');
  const entries   = Object.entries(stats.toolFrequency).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!entries.length) {
    container.innerHTML = '<span class="dim" style="font-size:0.75rem">No tool calls yet</span>';
    return;
  }
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

// ── Tool timeline ──────────────────────────────────────────────────────────

export function resetTimeline() {
  document.getElementById('timeline').innerHTML = '';
  document.getElementById('timeline-count').textContent = '0';
}

export function appendTurnsToTimeline(turns) {
  const timeline = document.getElementById('timeline');
  const counter  = document.getElementById('timeline-count');
  let count = parseInt(counter.textContent, 10) || 0;
  for (const turn of turns) {
    for (const tc of turn.toolCalls ?? []) {
      timeline.appendChild(buildToolRow(tc, turn.isSidechain));
      count++;
    }
  }
  counter.textContent = count;
  timeline.scrollTop = timeline.scrollHeight;
}

function buildToolRow(tc, isSidechain) {
  const row    = document.createElement('div');
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

// ── Prompts panel ──────────────────────────────────────────────────────────

export function renderPrompts(sessionId, history) {
  const list    = document.getElementById('prompts-list');
  const counter = document.getElementById('prompts-count');
  const entries = (history ?? []).filter(e => e.sessionId === sessionId);

  counter.textContent = entries.length;
  if (!entries.length) {
    list.innerHTML = '<div class="panel-empty">No prompts recorded for this session</div>';
    return;
  }

  list.innerHTML = entries.map(e => {
    const isCmd  = e.display.startsWith('/') || e.display.startsWith('!');
    const cls    = isCmd ? 'prompt-cmd' : 'prompt-text';
    const time   = fmtTimestamp(e.timestamp);
    return `
      <div class="prompt-row">
        <span class="prompt-time">${time}</span>
        <span class="prompt-body ${cls}">${escHtml(e.display)}</span>
      </div>
    `;
  }).join('');
}

// ── Tasks panel ────────────────────────────────────────────────────────────

export function renderTasks(sessionId, todos) {
  const list    = document.getElementById('tasks-list');
  const counter = document.getElementById('tasks-count');
  const items   = (todos ?? {})[sessionId] ?? [];

  counter.textContent = items.length;
  if (!items.length) {
    list.innerHTML = '<div class="panel-empty">No tasks for this session</div>';
    return;
  }

  const STATUS_ICON = { completed: '✓', in_progress: '⟳', pending: '○' };
  const STATUS_CLS  = { completed: 'task-done', in_progress: 'task-active', pending: 'task-pending' };

  list.innerHTML = items.map(item => {
    const icon = STATUS_ICON[item.status] ?? '○';
    const cls  = STATUS_CLS[item.status]  ?? 'task-pending';
    return `
      <div class="task-row ${cls}">
        <span class="task-icon">${icon}</span>
        <span class="task-content">${escHtml(item.content)}</span>
      </div>
    `;
  }).join('');
}
