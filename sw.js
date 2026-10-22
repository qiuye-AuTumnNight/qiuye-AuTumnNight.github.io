/*
 * 站点 Service Worker。
 *
 * 注意：这个仓库是用户站点，作用域是站点根目录，也就是同一台主机上的
 * /snake-game/、/tetris/ 等也落在作用域内。所以这里只处理白名单里属于
 * 站点自己的文件，其余请求一律不拦截（不调用 respondWith 就是默认走网络），
 * 避免把游戏页面缓存进来、或在离线时错误地回退成首页。
 */
const CACHE = 'leaves-v2';
const ASSETS = new Set([
  '/',
  '/index.html',
  '/games.html',
  '/styles.css',
  '/blog.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/covers/cover-snake.webp',
  '/covers/cover-snake.png',
  '/covers/cover-tetris.webp',
  '/covers/cover-tetris.png',
  '/covers/cover-forge.webp',
  '/covers/cover-forge.png',
  '/covers/cover-cardgame.webp',
  '/covers/cover-cardgame.png',
  '/covers/cover-stock.webp',
  '/covers/cover-stock.png',
]);

// 文章和留言要尽快看到新内容，所以这一个走「网络优先」，失败才退回缓存
const NETWORK_FIRST = new Set(['/data.json']);

const EMPTY_DATA = '{"posts":[],"comments":[]}';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // 逐个添加而不是 cache.addAll：addAll 是原子的，任何一个资源失败都会让
      // 整个离线缓存为空，手机弱网下等于「离线可用」静默失效
      .then((cache) => Promise.allSettled(Array.from(ASSETS).map((url) => cache.add(url))))
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

  if (url.origin !== self.location.origin) return;

  if (NETWORK_FIRST.has(url.pathname)) {
    event.respondWith(
      // 带上 ?t= 的请求只用于绕过 HTTP 缓存；写缓存时统一用不带参数的路径
      fetch(url.origin + url.pathname, { cache: 'no-store' })
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(url.pathname, copy));
          }
          return response;
        })
        .catch(() => caches.match(url.pathname).then((cached) => cached
          || new Response(EMPTY_DATA, { headers: { 'Content-Type': 'application/json; charset=utf-8' } })))
    );
    return;
  }

  // 只接管站点自己的资源；子目录里的游戏由各自的 SW 负责
  if (!ASSETS.has(url.pathname)) return;

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
