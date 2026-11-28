// イベント「うな○ー大量発生クエスト」: グランシティの時計の棟の門をくぐって中庭に入ると、受けるかどうかを聞く表示が出る。
// 「はい」(Y / Enter / 画面のボタン) で始まり、まわりの棟の屋上から
// 敵キャラ「うな○ー」(見た目は swarm/model.js) が大の字で次々に落ちてきて、起き上がって襲ってくる。
//   ・一度に出るのは ALIVE 体まで。倒すと次が屋上から落ちてくる。全部で TOTAL 体倒すとクリア
//   ・落ちてくる所には地面に赤い輪が出る
//   ・攻撃 (J / クリック / 「攻撃」) の剣の軌跡が出ている間に、届く範囲 (REACH・ARC) にいる敵に当たる。
//     1・2 撃目は 1、3 撃目 (回転斬り) は 2 のダメージ。敵の体力は 2
//   ・敵は近づくと、ためてから体当たりしてくる。5 回当たるとやられる。やられると、近くの敵が次々に飛び乗って山のように重なり、
//     「やられた」の表示が出る。OK (Enter / Space / 画面のボタン) で門の外へ戻る (門をくぐると再挑戦)
//   ・100 体たおすと、3 倍の大きさで金色に光る「黄金のうな○ー」が上空から降りてきて、「伝説のうな○ー刀」をくれる。
//     受け取ると剣が金色 (刃に水玉、金の軌跡) になる。ブラウザに覚えておき、次に開いたときも金色のまま (localStorage)。
//     URL に ?nolegend で元の剣に戻す (覚えた分も消える)
//   ・中庭から遠く (DIST_GIVEUP m) 離れて数秒たつと、敵はいなくなる (R でスタート地点に戻ったときも)
// 自分の画面だけの出来事 (マルチプレイのほかの人には見えない)。
// 「いいえ」(N / 画面のボタン) を選ぶか、聞いている間に中庭から出ると、いったん中庭の外へ出るまでは聞かない。
// URL: ?swarm 開いてすぐ中庭で始める (聞かずに始める。確認用) / ?noswarm イベントを無効に
import { H } from '../terrain.js';
import { trailOn } from '../attack.js';
import * as THREE from 'three';
import { Herd, Fx, BODY } from './model.js';
import { EXP } from '../status.js';

export const TOTAL = 100, ALIVE = 50;
const G = 24;                                  // 重力 (player.js と同じ)
const R_E = 0.38;                              // 敵の体の半径
const HP_E = 2, DMG_E = [0, 1, 1, 2, 2, 2];    // 敵の体力、プレイヤーの攻撃の手順ごとのダメージ
const REACH = [0, 2.4, 2.4, 2.8, 2.8, 2.9];    // 剣が届く距離 (server/room.js より少し長め: 敵の体が平たく横に広いため)
const ARC = [0, 1.75, 1.75, 3.2, 3.2, 1.6];    // 正面から左右にこの角度 (rad) まで当たる (server/room.js と同じ)
const HP_P = 100, DMG_P = 20, INVULN = 1.0;    // プレイヤーの体力、体当たり 1 回で減る量 (5 回でやられる。持ち主の希望)、当たった後に当たらない時間
const HEAL_KILL = 0;                           // 1 体倒すと戻る体力 (5 回でやられるよう、戻さない)
const PILE_N = 16, PILE_DT = 0.09, PILE_H = 0.26; // やられたとき上に飛び乗って重なる数、飛び乗る間隔 (秒)、1 段の厚さ (m)
const DIST_GIVEUP = 80, T_GIVEUP = 4;
const GOLD = ['#fff3b0', '#ffd34d', '#ffe98a', '#ffffff', '#f2b832'];
const GIANT = 3;                               // 黄金のうな○ーの大きさ (ふつうの何倍)
const LEGEND_KEY = 'totsuka.unaLegend';        // 伝説のうな○ー刀を持っているか (localStorage)
const sx = (u) => 1 - Math.pow(1 - Math.max(0, Math.min(1, u)), 3);

// 伝説のうな○ー刀 (受け取る前に宙に浮かんで見えるもの)。金色の刃に水玉、赤い柄
function makeLegendSword() {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: '#ffd84a', emissive: '#ffc21a', emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.3 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 0.025), gold); blade.position.y = 0.8; g.add(blade);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0, 0.05, 0.16, 4), gold); tip.scale.z = 0.25; tip.position.y = 1.53; g.add(tip);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.08), new THREE.MeshStandardMaterial({ color: '#c8282e', emissive: '#5a0c10', metalness: 0.3, roughness: 0.5 })); guard.position.y = 0.13; g.add(guard);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 10), new THREE.MeshStandardMaterial({ color: '#3a2a1a', roughness: 0.8 })); grip.position.y = -0.02; g.add(grip);
  ['#f2789f', '#f6d34a', '#7cc4ea', '#e8434f', '#9ccc3c', '#b48ad8'].forEach((c, k) => {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.04, 12).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: c }));
    d.position.set(k % 2 ? 0.015 : -0.015, 0.35 + k * 0.19, 0); g.add(d);
  });
  g.scale.setScalar(1.5); g.visible = false;
  return g;
}

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
    case 'pile': { // やられたプレイヤーの上へ飛び乗る: 待つ間は身がまえ、飛んでいる間は大の字、乗ったらうつぶせでぴくぴく
      if (t < 0) return Object.assign(p, { pitch: -0.3, arm: 2.5 + w * 0.08, sq: 0.12, leg: 0.2 });
      if (t < e.dur) return Object.assign(p, { pitch: Math.min(Math.PI / 2, 0.3 + t / e.dur * 1.6), arm: 2.25 + w * 0.15, leg: 0.6 - w * 0.1 });
      const tw = Math.sin(t * 9 + e.seed * 3) * 0.15;
      return Object.assign(p, { pitch: Math.PI / 2, arm: 2.3 + tw, leg: 0.6 - tw, sq: t - e.dur < 0.2 ? Math.sin((t - e.dur) / 0.2 * Math.PI) * 0.15 : 0 });
    }
    case 'die': // 吹き飛んでくるくる回る
      return Object.assign(p, { pitch: -t * 14, arm: 2.6 + w * 0.2, leg: 0.8, tint: 0.5 });
  }
  return p;
}

const $ = (id) => document.getElementById(id);

export class Swarm {
  constructor({ scene, world, player, camera, onRespawn, status }) {
    this.world = world; this.player = player; this.camera = camera; this.onRespawn = onRespawn;
    this.status = status || null;   // ステータス (status.js)。HP・ダメージ・無敵時間・経験値・クリアのボーナス。無ければ以前の固定値
    this.hpMax = HP_P;
    this.herd = new Herd(scene, ALIVE + 2);
    this.goldHerd = new Herd(scene, 1, { gold: true }); // 最後に降りてくる黄金のうな○ー
    this.sword = makeLegendSword(); scene.add(this.sword);
    this.end = null;                // 最後の場面 { ph, t, x, y, z, ... }
    // 伝説のうな○ー刀を持っていたら、最初から金色の剣 (?nolegend で元に戻して忘れる)
    try {
      if (new URLSearchParams(location.search).has('nolegend')) localStorage.removeItem(LEGEND_KEY);
      else if (localStorage.getItem(LEGEND_KEY) === '1') player.model.setLegend?.(true);
    } catch (e) { /* 使えないブラウザでは覚えない */ }
    this.fx = new Fx(scene);
    this.list = [];                 // 出ている敵
    this.state = 'idle';            // idle / run / down / done
    this.armed = true;              // 中庭の外へ出たら、また始められる
    this.asking = false;            // 受けるかどうかを聞いている
    this.answer = null;             // 画面のボタンで選んだ答え ('yes' / 'no')
    this.ui = { end: $('swarm-end'), endTitle: $('swarm-end-title'), endText: $('swarm-end-text'), over: $('swarm-over'), overText: $('swarm-over-text'), ask: $('swarm-ask'), box: $('swarm'), left: $('swarm-left'), hp: $('swarm-hp'), banner: $('swarm-banner'), hurt: $('mp-hurt'), time: $('swarm-time') };
    this.spawns = this.findSpawns();
    this.lastSpawnAt = new Map();
    this.clock = 0;
    for (const [id, a] of [['swarm-yes', 'yes'], ['swarm-no', 'no'], ['swarm-ok', 'ok'], ['swarm-end-ok', 'ok']]) {
      const b = $(id);
      if (b) b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.answer = a; });
    }
  }

  ask(on) {
    this.asking = on; this.answer = null;
    if (this.ui.ask) this.ui.ask.hidden = !on;
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
    this.state = 'run'; this.armed = false; this.taken = 0; this.overShown = false;
    this.hpMax = this.status ? this.status.value('hp') : HP_P;
    this.killed = 0; this.spawned = 0; this.hp = this.hpMax; this.inv = 0; this.settled = false; this.time = 0; this.queue = 0; this.nextAt = 1.2; this.away = 0;
    this.lastSerial = -1;
    this.banner('うな○ーが屋上から降ってくる！', 2.5);
    this.ui.box.hidden = false;
    this.draw();
  }

  // 敵を全部消して終わる (pop = 水玉をはじけさせる)
  stop(pop) {
    for (const e of this.list) { if (pop) this.pop(e); this.herd.hide(e.slot); }
    this.list.length = 0;
    this.state = 'idle';
    this.ui.box.hidden = true;
    if (this.ui.over) this.ui.over.hidden = true;
  }

  banner(text, sec) {
    const b = this.ui.banner;
    b.textContent = text; b.hidden = false;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { b.hidden = true; }, sec * 1000);
  }

  draw() {
    this.ui.left.textContent = TOTAL - this.killed;
    this.ui.hp.firstChild.style.width = Math.max(0, this.hp / this.hpMax * 100) + '%';
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

  // input: キーの押した瞬間 (Y / Enter = はい、N = いいえ)。無ければ画面のボタンだけ
  update(dt, input) {
    this.clock += dt;
    const pl = this.player, p = pl.pos;
    if (this.state === 'idle') {
      const inside = inPoly(SITE.yard, p.x, p.z);
      if (!inside) { this.armed = true; if (this.asking) this.ask(false); }
      else if (this.armed && !pl.dead && !this.disabled) {
        if (this.auto) this.start();
        else { this.armed = false; this.ask(true); }
      }
      if (this.asking) {
        const key = (k) => input && input.pressed(k);
        if (key('KeyY') || key('Enter') || this.answer === 'yes') { this.ask(false); this.start(); }
        else if (key('KeyN') || this.answer === 'no') this.ask(false);
      }
    }
    if (this.running) this.step(dt, input);
    if (this.state === 'ending') this.stepEnding(dt, input);
    this.herd.flush(); this.goldHerd.flush();
    this.fx.update(dt, this.camera, this.list.map((e) => (e.st === 'perch' || e.st === 'fall') ? e.ring : null).filter(Boolean));
  }

  step(dt, input) {
    const pl = this.player, p = pl.pos, W = this.world;
    if (this.state === 'run') this.time += dt;
    this.inv -= dt;
    if (this.state === 'run' && this.ui.time) this.ui.time.textContent = fmt(this.time);

    // あきらめ: 中庭から遠く離れた (R でスタートに戻った・ワープした など)
    if (this.state === 'run') {
      const far = Math.hypot(p.x - SITE.center[0], p.z - SITE.center[1]) > DIST_GIVEUP;
      this.away = far ? this.away + dt : 0;
      if (this.away > T_GIVEUP || (far && Math.hypot(p.x - SITE.center[0], p.z - SITE.center[1]) > 400)) {
        this.stop(false); this.banner('うな○ーたちは帰っていった', 3); return;
      }
    }

    // 出す: 一度に ALIVE 体まで、全部で TOTAL 体 (やられた後も、まわりに集まってくるよう出し続ける)
    if (this.running) {
      this.nextAt -= dt;
      if (this.nextAt <= 0 && this.list.length < ALIVE && this.spawned < TOTAL) {
        this.spawn();
        this.nextAt = this.spawned < ALIVE ? 0.22 + Math.random() * 0.1 : 0.4 + Math.random() * 0.8;
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
        const hit = this.status ? this.status.rollAttack(DMG_E[a.step]) : { dmg: DMG_E[a.step], crit: false }; // 攻撃力・会心 (status.js)
        e.hp -= hit.dmg;
        if (hit.crit) this.fx.burst(e.x, e.y + 1.1, e.z, 6, ['#fff7a8', '#ffd34d'], 5, 0.16, 0.4, 8);
        this.status?.gainUlt(2);
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
          // やられた後は、山のまわりに集まり続ける (攻撃はしない。押し合いで山を囲む)
          const sp = (this.state === 'run' && td > 1.0) || (this.state === 'down' && td > 0.9) ? e.speed : 0;
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
        case 'pile': {
          if (e.t < 0) { e.yaw = Math.atan2(tx, tz); break; }
          const u = Math.min(1, e.t / e.dur);
          e.x = e.fx + (e.tx - e.fx) * u; e.z = e.fz + (e.tz - e.fz) * u;
          e.y = e.fy + (e.ty - e.fy) * u + Math.sin(u * Math.PI) * e.arc;
          if (u >= 1 && !e.landed) { e.landed = true; this.fx.dust(e.x, e.y, e.z, 5, 0.6); }
          break;
        }
        case 'die': {
          e.vy -= G * dt;
          e.x += e.vx * dt; e.z += e.vz * dt; e.y += e.vy * dt;
          const g = W.groundAt(e.x, e.z, e.y + 1);
          if (e.t > 0.55 || (e.y < g && e.t > 0.15)) {
            e.y = Math.max(e.y, g);
            this.pop(e); this.herd.hide(e.slot); this.list.splice(i, 1);
            if (this.state === 'run') { this.killed++; this.hp = Math.min(this.hpMax, this.hp + HEAL_KILL); this.status?.gainUlt(5); this.draw(); }
            continue;
          }
          break;
        }
      }
      this.herd.setPose(e.slot, poseOf(e));
    }
    this.separate();

    // やられた → 敵が上に重なり終わったら「やられた」の表示。OK で門の外へ戻る
    if (this.state === 'down') {
      this.downT += dt;
      if (!this.overShown && this.downT > this.pileEnd + 0.8) {
        this.overShown = true; this.answer = null;
        if (this.ui.overText) this.ui.overText.textContent = `${this.killed} 体たおした`;
        if (this.ui.over) this.ui.over.hidden = false;
        this.ui.box.hidden = true;
      }
      const key = (k) => input && input.pressed(k);
      if (this.overShown && (key('Enter') || key('Space') || key('KeyY') || this.answer === 'ok')) {
        this.answer = null;
        this.stop(true);
        this.player.revive();
        this.onRespawn(SITE.out[0], SITE.out[1], Math.atan2(SITE.outFace[0] - SITE.out[0], SITE.outFace[1] - SITE.out[1]));
        this.banner('門をくぐると再挑戦できます', 3);
      }
    } else if (this.state === 'run' && this.killed >= TOTAL) {
      this.startEnding();
    }
  }

  // ---- 最後の場面: 黄金のうな○ーが降りてきて、伝説のうな○ー刀をくれる ----
  // 終わったとき (やられた・クリア) に 1 回だけ: 倒した数の経験値。クリアなら、クリアの経験値と、初回のボーナス
  settle(cleared) {
    if (this.settled || !this.status) return;
    this.settled = true;
    const st = this.status;
    st.addExp(this.killed * EXP.kill + (cleared ? EXP.swarmClear : 0), `${this.killed} 体たおした　`);
    if (cleared) st.clearEvent('swarm');
  }

  startEnding() {
    this.settle(true);
    this.stop(false);
    this.state = 'ending';
    this.banner(`クリア！　${TOTAL} 体撃破　タイム ${fmt(this.time || 0)}`, 3.5);
    // 降りてくる所: プレイヤーの前 7 m (建物の中なら中庭の真ん中)
    const p = this.player.pos, f = this.player.facing;
    let x = p.x + Math.sin(f) * 7, z = p.z + Math.cos(f) * 7;
    if (!inPoly(SITE.yard, x, z) || this.world.insideAny(x, z)) [x, z] = SITE.center;
    const gy = this.world.groundAt(x, z, p.y + 2);
    this.end = { ph: 'wait', t: 0, x, z, gy, y: gy + 45, spark: 0 };
  }

  dialog(title, text) {
    this.answer = null;
    if (!this.ui.end) return;
    this.ui.endTitle.textContent = title; this.ui.endText.textContent = text;
    this.ui.end.hidden = !title;
  }

  stepEnding(dt, input) {
    const E = this.end, p = this.player.pos;
    E.t += dt;
    const yaw = Math.atan2(p.x - E.x, p.z - E.z);
    const ok = () => { const k = (c) => input && input.pressed(c); return k('Enter') || k('Space') || k('KeyY') || this.answer === 'ok'; };
    const next = (ph) => { E.ph = ph; E.t = 0; };
    const w = Math.sin(this.clock * 3);
    // 姿勢 (ふつうのうな○ーの姿勢を 3 倍に)
    const pose = { x: E.x, y: E.y, z: E.z, yaw, s: GIANT, arm: 2.2 + w * 0.12, leg: 0.15, pitch: 0, roll: w * 0.04 };
    // まわりにきらきら
    E.spark -= dt;
    const sparkle = (n, sp = 2.5) => { if (E.spark <= 0) { E.spark = 0.08; this.fx.burst(E.x, E.y + BODY.y * GIANT, E.z, n, GOLD, sp, 0.18, 0.9, 1.5); } };
    switch (E.ph) {
      case 'wait': if (E.t > 1.6) { next('descend'); this.fx.burst(E.x, E.gy + 30, E.z, 40, GOLD, 8, 0.3, 1.5, 2); } break;
      case 'descend': { // 両手をあげ、ゆっくりと降りてくる
        const u = sx(E.t / 4.5);
        E.y = E.gy + 45 * (1 - u);
        pose.y = E.y; pose.leg = 0.35; pose.arm = 2.4 + w * 0.1;
        sparkle(4);
        if (E.t >= 4.5) { next('land'); E.y = E.gy; this.fx.dust(E.x, E.gy, E.z, 24, 2.4); this.fx.burst(E.x, E.gy + 1, E.z, 30, GOLD, 6, 0.25, 1.2, 6); }
        break;
      }
      case 'land': // ふわっと着地して少し沈む
        pose.y = E.gy; pose.sq = Math.sin(Math.min(1, E.t / 0.5) * Math.PI) * 0.15;
        sparkle(2);
        if (E.t > 0.9) { next('talk'); this.dialog('黄金のうな○ー', 'よくぞ 100 体のうな○ーをたおした……。その腕前をたたえ、伝説のうな○ー刀を授けよう。'); }
        break;
      case 'talk':
        pose.y = E.gy; sparkle(2);
        if (E.t > 0.5 && ok()) { this.dialog(null); next('give'); }
        break;
      case 'give': { // 両手を高くあげると刀が現れ、くるくる回りながらプレイヤーの前へ降りてくる
        pose.y = E.gy; pose.arm = 2.75; pose.pitch = -0.12; sparkle(3, 3);
        const u = Math.min(1, E.t / 2.6), a = sx(Math.max(0, (E.t - 0.6) / 2.0));
        const hx = E.x, hy = E.gy + 5.6, hz = E.z;                    // 頭の上
        const tx = p.x + Math.sin(yaw + Math.PI) * 1.2, ty = p.y + 1.1, tz = p.z + Math.cos(yaw + Math.PI) * 1.2; // プレイヤーの前
        const S = this.sword;
        S.visible = true;
        S.position.set(hx + (tx - hx) * a, hy + (ty - hy) * a + Math.sin(a * Math.PI) * 1.2, hz + (tz - hz) * a);
        S.rotation.set(0, this.clock * 5, 0.2 * Math.sin(this.clock * 2));
        S.scale.setScalar(1.5 * Math.min(1, E.t / 0.5));
        if (Math.random() < 0.5) this.fx.burst(S.position.x, S.position.y + 1, S.position.z, 1, GOLD, 1, 0.12, 0.6, 1);
        if (u >= 1) { next('got'); this.dialog('伝説のうな○ー刀を手に入れた！', '金色に輝く二刀。斬ると金の軌跡が残る。'); }
        break;
      }
      case 'got': {
        pose.y = E.gy; sparkle(2);
        const S = this.sword; S.rotation.y = this.clock * 2; S.position.y += Math.sin(this.clock * 3) * 0.002;
        if (E.t > 0.5 && ok()) {
          this.dialog(null);
          S.visible = false;
          this.fx.burst(S.position.x, S.position.y + 1, S.position.z, 40, GOLD, 5, 0.22, 1, 4);
          this.player.model.setLegend?.(true);
          this.player.armedT = 0; // 剣を出して見せる
          try { localStorage.setItem(LEGEND_KEY, '1'); } catch (e) { /* 覚えられなくても続ける */ }
          next('leave');
        }
        break;
      }
      case 'leave': { // 手を振りながら空へ帰っていく
        const u = E.t / 3.5;
        pose.y = E.y = E.gy + 45 * u * u; pose.armL = Math.sin(this.clock * 9) * 0.5; pose.arm = 2.3; pose.leg = 0.35;
        sparkle(3);
        if (u >= 1) { this.goldHerd.hide(0); this.end = null; this.state = 'idle'; this.banner('伝説のうな○ー刀で街を歩こう', 3); return; }
        break;
      }
    }
    this.goldHerd.setPose(0, pose);
  }

  // 体当たり: 正面の近くにプレイヤーがいたら当たる
  strike(e) {
    const pl = this.player, p = pl.pos;
    const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz);
    if (d > 1.3 || Math.abs(p.y - e.y) > 1.4) return;
    if (d > 0.3 && (dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw)) / d < 0.2) return;
    e.struck = true;
    if (this.state !== 'run' || this.inv > 0 || pl.dead) return;
    this.inv = this.status ? this.status.value('inv') : INVULN;
    this.hp -= this.status ? this.status.hurtAmount(DMG_P) : DMG_P; this.taken++;
    this.status?.gainUlt(3);
    pl.hurt(dx / (d || 1), dz / (d || 1), 1);
    const h = this.ui.hurt; h.classList.remove('on'); void h.offsetWidth; h.classList.add('on');
    this.fx.burst(p.x, p.y + 1.1, p.z, 6, ['#ff6b6b', '#ffd166'], 3.5, 0.14, 0.4, 8);
    if (this.hp <= 0) { this.hp = 0; this.state = 'down'; this.downT = 0; this.settle(false); pl.down(); this.startPile(); }
    this.draw();
  }

  // やられた: 近くの敵から順に、プレイヤーの上へ飛び乗って重なる (山になる)
  startPile() {
    const p = this.player.pos, gy = this.world.groundAt(p.x, p.z, p.y + 0.5);
    const cand = this.list.filter((e) => e.st !== 'die' && e.st !== 'perch' && e.st !== 'fall')
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)).slice(0, PILE_N);
    this.pileEnd = 0;
    cand.forEach((e, k) => {
      const d = Math.hypot(e.x - p.x, e.z - p.z), a = Math.random() * Math.PI * 2, r = 0.15 + Math.random() * 0.35 * Math.max(0.3, 1 - k / PILE_N);
      Object.assign(e, { st: 'pile', t: -k * PILE_DT - Math.random() * 0.05, fx: e.x, fy: e.y, fz: e.z,
        tx: p.x + Math.cos(a) * r, tz: p.z + Math.sin(a) * r, ty: gy + 0.32 + k * PILE_H,
        dur: 0.45 + Math.min(0.5, d * 0.05), arc: 1.6 + k * 0.12 + Math.min(2, d * 0.15), landed: false, tint: 0, hold: 0 });
      e.yaw = Math.random() * Math.PI * 2;
      this.pileEnd = Math.max(this.pileEnd, -e.t + e.dur);
    });
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
      if (a.st === 'perch' || a.st === 'fall' || a.st === 'die' || a.st === 'pile') continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (b.st === 'perch' || b.st === 'fall' || b.st === 'die' || b.st === 'pile') continue;
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
