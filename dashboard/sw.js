/* Service worker voor de Huis-PWA.
   - App-shell (de 5 pagina's + iconen + pwa.js) wordt bij install gecachet,
     zodat de app offline opent.
   - JSON-data: network-first met cache-fallback → je ziet de laatst bekende
     stand als je even geen verbinding hebt.
   Let op: iOS registreert een service worker alléén op HTTPS met een
   vertrouwd certificaat. Op het self-signed VPS-cert werkt de app wél als
   app-tegel (schermvullend), maar niet offline. Zie het runbook. */
const CACHE = 'huis-pwa-v5';
const SHELL = [
  './',
  './index.html',
  './vandaag.html',
  './energie.html',
  './kosten.html',
  './laadadvies.html',
  './batterijsimulator.html',
  './pwa.js',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Per bestand cachen: één 404 mag de hele install niet laten mislukken.
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // JSON (energie-live / kosten-overzicht / laadadvies): vers ophalen, val
  // terug op de laatst gecachte versie bij storing/offline.
  if (url.pathname.endsWith('.json')) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await caches.match(req);
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }

  // Pagina's & assets: stale-while-revalidate (snel uit cache, ververst op de achtergrond).
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => cached);
    return cached || network;
  })());
});
