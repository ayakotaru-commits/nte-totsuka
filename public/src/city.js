// city.json から街のメッシュを組み立てる
import * as THREE from 'three';
import { H, drape, buildTerrainMesh, hasTerrain } from './terrain.js';
import { Bridges } from './bridges.js';

const FACADE = {
  office: { bay: 4.0, floor: 3.6 },
  house: { bay: 3.0, floor: 2.9 },
  euro: { bay: 3.6, floor: 2.9 },
};
const TILE = 8; // テクスチャ1枚 = 8ベイ x 8フロア

// ---- 決定的な乱数 ----
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

const col = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// ---- 頂点バッファ組み立て ----
class GB {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; }
  tri(a, b, c, n, ua, ub, uc, color) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; }
    this.p.push(...a, ...b, ...c);
    this.n.push(...n, ...n, ...n);
    this.u.push(...ua, ...ub, ...uc);
    this.c.push(...color, ...color, ...color);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const UP = [0, 1, 0], DOWN = [0, -1, 0], Z2 = [0, 0];

function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

// 多角形 (穴あり) を水平面として追加
function addFlat(gb, outer, holes, y, color, normal = UP, uvScale = 0.1) {
  const contour = outer.map(([x, z]) => new THREE.Vector2(x, z));
  const hs = (holes || []).map(h => h.map(([x, z]) => new THREE.Vector2(x, z)));
  let faces;
  try { faces = THREE.ShapeUtils.triangulateShape(contour, hs); } catch { return; }
  const all = contour.concat(...hs);
  for (const [i, j, k] of faces) {
    const a = all[i], b = all[j], c = all[k];
    gb.tri([a.x, y, a.y], [b.x, y, b.y], [c.x, y, c.y], normal,
      [a.x * uvScale, a.y * uvScale], [b.x * uvScale, b.y * uvScale], [c.x * uvScale, c.y * uvScale], color);
  }
}

// ---- ファサードテクスチャ (Canvas で生成) ----
function facadeTextures(type) {
  const S = 512, cell = S / TILE;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ev = document.createElement('canvas'); ev.width = ev.height = S;
  const g = cv.getContext('2d'), e = ev.getContext('2d');
  const rnd = hash('facade-' + type);
  g.fillStyle = '#ececec'; g.fillRect(0, 0, S, S);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  if (type === 'euro') {
    for (let fy = 0; fy < TILE; fy++) {
      for (let bx = 0; bx < TILE; bx++) {
        const x0 = bx * cell, y0 = fy * cell;
        if (bx % 4 === 3) { // 柱型
          g.fillStyle = '#f6f6f6'; g.fillRect(x0 + 6, y0, cell - 12, cell);
          g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(x0 + cell - 8, y0, 2, cell);
          continue;
        }
        // バルコニーの奥 (影) と掃き出し窓
        g.fillStyle = '#b3a996'; g.fillRect(x0 + 5, y0 + 10, cell - 10, cell - 18);
        const grad = g.createLinearGradient(x0, y0 + 10, x0, y0 + cell - 22);
        grad.addColorStop(0, '#b4c4d0'); grad.addColorStop(1, '#7f909e');
        g.fillStyle = grad; g.fillRect(x0 + 14, y0 + 14, cell - 28, cell - 38);
        g.fillStyle = '#e4e0d8'; g.fillRect(x0 + cell / 2 - 1, y0 + 14, 2, cell - 38);
        // 手すり (濃いグレーの格子)
        g.fillStyle = '#3b4148'; g.fillRect(x0 + 3, y0 + cell - 24, cell - 6, 3);
        for (let k = x0 + 6; k < x0 + cell - 4; k += 5) g.fillRect(k, y0 + cell - 22, 1.5, 14);
        // スラブの帯
        g.fillStyle = '#f7f7f7'; g.fillRect(x0, y0 + cell - 8, cell, 8);
        if (rnd() < 0.5) { e.fillStyle = rnd() < 0.7 ? '#ffd39a' : '#d8ecff'; e.globalAlpha = 0.5 + rnd() * 0.5; e.fillRect(x0 + 10, y0 + 12, cell - 20, cell - 34); e.globalAlpha = 1; }
      }
    }
    const mk2 = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
    return { map: mk2(cv, true), emissiveMap: mk2(ev, true) };
  }
  for (let fy = 0; fy < TILE; fy++) {
    for (let bx = 0; bx < TILE; bx++) {
      const x0 = bx * cell, y0 = fy * cell;
      let wx, wy, ww, wh;
      if (type === 'office') { wx = x0 + 6; wy = y0 + 12; ww = cell - 12; wh = cell - 22; }
      else {
        if (rnd() < 0.35) continue; // 窓のない壁
        wx = x0 + 16; wy = y0 + 16; ww = cell - 32; wh = cell - 30;
      }
      // 窓枠
      g.fillStyle = '#9a9ea3'; g.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
      const grad = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
      grad.addColorStop(0, '#a9bccc'); grad.addColorStop(0.5, '#7d91a4'); grad.addColorStop(1, '#617487');
      g.fillStyle = grad; g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(wx, wy, ww * 0.35, wh);
      if (type === 'office') { g.fillStyle = '#8a8e93'; g.fillRect(wx + ww / 2 - 1, wy, 2, wh); }
      // 夜の明かり
      if (rnd() < 0.45) {
        const warm = rnd() < 0.7;
        e.fillStyle = warm ? '#ffd39a' : '#d8ecff';
        e.globalAlpha = 0.55 + rnd() * 0.45;
        e.fillRect(wx, wy, ww, wh);
        e.globalAlpha = 1;
      }
    }
  }
  const mk = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: mk(cv, true), emissiveMap: mk(ev, true) };
}

const OFFICE_WALL = ['#d9d6cf', '#c9c4ba', '#e6e2da', '#b8bcc2', '#d2c7b4', '#a9aeb5', '#efece6', '#c4b9a8'];
const HOUSE_WALL = ['#f2ede3', '#e8dcc8', '#d9cdb8', '#f5f2ea', '#c8b8a0', '#e0e0dc', '#d6d0c4'];
const OFFICE_ROOF = ['#8a8d90', '#9a9a95', '#7d8184', '#a3a29c'];
const HOUSE_ROOF = ['#5a5f66', '#6b4f3f', '#4d5560', '#7a6a5a', '#3f4650'];
const HOUSE_KINDS = new Set(['house', 'detached', 'residential', 'semidetached_house', 'garage', 'garages', 'shed', 'hut', 'terrace']);

// 種類 (style) ごとの外観。style / floors / roof は build_city.py の自動分類による
const STYLE_FACADE = {
  house: 'house', small: 'house', industrial: 'house', lowrise: 'house',
  apartment: 'office', commercial: 'office', public: 'office', parking: 'office',
};
const ROOF_TILE = ['#5d636b', '#6e5446', '#4f5a6a', '#7a6b5c', '#454b55', '#8a8f96'];

// 航空写真の色は白っぽく写る (かすみ・露出)。少し締めてから使う
const TILE_GAIN = 1.25;
function roofColor(hex) {
  const c = new THREE.Color(hex), hsl = {};
  c.getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.6), Math.max(0.08, Math.min(0.74, (hsl.l - 0.1) * 0.95)), THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
}

function buildBuildings(buildings) {
  const office = new GB(), house = new GB(), roof = new GB(), pitched = new GB(), euro = new GB();
  for (const b of buildings) {
    const rnd = hash((b.part || b.id) + (b.name || '')); // 上の段 (part) は元の建物と同じ色にする
    const area = Math.abs(signedArea(b.outer));
    const style = b.style || ((HOUSE_KINDS.has(b.kind) || (!b.kind && b.h < 9.5 && area < 180)) ? 'house' : 'apartment');
    const isHouse = STYLE_FACADE[style] !== 'office';
    let rc = col((isHouse ? HOUSE_ROOF : OFFICE_ROOF)[Math.floor(rnd() * 4)]);
    const real = b.rc ? roofColor(b.rc) : null; // 航空写真から読んだ屋根の色
    if (real) rc = real;

    // 車庫・駐輪場 (屋根だけ): 屋根板と柱
    if (style === 'carport') {
      const yb = b.y || 0, yTop = yb + b.h, yBot = yb + Math.max(0.1, b.h - 0.2);
      addFlat(roof, b.outer, b.holes, yTop, rc, UP);
      addFlat(roof, b.outer, b.holes, yBot, rc.map(v => v * 0.7), DOWN);
      const pc = col('#8a8d90');
      for (const [x, z] of b.outer) {
        const w = 0.06;
        for (const [nx, nz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
          const a = [x + (nx - nz) * w, yb, z + (nz + nx) * w], c = [x + (nx + nz) * w, yb, z + (nz - nx) * w];
          roof.tri(a, c, [c[0], yBot, c[2]], [nx, 0, nz], Z2, Z2, Z2, pc);
          roof.tri(a, [c[0], yBot, c[2]], [a[0], yBot, a[2]], [nx, 0, nz], Z2, Z2, Z2, pc);
        }
      }
      continue;
    }

    const isEuro = b.facade === 'euro';
    const F = { ...FACADE[isEuro ? 'euro' : isHouse ? 'house' : 'office'] };
    if (style === 'industrial' || style === 'lowrise') F.bay = 6;
    const wallGB = b.plain ? roof : isEuro ? euro : isHouse ? house : office; // plain = 窓のない壁 (塔屋など)
    let wc;
    if (b.color) { try { wc = col(b.color); } catch { /* ignore */ } }
    if (!wc) wc = col((isHouse ? HOUSE_WALL : OFFICE_WALL)[Math.floor(rnd() * (isHouse ? HOUSE_WALL.length : OFFICE_WALL.length))]);
    const yb = b.y || 0;                           // 基礎の高さ (地形)
    const y0 = yb + (b.minH || 0);
    const r = b.roof;
    const y1 = yb + (r ? b.h - r.rise : b.h);      // 屋根がある家は壁を低く (実測高さ = 棟の高さ)
    // 階数に合わせて窓の段を揃える
    if (b.floors) F.floor = Math.max(2.4, (y1 - y0) / b.floors);
    const uoff = Math.floor(rnd() * TILE), voff = Math.floor(rnd() * TILE) / TILE;
    const U = F.bay * TILE, V = F.floor * TILE;

    const rings = [[b.outer, false], ...(b.holes || []).map(h => [h, true])];
    for (const [ring, isHole] of rings) {
      const s = (signedArea(ring) > 0 ? 1 : -1) * (isHole ? -1 : 1);
      let per = uoff * F.bay;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length];
        const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const n = [dz / len * s, 0, -dx / len * s];
        const u0 = per / U, u1 = (per + len) / U, v0 = voff, v1 = (y1 - y0) / V + voff;
        const A0 = [a[0], y0, a[1]], B0 = [c[0], y0, c[1]], A1 = [a[0], y1, a[1]], B1 = [c[0], y1, c[1]];
        wallGB.tri(A0, B0, B1, n, [u0, v0], [u1, v0], [u1, v1], wc);
        wallGB.tri(A0, B1, A1, n, [u0, v0], [u1, v1], [u0, v1], wc);
        per += len;
      }
    }
    let tile = col(ROOF_TILE[Math.floor(rnd() * ROOF_TILE.length)]);
    if (real) tile = real.map(v => Math.min(1, v * TILE_GAIN)); // 瓦のテクスチャで暗くなる分を戻す
    if (r && r.t === 'skel') addSkelRoof(pitched, b.outer, y1, r, tile);
    else if (r) addPitched(pitched, roof, r, y1, tile, wc);
    else if (b.roofs) { // 点群から作った段: 部分ごとの屋根 (下の平らな面は屋根に隠れる)
      for (const r2 of b.roofs) {
        if (r2.t === 'skel') addSkelRoof(pitched, b.outer, y1, r2, tile);
        else addPitched(pitched, roof, r2, y1, tile, wc);
      }
      addFlat(roof, b.outer, b.holes, y1, rc, UP);
    }
    else if (b.mansard) addMansard(roof, b.outer, y1, col(b.mansard), rc);
    else addFlat(roof, b.outer, b.holes, y1, rc, UP);
    if (y0 > 0.1) addFlat(roof, b.outer, b.holes, y0, rc.map(v => v * 0.6), DOWN);
  }
  return { office: office.geometry(), house: house.geometry(), roof: roof.geometry(), pitched: pitched.geometry(), euro: euro.geometry() };
}

// 輪郭に沿った寄棟 (L 字などどんな形にも掛かる): 高さ = 勾配 k x 輪郭までの距離。
// 輪郭を 1 m のマスで切り分け、各頂点を距離に応じて持ち上げる
function addSkelRoof(gb, ring, y0, r, color) {
  const n = ring.length;
  const dist = (x, z) => {
    let best = Infinity;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = ring[j][0], az = ring[j][1], ex = ring[i][0] - ax, ez = ring[i][1] - az, l2 = ex * ex + ez * ez;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
      const d = Math.hypot(x - ax - ex * t, z - az - ez * t);
      if (d < best) best = d;
    }
    return best;
  };
  let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
  for (const [x, z] of ring) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
  const C = 1.0;
  // 多角形を 1 辺 (軸 ax の値 lim, keep = 残す側) で切る
  const cut = (poly, ax, lim, ge) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[(i + poly.length - 1) % poly.length], b = poly[i];
      const ia = ge ? a[ax] >= lim : a[ax] <= lim, ib = ge ? b[ax] >= lim : b[ax] <= lim;
      if (ia !== ib) { const t = (lim - a[ax]) / (b[ax] - a[ax]); const m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; m[ax] = lim; out.push(m); }
      if (ib) out.push(b);
    }
    return out;
  };
  for (let x0 = minx; x0 < maxx; x0 += C) {
    const col = cut(cut(ring, 0, x0, true), 0, x0 + C, false);
    if (col.length < 3) continue;
    for (let z0 = minz; z0 < maxz; z0 += C) {
      let cell = cut(cut(col, 1, z0, true), 1, z0 + C, false);
      cell = cell.filter((p, i) => { const q = cell[(i + 1) % cell.length]; return Math.abs(p[0] - q[0]) > 1e-6 || Math.abs(p[1] - q[1]) > 1e-6; });
      if (cell.length < 3) continue;
      let faces;
      try { faces = THREE.ShapeUtils.triangulateShape(cell.map(([x, z]) => new THREE.Vector2(x, z)), []); } catch { continue; }
      const P = cell.map(([x, z]) => [x, y0 + r.k * dist(x, z), z]);
      for (const [i, j, k] of faces) {
        const a = P[i], b = P[j], c = P[k];
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const l = Math.hypot(...nn);
        if (l < 1e-9) continue;
        nn = nn.map(v => v / l * (nn[1] < 0 ? -1 : 1));
        gb.tri(a, b, c, nn, [a[0], a[2]], [b[0], b[2]], [c[0], c[2]], color);
      }
    }
  }
}

// 切妻 / 寄棟屋根。uv: u = 軒方向 (m), v = 斜面方向 (m)
function addPitched(gb, gableGB, r, y0, color, wallColor) {
  const E = 0.45, L = r.len / 2 + E, W = r.wid / 2 + E, [ux, uz] = r.u, [cx, cz] = r.c;
  if (r.t === 'shed') { // 片流れ: t = up * 幅/2 の側が高い
    const up = r.up || 1, W0 = r.wid / 2, L0 = r.len / 2, k = r.rise / (2 * W0);
    const Q = (s, t) => [cx + ux * s - uz * t, y0 + k * (t * up + W0), cz + uz * s + ux * t];
    const B = (s, t) => [cx + ux * s - uz * t, y0, cz + uz * s + ux * t];
    const n = norm([uz * up * k, 1, -ux * up * k]);
    const sl = Math.hypot(2 * W, 2 * W * k);
    const a = Q(-L, -W * up), b = Q(L, -W * up), c = Q(L, W * up), d = Q(-L, W * up);
    gb.tri(a, b, c, n, [0, 0], [2 * L, 0], [2 * L, sl], color);
    gb.tri(a, c, d, n, [0, 0], [2 * L, sl], [0, sl], color);
    const dn = [-n[0], -n[1], -n[2]], under = wallColor.map(v => v * 0.8);
    const lo = (p) => [p[0], p[1] - 0.06, p[2]];
    gableGB.tri(lo(a), lo(b), lo(c), dn, Z2, Z2, Z2, under); // 軒裏
    gableGB.tri(lo(a), lo(c), lo(d), dn, Z2, Z2, Z2, under);
    for (const end of [-1, 1]) { // 両端の三角の壁
      gableGB.tri(B(end * L0, -W0 * up), B(end * L0, W0 * up), Q(end * L0, W0 * up), [ux * end, 0, uz * end], Z2, Z2, Z2, wallColor);
    }
    const hn = [-uz * up, 0, ux * up]; // 高い側の壁
    gableGB.tri(B(-L0, W0 * up), B(L0, W0 * up), Q(L0, W0 * up), hn, Z2, Z2, Z2, wallColor);
    gableGB.tri(B(-L0, W0 * up), Q(L0, W0 * up), Q(-L0, W0 * up), hn, Z2, Z2, Z2, wallColor);
    return;
  }
  const hip = r.t === 'hip' ? Math.min(W, L * 0.6) : 0;
  const P = (s, t, y) => [cx + ux * s - uz * t, y, cz + uz * s + ux * t];
  const top = y0 + r.rise, off = r.off || 0; // off = 棟の中心からのずれ (m)
  const r0 = P(-L + hip, off, top), r1 = P(L - hip, off, top);
  for (const side of [-1, 1]) {
    const e0 = P(-L, side * W, y0), e1 = P(L, side * W, y0);
    const run = W - side * off, slope = Math.hypot(run, r.rise);
    const n = normalOf(e0, e1, r1, side, ux, uz, run, r.rise);
    gb.tri(e0, e1, r1, n, [0, 0], [2 * L, 0], [2 * L - hip, slope], color);
    gb.tri(e0, r1, r0, n, [0, 0], [2 * L - hip, slope], [hip, slope], color);
  }
  for (const end of [-1, 1]) {
    const a = P(end * L, -W, y0), c = P(end * L, W, y0), t = end < 0 ? r0 : r1;
    if (hip > 0) {
      const hl = Math.hypot(hip, r.rise);
      const n = norm([ux * end * r.rise, hip, uz * end * r.rise]);
      gb.tri(a, c, t, n, [0, 0], [2 * W, 0], [W, hl], color);
    } else {
      gableGB.tri(a, c, t, [ux * end, 0, uz * end], Z2, Z2, Z2, wallColor); // 妻壁
    }
  }
  // 軒裏
  const d = [P(-L, -W, y0 - 0.02), P(L, -W, y0 - 0.02), P(L, W, y0 - 0.02), P(-L, W, y0 - 0.02)];
  gableGB.tri(d[0], d[1], d[2], DOWN, Z2, Z2, Z2, wallColor.map(v => v * 0.8));
  gableGB.tri(d[0], d[2], d[3], DOWN, Z2, Z2, Z2, wallColor.map(v => v * 0.8));
}
// マンサード風の最上部 (外周から内側へ傾いた濃い色の帯 + 平らな屋上)
function addMansard(gb, ring, y, color, topColor) {
  const H = 1.5, D = 0.9, s = signedArea(ring) > 0 ? 1 : -1, n = ring.length;
  const N = ring.map((a, i) => {
    const c = ring[(i + 1) % n], dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [dz / l * s, -dx / l * s]; // 外向き
  });
  const inner = ring.map((p, i) => {
    const n1 = N[(i - 1 + n) % n], n2 = N[i];
    const k = Math.max(0.35, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [p[0] - (n1[0] + n2[0]) / k * D, p[1] - (n1[1] + n2[1]) / k * D];
  });
  // 軒 (少し張り出した白い帯)
  for (let i = 0; i < n; i++) {
    const a = ring[i], c = ring[(i + 1) % n], ia = inner[i], ic = inner[(i + 1) % n];
    const o = [N[i][0], 0.0, N[i][1]];
    const nn = norm([N[i][0] * H, D, N[i][1] * H]);
    gb.tri([a[0], y, a[1]], [c[0], y, c[1]], [ic[0], y + H, ic[1]], nn, Z2, Z2, Z2, color);
    gb.tri([a[0], y, a[1]], [ic[0], y + H, ic[1]], [ia[0], y + H, ia[1]], nn, Z2, Z2, Z2, color);
    void o;
  }
  addFlat(gb, inner, null, y + H, topColor, UP);
}

function norm(v) { const l = Math.hypot(...v) || 1; return v.map(x => x / l); }
function normalOf(e0, e1, r1, side, ux, uz, W, rise) {
  // 斜面の外向き法線: 横方向 (side) と上方向の合成
  const tx = -uz * side, tz = ux * side;
  return norm([tx * rise, W, tz * rise]);
}

function roofTileTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, S, S);
  for (let row = 0; row < 8; row++) {
    const y = row * 16;
    const grad = g.createLinearGradient(0, y, 0, y + 16);
    grad.addColorStop(0, '#f2f2f2'); grad.addColorStop(0.75, '#c4c4c4'); grad.addColorStop(1, '#8a8a8a');
    g.fillStyle = grad; g.fillRect(0, y, S, 16);
    g.fillStyle = 'rgba(0,0,0,.12)';
    for (let x = (row % 2) * 8; x < S; x += 16) g.fillRect(x, y, 1, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.repeat.set(1 / 2.0, 1 / 2.0); // 2m ごとに 8 段 = 25cm の瓦
  return t;
}

// ---- 道路・線路・水面 ----
function addRibbon(gb, pts, w, y, color, caps = true) {
  const hw = w / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const nx = -dz / len * hw, nz = dx / len * hw;
    const p1 = [ax + nx, y, az + nz], p2 = [ax - nx, y, az - nz], p3 = [bx - nx, y, bz - nz], p4 = [bx + nx, y, bz + nz];
    gb.tri(p1, p2, p3, UP, Z2, Z2, Z2, color);
    gb.tri(p1, p3, p4, UP, Z2, Z2, Z2, color);
  }
  if (caps) for (const [x, z] of pts) addDisc(gb, x, z, hw, y, color);
}

// mask[i] が true の区間だけ描く。端の丸は描いた区間に接する頂点だけ
function addRibbonMasked(gb, pts, w, y, color, mask, caps = true) {
  let run = [];
  const flush = () => { if (run.length >= 2) addRibbon(gb, run, w, y, color, caps); run = []; };
  for (let i = 0; i < pts.length - 1; i++) {
    if (mask[i]) { if (!run.length) run.push(pts[i]); run.push(pts[i + 1]); }
    else flush();
  }
  flush();
}

function addDisc(gb, x, z, r, y, color, seg = 10) {
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    gb.tri([x, y, z], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], UP, Z2, Z2, Z2, color);
  }
}

function offsetLine(pts, off) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [p[0] - dz / l * off, p[1] + dx / l * off];
  });
}

export const ROAD_STYLE = {
  trunk: ['#3f4145', 0.10, true], trunk_link: ['#45474b', 0.095, false], primary: ['#434549', 0.10, true], primary_link: ['#45474b', 0.095, false],
  secondary: ['#4a4c50', 0.09, true], secondary_link: ['#4a4c50', 0.09, false], tertiary: ['#505256', 0.085, true], tertiary_link: ['#505256', 0.085, false],
  unclassified: ['#5a5c60', 0.08, false], residential: ['#5c5e62', 0.08, false], living_street: ['#62646a', 0.08, false],
  service: ['#66686c', 0.075, false], busway: ['#55575b', 0.085, false], track: ['#8c7f6a', 0.07, false],
  pedestrian: ['#c2b8a6', 0.065, false], footway: ['#bdb3a1', 0.06, false], path: ['#a99d86', 0.06, false],
  cycleway: ['#9a6f68', 0.06, false], steps: ['#a59c8c', 0.06, false], corridor: ['#bdb3a1', 0.06, false],
};
const SIDEWALK = '#b3ab9e', MARK = '#e8e4d8';

export const AREA_STYLE = {
  residential: ['#aaa79c', 0.01], commercial: ['#a8a39b', 0.01], railway: ['#8e867b', 0.012], farm: ['#a7ae7c', 0.012],
  grass: ['#86a85f', 0.02], wood: ['#5b7a45', 0.021], park: ['#80a75c', 0.022], school: ['#c4b9a2', 0.02],
  parking: ['#76777a', 0.024], pitch: ['#6f9d52', 0.026], plaza: ['#cbc1ae', 0.05], water: ['#4f7d9c', 0.03], platform: ['#b9b4aa', 0.11],
};

function buildGround(city, bridges) {
  const gb = new GB(), water = new GB();
  for (const a of city.areas) {
    const st = AREA_STYLE[a.kind];
    if (!st) continue;
    addFlat(a.kind === 'water' ? water : gb, a.outer, a.holes, st[1], col(st[0]));
  }
  for (const w of city.waterways) addRibbon(water, w.pts, w.w, 0.032, col(AREA_STYLE.water[0]));

  // 道路: PLATEAU の道路面 (実測の形) → 推定した歩道 → PLATEAU に無い区間だけ OSM の帯 → センターライン
  const ASPHALT = col('#4c4e52');
  const roadGB = new GB();
  for (const a of city.roadAreas || []) addFlat(roadGB, a.outer, a.holes, 0.07, ASPHALT);
  const covered = (r, i) => !!(r.cov && r.cov[i]);
  // 交差点 (車道の頂点を3方向以上で共有) ごとの最大の半幅。歩道の帯は交差点の手前で切る
  const nodeHalf = new Map(), nodeDeg = new Map();
  const nk = (p) => p[0].toFixed(1) + ',' + p[1].toFixed(1);
  for (const r of city.roads) {
    if (!ROAD_STYLE[r.kind] || !r.cov) continue;
    r.pts.forEach((p, i) => {
      const k = nk(p), deg = (i > 0) + (i < r.pts.length - 1);
      nodeDeg.set(k, (nodeDeg.get(k) || 0) + deg);
      nodeHalf.set(k, Math.max(nodeHalf.get(k) || 0, r.w / 2));
    });
  }
  const trimAt = (p) => (nodeDeg.get(nk(p)) || 0) >= 3 ? nodeHalf.get(nk(p)) + 1.0 : 0;
  for (const r of city.roads) {
    const st = ROAD_STYLE[r.kind];
    if (!st || r.ys) continue; // 橋と坂は bridges.js で描く
    // PLATEAU で覆われていない区間 (私道・遊歩道・データ外) は OSM の中心線から描く
    const segs = r.pts.slice(0, -1).map((_, i) => !covered(r, i));
    if (st[2] && !r.sw) addRibbonMasked(gb, r.pts, r.w + 4, 0.04, col(SIDEWALK), segs);
    addRibbonMasked(gb, r.pts, r.w, st[1], col(st[0]), segs);
    // 歩道 (幹線で道幅から推定): 道路面の縁から内側に sw の帯 + 縁石の線
    if (r.sw && r.half) {
      for (const [side, half] of [[1, r.half[0]], [-1, r.half[1]]]) {
        const sw = offsetLine(r.pts, side * (half - r.sw / 2)), curb = offsetLine(r.pts, side * (half - r.sw));
        for (let i = 0; i < r.pts.length - 1; i++) {
          if (!covered(r, i)) continue;
          const L = Math.hypot(r.pts[i + 1][0] - r.pts[i][0], r.pts[i + 1][1] - r.pts[i][1]);
          const t0 = trimAt(r.pts[i]) / L, t1 = 1 - trimAt(r.pts[i + 1]) / L;
          if (t1 - t0 < 0.02) continue;
          const cut = (line) => { const a = line[i], b = line[i + 1]; return [[a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]]; };
          addRibbon(gb, cut(sw), r.sw, 0.09, col(SIDEWALK), true);
          addRibbon(gb, cut(curb), 0.18, 0.1, col('#cfcac0'), false);
        }
      }
    }
  }
  for (const r of city.roads) {
    const st = ROAD_STYLE[r.kind];
    if (!st || !st[2] || r.ys) continue;
    const c0 = r.half ? (r.half[0] - r.half[1]) / 2 : 0; // 車道の中心 (中心線とのずれ)
    addRibbon(gb, c0 ? offsetLine(r.pts, c0) : r.pts, 0.18, 0.115, col(MARK), false);
  }
  // 線路: バラスト + 2本のレール
  const ballast = col('#7a7068'), rail = col('#b0b5ba');
  for (const r of city.rails) {
    if (r.ys) continue; // 線路の橋は bridges.js で描く
    addRibbon(gb, r.pts, 3.4, 0.13, ballast);
    for (const off of [-0.72, 0.72]) addRibbon(gb, offsetLine(r.pts, off), 0.12, 0.25, rail, false);
  }
  // 車道の橋の部分の道路面は描かない (川底に沈むため。橋げたは bridges.js)
  return { ground: drape(gb.geometry()), water: drape(water.geometry(), 3.5, 0.45), roads: drape(roadGB.geometry(), 3.5, 0.12, (x, z) => bridges.onVehicleBridge(x, z)) };
}

// ---- 木 (公園・森・草地) ----
// 位置は tools/build_props.py が計算した data/props.json の trees: [x, z, y, 大きさの倍率, 0〜1 の乱数]
function buildTrees(props) {
  const spots = (props && props.trees) || [];
  if (!props) console.warn('data/props.json が無いので木を置きません (python tools/build_props.py で作る)');
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 2.2, 6).translate(0, 1.1, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1.7, 0).translate(0, 3.2, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#6b5440', roughness: 1 }), spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  spots.forEach(([x, z, y, sc, r], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * 6.28);
    m.compose(p.set(x, y, z), q, s.set(sc, sc, sc));
    trunks.setMatrixAt(i, m); crowns.setMatrixAt(i, m);
    crowns.setColorAt(i, c.setHSL(0.24 + r * 0.08, 0.45, 0.28 + r * 0.12));
  });
  trunks.castShadow = crowns.castShadow = true;
  crowns.receiveShadow = true;
  trunks.name = 'trees_trunk'; crowns.name = 'trees_crown';
  return [trunks, crowns];
}

export function buildCity(city, world, props = null) {
  const group = new THREE.Group();
  group.name = 'totsuka_city';

  const officeTex = facadeTextures('office'), houseTex = facadeTextures('house');
  const wallMat = (tex) => new THREE.MeshStandardMaterial({
    map: tex.map, emissiveMap: tex.emissiveMap, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0,
    vertexColors: true, roughness: 0.82, metalness: 0.05,
  });
  const mats = {
    office: wallMat(officeTex),
    house: wallMat(houseTex),
    roof: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
    euro: wallMat(facadeTextures('euro')),
    pitched: new THREE.MeshStandardMaterial({ vertexColors: true, map: roofTileTexture(), roughness: 0.75, side: THREE.DoubleSide }),
    ground: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    water: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.2 }),
  };

  const bg = buildBuildings(city.buildings);
  for (const k of ['office', 'house', 'roof', 'pitched', 'euro']) {
    const mesh = new THREE.Mesh(bg[k], mats[k]);
    mesh.name = 'buildings_' + k;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }

  const bridges = new Bridges(city);
  const gr = buildGround(city, bridges);
  const ground = new THREE.Mesh(gr.ground, mats.ground); ground.name = 'roads_and_areas';
  const water = new THREE.Mesh(gr.water, mats.water); water.name = 'water';
  ground.receiveShadow = water.receiveShadow = true;
  const roadsM = new THREE.Mesh(gr.roads, mats.ground); roadsM.name = 'road_areas'; roadsM.receiveShadow = true;
  group.add(ground, water, roadsM, bridges.build());

  const base = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#a4a296', roughness: 1 }));
  base.name = 'base_ground';
  base.receiveShadow = true;
  if (hasTerrain()) {
    base.position.y = -12; // 地形の外側 (マップ範囲外) 用。地形の下に隠す
    group.add(buildTerrainMesh('#a4a296'));
  }
  group.add(base);

  group.add(...buildTrees(props));

  return { group, windowMats: [mats.office, mats.house, mats.euro], waterMat: mats.water, mats };
}
