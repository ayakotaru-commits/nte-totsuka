// 動いているサーバーへ実際につないで確かめる (手元の local.js、wrangler dev、公開した Cloudflare のどれでも)。
//   node test-net.js ws://localhost:8787 [Origin]      例: node test-net.js wss://totsuka-mp.<アカウント名>.workers.dev https://ayakotaru-commits.github.io
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const base = (process.argv[2] || 'ws://localhost:8787').replace(/\/+$/, ''), origin = process.argv[3];
const room = 'r-test' + Math.floor(Math.random() * 1e6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = (name = room) => new Promise((res, rej) => {
  const ws = new WebSocket(`${base}/room/${name}`, origin ? { origin } : {});
  const c = { ws, got: [], of: (t) => c.got.filter((m) => m.t === t), send: (o) => ws.send(JSON.stringify(o)) };
  ws.on('message', (d) => c.got.push(JSON.parse(d.toString())));
  ws.on('open', () => res(c)); ws.on('error', rej); ws.on('unexpected-response', (_, r) => rej(new Error('HTTP ' + r.statusCode)));
});
const st = (x, z, f = 0, atk = null) => ({ t: 's', d: [x, 0, z, f, 0, 1, 0, 0, 0, atk ? 1 : 0, atk ? atk[0] : 0, atk ? atk[1] : 0, atk ? atk[2] : 0, atk ? atk[3] : 0] });

const A = await open(), B = await open();
await sleep(500);
const a = A.of('hi')[0].id, b = B.of('hi')[0].id;
assert.ok(a && b && a !== b); assert.equal(A.of('join')[0].id, b);
A.send(st(0, 0)); B.send(st(0, 1.5));
await sleep(500);
assert.ok(A.of('w').some((m) => m.s.some((r) => r[0] === b && r[3] === 1.5)), '相手の位置が届く');
A.send({ t: 'pvp', on: true }); B.send({ t: 'pvp', on: true });
await sleep(1800);
A.send(st(0, 0, 0, [1, 0, 0.2, 1]));
await sleep(500);
assert.equal(B.of('hit')[0]?.hp, 88, '当たる');
// 別の部屋には届かない
const C = await open(room + 'x'); await sleep(300);
assert.equal(C.of('hi')[0].players.length, 0);
B.ws.close(); await sleep(500);
assert.equal(A.of('bye')[0].id, b);
// 満員
const many = []; for (let i = 0; i < 15; i++) many.push(await open());
const over = await open(); await sleep(500);
assert.equal(over.of('full').length, 1, '17 人目は満員');
for (const c of [A, C, over, ...many]) c.ws.close();
console.log('test-net: すべて OK (' + base + ')');
process.exit(0);
