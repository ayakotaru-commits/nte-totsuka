// フェアリー・リールパーク 段階 5: ショーの時刻の案内と、観客の場所。three.js・DOM に依存しない (tools/dev/parkcrowdcheck.mjs が数字を確かめる)。
//   ・ショーは時計 (Date.now) の cycle 秒ごとにくり返す (detail/parkshow.js)。「次のパレード・花火まであと何秒か」は時計から計算できる (parkSchedule)
//   ・観客: パレードの道の両側と、湖のまわり・プラザの南の縁の「立つ場所」(makeViewSlots)。ショーが近づくと増え、終わると減る (viewWant)。人の出し入れは crowdsim.js の updateViewers
const ev = (ph, cyc, start, dur) => {
  const t = ph - start, on = t >= 0 && t < dur;
  return { on, t: on ? t : 0, left: on ? dur - t : 0, startsIn: on ? 0 : t < 0 ? -t : cyc - t };
};

// 時計 nowSec (秒) のときの、パレード・花火の状態。paradeSec = パレードが道を通りきるまでの秒数 (detail/parkshow.js の paradeSeconds)。
// 戻り値: { phase, parade: { on, t, left, startsIn }, fw: { ... }, next: 'parade' | 'fw' (次に始まる方)、nextIn }
export function parkSchedule(cfg, nowSec, paradeSec) {
  const S = cfg.show, cyc = S.cycle, ph = ((nowSec % cyc) + cyc) % cyc;
  const parade = ev(ph, cyc, S.parade.start, paradeSec), fw = ev(ph, cyc, S.fireworks.start, S.fireworks.duration + 8);
  const next = parade.startsIn <= fw.startsIn ? 'parade' : 'fw';
  return { phase: ph, parade, fw, next, nextIn: Math.min(parade.startsIn, fw.startsIn) };
}

// 「m:ss」
export const fmtMin = (sec) => { const s = Math.max(0, Math.ceil(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// 画面に出す 1 行 (HUD)。ショーが近いほど目立たせる (soon = 始まる 60 秒前から)。{ text, soon, on }
export function infoLine(sch) {
  const p = sch.parade, f = sch.fw;
  if (p.on || f.on) {
    const parts = [];
    if (p.on) parts.push(`パレード開催中！（あと ${fmtMin(p.left)}）`);
    if (f.on) parts.push(`花火 開催中！（あと ${fmtMin(f.left)}）`);
    return { text: parts.join('　'), soon: true, on: true };
  }
  const soon = sch.nextIn <= 60;
  return { text: `パレードまで ${fmtMin(p.startsIn)}　花火まで ${fmtMin(f.startsIn)}`, soon, on: false };
}

// 観客の指定 (crowdsim.js の updateViewers に渡す)。ショーの pre 秒前から人が集まり (0 → 0.8)、始まると 1、終わって post 秒かけて減る
const dens = (ph, cyc, start, dur, pre, post) => {
  const tt = (((ph - start + pre) % cyc) + cyc) % cyc - pre;
  return tt < 0 ? (tt + pre) / pre * 0.8 : tt < dur ? 1 : tt < dur + post ? 1 - (tt - dur) / post : 0;
};
export function viewWant(cfg, sch, paradeSec) {
  const S = cfg.show, cyc = S.cycle;
  return {
    parade: dens(sch.phase, cyc, S.parade.start, paradeSec, 40, 15),
    fw: dens(sch.phase, cyc, S.fireworks.start, S.fireworks.duration + 8, 45, 25),
    paradeOn: sch.parade.on, fwOn: sch.fw.on,
  };
}

// 敷地の中にいるか (画面の左上の場所の名前に使う)
export function inSite(cfg, x, z) {
  const p = cfg.site;
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < (p[j][0] - p[i][0]) * (z - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  return c;
}

// 決まった値 (0〜1)。添字から決まる
const hash = (i) => { let x = Math.imul(i + 1, 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; };

// 観客の立つ場所 [{ x, z, yaw, kind: 0 パレード / 1 花火, u: 0〜1 }]。route = パレードの道 (detail/parkshow.js の paradeRoute。1 m おきの点)。
// u が小さい場所から先に人が立つ (人が増えるときに、同じ場所が先に埋まる = だれが見ても同じ)
export function makeViewSlots(cfg, route) {
  const out = [], gen = cfg.gen || { buildings: [], trees: [] };
  let n = 0;
  // 建物の中・木の近く (1.6 m 以内) には立たない
  const blocked = (x, z) => {
    for (const b of gen.buildings) {
      const dx = x - b.x, dz = z - b.z;
      if (Math.abs(dx) > 40 || Math.abs(dz) > 40) continue;
      const c = Math.cos(b.yaw), sn = Math.sin(b.yaw), u = dx * c - dz * sn, v = dx * sn + dz * c;
      if (Math.abs(u) < b.w / 2 + 1 && Math.abs(v) < b.d / 2 + 1) return true;
    }
    for (const t of gen.trees) if (Math.abs(t[0] - x) < 1.6 && Math.abs(t[1] - z) < 1.6) return true;
    return false;
  };
  const add = (x, z, yaw, kind) => blocked(x, z) ? null : out.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, yaw: Math.round(yaw * 1000) / 1000, kind, u: hash(n++) });
  // パレード: 道の両側に 3 列 (道の中心から 5, 6.5, 8 m)、4.5 m おき。道に顔を向ける
  const Lr = route.length - 1;
  for (let s = 6; s < Lr - 6; s += 4.5) {
    const i = Math.floor(s), a = route[i], b = route[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L, nx = -tz, nz = tx;
    for (const side of [-1, 1]) for (let row = 0; row < 3; row++) {
      const d = side * (5 + row * 1.5 + (hash(n + 1000) - 0.5) * 0.6), sj = (hash(n + 2000) - 0.5) * 2.5;
      add(a[0] + nx * d + tx * sj, a[1] + nz * d + tz * sj, Math.atan2(-nx * side, -nz * side), 0);
    }
  }
  // 花火: 湖のまわり (散歩道の外側 3 列。北の岸 = プラザの側ほど多い) と、プラザの南の縁 (湖に顔を向ける)
  const lake = cfg.ellipses['ムーンレイク'], pr = cfg.promenade, [lx, lz] = lake.center;
  const base = lake.rx + pr.offset + pr.width / 2 + 1.5, baseZ = lake.rz + pr.offset + pr.width / 2 + 1.5;
  const per = 2 * Math.PI * Math.sqrt((base * base + baseZ * baseZ) / 2);
  const na = Math.round(per / 5);
  for (let k = 0; k < na; k++) {
    const ang = k / na * Math.PI * 2, north = Math.max(0, -Math.sin(ang));
    if (hash(k + 5000) > 0.35 + 0.65 * north) continue;
    for (let row = 0; row < 3; row++) {
      const x = lx + (base + row * 1.6) * Math.cos(ang), z = lz + (baseZ + row * 1.6) * Math.sin(ang);
      add(x, z, Math.atan2(lx - x, lz - z), 1);
    }
  }
  const pz = cfg.ellipses['サンライズ・プラザ'], [px, pzz] = pz.center;
  for (let k = 0; k <= 30; k++) {
    const ang = (25 + 130 * k / 30) * Math.PI / 180;
    for (let row = 0; row < 2; row++) {
      const r = 0.78 + row * 0.09, x = px + pz.rx * r * Math.cos(ang), z = pzz + pz.rz * r * Math.sin(ang);
      add(x, z, Math.atan2(lx - x, lz - z), 1);
    }
  }
  return out;
}
