// 6. 走る電車: 東海道線・横須賀線 (15 両) と貨物列車 (機関車 + コンテナ車)。
// 道筋 (props.json の rail.routes) は tools/build_props.py が線路をつないで作ったもの。旅客線は戸塚駅のホームで 30 秒止まる。
// rail_ext.json (tools/rail_ext.py) があれば、道筋を地図の端から先の駅 (今は北の東戸塚駅) まで延ばし、その駅にも止まる (止まる線は data/rail_ext_config.json)。
// 道筋が長くなって 1 本の電車が走りきる時間が周期を超えるので、同じ道筋に何本か (前の周期の電車) を同時に走らせる。
// 時刻は実際の時計 (Date.now) から決めるので、だれが見ても同じ所を走る (マルチプレイでもそろう)。
// 色は一般的な近郊電車の配色 (銀色の車体に、線ごとの帯の色)。特定の形式の再現ではない。
// 旅客線の発車の間隔は、同じ向きの東海道線と横須賀線がホームに着く時刻が半周期 (150 秒) ずれるようにそろえる (乗るときの待ち時間が最大約 2 分)。
// 乗り降り (ride.js) のために、時刻・位置の計算を返す (api)。
// URL: ?trainAt=秒 で時刻を固定 (静止画の撮影用)、?notrain で走らせない
import * as THREE from 'three';
import { canvasTexture } from './util.js';

const CAR = 20;            // 1 両の長さ (m)。build_props.py の CAR_LEN と同じ
const V = 22;              // 走る速さ (m/s = 約 80 km/h)
const ACC = 0.9;           // 加速・減速 (m/s²)
const DWELL = 30;          // 駅で止まる時間 (秒)
const LINES = {
  tokaido: { cars: 15, period: 300, offset: 0, band: ['#f08a1c', '#2e9a4c'] },   // オレンジと緑の帯
  yokosuka: { cars: 15, period: 300, offset: 140, band: ['#1f5fae', '#efe4c4'] }, // 青とクリームの帯
  freight: { cars: 20, period: 720, offset: 330 },
};

// 先頭の位置 (道筋の始点からの距離 m) を、出発からの経過秒 t から求める。stops = 止まる位置 (先頭の位置 m、昇順)。無ければ等速
const DB = V * V / (2 * ACC), TB = V / ACC;
function frontAt(t, stops) {
  let s0 = 0, t0 = 0;
  for (const stop of stops) {
    const tc = Math.max(0, stop - DB - s0) / V;
    if (t < t0 + tc) return s0 + V * (t - t0);
    let u = t - t0 - tc;
    if (u < TB) return stop - DB + V * u - ACC * u * u / 2;
    u -= TB;
    if (u < DWELL) return stop;
    u -= DWELL;
    if (u < TB) return stop + ACC * u * u / 2;
    s0 = stop + DB; t0 += tc + 2 * TB + DWELL;
  }
  return s0 + V * (t - t0);
}
// 各駅に着く時刻 (出発からの秒)
function arriveTimes(stops) {
  const out = [];
  let s0 = 0, t0 = 0;
  for (const stop of stops) {
    const tc = Math.max(0, stop - DB - s0) / V;
    out.push(t0 + tc + TB);
    s0 = stop + DB; t0 += tc + 2 * TB + DWELL;
  }
  return out;
}
// 先頭が道筋の終わりを過ぎ、最後尾も出きるまでの時間
function runTime(len, stops) {
  let t = 0;
  while (frontAt(t, stops) < len) t += 5;
  return t;
}
// 道筋 r に、延ばした線路 exts (rail_ext.json の routes のうち、この道筋のもの。始め・終わりに 1 つずつまで) をつなぐ。
// 止まる位置を { s, name } の列 (s の昇順) にして返す
function joinExt(r, exts) {
  const len = (pts) => { let L = 0; for (let k = 1; k < pts.length; k++) L += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][2] - pts[k - 1][2]); return L; };
  const seam = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  let p = r.p, stops = r.stop != null ? [{ s: r.stop, name: '戸塚' }] : [];
  const st = exts.find((e) => e.at === 'start'), en = exts.find((e) => e.at === 'end');
  if (st && st.p.length) {
    const shift = len(st.p) + seam(st.p[st.p.length - 1], p[0]);
    stops = [...(st.stops || []), ...stops.map((q) => ({ ...q, s: q.s + shift }))];
    p = [...st.p, ...p];
  }
  if (en && en.p.length) {
    const base = len(p) + seam(p[p.length - 1], en.p[0]);
    stops = [...stops, ...(en.stops || []).map((q) => ({ ...q, s: base + q.s }))];
    p = [...p, ...en.p];
  }
  return { p, stops: stops.sort((a, b) => a.s - b.s) };
}

function sideTexture(band) {
  return canvasTexture(512, 128, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, '#d9dcdf'); gr.addColorStop(0.5, '#c4c8cc'); gr.addColorStop(1, '#a9aeb3');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 128);
    if (band) { g.fillStyle = band[0]; g.fillRect(0, 86, 512, 7); g.fillStyle = band[1]; g.fillRect(0, 93, 512, 7); g.fillStyle = band[0]; g.fillRect(0, 12, 512, 4); }
    // 窓 (暗い帯) と、4 か所のドア
    g.fillStyle = '#2b3138'; g.fillRect(8, 30, 496, 36);
    for (let d = 0; d < 4; d++) {
      const x = 34 + d * 128;
      g.fillStyle = '#b8bcc0'; g.fillRect(x, 24, 40, 96);
      g.fillStyle = '#2b3138'; g.fillRect(x + 4, 30, 14, 32); g.fillRect(x + 22, 30, 14, 32);
      if (band) { g.fillStyle = band[0]; g.fillRect(x, 86, 40, 7); g.fillStyle = band[1]; g.fillRect(x, 93, 40, 7); }
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + 19.5, 24, 1, 96);
    }
    g.fillStyle = 'rgba(0,0,0,.18)'; for (let x = 0; x < 512; x += 3) g.fillRect(x, 104, 1, 24); // 下のほうのビード (すじ)
  });
}
function sideGlow() { // 夜に窓が光る所
  return canvasTexture(512, 128, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#f2f4ff'; g.fillRect(8, 30, 496, 36);
    for (let d = 0; d < 4; d++) { const x = 34 + d * 128; g.fillStyle = '#000'; g.fillRect(x, 24, 40, 96); g.fillStyle = '#f2f4ff'; g.fillRect(x + 4, 30, 14, 32); g.fillRect(x + 22, 30, 14, 32); }
  });
}
function endTexture(band) {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = '#c9ccd0'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#1c2026'; g.fillRect(10, 18, 108, 44);           // 前面の窓
    if (band) { g.fillStyle = band[0]; g.fillRect(0, 70, 128, 10); g.fillStyle = band[1]; g.fillRect(0, 80, 128, 8); }
    g.fillStyle = '#fff6d8'; g.fillRect(14, 96, 16, 8); g.fillRect(98, 96, 16, 8); // 前照灯
  });
}

// ホームに着く時刻の、周期の中での位置 (秒)。向き (north = 東京方面) と線ごと
const ARRIVE_PHASE = { north: { tokaido: 0, yokosuka: 150 }, south: { tokaido: 75, yokosuka: 225 } };

export function buildTrains(props, ext = null) {
  const group = new THREE.Group();
  group.name = 'detail_trains';
  const routes = (props.rail && props.rail.routes) || [];
  const Q = new URLSearchParams(location.search);
  if (!routes.length || Q.has('notrain')) return { group, emissive: [], update() {}, api: null };
  const fixed = Q.has('trainAt') ? +Q.get('trainAt') : null;

  // 道筋ごとの累積距離 (点は約 5 m おき)
  const R = routes.map((r0, i) => {
    const { p, stops } = joinExt(r0, ext && ext.routes ? ext.routes.filter((x) => x.route === i) : []);
    const r = { ...r0, p };
    const acc = [0];
    for (let k = 1; k < p.length; k++) acc.push(acc[k - 1] + Math.hypot(p[k][0] - p[k - 1][0], p[k][2] - p[k - 1][2]));
    const L = LINES[r.line];
    const dir = p[p.length - 1][2] < p[0][2] ? 'north' : 'south';   // z が減る = 北 = 横浜・東京方面
    const S = stops.map((st) => st.s), tArrs = arriveTimes(S);
    let offset = L.offset + i * 37;
    const ti = stops.findIndex((st) => st.name === '戸塚');    // 戸塚に着く時刻を、周期の中の決まった位置にそろえる
    if (ti >= 0 && ARRIVE_PHASE[dir][r.line] != null) offset = ARRIVE_PHASE[dir][r.line] - tArrs[ti];
    return { ...r, i, acc, len: acc[acc.length - 1], L, dir, offset, run: 0, stops, S, tArrs, m: 1 };
  });
  for (const r of R) { r.run = runTime(r.len + r.L.cars * CAR, r.S); r.m = Math.ceil(r.run / r.L.period); }
  const api = {
    R, CAR, DWELL, skew: 0, hold: null,    // skew: 時計をずらす秒、hold: 時刻を止める (どちらも確認用)
    now: () => api.hold != null ? api.hold : (fixed != null ? fixed : Date.now() / 1000) + api.skew,
    phase: (r, now) => { const T = r.L.period; return ((now - r.offset) % T + T) % T; },   // いちばん新しく出発した電車の、出発からの秒
    tOf: (r, j, now) => api.phase(r, now) + j * r.L.period,   // j 本前に出発した電車 (0〜r.m-1) の、出発からの秒
    front: (r, t) => t < r.run ? frontAt(t, r.S) : -1e9,
    speed: (r, t) => t < r.run ? (frontAt(t + 0.1, r.S) - frontAt(t, r.S)) / 0.1 : 0,
    // j 本前の電車の k 両目 (0 = 先頭) の中心と向き。道筋の外なら false
    carPose(r, k, now, outC, outQ, j = 0) { return api.carPoseT(r, k, api.tOf(r, j, now), outC, outQ); },
    // 出発から t 秒の電車の k 両目 (乗っている電車は出発の時刻で追う。j は周期が変わると次の電車を指すため)
    carPoseT(r, k, t, outC, outQ) {
      const center = api.front(r, t) - (k + 0.5) * CAR;
      if (!(center - CAR / 2 > 0 && center + CAR / 2 < r.len)) return false;
      at(r, center + CAR * 0.35, A); at(r, center - CAR * 0.35, B);
      outC.addVectors(A, B).multiplyScalar(0.5);
      look.lookAt(A, B, UP); outQ.setFromRotationMatrix(look);
      return true;
    },
    pointAt: (r, s, out) => at(r, s, out),
  };

  const at = (r, s, out) => { // 道筋の上の距離 s の点
    const a = r.acc;
    let lo = 0, hi = a.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] <= s) lo = m; else hi = m; }
    const t = Math.min(1, Math.max(0, (s - a[lo]) / ((a[hi] - a[lo]) || 1))), p = r.p[lo], q = r.p[hi];
    return out.set(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t);
  };

  const emissive = [];
  const body = new THREE.BoxGeometry(2.95, 2.75, CAR - 0.5).translate(0, 1.15 + 1.375, 0);   // 車体 (床下 1.15 m から)
  const under = new THREE.BoxGeometry(2.5, 0.85, CAR - 2).translate(0, 0.3 + 0.425, 0);       // 床下の機器・台車
  const darkMat = new THREE.MeshStandardMaterial({ color: '#2c2e30', roughness: 0.8 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#8f9398', roughness: 0.6, metalness: 0.3 });
  const glow = sideGlow();

  // 旅客線 (線ごとに 1 つの InstancedMesh)。貨物は機関車 1 両 + コンテナ車
  const slots = []; // {r, k (何両目), meshes: [[mesh, index], ...]}
  const meshes = {};
  const mk = (geo, mat, n, name) => { const m = new THREE.InstancedMesh(geo, mat, n); m.name = name; m.castShadow = m.receiveShadow = true; m.frustumCulled = false; group.add(m); return m; };
  for (const line of ['tokaido', 'yokosuka']) {
    const rs = R.filter(r => r.line === line);
    if (!rs.length) continue;
    const L = LINES[line], n = rs.reduce((t, r) => t + r.m, 0) * L.cars;
    const side = new THREE.MeshStandardMaterial({ map: sideTexture(L.band), emissiveMap: glow, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.35, metalness: 0.55 });
    side.userData.glow = 0.8; emissive.push(side);
    const end = new THREE.MeshStandardMaterial({ map: endTexture(L.band), roughness: 0.4, metalness: 0.4 });
    meshes[line] = { body: mk(body, [side, side, roofMat, darkMat, end, end], n, 'train_' + line), under: mk(under, darkMat, n, 'train_' + line + '_under') };
    let i = 0;
    for (const r of rs) for (let j = 0; j < r.m; j++) for (let k = 0; k < L.cars; k++, i++) slots.push({ r, j, k, list: [[meshes[line].body, i], [meshes[line].under, i]] });
  }
  const fr = R.filter(r => r.line === 'freight').flatMap((r) => Array.from({ length: r.m }, (_, j) => ({ r, j })));
  if (fr.length) {
    const nW = fr.length * (LINES.freight.cars - 1);
    const loco = mk(new THREE.BoxGeometry(2.9, 2.9, CAR - 1).translate(0, 1.2 + 1.45, 0),
      new THREE.MeshStandardMaterial({ color: '#4d6f93', roughness: 0.5, metalness: 0.3 }), fr.length, 'freight_loco');
    const deck = mk(new THREE.BoxGeometry(2.6, 0.35, CAR - 0.6).translate(0, 1.0, 0), darkMat, nW, 'freight_deck');
    const box = mk(new THREE.BoxGeometry(2.45, 2.5, 5.9).translate(0, 1.2 + 1.25, 0), new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.2 }), nW * 3, 'freight_containers');
    const lunder = mk(under, darkMat, fr.length + nW, 'freight_under');
    const CC = ['#b2563c', '#a24a33', '#4f7a55', '#3f6a96', '#b2563c', '#c9b98e'];
    const col = new THREE.Color();
    let li = 0, wi = 0;
    fr.forEach(({ r, j }, ri) => {
      slots.push({ r, j, k: 0, list: [[loco, ri], [lunder, li++]] });
      for (let k = 1; k < LINES.freight.cars; k++, wi++) {
        const list = [[deck, wi], [lunder, li++]];
        for (let c = 0; c < 3; c++) {
          const empty = ((wi * 7 + c * 3) % 11) === 0;   // ところどころ空き
          box.setColorAt(wi * 3 + c, col.set(CC[(wi * 5 + c * 7) % CC.length]));
          list.push([box, wi * 3 + c, (c - 1) * 6.3, empty]);
        }
        slots.push({ r, j, k, list });
      }
    });
    box.instanceColor.needsUpdate = true;
  }

  const M = new THREE.Matrix4(), Qn = new THREE.Quaternion(), S1 = new THREE.Vector3(1, 1, 1), S0 = new THREE.Vector3(0, 0, 0);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3(), O = new THREE.Vector3();
  const look = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
  const touched = new Set();

  function update() {
    const now = api.now();
    for (const sl of slots) {
      const r = sl.r, t = api.tOf(r, sl.j, now);
      const center = api.front(r, t) - (sl.k + 0.5) * CAR;
      const vis = center - CAR / 2 > 0 && center + CAR / 2 < r.len;   // 道筋の外 (地図の外) では消す
      if (vis) {
        at(r, center + CAR * 0.35, A); at(r, center - CAR * 0.35, B);     // 前後の台車の位置
        C.addVectors(A, B).multiplyScalar(0.5);
        look.lookAt(A, B, UP); Qn.setFromRotationMatrix(look);   // 局所 +Z が B → A (進む向き) を向く
      }
      for (const [m, i, dz, empty] of sl.list) {
        if (vis && !empty) {
          D.set(0, 0, dz || 0).applyQuaternion(Qn);
          M.compose(O.copy(C).add(D), Qn, S1);
        } else M.compose(C, Qn, S0);
        m.setMatrixAt(i, M);
        touched.add(m);
      }
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
    touched.clear();
  }
  update();
  console.info(`[detail] trains: routes=${R.length} cars=${slots.length}`);
  return { group, emissive, update, api };
}
