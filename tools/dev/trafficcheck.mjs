// 走る車の動き (public/src/trafficsim.js) の数字を確かめる。three.js もブラウザも要らない: node tools/dev/trafficcheck.mjs
import fs from 'node:fs';
import { TrafficSim, REF_SUMW, vehState, TPRESET } from '../../public/src/trafficsim.js';

const props = JSON.parse(fs.readFileSync('public/data/props.json', 'utf8'));
const T = JSON.parse(fs.readFileSync('public/data/terrain.json', 'utf8'));
const ground = (x, z) => {
  const fx = Math.max(0, Math.min(T.nx - 1.0001, (x - T.minX) / T.step)), fz = Math.max(0, Math.min(T.nz - 1.0001, (z - T.minZ) / T.step));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, g = (a, b) => T.h[b * T.nx + a] / 100;
  const h00 = g(i, j), h10 = g(i + 1, j), h01 = g(i, j + 1), h11 = g(i + 1, j + 1);
  return (u >= v ? h00 + u * (h10 - h00) + v * (h11 - h10) : h00 + v * (h01 - h00) + u * (h11 - h01)) + 0.18;
};
const OPT = { ground, signals: props.signals };
const ok = [], ng = [];
const check = (name, cond, extra = '') => { (cond ? ok : ng).push(name); console.log((cond ? 'OK  ' : 'NG  ') + name + (extra ? '  ' + extra : '')); };
const mk = (o = {}) => new TrafficSim(props.traffic, { ...OPT, cap: 40, radius: 130, seed: 11, ...o });

const SPOTS = { 駅前: [24, 47], 国道: [232, 133], 住宅街: [-230, 250], スタート近く: [-306, 1426] };

{ // 左側通行: 向かい合う車線 (l と l^1) は、進む向きの右側にある
  const s = mk(); let pairs = 0, good = 0;
  for (let l = 0; l < s.lanes.length; l += 2) {
    const A = s.lanes[l], B = s.lanes[l + 1]; if (!B || A.a !== B.b) continue;
    const mid = A.len / 2, o = s.at(A, mid), oB = s.at(B, B.len - mid);   // 同じ場所あたり (B は逆向き)
    const dx = oB[0] - o[0], dz = oB[1] - o[1], left = [o[3], -o[2]];       // x = 東・z = 南: 東へ進むときの左 = 北 = (dz, -dx)
    pairs++; if (dx * left[0] + dz * left[1] < 0) good++;
  }
  check('車線の組の 9 割以上で、向かいの車線が進む向きの右にある (= 自分は左側)', good / Math.max(1, pairs) > 0.9, `${good}/${pairs}`);
}

{ // 信号の割り当て
  const s = mk();
  const atSig = s.lanes.filter((L) => s.signals.some((g) => Math.hypot(g.x - s.nodes[L.b][0], g.z - s.nodes[L.b][1]) < 16));
  const matched = atSig.filter((L) => L.sig).length;
  console.log(`車線 ${s.lanes.length} 本、交差点 ${s.nodes.length} 、信号の近くで終わる車線 ${atSig.length} 本のうち、信号の組が決まった車線 ${matched} 本`);
  check('信号の近く (16 m 以内) で終わる車線のほとんどに、信号の組が決まる', matched / Math.max(1, atSig.length) > 0.85, `${matched}/${atSig.length}`);
  for (const [n, [x, z]] of Object.entries(SPOTS)) { const q = mk(); q.refresh(x, z, true); console.log(`出やすさ合計 ${n}: ${q.sumW.toFixed(0)} (候補 ${q.cand.length})`); }
  const q = mk(); q.refresh(232, 133, true);
  check('REF_SUMW が国道の合計の 0.6〜1.3 倍', REF_SUMW > q.sumW * 0.6 && REF_SUMW < q.sumW * 1.3, `国道 ${q.sumW.toFixed(0)}, REF ${REF_SUMW}`);
}

for (const preset of ['朝', '昼', '夕方', '夜']) {
  const sim = mk({ cap: 40 }); const [cx, cz] = SPOTS.国道;
  let nan = 0, overlap = 0, tot = 0, maxD = 0, maxV = 0, stopped = 0, redStops = 0, jump = 0;
  const prev = new Map();
  for (let t = 0; t < 1200; t++) { // 120 秒
    sim.update(0.1, cx, cz, 0, -1, 1e6, 1e6, preset, t * 0.1);
    if (t > 100) {
      for (const c of sim.cars) {
        tot++; if (!Number.isFinite(c.x + c.z + c.y + c.yaw + c.v)) nan++;
        maxD = Math.max(maxD, Math.hypot(c.x - cx, c.z - cz)); maxV = Math.max(maxV, c.v); if (c.v < 0.1) stopped++;
        const q = prev.get(c.id); if (q && Math.hypot(c.x - q[0], c.z - q[1]) > 1.2) jump++; prev.set(c.id, [c.x, c.z]);
      }
      for (const L of sim.lanes) for (let i = 1; i < L.car.length; i++) { const a = L.car[i - 1], b = L.car[i]; if (a.s - b.s - (a.len + b.len) / 2 < -0.3) overlap++; }
    }
  }
  console.log(`[${preset}] 台数 ${sim.cars.length} (目標 ${sim.target()})  出た ${sim.stats.spawned} 消えた ${sim.stats.removed}  交差点を通った ${sim.stats.turns}  引き返し ${sim.stats.uturns}  最高 ${maxV.toFixed(1)} m/s  止まっている割合 ${(100 * stopped / Math.max(1, tot)).toFixed(0)}%  最も遠い ${maxD.toFixed(0)} m`);
  check(`${preset}: NaN なし`, nan === 0);
  check(`${preset}: 同じ車線の前の車と重ならない (延べ 0.15% 未満。合流で少し重なる)`, overlap / Math.max(1, tot) < 0.0015, `${overlap}/${tot}`);
  check(`${preset}: 1 コマで 1.2 m 以上飛ぶ車が 0.2% 未満`, jump / Math.max(1, tot) < 0.002, `${jump}/${tot}`);
  check(`${preset}: 速さが 14 m/s 以下 (50 km/h)`, maxV < 14);
  check(`${preset}: 半径 160 m の外に居ない`, maxD < 160);
  check(`${preset}: 台数が目標付近`, Math.abs(sim.cars.length - sim.target()) <= 4);
}

{ // 時間帯と場所ごとの台数
  const rows = [];
  for (const preset of ['朝', '昼', '夕方', '夜']) { const r = []; for (const [n, [x, z]] of Object.entries(SPOTS)) { const s = mk(); s.preset = preset; s.refresh(x, z, true); r.push(`${n} ${s.target()}`); } rows.push(`${preset}: ${r.join(' / ')}`); }
  console.log('目標台数\n  ' + rows.join('\n  '));
}

{ // 信号: 赤の間は停止線の手前で止まり、青になると動き出す
  const sim = mk({ cap: 40, seed: 5 });
  const sg = props.signals[0]; let nearRedMoving = 0, atRed = 0;
  for (let t = 0; t < 4000; t++) {
    sim.update(0.1, sg.x, sg.z, 0, -1, 1e6, 1e6, '夕方', t * 0.1);
    for (const c of sim.cars) {
      const L = sim.lanes[c.lane]; if (!L.sig) continue;
      const st = vehState(sim.clock, L.sig), toLine = L.len - 3 - c.s;
      const vv = ((((sim.clock + L.sig.offset) % 54) + 54) % 54 - (L.sig.axis ? 27 : 0) + 54) % 54, intoRed = vv - 25;   // 赤になってからの秒数 (一周 54 秒。青 22・黄 3 の後が赤)
      if (st === 'red' && intoRed > 4 && toLine > 0 && toLine < 2 && c.v > 3) nearRedMoving++;
      if (st === 'red' && toLine > -1 && toLine < 12 && c.v < 0.2) atRed++;
    }
  }
  check('赤になって 4 秒たった後、停止線の手前 2 m に速く走っている車がいない (黄のうちに入った車は除く)', nearRedMoving === 0, `${nearRedMoving}`);
  check('赤信号で停止線の手前に止まっている車がいる', atRed > 0, `${atRed} 延べ台数`);
}

{ // プレイヤーが前にいると止まる
  const sim = mk({ cap: 30, seed: 3 });
  const [cx, cz] = SPOTS.国道;
  for (let t = 0; t < 300; t++) sim.update(0.1, cx, cz, 0, -1, 1e6, 1e6, '昼', t * 0.1);
  const c = sim.cars.find((q) => q.v > 3 && !sim.lanes[q.lane].sig);
  if (!c) check('プレイヤーの前で止まる車の確認 (走っている車が見つからず)', false);
  else {
    const o = sim.at(sim.lanes[c.lane], c.s); const px = o[0] + o[2] * 9, pz = o[1] + o[3] * 9;
    let minD = 1e9;
    for (let t = 0; t < 100; t++) { sim.update(0.05, cx, cz, 0, -1, px, pz, '昼', 40 + t * 0.05); const k = sim.cars.find((q) => q.id === c.id); if (!k) break; const o2 = sim.at(sim.lanes[k.lane], k.s); minD = Math.min(minD, Math.hypot(k.x - px, k.z - pz)); }
    check('プレイヤーが前 9 m にいても、車は 1.5 m 以内に近づかない', minD > 1.5, `最接近 ${minD.toFixed(1)} m`);
  }
}

{ // ワープ
  const sim = mk({ cap: 30, seed: 5 });
  sim.update(0.1, ...SPOTS.国道, 0, -1, 1e6, 1e6, '昼', 0);
  sim.update(0.1, ...SPOTS.駅前, 0, -1, 1e6, 1e6, '昼', 0.1);
  check('ワープ後に新しい場所の周りへ車が出る', sim.cars.every((c) => Math.hypot(c.x - SPOTS.駅前[0], c.z - SPOTS.駅前[1]) < 160) && sim.cars.length > 0, `${sim.cars.length} 台`);
}
console.log(`\n${ok.length} OK / ${ng.length} NG`);
process.exit(ng.length ? 1 : 0);
