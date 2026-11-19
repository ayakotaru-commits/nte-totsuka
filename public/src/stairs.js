// 階段 (OSM の steps) に段 (踏面と蹴上) を付ける。
// 路面は滑らかな坂のままなので、段の高さは坂の線を中心にして ±半段ぶん上下する (足元との差は 1 段の半分以下)。
// - 橋・坂の階段は build_city.py の ys、地面の階段は地形 H の高さに沿わせる
import * as THREE from 'three';
import { H } from './terrain.js';

const RISE = 0.17, TREAD_MIN = 0.28;
const STEEP = 0.22; // 階段でない歩道も、これより急な区間は段にする (tools/build_props.py の STEEP と同じ値)
const PED = new Set(['footway', 'pedestrian', 'path', 'cycleway', 'corridor']);

// 階段の当たり (アクション用): 区間ごとの {a, b, ya, yb, hw} を 10m 格子に入れる
const CELL = 10, grid = new Map();
const cellOf = (v) => Math.floor(v / CELL);

// (x, z) が階段の上なら、上り方向の単位ベクトル {ux, uz} と勾配を返す。階段でなければ null。
// y (足元の高さ) を渡すと、その高さに階段があるときだけ返す (駅前のように、階段の真下の地面や真上のデッキを歩いているときは階段扱いにしない)。
// 階段の両端の先 (上り口・下り口の手前の平らな所) も階段扱いにしない
const END_MARGIN = 0.3, Y_TOL = 1.2;
export function stairAt(x, z, y = null) {
  const list = grid.get(cellOf(x) * 100000 + cellOf(z));
  if (!list) return null;
  for (const s of list) {
    const ex = s.bx - s.ax, ez = s.bz - s.az, l2 = ex * ex + ez * ez;
    const L = Math.sqrt(l2), t = ((x - s.ax) * ex + (z - s.az) * ez) / l2;
    if (t < -END_MARGIN / L || t > 1 + END_MARGIN / L) continue;
    if (Math.hypot(x - s.ax - ex * t, z - s.az - ez * t) > s.hw + 0.2) continue;
    if (y !== null && Math.abs(y - (s.ya + (s.yb - s.ya) * Math.max(0, Math.min(1, t)))) > Y_TOL) continue;
    const up = Math.sign(s.yb - s.ya) || 1;
    return { ux: ex / L * up, uz: ez / L * up, grade: Math.abs(s.yb - s.ya) / L };
  }
  return null;
}

// 階段を 1 区間足す (道のデータに無い階段。八坂神社の参道の石段 = shrine.js)。見た目は呼んだ側が作る。buildStairs の後に呼ぶ
export function addStair(seg) {
  const { ax, az, bx, bz, hw } = seg;
  for (let gx = cellOf(Math.min(ax, bx) - hw - 1); gx <= cellOf(Math.max(ax, bx) + hw + 1); gx++)
    for (let gz = cellOf(Math.min(az, bz) - hw - 1); gz <= cellOf(Math.max(az, bz) + hw + 1); gz++) {
      const k = gx * 100000 + gz;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(seg);
    }
}

export function buildStairs(city) {
  grid.clear();
  const top = [], riser = [], side = [];
  const push = (arr, ...pts) => { for (const p of pts) arr.push(p[0], p[1], p[2]); };
  const quad = (arr, a, b, c, d) => push(arr, a, b, c, a, c, d);
  for (const r of city.roads) {
    // 階段 (steps) と、デッキへ上がる歩道のうち急な区間 (実測で段差になっている所。STEEP より急)
    const steps = r.kind === 'steps';
    if (!steps && !(r.ys && PED.has(r.kind))) continue;
    const hw = (r.w || 2.5) / 2;
    const yAt = (i, x, z) => r.ys ? r.ys[i] + 0.05 : H(x, z) + 0.12;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.3) continue;
      const ya = yAt(i, ax, az), yb = r.ys ? r.ys[i + 1] + 0.05 : H(bx, bz) + 0.12;
      const n = Math.max(1, Math.min(Math.round(Math.abs(yb - ya) / RISE), Math.floor(L / TREAD_MIN)));
      if (Math.abs(yb - ya) < 0.3) continue; // ほぼ平らな区間は段にしない (踊り場)
      if (!steps && Math.abs(yb - ya) / L <= STEEP) continue;
      const seg = { ax, az, bx, bz, hw };
      seg.ya = ya; seg.yb = yb;
      for (let gx = cellOf(Math.min(ax, bx) - hw - 1); gx <= cellOf(Math.max(ax, bx) + hw + 1); gx++)
        for (let gz = cellOf(Math.min(az, bz) - hw - 1); gz <= cellOf(Math.max(az, bz) + hw + 1); gz++) {
          const k = gx * 100000 + gz;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(seg);
        }
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz * hw, nz = ux * hw;
      const lvl = (k) => ya + (yb - ya) * (k + 0.5) / n; // k 段目の踏面の高さ
      for (let k = 0; k < n; k++) {
        const t0 = k / n * L, t1 = (k + 1) / n * L;
        const p0 = [ax + ux * t0, az + uz * t0], p1 = [ax + ux * t1, az + uz * t1];
        const y = lvl(k);
        quad(top, [p0[0] + nx, y, p0[1] + nz], [p1[0] + nx, y, p1[1] + nz], [p1[0] - nx, y, p1[1] - nz], [p0[0] - nx, y, p0[1] - nz]);
        const yPrev = k === 0 ? y - (yb - ya) / n : lvl(k - 1); // 蹴上 (段の手前側の壁)
        quad(riser, [p0[0] + nx, yPrev, p0[1] + nz], [p0[0] - nx, yPrev, p0[1] - nz], [p0[0] - nx, y, p0[1] - nz], [p0[0] + nx, y, p0[1] + nz]);
        for (const s of [1, -1]) { // 側面 (段の下を塞ぐ)
          const ex = nx * s, ez = nz * s, depth = 0.4;
          quad(side, [p0[0] + ex, y - depth, p0[1] + ez], [p1[0] + ex, y - depth, p1[1] + ez], [p1[0] + ex, y, p1[1] + ez], [p0[0] + ex, y, p0[1] + ez]);
        }
      }
    }
  }
  const group = new THREE.Group();
  group.name = 'stairs';
  const mesh = (arr, color, name) => {
    if (!arr.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide }));
    m.name = name; m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  mesh(top, '#b3aa9a', 'stairs_tread');
  mesh(riser, '#8f8778', 'stairs_riser');
  mesh(side, '#8f8778', 'stairs_side');
  return group;
}
