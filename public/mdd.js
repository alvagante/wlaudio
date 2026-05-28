// ── MDD Dashboard — data, WebSocket, and init ─────────────────────────────────

import { appState, el } from './mdd-state.js';
import { render } from './mdd-render.js';

// ── Data fetching ──────────────────────────────────────────────────────────────

async function loadData() {
  try {
    const res  = await fetch('/api/v1/mdd');
    const data = await res.json();
    Object.assign(appState, data);
    render();
  } catch {
    document.getElementById('mdd-doc-list').innerHTML =
      '<div class="mdd-empty-state">Failed to load MDD data. Is the server running?</div>';
  }
}

// ── WebSocket ──────────────────────────────────────────────────────────────────

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
  if (dot)   dot.className     = `dot ${up ? 'connected' : 'disconnected'}`;
  if (label) label.textContent = up ? 'LIVE' : 'RECONNECTING';
}

// ── UI controls ────────────────────────────────────────────────────────────────

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

function initRefresh() {
  const btn = el('mdd-refresh-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.textContent = '↻';
    loadData().finally(() => { btn.textContent = '↻'; });
  });
}

// ── Init ───────────────────────────────────────────────────────────────────────

loadData();
connectWs();
initGraphToggle();
initRefresh();
