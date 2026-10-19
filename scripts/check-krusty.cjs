// 蟹堡王 · 午市回归：
// 进门 → 煎肉饼（金黄/合格/糊）→ 按订单叠料自动上菜 → 连单小费 →
// 角色差异 → 顾客耐心 → 75 秒结算入账 → 写盘失败回滚 → 移动端布局。
// 和 check-world 一样，是 playwright 的 `async (page) => {...}` 形式。
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

  // ---- 进门 ----
  await page.getByRole('button', { name: '小世界' }).click();
  await page.locator('#worldHud').waitFor({ state: 'visible' });
  assert(await page.evaluate(() => typeof KrustyGame === 'object' && typeof KRUSTY_TUNING === 'object'), '蟹堡王的小游戏全局对象可用');
  await page.evaluate(() => { WorldHub.player.x = 470; WorldHub.player.y = 545; WorldHub.tap = null; });
  await page.waitForTimeout(140);
  await page.keyboard.press('e');
  await page.waitForTimeout(160);
  const enter = await page.evaluate(() => ({
    state: game.state, screen: !$('krusty').hidden, worldHud: $('worldHud').hidden,
    active: KrustyGame.active, time: KrustyGame.time, orders: KrustyGame.orders.length,
    duration: KRUSTY_TUNING.duration,
  }));
  assert(enter.state === 'krusty' && enter.screen && enter.worldHud, '按 E 进入蟹堡王午市，HUD 切到店里');
  assert(enter.active && enter.time > enter.duration - 3 && enter.time <= enter.duration, '午市按 KRUSTY_TUNING.duration 倒计时');
  assert(enter.orders >= 1, '开局已经有顾客排队');
  await page.screenshot({ path: 'output/playwright/krusty.png' });

  // ---- 烤盘 / 叠料 / 小费 / 角色差异（在页面里跑，保证确定性）----
  const msgs = await page.evaluate(() => {
    const msgs = [];
    const assert = (v, m) => { if (!v) throw new Error(m); msgs.push(m); };
    const K = KrustyGame, T = KRUSTY_TUNING;
    const order = (recipe, extra = {}) => ({
      recipe, patience: 20, max: 20, base: 8, double: recipe.length > 4, who: '🐟', ...extra,
    });
    const reset = () => {
      K.orders = []; K.stack = []; K.stackMeta = []; K.tray = [];
      K.grill = { active: false, pos: 0, dir: 1 };
      K.earned = 0; K.served = 0; K.perfect = 0; K.burnt = 0;
      K.combo = 0; K.bestCombo = 0; K.spawnT = 999; K.time = 70;
    };

    // 1) 金黄肉饼：指针停在正中间
    reset();
    K.grill.active = true; K.grill.pos = 0.5;
    K.grillAction();
    assert(!K.grill.active && K.tray.length === 1 && K.tray[0].perfect === true, '指针停在中间 → 金黄肉饼');
    assert(K.perfect === 1, '金黄肉饼计入完美数');

    // 2) 合格肉饼：偏一点但还在黄区
    K.grill.active = true;
    K.grill.pos = 0.5 + (T.perfectBand + T.goodBand) / 2;
    K.grillAction();
    assert(K.tray.length === 2 && K.tray[1].perfect === false, '偏一点 → 合格肉饼');

    // 3) 备餐台满了不能再煎
    assert(K.grillAction() === false && K.grill.active === false, '备餐台满时不能开火');

    // 4) 糊：指针在最边上，连单清零
    K.tray = []; K.combo = 4;
    K.grill.active = true; K.grill.pos = 0;
    K.grillAction();
    assert(K.burnt === 1 && K.combo === 0 && K.tray.length === 0, '指针太偏 → 煎糊，连单清零');

    // 5) 按订单叠料，最后一步自动上菜
    reset();
    K.orders = [order(['bun', 'patty', 'lettuce', 'bun'])];
    K.tray = [{ perfect: true }];
    K.addIngredient('bun');
    K.addIngredient('patty');
    K.addIngredient('lettuce');
    assert(K.stack.length === 3 && K.orders.length === 1, '叠到一半不会提前上菜');
    K.addIngredient('bun');
    assert(K.orders.length === 0 && K.served === 1, '配方完全一致 → 自动上菜');
    assert(K.earned === 10 && K.combo === 1, '基础 8 + 金黄小费 2 = 10，连单 +1');

    // 6) 错料：不扣钱但会提示对不上，可倒掉重来
    reset();
    K.orders = [order(['bun', 'patty', 'tomato', 'bun'])];
    K.tray = [{ perfect: false }];
    K.addIngredient('bun'); K.addIngredient('patty'); K.addIngredient('lettuce');
    assert(K.stack.length === 3 && K.orders.length === 1 && K.earned === 0, '错料不会上菜也不会扣钱');
    assert($('krTip').textContent.includes('对不上'), '错料给出「对不上订单」提示');
    assert(K.clearStack() === true && K.stack.length === 0, '倒掉重来会清空盘子');

    // 7) 没有肉饼时点肉饼会被拦下
    K.tray = []; K.stack = [];
    assert(K.addIngredient('patty') === false && K.stack.length === 0, '备餐台空着时不能凭空放肉饼');

    // 8) 连单倍率：每 3 连 +10%，封顶 +50%
    K.combo = 3;
    assert(Math.abs(K.comboMul() - 1.1) < 1e-9, '3 连单 → 小费 ×1.1');
    K.combo = 30;
    assert(Math.abs(K.comboMul() - 1.5) < 1e-9, '连单倍率封顶 ×1.5');

    // 9) 顾客耐心归零：订单消失、连单清零
    reset();
    K.combo = 3;
    K.orders = [order(['bun'], { patience: 0.01 })];
    K.update(0.05);
    assert(K.orders.length === 0 && K.combo === 0, '顾客等不及走了，连单清零');

    // 10) 角色差异
    const origIdx = game.charIdx;
    const idx = id => CHARS.findIndex(c => c.id === id);
    game.charIdx = idx('patrick');
    const patrickBand = K.band().perfect;
    game.charIdx = idx('spongebob');
    const normalBand = K.band().perfect;
    assert(patrickBand > normalBand, '派宝宝的煎盘完美区更大');
    game.charIdx = idx('squidward');
    assert(K.patienceMul() === 1.25, '王哥的顾客耐心 +25%');
    game.charIdx = idx('sandy');
    assert(K.sandyHint() === true, '珊迪开启下一味原料提示');
    reset();
    K.orders = [order(['bun', 'patty', 'cheese', 'bun'])];
    K.syncPlates();
    const needBtn = document.querySelector('#krIng button.need');
    assert(needBtn && needBtn.dataset.ing === 'bun', '珊迪高亮下一味原料');
    game.charIdx = idx('spongebob');
    K.undoLeft = 1; K.tray = [{ perfect: false }];
    K.addIngredient('bun'); K.addIngredient('patty');
    K.syncPlates();
    assert(!$('krUndo').hidden, '碧莲有 1 次撤回按钮');
    assert(K.undo() === true && K.stack.length === 1 && K.undoLeft === 0, '撤回只去掉最后一味，且一把只有 1 次');
    game.charIdx = origIdx;

    // 11) 结算入账
    reset();
    K.earned = 24; K.served = 3; K.perfect = 2; K.bestCombo = 2;
    const walletBefore = SAVE.wallet;
    const runsBefore = SAVE.world.krustyRuns;
    const servedBefore = SAVE.world.krustyServed;
    K.finish();
    assert(game.state === 'krustyOver' && !$('krustyOver').hidden, '午市结束打开收摊结算');
    assert(K.active === false, '结算后小游戏停止计时');
    assert(SAVE.wallet >= walletBefore + 24, '本局收入写进钱包（含可能新达成的成就奖励）');
    assert(SAVE.world.krustyRuns === runsBefore + 1, '开市局数 +1');
    assert(SAVE.world.krustyServed === servedBefore + 3, '卖出份数并入存档');
    assert(SAVE.world.krustyBest >= 3 && SAVE.world.krustyPerfect >= 2, '单局最佳与完美肉饼有记录');
    return msgs;
  });
  results.push(...msgs);
  await page.screenshot({ path: 'output/playwright/krusty-over.png' });

  // ---- 写盘失败：收入不入账，提示与内存一致 ----
  const fail = await page.evaluate(() => {
    restartKrusty();
    KrustyGame.earned = 9;
    KrustyGame.served = 1;
    const before = SAVE.wallet;
    const original = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('模拟存储配额满'); };
    try { KrustyGame.finish(); } finally { localStorage.setItem = original; }
    return { wallet: SAVE.wallet, before, msg: $('koReward').textContent };
  });
  assert(fail.wallet === fail.before, '写盘失败时钱包回滚，收入不入账');
  assert(fail.msg.includes('存档写入失败'), '写盘失败给出明确提示');

  // ---- 回小世界，移动端布局不溢出 ----
  await page.evaluate(() => gotoWorld());
  await page.waitForTimeout(120);
  assert(await page.evaluate(() => game.state === 'world' && !$('worldHud').hidden), '收摊后回到小世界');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => openKrusty());
  await page.waitForTimeout(220);
  const mobile = await page.evaluate(() => {
    const ing = document.querySelectorAll('#krIng button');
    const grill = $('krGrillBtn').getBoundingClientRect();
    return {
      state: game.state,
      buttons: ing.length,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      grillVisible: grill.width > 0 && grill.bottom <= window.innerHeight + 1,
      orders: KrustyGame.orders.length,
    };
  });
  assert(mobile.state === 'krusty' && mobile.buttons === 5, '手机竖屏下 5 个原料按钮都在');
  assert(mobile.overflowX <= 1, '手机竖屏没有横向溢出');
  assert(mobile.grillVisible, '手机竖屏能看到煎盘按钮');
  await page.screenshot({ path: 'output/playwright/krusty-mobile.png' });

  assert(errors.length === 0, '无页面脚本错误' + (errors.length ? '：' + errors.join(' | ') : ''));
  return { passed: results.length };
}
