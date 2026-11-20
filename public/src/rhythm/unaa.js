// お札まきの観客に加わる「うな○ー」(swarm/model.js の見た目を使う)。大吉を出すたびに 1 体ずつ、空から降りてきて見物に加わる。
// 加わったら、曲に合わせて跳ねて、両手を上げて盛り上がる。最大 MAX 体。立ち位置が足りなくなったら、同じ場所のそばに少しずらして重ねる。
import { Herd, Fx } from '../swarm/model.js';

const MAX = 90;
const DOTS = ['#ffd166', '#ff6b6b', '#fff3b0', '#f2789f'];
// 締めの一打の「全員ジャンプ」(秒)。人も同じ形で跳ぶ (jumpY)
export const JUMP_T = 0.85;
export const jumpY = (t, h = 2) => (t > 0 && t < JUMP_T ? h * Math.sin(Math.PI * t / JUMP_T) : 0);
// 凶のときの体当たり (秒): 走って寄る → ぶつかる → とぼとぼ帰る
const CH = { run: 0.55, bump: 0.3, back: 1.1, stop: 1.0 };

export class UnaaCrowd {
  // slots: [[x, z], ...] 加わる順の立ち位置。face: [x, z] 見る先
  constructor(scene, ground, slots, face) {
    this.ground = ground; this.face = face;
    this.slots = slots;
    this.herd = new Herd(scene, MAX);
    this.fx = new Fx(scene, 200, 1);
    this.list = [];
    this.fx.rings.visible = false;
  }
  get count() { return this.list.length; }
  clear() {
    for (const e of this.list) this.herd.hide(e.slot);
    this.list.length = 0; this.herd.flush();
  }
  // 1 体加える (満員なら false)
  add() {
    const i = this.list.length, n = this.slots.length;
    if (i >= MAX || !n) return false;
    let [x, z] = this.slots[i % n];
    if (i >= n) { const a = i * 2.4, r = 0.5 + 0.2 * Math.floor(i / n); x += Math.cos(a) * r; z += Math.sin(a) * r; } // 2 周目からは少しずらす
    this.list.push({ slot: i, x, z, gy: this.ground(x, z), t: 0, ph: Math.random() * 6, landed: false,
      yaw: Math.atan2(this.face[0] - x, this.face[1] - z) });
    return true;
  }
  // 全員がいっせいに跳ぶ (締めの一打)
  jumpAll() { this.jumpT = 0; this.jumpLanded = false; }
  // 凶: いちばん近い 3 体のうちの 1 体が、(tx, tz) へ走ってぶつかり、元の位置へ帰る。立っている子がいなければ false
  charge(tx, tz) {
    const c = this.list.filter((u) => u.landed && !u.ch).sort((a, b) => Math.hypot(a.x - tx, a.z - tz) - Math.hypot(b.x - tx, b.z - tz)).slice(0, 3);
    if (!c.length) return false;
    const u = c[Math.floor(Math.random() * c.length)];
    const dx = tx - u.x, dz = tz - u.z, L = Math.hypot(dx, dz) || 1;
    u.ch = { t: 0, dx: dx / L, dz: dz / L, D: Math.max(0, L - CH.stop), bumped: false };
    return true;
  }
  // 体当たりの 1 コマ: 位置・姿勢を返す
  chargePose(u, dt, ph) {
    const c = u.ch; c.t += dt;
    const { run, bump, back } = CH, T = c.t;
    const hx = u.x, hz = u.z, ex = hx + c.dx * c.D, ez = hz + c.dz * c.D;
    const base = { yaw: Math.atan2(c.dx, c.dz), s: 1, arm: 0.5, leg: 0.3 };
    if (T < run) {                                   // 前かがみで走る
      const k = T / run, q = k * k;
      return { ...base, x: hx + (ex - hx) * q, z: hz + (ez - hz) * q, y: u.gy + Math.abs(Math.sin(T * 24)) * 0.22, pitch: 0.35, reach: 1.3, swL: Math.sin(T * 30) * 0.9, sq: 0 };
    }
    if (T < run + bump) {                            // ぶつかる (はね返ってつぶれる)
      const k = (T - run) / bump;
      if (!c.bumped) { c.bumped = true; if (this.onBump) this.onBump(ex, ez, u.gy); this.fx.burst(ex, u.gy + 1, ez, 18, ['#ff6b6b', '#ffd166', '#ffffff'], 6, 0.2, 0.8); this.fx.dust(ex, u.gy, ez, 8, 1); }
      const rec = 0.45 * Math.sin(Math.min(1, k) * Math.PI / 2);
      return { ...base, x: ex - c.dx * rec, z: ez - c.dz * rec, y: u.gy + Math.sin(k * Math.PI) * 0.5, pitch: -0.4 * k, arm: 2.0, leg: 0.6, sq: 0.3 * (1 - k), tint: 0.6 * (1 - k) };
    }
    if (T < run + bump + back) {                     // しょんぼり帰る (向きは帰る方へ)
      const k = (T - run - bump) / back, q = k * k * (3 - 2 * k);
      const sx = ex - c.dx * 0.45, sz = ez - c.dz * 0.45;
      return { ...base, yaw: Math.atan2(hx - sx, hz - sz), x: sx + (hx - sx) * q, z: sz + (hz - sz) * q, y: u.gy + Math.abs(Math.sin(T * 12)) * 0.08, arm: 0.2, leg: 0.15, swL: Math.sin(T * 14) * 0.5, pitch: 0.1, sq: 0 };
    }
    u.ch = null;
    return null;
  }
  // e = 盛り上がり (0〜1)、beat = 曲の位置 (拍の数)
  update(dt, camera, e, beat) {
    const FALL = 0.7;
    if (this.jumpT != null) { this.jumpT += dt; if (this.jumpT > JUMP_T + 0.4) this.jumpT = null; }
    const jy = this.jumpT != null ? jumpY(this.jumpT) : 0;
    if (this.jumpT != null && this.jumpT >= JUMP_T && !this.jumpLanded) { // 着地: 全員の足元に土ぼこりと水玉
      this.jumpLanded = true;
      for (const u of this.list) if (u.landed) { this.fx.dust(u.x, u.gy, u.z, 4, 0.8); if ((u.slot & 1) === 0) this.fx.burst(u.x, u.gy + 0.8, u.z, 5, DOTS, 4, 0.18, 0.8); }
    }
    for (const u of this.list) {
      u.t += dt;
      if (u.ch && u.landed) {
        const pz = this.chargePose(u, dt, beat);
        if (pz) { this.herd.setPose(u.slot, pz); continue; }
      }
      let y = u.gy, sq = 0, arm = 2.3, leg = 0.35;
      if (u.t < FALL) {                            // 空から降りてくる (手足を広げたまま)
        const k = u.t / FALL; y = u.gy + (1 - k * k) * 9; leg = 0.6;
      } else {
        if (!u.landed) {
          u.landed = true;
          this.fx.dust(u.x, u.gy, u.z, 10, 1);
          this.fx.burst(u.x, u.gy + 1, u.z, 14 + Math.min(20, this.list.length * 2), DOTS, 5, 0.2, 1);
        }
        const s = u.t - FALL, ph = beat * Math.PI + u.ph;       // 1 拍に 1 回跳ねる
        const hop = Math.abs(Math.sin(ph)), amp = 0.25 + 0.55 * e;
        y = u.gy + hop * amp;
        sq = s < 0.25 ? 0.25 * (1 - s / 0.25) : (1 - hop) * 0.06;  // 着地でつぶれる → 弾む
        arm = 1.9 + Math.sin(ph) * 0.4 * (0.5 + e); leg = 0.2 + hop * 0.25;
      }
      if (jy > 0 && u.landed) { y += jy; arm = 2.7; leg = 0.75; }                  // 全員ジャンプ: 万歳
      else if (this.jumpT != null && this.jumpT >= JUMP_T && u.landed) sq = 0.3 * (1 - (this.jumpT - JUMP_T) / 0.4); // 着地でつぶれる
      this.herd.setPose(u.slot, { x: u.x, y, z: u.z, yaw: u.yaw, s: 1, sq, arm, leg, roll: Math.sin(beat * Math.PI * 0.5 + u.ph) * 0.06 * e });
    }
    this.herd.flush();
    this.fx.update(dt, camera, []);
  }
}
