import * as THREE from 'three';
import { makeCharacter } from './character.js';
import { STEP } from './world.js';
import { H } from './terrain.js';
import { stairAt } from './stairs.js';

const STAIR_SPEED = 3.4; // 階段を上り下りする速さの上限 (m/s)。走りから落とすのは少しだけ (歩き 1.6・走り 5.5)

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
    this.model = makeCharacter();
    scene.add(this.model.root);
  }

  teleport(x, z) {
    this.pos.set(x, this.world.groundAt(x, z, H(x, z)), z);
    this.vel.set(0, 0); this.vy = 0;
  }

  update(dt, input, cam) {
    if (input.pressed('KeyC')) this.walkMode = !this.walkMode;

    let mx = 0, mz = 0;
    if (input.held('KeyW') || input.held('ArrowUp')) mz += 1;
    if (input.held('KeyS') || input.held('ArrowDown')) mz -= 1;
    if (input.held('KeyD') || input.held('ArrowRight')) mx += 1;
    if (input.held('KeyA') || input.held('ArrowLeft')) mx -= 1;

    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    let dx = -sy * mz + cy * mx, dz = -cy * mz - sy * mx;
    const len = Math.hypot(dx, dz);
    let target = 0;
    if (len > 0) {
      dx /= len; dz /= len;
      target = input.held('ShiftLeft') || input.held('ShiftRight') ? SPEED.dash : this.walkMode ? SPEED.walk : SPEED.run;
    }
    // 階段: 速さを抑え、上り(+1)・下り(-1) をキャラに伝える
    const stair = this.onGround ? stairAt(this.pos.x, this.pos.z) : null;
    if (stair && target > STAIR_SPEED) target = STAIR_SPEED;
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

    // ジャンプ (2段)
    if (input.pressed('Space')) {
      if (this.onGround) { this.vy = JUMP_V; this.onGround = false; this.jumps = 1; }
      else if (this.jumps < 2) { this.vy = JUMP2_V; this.jumps = 2; }
    }

    // 水平移動 (すり抜け防止にサブステップ)
    const sp = this.vel.length();
    const steps = Math.max(1, Math.ceil(sp * dt / 0.2));
    for (let i = 0; i < steps; i++) {
      this.pos.x += this.vel.x * dt / steps;
      this.pos.z += this.vel.y * dt / steps;
      this.world.resolve(this.pos, R);
    }

    // 垂直
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

    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.facing;
    this.model.update(dt, this.poseSpeed ?? sp, this.onGround, this.vy, this.stair || 0); // poseSpeed: 撮影用 (?shot&pose=5.5 でその場で歩き・走りの姿勢)
  }
}
