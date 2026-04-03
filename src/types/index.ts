export interface ActiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  kind: 'interactive' | 'web' | 'batch';
  entrypoint: 'cli' | 'web' | 'api';
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface ToolResult {
  content: string;
  isError: boolean;
  timestamp: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  timestamp: string;
  isSidechain: boolean;
  result?: ToolResult;
  durationMs?: number;
}

export interface Turn {
  uuid: string;
  parentUuid: string | null;
  type: 'user' | 'assistant';
  timestamp: string;
  isSidechain: boolean;
  sessionId: string;
  model?: string;
  tokens?: TokenUsage;
  toolCalls?: ToolCall[];
}

export interface SessionStats {
  sessionId: string;
  totalTokens: TokenUsage;
  estimatedCostUSD: number;
  toolCallCount: number;
  toolErrorCount: number;
  turnCount: number;
  durationMs: number;
  models: Record<string, TokenUsage>;
  toolFrequency: Record<string, number>;
  isSubagentActive: boolean;
}

export interface SessionMeta {
  sessionId: string;
  projectPath: string;
  startTime: string;
  firstPrompt: string;
  durationMinutes: number;
  userMessageCount: number;
  assistantMessageCount: number;
  gitCommits: number;
  gitPushes: number;
  linesAdded: number;
  linesRemoved: number;
  filesModified: number;
  languages: Record<string, number>;
  toolCounts: Record<string, number>;
  toolErrors: number;
  userInterruptions: number;
  usesMcp: boolean;
  usesWebSearch: boolean;
  usesWebFetch: boolean;
  usesTaskAgent: boolean;
  messageHours?: number[];
}

export interface SessionFacets {
  underlyingGoal: string;
  goalCategories: Record<string, number>;
  outcome: string;
  claudeHelpfulness: string;
  sessionType: string;
  briefSummary: string;
  primarySuccess: string;
  frictionCounts?: Record<string, number>;
  frictionDetail?: string;
  userSatisfactionCounts?: Record<string, number>;
}

export interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface GlobalStats {
  totalSessions: number;
  totalMessages: number;
  dailyActivity: DailyActivity[];
  modelUsage: Record<string, TokenUsage>;
  hourCounts?: Record<string, number>;
  longestSession?: { sessionId: string; durationMinutes: number; messageCount: number; timestamp: string } | null;
  firstSessionDate?: string;
}

export interface ModelAnalytics {
  tokens: TokenUsage;
  costUSD: number;
}

export interface AnalyticsData {
  totalSessions: number;
  totalMessages: number;
  firstSessionDate: string;
  longestSession: { sessionId: string; durationMinutes: number; messageCount: number; timestamp: string } | null;
  hourCounts: Record<string, number>;
  outcomeCounts: Record<string, number>;
  languageTotals: Record<string, number>;
  sessionTypeCounts: Record<string, number>;
  modelAnalytics: Record<string, ModelAnalytics>;
}

// ── New data types ─────────────────────────────────────────────────────────

export interface HistoryEntry {
  display: string;
  timestamp: number;
  project: string;
  sessionId: string;
}

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface Plan {
  name: string;
  content: string;
}

export interface ClaudeSettings {
  hookCount: number;
  hookTypes: Record<string, number>;
  allowedTools: string[];
  deniedTools: string[];
}

// ── WebSocket protocol ─────────────────────────────────────────────────────

export type WsEventType =
  | 'initial_state'
  | 'session_added'
  | 'session_removed'
  | 'turns_updated'
  | 'stats_updated'
  | 'history_updated'
  | 'todos_updated'
  | 'plans_updated'
  | 'meta_updated';

export interface WsMessage<T = unknown> {
  type: WsEventType;
  data: T;
}

export interface InitialStateData {
  activeSessions: ActiveSession[];
  sessionStats: Record<string, SessionStats>;
  turns: Record<string, Turn[]>;
  globalStats: GlobalStats | null;
  history: HistoryEntry[];
  sessionTodos: Record<string, TodoItem[]>;
  plans: Plan[];
  settings: ClaudeSettings | null;
  sessionMeta: Record<string, SessionMeta>;
  sessionFacets: Record<string, SessionFacets>;
}

export interface MetaUpdatedData {
  sessionMeta: Record<string, SessionMeta>;
  sessionFacets: Record<string, SessionFacets>;
}

export interface SessionAddedData {
  session: ActiveSession;
  stats: SessionStats;
}

export interface TurnsUpdatedData {
  sessionId: string;
  newTurns: Turn[];
  stats: SessionStats;
}

export interface HistoryUpdatedData {
  entries: HistoryEntry[];
}

export interface TodosUpdatedData {
  todos: Record<string, TodoItem[]>;
}

export interface PlansUpdatedData {
  plans: Plan[];
}
