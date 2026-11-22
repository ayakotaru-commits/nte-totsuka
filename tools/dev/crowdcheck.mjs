// 歩く人の動き (public/src/crowdsim.js) の数字を確かめる。three.js もブラウザも要らない: node tools/dev/crowdcheck.mjs
import fs from 'node:fs';
import { CrowdSim, PRESET, REF_SUMW, pedState } from '../../public/src/crowdsim.js';

const props = JSON.parse(fs.readFileSync('public/data/props.json', 'utf8'));
const city = JSON.parse(fs.readFileSync('public/data/city.json', 'utf8'));
const ok = []; const ng = [];
const check = (name, cond, extra = '') => { (cond ? ok : ng).push(name); console.log((cond ? 'OK  ' : 'NG  ') + name + (extra ? '  ' + extra : '')); };

// 建物の中に入っていないか (輪郭の中の点。穴は無視)
const bs = city.buildings.filter((b) => !(b.minH > 2) && !b.hide).map((b) => {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of b.outer) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { o: b.outer, x0, z0, x1, z1 };
});
const inside = (x, z) => { for (const b of bs) { if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue; let c = false; const o = b.o; for (let i = 0, j = o.length - 1; i < o.length; j = i++) { if ((o[i][1] > z) !== (o[j][1] > z) && x < (o[j][0] - o[i][0]) * (z - o[i][1]) / (o[j][1] - o[i][1]) + o[i][0]) c = !c; } if (c) return true; } return false; };

const T = JSON.parse(fs.readFileSync('public/data/terrain.json', 'utf8'));
const ground = (x, z) => { // public/src/terrain.js の H() と同じ三角形補間 + GROUND_LIFT
  const fx = Math.max(0, Math.min(T.nx - 1.0001, (x - T.minX) / T.step)), fz = Math.max(0, Math.min(T.nz - 1.0001, (z - T.minZ) / T.step));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, g = (a, b) => T.h[b * T.nx + a] / 100;
  const h00 = g(i, j), h10 = g(i + 1, j), h01 = g(i, j + 1), h11 = g(i + 1, j + 1);
  return (u >= v ? h00 + u * (h10 - h00) + v * (h11 - h10) : h00 + v * (h01 - h00) + u * (h11 - h01)) + 0.18;
};
const OPT = { ground, peds: props.pedSignals, busStops: props.busStops };
const st = props.crowd.hubs.st[0] || [0, 0];
const SPOTS = { 駅前: st, スタート近く: [-306, 1426], 住宅街: [-230, 250], 国道: [232, 133] };

// 出やすさの合計 (REF_SUMW の決め方)
{
  const sim = new CrowdSim(props.crowd, { ...OPT, cap: 120, radius: 130 });
  for (const [n, [x, z]] of Object.entries(SPOTS)) { sim.refresh(x, z, true); console.log(`出やすさ合計 ${n}: ${sim.sumW.toFixed(0)} (候補 ${sim.cand.length})`); }
  sim.refresh(st[0], st[1], true);
  check('REF_SUMW が駅前の合計の 8〜1.3 倍', sim.sumW * 0.8 < REF_SUMW && REF_SUMW < sim.sumW * 1.3, `駅前 ${sim.sumW.toFixed(0)}, REF ${REF_SUMW}`);
}

const frac = {};
for (const preset of ['朝', '昼', '夕方', '夜']) {
  const sim = new CrowdSim(props.crowd, { ...OPT, cap: 120, radius: 130, seed: 7 });
  const [cx, cz] = st; let deckN = 0, jumpN = 0, nan = 0, insideN = 0, tot = 0, maxD = 0, minV = 9, maxV = 0, toSt = 0, mv = 0;
  const prev = new Map();
  for (let t = 0; t < 600; t++) { // 60 秒 (0.1 秒刻み)
    sim.update(0.1, cx, cz, 0, -1, cx + 3, cz + 3, preset);
    if (t > 50) for (const p of sim.people) {
      tot++; if (!Number.isFinite(p.x + p.z + p.yaw + p.phase)) nan++;
      if (!sim.lanes[p.lane].y && inside(p.x, p.z)) insideN++;
      if (sim.lanes[p.lane].y) deckN++;
      const q = prev.get(p.id); if (q && Math.abs(p.y - q) > 0.6) jumpN++; prev.set(p.id, p.y);
      maxD = Math.max(maxD, Math.hypot(p.x - cx, p.z - cz));
      minV = Math.min(minV, p.v); maxV = Math.max(maxV, p.v);
    }
  }
  // 駅へ向かう割合: 1 秒後の位置の差
  const before = sim.people.map((p) => ({ id: p.id, d: sim.stationDist(p.x, p.z) }));
  sim.update(1, cx, cz, 0, -1, cx + 3, cz + 3, preset);
  for (const b of before) { const p = sim.people.find((q) => q.id === b.id); if (!p) continue; mv++; if (sim.stationDist(p.x, p.z) < b.d) toSt++; }
  const n = sim.people.length, types = [0, 0, 0, 0, 0]; sim.people.forEach((p) => types[p.type]++);
  console.log(`[${preset}] 人数 ${n} (目標 ${sim.target()})  駅へ向かう ${(100 * toSt / Math.max(1, mv)).toFixed(0)}%  種類 ${types}  駅へ入った ${sim.stats.entered}  乗り換え ${sim.stats.joins}  引き返し ${sim.stats.turns}  出た ${sim.stats.spawned} 消えた ${sim.stats.removed}  速さ ${minV.toFixed(2)}〜${maxV.toFixed(2)}  最も遠い ${maxD.toFixed(0)} m`);
  console.log(`      デッキ・階段の上の延べ人数 ${deckN}/${tot}  信号待ち ${sim.stats.waits}  バス停で待つ ${sim.stats.bus}  スマホ ${sim.stats.phone}  立ち話 ${sim.stats.chats} 組`);
  check(`${preset}: NaN なし`, nan === 0);
  check(`${preset}: 1 コマで高さが 0.6 m 以上跳ぶ人が 0.1% 未満 (別の階へ飛ばない)`, jumpN / Math.max(1, tot) < 0.001, `${jumpN}/${tot}`);
  check(`${preset}: 建物の中に入った人 0.5% 未満`, insideN / Math.max(1, tot) < 0.005, `${insideN}/${tot}`);
  check(`${preset}: 人数が目標付近`, Math.abs(n - sim.target()) <= 3);
  check(`${preset}: 半径 150 m の外に居ない`, maxD < 150.5);
  check(`${preset}: 速さが 0〜2.2 m/s`, minV >= 0 && maxV < 2.2);
  frac[preset] = toSt / Math.max(1, mv);
}

// 流れ: 朝は夕方より駅へ向かう人の割合が高い (駅へ入って消える人がいるので、割合そのものは半分前後になる)
check('朝の駅へ向かう人の割合が夕方より 8 ポイント以上高い', frac['朝'] - frac['夕方'] > 0.08, `朝 ${(100 * frac['朝']).toFixed(0)}% / 夕方 ${(100 * frac['夕方']).toFixed(0)}%`);

// 人数: 時間帯・場所ごと
{
  const row = [];
  for (const preset of ['朝', '昼', '夕方', '夜']) {
    const r = [];
    for (const [n, [x, z]] of Object.entries(SPOTS)) { const s = new CrowdSim(props.crowd, { ...OPT, cap: 120, radius: 130 }); s.preset = preset; s.refresh(x, z, true); r.push(`${n} ${s.target()}`); }
    row.push(`${preset}: ${r.join(' / ')}`);
  }
  console.log('目標人数\n  ' + row.join('\n  '));
  const dayN = (() => { const s = new CrowdSim(props.crowd, { ...OPT, cap: 120, radius: 130 }); s.preset = '夕方'; s.refresh(st[0], st[1], true); return s.target(); })();
  const nightN = (() => { const s = new CrowdSim(props.crowd, { ...OPT, cap: 120, radius: 130 }); s.preset = '夜'; s.refresh(st[0], st[1], true); return s.target(); })();
  check('夕方の駅前は夜より人が多い', dayN > nightN, `${dayN} > ${nightN}`);
}

// プレイヤーが近づくと減速してよける・押さない
{
  const sim = new CrowdSim(props.crowd, { ...OPT, cap: 30, radius: 130, seed: 3 });
  sim.update(0.1, st[0], st[1], 0, -1, 1e6, 1e6, '昼');
  const p = sim.people.find((q) => !q.hold && q.lane >= 0 && sim.lanes[q.lane].k !== 't'); const x0 = p.x, z0 = p.z;
  for (let i = 0; i < 20; i++) sim.update(0.05, st[0], st[1], 0, -1, p.x + 0.4, p.z, '昼');
  check('プレイヤーが 0.4 m に来ても人は動き続ける (止まらない)', p.v > 0.3, `v=${p.v.toFixed(2)}`);
  check('よけた (プレイヤーから遠ざかる向きにずれた)', Math.hypot(p.ax, p.az) > 0.05, `ずれ ${Math.hypot(p.ax, p.az).toFixed(2)} m`);
}

// 信号: 信号のある交差点では、赤の間は渡らずに待ち、青になってから渡る
{
  const sg = props.pedSignals[0], sim = new CrowdSim(props.crowd, { ...OPT, cap: 120, radius: 130, seed: 9 });
  let bad = 0, joined = 0;
  const orig = sim.join.bind(sim);
  sim.join = (p, c, ex, ez) => { if (p.pending) { joined++; const w = p.pending; if (pedState(sim.clock, w.sig) !== 'g' && sim.time - w.since <= 60) bad++; } orig(p, c, ex, ez); };
  for (let t = 0; t < 3000; t++) sim.update(0.1, sg.x, sg.z, 0, -1, sg.x + 3, sg.z, '夕方', t * 0.1);
  check('信号のある所で、信号待ちをする人がいる', sim.stats.waits > 0, `待った ${sim.stats.waits} 人 (5 分)`);
  check('待った人は、青になってから (または 60 秒待った後に) 渡る', joined > 0 && bad === 0, `渡った ${joined} 人・早く渡った ${bad}`);
}

// ワープ: 80 m 以上動くと入れ替える
{
  const sim = new CrowdSim(props.crowd, { ...OPT, cap: 60, radius: 130, seed: 5 });
  sim.update(0.1, st[0], st[1], 0, -1, st[0], st[1], '昼');
  const n0 = sim.people.length;
  sim.update(0.1, -306, 1426, 0, -1, -306, 1426, '昼');
  check('ワープ後に新しい場所の周りへ人が出る', sim.people.every((p) => Math.hypot(p.x + 306, p.z - 1426) < 150) && sim.people.length > 0, `${n0} → ${sim.people.length}`);
}
console.log(`\n${ok.length} OK / ${ng.length} NG`);
process.exit(ng.length ? 1 : 0);
