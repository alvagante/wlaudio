import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { CLAUDE_DIR } from './parser.js';
import type { HistoryEntry, TodoItem, Plan, ClaudeSettings } from './types/index.js';

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
