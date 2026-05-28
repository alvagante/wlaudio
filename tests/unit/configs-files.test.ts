import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadClaudeFilesForDir } from '../../src/data.js';

const TMP = join(tmpdir(), `wlaudio-cfg-test-${process.pid}`);

describe('loadClaudeFilesForDir', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('returns files from a subdirectory with correct fields', () => {
    const dir = join(TMP, 'commands');
    mkdirSync(dir);
    writeFileSync(join(dir, 'mdd.md'), '# MDD command\nsome content');

    const result = loadClaudeFilesForDir(TMP, 'commands');

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('mdd.md');
    expect(result[0]?.dir).toBe('commands');
    expect(result[0]?.content).toContain('MDD command');
    expect(result[0]?.path).toContain('commands/mdd.md');
  });

  it('returns multiple files sorted by name', () => {
    const dir = join(TMP, 'hooks');
    mkdirSync(dir);
    writeFileSync(join(dir, 'z-hook.sh'), '#!/bin/bash\necho z');
    writeFileSync(join(dir, 'a-hook.sh'), '#!/bin/bash\necho a');

    const result = loadClaudeFilesForDir(TMP, 'hooks');

    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe('a-hook.sh');
    expect(result[1]?.name).toBe('z-hook.sh');
  });

  it('returns empty array when subdirectory does not exist', () => {
    const result = loadClaudeFilesForDir(TMP, 'agents');
    expect(result).toEqual([]);
  });

  it('returns empty array when claudeDir does not exist', () => {
    const result = loadClaudeFilesForDir('/nonexistent/path/.claude', 'commands');
    expect(result).toEqual([]);
  });

  it('skips files larger than 512 KB', () => {
    const dir = join(TMP, 'skills');
    mkdirSync(dir);
    writeFileSync(join(dir, 'small.md'), 'small content');
    writeFileSync(join(dir, 'huge.md'), 'x'.repeat(513 * 1024));

    const result = loadClaudeFilesForDir(TMP, 'skills');

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('small.md');
  });

  it('handles all supported dir types', () => {
    for (const dirName of ['agents', 'commands', 'hooks', 'skills'] as const) {
      const dir = join(TMP, dirName);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `test.md`), `content for ${dirName}`);

      const result = loadClaudeFilesForDir(TMP, dirName);

      expect(result[0]?.dir).toBe(dirName);
      expect(result[0]?.content).toContain(dirName);
    }
  });
});
