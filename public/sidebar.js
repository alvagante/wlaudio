// ── Sidebar: sessions, global stats, sparkline, plans, settings ───────────
import { projectName, shortModel, totalTokenCount, fmtTokens, timeAgo, escHtml } from './utils.js';

let sparklineChart = null;

// ── Session list ───────────────────────────────────────────────────────────

export function renderSidebar(sessions, stats, selectedId, onSelect) {
  const list  = document.getElementById('session-list');
  const count = document.getElementById('session-count');
  count.textContent = sessions.size;

  list.innerHTML = '';
  for (const [id, session] of sessions) {
    const st  = stats.get(id);
    const li  = document.createElement('li');
    li.className = `session-item${id === selectedId ? ' active' : ''}`;
    li.dataset.id = id;

    const models = st ? Object.keys(st.models) : [];
    const tok    = st ? fmtTokens(totalTokenCount(st.totalTokens)) : '—';
    const cost   = st ? `$${st.estimatedCostUSD.toFixed(4)}` : '—';

    li.innerHTML = `
      <div class="si-header">
        <span class="si-dot"></span>
        <span class="si-name">${projectName(session.cwd)}</span>
        <span class="si-age">${timeAgo(session.startedAt)}</span>
      </div>
      <div class="si-tokens">${tok} tok &nbsp;<span class="si-cost">${cost}</span></div>
      <div class="si-models">${models.map(m => `<span class="model-badge">${shortModel(m)}</span>`).join('')}</div>
    `;
    li.addEventListener('click', () => onSelect(id));
    list.appendChild(li);
  }
}

// ── Global stats ───────────────────────────────────────────────────────────

export function renderGlobalStats(gs) {
  if (!gs) return;

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
