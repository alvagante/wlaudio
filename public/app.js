import { renderSidebar, renderGlobalStats, renderPlans, renderSettings, initPlanModal, openPlanModal } from './sidebar.js';
import { initTabs, initToolPopup, initFilesPopup, openFilesPopup, updateDetailHeader, updateMetrics, resetTimeline, appendTurnsToTimeline, renderPrompts, renderTasks } from './render.js';
import { updateSummaryCard, updateCodeImpact, updateFirstPrompt, updateActivityHours } from './insights.js';
import { renderFileHistory } from './file-history.js';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  sessions:   new Map(),   // sessionId → ActiveSession  (active)
  completed:  new Map(),   // sessionId → {session, stats, turns, endedAt}
  stats:      new Map(),   // sessionId → SessionStats
  turns:      new Map(),   // sessionId → Turn[]
  globalStats: null,
  history:    [],
  todos:      {},
  plans:      [],
  settings:   null,
  meta:       {},          // sessionId → SessionMeta
  facets:     {},          // sessionId → SessionFacets
  selectedId: null,
};

// ── WebSocket ──────────────────────────────────────────────────────────────
function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen  = () => setConn(true);
  ws.onclose = () => { setConn(false); setTimeout(connect, 3000); };
  ws.onerror = () => ws.close();
  ws.onmessage = (e) => {
    try { dispatch(JSON.parse(e.data)); } catch { /* ignore parse errors */ }
  };
}

function setConn(up) {
  document.getElementById('conn-dot').className     = `dot ${up ? 'connected' : 'disconnected'}`;
  document.getElementById('conn-label').textContent = up ? 'LIVE' : 'RECONNECTING';
}

// ── Dispatcher ─────────────────────────────────────────────────────────────
function dispatch({ type, data }) {
  switch (type) {
    case 'initial_state':   onInitialState(data);   break;
    case 'session_added':   onSessionAdded(data);   break;
    case 'session_removed': onSessionRemoved(data); break;
    case 'turns_updated':   onTurnsUpdated(data);   break;
    case 'stats_updated':   onStatsUpdated(data);   break;
    case 'history_updated': onHistoryUpdated(data); break;
    case 'todos_updated':   onTodosUpdated(data);   break;
    case 'plans_updated':   onPlansUpdated(data);   break;
    case 'meta_updated':    onMetaUpdated(data);    break;
  }
}

// ── Event handlers ─────────────────────────────────────────────────────────
function onInitialState({ activeSessions, sessionStats, turns, globalStats, history, sessionTodos, plans, settings, sessionMeta, sessionFacets }) {
  state.sessions.clear(); state.completed.clear(); state.stats.clear(); state.turns.clear();
  for (const s of activeSessions)                       state.sessions.set(s.sessionId, s);
  for (const [id, st] of Object.entries(sessionStats))  state.stats.set(id, st);
  for (const [id, ts] of Object.entries(turns))         state.turns.set(id, ts);
  state.globalStats = globalStats;
  state.history     = history ?? [];
  state.todos       = sessionTodos ?? {};
  state.plans       = plans ?? [];
  state.settings    = settings ?? null;
  state.meta        = sessionMeta ?? {};
  state.facets      = sessionFacets ?? {};

  // Populate completed sessions from session-meta for non-active sessions
  const activeIds = new Set(activeSessions.map(s => s.sessionId));
  const metas = Object.values(state.meta)
    .filter(m => !activeIds.has(m.sessionId) && m.projectPath && m.startTime)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, 15);
  for (const m of metas) {
    const endedAt   = new Date(m.startTime).getTime() + m.durationMinutes * 60_000;
    const toolCount = Object.values(m.toolCounts ?? {}).reduce((a, b) => a + b, 0);
    state.completed.set(m.sessionId, {
      session: { sessionId: m.sessionId, cwd: m.projectPath, startedAt: new Date(m.startTime).getTime(), kind: 'interactive', entrypoint: 'cli' },
      endedAt,
    });
    // Build synthetic stats — token/cost data is not in metadata, so flag as unavailable
    state.stats.set(m.sessionId, {
      sessionId:        m.sessionId,
      totalTokens:      { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      estimatedCostUSD: 0,
      toolCallCount:    toolCount,
      toolErrorCount:   m.toolErrors ?? 0,
      turnCount:        (m.userMessageCount ?? 0) + (m.assistantMessageCount ?? 0),
      durationMs:       (m.durationMinutes ?? 0) * 60_000,
      models:           {},
      toolFrequency:    m.toolCounts ?? {},
      isSubagentActive: m.usesTaskAgent ?? false,
      hasTokenData:     false,
    });
  }

  if (!state.selectedId) {
    const urlSession = new URLSearchParams(location.search).get('session');
    if (urlSession && isSessionKnown(urlSession)) {
      state.selectedId = urlSession;
    } else {
      state.selectedId = state.sessions.size > 0
        ? [...state.sessions.keys()][0]
        : state.completed.size > 0 ? [...state.completed.keys()][0] : null;
    }
  }
  renderAll();
}

function onSessionAdded({ session, stats }) {
  state.sessions.set(session.sessionId, session);
  state.stats.set(session.sessionId, stats);
  state.turns.set(session.sessionId, []);
  if (!state.selectedId) state.selectedId = session.sessionId;
  renderSidebarView();
  if (state.selectedId === session.sessionId) renderDetailView();
}

function onSessionRemoved(sessionId) {
  const session = state.sessions.get(sessionId);
  const stats   = state.stats.get(sessionId);
  const turns   = state.turns.get(sessionId) ?? [];
  if (session) {
    state.completed.set(sessionId, { session, stats, turns, endedAt: Date.now() });
  }
  state.sessions.delete(sessionId);
  // keep stats/turns in state maps so renderDetailView still works for completed session
  renderSidebarView();
  if (state.selectedId === sessionId) renderDetailView();
}

function onTurnsUpdated({ sessionId, newTurns, stats }) {
  const existing = state.turns.get(sessionId) ?? [];
  existing.push(...newTurns);
  state.turns.set(sessionId, existing);
  state.stats.set(sessionId, stats);
  renderSidebarView();
  if (state.selectedId === sessionId) {
    updateMetrics(stats, existing);
    updateCodeImpact(state.meta[sessionId] ?? null, stats);
    appendTurnsToTimeline(newTurns);
    renderFileHistory(existing);
  }
}

function onStatsUpdated(stats) {
  state.globalStats = stats;
  renderGlobalStats(stats);
}

function onHistoryUpdated({ entries }) {
  state.history = entries;
  if (state.selectedId) renderPrompts(state.selectedId, state.history);
}

function onTodosUpdated({ todos }) {
  state.todos = todos;
  if (state.selectedId) renderTasks(state.selectedId, state.todos);
}

function onPlansUpdated({ plans }) {
  state.plans = plans;
  renderPlans(state.plans, openPlanModal);
}

function onMetaUpdated({ sessionMeta, sessionFacets }) {
  state.meta   = sessionMeta ?? {};
  state.facets = sessionFacets ?? {};
  if (state.selectedId) {
    const meta = state.meta[state.selectedId] ?? null;
    updateSummaryCard(state.facets[state.selectedId] ?? null);
    updateFirstPrompt(meta);
    updateActivityHours(meta);
    updateCodeImpact(meta, state.stats.get(state.selectedId) ?? null);
  }
}

// ── Render orchestration ───────────────────────────────────────────────────
function renderAll() {
  renderSidebarView();
  renderDetailView();
  renderGlobalStats(state.globalStats);
  renderPlans(state.plans, openPlanModal);
  renderSettings(state.settings);
}

function selectSession(id) {
  state.selectedId = id;
  renderSidebarView();
  renderDetailView();
}

function isSessionKnown(id) {
  return state.sessions.has(id) || state.completed.has(id);
}

function renderSidebarView() {
  renderSidebar(state.sessions, state.stats, state.selectedId, selectSession, state.completed, state.facets, state.meta);
}

function renderDetailView() {
  const empty  = document.getElementById('empty-state');
  const detail = document.getElementById('session-detail');
  const id     = state.selectedId;

  const isActive    = id && state.sessions.has(id);
  const isCompleted = id && state.completed.has(id);

  if (!id || (!isActive && !isCompleted)) {
    empty.classList.remove('hidden');
    detail.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  detail.classList.remove('hidden');

  const session = isActive ? state.sessions.get(id) : state.completed.get(id).session;
  const stats   = state.stats.get(id) ?? null;
  const turns   = state.turns.get(id) ?? [];
  const meta    = state.meta[id]   ?? null;
  const facets  = state.facets[id] ?? null;

  updateDetailHeader(session, isCompleted && !isActive);
  updateMetrics(stats, turns);
  updateFirstPrompt(meta);
  updateSummaryCard(facets);
  updateActivityHours(meta);
  updateCodeImpact(meta, stats);
  resetTimeline();
  appendTurnsToTimeline(turns);
  renderPrompts(id, state.history);
  renderTasks(id, state.todos);
  renderFileHistory(turns);
}

// ── Boot ───────────────────────────────────────────────────────────────────
initTabs();
initPlanModal();
initToolPopup();
initFilesPopup();

document.getElementById('files-btn').addEventListener('click', () => {
  const session = state.sessions.get(state.selectedId)
    ?? state.completed.get(state.selectedId)?.session;
  if (session) openFilesPopup(session.cwd);
});

connect();
setInterval(renderSidebarView, 30_000);
