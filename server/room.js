// マルチプレイの 1 部屋ぶんの処理 (入退室・位置の中継・戦いの判定)。
// 通信の仕組みに依らない形で書いてあり、Cloudflare (worker.js) と手元の Node (local.js) の両方から使う。
//   join(conn, now) / message(conn, text, now) / leave(conn) / tick(now)
//   conn は { send(text), close(code, reason) } を持つもの。
//
// 通信の中身 (JSON)。クライアント側は public/src/net/ を参照。
//   クライアント → サーバー
//     { t: 's', d: [x, y, z, 向き, 速さ, 旗, vy, 階段, 回転, 動きの種類, a1, a2, a3, 攻撃の通し番号] }   自分の状態
//     { t: 'pvp', on: true/false }                                                                    戦闘オン・オフ
//   サーバー → クライアント
//     { t: 'hi', id, name, hpMax, players: [{ id, name, pvp, hp, k, d, s }] }   入室できた
//     { t: 'full' }                                                             満員 (この後すぐ切断)
//     { t: 'join', id, name } / { t: 'bye', id }
//     { t: 'w', s: [[id, ...状態], ...] }                                       前回から動いた人の状態 (1 秒に 10 回)
//     { t: 'pvp', id, on } / { t: 'no', why }                                   戦闘オン・オフが変わった / 断った
//     { t: 'hit', a, b, hp, dx, dz, step } / { t: 'ko', a, b } / { t: 're', id } / { t: 'hp', id, hp }
//
// ズルへの備え: 当たったかどうか・体力はここで決める (クライアントの申告は位置と動きだけ)。
// 位置そのものは申告を信じる (地図からのワープがあるので、速さでは弾かない)。
import { trailOn } from '../public/src/attack.js';

export const MAX_PLAYERS = 16;   // 1 部屋の人数
export const TICK_MS = 100;      // 状態をまとめて配る間隔
export const HP_MAX = 100;
const DMG = [0, 12, 12, 16, 22, 28];          // 攻撃の手順 1〜5 ごとのダメージ
const REACH = [0, 2.3, 2.3, 2.6, 2.6, 2.8];   // 届く距離 (m、相手の体の太さ込み)
const ARC = [0, 1.75, 1.75, 1.9, 3.2, 1.6];   // 正面から左右にこの角度 (rad) まで当たる。4 は回転しているので全方向
const REACH_Y = 2.0;                          // 高さの差がこれ以内なら当たる
const RESPAWN_MS = 3000;                      // 倒れてから復活するまで
const PROTECT_MS = 3000;                      // 復活した後、当たらない時間
const COMBAT_MS = 5000;                       // 当てた・当てられた後、戦闘オフにできない時間
const REGEN_WAIT_MS = 6000, REGEN_PER_S = 8;  // しばらく当てられないと体力が戻る
const HIT_GAP_MS = 200;                       // 同じ相手からは、この間隔より速くは当たらない
const AFK_MS = 120000;                        // 何も送ってこない接続を切るまで
const RATE_MAX = 40;                          // 1 秒に受け付けるメッセージの数 (超えた分は捨てる)
const MSG_MAX = 400;                          // 1 メッセージの長さの上限 (文字)
const STATE_LEN = 14;
const LIMIT = 20000;                          // 座標の上限 (m)

const ADJ = ['あおい', 'あかい', 'きいろい', 'しろい', 'くろい', 'みどりの', 'はやい', 'のんびり', 'げんきな', 'ねむい', 'つよい', 'ちいさな', 'おおきな', 'ふしぎな', 'しずかな', 'まるい'];
const ANIMAL = ['タヌキ', 'キツネ', 'ネコ', 'イヌ', 'ウサギ', 'カモ', 'ハト', 'カラス', 'スズメ', 'リス', 'カメ', 'コイ', 'カエル', 'トンビ', 'ムササビ', 'アライグマ'];

export class Room {
  constructor(rand = Math.random) {
    this.players = new Map(); // conn → player
    this.nextId = 1;
    this.rand = rand;
  }

  get size() { return this.players.size; }

  name() {
    const used = new Set([...this.players.values()].map((p) => p.name));
    for (let i = 0; i < 50; i++) {
      const n = ADJ[Math.floor(this.rand() * ADJ.length)] + ANIMAL[Math.floor(this.rand() * ANIMAL.length)];
      if (!used.has(n)) return n;
    }
    return 'たびびと' + this.nextId;
  }

  send(conn, obj) { try { conn.send(JSON.stringify(obj)); } catch { /* 切れた相手 */ } }
  broadcast(obj, except = null) {
    const text = JSON.stringify(obj);
    for (const c of this.players.keys()) if (c !== except) { try { c.send(text); } catch { /* 切れた相手 */ } }
  }

  // 入室。満員なら false (相手には { t: 'full' } を送って切る)
  join(conn, now) {
    if (this.players.size >= MAX_PLAYERS) {
      this.send(conn, { t: 'full' });
      try { conn.close(4001, 'full'); } catch { /* */ }
      return false;
    }
    const p = {
      id: this.nextId++, name: this.name(), conn, s: null, dirty: false, pvp: false, hp: HP_MAX, k: 0, d: 0,
      deadUntil: 0, protectUntil: 0, combatAt: -1e9, hurtAt: -1e9, last: now, rateT: now, rateN: 0,
      hitBy: new Map(), // 攻撃した人の id → { その人の攻撃の通し番号, 時刻 } (同じ一振りが 2 回当たらないように)
    };
    const players = [...this.players.values()].map((q) => ({ id: q.id, name: q.name, pvp: q.pvp, hp: q.hp, k: q.k, d: q.d, s: q.s }));
    this.players.set(conn, p);
    this.send(conn, { t: 'hi', id: p.id, name: p.name, hpMax: HP_MAX, players });
    this.broadcast({ t: 'join', id: p.id, name: p.name }, conn);
    return true;
  }

  leave(conn) {
    const p = this.players.get(conn);
    if (!p) return;
    this.players.delete(conn);
    this.broadcast({ t: 'bye', id: p.id });
  }

  message(conn, text, now) {
    const p = this.players.get(conn);
    if (!p || typeof text !== 'string' || text.length > MSG_MAX) return;
    if (now - p.rateT >= 1000) { p.rateT = now; p.rateN = 0; }
    if (++p.rateN > RATE_MAX) return;
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object') return;
    p.last = now;
    if (m.t === 's') this.onState(p, m.d, now);
    else if (m.t === 'pvp') this.onPvp(p, !!m.on, now);
  }

  onState(p, d, now) {
    if (!Array.isArray(d) || d.length !== STATE_LEN) return;
    for (const v of d) if (typeof v !== 'number' || !Number.isFinite(v)) return;
    if (Math.abs(d[0]) > LIMIT || Math.abs(d[1]) > LIMIT || Math.abs(d[2]) > LIMIT) return;
    p.s = d; p.dirty = true;
    if (p.pvp && !p.deadUntil && d[9] === 1) this.attack(p, now);
  }

  onPvp(p, on, now) {
    if (p.pvp === on) return;
    if (!on && now - p.combatAt < COMBAT_MS) { this.send(p.conn, { t: 'no', why: 'combat' }); return; }
    p.pvp = on;
    if (on) { p.protectUntil = now + 1500; } else if (p.hp < HP_MAX) { p.hp = HP_MAX; }
    this.broadcast({ t: 'pvp', id: p.id, on, hp: p.hp });
  }

  // 攻撃している人 a の一振りが、だれかに当たったかを調べる
  attack(a, now) {
    const [ax, ay, az, facing, , , , , , , step, ph, t, serial] = a.s;
    if (!(step >= 1 && step <= 5) || !trailOn(step, ph, t)) return;
    const fx = Math.sin(facing), fz = Math.cos(facing);
    for (const b of this.players.values()) {
      if (b === a || !b.pvp || !b.s || b.deadUntil || now < b.protectUntil) continue;
      const prev = b.hitBy.get(a.id);
      if (prev && (prev.serial === serial || now - prev.at < HIT_GAP_MS)) continue;
      const dx = b.s[0] - ax, dz = b.s[2] - az, dist = Math.hypot(dx, dz);
      if (dist > REACH[step] || Math.abs(b.s[1] - ay) > REACH_Y) continue;
      if (dist > 0.7 && Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / dist))) > ARC[step]) continue;
      b.hitBy.set(a.id, { serial, at: now });
      b.hp = Math.max(0, b.hp - DMG[step]);
      a.combatAt = b.combatAt = b.hurtAt = now;
      a.protectUntil = 0; // 攻撃した人は、復活直後の保護が切れる
      const n = dist > 0.05 ? [dx / dist, dz / dist] : [fx, fz];
      this.broadcast({ t: 'hit', a: a.id, b: b.id, hp: b.hp, dx: +n[0].toFixed(2), dz: +n[1].toFixed(2), step });
      if (b.hp <= 0) {
        a.k++; b.d++;
        b.deadUntil = now + RESPAWN_MS;
        this.broadcast({ t: 'ko', a: a.id, b: b.id });
      }
    }
  }

  // 一定間隔で呼ぶ: 状態の配布・復活・体力の回復・放置の切断
  tick(now) {
    const s = [];
    for (const p of this.players.values()) {
      if (p.dirty) { s.push([p.id, ...p.s]); p.dirty = false; }
      if (p.deadUntil && now >= p.deadUntil) {
        p.deadUntil = 0; p.hp = HP_MAX; p.protectUntil = now + PROTECT_MS; p.hitBy.clear();
        this.broadcast({ t: 're', id: p.id });
      } else if (!p.deadUntil && p.hp < HP_MAX && now - p.hurtAt > REGEN_WAIT_MS) {
        const before = Math.floor(p.hp / 10);
        p.hp = Math.min(HP_MAX, p.hp + REGEN_PER_S * TICK_MS / 1000);
        if (Math.floor(p.hp / 10) !== before || p.hp === HP_MAX) this.broadcast({ t: 'hp', id: p.id, hp: Math.round(p.hp) });
      }
    }
    if (s.length) this.broadcast({ t: 'w', s });
    for (const [c, p] of [...this.players]) {
      if (now - p.last > AFK_MS) { try { c.close(4002, 'afk'); } catch { /* */ } this.leave(c); }
    }
  }
}
