// サーバーとの接続 (WebSocket)。つなぐ・切れたらつなぎ直す・自分の状態を間引いて送る、だけを受け持つ。
// 作っただけではつながない。start() で部屋に入り、stop() で抜ける (抜けた後はつなぎ直さない)。
// 通信の中身は server/room.js の先頭の説明。
import { PUBLIC_ROOMS } from './config.js';

const SEND_MS = 125;      // 動いているときの送る間隔 (1 秒に 8 回)
const IDLE_MS = 2000;     // 変化が無いときの送る間隔 (つながっている合図)
const HIDDEN_MS = 60000;  // 画面を隠して (別のタブ・スリープ) これだけ経ったら切る。戻ったらつなぎ直す

export class Net {
  // base: 'wss://…'、room: 部屋の名前 (null なら、だれでも入れる部屋を順に試す)、on: 受け取ったときの処理 { 種類: (m) => … }
  constructor(base, room, on) {
    this.base = base.replace(/\/+$/, '');
    this.room = room; this.on = on;
    this.pub = 1; this.ws = null; this.open = false; this.retry = 0; this.timer = 0;
    this.lastSent = ''; this.lastAt = 0; this.hiddenAt = 0; this.stopped = true;
    document.addEventListener('visibilitychange', () => {
      if (this.stopped) return;
      if (document.hidden) { this.hiddenAt = performance.now(); setTimeout(() => this.checkHidden(), HIDDEN_MS + 500); }
      else if (!this.ws && !this.stopped) { clearTimeout(this.timer); this.connect(); }
    });
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false; this.pub = 1; this.retry = 0;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null; this.open = false;
    if (ws) try { ws.close(1000, 'leave'); } catch { /* */ }
  }

  checkHidden() {
    if (document.hidden && performance.now() - this.hiddenAt >= HIDDEN_MS && this.ws) this.ws.close(4003, 'hidden');
  }

  connect() {
    const name = this.room ? 'r-' + this.room : 'pub' + this.pub;
    let ws;
    try { ws = new WebSocket(`${this.base}/room/${name}`); } catch (e) { console.warn('マルチプレイ: 接続できません', e); this.stopped = true; this.on.status?.('off'); return; }
    this.ws = ws; this.on.status?.('connecting');
    let full = false;
    ws.onopen = () => { this.open = true; this.retry = 0; this.lastSent = ''; };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'full') { full = true; return; }
      this.on[m.t]?.(m);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws || this.stopped) return;
      this.ws = null; this.open = false;
      this.on.status?.('closed');
      if (document.hidden) return; // 戻ってきたときにつなぎ直す
      if (full || e.code === 4001) { // 満員: 次の部屋へ
        if (this.room || this.pub >= PUBLIC_ROOMS) { this.on.status?.('full'); this.pub = 1; this.timer = setTimeout(() => this.connect(), 30000); return; }
        this.pub++; this.connect(); return;
      }
      this.timer = setTimeout(() => this.connect(), Math.min(30000, 2000 * 2 ** this.retry++));
    };
    ws.onerror = () => {};
  }

  send(obj) { if (this.open) try { this.ws.send(JSON.stringify(obj)); } catch { /* 切れた */ } }

  // 自分の状態 (player.netState())。毎フレーム呼んでよい (ここで間引く)
  sendState(d, now) {
    if (!this.open) return;
    const dt = now - this.lastAt;
    if (dt < SEND_MS) return;
    const text = JSON.stringify({ t: 's', d });
    if (text === this.lastSent && dt < IDLE_MS) return;
    this.lastSent = text; this.lastAt = now;
    try { this.ws.send(text); } catch { /* 切れた */ }
  }
}
