// ── Session detail: metrics, charts, timeline, prompts, tasks ─────────────
import {
  TAG_COLORS, fmtTokens, fmtDuration, fmtMs,
  fmtToolInput, fmtTimestamp, toolColor, escHtml,
} from './utils.js';

let tokenChart  = null;
let activeTab   = 'tools';
let _popupTurns = [];   // current session turns — used by tool popup

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

export function updateDetailHeader(session, isCompleted = false) {
  const name = session.cwd.split('/').filter(Boolean).pop() ?? session.cwd;
  const age  = (() => {
    const ms = Date.now() - session.startedAt;
    const m  = Math.floor(ms / 60000);
    const h  = Math.floor(m / 60);
    return h > 0 ? `${h}h ${m % 60}m ago` : m > 0 ? `${m}m ago` : 'just now';
  })();
  document.getElementById('detail-project').textContent = name;
  document.getElementById('detail-meta').textContent =
    `${session.cwd}  •  started ${age}  •  ${session.entrypoint ?? 'cli'} / ${isCompleted ? 'ended' : session.kind}`;
}

// ── Metrics ────────────────────────────────────────────────────────────────

export function updateMetrics(stats, turns = []) {
  if (!stats) {
    // Clear all fields so a previous session's values don't bleed through
    ['m-input','m-output','m-cache-r','m-cache-w'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
    document.getElementById('m-tools').textContent    = '—';
    document.getElementById('m-duration').textContent = '—';
    document.getElementById('detail-cost').textContent = '—';
    const toolsSub = document.getElementById('m-tools-sub');
    if (toolsSub) { toolsSub.textContent = 'total'; toolsSub.className = 'metric-sub'; }
    updateModelBreakdown(null);
    updateToolBars(null, []);
    return;
  }
  // Token data is unavailable for historical sessions loaded from metadata
  if (stats.hasTokenData === false) {
    ['m-input','m-output','m-cache-r','m-cache-w'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
    document.getElementById('detail-cost').textContent = '—';
    if (tokenChart) { tokenChart.destroy(); tokenChart = null; }
  } else {
    const t = stats.totalTokens;
    document.getElementById('m-input').textContent   = fmtTokens(t.inputTokens);
    document.getElementById('m-output').textContent  = fmtTokens(t.outputTokens);
    document.getElementById('m-cache-r').textContent = fmtTokens(t.cacheReadInputTokens);
    document.getElementById('m-cache-w').textContent = fmtTokens(t.cacheCreationInputTokens);
    document.getElementById('detail-cost').textContent = `$${stats.estimatedCostUSD.toFixed(4)}`;
    updateTokenChart(stats);
  }
  document.getElementById('m-tools').textContent    = stats.toolCallCount;
  document.getElementById('m-duration').textContent = fmtDuration(stats.durationMs);
  const toolsSub = document.getElementById('m-tools-sub');
  if (toolsSub) {
    toolsSub.textContent = stats.toolErrorCount > 0 ? `${stats.toolErrorCount} errors` : 'total';
    toolsSub.className   = stats.toolErrorCount > 0 ? 'metric-sub err' : 'metric-sub';
  }
  updateModelBreakdown(stats);
  updateToolBars(stats, turns);
}

// ── Per-model cost breakdown in tooltip ────────────────────────────────────

const MODEL_PRICING = {
  opus:    { input: 15,  output: 75  },
  sonnet:  { input: 3,   output: 15  },
  haiku:   { input: 0.8, output: 4   },
};

function getModelPricing(modelName) {
  const lower = modelName.toLowerCase();
  if (lower.includes('opus'))   return MODEL_PRICING.opus;
  if (lower.includes('haiku'))  return MODEL_PRICING.haiku;
  return MODEL_PRICING.sonnet; // default to sonnet
}

function fmtTokShort(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function updateModelBreakdown(stats) {
  const el = document.getElementById('ct-model-breakdown');
  if (!el) return;
  if (!stats || stats.hasTokenData === false || !stats.models || !Object.keys(stats.models).length) {
    el.innerHTML = '';
    return;
  }
  const rows = Object.entries(stats.models).map(([model, usage]) => {
    const pricing = getModelPricing(model);
    const inp  = usage.inputTokens  ?? 0;
    const out  = usage.outputTokens ?? 0;
    const cost = (inp * pricing.input + out * pricing.output) / 1_000_000;
    const shortName = model.split('-').slice(0, 2).join('-');
    return `<div class="ct-model-row">
      <span class="ct-model-name">${escHtml(shortName)}</span>
      <span class="ct-model-cost">$${cost.toFixed(4)}</span>
      <span style="font-size:0.65rem;color:var(--dim)">${fmtTokShort(inp)}in / ${fmtTokShort(out)}out</span>
    </div>`;
  }).join('');
  el.innerHTML = rows + '<hr class="ct-divider">';
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
      responsive: true, maintainAspectRatio: false, cutout: '60%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmtTokens(c.parsed)}` } },
      },
    },
  });
}

// ── Tool bars ──────────────────────────────────────────────────────────────

function updateToolBars(stats, turns) {
  _popupTurns = turns ?? [];
  const container = document.getElementById('tool-bars');
  const entries   = Object.entries(stats.toolFrequency).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!entries.length) {
    container.innerHTML = '<span class="dim" style="font-size:0.75rem">No tool calls yet</span>';
    return;
  }
  const max = entries[0]?.[1] ?? 1;
  container.innerHTML = entries.map(([name, count]) => `
    <div class="tool-bar-row" data-tool="${escHtml(name)}">
      <span class="tool-bar-name">${name}</span>
      <div class="tool-bar-bg">
        <div class="tool-bar-fill" style="width:${(count/max*100).toFixed(1)}%;background:${toolColor(name)}"></div>
      </div>
      <span class="tool-bar-val">${count}</span>
    </div>
  `).join('');
  container.querySelectorAll('.tool-bar-row').forEach(row => {
    row.addEventListener('click', () => showToolPopup(row.dataset.tool));
  });
}

// ── Tool popup ─────────────────────────────────────────────────────────────

function fmtInputDetails(name, input) {
  const pairs = [];
  const add = (k, v, max = 0) => {
    if (v == null || v === '') return;
    let s = typeof v === 'string' ? v : JSON.stringify(v);
    if (max && s.length > max) s = s.slice(0, max) + '…';
    pairs.push([k, s]);
  };
  switch (name) {
    case 'Read':
      add('file', input.file_path);
      if (input.offset != null) add('offset', String(input.offset));
      if (input.limit  != null) add('limit',  String(input.limit));
      break;
    case 'Write':
      add('file', input.file_path);
      if (input.content != null) add('size', String(input.content).length + ' chars');
      break;
    case 'Edit':
      add('file', input.file_path);
      add('old', String(input.old_string ?? ''), 100);
      add('new', String(input.new_string ?? ''), 100);
      break;
    case 'Bash':
      add('cmd',  String(input.command ?? ''), 220);
      if (input.description) add('desc', String(input.description), 100);
      break;
    case 'Grep':
      add('pattern', String(input.pattern ?? ''));
      if (input.path)        add('path',  String(input.path));
      if (input.glob)        add('glob',  String(input.glob));
      if (input.output_mode) add('mode',  String(input.output_mode));
      if (input['-i'])       add('flags', 'case-insensitive');
      break;
    case 'Glob':
      add('pattern', String(input.pattern ?? ''));
      if (input.path) add('path', String(input.path));
      break;
    case 'Agent':
      if (input.subagent_type) add('type',   String(input.subagent_type));
      if (input.description)   add('desc',   String(input.description),  100);
      if (input.prompt)        add('prompt', String(input.prompt),        220);
      break;
    case 'WebFetch':
      add('url', String(input.url ?? ''));
      break;
    case 'WebSearch':
      add('query', String(input.query ?? ''));
      break;
    default:
      for (const [k, v] of Object.entries(input ?? {})) add(k, v, 120);
  }
  return pairs;
}

function renderCallHtml(tc) {
  const time  = tc.timestamp
    ? new Date(tc.timestamp).toLocaleTimeString('en', { hour12: false })
    : '—';
  const dur   = tc.durationMs != null ? fmtMs(tc.durationMs) : '';
  const isErr = tc.result?.isError;
  const pairs = fmtInputDetails(tc.name, tc.input ?? {});
  const result = tc.result?.content ? String(tc.result.content) : '';
  return `
    <div class="popup-call">
      <div class="popup-call-header">
        <span class="popup-call-time">${time}</span>
        ${dur ? `<span class="popup-call-dur">${dur}</span>` : ''}
        <span class="${isErr ? 'popup-call-err' : 'popup-call-ok'}">${isErr ? '✗ error' : '✓'}</span>
      </div>
      ${pairs.map(([k, v]) => `
        <div class="popup-kv">
          <span class="popup-k">${escHtml(k)}</span>
          <span class="popup-v">${escHtml(v)}</span>
        </div>`).join('')}
      ${result ? `<div class="popup-result${isErr ? ' err' : ''}">${escHtml(result)}</div>` : ''}
    </div>
  `;
}

function openPopup(toolName, calls) {
  const overlay = document.getElementById('tool-popup-overlay');
  const popup   = document.getElementById('tool-popup');
  const tagCls  = `tool-tag tag-${toolName} tag-${toolName in TAG_COLORS ? toolName : 'default'}`;
  popup.innerHTML = `
    <div class="popup-header">
      <span class="${tagCls}">${escHtml(toolName)}</span>
      <span class="popup-count">${calls.length} call${calls.length !== 1 ? 's' : ''}</span>
      <button class="popup-close" id="popup-close-btn">✕</button>
    </div>
    <div class="popup-list">
      ${calls.length === 0
        ? '<div style="padding:1rem;font-size:0.75rem;color:var(--dim)">No call detail available</div>'
        : calls.map(renderCallHtml).join('')}
    </div>
  `;
  overlay.classList.remove('hidden');
  document.getElementById('popup-close-btn').addEventListener('click', closeToolPopup);
}

function showToolPopup(toolName) {
  const calls = _popupTurns.flatMap(t => (t.toolCalls ?? []).filter(tc => tc.name === toolName));
  openPopup(toolName, calls);
}

function showSingleCallPopup(tc) {
  openPopup(tc.name, [tc]);
}

function closeToolPopup() {
  document.getElementById('tool-popup-overlay').classList.add('hidden');
}

export function initToolPopup() {
  const overlay = document.getElementById('tool-popup-overlay');
  overlay.addEventListener('click', e => { if (e.target === overlay) closeToolPopup(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeToolPopup(); });
}

// ── Files popup ────────────────────────────────────────────────────────────

export async function openFilesPopup(cwd) {
  const overlay  = document.getElementById('files-popup-overlay');
  const listEl   = document.getElementById('files-list');
  const contentEl = document.getElementById('files-content');

  listEl.innerHTML   = '<div class="files-empty">Loading…</div>';
  contentEl.textContent = '';
  overlay.classList.remove('hidden');

  let files;
  try {
    const res = await fetch(`/api/v1/session-files?cwd=${encodeURIComponent(cwd)}`);
    files = await res.json();
  } catch {
    listEl.innerHTML = '<div class="files-empty">Failed to load files</div>';
    return;
  }

  function selectFile(file, activeEl) {
    listEl.querySelectorAll('.ffile-item').forEach(el => el.classList.remove('active'));
    if (activeEl) activeEl.classList.add('active');
    contentEl.textContent = file.content ?? '(file not found)';
  }

  listEl.innerHTML = files.map(f => `
    <div class="ffile-item${f.content === null ? ' missing' : ''}">
      <span class="ffile-dot ${f.content !== null ? 'present' : 'absent'}"></span>
      <span class="ffile-info">
        <span class="ffile-label">${escHtml(f.label)}</span>
        <span class="ffile-path">${escHtml(f.path)}</span>
      </span>
    </div>
  `).join('');

  listEl.querySelectorAll('.ffile-item:not(.missing)').forEach((el) => {
    const idx  = [...listEl.querySelectorAll('.ffile-item')].indexOf(el);
    const file = files[idx];
    el.addEventListener('click', () => selectFile(file, el));
  });

  const firstEl   = listEl.querySelector('.ffile-item:not(.missing)');
  const firstFile = files.find(f => f.content !== null);
  if (firstFile && firstEl) selectFile(firstFile, firstEl);
  else contentEl.textContent = '(no config files found for this session)';
}

export function initFilesPopup() {
  const overlay = document.getElementById('files-popup-overlay');
  overlay.addEventListener('click', e => { if (e.target === overlay) closeFilesPopup(); });
  document.getElementById('files-popup-close').addEventListener('click', closeFilesPopup);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFilesPopup(); });
}

function closeFilesPopup() {
  document.getElementById('files-popup-overlay').classList.add('hidden');
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
  row.style.cursor = 'pointer';
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
  row.addEventListener('click', () => showSingleCallPopup(tc));
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
