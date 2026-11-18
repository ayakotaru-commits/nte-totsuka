import * as THREE from 'three';
import { makeCharacter } from './character.js';
import { STEP } from './world.js';
import { H } from './terrain.js';
import { stairAt } from './stairs.js';
import { plan, sample, REACH_H, VAULT_H, HOP_H } from './parkour.js';
import { STEPS, LAUNCH, DIVE, AIR5_FROM, LAND5_UNTIL, COMBO_GRACE, SWORD_IDLE, spinAt } from './attack.js';

export const R = 0.35; // 体の半径 (m)
const SPEED = { walk: 1.6, run: 5.5, dash: 10 }; // 何も押さないと走り。C で歩きに切り替え
const DOOR_T = 0.9;   // 扉を開ける動きの長さ (秒)
export const ACT_ID = { atk: 1, vault: 2, climb: 3, hurt: 4, down: 5, door: 6 }; // 動きの種類の番号 (通信用)
const PUSH_RATE = 10; // 押し合いで離れる速さ (1/秒。重なりの約 6 割を 0.1 秒で戻す)
const GRAVITY = 24, JUMP_V = 8.2, JUMP2_V = 7.6;

export class Player {
  constructor(world, scene) {
    this.world = world;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector2();
    this.vy = 0;
    this.onGround = true;
    this.jumps = 0;
    this.facing = 0;
    this.walkMode = false;
    this.act = null;       // 実行中のパルクール (parkour.js の plan() の結果)
    this.actCool = 0;      // 終わった直後に続けて発動しないための待ち時間
    this.doorT = -1;       // 扉を開ける動きの経過時間 (秒。-1 = していない)
    this.atk = null;       // 実行中の攻撃 { step, ph, t, queued, fx, fz, v0 }。step 1〜5 (attack.js)
    this.comboNext = 1;    // 続きの入力を受け付けている間の、次の手順
    this.comboGrace = 0;   // その残り時間 (秒)
    this.armedT = 99;      // 最後に攻撃してからの秒数。SWORD_IDLE を超えると剣が消える
    this.spin = 0;         // 4 の空中の回転 (rad)。見た目だけ
    this.atkN = 0;         // 攻撃の通し番号 (一振りごとに増える。マルチプレイで、同じ一振りが 2 回当たらないように使う)
    this.stun = 0;         // 攻撃を受けて動けない残り時間 (秒)
    this.dead = false;     // 倒されて復活を待っている
    this.hurtT = 0;        // 攻撃を受けてからの秒数
    this.lastAct = null;   // 最後に見せた動き (マルチプレイで他の人へ送る)
    this.lastSp = 0;
    this.model = makeCharacter();
    scene.add(this.model.root);
  }

  teleport(x, z) {
    this.pos.set(x, this.world.groundAt(x, z, H(x, z)), z);
    this.vel.set(0, 0); this.vy = 0; this.act = null; this.atk = null; this.spin = 0; this.comboGrace = 0;
  }

  update(dt, input, cam) {
    if (input.pressed('KeyC')) this.walkMode = !this.walkMode;
    if (this.dead || this.stun > 0) return this.updateHurt(dt);
    if (this.act) return this.updateAct(dt);
    this.actCool -= dt;

    let mx = 0, mz = 0;
    if (input.held('KeyW') || input.held('ArrowUp')) mz += 1;
    if (input.held('KeyS') || input.held('ArrowDown')) mz -= 1;
    if (input.held('KeyD') || input.held('ArrowRight')) mx += 1;
    if (input.held('KeyA') || input.held('ArrowLeft')) mx -= 1;
    // タッチのスティック: 浅く倒すと歩き、深く倒すと走り
    const tilt = Math.hypot(input.ax, input.az);
    mx += input.ax; mz += input.az;
    const walk = this.walkMode || (tilt > 0 && tilt < 0.6);

    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    let dx = -sy * mz + cy * mx, dz = -cy * mz - sy * mx;
    const len = Math.hypot(dx, dz);
    let target = 0;
    if (len > 0) {
      dx /= len; dz /= len;
      target = input.held('ShiftLeft') || input.held('ShiftRight') ? SPEED.dash : walk ? SPEED.walk : SPEED.run;
    }
    // 攻撃 (J / クリック / 画面の「攻撃」)。地上で押すと始まり、続けて押すと 5 連撃になる
    const atkPress = input.pressed('KeyJ') || input.pressed('Mouse0');
    this.armedT += dt;
    this.comboGrace = Math.max(0, this.comboGrace - dt);
    if ((atkPress || this.atk) && this.updateAtk(dt, atkPress, len > 0 ? [dx, dz] : null)) return;

    // 階段: 上り(+1)・下り(-1) をキャラに伝える (速さは落とさない。持ち主の希望)
    const stair = this.onGround ? stairAt(this.pos.x, this.pos.z, this.pos.y) : null;
    const sl = this.vel.length();
    this.stair = stair && sl > 0.1 ? Math.max(-1, Math.min(1, (this.vel.x * stair.ux + this.vel.y * stair.uz) / sl * Math.min(1, stair.grade * 1.6))) : 0;
    const accel = this.onGround ? 12 : 3;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (dx * target - this.vel.x) * k;
    this.vel.y += (dz * target - this.vel.y) * k;

    if (len > 0) {
      const want = Math.atan2(dx, dz);
      let d = want - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * (1 - Math.exp(-14 * dt));
    }

    // パルクール: 走り・ダッシュで障害物へ向かっているとき、自動で飛び越える・よじ登る (歩きでは発動しない)
    if (len > 0 && !walk && this.actCool <= 0 && this.tryParkour(dx, dz)) return this.updateAct(0);

    // ジャンプ (2段)
    if (input.pressed('Space')) {
      if (this.onGround) { this.vy = JUMP_V; this.onGround = false; this.jumps = 1; }
      else if (this.jumps < 2) { this.vy = JUMP2_V; this.jumps = 2; }
    }

    const sp = this.vel.length();
    this.moveBody(dt);

    // 扉を開ける動き (doors.js が startDoor を呼ぶ)。上半身だけの動きで、移動は止めない
    if (this.doorT >= 0) {
      this.doorT += dt;
      if (this.doorT >= DOOR_T) this.doorT = -1;
    }
    this.show(dt, sp, this.doorT >= 0 ? { type: 'door', s: this.doorT / DOOR_T } : null);
  }

  // 扉を開ける動きを始める (doors.js)。攻撃・パルクールの最中は動かさない
  startDoor() {
    if (this.atk || this.act) return false;
    this.doorT = 0;
    return true;
  }

  // 水平移動 (すり抜け防止にサブステップ) と垂直 (重力・着地)
  moveBody(dt) {
    const sp = this.vel.length();
    const steps = Math.max(1, Math.ceil(sp * dt / 0.2));
    for (let i = 0; i < steps; i++) {
      this.pos.x += this.vel.x * dt / steps;
      this.pos.z += this.vel.y * dt / steps;
      this.world.resolve(this.pos, R);
    }
    const prevY = this.pos.y;
    this.vy -= GRAVITY * dt;
    this.pos.y += this.vy * dt;
    const g = this.world.groundAt(this.pos.x, this.pos.z, prevY);
    if (this.pos.y <= g) {
      this.pos.y = g; this.vy = 0; this.onGround = true; this.jumps = 0;
    } else if (this.onGround && this.vy <= 0 && prevY - g <= STEP) {
      this.pos.y = g; this.vy = 0; // 段差を降りるときは吸着
    } else {
      this.onGround = false;
    }
  }

  // ---- マルチプレイ (net/index.js から呼ぶ) ----
  // 攻撃を受けた。(dx, dz) = 飛ばされる向き、step = 相手の攻撃の手順 (4・5 は強く飛ぶ)
  hurt(dx, dz, step) {
    const k = step >= 4 ? 7 : 4.5;
    this.act = null; this.atk = null; this.spin = 0; this.comboGrace = 0;
    this.vel.set(dx * k, dz * k);
    if (step >= 4 && this.onGround) { this.vy = 4; this.onGround = false; this.jumps = 1; }
    this.stun = 0.35; this.hurtT = 0;
  }
  down() { this.dead = true; this.hurtT = 0; }
  revive() { this.dead = false; this.stun = 0; }
  // のけぞっている・倒れている間: 操作を受け付けず、飛ばされた勢いだけで動く
  updateHurt(dt) {
    this.stun -= dt; this.hurtT += dt; this.armedT += dt;
    this.vel.multiplyScalar(Math.exp(-6 * dt));
    this.moveBody(dt);
    this.stair = 0;
    this.show(dt, 0, this.dead ? { type: 'down', s: Math.min(1, this.hurtT / 0.5) } : { type: 'hurt', s: Math.min(1, this.hurtT / 0.35) });
  }
  // 他の人へ送る自分の状態 (並びは server/room.js の先頭の説明)
  netState() {
    const r = (v) => Math.round(v * 100) / 100, a = this.lastAct;
    const d = [r(this.pos.x), r(this.pos.y), r(this.pos.z), r(Math.atan2(Math.sin(this.facing), Math.cos(this.facing))), r(this.lastSp),
      (this.onGround ? 1 : 0) | (this.armed ? 2 : 0), r(this.vy), r(this.stair || 0), r(this.spin), 0, 0, 0, 0, this.atkN];
    if (a) {
      d[9] = ACT_ID[a.type] || 0;
      if (a.type === 'atk') { d[10] = a.step; d[11] = a.ph; d[12] = r(a.t); }
      else { d[10] = r(a.s); d[11] = r(a.ly || 0); d[12] = r(a.lz || 0); }
    }
    return d;
  }

  // ほかのプレイヤーとの押し合い (net/index.js から毎コマ呼ぶ)。others = [{ x, y, z }]。
  // かたい壁にはせず、重なった分を少しずつ押し離す (相手の位置は通信の遅れで少し過去なので、急に押し戻すとカクッとなる)。
  // 動かすのは自分だけで、相手は相手の画面で同じように離れる。建物にめり込まないよう、最後に当たり判定をかける。
  // パルクールの「障害物」には人を入れない (人を飛び越えようとはしない)
  separate(others, dt) {
    if (this.act || this.dead) return;
    const MIN = R * 2, k = 1 - Math.exp(-PUSH_RATE * dt);
    let mx = 0, mz = 0;
    for (const o of others) {
      if (Math.abs(o.y - this.pos.y) > 1.6) continue; // 上下に離れている (デッキの上と下など)
      let dx = this.pos.x - o.x, dz = this.pos.z - o.z, d = Math.hypot(dx, dz);
      if (d >= MIN) continue;
      if (d < 1e-3) { dx = Math.sin(this.facing + Math.PI / 2); dz = Math.cos(this.facing + Math.PI / 2); d = 1; } // ぴったり重なった: 横へ
      else { dx /= d; dz /= d; }
      const over = MIN - Math.min(d, MIN);
      mx += dx * over; mz += dz * over;
    }
    if (!mx && !mz) return;
    this.pos.x += mx * k; this.pos.z += mz * k;
    this.world.resolve(this.pos, R);
  }

  get armed() { return !!this.atk || this.armedT < SWORD_IDLE; }

  // 攻撃の 1 手順を始める。動かしている向きがあればそちらへ向き直る
  startStep(step, dir) {
    if (dir) this.facing = Math.atan2(dir[0], dir[1]);
    this.atk = { step, ph: 0, t: 0, queued: false, v0: 0 };
    this.atkN++;
    this.armedT = 0;
    this.comboGrace = 0;
    if (step === 5) {
      if (this.onGround) { this.atk.ph = 1; this.atk.v0 = DIVE.fwd * 0.9; } // 着地してから押した: そのまま滑る
      else this.vy = 0; // 空中: 頂点で振りかぶってから (DIVE.at) 急降下する
    }
  }

  endStep(next) {
    this.comboNext = next; this.comboGrace = next > 1 ? COMBO_GRACE : 0;
    this.atk = null; this.armedT = 0; this.spin = 0;
  }

  // 攻撃中の 1 フレーム。操作は受け付けず、手順ごとの動きで体を動かす。処理したら true
  updateAtk(dt, press, dir) {
    let a = this.atk;
    if (!a) {
      if (!this.onGround) return false;
      this.startStep(this.comboGrace > 0 ? this.comboNext : 1, dir);
      a = this.atk;
    } else if (press && a.step !== 5) a.queued = true;
    const S = STEPS[a.step], dur = S.dur[a.ph];
    // 振り抜く・着地する瞬間 (S.stops) に、ほんの少しだけ時間を止める (ヒットストップ)。止まっている間は姿勢も体も動かない
    const si = S.stops ? S.stops.findIndex(([ph, t0], i) => ph === a.ph && !(a.stopsDone & (1 << i)) && a.t <= t0 && a.t + dt >= t0) : -1;
    if (si >= 0) { a.t = S.stops[si][1]; a.stopsDone = (a.stopsDone || 0) | (1 << si); a.hold = S.stops[si][2]; }
    else if (a.hold > 0) a.hold -= dt;
    else a.t += dt;
    if (a.hold > 0) return this.finishAtk(dt, a, 0);
    let v = 0, sv = 0;
    if (a.step <= 3) {
      const [m0, m1, dist, side = 0] = S.move;
      if (a.step === 3) this.spin = spinAt(3, 0, a.t); // 回転斬り: 体ごと回す
      if (a.t > m0 && a.t < m1) { // 踏み込む (進んだ距離が dist・side になる)
        const k = 1 / (m1 - m0) * (Math.PI / 2) * Math.sin(Math.PI * (a.t - m0) / (m1 - m0));
        v = dist * k; sv = side * k;
      }
      if (a.queued && a.t >= S.cancel) { this.spin = 0; this.startStep(a.step + 1, dir); a = this.atk; return this.finishAtk(dt, a, 0); }
      if (a.t >= dur) { this.endStep(a.step + 1); return this.finishAtk(dt, null, 0); }
      return this.finishAtk(dt, a, v, sv);
    } else if (a.step === 4) {
      if (a.ph === 0) {
        if (a.t >= dur) { // 跳ぶ
          this.vy = LAUNCH.vy; this.onGround = false; this.jumps = 1; a.ph = 1; a.t -= dur; this.spin = 0;
        }
      } else if (a.ph === 1) {
        v = LAUNCH.fwd;
        this.spin = spinAt(4, 1, a.t);
        // 頂点で一瞬浮く (落ち始めたら LAUNCH.hang 秒だけ、高さを保つ)
        if (!a.hung && this.vy <= 0) { a.hung = true; a.hang = LAUNCH.hang; }
        if (a.hang > 0) { a.hang -= dt; this.vy = 0; v *= 0.3; }
        if (this.onGround && a.t > 0.15) { a.ph = 2; a.t = 0; this.spin = 0; a.v0 = v; }
      } else {
        v = a.v0 * Math.exp(-12 * a.t);
        if (a.t >= dur) { this.endStep(1); return this.finishAtk(dt, null, 0); }
      }
      // 5 へ: 空中の斬り上げのあと、または着地の直後に押していたとき
      if (a.queued && ((a.ph === 1 && a.t >= AIR5_FROM) || (a.ph === 2 && a.t <= LAND5_UNTIL))) {
        this.startStep(5, null); a = this.atk; v = a.v0;
        return this.finishAtk(dt, a, v);
      }
    } else { // 5
      if (a.ph === 0) {
        if (a.t < DIVE.at) { v = 1.5; this.vy = 0.3; } // 頂点で振りかぶる (少し浮いたまま)
        else { if (!a.dove) { a.dove = true; this.vy = DIVE.vy; } v = DIVE.fwd; } // 急降下
        if (this.spin > 0) { // 4 の回転の続き (次の 1 周の終わりまで回して 0 に戻す)
          const end = Math.ceil(this.spin / (Math.PI * 2) - 1e-6) * Math.PI * 2;
          this.spin += (end - this.spin) * (1 - Math.exp(-16 * dt)); if (this.spin > end - 0.03) this.spin = 0;
        }
        if (this.onGround && a.t > 0.04) { a.ph = 1; a.t = 0; a.v0 = DIVE.fwd; this.spin = 0; }
      } else if (a.ph === 1) {
        v = a.v0 * Math.exp(-DIVE.slide * a.t);
        if (a.t >= dur) { a.ph = 2; a.t = 0; a.v0 = v; }
      } else {
        v = a.v0 * Math.exp(-14 * a.t);
        if (a.t >= dur) { this.endStep(1); return this.finishAtk(dt, null, 0); }
      }
    }
    return this.finishAtk(dt, a, v);
  }

  // 前へ踏み込む速さ v・左へ動く速さ sv で体を動かし、姿勢を渡す
  finishAtk(dt, a, v, sv = 0) {
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    if (a) this.vel.set(fx * v + fz * sv, fz * v - fx * sv); // 左 = (cos, -sin)
    else this.vel.multiplyScalar(Math.exp(-14 * dt));
    if (!(a && a.hold > 0)) this.moveBody(dt); // ヒットストップの間は空中でも止める
    this.stair = 0;
    this.show(dt, 0, a ? { type: 'atk', step: a.step, ph: a.ph, t: a.t } : null);
    return true;
  }

  // 目の前の障害物を調べ、越えられるなら動きを始める
  tryParkour(dx, dz) {
    const W = this.world, sp = this.vel.length();
    const p = W.probeLedge(this.pos, dx, dz, R, R + (this.onGround ? 0.3 + 0.1 * sp : 0.3));
    if (!p) return false;
    const y0 = this.pos.y, h = p.top - y0;
    if (h > REACH_H || -(dx * p.nx + dz * p.nz) < 0.6) return false; // 高すぎる・壁に沿って走っているだけ
    const start = (type, ux, uz, q, o) => {
      this.act = Object.assign(plan(type, { y0, top: q.top, tE: q.t, speed: sp, ...o }), { t: 0, x0: this.pos.x, z0: this.pos.z, ux, uz });
      return true;
    };
    // 飛び越え: 低くて薄く、向こう側に降りられる
    if (h <= VAULT_H && p.far !== null) {
      const g = W.groundAt(p.ex + dx * p.far, p.ez + dz * p.far, p.top);
      const yEnd = Math.max(g, p.top - 0.9);
      return start('vault', dx, dz, p, { end: p.far, thick: p.thick, yEnd, endAir: g < yEnd - 0.01 });
    }
    // 飛び乗り: 低い台
    if (h <= HOP_H && p.stand && p.t <= R + 0.3 + 0.05 * sp) return start('hop', dx, dz, p, { end: p.sd, yEnd: p.standY, endAir: false });
    // よじ登り: 壁に正対して近くにいるとき。壁にまっすぐ向き直って登る
    if (p.t > R + 0.3 || -(dx * p.nx + dz * p.nz) < 0.75) return false;
    const ux = -p.nx, uz = -p.nz;
    const q = W.probeLedge(this.pos, ux, uz, R, R + 0.45);
    if (!q || q.top - y0 > REACH_H || q.top - y0 <= HOP_H && !q.stand) return false;
    if (q.stand) return start('climb', ux, uz, q, { end: q.sd, yEnd: q.standY, endAir: false });
    if (q.far !== null) return start('climb', ux, uz, q, { end: q.far, yEnd: q.top - 0.1, endAir: true }); // 薄い塀: 越えて向こうへ降りる
    return false;
  }

  // パルクール中: 操作を受け付けず、決めた道筋の上を動かす
  updateAct(dt) {
    const a = this.act;
    a.t += dt;
    const s = Math.min(1, a.t / a.dur), m = sample(a, s);
    const px = this.pos.x, pz = this.pos.z, py = this.pos.y;
    this.pos.set(a.x0 + a.ux * m.q, m.y, a.z0 + a.uz * m.q);
    let d = Math.atan2(a.ux, a.uz) - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * (1 - Math.exp(-20 * dt));
    if (dt > 0) { this.vel.set((this.pos.x - px) / dt, (this.pos.z - pz) / dt); this.vy = (this.pos.y - py) / dt; }
    this.onGround = false; this.stair = 0;
    let pose = null;
    if (a.type !== 'hop') pose = { type: a.type, s: m.ps, ly: a.top - m.y, lz: a.tE - m.q };
    if (s >= 1) { // 終わり: 走りの速さを保って続ける (越えた先が低ければ、そのまま落ちる)
      const v = a.type === 'vault' ? a.v : a.type === 'hop' ? Math.max(a.speed, 3) : a.endAir ? 2.5 : 1.5;
      this.vel.set(a.ux * v, a.uz * v);
      this.vy = a.endAir ? Math.min(0, this.vy) : 0;
      this.onGround = !a.endAir; this.jumps = a.endAir ? 1 : 0;
      this.world.resolve(this.pos, R);
      this.act = null; this.actCool = 0.15;
    }
    this.show(dt, this.vel.length(), pose);
  }

  show(dt, sp, act = null) {
    this.lastAct = act; this.lastSp = this.poseSpeed ?? sp;
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.facing + this.spin;
    this.model.update(dt, this.poseSpeed ?? sp, this.onGround, this.vy, this.stair || 0, act, this.armed); // poseSpeed: 撮影用 (?shot&pose=5.5 でその場で歩き・走りの姿勢)
  }
}
