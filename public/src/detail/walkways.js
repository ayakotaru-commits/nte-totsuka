// 5b. 歩道橋・デッキ・階段・スロープの手すり
// 配置は tools/build_props.py が計算した data/props.json の walk.rails (路面の縁の線)。ここでは形を作って置くだけ。
//   deck   デッキ・歩道橋の高欄: 支柱 + 笠木 + 下の横桟 + 縦格子 (模様で表す)
//   stair  デッキへ上がる階段・急な坂: 支柱 + 手すり 2 段 + 縦格子
//   ground 地面の階段: 支柱 + 手すり 2 段 (ステンレス)
import * as THREE from 'three';
import { Builder, canvasTexture } from './util.js';

const POST_STEP = 1.5;   // 支柱の間隔 (m)
const BAR_PITCH = 0.14;  // 縦格子の間隔 (m)

export function buildWalkways(props) {
  const group = new THREE.Group();
  group.name = 'detail_walkways';
  const W = props.walk;
  if (!W || !W.rails) return { group };
  const RAIL_H = W.dims?.railH ?? 1.1, HAND_H = W.dims?.handrailH ?? 0.9;
  const dark = new Builder(), steel = new Builder(), bars = new Builder();
  const posts = { dark: [], steel: [] };

  // 線に沿った角棒 (上下左右の 4 面)。a, b = [x, y, z]、t = 太さ
  const beam = (B, a, b, t) => {
    const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L * t / 2, nz = dx / L * t / 2, h = t / 2;
    const P = (p, s, v) => [p[0] + nx * s, p[1] + h * v, p[2] + nz * s];
    B.quad(P(a, -1, 1), P(b, -1, 1), P(b, 1, 1), P(a, 1, 1), [0, 1, 0]);
    B.quad(P(a, -1, -1), P(b, -1, -1), P(b, 1, -1), P(a, 1, -1), [0, -1, 0]);
    B.quad(P(a, 1, -1), P(b, 1, -1), P(b, 1, 1), P(a, 1, 1), [nx, 0, nz].map(v => v / (t / 2)));
    B.quad(P(a, -1, -1), P(b, -1, -1), P(b, -1, 1), P(a, -1, 1), [-nx, 0, -nz].map(v => v / (t / 2)));
  };
  const up = (p, h) => [p[0], p[1] + h, p[2]];

  for (const r of W.rails) {
    const k = r.k, p = r.p;
    const B = k === 'ground' ? steel : dark;
    const H = k === 'deck' ? RAIL_H : HAND_H;
    let run = 0; // 縦格子の模様を線に沿って続けるための道のり
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i], b = p[i + 1];
      const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (L < 0.02) continue;
      // 支柱 (区間の両端と、間は POST_STEP 以下の等間隔)
      const n = Math.max(1, Math.ceil(L / POST_STEP));
      for (let j = (i === 0 ? 0 : 1); j <= n; j++) {
        const t = j / n;
        posts[k === 'ground' ? 'steel' : 'dark'].push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, H]);
      }
      beam(B, up(a, H), up(b, H), k === 'deck' ? 0.07 : 0.05);          // 笠木・手すり
      if (k === 'deck') {
        beam(B, up(a, 0.1), up(b, 0.1), 0.05);                            // 下の横桟
      } else {
        beam(B, up(a, H - 0.25), up(b, H - 0.25), 0.045);                 // 2 段目の手すり
        if (k === 'stair') beam(B, up(a, 0.12), up(b, 0.12), 0.045);
      }
      if (k !== 'ground') {                                               // 縦格子 (模様)
        const y0 = k === 'deck' ? 0.1 : 0.12, y1 = k === 'deck' ? H : H - 0.25;
        const u0 = run / BAR_PITCH, u1 = (run + L) / BAR_PITCH;
        bars.quad(up(a, y0), up(b, y0), up(b, y1), up(a, y1), null, [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]);
      }
      run += L;
    }
  }

  const mesh = (B, mat, name, shadow = true) => {
    if (!B.p.length) return;
    const m = new THREE.Mesh(B.geometry(), mat);
    m.name = name; m.castShadow = shadow; m.receiveShadow = true;
    group.add(m);
  };
  // 金属らしさ (metalness) は低め: 映り込む物が無いと真っ黒になる
  const darkMat = new THREE.MeshStandardMaterial({ color: '#7a756c', roughness: 0.6, metalness: 0.15, side: THREE.DoubleSide });
  const steelMat = new THREE.MeshStandardMaterial({ color: '#c9cdd0', roughness: 0.4, metalness: 0.25, side: THREE.DoubleSide });
  mesh(dark, darkMat, 'walk_rails');
  mesh(steel, steelMat, 'walk_handrails');
  if (bars.p.length) {
    // 縦格子: 1 本ぶんの模様 (中央に棒、両側は透明) を横に繰り返す
    const tex = canvasTexture(16, 16, (g) => {
      g.clearRect(0, 0, 16, 16);
      g.fillStyle = '#ffffff';
      g.fillRect(6, 0, 3, 16);
    });
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
    // 遠くでは棒がつぶれて消えるので、しきい値を低めにして薄い面として残す
    const mat = new THREE.MeshStandardMaterial({ color: '#7a756c', roughness: 0.6, metalness: 0.15, map: tex, alphaTest: 0.2, transparent: false, side: THREE.DoubleSide });
    mesh(bars, mat, 'walk_bars', false);
  }
  for (const [key, mat] of [['dark', darkMat], ['steel', steelMat]]) {
    const list = posts[key];
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat, list.length);
    const M = new THREE.Matrix4();
    const t = key === 'dark' ? 0.06 : 0.045;
    list.forEach(([x, y, z, h], i) => { M.makeScale(t, h, t); M.setPosition(x, y, z); im.setMatrixAt(i, M); });
    im.name = 'walk_posts_' + key; im.castShadow = true; im.receiveShadow = true;
    group.add(im);
  }
  return { group };
}
