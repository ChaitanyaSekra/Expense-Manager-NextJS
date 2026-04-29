// ── Cache name is injected at build time by next.config.mjs ──────────────────
// __SEKRA_VERSION__ is replaced with the git commit SHA (or timestamp) on each
// Vercel deploy, so every new deploy gets a fresh cache name and the old one
// is deleted automatically.
const CACHE_NAME = 'sekra-mok1ciuh';

// Assets to pre-cache on install
const PRECACHE_URLS = ['/', '/manifest.json'];

// ── Install: pre-cache shell assets ──────────────────────────────────────────
self.addEventListener('install', event => {
  // Skip waiting so the new SW activates immediately without requiring a tab refresh
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
});

// ── Activate: delete ALL old sekra-* caches ──────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('sekra-') && key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())  // take control of all open tabs immediately
  );
});

// ── Fetch: network-first for Next.js internals, cache-first for everything else
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept non-GET or cross-origin requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Network-first for Next.js build chunks and API routes (always fresh)
  if (url.pathname.startsWith('/_next/') || url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          // Cache successful _next responses for offline fallback
          if (res.ok && url.pathname.startsWith('/_next/static/')) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for everything else (icons, manifest, fonts, etc.)
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (!res.ok) return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        return res;
      });
    })
  );
});