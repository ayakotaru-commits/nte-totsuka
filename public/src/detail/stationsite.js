// 延ばした先の駅の駅舎と駅前 (rail_ext の stations[].site。舞浜駅の、高架の下の改札と北口)。
// 配置は data/rail_ext_config.json の site (tools/rail_ext.py が駅の向きの座標 frame と地面の高さを足して index.json に入れる)。
// 座標は駅の向き: s = ホームの中心線の向き (m)、t = 進む向きの左 (m)、原点はホームの中央。高さ: G = 地面、F = 改札の階、PY = ホームの上面。
// 作るもの: 高架の下の改札の中 (床・壁・天井・照明・柱)、ホームへの階段 (歩いて上り下りできる) とエスカレーター (見た目だけ)、
// 北口の建物 (改札機・窓口・券売機・案内・駅名の白い帯)、屋根付きのデッキと丸いバルコニー、地上への階段、
// 地上の広場 (車の回る島・タクシーとバスの乗り場・時計塔・街灯・木)、東の低い建物 (1 階に店)。
// 当たり判定は world.addColliders (床は上に乗れる多角形、壁・手すりは線、柱は円)。ホームの床の穴 (階段の口) は railext.js が siteCut で抜く。
import { TreeLayer } from '../trees.js';
import * as THREE from 'three';
import { canvasTexture } from './util.js';

const RUN = 0.3, LANDING = 1.7;   // 階段の踏み面の奥行きと踊り場
const STAIR_W = [-2.3, 0.6], ESC_W = [0.8, 2.25], HOLE_T = 2.45;   // 階段・エスカレーターの幅 (t)、ホームの穴の半幅
const RAIL_H = 1.05;

// 駅の向きの座標 (frame は rail_ext.py の site_frames)
export function siteFrame(st) {
  const f = st.site && st.site.frame;
  if (!f) return null;
  return {
    ...f,
    xz: (s, t) => [f.cx + f.sx * s + f.nx * t, f.cz + f.sz * s + f.nz * t],
    st: (x, z) => [(x - f.cx) * f.sx + (z - f.cz) * f.sz, (x - f.cx) * f.nx + (z - f.cz) * f.nz],
  };
}

// ホームへの階段の段の数と長さ (ホームの上面 PY から改札の階 F まで)
function stairPlan(PY, F) {
  const n = Math.max(8, Math.round((PY - F) / 0.17)), h = (PY - F) / n, half = n >> 1;
  const D = (k) => (k <= half ? (k - 1) * RUN : (half - 1) * RUN + LANDING + (k - half - 1) * RUN);   // 踏み面 k (1..n) の始まり
  const len = (k) => (k === half ? LANDING : RUN);
  return { n, h, D, len, L: D(n) + RUN };
}

// 地図のワープ先 (北口の広場。車の輪の西、デッキからの階段の下の先): { x, y, z, face }
export function siteSpot(st) {
  const fr = siteFrame(st);
  if (!fr) return null;
  const [ps0, , , pt1] = st.site.plaza, [ls, , lr] = st.site.loop;
  const [x, z] = fr.xz((ps0 + ls - lr - 6) / 2 + 2, pt1 - 3);
  return { x, y: fr.gy + 0.12, z, face: Math.atan2(-fr.sx, -fr.sz) };
}

// 地図のワープ先 (南口のロータリー。デッキからの階段の下): { x, y, z, face }
export function siteSpotSouth(st) {
  const fr = siteFrame(st), so = st.site && st.site.south;
  if (!fr || !so) return null;
  const q = so.gstairs[so.gstairs.length - 1], [x, z] = fr.xz(q[0] + q[1] * 12, (q[2] + q[3]) / 2);
  return { x, y: fr.gy + 0.12, z, face: Math.atan2(fr.nx, fr.nz) };
}

// ホームの床の穴 (階段の口): [{ s0, s1, t0, t1, a, d }]
export function siteHoles(st) {
  const f = st.site && st.site.frame;
  if (!f) return [];
  const F = f.gy + st.site.floor, { L } = stairPlan(f.py, F);
  return (st.site.stairs || []).map(([a, d]) => ({ s0: Math.min(a, a + d * L), s1: Math.max(a, a + d * L), t0: -HOLE_T, t1: HOLE_T, a, d }));
}

// ホームの床の四角 (縁の点 l0, r0 → l1, r1) から穴を抜いた残り: 四角の一覧 [[x, z, u] × 4] (u = l0→l1 の割合。高さの補間用)。穴にかからなければ null
export function siteCut(st) {
  const fr = siteFrame(st), holes = siteHoles(st);
  if (!fr || !holes.length) return null;
  return (l0, r0, l1, r1) => {
    const m0 = fr.st((l0[0] + r0[0]) / 2, (l0[1] + r0[1]) / 2)[0], m1 = fr.st((l1[0] + r1[0]) / 2, (l1[1] + r1[1]) / 2)[0];
    const lo = Math.min(m0, m1), hi = Math.max(m0, m1);
    const hit = holes.filter((h) => h.s1 > lo && h.s0 < hi);
    if (!hit.length) return null;
    const uOf = (s) => Math.max(0, Math.min(1, (s - m0) / (m1 - m0)));
    const cuts = [0, 1];
    for (const h of hit) cuts.push(uOf(h.s0), uOf(h.s1));
    cuts.sort((a, b) => a - b);
    const L = (u) => [l0[0] + (l1[0] - l0[0]) * u, l0[1] + (l1[1] - l0[1]) * u], R = (u) => [r0[0] + (r1[0] - r0[0]) * u, r0[1] + (r1[1] - r0[1]) * u];
    const at = (u, t) => {   // 左の縁 → 右の縁の線の上で、t の所
      const a = L(u), b = R(u), ta = fr.st(...a)[1], tb = fr.st(...b)[1], w = Math.max(0, Math.min(1, (ta - t) / (ta - tb)));
      return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, u];
    };
    const out = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const ua = cuts[i], ub = cuts[i + 1];
      if (ub - ua < 1e-4) continue;
      const sm = fr.st(...L((ua + ub) / 2).map((v, j) => (v + R((ua + ub) / 2)[j]) / 2))[0];
      const h = hit.find((q) => sm > q.s0 && sm < q.s1);
      if (!h) { out.push([[...L(ua), ua], [...R(ua), ua], [...R(ub), ub], [...L(ub), ub]]); continue; }
      out.push([[...L(ua), ua], at(ua, h.t1), at(ub, h.t1), [...L(ub), ub]]);   // 穴の左 (北) の帯
      out.push([at(ua, h.t0), [...R(ua), ua], [...R(ub), ub], at(ub, h.t0)]);   // 穴の右 (南) の帯
    }
    return out;
  };
}

// (x, z) がホームの穴 (と縁から pad m) にかかるか (屋根の柱・ベンチ・駅名標を置かない)
export function siteBlocked(st, pad = 1.0) {
  const fr = siteFrame(st), holes = siteHoles(st);
  if (!fr || !holes.length) return () => false;
  return (x, z) => { const [s, t] = fr.st(x, z); return holes.some((h) => s > h.s0 - pad && s < h.s1 + pad && t > h.t0 - pad && t < h.t1 + pad); };
}

// 頂点の色つきの形を組み立てる (面は両面。法線は向きの目安 hint で決める)
class CB {
  constructor() { this.p = []; this.n = []; this.c = []; }
  tri(a, b, c, col, hint) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n) || 1; n = n.map((v) => v / l);
    if (hint && n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { n = n.map((v) => -v); [b, c] = [c, b]; }
    this.p.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) { this.n.push(...n); this.c.push(col.r, col.g, col.b); }
  }
  quad(a, b, c, d, col, hint) { this.tri(a, b, c, col, hint); this.tri(a, c, d, col, hint); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const C = (h) => new THREE.Color(h);
const COL = {
  tile: C('#ece5d6'), tileD: C('#d9cfbd'), band: C('#2f9a5c'), stone: C('#a79f93'), white: C('#f3f2ee'), ceil: C('#eeece6'),
  floor: C('#d6c7ad'), floorD: C('#bfae92'), tactile: C('#e2b733'), salmon: C('#d6ab92'), glass: C('#9fb8bf'), dark: C('#4a4640'),
  steel: C('#b7bbbf'), black: C('#26282b'), green: C('#2f9a5c'), step: C('#8f8b84'), nose: C('#d4b34a'), asphalt: C('#5b5d60'),
  pave: C('#b8a58c'), paveD: C('#a38f76'), curb: C('#c9c5bc'), grass: C('#6f8a4e'), wing: C('#e6dfd0'), awning: C('#2e5a45'),
  shop: C('#6f8790'), lamp: C('#fff6dc'), post: C('#8e8a82'), lattice: C('#4b463f'), taxi: C('#1d2023'), roofL: C('#f2f2ea'),
};

export function buildStationSite(st, world) {
  const site = st.site, fr = siteFrame(st);
  const g = new THREE.Group();
  g.name = 'ext_station_site_' + st.name;
  if (!fr) return g;
  const G = fr.gy, F = G + site.floor, PY = fr.py, CEIL = PY - 2.8, HALL_C = F + 3.6;
  const S = new CB(), IN = new CB(), GL = new CB();   // 外 (日の光)・中 (照明)・ガラス
  const col = { poly: [], line: [], circle: [] };
  const P = (s, t, y) => { const [x, z] = fr.xz(s, t); return [x, y, z]; };
  const SD = [fr.sx, 0, fr.sz], TD = [fr.nx, 0, fr.nz], UP = [0, 1, 0], DN = [0, -1, 0], neg = (v) => v.map((q) => -q);
  const ring = (s0, s1, t0, t1) => [fr.xz(s0, t0), fr.xz(s1, t0), fr.xz(s1, t1), fr.xz(s0, t1)];
  // 箱 (s, t の向きにそろった直方体)。faces: 省く面の名前 (例 'b' = 底)
  const box = (B, s0, s1, t0, t1, y0, y1, c, skip = '', cTop = c) => {
    if (!skip.includes('u')) B.quad(P(s0, t0, y1), P(s1, t0, y1), P(s1, t1, y1), P(s0, t1, y1), cTop, UP);
    if (!skip.includes('b')) B.quad(P(s0, t0, y0), P(s1, t0, y0), P(s1, t1, y0), P(s0, t1, y0), c, DN);
    if (!skip.includes('s')) B.quad(P(s0, t0, y0), P(s0, t1, y0), P(s0, t1, y1), P(s0, t0, y1), c, neg(SD));
    if (!skip.includes('S')) B.quad(P(s1, t0, y0), P(s1, t1, y0), P(s1, t1, y1), P(s1, t0, y1), c, SD);
    if (!skip.includes('t')) B.quad(P(s0, t0, y0), P(s1, t0, y0), P(s1, t0, y1), P(s0, t0, y1), c, neg(TD));
    if (!skip.includes('T')) B.quad(P(s0, t1, y0), P(s1, t1, y0), P(s1, t1, y1), P(s0, t1, y1), c, TD);
  };
  const hq = (B, s0, s1, t0, t1, y, c, down = false) => B.quad(P(s0, t0, y), P(s1, t0, y), P(s1, t1, y), P(s0, t1, y), c, down ? DN : UP);
  // 縦の壁 (線 (s0, t0)-(s1, t1)、厚さなし)。内側用の色の帯 (腰の石・緑の線・タイル)
  const wallBands = (B, s0, t0, s1, t1, y0, y1, hint) => {
    const q = (a, b, c) => { if (b > a) B.quad(P(s0, t0, a), P(s1, t1, a), P(s1, t1, b), P(s0, t0, b), c, hint); };
    const m = Math.min(y1, y0 + 0.9);
    q(y0, m, COL.stone); q(m, Math.min(y1, m + 0.12), COL.band); q(Math.min(y1, m + 0.12), y1, COL.tile);
  };
  const cyl = (B, s, t, r, y0, y1, c, seg = 10) => {
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const p0 = [s + Math.cos(a0) * r, t + Math.sin(a0) * r], p1 = [s + Math.cos(a1) * r, t + Math.sin(a1) * r], am = (a0 + a1) / 2;
      const hint = [fr.sx * Math.cos(am) + fr.nx * Math.sin(am), 0, fr.sz * Math.cos(am) + fr.nz * Math.sin(am)];
      B.quad(P(...p0, y0), P(...p1, y0), P(...p1, y1), P(...p0, y1), c, hint);
    }
  };
  const disk = (B, s, t, r, y, c, a0 = 0, a1 = Math.PI * 2, seg = 24) => {
    for (let i = 0; i < seg; i++) {
      const u0 = a0 + (a1 - a0) * i / seg, u1 = a0 + (a1 - a0) * (i + 1) / seg;
      B.tri(P(s, t, y), P(s + Math.cos(u0) * r, t + Math.sin(u0) * r, y), P(s + Math.cos(u1) * r, t + Math.sin(u1) * r, y), c, UP);
    }
  };
  // 当たり判定
  const solid = (s0, s1, t0, t1, y0, y1) => col.poly.push([ring(s0, s1, t0, t1), y0, y1]);
  const wallC = (s0, t0, s1, t1, y0, h, hw = 0.12) => { const [x0, z0] = fr.xz(s0, t0), [x1, z1] = fr.xz(s1, t1); col.line.push([hw, h, x0, z0, y0, x1, z1, y0]); };
  const postC = (s, t, r, y0, y1) => { const [x, z] = fr.xz(s, t); col.circle.push([x, z, r, y0, y1]); };
  // 文字の板 (t の向き +1 / -1 の面に向けて)。中心 (s, t, y)、幅 w、高さ h
  const signs = [];
  const sign = (draw, cw, ch, s, t, y, w, h, face = 1, along = false, lit = false) => {
    const tex = canvasTexture(cw, ch, draw);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lit ? new THREE.MeshBasicMaterial({ map: tex }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    const [x, z] = fr.xz(s, t);
    m.position.set(x, y, z);
    const dir = along ? [fr.sx * face, fr.sz * face] : [fr.nx * face, fr.nz * face];
    m.rotation.y = Math.atan2(dir[0], dir[1]);
    m.name = 'ext_site_sign';
    signs.push(m);
    return m;
  };
  const text = (lines, bg, fg, cw = 512, ch = 128) => (c, w, h) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
    lines.forEach(([str, size, y, color, x = w / 2, align = 'center']) => { c.font = `bold ${size}px sans-serif`; c.fillStyle = color || fg; c.textAlign = align; c.fillText(str, x, y); });
  };

  // ================= 高架の下の改札の中 (concourse) =================
  const [cs0, cs1, ct0, ct1] = site.concourse, [hs0, hs1, ht0, ht1] = site.hall;
  const holes = siteHoles(st);
  // 1 階の部分 (地面 → 改札の階の床): 外から見ると壁。当たり判定も中身の詰まった箱
  box(S, cs0, cs1, ct0, ct1, G - 0.5, F, COL.tileD, 'u');
  box(S, hs0, hs1, ht0, ht1, G - 0.5, F, COL.tileD, 'u');
  solid(cs0, cs1, ct0, ct1, G - 1, F); solid(hs0, hs1, ht0, ht1, G - 1, F);
  // 1 階の外壁の目地 (柱の割り付け) と腰の石
  for (const [t, hint] of [[ct0, neg(TD)], [ct1, TD]]) {
    for (let s = cs0; s < cs1; s += 8) {
      const e = Math.min(cs1, s + 8), tt = t + (t < 0 ? -0.02 : 0.02);
      if (t > 0 && s >= hs0 - 8 && e > hs0) continue;
      S.quad(P(s, tt, G), P(s + 0.6, tt, G), P(s + 0.6, tt, F - 0.4), P(s, tt, F - 0.4), COL.stone, hint);
      S.quad(P(s + 0.6, tt, G), P(e, tt, G), P(e, tt, G + 0.6), P(s + 0.6, tt, G + 0.6), COL.stone, hint);
    }
  }
  // 床 (タイル。点字ブロックの線)
  const floorRects = [[cs0, cs1, ct0, ct1], [hs0, hs1, ht0, ht1]];
  for (const [s0, s1, t0, t1] of floorRects) hq(IN, s0, s1, t0, t1, F + 0.005, COL.floor);
  hq(IN, cs0 + 2, cs1 - 2, 3.0, 3.3, F + 0.015, COL.tactile);
  hq(IN, cs0 + 2, cs1 - 2, -3.3, -3.0, F + 0.015, COL.tactile);
  // 壁: 南 (t0) の全体、西・東の端、北 (t1) の北口の建物より西
  const SO = site.south;   // 南口 (あれば南の壁に開きを作る)
  const southWall = SO ? [[cs0, ct0, SO.open[0], ct0, TD], [SO.open[1], ct0, cs1, ct0, TD]] : [[cs0, ct0, cs1, ct0, TD]];
  const walls = [...southWall, [cs0, ct0, cs0, ct1, SD], [cs1, ct0, cs1, ht0, neg(SD)], [cs0, ct1, hs0, ct1, neg(TD)]];
  for (const [s0, t0, s1, t1, hint] of walls) {
    wallBands(IN, s0, t0, s1, t1, F, CEIL, hint);
    S.quad(P(s0, t0, F), P(s1, t1, F), P(s1, t1, PY - 2.75), P(s0, t0, PY - 2.75), COL.tile, neg(hint));   // 外の面
    wallC(s0, t0, s1, t1, F, CEIL - F + 0.5, 0.15);
  }
  // 天井 (階段の口を抜く) と照明
  const ceilRects = [];
  {
    const cuts = [cs0, cs1, ...holes.flatMap((h) => [h.s0, h.s1])].sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i], b = cuts[i + 1];
      if (b - a < 0.01) continue;
      const h = holes.find((q) => (a + b) / 2 > q.s0 && (a + b) / 2 < q.s1);
      if (h) { ceilRects.push([a, b, ct0, h.t0], [a, b, h.t1, ct1]); } else ceilRects.push([a, b, ct0, ct1]);
    }
  }
  const CEILM = new CB();
  for (const r of ceilRects) { hq(CEILM, ...r, CEIL, COL.ceil, true); hq(S, ...r, CEIL + 0.02, COL.tileD); }
  const lamps = [];
  for (let s = cs0 + 3; s < cs1 - 2; s += 6) for (const t of [-7.5, 7.5, -4.2, 4.2]) {
    if (holes.some((h) => s > h.s0 - 1 && s < h.s1 + 1 && Math.abs(t) < 5)) continue;
    lamps.push([s, t, CEIL - 0.03, 2.2, 0.35]);
  }
  // 柱 (高架を支える。丸い柱、薄いサーモン色)
  for (let s = cs0 + 6; s < cs1 - 3; s += 12) for (const t of [-7.6, 7.6]) {
    cyl(IN, s, t, 0.45, F, CEIL, COL.salmon, 14);
    postC(s, t, 0.45, F, CEIL);
  }
  // 案内の板 (階段の下ごとに「ホーム」)
  for (const h of holes) {
    const sb = h.a + h.d * (h.s1 - h.s0);   // 階段の下の端
    sign(text([['京葉線 ホーム', 44, 46, '#fff'], ['東京・蘇我 方面 ↑', 34, 98, '#ffd84a']], '#1d2a3a', '#fff'), 512, 128, sb + h.d * 1.2, -0.85, F + 2.6, 2.4, 0.6, 1, true, true).rotation.y += h.d < 0 ? 0 : Math.PI;
  }

  // ================= ホームへの階段 (4 か所) =================
  const plan = stairPlan(PY, F);
  for (const h of holes) {
    const { a, d } = h;
    const sAt = (D) => a + d * D;
    for (let k = 1; k <= plan.n; k++) {
      const y = PY - k * plan.h, A = sAt(plan.D(k)), B = sAt(plan.D(k) + plan.len(k)), s0 = Math.min(A, B), s1 = Math.max(A, B);
      box(IN, s0, s1, STAIR_W[0], STAIR_W[1], F, y, COL.step, 'b', COL.tileD);
      hq(IN, d > 0 ? s0 : s1 - 0.06, d > 0 ? s0 + 0.06 : s1, STAIR_W[0], STAIR_W[1], y + 0.004, COL.nose);
      solid(s0, s1, STAIR_W[0], STAIR_W[1], y - 0.3, y);
    }
    // エスカレーター (見た目だけ): 斜めの面と、両側のガラスの手すり
    const e0 = sAt(0), e1 = sAt(plan.L);
    IN.quad(P(e0, ESC_W[0], PY), P(e0, ESC_W[1], PY), P(e1, ESC_W[1], F), P(e1, ESC_W[0], F), COL.dark, UP);
    for (const t of ESC_W) {
      GL.quad(P(e0, t, PY), P(e1, t, F), P(e1, t, F + 1.0), P(e0, t, PY + 1.0), COL.glass, TD);
      IN.quad(P(e0, t, PY + 0.95), P(e1, t, F + 0.95), P(e1, t, F + 1.05), P(e0, t, PY + 1.05), COL.black, UP);
    }
    // 囲いの壁: 両側 (改札の階 → ホームの上の手すりの高さ)、上の端の下 (改札の階)、ホームの上の下の端 (手すり)
    const sMin = Math.min(e0, e1), sMax = Math.max(e0, e1);
    for (const [t, hint] of [[-HOLE_T + 0.1, neg(TD)], [HOLE_T - 0.1, TD]]) {
      wallBands(IN, sMin, t, sMax, t, F, PY - 0.3, hint);
      wallBands(IN, sMin, t, sMax, t, F, PY - 0.3, neg(hint));
      GL.quad(P(sMin, t, PY), P(sMax, t, PY), P(sMax, t, PY + RAIL_H), P(sMin, t, PY + RAIL_H), COL.glass, hint);
      IN.quad(P(sMin, t, PY + RAIL_H - 0.06), P(sMax, t, PY + RAIL_H - 0.06), P(sMax, t, PY + RAIL_H), P(sMin, t, PY + RAIL_H), COL.steel, UP);
      wallC(sMin, t, sMax, t, F, PY - F + RAIL_H, 0.1);
    }
    wallBands(IN, e0, -HOLE_T, e0, HOLE_T, F, PY - 0.3, d > 0 ? neg(SD) : SD);
    wallC(e0, -HOLE_T, e0, HOLE_T, F, PY - 0.4 - F, 0.1);
    GL.quad(P(e1, -HOLE_T, PY), P(e1, HOLE_T, PY), P(e1, HOLE_T, PY + RAIL_H), P(e1, -HOLE_T, PY + RAIL_H), COL.glass, d > 0 ? SD : neg(SD));
    wallC(e1, -HOLE_T, e1, HOLE_T, PY, RAIL_H, 0.1);
    // 階段とエスカレーターの仕切り (通れない)、エスカレーターの上下の口
    wallC(e0, STAIR_W[1] + 0.1, e1, STAIR_W[1] + 0.1, F, PY - F + RAIL_H, 0.08);
    wallC(e0, ESC_W[0], e0, ESC_W[1], PY, RAIL_H, 0.15);
    wallC(e1, ESC_W[0], e1, ESC_W[1], F, RAIL_H, 0.15);
    // 階段の真ん中の手すり
    IN.quad(P(e0, -0.85, PY + 0.85), P(e1, -0.85, F + 0.85), P(e1, -0.85, F + 0.9), P(e0, -0.85, PY + 0.9), COL.steel, TD);
  }

  // ================= 北口の建物 (hall) =================
  const [gs0, gs1, gt] = site.gates, [os0, os1, ot0, ot1] = site.office;
  // 2 階の上の部分 (改札の階の天井 → ホームの 1 m 下。北の面は白い帯に駅名)。屋上は灰色で、縁に低い立ち上がり
  const HTOP = PY - 1.0;
  box(S, hs0, hs1, ht0 + 1.5, ht1, HALL_C, HTOP, COL.white, '', COL.tileD);
  box(S, hs0, hs1, ht1 - 0.3, ht1, HTOP, HTOP + 0.6, COL.white, 'b');
  hq(IN, hs0, hs1, ht0, ht1, HALL_C - 0.01, COL.ceil, true);
  for (let s = hs0 + 3; s < hs1 - 2; s += 5) for (const t of [ht0 + 3, (ht0 + ht1) / 2 + 1, ht1 - 2.5]) lamps.push([s, t, HALL_C - 0.04, 1.8, 0.5]);
  sign(text([['JR', 70, 64, '#2f9a5c', 70], ['舞浜駅', 76, 64, '#3a3a3a', 300], ['Maihama Station', 40, 66, '#3a3a3a', 640, 'left']], '#f6f6f2', '#333', 1024, 128),
    1024, 128, hs0 + 17, ht1 + 0.03, (HALL_C + HTOP) / 2 + 0.3, 16, 2.0, 1, false, true);
  // 壁 (北口の建物の改札の階): 西 (バルコニーへの口を残す)、東、北 (デッキへの口)
  const [bs, bt, br] = site.balcony;
  const hallWalls = [[hs0, ht0, hs0, bt - br * 0.85, SD], [hs1, ht0, hs1, ht1, neg(SD)], [hs0, ht1, gs0 - 6, ht1, neg(TD)], [os1 - 10, ht1, hs1, ht1, neg(TD)]];
  for (const [s0, t0, s1, t1, hint] of hallWalls) {
    wallBands(IN, s0, t0, s1, t1, F, HALL_C, hint);
    S.quad(P(s0, t0, F), P(s1, t1, F), P(s1, t1, HALL_C), P(s0, t0, HALL_C), COL.tile, neg(hint));
    wallC(s0, t0, s1, t1, F, HALL_C - F, 0.15);
  }
  // 北の口の上のはり (白)
  box(S, gs0 - 6, os1 - 10, ht1 - 0.3, ht1, HALL_C - 0.6, HALL_C, COL.white);
  // 改札の中と外の仕切り (ガラス)、改札機
  for (const [s0, s1] of [[hs0, gs0], [gs1, os0]]) {
    GL.quad(P(s0, gt, F), P(s1, gt, F), P(s1, gt, F + 2.1), P(s0, gt, F + 2.1), COL.glass, TD);
    box(IN, s0, s1, gt - 0.05, gt + 0.05, F, F + 0.25, COL.steel);
    wallC(s0, gt, s1, gt, F, 2.1, 0.08);
  }
  const NG = Math.round((gs1 - gs0) / 0.95);
  for (let i = 0; i <= NG; i++) {
    const s = gs0 + (gs1 - gs0) * i / NG, w = 0.16;
    box(IN, s - w, s + w, gt - 0.9, gt + 0.9, F, F + 1.0, COL.steel, 'b', COL.black);
    box(IN, s - w - 0.01, s + w + 0.01, gt - 0.2, gt + 0.2, F + 0.55, F + 0.8, COL.green, 'b');
    col.poly.push([ring(s - w, s + w, gt - 0.9, gt + 0.9), F, F + 1.0]);
  }
  // 改札の上の案内 (緑の「北口」) と発車案内
  sign(text([['JR', 54, 64, '#fff', 60], ['舞浜駅  北口', 58, 50, '#fff', 300], ['Maihama Station  North Exit', 26, 100, '#fff', 300]], '#2f9a5c', '#fff', 640, 128),
    640, 128, (gs0 + gs1) / 2, gt + 0.3, F + 2.75, 3.4, 0.68, 1, false, true);
  sign(text([['京葉線 発車案内', 30, 26, '#fff'], ['普通 蘇我      ', 30, 70, '#ffa040'], ['快速 東京      ', 30, 108, '#ffa040']], '#111', '#fff', 512, 128),
    512, 128, (gs0 + gs1) / 2, gt - 0.3, F + 2.75, 2.4, 0.6, -1, false, true);
  // 窓口と券売機
  box(IN, os0, os1, ot0, ot1, F, HALL_C, COL.tile, 'b');
  solid(os0, os1, ot0, ot1, F - 0.5, HALL_C);
  GL.quad(P(os0 - 0.01, ot0 + 1, F + 1.0), P(os0 - 0.01, ot1 - 1, F + 1.0), P(os0 - 0.01, ot1 - 1, F + 2.2), P(os0 - 0.01, ot0 + 1, F + 2.2), COL.glass, neg(SD));
  box(IN, os0 - 0.4, os0, ot0 + 1, ot1 - 1, F, F + 1.0, COL.tileD);
  for (let i = 0; i < 4; i++) {
    const s = os0 + 1.2 + i * 1.1;
    box(IN, s, s + 0.9, ot1, ot1 + 0.6, F, F + 1.75, COL.steel, 'b', COL.dark);
    hq(IN, s + 0.1, s + 0.8, ot1 + 0.6, ot1 + 0.61, F + 1.2, COL.dark);
  }
  solid(os0 + 1.2, os0 + 5.6, ot1, ot1 + 0.6, F - 0.5, F + 1.75);
  sign(text([['きっぷうりば', 54, 50, '#fff'], ['Tickets', 30, 100, '#fff']], '#1f5fae', '#fff', 512, 128), 512, 128, os0 + 3.4, ot1 + 0.02, F + 2.5, 2.4, 0.6, 1, false, true);
  // 掲示 (色の板)
  for (let i = 0; i < 4; i++) {
    const c = ['#d9665b', '#5a8fd8', '#f1c84b', '#7ec49a'][i];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.25), new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
    const [x, z] = fr.xz(hs0 + 0.03, ht0 + 2 + i * 1.4); m.position.set(x, F + 1.6, z); m.rotation.y = Math.atan2(fr.sx, fr.sz); signs.push(m);
  }

  // ================= デッキ (屋根付き) と丸いバルコニー =================
  const [ts0, ts1, tt0, tt1] = site.terrace;
  box(S, ts0 + 7, ts1, tt0, tt1, F - 0.5, F, COL.tileD, '', COL.pave);
  disk(S, bs, bt, br, F, COL.pave, Math.PI / 2, Math.PI * 1.5, 20);
  disk(S, bs, bt, br, F - 0.5, COL.tileD, Math.PI / 2, Math.PI * 1.5, 20);
  hq(S, ts0 + 7, ts1, tt1 - 1.0, tt1 - 0.7, F + 0.01, COL.tactile);
  col.poly.push([ring(ts0 + 7, ts1, tt0, tt1), F - 0.5, F]);
  {
    const arc = [];
    for (let i = 0; i <= 16; i++) { const a = Math.PI / 2 + Math.PI * i / 16; arc.push([bs + Math.cos(a) * br, bt + Math.sin(a) * br]); }
    col.poly.push([arc.map(([s, t]) => fr.xz(s, t)), F - 0.5, F]);
    // 曲面のガラスの手すり
    for (let i = 0; i + 1 < arc.length; i++) {
      const [s0, t0] = arc[i], [s1, t1] = arc[i + 1], hint = [fr.sx * (s0 - bs) + fr.nx * (t0 - bt), 0, fr.sz * (s0 - bs) + fr.nz * (t0 - bt)];
      GL.quad(P(s0, t0, F), P(s1, t1, F), P(s1, t1, F + RAIL_H), P(s0, t0, F + RAIL_H), COL.glass, hint);
      S.quad(P(s0, t0, F + RAIL_H - 0.07), P(s1, t1, F + RAIL_H - 0.07), P(s1, t1, F + RAIL_H), P(s0, t0, F + RAIL_H), COL.salmon, UP);
      S.quad(P(s0, t0, F - 0.5), P(s1, t1, F - 0.5), P(s1, t1, F), P(s0, t0, F), COL.tileD, hint);
      wallC(s0, t0, s1, t1, F, RAIL_H, 0.06);
    }
  }
  // デッキの縁の手すり: 石の柱と格子 (北の縁。東の端は地上への階段の口を残す)
  const [gst, gt0, gt1] = site.gstairs;
  const railSegs = [[bs, tt1, ts1, tt1], [ts1, tt0, ts1, gt0], [ts1, gt1, ts1, tt1]];
  for (const [s0, t0, s1, t1] of railSegs) {
    const L = Math.hypot(s1 - s0, t1 - t0), n = Math.max(1, Math.round(L / 1.8));
    for (let i = 0; i <= n; i++) {
      const s = s0 + (s1 - s0) * i / n, t = t0 + (t1 - t0) * i / n;
      box(S, s - 0.17, s + 0.17, t - 0.17, t + 0.17, F, F + 1.25, COL.post, 'b');
      box(S, s - 0.21, s + 0.21, t - 0.21, t + 0.21, F + 1.25, F + 1.4, COL.post, 'b');
    }
    const hint = s0 === s1 ? SD : TD;
    S.quad(P(s0, t0, F + 0.25), P(s1, t1, F + 0.25), P(s1, t1, F + 1.12), P(s0, t0, F + 1.12), COL.lattice, hint);
    box(S, Math.min(s0, s1) - 0.05, Math.max(s0, s1) + 0.05, Math.min(t0, t1) - 0.05, Math.max(t0, t1) + 0.05, F, F + 0.25, COL.post, 'b');
    wallC(s0, t0, s1, t1, F, 1.3, 0.15);
  }
  // 屋根 (ガラス) と柱 (サーモン色)
  const RY = F + 4.3;
  for (let s = ts0 + 9; s <= ts1 + 0.1; s += 6) {
    cyl(S, s, tt1 - 0.5, 0.2, G, RY, COL.salmon, 10);
    postC(s, tt1 - 0.5, 0.22, G, RY);
    box(S, s - 0.1, s + 0.1, ht1, tt1, RY - 0.25, RY, COL.salmon);
  }
  box(S, ts0 + 9, ts1, tt1 - 0.65, tt1 - 0.35, RY - 0.35, RY, COL.salmon);
  GL.quad(P(ts0 + 9, ht1, RY + 0.02), P(ts1, ht1, RY + 0.02), P(ts1, tt1 + 0.3, RY + 0.25), P(ts0 + 9, tt1 + 0.3, RY + 0.25), COL.glass, UP);
  // デッキの下の 1 階 (北口の建物の北の面): 自販機と扉
  for (let i = 0; i < 3; i++) {
    const s = gs0 + i * 1.15;
    box(S, s, s + 1.0, ht1, ht1 + 0.75, G, G + 1.85, i === 1 ? C('#c5352f') : C('#eeeeec'), 'b', COL.dark);
  }
  solid(gs0, gs0 + 3.3, ht1, ht1 + 0.75, G - 0.5, G + 1.85);
  GL.quad(P(gs1 + 4, ht1 + 0.02, G), P(gs1 + 8, ht1 + 0.02, G), P(gs1 + 8, ht1 + 0.02, G + 2.4), P(gs1 + 4, ht1 + 0.02, G + 2.4), COL.shop, TD);

  // ================= デッキから地上への階段 =================
  {
    const n = Math.max(8, Math.round((F - G) / 0.17)), h = (F - G) / n, half = n >> 1;
    let s = gst;
    for (let k = 1; k <= n; k++) {
      const len = k === half ? 1.5 : RUN, y = F - k * h;
      box(S, s, s + len, gt0, gt1, G - 0.3, y, COL.tileD, 'b', COL.pave);
      hq(S, s, s + 0.05, gt0, gt1, y + 0.004, COL.tactile);
      solid(s, s + len, gt0, gt1, y - 0.4, y);
      s += len;
    }
    // 両側の手すり (金属) と、側面の壁
    for (const t of [gt0, gt1]) {
      S.quad(P(gst, t, F + 0.9), P(s, t, G + 0.9), P(s, t, G + 0.96), P(gst, t, F + 0.96), COL.steel, UP);
      for (let q = gst + 0.5; q < s; q += 1.6) { const y = F - (q - gst) / (s - gst) * (F - G); box(S, q - 0.03, q + 0.03, t - 0.03, t + 0.03, y, y + 0.93, COL.steel, 'b'); }
      wallC(gst, t, s, t, G, F - G + 1.0, 0.08);
    }
  }

  // ================= 東の低い建物 (1 階に店) =================
  const [ws0, ws1, wt0, wt1] = site.wing, WY = G + 7.5;
  box(S, ws0, ws1, wt0, wt1, G - 0.5, WY, COL.wing, 'b', C('#9b978d'));
  solid(ws0, ws1, wt0, wt1, G - 1, WY);
  box(S, ws0 - 0.1, ws1 + 0.1, wt0 - 0.1, wt1 + 0.1, WY, WY + 0.5, COL.white, 'b');
  GL.quad(P(ws0 + 2, wt1 + 0.02, G + 0.1), P(ws1 - 2, wt1 + 0.02, G + 0.1), P(ws1 - 2, wt1 + 0.02, G + 3.0), P(ws0 + 2, wt1 + 0.02, G + 3.0), COL.shop, TD);
  for (let s = ws0 + 2; s <= ws1 - 2; s += 4) box(S, s - 0.08, s + 0.08, wt1, wt1 + 0.08, G, G + 3.0, COL.steel, 'b');
  S.quad(P(ws0 + 1.5, wt1, G + 3.3), P(ws1 - 1.5, wt1, G + 3.3), P(ws1 - 1.5, wt1 + 1.4, G + 2.95), P(ws0 + 1.5, wt1 + 1.4, G + 2.95), COL.awning, TD);
  for (let s = ws0 + 1.5; s < ws1 - 2; s += 3) GL.quad(P(s, wt1 + 0.02, G + 4.4), P(s + 2, wt1 + 0.02, G + 4.4), P(s + 2, wt1 + 0.02, G + 6.3), P(s, wt1 + 0.02, G + 6.3), COL.shop, TD);
  sign(text([['CAFE', 60, 64, '#f4efe2', 140], ['・', 60, 64, '#f4efe2', 256], ['SHOP', 60, 64, '#f4efe2', 372]], '#2e5a45', '#fff', 512, 128), 512, 128, (ws0 + ws1) / 2, wt1 + 0.04, G + 3.75, 4.8, 1.0, 1);

  // ================= 地上の広場 =================
  const [ps0, ps1, pt0, pt1] = site.plaza, PV = G + 0.12;
  const paveRects = [[ws1, ps1, pt0, pt1], [ps0, ws1, wt1, pt1]];
  for (const r of paveRects) {
    hq(S, ...r, PV, COL.pave);
    col.poly.push([ring(...r), G - 1, PV]);
  }
  for (let s = ps0 + 3; s < ps1; s += 3) S.quad(P(s, pt0, PV + 0.004), P(s + 0.08, pt0, PV + 0.004), P(s + 0.08, pt1, PV + 0.004), P(s, pt1, PV + 0.004), COL.paveD, UP);
  // 車の回る輪と島 (植え込みと木)、北の道路へつなぐ道
  const [ls, lt, lr] = site.loop, RO = lr + 6;
  disk(S, ls, lt, RO, PV + 0.02, COL.asphalt, 0, Math.PI * 2, 36);
  hq(S, ls - 5, ls + 5, lt, pt1 + 6, PV + 0.021, COL.asphalt);
  for (let i = 0; i < 36; i += 2) {   // 輪の外の白線 (破線)
    const a0 = i / 36 * Math.PI * 2, a1 = (i + 1) / 36 * Math.PI * 2, r0 = RO - 0.4, r1 = RO - 0.25;
    S.quad(P(ls + Math.cos(a0) * r0, lt + Math.sin(a0) * r0, PV + 0.03), P(ls + Math.cos(a1) * r0, lt + Math.sin(a1) * r0, PV + 0.03),
      P(ls + Math.cos(a1) * r1, lt + Math.sin(a1) * r1, PV + 0.03), P(ls + Math.cos(a0) * r1, lt + Math.sin(a0) * r1, PV + 0.03), COL.white, UP);
  }
  cyl(S, ls, lt, lr, PV, PV + 0.25, COL.curb, 24);
  disk(S, ls, lt, lr, PV + 0.25, COL.grass, 0, Math.PI * 2, 24);
  postC(ls, lt, lr, G - 0.5, PV + 0.25);
  const trees = [[ls, lt, 1.25], [ps1 - 3, pt0 + 3, 1], [ps1 - 3, pt1 - 3, 0.9], [ws0 + 3, pt1 - 1.5, 0.8]];
  // タクシー (輪の西側に 3 台) と乗り場の標識、バスの乗り場の標識
  const taxis = [];
  for (let i = 0; i < 3; i++) {
    const a = Math.PI * (0.62 + i * 0.2), r = lr + 3;
    taxis.push([ls + Math.cos(a) * r, lt + Math.sin(a) * r, a + Math.PI / 2]);
  }
  const [txs, txt] = site.taxi, [bus_s, bus_t] = site.bus;
  const pole = (s, t, hgt, draw, label) => {
    cyl(S, s, t, 0.05, PV, PV + hgt, COL.steel, 8);
    postC(s, t, 0.08, PV, PV + hgt);
    for (const face of [1, -1]) sign(draw, 256, 256, s, t + face * 0.03, PV + hgt - 0.35, 0.6, 0.6, face, false).name = label;
  };
  pole(txs, txt, 2.8, (c, w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.fillStyle = '#1f3f8a'; c.fillRect(8, 8, w - 16, h - 16); c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = 'bold 60px sans-serif'; c.fillText('タクシー', w / 2, 110); c.font = 'bold 46px sans-serif'; c.fillText('のりば', w / 2, 175); c.font = 'bold 30px sans-serif'; c.fillText('TAXI', w / 2, 225); }, 'taxi_sign');
  pole(bus_s, bus_t, 2.8, (c, w, h) => { c.fillStyle = '#fff'; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2); c.fill(); c.fillStyle = '#d33a2c'; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 14, 0, Math.PI * 2); c.fill(); c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = 'bold 54px sans-serif'; c.fillText('バス', w / 2, 112); c.font = 'bold 44px sans-serif'; c.fillText('のりば', w / 2, 166); c.font = 'bold 24px sans-serif'; c.fillText('舞浜駅北口', w / 2, 204); }, 'bus_sign');
  // バス停の屋根とベンチ
  box(S, bus_s + 0.8, bus_s + 4.8, bus_t - 0.3, bus_t + 1.4, PV + 2.4, PV + 2.55, COL.white, '');
  for (const s of [bus_s + 1, bus_s + 4.6]) { cyl(S, s, bus_t - 0.1, 0.05, PV, PV + 2.4, COL.steel, 6); postC(s, bus_t - 0.1, 0.08, PV, PV + 2.4); }
  box(S, bus_s + 1.5, bus_s + 4.1, bus_t - 0.15, bus_t + 0.35, PV + 0.42, PV + 0.48, C('#8a6a4a'), '');
  // 時計塔 (鉄の格子の塔。上に時計)
  const [cks, ckt] = site.tower, TH = 8.2;
  for (const [ds, dt] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const b0 = [cks + ds * 0.85, ckt + dt * 0.85], b1 = [cks + ds * 0.42, ckt + dt * 0.42];
    S.quad(P(b0[0] - 0.06, b0[1], PV), P(b0[0] + 0.06, b0[1], PV), P(b1[0] + 0.06, b1[1], PV + TH), P(b1[0] - 0.06, b1[1], PV + TH), COL.lattice, SD);
    S.quad(P(b0[0], b0[1] - 0.06, PV), P(b0[0], b0[1] + 0.06, PV), P(b1[0], b1[1] + 0.06, PV + TH), P(b1[0], b1[1] - 0.06, PV + TH), COL.lattice, TD);
    postC(b0[0], b0[1], 0.1, PV, PV + 2);
  }
  for (let y = 1.2; y < TH; y += 1.4) {   // 横の材と筋交い
    const w = 0.85 - (0.43 * y / TH), w2 = 0.85 - (0.43 * (y + 1.4) / TH);
    for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) {
      S.quad(P(cks + a[0] * w, ckt + a[1] * w, PV + y), P(cks + b[0] * w, ckt + b[1] * w, PV + y), P(cks + b[0] * w, ckt + b[1] * w, PV + y + 0.07), P(cks + a[0] * w, ckt + a[1] * w, PV + y + 0.07), COL.lattice, UP);
      if (y + 1.4 < TH) S.quad(P(cks + a[0] * w, ckt + a[1] * w, PV + y), P(cks + a[0] * w, ckt + a[1] * w, PV + y + 0.08), P(cks + b[0] * w2, ckt + b[1] * w2, PV + y + 1.48), P(cks + b[0] * w2, ckt + b[1] * w2, PV + y + 1.4), COL.lattice, UP);
    }
  }
  box(S, cks - 0.65, cks + 0.65, ckt - 0.65, ckt + 0.65, PV + TH, PV + TH + 1.3, COL.white, '', COL.lattice);
  box(S, cks - 0.75, cks + 0.75, ckt - 0.75, ckt + 0.75, PV + TH + 1.3, PV + TH + 1.42, COL.lattice);
  const clockTex = (c, w, h) => {
    c.fillStyle = '#f7f7f2'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#333'; c.lineWidth = 8; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 14, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#333';
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; c.fillRect(w / 2 + Math.sin(a) * (w / 2 - 34) - 4, h / 2 - Math.cos(a) * (h / 2 - 34) - 4, 8, 8); }
    c.lineWidth = 10; c.beginPath(); c.moveTo(w / 2, h / 2); c.lineTo(w / 2 + 40, h / 2 - 30); c.stroke();
    c.lineWidth = 6; c.beginPath(); c.moveTo(w / 2, h / 2); c.lineTo(w / 2 - 20, h / 2 - 80); c.stroke();
  };
  for (const [face, along] of [[1, false], [-1, false], [1, true], [-1, true]]) {
    const ds = along ? face * 0.66 : 0, dt = along ? 0 : face * 0.66;
    sign(clockTex, 256, 256, cks + ds, ckt + dt, PV + TH + 0.65, 1.05, 1.05, face, along);
  }
  // 街灯
  const lights = [[ps0 + 8, pt1 - 0.8], [ls - 8, pt1 - 0.8], [ps1 - 2, (pt0 + pt1) / 2], [ws1 + 2, pt0 + 1.5], [ls + 9, pt0 + 1]];
  for (const [s, t] of lights) {
    cyl(S, s, t, 0.08, PV, PV + 5.5, COL.lattice, 8);
    postC(s, t, 0.12, PV, PV + 5.5);
    box(S, s - 0.3, s + 0.3, t - 0.3, t + 0.3, PV + 5.5, PV + 5.75, COL.lattice);
    lamps.push([s, t, PV + 5.48, 0.5, 0.5]);
  }
  // 車止め (広場と道の境目)
  for (let s = ps0 + 2; s < ls - RO - 1; s += 1.6) { cyl(S, s, pt1 - 0.3, 0.1, PV, PV + 0.8, COL.steel, 8); postC(s, pt1 - 0.3, 0.12, PV, PV + 0.8); }

  // ================= 南口 (south) =================
  // 駅の南の面: 改札 (南の壁の開き) → 屋根付きのデッキ (改札の階) → 地上への階段 → ロータリー (バス・タクシーの乗り場)。
  // 位置は航空写真と国土地理院の道路から。形・色は一般的なもの (写真のあるのは広場の屋根の青緑の柱と、暗い灰色と桃色のタイルの敷石だけ)。
  if (SO) {
    const TEAL = C('#3f9c97'), TEALD = C('#2c746f'), PINK = C('#d9a89c'), SLATE = C('#5d6068'), TILEP = C('#b9a3a1');
    const [ds0, ds1, dt0, dt1] = SO.deck, [go0, go1] = SO.open, [gx0, gx1, gz] = SO.gates;
    const [as0, as1, at0, at1] = SO.apron, [rs0, rs1, rt0, rt1] = SO.rotary;
    // 改札 (南): 壁の開きの内側にガラスの仕切りと改札機。改札の中は北口と同じ作り
    for (const [a, b] of [[go0, gx0], [gx1, go1]]) {
      GL.quad(P(a, gz, F), P(b, gz, F), P(b, gz, F + 2.1), P(a, gz, F + 2.1), COL.glass, TD);
      box(IN, a, b, gz - 0.05, gz + 0.05, F, F + 0.25, COL.steel);
      wallC(a, gz, b, gz, F, 2.1, 0.08);
    }
    const NGS = Math.round((gx1 - gx0) / 0.95);
    for (let i = 0; i <= NGS; i++) {
      const sg = gx0 + (gx1 - gx0) * i / NGS, w = 0.16;
      box(IN, sg - w, sg + w, gz - 0.9, gz + 0.9, F, F + 1.0, COL.steel, 'b', COL.black);
      box(IN, sg - w - 0.01, sg + w + 0.01, gz - 0.2, gz + 0.2, F + 0.55, F + 0.8, COL.green, 'b');
      col.poly.push([ring(sg - w, sg + w, gz - 0.9, gz + 0.9), F, F + 1.0]);
    }
    sign(text([['JR', 54, 64, '#fff', 60], ['舞浜駅  南口', 58, 50, '#fff', 300], ['Maihama Station  South Exit', 26, 100, '#fff', 300]], '#2f9a5c', '#fff', 640, 128),
      640, 128, (gx0 + gx1) / 2, gz - 0.3, F + 2.75, 3.4, 0.68, -1, false, true);
    sign(text([['ディズニーリゾート方面', 34, 40, '#fff'], ['リゾートライン ⇒', 34, 92, '#ffd84a']], '#1d2a3a', '#fff', 512, 128),
      512, 128, (gx0 + gx1) / 2, gz + 0.3, F + 2.75, 2.8, 0.7, 1, false, true);
    for (let sg = go0 + 1; sg < go1 - 0.5; sg += 6) lamps.push([sg, (gz + dt1 / 2) / 2 - 2, CEIL - 0.03, 2.2, 0.35]);
    // デッキ (改札の階): 敷石 (暗い灰色と桃色のタイル)、点字ブロック、青緑の屋根と柱、手すり
    box(S, ds0, ds1, dt0, dt1, F - 0.5, F, COL.tileD, '', SLATE);
    for (let sg = ds0 + 2; sg < ds1; sg += 6) hq(S, sg, sg + 3, dt0 + 1, dt1 - 1, F + 0.006, TILEP);
    hq(S, ds0, ds1, dt0 + 0.4, dt0 + 0.7, F + 0.012, COL.tactile);
    col.poly.push([ring(ds0, ds1, dt0, dt1), F - 0.5, F]);
    const RYS = F + 4.4;
    for (let sg = ds0 + 3; sg <= ds1 - 2; sg += 6) {
      cyl(S, sg, dt0 + 0.6, 0.22, F - 0.5, RYS, TEAL, 10);
      cyl(S, sg, dt0 + 0.6, 0.36, F - 0.5, F + 0.25, PINK, 10);
      postC(sg, dt0 + 0.6, 0.38, F - 0.5, RYS);
      cyl(S, sg, dt1 - 0.6, 0.22, F, RYS, TEAL, 10);
      postC(sg, dt1 - 0.6, 0.24, F, RYS);
      box(S, sg - 0.12, sg + 0.12, dt0 + 0.6, dt1 - 0.6, RYS - 0.3, RYS, TEALD);
    }
    box(S, ds0, ds1, dt0 + 0.4, dt0 + 0.8, RYS - 0.4, RYS, TEAL);
    GL.quad(P(ds0, dt1 + 0.3, RYS + 0.02), P(ds1, dt1 + 0.3, RYS + 0.02), P(ds1, dt0 - 0.3, RYS + 0.3), P(ds0, dt0 - 0.3, RYS + 0.3), COL.glass, UP);
    // 南の縁・端の手すり (地上への階段の口を残す)
    const stairsS = SO.gstairs;   // [上の端の s, 下りる向き (±1), t0, t1]
    const gapAt = (sEdge) => stairsS.find((q) => q[0] === sEdge);
    const post2 = (sx, tx) => { box(S, sx - 0.15, sx + 0.15, tx - 0.15, tx + 0.15, F, F + 1.2, COL.post, 'b'); };
    const edgeSegs = [[ds0, dt0, ds1, dt0]];
    for (const [sEdge] of [[ds0], [ds1]]) {
      const q = gapAt(sEdge);
      if (q) { edgeSegs.push([sEdge, dt0, sEdge, q[2]], [sEdge, q[3], sEdge, dt1]); } else edgeSegs.push([sEdge, dt0, sEdge, dt1]);
    }
    for (const [s0, t0, s1, t1] of edgeSegs) {
      const L = Math.hypot(s1 - s0, t1 - t0), n = Math.max(1, Math.round(L / 2));
      for (let i = 0; i <= n; i++) post2(s0 + (s1 - s0) * i / n, t0 + (t1 - t0) * i / n);
      const hint = s0 === s1 ? SD : neg(TD);
      S.quad(P(s0, t0, F + 0.25), P(s1, t1, F + 0.25), P(s1, t1, F + 1.1), P(s0, t0, F + 1.1), COL.lattice, hint);
      S.quad(P(s0, t0, F + 1.1), P(s1, t1, F + 1.1), P(s1, t1, F + 1.16), P(s0, t0, F + 1.16), COL.steel, UP);
      wallC(s0, t0, s1, t1, F, 1.2, 0.12);
    }
    // 地上への階段 (東の端は +s へ、西の端は -s へ下りる)
    for (const [sTop, dir, t0, t1] of stairsS) {
      const n = Math.max(8, Math.round((F - G) / 0.17)), h = (F - G) / n, half = n >> 1;
      let sc = sTop;
      for (let k = 1; k <= n; k++) {
        const len = k === half ? 1.5 : RUN, y = F - k * h, a = Math.min(sc, sc + dir * len), b = Math.max(sc, sc + dir * len);
        box(S, a, b, t0, t1, G - 0.3, y, COL.tileD, 'b', SLATE);
        hq(S, dir > 0 ? a : b - 0.05, dir > 0 ? a + 0.05 : b, t0, t1, y + 0.004, COL.tactile);
        solid(a, b, t0, t1, y - 0.4, y);
        sc += dir * len;
      }
      for (const t of [t0, t1]) {
        const sa = Math.min(sTop, sc), sb = Math.max(sTop, sc);
        S.quad(P(sTop, t, F + 0.9), P(sc, t, G + 0.9), P(sc, t, G + 0.96), P(sTop, t, F + 0.96), COL.steel, UP);
        for (let q = 0.5; q < Math.abs(sc - sTop); q += 1.6) { const sx = sTop + dir * q, y = F - q / Math.abs(sc - sTop) * (F - G); box(S, sx - 0.03, sx + 0.03, t - 0.03, t + 0.03, y, y + 0.93, COL.steel, 'b'); }
        wallC(sTop, t, sc, t, G, F - G + 1.0, 0.08);
        void sa; void sb;
      }
    }
    // 地上: 駅前の舗装 (西へのびる広い歩道を含む)、ロータリー (アスファルト)、島 (植え込みと木)、西の円形の乗降所
    hq(S, as0, as1, at0, at1, PV, TILEP);
    for (let sg = as0 + 3; sg < as1; sg += 3) S.quad(P(sg, at0, PV + 0.004), P(sg + 0.08, at0, PV + 0.004), P(sg + 0.08, at1, PV + 0.004), P(sg, at1, PV + 0.004), COL.paveD, UP);
    col.poly.push([ring(as0, as1, at0, at1), G - 1, PV]);
    hq(S, rs0, rs1, rt0, rt1, PV + 0.02, COL.asphalt);
    col.poly.push([ring(rs0, rs1, rt0, rt1), G - 1, PV + 0.02]);
    const blob = (cs, ct, rx, ry, y0, y1, side, top, seg = 24) => {
      const pts = [];
      for (let i = 0; i < seg; i++) { const a = i / seg * Math.PI * 2; pts.push([cs + Math.cos(a) * rx, ct + Math.sin(a) * ry]); }
      for (let i = 0; i < seg; i++) {
        const [a0, b0] = pts[i], [a1, b1] = pts[(i + 1) % seg];
        S.quad(P(a0, b0, y0), P(a1, b1, y0), P(a1, b1, y1), P(a0, b0, y1), side, [fr.sx * (a0 - cs) + fr.nx * (b0 - ct), 0, fr.sz * (a0 - cs) + fr.nz * (b0 - ct)]);
        S.tri(P(cs, ct, y1), P(a0, b0, y1), P(a1, b1, y1), top, UP);
      }
      col.poly.push([pts.map(([a, b]) => fr.xz(a, b)), G - 1, y1]);
    };
    for (const [is, it, irx, iry] of SO.islands) {
      blob(is, it, irx, iry, PV + 0.02, PV + 0.27, COL.curb, COL.grass);
      for (const [ds, dtt, k] of [[0, 0, 1.2], [irx * 0.5, iry * 0.2, 0.9], [-irx * 0.5, -iry * 0.2, 1.0], [0, iry * 0.55, 0.8], [0, -iry * 0.55, 0.85]]) trees.push([is + ds, it + dtt, k]);
    }
    const [wcs, wct, wcr] = SO.west;
    blob(wcs, wct, wcr, wcr, PV + 0.02, PV + 0.03, COL.asphalt, COL.asphalt, 28);
    blob(wcs, wct, wcr * 0.42, wcr * 0.42, PV + 0.03, PV + 0.28, COL.curb, SLATE, 20);
    // バス・タクシーの乗り場の標識と屋根、街灯、車止め
    const drawBusS = (c, w, h) => { c.fillStyle = '#fff'; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2); c.fill(); c.fillStyle = '#d33a2c'; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 14, 0, Math.PI * 2); c.fill(); c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = 'bold 54px sans-serif'; c.fillText('バス', w / 2, 112); c.font = 'bold 44px sans-serif'; c.fillText('のりば', w / 2, 166); c.font = 'bold 24px sans-serif'; c.fillText('舞浜駅南口', w / 2, 204); };
    for (const [bs0, bt0] of SO.bus) {
      pole(bs0, bt0, 2.8, drawBusS, 'bus_sign_s');
      box(S, bs0 - 2, bs0 + 2, bt0 - 1.4, bt0 + 0.3, PV + 2.4, PV + 2.55, COL.white, '');
      for (const sx of [bs0 - 1.8, bs0 + 1.8]) { cyl(S, sx, bt0 - 1.2, 0.05, PV, PV + 2.4, COL.steel, 6); postC(sx, bt0 - 1.2, 0.08, PV, PV + 2.4); }
      box(S, bs0 - 1.4, bs0 + 1.4, bt0 - 1.25, bt0 - 0.75, PV + 0.42, PV + 0.48, C('#8a6a4a'), '');
    }
    pole(SO.taxi[0], SO.taxi[1], 2.8, (c, w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.fillStyle = '#1f3f8a'; c.fillRect(8, 8, w - 16, h - 16); c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = 'bold 60px sans-serif'; c.fillText('タクシー', w / 2, 110); c.font = 'bold 46px sans-serif'; c.fillText('のりば', w / 2, 175); c.font = 'bold 30px sans-serif'; c.fillText('TAXI', w / 2, 225); }, 'taxi_sign_s');
    for (const [ls_, lt_] of SO.lights) {
      cyl(S, ls_, lt_, 0.08, PV, PV + 5.5, COL.lattice, 8);
      postC(ls_, lt_, 0.12, PV, PV + 5.5);
      box(S, ls_ - 0.3, ls_ + 0.3, lt_ - 0.3, lt_ + 0.3, PV + 5.5, PV + 5.75, COL.lattice);
      lamps.push([ls_, lt_, PV + 5.48, 0.5, 0.5]);
    }
    // 横断歩道 (ロータリーの南の道。白い縞)
    if (SO.crossing) {
      const [cx0, cx1, ctz0, ctz1] = SO.crossing;
      for (let sg = cx0; sg < cx1 - 0.2; sg += 1.0) S.quad(P(sg, ctz0, PV + 0.045), P(sg + 0.5, ctz0, PV + 0.045), P(sg + 0.5, ctz1, PV + 0.045), P(sg, ctz1, PV + 0.045), COL.white, UP);
    }
  }

  // ================= 形をまとめる =================
  const outMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide });
  // 中 (改札の階): 照明で明るい所。光る分を面の色に掛ける (日陰でも灰色にくすまない)
  const inMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide, emissive: '#ffffff', emissiveIntensity: 0.42 });
  inMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * vColor.rgb;'); };
  const add = (B, mat, name, cast = true) => { if (!B.p.length) return; const m = new THREE.Mesh(B.geometry(), mat); m.name = name; m.castShadow = cast; m.receiveShadow = true; g.add(m); };
  add(S, outMat, 'ext_site_out');
  add(IN, inMat, 'ext_site_in', false);
  add(CEILM, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), 'ext_site_ceil', false);
  add(GL, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false }), 'ext_site_glass', false);
  // 天井の照明 (光る板)
  const lm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.05, 1), new THREE.MeshBasicMaterial({ color: COL.lamp }), lamps.length);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(fr.sx, fr.sz)), V = new THREE.Vector3(), Sc = new THREE.Vector3();
  lamps.forEach(([s, t, y, ls_, lt_], i) => { const [x, z] = fr.xz(s, t); lm.setMatrixAt(i, M.compose(V.set(x, y, z), Q, Sc.set(lt_, 1, ls_))); });
  lm.name = 'ext_site_lamps'; lm.computeBoundingSphere(); g.add(lm);
  // 木 (幹と葉) とタクシー
  const treeSpots = [];
  trees.forEach(([s, t, k], i) => { const [x, z] = fr.xz(s, t); treeSpots.push([x, z, PV + (i === 0 ? 0.25 : 0), k * 1.3, (i * 0.37) % 1, 0x58783e, 0, 1]); postC(s, t, 0.25, G, PV + 2.5); });
  { const layer = new TreeLayer(treeSpots, 'trees_station'); g.add(layer.group); }   // 葉の板の木 (trees.js。倍率は基準の木 = 半径 1.7 m に対する比)
  const taxiG = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: COL.taxi, roughness: 0.35, metalness: 0.4 }), win = new THREE.MeshStandardMaterial({ color: '#2b3a44', roughness: 0.15, metalness: 0.5 });
  const lampTop = new THREE.MeshStandardMaterial({ color: '#f2c94c', emissive: '#6b5410', roughness: 0.5 });
  for (const [s, t, a] of taxis) {
    const car = new THREE.Group();
    const lower = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.75, 4.6), body); lower.position.y = 0.55; car.add(lower);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 2.4), win); upper.position.set(0, 1.2, -0.2); car.add(upper);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.06, 2.2), body); roof.position.set(0, 1.52, -0.2); car.add(roof);
    const sg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.18), lampTop); sg.position.set(0, 1.66, -0.1); car.add(sg);
    for (const [wx, wz] of [[-0.8, 1.45], [0.8, 1.45], [-0.8, -1.45], [0.8, -1.45]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#1a1a1a' })); w.position.set(wx, 0.32, wz); car.add(w); }
    const [x, z] = fr.xz(s, t);
    car.position.set(x, PV + 0.02, z);
    const dirS = Math.cos(a), dirT = Math.sin(a);   // 向き (s, t の向き) → x, z の向き
    car.rotation.y = Math.atan2(fr.sx * dirS + fr.nx * dirT, fr.sz * dirS + fr.nz * dirT);
    car.traverse((o) => { o.castShadow = true; });
    taxiG.add(car);
    col.box = col.box || [];
    col.box.push([x, z, car.rotation.y, 0.85, 2.3, PV, PV + 1.6]);
  }
  taxiG.name = 'ext_site_taxis'; g.add(taxiG);
  for (const m of signs) g.add(m);
  world.addColliders(col, true);
  g.userData.counts = { lamps: lamps.length, holes: holes.length, colliders: col.poly.length + col.line.length + col.circle.length };
  return g;
}
