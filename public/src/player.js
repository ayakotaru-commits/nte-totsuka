import * as THREE from 'three';
import { makeCharacter } from './character.js';
import { STEP } from './world.js';
import { H } from './terrain.js';
import { stairAt } from './stairs.js';
import { plan, sample, REACH_H, VAULT_H, HOP_H } from './parkour.js';
import { STEPS, LAUNCH, SPIN, DIVE, AIR5_FROM, LAND5_UNTIL, COMBO_GRACE, SWORD_IDLE } from './attack.js';

const R = 0.35;
const SPEED = { walk: 1.6, run: 5.5, dash: 10 }; // 何も押さないと走り。C で歩きに切り替え
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
    this.atk = null;       // 実行中の攻撃 { step, ph, t, queued, fx, fz, v0 }。step 1〜5 (attack.js)
    this.comboNext = 1;    // 続きの入力を受け付けている間の、次の手順
    this.comboGrace = 0;   // その残り時間 (秒)
    this.armedT = 99;      // 最後に攻撃してからの秒数。SWORD_IDLE を超えると剣が消える
    this.spin = 0;         // 4 の空中の回転 (rad)。見た目だけ
    this.model = makeCharacter();
    scene.add(this.model.root);
  }

  teleport(x, z) {
    this.pos.set(x, this.world.groundAt(x, z, H(x, z)), z);
    this.vel.set(0, 0); this.vy = 0; this.act = null; this.atk = null; this.spin = 0; this.comboGrace = 0;
  }

  update(dt, input, cam) {
    if (input.pressed('KeyC')) this.walkMode = !this.walkMode;
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

    this.show(dt, sp);
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

  get armed() { return !!this.atk || this.armedT < SWORD_IDLE; }

  // 攻撃の 1 手順を始める。動かしている向きがあればそちらへ向き直る
  startStep(step, dir) {
    if (dir) this.facing = Math.atan2(dir[0], dir[1]);
    this.atk = { step, ph: 0, t: 0, queued: false, v0: 0 };
    this.armedT = 0;
    this.comboGrace = 0;
    if (step === 5) {
      if (this.onGround) { this.atk.ph = 1; this.atk.v0 = DIVE.fwd * 0.9; } // 着地してから押した: そのまま滑る
      else { this.vy = DIVE.vy; this.atk.v0 = DIVE.fwd; }
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
    a.t += dt;
    const S = STEPS[a.step], dur = S.dur[a.ph];
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    let v = 0;
    if (a.step <= 3) {
      const [m0, m1, dist] = S.move;
      if (a.t > m0 && a.t < m1) v = dist / (m1 - m0) * (Math.PI / 2) * Math.sin(Math.PI * (a.t - m0) / (m1 - m0)); // 踏み込む (進んだ距離が dist になる)
      if (a.queued && a.t >= S.cancel) { this.startStep(a.step + 1, dir); a = this.atk; return this.finishAtk(dt, a, 0); }
      if (a.t >= dur) { this.endStep(a.step + 1); return this.finishAtk(dt, null, 0); }
    } else if (a.step === 4) {
      if (a.ph === 0) {
        if (a.t >= dur) { // 跳ぶ
          this.vy = LAUNCH.vy; this.onGround = false; this.jumps = 1; a.ph = 1; a.t -= dur; this.spin = 0;
        }
      } else if (a.ph === 1) {
        v = LAUNCH.fwd;
        this.spin = Math.PI * 2 * Math.min(1, a.t / SPIN.dur);
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
        v = DIVE.fwd;
        if (this.spin > 0) { this.spin += (Math.PI * 2 - this.spin) * (1 - Math.exp(-16 * dt)); if (this.spin > Math.PI * 2 - 0.03) this.spin = 0; } // 4 の回転の続き
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

  // 前へ踏み込む速さ v で体を動かし、姿勢を渡す
  finishAtk(dt, a, v) {
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    if (a) this.vel.set(fx * v, fz * v);
    else this.vel.multiplyScalar(Math.exp(-14 * dt));
    this.moveBody(dt);
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
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.facing + this.spin;
    this.model.update(dt, this.poseSpeed ?? sp, this.onGround, this.vy, this.stair || 0, act, this.armed); // poseSpeed: 撮影用 (?shot&pose=5.5 でその場で歩き・走りの姿勢)
  }
}
