// 千葉ドリームランド: ライブ会場「サンライズ・ライブステージ」(コースターの跡地)。
// 位置・向き・形は tools/park_areas.py が決めた public/data/park.json の gen.rides.live (中心 x・z、yaw、fan = 客席の扇形、stage = ステージ)。ここは読んで作るだけ。
// 周りの木・花壇・街灯・ベンチ・広場へつなぐ道は、同じ生成が gen の trees・beds・lamps・benches・paths に足してある (parkareas.js が描く)。
// ローカル座標: x = 右、z = 前 (サンライズ・プラザの中心の向き)。奥 (-z) にステージ、手前 (+z) が客席の扇。group.rotation.y = yaw。
// 色は園のパステル (クリーム・桃・水色・金・藤色)。朝日 (サンライズ) の意匠: 扇の舗装は広場と同じ放射状、屋根の上に太陽の冠。
// 演者 (歌・ギター・ベース・キーボード・ドラム・ダンサー 7 人) は、街の人と同じ人形 (crowd.js の形とシェーダ。腕の動きだけ曲に合わせる) を 1 つの InstancedMesh で描く。ライブの状態 (parklivesched.js) は main.js が setLive() で渡す。
// 描画の数を抑える: 動かない部品は Geo で材質ごとに 1 つにまとめる。動くのは大画面の絵の切り替え・ムービングライトの光線 (夜だけ見える)・演者。
// 動き・光は実際の時計 (Date.now) で決まる (だれが見ても同じ)。カメラが会場の 450 m 以内のときだけ update が動かす。
import * as THREE from 'three';
import { canvasTexture } from './util.js';
import { fontCss } from './parkfont.js';
import { Geo } from './parkrides.js';
import { createTier, STYLE } from '../crowdfigure.js';

export function buildLive(ctx) {
  const { cfg, ground, std, glowMat, group, col, emissive, low } = ctx;
  const L = cfg.gen && cfg.gen.rides && cfg.gen.rides.live;
  const api = { group: new THREE.Group(), stats: {}, update() {}, center: L ? { x: L.x, z: L.z } : null };
  api.group.name = 'park_live';
  group.add(api.group);
  if (!L) return api;

  const F = L.fan, ST = L.stage, gy = ground(L.x, L.z);
  const g = new THREE.Group(); g.position.set(L.x, gy, L.z); g.rotation.y = L.yaw; api.group.add(g);
  const worldOf = (lx, lz) => [L.x + lx * Math.cos(L.yaw) + lz * Math.sin(L.yaw), L.z - lx * Math.sin(L.yaw) + lz * Math.cos(L.yaw)];
  let tris = 0, LS = null;   // LS = ライブの状態 (parklivesched.js の state)。main.js が setLive() で毎コマ渡す
  const addMesh = (geo, mat, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; g.add(m); tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3; return m; };
  const box = (hx, hz, x, z, y0, y1) => col.box.push([...worldOf(x, z), L.yaw, hx, hz, gy + y0, gy + y1]);   // 当たり判定 (ローカル → ワールド)
  const circ = (x, z, r, y0, y1) => col.circle.push([...worldOf(x, z), r, gy + y0, gy + y1]);

  // ---------- 寸法 (ローカル) ----------
  const SW = ST.w, SD = ST.d, SH = 2.2;                    // ステージ: 幅・奥行き・高さ
  const zBack = ST.back, zFront = zBack + SD, zMid = (zBack + zFront) / 2;
  const SCW = 32, SCH = 15, SCY = 5.6;                     // 大画面: 幅・高さ・下端
  const TOP = 25;                                          // 屋根のトラスの高さ
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------- 園の配色 ----------
  const C = { cream: '#f4e9d2', pink: '#ff9ccf', teal: '#3fb8b0', gold: '#e9c26a', plum: '#6b5aa6', lav: '#b79ae0' };
  const cream = std(C.cream, 0.55), plum = std(C.plum, 0.55), plumD = std('#4b4561', 0.55), lavM = std(C.lav, 0.5), goldM = std(C.gold, 0.4), pinkM = std('#f6a8cc', 0.6);
  const ledPink = glowMat(C.pink, 1.5), ledCyan = glowMat('#8fe8ff', 1.5), ledGold = glowMat('#ffd36b', 1.6);

  // ---------- 客席の舗装: 扇形 (広場と同じ放射状の模様。縁はなだらかに芝へ消える) + ステージの前庭 ----------
  {
    const tex = canvasTexture(1024, 1024, (c) => {
      const mid = 512, cols = ['#f8ecd6', '#f2dce8', '#dcecf8', '#fbf3c8'];
      const n = 20;   // 筋 20 本 (扇の 100° では 5° ずつ)
      for (let k = 0; k < n; k++) { c.fillStyle = cols[k % 4]; c.beginPath(); c.moveTo(mid, mid); c.arc(mid, mid, 520, k / n * Math.PI * 2, (k + 1) / n * Math.PI * 2); c.closePath(); c.fill(); }
      c.strokeStyle = '#ffffff'; c.lineWidth = 8;
      for (const r of [120, 250, 380, 480]) { c.beginPath(); c.arc(mid, mid, r, 0, Math.PI * 2); c.stroke(); }
      c.fillStyle = '#ffd36b'; for (let k = 0; k < 20; k++) { const a = (k + 0.5) / 20 * Math.PI * 2; for (const r of [185, 315, 430]) { c.beginPath(); c.arc(mid + Math.cos(a) * r, mid + Math.sin(a) * r, 7, 0, Math.PI * 2); c.fill(); } }
      // 縁をなだらかに消す (芝との境目をぼかす)
      c.globalCompositeOperation = 'destination-in';
      const gr = c.createRadialGradient(mid, mid, 0, mid, mid, 512); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.9, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gr; c.fillRect(0, 0, 1024, 1024);
    });
    tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const ang = F.ang * Math.PI / 180;
    // CircleGeometry は XY 平面の扇 (UV は円の中心が (0.5, 0.5))。rotateX(-π/2) で y → -z。扇の中心の向きを +z にする
    const sector = new THREE.CircleGeometry(F.R / 0.9 * 0.97, 48, -Math.PI / 2 - ang / 2, ang).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(sector, mat); m.position.set(0, 0.2, F.apexV); m.receiveShadow = true; m.renderOrder = 1; g.add(m); tris += 48;
    // ステージの前庭 (ステージの前と両わき): 淡い市松の舗装
    const tile = canvasTexture(256, 256, (c) => {
      c.fillStyle = '#f6ecd8'; c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { c.fillStyle = (i + j) % 2 ? '#f2dce8' : '#fbf3c8'; c.fillRect(i * 32, j * 32, 32, 32); }
    });
    tile.wrapS = tile.wrapT = THREE.RepeatWrapping;
    const fw = SW + 10, z0 = zBack - 2, z1 = F.apexV + 8, fd = z1 - z0;
    tile.repeat.set(fw / 8, fd / 8);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tile, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
    front.position.set(0, 0.19, (z0 + z1) / 2); front.receiveShadow = true; g.add(front); tris += 2;
    const eg = new Geo();   // 前庭の縁取り (クリーム色の低い縁石)
    eg.box(fw + 0.8, 0.3, 0.4, 0, 0.15, z0 - 0.2); eg.box(0.4, 0.3, fd, -fw / 2 - 0.2, 0.15, (z0 + z1) / 2); eg.box(0.4, 0.3, fd, fw / 2 + 0.2, 0.15, (z0 + z1) / 2);
    addMesh(eg.geometry(), cream, false);
  }

  // ---------- ステージ ----------
  {
    const sg = new Geo(); sg.box(SW, SH, SD, 0, SH / 2, zMid); addMesh(sg.geometry(), lavM);
    const top = new Geo(); top.box(SW - 0.6, 0.06, SD - 0.6, 0, SH + 0.03, zMid); addMesh(top.geometry(), std('#fff2cc', 0.45), false);
    const lipP = new Geo(), lipC = new Geo(), lipG = new Geo();   // 前の縁の電飾 (3 色が帯で並ぶ)
    for (let i = 0; i < 23; i++) { const x = -SW / 2 + 1 + i * 2; (i % 3 === 0 ? lipP : i % 3 === 1 ? lipC : lipG).box(1.8, 0.5, 0.12, x, SH - 0.55, zFront + 0.07); }
    addMesh(lipP.geometry(), ledPink, false); addMesh(lipC.geometry(), ledCyan, false); addMesh(lipG.geometry(), ledGold, false);
    const st = new Geo();   // 階段 (両わき)
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) st.box(1.9, SH * (k + 1) / 4, 1.0, s * (SW / 2 + 1.0), SH * (k + 1) / 8, zFront - 1.6 - k * 1.0);
    addMesh(st.geometry(), pinkM);
    const hw = 6, hl = 14, ext = new Geo(); ext.box(hw, SH - 0.1, hl, 0, (SH - 0.1) / 2, zFront + hl / 2); addMesh(ext.geometry(), lavM);   // 花道 (前へ 14 m)
    const extTop = new Geo(); extTop.box(hw - 0.5, 0.06, hl - 0.5, 0, SH - 0.07, zFront + hl / 2); addMesh(extTop.geometry(), std('#fff2cc', 0.45), false);
    const el = new Geo(); el.box(hw + 0.1, 0.4, 0.12, 0, SH - 0.5, zFront + hl + 0.06); el.box(0.12, 0.4, hl, -hw / 2 - 0.05, SH - 0.5, zFront + hl / 2); el.box(0.12, 0.4, hl, hw / 2 + 0.05, SH - 0.5, zFront + hl / 2);
    addMesh(el.geometry(), ledPink, false);
    box(SW / 2, SD / 2, 0, zMid, -1, SH);
    box(hw / 2, hl / 2, 0, zFront + hl / 2, -1, SH - 0.1);
  }

  // ---------- トラスの塔・屋根・照明バー ----------
  const trussAt = (geo, x0, y0, z0, x1, y1, z1, r) => {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), d = b.clone().sub(a), len = d.length();
    geo.add(new THREE.CylinderGeometry(r, r, len, 6), new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(1, 1, 1)));
  };
  const towerXs = [-SW / 2 - 1.5, SW / 2 + 1.5], towerZs = [zBack + 1.5, zFront - 1.5];
  const barY = TOP - 4.5, barZ = towerZs[1] - 5;
  {
    const tg = new Geo(), H = TOP, hs = 0.9;
    for (const x of towerXs) for (const z of towerZs) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) trussAt(tg, x + sx * hs, 0, z + sz * hs, x + sx * hs, H, z + sz * hs, 0.14);
      for (let y = 0; y < H; y += 3) {
        for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [-1, 1, 1, 1], [-1, -1, -1, 1], [1, -1, 1, 1]]) trussAt(tg, x + ax * hs, y, z + az * hs, x + bx * hs, y, z + bz * hs, 0.07);
        trussAt(tg, x - hs, y, z - hs, x + hs, y + 3, z - hs, 0.06); trussAt(tg, x - hs, y, z + hs, x + hs, y + 3, z + hs, 0.06);
      }
      circ(x, z, 1.5, -1, H);
    }
    for (const z of towerZs) for (const dy of [0, -1.8]) trussAt(tg, towerXs[0], TOP + dy, z, towerXs[1], TOP + dy, z, 0.18);
    for (const x of towerXs) trussAt(tg, x, TOP, towerZs[0], x, TOP, towerZs[1], 0.18);
    for (let x = towerXs[0]; x < towerXs[1] - 0.1; x += 3) trussAt(tg, x, TOP, towerZs[1], Math.min(x + 3, towerXs[1]), TOP - 1.8, towerZs[1], 0.07);
    for (const dy of [0, -1.2]) trussAt(tg, towerXs[0] + 3, barY + dy, barZ, towerXs[1] - 3, barY + dy, barZ, 0.14);
    for (const x of [towerXs[0] + 3, towerXs[1] - 3]) { trussAt(tg, x, barY, barZ, x, TOP, barZ, 0.1); trussAt(tg, x, barY, barZ, x, barY, towerZs[0], 0.1); }
    addMesh(tg.geometry(), cream);
    api.stats.tower = TOP;
    // 屋根: 縞の布のかまぼこ形 (桃とクリーム)。前の縁に波形の飾り布
    const roofLen = towerZs[1] - towerZs[0] + 1.0, span = SW + 6, rise = 3.2;
    const rr = (span * span / 4 + rise * rise) / (2 * rise), half = Math.asin(span / 2 / rr), thick = 0.25;
    const sh = new THREE.Shape(), N = 18;
    for (let i = 0; i <= N; i++) { const a = -half + 2 * half * i / N, x = rr * Math.sin(a), y = rr * Math.cos(a) - (rr - rise); i ? sh.lineTo(x, y) : sh.moveTo(x, y); }
    for (let i = N; i >= 0; i--) { const a = -half + 2 * half * i / N, x = (rr - thick) * Math.sin(a), y = (rr - thick) * Math.cos(a) - (rr - rise); sh.lineTo(x, y); }
    const roofGeo = new THREE.ExtrudeGeometry(sh, { depth: roofLen, bevelEnabled: false, curveSegments: 1 });
    const stripe = canvasTexture(64, 8, (c) => { c.fillStyle = '#f6a8cc'; c.fillRect(0, 0, 32, 8); c.fillStyle = '#fff6e6'; c.fillRect(32, 0, 32, 8); });
    stripe.wrapS = stripe.wrapT = THREE.RepeatWrapping; stripe.repeat.set(1 / 6, 1);
    const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.75, side: THREE.DoubleSide }));
    roof.position.set(0, TOP + 0.3, towerZs[0] - 0.5); roof.castShadow = true; roof.receiveShadow = true; g.add(roof); tris += 160;
    const vp = new Geo(), vc = new Geo(), nV = Math.round((SW + 3) / 1.6);
    for (let i = 0; i < nV; i++) { const x = -(SW + 3) / 2 + 0.8 + i * 1.6, gg = i % 2 ? vc : vp; gg.box(1.5, 1.25, 0.08, x, TOP - 0.55, towerZs[1] + 0.55); gg.box(1.2, 0.3, 0.08, x, TOP - 1.35, towerZs[1] + 0.55); }
    addMesh(vp.geometry(), pinkM, false); addMesh(vc.geometry(), cream, false);
    // 屋根の上の太陽の冠: 金の輪・光る円板・光条 (夜は光る)
    const sun = new THREE.Group(); sun.position.set(0, TOP + 0.3 + rise + 3.6, zMid); g.add(sun);
    sun.add(new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.32, 8, 40), ledGold)); tris += 640;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2.6, 28), glowMat('#ffe08a', 0.9)); disc.position.z = -0.05; sun.add(disc); tris += 28;
    const rays = new Geo();
    for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2, r0 = 4.6 + (k % 2) * 0.6; rays.box(0.5, 2.2 + (k % 2) * 1.2, 0.3, Math.sin(a) * r0, Math.cos(a) * r0, 0, 0, 0, -a); }
    sun.add(new THREE.Mesh(rays.geometry(), ledGold)); tris += 14 * 12;
    // 旗の連なり (前の梁の上と、左右の横梁の上。三角の小旗)
    const nf = 28, flagG = new THREE.ConeGeometry(0.42, 0.9, 3).rotateX(Math.PI).translate(0, -0.45, 0);
    const fl = new THREE.InstancedMesh(flagG, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }), nf * 2), dm = new THREE.Object3D(), cc = new THREE.Color(), fc = ['#ff7fb5', '#3fc8ff', '#ffd36b', '#ffffff', '#8f7bff'];
    let k = 0;
    for (let i = 0; i < nf; i++) { const t = i / (nf - 1); dm.position.set(towerXs[0] + (towerXs[1] - towerXs[0]) * t, TOP + 0.35 - Math.sin(t * Math.PI) * 0.5, towerZs[1]); dm.rotation.y = 0; dm.updateMatrix(); fl.setMatrixAt(k, dm.matrix); fl.setColorAt(k, cc.set(fc[k % 5])); k++; }
    for (const x of towerXs) for (let i = 0; i < nf / 4; i++) { const t = i / (nf / 4 - 1); dm.position.set(x, TOP + 0.35 - Math.sin(t * Math.PI) * 0.4, towerZs[0] + (towerZs[1] - towerZs[0]) * t); dm.rotation.y = Math.PI / 2; dm.updateMatrix(); fl.setMatrixAt(k, dm.matrix); fl.setColorAt(k, cc.set(fc[(k + 2) % 5])); k++; }
    fl.count = k; fl.instanceColor.needsUpdate = true; g.add(fl);
  }

  // ---------- 大画面 (中央) と袖の画面 ----------
  const sceneTex = [];
  const mkScene = (i) => canvasTexture(1024, 480, (c, w, h) => {
    const grd = c.createLinearGradient(0, 0, 0, h);
    const pal = [['#2a1d6b', '#ff6fa0', '#ffc86b'], ['#08234a', '#2fb0c8', '#e5ff9a'], ['#3c1250', '#c850d6', '#ffe08a']][i];
    grd.addColorStop(0, pal[0]); grd.addColorStop(0.62, pal[1]); grd.addColorStop(1, pal[2]);
    c.fillStyle = grd; c.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.82;
    c.save(); c.globalAlpha = 0.22; c.fillStyle = '#ffffff';
    for (let k = 0; k < 18; k++) { const a0 = Math.PI + k / 18 * Math.PI, a1 = a0 + Math.PI / 36; c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, w, a0, a1); c.closePath(); c.fill(); }
    c.restore();
    c.fillStyle = '#fff3c4'; c.beginPath(); c.arc(cx, cy, 130, Math.PI, 0); c.fill();
    c.fillStyle = '#ffb36b'; c.beginPath(); c.arc(cx, cy, 96, Math.PI, 0); c.fill();
    c.fillStyle = 'rgba(30,20,60,0.55)'; c.fillRect(0, cy, w, h - cy);
    c.textAlign = 'center'; c.fillStyle = '#ffffff'; c.shadowColor = 'rgba(40,10,70,0.7)'; c.shadowBlur = 14;
    c.font = fontCss('block', 120); c.fillText('SUNRISE', cx, 150);
    c.font = fontCss('logo', 118); c.fillStyle = ['#ffe08a', '#d8fff4', '#ffd0f0'][i]; c.fillText('Live!', cx, 280);
    c.shadowBlur = 0; c.font = fontCss('pop', 44); c.fillStyle = '#ffffff'; c.fillText(['Chiba Dreamland', 'LIVE STAGE', 'Thank you for coming!'][i], cx, h - 38);
  });
  const nScene = low ? 2 : 3;
  for (let i = 0; i < nScene; i++) sceneTex.push(mkScene(i));
  const screenMat = new THREE.MeshStandardMaterial({ map: sceneTex[0], emissiveMap: sceneTex[0], emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.4 });
  screenMat.userData.glow = 1.05; emissive.push(screenMat);
  {
    const zs = zBack + 2.4;
    const main = new THREE.Mesh(new THREE.PlaneGeometry(SCW, SCH), screenMat); main.position.set(0, SCY + SCH / 2, zs); main.name = 'park_live_screen'; g.add(main); tris += 2;
    const fr = new Geo();
    fr.box(SCW + 1.2, 0.6, 0.5, 0, SCY - 0.3, zs - 0.2); fr.box(SCW + 1.2, 0.6, 0.5, 0, SCY + SCH + 0.3, zs - 0.2); fr.box(0.6, SCH, 0.5, -SCW / 2 - 0.3, SCY + SCH / 2, zs - 0.2); fr.box(0.6, SCH, 0.5, SCW / 2 + 0.3, SCY + SCH / 2, zs - 0.2);
    fr.box(SCW, SCH, 0.4, 0, SCY + SCH / 2, zs - 0.4);
    addMesh(fr.geometry(), plumD);
    const backPanel = new THREE.Mesh(new THREE.PlaneGeometry(SCW + 1.2, SCH + 1.2), new THREE.MeshStandardMaterial({ map: sceneTex[0], roughness: 0.7 }));   // 裏側にも朝日の絵 (静止)
    backPanel.position.set(0, SCY + SCH / 2, zs - 0.66); backPanel.rotation.y = Math.PI; g.add(backPanel); tris += 2;
    const gold = new Geo(); gold.box(SCW + 1.8, 0.25, 0.7, 0, SCY + SCH + 0.75, zs - 0.15); gold.box(SCW + 1.8, 0.25, 0.7, 0, SCY - 0.75, zs - 0.15);
    addMesh(gold.geometry(), goldM, false);
    for (const s of [-1, 1]) {
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(9, 15), screenMat); sm.position.set(s * (SW / 2 + 9.5), 4 + 7.5, zFront + 1.5); sm.rotation.y = -s * 0.28; g.add(sm); tris += 2;
      const fb = new Geo(); fb.box(9.8, 15.8, 0.5, 0, 0, -0.35);
      const fm = new THREE.Mesh(fb.geometry(), plumD); fm.position.copy(sm.position); fm.rotation.y = sm.rotation.y; fm.castShadow = true; g.add(fm); tris += 12;
      const pl = new Geo(); pl.box(0.7, 4, 0.7, 0, 2, 0); const pm = new THREE.Mesh(pl.geometry(), cream); pm.position.set(sm.position.x, 0, sm.position.z - 0.2); g.add(pm);
      box(0.6, 0.6, sm.position.x, sm.position.z - 0.2, -1, 19.5);
    }
  }

  // ---------- スピーカー (積み上げと吊り) ----------
  {
    const sp = new Geo(), grille = new Geo();
    for (const s of [-1, 1]) {
      const x = s * (SW / 2 + 4.2), z = zFront + 0.5;
      for (let k = 0; k < 5; k++) { sp.box(2.6, 1.7, 1.6, x, 0.85 + k * 1.72, z); grille.box(2.2, 1.35, 0.08, x, 0.85 + k * 1.72, z + 0.82); }
      box(1.3, 0.8, x, z, -1, 8.6);
      for (let k = 0; k < 6; k++) { sp.box(1.6, 1.2, 1.4, s * (SW / 2 - 4), TOP - 2 - k * 1.25, zFront - 2.5); grille.box(1.3, 1.0, 0.08, s * (SW / 2 - 4), TOP - 2 - k * 1.25, zFront - 1.75); }
    }
    for (let i = -3; i <= 3; i++) sp.box(1.3, 0.55, 0.8, i * 5.5, SH + 0.28, zFront - 1.0);
    addMesh(sp.geometry(), plumD); addMesh(grille.geometry(), std('#7d73a0', 0.55), false);
  }

  // ---------- ムービングライト (照明バーに並ぶ。光線は夜だけ・動く) ----------
  const beamMats = ['#ff9ccf', '#8fe8ff', '#ffe08a'].map((c) => { const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }); m.userData.glow = 0.075; m.userData.opacityOnly = true; emissive.push(m); return m; });
  const beams = [];
  {
    const nB = low ? 8 : 16, fix = new Geo(), BL = 46, bgeo = new THREE.ConeGeometry(1.9, BL, 12, 1, true).translate(0, -BL / 2, 0);
    for (let i = 0; i < nB; i++) {
      const x = -SW / 2 + 4 + (SW - 8) * i / (nB - 1);
      fix.box(0.7, 0.8, 0.7, x, barY - 0.5, barZ);
      const pivot = new THREE.Group(); pivot.position.set(x, barY - 0.9, barZ); g.add(pivot);
      const m = new THREE.Mesh(bgeo, beamMats[i % 3]); m.renderOrder = 3; pivot.add(m);
      beams.push({ pivot, k: i, base: i % 2 ? 1 : -1 });
    }
    addMesh(fix.geometry(), plumD, false);
    const bulbG = new THREE.SphereGeometry(0.2, 6, 5), nb = Math.round(SW / 1.4);
    const bu = new THREE.InstancedMesh(bulbG, glowMat('#fff2b0', 1.8), nb), dm = new THREE.Object3D();
    for (let i = 0; i < nb; i++) { dm.position.set(towerXs[0] + (towerXs[1] - towerXs[0]) * i / (nb - 1), TOP - 2.1, towerZs[1] + 0.35); dm.updateMatrix(); bu.setMatrixAt(i, dm.matrix); }
    g.add(bu);
  }

  // ---------- 前の柵・ミキサー席・扇の両縁の電球の連なり・入口の門 ----------
  {
    const fenceZ = zFront + 16, fenceHalf = 27, fg = new Geo(), fp = new Geo();
    fg.box(fenceHalf * 2, 0.1, 0.1, 0, 1.05, fenceZ); fg.box(fenceHalf * 2, 0.1, 0.1, 0, 0.55, fenceZ);
    for (let x = -fenceHalf; x <= fenceHalf + 0.01; x += 2) fp.box(0.12, 1.2, 0.12, x, 0.6, fenceZ);
    addMesh(fg.geometry(), cream, false); addMesh(fp.geometry(), pinkM, false);
    box(fenceHalf, 0.2, 0, fenceZ, -1, 1.15);
    const mz = zFront + 38, tg = new Geo(), tc = new Geo();   // ミキサー席 (PA の天幕)
    tg.box(7.5, 1.0, 3.2, 0, 0.5, mz); for (const sx of [-1, 1]) for (const sz of [-1, 1]) tg.box(0.18, 3.4, 0.18, sx * 3.5, 1.7, mz + sz * 2.2);
    tc.box(8.6, 0.2, 5.6, 0, 3.5, mz);
    addMesh(tg.geometry(), plum); addMesh(tc.geometry(), pinkM);
    box(3.75, 1.6, 0, mz, -1, 1.1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) circ(sx * 3.5, mz + sz * 2.2, 0.2, -1, 3.5);
    // 扇の両わきの縁 (扇の要から ±半角) に、電球の連なり (柱 6 本ずつ)
    const poleG = new Geo(), y = 6.4, half = F.ang * Math.PI / 360;
    const nBul = 8, nP = 6, bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 6, 5), glowMat('#ffd89a', 1.8), 2 * (nP - 1) * nBul), dm = new THREE.Object3D();
    let bi = 0;
    for (const s of [-1, 1]) {
      const pts = [];
      for (let i = 0; i < nP; i++) { const r = 16 + (F.R - 22) * i / (nP - 1), a = s * half; pts.push([Math.sin(a) * r + s * 1.4, F.apexV + Math.cos(a) * r]); }
      pts.forEach(([x, z]) => { poleG.box(0.22, y, 0.22, x, y / 2, z); circ(x, z, 0.3, -1, y); });
      for (let i = 0; i < nP - 1; i++) for (let j = 0; j < nBul; j++) {
        const t = (j + 0.5) / nBul, sag = Math.sin(t * Math.PI) * 0.7;
        dm.position.set(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, y - 0.1 - sag, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t); dm.updateMatrix(); bulbs.setMatrixAt(bi++, dm.matrix);
      }
    }
    addMesh(poleG.geometry(), cream); g.add(bulbs);
    // 入口の門 (扇の先の中央。広場へつながる道の手前)
    const az = F.apexV + F.R - 3, ag = new Geo();
    for (const s of [-1, 1]) ag.box(1.0, 7.5, 1.0, s * 6.5, 3.75, az); ag.box(14.5, 1.5, 0.5, 0, 7.2, az);
    addMesh(ag.geometry(), cream);
    const crown = new Geo(); for (const s of [-1, 1]) crown.box(1.5, 0.4, 1.5, s * 6.5, 7.7, az); addMesh(crown.geometry(), goldM, false);
    for (const s of [-1, 1]) circ(s * 6.5, az, 0.7, -1, 7.5);
    const signTex = canvasTexture(768, 128, (c, w, h) => {
      c.fillStyle = '#6b5aa6'; c.fillRect(0, 0, w, h); c.strokeStyle = '#ffd36b'; c.lineWidth = 6; c.strokeRect(8, 8, w - 16, h - 16);
      c.textAlign = 'center'; c.fillStyle = '#ffe08a'; c.font = fontCss('block', 62); c.fillText('SUNRISE LIVE STAGE', w / 2, 82);
    });
    const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.5 }); signMat.userData.glow = 0.9; emissive.push(signMat);
    for (const f of [1, -1]) { const sg = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.3), signMat); sg.position.set(0, 7.2, az + f * 0.28); if (f < 0) sg.rotation.y = Math.PI; g.add(sg); tris += 2; }
  }

  // ---------- 裏方・売店 (ステージの裏と両わき) ----------
  {
    const wagon = (x, z, yaw, w, d, h, bodyCol, awnCol) => {   // 売店のワゴン・楽屋のトレーラー: 胴 + 窓 + ひさし
      const bg = new Geo(), ag = new Geo(), wg = new Geo();
      bg.box(w, h, d, 0, h / 2 + 0.35, 0); ag.box(w + 0.4, 0.12, 1.6, 0, h + 0.5, d / 2 + 0.6); wg.box(w * 0.55, h * 0.4, 0.06, 0, h * 0.62 + 0.35, d / 2 + 0.02);
      for (const [gm, mat, sh] of [[bg, std(bodyCol, 0.6), true], [ag, std(awnCol, 0.65), true], [wg, glowMat('#ffe9b8', 0.7), false]]) {
        const m = new THREE.Mesh(gm.geometry(), mat); m.position.set(x, 0, z); m.rotation.y = yaw; m.castShadow = sh; m.receiveShadow = true; g.add(m); tris += gm.p.length / 9;
      }
      const hx = (Math.abs(Math.cos(yaw)) * w + Math.abs(Math.sin(yaw)) * d) / 2, hz = (Math.abs(Math.sin(yaw)) * w + Math.abs(Math.cos(yaw)) * d) / 2;
      box(hx, hz, x, z, -1, h + 0.4);
    };
    const bz = zBack - 5;   // 楽屋のトレーラー (裏)
    wagon(-18, bz, 0, 8, 2.8, 2.8, '#f6a8cc', '#3fb8b0'); wagon(2, bz, 0, 8, 2.8, 2.8, '#bfe6d0', '#ff9ccf'); wagon(20, bz, 0, 8, 2.8, 2.8, '#fff0c0', '#8a6bd6');
    const names = [['#ffd0e4', '#ff7fb5'], ['#d8f0ff', '#3fb8b0'], ['#fff0c0', '#e9c26a'], ['#e0d4ff', '#8a6bd6']];   // 両わきの売店ワゴン
    [[-1, 12], [-1, 22], [1, 12], [1, 22]].forEach(([s, d], i) => wagon(s * (SW / 2 + 12 + (i % 2) * 6), zFront - 14 + d, s * 0.35, 4.2, 2.4, 2.4, names[i][0], names[i][1]));
    // パラソルとテーブル (売店の前)
    const pc = ['#ff7fb5', '#3fc8ff', '#ffd36b', '#8f7bff', '#3fb8b0'];
    const pG = new THREE.ConeGeometry(1.7, 0.8, 10).translate(0, 2.7, 0), poleG = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6).translate(0, 1.3, 0), tabG = new THREE.CylinderGeometry(0.8, 0.8, 0.08, 10).translate(0, 0.85, 0);
    const spots = [];
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) spots.push([s * (SW / 2 + 14 + (i % 2) * 5), zFront - 2 + i * 4.2]);
    const par = new THREE.InstancedMesh(pG, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }), spots.length), pol = new THREE.InstancedMesh(poleG, cream, spots.length), tab = new THREE.InstancedMesh(tabG, cream, spots.length);
    const dm = new THREE.Object3D(), cc = new THREE.Color();
    spots.forEach(([x, z], i) => { dm.position.set(x, 0, z); dm.updateMatrix(); par.setMatrixAt(i, dm.matrix); pol.setMatrixAt(i, dm.matrix); tab.setMatrixAt(i, dm.matrix); par.setColorAt(i, cc.set(pc[i % 5])); circ(x, z, 0.9, -1, 1); });
    par.instanceColor.needsUpdate = true; par.castShadow = true; g.add(par, pol, tab); tris += spots.length * (20 + 12 + 20);
    // 楽屋のテント (トレーラーの間・ステージの両すみ): 四角いすいの屋根
    const tent = new THREE.ConeGeometry(3.2, 2.2, 4).rotateY(Math.PI / 4).translate(0, 3.0, 0), tpole = new Geo();
    const tents = [[-9, bz + 0.4], [11, bz + 0.4], [-30, zBack + 2], [30, zBack + 2]];
    const tm = new THREE.InstancedMesh(tent, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }), tents.length);
    tents.forEach(([x, z], i) => { dm.position.set(x, 0, z); dm.updateMatrix(); tm.setMatrixAt(i, dm.matrix); tm.setColorAt(i, cc.set(['#ff9ccf', '#3fb8b0', '#ffd36b', '#8f7bff'][i % 4])); for (const sx of [-1, 1]) for (const sz of [-1, 1]) tpole.box(0.12, 2.2, 0.12, x + sx * 2.1, 1.1, z + sz * 2.1); circ(x, z, 2.4, -1, 3); });
    tm.instanceColor.needsUpdate = true; tm.castShadow = true; g.add(tm); addMesh(tpole.geometry(), cream, false); tris += tents.length * 8;
  }

  // ---------- 演者と楽器 (ライブの最中だけ出る。ドラムセットとキーボードは、いつも置いてある) ----------
  const perfProps = new THREE.Group(); g.add(perfProps);   // ギター・ベース (演者と一緒に出る)
  const staticSet = new Geo(), drumM = new Geo(), cymM = new Geo(), keyW = new Geo(), keyB = new Geo();
  const DZ = zBack + 7.2, KX = -17, KZ = zFront - 9.5;
  {
    staticSet.box(5.2, 0.5, 4.2, 0, SH + 0.25, DZ);                                   // ドラムの台
    drumM.add(new THREE.CylinderGeometry(0.5, 0.5, 0.55, 20).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(0, SH + 1.15, DZ + 0.8));   // バスドラム
    for (const [x, y, z, r] of [[-0.75, 1.75, -0.6, 0.32], [0.75, 1.75, -0.6, 0.32], [-1.3, 1.2, 0.4, 0.4], [1.2, 1.15, 0.5, 0.42]]) drumM.add(new THREE.CylinderGeometry(r, r, 0.3, 16), new THREE.Matrix4().makeTranslation(x, SH + y, DZ + z));   // タム・スネア
    for (const [x, y, z, r] of [[-1.9, 2.5, -0.3, 0.55], [1.9, 2.5, -0.1, 0.6], [0, 2.65, -1.5, 0.5]]) { cymM.add(new THREE.CylinderGeometry(r, r, 0.04, 20), new THREE.Matrix4().makeTranslation(x, SH + y, DZ + z)); staticSet.box(0.05, y - 0.5, 0.05, x, SH + 0.5 + (y - 0.5) / 2, DZ + z); }
    // キーボード (台 + 白鍵 + 黒鍵)
    staticSet.box(0.12, 1.0, 0.12, KX - 1.3, SH + 0.5, KZ + 1.0); staticSet.box(0.12, 1.0, 0.12, KX + 1.3, SH + 0.5, KZ + 1.0);
    keyW.box(3.0, 0.12, 0.8, KX, SH + 1.0, KZ + 1.0);
    for (let i = -5; i <= 5; i++) if (![-2, 1, 3].includes(i)) keyB.box(0.1, 0.06, 0.35, KX + i * 0.23 + 0.12, SH + 1.09, KZ + 0.85);
    addMesh(staticSet.geometry(), plumD); addMesh(drumM.geometry(), std('#ffd0e4', 0.5)); addMesh(cymM.geometry(), goldM, false);
    addMesh(keyW.geometry(), std('#fffaf0', 0.4), false); addMesh(keyB.geometry(), std('#2b2640', 0.4), false);
    box(2.6, 2.1, 0, DZ, -1, SH + 0.5); box(1.6, 0.5, KX, KZ + 1.0, -1, SH + 1.2);
    // ギター・ベース (演者の前に斜めに置く。ライブの最中だけ)
    const gtr = new Geo(), neckG = new Geo();
    for (const sx of [-1, 1]) { gtr.box(0.16, 0.5, 0.08, sx * 9 + sx * 0.05, SH + 0.95, zFront - 6.35, 0, 0, -sx * 0.55); neckG.box(0.07, 0.8, 0.05, sx * 9 + sx * 0.5, SH + 1.4, zFront - 6.3, 0, 0, -sx * 0.55); }
    perfProps.add(new THREE.Mesh(gtr.geometry(), pinkM), new THREE.Mesh(neckG.geometry(), goldM));
  }
  const PE = [   // 演者 { x, z, 大きさ, 曲の最中の動き (crowd.js のシェーダの mode), 色 }
    { x: 0, z: zFront - 3.2, sc: 1.12, mode: 5, top: '#ff7fb5', bottom: '#ffffff', hair: '#ffd36b', skin: '#f2c9a6', name: 'vocal' },
    { x: -9, z: zFront - 7.2, sc: 1.05, mode: 6, top: '#3fb8b0', bottom: '#4b4561', hair: '#3b2a1e', skin: '#e5b594', name: 'guitar' },
    { x: 9, z: zFront - 7.2, sc: 1.05, mode: 6, top: '#8f7bff', bottom: '#4b4561', hair: '#8a5a2b', skin: '#e5b594', name: 'bass' },
    { x: KX, z: KZ, sc: 1.05, mode: 8, top: '#ffd36b', bottom: '#4b4561', hair: '#2d2a3a', skin: '#f2c9a6', name: 'keys' },
    { x: 0, z: DZ - 0.2, sc: 1.05, mode: 7, top: '#ff9a7a', bottom: '#4b4561', hair: '#c0392b', skin: '#e5b594', name: 'drums', y: 0.5 },
    { x: -6.5, z: zFront - 4.2, sc: 1.0, mode: 9, top: '#ff9ccf', bottom: '#fff6e6', hair: '#f08cb4', skin: '#f2c9a6', name: 'dancer' },
    { x: 6.5, z: zFront - 4.2, sc: 1.0, mode: 9, top: '#9fd8ee', bottom: '#fff6e6', hair: '#5a7fd6', skin: '#e5b594', name: 'dancer' },
  ];
  const NP = PE.length;
  const tier = createTier(NP, true, true), PA = tier.A, performers = tier.mesh;   // 街の人と同じ人形 (crowdfigure.js。近い形)
  performers.frustumCulled = false; performers.name = 'park_live_performers';
  g.add(performers, tier.outline);
  const PSTYLE = PE.map((q) => (q.name === 'vocal' || q.name === 'dancer' ? STYLE.skirt | STYLE.shorts : q.name === 'drums' || q.name === 'keys' ? STYLE.sleeve : 0) | STYLE.whiteShoe);
  { const c = new THREE.Color(); PE.forEach((q, i) => { for (const k of ['top', 'bottom', 'hair', 'skin']) { c.set(q[k]); PA[k].setXYZ(i, c.r, c.g, c.b); } }); for (const k of ['top', 'bottom', 'hair', 'skin']) PA[k].needsUpdate = true; }
  let grow = 0;   // 出る・引っこむ (0 → 1。3 秒)
  const pm4 = new THREE.Matrix4();
  const updatePerformers = (nowSec, dt) => {
    const st = LS, target = st && (st.on || (st.phase === 'wait' && st.startsIn < 15)) ? 1 : 0;
    grow += clamp(target - grow, -dt / 3, dt / 3);
    perfProps.visible = grow > 0.02; performers.count = tier.outline.count = grow > 0.002 ? NP : 0;
    if (!performers.count) return;
    const song = st && st.phase === 'song' ? st.song : null, beat = song ? (song.energy >= 3 ? 2.3 : song.energy === 2 ? 1.9 : 1.5) : 1.2;
    const s2 = grow * grow * (3 - 2 * grow);
    PE.forEach((q, i) => {
      let x = q.x, z = q.z;
      if (q.name === 'vocal' && song) { x = Math.sin(nowSec * 0.22) * 9; z += Math.max(0, Math.sin(nowSec * 0.11 + 1.3)) * 6.5; }   // 歌う子はステージの上を歩き、ときどき花道へ出る
      const sc = q.sc * Math.max(0.001, s2);
      pm4.set(sc, 0, 0, x, 0, sc, 0, SH + (q.y || 0), 0, 0, sc, z, 0, 0, 0, 1);
      performers.setMatrixAt(i, pm4);
      const dancing = song && (q.name !== 'dancer' || song.energy >= 2);
      PA.anim.setXYZW(i, nowSec * Math.PI * 2 * beat + i * 0.7, dancing && q.name === 'dancer' ? 0.5 : song && (q.name === 'vocal') ? 0.25 : 0, dancing ? q.mode : 3, PSTYLE[i]);
    });
    performers.instanceMatrix.needsUpdate = true; PA.anim.needsUpdate = true;
  };
  api.setLive = (st) => { LS = st; };
  api.performers = performers;

  api.stats.tris = Math.round(tris);

  // ---------- 動き (カメラが近いときだけ) ----------
  const CYCLE = 24;   // 絵の切り替え 24 秒周期 (3 場面 × 8 秒)
  let lastScene = -1;
  let lastNow = null;
  api.update = (nowSec, cx, cz) => {
    if (Math.hypot(cx - L.x, cz - L.z) > 450) return;
    const real = performance.now() / 1000, dt = lastNow === null ? 0.016 : clamp(real - lastNow, 0, 0.1); lastNow = real;   // 出る・引っこむは実際の時間 (確認用に時計を止めても進む)
    updatePerformers(nowSec, dt);
    // 照明: 公演の最中 (と始まる直前) だけ光線が出る。大画面は公演の最中が明るい
    const lit = LS && (LS.on || (LS.phase === 'wait' && LS.startsIn < 20));
    for (const m of beamMats) m.userData.glow = lit ? 0.075 : 0;
    screenMat.userData.glow = LS && LS.on ? 1.05 : 0.55;
    const sc = Math.floor((nowSec % CYCLE) / (CYCLE / nScene)) % nScene;
    if (sc !== lastScene) { lastScene = sc; screenMat.map = sceneTex[sc]; screenMat.emissiveMap = sceneTex[sc]; }
    for (const b of beams) {
      const t = nowSec * 0.6 + b.k * 0.5;
      b.pivot.rotation.set(-(0.95 + 0.3 * Math.sin(t * 0.9) + (Math.sin(nowSec * 0.13 + b.k) > 0.8 ? 0.85 : 0)), b.base * 0.45 * Math.sin(t), 0, 'YXZ');
    }
  };
  api.update(Date.now() / 1000, L.x, L.z);
  return api;
}
