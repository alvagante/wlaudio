// ── Learning Mode (IIFE — plain script, not a module) ─────────────────────
(function () {
  'use strict';

  const STORAGE_KEY = 'wlaudio-learning';
  const HIDE_DELAY  = 200; // ms before tooltip hides after mouseleave

  // ── State ────────────────────────────────────────────────────────────────

  let enabled    = false;
  let hideTimer  = null;

  // ── DOM elements (created once) ──────────────────────────────────────────

  function createTooltip() {
    const el = document.createElement('div');
    el.id = 'lm-tooltip';
    el.className = 'lm-tooltip lm-hidden';
    document.body.appendChild(el);
    return el;
  }

  function createPanel() {
    const el = document.createElement('div');
    el.id = 'lm-panel';
    el.className = 'lm-panel lm-hidden';
    el.innerHTML = `
      <div class="lm-panel-header">
        <span id="lm-panel-title" class="lm-panel-title"></span>
        <button class="lm-panel-close" id="lm-panel-close">✕</button>
      </div>
      <div id="lm-panel-body" class="lm-panel-body"></div>
    `;
    document.body.appendChild(el);
    return el;
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────

  function showTooltip(text, targetEl) {
    if (!enabled) return;
    clearTimeout(hideTimer);

    const tooltip = document.getElementById('lm-tooltip');
    if (!tooltip) return;

    tooltip.textContent = text;
    tooltip.classList.remove('lm-hidden');

    const rect = targetEl.getBoundingClientRect();
    const tw   = tooltip.offsetWidth;
    const th   = tooltip.offsetHeight;

    // Prefer below, fall back to above
    let top  = rect.bottom + 8;
    let left = rect.left + rect.width / 2 - tw / 2;

    if (top + th > window.innerHeight - 8) top = rect.top - th - 8;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));

    tooltip.style.top  = top + 'px';
    tooltip.style.left = left + 'px';
  }

  function hideTooltip() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const tooltip = document.getElementById('lm-tooltip');
      if (tooltip) tooltip.classList.add('lm-hidden');
    }, HIDE_DELAY);
  }

  // ── Detail panel ──────────────────────────────────────────────────────────

  function showPanel(raw) {
    if (!enabled) return;
    const sep   = raw.indexOf('|');
    const title = sep >= 0 ? raw.slice(0, sep) : 'Info';
    const body  = sep >= 0 ? raw.slice(sep + 1) : raw;

    const panel     = document.getElementById('lm-panel');
    const titleEl   = document.getElementById('lm-panel-title');
    const bodyEl    = document.getElementById('lm-panel-body');
    if (!panel || !titleEl || !bodyEl) return;

    titleEl.textContent = title;
    bodyEl.textContent  = body;
    panel.classList.remove('lm-hidden');
  }

  function hidePanel() {
    const panel = document.getElementById('lm-panel');
    if (panel) panel.classList.add('lm-hidden');
  }

  // ── Toggle ────────────────────────────────────────────────────────────────

  function setEnabled(val) {
    enabled = val;
    document.body.classList.toggle('learning-mode', enabled);

    const btn = document.getElementById('learning-btn');
    if (btn) {
      btn.textContent = enabled ? 'ON' : 'OFF';
      btn.setAttribute('aria-pressed', String(enabled));
    }

    try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch {}

    if (!enabled) {
      const tooltip = document.getElementById('lm-tooltip');
      if (tooltip) tooltip.classList.add('lm-hidden');
      hidePanel();
    }
  }

  // ── Event delegation ──────────────────────────────────────────────────────

  document.addEventListener('mouseover', function (e) {
    if (!enabled) return;
    const target = e.target.closest('[data-tooltip]');
    if (target) showTooltip(target.dataset.tooltip, target);
  });

  document.addEventListener('mouseout', function (e) {
    if (!enabled) return;
    if (e.target.closest('[data-tooltip]')) hideTooltip();
  });

  document.addEventListener('click', function (e) {
    // Detail panel trigger
    if (enabled) {
      const target = e.target.closest('[data-learn-detail]');
      if (target) {
        e.stopPropagation();
        showPanel(target.dataset.learnDetail);
        return;
      }
    }

    // Panel close button
    if (e.target.id === 'lm-panel-close') {
      hidePanel();
      return;
    }

    // Click outside panel closes it
    const panel = document.getElementById('lm-panel');
    if (panel && !panel.classList.contains('lm-hidden') && !panel.contains(e.target)) {
      hidePanel();
    }

    // Toggle button
    if (e.target.id === 'learning-btn') {
      setEnabled(!enabled);
    }
  });

  // ── Boot ──────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    createTooltip();
    createPanel();

    // Restore persisted state
    let saved = false;
    try { saved = localStorage.getItem(STORAGE_KEY) === '1'; } catch {}
    setEnabled(saved);
  });

})();
