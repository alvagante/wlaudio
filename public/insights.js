// ── Session insights: summary card + code impact row ──────────────────────
import { escHtml } from './utils.js';

// ── Summary card (facets) ──────────────────────────────────────────────────

const OUTCOME_COLOR = {
  achieved:         'green',
  mostly_achieved:  'yellow',
  partially_achieved: 'orange',
  not_achieved:     'red',
};

const HELPFUL_COLOR = {
  very_helpful:     'green',
  helpful:          'green',
  somewhat_helpful: 'yellow',
  not_helpful:      'red',
};

function fmtLabel(s) {
  return s.replace(/_/g, ' ');
}

export function updateSummaryCard(facets) {
  const card = document.getElementById('summary-card');
  if (!facets || !facets.briefSummary) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');

  document.getElementById('summary-goal').textContent = facets.underlyingGoal || '—';

  const outcomeEl = document.getElementById('summary-outcome');
  outcomeEl.textContent  = fmtLabel(facets.outcome || '');
  outcomeEl.className    = `summary-badge badge-${OUTCOME_COLOR[facets.outcome] ?? 'dim'}`;

  const helpEl = document.getElementById('summary-helpful');
  helpEl.textContent = fmtLabel(facets.claudeHelpfulness || '');
  helpEl.className   = `summary-badge badge-${HELPFUL_COLOR[facets.claudeHelpfulness] ?? 'dim'}`;

  document.getElementById('summary-text').textContent = facets.briefSummary;

  const tags = document.getElementById('summary-tags');
  const cats = Object.keys(facets.goalCategories ?? {});
  tags.innerHTML = cats.map(c => `<span class="summary-tag">${escHtml(fmtLabel(c))}</span>`).join('');
}

// ── Code impact row (session-meta) ─────────────────────────────────────────

export function updateCodeImpact(meta, stats) {
  const row = document.getElementById('impact-row');

  // Always update the tools sub-label with error count from live stats
  if (stats) {
    const sub = document.getElementById('m-tools-sub');
    if (sub) {
      sub.textContent = stats.toolErrorCount > 0
        ? `${stats.toolErrorCount} errors`
        : 'total';
      sub.className = stats.toolErrorCount > 0 ? 'metric-sub err' : 'metric-sub';
    }
  }

  if (!meta) {
    row.classList.add('hidden');
    return;
  }
  row.classList.remove('hidden');

  document.getElementById('imp-add').textContent        = `+${meta.linesAdded}`;
  document.getElementById('imp-del').textContent        = `−${meta.linesRemoved}`;
  document.getElementById('imp-files').textContent      = String(meta.filesModified);
  document.getElementById('imp-commits').textContent    = String(meta.gitCommits);
  document.getElementById('imp-pushes').textContent     = String(meta.gitPushes);
  document.getElementById('imp-interrupts').textContent = String(meta.userInterruptions);

  const langs = Object.keys(meta.languages ?? {});
  document.getElementById('imp-langs').textContent = langs.length ? langs.join(', ') : '—';

  // Feature flags as small pills on the languages card
  const flags = [];
  if (meta.usesMcp)        flags.push('MCP');
  if (meta.usesWebSearch)  flags.push('Web');
  if (meta.usesWebFetch)   flags.push('Fetch');
  if (meta.usesTaskAgent)  flags.push('Agents');
  const flagsEl = document.getElementById('imp-flags');
  if (flagsEl) flagsEl.innerHTML = flags.map(f => `<span class="impact-pill">${f}</span>`).join('');
}
