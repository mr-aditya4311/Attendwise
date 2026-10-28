// AttendWise service worker. Scope: site root. Bump CACHE_VERSION on every release.
const CACHE_VERSION = 'v1.0.0';
const CACHE_PREFIX = 'attendwise-';
const SHELL_CACHE = CACHE_PREFIX + 'shell-' + CACHE_VERSION;
const STATIC_CACHE = CACHE_PREFIX + 'static-' + CACHE_VERSION;
const OFFLINE_URL = '/offline.html';

// Verified local files only (all exist in the repo root). No cross-origin URLs, no analytics.
const SHELL_ASSETS = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/css/styles.css',
  '/css/pwa.css',
  '/js/engine.js',
  '/js/storage.js',
  '/js/app.js',
  '/js/pwa.js',
  '/assets/favicon.svg',
  '/assets/campus-bg.jpg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-maskable-192.png',
  '/assets/icon-maskable-512.png',
  '/assets/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/assets/') ||
    url.pathname === '/favicon.ico' ||
    url.pathname === '/manifest.webmanifest';
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never touch cross-origin requests (analytics, fonts, Search Console, etc.).
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, then cached shell, then offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached || caches.match(OFFLINE_URL)))
    );
    return;
  }

  // Static assets: cache-first, populate cache on miss.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
  // Everything else goes straight to the network.
});
