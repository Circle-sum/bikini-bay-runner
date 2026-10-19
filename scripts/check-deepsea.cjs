// 深海事件系统回归：抬高视角 / 漩涡错位 / 车顶二层 / 深海夜色 / 完美穿越 / 连击变身 / 事件卡
// 与 check-game 一样，是 playwright 的 `async (page) => {...}` 形式。
async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const results = [];
  const assert = (value, message) => { if (!value) throw new Error(message); results.push(message); };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#title').waitFor({ state: 'visible' });

  const msgs = await page.evaluate(() => {
    const msgs = [];
    const assert = (v, m) => { if (!v) throw new Error(m); msgs.push(m); };
    const clean = (idx = 0) => {
      game.charIdx = idx; resetRun(); game.state = 'playing';
      game.props = []; game.spawnZ = 1e7; game.sceneryZ = 1e7;
      camUpdate(1);
    };

    // ---- 相机：站上车顶 / 喷气飞行时视角抬高 ----
    clean(0);
    {
      const groundY = cam.y, groundHorizon = cam.horizon;
      assert(!(game.jetT > 0) && game.player.onTrain === false, '地面起跑时不是抬高状态');
      // 站上静止列车顶
      addTrain(1, game.player.z, 12, false);
      game.player.lane = 1; game.player.x = LANES[1];
      game.player.y = TRAIN_H; game.player.onTrain = true; game.player.vy = 0;
      for (let i = 0; i < 60; i++) camUpdate(0.05); // 缓动 3 秒
      assert(game.player.onTrain && cam.y > groundY + 1, '站上车顶后镜头整体抬高');
      assert(cam.horizon < groundHorizon - 20, '镜头抬高时天际线上移，露出更多地面');
      // 跳下车顶 → 镜头缓缓降回原来的机位
      game.player.onTrain = false; game.player.y = 0; game.player.vy = 0;
      for (let i = 0; i < 90; i++) camUpdate(0.05);
      assert(Math.abs(cam.y - groundY) < 0.05 && Math.abs(cam.horizon - groundHorizon) < 0.5, '离开车顶后镜头缓缓落回原来的高度');
      // 喷气背包飞行
      clean(0);
      game.jetT = 3; game.player.y = 3.7;
      for (let i = 0; i < 60; i++) camUpdate(0.05);
      assert(cam.y > groundY + 1, '喷气飞行时镜头同样抬高');
      // 抬起来的过程是缓动的，不会一帧跳上去
      clean(0);
      game.player.onTrain = true; game.player.y = TRAIN_H;
      camUpdate(0.016);
      assert(cam.lift > 0 && cam.lift < CAM_LIFT * 0.2, '镜头抬升是缓动而不是瞬移');
    }

    // ---- 2. 漩涡错位 ----
    clean(0);
    game.whirlT = WHIRL_DURATION * 0.5;
    assert(whirlDir(1) === -1 && whirlDir(-1) === 1, '漩涡期间左右输入被翻过来');
    assert(Math.abs(whirlRoll() - Math.PI / 2) < 1e-9, '漩涡中段画面翻滚到 90°');
    game.player.lane = 1;
    doLane(1);
    assert(game.player.lane === 0, '漩涡期间按「右」实际往左走');
    game.whirlT = 0;
    assert(whirlDir(1) === 1 && whirlRoll() === 0, '漩涡结束后输入与画面都恢复');

    // ---- 5. 深海夜色 ----
    assert(nightFactorAt(0) === 0 && nightFactorAt(DISTRICT_METERS + 10) === 0, '前两个街区不是夜晚');
    assert(nightFactorAt(DISTRICT_METERS * 2 + 130) > 0.99, '第三个街区进入深海夜色');
    assert(nightFactorAt(DISTRICT_METERS * 3 + 130) === 0, '夜色只出现在每三个街区里的那一段');
    {
      const base = DISTRICTS[0].palette;
      const np = nightPalette(base, 1);
      const lum = h => { const c = hexToRgb(h); return c[0] + c[1] + c[2]; };
      assert(np.road !== base.road && np.skyTop !== base.skyTop, '夜色会生成一套新的环境色');
      assert(lum(np.road) < lum(base.road) && lum(np.skyTop) < lum(base.skyTop), '夜色下的地面与天空都更暗');
    }

    // ---- 10. 事件卡 ----
    clean(0);
    {
      const ids = new Set();
      for (let i = 0; i < 60; i++) { rollEvent(); ids.add(game.event.id); }
      assert(ids.size >= 5, '事件卡能抽到多种不同事件');
      assert(EVENTS.every(e => e.name && e.desc && e.color && e.weight > 0), '每张事件卡都有名字、说明、颜色与权重');
      game.event = EVENTS.find(e => e.id === 'coins');
      assert(eventScoreMul() === 1.5, '金币雨把金币分变成 ×1.5');
      game.event = EVENTS.find(e => e.id === 'current');
      assert(eventSpeedMul() > 1, '顺流事件会提速');
      game.event = EVENTS.find(e => e.id === 'head');
      assert(eventSpeedMul() < 1 && eventScoreMul() > 1, '逆流事件变慢但金币分更高');
      game.event = null;
      assert(eventScoreMul() === 1 && eventSpeedMul() === 1, '没有事件卡时不加成');
    }

    // ---- 6. 险过 → 完美穿越 ----
    clean(0);
    {
      const p = game.player;
      p.lane = 1; p.x = LANES[1]; p.dodge = 0;
      for (let i = 0; i < DODGE_NEED; i++) {
        game.props = [{ type: 'hurdle', x: LANES[1], z: p.z - 2 }];
        p.hurtT = 0;
        updatePlaying(0.016);
        if (game.deadT) throw new Error('从身后掠过的障碍不该判死');
      }
      assert(p.dodge === 0 && p.perfectT > 0, '连续险过 6 次触发完美穿越');
      assert(p.perfectGuardT > 0, '完美穿越带一小段无敌');
    }
    clean(3);
    {
      const p = game.player; p.perfectT = 5; game.combo = 0;
      const s0 = game.coinScore;
      collectCoin({ x: 0, y: .5, z: 1 });
      assert(game.coinScore - s0 === 24, '完美穿越期间金币分翻倍');
    }

    // ---- 8. 连击变身 ----
    clean(2);
    {
      const p = game.player;
      p.lane = 1; p.x = LANES[1];
      game.combo = 15; game.comboT = 2; p.formShown = 0;
      updatePlaying(0.016);
      assert(p.formTier === 1 && p.formArmor && p.formT > 0, '15 连击触发泡泡护甲');
      game.props = [{ type: 'hurdle', x: LANES[1], z: p.z + 0.3 }];
      updatePlaying(0.016);
      assert(!game.deadT && p.formTier === 0 && !p.formArmor, '泡泡护甲挡下一次撞击后消失');
    }
    clean(2);
    {
      const p = game.player;
      game.combo = 30; game.comboT = 2; p.formShown = 0;
      updatePlaying(0.016);
      assert(p.formTier === 2, '30 连击触发鱼鳍疾行');
      game.combo = 30; game.comboT = 2;
      updatePlaying(0.016);
      assert(game.speed > 17 * 1.1, '鱼鳍疾行期间跑得更快');
    }

    // ---- 4. 车顶二层赛道 ----
    clean(2);
    {
      const p = game.player;
      p.lane = 1; p.x = LANES[1];
      game.props = [
        { type: 'train', x: LANES[1], z: p.z + 0.3, len: 12, hw: 0.95, h: TRAIN_H, style: 'submarine', color: '#e84b3c' },
        { type: 'roofhurdle', x: LANES[1], z: p.z + 0.3, y: TRAIN_H },
      ];
      p.y = TRAIN_H; p.onTrain = true; p.vy = 0;
      updatePlaying(0.016);
      assert(game.deadT > 0, '站在车顶撞上车顶路障会出事');
    }
    clean(2);
    {
      const p = game.player;
      p.lane = 1; p.x = LANES[1];
      game.props = [
        { type: 'train', x: LANES[1], z: p.z + 0.3, len: 12, hw: 0.95, h: TRAIN_H, style: 'submarine', color: '#e84b3c' },
        { type: 'roofhurdle', x: LANES[1], z: p.z + 0.3, y: TRAIN_H },
      ];
      p.y = TRAIN_H + 1.4; p.onTrain = false; p.vy = 5;
      updatePlaying(0.016);
      assert(!game.deadT, '跳过车顶路障就不会撞上');
    }

    return msgs;
  });
  msgs.forEach(m => results.push(m));

  // ---- HUD 带宽：把全部状态药丸（含新增的事件卡 / 漩涡 / 变身）都点亮，
  //      确认提示牌、状态栏与连击提示三段互不重叠、提示牌不压天际线 ----
  await page.evaluate(() => { game.charIdx = 0; });
  await page.getByRole('button', { name: /选择跑者/ }).click();
  await page.getByRole('button', { name: '出发', exact: true }).click();
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    game.state = 'paused';
    game.magnetT = 5.6; game.jetT = 2.9; game.boardT = 3.9; game.charGuardT = 1.2;
    game.districtBannerT = 2.2;
    game.event = EVENTS.find(e => e.id === 'jelly');
    game.whirlT = 3.4;
    game.player.formTier = 2; game.player.formT = 5; game.player.formArmor = true;
  });
  for (const [width, height] of [[1024, 768], [1280, 720], [1440, 900], [760, 800], [412, 740]]) {
    await page.setViewportSize({ width, height });
    const bands = await page.evaluate(() => {
      const cp = document.getElementById('comboPop');
      cp.classList.remove('go'); // 动画会让 rect 带上位移，先复位再量
      updateHUD(); updatePowers(); layoutHudBands();
      const rect = el => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
      const hits = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const banner = rect(document.getElementById('districtBanner'));
      const bad = [];
      document.querySelectorAll('#hudPowers .power').forEach(el => { if (hits(banner, rect(el))) bad.push(el.textContent.trim()); });
      if (document.getElementById('hud').hidden) throw new Error('HUD 应该是可见的');
      return {
        pills: document.querySelectorAll('#hudPowers .power').length, banner, bad,
        comboTop: rect(document.getElementById('comboPop')).top,
        topBlock: Math.max(rect(document.querySelector('.hud-top')).bottom,
          rect(document.getElementById('hudPowers')).bottom, rect(document.getElementById('hudMission')).bottom),
      };
    });
    if (bands.pills < 7) throw new Error(`状态药丸没有全部点亮 (${width}x${height}): ${bands.pills}`);
    if (bands.bad.length) throw new Error(`状态药丸压住街区提示牌 (${width}x${height}): ` + bands.bad.join(' / '));
    if (bands.comboTop < bands.topBlock) throw new Error(`连击提示压住顶部面板 (${width}x${height})`);
    assert(true, `HUD 三段不重叠 ${width}x${height}（${bands.pills} 个状态药丸）`);
  }

  if (errors.length) throw new Error('页面错误: ' + errors.join('; '));
  return { passed: results.length, results, browserErrors: errors };
}
