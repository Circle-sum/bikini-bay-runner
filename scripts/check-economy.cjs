async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:4173');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#title').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '海底商店' }).click();
  if (await page.locator('#shopGrid [data-buy]').count() !== 11) throw new Error('Shop item count mismatch');
  if (!await page.getByRole('button', { name: '购买 80' }).isDisabled()) throw new Error('Empty wallet should disable purchases');
  await page.evaluate(() => { SAVE.wallet = 300; persistEconomy(); renderShop(); });
  await page.getByRole('button', { name: '购买 80' }).click();
  if (await page.evaluate(() => SAVE.wallet !== 220 || !SAVE.boards.includes('bubble') || SAVE.board !== 'bubble')) throw new Error('Board purchase did not persist');
  await page.locator('.shop-item').filter({ hasText: '泡泡复活券' }).getByRole('button', { name: '购买 120' }).click();
  if (await page.evaluate(() => SAVE.wallet !== 100 || SAVE.revive !== 1)) throw new Error('Revive purchase did not persist');
  await page.locator('.shop-item').filter({ hasText: '船长小帽' }).getByRole('button', { name: '购买 100' }).click();
  if (await page.evaluate(() => SAVE.wallet !== 0 || SAVE.decoration !== 'cap')) throw new Error('Decoration purchase did not persist');
  await page.evaluate(() => { SAVE.wallet = 1000; persistEconomy(); renderShop(); });
  await page.locator('.shop-item').filter({ hasText: '开局磁铁' }).getByRole('button', { name: '购买 90' }).click();
  await page.locator('.shop-item').filter({ hasText: '开局冲浪板' }).getByRole('button', { name: '购买 120' }).click();
  await page.locator('.shop-item').filter({ hasText: '珍珠贝壳板' }).getByRole('button', { name: '购买 240' }).click();
  if (await page.evaluate(() => {
    const plan = Array.from({ length: 12 }, (_, i) => districtIdForSegment(i));
    const allDistricts = new Set(plan).size === DISTRICTS.length;
    return SAVE.startMagnet !== 1 || SAVE.startBoard !== 1 || !SAVE.boards.includes('pearl') || SAVE.board !== 'pearl' || !allDistricts;
  })) throw new Error('Shop extras did not persist');
  await page.evaluate(() => { startRun(); game.state = 'paused'; openShop('title'); });
  if (await page.evaluate(() => game.magnetT !== 6 || game.boardCharges !== 2 || SAVE.startMagnet !== 0 || SAVE.startBoard !== 0)) throw new Error('Start consumables did not activate');

  // 写盘失败必须回滚内存状态：否则会出现「提示未扣款，但钱在内存里已经花了」
  await page.evaluate(() => { SAVE.wallet = 777; persistEconomy(); });
  const rollback = await page.evaluate(() => {
    const original = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('模拟存储配额满'); };
    SAVE.wallet = 700;
    const ok = persistEconomy();
    localStorage.setItem = original;
    return { ok, wallet: SAVE.wallet };
  });
  if (rollback.ok !== false) throw new Error('persistEconomy should report failure when storage write fails');
  if (rollback.wallet !== 777) throw new Error('persistEconomy did not roll back wallet, got ' + rollback.wallet);

  await page.evaluate(() => { SAVE.wallet = 0; persistEconomy(); });
  await page.getByRole('button', { name: '返回' }).click();
  if (await page.locator('#shop').isVisible()) throw new Error('Shop close failed');
  await page.getByRole('button', { name: '选择跑者', exact: true }).click();
  await page.getByRole('button', { name: '出发', exact: true }).click();
  // 先把成就全部标记为已达成：成就奖励会单独加钱，这里只验证「本局结算」的增量逻辑
  await page.evaluate(() => {
    SAVE.achievements = ACHIEVEMENTS.map(a => a.id); persistEconomy();
    game.state = 'playing'; game.coins = 10; game.missionDone = [true, false, false]; game.creditedReward = 0; showOver();
  });
  if (await page.evaluate(() => SAVE.wallet !== 30 || game.creditedReward !== 30)) throw new Error('Run reward did not credit wallet once');
  if (!await page.locator('#btnRevive').isVisible()) throw new Error('Revive button missing');
  await page.locator('#btnRevive').click();
  if (await page.evaluate(() => game.state !== 'playing' || SAVE.revive !== 0 || game.reviveGuardT <= 0)) throw new Error('Revive flow failed');
  await page.evaluate(() => { game.state = 'playing'; game.coins = 12; game.missionDone = [true, false, false]; showOver(); });
  if (await page.evaluate(() => SAVE.wallet !== 32 || game.creditedReward !== 32)) throw new Error('Second death only credited new reward');
  await page.getByRole('button', { name: '去商店' }).click();
  // 最后装备的是珍珠贝壳板；最早买的泡泡板应该仍在已拥有列表里
  if (await page.evaluate(() => SAVE.board !== 'pearl' || !SAVE.boards.includes('pearl') || !SAVE.boards.includes('bubble'))) throw new Error('Loadout lost after shop reopen');
  await page.screenshot({ path: 'output/playwright/shop-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/shop-mobile.png' });
  if (errors.length) throw new Error(errors.join('; '));
  return { wallet: await page.evaluate(() => SAVE.wallet), boards: await page.evaluate(() => SAVE.boards), revive: await page.evaluate(() => SAVE.revive), decoration: await page.evaluate(() => SAVE.decoration), errors };
}
