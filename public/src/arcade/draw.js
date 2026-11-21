// ゲームセンターのリズムゲームの画面 (canvas 2D)。カラフルでかわいい見た目を作る。ゲームの判定には関係しない (game.js)。
//   背景: 区間ごとに色が変わるパステルのグラデーション + 水玉 + ふわふわ漂う星・ハート・音符 + (サビは) 光の筋。拍に合わせて弾む
//   レーン: 6 色 (ピンク・オレンジ・黄・緑・水色・むらさき) のキャンディのようなノーツ。タップ = まるい粒、フリック = 星 (上向きの矢印)、長押し = リボン
//   ヒット: 輪・星のはじけ・レーンの光の柱。判定の文字 (PERFECT は虹色)。コンボは大きく弾む
//   マスコット: 丸いこぶた風の「ぽよ」(原作のあるキャラではなく、この画面用の絵)。拍に乗って弾み、成功で喜び、ミスで泣く
// 使い方: const st = new Stage(canvas, chart); st.resize(); 毎コマ st.frame({...}) (event.js)
import { SCENES } from './scenes.js';
export const FONT = '"Hiragino Maru Gothic ProN","Yu Gothic UI","Meiryo","Arial Rounded MT Bold","Noto Sans CJK JP","Noto Sans JP",sans-serif';
export const LANE_COL = ['#ff7eb6', '#ffa86b', '#ffd84d', '#6fdc9a', '#62c6ff', '#b48cff'];
export const LANE_DARK = ['#ff3d8f', '#ff7a2e', '#f0b400', '#2fb870', '#1e9cf0', '#8a54f0'];
export const GRADE_STYLE = {
  perfect: { text: 'PERFECT!', col: null },                 // 虹色
  great: { text: 'GREAT', col: '#ff6fae' },
  good: { text: 'GOOD', col: '#48b8ff' },
  bad: { text: 'BAD', col: '#a89bc8' },
  miss: { text: 'MISS', col: '#9aa0b4' },
};
const RAINBOW = ['#ff6b9a', '#ffa14a', '#ffe14a', '#5fe08a', '#4cc3ff', '#b58cff'];
// 区間ごとの背景の 3 色 (上・中・下)
const PAL = {
  intro: ['#ffd0ea', '#e3d2ff', '#cdeeff'],
  A: ['#ffe0f0', '#f0d6ff', '#d3efff'],
  B: ['#e6d6ff', '#c9d8ff', '#c6f2ff'],
  chorus: ['#fff0a0', '#ffc0dc', '#ffd2ae'],
  interlude: ['#c6ffee', '#c8e6ff', '#ead6ff'],
  big: ['#ffe8f4', '#fff3b0', '#d6f0ff'],
  outro: ['#ffd0ea', '#e3d2ff', '#cdeeff'],
};
// 区間ごとの勢い (うねりの大きさ・疾走線の数・背景の流れの速さに効く)
const ENERGY = { intro: 0.25, A: 0.4, B: 0.6, chorus: 1.0, big: 1.0, interlude: 0.7, outro: 0.5 };
const secKey = (n) => (n === 'A2' ? 'A' : n === 'B2' ? 'B' : n === 'chorus2' ? 'chorus' : n);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const easeOutBack = (x) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function starPath(g, cx, cy, ro, ri, n = 5, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ri : ro, a = rot + i * Math.PI / n;
    g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
}
function heartPath(g, cx, cy, s) {
  g.beginPath();
  g.moveTo(cx, cy + s * 0.9);
  g.bezierCurveTo(cx - s * 1.6, cy - s * 0.1, cx - s * 0.9, cy - s * 1.2, cx, cy - s * 0.4);
  g.bezierCurveTo(cx + s * 0.9, cy - s * 1.2, cx + s * 1.6, cy - s * 0.1, cx, cy + s * 0.9);
  g.closePath();
}
function notePath(g, cx, cy, s) { // ♪
  g.beginPath(); g.ellipse(cx - s * 0.25, cy + s * 0.55, s * 0.42, s * 0.3, -0.4, 0, Math.PI * 2);
  g.rect(cx + s * 0.1, cy - s * 0.85, s * 0.14, s * 1.4);
  g.moveTo(cx + s * 0.24, cy - s * 0.85); g.quadraticCurveTo(cx + s * 0.85, cy - s * 0.6, cx + s * 0.55, cy - s * 0.05);
  g.quadraticCurveTo(cx + s * 0.6, cy - s * 0.5, cx + s * 0.24, cy - s * 0.45);
  g.closePath();
}

// ---- 絵 (最初に 1 度だけ作る) ----
function makeSprites() {
  const S = {};
  S.tap = LANE_COL.map((col, i) => { // 丸いキャンディ
    const c = mk(160, 160), g = c.getContext('2d'), base = hex(col), dk = hex(LANE_DARK[i]);
    g.shadowColor = rgb(dk, 0.55); g.shadowBlur = 10; g.shadowOffsetY = 4;
    g.fillStyle = '#fff'; g.beginPath(); g.arc(80, 78, 70, 0, 7); g.fill();
    g.shadowColor = 'transparent';
    const gr = g.createLinearGradient(0, 18, 0, 140);
    gr.addColorStop(0, rgb(mix(base, [255, 255, 255], 0.55))); gr.addColorStop(0.55, col); gr.addColorStop(1, rgb(dk));
    g.fillStyle = gr; g.beginPath(); g.arc(80, 78, 59, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.62)'; g.beginPath(); g.ellipse(62, 50, 26, 14, -0.5, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.95)'; starPath(g, 80, 84, 20, 9); g.fill();
    return c;
  });
  S.hold = LANE_COL.map((col, i) => { // 長押しの頭: 丸 + 中に白いハート
    const c = mk(160, 160), g = c.getContext('2d');
    g.drawImage(S.tap[i], 0, 0);
    g.fillStyle = LANE_COL[i]; g.beginPath(); g.arc(80, 84, 26, 0, 7); g.fill();
    g.fillStyle = '#fff'; heartPath(g, 80, 84, 17); g.fill();
    return c;
  });
  S.flick = (() => { // 星
    const c = mk(176, 176), g = c.getContext('2d');
    g.shadowColor = 'rgba(255,90,160,.6)'; g.shadowBlur = 12; g.shadowOffsetY = 4;
    g.fillStyle = '#fff'; starPath(g, 88, 92, 82, 44); g.fill();
    g.shadowColor = 'transparent';
    const gr = g.createLinearGradient(0, 20, 0, 160); gr.addColorStop(0, '#fff0a0'); gr.addColorStop(0.5, '#ffc84a'); gr.addColorStop(1, '#ff7aa8');
    g.fillStyle = gr; starPath(g, 88, 92, 70, 37); g.fill();
    g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(70, 62, 18, 9, -0.6, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(88, 62); g.lineTo(112, 96); g.lineTo(96, 96); g.lineTo(96, 120); g.lineTo(80, 120); g.lineTo(80, 96); g.lineTo(64, 96); g.closePath(); g.fill();
    return c;
  })();
  S.heart = LANE_COL.map((col) => {
    const c = mk(96, 96), g = c.getContext('2d');
    g.fillStyle = '#fff'; heartPath(g, 48, 50, 36); g.fill();
    g.fillStyle = col; heartPath(g, 48, 50, 28); g.fill();
    g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.ellipse(34, 36, 8, 4, -0.6, 0, 7); g.fill();
    return c;
  });
  const glyph = (draw, size = 64) => { const c = mk(size, size), g = c.getContext('2d'); draw(g, size); return c; };
  S.star = glyph((g, s) => { g.fillStyle = '#fff'; starPath(g, s / 2, s / 2 + 2, s * 0.46, s * 0.2); g.fill(); });
  S.spark = glyph((g, s) => { g.fillStyle = '#fff'; starPath(g, s / 2, s / 2, s * 0.48, s * 0.09, 4, 0); g.fill(); });
  S.hrt = glyph((g, s) => { g.fillStyle = '#fff'; heartPath(g, s / 2, s / 2, s * 0.32); g.fill(); });
  S.note = glyph((g, s) => { g.fillStyle = '#fff'; notePath(g, s / 2, s / 2, s * 0.4); g.fill(); });
  S.dot = glyph((g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }, 96);
  S.polka = (() => { const c = mk(72, 72), g = c.getContext('2d'); g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(18, 18, 9, 0, 7); g.fill(); g.beginPath(); g.arc(54, 54, 9, 0, 7); g.fill(); return c; })();
  // 色をつけた小さな絵 (パーティクル用): 白い絵を、色ごとに塗り直す
  const tint = (src, col) => { const c = mk(src.width, src.height), g = c.getContext('2d'); g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height); return c; };
  S.tint = {};
  for (const k of ['star', 'spark', 'hrt', 'note']) S.tint[k] = [...LANE_COL, '#ffffff', '#ffe14a'].map((col) => tint(S[k], col));
  return S;
}

export class Stage {
  constructor(canvas, chart) {
    this.cv = canvas; this.g = canvas.getContext('2d');
    this.chart = chart;
    this.S = makeSprites();
    this.pat = this.g.createPattern(this.S.polka, 'repeat');
    this.pal = PAL.intro.map(hex);
    this.parts = [];          // パーティクル
    this.beams = new Array(6).fill(0);
    this.rings = [];          // 判定線の輪
    this.judge = null;        // { grade, t0, fl }
    // 動き (レーンのうねり・疾走感)。updateFx が毎コマ決める
    this.energy = 0.3; this.swT = 0; this.swA = 0; this.fxk = 0; this.rush = 0; this.breath = 0; this.nStreak = 0; this.wTcur = null;
    this.drift = 0;           // 背景の流れの進み (サビで速くなる)
    this.streaks = Array.from({ length: 44 }, () => ({ u: Math.random() * 6, p: Math.random() * 1.1, sp: 0.5 + Math.random() * 0.6, len: 0.1 + Math.random() * 0.14, c: Math.floor(Math.random() * 6) }));
    this.comboPop = 0;
    this.mood = { kind: 'happy', until: 0 };
    this.banner = null;
    this.scoreShown = 0;
    this.holdOn = new Array(6).fill(false);
    this.t = 0;
    this.floaters = Array.from({ length: 34 }, (_, i) => ({
      x: Math.random(), y: Math.random(), kind: ['star', 'hrt', 'note', 'spark'][i % 4], size: 0.018 + Math.random() * 0.03,
      sp: 0.012 + Math.random() * 0.03, ph: Math.random() * 6.28, col: i % 8, rot: Math.random() * 6.28,
    }));
    this.dots = Array.from({ length: 9 }, () => ({ x: Math.random(), y: Math.random(), r: 0.1 + Math.random() * 0.18, sp: 0.006 + Math.random() * 0.012, ph: Math.random() * 6.28 }));
    this.setChart(chart);
    this.quit = { x: 34, y: 34, r: 24 };
    this.resize();
  }

  // 曲を替える: 拍の時刻 (テンポが変わる曲でも合うように、小節ごとに作る)・区間・長さを、この譜面のものにする
  setChart(chart) {
    this.chart = chart;
    // 曲ごとの動く背景 (scenes.js)。無い曲は、いつもの背景
    const sid = chart.id || 'pop1';   // 自作のインスト曲の譜面 (chart.json) は id が無い
    const Sc = SCENES[sid];
    this.scenes = this.scenes || {};
    this.scene = Sc ? (this.scenes[sid] || (this.scenes[sid] = new Sc(this))) : null;
    this.beats = [];
    const bs = chart.barStart || [], bb = chart.barBpm || [];
    for (let i = 0; i < bb.length; i++) for (let k = 0; k < 4; k++) this.beats.push(bs[i] + k * 60 / bb[i]);
    this.bannerFor = null; this.banner = null;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(320, innerWidth), H = Math.max(240, innerHeight);
    this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr);
    this.cv.style.width = W + 'px'; this.cv.style.height = H + 'px';
    this.dpr = dpr; this.W = W; this.H = H;
    const port = W < H * 0.85;
    const wJ = port ? W * 0.96 : Math.min(W * 0.58, H * 1.08);
    this.L = { cx: W / 2, yJ: port ? H * 0.8 : H * 0.83, yT: port ? H * 0.2 : H * 0.13, wJ, wT: wJ * 0.52, port };
    this.wTcur = this.L.wT;
  }
  // 手前 (p = 0 = 判定線) から奥 (p = 1) への位置
  lw(p) { return lerp(this.L.wJ, this.wTcur ?? this.L.wT, p) / 6 * (1 + this.breath * Math.max(0, p)); }
  // うねり: 判定線 (p = 0) では 0 (打つ位置は動かない)、奥ほど大きく振れる。波は手前 (判定線) へ向かって進む
  cxAt(p) { if (!this.swA) return this.L.cx; const q = Math.max(0, p); return this.L.cx + this.swA * Math.pow(q, 1.25) * Math.sin(this.swT + q * 6.0); }
  px(lane, p) { return this.cxAt(p) + (lane - 2.5) * this.lw(p); }
  py(p) { return lerp(this.L.yJ, this.L.yT, p); }
  laneAt(x) { const k = (x - (this.L.cx - this.L.wJ / 2)) / (this.L.wJ / 6); return clamp(Math.floor(k), 0, 5); }

  beatInfo(t) { // 直前の拍からの経過 (0〜1) と、拍の番号
    const b = this.beats; if (!b.length || t < b[0]) return { ph: 1, i: -1 };
    let lo = 0, hi = b.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (b[m] <= t) lo = m; else hi = m - 1; }
    const nxt = b[lo + 1] ?? b[lo] + 0.35;
    return { ph: clamp((t - b[lo]) / (nxt - b[lo]), 0, 1), i: lo };
  }
  section(t) {
    for (const s of this.chart.sections) if (t >= s.start && t < s.end) return s;
    return t < 0 ? this.chart.sections[0] : this.chart.sections[this.chart.sections.length - 1];
  }

  // ゲームの出来事 (game.drain()) を、見た目に変える
  consume(events, shown) {
    const L = this.L;
    for (const e of events) {
      const lane = e.lane, x = this.px(lane, 0), y = L.yJ;
      if (e.type === 'hit') {
        this.beams[lane] = 1;
        this.rings.push({ lane, age: 0, col: lane, big: e.grade === 'perfect' });
        this.judge = { grade: e.grade, t0: this.t, fl: e.grade === 'perfect' || e.grade === 'miss' ? 0 : e.d < 0 ? -1 : 1 };
        if (e.grade === 'perfect' || e.grade === 'great' || e.grade === 'good') { this.comboPop = 1; }
        const n = e.grade === 'perfect' ? 12 : e.grade === 'great' ? 8 : e.grade === 'good' ? 5 : 2;
        this.burst(x, y, lane, n, e.flick ? 'up' : 'ring');
        if (e.grade === 'perfect') this.burst(x, y, 6, 4, 'sparkle');
        if (e.grade === 'perfect' || e.grade === 'great') this.mood = { kind: 'joy', until: this.t + 0.5 };
        if (e.grade === 'bad') this.mood = { kind: 'sad', until: this.t + 0.5 };
      } else if (e.type === 'miss') {
        this.judge = { grade: 'miss', t0: this.t, fl: 0 };
        this.mood = { kind: 'sad', until: this.t + 0.9 };
        this.burst(this.px(lane, 0), L.yJ, 7, 3, 'cloud');
      } else if (e.type === 'holdOn') {
        this.holdOn[lane] = true;
      } else if (e.type === 'holdEnd') {
        this.holdOn[lane] = false;
        if (e.ok) { this.burst(x, y, lane, 8, 'ring'); this.rings.push({ lane, age: 0, col: lane, big: false }); this.beams[lane] = 0.8; }
        else { this.judge = { grade: 'miss', t0: this.t, fl: 0 }; this.mood = { kind: 'sad', until: this.t + 0.9 }; }
      }
    }
  }
  burst(x, y, col, n, kind) {
    for (let i = 0; i < n; i++) {
      const a = kind === 'up' ? -Math.PI / 2 + (Math.random() - 0.5) * 1.8 : Math.random() * Math.PI * 2;
      const sp = (kind === 'cloud' ? 40 : 120) + Math.random() * 220;
      const sk = kind === 'cloud' ? 'dot' : ['star', 'hrt', 'note', 'spark'][Math.floor(Math.random() * 4)];
      this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === 'up' ? 120 : 40), g: kind === 'cloud' ? -20 : 380, age: 0, life: 0.55 + Math.random() * 0.5,
        kind: sk, col: col === 6 ? 6 + (i & 1) : col, size: 0.016 + Math.random() * 0.016, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 8 });
    }
    if (this.parts.length > 400) this.parts.splice(0, this.parts.length - 400);
  }

  resetPlay() { // 曲を始めるたびに、演出の状態を戻す
    this.parts = []; this.rings = []; this.beams.fill(0); this.holdOn.fill(false);
    this.judge = null; this.comboPop = 0; this.banner = null; this.bannerFor = null; this.scoreShown = 0; this.mood = { kind: 'happy', until: 0 };
  }
  confetti(n = 3) { // 結果の画面: 上から色とりどりの紙吹雪
    for (let i = 0; i < n; i++) {
      this.parts.push({ x: Math.random() * this.W, y: -20, vx: (Math.random() - 0.5) * 80, vy: 80 + Math.random() * 140, g: 40, age: 0, life: 3 + Math.random() * 1.5,
        kind: ['star', 'hrt', 'note', 'spark'][Math.floor(Math.random() * 4)], col: Math.floor(Math.random() * 8), size: 0.016 + Math.random() * 0.018, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 6 });
    }
  }

  // ---- 1 コマ ----
  // S: { t: 曲の時刻 (秒。始まる前は負)、dt、game、held: [6]、diff、approach (ノーツが降りる秒数)、mode: 'bg' | 'play' | 'result'、
  //      count: 始まるまでの秒数 (あれば READY / GO を出す)、labels: ['S','D',…]、keysOn }
  // 毎コマの動きの値: うねりの大きさ・位相、サビの勢い、疾走線。S.sway = 0 (なし) / 1 (ふつう) / 1.7 (おおきく)
  updateFx(t, dt, S, bi, pulse) {
    const k = S.sway ?? 0;
    const key = S.mode === 'play' ? secKey(this.section(t).name) : 'intro';
    this.energy += ((ENERGY[key] ?? 0.5) - this.energy) * Math.min(1, dt * 1.6);
    this.fxk = k;
    const hard = S.diff === 'HARD' ? 0.75 : 1;                                   // HARD は、ノーツが読みやすいように小さめ
    this.swA = k * hard * (this.L.wJ / 6) * (0.22 + 0.8 * this.energy + 0.2 * pulse);
    if (S.mode === 'play' && bi.i >= 0) this.swT = (bi.i + bi.ph) * (Math.PI / 4);   // 8 拍で 1 回り (テンポが変わっても曲に合う)
    else this.swT += dt * 1.2;
    this.rush = k > 0 ? this.energy : 0;
    this.breath = k * 0.04 * pulse;                                                // 拍でレーンが少し息をする (判定線は変わらない)
    this.wTcur = this.L.wJ * (0.52 - 0.07 * this.rush * Math.min(k, 1));          // サビは奥がぎゅっと狭い = 遠近が強い = 速く見える
    this.drift += dt * (1 + 1.5 * this.rush);
    this.nStreak = k > 0 ? Math.min(this.streaks.length, Math.round(6 + 26 * this.energy * Math.min(k, 1.4))) : 0;
    for (const s of this.streaks) {
      s.p -= dt * s.sp * (0.55 + 1.5 * this.rush);
      if (s.p < -0.2) { s.p = 1.05 + Math.random() * 0.2; s.u = Math.random() * 6; s.sp = 0.5 + Math.random() * 0.6; s.len = 0.1 + Math.random() * 0.14; s.c = Math.floor(Math.random() * 6); }
    }
  }

  frame(S) {
    const g = this.g, { W, H } = this, dt = Math.min(S.dt || 0.016, 0.05);
    this.t += dt;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const t = S.mode === 'play' ? S.t : -1, bi = this.beatInfo(t);
    const pulse = S.mode !== 'play' ? Math.pow(0.5 + 0.5 * Math.sin(this.t * Math.PI * 2 * 1.4), 3) : bi.i < 0 ? 0 : Math.pow(1 - bi.ph, 3);
    this.updateFx(t, dt, S, bi, pulse);
    this.drawBackground(t, dt, pulse, S.mode, S);
    if (S.mode === 'play' && S.game) {
      this.consume(S.game.drain(), S);
      this.drawField(t, S, pulse);
      this.drawBanner(t);
      this.drawNotes(t, S);
      this.drawRings(dt, S);
    }
    this.drawParts(dt);
    if (S.mode === 'play') this.drawHud(t, S, pulse);
    this.drawMascot(t, pulse, S);
    if (S.mode === 'play') this.drawOverlayText(t, S);
  }

  drawBackground(t, dt, pulse, mode, S) {
    const g = this.g, { W, H } = this;
    if (this.scene) {   // 曲の場面 (その曲のイメージの絵)
      const key = mode === 'play' ? secKey(this.section(t).name) : 'intro';
      this.scene.draw({ g, t, dt, pulse, key, bi: this.beatInfo(mode === 'play' ? t : -1), mode, combo: S && S.game ? S.game.combo : 0, rush: this.rush, drift: this.drift });
      return;
    }
    const key = mode === 'play' ? secKey(this.section(t).name) : 'intro';
    const target = (PAL[key] || PAL.intro).map(hex);
    this.pal = this.pal.map((c, i) => mix(c, target[i], clamp(dt * 2.2, 0, 1)));
    let [c0, c1, c2] = this.pal;
    if (key === 'big') { // 大サビは虹色にゆっくり変わる
      const h = (this.t * 25) % 360, hs = (k) => `hsl(${(h + k) % 360},100%,86%)`;
      const gr = g.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, hs(0)); gr.addColorStop(0.5, hs(70)); gr.addColorStop(1, hs(150));
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    } else {
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, rgb(c0)); gr.addColorStop(0.5, rgb(c1)); gr.addColorStop(1, rgb(c2));
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    // 光の筋 (サビ)
    if (key === 'chorus' || key === 'big') {
      g.save(); g.translate(W / 2, this.L.yJ - H * 0.35); g.rotate(this.t * 0.06);
      const n = 16, R = Math.hypot(W, H);
      for (let i = 0; i < n; i += 2) { g.fillStyle = `rgba(255,255,255,${0.12 + pulse * 0.08})`; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, i / n * Math.PI * 2, (i + 1) / n * Math.PI * 2); g.closePath(); g.fill(); }
      g.restore();
    }
    // やわらかい大きな丸
    for (const d of this.dots) {
      const x = (d.x + Math.sin(this.t * d.sp * 8 + d.ph) * 0.05) * W, y = ((d.y - this.t * d.sp) % 1 + 1) % 1 * H, r = d.r * H * (1 + pulse * 0.06);
      g.globalAlpha = 0.5; g.drawImage(this.S.dot, x - r, y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    // 水玉 (ゆっくり斜めに流れる)
    g.save(); g.globalAlpha = 0.5; g.translate((this.t * 6) % 72, (this.t * 10) % 72); g.fillStyle = this.pat; g.fillRect(-72, -72, W + 144, H + 144); g.restore();
    // ふわふわ漂う星・ハート・音符
    for (const f of this.floaters) {
      const y = ((f.y - this.drift * f.sp) % 1 + 1) % 1, x = f.x + Math.sin(this.t * 0.8 + f.ph) * 0.03;
      const s = f.size * Math.min(W, H) * (1 + pulse * 0.25) * (f.kind === 'spark' ? 0.6 + 0.4 * Math.abs(Math.sin(this.t * 2 + f.ph)) : 1);
      const im = this.S.tint[f.kind][f.col];
      g.save(); g.globalAlpha = 0.75; g.translate(x * W, y * H); g.rotate(f.rot + this.t * 0.4 * (f.kind === 'spark' ? 0 : 1));
      g.drawImage(im, -s, -s, s * 2, s * 2); g.restore();
    }
  }

  drawField(t, S, pulse) {
    const g = this.g, L = this.L;
    const p1 = 1.04, N = 16;
    const edge = (i, p) => this.cxAt(p) + (i - 3) * this.lw(p);   // レーンの境目 i (0〜6) の、位置 p での x
    // 境目 i0 〜 i1 の帯 (うねりに沿って曲がる)
    const band = (i0, i1) => {
      g.beginPath(); g.moveTo(edge(i0, 0), this.py(0));
      for (let k = 1; k <= N; k++) { const p = p1 * k / N; g.lineTo(edge(i0, p), this.py(p)); }
      for (let k = N; k >= 0; k--) { const p = p1 * k / N; g.lineTo(edge(i1, p), this.py(p)); }
      g.closePath();
    };
    const xl = (p) => edge(0, p), xr = (p) => edge(6, p);
    // 土台 (白いすりガラス)
    g.save();
    band(0, 6);
    const gr = g.createLinearGradient(0, this.py(p1), 0, this.py(0));
    gr.addColorStop(0, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,.5)');
    g.fillStyle = gr; g.fill();
    g.shadowColor = `rgba(255,120,190,${0.5 + pulse * 0.3})`; g.shadowBlur = 24; g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,.95)'; g.stroke();
    g.restore();
    // レーンの色づけ (交互) と、押している間の光の柱
    for (let i = 0; i < 6; i++) {
      const a = (S.held && S.held[i] ? 0.34 : 0) + this.beams[i] * 0.4;
      const base = i % 2 ? 0.07 : 0.13;
      band(i, i + 1);
      g.fillStyle = rgb(hex(LANE_COL[i]), base + a * 0.6); g.fill();
      if (a > 0.02) {
        const bg = g.createLinearGradient(0, this.py(0), 0, this.py(0.9));
        bg.addColorStop(0, rgb(hex(LANE_COL[i]), a)); bg.addColorStop(1, rgb(hex(LANE_COL[i]), 0));
        g.fillStyle = bg; g.fill();
      }
      this.beams[i] = Math.max(0, this.beams[i] - 0.06);
    }
    // 疾走線 (レーンの上を手前へ流れる)
    this.drawStreaks(g);
    // レーンの線
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2;
    for (let i = 1; i < 6; i++) {
      g.beginPath(); g.moveTo(edge(i, 0), this.py(0));
      for (let k = 1; k <= N; k++) { const p = p1 * k / N; g.lineTo(edge(i, p), this.py(p)); }
      g.stroke();
    }
    // 判定線 (太い白い帯 + ピンクの光)。うねりは判定線では 0 なので、動かない
    g.save(); g.shadowColor = 'rgba(255,90,170,.8)'; g.shadowBlur = 16 + pulse * 10;
    g.fillStyle = '#fff'; const y = this.py(0), th = Math.max(5, this.lw(0) * 0.07);
    g.beginPath(); g.roundRect ? g.roundRect(xl(0) - 8, y - th / 2, xr(0) - xl(0) + 16, th, th / 2) : g.rect(xl(0) - 8, y - th / 2, xr(0) - xl(0) + 16, th); g.fill(); g.restore();
    // 受け皿の輪 (キーの文字入り)
    const r0 = this.lw(0) * 0.4;
    for (let i = 0; i < 6; i++) {
      const down = S.held && S.held[i], x = this.px(i, 0), r = r0 * (down ? 0.92 : 1) * (1 + pulse * 0.04);
      g.beginPath(); g.arc(x, y, r, 0, 7);
      g.fillStyle = down ? rgb(hex(LANE_COL[i]), 0.55) : 'rgba(255,255,255,.55)'; g.fill();
      g.lineWidth = 4; g.strokeStyle = LANE_COL[i]; g.stroke();
      g.lineWidth = 2; g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, y, r - 4, 0, 7); g.stroke();
      if (S.keysOn && S.labels) {
        g.font = `800 ${Math.round(r * 0.9)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = LANE_DARK[i]; g.fillText(S.labels[i], x, y + 1);
      }
    }
  }
  // 疾走線: レーンの上を、奥から手前へ流れる光の線 (サビでは数が増え、速くなる)
  drawStreaks(g) {
    if (!this.nStreak) return;
    g.save(); g.lineCap = 'round';
    for (let i = 0; i < this.nStreak; i++) {
      const s = this.streaks[i], pa = Math.max(0, s.p), pb = s.p + s.len;
      if (pb <= 0.01) continue;
      const x0 = this.cxAt(pa) + (s.u - 3) * this.lw(pa), y0 = this.py(pa), x1 = this.cxAt(pb) + (s.u - 3) * this.lw(pb), y1 = this.py(pb);
      const k = clamp(1.1 - pa * 0.6, 0, 1);
      const gr = g.createLinearGradient(x1, y1, x0, y0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, rgb(mix(hex(LANE_COL[s.c]), [255, 255, 255], 0.5), 0.9 * k * (0.6 + 0.4 * this.rush)));
      g.strokeStyle = gr; g.lineWidth = Math.max(1.5, this.lw(pa) * 0.05);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    g.restore();
  }

  drawNotes(t, S) {
    const g = this.g, game = S.game, ap = S.approach, S_ = this.S;
    // 奥のものから描く (近いものが上に重なる)
    const list = [];
    for (const n of game.notes) {
      if (n.state === 'done' && n.grade !== 'miss') continue;       // 当たったものは消える
      const p = (n.t - t) / ap, pe = (n.end - t) / ap;
      if (pe < -0.35 || p > 1.08) continue;
      list.push({ n, p, pe });
    }
    list.sort((a, b) => b.p - a.p);
    for (const { n, p, pe } of list) {
      const lane = n.lane, missed = n.state === 'done' && n.grade === 'miss';
      if (n.type === 'hold') {
        const active = n.state === 'hold';
        const pa = Math.max(active ? 0 : p, -0.02), pb = Math.min(pe, 1.08);
        if (pb > pa) this.drawRibbon(lane, pa, pb, active, missed, t);
        // 終わりのハート
        if (pe > -0.02 && pe < 1.08) { const s = this.lw(pe) * 0.46, y = this.py(pe), x = this.px(lane, pe); g.globalAlpha = missed ? 0.35 : 1; g.drawImage(S_.heart[lane], x - s, y - s, s * 2, s * 2); g.globalAlpha = 1; }
        if (n.flickEnd && pe > 0 && pe < 1.08) this.arrowAt(lane, pe);
      }
      // 頭 (押す所)。長押しは押している間、判定線に残る
      const hp = n.type === 'hold' && n.state === 'hold' ? 0 : p;
      if (hp < -0.34 || hp > 1.08) continue;
      const s = this.lw(hp) * 0.5, x = this.px(lane, hp), y = this.py(hp);
      const sprite = n.type === 'flick' ? S_.flick : n.type === 'hold' ? S_.hold[lane] : S_.tap[lane];
      const k = n.type === 'flick' ? 1.12 : 1;
      g.save(); g.globalAlpha = missed ? 0.4 * clamp(1 + hp * 2.2, 0, 1) : 1;
      if (missed) { g.filter = 'grayscale(1)'; }
      const bob = n.state === 'hold' ? 1 + Math.sin(this.t * 22) * 0.05 : 1;
      g.drawImage(sprite, x - s * k * bob, y - s * k * bob, s * 2 * k * bob, s * 2 * k * bob);
      g.restore();
    }
  }
  arrowAt(lane, p) {
    const g = this.g, x = this.px(lane, p), y = this.py(p) - this.lw(p) * 0.6, s = this.lw(p) * 0.3;
    g.fillStyle = '#fff'; g.strokeStyle = '#ff6fae'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s, y + s * 0.4); g.lineTo(x + s * 0.35, y + s * 0.4); g.lineTo(x + s * 0.35, y + s); g.lineTo(x - s * 0.35, y + s); g.lineTo(x - s * 0.35, y + s * 0.4); g.lineTo(x - s, y + s * 0.4); g.closePath(); g.fill(); g.stroke();
  }
  drawRibbon(lane, pa, pb, active, missed, t) {
    const g = this.g, col = LANE_COL[lane], dk = LANE_DARK[lane];
    const hw = (p) => this.lw(p) * 0.3;
    const n = Math.max(2, Math.ceil((pb - pa) * 18)), pAt = (k) => pa + (pb - pa) * k / n;   // うねりに沿って曲げる
    g.save();
    g.beginPath();
    for (let k = 0; k <= n; k++) { const p = pAt(k), x = this.px(lane, p) - hw(p); if (k) g.lineTo(x, this.py(p)); else g.moveTo(x, this.py(p)); }
    for (let k = n; k >= 0; k--) { const p = pAt(k); g.lineTo(this.px(lane, p) + hw(p), this.py(p)); }
    g.closePath();
    const gr = g.createLinearGradient(0, this.py(pa), 0, this.py(pb));
    const a = missed ? 0.3 : active ? 0.95 : 0.7;
    gr.addColorStop(0, rgb(hex(col), a)); gr.addColorStop(1, rgb(hex(dk), a * 0.85));
    g.fillStyle = gr; g.fill();
    g.clip();
    // キャンディのしま模様
    g.strokeStyle = `rgba(255,255,255,${missed ? 0.15 : active ? 0.5 : 0.35})`; g.lineWidth = Math.max(3, this.lw(0) * 0.1);
    const step = 0.06, off = active ? (t * 0.8) % step : 0;
    for (let p = pa - step * 2 + off; p < pb + step; p += step) {
      g.beginPath(); g.moveTo(this.px(lane, p) - this.lw(p), this.py(p) + this.lw(p) * 0.35); g.lineTo(this.px(lane, p) + this.lw(p), this.py(p) - this.lw(p) * 0.35); g.stroke();
    }
    g.restore();
    g.save(); g.lineWidth = 3; g.strokeStyle = missed ? 'rgba(255,255,255,.3)' : '#fff'; g.globalAlpha = active ? 1 : 0.9;
    for (const sg of [-1, 1]) {
      g.beginPath();
      for (let k = 0; k <= n; k++) { const p = pAt(k), x = this.px(lane, p) + sg * hw(p); if (k) g.lineTo(x, this.py(p)); else g.moveTo(x, this.py(p)); }
      g.stroke();
    }
    g.restore();
    if (active && !missed) { // 押している間、判定線でキラキラ
      if (Math.random() < 0.5) this.burst(this.px(lane, 0), this.L.yJ, lane, 1, 'ring');
    }
  }
  drawRings(dt) {
    const g = this.g;
    this.rings = this.rings.filter((r) => (r.age += dt) < 0.4);
    for (const r of this.rings) {
      const k = r.age / 0.4, x = this.px(r.lane, 0), y = this.L.yJ, rad = this.lw(0) * (0.45 + k * (r.big ? 1.25 : 0.9));
      g.save(); g.globalAlpha = (1 - k) * 0.9; g.lineWidth = 6 * (1 - k) + 1; g.strokeStyle = r.big ? '#fff' : LANE_COL[r.col];
      g.beginPath(); g.arc(x, y, rad, 0, 7); g.stroke();
      g.lineWidth = 3 * (1 - k); g.strokeStyle = LANE_COL[r.col]; g.beginPath(); g.arc(x, y, rad * 0.78, 0, 7); g.stroke(); g.restore();
    }
  }
  drawParts(dt) {
    const g = this.g, m = Math.min(this.W, this.H);
    this.parts = this.parts.filter((p) => (p.age += dt) < p.life);
    for (const p of this.parts) {
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const k = p.age / p.life, s = p.size * m * (p.kind === 'dot' ? 3 + k * 3 : 1 - k * 0.4);
      const im = p.kind === 'dot' ? this.S.dot : this.S.tint[p.kind][p.col];
      g.globalAlpha = (1 - k) * (p.kind === 'dot' ? 0.5 : 1);
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.drawImage(im, -s, -s, s * 2, s * 2); g.restore();
    }
    g.globalAlpha = 1;
  }

  // ---- 文字 ----
  text(str, x, y, size, o = {}) {
    const g = this.g;
    g.save();
    g.font = `800 ${Math.round(size)}px ${FONT}`; g.textAlign = o.align || 'center'; g.textBaseline = 'middle';
    if ('letterSpacing' in g && o.ls) g.letterSpacing = o.ls + 'px';
    if (o.rot) { g.translate(x, y); g.rotate(o.rot); x = 0; y = 0; }
    g.lineJoin = 'round';
    if (o.shadow) { g.shadowColor = o.shadow; g.shadowBlur = size * 0.35; g.shadowOffsetY = size * 0.06; }
    if (o.stroke) { g.lineWidth = o.sw || size * 0.2; g.strokeStyle = o.stroke; g.strokeText(str, x, y, o.max); }
    g.shadowColor = 'transparent';
    if (o.rainbow) {
      const w = g.measureText(str).width, gr = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      RAINBOW.forEach((c, i) => gr.addColorStop(i / (RAINBOW.length - 1), c));
      g.fillStyle = gr;
    } else g.fillStyle = o.fill || '#fff';
    g.fillText(str, x, y, o.max);
    g.restore();
  }
  pill(x, y, w, h, fill, stroke) {
    const g = this.g; g.save();
    g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, h / 2) : g.rect(x, y, w, h);
    g.fillStyle = fill; g.fill(); if (stroke) { g.lineWidth = 3; g.strokeStyle = stroke; g.stroke(); } g.restore();
  }

  drawHud(t, S, pulse) {
    const g = this.g, { W, H, L } = this, m = Math.min(W, H);
    // 進み具合 (キャンディのしまのバー)
    const total = this.chart.duration, prog = clamp(t / total, 0, 1);
    const bw = L.port ? W * 0.84 : W * 0.34, bx = W / 2 - bw / 2, by = L.port ? 74 : 24, bh = 14;   // 縦向きは、ラベルとスコアの下の段
    this.pill(bx, by, bw, bh, 'rgba(255,255,255,.65)', 'rgba(255,255,255,.95)');
    if (prog > 0.002) {
      g.save(); g.beginPath(); g.roundRect ? g.roundRect(bx, by, Math.max(bh, bw * prog), bh, bh / 2) : g.rect(bx, by, bw * prog, bh); g.clip();
      const gr = g.createLinearGradient(bx, 0, bx + bw, 0); RAINBOW.forEach((c, i) => gr.addColorStop(i / 5, c));
      g.fillStyle = gr; g.fillRect(bx, by, bw, bh);
      g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 4; for (let x = bx - 20 + (this.t * 20) % 16; x < bx + bw; x += 16) { g.beginPath(); g.moveTo(x, by + bh); g.lineTo(x + bh, by); g.stroke(); }
      g.restore();
      g.drawImage(this.S.tint.star[7], bx + bw * prog - 11, by - 4, 22, 22);
    }
    // クレジット (曲の作者への表記。画面の下に小さく)
    if (S.credit) this.text(S.credit, W / 2, H - 14, Math.max(10, m * 0.026), { fill: '#7a5aa8', stroke: 'rgba(255,255,255,.9)', sw: 4, max: W - 24 });
    // 曲名・難易度
    this.text(S.title || '', bx + bw / 2, by + bh + 17, Math.max(12, m * 0.028), { fill: '#7a5aa8', stroke: 'rgba(255,255,255,.9)', sw: 5 });
    // スコア
    this.scoreShown += (S.game.score - this.scoreShown) * 0.25;
    const sw = L.port ? 150 : 200, sx = W - sw - 16, sy = 14;
    this.pill(sx, sy, sw, 46, 'rgba(255,255,255,.75)', '#ff9ccd');
    this.text('SCORE', sx + 12, sy + 13, 11, { align: 'left', fill: '#ff77b0' });
    this.text(String(Math.round(this.scoreShown)).padStart(6, '0'), sx + sw - 14, sy + 29, 24, { align: 'right', fill: '#7a5aa8' });
    // 難易度のラベル・やめるボタン
    const q = this.quit;
    g.save(); g.beginPath(); g.arc(q.x, q.y, q.r, 0, 7); g.fillStyle = 'rgba(255,255,255,.8)'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#ff9ccd'; g.stroke();
    g.lineWidth = 4; g.lineCap = 'round'; g.strokeStyle = '#ff77b0'; g.beginPath(); g.moveTo(q.x - 8, q.y - 8); g.lineTo(q.x + 8, q.y + 8); g.moveTo(q.x + 8, q.y - 8); g.lineTo(q.x - 8, q.y + 8); g.stroke(); g.restore();
    const dc = S.diff === 'HARD' ? ['#ff5fa0', 'HARD'] : ['#5fc8ff', 'NORMAL'];
    this.pill(q.x + q.r + 10, q.y - 14, 84, 28, dc[0], '#fff');
    this.text(dc[1], q.x + q.r + 52, q.y + 1, 14, { fill: '#fff' });
  }

  drawOverlayText(t, S) {
    const g = this.g, { W, H, L } = this, m = Math.min(W, H);
    const game = S.game;
    // コンボ
    this.comboPop = Math.max(0, this.comboPop - 0.08);
    if (game.combo >= 2) {
      const cy = L.yT + (L.yJ - L.yT) * 0.3, sz = m * 0.12 * (1 + this.comboPop * 0.28);
      this.text(String(game.combo), L.cx, cy, sz, { rainbow: game.combo >= 50, fill: '#ff77b0', stroke: '#fff', sw: sz * 0.22, shadow: 'rgba(255,90,170,.5)' });
      this.text('COMBO', L.cx, cy + sz * 0.62, m * 0.036, { fill: '#7a5aa8', stroke: '#fff', sw: 6 });
    }
    // 判定
    const j = this.judge;
    if (j) {
      const a = this.t - j.t0;
      if (a < 0.62) {
        const st = GRADE_STYLE[j.grade];
        const sc = (a < 0.1 ? 0.55 + 0.75 * easeOutBack(a / 0.1) : 1.3 - Math.min(0.3, (a - 0.1) * 0.8)) * (j.grade === 'perfect' ? 1.1 : 1);
        const y = L.yJ - H * 0.2 - a * 18, alpha = a > 0.46 ? 1 - (a - 0.46) / 0.16 : 1, sz = m * 0.058 * sc;
        g.save(); g.globalAlpha = alpha;
        this.text(st.text, L.cx, y, sz, { rainbow: j.grade === 'perfect', fill: st.col, stroke: '#fff', sw: sz * 0.24, shadow: 'rgba(120,80,190,.35)', ls: 2 });
        if (j.fl) this.text(j.fl < 0 ? 'FAST' : 'LATE', L.cx, y + sz * 0.78, m * 0.032, { fill: j.fl < 0 ? '#38a8ff' : '#ff8a3a', stroke: '#fff', sw: 5 });
        g.restore();
      }
    }
    this.drawReady(t, S);
  }
  // 区間の見出し (リボン)。レーンの上・ノーツの後ろに描く (ノーツを隠さない)
  drawBanner(t) {
    const g = this.g, { W, H, L } = this, m = Math.min(W, H);
    const s = this.section(t);
    if (this.bannerFor !== s.name) {
      this.bannerFor = s.name;
      const txt = (this.chart.banners || BANNER)[secKey(s.name)];   // 譜面が banners を持っていれば、それだけを出す
      if (txt && t > 0.5) this.banner = { text: txt, t0: this.t };
    }
    if (this.banner) {
      const a = this.t - this.banner.t0;
      if (a > 2.2) this.banner = null;
      else {
        const k = a < 0.3 ? easeOutBack(a / 0.3) : a > 1.8 ? 1 - (a - 1.8) / 0.4 : 1;
        const bw = Math.min(W * 0.8, m * 0.9), bh = m * 0.085, bx = L.cx - bw / 2, by = L.yT + (L.yJ - L.yT) * 0.5;
        g.save(); g.globalAlpha = clamp(k, 0, 1) * 0.92; g.translate(L.cx, by + bh / 2); g.scale(Math.max(0.01, k), Math.max(0.01, k));
        const gr = g.createLinearGradient(-bw / 2, 0, bw / 2, 0); gr.addColorStop(0, '#ff9ccd'); gr.addColorStop(0.5, '#ffd36a'); gr.addColorStop(1, '#8fd8ff');
        g.beginPath(); g.roundRect ? g.roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2) : g.rect(-bw / 2, -bh / 2, bw, bh);
        g.fillStyle = gr; g.fill(); g.lineWidth = 5; g.strokeStyle = '#fff'; g.stroke();
        g.restore();
        g.save(); g.globalAlpha = clamp(k, 0, 1);
        this.text(this.banner.text, L.cx, by + bh / 2 + 1, bh * 0.55, { fill: '#fff', stroke: '#c46ab0', sw: bh * 0.14 });
        g.restore();
      }
    }
  }
  drawReady(t, S) {
    const g = this.g, { W, H, L } = this, m = Math.min(W, H);
    // READY / GO
    if (S.count != null) {
      const c = S.count;
      if (c > 0) { const k = 1 - (c % 1); this.text(c > 0.9 ? 'READY?' : 'READY?', L.cx, L.yT + (L.yJ - L.yT) * 0.45, m * 0.1 * (1 + Math.sin(this.t * 8) * 0.04), { rainbow: true, stroke: '#fff', sw: m * 0.02, shadow: 'rgba(120,80,190,.4)' }); }
    } else if (t >= 0 && t < 0.9) {
      const a = t / 0.9, sz = m * 0.14 * (a < 0.15 ? easeOutBack(a / 0.15) : 1);
      g.save(); g.globalAlpha = a > 0.7 ? 1 - (a - 0.7) / 0.3 : 1;
      this.text('GO!', L.cx, L.yT + (L.yJ - L.yT) * 0.45, sz, { rainbow: true, stroke: '#fff', sw: sz * 0.2, shadow: 'rgba(120,80,190,.4)' });
      g.restore();
    }
  }

  // ---- マスコット「ぽよ」 ----
  drawMascot(t, pulse, S) {
    const g = this.g, { W, H, L } = this, m = Math.min(W, H);
    let r = m * (L.port ? 0.07 : 0.1), x, y;
    if (S.mode === 'play') {
      if (L.port) { x = r * 1.5; y = H * 0.14 + r * 2.1; r *= 0.8; }
      else { x = Math.max(r * 1.7, L.cx - L.wJ / 2 - r * 1.6); y = L.yJ - r * 0.6; }
    } else { x = S.mx ?? W * 0.14; y = S.my ?? H * 0.72; r = S.mr ?? r * 1.3; }
    const mood = this.t < this.mood.until ? this.mood.kind : 'happy';
    const bounce = Math.abs(Math.sin((t < 0 ? this.t * 2 : (this.beatInfo(t).i + this.beatInfo(t).ph)) * Math.PI)) * r * 0.16;
    const sq = 1 + pulse * 0.06 - (mood === 'sad' ? 0.04 : 0);
    g.save(); g.translate(x, y - bounce); g.scale(1 / sq, sq);
    // かげ
    g.fillStyle = 'rgba(120,80,190,.18)'; g.beginPath(); g.ellipse(0, r * 1.02 + bounce, r * 0.9, r * 0.16, 0, 0, 7); g.fill();
    // 耳
    const body = mood === 'sad' ? '#f4e4ff' : '#ffe4f2';
    for (const sgn of [-1, 1]) {
      g.save(); g.translate(sgn * r * 0.62, -r * 0.78); g.rotate(sgn * (0.5 + Math.sin(this.t * 6 + sgn) * 0.06));
      g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, 0, r * 0.34, r * 0.4, 0, 0, 7); g.fill();
      g.fillStyle = '#ffb5d8'; g.beginPath(); g.ellipse(0, r * 0.04, r * 0.2, r * 0.26, 0, 0, 7); g.fill(); g.restore();
    }
    // からだ
    const gr = g.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.1, 0, 0, r * 1.1);
    gr.addColorStop(0, '#fff'); gr.addColorStop(1, body);
    g.fillStyle = gr; g.strokeStyle = '#fff'; g.lineWidth = r * 0.07; g.beginPath(); g.ellipse(0, 0, r, r * 0.95, 0, 0, 7); g.fill(); g.stroke();
    // うで (ぱたぱた)
    const wave = mood === 'joy' ? Math.sin(this.t * 18) * 0.5 : Math.sin(this.t * 4) * 0.12;
    for (const sgn of [-1, 1]) { g.save(); g.translate(sgn * r * 0.95, r * 0.1); g.rotate(sgn * (-0.7 + (sgn > 0 ? wave : -wave))); g.fillStyle = body; g.strokeStyle = '#fff'; g.lineWidth = r * 0.05; g.beginPath(); g.ellipse(sgn * r * 0.15, 0, r * 0.3, r * 0.17, 0, 0, 7); g.fill(); g.stroke(); g.restore(); }
    // ほっぺ・目・口
    g.fillStyle = 'rgba(255,120,170,.45)'; for (const sgn of [-1, 1]) { g.beginPath(); g.ellipse(sgn * r * 0.55, r * 0.22, r * 0.19, r * 0.12, 0, 0, 7); g.fill(); }
    g.fillStyle = '#5a3a6a'; g.strokeStyle = '#5a3a6a'; g.lineWidth = r * 0.06; g.lineCap = 'round';
    for (const sgn of [-1, 1]) {
      const ex = sgn * r * 0.34, ey = -r * 0.08;
      if (mood === 'joy') { g.beginPath(); g.arc(ex, ey + r * 0.06, r * 0.13, Math.PI * 1.05, Math.PI * 1.95); g.stroke(); }
      else if (mood === 'sad') { g.beginPath(); g.ellipse(ex, ey, r * 0.09, r * 0.13, 0, 0, 7); g.fill(); g.fillStyle = '#7ad0ff'; g.beginPath(); g.ellipse(ex + sgn * r * 0.05, ey + r * 0.26 + Math.sin(this.t * 8) * 2, r * 0.05, r * 0.09, 0, 0, 7); g.fill(); g.fillStyle = '#5a3a6a'; }
      else { g.beginPath(); g.ellipse(ex, ey, r * 0.1, r * 0.14, 0, 0, 7); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(ex - r * 0.03, ey - r * 0.05, r * 0.04, 0, 7); g.fill(); g.fillStyle = '#5a3a6a'; }
    }
    g.beginPath();
    if (mood === 'joy') { g.fillStyle = '#ff7aa8'; g.ellipse(0, r * 0.3, r * 0.2, r * 0.16, 0, 0, Math.PI); g.fill(); }
    else if (mood === 'sad') { g.arc(0, r * 0.45, r * 0.13, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }
    else { g.arc(0, r * 0.2, r * 0.17, Math.PI * 0.1, Math.PI * 0.9); g.stroke(); }
    // リボン
    g.fillStyle = '#ff7eb6'; g.strokeStyle = '#fff'; g.lineWidth = r * 0.04;
    for (const sgn of [-1, 1]) { g.beginPath(); g.moveTo(r * 0.55, -r * 0.82); g.lineTo(r * 0.55 + sgn * r * 0.3, -r * 0.95); g.lineTo(r * 0.55 + sgn * r * 0.3, -r * 0.62); g.closePath(); g.fill(); g.stroke(); }
    g.beginPath(); g.arc(r * 0.55, -r * 0.82, r * 0.09, 0, 7); g.fillStyle = '#ffd84d'; g.fill();
    g.restore();
  }
}
const BANNER = { A: 'ここから はじまるよ♪', B: 'ドキドキ…', chorus: 'サビだよ！', interlude: 'かけあがれー！', big: 'ラストサビ！', outro: 'ラスト！' };
