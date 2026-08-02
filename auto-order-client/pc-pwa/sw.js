const CACHE = 'gmao-pwa-v012';
const ASSETS = [
  './index.html',
  './app.js',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    for (const asset of ASSETS) {
      try {
        const response = await fetch(asset, { cache: 'reload' });
        if (response.ok) {
          await cache.put(asset, response);
        }
      } catch (error) {
        console.warn('[GMAO_SW_V006] cache skipped', asset, error);
      }
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key !== CACHE)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      return response;
    } catch (error) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      throw error;
    }
  })());
});
