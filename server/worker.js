// Cloudflare Workers 用の入口。部屋ごとに Durable Object を 1 つ使う (中身は room.js)。
// 公開のしかたは server/README.md。
//   wss://<公開先>/room/<部屋の名前>   部屋の名前は英小文字・数字・ハイフン
import { Room, TICK_MS } from './room.js';

const allowed = (env, origin) => {
  const list = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes('*')) return true;
  if (!origin) return false;
  return list.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([a-z0-9-]{1,32})$/);
    if (!m) return new Response('TOTSUKA multiplayer server', { status: 200 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket で接続してください', { status: 426 });
    if (!allowed(env, req.headers.get('Origin'))) return new Response('このページからは使えません', { status: 403 });
    return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
  },
};

export class RoomDO {
  constructor() {
    this.room = new Room();
    this.timer = null;
  }

  async fetch() {
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    server.accept();
    const conn = {
      send: (text) => server.send(text),
      close: (code, reason) => server.close(code, reason),
    };
    if (this.room.join(conn, Date.now())) {
      server.addEventListener('message', (e) => this.room.message(conn, e.data, Date.now()));
      const bye = () => { this.room.leave(conn); this.sync(); };
      server.addEventListener('close', bye);
      server.addEventListener('error', bye);
    }
    this.sync();
    return new Response(null, { status: 101, webSocket: client });
  }

  // だれか居る間だけ時計を回す (だれも居なければ止めて、この部屋の処理が眠れるようにする)
  sync() {
    if (this.room.size && !this.timer) {
      this.timer = setInterval(() => { this.room.tick(Date.now()); if (!this.room.size) this.sync(); }, TICK_MS);
    } else if (!this.room.size && this.timer) {
      clearInterval(this.timer); this.timer = null;
    }
  }
}
