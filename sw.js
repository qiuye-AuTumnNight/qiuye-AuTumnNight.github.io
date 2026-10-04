/*
 * 导航页的 Service Worker。
 *
 * 注意：这个仓库是用户站点，作用域是站点根目录，也就是同一台主机上的
 * /snake-game/ 和 /tetris/ 也落在作用域内。所以这里只处理白名单里属于
 * 导航页自己的文件，其余请求一律不拦截（不调用 respondWith 就是默认走网络），
 * 避免把游戏页面缓存到导航页的缓存里、或在离线时错误地回退成导航页。
 */
const CACHE = 'games-hub-v1';
const ASSETS = new Set([
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/covers/cover-snake.png',
  '/covers/cover-tetris.png',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(Array.from(ASSETS)))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }

  // 只接管导航页自己的资源；子目录里的游戏由各自的 SW 负责
  if (url.origin !== self.location.origin || !ASSETS.has(url.pathname)) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) {
        fetch(request)
          .then((response) => {
            if (response && response.ok) {
              caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
            }
          })
          .catch(() => {});
        return cached;
      }
      return fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html'));
    })
  );
});
