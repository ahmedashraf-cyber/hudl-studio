// Field Studio Service Worker
// Version: 1778053951
// This SW ensures index.html is ALWAYS fresh from network.
// JS files (app.js?v=xxx) are cached forever (immutable, versioned).

const CACHE_NAME = 'fstudio-1778053951';
const JS_CACHE   = 'fstudio-js-1778053951';

self.addEventListener('install', e => {
  // Take control immediately — don't wait for old SW to die
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // Delete ALL old caches from previous versions
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== JS_CACHE)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim()) // take control of all open tabs
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // index.html: ALWAYS fetch from network, never cache
  if (url.pathname === '/' || url.pathname === '/index.html' ||
      (!url.pathname.includes('.') && !url.pathname.startsWith('/js/'))) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // JS files with ?v= param: cache forever (they're immutable/versioned)
  if (url.pathname.startsWith('/js/') && url.search.includes('v=')) {
    e.respondWith(
      caches.open(JS_CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(res => {
            cache.put(e.request, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // CSS, images, fonts: network first, cache fallback
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .catch(() => caches.match(e.request))
  );
});
