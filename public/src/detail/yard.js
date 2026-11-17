// 敷地まわりの小さな物: ブロック塀・生け垣・物置・室外機。
// 位置は tools/lidar_small.py が点群から見つけ (室外機だけは決まりによる推定)、tools/build_props.py が props.json に書いたもの。ここでは形を作って置くだけ。
import * as THREE from 'three';
import { canvasTexture } from './util.js';

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);

// 壁の帯 (長さ方向は 2 点の間、上下は地面から高さ h まで、両端の地面の高さに沿う) を、厚さ t の箱として積む
function addWall(pos, nor, uv, a, b, h, t, uScale, vScale, sink) {
  const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz);
  if (L < 0.05) return;
  const ux = dx / L, uz = dz / L, nx = -uz * t / 2, nz = ux * t / 2;
  const ya0 = a[1] - sink, yb0 = b[1] - sink, ya1 = a[1] + h, yb1 = b[1] + h;
  const quad = (p0, p1, p2, p3, n, uv4) => {
    pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    for (let k = 0; k < 6; k++) nor.push(...n);
    const [q0, q1, q2, q3] = uv4;
    uv.push(...q0, ...q1, ...q2, ...q0, ...q2, ...q3);
  };
  const U = L / uScale, V0 = -sink / vScale, V1 = h / vScale;
  for (const s of [1, -1]) { // 両面
    const ox = nx * s, oz = nz * s, n = [-uz * s, 0, ux * s];
    const A0 = [a[0] + ox, ya0, a[2] + oz], B0 = [b[0] + ox, yb0, b[2] + oz], B1 = [b[0] + ox, yb1, b[2] + oz], A1 = [a[0] + ox, ya1, a[2] + oz];
    if (s > 0) quad(A0, B0, B1, A1, n, [[0, V0], [U, V0], [U, V1], [0, V1]]);
    else quad(B0, A0, A1, B1, n, [[0, V0], [U, V0], [U, V1], [0, V1]]);
  }
  // 上面と両端
  const T = t / vScale;
  quad([a[0] - nx, ya1, a[2] - nz], [a[0] + nx, ya1, a[2] + nz], [b[0] + nx, yb1, b[2] + nz], [b[0] - nx, yb1, b[2] - nz], [0, 1, 0], [[0, 0], [0, T], [U, T], [U, 0]]);
  for (const [p, s] of [[a, -1], [b, 1]]) {
    const y0 = p[1] - sink, y1 = p[1] + h, n = [ux * s, 0, uz * s];
    const q0 = [p[0] - nx * s, y0, p[2] - nz * s], q1 = [p[0] + nx * s, y0, p[2] + nz * s];
    quad(q0, q1, [q1[0], y1, q1[2]], [q0[0], y1, q0[2]], n, [[0, V0], [t / uScale, V0], [t / uScale, V1], [0, V1]]);
  }
}

function geometry(pos, nor, uv) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

export function buildYard(props) {
  const group = new THREE.Group();
  group.name = 'detail_yard';

  // ---------- ブロック塀 (390 x 190 mm のコンクリートブロック、目地) ----------
  const blocks = (props.yardWalls || []).filter(w => w.k === 'block');
  if (blocks.length) {
    // 1 枚 = 横 4 個 (1.6 m) x 縦 4 段 (0.8 m)。段ごとに半分ずらす
    const tex = canvasTexture(256, 128, (g) => {
      g.fillStyle = '#8f8c86'; g.fillRect(0, 0, 256, 128);
      for (let r = 0; r < 4; r++) for (let c = -1; c < 5; c++) {
        const x = c * 64 + (r % 2) * 32, y = r * 32, v = 168 + ((r * 7 + c * 13) % 5) * 6;
        g.fillStyle = `rgb(${v},${v - 3},${v - 8})`; g.fillRect(x + 1.5, y + 1.5, 61, 29);
        g.fillStyle = 'rgba(0,0,0,.06)'; for (let k = 0; k < 14; k++) g.fillRect(x + 4 + (k * 23) % 56, y + 4 + (k * 11) % 24, 2, 2);
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const pos = [], nor = [], uv = [];
    for (const w of blocks) addWall(pos, nor, uv, w.p[0], w.p[1], w.h, 0.12, 1.6, 0.8, 0.3);
    const m = new THREE.Mesh(geometry(pos, nor, uv), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }));
    m.castShadow = m.receiveShadow = true; m.name = 'block_walls';
    group.add(m);
  }

  // ---------- 生け垣 (葉の模様。下ほど暗い) ----------
  const hedges = (props.yardWalls || []).filter(w => w.k === 'hedge');
  if (hedges.length) {
    const tex = canvasTexture(256, 256, (g) => {
      g.fillStyle = '#3d5a2c'; g.fillRect(0, 0, 256, 256);
      let s = 7;
      const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      for (let k = 0; k < 2600; k++) {
        const x = rnd() * 256, y = rnd() * 256, r = 2 + rnd() * 4, l = 30 + rnd() * 30;
        g.fillStyle = `hsl(${88 + rnd() * 30}, ${35 + rnd() * 25}%, ${l * (0.65 + 0.35 * (1 - y / 256))}%)`;
        g.beginPath(); g.ellipse(x, y, r, r * 0.6, rnd() * 3, 0, Math.PI * 2); g.fill();
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const pos = [], nor = [], uv = [];
    for (const w of hedges) addWall(pos, nor, uv, w.p[0], w.p[1], w.h, 0.6, 1.2, 1.2, 0.2);
    const m = new THREE.Mesh(geometry(pos, nor, uv), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    m.castShadow = m.receiveShadow = true; m.name = 'hedges';
    group.add(m);
  }

  // ---------- 物置 (スチールの物置: 引き戸 2 枚、少し張り出した屋根) ----------
  const sheds = props.sheds || [];
  if (sheds.length) {
    const front = canvasTexture(128, 128, (g) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = 'rgba(0,0,0,.18)'; for (let x = 4; x < 128; x += 6) g.fillRect(x, 0, 1, 128); // 縦のリブ
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(63, 4, 2, 124); g.fillRect(0, 2, 128, 3); g.fillRect(0, 124, 128, 4); // 戸の合わせ目・上下のレール
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(52, 60, 3, 14); g.fillRect(73, 60, 3, 14); // 取っ手
    });
    const side = canvasTexture(64, 64, (g) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64); g.fillStyle = 'rgba(0,0,0,.14)'; for (let x = 3; x < 64; x += 6) g.fillRect(x, 0, 1, 64); });
    const COLORS = ['#d9d2bf', '#c9cbc6', '#9aa392', '#cfc3a6'];
    const body = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mats = [side, side, side, side, front, side].map((t, i) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0.25, color: i === 2 ? '#bbbbbb' : '#ffffff' }));
    const roof = new THREE.BoxGeometry(1, 0.05, 1).translate(0, 0, 0);
    const roofMat = new THREE.MeshStandardMaterial({ color: '#8e8f8c', roughness: 0.5, metalness: 0.4 });
    const mb = new THREE.InstancedMesh(body, mats, sheds.length), mr = new THREE.InstancedMesh(roof, roofMat, sheds.length);
    const c = new THREE.Color();
    sheds.forEach((s, i) => {
      Q.setFromAxisAngle(Y, s.yaw);
      mb.setMatrixAt(i, M.compose(P.set(s.x, s.y - 0.1, s.z), Q, S.set(s.l, s.h + 0.05, s.w)));
      mb.setColorAt(i, c.set(COLORS[s.c % COLORS.length]));
      mr.setMatrixAt(i, M.compose(P.set(s.x, s.y + s.h, s.z), Q, S.set(s.l + 0.12, 1, s.w + 0.16)));
    });
    for (const m of [mb, mr]) { m.castShadow = m.receiveShadow = true; group.add(m); }
    mb.name = 'sheds'; mr.name = 'shed_roofs';
  }

  // ---------- 室外機 (エアコン: 白い箱、正面にファンの丸い格子) ----------
  const acs = props.acUnits || [];
  if (acs.length) {
    const front = canvasTexture(128, 96, (g) => {
      g.fillStyle = '#e9e7e0'; g.fillRect(0, 0, 128, 96);
      g.fillStyle = '#3a3c3e'; g.beginPath(); g.arc(46, 48, 38, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#c9c7c0'; g.lineWidth = 1.5;
      for (let r = 8; r < 38; r += 6) { g.beginPath(); g.arc(46, 48, r, 0, Math.PI * 2); g.stroke(); }
      for (let a = 0; a < 4; a++) { g.beginPath(); g.moveTo(46, 48); g.lineTo(46 + Math.cos(a * Math.PI / 2) * 38, 48 + Math.sin(a * Math.PI / 2) * 38); g.stroke(); }
      g.fillStyle = 'rgba(0,0,0,.15)'; for (let y = 8; y < 90; y += 5) g.fillRect(94, y, 28, 2); // 右側の通気口
    });
    const plain = new THREE.MeshStandardMaterial({ color: '#e3e1da', roughness: 0.6 });
    const geo = new THREE.BoxGeometry(0.8, 0.6, 0.28).translate(0, 0.32, 0);
    const mats = [plain, plain, plain, plain, new THREE.MeshStandardMaterial({ map: front, roughness: 0.6 }), plain];
    const m = new THREE.InstancedMesh(geo, mats, acs.length);
    acs.forEach((a, i) => { Q.setFromAxisAngle(Y, a.yaw); m.setMatrixAt(i, M.compose(P.set(a.x, a.y, a.z), Q, S.set(1, 1, 1))); });
    // 脚 (台)
    const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.04, 0.3).translate(0, 0.02, 0), new THREE.MeshStandardMaterial({ color: '#77736b', roughness: 0.8 }), acs.length);
    acs.forEach((a, i) => { Q.setFromAxisAngle(Y, a.yaw); legs.setMatrixAt(i, M.compose(P.set(a.x, a.y, a.z), Q, S.set(1, 1, 1))); });
    for (const x of [m, legs]) { x.castShadow = x.receiveShadow = true; group.add(x); }
    m.name = 'ac_units'; legs.name = 'ac_legs';
  }

  console.info(`[detail] yard walls=${blocks.length} hedges=${hedges.length} sheds=${sheds.length} ac=${acs.length}`);
  return { group };
}
