const CACHE_NAME = 'household-budget-shell-v6';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './config.js',
  './css/style.css',
  './js/app.js',
  './js/auth.js',
  './js/drive-api.js',
  './js/sheets-api.js',
  './js/quick-add.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // googleapis.com 호출은 항상 네트워크로만 처리 (인증/데이터 요청을 캐싱하지 않음).
  if (url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('google.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
