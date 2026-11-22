// 街を走る車の描画 (issue #64 第 3 段階)。動きは trafficsim.js。車体・屋根・窓・車輪・ライトを、それぞれ 1 つの InstancedMesh (描画 1 回) にまとめる。
// 車体の形は駐車場の車 (detail/props.js) と同じ。種類 (軽・セダン・バン・トラック・バス) は長さ・幅・高さの倍率で変える。
import * as THREE from 'three';
import { TrafficSim } from './trafficsim.js';
import { H } from './terrain.js';
import { GROUND_LIFT } from './world.js';

export class Traffic {
  // props = props.json (traffic を持つこと)。opt = { low: スマホなど (台数・範囲を減らす), cap }
  constructor(scene, props, opt = {}) {
    this.enabled = !!(props && props.traffic && props.traffic.lanes && props.traffic.lanes.length);
    this.group = new THREE.Group(); this.group.name = 'traffic';
    if (!this.enabled) return;
    const low = !!opt.low;
    this.sim = new TrafficSim(props.traffic, { cap: opt.cap ?? (low ? 14 : 40), radius: low ? 90 : 130, seed: 1, ground: (x, z) => H(x, z) + GROUND_LIFT, signals: props.signals });
    const cap = this.sim.cap + 8;
    this.cap = cap;
    const body = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: '#232a33', roughness: 0.15, metalness: 0.4 });
    const tyre = new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.9 });
    this.headMat = new THREE.MeshBasicMaterial({ color: '#fff1c4', toneMapped: false });
    this.tailMat = new THREE.MeshBasicMaterial({ color: '#ff2a1a', toneMapped: false });
    const mk = (geo, mat, n, shadow) => { const m = new THREE.InstancedMesh(geo, mat, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.castShadow = shadow; m.count = 0; this.group.add(m); return m; };
    // 形は駐車場の車と同じ (長さ 4.3 m・幅 1.72 m)。z 方向が前
    this.bodies = mk(new THREE.BoxGeometry(1.72, 0.6, 4.3).translate(0, 0.6, 0), body, cap, !low);
    this.roofs = mk(new THREE.BoxGeometry(1.5, 0.06, 2.0).translate(0, 1.45, -0.25), body, cap, false);
    this.cabins = mk(new THREE.BoxGeometry(1.56, 0.52, 2.4).translate(0, 1.16, -0.25), glass, cap, false);
    this.wheels = mk(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12).rotateZ(Math.PI / 2), tyre, cap * 4, false);
    this.heads = mk(new THREE.BoxGeometry(0.3, 0.13, 0.05), this.headMat, cap * 2, false);
    this.tails = mk(new THREE.BoxGeometry(0.3, 0.13, 0.05), this.tailMat, cap * 2, false);
    for (const m of [this.bodies, this.roofs]) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    scene.add(this.group);
    this.colors = new Map(); this.dummy = new THREE.Object3D(); this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(0, 0, 0, 'YXZ');
    this.v = new THREE.Vector3(); this.sc = new THREE.Vector3(); this.c = new THREE.Color(); this.night = 0;
  }

  get count() { return this.enabled ? this.sim.cars.length : 0; }
  setVisible(v) { if (this.enabled) this.group.visible = v; }

  // camera = three のカメラ、(px, pz) = プレイヤー (前にいると車が止まる)、preset = '朝' など、clock = 信号の時計 (秒)、win = 夜の明かりの強さ (time.js の win。0〜1.3)
  update(dt, camera, px, pz, preset, clock, win = 0) {
    if (!this.enabled || dt <= 0) return;
    camera.getWorldDirection(this.v);
    const fl = Math.hypot(this.v.x, this.v.z) || 1, fx = this.v.x / fl, fz = this.v.z / fl;
    const cx = camera.position.x + fx * 20, cz = camera.position.z + fz * 20;
    this.sim.update(dt, cx, cz, fx, fz, px, pz, preset, clock);
    const cars = this.sim.cars, n = Math.min(cars.length, this.cap);
    const m = this.m, q = this.q, e = this.e, v = this.v, sc = this.sc;
    let nw = 0, nh = 0, nt = 0;
    for (let i = 0; i < n; i++) {
      const c = cars[i];
      let col = this.colors.get(c.id);
      if (!col) { col = new THREE.Color(c.color); this.colors.set(c.id, col); }
      e.set(-c.pitch, c.yaw, 0, 'YXZ'); q.setFromEuler(e);
      // 車体: 長さ・幅・高さの倍率 (基準 4.3 m × 1.72 m)
      sc.set(c.wid / 1.72, c.hgt, c.len / 4.3);
      m.compose(v.set(c.x, c.y, c.z), q, sc);
      this.bodies.setMatrixAt(i, m); this.roofs.setMatrixAt(i, m); this.cabins.setMatrixAt(i, m);
      this.bodies.setColorAt(i, col); this.roofs.setColorAt(i, col);
      // 車輪・ライトは、車の向きと位置だけで置く (倍率を掛けると形がゆがむため)
      const place = (mesh, k, lx, ly, lz) => { v.set(lx, ly, lz).applyQuaternion(q); v.x += c.x; v.y += c.y; v.z += c.z; m.compose(v, q, sc.set(1, 1, 1)); mesh.setMatrixAt(k, m); };
      const hx = c.wid / 2 - 0.1, wz = c.len * 0.31;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) place(this.wheels, nw++, sx * hx, 0.32, sz * wz);
      for (const sx of [-1, 1]) { place(this.heads, nh++, sx * hx * 0.72, 0.68 * c.hgt, c.len / 2 + 0.01); place(this.tails, nt++, sx * hx * 0.72, 0.7 * c.hgt, -c.len / 2 - 0.01); }
    }
    if (this.colors.size > 300) { const live = new Set(cars.map((c) => c.id)); for (const id of this.colors.keys()) if (!live.has(id)) this.colors.delete(id); }
    this.bodies.count = this.roofs.count = this.cabins.count = n;
    this.wheels.count = nw; this.heads.count = nh; this.tails.count = nt;
    for (const mesh of [this.bodies, this.roofs, this.cabins, this.wheels, this.heads, this.tails]) mesh.instanceMatrix.needsUpdate = true;
    this.bodies.instanceColor.needsUpdate = this.roofs.instanceColor.needsUpdate = true;
    // 夜はライトを光らせる (昼は消す)
    const on = win > 0.25;
    this.heads.visible = this.tails.visible = on;
    if (on) { this.headMat.color.set('#fff1c4').multiplyScalar(1 + win * 1.5); this.tailMat.color.set('#ff2a1a').multiplyScalar(1 + win * 0.8); }
  }

  dispose() {
    if (!this.enabled) return;
    for (const m of [this.bodies, this.roofs, this.cabins, this.wheels, this.heads, this.tails]) { m.geometry.dispose(); m.material.dispose(); }
    this.group.removeFromParent();
  }
}
