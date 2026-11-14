// 1. 路上の小物: 電柱・電線・街灯・横断歩道・停止線と「止まれ」・ガードパイプ・自販機・カーブミラー
// 配置は tools/build_props.py が計算した data/props.json。ここでは形を作って置くだけ。
import * as THREE from 'three';
import { Builder, canvasTexture } from './util.js';
import { drape } from '../terrain.js';

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);

// list の各要素 {x, y, z, yaw} に geo を置く
export function instanced(group, geo, mat, list, name, { shadow = true, scale = null } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  m.count = list.length; m.name = name; m.castShadow = shadow; m.receiveShadow = true;
  list.forEach((p, i) => {
    Q.setFromAxisAngle(Y, p.yaw || 0);
    if (scale) scale(p, S); else S.set(1, 1, 1);
    m.setMatrixAt(i, M.compose(P.set(p.x, p.y, p.z), Q, S));
  });
  group.add(m);
  return m;
}

// 長方形 [cx, cz, dx, dz, len, wid] を Builder に積む
export function addRects(b, rects, y, uv) {
  for (const [x, z, dx, dz, len, wid] of rects) b.flatRect(x, z, [dx, dz], len, wid, y, uv);
}

export function buildProps(props) {
  const group = new THREE.Group();
  group.name = 'detail_props';
  const emissive = [];

  // ---------- 電柱・電線・街灯 ----------
  const poles = props.poles;
  const poleMat = new THREE.MeshStandardMaterial({ color: '#aaa79f', roughness: 0.9 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#55585c', roughness: 0.7, metalness: 0.3 });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#f4f1e6', emissive: '#fff4d6', emissiveIntensity: 0 });
  emissive.push(lampMat);
  instanced(group, new THREE.CylinderGeometry(0.15, 0.2, 10.5, 10).translate(0, 5.25, 0), poleMat, poles, 'poles');
  instanced(group, new THREE.BoxGeometry(1.8, 0.1, 0.1).translate(0, 9.6, 0), darkMat, poles, 'pole_arms');
  instanced(group, new THREE.CylinderGeometry(0.28, 0.28, 0.9, 10).translate(0.45, 7.9, 0), darkMat, poles.filter(p => p.transformer), 'transformers');
  const lamps = poles.filter(p => p.lamp);
  instanced(group, new THREE.BoxGeometry(0.06, 0.06, 1.6).translate(0, 6.6, 0.8), darkMat, lamps, 'lamp_arms');
  instanced(group, new THREE.BoxGeometry(0.22, 0.1, 0.5).translate(0, 6.55, 1.55), lampMat, lamps, 'lamps');

  // 電線 [ax, ay, az, bx, by, bz, sag] をたるませた折れ線に
  const wp = [];
  const N = 10;
  for (const [ax, ay, az, bx, by, bz, s] of props.wires) {
    const pt = (t) => [ax + (bx - ax) * t, ay + (by - ay) * t - s * 4 * t * (1 - t), az + (bz - az) * t];
    for (let k = 0; k < N; k++) wp.push(...pt(k / N), ...pt((k + 1) / N));
  }
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  const wires = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: '#1d1f22' }));
  wires.name = 'wires';
  group.add(wires);

  // ---------- 路面標示 ----------
  const paint = new Builder(), stopText = new Builder();
  addRects(paint, props.paint, 0.125);
  addRects(stopText, props.tomare, 0.126, [[0, 0], [0, 1], [1, 1], [1, 0]]);
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

  // ---------- ガードパイプ (柱の点の列ごと) ----------
  const posts = [], pipes = [];
  for (const run of props.guardRails) {
    run.forEach(([x, z, y], i) => {
      const q = run[i + 1] || run[i - 1];
      const yaw = q ? Math.atan2(q[0] - x, q[1] - z) : 0;
      posts.push({ x, y, z, yaw });
      if (i > 0) {
        const [px, pz, py] = run[i - 1];
        const mx = (px + x) / 2, mz = (pz + z) / 2;
        pipes.push({ x: mx, z: mz, y: (py + y) / 2, yaw: Math.atan2(x - px, z - pz), len: Math.hypot(x - px, z - pz) });
      }
    });
  }
  const white = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.5, metalness: 0.2 });
  instanced(group, new THREE.CylinderGeometry(0.04, 0.04, 0.85, 6).translate(0, 0.425, 0), white, posts, 'guard_posts');
  for (const y of [0.45, 0.8]) {
    instanced(group, new THREE.CylinderGeometry(0.03, 0.03, 1, 6).rotateX(Math.PI / 2).translate(0, y, 0), white, pipes, 'guard_pipes', { scale: (p, s) => s.set(1, 1, p.len) });
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
  for (const v of props.vending) {
    const body = bodies[v.color] || bodies[0];
    const m = new THREE.Mesh(vendGeo, [body, body, body, body, vendFront, body]);
    m.position.set(v.x, v.y, v.z);
    m.rotation.y = v.yaw; // 正面 (+Z) が道路側
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }

  // ---------- カーブミラー ----------
  const orange = new THREE.MeshStandardMaterial({ color: '#e8742a', roughness: 0.6 });
  const mirrorMat = new THREE.MeshStandardMaterial({ color: '#cfd8e0', roughness: 0.05, metalness: 1.0 });
  const tilt = (geo, z) => geo.rotateX(-0.15).translate(0, 2.9, z);
  instanced(group, new THREE.CylinderGeometry(0.04, 0.04, 2.8, 8).translate(0, 1.4, 0), orange, props.mirrors, 'mirror_poles');
  instanced(group, tilt(new THREE.TorusGeometry(0.4, 0.04, 8, 24), 0.08), orange, props.mirrors, 'mirror_rims');
  instanced(group, tilt(new THREE.CircleGeometry(0.4, 24), 0.09), mirrorMat, props.mirrors, 'mirror_glass', { shadow: false });

  console.info(`[detail] poles=${poles.length} paint=${props.paint.length} guard runs=${props.guardRails.length} vending=${props.vending.length} mirrors=${props.mirrors.length}`);
  return { group, emissive };
}
