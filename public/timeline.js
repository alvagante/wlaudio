// ── Session Timeline page ─────────────────────────────────────────────────
// Loaded as type="module" — can import from utils.js

import { fmtToolInput, toolColor, escHtml, fmtMs, fmtTimestamp, fmtDuration, timeAgo } from './utils.js';

// ── State ─────────────────────────────────────────────────────────────────

let allSessions  = [];  // { sessionId, projectName, projectPath, startTime, firstPrompt, gitCommits }
let allMeta      = {};  // sessionId → SessionMeta
let allTurns     = {};  // sessionId → Turn[]
let allHistory   = [];  // HistoryEntry[]
let selectedId   = null;

const filters = {
  errors:   false,
  userMsgs: true,
  tools:    true,
};

// ── Helpers ───────────────────────────────────────────────────────────────

function projectName(cwd) {
  return (cwd ?? '').split('/').filter(Boolean).pop() ?? cwd ?? '—';
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

function truncate(str, max) {
  if (!str || str.length <= max) return str ?? '';
  return str.slice(0, max) + '…';
}

// ── Session list ──────────────────────────────────────────────────────────

function renderSessionList(query) {
  const ul = document.getElementById('tl-session-list');
  if (!ul) return;

  const q = (query ?? '').toLowerCase();
  const filtered = q
    ? allSessions.filter(s =>
        s.projectName.toLowerCase().includes(q) ||
        (s.firstPrompt ?? '').toLowerCase().includes(q))
    : allSessions;

  if (!filtered.length) {
    ul.innerHTML = '<li style="padding:1rem;font-size:0.7rem;color:var(--dim)">No sessions found</li>';
    return;
  }

  ul.innerHTML = filtered.map(s => `
    <li class="tl-session-item${s.sessionId === selectedId ? ' active' : ''}"
        data-id="${escHtml(s.sessionId)}">
      <div class="tl-si-project">${escHtml(s.projectName)}</div>
      <div class="tl-si-date">${fmtDate(s.startTime)}</div>
      <div class="tl-si-prompt">${escHtml(truncate(s.firstPrompt, 60))}</div>
    </li>
  `).join('');

  ul.querySelectorAll('.tl-session-item').forEach(li => {
    li.addEventListener('click', () => selectSession(li.dataset.id));
  });
}

// ── Select session ────────────────────────────────────────────────────────

async function selectSession(sessionId) {
  selectedId = sessionId;
  renderSessionList(document.getElementById('tl-search')?.value ?? '');

  const label = document.getElementById('tl-label');
  const s = allSessions.find(x => x.sessionId === sessionId);
  if (label && s) label.textContent = `${s.projectName} — ${fmtDate(s.startTime)}`;

  // Fetch turns on demand if not already loaded (historical sessions)
  if (!allTurns[sessionId]) {
    const tl = document.getElementById('tl-timeline');
    if (tl) tl.innerHTML = '<div style="color:var(--dim);font-size:0.75rem;text-align:center;padding:2rem">Loading turns…</div>';
    tl?.classList.remove('hidden');
    document.getElementById('tl-empty')?.classList.add('hidden');

    try {
      const res = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/turns`);
      if (res.ok) {
        const data = await res.json();
        allTurns[sessionId] = data.turns ?? [];
      } else {
        allTurns[sessionId] = [];
      }
    } catch {
      allTurns[sessionId] = [];
    }
  }

  renderTimeline();
}

// ── Timeline rendering ────────────────────────────────────────────────────

function renderTimeline() {
  const tl    = document.getElementById('tl-timeline');
  const empty = document.getElementById('tl-empty');
  if (!tl) return;

  const turns = allTurns[selectedId] ?? [];
  if (!turns.length && !selectedId) {
    tl.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
    return;
  }

  tl.classList.remove('hidden');
  if (empty) empty.classList.add('hidden');

  if (!turns.length) {
    tl.innerHTML = '<div style="color:var(--dim);font-size:0.75rem;text-align:center;padding:2rem">No turn data available for this session</div>';
    return;
  }

  const meta   = allMeta[selectedId];
  const items  = [];

  for (const turn of turns) {
    if (turn.type === 'user' && filters.userMsgs) {
      const promptText = getUserPrompt(turn);
      if (promptText) {
        items.push(`
          <div class="tl-bubble--user">
            <div class="tl-time">${escHtml(fmtTimestamp(turn.timestamp))}</div>
            <div>${escHtml(promptText)}</div>
          </div>
        `);
      }
    }

    if (turn.type === 'assistant' && (turn.toolCalls ?? []).length > 0) {
      for (const tc of turn.toolCalls) {
        if (filters.errors && !(tc.result?.isError)) continue;
        if (!filters.tools) continue;
        items.push(renderToolCard(tc));
      }
    }
  }

  // Git commit marker at end
  if (meta?.gitCommits && meta.gitCommits > 0) {
    items.push(`
      <div class="tl-commit-marker">
        ◈ ${meta.gitCommits} commit${meta.gitCommits !== 1 ? 's' : ''} in this session
      </div>
    `);
  }

  tl.innerHTML = items.join('') || '<div style="color:var(--dim);font-size:0.75rem;text-align:center;padding:2rem">No items match current filters</div>';
}

function getUserPrompt(turn) {
  // Use text stored directly on the turn (from JSONL parser)
  if (turn.text) return turn.text;
  // Fall back to history match by timestamp proximity (legacy/incomplete sessions)
  const turnTime = new Date(turn.timestamp).getTime();
  const closest  = allHistory
    .filter(h => h.sessionId === selectedId && Math.abs(h.timestamp - turnTime) < 10000)
    .sort((a, b) => Math.abs(a.timestamp - turnTime) - Math.abs(b.timestamp - turnTime))[0];
  return closest?.display ?? '';
}

function renderToolCard(tc) {
  const color   = toolColor(tc.name);
  const isError = tc.result?.isError ?? false;
  const desc    = fmtToolInput(tc.name, tc.input ?? {});
  const dur     = tc.durationMs != null ? fmtMs(tc.durationMs) : null;

  return `
    <div class="tl-card--tool${isError ? ' tl-card--error' : ''}">
      <div class="tl-time">${escHtml(fmtTimestamp(tc.timestamp))}</div>
      <div class="tl-tool-name">
        <span class="tl-tool-dot" style="background:${color}"></span>
        ${escHtml(tc.name)}
      </div>
      ${desc ? `<div class="tl-tool-desc">${escHtml(truncate(desc, 120))}</div>` : ''}
      <div class="tl-tool-meta">
        <span class="${isError ? 'tl-err' : 'tl-ok'}">${isError ? '✗ error' : '✓ ok'}</span>
        ${dur ? `<span>${escHtml(dur)}</span>` : ''}
      </div>
    </div>
  `;
}

// ── Filter controls ───────────────────────────────────────────────────────

function initFilters() {
  const errEl  = document.getElementById('tl-filter-errors');
  const userEl = document.getElementById('tl-filter-user');
  const toolEl = document.getElementById('tl-filter-tools');

  if (errEl)  errEl.addEventListener('change',  () => { filters.errors   = errEl.checked;  renderTimeline(); });
  if (userEl) userEl.addEventListener('change', () => { filters.userMsgs = userEl.checked; renderTimeline(); });
  if (toolEl) toolEl.addEventListener('change', () => { filters.tools    = toolEl.checked; renderTimeline(); });
}

// ── Search ────────────────────────────────────────────────────────────────

function initSearch() {
  const input = document.getElementById('tl-search');
  if (!input) return;
  input.addEventListener('input', () => renderSessionList(input.value));
}

// ── Boot ──────────────────────────────────────────────────────────────────

async function init() {
  let data;
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    const loading = document.getElementById('tl-loading');
    if (loading) loading.textContent = `Failed to load: ${err.message}`;
    return;
  }

  const loading = document.getElementById('tl-loading');
  if (loading) loading.classList.add('hidden');

  allHistory = data.history ?? [];
  allMeta    = data.sessionMeta ?? {};
  allTurns   = data.turns ?? {};

  // Build session list from metas (sorted newest first)
  const metaEntries = Object.values(allMeta)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  allSessions = metaEntries.map(m => ({
    sessionId:   m.sessionId,
    projectName: projectName(m.projectPath),
    projectPath: m.projectPath,
    startTime:   m.startTime,
    firstPrompt: m.firstPrompt,
    gitCommits:  m.gitCommits,
  }));

  // Also include active sessions that may not have meta yet
  for (const s of data.activeSessions ?? []) {
    if (!allSessions.find(x => x.sessionId === s.sessionId)) {
      allSessions.unshift({
        sessionId:   s.sessionId,
        projectName: projectName(s.cwd),
        projectPath: s.cwd,
        startTime:   new Date(s.startedAt).toISOString(),
        firstPrompt: '(active session)',
        gitCommits:  0,
      });
    }
  }

  initSearch();
  initFilters();
  renderSessionList();

  // Auto-select from URL param
  const urlId = new URLSearchParams(location.search).get('session');
  if (urlId && allSessions.find(s => s.sessionId === urlId)) {
    selectSession(urlId);
    // Scroll item into view
    setTimeout(() => {
      document.querySelector('.tl-session-item.active')?.scrollIntoView({ block: 'nearest' });
    }, 50);
  } else if (allSessions.length > 0) {
    const empty = document.getElementById('tl-empty');
    if (empty) empty.classList.remove('hidden');
  }
}

document.addEventListener('DOMContentLoaded', init);
