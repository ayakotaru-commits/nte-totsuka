// 千葉ドリームランド: ライブ会場「サンライズ・ライブステージ」(コースターの跡地)。
// 位置・向き・大きさは tools/park_areas.py が決めた public/data/park.json の gen.rides.live (中心 x・z、yaw、幅 width、奥行き depth)。ここは読んで作るだけ。
// ローカル座標: x = 右、z = 前 (サンライズ・プラザの中心の向き)。奥 (-z) にステージ、手前 (+z) が客席。group.rotation.y = yaw。
// 描画の数を抑える: 動かない部品は Geo で材質ごとに 1 つにまとめる。動くのは大画面の絵の切り替え・ムービングライトの光線 (夜だけ見える)・照明の色だけ。
// 動き・光は実際の時計 (Date.now) で決まる (だれが見ても同じ)。カメラが会場の 450 m 以内のときだけ update が動かす。
import * as THREE from 'three';
import { canvasTexture } from './util.js';
import { fontCss } from './parkfont.js';
import { Geo } from './parkrides.js';

const TAU = Math.PI * 2;

export function buildLive(ctx) {
  const { cfg, ground, std, glowMat, group, col, emissive, low } = ctx;
  const L = cfg.gen && cfg.gen.rides && cfg.gen.rides.live;
  const api = { group: new THREE.Group(), stats: {}, update() {}, center: L ? { x: L.x, z: L.z } : null };
  api.group.name = 'park_live';
  group.add(api.group);
  if (!L) return api;

  const W = L.width, D = L.depth, gy = ground(L.x, L.z);
  const g = new THREE.Group(); g.position.set(L.x, gy, L.z); g.rotation.y = L.yaw; api.group.add(g);
  const worldOf = (lx, lz) => [L.x + lx * Math.cos(L.yaw) + lz * Math.sin(L.yaw), L.z - lx * Math.sin(L.yaw) + lz * Math.cos(L.yaw)];
  let tris = 0;
  const addMesh = (geo, mat, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; g.add(m); tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3; return m; };
  const flat = (w, d, x, z, y, mat) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat); m.position.set(x, y, z); m.receiveShadow = true; g.add(m); tris += 2; return m; };
  const box = (hx, hz, x, z, y0, y1) => col.box.push([...worldOf(x, z), L.yaw, hx, hz, gy + y0, gy + y1]);   // 当たり判定 (ローカル → ワールド)

  // ---------- 寸法 (ローカル。奥 = -D/2) ----------
  const SW = 46, SD = 22, SH = 2.2;            // ステージ: 幅・奥行き・高さ
  const zBack = -D / 2 + 1.5, zFront = zBack + SD;   // 奥の端・前の端
  const zMid = (zBack + zFront) / 2;
  const SCW = 32, SCH = 15, SCY = 5.6;         // 大画面: 幅・高さ・下端
  const TOP = 25;                              // 屋根のトラスの高さ

  // ---------- 材質 ----------
  const dark = std('#2b2640', 0.55), deckM = std('#3a3350', 0.5), steel = std('#8d93a3', 0.45), black = std('#1d1a2b', 0.6), rail = std('#c8ccd8', 0.4);
  const ledPink = glowMat('#ff9ccf', 1.5), ledCyan = glowMat('#8fe8ff', 1.5), ledGold = glowMat('#ffd36b', 1.6);

  // ---------- 客席の舗装 ----------
  {
    const tex = canvasTexture(512, 512, (c) => {
      c.fillStyle = '#d9d0e2'; c.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { c.fillStyle = (i + j) % 2 ? '#d3c9de' : '#e0d8e8'; c.fillRect(i * 32, j * 32, 32, 32); }
      c.strokeStyle = '#ffffff'; c.lineWidth = 4;
      for (const x of [170, 342]) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 512); c.stroke(); }     // ブロックの仕切り (A・B・C)
      c.beginPath(); c.moveTo(0, 256); c.lineTo(512, 256); c.stroke();
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(W / 16, D / 16);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    flat(W, D, 0, 0, 0.2, mat);
    // 客席の縁の石積み (低い縁取り)
    const edge = std('#f4e9d2', 0.7), eg = new Geo();
    eg.box(W + 1.2, 0.3, 0.6, 0, 0.15, -D / 2 - 0.3); eg.box(W + 1.2, 0.3, 0.6, 0, 0.15, D / 2 + 0.3); eg.box(0.6, 0.3, D, -W / 2 - 0.3, 0.15, 0); eg.box(0.6, 0.3, D, W / 2 + 0.3, 0.15, 0);
    addMesh(eg.geometry(), edge, false);
  }

  // ---------- ステージ ----------
  {
    const sg = new Geo();
    sg.box(SW, SH, SD, 0, SH / 2, zMid);                                   // 本体
    addMesh(sg.geometry(), deckM);
    const top = new Geo(); top.box(SW - 0.6, 0.06, SD - 0.6, 0, SH + 0.03, zMid);   // 床の板 (わずかに明るい)
    addMesh(top.geometry(), std('#4b4270', 0.35), false);
    // 前の縁の電飾 (3 色が帯で並ぶ) と、側面
    const lipP = new Geo(), lipC = new Geo(), lipG = new Geo();
    for (let i = 0; i < 23; i++) { const x = -SW / 2 + 1 + i * 2; (i % 3 === 0 ? lipP : i % 3 === 1 ? lipC : lipG).box(1.8, 0.5, 0.12, x, SH - 0.55, zFront + 0.07); }
    addMesh(lipP.geometry(), ledPink, false); addMesh(lipC.geometry(), ledCyan, false); addMesh(lipG.geometry(), ledGold, false);
    // 階段 (両わき)
    const st = new Geo();
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) st.box(1.9, SH * (k + 1) / 4, 1.0, s * (SW / 2 + 1.0 + 0.0), SH * (k + 1) / 8, zFront - 1.6 - k * 1.0);
    // (階段は側面の外に、前から奥へ上る形)
    addMesh(st.geometry(), std('#5b5380', 0.6));
    // 張り出し (花道): 前へ長い舞台 (客席の中へ 14 m)
    const hw = 6, hl = 14, ext = new Geo();
    ext.box(hw, SH - 0.1, hl, 0, (SH - 0.1) / 2, zFront + hl / 2);
    addMesh(ext.geometry(), deckM);
    const extTop = new Geo(); extTop.box(hw - 0.5, 0.06, hl - 0.5, 0, SH - 0.07, zFront + hl / 2);
    addMesh(extTop.geometry(), std('#4b4270', 0.35), false);
    const el = new Geo(); el.box(hw + 0.1, 0.4, 0.12, 0, SH - 0.5, zFront + hl + 0.06); el.box(0.12, 0.4, hl, -hw / 2 - 0.05, SH - 0.5, zFront + hl / 2); el.box(0.12, 0.4, hl, hw / 2 + 0.05, SH - 0.5, zFront + hl / 2);
    addMesh(el.geometry(), ledPink, false);
    box(SW / 2, SD / 2, 0, zMid, -1, SH);
    box(hw / 2, hl / 2, 0, zFront + hl / 2, -1, SH - 0.1);
  }

  // ---------- トラスの塔・屋根・照明バー ----------
  const trussAt = (geo, x0, y0, z0, x1, y1, z1, r) => {   // 2 点の間の細い円柱 (トラスの弦・斜材)
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), d = b.clone().sub(a), len = d.length();
    geo.add(new THREE.CylinderGeometry(r, r, len, 6), new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(1, 1, 1)));
  };
  const towerXs = [-SW / 2 - 1.5, SW / 2 + 1.5], towerZs = [zBack + 1.5, zFront - 1.5];
  {
    const tg = new Geo(), H = TOP, hs = 0.9;   // 塔は 1.8 m 角の箱トラス
    for (const x of towerXs) for (const z of towerZs) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) trussAt(tg, x + sx * hs, 0, z + sz * hs, x + sx * hs, H, z + sz * hs, 0.14);
      for (let y = 0; y < H; y += 3) {
        for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [-1, 1, 1, 1], [-1, -1, -1, 1], [1, -1, 1, 1]]) trussAt(tg, x + ax * hs, y, z + az * hs, x + bx * hs, y, z + bz * hs, 0.07);
        trussAt(tg, x - hs, y, z - hs, x + hs, y + 3, z - hs, 0.06); trussAt(tg, x - hs, y, z + hs, x + hs, y + 3, z + hs, 0.06);
      }
      col.circle.push([...worldOf(x, z), 1.5, gy - 1, gy + H]);
    }
    // 屋根のトラス (前・奥・横の梁) と、照明バー (前の梁の少し下)
    for (const z of towerZs) for (const dy of [0, -1.8]) trussAt(tg, towerXs[0], TOP + dy, z, towerXs[1], TOP + dy, z, 0.18);
    for (const x of towerXs) trussAt(tg, x, TOP, towerZs[0], x, TOP, towerZs[1], 0.18);
    // 梁の中の斜材 (前の梁)
    for (let x = towerXs[0]; x < towerXs[1] - 0.1; x += 3) trussAt(tg, x, TOP, towerZs[1], Math.min(x + 3, towerXs[1]), TOP - 1.8, towerZs[1], 0.07);
    const bar = towerZs[1] - 5;   // 照明バー (前から 5 m 奥。画面より前)
    for (const dy of [0, -1.2]) trussAt(tg, towerXs[0] + 3, TOP - 4.5 + dy, bar, towerXs[1] - 3, TOP - 4.5 + dy, bar, 0.14);
    for (const x of [towerXs[0] + 3, towerXs[1] - 3]) { trussAt(tg, x, TOP - 4.5, bar, x, TOP, bar, 0.1); }
    trussAt(tg, towerXs[0] + 3, TOP - 4.5, bar, towerXs[0] + 3, TOP - 4.5, towerZs[0], 0.1); trussAt(tg, towerXs[1] - 3, TOP - 4.5, bar, towerXs[1] - 3, TOP - 4.5, towerZs[0], 0.1);
    api.bar = { z: bar, y: TOP - 4.5 };
    addMesh(tg.geometry(), steel);
    // 屋根の布 (後ろ半分 = 画面の上に、わずかに傾けた板)
    const roof = new Geo(); roof.box(SW + 3, 0.14, SD - 2, 0, TOP + 0.4, zMid + 0.5);
    addMesh(roof.geometry(), std('#4a4466', 0.7));
    api.stats.tower = TOP;
  }

  // ---------- 大画面 (中央) と袖の画面 ----------
  const sceneTex = [];
  const mkScene = (i) => canvasTexture(1024, 480, (c, w, h) => {
    const grd = c.createLinearGradient(0, 0, 0, h);
    const pal = [['#2a1d6b', '#ff6fa0', '#ffc86b'], ['#08234a', '#2fb0c8', '#e5ff9a'], ['#3c1250', '#c850d6', '#ffe08a']][i];
    grd.addColorStop(0, pal[0]); grd.addColorStop(0.62, pal[1]); grd.addColorStop(1, pal[2]);
    c.fillStyle = grd; c.fillRect(0, 0, w, h);
    // 朝日 (半円) と光の筋
    const cx = w / 2, cy = h * 0.82;
    c.save(); c.globalAlpha = 0.22; c.fillStyle = '#ffffff';
    for (let k = 0; k < 18; k++) { const a0 = Math.PI + k / 18 * Math.PI, a1 = a0 + Math.PI / 36; c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, w, a0, a1); c.closePath(); c.fill(); }
    c.restore();
    c.fillStyle = '#fff3c4'; c.beginPath(); c.arc(cx, cy, 130, Math.PI, 0); c.fill();
    c.fillStyle = '#ffb36b'; c.beginPath(); c.arc(cx, cy, 96, Math.PI, 0); c.fill();
    c.fillStyle = 'rgba(30,20,60,0.55)'; c.fillRect(0, cy, w, h - cy);   // 水平線の下
    // 文字
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
    // 枠と、画面を支える (奥の) 骨組み
    const fr = new Geo();
    fr.box(SCW + 1.2, 0.6, 0.5, 0, SCY - 0.3, zs - 0.2); fr.box(SCW + 1.2, 0.6, 0.5, 0, SCY + SCH + 0.3, zs - 0.2); fr.box(0.6, SCH, 0.5, -SCW / 2 - 0.3, SCY + SCH / 2, zs - 0.2); fr.box(0.6, SCH, 0.5, SCW / 2 + 0.3, SCY + SCH / 2, zs - 0.2);
    fr.box(SCW, SCH, 0.4, 0, SCY + SCH / 2, zs - 0.4);   // 裏板 (表の板の後ろ)
    addMesh(fr.geometry(), black);
    // 袖の画面 (縦長。左右)
    for (const s of [-1, 1]) {
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(9, 15), screenMat); sm.position.set(s * (SW / 2 + 9.5), 4 + 7.5, zFront + 1.5); sm.rotation.y = -s * 0.28; g.add(sm); tris += 2;
      const fb = new Geo(); fb.box(9.8, 15.8, 0.5, 0, 0, -0.35);
      const fm = new THREE.Mesh(fb.geometry(), black); fm.position.copy(sm.position); fm.rotation.y = sm.rotation.y; fm.castShadow = true; g.add(fm); tris += 12;
      // 支柱
      const pl = new Geo(); pl.box(0.7, 4, 0.7, 0, 2, 0); const pm = new THREE.Mesh(pl.geometry(), steel); pm.position.set(sm.position.x, 0, sm.position.z - 0.2); g.add(pm);
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
      // 吊り (トラスから 6 台のラインアレイ)
      for (let k = 0; k < 6; k++) { sp.box(1.6, 1.2, 1.4, s * (SW / 2 - 4), TOP - 2 - k * 1.25, zFront - 2.5); grille.box(1.3, 1.0, 0.08, s * (SW / 2 - 4), TOP - 2 - k * 1.25, zFront - 1.75); }
    }
    // 足もとのモニター (前の縁に並ぶ楔型)
    for (let i = -3; i <= 3; i++) { sp.box(1.3, 0.55, 0.8, i * 5.5, SH + 0.28, zFront - 1.0); }
    addMesh(sp.geometry(), black); addMesh(grille.geometry(), dark, false);
  }

  // ---------- ムービングライト (照明バーに並ぶ。光線は夜だけ・動く) ----------
  const beamCols = ['#ff9ccf', '#8fe8ff', '#ffe08a'];
  const beamMats = beamCols.map((c, k) => { const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }); m.userData.glow = 0.075; m.userData.opacityOnly = true; emissive.push(m); return m; });
  const beams = [];
  {
    const nB = low ? 8 : 16, barZ = api.bar.z, y0 = api.bar.y;
    const fix = new Geo();
    const BL = 46, bgeo = new THREE.ConeGeometry(1.9, BL, 12, 1, true).translate(0, -BL / 2, 0);
    for (let i = 0; i < nB; i++) {
      const x = -SW / 2 + 4 + (SW - 8) * i / (nB - 1);
      fix.box(0.7, 0.8, 0.7, x, y0 - 0.5, barZ);
      const pivot = new THREE.Group(); pivot.position.set(x, y0 - 0.9, barZ); g.add(pivot);
      const m = new THREE.Mesh(bgeo, beamMats[i % 3]); m.renderOrder = 3; pivot.add(m);
      beams.push({ pivot, k: i, base: i % 2 ? 1 : -1 });
    }
    addMesh(fix.geometry(), black, false);
    // 前の梁の電飾 (小さな電球の列)
    const bulbG = new THREE.SphereGeometry(0.2, 6, 5), nb = Math.round(SW / 1.4);
    const bu = new THREE.InstancedMesh(bulbG, glowMat('#fff2b0', 1.8), nb * 2); const dm = new THREE.Object3D();
    for (let i = 0; i < nb; i++) for (let r = 0; r < 2; r++) { dm.position.set(towerXs[0] + (towerXs[1] - towerXs[0]) * i / (nb - 1), TOP - 0.9 - r * 0.9, towerZs[1] + 0.3); dm.updateMatrix(); bu.setMatrixAt(i * 2 + r, dm.matrix); }
    g.add(bu);
  }

  // ---------- 客席: 前の柵・ミキサー席・縁の街灯と電球の連なり・入口の門 ----------
  {
    // 前の柵 (花道の先から 5.5 m 手前。客席の幅いっぱい。柵とステージの間は撮影・警備のピット)
    const fz = zFront + 16, fenceHalf = SW / 2 + 12, fg = new Geo();
    fg.box(fenceHalf * 2, 0.1, 0.1, 0, 1.05, fz); fg.box(fenceHalf * 2, 0.1, 0.1, 0, 0.55, fz);
    for (let x = -fenceHalf; x <= fenceHalf + 0.01; x += 2) fg.box(0.1, 1.15, 0.1, x, 0.58, fz);
    addMesh(fg.geometry(), rail, false);
    box(fenceHalf, 0.2, 0, fz, -1, 1.15);
    // ミキサー席 (PA の天幕)
    const mz = zFront + 30, tg = new Geo(), tc = new Geo();
    tg.box(7.5, 1.0, 3.2, 0, 0.5, mz); for (const sx of [-1, 1]) for (const sz of [-1, 1]) tg.box(0.18, 3.4, 0.18, sx * 3.5, 1.7, mz + sz * 2.2);
    tc.box(8.6, 0.2, 5.6, 0, 3.5, mz);
    addMesh(tg.geometry(), dark); addMesh(tc.geometry(), std('#ff9ccf', 0.6));
    box(3.75, 1.6, 0, mz, -1, 1.1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) col.circle.push([...worldOf(sx * 3.5, mz + sz * 2.2), 0.2, gy - 1, gy + 3.5]);
    // 縁の街灯と電球の連なり (客席の左右。8 本ずつ)
    const poleG = new Geo(), n = 7, y = 6.4;
    const zs = []; for (let i = 0; i < n; i++) zs.push(-D / 2 + SD + 6 + (D - SD - 12) * i / (n - 1));
    const nBul = 9, bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 6, 5), glowMat('#ffd89a', 1.8), 2 * (n - 1) * nBul), dm = new THREE.Object3D();
    let bi = 0;
    for (const s of [-1, 1]) {
      const x = s * (W / 2 - 1.2);
      for (let i = 0; i < n; i++) {
        poleG.box(0.22, y, 0.22, x, y / 2, zs[i]); col.circle.push([...worldOf(x, zs[i]), 0.3, gy - 1, gy + y]);
        if (i < n - 1) for (let j = 0; j < nBul; j++) {
          const t = (j + 0.5) / nBul, sag = Math.sin(t * Math.PI) * 0.7;
          dm.position.set(x, y - 0.1 - sag, zs[i] + (zs[i + 1] - zs[i]) * t); dm.updateMatrix(); bulbs.setMatrixAt(bi++, dm.matrix);
        }
      }
    }
    addMesh(poleG.geometry(), std('#5a5170', 0.5)); g.add(bulbs);
    // 入口の門 (広場の側の端の両わきに柱 + 看板の梁)
    const az = D / 2 - 2, ag = new Geo();
    for (const s of [-1, 1]) ag.box(1.0, 7.5, 1.0, s * 6.5, 3.75, az); ag.box(14.5, 1.5, 0.5, 0, 7.2, az);
    addMesh(ag.geometry(), std('#f4e9d2', 0.6));
    for (const s of [-1, 1]) col.circle.push([...worldOf(s * 6.5, az), 0.7, gy - 1, gy + 7.5]);
    const signTex = canvasTexture(768, 128, (c, w, h) => {
      c.fillStyle = '#2b2640'; c.fillRect(0, 0, w, h); c.strokeStyle = '#ffd36b'; c.lineWidth = 6; c.strokeRect(8, 8, w - 16, h - 16);
      c.textAlign = 'center'; c.fillStyle = '#ffe08a'; c.font = fontCss('block', 62); c.fillText('SUNRISE LIVE STAGE', w / 2, 82);
    });
    const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.5 }); signMat.userData.glow = 0.9; emissive.push(signMat);
    for (const f of [1, -1]) { const sg = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.3), signMat); sg.position.set(0, 7.2, az + f * 0.28); if (f < 0) sg.rotation.y = Math.PI; g.add(sg); tris += 2; }
  }

  api.stats.tris = Math.round(tris);

  // ---------- 動き (カメラが近いときだけ) ----------
  const CYCLE = 24;   // 絵の切り替え 24 秒周期 (3 場面 × 8 秒)
  let lastScene = -1;
  api.update = (nowSec, cx, cz) => {
    if (Math.hypot(cx - L.x, cz - L.z) > 450) return;
    const sc = Math.floor((nowSec % CYCLE) / (CYCLE / nScene)) % nScene;
    if (sc !== lastScene) { lastScene = sc; screenMat.map = sceneTex[sc]; screenMat.emissiveMap = sceneTex[sc]; }
    for (const b of beams) {
      const t = nowSec * 0.6 + b.k * 0.5;
      // 前へ傾けて客席を照らし、左右にゆっくり振る (ときどき上へ向けて空を照らす)
      b.pivot.rotation.set(-(0.95 + 0.3 * Math.sin(t * 0.9) + (Math.sin(nowSec * 0.13 + b.k) > 0.8 ? 0.85 : 0)), b.base * 0.45 * Math.sin(t), 0, 'YXZ');
    }
  };
  api.update(Date.now() / 1000, L.x, L.z);
  return api;
}
