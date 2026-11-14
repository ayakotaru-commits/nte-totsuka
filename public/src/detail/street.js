// 信号機・歩行者用信号・バス停
// 配置は tools/build_props.py が計算した data/props.json (signals / pedSignals / busStops)。
// 灯火の切り替え (各信号の axis と offset から) はここで毎フレーム行う。
import * as THREE from 'three';
import { canvasTexture } from './util.js';

// 信号の1周期 (秒): 主方向 青 → 黄 → 全赤 → 交差方向 青 → 黄 → 全赤
const GREEN = 22, YELLOW = 3, ALLRED = 2, HALF = GREEN + YELLOW + ALLRED, CYCLE = HALF * 2;
const PED_FLASH = 5; // 歩行者用は青の終わりに点滅
const LAMP = { off: new THREE.Color('#2a2c2e'), green: new THREE.Color('#25e0b4'), yellow: new THREE.Color('#ffb21a'), red: new THREE.Color('#ff3020') };

export function buildStreet(props) {
  const group = new THREE.Group();
  group.name = 'detail_street';
  const vehicle = props.signals, peds = props.pedSignals, stops = props.busStops;

  // ---------- 形 ----------
  const M = new THREE.Matrix4(), L = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  // 局所座標: +Z = 正面 (f), +X = 正面に向かって左手 → 車両用では車道の中央側
  const frame = (it) => M.compose(P.set(it.x, it.y, it.z), Q.setFromAxisAngle(Y, it.yaw), S.set(1, 1, 1));
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

  // ---------- バス停 ----------
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

  console.info(`[detail] vehicle signals=${vehicle.length} ped signals=${peds.length} bus stops=${stops.length}`);
  return { group, update, debug: { vehicle, peds, stops } };
}
