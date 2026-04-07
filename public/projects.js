// ── Projects page ─────────────────────────────────────────────────────────

let allProjects  = [];
let selectedPath = null;
let sortMode     = 'recent';
let outcomeChart = null;

// ── Helpers ───────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtDuration(minutes) {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString();
}

function timeAgo(isoStr) {
  if (!isoStr) return '—';
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)  return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

function fmtDate(isoStr) {
  if (!isoStr) return '—';
  try {
    return new Date(isoStr).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return isoStr; }
}

function truncate(str, max) {
  if (!str || str.length <= max) return str ?? '';
  const cut = str.lastIndexOf(' ', max);
  return (cut > max - 20 ? str.slice(0, cut) : str.slice(0, max)) + '…';
}

// ── Sort ──────────────────────────────────────────────────────────────────

function sortedProjects() {
  return [...allProjects].sort((a, b) => {
    if (sortMode === 'sessions') return b.sessionCount - a.sessionCount;
    if (sortMode === 'commits')  return b.totalGitCommits - a.totalGitCommits;
    if (sortMode === 'lines')    return (b.totalLinesAdded + b.totalLinesRemoved) - (a.totalLinesAdded + a.totalLinesRemoved);
    // default: recent
    return new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime();
  });
}

// ── Sidebar list ──────────────────────────────────────────────────────────

function renderList() {
  const list  = document.getElementById('pr-list');
  const count = document.getElementById('pr-count');
  count.textContent = allProjects.length;
  list.innerHTML = '';

  const maxLines = Math.max(...allProjects.map(p => p.totalLinesAdded + p.totalLinesRemoved), 1);

  for (const p of sortedProjects()) {
    const li = document.createElement('li');
    li.className = `pr-list-item${p.projectPath === selectedPath ? ' active' : ''}`;
    li.dataset.path = p.projectPath;

    const lineScale = (p.totalLinesAdded + p.totalLinesRemoved) / maxLines;
    const addW = Math.round((p.totalLinesAdded  / (p.totalLinesAdded + p.totalLinesRemoved || 1)) * 60 * lineScale);
    const remW = Math.round((p.totalLinesRemoved / (p.totalLinesAdded + p.totalLinesRemoved || 1)) * 60 * lineScale);

    li.innerHTML = `
      <div class="pr-li-name">${escHtml(p.projectName)}</div>
      <div class="pr-li-meta">
        <span class="pr-li-sessions">${p.sessionCount} session${p.sessionCount !== 1 ? 's' : ''}</span>
        <span class="pr-li-age">${timeAgo(p.lastActive)}</span>
      </div>
      ${(addW + remW) > 0 ? `<div class="pr-li-bars">
        ${addW > 0 ? `<div class="pr-li-bar-add" style="width:${addW}px"></div>` : ''}
        ${remW > 0 ? `<div class="pr-li-bar-rem" style="width:${remW}px"></div>` : ''}
      </div>` : ''}
    `;
    li.addEventListener('click', () => selectProject(p.projectPath));
    list.appendChild(li);
  }
}

// ── Detail panel ──────────────────────────────────────────────────────────

const OUTCOME_COLORS = {
  achieved:           '#a6e3a1',
  mostly_achieved:    '#f9e2af',
  partially_achieved: '#fab387',
  not_achieved:       '#f38ba8',
};

const OUTCOME_CLASS = {
  achieved:           'green',
  mostly_achieved:    'yellow',
  partially_achieved: 'orange',
  not_achieved:       'red',
};

function renderDetail(p) {
  document.getElementById('pr-empty').classList.add('hidden');
  document.getElementById('pr-content').classList.remove('hidden');

  // Header
  document.getElementById('pr-name').textContent        = p.projectName;
  document.getElementById('pr-path').textContent        = p.projectPath;
  document.getElementById('pr-last-active').innerHTML   =
    `Last active: ${timeAgo(p.lastActive)}<br><span style="color:var(--dim)">${fmtDate(p.lastActive)}</span>`;

  // Cards
  document.getElementById('pr-sessions').textContent    = fmtNum(p.sessionCount);
  document.getElementById('pr-duration').textContent    = fmtDuration(p.totalDurationMinutes);
  document.getElementById('pr-avg-duration').textContent = `avg ${fmtDuration(p.avgDurationMinutes)}`;
  document.getElementById('pr-commits').textContent     = fmtNum(p.totalGitCommits);
  document.getElementById('pr-pushes').textContent      = `${fmtNum(p.totalGitPushes)} pushed`;
  document.getElementById('pr-lines-add').textContent   = `+${fmtNum(p.totalLinesAdded)}`;
  document.getElementById('pr-lines-rem').textContent   = `−${fmtNum(p.totalLinesRemoved)}`;
  document.getElementById('pr-lines-rem').className     = 'pr-card-sub red';
  document.getElementById('pr-tools').textContent       = fmtNum(p.totalToolCalls);
  document.getElementById('pr-tool-errors').textContent =
    p.totalToolErrors > 0 ? `${p.totalToolErrors} errors` : 'no errors';
  document.getElementById('pr-files').textContent       = fmtNum(p.totalFilesModified);

  renderBarSection('pr-lang-bars',  p.languages,   'pr-bar-fill-lang');
  renderBarSection('pr-tool-bars',  p.toolCounts,  'pr-bar-fill-tool', 10);
  renderBarSection('pr-goal-bars',  p.goalCategories, 'pr-bar-fill-goal');
  renderOutcome(p.outcomeCounts);
  renderSessionList(p.sessions);
}

function renderBarSection(containerId, data, fillClass, limit = 8) {
  const container = document.getElementById(containerId);
  const entries   = Object.entries(data ?? {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  if (!entries.length) {
    container.innerHTML = '<div class="pr-empty-section">No data</div>';
    return;
  }

  const max   = entries[0][1];
  const total = entries.reduce((s, [, v]) => s + v, 0);

  container.innerHTML = entries.map(([name, count]) => `
    <div class="pr-bar-row">
      <span class="pr-bar-name">${escHtml(name.replace(/_/g, ' '))}</span>
      <div class="pr-bar-track">
        <div class="${fillClass}" style="width:${(count / max * 100).toFixed(1)}%"></div>
      </div>
      <span class="pr-bar-count">${Math.round(count / total * 100)}%</span>
    </div>
  `).join('');
}

function renderOutcome(outcomeCounts) {
  const entries = Object.entries(outcomeCounts ?? {}).filter(([, v]) => v > 0);
  const wrap    = document.getElementById('pr-outcome-wrap');
  const legend  = document.getElementById('pr-outcome-legend');

  if (outcomeChart) {
    outcomeChart.destroy();
    outcomeChart = null;
  }

  if (!entries.length) {
    wrap.innerHTML   = '<div class="pr-empty-section">No outcome data</div>';
    legend.innerHTML = '';
    return;
  }

  // Restore canvas if replaced
  wrap.innerHTML = '<canvas id="pr-outcome-chart"></canvas>';

  const labels = entries.map(([k]) => k.replace(/_/g, ' '));
  const values = entries.map(([, v]) => v);
  const colors = entries.map(([k]) => OUTCOME_COLORS[k] ?? '#585b70');

  outcomeChart = new Chart(document.getElementById('pr-outcome-chart').getContext('2d'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.map(c => c + '99'),
        borderColor: colors,
        borderWidth: 1.5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => ` ${item.label}: ${item.parsed} sessions`,
          },
        },
      },
    },
  });

  const total = values.reduce((a, b) => a + b, 0);
  legend.innerHTML = entries.map(([key, count], i) => `
    <div class="pr-legend-item">
      <span class="pr-legend-dot" style="background:${colors[i]}"></span>
      <span>${escHtml(labels[i])} (${count}/${total})</span>
    </div>
  `).join('');
}

function renderSessionList(sessions) {
  const container = document.getElementById('pr-session-list');
  const badge     = document.getElementById('pr-session-list-count');
  badge.textContent = sessions.length;

  if (!sessions.length) {
    container.innerHTML = '<div class="pr-empty-section">No sessions</div>';
    return;
  }

  container.innerHTML = sessions.map(s => {
    const outcomeClass = OUTCOME_CLASS[s.outcome] ?? 'dim';
    const outcomeBadge = s.outcome
      ? `<span class="pr-sr-outcome ${outcomeClass}">${escHtml(s.outcome.replace(/_/g, ' '))}</span>`
      : '';
    const lineStr = (s.linesAdded || s.linesRemoved)
      ? `<span class="green">+${fmtNum(s.linesAdded)}</span> <span class="red">−${fmtNum(s.linesRemoved)}</span>`
      : '';
    const commitStr = s.gitCommits ? `${s.gitCommits} commit${s.gitCommits !== 1 ? 's' : ''}` : '';
    const durStr = fmtDuration(s.durationMinutes);

    return `
      <div class="pr-session-row">
        <span class="pr-sr-date">${fmtDate(s.startTime)}</span>
        <span class="pr-sr-prompt" title="${escHtml(s.briefSummary || s.firstPrompt)}">${escHtml(truncate(s.briefSummary || s.firstPrompt, 80))}</span>
        <div class="pr-sr-meta">
          ${lineStr}
          ${commitStr ? `<span>${escHtml(commitStr)}</span>` : ''}
          <span>${escHtml(durStr)}</span>
          ${outcomeBadge}
        </div>
      </div>
    `;
  }).join('');
}

// ── Selection ─────────────────────────────────────────────────────────────

function selectProject(path) {
  selectedPath = path;
  renderList();
  const p = allProjects.find(x => x.projectPath === path);
  if (p) renderDetail(p);
}

// ── Sort buttons ──────────────────────────────────────────────────────────

document.querySelectorAll('.pr-sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    sortMode = btn.dataset.sort;
    document.querySelectorAll('.pr-sort-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderList();
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────

async function init() {
  let data;
  try {
    const res = await fetch('/api/v1/projects');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    document.getElementById('pr-loading').textContent = `Failed to load projects: ${err.message}`;
    return;
  }

  document.getElementById('pr-loading').classList.add('hidden');

  allProjects = data;

  if (allProjects.length === 0) {
    document.getElementById('pr-empty').innerHTML = `
      <div class="pr-empty-icon">⬡</div>
      <div>No project data found</div>
    `;
    document.querySelector('.pr-layout').style.display = 'flex';
    return;
  }

  renderList();

  // Auto-select first project
  selectProject(sortedProjects()[0].projectPath);
}

document.addEventListener('DOMContentLoaded', init);
