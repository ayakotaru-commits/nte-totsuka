// 街を歩く人の描画 (issue #64)。動きは crowdsim.js。人は軽い人形で、全員を 1 つの InstancedMesh (描画 1 回) にまとめる。
// 脚と腕の振りは頂点シェーダで付けるので、1 人ごとの骨も画像も要らない (メモリはほとんど増えない)。
// 近くの人だけ詳細なキャラにする (組み立て式キャラは重い) のは、第 2 段階以降。
import * as THREE from 'three';
import { CrowdSim, parkObstacles } from './crowdsim.js';
import { H } from './terrain.js';
import { GROUND_LIFT } from './world.js';

// ---- 人形の形 (m。足元が原点、+Z が前、高さ約 1.65 m)。slot: 0 肌 1 髪 2 上着 3 ズボン 4 くつ。part: 0 動かない 1 左脚 2 右脚 3 左腕 4 右腕 ----
export function buildGeometry() {
  const pos = [], nor = [], slot = [], part = [], pivot = [];
  const add = (g, cx, cy, cz, sl, pt, pv) => {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.attributes.position, n = ng.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i) + cx, p.getY(i) + cy, p.getZ(i) + cz);
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      slot.push(sl); part.push(pt); pivot.push(...pv);
    }
  };
  const box = (w, h, d, cx, cy, cz, sl, pt = 0, pv = [0, 0, 0]) => add(new THREE.BoxGeometry(w, h, d), cx, cy, cz, sl, pt, pv);
  // 脚 (腰 y = 0.86 を支点に前後へ振る)
  for (const [side, pt] of [[-1, 1], [1, 2]]) {
    const hip = [side * 0.095, 0.86, 0];
    box(0.15, 0.78, 0.17, side * 0.095, 0.47, 0, 3, pt, hip);          // ズボン
    box(0.16, 0.08, 0.27, side * 0.095, 0.04, 0.045, 4, pt, hip);      // くつ
  }
  box(0.40, 0.56, 0.23, 0, 1.14, 0, 2);                                // 胴 (上着)
  box(0.38, 0.14, 0.22, 0, 0.90, 0, 3);                                // 腰
  // 腕 (肩 y = 1.38 を支点に、脚と逆の向きに振る)
  for (const [side, pt] of [[-1, 3], [1, 4]]) {
    const sh = [side * 0.255, 1.38, 0];
    box(0.10, 0.30, 0.12, side * 0.255, 1.23, 0, 2, pt, sh);           // 袖
    box(0.085, 0.26, 0.10, side * 0.255, 0.95, 0, 0, pt, sh);          // 手
  }
  add(new THREE.SphereGeometry(0.115, 10, 8), 0, 1.53, 0.005, 0, 0, [0, 0, 0]);                          // 頭
  add(new THREE.SphereGeometry(0.124, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.56), 0, 1.545, -0.01, 1, 0, [0, 0, 0]); // 髪
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(1), 3));
  g.setAttribute('aId', new THREE.Float32BufferAttribute(slot.flatMap((v, i) => [v, part[i]]), 2)); // (slot, part)
  g.setAttribute('aPivot', new THREE.Float32BufferAttribute(pivot, 3));
  return g;
}

export function buildMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aId; attribute vec3 aPivot;
        attribute vec3 iTop; attribute vec3 iBottom; attribute vec3 iHair; attribute vec3 iSkin;
        attribute vec3 iAnim;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vColor = aId.x < 0.5 ? iSkin : aId.x < 1.5 ? iHair : aId.x < 2.5 ? iTop : aId.x < 3.5 ? iBottom : vec3(0.9);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (aId.y > 0.5) {
          float sw = sin(iAnim.x) * iAnim.y;
          float a = aId.y < 1.5 ? sw : aId.y < 2.5 ? -sw : aId.y < 3.5 ? -sw * 0.8 : sw * 0.8;
          if (aId.y > 2.5) {                       // 腕: 1 = スマホを見る (両手を胸の前へ)、2 = 立ち話 (手を動かす)
            if (iAnim.z > 0.5 && iAnim.z < 1.5) a = -1.15;
            else if (iAnim.z > 1.5 && iAnim.z < 2.5) a = (aId.y < 3.5 ? -1.0 : 1.0) * sw * 1.4 - 0.5;
            else if (iAnim.z > 3.5) {              // ライブ: 4 = 客席 (両手を上げて左右に振る)、5 = 歌 (右手でマイク・左手で身ぶり)、6 = ギター・ベース (弦をはじく)、7 = ドラム (交互に打つ)、8 = キーボード、9 = ダンス (腕を大きく振る)
              float L = aId.y < 3.5 ? 1.0 : -1.0, ph = iAnim.x;
              if (iAnim.z < 4.5) a = -2.5 + L * sin(ph) * 0.5;
              else if (iAnim.z < 5.5) a = aId.y < 3.5 ? -0.7 + sin(ph * 0.8) * 0.9 : -2.05 + sin(ph * 0.5) * 0.08;
              else if (iAnim.z < 6.5) a = aId.y < 3.5 ? -1.25 : -0.85 + sin(ph * 2.0) * 0.38;
              else if (iAnim.z < 7.5) a = -1.0 + L * sin(ph * 2.0) * 0.7;
              else if (iAnim.z < 8.5) a = -1.05 + sin(ph * 1.5 + L) * 0.16;
              else a = -1.7 + L * sin(ph * 1.2) * 1.0;
            }
          }
          vec3 q = transformed - aPivot;
          float cs = cos(a), sn = sin(a);
          transformed = vec3(q.x, q.y * cs - q.z * sn, q.y * sn + q.z * cs) + aPivot;
        }`);
  };
  m.customProgramCacheKey = () => 'crowd-person';
  return m;
}

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
    const geo = buildGeometry();
    const attr = (n, size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(n, a); return a; };
    this.A = { top: attr('iTop', 3), bottom: attr('iBottom', 3), hair: attr('iHair', 3), skin: attr('iSkin', 3), anim: attr('iAnim', 3) };
    this.mesh = new THREE.InstancedMesh(geo, buildMaterial(), cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;   // 範囲が広いので、まとめて描く
    this.mesh.castShadow = !low;        // スマホは影を落とさない (影の描画が増えるため)
    this.mesh.count = 0;
    this.group.add(this.mesh);
    scene.add(this.group);
    this.col = new Map();               // 人 id → 色 (毎コマ作り直さない)
    this._c = new THREE.Color(); this._m = new THREE.Matrix4(); this._f = new THREE.Vector3();
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
    const ppl = this.sim.slots ? this.sim.people.concat(this.sim.viewerList()) : this.sim.people, n = Math.min(ppl.length, this.mesh.instanceMatrix.count);
    const A = this.A, c = this._c, m = this._m;
    for (let i = 0; i < n; i++) {
      const p = ppl[i];
      let cc = this.col.get(p.id);
      if (!cc) { cc = ['top', 'bottom', 'hair', 'skin'].map((k) => new THREE.Color(p.o[k])); this.col.set(p.id, cc); }
      const co = Math.cos(p.yaw), si = Math.sin(p.yaw), s = p.grow === undefined ? p.scale : p.scale * Math.max(0.001, p.grow * p.grow * (3 - 2 * p.grow)), y = p.y;
      m.set(co * s, 0, si * s, p.x, 0, s, 0, y, -si * s, 0, co * s, p.z, 0, 0, 0, 1);
      this.mesh.setMatrixAt(i, m);
      A.top.setXYZ(i, cc[0].r, cc[0].g, cc[0].b); A.bottom.setXYZ(i, cc[1].r, cc[1].g, cc[1].b);
      A.hair.setXYZ(i, cc[2].r, cc[2].g, cc[2].b); A.skin.setXYZ(i, cc[3].r, cc[3].g, cc[3].b);
      A.anim.setXYZ(i, p.phase, p.amp, p.mode);
    }
    if (this.col.size > 600) { const live = new Set(ppl.map((p) => p.id)); for (const id of this.col.keys()) if (!live.has(id)) this.col.delete(id); }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const k in A) A[k].needsUpdate = true;
  }

  dispose() {
    if (!this.enabled) return;
    this.mesh.geometry.dispose(); this.mesh.material.dispose();
    this.group.removeFromParent();
  }
}
