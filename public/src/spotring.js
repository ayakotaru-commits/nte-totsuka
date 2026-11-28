// 足元の光の輪: 「ここに立つと始まる・入れる」場所を、地面の輪で知らせる (洋服屋の入口・イベントの場所で共通)。
// 輪は地面に沿う細い帯。場所の外形 (多角形) や円に合わせる。遠くでは薄く、近づくと濃くなって点滅し、中にいる間は強く光る。
// 使い方: const rings = new SpotRings({ scene, world, player });
//         rings.addPolygon(SITE.zone, { color: '#ff6fae' })            // イベントの区域 (反応する範囲そのもの)
//         rings.addCircle(x, z, r, { color: '#d79bff', y: 4.53 })      // 円。y = 足元の高さ (2 階のデッキなど。省くと地面)
//         opts.level = 足元の高さ: プレイヤーの高さが 2.5 m 以上ちがうとき (別の階) は出さない
//         rings.update(dt)  毎コマ。add の戻り値 h の h.enabled = false で隠せる。h.dist = いまの距離 (m。中なら 0)
import * as THREE from 'three';
import { H } from './terrain.js';

const STEP = 1.6;       // 輪を折れ線にする間隔 (m)
const WIDTH = 0.34;     // 帯の幅 (m)
const LIFT = 0.1;       // 地面から浮かす高さ (m)
const SEE = 70;         // これより遠いと描かない (m)

export class SpotRings {
  constructor({ scene, world, player }) {
    this.world = world; this.player = player; this.items = []; this.t = 0;
    this.root = new THREE.Group(); this.root.name = 'spot_rings'; scene.add(this.root);
  }

  addCircle(x, z, r, opts = {}) {
    const poly = [], n = Math.max(16, Math.round(2 * Math.PI * r / STEP));
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; poly.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); }
    return this.addPolygon(poly, opts);
  }

  addPolygon(poly, opts = {}) {
    // 辺を細かく割った点列 (地面の起伏に沿わせる)
    const pts = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.round(L / STEP));
      for (let j = 0; j < k; j++) pts.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
    }
    const n = pts.length, pos = new Float32Array(n * 2 * 3), idx = [];
    const gy = (x, z) => (opts.y !== undefined && opts.y !== null ? opts.y : this.world.groundAt(x, z, H(x, z))) + LIFT;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n], o = pts[(i + n - 1) % n];
      let nx = -(q[1] - o[1]), nz = q[0] - o[0]; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;   // 前後の点をつないだ線に直角
      const y = gy(p[0], p[1]);
      pos.set([p[0] + nx * WIDTH / 2, y, p[1] + nz * WIDTH / 2, p[0] - nx * WIDTH / 2, y, p[1] - nz * WIDTH / 2], i * 6);
      const j = (i + 1) % n; idx.push(i * 2, i * 2 + 1, j * 2, i * 2 + 1, j * 2 + 1, j * 2);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ color: opts.color || '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 6; mesh.frustumCulled = false; mesh.visible = false;
    this.root.add(mesh);
    const h = { poly, pts, mesh, m, level: opts.level, enabled: true, dist: 1e9, inside: false };
    this.items.push(h);
    return h;
  }

  static inPoly(poly, x, z) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }

  update(dt) {
    this.t += dt;
    const p = this.player.pos, pulse = 0.5 + 0.5 * Math.sin(this.t * 3.2);
    for (const h of this.items) {
      const sameLevel = h.level === undefined || h.level === null || Math.abs(p.y - h.level) <= 2.5;
      let d = 1e9;
      if (h.enabled && sameLevel) { for (const q of h.pts) { const e = Math.hypot(q[0] - p.x, q[1] - p.z); if (e < d) d = e; } }
      h.inside = d < 1e8 && SpotRings.inPoly(h.poly, p.x, p.z);
      h.dist = h.inside ? 0 : d;
      const show = d < SEE;
      h.mesh.visible = show;
      if (!show) continue;
      h.m.opacity = h.inside ? 0.85 + 0.15 * pulse : d < 18 ? 0.55 + 0.35 * pulse : d < 40 ? 0.35 : 0.18;
    }
  }
}
