// 千葉ドリームランドの入口 (エントランス)。園の顔。設定は data/park.json の entrance → tools/park.py → public/data/park.json。寸法の計算は parkentrancegeo.js。
//   前庭 (駅の側。切符売り場・旗・案内) → 広間 (中央の大門 + 左右 16 レーンずつの改札の列 + 塔 + 端の小屋) → 内庭 (花の築山・案内所) の順に、駅から歩いて入る。
//   広間は幅 112 m。大門の開きは 16 m (団体・ベビーカー・車いす用)、改札は 32 レーン (ガラスの仕切りで歩いて通れる幅 1.4 m。切符を見せる柱は光るだけで、止められない)。
//   前庭の左右は壁 (wings) で囲む。広間の外側を回って、改札を通らずに内側へ入れない。壁は敷地の柵に届く。柵の隙間は前庭の幅 (fence.gapWidth) で、両端に門柱。
// 実在のパークの建物・ロゴ・紋章は写さない (テーマパークの入口に共通する要素だけ。形・色・模様はこのパークのオリジナル。大門の上の冠は「フィルムのリール」)。
// 局所座標は parkentrancegeo.js の説明どおり (u = 右、v = 外)。局所グループの y は、地面 (平ら) からの高さ。
import * as THREE from 'three';
import { canvasTexture } from './util.js';
import { LOGO_FONT } from './parkfont.js';
import { mergeStaticMeshes } from './mergestatic.js';
import { entranceFrame, entranceLayout, wingWalls, forecourtPolygon } from './parkentrancegeo.js';

const C = { cream: '#f6ecd9', creamD: '#ecdcc0', pink: '#f4a8cc', pinkL: '#f9d3e5', teal: '#3fb8b0', violet: '#8a6bd6', gold: '#e9c26a', white: '#fffaf0', lilac: '#e4d6f5', coral: '#ff9a7a', sky: '#7ad2f5', dark: '#4b4561' };
const FLAGS = ['#3fb8b0', '#8a6bd6', '#f08cb4', '#ff9a7a', '#e9c26a', '#7ad2f5'];

function seeded(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

export function buildEntrance({ cfg, ground, std, glowMat, group, col, emissive, low }) {
  const E = cfg.entrance, H = E.hall, B = E.booths, F = entranceFrame(cfg), LY = entranceLayout(cfg), WW = wingWalls(cfg);
  const gy = ground(F.gx, F.gz);
  const root = new THREE.Group(); root.name = 'park_entrance'; group.add(root);
  const loc = new THREE.Group(); loc.position.set(F.gx, gy, F.gz); loc.rotation.y = F.yaw; root.add(loc);
  const v0 = LY.v0, v1 = LY.v1, vc = H.v;
  const st = { tris: 0, meshes: 0 };
  const worldBox = (u, v, hu, hv, y0, y1) => { const [x, z] = F.W(u, v); col.box.push([x, z, F.yaw, hu, hv, gy + y0, gy + y1]); };
  const worldCircle = (u, v, r, y0, y1) => { const [x, z] = F.W(u, v); col.circle.push([x, z, r, gy + y0, gy + y1]); };
  for (const [u, v] of [[0, 0], [60, 20], [-60, 20], [0, 60], [-40, 50], [40, 70]]) { const [x, z] = F.W(u, v); if (Math.abs(ground(x, z) - gy) > 0.25) console.warn('[park] 入口の地面が平らでない', u, v, ground(x, z) - gy); }

  // ---------- 材質・模様 ----------
  const mat = (color, rough = 0.8) => std(color, rough);
  const gold = new THREE.MeshStandardMaterial({ color: '#f0c860', roughness: 0.3, metalness: 0.55, emissive: '#ffcf6a', emissiveIntensity: 0 }); gold.userData.glow = 0.45; emissive.push(gold);
  const warm = glowMat('#fff0c8', 1.3), pinkG = glowMat('#ff9ccf', 1.2), greenG = glowMat('#6dffc4', 1.2), cyanG = glowMat('#8fe8ff', 1.2);
  const glass = new THREE.MeshStandardMaterial({ color: '#cfeaff', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false });
  const lit = (map, em, glow, rough = 0.7, extra = {}) => { const m = new THREE.MeshStandardMaterial({ map, roughness: rough, emissive: '#ffffff', emissiveMap: em || map, emissiveIntensity: 0, ...extra }); m.userData.glow = glow; emissive.push(m); return m; };
  const tex = (w, h, draw, rep) => { const t = canvasTexture(w, h, draw); if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); } return t; };

  // 名前の板 (パークの名前は英語・ロゴの字体。下の小さい文字は日本語)
  const signTex = (text, sub, w = 2048, h = 448) => canvasTexture(w, h, (g) => {
    const grad = g.createLinearGradient(0, 0, w, 0); grad.addColorStop(0, '#ff7fb5'); grad.addColorStop(0.5, '#8f7bff'); grad.addColorStop(1, '#3fc8ff');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff6c9'; g.lineWidth = h / 30; g.strokeRect(h / 22, h / 22, w - h / 11, h - h / 11);
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = h / 110; g.strokeRect(h / 9, h / 9, w - h * 2 / 9, h - h * 2 / 9);
    g.fillStyle = '#ffe9a8'; for (let x = h * 0.2; x < w - h * 0.15; x += h * 0.2) { for (const y of [h * 0.07, h - h * 0.07]) { g.beginPath(); g.arc(x, y, h * 0.022, 0, Math.PI * 2); g.fill(); } }
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = 'rgba(60,20,110,0.6)'; g.shadowBlur = h / 28;
    g.font = `${h * (sub ? 0.5 : 0.56)}px ${LOGO_FONT}`; g.fillText(text, w / 2, h * (sub ? 0.44 : 0.52), w * 0.9);
    if (sub) { g.font = `600 ${h * 0.15}px sans-serif`; g.fillText(sub, w / 2, h * 0.8, w * 0.8); }
  });
  const smallSign = (text, bg) => canvasTexture(512, 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff6c9'; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = 'rgba(40,20,90,0.55)'; g.shadowBlur = 5; g.font = `700 ${h * 0.46}px "Park pop", "Fredoka", sans-serif`; g.fillText(text, w / 2, h / 2 + 3, w * 0.9);
  });
  // 窓の模様 (昼の色・夜の光る所)。cols × rows
  const facade = (cols, rows, base, w = 256, h = 256) => {
    const draw = (night) => (g) => {
      g.fillStyle = night ? '#000' : base; g.fillRect(0, 0, w, h);
      const cw = w / cols, ch = h / rows;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x = c * cw + cw * 0.2, y = r * ch + ch * 0.16, ww = cw * 0.6, hh = ch * 0.62;
        if (!night) { g.fillStyle = '#fffaf0'; g.fillRect(x - 5, y - 5, ww + 10, hh + 10); g.beginPath(); g.arc(x + ww / 2, y - 5, ww / 2 + 5, Math.PI, 0); g.fill(); }
        g.fillStyle = night ? '#ffd890' : '#6e86b8'; g.fillRect(x, y, ww, hh); g.beginPath(); g.arc(x + ww / 2, y, ww / 2, Math.PI, 0); g.fill();
        if (!night) { g.strokeStyle = '#fffaf0'; g.lineWidth = 3; g.beginPath(); g.moveTo(x + ww / 2, y - ww / 2); g.lineTo(x + ww / 2, y + hh); g.moveTo(x, y + hh * 0.45); g.lineTo(x + ww, y + hh * 0.45); g.stroke(); }
      }
    };
    return { map: tex(w, h, draw(false)), em: tex(w, h, draw(true)) };
  };
  const stripe = (a, b, n = 8) => tex(128, 32, (g, w, h) => { for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(i * w / n, 0, w / n + 1, h); } });
  const scallop = (a, b) => tex(256, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h); const n = 8, rw = w / n;
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.beginPath(); g.moveTo(i * rw, 0); g.lineTo((i + 1) * rw, 0); g.lineTo((i + 1) * rw, h * 0.55); g.arc(i * rw + rw / 2, h * 0.55, rw / 2, 0, Math.PI, false); g.closePath(); g.fill(); }
  });
  const std1 = (m) => { m.castShadow = true; return m; };

  // ---------- 小さな部品 ----------
  const addBox = (parent, w, h, d, x, y, z, m, shadow = true) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = shadow; parent.add(o); st.tris += 12; st.meshes++; return o; };
  const addCyl = (parent, r0, r1, h, x, y, z, m, seg = 20, shadow = true) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, seg).translate(0, h / 2, 0), m); o.position.set(x, y, z); o.castShadow = shadow; parent.add(o); st.tris += seg * 4; st.meshes++; return o; };
  const M4 = new THREE.Matrix4(), Pv = new THREE.Vector3(), Qq = new THREE.Quaternion(), Sv = new THREE.Vector3(), Yv = new THREE.Vector3(0, 1, 0), Cc = new THREE.Color();
  // 同じ形の繰り返し。items = [{ u, y, v, ry, sx, sy, sz, c }]。parent の局所座標
  const inst = (parent, geo, m, items, opt = {}) => {
    if (!items.length) return null;
    const o = new THREE.InstancedMesh(geo, m, items.length);
    items.forEach((p, i) => { o.setMatrixAt(i, M4.compose(Pv.set(p.u, p.y, p.v), Qq.setFromAxisAngle(Yv, p.ry || 0), Sv.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1))); if (p.c) o.setColorAt(i, Cc.set(p.c)); });
    if (o.instanceColor) o.instanceColor.needsUpdate = true;
    o.castShadow = !!opt.shadow; o.computeBoundingSphere(); parent.add(o);
    st.tris += (geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3) * items.length; st.meshes++;
    return o;
  };
  const extrude = (shape, depth, m, x, y, z, shadow = true) => { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: low ? 12 : 28 }); const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = shadow; loc.add(o); st.tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3; st.meshes++; return o; };
  const plane = (w, h, x, y, z, m, ry = 0, parent = loc, shadow = false) => { const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = shadow; parent.add(o); st.tris += 2; st.meshes++; return o; };

  const wallM = mat(C.cream, 0.88), wallD = mat(C.creamD, 0.88), trimM = mat(C.white, 0.7), pinkM = mat('#f2a9c9', 0.8), tealM = mat(C.teal, 0.7), violetM = mat(C.violet, 0.7);

  // ====================================================================================================================
  // 1. 広間 (hall): 中央の大門
  // ====================================================================================================================
  const PW = H.pylon, OP = H.open, ARCH_Y = 6, TOP = 22;   // 大門の半幅・開きの半幅・アーチの立ち上がり・屋根の高さ
  {
    const sh = new THREE.Shape(); sh.moveTo(-PW, 0); sh.lineTo(PW, 0); sh.lineTo(PW, TOP); sh.lineTo(-PW, TOP); sh.lineTo(-PW, 0);
    const hole = new THREE.Path(); hole.moveTo(-OP, 0); hole.lineTo(-OP, ARCH_Y); hole.absarc(0, ARCH_Y, OP, Math.PI, 0, true); hole.lineTo(OP, 0); hole.lineTo(-OP, 0);
    sh.holes.push(hole);
    extrude(sh, H.depth, wallM, 0, 0, v0);
    // アーチの飾り縁 (金。表と裏)
    const ring = new THREE.Shape(); const R0 = OP + 0.1, R1 = OP + 0.95;
    ring.moveTo(-R1, 0); ring.lineTo(-R1, ARCH_Y); ring.absarc(0, ARCH_Y, R1, Math.PI, 0, true); ring.lineTo(R1, 0); ring.lineTo(R0, 0); ring.lineTo(R0, ARCH_Y); ring.absarc(0, ARCH_Y, R0, 0, Math.PI, false); ring.lineTo(-R0, 0); ring.lineTo(-R1, 0);
    extrude(ring, 0.4, gold, 0, 0, v1 - 0.02, false); extrude(ring, 0.4, gold, 0, 0, v0 - 0.38, false);
    // 軒の段・パラペット
    addBox(loc, 2 * PW + 1.6, 0.55, H.depth + 1.4, 0, TOP, vc, trimM);
    addBox(loc, 2 * PW + 0.4, 0.45, H.depth + 0.5, 0, TOP + 0.55, vc, wallD);
    addBox(loc, 2 * PW + 0.4, 0.3, H.depth + 0.5, 0, TOP + 1.0, vc, trimM);
    // 柱形 (表と裏。端と開きのわき)
    for (const s of [-1, 1]) for (const [u, w] of [[s * (PW - 0.7), 1.3], [s * (OP + 1.9), 0.9]]) for (const [v, d] of [[v1 + 0.2, 0.5], [v0 - 0.2, 0.5]]) addBox(loc, w, TOP - 0.3, d, u, 0, v, trimM);
    // 柱の足元の台と柱頭
    for (const s of [-1, 1]) for (const v of [v1 + 0.2, v0 - 0.2]) { addBox(loc, 1.7, 0.7, 0.9, s * (PW - 0.7), 0, v, mat(C.gold, 0.5)); addBox(loc, 1.7, 0.5, 0.9, s * (PW - 0.7), TOP - 0.9, v, mat(C.gold, 0.5)); }
    // 名前の板 (表 = 駅の側)・歓迎の板 (裏 = 園の側)。夜は板が光る
    const t1 = signTex(cfg.roman || cfg.name, cfg.name), m1 = lit(t1, null, 0.85, 0.55);
    const sgn = new THREE.Mesh(new THREE.BoxGeometry(2 * OP + 8.6, 5.4, 0.5).translate(0, 2.7, 0), [trimM, trimM, trimM, trimM, m1, trimM]); sgn.position.set(0, ARCH_Y + OP + 1.7, v1 + 0.25); sgn.castShadow = true; loc.add(sgn); st.tris += 12; st.meshes++;
    const t2 = signTex('Welcome!', 'ようこそ ' + cfg.name + ' へ', 1536, 384), m2 = lit(t2, null, 0.85, 0.55);
    const sg2 = new THREE.Mesh(new THREE.BoxGeometry(2 * OP + 2, 4.6, 0.45).translate(0, 2.3, 0), [trimM, trimM, trimM, trimM, trimM, m2]); sg2.position.set(0, ARCH_Y + OP + 1.7, v0 - 0.22); sg2.castShadow = true; loc.add(sg2); st.tris += 12; st.meshes++;
    // 当たり判定: 大門の左右の柱 (開きの外側) と、アーチの上のまぐさ
    for (const s of [-1, 1]) worldBox(s * (OP + PW) / 2, vc, (PW - OP) / 2, H.depth / 2, -1, TOP + 1.3);
    worldBox(0, vc, OP, H.depth / 2, ARCH_Y + OP - 0.8, TOP + 1.3);
    // 冠: フィルムのリール (金の輪・6 つの穴・軸)。ゆっくり回る (update)
    const crown = new THREE.Group(); crown.position.set(0, TOP + 1.3 + 7.2, vc); loc.add(crown);
    addBox(loc, 9.4, 1.2, 4.6, 0, TOP + 1.3, vc, wallD); addBox(loc, 10.2, 0.4, 5.2, 0, TOP + 2.5, vc, mat(C.gold, 0.5));
    for (const s of [-1, 1]) addBox(loc, 0.5, 2.2, 0.5, s * 2.2, TOP + 2.9, vc, mat(C.gold, 0.4));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.42, 10, low ? 28 : 56), gold); crown.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.9, 20).rotateX(Math.PI / 2), gold); crown.add(hub);
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2 + Math.PI / 6, ho = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.2, 8, 20), gold); ho.position.set(Math.cos(a) * 2.75, Math.sin(a) * 2.75, 0); crown.add(ho);
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 4.2, 0.26).translate(0, 2.1, 0), gold); sp.rotation.z = a - Math.PI / 2 + Math.PI; sp.position.set(Math.cos(a) * 0.0, Math.sin(a) * 0.0, 0); sp.rotation.z = a - Math.PI / 2; crown.add(sp);
    }
    for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.6, 8), gold); f.position.set(s * PW * 0.9, TOP + 2.4, vc); loc.add(f); }
    st.tris += 700; st.meshes += 9;
    root.userData.crown = crown;
    // 大門の上の旗 (角の 4 本)
    for (const [u, v] of [[-PW + 0.8, v0 + 0.8], [PW - 0.8, v0 + 0.8], [-PW + 0.8, v1 - 0.8], [PW - 0.8, v1 - 0.8]]) { addCyl(loc, 0.07, 0.07, 7, u, TOP + 1.3, v, mat('#d6b25e', 0.4), 6, false); }
    const flagG = new THREE.PlaneGeometry(2.2, 1.2).translate(1.1, 0, 0);
    inst(loc, flagG, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, side: THREE.DoubleSide }), [[-PW + 0.8, v0 + 0.8, 0], [PW - 0.8, v0 + 0.8, 1], [-PW + 0.8, v1 - 0.8, 2], [PW - 0.8, v1 - 0.8, 3]].map(([u, v, k]) => ({ u, y: TOP + 7.9, v, ry: k % 2 ? Math.PI * 0.12 : -Math.PI * 0.12, c: FLAGS[(k + 1) % FLAGS.length] })));
  }

  // ====================================================================================================================
  // 2. 塔 2 本 (大門の左右。屋根は青緑と菫。窓は夜に光る)
  // ====================================================================================================================
  {
    const fc = facade(4, 3, C.cream), tm = lit(fc.map, fc.em, 0.9, 0.85);
    const upper = facade(4, 1, C.cream, 256, 128), um = lit(upper.map, upper.em, 0.9, 0.85);
    for (const s of [-1, 1]) {
      const g = new THREE.Group(); g.position.set(s * H.towerU, 0, vc); loc.add(g);
      const R = H.towerR, TH = H.towerH;
      addCyl(g, R + 0.35, R + 0.25, 1.0, 0, 0, 0, trimM, 28);
      addCyl(g, R, R, TH, 0, 1.0, 0, tm, 28);
      addCyl(g, R + 0.75, R + 0.6, 0.7, 0, 1.0 + TH, 0, mat(C.gold, 0.5), 28);          // 回廊のふち
      addCyl(g, R - 0.4, R - 0.4, 4.2, 0, 1.7 + TH, 0, um, 24);                         // 上の胴 (窓の帯)
      addCyl(g, R + 1.0, R + 0.3, 0.7, 0, 5.9 + TH, 0, trimM, 28);                      // 軒
      const roofH = 9.5, roof = new THREE.Mesh(new THREE.ConeGeometry(R + 1.15, roofH, low ? 16 : 28).translate(0, roofH / 2, 0), s < 0 ? tealM : violetM); roof.position.y = 6.6 + TH; roof.castShadow = true; g.add(roof); st.tris += 56; st.meshes++;
      for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + Math.PI / 4; addBox(g, 0.5, 0.35, 1.5, Math.cos(a) * (R + 0.4), 5.9 + TH, Math.sin(a) * (R + 0.4), mat(C.gold, 0.5), false).rotation.y = -a; }
      const fin = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), gold); fin.position.y = 6.6 + TH + roofH + 0.4; g.add(fin);
      addCyl(g, 0.06, 0.06, 4.4, 0, 6.6 + TH + roofH + 0.6, 0, mat(C.gold, 0.4), 6, false);
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.0).translate(1.0, 0, 0), new THREE.MeshStandardMaterial({ color: s < 0 ? '#f08cb4' : '#e9c26a', side: THREE.DoubleSide, roughness: 0.7 })); fl.position.y = 6.6 + TH + roofH + 4.0; fl.rotation.y = s < 0 ? Math.PI * 0.1 : -Math.PI * 0.1; g.add(fl);
      worldCircle(s * H.towerU, vc, R + 0.3, -1, 6.6 + TH + roofH);
      st.tris += 120;
    }
  }

  // ====================================================================================================================
  // 3. 改札の列 (左右 16 レーンずつ): 屋根 (縞) と縁飾り・ガラスの仕切り・読み取りの柱・レーンの番号・床の矢印・電球
  // ====================================================================================================================
  {
    const CY = H.canopyY, u0 = H.laneFrom - 0.6, u1 = H.laneFrom + H.lanes * H.pitch + 0.4, len = u1 - u0, ucen = (u0 + u1) / 2;
    const roofTex = stripe('#f4a8cc', '#fffaf0', Math.round(len / 1.5)), valP = scallop('#f4a8cc', '#fffaf0'), valT = scallop('#7ad8d0', '#fffaf0');
    const roofM = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.75 }), valM = new THREE.MeshStandardMaterial({ map: valP, roughness: 0.75, alphaTest: 0.5, side: THREE.DoubleSide });
    void valT;
    for (const s of [-1, 1]) {
      // 屋根 (少し前に張り出す)
      const rf = addBox(loc, len, 0.45, H.depth + 2.4, s * ucen, CY, vc, roofM); rf.castShadow = true;
      // 縁飾り (表側のふさ)
      const vm = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.95).translate(0, -0.47, 0), valM); vm.position.set(s * ucen, CY + 0.2, v1 + 1.2); loc.add(vm); st.tris += 2; st.meshes++;
      const vb = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.95).translate(0, -0.47, 0), valM); vb.position.set(s * ucen, CY + 0.2, v0 - 1.2); vb.rotation.y = Math.PI; loc.add(vb); st.tris += 2; st.meshes++;
      // 屋根の下の灯りの帯 (夜)
      for (const v of [vc - 3, vc + 3]) { const b = addBox(loc, len - 1, 0.08, 0.3, s * ucen, CY - 0.1, v, warm, false); void b; }
    }
    // 屋根を支える柱 (仕切りの線の上、4 レーンおき。前と後ろ)
    const posts = [];
    for (const s of [-1, 1]) for (let d = 0; d <= H.lanes; d += 4) for (const v of [v0 - 0.9, v1 + 0.9]) posts.push({ u: s * (H.laneFrom + d * H.pitch), y: 0, v });
    inst(loc, new THREE.CylinderGeometry(0.2, 0.24, CY, 10).translate(0, CY / 2, 0), mat('#f3e7ff', 0.5), posts, { shadow: true });
    for (const p of posts) worldCircle(p.u, p.v, 0.25, -1, CY);
    // 仕切り (台 = 読み取りの柱 + ガラス。レーンの境ごと) と、歩いて通れる幅
    const ped = [], glassL = [], reader = [];
    LY.dividers.forEach((u, i) => {
      ped.push({ u, y: 0, v: vc, c: i % 2 ? '#fffaf0' : '#e6d9f7' });
      glassL.push({ u, y: 1.05, v: vc }); reader.push({ u, y: 1.05, v: vc + 0.75 });
      worldBox(u, vc, 0.17, 1.3, -1, 2.0);
    });
    inst(loc, new THREE.BoxGeometry(0.34, 1.05, 2.6).translate(0, 0.525, 0), mat('#ffffff', 0.5), ped, { shadow: true });
    inst(loc, new THREE.BoxGeometry(0.05, 0.95, 2.6).translate(0, 0.475, 0), glass, glassL);
    inst(loc, new THREE.BoxGeometry(0.28, 0.1, 0.7).translate(0, 0.05, 0), greenG, reader);
    // レーンの番号の札 (屋根からつるす。表側) と、床の矢印 (園の内側へ)
    const atlas = tex(1024, 384, (g, w, h) => {
      for (let n = 0; n < 32; n++) {
        const c = n % 8, r = Math.floor(n / 8), x = c * 128, y = r * 96;
        g.fillStyle = (n % 2) ? '#3fb8b0' : '#f08cb4'; g.fillRect(x + 4, y + 4, 120, 88); g.strokeStyle = '#fff6c9'; g.lineWidth = 5; g.strokeRect(x + 6, y + 6, 116, 84);
        g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 62px "Park pop", "Fredoka", sans-serif'; g.fillText(String(n + 1), x + 64, y + 52);
      }
    });
    const pm = lit(atlas, null, 0.7, 0.6);
    const pos = [], uvs = [];
    LY.lanes.forEach((u, i) => {
      const n = (u < 0 ? 0 : 16) + (u < 0 ? (H.lanes - 1 - Math.round((-u - H.laneFrom - H.pitch / 2) / H.pitch)) : Math.round((u - H.laneFrom - H.pitch / 2) / H.pitch)), c = n % 8, r = Math.floor(n / 8), hw = 0.5, y0 = 3.05, y1 = 3.7, z = v1 + 0.75;
      const u0 = c / 8, u1 = (c + 1) / 8, vb = 1 - (r + 1) / 4, vt = 1 - r / 4;
      pos.push(u - hw, y0, z, u + hw, y0, z, u + hw, y1, z, u - hw, y0, z, u + hw, y1, z, u - hw, y1, z);
      uvs.push(u0, vb, u1, vb, u1, vt, u0, vb, u1, vt, u0, vt);
      void i;
    });
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); pg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); pg.computeVertexNormals();
    const pmesh = new THREE.Mesh(pg, pm); loc.add(pmesh); st.tris += 64; st.meshes++;
    const hang = []; LY.lanes.forEach((u) => { for (const d of [-0.34, 0.34]) hang.push({ u: u + d, y: CY - 1.2, v: v1 + 0.75 }); });
    inst(loc, new THREE.CylinderGeometry(0.015, 0.015, 1.2, 4).translate(0, 0.6, 0), mat('#c9b79a', 0.5), hang);
    const arrowTex = tex(128, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#58d9a4'; g.beginPath(); g.moveTo(w / 2, h * 0.92); g.lineTo(w * 0.86, h * 0.48); g.lineTo(w * 0.6, h * 0.48); g.lineTo(w * 0.6, h * 0.1); g.lineTo(w * 0.4, h * 0.1); g.lineTo(w * 0.4, h * 0.48); g.lineTo(w * 0.14, h * 0.48); g.closePath(); g.fill(); });
    const am = new THREE.MeshStandardMaterial({ map: arrowTex, transparent: true, alphaTest: 0.3, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -10 });
    inst(loc, new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2).translate(0, 0.32, 0), am, LY.lanes.map((u) => ({ u, y: 0, v: vc + 1.9 })));
    // 電球 (縁飾りの上と、屋根の端に沿って)
    if (!low) {
      const bulbs = [];
      for (const s of [-1, 1]) for (let u = u0 + 0.5; u < u1; u += 1.15) { bulbs.push({ u: s * u, y: CY + 0.5, v: v1 + 1.25 }); bulbs.push({ u: s * u, y: CY + 0.5, v: v0 - 1.25 }); }
      inst(loc, new THREE.SphereGeometry(0.11, 6, 4), warm, bulbs);
    }
  }

  // ====================================================================================================================
  // 4. 端の小屋 (左右の端。案内・救護) と、前庭を囲む壁
  // ====================================================================================================================
  {
    const px = H.half - 3, fc = facade(2, 2, C.cream, 256, 256), wm = lit(fc.map, fc.em, 0.9, 0.85);
    const label = [['FIRST AID', '#e65b7a'], ['GUEST RELATIONS', '#3fb8b0']];
    [-1, 1].forEach((s, i) => {
      const g = new THREE.Group(); g.position.set(s * px, 0, vc); loc.add(g);
      const body = new THREE.Mesh(new THREE.BoxGeometry(6, 9, H.depth).translate(0, 4.5, 0), [wallM, wallM, wallM, wallM, wm, wm]); body.castShadow = body.receiveShadow = true; g.add(body); st.tris += 12; st.meshes++;
      addBox(g, 6.9, 0.5, H.depth + 0.9, 0, 9, 0, trimM);
      const roofC = new THREE.Mesh(new THREE.ConeGeometry(4.9, 5.4, 4).rotateY(Math.PI / 4).translate(0, 2.7, 0), s < 0 ? violetM : tealM); roofC.position.y = 9.5; roofC.scale.z = (H.depth + 1.2) / 6.8; roofC.castShadow = true; g.add(roofC); st.tris += 8; st.meshes++;
      const fin = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), gold); fin.position.y = 15.2; g.add(fin);
      plane(4.6, 1.15, 0, 7.3, H.depth / 2 + 0.06, new THREE.MeshStandardMaterial({ map: smallSign(label[i][0], label[i][1]), roughness: 0.6 }), 0, g);
      worldBox(s * px, vc, 3, H.depth / 2, -1, 9.5);
    });
    // 前庭の左右の壁 (4 m の区画。柱と灯り・笠石)。広間の端から敷地の柵まで。壁の外側 (園の内側) へは前庭から入れない
    const panelTex = tex(256, 256, (g, w, h) => {
      g.fillStyle = '#f6e3ee'; g.fillRect(0, 0, w, h); g.fillStyle = '#f0c9dc'; g.fillRect(0, h * 0.78, w, h * 0.22); g.fillStyle = '#fffaf0'; g.fillRect(0, h * 0.74, w, h * 0.04);
      g.strokeStyle = '#e1b6cd'; g.lineWidth = 4; g.strokeRect(w * 0.12, h * 0.12, w * 0.76, h * 0.56); g.beginPath(); g.arc(w / 2, h * 0.4, w * 0.2, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#e9c26a'; g.beginPath(); g.arc(w / 2, h * 0.4, w * 0.06, 0, Math.PI * 2); g.fill();
    });
    const panelM = new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.9 }), wh = E.wings.height;
    const panels = [], coping = [], pillars = [], lamps = [];
    for (const [a, b] of [WW.left, WW.right]) {
      const L0 = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L0 / 4)), ang = Math.atan2(b[0] - a[0], b[1] - a[1]);
      const ln = [0.32, wh];
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, [lu, lv] = F.L(x, z);
        panels.push({ u: lu, y: 0, v: lv, ry: ang - F.yaw, sz: L0 / n / 4 }); coping.push({ u: lu, y: wh, v: lv, ry: ang - F.yaw, sz: L0 / n / 4 });
      }
      for (let k = 0; k <= n; k += 2) { const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, [lu, lv] = F.L(x, z); pillars.push({ u: lu, y: 0, v: lv }); lamps.push({ u: lu, y: wh + 1.0, v: lv }); }
      ln.push(a[0], a[1], gy, b[0], b[1], gy);
      col.line.push(ln);
    }
    inst(loc, new THREE.BoxGeometry(0.6, wh, 4).translate(0, wh / 2, 0), panelM, panels, { shadow: true });
    inst(loc, new THREE.BoxGeometry(0.9, 0.22, 4.04).translate(0, 0.11, 0), trimM, coping);
    inst(loc, new THREE.BoxGeometry(1.0, wh + 0.9, 1.0).translate(0, (wh + 0.9) / 2, 0), mat('#f3e7ff', 0.6), pillars, { shadow: true });
    inst(loc, new THREE.SphereGeometry(0.4, 12, 8), warm, lamps);
  }

  // ====================================================================================================================
  // 5. 切符売り場 (前庭の左右 8 窓ずつ) と、案内の行列の柵
  // ====================================================================================================================
  {
    const body = [], roof = [], win = [], ledge = [], sign = [];
    const cols = [C.pink, '#7ad8d0', '#d9c4f4', '#ffb89a'];
    LY.booths.forEach((b, i) => {
      body.push({ u: b.u, y: 0, v: b.v, c: cols[i % cols.length] });
      roof.push({ u: b.u, y: B.h, v: b.v });
      win.push({ u: b.u, y: 1.0, v: b.v + B.d / 2 + 0.02 });
      ledge.push({ u: b.u, y: 1.05, v: b.v + B.d / 2 + 0.3 });
      sign.push({ u: b.u, y: B.h + 0.25, v: b.v + 0.7 });
      worldBox(b.u, b.v, B.w / 2, B.d / 2, -1, B.h + 0.3);
    });
    inst(loc, new THREE.BoxGeometry(B.w, B.h, B.d).translate(0, B.h / 2, 0), mat('#ffffff', 0.8), body, { shadow: true });
    inst(loc, new THREE.BoxGeometry(B.w + 0.7, 0.28, B.d + 1.0).translate(0, 0.14, 0), new THREE.MeshStandardMaterial({ map: stripe('#f4a8cc', '#fffaf0', 6), roughness: 0.75 }), roof, { shadow: true });
    inst(loc, new THREE.PlaneGeometry(2.3, 1.1).translate(0, 0.55, 0), lit(tex(128, 64, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#fff6d8'); gr.addColorStop(1, '#ffd98a'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(w * 0.48, 0, 3, h); }), null, 0.8, 0.5), win);
    inst(loc, new THREE.BoxGeometry(2.5, 0.1, 0.55).translate(0, 0, 0), pinkM, ledge);
    const tk = lit(smallSign('TICKETS', '#8a6bd6'), null, 0.9, 0.6);
    inst(loc, new THREE.PlaneGeometry(2.4, 0.6).translate(0, 0.3, 0), tk, sign.map((p) => ({ ...p, v: p.v + B.d / 2 - 0.2 })));
    // 行列の柵 (見た目だけ。ロープ付きの細い柱。切符売り場の窓の前 6 m)
    const qp = [], qr = [];
    for (const s of [-1, 1]) {
      const ua = s * B.from, ub = s * (B.from + B.count * B.pitch);
      for (let u = Math.min(ua, ub); u <= Math.max(ua, ub) + 0.01; u += 2.4) qp.push({ u, y: 0, v: B.v + 6.2 });
      qr.push({ u: (ua + ub) / 2, y: 0.88, v: B.v + 6.2, sx: Math.abs(ub - ua) });
    }
    inst(loc, new THREE.CylinderGeometry(0.035, 0.05, 0.95, 6).translate(0, 0.475, 0), mat('#c9b79a', 0.4), qp);
    inst(loc, new THREE.SphereGeometry(0.06, 6, 4).translate(0, 0.98, 0), mat('#e9c26a', 0.4), qp);
    inst(loc, new THREE.BoxGeometry(1, 0.03, 0.03), mat('#e55f93', 0.7), qr);
  }

  // ====================================================================================================================
  // 6. 前庭の旗ざおと灯り (中央の通路の両側)、案内所 (内庭)、花の築山 (内庭の中央)
  // ====================================================================================================================
  {
    const bn = E.banners, masts = [], banners = [], globes = [];
    let k = 0;
    for (let v = bn.from; v <= bn.to + 0.01; v += bn.step) for (const s of [-1, 1]) {
      masts.push({ u: s * bn.u, y: 0, v }); banners.push({ u: s * bn.u, y: 3.3, v, ry: Math.PI / 2, c: FLAGS[k % FLAGS.length] }); globes.push({ u: s * bn.u, y: 7.3, v });
      worldCircle(s * bn.u, v, 0.26, -1, 7.5); k++;
    }
    inst(loc, new THREE.CylinderGeometry(0.1, 0.14, 7.2, 8).translate(0, 3.6, 0), mat(C.dark, 0.5), masts, { shadow: true });
    inst(loc, new THREE.PlaneGeometry(1.0, 3.2).translate(0.55, 1.6, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, side: THREE.DoubleSide }), banners.map((p) => ({ ...p, ry: p.u < 0 ? Math.PI / 2 : -Math.PI / 2 })));
    inst(loc, new THREE.SphereGeometry(0.42, 10, 8), pinkG, globes.filter((_, i) => i % 2 === 0));
    inst(loc, new THREE.SphereGeometry(0.42, 10, 8), cyanG, globes.filter((_, i) => i % 2 === 1));

    // 案内所 2 つ (内庭の左右)
    for (const K of E.kiosks) {
      const g = new THREE.Group(); g.position.set(K.u, 0, K.v); loc.add(g);
      addBox(g, K.w, K.h, K.d, 0, 0, 0, mat('#fffaf0', 0.8));
      const rf = addBox(g, K.w + 1.2, 0.3, K.d + 1.2, 0, K.h, 0, new THREE.MeshStandardMaterial({ map: stripe(K.color, '#fffaf0', 8), roughness: 0.75 })); void rf;
      const rc = new THREE.Mesh(new THREE.ConeGeometry(K.w * 0.62, 1.6, 4).rotateY(Math.PI / 4).translate(0, 0.8, 0), mat(K.color, 0.7)); rc.position.y = K.h + 0.3; rc.scale.z = (K.d + 1.2) / (K.w + 1.2); rc.castShadow = true; g.add(rc); st.tris += 8; st.meshes++;
      plane(K.w * 0.78, K.h * 0.5, 0, K.h * 0.28, K.d / 2 + 0.03, new THREE.MeshStandardMaterial({ color: '#cfe8ff', roughness: 0.1, emissive: '#ffe0a0', emissiveIntensity: 0 }), 0, g);
      const sm = lit(smallSign(K.text, K.color), null, 0.9, 0.6); plane(K.w * 0.8, K.w * 0.8 / 4, 0, K.h + 0.1, K.d / 2 + 0.62, sm, 0, g);
      worldBox(K.u, K.v, K.w / 2, K.d / 2, -1, K.h + 0.5);
    }

    // 花の築山: 縁石の輪 + 盛り土 + 花で描いたフィルムのリール (見た目だけ。上は歩けるが、縁石でふさがる高さ 1.1 m)
    const M = E.berm, bt = tex(1024, 512, (g, w, h) => {
      const r = seeded(17), cx = w / 2, cy = h / 2;
      g.fillStyle = '#4c9a58'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) { g.fillStyle = ['#3f8a4d', '#5aab63', '#6dbd6a', '#478f54'][Math.floor(r() * 4)]; g.beginPath(); g.arc(r() * w, r() * h, 3 + r() * 5, 0, Math.PI * 2); g.fill(); }
      const dabs = (rin, rout, cols, n, sz) => { for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, rr = rin + (rout - rin) * r(); g.fillStyle = cols[Math.floor(r() * cols.length)]; g.beginPath(); g.ellipse(cx + Math.cos(a) * rr * w / 2, cy + Math.sin(a) * rr * h / 2, sz * (0.7 + r() * 0.6), sz * 0.8 * (0.7 + r() * 0.6), 0, 0, Math.PI * 2); g.fill(); } };
      dabs(0.86, 0.97, ['#fffaf0', '#f8d7e6'], 480, 7);                      // ふち: 白とうす桃
      dabs(0.66, 0.8, ['#f08cb4', '#ff7fb5', '#ffb3d6'], 520, 7);            // 外の輪: 桃
      dabs(0.0, 0.1, ['#ffd45e', '#ffe58f'], 130, 8);                         // 軸: 黄
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + Math.PI / 6; for (let i = 0; i < 90; i++) { const a2 = r() * Math.PI * 2, rr = r() * 0.16; g.fillStyle = ['#8a6bd6', '#b9a3f0', '#fffaf0'][Math.floor(r() * 3)]; g.beginPath(); g.ellipse(cx + Math.cos(a) * 0.4 * w / 2 + Math.cos(a2) * rr * w / 2, cy + Math.sin(a) * 0.4 * h / 2 + Math.sin(a2) * rr * h / 2, 6, 5, 0, 0, Math.PI * 2); g.fill(); } }
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; for (let t = 0.12; t < 0.62; t += 0.014) { g.fillStyle = k % 2 ? '#ffd45e' : '#3fb8b0'; g.beginPath(); g.arc(cx + Math.cos(a) * t * w / 2, cy + Math.sin(a) * t * h / 2, 6, 0, Math.PI * 2); g.fill(); } }   // 6 本のスポーク
    });
    const cvv = 0, bu = 0, bv = M.v;
    // 盛り土
    const pos = [], uvs = [], R = 8, S = low ? 32 : 56;
    const at = (r, a) => [M.rx * r * Math.cos(a), 0.3 + M.h * (1 - r * r), M.rz * r * Math.sin(a), 0.5 + 0.5 * r * Math.cos(a), 0.5 + 0.5 * r * Math.sin(a)];
    for (let i = 0; i < R; i++) for (let k = 0; k < S; k++) {
      const a0 = k / S * Math.PI * 2, a1 = (k + 1) / S * Math.PI * 2, r0 = i / R, r1 = (i + 1) / R, p00 = at(r0, a0), p01 = at(r0, a1), p10 = at(r1, a0), p11 = at(r1, a1);
      for (const p of (i === 0 ? [p00, p11, p10] : [p00, p01, p11, p00, p11, p10])) { pos.push(p[0], p[1], p[2]); uvs.push(p[3], p[4]); }
    }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); dg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); dg.computeVertexNormals();
    const dome = new THREE.Mesh(dg, new THREE.MeshStandardMaterial({ map: bt, roughness: 0.95, side: THREE.DoubleSide })); dome.position.set(bu, 0, bv); dome.receiveShadow = true; loc.add(dome); st.tris += pos.length / 9; st.meshes++;
    // 縁石 (楕円の輪。高さ 0.55)
    const cs = new THREE.Shape(); cs.absellipse(0, 0, M.rx + 0.55, M.rz + 0.55, 0, Math.PI * 2, false, 0); const ch = new THREE.Path(); ch.absellipse(0, 0, M.rx - 0.02, M.rz - 0.02, 0, Math.PI * 2, true, 0); cs.holes.push(ch);
    const cg = new THREE.ExtrudeGeometry(cs, { depth: 0.55, bevelEnabled: false, curveSegments: 40 }).rotateX(-Math.PI / 2);
    const curb = new THREE.Mesh(cg, mat('#d9cfe0', 0.8)); curb.position.set(bu, 0, bv); curb.castShadow = curb.receiveShadow = true; loc.add(curb); st.tris += 400; st.meshes++;
    // 築山のまわりの丸く刈った木と鉢 (8 つ)
    const tp = [], tb = [];
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8; tp.push({ u: bu + Math.cos(a) * (M.rx + 1.5), y: 0, v: bv + Math.sin(a) * (M.rz + 1.5) }); tb.push({ u: bu + Math.cos(a) * (M.rx + 1.5), y: 0, v: bv + Math.sin(a) * (M.rz + 1.5), c: FLAGS[i % FLAGS.length] }); }
    inst(loc, new THREE.CylinderGeometry(0.42, 0.34, 0.6, 10).translate(0, 0.3, 0), mat('#e8d6f5', 0.8), tp);
    inst(loc, new THREE.SphereGeometry(0.62, 12, 8).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }), tb);
    // 当たり判定: 築山 (縁石 + 盛り土。楕円を 20 角形で)
    const ring = []; for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2, [x, z] = F.W(bu + (M.rx + 0.75) * Math.cos(a), bv + (M.rz + 0.75) * Math.sin(a)); ring.push([x, z]); }
    col.poly = col.poly || []; col.poly.push([ring, gy - 1, gy + 1.1]);
    void cvv;
  }

  // ====================================================================================================================
  // 7. 床 (前庭・広間の下・内庭) と、中央の絨毯
  // ====================================================================================================================
  {
    const ft = tex(512, 512, (g, w, h) => {
      const r = seeded(5); g.fillStyle = '#efe4d0'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = ['#f3e9d8', '#ebdfc9', '#f0e3d4', '#e9dcc6'][Math.floor(r() * 4)]; g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122); }
      g.strokeStyle = '#d3c5ac'; g.lineWidth = 4; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, h); g.moveTo(0, i * 128); g.lineTo(w, i * 128); g.stroke(); }
      g.fillStyle = '#f2c3da'; g.beginPath(); g.moveTo(256, 196); g.lineTo(316, 256); g.lineTo(256, 316); g.lineTo(196, 256); g.closePath(); g.fill();
      g.fillStyle = '#9fd8d2'; for (const [x, y] of [[0, 0], [512, 0], [0, 512], [512, 512]]) { g.beginPath(); g.moveTo(x, y - 40); g.lineTo(x + 40, y); g.lineTo(x, y + 40); g.lineTo(x - 40, y); g.closePath(); g.fill(); }
    }, [0.25, 0.25]);
    ft.anisotropy = 4;
    const fm = (t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
    const fl = (pts, m, y) => {   // pts = [[u, v], ...]
      const s = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, -v)));
      const g = new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
      const o = new THREE.Mesh(g, m); o.position.y = y; o.receiveShadow = true; loc.add(o); st.tris += g.index ? g.index.count / 3 : 0; st.meshes++; return o;
    };
    const fm1 = fm(ft);
    fl(forecourtPolygon(cfg), fm1, 0.22);
    fl([[-H.half, v0 - 0.3], [H.half, v0 - 0.3], [H.half, v1 + 0.3], [-H.half, v1 + 0.3]], fm1, 0.22);
    const iv = [[-H.half, v0], [H.half, v0], [H.half, -16], [-H.half, -16]];
    fl(iv, fm1, 0.23);
    // 絨毯 (大門の前から、駅の側へ)
    const ct = tex(256, 256, (g, w, h) => {
      g.fillStyle = '#e66f9d'; g.fillRect(0, 0, w, h); g.fillStyle = '#f08cb4'; g.fillRect(w * 0.1, 0, w * 0.8, h); g.fillStyle = '#e9c26a'; g.fillRect(w * 0.08, 0, w * 0.02, h); g.fillRect(w * 0.9, 0, w * 0.02, h);
      g.fillStyle = '#fff3c9'; for (const cy of [h * 0.25, h * 0.75]) { g.beginPath(); for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 - Math.PI / 2, r = k % 2 ? w * 0.07 : w * 0.17; g.lineTo(w / 2 + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); g.fill(); }
    });
    const carpetLen = 46;
    ct.wrapS = ct.wrapT = THREE.RepeatWrapping; ct.repeat.set(1, carpetLen / 16);
    const cp = new THREE.Mesh(new THREE.PlaneGeometry(16, carpetLen).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: ct, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -10 }));
    cp.position.set(0, 0.26, v1 + 0.3 + carpetLen / 2); cp.receiveShadow = true; loc.add(cp); st.tris += 2; st.meshes++;
  }

  // ====================================================================================================================
  // 8. 柵の隙間の門柱 (敷地の柵が途切れる所の両端。ワールド座標で置く)
  // ====================================================================================================================
  {
    const site = cfg.site, gp = cfg.fence.gaps[0], gw = cfg.fence.gapWidth;
    let bi = 0, bd = 1e9;
    for (let i = 0; i < site.length; i++) { const a = site[i], b = site[(i + 1) % site.length], ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez, t = Math.max(0, Math.min(1, ((gp[0] - a[0]) * ex + (gp[1] - a[1]) * ez) / l2)), d = Math.hypot(gp[0] - (a[0] + ex * t), gp[1] - (a[1] + ez * t)); if (d < bd) { bd = d; bi = i; } }
    const a = site[bi], b = site[(bi + 1) % site.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, yaw = Math.atan2(dx, dz), PY = E.pylons;
    // 柵の線に直角の向き (入口の内側へ向く側) に、少しだけ内へ
    const pyl = new THREE.Group(); root.add(pyl);
    for (const s of [-1, 1]) {
      const x = gp[0] + dx * s * (gw / 2 + PY.w / 2 + 0.2), z = gp[1] + dz * s * (gw / 2 + PY.w / 2 + 0.2), y = ground(x, z);
      const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = yaw; pyl.add(g);
      addBox(g, PY.w + 0.5, 0.7, PY.w + 0.5, 0, 0, 0, trimM);
      addBox(g, PY.w, PY.h, PY.w, 0, 0.7, 0, wallM);
      addBox(g, PY.w + 0.5, 0.45, PY.w + 0.5, 0, PY.h + 0.7, 0, trimM);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(PY.w * 0.78, 1.6, 4).rotateY(Math.PI / 4).translate(0, 0.8, 0), s < 0 ? tealM : violetM); cap.position.y = PY.h + 1.15; cap.castShadow = true; g.add(cap);
      const gl = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), s < 0 ? pinkG : cyanG); gl.position.y = PY.h + 3.1; g.add(gl);
      addCyl(g, 0.05, 0.05, 1.2, 0, PY.h + 2.7, 0, mat('#d6b25e', 0.4), 6, false);
      plane(PY.w * 0.7, PY.w * 0.7 / 4, 0, PY.h * 0.78, PY.w / 2 + 0.03, new THREE.MeshStandardMaterial({ map: smallSign('Welcome', s < 0 ? '#3fb8b0' : '#8a6bd6'), roughness: 0.6 }), 0, g);
      plane(PY.w * 0.7, PY.w * 0.7 / 4, 0, PY.h * 0.78, -PY.w / 2 - 0.03, new THREE.MeshStandardMaterial({ map: smallSign('Welcome', s < 0 ? '#3fb8b0' : '#8a6bd6'), roughness: 0.6 }), Math.PI, g);
      col.box.push([x, z, yaw, PY.w / 2, PY.w / 2, y - 1, y + PY.h + 1.3]);
      st.tris += 60;
    }
  }

  if (low) st.merged = mergeStaticMeshes(root, { skip: (o) => !o.visible });
  return {
    group: root, stats: st,
    // 冠のリールがゆっくり回る (近いときだけ)
    update(t, x, z) {
      const c = root.userData.crown; if (!c) return;
      if (Math.hypot(x - F.gx, z - F.gz) < 500) c.rotation.z = -t * 0.3;
    },
  };
}
