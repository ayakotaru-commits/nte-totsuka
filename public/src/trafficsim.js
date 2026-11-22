// 街を走る車の動き (issue #64 第 3 段階)。描画 (three.js) には依存しない: traffic.js が結果を描き、tools/dev/trafficcheck.mjs が数字を確かめる。
// 道 (lanes) は tools/build_props.py の build_traffic() が props.json の traffic に書く (左側通行の車線。交差点 a → b の向き)。
// 車はプレイヤー (カメラの少し先) の周りだけに出し入れする。前の車との間をあけ、信号 (props.signals) の赤で止まり、
// プレイヤーが前にいれば止まる (当たり判定は持たない)。交差点の中で行き違う車どうしの衝突は見ていない。

const KIND_V = { trunk: 12.5, trunk_link: 9, primary: 11, secondary: 10, tertiary: 9, residential: 6.5, unclassified: 6.5, living_street: 4 };  // 出す速さ (m/s)
const KIND_W = { trunk: 3, trunk_link: 1.5, primary: 2.5, secondary: 2, tertiary: 1.5, residential: 0.8, unclassified: 0.7, living_street: 0.3 };   // 車の出やすさ・曲がる先の選ばれやすさ
const KIND_D = { trunk: 3, trunk_link: 1.5, primary: 2.5, secondary: 2, tertiary: 1.2, residential: 0.2, unclassified: 0.15, living_street: 0.05 };   // 道ごとの車の数の多さ (台数の目標・出る場所の選びやすさ)
const SAMPLE = 10;       // 出る場所の候補の間隔 (m)
const CELL = 60;
const SPAWN_NEAR = 35;   // 歩いている途中で出す場所は、中心からこれより遠く (m)
const SIG_R = 16;        // 交差点の中心から信号を探す距離 (m)
const STOP = 3.0;        // 車線の終わり (交差点の中心) からこれ手前で止まる (m)
const LOOK = 40;         // 先の車を見る距離 (m)
export const REF_SUMW = 200;   // 車が多い所での出やすさの合計の目安 (tools/dev/trafficcheck.mjs で測って決めた)

// 時間帯ごとの車の多さ (0〜1)
export const TPRESET = { 朝: { level: 0.85 }, 昼: { level: 0.5 }, 夕方: { level: 1.0 }, 夜: { level: 0.25 } };

// 車の種類: 長さ・幅・背の高さの倍率・出る割合
const TYPES = [
  { name: 'sedan', len: 4.3, wid: 1.72, hgt: 1.0, p: 0.52 },
  { name: 'kei', len: 3.4, wid: 1.48, hgt: 1.05, p: 0.18 },
  { name: 'van', len: 4.8, wid: 1.85, hgt: 1.2, p: 0.15 },
  { name: 'truck', len: 5.6, wid: 2.0, hgt: 1.45, p: 0.09 },
  { name: 'bus', len: 10.5, wid: 2.5, hgt: 1.9, p: 0.06 },   // 幹線だけ
];
const COLORS = ['#f2f2f2', '#f2f2f2', '#f2f2f2', '#1d1e22', '#1d1e22', '#b9bcc2', '#b9bcc2', '#7d8087', '#26344f', '#a32d2d', '#2d5a8a', '#c9b99a', '#3d5a3f'];

// 車両用信号の色 (detail/street.js の state() と同じ式。GREEN 22 s・黄 3 s・全赤 2 s)
const GREEN = 22, YELLOW = 3, ALLRED = 2, HALF = GREEN + YELLOW + ALLRED, CYCLE = HALF * 2;
export function vehState(t, it) {
  const u = (((t + it.offset) % CYCLE) + CYCLE) % CYCLE - (it.axis ? HALF : 0);
  const v = (u + CYCLE) % CYCLE;
  return v < GREEN ? 'green' : v < GREEN + YELLOW ? 'yellow' : 'red';
}

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class TrafficSim {
  // traffic = props.traffic ({lanes, nodes})、opt = { cap, radius, seed, ground, signals }
  constructor(traffic, opt = {}) {
    this.cap = opt.cap ?? 40;
    this.R = opt.radius ?? 130;
    this.rnd = rng(opt.seed ?? 1);
    this.ground = opt.ground || (() => 0);
    this.nodes = traffic.nodes;
    this.lanes = traffic.lanes.map((l) => {
      const n = l.p.length / 2, cum = new Float32Array(n);
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(l.p[2 * i] - l.p[2 * i - 2], l.p[2 * i + 1] - l.p[2 * i - 1]);
      return { k: l.k, w: l.w, a: l.a, b: l.b, p: Float32Array.from(l.p), y: l.y ? Float32Array.from(l.y) : null, cum, len: cum[n - 1], n, vmax: KIND_V[l.k] ?? 6, kw: KIND_W[l.k] ?? 0.5, dens: KIND_D[l.k] ?? 0.2, sig: null, car: [] };
    });
    this.out = new Map();    // 交差点 → そこから出る車線
    this.lanes.forEach((L, i) => { (this.out.get(L.a) || this.out.set(L.a, []).get(L.a)).push(i); });
    // 信号: 車線の終わり (交差点) のいちばん近い信号から、その車線の信号の組 (axis・offset) を決める。
    // 信号の向きが車線と平行 (向かってくる側か、背を向けた側かは問わない。向かい合う車線は同じ組) ならその信号の axis、
    // 直角ならもう一方の axis。OSM の信号は 1 つの交差点に 1〜3 個しかなく、車線ごとには無いため
    this.signals = opt.signals || [];
    this.signalNodes = 0;
    this.lanes.forEach((L) => {
      const e = this.at(L, L.len), nx = this.nodes[L.b][0], nz = this.nodes[L.b][1];
      let best = null, bd = 1e9;
      for (const s of this.signals) {
        const d = Math.hypot(s.x - nx, s.z - nz);
        if (d <= SIG_R && d < bd) { bd = d; best = s; }
      }
      if (!best) return;
      const dot = Math.abs(Math.sin(best.yaw) * e[2] + Math.cos(best.yaw) * e[3]);
      this.signalNodes++;
      if (dot >= 0.6) L.sig = best;
      else if (dot <= 0.4) L.sig = { axis: 1 - best.axis, offset: best.offset };
    });
    this.samples = []; this.cells = new Map();
    this.lanes.forEach((L, li) => {
      for (let s = SAMPLE / 2; s < L.len - 4; s += SAMPLE) {
        const o = this.at(L, s), sm = { lane: li, s, x: o[0], z: o[1], w: L.dens };
        this.samples.push(sm);
        const key = Math.floor(sm.x / CELL) + ',' + Math.floor(sm.z / CELL);
        (this.cells.get(key) || this.cells.set(key, []).get(key)).push(sm);
      }
    });
    this.cars = []; this.preset = '昼'; this.time = 0; this.clock = 0; this.nextId = 0;
    this.cand = []; this.candSum = 0; this.sumW = 0; this.lastRefresh = { x: 1e9, z: 1e9, t: -1 };
    this.stats = { spawned: 0, removed: 0, turns: 0, uturns: 0, stops: 0 };
  }

  // 車線の s の所の位置・向き・高さ・傾き
  at(L, s, out) {
    s = clamp(s, 0, L.len);
    let lo = 0, hi = L.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L.cum[m] <= s) lo = m; else hi = m; }
    const x0 = L.p[2 * lo], z0 = L.p[2 * lo + 1], x1 = L.p[2 * hi], z1 = L.p[2 * hi + 1];
    const d = L.cum[hi] - L.cum[lo] || 1, t = (s - L.cum[lo]) / d;
    const o = out || [0, 0, 0, 0, 0];
    o[0] = x0 + (x1 - x0) * t; o[1] = z0 + (z1 - z0) * t; o[2] = (x1 - x0) / d; o[3] = (z1 - z0) / d;
    o[4] = L.y ? L.y[lo] + (L.y[hi] - L.y[lo]) * t + 0.05 : this.ground(o[0], o[1]);
    return o;
  }

  refresh(cx, cz, force = false) {
    const lr = this.lastRefresh;
    if (!force && this.time - lr.t < 0.5 && Math.hypot(cx - lr.x, cz - lr.z) < 15) return;
    this.lastRefresh = { x: cx, z: cz, t: this.time };
    const R = this.R; this.cand = []; let sum = 0;
    for (let ix = Math.floor((cx - R) / CELL); ix <= Math.floor((cx + R) / CELL); ix++) {
      for (let iz = Math.floor((cz - R) / CELL); iz <= Math.floor((cz + R) / CELL); iz++) {
        for (const sm of this.cells.get(ix + ',' + iz) || []) {
          if (Math.hypot(sm.x - cx, sm.z - cz) > R) continue;
          this.cand.push(sm); sum += sm.w;
        }
      }
    }
    this.candSum = sum; this.sumW = sum;
  }

  target() {
    const P = TPRESET[this.preset] || TPRESET.昼;
    return Math.round(this.cap * P.level * clamp(this.sumW / REF_SUMW, 0.04, 1));
  }

  // つぎに進む車線 (交差点 b から出る、逆戻りでない車線を、まっすぐ・幹線ほど選びやすく。無ければ引き返す)
  chooseNext(li) {
    const L = this.lanes[li], outs = (this.out.get(L.b) || []).filter((j) => j !== (li ^ 1));
    if (!outs.length) { this.stats.uturns++; return li ^ 1; }
    const e = this.at(L, L.len);
    let tot = 0; const ws = outs.map((j) => {
      const N = this.lanes[j], s0 = this.at(N, 0), cos = e[2] * s0[2] + e[3] * s0[3];
      const w = N.kw * (0.35 + Math.max(0, cos + 0.4)) ; tot += w; return w;
    });
    let u = this.rnd() * tot;
    for (let i = 0; i < outs.length; i++) if ((u -= ws[i]) <= 0) return outs[i];
    return outs[outs.length - 1];
  }

  pickType(lane) {
    let u = this.rnd();
    for (const t of TYPES) {
      if (t.name === 'bus' && !(lane.k === 'trunk' || lane.k === 'primary' || lane.k === 'secondary')) continue;
      if ((u -= t.p) <= 0) return t;
    }
    return TYPES[0];
  }

  makeCar(sm) {
    const L = this.lanes[sm.lane], t = this.pickType(L), r = this.rnd;
    const o = this.at(L, sm.s);
    const col = t.name === 'bus' ? '#2d6a4f' : COLORS[Math.floor(r() * COLORS.length)];
    return { id: ++this.nextId, lane: sm.lane, s: sm.s, v: L.vmax * 0.6, type: t.name, len: t.len, wid: t.wid, hgt: t.hgt, color: col, vf: 0.82 + r() * 0.2,
      next: -1, x: o[0], z: o[1], y: o[4], yaw: Math.atan2(o[2], o[3]), pitch: 0, ox: 0, oz: 0, braking: false };
  }

  // 出す場所を選ぶ (見えている範囲・近すぎる所・前の車が近い所は避ける)
  pickSpawn(cx, cz, fx, fz, anywhere) {
    if (!this.cand.length) return null;
    for (let t = 0; t < 10; t++) {
      const sm = this.cand[Math.floor(this.rnd() * this.cand.length)];
      if (this.rnd() * 3 > sm.w) continue;      // 出やすさ (幹線 3) で間引く
      const dx = sm.x - cx, dz = sm.z - cz, d = Math.hypot(dx, dz);
      if (anywhere) { if (d < 6) continue; } else {
        if (d < SPAWN_NEAR) continue;
        if (d < 80 && fx !== undefined && (dx * fx + dz * fz) / d > 0.77) continue;
      }
      if (this.lanes[sm.lane].car.some((c) => Math.abs(c.s - sm.s) < 14)) continue;
      return sm;
    }
    return null;
  }

  update(dt, cx, cz, fx, fz, px, pz, preset, clock) {
    this.time += dt; this.clock = clock ?? this.time;
    if (preset && preset !== this.preset) { this.preset = preset; this.lastRefresh.t = -1; }
    dt = Math.min(dt, 0.1);
    const jumped = Math.hypot(cx - this.lastRefresh.x, cz - this.lastRefresh.z) > 80;
    this.refresh(cx, cz, jumped);
    const tgt = this.target();
    const add = (sm) => { const c = this.makeCar(sm); c.next = this.chooseNext(c.lane); this.cars.push(c); this.lanes[c.lane].car.push(c); this.stats.spawned++; };
    if (jumped) {
      this.stats.removed += this.cars.length; this.cars.length = 0; this.lanes.forEach((L) => { L.car.length = 0; });
      for (let i = 0; i < tgt * 3 && this.cars.length < tgt; i++) { const sm = this.pickSpawn(cx, cz, fx, fz, true); if (sm) add(sm); }
    } else {
      this.spawnAcc = (this.spawnAcc || 0) + dt * 1.5;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        if (this.cars.length >= tgt) { this.spawnAcc = 0; break; }
        const sm = this.pickSpawn(cx, cz, fx, fz, false); if (sm) add(sm);
      }
      if (this.cars.length > tgt) {   // 目標より多いとき: 遠くて見えていない車を、1 秒に 1 台まで消す
        this.killAcc = (this.killAcc || 0) + dt;
        while (this.killAcc >= 1 && this.cars.length > tgt) {
          this.killAcc -= 1; let bi = -1, bd = 50;
          this.cars.forEach((c, i) => { const d = Math.hypot(c.x - cx, c.z - cz); if (d > bd && (((c.x - cx) * fx + (c.z - cz) * fz) / d < 0.5 || d > 100)) { bd = d; bi = i; } });
          if (bi < 0) break; this.remove(bi);
        }
      } else this.killAcc = 0;
    }
    // 車線ごとに、前の車から順に並べる
    for (const L of this.lanes) if (L.car.length > 1) L.car.sort((a, b) => b.s - a.s);
    const R2 = (this.R + 25) ** 2;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if ((c.x - cx) ** 2 + (c.z - cz) ** 2 > R2) { this.remove(i); continue; }
      this.step(c, dt, px, pz);
    }
  }

  remove(i) {
    const c = this.cars[i], list = this.lanes[c.lane].car, k = list.indexOf(c);
    if (k >= 0) list.splice(k, 1);
    this.cars.splice(i, 1); this.stats.removed++;
  }

  // 前にいちばん近い「止まる理由」までの距離 (車体の先から。m)。無ければ Infinity
  gapAhead(c, px, pz) {
    const L = this.lanes[c.lane];
    let gap = Infinity;
    // 同じ車線の前の車
    const k = L.car.indexOf(c);
    if (k > 0) { const f = L.car[k - 1]; gap = f.s - c.s - (f.len + c.len) / 2; }
    else {   // 先の車線 (つぎに入る車線) の最後尾
      const N = this.lanes[c.next], dEnd = L.len - c.s;
      if (N && dEnd < LOOK && N.car.length) { const f = N.car[N.car.length - 1]; gap = dEnd + f.s - (f.len + c.len) / 2; }
    }
    // 赤信号 (黄は、安全に止まれるときだけ止まる)
    if (L.sig) {
      const st = vehState(this.clock, L.sig);
      if (st !== 'green') {
        const g = L.len - STOP - c.s - c.len / 2;
        if (g > -1.5 && (st === 'red' || g > c.v * c.v / 7 + 1)) gap = Math.min(gap, Math.max(g, 0));
      }
    }
    // プレイヤーが前にいる
    if (px !== undefined) {
      const o = this.at(L, c.s), dx = px - o[0], dz = pz - o[1], ahead = dx * o[2] + dz * o[3], lat = Math.abs(-dx * o[3] + dz * o[2]);
      if (ahead > 0 && ahead < 16 && lat < 2.2) gap = Math.min(gap, ahead - 2.4 - c.len / 2);
    }
    return gap;
  }

  step(c, dt, px, pz) {
    const L = this.lanes[c.lane];
    const gap = this.gapAhead(c, px, pz);
    let vt = c.vf * L.vmax;
    vt = Math.min(vt, Math.max(0, (gap - 1.2) / 1.2));
    // 急な曲がりでは、手前で減速する
    if (c.next >= 0) {
      const N = this.lanes[c.next], e = this.at(L, L.len), s0 = this.at(N, 0), cos = e[2] * s0[2] + e[3] * s0[3];
      if (cos < 0.85) vt = Math.min(vt, Math.sqrt((cos < 0.2 ? 3.0 : 4.5) ** 2 + 2 * 2.0 * Math.max(0, L.len - c.s - 2)));
    }
    c.braking = vt < c.v - 0.3;
    c.v += clamp(vt - c.v, -5 * dt, 2.2 * dt);
    if (c.v < 0.03 && vt === 0) c.v = 0;
    c.s += c.v * dt;
    if (c.s >= L.len) {   // つぎの車線へ。位置のずれは少しずつ消す
      const e = this.at(L, L.len);
      const nl = c.next >= 0 ? c.next : this.chooseNext(c.lane), N = this.lanes[nl], s0 = this.at(N, 0);
      const k = L.car.indexOf(c); if (k >= 0) L.car.splice(k, 1);
      c.ox += e[0] - s0[0]; c.oz += e[1] - s0[1];
      c.s = c.s - L.len; c.lane = nl; N.car.push(c); N.car.sort((a, b) => b.s - a.s);
      c.next = this.chooseNext(nl); this.stats.turns++;
    }
    const L2 = this.lanes[c.lane], a = this.at(L2, c.s);
    const od = Math.hypot(c.ox, c.oz);
    if (od > 1e-4) { const k = Math.max(0, 1 - Math.max(c.v, 2) * dt * 1.1 / od); c.ox *= k; c.oz *= k; }
    const x = a[0] + c.ox, z = a[1] + c.oz;
    const mx = x - c.x, mz = z - c.z;
    const want = (Math.hypot(mx, mz) > 1e-3 && c.v > 0.3) ? Math.atan2(mx, mz) : Math.atan2(a[2], a[3]);
    c.yaw += Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw)) * (1 - Math.exp(-dt * 7));
    const b = this.at(L2, c.s + 1.5), b0 = this.at(L2, c.s - 1.5);
    c.pitch = Math.atan2(b[4] - b0[4], Math.max(0.5, c.s + 1.5 - Math.max(0, c.s - 1.5)));
    c.x = x; c.z = z; c.y = a[4];
  }
}
