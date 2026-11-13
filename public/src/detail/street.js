// 信号機・歩行者用信号・バス停
// 位置: city.streetNodes (build_city.py が OSM の信号・バス停の点を全部書き出したもの)。
// 無ければ city.pois の名前付きの信号 (highway:traffic_signals)・バス停 (highway:bus_stop) を使う。
import * as THREE from 'three';
import { Builder, hash, DRIVABLE, MAJOR, rank, intersections, canvasTexture, edge, carriage } from './util.js';
import { H, drape } from '../terrain.js';

// 信号の1周期 (秒): 主方向 青 → 黄 → 全赤 → 交差方向 青 → 黄 → 全赤
const GREEN = 22, YELLOW = 3, ALLRED = 2, HALF = GREEN + YELLOW + ALLRED, CYCLE = HALF * 2;
const PED_FLASH = 5; // 歩行者用は青の終わりに点滅
const LAMP = { off: new THREE.Color('#2a2c2e'), green: new THREE.Color('#25e0b4'), yellow: new THREE.Color('#ffb21a'), red: new THREE.Color('#ff3020') };

export function buildStreet({ city, world, cx, cz, R }) {
  const group = new THREE.Group();
  group.name = 'detail_street';
  const inR = (x, z, m = 0) => (x - cx) ** 2 + (z - cz) ** 2 <= (R + m) ** 2;
  const roads = city.roads.filter(r => !r.ys && DRIVABLE.has(r.kind) && r.pts.some(p => inR(p[0], p[1], 60)));
  const nodes = intersections(roads);

  // 置ける場所か (地上の建物の中・壁際は不可。高架の建物の下は可)
  const clear = (x, z, r) => {
    for (const b of world.query(x - r, z - r, x + r, z + r)) {
      if (b.minH > 2.5) continue;
      if (world.contains(b, x, z) || world.closest(b, x, z).d < r) return false;
    }
    return true;
  };

  // 点の一覧
  let pts = city.streetNodes;
  if (!pts) {
    pts = [];
    for (const p of city.pois || []) {
      if (p.cat === 'highway:traffic_signals') pts.push({ kind: 'signal', x: p.x, z: p.z, name: p.name });
      else if (p.cat === 'highway:bus_stop') pts.push({ kind: 'bus_stop', x: p.x, z: p.z, name: p.name });
    }
  }
  pts = pts.filter(p => inR(p.x, p.z));

  // 最寄りの車道の線分 (点の射影・向き・左右)
  function nearestRoad(x, z, maxD) {
    let best = null;
    for (const r of roads) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
        const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
        if (l2 < 0.01) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
        const px = ax + ex * t, pz = az + ez * t, d = Math.hypot(x - px, z - pz);
        if (d < maxD && (!best || d < best.d)) {
          const l = Math.sqrt(l2);
          best = { r, i, x: px, z: pz, d, dx: ex / l, dz: ez / l, segLen: l, t };
        }
      }
    }
    return best;
  }

  // ---------- 信号機 ----------
  // 交差点 (または単路の横断歩道) を集める
  const signalSites = [];
  const used = new Set();
  const sigPts = pts.filter(p => p.kind === 'signal');
  const crossPts = pts.filter(p => p.kind === 'crossing_signal');
  for (const p of sigPts) {
    let n = null, nd = 20;
    for (const q of nodes) { const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < nd) { nd = d; n = q; } }
    if (n) {
      if (used.has(n)) continue;
      used.add(n);
      signalSites.push({ x: n.x, z: n.z, arms: n.arms, mid: false });
    } else {
      const s = nearestRoad(p.x, p.z, 15);
      if (s) signalSites.push(midSite(s));
    }
  }
  // 単路の押しボタン式など (交差点の信号から離れているものだけ)
  for (const p of crossPts) {
    if (signalSites.some(s => Math.hypot(s.x - p.x, s.z - p.z) < 30)) continue;
    const s = nearestRoad(p.x, p.z, 10);
    if (s) signalSites.push(midSite(s));
  }
  function midSite(s) {
    return {
      x: s.x, z: s.z, mid: true,
      arms: [
        { road: s.r, dir: [s.dx, s.dz], len: 99, fwd: true },
        { road: s.r, dir: [-s.dx, -s.dz], len: 99, fwd: false },
      ],
    };
  }

  const vehicle = [], peds = [], crossPaint = new Builder();
  for (const site of signalSites) {
    const rnd = hash('sig' + site.x.toFixed(1) + site.z.toFixed(1));
    const offset = rnd() * CYCLE;
    // 主方向: いちばん格上 (同格なら道幅が広い) の腕
    const arms = site.arms.filter(a => !(a.road.kind === 'service' && a.road.w < 5));
    if (arms.length < 2) continue;
    const ref = arms.reduce((m, a) => (rank(a.road.kind) * 100 + a.road.w > rank(m.road.kind) * 100 + m.road.w ? a : m)).dir;
    const axisOf = (a) => Math.abs(a.dir[0] * ref[0] + a.dir[1] * ref[1]) > 0.7 ? 0 : 1;
    for (const a of arms) {
      // 横断歩道の位置は props.js と同じ式 (交差点のほかの腕の最大の半幅 + 2.2m)
      const crossHalf = site.mid ? 0 : Math.max(0, ...site.arms.filter(o => o !== a).map(o => o.road.w / 2));
      const [dx, dz] = a.dir, nx = -dz, nz = dx; // n = 腕の向きの「+1 側」
      const cg = carriage(a.road), w = cg.w, c0 = a.fwd ? cg.c : -cg.c;
      if (w < 3) continue;
      const cwD = site.mid ? 0 : crossHalf + 2.2; // 横断歩道の中心 (props.js と同じ位置)
      if (site.mid) {
        // 単路の横断歩道は props.js が描かないのでここで描く (2本の腕のうち片方だけ)
        if (a.fwd) {
          const cnt = Math.floor((w - 1) / 0.9);
          for (let i = 0; i < cnt; i++) {
            const t = (i - (cnt - 1) / 2) * 0.9;
            crossPaint.flatRect(site.x + nx * (t + c0), site.z + nz * (t + c0), [dx, dz], 3.0, 0.45, 0.125);
          }
        }
      }
      // 車両用: この腕から出ていく車線の左側 (左側通行)、横断歩道の先。灯器は交差点側 (-dir) を向き、車道の上に張り出す
      // 出ていく向き dir の左 = (dz, -dx) = -n。道路の点の並びに対しては fwd なら右 (-1) 側
      const side = a.fwd ? -1 : 1;
      const d = cwD + (site.mid ? 4 : 2.5);
      if (a.len > d * 0.7 || site.mid) {
        const roadHalfL = edge(a.road, side); // 中心線から左の縁 (歩道込み)
        const sw = a.road.sw || 0;
        for (const off of sw ? [roadHalfL - sw + 0.5, roadHalfL - sw + 1.0] : [roadHalfL + 0.4, roadHalfL + 0.9, roadHalfL]) {
          const px = site.x + dx * d - nx * off, pz = site.z + dz * d - nz * off;
          if (!clear(px, pz, 0.35)) continue;
          // 腕の長さ: 柱から左車線の中ほどまで (車道の左の縁 = 中心 c0 から w/2)
          const curbL = c0 - w / 2; // n 軸上の左の縁の位置 (負)
          const reach = Math.min(5.5, Math.max(1.6, off + curbL + Math.min(w / 2, 3.5) * 0.6));
          vehicle.push({ x: px, z: pz, fx: -dx, fz: -dz, reach, axis: axisOf(a), offset });
          break;
        }
      }
      // 歩行者用: この腕の横断歩道の両端。向かい側の端を向く。車両がこの腕の方向に流れていない間が青
      if (!site.mid || a.fwd) {
        if (!site.mid && !(arms.some(o => MAJOR.has(o.road.kind)) && w >= 5 && a.len > crossHalf + 6)) continue;
        const ends = [c0 - w / 2 - 0.6, c0 + w / 2 + 0.6];
        const pos = ends.map(o => [site.x + dx * cwD + nx * o, site.z + dz * cwD + nz * o]);
        for (let k = 0; k < 2; k++) {
          const [px, pz] = pos[k], [qx, qz] = pos[1 - k];
          if (!clear(px, pz, 0.3)) continue;
          const l = Math.hypot(qx - px, qz - pz) || 1;
          // 柱は横断歩道の脇 (dir 方向に 1.8m 外側)
          const sx = px + dx * 1.9, sz = pz + dz * 1.9;
          peds.push({ x: sx, z: sz, fx: (qx - px) / l, fz: (qz - pz) / l, axis: axisOf(a), offset });
        }
      }
    }
  }

  // ---------- 形 ----------
  const M = new THREE.Matrix4(), L = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  // 局所座標: +Z = 正面 (f), +X = 正面に向かって左手 → 車両用では車道の中央側
  const frame = (it) => M.compose(P.set(it.x, H(it.x, it.z), it.z), Q.setFromAxisAngle(Y, Math.atan2(it.fx, it.fz)), S.set(1, 1, 1));
  const instances = (geo, mat, list, place, name, shadow = true) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    m.count = list.length; m.name = name; m.castShadow = shadow; m.receiveShadow = true;
    list.forEach((it, i) => { frame(it); m.setMatrixAt(i, M.multiply(place(it, L))); });
    group.add(m);
    return m;
  };
  const at = (x, y, z, sx = 1, sy = 1, sz = 1) => (L) => L.compose(P.set(x, y, z), Q.identity(), S.set(sx, sy, sz));

  const gray = new THREE.MeshStandardMaterial({ color: '#b9bcbd', roughness: 0.6, metalness: 0.4 });
  const housing = new THREE.MeshStandardMaterial({ color: '#c9ccc9', roughness: 0.5, metalness: 0.2 });
  const hoodMat = new THREE.MeshStandardMaterial({ color: '#1e2022', roughness: 0.6, side: THREE.DoubleSide });
  const lampMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });

  // 車両用信号
  const SIG_Y = 5.4;
  instances(new THREE.CylinderGeometry(0.13, 0.16, 6.2, 10).translate(0, 3.1, 0), gray, vehicle, () => at(0, 0, 0)(L), 'signal_poles');
  instances(new THREE.BoxGeometry(1, 0.1, 0.1).translate(0.5, 0, 0), gray, vehicle, (it) => at(0, SIG_Y + 0.35, 0, it.reach)(L), 'signal_arms');
  // 灯器の箱 (横型 3 灯)。腕の先から少し戻った所
  const headX = (it) => it.reach - 0.75;
  instances(new THREE.BoxGeometry(1.3, 0.45, 0.24), housing, vehicle, (it) => at(headX(it), SIG_Y, 0)(L), 'signal_heads');
  instances(new THREE.BoxGeometry(0.06, 0.38, 0.06), gray, vehicle, (it) => at(headX(it), SIG_Y + 0.22, 0)(L), 'signal_hangers');
  const lampGeo = new THREE.CircleGeometry(0.15, 18);
  const hoodGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.2, 14, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
  // 運転者から見て 左 = 青, 中 = 黄, 右 = 赤。運転者の右は局所 +X (車道の中央側)
  const vLamps = [['green', -0.42], ['yellow', 0], ['red', 0.42]].map(([c, ox]) => {
    instances(hoodGeo, hoodMat, vehicle, (it) => at(headX(it) + ox, SIG_Y, 0.2)(L), 'signal_hoods');
    const m = instances(lampGeo, lampMat, vehicle, (it) => at(headX(it) + ox, SIG_Y, 0.125)(L), 'signal_lamp_' + c, false);
    return { c, m };
  });

  // 歩行者用信号 (縦 2 灯: 上 赤・下 青)
  const PED_Y = 2.55;
  instances(new THREE.CylinderGeometry(0.07, 0.08, 3.2, 8).translate(0, 1.6, 0), gray, peds, () => at(0, 0, 0)(L), 'ped_poles');
  instances(new THREE.BoxGeometry(0.4, 0.8, 0.2), housing, peds, () => at(0, PED_Y, 0.16)(L), 'ped_heads');
  const pedTex = (color, walking) => canvasTexture(64, 64, (g, W, Hh) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, Hh);
    g.fillStyle = color;
    g.beginPath(); g.arc(32, 12, 7, 0, Math.PI * 2); g.fill(); // 頭
    g.lineWidth = 9; g.lineCap = 'round'; g.strokeStyle = color;
    g.beginPath();
    if (walking) { g.moveTo(32, 24); g.lineTo(30, 40); g.moveTo(30, 40); g.lineTo(20, 58); g.moveTo(30, 40); g.lineTo(42, 58); g.moveTo(31, 27); g.lineTo(20, 38); g.moveTo(31, 27); g.lineTo(43, 34); }
    else { g.moveTo(32, 24); g.lineTo(32, 42); g.moveTo(28, 42); g.lineTo(28, 58); g.moveTo(36, 42); g.lineTo(36, 58); g.moveTo(25, 27); g.lineTo(25, 42); g.moveTo(39, 27); g.lineTo(39, 42); }
    g.stroke();
  });
  const pedLampGeo = new THREE.PlaneGeometry(0.3, 0.3);
  const pRed = instances(pedLampGeo, new THREE.MeshBasicMaterial({ map: pedTex('#fff', false), toneMapped: false }), peds, () => at(0, PED_Y + 0.18, 0.265)(L), 'ped_red', false);
  const pGreen = instances(pedLampGeo, new THREE.MeshBasicMaterial({ map: pedTex('#fff', true), toneMapped: false }), peds, () => at(0, PED_Y - 0.18, 0.265)(L), 'ped_green', false);

  // 単路の横断歩道の白線
  if (crossPaint.p.length) {
    const m = new THREE.Mesh(drape(crossPaint.geometry()), new THREE.MeshStandardMaterial({ color: '#ecebe4', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.receiveShadow = true; m.name = 'midblock_crosswalks';
    group.add(m);
  }

  // ---------- バス停 ----------
  const stops = [];
  for (const p of pts.filter(p => p.kind === 'bus_stop')) {
    const s = nearestRoad(p.x, p.z, 25);
    if (!s || stops.some(o => Math.hypot(o.x - p.x, o.z - p.z) < 3)) continue;
    const nx = -s.dz, nz = s.dx; // 道路の点の並びに対して +1 側
    const side = (p.x - s.x) * nx + (p.z - s.z) * nz >= 0 ? 1 : -1;
    const e = edge(s.r, side), sw = s.r.sw || 0;
    for (const off of sw ? [e - sw + 0.6, e - sw + 1.2] : [e + 0.5, e + 1.0, e, e - 0.4]) {
      const x = s.x + nx * side * off, z = s.z + nz * side * off;
      if (!clear(x, z, 0.35)) continue;
      // 正面 (+Z) を歩道側 (道路の外向き) に。標識の円板は道路に沿った向き
      stops.push({ x, z, fx: nx * side, fz: nz * side, name: p.name || 'バス停', src: p });
      break;
    }
  }
  instances(new THREE.CylinderGeometry(0.33, 0.38, 0.28, 16).translate(0, 0.14, 0), new THREE.MeshStandardMaterial({ color: '#9b9a95', roughness: 0.9 }), stops, () => at(0, 0, 0)(L), 'busstop_bases');
  instances(new THREE.CylinderGeometry(0.035, 0.035, 2.5, 8).translate(0, 1.25, 0), gray, stops, () => at(0, 0, 0)(L), 'busstop_poles');
  // 時刻表の箱 (歩道側を向く)
  const ttTex = canvasTexture(128, 160, (g, W, Hh) => {
    g.fillStyle = '#f4f4ef'; g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#2b5c9a'; g.fillRect(0, 0, W, 22);
    g.fillStyle = '#fff'; g.font = 'bold 15px sans-serif'; g.textAlign = 'center'; g.fillText('時刻表', W / 2, 16);
    g.fillStyle = '#555';
    for (let r = 0; r < 12; r++) { g.fillRect(10, 32 + r * 10, 14, 5); for (let c = 0; c < 6; c++) if ((r * 7 + c * 3) % 5) g.fillRect(32 + c * 15, 32 + r * 10, 10, 5); }
  });
  instances(new THREE.BoxGeometry(0.42, 0.55, 0.06), new THREE.MeshStandardMaterial({ color: '#d8d8d2', roughness: 0.6 }), stops, () => at(0, 1.45, 0.07)(L), 'busstop_boxes');
  instances(new THREE.PlaneGeometry(0.38, 0.5), new THREE.MeshStandardMaterial({ map: ttTex, roughness: 0.5 }), stops, () => at(0, 1.45, 0.101)(L), 'busstop_timetables');
  // 円い標識 + 停留所名の板 (名前ごとにテクスチャ)
  const byName = new Map();
  for (const s of stops) { if (!byName.has(s.name)) byName.set(s.name, []); byName.get(s.name).push(s); }
  const discGeo = new THREE.CircleGeometry(0.3, 28);
  const discRim = new THREE.TorusGeometry(0.3, 0.025, 6, 28);
  const plateGeo = new THREE.PlaneGeometry(0.62, 0.2);
  for (const [name, list] of byName) {
    const tex = canvasTexture(256, 256, (g, W) => {
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#2b5c9a'; g.lineWidth = 22; g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 14, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#2b5c9a';
      // バスの絵
      g.fillRect(70, 70, 116, 76); g.fillStyle = '#fff'; g.fillRect(80, 80, 96, 30); g.fillStyle = '#2b5c9a';
      g.beginPath(); g.arc(92, 150, 12, 0, Math.PI * 2); g.arc(164, 150, 12, 0, Math.PI * 2); g.fill();
      g.font = 'bold 40px "Yu Gothic UI", "Meiryo", sans-serif'; g.textAlign = 'center'; g.fillText('バス', W / 2, 205);
    });
    const plateTex = canvasTexture(512, 160, (g, W, Hh) => {
      g.fillStyle = '#2b5c9a'; g.fillRect(0, 0, W, Hh);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let fs = 96; g.font = `bold ${fs}px "Yu Gothic UI", "Meiryo", sans-serif`;
      while (g.measureText(name).width > W - 30 && fs > 30) { fs -= 6; g.font = `bold ${fs}px "Yu Gothic UI", "Meiryo", sans-serif`; }
      g.fillText(name, W / 2, Hh / 2 + 4);
    });
    const discMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, side: THREE.DoubleSide });
    const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5, side: THREE.DoubleSide });
    // 円板は道路に沿う向き (局所 +X 方向を法線に): Y 軸まわりに 90°
    const rotY = (L, x, y, z) => L.compose(P.set(x, y, z), Q.setFromAxisAngle(Y, Math.PI / 2), S.set(1, 1, 1));
    instances(discGeo, discMat, list, () => rotY(L, 0, 2.55, 0), 'busstop_sign');
    instances(discRim, gray, list, () => rotY(L, 0, 2.55, 0), 'busstop_rim');
    instances(plateGeo, plateMat, list, () => rotY(L, 0, 2.1, 0), 'busstop_plate');
  }

  // ---------- 灯火の切り替え ----------
  const C = new THREE.Color();
  const state = (t, it) => {
    // 主方向 (axis 0) は [0, HALF)、交差方向 (axis 1) は [HALF, CYCLE) の前半が青
    const u = (((t + it.offset) % CYCLE) + CYCLE) % CYCLE - (it.axis ? HALF : 0);
    const v = (u + CYCLE) % CYCLE;
    return v < GREEN ? 'green' : v < GREEN + YELLOW ? 'yellow' : 'red';
  };
  let last = '';
  function update(t) {
    let key = '';
    vehicle.forEach((it) => { key += state(t, it)[0]; });
    const flash = Math.floor(t * 2) % 2;
    peds.forEach((it) => {
      // 歩行者は、横断する道の車が止まっている間 (= もう一方の向きの青の間) が青
      const u = ((((t + it.offset) % CYCLE) + CYCLE) % CYCLE - (it.axis ? 0 : HALF) + CYCLE) % CYCLE;
      it.ps = u < GREEN - PED_FLASH ? 'g' : u < GREEN ? (flash ? 'g' : 'o') : 'r';
      key += it.ps;
    });
    if (key === last) return;
    last = key;
    for (const { c, m } of vLamps) {
      vehicle.forEach((it, i) => m.setColorAt(i, state(t, it) === c ? LAMP[c] : LAMP.off));
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    peds.forEach((it, i) => {
      pRed.setColorAt(i, it.ps === 'r' ? LAMP.red : C.set('#3a2422'));
      pGreen.setColorAt(i, it.ps === 'g' ? LAMP.green : C.set('#1d3530'));
    });
    if (pRed.instanceColor) pRed.instanceColor.needsUpdate = pGreen.instanceColor.needsUpdate = true;
  }
  update(0);

  console.info(`[detail] signal sites=${signalSites.length} vehicle signals=${vehicle.length} ped signals=${peds.length} bus stops=${stops.length}`);
  return { group, update, debug: { signalSites, vehicle, peds, stops } };
}
