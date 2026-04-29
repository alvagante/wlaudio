// ── MDD Dashboard — rendering functions ───────────────────────────────────────
// Reads from appState (imported by reference); mutates appState.selectedItem.

import { appState, esc, el, renderMarkdown } from './mdd-state.js';

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

export function render() {
  renderStatusBar();
  renderDocList();
  renderAuditList();
  renderGraph();
  renderDetail();
}

export function renderStatusBar() {
  const { docCount, inSync, drifted, brokenRef, untracked, knownIssueCount, auditCount } = appState.summary;
  el('mdd-sb-docs').textContent      = docCount;
  el('mdd-sb-sync').textContent      = inSync;
  el('mdd-sb-drift').textContent     = drifted;
  el('mdd-sb-broken').textContent    = brokenRef;
  el('mdd-sb-untracked').textContent = untracked;
  el('mdd-sb-issues').textContent    = knownIssueCount;
  el('mdd-sb-audits').textContent    = auditCount;
  el('mdd-doc-count').textContent    = docCount;
  el('mdd-audit-count').textContent  = auditCount;
}

function driftIcon(drift) {
  switch (drift) {
    case 'in_sync':    return '✅';
    case 'drifted':    return '⚠️';
    case 'broken_ref': return '❌';
    default:           return '❓';
  }
}

function driftTagClass(drift) {
  if (drift === 'drifted')    return 'drifted';
  if (drift === 'broken_ref') return 'broken';
  return '';
}

function statusBadgeClass(status) {
  return ['draft','in_progress','complete','deprecated'].includes(status) ? status : 'unknown';
}

export function renderDocList() {
  const container = el('mdd-doc-list');

  if (!appState.docs.length) {
    container.innerHTML = `
      <div class="mdd-no-docs">
        No feature docs yet.<br>
        Run <code>/mdd &lt;feature&gt;</code> in your terminal<br>
        to create your first MDD doc.
      </div>`;
    return;
  }

  container.innerHTML = appState.docs.map(doc => {
    const isActive = appState.selectedItem?.type === 'doc' && appState.selectedItem?.id === doc.id;
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
      appState.selectedItem = { type: 'doc', id: item.dataset.docId };
      renderDocList();
      renderDetail();
    });
  });
}

export function renderAuditList() {
  const container = el('mdd-audit-list');

  if (!appState.audits.length) {
    container.innerHTML = '<div class="mdd-empty-state" style="padding:0.5rem 0.75rem">No audits yet</div>';
    return;
  }

  container.innerHTML = appState.audits.map(a => {
    const isActive = appState.selectedItem?.type === 'audit' && appState.selectedItem?.id === a.filename;
    return `
      <div class="mdd-audit-item${isActive ? ' active' : ''}" data-audit-id="${esc(a.filename)}">
        <span class="mdd-audit-type-tag">${AUDIT_LABELS[a.type] ?? 'REPORT'}</span>
        <span class="mdd-audit-date">${esc(a.date || a.filename)}</span>
      </div>`;
  }).join('');

  container.querySelectorAll('.mdd-audit-item').forEach(item => {
    item.addEventListener('click', () => {
      appState.selectedItem = { type: 'audit', id: item.dataset.auditId };
      renderAuditList();
      renderDetail();
    });
  });
}

export function renderGraph() {
  const body = el('mdd-graph-body');
  if (!body) return;

  const { ascii, orphans } = appState.graph;

  if (!ascii && !orphans?.length) {
    body.innerHTML = '<div class="mdd-graph-empty">No dependencies between features</div>';
    return;
  }

  // Re-create pre if it was replaced by the empty-state message on a previous render
  let pre = el('mdd-graph-pre');
  if (!pre) {
    pre = document.createElement('pre');
    pre.id = 'mdd-graph-pre';
    pre.className = 'mdd-graph-pre';
    body.innerHTML = '';
    body.appendChild(pre);
  }
  pre.textContent = ascii || '(no graph data)';
}

export function renderDetail() {
  const panel = el('mdd-detail-content');
  if (!panel) return;

  if (!appState.selectedItem) {
    panel.innerHTML = appState.startup
      ? `<div class="mdd-md-body">${renderMarkdown(appState.startup)}</div>`
      : `<div class="mdd-no-docs">Select a feature doc or audit from the left panel.<br>Or run <code>/mdd status</code> to populate startup context.</div>`;
    return;
  }

  if (appState.selectedItem.type === 'doc') {
    const doc = appState.docs.find(d => d.id === appState.selectedItem.id);
    if (!doc) { panel.innerHTML = '<div class="mdd-empty-state">Doc not found</div>'; return; }
    panel.innerHTML = buildDocDetail(doc);
    panel.querySelectorAll('.mdd-chip.clickable').forEach(chip => {
      chip.addEventListener('click', () => {
        const path = chip.dataset.path;
        if (path) navigator.clipboard.writeText(path).catch(() => {});
      });
    });
    return;
  }

  if (appState.selectedItem.type === 'audit') {
    const audit = appState.audits.find(a => a.filename === appState.selectedItem.id);
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
    ${buildDriftWarning(doc)}
    <div class="mdd-doc-meta">
      <div class="mdd-doc-meta-title">${esc(doc.title || doc.id)}</div>
      <div class="mdd-doc-meta-row">
        <span class="mdd-status-badge ${statusBadgeClass(doc.status)}">${esc(doc.status || '?')}</span>
        <span style="color:var(--subtext);font-size:11px">phase: ${esc(doc.phase || '—')}</span>
        <span style="color:var(--subtext);font-size:11px">synced: ${esc(doc.lastSynced || 'never')}</span>
      </div>
      ${sourceChips ? `<div class="mdd-doc-meta-row"><span class="mdd-doc-meta-label">SOURCE</span>${sourceChips}</div>` : ''}
      ${depChips    ? `<div class="mdd-doc-meta-row"><span class="mdd-doc-meta-label">DEPENDS ON</span>${depChips}</div>` : ''}
      ${issueList   ? `<div style="margin-top:0.5rem">${issueList}</div>` : ''}
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
