// 街を歩く人の動き (issue #64)。描画 (three.js) には依存しない: crowd.js が結果を描き、tools/dev/crowdcheck.mjs が数字を確かめる。
// 通り道 (lanes) は tools/build_props.py の build_crowd() が props.json の crowd に書く。人はプレイヤーの周りだけに出し入れする
// (街全体は動かさない)。当たり判定は持たず、プレイヤーが近づくと減速して横へよける (押しも止めもしない)。

export const KIND_W = { f: 0.8, s: 1.0, r: 0.35, d: 0.9, t: 0.55 };   // 通り道の種類ごとの人の出やすさ (歩道・小道 / 幹線の歩道 / 歩道の無い道の端 / デッキ・坂 / 階段)
const SAMPLE = 6;          // 出る場所の候補の間隔 (m)
const CELL = 50;           // 候補を入れる区画の大きさ (m)
const JOIN = 9;            // 通り道の端から、つながる別の通り道を探す距離 (m)
const SPAWN_NEAR = 25;     // 歩いている途中で出す場所は、中心からこれより遠く (m)
const AVOID_R = 1.7;       // プレイヤーがこれより近いとよける (m)
const CROSS_GAP = 3.5;     // 乗り換えのずれがこれより大きければ、道を渡る (信号を見る) (m)
const SIG_NEAR = 16;       // 渡る道の信号を探す距離 (m)
const MAX_WAIT = 60;       // 信号待ちの上限 (秒。これを過ぎたら渡る)
// 歩行者用信号の色。detail/street.js の update() と同じ式 (GREEN 22 s・黄 3 s・全赤 2 s)。'g' 青 / 'o' 青の点滅 / 'r' 赤
const GREEN = 22, YELLOW = 3, ALLRED = 2, HALF = GREEN + YELLOW + ALLRED, CYCLE = HALF * 2, PED_FLASH = 4;
export function pedState(t, it) {
  const u = ((((t + it.offset) % CYCLE) + CYCLE) % CYCLE - (it.axis ? 0 : HALF) + CYCLE) % CYCLE;
  return u < GREEN - PED_FLASH ? 'g' : u < GREEN ? (Math.floor(t * 2) % 2 ? 'g' : 'o') : 'r';
}
// 動きの種類 (描画の姿勢): 0 歩く / 1 スマホを見る (両手を胸の前) / 2 立ち話 (手を少し動かす) / 3 待つ (立つだけ)
export const MODE = { walk: 0, phone: 1, chat: 2, wait: 3 };

// 時間帯ごとの決まり。level = 人の多さ (0〜1)、flow = 駅へ向かう (+) / 駅から来る (-) 流れの強さ、pub = 居酒屋の前に集まる度合い、mix = 種類の割合
// 種類: 0 学生 1 スーツ 2 私服 3 子ども 4 高齢者
export const PRESET = {
  朝: { level: 0.75, flow: 0.8, pub: 0.05, mix: [0.22, 0.40, 0.25, 0.04, 0.09] },
  昼: { level: 0.55, flow: 0.0, pub: 0.10, mix: [0.06, 0.16, 0.40, 0.10, 0.28] },
  夕方: { level: 0.95, flow: -0.7, pub: 0.35, mix: [0.20, 0.30, 0.30, 0.06, 0.14] },
  夜: { level: 0.40, flow: -0.2, pub: 1.00, mix: [0.03, 0.30, 0.55, 0.00, 0.12] },
};
const SPEED = [1.45, 1.5, 1.25, 1.3, 0.95];   // 種類ごとの歩く速さ (m/s)
const SCALE = [0.99, 1.0, 1.0, 0.72, 0.95];   // 背の高さ (1 = 約 1.65 m)
const CHAT_RATE = 0.06;      // 出すときに、立ち話の 2 人組にする割合
const PHONE_RATE = 0.004;    // 0.5 秒ごとの、スマホを見て立ち止まる確率 (約 2 分に 1 回)

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex = (h) => h;
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];

const HAIR = ['#1b1612', '#2a1d16', '#3b2a1e', '#171717', '#4a3426'];
const SKIN = ['#f3d2bd', '#eec3a6', '#e5b594', '#f6dcc9'];
const JEANS = ['#3d5a80', '#2f4a6b', '#4b4f58', '#8a7a5a', '#26282e'];
const TOP_BRIGHT = ['#d9534f', '#e8a33d', '#4aa3df', '#5cb85c', '#9b6bd1', '#f2f2f2', '#e07aa0', '#2f7f8f'];
const TOP_QUIET = ['#c9b79c', '#9aa5a8', '#a3b08f', '#8e7f9a', '#b08a7a'];
const SUIT = ['#2b2e38', '#1f2a44', '#3a3a3f', '#2a3a30'];
const KID = ['#f4c430', '#e4572e', '#2f8fe0', '#58b368', '#f28cb1'];

// 種類ごとの色 (人ごとに乱数で決める)
export function outfit(type, r) {
  const o = { top: '#888', bottom: '#444', hair: pick(r, HAIR), skin: pick(r, SKIN) };
  if (type === 0) { o.top = pick(r, ['#26324d', '#2d3550', '#3b3f4a']); o.bottom = pick(r, ['#4a4f5c', '#3a3d4a', '#2d3550']); }
  else if (type === 1) { o.top = pick(r, SUIT); o.bottom = r() < 0.8 ? o.top : pick(r, SUIT); }
  else if (type === 2) { o.top = pick(r, TOP_BRIGHT); o.bottom = pick(r, JEANS); }
  else if (type === 3) { o.top = pick(r, KID); o.bottom = pick(r, ['#2f4a6b', '#4b4f58', '#8a7a5a']); }
  else { o.top = pick(r, TOP_QUIET); o.bottom = pick(r, ['#5a5a60', '#6b5a48', '#3d4350']); o.hair = pick(r, ['#d8d8d8', '#bdbdbd', '#8a8a8a', '#3b3b3b']); }
  return o;
}

export class CrowdSim {
  // crowd = props.crowd ({lanes, hubs})、opt = { cap, radius, seed, height: (x, z) => 地面の高さ (描画側が使う) }
  constructor(crowd, opt = {}) {
    this.cap = opt.cap ?? 120;
    this.R = opt.radius ?? 130;
    this.rnd = rng(opt.seed ?? 1);
    this.hubs = crowd.hubs || { st: [], pub: [] };
    this.ground = opt.ground || (() => 0);   // 地面の高さ (描画と同じ)
    this.peds = opt.peds || [];              // props.pedSignals
    this.busStops = (opt.busStops || []).map((b, i) => ({ id: i, x: b.x, z: b.z }));
    this.clock = 0;                          // 信号の時計 (秒。detail/street.js と同じ時計 = clock.elapsedTime)
    this.lanes = crowd.lanes.map((l) => {
      const n = l.p.length / 2, cum = new Float32Array(n);
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(l.p[2 * i] - l.p[2 * i - 2], l.p[2 * i + 1] - l.p[2 * i - 1]);
      return { k: l.k, w: l.w, p: Float32Array.from(l.p), y: l.y ? Float32Array.from(l.y) : null, cum, len: cum[n - 1], n, lat: Math.min(0.45, l.w * 0.25) };
    });
    // 出る場所の候補 (SAMPLE m おき) と、通り道の端の索引
    this.samples = []; this.cells = new Map(); this.ends = new Map();
    const stD = (x, z) => this.hubs.st.reduce((m, h) => Math.min(m, Math.hypot(x - h[0], z - h[1])), 1e9);
    const pubK = (x, z) => this.hubs.pub.reduce((s, h) => s + Math.exp(-(((x - h[0]) ** 2 + (z - h[1]) ** 2) / (45 * 45))), 0);
    this.lanes.forEach((L, li) => {
      for (let s = SAMPLE / 2; s < L.len; s += SAMPLE) {
        const [x, z] = this.at(L, s);
        const base = (KIND_W[L.k] ?? 0.5) * (0.25 + 1.5 * Math.exp(-stD(x, z) / 350));
        const sm = { lane: li, s, x, z, w: base, pub: (KIND_W[L.k] ?? 0.5) * pubK(x, z) * 2.5 };
        this.samples.push(sm);
        const key = Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
        (this.cells.get(key) || this.cells.set(key, []).get(key)).push(sm);
      }
      for (const e of [0, 1]) {
        const x = e ? L.p[2 * L.n - 2] : L.p[0], z = e ? L.p[2 * L.n - 1] : L.p[1];
        const key = Math.floor(x / JOIN) + ',' + Math.floor(z / JOIN);
        (this.ends.get(key) || this.ends.set(key, []).get(key)).push({ lane: li, end: e, x, z, y: this.endY(L, e) });
      }
    });
    this.stopGrid = new Map();
    for (const b of this.busStops) { const key = Math.floor(b.x / 10) + ',' + Math.floor(b.z / 10); (this.stopGrid.get(key) || this.stopGrid.set(key, []).get(key)).push(b); }
    this.people = [];
    this.preset = '昼';
    this.cand = []; this.candW = []; this.candSum = 0; this.sumW = 0;
    this.lastRefresh = { x: 1e9, z: 1e9, t: -1 };
    this.time = 0;
    this.stats = { spawned: 0, removed: 0, turns: 0, joins: 0, entered: 0, waits: 0, bus: 0, phone: 0, chats: 0 };
  }

  // 通り道の s の所の位置と進む向き (+ 向き)
  at(L, s, out) {
    s = clamp(s, 0, L.len);
    let lo = 0, hi = L.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L.cum[m] <= s) lo = m; else hi = m; }
    const x0 = L.p[2 * lo], z0 = L.p[2 * lo + 1], x1 = L.p[2 * hi], z1 = L.p[2 * hi + 1];
    const d = L.cum[hi] - L.cum[lo] || 1, t = (s - L.cum[lo]) / d;
    const o = out || [0, 0, 0, 0, 0];
    o[0] = x0 + (x1 - x0) * t; o[1] = z0 + (z1 - z0) * t; o[2] = (x1 - x0) / d; o[3] = (z1 - z0) / d;
    o[4] = L.y ? L.y[lo] + (L.y[hi] - L.y[lo]) * t + 0.05 : this.ground(o[0], o[1]);   // 高さ: デッキ・階段は通り道の値 + 路面の厚み、地面は地形
    return o;
  }

  // 通り道の端 (e = 0 始まり / 1 終わり) の高さ。デッキ・階段は通り道の値、地面は地形
  endY(L, e) { return L.y ? L.y[e ? L.n - 1 : 0] + 0.05 : this.ground(e ? L.p[2 * L.n - 2] : L.p[0], e ? L.p[2 * L.n - 1] : L.p[1]); }

  stationDist(x, z) { let m = 1e9; for (const h of this.hubs.st) m = Math.min(m, Math.hypot(x - h[0], z - h[1])); return m; }

  // 中心の周りの候補を作り直す (0.5 秒ごと・15 m 動いたとき)
  refresh(cx, cz, force = false) {
    const lr = this.lastRefresh;
    if (!force && this.time - lr.t < 0.5 && Math.hypot(cx - lr.x, cz - lr.z) < 15) return;
    this.lastRefresh = { x: cx, z: cz, t: this.time };
    const P = PRESET[this.preset] || PRESET.昼, R = this.R;
    this.cand = []; this.candW = []; let sum = 0, sumW = 0;
    for (let ix = Math.floor((cx - R) / CELL); ix <= Math.floor((cx + R) / CELL); ix++) {
      for (let iz = Math.floor((cz - R) / CELL); iz <= Math.floor((cz + R) / CELL); iz++) {
        const list = this.cells.get(ix + ',' + iz);
        if (!list) continue;
        for (const sm of list) {
          const d = Math.hypot(sm.x - cx, sm.z - cz);
          if (d > R) continue;
          sumW += sm.w;
          const w = sm.w + P.pub * sm.pub;
          this.cand.push(sm); this.candW.push(w); sum += w;
        }
      }
    }
    this.candSum = sum; this.sumW = sumW;
  }

  // 今の人数の目標。中心の周りの通り道の「人の出やすさ」の合計が、駅前の約 6 割に満たなければ、少なくする (住宅街は人が少ない)
  target() {
    const P = PRESET[this.preset] || PRESET.昼;
    return Math.round(this.cap * P.level * clamp(this.sumW / REF_SUMW, 0.08, 1));
  }

  // 重みつきで候補を 1 つ選ぶ (近すぎる所・見えている所は避ける)
  pickSpawn(cx, cz, fx, fz, anywhere) {
    if (!this.cand.length || this.candSum <= 0) return null;
    for (let t = 0; t < 8; t++) {
      let u = this.rnd() * this.candSum, i = 0;
      while (i < this.cand.length - 1 && (u -= this.candW[i]) > 0) i++;
      const sm = this.cand[i], dx = sm.x - cx, dz = sm.z - cz, d = Math.hypot(dx, dz);
      if (anywhere) { if (d > 4) return sm; continue; }
      if (d < SPAWN_NEAR) continue;
      // 見えている範囲 (前向き ±40°) で、70 m より近い所には出さない (急に現れて見えるため)
      if (d < 70 && fx !== undefined && (dx * fx + dz * fz) / d > 0.77) continue;
      return sm;
    }
    return null;
  }

  makePerson(sm) {
    const r = this.rnd, P = PRESET[this.preset] || PRESET.昼;
    let u = r(), type = 0;
    for (let i = 0; i < 5; i++) { u -= P.mix[i]; if (u <= 0) { type = i; break; } type = i; }
    const L = this.lanes[sm.lane];
    // 向き: 駅へ向かう流れ (flow > 0) か、駅から来る流れ (flow < 0) に寄せる
    const a = this.at(L, sm.s), far = this.at(L, clamp(sm.s + 20, 0, L.len)), near = this.at(L, clamp(sm.s - 20, 0, L.len));
    const gain = this.stationDist(near[0], near[1]) - this.stationDist(far[0], far[1]); // + なら + 向きが駅へ近づく
    let dir = r() < 0.5 ? 1 : -1;
    if (Math.abs(gain) > 6 && r() < Math.abs(P.flow)) dir = (gain > 0) === (P.flow > 0) ? 1 : -1;
    let sp = SPEED[type] * (0.88 + r() * 0.24);
    if (this.preset === '朝' && type === 1) sp *= 1.12;
    const o = outfit(type, r);
    return {
      id: ++this.nextId, type, lane: sm.lane, s: sm.s, dir, speed: sp, v: sp,
      x: a[0], z: a[1], y: a[4], yaw: Math.atan2(dir * a[2], dir * a[3]), phase: r() * 6.28, amp: 0.7, scale: SCALE[type] * (type === 3 ? 0.9 + r() * 0.2 : 0.95 + r() * 0.1),
      jit: (r() - 0.5) * 0.2, ox: 0, oz: 0, ax: 0, az: 0, o,
      mode: MODE.walk, hold: false, holdUntil: 0, pending: null, lastStop: -1, checkAt: this.time + r() * 0.5, faceYaw: null,
    };
  }

  // 立ち話の 2 人 (地面かデッキの通り道の途中に、向かい合って立つ。しばらくして歩き出す)
  spawnChat(sm) {
    const L = this.lanes[sm.lane];
    if (L.k === 't' || sm.s < 2 || sm.s > L.len - 2) return null;
    const a = this.makePerson(sm), b = this.makePerson({ ...sm, s: sm.s + 1.0 });
    const pa = this.at(L, sm.s), pb = this.at(L, sm.s + 1.0), yaw = Math.atan2(pb[0] - pa[0], pb[1] - pa[1]);
    const until = this.time + 15 + this.rnd() * 40;
    for (const [p, q, dir, ya] of [[a, pa, 1, yaw], [b, pb, -1, yaw + Math.PI]]) {
      Object.assign(p, { x: q[0], z: q[1], y: q[4], dir, yaw: ya, v: 0, hold: true, holdUntil: until, mode: MODE.chat, faceYaw: ya, jit: 0, type: p.type === 3 ? 2 : p.type });
      p.scale = SCALE[p.type] * (0.95 + this.rnd() * 0.1);
    }
    return [a, b];
  }

  // 通り道の端に来た人の、つぎの通り道 (9 m 以内で、高さが 1.2 m 以内の別の通り道の端。無ければ引き返す)
  nextLane(p) {
    const L = this.lanes[p.lane], e = p.dir > 0 ? 1 : 0;
    const ex = e ? L.p[2 * L.n - 2] : L.p[0], ez = e ? L.p[2 * L.n - 1] : L.p[1], ey = this.endY(L, e);
    const P = PRESET[this.preset] || PRESET.昼;
    const cands = [];
    for (let ix = Math.floor((ex - JOIN) / JOIN); ix <= Math.floor((ex + JOIN) / JOIN); ix++) {
      for (let iz = Math.floor((ez - JOIN) / JOIN); iz <= Math.floor((ez + JOIN) / JOIN); iz++) {
        for (const c of this.ends.get(ix + ',' + iz) || []) {
          if (c.lane === p.lane || Math.hypot(c.x - ex, c.z - ez) > JOIN || Math.abs(c.y - ey) > 1.2) continue;
          const N = this.lanes[c.lane], fx = c.end ? N.p[0] : N.p[2 * N.n - 2], fz = c.end ? N.p[1] : N.p[2 * N.n - 1];
          const prog = clamp((this.stationDist(c.x, c.z) - this.stationDist(fx, fz)) / 50, -1, 1); // + = その先は駅へ近づく
          cands.push({ c, w: Math.max(0.15, (KIND_W[N.k] ?? 0.5) * (1 + P.flow * prog * 0.8)) });
        }
      }
    }
    if (!cands.length) {
      if (this.stationDist(ex, ez) < 80) { p.gone = true; this.stats.entered++; return; }   // 駅の近くで行き止まり = 駅へ入った (消す)
      p.dir = -p.dir; this.stats.turns++; return;
    }
    let u = this.rnd() * cands.reduce((s, c) => s + c.w, 0), pickd = cands[0];
    for (const c of cands) { if ((u -= c.w) <= 0) { pickd = c; break; } }
    const gap = Math.hypot(pickd.c.x - ex, pickd.c.z - ez);
    if (gap > CROSS_GAP) {            // 道を渡る: 近くの歩行者用信号が赤なら、青になるまで待つ
      const sig = this.signalFor(ex, ez, pickd.c.x, pickd.c.z);
      if (sig && pedState(this.clock, sig) !== 'g') {
        p.pending = { c: pickd.c, ex, ez, sig, since: this.time };
        p.hold = true; p.holdUntil = Infinity; p.mode = MODE.wait;
        this.stats.waits++;
        return;
      }
    }
    this.join(p, pickd.c, ex, ez);
  }

  join(p, c, ex, ez) {
    const N = this.lanes[c.lane];
    p.ox += ex - c.x; p.oz += ez - c.z;          // 乗り換えで飛ばないよう、ずれを残して少しずつ消す
    p.lane = c.lane; p.dir = c.end ? -1 : 1; p.s = c.end ? N.len : 0;
    this.stats.joins++;
  }

  // 渡る線 (E → C) にいちばん近い歩行者用信号 (SIG_NEAR 以内)
  signalFor(ex, ez, cx, cz) {
    let best = null, bd = 6;     // 渡る線から 6 m 以内
    const dx = cx - ex, dz = cz - ez, l2 = dx * dx + dz * dz || 1;
    for (const s of this.peds) {
      if (Math.abs(s.x - ex) > SIG_NEAR || Math.abs(s.z - ez) > SIG_NEAR) continue;
      const t = clamp(((s.x - ex) * dx + (s.z - ez) * dz) / l2, 0, 1), d = Math.hypot(s.x - ex - dx * t, s.z - ez - dz * t);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  nearStop(x, z) {
    for (let ix = Math.floor((x - 5) / 10); ix <= Math.floor((x + 5) / 10); ix++) {
      for (let iz = Math.floor((z - 5) / 10); iz <= Math.floor((z + 5) / 10); iz++) {
        for (const b of this.stopGrid.get(ix + ',' + iz) || []) if (Math.hypot(b.x - x, b.z - z) < 4.5) return b;
      }
    }
    return null;
  }

  // dt 秒進める。(cx, cz) = 出し入れの中心 (カメラの少し先)、(fx, fz) = カメラの向き (地面での単位ベクトル)、(px, pz) = プレイヤー (よけるため)、clock = 信号の時計 (秒)
  update(dt, cx, cz, fx, fz, px, pz, preset, clock) {
    this.time += dt;
    this.clock = clock ?? this.time;
    if (preset && preset !== this.preset) { this.preset = preset; this.lastRefresh.t = -1; }
    dt = Math.min(dt, 0.1);
    const jumped = Math.hypot(cx - this.lastRefresh.x, cz - this.lastRefresh.z) > 80;
    this.refresh(cx, cz, jumped);
    const tgt = this.target();
    // 出す・消す
    if (!this.nextId) this.nextId = 0;
    const spawnOne = (anywhere) => {
      const sm = this.pickSpawn(cx, cz, fx, fz, anywhere);
      if (!sm) return;
      if (this.rnd() < CHAT_RATE && this.people.length + 2 <= tgt + 2) {
        const pair = this.spawnChat(sm);
        if (pair) { this.people.push(...pair); this.stats.spawned += 2; this.stats.chats++; return; }
      }
      this.people.push(this.makePerson(sm)); this.stats.spawned++;
    };
    if (jumped) {
      this.stats.removed += this.people.length; this.people.length = 0;
      for (let i = 0; i < tgt && this.people.length < tgt; i++) spawnOne(true);
    } else {
      this.spawnAcc = (this.spawnAcc || 0) + dt * 5;       // 1 秒に最大 5 人まで増やす
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        if (this.people.length >= tgt) { this.spawnAcc = 0; break; }
        spawnOne(false);
      }
      // 目標より多いとき: 遠くて見えていない人から、1 秒に最大 3 人まで減らす
      if (this.people.length > tgt) {
        this.killAcc = (this.killAcc || 0) + dt * 3;
        while (this.killAcc >= 1 && this.people.length > tgt) {
          this.killAcc -= 1;
          let bi = -1, bd = 45;
          this.people.forEach((p, i) => { const d = Math.hypot(p.x - cx, p.z - cz); if (d > bd && (((p.x - cx) * fx + (p.z - cz) * fz) / d < 0.5 || d > 100)) { bd = d; bi = i; } });
          if (bi < 0) break;
          this.people.splice(bi, 1); this.stats.removed++;
        }
      } else this.killAcc = 0;
    }
    // 動かす
    const R2 = (this.R + 20) ** 2;
    for (let i = this.people.length - 1; i >= 0; i--) {
      const p = this.people[i];
      if ((p.x - cx) ** 2 + (p.z - cz) ** 2 > R2) { this.people.splice(i, 1); this.stats.removed++; continue; }
      this.step(p, dt, px, pz);
      if (p.gone) { this.people.splice(i, 1); this.stats.removed++; }
    }
  }

  step(p, dt, px, pz) {
    // 立ち止まっている間 (信号待ち・バス停・スマホ・立ち話)
    if (p.pending) {
      const w = p.pending;
      if (pedState(this.clock, w.sig) === 'g' || this.time - w.since > MAX_WAIT) { this.join(p, w.c, w.ex, w.ez); p.pending = null; p.hold = false; p.mode = MODE.walk; }
    } else if (p.hold && this.time >= p.holdUntil) { p.hold = false; p.mode = MODE.walk; p.faceYaw = null; }
    else if (!p.hold && this.time >= p.checkAt) {
      p.checkAt = this.time + 0.5;
      const L = this.lanes[p.lane];
      if (L.k !== 't' && Math.abs(p.ox) + Math.abs(p.oz) < 0.3) {   // 階段の上・道を渡っている最中は止まらない
        const b = this.nearStop(p.x, p.z);
        if (b && b.id !== p.lastStop) { p.lastStop = b.id; if (this.rnd() < 0.2) { p.hold = true; p.holdUntil = this.time + 8 + this.rnd() * 16; p.mode = MODE.wait; this.stats.bus++; } }
        else if (this.rnd() < PHONE_RATE) { p.hold = true; p.holdUntil = this.time + 4 + this.rnd() * 9; p.mode = MODE.phone; this.stats.phone++; }
      }
    }
    // プレイヤーが近いと減速して横へよける
    let slow = 1, tx = 0, tz = 0;
    if (px !== undefined) {
      const dx = p.x - px, dz = p.z - pz, d = Math.hypot(dx, dz);
      if (d < AVOID_R) { slow = clamp((d - 0.5) / (AVOID_R - 0.5), 0.35, 1); tx = dx / (d || 1) * (AVOID_R - d) * 0.8; tz = dz / (d || 1) * (AVOID_R - d) * 0.8; }
    }
    const L0 = this.lanes[p.lane];
    const want0 = p.hold ? 0 : p.speed * slow * (L0.k === 't' ? 0.8 : 1);
    p.v += (want0 - p.v) * (1 - Math.exp(-dt * 6));
    if (p.v < 0.02 && p.hold) p.v = 0;
    p.s += p.dir * p.v * dt;
    for (let guard = 0; guard < 3 && !p.pending; guard++) {
      const L = this.lanes[p.lane];
      if (p.s >= L.len && p.dir > 0 || p.s <= 0 && p.dir < 0) { p.s = clamp(p.s, 0, L.len); this.nextLane(p); } else break;
    }
    const L = this.lanes[p.lane], a = this.at(L, p.s);
    // 右側通行 (進む向きの右へ少しずれる)
    const t0x = a[2] * p.dir, t0z = a[3] * p.dir, lat = L.lat + p.jit;
    let x = a[0] + t0z * lat, z = a[1] - t0x * lat;
    // 乗り換えのずれを、歩く速さで消していく
    const od = Math.hypot(p.ox, p.oz);
    if (od > 1e-4) { const k = Math.max(0, 1 - Math.max(p.v, 0.6) * dt / od); p.ox *= k; p.oz *= k; }
    p.ax += (tx - p.ax) * (1 - Math.exp(-dt * 6)); p.az += (tz - p.az) * (1 - Math.exp(-dt * 6));
    x += p.ox + p.ax; z += p.oz + p.az;
    // 向きはなめらかに変える (立ち話は相手の方を向く)
    const mx = x - p.x, mz = z - p.z;
    const want = p.faceYaw !== null ? p.faceYaw : (Math.hypot(mx, mz) > 1e-4 && p.v > 0.1) ? Math.atan2(mx, mz) : p.hold ? p.yaw : Math.atan2(t0x, t0z);
    p.yaw += Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw)) * (1 - Math.exp(-dt * 8));
    p.x = x; p.z = z; p.y = a[4];
    p.phase += dt * (p.hold ? (p.mode === MODE.chat ? 2.2 : 0) : p.v * (Math.PI * 2 / 1.4));
    p.amp = p.hold ? (p.mode === MODE.chat ? 0.35 : 0) : clamp(p.v / 1.5, 0, 1) * 0.75;
  }
}

export const REF_SUMW = 500;   // 人が多い所 (駅前・国道) での出やすさの合計の目安 (tools/dev/crowdcheck.mjs で測って決めた)
