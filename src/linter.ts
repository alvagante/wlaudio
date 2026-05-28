import type { ClaudeMdLint } from './types/index.js';

const CRITICAL_SECTIONS = [
  { key: 'test',                        msg: 'No testing section detected — consider adding testing guidelines.' },
  { key: 'typescript',                  msg: 'No TypeScript section detected — consider adding type rules.' },
  { key: 'security|secret|credential',  msg: 'No security section detected — consider documenting secret handling.' },
];

export function claudeMdLinter(content: string): ClaudeMdLint {
  const warnings: string[]    = [];
  const suggestions: string[] = [];
  const lines = content.split('\n');
  const lower = content.toLowerCase();

  // ── Heading count ─────────────────────────────────────────────────────────
  const headings = lines.filter(l => /^## /.test(l));
  if (headings.length < 3) {
    warnings.push(`Only ${headings.length} ## section${headings.length === 1 ? '' : 's'} found — consider adding more structure.`);
  }

  // ── Vague rules (very short list items) ──────────────────────────────────
  const vagueLines = lines.filter(l => /^[-*] /.test(l) && l.trim().length < 22);
  if (vagueLines.length > 0) {
    warnings.push(`${vagueLines.length} rule${vagueLines.length > 1 ? 's are' : ' is'} very short and may be too vague.`);
  }

  // ── File length ───────────────────────────────────────────────────────────
  if (lines.length > 200) {
    warnings.push(`File is ${lines.length} lines — consider splitting into focused sections.`);
  }

  // ── Critical sections ─────────────────────────────────────────────────────
  for (const { key, msg } of CRITICAL_SECTIONS) {
    const regex = new RegExp(key);
    if (!regex.test(lower)) {
      suggestions.push(msg);
    }
  }

  // ── Quick Reference table ─────────────────────────────────────────────────
  if (!content.includes('| ---') && !content.includes('|---')) {
    suggestions.push('No markdown table detected — a Quick Reference table can improve navigation.');
  }

  return { warnings, suggestions };
}
