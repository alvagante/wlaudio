// ── Shared formatting helpers ──────────────────────────────────────────────

export const TAG_COLORS = {
  Read:1, Write:1, Edit:1, Bash:1, Grep:1, Glob:1,
  Agent:1, WebFetch:1, WebSearch:1,
};

export function projectName(cwd) {
  return cwd.split('/').filter(Boolean).pop() ?? cwd;
}

export function shortModel(m) {
  if (m.includes('opus'))   return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku'))  return 'haiku';
  return m.split('-').slice(-2).join('-');
}

export function totalTokenCount(t) {
  return t.inputTokens + t.outputTokens + t.cacheReadInputTokens + t.cacheCreationInputTokens;
}

export function fmtTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function fmtDuration(ms) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function fmtMs(ms) {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  if (ms >= 1000)  return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

export function timeAgo(ts) {
  const ms = Date.now() - ts;
  const s  = Math.floor(ms / 1000);
  const m  = Math.floor(s / 60);
  const h  = Math.floor(m / 60);
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function fmtTimestamp(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en', {
    hour12: false, month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function fmtToolInput(name, input) {
  const shortPath = (p) => {
    const parts = p.split('/').filter(Boolean);
    return parts.length > 3 ? '…/' + parts.slice(-2).join('/') : p;
  };
  switch (name) {
    case 'Read':      return input.file_path  ? shortPath(String(input.file_path))  : '';
    case 'Write':     return input.file_path  ? shortPath(String(input.file_path))  : '';
    case 'Edit':      return input.file_path  ? shortPath(String(input.file_path))  : '';
    case 'Bash':      return String(input.command ?? '').slice(0, 72);
    case 'Grep':      return `"${input.pattern ?? ''}" ${input.path ?? ''}`;
    case 'Glob':      return String(input.pattern ?? '');
    case 'Agent':     return String(input.description ?? input.prompt ?? '').slice(0, 60);
    case 'WebFetch':  return String(input.url ?? '');
    case 'WebSearch': return String(input.query ?? '');
    default:          return JSON.stringify(input).slice(0, 60);
  }
}

export function toolColor(name) {
  const map = {
    Read:'#89b4fa', Write:'#a6e3a1', Edit:'#f9e2af', Bash:'#fab387',
    Grep:'#94e2d5', Glob:'#94e2d5', Agent:'#cba6f7',
    WebFetch:'#f5c2e7', WebSearch:'#f5c2e7',
  };
  return map[name] ?? '#585b70';
}

export function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
