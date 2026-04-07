import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import type {
  ActiveSession,
  Turn,
  ToolCall,
  TokenUsage,
  SessionStats,
  GlobalStats,
} from './types/index.js';

const HOME = process.env['HOME'] ?? '/Users/al';
export const CLAUDE_DIR = join(HOME, '.claude');

export function encodePath(p: string): string {
  return p.replace(/\//g, '-');
}

export function getSessionFilePath(session: ActiveSession): string {
  return join(CLAUDE_DIR, 'projects', encodePath(session.cwd), `${session.sessionId}.jsonl`);
}

export function loadActiveSessions(): ActiveSession[] {
  const sessionsDir = join(CLAUDE_DIR, 'sessions');
  if (!existsSync(sessionsDir)) return [];
  try {
    return readdirSync(sessionsDir)
      .filter(f => f.endsWith('.json'))
      .flatMap(f => {
        try {
          return [JSON.parse(readFileSync(join(sessionsDir, f), 'utf-8')) as ActiveSession];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

export interface ParseResult {
  turns: Turn[];
  bytesRead: number;
}

export function parseSessionTurns(filePath: string, offset = 0): ParseResult {
  if (!existsSync(filePath)) return { turns: [], bytesRead: 0 };

  try {
    const content = readFileSync(filePath, 'utf-8');
    if (content.length <= offset) return { turns: [], bytesRead: content.length };

    const newContent = content.slice(offset);
    const lines = newContent.split('\n').filter(Boolean);
    const turns: Turn[] = [];
    const toolCallMap = new Map<string, ToolCall>();

    for (const line of lines) {
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        processRecord(record, turns, toolCallMap);
      } catch {
        // skip malformed lines
      }
    }

    return { turns, bytesRead: content.length };
  } catch {
    return { turns: [], bytesRead: 0 };
  }
}

function processRecord(
  record: Record<string, unknown>,
  turns: Turn[],
  toolCallMap: Map<string, ToolCall>,
): void {
  const msg = record['message'] as Record<string, unknown> | undefined;

  if (record['type'] === 'assistant' && msg?.['role'] === 'assistant') {
    const content = (msg['content'] as unknown[]) ?? [];
    const toolCalls: ToolCall[] = [];

    for (const item of content) {
      const block = item as Record<string, unknown>;
      if (block['type'] === 'tool_use') {
        const tc: ToolCall = {
          id: String(block['id'] ?? ''),
          name: String(block['name'] ?? ''),
          input: (block['input'] as Record<string, unknown>) ?? {},
          timestamp: String(record['timestamp'] ?? ''),
          isSidechain: Boolean(record['isSidechain']),
        };
        toolCalls.push(tc);
        toolCallMap.set(tc.id, tc);
      }
    }

    const usage = msg['usage'] as Record<string, number> | undefined;
    turns.push({
      uuid: String(record['uuid'] ?? ''),
      parentUuid: record['parentUuid'] != null ? String(record['parentUuid']) : null,
      type: 'assistant',
      timestamp: String(record['timestamp'] ?? ''),
      isSidechain: Boolean(record['isSidechain']),
      sessionId: String(record['sessionId'] ?? ''),
      model: msg['model'] != null ? String(msg['model']) : undefined,
      tokens: usage ? normalizeUsage(usage) : undefined,
      toolCalls,
    });

  } else if (record['type'] === 'user' && msg?.['role'] === 'user') {
    const content = msg['content'];
    if (!Array.isArray(content)) return;

    for (const item of content) {
      const block = item as Record<string, unknown>;
      if (block['type'] === 'tool_result') {
        const tc = toolCallMap.get(String(block['tool_use_id'] ?? ''));
        if (tc) {
          tc.result = {
            content: typeof block['content'] === 'string'
              ? block['content']
              : JSON.stringify(block['content']),
            isError: Boolean(block['is_error']),
            timestamp: String(record['timestamp'] ?? ''),
          };
          tc.durationMs = new Date(tc.result.timestamp).getTime() - new Date(tc.timestamp).getTime();
        }
      }
    }

    const isOnlyToolResults = content.every(
      (c) => (c as Record<string, unknown>)['type'] === 'tool_result',
    );
    if (!isOnlyToolResults) {
      turns.push({
        uuid: String(record['uuid'] ?? ''),
        parentUuid: record['parentUuid'] != null ? String(record['parentUuid']) : null,
        type: 'user',
        timestamp: String(record['timestamp'] ?? ''),
        isSidechain: Boolean(record['isSidechain']),
        sessionId: String(record['sessionId'] ?? ''),
      });
    }
  }
}

function normalizeUsage(u: Record<string, number>): TokenUsage {
  return {
    inputTokens: u['input_tokens'] ?? 0,
    outputTokens: u['output_tokens'] ?? 0,
    cacheReadInputTokens: u['cache_read_input_tokens'] ?? 0,
    cacheCreationInputTokens: u['cache_creation_input_tokens'] ?? 0,
  };
}

const PRICING = {
  opus:   { inputPerM: 15,  outputPerM: 75, cacheReadPerM: 1.5,  cacheWritePerM: 18.75 },
  sonnet: { inputPerM: 3,   outputPerM: 15, cacheReadPerM: 0.3,  cacheWritePerM: 3.75  },
  haiku:  { inputPerM: 0.8, outputPerM: 4,  cacheReadPerM: 0.08, cacheWritePerM: 1     },
} as const;

function getModelPricing(model: string) {
  if (model.includes('opus'))  return PRICING.opus;
  if (model.includes('haiku')) return PRICING.haiku;
  return PRICING.sonnet;
}

function addTokens(target: TokenUsage, source: TokenUsage): void {
  target.inputTokens              += source.inputTokens;
  target.outputTokens             += source.outputTokens;
  target.cacheReadInputTokens     += source.cacheReadInputTokens;
  target.cacheCreationInputTokens += source.cacheCreationInputTokens;
}

export function computeSessionStats(allTurns: Turn[], sessionId: string): SessionStats {
  const totalTokens: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
  const models: Record<string, TokenUsage> = {};
  const toolFrequency: Record<string, number> = {};
  let toolCallCount  = 0;
  let toolErrorCount = 0;

  for (const turn of allTurns) {
    if (turn.tokens) {
      addTokens(totalTokens, turn.tokens);
      if (turn.model) {
        models[turn.model] ??= { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
        addTokens(models[turn.model]!, turn.tokens);
      }
    }
    for (const tc of turn.toolCalls ?? []) {
      toolCallCount++;
      if (tc.result?.isError) toolErrorCount++;
      toolFrequency[tc.name] = (toolFrequency[tc.name] ?? 0) + 1;
    }
  }

  let estimatedCostUSD = 0;
  for (const [model, tokens] of Object.entries(models)) {
    const p = getModelPricing(model);
    estimatedCostUSD +=
      tokens.inputTokens              / 1e6 * p.inputPerM  +
      tokens.outputTokens             / 1e6 * p.outputPerM +
      tokens.cacheReadInputTokens     / 1e6 * p.cacheReadPerM +
      tokens.cacheCreationInputTokens / 1e6 * p.cacheWritePerM;
  }

  const timestamps = allTurns
    .filter(t => t.timestamp)
    .map(t => new Date(t.timestamp).getTime());
  const durationMs = timestamps.length >= 2
    ? Math.max(...timestamps) - Math.min(...timestamps)
    : 0;

  return {
    sessionId,
    totalTokens,
    estimatedCostUSD: Math.round(estimatedCostUSD * 10000) / 10000,
    toolCallCount,
    toolErrorCount,
    turnCount: allTurns.length,
    durationMs,
    models,
    toolFrequency,
    isSubagentActive: allTurns.some(t => t.isSidechain),
  };
}

export function loadGlobalStats(): GlobalStats | null {
  const statsPath = join(CLAUDE_DIR, 'stats-cache.json');
  try {
    const data = JSON.parse(readFileSync(statsPath, 'utf-8')) as Record<string, unknown>;
    const rawLongest = data['longestSession'] as Record<string, unknown> | null | undefined;
    return {
      totalSessions:    Number(data['totalSessions'] ?? 0),
      totalMessages:    Number(data['totalMessages'] ?? 0),
      dailyActivity:    ((data['dailyActivity'] as unknown[] | undefined) ?? []).slice(-30) as GlobalStats['dailyActivity'],
      modelUsage:       (data['modelUsage'] as Record<string, TokenUsage> | undefined) ?? {},
      hourCounts:       (data['hourCounts'] as Record<string, number> | undefined) ?? {},
      firstSessionDate: data['firstSessionDate'] != null ? String(data['firstSessionDate']) : '',
      longestSession:   rawLongest
        ? {
            sessionId:       String(rawLongest['sessionId']       ?? ''),
            durationMinutes: Number(rawLongest['durationMinutes'] ?? rawLongest['duration'] ?? 0),
            messageCount:    Number(rawLongest['messageCount']    ?? 0),
            timestamp:       String(rawLongest['timestamp']       ?? ''),
          }
        : null,
      dailyModelTokens: (data['dailyModelTokens'] as GlobalStats['dailyModelTokens'] | undefined) ?? [],
    };
  } catch {
    return null;
  }
}
