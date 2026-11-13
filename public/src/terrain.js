// 地形 (国土地理院 標高タイルから作った data/terrain.json)。
// H(x, z) で地面の高さを返す。terrain.json が無ければ常に 0 (平らな地面)。
// 格子の各マスは (i,j)-(i+1,j+1) の対角線で2つの三角形に分ける。メッシュと H() は同じ補間なので、地面に置いた物が浮いたり埋まったりしない。
import * as THREE from 'three';

let T = null;

export function setTerrain(data) { T = data; }
export function hasTerrain() { return !!T; }

export function H(x, z) {
  if (!T) return 0;
  let fx = (x - T.minX) / T.step, fz = (z - T.minZ) / T.step;
  fx = Math.max(0, Math.min(T.nx - 1.0001, fx));
  fz = Math.max(0, Math.min(T.nz - 1.0001, fz));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const g = (ii, jj) => T.h[jj * T.nx + ii] / 100;
  const h00 = g(i, j), h10 = g(i + 1, j), h01 = g(i, j + 1), h11 = g(i + 1, j + 1);
  return u >= v ? h00 + u * (h10 - h00) + v * (h11 - h10) : h00 + v * (h01 - h00) + u * (h11 - h01);
}

// 地形メッシュ (頂点色で少し明暗をつける)
export function buildTerrainMesh(color = '#a4a296') {
  if (!T) return null;
  const { nx, nz, step, minX, minZ } = T;
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = (j * nx + i) * 3;
    pos[k] = minX + i * step; pos[k + 1] = T.h[j * nx + i] / 100; pos[k + 2] = minZ + j * step;
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, d, b, a, c, d); // 対角線 a-d (H() と同じ分割)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  m.name = 'terrain';
  m.receiveShadow = true;
  return m;
}

// 平らに作った面 (道路・エリア・路面標示など) を地形に沿わせる。
// 長い辺の三角形を細かく割ってから、各頂点に H() を足し、面法線を付け直す。
export function drape(geom, maxEdge = 3.5, lift = 0.12, skip = null) {
  if (!T || !geom) return geom;
  const g = geom.index ? geom.toNonIndexed() : geom;
  const names = Object.keys(g.attributes);
  const src = Object.fromEntries(names.map(n => [n, g.attributes[n]]));
  const out = Object.fromEntries(names.map(n => [n, []]));
  const P = src.position;
  const vert = (i) => Object.fromEntries(names.map(n => [n, Array.from({ length: src[n].itemSize }, (_, k) => src[n].array[i * src[n].itemSize + k])]));
  const mid = (a, b) => Object.fromEntries(names.map(n => [n, a[n].map((v, k) => (v + b[n][k]) / 2)]));
  const d2 = (a, b) => (a.position[0] - b.position[0]) ** 2 + (a.position[2] - b.position[2]) ** 2;
  const lim = maxEdge * maxEdge;
  const emit = (a, b, c, depth) => {
    const ab = d2(a, b), bc = d2(b, c), ca = d2(c, a), mx = Math.max(ab, bc, ca);
    if (mx > lim && depth < 12) {
      if (mx === ab) { const m = mid(a, b); emit(a, m, c, depth + 1); emit(m, b, c, depth + 1); }
      else if (mx === bc) { const m = mid(b, c); emit(a, b, m, depth + 1); emit(a, m, c, depth + 1); }
      else { const m = mid(c, a); emit(a, b, m, depth + 1); emit(m, b, c, depth + 1); }
      return;
    }
    if (skip && skip((a.position[0] + b.position[0] + c.position[0]) / 3, (a.position[2] + b.position[2] + c.position[2]) / 3)) return;
    for (const v of [a, b, c]) for (const n of names) out[n].push(...v[n]);
  };
  for (let i = 0; i < P.count; i += 3) emit(vert(i), vert(i + 1), vert(i + 2), 0);
  const pos = out.position;
  // lift: 地形メッシュとの補間差で地面が透けないよう少し持ち上げる
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] += H(pos[i], pos[i + 2]) + lift;
  if (out.normal) {
    for (let i = 0; i < pos.length; i += 9) {
      const ax = pos[i + 3] - pos[i], ay = pos[i + 4] - pos[i + 1], az = pos[i + 5] - pos[i + 2];
      const bx = pos[i + 6] - pos[i], by = pos[i + 7] - pos[i + 1], bz = pos[i + 8] - pos[i + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1;
      for (let k = 0; k < 3; k++) { out.normal[i + k * 3] = nx / l; out.normal[i + k * 3 + 1] = ny / l; out.normal[i + k * 3 + 2] = nz / l; }
    }
  }
  const res = new THREE.BufferGeometry();
  for (const n of names) res.setAttribute(n, new THREE.Float32BufferAttribute(out[n], src[n].itemSize));
  res.computeBoundingSphere();
  return res;
}
