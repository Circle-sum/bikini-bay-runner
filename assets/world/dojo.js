/* ================= 小世界 · 空手道棚（看破切磋） =================
 *
 * 玩法闭环：
 *   - 三局两胜，每回合先到 3 分；
 *   - 对手起手会亮出招式（高踢 / 中拳 / 扫腿），进度条走完就出手；
 *   - 在最后一段红区里按下对应格挡 = 「看破」，得 1 分；
 *     按早了只是挡住（不得分，也不挨打）；按错或没按 = 对手得 1 分；
 *   - 赢下比赛推进段位（白 → 黄 → 蓝 → 红 → 黑），段位越高对手越快。
 *
 * 经典脚本约定同 world.js / krusty.js：顶层只放纯字面量常量。
 */

const DOJO_BELTS = [
  { name: '白带', color: '#f4f1e4', ink: '#243b5e', windup: 1.15, perfect: 0.26, reward: 40 },
  { name: '黄带', color: '#ffd23e', ink: '#243b5e', windup: 1.0, perfect: 0.24, reward: 55 },
  { name: '蓝带', color: '#5b8fd6', ink: '#ffffff', windup: 0.88, perfect: 0.22, reward: 70 },
  { name: '红带', color: '#e35d4a', ink: '#ffffff', windup: 0.76, perfect: 0.20, reward: 90 },
  { name: '黑带', color: '#243b5e', ink: '#ffffff', windup: 0.64, perfect: 0.18, reward: 120 },
];
const DOJO_BELT_STEP = 60;   // 首次升带的额外奖励

const DOJO_MOVES = {
  high: { name: '高踢', block: '上段', key: '1', color: '#e35d4a' },
  mid: { name: '中拳', block: '中段', key: '2', color: '#4a7fd6' },
  low: { name: '扫腿', block: '下段', key: '3', color: '#2f9e6f' },
};
const DOJO_MOVE_KEYS = ['high', 'mid', 'low'];
const DOJO_ROUND_POINTS = 3;
const DOJO_ROUNDS_TO_WIN = 2;

const DojoGame = {
  active: false,
  beltIdx: 0,
  round: 1,
  roundsYou: 0,
  roundsFoe: 0,
  you: 0,
  foe: 0,
  stage: 'intro',      // intro | fight | roundEnd | matchEnd
  stageT: 0,
  move: null,
  phase: 0,
  windup: 1,
  perfect: 0.2,
  resolved: false,
  resolveT: 0,
  perfectCount: 0,
  guardCount: 0,
  won: false,
  result: '',
  _hudRev: -1,

  /* ---------- 生命周期 ---------- */
  start() {
    const saved = SAVE.world ? SAVE.world.dojoBelt : 0;
    this.beltIdx = Math.max(0, Math.min(DOJO_BELTS.length - 1, Number.isFinite(saved) ? saved : 0));
    this.round = 1;
    this.roundsYou = 0;
    this.roundsFoe = 0;
    this.perfectCount = 0;
    this.guardCount = 0;
    this.won = false;
    this.active = true;
    game.state = 'dojo';
    this.beginRound();
  },
  beginRound() {
    this.you = 0;
    this.foe = 0;
    this.stage = 'intro';
    this.stageT = 1.25;
    this.move = null;
    this.resolved = false;
    this.phase = 0;
    this.result = '';
    this.syncAll();
  },
  belt() { return DOJO_BELTS[this.beltIdx]; },
  tune() {
    const id = CHARS[game.charIdx] ? CHARS[game.charIdx].id : '';
    return {
      windupMul: id === 'squidward' ? 1.15 : 1,   // 王哥：对手起手更慢
      perfectMul: id === 'spongebob' ? 1.2 : 1,   // 碧莲：看破窗口更大
      doublePerfect: id === 'patrick',            // 派宝宝：看破得 2 分
      hint: id === 'sandy',                       // 珊迪：高亮正确格挡
    };
  },
  stats() {
    return {
      win: this.won,
      perfect: this.perfectCount,
      guard: this.guardCount,
      roundsYou: this.roundsYou,
      roundsFoe: this.roundsFoe,
      beltIdx: this.beltIdx,
    };
  },

  /* ---------- 回合 ---------- */
  nextExchange() {
    const t = this.tune();
    this.move = DOJO_MOVE_KEYS[(Math.random() * DOJO_MOVE_KEYS.length) | 0];
    this.phase = 0;
    this.resolved = false;
    this.windup = this.belt().windup * t.windupMul;
    this.perfect = Math.min(this.windup * 0.6, this.belt().perfect * t.perfectMul);
    this.result = '';
    this.syncAll();
  },
  block(side) {
    if (!this.active || this.stage !== 'fight' || this.resolved) return false;
    if (side !== this.move) { this.resolve('wrong'); return true; }
    if (this.phase >= this.windup - this.perfect) this.resolve('perfect');
    else this.resolve('guard');
    return true;
  },
  resolve(kind) {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveT = kind === 'perfect' ? 0.8 : 0.7;
    if (kind === 'perfect') {
      const pts = this.tune().doublePerfect ? 2 : 1;
      this.you += pts;
      this.perfectCount += 1;
      this.result = pts > 1 ? '看破！双倍反制 +2' : '看破！+1';
      AudioSys.resume();
      AudioSys.tone(660, 0.08, 'square', 0.16);
      AudioSys.tone(990, 0.16, 'square', 0.14, AudioSys.now() + 0.07);
      if (navigator.vibrate && SETTINGS.vibrate) navigator.vibrate(25);
    } else if (kind === 'guard') {
      this.guardCount += 1;
      this.result = '挡住（不得分）';
      AudioSys.tone(300, 0.09, 'triangle', 0.14);
    } else if (kind === 'wrong') {
      this.foe += 1;
      this.result = '防错方向，被打中';
      AudioSys.hit();
    } else {
      this.foe += 1;
      this.result = '没挡住，被击中';
      AudioSys.hit();
    }
    this.syncAll();
    if (this.you >= DOJO_ROUND_POINTS || this.foe >= DOJO_ROUND_POINTS) this.endRound();
  },
  endRound() {
    this.stage = 'roundEnd';
    this.stageT = 1.9;
    if (this.you >= DOJO_ROUND_POINTS) {
      this.roundsYou += 1;
      this.stageT = 1.6;
      AudioSys.power();
    } else {
      this.roundsFoe += 1;
      AudioSys.tone(180, 0.3, 'sawtooth', 0.16, 0, 90);
      if (navigator.vibrate && SETTINGS.vibrate) navigator.vibrate([40, 40, 60]);
    }
    this.syncAll();
  },
  matchOver() {
    return this.roundsYou >= DOJO_ROUNDS_TO_WIN || this.roundsFoe >= DOJO_ROUNDS_TO_WIN;
  },
  finishMatch() {
    this.stage = 'matchEnd';
    this.active = false;
    this.won = this.roundsYou >= DOJO_ROUNDS_TO_WIN;
    if (typeof endDojoMatch === 'function') endDojoMatch(this.won);
  },
  /* 中途退出：不结算、不给奖励 */
  cancel() {
    if (!this.active) return false;
    this.active = false;
    this.stage = 'matchEnd';
    this.won = false;
    return true;
  },

  /* ---------- 每帧 ---------- */
  update(dt) {
    if (!this.active) return;
    if (this.stage === 'intro') {
      this.stageT -= dt;
      if (this.stageT <= 0) { this.stage = 'fight'; this.nextExchange(); }
    } else if (this.stage === 'fight') {
      if (this.resolved) {
        this.resolveT -= dt;
        if (this.resolveT <= 0) {
          if (this.stage === 'fight') this.nextExchange();
        }
      } else {
        this.phase += dt;
        if (this.phase > this.windup + 0.14) this.resolve('hit');
      }
      this.syncStage();
      this.syncHud();
    } else if (this.stage === 'roundEnd') {
      this.stageT -= dt;
      if (this.stageT <= 0) {
        if (this.matchOver()) this.finishMatch();
        else { this.round += 1; this.beginRound(); }
      }
    }
  },

  /* ---------- DOM ---------- */
  syncAll() {
    this.syncHud();
    this.syncStage();
  },
  syncHud() {
    const b = this.belt();
    if ($('djBelt')) {
      $('djBelt').textContent = b.name;
      $('djBelt').style.background = b.color;
      $('djBelt').style.color = b.ink;
    }
    if ($('djRound')) $('djRound').textContent = `第 ${this.round} 回合`;
    if ($('djYou')) $('djYou').textContent = this.you;
    if ($('djFoe')) $('djFoe').textContent = this.foe;
    if ($('djSets')) $('djSets').textContent = `局 ${this.roundsYou} : ${this.roundsFoe}`;
  },
  syncStage() {
    const m = this.move ? DOJO_MOVES[this.move] : null;
    if ($('djMove')) {
      $('djMove').textContent = m ? m.name : '…';
      $('djMove').style.background = m ? m.color : '#9fb3ae';
    }
    if ($('djCall')) {
      $('djCall').textContent = this.result
        || (this.stage === 'intro' ? '预备…' : this.stage === 'roundEnd' ? '本回合结束' : '对手起手…');
    }
    if ($('djFoeFace')) {
      $('djFoeFace').classList.toggle('strike', this.stage === 'fight' && !this.resolved && this.phase > this.windup - this.perfect);
      $('djFoeFace').classList.toggle('hit', this.resolved && /看破/.test(this.result));
    }
    this.syncBar();
    const hint = this.tune().hint;
    document.querySelectorAll('#djBlocks button').forEach(btn => {
      btn.classList.toggle('need', hint && !!this.move && btn.dataset.block === this.move);
    });
  },
  syncBar() {
    const bar = $('djBar');
    if (!bar) return;
    const pct = this.stage === 'fight'
      ? Math.min(1, this.phase / this.windup)
      : (this.stage === 'intro' ? 0 : 1);
    bar.style.width = (pct * 100).toFixed(1) + '%';
    bar.classList.toggle('hot', this.stage === 'fight' && !this.resolved && this.phase >= this.windup - this.perfect);
  },
};
