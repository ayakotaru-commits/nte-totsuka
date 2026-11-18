// 7. 線路の作り込み: バラスト (砕石) の模様、コンクリートの枕木 (0.6 m おき)、立体のレール (狭軌 1,067 mm)。
// 地面の線路 (city.json の rails のうち橋でないもの) に置く。線路の橋は bridges.js が描く。
// 高さ: バラストの上面 = 地形 + 0.25 m (city.js の地面のバラストと同じ)、枕木の上面 = + 0.40 m、レールの上面 = + 0.55 m
//       (電車の車輪の高さ。tools/build_props.py の RAIL_TOP と同じ)
import * as THREE from 'three';
import { Builder, canvasTexture } from './util.js';
import { H, drape } from '../terrain.js';

const SLEEPER_STEP = 0.6, GAUGE = 1.067;
const BALLAST_Y = 0.25, SLEEPER_TOP = 0.40, RAIL_TOP = 0.55;

// 折れ線を間隔 step の点 [x, z, dx, dz] に取り直す
function resample(pts, step, start = step / 2) {
  const out = [];
  let acc = 0, next = start;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) continue;
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    while (next <= acc + L) { const t = next - acc; out.push([ax + dx * t, az + dz * t, dx, dz]); next += step; }
    acc += L;
  }
  return out;
}

export function buildTrackbed(city) {
  const group = new THREE.Group();
  group.name = 'detail_trackbed';
  const rails = (city.rails || []).filter(r => !r.ys && r.pts.length >= 2);
  if (!rails.length) return { group };

  // ---------- バラスト (砕石の模様。地面の線路の帯に重ねて貼る) ----------
  const stones = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#7d756d'; g.fillRect(0, 0, 256, 256);
    let s = 11;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let k = 0; k < 3200; k++) {
      const x = rnd() * 256, y = rnd() * 256, r = 1.5 + rnd() * 3.5, v = 70 + rnd() * 90, w = rnd() * 14 - 7;
      g.fillStyle = `rgb(${v + w + 8},${v + w},${v - 6})`;
      g.beginPath(); g.moveTo(x - r, y); g.lineTo(x - r * 0.3, y - r); g.lineTo(x + r, y - r * 0.4); g.lineTo(x + r * 0.6, y + r); g.lineTo(x - r * 0.5, y + r * 0.8); g.fill();
    }
    g.fillStyle = 'rgba(90,60,30,.10)'; g.fillRect(0, 0, 256, 256); // 鉄さびで少し茶色い
  });
  stones.wrapS = stones.wrapT = THREE.RepeatWrapping;
  const bal = new Builder();
  for (const r of rails) {
    let u = 0;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const u1 = u + L / 2;
      bal.flatRect((ax + bx) / 2, (az + bz) / 2, [(bx - ax) / L, (bz - az) / L], L + 0.4, 3.4, 0.131, [[u, 0], [u1, 0], [u1, 1.7], [u, 1.7]]);
      u = u1;
    }
  }
  const balMesh = new THREE.Mesh(drape(bal.geometry(), 1.5), new THREE.MeshStandardMaterial({ map: stones, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }));
  balMesh.receiveShadow = true; balMesh.name = 'ballast';
  group.add(balMesh);

  // ---------- 枕木 (コンクリート、0.6 m おき) ----------
  const sleepers = [];
  for (const r of rails) for (const p of resample(r.pts, SLEEPER_STEP)) sleepers.push(p);
  const sm = new THREE.InstancedMesh(new THREE.BoxGeometry(2.0, 0.17, 0.22).translate(0, -0.085, 0),
    new THREE.MeshStandardMaterial({ color: '#a5a199', roughness: 0.9 }), sleepers.length);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
  sleepers.forEach(([x, z, dx, dz], i) => {
    Q.setFromAxisAngle(Y, Math.atan2(dx, dz));   // 局所 +Z = 線路の向き、X = 線路に直角
    sm.setMatrixAt(i, M.compose(P.set(x, H(x, z) + SLEEPER_TOP, z), Q, S));
  });
  sm.receiveShadow = true; sm.castShadow = false; sm.name = 'sleepers';
  group.add(sm);

  // ---------- レール (頭が光る鋼。断面は幅 7 cm・高さ 15 cm の箱) ----------
  const head = new Builder(), web = new Builder();
  const W = 0.035;
  for (const r of rails) {
    const pts = resample(r.pts, 2.0, 0);
    const last = r.pts[r.pts.length - 1], prev = r.pts[r.pts.length - 2], Lz = Math.hypot(last[0] - prev[0], last[1] - prev[1]) || 1;
    pts.push([last[0], last[1], (last[0] - prev[0]) / Lz, (last[1] - prev[1]) / Lz]);
    for (const side of [-1, 1]) {
      const off = side * GAUGE / 2;
      const P2 = pts.map(([x, z, dx, dz]) => { const px = x - dz * off, pz = z + dx * off; return [px, pz, dx, dz, H(px, pz)]; });
      for (let i = 0; i + 1 < P2.length; i++) {
        const [ax, az, adx, adz, ay] = P2[i], [bx, bz, bdx, bdz, by] = P2[i + 1];
        const an = [-adz, adx], bn = [-bdz, bdx];
        const A = (s, h) => [ax + an[0] * s, ay + h, az + an[1] * s], B = (s, h) => [bx + bn[0] * s, by + h, bz + bn[1] * s];
        head.quad(A(-W, RAIL_TOP), A(W, RAIL_TOP), B(W, RAIL_TOP), B(-W, RAIL_TOP), [0, 1, 0]);
        web.quad(A(W, SLEEPER_TOP), B(W, SLEEPER_TOP), B(W, RAIL_TOP), A(W, RAIL_TOP), [an[0], 0, an[1]]);
        web.quad(B(-W, SLEEPER_TOP), A(-W, SLEEPER_TOP), A(-W, RAIL_TOP), B(-W, RAIL_TOP), [-an[0], 0, -an[1]]);
      }
    }
  }
  const headM = new THREE.Mesh(head.geometry(), new THREE.MeshStandardMaterial({ color: '#c9ccd0', roughness: 0.25, metalness: 0.9 }));
  const webM = new THREE.Mesh(web.geometry(), new THREE.MeshStandardMaterial({ color: '#5a4434', roughness: 0.8, metalness: 0.3 })); // 側面はさびた茶色
  headM.name = 'rail_heads'; webM.name = 'rail_webs'; webM.castShadow = true; headM.receiveShadow = webM.receiveShadow = true;
  group.add(headM, webM);
  console.info(`[detail] trackbed: rails=${rails.length} sleepers=${sleepers.length}`);
  return { group };
}
