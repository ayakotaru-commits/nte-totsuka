// 千葉ドリームランド 段階 3: 乗り物。観覧車 (スイート・ヒルの台座の上。乗れる = parkride.js)・メリーゴーラウンド (回る)。(コースターは廃止して、跡地はライブ会場 = parklive.js)
// 位置・大きさは tools/park_areas.py が決めた public/data/park.json の gen.rides。ここは読んで作るだけ。
// 動きは実際の時計 (Date.now) で決まる (だれが見ても同じ形)。当たり判定は col (park.js が world.addColliders)。
// 描画の数を抑える: 観覧車 = 回る輪の数個 + 箱の InstancedMesh、メリーゴーラウンド = 馬と柱の InstancedMesh、
import { fontCss } from './parkfont.js';
import * as THREE from 'three';
import { canvasTexture } from './util.js';

const TAU = Math.PI * 2;
const wrapPi = (a) => { a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a; };

// 形をまとめる (位置・法線だけ)。変形つきの箱・円柱を足す
export class Geo {
  constructor() { this.p = []; this.n = []; }
  add(g0, m) {
    const g = g0.index ? g0.toNonIndexed() : g0.clone();
    g.applyMatrix4(m);
    this.p.push(...g.attributes.position.array); this.n.push(...g.attributes.normal.array);
    g.dispose();
    return this;
  }
  box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) { return this.add(new THREE.BoxGeometry(w, h, d), new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1))); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.computeBoundingSphere();
    return g;
  }
}

export function buildRides(ctx) {
  const { cfg, ground, std, glowMat, group, col, emissive } = ctx;
  const R = cfg.gen.rides;
  const api = { group: new THREE.Group(), stats: {}, ferris: null, carousel: null, anim: [], chase: [] };
  const chase = (mat, k, base) => { api.chase.push({ mat, k, base }); return mat; };   // 夜の光のチェイス: update が userData.glow を拍ごとに変える (time.js が毎コマ読む)
  api.group.name = 'park_rides';
  group.add(api.group);
  if (!R) return api;
  let tris = 0;
  const addMesh = (parent, geo, mat, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3; return m; };
  const dummy = new THREE.Object3D();
  const worldOf = (o, lx, lz) => [o.x + lx * Math.cos(o.yaw) + lz * Math.sin(o.yaw), o.z - lx * Math.sin(o.yaw) + lz * Math.cos(o.yaw)];   // ローカル (x 右・z 前) → ワールド (group.rotation.y = yaw)

  // ================= 観覧車 =================
  if (R.ferris) {
    const F = R.ferris, gy = ground(F.x, F.z), N = F.cars, Rr = F.R, hub = F.hub, ZR = 1.6;   // ZR = 輪 2 枚の間の半分
    const g = new THREE.Group(); g.position.set(F.x, gy, F.z); g.rotation.y = F.yaw; api.group.add(g);
    const HANG = 2.1;   // 輪の縁からゴンドラの中心までの下がり
    const frameMat = std('#f4efe6', 0.6), steel = std('#8f95a3', 0.5), rimMat = std('#ff8fbd', 0.5), spokeMat = std('#7fd6e8', 0.55);
    // A 型の脚 (2 面) と車軸
    const legs = new Geo();
    const leg = (x0, y0, z0, x1, y1, z1, r) => {
      const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), d = b.clone().sub(a), L = d.length();
      legs.add(new THREE.CylinderGeometry(r, r * 1.15, L, 8), new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(1, 1, 1)));
    };
    const BX = Rr * 0.6, ZF = 2.7;
    for (const z of [-ZF, ZF]) {
      for (const s of [-1, 1]) leg(s * BX, 0, z * 1.25, 0, hub, z, 0.42);
      leg(-BX * 0.72, hub * 0.34, z * 1.16, BX * 0.72, hub * 0.34, z * 1.16, 0.2);   // 横ばり
    }
    for (const s of [-1, 1]) leg(s * BX, 0.2, -ZF * 1.25, s * BX, 0.2, ZF * 1.25, 0.25);   // 足もとの梁
    leg(0, hub, -ZF - 0.6, 0, hub, ZF + 0.6, 0.55);   // 車軸
    addMesh(g, legs.geometry(), frameMat);
    for (const s of [-1, 1]) for (const z of [-ZF * 1.25, ZF * 1.25]) {
      const [wx, wz] = worldOf(F, s * BX, z);
      col.circle.push([wx, wz, 0.9, gy - 1, gy + 3]);
    }
    // 回る輪 (リム 2 枚・内側の輪・スポーク・ハブ・ライト)
    const wheel = new THREE.Group(); wheel.position.y = hub; g.add(wheel);
    const spokes = new Geo();
    for (const z of [-ZR, ZR]) {
      addMesh(wheel, new THREE.TorusGeometry(Rr, 0.24, 6, 60).translate(0, 0, z), rimMat, false);
      addMesh(wheel, new THREE.TorusGeometry(Rr * 0.52, 0.16, 6, 36).translate(0, 0, z), spokeMat, false);
      for (let k = 0; k < N; k++) { const a = k / N * TAU; spokes.box(0.16, Rr, 0.16, Math.sin(a) * Rr / 2, -Math.cos(a) * Rr / 2, z, 0, 0, a); }
    }
    for (let k = 0; k < N; k++) { const a = (k + 0.5) / N * TAU; for (const z of [-ZR, ZR]) spokes.box(0.1, Rr * 0.48, 0.1, Math.sin(a) * Rr * 0.26, -Math.cos(a) * Rr * 0.26, z, 0, 0, a); }
    addMesh(wheel, spokes.geometry(), spokeMat, false);
    addMesh(wheel, new THREE.CylinderGeometry(1.1, 1.1, ZR * 2 + 1.2, 16).rotateX(Math.PI / 2), steel, false);
    const bulbs = [glowMat('#ff9ccf', 1.4), glowMat('#8fe8ff', 1.4), glowMat('#fff2a8', 1.4)].map((m, k) => chase(m, k, 1.4));
    const NB = 36, bulbGeo = new THREE.SphereGeometry(0.2, 6, 4);
    bulbs.forEach((mat, m) => {
      const im = new THREE.InstancedMesh(bulbGeo, mat, NB * 2 / 3 | 0);
      let c = 0;
      for (let k = m; k < NB; k += 3) for (const z of [-ZR, ZR]) { if (c >= im.count) break; const a = k / NB * TAU; dummy.position.set(Math.sin(a) * Rr, -Math.cos(a) * Rr, z + Math.sign(z) * 0.2); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); im.setMatrixAt(c++, dummy.matrix); }
      im.count = c; im.computeBoundingSphere(); wheel.add(im);
    });
    // ゴンドラ (輪が回っても水平のまま。箱 = 床・低い壁・柱、屋根。InstancedMesh)
    const gf = new Geo();
    gf.box(2.1, 0.12, 2.0, 0, -1.0, 0);                                   // 床
    for (const s of [-1, 1]) { gf.box(0.1, 0.9, 2.0, s * 1.0, -0.5, 0); gf.box(2.1, 0.9, 0.1, 0, -0.5, s * 0.95); }   // 低い壁
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) gf.box(0.1, 2.0, 0.1, sx * 1.0, 0.0, sz * 0.95);   // 柱 (床から 2 m。頭がつかえない)
    gf.box(0.14, 0.45, 0.14, 0, 1.95, 0);                                 // つり棒 (屋根の上から輪の縁まで)
    const gfGeo = gf.geometry();
    const roofGeo = new THREE.ConeGeometry(1.75, 0.8, 4).rotateY(Math.PI / 4).translate(0, 1.4, 0);
    const bodyI = new THREE.InstancedMesh(gfGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 }), N);
    const roofI = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }), N);
    const cols = ['#ff8fbd', '#7fd6e8', '#ffd36b', '#b79bff', '#8fe3b5', '#ff9a6b'];
    for (let i = 0; i < N; i++) { bodyI.setColorAt(i, new THREE.Color(cols[i % cols.length])); roofI.setColorAt(i, new THREE.Color(cols[(i + 3) % cols.length]).multiplyScalar(0.8)); }
    for (const im of [bodyI, roofI]) { im.castShadow = true; im.frustumCulled = false; g.add(im); }
    tris += (gfGeo.attributes.position.count + roofGeo.index.count) / 3 * N;
    // のりばの券売所 (小さな箱)
    const kiosk = new THREE.Group(); kiosk.position.set(-6.0, 0, 6.2); g.add(kiosk);
    addMesh(kiosk, new THREE.BoxGeometry(3.0, 2.4, 2.2).translate(0, 1.2, 0), std('#ffe3f0', 0.7));
    addMesh(kiosk, new THREE.BoxGeometry(3.6, 0.25, 2.8).translate(0, 2.55, 0), std('#ff6fa8', 0.6));
    { const [kx, kz] = worldOf(F, -6.0, 6.2); col.box.push([kx, kz, F.yaw, 1.5, 1.1, gy - 1, gy + 2.6]); }
    // のりばの印 (地面に、ゴンドラの真下へ向かう道しるべ。ライトの色の輪)
    addMesh(g, new THREE.CylinderGeometry(1.7, 1.7, 0.05, 24).translate(0, 0.27, 4.2), std('#ffb3d9', 0.8), false);

    const [bx, bz] = worldOf(F, 0, 4.2), bottom = new THREE.Vector3(bx, gy, bz);
    api.ferris = {
      cfg: F, group: g, gy, N, R: Rr, hub, bottom,
      // 輪の角度 (実時計。1 周 rev 秒)
      theta(nowSec) { return (nowSec / F.rev * TAU) % TAU; },
      // i 番目のゴンドラの中心 (ワールド)。a = 底からの角度
      angle(i, th) { return th + i / N * TAU; },
      pos(i, th, out) {
        const a = th + i / N * TAU, lx = Math.sin(a) * Rr, ly = hub - Math.cos(a) * Rr - HANG;
        const [wx, wz] = worldOf(F, lx, 0);
        return out.set(wx, gy + ly, wz);
      },
      // 底にいちばん近いゴンドラ { i, a (底からの角度) }
      lowest(th) { let bi = 0, ba = 9; for (let i = 0; i < N; i++) { const a = wrapPi(th + i / N * TAU); if (Math.abs(a) < Math.abs(ba)) { ba = a; bi = i; } } return { i: bi, a: ba }; },
      // のりばの立ち位置 (ワールド) と、降りたときに向く向き
      spot: { x: bottom.x, z: bottom.z, y: gy, face: F.yaw },
      height: (th, i) => hub - Math.cos(th + i / N * TAU) * Rr - HANG - 0.94,   // ゴンドラの床の高さ (地面から)
    };
    api.anim.push((now, th) => {
      const a = api.ferris.theta(now);
      wheel.rotation.z = a;
      for (let i = 0; i < N; i++) {
        const ang = a + i / N * TAU;
        dummy.position.set(Math.sin(ang) * Rr, hub - Math.cos(ang) * Rr - HANG, 0); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
        bodyI.setMatrixAt(i, dummy.matrix); roofI.setMatrixAt(i, dummy.matrix);
      }
      bodyI.instanceMatrix.needsUpdate = roofI.instanceMatrix.needsUpdate = true;
    });
    api.anim[api.anim.length - 1](Date.now() / 1000);
  }

  // ================= メリーゴーラウンド =================
  if (R.carousel) {
    const Cc = R.carousel, gy = ground(Cc.x, Cc.z), Rc = Cc.R;
    const g = new THREE.Group(); g.position.set(Cc.x, gy, Cc.z); api.group.add(g);
    const baseH = 0.5, roofY = 6.6;
    addMesh(g, new THREE.CylinderGeometry(Rc, Rc + 0.15, baseH, 40).translate(0, baseH / 2, 0), std('#fff1d6', 0.7));
    addMesh(g, new THREE.CylinderGeometry(Rc + 0.25, Rc + 0.3, 0.22, 40).translate(0, 0.11, 0), std('#ff7fb5', 0.6), false);
    addMesh(g, new THREE.CylinderGeometry(1.35, 1.5, roofY, 20).translate(0, roofY / 2, 0), std('#ffe3f0', 0.6));
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; addMesh(g, new THREE.BoxGeometry(0.9, 3.4, 0.12).translate(0, 3.2, 1.52).rotateY(a), std(k % 2 ? '#7fd6e8' : '#ffd36b', 0.3), false); }   // 鏡の板
    // 屋根: ストライプの円すい (頂点の色)
    const seg = 24, cone = new THREE.ConeGeometry(Rc + 0.9, 3.0, seg, 1, true).translate(0, roofY + 1.5, 0), cc = [];
    const nonIdx = cone.toNonIndexed(), np = nonIdx.attributes.position;
    for (let t = 0; t < np.count; t += 3) {
      const ang = Math.atan2(np.getX(t) + np.getX(t + 1) + np.getX(t + 2), np.getZ(t) + np.getZ(t + 1) + np.getZ(t + 2));
      const k = Math.floor(((ang / TAU + 1) % 1) * seg) % 2, c = new THREE.Color(k ? '#ffffff' : '#ff6fa8');
      for (let v = 0; v < 3; v++) cc.push(c.r, c.g, c.b);
    }
    nonIdx.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    addMesh(g, nonIdx, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide }));
    addMesh(g, new THREE.CircleGeometry(Rc + 0.9, 32).rotateX(Math.PI / 2).translate(0, roofY, 0), std('#fff7e3', 0.8), false);
    addMesh(g, new THREE.TorusGeometry(Rc + 0.9, 0.22, 6, 40).rotateX(Math.PI / 2).translate(0, roofY, 0), std('#ffd36b', 0.4), false);
    addMesh(g, new THREE.SphereGeometry(0.5, 10, 8).translate(0, roofY + 3.2, 0), std('#ffd36b', 0.3), false);
    const bulb = chase(glowMat('#fff2b0', 1.5), 0, 1.5), bi = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 6, 4), bulb, 36);
    for (let k = 0; k < 36; k++) { const a = k / 36 * TAU; dummy.position.set(Math.cos(a) * (Rc + 0.9), roofY - 0.1, Math.sin(a) * (Rc + 0.9)); dummy.updateMatrix(); bi.setMatrixAt(k, dummy.matrix); }
    g.add(bi);
    // 回る部分: 馬と柱 (内側 6・外側 12)
    const spin = new THREE.Group(); spin.position.y = baseH; g.add(spin);
    const hg = new Geo();   // 馬 (前 = +z)
    hg.box(0.55, 0.62, 1.5, 0, 0, 0); hg.box(0.34, 0.78, 0.4, 0, 0.5, 0.7, 0.45, 0, 0); hg.box(0.3, 0.34, 0.66, 0, 0.98, 1.05, -0.2, 0, 0);
    hg.box(0.12, 0.55, 0.12, 0, -0.05, -0.85, 0.5, 0, 0); hg.box(0.62, 0.1, 0.6, 0, 0.36, 0.05);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) hg.box(0.14, 0.55, 0.14, sx * 0.2, -0.5, sz * 0.5);
    for (const sx of [-1, 1]) hg.box(0.08, 0.24, 0.14, sx * 0.12, 1.2, 0.95);   // 耳
    const horseGeo = hg.geometry();
    const rings = [[3.0, 6, 0], [5.7, 12, 0.5]];
    const total = rings.reduce((s, r) => s + r[1], 0);
    const horses = new THREE.InstancedMesh(horseGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }), total);
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, roofY - baseH - 0.1, 6).translate(0, (roofY - baseH - 0.1) / 2, 0), std('#e9c46a', 0.3), total);
    const hcols = ['#ffffff', '#ffd1e3', '#cfeefa', '#fff0b8', '#e4d6ff', '#d5f5e3'];
    const items = [];
    for (const [rr, n, ph] of rings) for (let k = 0; k < n; k++) items.push({ r: rr, a: (k + ph) / n * TAU, phase: k * 1.3 + rr });
    items.forEach((it, i) => {
      horses.setColorAt(i, new THREE.Color(hcols[i % hcols.length]));
      dummy.position.set(Math.cos(it.a) * it.r, 0, Math.sin(it.a) * it.r); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); poles.setMatrixAt(i, dummy.matrix);
    });
    for (const im of [horses, poles]) { im.castShadow = true; im.frustumCulled = false; spin.add(im); }
    tris += (horseGeo.attributes.position.count / 3 + 6 * 2) * total;
    const OMEGA = 0.5;
    api.carousel = { cfg: Cc, group: g, gy, omega: OMEGA };
    api.anim.push((now) => {
      spin.rotation.y = (now * OMEGA) % TAU;
      items.forEach((it, i) => {
        const y = 1.55 + 0.42 + Math.sin(now * 2.4 + it.phase) * 0.4;
        dummy.position.set(Math.cos(it.a) * it.r, y, Math.sin(it.a) * it.r);
        dummy.rotation.set(0, Math.PI - it.a, 0); dummy.updateMatrix();
        horses.setMatrixAt(i, dummy.matrix);
      });
      horses.instanceMatrix.needsUpdate = true;
    });
    api.anim[api.anim.length - 1](Date.now() / 1000);
    col.circle.push([Cc.x, Cc.z, Rc + 0.3, gy - 1, gy + 10]);
  }

  api.stats.tris = Math.round(tris);
  // 毎コマ: カメラが乗り物の 450 m 以内のときだけ動かす
  const centers = ['ferris', 'carousel'].map((k) => R[k]).filter(Boolean);
  api.update = (nowSec, cx, cz) => {
    if (!centers.some((c) => Math.hypot(cx - c.x, cz - c.z) < 450)) return;
    for (const f of api.anim) f(nowSec);
    for (const c of api.chase) c.mat.userData.glow = c.base * (0.25 + 1.0 * Math.max(0, Math.sin(nowSec * 4.2 - c.k * 2.094)));   // 3 色が順に明るくなって走る
  };
  return api;
}
