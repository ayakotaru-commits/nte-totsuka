// 千葉ドリームランド 段階 9: 象徴の城「リール・キャッスル」。ムーンレイクの中の島に建つ。
// 設定は data/park.json の castle (tools/park.py が検証して public/data/park.json に写す)。ここは読んで作るだけ。
// 実在の城の形・色・配置は写さない。パーク名の「リール」(映写機のフィルム) を主題にした、オリジナルの意匠:
//   主塔の頂に、3 枚の「リールの輪」(穴が 6 つ開いた金色の輪) が回る冠。塔の屋根の色は、青緑 → 菫 → 薔薇 → 珊瑚 → 金と、段々に変わる。
// 描画の数を抑える: 壁 (模様の絵 1 枚)・屋根 (うろこの模様)・飾り (頂点色) をそれぞれ 1 つの形にまとめる。動くもの = 冠・旗・夜の光だけ。
// 当たり判定は col (park.js が world.addColliders)。門塔のトンネルは通り抜けられる。堤道 (島と岸の間の石の道) は地形を持ち上げて作る (castleLakeMask)。
import * as THREE from 'three';
import { canvasTexture } from './util.js';
import { buildKeepInterior, KEEP } from './parkkeep.js';
import { FountainFx } from './fountainfx.js';

const TAU = Math.PI * 2;
const C = (s) => new THREE.Color(s);
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---------- 座標 (城の局所 lx 右・lz 前 ⇔ ワールド) ----------
export function castleFrame(Cf) {
  const [cx, cz] = Cf.center, s = Math.sin(Cf.yaw), c = Math.cos(Cf.yaw);
  return {
    cx, cz, yaw: Cf.yaw,
    toWorld: (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c],
    toLocal: (x, z) => { const dx = x - cx, dz = z - cz; return [dx * c - dz * s, dx * s + dz * c]; },
  };
}

// 湖の深さに掛ける割合 (島の上・堤道の上 = 0、島の岸と堤道の脇はなだらかに 1 へ)。park.js の parkGround が使う
export function castleLakeMask(Cf) {
  const f = castleFrame(Cf), I = Cf.island;
  return (x, z) => {
    const [lx, lz] = f.toLocal(x, z);
    let m = 1;
    const rho = Math.hypot(lx / I.rx, lz / I.rz);
    if (rho < 2.2) {
      const rr = Math.hypot(lx, lz), edge = rho <= 1 ? 0 : (rho - 1) * rr / rho;
      m = rho <= 1 ? 0 : smooth(edge / I.shore);
    }
    for (const cw of Cf.causeways) {
      const a = Math.min(cw.from, cw.to) - 4, b = Math.max(cw.from, cw.to);
      if (lz >= a && lz <= b) m = Math.min(m, smooth((Math.abs(lx) - cw.width / 2 - 1.2) / 6));
    }
    return m;
  };
}

// ---------- 頂点をためる ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

class Buf {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; }
  get tris() { return this.p.length / 9; }
  vert(p, n, uv, c) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]); this.c.push(c.r, c.g, c.b); }
  // 三角形。ns = 外向きの法線 (1 つ、または頂点ごと 3 つ)。外向きに巻き方をそろえる。uvs = [[u,v] x3]、cols = 頂点ごとの色 (無ければ col)
  tri(a, b, c, ns, uvs, col, cols) {
    const nn = Array.isArray(ns[0]) ? ns : [ns, ns, ns], cc = cols || [col, col, col];
    const g = cross(sub(b, a), sub(c, a)), ref = [nn[0][0] + nn[1][0] + nn[2][0], nn[0][1] + nn[1][1] + nn[2][1], nn[0][2] + nn[1][2] + nn[2][2]];
    if (dot(g, ref) < 0) { this.vert(a, nn[0], uvs[0], cc[0]); this.vert(c, nn[2], uvs[2], cc[2]); this.vert(b, nn[1], uvs[1], cc[1]); return; }
    this.vert(a, nn[0], uvs[0], cc[0]); this.vert(b, nn[1], uvs[1], cc[1]); this.vert(c, nn[2], uvs[2], cc[2]);
  }
  // 四角 (a 左下・b 右下・c 右上・d 左上。外から見て)。rect = [u0, v0, u1, v1]、ns = 法線 (1 つ、または 4 つ)、cols = 頂点ごとの色 4 つ
  quad(a, b, c, d, ns, rect, col, cols) {
    const [u0, v0, u1, v1] = rect, n4 = Array.isArray(ns[0]) ? ns : [ns, ns, ns, ns], c4 = cols || [col, col, col, col];
    this.tri(a, b, c, [n4[0], n4[1], n4[2]], [[u0, v0], [u1, v0], [u1, v1]], col, [c4[0], c4[1], c4[2]]);
    this.tri(a, c, d, [n4[0], n4[2], n4[3]], [[u0, v0], [u1, v1], [u0, v1]], col, [c4[0], c4[2], c4[3]]);
  }
  // 向きのある箱 (中心 x, y, z、大きさ sx, sy, sz、向き yaw)。底は省く
  box(x, y, z, sx, sy, sz, yaw, col, rect = NOUV, top = true) {
    const s = Math.sin(yaw), c = Math.cos(yaw), P = (u, v, w) => [x + u * c + w * s, y + v, z - u * s + w * c], hx = sx / 2, hz = sz / 2, y0 = -sy / 2, y1 = sy / 2;
    const f = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]].map(([a, , b]) => [a * c + b * s, 0, -a * s + b * c]);
    this.quad(P(-hx, y0, hz), P(hx, y0, hz), P(hx, y1, hz), P(-hx, y1, hz), f[0], rect, col);
    this.quad(P(hx, y0, -hz), P(-hx, y0, -hz), P(-hx, y1, -hz), P(hx, y1, -hz), f[1], rect, col);
    this.quad(P(hx, y0, hz), P(hx, y0, -hz), P(hx, y1, -hz), P(hx, y1, hz), f[2], rect, col);
    this.quad(P(-hx, y0, -hz), P(-hx, y0, hz), P(-hx, y1, hz), P(-hx, y1, -hz), f[3], rect, col);
    if (top) this.quad(P(-hx, y1, hz), P(hx, y1, hz), P(hx, y1, -hz), P(-hx, y1, -hz), [0, 1, 0], rect, col);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}
const NOUV = [0.5, 0.5, 0.5, 0.5];

// ---------- 壁の模様の絵 (1 枚に 7 つの区画。1 区画 = 512 px。メートルで描く) ----------
const CELL = { WIN: 0, PLAIN: 1, SLIT: 2, DORMER: 3, ROSE: 4, DOOR: 5, VAULT: 6 };
const BAY = { w: 4.5, h: 5.2 };   // 窓の 1 区画 = 幅 4.5 m・高さ 5.2 m (縦横の比が絵と同じ)
const cellRect = (i) => { const cx = i % 4, cy = Math.floor(i / 4), e = 0.0022; return [cx / 4 + e, 1 - (cy + 1) / 2 + e, (cx + 1) / 4 - e, 1 - cy / 2 - e]; };

// 切り石の積み (幅 W m・高さ H m)。base = 石の色、course = 1 段の高さ
function ashlar(g, W, H, rnd, base, { course = 0.52, tone = 0.05, moss = 0, dark = 'rgba(70,55,100,0.30)' } = {}) {
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  const rows = Math.ceil(H / course);
  for (let r = 0; r < rows; r++) {
    const y1 = H - r * course, y0 = Math.max(0, y1 - course);
    let x = -rnd() * 0.8;
    while (x < W) {
      const bw = 0.7 + rnd() * 0.7, k = rnd();
      g.fillStyle = k < 0.5 ? `rgba(255,255,255,${tone * k * 2})` : `rgba(70,50,110,${tone * (k - 0.5) * 2})`;
      g.fillRect(x, y0, bw, y1 - y0);
      g.fillStyle = dark; g.fillRect(x, y0, 0.022, y1 - y0);   // 縦の目地
      x += bw;
    }
    g.fillStyle = dark; g.fillRect(0, y0, W, 0.03);             // 横の目地
    g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(0, y0 + 0.03, W, 0.018);   // 目地の上の明るい縁
  }
  for (let k = 0; k < 220; k++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '60,40,90'},${0.05 + rnd() * 0.07})`; g.fillRect(rnd() * W, rnd() * H, 0.03 + rnd() * 0.05, 0.03 + rnd() * 0.05); }
  if (moss) { const gr = g.createLinearGradient(0, H, 0, H - 1.4); gr.addColorStop(0, `rgba(86,128,84,${moss})`); gr.addColorStop(1, 'rgba(86,128,84,0)'); g.fillStyle = gr; g.fillRect(0, H - 1.4, W, 1.4); }
}
// 角の隅石 (左右の端に長短の石を交互に)
function quoins(g, W, H, base = '#f7f2fb') {
  for (let y = 0; y < H; y += 0.5) {
    const w = (Math.round(y / 0.5) % 2) ? 0.42 : 0.26;
    g.fillStyle = base; g.fillRect(0, y, w, 0.46); g.fillRect(W - w, y, w, 0.46);
    g.fillStyle = 'rgba(70,50,110,0.28)'; g.fillRect(0, y + 0.46, w, 0.03); g.fillRect(W - w, y + 0.46, w, 0.03); g.fillRect(w - 0.02, y, 0.02, 0.46); g.fillRect(W - w, y, 0.02, 0.46);
  }
}
// とがりアーチ (正三角形のアーチ) の輪郭。cx = 中心、spring = アーチの起点の y、hw = 半幅、bottom = 下端の y
function lancet(g, cx, spring, hw, bottom) {
  g.beginPath(); g.moveTo(cx - hw, bottom); g.lineTo(cx - hw, spring);
  g.arc(cx + hw, spring, 2 * hw, Math.PI, Math.PI * 4 / 3, false);    // 左の円弧 (起点 → 頂点)
  g.arc(cx - hw, spring, 2 * hw, Math.PI * 5 / 3, TAU, false);        // 右の円弧 (頂点 → 起点)
  g.lineTo(cx + hw, bottom); g.closePath();
}
function paintCells(draw, emitBg) {
  return canvasTexture(2048, 1024, (g) => {
    if (emitBg) { g.fillStyle = emitBg; g.fillRect(0, 0, 2048, 1024); }
    for (let i = 0; i < 7; i++) {
      const cx = i % 4, cy = Math.floor(i / 4);
      g.save(); g.translate(cx * 512, cy * 512); g.beginPath(); g.rect(0, 0, 512, 512); g.clip();
      draw(i, g, mulberry(1000 + i * 77));
      g.restore();
    }
  });
}
function makeAtlas(Cs) {
  const stone = Cs.stone, W = BAY.w, H = BAY.h;
  const sc = (g, w, h) => g.scale(512 / w, 512 / h);
  const color = paintCells((i, g, rnd) => {
    if (i === CELL.ROSE) {   // バラ窓 (リールの輪 = 6 つの穴をステンドグラスに)
      g.scale(512, 512); const R = [rose]; R[0](g, false); return;
    }
    if (i === CELL.DORMER) { sc(g, 1.9, 2.4); ashlar(g, 1.9, 2.4, rnd, stone, { course: 0.4 }); g.fillStyle = '#f7f2fb'; lancet(g, 0.95, 0.95, 0.62, 2.1); g.fill(); g.fillStyle = '#34406a'; lancet(g, 0.95, 0.97, 0.46, 2.0); g.fill(); g.fillStyle = '#f0eaf5'; g.fillRect(0.93, 0.4, 0.04, 1.6); g.fillRect(0.5, 1.1, 0.9, 0.04); g.fillStyle = '#e4dcef'; g.fillRect(0.2, 2.1, 1.5, 0.12); return; }
    if (i === CELL.DOOR) { sc(g, 4.4, 7.4); door(g, rnd, stone, false); return; }
    sc(g, W, H);
    if (i === CELL.PLAIN) { ashlar(g, W, H, rnd, stone, { moss: 0.12 }); quoins(g, W, H); g.fillStyle = '#f4eef8'; g.fillRect(0, H - 0.26, W, 0.26); g.fillStyle = 'rgba(70,50,110,0.3)'; g.fillRect(0, H - 0.3, W, 0.04); return; }
    if (i === CELL.VAULT) { ashlar(g, W, H, rnd, '#bcb2cc', { dark: 'rgba(40,30,70,0.4)' }); return; }
    ashlar(g, W, H, rnd, stone, {}); quoins(g, W, H);
    if (i === CELL.SLIT) {   // 矢狭間 (細長い窓と十字の小窓)
      for (const [x, y, w, h] of [[W / 2 - 0.13, 1.3, 0.26, 2.3]]) { g.fillStyle = '#f5f0fa'; g.fillRect(x - 0.08, y - 0.08, w + 0.16, h + 0.16); g.fillStyle = '#26304f'; g.fillRect(x, y, w, h); }
    } else {                 // 窓の区画
      g.fillStyle = 'rgba(70,50,110,0.16)'; lancet(g, W / 2 + 0.07, 2.12, 0.98, 4.38); g.fill();   // 影
      g.fillStyle = '#f8f4fc'; lancet(g, W / 2, 2.05, 0.92, 4.3); g.fill();                          // 窓枠の石
      g.fillStyle = 'rgba(70,50,110,0.28)'; lancet(g, W / 2, 2.05, 0.92, 4.3); g.lineWidth = 0.03; g.strokeStyle = 'rgba(70,50,110,0.35)'; g.stroke();
      const gl = g.createLinearGradient(0, 0.7, 0, 4.2); gl.addColorStop(0, '#46568c'); gl.addColorStop(0.55, '#7388bf'); gl.addColorStop(1, '#a9b8dc');
      g.fillStyle = gl; lancet(g, W / 2, 2.1, 0.74, 4.2); g.fill();
      g.fillStyle = 'rgba(255,230,190,0.16)'; g.fillRect(W / 2 - 0.74, 3.2, 1.48, 1.0);                // 中の明るさ
      g.fillStyle = '#f2ecf8'; g.fillRect(W / 2 - 0.025, 0.8, 0.05, 3.4); g.fillRect(W / 2 - 0.74, 2.95, 1.48, 0.05);   // 桟
      g.strokeStyle = '#f2ecf8'; g.lineWidth = 0.05; for (const dx of [-0.37, 0.37]) { g.beginPath(); g.arc(W / 2 + dx, 1.6, 0.17, 0, TAU); g.stroke(); }   // 三つ葉の飾り
      g.fillStyle = '#efe7f7'; g.fillRect(W / 2 - 1.1, 4.3, 2.2, 0.14); g.fillStyle = 'rgba(70,50,110,0.3)'; g.fillRect(W / 2 - 1.1, 4.44, 2.2, 0.05);   // 窓台
      g.fillStyle = '#f4eef8'; g.fillRect(0, H - 0.26, W, 0.26); g.fillStyle = 'rgba(70,50,110,0.3)'; g.fillRect(0, H - 0.3, W, 0.04);                     // 階の境の帯
    }
  });
  const emit = paintCells((i, g, rnd) => {
    if (i === CELL.ROSE) { g.scale(512, 512); rose(g, true); return; }
    if (i === CELL.DORMER) { sc(g, 1.9, 2.4); g.fillStyle = '#ffd48f'; lancet(g, 0.95, 0.97, 0.46, 2.0); g.fill(); g.fillStyle = '#1a1230'; g.fillRect(0.93, 0.4, 0.04, 1.6); g.fillRect(0.5, 1.1, 0.9, 0.04); return; }
    if (i === CELL.DOOR) { sc(g, 4.4, 7.4); door(g, rnd, stone, true); return; }
    sc(g, W, H);
    if (i === CELL.SLIT) { g.fillStyle = '#e8b06a'; g.fillRect(W / 2 - 0.13, 1.3, 0.26, 2.3); return; }
    if (i === CELL.WIN) {
      const gl = g.createLinearGradient(0, 0.7, 0, 4.2); gl.addColorStop(0, '#ffcf86'); gl.addColorStop(1, '#ffe7b8');
      g.fillStyle = gl; lancet(g, W / 2, 2.1, 0.74, 4.2); g.fill();
      g.fillStyle = '#1a1230'; g.fillRect(W / 2 - 0.025, 0.8, 0.05, 3.4); g.fillRect(W / 2 - 0.74, 2.95, 1.48, 0.05);
    }
  }, '#34294f');
  return { color, emit };
}
// バラ窓: リールの輪 (中心の軸 + 6 つの穴)。lit = 光らせる側の絵
function rose(g, lit) {
  const cx = 0.5, cy = 0.5;
  if (!lit) { g.fillStyle = '#ece5f2'; g.fillRect(0, 0, 1, 1); }
  g.beginPath(); g.arc(cx, cy, 0.47, 0, TAU); g.fillStyle = lit ? '#1b1432' : '#f7f2fb'; g.fill();
  const pal = ['#ff86b8', '#59c8e6', '#ffd36b', '#9a7ae6', '#7fe0b0', '#ff9b6b'];
  g.beginPath(); g.arc(cx, cy, 0.40, 0, TAU); g.fillStyle = lit ? '#322448' : '#2a3358'; g.fill();
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * TAU - Math.PI / 2, x = cx + Math.cos(a) * 0.235, y = cy + Math.sin(a) * 0.235;
    g.beginPath(); g.arc(x, y, 0.118, 0, TAU); g.fillStyle = lit ? pal[k] : pal[k]; g.fill();
    g.lineWidth = 0.012; g.strokeStyle = lit ? '#fff3c8' : '#f7f2fb'; g.stroke();
    g.beginPath(); g.arc(x, y, 0.05, 0, TAU); g.fillStyle = lit ? '#fff8dc' : '#fffaf0'; g.fill();
  }
  g.beginPath(); g.arc(cx, cy, 0.075, 0, TAU); g.fillStyle = lit ? '#ffd36b' : '#e6bf5a'; g.fill();
  g.lineWidth = 0.022; g.strokeStyle = lit ? '#ffe9a8' : '#e6bf5a'; g.beginPath(); g.arc(cx, cy, 0.40, 0, TAU); g.stroke();
}
// 扉 (幅 4.4 m・高さ 7.4 m。両開き・とがりアーチ)
function door(g, rnd, stone, lit) {
  if (!lit) { g.fillStyle = stone; g.fillRect(0, 0, 4.4, 7.4); }
  else { g.fillStyle = '#1b1432'; g.fillRect(0, 0, 4.4, 7.4); }
  const hw = 1.9;
  if (!lit) {
    g.fillStyle = '#4e3329'; lancet(g, 2.2, 3.0, hw, 7.4); g.fill();
    for (let x = 0.4; x < 4.0; x += 0.27) { g.fillStyle = `rgba(0,0,0,${0.12 + rnd() * 0.12})`; g.fillRect(x, 3.4, 0.03, 4.0); }
    g.fillStyle = '#e6bf5a';   // 鉄の帯と丁番
    for (const y of [4.6, 5.9, 7.0]) g.fillRect(0.4, y, 3.6, 0.1);
    g.fillRect(2.17, 3.2, 0.06, 4.2);
    g.fillStyle = '#e6bf5a'; for (const x of [1.5, 2.9]) { g.beginPath(); g.arc(x, 5.2, 0.12, 0, TAU); g.fill(); }
    g.fillStyle = '#2c3a66'; lancet(g, 2.2, 1.6, 1.3, 3.15); g.fill();   // 上の明かり取り (扇窓)
    g.strokeStyle = '#f2ecf8'; g.lineWidth = 0.05; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(0.9 + k * 0.65, 1.0); g.lineTo(0.9 + k * 0.65, 3.1); g.stroke(); }
  } else {
    g.fillStyle = '#ffcf86'; lancet(g, 2.2, 1.6, 1.3, 3.15); g.fill();
    g.fillStyle = '#1a1230'; for (let k = 1; k < 4; k++) g.fillRect(0.9 + k * 0.65 - 0.025, 1.0, 0.05, 2.1);
  }
}

// うろこ (屋根のスレート) の模様。白黒の濃淡 (屋根の色は頂点色で掛ける)
function makeShingle() {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#c9c9c9'; g.fillRect(0, 0, 256, 256);
    const rnd = mulberry(7), R = 32;
    for (let row = 0; row < 8; row++) for (let k = -1; k < 5; k++) {
      const x = k * 64 + (row % 2 ? 32 : 0) + 32, y = row * 32 + 16, t = 0.86 + rnd() * 0.12;
      g.beginPath(); g.arc(x, y, R, 0, Math.PI); g.lineTo(x - R, y - 28); g.lineTo(x + R, y - 28); g.closePath();
      const gr = g.createLinearGradient(0, y - 28, 0, y + R); const v = Math.round(255 * t);
      gr.addColorStop(0, `rgb(${v},${v},${v})`); gr.addColorStop(0.7, `rgb(${Math.round(v * 0.93)},${Math.round(v * 0.93)},${Math.round(v * 0.93)})`); gr.addColorStop(1, `rgb(${Math.round(v * 0.62)},${Math.round(v * 0.62)},${Math.round(v * 0.62)})`);
      g.fillStyle = gr; g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.6; g.beginPath(); g.arc(x, y, R - 0.8, 0.05, Math.PI - 0.05); g.stroke();
    }
  });
}
// 旗・のぼりの絵 (リールの紋: 輪に 6 つの穴 + 星)
function makeBanner() {
  return canvasTexture(256, 512, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#3a8fa0'); gr.addColorStop(0.55, '#6a55b8'); gr.addColorStop(1, '#c4568c');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 512);
    g.strokeStyle = '#e6bf5a'; g.lineWidth = 8; g.strokeRect(12, 12, 232, 488);
    g.strokeStyle = 'rgba(255,240,200,0.6)'; g.lineWidth = 2; g.strokeRect(24, 24, 208, 464);
    g.fillStyle = '#e6bf5a'; g.beginPath(); g.arc(128, 190, 78, 0, TAU); g.fill();
    g.fillStyle = '#6a55b8'; g.beginPath(); g.arc(128, 190, 66, 0, TAU); g.fill();
    g.fillStyle = '#e6bf5a'; g.beginPath(); g.arc(128, 190, 66, 0, TAU); g.arc(128, 190, 58, 0, TAU, true); g.fill();
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU - Math.PI / 2; g.fillStyle = '#fff3c8'; g.beginPath(); g.arc(128 + Math.cos(a) * 36, 190 + Math.sin(a) * 36, 17, 0, TAU); g.fill(); }
    g.fillStyle = '#e6bf5a'; g.beginPath(); g.arc(128, 190, 12, 0, TAU); g.fill();
    for (const [x, y, r] of [[60, 340, 14], [196, 340, 14], [128, 392, 18], [80, 440, 10], [176, 440, 10]]) { g.fillStyle = '#ffe9a8'; g.beginPath(); for (let k = 0; k < 10; k++) { const a = k / 10 * TAU - Math.PI / 2, rr = k % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill(); }
  });
}

// ====================================================================================================================
export function buildCastle(ctx) {
  const { cfg, ground, glowMat, group, col, emissive, low } = ctx;
  const Cf = cfg.castle, Cs = Cf.colors, F = castleFrame(Cf);
  const api = { group: new THREE.Group(), stats: {}, update() {} };
  api.group.name = 'park_castle';
  const y0 = ground(F.cx, F.cz);
  api.group.position.set(F.cx, y0, F.cz); api.group.rotation.y = Cf.yaw;
  group.add(api.group);
  const wy = cfg.ground.level + cfg.ellipses['ムーンレイク'].lake.water - y0;   // 水面の高さ (局所)
  const W = (lx, lz) => F.toWorld(lx, lz);
  col.poly = col.poly || [];
  const gy = (lx, lz) => { const [x, z] = W(lx, lz); return ground(x, z) - y0; };

  // ---------- 材質 ----------
  const atlas = makeAtlas(Cs);
  const wallMat = new THREE.MeshStandardMaterial({ map: atlas.color, vertexColors: true, roughness: 0.86, emissiveMap: atlas.emit, emissive: '#ffffff', emissiveIntensity: 0 });
  wallMat.userData.glow = 0.62; emissive.push(wallMat);
  const shingle = makeShingle(); shingle.wrapS = shingle.wrapT = THREE.RepeatWrapping;
  const roofMat = new THREE.MeshStandardMaterial({ map: shingle, vertexColors: true, roughness: 0.55, metalness: 0.12, side: THREE.DoubleSide, emissive: '#ffffff', emissiveIntensity: 0 });
  roofMat.emissive.set('#ffffff'); roofMat.userData.glow = 0.34; emissive.push(roofMat);
  roofMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= diffuseColor.rgb;'); };
  const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide });
  const goldMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.3, side: THREE.DoubleSide, emissive: '#9a6e1c', emissiveIntensity: 0 });
  goldMat.userData.glow = 0.4; emissive.push(goldMat);
  const lampWarm = glowMat('#ffe2a0', 1.5), lampPink = glowMat('#ff9ccf', 1.3), lampCyan = glowMat('#8fe8ff', 1.3);
  lampWarm.color.set('#eadcb8'); lampPink.color.set('#ecc0d6'); lampCyan.color.set('#bfe0ea');   // 昼は色つきのガラスに見える (夜は emissive で光る)

  const wall = new Buf(), roof = new Buf(), trim = new Buf(), gold = new Buf(), hall = new Buf();   // hall = 主塔の大広間の床・天井・階段 (昼も中が暗くならないよう、色の分だけ自分で光る材質)
  const stone = C(Cs.stone), cream = C(Cs.cream), goldC = C(Cs.gold), shade = C(Cs.stoneShade);
  const flags = [];       // 旗 { x, y, z, len, h, color, ph }
  const lamps = [];       // 灯 [x, y, z, 種類]
  const spires = [];      // 光線を出す塔の先 [x, y, z]
  const tint = (c, k) => new THREE.Color(c.r * k, c.g * k, c.b * k);
  const rngC = mulberry(20261126);

  // ---------- 円筒の壁 (窓の区画の四角を、階 × 区画で並べる) ----------
  // y 0 〜 fl * fh、半径 r0 → r1。cell = 模様の区画。bayW = 区画の幅。skip(a) が true の区画は作らない
  function cylWall(cx, cz, yb, r0, r1, fl, fh, cell, bayW, base, phase = 0, rowCells = null, skip = null) {
    const Hh = fl * fh, nb = Math.max(4, Math.round(TAU * (r0 + r1) / 2 / bayW)), sub2 = (low && !skip) ? 1 : 2, rect = cellRect(cell), tl = Math.atan2(r0 - r1, Hh);
    const rAt = (y) => r0 + (r1 - r0) * (y / Hh);
    for (let f = 0; f < fl; f++) {
      const ya = f * fh, yb2 = (f + 1) * fh, rc = rowCells ? cellRect(rowCells(f)) : rect, kA = 0.9 + 0.1 * (f / Math.max(1, fl - 1)), kB = kA + 0.04;
      for (let b = 0; b < nb; b++) {
        const jit = 0.96 + rngC() * 0.07;
        for (let s = 0; s < sub2; s++) {
          const a0 = phase + (b + s / sub2) / nb * TAU, a1 = phase + (b + (s + 1) / sub2) / nb * TAU;
          if (skip && skip(f, a0, a1)) continue;
          const u0 = rc[0] + (rc[2] - rc[0]) * s / sub2, u1 = rc[0] + (rc[2] - rc[0]) * (s + 1) / sub2;
          const P = (a, y) => [cx + Math.sin(a) * rAt(y), yb + y, cz + Math.cos(a) * rAt(y)];
          const Nn = (a) => [Math.sin(a) * Math.cos(tl), Math.sin(tl), Math.cos(a) * Math.cos(tl)];
          wall.quad(P(a0, ya), P(a1, ya), P(a1, yb2), P(a0, yb2), [Nn(a0), Nn(a1), Nn(a1), Nn(a0)], [u0, rc[1], u1, rc[3]], base, [tint(base, kA * jit), tint(base, kA * jit), tint(base, kB * jit), tint(base, kB * jit)]);
        }
      }
    }
  }
  // 円の帯 (縦の壁・上向きの輪)
  function cylBand(buf, cx, cz, r, ya, yb2, N, color, inward = false) {
    for (let k = 0; k < N; k++) {
      const a0 = k / N * TAU, a1 = (k + 1) / N * TAU, n0 = [Math.sin(a0) * (inward ? -1 : 1), 0, Math.cos(a0) * (inward ? -1 : 1)], n1 = [Math.sin(a1) * (inward ? -1 : 1), 0, Math.cos(a1) * (inward ? -1 : 1)];
      buf.quad([cx + Math.sin(a0) * r, ya, cz + Math.cos(a0) * r], [cx + Math.sin(a1) * r, ya, cz + Math.cos(a1) * r], [cx + Math.sin(a1) * r, yb2, cz + Math.cos(a1) * r], [cx + Math.sin(a0) * r, yb2, cz + Math.cos(a0) * r], [n0, n1, n1, n0], NOUV, color);
    }
  }
  // 上向きの輪。skipK = [k0, k1) の扇形は作らない、onlyK = [k0, k1) の扇形だけ作る (N 分割のうちの番号)
  function ringFlat(buf, cx, cz, rin, rout, y, N, color, skipK = null, onlyK = null) {
    for (let k = 0; k < N; k++) {
      if (skipK && k >= skipK[0] && k < skipK[1]) continue;
      if (onlyK && !(k >= onlyK[0] && k < onlyK[1])) continue;
      const a0 = k / N * TAU, a1 = (k + 1) / N * TAU;
      buf.quad([cx + Math.sin(a0) * rin, y, cz + Math.cos(a0) * rin], [cx + Math.sin(a1) * rin, y, cz + Math.cos(a1) * rin], [cx + Math.sin(a1) * rout, y, cz + Math.cos(a1) * rout], [cx + Math.sin(a0) * rout, y, cz + Math.cos(a0) * rout], [0, 1, 0], NOUV, color);
    }
  }
  // 旋盤の形 (rings = [{ r, y }]、下から上へ)。法線は輪の間の傾きから
  function lathe(buf, cx, cz, rings, N, color, shadeFn = null) {
    for (let i = 0; i + 1 < rings.length; i++) {
      const A = rings[i], B = rings[i + 1], dr = B.r - A.r, dy = B.y - A.y, l = Math.hypot(dr, dy) || 1, nr = dy / l, ny = -dr / l;
      for (let k = 0; k < N; k++) {
        const a0 = k / N * TAU, a1 = (k + 1) / N * TAU, n0 = [Math.sin(a0) * nr, ny, Math.cos(a0) * nr], n1 = [Math.sin(a1) * nr, ny, Math.cos(a1) * nr];
        const c = shadeFn ? shadeFn(i, k) : color;
        buf.quad([cx + Math.sin(a0) * A.r, A.y, cz + Math.cos(a0) * A.r], [cx + Math.sin(a1) * A.r, A.y, cz + Math.cos(a1) * A.r], [cx + Math.sin(a1) * B.r, B.y, cz + Math.cos(a1) * B.r], [cx + Math.sin(a0) * B.r, B.y, cz + Math.cos(a0) * B.r], [n0, n1, n1, n0], NOUV, c);
      }
    }
  }
  // 手すり (円形のテラス): 柱と上下の桁
  function balustrade(cx, cz, r, y, N) {
    const n = low ? 0 : Math.max(8, Math.round(TAU * r / 0.9));
    for (let k = 0; k < n; k++) { const a = (k + 0.5) / n * TAU; trim.box(cx + Math.sin(a) * r, y + 0.45, cz + Math.cos(a) * r, 0.16, 0.8, 0.16, a, cream, NOUV, false); }
    cylBand(trim, cx, cz, r + 0.1, y + (low ? 0 : 0.8), y + 0.98, N, cream); cylBand(trim, cx, cz, r - 0.1, y + (low ? 0 : 0.8), y + 0.98, N, cream, true); ringFlat(trim, cx, cz, r - 0.1, r + 0.1, y + 0.98, N, cream);
    if (low) cylBand(trim, cx, cz, r, y, y + 0.9, N, cream);
    cylBand(trim, cx, cz, r + 0.06, y, y + 0.16, N, cream); ringFlat(trim, cx, cz, r - 0.06, r + 0.06, y + 0.16, N, cream);
  }
  // 軒の持ち出し (蛇腹): 半径 R の塔の上端 y。stone の段 + 持ち送りの列 + 金の線
  function cornice(cx, cz, R, y, N) {
    lathe(trim, cx, cz, [{ r: R, y: y - 0.75 }, { r: R + 0.22, y: y - 0.55 }, { r: R + 0.5, y: y - 0.3 }, { r: R + 0.6, y: y - 0.1 }, { r: R + 0.6, y: y + 0.26 }, { r: R + 0.3, y: y + 0.3 }], N, cream);
    ringFlat(trim, cx, cz, R + 0.3, R + 0.6, y + 0.26, N, cream);
    lathe(gold, cx, cz, [{ r: R + 0.61, y: y - 0.04 }, { r: R + 0.66, y: y }, { r: R + 0.66, y: y + 0.08 }, { r: R + 0.61, y: y + 0.1 }], N, goldC);
    if (!low) {   // 持ち送り (蛇腹の下の小さな石の列)
      const n = Math.max(10, Math.round(TAU * R / 0.8));
      for (let k = 0; k < n; k++) { const a = (k + 0.5) / n * TAU; trim.box(cx + Math.sin(a) * (R + 0.22), y - 0.55, cz + Math.cos(a) * (R + 0.22), 0.26, 0.4, 0.36, a, tint(cream, 0.93), NOUV, false); }
    }
  }
  // 円すいの屋根。eave = 軒の半径、h = 高さ。ribs = 稜線の数、color = 屋根の色、反りのある (すそが広がる) 形
  function roofCone(cx, cz, ya, Re, h, N, ribs, colorName, opts = {}) {
    const base = C(Cs[colorName] || colorName), ring = low ? 4 : 7, P = opts.curve || 1.18;
    const rAt = (t) => Re * Math.pow(1 - t, P) + (t < 0.08 ? (0.08 - t) * Re * 0.12 : 0), yAt = (t) => ya + h * t;
    const nRib = ribs || 8, per = Math.max(1, Math.round(N / nRib)), NN = per * nRib;
    const pt = (a, t, dr = 0) => [cx + Math.sin(a) * (rAt(t) + dr), yAt(t), cz + Math.cos(a) * (rAt(t) + dr)];
    const nrm = (a, t) => { const e = 0.01, r0 = rAt(t), r1 = rAt(Math.min(1, t + e)), dr = r1 - r0, dy = h * e, l = Math.hypot(dr, dy); const nr = dy / l, ny = -dr / l; return [Math.sin(a) * nr, ny, Math.cos(a) * nr]; };
    for (let i = 0; i < ring; i++) {
      const t0 = i / ring, t1 = (i + 1) / ring;
      for (let k = 0; k < NN; k++) {
        const a0 = k / NN * TAU, a1 = (k + 1) / NN * TAU, facet = Math.floor(k / per), kk = (facet % 2 ? 0.9 : 1.0) * (0.78 + 0.22 * Math.min(1, t0 * 1.4 + 0.25)), c = tint(base, kk);
        const nr0 = Math.max(3, Math.round(TAU * rAt(t0) / 1.0)), nr1 = Math.max(3, Math.round(TAU * rAt(t1) / 1.0));
        const ua0 = k / NN * nr0, ua1 = (k + 1) / NN * nr0, ub0 = k / NN * nr1, ub1 = (k + 1) / NN * nr1, vv0 = i * 0.9 * (h / 11), vv1 = (i + 1) * 0.9 * (h / 11);
        const A = pt(a0, t0), B = pt(a1, t0), Cc = pt(a1, t1), D = pt(a0, t1);
        const n0 = nrm(a0, t0), n1 = nrm(a1, t0), n2 = nrm(a1, t1), n3 = nrm(a0, t1);
        roof.tri(A, B, Cc, [n0, n1, n2], [[ua0, vv0], [ua1, vv0], [ub1, vv1]], c);
        if (i < ring - 1) roof.tri(A, Cc, D, [n0, n2, n3], [[ua0, vv0], [ub1, vv1], [ub0, vv1]], c);
      }
    }
    // 軒の縁取り
    lathe(gold, cx, cz, [{ r: Re + 0.28, y: ya - 0.28 }, { r: Re + 0.34, y: ya - 0.12 }, { r: Re + 0.1, y: ya + 0.18 }, { r: Re - 0.1, y: ya + 0.2 }], NN, goldC);
    // 軒の電飾 (夜に光る小さな玉の列)
    { const nl = Math.max(8, Math.round(TAU * Re / (low ? 2.6 : 1.5))); for (let k = 0; k < nl; k++) { const a = (k + 0.5) / nl * TAU; lamps.push([cx + Math.sin(a) * (Re + 0.34), ya - 0.16, cz + Math.cos(a) * (Re + 0.34), lampWarm, 0.13]); } }
    // 稜線 (金) と、稜線に沿った飾りの玉
    if (opts.ribs !== false) {
      const seg = low ? 3 : ring * 2;
      for (let r = 0; r < nRib; r++) {
        const a = (r * per) / NN * TAU, da = 0.06 / Math.max(2, Re);
        for (let s = 0; s < seg; s++) {
          const ta = s / seg * 0.98, tb = (s + 1) / seg * 0.98, w = 0.1 + 0.08 * (1 - ta);
          const A = pt(a - da * (1 - ta), ta, 0.01), B = pt(a + da * (1 - ta), ta, 0.01), A2 = pt(a - da * (1 - tb), tb, 0.01), B2 = pt(a + da * (1 - tb), tb, 0.01);
          const R1 = pt(a, ta, 0.13 * w * 3), R2 = pt(a, tb, 0.13 * w * 3), n = nrm(a, (ta + tb) / 2);
          gold.tri(A, R1, R2, n, [[0, 0], [0, 0], [0, 0]], goldC); gold.tri(A, R2, A2, n, [[0, 0], [0, 0], [0, 0]], goldC);
          gold.tri(B, R1, R2, n, [[0, 0], [0, 0], [0, 0]], goldC); gold.tri(B, R2, B2, n, [[0, 0], [0, 0], [0, 0]], goldC);
        }
        if (opts.crockets && !low) {   // 飾りのとげ (ひし形)
          for (let t = 0.14; t < 0.82; t += 0.115) {
            const c = pt(a, t, 0.22), up = [0, 0.3, 0], o = [Math.sin(a) * 0.17, 0, Math.cos(a) * 0.17], tg = [Math.cos(a) * 0.14, 0, -Math.sin(a) * 0.14];
            const top = [c[0] + up[0], c[1] + 0.34, c[2] + up[2]], bot = [c[0], c[1] - 0.2, c[2]], A = [c[0] + o[0], c[1], c[2] + o[2]], B = [c[0] + tg[0], c[1], c[2] + tg[2]], D = [c[0] - tg[0], c[1], c[2] - tg[2]], E = [c[0] - o[0] * 0.4, c[1], c[2] - o[2] * 0.4];
            for (const [p, q] of [[A, B], [B, E], [E, D], [D, A]]) { gold.tri(top, p, q, norm(sub(p, c)), [[0, 0], [0, 0], [0, 0]], goldC); gold.tri(bot, p, q, norm(sub(p, c)), [[0, 0], [0, 0], [0, 0]], goldC); }
          }
        }
      }
    }
    // 屋根窓 (ドーマー): 屋根の途中の小さな窓
    const nd = low ? 0 : (opts.dormers || 0);
    for (let d = 0; d < nd; d++) {
      const a = (d + 0.5) / nd * TAU + (opts.dormerPhase || 0), t = 0.3 + (d % 2 ? 0.07 : 0), r = rAt(t), cxD = cx + Math.sin(a) * r, czD = cz + Math.cos(a) * r, yD = yAt(t);
      dormer(cxD, yD, czD, a, Math.max(0.9, Math.min(1.7, Re * 0.2)), base);
    }
    return { rAt, yAt, apex: ya + h };
  }
  // 屋根窓: a = 外向きの角度、sz = 幅 (m)。正面の窓の絵 + 切妻の小屋根
  function dormer(x, y, z, a, sz, base) {
    const k = sz / 1.9, wd = 1.9 * k, ht = 2.4 * k, s = Math.sin(a), c = Math.cos(a);
    const P = (u, v, w) => [x + u * c + w * s, y + v, z - u * s + w * c], n = [s, 0, c], rect = cellRect(CELL.DORMER), hw2 = wd / 2, dep = 0.9 * k;
    wall.quad(P(-hw2, 0, dep), P(hw2, 0, dep), P(hw2, ht, dep), P(-hw2, ht, dep), n, rect, stone);
    for (const sd of [-1, 1]) {   // 側面
      trim.quad(P(sd * hw2, 0, dep), P(sd * hw2, 0, -0.3), P(sd * hw2, ht, -0.3), P(sd * hw2, ht, dep), [c * sd, 0, -s * sd], NOUV, shade);
    }
    const rid = ht + hw2 * 0.95;   // 切妻
    roof.tri(P(-hw2 - 0.12, ht, dep + 0.12), P(hw2 + 0.12, ht, dep + 0.12), P(0, rid, dep + 0.05), [n, n, n], [[0, 0], [1, 0], [0.5, 1]], tint(base, 1.05));
    for (const sd of [-1, 1]) roof.quad(P(sd * (hw2 + 0.12), ht, dep + 0.12), P(sd * (hw2 + 0.12), ht, -0.3), P(0, rid, -0.3), P(0, rid, dep + 0.05), [c * sd * 0.7, 0.7, -s * sd * 0.7], [0, 0, 2, 2], tint(base, 0.95));
    gold.tri(P(-hw2 - 0.12, ht, dep + 0.12), P(hw2 + 0.12, ht, dep + 0.12), P(0, rid + 0.1, dep + 0.08), n, [[0, 0], [0, 0], [0, 0]], goldC);
  }
  // 塔の先の尖塔 (金)・玉・旗
  function finial(x, y, z, h, color, big) {
    const r = big ? 0.7 : 0.42, N = low ? 6 : 10;
    lathe(gold, x, z, [{ r: r * 1.6, y: y }, { r: r * 0.55, y: y + h * 0.1 }, { r: r * 1.1, y: y + h * 0.13 }, { r: r * 0.5, y: y + h * 0.2 }, { r: r * 0.7, y: y + h * 0.3 }, { r: r * 0.3, y: y + h * 0.36 }, { r: 0.07, y: y + h }], N, goldC);
    // 玉
    for (const [t, rr] of [[0.14, r * 1.1], [0.62, r * 0.75]]) ball(x, y + h * t, z, rr);
    flags.push({ x, y: y + h * 0.78, z, len: big ? 6 : 3.4, h: big ? 2.2 : 1.3, color, ph: rngC() * 6 });
    return y + h;
  }
  function ball(x, y, z, r) {
    const N = low ? 6 : 10, M = low ? 3 : 5;
    for (let j = 0; j < M; j++) for (let k = 0; k < N; k++) {
      const p0 = j / M * Math.PI, p1 = (j + 1) / M * Math.PI, a0 = k / N * TAU, a1 = (k + 1) / N * TAU;
      const Pp = (p, a) => [x + Math.sin(p) * Math.sin(a) * r, y + Math.cos(p) * r, z + Math.sin(p) * Math.cos(a) * r], Nn = (p, a) => [Math.sin(p) * Math.sin(a), Math.cos(p), Math.sin(p) * Math.cos(a)];
      gold.tri(Pp(p0, a0), Pp(p1, a0), Pp(p1, a1), [Nn(p0, a0), Nn(p1, a0), Nn(p1, a1)], [[0, 0], [0, 0], [0, 0]], goldC);
      if (j > 0) gold.tri(Pp(p0, a0), Pp(p1, a1), Pp(p0, a1), [Nn(p0, a0), Nn(p1, a1), Nn(p0, a1)], [[0, 0], [0, 0], [0, 0]], goldC);
    }
  }

  // ---------- 塔 ----------
  const towerList = [];
  for (const T of Cf.towers) { towerList.push(T); if (T.mirror !== false) towerList.push({ ...T, x: -T.x, mirrorOf: T.id }); }
  let maxTop = 0;
  function buildTower(T) {
    const cx = T.x, cz = T.z, R0 = T.tiers[0].r, N = Math.max(low ? 10 : 14, Math.round((low ? 14 : 30) * Math.sqrt(R0 / 12.5) + 10) & ~1) * (low ? 1 : 1);
    const rc0 = C(Cs[T.roof.color] || T.roof.color), baseTint = new THREE.Color().lerpColors(stone, rc0, T.id === 'keep' ? 0.04 : 0.09).multiplyScalar(T.id === 'keep' ? 1 : 0.97 + rngC() * 0.05);   // 壁は屋根の色をほんのり映す
    // 土台 (水際の石組み)
    lathe(trim, cx, cz, [{ r: R0 + 1.5, y: -3 }, { r: R0 + 1.5, y: 0.35 }, { r: R0 + 0.95, y: 0.6 }, { r: R0 + 0.45, y: 0.9 }, { r: R0 + 0.12, y: 1.15 }], N, shade);
    let y = 0, topR = R0;
    T.tiers.forEach((tr, i) => {
      const r0 = tr.r, r1 = tr.r1 || tr.r * 0.97, hh = tr.fl * tr.fh, bayW = 4.4;
      const cell = (T.id === 'keep' || i === 0) ? CELL.WIN : CELL.WIN;
      const doorSkip = (T.door && i === 0) ? (f, a0, a1) => f === 0 && (a1 <= 0.19 || a0 >= TAU - 0.19) : null;   // 主塔の正面の入口 (扉の幅)
      cylWall(cx, cz, y, r0, r1, tr.fl, tr.fh, cell, bayW, baseTint, T.phase || 0, tr.fl >= 3 && i === 0 && T.id !== 'keep' ? (f) => (f === 0 ? CELL.SLIT : CELL.WIN) : null, doorSkip);
      y += hh; topR = r1;
      cornice(cx, cz, r1, y, N);
      if (tr.ledge) { // 次の段との間にテラス
        const nxt = T.tiers[i + 1];
        const rin = nxt ? nxt.r : topR - 1.2, rout = topR + 0.6;
        if (nxt) {
          if (T.door && i === 0) {   // 主塔のテラス: 階段の抜け口の扇形だけ、内側 (rin〜内壁の外) の床を開ける
            ringFlat(trim, cx, cz, rin, rout, y + 0.3, N, tint(cream, 0.96), KEEP.HOLE);
            ringFlat(trim, cx, cz, KEEP.RI, rout, y + 0.3, N, tint(cream, 0.96), null, KEEP.HOLE);
          } else ringFlat(trim, cx, cz, rin, rout, y + 0.3, N, tint(cream, 0.96));
          balustrade(cx, cz, rout - 0.25, y + 0.3, N);
          if (!low) { const nL = Math.max(4, Math.round(TAU * rout / 7)); for (let k = 0; k < nL; k++) { const a = (k + 0.5) / nL * TAU; gold.box(cx + Math.sin(a) * (rout - 0.25), y + 1.2, cz + Math.cos(a) * (rout - 0.25), 0.14, 1.8, 0.14, 0, goldC); lamps.push([cx + Math.sin(a) * (rout - 0.25), y + 2.2, cz + Math.cos(a) * (rout - 0.25), lampWarm, 0.26]); } }
        }
      }
      y += 0.3;
    });
    // 屋根
    const ro = T.roof, Re = topR + 0.6 + (ro.over || 1), ya = y;
    const rc = roofCone(cx, cz, ya, Re, ro.h, Math.max(16, Math.round(N / 8) * 8), ro.ribs, ro.color, { dormers: ro.dormers, crockets: ro.crockets, curve: 1.2, dormerPhase: T.id === 'keep' ? 0.2 : 0.5 });
    const top = finial(cx, ya + ro.h - 0.2, cz, T.finial.h, ro.color, T.id === 'keep');
    maxTop = Math.max(maxTop, top);
    if (T.id === 'inner' || T.id === 'mid') spires.push([cx, top, cz]);
    // 当たり判定 (円)
    const [wx, wz] = W(cx, cz);
    if (T.door) {   // 主塔: 1 段目は中に入れる (外壁の輪 = 扉のところだけ開ける。buildKeepInterior)。2 段目より上は円 (テラスの床より上)
      {   // 2 段目より上の壁 = 薄い輪 (円盤にすると、階段の最後の数段で頭がつかえる)
        const ln = [0.6, top - KEEP.CEIL], M = 40;
        for (let k = 0; k <= M; k++) { const a = k / M * TAU, [qx, qz] = W(cx + Math.sin(a) * 9.5, cz + Math.cos(a) * 9.5); ln.push(qx, qz, y0 + KEEP.CEIL); }
        col.line.push(ln);
      }
      grandDoor(cx, cz + R0 - 0.2);
      buildKeepInterior({ Buf, NOUV, CELL, cellRect, tint, wall, trim, hall, gold, col, W, y0, lamps, lampWarm, goldC, cream, stone, Cs, low, group: api.group, cx, cz, yaw: Cf.yaw });
    } else col.circle.push([wx, wz, R0 + 0.7, y0 - 1, y0 + top]);
    return rc;
  }
  // 主塔の正面の大きな扉 (アーチ 3 重 + 階段 + 灯り)
  function grandDoor(x, z) {
    for (let s = 0; s < 4; s++) trim.box(x, 0.1 + s * 0.12, z + 1.3 - s * 0.32 + 0.4, 8.4 - s * 0.9, 0.2, 2.2 + s * 0.6 - 0.6, 0, tint(cream, 0.94 - s * 0.01));
    for (const sd of [-1, 1]) { trim.box(x + sd * 4.6, 1.2, z + 1.0, 0.7, 2.4, 0.7, 0, cream); ball2(x + sd * 4.6, 2.9, z + 1.0, 0.5, lampWarm); }
  }
  // とがりアーチの重ね縁 (正面の面 z、中心 x、半幅 hw、起点の高さ y、n 重・各幅・出っぱり)
  function archPts(hw, y, M) {   // 正三角形のとがりアーチの輪郭 (左の起点 → 頂点 → 右の起点)
    const R = 2 * hw, left = [];
    for (let k = 0; k <= M; k++) { const th = Math.PI - (Math.PI / 3) * (k / M); left.push([hw + R * Math.cos(th), y + R * Math.sin(th)]); }
    return left.concat(left.slice(0, -1).reverse().map(([px, py]) => [-px, py]));
  }
  function archBands(x, z, hw, y, n, wd, step, face = 1, depth = 0.3, buf = trim, c0 = cream) {
    const M = low ? 4 : 8;
    for (let i = 0; i < n; i++) {
      const hi = hw + i * step, ho = hi + wd, a = archPts(hi, y, M), b = archPts(ho, y, M), zz = z + face * (depth * (n - i) / n), nn = [0, 0, face];
      for (let k = 0; k + 1 < a.length; k++) {
        buf.quad([x + a[k][0], a[k][1], zz], [x + a[k + 1][0], a[k + 1][1], zz], [x + b[k + 1][0], b[k + 1][1], zz], [x + b[k][0], b[k][1], zz], nn, NOUV, tint(c0, 0.97 + 0.03 * i));
      }
      // 脚の縦の帯 (起点から地面まで)
      for (const sd of [-1, 1]) buf.quad([x + sd * hi, y, zz], [x + sd * ho, y, zz], [x + sd * ho, 0.3, zz], [x + sd * hi, 0.3, zz], nn, NOUV, tint(c0, 0.97 + 0.03 * i));
    }
  }
  function ball2(x, y, z, r, mat) {   // 光る玉 (夜に光る材質のため別の形で)
    lamps.push([x, y, z, mat, r]);
  }

  // ---------- 城壁 ----------
  const wallPolys = [];
  function buildWall(pts, h, t) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L, nx = -dz, nz = dx, hT = t / 2;
      const nb = Math.max(1, Math.round(L / BAY.w)), yaw = Math.atan2(dx, dz);
      for (const side of [1, -1]) {   // 左 (nx, nz) と右の面
        const o = [nx * hT * side, nz * hT * side], nn = [nx * side, 0, nz * side];
        for (let b = 0; b < nb; b++) {
          const s0 = b / nb * L, s1 = (b + 1) / nb * L;
          for (let f = 0; f < 2; f++) {
            const rc = cellRect(f === 0 ? CELL.PLAIN : CELL.SLIT), ya = f * h / 2, yb2 = (f + 1) * h / 2, k = f === 0 ? 0.92 : 0.98;
            const A = [ax + dx * s0 + o[0], ya, az + dz * s0 + o[1]], B = [ax + dx * s1 + o[0], ya, az + dz * s1 + o[1]];
            const Cc = [B[0], yb2, B[2]], D = [A[0], yb2, A[2]];
            if (side > 0) wall.quad(B, A, D, Cc, nn, rc, stone, [tint(stone, k), tint(stone, k), tint(stone, k + 0.04), tint(stone, k + 0.04)]);
            else wall.quad(A, B, Cc, D, nn, rc, stone, [tint(stone, k), tint(stone, k), tint(stone, k + 0.04), tint(stone, k + 0.04)]);
          }
        }
        // 張り出しの蛇腹と胸壁 (ぎざぎざ)
        trim.box(ax + dx * L / 2 + o[0] * 1.06, h - 0.2, az + dz * L / 2 + o[1] * 1.06, 0.4, 0.4, L, yaw, cream, NOUV, true);
        const nm = Math.floor(L / 1.7);
        for (let m = 0; m < nm; m++) { const s = (m + 0.5) / nm * L; trim.box(ax + dx * s + o[0] * 0.9, h + 0.55, az + dz * s + o[1] * 0.9, 0.9, 1.1, 0.5, yaw, tint(cream, 0.97)); }
      }
      // 上面の通路
      trim.quad([ax + nx * hT, h, az + nz * hT], [bx + nx * hT, h, bz + nz * hT], [bx - nx * hT, h, bz - nz * hT], [ax - nx * hT, h, az - nz * hT], [0, 1, 0], NOUV, tint(shade, 1.05));
      // 当たり判定
      const [wx0, wz0] = W(ax, az), [wx1, wz1] = W(bx, bz);
      col.line.push([hT + 0.1, h, wx0, wz0, y0 - 1, wx1, wz1, y0 - 1]);
      wallPolys.push([ax, az, bx, bz]);
    }
  }

  // ---------- 門塔 (トンネルを通り抜けられる) ----------
  function buildGate(g) {
    const { z0, z1, hw, w, h, gable, face } = g, spring = 5, M = low ? 4 : 8, zOut = face > 0 ? z1 : z0, zIn = face > 0 ? z0 : z1, cell = cellRect(CELL.WIN), plain = cellRect(CELL.PLAIN), vault = cellRect(CELL.VAULT);
    const arch = archPts(hw, spring, M), apexY = arch[Math.floor(arch.length / 2)][1];
    const kb = (f) => [tint(stone, f), tint(stone, f), tint(stone, f + 0.05), tint(stone, f + 0.05)];
    // 両側の面 (外・内の 2 つの正面)
    for (const zz of [z0, z1]) {
      const nn = [0, 0, zz === z1 ? 1 : -1], out = zz === zOut;
      for (const sd of [-1, 1]) {   // 左右の袖 (アーチの外側)
        const xa = sd * hw, xb = sd * w, nb = Math.max(1, Math.round(Math.abs(xb - xa) / BAY.w)), nf = Math.round(h / 5.2);
        for (let b = 0; b < nb; b++) for (let f = 0; f < nf; f++) {
          const xl = xa + (xb - xa) * b / nb, xr = xa + (xb - xa) * (b + 1) / nb, ya = f * h / nf, yb2 = (f + 1) * h / nf, rc = (f === 0 || !out) ? plain : cell, k = 0.92 + 0.06 * f / nf;
          const A = [xl, ya, zz], B = [xr, ya, zz], Cc = [xr, yb2, zz], D = [xl, yb2, zz];
          if ((zz === z1) === (sd > 0)) wall.quad(B, A, D, Cc, nn, rc, stone, kb(k).slice(0, 4)); else wall.quad(A, B, Cc, D, nn, rc, stone, kb(k));
        }
      }
      // アーチの上 (起点から軒まで)
      for (let k = 0; k + 1 < arch.length; k++) {
        const a = arch[k], b = arch[k + 1], A = [a[0], a[1], zz], B = [b[0], b[1], zz], Cc = [b[0], h, zz], D = [a[0], h, zz];
        const rc = [plain[0] + (plain[2] - plain[0]) * (a[0] + w) / (2 * w), plain[1], plain[0] + (plain[2] - plain[0]) * (b[0] + w) / (2 * w), plain[3]];
        if (zz === z1) wall.quad(A, B, Cc, D, nn, [rc[0], plain[1], rc[2], plain[3]], stone, kb(0.95)); else wall.quad(B, A, D, Cc, nn, [rc[0], plain[1], rc[2], plain[3]], stone, kb(0.95));
      }
      if (gable) {   // 切妻の縁の金の飾り (ケラバ) と、小さなリールの丸窓 (外側の面だけ)
        const fc = zz === z1 ? 1 : -1, pz = zz + fc * 0.26;
        for (const sd of [-1, 1]) gold.quad([sd * (w + 0.5), h - 0.1, pz], [sd * (w + 0.5 - 0.7), h + 0.45, pz], [0, h + gable - 0.2, pz], [0, h + gable + 0.5, pz], [0, 0, fc], NOUV, goldC);
        if (out && g.rose) { const rc = cellRect(CELL.ROSE), ry = h + gable * 0.38, rr = 1.9; wall.quad([-rr, ry - rr, pz], [rr, ry - rr, pz], [rr, ry + rr, pz], [-rr, ry + rr, pz], [0, 0, fc], rc, stone); lathe3(gold, 0, ry, pz + fc * 0.03, rr, rr + 0.25, fc, goldC); }
      }
      if (gable) {   // 切妻の板張り (縦の金の桟)
        const fc = zz === z1 ? 1 : -1, hh = (x) => (gable + 0.1) * (1 - Math.abs(x) / (w + 0.5));
        for (let x = -w + 1.2; x < w - 1; x += 1.7) { const hx = hh(x) - 0.55; if (hx > 0.6) gold.box(x, h + hx / 2 + 0.1, zz + fc * 0.3, 0.1, hx, 0.08, 0, tint(goldC, 0.85), NOUV, false); }
        gold.box(0, h + 0.5, zz + fc * 0.3, 2 * w, 0.18, 0.08, 0, goldC, NOUV, false);
      }
      // 軒より上の切妻 (三角)
      if (gable) trim.tri([-w - 0.5, h, zz + (zz === z1 ? 0.2 : -0.2)], [w + 0.5, h, zz + (zz === z1 ? 0.2 : -0.2)], [0, h + gable, zz + (zz === z1 ? 0.1 : -0.1)], nn, [[0, 0], [1, 0], [0.5, 1]], tint(stone, 0.97));
    }
    // 側面 (門塔の左右の外の面)
    for (const sd of [-1, 1]) {
      const nn = [sd, 0, 0], nb = Math.max(1, Math.round((z1 - z0) / BAY.w)), nf = Math.round(h / 5.2);
      for (let b = 0; b < nb; b++) for (let f = 0; f < nf; f++) {
        const za = z0 + (z1 - z0) * b / nb, zb = z0 + (z1 - z0) * (b + 1) / nb, ya = f * h / nf, yb2 = (f + 1) * h / nf, rc = f === 0 ? plain : cell;
        const A = [sd * w, ya, za], B = [sd * w, ya, zb], Cc = [sd * w, yb2, zb], D = [sd * w, yb2, za];
        if (sd > 0) wall.quad(B, A, D, Cc, nn, rc, stone, kb(0.94)); else wall.quad(A, B, Cc, D, nn, rc, stone, kb(0.94));
      }
    }
    // トンネルの中 (壁・丸天井)
    for (const sd of [-1, 1]) {
      const nn = [-sd, 0, 0], A = [sd * hw, 0, z0], B = [sd * hw, 0, z1], Cc = [sd * hw, spring, z1], D = [sd * hw, spring, z0];
      wall.quad(...(sd > 0 ? [B, A, D, Cc] : [A, B, Cc, D]), nn, vault, C('#cfc7dc'));
    }
    for (let k = 0; k + 1 < arch.length; k++) {
      const a = arch[k], b = arch[k + 1], mx = (a[0] + b[0]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
      const inN =   // 丸天井の内側 (トンネルの中心の側) を向く法線
      (mx > 0 ? [-Math.abs(dy) / l, -Math.abs(dx) / l, 0] : [Math.abs(dy) / l, -Math.abs(dx) / l, 0]);
      wall.quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], inN, vault, C('#cbc2d9'));
    }
    // 丸天井のリブと灯り
    const nr = Math.max(2, Math.round((z1 - z0) / 4));
    for (let r = 0; r <= nr; r++) {
      const zz = z0 + (z1 - z0) * r / nr, inner = archPts(hw - 0.0, spring, M);
      for (let k = 0; k + 1 < inner.length; k++) { const a = inner[k], b = inner[k + 1]; trim.quad([a[0], a[1] - 0.02, zz - 0.18], [b[0], b[1] - 0.02, zz - 0.18], [b[0], b[1] - 0.02, zz + 0.18], [a[0], a[1] - 0.02, zz + 0.18], [0, -1, 0], NOUV, tint(cream, 0.9)); }
      if (r > 0 && r < nr) lamps.push([0, apexY - 0.9, zz, lampWarm, 0.34]);
    }
    // 正面と背面のアーチの重ね縁・灯り・のぼり・バラ窓
    for (const zz of [z0, z1]) {
      const fc = zz === z1 ? 1 : -1;
      archBands(0, zz, hw, spring, 3, 0.4, 0.34, fc, 0.35);
      for (const sd of [-1, 1]) { trim.box(sd * (hw + 1.9), 4.6, zz + fc * 0.5, 0.5, 4, 0.7, 0, cream); lamps.push([sd * (hw + 1.9), 7.1, zz + fc * 0.55, lampWarm, 0.42]); }
    }
    const fOut = face > 0 ? z1 : z0, fo = face;
    if (g.rose) {
      const rc = cellRect(CELL.ROSE), rr = 3.4, ry = Math.min(h - rr - 0.6, spring + 1.732 * hw + 1.9 + rr);
      wall.quad([-rr, ry - rr, fOut + fo * 0.08], [rr, ry - rr, fOut + fo * 0.08], [rr, ry + rr, fOut + fo * 0.08], [-rr, ry + rr, fOut + fo * 0.08], [0, 0, fo], rc, stone);
      lathe3(trim, 0, ry, fOut + fo * 0.1, rr + 0.1, rr + 0.7, fo, cream); lathe3(gold, 0, ry, fOut + fo * 0.14, rr + 0.7, rr + 0.9, fo, goldC);
      for (const sd of [-1, 1]) bannerList.push([sd * (hw + 6.2), ry + 1.2, fOut + fo * 0.25, 2.4, 9, fo]);
    }
    // 切妻の屋根 (稜線は前後に走る)
    if (gable) {
      const base = C(Cs[g.roof] || Cs.sky), ov = 1.1;
      for (const sd of [-1, 1]) {
        const A = [sd * (w + ov), h - 0.4, z0 - 0.6], B = [sd * (w + ov), h - 0.4, z1 + 0.6], Cc = [0, h + gable + 0.1, z1 + 0.3], D = [0, h + gable + 0.1, z0 - 0.3], nn = norm([sd * gable, w, 0]);
        const nu = Math.round((z1 - z0) / 1.0), nv = 5;
        for (let u = 0; u < nu; u++) for (let v = 0; v < nv; v++) {
          const f = (uu, vv) => [A[0] + (D[0] - A[0]) * vv, A[1] + (D[1] - A[1]) * vv, (z0 - 0.6) + (z1 - z0 + 1.2) * uu];
          roof.quad(f(u / nu, v / nv), f((u + 1) / nu, v / nv), f((u + 1) / nu, (v + 1) / nv), f(u / nu, (v + 1) / nv), nn, [u * 0.5, v * 0.8, (u + 1) * 0.5, (v + 1) * 0.8], tint(base, 0.85 + 0.15 * v / nv));
        }
        gold.tri([sd * (w + ov), h - 0.4, z1 + 0.6], [sd * (w + ov), h - 0.1, z1 + 0.6], [0, h + gable + 0.1, z1 + 0.3], [0, 0, 1], [[0, 0], [0, 0], [0, 0]], goldC);
        gold.tri([sd * (w + ov), h - 0.4, z0 - 0.6], [sd * (w + ov), h - 0.1, z0 - 0.6], [0, h + gable + 0.1, z0 - 0.3], [0, 0, -1], [[0, 0], [0, 0], [0, 0]], goldC);
      }
      // 棟の金の線と旗
      gold.box(0, h + gable + 0.18, (z0 + z1) / 2, 0.4, 0.3, z1 - z0 + 0.8, 0, goldC);
      if (g.rose) finial(0, h + gable + 0.2, z1 - 1, 9, 'gold', false);
      else finial(0, h + gable + 0.2, (z0 + z1) / 2, 6, 'gold', false);
    }
    // 上げかけの落とし格子 (鉄の縦棒 + 横の桟。アーチの上の方に下がる)
    {
      const bars = low ? 5 : 9, zz = zOut - fo * 0.9, iron = C('#3b3a4a'), top = (x) => spring + Math.sqrt(Math.max(0, 4 * hw * hw - (Math.abs(x) - hw) ** 2));
      for (let k = 0; k < bars; k++) {
        const x = -hw + 0.55 + (2 * hw - 1.1) * k / (bars - 1), yt = top(x) - 0.05;
        gold.box(x, yt - 0.8, zz, 0.1, 1.6, 0.1, 0, iron, NOUV, false);
        gold.box(x, yt - 1.6, zz, 0.16, 0.3, 0.16, 0, goldC, NOUV);
      }
      for (const dy of [0.55, 1.1]) { const yy = top(0) - dy - 0.7; gold.box(0, yy, zz, 2 * hw - 0.9, 0.08, 0.1, 0, iron, NOUV, false); }
    }
    // 床と下の石組み
    wall.quad([-w, -2.5, zOut], [w, -2.5, zOut], [w, 0.3, zOut], [-w, 0.3, zOut], [0, 0, fo], plain, tint(shade, 0.92));
    // 角の見張り塔 (小塔)
    if (g.bartizans) for (const sx of [-1, 1]) for (const [zz, fc] of [[z0, -1], [z1, 1]]) bartizan(sx * w, h - 3.6, zz + fc * 0.3, 1.95, sx);
    // 当たり判定: 袖と門塔の肩 (トンネルの幅は通れる)
    for (const sd of [-1, 1]) { const [bx, bz] = W(sd * (hw + w) / 2, (z0 + z1) / 2); col.box.push([bx, bz, Cf.yaw, (w - hw) / 2, (z1 - z0) / 2, y0 - 1, y0 + h + gable]) }
  }
  const bannerList = [];
  function lathe3(buf, x, y, z, r0, r1, fo, c) {   // 正面向きの平らな輪 (z 一定)
    const N = low ? 16 : 32;
    for (let k = 0; k < N; k++) { const a0 = k / N * TAU, a1 = (k + 1) / N * TAU; buf.quad([x + Math.cos(a0) * r0, y + Math.sin(a0) * r0, z], [x + Math.cos(a1) * r0, y + Math.sin(a1) * r0, z], [x + Math.cos(a1) * r1, y + Math.sin(a1) * r1, z], [x + Math.cos(a0) * r1, y + Math.sin(a0) * r1, z], [0, 0, fo], NOUV, c); }
  }
  function bartizan(x, y, z, r, sx) {   // 角の小塔: 持ち送り (さかさの円すい) + 胴 + 屋根
    const N = low ? 8 : 12, c = tint(stone, 0.96);
    lathe(trim, x, z, [{ r: r * 0.45, y: y + 0.5 }, { r: r * 0.62, y: y + 0.5 }, { r: r * 0.62, y: y + 0.95 }, { r: r * 0.82, y: y + 0.95 }, { r: r * 0.82, y: y + 1.4 }, { r: r + 0.12, y: y + 1.4 }, { r: r + 0.12, y: y + 2.0 }], N, cream);
    cylWall(x, z, y + 2.0, r, r * 0.97, 1, 3.4, CELL.SLIT, 3.0, c);
    cornice(x, z, r * 0.97, y + 5.4, N);
    roofCone(x, z, y + 5.7, r + 0.9, 4.8, N, 8, 'gold', { dormers: 0, ribs: false, curve: 1.3 });
    finial(x, y + 10.3, z, 2.4, 'rose', false);
    const [wx, wz] = W(x, z); col.circle.push([wx, wz, r + 0.2, y0 + y, y0 + y + 10.5]);
  }

  // ---------- 組み立て ----------
  const keepRoof = {};
  for (const T of towerList) { const r = buildTower(T); if (T.id === 'keep') Object.assign(keepRoof, r); }
  for (const w of Cf.walls) { buildWall(w.pts, w.h, w.t); buildWall(w.pts.map(([x, z]) => [-x, z]), w.h, w.t); }
  for (const g of Cf.gates) buildGate(g);

  // ---------- 頭上の冠 (主塔の頂の 3 枚の輪) ----------
  const crown = new THREE.Group(); crown.name = 'castle_crown';
  const keepTop = maxTop;
  const RC = Cf.reel, wheels = [];
  {
    const R = RC.R, goldM = new THREE.MeshStandardMaterial({ color: '#f2c85c', roughness: 0.34, metalness: 0.3, emissive: '#c8902c', emissiveIntensity: 0 });
    goldM.userData.glow = 0.5; emissive.push(goldM);
    const shape = new THREE.Shape(); shape.absarc(0, 0, R, 0, TAU, false);
    for (let k = 0; k < RC.holes; k++) { const a = k / RC.holes * TAU, h = new THREE.Path(); h.absarc(Math.cos(a) * R * 0.58, Math.sin(a) * R * 0.58, R * 0.27, 0, TAU, true); shape.holes.push(h); }
    const hub = new THREE.Path(); hub.absarc(0, 0, R * 0.09, 0, TAU, true); shape.holes.push(hub);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.14, bevelSegments: 1, curveSegments: low ? 16 : 32 }); geo.translate(0, 0, -0.35);
    const rimG = new THREE.TorusGeometry(R + 0.05, 0.36, 8, low ? 32 : 64);
    const glassMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    glassMat.userData.glow = 0.55; glassMat.userData.opacityOnly = true; emissive.push(glassMat);
    // 穴のステンドグラス (輪ごとに 6 枚の円を 1 つの形に)
    const glassGeo = (() => {
      const pos = [], cl = [], pal = ['#ff86b8', '#59c8e6', '#ffd36b'].map(C), N = low ? 10 : 18;
      for (let k = 0; k < RC.holes; k++) {
        const a = k / RC.holes * TAU, cx = Math.cos(a) * R * 0.58, cy = Math.sin(a) * R * 0.58, c = pal[k % 3], rr = R * 0.27;
        for (let j = 0; j < N; j++) { const t0 = j / N * TAU, t1 = (j + 1) / N * TAU; pos.push(cx, cy, 0, cx + Math.cos(t0) * rr, cy + Math.sin(t0) * rr, 0, cx + Math.cos(t1) * rr, cy + Math.sin(t1) * rr, 0); for (let q = 0; q < 3; q++) cl.push(c.r, c.g, c.b); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3)); return g;
    })();
    const bulbG = new THREE.SphereGeometry(0.34, 6, 4), bulbs = [], bd = new THREE.Object3D();
    for (let w = 0; w < RC.wheels; w++) {
      const holder = new THREE.Group(); holder.rotation.y = w / RC.wheels * Math.PI; crown.add(holder);
      const wheel = new THREE.Group(); holder.add(wheel);
      const m = new THREE.Mesh(geo, goldM); m.castShadow = true; wheel.add(m);
      const rim = new THREE.Mesh(rimG, goldM); rim.castShadow = true; wheel.add(rim);
      wheel.add(new THREE.Mesh(glassGeo, glassMat));
      if (!low) for (let g = 0; g < 3; g++) {   // 電球 24 個 = 3 組 (組ごとに光り方がずれてまわる)
        const bm = lampWarm.clone(); bm.userData.glow = 1.4; emissive.push(bm);
        const im = new THREE.InstancedMesh(bulbG, bm, 8);
        for (let k = 0; k < 8; k++) { const a = (k * 3 + g) / 24 * TAU; bd.position.set(Math.cos(a) * (R + 0.45), Math.sin(a) * (R + 0.45), 0); bd.updateMatrix(); im.setMatrixAt(k, bd.matrix); }
        im.frustumCulled = false; wheel.add(im); bulbs.push({ mat: bm, k: g * 8, w });
      }
      wheels.push({ wheel, dir: w % 2 ? -1 : 1, rate: RC.spin * (1 + w * 0.18) });
    }
    {   // 冠の頂の星 (金の六芒星。夜は光る)
      const st = new THREE.Shape(), RO = 2.0, RI = 0.85;
      for (let k = 0; k < 12; k++) { const a = k / 12 * TAU, r = k % 2 ? RI : RO; (k ? st.lineTo(Math.sin(a) * r, Math.cos(a) * r) : st.moveTo(Math.sin(a) * r, Math.cos(a) * r)); }
      st.closePath();
      const sg = new THREE.ExtrudeGeometry(st, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 1 }); sg.translate(0, 0, -0.25);
      const sm = new THREE.Mesh(sg, goldM); sm.position.set(0, RC.finialTop ? RC.finialTop - RC.y + 1.2 : 11.4, 0); crown.add(sm); const sm2 = sm.clone(); sm2.rotation.y = Math.PI / 2; crown.add(sm2);
    }
    crown.position.set(0, RC.y, -4);
    const hubBall = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), goldM); crown.add(hubBall);
    api.group.add(crown);
    api.crown = crown; api.bulbs = bulbs;
  }

  // ---------- 灯・のぼり・旗 ----------
  {
    const N = lamps.length, gl = new THREE.SphereGeometry(1, low ? 5 : 7, low ? 3 : 5);
    const by = new Map();
    for (const l of lamps) { if (!by.has(l[3])) by.set(l[3], []); by.get(l[3]).push(l); }
    for (const [mat, list] of by) {
      const im = new THREE.InstancedMesh(gl, mat, list.length), d = new THREE.Object3D();
      list.forEach((l, i) => { d.position.set(l[0], l[1], l[2]); d.scale.setScalar(l[4]); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
      im.computeBoundingSphere(); api.group.add(im);
    }
    api.stats.lamps = N;
  }
  const bannerTex = makeBanner();
  if (bannerList.length) {
    const g = new THREE.BufferGeometry(), p = [], n = [], uv = [];
    for (const [x, y, z, w, h, fo] of bannerList) {
      const a = [x - w / 2, y - h, z], b = [x + w / 2, y - h, z], c = [x + w / 2, y, z], d = [x - w / 2, y, z];
      const tri = fo > 0 ? [a, b, c, a, c, d] : [b, a, d, b, d, c], u = fo > 0 ? [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]] : [[1, 0], [0, 0], [0, 1], [1, 0], [0, 1], [1, 1]];
      tri.forEach((q, i) => { p.push(q[0], q[1], q[2]); n.push(0, 0, fo); uv.push(u[i][0], u[i][1]); });
      gold.box(x, y + 0.1, z + fo * 0.05, w + 0.8, 0.2, 0.2, 0, goldC);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.7, side: THREE.DoubleSide })); m.castShadow = true; api.group.add(m);
  }

  // ---------- 島・堤道・庭 ----------
  buildGrounds();
  function buildGrounds() {
    const I = Cf.island, cwList = Cf.causeways, cwHalf = (c) => c.width / 2;
    const flatMesh = (pos, color, lift, rough = 0.9) => {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: rough, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 - lift * 10, polygonOffsetUnits: -2 - lift * 10 }));
      m.receiveShadow = true; api.group.add(m); return m;
    };
    const ell = (rx, rz, n = 96, cx = 0, cz = 0) => { const o = []; for (let k = 0; k < n; k++) { const a = k / n * TAU; o.push([cx + rx * Math.cos(a), cz + rz * Math.sin(a)]); } return o; };
    const fan = (pts, y, c = [0, 0]) => { const pos = []; for (let k = 0; k < pts.length; k++) { const a = pts[k], b = pts[(k + 1) % pts.length]; pos.push(c[0], y, c[1], a[0], y, a[1], b[0], y, b[1]); } return pos; };
    const rectPos = (x0, z0, x1, z1, y) => [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1];
    // 島の芝・石畳
    flatMesh(fan(ell(I.rx - 0.2, I.rz - 0.2), 0.12), Cs.lawn, 0.12);
    const pave = '#d9cfc0', pave2 = '#e8dfd2';
    const paveRects = [[-7, 33, 7, 44], [-3.75, 20, 3.75, 34], [-7, 8, 7, 21], [-3.5, -34, 3.5, -24]];
    const pp = []; for (const r of paveRects) pp.push(...rectPos(r[0], r[1], r[2], r[3], 0.2)); flatMesh(pp, pave, 0.2);
    // 円形の広場 (主塔のまわり・前庭・裏庭)
    const starTex = canvasTexture(512, 512, (g) => {
      g.fillStyle = '#e9e0d3'; g.fillRect(0, 0, 512, 512); const c = 256;
      for (let k = 0; k < 24; k++) { g.fillStyle = k % 2 ? '#d7cdbf' : '#f1e9dc'; g.beginPath(); g.moveTo(c, c); g.arc(c, c, 254, k / 24 * TAU, (k + 1) / 24 * TAU); g.closePath(); g.fill(); }
      g.strokeStyle = '#c9a647'; g.lineWidth = 6; for (const r of [60, 130, 200, 248]) { g.beginPath(); g.arc(c, c, r, 0, TAU); g.stroke(); }
      g.fillStyle = '#c9a647'; for (let k = 0; k < 12; k++) { const a = k / 12 * TAU; g.beginPath(); for (let j = 0; j < 10; j++) { const rr = j % 2 ? 14 : 30, aa = a + j / 10 * TAU; g.lineTo(c + Math.cos(a) * 165 + Math.cos(aa) * rr, c + Math.sin(a) * 165 + Math.sin(aa) * rr); } g.closePath(); g.fill(); }
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(23, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: starTex, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    disc.position.set(0, 0.22, -4); disc.receiveShadow = true; api.group.add(disc);
    // 護岸 (島のまわりの石垣)。堤道の所は切る
    const wallPts = [], wr = ell(I.rx + 1.0, I.rz + 1.0, 120);
    const inGate = (x, z) => cwList.some((c) => Math.abs(x) < cwHalf(c) + 0.6 && Math.sign(z) === Math.sign(c.to));
    const seawall = new Buf(), curb = new Buf(), plainRect = cellRect(CELL.PLAIN);
    for (let k = 0; k < wr.length; k++) {
      const a = wr[k], b = wr[(k + 1) % wr.length], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if (inGate(mx, mz)) { wallPts.push(null); continue; }
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), o = norm([a[0] / I.rx ** 2, 0, a[1] / I.rz ** 2]);
      const n = [o[0], 0, o[2]], uu = L / 4.5;
      seawall.quad([a[0], -3, a[1]], [b[0], -3, b[1]], [b[0], 0.28, b[1]], [a[0], 0.28, a[1]], n, [plainRect[0], plainRect[1], plainRect[0] + (plainRect[2] - plainRect[0]) * Math.min(1, uu), plainRect[1] + (plainRect[3] - plainRect[1]) * 0.55], stone, [shade, shade, tint(shade, 1.1), tint(shade, 1.1)]);
      const a2 = [a[0] * 0.985, a[1] * 0.985], b2 = [b[0] * 0.985, b[1] * 0.985];
      curb.quad([a[0] * 1.004, 0.3, a[1] * 1.004], [b[0] * 1.004, 0.3, b[1] * 1.004], [b2[0], 0.3, b2[1]], [a2[0], 0.3, a2[1]], [0, 1, 0], NOUV, cream);
      wallPts.push([a, b]);
    }
    {
      const g = seawall.geometry(), m = new THREE.Mesh(g, wallMat); m.receiveShadow = true; api.group.add(m);
      const gc = curb.geometry(), mc = new THREE.Mesh(gc, trimMat); api.group.add(mc);
    }
    // 島の縁の当たり判定 (水に入らない)。堤道の所は開ける
    {
      let ln = null;
      const er = ell(I.rx + 1.6, I.rz + 1.6, 120);
      for (let k = 0; k <= er.length; k++) {
        const a = er[k % er.length], skip = inGate(a[0], a[1]);
        if (skip) { ln = null; continue; }
        const [wx, wz] = W(a[0], a[1]);
        if (!ln) { ln = [0.3, 1.4]; col.line.push(ln); }
        ln.push(wx, wz, y0);
      }
    }
    // 堤道 (島から岸への石の道): 路面・両脇の石垣・低い壁・灯
    const deckBuf = new Buf(), parapet = new Buf();
    for (const cw of cwList) {
      const sg = Math.sign(cw.to), z0c = cw.from * sg - 3 * sg, z1c = cw.to, hw = cwHalf(cw), steps = Math.round(Math.abs(z1c - z0c) / 6);
      // 路面
      flatMesh(rectPos(-hw, Math.min(z0c, z1c), hw, Math.max(z0c, z1c), 0.21), '#d6ccbd', 0.21);
      flatMesh(rectPos(-1.2, Math.min(z0c, z1c), 1.2, Math.max(z0c, z1c), 0.22), '#ecc4dc', 0.23);
      for (const sd of [-1, 1]) {
        const x = sd * (hw + 0.35), zA = Math.min(z0c, z1c), zB = Math.max(z0c, z1c);
        // 水に面した石垣 (水面の下から路面まで)
        const rcw = cellRect(CELL.PLAIN);
        deckBuf.quad(...(sd > 0 ? [[x, -3, zB], [x, -3, zA], [x, 0.3, zA], [x, 0.3, zB]] : [[x, -3, zA], [x, -3, zB], [x, 0.3, zB], [x, 0.3, zA]]), [sd, 0, 0], [rcw[0], rcw[1], rcw[0] + (rcw[2] - rcw[0]) * Math.min(1, (zB - zA) / 4.5), rcw[1] + (rcw[3] - rcw[1]) * 0.6], stone, [shade, shade, tint(shade, 1.1), tint(shade, 1.1)]);
        // 低い壁 (胸壁) と手すりの柱
        const nb = Math.round((zB - zA) / 1.1);
        for (let b = 0; b < nb; b++) { const zz = zA + (b + 0.5) / nb * (zB - zA); parapet.box(x, 0.72, zz, 0.2, 0.9, 0.18, 0, cream, NOUV, false); }
        parapet.box(x, 1.22, (zA + zB) / 2, 0.42, 0.18, zB - zA, 0, cream); parapet.box(x, 0.34, (zA + zB) / 2, 0.44, 0.34, zB - zA, 0, tint(cream, 0.94));
        const [wx0, wz0] = W(x, zA), [wx1, wz1] = W(x, zB);
        col.line.push([0.35, 1.3, wx0, wz0, y0, wx1, wz1, y0]);
        // 灯 (9 m おき)
        for (let s = 0; s <= steps; s++) {
          const zz = zA + (zB - zA) * (s + 0.5) / (steps + 1);
          parapet.box(x, 1.7, zz, 0.16, 3.0, 0.16, 0, tint(goldC, 0.8)); parapet.box(x, 0.55, zz, 0.4, 0.5, 0.4, 0, tint(cream, 0.92)); parapet.box(x, 3.3, zz, 0.34, 0.14, 0.34, 0, tint(goldC, 0.9)); lamps.push([x, 3.75, zz, (s % 2) ? lampPink : lampCyan, 0.4]);
          const [lx2, lz2] = W(x, zz); col.circle.push([lx2, lz2, 0.3, y0, y0 + 3.5]);
        }
      }
      // 端の門柱
      for (const sd of [-1, 1]) { const zz = z1c - sg * 1.2; parapet.box(sd * (hw + 0.2), 2.0, zz, 1.1, 4.0, 1.1, 0, cream); gold.box(sd * (hw + 0.2), 4.15, zz, 1.3, 0.3, 1.3, 0, goldC); lamps.push([sd * (hw + 0.2), 4.9, zz, lampWarm, 0.6]); }
    }
    const dm = new THREE.Mesh(deckBuf.geometry(), wallMat); dm.receiveShadow = true; api.group.add(dm);
    const pm = new THREE.Mesh(parapet.geometry(), trimMat); pm.castShadow = true; pm.receiveShadow = true; api.group.add(pm);
    // 前庭の花壇・生け垣・円すい形の木
    const hedge = new Buf(), cones = [];
    const hedgeC = C('#3f7a45');
    const bed = (x0, z0, x1, z1) => { hedge.box((x0 + x1) / 2, 0.45, z0, x1 - x0, 0.7, 0.55, 0, hedgeC); hedge.box((x0 + x1) / 2, 0.45, z1, x1 - x0, 0.7, 0.55, 0, hedgeC); hedge.box(x0, 0.45, (z0 + z1) / 2, 0.55, 0.7, z1 - z0, 0, hedgeC); hedge.box(x1, 0.45, (z0 + z1) / 2, 0.55, 0.7, z1 - z0, 0, hedgeC); };
    for (const sd of [-1, 1]) { bed(sd * 9.5, 33.5, sd * 20, 42); bed(sd * 10, 9.5, sd * 20, 20.5); }
    const beds = [[-9.5, 33.5, -20, 42], [9.5, 33.5, 20, 42], [-10, 9.5, -20, 20.5], [10, 9.5, 20, 20.5]];
    const flowerC = ['#ff86b8', '#ffd36b', '#9a7ae6', '#ffffff', '#59c8e6'], fl = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 5, 3), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }), low ? 240 : 600);
    let fi = 0; const d = new THREE.Object3D(), cc = new THREE.Color(), rf = mulberry(5);
    for (const [xa, za, xb, zb] of beds) {
      flatMesh(rectPos(Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb), 0.16), '#6aa24e', 0.16);
      const nx = Math.round(Math.abs(xb - xa) / 0.9), nz = Math.round(Math.abs(zb - za) / 0.9);
      for (let i = 1; i < nx; i++) for (let j = 1; j < nz; j++) { if (fi >= fl.count || rf() < (low ? 0.65 : 0.35)) continue; d.position.set(Math.min(xa, xb) + (i + rf() * 0.5) * 0.9, 0.32, Math.min(za, zb) + (j + rf() * 0.5) * 0.9); d.scale.setScalar(0.7 + rf() * 0.5); d.updateMatrix(); fl.setMatrixAt(fi, d.matrix); fl.setColorAt(fi, cc.set(flowerC[Math.floor(rf() * flowerC.length)])); fi++; }
    }
    fl.count = fi; fl.instanceMatrix.needsUpdate = true; if (fl.instanceColor) fl.instanceColor.needsUpdate = true; api.group.add(fl);
    const hm = new THREE.Mesh(hedge.geometry(), trimMat); hm.castShadow = true; api.group.add(hm);
    // 円すい形の木 (大通りの両側と前庭)
    for (const sd of [-1, 1]) for (const z of [36, 30, 24, 17, 12]) cones.push([sd * 6.2, z, 1.6, 6.5]);
    for (const sd of [-1, 1]) for (const z of [-30, -27]) cones.push([sd * 7, z, 1.3, 5]);
    const cg = new THREE.ConeGeometry(1, 1, low ? 8 : 12).translate(0, 0.5, 0), cm = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: '#2f6b3d', roughness: 0.85 }), cones.length), tg = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 1, 6).translate(0, 0.5, 0), trimMat, cones.length);
    cones.forEach(([x, z, r, h], i) => { d.position.set(x, 0.2 + 0.9, z); d.scale.set(r, h, r); d.rotation.set(0, 0, 0); d.updateMatrix(); cm.setMatrixAt(i, d.matrix); d.position.set(x, 0.1, z); d.scale.set(1, 1.2, 1); d.updateMatrix(); tg.setMatrixAt(i, d.matrix); const [wx, wz] = W(x, z); col.circle.push([wx, wz, 0.5, y0, y0 + h]); });
    cm.castShadow = true; api.group.add(cm, tg);
    // 庭の灯 (大通りの両側)
    for (const sd of [-1, 1]) for (const z of [31.5, 14]) { parapet.box(sd * 4.6, 1.6, z, 0.28, 3.0, 0.28, 0, tint(goldC, 0.95)); lamps.push([sd * 4.6, 3.3, z, lampWarm, 0.42]); }
    // 島の庭 (改善 3): 噴水のある丸い花壇 6 つ (前の芝 2・裏の芝 2・東西の端 2)。石の縁・水・金の噴き口・花の輪。ふち石の輪は砂利色
    {
      const spots = []; for (const sd of [-1, 1]) spots.push([sd * 34, 34], [sd * 36, -31], [sd * 76, -2]);
      const nS = spots.length, rg = mulberry(11), nF = low ? 12 : 34, fxF = new FountainFx();
      const basinG = new THREE.CylinderGeometry(1.9, 2.0, 0.6, low ? 14 : 24).translate(0, 0.3, 0), waterG = new THREE.CircleGeometry(1.7, low ? 14 : 24).rotateX(-Math.PI / 2).translate(0, 0.56, 0);
      const spoutG = new THREE.CylinderGeometry(0.12, 0.3, 1.5, 8).translate(0, 1.1, 0), capG = new THREE.SphereGeometry(0.3, 8, 6).translate(0, 1.95, 0);
      const basinM = new THREE.InstancedMesh(basinG, new THREE.MeshStandardMaterial({ color: '#efe6d6', roughness: 0.6 }), nS), waterM = new THREE.InstancedMesh(waterG, new THREE.MeshStandardMaterial({ color: '#7fcfe6', roughness: 0.08, metalness: 0.1 }), nS);
      const gm2 = new THREE.MeshStandardMaterial({ color: '#d6b25e', roughness: 0.35, metalness: 0.3 }), spoutM = new THREE.InstancedMesh(spoutG, gm2, nS), capM = new THREE.InstancedMesh(capG, gm2, nS);
      const fl2 = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 5, 3), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }), nS * nF);
      const dd = new THREE.Object3D(), cc2 = new THREE.Color(); let fj = 0;
      const fcols = ['#ff86b8', '#ffd36b', '#9a7ae6', '#ffffff', '#59c8e6', '#ff9a7a'];
      spots.forEach(([x, z], i) => {
        flatMesh(fan(ell(7, 7, low ? 20 : 36, x, z), 0.13, [x, z]), '#cfc4b0', 0.13);   // 砂利の輪
        flatMesh(fan(ell(5.1, 5.1, low ? 20 : 36, x, z), 0.15, [x, z]), '#6aa24e', 0.15);   // 芝の輪
        flatMesh(fan(ell(2.6, 2.6, low ? 16 : 28, x, z), 0.17, [x, z]), '#e8dfd2', 0.17);   // 噴水のまわりの石畳
        dd.position.set(x, 0.2, z); dd.scale.set(1, 1, 1); dd.rotation.set(0, 0, 0); dd.updateMatrix();
        [basinM, waterM, spoutM, capM].forEach((m) => m.setMatrixAt(i, dd.matrix));
        for (let k = 0; k < nF; k++) { const a = (k + rg() * 0.8) / nF * TAU, r = 2.9 + rg() * 1.8; dd.position.set(x + Math.cos(a) * r, 0.32, z + Math.sin(a) * r); dd.scale.setScalar(0.7 + rg() * 0.5); dd.updateMatrix(); fl2.setMatrixAt(fj, dd.matrix); fl2.setColorAt(fj, cc2.set(fcols[Math.floor(rg() * fcols.length)])); fj++; }
        for (let k = 0; k < 4; k++) { const a = (k + 0.5) / 4 * TAU + 0.4; lamps.push([x + Math.cos(a) * 6.1, 1.9, z + Math.sin(a) * 6.1, k % 2 ? lampPink : lampCyan, 0.3]); parapet.box(x + Math.cos(a) * 6.1, 0.95, z + Math.sin(a) * 6.1, 0.14, 1.8, 0.14, 0, tint(goldC, 0.9)); }
        fxF.add({ x, z, y0: 2.4, yw: 0.76, R: 1.7, up: 1.3 });
        const [wx, wz] = W(x, z); col.circle.push([wx, wz, 2.0, y0, y0 + 0.9]);
      });
      fxF.build(api.group, { low });   // 6 つの噴水のしぶきと波紋 (fountainfx.js)
      fl2.count = fj; [basinM, waterM, spoutM, capM, fl2].forEach((m) => { m.instanceMatrix.needsUpdate = true; api.group.add(m); });
      if (fl2.instanceColor) fl2.instanceColor.needsUpdate = true;
      basinM.receiveShadow = true;
    }
  }

  // ---------- 堀の小舟と白鳥 (改善 3)。東西の湖面をゆっくりまわる。夜は小舟の灯が光る。PC は 小舟 4・白鳥 6、スマホ (low) は 2・2 ----------
  const craft = [];
  {
    const mergeParts = (parts) => {
      const pos = [], nor = [], colr = [], idx = []; let off = 0;
      for (const [g0, c] of parts) {
        const g = g0.index ? g0 : g0, p = g.attributes.position, n = g.attributes.normal;
        for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); colr.push(c.r, c.g, c.b); }
        if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off); else for (let i = 0; i < p.count; i++) idx.push(i + off);
        off += p.count;
      }
      const r = new THREE.BufferGeometry(); r.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); r.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); r.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); r.setIndex(idx); return r;
    };
    const sph = (rx, ry, rz, x, y, z, seg = 8) => new THREE.SphereGeometry(1, seg, Math.max(4, seg - 2)).scale(rx, ry, rz).translate(x, y, z);
    const white = C('#f7f4ef'), grey = C('#e3dfd8'), beak = C('#f0a24a'), dark = C('#2a2a30');
    // 白鳥 (長さ約 2.3 m): 胴・首 (S 字に 4 つの球)・頭・くちばし・翼・尾
    const swanG = mergeParts([
      [sph(0.42, 0.34, 0.95, 0, 0.36, 0), white], [sph(0.3, 0.2, 0.55, 0.36, 0.55, -0.12), grey], [sph(0.3, 0.2, 0.55, -0.36, 0.55, -0.12), grey],
      [sph(0.2, 0.22, 0.2, 0, 0.66, 0.78), white], [sph(0.15, 0.2, 0.15, 0, 0.9, 0.9), white], [sph(0.13, 0.2, 0.13, 0, 1.15, 0.86), white], [sph(0.13, 0.16, 0.13, 0, 1.36, 0.92), white],
      [sph(0.12, 0.11, 0.18, 0, 1.38, 1.1), white], [sph(0.06, 0.05, 0.13, 0, 1.36, 1.26, 6), beak], [sph(0.04, 0.04, 0.04, 0.06, 1.42, 1.15, 5), dark], [sph(0.04, 0.04, 0.04, -0.06, 1.42, 1.15, 5), dark],
      [sph(0.16, 0.12, 0.3, 0, 0.5, -0.95, 6), white],
    ]);
    const swanM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, emissive: '#ffffff', emissiveIntensity: 0.0 });
    swanM.userData.glow = 0.1; emissive.push(swanM);   // 夜はほんのり白く (灯りが当たっているように)
    // 小舟 (長さ約 4.4 m): 先がとがった船体・内側・座板・舳先の灯の柱
    const hullShape = new THREE.Shape(); hullShape.moveTo(0, -2.2); hullShape.bezierCurveTo(1.0, -1.6, 1.0, 1.0, 0, 2.2); hullShape.bezierCurveTo(-1.0, 1.0, -1.0, -1.6, 0, -2.2);
    const hull = new THREE.ExtrudeGeometry(hullShape, { depth: 0.55, bevelEnabled: false, curveSegments: 10 }); hull.rotateX(-Math.PI / 2); hull.translate(0, -0.2, 0);
    const inner = new THREE.ExtrudeGeometry(hullShape, { depth: 0.1, bevelEnabled: false, curveSegments: 10 }); inner.scale(0.82, 0.86, 1); inner.rotateX(-Math.PI / 2); inner.translate(0, 0.28, 0);
    const boatColors = ['#ff9ccf', '#8fe8c8', '#c3a6ff', '#ffd36b'];
    const mkBoat = (hc) => mergeParts([
      [hull, C(hc)], [inner, C('#f5ead6')], [new THREE.BoxGeometry(1.6, 0.08, 0.35).translate(0, 0.45, -0.3), C('#b98a58')], [new THREE.BoxGeometry(1.5, 0.08, 0.35).translate(0, 0.45, 0.7), C('#b98a58')],
      [new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6).translate(0, 1.0, 1.8), C('#d6b25e')], [new THREE.BoxGeometry(1.0, 0.04, 0.04).translate(0, 1.7, 1.8), C('#d6b25e')],
    ]);
    const boatM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
    const lampBall = new THREE.SphereGeometry(0.2, 8, 6);
    const lagoon = (sd) => ({ boats: [[sd * 132, 4, 30, 18, 0.045, 0.0], [sd * 124, -8, 17, 9, -0.06, 2.1], ...(low ? [] : [[sd * 150, 22, 16, 8, 0.05, 4.0], [sd * 108, 14, 10, 6, -0.055, 1.0]]) ].slice(0, low ? 1 : 2 + (sd > 0 ? 0 : 0)),
      swans: [[sd * 140, 14, 22, 12, 0.032, 0.0], [sd * 140, 14, 22, 12, 0.032, 0.35], ...(low ? [] : [[sd * 140, 14, 22, 12, 0.032, 0.62]])].slice(0, low ? 1 : 3) });
    let bi = 0;
    for (const sd of [-1, 1]) {
      const Lg = lagoon(sd);
      Lg.boats.forEach(([cx, cz, ax, az, w, ph]) => {
        const m = new THREE.Mesh(mkBoat(boatColors[bi % 4]), boatM); m.frustumCulled = false;
        const lamp = new THREE.Mesh(lampBall, lampWarm); lamp.position.set(0, 1.65, 1.8); m.add(lamp);
        const lamp2 = new THREE.Mesh(lampBall, lampPink); lamp2.scale.setScalar(0.8); lamp2.position.set(0, 1.0, -1.9); m.add(lamp2);
        api.group.add(m); craft.push({ m, cx, cz, ax, az, w, ph: ph + bi, k: 0.045, bob: bi }); bi++;
      });
      Lg.swans.forEach(([cx, cz, ax, az, w, ph]) => {
        const m = new THREE.Mesh(swanG, swanM); m.scale.setScalar(1.5); m.frustumCulled = false;
        api.group.add(m); craft.push({ m, cx, cz, ax, az, w: w * (sd > 0 ? 1 : -1), ph: ph * TAU + (sd > 0 ? 0 : 1.7), k: 0.02, bob: bi++ });
      });
    }
    api.craft = craft; api.stats.craft = craft.length;
  }

  // ---------- 形を仕上げる ----------
  const hallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, emissive: '#ffffff', emissiveIntensity: 0.34 });   // 大広間: 自分の色で一定に光る (夜も同じ)
  hallMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= diffuseColor.rgb;'); };
  const geoms = { wall: wall.geometry(), roof: roof.geometry(), trim: trim.geometry(), gold: gold.geometry(), hall: hall.geometry() };
  const meshes = [[geoms.wall, wallMat], [geoms.roof, roofMat], [geoms.trim, trimMat], [geoms.gold, goldMat], [geoms.hall, hallMat]].map(([g, m]) => { const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true; api.group.add(mesh); return mesh; });
  // ---------- 水面への映り込み (PC だけ。`?noreflect` で無効) ----------
  // 城の壁・屋根・飾りを水面で上下反転した複製を、半透明で描く。複製は水面の下にあるので、そのままでは湖の底に隠れる。
  // そこで画素ごとに「その画素の視線が水面と交わる点」の深さを書き込み (gl_FragDepth)、島・堤道・岸に隠れる所は隠し、水面が見える所だけに映す。
  const reflect = !low && !(typeof location !== 'undefined' && /[?&]noreflect/.test(location.search));
  if (reflect) {
    const uVP = { value: new THREE.Matrix4() }, uT = { value: 0 }, uWY = { value: 0 };
    const wyW = y0 + wy;   // 水面の高さ (ワールド)
    uWY.value = wyW;
    const mk = (base, selfLit) => {
      const m = base.clone();
      m.transparent = true; m.opacity = 1; m.depthWrite = false; m.side = THREE.DoubleSide; m.polygonOffset = false;
      m.userData = Object.assign({}, base.userData);
      if (base.userData.glow) emissive.push(m);
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uVP = uVP; sh.uniforms.uT = uT; sh.uniforms.uWY = uWY;
        sh.vertexShader = sh.vertexShader.replace('void main() {', 'uniform float uT; uniform float uWY; varying vec3 vMW;\nvoid main() {')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.x += 0.45 * sin(transformed.y * 0.35 + uT * 1.3 + transformed.z * 0.2); transformed.z += 0.3 * sin(transformed.y * 0.4 - uT * 1.1 + transformed.x * 0.25);')
          .replace('#include <project_vertex>', '#include <project_vertex>\n vMW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform mat4 uVP; uniform float uWY; varying vec3 vMW;\nvoid main() {')
          .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n float hAbove = clamp((uWY - vMW.y) / 70.0, 0.0, 1.0); diffuseColor.a *= mix(0.5, 0.12, hAbove);')
          .replace(/(#include <dithering_fragment>)/, '$1\n { vec3 cp = cameraPosition; vec3 dd = vMW - cp; float tt = (uWY - cp.y) / dd.y; vec4 cc = uVP * vec4(cp + dd * tt, 1.0); gl_FragDepth = cc.z / cc.w * 0.5 + 0.5; }');
        if (selfLit) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= diffuseColor.rgb;');
      };
      return m;
    };
    const mirror = new THREE.Group(); mirror.name = 'castle_reflection';
    [[geoms.wall, wallMat, false], [geoms.roof, roofMat, true], [geoms.trim, trimMat, false], [geoms.gold, goldMat, false]].forEach(([g, m, sl]) => {
      const mm = new THREE.Mesh(g, mk(m, sl)); mm.renderOrder = -1; mm.frustumCulled = false;
      mm.onBeforeRender = (r, sc, cam) => { uVP.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); };
      mirror.add(mm);
    });
    mirror.position.y = 2 * wy; mirror.scale.y = -1;
    api.group.add(mirror);
    api.mirror = mirror; api.mirrorT = uT;
  }
  api.stats.tris = Math.round(wall.tris + roof.tris + trim.tris + gold.tris + hall.tris);
  api.stats.top = Math.round(keepTop + 0) + (Cf.reel.y - 4) * 0;
  api.stats.towers = towerList.length;
  // 旗 (そよ風でゆれる。近いときだけ更新)
  const flagMesh = (() => {
    const SEG = 6, g = new THREE.BufferGeometry(), n = flags.length, pos = new Float32Array(n * SEG * 2 * 3 * 3), cl = new Float32Array(n * SEG * 2 * 3 * 3), nor = new Float32Array(n * SEG * 2 * 3 * 3);
    for (let i = 0; i < n; i++) { const c = C(Cs[flags[i].color] || flags[i].color); for (let k = 0; k < SEG * 6; k++) { const o = (i * SEG * 6 + k) * 3; cl[o] = c.r; cl[o + 1] = c.g; cl[o + 2] = c.b; nor[o + 2] = 1; } }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(cl, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide })); m.frustumCulled = false; api.group.add(m);
    const fill = (t) => {
      for (let i = 0; i < n; i++) {
        const f = flags[i];
        for (let s = 0; s < SEG; s++) {
          const u0 = s / SEG, u1 = (s + 1) / SEG, w0 = f.h * (1 - u0 * 0.85) * 0.5, w1 = f.h * (1 - u1 * 0.85) * 0.5;
          const z0 = Math.sin(t * 3 + f.ph + u0 * 5) * 0.55 * u0 * f.len * 0.2, z1 = Math.sin(t * 3 + f.ph + u1 * 5) * 0.55 * u1 * f.len * 0.2;
          const p = [[f.x + f.len * u0, f.y + w0, f.z + z0], [f.x + f.len * u0, f.y - w0, f.z + z0], [f.x + f.len * u1, f.y + w1, f.z + z1], [f.x + f.len * u1, f.y - w1, f.z + z1]];
          const o = (i * SEG + s) * 18;
          [p[0], p[1], p[2], p[1], p[3], p[2]].forEach((q, j) => { pos[o + j * 3] = q[0]; pos[o + j * 3 + 1] = q[1]; pos[o + j * 3 + 2] = q[2]; });
        }
      }
      g.attributes.position.needsUpdate = true;
    };
    fill(0);
    return { fill };
  })();

  // ---------- 夜の光線・映写のライトアップ ----------
  const beamMat = new THREE.MeshBasicMaterial({ color: '#c9ecff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  beamMat.userData.glow = 0.1; beamMat.userData.opacityOnly = true; emissive.push(beamMat);
  const beams = new THREE.Group();
  {
    const bg = new THREE.ConeGeometry(3.6, 140, 14, 1, true).translate(0, -70, 0).rotateX(-Math.PI / 2);
    spires.forEach(([x, y, z], i) => { const yawG = new THREE.Group(); yawG.position.set(x, y, z); yawG.userData.ph = i * 0.9; const pitch = new THREE.Group(); pitch.rotation.x = -0.7; pitch.add(new THREE.Mesh(bg, beamMat)); yawG.add(pitch); beams.add(yawG); });
    api.group.add(beams);
  }
  const screenMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uAmt: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uAmt;
      vec3 pal(float t){ return 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + t)); }
      float hash(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
      void main(){
        float fx = vUv.x * 5.0 + uTime * 0.7, id = floor(fx), f = fract(fx);
        float edge = smoothstep(0.0, 0.05, f) * smoothstep(1.0, 0.95, f);
        float h = hash(id);
        float sw = 0.5 + 0.5 * sin(vUv.y * 9.0 + f * 3.0 + uTime * 2.2 + h * 6.0);
        float blob = smoothstep(0.35, 0.0, length(vec2(f - 0.5, vUv.y - 0.5 - 0.25 * sin(uTime * 1.3 + h * 6.0))));
        vec3 c = pal(h + uTime * 0.04 + vUv.y * 0.25) * (0.18 + 0.5 * sw) + vec3(1.0, 0.95, 0.8) * blob * 0.55;
        float sprock = step(0.12, fract(vUv.x * 40.0)) * 0.0 + 1.0;
        float hole = (vUv.y < 0.08 || vUv.y > 0.92) ? step(0.55, fract(vUv.x * 30.0)) * 0.0 : 1.0;
        gl_FragColor = vec4(c * edge * sprock * hole * uAmt, 1.0);
      }`,
  });
  {   // 映写の壁 (夜のショーの間だけ光る光の幕): 主塔の中段の前面と、前の門塔の左右の壁
    const keep = Cf.towers[0], t2 = keep.tiers[1], y2 = keep.tiers[0].fl * keep.tiers[0].fh + 0.3, h2 = t2.fl * t2.fh;
    const g = new THREE.CylinderGeometry((t2.r1 || t2.r) + 0.14, t2.r + 0.14, h2, low ? 12 : 28, 1, true, -1.0, 2.0), m = new THREE.Mesh(g, screenMat);
    m.position.set(keep.x, y2 + h2 / 2, keep.z); m.renderOrder = 6; m.frustumCulled = false; api.group.add(m);
    const gt = Cf.gates[0];
    for (const sd of [-1, 1]) {
      const x0 = gt.hw + 2.6, x1 = gt.w - 0.5, pg = new THREE.PlaneGeometry(x1 - x0, gt.h - 4.2), pm = new THREE.Mesh(pg, screenMat);
      pm.position.set(sd * (x0 + x1) / 2, 3.2 + (gt.h - 4.2) / 2, gt.z1 + 0.12); pm.renderOrder = 6; pm.frustumCulled = false; api.group.add(pm);
    }
  }

  // ---------- 毎コマの更新 ----------
  const winAmtOf = (win) => Math.max(0, Math.min(1, (win - 0.15) / 0.5));
  api.update = (now, x, z, win, cyc) => {
    const d2 = (x - F.cx) ** 2 + (z - F.cz) ** 2;
    // 冠の回転 (遠くでも見えるので、1.5 km 以内は常に)
    if (d2 > 1500 * 1500) return;
    crown.rotation.y = now * 0.052;
    if (api.mirrorT) api.mirrorT.value = now;
    if (d2 < 1200 * 1200) for (const c of craft) {
      const a = now * c.w + c.ph, x = c.cx + c.ax * Math.cos(a), z = c.cz + c.az * Math.sin(a), dx = -c.ax * Math.sin(a) * c.w, dz = c.az * Math.cos(a) * c.w;
      c.m.position.set(x, wy + 0.02 + 0.04 * Math.sin(now * 1.3 + c.bob), z);
      c.m.rotation.set(0.03 * Math.sin(now * 0.9 + c.bob), Math.atan2(dx, dz), 0.04 * Math.sin(now * 1.1 + c.bob * 2), 'YXZ');
    }
    wheels.forEach((w, i) => { w.wheel.rotation.z = now * w.rate * w.dir + i; });
    // 電球のまたたき (夜)
    const sh = api.showAmt(cyc);
    const rate = 1.6 + 5 * sh;
    api.bulbs.forEach((b) => { b.mat.userData.glow = 0.9 + 0.9 * Math.max(0, Math.sin(now * rate - b.k * 0.35 - b.w * 1.1)); });
    if (d2 < 900 * 900) flagMesh.fill(now);
    beams.children.forEach((g) => { g.rotation.y = now * 0.28 + g.userData.ph; });
    screenMat.uniforms.uTime.value = now; screenMat.uniforms.uAmt.value = sh * winAmtOf(win) * 1.5;
  };
  // 映写のライトアップの強さ (0〜1。始まりと終わりはなだらか)
  api.showAmt = (cyc) => {
    const S = Cf.show; if (!S || cyc === undefined) return 0;
    const t = cyc - S.start, d = S.duration; if (t < -2 || t > d + 2) return 0;
    return Math.min(1, Math.max(0, Math.min(t + 2, d + 2 - t)) / 3);
  };
  api.frame = F;
  api.maxTop = maxTop;
  return api;
}
