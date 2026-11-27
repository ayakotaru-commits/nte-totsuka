// 千葉ドリームランド (舞浜の北側に作る架空のテーマパーク。計画は PARK_PLAN.md、設定は data/park.json → tools/park.py → public/data/park.json)。
// 段階 0: 敷地の中の実在の道路・木・橋脚・建物・歩道を、線路の延長 (detail/railext.js) の区間を読んだ後に省ける (createParkCut)。
// 段階 1 (土台): パークが敷地の地面を持つ (cutChunk が区間の地形の高さを、平らな高さ + 縁のなだらかなつなぎ + 湖の掘り込みに書き換える)、
//   buildPark が外周の柵・園内の道・サンライズ・プラザ・ムーンレイク (水面と岸)・サーチライト・タワー (光線は夜だけ)・ネオン・アベニューの街灯とベンチ・
//   駅からゲートへの案内板・ゲートの看板を作る。当たり判定は world.addColliders。
// 区間のファイル (data/rail_ext/c_*.json) は書き換えない。変えるのは読んだ後 (メモリの上)。
import * as THREE from 'three';
import { H } from '../terrain.js';
import { canvasTexture } from './util.js';
import { LOGO_FONT, logoFontReady } from './parkfont.js';
import { buildAreas } from './parkareas.js';
import { buildAvenuePaving, buildAreaPaving } from './parkpaving.js';
import { buildShow, showClock as showClockNow } from './parkshow.js';
import { buildCastle, castleLakeMask, castleFrame } from './parkcastle.js';
import { buildEntrance } from './parkentrance.js';

const bboxOf = (p) => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return [x0, z0, x1, z1];
};
function inPoly(x, z, p) {
  let ins = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
function segDist(px, pz, a, b) {
  const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * ex + (pz - a[1]) * ez) / l2));
  return Math.hypot(px - a[0] - ex * t, pz - a[1] - ez * t);
}
const polyDist = (x, z, p) => { let d = Infinity; for (let i = 0, j = p.length - 1; i < p.length; j = i++) d = Math.min(d, segDist(x, z, p[j], p[i])); return d; };
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// パークの地面の決まり (cutChunk と buildPark が同じ式を使う)。weight = 平らな高さにする割合 (敷地の中 1、縁の skirt m で 0、駅の範囲の近くは 0)
export function parkGround(cfg) {
  const site = cfg.site, g = cfg.ground, lake = cfg.ellipses['ムーンレイク'], L = lake.lake;
  const prot = (cfg.protect || []).map((q) => q.poly);
  const level = g.level, skirt = g.skirt, fade = g.protectFade || 25;
  const [bx0, bz0, bx1, bz1] = bboxOf(site);
  const weight = (x, z) => {
    if (x < bx0 - skirt || x > bx1 + skirt || z < bz0 - skirt || z > bz1 + skirt) return 0;
    const dp = inPoly(x, z, site) ? 0 : polyDist(x, z, site);
    let w = 1 - smooth(dp / skirt);
    if (w <= 0) return 0;
    for (const q of prot) { const d = inPoly(x, z, q) ? 0 : polyDist(x, z, q); if (d < fade) w *= smooth(d / fade); }
    return w;
  };
  const [lcx, lcz] = lake.center;
  const castleMask = cfg.castle ? castleLakeMask(cfg.castle) : null;   // 段階 9: 城の島・堤道の上は湖を掘らない
  const lakeDepth = (x, z) => {
    const dx = x - lcx, dz = z - lcz, rho = Math.hypot(dx / lake.rx, dz / lake.rz);
    if (rho >= 1) return 0;
    const rr = Math.hypot(dx, dz), edge = rho > 1e-6 ? (1 - rho) * rr / rho : Math.min(lake.rx, lake.rz);   // 岸までの距離 (中心から見た向きで)
    return L.depth * smooth(edge / L.shore) * (castleMask ? castleMask(x, z) : 1);
  };
  // 実在の地形の高さ real のところの、パークの地面の高さ。実在の施設の出っ張り・水の穴は level ± 2.5 m に抑えてから混ぜる
  const height = (x, z, real) => {
    const w = weight(x, z), c = Math.max(level - 2.5, Math.min(level + 2.5, real));
    return (w > 0 ? level * w + (real + (c - real) * w) * (1 - w) : real) - (w > 0 ? lakeDepth(x, z) * w : 0);
  };
  return { weight, lakeDepth, height, level, skirt };
}

const bitsDecode = (s, n) => { const b = atob(s), out = new Uint8Array(n); for (let k = 0; k < n; k++) out[k] = (b.charCodeAt(k >> 3) >> (k & 7)) & 1; return out; };
const bitsEncode = (a) => { const by = new Uint8Array((a.length + 7) >> 3); for (let k = 0; k < a.length; k++) if (a[k]) by[k >> 3] |= 1 << (k & 7); let s = ''; for (const v of by) s += String.fromCharCode(v); return btoa(s); };

// 敷地の中の実在のデータを省き、地形を書き換える。cfg = public/data/park.json、ext = rail_ext/index.json (terrain・coarse・chunk の格子の定め)
export function createParkCut(cfg, ext) {
  const site = cfg.site, [bx0, bz0, bx1, bz1] = bboxOf(site);
  const prot = (cfg.protect || []).map((q) => ({ poly: q.poly, box: bboxOf(q.poly) }));
  const protectedAt = (x, z) => prot.some((q) => x >= q.box[0] && x <= q.box[2] && z >= q.box[1] && z <= q.box[3] && inPoly(x, z, q.poly));
  const hidden = (x, z) => x >= bx0 && x <= bx1 && z >= bz0 && z <= bz1 && inPoly(x, z, site) && !protectedAt(x, z);
  const ground = parkGround(cfg);
  // 道・歩道 ([幅, x0, z0, x1, z1, ...]) を、4 m ずつの区切りの中点が省く範囲に入るものを除いて切り分ける。敷地にかからない線は元のまま
  function clipLine(rd) {
    let touch = false;
    for (let k = 1; k + 1 < rd.length; k += 2) if (rd[k] >= bx0 - 5 && rd[k] <= bx1 + 5 && rd[k + 1] >= bz0 - 5 && rd[k + 1] <= bz1 + 5) { touch = true; break; }
    if (!touch) return [rd];
    const out = []; let cur = null, any = false;
    for (let k = 1; k + 3 < rd.length; k += 2) {
      const ax = rd[k], az = rd[k + 1], bx = rd[k + 2], bz = rd[k + 3], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4));
      for (let t = 0; t < n; t++) {
        const x0 = ax + (bx - ax) * t / n, z0 = az + (bz - az) * t / n, x1 = ax + (bx - ax) * (t + 1) / n, z1 = az + (bz - az) * (t + 1) / n;
        if (hidden((x0 + x1) / 2, (z0 + z1) / 2)) { any = true; cur = null; continue; }
        if (!cur) { cur = [rd[0], x0, z0]; out.push(cur); }
        cur.push(x1, z1);
      }
    }
    return any ? out : [rd];
  }
  const clipLines = (list) => { const out = []; for (const rd of list || []) out.push(...clipLine(rd)); return out; };

  // 地形: 区間 (a, b) の細かい格子 (5 m) に、パークの地面の高さを書き込む。粗い格子 (25 m) の升目のうち、敷地 + 縁にかかるものは、細かい格子で埋めて描かない
  function cutTerrain(D, a, b) {
    if (!ext || !D.coarse) return;
    const T = ext.terrain, C = ext.coarse, CH = ext.chunk, K = D.coarse, SK = ground.skirt;
    if ((a + 1) * CH < bx0 - SK - 60 || a * CH > bx1 + SK + 60 || (b + 1) * CH < bz0 - SK - 60 || b * CH > bz1 + SK + 60) return;
    const rng = (lo, step, n, k) => [Math.max(0, Math.ceil((k * CH - lo) / step - 0.5)), Math.min(n, Math.ceil(((k + 1) * CH - lo) / step - 0.5))];
    const [ci0, ci1] = rng(T.x0, T.step, T.nx, a), [cj0, cj1] = rng(T.z0, T.step, T.nz, b);
    const key = (i, j) => j * 100000 + i;
    const fine = new Map();
    if (D.fine) for (const row of D.fine.rows) for (let k = 2; k < row.length; k++) fine.set(key(row[1] + k - 2, row[0]), row[k]);
    const coarseAt = (x, z) => {
      let fx = (x - C.x0) / C.step, fz = (z - C.z0) / C.step;
      fx = Math.max(0, Math.min(C.nx - 1.0001, fx)); fz = Math.max(0, Math.min(C.nz - 1.0001, fz));
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, ii = i - K.i0, jj = j - K.j0;
      if (ii < 0 || jj < 0 || ii + 1 >= K.ni || jj + 1 >= K.nj) return null;
      const g = (p, q) => K.h[(jj + q) * K.ni + ii + p] / 100;
      return (g(0, 0) * (1 - u) + g(1, 0) * u) * (1 - v) + (g(0, 1) * (1 - u) + g(1, 1) * u) * v;
    };
    const realAt = (i, j, x, z) => { const f = fine.get(key(i, j)); return f !== undefined ? f / 100 : coarseAt(x, z); };
    const cover = new Set(), cells = bitsDecode(K.cells, (K.ni - 1) * (K.nj - 1));
    const per = C.step / T.step, [oi0, oj0, oi1, oj1] = K.own;
    let changed = 0;
    for (let cj = oj0; cj < oj1; cj++) for (let ci = oi0; ci < oi1; ci++) {
      const x0 = C.x0 + ci * C.step, z0 = C.z0 + cj * C.step, mx = x0 + C.step / 2, mz = z0 + C.step / 2;
      if (mx < bx0 - SK - 20 || mx > bx1 + SK + 20 || mz < bz0 - SK - 20 || mz > bz1 + SK + 20) continue;
      const d = inPoly(mx, mz, site) ? 0 : polyDist(mx, mz, site);
      if (d > SK + 18) continue;
      const i0 = Math.round((x0 - T.x0) / T.step), j0 = Math.round((z0 - T.z0) / T.step);
      for (let q = 0; q <= per; q++) for (let p = 0; p <= per; p++) cover.add(key(i0 + p, j0 + q));
      const bi = (cj - K.j0) * (K.ni - 1) + (ci - K.i0);
      if (cj - K.j0 >= 0 && ci - K.i0 >= 0 && ci - K.i0 < K.ni - 1 && cj - K.j0 < K.nj - 1 && cells[bi]) { cells[bi] = 0; changed++; }
    }
    if (!cover.size) return;
    const heights = new Map();
    for (const k of cover) {
      const j = Math.floor(k / 100000), i = k - j * 100000;
      if (i < ci0 - 1 || i > ci1 + 1 || j < cj0 - 1 || j > cj1 + 1) continue;
      const x = T.x0 + i * T.step, z = T.z0 + j * T.step, real = realAt(i, j, x, z);
      if (real === null) continue;
      heights.set(k, Math.round(ground.height(x, z, real) * 100));
    }
    for (const [k, v] of heights) fine.set(k, v);
    // 行 [j, i0, 値...] に作り直す
    const ks = [...fine.keys()].sort((p, q) => p - q), rows = [];
    let cur = null, last = -2;
    for (const k of ks) {
      const j = Math.floor(k / 100000), i = k - j * 100000;
      if (cur && cur[0] === j && i === last + 1) cur.push(fine.get(k)); else { cur = [j, i, fine.get(k)]; rows.push(cur); }
      last = i;
    }
    D.fine = { own: D.fine ? D.fine.own : [ci0, cj0, ci1, cj1], rows };
    K.cells = bitsEncode(cells);
  }

  return {
    hidden, clipLines, ground,
    // 区間 D (railext.js が読んだ JSON。a, b = 区間の番号) から省き、地形を書き換える。省いた数を返す
    cutChunk(D, a, b) {
      const n0 = (D.trees || []).length + (D.piers || []).length + (D.buildings || []).length + (D.roads || []).length + (D.walks || []).length;
      if (D.trees) D.trees = D.trees.filter((t) => !hidden(t[0], t[2]));
      if (D.piers) D.piers = D.piers.filter((t) => !hidden(t[0], t[2]));
      if (D.buildings) D.buildings = D.buildings.filter((q) => { const r = q[0]; let cx = 0, cz = 0; for (const p of r) { cx += p[0]; cz += p[1]; } return !hidden(cx / r.length, cz / r.length); });
      if (D.roads) D.roads = clipLines(D.roads);
      if (D.walks) D.walks = clipLines(D.walks);
      if (a !== undefined) cutTerrain(D, a, b);
      return n0 - ((D.trees || []).length + (D.piers || []).length + (D.buildings || []).length + (D.roads || []).length + (D.walks || []).length);
    },
  };
}

// パークの見た目と当たり判定。区間 (地形) を読み込んだ後でないと地面の高さが分からないので、update(x, z) を毎コマ呼び、地形が読めたら 1 回だけ作る
export function buildPark(cfg, world, opts = {}) {
  const group = new THREE.Group();
  group.name = 'park';
  const emissive = [];   // 夜に光らせる材質 (time.js)。地形が読めた後に作る材質もあるので、opts.sink (time.js が見る配列) へ作った時点で直接入れる
  if (opts.sink) { const base = emissive.push.bind(emissive); emissive.push = (...m) => { opts.sink.push(...m); return base(...m); }; }
  let built = false;
  const G = cfg.ground, gate = cfg.gate, plazaE = cfg.ellipses['サンライズ・プラザ'], lakeE = cfg.ellipses['ムーンレイク'], pg = parkGround(cfg);
  const ground = (x, z) => H(x, z);
  const glowMat = (color, glow = 1) => { const m = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: color, emissiveIntensity: 0, roughness: 0.5 }); m.userData.glow = glow; emissive.push(m); return m; };
  const beamMat = new THREE.MeshBasicMaterial({ color: '#c9ecff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  beamMat.userData.glow = 0.16; beamMat.userData.opacityOnly = true; emissive.push(beamMat);
  const lampPink = glowMat('#ff9ccf', 1.1), lampCyan = glowMat('#8fe8ff', 1.1), lampWarm = glowMat('#fff0c8', 1.0), towerLamp = glowMat('#fff6d0', 1.6);
  const wst = cfg.site.reduce((m, q) => (q[0] < m[0] ? q : m)), est = cfg.site.reduce((m, q) => (q[0] > m[0] ? q : m));   // 西の端・東の端の頂点 (3 つの区間が読めたか調べる)
  const ready = () => [gate.at, plazaE.center, [wst[0] + 6, wst[1] + 40], [est[0] - 6, est[1]], [lakeE.center[0], lakeE.center[1] + 100]].every((p) => ground(p[0], p[1]) > -100);

  const col = { circle: [], line: [], box: [] };
  const matCache = {};
  const std = (color, rough = 0.8) => matCache[color + rough] || (matCache[color + rough] = new THREE.MeshStandardMaterial({ color, roughness: rough }));
  const flatMat = (color, lift) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 - lift * 10, polygonOffsetUnits: -3 - lift * 10 });
  const flat = (pos, color, lift) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, flatMat(color, lift)); m.receiveShadow = true; return m;
  };
  // 地面に沿った帯 (道)。pts = [[x, z], ...]、closed = 輪
  function stripPos(pts, w, lift, closed = false) {
    const pos = [], n0 = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n0; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const n = Math.max(1, Math.ceil(L / 3)), nx = -(bz - az) / L * w / 2, nz = (bx - ax) / L * w / 2;
      for (let t = 0; t < n; t++) {
        const x0 = ax + (bx - ax) * t / n, z0 = az + (bz - az) * t / n, x1 = ax + (bx - ax) * (t + 1) / n, z1 = az + (bz - az) * (t + 1) / n;
        const q = [[x0 + nx, z0 + nz], [x0 - nx, z0 - nz], [x1 - nx, z1 - nz], [x1 + nx, z1 + nz]].map(([x, z]) => [x, ground(x, z) + lift, z]);
        for (const i2 of [0, 1, 2, 0, 2, 3]) pos.push(...q[i2]);
      }
    }
    return pos;
  }
  const ellPts = (c, rx, rz, n = 120) => { const out = []; for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; out.push([c[0] + rx * Math.cos(a), c[1] + rz * Math.sin(a)]); } return out; };
  // 楕円の塗りつぶし (中心から R 重 × S 分割)。uv = 楕円の中の位置 (0〜1)、color(r, a) で頂点色
  function ellipseMesh(c, rx, rz, lift, material, colorFn, yFn) {
    const pos = [], uv = [], cl = [], R = 14, S = 96;
    const at = (r, a) => { const x = c[0] + rx * r * Math.cos(a), z = c[1] + rz * r * Math.sin(a); return [x, yFn ? yFn(x, z, r) : ground(x, z) + lift, z, r * Math.cos(a) * 0.5 + 0.5, r * Math.sin(a) * 0.5 + 0.5, r, a]; };
    const push = (p) => { pos.push(p[0], p[1], p[2]); uv.push(p[3], p[4]); if (colorFn) { const k = colorFn(p[5], p[6]); cl.push(k[0], k[1], k[2]); } };
    for (let i = 0; i < R; i++) for (let k = 0; k < S; k++) {
      const a0 = k / S * Math.PI * 2, a1 = (k + 1) / S * Math.PI * 2, r0 = i / R, r1 = (i + 1) / R;
      const p00 = at(r0, a0), p01 = at(r0, a1), p10 = at(r1, a0), p11 = at(r1, a1);
      if (i === 0) [p00, p11, p10].forEach(push); else [p00, p01, p11, p00, p11, p10].forEach(push);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (colorFn) g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material); m.receiveShadow = true; return m;
  }

  function textTexture(w, h, a, b, text, sub) {
    return canvasTexture(w, h, (g) => {
      const grad = g.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, a); grad.addColorStop(0.5, '#8f7bff'); grad.addColorStop(1, b);
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#fff6c9'; g.lineWidth = h / 26; g.strokeRect(h / 22, h / 22, w - h / 11, h - h / 11);
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = 'rgba(60,20,110,0.6)'; g.shadowBlur = h / 32;
      g.font = `${h * (sub ? 0.4 : 0.46)}px ${LOGO_FONT}`; g.fillText(text, w / 2, h * (sub ? 0.4 : 0.5), w * 0.92);   // 名前は英語・ロゴの字体
      if (sub) { g.font = `600 ${h * 0.2}px sans-serif`; g.fillText(sub, w / 2, h * 0.78, w * 0.9); }
    });
  }

  function build() {
    built = true;
    const [gx, gz] = gate.at;
    // ---- 入口 (エントランス。園の顔。detail/parkentrance.js。?noentrance で、以前の看板だけの門に戻す = 確認用) ----
    const useEntrance = cfg.entrance && !new URLSearchParams(location.search).has('noentrance');
    if (useEntrance) {
      const t0 = performance.now();
      api.entrance = buildEntrance({ cfg, ground, std, glowMat, group, col, emissive, low: !!opts.low });
      console.info(`[park] 入口: 三角形 約 ${Math.round(api.entrance.stats.tris)}・部品 ${api.entrance.stats.meshes}${api.entrance.stats.merged ? `・まとめて ${api.entrance.stats.merged.before} → ${api.entrance.stats.merged.after}` : ''}、${(performance.now() - t0).toFixed(0)} ms`);
    }
    // ---- ゲートの看板 (柱 2 本 + 名前の板。柱の間は通れる。入口が無いときの以前の門) ----
    if (!useEntrance) {
      const fx = gate.face[0], fz = gate.face[1], yaw = Math.atan2(fx, fz), rx = fz, rz = -fx, half = gate.span / 2, H0 = gate.post, gy = ground(gx, gz);
      const sg = new THREE.Group(); sg.position.set(gx, gy, gz); sg.rotation.y = yaw;
      const post = std('#e9e2f5', 0.6);
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, H0 + 1, 12), post); m.position.set(s * half, (H0 + 1) / 2 - 1, 0); m.castShadow = true; sg.add(m);
        const px = gx + rx * s * half, pz = gz + rz * s * half, y = ground(px, pz);
        col.circle.push([px, pz, 0.65, y - 1, y + H0]);
      }
      const tex = textTexture(1024, 256, '#ff7fb5', '#3fc8ff', cfg.roman || cfg.name, '');
      const board = new THREE.Mesh(new THREE.BoxGeometry(gate.span + 1.6, 3.6, 0.5), [post, post, post, post, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }), std('#7f6ad9', 0.6)]);
      board.position.set(0, H0 - 0.6, 0); board.castShadow = true; sg.add(board);
      group.add(sg);
    }

    // ---- 園内の道 (幅つきの帯)。駅からゲートへの道・アベニュー・各エリアへの道・湖のまわりの散歩道 ----
    const roadPos = { stone: [], pink: [] };
    for (const p of cfg.paths) (p.name === 'ネオン・アベニュー' ? roadPos.pink : roadPos.stone).push(...stripPos(p.pts, p.width, p.name === 'ネオン・アベニュー' ? 0.2 : 0.18));
    const pr = cfg.promenade, prE = cfg.ellipses[pr.ellipse];
    const ring = ellPts(prE.center, prE.rx + pr.offset, prE.rz + pr.offset, 144);
    roadPos.stone.push(...stripPos(ring, pr.width, 0.19, true));
    group.add(flat(roadPos.stone, '#dcd2c2', 0.18), flat(roadPos.pink, '#ecc4dc', 0.2));
    // 段階 7: アベニューの舗装 (本通りのタイル・店の前の歩道。parkpaving.js。?nopaving で無効 = 確認用)
    {
      const av = cfg.gen && cfg.gen.areas.find((a) => a.detail === 'avenue' && a.terrace > 0), ap = cfg.paths.find((p) => p.name === 'ネオン・アベニュー');
      if (av && ap && !new URLSearchParams(location.search).has('nopaving')) buildAvenuePaving({ path: ap, terrace: av.terrace, ground, group });
      if (cfg.gen && !new URLSearchParams(location.search).has('nopaving')) buildAreaPaving({ gen: cfg.gen, ground, group, extra: cfg.paths.filter((p) => p.pave).map((p) => ({ a: cfg.gen.areas.findIndex((q) => q.name === p.pave), w: p.width, pts: p.pts })).filter((p) => p.a >= 0) });   // 各エリアの内側の道 (石畳・板張り・土・敷石・市松)
    }

    // ---- サンライズ・プラザ: 放射状の模様の舗装 ----
    {
      const tex = canvasTexture(1024, 1024, (g) => {
        const c = 512, cols = ['#f8ecd6', '#f2dce8', '#dcecf8', '#fbf3c8'];
        for (let k = 0; k < 24; k++) { g.fillStyle = cols[k % 4]; g.beginPath(); g.moveTo(c, c); g.arc(c, c, 520, k / 24 * Math.PI * 2, (k + 1) / 24 * Math.PI * 2); g.closePath(); g.fill(); }
        g.fillStyle = '#fff8e8'; g.beginPath(); g.arc(c, c, 120, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#ffffff'; g.lineWidth = 14; for (const r of [120, 300, 470]) { g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke(); }
        g.fillStyle = '#ffd36b'; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; g.beginPath(); g.arc(c + Math.cos(a) * 210, c + Math.sin(a) * 210, 18, 0, Math.PI * 2); g.fill(); }
      });
      tex.anisotropy = 8;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
      group.add(ellipseMesh(plazaE.center, plazaE.rx, plazaE.rz, 0.22, mat));
    }

    // ---- 城への導き (改善 4): アベニューの出口から広場を北へ、城の軸 (プラザから湖への道) へまっすぐ続く桃色の帯と、両側の旗ざお ----
    // アベニューは北東向きに終わるが、城は広場の真北にある。出口で左へ向きを変えさせる目印。見た目だけ (配置の乱数・当たり判定の少ない旗ざおの根元だけ)
    if (cfg.castle && !new URLSearchParams(location.search).has('noaxis')) {
      const av = cfg.paths.find((p) => p.name === 'ネオン・アベニュー'), to = cfg.paths.find((p) => p.name === 'プラザから湖へ');
      if (av && to) {
        const A = av.pts[av.pts.length - 1], B = to.pts[0], axis = [A, [A[0] + (B[0] - A[0]) * 0.5, (A[1] + B[1]) / 2], B];
        group.add(flat(stripPos(axis, 11, 0.25), '#f6c6dc', 0.25));
        for (const sd of [-1, 1]) group.add(flat(stripPos(axis.map(([x, z]) => [x + sd * 5.4, z]), 0.5, 0.27), '#e9c26a', 0.27));
        const len = Math.hypot(B[0] - A[0], B[1] - A[1]), n = Math.max(4, Math.round(len / 13)), poleG = new THREE.CylinderGeometry(0.09, 0.13, 4.6, 6).translate(0, 2.3, 0), flagG = new THREE.PlaneGeometry(1.15, 0.65).translate(0.575, 0, 0);
        const poleM = new THREE.InstancedMesh(poleG, std('#d6b25e', 0.4), n * 2), flagM = new THREE.InstancedMesh(flagG, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, side: THREE.DoubleSide }), n * 2);
        const dd = new THREE.Object3D(), cc = new THREE.Color(), flagC = ['#3fb8b0', '#8a6bd6', '#f08cb4', '#ff9a7a', '#e9c26a'];
        let k = 0;
        for (let i = 0; i < n; i++) for (const sd of [-1, 1]) {
          const t = (i + 0.5) / n, x = A[0] + (B[0] - A[0]) * t + sd * 7.6, z = A[1] + (B[1] - A[1]) * t, y = ground(x, z);
          dd.position.set(x, y + 0.2, z); dd.rotation.set(0, 0, 0); dd.scale.set(1, 1, 1); dd.updateMatrix(); poleM.setMatrixAt(k, dd.matrix);
          dd.position.set(x, y + 4.2, z); dd.rotation.set(0, sd > 0 ? 0 : Math.PI, 0); dd.updateMatrix(); flagM.setMatrixAt(k, dd.matrix); flagM.setColorAt(k, cc.set(flagC[k % flagC.length]));
          col.circle.push([x, z, 0.2, y - 0.5, y + 4.8]); k++;
        }
        flagM.instanceColor.needsUpdate = true; poleM.castShadow = true; group.add(poleM, flagM);
      }
    }

    // ---- ムーンレイク: 水面・石垣の土手・水に落ちない柵 (改善: 湖は石垣の土手で囲み、道はその外側に沿う) ----
    // 土手の断面 (湖の縁からの距離 d [m]。外へ + / 高さ y): 前の面 (d -1.4 の水の中 → d -0.9 の天端、少し寝かせた石積み)、天端 (幅 1.4 m の笠石)、後ろの面 (d +0.5 で地面まで)。
    // 柵は天端の上 (d -0.2)。当たり判定の線は土手の外側 (d +1.0)。城の堤道が岸を越える所は、土手も柵も切る (castle の causeways)
    {
      const lk = lakeE.lake, wy = G.level + lk.water, [lcx, lcz] = lakeE.center, rx = lakeE.rx, rz = lakeE.rz;
      const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.12, metalness: 0.15 });
      group.add(ellipseMesh(lakeE.center, rx, rz, 0, mat, (r) => [0.22 - 0.08 * (1 - r), 0.55 - 0.15 * (1 - r), 0.86 - 0.18 * (1 - r)], () => wy));
      const cf = cfg.castle && castleFrame(cfg.castle);
      const onCauseway = (x, z) => { if (!cf) return false; const [lx, lz] = cf.toLocal(x, z); return cfg.castle.causeways.some((c) => Math.abs(lx) < c.width / 2 + 2.6 && lz * c.to > 0 && Math.abs(lz) > Math.min(Math.abs(c.from), Math.abs(c.to)) - 8); };
      const runsOf = (pts) => { const runs = []; let cur = null; for (let k = 0; k <= pts.length; k++) { const q = pts[k % pts.length]; if (onCauseway(q[0], q[1])) { cur = null; continue; } if (!cur) { cur = []; runs.push(cur); } cur.push(q); } return runs; };
      const T = G.level + 0.75, FENCE_H = 0.95;
      const PROFILE = [[-1.4, wy - 0.8], [-0.9, T], [0.5, T], [0.5, G.level - 0.05]];   // 前の面の下 → 前の面の上 → 天端の外の端 → 後ろの面の下
      const at = (a, d) => [lcx + (rx + d) * Math.cos(a), lcz + (rz + d) * Math.sin(a)];
      // 石垣の模様 (間知石積み。横の段ごとに石の幅をずらす)
      const stoneTex = canvasTexture(512, 256, (g) => {
        g.fillStyle = '#4d4840'; g.fillRect(0, 0, 512, 256);
        let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        const tones = ['#b8b1a1', '#c4bdad', '#a9a291', '#cbc4b4', '#b2ab9a', '#bdb5a4'];
        for (let row = 0; row < 8; row++) {
          let x = -rnd() * 60;
          while (x < 512) { const w = 46 + rnd() * 54; g.fillStyle = tones[Math.floor(rnd() * tones.length)]; g.fillRect(x + 2, row * 32 + 2, w - 4, 28); g.fillStyle = 'rgba(255,255,255,0.13)'; g.fillRect(x + 2, row * 32 + 2, w - 4, 6); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 2, row * 32 + 24, w - 4, 6); x += w; }
        }
      });
      stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping; stoneTex.anisotropy = 4; stoneTex.needsUpdate = true;
      const wallMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.95, side: THREE.DoubleSide });
      const NS = 360, pos = [], uv = [];
      const arc = [0]; for (let k = 1; k <= NS; k++) { const p0 = at((k - 1) / NS * Math.PI * 2, 0), p1 = at(k / NS * Math.PI * 2, 0); arc.push(arc[k - 1] + Math.hypot(p1[0] - p0[0], p1[1] - p0[1])); }
      const skip = []; for (let k = 0; k < NS; k++) { const q = at((k + 0.5) / NS * Math.PI * 2, 0); skip.push(onCauseway(q[0], q[1])); }
      const quad = (P, Uv) => { for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(P[i][0], P[i][1], P[i][2]); uv.push(Uv[i][0], Uv[i][1]); } };
      for (let k = 0; k < NS; k++) {
        if (skip[k]) continue;
        const a0 = k / NS * Math.PI * 2, a1 = (k + 1) / NS * Math.PI * 2, u0 = arc[k] / 3, u1 = arc[k + 1] / 3;
        let vv = 0;
        for (let f = 0; f < 3; f++) {
          const [d0, y0] = PROFILE[f], [d1, y1] = PROFILE[f + 1], p00 = at(a0, d0), p10 = at(a1, d0), p11 = at(a1, d1), p01 = at(a0, d1);
          const len = Math.hypot(d1 - d0, y1 - y0) / 1.4;
          quad([[p00[0], y0, p00[1]], [p10[0], y0, p10[1]], [p11[0], y1, p11[1]], [p01[0], y1, p01[1]]], [[u0, vv], [u1, vv], [u1, vv + len], [u0, vv + len]]);
          vv += len;
        }
        // 切れ目 (堤道) の端のふた
        for (const [side, a] of [[-1, a0], [1, a1]]) {
          if (!skip[(k + side + NS) % NS]) continue;
          const P = PROFILE.map(([d, y]) => { const q = at(a, d); return [q[0], y, q[1]]; });
          quad(P, [[0, 0], [0.4, 0], [0.4, 1], [0, 1]]);
        }
      }
      if (pos.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
        const m = new THREE.Mesh(g, wallMat); m.receiveShadow = true; m.castShadow = true; group.add(m);
      }
      // 柵 (天端の上。柱 2.4 m おき + 横木 3 本)
      {
        const dense = [], NP = 720; for (let k = 0; k <= NP; k++) dense.push(at(k / NP * Math.PI * 2, -0.2));
        const cum = [0]; for (let k = 1; k < dense.length; k++) cum.push(cum[k - 1] + Math.hypot(dense[k][0] - dense[k - 1][0], dense[k][1] - dense[k - 1][1]));
        const per = cum[cum.length - 1], nPost = Math.round(per / 2.4), posts = [];
        for (let i = 0; i < nPost; i++) { const target = per * i / nPost; let j = 1; while (j < cum.length - 1 && cum[j] < target) j++; const t = (target - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1); posts.push([dense[j - 1][0] + (dense[j][0] - dense[j - 1][0]) * t, dense[j - 1][1] + (dense[j][1] - dense[j - 1][1]) * t]); }
        const segs = [], keep = new Set();
        for (let i = 0; i < nPost; i++) { const p = posts[i], q = posts[(i + 1) % nPost]; if (onCauseway((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)) continue; segs.push([p, q]); keep.add(i); keep.add((i + 1) % nPost); }
        const RAILS = [[0.3, 0.06], [0.62, 0.06], [FENCE_H, 0.1]];
        const postM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, FENCE_H + 0.12, 0.14).translate(0, (FENCE_H + 0.12) / 2, 0), std('#fbf7ff', 0.5), keep.size);
        const railM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std('#cfc3f5', 0.55), segs.length * RAILS.length);
        const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
        let pi = 0, ri = 0;
        for (const i of keep) postM.setMatrixAt(pi++, M.compose(P.set(posts[i][0], T, posts[i][1]), Q.identity(), S.set(1, 1, 1)));
        for (const [p, q] of segs) {
          const L = Math.hypot(q[0] - p[0], q[1] - p[1]), yaw = Math.atan2(q[0] - p[0], q[1] - p[1]);
          for (const [h, th] of RAILS) railM.setMatrixAt(ri++, M.compose(P.set((p[0] + q[0]) / 2, T + h, (p[1] + q[1]) / 2), Q.setFromAxisAngle(Y, yaw), S.set(th, th, L)));
        }
        postM.castShadow = railM.castShadow = true; postM.computeBoundingSphere(); railM.computeBoundingSphere();
        group.add(postM, railM);
      }
      // 当たり判定: 土手の外側の線 (柵より高く = 飛び越え・よじ登りの対象にならない)
      const wall = ellPts(lakeE.center, rx + 1.0, rz + 1.0, 120);
      for (const run of cf ? runsOf(wall) : [wall.concat([wall[0]])]) { const ln = [0.3, 1.9]; for (const q of run) ln.push(q[0], q[1], ground(q[0], q[1])); if (ln.length > 8) col.line.push(ln); }
    }

    // ---- 外周の柵 (パステルの板と白い柱。駅からゲートへの道が入る所は切る) ----
    {
      const F = cfg.fence, site = cfg.site, panels = [], posts = [];
      const inGap = (x, z) => F.gaps.some((q) => Math.hypot(x - q[0], z - q[1]) < F.gapWidth / 2);
      for (let i = 0; i < site.length; i++) {
        const a = site[i], b = site[(i + 1) % site.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / F.panel));
        const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
        let run = null;
        for (let t = 0; t < n; t++) {
          const x0 = a[0] + (b[0] - a[0]) * t / n, z0 = a[1] + (b[1] - a[1]) * t / n, x1 = a[0] + (b[0] - a[0]) * (t + 1) / n, z1 = a[1] + (b[1] - a[1]) * (t + 1) / n, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
          if (inGap(mx, mz)) { run = null; continue; }
          panels.push([mx, ground(mx, mz), mz, yaw, L / n]); posts.push([x0, ground(x0, z0), z0]);
          if (!run) { run = [0.15, F.height, x0, z0, ground(x0, z0)]; col.line.push(run); }
          run.push(x1, z1, ground(x1, z1));
        }
      }
      const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, F.height - 0.5, 1).translate(0, (F.height - 0.5) / 2 + 0.1, 0), std('#cfc3f5', 0.6), panels.length);
      const sm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, F.height + 0.4, 0.28).translate(0, (F.height + 0.4) / 2 - 0.1, 0), std('#fbf7ff', 0.5), posts.length);
      const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), cc = new THREE.Color();
      panels.forEach((p, i) => { pm.setMatrixAt(i, M.compose(P.set(p[0], p[1], p[2]), Q.setFromAxisAngle(Y, p[3]), S.set(1, 1, p[4]))); pm.setColorAt(i, cc.set(i % 2 ? '#cfc3f5' : '#f5c3df')); });
      posts.forEach((p, i) => sm.setMatrixAt(i, M.compose(P.set(p[0], p[1], p[2]), Q.identity(), S.set(1, 1, 1))));
      pm.castShadow = sm.castShadow = true; pm.computeBoundingSphere(); sm.computeBoundingSphere();
      group.add(pm, sm);
    }

    // ---- サーチライト・タワー: 細い塔・ランプ・夜だけ見える 2 本の回る光線 ----
    {
      const T = cfg.tower, [tx, tz] = T.at, ty = ground(tx, tz), g = new THREE.Group();
      g.position.set(tx, ty, tz);
      const segs = [['#ffffff', 0, 12, 3.4, 2.7], ['#ffc2e0', 12, 24, 2.7, 2.0], ['#ffffff', 24, T.height - 3, 2.0, 1.4]];
      for (const [c, y0, y1, r0, r1] of segs) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, y1 - y0, 20), std(c, 0.45)); m.position.y = (y0 + y1) / 2; m.castShadow = m.receiveShadow = true; g.add(m); }
      const base = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.2, 1.2, 24), std('#f2e6f7', 0.6)); base.position.y = 0.4; base.castShadow = base.receiveShadow = true; g.add(base);
      const deck = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 1.6, 2.2, 20), std('#8f7bff', 0.4)); deck.position.y = T.height - 1.9; deck.castShadow = true; g.add(deck);
      const head = new THREE.Mesh(new THREE.SphereGeometry(1.7, 20, 14), towerLamp); head.position.y = T.height + 0.6; g.add(head);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.35, 5, 8), std('#ffd36b', 0.4)); spire.position.y = T.height + 4; g.add(spire);
      const beams = new THREE.Group(); beams.position.y = T.height + 0.6; beams.name = 'park_beams';
      const bg = new THREE.ConeGeometry(9, T.beam.length, 20, 1, true).translate(0, -T.beam.length / 2, 0).rotateX(-Math.PI / 2);
      for (const a of [0, Math.PI]) { const yawG = new THREE.Group(); yawG.rotation.y = a; const pitchG = new THREE.Group(); pitchG.rotation.x = -T.beam.tilt; pitchG.add(new THREE.Mesh(bg, beamMat)); yawG.add(pitchG); beams.add(yawG); }
      g.add(beams); group.add(g);
      api.beams = beams;
      col.circle.push([tx, tz, T.radius + 0.4, ty - 1, ty + T.height]);
    }

    // ---- ネオン・アベニュー: 色違いの街灯とベンチ (両側)。街灯は夜に光る ----
    {
      const av = cfg.paths.find((p) => p.name === 'ネオン・アベニュー'), A = av.pts[0], B = av.pts[av.pts.length - 1], L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const dx = (B[0] - A[0]) / L, dz = (B[1] - A[1]) / L, nx = -dz, nz = dx, off = av.width / 2 + 2.2;
      const poles = [], globesP = [], globesC = [], benches = [];
      for (let s = 12, i = 0; s < L - 8; s += 20, i++) for (const side of [-1, 1]) {
        const x = A[0] + dx * s + nx * off * side, z = A[1] + dz * s + nz * off * side, y = ground(x, z);
        poles.push([x, y, z]); (((i + (side > 0 ? 1 : 0)) % 2) ? globesP : globesC).push([x, y + 5.1, z]);
        col.circle.push([x, z, 0.3, y - 0.5, y + 5.5]);
      }
      for (let s = 22; s < L - 14; s += 40) for (const side of [-1, 1]) {
        const x = A[0] + dx * s + nx * (av.width / 2 + 1.4) * side, z = A[1] + dz * s + nz * (av.width / 2 + 1.4) * side;
        benches.push([x, ground(x, z), z, Math.atan2(-nx * side, -nz * side)]);
      }
      const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S1 = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
      const inst = (geo, mat, list, f) => { const m = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((p, i) => m.setMatrixAt(i, f(p))); m.castShadow = true; m.computeBoundingSphere(); group.add(m); return m; };
      inst(new THREE.CylinderGeometry(0.1, 0.14, 5, 8).translate(0, 2.5, 0), std('#4b4561', 0.5), poles, (p) => M.compose(P.set(p[0], p[1], p[2]), Q.identity(), S1));
      const gg = new THREE.SphereGeometry(0.5, 12, 8);
      inst(gg, lampPink, globesP, (p) => M.compose(P.set(p[0], p[1], p[2]), Q.identity(), S1));
      inst(gg, lampCyan, globesC, (p) => M.compose(P.set(p[0], p[1], p[2]), Q.identity(), S1));
      const bench = new THREE.BoxGeometry(2.2, 0.12, 0.6).translate(0, 0.5, 0), back = new THREE.BoxGeometry(2.2, 0.55, 0.1).translate(0, 0.85, -0.28);
      inst(bench, std('#8f7bff', 0.6), benches, (p) => M.compose(P.set(p[0], p[1], p[2]), Q.setFromAxisAngle(Y, p[3]), S1));
      inst(back, std('#ffb3d6', 0.6), benches, (p) => M.compose(P.set(p[0], p[1], p[2]), Q.setFromAxisAngle(Y, p[3]), S1));
      for (const b of benches) col.box.push([b[0], b[2], b[3], 1.1, 0.4, b[1], b[1] + 1.1]);
      // 湖のまわりの散歩道の街灯 (暖かい色。30 m おき)
      const ringL = ellPts(prE.center, prE.rx + pr.offset + pr.width / 2 + 1.2, prE.rz + pr.offset + pr.width / 2 + 1.2, 36), lp = [];
      for (const q of ringL) lp.push([q[0], ground(q[0], q[1]), q[1]]);
      inst(new THREE.CylinderGeometry(0.1, 0.14, 4.2, 8).translate(0, 2.1, 0), std('#4b4561', 0.5), lp, (p) => M.compose(P.set(p[0], p[1], p[2]), Q.identity(), S1));
      inst(new THREE.SphereGeometry(0.45, 12, 8), lampWarm, lp, (p) => M.compose(P.set(p[0], p[1] + 4.3, p[2]), Q.identity(), S1));
      for (const p of lp) col.circle.push([p[0], p[2], 0.3, p[1] - 0.5, p[1] + 4.6]);
    }

    // ---- 駅からゲートへの案内板 ----
    for (const sgn of cfg.guides.signs) {
      const [x, z] = sgn.at, y = ground(x, z), yaw = Math.atan2(sgn.face[0], sgn.face[1]), g = new THREE.Group();
      g.position.set(x, y, z); g.rotation.y = yaw;
      const post = std('#e9e2f5', 0.6);
      for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.0, 8), post); m.position.set(s * 1.1, 1.5, 0); m.castShadow = true; g.add(m); }
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.1, 0.12), [post, post, post, post, new THREE.MeshStandardMaterial({ map: textTexture(1024, 400, '#ff7fb5', '#3fc8ff', sgn.text, sgn.sub), roughness: 0.55 }), std('#7f6ad9', 0.6)]);
      board.position.set(0, 2.6, 0); board.castShadow = true; g.add(board);
      group.add(g);
      col.circle.push([x + Math.cos(yaw) * 1.1, z - Math.sin(yaw) * 1.1, 0.14, y, y + 3], [x - Math.cos(yaw) * 1.1, z + Math.sin(yaw) * 1.1, 0.14, y, y + 3]);
    }

    // ---- 段階 2: 各エリアの建物・内側の道・広場・木・看板・門・特別な物 (public/data/park.json の gen) ----
    if (cfg.gen) {
      const t0 = performance.now();
      const ar = buildAreas({ cfg, ground, std, glowMat, group, col, emissive, low: !!opts.low, flat, stripPos });
      api.areas = ar;
      console.info(`[park] 各エリア: 建物 ${ar.stats.buildings} (壁・縁取り・看板の三角形 ${ar.stats.trisAll}、店の窓・ネオンなど ${ar.stats.facadeTris})・木 ${ar.stats.trees}・看板 ${ar.stats.signs}・乗り物の三角形 ${ar.rides.stats.tris}、${(performance.now() - t0).toFixed(0)} ms`);
    }
    // ---- 段階 9: 象徴の城「リール・キャッスル」(ムーンレイクの島。?nocastle で無効 = 確認用) ----
    if (cfg.castle && !new URLSearchParams(location.search).has('nocastle')) {
      const t0 = performance.now();
      api.castle = buildCastle({ cfg, ground, glowMat, group, col, emissive, low: !!opts.low });
      console.info(`[park] ${cfg.castle.name}: 三角形 ${api.castle.stats.tris}・塔 ${api.castle.stats.towers}・灯 ${api.castle.stats.lamps}・高さ約 ${api.castle.maxTop.toFixed(0)} m (冠まで ${cfg.castle.reel.y + cfg.castle.reel.R} m)、${(performance.now() - t0).toFixed(0)} ms`);
    }
    // ---- 段階 4: ショー (花火・パレード・水上ショー・夜の光)。public/data/park.json の show ----
    if (cfg.show) {
      const t0 = performance.now();
      api.show = buildShow({ cfg, ground, std, glowMat, group, emissive, flat, stripPos });
      console.info(`[park] ショー: 花火 ${api.show.stats.bursts} 発・山車 ${api.show.stats.floats}・踊り手 ${api.show.stats.dancers}・噴水 ${api.show.stats.jets}、パレードの道 ${api.show.stats.routeLen} m、${(performance.now() - t0).toFixed(0)} ms`);
    }
    world.addColliders(col, true);   // V キーに関係なく有効
    console.info(`[park] ${cfg.name}: 土台を作った (柵 ${col.line.length} 本の線・当たり判定 円 ${col.circle.length}・線 ${col.line.length}・箱 ${col.box.length}、ゲートの地面 ${ground(gx, gz).toFixed(2)} m)`);
  }
  const api = {
    group, emissive, beams: null, areas: null, show: null, entrance: null,
    // カメラの位置。区間 (地形) を読み込めたら 1 回だけ作る (敷地の 1.5 km 以内のとき調べる)。光線は回す
    update(x, z, win = 0) {
      if (!built && logoFontReady && Math.hypot(x - gate.at[0], z - gate.at[1]) < 1500 && ready()) build();
      if (api.beams) api.beams.rotation.y = performance.now() / 1000 * 0.25;
      api.entrance?.update(Date.now() / 1000, x, z);   // 入口の冠のリールが回る
      api.areas?.update?.(Date.now() / 1000, x, z);   // 旗のゆれ・煙突の煙・ネオンのまたたき (段階 7)
      api.areas?.rides?.update(Date.now() / 1000, x, z);   // 観覧車・メリーゴーラウンドの動き (近くのときだけ)
      api.areas?.live?.update(showClockNow(), x, z);   // ライブ会場の大画面の切り替え・ムービングライト (近くのときだけ)
      api.show?.update(showClockNow(), x, z, win);          // 花火・パレード・水上ショー (win = 夜の度合い。time.js)
      if (api.castle) { const ck = showClockNow(); api.castle.update(ck, x, z, win, ck % cfg.show.cycle); }   // 城の冠・旗・夜のライトアップ
    },
    get built() { return built; },
    cfg,
    ground: pg,
  };
  return api;
}
