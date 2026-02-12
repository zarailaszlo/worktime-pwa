/* Offline-first service worker (cache-first for static assets) */
const CACHE = 'worktime-pwa-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './time.js',
  './rules.js',
  './db.js',
  './exportImport.js',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => (k === CACHE) ? null : caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req, { ignoreSearch: true });
      if(cached) return cached;
      try{
        const fresh = await fetch(req);
        if(fresh && fresh.ok){
          cache.put(req, fresh.clone());
        }
        return fresh;
      }catch(e){
        // fallback: shell
        return cache.match('./index.html');
      }
    })()
  );
});
