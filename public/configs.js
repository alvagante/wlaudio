// ── Configs page ─────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return iso; }
}

// ── Hooks ─────────────────────────────────────────────────────────────────

function renderHooks(hooks, containerId, countId) {
  const container  = document.getElementById(containerId);
  const countEl    = document.getElementById(countId);
  const events     = Object.entries(hooks ?? {});

  let totalHooks = 0;
  events.forEach(([, entries]) => entries.forEach(e => { totalHooks += e.hooks?.length ?? 0; }));
  if (countEl) countEl.textContent = totalHooks;

  if (!events.length) {
    container.innerHTML = '<div class="cfg-empty">No hooks configured</div>';
    return;
  }

  container.innerHTML = events.map(([event, entries]) => `
    <div class="cfg-hook-event">
      <div class="cfg-hook-event-label">${escHtml(event)}</div>
      ${entries.map(entry => `
        <div class="cfg-hook-row">
          <span class="cfg-hook-matcher">${escHtml(entry.matcher)}</span>
          <div class="cfg-hook-commands">
            ${(entry.hooks ?? []).map(h => `
              <span class="cfg-hook-cmd">${escHtml(h.command)}</span>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

// ── Permissions ───────────────────────────────────────────────────────────

function renderRules(rules, containerId, countId, cls) {
  const container = document.getElementById(containerId);
  const countEl   = document.getElementById(countId);
  if (countEl) countEl.textContent = rules?.length ?? 0;

  if (!rules?.length) {
    container.innerHTML = '<div class="cfg-empty">None</div>';
    return;
  }
  container.innerHTML = rules.map(r => `
    <div class="cfg-rule ${cls}">${escHtml(r)}</div>
  `).join('');
}

// ── MCP servers ───────────────────────────────────────────────────────────

function renderMcp(mcpServers) {
  const section  = document.getElementById('cfg-mcp-section');
  const list     = document.getElementById('cfg-mcp-list');
  const countEl  = document.getElementById('cfg-mcp-count');
  const entries  = Object.entries(mcpServers ?? {});

  countEl.textContent = entries.length;

  if (!entries.length) {
    section.classList.add('hidden');
    return;
  }

  list.innerHTML = entries.map(([name, cfg]) => {
    const details = Object.entries(cfg ?? {})
      .filter(([k]) => k !== 'env')
      .map(([k, v]) => `<div><span class="cfg-mcp-key">${escHtml(k)}:</span> ${escHtml(typeof v === 'object' ? JSON.stringify(v) : String(v))}</div>`)
      .join('');
    return `
      <div class="cfg-mcp-row">
        <span class="cfg-mcp-name">${escHtml(name)}</span>
        <div class="cfg-mcp-detail">${details}</div>
      </div>
    `;
  }).join('');
}

// ── Plugins ───────────────────────────────────────────────────────────────

function renderPlugins(plugins) {
  const section = document.getElementById('cfg-plugins-section');
  const list    = document.getElementById('cfg-plugins-list');
  const countEl = document.getElementById('cfg-plugin-count');
  countEl.textContent = plugins?.length ?? 0;

  if (!plugins?.length) {
    section.classList.add('hidden');
    return;
  }

  list.innerHTML = plugins.map(p => `
    <div class="cfg-plugin-row">
      <span class="cfg-plugin-name">${escHtml(p.plugin)}</span>
      <span class="cfg-plugin-text">${escHtml(p.text || p.reason || '—')}</span>
      <span class="cfg-plugin-date">${fmtDate(p.added_at)}</span>
    </div>
  `).join('');
}

// ── CLAUDE.md expandable ──────────────────────────────────────────────────

function renderClaudeMd(content, preId, titleSelector) {
  if (!content) {
    document.getElementById(preId)?.closest('.cfg-section')?.classList.add('hidden');
    return;
  }
  const pre = document.getElementById(preId);
  if (pre) pre.textContent = content;
}

function initExpandables() {
  document.querySelectorAll('.cfg-expandable').forEach(title => {
    title.addEventListener('click', () => {
      const targetId = title.dataset.target;
      const body     = document.getElementById(targetId);
      if (!body) return;
      const isOpen = !body.classList.contains('hidden');
      body.classList.toggle('hidden', isOpen);
      title.classList.toggle('open', !isOpen);
    });
  });
}

// ── Project configs ───────────────────────────────────────────────────────

function renderProjects(projects) {
  const container = document.getElementById('cfg-projects');
  const countEl   = document.getElementById('cfg-proj-count');
  countEl.textContent = projects?.length ?? 0;

  if (!projects?.length) {
    container.innerHTML = '<div class="cfg-empty">No project configs found</div>';
    return;
  }

  container.innerHTML = '';

  for (const p of projects) {
    const block = document.createElement('div');
    block.className = 'cfg-project-block';

    const hookCount = Object.values(p.settings?.hooks ?? {})
      .reduce((s, entries) => s + entries.reduce((a, e) => a + (e.hooks?.length ?? 0), 0), 0);
    const allowCount = p.settings?.allow?.length ?? 0;
    const denyCount  = p.settings?.deny?.length  ?? 0;

    const tags = [
      hookCount   ? `<span class="cfg-tag hooks">${hookCount} hooks</span>`       : '',
      (allowCount + denyCount) ? `<span class="cfg-tag perms">${allowCount + denyCount} rules</span>` : '',
      p.claudeMd  ? `<span class="cfg-tag md">CLAUDE.md</span>`                   : '',
      p.localClaudeMd ? `<span class="cfg-tag local-md">CLAUDE.local.md</span>`   : '',
    ].filter(Boolean).join('');

    block.innerHTML = `
      <div class="cfg-project-header">
        <div>
          <div class="cfg-project-name">${escHtml(p.projectName)}</div>
          <div class="cfg-project-path">${escHtml(p.projectPath)}</div>
        </div>
        <div class="cfg-project-badges">${tags}<span class="cfg-expand-icon">▶</span></div>
      </div>
      <div class="cfg-project-body hidden"></div>
    `;

    const header = block.querySelector('.cfg-project-header');
    const body   = block.querySelector('.cfg-project-body');
    const icon   = block.querySelector('.cfg-expand-icon');

    header.addEventListener('click', () => {
      const isOpen = !body.classList.contains('hidden');
      body.classList.toggle('hidden', isOpen);
      icon.style.transform = isOpen ? '' : 'rotate(90deg)';

      // Lazy-render body on first open
      if (!isOpen && !body.dataset.rendered) {
        body.dataset.rendered = '1';
        body.innerHTML = buildProjectBody(p);
      }
    });

    container.appendChild(block);
  }
}

function buildProjectBody(p) {
  const parts = [];

  if (p.settings) {
    const events = Object.entries(p.settings.hooks ?? {});
    if (events.length) {
      parts.push('<div class="cfg-sub-title">Hooks</div>');
      parts.push(events.map(([event, entries]) => `
        <div class="cfg-hook-event">
          <div class="cfg-hook-event-label">${escHtml(event)}</div>
          ${entries.map(entry => `
            <div class="cfg-hook-row">
              <span class="cfg-hook-matcher">${escHtml(entry.matcher)}</span>
              <div class="cfg-hook-commands">
                ${(entry.hooks ?? []).map(h => `<span class="cfg-hook-cmd">${escHtml(h.command)}</span>`).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      `).join(''));
    }

    if (p.settings.allow?.length || p.settings.deny?.length) {
      parts.push('<div class="cfg-sub-title">Permissions</div>');
      parts.push('<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">');
      parts.push('<div>');
      if (p.settings.allow?.length) {
        parts.push(p.settings.allow.map(r => `<div class="cfg-rule allow">${escHtml(r)}</div>`).join(''));
      }
      parts.push('</div><div>');
      if (p.settings.deny?.length) {
        parts.push(p.settings.deny.map(r => `<div class="cfg-rule deny">${escHtml(r)}</div>`).join(''));
      }
      parts.push('</div></div>');
    }

    const mcpEntries = Object.entries(p.settings.mcpServers ?? {});
    if (mcpEntries.length) {
      parts.push('<div class="cfg-sub-title">MCP Servers</div>');
      parts.push(mcpEntries.map(([name, cfg]) => {
        const details = Object.entries(cfg ?? {})
          .filter(([k]) => k !== 'env')
          .map(([k, v]) => `<div><span class="cfg-mcp-key">${escHtml(k)}:</span> ${escHtml(typeof v === 'object' ? JSON.stringify(v) : String(v))}</div>`)
          .join('');
        return `<div class="cfg-mcp-row"><span class="cfg-mcp-name">${escHtml(name)}</span><div class="cfg-mcp-detail">${details}</div></div>`;
      }).join(''));
    }
  }

  if (p.claudeMd) {
    parts.push('<div class="cfg-sub-title">CLAUDE.md</div>');
    parts.push(`<pre class="cfg-md-pre">${escHtml(p.claudeMd)}</pre>`);
  }

  if (p.localClaudeMd) {
    parts.push('<div class="cfg-sub-title">CLAUDE.local.md</div>');
    parts.push(`<pre class="cfg-md-pre">${escHtml(p.localClaudeMd)}</pre>`);
  }

  return parts.join('');
}

// ── Boot ──────────────────────────────────────────────────────────────────

async function init() {
  let data;
  try {
    const res = await fetch('/api/v1/configs');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    document.getElementById('cfg-loading').textContent = `Failed to load configs: ${err.message}`;
    return;
  }

  document.getElementById('cfg-loading').classList.add('hidden');
  document.getElementById('cfg-content').classList.remove('hidden');

  const g = data.global ?? {};

  renderHooks(g.hooks, 'cfg-global-hooks', 'cfg-global-hook-count');
  renderRules(g.allow, 'cfg-allow-list', 'cfg-allow-count', 'allow');
  renderRules(g.deny,  'cfg-deny-list',  'cfg-deny-count',  'deny');
  renderMcp(g.mcpServers);
  renderPlugins(data.plugins);
  renderClaudeMd(data.globalClaudeMd, 'cfg-global-md');
  renderProjects(data.projects);

  initExpandables();
}

document.addEventListener('DOMContentLoaded', init);
