// ゲームセンターのリズムゲーム (public/src/arcade/game.js) の判定・点数の確認。node だけで動く (ブラウザ不要)。
//   node tools/dev/arcade_test.mjs
import fs from 'node:fs';
import { Game, WIN, rankOf } from '../../public/src/arcade/game.js';

let fail = 0;
const ok = (c, msg) => { console.log((c ? 'OK  ' : 'NG  ') + msg); if (!c) fail++; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

const T = (n) => ({ t: n[0], lane: n[1], type: n[2] || 'tap', ...(n[3] ? { end: n[3] } : {}), ...(n[4] ? { flickEnd: true } : {}) });

// 1. 全部ちょうど → 100000・S・ALL PERFECT
{
  const g = new Game([[1, 0], [2, 1], [3, 2], [3, 5]].map(T));
  for (const n of g.notes) g.press(n.lane, n.t);
  g.update(10);
  const s = g.summary();
  ok(s.score === 100000 && s.rank === 'S' && s.allPerfect && s.fullCombo && s.maxCombo === 4, `全部ちょうど: ${s.score} ${s.rank} コンボ ${s.maxCombo}`);
}
// 2. 何も打たない → 全部ミス、0 点
{
  const g = new Game([[1, 0], [2, 1], [3, 2]].map(T));
  g.update(10);
  const s = g.summary();
  ok(s.score === 0 && s.counts.miss === 3 && s.rank === 'C' && g.finished && !s.fullCombo, `打たない: ${s.score} ミス ${s.counts.miss}`);
}
// 3. ずれ幅の境目
{
  const tests = [[0.03, 'perfect'], [-0.03, 'perfect'], [0.07, 'great'], [-0.07, 'great'], [0.11, 'good'], [-0.12, 'good'], [0.16, 'bad'], [-0.17, 'bad']];
  for (const [d, want] of tests) {
    const g = new Game([T([1, 0])]);
    g.press(0, 1 + d); g.update(5);
    ok(g.notes[0].grade === want, `ずれ ${d >= 0 ? '+' : ''}${d} → ${g.notes[0].grade} (期待 ${want})`);
  }
  const g = new Game([T([1, 0])]);
  ok(g.press(0, 1 - 0.3) === null && g.notes[0].state === 'wait', '早すぎる押しは無視して、ノーツは残る');
  g.press(0, 1.0); ok(g.notes[0].grade === 'perfect', '早すぎる押しの後でも、ちょうどに打てる');
  const g2 = new Game([T([1, 0])]);
  g2.update(1.2); ok(g2.notes[0].grade === 'miss', '遅すぎるとミス (0.18 秒を過ぎたら)');
  const g3 = new Game([T([1, 0])]);
  g3.update(1.17); ok(g3.notes[0].state === 'wait', '0.17 秒遅れまではまだミスにしない');
}
// 4. コンボ: bad で切れる、good でつながる
{
  const g = new Game([[1, 0], [2, 0], [3, 0], [4, 0]].map(T));
  g.press(0, 1); g.press(0, 2.11); g.press(0, 3.16); g.press(0, 4.0);
  g.update(9);
  ok(g.maxCombo === 2 && g.combo === 1, `コンボ: perfect → good(0.11) でつながり、bad(0.16) で切れる → 最大 ${g.maxCombo}・今 ${g.combo}`);
}
// 5. 長押し
{
  const mk = () => new Game([T([1, 2, 'hold', 3])]);
  let g = mk(); g.press(2, 1.0); g.update(2); g.release(2, 3.0); g.update(5);
  ok(g.notes[0].grade === 'perfect' && g.counts.perfect === 1 && g.sum === 1 && g.maxCombo === 1, '長押し: 最後まで押す → perfect のまま');
  g = mk(); g.press(2, 1.0); g.update(2); g.release(2, 2.0); g.update(5);
  ok(g.notes[0].grade === 'miss' && near(g.sum, 0.3) && g.combo === 0, `長押し: 早く離す → ミス・点は 0.3 倍 (${g.sum})・コンボ 0`);
  g = mk(); g.press(2, 1.0); g.update(3.0, [false, false, true]); g.update(4);
  ok(g.notes[0].grade === 'perfect', '長押し: 押したまま終わりの時刻を過ぎる (離しはイベントに来ない) → 成功');
  g = mk(); g.update(5);
  ok(g.notes[0].grade === 'miss' && g.sum === 0, '長押し: 最初を押さない → ミス');
  g = mk(); g.press(2, 1.0); g.release(2, 2.9); g.update(5);
  ok(g.notes[0].grade === 'perfect', '長押し: 終わりの 0.1 秒前に離す → 成功 (0.15 秒まで許す)');
  g = mk(); g.press(2, 1.0); g.update(3.0, [false, false, false]); g.update(4);
  ok(g.notes[0].grade === 'miss', '長押し: 指が離れていると分かっていて終わりの時刻を過ぎる → 失敗');
}
// 6. フリック
{
  let g = new Game([T([1, 3, 'flick'])]);
  g.press(3, 1.0, true); ok(g.notes[0].state === 'pend', 'フリック(指): 押した直後は、はじきを待つ');
  g.swipe(3, 1.05); ok(g.notes[0].grade === 'perfect', 'フリック(指): はじくと、押した時刻の判定');
  g = new Game([T([1, 3, 'flick'])]);
  g.press(3, 1.0, true); g.release(3, 1.1); ok(g.notes[0].grade === 'good', 'フリック(指): はじかずに離すと good');
  g = new Game([T([1, 3, 'flick'])]);
  g.press(3, 1.0, true); g.update(1.4); ok(g.notes[0].grade === 'good', 'フリック(指): 待ちきれないと good');
  g = new Game([T([1, 3, 'flick'])]);
  g.press(3, 1.07, true); g.swipe(3, 1.12); ok(g.notes[0].grade === 'great', 'フリック(指): great は great のまま');
  g = new Game([T([1, 3, 'flick'])]);
  g.press(3, 1.0, false); ok(g.notes[0].grade === 'perfect', 'フリック(キー): 押すだけで perfect');
}
// 7. 同時押し・別のレーン
{
  const g = new Game([[1, 0], [1, 5], [1.2, 0]].map(T));
  g.press(0, 1.0); g.press(5, 1.0); g.press(0, 1.2);
  ok(g.counts.perfect === 3 && g.finished, '同時押しと同じレーンの連続');
  const g2 = new Game([[1, 0]].map(T));
  g2.press(4, 1.0); ok(g2.stray === 1 && g2.notes[0].state === 'wait', '別のレーンを押しても、ノーツには当たらない');
}
// 8. 点数・ランク
{
  ok(rankOf(92000) === 'S' && rankOf(91999) === 'A' && rankOf(80000) === 'A' && rankOf(79999) === 'B' && rankOf(60000) === 'B' && rankOf(59999) === 'C', 'ランクの境目');
  const g = new Game([[1, 0], [2, 1]].map(T));
  g.press(0, 1.0); g.press(1, 2.07); g.update(5);
  ok(g.score === Math.round(100000 * (1 + 0.8) / 2), `点: perfect + great = ${g.score}`);
}
// 9. 本物の譜面を、ちょうどで・少しずらして・全部ミスで通す
for (const diff of ['NORMAL', 'HARD']) {
  const chart = JSON.parse(fs.readFileSync(new URL('../../public/arcade/chart.json', import.meta.url)));
  const notes = chart.difficulties[diff].notes;
  const run = (how) => {
    const g = new Game(notes);
    for (const n of g.notes) {
      const dt = how(n);
      if (dt == null) continue;
      g.press(n.lane, n.t + dt);
      if (n.type === 'hold') { g.update(n.t + dt + 0.01); g.release(n.lane, n.end); }
    }
    g.update(1e3);
    return g.summary();
  };
  const a = run(() => 0), b = run(() => 0.06), c = run(() => null), d = run((n) => (n.i % 2 ? 0.03 : -0.03));
  ok(a.score === 100000 && a.maxCombo === notes.length, `${diff} (${notes.length} ノーツ): ちょうど → ${a.score}・コンボ ${a.maxCombo}`);
  ok(b.counts.great === notes.length && b.score === 80000 && b.rank === 'A', `${diff}: 全部 +0.06 秒 → great ${b.counts.great}・${b.score}・${b.rank}`);
  ok(c.score === 0 && c.counts.miss === notes.length, `${diff}: 打たない → ${c.score}`);
  ok(d.score === 100000, `${diff}: ±0.03 秒のばらつき → ${d.score}`);
}
console.log(fail ? `\n失敗 ${fail} 件` : '\n全部 OK');
process.exit(fail ? 1 : 0);
