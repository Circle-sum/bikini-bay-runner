/* 比基尼湾跑酷 · Service Worker
 *
 * 目标：首屏离线可玩 + 二次进入秒开。
 * 策略：
 *   - 应用外壳（HTML/CSS/JS/立绘/manifest）安装时预缓存；
 *   - 导航请求走「网络优先」：发新版后用户刷新就能拿到新页面，离线时回退缓存；
 *   - 其余同源 GET 走缓存优先；未预缓存的资源直连网络，不做运行时缓存，
 *     避免把测试页、临时文件之类的请求也塞进缓存。
 *
 * 发版时把 VERSION 加一即可让旧缓存整体失效。
 */
const VERSION = 'v5';
const CACHE = `bikini-bay-run-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/ui.css',
  './assets/chars/characters.js',
  './assets/world/world.js',
  './assets/chars/spongebob.webp',
  './assets/chars/patrick.webp',
  './assets/chars/squidward.webp',
  './assets/chars/sandy.webp',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 单个资源失败不应该让整个安装失败（例如图标被改名）
    await Promise.all(SHELL.map(url => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cached = await caches.match('./index.html', { ignoreSearch: true });
        return cached || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const hit = await caches.match(request, { ignoreSearch: true });
    if (hit) return hit;
    return fetch(request);
  })());
});
