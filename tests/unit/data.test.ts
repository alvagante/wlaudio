import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadOrphanSessionMetas } from '../../src/data.js';

const TMP = join(tmpdir(), `wlaudio-test-${process.pid}`);
const PROJECTS_DIR = join(TMP, 'projects');
const PROJECT_DIR = join(PROJECTS_DIR, '-Users-test-myproject');

describe('loadOrphanSessionMetas', () => {
  beforeEach(() => {
    mkdirSync(PROJECT_DIR, { recursive: true });
    const line = JSON.stringify({ type: 'system', cwd: '/Users/test/myproject', timestamp: '2024-01-01T10:00:00Z' });
    writeFileSync(join(PROJECT_DIR, 'session-aaa.jsonl'), line + '\n');
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('discovers sessions without meta files', () => {
    const result = loadOrphanSessionMetas(new Set(), TMP);
    expect(Object.keys(result)).toContain('session-aaa');
    expect(result['session-aaa']?.projectPath).toBe('/Users/test/myproject');
  });

  it('skips sessions already in knownIds', () => {
    const result = loadOrphanSessionMetas(new Set(['session-aaa']), TMP);
    expect(Object.keys(result)).not.toContain('session-aaa');
  });

  it('returns stub with zeroed numeric fields', () => {
    const result = loadOrphanSessionMetas(new Set(), TMP);
    const meta = result['session-aaa'];
    expect(meta).toBeDefined();
    expect(meta?.durationMinutes).toBe(0);
    expect(meta?.gitCommits).toBe(0);
    expect(meta?.linesAdded).toBe(0);
    expect(meta?.toolErrors).toBe(0);
  });

  it('skips JSONL with no cwd field', () => {
    writeFileSync(
      join(PROJECT_DIR, 'session-bbb.jsonl'),
      JSON.stringify({ type: 'system', timestamp: '2024-01-01T10:00:00Z' }) + '\n',
    );
    const result = loadOrphanSessionMetas(new Set(), TMP);
    expect(Object.keys(result)).not.toContain('session-bbb');
  });

  it('returns empty object when projects dir does not exist', () => {
    const result = loadOrphanSessionMetas(new Set(), '/nonexistent/path');
    expect(result).toEqual({});
  });
});
