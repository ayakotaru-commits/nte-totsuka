// 5. 駅と線路: ホーム・ホームの屋根と柱・架線柱・架線
// 配置は tools/build_props.py が計算した data/props.json の rail。ここでは形を作って置くだけ。
import * as THREE from 'three';
import { Builder } from './util.js';

const SKIRT = 1.4;      // ホームの側面の高さ (上面から下へ)
const ROOF_T = 0.25;    // 屋根の厚さ
const ROOF_RISE = 0.45; // 屋根の縁が中央より高い分 (中央が低い V 字)

export function buildStation(props) {
  const group = new THREE.Group();
  group.name = 'detail_station';
  const R = props.rail;
  if (!R) return { group };
  const top = new Builder(), side = new Builder(), yellow = new Builder(), white = new Builder();
  const roof = new Builder(), under = new Builder(), steel = new Builder();
  const UP = [0, 1, 0], DOWN = [0, -1, 0];
  const mix = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const P = (p, y) => [p[0], y, p[1]];

  // ---------- ホーム: 上面・側面・黄色い点字ブロック・縁の白線 ----------
  for (const pf of R.platforms) {
    const n = pf.y.length;
    for (let k = 0; k + 1 < n; k++) {
      const l0 = pf.left[k], l1 = pf.left[k + 1], r0 = pf.right[k], r1 = pf.right[k + 1], y0 = pf.y[k], y1 = pf.y[k + 1];
      top.quad(P(l0, y0), P(r0, y0), P(r1, y1), P(l1, y1), UP);
      for (const [a, b, o] of [[l0, l1, r0], [r0, r1, l0]]) {
        const nx = a[0] - o[0], nz = a[1] - o[1], nl = Math.hypot(nx, nz) || 1;
        side.quad(P(a, y0 - SKIRT), P(b, y1 - SKIRT), P(b, y1), P(a, y0), [nx / nl, 0, nz / nl]);
      }
      // 縁からの距離で帯を引く (幅の狭い端では省く)
      const w0 = Math.hypot(l0[0] - r0[0], l0[1] - r0[1]), w1 = Math.hypot(l1[0] - r1[0], l1[1] - r1[1]);
      if (Math.min(w0, w1) < 3.2) continue;
      const band = (B, d0, d1, lift) => {
        for (const [a0, o0, a1, o1] of [[l0, r0, l1, r1], [r0, l0, r1, l1]]) {
          B.quad(P(mix(a0, o0, d0 / w0), y0 + lift), P(mix(a0, o0, d1 / w0), y0 + lift), P(mix(a1, o1, d1 / w1), y1 + lift), P(mix(a1, o1, d0 / w1), y1 + lift), UP);
        }
      };
      band(yellow, 0.8, 1.2, 0.02);
      band(white, 0.12, 0.27, 0.02);
    }
    // 両端の面
    for (const k of [0, n - 1]) {
      const l = pf.left[k], r = pf.right[k], y = pf.y[k];
      side.quad(P(l, y - SKIRT), P(r, y - SKIRT), P(r, y), P(l, y), null);
      side.quad(P(r, y - SKIRT), P(l, y - SKIRT), P(l, y), P(r, y), null);
    }
  }

  // ---------- 屋根: 中央が低い V 字の板。下面と縁の面も作る ----------
  for (const c of R.canopies) {
    const n = c.y.length;
    const mid = (k) => mix(c.left[k], c.right[k], 0.5);
    for (let k = 0; k + 1 < n; k++) {
      const y0 = c.y[k], y1 = c.y[k + 1], m0 = mid(k), m1 = mid(k + 1);
      for (const [e0, e1] of [[c.left[k], c.left[k + 1]], [c.right[k], c.right[k + 1]]]) {
        const a = P(e0, y0 + ROOF_RISE), b = P(e1, y1 + ROOF_RISE), cc = P(m1, y1), d = P(m0, y0);
        const up = (p) => [p[0], p[1] + ROOF_T, p[2]];
        roof.quad(up(a), up(b), up(cc), up(d), UP);
        under.quad(a, b, cc, d, DOWN);
        const nx = e0[0] - m0[0], nz = e0[1] - m0[1], nl = Math.hypot(nx, nz) || 1;
        roof.quad(a, b, up(b), up(a), [nx / nl, 0, nz / nl]);
      }
    }
    for (const k of [0, n - 1]) { // 両端の面 (V 字の断面)
      const y = c.y[k], m = mid(k);
      for (const e of [c.left[k], c.right[k]]) {
        const a = P(e, y + ROOF_RISE), d = P(m, y), a2 = [a[0], a[1] + ROOF_T, a[2]], d2 = [d[0], d[1] + ROOF_T, d[2]];
        roof.quad(a, d, d2, a2, null); roof.quad(d, a, a2, d2, null);
      }
    }
  }

  // ---------- 柱 (屋根) と架線柱 (門形) ----------
  const box = (B, x, z, y0, y1, hw, ux = 1, uz = 0, hl = hw) => {
    // 中心 (x, z)、(ux, uz) 方向に半分の長さ hl、直角方向に半幅 hw の角柱
    const vx = -uz, vz = ux;
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => [x + ux * hl * s + vx * hw * t, z + uz * hl * s + vz * hw * t]);
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4];
      const nx = (a[0] + b[0]) / 2 - x, nz = (a[1] + b[1]) / 2 - z, nl = Math.hypot(nx, nz) || 1;
      B.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [nx / nl, 0, nz / nl]);
    }
    B.quad([c[0][0], y1, c[0][1]], [c[1][0], y1, c[1][1]], [c[2][0], y1, c[2][1]], [c[3][0], y1, c[3][1]], UP);
    B.quad([c[0][0], y0, c[0][1]], [c[1][0], y0, c[1][1]], [c[2][0], y0, c[2][1]], [c[3][0], y0, c[3][1]], DOWN);
  };
  for (const [x, z, y0, y1] of R.columns) box(steel, x, z, y0, y1 + 0.1, 0.14);
  const mastH = R.dims.mastH;
  for (const [x, z, y, dx, dz, half] of R.gantries) {
    for (const s of [-1, 1]) box(steel, x + dx * half * s, z + dz * half * s, y, y + mastH, 0.16);
    box(steel, x, z, y + mastH - 0.9, y + mastH - 0.55, 0.12, dx, dz, half); // 梁 (上下 2 本)
    box(steel, x, z, y + mastH - 0.2, y + mastH, 0.12, dx, dz, half);
  }

  const mesh = (B, color, name, opts = {}) => {
    const m = new THREE.Mesh(B.geometry(), new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...opts }));
    m.name = name; m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  mesh(top, '#55575a', 'platform_top');
  mesh(side, '#b9b4aa', 'platform_side');
  mesh(yellow, '#e3b921', 'platform_tactile');
  mesh(white, '#f1f1ee', 'platform_edge');
  mesh(roof, '#d3d6d6', 'canopy_roof', { side: THREE.DoubleSide });
  mesh(under, '#dfe1e0', 'canopy_under', { side: THREE.DoubleSide });
  mesh(steel, '#e4e5e2', 'rail_steel', { roughness: 0.7 });

  // ---------- 架線 ----------
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(R.catenary.flat(), 3));
  const wires = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#2a2d30' }));
  wires.name = 'catenary';
  group.add(wires);

  console.info(`[detail] platforms=${R.platforms.length} canopy columns=${R.columns.length} gantries=${R.gantries.length}`);
  return { group };
}
