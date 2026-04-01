import chokidar from 'chokidar';
import { EventEmitter } from 'events';
import { join } from 'path';
import {
  loadActiveSessions,
  getSessionFilePath,
  parseSessionTurns,
  computeSessionStats,
  loadGlobalStats,
  CLAUDE_DIR,
} from './parser.js';
import type { ActiveSession, Turn, SessionStats, GlobalStats } from './types/index.js';

// ── Typed event emitter ────────────────────────────────────────────────────

interface WatcherEventMap {
  'session:added':   [session: ActiveSession, stats: SessionStats, turns: Turn[]];
  'session:removed': [sessionId: string];
  'turns:updated':   [sessionId: string, newTurns: Turn[], stats: SessionStats];
  'stats:updated':   [stats: GlobalStats | null];
}

class WatcherEmitter extends EventEmitter {
  override emit<K extends keyof WatcherEventMap>(
    event: K,
    ...args: WatcherEventMap[K]
  ): boolean {
    return super.emit(event, ...args);
  }
  override on<K extends keyof WatcherEventMap>(
    event: K,
    listener: (...args: WatcherEventMap[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
}

export const emitter = new WatcherEmitter();

// ── Session state ──────────────────────────────────────────────────────────

interface SessionState {
  session: ActiveSession;
  turns: Turn[];
  stats: SessionStats;
  fileOffset: number;
}

const sessionStates = new Map<string, SessionState>();

export function getSessionState(sessionId: string): SessionState | undefined {
  return sessionStates.get(sessionId);
}

export function getAllSessionStates(): SessionState[] {
  return Array.from(sessionStates.values());
}

// ── Watcher startup ────────────────────────────────────────────────────────

export function startWatcher(): void {
  const sessionsDir = join(CLAUDE_DIR, 'sessions');
  const statsPath   = join(CLAUDE_DIR, 'stats-cache.json');

  // React to session file changes (processes starting/stopping)
  chokidar
    .watch(sessionsDir, { ignoreInitial: false, depth: 0 })
    .on('add',    () => syncSessions())
    .on('change', () => syncSessions())
    .on('unlink', () => syncSessions());

  // React to global stats updates
  chokidar
    .watch(statsPath, { ignoreInitial: true })
    .on('change', () => emitter.emit('stats:updated', loadGlobalStats()));

  // Initial load
  syncSessions();

  // Poll JSONL files for new turns (2-second interval is lightweight)
  setInterval(pollTurns, 2000);
}

// ── Session sync ───────────────────────────────────────────────────────────

function syncSessions(): void {
  const current = loadActiveSessions();
  const currentIds = new Set(current.map(s => s.sessionId));

  // Remove sessions that are no longer active
  for (const [id] of sessionStates) {
    if (!currentIds.has(id)) {
      sessionStates.delete(id);
      emitter.emit('session:removed', id);
    }
  }

  // Add newly detected sessions
  for (const session of current) {
    if (!sessionStates.has(session.sessionId)) {
      const filePath = getSessionFilePath(session);
      const { turns, bytesRead } = parseSessionTurns(filePath, 0);
      const stats = computeSessionStats(turns, session.sessionId);
      sessionStates.set(session.sessionId, { session, turns, stats, fileOffset: bytesRead });
      emitter.emit('session:added', session, stats, turns);
    }
  }
}

// ── Turn polling ───────────────────────────────────────────────────────────

function pollTurns(): void {
  for (const [sessionId, state] of sessionStates) {
    const filePath = getSessionFilePath(state.session);
    const { turns: newTurns, bytesRead } = parseSessionTurns(filePath, state.fileOffset);

    if (bytesRead > state.fileOffset) {
      state.fileOffset = bytesRead;
    }

    if (newTurns.length > 0) {
      state.turns.push(...newTurns);
      state.stats = computeSessionStats(state.turns, sessionId);
      emitter.emit('turns:updated', sessionId, newTurns, state.stats);
    }
  }
}
