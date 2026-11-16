// room.js の確認 (通信なし)。 node test.js
import assert from 'node:assert/strict';
import { Room, MAX_PLAYERS, HP_MAX } from './room.js';

const mk = () => { const c = { out: [], closed: null, send(t) { this.out.push(JSON.parse(t)); }, close(code) { this.closed = code; } }; return c; };
const of = (c, t) => c.out.filter((m) => m.t === t);
// 状態: 位置 (x, z)、向き、攻撃 (手順, 局面, 時間, 通し番号)
const st = (x, z, f = 0, atk = null) => JSON.stringify({ t: 's', d: [x, 0, z, f, 0, 1, 0, 0, 0, atk ? 1 : 0, atk ? atk[0] : 0, atk ? atk[1] : 0, atk ? atk[2] : 0, atk ? atk[3] : 0] });

let now = 1000;
const room = new Room();
const A = mk(), B = mk(), C = mk();
room.join(A, now); room.join(B, now); room.join(C, now);
const [a, b, c] = [A, B, C].map((x) => of(x, 'hi')[0].id);
assert.equal(of(B, 'hi')[0].players.length, 1);
assert.equal(of(A, 'join').length, 2);
assert.equal(new Set([A, B, C].map((x) => of(x, 'hi')[0].name)).size, 3, '名前が重ならない');

// 位置の中継: 自分以外にも自分にも同じ一覧が届く (自分の分はクライアントが捨てる)
room.message(A, st(0, 0), now); room.message(B, st(0, 1.5), now); room.message(C, st(0, 1.2), now);
room.tick(now += 100);
assert.deepEqual(of(B, 'w')[0].s.map((r) => r[0]).sort(), [a, b, c]);
room.tick(now += 100);
assert.equal(of(B, 'w').length, 1, '動いていなければ配らない');

// 戦闘オフ同士は当たらない
room.message(A, st(0, 0, 0, [1, 0, 0.2, 1]), now);
assert.equal(of(B, 'hit').length, 0);
// A と B だけ戦闘オン。C はオフのまま → B にだけ当たる
room.message(A, JSON.stringify({ t: 'pvp', on: true }), now);
room.message(B, JSON.stringify({ t: 'pvp', on: true }), now);
now += 2000; // オンにした直後の保護が切れるまで
room.message(A, st(0, 0, 0, [1, 0, 0.05, 2]), now);
assert.equal(of(B, 'hit').length, 0, '振り始めは当たらない');
room.message(A, st(0, 0, 0, [1, 0, 0.2, 2]), now);
assert.equal(of(B, 'hit').length, 1);
assert.equal(of(B, 'hit')[0].b, b);
assert.equal(of(B, 'hit')[0].hp, HP_MAX - 12);
room.message(A, st(0, 0, 0, [1, 0, 0.3, 2]), now += 100);
assert.equal(of(B, 'hit').length, 1, '同じ一振りは 1 回だけ');
// 背中側・遠すぎは当たらない
room.message(A, st(0, 0, Math.PI, [2, 0, 0.2, 3]), now += 300);
assert.equal(of(B, 'hit').length, 1, '後ろには当たらない');
room.message(A, st(0, -3, 0, [2, 0, 0.2, 4]), now += 300);
assert.equal(of(B, 'hit').length, 1, '遠いと当たらない');
// 戦闘の直後はオフにできない
room.message(B, JSON.stringify({ t: 'pvp', on: false }), now);
assert.equal(of(B, 'no').length, 1);
// 倒れるまで当てる → ko → 復活
let serial = 10;
while (!of(A, 'ko').length) { room.message(A, st(0, 0, 0, [5, 0, 0.2, serial++]), now += 300); assert.ok(serial < 30); }
assert.deepEqual({ a: of(A, 'ko')[0].a, b: of(A, 'ko')[0].b }, { a, b });
const hits = of(B, 'hit').length;
room.message(A, st(0, 0, 0, [1, 0, 0.2, serial++]), now += 300);
assert.equal(of(B, 'hit').length, hits, '倒れている相手には当たらない');
room.tick(now += 3100);
assert.equal(of(B, 're')[0].id, b);
room.message(B, st(0, 1.5), now);
room.message(A, st(0, 0, 0, [1, 0, 0.2, serial++]), now += 300);
assert.equal(of(B, 'hit').length, hits, '復活直後は当たらない');
room.message(A, st(0, 0, 0, [1, 0, 0.2, serial++]), now += 3000);
assert.equal(of(B, 'hit').length, hits + 1);
// 体力の回復
for (let i = 0; i < 100; i++) room.tick(now += 100);
assert.ok(of(B, 'hp').length > 0 && of(B, 'hp').at(-1).hp === HP_MAX, '放っておくと体力が戻る');

// おかしな入力は無視
for (const bad of ['x', '{}', '{"t":"s","d":[1,2]}', JSON.stringify({ t: 's', d: Array(14).fill(null) }), JSON.stringify({ t: 's', d: [1e9, ...Array(13).fill(0)] }), 'a'.repeat(5000)]) room.message(C, bad, now);
room.tick(now += 100);
assert.ok(!of(A, 'w').at(-1).s.some((r) => r[0] === c), 'おかしな状態は配らない');
// 送りすぎは捨てる
for (let i = 0; i < 200; i++) room.message(C, st(i, 0), now);
room.tick(now += 100);
assert.ok(of(A, 'w').at(-1).s.find((r) => r[0] === c)[1] < 45, '1 秒に 40 通まで');

// 退室・満員・放置
room.leave(C);
assert.equal(of(A, 'bye')[0].id, c);
const extra = [];
for (let i = room.size; i < MAX_PLAYERS; i++) { const x = mk(); extra.push(x); assert.ok(room.join(x, now)); }
const over = mk();
assert.equal(room.join(over, now), false);
assert.equal(over.closed, 4001); assert.equal(over.out[0].t, 'full');
room.message(A, st(1, 1), now += 121000);
room.tick(now);
assert.equal(room.size, 1, '何も送らない接続は切る');
assert.equal(extra[0].closed, 4002);
console.log('room.js: すべて OK');
