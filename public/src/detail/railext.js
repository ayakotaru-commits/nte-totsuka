// 線路の延長 (地図の北の端 → 東戸塚駅の先。data/rail_ext.json = tools/rail_ext.py)。
// 電車の窓から見える範囲だけを作る: 線路の近くの地形 (5 m 間隔) と建物 (PLATEAU の輪郭と高さの箱)、その外の粗い地形 (25 m 間隔)、
// 線路 (砕石・枕木・レール)・架線柱・架線、東戸塚駅のホーム (ホームの上だけ歩ける。縁に見えない柵)。
// 地図の範囲の外の地形の高さを terrain.js に登録し、当たり判定の範囲 (world.bounds) を東戸塚駅まで広げる。
import * as THREE from 'three';
import { setTerrainExt } from '../terrain.js';
import { buildStation } from './station.js';
import { canvasTexture } from './util.js';

const RAIL_TOP = 0.55;   // レールの上面 (地面から)。tools/rail_ext.py と同じ

// 地形の高さ: 細かい格子 (線路の近くだけ。行ごとの区間) → 無ければ粗い格子
function makeSampler(ext) {
  const T = ext.terrain, C = ext.coarse;
  const fine = new Map();   // j * nx + i → 高さ (m)
  for (const row of T.rows) {
    const [j, i0] = row;
    for (let k = 2; k < row.length; k++) fine.set(j * T.nx + i0 + k - 2, row[k] / 100);
  }
  const f = (i, j) => (i < 0 || j < 0 || i >= T.nx || j >= T.nz) ? undefined : fine.get(j * T.nx + i);
  const coarse = (x, z) => {
    let fx = (x - C.x0) / C.step, fz = (z - C.z0) / C.step;
    fx = Math.max(0, Math.min(C.nx - 1.0001, fx)); fz = Math.max(0, Math.min(C.nz - 1.0001, fz));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, g = (a, b) => C.h[b * C.nx + a] / 100;
    return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v;
  };
  const H = (x, z) => {
    const fx = (x - T.x0) / T.step, fz = (z - T.z0) / T.step, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = f(i, j), b = f(i + 1, j), c = f(i, j + 1), d = f(i + 1, j + 1);
    if (a === undefined || b === undefined || c === undefined || d === undefined) return coarse(x, z);
    return u >= v ? a + u * (b - a) + v * (d - b) : a + v * (c - a) + u * (d - c);   // terrain.js と同じ三角形の分け方
  };
  return { H, f, coarse };
}

export function buildRailExt(ext, world, mainBounds, low = false) {
  const group = new THREE.Group();
  group.name = 'rail_ext';
  const S = makeSampler(ext);
  setTerrainExt(S.H);
  const inMain = (x, z) => x > mainBounds.minX && x < mainBounds.maxX && z > mainBounds.minZ && z < mainBounds.maxZ;

  // 建物の近く (市街地) は灰色がかった地面、それ以外は草地の色
  const urban = new Set();
  for (const [ring] of ext.buildings) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let i = Math.floor((x0 - 12) / 10); i <= Math.floor((x1 + 12) / 10); i++) for (let j = Math.floor((z0 - 12) / 10); j <= Math.floor((z1 + 12) / 10); j++) urban.add(i * 100000 + j);
  }
  const GRASS = new THREE.Color('#7d905c'), TOWN = new THREE.Color('#9b988d'), FAR = new THREE.Color('#6f8156'), tmp = new THREE.Color();
  const groundColor = (x, z, far) => {
    const n = Math.sin(x * 0.031) * Math.sin(z * 0.027) * 0.06 + Math.sin(x * 0.11 + z * 0.07) * 0.03;
    tmp.copy(far ? FAR : urban.has(Math.floor(x / 10) * 100000 + Math.floor(z / 10)) ? TOWN : GRASS);
    return tmp.multiplyScalar(1 + n);
  };

  // ---------- 地形: 細かい格子 ----------
  {
    const T = ext.terrain, pos = [], col = [], idx = [], vid = new Map();
    const vert = (i, j) => {
      const key = j * T.nx + i;
      let v = vid.get(key);
      if (v === undefined) {
        const x = T.x0 + i * T.step, z = T.z0 + j * T.step;
        v = pos.length / 3; vid.set(key, v);
        pos.push(x, S.f(i, j), z);
        const c = groundColor(x, z, false); col.push(c.r, c.g, c.b);
      }
      return v;
    };
    for (const row of T.rows) {
      const [j, i0] = row, n = row.length - 2;
      for (let i = i0; i < i0 + n - 1; i++) {
        if (S.f(i, j + 1) === undefined || S.f(i + 1, j + 1) === undefined) continue;
        const cx = T.x0 + (i + 0.5) * T.step, cz = T.z0 + (j + 0.5) * T.step;
        if (inMain(cx, cz)) continue;
        const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
        idx.push(a, c, d, a, d, b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    m.receiveShadow = true; m.name = 'ext_terrain';
    group.add(m);
  }
  // ---------- 地形: 粗い格子 (細かい格子と地図の範囲を除く。継ぎ目が見えないよう少し下げる) ----------
  {
    const C = ext.coarse, T = ext.terrain, pos = [], col = [], idx = [];
    const fineAt = (x, z) => S.f(Math.round((x - T.x0) / T.step), Math.round((z - T.z0) / T.step)) !== undefined;
    for (let j = 0; j < C.nz; j++) for (let i = 0; i < C.nx; i++) {
      const x = C.x0 + i * C.step, z = C.z0 + j * C.step;
      pos.push(x, C.h[j * C.nx + i] / 100 - 0.8, z);
      const c = groundColor(x, z, true); col.push(c.r, c.g, c.b);
    }
    for (let j = 0; j < C.nz - 1; j++) for (let i = 0; i < C.nx - 1; i++) {
      const x = C.x0 + (i + 0.5) * C.step, z = C.z0 + (j + 0.5) * C.step;
      if (inMain(x, z)) continue;
      // 4 つの角とも細かい格子の中なら省く
      if (fineAt(x - C.step / 2, z - C.step / 2) && fineAt(x + C.step / 2, z - C.step / 2) && fineAt(x - C.step / 2, z + C.step / 2) && fineAt(x + C.step / 2, z + C.step / 2)) continue;
      const a = j * C.nx + i, b = a + 1, c = a + C.nx, d = c + 1;
      idx.push(a, c, d, a, d, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    m.receiveShadow = true; m.name = 'ext_terrain_far';
    group.add(m);
  }

  // ---------- 建物: 輪郭を高さまで立ち上げた箱。壁に窓の模様 (3 m 四方に 1 つ)、平らな屋根 ----------
  {
    const win = canvasTexture(64, 64, (g) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#5d6670'; g.fillRect(14, 16, 36, 26);
      g.fillStyle = '#d8d8d4'; g.fillRect(0, 56, 64, 8);
    });
    win.wrapS = win.wrapT = THREE.RepeatWrapping;
    const WALLS = ['#e7e1d4', '#d9d4c8', '#cfd3d6', '#e9e6df', '#c9bfae', '#d6cbb8', '#bfc5c9', '#ece8dc'];
    const ROOFS = ['#8d8f91', '#7f8486', '#9a9892', '#6f7477', '#a39e93'];
    const wp = [], wn = [], wu = [], wc = [], rp = [], rc = [];
    const c = new THREE.Color();
    let seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const [ring0, base, h, lift] of ext.buildings) {
      let ring = ring0;
      // 反時計回り (上から見て) にそろえる
      let A = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; A += p[0] * q[1] - q[0] * p[1]; }
      if (A > 0) ring = ring.slice().reverse();
      const y0 = base + (lift || 0), y1 = base + h;
      c.set(WALLS[Math.floor(rnd() * WALLS.length)]).multiplyScalar(0.92 + rnd() * 0.12);
      const house = h < 10;
      let u = 0;
      for (let i = 0; i < ring.length; i++) {
        const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length], L = Math.hypot(bx - ax, bz - az);
        if (L < 0.05) continue;
        const nx = (bz - az) / L, nz = -(bx - ax) / L;
        const u0 = u / 3, u1 = (u + L) / 3, v0 = (y0 - base) / 3, v1 = (y1 - base) / 3;
        const quad = [[ax, y0, az, u0, v0], [bx, y0, bz, u1, v0], [bx, y1, bz, u1, v1], [ax, y0, az, u0, v0], [bx, y1, bz, u1, v1], [ax, y1, az, u0, v1]];
        for (const [x, y, z, uu, vv] of quad) { wp.push(x, y, z); wn.push(-nx, 0, -nz); wu.push(house ? uu * 0.8 : uu, vv); wc.push(c.r, c.g, c.b); }
        u += L;
      }
      // 屋根
      const tri = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
      c.set(ROOFS[Math.floor(rnd() * ROOFS.length)]);
      // 三角形の向き: 屋根は上向き、底は下向き (片面で描くので、建物の中にカメラが入ると見えなくなる)
      const up = (t) => { const [a, b, d] = t.map((k) => ring[k]); return (b[1] - a[1]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[1] - a[1]) > 0; };
      for (const t of tri) for (const k of (up(t) ? t : [t[0], t[2], t[1]])) { rp.push(ring[k][0], y1, ring[k][1]); rc.push(c.r, c.g, c.b); }
      if (lift) for (const t of tri) for (const k of (up(t) ? [t[0], t[2], t[1]] : t)) { rp.push(ring[k][0], y0, ring[k][1]); rc.push(c.r * 0.6, c.g * 0.6, c.b * 0.6); }   // 線路をまたぐ建物の底
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(wn, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(wu, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3));
    const walls = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: win, vertexColors: true, roughness: 0.85 }));
    walls.castShadow = walls.receiveShadow = true; walls.name = 'ext_buildings';
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    g2.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
    g2.computeVertexNormals();
    const roofs = new THREE.Mesh(g2, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    roofs.castShadow = roofs.receiveShadow = true; roofs.name = 'ext_roofs';
    group.add(walls, roofs);
  }

  // ---------- 線路: 砕石の帯・レール・枕木・架線 ----------
  {
    const bp = [], bc = [], rp = [], cat = [];
    const sleepers = [];
    const BAL = new THREE.Color('#8a8580');
    for (const r of ext.routes) {
      const P = r.p;
      for (let k = 0; k < P.length - 1; k++) {
        const a = P[k], b = P[k + 1], dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 1;
        const nx = dz / L, nz = -dx / L;   // 横の向き
        const g = (p, off, dy) => [p[0] + nx * off, p[1] - RAIL_TOP + dy, p[2] + nz * off];
        // 砕石 (幅 3.4 m、台形の断面)
        const sec = [[-2.2, 0.0], [-1.5, 0.35], [1.5, 0.35], [2.2, 0.0]];
        for (let s = 0; s < 3; s++) {
          const p0 = g(a, sec[s][0], sec[s][1]), p1 = g(a, sec[s + 1][0], sec[s + 1][1]), q0 = g(b, sec[s][0], sec[s][1]), q1 = g(b, sec[s + 1][0], sec[s + 1][1]);
          bp.push(...p0, ...q0, ...q1, ...p0, ...q1, ...p1);
          for (let n = 0; n < 6; n++) bc.push(BAL.r, BAL.g, BAL.b);
        }
        // レール (2 本、幅 7 cm・高さ 15 cm の上面と内側の面)
        for (const off of [-0.7175, 0.7175]) {
          for (const [o0, o1, y0, y1] of [[-0.035, 0.035, 0.55, 0.55], [-0.035, -0.035, 0.4, 0.55], [0.035, 0.035, 0.55, 0.4]]) {
            const p0 = g(a, off + o0, y0), p1 = g(a, off + o1, y1), q0 = g(b, off + o0, y0), q1 = g(b, off + o1, y1);
            rp.push(...p0, ...q0, ...q1, ...p0, ...q1, ...p1);
          }
        }
        // 枕木 (0.9 m おき)
        for (let t = 0; t < L; t += 0.9) {
          const x = a[0] + dx * t / L, z = a[2] + dz * t / L, y = a[1] + (b[1] - a[1]) * t / L - RAIL_TOP + 0.38;
          sleepers.push(x, y, z, Math.atan2(nx, nz));
        }
        // 架線 (レールの上 5.2 m)
        cat.push(a[0], a[1] + 5.2, a[2], b[0], b[1] + 5.2, b[2]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
    g.computeVertexNormals();
    const bal = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    bal.receiveShadow = true; bal.name = 'ext_ballast';
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    g2.computeVertexNormals();
    const rails = new THREE.Mesh(g2, new THREE.MeshStandardMaterial({ color: '#a9a9a6', roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide }));
    rails.name = 'ext_rails';
    const n = sleepers.length / 4;
    const sl = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.14, 0.22), new THREE.MeshStandardMaterial({ color: '#9b978f', roughness: 0.9 }), n);
    const M = new THREE.Matrix4(), Pp = new THREE.Vector3(), Qq = new THREE.Quaternion(), S1 = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) sl.setMatrixAt(i, M.compose(Pp.set(sleepers[i * 4], sleepers[i * 4 + 1], sleepers[i * 4 + 2]), Qq.setFromAxisAngle(Y, sleepers[i * 4 + 3]), S1));
    sl.receiveShadow = true; sl.name = 'ext_sleepers';
    const g3 = new THREE.BufferGeometry();
    g3.setAttribute('position', new THREE.Float32BufferAttribute(cat, 3));
    const wires = new THREE.LineSegments(g3, new THREE.LineBasicMaterial({ color: '#2a2d30' }));
    wires.name = 'ext_catenary';
    group.add(bal, rails, sl, wires);
  }

  // ---------- 架線柱 (鉄の柱と、線路の上へ張り出す腕) ----------
  if (ext.poles && ext.poles.length) {
    const mat = new THREE.MeshStandardMaterial({ color: '#7b8084', roughness: 0.6, metalness: 0.5 });
    const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 7.2, 0.25).translate(0, 3.6, 0), mat, ext.poles.length);
    const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(2.8, 0.12, 0.12).translate(-1.3, 6.4, 0), mat, ext.poles.length);
    const M = new THREE.Matrix4(), Pp = new THREE.Vector3(), Qq = new THREE.Quaternion(), S1 = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
    ext.poles.forEach(([x, y, z, yaw], i) => {
      M.compose(Pp.set(x, y, z), Qq.setFromAxisAngle(Y, yaw), S1);   // 局所 +Z = 進む向き、局所 -X = 線路の側 (柱は進む向きの左)
      post.setMatrixAt(i, M); arm.setMatrixAt(i, M);
    });
    post.castShadow = arm.castShadow = true; post.name = 'ext_poles'; arm.name = 'ext_pole_arms';
    group.add(post, arm);
  }

  // ---------- 道路: 地形に沿わせた帯 (アスファルトの色)。線路の上は省く ----------
  if (ext.roads && ext.roads.length) {
    const pos = [], col = [], c = new THREE.Color();
    const near = new Set();   // 線路の 3 m 以内 (4 m 四方の升目)
    for (const r of ext.routes) for (const q of r.p) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) near.add((Math.floor(q[0] / 4) + i) * 100000 + Math.floor(q[2] / 4) + j);
    for (const rd of ext.roads) {
      const w = rd[0], hw = w / 2;
      c.set(w >= 8 ? '#5e6064' : '#6c6d70');
      for (let k = 1; k + 3 < rd.length; k += 2) {
        const ax = rd[k], az = rd[k + 1], bx = rd[k + 2], bz = rd[k + 3], L = Math.hypot(bx - ax, bz - az);
        if (L < 0.1) continue;
        const nx = -(bz - az) / L * hw, nz = (bx - ax) / L * hw, n = Math.ceil(L / 4);
        for (let t = 0; t < n; t++) {
          const x0 = ax + (bx - ax) * t / n, z0 = az + (bz - az) * t / n, x1 = ax + (bx - ax) * (t + 1) / n, z1 = az + (bz - az) * (t + 1) / n;
          if (near.has(Math.floor((x0 + x1) / 8) * 100000 + Math.floor((z0 + z1) / 8)) || inMain((x0 + x1) / 2, (z0 + z1) / 2)) continue;
          const P = [[x0 + nx, z0 + nz], [x0 - nx, z0 - nz], [x1 - nx, z1 - nz], [x1 + nx, z1 + nz]].map(([x, z]) => [x, S.H(x, z) + 0.12, z]);
          for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...P[i]); col.push(c.r, c.g, c.b); }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.receiveShadow = true; m.name = 'ext_roads';
    group.add(m);
  }

  // ---------- 木 (幹と、丸い葉のかたまり。位置は決まりで散らしたもの) ----------
  if (ext.trees && ext.trees.length) {
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.25, 2.6, 6).translate(0, 1.3, 0), new THREE.MeshStandardMaterial({ color: '#6b5540', roughness: 1 }), ext.trees.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.6, 0).translate(0, 4.2, 0), new THREE.MeshStandardMaterial({ color: '#56743d', roughness: 1, flatShading: true }), ext.trees.length);
    const M = new THREE.Matrix4(), Pp = new THREE.Vector3(), Qq = new THREE.Quaternion(), Ss = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    ext.trees.forEach(([x, y, z, s], i) => {
      M.compose(Pp.set(x, y, z), Qq.setFromAxisAngle(Y, x * 0.37 + z), Ss.set(s, s * (0.9 + (i % 7) * 0.05), s));
      trunk.setMatrixAt(i, M); crown.setMatrixAt(i, M);
      crown.setColorAt(i, col.set('#56743d').offsetHSL(((i * 37) % 11 - 5) * 0.006, 0, ((i * 13) % 9 - 4) * 0.02));
    });
    trunk.castShadow = crown.castShadow = true; crown.receiveShadow = true;
    trunk.name = 'ext_tree_trunks'; crown.name = 'ext_tree_crowns';
    group.add(trunk, crown);
  }

  // ---------- トンネルの坑口: コンクリートの面と、暗い穴 (線路は地形の下に入る) ----------
  for (const [x, y, z, yaw, w] of ext.portals || []) {
    const g = new THREE.Group();
    g.position.set(x, y, z); g.rotation.y = yaw;
    const conc = new THREE.MeshStandardMaterial({ color: '#a8a59c', roughness: 0.9 });
    const H = 7.5, W = w + 6, hole = Math.max(4.6, w - 0.4);
    // 面 (穴の左右と上)
    const side = (W - hole) / 2;
    for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(side, H + 3, 1.2), conc); m.position.set(sx * (hole / 2 + side / 2), (H + 3) / 2 - 1, 0); g.add(m); }
    const top = new THREE.Mesh(new THREE.BoxGeometry(hole, 3.4, 1.2), conc); top.position.set(0, H + 0.3, 0); g.add(top);
    // 穴の奥 (黒い板) と、穴の中の天井・壁 (外からのぞいたとき地形の裏が見えないように)
    const dark = new THREE.MeshBasicMaterial({ color: '#0c0c0c', side: THREE.DoubleSide });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(hole, H), dark); back.position.set(0, H / 2 - 1, -14); g.add(back);
    for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(14, H), dark); m.rotation.y = Math.PI / 2; m.position.set(sx * hole / 2, H / 2 - 1, -7); g.add(m); }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(hole, 14), dark); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H - 1.2, -7); g.add(ceil);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    g.name = 'ext_portal';
    group.add(g);
  }

  // ---------- 延ばした先の駅: ホーム・屋根・柱・ベンチ・駅名標 (station.js)。ホームの床の当たり判定と、縁の見えない柵 ----------
  for (const st of ext.stations || []) {
    const pf = st.platform, cn = st.canopy, n = pf.left.length;
    const mid = (k) => [(pf.left[k][0] + pf.right[k][0]) / 2, (pf.left[k][1] + pf.right[k][1]) / 2];
    const dirYaw = (k) => { const a = mid(Math.max(0, k - 1)), b = mid(Math.min(n - 1, k + 1)); return Math.atan2(b[0] - a[0], b[1] - a[1]); };
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
  }

  // 当たり判定の範囲 (world.resolve が位置をここに収める) を、延ばした所まで広げる
  const T = ext.terrain;
  world.bounds = { minX: Math.min(mainBounds.minX, T.x0), maxX: Math.max(mainBounds.maxX, T.x0 + T.nx * T.step), minZ: Math.min(mainBounds.minZ, T.z0), maxZ: Math.max(mainBounds.maxZ, T.z0 + T.nz * T.step) };
  console.info(`[detail] rail ext: routes=${ext.routes.length} buildings=${ext.buildings.length} terrain=${T.rows.length} rows stations=${(ext.stations || []).map((q) => q.name).join(',')} roads=${(ext.roads || []).length} trees=${(ext.trees || []).length} portals=${(ext.portals || []).length}`);
  return { group };
}
