// 線路の延長 (地図の北の端 → 東戸塚駅・保土ケ谷駅・横浜駅の先。data/rail_ext/ = tools/rail_ext.py → tools/rail_ext_split.py)。
// 電車の窓から見える範囲だけを作る: 線路の近くの地形 (5 m 間隔) と建物 (PLATEAU の輪郭と高さの箱)、その外の粗い地形 (25 m 間隔)、
// 線路 (砕石・枕木・レール)・架線柱・架線・道路・木・坑口、延ばした先の駅のホーム (ホームの上だけ歩ける。縁に見えない柵)。
// 区間ごとの読み込み (舞浜までの計画の段階 1): index.json (道筋・駅・下絵) を最初に読み、地形・建物などは 1 km 四方の区間 (c_<a>_<b>.json) ごとに、
// カメラから LOAD_R 以内の区間だけを読んで作り、UNLOAD_R より離れたら捨てる (update() を毎コマ呼ぶ)。駅のホームと当たり判定は最初から全部作る。
// 区間に分けても描いた結果は分ける前と同じ (法線は隣の升目まで含めて計算、色の乱数の種と木の通し番号はファイルに入っている)。
// 地図の範囲の外の地形の高さを terrain.js に登録し (読み込んだ区間だけ。読み込み前の区間は -200 m、区間の無い所は地図の端の高さ)、当たり判定の範囲 (world.bounds) を延長の端まで広げる。
import * as THREE from 'three';
import { setTerrainExt } from '../terrain.js';
import { buildStation } from './station.js';
import { canvasTexture } from './util.js';
import { releaseGeometryAfterUpload } from '../lowmem.js';

const RAIL_TOP = 0.55;   // レールの上面 (地面から)。tools/rail_ext.py と同じ
const UCELL = 10, UPAD = 2;   // 市街地の升目 (tools/rail_ext_split.py と同じ)

const unbits = (s, n) => { const b = atob(s), out = new Uint8Array(n); for (let k = 0; k < n; k++) out[k] = (b.charCodeAt(k >> 3) >> (k & 7)) & 1; return out; };

// 格子 (原点 lo・間隔 step・升目 n 個) の升目のうち、中心が [a CH, (a+1) CH) にあるものの番号の範囲 (rail_ext_split.py の cell_range と同じ)
function cellRange(lo, step, n, a, CH) {
  return [Math.max(0, Math.ceil((a * CH - lo) / step - 0.5)), Math.min(n, Math.ceil(((a + 1) * CH - lo) / step - 0.5))];
}

// 頂点の格子 (gx[i], gz[j] は位置、get(i, j) は高さ or NaN) と、升目の有無 has(i, j) から、three.js の computeVertexNormals と同じ法線
// (隣の升目の三角形の面積で重みを付けた和) を出す。範囲 [i0, i1] × [j0, j1] の頂点ごと
function gridNormals(ni, nj, P, has) {
  const N = new Float32Array(ni * nj * 3);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), cb = new THREE.Vector3(), ab = new THREE.Vector3();
  const add = (k) => { N[k * 3] += cb.x; N[k * 3 + 1] += cb.y; N[k * 3 + 2] += cb.z; };
  const tri = (A, B, C) => {
    va.fromArray(P, A * 3); vb.fromArray(P, B * 3); vc.fromArray(P, C * 3);
    cb.subVectors(vc, vb); ab.subVectors(va, vb); cb.cross(ab);
    add(A); add(B); add(C);
  };
  for (let j = 0; j < nj - 1; j++) for (let i = 0; i < ni - 1; i++) {
    if (!has(i, j)) continue;
    const a = j * ni + i, b = a + 1, c = a + ni, d = c + 1;
    tri(a, c, d); tri(a, d, b);
  }
  for (let k = 0; k < ni * nj; k++) {
    const x = N[k * 3], y = N[k * 3 + 1], z = N[k * 3 + 2], L = Math.hypot(x, y, z) || 1;
    N[k * 3] = x / L; N[k * 3 + 1] = y / L; N[k * 3 + 2] = z / L;
  }
  return N;
}

export function buildRailExt(ext, world, mainBounds, opts = {}) {
  const low = !!opts.low;
  const base = opts.base || 'data/rail_ext/';
  const LOAD_R = opts.loadR || (low ? 2200 : 3000), UNLOAD_R = LOAD_R + 600;   // カメラから区間 (1 km 四方) までの距離
  const group = new THREE.Group();
  group.name = 'rail_ext';
  const CH = ext.chunk, T = ext.terrain, C = ext.coarse;
  const inMain = (x, z) => x > mainBounds.minX && x < mainBounds.maxX && z > mainBounds.minZ && z < mainBounds.maxZ;
  const keyOf = (a, b) => a + '_' + b;
  const loaded = new Map();   // key → 区間 (読み込んで作ったもの)
  const exists = new Set(ext.chunks.map(([a, b]) => keyOf(a, b)));
  const UNLOADED_Y = -200;

  // ---------- 地形の高さ: 読み込んだ区間の細かい格子 → 無ければ粗い格子 → 区間が無ければ null (地図の端の高さ) ----------
  const fineOf = (c, i, j) => {
    const F = c.fine; if (!F) return undefined;
    const ii = i - F.i0, jj = j - F.j0;
    if (ii < 0 || jj < 0 || ii >= F.ni || jj >= F.nj) return undefined;
    const v = F.h[jj * F.ni + ii]; return Number.isNaN(v) ? undefined : v;
  };
  const coarseOf = (c, x, z) => {
    const K = c.coarse; if (!K) return null;
    let fx = (x - C.x0) / C.step, fz = (z - C.z0) / C.step;
    fx = Math.max(0, Math.min(C.nx - 1.0001, fx)); fz = Math.max(0, Math.min(C.nz - 1.0001, fz));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const ii = i - K.i0, jj = j - K.j0;
    if (ii < 0 || jj < 0 || ii + 1 >= K.ni || jj + 1 >= K.nj) return null;
    const g = (a, b) => K.h[(jj + b) * K.ni + ii + a] / 100;
    return (g(0, 0) * (1 - u) + g(1, 0) * u) * (1 - v) + (g(0, 1) * (1 - u) + g(1, 1) * u) * v;
  };
  const H = (x, z) => {
    const key = keyOf(Math.floor(x / CH), Math.floor(z / CH)), c = loaded.get(key);
    if (c) return sampleIn(c, x, z);
    // まだ読み込んでいない区間: ずっと下 (地図の端の高さにすると、ワープ・降車でホームより高い所に立ってしまう。ホームの床は最初からある)
    return exists.has(key) ? UNLOADED_Y : null;
  };
  setTerrainExt(H);

  // ---------- 区間どうしで使い回す材質・形 ----------
  const GRASS = new THREE.Color('#7d905c'), TOWN = new THREE.Color('#9b988d'), FAR = new THREE.Color('#6f8156'), tmp = new THREE.Color();
  const win = canvasTexture(64, 64, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#5d6670'; g.fillRect(14, 16, 36, 26);
    g.fillStyle = '#d8d8d4'; g.fillRect(0, 56, 64, 8);
  });
  win.wrapS = win.wrapT = THREE.RepeatWrapping;
  const MAT = {
    fine: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
    far: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    walls: new THREE.MeshStandardMaterial({ map: win, vertexColors: true, roughness: 0.85 }),
    roofs: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
    ballast: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    rails: new THREE.MeshStandardMaterial({ color: '#a9a9a6', roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide }),
    sleeper: new THREE.MeshStandardMaterial({ color: '#9b978f', roughness: 0.9 }),
    wire: new THREE.LineBasicMaterial({ color: '#2a2d30' }),
    pole: new THREE.MeshStandardMaterial({ color: '#7b8084', roughness: 0.6, metalness: 0.5 }),
    road: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    trunk: new THREE.MeshStandardMaterial({ color: '#6b5540', roughness: 1 }),
    crown: new THREE.MeshStandardMaterial({ color: '#56743d', roughness: 1, flatShading: true }),
    conc: new THREE.MeshStandardMaterial({ color: '#a8a59c', roughness: 0.9 }),
    dark: new THREE.MeshBasicMaterial({ color: '#0c0c0c', side: THREE.DoubleSide }),
  };
  const GEO = {   // 区間を捨てても dispose しない
    sleeper: new THREE.BoxGeometry(2.2, 0.14, 0.22),
    post: new THREE.BoxGeometry(0.25, 7.2, 0.25).translate(0, 3.6, 0),
    arm: new THREE.BoxGeometry(2.8, 0.12, 0.12).translate(-1.3, 6.4, 0),
    trunk: new THREE.CylinderGeometry(0.18, 0.25, 2.6, 6).translate(0, 1.3, 0),
    crown: new THREE.IcosahedronGeometry(2.6, 0).translate(0, 4.2, 0),
  };
  const shared = new Set(Object.values(GEO));
  const WALLS = ['#e7e1d4', '#d9d4c8', '#cfd3d6', '#e9e6df', '#c9bfae', '#d6cbb8', '#bfc5c9', '#ece8dc'];
  const ROOFS = ['#8d8f91', '#7f8486', '#9a9892', '#6f7477', '#a39e93'];

  // 線路の線分を区間ごとに (線分の中点の区間)。道筋は index.json に全部ある
  const segsOf = new Map();
  ext.routes.forEach((r, ri) => {
    for (let k = 0; k < r.p.length - 1; k++) {
      const a = r.p[k], b = r.p[k + 1], key = keyOf(Math.floor((a[0] + b[0]) / 2 / CH), Math.floor((a[2] + b[2]) / 2 / CH));
      if (!segsOf.has(key)) segsOf.set(key, []);
      segsOf.get(key).push(ri, k);
    }
  });
  const near = new Set();   // 線路の 3 m 以内 (4 m 四方の升目。道路を省く所)
  for (const r of ext.routes) for (const q of r.p) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) near.add((Math.floor(q[0] / 4) + i) * 100000 + Math.floor(q[2] / 4) + j);

  // ---------- 区間を作る ----------
  function buildChunk(a, b, D) {
    const g = new THREE.Group();
    g.name = 'ext_chunk_' + keyOf(a, b);
    const c = { a, b, key: keyOf(a, b), group: g, map: { rows: [], roads: D.roads, buildings: D.buildings.map((q) => q[0]) } };
    building = c;
    const mesh = (geo, mat, name, cast = false, recv = true) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.castShadow = cast; m.receiveShadow = recv; g.add(m); return m; };

    // 市街地 (建物の近く) は灰色がかった地面、それ以外は草地の色
    const N = CH / UCELL + 2 * UPAD, ub = D.urban ? unbits(D.urban, N * N) : null, ui0 = a * (CH / UCELL) - UPAD, uj0 = b * (CH / UCELL) - UPAD;
    const isUrban = (x, z) => {
      if (!ub) return false;
      const i = Math.floor(x / UCELL) - ui0, j = Math.floor(z / UCELL) - uj0;
      return i >= 0 && j >= 0 && i < N && j < N && ub[j * N + i] === 1;
    };
    const groundColor = (x, z, far) => {
      const n = Math.sin(x * 0.031) * Math.sin(z * 0.027) * 0.06 + Math.sin(x * 0.11 + z * 0.07) * 0.03;
      tmp.copy(far ? FAR : isUrban(x, z) ? TOWN : GRASS);
      return tmp.multiplyScalar(1 + n);
    };

    // 細かい地形: 頂点の窓 (区間の升目 + まわり 1 升) を格子に並べ、区間の升目だけを描く
    if (D.fine) {
      const [ci0, cj0, ci1, cj1] = D.fine.own, i0 = ci0 - 1, j0 = cj0 - 1, ni = ci1 - ci0 + 3, nj = cj1 - cj0 + 3;
      const h = new Float32Array(ni * nj).fill(NaN);
      for (const row of D.fine.rows) {
        const jj = row[0] - j0;
        for (let k = 2; k < row.length; k++) h[jj * ni + row[1] + k - 2 - i0] = row[k] / 100;
        c.map.rows.push([row[0], row[1], row.length - 2]);
      }
      c.fine = { i0, j0, ni, nj, h };
      const ok = (i, j) => !Number.isNaN(h[j * ni + i]);
      const has = (i, j) => ok(i, j) && ok(i + 1, j) && ok(i, j + 1) && ok(i + 1, j + 1) && !inMain(T.x0 + (i0 + i + 0.5) * T.step, T.z0 + (j0 + j + 0.5) * T.step);
      const P = new Float32Array(ni * nj * 3);
      for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) { const k = (j * ni + i) * 3; P[k] = T.x0 + (i0 + i) * T.step; P[k + 1] = h[j * ni + i]; P[k + 2] = T.z0 + (j0 + j) * T.step; }
      const NN = gridNormals(ni, nj, P, has);
      const pos = [], nor = [], col = [], idx = [], vid = new Int32Array(ni * nj).fill(-1);
      const vert = (i, j) => {
        const k = j * ni + i;
        if (vid[k] < 0) {
          vid[k] = pos.length / 3;
          pos.push(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]); nor.push(NN[k * 3], NN[k * 3 + 1], NN[k * 3 + 2]);
          const cl = groundColor(P[k * 3], P[k * 3 + 2], false); col.push(cl.r, cl.g, cl.b);
        }
        return vid[k];
      };
      for (let j = 1; j < nj - 2; j++) for (let i = 1; i < ni - 2; i++) {
        if (!has(i, j)) continue;
        const A = vert(i, j), B = vert(i + 1, j), Cc = vert(i, j + 1), Dd = vert(i + 1, j + 1);
        idx.push(A, Cc, Dd, A, Dd, B);
      }
      if (idx.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        geo.setIndex(idx);
        mesh(geo, MAT.fine, 'ext_terrain');
      }
    }
    // 粗い地形 (細かい格子と地図の範囲の升目は除いてある。継ぎ目が見えないよう少し下げる)
    if (D.coarse) {
      const K = D.coarse, ni = K.ni, nj = K.nj, cells = unbits(K.cells, (ni - 1) * (nj - 1));
      c.coarse = { i0: K.i0, j0: K.j0, ni, nj, h: Float32Array.from(K.h) };
      const P = new Float32Array(ni * nj * 3);
      for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) { const k = (j * ni + i) * 3; P[k] = C.x0 + (K.i0 + i) * C.step; P[k + 1] = K.h[j * ni + i] / 100 - 0.8; P[k + 2] = C.z0 + (K.j0 + j) * C.step; }
      const has = (i, j) => cells[j * (ni - 1) + i] === 1;
      const NN = gridNormals(ni, nj, P, has);
      const [oi0, oj0, oi1, oj1] = K.own, pos = [], nor = [], col = [], idx = [], vid = new Int32Array(ni * nj).fill(-1);
      const vert = (i, j) => {
        const k = j * ni + i;
        if (vid[k] < 0) {
          vid[k] = pos.length / 3;
          pos.push(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]); nor.push(NN[k * 3], NN[k * 3 + 1], NN[k * 3 + 2]);
          const cl = groundColor(P[k * 3], P[k * 3 + 2], true); col.push(cl.r, cl.g, cl.b);
        }
        return vid[k];
      };
      for (let j = oj0 - K.j0; j < oj1 - K.j0; j++) for (let i = oi0 - K.i0; i < oi1 - K.i0; i++) {
        if (!has(i, j)) continue;
        const A = vert(i, j), B = vert(i + 1, j), Cc = vert(i, j + 1), Dd = vert(i + 1, j + 1);
        idx.push(A, Cc, Dd, A, Dd, B);
      }
      if (idx.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        geo.setIndex(idx);
        mesh(geo, MAT.far, 'ext_terrain_far');
      }
    }

    // 建物: 輪郭を高さまで立ち上げた箱。壁に窓の模様 (3 m 四方に 1 つ)、平らな屋根
    if (D.buildings.length) {
      const wp = [], wn = [], wu = [], wc = [], rp = [], rc = [];
      const cl = new THREE.Color();
      for (const [ring0, bse, h, lift, seed0] of D.buildings) {
        let seed = seed0;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        let ring = ring0;
        // 反時計回り (上から見て) にそろえる
        let A = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; A += p[0] * q[1] - q[0] * p[1]; }
        if (A > 0) ring = ring.slice().reverse();
        const y0 = bse + (lift || 0), y1 = bse + h;
        cl.set(WALLS[Math.floor(rnd() * WALLS.length)]).multiplyScalar(0.92 + rnd() * 0.12);
        const house = h < 10;
        let u = 0;
        for (let i = 0; i < ring.length; i++) {
          const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length], L = Math.hypot(bx - ax, bz - az);
          if (L < 0.05) continue;
          const nx = (bz - az) / L, nz = -(bx - ax) / L;
          const u0 = u / 3, u1 = (u + L) / 3, v0 = (y0 - bse) / 3, v1 = (y1 - bse) / 3;
          const quad = [[ax, y0, az, u0, v0], [bx, y0, bz, u1, v0], [bx, y1, bz, u1, v1], [ax, y0, az, u0, v0], [bx, y1, bz, u1, v1], [ax, y1, az, u0, v1]];
          for (const [x, y, z, uu, vv] of quad) { wp.push(x, y, z); wn.push(-nx, 0, -nz); wu.push(house ? uu * 0.8 : uu, vv); wc.push(cl.r, cl.g, cl.b); }
          u += L;
        }
        // 屋根
        const tri = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
        cl.set(ROOFS[Math.floor(rnd() * ROOFS.length)]);
        // 三角形の向き: 屋根は上向き、底は下向き (片面で描くので、建物の中にカメラが入ると見えなくなる)
        const up = (t) => { const [p, q, d] = t.map((k) => ring[k]); return (q[1] - p[1]) * (d[0] - p[0]) - (q[0] - p[0]) * (d[1] - p[1]) > 0; };
        for (const t of tri) for (const k of (up(t) ? t : [t[0], t[2], t[1]])) { rp.push(ring[k][0], y1, ring[k][1]); rc.push(cl.r, cl.g, cl.b); }
        if (lift) for (const t of tri) for (const k of (up(t) ? [t[0], t[2], t[1]] : t)) { rp.push(ring[k][0], y0, ring[k][1]); rc.push(cl.r * 0.6, cl.g * 0.6, cl.b * 0.6); }   // 線路をまたぐ建物の底
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(wn, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(wu, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3));
      mesh(geo, MAT.walls, 'ext_buildings', true);
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
      g2.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
      g2.computeVertexNormals();
      mesh(g2, MAT.roofs, 'ext_roofs', true);
    }

    // 線路: 砕石の帯・レール・枕木・架線 (線分の中点がこの区間にあるもの)
    const segs = segsOf.get(keyOf(a, b));
    if (segs) {
      const bp = [], bc = [], rp = [], cat = [], sleepers = [];
      const BAL = new THREE.Color('#8a8580');
      for (let s = 0; s < segs.length; s += 2) {
        const P = ext.routes[segs[s]].p, k = segs[s + 1];
        const pa = P[k], pb = P[k + 1], dx = pb[0] - pa[0], dz = pb[2] - pa[2], L = Math.hypot(dx, dz) || 1;
        const nx = dz / L, nz = -dx / L;   // 横の向き
        const gp = (p, off, dy) => [p[0] + nx * off, p[1] - RAIL_TOP + dy, p[2] + nz * off];
        // 砕石 (幅 3.4 m、台形の断面)
        const sec = [[-2.2, 0.0], [-1.5, 0.35], [1.5, 0.35], [2.2, 0.0]];
        for (let q = 0; q < 3; q++) {
          const p0 = gp(pa, sec[q][0], sec[q][1]), p1 = gp(pa, sec[q + 1][0], sec[q + 1][1]), q0 = gp(pb, sec[q][0], sec[q][1]), q1 = gp(pb, sec[q + 1][0], sec[q + 1][1]);
          bp.push(...p0, ...q0, ...q1, ...p0, ...q1, ...p1);
          for (let n = 0; n < 6; n++) bc.push(BAL.r, BAL.g, BAL.b);
        }
        // レール (2 本、幅 7 cm・高さ 15 cm の上面と内側の面)
        for (const off of [-0.7175, 0.7175]) {
          for (const [o0, o1, y0, y1] of [[-0.035, 0.035, 0.55, 0.55], [-0.035, -0.035, 0.4, 0.55], [0.035, 0.035, 0.55, 0.4]]) {
            const p0 = gp(pa, off + o0, y0), p1 = gp(pa, off + o1, y1), q0 = gp(pb, off + o0, y0), q1 = gp(pb, off + o1, y1);
            rp.push(...p0, ...q0, ...q1, ...p0, ...q1, ...p1);
          }
        }
        // 枕木 (0.9 m おき)
        for (let t = 0; t < L; t += 0.9) {
          const x = pa[0] + dx * t / L, z = pa[2] + dz * t / L, y = pa[1] + (pb[1] - pa[1]) * t / L - RAIL_TOP + 0.38;
          sleepers.push(x, y, z, Math.atan2(nx, nz));
        }
        // 架線 (レールの上 5.2 m)
        cat.push(pa[0], pa[1] + 5.2, pa[2], pb[0], pb[1] + 5.2, pb[2]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
      geo.computeVertexNormals();
      mesh(geo, MAT.ballast, 'ext_ballast');
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
      g2.computeVertexNormals();
      mesh(g2, MAT.rails, 'ext_rails', false, false);
      const n = sleepers.length / 4;
      const sl = new THREE.InstancedMesh(GEO.sleeper, MAT.sleeper, n);
      const M = new THREE.Matrix4(), Pp = new THREE.Vector3(), Qq = new THREE.Quaternion(), S1 = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < n; i++) sl.setMatrixAt(i, M.compose(Pp.set(sleepers[i * 4], sleepers[i * 4 + 1], sleepers[i * 4 + 2]), Qq.setFromAxisAngle(Y, sleepers[i * 4 + 3]), S1));
      sl.receiveShadow = true; sl.name = 'ext_sleepers'; sl.computeBoundingSphere();
      const g3 = new THREE.BufferGeometry();
      g3.setAttribute('position', new THREE.Float32BufferAttribute(cat, 3));
      const wires = new THREE.LineSegments(g3, MAT.wire);
      wires.name = 'ext_catenary';
      g.add(sl, wires);
    }

    // 架線柱 (鉄の柱と、線路の上へ張り出す腕)
    if (D.poles.length) {
      const post = new THREE.InstancedMesh(GEO.post, MAT.pole, D.poles.length);
      const arm = new THREE.InstancedMesh(GEO.arm, MAT.pole, D.poles.length);
      const M = new THREE.Matrix4(), Pp = new THREE.Vector3(), Qq = new THREE.Quaternion(), S1 = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
      D.poles.forEach(([x, y, z, yaw], i) => {
        M.compose(Pp.set(x, y, z), Qq.setFromAxisAngle(Y, yaw), S1);   // 局所 +Z = 進む向き、局所 -X = 線路の側 (柱は進む向きの左)
        post.setMatrixAt(i, M); arm.setMatrixAt(i, M);
      });
      post.castShadow = arm.castShadow = true; post.name = 'ext_poles'; arm.name = 'ext_pole_arms';
      post.computeBoundingSphere(); arm.computeBoundingSphere();
      g.add(post, arm);
    }

    // 道路: 地形に沿わせた帯 (アスファルトの色)。線路の上は省く
    if (D.roads.length) {
      const pos = [], col = [], cl = new THREE.Color();
      for (const rd of D.roads) {
        const w = rd[0], hw = w / 2;
        cl.set(w >= 8 ? '#5e6064' : '#6c6d70');
        for (let k = 1; k + 3 < rd.length; k += 2) {
          const ax = rd[k], az = rd[k + 1], bx = rd[k + 2], bz = rd[k + 3], L = Math.hypot(bx - ax, bz - az);
          if (L < 0.1) continue;
          const nx = -(bz - az) / L * hw, nz = (bx - ax) / L * hw, n = Math.ceil(L / 4);
          for (let t = 0; t < n; t++) {
            const x0 = ax + (bx - ax) * t / n, z0 = az + (bz - az) * t / n, x1 = ax + (bx - ax) * (t + 1) / n, z1 = az + (bz - az) * (t + 1) / n;
            if (near.has(Math.floor((x0 + x1) / 8) * 100000 + Math.floor((z0 + z1) / 8)) || inMain((x0 + x1) / 2, (z0 + z1) / 2)) continue;
            const P = [[x0 + nx, z0 + nz], [x0 - nx, z0 - nz], [x1 - nx, z1 - nz], [x1 + nx, z1 + nz]].map(([x, z]) => [x, (sampleAt(x, z) ?? 0) + 0.12, z]);
            for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...P[i]); col.push(cl.r, cl.g, cl.b); }
          }
        }
      }
      if (pos.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        geo.computeVertexNormals();
        mesh(geo, MAT.road, 'ext_roads');
      }
    }

    // 木 (幹と、丸い葉のかたまり。位置は決まりで散らしたもの。色は通し番号で決める)
    if (D.trees.length) {
      const trunk = new THREE.InstancedMesh(GEO.trunk, MAT.trunk, D.trees.length);
      const crown = new THREE.InstancedMesh(GEO.crown, MAT.crown, D.trees.length);
      const M = new THREE.Matrix4(), Pp = new THREE.Vector3(), Qq = new THREE.Quaternion(), Ss = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
      D.trees.forEach(([x, y, z, s, i], n) => {
        M.compose(Pp.set(x, y, z), Qq.setFromAxisAngle(Y, x * 0.37 + z), Ss.set(s, s * (0.9 + (i % 7) * 0.05), s));
        trunk.setMatrixAt(n, M); crown.setMatrixAt(n, M);
        crown.setColorAt(n, col.set('#56743d').offsetHSL(((i * 37) % 11 - 5) * 0.006, 0, ((i * 13) % 9 - 4) * 0.02));
      });
      trunk.castShadow = crown.castShadow = true; crown.receiveShadow = true;
      trunk.name = 'ext_tree_trunks'; crown.name = 'ext_tree_crowns';
      trunk.computeBoundingSphere(); crown.computeBoundingSphere();
      g.add(trunk, crown);
    }

    // トンネルの坑口: コンクリートの面と、暗い穴 (線路は地形の下に入る)
    for (const [x, y, z, yaw, w] of D.portals) {
      const pg = new THREE.Group();
      pg.position.set(x, y, z); pg.rotation.y = yaw;
      const Hh = 7.5, W = w + 6, hole = Math.max(4.6, w - 0.4);
      const side = (W - hole) / 2;
      for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(side, Hh + 3, 1.2), MAT.conc); m.position.set(sx * (hole / 2 + side / 2), (Hh + 3) / 2 - 1, 0); pg.add(m); }
      const top = new THREE.Mesh(new THREE.BoxGeometry(hole, 3.4, 1.2), MAT.conc); top.position.set(0, Hh + 0.3, 0); pg.add(top);
      // 穴の奥 (黒い板) と、穴の中の天井・壁 (外からのぞいたとき地形の裏が見えないように)
      const back = new THREE.Mesh(new THREE.PlaneGeometry(hole, Hh), MAT.dark); back.position.set(0, Hh / 2 - 1, -14); pg.add(back);
      for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(14, Hh), MAT.dark); m.rotation.y = Math.PI / 2; m.position.set(sx * hole / 2, Hh / 2 - 1, -7); pg.add(m); }
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(hole, 14), MAT.dark); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, Hh - 1.2, -7); pg.add(ceil);
      pg.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
      pg.name = 'ext_portal';
      g.add(pg);
    }
    return c;
  }
  // 道路の高さ: 点の区間の地形 (読み込んであれば。分ける前と同じ値)。無ければ作っている区間の窓 (まわり 1 升まで) の地形
  let building = null;
  const sampleAt = (x, z) => {
    const key = keyOf(Math.floor(x / CH), Math.floor(z / CH)), c = loaded.get(key) || (building && building.key === key ? building : null);
    if (c) return sampleIn(c, x, z);
    return building ? sampleIn(building, x, z) : null;
  };
  function sampleIn(c, x, z) {
    const fx = (x - T.x0) / T.step, fz = (z - T.z0) / T.step, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = fineOf(c, i, j), b = fineOf(c, i + 1, j), cc = fineOf(c, i, j + 1), d = fineOf(c, i + 1, j + 1);
    if (a === undefined || b === undefined || cc === undefined || d === undefined) return coarseOf(c, x, z);
    return u >= v ? a + u * (b - a) + v * (d - b) : a + v * (cc - a) + u * (d - cc);   // terrain.js と同じ三角形の分け方
  }

  function disposeChunk(c) {
    group.remove(c.group);
    c.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
    });
  }

  // ---------- 読み込み: カメラに近い区間から。同時に取るのは 2 つまで、作るのは 1 コマに 1 つ ----------
  const list = ext.chunks.map(([a, b, bytes]) => ({ a, b, bytes, key: keyOf(a, b) }));
  const fetching = new Map(), ready = [];   // key → Promise、読み終わって作る前の区間
  const dist = (q, x, z) => Math.hypot(Math.max(q.a * CH - x, 0, x - (q.a + 1) * CH), Math.max(q.b * CH - z, 0, z - (q.b + 1) * CH));
  let stats = { built: 0, dropped: 0, bytes: 0 };
  let focus = null, wanting = 0;
  function update(x, z) {
    focus = [x, z];
    for (const [key, c] of loaded) if (dist(c, x, z) > UNLOAD_R) { disposeChunk(c); loaded.delete(key); stats.dropped++; }
    const want = list.filter((q) => !loaded.has(q.key) && !fetching.has(q.key) && dist(q, x, z) < LOAD_R).sort((p, q) => dist(p, x, z) - dist(q, x, z));
    wanting = want.length;
    for (const q of want) {
      if (fetching.size >= 2) break;
      fetching.set(q.key, fetch(base + 'c_' + q.key + '.json').then((r) => r.json()).then((D) => { ready.push([q, D]); }).catch((e) => console.warn('[detail] rail ext chunk', q.key, e)).finally(() => fetching.delete(q.key)));
    }
    if (ready.length) {
      ready.sort((p, q) => dist(p[0], x, z) - dist(q[0], x, z));
      const [q, D] = ready.shift();
      if (dist(q, x, z) < UNLOAD_R && !loaded.has(q.key)) {
        const c = buildChunk(q.a, q.b, D);
        building = null;
        loaded.set(q.key, c);
        group.add(c.group);
        releaseGeometryAfterUpload(c.group, 0);   // スマホ: GPU に送った後、頂点データの JS 側の控えを手放す
        stats.built++; stats.bytes += q.bytes;
        const near9 = new Set(); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) near9.add(keyOf(q.a + i, q.b + j));
        for (const k of [...mapTiles.keys()]) if (near9.has(k.split('|')[0])) mapTiles.delete(k);   // この区間とまわりの地図の絵を描き直す
      }
    }
  }
  // ---------- 延ばした先の駅: ホーム・屋根・柱・ベンチ・駅名標 (station.js)。ホームの床の当たり判定と、縁の見えない柵。最初から全部作る ----------
  // 「のりかえ」の案内板: 柱 2 本と、両面に文字の板 (高さ 2.1〜2.7 m。ホームの向きに直角 = 歩いてくる人に正面)
  function xferSign(x, y, z, yaw) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    const c = cv.getContext('2d');
    c.fillStyle = '#1f5fae'; c.fillRect(0, 0, 512, 128);
    c.fillStyle = '#ffd23f'; c.fillRect(0, 108, 512, 20);
    c.fillStyle = '#fff'; c.font = 'bold 64px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('⇄ のりかえ', 256, 56);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    for (const r of [0, Math.PI]) {   // 表向きの板を背中合わせに 2 枚 (両面表示の 1 枚だと裏から文字が左右反転する)
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.5), mat);
      board.rotation.y = r; board.position.set(0, 2.45, r ? -0.01 : 0.01); g.add(board);
    }
    const pole = new THREE.MeshStandardMaterial({ color: '#5a5d62', roughness: 0.5, metalness: 0.4 });
    for (const sx of [-0.9, 0.9]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.7, 8), pole); m.position.set(sx, 1.35, 0); g.add(m); }
    g.position.set(x, y, z); g.rotation.y = yaw;
    g.name = 'ext_xfer_sign';
    return g;
  }
  // 1 つの駅に複数のホーム (platforms・canopies。横浜など)。古い形 (platform・canopy 1 つ) も読む
  for (const st of ext.stations || []) (st.platforms || [st.platform]).forEach((pf, pi) => {
    const cn = (st.canopies || [st.canopy])[pi], n = pf.left.length;
    const mid = (k) => [(pf.left[k][0] + pf.right[k][0]) / 2, (pf.left[k][1] + pf.right[k][1]) / 2];
    const dirYaw = (k) => { const p = mid(Math.max(0, k - 1)), q = mid(Math.min(n - 1, k + 1)); return Math.atan2(q[0] - p[0], q[1] - p[1]); };
    const columns = [], benches = [], nameSigns = [];
    for (let k = 0; k < cn.left.length; k += 2) {
      const x = (cn.left[k][0] + cn.right[k][0]) / 2, z = (cn.left[k][1] + cn.right[k][1]) / 2;
      columns.push([x, z, cn.y[k] - 3.4, cn.y[k]]);
    }
    for (let k = 6; k < n - 6; k += 12) {
      const [x, z] = mid(k), yaw = dirYaw(k);
      benches.push({ x: x + Math.cos(yaw) * 1.2, y: pf.y[k], z: z - Math.sin(yaw) * 1.2, yaw: yaw + Math.PI / 2 });
      benches.push({ x: x - Math.cos(yaw) * 1.2, y: pf.y[k], z: z + Math.sin(yaw) * 1.2, yaw: yaw - Math.PI / 2 });
    }
    for (const k of [10, n >> 1, n - 11]) {
      const [x, z] = mid(k), yaw = dirYaw(k);
      nameSigns.push({ x: x + Math.cos(yaw) * 2.6, y: pf.y[k], z: z - Math.sin(yaw) * 2.6, yaw: yaw + Math.PI / 2 });
      nameSigns.push({ x: x - Math.cos(yaw) * 2.6, y: pf.y[k], z: z + Math.sin(yaw) * 2.6, yaw: yaw - Math.PI / 2 });
    }
    const sb = buildStation({ rail: { platforms: [pf], canopies: [cn], columns, gantries: [], catenary: [], dims: { platH: 1.1, mastH: 7 }, benches, nameSigns } },
      { kanji: [...st.name].join(' '), kana: st.kana, roman: st.roman });
    group.add(sb.group);
    // ホームが 2 面以上の駅 (横浜): ホームの中央の「のりかえ」の案内板 (ride.js がこの前で F / Q → ほかのホームへ移す。場所は ride.js と同じ式)
    if ((st.platforms || []).length > 1) {
      const k = Math.min(n - 2, (n >> 1) + 1), [x, z] = mid(k), yaw = dirYaw(k);
      group.add(xferSign(x, pf.y[k], z, yaw));
    }
    // 当たり判定: ホームの床 (detail/index.js の戸塚駅と同じ) と、縁の柵 (高さ 1.2 m。ホームから落ちない)
    const poly = [];
    for (let k = 0; k + 1 < n; k++) {
      const y = (pf.y[k] + pf.y[k + 1]) / 2;
      poly.push([[pf.left[k], pf.left[k + 1], pf.right[k + 1], pf.right[k]], y - 1.1, y]);
    }
    const line = [];
    const edge = (pts) => { const l = [0.05, 1.2]; for (let k = 0; k < pts.length; k++) l.push(pts[k][0], pts[k][1], pf.y[Math.min(k, n - 1)]); line.push(l); };
    edge(pf.left); edge(pf.right);
    edge([pf.left[0], pf.right[0]]); edge([pf.left[n - 1], pf.right[n - 1]]);
    world.addColliders({ poly, line }, true);
  });

  // ---------- 地図の下絵 (minimap.js・bigmap.js): 全体の粗い絵 (index の overview) と、読み込んだ区間の細かい絵 (1 km 四方ずつ。描いたものを取っておく) ----------
  const mapTiles = new Map();   // "key|s" → canvas
  const TILE_MAX = low ? 6 : 12;
  // 区間 c の 1 km 四方の絵。区間の境目をまたぐ道路・建物が切れないよう、読み込んである隣の区間のものも同じ順 (地 → 道路 → 建物) で描く (はみ出しは canvas が切る)
  function drawTile(c, s) {
    const m = document.createElement('canvas');
    m.width = m.height = Math.ceil(CH * s);
    const g = m.getContext('2d');
    const x0 = c.a * CH, z0 = c.b * CH, X = (x) => (x - x0) * s, Z = (z) => (z - z0) * s;
    const nb = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const q = loaded.get(keyOf(c.a + i, c.b + j)); if (q) nb.push(q); }
    g.fillStyle = '#e9e6df';   // 線路の近く (地形を作った所) だけを地の色で塗る
    for (const q of nb) for (const [j, i0, n] of q.map.rows) g.fillRect(X(T.x0 + i0 * T.step), Z(T.z0 + j * T.step), n * T.step * s + 1, T.step * s + 1);
    g.lineCap = g.lineJoin = 'round';
    g.strokeStyle = '#ffffff';
    for (const q of nb) for (const rd of q.map.roads) {
      g.lineWidth = Math.max(1, rd[0] * s);
      g.beginPath(); for (let k = 1; k + 1 < rd.length; k += 2) k === 1 ? g.moveTo(X(rd[k]), Z(rd[k + 1])) : g.lineTo(X(rd[k]), Z(rd[k + 1])); g.stroke();
    }
    g.fillStyle = '#c9c1b3';
    for (const q of nb) for (const ring of q.map.buildings) { g.beginPath(); ring.forEach(([x, z], i) => i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))); g.closePath(); g.fill(); }
    drawLines(g, X, Z, s);
    return m;
  }
  function drawLines(g, X, Z, s) {   // 線路とホーム (全体の絵と区間の絵で同じ)
    g.lineCap = g.lineJoin = 'round';
    g.strokeStyle = '#777'; g.lineWidth = Math.max(1.5, 3 * s);
    for (const r of ext.routes) { g.beginPath(); r.p.forEach((q, i) => i ? g.lineTo(X(q[0]), Z(q[2])) : g.moveTo(X(q[0]), Z(q[2]))); g.stroke(); }
    g.fillStyle = '#b9b4aa';
    for (const st of ext.stations || []) for (const pf of st.platforms || [st.platform]) { g.beginPath(); [...pf.left, ...pf.right.slice().reverse()].forEach(([x, z], i) => i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))); g.closePath(); g.fill(); }
  }
  const B = ext.bounds;
  let overview = null;
  function overviewCanvas() {
    if (overview) return overview;
    const O = ext.overview, s = Math.min(low ? 0.08 : 0.15, 2048 / Math.max(B.maxX - B.minX, B.maxZ - B.minZ));
    const m = document.createElement('canvas');
    m.width = Math.ceil((B.maxX - B.minX) * s); m.height = Math.ceil((B.maxZ - B.minZ) * s);
    const g = m.getContext('2d');
    const X = (x) => (x - B.minX) * s, Z = (z) => (z - B.minZ) * s;
    g.fillStyle = '#e9e6df';
    for (const row of O.rows) for (let k = 1; k < row.length; k += 2) g.fillRect(X(O.x0 + row[k] * O.step), Z(O.z0 + row[0] * O.step), row[k + 1] * O.step * s + 1, O.step * s + 1);
    g.strokeStyle = '#ffffff'; g.lineCap = g.lineJoin = 'round';
    for (const rd of O.roads) {
      g.lineWidth = Math.max(1, rd[0] * s);
      g.beginPath(); for (let k = 1; k + 1 < rd.length; k += 2) k === 1 ? g.moveTo(X(rd[k]), Z(rd[k + 1])) : g.lineTo(X(rd[k]), Z(rd[k + 1])); g.stroke();
    }
    drawLines(g, X, Z, s);
    overview = { canvas: m, x0: B.minX, z0: B.minZ, s };
    return overview;
  }
  // 地図に描く: X(x)・Z(z) = 画面の座標 (今の変換の中)、k = 画面の px/m、view = 見えている範囲 [x0, z0, x1, z1]
  function drawMap(g, X, Z, k, view) {
    const O = overviewCanvas();
    g.drawImage(O.canvas, X(O.x0), Z(O.z0), O.canvas.width / O.s * k, O.canvas.height / O.s * k);
    if (k < 0.12) return;   // 引いた地図は全体の絵だけ
    const s = k > 0.6 ? (low ? 0.3 : 0.5) : 0.15;   // 区間の絵の細かさ
    for (const c of loaded.values()) {
      if (c.a * CH > view[2] || (c.a + 1) * CH < view[0] || c.b * CH > view[3] || (c.b + 1) * CH < view[1]) continue;
      const key = c.key + '|' + s;
      let m = mapTiles.get(key);
      if (!m) {
        m = drawTile(c, s); mapTiles.set(key, m);
        if (mapTiles.size > TILE_MAX) mapTiles.delete(mapTiles.keys().next().value);   // 古いものから捨てる
      } else { mapTiles.delete(key); mapTiles.set(key, m); }
      g.drawImage(m, X(c.a * CH), Z(c.b * CH), CH * k, CH * k);
    }
  }

  // 当たり判定の範囲 (world.resolve が位置をここに収める) を、延ばした所まで広げる
  world.bounds = { minX: Math.min(mainBounds.minX, B.minX), maxX: Math.max(mainBounds.maxX, B.maxX), minZ: Math.min(mainBounds.minZ, B.minZ), maxZ: Math.max(mainBounds.maxZ, B.maxZ) };
  console.info(`[detail] rail ext: routes=${ext.routes.length} chunks=${list.length} stations=${(ext.stations || []).map((q) => q.name).join(',')} loadR=${LOAD_R}`);
  const api = {
    group,
    update,   // update(x, z): カメラの位置。毎コマ呼ぶ
    map: { bounds: B, draw: drawMap, mem: () => [overview && overview.canvas, ...mapTiles.values()].reduce((n, m) => n + (m ? m.width * m.height * 4 : 0), 0) },
    // 確認用 (tools/dev): 読み込んだ区間・読み込み中の数
    get stats() { return { loaded: [...loaded.keys()], fetching: fetching.size, ready: ready.length, idle: !fetching.size && !ready.length && !wanting, ...stats, focus }; },
  };
  window.__railext = api;   // 確認用 (tools/dev の ridecheck.js・rideshot.js が、区間を読み終わるまで待つ)
  return api;
}
