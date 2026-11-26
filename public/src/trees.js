// 街の木: 葉の小さな板 (アルファ抜き) を重ねた木を、種類ごとに InstancedMesh で置く。
// 位置・高さは点群の実測、色は航空写真、種類は点群の形から読んだもの (tools/build_props.py の trees、tools/tree_traits.py)。
//   trees: [x, z, y, 高さの倍率, 0〜1 の乱数, 葉の色 0xRRGGBB (省略可), 種類 (省略 = 0), 幅の倍率 (省略 = 1)]
// 種類: 0 広葉樹 (丸い) / 1 針葉樹 (円すい) / 2 細い木 (並木・高い) / 3 低木
// 近い木 (NEAR 以内) だけ葉の板の形。遠い木は 20 面ほどの簡単な形 (カメラが動くたびに入れ替える。update())。
import * as THREE from 'three';
import { LOW_MEM } from './lowmem.js';

const NEAR = LOW_MEM ? 50 : 85;   // 葉の板の形で描く距離 (m)
const BASE_H = [4.9, 5.0, 5.2, 1.7];   // 種類ごとの、倍率 1 のときの高さ (m)
const KINDS = 4;
const FAR_DIM = 0.7;
const NEAR_GAIN = 1.2;   // 近い木は葉の板の重なりで暗くなる分を明るく

let seed = 1;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ---- 葉の模様 (1 枚の板に小さな葉をたくさん描く。色は灰色〜白の濃淡で、木ごとの色を掛ける) ----
function leafTexture(needle) {
  const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d');
  seed = needle ? 91 : 7;
  const n = needle ? 330 : 240;   // 板の面積の 6 割ほどを葉で埋める (遠くで縮んでも消えないように)
  for (let i = 0; i < n; i++) {
    const x = N * (0.06 + rnd() * 0.88), y = N * (0.06 + rnd() * 0.88);
    const L = needle ? 14 + rnd() * 10 : 11 + rnd() * 8, W = needle ? L * 0.14 : L * 0.5, rot = rnd() * 6.283, v = 185 + rnd() * 70;
    g.save(); g.translate(x, y); g.rotate(rot);
    g.fillStyle = `rgb(${v * 0.96 | 0},${v | 0},${v * 0.84 | 0})`;
    g.beginPath();
    if (needle) { g.ellipse(0, 0, L, W, 0, 0, 6.283); } else {  // 先のとがった葉
      g.moveTo(-L, 0); g.quadraticCurveTo(-L * 0.2, -W, L, 0); g.quadraticCurveTo(-L * 0.2, W, -L, 0);
    }
    g.fill();
    if (!needle) { g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(-L, 0); g.lineTo(L * 0.8, 0); g.stroke(); }
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ---- 形の小道具 ----
function merge(geos) {   // 形をつなぐ (index なし)
  const pos = [], nor = [], col = [], uv = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
    if (g.attributes.uv) uv.push(...g.attributes.uv.array); else for (let i = 0; i < g.attributes.position.count; i++) uv.push(0, 0);
    if (g.attributes.color) col.push(...g.attributes.color.array); else for (let i = 0; i < g.attributes.position.count; i++) col.push(1, 1, 1);
  }
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  r.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  r.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  r.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return r;
}

// 葉の板を、形の指定 (shape(): 中心 → 点と外向き) に従って n 枚重ねる
function crown({ n, half, tex, needle, pick, droop = 0, seedv }) {
  seed = seedv;
  const pos = [], nor = [], uv = [], col = [], idx = [];
  for (let k = 0; k < n; k++) {
    const { c, out, shade } = pick(k, n);
    const nq = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    const nn = out.clone().multiplyScalar(0.75).add(nq.multiplyScalar(0.45)); nn.y -= droop; nn.normalize();
    const t1 = new THREE.Vector3().crossVectors(nn, Math.abs(nn.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
    const t2 = new THREE.Vector3().crossVectors(nn, t1);
    const h = half[0] + rnd() * (half[1] - half[0]), rot = rnd() * 6.283;
    const e1 = t1.clone().multiplyScalar(Math.cos(rot)).addScaledVector(t2, Math.sin(rot)).multiplyScalar(h);
    const e2 = new THREE.Vector3().crossVectors(nn, e1).normalize().multiplyScalar(h * (needle ? 1.1 : 1));
    const base = pos.length / 3;
    for (const [a, b, u, v] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
      const p = c.clone().addScaledVector(e1, a).addScaledVector(e2, b);
      pos.push(p.x, p.y, p.z); nor.push(out.x, out.y, out.z); uv.push(u, v); col.push(shade, shade, shade);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// 楕円体の中に散らす (奥は暗く、上は明るく)
function ellipsoid(cy, R, n, half, seedv, shell = 0.5) {
  const C = new THREE.Vector3(0, cy, 0);
  return crown({
    n, half, seedv,
    pick: () => {
      let d; do { d = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); } while (d.lengthSq() > 1 || d.lengthSq() < 0.01);
      const out = d.clone().normalize();
      const f = shell + (1 - shell) * Math.sqrt(rnd());   // 表面近くに多く、中にも少し
      const c = new THREE.Vector3(out.x * R[0] * f, out.y * R[1] * f, out.z * R[2] * f).add(C);
      return { c, out: new THREE.Vector3(out.x / R[0], out.y / R[1], out.z / R[2]).normalize(), shade: 0.74 + 0.26 * f + 0.12 * Math.max(0, out.y) };
    },
  });
}

// 円すい (y0〜y1 に、底の半径 r0 から先へ細くなる)。枝が段になって垂れる
function cone(y0, y1, r0, n, half, seedv) {
  return crown({
    n, half, seedv, needle: true, droop: 0.35,
    pick: (k) => {
      const t = Math.pow(rnd(), 0.8);                  // 0 = 下, 1 = 先
      const y = y0 + (y1 - y0) * t, r = r0 * (1 - t) * (0.55 + 0.45 * Math.sqrt(rnd()));
      const a = rnd() * 6.283, c = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      const out = new THREE.Vector3(Math.cos(a), 0.45, Math.sin(a)).normalize();
      return { c, out, shade: 0.7 + 0.3 * (r / r0 + 0.2) + 0.1 * t };
    },
  });
}

function trunkGeo(h, r0, r1, branches) {
  const parts = [new THREE.CylinderGeometry(r1, r0, h, 6).translate(0, h / 2, 0)];
  let s = 5;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < branches; i++) {   // 葉むらの間からのぞく枝
    const a = (i / branches) * 6.283 + r(), len = 1.0 + r() * 0.8, tilt = 0.55 + r() * 0.35, y0 = h * (0.85 + r() * 0.15);
    const b = new THREE.CylinderGeometry(0.025, 0.06, len, 4).translate(0, len / 2, 0);
    b.rotateZ(tilt); b.rotateY(a); b.translate(0, y0, 0);
    parts.push(b);
  }
  return merge(parts);
}

function farGeo(kind) {
  let g;
  if (kind === 1) g = new THREE.ConeGeometry(1.35, 4.2, 6).translate(0, 3.0, 0);
  else if (kind === 2) g = new THREE.IcosahedronGeometry(1, 0).scale(1.0, 1.9, 1.0).translate(0, 3.2, 0);
  else if (kind === 3) g = new THREE.IcosahedronGeometry(1, 0).scale(1.25, 0.8, 1.25).translate(0, 0.8, 0);
  else g = new THREE.IcosahedronGeometry(1, 0).scale(1.7, 1.4, 1.7).translate(0, 3.3, 0);
  return g;
}

function buildKinds() {
  const broad = leafTexture(false), needle = leafTexture(true);
  const lowQ = LOW_MEM ? 0.6 : 1;
  const mat = (map) => new THREE.MeshStandardMaterial({ color: '#ffffff', map, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.85, vertexColors: true });
  const matBroad = mat(broad), matNeedle = mat(needle);
  const farMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true });
  return [
    { crown: ellipsoid(3.3, [1.55, 1.3, 1.55], Math.round(52 * lowQ), [0.5, 0.75], 11), mat: matBroad, trunk: trunkGeo(2.4, 0.15, 0.1, 3) },
    { crown: cone(1.1, 5.0, 1.4, Math.round(46 * lowQ), [0.5, 0.75], 23), mat: matNeedle, trunk: trunkGeo(1.6, 0.16, 0.1, 0) },
    { crown: ellipsoid(3.2, [0.95, 1.9, 0.95], Math.round(44 * lowQ), [0.4, 0.62], 37), mat: matBroad, trunk: trunkGeo(2.2, 0.16, 0.1, 2) },
    { crown: ellipsoid(0.8, [1.3, 0.8, 1.3], Math.round(26 * lowQ), [0.4, 0.6], 51), mat: matBroad, trunk: trunkGeo(0.3, 0.1, 0.08, 0) },
  ].map((k, i) => ({ ...k, far: farGeo(i), farMat }));
}

export class TreeLayer {
  constructor(spots) {
    this.group = new THREE.Group(); this.group.name = 'trees';
    this.n = spots.length;
    this.hidden = new Set();
    this.last = null; this.dirty = true;
    const kinds = buildKinds();
    const kindOf = (t) => Math.min(KINDS - 1, Math.max(0, (t[6] | 0)));
    this.ids = Array.from({ length: KINDS }, () => []);
    spots.forEach((t, i) => this.ids[kindOf(t)].push(i));
    // 木ごとの行列と色を前もって作る (入れ替えのときは配列をコピーするだけ)
    this.mat = new Float32Array(this.n * 16);
    this.matT = new Float32Array(this.n * 16);   // 幹用 (幅の倍率を掛けない。木が横に広くても幹は太くならない)
    this.rgb = new Float32Array(this.n * 3);
    this.xz = new Float32Array(this.n * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), Y = new THREE.Vector3(0, 1, 0);
    spots.forEach((t, i) => {
      const [x, z, y, sc, r, rgb, , wr] = t;
      const w = sc * (wr || 1);
      q.setFromAxisAngle(Y, r * 6.283);
      m.compose(p.set(x, y, z), q, s.set(w, sc, w));
      m.toArray(this.mat, i * 16);
      m.compose(p, q, s.set(sc, sc, sc)); m.toArray(this.matT, i * 16);
      if (rgb != null) c.setRGB((rgb >> 16 & 255) / 255, (rgb >> 8 & 255) / 255, (rgb & 255) / 255, THREE.SRGBColorSpace);
      else c.setHSL(0.24 + r * 0.08, 0.45, 0.28 + r * 0.12);
      this.rgb.set([c.r, c.g, c.b], i * 3);
      this.xz[i * 2] = x; this.xz[i * 2 + 1] = z;
    });
    this.meshes = [];   // 種類ごと { trunk, near, far, ids }
    kinds.forEach((k, ki) => {
      const cap = this.ids[ki].length;
      const mk = (geo, material, name, shadow) => {
        const im = new THREE.InstancedMesh(geo, material, Math.max(1, cap));
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
        im.instanceColor.setUsage(THREE.DynamicDrawUsage);
        im.count = 0; im.castShadow = shadow; im.receiveShadow = true; im.frustumCulled = false; im.name = name;
        this.group.add(im);
        return im;
      };
      this.meshes.push({
        trunk: mk(k.trunk, trunkMatShared(), 'trees_trunk' + ki, true),
        near: mk(k.crown, k.mat, 'trees_crown' + ki, true),
        far: mk(k.far, k.farMat, 'trees_far' + ki, true),
      });
    });
    this.group.userData.layer = this;
  }

  // 木を見せない・見せる (イベントの舞台の中など)。ids = 木の番号の配列
  hide(ids) { for (const i of ids) this.hidden.add(i); this.dirty = true; }
  showAll() { this.hidden.clear(); this.dirty = true; }
  // 位置が (x0..x1, z0..z1) に入る木の番号
  inBox(test) { const r = []; for (let i = 0; i < this.n; i++) if (test(this.xz[i * 2], this.xz[i * 2 + 1])) r.push(i); return r; }

  update(camera) {
    const cx = camera.position.x, cz = camera.position.z;
    if (!this.dirty && this.last && (cx - this.last[0]) ** 2 + (cz - this.last[1]) ** 2 < 15 * 15) return;
    this.last = [cx, cz]; this.dirty = false;
    const N2 = NEAR * NEAR;
    this.meshes.forEach((M, ki) => {
      let nn = 0, nf = 0;
      for (const i of this.ids[ki]) {
        if (this.hidden.has(i)) continue;
        const dx = this.xz[i * 2] - cx, dz = this.xz[i * 2 + 1] - cz;
        const near = dx * dx + dz * dz < N2;
        const A = near ? M.near : M.far;
        const k = near ? nn++ : nf++;
        A.instanceMatrix.array.set(this.mat.subarray(i * 16, i * 16 + 16), k * 16);
        const f = near ? NEAR_GAIN : FAR_DIM;   // 遠い木は、葉の影が無い分明るく見えるので少し暗くする
        A.instanceColor.array.set([this.rgb[i * 3] * f, this.rgb[i * 3 + 1] * f, this.rgb[i * 3 + 2] * f], k * 3);
        if (near) M.trunk.instanceMatrix.array.set(this.matT.subarray(i * 16, i * 16 + 16), (nn - 1) * 16);
      }
      // 幹は近い木だけでなく遠い木にも要る: 遠い木の幹は、近い木のあとに続けて入れる
      let tk = nn;
      for (const i of this.ids[ki]) {
        if (this.hidden.has(i)) continue;
        const dx = this.xz[i * 2] - cx, dz = this.xz[i * 2 + 1] - cz;
        if (dx * dx + dz * dz < N2) continue;
        M.trunk.instanceMatrix.array.set(this.matT.subarray(i * 16, i * 16 + 16), tk * 16);
        M.trunk.instanceColor.array.set([1, 1, 1], tk * 3); tk++;
      }
      for (let k = 0; k < nn; k++) M.trunk.instanceColor.array.set([1, 1, 1], k * 3);
      M.near.count = nn; M.far.count = nf; M.trunk.count = tk;
      for (const im of [M.near, M.far, M.trunk]) { im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; }
    });
  }
}

let _trunkMat = null;
function trunkMatShared() { return _trunkMat || (_trunkMat = new THREE.MeshStandardMaterial({ color: '#5e4a38', roughness: 1 })); }
