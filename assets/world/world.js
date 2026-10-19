/* ================= 小世界 · 可走动的比奇堡海湾 =================
 *
 * 这里不是「点卡片」的地图，而是一张能走的海湾：俯视视角、镜头跟着跑者，
 * 沙滩上站着蟹堡王和空手道棚（装修中），东边一片浅水就是水母田。
 *
 * 玩法闭环：
 *   - 沙滩上走动（WASD / 方向键；触屏拖动或点地走路）；
 *   - 走进浅水 → 自动开始抓水母（同一张地图、同一个镜头，没有切场景）；
 *   - 抓法改成「撒网」：点/按空格把网撒到准星位置，落网瞬间罩住一圈水母；
 *   - 每局 3 个果冻诱饵：丢在脚边把附近水母（连电水母）引过来聚团，再一网收；
 *   - 涨潮计时 45 秒，潮水涨满自动上岸结算。
 *
 * 这是经典脚本，和 index.html 的内联脚本共用全局作用域，有几条要遵守：
 *   1. 顶层只放纯字面量常量。载入顺序上本文件在前，此时 index.html 里的
 *      const/let 还在 TDZ，顶层调用 clamp()/mulberry32()/CHARS 之类会直接报错。
 *   2. 所有依赖游戏全局的函数都在运行期才被调用（那时全局都就绪了）。
 *   3. 需要随机性的装饰数据在 ensure() 里惰性生成，避免第 1 条踩雷。
 */

/* ---------------- 数值调参 ---------------- */
const WORLD_TUNING = {
  duration: 45,        // 涨潮时间（秒），到点自动上岸结算
  walkSpeed: 205,      // 沙滩步行速度（世界单位/秒）
  swimSpeed: 158,      // 水母田游泳速度
  playerR: 20,         // 跑者碰撞半径
  netR: 84,            // 网口半径（派宝宝 ×1.25）
  netRange: 300,       // 最远撒网距离
  netFlight: 0.24,     // 网飞出去的时间
  netOpen: 0.45,       // 落网水花停留时间
  netCd: 0.62,         // 撒网冷却（碧莲 0.44）
  zapStun: 2,          // 被电水母麻痹的秒数
  baitCount: 3,        // 每局诱饵数
  baitRange: 430,      // 诱饵最远投放距离（空手时丢在脚边）
  baitRadius: 250,     // 诱饵吸引半径
  baitLife: 5,         // 诱饵存活秒数
  jellyCap: 14,        // 水母田里的水母上限
  spawnGapMin: 2.1,    // 生成间隔
  spawnGapMax: 3.1,
  perfectMin: 6,       // 「完美一网」要求的最少捕获数
  perfectBonus: 12,    // 完美一网的额外贝壳币
  tideWarn: 10,        // 最后几秒开始提示涨潮
};

/* ---------------- 海湾地图 ----------------
 * 世界坐标是一张 2000×1300 的俯视图：西边大沙滩 + 东边浅水湾。
 * 碰撞用椭圆近似（岛 / 水母田），渲染用几块错位椭圆拼出不规则海岸线。 */
const WORLD_MAP = { w: 2000, h: 1300 };
const WORLD_ISLAND = { x: 760, y: 620, rx: 700, ry: 560 };
const WORLD_LAGOON = { x: 1470, y: 800, rx: 430, ry: 330 };
const WORLD_START = { x: 860, y: 660 };
const WORLD_SAND_BLOBS = [
  [0, 0, 1, 1], [0.52, 0.06, 0.5, 0.52], [-0.56, 0.14, 0.46, 0.5],
  [0.16, 0.58, 0.5, 0.38], [-0.2, -0.52, 0.52, 0.42], [0.62, -0.3, 0.3, 0.34],
];
const WORLD_LAGOON_BLOBS = [
  [0, 0, 1, 1], [-0.3, 0.05, 0.42, 0.6], [0.32, 0.1, 0.44, 0.66], [0.02, -0.42, 0.5, 0.42],
  [-0.05, 0.42, 0.46, 0.4],
];

/* ---------------- 水母图鉴 ----------------
 * weight 权重 / jelly 果冻数 / speed 游动速度 / turn 转向活跃度
 * 电水母不能抓：网罩到或碰到跑者都会短路 2 秒，连抓清零。 */
const JELLY_KINDS = {
  pink: { name: '粉水母', weight: 52, jelly: 1, speed: [26, 36], turn: 0.9, r: 22, body: 'rgba(255,150,195,0.92)', edge: '#d0558f', tentacle: 'rgba(255,150,190,0.9)', bob: 2.2, color: '#ff96be' },
  blue: { name: '蓝水母', weight: 30, jelly: 2, speed: [32, 44], turn: 1.7, r: 23, body: 'rgba(150,197,255,0.92)', edge: '#4a7fd6', tentacle: 'rgba(160,205,255,0.9)', bob: 2.6, color: '#7fb7ff' },
  zap: { name: '电水母', weight: 13, jelly: 0, speed: [44, 56], turn: 1.2, r: 20, body: 'rgba(196,255,150,0.94)', edge: '#5fae2a', tentacle: 'rgba(205,255,160,0.9)', bob: 3.1, color: '#b7ff6b', zap: true },
  gold: { name: '黄金水母', weight: 5, jelly: 5, speed: [62, 78], turn: 2.3, r: 19, body: 'rgba(255,214,90,0.96)', edge: '#c98f1b', tentacle: 'rgba(255,226,150,0.92)', bob: 3.6, color: '#ffd23e', gold: true },
};
const JELLY_KIND_ORDER = ['pink', 'blue', 'zap', 'gold'];

/* 存档里 world 字段的默认形状；readEconomy 会用它兜底老存档。 */
function emptyWorldSave() {
  return { jelly: 0, jellyRuns: 0, jellyCaught: 0, jellyBest: 0, jellyGold: 0 };
}

/* ---------------- 海湾里的三个地点 ---------------- */
const HUB_SPOTS = [
  {
    id: 'jelly', no: '01', name: '水母田', en: 'JELLYFIELDS', tag: '抓水母',
    desc: '走进浅水就开始抓', accent: '#8b5cf6', open: true,
    x: 1032, y: 700, doorX: 1032, doorY: 700, r: 120,
  },
  {
    id: 'krusty', no: '02', name: '蟹堡王', en: 'KRUSTY KRAB', tag: '做蟹黄包',
    desc: '秘方还在装修', accent: '#e8a020', open: false,
    x: 470, y: 430, doorX: 470, doorY: 500, r: 130,
  },
  {
    id: 'karate', no: '03', name: '空手道棚', en: 'KARATE SHACK', tag: '空手道切磋',
    desc: '道场还在装修', accent: '#4a7fd6', open: false,
    x: 500, y: 990, doorX: 500, doorY: 1060, r: 120,
  },
];

/* ---------------- 小工具 ---------------- */
function worldEllipseK(x, y, e, k) {
  const dx = (x - e.x) / (e.rx * k), dy = (y - e.y) / (e.ry * k);
  return Math.sqrt(dx * dx + dy * dy);
}
function worldTurnToward(a, b, maxStep) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + clamp(d, -maxStep, maxStep);
}
function worldRoundRect(x, y, w, h, r) {
  const rr2 = Math.max(0, Math.min(r, w / 2, h / 2));
  cx.beginPath();
  cx.moveTo(x + rr2, y);
  cx.arcTo(x + w, y, x + w, y + h, rr2);
  cx.arcTo(x + w, y + h, x, y + h, rr2);
  cx.arcTo(x, y + h, x, y, rr2);
  cx.arcTo(x, y, x + w, y, rr2);
  cx.closePath();
}
const hubRoundRect = worldRoundRect;

/* ================= 海湾（走动的世界） ================= */
const WorldHub = {
  spots: HUB_SPOTS,
  ready: false,
  picking: false,
  t: 0,
  player: { x: WORLD_START.x, y: WORLD_START.y, face: -Math.PI / 2, walk: 0, moving: false },
  cam: { x: WORLD_START.x, y: WORLD_START.y },
  keys: new Set(),
  drag: null,
  tap: null,
  near: null,
  hint: '',
  lastEntry: null,
  decor: [],
  _toastT: null,

  /* ---------- 坐标与碰撞 ---------- */
  inIsland(x, y, k = 1) { return worldEllipseK(x, y, WORLD_ISLAND, k) <= 1; },
  /* 沙滩是几块椭圆拼出来的，碰撞要用并集，才跟画出来的海岸线一致 */
  inIslandBlobs(x, y, k = 1) {
    const I = WORLD_ISLAND;
    for (const [dx, dy, sx, sy] of WORLD_SAND_BLOBS) {
      const ex = (x - (I.x + dx * I.rx)) / (I.rx * sx * k);
      const ey = (y - (I.y + dy * I.ry)) / (I.ry * sy * k);
      if (ex * ex + ey * ey <= 1) return true;
    }
    return false;
  },
  inLagoon(x, y, k = 1) { return worldEllipseK(x, y, WORLD_LAGOON, k) <= 1; },
  clampToLagoon(x, y, k) {
    const L = WORLD_LAGOON;
    const ex = (x - L.x) / (L.rx * k), ey = (y - L.y) / (L.ry * k);
    const d = Math.hypot(ex, ey);
    if (d <= 1) return { x, y };
    const f = 1 / d;
    return { x: L.x + ex * f * L.rx * k, y: L.y + ey * f * L.ry * k };
  },
  blockedByBuilding(x, y) {
    const pad = WORLD_TUNING.playerR * 0.8;
    for (const s of this.spots) {
      if (s.id === 'jelly') continue;
      const hw = s.id === 'krusty' ? 112 : 92;
      const top = s.id === 'krusty' ? s.y - 150 : s.y - 130;
      if (x > s.x - hw - pad && x < s.x + hw + pad && y > top - pad && y < s.y + pad) return true;
    }
    return false;
  },
  canStand(x, y) {
    if (!this.inIslandBlobs(x, y, 0.995) && !this.inLagoon(x, y, 0.985)) return false;
    return !this.blockedByBuilding(x, y);
  },
  scale() { return clamp(Math.min(W, H) / 620, 0.55, 1.15); },
  screenToWorld(sx, sy) {
    const s = this.scale();
    return { x: this.cam.x + (sx - W / 2) / s, y: this.cam.y + (sy - H / 2) / s };
  },
  worldToScreen(wx, wy) {
    const s = this.scale();
    return { x: (wx - this.cam.x) * s + W / 2, y: (wy - this.cam.y) * s + H / 2 };
  },

  /* ---------- 生命周期 ---------- */
  /* 装饰采样用固定种子：每台机器看到的是同一张地图，回归截图才有意义。 */
  ensure() {
    if (this.ready) return;
    const rnd = mulberry32(20261019);
    const nearBuilding = (x, y) =>
      Math.hypot(x - 470, y - 430) < 190 || Math.hypot(x - 500, y - 990) < 170 ||
      Math.hypot(x - WORLD_START.x, y - WORLD_START.y) < 110 || Math.hypot(x - 1032, y - 700) < 90;
    for (let i = 0; i < 46; i++) {
      const x = 110 + rnd() * (WORLD_MAP.w - 220);
      const y = 110 + rnd() * (WORLD_MAP.h - 220);
      if (nearBuilding(x, y)) continue;
      const land = this.inIslandBlobs(x, y, 0.96) && !this.inLagoon(x, y, 1);
      let kind;
      if (land) kind = rnd() < 0.34 ? 'palm' : rnd() < 0.55 ? 'grass' : rnd() < 0.55 ? 'rock' : 'shell';
      else kind = rnd() < 0.46 ? 'kelp' : rnd() < 0.7 ? 'coral' : 'rock';
      this.decor.push({
        x, y, kind,
        s: 0.7 + rnd() * 0.9,
        ph: rnd() * TAU,
        hue: rnd(),
      });
    }
    this.ready = true;
  },
  enter() {
    this.ensure();
    this.picking = false;
    this.player = { x: WORLD_START.x, y: WORLD_START.y, face: -Math.PI / 2, walk: 0, moving: false };
    this.cam = { x: WORLD_START.x, y: WORLD_START.y };
    this.tap = null; this.drag = null; this.near = null;
    this.keys.clear();
    this.ready = true;
    this.syncBar();
    this.setHint(this.hintFor());
  },
  /* 从抓水母/结算回来：保留玩家位置 */
  resume() {
    if (!this.ready) { this.enter(); return; }
    this.picking = false;
    this.tap = null; this.drag = null;
    this.keys.clear();
    this.cam = { x: this.player.x, y: this.player.y };
    this.syncBar();
    this.setHint(this.hintFor());
  },
  /* 涨潮结束：从水母田里被推回岸边 */
  leaveLagoon() {
    const p = this.player;
    const L = WORLD_LAGOON;
    let dx = p.x - L.x, dy = p.y - L.y;
    let d = Math.hypot(dx, dy);
    if (d < 1) { dx = WORLD_START.x - L.x; dy = WORLD_START.y - L.y; d = Math.hypot(dx, dy); }
    const k = 1.14;
    p.x = L.x + dx / d * L.rx * k;
    p.y = L.y + dy / d * L.ry * k;
    // 落点如果压到建筑/世界外，退回起点岸边
    if (!this.canStand(p.x, p.y)) { p.x = WORLD_START.x; p.y = WORLD_START.y; }
    this.cam = { x: p.x, y: p.y };
  },

  /* ---------- 顶栏 / 提示 ---------- */
  syncBar() {
    const w = SAVE.world || emptyWorldSave();
    if ($('worldJelly')) $('worldJelly').textContent = w.jelly;
    if ($('worldWallet')) $('worldWallet').textContent = SAVE.wallet;
    this.setHint(this.hintFor());
  },
  setHint(text) {
    if (text === this.hint) return;
    this.hint = text;
    if ($('worldHint')) $('worldHint').textContent = text;
  },
  hintFor() {
    if (game.state === 'jelly') return '';
    if (this.near) {
      if (this.near.id === 'jelly') return `${this.near.name} · 走进浅水（或按 E）开始抓水母`;
      return `${this.near.name} · 装修中 —— 先去水母田抓两网？`;
    }
    if (this.inLagoon(this.player.x, this.player.y, 1.35)) return '水母田 · 再往水里走一点就开始抓水母';
    return 'WASD / 拖动 走动 · 走进东边的浅水抓水母 · C 换人';
  },
  toast(text) {
    const el = $('worldToast');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { el.hidden = true; }, 2200);
  },

  /* ---------- 输入 ---------- */
  key(k, down) {
    const map = {
      arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right',
      arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
    };
    const n = map[String(k || '').toLowerCase()];
    if (!n) return;
    if (down) this.keys.add(n); else this.keys.delete(n);
  },
  clearKeys() { this.keys.clear(); this.drag = null; },
  dragStart(sx, sy) { this.drag = { sx, sy, dx: 0, dy: 0, moved: 0, active: false }; },
  dragMove(sx, sy) {
    const d = this.drag;
    if (!d) return;
    const dx = sx - d.sx, dy = sy - d.sy;
    const len = Math.hypot(dx, dy);
    d.moved = Math.max(d.moved, len);
    if (len > 16) { d.active = true; d.dx = dx / len; d.dy = dy / len; }
  },
  dragEnd() {
    const d = this.drag;
    this.drag = null;
    if (d && d.moved < 18) return { x: d.sx, y: d.sy };
    return null;
  },
  /* 屏幕点地：点到建筑就打个招呼，点到别处就走过去 */
  clickAt(sx, sy) {
    if (game.state !== 'world') return;
    const w = this.screenToWorld(sx, sy);
    for (const s of this.spots) {
      if (Math.hypot(w.x - s.x, w.y - s.y) < (s.id === 'jelly' ? 70 : 120)) {
        this.tap = null;
        this.talk(s);
        return;
      }
    }
    this.tap = { x: w.x, y: w.y, t: 0 };
    AudioSys.resume(); AudioSys.tone(520, 0.05, 'triangle', 0.08);
  },
  talk(s) {
    this.near = s;
    this.setHint(this.hintFor());
    if (s.id === 'jelly') { startJellyGame(); return; }
    this.toast(`${s.name} 还在装修中，先去水母田抓两网？`);
    AudioSys.resume(); AudioSys.tone(220, 0.1, 'triangle', 0.1);
  },
  interact() {
    if (game.state !== 'world' || this.picking) return null;
    const s = this.near;
    if (!s) return null;
    this.talk(s);
    return s;
  },
  nearestSpot() {
    let best = null, bd = Infinity;
    for (const s of this.spots) {
      const d = Math.hypot(this.player.x - s.doorX, this.player.y - s.doorY);
      if (d < s.r && d < bd) { bd = d; best = s; }
    }
    return best;
  },

  /* ---------- 每帧：移动 + 镜头 + 自动下水 ---------- */
  update(dt) {
    this.t += dt;
    const p = this.player;
    const swimming = game.state === 'jelly';
    // 换人面板开着的时候，人停在原地
    if (this.picking) { this.updateCam(dt); return; }
    if (swimming && JellyGame.zapT > 0) { p.moving = false; this.updateCam(dt); return; }
    let dx = 0, dy = 0;
    if (this.keys.has('left')) dx--;
    if (this.keys.has('right')) dx++;
    if (this.keys.has('up')) dy--;
    if (this.keys.has('down')) dy++;
    if (this.drag && this.drag.active) { dx += this.drag.dx; dy += this.drag.dy; }
    if (!swimming && this.tap) {
      const tx = this.tap.x - p.x, ty = this.tap.y - p.y;
      const d = Math.hypot(tx, ty);
      if (d < 12) this.tap = null;
      else { dx += tx / d; dy += ty / d; }
    }
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      const step = (swimming ? WORLD_TUNING.swimSpeed : WORLD_TUNING.walkSpeed) * dt;
      const nx = p.x + dx / len * step, ny = p.y + dy / len * step;
      if (swimming) {
        const c = this.clampToLagoon(nx, ny, 0.94);
        p.x = c.x; p.y = c.y;
        this.tap = null;
      } else {
        // 分轴滑动：贴着岸边/建筑走而不是卡死
        if (this.canStand(nx, p.y)) p.x = nx;
        if (this.canStand(p.x, ny)) p.y = ny;
        if (this.tap && Math.hypot(p.x - this.tap.x, p.y - this.tap.y) < 12) this.tap = null;
      }
      p.face = Math.atan2(dy, dx);
      p.moving = true;
      p.walk += dt * (swimming ? 4 : 8);
    } else {
      p.moving = false;
    }
    // 抓水母时无论如何都待在水母田里（重开一局、被推挤都不会游出去）
    if (swimming) {
      const c2 = this.clampToLagoon(p.x, p.y, 0.94);
      p.x = c2.x; p.y = c2.y;
    }
    this.updateCam(dt);
    if (game.state === 'world') {
      this.near = this.nearestSpot();
      this.setHint(this.hintFor());
      // 走进浅水 → 直接开抓
      if (this.inLagoon(p.x, p.y, 0.9)) {
        this.lastEntry = { x: p.x, y: p.y };
        startJellyGame();
      }
    }
  },
  updateCam(dt) {
    const p = this.player;
    const tx = p.x + Math.cos(p.face) * 24;
    const ty = p.y + Math.sin(p.face) * 24;
    const k = 1 - Math.exp(-dt * 6);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
    const s = this.scale();
    const vw = W / s, vh = H / s;
    this.cam.x = vw >= WORLD_MAP.w ? WORLD_MAP.w / 2 : clamp(this.cam.x, vw / 2, WORLD_MAP.w - vw / 2);
    this.cam.y = vh >= WORLD_MAP.h ? WORLD_MAP.h / 2 : clamp(this.cam.y, vh / 2, WORLD_MAP.h - vh / 2);
  },

  /* ---------- 渲染 ---------- */
  render() {
    this.ensure();
    const s = this.scale();
    const c = this.cam, t = this.t;
    cx.clearRect(0, 0, W, H);
    cx.save();
    cx.translate(W / 2, H / 2); cx.scale(s, s); cx.translate(-c.x, -c.y);
    this.drawSea(t);
    this.drawIsland(t);
    this.drawLagoon(t);
    this.drawTrails(t);
    this.drawSign(t);
    // 水里的水母画在玩家下面，玩家能挡住它们
    if (game.state !== 'world') JellyGame.drawUnder(t);
    // 深度排序：装饰、建筑、玩家按脚底 y 排
    const list = [];
    for (const d of this.decor) list.push({ y: d.y, d });
    for (const sp of this.spots) if (sp.id !== 'jelly') list.push({ y: sp.y, sp });
    list.push({ y: this.player.y, player: true });
    list.sort((a, b) => a.y - b.y);
    for (const it of list) {
      if (it.player) this.drawPlayer(t);
      else if (it.sp) this.drawBuilding(it.sp, t);
      else this.drawDecor(it.d, t);
    }
    if (game.state !== 'world') JellyGame.drawOver(t);
    // 走近时的地名浮标
    this.drawNearLabel(t);
    cx.restore();
    if (game.state !== 'world') JellyGame.drawScreen(t);
  },
  drawSea(t) {
    const s = this.scale(), vw = W / s, vh = H / s;
    const x = this.cam.x - vw / 2, y = this.cam.y - vh / 2;
    const g = cx.createLinearGradient(0, y, 0, y + vh);
    g.addColorStop(0, '#0b5578'); g.addColorStop(0.5, '#1188a2'); g.addColorStop(1, '#2bb7ad');
    cx.fillStyle = g; cx.fillRect(x - 4, y - 4, vw + 8, vh + 8);
    // 缓慢漂移的光斑
    cx.save();
    cx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const px = 160 + ((i * 293 + t * 11) % (WORLD_MAP.w - 260));
      const py = 120 + ((i * 197 + Math.sin(t * 0.2 + i) * 40 + 600) % (WORLD_MAP.h - 200));
      const r = 90 + (i % 3) * 40;
      const gg = cx.createRadialGradient(px, py, 0, px, py, r);
      gg.addColorStop(0, 'rgba(190,255,245,0.10)'); gg.addColorStop(1, 'rgba(190,255,245,0)');
      cx.fillStyle = gg;
      cx.beginPath(); cx.arc(px, py, r, 0, TAU); cx.fill();
    }
    cx.restore();
    // 水面细碎波纹
    cx.save();
    cx.strokeStyle = 'rgba(214,255,250,0.16)'; cx.lineWidth = 1.4;
    for (let i = 0; i < 26; i++) {
      const px = 90 + ((i * 211 + t * 6) % (WORLD_MAP.w - 180));
      const py = 80 + ((i * 149 + Math.sin(t * 0.6 + i) * 12 + 300) % (WORLD_MAP.h - 160));
      cx.beginPath(); cx.arc(px, py, 6 + (i % 4) * 3, 0.2, 2.4); cx.stroke();
    }
    cx.restore();
  },
  sandPath(k = 1) {
    const I = WORLD_ISLAND;
    cx.beginPath();
    for (const [dx, dy, sx, sy] of WORLD_SAND_BLOBS) {
      const ex = I.x + dx * I.rx, ey = I.y + dy * I.ry, rx = I.rx * sx * k, ry = I.ry * sy * k;
      // 每个椭圆前 moveTo：否则 ellipse() 会把上一个椭圆的终点连一根线过来，
      // 多条这样的连线会让 nonzero 填充在沙地上挖出三角形空洞
      cx.moveTo(ex + rx, ey);
      cx.ellipse(ex, ey, rx, ry, 0, 0, TAU);
    }
  },
  lagoonPath(k = 1) {
    const L = WORLD_LAGOON;
    cx.beginPath();
    for (const [dx, dy, sx, sy] of WORLD_LAGOON_BLOBS) {
      const ex = L.x + dx * L.rx, ey = L.y + dy * L.ry, rx = L.rx * sx * k, ry = L.ry * sy * k;
      cx.moveTo(ex + rx, ey);
      cx.ellipse(ex, ey, rx, ry, 0, 0, TAU);
    }
  },
  drawIsland(t) {
    const I = WORLD_ISLAND;
    cx.save();
    // 浅滩光晕：整块沙地放大一点点（fill 用的是并集，不会画出内部轮廓）
    this.sandPath(1.02);
    cx.fillStyle = 'rgba(160,244,238,0.28)';
    cx.fill();
    // 沙滩
    const g = cx.createRadialGradient(I.x - I.rx * 0.35, I.y - I.ry * 0.45, 60, I.x, I.y, I.rx * 1.1);
    g.addColorStop(0, '#f7e8bb'); g.addColorStop(0.62, '#ecd39a'); g.addColorStop(1, '#d9b878');
    cx.fillStyle = g;
    this.sandPath(); cx.fill();
    // 浪花：只沿着主椭圆描一圈虚线（描边不能走并集，否则内部小椭圆全露出来）
    cx.strokeStyle = 'rgba(255,255,255,0.5)'; cx.lineWidth = 3;
    cx.setLineDash([18, 16]); cx.lineDashOffset = -t * 10;
    cx.beginPath(); cx.ellipse(I.x, I.y, I.rx * 1.004, I.ry * 1.004, 0, 0, TAU); cx.stroke();
    cx.setLineDash([]);
    // 草地 / 湿沙色块（用少量椭圆压出层次）
    cx.globalAlpha = 0.5;
    cx.fillStyle = '#cbe08f';
    const patches = [[0.18, -0.34, 150, 66], [-0.35, -0.18, 120, 54], [0.36, 0.3, 100, 44], [-0.2, 0.42, 90, 40]];
    for (const [dx, dy, w, h] of patches) {
      cx.beginPath(); cx.ellipse(I.x + dx * I.rx, I.y + dy * I.ry, w, h, -0.2, 0, TAU); cx.fill();
    }
    cx.globalAlpha = 1;
    cx.restore();
  },
  drawLagoon(t) {
    const L = WORLD_LAGOON;
    cx.save();
    // 外圈浅水
    this.lagoonPath(1.045);
    cx.fillStyle = 'rgba(120,230,220,0.42)';
    cx.fill();
    // 水面
    const g = cx.createRadialGradient(L.x - 80, L.y - 90, 40, L.x, L.y, L.rx * 1.1);
    g.addColorStop(0, '#7fe9dd'); g.addColorStop(0.55, '#3fc8c9'); g.addColorStop(1, '#1a93ad');
    cx.fillStyle = g;
    this.lagoonPath(); cx.fill();
    // 波纹
    cx.strokeStyle = 'rgba(232,255,255,0.3)'; cx.lineWidth = 1.8;
    for (let i = 0; i < 4; i++) {
      const k = ((t * 0.12 + i / 4) % 1);
      cx.globalAlpha = (1 - k) * 0.3;
      cx.beginPath(); cx.ellipse(L.x, L.y, L.rx * (0.34 + k * 0.66), L.ry * (0.34 + k * 0.66), 0, 0, TAU); cx.stroke();
    }
    cx.globalAlpha = 1;
    // 白色浪花沿：同样只描主椭圆
    cx.strokeStyle = 'rgba(255,255,255,0.5)'; cx.lineWidth = 2.4;
    cx.setLineDash([14, 12]); cx.lineDashOffset = t * 8;
    cx.beginPath(); cx.ellipse(L.x, L.y, L.rx, L.ry, 0, 0, TAU); cx.stroke();
    cx.setLineDash([]);
    cx.restore();
  },
  drawTrails() {
    cx.save();
    cx.strokeStyle = 'rgba(255,246,212,0.42)'; cx.lineWidth = 13; cx.lineCap = 'round';
    const path = (x1, y1, x2, y2, cx1, cy1) => {
      cx.beginPath(); cx.moveTo(x1, y1); cx.quadraticCurveTo(cx1, cy1, x2, y2); cx.stroke();
    };
    path(860, 660, 470, 520, 700, 540);
    path(860, 660, 500, 1042, 720, 980);
    path(860, 660, 1006, 700, 950, 660);
    cx.restore();
  },
  drawDecor(d, t) {
    const x = d.x, y = d.y, s = d.s * 22;
    cx.save();
    if (d.kind === 'kelp') {
      cx.strokeStyle = 'rgba(56,150,110,0.72)'; cx.lineWidth = Math.max(2, s * 0.16); cx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        cx.beginPath();
        cx.moveTo(x + i * s * 0.5, y + s * 0.5);
        cx.quadraticCurveTo(x + i * s * 0.5 + Math.sin(t * 1.3 + d.ph + i) * s * 0.5, y - s * 0.9,
          x + i * s * 0.5 + Math.sin(t * 1.1 + d.ph + i * 2) * s * 0.7, y - s * 1.7);
        cx.stroke();
      }
    } else if (d.kind === 'coral') {
      cx.strokeStyle = `rgba(${190 + (d.hue * 60) | 0},${118 + (d.hue * 90) | 0},${168 + (d.hue * 60) | 0},0.92)`;
      cx.lineWidth = Math.max(2, s * 0.16);
      for (let i = 0; i < 3; i++) {
        cx.beginPath();
        cx.moveTo(x, y + s * 0.3);
        cx.quadraticCurveTo(x + Math.sin(t + i * 2 + d.ph) * s * 0.4, y - s * 0.5,
          x + Math.sin(t * 0.8 + i) * s * 0.7, y - s * 1.1);
        cx.stroke();
      }
    } else if (d.kind === 'rock') {
      cx.fillStyle = 'rgba(122,126,142,0.85)';
      cx.beginPath(); cx.ellipse(x, y, s * 0.7, s * 0.5, d.ph, 0, TAU); cx.fill();
      cx.fillStyle = 'rgba(255,255,255,0.2)';
      cx.beginPath(); cx.ellipse(x - s * 0.18, y - s * 0.18, s * 0.24, s * 0.14, d.ph, 0, TAU); cx.fill();
    } else if (d.kind === 'shell') {
      cx.fillStyle = 'rgba(255,183,206,0.95)';
      cx.beginPath(); cx.arc(x, y, s * 0.34, Math.PI, TAU); cx.closePath(); cx.fill();
      cx.strokeStyle = 'rgba(198,108,148,0.7)'; cx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) {
        cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x + i * s * 0.12, y - s * 0.3); cx.stroke();
      }
    } else if (d.kind === 'grass') {
      cx.strokeStyle = 'rgba(96,156,84,0.75)'; cx.lineWidth = Math.max(1.6, s * 0.1); cx.lineCap = 'round';
      for (let i = -2; i <= 2; i++) {
        cx.beginPath();
        cx.moveTo(x + i * s * 0.16, y + s * 0.2);
        cx.quadraticCurveTo(x + i * s * 0.2 + Math.sin(t * 1.6 + d.ph + i) * s * 0.16, y - s * 0.2,
          x + i * s * 0.26, y - s * 0.42);
        cx.stroke();
      }
    } else if (d.kind === 'palm') {
      // 棕榈：树干 + 五片叶
      cx.strokeStyle = '#9a6b3f'; cx.lineWidth = Math.max(3, s * 0.2); cx.lineCap = 'round';
      cx.beginPath(); cx.moveTo(x, y + s * 0.4); cx.quadraticCurveTo(x + s * 0.18, y - s * 0.5, x + s * 0.05, y - s * 1.1); cx.stroke();
      const sway = Math.sin(t * 1.1 + d.ph) * 0.08;
      cx.strokeStyle = 'rgba(52,138,86,0.9)'; cx.lineWidth = Math.max(2.4, s * 0.15);
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.6 + sway;
        cx.beginPath();
        cx.moveTo(x + s * 0.05, y - s * 1.05);
        cx.quadraticCurveTo(x + Math.cos(a) * s * 0.8, y - s * 1.35 + Math.sin(a) * s * 0.4,
          x + Math.cos(a) * s * 1.35, y - s * 1.0 + Math.sin(a) * s * 0.75);
        cx.stroke();
      }
    }
    cx.restore();
  },
  drawBuilding(sp, t) {
    if (sp.id === 'krusty') this.drawKrusty(sp, t);
    else if (sp.id === 'karate') this.drawKarate(sp, t);
  },
  drawKrusty(sp, t) {
    const x = sp.x, y = sp.y;
    cx.save();
    // 影子
    cx.globalAlpha = 0.2; cx.fillStyle = '#123';
    cx.beginPath(); cx.ellipse(x, y + 14, 132, 40, 0, 0, TAU); cx.fill();
    cx.globalAlpha = 1;
    // 木船屋主体
    const bw = 212, bh = 120;
    const g = cx.createLinearGradient(0, y - bh, 0, y);
    g.addColorStop(0, '#c07a45'); g.addColorStop(1, '#8f5129');
    cx.fillStyle = g; worldRoundRect(x - bw / 2, y - bh, bw, bh, 20); cx.fill();
    cx.strokeStyle = '#6b3a1e'; cx.lineWidth = 4; cx.stroke();
    // 木纹
    cx.strokeStyle = 'rgba(88,48,22,0.5)'; cx.lineWidth = 2;
    for (let i = 1; i < 5; i++) {
      cx.beginPath(); cx.moveTo(x - bw / 2 + 10, y - bh + i * 22); cx.lineTo(x + bw / 2 - 10, y - bh + i * 22); cx.stroke();
    }
    // 红屋顶
    cx.fillStyle = '#d94f3d';
    cx.beginPath(); cx.ellipse(x, y - bh + 4, bw * 0.58, 44, 0, Math.PI, TAU); cx.fill();
    cx.strokeStyle = '#a53428'; cx.lineWidth = 4; cx.stroke();
    cx.fillStyle = 'rgba(255,255,255,0.28)';
    cx.beginPath(); cx.ellipse(x - 34, y - bh - 10, 44, 12, -0.2, 0, TAU); cx.fill();
    // 窗
    cx.fillStyle = '#bfeaff'; cx.strokeStyle = '#5b3520'; cx.lineWidth = 3;
    for (const dx of [-62, 62]) {
      worldRoundRect(x + dx - 24, y - bh + 44, 48, 38, 6); cx.fill(); cx.stroke();
      cx.beginPath(); cx.moveTo(x + dx, y - bh + 44); cx.lineTo(x + dx, y - bh + 82); cx.stroke();
    }
    // 门
    cx.fillStyle = '#5f3a20';
    worldRoundRect(x - 24, y - 58, 48, 58, 8); cx.fill();
    cx.fillStyle = '#ffd23e'; cx.beginPath(); cx.arc(x + 14, y - 28, 3.5, 0, TAU); cx.fill();
    // 招牌：木牌 + 蟹黄包
    cx.fillStyle = '#f5e2b8'; worldRoundRect(x - 76, y - bh - 58, 152, 38, 10); cx.fill();
    cx.strokeStyle = '#6b3a1e'; cx.lineWidth = 3; cx.stroke();
    cx.fillStyle = '#243b5e'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.font = '900 22px system-ui, "Microsoft YaHei", sans-serif';
    cx.fillText('蟹堡王', x - 12, y - bh - 38);
    // 汉堡小图标
    cx.fillStyle = '#f0b45f'; cx.beginPath(); cx.ellipse(x + 50, y - bh - 40, 13, 6, 0, Math.PI, TAU); cx.fill();
    cx.fillStyle = '#8a5a2b'; cx.fillRect(x + 38, y - bh - 39, 24, 4);
    cx.fillStyle = '#7ec850'; cx.fillRect(x + 37, y - bh - 35, 26, 3);
    if (!sp.open) this.drawSoon(x, y - 20, t);
    cx.restore();
  },
  drawKarate(sp, t) {
    const x = sp.x, y = sp.y;
    cx.save();
    cx.globalAlpha = 0.2; cx.fillStyle = '#123';
    cx.beginPath(); cx.ellipse(x, y + 14, 112, 34, 0, 0, TAU); cx.fill();
    cx.globalAlpha = 1;
    // 木屋
    const bw = 176, bh = 108;
    cx.fillStyle = '#a9743f'; worldRoundRect(x - bw / 2, y - bh, bw, bh, 12); cx.fill();
    cx.strokeStyle = '#6b4423'; cx.lineWidth = 4; cx.stroke();
    // 屋顶（双坡）
    cx.fillStyle = '#7c3f2c';
    cx.beginPath();
    cx.moveTo(x - bw / 2 - 18, y - bh + 8);
    cx.lineTo(x, y - bh - 62);
    cx.lineTo(x + bw / 2 + 18, y - bh + 8);
    cx.closePath(); cx.fill(); cx.stroke();
    // 屋脊
    cx.strokeStyle = '#5a2a1d'; cx.lineWidth = 6;
    cx.beginPath(); cx.moveTo(x, y - bh - 62); cx.lineTo(x, y - bh + 8); cx.stroke();
    // 窗
    cx.fillStyle = '#f6f0d8'; cx.strokeStyle = '#5b3520'; cx.lineWidth = 3;
    worldRoundRect(x - 58, y - bh + 34, 46, 34, 4); cx.fill(); cx.stroke();
    worldRoundRect(x + 14, y - bh + 34, 46, 34, 4); cx.fill(); cx.stroke();
    cx.strokeStyle = 'rgba(91,53,32,0.5)'; cx.lineWidth = 1.6;
    for (const dx of [-58, 14]) {
      for (let i = 1; i < 3; i++) { cx.beginPath(); cx.moveTo(x + dx + i * 15, y - bh + 34); cx.lineTo(x + dx + i * 15, y - bh + 68); cx.stroke(); }
    }
    // 门
    cx.fillStyle = '#5f3a20'; worldRoundRect(x - 20, y - 54, 40, 54, 6); cx.fill();
    // 腰带招牌
    const sway = Math.sin(t * 1.6) * 0.04;
    cx.save(); cx.translate(x, y - bh - 46); cx.rotate(sway);
    cx.fillStyle = '#f4f8f6'; cx.strokeStyle = '#243b5e'; cx.lineWidth = 3;
    worldRoundRect(-42, -12, 84, 24, 4); cx.fill(); cx.stroke();
    cx.fillStyle = '#e35d4a'; cx.fillRect(-36, -7, 72, 5);
    cx.fillStyle = '#243b5e'; cx.font = '900 15px system-ui, "Microsoft YaHei", sans-serif';
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText('空手道', 0, 4);
    cx.restore();
    if (!sp.open) this.drawSoon(x, y - 18, t);
    cx.restore();
  },
  drawSoon(x, y, t) {
    cx.save();
    cx.translate(x, y);
    const tw = 120, th = 22;
    cx.rotate(-0.05);
    cx.fillStyle = '#ffe059'; cx.fillRect(-tw / 2, -th / 2, tw, th);
    cx.strokeStyle = '#243b5e'; cx.lineWidth = 2; cx.strokeRect(-tw / 2, -th / 2, tw, th);
    cx.fillStyle = '#243b5e';
    cx.font = '900 13px system-ui, "Microsoft YaHei", sans-serif';
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText('装修中 · 敬请期待', 0, 1);
    cx.restore();
  },
  drawSign(t) {
    // 水母田木牌（站在岸边）
    const x = 1032, y = 700;
    cx.save();
    cx.strokeStyle = '#7a5230'; cx.lineWidth = 7; cx.lineCap = 'round';
    cx.beginPath(); cx.moveTo(x, y + 18); cx.lineTo(x, y - 52); cx.stroke();
    cx.fillStyle = '#f2dfb0'; cx.strokeStyle = '#6b3a1e'; cx.lineWidth = 3;
    worldRoundRect(x - 62, y - 84, 124, 40, 8); cx.fill(); cx.stroke();
    cx.fillStyle = '#243b5e'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.font = '900 17px system-ui, "Microsoft YaHei", sans-serif';
    cx.fillText('水母田 ▸', x, y - 63);
    // 小水母图标
    const bob = Math.sin(t * 2.4) * 2;
    cx.fillStyle = '#b76ee0';
    cx.beginPath(); cx.moveTo(x - 44, y - 70 + bob);
    cx.quadraticCurveTo(x - 38, y - 82 + bob, x - 32, y - 70 + bob);
    cx.closePath(); cx.fill();
    cx.restore();
    // 起点路牌
    cx.save();
    const sx = 920, sy = 736;
    cx.strokeStyle = '#7a5230'; cx.lineWidth = 6; cx.lineCap = 'round';
    cx.beginPath(); cx.moveTo(sx, sy + 26); cx.lineTo(sx, sy - 34); cx.stroke();
    cx.fillStyle = '#f2dfb0'; cx.strokeStyle = '#6b3a1e'; cx.lineWidth = 3;
    worldRoundRect(sx - 92, sy - 50, 184, 30, 6); cx.fill(); cx.stroke();
    cx.fillStyle = '#243b5e'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.font = '900 13px system-ui, "Microsoft YaHei", sans-serif';
    cx.fillText('← 蟹堡王   ·   空手道 ↓', sx, sy - 35);
    cx.restore();
  },
  drawNearLabel(t) {
    if (!this.near || game.state !== 'world') return;
    const s = this.near;
    const y = s.id === 'krusty' ? s.y - 200 : s.id === 'karate' ? s.y - 190 : s.y - 118;
    const bob = Math.sin(t * 3) * 3;
    const label = s.id === 'jelly' ? '水母田 · 下水' : `${s.name} · 装修中`;
    cx.save();
    cx.font = '900 16px system-ui, "Microsoft YaHei", sans-serif';
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    const w = cx.measureText(label).width + 26;
    cx.fillStyle = s.open ? 'rgba(139,92,246,0.92)' : 'rgba(36,59,94,0.88)';
    worldRoundRect(s.x - w / 2, y - 15 + bob, w, 30, 15); cx.fill();
    cx.fillStyle = '#fff';
    cx.fillText(label, s.x, y + 1 + bob);
    cx.restore();
  },
  drawPlayer(t) {
    const p = this.player, c = CHARS[game.charIdx];
    if (!c) return;
    const inWater = game.state === 'jelly' || this.inLagoon(p.x, p.y, 0.98);
    const bob = p.moving ? Math.sin(p.walk) * 2 : Math.sin(t * 1.8) * 1.2;
    const r = WORLD_TUNING.playerR;
    cx.save();
    if (inWater) {
      // 游泳：涟漪 + 拖尾
      for (let i = 0; i < 3; i++) {
        const k = ((t * 0.55 + i / 3) % 1);
        cx.globalAlpha = (1 - k) * 0.5;
        cx.strokeStyle = '#eaffff'; cx.lineWidth = 2;
        cx.beginPath(); cx.ellipse(p.x, p.y + 8, r * (0.9 + k * 1.3), r * (0.42 + k * 0.6), 0, 0, TAU); cx.stroke();
      }
      cx.globalAlpha = 0.5;
      cx.strokeStyle = '#d8ffff'; cx.lineWidth = 3; cx.lineCap = 'round';
      const fx = p.x - Math.cos(p.face) * r * 1.15, fy = p.y - Math.sin(p.face) * r * 1.15;
      cx.beginPath(); cx.moveTo(fx - Math.sin(p.face) * 9, fy + Math.cos(p.face) * 9);
      cx.lineTo(fx, fy);
      cx.lineTo(fx + Math.sin(p.face) * 9, fy - Math.cos(p.face) * 9); cx.stroke();
      cx.globalAlpha = 1;
    } else {
      cx.fillStyle = 'rgba(16,60,66,0.22)';
      cx.beginPath(); cx.ellipse(p.x, p.y + r * 0.7, r * 1.02, r * 0.42, 0, 0, TAU); cx.fill();
      if (p.moving) {
        const s1 = Math.sin(p.walk), s2 = Math.sin(p.walk + Math.PI);
        cx.fillStyle = '#f8f4e6';
        for (const [sx, sg] of [[-1, s1], [1, s2]]) {
          cx.beginPath(); cx.ellipse(p.x + sx * r * 0.35, p.y + r * 0.62 + sg * 4, r * 0.26, r * 0.17, 0, 0, TAU); cx.fill();
        }
      }
    }
    // 身体
    cx.fillStyle = c.accent;
    cx.beginPath(); cx.ellipse(p.x, p.y + 3 + bob, r * 0.86, r * 0.98, 0, 0, TAU); cx.fill();
    cx.strokeStyle = '#ffffff'; cx.lineWidth = 2.6; cx.stroke();
    // 小手
    cx.fillStyle = c.accent;
    for (const sx of [-1, 1]) {
      cx.beginPath(); cx.arc(p.x + sx * r * 0.86, p.y + 4 + bob + Math.sin(p.walk + (sx > 0 ? 0 : Math.PI)) * 3, r * 0.2, 0, TAU); cx.fill();
      cx.strokeStyle = 'rgba(255,255,255,0.85)'; cx.lineWidth = 1.6; cx.stroke();
    }
    // 头（立绘裁圆）
    const hx = p.x, hy = p.y - r * 0.62 + bob;
    const hr = r * 0.98;
    cx.save();
    cx.beginPath(); cx.arc(hx, hy, hr, 0, TAU); cx.clip();
    cx.fillStyle = '#0d3448'; cx.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
    if (c.ok && c.img) {
      const iw = c.img.naturalWidth || 1, ih = c.img.naturalHeight || 1;
      const sc = (hr * 2.1) / Math.min(iw, ih);
      cx.drawImage(c.img, hx - iw * sc / 2, hy + hr - ih * sc, iw * sc, ih * sc);
    }
    cx.restore();
    cx.strokeStyle = '#ffffff'; cx.lineWidth = 2.6;
    cx.beginPath(); cx.arc(hx, hy, hr, 0, TAU); cx.stroke();
    cx.restore();
  },
};

/* ================= 抓水母（撒网 + 诱饵） ================= */
const JellyGame = {
  active: false,
  time: 0,
  elapsed: 0,
  jelly: 0, caught: 0, chain: 0, maxChain: 0, gold: 0, zapped: 0,
  jellies: [], fx: [], baits: [], splashes: [],
  baitsLeft: 0, baitCd: 0, baitHintT: 0,
  net: null, castCd: 0, aim: { x: 0, y: 0 }, aimT: 9, pointerAim: false,
  zapT: 0, flashT: 0, spawnT: 0, warnT: 0,
  _popT: null,

  /* 角色差异：碧莲撒得快、派宝宝网更大、王哥让水母变慢、珊迪看得见价签。 */
  tune() {
    const id = CHARS[game.charIdx] ? CHARS[game.charIdx].id : '';
    return {
      netCd: id === 'spongebob' ? 0.44 : WORLD_TUNING.netCd,
      netR: id === 'patrick' ? WORLD_TUNING.netR * 1.25 : WORLD_TUNING.netR,
      speedMul: id === 'squidward' ? 0.8 : 1,
      badges: id === 'sandy',
    };
  },
  rollKind() {
    let total = 0;
    for (const k of JELLY_KIND_ORDER) total += JELLY_KINDS[k].weight;
    let roll = R() * total;
    for (const k of JELLY_KIND_ORDER) { roll -= JELLY_KINDS[k].weight; if (roll <= 0) return k; }
    return 'pink';
  },
  spawnAt(kind, x, y, opts) {
    const k = JELLY_KINDS[kind] || JELLY_KINDS.pink;
    const j = {
      kind: JELLY_KINDS[kind] ? kind : 'pink',
      x, y,
      angle: R() * TAU,
      speed: opts && typeof opts.speed === 'number' ? opts.speed : rr(k.speed[0], k.speed[1]),
      phase: R() * TAU,
      r: k.r,
      dead: false,
    };
    this.jellies.push(j);
    return j;
  },
  /* 在玩家周围的水母田里挑一个出生点 */
  spawnRandom() {
    const L = WORLD_LAGOON, p = WorldHub.player;
    for (let i = 0; i < 14; i++) {
      const a = R() * TAU;
      const rad = 0.3 + Math.sqrt(R()) * 0.62;
      const x = L.x + Math.cos(a) * L.rx * rad;
      const y = L.y + Math.sin(a) * L.ry * rad;
      if (Math.hypot(x - p.x, y - p.y) < 130) continue;
      return this.spawnAt(this.rollKind(), x, y);
    }
    return null;
  },

  start() {
    const T = WORLD_TUNING;
    WorldHub.ensure();
    // 从岸边下水时站在水里一点点；重来一局时回到上次入水点
    const p = WorldHub.player;
    if (!WorldHub.inLagoon(p.x, p.y, 0.92)) {
      const e = WorldHub.lastEntry && WorldHub.inLagoon(WorldHub.lastEntry.x, WorldHub.lastEntry.y, 0.92)
        ? WorldHub.lastEntry
        : { x: WORLD_LAGOON.x - WORLD_LAGOON.rx * 0.55, y: WORLD_LAGOON.y };
      p.x = e.x; p.y = e.y;
    }
    WorldHub.cam = { x: p.x, y: p.y };
    game.state = 'jelly';
    Object.assign(this, {
      active: true, time: T.duration, elapsed: 0,
      jelly: 0, caught: 0, chain: 0, maxChain: 0, gold: 0, zapped: 0,
      jellies: [], fx: [], baits: [], splashes: [],
      baitsLeft: T.baitCount, baitCd: 0, baitHintT: 0,
      net: null, castCd: 0, aim: { x: p.x, y: p.y - 120 }, aimT: 9, pointerAim: false,
      zapT: 0, flashT: 0, spawnT: 1.4, warnT: T.tideWarn,
    });
    for (let i = 0; i < 7; i++) this.spawnRandom();
    this.syncHud();
  },
  chainMul() {
    if (this.chain >= 15) return 3;
    if (this.chain >= 10) return 2;
    if (this.chain >= 5) return 1.5;
    return 1;
  },

  /* ---------- 瞄准 / 撒网 / 诱饵 ---------- */
  aimScreen(sx, sy) {
    const w = WorldHub.screenToWorld(sx, sy);
    this.aim = { x: w.x, y: w.y };
    this.aimT = 0;
    this.pointerAim = true;
  },
  /* 屏幕点按：直接撒向点到的位置 */
  castScreen(sx, sy) {
    const w = WorldHub.screenToWorld(sx, sy);
    this.aimScreen(sx, sy);
    return this.castAt(w.x, w.y);
  },
  /* 按钮 / 空格：撒向准星 */
  swing() {
    return this.castAt(this.aim.x, this.aim.y);
  },
  castAt(x, y) {
    const T = WORLD_TUNING;
    const empty = { ok: false, x, y, hits: 0, catches: 0, jelly: 0, zapped: 0, missed: false, chain: this.chain };
    if (!this.active || game.state !== 'jelly' || this.zapT > 0) return empty;
    if (this.castCd > 0 || (this.net && !this.net.resolved)) return empty;
    const p = WorldHub.player;
    const dx = x - p.x, dy = y - p.y;
    const d = Math.hypot(dx, dy);
    let tx = x, ty = y;
    if (d > T.netRange) { tx = p.x + dx / d * T.netRange; ty = p.y + dy / d * T.netRange; }
    const tune = this.tune();
    this.castCd = tune.netCd;
    this.net = { x: tx, y: ty, r: tune.netR, t: T.netFlight, landT: 0, resolved: false, from: { x: p.x, y: p.y } };
    this.splashes.push({ x: tx, y: ty, r: tune.netR, t: 0, life: T.netOpen, color: 'rgba(220,255,255,0.75)' });
    AudioSys.resume();
    AudioSys.noise(0.07, 0.06, 400, 1400);
    return { ok: true, x: tx, y: ty, hits: 0, catches: 0, jelly: 0, zapped: 0, missed: false, chain: this.chain };
  },
  resolveNet() {
    const T = WORLD_TUNING;
    const out = { hits: 0, catches: 0, jelly: 0, zapped: 0, missed: false, chain: this.chain };
    const n = this.net;
    if (!n || n.resolved) return out;
    n.resolved = true;
    n.landT = T.netOpen;
    const zapHit = [];
    for (const j of this.jellies) {
      if (j.dead) continue;
      if (Math.hypot(j.x - n.x, j.y - n.y) > n.r + j.r * 0.35) continue;
      out.hits++;
      if (j.kind === 'zap') { zapHit.push(j); continue; }
      const k = JELLY_KINDS[j.kind];
      j.dead = true;
      this.chain += 1;
      this.maxChain = Math.max(this.maxChain, this.chain);
      const mul = this.chainMul();
      const gain = Math.round(k.jelly * mul);
      this.jelly += gain;
      this.caught += 1;
      if (k.gold) this.gold += 1;
      out.catches++; out.jelly += gain;
      this.fx.push({ x: j.x, y: j.y - 10, text: `+${gain}${mul > 1 ? ` ×${mul}` : ''}`, color: k.color, t: 0, life: 0.95, size: mul > 1 ? 24 : 19 });
      this.splashes.push({ x: j.x, y: j.y, r: j.r * 1.5, t: 0, life: 0.5, color: k.color });
      AudioSys.coin();
    }
    if (out.catches >= 3) this.domPop(`一网 ${out.catches} 只 · 漂亮！`, '#ffe059');
    if (zapHit.length) { this.zap(zapHit[0]); out.zapped = zapHit.length; }
    if (!out.catches) {
      out.missed = true;
      if (this.chain > 0) this.domPop('撒空了 · 连抓清零', '#ffb0a0');
      this.chain = 0;
      AudioSys.noise(0.09, 0.08, 240, 700);
    }
    this.jellies = this.jellies.filter(j => !j.dead);
    out.chain = this.chain;
    this.syncHud();
    return out;
  },
  dropBait() {
    const T = WORLD_TUNING;
    if (!this.active || game.state !== 'jelly' || this.zapT > 0) return false;
    if (this.baitsLeft <= 0) {
      if (this.baitHintT <= 0) { this.baitHintT = 1.8; this.domPop('本局诱饵用完了', '#ffd9e6'); }
      return false;
    }
    if (this.baitCd > 0) return false;
    const p = WorldHub.player;
    const x = p.x + Math.cos(p.face) * 70;
    const y = p.y + Math.sin(p.face) * 70;
    const c = WorldHub.clampToLagoon(x, y, 0.9);
    this.baitsLeft -= 1;
    this.baitCd = 0.5;
    this.baits.push({ x: c.x, y: c.y, t: T.baitLife, ph: R() * TAU });
    this.splashes.push({ x: c.x, y: c.y, r: 18, t: 0, life: 0.6, color: 'rgba(255,190,210,0.8)' });
    AudioSys.resume(); AudioSys.tone(300, 0.08, 'sine', 0.12);
    this.syncHud();
    return true;
  },
  zap(j) {
    if (j) j.dead = true;
    this.zapT = WORLD_TUNING.zapStun;
    this.chain = 0;
    this.zapped += 1;
    this.flashT = 0.38;
    this.domPop('⚡ 网兜短路！站住 2 秒', '#eaff6b');
    AudioSys.zap();
    if (navigator.vibrate && SETTINGS.vibrate) navigator.vibrate(60);
    this.syncHud();
  },

  /* 结算快照：perfect = 没被电到，且抓到至少 6 只 */
  stats() {
    return {
      jelly: this.jelly, caught: this.caught, maxChain: this.maxChain,
      gold: this.gold, zapped: this.zapped,
      perfect: this.zapped === 0 && this.caught >= WORLD_TUNING.perfectMin,
    };
  },

  update(dt) {
    if (!this.active) return;
    const T = WORLD_TUNING;
    const p = WorldHub.player;
    const tune = this.tune();
    this.elapsed += dt;
    this.time -= dt;
    this.castCd = Math.max(0, this.castCd - dt);
    this.baitCd = Math.max(0, this.baitCd - dt);
    this.baitHintT = Math.max(0, this.baitHintT - dt);
    this.aimT += dt;
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.zapT > 0) this.zapT = Math.max(0, this.zapT - dt);
    // 准星：鼠标/手指最近用过就跟着走，否则落在面朝方向
    if (!this.pointerAim || this.aimT > 4) {
      this.aim = { x: p.x + Math.cos(p.face) * 160, y: p.y + Math.sin(p.face) * 160 };
    }
    // 潮水提示
    if (this.time <= T.tideWarn && this.warnT > T.tideWarn) {
      this.warnT = this.time;
      this.domPop('涨潮了！水母田要关门啦', '#ffe059');
    }
    // 水母生成
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.jellies.length < T.jellyCap) {
      this.spawnRandom();
      this.spawnT = rr(T.spawnGapMin, T.spawnGapMax);
    }
    this.updateJellies(dt, tune);
    // 诱饵
    for (const b of this.baits) b.t -= dt;
    this.baits = this.baits.filter(b => b.t > 0);
    // 网
    if (this.net) {
      const n = this.net;
      if (!n.resolved) {
        n.t -= dt;
        if (n.t <= 0) this.resolveNet();
      } else {
        n.landT -= dt;
        if (n.landT <= 0) this.net = null;
      }
    }
    // 飘字/水花
    for (const f of this.fx) { f.t += dt; f.y -= 34 * dt; }
    this.fx = this.fx.filter(f => f.t < f.life);
    for (const s of this.splashes) s.t += dt;
    this.splashes = this.splashes.filter(s => s.t < s.life);
    this.syncHud();
    if (this.time <= 0) { this.time = 0; this.syncHud(); endJellyGame(); }
  },
  updateJellies(dt, tune) {
    const p = WorldHub.player;
    const bait = this.baits.length ? this.baits[0] : null;
    for (const j of this.jellies) {
      if (j.dead) continue;
      const k = JELLY_KINDS[j.kind];
      let ang = j.angle;
      let target = null;
      const db = bait ? Math.hypot(j.x - bait.x, j.y - bait.y) : Infinity;
      const dp = Math.hypot(j.x - p.x, j.y - p.y);
      if (j.kind === 'zap') {
        if (db < WORLD_TUNING.baitRadius * 1.15) target = bait;
        else if (dp < 300) target = p;
      } else if (j.kind === 'gold') {
        if (dp < 150) target = { x: p.x, y: p.y, flee: true };
        else if (db < WORLD_TUNING.baitRadius * 1.3) target = bait;
      } else if (bait && db < WORLD_TUNING.baitRadius) {
        target = bait;
      }
      if (target) {
        let want = Math.atan2(target.y - j.y, target.x - j.x);
        if (target.flee) want += Math.PI;
        ang = worldTurnToward(ang, want, (k.turn + 2.4) * dt * 1.5);
      } else {
        ang += Math.sin(this.elapsed * 1.5 + j.phase) * k.turn * dt;
      }
      const speed = j.speed * tune.speedMul * (target && !target.flee ? 1.2 : 1);
      j.x += Math.cos(ang) * speed * dt;
      j.y += Math.sin(ang) * speed * dt;
      j.angle = ang;
      // 撞到水母田边界就折返
      if (!WorldHub.inLagoon(j.x, j.y, 0.94)) {
        const L = WORLD_LAGOON;
        const a = Math.atan2(j.y - L.y, j.x - L.x);
        j.x = L.x + Math.cos(a) * L.rx * 0.92;
        j.y = L.y + Math.sin(a) * L.ry * 0.92;
        j.angle = a + Math.PI + rr(-0.5, 0.5);
      }
      // 电水母贴身：碰到就跑者
      if (k.zap && dp < j.r + WORLD_TUNING.playerR + 6) this.zap(j);
    }
    this.jellies = this.jellies.filter(j => !j.dead);
  },

  /* ---------- HUD ---------- */
  syncHud(tune) {
    tune = tune || this.tune();
    const hud = $('jellyHud');
    if (!hud) return;
    $('jellyTime').textContent = this.time.toFixed(1);
    $('jellyScore').textContent = this.jelly;
    const mul = this.chainMul();
    const text = this.chain + (mul > 1 ? ` ×${mul}` : '');
    const chainEl = $('jellyChain');
    if (chainEl.textContent !== text) chainEl.textContent = text;
    $('jellyChainBar').style.width = Math.min(100, this.chain / 15 * 100) + '%';
    if ($('jellyBait')) $('jellyBait').textContent = this.baitsLeft;
    hud.classList.toggle('zapped', this.zapT > 0);
    hud.classList.toggle('low', this.time <= WORLD_TUNING.tideWarn);
  },
  domPop(text, color) {
    const el = $('jellyPop');
    if (!el) return;
    el.textContent = text;
    el.style.color = color || '#d8ffff';
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    clearTimeout(this._popT);
    this._popT = setTimeout(() => { el.textContent = ''; }, 1300);
  },

  /* ---------- 渲染 ---------- */
  drawUnder(t) {
    // 诱饵圈
    for (const b of this.baits) {
      const k = 1 - b.t / WORLD_TUNING.baitLife;
      cx.save();
      cx.strokeStyle = 'rgba(255,170,200,0.55)'; cx.lineWidth = 2.5;
      cx.setLineDash([9, 9]); cx.lineDashOffset = -t * 18;
      cx.beginPath(); cx.arc(b.x, b.y, WORLD_TUNING.baitRadius * 0.45, 0, TAU); cx.stroke();
      cx.setLineDash([]);
      cx.globalAlpha = 0.9 - k * 0.4;
      cx.fillStyle = '#ff7fae';
      const wob = 1 + Math.sin(t * 5 + b.ph) * 0.08;
      cx.beginPath(); cx.ellipse(b.x, b.y, 15 * wob, 12 * wob, 0, 0, TAU); cx.fill();
      cx.fillStyle = 'rgba(255,255,255,0.65)';
      cx.beginPath(); cx.ellipse(b.x - 4, b.y - 4, 5, 3.5, -0.5, 0, TAU); cx.fill();
      cx.restore();
    }
    for (const j of this.jellies) this.drawJelly(j, t);
  },
  drawJelly(j, t) {
    const k = JELLY_KINDS[j.kind];
    const bob = 1 + Math.sin(t * k.bob + j.phase) * 0.06;
    const r = j.r * bob;
    cx.save();
    // 影子
    cx.fillStyle = 'rgba(8,60,72,0.16)';
    cx.beginPath(); cx.ellipse(j.x, j.y + r * 0.6, r * 1.05, r * 0.45, 0, 0, TAU); cx.fill();
    // 光晕
    if (k.gold || k.zap) {
      const g = cx.createRadialGradient(j.x, j.y, r * 0.2, j.x, j.y, r * 2.3);
      g.addColorStop(0, k.zap ? 'rgba(190,255,120,0.35)' : 'rgba(255,216,90,0.4)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = g; cx.beginPath(); cx.arc(j.x, j.y, r * 2.3, 0, TAU); cx.fill();
    }
    // 触手：朝游动反方向拖
    const back = j.angle + Math.PI;
    cx.strokeStyle = k.tentacle; cx.lineWidth = Math.max(1.6, r * 0.09); cx.lineCap = 'round';
    for (let i = -2; i <= 2; i++) {
      const off = i * r * 0.32;
      const px = j.x + Math.cos(j.angle + Math.PI / 2) * off;
      const py = j.y + Math.sin(j.angle + Math.PI / 2) * off;
      cx.beginPath(); cx.moveTo(px, py);
      for (let n = 1; n <= 3; n++) {
        const dist = n * r * 0.42;
        const sway = Math.sin(t * 2.8 + n * 0.9 + j.phase + i) * r * 0.18;
        cx.lineTo(px + Math.cos(back) * dist + Math.cos(back + Math.PI / 2) * sway,
          py + Math.sin(back) * dist + Math.sin(back + Math.PI / 2) * sway);
      }
      cx.stroke();
    }
    // 伞盖
    const g2 = cx.createRadialGradient(j.x - r * 0.32, j.y - r * 0.34, r * 0.12, j.x, j.y, r);
    g2.addColorStop(0, 'rgba(255,255,255,0.9)');
    g2.addColorStop(0.45, k.body);
    g2.addColorStop(1, k.edge);
    cx.fillStyle = g2;
    cx.beginPath(); cx.arc(j.x, j.y, r, 0, TAU); cx.fill();
    cx.strokeStyle = k.edge; cx.lineWidth = 1.8; cx.stroke();
    // 伞边小花边
    cx.strokeStyle = 'rgba(255,255,255,0.35)'; cx.lineWidth = 1.4;
    for (let i = 0; i < 8; i++) {
      const a0 = i / 8 * TAU;
      cx.beginPath(); cx.arc(j.x, j.y, r * 0.82, a0, a0 + 0.3); cx.stroke();
    }
    // 高光
    cx.fillStyle = 'rgba(255,255,255,0.62)';
    cx.beginPath(); cx.ellipse(j.x - r * 0.34, j.y - r * 0.38, r * 0.22, r * 0.13, -0.6, 0, TAU); cx.fill();
    if (k.zap) {
      cx.strokeStyle = 'rgba(255,255,170,0.95)'; cx.lineWidth = 1.8;
      for (let a = 0; a < 3; a++) {
        const ang = t * 6 + a * 2.1 + j.phase;
        cx.beginPath();
        cx.moveTo(j.x + Math.cos(ang) * r * 0.75, j.y + Math.sin(ang) * r * 0.75);
        cx.lineTo(j.x + Math.cos(ang + 0.35) * r * 1.25, j.y + Math.sin(ang + 0.35) * r * 1.25);
        cx.lineTo(j.x + Math.cos(ang + 0.1) * r * 1.55, j.y + Math.sin(ang + 0.1) * r * 1.55);
        cx.stroke();
      }
    } else if (k.gold) {
      cx.fillStyle = 'rgba(255,255,220,0.95)';
      for (let i = 0; i < 3; i++) {
        const ang = t * 2 + i * 2.1 + j.phase;
        const px = j.x + Math.cos(ang) * r * 1.15, py = j.y + Math.sin(ang) * r * 1.15;
        cx.beginPath();
        cx.moveTo(px, py - 4); cx.lineTo(px + 1.6, py - 1.6); cx.lineTo(px + 4, py);
        cx.lineTo(px + 1.6, py + 1.6); cx.lineTo(px, py + 4); cx.lineTo(px - 1.6, py + 1.6);
        cx.lineTo(px - 4, py); cx.lineTo(px - 1.6, py - 1.6); cx.closePath(); cx.fill();
      }
    }
    cx.restore();
  },
  drawOver(t) {
    const T = WORLD_TUNING;
    const tune = this.tune();
    // 水花圈
    for (const s of this.splashes) {
      const k = s.t / s.life;
      cx.save();
      cx.globalAlpha = (1 - k) * 0.8;
      cx.strokeStyle = s.color; cx.lineWidth = 2.5;
      cx.beginPath(); cx.ellipse(s.x, s.y, s.r * (0.4 + k * 0.9), s.r * (0.2 + k * 0.45), 0, 0, TAU); cx.stroke();
      cx.restore();
    }
    // 诱饵的聚拢小箭头？省略——用虚线圈已足够
    // 准星
    if (this.active && this.zapT <= 0) {
      const ready = this.castCd <= 0;
      const ax = this.aim.x, ay = this.aim.y;
      const dx = ax - WorldHub.player.x, dy = ay - WorldHub.player.y;
      const d = Math.hypot(dx, dy);
      const px = d > T.netRange ? WorldHub.player.x + dx / d * T.netRange : ax;
      const py = d > T.netRange ? WorldHub.player.y + dy / d * T.netRange : ay;
      cx.save();
      cx.globalAlpha = ready ? 0.7 : 0.28;
      cx.strokeStyle = ready ? '#ffe059' : '#cfd8e6';
      cx.lineWidth = 2;
      cx.setLineDash([7, 7]);
      cx.beginPath(); cx.arc(px, py, tune.netR, 0, TAU); cx.stroke();
      cx.setLineDash([]);
      cx.beginPath(); cx.moveTo(px - 8, py); cx.lineTo(px + 8, py);
      cx.moveTo(px, py - 8); cx.lineTo(px, py + 8); cx.stroke();
      cx.restore();
    }
    // 网
    if (this.net) {
      const n = this.net;
      let x = n.x, y = n.y, r = n.r, a = 1;
      if (!n.resolved) {
        const k = 1 - n.t / T.netFlight;
        x = n.from.x + (n.x - n.from.x) * k;
        y = n.from.y + (n.y - n.from.y) * k - Math.sin(k * Math.PI) * 46;
        r = n.r * (0.5 + k * 0.5);
      } else {
        const k = 1 - n.landT / T.netOpen;
        a = 1 - k * 0.65;
        r = n.r * (1 + k * 0.1);
      }
      cx.save();
      cx.globalAlpha = a;
      // 网绳
      if (!n.resolved) {
        cx.strokeStyle = 'rgba(255,255,255,0.45)'; cx.lineWidth = 2;
        cx.beginPath(); cx.moveTo(n.from.x, n.from.y); cx.lineTo(x, y); cx.stroke();
      }
      // 网圈
      cx.strokeStyle = n.resolved ? '#bfeaff' : '#ffe059';
      cx.lineWidth = 3;
      cx.beginPath(); cx.ellipse(x, y, r, r * 0.72, 0, 0, TAU); cx.stroke();
      // 网眼
      cx.strokeStyle = n.resolved ? 'rgba(200,240,255,0.55)' : 'rgba(255,224,89,0.55)';
      cx.lineWidth = 1.2;
      for (let i = -3; i <= 3; i++) {
        cx.beginPath();
        cx.moveTo(x + i * r * 0.26, y - r * 0.6);
        cx.lineTo(x + i * r * 0.26, y + r * 0.6);
        cx.stroke();
      }
      for (let i = -2; i <= 2; i++) {
        cx.beginPath();
        cx.ellipse(x, y, r, Math.abs(i) * r * 0.2 + 2, 0, 0, TAU);
        cx.stroke();
      }
      cx.restore();
    }
    // 珊迪：每只水母头顶挂果冻价签
    if (tune.badges) {
      cx.save();
      cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.font = '900 12px system-ui, "Microsoft YaHei", sans-serif';
      for (const j of this.jellies) {
        const kk = JELLY_KINDS[j.kind];
        const px = j.x, py = j.y - j.r - 16;
        cx.fillStyle = 'rgba(9,43,60,0.78)';
        worldRoundRect(px - 15, py - 9, 30, 18, 6); cx.fill();
        cx.fillStyle = kk.color;
        cx.fillText(kk.jelly > 0 ? kk.jelly : '⚡', px, py + 1);
      }
      cx.restore();
    }
    // 飘字
    if (this.fx.length) {
      cx.save();
      cx.textAlign = 'center'; cx.textBaseline = 'middle';
      for (const f of this.fx) {
        const k = 1 - f.t / f.life;
        cx.globalAlpha = clamp(k * 1.8, 0, 1);
        cx.font = `900 ${f.size || 18}px system-ui, "Microsoft YaHei", sans-serif`;
        cx.lineWidth = 4; cx.strokeStyle = 'rgba(6,34,50,0.75)';
        cx.strokeText(f.text, f.x, f.y);
        cx.fillStyle = f.color;
        cx.fillText(f.text, f.x, f.y);
      }
      cx.restore();
    }
  },
  drawScreen(t) {
    // 潮水压色：越接近涨潮，边缘越深
    const k = clamp(1 - this.time / WORLD_TUNING.duration, 0, 1);
    if (k > 0.02) {
      cx.save();
      const g = cx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.72);
      g.addColorStop(0, 'rgba(6,40,70,0)');
      g.addColorStop(1, `rgba(6,40,70,${0.1 + k * 0.28})`);
      cx.fillStyle = g; cx.fillRect(0, 0, W, H);
      cx.restore();
    }
    // 电击白闪
    if (this.flashT > 0) {
      cx.save();
      cx.globalAlpha = this.flashT / 0.38 * 0.55;
      cx.fillStyle = '#eaffc0'; cx.fillRect(0, 0, W, H);
      cx.restore();
    }
    // 麻痹：屏幕边缘电弧
    if (this.zapT > 0) {
      cx.save();
      cx.strokeStyle = 'rgba(234,255,107,0.85)'; cx.lineWidth = 3;
      for (let i = 0; i < 7; i++) {
        const side = i % 4;
        const px = side === 0 ? 0 : side === 1 ? W : side === 2 ? (i * 137) % W : (i * 211) % W;
        const py = side === 0 || side === 1 ? (i * 149) % H : side === 2 ? 0 : H;
        cx.beginPath();
        cx.moveTo(px, py);
        cx.lineTo(px + (side === 1 || side === 2 ? -20 : 20), py + (i % 2 ? 16 : -16));
        cx.lineTo(px + (side === 1 || side === 2 ? -34 : 34), py + (i % 2 ? 26 : -26));
        cx.stroke();
      }
      cx.restore();
    }
  },
  render() {
    WorldHub.render();
  },
};
