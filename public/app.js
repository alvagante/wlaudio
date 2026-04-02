import { renderSidebar, renderGlobalStats, renderPlans, renderSettings, initPlanModal, openPlanModal } from './sidebar.js';
import { initTabs, updateDetailHeader, updateMetrics, resetTimeline, appendTurnsToTimeline, renderPrompts, renderTasks } from './render.js';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  sessions:    new Map(),   // sessionId → ActiveSession
  stats:       new Map(),   // sessionId → SessionStats
  turns:       new Map(),   // sessionId → Turn[]
  globalStats: null,
  history:     [],          // HistoryEntry[]
  todos:       {},          // sessionId → TodoItem[]
  plans:       [],          // Plan[]
  settings:    null,        // ClaudeSettings | null
  selectedId:  null,
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
  document.getElementById('conn-dot').className    = `dot ${up ? 'connected' : 'disconnected'}`;
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
  }
}

// ── Event handlers ─────────────────────────────────────────────────────────
function onInitialState({ activeSessions, sessionStats, turns, globalStats, history, sessionTodos, plans, settings }) {
  state.sessions.clear(); state.stats.clear(); state.turns.clear();
  for (const s of activeSessions)                        state.sessions.set(s.sessionId, s);
  for (const [id, st] of Object.entries(sessionStats))   state.stats.set(id, st);
  for (const [id, ts] of Object.entries(turns))          state.turns.set(id, ts);
  state.globalStats = globalStats;
  state.history     = history ?? [];
  state.todos       = sessionTodos ?? {};
  state.plans       = plans ?? [];
  state.settings    = settings ?? null;
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
  renderSidebarView();
  if (state.selectedId === session.sessionId) renderDetailView();
}

function onSessionRemoved(sessionId) {
  state.sessions.delete(sessionId);
  state.stats.delete(sessionId);
  state.turns.delete(sessionId);
  if (state.selectedId === sessionId) {
    state.selectedId = state.sessions.size > 0 ? [...state.sessions.keys()][0] : null;
    renderDetailView();
  }
  renderSidebarView();
}

function onTurnsUpdated({ sessionId, newTurns, stats }) {
  const existing = state.turns.get(sessionId) ?? [];
  existing.push(...newTurns);
  state.turns.set(sessionId, existing);
  state.stats.set(sessionId, stats);
  renderSidebarView();
  if (state.selectedId === sessionId) {
    updateMetrics(stats);
    appendTurnsToTimeline(newTurns);
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

function renderSidebarView() {
  renderSidebar(state.sessions, state.stats, state.selectedId, selectSession);
}

function renderDetailView() {
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

  updateDetailHeader(session);
  updateMetrics(stats);
  resetTimeline();
  appendTurnsToTimeline(turns);
  renderPrompts(state.selectedId, state.history);
  renderTasks(state.selectedId, state.todos);
}

// ── Boot ───────────────────────────────────────────────────────────────────
initTabs();
initPlanModal();
connect();
setInterval(renderSidebarView, 30_000);
