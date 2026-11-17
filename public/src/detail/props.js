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
  // 街灯の光だまり: 灯りの真下 (アームの先、壁側へ 1.55 m) の地面に、ぼかした円の板を加算合成で置く。夜だけ見える (強さは win に連動)
  {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,214,150,1)'); gr.addColorStop(0.4, 'rgba(255,196,120,.6)'); gr.addColorStop(1, 'rgba(255,180,100,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const poolMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, toneMapped: false });
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(15, 15).rotateX(-Math.PI / 2), poolMat, Math.max(1, lamps.length));
    pool.count = lamps.length; pool.name = 'lamp_pools'; pool.renderOrder = 5; pool.castShadow = pool.receiveShadow = false;
    lamps.forEach((p, i) => {
      const x = p.x + Math.sin(p.yaw || 0) * 1.55, z = p.z + Math.cos(p.yaw || 0) * 1.55;
      pool.setMatrixAt(i, M.compose(P.set(x, p.y + 0.16, z), Q.identity(), S.set(1, 1, 1)));
    });
    group.add(pool);
    poolMat.userData.glow = 0.55; poolMat.userData.opacityOnly = true;   // opacity = win * glow (emissiveIntensity は使わない)
    emissive.push(poolMat);
  }

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

  // ---------- マンホール・側溝 (路面に沿わせて貼る板。模様は Canvas で作る) ----------
  if (props.manholes && props.manholes.length) {
    const tex = canvasTexture(256, 128, (g) => {
      g.clearRect(0, 0, 256, 128);
      const lid = (cx, r, small) => { // 鋳鉄の蓋: 外周の縁、同心円、格子の滑り止め
        g.save(); g.beginPath(); g.arc(cx, 64, r, 0, Math.PI * 2); g.clip();
        g.fillStyle = '#4b4a47'; g.fillRect(cx - r, 64 - r, r * 2, r * 2);
        g.strokeStyle = '#2f2e2c'; g.lineWidth = 2;
        if (small) { for (let k = -r; k < r; k += 7) { g.beginPath(); g.moveTo(cx + k, 64 - r); g.lineTo(cx + k, 64 + r); g.stroke(); } }
        else {
          for (let k = -r; k < r; k += 9) { g.beginPath(); g.moveTo(cx - r, 64 + k); g.lineTo(cx + r, 64 + k + r * 0.5); g.stroke(); g.beginPath(); g.moveTo(cx - r, 64 + k + r * 0.5); g.lineTo(cx + r, 64 + k); g.stroke(); }
          g.fillStyle = '#5a5955'; g.beginPath(); g.arc(cx, 64, r * 0.32, 0, Math.PI * 2); g.fill();
          g.strokeStyle = '#333230'; g.lineWidth = 3; g.beginPath(); g.arc(cx, 64, r * 0.62, 0, Math.PI * 2); g.stroke();
        }
        g.strokeStyle = '#6d6b66'; g.lineWidth = 5; g.beginPath(); g.arc(cx, 64, r - 3, 0, Math.PI * 2); g.stroke(); // 縁 (すり減って明るい)
        g.restore();
      };
      lid(64, 62, false); lid(192, 62, true);
    });
    const b = new Builder();
    for (const [x, z, k] of props.manholes) {
      const u0 = k ? 0.5 : 0, u1 = u0 + 0.5;
      b.flatRect(x, z, [1, 0], k ? 0.4 : 0.64, k ? 0.4 : 0.64, 0.128, [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]);
    }
    const m = new THREE.Mesh(drape(b.geometry(), 1.5), new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.5, metalness: 0.4, polygonOffset: true, polygonOffsetFactor: -3 }));
    m.receiveShadow = true; m.name = 'manholes';
    group.add(m);
  }
  if (props.gutters && props.gutters.length) {
    // 5 m 分の模様: 50 cm のコンクリートの蓋 9 枚と、鉄のグレーチング 1 枚
    const tex = canvasTexture(1024, 64, (g) => {
      const W = 1024 / 10;
      for (let i = 0; i < 10; i++) {
        const x0 = i * W;
        if (i === 6) {
          g.fillStyle = '#3e3f40'; g.fillRect(x0, 0, W, 64);
          g.fillStyle = '#1c1d1e'; for (let k = 6; k < W - 4; k += 7) g.fillRect(x0 + k, 8, 3, 48);
          g.fillStyle = '#5b5c5d'; g.fillRect(x0, 0, W, 6); g.fillRect(x0, 58, W, 6);
        } else {
          const v = 176 + ((i * 37) % 17); g.fillStyle = `rgb(${v},${v - 3},${v - 9})`; g.fillRect(x0, 0, W, 64);
          g.fillStyle = 'rgba(0,0,0,.08)'; for (let k = 0; k < 60; k++) g.fillRect(x0 + (k * 53) % W, (k * 29) % 64, 2, 2); // ざらつき
          g.fillStyle = '#7e7b75'; g.fillRect(x0 + W / 2 - 6, 30, 12, 4); // 持ち上げ用の穴
        }
        g.fillStyle = '#6a6762'; g.fillRect(x0, 0, 2, 64); // 蓋の継ぎ目
      }
    });
    tex.wrapS = THREE.RepeatWrapping;
    const b = new Builder();
    for (const run of props.gutters) {
      let u = 0;
      for (let i = 0; i + 1 < run.length; i++) {
        const [ax, az] = run[i], [bx, bz] = run[i + 1], L = Math.hypot(bx - ax, bz - az);
        if (L < 0.05) continue;
        const u1 = u + L / 5;
        b.flatRect((ax + bx) / 2, (az + bz) / 2, [(bx - ax) / L, (bz - az) / L], L, 0.35, 0.127, [[u, 0], [u1, 0], [u1, 1], [u, 1]]);
        u = u1;
      }
    }
    const m = new THREE.Mesh(drape(b.geometry(), 1.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.receiveShadow = true; m.name = 'gutters';
    group.add(m);
  }

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

  // ---------- 駐車場の車 (点群に写っていた駐車ますに置く。props.json の cars: {x, y, z, yaw, c: 色}) ----------
  const cars = props.cars || [];
  if (cars.length) {
    const paintMat2 = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: '#232a33', roughness: 0.15, metalness: 0.4 });
    const tyre = new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.9 });
    const tint = new THREE.Color();
    const colored = (geo, name) => { // 車体の色を 1 台ずつ変える
      const m = instanced(group, geo, paintMat2, cars, name);
      cars.forEach((c, i) => m.setColorAt(i, tint.set(c.c)));
      return m;
    };
    colored(new THREE.BoxGeometry(1.72, 0.6, 4.3).translate(0, 0.6, 0), 'car_bodies');
    colored(new THREE.BoxGeometry(1.5, 0.06, 2.0).translate(0, 1.45, -0.25), 'car_roofs');
    instanced(group, new THREE.BoxGeometry(1.56, 0.52, 2.4).translate(0, 1.16, -0.25), glass, cars, 'car_cabins');
    for (const z of [1.35, -1.35]) {
      instanced(group, new THREE.CylinderGeometry(0.32, 0.32, 1.78, 12).rotateZ(Math.PI / 2).translate(0, 0.32, z), tyre, cars, 'car_wheels');
    }
  }

  // ---------- 敷地の外周の柵 (工業用地・学校・墓地。props.json の fences: 柱 [x, z, y] とパネル [x, z, y, yaw, 長さ]) ----------
  const meshTex = canvasTexture(64, 64, (g, W, H) => { // 金網: 細い格子 + 上下の横桟
    g.clearRect(0, 0, W, H); g.strokeStyle = '#ffffff'; g.lineWidth = 1.2;
    for (let k = -W; k < W * 2; k += 8) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + H, H); g.stroke(); g.beginPath(); g.moveTo(k, H); g.lineTo(k + H, 0); g.stroke(); }
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, 3); g.fillRect(0, H - 3, W, 3);
  });
  meshTex.wrapS = THREE.RepeatWrapping; meshTex.repeat.set(4, 1);
  for (const f of props.fences || []) {
    const mat = new THREE.MeshStandardMaterial({ color: f.color, roughness: 0.6, metalness: 0.4 });
    instanced(group, new THREE.CylinderGeometry(0.035, 0.035, f.h, 6).translate(0, f.h / 2, 0), mat, f.posts.map(([x, z, y]) => ({ x, y, z })), 'fence_posts_' + f.kind);
    const pm = f.kind === 'construction' // 工事の仮囲いは白い板、ほかは金網
      ? new THREE.MeshStandardMaterial({ color: f.color, side: THREE.DoubleSide, roughness: 0.7 })
      : new THREE.MeshStandardMaterial({ color: f.color, map: meshTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 });
    // 板は長さ 1 で作り、進行方向 (局所 +Z) に長さを掛ける
    instanced(group, new THREE.PlaneGeometry(1, f.h - 0.1).translate(0, f.h / 2 + 0.05, 0).rotateY(Math.PI / 2), pm,
      f.panels.map(([x, z, y, yaw, len]) => ({ x, y, z, yaw, len })), 'fence_panels_' + f.kind, { shadow: f.kind === 'construction', scale: (q, sc) => sc.set(1, 1, q.len) });
  }

  // ---------- 墓石 (props.json の graves) ----------
  const graves = props.graves || [];
  if (graves.length) {
    const stone = new THREE.MeshStandardMaterial({ color: '#8f9094', roughness: 0.55 });
    const base = new THREE.MeshStandardMaterial({ color: '#b3b1aa', roughness: 0.8 });
    instanced(group, new THREE.BoxGeometry(1.1, 0.3, 1.1).translate(0, 0.15, 0), base, graves, 'grave_bases');
    instanced(group, new THREE.BoxGeometry(0.34, 0.95, 0.34).translate(0, 0.77, 0), stone, graves, 'grave_stones');
  }

  console.info(`[detail] poles=${poles.length} paint=${props.paint.length} guard runs=${props.guardRails.length} vending=${props.vending.length} mirrors=${props.mirrors.length}`);
  return { group, emissive };
}
