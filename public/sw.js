const CACHE_NAME = 'adaptus-v71';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/styles.css',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(STATIC_ASSETS.map(url =>
        fetch(url, { cache: 'no-store' }).then(r => cache.put(url, r))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first, bypass HTTP cache only for our own files (not CDN scripts)
self.addEventListener('fetch', (event) => {
  const sameOrigin = event.request.url.startsWith(self.location.origin);
  event.respondWith(
    fetch(event.request, sameOrigin ? { cache: 'no-store' } : {})
      .then(response => {
        if (event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
