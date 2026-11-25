// フェアリー・リールパーク 段階 4: ショーと夜の光。設定は public/data/park.json の show (元は data/park.json)。
//   ・夜の光 (地面の光の輪・アベニューの縁・湖のふち) と、湖の水上ショー (噴水の光の柱 + しぶき)。光は time.js の win に合わせて夜だけ出る (昼は見えない)
//   ・花火: 時計 (Date.now) の cycle 秒ごとに、start 秒から duration 秒、湖の上で打ち上がる。Points 1 つ (粒は決まった式で動く = だれが見ても同じ形)。
//   ・パレード: ネオン・アベニューの入口 → プラザを半周 → 湖へ。山車 floats を gap m おきに進める。山車の上の光・踊り手・先頭の鼓笛隊 (InstancedMesh)。
// 動きはすべて時計の関数 (状態を持たない)。確認用: window.__showClock = () => 秒 で時計を差し替えられる (tools/dev/parkshot.js)。
// 当たり判定は付けない (動くので。人はすり抜ける。段階 5 で園内の人の動きと合わせる)。
import * as THREE from 'three';
import { canvasTexture } from './util.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const rngOf = (seed) => { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
export const showClock = () => (typeof window !== 'undefined' && window.__showClock ? window.__showClock() : Date.now() / 1000);

// ---- 花火の配色 (2 色の組。粒は c1 が 7 割・c2 が 3 割) ----
const PAL = [['#ff5f93', '#ffd36b'], ['#47c8ff', '#ffffff'], ['#ffd36b', '#ff9b4a'], ['#9c7bff', '#ff8fd6'], ['#6bff9c', '#fff6a8'], ['#ff8fbd', '#8fe8ff'], ['#ffffff', '#ffd36b']];
const TYPES = ['peony', 'ring', 'willow', 'heart', 'double'];
const NP = 120;   // 1 発の粒の数 (うち 6 つは打ち上げの尾)

// 花火の予定を、設定から決まった乱数で作る (時刻 t は show の開始からの秒)
export function planFireworks(F, lake) {
  const rng = rngOf(F.seed), out = [];
  const [lx, lz] = lake.center, add = (t, big) => {
    const [u, v] = F.launch[Math.floor(rng() * F.launch.length)];
    const [h0, h1] = F.height, h = h0 + (h1 - h0) * rng();
    out.push({ t, x: lx + u * lake.rx * 0.75 + (rng() - 0.5) * 16, z: lz + v * lake.rz * 0.7 + (rng() - 0.5) * 12, h: h * (big ? 1.08 : 1), type: TYPES[Math.floor(rng() * TYPES.length)], pal: Math.floor(rng() * PAL.length), size: big ? 1.35 : 0.9 + rng() * 0.3, rot: rng() * TAU, tilt: (rng() - 0.5) * 1.0, big });
  };
  let t = 3;
  while (t < F.duration * 0.72) { add(t, false); if (rng() < 0.4) add(t + 0.35, false); t += 2.3 + rng() * 1.6; }
  for (t = F.duration * 0.74; t < F.duration - 9; t += 0.5) add(t, t > F.duration - 14);
  // 最後の大きな 1 発 (金色の枝垂れ)
  out.push({ t: F.duration - 8, x: lx, z: lz, h: F.height[1] * 1.12, type: 'willow', pal: 2, size: 1.6, rot: 0, tilt: 0, big: true });
  return out;
}

// 粒の向き (単位ベクトル) の型。peony = 球、ring = 輪、heart = ハート (縦の面)、willow = 枝垂れ (球)
function dirsOf(type, n, rot, tilt, r) {
  const d = [];
  if (type === 'ring') {
    for (let k = 0; k < n; k++) { const a = k / n * TAU; const x = Math.cos(a), y = Math.sin(a) * 0.12, z = Math.sin(a); d.push([x * Math.cos(rot) + z * Math.sin(rot), y + z * Math.sin(tilt) * 0.5, -x * Math.sin(rot) + z * Math.cos(rot)]); }
  } else if (type === 'heart') {
    for (let k = 0; k < n; k++) { const a = k / n * TAU, x = 16 * Math.sin(a) ** 3, y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a); d.push([x / 17 * Math.cos(rot), (y + 3) / 17, -x / 17 * Math.sin(rot)]); }
  } else {
    for (let k = 0; k < n; k++) {   // フィボナッチの球
      const y = 1 - (k + 0.5) / n * 2, rr = Math.sqrt(Math.max(0, 1 - y * y)), a = k * 2.399963 + rot, jit = 0.9 + r() * 0.2;
      d.push([rr * Math.cos(a) * jit, y * jit, rr * Math.sin(a) * jit]);
    }
  }
  return d;
}

const spriteTex = () => canvasTexture(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.7)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});

import { paradeRoute, paradeSeconds } from './parkroute.js';
export { paradeRoute, paradeSeconds };

export function buildShow(ctx) {
  const { cfg, ground, std, glowMat, group, emissive, stripPos, flat } = ctx;
  const S = cfg.show;
  const api = { group: new THREE.Group(), stats: {}, update() {}, takeEvents: () => [], paradeLead: () => null, state: () => ({}) };
  if (!S) return api;
  api.group.name = 'park_show';
  group.add(api.group);
  const lakeE = cfg.ellipses['ムーンレイク'], lk = lakeE.lake, wy = cfg.ground.level + lk.water, plazaE = cfg.ellipses[S.parade.plaza];
  const ellPts = (c, rx, rz, n = 120) => { const o = []; for (let k = 0; k < n; k++) { const a = k / n * TAU; o.push([c[0] + rx * Math.cos(a), c[1] + rz * Math.sin(a)]); } return o; };
  const dummy = new THREE.Object3D(), col = new THREE.Color();

  // ================= 夜の光 (静かな光。常にあって、夜だけ見える) =================
  {
    const glowFlat = (pos, color, glow, lift) => {
      // 昼は見えない: emissive ではなく不透明度を夜の度合い (win) に結ぶ (time.js の opacityOnly)。白い地の材質だと昼に白い線が出る
      const m = flat(pos, '#ffffff', lift), mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -9 - lift * 10, polygonOffsetUnits: -9 - lift * 10 });
      mat.userData.glow = glow * 0.8; mat.userData.opacityOnly = true; emissive.push(mat);
      m.material = mat; m.receiveShadow = false; api.group.add(m); return m;
    };
    // プラザの舗装に埋めた光の輪 2 本 (舗装の白い線の上。ピンクと水色)
    glowFlat(stripPos(ellPts(plazaE.center, plazaE.rx * 0.58, plazaE.rz * 0.58, 96), 0.7, 0.34, true), '#ff9ccf', 1.0, 0.34);
    glowFlat(stripPos(ellPts(plazaE.center, plazaE.rx * 0.9, plazaE.rz * 0.9, 120), 0.7, 0.34, true), '#8fe8ff', 1.0, 0.34);
    // ネオン・アベニューの縁 (右はピンク、左は水色)
    const av = cfg.paths.find((p) => p.name === S.parade.avenue), pts = av.pts;
    const offs = (d) => pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [p[0] - (b[1] - a[1]) / L * d, p[1] + (b[0] - a[0]) / L * d]; });
    glowFlat(stripPos(offs(av.width / 2 - 0.45), 0.4, 0.34), '#ff9ccf', 1.2, 0.34);
    glowFlat(stripPos(offs(-(av.width / 2 - 0.45)), 0.4, 0.34), '#8fe8ff', 1.2, 0.34);
    // 湖の岸 (縁石の外側に、暖かい光の輪)
    glowFlat(stripPos(ellPts(lakeE.center, lakeE.rx + 1.3, lakeE.rz + 1.3, 160), 0.34, 0.45, true), '#ffe7b0', 0.9, 0.45);
  }

  // ================= 湖: 夜のきらめき + 水上ショー (噴水の光の柱・しぶき) =================
  const sheenTex = canvasTexture(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
  const sheen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: sheenTex, color: '#9fd8ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
  sheen.scale.set(lakeE.rx * 2.1, 1, lakeE.rz * 2.1); sheen.position.set(lakeE.center[0], wy + 0.06, lakeE.center[1]); sheen.renderOrder = 3; sheen.frustumCulled = false; api.group.add(sheen);
  const NJ = S.fountain?.jets || 0, jets = [];
  let jetMesh = null, drops = null;
  if (NJ) {
    const jg = new THREE.CylinderGeometry(0.2, 0.7, 1, 10, 1, true).translate(0, 0.5, 0);
    jetMesh = new THREE.InstancedMesh(jg, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), NJ);
    jetMesh.frustumCulled = false; jetMesh.renderOrder = 4;
    for (let k = 0; k < NJ; k++) { const u = (k / (NJ - 1)) * 2 - 1; jets.push({ x: lakeE.center[0] + u * lakeE.rx * 0.66, z: lakeE.center[1] + 14 + Math.cos(u * 2.2) * 10, ph: k * 0.7 }); }
    api.group.add(jetMesh);
    const ND = 22, dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(NJ * ND * 3), 3));
    dg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(NJ * ND * 3), 3));
    drops = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.9, map: spriteTex(), vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    drops.frustumCulled = false; drops.renderOrder = 4; drops.userData.ND = ND; api.group.add(drops);
  }

  // ================= 花火 =================
  const F = S.fireworks, plan = planFireworks(F, lakeE), RISE = 1.8, LIFE = { peony: 3.6, ring: 3.4, willow: 4.8, heart: 3.4, double: 4.0 };
  const MAXA = 16;
  const fwPos = new Float32Array(MAXA * NP * 3), fwCol = new Float32Array(MAXA * NP * 3);
  const fwGeo = new THREE.BufferGeometry();
  fwGeo.setAttribute('position', new THREE.BufferAttribute(fwPos, 3));
  fwGeo.setAttribute('color', new THREE.BufferAttribute(fwCol, 3));
  const fwMat = new THREE.PointsMaterial({ size: 7.5, map: spriteTex(), vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false });
  const fw = new THREE.Points(fwGeo, fwMat); fw.frustumCulled = false; fw.renderOrder = 5; fw.visible = false; api.group.add(fw);
  const palC = PAL.map((p) => p.map((c) => new THREE.Color(c)));
  const rr = rngOf(F.seed + 7);
  const dirCache = plan.map((b) => dirsOf(b.type === 'double' ? 'peony' : b.type, NP - 6, b.rot, b.tilt, rr));
  const inner = plan.map((b) => (b.type === 'double' ? dirsOf('peony', NP - 6, b.rot + 1, 0, rr) : null));
  const seedPh = plan.map(() => Array.from({ length: NP }, () => rr() * TAU));
  let lastFlash = [0, 0, 0], events = [], lastPhase = null;
  const groundY = (x, z) => ground(x, z);

  function fireworksUpdate(tIn, active, night) {
    if (!active) { fw.visible = false; return 0; }
    fw.visible = true;
    fwMat.opacity = clamp((night - 0.25) * 1.4, 0, 1);
    let slot = 0, flash = 0, fr = 0, fg = 0, fb = 0;
    for (let i = 0; i < plan.length && slot < MAXA; i++) {
      const b = plan[i], life = LIFE[b.type] * (b.big ? 1.1 : 1), age = tIn - b.t;
      if (age < 0 || age > RISE + life) continue;
      const o = slot * NP;
      const gy = groundY(b.x, b.z), apexY = gy + b.h, c = palC[b.pal];
      if (age < RISE) {   // 打ち上げ: 尾の 6 粒 (さきほど通った場所に遅れて光る)
        const e = (u) => 1 - (1 - clamp(u, 0, 1)) ** 2;
        for (let k = 0; k < NP; k++) {
          const q = (o + k) * 3;
          if (k < 6) { const u = e((age - k * 0.045) / RISE), y = gy + 4 + (apexY - gy - 4) * u, f = (1 - k / 6) * (age > k * 0.045 ? 1 : 0); fwPos[q] = b.x; fwPos[q + 1] = y; fwPos[q + 2] = b.z; fwCol[q] = 1.0 * f; fwCol[q + 1] = 0.8 * f; fwCol[q + 2] = 0.5 * f; }
          else { fwPos[q] = b.x; fwPos[q + 1] = -9999; fwPos[q + 2] = b.z; fwCol[q] = fwCol[q + 1] = fwCol[q + 2] = 0; }
        }
      } else {
        const tau = age - RISE, a = 1 - tau / life, v0 = (b.type === 'willow' ? 27 : b.type === 'ring' ? 36 : b.type === 'heart' ? 34 : 33) * b.size;
        const k = b.type === 'willow' ? 0.55 : 0.95, grav = b.type === 'willow' ? 10 : 5.5, dr = (1 - Math.exp(-k * tau)) / k;
        const fade = Math.pow(Math.max(0, a), b.type === 'willow' ? 0.8 : 1.3);
        const d = dirCache[i], d2 = inner[i];
        for (let m = 0; m < NP; m++) {
          const q = (o + m) * 3;
          if (m < 6) { fwPos[q + 1] = -9999; fwCol[q] = fwCol[q + 1] = fwCol[q + 2] = 0; continue; }
          const j = m - 6, dir = d2 && (j & 1) ? d2[j] : d[j], sp = d2 && (j & 1) ? 0.62 : 1;
          const spark = 0.65 + 0.35 * Math.sin(tau * 22 + seedPh[i][m]);   // ちらつき
          const cc = (b.type === 'willow') ? c[0] : (j % 10 < 3 ? c[1] : c[0]);
          fwPos[q] = b.x + dir[0] * v0 * sp * dr;
          fwPos[q + 1] = apexY + dir[1] * v0 * sp * dr - 0.5 * grav * tau * tau;
          fwPos[q + 2] = b.z + dir[2] * v0 * sp * dr;
          const w = fade * spark * (tau < 0.15 ? 2.0 : 1.5);
          fwCol[q] = cc.r * w; fwCol[q + 1] = cc.g * w; fwCol[q + 2] = cc.b * w;
        }
        const f = Math.exp(-tau * 1.6) * (b.big ? 1.3 : 1);
        if (f > flash) { flash = f; fr = c[0].r; fg = c[0].g; fb = c[0].b; }
      }
      slot++;
    }
    for (let k = slot * NP; k < MAXA * NP; k++) { fwPos[k * 3 + 1] = -9999; fwCol[k * 3] = fwCol[k * 3 + 1] = fwCol[k * 3 + 2] = 0; }
    fwGeo.attributes.position.needsUpdate = fwGeo.attributes.color.needsUpdate = true;
    lastFlash = [fr, fg, fb];
    return flash;
  }

  // ================= パレード =================
  const P = S.parade;
  const route = paradeRoute(cfg);
  const Lr = route.length - 1;
  const at = (s, o) => { s = clamp(s, 0, Lr - 1.001); const i = Math.floor(s), w = s - i, a = route[i], b = route[i + 1]; o.x = a[0] + (b[0] - a[0]) * w; o.z = a[1] + (b[1] - a[1]) * w; o.yaw = Math.atan2(b[0] - a[0], b[1] - a[1]); return o; };
  api.stats.routeLen = Lr;

  // ---- 山車 ----
  const palettes = { star: 1.0, moon: 0.9, heart: 1.0, rainbow: 1.0, rocket: 1.0, cloud: 0.8 };
  const floats = [];
  const gm = {};
  const gmat = (c, g = 1) => gm[c + g] || (gm[c + g] = glowMat(c, g));
  const starShape = (r0, r1, n = 5) => { const s = new THREE.Shape(); for (let k = 0; k < n * 2; k++) { const a = k / (n * 2) * TAU + Math.PI / 2, r = k % 2 ? r1 : r0; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (k) s.lineTo(x, y); else s.moveTo(x, y); } s.closePath(); return s; };
  const heartShape = (sc) => { const s = new THREE.Shape(); for (let k = 0; k <= 48; k++) { const a = k / 48 * TAU, x = 16 * Math.sin(a) ** 3, y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a); if (k) s.lineTo(x * sc, y * sc); else s.moveTo(x * sc, y * sc); } return s; };
  const moonShape = (R) => { const s = new THREE.Shape(); s.absarc(0, 0, R, 0.0, TAU, false); const h = new THREE.Path(); h.absarc(R * 0.45, R * 0.18, R * 0.82, 0, TAU, true); s.holes.push(h); return s; };
  const ext = (shape, depth) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 18 }).translate(0, 0, -depth / 2);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10).rotateZ(Math.PI / 2), bulbGeo = new THREE.SphereGeometry(0.15, 6, 4);
  for (let i = 0; i < P.floats.length; i++) {
    const F0 = P.floats[i], g = new THREE.Group(), spin = new THREE.Group();
    const A = F0.a, B = F0.b, baseM = std(A, 0.6), trimM = std(B, 0.5);
    const mesh = (geo, mat, x, y, z, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; g.add(m); return m; };
    mesh(new THREE.BoxGeometry(3.4, 0.8, 7.4), baseM, 0, 0.75, 0);
    mesh(new THREE.BoxGeometry(3.7, 0.2, 7.7), trimM, 0, 1.2, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(wheelGeo, std('#3a3550', 0.7), sx * 1.55, 0.42, sz * 2.5, false);
    const bulbs = new THREE.InstancedMesh(bulbGeo, gmat('#fff2b0', 1.5), 22);
    let n = 0; for (let k = 0; k < 6; k++) for (const sx of [-1, 1]) { dummy.position.set(sx * 1.78, 1.32, -3.5 + k * 1.4); dummy.updateMatrix(); bulbs.setMatrixAt(n++, dummy.matrix); }
    for (const sx of [-1.2, 0, 1.2]) for (const sz of [-1, 1]) { if (n >= 22) break; dummy.position.set(sx, 1.32, sz * 3.85); dummy.updateMatrix(); bulbs.setMatrixAt(n++, dummy.matrix); }
    bulbs.count = n; bulbs.frustumCulled = false; g.add(bulbs);
    g.add(spin); spin.position.set(0, 1.3, 0);
    const add = (geo, mat, x, y, z, rx = 0, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.castShadow = true; spin.add(m); return m; };
    let motion = null;
    if (F0.kind === 'star') {
      const st = new THREE.Group(); st.position.set(0, 4.6, 0); spin.add(st);
      const s1 = new THREE.Mesh(ext(starShape(2.5, 1.0), 0.7), gmat('#ffd36b', 1.3)); st.add(s1);
      add(new THREE.CylinderGeometry(0.16, 0.2, 3.6, 8), std('#e9e2f5', 0.5), 0, 1.8, 0);
      for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), gmat(k % 2 ? '#ff9ccf' : '#8fe8ff', 1.2)); m.position.set(Math.cos(a) * 3.0, 3.1 + Math.sin(a * 2) * 0.5, Math.sin(a) * 1.4); spin.add(m); }
      motion = (t) => { st.rotation.y = t * 1.4; };
    } else if (F0.kind === 'moon') {
      const mn = new THREE.Mesh(ext(moonShape(2.4), 0.6), gmat('#e6dcff', 1.2)); mn.position.set(0, 3.9, 0); mn.rotation.y = Math.PI / 2; spin.add(mn);
      add(new THREE.CylinderGeometry(0.16, 0.2, 2.6, 8), std('#e9e2f5', 0.5), 0, 1.3, 0);
      for (let k = 0; k < 5; k++) { const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), gmat(k % 2 ? '#ffd36b' : '#8fe8ff', 1.3)); m.position.set((k % 2 ? 1 : -1) * 1.0, 2.6 + (k / 5) * 3.2, -2.6 + k * 1.3); spin.add(m); }
      motion = (t) => { mn.rotation.z = Math.sin(t * 1.2) * 0.12; };
    } else if (F0.kind === 'heart') {
      const hs = new THREE.Mesh(ext(heartShape(0.15), 0.8), gmat('#ff8fbd', 1.2)); hs.position.set(0, 3.9, 0); spin.add(hs);
      add(new THREE.CylinderGeometry(0.16, 0.2, 2.8, 8), std('#e9e2f5', 0.5), 0, 1.4, 0);
      for (const [x, z, y] of [[0, -2.7, 2.6], [0, 2.7, 2.6]]) { const h2 = new THREE.Mesh(ext(heartShape(0.08), 0.5), gmat('#ffe0ee', 1.2)); h2.position.set(x, y, z); spin.add(h2); }
      motion = (t) => { const s = 1 + 0.07 * Math.sin(t * 5); hs.scale.set(s, s, 1); hs.rotation.y = Math.sin(t * 0.8) * 0.3; };
    } else if (F0.kind === 'rainbow') {
      const cols = ['#ff5f6f', '#ff9b4a', '#ffd36b', '#6bff9c', '#47c8ff'];
      cols.forEach((c, k) => { const m = new THREE.Mesh(new THREE.TorusGeometry(2.9 - k * 0.42, 0.18, 6, 28, Math.PI), gmat(c, 1.2)); m.rotation.y = Math.PI / 2; m.position.set(0, 1.2, 0); spin.add(m); });
      const cl = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), std('#ffffff', 0.9)); cl.position.set(0, 1.1, -3.0); spin.add(cl); const cl2 = cl.clone(); cl2.position.z = 3.0; spin.add(cl2);
    } else if (F0.kind === 'rocket') {
      const rk = new THREE.Group(); rk.position.set(0, 2.6, 0); rk.rotation.x = Math.PI / 2 - 0.45; spin.add(rk);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 4, 14), std('#fff7e8', 0.4)); body.position.y = 0; body.castShadow = true; rk.add(body);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.8, 14), std('#ff5f6f', 0.4)); nose.position.y = 2.9; rk.add(nose);
      for (let k = 0; k < 3; k++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 1.2), std('#ff5f6f', 0.5)); const a = k / 3 * TAU; fin.position.set(Math.cos(a) * 1.05, -1.6, Math.sin(a) * 1.05); fin.rotation.y = -a; rk.add(fin); }
      const win = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), gmat('#8fe8ff', 1.4)); win.position.set(0, 0.8, 0.85); rk.add(win);
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.2, 10), gmat('#ff9b4a', 1.8)); fl.position.y = -3.1; fl.rotation.x = Math.PI; rk.add(fl);
      motion = (t) => { fl.scale.set(1, 0.8 + 0.3 * Math.sin(t * 17), 1); rk.position.y = 2.6 + Math.sin(t * 2) * 0.12; };
    } else {   // cloud
      for (const [x, y, z, r] of [[0, 2.4, 0, 1.5], [0, 2.1, 1.6, 1.1], [0, 2.1, -1.6, 1.2], [0, 3.2, 0.5, 1.0], [0, 3.0, -0.9, 0.9]]) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), gmat('#eef4ff', 0.6)); m.position.set(x, y, z); m.castShadow = true; spin.add(m); }
      for (let k = 0; k < 7; k++) { const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), gmat(['#ffd36b', '#ff9ccf', '#8fe8ff'][k % 3], 1.3)); m.position.set(0, 1.6 + k * 0.5, -3 + k); spin.add(m); }
      motion = (t) => { spin.position.y = 1.3 + Math.sin(t * 1.5) * 0.1; };
    }
    g.visible = false; api.group.add(g);
    floats.push({ g, motion, kind: F0.kind });
  }

  // ---- 踊り手・鼓笛隊 (InstancedMesh 3 つ) ----
  const dancers = [];
  const addD = (fi, lat, back, hue) => dancers.push({ fi, lat, back, ph: dancers.length * 0.9, hue });
  floats.forEach((f, i) => { for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) addD(i, sx * (3.0 + (k % 2) * 0.5), -2.2 + k * 2.4, (i * 0.17 + k * 0.06 + (sx > 0 ? 0.5 : 0)) % 1); });
  for (let r = 0; r < 2; r++) for (let k = 0; k < 6; k++) addD(-1, (k - 2.5) * 1.1, 14 + r * 1.5, (0.55 + k * 0.05) % 1);   // 先頭の鼓笛隊 (6 人 × 2 列。山車 0 の 14 m 前)
  const ND = dancers.length;
  const bodyI = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.32, 1.05, 8).translate(0, 0.6, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }), ND);
  const headI = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 8, 6).translate(0, 1.5, 0), std('#f6d9c0', 0.7), ND);
  const hatI = new THREE.InstancedMesh(new THREE.ConeGeometry(0.2, 0.42, 8).translate(0, 1.9, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }), ND);
  const lampI = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 6, 4).translate(0, 2.15, 0), gmat('#fff2b0', 1.6), ND);
  dancers.forEach((d, k) => { bodyI.setColorAt(k, col.setHSL(d.hue, 0.7, 0.62)); hatI.setColorAt(k, col.setHSL((d.hue + 0.5) % 1, 0.75, 0.6)); });
  for (const im of [bodyI, headI, hatI, lampI]) { im.frustumCulled = false; im.castShadow = im !== lampI; im.visible = false; api.group.add(im); }

  const tmp = { x: 0, z: 0, yaw: 0 }, tm2 = { x: 0, z: 0, yaw: 0 };
  const total = () => (Lr + P.gap * (floats.length + 1)) / P.speed + 14;
  let parading = false, lead = null;
  function paradeUpdate(tIn, night) {
    const pt = tIn - P.start;
    parading = pt >= 0 && pt < total();
    lead = null;
    for (const f of floats) f.g.visible = false;
    for (const im of [bodyI, headI, hatI, lampI]) im.visible = parading;
    if (!parading) return;
    const sLead = pt * P.speed;   // 先頭の山車の道のり
    const vis = (s) => smooth((s + 4) / 8) * smooth((Lr + 4 - s) / 8);
    floats.forEach((f, i) => {
      const s = sLead - i * P.gap, k = vis(s);
      if (k <= 0.01) return;
      at(s, tmp); const gy = ground(tmp.x, tmp.z);
      f.g.visible = true; f.g.position.set(tmp.x, gy + 0.18, tmp.z); f.g.rotation.y = tmp.yaw; f.g.scale.setScalar(k);
      f.motion?.(pt);
      if (i === 0) lead = { x: tmp.x, z: tmp.z };
    });
    dancers.forEach((d, k) => {
      const s = d.fi >= 0 ? sLead - d.fi * P.gap + d.back : sLead + d.back, q = vis(s);
      if (q <= 0.01) { dummy.position.set(0, -9999, 0); dummy.scale.setScalar(0.001); dummy.rotation.set(0, 0, 0); }
      else {
        at(s, tm2); const bob = Math.abs(Math.sin(pt * 6.2 + d.ph)) * 0.22, sway = Math.sin(pt * 3.1 + d.ph) * 0.1;
        const x = tm2.x + Math.cos(tm2.yaw) * (d.lat + sway), z = tm2.z - Math.sin(tm2.yaw) * (d.lat + sway);
        dummy.position.set(x, ground(x, z) + 0.12 + bob, z); dummy.rotation.set(0, tm2.yaw + Math.sin(pt * 3.1 + d.ph) * 0.25, 0); dummy.scale.setScalar(q);
      }
      dummy.updateMatrix(); bodyI.setMatrixAt(k, dummy.matrix); headI.setMatrixAt(k, dummy.matrix); hatI.setMatrixAt(k, dummy.matrix); lampI.setMatrixAt(k, dummy.matrix);
    });
    bodyI.instanceMatrix.needsUpdate = headI.instanceMatrix.needsUpdate = hatI.instanceMatrix.needsUpdate = lampI.instanceMatrix.needsUpdate = true;
  }

  // ================= 毎コマ =================
  const jc = new THREE.Color();
  const nearLake = (x, z) => Math.hypot(x - lakeE.center[0], z - lakeE.center[1]) < 900;
  const nearPlaza = (x, z) => Math.hypot(x - plazaE.center[0], z - plazaE.center[1]) < 700;
  let state = { phase: 0, parade: false, fireworks: false };
  api.update = (nowSec, x, z, win) => {
    const cyc = S.cycle, phase = ((nowSec % cyc) + cyc) % cyc, night = clamp(win, 0, 1.3);
    const fwT = phase - F.start, fwActive = fwT >= 0 && fwT < F.duration + RISE + 6;
    state = { phase, parade: false, fireworks: fwActive };
    // 花火の音の知らせ (打ち上げ・爆発の時刻をまたいだ分)
    if (lastPhase !== null && Math.abs(phase - lastPhase) < 3 && fwActive) {
      const a = lastPhase - F.start, b = phase - F.start;
      for (const bu of plan) {
        if (a < bu.t && bu.t <= b) events.push({ kind: 'launch', x: bu.x, y: groundY(bu.x, bu.z), z: bu.z, big: bu.big });
        if (a < bu.t + RISE && bu.t + RISE <= b) events.push({ kind: 'burst', x: bu.x, y: groundY(bu.x, bu.z) + bu.h, z: bu.z, big: bu.big, type: bu.type, size: bu.size });
      }
    }
    lastPhase = phase;
    let flash = 0;
    if (nearLake(x, z) || nearPlaza(x, z)) {
      flash = fireworksUpdate(fwT, fwActive, night);
      // 湖: きらめき (夜は少し、花火の光が来ると強く)
      const sm = sheen.material;
      sm.color.setRGB(0.55 + lastFlash[0] * 0.5, 0.78 + lastFlash[1] * 0.2, 1.0).lerp(jc.setRGB(lastFlash[0], lastFlash[1], lastFlash[2]), clamp(flash, 0, 1) * 0.7);
      sm.opacity = clamp(night * 0.1 + flash * 0.5 * clamp(night, 0, 1), 0, 0.85);
      sheen.visible = sm.opacity > 0.004;
      // 噴水 (夜だけ。ショーの間は高く)
      if (jetMesh) {
        const show = fwActive || (phase - P.start >= 0 && phase - P.start < total());
        const t = nowSec, mat = jetMesh.material;
        mat.opacity = clamp((night - 0.25) * 0.55, 0, 0.5); jetMesh.visible = drops.visible = mat.opacity > 0.01;
        if (jetMesh.visible) {
          const pos = drops.geometry.attributes.position.array, cl = drops.geometry.attributes.color.array, ND2 = drops.userData.ND;
          jets.forEach((j, k) => {
            const beat = 0.5 + 0.5 * Math.sin(t * (show ? 4.2 : 1.7) + j.ph), h = (show ? 8 : 4) + (show ? 9 : 5) * beat * (0.7 + 0.3 * Math.sin(t * 0.37 + k));
            const hue = ((t * 0.07 + k / NJ) % 1);
            dummy.position.set(j.x, wy, j.z); dummy.scale.set(1 + h * 0.03, h, 1 + h * 0.03); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); jetMesh.setMatrixAt(k, dummy.matrix); jetMesh.setColorAt(k, jc.setHSL(hue, 0.85, 0.62));
            for (let m = 0; m < ND2; m++) {
              const u = ((t * 0.55 + m / ND2 * 1.0 + k * 0.13) % 1), ang = m * 2.399963 + k, rad = (1.5 + h * 0.5) * u, q = (k * ND2 + m) * 3;
              pos[q] = j.x + Math.cos(ang) * rad; pos[q + 1] = wy + h * (1 - (2 * u - 1) ** 2) * 0.95 + 0.4; pos[q + 2] = j.z + Math.sin(ang) * rad;
              const f2 = 1 - u * 0.6; jc.setHSL(hue, 0.5, 0.8); cl[q] = jc.r * f2; cl[q + 1] = jc.g * f2; cl[q + 2] = jc.b * f2;
            }
          });
          jetMesh.instanceMatrix.needsUpdate = true; if (jetMesh.instanceColor) jetMesh.instanceColor.needsUpdate = true;
          drops.geometry.attributes.position.needsUpdate = drops.geometry.attributes.color.needsUpdate = true;
          drops.material.opacity = clamp((night - 0.25) * 0.9, 0, 0.8);
        }
      }
    } else { fw.visible = false; sheen.visible = false; if (jetMesh) jetMesh.visible = drops.visible = false; }
    if (nearPlaza(x, z) || nearLake(x, z)) { paradeUpdate(phase, night); state.parade = parading; } else { parading = false; lead = null; for (const f of floats) f.g.visible = false; for (const im of [bodyI, headI, hatI, lampI]) im.visible = false; }
    // 山車の光: 拍に合わせて明るさが変わる (time.js が userData.glow を毎コマ読む)
    if (parading) { const b = 0.7 + 0.5 * Math.max(0, Math.sin(nowSec * 7.0)); for (const k in gm) gm[k].userData.glow = (gm[k].userData.baseGlow ??= gm[k].userData.glow) * b; }
    else for (const k in gm) if (gm[k].userData.baseGlow !== undefined) gm[k].userData.glow = gm[k].userData.baseGlow;
  };
  api.takeEvents = () => { const e = events; events = []; return e; };
  api.paradeLead = () => lead;
  api.state = () => state;
  api.plan = plan; api.route = route; api.floats = floats; api.cycle = S.cycle;
  api.stats = { routeLen: Lr, bursts: plan.length, floats: floats.length, dancers: ND, jets: NJ, paradeSeconds: Math.round(total()) };
  return api;
}
