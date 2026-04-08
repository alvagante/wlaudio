import { describe, it, expect } from 'vitest';
import { encodePath, computeSessionStats } from '../../src/parser.js';
import type { Turn } from '../../src/types/index.js';

describe('encodePath', () => {
  it('replaces leading slash with dash', () => {
    expect(encodePath('/Users/al/projects/foo')).toBe('-Users-al-projects-foo');
  });

  it('handles path with no slashes', () => {
    expect(encodePath('foo')).toBe('foo');
  });

  it('handles empty string', () => {
    expect(encodePath('')).toBe('');
  });

  it('replaces dots with dashes (e.g. www.lab42.it)', () => {
    expect(encodePath('/Users/al/Documents/GITHUB/www.lab42.it')).toBe('-Users-al-Documents-GITHUB-www-lab42-it');
  });

  it('replaces @ with dashes (e.g. Google Drive paths)', () => {
    expect(encodePath('/Users/al/Library/CloudStorage/GoogleDrive-al@lab42.it/My Drive/LAB42')).toBe('-Users-al-Library-CloudStorage-GoogleDrive-al-lab42-it-My-Drive-LAB42');
  });

  it('replaces spaces with dashes', () => {
    expect(encodePath('/Users/al/My Projects/foo bar')).toBe('-Users-al-My-Projects-foo-bar');
  });

  it('preserves existing hyphens', () => {
    expect(encodePath('/Users/al/my-project')).toBe('-Users-al-my-project');
  });
});

describe('computeSessionStats', () => {
  const sessionId = 'test-session-1';

  it('returns zero stats for empty turns', () => {
    const stats = computeSessionStats([], sessionId);
    expect(stats.sessionId).toBe(sessionId);
    expect(stats.toolCallCount).toBe(0);
    expect(stats.toolErrorCount).toBe(0);
    expect(stats.turnCount).toBe(0);
    expect(stats.estimatedCostUSD).toBe(0);
    expect(stats.durationMs).toBe(0);
    expect(stats.totalTokens.inputTokens).toBe(0);
    expect(stats.totalTokens.outputTokens).toBe(0);
  });

  it('accumulates token counts across turns', () => {
    const turns: Turn[] = [
      {
        uuid: 'a', parentUuid: null, type: 'assistant',
        timestamp: '2024-01-01T10:00:00Z', isSidechain: false, sessionId,
        model: 'claude-sonnet-4',
        tokens: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        toolCalls: [],
      },
      {
        uuid: 'b', parentUuid: 'a', type: 'assistant',
        timestamp: '2024-01-01T10:01:00Z', isSidechain: false, sessionId,
        model: 'claude-sonnet-4',
        tokens: { inputTokens: 200, outputTokens: 80, cacheReadInputTokens: 500, cacheCreationInputTokens: 0 },
        toolCalls: [],
      },
    ];

    const stats = computeSessionStats(turns, sessionId);
    expect(stats.totalTokens.inputTokens).toBe(300);
    expect(stats.totalTokens.outputTokens).toBe(130);
    expect(stats.totalTokens.cacheReadInputTokens).toBe(500);
    expect(stats.turnCount).toBe(2);
  });

  it('computes duration from first to last timestamp', () => {
    const turns: Turn[] = [
      {
        uuid: 'a', parentUuid: null, type: 'assistant',
        timestamp: '2024-01-01T10:00:00Z', isSidechain: false, sessionId,
        toolCalls: [],
      },
      {
        uuid: 'b', parentUuid: 'a', type: 'user',
        timestamp: '2024-01-01T10:05:00Z', isSidechain: false, sessionId,
      },
    ];

    const stats = computeSessionStats(turns, sessionId);
    expect(stats.durationMs).toBe(5 * 60 * 1000);
  });

  it('counts tool calls and errors', () => {
    const turns: Turn[] = [
      {
        uuid: 'a', parentUuid: null, type: 'assistant',
        timestamp: '2024-01-01T10:00:00Z', isSidechain: false, sessionId,
        toolCalls: [
          { id: '1', name: 'Read', input: {}, timestamp: '2024-01-01T10:00:00Z', isSidechain: false,
            result: { content: 'ok', isError: false, timestamp: '2024-01-01T10:00:01Z' } },
          { id: '2', name: 'Bash', input: {}, timestamp: '2024-01-01T10:00:01Z', isSidechain: false,
            result: { content: 'err', isError: true, timestamp: '2024-01-01T10:00:02Z' } },
        ],
      },
    ];

    const stats = computeSessionStats(turns, sessionId);
    expect(stats.toolCallCount).toBe(2);
    expect(stats.toolErrorCount).toBe(1);
    expect(stats.toolFrequency['Read']).toBe(1);
    expect(stats.toolFrequency['Bash']).toBe(1);
  });

  it('uses sonnet pricing when model is unknown', () => {
    const turns: Turn[] = [
      {
        uuid: 'a', parentUuid: null, type: 'assistant',
        timestamp: '2024-01-01T10:00:00Z', isSidechain: false, sessionId,
        model: 'claude-unknown-model',
        tokens: { inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        toolCalls: [],
      },
    ];
    const stats = computeSessionStats(turns, sessionId);
    expect(stats.estimatedCostUSD).toBeCloseTo(3.0, 4); // sonnet: $3/M input
  });

  it('uses opus pricing for opus model', () => {
    const turns: Turn[] = [
      {
        uuid: 'a', parentUuid: null, type: 'assistant',
        timestamp: '2024-01-01T10:00:00Z', isSidechain: false, sessionId,
        model: 'claude-opus-4',
        tokens: { inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        toolCalls: [],
      },
    ];
    const stats = computeSessionStats(turns, sessionId);
    expect(stats.estimatedCostUSD).toBeCloseTo(15.0, 4); // opus: $15/M input
  });

  it('uses haiku pricing for haiku model', () => {
    const turns: Turn[] = [
      {
        uuid: 'a', parentUuid: null, type: 'assistant',
        timestamp: '2024-01-01T10:00:00Z', isSidechain: false, sessionId,
        model: 'claude-haiku-4',
        tokens: { inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        toolCalls: [],
      },
    ];
    const stats = computeSessionStats(turns, sessionId);
    expect(stats.estimatedCostUSD).toBeCloseTo(0.8, 4); // haiku: $0.80/M input
  });

  it('detects active sidechain', () => {
    const turns: Turn[] = [
      {
        uuid: 'a', parentUuid: null, type: 'assistant',
        timestamp: '2024-01-01T10:00:00Z', isSidechain: true, sessionId,
        toolCalls: [],
      },
    ];
    const stats = computeSessionStats(turns, sessionId);
    expect(stats.isSubagentActive).toBe(true);
  });
});
