(function () {
  var LINKS = [
    { href: '/',               icon: '▪', label: 'DASHBOARD', badgeId: 'db-dash-badge' },
    { href: '/sessions.html',  icon: '◈', label: 'SESSIONS'  },
    { href: '/analytics.html', icon: '◫', label: 'ANALYTICS' },
    { href: '/projects.html',  icon: '◧', label: 'PROJECTS'  },
    { href: '/configs.html',   icon: '◩', label: 'CONFIGS'   },
    { href: '/themes.html',    icon: '◐', label: 'THEMES'    },
    { href: '/terminal.html',  icon: '▷', label: 'TERMINAL'  },
    { href: '/timeline.html',  icon: '◑', label: 'TIMELINE'  },
    { href: '/mdd.html',       icon: '◉', label: 'MDD',      mdd: true },
  ];

  function render(mddInstalled) {
    var nav = document.getElementById('sidebar-nav');
    if (!nav) return;

    var path = window.location.pathname;
    var html = '';

    LINKS.forEach(function (item) {
      if (item.mdd && !mddInstalled) return;
      var active = path === item.href || (path === '/index.html' && item.href === '/');
      var cls = 'sn-link' + (active ? ' active' : '');
      var badge = item.badgeId ? '<span id="' + item.badgeId + '" class="sn-badge"></span>' : '';
      html += '<a href="' + item.href + '" class="' + cls + '">'
            + '<span class="sn-icon">' + item.icon + '</span>'
            + item.label + badge
            + '</a>';
    });

    nav.innerHTML = html;
  }

  fetch('/api/v1/mdd/installed')
    .then(function (r) { return r.json(); })
    .then(function (d) { render(d.installed); })
    .catch(function () { render(false); });
})();
