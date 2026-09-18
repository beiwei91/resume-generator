/*!
 * sw.js —— Service Worker：让「安装后的应用」离线也能打开
 *
 * 策略：
 *   - 安装时预缓存全部静态资源；
 *   - 导航请求走「网络优先，失败回退缓存」，保证在线时总是最新版；
 *   - 其余同源 GET 走「缓存优先 + 后台更新」（stale-while-revalidate）；
 *   - 激活时清理旧版本缓存。
 * 改动静态资源后请把 VERSION 加一。
 */
const VERSION = 'v1';
const CACHE = 'resume-gen-' + VERSION;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/resume.css',
  './assets/app.css',
  './assets/resume-md.js',
  './assets/app.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-256.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 逐个缓存而不是 addAll：单个文件失败（例如少了某个图标）不会让整次安装失败
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res && res.ok) await cache.put(url, res);
      } catch (e) { /* 单个资源失败就跳过，不阻塞安装 */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  // /__alive、/__info、/__shutdown 是本地服务的控制接口：
  // 必须直接走网络（SSE 长连接也不能被缓存），不能交给缓存逻辑处理
  if (url.pathname.indexOf('/__') === 0) return;

  // 页面导航：网络优先，离线时回退到缓存的入口页
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(req);
        // 只把「应用外壳」的响应写回缓存；否则访问任何子页面都会顶掉缓存的入口页
        const isShell = url.pathname === '/' || /\/index\.html$/.test(url.pathname);
        if (isShell && fresh && fresh.ok) cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        return (await cache.match('./index.html')) || (await cache.match('./')) ||
          new Response('离线且没有缓存，请先联网打开一次。', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
      }
    })());
    return;
  }

  // 静态资源：缓存优先，后台静默更新
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await network) || new Response('', { status: 504 });
  })());
});
