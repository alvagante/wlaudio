// ── MDD Dashboard page ──────────────────────────────────────────────────────
// Loaded as type="module"

// ── State ─────────────────────────────────────────────────────────────────

let state = {
  docs:    [],
  audits:  [],
  startup: '',
  graph:   { edges: [], orphans: [], ascii: '' },
  summary: { docCount: 0, inSync: 0, drifted: 0, brokenRef: 0, untracked: 0, knownIssueCount: 0, auditCount: 0 },
};

let selectedItem = null;  // { type: 'doc'|'audit', id: string }

// ── Escape helper ──────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Markdown renderer ──────────────────────────────────────────────────────

function renderMarkdown(md) {
  if (!md) return '<span style="color:var(--dim)">—</span>';
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
    return `<pre style="white-space:pre-wrap">${esc(md)}</pre>`;
  }
  return DOMPurify.sanitize(marked.parse(md));
}

// ── Data fetching ──────────────────────────────────────────────────────────

async function loadData() {
  try {
    const res  = await fetch('/api/v1/mdd');
    const data = await res.json();
    state = data;
    render();
  } catch {
    showError();
  }
}

function showError() {
  document.getElementById('mdd-doc-list').innerHTML =
    '<div class="mdd-empty-state">Failed to load MDD data. Is the server running?</div>';
}

// ── Rendering ──────────────────────────────────────────────────────────────

function render() {
  renderStatusBar();
  renderDocList();
  renderAuditList();
  renderGraph();
  renderDetail();  // re-render selected item or show default
}

function renderStatusBar() {
  const { docCount, inSync, drifted, brokenRef, untracked, knownIssueCount, auditCount } = state.summary;
  el('mdd-sb-docs').textContent       = docCount;
  el('mdd-sb-sync').textContent       = inSync;
  el('mdd-sb-drift').textContent      = drifted;
  el('mdd-sb-broken').textContent     = brokenRef;
  el('mdd-sb-untracked').textContent  = untracked;
  el('mdd-sb-issues').textContent     = knownIssueCount;
  el('mdd-sb-audits').textContent     = auditCount;
  el('mdd-doc-count').textContent     = docCount;
  el('mdd-audit-count').textContent   = auditCount;
}

function driftIcon(drift) {
  switch (drift) {
    case 'in_sync':    return '✅';
    case 'drifted':    return '⚠️';
    case 'broken_ref': return '❌';
    case 'untracked':  return '❓';
    default:           return '❓';
  }
}

function driftTagClass(drift) {
  if (drift === 'drifted')    return 'drifted';
  if (drift === 'broken_ref') return 'broken';
  return '';
}

function statusBadgeClass(status) {
  if (['draft','in_progress','complete','deprecated'].includes(status)) return status;
  return 'unknown';
}

function renderDocList() {
  const container = el('mdd-doc-list');

  if (!state.docs.length) {
    container.innerHTML = `
      <div class="mdd-no-docs">
        No feature docs yet.<br>
        Run <code>/mdd &lt;feature&gt;</code> in your terminal<br>
        to create your first MDD doc.
      </div>`;
    return;
  }

  container.innerHTML = state.docs.map(doc => {
    const isActive = selectedItem?.type === 'doc' && selectedItem?.id === doc.id;
    const driftTag = doc.drift !== 'in_sync'
      ? `<span class="mdd-drift-tag ${driftTagClass(doc.drift)}">${doc.driftCommitCount > 0 ? `+${doc.driftCommitCount}` : doc.drift}</span>`
      : '';
    return `
      <div class="mdd-doc-item${isActive ? ' active' : ''}" data-doc-id="${esc(doc.id)}">
        <span class="mdd-drift-icon">${driftIcon(doc.drift)}</span>
        <span class="mdd-doc-title">${esc(doc.title || doc.id)}</span>
        ${driftTag}
        <span class="mdd-status-badge ${statusBadgeClass(doc.status)}">${esc(doc.status || '?')}</span>
      </div>`;
  }).join('');

  container.querySelectorAll('.mdd-doc-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.docId;
      selectedItem = { type: 'doc', id };
      renderDocList();
      renderDetail();
    });
  });
}

function renderAuditList() {
  const container = el('mdd-audit-list');

  if (!state.audits.length) {
    container.innerHTML = '<div class="mdd-empty-state" style="padding:0.5rem 0.75rem">No audits yet</div>';
    return;
  }

  const AUDIT_LABELS = {
    'report':       'AUDIT REPORT',
    'scan':         'SCAN',
    'flow':         'DATA FLOW',
    'notes':        'NOTES',
    'results':      'FIX RESULTS',
    'update-notes': 'UPDATE NOTES',
    'graph':        'DEP GRAPH',
    'unknown':      'REPORT',
  };

  container.innerHTML = state.audits.map(a => {
    const isActive = selectedItem?.type === 'audit' && selectedItem?.id === a.filename;
    return `
      <div class="mdd-audit-item${isActive ? ' active' : ''}" data-audit-id="${esc(a.filename)}">
        <span class="mdd-audit-type-tag">${AUDIT_LABELS[a.type] ?? 'REPORT'}</span>
        <span class="mdd-audit-date">${esc(a.date || a.filename)}</span>
      </div>`;
  }).join('');

  container.querySelectorAll('.mdd-audit-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.auditId;
      selectedItem = { type: 'audit', id };
      renderAuditList();
      renderDetail();
    });
  });
}

function renderGraph() {
  const pre = el('mdd-graph-pre');
  if (!pre) return;

  const { ascii, orphans } = state.graph;

  if (!ascii && !orphans?.length) {
    pre.textContent = '';
    pre.parentElement.innerHTML = '<div class="mdd-graph-empty">No dependencies between features</div>';
    return;
  }

  pre.textContent = ascii || '(no graph data)';
}

function renderDetail() {
  const panel = el('mdd-detail-content');
  if (!panel) return;

  if (!selectedItem) {
    // Show startup context
    if (state.startup) {
      panel.innerHTML = `<div class="mdd-md-body">${renderMarkdown(state.startup)}</div>`;
    } else {
      panel.innerHTML = `
        <div class="mdd-no-docs">
          Select a feature doc or audit from the left panel.<br>
          Or run <code>/mdd status</code> to populate startup context.
        </div>`;
    }
    return;
  }

  if (selectedItem.type === 'doc') {
    const doc = state.docs.find(d => d.id === selectedItem.id);
    if (!doc) { panel.innerHTML = '<div class="mdd-empty-state">Doc not found</div>'; return; }
    panel.innerHTML = buildDocDetail(doc);
    // Wire copy-to-clipboard chips
    panel.querySelectorAll('.mdd-chip.clickable').forEach(chip => {
      chip.addEventListener('click', () => {
        const path = chip.dataset.path;
        if (path) navigator.clipboard.writeText(path).catch(() => {});
      });
    });
    return;
  }

  if (selectedItem.type === 'audit') {
    const audit = state.audits.find(a => a.filename === selectedItem.id);
    if (!audit) { panel.innerHTML = '<div class="mdd-empty-state">Audit not found</div>'; return; }
    panel.innerHTML = `
      <div class="mdd-doc-meta">
        <div class="mdd-doc-meta-title">${esc(audit.filename)}</div>
        <div class="mdd-doc-meta-row">
          <span class="mdd-status-badge unknown">${esc(audit.type)}</span>
          <span style="color:var(--subtext);font-size:11px">${esc(audit.date)}</span>
        </div>
      </div>
      <div class="mdd-md-body">${renderMarkdown(audit.body)}</div>`;
  }
}

function buildDocDetail(doc) {
  const driftWarning = buildDriftWarning(doc);

  const sourceChips = (doc.sourceFiles ?? []).map(f =>
    `<span class="mdd-chip clickable" data-path="${esc(f)}" title="Click to copy path">${esc(f)}</span>`
  ).join('');

  const depChips = (doc.dependsOn ?? []).map(d =>
    `<span class="mdd-chip">${esc(d)}</span>`
  ).join('');

  const issueList = (doc.knownIssues ?? []).length
    ? (doc.knownIssues ?? []).map(i => `<div class="mdd-known-issue">⚠ ${esc(i)}</div>`).join('')
    : '';

  return `
    ${driftWarning}
    <div class="mdd-doc-meta">
      <div class="mdd-doc-meta-title">${esc(doc.title || doc.id)}</div>
      <div class="mdd-doc-meta-row">
        <span class="mdd-status-badge ${statusBadgeClass(doc.status)}">${esc(doc.status || '?')}</span>
        <span style="color:var(--subtext);font-size:11px">phase: ${esc(doc.phase || '—')}</span>
        <span style="color:var(--subtext);font-size:11px">synced: ${esc(doc.lastSynced || 'never')}</span>
      </div>
      ${sourceChips ? `
      <div class="mdd-doc-meta-row">
        <span class="mdd-doc-meta-label">SOURCE</span>
        ${sourceChips}
      </div>` : ''}
      ${depChips ? `
      <div class="mdd-doc-meta-row">
        <span class="mdd-doc-meta-label">DEPENDS ON</span>
        ${depChips}
      </div>` : ''}
      ${issueList ? `
      <div style="margin-top:0.5rem">${issueList}</div>` : ''}
    </div>
    <div class="mdd-md-body">${renderMarkdown(doc.body)}</div>`;
}

function buildDriftWarning(doc) {
  if (doc.drift === 'in_sync' || doc.drift === 'untracked') return '';

  if (doc.drift === 'broken_ref') {
    return `<div class="mdd-drift-warning broken">
      ❌ Broken reference — one or more source files no longer exist on disk.
      Run <code>/mdd update ${esc(doc.id)}</code> to fix.
    </div>`;
  }

  if (doc.drift === 'drifted') {
    return `<div class="mdd-drift-warning">
      ⚠️ ${doc.driftCommitCount} commit${doc.driftCommitCount !== 1 ? 's' : ''} since last sync
      ${doc.driftLatestMsg ? `— latest: <em>${esc(doc.driftLatestMsg)}</em>` : ''}.<br>
      Run <code>/mdd update ${esc(doc.id)}</code> to re-sync.
    </div>`;
  }

  return '';
}

// ── WebSocket ──────────────────────────────────────────────────────────────

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws    = new WebSocket(`${proto}//${location.host}/ws`);

  ws.onopen  = () => setConn(true);
  ws.onclose = () => { setConn(false); setTimeout(connectWs, 3000); };
  ws.onerror = () => ws.close();
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'mdd_updated') loadData();
    } catch { /* ignore */ }
  };
}

function setConn(up) {
  const dot   = el('mdd-conn-dot');
  const label = el('mdd-conn-label');
  if (dot)   dot.className    = `dot ${up ? 'connected' : 'disconnected'}`;
  if (label) label.textContent = up ? 'LIVE' : 'RECONNECTING';
}

// ── Collapse toggle ────────────────────────────────────────────────────────

function initGraphToggle() {
  const toggle = el('mdd-graph-toggle');
  const body   = el('mdd-graph-body');
  if (!toggle || !body) return;
  toggle.addEventListener('click', () => {
    body.classList.toggle('collapsed');
    const icon = toggle.querySelector('.mdd-collapse-icon');
    if (icon) icon.textContent = body.classList.contains('collapsed') ? '▸' : '▾';
  });
}

// ── Refresh button ─────────────────────────────────────────────────────────

function initRefresh() {
  const btn = el('mdd-refresh-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.textContent = '↻';
    loadData().finally(() => { btn.textContent = '↻'; });
  });
}

// ── Utility ────────────────────────────────────────────────────────────────

function el(id) { return document.getElementById(id); }

// ── Init ───────────────────────────────────────────────────────────────────

loadData();
connectWs();
initGraphToggle();
initRefresh();
