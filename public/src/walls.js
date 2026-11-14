// 擁壁・崖の壁 (tools/lidar_walls.py が点群から作る data/walls.json)。
// walls: [x0, z0, x1, z1, yLow, yHigh]。低い側の地面から高い側の地面まで、垂直な面を立てる。
// 地形 (4m 格子) は滑らかなので、壁の下は少し (0.4 m) 地中に伸ばして隙間を隠し、上に天端 (薄い板) を付ける。
import * as THREE from 'three';
import { H } from './terrain.js';

export function buildWalls(list) {
  const group = new THREE.Group();
  group.name = 'retaining_walls';
  if (!list || !list.length) return group;
  const face = [], cap = [];
  const quad = (arr, a, b, c, d) => { for (const p of [a, b, c, a, c, d]) arr.push(p[0], p[1], p[2]); };
  for (const [x0, z0, x1, z1, lo, hi] of list) {
    // 地形は滑らかなので、壁の両側 1.5 m の地形の高さに合わせて上下を切る (地形から浮いたり、埋もれたりしないように)
    const L = Math.hypot(x1 - x0, z1 - z0) || 1, nx = -(z1 - z0) / L * 0.15, nz = (x1 - x0) / L * 0.15;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, ox = nx * 10, oz = nz * 10;
    const hs = [H(mx + ox, mz + oz), H(mx - ox, mz - oz), H(mx, mz)];
    const top = Math.min(hi, Math.max(...hs) + 0.3), bot = Math.min(lo, Math.min(...hs)) - 0.3;
    if (top - bot < 0.4) continue;
    quad(face, [x0, bot, z0], [x1, bot, z1], [x1, top, z1], [x0, top, z0]);
    quad(cap, [x0 + nx, top + 0.02, z0 + nz], [x1 + nx, top + 0.02, z1 + nz], [x1 - nx, top + 0.02, z1 - nz], [x0 - nx, top + 0.02, z0 - nz]);
  }
  const mesh = (arr, color, name) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide }));
    m.name = name; m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  mesh(face, '#c4c1b8', 'walls_face');
  mesh(cap, '#bcb9b0', 'walls_cap');
  return group;
}
