// 手元で試すためのサーバー (Node)。Cloudflare に公開しなくても、同じ room.js で動きを確かめられる。
//   cd server && npm install && node local.js [ポート]      (標準は 8787)
//   ゲーム側は URL に ?mp=ws://localhost:8787 を付けて開く
import { WebSocketServer } from 'ws';
import { Room, TICK_MS } from './room.js';

const port = +(process.argv[2] || 8787);
const rooms = new Map();
const wss = new WebSocketServer({ port, maxPayload: 4096 });

wss.on('connection', (ws, req) => {
  const m = (req.url || '').split('?')[0].match(/^\/room\/([a-z0-9-]{1,32})$/);
  if (!m) { ws.close(4000, 'bad path'); return; }
  let room = rooms.get(m[1]);
  if (!room) rooms.set(m[1], room = new Room());
  const conn = { send: (t) => ws.send(t), close: (c, r) => ws.close(c, r) };
  if (!room.join(conn, Date.now())) return;
  ws.on('message', (data, isBinary) => { if (!isBinary) room.message(conn, data.toString(), Date.now()); });
  ws.on('close', () => { room.leave(conn); if (!room.size) rooms.delete(m[1]); });
  ws.on('error', () => {});
});
setInterval(() => { const now = Date.now(); for (const r of rooms.values()) r.tick(now); }, TICK_MS);
console.log(`マルチプレイのサーバー: ws://localhost:${port}/room/<部屋の名前>`);
