// 1. 路上の小物: 電柱・電線・街灯・横断歩道・停止線と「止まれ」・ガードパイプ・自販機・カーブミラー
import * as THREE from 'three';
import { Builder, hash, DRIVABLE, MAJOR, rank, intersections, canvasTexture, edge, carriage } from './util.js';
import { H, drape } from '../terrain.js';

const POLE_ROADS = new Set(['residential', 'unclassified', 'tertiary', 'living_street', 'secondary', 'service']);

export function buildProps({ city, world, cx, cz, R }) {
  const group = new THREE.Group();
  group.name = 'detail_props';
  const emissive = [];
  const inR = (x, z, m = 0) => (x - cx) ** 2 + (z - cz) ** 2 <= (R + m) ** 2;
  const roads = city.roads.filter(r => r.pts.some(p => inR(p[0], p[1], 40)));
  const nodes = intersections(roads).filter(n => inR(n.x, n.z));

  // 建物から r 以上離れているか
  const clear = (x, z, r) => {
    for (const b of world.query(x - r, z - r, x + r, z + r)) {
      if (world.contains(b, x, z) || world.closest(b, x, z).d < r) return false;
    }
    return true;
  };
  const nearBuilding = (x, z, r) => world.query(x - r, z - r, x + r, z + r).some(b => world.closest(b, x, z).d < r);
  const nearNode = (x, z, d) => nodes.some(n => (n.x - x) ** 2 + (n.z - z) ** 2 < d * d);

  // 敷地の門 (appearance.json) の前はガードパイプを置かない
  const gates = (city.sites || []).map(s => s.gate).filter(g => g && g.center);
  const atGate = (x, z) => gates.some(g => {
    const dx = x - g.center[0], dz = z - g.center[1];
    return Math.abs(-dx * g.axis[1] + dz * g.axis[0]) < g.passage / 2 + 1.0 && Math.abs(dx * g.axis[0] + dz * g.axis[1]) < g.length / 2 + 15;
  });

  // 折れ線に沿って一定間隔の点を返す
  function walk(pts, start, step, cb) {
    let s = 0, next = start;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      while (next <= s + len) {
        const t = (next - s) / len;
        cb(ax + dx * t, az + dz * t, dx / len, dz / len);
        next += step;
      }
      s += len;
    }
  }

  // ---------- 電柱・電線・街灯 ----------
  const poles = [];
  const chains = [];
  const tooClose = (x, z, d) => poles.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < d * d);
  for (const r of roads) {
    if (!POLE_ROADS.has(r.kind) || r.w < 4 || r.ys) continue;
    const rnd = hash('pole' + r.pts[0].join());
    const side = rnd() < 0.5 ? 1 : -1;
    const chain = [];
    walk(r.pts, 8 + rnd() * 10, 30, (x, z, dx, dz) => {
      const nx = -dz * side, nz = dx * side, off = r.sw ? edge(r, side) - r.sw + 0.6 : edge(r, side) + 0.5;
      const px = x + nx * off, pz = z + nz * off;
      if (!inR(px, pz) || !clear(px, pz, 0.5) || tooClose(px, pz, 9)) { if (chain.length) { chains.push(chain.splice(0)); } return; }
      const p = { x: px, z: pz, tx: -nx, tz: -nz, i: poles.length };
      poles.push(p); chain.push(p);
    });
    if (chain.length) chains.push(chain);
  }
  const poleMat = new THREE.MeshStandardMaterial({ color: '#aaa79f', roughness: 0.9 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#55585c', roughness: 0.7, metalness: 0.3 });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#f4f1e6', emissive: '#fff4d6', emissiveIntensity: 0 });
  emissive.push(lampMat);
  const poleGeo = new THREE.CylinderGeometry(0.15, 0.2, 10.5, 10).translate(0, 5.25, 0);
  const armGeo = new THREE.BoxGeometry(1.8, 0.1, 0.1).translate(0, 9.6, 0);
  const trGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.9, 10).translate(0.45, 7.9, 0);
  const lampArmGeo = new THREE.BoxGeometry(0.06, 0.06, 1.6).translate(0, 6.6, 0.8);
  const lampGeo = new THREE.BoxGeometry(0.22, 0.1, 0.5).translate(0, 6.55, 1.55);
  const inst = (geo, mat, list, name) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    m.count = list.length; m.name = name; m.castShadow = true; m.receiveShadow = true;
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    list.forEach((p, i) => { Q.setFromAxisAngle(Y, Math.atan2(p.tx, p.tz)); m.setMatrixAt(i, M.compose(P.set(p.x, H(p.x, p.z), p.z), Q, S)); });
    group.add(m);
  };
  inst(poleGeo, poleMat, poles, 'poles');
  inst(armGeo, darkMat, poles, 'pole_arms');
  inst(trGeo, darkMat, poles.filter(p => p.i % 3 === 1), 'transformers');
  const lamps = poles.filter(p => p.i % 2 === 0);
  inst(lampArmGeo, darkMat, lamps, 'lamp_arms');
  inst(lampGeo, lampMat, lamps, 'lamps');

  // 電線 (たるませる)
  const wp = [];
  const sag = (a, b, ya, yb, s) => {
    const N = 10;
    for (let k = 0; k < N; k++) {
      const t0 = k / N, t1 = (k + 1) / N;
      const P = (t) => [a[0] + (b[0] - a[0]) * t, ya + (yb - ya) * t - s * 4 * t * (1 - t), a[1] + (b[1] - a[1]) * t];
      wp.push(...P(t0), ...P(t1));
    }
  };
  for (const ch of chains) {
    for (let i = 0; i < ch.length - 1; i++) {
      const a = ch[i], b = ch[i + 1];
      if (Math.hypot(a.x - b.x, a.z - b.z) > 45) continue;
      for (const o of [-0.75, 0, 0.75]) {
        // 腕金は道路と直交 (tx,tz 方向)。腕金上のオフセット
        sag([a.x + a.tz * o, a.z - a.tx * o], [b.x + b.tz * o, b.z - b.tx * o], H(a.x, a.z) + 9.68, H(b.x, b.z) + 9.68, 0.35);
      }
      sag([a.x, a.z], [b.x, b.z], H(a.x, a.z) + 7.2, H(b.x, b.z) + 7.2, 0.5);   // 通信線
      sag([a.x, a.z], [b.x, b.z], H(a.x, a.z) + 6.9, H(b.x, b.z) + 6.9, 0.55);
    }
  }
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  const wires = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: '#1d1f22' }));
  wires.name = 'wires';
  group.add(wires);

  // ---------- 路面標示 ----------
  const paint = new Builder();
  const stopText = new Builder();
  for (const n of nodes) {
    const maxRank = Math.max(...n.arms.map(a => rank(a.road.kind)));
    const hasMajor = n.arms.some(a => MAJOR.has(a.road.kind));
    for (const a of n.arms) {
      const others = n.arms.filter(o => o !== a);
      const half = Math.max(...others.map(o => o.road.w / 2));
      const [dx, dz] = a.dir, nx = -dz, nz = dx;
      const cg = carriage(a.road), w = cg.w, c0 = a.fwd ? cg.c : -cg.c; // 腕の向きの左を正とした車道中心のずれ
      // 横断歩道: 幹線が絡む交差点の各方向
      if (hasMajor && w >= 5 && a.len > half + 6) {
        const d = half + 2.2, cnt = Math.floor((w - 1) / 0.9);
        for (let i = 0; i < cnt; i++) {
          const t = (i - (cnt - 1) / 2) * 0.9;
          paint.flatRect(n.x + dx * d + nx * (t + c0), n.z + dz * d + nz * (t + c0), [dx, dz], 3.0, 0.45, 0.125);
        }
      }
      // 停止線 + 止まれ: 格下の道路側
      if (rank(a.road.kind) < maxRank && DRIVABLE.has(a.road.kind) && a.len > half + 9) {
        const d = half + (hasMajor ? 4.2 : 1.2);
        paint.flatRect(n.x + dx * d + nx * c0, n.z + dz * d + nz * c0, [nx, nz], w * 0.9, 0.35, 0.125);
        if (w >= 4) {
          // 文字の上が交差点側。左側通行なので、交差点へ向かう進行方向 (-dir) の左車線に置く
          const dt = d + 3.4, lane = w / 4;
          const left = [-dz, dx];
          const ox = n.x + dx * dt + left[0] * (c0 + lane), oz = n.z + dz * dt + left[1] * (c0 + lane);
          stopText.flatRect(ox, oz, [-dx, -dz], 4.0, Math.min(2.4, w * 0.45), 0.126, [[0, 0], [0, 1], [1, 1], [1, 0]]);
        }
      }
    }
  }
  const paintMat = new THREE.MeshStandardMaterial({ color: '#ecebe4', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
  const paintMesh = new THREE.Mesh(drape(paint.geometry(), 1.5), paintMat);
  paintMesh.receiveShadow = true; paintMesh.name = 'road_paint';
  const tomareTex = canvasTexture(256, 512, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#ecebe4';
    g.font = 'bold 200px "Yu Gothic UI", "Meiryo", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(W / 2, H / 2); g.scale(0.42, 2.2); g.fillText('止まれ', 0, 0); g.restore();
  });
  const tomare = new THREE.Mesh(drape(stopText.geometry(), 1.5), new THREE.MeshStandardMaterial({ map: tomareTex, transparent: true, alphaTest: 0.3, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
  tomare.receiveShadow = true; tomare.name = 'tomare';
  group.add(paintMesh, tomare);

  // ---------- ガードパイプ (幹線の歩道側) ----------
  const posts = [], pipes = [];
  for (const r of roads) {
    if (!MAJOR.has(r.kind) || r.ys) continue;
    for (const side of [1, -1]) {
      let prev = null;
      walk(r.pts, 1, 2, (x, z, dx, dz) => {
        const go = r.sw ? edge(r, side) - r.sw + 0.2 : edge(r, side) + 0.2;
        const px = x - dz * side * go, pz = z + dx * side * go;
        const ok = inR(px, pz) && !nearNode(x, z, r.w / 2 + 9) && clear(px, pz, 0.3) && !atGate(px, pz);
        if (!ok) { prev = null; return; }
        const p = { x: px, z: pz, tx: dx, tz: dz };
        posts.push(p);
        if (prev && Math.hypot(prev.x - px, prev.z - pz) < 2.6) pipes.push({ x: (prev.x + px) / 2, z: (prev.z + pz) / 2, tx: px - prev.x, tz: pz - prev.z, len: Math.hypot(prev.x - px, prev.z - pz) });
        prev = p;
      });
    }
  }
  const white = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.5, metalness: 0.2 });
  inst(new THREE.CylinderGeometry(0.04, 0.04, 0.85, 6).translate(0, 0.425, 0), white, posts, 'guard_posts');
  for (const y of [0.45, 0.8]) {
    const m = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6).rotateX(Math.PI / 2).translate(0, y, 0), white, Math.max(1, pipes.length));
    m.count = pipes.length; m.castShadow = true; m.name = 'guard_pipes';
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    pipes.forEach((p, i) => { Q.setFromAxisAngle(Y, Math.atan2(p.tx, p.tz)); m.setMatrixAt(i, M.compose(P.set(p.x, H(p.x, p.z), p.z), Q, S.set(1, 1, p.len))); });
    group.add(m);
  }

  // ---------- 自販機 ----------
  const vendTex = canvasTexture(256, 512, (g, W, H) => {
    g.fillStyle = '#f5f5f2'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#dfe9ef'; g.fillRect(14, 20, W - 28, 300);
    const cols = ['#d23a2a', '#2a7bd2', '#f2b632', '#3aa55a', '#8a5a3a', '#e0e0e0', '#1f2a55'];
    for (let row = 0; row < 4; row++) for (let c = 0; c < 7; c++) {
      g.fillStyle = cols[(row * 3 + c) % cols.length];
      g.fillRect(24 + c * 31, 32 + row * 72, 20, 46);
      g.fillStyle = '#333'; g.fillRect(24 + c * 31, 82 + row * 72, 20, 6);
    }
    g.fillStyle = '#2a2d33'; g.fillRect(14, 340, W - 28, 60);
    g.fillStyle = '#16181c'; g.fillRect(60, 430, 140, 50);
  });
  const vendFront = new THREE.MeshStandardMaterial({ map: vendTex, emissiveMap: vendTex, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.4 });
  emissive.push(vendFront);
  const vendGeo = new THREE.BoxGeometry(1.0, 1.83, 0.75).translate(0, 0.915, 0);
  const bodies = ['#c8312a', '#1f5fae', '#f0f0ee'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
  let vendCount = 0;
  for (const r of roads) {
    if (!['residential', 'unclassified', 'tertiary', 'living_street'].includes(r.kind) || vendCount >= 60 || r.ys) continue;
    const rnd = hash('vend' + r.pts[0].join());
    walk(r.pts, 15 + rnd() * 30, 80, (x, z, dx, dz) => {
      if (vendCount >= 60) return;
      const side = rnd() < 0.5 ? 1 : -1, nx = -dz * side, nz = dx * side;
      for (const off of [edge(r, side) + 0.6, edge(r, side) + 1.2]) {
        const px = x + nx * off, pz = z + nz * off;
        if (!inR(px, pz) || !clear(px, pz, 0.6) || !nearBuilding(px, pz, 2.5) || tooClose(px, pz, 2)) continue;
        const body = bodies[Math.floor(rnd() * bodies.length)];
        const m = new THREE.Mesh(vendGeo, [body, body, body, body, vendFront, body]);
        m.position.set(px, H(px, pz), pz);
        m.rotation.y = Math.atan2(-nx, -nz); // 正面 (+Z) を道路側へ
        m.castShadow = m.receiveShadow = true;
        group.add(m);
        vendCount++;
        break;
      }
    });
  }

  // ---------- カーブミラー (生活道路どうしの交差点) ----------
  const orange = new THREE.MeshStandardMaterial({ color: '#e8742a', roughness: 0.6 });
  const mirrorMat = new THREE.MeshStandardMaterial({ color: '#cfd8e0', roughness: 0.05, metalness: 1.0 });
  let mirrors = 0;
  for (const n of nodes) {
    if (mirrors >= 150 || n.arms.some(a => rank(a.road.kind) > 1)) continue;
    const [a, b] = n.arms;
    let bx = a.dir[0] + b.dir[0], bz = a.dir[1] + b.dir[1];
    const l = Math.hypot(bx, bz);
    if (l < 0.3) continue;
    bx /= l; bz /= l;
    const half = Math.max(...n.arms.map(o => o.road.w / 2));
    const px = n.x + bx * (half + 1.3), pz = n.z + bz * (half + 1.3);
    if (!clear(px, pz, 0.3)) continue;
    const g = new THREE.Group();
    g.position.set(px, H(px, pz), pz);
    g.rotation.y = Math.atan2(-bx, -bz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.8, 8).translate(0, 1.4, 0), orange);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 8, 24), orange);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.4, 24), mirrorMat);
    rim.position.set(0, 2.9, 0.08); glass.position.set(0, 2.9, 0.09);
    rim.rotation.x = glass.rotation.x = -0.15;
    pole.castShadow = rim.castShadow = true;
    g.add(pole, rim, glass);
    group.add(g);
    mirrors++;
  }

  console.info(`[detail] poles=${poles.length} crosswalk/stop nodes=${nodes.length} guard posts=${posts.length} vending=${vendCount} mirrors=${mirrors}`);
  return { group, emissive };
}
