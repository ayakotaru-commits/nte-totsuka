// フェアリー・リールパーク 段階 7: 建物の細部 (窓まわり・出窓・バルコニー・店先・日よけ・突き出し看板・ネオン・屋根の飾り)。
// 何を付けるかは tools/park_areas.py の make_detail が建物ごとに決めた b.det (data/park_areas.json のテーマの "detail")。ここは読んで形にするだけ。
// 窓の位置は壁の模様 (parkareas.js の win の絵: 窓は 1 つの列の 22〜78% 幅・階の 34〜75% 高さ) に合わせる。
// 面ごとの座標 (f): s = 面に沿った位置 (左端 = 0)、o = 面から外へ。fbox() で面の上に箱を置く。
import * as THREE from 'three';
import { canvasTexture } from './util.js';

const WX0 = 0.219, WX1 = 0.78, WY0 = 0.344, WY1 = 0.75;   // 壁の模様の中の窓 (列の幅・階の高さに対する割合)
const C = (s) => new THREE.Color(s);
const UV4 = (p) => [p, p, p, p];

// 店の窓の絵 (1 枚の模様に全部)。0 小物の棚・1 映画のポスター・2 ソーダの瓶・3 カフェ・4 扉のガラス
const CELL_W = 256, CELL_H = 192, CELLS = 5;
function makeShopAtlas() {
  const cols = 4, rows = 2, W = CELL_W * cols, H = CELL_H * rows;
  const tex = canvasTexture(W, H, (g) => {
    let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const pastel = ['#ff9ec8', '#8fd8ff', '#ffe08a', '#b9a4ff', '#9fe8c8', '#ffb98a', '#ffffff'];
    for (let i = 0; i < CELLS; i++) {
      const x = (i % cols) * CELL_W, y = Math.floor(i / cols) * CELL_H, w = CELL_W, h = CELL_H;
      g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.translate(x, y);
      const bg = [['#ffe3ef', '#ff9fc9'], ['#363a86', '#1e2160'], ['#e4f6ff', '#a9dcf5'], ['#ffeccb', '#f4b574'], ['#fff0d2', '#ffc98f']][i];
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, bg[0]); gr.addColorStop(1, bg[1]); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      if (i === 0) {   // 棚と小物
        for (const sy of [70, 132]) {
          g.fillStyle = '#a77fe0'; g.fillRect(0, sy, w, 7);
          for (let k = 0; k < 7; k++) { const bw = 20 + rnd() * 16, bh = 22 + rnd() * 20; g.fillStyle = pastel[Math.floor(rnd() * pastel.length)]; g.fillRect(10 + k * 34, sy - bh, bw, bh); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(12 + k * 34, sy - bh + 3, 4, bh - 6); }
        }
        g.fillStyle = '#7f6ad9'; g.fillRect(0, h - 30, w, 30);
      } else if (i === 1) {   // ポスターと電球の列
        for (let k = 0; k < 4; k++) {
          const px = 18 + k * 58, py = 40;
          g.fillStyle = '#fff6e6'; g.fillRect(px, py, 46, 96);
          const pg = g.createLinearGradient(px, py, px, py + 96); pg.addColorStop(0, pastel[(k * 2) % 6]); pg.addColorStop(1, pastel[(k * 2 + 3) % 6]);
          g.fillStyle = pg; g.fillRect(px + 4, py + 4, 38, 70);
          g.fillStyle = '#fff6e6'; g.beginPath(); g.arc(px + 23, py + 38, 11, 0, 7); g.fill();
          g.fillRect(px + 8, py + 80, 30, 4); g.fillRect(px + 12, py + 88, 22, 3);
        }
        g.fillStyle = '#ffe36b'; for (let k = 0; k < 14; k++) { g.beginPath(); g.arc(10 + k * 18.5, 16, 5.5, 0, 7); g.fill(); }
        g.fillStyle = '#ff4f9a'; g.fillRect(0, h - 22, w, 22);
      } else if (i === 2) {   // ソーダの瓶・カウンター・OPEN
        g.fillStyle = '#ff4f9a'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.fillText('OPEN', w / 2, 40);
        g.strokeStyle = '#ff4f9a'; g.lineWidth = 3; g.strokeRect(w / 2 - 44, 14, 88, 36);
        for (let k = 0; k < 8; k++) {
          const bx = 14 + k * 30, c = pastel[k % 6];
          g.fillStyle = c; g.fillRect(bx, 96, 18, 52); g.fillRect(bx + 5, 76, 8, 22); g.fillStyle = '#ffffff'; g.fillRect(bx + 3, 70, 12, 7);
          g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(bx + 3, 104, 3, 34);
        }
        g.fillStyle = '#b07d4f'; g.fillRect(0, 148, w, 44); g.fillStyle = '#d6a672'; g.fillRect(0, 148, w, 6);
      } else if (i === 3) {   // カフェ: つり下げの灯り・テーブル
        for (const lx of [50, 128, 206]) {
          g.strokeStyle = '#7a5a40'; g.lineWidth = 2; g.beginPath(); g.moveTo(lx, 0); g.lineTo(lx, 36); g.stroke();
          const rg = g.createRadialGradient(lx, 46, 2, lx, 46, 34); rg.addColorStop(0, 'rgba(255,248,200,1)'); rg.addColorStop(1, 'rgba(255,220,150,0)');
          g.fillStyle = rg; g.beginPath(); g.arc(lx, 46, 34, 0, 7); g.fill();
          g.fillStyle = '#fff6c9'; g.beginPath(); g.arc(lx, 44, 10, 0, 7); g.fill();
        }
        for (const tx of [48, 128, 208]) {
          g.fillStyle = '#7a4f33'; g.beginPath(); g.ellipse(tx, 130, 30, 9, 0, 0, 7); g.fill(); g.fillRect(tx - 3, 130, 6, 44);
          g.fillStyle = '#ffffff'; g.fillRect(tx - 12, 118, 8, 10); g.fillStyle = '#ff9ec8'; g.fillRect(tx + 4, 120, 7, 8);
        }
        g.fillStyle = '#5f8f3f'; g.beginPath(); g.ellipse(236, 150, 14, 28, 0, 0, 7); g.fill();
      } else {   // 扉のガラス
        g.fillStyle = 'rgba(255,255,255,0.35)'; for (let k = 0; k < 3; k++) g.fillRect(20 + k * 80, 0, 22, h);
      }
      // ガラスの映り込み (斜めの白い帯)
      g.fillStyle = 'rgba(255,255,255,0.16)'; g.beginPath(); g.moveTo(w * 0.15, h); g.lineTo(w * 0.35, 0); g.lineTo(w * 0.5, 0); g.lineTo(w * 0.3, h); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(w * 0.62, h); g.lineTo(w * 0.76, 0); g.lineTo(w * 0.82, 0); g.lineTo(w * 0.68, h); g.closePath(); g.fill();
      g.restore();
    }
  });
  const cellUv = (i) => {
    const cx = i % cols, cy = Math.floor(i / cols), e = 0.004;
    const u0 = (cx * CELL_W) / W + e, u1 = ((cx + 1) * CELL_W) / W - e, vt = 1 - (cy * CELL_H) / H - e, vb = 1 - ((cy + 1) * CELL_H) / H + e;
    return [[u0, vb], [u1, vb], [u1, vt], [u0, vt]];
  };
  return { tex, cellUv };
}

// 20 面体の小さな球 (壁灯の玉・街灯の玉)
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2, v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(...p); return p.map((q) => q / l); });
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  return { v, f };
})();

export function makeFacadeKit({ glowMat, emissive, signs }) {
  const atlas = makeShopAtlas();
  const shopMat = new THREE.MeshStandardMaterial({ map: atlas.tex, emissiveMap: atlas.tex, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.32, metalness: 0.05 });
  shopMat.userData.glow = 0.6; emissive.push(shopMat);
  const lampMat = glowMat('#fff0c8', 1.5);
  const neonMats = {};
  const neonMat = (color) => {
    if (!neonMats[color]) { const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0, roughness: 0.4, side: THREE.DoubleSide }); m.userData.glow = 1.8; emissive.push(m); neonMats[color] = m; }
    return neonMats[color];
  };
  return { shopMat, lampMat, neonMat, neonMats, cellUv: atlas.cellUv, signs };
}

// 1 棟ぶんの細部。env = { b, Buf, P, nW, W, T, S, SG (店の窓), NE (色 → ネオンの Buf), LP (壁灯の玉), signUv, y0, y1, gy, kit }
export function facadeDetail(env) {
  const { b, Buf, P, nW, W, T, S, SG, NE, LP, signUv, y0, y1, kit, low, onChimney } = env;   // low = スマホ (細かい飾りを省いて三角形を減らす)
  // 細かさ (テーマの detail.lod): full = アベニュー (全部)、mid = 町・港・お菓子の丘 (横の面は枠だけ・線や花の立方体は省く)、lite = 谷・森・夜の館 (前の面の窓のまぐさと窓台・鎧戸・玄関だけ)。スマホは full だけ窓を残し、ほかは窓の飾りを省く
  const lod = low && env.lod !== 'full' ? 'none' : (env.lod || 'full'), rich = lod === 'full', lite = lod === 'lite', none = lod === 'none', lowish = low || !rich;
  const fancyShop = rich || (lod === 'mid' && !low);
  const det = b.det, hx = b.w / 2, hz = b.d / 2, fh = b.fh, bay = b.bay, F = Math.max(1, Math.round(b.h / fh));
  const tc = C(b.trim), wc = C(b.col), rc = C(b.rcol), white = C('#ffffff'), dark = C('#4b4561');
  const awn = (b.awn && b.awn.length ? b.awn : ['#ff7fb5', '#ffffff']).map(C);
  const accent = awn[0], signBg = kit.signs[b.sign] ? kit.signs[b.sign].bg : '#ff4f9a';
  const PLAIN = [0.1, 0.5], GLASS = [0.5, 0.55], U4 = UV4(PLAIN), G4 = UV4(GLASS);
  const faces = [[[-hx, hz], [hx, hz], [0, 1]], [[hx, hz], [hx, -hz], [1, 0]], [[hx, -hz], [-hx, -hz], [0, -1]], [[-hx, -hz], [-hx, hz], [-1, 0]]].map(([a, c, nl]) => { const L = Math.hypot(c[0] - a[0], c[1] - a[1]); return { a, c, nl, L, t: [(c[0] - a[0]) / L, (c[1] - a[1]) / L] }; });
  const pt = (f, s, o) => [f.a[0] + f.t[0] * s + f.nl[0] * o, f.a[1] + f.t[1] * s + f.nl[1] * o];
  const PF = (f, s, o, y) => { const q = pt(f, s, o); return P(q[0], y, q[1]); };
  const front = faces[0];

  // 面の上の箱 (s0〜s1 = 面に沿って、o0〜o1 = 面から外へ、ya〜yb = 高さ)
  const fbox = (f, s0, s1, o0, o1, ya, yb, color, buf = T) => {
    if (s1 <= s0 || o1 <= o0 || yb <= ya) return;
    const cs = [pt(f, s0, o0), pt(f, s1, o0), pt(f, s1, o1), pt(f, s0, o1)], cx = (cs[0][0] + cs[2][0]) / 2, cz = (cs[0][1] + cs[2][1]) / 2;
    for (let i = 0; i < 4; i++) {
      const a = cs[i], c = cs[(i + 1) % 4], ex = c[0] - a[0], ez = c[1] - a[1], l = Math.hypot(ex, ez) || 1;
      let nx = ez / l, nz = -ex / l;
      if (nx * ((a[0] + c[0]) / 2 - cx) + nz * ((a[1] + c[1]) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
      buf.quad(P(a[0], ya, a[1]), P(c[0], ya, c[1]), P(c[0], yb, c[1]), P(a[0], yb, a[1]), nW(nx, nz), U4, color);
    }
    buf.quad(P(cs[0][0], yb, cs[0][1]), P(cs[1][0], yb, cs[1][1]), P(cs[2][0], yb, cs[2][1]), P(cs[3][0], yb, cs[3][1]), [0, 1, 0], U4, color);
  };
  // 建物の軸に合わせた箱 (局所座標 x・z)
  const lbox = (x0, x1, z0, z1, ya, yb, color, buf = T) => {
    const cs = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    for (let i = 0; i < 4; i++) {
      const a = cs[i], c = cs[(i + 1) % 4], ex = c[0] - a[0], ez = c[1] - a[1], l = Math.hypot(ex, ez) || 1;
      let nx = ez / l, nz = -ex / l; if (nx * ((a[0] + c[0]) / 2 - cx) + nz * ((a[1] + c[1]) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
      buf.quad(P(a[0], ya, a[1]), P(c[0], ya, c[1]), P(c[0], yb, c[1]), P(a[0], yb, a[1]), nW(nx, nz), U4, color);
    }
    buf.quad(P(x0, yb, z0), P(x1, yb, z0), P(x1, yb, z1), P(x0, yb, z1), [0, 1, 0], U4, color);
  };
  // 建物の軸に合わせた円柱 (局所座標 x・z。r0 = 下の半径、r1 = 上の半径。8 角形)
  const lcyl = (cx, cz, r0, r1, ya, yb, color, buf = T, n = 8) => {
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
      buf.quad(P(cx + Math.cos(a0) * r0, ya, cz + Math.sin(a0) * r0), P(cx + Math.cos(a1) * r0, ya, cz + Math.sin(a1) * r0), P(cx + Math.cos(a1) * r1, yb, cz + Math.sin(a1) * r1), P(cx + Math.cos(a0) * r1, yb, cz + Math.sin(a0) * r1), nW(Math.cos(am), Math.sin(am)), U4, color);
      buf.tri(P(cx, yb, cz), P(cx + Math.cos(a0) * r1, yb, cz + Math.sin(a0) * r1), P(cx + Math.cos(a1) * r1, yb, cz + Math.sin(a1) * r1), [0, 1, 0], U4.slice(0, 3), color);
    }
  };
  // 面に平行な板 (o の位置、向きは面と同じ外向き)
  const fquad = (buf, f, o, s0, s1, ya, yb, uv, color = white) => buf.quad(PF(f, s0, o, ya), PF(f, s1, o, ya), PF(f, s1, o, yb), PF(f, s0, o, yb), nW(f.nl[0], f.nl[1]), uv, color);
  // 面の上の三角形・多角形 (s, y の点の並び。外向き)
  const ftri = (buf, f, o, p0, p1, p2, color, mat) => buf.tri(PF(f, p0[0], o, p0[1]), PF(f, p1[0], o, p1[1]), PF(f, p2[0], o, p2[1]), nW(f.nl[0], f.nl[1]), U4.slice(0, 3), color, mat);
  // ネオン管 (面に平行な細い帯をつないだ線)
  const neon = (f, pts, o, w, color, closed = false) => {
    const buf = NE(color), n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1, px = -dy / l * w / 2, py = dx / l * w / 2;
      buf.quad(PF(f, p[0] + px, o, p[1] + py), PF(f, q[0] + px, o, q[1] + py), PF(f, q[0] - px, o, q[1] - py), PF(f, p[0] - px, o, p[1] - py), nW(f.nl[0], f.nl[1]), U4, white);
    }
  };
  const blob = (buf, cx, cy, cz, r, color = white) => {   // 20 面体 (光る玉・葉のかたまり)
    const v = ICO.v.map((p) => [cx + p[0] * r, cy + p[1] * r, cz + p[2] * r]);
    for (const [i, j, k] of ICO.f) { const m = [(v[i][0] + v[j][0] + v[k][0]) / 3 - cx, (v[i][1] + v[j][1] + v[k][1]) / 3 - cy, (v[i][2] + v[j][2] + v[k][2]) / 3 - cz]; buf.tri(v[i], v[j], v[k], m, U4.slice(0, 3), color); }
  };
  const hash = (fi, fl, k, salt = 0) => { let t = (Math.floor(b.x * 10) * 73856093 ^ Math.floor(b.z * 10) * 19349663 ^ (fi * 83492791 + fl * 2654435 + k * 40503 + salt * 9973)) | 0; t = Math.imul(t ^ (t >>> 15), 1 | t); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  const flatRoof = b.roof === 'flat', topY = y1 - (flatRoof ? 0.5 : 0.25);
  const shop = !!b.shop, ground = y0 + 0.25;

  // ---------- 柱型 (四隅) と階の境目の帯 ----------
  for (const [cx, cz] of none ? [] : [[hx, hz], [hx, -hz], [-hx, hz], [-hx, -hz]]) {   // スマホは full 以外の柱型を省く
    const sx = Math.sign(cx), sz = Math.sign(cz);
    const x0 = sx > 0 ? hx - 0.42 : -hx - 0.1, x1 = sx > 0 ? hx + 0.1 : -hx + 0.42, z0 = sz > 0 ? hz - 0.42 : -hz - 0.1, z1 = sz > 0 ? hz + 0.1 : -hz + 0.42;
    const cs = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    for (let i = 0; i < 4; i++) {
      const a = cs[i], c = cs[(i + 1) % 4], ex = c[0] - a[0], ez = c[1] - a[1], l = Math.hypot(ex, ez) || 1;
      let nx = ez / l, nz = -ex / l; if (nx * ((a[0] + c[0]) / 2 - (x0 + x1) / 2) + nz * ((a[1] + c[1]) / 2 - (z0 + z1) / 2) < 0) { nx = -nx; nz = -nz; }
      T.quad(P(a[0], y0, a[1]), P(c[0], y0, c[1]), P(c[0], topY, c[1]), P(a[0], topY, a[1]), nW(nx, nz), U4, tc);
    }
    T.quad(P(x0, topY, z0), P(x1, topY, z0), P(x1, topY, z1), P(x0, topY, z1), [0, 1, 0], U4, tc);
  }
  const sideFaces = none ? [] : (low || !rich) ? [0] : [0, 1, 3];   // 横の面の飾りは PC の full だけ
  for (const fi of (rich || lod === 'mid') && !none ? sideFaces : []) {
    const f = faces[fi];
    for (let fl = 1; fl < F; fl++) {
      const yy = y0 + fl * fh + (fl === 1 && shop && fi === 0 ? -0.12 : -0.1);
      fbox(f, 0.4, f.L - 0.4, 0, 0.13, yy, yy + 0.24, tc);
    }
  }

  // ---------- 窓まわり ----------
  const bayCol = det.bay ? det.bay[0] : -1, bayFl = det.bay ? det.bay[1] : 0;
  for (const fi of sideFaces) {
    const f = faces[fi], nu = f.L / bay, kmax = Math.floor(nu - WX1 + 1e-6);
    for (let fl = (fi === 0 && shop ? 1 : 0); fl < F; fl++) for (let kk = 0; kk <= kmax; kk++) {
      const base = y0 + fl * fh, ya = base + WY0 * fh, yb = base + WY1 * fh, s0 = kk * bay + WX0 * bay, s1 = kk * bay + WX1 * bay;
      if (s0 - 0.62 < 0.25 || s1 + 0.62 > f.L - 0.25) continue;   // 角に近すぎる窓は飾らない (柱型・飾りが角からはみ出さない)
      if (fi === 0 && kk === bayCol && fl >= 1 && fl < 1 + bayFl) continue;   // 出窓の後ろ
      if (fi === 0 && fl === 0 && !shop && s1 + 0.6 > f.L / 2 - 1.5 && s0 - 0.6 < f.L / 2 + 1.5) continue;   // 玄関の前
      if (fi === 0 && kk === det.balc && fl === 1) { /* バルコニーの窓: 枠だけ (下で手すり) */ }
      // 枠・まぐさ・窓台
      if (!lite) { fbox(f, s0 - 0.1, s0, 0, 0.07, ya - 0.02, yb + 0.02, tc); fbox(f, s1, s1 + 0.1, 0, 0.07, ya - 0.02, yb + 0.02, tc); }
      fbox(f, s0 - 0.2, s1 + 0.2, 0, 0.16, yb, yb + 0.16, tc);
      fbox(f, s0 - 0.2, s1 + 0.2, 0, 0.22, ya - 0.14, ya, tc);
      let style = hash(fi, fl, kk) < 0.78 ? det.win : 'frame';
      if (lite && style !== 'shutter') style = 'frame';
      if (style === 'shutter') {
        const sc = C(det.shut);
        fbox(f, s0 - 0.58, s0 - 0.12, 0, 0.05, ya - 0.04, yb + 0.1, sc); fbox(f, s1 + 0.12, s1 + 0.58, 0, 0.05, ya - 0.04, yb + 0.1, sc);
        for (let sl = 0; sl < (lowish ? 0 : 3); sl++) { const yy = ya + 0.2 + sl * ((yb - ya) / 3); fbox(f, s0 - 0.54, s0 - 0.16, 0.05, 0.075, yy, yy + 0.04, white); fbox(f, s1 + 0.16, s1 + 0.54, 0.05, 0.075, yy, yy + 0.04, white); }
      } else if (style === 'flower') {
        fbox(f, s0 - 0.05, s1 + 0.05, 0, 0.36, ya - 0.58, ya - 0.2, C('#8a5a3b'));
        fbox(f, s0, s1, 0.03, 0.33, ya - 0.2, ya - 0.08, C('#4f8a3a'));
        const fc = [C(det.flower), white, C('#ffd36b')];
        for (let q = 0; q < (lowish ? 0 : 4); q++) { const sx = s0 + 0.1 + q * ((s1 - s0 - 0.2) / 3), oo = 0.1 + (q % 2) * 0.12; fbox(f, sx, sx + 0.13, oo, oo + 0.13, ya - 0.1, ya + 0.04, fc[q % 3]); }
      } else if (style === 'canopy') {
        const ns = 5, sa = s0 - 0.25, sb = s1 + 0.25, ex = 0.75, ay = yb + 0.42;
        for (let q = 0; q < ns; q++) {
          const xa = sa + (sb - sa) * q / ns, xb = sa + (sb - sa) * (q + 1) / ns, cc = awn[q % 2];
          T.quad(PF(f, xa, 0.03, ay), PF(f, xb, 0.03, ay), PF(f, xb, ex, ay - 0.5), PF(f, xa, ex, ay - 0.5), nW(f.nl[0] * 0.6, f.nl[1] * 0.6), U4, cc);
          T.quad(PF(f, xa, ex, ay - 0.5), PF(f, xb, ex, ay - 0.5), PF(f, xb, ex, ay - 0.68), PF(f, xa, ex, ay - 0.68), nW(f.nl[0], f.nl[1]), U4, cc);
          T.tri(PF(f, xa, ex, ay - 0.68), PF(f, xb, ex, ay - 0.68), PF(f, (xa + xb) / 2, ex, ay - 0.84), nW(f.nl[0], f.nl[1]), U4.slice(0, 3), cc);
        }
        T.tri(PF(f, sa, 0.03, ay), PF(f, sa, ex, ay - 0.5), PF(f, sa, ex, ay - 0.68), nW(-f.t[0], -f.t[1]), U4.slice(0, 3), awn[0]);
        T.tri(PF(f, sb, 0.03, ay), PF(f, sb, ex, ay - 0.5), PF(f, sb, ex, ay - 0.68), nW(f.t[0], f.t[1]), U4.slice(0, 3), awn[0]);
      }
    }
  }

  // ---------- 出窓 (前の面の 2 階から) ----------
  if (det.bay) {
    const f = front, kc = det.bay[0] * bay + 0.5 * bay, nf = det.bay[1], base1 = y0 + fh, ya = base1 + 0.5, yb = y0 + (1 + nf - 1) * fh + fh * WY1 + 0.28, ow = 0.95, hw = 1.1;
    fbox(f, kc - 0.8, kc + 0.8, 0, ow - 0.1, ya - 0.4, ya, tc);   // 持ち送り (下のくさび)
    fbox(f, kc - hw, kc + hw, 0, ow, ya, yb, wc);
    for (let q = 0; q < nf; q++) {
      const wy0 = y0 + (1 + q) * fh + fh * WY0 - 0.04, wy1 = y0 + (1 + q) * fh + fh * WY1 + 0.04;
      fquad(W, f, ow + 0.012, kc - hw + 0.22, kc + hw - 0.22, wy0, wy1, G4);
      fbox(f, kc - hw + 0.1, kc - hw + 0.22, ow, ow + 0.06, wy0 - 0.06, wy1 + 0.06, tc); fbox(f, kc + hw - 0.22, kc + hw - 0.1, ow, ow + 0.06, wy0 - 0.06, wy1 + 0.06, tc);
      fbox(f, kc - hw + 0.1, kc + hw - 0.1, ow, ow + 0.06, wy0 - 0.12, wy0 - 0.04, tc); fbox(f, kc - hw + 0.1, kc + hw - 0.1, ow, ow + 0.06, wy1 + 0.04, wy1 + 0.12, tc);
      if (q > 0) fbox(f, kc - hw, kc + hw, 0, ow + 0.05, y0 + (1 + q) * fh - 0.1, y0 + (1 + q) * fh + 0.1, tc);
    }
    fbox(f, kc - hw - 0.12, kc + hw + 0.12, 0, ow + 0.12, yb, yb + 0.14, tc);
    const ap = [PF(f, kc - hw - 0.1, 0.0, yb + 0.14), PF(f, kc + hw + 0.1, 0.0, yb + 0.14), PF(f, kc + hw + 0.1, ow + 0.1, yb + 0.14), PF(f, kc - hw - 0.1, ow + 0.1, yb + 0.14)];
    const apex = PF(f, kc, ow * 0.5, yb + 0.14 + 0.7);
    for (let i = 0; i < 4; i++) { const a = ap[i], c = ap[(i + 1) % 4], m = [(a[0] + c[0]) / 2 - apex[0], 0.5, (a[2] + c[2]) / 2 - apex[2]]; T.tri(a, c, apex, m, U4.slice(0, 3), rc); }
  }

  // ---------- バルコニー (前の面の 2 階) ----------
  if (det.balc !== undefined && det.balc >= 0) {
    const f = front, kc = det.balc * bay + 0.5 * bay, base = y0 + fh, od = 1.05, hw = 1.2, rail = dark;
    if (kc - hw > 0.3 && kc + hw < f.L - 0.3) {
      fbox(f, kc - hw, kc + hw, 0, od, base - 0.02, base + 0.16, tc);
      const top = base + 0.95;
      fbox(f, kc - hw, kc + hw, od - 0.08, od, top - 0.05, top + 0.03, rail);
      for (const sd of [-1, 1]) fbox(f, kc + sd * hw - (sd > 0 ? 0.08 : 0), kc + sd * hw + (sd > 0 ? 0 : 0.08), 0, od, top - 0.05, top + 0.03, rail);
      const np = lowish ? 5 : 9;
      for (let q = 0; q <= np; q++) { const sx = kc - hw + 0.04 + (2 * hw - 0.12) * q / np; fbox(f, sx, sx + 0.04, od - 0.06, od - 0.02, base + 0.16, top - 0.05, rail); }
      for (let q = 1; q < (lowish ? 1 : 3); q++) for (const sd of [-1, 1]) { const oo = od * q / 3, sx = kc + sd * (hw - 0.06); fbox(f, sx, sx + 0.04, oo, oo + 0.04, base + 0.16, top - 0.05, rail); }
    }
  }

  // ---------- 店先 ----------
  if (shop) {
    const f = front, gl = hx - 0.8, door = C(b.door), sx = (x) => x + hx;
    const gc = det.goods, gu = kit.cellUv(gc % 4), du = kit.cellUv(4);
    // 腰板 (ガラスの下)・窓のガラス・枠・まぐさの帯
    for (const sd of [-1, 1]) {
      const xa = sd < 0 ? -gl : 1.05, xb = sd < 0 ? -1.05 : gl;
      fbox(f, sx(xa), sx(xb), 0, 0.1, ground, ground + 0.62, door);
      fbox(f, sx(xa), sx(xb), 0, 0.12, ground + 0.62, ground + 0.7, tc);
      fquad(SG, f, 0.04, sx(xa), sx(xb), ground + 0.7, ground + 3.3, sd < 0 ? gu : [gu[1], gu[0], gu[3], gu[2]]);
      const wd = xb - xa, ns = Math.max(1, Math.ceil(wd / 1.7));
      if (fancyShop) for (let q = 0; q <= ns; q++) { const xx = xa + wd * q / ns; fbox(f, sx(xx) - (q === 0 ? 0 : 0.045), sx(xx) + (q === ns ? 0.0 : 0.045) + (q === 0 ? 0.09 : 0), 0, 0.1, ground + 0.7, ground + 3.35, tc); }
    }
    fbox(f, sx(-gl), sx(gl), 0, 0.14, ground + 3.3, ground + 3.52, tc);
    // 扉 (両開き。ガラスの小窓・取っ手・枠・段)
    fbox(f, sx(-1.05), sx(-0.9), 0, 0.12, ground, ground + 2.95, tc); fbox(f, sx(0.9), sx(1.05), 0, 0.12, ground, ground + 2.95, tc);
    fbox(f, sx(-1.05), sx(1.05), 0, 0.12, ground + 2.72, ground + 2.95, tc);
    fbox(f, sx(-0.9), sx(-0.02), 0, 0.06, ground, ground + 2.72, door); fbox(f, sx(0.02), sx(0.9), 0, 0.06, ground, ground + 2.72, door);
    if (fancyShop) for (const sd of [-1, 1]) {
      const xa = sd < 0 ? -0.78 : 0.14, xb = sd < 0 ? -0.14 : 0.78;
      fquad(SG, f, 0.075, sx(xa), sx(xb), ground + 0.95, ground + 2.5, du);
      fbox(f, sx(xa) - 0.05, sx(xb) + 0.05, 0.06, 0.1, ground + 0.9, ground + 0.95, tc); fbox(f, sx(xa) - 0.05, sx(xb) + 0.05, 0.06, 0.1, ground + 2.5, ground + 2.55, tc);
      const hxx = sd < 0 ? -0.1 : 0.1; fbox(f, sx(hxx) - 0.025, sx(hxx) + 0.025, 0.08, 0.16, ground + 1.1, ground + 1.55, C('#f0d98a'));
    }
    if (fancyShop) fbox(f, sx(-1.2), sx(1.2), 0, 0.5, ground - 0.02, ground + 0.1, C('#efe6d6'));
    // 壁灯 (扉の両わき)
    if (fancyShop && det.sconce) for (const sd of [-1, 1]) {
      const xx = sd * (hx - 0.61);
      fbox(f, sx(xx) - 0.05, sx(xx) + 0.05, 0, 0.1, ground + 2.3, ground + 2.78, dark);
      const q = pt(f, sx(xx), 0.26), c = P(q[0], ground + 2.55, q[1]); blob(LP, c[0], c[1], c[2], 0.15);
    }
    // 日よけ (しま・縁のひだ・両わき)
    if (b.awn) {
      const aw = hx * 2 - 1.6, n = Math.max(2, Math.round(aw / 0.9)), ex = 1.3, ay = y0 + fh - 0.15;
      for (let q = 0; q < n; q++) {
        const xa = -aw / 2 + aw * q / n, xb = -aw / 2 + aw * (q + 1) / n, cc = awn[q % 2], ye = ay - 0.7;
        T.quad(PF(f, sx(xa), 0.05, ay), PF(f, sx(xb), 0.05, ay), PF(f, sx(xb), ex, ye), PF(f, sx(xa), ex, ye), nW(0, 0.5), U4, cc);
        T.quad(PF(f, sx(xa), ex, ye), PF(f, sx(xb), ex, ye), PF(f, sx(xb), ex, ye - 0.2), PF(f, sx(xa), ex, ye - 0.2), nW(0, 1), U4, cc);
        T.tri(PF(f, sx(xa), ex, ye - 0.2), PF(f, sx(xb), ex, ye - 0.2), PF(f, sx((xa + xb) / 2), ex, ye - 0.34), nW(0, 1), U4.slice(0, 3), cc);
      }
      for (const sd of [-1, 1]) T.tri(PF(f, sx(sd * aw / 2), 0.05, ay), PF(f, sx(sd * aw / 2), ex, ay - 0.7), PF(f, sx(sd * aw / 2), ex, ay - 0.9), nW(sd, 0), U4.slice(0, 3), awn[0]);
    }
    // 突き出し看板 (通りに向かって張り出す。両面)
    if (fancyShop && det.blade) {
      const sd = det.blade, ss = sd > 0 ? f.L - 0.9 : 0.9, ya = ground + 3.9, yb = ya + 0.52, o0 = 0.15, o1 = 1.75, uv = signUv(b.sign);
      fbox(f, ss - 0.03, ss + 0.03, 0.02, o1 + 0.05, ya + 0.56, ya + 0.62, dark);
      S.quad(PF(f, ss - 0.02, o0, ya), PF(f, ss - 0.02, o1, ya), PF(f, ss - 0.02, o1, yb), PF(f, ss - 0.02, o0, yb), nW(-f.t[0], -f.t[1]), [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]], white);
      S.quad(PF(f, ss + 0.02, o1, ya), PF(f, ss + 0.02, o0, ya), PF(f, ss + 0.02, o0, yb), PF(f, ss + 0.02, o1, yb), nW(f.t[0], f.t[1]), [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]], white);
      fbox(f, ss - 0.04, ss - 0.02, o0 - 0.02, o1 + 0.02, yb, yb + 0.04, tc); fbox(f, ss - 0.04, ss - 0.02, o0 - 0.02, o1 + 0.02, ya - 0.04, ya, tc);
    }
    // 鉢植え (店の前の両わき。扉の前はあける)
    if (fancyShop && det.planters) for (const sd of [-1, 1]) {
      const xc = sd * (hx - 1.7), fc = [C(det.flower), white, C('#ffd36b')];
      fbox(f, sx(xc) - 0.7, sx(xc) + 0.7, 0.2, 0.7, ground, ground + 0.5, C('#c46b4a'));
      fbox(f, sx(xc) - 0.74, sx(xc) + 0.74, 0.17, 0.73, ground + 0.5, ground + 0.58, C('#d98562'));
      fbox(f, sx(xc) - 0.62, sx(xc) + 0.62, 0.28, 0.62, ground + 0.58, ground + 0.86, C('#4f8a3a'));
      for (let q = 0; q < (lowish ? 3 : 5); q++) { const s2 = sx(xc) - 0.55 + q * (lowish ? 0.4 : 0.26), o2 = 0.3 + ((q * 5) % 3) * 0.1; fbox(f, s2, s2 + 0.14, o2, o2 + 0.14, ground + 0.8, ground + 1.02 + (q % 2) * 0.1, fc[q % 3]); }
    }
  }

  // ---------- 店先・玄関わきの小物 (樽・木箱・植木鉢。det.deco = [種類, 横, 外へ, 段数]) ----------
  if (det.deco && !none) for (const [kind, dx, dout, n] of det.deco) {
    const cx = dx, cz = hz + dout;
    if (kind === 'barrel') {
      lcyl(cx, cz, 0.32, 0.36, ground, ground + 0.45, C('#8a5a3b')); lcyl(cx, cz, 0.36, 0.3, ground + 0.45, ground + 0.88, C('#8a5a3b'));
      for (const yy of [0.14, 0.7]) lcyl(cx, cz, 0.38, 0.38, ground + yy, ground + yy + 0.06, C('#4b4561'));
    } else if (kind === 'crate') {
      for (let q = 0; q < n; q++) lbox(cx - 0.36 + q * 0.04, cx + 0.36 + q * 0.04, cz - 0.36, cz + 0.36, ground + q * 0.7, ground + (q + 1) * 0.7, q ? C('#b58a55') : C('#c79a63'));
    } else {
      lcyl(cx, cz, 0.2, 0.3, ground, ground + 0.5, C('#c46b4a')); lcyl(cx, cz, 0.32, 0.32, ground + 0.5, ground + 0.58, C('#d98562'));
      const q = P(cx, ground + 0.85, cz); blob(T, q[0], q[1], q[2], 0.32, C('#4f8a3a'));
      const f = P(cx + 0.1, ground + 1.1, cz + 0.05); blob(T, f[0], f[1], f[2], 0.1, C(det.flower));
    }
  }

  // ---------- 屋根の飾り ----------
  let crownH = 0;
  if (flatRoof && det.crown && det.crown !== 'plain') {
    const f = front, L = f.L, cb = y1 + 0.15, mid = L / 2, o0 = -0.12, o1 = 0.3;
    if (det.crown === 'stepped') {
      fbox(f, mid - L * 0.31, mid + L * 0.31, o0, o1, cb, cb + 0.9, tc); fbox(f, mid - L * 0.17, mid + L * 0.17, o0, o1, cb + 0.9, cb + 1.7, tc);
      fbox(f, mid - L * 0.33, mid + L * 0.33, o0 - 0.04, o1 + 0.06, cb + 0.9, cb + 1.0, accent); fbox(f, mid - L * 0.19, mid + L * 0.19, o0 - 0.04, o1 + 0.06, cb + 1.7, cb + 1.8, accent);
      crownH = 1.8;
      if (det.neon === 'roof' || det.neon === 'both') neon(f, [[mid - L * 0.31, cb + 0.5], [mid - L * 0.31, cb + 0.9], [mid - L * 0.17, cb + 0.9], [mid - L * 0.17, cb + 1.7], [mid + L * 0.17, cb + 1.7], [mid + L * 0.17, cb + 0.9], [mid + L * 0.31, cb + 0.9], [mid + L * 0.31, cb + 0.5]], o1 + 0.03, 0.09, signBg);
    } else if (det.crown === 'arch') {
      const r = Math.min(L * 0.31, 2.6), pl = 0.5, N = 16, pts = [];
      fbox(f, mid - r - 0.3, mid + r + 0.3, o0, o1, cb, cb + pl, tc);
      for (let q = 0; q <= N; q++) { const a = Math.PI * q / N; pts.push([mid + Math.cos(a) * r, cb + pl + Math.sin(a) * r]); }
      for (let q = 0; q < N; q++) {
        for (const [oo, cc] of [[o1, tc], [o0, tc]]) ftri(T, f, oo, [mid, cb + pl], pts[q], pts[q + 1], cc);
        const p = pts[q], p2 = pts[q + 1], th = Math.PI * (q + 0.5) / N, cn = nW(f.t[0] * Math.cos(th), f.t[1] * Math.cos(th));
        T.quad(PF(f, p[0], o0, p[1]), PF(f, p2[0], o0, p2[1]), PF(f, p2[0], o1, p2[1]), PF(f, p[0], o1, p[1]), [cn[0], Math.sin(th), cn[2]], U4, tc);
        ftri(T, f, o1 + 0.02, [mid, cb + pl], [mid + (p[0] - mid) * 0.72, cb + pl + (p[1] - cb - pl) * 0.72], [mid + (p2[0] - mid) * 0.72, cb + pl + (p2[1] - cb - pl) * 0.72], accent);
      }
      crownH = pl + r;
      if (det.neon === 'roof' || det.neon === 'both') neon(f, pts.map((p) => [mid + (p[0] - mid) * 0.86, cb + pl + (p[1] - cb - pl) * 0.86]), o1 + 0.05, 0.09, signBg);
    } else if (det.crown === 'pediment') {
      const hw = L * 0.28, pl = 0.4, ph = 1.5;
      fbox(f, mid - hw - 0.2, mid + hw + 0.2, o0, o1, cb, cb + pl, tc);
      for (const oo of [o1, o0]) ftri(T, f, oo, [mid - hw, cb + pl], [mid + hw, cb + pl], [mid, cb + pl + ph], tc);
      for (const sd of [-1, 1]) { const cn = nW(f.t[0] * sd * 0.8, f.t[1] * sd * 0.8); T.quad(PF(f, mid + sd * hw, o0, cb + pl), PF(f, mid, o0, cb + pl + ph), PF(f, mid, o1, cb + pl + ph), PF(f, mid + sd * hw, o1, cb + pl), [cn[0], 0.6, cn[2]], U4, tc); }
      ftri(T, f, o1 + 0.02, [mid - hw * 0.6, cb + pl + 0.12], [mid + hw * 0.6, cb + pl + 0.12], [mid, cb + pl + ph * 0.62], accent);
      crownH = pl + ph;
      if (det.neon === 'roof' || det.neon === 'both') neon(f, [[mid - hw * 0.9, cb + pl + 0.05], [mid + hw * 0.9, cb + pl + 0.05], [mid, cb + pl + ph * 0.92]], o1 + 0.04, 0.09, signBg, true);
    }
  }
  if (flatRoof && (!det.crown || det.crown === 'plain') && (det.neon === 'roof' || det.neon === 'both')) neon(front, [[-0.3, y1 - 0.18], [front.L + 0.3, y1 - 0.18]], 0.33, 0.1, signBg);
  if (!flatRoof && det.chim !== undefined && (b.roof === 'gable' || (b.roof === 'hip' && hx >= hz))) {   // 煙突 (棟が前の面と平行な切妻。うしろの斜面から)
    const lz = -hz * 0.45, ry = y1 + b.rh * (1 - Math.abs(lz) / hz), cx = det.chim, br = C('#b9694f');
    lbox(cx - 0.45, cx + 0.45, lz - 0.45, lz + 0.45, ry - 0.6, y1 + b.rh + 1.2, br);
    lbox(cx - 0.56, cx + 0.56, lz - 0.56, lz + 0.56, y1 + b.rh + 1.2, y1 + b.rh + 1.4, tc);
    if (onChimney && hash(9, 0, 0) < 0.55) { const q = P(cx, y1 + b.rh + 1.4, lz); onChimney(q[0], q[1], q[2]); }   // 煙を出す煙突の位置 (parkareas.js が動かす)
  }

  // ---------- 玄関 (店のない建物の前の面。扉・枠・段・ひさし・壁灯) ----------
  if (!shop && det.door) {
    const f = front, door = C(det.door), sx = (x) => x + hx;
    fbox(f, sx(-1.0), sx(-0.86), 0, 0.14, ground, ground + 2.95, tc); fbox(f, sx(0.86), sx(1.0), 0, 0.14, ground, ground + 2.95, tc);
    fbox(f, sx(-1.1), sx(1.1), 0, 0.18, ground + 2.7, ground + 2.95, tc);
    fbox(f, sx(-0.86), sx(0.86), 0, 0.07, ground, ground + 2.7, door);
    fbox(f, sx(-0.03), sx(0.03), 0.07, 0.09, ground, ground + 2.7, tc);
    if (!none) {
      for (const sd of [-1, 1]) fbox(f, sx(sd < 0 ? -0.7 : 0.1), sx(sd < 0 ? -0.1 : 0.7), 0.07, 0.1, ground + 0.35, ground + 1.15, tc);
      fbox(f, sx(0.18), sx(0.26), 0.09, 0.16, ground + 1.2, ground + 1.45, C('#f0d98a'));
      fbox(f, sx(-1.3), sx(1.3), 0, 0.6, ground - 0.02, ground + 0.12, C('#d9d2c4'));
      if (!lite) fbox(f, sx(-1.3), sx(1.3), 0, 0.9, ground + 3.05, ground + 3.17, rc);
      if (det.sconce) for (const sd of [-1, 1]) {
        const xx = sd * 1.55;
        fbox(f, sx(xx) - 0.05, sx(xx) + 0.05, 0, 0.1, ground + 2.0, ground + 2.4, dark);
        const q = pt(f, sx(xx), 0.26), c = P(q[0], ground + 2.2, q[1]); blob(LP, c[0], c[1], c[2], 0.15);
      }
    }
  }

  // ---------- ドーマー (屋根窓。切妻・寄棟の前の斜面) ----------
  if (!flatRoof && det.dorm !== undefined) {
    const cx = det.dorm, rc2 = hz + 0.45, rhh = b.rh * (1 + 0.45 / hz), w2 = 0.7, hh = 1.35;
    const roofY = (lz) => y1 - 0.1 + (rhh + 0.1) * (1 - Math.abs(lz) / rc2);
    const zf = hz * 0.4, yb0 = roofY(zf) - 0.15, yt = yb0 + hh;
    lbox(cx - w2, cx + w2, zf - 1.6, zf, yb0, yt, wc);
    W.quad(P(cx - 0.45, yb0 + 0.3, zf + 0.012), P(cx + 0.45, yb0 + 0.3, zf + 0.012), P(cx + 0.45, yt - 0.25, zf + 0.012), P(cx - 0.45, yt - 0.25, zf + 0.012), nW(0, 1), G4, white);
    lbox(cx - 0.55, cx - 0.45, zf, zf + 0.06, yb0 + 0.2, yt - 0.15, tc); lbox(cx + 0.45, cx + 0.55, zf, zf + 0.06, yb0 + 0.2, yt - 0.15, tc);
    lbox(cx - 0.6, cx + 0.6, zf, zf + 0.1, yt - 0.25, yt - 0.12, tc); lbox(cx - 0.6, cx + 0.6, zf, zf + 0.14, yb0 + 0.12, yb0 + 0.24, tc);
    const e0 = cx - w2 - 0.15, e1 = cx + w2 + 0.15, zb = zf - 1.6, zr = zf + 0.15, ty = yt + 0.62;
    T.quad(P(e0, yt, zr), P(e0, yt, zb), P(cx, ty, zb), P(cx, ty, zr), null, U4, rc);
    T.quad(P(e1, yt, zb), P(e1, yt, zr), P(cx, ty, zr), P(cx, ty, zb), null, U4, rc);
    T.tri(P(e0 + 0.05, yt, zf + 0.01), P(e1 - 0.05, yt, zf + 0.01), P(cx, ty - 0.05, zf + 0.01), nW(0, 1), U4.slice(0, 3), wc);
  }

  // ---------- 前向き切妻の飾り (妻の屋根裏窓・破風板) ----------
  if (b.roof === 'gablefront' && b.rh >= 2.5 && hx >= 3) {
    const f = front, rh = b.rh, mid = f.L / 2, ya = y1 + rh * 0.18, yb = ya + Math.min(1.5, rh * 0.42);
    if (!none) {
      fquad(W, f, 0.02, mid - 0.5, mid + 0.5, ya, yb, G4);
      fbox(f, mid - 0.6, mid - 0.5, 0, 0.07, ya - 0.02, yb + 0.02, tc); fbox(f, mid + 0.5, mid + 0.6, 0, 0.07, ya - 0.02, yb + 0.02, tc);
      fbox(f, mid - 0.68, mid + 0.68, 0, 0.14, yb, yb + 0.14, tc); fbox(f, mid - 0.68, mid + 0.68, 0, 0.2, ya - 0.14, ya, tc);
    }
    for (const sd of [-1, 1]) {   // 破風板 (妻の斜めの縁の帯)
      const sa = mid + sd * (hx + 0.1), ya1 = y1 - 0.15, sb = mid, yb1 = y1 + rh + 0.05;
      T.quad(PF(f, sa, 0.12, ya1), PF(f, sb, 0.12, yb1), PF(f, sb, 0.12, yb1 - 0.34), PF(f, sa, 0.12, ya1 - 0.34), nW(f.nl[0], f.nl[1]), U4, tc);
    }
  }

  // ---------- 看板まわりのネオン ----------
  if (det.neon === 'sign' || det.neon === 'both') {
    const fw = Math.min(hx * 1.7, 5.0), fhh = fw / 4, ya = y0 + fh + 0.1, f = front, cx = f.L / 2, m = 0.2;
    neon(f, [[cx - fw / 2 - m, ya - m], [cx + fw / 2 + m, ya - m], [cx + fw / 2 + m, ya + fhh + m], [cx - fw / 2 - m, ya + fhh + m]], 0.14, 0.07, signBg, true);
  }
  return { crownH };
}
