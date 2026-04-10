// ── Sidebar: sessions, global stats, sparkline, plans, settings ───────────
import { projectName, shortModel, totalTokenCount, fmtTokens, timeAgo, escHtml } from './utils.js';

let sparklineChart = null;

// ── Session list ───────────────────────────────────────────────────────────

export function renderSidebar(sessions, stats, selectedId, onSelect, completed = new Map(), facets = {}, meta = {}) {
  const list  = document.getElementById('session-list');
  const count = document.getElementById('session-count');
  count.textContent = sessions.size;

  list.innerHTML = '';

  // Active sessions first
  for (const [id, session] of sessions) {
    list.appendChild(buildSessionItem(id, session, stats.get(id), selectedId, onSelect, false, facets[id] ?? null, meta[id] ?? null));
  }

  // Completed sessions (up to 15, most recent first)
  const completedEntries = [...completed.entries()]
    .sort((a, b) => (b[1].endedAt ?? 0) - (a[1].endedAt ?? 0))
    .slice(0, 15);

  if (completedEntries.length > 0 && sessions.size > 0) {
    const sep = document.createElement('div');
    sep.className = 'si-separator';
    sep.textContent = 'RECENT';
    list.appendChild(sep);
  }

  for (const [id, { session, stats: st }] of completedEntries) {
    list.appendChild(buildSessionItem(id, session, st ?? null, selectedId, onSelect, true, facets[id] ?? null, meta[id] ?? null));
  }
}

const OUTCOME_COLOR_SIDEBAR = {
  achieved:           'green',
  mostly_achieved:    'yellow',
  partially_achieved: 'orange',
  not_achieved:       'red',
};

function truncate(str, max) {
  if (!str || str.length <= max) return str ?? '';
  const cut = str.lastIndexOf(' ', max);
  return (cut > max - 20 ? str.slice(0, cut) : str.slice(0, max)) + '…';
}

function buildSessionItem(id, session, st, selectedId, onSelect, isCompleted, facets, meta) {
  const li = document.createElement('li');
  li.className = `session-item${id === selectedId ? ' active' : ''}${isCompleted ? ' ended' : ''}`;
  li.dataset.id = id;

  const models       = st ? Object.keys(st.models) : [];
  const hasTokenData = st && st.hasTokenData !== false;
  const tok          = hasTokenData ? fmtTokens(totalTokenCount(st.totalTokens)) : '—';
  const cost         = hasTokenData ? `$${st.estimatedCostUSD.toFixed(4)}` : '—';

  // Outcome badge for completed sessions
  let outcomeBadge = '';
  if (isCompleted && facets && facets.outcome) {
    const colorCls = OUTCOME_COLOR_SIDEBAR[facets.outcome] ?? 'dim';
    const label = facets.outcome.replace(/_/g, ' ');
    outcomeBadge = `<span class="si-outcome ${colorCls}">${escHtml(label)}</span>`;
  }

  // First prompt subtitle for completed sessions
  let firstPromptLine = '';
  if (isCompleted && meta && meta.firstPrompt) {
    firstPromptLine = `<div class="si-prompt">${escHtml(truncate(meta.firstPrompt, 60))}</div>`;
  }

  li.innerHTML = `
    <div class="si-header">
      <span class="si-dot${isCompleted ? ' si-dot-ended' : ''}"></span>
      <span class="si-name">${projectName(session.cwd)}</span>
      <span class="si-age">${timeAgo(session.startedAt)}</span>
    </div>
    <div class="si-tokens">${tok} tok &nbsp;<span class="si-cost">${cost}</span></div>
    <div class="si-models">${models.map(m => `<span class="model-badge">${shortModel(m)}</span>`).join('')}${isCompleted ? '<span class="ended-badge">ended</span>' : ''}${outcomeBadge}</div>
    ${firstPromptLine}
  `;
  li.addEventListener('click', () => onSelect(id));
  return li;
}

// ── Global stats ───────────────────────────────────────────────────────────

export function renderGlobalStats(gs) {
  if (!gs) return;
  if (!document.getElementById('gs-sessions')) return; // not on this page

  document.getElementById('gs-sessions').textContent = gs.totalSessions ?? '—';
  document.getElementById('gs-messages').textContent = gs.totalMessages ?? '—';

  let inp = 0, out = 0, cacheR = 0;
  for (const m of Object.values(gs.modelUsage ?? {})) {
    inp    += m.inputTokens ?? 0;
    out    += m.outputTokens ?? 0;
    cacheR += m.cacheReadInputTokens ?? 0;
  }
  document.getElementById('gs-input').textContent  = fmtTokens(inp);
  document.getElementById('gs-output').textContent = fmtTokens(out);
  document.getElementById('gs-cache').textContent  = fmtTokens(cacheR);

  updateSparkline(gs.dailyActivity ?? []);
}

function updateSparkline(activity) {
  const canvas = document.getElementById('sparkline');
  const ctx    = canvas.getContext('2d');
  const last14 = activity.slice(-14);
  const labels = last14.map(d => d.date?.slice(5) ?? '');
  const msgs   = last14.map(d => d.messageCount ?? 0);

  if (sparklineChart) {
    sparklineChart.data.labels = labels;
    sparklineChart.data.datasets[0].data = msgs;
    sparklineChart.update('none');
    return;
  }
  sparklineChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: msgs, backgroundColor: '#89b4fa44', borderColor: '#89b4fa', borderWidth: 1, borderRadius: 2 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
  });
}

// ── Plans list ─────────────────────────────────────────────────────────────

export function renderPlans(plans, onOpen) {
  const container = document.getElementById('sidebar-plans');
  const counter   = document.getElementById('plans-count');
  if (!container || !counter) return; // not on this page
  counter.textContent = plans.length;

  if (!plans.length) {
    container.innerHTML = '<div class="sidebar-empty">No plans yet</div>';
    return;
  }
  container.innerHTML = plans.map((p, i) => `
    <div class="plan-item" data-index="${i}">${escHtml(p.name.replace(/-/g, ' '))}</div>
  `).join('');

  container.querySelectorAll('.plan-item').forEach(el => {
    el.addEventListener('click', () => onOpen(plans[Number(el.dataset.index)]));
  });
}

// ── Settings / config panel ────────────────────────────────────────────────

export function renderSettings(settings) {
  const panel = document.getElementById('config-panel');
  if (!panel) return; // not on this page
  if (!settings) {
    panel.innerHTML = '<div class="sidebar-empty">No settings.json found</div>';
    return;
  }

  const hookRows = Object.entries(settings.hookTypes)
    .map(([k, v]) => `<div class="stat-row"><span class="dim">${k}</span><span>${v}</span></div>`)
    .join('');

  const allowCount = settings.allowedTools.length;
  const denyCount  = settings.deniedTools.length;

  panel.innerHTML = `
    <div class="config-section">
      <div class="config-label">HOOKS (${settings.hookCount})</div>
      ${hookRows}
    </div>
    <div class="config-section">
      <div class="stat-row"><span class="dim">Allow rules</span><span class="green">${allowCount}</span></div>
      <div class="stat-row"><span class="dim">Deny rules</span><span class="red">${denyCount}</span></div>
    </div>
  `;
}

// ── Plans modal ────────────────────────────────────────────────────────────

export function initPlanModal() {
  document.getElementById('plan-modal-close').addEventListener('click', closePlanModal);
  document.getElementById('plan-modal-backdrop').addEventListener('click', closePlanModal);
}

export function openPlanModal(plan) {
  document.getElementById('plan-modal-title').textContent = plan.name.replace(/-/g, ' ');
  document.getElementById('plan-modal-body').textContent  = plan.content;
  document.getElementById('plans-modal').classList.remove('hidden');
}

function closePlanModal() {
  document.getElementById('plans-modal').classList.add('hidden');
}
