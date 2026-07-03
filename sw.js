const CACHE_NAME = 'household-budget-shell-v9';
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
  './js/onboarding.js',
  './js/local-store.js',
  './js/settings.js',
  './js/dashboard.js',
  './js/fx.js',
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

  // 아이콘처럼 거의 안 바뀌는 파일만 cache-first로 빠르게 서빙한다.
  if (url.pathname.includes('/icons/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // 그 외(HTML/CSS/JS)는 항상 네트워크를 먼저 시도해 최신 코드를 받고,
  // 응답을 캐시에 갱신해둔다 — 개발 중 코드를 고칠 때마다 오래된 캐시가
  // 남아 새 수정 사항이 반영되지 않는 문제를 근본적으로 없애기 위함.
  // 오프라인일 때만 마지막으로 받아둔 캐시로 대체한다.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
