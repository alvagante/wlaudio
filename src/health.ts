import type { TodoItem, ProjectHealth } from './types/index.js';

export interface HealthInput {
  totalToolCalls: number;
  totalToolErrors: number;
  outcomeCounts: Record<string, number>;
  helpfulnessCounts: Record<string, number>;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  estimatedCostUSD: number;
}

const OUTCOME_WEIGHTS: Record<string, number> = {
  achieved:           1.00,
  mostly_achieved:    0.75,
  partially_achieved: 0.40,
  not_achieved:       0.00,
};

const HELP_WEIGHTS: Record<string, number> = {
  very_helpful:     1.00,
  helpful:          0.75,
  somewhat_helpful: 0.40,
  not_helpful:      0.00,
};

export function computeProjectHealth(data: HealthInput, todos: TodoItem[]): ProjectHealth {
  // ── Tool error rate (25%) ─────────────────────────────────────────────────
  const errorRate      = data.totalToolCalls > 0 ? data.totalToolErrors / data.totalToolCalls : 0;
  const toolErrorScore = Math.max(0, 100 - errorRate * 500);

  // ── Outcome quality (30%) ─────────────────────────────────────────────────
  let outcomeTotal = 0;
  let outcomeCount = 0;
  for (const [outcome, count] of Object.entries(data.outcomeCounts)) {
    const weight = OUTCOME_WEIGHTS[outcome] ?? 0.5;
    outcomeTotal += weight * count;
    outcomeCount += count;
  }
  const outcomeScore = outcomeCount > 0 ? (outcomeTotal / outcomeCount) * 100 : 50;

  // ── Todo completion (20%) ─────────────────────────────────────────────────
  let todoScore = 50;
  if (todos.length > 0) {
    const completed = todos.filter(t => t.status === 'completed').length;
    todoScore = (completed / todos.length) * 100;
  }

  // ── Cost efficiency (15%) ─────────────────────────────────────────────────
  // lines changed per dollar — log-normalized; neutral 50 when no cost data
  let efficiencyScore = 50;
  if (data.estimatedCostUSD > 0) {
    const linesPerDollar = (data.totalLinesAdded + data.totalLinesRemoved) /
      Math.max(data.estimatedCostUSD, 0.001);
    // 1000 lines/dollar → score 100; log10 scale
    const normalized = Math.log10(Math.max(linesPerDollar, 1)) / Math.log10(1000);
    efficiencyScore  = Math.min(100, Math.max(0, normalized * 100));
  }

  // ── Helpfulness (10%) ────────────────────────────────────────────────────
  let helpTotal = 0;
  let helpCount = 0;
  for (const [level, count] of Object.entries(data.helpfulnessCounts)) {
    const weight = HELP_WEIGHTS[level] ?? 0.5;
    helpTotal += weight * count;
    helpCount += count;
  }
  const helpScore = helpCount > 0 ? (helpTotal / helpCount) * 100 : 50;

  // ── Composite ─────────────────────────────────────────────────────────────
  const score = Math.round(
    toolErrorScore  * 0.25 +
    outcomeScore    * 0.30 +
    todoScore       * 0.20 +
    efficiencyScore * 0.15 +
    helpScore       * 0.10,
  );

  const grade =
    score >= 90 ? 'A' :
    score >= 75 ? 'B' :
    score >= 60 ? 'C' :
    score >= 45 ? 'D' : 'F';

  return {
    score,
    grade,
    breakdown: {
      toolErrorRate:  Math.round(toolErrorScore),
      outcomeQuality: Math.round(outcomeScore),
      todoCompletion: Math.round(todoScore),
      costEfficiency: Math.round(efficiencyScore),
      helpfulness:    Math.round(helpScore),
    },
  };
}
