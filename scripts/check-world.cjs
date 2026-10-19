// 小世界回归：可走动的海湾（走动 / 镜头 / 地点交互 / 走进浅水自动开局）+
// 撒网抓水母（网口半径、撒网冷却、连抓倍率、角色差异、电水母短路、诱饵聚团、
// 涨潮结算、存档、写盘失败回滚、跑酷不受影响）。
// 和 check-game / check-deepsea 一样，是 playwright 的 `async (page) => {...}` 形式。
async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:4173');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#title').waitFor({ state: 'visible' });
  const results = [];
  const assert = (value, message) => { if (!value) throw new Error(message); results.push(message); };

  // ---- 入口：标题页 → 小世界 ----
  assert(await page.evaluate(() => !!document.querySelector('script[src="assets/world/world.js"]')), 'index.html 引入了 world.js');
  assert(await page.evaluate(() =>
    !!document.querySelector('script[src="assets/world/krusty.js"]') &&
    !!document.querySelector('script[src="assets/world/dojo.js"]')
  ), 'index.html 引入了蟹堡王与空手道脚本');
  assert(await page.evaluate(() => typeof WorldHub === 'object' && typeof JellyGame === 'object' && typeof WORLD_TUNING === 'object'), '小世界的三个全局对象都可用');
  await page.getByRole('button', { name: '小世界' }).click();
  await page.locator('#worldHud').waitFor({ state: 'visible' });
  assert(await page.evaluate(() => game.state === 'world' && $('title').hidden), '点「小世界」进入海湾');
  assert(await page.evaluate(() => $('worldHint').textContent.includes('走动') && $('worldJelly').textContent === '0'), '顶栏显示果冻库存，底部提示怎么走');
  await page.screenshot({ path: 'output/playwright/world-hub.png' });

  // ---- 走动：按住方向键真的会移动，镜头跟着走 ----
  const before = await page.evaluate(() => ({ x: WorldHub.player.x, cam: WorldHub.cam.x }));
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(380);
  await page.keyboard.up('ArrowRight');
  const after = await page.evaluate(() => ({
    x: WorldHub.player.x, y: WorldHub.player.y, cam: WorldHub.cam.x,
    state: game.state, stand: WorldHub.canStand(WorldHub.player.x, WorldHub.player.y),
  }));
  assert(after.x > before.x + 30, '按住方向键能真的走动（不是点选卡片）');
  assert(after.state === 'world', '还没走到水边时仍在小世界');
  assert(after.stand, '走到的位置在可站立区域内');
  assert(after.cam >= before.cam - 1, '镜头跟着玩家移动');

  // ---- 海岸线挡人：一直往西走不会掉进深海 ----
  await page.evaluate(() => { WorldHub.player.x = 100; WorldHub.player.y = 620; WorldHub.tap = null; });
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(450);
  await page.keyboard.up('ArrowLeft');
  const edge = await page.evaluate(() => ({ x: WorldHub.player.x, ok: WorldHub.canStand(WorldHub.player.x, WorldHub.player.y) }));
  assert(edge.ok && edge.x < 96 && edge.x > 55, '走到岛边会被挡住，不会走进深海');

  // ---- 蟹堡王 / 空手道棚：走近能进门玩小游戏 ----
  await page.evaluate(() => { WorldHub.player.x = 470; WorldHub.player.y = 545; WorldHub.tap = null; });
  await page.waitForTimeout(140);
  assert(await page.evaluate(() => WorldHub.near && WorldHub.near.id === 'krusty' && $('worldHint').textContent.includes('做蟹黄包')), '走近蟹堡王时提示做蟹黄包');
  await page.keyboard.press('e');
  await page.waitForTimeout(140);
  assert(await page.evaluate(() =>
    game.state === 'krusty' && !$('krusty').hidden && KrustyGame.active && KrustyGame.orders.length > 0
  ), '在蟹堡王按 E 进入午市，顾客已经开始排队');
  await page.evaluate(() => { quitKrusty(); gotoWorld(); });
  await page.waitForTimeout(120);

  await page.evaluate(() => { WorldHub.player.x = 500; WorldHub.player.y = 1105; WorldHub.tap = null; });
  await page.waitForTimeout(140);
  assert(await page.evaluate(() => WorldHub.near && WorldHub.near.id === 'karate' && $('worldHint').textContent.includes('空手道切磋')), '走近空手道棚会被识别为当前地点');
  await page.keyboard.press('e');
  await page.waitForTimeout(140);
  assert(await page.evaluate(() =>
    game.state === 'dojo' && !$('dojo').hidden && DojoGame.active && DojoGame.belt().name === '白带'
  ), '在空手道棚按 E 进入切磋，白带开局');
  await page.evaluate(() => quitDojo());
  await page.waitForTimeout(120);
  assert(await page.evaluate(() => game.state === 'world' && $('worldHud').hidden === false), '退出道场回到小世界');

  // ---- 走进浅水：不点按钮、不切场景，直接开抓 ----
  await page.evaluate(() => { WorldHub.player.x = 1020; WorldHub.player.y = 660; WorldHub.tap = null; });
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(900);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(120);
  const enter = await page.evaluate(() => ({
    state: game.state, hud: !$('jellyHud').hidden, worldHud: $('worldHud').hidden,
    time: JellyGame.time, inLagoon: WorldHub.inLagoon(WorldHub.player.x, WorldHub.player.y),
    entry: !!WorldHub.lastEntry, baits: JellyGame.baitsLeft,
    dur: WORLD_TUNING.duration, baitCount: WORLD_TUNING.baitCount,
  }));
  assert(enter.state === 'jelly' && enter.hud && enter.worldHud, '走进浅水自动开始抓水母，HUD 切换');
  assert(enter.time > 43 && enter.time <= enter.dur, '开局按 WORLD_TUNING.duration 计时');
  assert(enter.inLagoon && enter.entry, '入水后玩家在水母田里，入水点被记住');
  assert(enter.baits === enter.baitCount, '每局诱饵数量按 WORLD_TUNING 补给');
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'output/playwright/world-jelly.png' });

  // ---- 撒网 / 连抓 / 角色差异 / 电水母 / 诱饵（在页面里跑，避免逐帧抖动） ----
  const msgs = await page.evaluate(() => {
    const msgs = [];
    const assert = (v, m) => { if (!v) throw new Error(m); msgs.push(m); };
    const charIdx = id => CHARS.findIndex(c => c.id === id);
    const P = () => WorldHub.player;
    const T = WORLD_TUNING;
    const clear = () => { JellyGame.jellies.length = 0; };
    const put = (kind, dx, dy) => JellyGame.spawnAt(kind, P().x + dx, P().y + dy, { speed: 0 });
    const castNow = (dx, dy) => {
      JellyGame.castCd = 0;
      const r0 = JellyGame.castAt(P().x + dx, P().y + dy);
      if (!r0.ok) throw new Error('撒网被拒绝了（冷却或麻痹未清）');
      return JellyGame.resolveNet();
    };

    // 开局：场地干净、计时正确、HUD 对应
    game.charIdx = charIdx('spongebob');
    JellyGame.spawnT = 1e7; // 测试期间关掉自动生成
    assert(game.state === 'jelly' && JellyGame.active, '抓水母状态与 active 标记同步');
    clear(); JellyGame.chain = 0; JellyGame.jelly = 0; JellyGame.caught = 0; JellyGame.maxChain = 0;

    // 网口：撒到哪罩到哪
    put('pink', 60, 0);
    let r = castNow(60, 0);
    assert(r.ok !== false && r.hits === 1 && r.jelly === 1 && JellyGame.caught === 1 && JellyGame.chain === 1, '撒网罩住网口里的水母');
    clear(); JellyGame.chain = 0;
    put('pink', 60, 120);
    r = castNow(60, 0);
    assert(r.hits === 0 && r.missed && JellyGame.chain === 0, '网口外的水母抓不到，撒空会清空连抓');

    // 最远撒网距离：再远也会被拉回网程内
    JellyGame.castCd = 0;
    const far = JellyGame.castAt(P().x + 9999, P().y);
    assert(far.ok && Math.abs(far.x - P().x - T.netRange) < 1, '撒网距离被限制在 WORLD_TUNING.netRange');
    JellyGame.resolveNet();
    JellyGame.castCd = 0;

    // 撒网冷却：刚撒完不能连点
    const p0 = JellyGame.castAt(P().x + 50, P().y);
    assert(p0.ok, '冷却清零后可以撒网');
    JellyGame.resolveNet();
    const p1 = JellyGame.castAt(P().x + 50, P().y);
    assert(!p1.ok, '撒网冷却期间再按无效');
    JellyGame.castCd = 0;

    // 派宝宝：网更大
    game.charIdx = charIdx('spongebob');
    clear(); JellyGame.chain = 0;
    put('pink', 160, 0);
    r = castNow(60, 0);
    assert(r.hits === 0, '普通网口够不到 100 单位外的水母');
    game.charIdx = charIdx('patrick');
    clear(); JellyGame.chain = 0;
    put('pink', 160, 0);
    r = castNow(60, 0);
    assert(r.hits === 1 && r.jelly === 1, '派宝宝的网更大：同样的偏位也能罩住');
    game.charIdx = charIdx('spongebob');

    // 连抓倍率：5 连 ×1.5、10 连 ×2、15 连 ×3
    clear(); JellyGame.chain = 0; JellyGame.jelly = 0; JellyGame.caught = 0; JellyGame.maxChain = 0;
    for (let i = 0; i < 5; i++) { put('pink', 60, 0); castNow(60, 0); }
    assert(JellyGame.chain === 5 && JellyGame.jelly === 6, `5 连抓：1,1,1,1,2 共 6 个果冻（实际 ${JellyGame.jelly}）`);
    assert(JellyGame.chainMul() === 1.5, '第 5 连抓起倍率 1.5');
    for (let i = 0; i < 4; i++) { put('pink', 60, 0); castNow(60, 0); }
    put('blue', 60, 0);
    r = castNow(60, 0);
    assert(JellyGame.chain === 10 && JellyGame.chainMul() === 2 && r.jelly === 4, '第 10 连抓起倍率 2（蓝水母 2→4）');
    for (let i = 0; i < 4; i++) { put('pink', 60, 0); castNow(60, 0); }
    put('blue', 60, 0);
    r = castNow(60, 0);
    assert(JellyGame.chain === 15 && JellyGame.chainMul() === 3 && r.jelly === 6, '第 15 连抓起倍率 3（蓝水母 2→6）');
    assert(JellyGame.maxChain === 15, '最高连抓被记录下来');

    // 一网多只：三只以上给「一网打尽」提示，连抓一次涨 3
    clear(); JellyGame.chain = 0;
    for (const [dx, dy] of [[40, 0], [64, 20], [52, -24]]) put('pink', dx, dy);
    r = castNow(52, 0);
    assert(r.catches === 3 && JellyGame.chain === 3, '一张网可以同时罩住多只水母');

    // 黄金水母 5 个果冻
    clear(); JellyGame.chain = 0;
    const goldBefore = JellyGame.gold;
    put('gold', 60, 0);
    r = castNow(60, 0);
    assert(r.jelly === 5 && JellyGame.gold === goldBefore + 1, '黄金水母一网 5 个果冻');

    // 电水母：网到会短路、清空连抓，麻痹期间撒不了网
    clear(); JellyGame.chain = 9;
    put('zap', 60, 0);
    const jellyBefore = JellyGame.jelly;
    r = castNow(60, 0);
    assert(r.zapped === 1 && r.catches === 0 && JellyGame.zapT > 0 && JellyGame.chain === 0, '电水母不能抓：短路并清空连抓');
    const stunned = JellyGame.castAt(P().x + 60, P().y);
    assert(!stunned.ok && JellyGame.jelly === jellyBefore, '短路期间撒网无效');
    JellyGame.zapT = 0;

    // 电水母碰到跑者也会短路
    clear();
    const jz = JellyGame.spawnAt('zap', P().x + 10, P().y, { speed: 0 });
    JellyGame.update(0.05);
    assert(JellyGame.zapT > 0 && jz.dead && JellyGame.jellies.length === 0, '电水母撞上跑者同样短路并消失');
    JellyGame.zapT = 0;

    // 王哥：水母游速 0.8 倍
    clear(); JellyGame.baits = []; JellyGame.spawnT = 1e7;
    const cx0 = P().x, cy0 = P().y;
    game.charIdx = charIdx('squidward');
    const slow = JellyGame.spawnAt('pink', cx0 + 60, cy0, { speed: 100 });
    slow.angle = 0; slow.phase = 0;
    JellyGame.updateJellies(0.2, JellyGame.tune());
    const dxSlow = slow.x - (cx0 + 60);
    clear();
    game.charIdx = charIdx('spongebob');
    const fast = JellyGame.spawnAt('pink', cx0 + 60, cy0, { speed: 100 });
    fast.angle = 0; fast.phase = 0;
    JellyGame.updateJellies(0.2, JellyGame.tune());
    const dxFast = fast.x - (cx0 + 60);
    assert(dxFast > 0 && Math.abs(dxSlow / dxFast - 0.8) < 0.03, '王哥让水母游慢 20%');

    // 角色手感表
    game.charIdx = charIdx('spongebob');
    const base = JellyGame.tune();
    game.charIdx = charIdx('patrick');
    assert(JellyGame.tune().netR > base.netR, '派宝宝的网更大');
    game.charIdx = charIdx('squidward');
    assert(JellyGame.tune().speedMul < 1, '王哥让水母变慢');
    game.charIdx = charIdx('sandy');
    assert(JellyGame.tune().badges === true, '珊迪能在水母头顶看到价签');
    game.charIdx = charIdx('spongebob');
    assert(JellyGame.tune().netCd < WORLD_TUNING.netCd, '碧莲撒网冷却更短');

    // 诱饵：丢在面朝方向、数量递减、能把水母吸过来
    clear(); JellyGame.jellies.length = 0; JellyGame.baits = []; JellyGame.baitsLeft = T.baitCount;
    P().x = WORLD_LAGOON.x; P().y = WORLD_LAGOON.y; P().face = 0;
    JellyGame.baitCd = 0; JellyGame.zapT = 0;
    assert(JellyGame.dropBait() === true && JellyGame.baits.length === 1 && JellyGame.baitsLeft === T.baitCount - 1, '诱饵丢在脚边并扣数量');
    const bait = JellyGame.baits[0];
    assert(bait.x > P().x + 50, '诱饵落在面朝方向');
    JellyGame.baitCd = 0;
    JellyGame.dropBait(); JellyGame.baitCd = 0; JellyGame.dropBait();
    assert(JellyGame.baitsLeft === 0, '诱饵用完就没了');
    assert(JellyGame.dropBait() === false, '没诱饵时按了也不会凭空变出来');
    const lure = JellyGame.spawnAt('pink', bait.x + 220, bait.y, { speed: 30 });
    const d0 = Math.hypot(lure.x - bait.x, lure.y - bait.y);
    for (let i = 0; i < 12; i++) JellyGame.updateJellies(0.25, JellyGame.tune());
    const d1 = Math.hypot(lure.x - bait.x, lure.y - bait.y);
    assert(d1 < d0 - 40, `水母会被诱饵吸过去（${d0.toFixed(0)}→${d1.toFixed(0)}）`);
    assert($('jellyBait').textContent === '0', 'HUD 诱饵数跟着扣');

    // 游动：WASD 在水母田里生效，并且不会游出水母田
    clear(); JellyGame.baits = []; JellyGame.baitCd = 0; JellyGame.zapT = 0;
    P().x = WORLD_LAGOON.x; P().y = WORLD_LAGOON.y;
    WorldHub.keys.clear(); WorldHub.keys.add('right');
    const sx = P().x;
    WorldHub.update(0.3);
    WorldHub.keys.clear();
    assert(P().x > sx + 20, '水母田里按方向键会游动');
    P().x = WORLD_LAGOON.x + WORLD_LAGOON.rx * 2; P().y = WORLD_LAGOON.y;
    WorldHub.update(0.05);
    assert(WorldHub.inLagoon(P().x, P().y, 0.95), '游到边界会被拦在水母田里');

    // 角色恢复，别把后面的测试带偏
    game.charIdx = charIdx('spongebob');
    JellyGame.syncHud();
    return msgs;
  });
  msgs.forEach(m => results.push(m));

  // ---- 暂停 / 继续 ----
  await page.getByRole('button', { name: '暂停' }).click();
  assert(await page.locator('#jellyPause').isVisible(), '抓水母可以暂停');
  assert(await page.evaluate(() => game.state === 'jellyPause'), '暂停时状态机同步');
  await page.keyboard.press('Escape');
  assert(await page.evaluate(() => game.state === 'jelly' && $('jellyPause').hidden), 'Esc 继续抓水母');

  // ---- HUD 带宽：五种视口下药丸 / 连抓条 / 暂停键 / 提示 / 撒网 / 诱饵互不重叠且在画面内 ----
  for (const [width, height] of [[1280, 800], [1024, 768], [760, 360], [412, 740], [360, 600]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(80);
    const bands = await page.evaluate(() => {
      const rect = el => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
      const hits = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      if ($('jellyHud').hidden) throw new Error('抓水母 HUD 应该是可见的');
      const parts = {
        pills: rect(document.querySelector('#jellyHud .hud-top')),
        chain: rect($('jellyChainBar').parentElement),
        pause: rect($('btnJellyPause')),
        hint: rect(document.querySelector('#jellyHud .jelly-hint')),
        bait: rect($('btnJellyBait')),
        swing: rect($('btnJellySwing')),
      };
      const names = Object.keys(parts);
      const bad = [], outside = [];
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          if (hits(parts[names[i]], parts[names[j]])) bad.push(`${names[i]}×${names[j]}`);
        }
      }
      for (const [n, r] of Object.entries(parts)) {
        if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) outside.push(n);
      }
      return { bad, outside };
    });
    assert(!bands.bad.length, `抓水母 HUD 六块互不重叠 ${width}x${height}${bands.bad.length ? '（' + bands.bad.join('、') + '）' : ''}`);
    assert(!bands.outside.length, `抓水母 HUD 都在画面内 ${width}x${height}${bands.outside.length ? '（' + bands.outside.join('、') + '）' : ''}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(80);

  // ---- 抓水母成就：判定读的是 SAVE.world ----
  const ach = await page.evaluate(() => {
    SAVE.achievements = []; persistEconomy();
    SAVE.world.jellyCaught = 3; SAVE.world.jellyGold = 3; SAVE.world.jellyBest = 20;
    const earned = evaluateAchievements().map(a => a.id);
    const again = evaluateAchievements().length; // 不应该重复发奖
    return { earned, again };
  });
  assert(ach.earned.includes('jelly-first') && ach.earned.includes('jelly-run-18') && ach.earned.includes('jelly-gold-3'), '抓水母的成就会按水母田数据解锁');
  assert(ach.again === 0, '同一个成就不会重复发奖');

  // ---- 结算：涨潮自动上岸，果冻入库、贝壳币入账、只结算一次 ----
  const settled = await page.evaluate(() => {
    // 先把水母田数据归零、成就全标记为已达成，让钱包断言只反映「本局结算」
    SAVE.world.jellyCaught = 0; SAVE.world.jellyGold = 0; SAVE.world.jellyBest = 0;
    SAVE.achievements = ACHIEVEMENTS.map(a => a.id);
    persistEconomy();
    const before = { wallet: SAVE.wallet, world: { ...SAVE.world } };
    JellyGame.jelly = 12; JellyGame.caught = 7; JellyGame.gold = 2; JellyGame.zapped = 0; JellyGame.maxChain = 15;
    JellyGame.time = 0.01;
    JellyGame.update(0.05); // 潮水涨满 → 自动上岸结算
    const after = { wallet: SAVE.wallet, world: { ...SAVE.world }, state: game.state };
    const overShown = !$('jellyOver').hidden;
    const onShore = !WorldHub.inLagoon(WorldHub.player.x, WorldHub.player.y);
    const walletAgain = SAVE.wallet;
    endJellyGame(); // 再调一次不应该重复发奖
    return {
      before, after, overShown, onShore, double: SAVE.wallet !== walletAgain,
      bonus: WORLD_TUNING.perfectBonus, stored: JSON.parse(localStorage.getItem('bbSubwayEconomyV1')),
    };
  });
  assert(settled.after.state === 'jellyOver' && settled.overShown, '潮水涨满自动结算并弹出结算面板');
  assert(settled.onShore, '结算后玩家被推回岸上');
  assert(settled.after.world.jelly === settled.before.world.jelly + 12, '本局果冻入库');
  assert(settled.after.world.jellyRuns === settled.before.world.jellyRuns + 1 && settled.after.world.jellyCaught === settled.before.world.jellyCaught + 7, '局数与累计捕获写入存档');
  assert(settled.after.world.jellyBest >= 12 && settled.after.world.jellyGold === settled.before.world.jellyGold + 2, '单局最佳与黄金水母计入生涯');
  assert(settled.after.wallet === settled.before.wallet + 12 + settled.bonus, '完美一网：果冻等值贝壳币 + 无伤赏金');
  assert(!settled.double, '结算只会发一次奖');
  assert(settled.stored.world && settled.stored.world.jelly === settled.after.world.jelly && settled.stored.wallet === settled.after.wallet, '果冻与钱包写在同一份存档里');
  await page.screenshot({ path: 'output/playwright/world-settle.png' });

  // ---- 结算面板：回小世界，人留在岸边 ----
  await page.getByRole('button', { name: '回小世界' }).click();
  assert(await page.evaluate(() => game.state === 'world' && !$('worldHud').hidden && $('jellyHud').hidden), '结算后能回到海湾');
  assert(await page.evaluate(() => !WorldHub.inLagoon(WorldHub.player.x, WorldHub.player.y)), '回海湾后站在岸边，不会立刻又下水');

  // ---- 生涯档案里有抓水母记录 ----
  await page.evaluate(() => { gotoTitle(); openStats(); });
  assert(await page.evaluate(() => $('statsGrid').textContent.includes('累计捕获水母') && $('statsGrid').textContent.includes('黄金水母')), '生涯档案里有水母田数据');
  await page.getByRole('button', { name: '关闭生涯' }).click();

  // ---- 写盘失败：果冻与钱包一起回滚 ----
  await page.evaluate(() => { SAVE.wallet = 777; SAVE.world.jelly = 55; persistEconomy(); });
  const rollback = await page.evaluate(() => {
    const original = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('模拟存储配额满'); };
    SAVE.wallet = 700; SAVE.world.jelly = 5;
    const ok = persistEconomy();
    localStorage.setItem = original;
    return { ok, wallet: SAVE.wallet, jelly: SAVE.world.jelly };
  });
  assert(rollback.ok === false && rollback.wallet === 777 && rollback.jelly === 55, '写盘失败时钱包与果冻一起回滚');

  // ---- 普通跑酷不受影响：水母田的东西不会漏进跑酷局 ----
  const runState = await page.evaluate(() => {
    startJellyGame();
    JellyGame.jellies.length = 0;
    JellyGame.spawnAt('pink', WorldHub.player.x + 60, WorldHub.player.y);
    JellyGame.active = false;
    gotoWorld();
    startRun();
    return {
      state: game.state, hud: !$('hud').hidden,
      worldHud: !$('worldHud').hidden, jellyHud: !$('jellyHud').hidden,
      stray: game.props.filter(o => o.type === 'worldjelly').length,
    };
  });
  assert(runState.state === 'playing' && runState.hud && !runState.worldHud && !runState.jellyHud, '从小世界返回跑酷：HUD 切换正确');
  assert(runState.stray === 0, '水母田的水母不会残留到跑酷局里');
  await page.waitForTimeout(400);
  assert(await page.evaluate(() => game.state === 'playing' && game.props.length > 0), '回到跑酷后能正常跑起来');

  if (errors.length) throw new Error('页面错误: ' + errors.join('; '));
  return { passed: results.length, results, browserErrors: errors };
}
