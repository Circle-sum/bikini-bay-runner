// Run through: playwright-cli -s=bikini run-code --filename=scripts/check-game.cjs
async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#title').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '选择跑者', exact: true }).click();
  for (const [name, skill] of [['海绵碧莲','金光护体'], ['派宝宝','一铲开路'], ['章鱼王哥','触手慢调'], ['诸葛珊迪','穹顶推演']]) {
    await page.getByRole('button', { name, exact: true }).click();
    if (await page.locator('#selectedProfile h3').textContent() !== name) throw new Error('Character heading mismatch: ' + name);
    if (await page.locator('.profile-skill strong').textContent() !== skill) throw new Error('Skill mismatch: ' + skill);
  }
  await page.screenshot({ path: 'output/playwright/select-desktop.png' });
  const results = await page.evaluate(() => {
    const results = [];
    function assert(value, message) { if (!value) throw new Error(message); results.push(message); }
    function clean(index) {
      game.charIdx = index; resetRun(); game.state = 'playing';
      game.props = []; game.spawnZ = 10000; game.sceneryZ = 10000;
      camUpdate(1);
    }
    clean(0);
    game.props = [{ type: 'hurdle', x: 0, z: .3 }, { type: 'gate', x: 0, z: .3 }];
    updatePlaying(.016);
    assert(!game.deadT && game.charSkillUsed && game.charGuardT > 0, 'Gold shield blocks overlapping first hits');
    game.charGuardT = 0; game.props = [{ type: 'hurdle', x: 0, z: game.player.z + .3 }]; updatePlaying(.016);
    assert(game.deadT > 0, 'Gold shield cannot trigger twice');
    clean(0); assert(!game.charSkillUsed && !game.charGuardT, 'Restart restores skill');
    clean(1); game.props = [{ type: 'hurdle', x: 0, z: .3 }]; useCharacterSkill(); updatePlaying(.016);
    assert(!game.deadT && game.charSkillUsed && !game.props.length, 'Shovel removes hurdle');
    clean(1); game.props = [{ type: 'gate', x: 0, z: .3, full: true }]; useCharacterSkill(); updatePlaying(.016);
    assert(!game.deadT && game.charSkillUsed && !game.props.length, 'Shovel removes gate');
    clean(1); game.props = [{ type: 'jelly', x: 0, z: .3 }]; useCharacterSkill(); updatePlaying(.016);
    assert(!game.deadT && game.charSkillUsed, 'Shovel removes jellyfish');
    clean(1); game.props = [{ type: 'train', x: 0, z: 6.2, len: 12, hw: .95, h: 2.35 }]; updatePlaying(.016);
    assert(game.deadT > 0 && !game.charSkillUsed, 'Train collision uses front edge and cannot be shoveled');
    clean(2); game.props = [{ type: 'hurdle', x: 0, z: 20 }]; useCharacterSkill();
    assert(game.charSlowT === 4 && game.charSkillUsed, 'Slow skill triggers only after manual use');
    const train = { type: 'train', x: 2.2, z: 40, len: 10, hw: .95, h: 2.35, moving: true, vel: -10 };
    game.props = [train]; updatePlaying(.1);
    assert(Math.abs(train.z - 39.4) < .001 && game.speed < 11, 'Slow affects runner and approaching trains');
    game.charSlowT = 0; game.props = [{ type: 'hurdle', x: 0, z: 20 }]; useCharacterSkill();
    assert(game.charSlowT === 0, 'Slow cannot retrigger in same run');
    clean(3); game.props = [{ type: 'gate', x: 0, z: 10, full: true }]; useCharacterSkill();
    assert(game.safeLane === -1 && game.routeText.includes('翻滚'), 'Planner gives roll instruction for full-width gate');
    game.props = [{ type: 'hurdle', x: 0, z: 10, full: true }]; updateRouteHint();
    assert(game.safeLane === -1 && game.routeText.includes('跳跃'), 'Planner gives jump instruction for full-width hurdle');
    game.props = [-2.2, 0].map(x => ({ type: 'train', x, z: 16, len: 12, hw: .95, h: 2.35 })); updateRouteHint();
    assert(game.safeLane === 2, 'Planner finds free lane beside trains');
    game.props = [0, 2.2].map(x => ({ type: 'train', x, z: 16, len: 12, hw: .95, h: 2.35 })); updateRouteHint();
    assert(game.safeLane === 0, 'Planner updates for changed obstacle layout');
    clean(3); game.props = [{ type: 'gate', x: 0, z: 10, full: true }];
    assert(game.charHintT === 0, 'Planner is idle before manual use');
    useCharacterSkill();
    assert(game.charHintT === 5 && game.charSkillUsed, 'Planner activates only after manual use');
    clean(3); game.props = [{ type: 'gate', x: 0, z: 10, full: true }]; useCharacterSkill(); useCharacterSkill();
    assert(game.charHintT === 5, 'Planner cannot retrigger in same run');
    clean(3); for (let i = 0; i < 15; i++) collectCoin({ x: 0, y: .5, z: 1 });
    assert(game.coinScore === 14 * 12 + 18 && game.comboT === 3.4, 'Planner receives real combo bonus and extra combo time');
    game.coins = 30; game.meters = 300; updateMissions();
    assert(game.taskScore === 1500 && game.missionDone.every(Boolean), 'Three missions reward 1500 points');
    updateMissions(); assert(game.taskScore === 1500, 'Mission rewards are not duplicated');
    clean(0); doBoard(); const duration = game.boardT; doBoard();
    assert(duration === 4 && game.boardT === 4 && game.boardUsed, 'Surfboard has one charge');
    clean(1); game.player.y = .05; game.player.vy = -15; game.player.jumpBuf = .1; updatePlaying(.016);
    assert(game.player.vy > 0, 'Buffered jump survives landing');
    clean(1); game.props = [{ type: 'hurdle', x: 0, z: .3 }]; game.player.y = 1.5; updatePlaying(.016);
    assert(!game.deadT && !game.charSkillUsed, 'Jump clears a low obstacle without consuming skill');
    clean(1); game.props = [{ type: 'gate', x: 0, z: .3 }]; game.player.rollT = .5; updatePlaying(.016);
    assert(!game.deadT && !game.charSkillUsed, 'Roll clears a gate without consuming skill');
    clean(0); game.player.z = 1600; camUpdate(1); renderWorld(0);
    assert(project(0, .1, cam.z + .5) !== null && project(0, .1, game.player.z + 160) !== null, 'Track projection remains valid past 1000 meters');
    assert(propTailZ({ type: 'train', z: cam.z - 2, len: 12 }) > cam.z - 3, 'Train cleanup waits for the rear carriage');

    // 跑道连续：枕木与钢轨共用近端裁切，屏幕底部仍有枕木纹理
    assert(GROUND_NEAR_DZ <= 0.5, 'Track ties cull at the camera near plane');
    clean(0); game.player.z = 1200; camUpdate(1); game.state = 'paused'; renderWorld(0);
    {
      const cvEl = document.getElementById('game'), c2 = cvEl.getContext('2d');
      const y0 = Math.floor(cvEl.height * 0.75);
      const img = c2.getImageData(0, y0, cvEl.width, cvEl.height - y0).data;
      let tiePixels = 0;
      for (let i = 0; i < img.length; i += 4 * 37) {
        const r = img[i], g = img[i + 1], b = img[i + 2];
        if ((Math.abs(r - 122) < 18 && Math.abs(g - 90) < 18 && Math.abs(b - 60) < 18) ||
            (Math.abs(r - 110) < 18 && Math.abs(g - 80) < 18 && Math.abs(b - 53) < 18)) tiePixels++;
      }
      assert(tiePixels > 40, 'Track ties stay drawn down to the screen bottom');
    }

    // 街区规则：250 米一段、顺序随机且不连续重复、每进入一次提示一次
    clean(0);
    {
      const plan = Array.from({ length: 24 }, (_, i) => districtIdForSegment(i));
      assert(plan.every(id => DISTRICTS.some(d => d.id === id)), 'District plan only uses known districts');
      assert(new Set(plan.slice(0, 8)).size === DISTRICTS.length, 'All four districts appear within the first eight segments');
      assert(plan.every((id, i) => i === 0 || id !== plan[i - 1]), 'District plan never repeats back to back');
      assert(new Set(plan).size > 1, 'District order rotates instead of staying fixed');
      assert(DISTRICTS.every(d => d.palette && d.palette.skyTop && d.palette.sand && d.palette.road), 'Every district has its own environment palette');
      assert(new Set(DISTRICTS.map(d => d.palette.skyTop)).size === DISTRICTS.length, 'District sky colors all differ');
      assert(new Set(DISTRICTS.map(d => d.palette.sand)).size === DISTRICTS.length, 'District ground colors all differ');
      assert(districtPaletteAt(10).skyTop !== districtPaletteAt(DISTRICT_METERS - 1).skyTop, 'Environment color blends before the boundary');
    }
    game.districtSegment = 0; game.districtBannerT = 0;
    game.meters = DISTRICT_METERS - 5; updateDistrictState(0.016);
    assert(game.districtSegment === 0 && game.districtBannerT === 0, 'No repeat prompt inside one district');
    game.meters = DISTRICT_METERS + 5; updateDistrictState(0.016);
    assert(game.districtSegment === 1 && game.districtBannerT > 2, 'Each district entry shows the name once');
    game.districtBannerT = 0; game.meters = DISTRICT_METERS + 60; updateDistrictState(0.016);
    assert(game.districtBannerT === 0, 'Staying in a district keeps the banner hidden');
    game.meters = DISTRICT_METERS * 2 + 5; updateDistrictState(0.016);
    assert(game.districtSegment === 2 && game.districtBannerT > 2, 'Crossing a second boundary prompts again');

    clean(3); SAVE.unlocked = CHARS.map(c => c.id); gotoSelect(); buildCharList();
    return results;
  });
  await page.getByRole('button', { name: '出发', exact: true }).click();
  await page.evaluate(() => { game.props = []; game.spawnZ = game.player.z + 1000; game.sceneryZ = game.player.z + 1000; game.state = 'playing'; game.deadT = 0; showHUD(); updatePowers(); });
  if (!await page.locator('#btnSkill').isEnabled()) throw new Error('Active character skill button is disabled');
  await page.locator('#btnSkill').click();
  // 点按后技能立即生效；charHintT 会随每帧递减，所以只断言「已激活且在计时」，不比对精确的 5
  const skillState = await page.evaluate(() => ({ used: game.charSkillUsed, hint: game.charHintT, char: game.player.char.id }));
  if (!skillState.used || skillState.hint <= 0 || skillState.char !== 'sandy')
    throw new Error('Skill button did not activate planner: ' + JSON.stringify(skillState));
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  const before = await page.evaluate(() => game.player.z);
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => game.player.z);
  if (before !== after) throw new Error('Pause moved runner');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await page.keyboard.press('ArrowLeft');
  if (await page.evaluate(() => game.player.lane) !== 0) throw new Error('Keyboard lane switch failed');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Escape');
  if (await page.evaluate(() => game.state) !== 'paused') throw new Error('Escape pause failed');
  await page.getByRole('button', { name: '换角色', exact: true }).click();
  const layout = [];
  for (const [width, height] of [[390,844], [360,640], [412,740], [412,860], [844,390], [1280,720]]) {
    await page.setViewportSize({ width, height });
    const metrics = await page.evaluate(() => {
      const main = document.getElementById('select');
      const button = document.getElementById('btnGo');
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
      };
      const stage = box('.portrait-stage'), img = box('#heroPortrait');
      const role = box('.profile-role'), cards = box('.chars');
      const profile = box('.selected-profile'), bottom = box('.select-bottom');
      return {
        width: innerWidth,
        overflow: main.scrollWidth > innerWidth + 1,
        buttonWidth: button.getBoundingClientRect().width,
        scrollable: main.scrollHeight > main.clientHeight,
        portraitInsideStage: !img || !stage ? false : img.top >= stage.top - 1 && img.bottom <= stage.bottom + 1 && img.left >= stage.left - 1 && img.right <= stage.right + 1,
        roleClearsCards: !role || !cards ? true : role.bottom <= cards.top,
        profileClearsBottom: !profile || !bottom ? true : profile.bottom <= bottom.top,
      };
    });
    if (metrics.overflow || metrics.buttonWidth < 100) throw new Error('Invalid responsive layout: ' + JSON.stringify(metrics));
    if (!metrics.portraitInsideStage) throw new Error('Portrait image is clipped by its card: ' + JSON.stringify(metrics));
    if (!metrics.roleClearsCards || !metrics.profileClearsBottom) throw new Error('Select screen blocks overlap: ' + JSON.stringify(metrics));
    layout.push(metrics);
    await page.screenshot({ path: `output/playwright/select-${width}x${height}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '出发', exact: true }).click();
  await page.evaluate(() => { game.state = 'paused'; game.player.z = 110; game.sceneryZ = 102; game.props = []; while (game.sceneryZ < 220) spawnScenery(); game.props.push({ type: 'train', x: -2.2, z: 132, len: 12, hw: .95, h: 2.35, color: '#ea9172', style: 'submarine' }, { type: 'hurdle', x: 0, z: 145, app: 'shell' }, { type: 'hurdle', x: 2.2, z: 149, app: 'crate' }); coinLine(2, 118, 10); game.meters = game.player.z * .62; camUpdate(1); updateRouteHint(); updateHUD(); updatePowers(); renderWorld(0); });
  await page.screenshot({ path: 'output/playwright/game-desktop.png' });

  // 连击提示与街区提示固定两条带：不压顶部面板、互不重叠
  const hudBands = [];
  for (const [width, height] of [[360,640], [390,700], [412,740], [390,844], [1280,720]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      game.state = 'paused';
      game.magnetT = 5.6; game.jetT = 2.9; game.boardT = 3.9; game.districtBannerT = 2.2;
      updatePowers(); updateHUD(); layoutHudBands();
      const cp = document.getElementById('comboPop');
      cp.textContent = '55 连击!';
      cp.classList.remove('go');
    });
    const bands = await page.evaluate(() => {
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
      };
      const pillRects = [...document.querySelectorAll('.hud-top .pill')].map(el => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
      });
      return {
        pills: box('.hud-top'), powers: box('#hudPowers'), mission: box('#hudMission'),
        combo: box('#comboPop'), banner: box('#districtBanner'),
        pillRects, pause: box('#btnPause'), horizon: Math.round(cam.horizon),
      };
    });
    const topBlock = Math.max(bands.pills.bottom, bands.powers.bottom, bands.mission.bottom);
    if (bands.combo.top < topBlock) throw new Error('Combo prompt overlaps the top HUD: ' + JSON.stringify(bands));
    if (bands.combo.top < bands.banner.bottom) throw new Error('Combo prompt overlaps the district banner: ' + JSON.stringify(bands));
    if (bands.banner.bottom > bands.horizon - 6) throw new Error('District banner drops below the horizon: ' + JSON.stringify(bands));
    const hits = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (const rect of [...bands.pillRects, bands.pause]) {
      if (hits(bands.banner, rect)) throw new Error('District banner overlaps the top pills: ' + JSON.stringify(bands));
    }
    hudBands.push(bands);
    await page.screenshot({ path: `output/playwright/hud-bands-${width}x${height}.png` });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { camUpdate(1); renderWorld(0); });
  await page.screenshot({ path: 'output/playwright/game-mobile.png' });
  await page.evaluate(() => { game.charIdx = 0; gotoTitle(); buildCharList(); });
  await page.screenshot({ path: 'output/playwright/title-mobile.png' });
  if (errors.length) throw new Error('Page errors: ' + errors.join('; '));
  return { passed: results.length, results, layout, hudBands, browserErrors: errors };
}
