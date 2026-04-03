// ── File history tab: groups Write/Edit/Read ops by file path ─────────────
import { escHtml, fmtMs } from './utils.js';

// ── Build file operation index from turns ─────────────────────────────────

function buildFileOps(turns) {
  // Map: filePath → ToolCall[]
  const map = new Map();
  for (const turn of turns) {
    for (const tc of turn.toolCalls ?? []) {
      const path = getFilePath(tc);
      if (!path) continue;
      if (!map.has(path)) map.set(path, []);
      map.get(path).push(tc);
    }
  }
  return map;
}

function getFilePath(tc) {
  if (['Read', 'Write', 'Edit'].includes(tc.name)) return tc.input?.file_path ?? null;
  return null;
}

function shortPath(p) {
  const parts = String(p).split('/').filter(Boolean);
  return parts.length > 4 ? '…/' + parts.slice(-3).join('/') : p;
}

// ── Render file list (left panel) ─────────────────────────────────────────

function opIcon(ops) {
  const hasWrite = ops.some(t => t.name === 'Write');
  const hasEdit  = ops.some(t => t.name === 'Edit');
  const hasRead  = ops.some(t => t.name === 'Read');
  if (hasWrite) return '✎';
  if (hasEdit)  return '✎';
  if (hasRead)  return '○';
  return '·';
}

function opColor(ops) {
  const hasWrite = ops.some(t => t.name === 'Write');
  const hasEdit  = ops.some(t => t.name === 'Edit');
  if (hasWrite || hasEdit) return 'fh-modified';
  return 'fh-read';
}

// ── Render operation detail (right panel) ─────────────────────────────────

function renderOp(tc) {
  const time  = tc.timestamp ? new Date(tc.timestamp).toLocaleTimeString('en', { hour12: false }) : '—';
  const dur   = tc.durationMs != null ? fmtMs(tc.durationMs) : '';
  const isErr = tc.result?.isError;

  if (tc.name === 'Edit') {
    const oldStr = String(tc.input?.old_string ?? '');
    const newStr = String(tc.input?.new_string ?? '');
    return `
      <div class="fh-op">
        <div class="fh-op-header">
          <span class="fh-op-name fh-edit">EDIT</span>
          <span class="fh-op-time">${time}</span>
          ${dur ? `<span class="fh-op-dur">${dur}</span>` : ''}
          ${isErr ? '<span class="fh-op-err">✗</span>' : ''}
        </div>
        <div class="fh-diff">
          <div class="fh-diff-label fh-removed">removed</div>
          <pre class="fh-diff-block fh-diff-old">${escHtml(oldStr)}</pre>
          <div class="fh-diff-label fh-added">added</div>
          <pre class="fh-diff-block fh-diff-new">${escHtml(newStr)}</pre>
        </div>
      </div>`;
  }

  if (tc.name === 'Write') {
    const content = String(tc.input?.content ?? '');
    return `
      <div class="fh-op">
        <div class="fh-op-header">
          <span class="fh-op-name fh-write">WRITE</span>
          <span class="fh-op-time">${time}</span>
          ${dur ? `<span class="fh-op-dur">${dur}</span>` : ''}
          <span class="fh-op-size">${content.length} chars</span>
          ${isErr ? '<span class="fh-op-err">✗</span>' : ''}
        </div>
        <pre class="fh-diff-block fh-diff-new">${escHtml(content)}</pre>
      </div>`;
  }

  if (tc.name === 'Read') {
    const params = [];
    if (tc.input?.offset != null) params.push(`offset ${tc.input.offset}`);
    if (tc.input?.limit  != null) params.push(`limit ${tc.input.limit}`);
    return `
      <div class="fh-op">
        <div class="fh-op-header">
          <span class="fh-op-name fh-read">READ</span>
          <span class="fh-op-time">${time}</span>
          ${dur ? `<span class="fh-op-dur">${dur}</span>` : ''}
          ${params.length ? `<span class="fh-op-params">${escHtml(params.join(', '))}</span>` : ''}
          ${isErr ? '<span class="fh-op-err">✗</span>' : ''}
        </div>
      </div>`;
  }

  return '';
}

// ── Public render function ─────────────────────────────────────────────────

export function renderFileHistory(turns) {
  const listEl  = document.getElementById('fh-file-list');
  const opsEl   = document.getElementById('fh-ops-panel');
  const counter = document.getElementById('fileops-count');

  const fileOps = buildFileOps(turns ?? []);

  // Sort: modified files first, then by op count descending
  const entries = [...fileOps.entries()].sort((a, b) => {
    const aHasChange = a[1].some(t => t.name === 'Write' || t.name === 'Edit') ? 1 : 0;
    const bHasChange = b[1].some(t => t.name === 'Write' || t.name === 'Edit') ? 1 : 0;
    if (bHasChange !== aHasChange) return bHasChange - aHasChange;
    return b[1].length - a[1].length;
  });

  counter.textContent = String(entries.length);

  if (!entries.length) {
    listEl.innerHTML = '<div class="panel-empty">No file operations recorded</div>';
    opsEl.innerHTML  = '';
    return;
  }

  listEl.innerHTML = entries.map(([path, ops], i) => `
    <div class="fh-file-item ${opColor(ops)}" data-index="${i}">
      <span class="fh-file-icon">${opIcon(ops)}</span>
      <span class="fh-file-name" title="${escHtml(path)}">${escHtml(shortPath(path))}</span>
      <span class="fh-file-count">${ops.length}</span>
    </div>
  `).join('');

  function selectFile(index) {
    listEl.querySelectorAll('.fh-file-item').forEach(el => el.classList.remove('active'));
    listEl.querySelector(`[data-index="${index}"]`)?.classList.add('active');
    const [path, ops] = entries[index];
    opsEl.innerHTML = `
      <div class="fh-ops-path">${escHtml(path)}</div>
      ${ops.map(renderOp).join('')}
    `;
  }

  listEl.querySelectorAll('.fh-file-item').forEach(el => {
    el.addEventListener('click', () => selectFile(Number(el.dataset.index)));
  });

  selectFile(0);
}
