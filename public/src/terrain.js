// 地形 (国土地理院 標高タイルから作った data/terrain.json)。
// H(x, z) で地面の高さを返す。terrain.json が無ければ常に 0 (平らな地面)。
// 格子の各マスは (i,j)-(i+1,j+1) の対角線で2つの三角形に分ける。メッシュと H() は同じ補間なので、地面に置いた物が浮いたり埋まったりしない。
import * as THREE from 'three';

let T = null;

export function setTerrain(data) { T = data; }
export function hasTerrain() { return !!T; }

// 地面の種類 (data/cover.json。tools/lidar_cover.py が点群と航空写真から読んだもの)。地形の頂点ごとに 1 文字。
// 無ければ地面は一色のまま。格子が terrain.json と合わないときは使わない
let C = null;
export function setCover(data) { C = data && T && data.nx === T.nx && data.nz === T.nz ? data : null; }
export function hasCover() { return !!C; }
// 種類ごとの色 (cover.json の classes の名前)。none は元の地面の色
const COVER_COLOR = { grass: '#8aa364', paved: '#6e6f73', soil: '#b39c7a', woodfloor: '#6d8552', light: '#b3b0a8' };

// 地図の範囲の外の地形 (線路を東戸塚まで延ばした所。railext.js が登録する)。範囲の外で null を返さなければ、その値を使う
let EXT = null;
export function setTerrainExt(fn) { EXT = fn; }

export function H(x, z) {
  if (!T) return 0;
  let fx = (x - T.minX) / T.step, fz = (z - T.minZ) / T.step;
  if (EXT && (fx < 0 || fz < 0 || fx > T.nx - 1 || fz > T.nz - 1)) { const v = EXT(x, z); if (v != null) return v; }
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
  // 傾斜で色を変える: 急な所 (法面) は草の緑、さらに急な所 (擁壁・崖) はコンクリートの灰色にする。
  // 4m 格子では垂直な壁は表せないので、色で「ここは法面・擁壁」と分かるようにする
  const base = new THREE.Color(color), grass = new THREE.Color('#78895c'), wall = new THREE.Color('#aaa8a1'), c = new THREE.Color();
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const hh = (i, j) => T.h[Math.max(0, Math.min(nz - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))] / 100;
  // 地面の種類の色。種類の境目が格子のギザギザに見えないよう、隣の頂点と 1:2:1 でならしてから使う
  let cov = null;
  if (C) {
    const pal = C.classes.map((n) => new THREE.Color(COVER_COLOR[n] || color));
    const raw = new Float32Array(nx * nz * 3), tmp = new Float32Array(nx * nz * 3);
    for (let k = 0; k < nx * nz; k++) { const q = pal[C.c.charCodeAt(k) - 48] || base; raw[k * 3] = q.r; raw[k * 3 + 1] = q.g; raw[k * 3 + 2] = q.b; }
    const pass = (src, dst, di, n, len) => { // di = 隣の頂点までの添字の差, n = その方向の頂点数
      for (let k = 0; k < len; k++) {
        const pos = di === 1 ? k % nx : Math.floor(k / nx);
        const a = pos > 0 ? k - di : k, b2 = pos < n - 1 ? k + di : k;
        for (let ch = 0; ch < 3; ch++) dst[k * 3 + ch] = (src[a * 3 + ch] + 2 * src[k * 3 + ch] + src[b2 * 3 + ch]) / 4;
      }
    };
    pass(raw, tmp, 1, nx, nx * nz); pass(tmp, raw, nx, nz, nx * nz);
    cov = raw;
  }
  const col = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const gx = (hh(i + 1, j) - hh(i - 1, j)) / (2 * step), gz = (hh(i, j + 1) - hh(i, j - 1)) / (2 * step);
    const slope = Math.hypot(gx, gz);
    if (cov) c.setRGB(cov[(j * nx + i) * 3], cov[(j * nx + i) * 3 + 1], cov[(j * nx + i) * 3 + 2]); else c.copy(base);
    c.lerp(grass, sm(0.3, 0.6, slope) * 0.85).lerp(wall, sm(0.75, 1.05, slope));
    const k = (j * nx + i) * 3;
    col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  m.name = 'terrain';
  m.receiveShadow = true;
  return m;
}

// メモリを節約するモード (スマホ・タブレット。main.js が設定する)。地形に沿わせた面の法線と色を小さい型で持つ
let LOW_MEM = false;
export function setLowMemory(v) { LOW_MEM = !!v; }

// 伸びる型付き配列 (ふつうの配列に数を積むと、頂点が 1000 万個ある道路・エリアで数百 MB を使うため)
class Buf {
  constructor(Type, n = 1 << 16) { this.a = new Type(n); this.n = 0; }
  need(k) { if (this.n + k > this.a.length) { const b = new this.a.constructor(Math.max(this.a.length * 2, this.n + k)); b.set(this.a); this.a = b; } }
  done() { return this.a.slice(0, this.n); }
}

// 平らに作った面 (道路・エリア・路面標示など) を地形に沿わせる。
// 各三角形を地形の三角形の辺 (格子線と対角線) で切り分けてから各頂点に H() を足す。
// 切り分けた各片は地形の三角形1枚の上に収まるので、どの層も地形と平行になり (lift の差がそのまま保たれ)、
// 重ねた層どうしが坂や土手で突き抜けない。maxEdge は互換のため残している (使わない)。
// 切り分けた片どうしが共有する頂点は 1 つにまとめる (元の三角形 1 枚の中で。index 付きの形になる)。
// 法線は地形の傾き (地形メッシュと同じなめらかな陰影)。opts.drop = ['uv'] のように、使わない属性を捨てられる
export function drape(geom, maxEdge = 3.5, lift = 0.12, skip = null, opts = {}) {
  if (!T || !geom) return geom;
  const g = geom.index ? geom.toNonIndexed() : geom;
  const drop = opts.drop || [];
  const hasNormal = !!g.attributes.normal;
  const names = Object.keys(g.attributes).filter(n => n !== 'normal' && !drop.includes(n)); // 法線は最後に地形から作る
  const sizes = names.map(n => g.attributes[n].itemSize);
  const arrs = names.map(n => g.attributes[n].array);
  const W = sizes.reduce((a, b) => a + b, 0); // 1頂点あたりの値の数
  const pi = names.indexOf('position');
  const pOff = sizes.slice(0, pi).reduce((a, b) => a + b, 0);
  const out = names.map(() => new Buf(Float32Array));
  const index = new Buf(Uint32Array);
  let count = 0; // 出力した頂点の数
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
  // 頂点の番号。元の三角形 1 枚の中で同じ位置 (格子の 1/4096 = 約 0.5 mm 単位) なら同じ番号を返す
  const seen = new Map();
  const id = (d) => {
    const key = Math.round(d[0] * 4096) * 8388608 + Math.round(d[1] * 4096);
    let i = seen.get(key);
    if (i === undefined) {
      i = count++;
      seen.set(key, i);
      let o = 2;
      for (let a = 0; a < names.length; a++) {
        const b = out[a]; b.need(sizes[a]);
        for (let k = 0; k < sizes[a]; k++) b.a[b.n++] = d[o++];
      }
    }
    return i;
  };
  const emit = (poly) => {
    for (let i = 1; i < poly.length - 1; i++) {
      const tri = [poly[0], poly[i], poly[i + 1]];
      // つぶれた三角形は捨てる
      const ar = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[2][0] - tri[0][0]) * (tri[1][1] - tri[0][1]);
      if (Math.abs(ar) < 1e-9) continue;
      if (skip && skip((tri[0][2 + pOff] + tri[1][2 + pOff] + tri[2][2 + pOff]) / 3, (tri[0][4 + pOff] + tri[1][4 + pOff] + tri[2][4 + pOff]) / 3)) continue;
      const a = id(tri[0]), b = id(tri[1]), c = id(tri[2]);
      if (a === b || b === c || a === c) continue;
      index.need(3);
      index.a[index.n++] = a; index.a[index.n++] = b; index.a[index.n++] = c;
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
  for (let i = 0; i < P.count; i += 3) { seen.clear(); cut([vert(i), vert(i + 1), vert(i + 2)], 0); }

  const res = new THREE.BufferGeometry();
  const pos = out[pi].done();
  // 法線: 地形の傾きから (隣の格子点までの高さの差)。lift の前に計算する
  if (hasNormal) {
    const N = LOW_MEM ? new Int8Array(count * 3) : new Float32Array(count * 3), s = LOW_MEM ? 127 : 1;
    for (let i = 0; i < count; i++) {
      const x = pos[i * 3], z = pos[i * 3 + 2];
      const gx = (H(x + step, z) - H(x - step, z)) / (2 * step), gz = (H(x, z + step) - H(x, z - step)) / (2 * step);
      const l = Math.hypot(gx, 1, gz);
      N[i * 3] = -gx / l * s; N[i * 3 + 1] = 1 / l * s; N[i * 3 + 2] = -gz / l * s;
    }
    res.setAttribute('normal', new THREE.BufferAttribute(N, 3, LOW_MEM));
  }
  // lift: 地面 (地形メッシュ) より少し上に出す
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] += H(pos[i], pos[i + 2]) + lift;
  names.forEach((n, a) => {
    const arr = a === pi ? pos : out[a].done();
    if (n === 'color' && LOW_MEM) { // 色は 16 ビットで持つ (8 ビットだと暗い色がずれる)
      const c = new Uint16Array(arr.length);
      for (let i = 0; i < arr.length; i++) c[i] = Math.round(Math.max(0, Math.min(1, arr[i])) * 65535);
      res.setAttribute(n, new THREE.BufferAttribute(c, sizes[a], true));
    } else res.setAttribute(n, new THREE.BufferAttribute(arr, sizes[a]));
  });
  res.setIndex(new THREE.BufferAttribute(index.done(), 1));
  res.computeBoundingSphere();
  return res;
}
