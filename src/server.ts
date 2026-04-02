import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { emitter, getAllSessionStates, startWatcher } from './watcher.js';
import { loadGlobalStats, CLAUDE_DIR } from './parser.js';
import { loadHistory, loadAllTodos, loadPlans, loadSettings } from './data.js';
import type {
  WsMessage,
  InitialStateData,
  SessionAddedData,
  TurnsUpdatedData,
  HistoryUpdatedData,
  TodosUpdatedData,
  PlansUpdatedData,
  ActiveSession,
  Turn,
  SessionStats,
  GlobalStats,
  HistoryEntry,
  TodoItem,
  Plan,
} from './types/index.js';

const PORT = Number(process.env['PORT'] ?? 4242);
const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir  = join(__dirname, '..', 'public');

// ── Express app ────────────────────────────────────────────────────────────

const app = express();
const httpServer = createServer(app);

app.use(express.static(publicDir));

app.get('/api/state', (_req, res) => {
  res.json(buildInitialState());
});

app.get('/api/v1/session-files', (req, res) => {
  const cwd = String(req.query['cwd'] ?? '').trim();
  if (!cwd) { res.status(400).json({ error: 'cwd required' }); return; }
  const dir = resolve(cwd);
  const candidates = [
    { label: 'Global CLAUDE.md',              path: join(CLAUDE_DIR, 'CLAUDE.md') },
    { label: 'Global settings.json',          path: join(CLAUDE_DIR, 'settings.json') },
    { label: 'Global settings.local.json',    path: join(CLAUDE_DIR, 'settings.local.json') },
    { label: 'Project CLAUDE.md',             path: join(dir, 'CLAUDE.md') },
    { label: 'Project CLAUDE.local.md',       path: join(dir, 'CLAUDE.local.md') },
    { label: 'Project .claude/CLAUDE.md',     path: join(dir, '.claude', 'CLAUDE.md') },
    { label: 'Project .claude/settings.json', path: join(dir, '.claude', 'settings.json') },
    { label: 'Project .claude/settings.local.json', path: join(dir, '.claude', 'settings.local.json') },
  ];
  const files = candidates.map(({ label, path }) => ({
    label,
    path,
    content: existsSync(path) ? readFileSync(path, 'utf-8') : null,
  }));
  res.json(files);
});

// ── WebSocket server ───────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close',   () => clients.delete(ws));
  ws.on('error',   () => clients.delete(ws));

  // Send full current state on connect
  send(ws, { type: 'initial_state', data: buildInitialState() });
});

// ── Watcher → WebSocket bridge ─────────────────────────────────────────────

emitter.on('session:added', (session: ActiveSession, stats: SessionStats, turns: Turn[]) => {
  const data: SessionAddedData = { session, stats };
  broadcast({ type: 'session_added', data });
  if (turns.length > 0) {
    const turnsData: TurnsUpdatedData = { sessionId: session.sessionId, newTurns: turns, stats };
    broadcast({ type: 'turns_updated', data: turnsData });
  }
});

emitter.on('session:removed', (sessionId: string) => {
  broadcast({ type: 'session_removed', data: sessionId });
});

emitter.on('turns:updated', (sessionId: string, newTurns: Turn[], stats: SessionStats) => {
  const data: TurnsUpdatedData = { sessionId, newTurns, stats };
  broadcast({ type: 'turns_updated', data });
});

emitter.on('stats:updated', (stats: GlobalStats | null) => {
  broadcast({ type: 'stats_updated', data: stats });
});

emitter.on('history:updated', (entries: HistoryEntry[]) => {
  const data: HistoryUpdatedData = { entries };
  broadcast({ type: 'history_updated', data });
});

emitter.on('todos:updated', (todos: Record<string, TodoItem[]>) => {
  const data: TodosUpdatedData = { todos };
  broadcast({ type: 'todos_updated', data });
});

emitter.on('plans:updated', (plans: Plan[]) => {
  const data: PlansUpdatedData = { plans };
  broadcast({ type: 'plans_updated', data });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function buildInitialState(): InitialStateData {
  const states = getAllSessionStates();
  const activeSessions  = states.map(s => s.session);
  const sessionStats: Record<string, SessionStats> = {};
  const turns: Record<string, Turn[]> = {};

  for (const s of states) {
    sessionStats[s.session.sessionId] = s.stats;
    turns[s.session.sessionId] = s.turns.slice(-200);
  }

  return {
    activeSessions,
    sessionStats,
    turns,
    globalStats:  loadGlobalStats(),
    history:      loadHistory(),
    sessionTodos: loadAllTodos(),
    plans:        loadPlans(),
    settings:     loadSettings(),
  };
}

function broadcast(msg: WsMessage): void {
  const json = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

function send(ws: WebSocket, msg: WsMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ── Start ──────────────────────────────────────────────────────────────────

export function startServer(): void {
  startWatcher();

  httpServer.listen(PORT, () => {
    console.log(`\n  ⬡  Claude Monitor\n`);
    console.log(`  http://localhost:${PORT}\n`);
  });
}

export { httpServer };
