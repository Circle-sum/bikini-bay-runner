// 双人对战回归：生命 / 汉堡包 / 道具（章鱼·铁锹·极速鞋）/ 同车道重叠 / 镜头
// 与 check-game 一样，是 playwright 的 `async (page) => {...}` 形式。
async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const results = [];
  const assert = (value, message) => { if (!value) throw new Error(message); results.push(message); };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#title').waitFor({ state: 'visible' });

  // ---- 入口：首页 → 说明 → 开始 ----
  await page.getByRole('button', { name: /双人对战/ }).click();
  assert(await page.locator('#vsIntro').isVisible(), '首页「双人对战」打开说明面板');
  await page.screenshot({ path: 'output/playwright/vs-intro.png' });
  await page.getByRole('button', { name: '开始对战', exact: true }).click();
  assert(await page.locator('#vsHud').isVisible(), '开战后显示对战 HUD');
  assert(await page.locator('#hud').isHidden(), '对战时单人 HUD 隐藏');

  // ---- 键位：P1 方向键、P2 WASD ----
  const lanes1 = await page.evaluate(() => {
    game.state = 'versusPaused'; // 暂停主循环，避免误推进
    return { a: vs.runners[0].lane, b: vs.runners[1].lane };
  });
  await page.evaluate(() => { game.state = 'versus'; });
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('d');
  const lanes2 = await page.evaluate(() => {
    game.state = 'versusPaused';
    return { a: vs.runners[0].lane, b: vs.runners[1].lane };
  });
  assert(lanes1.a === 2 && lanes1.b === 0, '开局 P1（方向键）在右道、P2（WASD）在左道');
  assert(lanes2.a === 1 && lanes2.b === 1, '方向键控制 P1、WASD 控制 P2');

  // ---- 规则细节（同一段同步执行，主循环无法插进来）----
  const msgs = await page.evaluate(() => {
    const msgs = [];
    const assert = (v, m) => { if (!v) throw new Error(m); msgs.push(m); };
    const step = dt => { // 手动推一帧；对战结束后不再推进
      if (vs.over) return;
      game.state = 'versus'; updateVersus(dt); camUpdate(dt);
      if (!vs.over) game.state = 'versusPaused';
    };
    const restart = () => { startVersus(); game.state = 'versusPaused'; };
    const use = p => { game.state = 'versus'; vsUseItem(p); game.state = 'versusPaused'; };
    const noSpawn = () => { game.spawnZ = 1e7; game.sceneryZ = 1e7; game.props.length = 0; };
    const put = (type, p, extra) => { game.props.push(Object.assign({ type, x: p.x, z: p.z, y: 0.6, got: false }, extra || {})); };

    restart(); noSpawn();
    {
      const p1 = vs.runners[0], p2 = vs.runners[1];
      assert(vs.runners.length === 2, '对战里有两位跑者');
      assert(p1.lives === 3 && p2.lives === 3, '每人开局 3 条命');
      assert(p1.item === null && p2.item === null, '开局道具槽为空');
      assert(p1.char && p2.char && p1.char.id !== p2.char.id, '两位跑者使用不同角色');
    }

    // ---- 撞车：掉 1 条命 + 无敌帧 ----
    restart(); noSpawn();
    {
      const p1 = vs.runners[0], p2 = vs.runners[1];
      // 障碍只放在 P1 车道，并把 P2 挪到别的车道/更前面，双方互不干扰
      p1.lane = 0; p1.x = LANES[0]; p2.lane = 2; p2.x = LANES[2]; p2.z = p1.z + 8;
      p1.lives = 3; p1.combo = 7; p1.hurtT = 0; p1.y = 0; p1.rollT = 0;
      put('hurdle', p1);
      step(0.016);
      assert(p1.lives === 2, '撞到障碍掉 1 条命');
      assert(p1.combo === 0, '撞车清空连击');
      assert(p1.hurtT > 0, '撞车后进入短暂无敌');
      put('hurdle', p1);
      step(0.016);
      assert(p1.lives === 2, '无敌帧内不会再次掉命');
      p1.hurtT = 0;
      step(0.016);
      assert(p1.lives === 1, '无敌结束后可以再次被撞');
    }

    // ---- 汉堡包：补命、封顶 3 条 ----
    restart(); noSpawn();
    {
      const p1 = vs.runners[0];
      p1.lives = 1; put('burger', p1);
      step(0.016);
      assert(p1.lives === 2, '吃到汉堡包补 1 条命');
      assert(!game.props.some(o => o.type === 'burger' && !o.got), '汉堡包吃掉后消失');
      p1.lives = 3; put('burger', p1);
      const score0 = p1.coinScore;
      step(0.016);
      assert(p1.lives === 3, '满命时不会再超过 3 条');
      assert(p1.coinScore > score0, '满命吃汉堡包转为加分');
    }

    // ---- 道具：捡到即替换，极速鞋立即生效 ----
    restart(); noSpawn();
    {
      const p1 = vs.runners[0];
      put('vspower', p1, { kind: 'octopus' });
      step(0.016);
      assert(p1.item === 'octopus', '踩到道具进入道具槽');
      put('vspower', p1, { kind: 'shovel' });
      step(0.016);
      assert(p1.item === 'shovel', '捡到新道具会替换旧的（只保留最新那一个）');
      put('vspower', p1, { kind: 'shoes' });
      const boost0 = p1.boostT;
      step(0.016);
      assert(p1.boostT > boost0 && p1.item === 'shovel', '极速鞋捡到立即生效，不占道具槽、也不清掉手上的道具');
    }

    // ---- 极速鞋：捡到即自动提速 ----
    restart(); noSpawn();
    {
      const p1 = vs.runners[0], p2 = vs.runners[1];
      p2.z = p1.z + 1;
      p1.item = null; p1.boostT = 0;
      put('vspower', p1, { kind: 'shoes' });
      step(0.016);
      assert(p1.item === null && p1.boostT > 0, '捡到极速鞋立即开始提速');
      const d0 = p2.z - p1.z;
      for (let i = 0; i < 10; i++) step(0.05);
      assert(p2.z - p1.z < d0, '极速鞋让自己跑得更快');
    }

    // ---- 章鱼：把领先的对手拉回同一水平 ----
    restart(); noSpawn();
    {
      const p1 = vs.runners[0], p2 = vs.runners[1];
      p2.z = p1.z + 6; p1.item = 'octopus';
      use(p1);
      assert(Math.abs(p2.z - p1.z) < 1e-6, '章鱼把领先的对手拉回到自己水平线');
      assert(p1.item === null, '章鱼使用后消耗');
      p1.item = 'octopus'; p2.z = p1.z - 4;
      use(p1);
      assert(p1.item === null && Math.abs(p2.z - (p1.z - 8)) < 1e-6, '对手不领先时章鱼仍可用（把对手再往后推一段）');
    }

    // ---- 铁锹：敲晕身边的对手使其落后 ----
    restart(); noSpawn();
    {
      const p1 = vs.runners[0], p2 = vs.runners[1];
      p2.z = p1.z + 2; p1.item = 'shovel'; p2.stunT = 0;
      use(p1);
      assert(p2.stunT > 0 && p1.item === null, '铁锹敲晕身边的对手');
      const lead0 = p2.z - p1.z;
      for (let i = 0; i < 8; i++) step(0.05);
      assert(p2.z - p1.z < lead0, '被敲晕的对手会减速落后');
      p1.item = 'shovel'; p2.z = p1.z + 40; p2.stunT = 0;
      use(p1);
      assert(p1.item === null && p2.stunT > 0 && p2.stunT <= 1.2, '对手很远时铁锹仍可用（晕得短，不再卡在道具槽）');
    }

    // ---- 金币：先到先得，吃掉即消失 ----
    restart(); noSpawn();
    {
      const p1 = vs.runners[0], p2 = vs.runners[1];
      const c = { type: 'coin', x: LANES[1], z: p1.z, y: 0.55, got: false };
      game.props.push(c);
      p1.lane = 1; p1.x = LANES[1]; p2.z = p1.z - 12; // P2 离得远，只有 P1 能吃到
      step(0.016);
      assert(p1.coins === 1 && p2.coins === 0, '金币只结算给先吃到的人');
      assert(c.got, '一人吃到后金币立即消失');
      p2.lane = 1; p2.x = LANES[1]; p2.z = c.z; p1.z = c.z - 12; // 换成 P2 来吃，但金币已经没了
      const before = p2.coins;
      step(0.016);
      assert(p2.coins === before, '消失后的金币不能再被另一人吃到');
    }

    // ---- 同位置优先级：更靠近的人先拿到 ----
    restart(); noSpawn();
    {
      const p1 = vs.runners[0], p2 = vs.runners[1];
      p1.lane = p2.lane = 1; p1.x = p2.x = LANES[1];
      p1.z = 0.5; p2.z = 1.0; // P2 更靠近 z=0.9 的金币
      const c = { type: 'coin', x: LANES[1], z: 0.9, y: 0.55, got: false };
      game.props.push(c);
      vsResolvePickups();
      assert(p1.coins === 0 && p2.coins === 1 && c.got, '同一枚金币由更靠近的人拿到');
    }

    // ---- 完全并列时交替，不会永远偏袒 P1 ----
    restart(); noSpawn();
    {
      const p1 = vs.runners[0], p2 = vs.runners[1];
      p1.lane = p2.lane = 1; p1.x = p2.x = LANES[1]; p1.z = p2.z = 1;
      const wins = [];
      for (let i = 0; i < 2; i++) {
        game.props.push({ type: 'coin', x: LANES[1], z: 1, y: 0.55, got: false });
        p1.coins = 0; p2.coins = 0;
        vsResolvePickups();
        wins.push(p1.coins ? 0 : 1);
      }
      assert(wins[0] !== wins[1], '完全并列时两人交替拿到');
    }

    // ---- 道具：同持章鱼 / 铁锹也能正常使用，不再互相抵消 ----
    restart(); noSpawn();
    {
      const p1 = vs.runners[0], p2 = vs.runners[1];
      p1.item = 'octopus'; p2.item = 'octopus'; p1.z = p2.z = 0;
      use(p1);
      assert(p1.item === null && p2.z < p1.z, '并列时章鱼可用，把对手往后推');
      p1.item = 'shovel'; p2.item = 'shovel'; p2.z = p1.z + 2;
      use(p1); use(p2);
      assert(p1.item === null && p2.item === null && p1.stunT > 0 && p2.stunT > 0, '两人同持铁锹时都能用、互不抵消');
    }

    // ---- 极速鞋：冲刺拉开距离时两人都还在画面里 ----
    restart(); noSpawn();
    {
      const p1 = vs.runners[0], p2 = vs.runners[1];
      p2.z = p1.z + 1;
      p1.item = 'shoes'; use(p1);
      let bothVisible = true, maxGap = 0;
      for (let i = 0; i < 400; i++) {
        step(0.016);
        maxGap = Math.max(maxGap, Math.abs(p1.z - p2.z));
        if (!project(p1.x, p1.y, p1.z) || !project(p2.x, p2.y, p2.z)) bothVisible = false;
      }
      assert(bothVisible, '冲刺拉开距离时两名跑者都留在画面内');
    }

    // ---- 允许两人挤在同一条车道 ----
    restart(); noSpawn();
    {
      const p1 = vs.runners[0], p2 = vs.runners[1];
      p1.lane = 1; p1.x = LANES[1]; p2.lane = 1; p2.x = LANES[1];
      p2.z = p1.z + 3;
      for (let i = 0; i < 10; i++) step(0.05);
      assert(p1.lane === 1 && p2.lane === 1, '两人可以待在同一条车道');
      assert(p1.lives === 3 && p2.lives === 3, '同车道重叠互不伤害');
    }

    // ---- 领先太多会被「收油」，保证都在镜头内 ----
    restart(); noSpawn();
    {
      const p1 = vs.runners[0], p2 = vs.runners[1];
      p1.z = 0; p2.z = 60;
      for (let i = 0; i < 60; i++) step(0.05);
      const gap = Math.abs(p2.z - p1.z);
      assert(gap <= VS_MAX_GAP + 0.6, '两人距离被钳制在镜头范围内');
    }

    // ---- 相机跟中点：两人都在画面里 ----
    restart(); noSpawn();
    {
      const p1 = vs.runners[0], p2 = vs.runners[1];
      p1.z = 0; p1.x = LANES[0]; p2.z = 8; p2.x = LANES[2];
      camUpdate(0.5);
      assert(Math.abs(cam.z - (4 - 6.4)) < 0.01, '相机跟两人中点');
      assert(project(p1.x, p1.y, p1.z) && project(p2.x, p2.y, p2.z), '两个跑者都留在画面内');
    }

    // ---- 掉光命 = 判负，对手获胜（放最后，保留结算画面）----
    restart(); noSpawn();
    {
      const p1 = vs.runners[0], p2 = vs.runners[1];
      assert(p1.lives === 3 && p2.lives === 3, '重开后命数复位');
      p1.lane = 0; p1.x = LANES[0]; p2.lane = 2; p2.x = LANES[2]; p2.z = p1.z + 20;
      for (let i = 0; i < 3; i++) {
        p1.hurtT = 0; put('hurdle', p1);
        step(0.016);
        game.props.length = 0;
      }
      assert(p1.lives === 0 && p1.ko, '撞满三次后生命耗尽');
      assert(game.state === 'versusOver' && vs.winner === 1, '先掉光命的一方判负');
      assert(p2.lives === 3, '获胜方不受影响');
    }

    return msgs;
  });
  msgs.forEach(m => results.push(m));

  assert((await page.locator('#vsWinnerTitle').textContent()).includes('玩家 2'), '结算画面标出获胜方');
  assert(await page.locator('#vsOver').isVisible(), '对战结束后显示结算画面');
  await page.screenshot({ path: 'output/playwright/vs-over.png' });

  // ---- 再来一局 + 暂停 ----
  await page.getByRole('button', { name: '再来一局', exact: true }).click();
  assert(await page.locator('#vsHud').isVisible(), '「再来一局」重新开战');
  await page.keyboard.press('Escape');
  assert(await page.evaluate(() => game.state) === 'versusPaused', 'Escape 暂停对战');
  assert(await page.locator('#vsPause').isVisible(), '暂停面板出现');
  await page.keyboard.press('Escape');
  assert(await page.evaluate(() => game.state) === 'versus', '再按 Escape 继续对战');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'output/playwright/vs-play.png' });

  // ---- 单人模式不受影响 ----
  const solo = await page.evaluate(() => {
    gotoSelect(); game.charIdx = 0; startRun();
    game.props = []; game.spawnZ = game.player.z + 1000;
    updatePlaying(0.016);
    return { state: game.state };
  });
  assert(solo.state === 'playing', '返回后单人模式仍能正常开局');

  // ---- 竖屏也能用 ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => startVersus());
  await page.waitForTimeout(300);
  assert(await page.locator('#vsHud').isVisible(), '手机竖屏下对战 HUD 正常');
  await page.screenshot({ path: 'output/playwright/vs-mobile.png' });

  if (errors.length) throw new Error('Page errors: ' + errors.join('; '));
  return { passed: results.length, results, browserErrors: errors };
}
