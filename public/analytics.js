// ── Analytics page ────────────────────────────────────────────────────────

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtDuration(minutes) {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function fmtNum(n) {
  return Number(n).toLocaleString();
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function shortModel(m) {
  if (m.includes('opus'))   return 'Opus';
  if (m.includes('sonnet')) return 'Sonnet';
  if (m.includes('haiku'))  return 'Haiku';
  return m;
}

// ── Render helpers ────────────────────────────────────────────────────────

function renderSummary(data) {
  document.getElementById('an-total-sessions').textContent = fmtNum(data.totalSessions);
  document.getElementById('an-total-messages').textContent = fmtNum(data.totalMessages);
  document.getElementById('an-since').textContent          = fmtDate(data.firstSessionDate);

  const ls = data.longestSession;
  if (ls && ls.durationMinutes) {
    document.getElementById('an-longest-val').textContent = fmtDuration(ls.durationMinutes);
    document.getElementById('an-longest-sub').textContent = `${fmtNum(ls.messageCount)} messages`;
  } else {
    document.getElementById('an-longest-val').textContent = '—';
    document.getElementById('an-longest-sub').textContent = '';
  }
}

function renderHourlyChart(hourCounts) {
  const ctx = document.getElementById('hourly-chart').getContext('2d');
  const labels = Array.from({ length: 24 }, (_, i) => String(i));
  const values = labels.map(h => hourCounts[h] ?? 0);

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: '#89b4fa44',
        borderColor:     '#89b4fa',
        borderWidth: 1,
        borderRadius: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => `${items[0].label}:00`,
            label: (item)  => ` ${item.parsed.y} messages`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: '#31324422' },
          ticks: { color: '#585b70', font: { size: 10 }, maxTicksLimit: 8 },
        },
        y: {
          grid: { color: '#31324444' },
          ticks: { color: '#585b70', font: { size: 10 } },
          beginAtZero: true,
        },
      },
    },
  });
}

const OUTCOME_COLORS = {
  achieved:           '#a6e3a1',
  mostly_achieved:    '#f9e2af',
  partially_achieved: '#fab387',
  not_achieved:       '#f38ba8',
};

function renderOutcomeChart(outcomeCounts) {
  const entries = Object.entries(outcomeCounts).filter(([, v]) => v > 0);
  if (!entries.length) {
    document.getElementById('an-outcome-wrap').innerHTML = '<div class="an-empty">No outcome data yet</div>';
    return;
  }

  const labels = entries.map(([k]) => k.replace(/_/g, ' '));
  const values = entries.map(([, v]) => v);
  const colors = entries.map(([k]) => OUTCOME_COLORS[k] ?? '#585b70');

  const ctx = document.getElementById('outcome-chart').getContext('2d');
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.map(c => c + '99'),
        borderColor:     colors,
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

  // Custom legend
  const legend = document.getElementById('outcome-legend');
  const total  = values.reduce((a, b) => a + b, 0);
  legend.innerHTML = entries.map(([key, count], i) => `
    <div class="an-legend-item">
      <span class="an-legend-dot" style="background:${colors[i]}"></span>
      <span>${escHtml(labels[i])} (${count}/${total})</span>
    </div>
  `).join('');
}

function renderLanguageBars(languageTotals) {
  const container = document.getElementById('an-lang-bars');
  const entries   = Object.entries(languageTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  if (!entries.length) {
    container.innerHTML = '<div class="an-empty">No language data yet</div>';
    return;
  }

  const max   = entries[0]?.[1] ?? 1;
  const total = entries.reduce((s, [, v]) => s + v, 0);

  container.innerHTML = entries.map(([lang, count]) => `
    <div class="an-lang-bar-row">
      <span class="an-lang-name">${escHtml(lang)}</span>
      <div class="an-lang-track">
        <div class="an-lang-fill" style="width:${(count / max * 100).toFixed(1)}%"></div>
      </div>
      <span class="an-lang-count">${Math.round(count / total * 100)}%</span>
    </div>
  `).join('');
}

function renderModelTable(modelAnalytics) {
  const table   = document.getElementById('model-table');
  const entries = Object.entries(modelAnalytics);

  if (!entries.length) {
    table.innerHTML = '<tr><td class="an-empty">No model usage data</td></tr>';
    return;
  }

  let totalCost = 0;
  let totalIn = 0, totalOut = 0, totalCacheR = 0, totalCacheW = 0;

  const rows = entries.map(([model, info]) => {
    const t = info.tokens;
    totalCost   += info.costUSD;
    totalIn     += t.inputTokens;
    totalOut    += t.outputTokens;
    totalCacheR += t.cacheReadInputTokens;
    totalCacheW += t.cacheCreationInputTokens;
    return `<tr>
      <td class="col-model">${escHtml(shortModel(model))}</td>
      <td>${fmtTokens(t.inputTokens)}</td>
      <td>${fmtTokens(t.outputTokens)}</td>
      <td>${fmtTokens(t.cacheReadInputTokens)}</td>
      <td>${fmtTokens(t.cacheCreationInputTokens)}</td>
      <td class="col-cost">$${info.costUSD.toFixed(4)}</td>
    </tr>`;
  }).join('');

  table.innerHTML = `
    <thead>
      <tr>
        <th>Model</th>
        <th>Input</th>
        <th>Output</th>
        <th>Cache read</th>
        <th>Cache write</th>
        <th>Est. cost</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td class="col-model">TOTAL</td>
        <td>${fmtTokens(totalIn)}</td>
        <td>${fmtTokens(totalOut)}</td>
        <td>${fmtTokens(totalCacheR)}</td>
        <td>${fmtTokens(totalCacheW)}</td>
        <td class="col-cost">$${totalCost.toFixed(4)}</td>
      </tr>
    </tfoot>
  `;
}

// ── Boot ──────────────────────────────────────────────────────────────────

async function init() {
  let data;
  try {
    const res = await fetch('/api/v1/analytics');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    document.getElementById('an-loading').textContent = `Failed to load analytics: ${err.message}`;
    return;
  }

  document.getElementById('an-loading').classList.add('hidden');
  document.getElementById('an-content').classList.remove('hidden');

  renderSummary(data);
  renderHourlyChart(data.hourCounts ?? {});
  renderOutcomeChart(data.outcomeCounts ?? {});
  renderLanguageBars(data.languageTotals ?? {});
  renderModelTable(data.modelAnalytics ?? {});
}

document.addEventListener('DOMContentLoaded', init);
