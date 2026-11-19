// 神社の社殿 (八坂神社)。配置・地面の高さ・当たり判定は props.json の shrines (tools/build_props.py。元は data/appearance.json の shrines)。
// PLATEAU の建物 (灰色の箱) は tools/shrine.py が hide を付け、main.js が描かない・当たらないようにしている。
// 外観は Wikimedia Commons の写真 (正面・鳥居の下から) を見て書き起こした (写真そのものは保存・使用していない):
//   銅板葺き (緑青) の入母屋・平入りの屋根、正面に 1 間の向拝 (柱 2 本)、焦げ茶の木の身舎と格子戸、
//   高床 (浜縁) と木の階段、コンクリートの基壇、鈴と紅白の鈴緒、三つ巴の金具の賽銭箱、しめ縄と紙垂。
//   北西に赤い屋根の小屋 (annex。PLATEAU に無い。点群と写真から。形は推定)。
// 局所座標: 原点 = 屋根の中心の地面、+Z = 正面の向き、+X = 正面に向かって右手。小物の表示 (V キー) に関係なく描く。
import * as THREE from 'three';
import { Builder, canvasTexture } from './detail/util.js';

const WOOD = '#4a3426', WOOD_D = '#2f2219', DECK = '#7a6450', CU = '#7d9d8b', CU_D = '#5f7f70', CONC = '#a3a19a';

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });

// 板壁 (縦の板目) と、正面の格子戸の模様
function wallTex(door) {
  return canvasTexture(256, 256, (g, W, H) => {
    g.fillStyle = WOOD; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 2;
    for (let x = 0; x < W; x += 18) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    g.fillStyle = WOOD_D; g.fillRect(0, 0, W, 14); g.fillRect(0, H - 10, W, 10);   // 長押・地覆
    g.fillRect(0, 0, 10, H); g.fillRect(W - 10, 0, 10, H);                           // 柱
    if (!door) return;
    const x0 = W * 0.22, x1 = W * 0.78, y0 = H * 0.12, y1 = H * 0.98;
    g.fillStyle = '#3a2a1e'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    // 上半分は格子 (向こうが暗い)、下半分は板
    const yg = y0 + (y1 - y0) * 0.55;
    g.fillStyle = '#120c08'; g.fillRect(x0 + 6, y0 + 6, x1 - x0 - 12, yg - y0 - 6);
    g.strokeStyle = '#5a4130'; g.lineWidth = 3;
    for (let x = x0 + 6; x <= x1 - 6; x += 11) { g.beginPath(); g.moveTo(x, y0 + 6); g.lineTo(x, yg); g.stroke(); }
    for (let y = y0 + 6; y <= yg; y += 11) { g.beginPath(); g.moveTo(x0 + 6, y); g.lineTo(x1 - 6, y); g.stroke(); }
    g.fillStyle = '#4e3829'; g.fillRect(x0 + 6, yg + 4, x1 - x0 - 12, y1 - yg - 10);
    g.fillStyle = WOOD_D; g.fillRect((x0 + x1) / 2 - 2, y0, 4, y1 - y0);                // 扉の合わせ目
    g.fillStyle = '#f4f1e8'; g.fillRect(x0 + 14, y0 + 30, 22, 34);                    // 張り紙
  });
}
// 銅板の屋根 (横の継ぎ目と、まだらの緑青)
function copperTex() {
  return canvasTexture(256, 256, (g, W, H) => {
    g.fillStyle = CU; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '60,80,70' : '170,195,180'},${0.05 + Math.random() * 0.08})`; g.fillRect(Math.random() * W, Math.random() * H, 6 + Math.random() * 30, 3 + Math.random() * 10); }
    g.strokeStyle = 'rgba(40,60,50,.35)'; g.lineWidth = 1.5;
    for (let y = 0; y < H; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    for (let y = 0; y < H; y += 16) for (let x = (y / 16) % 2 ? 0 : 20; x < W; x += 40) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 16); g.stroke(); }
  });
}
// 三つ巴 (賽銭箱の金具)
function tomoeTex() {
  return canvasTexture(64, 64, (g) => {
    g.fillStyle = '#c9a548'; g.beginPath(); g.arc(32, 32, 31, 0, 7); g.fill();
    g.fillStyle = '#6b4c1c';
    for (let k = 0; k < 3; k++) {
      const a = k * 2.094;
      g.beginPath(); g.arc(32 + Math.cos(a) * 11, 32 + Math.sin(a) * 11, 8, 0, 7); g.fill();
      g.beginPath(); g.arc(32, 32, 19, a + 0.3, a + 1.6); g.arc(32, 32, 15, a + 1.6, a + 0.6, true); g.fill();
    }
  });
}
// 紅白の鈴緒
function ropeTex() {
  return canvasTexture(16, 64, (g, W, H) => {
    g.fillStyle = '#f2ece2'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#c8302c'; for (let y = -16; y < H; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + 8); g.lineTo(W, y + 13); g.lineTo(0, y + 5); g.fill(); }
  });
}

// 入母屋の屋根 (外側の軒 = 幅 2*xs・奥行き 2*zs・高さ E、内側の破風 = 幅 2*xi・奥行き 2*zi・高さ Y、棟 R)。軒の四隅は少し反らせる
function irimoya(top, under, xs, zs, E, xi, zi, Y, R, lift = 0.18) {
  const c = (sx, sz) => [sx * xs, E + lift, sz * zs], m = (sx, sz, y = E) => [sx * xs * 0.55, y, sz * zs];
  const i = (sx, sz) => [sx * xi, Y, sz * zi], r = (sx) => [sx * xi, R, 0];
  const faces = [];
  for (const sz of [-1, 1]) { // 前後: 軒 (中央は低く、隅は反る) → 破風の高さ → 棟
    faces.push([c(-1, sz), m(-1, sz), i(-1, sz)], [m(-1, sz), m(1, sz), i(1, sz), i(-1, sz)], [m(1, sz), c(1, sz), i(1, sz)]);
    faces.push([i(-1, sz), i(1, sz), r(1), r(-1)]);
  }
  for (const sx of [-1, 1]) faces.push([c(sx, -1), c(sx, 1), i(sx, 1), i(sx, -1)]); // 左右の短い斜面
  const uvOf = (p) => [p[0] / 2, (p[2] + p[1] * 0.6) / 2];
  for (const f of faces) {
    const tri = (a, b, d) => {
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(...n) || 1; n = n.map((v) => v / l); if (n[1] < 0) n = n.map((v) => -v);
      top.tri(a, b, d, n, uvOf(a), uvOf(b), uvOf(d));
      const o = (p) => [p[0], p[1] - 0.12, p[2]];
      under.tri(o(a), o(b), o(d), n.map((v) => -v));
    };
    tri(f[0], f[1], f[2]); if (f[3]) tri(f[0], f[2], f[3]);
  }
}

function buildHall(s, shadow) {
  const g = new THREE.Group(), hl = s.hall;
  const add = (m, x, y, z) => { m.position.set(x, y, z); g.add(shadow(m)); return m; };
  const box = (w, h, d, c) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof c === 'string' ? mat(c) : c);
  const xs = hl.roof_w / 2, zs = hl.roof_d / 2, E = hl.eave, R = hl.ridge, F = hl.floor;
  const bw = hl.body_w, bd = hl.body_d, bz = hl.body_z;
  const zf = bz + bd / 2;                      // 身舎の正面
  const zk = zs + hl.kohai - 0.45;             // 向拝の柱
  // 基壇 (コンクリート) と、向拝の下の張り出し
  add(box(5.6, 0.22, 6.2, CONC), 0, 0.11, -0.35);
  add(box(2.9, 0.22, hl.kohai + 0.7, CONC), 0, 0.11, zs + hl.kohai / 2 - 0.2);
  // 床下 (暗い) と浜縁 (身舎のまわりの縁側)
  add(box(bw - 0.1, F - 0.22, bd - 0.1, WOOD_D), 0, 0.22 + (F - 0.22) / 2, bz);
  add(box(4.8, 0.08, 5.1, DECK), 0, F - 0.04, -0.35);
  for (const [px, pz] of [[-2.3, -2.8], [2.3, -2.8], [-2.3, 2.1], [2.3, 2.1], [-2.3, -0.35], [2.3, -0.35]]) add(box(0.12, F - 0.3, 0.12, WOOD_D), px, 0.22 + (F - 0.3) / 2, pz);
  // 木の階段 (3 段)
  for (let k = 0; k < 3; k++) add(box(1.8, 0.08, 0.32, DECK), 0, 0.22 + (k + 1) * (F - 0.22) / 4, 2.2 + 0.32 * (2.5 - k));
  for (const sx of [-1, 1]) add(box(0.08, F - 0.1, 1.05, WOOD_D), sx * 0.92, 0.22 + (F - 0.32) / 2, 2.72);
  // 身舎: 板壁と正面の格子戸
  const side = mat('#fff', { map: wallTex(false) }), front = mat('#fff', { map: wallTex(true) });
  const wallH = E - F - 0.1;
  add(new THREE.Mesh(new THREE.BoxGeometry(bw, wallH, bd), [side, side, mat(WOOD_D), mat(WOOD_D), front, side]), 0, F + wallH / 2, bz);
  for (const [px, pz] of [[-bw / 2, zf], [bw / 2, zf], [-bw / 2, bz - bd / 2], [bw / 2, bz - bd / 2]]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, wallH + 0.1, 10), mat(WOOD_D)), px, F + wallH / 2, pz);
  add(box(bw + 0.4, 0.3, bd + 0.4, WOOD_D), 0, E - 0.18, bz);                      // 軒下の組物 (まとめて 1 つの帯)
  // 屋根
  const top = new Builder(), under = new Builder();
  irimoya(top, under, xs, zs, E, 2.15, 1.55, 4.65, R);
  const roofM = mat('#fff', { map: copperTex(), roughness: 0.6, metalness: 0.15, side: THREE.DoubleSide });
  g.add(shadow(new THREE.Mesh(top.geometry(), roofM)));
  g.add(new THREE.Mesh(under.geometry(), mat('#3b2b20', { side: THREE.DoubleSide })));
  // 破風 (妻の三角の板) と懸魚
  for (const sx of [-1, 1]) {
    const tri = new THREE.Shape([new THREE.Vector2(-1.55, 0), new THREE.Vector2(1.55, 0), new THREE.Vector2(0, R - 4.65)]);
    const m = add(new THREE.Mesh(new THREE.ShapeGeometry(tri), mat(WOOD, { side: THREE.DoubleSide })), sx * 2.12, 4.65, 0);
    m.rotation.y = Math.PI / 2;
    add(box(0.06, 0.35, 0.3, '#c9a548'), sx * 2.16, R - 0.5, 0);
  }
  // 棟と鬼板
  add(box(2 * 2.15 + 0.5, 0.26, 0.34, CU_D), 0, R + 0.08, 0);
  for (const sx of [-1, 1]) { const o = add(box(0.18, 0.62, 0.5, CU_D), sx * 2.5, R + 0.22, 0); o.rotation.z = sx * -0.15; }
  for (const k of [-0.9, 0, 0.9]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.36, 14).rotateX(Math.PI / 2), mat('#c9a548', { metalness: 0.4 })), k, R + 0.08, 0); // 棟の紋
  // 向拝: 屋根 (主屋根の前の斜面から前へ張り出す)・柱・虹梁
  {
    const zA = zs - 0.4, yA = E + (0.4 / (zs - 1.55)) * (4.65 - E), zB = zs + hl.kohai, yB = E - 0.15, w = 1.95;
    const b = new Builder(), u = new Builder();
    const P = [[-w, yA, zA], [w, yA, zA], [w, yB + 0.1, zB], [-w, yB + 0.1, zB]];
    b.quad(...P, [0, 1, 0], [[0, 0], [2, 0], [2, 1], [0, 1]]);
    u.quad(...P.map((p) => [p[0], p[1] - 0.12, p[2]]), [0, -1, 0]);
    g.add(shadow(new THREE.Mesh(b.geometry(), roofM)), new THREE.Mesh(u.geometry(), mat('#3b2b20', { side: THREE.DoubleSide })));
    add(box(2 * w + 0.1, 0.2, 0.12, '#3b2b20'), 0, yB - 0.02, zB);                 // 軒先の板
  }
  for (const sx of [-1, 1]) {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.25, 12), mat(CONC)), sx * 1.3, 0.34, zk);       // 礎石
    add(box(0.22, E - 0.45, 0.22, WOOD), sx * 1.3, 0.45 + (E - 0.45) / 2, zk);                                  // 柱
    const beam = add(box(0.16, 0.22, zk - zf, WOOD_D), sx * 1.3, E - 0.3, (zk + zf) / 2);                     // 海老虹梁 (まっすぐ)
    beam.rotation.x = -0.06;
  }
  add(box(2.9, 0.24, 0.22, WOOD_D), 0, E - 0.28, zk);                               // 頭貫
  // しめ縄と紙垂 (柱の間に、少したるませて)
  {
    const pts = []; for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push(new THREE.Vector3(-1.2 + 2.4 * t, E - 0.62 - 0.2 * Math.sin(t * Math.PI), zk)); }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.05, 6), mat('#d6c48c')));
    const paper = mat('#ffffff', { side: THREE.DoubleSide });
    for (const t of [0.2, 0.5, 0.8]) {
      const x = -1.2 + 2.4 * t, y = E - 0.62 - 0.2 * Math.sin(t * Math.PI);
      const zig = new THREE.Shape([[0, 0], [0.1, 0], [0.1, -0.12], [0.18, -0.12], [0.18, -0.26], [0.26, -0.26], [0.26, -0.4], [0.16, -0.4], [0.16, -0.26], [0.08, -0.26], [0.08, -0.12], [0, -0.12]].map(([a, b2]) => new THREE.Vector2(a, b2)));
      add(new THREE.Mesh(new THREE.ShapeGeometry(zig), paper), x - 0.13, y - 0.02, zk + 0.02);
    }
  }
  // 鈴と鈴緒 (頭貫から、賽銭箱の上へ)
  add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), mat('#c9a548', { metalness: 0.6, roughness: 0.35 })), 0, E - 0.55, zk - 0.25);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, E - 1.6, 8), mat('#fff', { map: ropeTex() })), 0, 1.0 + (E - 1.6) / 2 - 0.05, zk - 0.25);
  // 賽銭箱 (三つ巴の金具)
  add(box(1.15, 0.6, 0.62, '#7a4a2a'), 0, 0.22 + 0.3, zs + 0.35);
  const tm = add(new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), mat('#fff', { map: tomoeTex(), metalness: 0.3 })), 0, 0.52, zs + 0.35 + 0.315);
  tm.renderOrder = 1;
  return g;
}

// 赤い屋根の小屋 (切妻。棟は奥行きの向き。板壁にガラス戸)
function buildAnnex(an, shadow) {
  const g = new THREE.Group();
  const w = an.w, d = an.d, E = an.eave, R = an.ridge;
  const wallM = mat('#fff', { map: canvasTexture(256, 128, (c, W, H) => {
    c.fillStyle = '#5a4130'; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(0,0,0,.25)'; for (let y = 0; y < H; y += 9) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.fillStyle = '#d8dfe0'; for (let k = 0; k < 3; k++) c.fillRect(30 + k * 70, 30, 56, 50);
    c.strokeStyle = '#6a5240'; c.lineWidth = 4; for (let k = 0; k < 3; k++) { c.strokeRect(30 + k * 70, 30, 56, 50); c.beginPath(); c.moveTo(58 + k * 70, 30); c.lineTo(58 + k * 70, 80); c.stroke(); }
  }) });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, E, d), wallM); body.position.y = E / 2; g.add(shadow(body));
  const b = new Builder(), ov = 0.35, hw = w / 2 + ov, hd = d / 2 + ov;
  for (const sx of [-1, 1]) b.quad([sx * hw, E - 0.1, -hd], [sx * hw, E - 0.1, hd], [0, R, hd], [0, R, -hd], [sx * 0.5, 1, 0]);
  g.add(shadow(new THREE.Mesh(b.geometry(), mat(an.roof || '#b4473b', { side: THREE.DoubleSide, roughness: 0.6 }))));
  for (const sz of [-1, 1]) {
    const tri = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, R - E)])), mat('#5a4130', { side: THREE.DoubleSide }));
    tri.position.set(0, E, sz * d / 2); g.add(tri);
  }
  return g;
}

export function buildShrines(shrines, scene, world) {
  const group = new THREE.Group(); group.name = 'shrines';
  const shadow = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  for (const s of shrines || []) {
    const root = new THREE.Group();
    root.position.set(s.origin[0], s.y, s.origin[1]);
    root.rotation.y = s.yaw;
    root.add(buildHall(s, shadow));
    if (s.annex) { const a = buildAnnex(s.annex, shadow); a.position.set(s.annex.at[0], 0, s.annex.at[1]); root.add(a); }
    group.add(root);
    world.addColliders(s.colliders, true);
  }
  scene.add(group);
  return group;
}
