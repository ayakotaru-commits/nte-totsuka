// イベント「ミズタマンの襲来」: グランシティの時計の棟の門をくぐって中庭に入ると、まわりの棟の屋上から
// 敵キャラ「ミズタマン」(見た目は swarm/model.js) が大の字で次々に落ちてきて、起き上がって襲ってくる。
//   ・一度に出るのは ALIVE 体まで。倒すと次が屋上から落ちてくる。全部で TOTAL 体倒すとクリア
//   ・落ちてくる所には地面に赤い輪が出る
//   ・攻撃 (J / クリック / 「攻撃」) の剣の軌跡が出ている間に、届く範囲 (REACH・ARC) にいる敵に当たる。
//     1・2 撃目は 1、3 撃目 (回転斬り) は 2 のダメージ。敵の体力は 2
//   ・敵は近づくと、ためてから体当たりしてくる。当たると体力が減る。0 になるとやられて、門の外からやり直し
//   ・中庭から遠く (DIST_GIVEUP m) 離れて数秒たつと、敵はいなくなる (R でスタート地点に戻ったときも)
// 自分の画面だけの出来事 (マルチプレイのほかの人には見えない)。
// URL: ?swarm 開いてすぐ中庭で始める (確認用) / ?noswarm イベントを無効に
import { H } from '../terrain.js';
import { trailOn } from '../attack.js';
import { Herd, Fx, BODY } from './model.js';

export const TOTAL = 100, ALIVE = 30;
const G = 24;                                  // 重力 (player.js と同じ)
const R_E = 0.38;                              // 敵の体の半径
const HP_E = 2, DMG_E = [0, 1, 1, 2, 2, 2];    // 敵の体力、プレイヤーの攻撃の手順ごとのダメージ
const REACH = [0, 2.4, 2.4, 2.8, 2.8, 2.9];    // 剣が届く距離 (server/room.js より少し長め: 敵の体が平たく横に広いため)
const ARC = [0, 1.75, 1.75, 3.2, 3.2, 1.6];    // 正面から左右にこの角度 (rad) まで当たる (server/room.js と同じ)
const HP_P = 100, DMG_P = 7, INVULN = 0.7;     // プレイヤーの体力、体当たり 1 回で減る量、当たった後に当たらない時間
const HEAL_KILL = 1;                           // 1 体倒すと戻る体力
const DIST_GIVEUP = 80, T_GIVEUP = 4;

// 場所 (グランシティ。data/appearance.json の garden.layout と、住棟 g5317b7beb1 の輪郭から)
export const SITE = {
  // 中庭 (住棟の南の翼と北の翼のあいだ)。ここに入るとイベントが始まる
  yard: [[-263.6, 1432.0], [-195.6, 1438.7], [-198.4, 1467.7], [-260.3, 1461.6]],
  // 中庭に面した屋上の縁 (落ちてくる所)
  edges: [[[-264.37, 1430.41], [-194.15, 1437.3]], [[-261.2, 1462.93], [-197.44, 1469.34]]],
  center: [-229.0, 1450.0],
  out: [-303.0, 1429.0],   // やられた後に戻る所 (時計の棟の門の外。gate.at から道路側へ)
  outFace: [-299.6, 1432.15],
};

const sm = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
const inPoly = (poly, x, z) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
};

// 敵 1 体の、状態と経過時間から姿勢を作る (model.js の setPose に渡す)。tools/dev/swarmview.html も使う
const DUR = { perch: 0.55, splat: 0.7, rise: 0.45, wind: 0.42, lunge: 0.22, recover: 0.5, hurt: 0.36 };
export function poseOf(e, t = e.t) {
  const p = { x: e.x, y: e.y, z: e.z, yaw: e.yaw, s: e.s, tint: e.tint || 0 };
  const w = Math.sin(t * 23 + e.seed * 5); // じたばた
  switch (e.st) {
    case 'perch': { // 屋上の縁で、両手をあげて身がまえ、少し沈んでから跳ぶ
      const u = t / DUR.perch;
      return Object.assign(p, { arm: 2.2 + w * 0.15, leg: 0.15, sq: 0.18 * sm((u - 0.5) * 2), pitch: -0.15 * sm(u * 2) });
    }
    case 'fall': // 大の字でうつぶせに落ちる
      return Object.assign(p, { pitch: Math.min(1.5, 0.35 + t * 2.4), arm: 2.25 + w * 0.18, leg: 0.62 - w * 0.12, roll: Math.sin(t * 6 + e.seed) * 0.15 });
    case 'splat': { // べちゃっと着地 (横に広がって縮み、戻る)。手足がぴくぴく
      const b = t < 0.25 ? Math.sin(t / 0.25 * Math.PI) * 0.22 : 0;
      const tw = t > 0.35 ? Math.sin(t * 30) * 0.12 : 0;
      return Object.assign(p, { y: p.y + 0.05, pitch: Math.PI / 2, sq: b, arm: 2.3 + tw, leg: 0.6 - tw });
    }
    case 'rise': { // 足元を軸に起き上がる。腕で地面を押す
      const u = sm(t / DUR.rise);
      return Object.assign(p, { y: p.y + 0.05 * (1 - u), pitch: Math.PI / 2 * (1 - u), arm: 2.3 - u * 1.1, leg: 0.6 - u * 0.45, sq: -0.08 * Math.sin(u * Math.PI) });
    }
    case 'chase': { // 両手をあげて、よちよち走ってくる
      const ph = e.ph || 0, s = Math.sin(ph);
      return Object.assign(p, {
        y: p.y + Math.abs(Math.cos(ph)) * 0.09, roll: s * 0.14, pitch: 0.12,
        arm: 1.95 + Math.sin(ph * 2) * 0.22, swA: s * 0.35,
        leg: 0.1, legL: Math.max(0, s) * 0.35, legR: Math.max(0, -s) * 0.35, swL: s * 0.75,
      });
    }
    case 'wind': { // 体を反らせて、両手を高くあげてためる
      const u = sm(t / DUR.wind);
      return Object.assign(p, { pitch: -0.4 * u, arm: 2.0 + 0.6 * u + w * 0.05 * u, sq: 0.12 * u, leg: 0.2 });
    }
    case 'lunge': // 前へ飛びかかる (両手を前へ)
      return Object.assign(p, { pitch: 0.75, arm: 0.6, reach: 1.5, leg: 0.3, swL: -0.5, sq: -0.06 });
    case 'recover': {
      const u = sm(t / DUR.recover);
      return Object.assign(p, { pitch: 0.75 * (1 - u) + 0.12 * u, arm: 0.6 + 1.3 * u, reach: 1.5 * (1 - u), leg: 0.3 - 0.2 * u });
    }
    case 'hurt': { // のけぞる
      const u = t / DUR.hurt;
      return Object.assign(p, { pitch: -0.55 * Math.sin(Math.min(1, u * 1.6) * Math.PI / 2) * (1 - sm(u)), arm: 2.5, leg: 0.4, sq: -0.1 * (1 - u) });
    }
    case 'die': // 吹き飛んでくるくる回る
      return Object.assign(p, { pitch: -t * 14, arm: 2.6 + w * 0.2, leg: 0.8, tint: 0.5 });
  }
  return p;
}

const $ = (id) => document.getElementById(id);

export class Swarm {
  constructor({ scene, world, player, camera, onRespawn }) {
    this.world = world; this.player = player; this.camera = camera; this.onRespawn = onRespawn;
    this.herd = new Herd(scene, ALIVE + 2);
    this.fx = new Fx(scene);
    this.list = [];                 // 出ている敵
    this.state = 'idle';            // idle / run / down / done
    this.armed = true;              // 中庭の外へ出たら、また始められる
    this.ui = { box: $('swarm'), left: $('swarm-left'), hp: $('swarm-hp'), banner: $('swarm-banner'), hurt: $('mp-hurt'), time: $('swarm-time') };
    this.spawns = this.findSpawns();
    this.lastSpawnAt = new Map();
    this.clock = 0;
  }

  // 中庭に面した屋上の縁に、落ちてくる所を 2.5 m おきに並べる (屋根の高さは当たり判定から)
  findSpawns() {
    const out = [], [cx, cz] = SITE.center;
    for (const [[ax, az], [bx, bz]] of SITE.edges) {
      const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
      let nx = -uz, nz = ux;
      if ((cx - ax) * nx + (cz - az) * nz < 0) { nx = -nx; nz = -nz; } // 中庭の向き
      for (let s = 4; s <= len - 4; s += 2.5) {
        const ex = ax + ux * s, ez = az + uz * s;
        const rx = ex - nx * 0.6, rz = ez - nz * 0.6;
        const y = this.world.groundAt(rx, rz, 300);
        if (y < H(rx, rz) + 6) continue; // 屋上でない
        out.push({ x: ex - nx * 0.3, z: ez - nz * 0.3, y, nx, nz });
      }
    }
    return out;
  }

  get running() { return this.state === 'run' || this.state === 'down'; }

  start() {
    this.state = 'run'; this.armed = false;
    this.killed = 0; this.spawned = 0; this.hp = HP_P; this.inv = 0; this.time = 0; this.queue = 0; this.nextAt = 1.2; this.away = 0;
    this.lastSerial = -1;
    this.banner('ミズタマンの群れが降ってきた！', 2.5);
    this.ui.box.hidden = false;
    this.draw();
  }

  // 敵を全部消して終わる (pop = 水玉をはじけさせる)
  stop(pop) {
    for (const e of this.list) { if (pop) this.pop(e); this.herd.hide(e.slot); }
    this.list.length = 0;
    this.state = 'idle';
    this.ui.box.hidden = true;
  }

  banner(text, sec) {
    const b = this.ui.banner;
    b.textContent = text; b.hidden = false;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { b.hidden = true; }, sec * 1000);
  }

  draw() {
    this.ui.left.textContent = TOTAL - this.killed;
    this.ui.hp.firstChild.style.width = Math.max(0, this.hp / HP_P * 100) + '%';
  }

  freeSlot() {
    const used = new Set(this.list.map((e) => e.slot));
    for (let i = 0; i < this.herd.max; i++) if (!used.has(i)) return i;
    return -1;
  }

  // 屋上の縁に 1 体出す (身がまえてから跳ぶ)
  spawn() {
    const slot = this.freeSlot();
    if (slot < 0 || !this.spawns.length) return false;
    // 最近使っていない縁から、プレイヤーにやや近い所を選びやすく
    const p = this.player.pos;
    let best = null, bestS = -Infinity;
    for (let k = 0; k < 8; k++) {
      const c = this.spawns[Math.floor(Math.random() * this.spawns.length)];
      const last = this.lastSpawnAt.get(c) ?? -99;
      const sc = -Math.hypot(c.x - p.x, c.z - p.z) * 0.5 + Math.random() * 25 - (this.clock - last < 2 ? 100 : 0);
      if (sc > bestS) { bestS = sc; best = c; }
    }
    this.lastSpawnAt.set(best, this.clock);
    const a = (Math.random() - 0.5) * 0.7, ca = Math.cos(a), sa = Math.sin(a);
    const dx = best.nx * ca - best.nz * sa, dz = best.nx * sa + best.nz * ca;
    const vh = 4.5 + Math.random() * 2.5, vy = 4;
    const e = {
      slot, st: 'perch', t: 0, x: best.x, y: best.y, z: best.z, yaw: Math.atan2(dx, dz), dx, dz, vh, vy0: vy, vy: 0, vx: 0, vz: 0,
      hp: HP_E, speed: 2.6 + Math.random() * 1.1, s: 0.92 + Math.random() * 0.22, seed: Math.random() * 10, ph: Math.random() * 6, cd: 0.5, tint: 0, hit: -1,
    };
    // 着地点の予想 (赤い輪): 地面の高さを 2 回見直す
    let gx = e.x, gz = e.z;
    for (let k = 0; k < 2; k++) {
      const gy = H(gx, gz) + 0.18, h = e.y - gy, T = (vy + Math.sqrt(vy * vy + 2 * G * Math.max(0, h))) / G;
      gx = e.x + dx * vh * T; gz = e.z + dz * vh * T;
    }
    e.ring = { x: gx, y: this.world.groundAt(gx, gz, e.y - 3), z: gz, r: 0 };
    this.list.push(e);
    this.spawned++;
    return true;
  }

  pop(e) {
    const cy = e.y + BODY.y * e.s;
    this.fx.burst(e.x, cy, e.z, 18);
    this.fx.burst(e.x, cy, e.z, 6, ['#fbfbf7'], 3, 0.3, 0.6, 6);
  }

  setState(e, st) { e.st = st; e.t = 0; }

  update(dt) {
    this.clock += dt;
    const pl = this.player, p = pl.pos;
    if (this.state === 'idle') {
      const inside = inPoly(SITE.yard, p.x, p.z);
      if (!inside) this.armed = true;
      else if (this.armed && !pl.dead && !this.disabled) this.start();
    }
    if (this.running) this.step(dt);
    this.herd.flush();
    this.fx.update(dt, this.camera, this.list.map((e) => (e.st === 'perch' || e.st === 'fall') ? e.ring : null).filter(Boolean));
  }

  step(dt) {
    const pl = this.player, p = pl.pos, W = this.world;
    if (this.state === 'run') this.time += dt;
    this.inv -= dt;
    if (this.state === 'run' && this.ui.time) this.ui.time.textContent = fmt(this.time);

    // あきらめ: 中庭から遠く離れた (R でスタートに戻った・ワープした など)
    if (this.state === 'run') {
      const far = Math.hypot(p.x - SITE.center[0], p.z - SITE.center[1]) > DIST_GIVEUP;
      this.away = far ? this.away + dt : 0;
      if (this.away > T_GIVEUP || (far && Math.hypot(p.x - SITE.center[0], p.z - SITE.center[1]) > 400)) {
        this.stop(false); this.banner('ミズタマンたちは帰っていった', 3); return;
      }
    }

    // 出す: 一度に ALIVE 体まで、全部で TOTAL 体
    if (this.state === 'run') {
      this.nextAt -= dt;
      if (this.nextAt <= 0 && this.list.length < ALIVE && this.spawned < TOTAL) {
        this.spawn();
        this.nextAt = this.spawned < ALIVE ? 0.32 + Math.random() * 0.12 : 0.4 + Math.random() * 0.8;
      }
    }

    // プレイヤーの攻撃が当たったか
    const a = pl.lastAct;
    if (this.state === 'run' && a && a.type === 'atk' && trailOn(a.step, a.ph, a.t)) {
      const fx = Math.sin(pl.facing), fz = Math.cos(pl.facing);
      for (const e of this.list) {
        if (e.hit === pl.atkN || e.st === 'die' || e.st === 'perch' || e.st === 'fall') continue;
        const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
        if (d > REACH[a.step] * Math.max(1, e.s) || Math.abs(e.y - p.y) > 2) continue;
        if (d > 0.7 && Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) > ARC[a.step]) continue;
        e.hit = pl.atkN;
        e.hp -= DMG_E[a.step];
        const nx = d > 0.05 ? dx / d : fx, nz = d > 0.05 ? dz / d : fz;
        e.yaw = Math.atan2(-nx, -nz);
        e.hold = 0.07; // ほんの少し止まる (手ごたえ)
        e.tint = 1;
        this.fx.burst(e.x, e.y + 0.9, e.z, 5, ['#ffffff', '#ffe08a'], 4, 0.14, 0.35, 8);
        if (e.hp <= 0) {
          const k = a.step >= 3 ? 9 : 7;
          e.vx = nx * k; e.vz = nz * k; e.vy = 5.5 + Math.random() * 1.5;
          this.setState(e, 'die');
        } else {
          e.vx = nx * 5; e.vz = nz * 5;
          this.setState(e, 'hurt');
        }
      }
    }

    // 敵を動かす
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.hold > 0) { e.hold -= dt; this.herd.setPose(e.slot, poseOf(e)); continue; }
      e.t += dt;
      e.tint = Math.max(0, e.tint - dt * 5);
      const tx = p.x - e.x, tz = p.z - e.z, td = Math.hypot(tx, tz) || 1;
      switch (e.st) {
        case 'perch':
          e.ring.r = 1.3 * sm(e.t / DUR.perch);
          if (e.t >= DUR.perch) { this.setState(e, 'fall'); e.vx = e.dx * e.vh; e.vz = e.dz * e.vh; e.vy = e.vy0; }
          break;
        case 'fall': {
          e.ring.r = 1.3 + Math.sin(this.clock * 12) * 0.1;
          e.vy -= G * dt;
          e.x += e.vx * dt; e.z += e.vz * dt; e.y += e.vy * dt;
          const g = W.groundAt(e.x, e.z, e.y - e.vy * dt);
          if (e.y <= g && e.vy < 0) {
            e.y = g; this.setState(e, 'splat');
            const q = { x: e.x, y: e.y, z: e.z }; W.resolve(q, R_E); e.x = q.x; e.z = q.z;
            this.fx.dust(e.x, e.y, e.z, 12, 1.2);
          }
          break;
        }
        case 'splat': if (e.t >= DUR.splat) this.setState(e, 'rise'); break;
        case 'rise': if (e.t >= DUR.rise) { this.setState(e, 'chase'); e.cd = 0.3 + Math.random() * 0.8; } break;
        case 'chase': {
          e.cd -= dt;
          const want = Math.atan2(tx, tz);
          let d = want - e.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
          e.yaw += d * (1 - Math.exp(-8 * dt));
          if (this.state === 'run' && !pl.dead && td < 1.45 && e.cd <= 0 && Math.abs(p.y - e.y) < 1.5) { this.setState(e, 'wind'); break; }
          const sp = this.state === 'run' && td > 1.0 ? e.speed : 0;
          e.vx += (tx / td * sp - e.vx) * (1 - Math.exp(-6 * dt));
          e.vz += (tz / td * sp - e.vz) * (1 - Math.exp(-6 * dt));
          e.ph += dt * (4 + Math.hypot(e.vx, e.vz) * 2.6);
          this.move(e, dt);
          break;
        }
        case 'wind':
          e.yaw = Math.atan2(tx, tz);
          e.vx *= Math.exp(-10 * dt); e.vz *= Math.exp(-10 * dt); this.move(e, dt);
          if (e.t >= DUR.wind) { this.setState(e, 'lunge'); e.vx = Math.sin(e.yaw) * 6.5; e.vz = Math.cos(e.yaw) * 6.5; e.struck = false; }
          break;
        case 'lunge':
          this.move(e, dt);
          if (!e.struck && e.t >= 0.06) this.strike(e);
          if (e.t >= DUR.lunge) { this.setState(e, 'recover'); }
          break;
        case 'recover':
          e.vx *= Math.exp(-8 * dt); e.vz *= Math.exp(-8 * dt); this.move(e, dt);
          if (e.t >= DUR.recover) { this.setState(e, 'chase'); e.cd = 0.9 + Math.random() * 1.2; }
          break;
        case 'hurt':
          e.vx *= Math.exp(-7 * dt); e.vz *= Math.exp(-7 * dt); this.move(e, dt);
          if (e.t >= DUR.hurt) { this.setState(e, 'chase'); e.cd = 0.4 + Math.random() * 0.6; }
          break;
        case 'die': {
          e.vy -= G * dt;
          e.x += e.vx * dt; e.z += e.vz * dt; e.y += e.vy * dt;
          const g = W.groundAt(e.x, e.z, e.y + 1);
          if (e.t > 0.55 || (e.y < g && e.t > 0.15)) {
            e.y = Math.max(e.y, g);
            this.pop(e); this.herd.hide(e.slot); this.list.splice(i, 1);
            if (this.state === 'run') { this.killed++; this.hp = Math.min(HP_P, this.hp + HEAL_KILL); this.draw(); }
            continue;
          }
          break;
        }
      }
      this.herd.setPose(e.slot, poseOf(e));
    }
    this.separate();

    // やられた → 少し待って、門の外へ戻る
    if (this.state === 'down') {
      this.downT += dt;
      if (this.downT > 2.6) {
        this.stop(true);
        this.player.revive();
        this.onRespawn(SITE.out[0], SITE.out[1], Math.atan2(SITE.outFace[0] - SITE.out[0], SITE.outFace[1] - SITE.out[1]));
        this.banner(`やられた…　${this.killed} 体撃破。門をくぐると再挑戦`, 4);
      }
    } else if (this.state === 'run' && this.killed >= TOTAL) {
      this.stop(false);
      this.banner(`クリア！　${TOTAL} 体撃破　タイム ${fmt(this.time)}`, 6);
    }
  }

  // 体当たり: 正面の近くにプレイヤーがいたら当たる
  strike(e) {
    const pl = this.player, p = pl.pos;
    const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz);
    if (d > 1.3 || Math.abs(p.y - e.y) > 1.4) return;
    if (d > 0.3 && (dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw)) / d < 0.2) return;
    e.struck = true;
    if (this.state !== 'run' || this.inv > 0 || pl.dead) return;
    this.inv = INVULN;
    this.hp -= DMG_P;
    pl.hurt(dx / (d || 1), dz / (d || 1), 1);
    const h = this.ui.hurt; h.classList.remove('on'); void h.offsetWidth; h.classList.add('on');
    this.fx.burst(p.x, p.y + 1.1, p.z, 6, ['#ff6b6b', '#ffd166'], 3.5, 0.14, 0.4, 8);
    if (this.hp <= 0) { this.hp = 0; this.state = 'down'; this.downT = 0; pl.down(); this.banner('やられた…', 2.5); }
    this.draw();
  }

  // 地面の上を動かす (建物・柵には当たる)。段差は吸い付く
  move(e, dt) {
    const q = { x: e.x + e.vx * dt, y: e.y, z: e.z + e.vz * dt };
    this.world.resolve(q, R_E);
    e.x = q.x; e.z = q.z;
    const g = this.world.groundAt(e.x, e.z, e.y + 0.4);
    e.y += (g - e.y) * Math.min(1, dt * 14);
  }

  // 敵どうし・プレイヤーと重ならないように押し離す
  separate() {
    const L = this.list, p = this.player.pos;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (a.st === 'perch' || a.st === 'fall' || a.st === 'die') continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (b.st === 'perch' || b.st === 'fall' || b.st === 'die') continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), m = R_E * 2;
        if (d >= m || d < 1e-4) continue;
        const k = (m - d) / d * 0.5;
        a.x -= dx * k; a.z -= dz * k; b.x += dx * k; b.z += dz * k;
      }
      const dx = a.x - p.x, dz = a.z - p.z, d = Math.hypot(dx, dz), m = R_E + 0.4;
      if (d < m && d > 1e-4 && Math.abs(a.y - p.y) < 1.5) { a.x += dx / d * (m - d); a.z += dz / d * (m - d); }
    }
  }
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
