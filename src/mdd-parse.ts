// ── MDD Frontmatter Parser ────────────────────────────────────────────────────
// Isolated from src/mdd.ts to stay under the 300-line quality gate.

export interface ParsedFrontmatter {
  id: string;
  title: string;
  status: string;
  phase: string;
  lastSynced: string;
  dependsOn: string[];
  sourceFiles: string[];
  knownIssues: string[];
  body: string;
}

function parseStringList(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  return trimmed
    .split('\n')
    .map(l => l.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean);
}

export function parseMddFrontmatter(raw: string): ParsedFrontmatter {
  const defaults: ParsedFrontmatter = {
    id: '', title: '', status: '', phase: '', lastSynced: '',
    dependsOn: [], sourceFiles: [], knownIssues: [], body: '',
  };

  const parts = raw.split(/^---\s*$/m);
  if (parts.length < 3) {
    return { ...defaults, body: raw };
  }

  const fmText = parts[1] ?? '';
  const body   = parts.slice(2).join('---').trim();

  const lines = fmText.split('\n');
  const fields: Record<string, string> = {};
  let currentKey = '';
  const listAccum: Record<string, string[]> = {};

  for (const line of lines) {
    const keyVal = line.match(/^(\w[\w_-]*):\s*(.*)/);
    if (keyVal) {
      currentKey = keyVal[1] ?? '';
      const val  = (keyVal[2] ?? '').trim();
      if (val && val !== '[]' && !val.startsWith('[')) {
        fields[currentKey] = val;
      } else if (val.startsWith('[')) {
        fields[currentKey] = val;
      } else {
        listAccum[currentKey] = [];
      }
      continue;
    }
    const listItem = line.match(/^\s+-\s+(.*)/);
    if (listItem && currentKey) {
      if (!listAccum[currentKey]) listAccum[currentKey] = [];
      const item = (listItem[1] ?? '').trim();
      const arr  = listAccum[currentKey];
      if (item && arr) arr.push(item);
    }
  }

  const getList = (key: string): string[] => {
    if (listAccum[key]) return listAccum[key];
    const rawVal = fields[key];
    if (!rawVal) return [];
    return parseStringList(rawVal);
  };

  return {
    id:          fields['id']           ?? '',
    title:       fields['title']        ?? '',
    status:      fields['status']       ?? '',
    phase:       fields['phase']        ?? '',
    lastSynced:  fields['last_synced']  ?? '',
    dependsOn:   getList('depends_on'),
    sourceFiles: getList('source_files'),
    knownIssues: getList('known_issues'),
    body,
  };
}
