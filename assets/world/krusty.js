/* ================= 小世界 · 蟹堡王（午市做蟹黄包） =================
 *
 * 玩法闭环：
 *   - 顾客排队点单（最多 3 张订单，配方 + 耐心条）；
 *   - 烤盘上的指针左右扫，停在中间 = 金黄肉饼（完美），偏一点 = 合格，太偏 = 糊；
 *   - 按订单顺序点原料叠蟹黄包（面包 → 肉饼 → 生菜/番茄/芝士 → 面包）；
 *   - 叠到和某张订单完全一致就自动上菜，按单结贝壳币；
 *   - 午市 75 秒，时间到（或提前收摊）结算，收入一次写进经济存档。
 *
 * 和 world.js 一样的经典脚本约定：
 *   1. 顶层只放纯字面量常量（载入时 index.html 的 const 还在 TDZ）；
 *   2. 所有依赖游戏全局的函数只在运行期调用；
 *   3. 不新增图片资产：蟹黄包、肉饼、顾客都用 emoji + CSS。
 */

/* ---------------- 数值调参 ---------------- */
const KRUSTY_TUNING = {
  duration: 75,          // 午市时长（秒）
  maxOrders: 3,          // 同时排队的顾客数
  orderGap: [5.2, 7.6],  // 补订单的间隔
  patience: [17, 23],    // 顾客耐心基准（秒，双份订单 +3）
  grillCycle: 1.5,       // 指针从左扫到右的秒数
  perfectBand: 0.11,     // |pos-0.5| 以内 → 金黄（派宝宝 ×1.3）
  goodBand: 0.28,        // 以内 → 合格；再外 → 糊
  trayMax: 2,            // 备餐台最多放 2 块煎好的肉饼
  reward: [4, 7],        // 单份订单基础收入区间
  doubleReward: 9,       // 双份订单基础收入
  doubleChance: 0.22,    // 22 秒后出现的双份概率
  perfectTip: 2,         // 每块金黄肉饼的小费
  comboStep: 3,          // 每 3 连单小费 +10%
  comboMax: 0.5,         // 小费倍率上限 +50%
};

const KRUSTY_INGS = {
  bun: { name: '面包', icon: '🍞' },
  patty: { name: '肉饼', icon: '🥩' },
  lettuce: { name: '生菜', icon: '🥬' },
  tomato: { name: '番茄', icon: '🍅' },
  cheese: { name: '芝士', icon: '🧀' },
};
const KRUSTY_FILLINGS = ['lettuce', 'tomato', 'cheese'];
const KRUSTY_WHOS = ['🐟', '🐠', '🦐', '🐙', '🦑', '🐡'];

const KrustyGame = {
  active: false,
  time: 0,
  elapsed: 0,
  orders: [],
  stack: [],
  stackMeta: [],
  tray: [],
  grill: { active: false, pos: 0, dir: 1 },
  earned: 0,
  served: 0,
  perfect: 0,
  burnt: 0,
  combo: 0,
  bestCombo: 0,
  undoLeft: 0,
  spawnT: 0,
  rev: 0,
  _rev: -1,
  _tipTimer: null,

  /* ---------- 生命周期 ---------- */
  start() {
    const T = KRUSTY_TUNING;
    const id = CHARS[game.charIdx] ? CHARS[game.charIdx].id : '';
    this.active = true;
    this.time = T.duration;
    this.elapsed = 0;
    this.orders = [];
    this.stack = [];
    this.stackMeta = [];
    this.tray = [];
    this.grill = { active: false, pos: 0, dir: 1 };
    this.earned = 0;
    this.served = 0;
    this.perfect = 0;
    this.burnt = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.undoLeft = id === 'spongebob' ? 1 : 0;
    this.spawnT = T.orderGap[0];
    this.rev = 0;
    this._rev = -1;
    if ($('krPop')) { $('krPop').textContent = ''; $('krPop').classList.remove('go'); }
    this.layoutZones();
    game.state = 'krusty';
    // 开局先来两张订单，第一张稍等一会儿，别一进门就手忙脚乱
    this.spawnOrder();
    this.spawnOrder();
    this.tip('点「煎肉饼」开始，指针停在中间就是金黄', '');
    this.syncAll();
  },
  finish() {
    if (!this.active) return;
    this.active = false;
    this.grill.active = false;
    this.time = 0;
    if (typeof endKrustyShift === 'function') endKrustyShift();
  },
  stats() {
    return {
      earned: this.earned,
      served: this.served,
      perfect: this.perfect,
      burnt: this.burnt,
      bestCombo: this.bestCombo,
    };
  },

  /* ---------- 角色差异 ---------- */
  band() {
    const id = CHARS[game.charIdx] ? CHARS[game.charIdx].id : '';
    const k = id === 'patrick' ? 1.3 : 1;   // 派宝宝：煎盘窗口更大
    return { perfect: KRUSTY_TUNING.perfectBand * k, good: KRUSTY_TUNING.goodBand * k };
  },
  patienceMul() {
    const id = CHARS[game.charIdx] ? CHARS[game.charIdx].id : '';
    return id === 'squidward' ? 1.25 : 1;   // 王哥：顾客耐心 +25%
  },
  sandyHint() {
    const id = CHARS[game.charIdx] ? CHARS[game.charIdx].id : '';
    return id === 'sandy';                  // 珊迪：高亮下一味原料
  },
  comboMul() {
    const T = KRUSTY_TUNING;
    return 1 + Math.min(T.comboMax, Math.floor(this.combo / T.comboStep) * 0.1);
  },

  /* ---------- 订单 ---------- */
  spawnOrder() {
    const T = KRUSTY_TUNING;
    const double = this.elapsed > 22 && Math.random() < T.doubleChance;
    const fill = KRUSTY_FILLINGS[(Math.random() * KRUSTY_FILLINGS.length) | 0];
    const recipe = double
      ? ['bun', 'patty', fill, 'patty', 'bun']
      : ['bun', 'patty', fill, 'bun'];
    const mul = this.patienceMul();
    const base = double
      ? T.doubleReward + ((Math.random() * 3) | 0)
      : T.reward[0] + ((Math.random() * (T.reward[1] - T.reward[0] + 1)) | 0);
    const max = (double ? 20 : 17) + Math.random() * 5;
    this.orders.push({
      recipe,
      patience: max * mul,
      max: max * mul,
      base,
      double,
      who: KRUSTY_WHOS[(Math.random() * KRUSTY_WHOS.length) | 0],
    });
    this.rev++;
  },
  /* 下一味该点的原料：找「当前盘子还是它的前缀」里耐心最少的那张单 */
  nextNeeded() {
    let best = null;
    for (const o of this.orders) {
      if (o.recipe.length < this.stack.length) continue;
      if (!this.stack.every((v, i) => o.recipe[i] === v)) continue;
      if (this.stack.length >= o.recipe.length) continue;
      if (!best || o.patience < best.patience) best = o;
    }
    return best ? best.recipe[this.stack.length] : null;
  },

  /* ---------- 烤盘 ---------- */
  grillAction() {
    const T = KRUSTY_TUNING;
    if (!this.active) return false;
    if (this.grill.active) { this.stopGrill(); return true; }
    if (this.tray.length >= T.trayMax) {
      this.tip('备餐台放不下了，先用掉一块肉饼', '#c33a2a');
      return false;
    }
    this.grill.active = true;
    this.grill.pos = 0;
    this.grill.dir = 1;
    AudioSys.resume();
    AudioSys.tone(240, 0.06, 'triangle', 0.08);
    this.tip('指针停在中间 = 金黄肉饼', '');
    this.syncGrillButton();
    return true;
  },
  stepGrill(dt) {
    const g = this.grill;
    g.pos += g.dir * dt / KRUSTY_TUNING.grillCycle;
    if (g.pos >= 1) { g.pos = 1; g.dir = -1; }
    else if (g.pos <= 0) { g.pos = 0; g.dir = 1; }
  },
  stopGrill() {
    if (!this.grill.active) return;
    this.grill.active = false;
    const w = this.band();
    const d = Math.abs(this.grill.pos - 0.5);
    if (d <= w.perfect) {
      this.tray.push({ perfect: true });
      this.perfect += 1;
      AudioSys.coin();
      this.tip('金黄肉饼！小费 +' + KRUSTY_TUNING.perfectTip, '#c98f1b');
    } else if (d <= w.good) {
      this.tray.push({ perfect: false });
      AudioSys.tone(620, 0.1, 'triangle', 0.12);
      this.tip('合格肉饼，能用', '#2f8f5b');
    } else {
      this.burnt += 1;
      this.combo = 0;
      AudioSys.hit();
      this.tip('煎糊了…连单清零', '#c33a2a');
    }
    this.syncPlates();
    this.syncGrillButton();
    this.syncHud();
  },
  syncGrillButton() {
    const b = $('krGrillBtn');
    if (!b) return;
    b.classList.toggle('on', this.grill.active);
    b.innerHTML = this.grill.active ? '出锅 <small>空格</small>' : '煎肉饼 <small>空格</small>';
  },
  /* 指针按「2%~98%」映射，两端的圆点不会被裁掉；黄区/完美区跟着同一个映射和角色加成缩放 */
  layoutZones() {
    const w = this.band();
    const m = p => 2 + p * 96;
    const good = $('krZoneGood'), perf = $('krZonePerfect');
    if (good) {
      good.style.left = m(0.5 - w.good).toFixed(2) + '%';
      good.style.right = (100 - m(0.5 + w.good)).toFixed(2) + '%';
    }
    if (perf) {
      perf.style.left = m(0.5 - w.perfect).toFixed(2) + '%';
      perf.style.right = (100 - m(0.5 + w.perfect)).toFixed(2) + '%';
    }
  },

  /* ---------- 叠料 / 上菜 ---------- */
  addIngredient(id) {
    if (!this.active || !KRUSTY_INGS[id]) return false;
    if (id === 'patty') {
      if (!this.tray.length) { this.tip('备餐台没有肉饼，先煎一块', '#c33a2a'); return false; }
      const p = this.tray.shift();
      this.stack.push('patty');
      this.stackMeta.push({ perfect: !!p.perfect });
    } else {
      this.stack.push(id);
      this.stackMeta.push(null);
    }
    AudioSys.resume();
    AudioSys.tone(id === 'patty' ? 300 : 520, 0.05, 'triangle', 0.08);
    if (!this.serveIfMatch()) {
      const possible = this.orders.some(o =>
        o.recipe.length >= this.stack.length &&
        this.stack.every((v, i) => o.recipe[i] === v));
      if (!possible) this.tip('这一盘对不上订单，倒掉重做', '#c33a2a');
      else this.tip('继续按订单叠料', '');
    }
    this.syncPlates();
    this.syncHud();
    return true;
  },
  serveIfMatch() {
    const matches = [];
    this.orders.forEach((o, i) => {
      if (o.recipe.length !== this.stack.length) return;
      if (o.recipe.every((v, k) => v === this.stack[k])) matches.push(i);
    });
    if (!matches.length) return false;
    // 多张单同配方时先上耐心最少的那张
    let idx = matches[0];
    for (const i of matches) if (this.orders[i].patience < this.orders[idx].patience) idx = i;
    const o = this.orders[idx];
    const tips = this.stackMeta.filter(m => m && m.perfect).length * KRUSTY_TUNING.perfectTip;
    const pay = Math.round((o.base + tips) * this.comboMul());
    this.earned += pay;
    this.served += 1;
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.orders.splice(idx, 1);
    this.stack = [];
    this.stackMeta = [];
    this.rev++;
    AudioSys.coin();
    this.tip(`卖出 +${pay} 贝壳币${tips ? `（金黄小费 +${tips}）` : ''}`, '#2f8f5b');
    this.pop(`+${pay}`);
    this.syncPlates();
    this.syncHud();
    return true;
  },
  undo() {
    if (!this.undoLeft || !this.stack.length) return false;
    this.stack.pop();
    this.stackMeta.pop();
    this.undoLeft -= 1;
    AudioSys.tone(320, 0.06, 'triangle', 0.1);
    this.tip('撤回了一味（本局只有 1 次）', '');
    this.syncPlates();
    return true;
  },
  clearStack() {
    if (!this.stack.length) return false;
    this.stack = [];
    this.stackMeta = [];
    AudioSys.noise(0.12, 0.12, 0, 900);
    this.tip('倒掉重来', '');
    this.syncPlates();
    return true;
  },

  /* ---------- 每帧 ---------- */
  update(dt) {
    if (!this.active) return;
    const T = KRUSTY_TUNING;
    this.time -= dt;
    this.elapsed += dt;
    // 顾客耐心
    for (let i = this.orders.length - 1; i >= 0; i--) {
      const o = this.orders[i];
      o.patience -= dt;
      if (o.patience <= 0) {
        this.orders.splice(i, 1);
        this.combo = 0;
        this.rev++;
        this.tip('顾客等不及走了…连单清零', '#c33a2a');
        AudioSys.tone(180, 0.14, 'triangle', 0.12, 0, 120);
      }
    }
    // 补订单
    this.spawnT -= dt;
    if (this.orders.length < T.maxOrders && this.spawnT <= 0) {
      this.spawnOrder();
      this.spawnT = T.orderGap[0] + Math.random() * (T.orderGap[1] - T.orderGap[0]);
    }
    if (this.grill.active) this.stepGrill(dt);
    if (this.rev !== this._rev) { this.renderOrders(); this._rev = this.rev; this.syncPlates(); }
    this.syncHud();
    if (this.time <= 0) this.finish();
  },

  /* ---------- DOM ---------- */
  syncAll() {
    this._rev = -1;
    this.renderOrders();
    this._rev = this.rev;
    this.syncPlates();
    this.syncGrillButton();
    this.syncHud();
  },
  renderOrders() {
    const box = $('krOrders');
    if (!box) return;
    if (!this.orders.length) {
      box.innerHTML = '<div class="kr-empty-order">马上就有顾客上门…</div>';
      return;
    }
    box.innerHTML = this.orders.map((o, i) => `
      <div class="kr-order" data-i="${i}">
        <div class="kr-who">${o.who}</div>
        <div class="kr-recipe">${o.recipe.map(id => `<span title="${KRUSTY_INGS[id].name}">${KRUSTY_INGS[id].icon}</span>`).join('')}</div>
        <div class="kr-pat"><i style="width:${Math.max(0, o.patience / o.max * 100)}%"></i></div>
      </div>`).join('');
  },
  syncHud() {
    if ($('krTime')) $('krTime').textContent = Math.max(0, this.time).toFixed(1);
    if ($('krCoins')) $('krCoins').textContent = this.earned;
    if ($('krCombo')) $('krCombo').textContent = this.combo > 0 ? `${this.combo} ×${this.comboMul().toFixed(1)}` : '0';
    if ($('krMarker')) $('krMarker').style.left = (2 + this.grill.pos * 96).toFixed(2) + '%';
    const box = $('krOrders');
    if (!box) return;
    const cards = box.children;
    for (let i = 0; i < cards.length && i < this.orders.length; i++) {
      const o = this.orders[i];
      const bar = cards[i].querySelector('.kr-pat i');
      if (bar) {
        const k = Math.max(0, o.patience / o.max);
        bar.style.width = (k * 100) + '%';
        bar.classList.toggle('low', k < 0.3);
      }
    }
  },
  syncPlates() {
    const tray = $('krTray');
    if (tray) {
      tray.innerHTML = this.tray.length
        ? this.tray.map(p => `<span class="kr-patty${p.perfect ? ' gold' : ''}" title="${p.perfect ? '金黄肉饼' : '合格肉饼'}">🥩</span>`).join('')
        : '<span class="kr-empty">备餐台空着</span>';
    }
    const build = $('krBuild');
    if (build) {
      build.innerHTML = this.stack.length
        ? this.stack.map(id => `<span title="${KRUSTY_INGS[id].name}">${KRUSTY_INGS[id].icon}</span>`).join('')
        : '<span class="kr-empty">空盘子</span>';
    }
    const undo = $('krUndo');
    if (undo) {
      undo.hidden = this.undoLeft <= 0 || !this.stack.length;
      undo.disabled = !this.stack.length;
    }
    const clear = $('krClear');
    if (clear) clear.disabled = !this.stack.length;
    if (this.sandyHint()) {
      const need = this.nextNeeded();
      document.querySelectorAll('#krIng button').forEach(b => {
        b.classList.toggle('need', !!need && b.dataset.ing === need);
      });
    } else {
      document.querySelectorAll('#krIng button.need').forEach(b => b.classList.remove('need'));
    }
  },
  tip(text, color) {
    const el = $('krTip');
    if (!el) return;
    el.textContent = text;
    el.style.color = color || '';
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    clearTimeout(this._tipTimer);
    this._tipTimer = setTimeout(() => { el.classList.remove('go'); }, 1600);
  },
  pop(text) {
    const el = $('krPop');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  },
};
