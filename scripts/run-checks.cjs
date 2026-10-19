// 一键跑完整回归：起本地服务 → 逐个执行 scripts/check-*.cjs → 关服务 → 汇总退出码。
// 用法:
//   node scripts/run-checks.cjs                    # 跑 scripts/check-game.cjs 与 check-economy.cjs
//   node scripts/run-checks.cjs scripts/check-game.cjs
//   PORT=5000 node scripts/run-checks.cjs
//
// check-*.cjs 是 playwright 的 `async (page) => {...}` 形式，这里把它当模块函数调用。
// 浏览器优先用本机 Chrome（channel: 'chrome'）；CI 或本机没有 Chrome 时
// 回退到 playwright 自带的 chromium（需已 `npx playwright install chromium`）。
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4173);
const BASE = `http://127.0.0.1:${PORT}`;
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['scripts/check-game.cjs', 'scripts/check-economy.cjs', 'scripts/check-progress.cjs', 'scripts/check-versus.cjs', 'scripts/check-world.cjs', 'scripts/check-deepsea.cjs', 'scripts/check-pwa.cjs'];

function startServer() {
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'serve.cjs'), String(PORT)], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

async function waitForServer(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE + '/');
      if (res.ok) return true;
    } catch { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

async function launchBrowser(chromium) {
  const channel = process.env.PW_CHANNEL === undefined ? 'chrome' : process.env.PW_CHANNEL;
  if (channel) {
    try { return await chromium.launch({ channel }); }
    catch { console.warn(`  未能启动 channel=${channel}，回退到自带 chromium`); }
  }
  return chromium.launch();
}

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('缺少 playwright。请先执行: npm install');
    process.exit(2);
  }

  const server = startServer();
  if (!await waitForServer()) {
    server.kill();
    console.error(`本地服务未能在 ${BASE} 启动`);
    process.exit(2);
  }
  console.log(`本地服务就绪: ${BASE}\n`);

  const browser = await launchBrowser(chromium);
  const failures = [];
  let assertionTotal = 0;

  for (const rel of files) {
    const file = path.resolve(root, rel);
    const label = path.basename(file);
    if (!fs.existsSync(file)) { failures.push(`${label}(文件不存在)`); continue; }

    // check 脚本里写死的 127.0.0.1:4173 改写成实际端口，便于 PORT=xxxx 时也能跑
    const source = fs.readFileSync(file, 'utf8').trim().replace(/http:\/\/127\.0\.0\.1:\d+/g, BASE);
    const check = eval(`(${source})`);
    if (typeof check !== 'function') { failures.push(`${label}(不是 async (page) => {} 形式)`); continue; }

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    context.setDefaultTimeout(15000);
    const page = await context.newPage();
    const started = Date.now();
    try {
      const result = await check(page);
      const count = result && typeof result === 'object' && 'passed' in result ? result.passed : null;
      if (count !== null) assertionTotal += count;
      console.log(`✓ ${label} 通过 (${((Date.now() - started) / 1000).toFixed(1)}s)` +
        (count !== null ? `  ·  ${count} 条断言` : ''));
    } catch (error) {
      failures.push(label);
      console.error(`✗ ${label} 失败 (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      console.error('  ' + (error && error.message ? error.message.split('\n')[0] : String(error)));
    } finally {
      await context.close();
    }
  }

  await browser.close();
  server.kill();

  console.log(`\n共 ${files.length} 个检查，失败 ${failures.length} 个，断言 ${assertionTotal} 条`);
  if (failures.length) {
    console.error('失败: ' + failures.join(', '));
    process.exit(1);
  }
  console.log('全部通过 ✓');
})().catch(error => {
  console.error(error);
  process.exit(2);
});
