// ライブの時間割・曲順・音の聞こえ方 (public/src/parklivesched.js) の数字を確かめる。画面は使わない (node だけ。数秒)。
// 使い方: node tools/dev/livecheck.mjs
import fs from 'fs';
import { makeLive, liveMix, liveDensity } from '../../public/src/parklivesched.js';

const park = JSON.parse(fs.readFileSync(new URL('../../public/data/park.json', import.meta.url)));
const man = JSON.parse(fs.readFileSync(new URL('../../public/audio/live/songs.json', import.meta.url)));
const songs = man.songs, L = park.show.live;
let ok = 0, ng = 0;
const check = (name, cond, info = '') => { if (cond) ok++; else ng++; console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== '' ? '  ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); };

const live = makeLive(park, songs), live2 = makeLive(park, songs);
check('曲が 30 曲あり、mp3 が全部ある・クレジットがある', songs.length === 30 && songs.every((s) => fs.existsSync(new URL('../../public/' + s.file, import.meta.url)) && s.credit.startsWith('音楽：') && s.dur > 30), songs.length);

// 公演 (n = 0〜89 の 90 公演 = 30 時間分): 長さ・曲数・重複・最後・何度作っても同じ
let bad = { len: 0, few: 0, dup: 0, last: 0, first: 0, det: 0 }, seen = new Map(), lens = [], counts = [];
for (let n = 0; n < 90; n++) {
  const p = live.program(n), q = live2.program(n);
  if (JSON.stringify(p) !== JSON.stringify(q)) bad.det++;
  if (p.len > L.maxLen + 1e-6) bad.len++;
  if (p.songs.length < 3) bad.few++;
  if (new Set(p.songs.map((s) => s.id)).size !== p.songs.length) bad.dup++;
  if (p.songs.length >= 3 && p.songs[p.songs.length - 1].energy < 3) bad.last++;
  if (p.songs[0].energy < 3) bad.first++;
  p.songs.forEach((s) => seen.set(s.id, (seen.get(s.id) || 0) + 1)); lens.push(p.len); counts.push(p.songs.length);
}
check(`公演の長さは ${L.maxLen} 秒以内 (90 公演)`, bad.len === 0, { max: Math.max(...lens).toFixed(0), min: Math.min(...lens).toFixed(0), avg: (lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(0) });
check('どの公演も 3 曲以上', bad.few === 0, { songs: [Math.min(...counts), Math.max(...counts)] });
check('公演の中で同じ曲が重ならない', bad.dup === 0);
check('最初はにぎやか・最後もにぎやか (3 曲以上の公演)', bad.first === 0 && bad.last === 0, bad);
check('何度作っても同じ (決まった乱数)', bad.det === 0);
check(`90 公演 (30 時間) で、30 曲がすべて流れ、どの曲も 5 回以上 (長い曲は公演に収まりにくく、短い曲は多めになる)`, seen.size === 30 && Math.min(...seen.values()) >= 5, { played: seen.size, min: Math.min(...seen.values()), max: Math.max(...seen.values()) });

// 状態の流れ: 1 周期を 0.5 秒おきにたどる
const t0 = 1200 * 500;   // cycle の頭
let prev = null, changes = [], onSec = 0, errs = 0;
for (let s = 0; s < L.cycle * 2; s += 0.5) {
  const st = live.state(t0 + s);
  if (st.on) { onSec += 0.5; if (!st.song || st.t < 0 || (st.phase === 'song' && st.left <= 0) || st.progLeft <= 0) errs++; }
  if (!st.on && st.startsIn < 0) errs++;
  if (!prev || prev.phase !== st.phase) changes.push(st.phase);
  prev = st;
}
check('状態は 開演前 → (曲 → 間)… → 終演後 の順にくり返す', changes.slice(0, 1)[0] === 'wait' && changes.includes('song') && changes.includes('gap') && changes.includes('break') && errs === 0, { changes: changes.slice(0, 12).join('>'), errs });
const p0 = live.program(500);
check('開演は cycle の start 秒。その前は開演前で、開演までの秒数が合う', live.state(t0 + L.start - 30).phase === 'wait' && Math.abs(live.state(t0 + L.start - 30).startsIn - 30) < 1e-6 && live.state(t0 + L.start + 1).phase === 'song');
check('終演の後は、次の開演までの秒数が合う (cycle - 終演の時刻 + start)', Math.abs(live.state(t0 + L.start + p0.len + 5).startsIn - (L.cycle - (L.start + p0.len + 5) + L.start)) < 1e-6 && live.state(t0 + L.start + p0.len + 5).phase === 'break');
// 曲の間 (gap): 曲の終わりから次の曲まで、gap 秒
const s1 = p0.starts[1] - L.gap / 2;
check(`曲と曲の間は ${L.gap} 秒 (gap。音は鳴らさない)`, live.state(t0 + L.start + s1).phase === 'gap' && Math.abs(live.state(t0 + L.start + s1).toNext - L.gap / 2) < 1e-6 && liveMix(L, live.state(t0 + L.start + s1), 10).cur === null);

// 音の聞こえ方
const stSong = live.state(t0 + L.start + 30);
const v = (d, duck = 1) => liveMix(L, stSong, d, duck).cur?.vol ?? 0;
check('音量: 近いほど大きい・fullRadius 以内は最大・radius 以上は 0', v(10) === v(L.fullRadius) && v(L.fullRadius) > v(100) && v(100) > v(150) && v(L.radius) === 0 && v(500) === 0, { 10: +v(10).toFixed(2), 100: +v(100).toFixed(2), 150: +v(150).toFixed(2) });
check('パレード・花火の間 (duck) は小さくなる', v(10, 0.4) < v(10) * 0.5);
check('鳴らす位置 = 曲の頭からの秒数が合う', Math.abs(liveMix(L, stSong, 10).cur.offset - 30) < 1e-6 || Math.abs(liveMix(L, stSong, 10).cur.offset - stSong.t) < 1e-6);
check('遠いと曲を読まない・近づくと今の曲を先に読む', liveMix(L, stSong, 600).preload.length === 0 && liveMix(L, stSong, 150).preload.some((s) => s.id === stSong.song.id));
const stNear = live.state(t0 + L.start + p0.starts[1] - 20);
check('曲の終わり 30 秒前から、次の曲を先に読む', liveMix(L, stNear, 60).preload.some((s) => s.id === p0.songs[1].id), stNear.phase);

// 観客の多さ
const d = (sec) => liveDensity(L, live.state(t0 + sec));
check('観客: 開演の 60 秒前から増え (0→0.8)、公演中は 1、終わって 25 秒で 0', d(L.start - 61) === 0 && d(L.start - 30) > 0.35 && d(L.start - 1) > 0.78 && d(L.start + 5) === 1 && d(L.start + p0.len + 1) > 0.9 && d(L.start + p0.len + 26) === 0, [d(L.start - 61), +d(L.start - 30).toFixed(2), d(L.start + 5), +d(L.start + p0.len + 1).toFixed(2), d(L.start + p0.len + 26)]);

// 1 公演で流れる曲のクレジット (全部、画面に出せる)
console.log('  公演 0 の曲順:', live.program(0).songs.map((s) => `${s.title}(${s.energy},${s.dur.toFixed(0)}s)`).join(' → '), `長さ ${live.program(0).len.toFixed(0)}s`);
console.log(`\n${ok} 項目 OK / ${ng} 項目 NG`);
process.exit(ng ? 1 : 0);
