// city.json から街のメッシュを組み立てる
import * as THREE from 'three';
import { releaseCanvasAfterUpload } from './lowmem.js';
import { H, drape, buildTerrainMesh, hasTerrain, hasCover } from './terrain.js';
import { Bridges } from './bridges.js';
import { buildStairs } from './stairs.js';
import { buildWalls } from './walls.js';

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

// ---- ランドマークの外壁 (city.json の looks。tools/landmarks.py が設定) ----
// テクスチャは 1 段 = 1 階分の柄を縦に並べたもの。壁は階ごとに切って、その階の柄の段を貼る (横は 8 ベイで繰り返し)
const LOOK_ROWS = { shop: 0, panel: 1, screen: 2, parking: 3, glass: 4, plain: 5, ribbon: 6, screen2: 7, open: 8, shutter: 9, band: 10, louver: 11 };
const LOOK_NR = 16, LOOK_NB = 8, LOOK_BAY = 6; // 段の数 (テクスチャは縦長)、横のベイ数、1 ベイの幅 (m)
function lookTextures(L) {
  const S = 1024, SH = 2048, cw = S / LOOK_NB, rh = SH / LOOK_NR;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = SH;
  const ev = document.createElement('canvas'); ev.width = S; ev.height = SH;
  const g = cv.getContext('2d'), e = ev.getContext('2d');
  const rnd = hash('look-' + L.wall + L.accent);
  g.fillStyle = L.wall; g.fillRect(0, 0, S, SH);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, SH);
  const top = (r) => SH - (r + 1) * rh; // 段 r の上端 (テクスチャの v は下から上)
  const lit = (x, y, w, h, color, a) => { e.fillStyle = color; e.globalAlpha = a; e.fillRect(x, y, w, h); e.globalAlpha = 1; };
  const glass = (x, y, w, h, c0, c1) => { const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, c0); gr.addColorStop(1, c1); g.fillStyle = gr; g.fillRect(x, y, w, h); };
  for (let bx = 0; bx < LOOK_NB; bx++) {
    const x0 = bx * cw;
    // 1 階の店: 柱の間にガラス、上にアクセント色の帯
    let y = top(LOOK_ROWS.shop);
    glass(x0 + 8, y + 26, cw - 16, rh - 34, '#a4b8c6', '#5f7486');
    g.fillStyle = '#33373c';
    g.fillRect(x0 + 8, y + 26, cw - 16, 3);
    for (let k = 0; k <= 3; k++) g.fillRect(x0 + 8 + (cw - 16) * k / 3 - 1, y + 26, 2, rh - 34);
    g.fillStyle = L.accent; g.fillRect(x0, y, cw, 22);
    g.fillStyle = '#8d8a84'; g.fillRect(x0, y + rh - 8, cw, 8);
    lit(x0 + 8, y + 29, cw - 16, rh - 40, '#ffe2b0', 0.85);
    // 白いパネルの壁に、こげ茶の縦の帯 (細い窓入り)。段ごとに帯の位置を半ベイずらす (千鳥)
    // (奇数階は壁を貼るときに半ベイずらす)
    {
      y = top(LOOK_ROWS.panel);
      g.fillStyle = 'rgba(0,0,0,.10)';
      g.fillRect(x0, y, 1.5, rh); g.fillRect(x0 + cw / 2, y, 1, rh); g.fillRect(x0, y + rh - 2, cw, 2); g.fillRect(x0, y + rh / 2, cw, 1);
      const fx = x0 + 14, fw = 36;
      g.fillStyle = L.accent; g.fillRect(fx, y, fw, rh);
      glass(fx + 10, y + 16, fw - 20, rh - 36, '#3a4a58', '#222c35');
      if (rnd() < 0.5) lit(fx + 10, y + 16, fw - 20, rh - 36, '#ffd39a', 0.5 + rnd() * 0.4);
    }
    // アクセント色の壁に、白い縦の棒を互い違いに並べた目隠し (screen / screen2 を階ごとに交互に使う)。
    // 8 ベイのうち 2 ベイは白い壁で、アクセント色の太い帯と灰色のルーバーの帯が上下に通る
    for (const [r, xs] of [[LOOK_ROWS.screen, [12, 58, 98]], [LOOK_ROWS.screen2, [34, 78, 116]]]) {
      y = top(r);
      if (bx === 0) {
        g.fillStyle = L.accent; g.fillRect(x0 + 24, y, 58, rh);
        g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(x0, y + rh - 2, cw, 2);
      } else if (bx === 1) {
        g.fillStyle = '#b9bbb8'; g.fillRect(x0 + 30, y, 62, rh);
        g.fillStyle = 'rgba(0,0,0,.16)'; for (let k = 0; k < rh; k += 5) g.fillRect(x0 + 30, y + k, 62, 1.5);
        g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(x0, y + rh - 2, cw, 2);
      } else {
        g.fillStyle = L.accent; g.fillRect(x0, y, cw, rh);
        g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x0, y + rh - 3, cw, 3);
        glass(x0 + xs[0] + 16, y + 34, 14, 52, '#2a333b', '#171c21'); // 小さな窓
        g.fillStyle = L.wall;
        for (const q of xs) g.fillRect(x0 + q, y + 6, 9, rh - 14);
        if (rnd() < 0.35) lit(x0 + xs[0] + 16, y + 34, 14, 52, '#ffd39a', 0.5);
      }
    }
    // 駐車場の階: 腰壁の上が暗い開口、柱と横のルーバー
    y = top(LOOK_ROWS.parking);
    glass(x0, y + 20, cw, rh - 62, '#1d1f22', '#34373b');
    g.fillStyle = 'rgba(236,235,230,.5)';
    for (let k = 0; k < 3; k++) g.fillRect(x0, y + 30 + k * 18, cw, 3);
    g.fillStyle = L.wall; g.fillRect(x0, y + 20, 12, rh - 62);
    g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(x0, y + rh - 42, cw, 2); g.fillRect(x0, y + rh - 2, cw, 2);
    lit(x0 + 12, y + 20, cw - 12, rh - 62, '#fff2cc', 0.16);
    // 入口まわりのガラス面
    y = top(LOOK_ROWS.glass);
    glass(x0, y, cw, rh, '#aec4d2', '#6f8698');
    g.fillStyle = '#55697a'; g.fillRect(x0, y + rh - 16, cw, 16);
    g.fillStyle = 'rgba(240,244,246,.9)';
    for (let k = 0; k < 4; k++) g.fillRect(x0 + k * cw / 4, y, 2, rh);
    g.fillRect(x0, y + rh * 0.45, cw, 2);
    for (let k = 0; k < 4; k++) if (rnd() < 0.6) lit(x0 + k * cw / 4 + 2, y, cw / 4 - 2, rh - 16, rnd() < 0.7 ? '#ffe2b0' : '#d8ecff', 0.4 + rnd() * 0.4);
    // 横に続く窓の帯 (駅舎など): 下に腰壁、上にアクセント色の細い線
    y = top(LOOK_ROWS.ribbon);
    glass(x0, y + 26, cw, rh - 66, '#9db3c2', '#5d7385');
    g.fillStyle = 'rgba(240,244,246,.9)';
    for (let k = 0; k < 4; k++) g.fillRect(x0 + k * cw / 4, y + 26, 2, rh - 66);
    g.fillStyle = L.accent; g.fillRect(x0, y + 8, cw, 6);
    g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(x0, y + rh - 2, cw, 2); g.fillRect(x0, y, 1.5, 26); g.fillRect(x0, y + rh - 40, 1.5, 40);
    for (let k = 0; k < 4; k++) if (rnd() < 0.75) lit(x0 + k * cw / 4 + 2, y + 26, cw / 4 - 2, rh - 66, '#fff0cf', 0.5 + rnd() * 0.35);
    // 開いた入口 (駅の自由通路など): 上に白い梁、奥は暗く、天井の明かりが並ぶ
    y = top(LOOK_ROWS.open);
    glass(x0, y + 30, cw, rh - 30, '#2b2e31', '#15171a');
    g.fillStyle = '#f3e9c4'; for (let k = 0; k < 3; k++) g.fillRect(x0 + 14 + k * 40, y + 44, 22, 4);
    g.fillStyle = L.wall; g.fillRect(x0, y + 30, 10, rh - 30);
    g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x0, y + 28, cw, 2);
    lit(x0 + 10, y + 30, cw - 10, rh - 30, '#fff0cf', 0.55);
    // 付属棟 (グランシティの道路側): クリーム色の壁に横の目地、上に濃い茶の縁。shutter は灰色のシャッター 2 枚
    for (const kind of ['band', 'shutter']) {
      y = top(LOOK_ROWS[kind]);
      g.fillStyle = 'rgba(0,0,0,.10)';
      for (let k = 1; k < 6; k++) g.fillRect(x0, y + 14 + k * (rh - 14) / 6, cw, 1.5);
      g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(x0, y + 14, cw, rh - 14);
      g.fillStyle = L.accent; g.fillRect(x0, y, cw, 12);
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x0, y + 12, cw, 2);
      if (kind === 'shutter') {
        for (const sx of [6, 66]) {
          g.fillStyle = '#6d7276'; g.fillRect(x0 + sx, y + 30, 56, rh - 30);
          g.fillStyle = 'rgba(0,0,0,.28)'; for (let k = 0; k < rh - 30; k += 6) g.fillRect(x0 + sx, y + 30 + k, 56, 1.5);
          g.fillStyle = '#4c5256'; g.fillRect(x0 + sx - 3, y + 26, 62, 5);
        }
      }
    }
    // 立体駐車場: 灰緑の金属パネルを横に張った面と、柱の見える暗い開口を上下に重ねる
    y = top(LOOK_ROWS.louver);
    g.fillStyle = L.accent; g.fillRect(x0, y, cw, rh);
    glass(x0, y + 8, cw, rh * 0.34, '#2a2d31', '#454a50');
    g.fillStyle = '#7e8387'; g.fillRect(x0 + cw / 2 - 3, y + 8, 6, rh * 0.34);
    g.fillStyle = L.wall; g.fillRect(x0, y + rh * 0.42 + 8, cw, rh * 0.58 - 8);
    g.fillStyle = 'rgba(0,0,0,.18)'; for (let k = 0; k < 3; k++) g.fillRect(x0, y + rh * 0.42 + 18 + k * (rh * 0.58 - 24) / 3, cw, 1.5);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x0, y, 2, rh); g.fillRect(x0, y + rh * 0.42 + 6, cw, 3);
    // 窓のない壁 (屋上の塔屋など)
    y = top(LOOK_ROWS.plain);
    g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(x0, y, 1.5, rh); g.fillRect(x0, y + rh - 2, cw, 2);
  }
  const mk = (c) => { const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace; return releaseCanvasAfterUpload(t); };
  return { map: mk(cv), emissiveMap: mk(ev) };
}

// 輪郭 1 周の壁を、階ごと・入口の前後で切って貼る。y0〜y1 = この建物データ (段) の壁の下端〜上端
function addLookWalls(gb, b, L, y0, y1) {
  const fh = L.floor_h, base = L.y0, U = LOOK_BAY * LOOK_NB, W = [1, 1, 1], eps = 0.004;
  const rings = [[b.outer, false], ...(b.holes || []).map(h => [h, true])];
  for (const [ring, isHole] of rings) {
    const s = (signedArea(ring) > 0 ? 1 : -1) * (isHole ? -1 : 1);
    let per = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const ux = dx / len, uz = dz / len, n = [uz * s, 0, -ux * s];
      // 入口 (doors) の左右 door_w (既定 7 m) はガラス面 (door_kind で別の柄にできる)
      const dw = L.door_w || 7;
      const iv = [];
      if (!isHole) for (const d of L.doors || []) {
        const t = (d[0] - a[0]) * ux + (d[1] - a[1]) * uz, off = Math.abs((d[0] - a[0]) * uz - (d[1] - a[1]) * ux);
        if (off <= (L.door_off || 8) && t > -4 && t < len + 4) iv.push([Math.max(0, t - dw), Math.min(len, t + dw)]);
      }
      const cuts = [...new Set([0, len, ...iv.flat()])].sort((p, q) => p - q);
      for (let j = 0; j + 1 < cuts.length; j++) {
        const t0 = cuts[j], t1 = cuts[j + 1];
        if (t1 - t0 < 0.01) continue;
        const isGlass = iv.some(([p, q]) => t0 >= p - 1e-6 && t1 <= q + 1e-6);
        const u0 = (per + t0) / U, u1 = (per + t1) / U;
        const P = (t, y) => [a[0] + ux * t, y, a[1] + uz * t];
        for (let k = Math.floor((y0 - base) / fh + 1e-6); base + k * fh < y1 - 1e-6; k++) {
          const yf = base + k * fh, ya = Math.max(y0, yf), yb = Math.min(y1, yf + fh);
          let kind = (k >= 0 && L.floors[k]) || 'plain';
          let ush = 0;
          if (isGlass && k >= 0 && k < (L.glass_floors || 0)) kind = L.door_kind || 'glass';
          else if (kind === 'panel' && k % 2) ush = 0.5 / LOOK_NB; // 千鳥: 奇数階は半ベイずらす
          else if (kind === 'screen' && k % 2) kind = 'screen2';
          const row = LOOK_ROWS[kind];
          const va = (row + Math.max(eps, (ya - yf) / fh)) / LOOK_NR, vb = (row + Math.min(1 - eps, (yb - yf) / fh)) / LOOK_NR;
          gb.tri(P(t0, ya), P(t1, ya), P(t1, yb), n, [u0 + ush, va], [u1 + ush, va], [u1 + ush, vb], W);
          gb.tri(P(t0, ya), P(t1, yb), P(t0, yb), n, [u0 + ush, va], [u1 + ush, vb], [u0 + ush, vb], W);
        }
      }
      per += len;
    }
  }
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

function inRing(x, z, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}

function buildBuildings(buildings, looks = {}, platforms = []) {
  const office = new GB(), house = new GB(), roof = new GB(), pitched = new GB(), euro = new GB();
  const lookGB = {}; // ランドマークの外壁 (外観ごとに 1 つ)
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
      // ホームの上の屋根データは、ホームの屋根 (detail/station.js) と重なるので描かない
      const cx = b.outer.reduce((t, q) => t + q[0], 0) / b.outer.length, cz = b.outer.reduce((t, q) => t + q[1], 0) / b.outer.length;
      if (platforms.some(r => inRing(cx, cz, r))) continue;
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

    const look = b.look && looks[b.look];
    if (look) addLookWalls(lookGB[b.look] || (lookGB[b.look] = new GB()), b, look, y0, y1);
    const rings = look ? [] : [[b.outer, false], ...(b.holes || []).map(h => [h, true])];
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
  return { office: office.geometry(), house: house.geometry(), roof: roof.geometry(), pitched: pitched.geometry(), euro: euro.geometry(),
    looks: Object.fromEntries(Object.entries(lookGB).map(([k, gb]) => [k, gb.geometry()])) };
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
  industrial: ['#a39f97', 0.008], hospital: ['#a8a39b', 0.009], worship: ['#b7ad98', 0.011], cemetery: ['#aaa69d', 0.018],
  parking: ['#76777a', 0.024], pitch: ['#6f9d52', 0.026], plaza: ['#cbc1ae', 0.05], water: ['#4f7d9c', 0.03], platform: ['#b9b4aa', 0.11],
};

// 外側線: PLATEAU の道路面の縁から少し内側に白線を引く。
// 隣の面との境界・橋の上・推定した歩道がある幹線 (縁石線が別にある)・車道でない道 (歩道・階段など) の縁は引かない。
// 最も近い OSM の道路の種類で対象を決める: EDGE_KINDS (幹線) と、幅 EDGE_MIN_W 以上の細い道。
const EDGE_KINDS = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const EDGE_NARROW = new Set(['residential', 'unclassified']), EDGE_MIN_W = 5.5; // 住宅街の道は 5.5 m 以上だけ (これより狭い道は実際も線が無いことが多い)
const EDGE_OFFSET = 0.35, EDGE_WIDTH = 0.15, EDGE_CELL = 25;
function addEdgeLines(gb, city, bridges) {
  const areas = (city.roadAreas || []).map((a) => {
    const p = a.outer; let s = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length]; s += p[i][0] * q[1] - q[0] * p[i][1];
      x0 = Math.min(x0, p[i][0]); x1 = Math.max(x1, p[i][0]); z0 = Math.min(z0, p[i][1]); z1 = Math.max(z1, p[i][1]);
    }
    return { p, ccw: s > 0, x0, x1, z0, z1 };
  });
  const cellOf = (v) => Math.floor(v / EDGE_CELL), key = (i, j) => i * 100003 + j;
  const addGrid = (grid, x0, x1, z0, z1, item) => {
    for (let i = cellOf(x0); i <= cellOf(x1); i++) for (let j = cellOf(z0); j <= cellOf(z1); j++) {
      const k = key(i, j); (grid.get(k) || grid.set(k, []).get(k)).push(item);
    }
  };
  const areaGrid = new Map();
  areas.forEach((a) => addGrid(areaGrid, a.x0, a.x1, a.z0, a.z1, a));
  const inside = (p, x, z) => {
    let c = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i][1] > z) !== (p[j][1] > z) && x < (p[j][0] - p[i][0]) * (z - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
    }
    return c;
  };
  const insideOther = (self, x, z) => (areaGrid.get(key(cellOf(x), cellOf(z))) || []).some((a) => a !== self && x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1 && inside(a.p, x, z));

  // 車道の線分を格子に入れ、縁の中点から最も近い道路を引く
  const segGrid = new Map();
  for (const r of city.roads) {
    if (!ROAD_STYLE[r.kind] || r.ys || r.kind === 'service') continue; // 私道・駐車場内の道は、重なっていても本線の判定を邪魔させない
    const reach = r.w / 2 + 4;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      addGrid(segGrid, Math.min(ax, bx) - reach, Math.max(ax, bx) + reach, Math.min(az, bz) - reach, Math.max(az, bz) + reach, { r, ax, az, bx, bz });
    }
  }
  const nearestRoad = (x, z) => {
    let best = null, bd = 1e9;
    for (const s of segGrid.get(key(cellOf(x), cellOf(z))) || []) {
      const ex = s.bx - s.ax, ez = s.bz - s.az, l2 = ex * ex + ez * ez || 1;
      const t = Math.min(1, Math.max(0, ((x - s.ax) * ex + (z - s.az) * ez) / l2));
      const d = Math.hypot(x - s.ax - ex * t, z - s.az - ez * t) - s.r.w / 2; // 道路面の縁までの距離
      if (d < bd) { bd = d; best = s.r; }
    }
    return bd < 4 ? best : null;
  };

  const MARKC = col(MARK);
  for (const a of areas) {
    const p = a.p;
    for (let i = 0; i < p.length; i++) {
      const u = p[i], v = p[(i + 1) % p.length];
      const dx = v[0] - u[0], dz = v[1] - u[1], len = Math.hypot(dx, dz);
      if (len < 0.8) continue;
      const nx = (a.ccw ? -dz : dz) / len, nz = (a.ccw ? dx : -dx) / len; // 内向きの法線
      const mx = (u[0] + v[0]) / 2, mz = (u[1] + v[1]) / 2;
      if (insideOther(a, mx - nx * 0.4, mz - nz * 0.4)) continue; // 外側にも道路面がある = 面どうしの境界
      if (bridges.onVehicleBridge(mx, mz)) continue;
      const r = nearestRoad(mx, mz);
      if (!r || r.sw || !(EDGE_KINDS.has(r.kind) || (EDGE_NARROW.has(r.kind) && r.w >= EDGE_MIN_W))) continue;
      addRibbon(gb, [[u[0] + nx * EDGE_OFFSET, u[1] + nz * EDGE_OFFSET], [v[0] + nx * EDGE_OFFSET, v[1] + nz * EDGE_OFFSET]], EDGE_WIDTH, 0.115, MARKC, true);
    }
  }
}

const COVERED = new Set(['residential', 'commercial', 'industrial', 'hospital', 'worship']);
function buildGround(city, bridges) {
  const gb = new GB(), water = new GB();
  for (const a of city.areas) {
    const st = AREA_STYLE[a.kind];
    if (!st) continue;
    if (hasCover() && COVERED.has(a.kind)) continue; // 団地・商業地・工場などの敷地の一色の面は、地面の種類 (cover.json) があればそちらを見せる
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
  // 車線の線。OSM は上り・下りや右折レーンを別の道路として持つ。
  //  - 並走する別の車道が無い幅 16 m 以下の道: 中央線 (実線)
  //  - 幅 16 m 超の道、または並走する車道がある道: 車線数 (幅 ÷ 3.25 m) で等分した車線の区切り (破線)
  //  - 路面が重なる並走道路 (中心線の間隔が狭い方の幅の 0.7 倍未満) は、先に出てくる 1 本だけに引く (二重に引かない)
  // 交差点の中は引かない
  const carriage = city.roads.filter((o) => ROAD_STYLE[o.kind] && !ROAD_STYLE[o.kind][3] && !/^(pedestrian|footway|path|cycleway|steps|corridor|track|service)$/.test(o.kind));
  const order = new Map(city.roads.map((o, i) => [o, i]));
  // mode 'near': 隣に平行な車道があるか / 'overlap': 路面が重なる、先の番号の車道があるか
  const parallelNear = (r, a, b, mode = 'near') => {
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    const dx = b[0] - a[0], dz = b[1] - a[1], dl = Math.hypot(dx, dz) || 1;
    for (const o of carriage) {
      if (o === r || (mode === 'overlap' && order.get(o) > order.get(r))) continue;
      for (let j = 0; j < o.pts.length - 1; j++) {
        const [px, pz] = o.pts[j], [qx, qz] = o.pts[j + 1];
        const ex = qx - px, ez = qz - pz, el = Math.hypot(ex, ez) || 1;
        if (Math.abs((dx * ex + dz * ez) / (dl * el)) < 0.8) continue;
        const t = ((mx - px) * ex + (mz - pz) * ez) / (el * el);
        if (t < -0.1 || t > 1.1) continue;
        const cx = px + ex * Math.min(1, Math.max(0, t)), cz = pz + ez * Math.min(1, Math.max(0, t));
        const lim = mode === 'near' ? Math.max(14, (r.w + o.w) / 2 + 2) : Math.min(r.w, o.w) * 0.7;
        if (Math.hypot(mx - cx, mz - cz) < lim) return true;
      }
    }
    return false;
  };
  for (const r of city.roads) {
    const st = ROAD_STYLE[r.kind];
    if (!st || !st[2] || r.ys) continue;
    const e0 = (r.half ? r.half[0] : r.w / 2) - (r.sw || 0.5), e1 = (r.half ? r.half[1] : r.w / 2) - (r.sw || 0.5);
    const W = e0 + e1, n = Math.round(W / 3.25);
    const c0 = r.half ? (r.half[0] - r.half[1]) / 2 : 0; // 車道の中心 (中心線とのずれ)
    const centre = c0 ? offsetLine(r.pts, c0) : r.pts;
    const lanes = []; // 車線の区切りの線 (中心線からの距離ごと)
    for (let k = 1; k < n; k++) lanes.push(offsetLine(r.pts, -e1 + k * W / n));
    for (let i = 0; i < r.pts.length - 1; i++) {
      const near = parallelNear(r, r.pts[i], r.pts[i + 1]);
      const L = Math.hypot(r.pts[i + 1][0] - r.pts[i][0], r.pts[i + 1][1] - r.pts[i][1]);
      if (r.w <= 16 && !near) { // 中央線
        const t0 = trimAt(r.pts[i]) / L, t1 = 1 - trimAt(r.pts[i + 1]) / L;
        if (t1 - t0 < 0.02) continue;
        const a = centre[i], b = centre[i + 1];
        addRibbon(gb, [[a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]], 0.18, 0.115, col(MARK), false);
        continue;
      }
      if (near && parallelNear(r, r.pts[i], r.pts[i + 1], 'overlap')) continue;
      const s0 = trimAt(r.pts[i]) + 1.5, s1 = L - trimAt(r.pts[i + 1]) - 1.5; // 交差点の手前で止める
      for (const line of lanes) {
        const a = line[i], b = line[i + 1];
        for (let s = s0; s + 3 <= s1; s += 8) { // 線 3 m・間 5 m
          const u = s / L, v = (s + 3) / L;
          addRibbon(gb, [[a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], [a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v]], 0.15, 0.115, col(MARK), false);
        }
      }
    }
  }
  addEdgeLines(gb, city, bridges);
  // 線路: バラスト + 2本のレール
  const ballast = col('#7a7068'), rail = col('#b0b5ba');
  for (const r of city.rails) {
    if (r.ys) continue; // 線路の橋は bridges.js で描く
    addRibbon(gb, r.pts, 3.4, 0.13, ballast);
    for (const off of [-0.72, 0.72]) addRibbon(gb, offsetLine(r.pts, off), 0.12, 0.25, rail, false);
  }
  // 車道の橋の部分の道路面は描かない (川底に沈むため。橋げたは bridges.js)
  // 地面・水面・道路面のマテリアルは模様 (map) を使わないので、uv は捨てる (頂点が多く、メモリを使うため)
  const NO_UV = { drop: ['uv'] };
  return { ground: drape(gb.geometry(), 3.5, 0.12, null, NO_UV), water: drape(water.geometry(), 3.5, 0.45, null, NO_UV), roads: drape(roadGB.geometry(), 3.5, 0.12, (x, z) => bridges.onVehicleBridge(x, z), NO_UV) };
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

  const bg = buildBuildings(city.buildings, city.looks || {},
    props && props.rail ? (city.areas || []).filter(a => a.kind === 'platform').map(a => a.outer) : []); // ホームの屋根を props から作るときだけ、元の屋根データを省く
  for (const k of ['office', 'house', 'roof', 'pitched', 'euro']) {
    const mesh = new THREE.Mesh(bg[k], mats[k]);
    mesh.name = 'buildings_' + k;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  const lookMats = [];
  for (const [k, geo] of Object.entries(bg.looks)) {
    const mesh = new THREE.Mesh(geo, wallMat(lookTextures(city.looks[k])));
    mesh.name = 'buildings_look_' + k;
    mesh.castShadow = mesh.receiveShadow = true;
    lookMats.push(mesh.material);
    group.add(mesh);
  }

  const bridges = new Bridges(city);
  const gr = buildGround(city, bridges);
  const ground = new THREE.Mesh(gr.ground, mats.ground); ground.name = 'roads_and_areas';
  const water = new THREE.Mesh(gr.water, mats.water); water.name = 'water';
  ground.receiveShadow = water.receiveShadow = true;
  const roadsM = new THREE.Mesh(gr.roads, mats.ground); roadsM.name = 'road_areas'; roadsM.receiveShadow = true;
  group.add(ground, water, roadsM, bridges.build(), buildStairs(city), buildWalls(city.walls));

  const base = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#a4a296', roughness: 1 }));
  base.name = 'base_ground';
  base.receiveShadow = true;
  if (hasTerrain()) {
    base.position.y = -12; // 地形の外側 (マップ範囲外) 用。地形の下に隠す
    group.add(buildTerrainMesh('#a4a296'));
  }
  group.add(base);

  group.add(...buildTrees(props));

  return { group, windowMats: [mats.office, mats.house, mats.euro, ...lookMats], waterMat: mats.water, mats };
}
