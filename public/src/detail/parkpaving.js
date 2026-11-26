// フェアリー・リールパーク 段階 7: アベニューの舗装 (本通りの菱形のタイル・中央の星の帯・縁の市松と、店の前の歩道のタイル)。
// 道の形は data/park.json の paths (ネオン・アベニュー)、歩道の幅は data/park_areas.json のテーマの detail.terrace (public/data/park.json の gen.areas[].terrace)。
// 地面の高さに沿った帯に、道に沿って繰り返す模様を貼る (v = 道のりを繰り返しの長さで割った値)。見た目だけで当たり判定は無い。
import * as THREE from 'three';
import { canvasTexture } from './util.js';

const REPEAT_A = 12, REPEAT_T = 5;   // 本通りの模様が繰り返す道のり (m)、歩道の模様の繰り返し (m)

// 本通り (幅 W m × 道に沿って 12 m の 1 枚): 縁の縁石と市松 → 菱形のタイル → 中央の星の帯
function avenueTexture(W) {
  const px = 40, cw = Math.round(W * px), ch = REPEAT_A * px;   // 1 m = 40 px
  return canvasTexture(cw, ch, (g, w, h) => {
    const m = w / W, X = (x) => (x + W / 2) * m;   // 中心から横へ x m → 画素
    g.fillStyle = '#f7dbe8'; g.fillRect(0, 0, w, h);
    // 菱形のタイル (一辺 約 2.4 m の格子。3 色を順にまわす)
    const tone = ['#f4c9dc', '#f9e4ee', '#e6dcf7'], step = 2.4;
    for (let j = -1; j <= Math.ceil(REPEAT_A / step) + 1; j++) for (let i = -1; i <= Math.ceil(W / step) + 1; i++) {
      for (const [ox, oy, add] of [[0, 0, 0], [step / 2, step / 2, 1]]) {
        const cx = X(-W / 2 + i * step + ox), cy = (j * step + oy) * m, r = step / 2 * m * 0.96;
        g.fillStyle = tone[((i + j) % 3 + 3 + add) % 3];
        g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath(); g.fill();
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2;   // 目地
    for (let k = -Math.ceil(w / (step * m)) - 1; k <= Math.ceil(h / (step * m)) + Math.ceil(w / (step * m)) + 1; k++) {
      const c = (k + 0.5) * step * m;
      g.beginPath(); g.moveTo(0, c); g.lineTo(w, c - w); g.stroke();   // 右上がり (u + v = 一定)
      g.beginPath(); g.moveTo(0, -c); g.lineTo(w, w - c); g.stroke();   // 右下がり (v - u = 一定)
    }
    // 中央の帯 (クリーム色・星・両わきのピンクの線)
    g.fillStyle = '#fff3dc'; g.fillRect(X(-2.1), 0, 4.2 * m, h);
    g.fillStyle = '#ff9ec8'; for (const sx of [-2.2, 2.0]) g.fillRect(X(sx), 0, 0.2 * m, h);
    g.fillStyle = '#ffffff'; for (const sx of [-2.0, 1.8]) g.fillRect(X(sx), 0, 0.12 * m, h);
    const star = (cx, cy, R, c) => { g.fillStyle = c; g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? R * 0.42 : R; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); g.fill(); };
    for (const sy of [2.6, 8.6]) { star(X(0), sy * m, 1.45 * m, '#ffc933'); star(X(0), sy * m, 0.8 * m, '#fff3b0'); }
    for (const sy of [5.6, 11.6]) { star(X(0), sy * m, 0.55 * m, '#8f7bff'); }
    for (const sx of [-1.15, 1.15]) for (const sy of [2.6, 8.6]) { star(X(sx), sy * m, 0.28 * m, '#ff7fb5'); }
    // 縁: 縁石 (0.4 m) → 金の線 → 市松 (0.8 m)
    for (const sd of [-1, 1]) {
      const e = sd < 0 ? 0 : 1, edge = (d0, d1) => { const a = X(sd * (W / 2 - d0)), b2 = X(sd * (W / 2 - d1)); return [Math.min(a, b2), Math.abs(b2 - a)]; };
      let [x0, ww] = edge(0, 0.4); g.fillStyle = '#efe3d3'; g.fillRect(x0, 0, ww, h);
      [x0, ww] = edge(0.4, 0.5); g.fillStyle = '#e8b64a'; g.fillRect(x0, 0, ww, h);
      const [xc, wc] = edge(0.5, 1.3), n = Math.round(REPEAT_A / 0.4);
      for (let k = 0; k < n; k++) for (let q = 0; q < 2; q++) { g.fillStyle = (k + q) % 2 ? '#ff9ec8' : '#ffffff'; g.fillRect(xc + q * wc / 2, k * 0.4 * m, wc / 2, 0.4 * m + 1); }
      void e;
    }
  });
}

// 店の前の歩道 (幅 T m × 道に沿って 5 m): 縁石 → ピンクの線 → クリーム色とももいろのタイル (1 m 角・ずらして並べる) → 建物の壁ぎわの暗い帯
function terraceTexture(T) {
  const px = 48, cw = Math.round(T * px), ch = REPEAT_T * px;
  return canvasTexture(cw, ch, (g, w, h) => {
    const m = w / T;   // u = 0 が通りの側、u = 1 が建物の壁
    g.fillStyle = '#f6e9d8'; g.fillRect(0, 0, w, h);
    const tile = 1.0;
    for (let j = 0; j < REPEAT_T / tile; j++) for (let i = -1; i < T / tile + 1; i++) {
      const x = (i + (j % 2) * 0.5) * tile * m, y = j * tile * m;
      g.fillStyle = (i + j) % 2 ? '#f7dccb' : '#f9eee0'; g.fillRect(x + 1, y + 1, tile * m - 2, tile * m - 2);
    }
    g.fillStyle = '#efe3d3'; g.fillRect(0, 0, 0.3 * m, h);                    // 縁石
    g.fillStyle = '#ff9ec8'; g.fillRect(0.3 * m, 0, 0.18 * m, h);             // ピンクの線
    g.fillStyle = '#d8c3ac'; g.fillRect(w - 0.4 * m, 0, 0.4 * m, h);          // 壁ぎわ (暗い帯)
    g.fillStyle = '#c9ad94'; g.fillRect(w - 0.4 * m, 0, 0.05 * m, h);
  });
}

// 帯 (中心線 pts から横へ c0〜c1 m)。v = 道のり / repeat。lift = 地面からの高さ
function strip(pts, c0, c1, lift, repeat, ground, uMax = 1) {
  const pos = [], uv = [], idx = [];
  let sAcc = 0, vi = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) continue;
    const n = Math.max(1, Math.ceil(L / 3)), tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
    for (let t = 0; t <= n; t++) {
      const x = ax + tx * L * t / n, z = az + tz * L * t / n, s = sAcc + L * t / n;
      for (const [c, u] of [[c0, 0], [c1, uMax]]) { const px = x + nx * c, pz = z + nz * c; pos.push(px, ground(px, pz) + lift, pz); uv.push(u, s / repeat); }
      if (t > 0) { const b0 = vi * 2 - 2; idx.push(b0, b0 + 1, b0 + 3, b0, b0 + 3, b0 + 2); }
      vi++;
    }
    sAcc += L;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export function buildAvenuePaving({ path, terrace, ground, group }) {
  const W = path.width, T = terrace, pts = path.pts;
  const mk = (tex, lift) => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -7 - lift * 10, polygonOffsetUnits: -7 - lift * 10 }); };
  const matA = mk(avenueTexture(W), 0.21), matT = mk(terraceTexture(T), 0.205);
  const mesh = (g, m, name) => { const o = new THREE.Mesh(g, m); o.name = name; o.receiveShadow = true; group.add(o); return o; };
  mesh(strip(pts, -W / 2, W / 2, 0.21, REPEAT_A, ground), matA, 'park_paving_avenue');
  // 歩道: 通りの縁 (±W/2) から建物の壁 (±(W/2 + T)) まで。左側は u を反転して、いつも「通りの側が u = 0」にする
  mesh(strip(pts, W / 2, W / 2 + T, 0.205, REPEAT_T, ground), matT, 'park_paving_terrace_r');
  mesh(strip(pts, -W / 2, -W / 2 - T, 0.205, REPEAT_T, ground), matT, 'park_paving_terrace_l');
  return { tris: (pts.length - 1) * Math.ceil(125 / 3) * 2 * 3 };
}

// ---------- 各エリアの内側の道 (石畳・板張り・土・敷石・お菓子の市松)。4 m 角の 1 枚を繰り返す ----------
const TILE = 4;
function pathTexture(kind) {
  return canvasTexture(256, 256, (g, w, h) => {
    const m = w / TILE;
    let seed = kind.length * 7919 + 17; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const shade = (c, k) => { const n = parseInt(c.slice(1), 16), r = Math.max(0, Math.min(255, (n >> 16) + k)), gg = Math.max(0, Math.min(255, ((n >> 8) & 255) + k)), b = Math.max(0, Math.min(255, (n & 255) + k)); return `rgb(${r},${gg},${b})`; };
    if (kind === 'town' || kind === 'night') {   // 石畳 (ずらして並べた四角い石)
      const base = kind === 'town' ? '#a9a7ad' : '#8d8798';
      g.fillStyle = shade(base, -36); g.fillRect(0, 0, w, h);
      const bw = 0.5 * m, bh = 0.25 * m;
      for (let j = 0; j < TILE / 0.25; j++) for (let i = -1; i < TILE / 0.5 + 1; i++) { g.fillStyle = shade(base, Math.round((rnd() - 0.5) * 36)); g.fillRect((i + (j % 2) * 0.5) * bw + 1.2, j * bh + 1.2, bw - 2.4, bh - 2.4); }
    } else if (kind === 'station') {   // レンガ敷き (半枚ずつずらした長方形。ネオンの淡い色とロストの土の間の色)
      const base = '#b98a6c';
      g.fillStyle = shade(base, -52); g.fillRect(0, 0, w, h);
      const bw = 0.42 * m, bh = 0.2 * m;
      for (let j = 0; j < TILE / 0.2; j++) for (let i = -1; i < TILE / 0.42 + 1; i++) { g.fillStyle = shade(base, Math.round((rnd() - 0.5) * 44)); g.fillRect((i + (j % 2) * 0.5) * bw + 1.1, j * bh + 1.1, bw - 2.2, bh - 2.2); }
    } else if (kind === 'harbor') {   // 板張り (道に直角に張った板・くぎ)
      g.fillStyle = '#6f5a44'; g.fillRect(0, 0, w, h);
      const ph = 0.24 * m;
      for (let j = 0; j < TILE / 0.24 + 1; j++) { g.fillStyle = shade('#b99a74', Math.round((rnd() - 0.5) * 34)); g.fillRect(0, j * ph + 1, w, ph - 2); g.fillStyle = 'rgba(60,40,25,0.5)'; for (const nx of [0.12, 0.88]) { g.beginPath(); g.arc(nx * w, j * ph + ph / 2, 1.6, 0, 7); g.fill(); } }
    } else if (kind === 'valley') {   // 踏み固めた土 (小石・わだち)
      g.fillStyle = '#c9b087'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 260; k++) { g.fillStyle = shade('#c9b087', Math.round((rnd() - 0.5) * 60)); g.beginPath(); g.arc(rnd() * w, rnd() * h, 1 + rnd() * 3.2, 0, 7); g.fill(); }
      g.fillStyle = 'rgba(120,90,55,0.18)'; for (const cx of [0.3, 0.7]) g.fillRect(cx * w - 8, 0, 16, h);
    } else if (kind === 'forest') {   // 敷石 (大きさのちがう石・すきまのこけ)
      g.fillStyle = '#7d8a5a'; g.fillRect(0, 0, w, h);
      const rows = [0.8, 1.2, 0.8, 1.2];
      let y = 0;
      for (const rh of rows) { let x = -rnd() * 0.5 * m; while (x < w) { const sw = (0.6 + rnd() * 0.7) * m; g.fillStyle = shade('#e0cfa8', Math.round((rnd() - 0.5) * 40)); g.beginPath(); g.roundRect ? g.roundRect(x + 2, y + 2, sw - 4, rh * m - 4, 8) : g.rect(x + 2, y + 2, sw - 4, rh * m - 4); g.fill(); x += sw; } y += rh * m; }
    } else {   // sweet: ピンクとミントの市松 + 細い白線
      const n = 4;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { g.fillStyle = (i + j) % 2 ? '#ffd1e6' : '#d6f5e8'; g.fillRect(i * w / n, j * h / n, w / n, h / n); }
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 3; for (let k = 0; k <= n; k++) { g.beginPath(); g.moveTo(k * w / n, 0); g.lineTo(k * w / n, h); g.stroke(); g.beginPath(); g.moveTo(0, k * h / n); g.lineTo(w, k * h / n); g.stroke(); }
      g.fillStyle = '#ff9ec8'; for (let j = 0; j < n; j += 2) for (let i = 0; i < n; i += 2) { g.beginPath(); g.arc((i + 0.5) * w / n, (j + 0.5) * h / n, 7, 0, 7); g.fill(); }
    }
  });
}

export function buildAreaPaving({ gen, ground, group, extra = [] }) {   // extra = 園の道 (data/park.json の paths) のうち pave (エリア名) があるものを、そのエリアの舗装で敷く: [{ a: エリアの番号, w, pts }]
  const mats = {}; let n = 0;
  for (const p of [...gen.paths, ...extra]) {
    const a = gen.areas[p.a]; if (!a || !a.detail) continue;
    const kind = a.kind;
    if (!mats[kind]) { const tex = pathTexture(kind); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; mats[kind] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -9, polygonOffsetUnits: -9 }); }
    const lift = 0.2 + 0.0008 * (n % 7);
    const o = new THREE.Mesh(strip(p.pts, -p.w / 2, p.w / 2, lift, TILE, ground, p.w / TILE), mats[kind]); o.name = 'park_paving_path'; o.receiveShadow = true; group.add(o); n++;
  }
  return { paths: n };
}
