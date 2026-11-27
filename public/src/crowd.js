// 街を歩く人の描画 (issue #64)。動きは crowdsim.js。人は軽い人形で、全員を 1 つの InstancedMesh (描画 1 回) にまとめる。
// 脚と腕の振りは頂点シェーダで付けるので、1 人ごとの骨も画像も要らない (メモリはほとんど増えない)。
// 細かさは 2 段: 近く (NEAR_R 以内、最大 nearCap 人) は丸みのある細かい形、遠くは分割を減らした同じ形。
import * as THREE from 'three';
import { CrowdSim, parkObstacles } from './crowdsim.js';
import { H } from './terrain.js';
import { GROUND_LIFT } from './world.js';
import { createTier, styleFor } from './crowdfigure.js';

const NEAR_R = 32;   // この距離 (カメラから m) より近い人は細かい形 (人形の形・動きは crowdfigure.js)

const NO_SHOW = { parade: 0, fw: 0, live: 0, paradeOn: false, fwOn: false, liveOn: false };

export class Crowd {
  // props = props.json (crowd を持つこと)。opt = { low: スマホなど (人数・範囲を減らす), cap, park: 千葉ドリームランドの設定 (public/data/park.json。園内の通り道と観客の場所を足す) }
  constructor(scene, props, opt = {}) {
    let crowd = props && props.crowd;
    // 園内の通り道 (park.json の crowd。k = 'p') を街の通り道に足す。足すだけで、街の通り道・人の動きは変えない
    if (crowd && crowd.lanes && opt.park && opt.park.crowd) crowd = { ...crowd, lanes: crowd.lanes.concat(opt.park.crowd.lanes), parkHubs: opt.park.crowd.hubs };
    this.enabled = !!(crowd && crowd.lanes && crowd.lanes.length);
    this.group = new THREE.Group(); this.group.name = 'crowd';
    this.visibleNow = true;
    if (!this.enabled) return;
    const low = !!opt.low;
    this.sim = new CrowdSim(crowd, { cap: opt.cap ?? (low ? 40 : 120), radius: low ? 90 : 130, seed: 1, ground: (x, z) => H(x, z) + GROUND_LIFT, peds: props.pedSignals, busStops: props.busStops, obstacles: opt.park ? parkObstacles(opt.park) : null });
    const viewCap = low ? 36 : 90;   // 観客の最大 (ショーの間だけ。歩く人と同じ InstancedMesh)
    if (opt.viewSlots && opt.viewSlots.length) this.sim.setViewSlots(opt.viewSlots, viewCap);
    const cap = this.sim.cap + (this.sim.slots ? viewCap * 2 : 0) + 8;   // 観客は、消えていく途中の分 (背が 0 に縮むまで) も数えて 2 倍
    this.nearCap = low ? 10 : 36;      // 細かい形で描く人数の上限 (人が多くても、重い形はここまで)
    this.near = createTier(Math.min(cap, this.nearCap), true, !low);   // スマホは影を落とさない (影の描画が増えるため)
    this.far = createTier(cap, false, !low);                                // 遠くの人も影は落とす (形が軽いので負担は小さい。落とさないと境目で影が消える)
    this.mesh = this.far.mesh;                                              // 互換 (確認用)
    this.group.add(this.near.mesh, this.near.outline, this.far.mesh, this.far.outline);
    scene.add(this.group);
    this.col = new Map();               // 人 id → 色 (毎コマ作り直さない)
    this._c = new THREE.Color(); this._m = new THREE.Matrix4(); this._f = new THREE.Vector3(); this._d = [];
  }

  get count() { return this.enabled ? this.sim.people.length : 0; }
  get viewers() { return this.enabled && this.sim.viewers ? this.sim.viewers.size : 0; }

  setVisible(v) { if (this.enabled) this.group.visible = v; }

  // camera = three のカメラ、player = {x, z} (よけるため)、preset = '朝' | '昼' | '夕方' | '夜'
  // want = ショーの観客の指定 ({ parade, fw, live, paradeOn, fwOn, liveOn }。crowdsim.js の updateViewers)。園外・ショーが無いときは省く
  update(dt, camera, px, pz, preset, clock, want) {
    if (!this.enabled || dt <= 0) return;
    camera.getWorldDirection(this._f);
    const fl = Math.hypot(this._f.x, this._f.z) || 1, fx = this._f.x / fl, fz = this._f.z / fl;
    const cx = camera.position.x + fx * 20, cz = camera.position.z + fz * 20;   // 出し入れの中心 = カメラの少し先
    this.sim.update(dt, cx, cz, fx, fz, px, pz, preset, clock);
    if (this.sim.slots) this.sim.updateViewers(dt, cx, cz, want || NO_SHOW);
    const ppl = this.sim.slots ? this.sim.people.concat(this.sim.viewerList()) : this.sim.people, n = Math.min(ppl.length, this.far.cap);
    const m = this._m, camx = camera.position.x, camz = camera.position.z, d2 = this._d;
    // 近い順に nearCap 人までを細かい形にする (しきい値は、NEAR_R 以内の人が多いときだけ並べ替えて決める)
    let lim = NEAR_R * NEAR_R, within = 0;
    for (let i = 0; i < n; i++) { const p = ppl[i]; d2[i] = (p.x - camx) ** 2 + (p.z - camz) ** 2; if (d2[i] < lim) within++; }
    if (within > this.near.cap) lim = d2.slice(0, n).sort((x, y) => x - y)[this.near.cap - 1] + 1e-6;
    let nn = 0, nf = 0;
    for (let i = 0; i < n; i++) {
      const p = ppl[i];
      let cc = this.col.get(p.id);
      if (!cc) { cc = ['top', 'bottom', 'hair', 'skin'].map((k) => new THREE.Color(p.o[k])); cc.st = styleFor(p.type, p.id); this.col.set(p.id, cc); }
      const co = Math.cos(p.yaw), si = Math.sin(p.yaw), s = p.grow === undefined ? p.scale : p.scale * Math.max(0.001, p.grow * p.grow * (3 - 2 * p.grow)), y = p.y;
      m.set(co * s, 0, si * s, p.x, 0, s, 0, y, -si * s, 0, co * s, p.z, 0, 0, 0, 1);
      if (d2[i] <= lim && nn < this.near.cap) this.near.put(nn++, m, cc, p.phase, p.amp, p.mode, cc.st);
      else this.far.put(nf++, m, cc, p.phase, p.amp, p.mode, cc.st);
    }
    this.nearN = nn;
    this.near.finish(nn); this.far.finish(nf);
    if (this.col.size > 600) { const live = new Set(ppl.map((p) => p.id)); for (const id of this.col.keys()) if (!live.has(id)) this.col.delete(id); }
  }

  dispose() {
    if (!this.enabled) return;
    this.near.dispose(); this.far.dispose();
    this.group.removeFromParent();
  }
}
