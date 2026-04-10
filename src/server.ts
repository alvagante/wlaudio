import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { join, dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { emitter, getAllSessionStates, getSessionState, startWatcher } from './watcher.js';
import { loadGlobalStats, parseSessionTurns, encodePath, CLAUDE_DIR } from './parser.js';
import { loadHistory, loadAllTodos, loadPlans, loadSettings, loadAllSessionMetas, loadOrphanSessionMetas, loadAllSessionFacets, loadConfigs, loadHookScripts, loadSkillsAndCommands } from './data.js';
import { computeProjectHealth } from './health.js';
import { claudeMdLinter } from './linter.js';
import { terminalManager } from './terminal.js';
import type {
  WsMessage,
  WsClientMessage,
  TerminalCreatePayload,
  TerminalInputPayload,
  TerminalResizePayload,
  TerminalClosePayload,
  TerminalOutputData,
  TerminalExitData,
  InitialStateData,
  DailyCost,
  DailyCodeVelocity,
  SessionAddedData,
  TurnsUpdatedData,
  HistoryUpdatedData,
  TodosUpdatedData,
  PlansUpdatedData,
  MetaUpdatedData,
  ActiveSession,
  Turn,
  SessionStats,
  GlobalStats,
  HistoryEntry,
  TodoItem,
  Plan,
  SessionMeta,
  SessionFacets,
  AnalyticsData,
  TokenUsage,
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

app.get('/api/v1/sessions/:id/turns', (req, res) => {
  const sessionId = req.params['id'] ?? '';
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    res.status(400).json({ error: 'Invalid session ID' });
    return;
  }

  // Active session — serve from memory
  const active = getSessionState(sessionId);
  if (active) {
    res.json({ turns: active.turns });
    return;
  }

  // Historical session — locate JSONL via session-meta
  const allMeta = loadAllSessionMetas();
  const meta = allMeta[sessionId];
  if (!meta) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const filePath = join(CLAUDE_DIR, 'projects', encodePath(meta.projectPath), `${sessionId}.jsonl`);
  const { turns } = parseSessionTurns(filePath, 0);
  res.json({ turns });
});

// ── Analytics API ──────────────────────────────────────────────────────────

const ANALYTICS_PRICING = {
  opus:   { inputPerM: 15,  outputPerM: 75, cacheReadPerM: 1.5,  cacheWritePerM: 18.75 },
  sonnet: { inputPerM: 3,   outputPerM: 15, cacheReadPerM: 0.3,  cacheWritePerM: 3.75  },
  haiku:  { inputPerM: 0.8, outputPerM: 4,  cacheReadPerM: 0.08, cacheWritePerM: 1     },
} as const;

function modelPricing(model: string) {
  if (model.includes('opus'))  return ANALYTICS_PRICING.opus;
  if (model.includes('haiku')) return ANALYTICS_PRICING.haiku;
  return ANALYTICS_PRICING.sonnet;
}

app.get('/api/v1/analytics', (_req, res) => {
  const globalStats = loadGlobalStats();
  const allMetas    = loadAllSessionMetas();
  const allFacets   = loadAllSessionFacets();

  const outcomeCounts: Record<string, number>     = {};
  const sessionTypeCounts: Record<string, number> = {};
  for (const f of Object.values(allFacets)) {
    if (f.outcome)     outcomeCounts[f.outcome]         = (outcomeCounts[f.outcome]         ?? 0) + 1;
    if (f.sessionType) sessionTypeCounts[f.sessionType] = (sessionTypeCounts[f.sessionType] ?? 0) + 1;
  }

  const languageTotals: Record<string, number> = {};
  for (const m of Object.values(allMetas)) {
    for (const [lang, count] of Object.entries(m.languages ?? {})) {
      languageTotals[lang] = (languageTotals[lang] ?? 0) + count;
    }
  }

  const modelAnalytics: AnalyticsData['modelAnalytics'] = {};
  for (const [model, tokens] of Object.entries(globalStats?.modelUsage ?? {})) {
    const p = modelPricing(model);
    const t = tokens as TokenUsage;
    modelAnalytics[model] = {
      tokens: t,
      costUSD: Math.round((
        t.inputTokens              / 1e6 * p.inputPerM  +
        t.outputTokens             / 1e6 * p.outputPerM +
        t.cacheReadInputTokens     / 1e6 * p.cacheReadPerM +
        t.cacheCreationInputTokens / 1e6 * p.cacheWritePerM
      ) * 10000) / 10000,
    };
  }

  // ── Daily cost from dailyModelTokens in stats-cache ─────────────────────
  const rawDailyTokens = globalStats?.dailyModelTokens ?? [];

  const dailyCosts: DailyCost[] = rawDailyTokens.slice(-60).map(day => {
    const byModel: Record<string, number> = {};
    let total = 0;
    for (const [model, tokens] of Object.entries(day.tokensByModel ?? {})) {
      const p = modelPricing(model);
      // dailyModelTokens stores total tokens (input+output combined estimate); treat as output for cost approx
      // Actually it's an aggregate — use sonnet pricing as fallback and just show relative scale
      const cost = Math.round((Number(tokens) / 1e6 * p.outputPerM) * 10000) / 10000;
      byModel[model] = cost;
      total += cost;
    }
    return { date: day.date, byModel, total: Math.round(total * 10000) / 10000 };
  });

  // ── Daily code velocity from session-meta ─────────────────────────────────
  const velocityMap = new Map<string, { linesAdded: number; linesRemoved: number }>();
  for (const m of Object.values(allMetas)) {
    if (!m.startTime) continue;
    const date = m.startTime.slice(0, 10);
    const cur  = velocityMap.get(date) ?? { linesAdded: 0, linesRemoved: 0 };
    cur.linesAdded   += m.linesAdded   ?? 0;
    cur.linesRemoved += m.linesRemoved ?? 0;
    velocityMap.set(date, cur);
  }
  const dailyCodeVelocity: DailyCodeVelocity[] = [...velocityMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-60)
    .map(([date, v]) => ({ date, ...v }));

  // ── Quality signals from facets ───────────────────────────────────────────
  const helpfulnessCounts:      Record<string, number> = {};
  const userSatisfactionCounts: Record<string, number> = {};
  const frictionCounts:         Record<string, number> = {};

  for (const f of Object.values(allFacets)) {
    if (f.claudeHelpfulness) {
      helpfulnessCounts[f.claudeHelpfulness] = (helpfulnessCounts[f.claudeHelpfulness] ?? 0) + 1;
    }
    for (const [k, v] of Object.entries(f.userSatisfactionCounts ?? {})) {
      userSatisfactionCounts[k] = (userSatisfactionCounts[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(f.frictionCounts ?? {})) {
      frictionCounts[k] = (frictionCounts[k] ?? 0) + v;
    }
  }

  // ── Tool totals + by-hour aggregation ────────────────────────────────────
  const toolTotals: Record<string, number>    = {};
  const toolByHour: Record<string, number[]>  = {};

  for (const m of Object.values(allMetas)) {
    const primaryHour = m.messageHours?.[0];
    for (const [tool, count] of Object.entries(m.toolCounts ?? {})) {
      toolTotals[tool] = (toolTotals[tool] ?? 0) + count;
      if (primaryHour !== undefined) {
        if (!toolByHour[tool]) toolByHour[tool] = new Array(24).fill(0) as number[];
        const arr = toolByHour[tool]!;
        arr[primaryHour] = (arr[primaryHour] ?? 0) + count;
      }
    }
  }

  // ── Cost forecasting from last 7/14 days ──────────────────────────────────
  const last7  = dailyCosts.slice(-7);
  const last14 = dailyCosts.slice(-14);
  const burnRateDaily = last7.length
    ? last7.reduce((s, d) => s + d.total, 0) / last7.length
    : 0;
  const prevWeekAvg = last14.length > 7
    ? last14.slice(0, 7).reduce((s, d) => s + d.total, 0) / 7
    : burnRateDaily;
  const burnRateTrend: 'up' | 'down' | 'flat' =
    burnRateDaily > prevWeekAvg * 1.1 ? 'up'   :
    burnRateDaily < prevWeekAvg * 0.9 ? 'down' : 'flat';

  const today           = new Date();
  const daysLeftInWeek  = 7 - today.getDay();
  const daysInMonth     = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysLeftInMonth = daysInMonth - today.getDate();
  const forecastWeeklyCost  = Math.round(burnRateDaily * daysLeftInWeek  * 100) / 100;
  const forecastMonthlyCost = Math.round(burnRateDaily * daysLeftInMonth * 100) / 100;

  const analytics: AnalyticsData = {
    totalSessions:    globalStats?.totalSessions   ?? 0,
    totalMessages:    globalStats?.totalMessages   ?? 0,
    firstSessionDate: globalStats?.firstSessionDate ?? '',
    longestSession:   globalStats?.longestSession  ?? null,
    hourCounts:       globalStats?.hourCounts      ?? {},
    outcomeCounts,
    languageTotals,
    sessionTypeCounts,
    modelAnalytics,
    dailyCosts,
    dailyCodeVelocity,
    helpfulnessCounts,
    userSatisfactionCounts,
    frictionCounts,
    toolTotals,
    toolByHour,
    burnRateDaily:        Math.round(burnRateDaily * 10000) / 10000,
    burnRateTrend,
    forecastWeeklyCost,
    forecastMonthlyCost,
  };

  res.json(analytics);
});

app.get('/api/v1/projects', (_req, res) => {
  const allMetas  = loadAllSessionMetas();
  const orphans   = loadOrphanSessionMetas(new Set(Object.keys(allMetas)));
  Object.assign(allMetas, orphans);
  const allFacets = loadAllSessionFacets();
  const allTodos  = loadAllTodos();

  // Group sessions by project path
  const byProject = new Map<string, {
    metas:  ReturnType<typeof loadAllSessionMetas>[string][];
    facets: ReturnType<typeof loadAllSessionFacets>[string][];
  }>();

  for (const meta of Object.values(allMetas)) {
    const key = meta.projectPath || '(unknown)';
    if (!byProject.has(key)) byProject.set(key, { metas: [], facets: [] });
    byProject.get(key)!.metas.push(meta);
  }
  for (const [sessionId, facet] of Object.entries(allFacets)) {
    const meta = allMetas[sessionId];
    if (!meta) continue;
    const key = meta.projectPath || '(unknown)';
    if (!byProject.has(key)) byProject.set(key, { metas: [], facets: [] });
    byProject.get(key)!.facets.push(facet);
  }

  const projects = [...byProject.entries()].map(([projectPath, { metas, facets }]) => {
    const sessions = metas
      .sort((a, b) => {
        const aTime = Date.parse(a.startTime);
        const bTime = Date.parse(b.startTime);
        const aSortTime = Number.isNaN(aTime) ? Number.NEGATIVE_INFINITY : aTime;
        const bSortTime = Number.isNaN(bTime) ? Number.NEGATIVE_INFINITY : bTime;
        return bSortTime - aSortTime;
      })
      .map(m => {
        const f = allFacets[m.sessionId];
        return {
          sessionId:       m.sessionId,
          startTime:       m.startTime,
          durationMinutes: m.durationMinutes,
          firstPrompt:     m.firstPrompt,
          linesAdded:      m.linesAdded,
          linesRemoved:    m.linesRemoved,
          gitCommits:      m.gitCommits,
          outcome:         f?.outcome       ?? '',
          briefSummary:    f?.briefSummary  ?? '',
        };
      });

    const languages:    Record<string, number> = {};
    const toolCounts:   Record<string, number> = {};
    const outcomeCounts:      Record<string, number> = {};
    const goalCategories:     Record<string, number> = {};
    const helpfulnessCounts:  Record<string, number> = {};
    const sessionTypeCounts:  Record<string, number> = {};

    let totalDurationMinutes = 0, totalLinesAdded = 0, totalLinesRemoved = 0;
    let totalFilesModified = 0, totalGitCommits = 0, totalGitPushes = 0;
    let totalToolCalls = 0, totalToolErrors = 0, totalUserInterruptions = 0;

    for (const m of metas) {
      totalDurationMinutes    += m.durationMinutes    ?? 0;
      totalLinesAdded         += m.linesAdded         ?? 0;
      totalLinesRemoved       += m.linesRemoved       ?? 0;
      totalFilesModified      += m.filesModified      ?? 0;
      totalGitCommits         += m.gitCommits         ?? 0;
      totalGitPushes          += m.gitPushes          ?? 0;
      totalToolErrors         += m.toolErrors         ?? 0;
      totalUserInterruptions  += m.userInterruptions  ?? 0;
      for (const [l, c] of Object.entries(m.languages  ?? {})) languages[l]  = (languages[l]  ?? 0) + c;
      for (const [t, c] of Object.entries(m.toolCounts ?? {})) {
        toolCounts[t] = (toolCounts[t] ?? 0) + c;
        totalToolCalls += c;
      }
    }

    for (const f of facets) {
      if (f.outcome)          outcomeCounts[f.outcome]         = (outcomeCounts[f.outcome]         ?? 0) + 1;
      if (f.claudeHelpfulness) helpfulnessCounts[f.claudeHelpfulness] = (helpfulnessCounts[f.claudeHelpfulness] ?? 0) + 1;
      if (f.sessionType)      sessionTypeCounts[f.sessionType] = (sessionTypeCounts[f.sessionType] ?? 0) + 1;
      for (const [g, c] of Object.entries(f.goalCategories ?? {})) goalCategories[g] = (goalCategories[g] ?? 0) + c;
    }

    const sortedActiveTimes = metas
      .map(m => {
        const iso = m.startTime?.trim() ?? '';
        const time = Date.parse(iso);
        return Number.isNaN(time) ? null : { iso, time };
      })
      .filter((entry): entry is { iso: string; time: number } => entry !== null)
      .sort((a, b) => a.time - b.time);
    const firstActive = sortedActiveTimes[0]?.iso ?? '';
    const lastActive  = sortedActiveTimes[sortedActiveTimes.length - 1]?.iso ?? '';

    const projectTodos = metas.flatMap(m => allTodos[m.sessionId] ?? []);
    const health = computeProjectHealth(
      { totalToolCalls, totalToolErrors, outcomeCounts, helpfulnessCounts,
        totalLinesAdded, totalLinesRemoved, estimatedCostUSD: 0 },
      projectTodos,
    );

    return {
      projectPath,
      projectName: basename(projectPath.replace(/\\/g, '/')) || projectPath,
      sessionCount: metas.length,
      lastActive,
      firstActive,
      totalDurationMinutes,
      avgDurationMinutes: metas.length ? Math.round(totalDurationMinutes / metas.length) : 0,
      totalLinesAdded,
      totalLinesRemoved,
      totalFilesModified,
      totalGitCommits,
      totalGitPushes,
      totalToolCalls,
      totalToolErrors,
      totalUserInterruptions,
      languages,
      toolCounts,
      outcomeCounts,
      goalCategories,
      helpfulnessCounts,
      sessionTypeCounts,
      sessions,
      healthScore:     health.score,
      healthGrade:     health.grade,
      healthBreakdown: health.breakdown,
    };
  }).sort((a, b) => new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime());

  res.json(projects);
});

app.get('/api/v1/configs', (_req, res) => {
  const configs     = loadConfigs();
  const hookScripts = loadHookScripts();
  const skills      = loadSkillsAndCommands();

  const enrichedProjects = configs.projects.map(p => ({
    ...p,
    claudeMdLint: p.claudeMd ? claudeMdLinter(p.claudeMd) : undefined,
  }));

  res.json({
    ...configs,
    projects:          enrichedProjects,
    hookScripts,
    skills,
    globalClaudeMdLint: configs.globalClaudeMd ? claudeMdLinter(configs.globalClaudeMd) : null,
  });
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

// ── Terminal REST endpoints ────────────────────────────────────────────────

app.get('/api/v1/terminals', (_req, res) => {
  res.json(terminalManager.list());
});

// ── WebSocket server ───────────────────────────────────────────────────────

const TERMINAL_ENABLED = process.env['TERMINAL_ENABLED'] === '1' || process.env['TERMINAL_ENABLED'] === 'true';

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
const clients = new Set<WebSocket>();

// Map terminalId → Set of WebSocket clients subscribed to that terminal
const terminalClients = new Map<string, Set<WebSocket>>();

/** Returns true if the Origin header is present and is a localhost origin. */
function isLocalhostOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

/** Type-safe runtime validators for terminal message payloads. */
function isTerminalCreatePayload(d: unknown): d is TerminalCreatePayload {
  if (!d || typeof d !== 'object') return false;
  const r = d as Record<string, unknown>;
  return typeof r['terminalId'] === 'string' && !!r['terminalId'] &&
    typeof r['cwd'] === 'string' &&
    typeof r['cols'] === 'number' && typeof r['rows'] === 'number';
}
function isTerminalInputPayload(d: unknown): d is TerminalInputPayload {
  if (!d || typeof d !== 'object') return false;
  const r = d as Record<string, unknown>;
  return typeof r['terminalId'] === 'string' && !!r['terminalId'] &&
    typeof r['data'] === 'string';
}
function isTerminalResizePayload(d: unknown): d is TerminalResizePayload {
  if (!d || typeof d !== 'object') return false;
  const r = d as Record<string, unknown>;
  return typeof r['terminalId'] === 'string' && !!r['terminalId'] &&
    typeof r['cols'] === 'number' && typeof r['rows'] === 'number';
}
function isTerminalClosePayload(d: unknown): d is TerminalClosePayload {
  if (!d || typeof d !== 'object') return false;
  const r = d as Record<string, unknown>;
  return typeof r['terminalId'] === 'string' && !!r['terminalId'];
}

wss.on('connection', (ws, req) => {
  clients.add(ws);
  ws.on('close',   () => {
    clients.delete(ws);
    // Remove ws from all terminal subscriptions; collect IDs first to avoid
    // mutating the map while iterating, then clean up empty entries and orphan PTYs.
    const toKill: string[] = [];
    for (const [terminalId, subs] of terminalClients) {
      subs.delete(ws);
      if (subs.size === 0) toKill.push(terminalId);
    }
    for (const terminalId of toKill) {
      terminalClients.delete(terminalId);
      terminalManager.kill(terminalId);
    }
  });
  ws.on('error',   () => clients.delete(ws));

  ws.on('message', (raw) => {
    let msg: WsClientMessage;
    try { msg = JSON.parse(raw.toString()) as WsClientMessage; }
    catch { return; }

    switch (msg.type) {
      case 'terminal:create': {
        if (!TERMINAL_ENABLED) break;
        // Reject if Origin is missing or not localhost (prevents cross-site WS hijacking)
        if (!isLocalhostOrigin(req.headers['origin'])) break;
        if (!isTerminalCreatePayload(msg.data)) break;
        const p = msg.data;
        if (!terminalClients.has(p.terminalId)) terminalClients.set(p.terminalId, new Set());
        terminalClients.get(p.terminalId)!.add(ws);
        try {
          terminalManager.create(p.terminalId, p.cwd, p.cols, p.rows);
        } catch (err) {
          const msg2 = err instanceof Error ? err.message : String(err);
          const errPayload = { terminalId: p.terminalId, data: `\r\n\x1b[31m[wlaudio] Spawn error: ${msg2}\x1b[0m\r\n` };
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'terminal:output', data: errPayload }));
        }
        break;
      }
      case 'terminal:input': {
        if (!TERMINAL_ENABLED) break;
        if (!isTerminalInputPayload(msg.data)) break;
        const p = msg.data;
        terminalManager.write(p.terminalId, p.data);
        break;
      }
      case 'terminal:resize': {
        if (!TERMINAL_ENABLED) break;
        if (!isTerminalResizePayload(msg.data)) break;
        const p = msg.data;
        terminalManager.resize(p.terminalId, p.cols, p.rows);
        break;
      }
      case 'terminal:close': {
        if (!TERMINAL_ENABLED) break;
        if (!isTerminalClosePayload(msg.data)) break;
        const p = msg.data;
        terminalManager.kill(p.terminalId);
        terminalClients.delete(p.terminalId);
        break;
      }
    }
  });

  // Send full current state on connect
  send(ws, { type: 'initial_state', data: buildInitialState() });
});

// ── Terminal events → WebSocket ────────────────────────────────────────────

terminalManager.on('output', (terminalId: string, data: string) => {
  const payload: TerminalOutputData = { terminalId, data };
  const msg: WsMessage = { type: 'terminal:output', data: payload };
  const json = JSON.stringify(msg);
  const subs = terminalClients.get(terminalId);
  if (subs) {
    for (const ws of subs) {
      if (ws.readyState === WebSocket.OPEN) ws.send(json);
    }
  }
});

terminalManager.on('exit', (terminalId: string, exitCode: number) => {
  const payload: TerminalExitData = { terminalId, exitCode };
  const msg: WsMessage = { type: 'terminal:exit', data: payload };
  const json = JSON.stringify(msg);
  const subs = terminalClients.get(terminalId);
  if (subs) {
    for (const ws of subs) {
      if (ws.readyState === WebSocket.OPEN) ws.send(json);
    }
    terminalClients.delete(terminalId);
  }
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

emitter.on('meta:updated', (sessionMeta: Record<string, SessionMeta>, sessionFacets: Record<string, SessionFacets>) => {
  const data: MetaUpdatedData = { sessionMeta, sessionFacets };
  broadcast({ type: 'meta_updated', data });
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
    globalStats:   loadGlobalStats(),
    history:       loadHistory(),
    sessionTodos:  loadAllTodos(),
    plans:         loadPlans(),
    settings:      loadSettings(),
    sessionMeta:   loadAllSessionMetas(),
    sessionFacets: loadAllSessionFacets(),
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

  process.on('SIGTERM', () => { terminalManager.killAll(); process.exit(0); });
  process.on('SIGINT',  () => { terminalManager.killAll(); process.exit(0); });

  httpServer.listen(PORT, () => {
    console.log(`\n  ⬡  Wlaudio, the Claude Monitor\n`);
    console.log(`  http://localhost:${PORT}\n`);
  });
}

export { httpServer };
