// ── MDD shared state and pure utilities ───────────────────────────────────────
// Kept separate so mdd-render.js and mdd.js can both import without circularity.

export const appState = {
  docs:    [],
  audits:  [],
  startup: '',
  graph:   { edges: [], orphans: [], ascii: '' },
  summary: { docCount: 0, inSync: 0, drifted: 0, brokenRef: 0, untracked: 0, knownIssueCount: 0, auditCount: 0 },
  /** Currently selected item in the left panel. */
  selectedItem: null,   // { type: 'doc'|'audit', id: string } | null
};

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function el(id) {
  return document.getElementById(id);
}

export function renderMarkdown(md) {
  if (!md) return '<span style="color:var(--dim)">—</span>';
  // marked and DOMPurify loaded as globals from CDN before this module runs.
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
    return `<pre style="white-space:pre-wrap">${esc(md)}</pre>`;
  }
  return DOMPurify.sanitize(marked.parse(md));
}
