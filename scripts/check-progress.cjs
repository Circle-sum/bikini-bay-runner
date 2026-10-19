// 成长系统回归：角色解锁、生涯统计、成就奖励、设置存档、每街区 BGM。
// 与 check-game / check-economy 同为 playwright 的 `async (page) => {...}` 形式。
async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const results = [];
  const assert = (value, message) => { if (!value) throw new Error(message); results.push(message); };

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:4173');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#title').waitFor({ state: 'visible' });

  // ---- 初始解锁状态 ----
  const starter = await page.evaluate(() => ({
    unlocked: SAVE.unlocked.slice(), starterId: STARTER_CHAR_ID, ids: CHARS.map(c => c.id),
  }));
  assert(starter.unlocked.length === 1 && starter.unlocked[0] === starter.starterId, '新存档只解锁开局伙伴');

  // 未解锁的角色不能开局
  const blocked = await page.evaluate(() => { game.charIdx = 1; resetRun(); startRun(); return game.state; });
  assert(blocked !== 'playing', '未解锁的角色无法开局');

  // ---- 选人界面：锁定角色可预览，钱包不足时解锁键不可点 ----
  await page.getByRole('button', { name: '选择跑者', exact: true }).click();
  await page.locator('.char-card').nth(1).click();
  const preview = await page.evaluate(() => ({
    heading: document.querySelector('#selectedProfile h3').textContent,
    name: CHARS[game.charIdx].name,
    locked: !isCharUnlocked(CHARS[game.charIdx].id),
    hasLockBadge: !!document.querySelector('.char-card.locked .clock'),
    goDisabled: document.getElementById('btnGo').disabled,
  }));
  assert(preview.locked && preview.heading === preview.name, '锁定角色仍能点开档案预览');
  assert(preview.hasLockBadge, '锁定的角色卡带小锁角标');
  assert(preview.goDisabled, '贝壳币不足时解锁按钮不可点');

  // ---- 解锁扣款并写盘 ----
  const price = await page.evaluate(() => { SAVE.wallet = 500; persistEconomy(); renderSelectTop(); return CHARS[1].unlock; });
  if (await page.evaluate(() => document.getElementById('btnGo').disabled)) throw new Error('钱包充足时解锁按钮应可点');
  await page.locator('#btnGo').click();
  const bought = await page.evaluate(() => ({ unlocked: SAVE.unlocked.slice(), wallet: SAVE.wallet, state: game.state }));
  assert(bought.unlocked.includes('patrick'), '点击解锁后角色进入已解锁列表');
  assert(bought.wallet === 500 - price, '解锁扣除了正确的贝壳币');
  assert(bought.state === 'select', '解锁后停留在选人界面，不直接开局');

  await page.reload();
  await page.locator('#title').waitFor({ state: 'visible' });
  assert(await page.evaluate(() => SAVE.unlocked.includes('patrick')), '解锁状态刷新后仍保留');

  // ---- 集齐角色触发成就 ----
  const crew = await page.evaluate(() => {
    SAVE.wallet = 3000; persistEconomy();
    for (let guard = 0; guard < CHARS.length && SAVE.unlocked.length < CHARS.length; guard++) {
      unlockCharacter(CHARS.findIndex(c => !isCharUnlocked(c.id)));
    }
    return { count: SAVE.unlocked.length, total: CHARS.length, crewFull: SAVE.achievements.includes('crew-full') };
  });
  assert(crew.count === crew.total, '可以依次解锁全部四位跑者');
  assert(crew.crewFull, '集齐角色触发「小队集结」成就');

  // ---- 一局结算：生涯统计 + 成就奖励 ----
  const run = await page.evaluate(() => {
    SAVE.achievements = []; SAVE.stats = emptyStats(); persistEconomy();
    const w0 = SAVE.wallet;
    game.charIdx = 0; resetRun(); game.state = 'playing';
    game.meters = 1200; game.coins = 60; game.maxCombo = 35;
    game.missionDone = [true, true, true];
    game.districtsSeen = ['pineapple', 'krusty', 'jelly', 'dome'];
    game.score = 24000;
    showOver();
    const earned = ACHIEVEMENTS.filter(a => SAVE.achievements.includes(a.id));
    return {
      runs: SAVE.stats.runs, meters: SAVE.stats.meters, coins: SAVE.stats.coins,
      bestCombo: SAVE.stats.bestCombo, districts: SAVE.stats.districts.length,
      earnedIds: earned.map(a => a.id),
      rewardSum: earned.reduce((sum, a) => sum + a.reward, 0),
      gained: SAVE.wallet - w0,
    };
  });
  assert(run.runs === 1 && run.meters === 1200 && run.coins === 60, '结算写入总跑局数、距离与金币');
  assert(run.bestCombo === 35 && run.districts === 4, '结算写入最高连击与到访街区');
  assert(run.earnedIds.includes('first-run') && run.earnedIds.includes('run-1000'), '触发首次跑局与千米成就');
  assert(run.earnedIds.includes('run-coins-50') && run.earnedIds.includes('combo-30'), '触发金币与连击成就');
  assert(run.earnedIds.includes('districts-4') && run.earnedIds.includes('score-20000'), '触发环线旅行家与高分成就');
  assert(!run.earnedIds.includes('combo-60'), '未达标的成就不会提前发放');
  // 本局结算 = 60 金币 + 3×20 挑战奖励 = 120；成就奖励额外叠加
  assert(run.gained === 120 + run.rewardSum, '成就奖励与结算奖励各自独立入账');

  // ---- 统计与成就写盘 ----
  await page.reload();
  await page.locator('#title').waitFor({ state: 'visible' });
  const persisted = await page.evaluate(() => ({ runs: SAVE.stats.runs, meters: SAVE.stats.meters, ach: SAVE.achievements.length }));
  assert(persisted.runs === 1 && persisted.meters === 1200, '生涯统计刷新后仍保留');
  assert(persisted.ach === run.earnedIds.length, '成就列表刷新后仍保留');

  // ---- 成就界面渲染 ----
  await page.getByRole('button', { name: '成就', exact: true }).click();
  const achUI = await page.evaluate(() => ({
    cards: document.querySelectorAll('#achGrid .ach-card').length,
    got: document.querySelectorAll('#achGrid .ach-card.got').length,
    total: ACHIEVEMENTS.length,
  }));
  assert(achUI.cards === achUI.total, '成就界面渲染出全部成就卡片');
  assert(achUI.got === persisted.ach, '已达成成就高亮显示');
  await page.getByRole('button', { name: '关闭成就' }).click();
  assert(await page.locator('#title').isVisible(), '成就界面可以返回首页');

  // ---- 设置：音量 / 画质 / 震动 / 存档 ----
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.evaluate(() => {
    const el = document.getElementById('setBgm');
    el.value = '5'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert(await page.evaluate(() => Math.abs(SETTINGS.bgm - 0.05) < 1e-6), '拖动滑块改变背景音乐音量');
  assert(await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('bbSubwaySettingsV1') || '{}');
    return Math.abs(raw.bgm - 0.05) < 1e-6;
  }), '音量写入设置存档');

  await page.locator('#setQuality button', { hasText: '低' }).click();
  assert(await page.evaluate(() => SETTINGS.quality === 'low' && DPR_CAP === 1.25), '选择低画质后分辨率上限降为 1.25x');
  assert(await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('bbSubwaySettingsV1') || '{}');
    return raw.quality === 'low';
  }), '画质档位写入设置存档');

  await page.locator('#setVibrate').click();
  assert(await page.evaluate(() => SETTINGS.vibrate === false), '可以关闭碰撞震动');

  await page.reload();
  await page.locator('#title').waitFor({ state: 'visible' });
  assert(await page.evaluate(() =>
    SETTINGS.quality === 'low' && Math.abs(SETTINGS.bgm - 0.05) < 1e-6 && SETTINGS.vibrate === false
  ), '设置项刷新后全部保留');

  // ---- 每街区 BGM ----
  const bgm = await page.evaluate(() => {
    const ids = Object.keys(BGM_PATTERNS);
    return {
      ids,
      bpms: new Set(Object.values(BGM_PATTERNS).map(p => p.bpm)).size,
      leadVariants: new Set(Object.values(BGM_PATTERNS).map(p => p.lead.join(','))).size,
      everyDistrictCovered: DISTRICTS.every(d => !!BGM_PATTERNS[d.id]),
    };
  });
  assert(bgm.ids.length === 4 && bgm.everyDistrictCovered, '四个街区各有一段 BGM');
  assert(bgm.bpms >= 3 && bgm.leadVariants === 4, '四段 BGM 的节奏与旋律各不相同');

  const switched = await page.evaluate(() => {
    resetRun(); game.state = 'playing'; game.districtSegment = 0;
    AudioSys.setDistrict(districtIdForSegment(0));
    game.meters = DISTRICT_METERS + 5;
    updateDistrictState(0.016);
    const id = districtIdForSegment(1);
    return { same: AudioSys.pattern === BGM_PATTERNS[id], id };
  });
  assert(switched.same, '进入新街区时 BGM 切到该街区的段落');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.screenshot({ path: 'output/playwright/settings-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: '成就' }).click();
  await page.screenshot({ path: 'output/playwright/achievements-mobile.png' });

  if (errors.length) throw new Error('页面错误: ' + errors.join('; '));
  return { passed: results.length, results, earned: run.earnedIds, browserErrors: errors };
}
