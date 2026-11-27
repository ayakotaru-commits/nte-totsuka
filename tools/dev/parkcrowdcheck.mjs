// 千葉ドリームランド 段階 5: 園内の人 (通り道・動き・観客)・地図の印・ショーの案内の数字を確かめる。three.js もブラウザも要らない: node tools/dev/parkcrowdcheck.mjs
// 確かめること: 通り道が敷地の中にあり建物をよけている・つながっている / 園内の人が出て、敷地の外・建物の中に出ない・NaN なし・種類の割合 (スーツなし) /
//   時間帯で人数が変わる / 同じ乱数なら同じ結果 / 観客 (パレードの道の両側・湖のまわりに、始まる前から集まり、終わると減る。顔は道・湖へ向く) /
//   ショーの案内 (時計から次の開始までの秒・開催中の残り) / 地図の印 (道の上・建物の外・敷地の中)
import fs from 'node:fs';
import { CrowdSim, PARK_MIX, REF_SUMW, parkObstacles } from '../../public/src/crowdsim.js';
import { parkSchedule, viewWant, infoLine, fmtMin, makeViewSlots } from '../../public/src/parkinfo.js';
import { paradeRoute, paradeSeconds } from '../../public/src/detail/parkroute.js';

const park = JSON.parse(fs.readFileSync('public/data/park.json', 'utf8'));
const props = JSON.parse(fs.readFileSync('public/data/props.json', 'utf8'));
const ok = [], ng = [];
const check = (name, cond, extra = '') => { (cond ? ok : ng).push(name); console.log((cond ? 'OK  ' : 'NG  ') + name + (extra ? '  ' + extra : '')); };

const inPoly = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < (p[j][0] - p[i][0]) * (z - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };
const segD = (x, z, a, b) => { const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez || 1e-9, t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / l2)); return Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t); };
const polyD = (x, z, p) => { let d = 1e9; for (let i = 0, j = p.length - 1; i < p.length; j = i++) d = Math.min(d, segD(x, z, p[j], p[i])); return d; };
const inBuilding = (x, z, m = 0) => park.gen.buildings.some((b) => { const dx = x - b.x, dz = z - b.z; if (Math.abs(dx) > 40 || Math.abs(dz) > 40) return false; const c = Math.cos(b.yaw), s = Math.sin(b.yaw), u = dx * c - dz * s, v = dx * s + dz * c; return Math.abs(u) < b.w / 2 + m && Math.abs(v) < b.d / 2 + m; });
const nearSite = (x, z, m) => inPoly(x, z, park.site) || polyD(x, z, park.site) < m;

// ---- 通り道 ----
const lanes = park.crowd.lanes;
check('園内の通り道がある (k = p)', lanes.length >= 80 && lanes.every((l) => l.k === 'p' && l.p.length >= 4), `${lanes.length} 本`);
let pts = 0, outSite = 0, inB = 0;
for (const l of lanes) for (let i = 0; i < l.p.length; i += 2) {
  pts++;
  if (!nearSite(l.p[i], l.p[i + 1], 12)) outSite++;   // 駅からゲートへの道の入口 (敷地の外 約 70 m) は含まない: 敷地から 12 m 以内かを数える
  if (inBuilding(l.p[i], l.p[i + 1], 0.3)) inB++;
}
check('通り道の点は敷地の中 (駅からゲートへの道の外の部分を除く)', outSite / pts < 0.03, `外 ${outSite}/${pts}`);
check('通り道の点は建物の中に入っていない', inB === 0, `建物の中 ${inB}/${pts}`);
const ends = []; lanes.forEach((l, i) => { ends.push([i, l.p[0], l.p[1]], [i, l.p[l.p.length - 2], l.p[l.p.length - 1]]); });
const iso = ends.filter((e) => !ends.some((o) => o[0] !== e[0] && Math.hypot(o[1] - e[1], o[2] - e[2]) < 9));
check('つながらない端 (行き止まり) は全体の 2 割未満', iso.length / ends.length < 0.2, `${iso.length}/${ends.length}`);

// ---- 人の動き (街の通り道と合わせた状態 = ゲームと同じ) ----
const crowd = { ...props.crowd, lanes: props.crowd.lanes.concat(park.crowd.lanes), parkHubs: park.crowd.hubs };
const ground = () => -9.3;
const OPT = { ground, peds: props.pedSignals, busStops: props.busStops };
const pl = park.ellipses['サンライズ・プラザ'].center, gate = park.gate.at, av = park.paths.find((p) => p.name === 'ネオン・アベニュー');
const SPOTS = { プラザ: pl, ゲート: [gate[0] + 30, gate[1] + 30], ターボ・ダウンタウン: [31192, -25694], 湖の北: [31510, -25548], スイート・ヒル: [31821, -25396] };

{
  const sim = new CrowdSim(crowd, { ...OPT, cap: 120, radius: 130 });
  for (const [n, [x, z]] of Object.entries(SPOTS)) { sim.refresh(x, z, true); console.log(`出やすさ合計 ${n}: 園内 ${sim.sumPW.toFixed(0)} / 街 ${sim.sumW.toFixed(0)} (候補 ${sim.cand.length})`); }
  sim.refresh(pl[0], pl[1], true);
  check('プラザでは園内の出やすさの合計が REF_SUMW の 0.5 倍以上 (人が多い所)', sim.sumPW > REF_SUMW * 0.5, `${sim.sumPW.toFixed(0)}`);
  sim.refresh(31192, -25694, true);
  check('街の通り道は園の近くに無い (街の合計 0)', sim.sumW === 0);
}

const run = (preset, [cx, cz], seconds, seed = 3) => {
  const sim = new CrowdSim(crowd, { ...OPT, cap: 120, radius: 130, seed });
  let nan = 0, outS = 0, inBd = 0, tot = 0, jump = 0, maxD = 0;
  const prev = new Map();
  for (let t = 0; t < seconds * 10; t++) {
    sim.update(0.1, cx, cz, 0, 1, cx + 40, cz + 40, preset);
    if (t > 50) for (const p of sim.people) {
      tot++; if (!Number.isFinite(p.x + p.z + p.yaw + p.phase + p.y)) nan++;
      if (!nearSite(p.x, p.z, 4)) outS++;
      if (inBuilding(p.x, p.z, -0.2)) inBd++;
      const q = prev.get(p.id); if (q && Math.hypot(p.x - q[0], p.z - q[1]) > 1.0) jump++; prev.set(p.id, [p.x, p.z]);
      maxD = Math.max(maxD, Math.hypot(p.x - cx, p.z - cz));
    }
  }
  const types = [0, 0, 0, 0, 0]; sim.people.forEach((p) => types[p.type]++);
  return { sim, n: sim.people.length, tgt: sim.target(), nan, outS, inBd, tot, jump, types, maxD };
};

const R = {};
for (const preset of ['朝', '昼', '夕方', '夜']) {
  const r = run(preset, pl, 90);
  R[preset] = r;
  console.log(`[${preset}] 人数 ${r.n} (目標 ${r.tgt})  種類 ${r.types}  敷地の外 ${r.outS} 建物の中 ${r.inBd}  1 コマで 1 m 以上跳ぶ ${r.jump}/${r.tot}  引き返し ${r.sim.stats.turns} 乗り換え ${r.sim.stats.joins} スマホ ${r.sim.stats.phone} 立ち話 ${r.sim.stats.chats} 組  最も遠い ${r.maxD.toFixed(0)} m`);
  check(`${preset}: NaN なし`, r.nan === 0);
  check(`${preset}: 敷地の外 (4 m 超) に出ない`, r.outS === 0, `${r.outS}/${r.tot}`);
  check(`${preset}: 建物の中に入らない`, r.inBd === 0, `${r.inBd}/${r.tot}`);
  check(`${preset}: 1 コマで 1 m 以上跳ばない (道の乗り換えでも)`, r.jump / Math.max(1, r.tot) < 0.002, `${r.jump}/${r.tot}`);
  check(`${preset}: スーツの人 (種類 1) がいない・子どもか高齢者がいる`, r.types[1] === 0 && r.types[3] + r.types[4] > 0, `${r.types}`);
}
check('昼のプラザで人が 20 人以上いる', R.昼.n >= 20, `${R.昼.n}`);
check('夕方は朝より多い (園内の人の多さ 夕方 1.0 > 朝 0.5)', R.夕方.n > R.朝.n, `夕方 ${R.夕方.n} / 朝 ${R.朝.n}`);
for (const [name, c] of Object.entries(SPOTS)) {
  const r = run('昼', c, 60);
  check(`${name}の近くで人が出る (昼)`, r.n >= 5 && r.nan === 0 && r.outS === 0 && r.inBd === 0, `${r.n} 人`);
}
{
  const a = run('昼', pl, 40, 11), b = run('昼', pl, 40, 11);
  const sig = (r) => r.sim.people.map((p) => `${p.id}:${p.x.toFixed(2)},${p.z.toFixed(2)}`).join('|');
  check('同じ乱数の種なら同じ結果になる (園内)', sig(a) === sig(b) && a.n > 0);
}

// ---- ショーの案内 ----
const route = paradeRoute(park), PS = paradeSeconds(park, route.length - 1), S = park.show;
check('パレードが道を通りきる秒数は 200〜240 秒', PS > 200 && PS < 240, `${PS.toFixed(1)}`);
{
  const s0 = parkSchedule(park, 0, PS);
  check('時計 0 秒: パレードまで 20 秒・花火まで 330 秒・次はパレード', s0.parade.startsIn === S.parade.start && s0.fw.startsIn === S.fireworks.start && s0.next === 'parade' && !s0.parade.on && !s0.fw.on, JSON.stringify(s0.parade));
  const s1 = parkSchedule(park, S.parade.start + 30, PS);
  check('パレードの 30 秒後: 開催中・残り = 全体 − 30', s1.parade.on && Math.abs(s1.parade.left - (PS - 30)) < 1e-6 && Math.abs(s1.parade.t - 30) < 1e-6, JSON.stringify(s1.parade));
  const s2 = parkSchedule(park, S.parade.start + PS + 10, PS);
  check('パレードの終了後は次の周期まで (cycle − 経過)', !s2.parade.on && Math.abs(s2.parade.startsIn - (S.cycle - PS - 10)) < 1e-6 && s2.next === 'fw', JSON.stringify(s2.parade));
  const s3 = parkSchedule(park, S.cycle * 5 + S.fireworks.start + 10, PS);
  check('周期をまたいでも同じ (花火の 10 秒後 = 開催中)', s3.fw.on && Math.abs(s3.fw.t - 10) < 1e-6);
  const s4 = parkSchedule(park, -5, PS);
  check('時計が負でも周期の中に入る (−5 秒 = 595 秒)', Math.abs(s4.phase - 595) < 1e-9);
  check('表示の文字: 開催前', infoLine(s0).text === `パレードまで ${fmtMin(20)}　花火まで ${fmtMin(330)}` && !infoLine(s0).on && !infoLine(s0).soon === false, infoLine(s0).text);
  check('表示の文字: 開催中 (パレード・花火)', infoLine(s1).on && infoLine(s1).text.includes('パレード開催中') && infoLine(s3).text.includes('花火 開催中'), infoLine(s1).text);
  check('表示の文字: 始まる 60 秒前から soon', infoLine(parkSchedule(park, S.fireworks.start - 50, PS)).soon && !infoLine(parkSchedule(park, 500, PS)).soon);   // 500 秒 = 花火の後〜次のパレードの 60 秒前までの何も無い時刻 (パレード 20〜240・城のライトアップ 245〜320・花火 330〜458)
  check('fmtMin', fmtMin(65) === '1:05' && fmtMin(0) === '0:00' && fmtMin(59.2) === '1:00');
}

// ---- 観客 ----
const slots = makeViewSlots(park, route);
{
  const a = JSON.stringify(makeViewSlots(park, route));
  check('観客の場所がある (パレード・花火の両方)。何度作っても同じ', slots.length > 600 && slots.some((s) => s.kind === 0) && slots.some((s) => s.kind === 1) && a === JSON.stringify(slots), `${slots.length} か所 (パレード ${slots.filter((s) => !s.kind).length}・花火 ${slots.filter((s) => s.kind).length})`);
  check('観客の場所は敷地の中で、建物の中でない', slots.every((s) => inPoly(s.x, s.z, park.site) && !inBuilding(s.x, s.z)), `${slots.filter((s) => !inPoly(s.x, s.z, park.site) || inBuilding(s.x, s.z)).length} か所が違反`);
  const lake = park.ellipses['ムーンレイク'];
  check('湖の中に立たない', slots.every((s) => Math.hypot((s.x - lake.center[0]) / lake.rx, (s.z - lake.center[1]) / lake.rz) > 1.02));
  // 顔: パレードは道の方、花火は湖の中心の方 (内積 > 0.5)
  let bad = 0;
  for (const s of slots) {
    const f = [Math.sin(s.yaw), Math.cos(s.yaw)];
    if (s.kind === 2) { const lv = park.gen.rides.live, cl = Math.cos(lv.yaw), sl = Math.sin(lv.yaw), zf = lv.stage.back + lv.stage.d, st = [lv.x + zf * sl, lv.z + zf * cl], d = [st[0] - s.x, st[1] - s.z], L = Math.hypot(...d); if ((f[0] * d[0] + f[1] * d[1]) / L < 0.95) bad++; }   // ライブの客席はステージの方
    else if (s.kind) { const d = [lake.center[0] - s.x, lake.center[1] - s.z], L = Math.hypot(...d); if ((f[0] * d[0] + f[1] * d[1]) / L < 0.9) bad++; }
    else { let bd = 1e9, bp = null; for (const q of route) { const dd = Math.hypot(q[0] - s.x, q[1] - s.z); if (dd < bd) { bd = dd; bp = q; } } const d = [bp[0] - s.x, bp[1] - s.z]; if ((f[0] * d[0] + f[1] * d[1]) / (bd || 1) < 0.7) bad++; }
  }
  check('観客の顔は、パレードは道の方・花火は湖の中心の方・ライブはステージの方を向く', bad / slots.length < 0.03, `${bad}/${slots.length}`);
  {   // ライブの客席 (kind 2): 扇の中・前の柵より後ろ・ミキサー席・花壇・街灯・ベンチ・入口の通り道に立たない
    const lv = park.gen.rides.live, F = lv.fan, ST = lv.stage, cl = Math.cos(lv.yaw), sl = Math.sin(lv.yaw), zf = ST.back + ST.d, half = F.ang * Math.PI / 360;
    const loc = (x, z) => { const dx = x - lv.x, dz = z - lv.z; return [dx * cl - dz * sl, dx * sl + dz * cl]; };
    const L2 = slots.filter((q) => q.kind === 2), mix = [lv.x + (zf + 38) * sl, lv.z + (zf + 38) * cl];
    let out = 0, fence = 0, tent = 0, near = 0;
    for (const q of L2) {
      const [u, v] = loc(q.x, q.z);
      if (v < zf + 17 || v > F.apexV + F.R || Math.abs(u) > (v - F.apexV) * Math.tan(half) + 0.5) { out++; continue; }
      if (Math.hypot(q.x - mix[0], q.z - mix[1]) < 6) tent++;
      if ([...park.gen.beds, ...park.gen.lamps, ...park.gen.benches].some((o) => Math.hypot(q.x - o[0], q.z - o[1]) < 0.9)) near++;
    }
    check('ライブの客席: 400 か所以上・扇の中で前の柵より後ろ・ミキサー席・花壇・街灯・ベンチの上ではない', L2.length >= 400 && out === 0 && tent === 0 && near === 0, { n: L2.length, out, tent, near });
  }
}
const watch = (nowSec, center, preset = '昼', seconds = 30) => {
  const sim = new CrowdSim(crowd, { ...OPT, cap: 120, radius: 130, seed: 5 });
  sim.setViewSlots(slots, 90);
  let last = null;
  for (let t = 0; t < seconds * 10; t++) {
    const sch = parkSchedule(park, nowSec + t * 0.1, PS), want = viewWant(park, sch, PS); last = { sch, want };
    sim.update(0.1, center[0], center[1], 0, 1, center[0] + 40, center[1] + 40, preset);
    sim.updateViewers(0.1, center[0], center[1], want);
  }
  return { sim, ...last, vs: sim.viewerList() };
};
{
  const mid = route[Math.floor(route.length * 0.7)];   // プラザの半周のあたり
  const quiet = watch(510, mid, '夕方', 20);   // 花火の終わり (458 秒) + 25 秒の後・次のパレードの 40 秒前 (580 秒) より前
  const pre = watch(S.parade.start - 30, mid, '夕方', 20);
  const on = watch(S.parade.start + 60, mid, '夕方', 30);
  console.log(`観客: ショーの無い時 ${quiet.vs.length} 人 / パレードの 30 秒前 ${pre.vs.length} 人 / パレード中 ${on.vs.length} 人 (上限 90)`);
  check('ショーが無いときは観客がいない', quiet.vs.length === 0 && quiet.want.parade === 0 && quiet.want.fw === 0, `${quiet.vs.length}`);
  check('始まる前から観客が集まり始める (パレードの 30 秒前)', pre.vs.length > 0 && pre.want.parade > 0.15 && !pre.want.paradeOn, `${pre.vs.length} 人 / 密度 ${pre.want.parade.toFixed(2)}`);
  check('パレード中は観客が多く、立っている人は上限 (90) を超えない・手を振る (種類 = 立ち話の腕)', on.sim.viewSel.size <= 90 && on.vs.length <= 180 && on.vs.length > 20 && on.vs.some((v) => v.mode === 2 && v.amp > 0.5), `${on.vs.length} 人`);
  check('観客に NaN が無い・背が 0〜1 の倍率で出る', on.vs.every((v) => Number.isFinite(v.x + v.z + v.y + v.yaw + v.phase) && v.grow >= 0 && v.grow <= 1));
  check('パレード中は園内の人が増える (boost > 1)', on.sim.boost > 1.2, `${on.sim.boost.toFixed(2)}`);
  const after = watch(S.parade.start + PS + 40, mid, '夕方', 30);
  check('パレードが終わって 40 秒後は観客の指定が 0 になり、花火の前で別の観客に入れ替わる', after.want.parade < 0.01, `密度 ${after.want.parade.toFixed(2)}`);
  const lakeSpot = [lakeX(), lakeZ()];
  function lakeX() { return park.ellipses['ムーンレイク'].center[0]; }
  function lakeZ() { return park.ellipses['ムーンレイク'].center[1] - 100; }
  const fw = watch(S.fireworks.start + 30, lakeSpot, '夜', 30);
  console.log(`観客: 花火の最中 湖の北 ${fw.vs.length} 人 (花火 ${fw.want.fwOn ? '最中' : '前'})`);
  check('花火の最中は湖のまわりに観客がいて、スマホを掲げる (種類 = スマホ)', fw.vs.length > 20 && fw.vs.every((v) => v.mode === 1) && fw.want.fwOn, `${fw.vs.length} 人`);
  const nofw = watch(510, lakeSpot, '夜', 20);
  check('花火が終わってしばらくすると観客はいない', nofw.vs.length === 0, `${nofw.vs.length}`);
  const far = watch(S.parade.start + 60, [31000, -25000], '昼', 10);
  check('園から遠い所 (観客の場所が 130 m 以内に無い) では観客はいない', far.vs.length === 0);
}

// ---- 地図の印・ワープ先 ----
{
  const sp = park.spots, names = sp.map((s) => s.name);
  check('地図の印: ゲート・プラザ・パレード (= アベニュー)・観覧車・ライブ会場・湖・6 エリア', sp.length >= 14 && ['ゲート', 'サンライズ・プラザ', '観覧車', 'サンライズ・ライブステージ', 'ムーンレイク（花火）', 'リール・キャッスル'].every((n) => names.includes(n)) && park.gen.areas.filter((a) => a.name !== 'ネオン・アベニュー').every((a) => names.includes(a.name)), names.join('・'));
  check('印は敷地の中で、建物・木・湖の中ではない', sp.every((s) => inPoly(s.x, s.z, park.site) && !inBuilding(s.x, s.z, 2) && !park.gen.trees.some((t) => Math.hypot(t[0] - s.x, t[1] - s.z) < 1.5)));
  // 乗り物・ライブ会場のステージ・ミキサー席・塔・特別な物・街灯などから離れている (ワープで押し出されない)
  const rd = park.gen.rides, lv = rd.live, lzf = lv.stage.back + lv.stage.d;
  const liveLocal = (x, z) => { const dx = x - lv.x, dz = z - lv.z; return [dx * Math.cos(lv.yaw) - dz * Math.sin(lv.yaw), dx * Math.sin(lv.yaw) + dz * Math.cos(lv.yaw)]; };
  const liveBlocked = (s) => { const [u, v] = liveLocal(s.x, s.z); return (Math.abs(u) < 6 && Math.abs(v - (lzf + 38)) < 4) || (v < lzf + 17 && Math.abs(u) < lv.stage.wing + 2); };
  const blocked = sp.filter((s) => s.kind !== 'plaza' && s.kind !== 'gate' && (Math.hypot(s.x - rd.ferris.x, s.z - rd.ferris.z) < rd.ferris.R + 5 || Math.hypot(s.x - rd.carousel.x, s.z - rd.carousel.z) < rd.carousel.R + 3.5 || liveBlocked(s)
    || Math.hypot(s.x - park.tower.at[0], s.z - park.tower.at[1]) < park.tower.radius + 4 || park.gen.props.some((q) => Math.hypot(q.x - s.x, q.z - s.z) < q.r + 2) || park.gen.lamps.some((q) => Math.hypot(q[0] - s.x, q[1] - s.z) < 1.2) || park.gen.beds.some((q) => Math.hypot(q[0] - s.x, q[1] - s.z) < 2.5))).map((s) => s.name);
  check('印は乗り物・ライブ会場のステージとミキサー席・塔・特別な物・街灯・植え込みから離れている (ワープで押し出されない)', blocked.length === 0, blocked.join('・'));
  const lake = park.ellipses['ムーンレイク'];
  check('湖の印は湖の外 (散歩道の上)', Math.hypot((sp.find((s) => s.kind === 'lake').x - lake.center[0]) / lake.rx, (sp.find((s) => s.kind === 'lake').z - lake.center[1]) / lake.rz) > 1.03);
  check('印の種類 (tier) は 0〜2・名前・色・字がある', sp.every((s) => [0, 1, 2].includes(s.tier) && s.name && /^#/.test(s.color) && s.glyph.length === 1 && Number.isFinite(s.face)));
  const lanePt = (s) => lanes.some((l) => { for (let i = 0; i + 3 < l.p.length; i += 2) if (segD(s.x, s.z, [l.p[i], l.p[i + 1]], [l.p[i + 2], l.p[i + 3]]) < 1.5) return true; return false; });
  const offLane = sp.filter((s) => !lanePt(s)).map((s) => s.name);
  check('印は通り道の上 (ゲート・プラザの中心を除く)', offLane.every((n) => ['ゲート', 'サンライズ・プラザ'].includes(n)), offLane.join('・'));
}

// ---- 木・街灯・ベンチをよける (段階 6) ----
{
  const obs = parkObstacles(park), sim = new CrowdSim(crowd, { ...OPT, cap: 120, radius: 130, seed: 11, obstacles: obs });
  const sim0 = new CrowdSim(crowd, { ...OPT, cap: 120, radius: 130, seed: 11 });
  const spots = Object.values(SPOTS).concat([[31352, -25896], [31180, -25388], [31784, -25659]]);   // 各エリアの中心 (木の多い所を含む)
  const cnt = (s) => { let inside = 0, tot = 0, jump = 0; const prev = new Map();
    for (let t = 0; t < 1500; t++) { const [sx, sz] = spots[Math.floor(t / 250) % spots.length]; s.update(0.1, sx, sz, 0, 1, sx + 40, sz + 40, '昼');
      if (t > 50) for (const p of s.people) { tot++; if (obs.some((o) => Math.hypot(p.x - o[0], p.z - o[1]) < o[2] + 0.3 - 0.01)) inside++; const q = prev.get(p.id); if (q && Math.hypot(p.x - q[0], p.z - q[1]) > 1.0) jump++; prev.set(p.id, [p.x, p.z]); } }
    return { inside, tot, jump }; };
  const a = cnt(sim0), b = cnt(sim);
  check('障害物 (木・街灯・ベンチ) が 500 以上ある', obs.length >= 500, `${obs.length}`);
  console.log(`  よけない: 障害物の中 ${a.inside}/${a.tot}  よける: ${b.inside}/${b.tot}  1 コマで 1 m 以上跳ぶ ${b.jump}`);
  check('よけると、人が障害物の中に入らない (0)', b.inside === 0, `${b.inside}`);
  check('よけない場合は入ってしまう (テストが効いている)', a.inside > 0, `${a.inside}`);
  check('よけても 1 コマで 1 m 以上は跳ばない (よけない場合と同程度)', b.jump <= a.jump + 3, `${b.jump} / ${a.jump}`);
}

console.log(`\n${ok.length} 項目 OK / ${ng.length} 項目 NG`);
if (ng.length) { console.log('NG:', ng.join(' / ')); process.exit(1); }
