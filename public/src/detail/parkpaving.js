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
function strip(pts, c0, c1, lift, repeat, ground) {
  const pos = [], uv = [], idx = [];
  let sAcc = 0, vi = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) continue;
    const n = Math.max(1, Math.ceil(L / 3)), tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
    for (let t = 0; t <= n; t++) {
      const x = ax + tx * L * t / n, z = az + tz * L * t / n, s = sAcc + L * t / n;
      for (const [c, u] of [[c0, 0], [c1, 1]]) { const px = x + nx * c, pz = z + nz * c; pos.push(px, ground(px, pz) + lift, pz); uv.push(u, s / repeat); }
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
