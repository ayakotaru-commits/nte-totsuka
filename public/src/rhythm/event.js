// イベント「お札まき 合いの手」: 八坂神社 (旧東海道沿い) の境内に入ると、参加するかを聞く。
// 「はい」(Y / Enter / 画面のボタン) で、社殿の前で手本役と向かい合い、約 30 秒の 1 曲が始まる。
//   ・手本役が 1 小節うちわで打って見せ (太鼓の音)、次の 1 小節で同じリズムを返す (Space / J / クリック / タップ)
//   ・1 曲 = テンポ 110 の 14 小節: 前奏 1 → うちわ打ち 4 → お札まき 4 (裏拍が入る) → 伴奏が止まる 4 → 締めの一打 1
//     手本の打ち方は毎回、候補 (POOLS) から選び直す
//   ・判定はずれの大きさで 良 (±GOOD) / 可 (±OK)。外れるか打たないとミス。ずれ合わせ (遅れの測定) は無い (持ち主の希望)。
//     音が出ているときは、ブラウザが知らせる出力の遅れだけは自動で差し引く (audio.js の now())
//   ・終わると「名人」「まずまず」「もう一回」と、良・可・ミスの数。Y でもう一回、N でやめる
// 音はブラウザの中で合成する (audio.js)。音が出ないとき (消音・未操作) も、画面の合図 (手本役の動き・升目) だけで遊べる。
// 自分の画面だけの出来事 (マルチプレイのほかの人には見えない)。
// URL: ?rhythm 開いてすぐ境内で始める (聞かずに。確認用) / ?rhythm=auto さらに自動で打つ (確認用) / ?norhythm 無効に
import * as THREE from 'three';
import { makeCharacter } from '../character.js';
import { H } from '../terrain.js';
import * as A from './audio.js';
import { UnaaCrowd } from './unaa.js';

export const BPM = 110;
const BEAT = 60 / BPM, SLOT = BEAT / 2, BAR = BEAT * 4;
export const GOOD = 0.07, OK = 0.13;     // 判定の幅 (秒)。ずれ合わせが無いので広め
const NEAR = 0.25;                       // この範囲で外れた打ちは、近い拍のミスとして数える (連打でごまかせないように)
const LEAD_IN = 0.9;                     // 「はい」から前奏の 1 拍目まで (秒)
const BARS = 14, FINAL = 13;             // 小節の数、締めの一打の小節
// 区切り: 手本の小節 (bar, bar + 2)、返す小節 (bar + 1, bar + 3)
const SECTIONS = [
  { bar: 1, kind: 'uchiwa', name: 'うちわ打ち' },
  { bar: 5, kind: 'ofuda', name: 'お札まき' },
  { bar: 9, kind: 'stop', name: '音が止まっても 続けて！' },
];
const SILENT = new Set([10, 12]);        // 拍子木の伴奏が止まる小節
// 手本の打ち方の候補 (1 小節を 8 分音符 8 つに分けた位置。0, 2, 4, 6 が表拍)。[1 回目の候補, 2 回目の候補]
// 手本の小節の 4 拍目 (6・7) は空けておき、そこで「はい！」の合図を出す (返す小節の 1 打目に備えられるように)
const POOLS = {
  uchiwa: [[[0, 2, 4], [0, 4], [0, 2, 4]], [[0, 2, 3, 4], [0, 1, 2, 4], [0, 2, 3, 4]]],
  ofuda: [[[1, 3, 4], [0, 3, 4], [0, 1, 3]], [[0, 1, 3, 4], [1, 2, 3, 4], [0, 1, 2, 3]]],
  stop: [[[0, 2, 4], [0, 1, 2, 4], [0, 2, 3]], [[0, 3, 4], [0, 2, 3, 4], [0, 1, 4]]],
};
const CUE = 6;                           // 「はい！」の合図を出す位置 (手本の小節の 4 拍目)
const RING = BEAT * 1.5;                 // 次に打つ升目のまわりの輪が、この秒数前から縮み始める
const AUDIO_WAIT = 1.5;                  // 音の準備を待つ長さ (秒)。過ぎたら音なしで始める

// 場所 (八坂神社。city.json の境内の輪郭と、社殿の正面 = 石段の上のすぐ先)
// 社殿 (props.json の shrines[0]) の局所座標 (lx = 右手、lz = 正面の向き) → 世界。舞台は社殿の正面、石段 (鳥居) の上のすぐ先
const SH = { o: [-386.21, 634.48], yaw: 1.274 };
const W = (lx, lz) => {
  const fx = Math.sin(SH.yaw), fz = Math.cos(SH.yaw);
  return [+(SH.o[0] + fz * lx + fx * lz).toFixed(2), +(SH.o[1] - fx * lx + fz * lz).toFixed(2)];
};
const AX = -0.6; // 参道の筋 (石段・鳥居と社殿の正面を結ぶ線) の lx
export const SITE = {
  area: [[-401.6, 604.8], [-375.3, 610.0], [-369.3, 635.2], [-362.4, 637.5], [-364.6, 647.4], [-375.5, 643.8], [-379.3, 644.4], [-382.2, 651.7], [-392.1, 636.1], [-399.6, 616.5]],
  lead: W(AX, 5.8),   // 手本役 (社殿を背に、鳥居の方を向く)
  me: W(AX, 9.8),     // 自分 (石段の上から社殿へ 2〜3 m 進んだ所。社殿の方を向く)
  crowd: [5.8, 7.8, 9.8].flatMap((lz) => [-3.4, 3.4].map((d) => W(AX + d, lz))), // 見物人 (両脇)
  cam: { back: 4.2, side: -1.5, up: 3.2 },   // 舞台のカメラ (view())
  // うな○ーの立ち位置 (見物人の外側。手水舎・石碑・石垣を避ける)
  fans: [5.0, 7.0].flatMap((d) => [4.8, 6.8, 8.8, 10.8].flatMap((lz) => [-d, d].map((s) => W(AX + s, lz)))),
};
const CROWD_COL = [
  { hair: '#2a2226', jacket: '#3d5a8a', accent: '#f2e6c8' }, { hair: '#4a3328', jacket: '#8a3d4a', accent: '#f6d06a' },
  { hair: '#1f1c22', jacket: '#4f7a5a', accent: '#ffffff' }, { hair: '#3a2a20', jacket: '#7a5a8f', accent: '#f2c6d2' },
  { hair: '#262028', jacket: '#2f4f6f', accent: '#ffd36e' }, { hair: '#5a3a2a', jacket: '#a0563a', accent: '#f2ead8' },
];

const inPoly = (poly, x, z) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const $ = (id) => document.getElementById(id);

// 1 曲の譜面を作る: calls = 手本役が打つ時刻、targets = 返す時刻 (曲の頭からの秒)
export function makeChart() {
  const calls = [], targets = [];
  for (const s of SECTIONS) {
    for (let k = 0; k < 2; k++) {
      const bar = s.bar + 2 * k, slots = pick(POOLS[s.kind][k]);
      for (const sl of slots) {
        calls.push({ t: bar * BAR + sl * SLOT, bar, slot: sl, kind: s.kind });
        targets.push({ t: (bar + 1) * BAR + sl * SLOT, bar: bar + 1, slot: sl, kind: s.kind, res: null });
      }
    }
  }
  calls.push({ t: FINAL * BAR, bar: FINAL, slot: 0, kind: 'final' });  // 締めの一打は手本役もいっしょに打つ
  targets.push({ t: FINAL * BAR, bar: FINAL, slot: 0, kind: 'final', res: null });
  return { calls, targets };
}

// お札 (紙吹雪)。小さな板を InstancedMesh 1 つで
class Ofuda {
  constructor(scene, n = 260) {
    const cv = document.createElement('canvas'); cv.width = 16; cv.height = 24;
    const c = cv.getContext('2d');
    c.fillStyle = '#fbf7ec'; c.fillRect(0, 0, 16, 24);
    c.fillStyle = '#c8282e'; c.fillRect(3, 4, 10, 2); c.fillRect(6, 8, 4, 12);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.13, 0.2), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }), n);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    scene.add(this.mesh);
    this.p = []; this.n = n;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.s = new THREE.Vector3(1, 1, 1); this.v = new THREE.Vector3();
  }
  // (x, y, z) から、向き (dx, dz) へ広がりながら舞い上がる
  burst(x, y, z, dx, dz, k, spread = 1) {
    for (let i = 0; i < k; i++) {
      if (this.p.length >= this.n) this.p.shift();
      const a = Math.atan2(dx, dz) + (Math.random() - 0.5) * 1.6 * spread, sp = 1.5 + Math.random() * 2.5;
      this.p.push({ x, y, z, vx: Math.sin(a) * sp, vy: 2.5 + Math.random() * 3 * spread, vz: Math.cos(a) * sp,
        rx: Math.random() * 6, ry: Math.random() * 6, wr: 3 + Math.random() * 6, age: 0, life: 2.5 + Math.random(), g: null });
    }
  }
  update(dt, groundAt) {
    this.p = this.p.filter((p) => (p.age += dt) < p.life);
    let i = 0;
    for (const p of this.p) {
      if (p.g == null) p.g = groundAt(p.x, p.z);
      if (p.y > p.g + 0.02) {
        p.vy = Math.max(p.vy - 7 * dt, -0.9);                // ひらひら落ちる (落ちる速さに上限)
        const k = Math.exp(-1.8 * dt); p.vx *= k; p.vz *= k;
        p.x += (p.vx + Math.sin(p.age * p.wr) * 0.5) * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rx += p.wr * dt; p.ry += p.wr * 0.7 * dt;
      } else { p.y = p.g + 0.02; p.rx = Math.PI / 2; }
      this.e.set(p.rx, p.ry, 0); this.q.setFromEuler(this.e);
      this.m.compose(this.v.set(p.x, p.y, p.z), this.q, this.s);
      this.mesh.setMatrixAt(i++, this.m);
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Rhythm {
  constructor({ scene, world, player, camera, cam }) {
    this.scene = scene;
    this.world = world; this.player = player; this.camera = camera; this.cam = cam;
    this.state = 'idle';        // idle / ask / play / result
    this.armed = true;          // 境内の外へ出たら、また聞く
    this.answer = null;         // 画面のボタンで選んだ答え
    this.useAudio = false;
    this.ground = (x, z) => world.groundAt(x, z, H(x, z));
    // 手本役 (いつも境内に立っている) と見物人 (曲の間だけ)
    const mk = (colors, x, z, face) => {
      const m = makeCharacter({ vrm: false, colors });
      m.root.position.set(x, this.ground(x, z), z); m.root.rotation.y = face;
      scene.add(m.root);
      return m;
    };
    const [lx, lz] = SITE.lead, [mx, mz] = SITE.me;
    this.faceMe = Math.atan2(lx - mx, lz - mz);            // 自分 → 手本役 の向き
    this.lead = mk({ hair: '#1e1a1c', jacket: '#7d1f2b', accent: '#ffffff' }, lx, lz, this.faceMe + Math.PI);
    this.crowd = SITE.crowd.map(([x, z], i) => {
      const m = mk(CROWD_COL[i % CROWD_COL.length], x, z, Math.atan2((lx + mx) / 2 - x, (lz + mz) / 2 - z));
      m.root.visible = false;
      return m;
    });
    this.ofuda = new Ofuda(scene);
    // 大吉のたびに加わるうな○ー (SITE.fans の順に。境内の外に出る所は使わない)
    this.unaa = new UnaaCrowd(scene, this.ground, SITE.fans.filter(([x, z]) => inPoly(SITE.area, x, z)), [(lx + mx) / 2, (lz + mz) / 2]);
    this.hype = 0;
    this.ui = {
      ask: $('rh-ask'), hud: $('rh-hud'), label: $('rh-label'), cells: $('rh-cells'), prog: $('rh-prog'), banner: $('rh-banner'),
      judge: $('rh-judge'), hint: $('rh-hint'), tap: $('rh-tap'), result: $('rh-result'), rank: $('rh-rank'), count: $('rh-count'),
      touch: $('touch-ui'),
    };
    this.cellEls = this.ui.cells ? [...this.ui.cells.children] : [];
    for (const [id, a] of [['rh-yes', 'yes'], ['rh-no', 'no'], ['rh-again', 'yes'], ['rh-quit', 'no']]) {
      const b = $(id);
      if (b) b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.answer = a; });
    }
    // 打つ入力は、キー・クリック・タップの瞬間の時刻 (ev.timeStamp) で判定する (1 コマの長さに左右されない)
    const onKey = (ev) => {
      if (this.state !== 'play' || ev.repeat || !(ev.code === 'Space' || ev.code === 'KeyJ')) return;
      this.hit(this.evTime(ev.timeStamp));
    };
    const onPtr = (ev) => {
      if (this.state !== 'play' || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      if (ev.target && ev.target.closest && ev.target.closest('button')) return;
      this.hit(this.evTime(ev.timeStamp));
    };
    addEventListener('keydown', onKey, { capture: true });
    addEventListener('pointerdown', onPtr, { capture: true });
    if (this.ui.tap) this.ui.tap.addEventListener('pointerdown', (ev) => ev.preventDefault());
    this.lastLead = -9; this.lastMe = -9;
  }

  get playing() { return this.state === 'play' || this.state === 'result'; }
  // 時計 (秒)。曲の間は、始めたときに選んだ時計を使い続ける (途中で音が出るようになっても飛ばない)
  clock() { return this.useAudio ? A.now() : performance.now() / 1000; }
  evTime(stamp) { return this.clock() - (performance.now() - stamp) / 1000; }
  songT() { return this.clock() - this.t0; }

  show(el, on) { if (el) el.hidden = !on; }
  ask(on) {
    this.answer = null;
    if (on) this.state = 'ask'; else if (this.state === 'ask') this.state = 'idle';
    this.show(this.ui.ask, on);
  }

  // 舞台の中にある木 (幹や枝がカメラや人をさえぎる) を、曲の間だけ消す (社殿の局所座標で、舞台と見物人の範囲)
  hideTrees() {
    this.showTrees();
    const fx = Math.sin(SH.yaw), fz = Math.cos(SH.yaw);
    for (const name of ['trees_trunk', 'trees_crown']) {
      const im = this.scene.getObjectByName(name);
      if (!im) continue;
      const m = new THREE.Matrix4(), z = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        const x = m.elements[12] - SH.o[0], zz = m.elements[14] - SH.o[1];
        const lx = x * fz - zz * fx, lz = x * fx + zz * fz;
        if (lx < AX - 8 || lx > AX + 9 || lz < 2 || lz > 16) continue;
        (this.hiddenTrees || (this.hiddenTrees = [])).push({ im, i, m: m.clone() });
        im.setMatrixAt(i, z);
      }
      im.instanceMatrix.needsUpdate = true;
    }
  }
  showTrees() {
    if (!this.hiddenTrees) return;
    for (const t of this.hiddenTrees) { t.im.setMatrixAt(t.i, t.m); t.im.instanceMatrix.needsUpdate = true; }
    this.hiddenTrees = null;
  }

  start() {
    this.hideTrees();
    this.ask(false); this.show(this.ui.result, false);
    const pl = this.player, [mx, mz] = SITE.me;
    pl.teleport(mx, mz); pl.facing = this.faceMe;
    this.chart = makeChart();
    this.state = 'play'; this.armed = false;
    this.t0 = null;                               // 音の準備ができたら begin() で決める
    this.useAudio = false; this.waitUntil = this.clock() + AUDIO_WAIT;
    if (A.wake()) this.begin();
    this.unaa.clear();
    this.hype = 0; this.lastLead = -9; this.lastMe = -9; this.bannerOff = null;
    this.calls = this.chart.calls.slice();
    this.banners = [
      [0, 'せーの！'], ...SECTIONS.map((s) => [s.bar * BAR, s.name]), [12 * BAR + 2 * BEAT, '最後は いっしょに！'],
    ];
    this.cues = this.callBars().map((b) => b * BAR + CUE * SLOT); // 「はい！」を出す時刻
    for (const c of this.crowd) c.root.visible = true;
    pl.perf = () => ({ type: 'fan', u: this.clock() - this.lastMe, lift: this.lift() });
    this.show(this.ui.hud, true); this.show(this.ui.hint, true); this.show(this.ui.tap, true);
    if (this.ui.touch) this.ui.touch.style.visibility = 'hidden';
    document.body.classList.add('rh-on'); // 地図の名前の札を隠す (style.css)
    this.setBanner('');
    if (this.ui.label) this.ui.label.textContent = '準備中…';
    this.cellEls.forEach((el) => { el.className = ''; el.style.outlineOffset = ''; });
  }

  // 曲を始める (音の時計がそろってから。音が出ないときは performance.now() の時計で)
  begin() {
    this.useAudio = A.audioOn();
    this.t0 = this.clock() + LEAD_IN;
    if (this.ui.hint) this.ui.hint.classList.toggle('mute', !this.useAudio);
    // 音はまとめて予約する (前奏 = 太鼓 4 つ、伴奏 = 拍子木、手本 = 太鼓、区切り = 鈴、返す前の合図 = 鈴を小さく)
    const T = this.t0;
    for (let b = 0; b < 4; b++) A.play('taiko', T + b * BEAT, 0.55);
    for (let bar = 1; bar < FINAL; bar++) {
      if (SILENT.has(bar)) continue;
      for (let b = 0; b < 4; b++) A.play('clap', T + bar * BAR + b * BEAT, b === 0 ? 1.2 : 0.8);
    }
    for (const c of this.chart.calls) A.play('taiko', T + c.t, c.kind === 'final' ? 1.3 : 1);
    for (const s of SECTIONS) A.play('bell', T + s.bar * BAR, 0.6);
    for (const b of this.callBars()) A.play('cue', T + b * BAR + CUE * SLOT);
  }
  // 手本の小節の番号
  callBars() { return [...new Set(this.chart.calls.filter((c) => c.kind !== 'final').map((c) => c.bar))]; }

  // 締めの一打の前に、うちわを高く掲げる度合い
  lift() {
    if (this.state !== 'play' || this.t0 == null) return 0;
    const t = this.songT();
    return t > 12 * BAR + 2 * BEAT && t < FINAL * BAR + 0.05 ? Math.min(1, (t - 12 * BAR - 2 * BEAT) / BEAT) : 0;
  }

  // 打った (時刻 t。clock() の基準)
  hit(t) {
    if (this.state !== 'play' || this.t0 == null) return;
    const st = t - this.t0;
    this.lastMe = t;
    A.play('fan');
    // まだ判定していない拍のうち、いちばん近いもの
    let best = null, bd = 1e9;
    for (const g of this.chart.targets) {
      if (g.res) continue;
      const d = st - g.t;
      if (Math.abs(d) < Math.abs(bd)) { bd = d; best = g; }
    }
    if (!best || Math.abs(bd) > NEAR) { this.flash('×', 'stray'); return; }
    const ad = Math.abs(bd);
    best.d = bd;
    best.res = ad <= GOOD ? 'good' : ad <= OK ? 'ok' : 'miss';
    this.judged(best);
  }
  judged(g) {
    const [mx, mz] = SITE.me, [lx, lz] = SITE.lead;
    const y = this.ground(mx, mz) + 1.6, dx = lx - mx, dz = lz - mz;
    if (g.res === 'miss') {
      A.play('kyo'); this.flash(g.d == null ? '凶' : g.d < 0 ? '凶 はやい' : '凶 おそい', 'miss');
      this.hype = Math.max(0, this.hype - 0.25);
      this.omikuji(g, '凶');
      return;
    }
    A.play(g.res === 'good' ? 'daikichi' : 'kichi');
    if (g.res === 'good' && this.unaa.add()) this.hype = Math.min(1, this.hype + 0.1); // 大吉のたびに、うな○ーが 1 体加わる
    this.flash(g.res === 'good' ? '大吉！' : '吉', g.res);
    this.omikuji(g, g.res === 'good' ? '大' : '吉');
    this.hype = Math.min(1, this.hype + (g.res === 'good' ? 0.3 : 0.15));
    if (g.kind === 'ofuda') this.ofuda.burst(mx, y, mz, dx, dz, g.res === 'good' ? 10 : 5);
    if (g.kind === 'final') {
      this.ofuda.burst(mx, y, mz, dx, dz, 40, 2.2);
      this.ofuda.burst(lx, y, lz, -dx, -dz, 40, 2.2);
    }
  }

  // 升目 (おみくじの短冊) に運勢の字を出す。字は次の手本の小節に切り替わるまで残る (drawCells が毎コマ付ける)
  omikuji(g, ch) { g.ch = ch; }
  flash(text, cls) {
    const j = this.ui.judge;
    if (!j) return;
    j.textContent = text; j.className = cls;
    void j.offsetWidth; j.classList.add('pop');
  }
  setBanner(text) {
    if (!this.ui.banner) return;
    this.ui.banner.textContent = text; this.ui.banner.hidden = !text;
  }

  finish() {
    this.state = 'result';
    const T = this.chart.targets, n = T.length;
    const c = { good: 0, ok: 0, miss: 0 };
    for (const g of T) c[g.res || 'miss']++;
    const score = (c.good + 0.6 * c.ok) / n;
    const rank = score >= 0.85 ? '大吉！' : score >= 0.55 ? '吉' : '凶…';
    this.last = { ...c, n, score, rank };
    if (this.ui.rank) { this.ui.rank.textContent = rank; this.ui.rank.className = score >= 0.85 ? 'top' : score >= 0.55 ? 'mid' : 'low'; }
    if (this.ui.count) this.ui.count.textContent = `大吉 ${c.good}　吉 ${c.ok}　凶 ${c.miss}`;
    this.show(this.ui.hud, false); this.show(this.ui.hint, false); this.show(this.ui.tap, false);
    this.show(this.ui.result, true); this.setBanner('');
    if (score >= 0.55) A.play('cheer', null, score >= 0.85 ? 1.2 : 0.7);
    if (score >= 0.85) A.play('daikichi', this.clock() + 0.15, 1.3); else if (score < 0.55) A.play('kyo', this.clock() + 0.15, 1.2);
    this.answer = null;
  }

  stop() {
    if (this.state === 'idle') return;
    if (this.state === 'ask') return this.ask(false);
    this.state = 'idle';
    this.player.perf = null;
    for (const c of this.crowd) c.root.visible = false;
    this.unaa.clear(); this.showTrees();
    for (const el of [this.ui.hud, this.ui.hint, this.ui.tap, this.ui.result]) this.show(el, false);
    this.setBanner('');
    if (this.ui.touch) this.ui.touch.style.visibility = '';
    document.body.classList.remove('rh-on');
    const p = this.player;
    this.cam.yaw = p.facing + Math.PI; this.cam.update(0, p.pos, true);
  }

  update(dt, input) {
    if (this.disabled) return;
    const p = this.player, key = (k) => input && input.pressed(k);
    const inside = inPoly(SITE.area, p.pos.x, p.pos.z);
    if (this.state === 'idle' || this.state === 'ask') {
      if (!inside) { this.armed = true; if (this.state === 'ask') this.ask(false); }
      else if (this.armed && this.state === 'idle') {
        if (this.auto) { this.auto = false; this.start(); }
        else { this.armed = false; this.ask(true); }
      }
      if (this.state === 'ask') {
        if (key('KeyY') || key('Enter') || this.answer === 'yes') this.start();
        else if (key('KeyN') || this.answer === 'no') this.ask(false);
      }
    } else if (Math.hypot(p.pos.x - SITE.me[0], p.pos.z - SITE.me[1]) > 2) {
      this.stop(); // R でスタート地点に戻った・地図でワープした
    }

    if (this.state === 'play') this.updatePlay();
    else if (this.state === 'result') {
      if (key('KeyY') || key('Enter') || this.answer === 'yes') this.start();
      else if (key('KeyN') || key('Escape') || this.answer === 'no') this.stop();
    }
    this.hype = Math.max(0, this.hype - dt * 0.12);
    this.updateActors(dt);
  }

  updatePlay() {
    if (this.t0 == null) { // 音の準備を待っている
      if (A.wake() || this.clock() > this.waitUntil) this.begin();
      else return;
    }
    const t = this.songT(), T = this.chart.targets;
    // 自動で打つ (?rhythm=auto。確認用): 拍の時刻ちょうどに
    if (this.autoPlay) for (const g of T) if (!g.res && t >= g.t) this.hit(this.t0 + g.t + (Math.random() - 0.5) * 0.03);
    // 過ぎてしまった拍はミス
    // (少し待ってから。重い端末で、キーの知らせが 1 コマ遅れて届いても、正しく判定できるように)
    for (const g of T) if (!g.res && t > g.t + OK + 0.08) { g.res = 'miss'; g.d = null; this.judged(g); }
    // 手本役が打った (音は予約済み。動きだけ)
    while (this.calls.length && this.calls[0].t <= t) { this.lastLead = this.t0 + this.calls.shift().t; }
    // 表示
    while (this.banners.length && this.banners[0][0] <= t) { this.setBanner(this.banners.shift()[1]); this.bannerOff = t + 1.6; }
    while (this.cues.length && this.cues[0] <= t) { this.cues.shift(); this.flash('はい！', 'cue'); }
    if (this.bannerOff != null && t > this.bannerOff) { this.setBanner(''); this.bannerOff = null; }
    this.drawCells(t);
    if (this.ui.prog) this.ui.prog.style.width = Math.max(0, Math.min(100, t / (BARS * BAR) * 100)) + '%';
    if (t > BARS * BAR + 0.6) this.finish();
  }

  // 8 つの升目: 手本の小節は手本役が打つと光り、返す小節は自分の結果の色になる。今の位置の印も (伴奏が止まる小節では出さない)。
  // 手本の小節の 4 拍目 (「はい！」の合図) からは、次に返す小節の升目を先に見せる。
  // 次に打つ升目のまわりには輪が出て、打つ瞬間に向けて縮む (音が出なくても、打つ時刻が分かるように)
  drawCells(t) {
    let bar = Math.floor(t / BAR);
    const isCallBar = (b) => this.chart.calls.some((c) => c.bar === b && c.kind !== 'final');
    const preview = isCallBar(bar) && t >= bar * BAR + CUE * SLOT; // 合図の後: 次の小節を見せる
    if (preview) bar += 1;
    const call = this.chart.calls.filter((c) => c.bar === bar && c.kind !== 'final');
    const resp = this.chart.targets.filter((g) => g.bar === bar);
    const isCall = call.length > 0, slotNow = Math.floor((t - bar * BAR) / SLOT);
    if (this.ui.label) this.ui.label.textContent = bar < 1 ? '前奏' : bar >= FINAL ? '締め' : isCall ? 'お手本' : preview ? 'つぎは あなたの番' : 'あなたの番';
    if (this.ui.hud) this.ui.hud.dataset.mode = isCall ? 'call' : resp.length ? 'resp' : '';
    const next = this.chart.targets.find((g) => !g.res && g.t - t > -OK && g.t - t < RING);
    this.cellEls.forEach((el, i) => {
      let cls = '', txt = '';
      if (isCall) { const c = call.find((c) => c.slot === i); if (c) cls = t >= c.t ? 'lit' : 'mark'; }
      else { const g = resp.find((g) => g.slot === i); if (g) { cls = g.res ? g.res : 'mark'; txt = g.res ? (g.ch || (g.res === 'good' ? '大' : g.res === 'ok' ? '吉' : '凶')) : ''; } }
      if (!preview && i === slotNow && t >= 0 && bar < FINAL && !SILENT.has(bar)) cls += ' now';
      const ring = next && next.bar === bar && next.slot === i;
      if (ring) cls += ' ring';
      el.className = cls;
      if (el.textContent !== txt) el.textContent = txt;
      el.style.outlineOffset = ring ? Math.max(0, (next.t - t) / RING * 16).toFixed(1) + 'px' : '';
    });
  }

  // 手本役・見物人・お札・カメラ
  updateActors(dt) {
    const p = this.player, dx = p.pos.x - SITE.lead[0], dz = p.pos.z - SITE.lead[1];
    if (dx * dx + dz * dz > 90 * 90) return; // 遠いときは動かさない
    const play = this.playing;
    const now = this.clock();
    this.lead.update(dt, 0, true, 0, 0, play ? { type: 'fan', u: now - this.lastLead, lift: this.lift() } : null, false);
    if (play) {
      const ph = (this.state === 'play' && this.t0 != null ? this.songT() : now) / BEAT * Math.PI;
      const e = this.state === 'result' ? (this.last && this.last.score >= 0.55 ? 1 : 0.2) : this.hype;
      this.crowd.forEach((c, i) => {
        c.update(dt, 0, true, 0, 0, e > 0.15 ? { type: 'cheer', e, ph: ph + i * 0.7 } : null, false);
      });
    }
    this.ofuda.update(dt, this.ground);
    {
      const e = this.state === 'result' ? (this.last && this.last.score >= 0.55 ? 1 : 0.2) : this.hype;
      this.unaa.update(dt, this.camera, e, (this.state === 'play' && this.t0 != null ? this.songT() : now) / BEAT);
    }
    if (play) this.view();
  }

  // 自分の右後ろの少し上から、手本役と自分を見る
  view() {
    const [mx, mz] = SITE.me, [lx, lz] = SITE.lead;
    const ux = (lx - mx), uz = (lz - mz), L = Math.hypot(ux, uz), fx = ux / L, fz = uz / L;
    const g = this.ground(mx, mz);
    const c = SITE.cam; // 自分の後ろ・横・上。横の符号で、左右どちらから見るか (木の幹が入らない側)
    const eye = new THREE.Vector3(mx - fx * c.back - fz * c.side, g + c.up, mz - fz * c.back + fx * c.side);
    this.camera.position.copy(eye);
    this.camera.lookAt((mx + lx) / 2, g + 1.15, (mz + lz) / 2);
  }
}
