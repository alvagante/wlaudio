// Apply saved theme immediately — runs before paint to avoid flash
(function () {
  const t = localStorage.getItem('wlaudio-theme') || 'flexoki-light';
  if (t !== 'mocha') document.documentElement.setAttribute('data-theme', t);
})();
