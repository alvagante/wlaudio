import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { CLAUDE_DIR } from './parser.js';
import type { HistoryEntry, TodoItem, Plan, ClaudeSettings, SessionMeta, SessionFacets } from './types/index.js';

export function loadHistory(): HistoryEntry[] {
  const path = join(CLAUDE_DIR, 'history.jsonl');
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .flatMap(line => {
        try {
          const entry = JSON.parse(line) as HistoryEntry;
          return entry.sessionId ? [entry] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

export function loadAllTodos(): Record<string, TodoItem[]> {
  const dir = join(CLAUDE_DIR, 'todos');
  if (!existsSync(dir)) return {};
  try {
    const result: Record<string, TodoItem[]> = {};
    readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .forEach(file => {
        const sessionId = file.split('-agent-')[0];
        if (!sessionId) return;
        try {
          const data = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
          if (Array.isArray(data) && data.length > 0) {
            result[sessionId] = [...(result[sessionId] ?? []), ...(data as TodoItem[])];
          }
        } catch {
          // skip malformed files
        }
      });
    return result;
  } catch {
    return {};
  }
}

export function loadPlans(): Plan[] {
  const dir = join(CLAUDE_DIR, 'plans');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .flatMap(f => {
        try {
          return [{ name: f.replace(/\.md$/, ''), content: readFileSync(join(dir, f), 'utf-8') }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

interface RawHookEntry {
  matcher?: string;
  hooks?: Array<{ type: string; command: string }>;
}

export function loadSettings(): ClaudeSettings | null {
  const path = join(CLAUDE_DIR, 'settings.json');
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    const hooksRaw = (raw['hooks'] as Record<string, RawHookEntry[]> | undefined) ?? {};
    const perms    = (raw['permissions'] as Record<string, string[]> | undefined) ?? {};

    const hookTypes: Record<string, number> = {};
    let hookCount = 0;
    for (const [eventType, entries] of Object.entries(hooksRaw)) {
      const count = entries.reduce((acc, e) => acc + (e.hooks?.length ?? 0), 0);
      hookTypes[eventType] = count;
      hookCount += count;
    }

    return {
      hookCount,
      hookTypes,
      allowedTools: perms['allow'] ?? [],
      deniedTools:  perms['deny']  ?? [],
    };
  } catch {
    return null;
  }
}

export function loadAllSessionMetas(): Record<string, SessionMeta> {
  const dir = join(CLAUDE_DIR, 'usage-data', 'session-meta');
  if (!existsSync(dir)) return {};
  const result: Record<string, SessionMeta> = {};
  try {
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const sessionId = f.replace(/\.json$/, '');
      try {
        const raw = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Record<string, unknown>;
        result[sessionId] = {
          sessionId,
          projectPath:            String(raw['project_path']          ?? ''),
          startTime:              String(raw['start_time']            ?? ''),
          firstPrompt:            String(raw['first_prompt']          ?? ''),
          durationMinutes:        Number(raw['duration_minutes']      ?? 0),
          userMessageCount:       Number(raw['user_message_count']    ?? 0),
          assistantMessageCount:  Number(raw['assistant_message_count'] ?? 0),
          gitCommits:             Number(raw['git_commits']           ?? 0),
          gitPushes:              Number(raw['git_pushes']            ?? 0),
          linesAdded:             Number(raw['lines_added']           ?? 0),
          linesRemoved:           Number(raw['lines_removed']         ?? 0),
          filesModified:          Number(raw['files_modified']        ?? 0),
          languages:              (raw['languages']    as Record<string, number>) ?? {},
          toolCounts:             (raw['tool_counts']  as Record<string, number>) ?? {},
          toolErrors:             Number(raw['tool_errors']           ?? 0),
          userInterruptions:      Number(raw['user_interruptions']    ?? 0),
          usesMcp:                Boolean(raw['uses_mcp']),
          usesWebSearch:          Boolean(raw['uses_web_search']),
          usesWebFetch:           Boolean(raw['uses_web_fetch']),
          usesTaskAgent:          Boolean(raw['uses_task_agent']),
          messageHours:           Array.isArray(raw['message_hours']) ? (raw['message_hours'] as number[]) : undefined,
        };
      } catch { /* skip malformed */ }
    }
  } catch { /* skip if dir missing */ }
  return result;
}

export function loadAllSessionFacets(): Record<string, SessionFacets> {
  const dir = join(CLAUDE_DIR, 'usage-data', 'facets');
  if (!existsSync(dir)) return {};
  const result: Record<string, SessionFacets> = {};
  try {
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const sessionId = f.replace(/\.json$/, '');
      try {
        const raw = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Record<string, unknown>;
        result[sessionId] = {
          underlyingGoal:        String(raw['underlying_goal']    ?? ''),
          goalCategories:        (raw['goal_categories']  as Record<string, number>) ?? {},
          outcome:               String(raw['outcome']            ?? ''),
          claudeHelpfulness:     String(raw['claude_helpfulness'] ?? ''),
          sessionType:           String(raw['session_type']       ?? ''),
          briefSummary:          String(raw['brief_summary']      ?? ''),
          primarySuccess:        String(raw['primary_success']    ?? ''),
          frictionCounts:        (raw['friction_counts']         as Record<string, number> | undefined) ?? undefined,
          frictionDetail:        raw['friction_detail'] != null ? String(raw['friction_detail']) : undefined,
          userSatisfactionCounts: (raw['user_satisfaction_counts'] as Record<string, number> | undefined) ?? undefined,
        };
      } catch { /* skip malformed */ }
    }
  } catch { /* skip if dir missing */ }
  return result;
}
