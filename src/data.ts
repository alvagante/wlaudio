import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { CLAUDE_DIR } from './parser.js';
import type { HistoryEntry, TodoItem, Plan, ClaudeSettings, SessionMeta, SessionFacets, SettingsConfig, ProjectConfig, PluginEntry, ConfigsData, HookEntry } from './types/index.js';

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

/** Return stub metas for JSONL sessions that have no session-meta file.
 *  Reads just the first line of each JSONL to get the `cwd` field.
 *  @param claudeDir - override for testing; defaults to CLAUDE_DIR */
export function loadOrphanSessionMetas(knownIds: Set<string>, claudeDir = CLAUDE_DIR): Record<string, SessionMeta> {
  const projectsDir = join(claudeDir, 'projects');
  if (!existsSync(projectsDir)) return {};
  const result: Record<string, SessionMeta> = {};

  try {
    for (const encodedProject of readdirSync(projectsDir)) {
      const projectDir = join(projectsDir, encodedProject);
      let jsonlFiles: string[];
      try {
        jsonlFiles = readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
      } catch { continue; }

      for (const jsonlFile of jsonlFiles) {
        const sessionId = jsonlFile.replace(/\.jsonl$/, '');
        if (knownIds.has(sessionId)) continue;

        // Read first few lines to find cwd
        let projectPath = '';
        try {
          const content = readFileSync(join(projectDir, jsonlFile), 'utf-8');
          for (const line of content.split('\n').slice(0, 20)) {
            if (!line.trim()) continue;
            try {
              const rec = JSON.parse(line) as Record<string, unknown>;
              if (typeof rec['cwd'] === 'string' && rec['cwd']) {
                projectPath = rec['cwd'];
                break;
              }
            } catch { /* skip */ }
          }
        } catch { continue; }

        if (!projectPath) continue;

        result[sessionId] = {
          sessionId,
          projectPath,
          startTime: '',
          firstPrompt: '',
          durationMinutes: 0,
          userMessageCount: 0,
          assistantMessageCount: 0,
          gitCommits: 0,
          gitPushes: 0,
          linesAdded: 0,
          linesRemoved: 0,
          filesModified: 0,
          languages: {},
          toolCounts: {},
          toolErrors: 0,
          userInterruptions: 0,
          usesMcp: false,
          usesWebSearch: false,
          usesWebFetch: false,
          usesTaskAgent: false,
        };
      }
    }
  } catch { /* skip */ }

  return result;
}

// ── Configs ────────────────────────────────────────────────────────────────

function parseSettingsFile(path: string): SettingsConfig | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    const hooksRaw = (raw['hooks'] as Record<string, unknown[]> | undefined) ?? {};
    const perms    = (raw['permissions'] as Record<string, string[]> | undefined) ?? {};

    const hooks: Record<string, HookEntry[]> = {};
    for (const [event, entries] of Object.entries(hooksRaw)) {
      hooks[event] = (entries as Record<string, unknown>[]).map(e => ({
        matcher: String(e['matcher'] ?? '*'),
        hooks: ((e['hooks'] as Record<string, unknown>[] | undefined) ?? []).map(h => ({
          type:    String(h['type']    ?? 'command'),
          command: String(h['command'] ?? ''),
        })),
      }));
    }

    const mcpServers = (raw['mcpServers'] as Record<string, unknown> | undefined) ?? {};

    return {
      hooks,
      allow: perms['allow'] ?? [],
      deny:  perms['deny']  ?? [],
      mcpServers,
    };
  } catch {
    return null;
  }
}

function readFileSafe(path: string): string | null {
  if (!existsSync(path)) return null;
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

export function loadConfigs(): ConfigsData {
  const global         = parseSettingsFile(join(CLAUDE_DIR, 'settings.json'));
  const globalClaudeMd = readFileSafe(join(CLAUDE_DIR, 'CLAUDE.md'));

  // Plugins
  let plugins: PluginEntry[] = [];
  try {
    const raw = JSON.parse(readFileSync(join(CLAUDE_DIR, 'plugins', 'blocklist.json'), 'utf-8')) as Record<string, unknown>;
    plugins = ((raw['plugins'] as PluginEntry[] | undefined) ?? []);
  } catch { /* no plugins file */ }

  // Per-project configs: derive unique project paths from session-meta
  const metaDir = join(CLAUDE_DIR, 'usage-data', 'session-meta');
  const projectPaths = new Set<string>();
  if (existsSync(metaDir)) {
    for (const f of readdirSync(metaDir).filter(f => f.endsWith('.json'))) {
      try {
        const m = JSON.parse(readFileSync(join(metaDir, f), 'utf-8')) as Record<string, unknown>;
        const p = String(m['project_path'] ?? '').trim();
        if (p) projectPaths.add(p);
      } catch { /* skip */ }
    }
  }

  const projects: ProjectConfig[] = [...projectPaths]
    .sort()
    .map(projectPath => {
      const projectName = projectPath.split('/').filter(Boolean).pop() ?? projectPath;
      return {
        projectPath,
        projectName,
        settings:      parseSettingsFile(join(projectPath, '.claude', 'settings.json')),
        claudeMd:      readFileSafe(join(projectPath, 'CLAUDE.md'))
                    ?? readFileSafe(join(projectPath, '.claude', 'CLAUDE.md')),
        localClaudeMd: readFileSafe(join(projectPath, 'CLAUDE.local.md'))
                    ?? readFileSafe(join(projectPath, '.claude', 'CLAUDE.local.md')),
      };
    })
    .filter(p => p.settings !== null || p.claudeMd !== null);

  return { global, globalClaudeMd, projects, plugins };
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
