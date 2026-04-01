import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { emitter, getAllSessionStates, startWatcher } from './watcher.js';
import { loadGlobalStats } from './parser.js';
import type {
  WsMessage,
  InitialStateData,
  SessionAddedData,
  TurnsUpdatedData,
  ActiveSession,
  Turn,
  SessionStats,
  GlobalStats,
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
  // also push existing turns for this session
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

// ── Helpers ────────────────────────────────────────────────────────────────

function buildInitialState(): InitialStateData {
  const states = getAllSessionStates();
  const activeSessions  = states.map(s => s.session);
  const sessionStats: Record<string, SessionStats> = {};
  const turns: Record<string, Turn[]> = {};

  for (const s of states) {
    sessionStats[s.session.sessionId] = s.stats;
    // Send at most last 200 turns to keep the initial payload manageable
    turns[s.session.sessionId] = s.turns.slice(-200);
  }

  return { activeSessions, sessionStats, turns, globalStats: loadGlobalStats() };
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
