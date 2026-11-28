// キャラのステータス (戦闘・スタミナ・特殊攻撃・必殺技・属性・移動)。画面にも three.js にも依存しない部品 (node で試せる)。
//   最終の値 = (基本値 + レベルの伸び + ボーナス + 加護の足し算) × (1 + 加護の割合)
//   ・レベル: 経験値の合計から決まる (敵を倒す・イベントをクリアすると入る)
//   ・ボーナス: イベントを初めてクリアしたとき、決まった項目に +BONUS_STEP (0.1)。値 1.0 = その項目の unit の BONUS_RATE (10%)
//   ・加護: 体の部位に宿して能力を上げる仕組み用の口 (setSource)。まだ何も宿していない
//   ・基準値 (レベル 1・ボーナス 0) は、以前の固定値と同じ: HP 100・体当たり 1 回 20・無敵 1.0 秒・敵への与ダメージは手順どおり
// 保存は端末のブラウザ (localStorage) の別の鍵。経験値・クリア済みのイベント・ボーナスだけ。スタミナなどの今の量は保存しない。
// URL: ?lv=10 (レベルをその値にする)、?resetsave (保存を消す。wardrobe.js と同じ)
const KEY = 'totsuka.status.v1';

// ---- 属性 (パズドラと同じ) ----
export const ELEMENTS = [
  { key: 'fire', name: '火', color: '#ff6b4a' }, { key: 'water', name: '水', color: '#4aa8ff' }, { key: 'wood', name: '木', color: '#4cc46a' },
  { key: 'light', name: '光', color: '#ffd84a' }, { key: 'dark', name: '闇', color: '#a66bd8' },
];
const BEATS = { fire: 'wood', wood: 'water', water: 'fire', light: 'dark', dark: 'light' }; // 左が右に強い (火→木→水→火、光⇄闇)
export const ELEM_ADV = 2, ELEM_DIS = 0.5;   // 有利・不利の倍率 (パズドラと同じ)

// 攻撃の属性 atk が、相手の属性 def に当たるときの倍率。どちらかが無属性 (null) なら 1。光と闇は互いに有利だけで、不利は無い
export function elementMul(atk, def) {
  if (!atk || !def) return 1;
  if (BEATS[atk] === def) return ELEM_ADV;
  if (BEATS[def] === atk && atk !== 'light' && atk !== 'dark') return ELEM_DIS;
  return 1;
}

// ---- 項目 (base = レベル 1 の値、perLv = 1 レベルごとの伸び、unit = ボーナス 1.0 あたりの目安 (その 10% が足される)) ----
// group: 画面の見出し。fmt: 表示の仕方 (n = 数、p = %、x = 倍、s = 秒、r = /秒)
export const STATS = {
  hp:       { group: '戦闘', name: '最大HP', base: 100, perLv: 6, unit: 100, fmt: 'n' },
  atk:      { group: '戦闘', name: '攻撃力', base: 100, perLv: 4, unit: 100, fmt: 'n' },
  def:      { group: '戦闘', name: '防御力', base: 0, perLv: 2, unit: 100, fmt: 'n' },
  crit:     { group: '戦闘', name: '会心率', base: 0.05, perLv: 0, unit: 0.5, fmt: 'p' },
  critDmg:  { group: '戦闘', name: '会心ダメージ', base: 1.5, perLv: 0, unit: 1, fmt: 'x' },
  stamina:  { group: 'スタミナ', name: '最大スタミナ', base: 100, perLv: 2, unit: 100, fmt: 'n' },
  staRegen: { group: 'スタミナ', name: '回復速度', base: 20, perLv: 0, unit: 20, fmt: 'r' },
  staSave:  { group: 'スタミナ', name: '消費軽減', base: 0, perLv: 0, unit: 1, fmt: 'p' },
  spAtk:    { group: '特殊攻撃', name: '特殊攻撃力', base: 100, perLv: 2, unit: 100, fmt: 'n' },
  spGauge:  { group: '特殊攻撃', name: '技ゲージ最大', base: 100, perLv: 0, unit: 100, fmt: 'n' },
  spRegen:  { group: '特殊攻撃', name: '技ゲージ回復', base: 5, perLv: 0, unit: 5, fmt: 'r' },
  ultAtk:   { group: '必殺技', name: '必殺技力', base: 100, perLv: 3, unit: 100, fmt: 'n' },
  ultGauge: { group: '必殺技', name: '必殺ゲージ最大', base: 100, perLv: 0, unit: 100, fmt: 'n' },
  ultGain:  { group: '必殺技', name: 'ゲージの溜まりやすさ', base: 1, perLv: 0, unit: 1, fmt: 'x' },
  speed:    { group: '移動', name: '移動速度', base: 1, perLv: 0, unit: 1, fmt: 'x' },
  inv:      { group: '移動', name: '無敵時間', base: 1, perLv: 0, unit: 1, fmt: 's' },
};
export const GROUPS = ['戦闘', 'スタミナ', '特殊攻撃', '必殺技', '移動'];

// ---- 成長 ----
export const MAX_LV = 50;
export const expNeed = (lv) => 100 + 50 * (lv - 1);          // lv → lv+1 に要る経験値
export const BONUS_STEP = 0.1, BONUS_RATE = 0.1;
export const EXP = { kill: 5, swarmClear: 100, rhythmClear: 60, arcadeClear: 60 };
// イベントを初めてクリアしたときに上がる項目 (イベントを足すときは 1 行足す)
export const BONUS_EVENTS = {
  swarm:  { name: 'うな○ー大量発生クエスト', stat: 'atk', how: '100 体たおす' },
  rhythm: { name: 'リズム地獄（八坂神社・お札まき）', stat: 'hp', how: '「吉」以上' },
  arcade: { name: 'プロジェクトセマイ ワンルームステージ！', stat: 'stamina', how: 'ランク B 以上' },
};

// ---- スタミナの消費 (1 回 / 1 秒あたり) と回復の待ち ----
export const COST = { dash: 100 / 12, parkour: 10, atk: 6 };  // ダッシュは満タンから約 12 秒
const REGEN_DELAY = 0.7;       // 使ったあと、この秒数は回復しない
const WIND_OK = 20;            // 息切れ (0 になった) から、ここまで戻るとまた動ける
const SAVE_MAX = 0.6;          // 消費軽減の上限

export function levelFromExp(exp) {
  let lv = 1, left = Math.max(0, exp);
  while (lv < MAX_LV && left >= expNeed(lv)) { left -= expNeed(lv); lv++; }
  return { lv, into: lv >= MAX_LV ? 0 : left, need: lv >= MAX_LV ? 0 : expNeed(lv) };
}
export const expForLevel = (lv) => { let t = 0; for (let i = 1; i < Math.min(lv, MAX_LV); i++) t += expNeed(i); return t; };

export class Status {
  constructor() {
    this.exp = 0;
    this.done = {};            // クリア済みのイベント { swarm: true, ... }
    this.bonus = {};           // 項目ごとのボーナス値 { atk: 0.1, ... }
    this.sources = new Map();  // 加護など { id → { stat: { flat, pct } } }
    this.listeners = [];
    this.onNotice = null;      // (文字列) 経験値・レベルアップ・ボーナスのお知らせ。main.js が画面に出す
    // 今の量 (保存しない)
    this.winded = false; this.delay = 0;
    this.skill = 0; this.ult = 0;
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
    if (q.has('resetsave')) { try { localStorage.removeItem(KEY); } catch (e) { /* 保存できない環境 */ } }
    this.load();
    if (q.has('lv')) this.exp = expForLevel(Math.max(1, Math.min(MAX_LV, Math.floor(+q.get('lv') || 1))));
    this.recalc();
    this.stamina = this.cur.stamina;
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!s) return;
      if (Number.isFinite(s.exp)) this.exp = Math.max(0, Math.floor(s.exp));
      for (const k of Object.keys(BONUS_EVENTS)) if (s.done && s.done[k]) this.done[k] = true;
      for (const k of Object.keys(STATS)) if (s.bonus && Number.isFinite(s.bonus[k])) this.bonus[k] = Math.max(0, Math.round(s.bonus[k] * 10) / 10);
    } catch (e) { /* 読めなければ最初から */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, exp: this.exp, done: this.done, bonus: this.bonus })); } catch (e) { /* 保存できない環境 */ }
  }

  onChange(fn) { this.listeners.push(fn); }
  changed() { this.recalc(); this.save(); for (const f of this.listeners) f(this); }

  get level() { return levelFromExp(this.exp).lv; }
  levelInfo() { return levelFromExp(this.exp); }

  // 項目の内訳 { base (基本値)、lv (レベルの伸び)、bonus (ボーナスで足された分)、flat・pct (加護)、total }
  breakdown(k) {
    const S = STATS[k], lv = this.level;
    const base = S.base, grow = S.perLv * (lv - 1), bonus = (this.bonus[k] || 0) * BONUS_RATE * S.unit;
    let flat = 0, pct = 0;
    for (const src of this.sources.values()) { const m = src[k]; if (m) { flat += m.flat || 0; pct += m.pct || 0; } }
    return { base, lv: grow, bonus, flat, pct, total: (base + grow + bonus + flat) * (1 + pct) };
  }

  recalc() {
    this.cur = {};
    for (const k of Object.keys(STATS)) this.cur[k] = this.breakdown(k).total;
    this.cur.staSave = Math.min(SAVE_MAX, this.cur.staSave);
    this.cur.crit = Math.min(1, this.cur.crit);
    if (this.stamina > this.cur.stamina) this.stamina = this.cur.stamina;
  }
  value(k) { return this.cur[k]; }

  // 加護など: id ごとに { 項目: { flat, pct } } を足す (null で外す)
  setSource(id, mods) { if (mods) this.sources.set(id, mods); else this.sources.delete(id); this.changed(); }

  // ---- 経験値・イベント ----
  // 経験値を足す。レベルが上がったら新しいレベルを返す (上がらなければ 0)
  addExp(n, label = '') {
    n = Math.max(0, Math.floor(n));
    if (!n) return 0;
    const before = this.level;
    this.exp += n;
    this.changed();
    const after = this.level;
    this.notice(`${label}経験値 +${n}` + (after > before ? `　レベルアップ！ Lv ${after}` : ''));
    if (after > before) { this.stamina = this.cur.stamina; }
    return after > before ? after : 0;
  }

  // イベントをクリアした。初めてなら、決まった項目のボーナスが BONUS_STEP 増える。{ first, stat, name } を返す
  clearEvent(id) {
    const ev = BONUS_EVENTS[id];
    if (!ev || this.done[id]) return { first: false };
    this.done[id] = true;
    this.bonus[ev.stat] = Math.round(((this.bonus[ev.stat] || 0) + BONUS_STEP) * 10) / 10;
    this.changed();
    this.notice(`ボーナス！ ${STATS[ev.stat].name} +${BONUS_STEP}`);
    return { first: true, stat: ev.stat, name: ev.name };
  }

  notice(t) { if (this.onNotice) this.onNotice(t); }

  // ---- 戦闘 ----
  // 自分の攻撃の与ダメージ。base = 手順ごとの基本ダメージ。power = どの攻撃力か (atk / spAtk / ultAtk)、element = 攻撃の属性 (無属性は null)、
  // target = 相手の属性。rng は試験用。{ dmg, crit }
  rollAttack(base, { power = 'atk', element = null, target = null, rng = Math.random } = {}) {
    const crit = rng() < this.cur.crit;
    let d = base * this.cur[power] / 100 * elementMul(element, target);
    if (crit) d *= this.cur.critDmg;
    return { dmg: d, crit };
  }

  // 受けるダメージ。base = 基本の量、element = 攻撃の属性 (無属性は null)。耐性は加護から (まだ 0)
  hurtAmount(base, element = null) {
    return base * 100 / (100 + this.cur.def);
  }

  // ---- スタミナ ----
  get staminaFrac() { return this.stamina / this.cur.stamina; }
  canDash() { return !this.winded && this.stamina > 0; }
  canSpend() { return !this.winded; }
  cost(c) { return c * (1 - this.cur.staSave); }
  drainDash(dt) { this.spend(this.cost(COST.dash) * dt, true); }
  // 使う (足りなければ 0 になる。0 になったら息切れ)。raw = true のときは軽減済みの量
  spend(n, raw = false) {
    this.stamina = Math.max(0, this.stamina - (raw ? n : this.cost(n)));
    this.delay = REGEN_DELAY;
    if (this.stamina <= 0) this.winded = true;
  }
  refill() { this.stamina = this.cur.stamina; this.winded = false; this.delay = 0; }

  // 毎フレーム: 回復・技ゲージの時間回復
  tick(dt) {
    if (this.delay > 0) this.delay -= dt;
    else this.stamina = Math.min(this.cur.stamina, this.stamina + this.cur.staRegen * dt);
    if (this.winded && this.stamina >= Math.min(WIND_OK, this.cur.stamina)) this.winded = false;
    this.skill = Math.min(this.cur.spGauge, this.skill + this.cur.spRegen * dt);
  }

  // 必殺ゲージを溜める (当てる・倒す・被弾)。使い道 (必殺技) はまだ無い
  gainUlt(n) { this.ult = Math.min(this.cur.ultGauge, this.ult + n * this.cur.ultGain); }
}

// 表示用: 項目の値を文字にする
export function fmtStat(k, v) {
  const f = STATS[k].fmt;
  if (f === 'p') return (v * 100).toFixed(1).replace(/\.0$/, '') + '%';
  if (f === 'x') return '×' + v.toFixed(2).replace(/0$/, '');
  if (f === 's') return v.toFixed(2).replace(/0$/, '') + ' 秒';
  if (f === 'r') return v.toFixed(1).replace(/\.0$/, '') + ' /秒';
  return String(Math.round(v * 10) / 10).replace(/\.0$/, '');
}
