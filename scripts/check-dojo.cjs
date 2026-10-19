// 空手道棚 · 切磋回归：
// 进门 → 看破/格挡/防错/被击中 → 每回合 3 分、三局两胜 →
// 升带与奖金 → 黑带重复挑战 → 角色差异 → 输掉不扣钱 → 中途退出不结算 → 移动端。
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
  assert(await page.evaluate(() => typeof DojoGame === 'object' && Array.isArray(DOJO_BELTS) && DOJO_BELTS.length === 5), '空手道小游戏全局对象可用，五段腰带');
  await page.evaluate(() => { WorldHub.player.x = 500; WorldHub.player.y = 1105; WorldHub.tap = null; });
  await page.waitForTimeout(140);
  await page.keyboard.press('e');
  await page.waitForTimeout(160);
  const enter = await page.evaluate(() => ({
    state: game.state, screen: !$('dojo').hidden, worldHud: $('worldHud').hidden,
    active: DojoGame.active, belt: DojoGame.belt().name, stage: DojoGame.stage,
    blocks: document.querySelectorAll('#djBlocks button').length,
  }));
  assert(enter.state === 'dojo' && enter.screen && enter.worldHud, '按 E 进入空手道棚，界面切换');
  assert(enter.active && enter.stage === 'intro' && enter.blocks === 3, '开局是预备回合，三种格挡按钮都在');
  assert(enter.belt === '白带', '第一次挑战从白带开始');
  await page.evaluate(() => {
    // 截一张「进行中」的图：对手已经起手中段拳，进度条走了一半
    DojoGame.stage = 'fight';
    DojoGame.resolved = false;
    DojoGame.move = 'mid';
    DojoGame.windup = 1;
    DojoGame.perfect = 0.2;
    DojoGame.phase = 0.55;
    DojoGame.syncAll();
  });
  await page.waitForTimeout(60);
  await page.screenshot({ path: 'output/playwright/dojo.png' });

  // ---- 判定 / 回合 / 段位 / 角色差异（在页面里跑）----
  const msgs = await page.evaluate(() => {
    const msgs = [];
    const assert = (v, m) => { if (!v) throw new Error(m); msgs.push(m); };
    const D = DojoGame;
    const reset = () => {
      D.active = true; D.stage = 'fight'; D.resolved = false; D.resolveT = 0;
      D.you = 0; D.foe = 0; D.round = 1; D.roundsYou = 0; D.roundsFoe = 0;
      D.perfectCount = 0; D.guardCount = 0; D.won = false; D.beltIdx = 0;
      D.phase = 0; D.windup = 1; D.perfect = 0.2; D.move = 'high'; D.result = '';
      D.stageT = 0;
    };
    const exchange = move => {
      D.stage = 'fight'; D.resolved = false; D.resolveT = 0;
      D.move = move; D.phase = 0; D.windup = 1; D.perfect = 0.2; D.result = '';
    };

    // 1) 按早了 = 只是挡住，不得分也不挨打
    reset();
    exchange('high');
    D.phase = 0.1;
    D.block('high');
    assert(D.resolved && D.guardCount === 1 && D.you === 0 && D.foe === 0, '按早了只是格挡：不得分也不挨打');
    assert(D.result.includes('挡住'), '格挡有明确反馈');

    // 2) 防错方向 = 对手得分
    reset();
    exchange('high');
    D.block('low');
    assert(D.foe === 1 && D.you === 0, '防错方向 → 对手 +1');

    // 3) 红区按下对应格挡 = 看破
    reset();
    exchange('mid');
    D.phase = D.windup - D.perfect + 0.01;
    D.block('mid');
    assert(D.you === 1 && D.perfectCount === 1 && D.foe === 0, '红区按下对应格挡 → 看破 +1');
    assert(D.result.includes('看破'), '看破有明确反馈');

    // 4) 完全没按 = 被击中，对手得分
    reset();
    exchange('low');
    D.phase = D.windup + 0.2;
    D.update(0.02);
    assert(D.foe === 1 && D.resolved, '错过窗口 → 被击中，对手 +1');

    // 5) 先到 3 分结束回合；赢下回合进入下一回合
    reset();
    exchange('high');
    D.you = 2;
    D.phase = D.windup - D.perfect + 0.01;
    D.block('high');
    assert(D.stage === 'roundEnd' && D.roundsYou === 1, '回合先到 3 分 → 拿下这一回合');
    D.update(2);
    assert(D.round === 2 && D.stage === 'intro' && D.you === 0 && D.foe === 0, '回合间重置比分，进入第 2 回合预备');

    // 6) 三局两胜：赢下第二回合 → 升带 + 奖金
    const walletBefore = SAVE.wallet;
    const beltBefore = SAVE.world.dojoBelt;
    D.round = 3; D.roundsYou = 1; D.roundsFoe = 1; D.you = 2; D.foe = 0;
    exchange('mid');
    D.phase = D.windup - D.perfect + 0.01;
    D.block('mid');
    assert(D.roundsYou === 2 && D.stage === 'roundEnd', '拿到第二个回合 → 比赛获胜');
    D.update(2);
    assert(game.state === 'dojoOver' && !$('dojoOver').hidden && D.won, '比赛结束打开结算，判定为胜');
    assert(SAVE.world.dojoBelt === beltBefore + 1, '赢下比赛升一段（白 → 黄）');
    assert(SAVE.world.dojoWins === 1, '胜场 +1');
    assert(SAVE.wallet >= walletBefore + 40 + 60, '奖金 + 升带奖励入账');
    assert($('doBelt').textContent === '黄带', '结算面板显示新段位');
    assert(!$('doReward').textContent.includes('没有奖金'), '获胜有奖金文案');

    // 7) 黑带：再赢也不升带，但有奖金
    SAVE.world.dojoBelt = 4;
    persistEconomy();
    restartDojo();
    assert(D.belt().name === '黑带', '存档里的段位会被读出来');
    const blackWallet = SAVE.wallet;
    D.stage = 'fight'; D.round = 3; D.roundsYou = 1; D.roundsFoe = 1;
    D.you = 2; D.foe = 0; D.perfectCount = 0; D.resolved = false;
    exchange('high');
    D.phase = D.windup - D.perfect + 0.01;
    D.block('high');
    D.update(2);
    assert(SAVE.world.dojoBelt === 4, '黑带不再升带');
    assert(SAVE.wallet >= blackWallet + 120, '黑带重复挑战仍有奖金');
    assert($('doTitle').textContent.includes('获胜'), '黑带结算标题正确');

    // 8) 角色差异
    const origIdx = game.charIdx;
    const idx = id => CHARS.findIndex(c => c.id === id);
    // 碧莲：看破窗口更大
    game.charIdx = idx('spongebob');
    reset(); D.beltIdx = 0; D.nextExchange();
    const sbPerfect = D.perfect;
    game.charIdx = idx('patrick');
    reset(); D.beltIdx = 0; D.nextExchange();
    const patrickPerfect = D.perfect;
    assert(Math.abs(sbPerfect - 0.26 * 1.2) < 1e-9, '碧莲的看破窗口 ×1.2');
    assert(Math.abs(patrickPerfect - 0.26) < 1e-9, '派宝宝不额外加窗口（但反制更重）');
    // 派宝宝：看破 +2 分
    reset(); D.you = 0; D.foe = 0;
    exchange('low');
    D.phase = D.windup - D.perfect + 0.01;
    D.block('low');
    assert(D.you === 2, '派宝宝看破得 2 分');
    // 王哥：对手起手更慢
    game.charIdx = idx('squidward');
    reset(); D.beltIdx = 0; D.nextExchange();
    assert(D.windup > 1.15 + 1e-9, '王哥让对手起手更慢');
    assert(D.tune().hint === false, '王哥没有提示');
    // 珊迪：高亮正确的格挡
    game.charIdx = idx('sandy');
    reset(); D.beltIdx = 0; D.nextExchange();
    const need = document.querySelector('#djBlocks button.need');
    assert(need && need.dataset.block === D.move, '珊迪高亮正确格挡');
    game.charIdx = origIdx;
    assert(CHARS[origIdx], '测试后恢复当前角色');

    // 9) 输掉也记录单场看破数（成就看表现，不要求获胜）
    restartDojo();
    D.stage = 'fight'; D.round = 3; D.roundsYou = 0; D.roundsFoe = 1;
    D.you = 0; D.foe = 2; D.perfectCount = 3; D.resolved = false;
    exchange('high');
    D.phase = D.windup + 0.2;
    D.update(0.02);
    D.update(2);
    assert(SAVE.world.dojoBestPerfect >= 3, '输掉比赛也会记录单场看破数');
    assert(SAVE.achievements.includes('dojo-perfect-3'), '看破三连成就不要求获胜');

    // 10) 再输一场：不给奖金、不扣钱
    game.charIdx = origIdx;
    restartDojo();
    const loseWallet = SAVE.wallet;
    D.stage = 'fight'; D.round = 3; D.roundsYou = 1; D.roundsFoe = 1;
    D.you = 0; D.foe = 2; D.resolved = false;
    exchange('high');
    D.phase = D.windup + 0.2;
    D.update(0.02);
    assert(D.stage === 'roundEnd' && D.roundsFoe === 2, '对手先到 3 分 → 输掉回合');
    D.update(2);
    assert(game.state === 'dojoOver' && !D.won, '输掉比赛也会结算');
    assert(SAVE.wallet === loseWallet, '输掉比赛不扣钱也不给奖金');
    assert($('doTitle').textContent.includes('惜败'), '失败结算标题正确');
    assert($('doReward').textContent.includes('没有奖金'), '失败文案说明没有奖金');

    // 11) 中途退出不结算
    restartDojo();
    D.stage = 'fight'; D.resolved = false; D.you = 1;
    const quitWallet = SAVE.wallet;
    quitDojo();
    assert(game.state === 'world' && $('dojo').hidden && !$('worldHud').hidden, '中途退出回到小世界');
    assert(D.active === false, '退出后小游戏停止');
    assert(SAVE.wallet === quitWallet && !$('dojoOver').hidden === false, '中途退出没有结算面板、钱包不变');
    return msgs;
  });
  results.push(...msgs);

  // ---- 结算截图（再打一场并快速获胜）----
  await page.evaluate(() => {
    openDojo();
    DojoGame.beltIdx = 3;
    DojoGame.round = 3; DojoGame.roundsYou = 1; DojoGame.roundsFoe = 1;
    DojoGame.you = 2; DojoGame.foe = 0; DojoGame.perfectCount = 1;
    DojoGame.stage = 'fight'; DojoGame.resolved = false;
    DojoGame.move = 'high'; DojoGame.phase = 0; DojoGame.windup = 1; DojoGame.perfect = 0.2;
    DojoGame.phase = DojoGame.windup - DojoGame.perfect + 0.01;
    DojoGame.block('high');
    DojoGame.update(2);
  });
  await page.waitForTimeout(120);
  assert(await page.evaluate(() => game.state === 'dojoOver' && !$('dojoOver').hidden), '结算面板可见');
  await page.screenshot({ path: 'output/playwright/dojo-over.png' });

  // ---- 移动端 ----
  await page.evaluate(() => gotoWorld());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => openDojo());
  await page.waitForTimeout(220);
  const mobile = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('#djBlocks button')];
    const rects = blocks.map(b => b.getBoundingClientRect());
    return {
      count: blocks.length,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      visible: rects.every(r => r.width > 0 && r.bottom <= window.innerHeight + 1),
      stage: DojoGame.stage,
    };
  });
  assert(mobile.count === 3 && mobile.visible, '手机竖屏下三种格挡按钮都在视口内');
  assert(mobile.overflowX <= 1, '手机竖屏没有横向溢出');
  assert(mobile.stage === 'intro' || mobile.stage === 'fight', '手机端道场正常开局');
  await page.screenshot({ path: 'output/playwright/dojo-mobile.png' });

  assert(errors.length === 0, '无页面脚本错误' + (errors.length ? '：' + errors.join(' | ') : ''));
  return { passed: results.length };
}
