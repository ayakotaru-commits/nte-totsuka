// フェアリー・リールパーク 段階 2: 各エリアの建物・内側の道・広場・木・看板・門・特別な物 (火山・灯台・船など)。
// 中身は tools/park_areas.py が決まった乱数で作った public/data/park.json の gen (data/park_areas.json のテーマから)。ここは読んで置くだけ。
// 建物 = 箱 + 壁の柄 (textures.js の makeWallPatcher。頂点に matId) + 屋根 + 看板 (1 枚の模様の集まりから)。エリアごとに 1 つにまとめて描く (頂点の共有・マージ)。
// 木・街灯・ベンチ・植え込みは InstancedMesh。当たり判定は呼び出し側の col (park.js が world.addColliders)。
import * as THREE from 'three';
import { canvasTexture } from './util.js';
import { makeWallPatcher } from './textures.js';
import { buildRides } from './parkrides.js';
import { mergeStaticMeshes } from './mergestatic.js';
import { makeFacadeKit, facadeDetail } from './parkfacade.js';
import { buildBunting, buildSmoke } from './parkfx.js';
import { buildFurn } from './parkfurn.js';

const C = (s) => new THREE.Color(s);
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const PLAIN = [0.1, 0.5], GLASS = [0.5, 0.55];   // 壁の模様の絵 (railext.js の窓の絵と同じ) の中の、無地の所・窓の所の uv

// 頂点をためて 1 つの BufferGeometry にする
class Buf {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.m = []; }
  vert(p, n, uv, c, m) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]); this.c.push(c.r, c.g, c.b); this.m.push(m); }
  // 三角形。nOut = 外向きの法線 (向きを合わせ、陰影にも使う)。null = 面の法線を上向きにそろえる (屋根)
  tri(a, b, c, nOut, uv, col, mat = 0, cols = null) {   // cols = 頂点ごとの色 [a, b, c] (経年感の濃淡)
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(g[0], g[1], g[2]) || 1; g = [g[0] / l, g[1] / l, g[2] / l];
    const ref = nOut || [0, 1, 0];
    let [pa, pb, pc, ua, ub, uc] = [a, b, c, uv[0], uv[1], uv[2]], [ca, cb, cc] = cols || [col, col, col];
    if (g[0] * ref[0] + g[1] * ref[1] + g[2] * ref[2] < 0) { pb = c; pc = b; ub = uv[2]; uc = uv[1]; cb = cols ? cols[2] : col; cc = cols ? cols[1] : col; g = [-g[0], -g[1], -g[2]]; }
    const n = nOut || g;
    this.vert(pa, n, ua, ca, mat); this.vert(pb, n, ub, cb, mat); this.vert(pc, n, uc, cc, mat);
  }
  quad(a, b, c, d, nOut, uv, col, mat = 0, cols = null) { this.tri(a, b, c, nOut, [uv[0], uv[1], uv[2]], col, mat, cols && [cols[0], cols[1], cols[2]]); this.tri(a, c, d, nOut, [uv[0], uv[2], uv[3]], col, mat, cols && [cols[0], cols[2], cols[3]]); }
  geometry(withMat) {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (withMat) g.setAttribute('matId', new THREE.Uint8BufferAttribute(new Uint8Array(this.m), 1));
    g.computeBoundingSphere();
    return g;
  }
}

// 形をまとめる (位置・法線だけ)
function mergeGeos(list) {
  const p = [], n = [];
  for (const g0 of list) { const g = g0.index ? g0.toNonIndexed() : g0; p.push(...g.attributes.position.array); n.push(...g.attributes.normal.array); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  return g;
}

export function buildAreas(ctx) {
  const { cfg, ground, std, glowMat, group, col, emissive, low } = ctx;
  const G = cfg.gen, A = G.areas, G0 = cfg.ground.level;
  const api = { group: new THREE.Group(), stats: {} };
  api.group.name = 'park_areas';
  group.add(api.group);
  const AC = (ai) => A[ai];

  // ---------- 看板の模様 (1 枚の絵に全部) ----------
  const CW = 384, CH = 96, COLS = 5, rows = Math.max(1, Math.ceil(G.signs.length / COLS));
  const AW = CW * COLS, AH = CH * rows;
  const atlas = canvasTexture(AW, AH, (g) => {
    G.signs.forEach((s, i) => {
      const x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH;
      g.fillStyle = s.bg; g.fillRect(x, y, CW, CH);
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 5; g.strokeRect(x + 6, y + 6, CW - 12, CH - 12);
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; g.strokeRect(x + 12, y + 12, CW - 24, CH - 24);
      let eq = 0; for (const ch of s.text) eq += ch.charCodeAt(0) > 255 ? 1 : 0.62;
      const fs = Math.min(50, 336 / Math.max(1, eq));
      g.font = `bold ${fs}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 4; g.shadowOffsetY = 2;
      g.fillStyle = s.fg; g.fillText(s.text, x + CW / 2, y + CH / 2 + 2, CW - 36);
      g.shadowColor = 'transparent';
    });
  });
  const signUv = (i) => {
    const cx = i % COLS, cy = Math.floor(i / COLS), e = 0.003;
    return [(cx * CW) / AW + e, 1 - ((cy + 1) * CH) / AH + e, ((cx + 1) * CW) / AW - e, 1 - (cy * CH) / AH - e];
  };
  const signMat = new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.5, side: THREE.DoubleSide });
  signMat.userData.glow = 0.7; emissive.push(signMat);

  // ---------- 材質 ----------
  const win = canvasTexture(64, 64, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#5d6670'; g.fillRect(14, 16, 36, 26);
    g.fillStyle = '#d8d8d4'; g.fillRect(0, 56, 64, 8);
  });
  win.wrapS = win.wrapT = THREE.RepeatWrapping;
  // 夜は窓が暖かく光る (窓の絵と同じ位置だけ光らせる。時間帯は time.js の win)
  const winGlow = canvasTexture(64, 64, (g) => { g.fillStyle = '#000000'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#ffd89a'; g.fillRect(16, 18, 32, 22); });
  winGlow.wrapS = winGlow.wrapT = THREE.RepeatWrapping;
  const wallMat = new THREE.MeshStandardMaterial({ map: win, vertexColors: true, roughness: 0.85, emissiveMap: winGlow, emissive: '#ffffff', emissiveIntensity: 0 });
  wallMat.userData.glow = 0.55; emissive.push(wallMat);
  const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const clockTex = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#fff8e0'; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill();
    g.strokeStyle = '#4a3a2a'; g.lineWidth = 10; g.stroke();
    g.lineWidth = 6; for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; g.beginPath(); g.moveTo(128 + Math.sin(a) * 100, 128 - Math.cos(a) * 100); g.lineTo(128 + Math.sin(a) * 116, 128 - Math.cos(a) * 116); g.stroke(); }
    g.lineWidth = 9; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + 50, 128 - 28); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 - 6, 128 - 86); g.stroke();
  });
  const clockMat = new THREE.MeshStandardMaterial({ map: clockTex, emissiveMap: clockTex, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.5, transparent: true, alphaTest: 0.5 });
  clockMat.userData.glow = 0.5; emissive.push(clockMat);

  // 壁の柄 (街の本体と同じ。頂点の matId)。スマホは付けない (メモリ)。柄が読めるまで壁は隠す
  const wallMeshes = [];
  if (!low) makeWallPatcher(cfg.tower.at[0], cfg.tower.at[1], 1300).then((patch) => { patch(wallMat, 'park'); wallMat.needsUpdate = true; wallMeshes.forEach((m) => { m.visible = true; }); }).catch((e) => { console.warn('[park] 壁の柄', e); wallMeshes.forEach((m) => { m.visible = true; }); });

  // ---------- 建物 ----------
  const bufs = A.map(() => ({ wall: new Buf(), trim: new Buf(), sign: new Buf(), shopglass: new Buf(), lamp: new Buf(), neon: {} }));
  const kit = A.some((a) => a.detail) ? makeFacadeKit({ glowMat, emissive, signs: G.signs }) : null;   // 建物の細部 (段階 7。parkfacade.js)
  const gyOf = (x, z) => ground(x, z);
  const chimneys = [];   // 煙を出す煙突の位置 (parkfx.js)

  function addBuilding(b) {
    const B = bufs[b.a], W = B.wall, T = B.trim, S = B.sign;
    const ux = Math.sin(b.yaw), uz = Math.cos(b.yaw), rx = uz, rz = -ux;
    const hx = b.w / 2, hz = b.d / 2, gy = gyOf(b.x, b.z), y0 = gy - 0.25, y1 = gy + b.h;
    const P = (lx, y, lz) => [b.x + rx * lx + ux * lz, y, b.z + rz * lx + uz * lz];
    const nW = (lx, lz) => [rx * lx + ux * lz, 0, rz * lx + uz * lz];   // 局所の向き → 世界の向き
    const wc = C(b.col), tc = C(b.trim), rc = C(b.rcol), dc = b.door ? C(b.door) : null, white = C('#ffffff');
    // 経年感 (段階 7): 建物ごとに壁・屋根の色を少しずらし、壁のすそを暗く・上を少し明るくする (雨だれ・すすけ)。細部のある建物だけ
    let wLo = wc, wHi = wc, rLo = null, rHi = null, rLoF = null, rHiF = null;
    if (b.det) {
      const h1 = Math.sin(b.x * 12.9898 + b.z * 78.233) * 43758.5453, h2 = Math.sin(b.x * 3.1 + b.z * 9.7) * 24634.6345, f1 = h1 - Math.floor(h1), f2 = h2 - Math.floor(h2);
      wc.offsetHSL((f1 - 0.5) * 0.012, (f2 - 0.5) * 0.06, (f1 - 0.5) * 0.05); rc.offsetHSL((f2 - 0.5) * 0.01, 0, (f1 - 0.5) * 0.06);
      const sh = (c, k) => new THREE.Color(Math.min(1, c.r * k), Math.min(1, c.g * k), Math.min(1, c.b * k));
      wLo = sh(wc, 0.82); wHi = sh(wc, 1.03);
      // 屋根のあせ: ひさし側 = 暗く少し緑 (こけ・雨だれ)、棟側 = 明るく色が薄い (日焼け)。向きで差をつける (道に向いた斜面ほど日に焼ける)
      const grey = (c, k) => { const l = (c.r + c.g + c.b) / 3; return new THREE.Color(c.r + (l - c.r) * k, c.g + (l - c.g) * k, c.b + (l - c.b) * k); };
      const fade = 0.2 + 0.3 * (f1 * 0.6 + f2 * 0.4);
      rLo = sh(rc, 0.8); rLo.g = Math.min(1, rLo.g * 1.06); rHi = sh(grey(rc, fade * 0.6), 1.04); rLoF = sh(grey(rc, fade * 0.4), 0.9); rHiF = sh(grey(rc, fade), 1.12);
    }
    const fh = b.fh, bay = b.bay;
    // 4 つの面 (局所: 前 +Z、右 +X、後ろ -Z、左 -X)。外から見て左 → 右の順
    const faces = [[[-hx, hz], [hx, hz], [0, 1]], [[hx, hz], [hx, -hz], [1, 0]], [[hx, -hz], [-hx, -hz], [0, -1]], [[-hx, -hz], [-hx, hz], [-1, 0]]];
    faces.forEach(([a, c, nl], fi) => {
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]), n = nW(nl[0], nl[1]), nu = L / bay;
      const front = fi === 0;
      let yb = y0;
      if (front && b.shop) {   // 1 階は店先: 無地の壁の帯 + ガラス + 扉 (細部のある建物は、ガラス・扉を parkfacade.js が作る)
        yb = y0 + fh;
        W.quad(P(a[0], y0, a[1]), P(c[0], y0, c[1]), P(c[0], yb, c[1]), P(a[0], yb, a[1]), n, [PLAIN, PLAIN, PLAIN, PLAIN], wLo, b.wall);
        if (!b.det) {
        const gl = Math.min(hx - 0.8, hx), gz = hz + 0.06, off = 0.06;
        W.quad(P(-gl, y0 + 0.4, gz), P(gl, y0 + 0.4, gz), P(gl, yb - 0.5, gz), P(-gl, yb - 0.5, gz), n, [GLASS, GLASS, GLASS, GLASS], white, b.wall);
        if (dc) W.quad(P(-0.9, y0, gz + off), P(0.9, y0, gz + off), P(0.9, y0 + 2.9, gz + off), P(-0.9, y0 + 2.9, gz + off), n, [PLAIN, PLAIN, PLAIN, PLAIN], dc, b.wall);
        }
      }
      W.quad(P(a[0], yb, a[1]), P(c[0], yb, c[1]), P(c[0], y1, c[1]), P(a[0], y1, a[1]), n,
        [[0, (yb - y0) / fh], [nu, (yb - y0) / fh], [nu, (y1 - y0) / fh], [0, (y1 - y0) / fh]], wc, b.wall, b.det ? [front && b.shop ? wc : wLo, front && b.shop ? wc : wLo, wHi, wHi] : null);
      if (front && !b.shop && dc) {   // 扉
        const gz = hz + 0.06;
        W.quad(P(-0.9, y0, gz), P(0.9, y0, gz), P(0.9, y0 + 2.8, gz), P(-0.9, y0 + 2.8, gz), n, [PLAIN, PLAIN, PLAIN, PLAIN], dc, b.wall);
        W.quad(P(-1.2, y0 + 2.8, gz), P(1.2, y0 + 2.8, gz), P(1.2, y0 + 3.05, gz), P(-1.2, y0 + 3.05, gz), n, [PLAIN, PLAIN, PLAIN, PLAIN], tc, b.wall);
      }
    });
    // 軒の帯 (平らな屋根の建物は縁取り)
    const box = (buf, x0, x1, ya, yb, z0, z1, color, ring = 0) => {
      const cs = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
      for (let k = 0; k < 4; k++) {
        const a = cs[k], c = cs[(k + 1) % 4], ex = c[0] - a[0], ez = c[1] - a[1], l = Math.hypot(ex, ez) || 1;
        const n = nW(ez / l, -ex / l);
        buf.quad(P(a[0], ya, a[1]), P(c[0], ya, c[1]), P(c[0], yb, c[1]), P(a[0], yb, a[1]), n, [PLAIN, PLAIN, PLAIN, PLAIN], color);
      }
      if (ring) {   // 上面は枠だけ (内側は屋根が張るので、同じ高さの面を重ねない = ちらつき防止)
        const ix0 = x0 + ring, ix1 = x1 - ring, iz0 = z0 + ring, iz1 = z1 - ring, up = [0, 1, 0];
        buf.quad(P(x0, yb, z0), P(x1, yb, z0), P(ix1, yb, iz0), P(ix0, yb, iz0), up, [PLAIN, PLAIN, PLAIN, PLAIN], color);
        buf.quad(P(x1, yb, z0), P(x1, yb, z1), P(ix1, yb, iz1), P(ix1, yb, iz0), up, [PLAIN, PLAIN, PLAIN, PLAIN], color);
        buf.quad(P(x1, yb, z1), P(x0, yb, z1), P(ix0, yb, iz1), P(ix1, yb, iz1), up, [PLAIN, PLAIN, PLAIN, PLAIN], color);
        buf.quad(P(x0, yb, z1), P(x0, yb, z0), P(ix0, yb, iz0), P(ix0, yb, iz1), up, [PLAIN, PLAIN, PLAIN, PLAIN], color);
      } else buf.quad(P(x0, yb, z0), P(x1, yb, z0), P(x1, yb, z1), P(x0, yb, z1), [0, 1, 0], [PLAIN, PLAIN, PLAIN, PLAIN], color);
    };
    if (b.roof === 'flat') {
      box(T, -hx - 0.3, hx + 0.3, y1 - 0.5, y1 + 0.15, -hz - 0.3, hz + 0.3, tc, 0.3);
      T.quad(P(-hx, y1 + 0.15, -hz), P(hx, y1 + 0.15, -hz), P(hx, y1 + 0.15, hz), P(-hx, y1 + 0.15, hz), [0, 1, 0], [PLAIN, PLAIN, PLAIN, PLAIN], rc, 0, rLo && [rLo, rHiF, rHi, rLoF]);
    } else {
      box(T, -hx - 0.15, hx + 0.15, y1 - 0.25, y1 + 0.05, -hz - 0.15, hz + 0.15, tc);
      roof(b, T, W, P, nW, hx, hz, y1, rc, wc, rLo && [rLo, rHi, rLoF, rHiF]);
    }
    // 細部 (窓まわり・出窓・バルコニー・店先・屋根の飾り・ネオン。b.det があるエリアだけ)
    const fd = b.det && kit ? facadeDetail({ b, Buf, P, nW, W, T, S, SG: B.shopglass, LP: B.lamp, NE: (c) => B.neon[c] || (B.neon[c] = new Buf()), signUv, y0, y1, gy, kit, low, lod: A[b.a].lod, onChimney: (x, y, z) => chimneys.push([x, y, z]) }) : null;
    // 看板 (前の面の、1 階の上) と、店先の日よけ
    {
      const fw = Math.min(b.shop || b.lm ? hx * 1.7 : 2 * Math.min(hx, 2.6), b.lm ? 11 : (fd ? 5.0 : 7.5)), fhh = fw / 4;
      const ya = y0 + (b.shop ? fh : 3.1) + (fd ? 0.1 : 0.15), gz = hz + 0.1;
      const uv = signUv(b.sign);
      S.quad(P(-fw / 2, ya, gz), P(fw / 2, ya, gz), P(fw / 2, ya + fhh, gz), P(-fw / 2, ya + fhh, gz), nW(0, 1), [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]], white);
      box(T, -fw / 2 - 0.12, fw / 2 + 0.12, ya - 0.12, ya + fhh + 0.12, hz + 0.02, hz + 0.09, tc);
      if (b.shop && b.awn && !fd) {
        const aw = hx * 2 - 1.6, n = Math.max(2, Math.round(aw / 0.9)), ex = 1.3, ay = y0 + fh - 0.15;
        for (let k = 0; k < n; k++) {
          const xa = -aw / 2 + aw * k / n, xb = -aw / 2 + aw * (k + 1) / n, color = C(b.awn[k % 2]);
          T.quad(P(xa, ay, hz + 0.05), P(xb, ay, hz + 0.05), P(xb, ay - 0.85, hz + ex), P(xa, ay - 0.85, hz + ex), nW(0, 0.5), [PLAIN, PLAIN, PLAIN, PLAIN], color);
        }
      }
    }
    // 屋上の看板 (道に向けて 2 枚の板 + 柱)
    if (b.roofSign !== undefined) {
      const fw = Math.min(hx * 1.6, 9), fhh = fw / 4, ya = y1 + 1.0 + (fd ? Math.max(0, fd.crownH - 0.5) : 0), uv = signUv(b.roofSign);
      S.quad(P(-fw / 2, ya, 0), P(fw / 2, ya, 0), P(fw / 2, ya + fhh, 0), P(-fw / 2, ya + fhh, 0), nW(0, 1), [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]], white);
      S.quad(P(fw / 2, ya, -0.05), P(-fw / 2, ya, -0.05), P(-fw / 2, ya + fhh, -0.05), P(fw / 2, ya + fhh, -0.05), nW(0, -1), [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]], white);
      for (const s of [-1, 1]) box(T, s * fw * 0.4 - 0.15, s * fw * 0.4 + 0.15, y1, ya, -0.15, 0.15, tc);
    }
    // 時計 (四方)
    if (b.clock) {
      const cs = 5.5, cy = y1 - 7.5;
      for (const [lx, lz, nl] of [[0, hz + 0.08, [0, 1]], [0, -hz - 0.08, [0, -1]], [hx + 0.08, 0, [1, 0]], [-hx - 0.08, 0, [-1, 0]]]) {
        const rxl = nl[1], rzl = -nl[0];   // 面の上で、外から見て右の向き (局所)
        const cp = (s, t) => P(lx + rxl * s, cy + t, lz + rzl * s);
        clockQuads.push([cp(-cs / 2, -cs / 2), cp(cs / 2, -cs / 2), cp(cs / 2, cs / 2), cp(-cs / 2, cs / 2), nW(nl[0], nl[1])]);
      }
    }
    // 角の塔 (丸い塔 + とんがり屋根)。1 つ (tower) か、四隅 (towers = 個数)
    const towers = [];
    if (b.tower) towers.push({ lx: b.tower.side * hx, lz: hz, r: b.tower.r, h: b.tower.h, rh: b.tower.rh });
    if (b.towers) {
      const rr = Math.max(2.6, Math.min(b.w, b.d) * 0.17), cs = [[-hx, hz], [hx, hz], [-hx, -hz], [hx, -hz]];
      for (let k = 0; k < Math.min(4, b.towers); k++) towers.push({ lx: cs[k][0], lz: cs[k][1], r: rr, h: b.h + 6 + (k % 2) * 3, rh: rr * 3.2 });
    }
    for (const t of towers) {
      const cp = P(t.lx, 0, t.lz), N = 16, top = gy + t.h;
      for (let k = 0; k < N; k++) {
        const a0 = k / N * Math.PI * 2, a1 = (k + 1) / N * Math.PI * 2, am = (a0 + a1) / 2;
        const p = (a, y) => [cp[0] + Math.cos(a) * t.r, y, cp[2] + Math.sin(a) * t.r];
        const nrm = [Math.cos(am), 0, Math.sin(am)], u0 = k * t.r * 0.4 / bay, u1 = (k + 1) * t.r * 0.4 / bay;
        W.quad(p(a0, y0), p(a1, y0), p(a1, top), p(a0, top), nrm, [[u0, 0], [u1, 0], [u1, (top - y0) / fh], [u0, (top - y0) / fh]], wc, b.wall);
        const apex = [cp[0], top + t.rh, cp[2]], ov = 1.12;
        const q = (a) => [cp[0] + Math.cos(a) * t.r * ov, top, cp[2] + Math.sin(a) * t.r * ov];
        T.tri(q(a0), q(a1), apex, null, [PLAIN, PLAIN, PLAIN], rc);
      }
      col.circle.push([cp[0], cp[2], t.r + 0.2, gy - 1, top]);
    }
    col.box.push([b.x, b.z, b.yaw, hx, hz, gy - 1, y1]);
  }
  const clockQuads = [];

  // 屋根 (切妻・前向き切妻・寄せ棟・とんがり)
  function roof(b, T, W, P, nW, hx, hz, y1, rc, wc, wr) {   // wr = 屋根のあせの色 [ひさし側, 棟側, ひさし側 (日焼け), 棟側 (日焼け)] (細部のある建物だけ)
    const rk = b.roof, rh = b.rh, ov = 0.45;
    if (rk === 'gable' || rk === 'gablefront') {
      const alongX = rk === 'gable';   // 棟が前の面と平行 (X に沿う)
      const A = alongX ? hx : hz, Cc = alongX ? hz : hx;   // A = 棟の向きの半分、Cc = 横切る向きの半分
      const loc = (a, c, y) => (alongX ? P(a, y, c) : P(c, y, a));
      const ra = A + 0.3, rc2 = Cc + ov, rhh = rh * (1 + ov / Cc);
      for (const s of [-1, 1]) {
        const cl = wr && (s > 0 ? [wr[2], wr[2], wr[3], wr[3]] : [wr[0], wr[0], wr[1], wr[1]]);
        T.quad(loc(-ra, s * rc2, y1 - 0.1), loc(ra, s * rc2, y1 - 0.1), loc(ra, 0, y1 + rhh), loc(-ra, 0, y1 + rhh), null, [PLAIN, PLAIN, PLAIN, PLAIN], rc, 0, cl);
        // 妻 (棟の両端の三角)
        for (const e of [-1, 1]) {
          const nl = alongX ? [e, 0] : [0, e];
          W.tri(loc(e * A, -Cc, y1), loc(e * A, Cc, y1), loc(e * A, 0, y1 + rh), nW(nl[0], nl[1]), [PLAIN, PLAIN, PLAIN], wc, b.wall);
        }
      }
    } else {   // hip / cone: 棟の長さ = 長い辺 - 短い辺 (cone は 0)
      const rl = rk === 'cone' ? 0 : Math.abs(hx - hz) * 2, along = hx >= hz;
      const A = along ? hx : hz, Cc = along ? hz : hx;
      const loc = (a, c, y) => (along ? P(a, y, c) : P(c, y, a));
      const ra = A + ov, rc2 = Cc + ov, rhh = rh * (1 + ov / Cc);
      const r0 = rl / 2;
      for (const s of [-1, 1]) {
        const cl = wr && (s > 0 ? [wr[2], wr[2], wr[3], wr[3]] : [wr[0], wr[0], wr[1], wr[1]]);
        T.quad(loc(-ra, s * rc2, y1 - 0.1), loc(ra, s * rc2, y1 - 0.1), loc(r0, 0, y1 + rhh), loc(-r0, 0, y1 + rhh), null, [PLAIN, PLAIN, PLAIN, PLAIN], rc, 0, cl);
        T.tri(loc(s * ra, -rc2, y1 - 0.1), loc(s * ra, rc2, y1 - 0.1), loc(s * r0, 0, y1 + rhh), null, [PLAIN, PLAIN, PLAIN], rc, 0, wr && [wr[1], wr[1], wr[3]]);
      }
    }
  }

  // ---------- 建物を作る ----------
  for (const b of G.buildings) addBuilding(b);
  const clockBuf = new Buf();
  for (const q of clockQuads) clockBuf.quad(q[0], q[1], q[2], q[3], q[4], [[0, 0], [1, 0], [1, 1], [0, 1]], C('#ffffff'));
  const meshOf = (geo, mat, name, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.castShadow = shadow; m.receiveShadow = true; api.group.add(m); return m; };
  bufs.forEach((B, ai) => {
    const gw = B.wall.geometry(true), gt = B.trim.geometry(false), gs = B.sign.geometry(false);
    if (gw) { const m = meshOf(gw, wallMat, 'park_walls_' + ai); m.visible = !!low; wallMeshes.push(m); }
    if (gt) meshOf(gt, trimMat, 'park_trim_' + ai);
    if (gs) meshOf(gs, signMat, 'park_signs_' + ai, false);
    if (kit) {   // 店の窓・壁灯の玉・ネオン (色ごと)
      const g1 = B.shopglass.geometry(false), g2 = B.lamp.geometry(false);
      if (g1) meshOf(g1, kit.shopMat, 'park_facade_shop_' + ai, false);
      if (g2) meshOf(g2, kit.lampMat, 'park_facade_lamp_' + ai, false);
      for (const [c, nb] of Object.entries(B.neon)) { const gn = nb.geometry(false); if (gn) meshOf(gn, kit.neonMat(c), 'park_facade_neon_' + ai, false); }
    }
  });
  const gc = clockBuf.geometry(false); if (gc) meshOf(gc, clockMat, 'park_clocks', false);
  // 旗の飾りと煙突の煙・ネオンのまたたき (段階 7)。?nofx で無効
  const noFx = new URLSearchParams(location.search).has('nofx');
  const bunting = noFx ? null : buildBunting({ gen: G, ground, group: api.group }), smoke = noFx ? null : buildSmoke({ chimneys, group: api.group, low });
  if (bunting && bunting.lanterns.length) {   // ちょうちん (旗の綱につるす。夜は光る)
    const lm = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffb25c', emissiveIntensity: 0, roughness: 0.6 }); lm.userData.glow = 1.4; emissive.push(lm);
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.3, 0).scale(1, 1.25, 1), lm, bunting.lanterns.length); mesh.name = 'park_lanterns';
    const M = new THREE.Matrix4(); bunting.lanterns.forEach((l, i) => { M.makeTranslation(l[0], l[1], l[2]); mesh.setMatrixAt(i, M); mesh.setColorAt(i, l[3]); }); mesh.castShadow = false; api.group.add(mesh);
  }
  const furn = buildFurn({ gen: G, ground, group: api.group, col });   // 屋台のワゴン・案内標識・ごみ箱
  api.stats.furn = furn ? furn.counts : null;
  api.stats.bunting = bunting ? bunting.strings : 0; api.stats.chimneys = chimneys.length;
  api.update = (t, x, z) => {
    t %= 3600;   // 秒が大きいと float の精度が足りずシェーダのゆれがぎくしゃくする (1 時間でつなぎ目が 1 回)
    bunting?.update(t); smoke?.update(t, x, z);
    if (kit) Object.values(kit.neonMats).forEach((m, i) => { const f = (t * 0.21 + i * 0.37) % 1; m.userData.glow = 1.8 * (0.92 + 0.08 * Math.sin(t * 6.3 + i * 2)) * (f < 0.016 ? 0.2 : 1); });   // ネオンのわずかなゆらぎと、ときどきの消えかけ
  };
  api.stats.buildings = G.buildings.length;
  api.stats.facadeTris = bufs.reduce((n, B) => n + (B.shopglass.p.length + B.lamp.p.length + Object.values(B.neon).reduce((m, nb) => m + nb.p.length, 0)) / 9, 0) | 0;   // 細部のうち別のメッシュにした分 (壁・縁取り・看板の中の増え分は含まない)
  api.stats.trisAll = bufs.reduce((n, B) => n + (B.wall.p.length + B.trim.p.length + B.sign.p.length) / 9, 0) | 0;

  // ---------- 内側の道・広場 ----------
  const PATHCOL = { avenue: '#ecc4dc', town: '#a9a7ad', valley: '#c9b087', forest: '#d8c6a0', harbor: '#c8b79c', sweet: '#f6d3e4', night: '#8d8798' };
  const PLAZACOL = { avenue: ['#f3d6e6', '#ffffff'], town: ['#b9b7bd', '#d8d4c8'], valley: ['#d6c29a', '#a98d63'], forest: ['#e8d9b8', '#cfe3b0'], harbor: ['#d2c3a6', '#9fb8c8'], sweet: ['#ffe0ee', '#fff6c9'], night: ['#9b95a8', '#6f6a80'] };
  const byCol = {};
  for (const p of G.paths) (byCol[PATHCOL[AC(p.a).kind]] = byCol[PATHCOL[AC(p.a).kind]] || []).push(...ctx.stripPos(p.pts, p.w, 0.19));
  for (const [c, pos] of Object.entries(byCol)) api.group.add(ctx.flat(pos, c, 0.19));
  for (const pl of G.plazas) {
    const [c0, c1] = PLAZACOL[AC(pl.a).kind], pos = [], cl = [], N = 40, rings = [0.0, 0.3, 0.88, 1.0], cols = [C(c1), C(c0), C(c1)];
    for (let ri = 0; ri < 3; ri++) for (let k = 0; k < N; k++) {
      const a0 = k / N * Math.PI * 2, a1 = (k + 1) / N * Math.PI * 2;
      const pt = (r, a) => { const x = pl.x + Math.cos(a) * pl.r * r, z = pl.z + Math.sin(a) * pl.r * r; return [x, ground(x, z) + 0.2 + ri * 0.005, z]; };
      const q = [pt(rings[ri], a0), pt(rings[ri + 1], a0), pt(rings[ri + 1], a1), pt(rings[ri], a1)];
      for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...q[i]); cl.push(cols[ri].r, cols[ri].g, cols[ri].b); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
    m.receiveShadow = true; api.group.add(m);
    if (!pl.feat) {   // 中心の噴水 (台座 + 水 + 噴き上げ)
      const y = ground(pl.x, pl.z), R = Math.min(3.6, pl.r * 0.25), g2 = new THREE.Group(); g2.position.set(pl.x, y, pl.z);
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.05, 0.7, 20), std('#e9e2d4', 0.7)); basin.position.y = 0.35; basin.castShadow = basin.receiveShadow = true; g2.add(basin);
      const water = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.88, R * 0.88, 0.05, 20), new THREE.MeshStandardMaterial({ color: '#7fc6e8', roughness: 0.15, metalness: 0.1 })); water.position.y = 0.66; g2.add(water);
      const col2 = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 2.4, 10), std('#e9e2d4', 0.7)); col2.position.y = 1.5; col2.castShadow = true; g2.add(col2);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), std('#bfe6f7', 0.3)); top.position.y = 2.9; g2.add(top);
      api.group.add(g2);
      col.circle.push([pl.x, pl.z, R + 0.2, y - 1, y + 1.2]);
    }
  }

  // ---------- 植え込み・街灯・ベンチ ----------
  const M4 = new THREE.Matrix4(), PV = new THREE.Vector3(), Q = new THREE.Quaternion(), S1 = new THREE.Vector3(1, 1, 1), YA = new THREE.Vector3(0, 1, 0), tmpC = new THREE.Color();
  let smallProps = false;   // 植え込み・街灯・ベンチ (背が低い・細い物): スマホは影を落とさない (影の描画の負担を減らす)
  const inst = (geo, mat, list, f, color) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => { m.setMatrixAt(i, f(p, i)); if (color) m.setColorAt(i, color(p, i)); });
    m.castShadow = !(low && smallProps); m.receiveShadow = true; m.computeBoundingSphere(); api.group.add(m); return m;
  };
  smallProps = true;
  {
    const accent = (b) => A[b[6]].kind;
    const FL = { avenue: ['#ff7fb5', '#3fc8ff', '#ffd36b'], town: ['#e0585b', '#f2b632', '#ffffff'], valley: ['#e9803a', '#d94f6a', '#f2d24a'], forest: ['#ff9ecb', '#c7a6ff', '#ffe08a'], harbor: ['#ffffff', '#4fa0e8', '#ffd36b'], sweet: ['#ff7fb5', '#7fd6b8', '#ffd36b'], night: ['#8f6bd6', '#c0443c', '#e8e0c8'] };
    inst(new THREE.BoxGeometry(3.2, 0.55, 1.4).translate(0, 0.27, 0), std('#d9d2c4', 0.8), G.beds, (b) => M4.compose(PV.set(b[0], ground(b[0], b[1]), b[1]), Q.setFromAxisAngle(YA, b[2]), S1));
    inst(new THREE.BoxGeometry(2.9, 0.3, 1.1).translate(0, 0.65, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }), G.beds, (b) => M4.compose(PV.set(b[0], ground(b[0], b[1]), b[1]), Q.setFromAxisAngle(YA, b[2]), S1), (b) => tmpC.set(FL[accent(b)][b[5] % 3]));
    for (const b of G.beds) col.box.push([b[0], b[1], b[2] + Math.PI / 2, 0.7, 1.6, ground(b[0], b[1]) - 0.5, ground(b[0], b[1]) + 0.6]);
  }
  {
    const LAMP = { pink: '#ff9ccf', warm: '#fff0c8', torch: '#ffb15c', lantern: '#ffe08a', sea: '#bfe8ff', candy: '#ffb3d9', gas: '#b8ff9a' };
    const pole = new THREE.CylinderGeometry(0.1, 0.14, 4.4, 8).translate(0, 2.2, 0), gl = new THREE.SphereGeometry(0.45, 12, 8);
    inst(pole, std('#4b4561', 0.5), G.lamps, (p) => M4.compose(PV.set(p[0], ground(p[0], p[1]), p[1]), Q.identity(), S1));
    const kinds = [...new Set(G.lamps.map((l) => A[l[2]].lamp))];
    for (const k of kinds) { const list = G.lamps.filter((l) => A[l[2]].lamp === k); inst(gl, glowMat(LAMP[k], 1.1), list, (p) => M4.compose(PV.set(p[0], ground(p[0], p[1]) + 4.5, p[1]), Q.identity(), S1)); }
    for (const p of G.lamps) { const y = ground(p[0], p[1]); col.circle.push([p[0], p[1], 0.3, y - 0.5, y + 4.6]); }
    const bench = new THREE.BoxGeometry(2.2, 0.12, 0.6).translate(0, 0.5, 0), back = new THREE.BoxGeometry(2.2, 0.55, 0.1).translate(0, 0.85, -0.28);
    inst(bench, std('#8a6a4a', 0.7), G.benches, (p) => M4.compose(PV.set(p[0], ground(p[0], p[1]), p[1]), Q.setFromAxisAngle(YA, p[2]), S1));
    inst(back, std('#6f5238', 0.7), G.benches, (p) => M4.compose(PV.set(p[0], ground(p[0], p[1]), p[1]), Q.setFromAxisAngle(YA, p[2]), S1));
    for (const b of G.benches) col.box.push([b[0], b[1], b[2], 1.1, 0.4, ground(b[0], b[1]), ground(b[0], b[1]) + 1.1]);
  }
  smallProps = false;

  // ---------- 木 ----------
  {
    const kinds = {
      round: { trunk: new THREE.CylinderGeometry(0.22, 0.34, 3.0, 7).translate(0, 1.5, 0), crown: new THREE.IcosahedronGeometry(2.7, 1).scale(1, 0.9, 1).translate(0, 4.8, 0), colors: ['#5f8f3f', '#6c9a44', '#4f7f3a', '#78a54e'] },
      blossom: { trunk: new THREE.CylinderGeometry(0.2, 0.32, 2.8, 7).translate(0, 1.4, 0), crown: new THREE.IcosahedronGeometry(2.6, 1).scale(1.05, 0.85, 1.05).translate(0, 4.5, 0), colors: ['#f7b8d0', '#f4a6c4', '#fbd0df', '#e9a0d0'] },
      pine: { trunk: new THREE.CylinderGeometry(0.2, 0.3, 2.2, 7).translate(0, 1.1, 0), crown: mergeGeos([new THREE.ConeGeometry(2.6, 5.2, 9).translate(0, 4.6, 0), new THREE.ConeGeometry(1.9, 4.2, 9).translate(0, 7.4, 0)]), colors: ['#3d6b3a', '#2f5f3a', '#486f3a'] },
      palm: { trunk: new THREE.CylinderGeometry(0.2, 0.34, 7.0, 7).translate(0, 3.5, 0), crown: mergeGeos([new THREE.SphereGeometry(3.4, 10, 6).scale(1, 0.32, 1).translate(0, 7.2, 0), new THREE.ConeGeometry(1.2, 1.4, 6).translate(0, 8.0, 0)]), colors: ['#3f8f45', '#4f9f4a', '#357f3f'] },
      dead: { trunk: new THREE.CylinderGeometry(0.14, 0.34, 4.6, 6).translate(0, 2.3, 0), crown: mergeGeos([new THREE.CylinderGeometry(0.06, 0.14, 2.6, 5).rotateZ(0.9).translate(-0.9, 4.8, 0), new THREE.CylinderGeometry(0.06, 0.14, 2.4, 5).rotateZ(-0.8).translate(0.9, 4.4, 0), new THREE.CylinderGeometry(0.05, 0.12, 2.0, 5).rotateX(0.9).translate(0, 5.2, -0.8), new THREE.CylinderGeometry(0.05, 0.1, 1.8, 5).rotateX(-1.0).translate(0, 3.6, 0.8)]), colors: ['#4a4048', '#3f3a44'], dead: true },
      lolli: { trunk: new THREE.CylinderGeometry(0.12, 0.16, 3.4, 8).translate(0, 1.7, 0), crown: new THREE.SphereGeometry(1.9, 14, 10).translate(0, 4.4, 0), colors: ['#ff8fbd', '#7fd6b8', '#a58bff', '#ffc65c', '#ff9d7a'] },
    };
    const rnd = mulberry(7);
    for (const [k, d] of Object.entries(kinds)) {
      const list = G.trees.filter((t) => t[2] === k);
      if (!list.length) continue;
      const f = (t) => M4.compose(PV.set(t[0], ground(t[0], t[1]), t[1]), Q.setFromAxisAngle(YA, rnd() * 6.28), S1.set(t[3], t[3], t[3]));
      inst(d.trunk, std(d.dead ? '#4a4048' : k === 'lolli' ? '#f4efe6' : '#6b5540', 0.9), list, f);
      inst(d.crown, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: !d.dead && k !== 'lolli' }), list, f, (t, i) => tmpC.set(d.colors[(i * 7 + Math.floor(t[0])) % d.colors.length]));
      for (const t of list) { const y = ground(t[0], t[1]); col.circle.push([t[0], t[1], 0.4, y - 0.5, y + 4]); }
    }
    S1.set(1, 1, 1);
    api.stats.trees = G.trees.length;
  }

  // ---------- 門 (入口の道に架かる。名前の看板つき) ----------
  for (const a of G.arches) {
    const gy = ground(a.x, a.z), ky = A[a.a].kind;
    const g = new THREE.Group(); g.position.set(a.x, gy, a.z); g.rotation.y = a.yaw;
    const sg = G.signs[a.sign], pc = std(ky === 'night' ? '#4a3f5f' : ky === 'valley' ? '#8a6a45' : ky === 'town' ? '#7a8088' : '#fbf7ff', 0.6);
    const half = a.span / 2;
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, a.h, 1.6), pc); p.position.set(s * half, a.h / 2, 0); p.castShadow = true; g.add(p);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 2.0), std(sg.bg, 0.5)); cap.position.set(s * half, a.h + 0.25, 0); g.add(cap);
      const px = a.x + Math.cos(a.yaw) * s * half, pz = a.z - Math.sin(a.yaw) * s * half;
      col.circle.push([px, pz, 1.1, gy - 1, gy + a.h]);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(a.span + 1.6, 1.1, 1.3), std(sg.bg, 0.5)); beam.position.set(0, a.h - 0.2, 0); beam.castShadow = true; g.add(beam);
    const bw = a.span - 0.5, bh = bw / 4, uv = signUv(a.sign), sb = new Buf();
    for (const [z, flip] of [[0.7, false], [-0.7, true]]) {
      const x0 = flip ? bw / 2 : -bw / 2, x1 = flip ? -bw / 2 : bw / 2;
      sb.quad([x0, a.h + 0.5, z], [x1, a.h + 0.5, z], [x1, a.h + 0.5 + bh, z], [x0, a.h + 0.5 + bh, z], [0, 0, flip ? -1 : 1], [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]], C('#ffffff'));
    }
    const sm = new THREE.Mesh(sb.geometry(false), signMat); g.add(sm);
    for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.3, bh + 0.6, 0.3), pc); st.position.set(s * (bw / 2 - 0.4), a.h + 0.5 + bh / 2, 0); g.add(st); }
    api.group.add(g);
  }

  // ---------- 特別な物 ----------
  const lava = glowMat('#ff7a2f', 1.4), lampG = glowMat('#fff2b0', 1.8);
  for (const p of G.props) {
    const gy = ground(p.x, p.z), g = new THREE.Group(), rnd = mulberry((p.n || 1) + Math.floor(p.x));
    g.position.set(p.x, gy, p.z); g.rotation.y = p.yaw || 0;
    if (p.k === 'volcano') {
      const R = p.r, Hh = 24, geo = new THREE.ConeGeometry(R, Hh, 22, 6, true), pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) { const y = pos.getY(i), t = (y + Hh / 2) / Hh; const j = (Math.sin(pos.getX(i) * 1.7 + pos.getZ(i) * 0.9) + Math.sin(pos.getZ(i) * 2.3)) * 0.35 * (1 - t); pos.setX(i, pos.getX(i) * (1 + j * 0.12)); pos.setZ(i, pos.getZ(i) * (1 + j * 0.12)); pos.setY(i, y + j * 0.4); }
      geo.computeVertexNormals();
      const cone = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#a38b72', roughness: 1, flatShading: true, side: THREE.DoubleSide })); cone.position.y = Hh / 2; cone.castShadow = cone.receiveShadow = true; g.add(cone);
      const crater = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.2, R * 0.26, 1.2, 14), new THREE.MeshStandardMaterial({ color: '#3b322d', roughness: 1 })); crater.position.y = Hh - 0.4; g.add(crater);
      const mouth = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.17, R * 0.17, 0.2, 14), lava); mouth.position.y = Hh + 0.2; g.add(mouth);
      for (let k = 0; k < 6; k++) { const a = k / 6 * 6.28 + 0.3, rr = R * 0.9; const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3 + rnd() * 1.2, 0), std('#6d5f50', 1)); rock.position.set(Math.cos(a) * rr, 0.8, Math.sin(a) * rr); rock.castShadow = true; g.add(rock); }
      col.circle.push([p.x, p.z, R * 0.92, gy - 1, gy + Hh]);
    } else if (p.k === 'lighthouse') {
      for (let k = 0; k < 6; k++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(3.2 - k * 0.22, 3.4 - k * 0.22, 4.4, 20), std(k % 2 ? '#c0443c' : '#f6f2ea', 0.6)); s.position.y = 2.2 + k * 4.4; s.castShadow = s.receiveShadow = true; g.add(s); }
      const gal = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.5, 20), std('#394a5c', 0.6)); gal.position.y = 26.6; g.add(gal);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.6, 14), lampG); lamp.position.y = 28.2; g.add(lamp);
      const roofc = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.6, 14), std('#c0443c', 0.6)); roofc.position.y = 30.7; roofc.castShadow = true; g.add(roofc);
      col.circle.push([p.x, p.z, 3.8, gy - 1, gy + 28]);
    } else if (p.k === 'galleon') {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(8, 3.4, 26), std('#6b4a2e', 0.8)); hull.position.y = 2.3; hull.castShadow = hull.receiveShadow = true; g.add(hull);
      const bow = new THREE.Mesh(new THREE.BoxGeometry(5.5, 3.0, 5), std('#6b4a2e', 0.8)); bow.position.set(0, 2.9, 14.5); bow.rotation.x = 0.0; g.add(bow);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.3, 25), std('#b99665', 0.9)); deck.position.y = 4.15; g.add(deck);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.6, 6), std('#8a5a38', 0.8)); cabin.position.set(0, 6, -9); cabin.castShadow = true; g.add(cabin);
      for (const [z, h] of [[-1, 17], [6, 14]]) {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, h, 8), std('#5a3d26', 0.9)); mast.position.set(0, 4 + h / 2, z); mast.castShadow = true; g.add(mast);
        const sail = new THREE.Mesh(new THREE.PlaneGeometry(6.6, h * 0.6), new THREE.MeshStandardMaterial({ color: '#f6f0e0', roughness: 0.9, side: THREE.DoubleSide })); sail.position.set(0, 4 + h * 0.62, z + 0.1); g.add(sail);
      }
      col.box.push([p.x, p.z, p.yaw || 0, 4.2, 13.5, gy - 1, gy + 6]);
    } else if (p.k === 'rocks') {
      const N = 6;
      for (let k = 0; k < N; k++) {
        const a = rnd() * 6.28, rr = rnd() * p.r * 0.55, sz = 1.2 + rnd() * 2.2, rock = new THREE.Mesh(new THREE.IcosahedronGeometry(sz, 0), std(['#8a7d6c', '#7a6e60', '#948775'][k % 3], 1));
        rock.position.set(Math.cos(a) * rr, sz * 0.5, Math.sin(a) * rr); rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); rock.scale.y = 0.75; rock.castShadow = rock.receiveShadow = true; g.add(rock);
        const wx = p.x + (Math.cos(a) * rr) * Math.cos(p.yaw || 0) + (Math.sin(a) * rr) * Math.sin(p.yaw || 0), wz = p.z - (Math.cos(a) * rr) * Math.sin(p.yaw || 0) + (Math.sin(a) * rr) * Math.cos(p.yaw || 0);
        col.circle.push([wx, wz, sz * 0.85, gy - 1, gy + sz]);
      }
    } else if (p.k === 'mushrooms') {
      const caps = ['#e8627a', '#f2a65a', '#b98ae8', '#ff8fbd'];
      for (let k = 0; k < 5; k++) {
        const a = rnd() * 6.28, rr = rnd() * p.r * 0.7, h = 2.2 + rnd() * 2.4, cr = 1.5 + rnd() * 1.2;
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, h, 10), std('#f6efe0', 0.8)); stem.position.set(Math.cos(a) * rr, h / 2, Math.sin(a) * rr); stem.castShadow = true; g.add(stem);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(cr, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(caps[k % 4], 0.6)); cap.position.set(Math.cos(a) * rr, h, Math.sin(a) * rr); cap.castShadow = true; g.add(cap);
        const wx = p.x + Math.cos(a) * rr * Math.cos(p.yaw || 0) + Math.sin(a) * rr * Math.sin(p.yaw || 0), wz = p.z - Math.cos(a) * rr * Math.sin(p.yaw || 0) + Math.sin(a) * rr * Math.cos(p.yaw || 0);
        col.circle.push([wx, wz, 0.75, gy - 1, gy + h]);
      }
    } else if (p.k === 'lollipops') {
      const cs = ['#ff8fbd', '#7fd6b8', '#a58bff', '#ffc65c'];
      for (let k = 0; k < 3; k++) {
        const a = rnd() * 6.28, rr = rnd() * p.r * 0.6, h = 4 + rnd() * 2;
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, h, 8), std('#f6efe6', 0.6)); stick.position.set(Math.cos(a) * rr, h / 2, Math.sin(a) * rr); g.add(stick);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.4, 20).rotateX(Math.PI / 2), std(cs[k % 4], 0.5)); disc.position.set(Math.cos(a) * rr, h + 1.1, Math.sin(a) * rr); disc.castShadow = true; g.add(disc);
        const wx = p.x + Math.cos(a) * rr * Math.cos(p.yaw || 0) + Math.sin(a) * rr * Math.sin(p.yaw || 0), wz = p.z - Math.cos(a) * rr * Math.sin(p.yaw || 0) + Math.sin(a) * rr * Math.cos(p.yaw || 0);
        col.circle.push([wx, wz, 0.4, gy - 1, gy + h]);
      }
    } else if (p.k === 'graves') {
      const N = 22, rock = std('#8d8a96', 0.9);
      for (let k = 0; k < N; k++) {
        const a = rnd() * 6.28, rr = Math.sqrt(rnd()) * p.r * 0.85, h = 0.9 + rnd() * 0.7;
        const stone = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 0.25), rock); stone.position.set(Math.cos(a) * rr, h / 2, Math.sin(a) * rr); stone.rotation.set((rnd() - 0.5) * 0.15, rnd() * 6.28, (rnd() - 0.5) * 0.15); stone.castShadow = true; g.add(stone);
        const wx = p.x + Math.cos(a) * rr * Math.cos(p.yaw || 0) + Math.sin(a) * rr * Math.sin(p.yaw || 0), wz = p.z - Math.cos(a) * rr * Math.sin(p.yaw || 0) + Math.sin(a) * rr * Math.cos(p.yaw || 0);
        col.circle.push([wx, wz, 0.5, gy - 1, gy + h]);
      }
    } else if (p.k === 'pad') {   // 観覧車の台座 (輪の模様。観覧車は parkrides.js が上に置く)
      for (const [r, c] of [[p.r, '#fff6c9'], [p.r * 0.8, '#ffb3d9'], [p.r * 0.6, '#c9f0df']]) { const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.04, 40), std(c, 0.8)); d.position.y = 0.24 + (p.r - r) * 0.002; d.receiveShadow = true; g.add(d); }
    }
    api.group.add(g);
  }

  // スマホ: 動かない小物のメッシュを材質 × 区画でまとめる (描画の呼び出しを減らす。PC は今までどおり)
  if (low) api.stats.merged = mergeStaticMeshes(api.group, { skip: (o) => !o.visible || /^park_(walls|trim|signs|clocks|facade|bunting|smoke|furn|lanterns)/.test(o.name) });

  // ---------- 乗り物 (段階 3。観覧車・メリーゴーラウンド・コースター) ----------
  api.rides = buildRides({ cfg, ground, std, glowMat, group, col, emissive });

  api.stats.signs = G.signs.length;
  api.stats.meshes = api.group.children.length;
  api.setWallsVisible = (v) => wallMeshes.forEach((m) => { m.visible = v; });
  return api;
}
