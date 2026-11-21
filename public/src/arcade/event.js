// イベント「プロジェクトセマイ ワンルームステージ！」(旧称: ゲームセンター リズムステージ。タイトーステーション 戸塚西口店の入口)。プロセカのような、6 レーンに降ってくるノーツを打つリズムゲーム。
//   ・店の入口 (路地側のガラスの扉の前) に少しとどまると、入るかを聞く。「はい」(Y / Enter / ボタン) で画面いっぱいのゲーム画面になる
//   ・曲えらびの画面: 難易度 (NORMAL / HARD)・ノーツの速さ・効果音・タイミングの調整。スタートで 約 2 秒の READY → 曲 (約 83 秒)
//   ・操作: キーボード S D F J K L (左から 6 レーン)。スマホ・タブレットは、画面のレーンをタップ。長押し・上へのフリックも
//   ・終わると結果 (ランク S/A/B/C・スコア・判定の数・最大コンボ・FAST/LATE)。ベストはブラウザに覚える
//   ・自分の画面だけの出来事 (マルチプレイのほかの人には見えない)。街の描画は止める (main.js)
// 曲と譜面: public/arcade/ (tools/music/ で作る)。判定・点数は game.js、画面は draw.js、音 (曲の再生・効果音) は rhythm/audio.js。
// URL: ?arcade 開いてすぐ曲えらびへ (確認用) / ?arcade=auto さらに自動で打つ (確認用。&diff=HARD &bot=0.15 で 15% を打たない) / ?noarcade 無効に
import * as A from '../rhythm/audio.js';
import { Game, FLICK_PX, WIN } from './game.js';
import { Stage } from './draw.js';

// 場所: 店の入口 (路地側の東の面。南の端から約 1.5〜11 m、壁から外へ 2.4 m)。扉は壁の南から 3.85 m と 9.85 m の所
export const SITE = {
  zone: [[-192.9, 168.37], [-190.34, 159.21], [-188.02, 159.86], [-190.58, 169.01]],
  center: [-190.5, 164.1],
  door: [-192.26, 166.1],
};
const KEYS = ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'];
export const LABELS = ['S', 'D', 'F', 'J', 'K', 'L'];
const SPEEDS = { slow: 1.5, normal: 1.15, fast: 0.9 };
const READY = 2.0;                 // 「はい」ではなく「スタート」から、曲の頭まで (秒)
const STORE = 'arcade.v1';
const STARS = { NORMAL: '★★☆☆', HARD: '★★★★' };
const SWAY = { off: 0, normal: 1, big: 1.7 };   // レーンのうねり・疾走線の強さ (draw.js の updateFx)
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };   // 動きを減らす設定の人は、最初は「なし」

const inPoly = (poly, x, z) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const $ = (id) => document.getElementById(id);
const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } };
const save = (o) => { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch (e) { /* 保存できない */ } };

export class Arcade {
  constructor({ player, onClose }) {
    this.player = player; this.onClose = onClose || (() => {});
    this.state = 'idle';        // idle / ask / loading / select / play / result
    this.armed = true; this.dwell = 0; this.answer = null;
    this.chart = null; this.buf = null; this.stage = null; this.game = null;
    this.cfg = Object.assign({ speed: 'normal', sway: reducedMotion() ? 'off' : 'normal', sfx: true, offset: 0, diff: 'NORMAL', song: null, best: {} }, load());
    for (const d of ['NORMAL', 'HARD']) if (this.cfg.best[d] != null) { this.cfg.best['pop1:' + d] = this.cfg.best[d]; delete this.cfg.best[d]; }  // 曲が 1 つだったころの記録は、最初の曲 (pop1) のものにする
    this.delta = 0; this.held = new Array(6).fill(false); this.heldN = new Array(6).fill(0); this.ptrs = new Map();
    this.ui = {
      ask: $('ar-ask'), root: $('ar-root'), cv: $('ar-canvas'), sel: $('ar-select'), res: $('ar-result'), touch: $('touch-ui'),
    };
    this.bindDom();
  }
  get active() { return this.state === 'loading' || this.state === 'select' || this.state === 'play' || this.state === 'result'; }
  get playing() { return this.state === 'play'; }
  show(el, on) { if (el) el.hidden = !on; }

  // ---- 時計: 音の時計 (耳に届いている時刻) を、performance.now() に滑らかに合わせる ----
  now() { return performance.now() / 1000 + this.delta; }
  evT(stamp) { return stamp / 1000 + this.delta; }
  chartT(t) { return t - this.t0 + this.cfg.offset / 1000; }

  // ---- 入力 ----
  bindDom() {
    const act = (a, v) => this.act(a, v);
    if (this.ui.root) this.ui.root.addEventListener('click', (ev) => {
      const b = ev.target.closest && ev.target.closest('[data-act]');
      if (!b) return;
      ev.preventDefault(); ev.stopPropagation();
      act(b.dataset.act, b.dataset.v);
    });
    for (const [id, a] of [['ar-yes', 'yes'], ['ar-no', 'no']]) {
      const b = $(id);
      if (b) b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.answer = a; });
    }
    addEventListener('keydown', (ev) => this.onKey(ev), { capture: true });
    addEventListener('keyup', (ev) => this.onKeyUp(ev), { capture: true });
    addEventListener('blur', () => this.releaseAll());
    const cv = this.ui.cv;
    if (cv) {
      cv.addEventListener('pointerdown', (ev) => this.onPtrDown(ev));
      cv.addEventListener('pointermove', (ev) => this.onPtrMove(ev));
      for (const t of ['pointerup', 'pointercancel']) cv.addEventListener(t, (ev) => this.onPtrUp(ev));
      cv.addEventListener('contextmenu', (ev) => ev.preventDefault());
    }
    addEventListener('resize', () => { if (this.stage && this.active) this.stage.resize(); });
  }
  onKey(ev) {
    if (!this.active) return;
    const c = ev.code;
    if (this.state === 'play') {
      const lane = KEYS.indexOf(c);
      if (lane >= 0) {
        ev.preventDefault(); ev.stopPropagation();
        if (!ev.repeat && !this.keyDown?.[lane]) { (this.keyDown || (this.keyDown = []))[lane] = true; this.press(lane, this.evT(ev.timeStamp), false); }
      } else if (c === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this.quitPlay(); }
      return;
    }
    // 曲えらび・結果の画面のキー
    if (c === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this.act(this.state === 'result' ? 'select' : 'exit'); }
    else if (this.state === 'select' && (c === 'ArrowLeft' || c === 'ArrowRight')) { ev.preventDefault(); ev.stopPropagation(); this.act('diff', c === 'ArrowLeft' ? 'NORMAL' : 'HARD'); }
    else if ((c === 'Enter' || c === 'Space') && (this.state === 'select' || this.state === 'result')) { ev.preventDefault(); ev.stopPropagation(); this.act(this.state === 'select' ? 'start' : 'retry'); }
    else if (KEYS.includes(c) || c === 'KeyY' || c === 'KeyN') ev.stopPropagation(); // 街の操作に回さない
  }
  onKeyUp(ev) {
    const lane = KEYS.indexOf(ev.code);
    if (lane < 0 || !this.keyDown?.[lane]) return;
    this.keyDown[lane] = false;
    if (this.state === 'play') { ev.stopPropagation(); this.release(lane, this.evT(ev.timeStamp)); }
  }
  releaseAll() {
    for (let l = 0; l < 6; l++) { if (this.keyDown) this.keyDown[l] = false; while (this.heldN[l] > 0) this.release(l, this.now()); }
    this.ptrs.clear();
  }
  onPtrDown(ev) {
    if (this.state !== 'play' || !this.stage) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.preventDefault();
    const q = this.stage.quit, r = ev.target.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    if (Math.hypot(x - q.x, y - q.y) < q.r + 8) { this.quitPlay(); return; }
    const lane = this.stage.laneAt(x), swipe = ev.pointerType !== 'mouse';
    try { ev.target.setPointerCapture(ev.pointerId); } catch (e) { /* 使えない */ }
    this.ptrs.set(ev.pointerId, { lane, y0: y, swiped: false });
    this.press(lane, this.evT(ev.timeStamp), swipe);
  }
  onPtrMove(ev) {
    const p = this.ptrs.get(ev.pointerId);
    if (!p || this.state !== 'play' || !this.game) return;
    const rc = ev.target.getBoundingClientRect(), nl = this.stage.laneAt(ev.clientX - rc.left);
    if (nl !== p.lane && this.game.slideTo(p.lane, nl, this.chartT(this.evT(ev.timeStamp)))) {   // 長押しのまま、となりのレーンへ指をすべらせた
      this.heldN[p.lane] = Math.max(0, this.heldN[p.lane] - 1); this.held[p.lane] = this.heldN[p.lane] > 0;
      this.heldN[nl]++; this.held[nl] = true; p.lane = nl;
    }
    if (p.swiped) return;
    const y = ev.clientY - rc.top;
    if (p.y0 - y >= FLICK_PX) { p.swiped = true; this.game.swipe(p.lane, this.chartT(this.evT(ev.timeStamp))); }
  }
  onPtrUp(ev) {
    const p = this.ptrs.get(ev.pointerId);
    if (!p) return;
    this.ptrs.delete(ev.pointerId);
    if (this.state === 'play') this.release(p.lane, this.evT(ev.timeStamp));
  }
  press(lane, tEv, swipe) {
    if (!this.game || this.t0 == null) return;
    this.heldN[lane]++; this.held[lane] = true;
    this.game.press(lane, this.chartT(tEv), swipe);
  }
  release(lane, tEv) {
    if (!this.game || this.heldN[lane] <= 0) return;
    if (--this.heldN[lane] > 0) return;
    this.held[lane] = false;
    this.game.release(lane, this.chartT(tEv));
  }

  // ---- 画面の操作 (ボタン・キー) ----
  act(a, v) {
    if (a === 'diff' && this.state === 'select') { this.cfg.diff = v; save(this.cfg); this.renderSelect(); }
    else if (a === 'song') this.pickSong(v);
    else if (a === 'sway') { this.cfg.sway = v; save(this.cfg); this.renderSelect(); }
    else if (a === 'speed') { this.cfg.speed = v; save(this.cfg); this.renderSelect(); }
    else if (a === 'sfx') { this.cfg.sfx = !this.cfg.sfx; save(this.cfg); this.renderSelect(); }
    else if (a === 'off') { this.cfg.offset = Math.max(-300, Math.min(300, this.cfg.offset + (+v))); save(this.cfg); this.renderSelect(); }
    else if (a === 'start' && (this.state === 'select')) this.start();
    else if (a === 'retry' && this.state === 'result') this.start();
    else if (a === 'select' && this.state === 'result') { this.state = 'select'; this.show(this.ui.res, false); this.show(this.ui.sel, true); this.renderSelect(); }
    else if (a === 'exit' && (this.state === 'select' || this.state === 'loading' || this.state === 'result')) this.close();
  }

  // ---- 入口 ----
  ask(on) {
    this.answer = null;
    if (on) this.state = 'ask'; else if (this.state === 'ask') this.state = 'idle';
    this.show(this.ui.ask, on);
  }
  // 曲の一覧と、えらんでいる曲の譜面・音を、聞く表示のうちに読み始める
  prefetch() {
    if (this.pre) return this.pre;
    this.pre = (async () => {
      try { if (!this.songs) this.songs = (await (await fetch('arcade/songs.json')).json()).songs; } catch (e) { this.err = '曲の一覧を読み込めませんでした'; return; }
      if (!this.songs.some((x) => x.id === this.cfg.song)) this.cfg.song = this.songs[0].id;
      await this.loadSong(this.cfg.song);
    })();
    return this.pre;
  }
  // 1 曲の譜面と音 (読んだものは覚えておく)
  async loadSong(id) {
    const sg = this.songs.find((x) => x.id === id);
    const c = (this.cache || (this.cache = {}))[id] || (this.cache[id] = {});
    if (!c.chart) { try { c.chart = await (await fetch('arcade/' + sg.chart)).json(); } catch (e) { this.err = '譜面を読み込めませんでした'; } }
    if (c.buf === undefined) { try { c.buf = await A.decode(await (await fetch('arcade/' + sg.audio)).arrayBuffer()); } catch (e) { c.buf = null; } } // 曲なしでも遊べる
    return c;
  }
  get song() { return this.songs && this.songs.find((x) => x.id === this.cfg.song); }
  // 曲をえらぶ (読み込みが終わるまで、スタートは押せない)
  async pickSong(id) {
    if (this.state !== 'select' || id === this.cfg.song && this.chart) return;
    this.cfg.song = id; save(this.cfg);
    this.picking = id; this.renderSelect();
    const c = await this.loadSong(id);
    if (this.picking !== id) return;
    this.picking = null;
    this.chart = c.chart; this.buf = c.buf;
    if (this.stage && this.chart) this.stage.setChart(this.chart);
    this.renderSelect();
  }
  bestKey(d) { return this.cfg.song + ':' + d; }
  async enter() {
    this.ask(false);
    this.state = 'loading';
    document.exitPointerLock?.();
    this.show(this.ui.root, true); this.show(this.ui.sel, true); this.show(this.ui.res, false);
    if (this.ui.touch) this.ui.touch.style.visibility = 'hidden';
    document.body.classList.add('ar-on');
    A.wake();
    this.renderSelect();
    await this.prefetch();
    if (this.state !== 'loading') return;
    const c0 = this.song && this.cache && this.cache[this.song.id];
    if (c0) { this.chart = c0.chart; this.buf = c0.buf; }
    if (this.chart && !this.stage) this.stage = new Stage(this.ui.cv, this.chart);
    if (this.stage) this.stage.resize();
    this.state = 'select';
    this.renderSelect();
    if (this.autoPlay) this.start();
  }
  close() {
    A.stopSong(0.2);
    this.releaseAll();
    this.state = 'idle'; this.armed = false; this.dwell = 0; this.game = null;
    this.show(this.ui.root, false); this.show(this.ui.sel, false); this.show(this.ui.res, false);
    if (this.ui.touch) this.ui.touch.style.visibility = '';
    document.body.classList.remove('ar-on');
    this.onClose();
  }

  // ---- 曲えらび ----
  renderSelect() {
    const el = this.ui.sel; if (!el) return;
    const busy = this.state !== 'select' || !!this.picking;
    // 曲の一覧
    const box = el.querySelector('#ar-songs');
    if (this.songs && box.dataset.n !== String(this.songs.length)) {
      box.dataset.n = String(this.songs.length); box.textContent = '';
      for (const sg of this.songs) {
        const b = document.createElement('button');
        b.className = 'ar-chip song'; b.dataset.act = 'song'; b.dataset.v = sg.id; b.textContent = sg.title;
        box.appendChild(b);
      }
    }
    for (const b of box.children) b.classList.toggle('on', b.dataset.v === this.cfg.song);
    const sg = this.song;
    if (sg) {
      el.querySelector('.ar-title').textContent = sg.title;
      el.querySelector('.ar-meta').textContent = `BPM ${sg.bpm}　約 ${Math.floor(sg.duration / 60)} 分 ${Math.round(sg.duration % 60)} 秒${sg.note ? '　' + sg.note : ''}`;
      el.querySelector('#ar-credit').textContent = sg.credit || '';
    }
    const D = !this.picking && this.chart && this.chart.difficulties;
    for (const b of el.querySelectorAll('[data-act="diff"]')) {
      const d = b.dataset.v, st = D && D[d] && D[d].stats;
      b.classList.toggle('on', this.cfg.diff === d);
      b.querySelector('.n').textContent = st ? `${st.notes} ノーツ` : '…';
      b.querySelector('.b').textContent = this.cfg.best[this.bestKey(d)] ? `ベスト ${String(this.cfg.best[this.bestKey(d)]).padStart(6, '0')}` : 'ベスト --';
      b.querySelector('.s').textContent = STARS[d];
    }
    for (const b of el.querySelectorAll('[data-act="speed"]')) b.classList.toggle('on', this.cfg.speed === b.dataset.v);
    for (const b of el.querySelectorAll('[data-act="sway"]')) b.classList.toggle('on', this.cfg.sway === b.dataset.v);
    const sfx = el.querySelector('[data-act="sfx"]'); sfx.textContent = this.cfg.sfx ? '効果音 ON' : '効果音 OFF'; sfx.classList.toggle('on', this.cfg.sfx);
    el.querySelector('#ar-off').textContent = (this.cfg.offset > 0 ? '+' : '') + this.cfg.offset + ' ms';
    const info = el.querySelector('#ar-info');
    info.textContent = this.err ? this.err : busy ? 'よみこみ中…' : !this.buf ? '（曲を読み込めませんでした。音なしで遊べます）' : (A.audioOn() ? '' : '（音が出ていません。画面を触ると鳴ります）');
    el.querySelector('[data-act="start"]').disabled = busy || !this.chart;
  }

  // ---- 曲を始める ----
  start() {
    if (!this.chart || !this.stage) return;
    A.wake();
    this.show(this.ui.sel, false); this.show(this.ui.res, false);
    this.releaseAll();
    this.diff = this.cfg.diff;
    this.game = new Game(this.chart.difficulties[this.diff].notes);
    this.game.onEvent = (e) => this.sfx(e);
    this.stage.resetPlay(); this.stage.resize();
    this.delta = A.audioOn() ? A.now() - performance.now() / 1000 : 0;
    this.t0 = this.now() + READY;
    this.useAudio = A.startSong(this.buf, this.t0);
    this.approach = SPEEDS[this.cfg.speed] || SPEEDS.normal;
    this.autoRel = new Array(6).fill(null);
    this.state = 'play'; this.endAt = null;
  }
  quitPlay() {
    A.stopSong(0.3);
    this.releaseAll();
    this.state = 'select'; this.game = null;
    this.show(this.ui.sel, true); this.renderSelect();
  }

  sfx(e) {
    if (!this.cfg.sfx) return;
    const l = e.lane;
    if (e.type === 'hit') {
      if (e.flick) A.play('swish', null, 1, l);
      else { A.play('pon', null, e.grade === 'bad' ? 0.4 : 1, l); if (e.grade === 'perfect') A.play('sparkle', null, 1, l); }
    } else if (e.type === 'miss') A.play('miss', null, 0.35);
    else if (e.type === 'holdEnd') { if (e.ok) A.play('pon', null, 0.8, l + 1); else A.play('miss', null, 0.35); }
  }

  // ---- 結果 ----
  finishPlay() {
    this.state = 'result';
    A.stopSong(0.8);
    this.releaseAll();
    const s = this.game.summary();
    const prev = this.cfg.best[this.bestKey(this.diff)] || 0, isNew = s.score > prev;
    if (isNew && !this.autoPlay) { this.cfg.best[this.bestKey(this.diff)] = s.score; save(this.cfg); }
    this.last = s;
    const r = this.ui.res;
    r.querySelector('#ar-rank').textContent = s.rank; r.querySelector('#ar-rank').dataset.r = s.rank;
    r.querySelector('#ar-score').textContent = String(s.score).padStart(6, '0');
    r.querySelector('#ar-badge').textContent = s.allPerfect ? 'ALL PERFECT!!' : s.fullCombo ? 'FULL COMBO!' : '';
    r.querySelector('#ar-new').hidden = !isNew;
    const c = s.counts;
    r.querySelector('#ar-counts').innerHTML = [['PERFECT', c.perfect, 'p'], ['GREAT', c.great, 'g'], ['GOOD', c.good, 'o'], ['BAD', c.bad, 'b'], ['MISS', c.miss, 'm']]
      .map(([n, v, k]) => `<div class="c ${k}"><span>${n}</span><b>${v}</b></div>`).join('');
    r.querySelector('#ar-sub').textContent = `最大コンボ ${s.maxCombo} / ${s.total}　FAST ${s.fast}　LATE ${s.late}`;
    r.querySelector('#ar-diff').textContent = this.diff;
    r.querySelector('#ar-rsong').textContent = this.song ? this.song.title : '';
    this.show(this.ui.res, true);
    A.play(s.rank === 'S' || s.rank === 'A' ? 'fanfare' : 'kichi', null, 1);
    if (s.rank === 'S' || s.rank === 'A') A.play('cheer', this.now() + 0.4, 0.5);
  }

  // ---- 毎コマ ----
  update(dt, input) {
    if (this.disabled) return;
    const p = this.player, key = (k) => input && input.pressed(k);
    if (this.state === 'idle' || this.state === 'ask') {
      const inside = inPoly(SITE.zone, p.pos.x, p.pos.z);
      if (!inside) { this.armed = true; this.dwell = 0; if (this.state === 'ask') this.ask(false); }
      else if (this.armed && this.state === 'idle') {
        this.dwell += dt;
        if (this.dwell > 0.35) { this.armed = false; this.ask(true); this.prefetch(); }
      }
      if (this.autoOpen && this.state === 'idle') { this.autoOpen = false; this.prefetch(); this.enter(); return; }   // 確認用 (?arcade)
      if (this.state === 'ask') {
        if (key('KeyY') || key('Enter') || this.answer === 'yes') this.enter();
        else if (key('KeyN') || this.answer === 'no') this.ask(false);
      }
      return;
    }
    this.tick(dt);
  }
  tick(dt) {
    // 音の時計とのずれをゆっくり直す (音が出ているときだけ)
    if (A.audioOn()) {
      const d = A.now() - performance.now() / 1000;
      this.delta = this.state === 'play' && Math.abs(d - this.delta) < 0.5 ? this.delta + (d - this.delta) * 0.05 : d;
    }
    const st = this.stage;
    if (!st) return;
    const L = st.L, port = L.port;
    if (this.state === 'play' && this.game) {
      const t = this.chartT(this.now());
      if (this.autoPlay) this.bot(t);
      this.game.update(t, this.held);
      if (this.endAt == null && this.game.finished) this.endAt = Math.max(t, ...this.game.notes.map((n) => n.end)) + 1.4;
      st.frame({ mode: 'play', t, dt, sway: SWAY[this.cfg.sway] ?? 1, game: this.game, held: this.held, diff: this.diff, approach: this.approach, count: t < 0 ? -t : null,
        labels: LABELS, keysOn: !document.body.classList.contains('touch'), title: this.song ? this.song.title : '', credit: this.song ? this.song.credit : '' });
      if (this.endAt != null && t > this.endAt) this.finishPlay();
      if (!this.endAt && t > this.chart.duration + 2) this.finishPlay();
    } else {
      if (this.state === 'result') st.confetti(this.last && (this.last.rank === 'S' || this.last.rank === 'A') ? 2 : 0);
      st.frame({ mode: this.state === 'result' ? 'result' : 'bg', dt, sway: SWAY[this.cfg.sway] ?? 1, mx: port ? st.W * 0.5 : st.W * 0.15, my: port ? st.H * 0.9 : st.H * 0.66, mr: port ? Math.min(st.W, st.H) * 0.09 : Math.min(st.W, st.H) * 0.13 });
    }
  }

  // 自動で打つ (確認用。?arcade=auto)。bot = 打たない割合
  bot(t) {
    const g = this.game, skip = this.botSkip || 0;
    for (const n of g.notes) {
      if (n.state === 'wait' && t >= n.t + (n.jit ?? (n.jit = (Math.random() - 0.5) * 0.03))) {
        if (n.skip == null) n.skip = Math.random() < skip;
        if (n.skip) continue;
        this.heldN[n.lane]++; this.held[n.lane] = true;
        g.press(n.lane, n.t + n.jit, false);
        if (n.type !== 'hold') { this.heldN[n.lane]--; this.held[n.lane] = this.heldN[n.lane] > 0; }
      }
      if (n.state === 'hold') {
        const nx = g.nextSeg(n);
        if (nx && t >= nx.t) { const from = n.cur; g.press(nx.lane, nx.t, false); if (n.cur !== from) { this.heldN[from] = 0; this.held[from] = false; this.heldN[n.cur] = 1; this.held[n.cur] = true; } }
        if (t >= n.end) { this.heldN[n.cur] = 0; this.held[n.cur] = false; g.release(n.cur, n.end); }
      }
    }
  }
}
