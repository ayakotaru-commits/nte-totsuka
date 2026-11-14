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
// 各三角形を地形の三角形の辺 (格子線と対角線) で切り分けてから各頂点に H() を足す。
// 切り分けた各片は地形の三角形1枚の上に収まるので、どの層も地形と平行になり (lift の差がそのまま保たれ)、
// 重ねた層どうしが坂や土手で突き抜けない。maxEdge は互換のため残している (使わない)。
export function drape(geom, maxEdge = 3.5, lift = 0.12, skip = null) {
  if (!T || !geom) return geom;
  const g = geom.index ? geom.toNonIndexed() : geom;
  const names = Object.keys(g.attributes);
  const sizes = names.map(n => g.attributes[n].itemSize);
  const arrs = names.map(n => g.attributes[n].array);
  const W = sizes.reduce((a, b) => a + b, 0); // 1頂点あたりの値の数 (position が先頭)
  const pi = names.indexOf('position');
  const pOff = sizes.slice(0, pi).reduce((a, b) => a + b, 0);
  const out = names.map(() => []);
  const { step, minX, minZ, nx, nz } = T;
  const P = g.attributes.position;

  // 頂点 = [u, v, ...全属性] (u, v は格子座標)
  const vert = (i) => {
    const d = new Array(W + 2);
    let o = 2;
    for (let a = 0; a < names.length; a++) for (let k = 0; k < sizes[a]; k++) d[o++] = arrs[a][i * sizes[a] + k];
    d[0] = (d[2 + pOff] - minX) / step; d[1] = (d[2 + pOff + 2] - minZ) / step;
    return d;
  };
  const lerp = (a, b, t) => { const r = new Array(a.length); for (let k = 0; k < a.length; k++) r[k] = a[k] + (b[k] - a[k]) * t; return r; };
  // 直線族: u = k, v = k, u - v = k。範囲は地形の格子の内側だけ (外側は H() が端の値で一定)
  const fams = [
    [(d) => d[0], 0, nx - 1],
    [(d) => d[1], 0, nz - 1],
    [(d) => d[0] - d[1], -(nz - 1), nx - 1],
  ];
  // 凸多角形 poly を f = c で切って [f <= c 側, f >= c 側]
  const split = (poly, f, c) => {
    const lo = [], hi = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const fa = f(a) - c, fb = f(b) - c;
      if (fa <= 0) lo.push(a);
      if (fa >= 0) hi.push(a);
      if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) { const m = lerp(a, b, fa / (fa - fb)); lo.push(m); hi.push(m); }
    }
    return [lo, hi];
  };
  const emit = (poly) => {
    for (let i = 1; i < poly.length - 1; i++) {
      const tri = [poly[0], poly[i], poly[i + 1]];
      // つぶれた三角形は捨てる
      const ar = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[2][0] - tri[0][0]) * (tri[1][1] - tri[0][1]);
      if (Math.abs(ar) < 1e-9) continue;
      if (skip && skip((tri[0][2 + pOff] + tri[1][2 + pOff] + tri[2][2 + pOff]) / 3, (tri[0][4 + pOff] + tri[1][4 + pOff] + tri[2][4 + pOff]) / 3)) continue;
      for (const d of tri) {
        let o = 2;
        for (let a = 0; a < names.length; a++) for (let k = 0; k < sizes[a]; k++) out[a].push(d[o++]);
      }
    }
  };
  const cut = (poly, fi) => {
    if (poly.length < 3) return;
    if (fi === fams.length) { emit(poly); return; }
    const [f, kmin, kmax] = fams[fi];
    let lo = Infinity, hi = -Infinity;
    for (const d of poly) { const v = f(d); if (v < lo) lo = v; if (v > hi) hi = v; }
    let rest = poly;
    for (let k = Math.max(kmin, Math.floor(lo) + 1); k <= Math.min(kmax, Math.ceil(hi) - 1); k++) {
      const [a, b] = split(rest, f, k);
      cut(a, fi + 1);
      rest = b;
      if (rest.length < 3) return;
    }
    cut(rest, fi + 1);
  };
  for (let i = 0; i < P.count; i += 3) cut([vert(i), vert(i + 1), vert(i + 2)], 0);

  const pos = out[pi];
  // lift: 地面 (地形メッシュ) より少し上に出す
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] += H(pos[i], pos[i + 2]) + lift;
  const ni = names.indexOf('normal');
  if (ni >= 0) {
    const nrm = out[ni];
    for (let i = 0; i < pos.length; i += 9) {
      const ax = pos[i + 3] - pos[i], ay = pos[i + 4] - pos[i + 1], az = pos[i + 5] - pos[i + 2];
      const bx = pos[i + 6] - pos[i], by = pos[i + 7] - pos[i + 1], bz = pos[i + 8] - pos[i + 2];
      let x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx;
      if (y < 0) { x = -x; y = -y; z = -z; }
      const l = Math.hypot(x, y, z) || 1;
      for (let k = 0; k < 3; k++) { nrm[i + k * 3] = x / l; nrm[i + k * 3 + 1] = y / l; nrm[i + k * 3 + 2] = z / l; }
    }
  }
  const res = new THREE.BufferGeometry();
  names.forEach((n, a) => res.setAttribute(n, new THREE.Float32BufferAttribute(out[a], sizes[a])));
  res.computeBoundingSphere();
  return res;
}
