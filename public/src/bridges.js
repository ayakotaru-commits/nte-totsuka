// 橋・歩道橋・デッキと、それにつながる坂 (build_city.py の ys = 各頂点の高さ)
// - 橋げた (路面・側面・底面)、手すり、橋脚を作る
// - deckAt(x, z): その地点の橋の路面の高さ (当たり判定・路面の貼り付けに使う)
import * as THREE from 'three';
import { H } from './terrain.js';

const PED = new Set(['footway', 'pedestrian', 'path', 'cycleway', 'steps', 'corridor']);
let current = null;
export const getBridges = () => current;

export class Bridges {
  constructor(city) {
    this.items = [];
    for (const r of city.roads) if (r.ys) this.items.push({ r, rail: false, ped: PED.has(r.kind), w: r.w || 3, bridge: !!r.bridge });
    for (const r of city.rails) if (r.ys) this.items.push({ r, rail: true, ped: false, w: 4.2, bridge: !!r.bridge });
    this.cell = 20;
    this.grid = new Map();
    this.items.forEach((it, n) => {
      const p = it.r.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const m = it.w / 2 + 1;
        for (let gx = Math.floor((Math.min(p[i][0], p[i + 1][0]) - m) / this.cell); gx <= Math.floor((Math.max(p[i][0], p[i + 1][0]) + m) / this.cell); gx++)
          for (let gz = Math.floor((Math.min(p[i][1], p[i + 1][1]) - m) / this.cell); gz <= Math.floor((Math.max(p[i][1], p[i + 1][1]) + m) / this.cell); gz++) {
            const k = gx * 100000 + gz;
            if (!this.grid.has(k)) this.grid.set(k, []);
            this.grid.get(k).push([n, i]);
          }
      }
    });
    current = this;
  }

  // filter(item) が true の橋だけを見る。路面の内側 (幅/2 + margin) にあれば {y, item}
  deckAt(x, z, margin = 0.3, filter = null) {
    const list = this.grid.get(Math.floor(x / this.cell) * 100000 + Math.floor(z / this.cell));
    if (!list) return null;
    let best = null;
    for (const [n, i] of list) {
      const it = this.items[n];
      if (filter && !filter(it)) continue;
      const a = it.r.pts[i], b = it.r.pts[i + 1];
      const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez;
      if (l2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / l2));
      const d = Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t);
      if (d > it.w / 2 + margin) continue;
      const y = it.r.ys[i] + (it.r.ys[i + 1] - it.r.ys[i]) * t;
      if (!best || y > best.y) best = { y, item: it };
    }
    return best;
  }

  // 車道の橋の上か (PLATEAU の道路面のうち橋の部分は描かず、橋げた側で描く)
  onVehicleBridge(x, z) { return !!this.deckAt(x, z, 0.2, (it) => it.bridge && !it.ped && !it.rail); }

  build() {
    const group = new THREE.Group();
    group.name = 'bridges';
    const P = { deck: [], ped: [], side: [], rail: [], ballast: [], steel: [] };
    const push = (arr, ...pts) => { for (const p of pts) arr.push(p[0], p[1], p[2]); };
    const quad = (arr, a, b, c, d) => push(arr, a, b, c, a, c, d);
    const piers = [];
    for (const it of this.items) {
      const { pts, ys } = it.r;
      const hw = it.w / 2, top = it.rail ? 0.3 : 0.05;
      const surf = it.rail ? P.ballast : it.ped ? P.ped : P.deck;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.05) continue;
        const nx = -(bz - az) / L * hw, nz = (bx - ax) / L * hw;
        const ya = ys[i] + top, yb = ys[i + 1] + top;
        const A = [ax + nx, ya, az + nz], B = [bx + nx, yb, bz + nz], C = [bx - nx, yb, bz - nz], D = [ax - nx, ya, az - nz];
        quad(surf, A, B, C, D);                                   // 路面
        if (it.rail) for (const o of [-0.72, 0.72]) {             // レール
          const ox = -(bz - az) / L * o, oz = (bx - ax) / L * o, w = 0.07 / hw;
          quad(P.rail, [ax + ox + nx * w, ya + 0.2, az + oz + nz * w], [bx + ox + nx * w, yb + 0.2, bz + oz + nz * w], [bx + ox - nx * w, yb + 0.2, bz + oz - nz * w], [ax + ox - nx * w, ya + 0.2, az + oz - nz * w]);
        }
        if (!it.bridge) continue;                                 // 坂 (地面側の歩道・階段) は路面だけ
        const th = it.ped ? 0.5 : 0.9;                             // 橋げたの厚さ
        for (const s of [1, -1]) {
          const ex = nx * s, ez = nz * s;
          const t0 = [ax + ex, ya, az + ez], t1 = [bx + ex, yb, bz + ez];
          const b0 = [ax + ex, ya - th, az + ez], b1 = [bx + ex, yb - th, bz + ez];
          quad(P.side, b0, b1, t1, t0);                            // 側面
          // 手すり / 高欄
          const hh = it.ped ? 1.1 : 0.9;
          quad(it.ped ? P.steel : P.side, t0, t1, [t1[0], yb + hh, t1[2]], [t0[0], ya + hh, t0[2]]);
        }
        quad(P.side, [ax - nx, ya - th, az - nz], [bx - nx, yb - th, bz - nz], [bx + nx, yb - th, bz + nz], [ax + nx, ya - th, az + nz]); // 底面
        // 橋脚 (下が 2.5m 以上空いている所)
        for (let t = 9; t < L; t += 18) {
          const x = ax + (bx - ax) * t / L, z = az + (bz - az) * t / L, y = ys[i] + (ys[i + 1] - ys[i]) * t / L - th;
          const g = H(x, z);
          if (y - g > 2.5) piers.push([x, z, g, y, Math.atan2(bx - ax, bz - az), it.w]);
        }
      }
    }
    const mesh = (arr, mat, name) => {
      if (!arr.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.name = name; m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    };
    const ds = { side: THREE.DoubleSide };
    mesh(P.deck, new THREE.MeshStandardMaterial({ color: '#4c4e52', roughness: 0.95, ...ds }), 'bridge_deck');
    mesh(P.ped, new THREE.MeshStandardMaterial({ color: '#bdb3a1', roughness: 0.9, ...ds }), 'bridge_walk');
    mesh(P.ballast, new THREE.MeshStandardMaterial({ color: '#7a7068', roughness: 1, ...ds }), 'bridge_ballast');
    mesh(P.rail, new THREE.MeshStandardMaterial({ color: '#b0b5ba', roughness: 0.4, metalness: 0.6, ...ds }), 'bridge_rails');
    mesh(P.side, new THREE.MeshStandardMaterial({ color: '#b9b6ae', roughness: 0.9, ...ds }), 'bridge_concrete');
    mesh(P.steel, new THREE.MeshStandardMaterial({ color: '#5f8a9a', roughness: 0.5, metalness: 0.4, transparent: true, opacity: 0.85, ...ds }), 'bridge_railing');
    if (piers.length) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#a9a69e', roughness: 0.9 }), piers.length);
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), S = new THREE.Vector3(), Pp = new THREE.Vector3();
      piers.forEach(([x, z, g, y, ang, w], i) => { Q.setFromAxisAngle(Y, ang); im.setMatrixAt(i, M.compose(Pp.set(x, g, z), Q, S.set(Math.min(w * 0.6, 8), y - g, 1.2))); });
      im.castShadow = im.receiveShadow = true; im.name = 'bridge_piers';
      group.add(im);
    }
    return group;
  }
}
