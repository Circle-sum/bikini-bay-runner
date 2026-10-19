// PWA 检查：manifest 完整性、Service Worker 激活、外壳预缓存，以及断网后还能不能玩。
// 与 check-game / check-economy 同为 playwright 的 `async (page) => {...}` 形式。
async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const BASE = 'http://127.0.0.1:4173';
  const results = [];
  const assert = (value, message) => { if (!value) throw new Error(message); results.push(message); };

  await page.goto(BASE + '/');
  await page.locator('#title').waitFor({ state: 'visible' });

  // ---- manifest ----
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return { missing: true };
    const res = await fetch(link.href);
    return { status: res.status, body: await res.json() };
  });
  assert(!manifest.missing, 'index.html 声明了 manifest');
  assert(manifest.status === 200, 'manifest.webmanifest 可访问');
  assert(!!manifest.body.name && !!manifest.body.start_url, 'manifest 含 name 与 start_url');
  assert(manifest.body.display === 'standalone', 'manifest 声明 display: standalone');
  const sizes = (manifest.body.icons || []).map(icon => icon.sizes);
  assert(sizes.includes('192x192') && sizes.includes('512x512'), 'manifest 提供 192 与 512 图标');

  const iconStatus = await page.evaluate(async (urls) => {
    const out = [];
    for (const url of urls) { try { out.push((await fetch(url)).status); } catch { out.push(0); } }
    return out;
  }, manifest.body.icons.map(icon => new URL(icon.src, BASE + '/').href));
  assert(iconStatus.every(status => status === 200), 'manifest 里的图标文件都能取到');

  // ---- Service Worker ----
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise(resolve => setTimeout(() => resolve(null), 10000)),
    ]);
    if (!registration) return { supported: true, timeout: true };
    return { supported: true, active: !!registration.active, scope: registration.scope };
  });
  assert(sw.supported, '浏览器支持 Service Worker');
  assert(!sw.timeout && sw.active, 'Service Worker 已激活');

  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const key = keys.find(name => name.startsWith('bikini-bay-run'));
    if (!key) return null;
    const cache = await caches.open(key);
    return (await cache.keys()).map(request => new URL(request.url).pathname);
  });
  assert(!!cached, '存在 bikini-bay-run 缓存');
  assert(cached.includes('/index.html') && cached.includes('/assets/ui.css'), '外壳（HTML/CSS）已预缓存');
  assert(cached.includes('/assets/chars/characters.js'), '角色数据已预缓存');
  assert(cached.some(path => path.endsWith('.webp')), '角色立绘已预缓存');

  // ---- 离线可玩 ----
  await page.context().setOffline(true);
  await page.reload();
  await page.locator('#title').waitFor({ state: 'visible', timeout: 10000 });
  assert(true, '断网后刷新仍能进入首页');
  const offline = await page.evaluate(() => {
    const cast = [...document.querySelectorAll('.title-cast img')];
    const loaded = cast.filter(img => img.complete && img.naturalWidth > 0).length;
    return { castCount: cast.length, loaded, actionButtons: document.querySelectorAll('.title-actions .btn').length };
  });
  assert(offline.castCount === 4 && offline.loaded === 4, '断网后四位跑者立绘仍全部显示');
  assert(offline.actionButtons >= 2, '断网后操作按钮仍在');

  const offlineRun = await page.evaluate(() => {
    gotoSelect();
    startRun();
    return { state: game.state, props: game.props.length };
  });
  assert(offlineRun.state === 'playing' && offlineRun.props > 0, '断网后仍能开始一局并生成场景');

  await page.context().setOffline(false);
  if (errors.length) throw new Error('页面错误: ' + errors.join('; '));
  return { passed: results.length, results, cached: cached.length };
}
