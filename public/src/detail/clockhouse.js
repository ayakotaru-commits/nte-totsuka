// グランシティの「時計の棟」(エントランス棟) の外観。形と位置は tools/clockhouse.py (点群で測った大きさ)、
// 配置の値は tools/build_props.py が props.json の sites[].hall (v: 2) に書く。
// 外観は不動産サイトの公開写真を見て書き起こした (写真そのものは保存・使用していない):
//   クリーム色の壁に白い付け柱、背の高いアーチ窓、中央に赤い枠のガラス扉と扇形の黒いガラスの庇、
//   軒の上は紺灰色のスレートのマンサード屋根に、黄土色の枠の丸窓のドーマー、正面中央に黄土色の丸い枠の時計。
//   中庭側 (後ろの平屋) もアーチ窓と赤い扉、屋上に白い手すり。
// 壁そのもの (当たり判定のある箱) は city.js が描く。ここでは壁の前に外観の板と、立体の飾りを置く。
import * as THREE from 'three';
import { canvasTexture } from './util.js';
import { DOORS } from '../doors.js';

const CREAM = '#e6d6b2', PIER = '#f3ecdc', OCHRE = '#cfa45a', SLATE = '#59606b', DOOR = '#7e2a22', GLASS = '#2c363e';

// 壁の外観の板の絵。items = [{ c: 中心 (m, 壁の中央から), w: 幅, top: 上端の高さ, kind: 'arch' | 'door' | 'pier' }]
function facadeTextures(L, H, color, items) {
  const draw = (lit) => canvasTexture(1024, Math.max(64, Math.round(1024 * H / L)), (g, W, Hh) => {
    const px = W / L, my = Hh / H, X = (c) => (L / 2 + c) * px, Y = (y) => Hh - y * my;
    g.fillStyle = lit ? '#000' : color; g.fillRect(0, 0, W, Hh);
    if (!lit) {
      // 腰の石張り (少し濃い横の帯) と、横の目地
      g.fillStyle = 'rgba(120,100,70,.10)'; g.fillRect(0, Y(0.55), W, 0.55 * my);
      g.strokeStyle = 'rgba(110,90,60,.13)'; g.lineWidth = 1;
      for (let y = 0.55; y < H; y += 0.45) { g.beginPath(); g.moveTo(0, Y(y)); g.lineTo(W, Y(y)); g.stroke(); }
    }
    const arch = (cx, ww, top, bottom, fill, rim, rw = 0.2) => {
      g.beginPath(); g.moveTo(cx - ww / 2, bottom); g.lineTo(cx - ww / 2, top + ww / 2);
      g.arc(cx, top + ww / 2, ww / 2, Math.PI, 0); g.lineTo(cx + ww / 2, bottom); g.closePath();
      if (rim) { g.lineWidth = rw * px; g.strokeStyle = rim; g.stroke(); }
      g.fillStyle = fill; g.fill();
    };
    for (const it of items) {
      const cx = X(it.c), ww = it.w * px, top = Y(it.top), bottom = Y(it.kind === 'door' ? 0 : 0.45);
      if (it.kind === 'pier') { if (!lit) { g.fillStyle = PIER; g.fillRect(cx - ww / 2, Y(H), ww, H * my); g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(cx + ww / 2 - 3, Y(H), 3, H * my); } continue; }
      if (it.kind === 'arch') {
        if (lit) { arch(cx, ww, top, bottom, '#ffd9a0'); continue; }
        arch(cx, ww + 0.5 * px, top - 0.25 * my, bottom, PIER);                 // 白い石の枠
        arch(cx, ww, top, bottom, GLASS);
        g.fillStyle = 'rgba(170,195,210,.20)'; g.fillRect(cx - ww / 2 + 3, top + ww / 2, ww - 6, bottom - top - ww / 2);
        g.strokeStyle = '#e9e4d8'; g.lineWidth = 0.07 * px;                     // 白い桟 (縦 1 本・横 3 本・アーチの放射)
        g.beginPath(); g.moveTo(cx, top); g.lineTo(cx, bottom); g.stroke();
        for (let k = 1; k <= 3; k++) { const y = top + ww / 2 + k * (bottom - top - ww / 2) / 4; g.beginPath(); g.moveTo(cx - ww / 2, y); g.lineTo(cx + ww / 2, y); g.stroke(); }
        g.beginPath(); g.moveTo(cx - ww / 2, top + ww / 2); g.lineTo(cx + ww / 2, top + ww / 2); g.stroke();
        g.fillStyle = OCHRE; g.fillRect(cx - 0.17 * px, top - 0.45 * my, 0.34 * px, 0.4 * my);   // 要石
        g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(cx - ww / 2 - 0.15 * px, bottom - 0.08 * my, ww + 0.3 * px, 0.1 * my); // 窓台
        continue;
      }
      // 扉の所: 白い石の枠を描き、扉の大きさの穴を抜く (扉は開け閉めできる立体の板。makeDoor)
      if (!lit) { g.fillStyle = PIER; g.fillRect(cx - ww / 2 - 0.3 * px, top - 0.3 * my, ww + 0.6 * px, bottom - top + 0.3 * my); }
      g.clearRect(cx - ww / 2, top, ww, bottom - top);
    }
  });
  return { tex: draw(false), lit: draw(true) };
}

// アーチ窓・扉・付け柱の並び (壁の長さ L、中央に扉の幅 door。扉が無ければ 0)
function bays(L, door, winTop, n) {
  const items = [{ c: -L / 2 + 0.35, w: 0.7, kind: 'pier' }, { c: L / 2 - 0.35, w: 0.7, kind: 'pier' }];
  if (door) items.push({ c: 0, w: door, top: 3.15, kind: 'door' });
  const free0 = door ? door / 2 + 0.5 : 0, free1 = L / 2 - 0.7;
  const m = n ?? Math.max(door ? 1 : 1, Math.floor((free1 - free0) / 2.9));
  const step = (free1 - free0) / m;
  for (let k = 0; k < m; k++) {
    const c = free0 + step * (k + 0.5);
    for (const sg of door ? [-1, 1] : (m === 1 && !door ? [0] : [-1, 1])) {
      if (sg === 0) { items.push({ c: 0, w: 1.5, top: winTop, kind: 'arch' }); continue; }
      items.push({ c: sg * c, w: Math.min(1.6, step - 0.9), top: winTop, kind: 'arch' });
      if (k > 0 || door) items.push({ c: sg * (c - step / 2), w: 0.5, kind: 'pier' });
    }
  }
  return items;
}

export function buildClockhouse({ hl, group, shadow }) {
  const W = hl.width, D = hl.depth, h = hl.height, rh = hl.roof_h, ri = hl.roof_in, bk = hl.back || {};
  const here = new THREE.Group();          // 正面の壁の中央 (地面) を原点に、+z = 外向き (道路)、-z = 奥
  here.position.set(hl.x, hl.y, hl.z);
  here.rotation.y = hl.yaw;
  group.add(here);
  const emissive = [];
  const mat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
  const cream = mat({ color: CREAM }), pier = mat({ color: PIER, roughness: 0.75 }), ochre = mat({ color: OCHRE, roughness: 0.6 });
  const iron = mat({ color: '#15181b', roughness: 0.45, metalness: 0.5 });
  const box = (w, hh, d, m, x, y, z) => { const b = shadow(new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m)); b.position.set(x, y, z); here.add(b); return b; };

  // ---------- 壁の外観の板 (4 面 + 後ろの平屋の 3 面) ----------
  // face(中心 x, z, 向き (外向きの角度), 長さ, 高さ, 並び)
  const face = (x, z, ang, L, H, items) => {
    const { tex, lit } = facadeTextures(L, H, hl.color, items);
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: lit, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.82, alphaTest: 0.5 });
    emissive.push(m);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(L, H), m);
    p.position.set(x + Math.sin(ang) * 0.04, H / 2, z + Math.cos(ang) * 0.04);
    p.rotation.y = ang;
    p.receiveShadow = true;
    here.add(p);
  };
  const door = hl.opening ? hl.opening.w : 0;
  const winTop = Math.min(4.3, h - 0.75);
  const front = bays(W, door, winTop, 2);
  face(0, 0, 0, W, h, front);                                                      // 正面
  // 開け閉めできる扉 (赤い枠のガラス扉 2 枚。doors.js が動かす)。z0 = 壁の面、ang = 外向き
  const doorTex = canvasTexture(128, 256, (c, Wt, Ht) => {
    c.fillStyle = DOOR; c.fillRect(0, 0, Wt, Ht);
    const f = 12, tr = Ht * 0.19;
    c.fillStyle = GLASS; c.fillRect(f, f, Wt - 2 * f, tr - 1.5 * f); c.fillRect(f, tr + f / 2, Wt - 2 * f, Ht - tr - 3 * f);
    c.fillStyle = 'rgba(255,214,150,.18)'; c.fillRect(f, tr + f / 2, Wt - 2 * f, Ht - tr - 3 * f);
    c.fillStyle = DOOR; for (let k = 1; k < 5; k++) c.fillRect(f, tr + k * (Ht - tr) / 5 - 2, Wt - 2 * f, 4);
    c.fillStyle = '#c9a45a'; c.fillRect(Wt - f - 6, Ht * 0.55, 4, 26);   // 取っ手
  });
  const doorM = new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.4, metalness: 0.2 });
  const makeDoor = (z0, ang) => {
    if (!door) return;
    const dh = 3.15, lw = door / 2 - 0.03;
    const dg = new THREE.Group();
    dg.position.set(0, 0, z0); dg.rotation.y = ang;
    here.add(dg);
    const leaves = [];
    for (const sx of [-1, 1]) {   // sx = 吊り元の側。開くと内側 (-z) へ回る
      const pivot = new THREE.Group();
      pivot.position.set(sx * door / 2, 0, -0.06);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(lw, dh, 0.07).translate(-sx * lw / 2, dh / 2, 0), doorM);
      pivot.add(shadow(leaf));
      dg.add(pivot);
      leaves.push({ pivot, sign: -sx });
    }
    // 世界の座標 (扉の中央・外向き)
    const c = Math.cos(hl.yaw), s = Math.sin(hl.yaw), lz = z0;
    const oa = hl.yaw + ang;
    DOORS.push({ x: hl.x + lz * s, z: hl.z + lz * c, y: hl.y, nx: Math.sin(oa), nz: Math.cos(oa), w: door, h: dh, leaves });
  };
  makeDoor(0, 0);
  face(-W / 2, -D / 2, -Math.PI / 2, D, h, bays(D, 0, winTop, 1));                 // 横
  face(W / 2, -D / 2, Math.PI / 2, D, h, bays(D, 0, winTop, 1));
  const bd = bk.depth || 0, bi = bk.inset || 0, bh = bk.h || 4.4, BW = W - 2 * bi;
  if (bd > 0) {
    face(0, -D - bd, Math.PI, BW, bh, bays(BW, door, Math.min(3.6, bh - 0.6), 2)); // 中庭側
    makeDoor(-D - bd, Math.PI);
    face(-BW / 2, -D - bd / 2, -Math.PI / 2, bd, bh, bays(bd, 0, Math.min(3.6, bh - 0.6), 1));
    face(BW / 2, -D - bd / 2, Math.PI / 2, bd, bh, bays(bd, 0, Math.min(3.6, bh - 0.6), 1));
  } else {
    face(0, -D, Math.PI, W, h, bays(W, door, winTop, 2));
  }

  // ---------- 立体の飾り: 正面の付け柱・軒の蛇腹・腰の石 ----------
  for (const it of front) if (it.kind === 'pier') box(it.w + 0.1, h - 0.3, 0.16, pier, it.c, (h - 0.3) / 2, 0.1);
  const ring = (x0, x1, z0, z1, y, hh, out, m) => {   // 長方形の周りの帯 (out = 壁からの張り出し)
    const w = x1 - x0, d = z1 - z0;
    box(w + 2 * out, hh, out * 2, m, (x0 + x1) / 2, y, z1);
    box(w + 2 * out, hh, out * 2, m, (x0 + x1) / 2, y, z0);
    box(out * 2, hh, d, m, x0, y, (z0 + z1) / 2);
    box(out * 2, hh, d, m, x1, y, (z0 + z1) / 2);
  };
  ring(-W / 2, W / 2, -D, 0, h - 0.2, 0.4, 0.22, pier);                            // 軒の蛇腹
  ring(-W / 2, W / 2, -D, 0, h - 0.62, 0.12, 0.14, ochre);                         // 蛇腹の下の黄土色の線
  ring(-W / 2, W / 2, -D, 0, 0.25, 0.5, 0.08, mat({ color: '#d9cdb2' }));          // 腰の石
  if (bd > 0) {
    ring(-BW / 2, BW / 2, -D - bd, -D - 0.01, bh - 0.15, 0.3, 0.16, pier);
    // 屋上の白い手すり (中庭側と左右。柱 + 笠木)
    const rail = mat({ color: '#f3efe6', roughness: 0.7 });
    const postG = new THREE.CylinderGeometry(0.07, 0.09, 0.75, 6);
    const edge = (xa, za, xb, zb) => {
      const L = Math.hypot(xb - xa, zb - za), n = Math.max(2, Math.round(L / 0.45));
      for (let k = 0; k <= n; k++) { const m = new THREE.Mesh(postG, rail); m.position.set(xa + (xb - xa) * k / n, bh + 0.38, za + (zb - za) * k / n); here.add(m); }
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, L), rail);
      top.position.set((xa + xb) / 2, bh + 0.78, (za + zb) / 2); top.rotation.y = Math.atan2(xb - xa, zb - za); here.add(shadow(top));
    };
    const zb = -D - bd + 0.15, xa = -BW / 2 + 0.15, xb = BW / 2 - 0.15;
    edge(xa, -D - 0.3, xa, zb); edge(xa, zb, xb, zb); edge(xb, zb, xb, -D - 0.3);
  }

  // ---------- マンサード屋根 (軒から roof_h まで、4 面の急な斜面。スレートの横筋) ----------
  const slateTex = canvasTexture(128, 128, (g, S) => {
    g.fillStyle = SLATE; g.fillRect(0, 0, S, S);
    for (let r = 0; r < 8; r++) {
      const y = r * S / 8;
      g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, y, S, 2);
      g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(0, y + 2, S, 3);
      for (let x = (r % 2) * 8; x < S; x += 16) { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x, y, 1, S / 8); }
    }
  });
  slateTex.wrapS = slateTex.wrapT = THREE.RepeatWrapping;
  const slateM = new THREE.MeshStandardMaterial({ map: slateTex, roughness: 0.55, metalness: 0.15 });
  {
    const e = 0.12, y0 = h, y1 = rh;
    const A = [[-W / 2 - e, e], [W / 2 + e, e], [W / 2 + e, -D - e], [-W / 2 - e, -D - e]];
    const B = [[-W / 2 + ri, -ri], [W / 2 - ri, -ri], [W / 2 - ri, -D + ri], [-W / 2 + ri, -D + ri]];
    const pos = [], uv = [];
    for (let i = 0; i < 4; i++) {
      const a = A[i], b = A[(i + 1) % 4], c = B[(i + 1) % 4], d = B[i];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), sl = Math.hypot(ri + e, y1 - y0);
      const P = (p, y) => [p[0], y, p[1]];
      pos.push(...P(a, y0), ...P(b, y0), ...P(c, y1), ...P(a, y0), ...P(c, y1), ...P(d, y1));
      const u = L / 2, v = sl / 1.2, inset = (ri + e) / 2;
      uv.push(0, 0, u, 0, u - inset / 2, v, 0, 0, u - inset / 2, v, inset / 2, v);
    }
    // 上の平らな面
    const T = B.map(p => [p[0], y1 + 0.01, p[1]]);
    pos.push(...T[0], ...T[1], ...T[2], ...T[0], ...T[2], ...T[3]);
    uv.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    here.add(shadow(new THREE.Mesh(g, slateM)));
    // 屋根の上端の金属の縁
    ring(-W / 2 + ri, W / 2 - ri, -D + ri, -ri, rh + 0.05, 0.12, 0.06, mat({ color: '#3d434b', roughness: 0.4, metalness: 0.4 }));
  }

  // ---------- ドーマー (丸い頭の窓、黄土色の枠) ----------
  const dormerWin = canvasTexture(64, 96, (g, Wd, Hd) => {
    g.fillStyle = OCHRE; g.fillRect(0, 0, Wd, Hd);
    g.fillStyle = PIER; g.beginPath(); g.moveTo(8, Hd); g.lineTo(8, Wd / 2); g.arc(Wd / 2, Wd / 2, Wd / 2 - 8, Math.PI, 0); g.lineTo(Wd - 8, Hd); g.fill();
    g.fillStyle = GLASS; g.beginPath(); g.moveTo(16, Hd - 6); g.lineTo(16, Wd / 2); g.arc(Wd / 2, Wd / 2, Wd / 2 - 16, Math.PI, 0); g.lineTo(Wd - 16, Hd - 6); g.fill();
    g.strokeStyle = '#e9e4d8'; g.lineWidth = 2; g.beginPath(); g.moveTo(Wd / 2, Wd / 2 - 14); g.lineTo(Wd / 2, Hd - 6); g.stroke();
  });
  const dWinM = new THREE.MeshStandardMaterial({ map: dormerWin, roughness: 0.6 });
  const dTopM = slateM;
  const dormer = (x, z, ang) => {
    const dm = new THREE.Group();
    dm.position.set(x, h + 0.05, z); dm.rotation.y = ang;
    const bw = 1.25, bh2 = 1.25, dep = ri + 0.2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh2, dep).translate(0, bh2 / 2, -dep / 2 + 0.05), cream);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(bw / 2 + 0.08, bw / 2 + 0.08, dep + 0.1, 16, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).translate(0, bh2, -dep / 2 + 0.05), dTopM);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(bw - 0.1, bh2 + 0.5), dWinM);
    win.position.set(0, (bh2 + 0.5) / 2, 0.07);
    dm.add(shadow(body), shadow(cap), win);
    here.add(dm);
  };
  const dx = [W * 0.17, W * 0.34];
  for (const x of dx) { dormer(x, -0.05, 0); dormer(-x, -0.05, 0); dormer(x, -D + 0.05, Math.PI); dormer(-x, -D + 0.05, Math.PI); }
  dormer(-W / 2 - 0.05, -D / 2, -Math.PI / 2); dormer(W / 2 + 0.05, -D / 2, Math.PI / 2);

  // ---------- 正面中央の時計 (屋根から立ち上がる壁 + 黄土色の丸い枠 + 黒い文字盤) ----------
  {
    const cz = 0.15, cyc = rh + 0.2, R = 1.35;
    box(3.6, cyc - h + 0.2, 0.7, cream, 0, h + (cyc - h + 0.2) / 2 - 0.2, cz - 0.3);           // 立ち上がりの壁
    for (const sx of [-1, 1]) {
      box(0.5, cyc - h + 0.6, 0.8, pier, sx * 1.95, h + (cyc - h + 0.6) / 2 - 0.2, cz - 0.3);  // 両脇の柱
      const vol = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.6, 16, 1, false, sx > 0 ? 0 : -Math.PI / 2, Math.PI / 2).rotateX(-Math.PI / 2), cream);
      vol.position.set(sx * 2.2, h + 0.05, cz - 0.3); here.add(shadow(vol));                     // 渦巻きの代わりの四分円
    }
    const back = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.15, R + 0.15, 0.6, 40).rotateX(Math.PI / 2), cream);
    back.position.set(0, cyc, cz - 0.3); here.add(shadow(back));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.24, 10, 40), ochre);
    rim.position.set(0, cyc, cz + 0.02); here.add(shadow(rim));
    const rim2 = new THREE.Mesh(new THREE.TorusGeometry(R - 0.42, 0.07, 6, 40), mat({ color: '#e7d9b6' }));
    rim2.position.set(0, cyc, cz + 0.04); here.add(rim2);
    box(0.45, 0.6, 0.35, ochre, 0, cyc + R + 0.15, cz);                                         // 要石
    const dial = new THREE.Mesh(new THREE.CircleGeometry(R - 0.48, 40), new THREE.MeshStandardMaterial({ roughness: 0.4, map: canvasTexture(256, 256, (g, S) => {
      g.fillStyle = '#20262b'; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#d8b25a'; g.lineWidth = 5; g.beginPath(); g.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; g.lineWidth = k % 3 ? 4 : 8; g.beginPath(); g.moveTo(S / 2 + Math.sin(a) * S * 0.33, S / 2 - Math.cos(a) * S * 0.33); g.lineTo(S / 2 + Math.sin(a) * S * 0.41, S / 2 - Math.cos(a) * S * 0.41); g.stroke(); }
      g.lineWidth = 9; g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 + S * 0.2, S / 2 + S * 0.06); g.stroke();
      g.lineWidth = 6; g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 - S * 0.06, S / 2 - S * 0.32); g.stroke();
      g.fillStyle = '#d8b25a'; g.beginPath(); g.arc(S / 2, S / 2, 9, 0, Math.PI * 2); g.fill();
    }) }));
    dial.position.set(0, cyc, cz + 0.03); here.add(dial);
  }

  // ---------- 入口の扇形の黒いガラスの庇 (細い鉄の腕で吊る) ----------
  if (door) {
    const cy = Math.min(h - 0.9, 3.75), R = door / 2 + 1.0;
    const glass = new THREE.MeshStandardMaterial({ color: '#1c2227', roughness: 0.2, metalness: 0.6, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    const fan = new THREE.Mesh(new THREE.CircleGeometry(R, 24, 0, Math.PI).rotateX(-Math.PI / 2), glass);
    fan.scale.z = 0.75; fan.position.set(0, cy, 0.12); fan.rotation.x = -0.1;
    here.add(shadow(fan));
    const edge = new THREE.Mesh(new THREE.TorusGeometry(R, 0.06, 6, 24, Math.PI).rotateX(Math.PI / 2), iron);
    edge.scale.z = 0.75; edge.position.set(0, cy - 0.02, 0.12); edge.rotation.x = -0.1; here.add(edge);
    for (const a of [0.35, 0.8, 1.2, 1.57, 1.94, 2.34, 2.79]) {   // 放射状の骨
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, R), iron);
      rib.position.set(Math.cos(a) * R / 2, cy + 0.02, 0.12 + Math.sin(a) * R * 0.75 / 2); rib.rotation.y = Math.PI / 2 - a; here.add(rib);
    }
    for (const sx of [-1, 1]) {                                       // 吊りの腕
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.0, 6), iron);
      arm.position.set(sx * R * 0.55, cy + 0.65, 0.7); arm.rotation.x = -0.82; here.add(arm);
    }
  }

  // ---------- 壁灯 (アーチ窓の間) ----------
  const lampM = new THREE.MeshStandardMaterial({ color: '#f3d9a4', emissive: '#ffcf8a', emissiveIntensity: 0, roughness: 0.5 });
  emissive.push(lampM);
  for (const it of front) if (it.kind === 'pier' && Math.abs(it.c) < W / 2 - 1) {
    box(0.12, 0.12, 0.3, iron, it.c, 2.75, 0.3);
    box(0.24, 0.4, 0.24, lampM, it.c, 2.6, 0.45);
    box(0.3, 0.06, 0.3, iron, it.c, 2.83, 0.45);
  }

  group.userData.emissive = (group.userData.emissive || []).concat(emissive);
}

// 中庭の独立したアーチの門 (中庭側の写真: クリーム色の四角い柱 2 本、半円のアーチ、上に横長の梁と蛇腹)
export function buildCourtArch({ ar, group, shadow }) {
  const g = new THREE.Group();
  g.position.set(ar.x, ar.y, ar.z);
  g.rotation.y = ar.yaw;
  group.add(g);
  const cream = new THREE.MeshStandardMaterial({ color: '#e3d0a6', roughness: 0.85 });
  const pier = new THREE.MeshStandardMaterial({ color: PIER, roughness: 0.75 });
  const W = ar.w, O = ar.open, H = ar.h, pw = (W - O) / 2, r = O / 2, spring = H - 1.2 - r, D = 0.9;
  const add = (geo, m, x, y, z) => { const o = shadow(new THREE.Mesh(geo, m)); o.position.set(x, y, z); g.add(o); return o; };
  for (const sg of [-1, 1]) {
    const x = sg * (O / 2 + pw / 2);
    add(new THREE.BoxGeometry(pw, H - 0.6, D), cream, x, (H - 0.6) / 2, 0);
    add(new THREE.BoxGeometry(pw + 0.2, 0.5, D + 0.2), pier, x, 0.25, 0);          // 台座
    add(new THREE.BoxGeometry(pw + 0.12, 0.25, D + 0.12), pier, x, spring, 0);      // アーチの起点の帯
  }
  // アーチの上の壁 (半円を抜いた形を押し出す)
  const sh = new THREE.Shape();
  sh.moveTo(-O / 2, spring); sh.lineTo(-O / 2, H - 0.6); sh.lineTo(O / 2, H - 0.6); sh.lineTo(O / 2, spring);
  sh.absarc(0, spring, r, 0, Math.PI, false);
  const span = new THREE.ExtrudeGeometry(sh, { depth: D, bevelEnabled: false }).translate(0, 0, -D / 2);
  add(span, cream, 0, 0, 0);
  const rim = add(new THREE.TorusGeometry(r + 0.12, 0.13, 8, 24, Math.PI), pier, 0, spring, 0);
  rim.scale.z = D / 0.26;
  add(new THREE.BoxGeometry(0.5, 0.7, D + 0.1), new THREE.MeshStandardMaterial({ color: OCHRE, roughness: 0.6 }), 0, spring + r + 0.15, 0);   // 要石
  add(new THREE.BoxGeometry(W + 0.4, 0.6, D + 0.4), pier, 0, H - 0.3, 0);          // 上の梁 (蛇腹)
}

// 立体駐車場の入口 (不動産サイトの写真: 1 階の暗い開口に、上がアーチの黒い鉄の引き戸の門。前はレンガ色の舗装と駐車ます)
export function buildCarpark({ cp, group, shadow, drapeFn }) {
  const g = new THREE.Group();
  g.position.set(cp.x, cp.y, cp.z);
  g.rotation.y = cp.yaw;            // +z = 外向き (道路の側)
  group.add(g);
  const W = cp.w, H = cp.h;
  const iron = new THREE.MeshStandardMaterial({ color: '#16191c', roughness: 0.45, metalness: 0.55 });
  // 奥の暗い開口 (駐車場の中)
  // 中は日陰の灰色 (黒にすると鉄の門と見分けがつかない)。奥の梁と柱の影を描く
  const inside = canvasTexture(256, 96, (c, Wt, Ht) => {
    c.fillStyle = '#6a6e70'; c.fillRect(0, 0, Wt, Ht);
    c.fillStyle = '#4c5053'; c.fillRect(0, 0, Wt, Ht * 0.16);
    for (const x of [0.12, 0.5, 0.88]) c.fillRect(Wt * x - 6, 0, 12, Ht);
    const gr = c.createLinearGradient(0, 0, 0, Ht); gr.addColorStop(0, 'rgba(0,0,0,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gr; c.fillRect(0, 0, Wt, Ht);
  });
  const dark = new THREE.Mesh(new THREE.PlaneGeometry(W + 1.0, H + 0.2).translate(0, (H + 0.2) / 2, 0), new THREE.MeshStandardMaterial({ map: inside, roughness: 1 }));
  dark.position.z = 0.05; g.add(dark);
  // 門: 縦格子の引き戸 2 枚 + 中央の上のアーチ形の飾り
  const gateTex = canvasTexture(512, 192, (c, Wt, Ht) => {
    c.clearRect(0, 0, Wt, Ht);
    c.fillStyle = '#fff';
    const top = Ht * 0.18;
    c.fillRect(0, top, Wt, 6); c.fillRect(0, Ht - 8, Wt, 8); c.fillRect(0, (top + Ht) / 2, Wt, 4);
    for (let x = 3; x < Wt; x += 11) c.fillRect(x, top, 3, Ht - top);
    c.fillRect(0, top, 6, Ht - top); c.fillRect(Wt - 6, top, 6, Ht - top); c.fillRect(Wt / 2 - 4, top, 8, Ht - top);
    c.lineWidth = 5; c.strokeStyle = '#fff';
    c.beginPath(); c.arc(Wt / 2, top + Ht * 0.55, Ht * 0.55, Math.PI * 1.15, Math.PI * 1.85); c.stroke();   // 中央のアーチ
    c.beginPath(); c.arc(Wt / 2, top + Ht * 0.62, Ht * 0.5, Math.PI * 1.2, Math.PI * 1.8); c.stroke();
    for (let k = -3; k <= 3; k++) { c.beginPath(); c.arc(Wt / 2 + k * 18, top - 6, 5, 0, Math.PI * 2); c.stroke(); }
  });
  const gate = new THREE.Mesh(new THREE.PlaneGeometry(W, H + 0.5).translate(0, (H + 0.5) / 2, 0),
    new THREE.MeshStandardMaterial({ color: '#16191c', map: gateTex, alphaTest: 0.5, roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide }));
  gate.position.z = 0.6; g.add(shadow(gate));
  for (const sx of [-1, 1]) {   // 門柱
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, H + 0.6, 0.22).translate(0, (H + 0.6) / 2, 0), iron);
    post.position.set(sx * (W / 2 + 0.11), 0, 0.6); g.add(shadow(post));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), iron); cap.position.set(sx * (W / 2 + 0.11), H + 0.72, 0.6); g.add(cap);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.06, 0.12), iron); rail.position.set(0, 0.03, 0.6); g.add(rail);   // 戸車のレール
  // 前の舗装 (レンガ色のタイル) と白い駐車ます
  const lt = cp.lot;
  if (lt) {
    const tile = canvasTexture(512, 512, (c, S) => {
      c.fillStyle = '#c9957f'; c.fillRect(0, 0, S, S);
      for (let r = 0; r < 24; r++) for (let k = 0; k < 24; k++) {
        c.fillStyle = (r * 7 + k * 3) % 5 < 2 ? '#bb8a72' : (r + k) % 3 ? '#d3a28b' : '#c48d75';
        c.fillRect(k * S / 24 + (r % 2) * S / 48 + 1, r * S / 24 + 1, S / 24 - 2, S / 24 - 2);
      }
      c.strokeStyle = '#f4f1ea'; c.lineWidth = 6;
      const n = lt.stalls || 0, sw = S * 2.6 / lt.len, x0 = S / 2 - n * sw / 2 - S * 0.2;
      for (let k = 0; k <= n; k++) { c.beginPath(); c.moveTo(x0 + k * sw, S * 0.08); c.lineTo(x0 + k * sw, S * 0.08 + S * 5.0 / lt.dep); c.stroke(); }
    });
    let geo;
    if (lt.poly && lt.poly.length >= 3) {
      geo = polyGeometry(lt.poly, 0.07);   // 道路の端で切った形 (build_props.py)
    } else {
      geo = new THREE.PlaneGeometry(lt.len, lt.dep, Math.ceil(lt.len / 2), Math.ceil(lt.dep / 2)).rotateX(-Math.PI / 2);
      geo.rotateY(cp.yaw); geo.translate(lt.x, 0.07, lt.z);
    }
    const pave = new THREE.Mesh(drapeFn(geo, 1.0), new THREE.MeshStandardMaterial({ map: tile, roughness: 0.85 }));
    pave.receiveShadow = true;
    group.add(pave);
  }
}

// 地面の上の凸多角形 (点 = [x, z, u, v]) を、上向きの三角形の扇にする (drape が地形に沿わせて細かく分ける)
export function polyGeometry(P, y) {
  const pos = [], uv = [];
  const area = P.reduce((s, q, i) => { const r = P[(i + 1) % P.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0);
  for (let i = 1; i + 1 < P.length; i++) {
    const tri = area > 0 ? [P[0], P[i + 1], P[i]] : [P[0], P[i], P[i + 1]];   // x-z 平面で上 (+y) を向く順
    for (const q of tri) { pos.push(q[0], y, q[1]); uv.push(q[2], q[3]); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}
