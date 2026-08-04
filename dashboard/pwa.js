/* Huis-PWA: registreert de service worker en tekent de tabbalk onderin.
   Eén bestand, ingeladen door alle vijf de dashboards. */
(function () {
  'use strict';

  // 1) Service worker registreren. Faalt stil op http:// of een niet-vertrouwd
  //    (self-signed) certificaat — de app werkt dan gewoon zonder offline-cache.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    });
  }

  // 2) Tabbalk. Actieve tab wordt bepaald op basis van de bestandsnaam.
  var TABS = [
    { href: 'index.html',             label: 'Start',    icon: '🏠' }, // 🏠
    { href: 'energie.html',           label: 'Energie',  icon: '⚡' },       // ⚡
    { href: 'kosten.html',            label: 'Kosten',   icon: '💶' }, // 💶
    { href: 'laadadvies.html',        label: 'Laden',    icon: '🔌' }, // 🔌
    { href: 'batterijsimulator.html', label: 'Batterij', icon: '🔋' }  // 🔋
  ];

  var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (here === '') here = 'index.html';

  var style = document.createElement('style');
  style.textContent = [
    ':root{--pwa-tabbar-h:54px}',
    'body{padding-bottom:calc(var(--pwa-tabbar-h) + env(safe-area-inset-bottom,0px) + 10px)!important}',
    '.pwa-tabbar{position:fixed;left:0;right:0;bottom:0;z-index:99999;display:flex;',
    'background:rgba(16,20,32,.88);-webkit-backdrop-filter:saturate(180%) blur(20px);',
    'backdrop-filter:saturate(180%) blur(20px);border-top:1px solid rgba(255,255,255,.09);',
    'padding-bottom:env(safe-area-inset-bottom,0px)}',
    '.pwa-tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'gap:3px;padding:8px 2px 7px;color:#8a97ad;text-decoration:none;',
    '-webkit-tap-highlight-color:transparent;font:11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
    '.pwa-tab .i{font-size:20px;line-height:1;filter:grayscale(1);opacity:.65;transition:opacity .15s}',
    '.pwa-tab .l{letter-spacing:.01em}',
    '.pwa-tab:active .i{opacity:1}',
    '.pwa-tab[aria-current="page"]{color:#4f8cff}',
    '.pwa-tab[aria-current="page"] .i{filter:none;opacity:1}',
    '@media print{.pwa-tabbar{display:none}}'
  ].join('');

  function build() {
    if (document.querySelector('.pwa-tabbar')) return;
    if (!document.head.contains(style)) document.head.appendChild(style);
    var nav = document.createElement('nav');
    nav.className = 'pwa-tabbar';
    nav.setAttribute('aria-label', 'App-navigatie');
    TABS.forEach(function (t) {
      var a = document.createElement('a');
      a.className = 'pwa-tab';
      a.href = './' + t.href;
      if (t.href.toLowerCase() === here) a.setAttribute('aria-current', 'page');
      var i = document.createElement('span');
      i.className = 'i'; i.setAttribute('aria-hidden', 'true'); i.textContent = t.icon;
      var l = document.createElement('span');
      l.className = 'l'; l.textContent = t.label;
      a.appendChild(i); a.appendChild(l);
      nav.appendChild(a);
    });
    document.body.appendChild(nav);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
