// お札まきの観客に加わる「うな○ー」(swarm/model.js の見た目を使う)。大吉を出すたびに 1 体ずつ、空から降りてきて見物に加わる。
// 加わったら、曲に合わせて跳ねて、両手を上げて盛り上がる。最大 MAX 体 (1 回の曲の大吉の数より多い)。
import { Herd, Fx } from '../swarm/model.js';

const MAX = 24;
const DOTS = ['#ffd166', '#ff6b6b', '#fff3b0', '#f2789f'];

export class UnaaCrowd {
  // slots: [[x, z], ...] 加わる順の立ち位置。face: [x, z] 見る先
  constructor(scene, ground, slots, face) {
    this.ground = ground; this.face = face;
    this.slots = slots.slice(0, MAX);
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
    const i = this.list.length;
    if (i >= this.slots.length) return false;
    const [x, z] = this.slots[i];
    this.list.push({ slot: i, x, z, gy: this.ground(x, z), t: 0, ph: Math.random() * 6, landed: false,
      yaw: Math.atan2(this.face[0] - x, this.face[1] - z) });
    return true;
  }
  // e = 盛り上がり (0〜1)、beat = 曲の位置 (拍の数)
  update(dt, camera, e, beat) {
    const FALL = 0.7;
    for (const u of this.list) {
      u.t += dt;
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
      this.herd.setPose(u.slot, { x: u.x, y, z: u.z, yaw: u.yaw, s: 1, sq, arm, leg, roll: Math.sin(beat * Math.PI * 0.5 + u.ph) * 0.06 * e });
    }
    this.herd.flush();
    this.fx.update(dt, camera, []);
  }
}
