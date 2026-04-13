import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';
import type {
  MddDocSummary,
  MddAuditFile,
  MddAuditType,
  MddDriftStatus,
  MddDepEdge,
  MddDepRisk,
  MddGraph,
  MddSummary,
  MddDashboardResponse,
} from './types/index.js';
import { parseMddFrontmatter } from './mdd-parse.js';

// Re-export so consumers can import from a single entry point.
export { parseMddFrontmatter } from './mdd-parse.js';

// ── Drift classifier ──────────────────────────────────────────────────────────

interface DriftResult {
  drift: MddDriftStatus;
  driftCommitCount: number;
  driftLatestMsg: string;
}

export interface ClassifyDriftDeps {
  fileExists: (path: string) => boolean;
  runGit:     (cmd: string, cwd: string) => string;
}

const defaultDeps: ClassifyDriftDeps = {
  fileExists: (p) => existsSync(p),
  runGit: (cmd, cwd) =>
    execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }) as string,
};

export function classifyDrift(
  lastSynced: string,
  sourceFiles: string[],
  cwd: string,
  deps: ClassifyDriftDeps = defaultDeps,
): DriftResult {
  if (!lastSynced) {
    return { drift: 'untracked', driftCommitCount: 0, driftLatestMsg: '' };
  }

  const firstFile = sourceFiles[0];
  if (firstFile) {
    const absPath = resolve(cwd, firstFile);
    if (!deps.fileExists(absPath)) {
      return { drift: 'broken_ref', driftCommitCount: 0, driftLatestMsg: '' };
    }
  }

  try {
    const gitArgs = [
      'git', 'log', '--oneline',
      `--after=${lastSynced}`,
      '--',
      ...(sourceFiles.length > 0 ? sourceFiles : ['.']),
    ].join(' ');

    const output = deps.runGit(gitArgs, cwd).trim();

    if (!output) {
      return { drift: 'in_sync', driftCommitCount: 0, driftLatestMsg: '' };
    }

    const commitLines = output.split('\n').filter(Boolean);
    const latestLine  = commitLines[0] ?? '';
    const latestMsg   = latestLine.replace(/^[0-9a-f]+\s+/, '');

    return {
      drift: 'drifted',
      driftCommitCount: commitLines.length,
      driftLatestMsg: latestMsg,
    };
  } catch {
    return { drift: 'untracked', driftCommitCount: 0, driftLatestMsg: '' };
  }
}

// ── Dependency graph builder ──────────────────────────────────────────────────

export function buildMddGraph(docs: Pick<MddDocSummary, 'id' | 'status' | 'dependsOn'>[]): MddGraph {
  const docMap = new Map(docs.map(d => [d.id, d]));
  const edges: MddDepEdge[] = [];
  const hasIncoming = new Set<string>();
  const hasOutgoing = new Set<string>();

  for (const doc of docs) {
    for (const depId of doc.dependsOn) {
      hasOutgoing.add(doc.id);
      hasIncoming.add(depId);

      const target = docMap.get(depId);
      let risk: MddDepRisk = 'ok';

      if (!target || target.status === 'deprecated') {
        risk = 'broken';
      } else if (
        doc.status === 'complete' &&
        (target.status === 'draft' || target.status === 'in_progress')
      ) {
        risk = 'risky';
      }

      edges.push({ from: doc.id, to: depId, risk });
    }
  }

  const orphans = docs
    .filter(d => !hasOutgoing.has(d.id) && !hasIncoming.has(d.id))
    .map(d => d.id);

  return { edges, orphans, ascii: renderAsciiGraph(edges, orphans) };
}

function renderAsciiGraph(edges: MddDepEdge[], orphans: string[]): string {
  if (edges.length === 0 && orphans.length === 0) return '';

  const lines: string[] = [];

  if (edges.length > 0) {
    lines.push('Dependencies (A depends on → B):');
    lines.push('');
    const maxFrom = Math.max(...edges.map(e => e.from.length));
    for (const e of edges) {
      const riskTag = e.risk === 'risky' ? ' ⚠️' : e.risk === 'broken' ? ' ❌' : '';
      lines.push(`  ${e.from.padEnd(maxFrom)} ──► ${e.to}${riskTag}`);
    }
  }

  if (orphans.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('Orphans (no dependencies, no dependents):');
    for (const o of orphans) lines.push(`  ${o}`);
  }

  return lines.join('\n');
}

// ── Audit helpers ─────────────────────────────────────────────────────────────

function detectAuditType(filename: string): MddAuditType {
  if (filename.startsWith('report-'))       return 'report';
  if (filename.startsWith('scan-'))         return 'scan';
  if (filename.startsWith('flow-'))         return 'flow';
  if (filename.startsWith('notes-'))        return 'notes';
  if (filename.startsWith('results-'))      return 'results';
  if (filename.startsWith('update-notes-')) return 'update-notes';
  if (filename.startsWith('graph-'))        return 'graph';
  return 'unknown';
}

function extractDateFromFilename(filename: string): string {
  return filename.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? '';
}

// ── Main dashboard builder ────────────────────────────────────────────────────

export function buildMddDashboard(mddDir: string): MddDashboardResponse {
  const empty: MddDashboardResponse = {
    docs: [],
    audits: [],
    startup: '',
    graph: { edges: [], orphans: [], ascii: '' },
    summary: { docCount: 0, inSync: 0, drifted: 0, brokenRef: 0, untracked: 0, knownIssueCount: 0, auditCount: 0 },
  };

  if (!existsSync(mddDir)) return empty;

  const docs = readDocs(mddDir);
  const audits = readAudits(mddDir);
  const startup = readStartup(mddDir);
  const graph = buildMddGraph(docs.map(d => ({ id: d.id, status: d.status, dependsOn: d.dependsOn })));

  const summary: MddSummary = {
    docCount:        docs.length,
    inSync:          docs.filter(d => d.drift === 'in_sync').length,
    drifted:         docs.filter(d => d.drift === 'drifted').length,
    brokenRef:       docs.filter(d => d.drift === 'broken_ref').length,
    untracked:       docs.filter(d => d.drift === 'untracked').length,
    knownIssueCount: docs.reduce((sum, d) => sum + d.knownIssues.length, 0),
    auditCount:      audits.length,
  };

  return { docs, audits, startup, graph, summary };
}

function readDocs(mddDir: string): MddDocSummary[] {
  const docsDir = join(mddDir, 'docs');
  if (!existsSync(docsDir)) return [];

  let filenames: string[] = [];
  try { filenames = readdirSync(docsDir).filter(f => f.endsWith('.md') && !f.startsWith('.')); }
  catch { return []; }

  filenames.sort((a, b) => {
    const na = parseInt(a, 10) || 0;
    const nb = parseInt(b, 10) || 0;
    return na !== nb ? na - nb : a.localeCompare(b);
  });

  const docs: MddDocSummary[] = [];
  for (const filename of filenames) {
    try {
      const raw = readFileSync(join(docsDir, filename), 'utf-8');
      const fm  = parseMddFrontmatter(raw);
      const drift = classifyDrift(fm.lastSynced, fm.sourceFiles, process.cwd());
      docs.push({
        filename,
        id:               fm.id || filename.replace(/\.md$/, ''),
        title:            fm.title,
        status:           fm.status,
        phase:            fm.phase,
        lastSynced:       fm.lastSynced,
        dependsOn:        fm.dependsOn,
        sourceFiles:      fm.sourceFiles,
        knownIssues:      fm.knownIssues,
        body:             fm.body,
        drift:            drift.drift,
        driftCommitCount: drift.driftCommitCount,
        driftLatestMsg:   drift.driftLatestMsg,
      });
    } catch { /* skip unreadable */ }
  }
  return docs;
}

function readAudits(mddDir: string): MddAuditFile[] {
  const auditsDir = join(mddDir, 'audits');
  if (!existsSync(auditsDir)) return [];

  let filenames: string[] = [];
  try { filenames = readdirSync(auditsDir).filter(f => f.endsWith('.md') && !f.startsWith('.')); }
  catch { return []; }

  const audits: MddAuditFile[] = [];
  for (const filename of filenames) {
    try {
      const body = readFileSync(join(auditsDir, filename), 'utf-8');
      audits.push({ filename, date: extractDateFromFilename(filename), type: detectAuditType(filename), body });
    } catch { /* skip */ }
  }

  audits.sort((a, b) => b.date.localeCompare(a.date));
  return audits;
}

function readStartup(mddDir: string): string {
  const startupPath = join(mddDir, '.startup.md');
  if (!existsSync(startupPath)) return '';
  try { return readFileSync(startupPath, 'utf-8'); }
  catch { return ''; }
}
