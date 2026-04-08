// Apply saved theme immediately — runs before paint to avoid flash
(function () {
  const t = localStorage.getItem('wlaudio-theme') || 'high-contrast';
  if (t !== 'high-contrast') document.documentElement.setAttribute('data-theme', t);
})();
