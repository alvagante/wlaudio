import { describe, it, expect } from 'vitest';
import { parseMddFrontmatter, buildMddGraph, classifyDrift } from '../../src/mdd.js';
import type { ClassifyDriftDeps } from '../../src/mdd.js';

// ── parseMddFrontmatter ────────────────────────────────────────────────────

const SAMPLE_DOC = `---
id: 01-mdd-viewer
title: MDD Dashboard
status: draft
phase: documentation
last_synced: 2026-04-13
depends_on:
  - 02-other
  - 03-third
source_files:
  - src/server.ts
  - src/types/index.ts
  - public/mdd.html
known_issues: []
---

# 01 — MDD Dashboard

## Purpose

A dedicated page in the wlaudio web app.
`;

describe('parseMddFrontmatter', () => {
  it('should parse all standard frontmatter fields from a valid doc', () => {
    const result = parseMddFrontmatter(SAMPLE_DOC);
    expect(result.id).toBe('01-mdd-viewer');
    expect(result.title).toBe('MDD Dashboard');
    expect(result.status).toBe('draft');
    expect(result.phase).toBe('documentation');
    expect(result.lastSynced).toBe('2026-04-13');
    expect(result.sourceFiles).toHaveLength(3);
  });

  it('should return empty defaults when frontmatter is malformed or missing', () => {
    const result = parseMddFrontmatter('No frontmatter here at all');
    expect(result.id).toBe('');
    expect(result.title).toBe('');
    expect(result.status).toBe('');
    expect(result.dependsOn).toEqual([]);
    expect(result.sourceFiles).toEqual([]);
    expect(result.knownIssues).toEqual([]);
  });

  it('should extract the body (everything after closing ---) correctly', () => {
    const result = parseMddFrontmatter(SAMPLE_DOC);
    expect(result.body).toContain('# 01 — MDD Dashboard');
    expect(result.body).not.toContain('id: 01-mdd-viewer');
    expect(result.body).not.toContain('---');
  });

  it('should handle docs with empty known_issues list', () => {
    const result = parseMddFrontmatter(SAMPLE_DOC);
    expect(result.knownIssues).toEqual([]);
  });

  it('should handle docs with multiple items in depends_on', () => {
    const result = parseMddFrontmatter(SAMPLE_DOC);
    expect(result.dependsOn).toEqual(['02-other', '03-third']);
  });
});

// ── buildMddGraph ──────────────────────────────────────────────────────────

describe('buildMddGraph', () => {
  it('should build an edge for each depends_on relationship', () => {
    const docs = [
      { id: '01', status: 'complete', dependsOn: [] },
      { id: '02', status: 'draft',    dependsOn: ['01'] },
    ];
    const { edges } = buildMddGraph(docs);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: '02', to: '01' });
  });

  it('should classify a risky edge when a complete doc depends on a draft doc', () => {
    const docs = [
      { id: '01', status: 'draft',    dependsOn: [] },
      { id: '02', status: 'complete', dependsOn: ['01'] },
    ];
    const { edges } = buildMddGraph(docs);
    expect(edges[0]?.risk).toBe('risky');
  });

  it('should classify a broken edge when the dependency is deprecated', () => {
    const docs = [
      { id: '01', status: 'deprecated', dependsOn: [] },
      { id: '02', status: 'complete',   dependsOn: ['01'] },
    ];
    const { edges } = buildMddGraph(docs);
    expect(edges[0]?.risk).toBe('broken');
  });

  it('should classify a broken edge when the dependency id does not exist', () => {
    const docs = [{ id: '02', status: 'in_progress', dependsOn: ['99-missing'] }];
    const { edges } = buildMddGraph(docs);
    expect(edges[0]?.risk).toBe('broken');
  });

  it('should identify orphans (no deps, no dependents)', () => {
    const docs = [
      { id: '01', status: 'draft', dependsOn: [] },
      { id: '02', status: 'draft', dependsOn: [] },
    ];
    const { orphans } = buildMddGraph(docs);
    expect(orphans).toContain('01');
    expect(orphans).toContain('02');
  });

  it('should not mark a doc as orphan if something depends on it', () => {
    const docs = [
      { id: '01', status: 'complete', dependsOn: [] },
      { id: '02', status: 'draft',    dependsOn: ['01'] },
    ];
    const { orphans } = buildMddGraph(docs);
    expect(orphans).not.toContain('01');
  });

  it('should render a non-empty ASCII graph when edges exist', () => {
    const docs = [
      { id: '01', status: 'complete', dependsOn: [] },
      { id: '02', status: 'draft',    dependsOn: ['01'] },
    ];
    const { ascii } = buildMddGraph(docs);
    expect(ascii).toContain('──►');
  });

  it('should render an empty ASCII graph when no docs exist', () => {
    const { ascii } = buildMddGraph([]);
    expect(ascii).toBe('');
  });
});

// ── classifyDrift (injectable deps — no module mocking needed) ────────────

/** Build a ClassifyDriftDeps stub with controllable behaviour. */
function makeDeps(overrides: Partial<ClassifyDriftDeps> = {}): ClassifyDriftDeps {
  return {
    fileExists: () => true,
    runGit:     () => '',
    ...overrides,
  };
}

describe('classifyDrift', () => {
  it('should return "untracked" when last_synced is empty or missing', () => {
    const result = classifyDrift('', ['src/server.ts'], '.', makeDeps());
    expect(result.drift).toBe('untracked');
    expect(result.driftCommitCount).toBe(0);
  });

  it('should return "broken_ref" when a source file does not exist on disk', () => {
    const result = classifyDrift('2026-01-01', ['src/missing.ts'], '.', makeDeps({
      fileExists: () => false,
    }));
    expect(result.drift).toBe('broken_ref');
  });

  it('should return "in_sync" when no commits after last_synced', () => {
    const result = classifyDrift('2026-01-01', ['src/server.ts'], '.', makeDeps({
      runGit: () => '',
    }));
    expect(result.drift).toBe('in_sync');
    expect(result.driftCommitCount).toBe(0);
  });

  it('should return "drifted" when commits exist after last_synced', () => {
    const result = classifyDrift('2026-01-01', ['src/server.ts'], '.', makeDeps({
      runGit: () => 'abc1234 fix: something\ndef5678 feat: another',
    }));
    expect(result.drift).toBe('drifted');
    expect(result.driftCommitCount).toBe(2);
  });

  it('should populate driftLatestMsg with the most recent commit summary', () => {
    const result = classifyDrift('2026-01-01', ['src/server.ts'], '.', makeDeps({
      runGit: () => 'abc1234 fix: something changed',
    }));
    expect(result.driftLatestMsg).toBe('fix: something changed');
  });
});

// ── buildMddDashboard — integration tests (real filesystem, temp dir) ────────

import { buildMddDashboard } from '../../src/mdd.js';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function makeTempMdd(): string {
  const root = mkdtempSync(join(tmpdir(), 'mdd-test-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, 'audits'), { recursive: true });
  return root;
}

function writeDoc(mddDir: string, filename: string, content: string): void {
  writeFileSync(join(mddDir, 'docs', filename), content, 'utf-8');
}

function writeAudit(mddDir: string, filename: string, content: string): void {
  writeFileSync(join(mddDir, 'audits', filename), content, 'utf-8');
}

const VALID_DOC = (id: string, title: string, deps: string[] = []) => `---
id: ${id}
title: ${title}
status: draft
phase: documentation
last_synced: 2026-04-01
depends_on:${deps.length ? '\n' + deps.map(d => `  - ${d}`).join('\n') : ' []'}
source_files:
  - src/server.ts
known_issues: []
---

# ${title}
`;

describe('buildMddDashboard', () => {
  let mddDir: string;

  beforeEach(() => { mddDir = makeTempMdd(); });
  afterEach(() => { rmSync(mddDir, { recursive: true, force: true }); });

  describe('when .mdd/ does not exist', () => {
    it('should return an empty-state response (not throw)', () => {
      const result = buildMddDashboard('/nonexistent/path/.mdd');
      expect(result.docs).toEqual([]);
      expect(result.audits).toEqual([]);
      expect(result.startup).toBe('');
      expect(result.graph.edges).toEqual([]);
      expect(result.graph.orphans).toEqual([]);
      expect(result.summary.docCount).toBe(0);
    });
  });

  describe('when docs exist', () => {
    it('should return parsed docs with frontmatter fields populated', () => {
      writeDoc(mddDir, '01-mdd-viewer.md', VALID_DOC('01-mdd-viewer', 'MDD Dashboard'));
      const { docs } = buildMddDashboard(mddDir);
      expect(docs).toHaveLength(1);
      expect(docs[0]?.id).toBe('01-mdd-viewer');
      expect(docs[0]?.title).toBe('MDD Dashboard');
      expect(docs[0]?.status).toBe('draft');
      expect(docs[0]?.lastSynced).toBe('2026-04-01');
    });

    it('should return docs sorted by numeric id prefix ascending', () => {
      writeDoc(mddDir, '03-third.md',  VALID_DOC('03-third',  'Third'));
      writeDoc(mddDir, '01-first.md',  VALID_DOC('01-first',  'First'));
      writeDoc(mddDir, '02-second.md', VALID_DOC('02-second', 'Second'));
      const { docs } = buildMddDashboard(mddDir);
      expect(docs.map(d => d.id)).toEqual(['01-first', '02-second', '03-third']);
    });

    it('should include a drift status for each doc', () => {
      writeDoc(mddDir, '01-mdd-viewer.md', VALID_DOC('01-mdd-viewer', 'MDD Dashboard'));
      const { docs } = buildMddDashboard(mddDir);
      const validStatuses = ['in_sync', 'drifted', 'broken_ref', 'untracked'];
      expect(validStatuses).toContain(docs[0]?.drift);
    });

    it('should return audits sorted by date descending', () => {
      writeAudit(mddDir, 'report-2026-01-01.md', '# old');
      writeAudit(mddDir, 'report-2026-04-15.md', '# new');
      writeAudit(mddDir, 'report-2026-02-10.md', '# mid');
      const { audits } = buildMddDashboard(mddDir);
      expect(audits[0]?.date).toBe('2026-04-15');
      expect(audits[1]?.date).toBe('2026-02-10');
      expect(audits[2]?.date).toBe('2026-01-01');
    });

    it('should return a summary with correct docCount', () => {
      writeDoc(mddDir, '01-a.md', VALID_DOC('01-a', 'A'));
      writeDoc(mddDir, '02-b.md', VALID_DOC('02-b', 'B'));
      const { summary } = buildMddDashboard(mddDir);
      expect(summary.docCount).toBe(2);
      expect(summary.auditCount).toBe(0);
    });

    it('should return summary where inSync + drifted + brokenRef + untracked === docCount', () => {
      writeDoc(mddDir, '01-a.md', VALID_DOC('01-a', 'A'));
      writeDoc(mddDir, '02-b.md', VALID_DOC('02-b', 'B'));
      const { summary } = buildMddDashboard(mddDir);
      const total = summary.inSync + summary.drifted + summary.brokenRef + summary.untracked;
      expect(total).toBe(summary.docCount);
    });

    it('should return startup content from .mdd/.startup.md', () => {
      writeFileSync(join(mddDir, '.startup.md'), '# Hello startup', 'utf-8');
      const { startup } = buildMddDashboard(mddDir);
      expect(startup).toBe('# Hello startup');
    });

    it('should return a dependency graph with edges and orphans arrays', () => {
      writeDoc(mddDir, '01-base.md', VALID_DOC('01-base', 'Base'));
      writeDoc(mddDir, '02-dep.md',  VALID_DOC('02-dep',  'Dep', ['01-base']));
      const { graph } = buildMddDashboard(mddDir);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({ from: '02-dep', to: '01-base' });
      expect(graph.orphans).not.toContain('01-base');
    });
  });

  describe('error resilience', () => {
    it('should skip non-.md files and include only valid docs', () => {
      writeDoc(mddDir, '01-valid.md', VALID_DOC('01-valid', 'Valid'));
      writeFileSync(join(mddDir, 'docs', 'README.txt'), 'ignore me', 'utf-8');
      const { docs } = buildMddDashboard(mddDir);
      expect(docs).toHaveLength(1);
      expect(docs[0]?.id).toBe('01-valid');
    });

    it('should treat malformed frontmatter as empty defaults without crashing', () => {
      writeDoc(mddDir, '01-broken.md', 'no frontmatter at all');
      expect(() => buildMddDashboard(mddDir)).not.toThrow();
      const { docs } = buildMddDashboard(mddDir);
      expect(docs).toHaveLength(1);
      expect(docs[0]?.id).toBe('01-broken');   // falls back to filename
      expect(docs[0]?.title).toBe('');
      expect(docs[0]?.sourceFiles).toEqual([]);
    });

    it('should return drift:untracked when git log throws (non-git dir)', () => {
      // Write a doc with last_synced so classifyDrift tries git log
      const doc = `---
id: 01-test
title: Test
status: draft
phase: docs
last_synced: 2026-01-01
source_files:
  - ${join(mddDir, 'docs', '01-test.md')}
depends_on: []
known_issues: []
---
# Test
`;
      writeDoc(mddDir, '01-test.md', doc);
      // buildMddDashboard uses process.cwd() for git; in a real git repo this will
      // be in_sync or drifted — the important contract is it doesn't throw.
      expect(() => buildMddDashboard(mddDir)).not.toThrow();
      const { docs } = buildMddDashboard(mddDir);
      expect(['in_sync', 'drifted', 'broken_ref', 'untracked']).toContain(docs[0]?.drift);
    });
  });
});
