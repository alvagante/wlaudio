/* global Terminal, FitAddon */

// ── State ──────────────────────────────────────────────────────────────────

let ws = null;
let wsReady = false;
const sessions = new Map(); // terminalId → { term, fitAddon, el }
let activeTerminalId = null;

// ── WebSocket ──────────────────────────────────────────────────────────────

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.addEventListener('open', () => {
    wsReady = true;
    setConnStatus(true);
    // Re-subscribe all existing sessions after reconnect.
    // The server no-ops if the terminalId already exists, so this safely restores output routing.
    for (const [terminalId, s] of sessions) {
      if (!s.exited) {
        sendWs('terminal:create', {
          terminalId,
          cwd: s.cwd,
          cols: s.term.cols,
          rows: s.term.rows,
        });
      }
    }
  });

  ws.addEventListener('close', () => {
    wsReady = false;
    setConnStatus(false);
    setTimeout(connectWs, 2000);
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.type === 'terminal:output') {
      const s = sessions.get(msg.data.terminalId);
      if (s) s.term.write(msg.data.data);
    }

    if (msg.type === 'terminal:exit') {
      const { terminalId, exitCode } = msg.data;
      const s = sessions.get(terminalId);
      if (s) {
        s.term.write(`\r\n\x1b[33m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
        markTabExited(terminalId);
      }
    }
  });
}

function sendWs(type, data) {
  if (ws && wsReady) ws.send(JSON.stringify({ type, data }));
}

// ── Launch ─────────────────────────────────────────────────────────────────

document.getElementById('term-launch-btn').addEventListener('click', () => {
  const select = document.getElementById('term-project-select');
  const input  = document.getElementById('term-cwd-input');
  const cwd    = input.value.trim() || select.value;
  if (!cwd) return;
  launchTerminal(cwd);
});

function launchTerminal(cwd) {
  const terminalId = `t-${Date.now()}`;
  const container  = document.getElementById('term-container');
  const empty      = document.getElementById('term-empty');

  // Create xterm instance
  const term = new Terminal({
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.2,
    theme: getXtermTheme(),
    cursorBlink: true,
    allowProposedApi: true,
    scrollback: 5000,
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  // Create a wrapper div for this terminal instance
  const wrapper = document.createElement('div');
  wrapper.className = 'term-instance';
  wrapper.dataset.id = terminalId;
  container.appendChild(wrapper);

  term.open(wrapper);
  fitAddon.fit();

  sessions.set(terminalId, { term, fitAddon, el: wrapper, cwd, exited: false });

  // Send create message
  sendWs('terminal:create', {
    terminalId,
    cwd,
    cols: term.cols,
    rows: term.rows,
  });

  // Forward keystrokes
  term.onData((data) => sendWs('terminal:input', { terminalId, data }));

  // Add tab
  addTab(terminalId, cwd);
  switchToTerminal(terminalId);

  empty.classList.add('hidden');
  container.classList.remove('hidden');

  // Resize observer
  const ro = new ResizeObserver(() => {
    fitAddon.fit();
    sendWs('terminal:resize', { terminalId, cols: term.cols, rows: term.rows });
  });
  ro.observe(wrapper);
}

// ── Tab management ─────────────────────────────────────────────────────────

function addTab(terminalId, cwd) {
  const label = cwd.split('/').pop() || cwd;
  const list  = document.getElementById('term-tab-list');
  const li    = document.createElement('li');
  li.className = 'term-tab';
  li.dataset.id = terminalId;
  li.innerHTML = `
    <span class="term-tab-label" title="${escHtml(cwd)}">${escHtml(label)}</span>
    <button class="term-tab-close" title="Close">✕</button>
  `;
  li.querySelector('.term-tab-label').addEventListener('click', () => switchToTerminal(terminalId));
  li.querySelector('.term-tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTerminal(terminalId);
  });
  list.appendChild(li);
}

function switchToTerminal(terminalId) {
  activeTerminalId = terminalId;

  // Show/hide instances
  for (const [id, s] of sessions) {
    s.el.classList.toggle('hidden', id !== terminalId);
    if (id === terminalId) s.fitAddon.fit();
  }

  // Highlight active tab
  for (const li of document.querySelectorAll('.term-tab')) {
    li.classList.toggle('active', li.dataset.id === terminalId);
  }
}

function markTabExited(terminalId) {
  const li = document.querySelector(`.term-tab[data-id="${terminalId}"]`);
  if (li) li.classList.add('exited');
  const s = sessions.get(terminalId);
  if (s) s.exited = true;
}

function closeTerminal(terminalId) {
  sendWs('terminal:close', { terminalId });

  const s = sessions.get(terminalId);
  if (s) {
    s.term.dispose();
    s.el.remove();
    sessions.delete(terminalId);
  }

  const li = document.querySelector(`.term-tab[data-id="${terminalId}"]`);
  if (li) li.remove();

  // Switch to next available terminal or show empty state
  if (activeTerminalId === terminalId) {
    activeTerminalId = null;
    if (sessions.size > 0) {
      switchToTerminal(sessions.keys().next().value);
    } else {
      document.getElementById('term-empty').classList.remove('hidden');
      document.getElementById('term-container').classList.add('hidden');
    }
  }
}

// ── Projects loader ────────────────────────────────────────────────────────

async function loadProjects() {
  try {
    const res  = await fetch('/api/v1/projects');
    const data = await res.json();
    const sel  = document.getElementById('term-project-select');
    sel.innerHTML = '<option value="">— select project —</option>';
    for (const p of data) {
      const opt = document.createElement('option');
      opt.value       = p.projectPath;
      opt.textContent = `${p.projectName}  (${p.projectPath})`;
      sel.appendChild(opt);
    }
    // Sync input with select
    sel.addEventListener('change', () => {
      document.getElementById('term-cwd-input').value = sel.value;
    });
  } catch {
    // silently fail — user can still type path manually
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function setConnStatus(connected) {
  const dot   = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  dot.className   = `dot ${connected ? 'connected' : 'disconnected'}`;
  label.textContent = connected ? 'CONNECTED' : 'DISCONNECTED';
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getXtermTheme() {
  const root = getComputedStyle(document.documentElement);
  const get  = (v) => root.getPropertyValue(v).trim();
  return {
    background:    get('--bg')       || '#0d0d0d',
    foreground:    get('--text')     || '#e0e0e0',
    cursor:        get('--blue')     || '#00D1FF',
    selectionBackground: get('--overlay') || '#1a1a1a',
    black:   '#000000', red:     '#cc3333', green:  '#33cc33', yellow: '#cccc33',
    blue:    '#3333cc', magenta: '#cc33cc', cyan:   '#33cccc', white:  '#cccccc',
    brightBlack: '#555555', brightRed: '#ff5555', brightGreen: '#55ff55',
    brightYellow: '#ffff55', brightBlue: '#5555ff', brightMagenta: '#ff55ff',
    brightCyan: '#55ffff', brightWhite: '#ffffff',
  };
}

// Check for ?cwd= query param (deep-link from Projects page)
function checkDeepLink() {
  const params = new URLSearchParams(location.search);
  const cwd    = params.get('cwd');
  if (cwd) {
    document.getElementById('term-cwd-input').value = cwd;
    // Wait for WS to be ready before launching
    const attempt = () => {
      if (wsReady) launchTerminal(cwd);
      else setTimeout(attempt, 100);
    };
    attempt();
  }
}

// ── Init ───────────────────────────────────────────────────────────────────

connectWs();
loadProjects();
checkDeepLink();
