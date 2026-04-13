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

// ── GET /api/v1/mdd — integration tests (skipped in unit mode) ────────────

describe.skip('GET /api/v1/mdd', () => {
  describe('when .mdd/ does not exist', () => {
    it('should return 200 with an empty-state response (not 404)', async () => {});
  });
  describe('when docs exist', () => {
    it('should return parsed docs with frontmatter fields populated', async () => {});
    it('should return docs sorted by numeric id prefix ascending', async () => {});
    it('should include drift status for each doc', async () => {});
    it('should return audits sorted by date descending', async () => {});
    it('should return a summary with correct docCount', async () => {});
    it('should return summary inSync + drifted + brokenRef + untracked === docCount', async () => {});
    it('should return startup content from .mdd/.startup.md', async () => {});
    it('should return a dependency graph with edges and orphans arrays', async () => {});
  });
  describe('error resilience', () => {
    it('should skip unreadable files and include the rest', async () => {});
    it('should treat malformed frontmatter as empty defaults (not crash)', async () => {});
    it('should return drift:untracked (not crash) when not in a git repository', async () => {});
  });
});
