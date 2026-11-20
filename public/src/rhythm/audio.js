// お札まきのイベントの音 (rhythm/event.js)。音のファイルは使わず、ブラウザの中で合成する (Web Audio)。
//   太鼓 (手本役が打つ) / うちわ (自分が打つ) / 拍子木 (拍の伴奏) / 鈴 (区切り) / 歓声 / 空振り
// ブラウザは、ページを触った (クリック・キー・タップ) 後でないと音を出せない。どこかを触ったら自動で使えるようにする
// (ゲームの開始のクリック・タップで済む)。音が出せないときは、時計だけ performance.now() で進める (画面の合図だけで遊べる)。

let ctx = null, master = null, noiseBuf = null;

function make() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { return null; }
  master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}
// iPhone (Safari・Chrome とも中身は Safari) は、消音スイッチ (マナーモード) が入っていると Web Audio の音を消す。
// 音楽の再生と同じ扱いにして、消音スイッチに関係なく鳴らす:
//   ・navigator.audioSession.type = 'playback' (iOS 16.4 以降)
//   ・それより古い iOS 向けに、無音の短い音を <audio> で 1 回鳴らす (<audio> の再生で、音の扱いが「再生」に切り替わる)
function silentWav() {
  const n = 800, b = new Uint8Array(44 + n), v = new DataView(b.buffer), w = (o, s) => [...s].forEach((c, i) => b[o + i] = c.charCodeAt(0));
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
  b.fill(128, 44);
  let bin = ''; for (const x of b) bin += String.fromCharCode(x);
  return 'data:audio/wav;base64,' + btoa(bin);
}
let mediaTried = false;
function playbackMode() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 使えない端末 */ }
  if (mediaTried) return;
  mediaTried = true;
  try { const a = new Audio(silentWav()); a.setAttribute('playsinline', ''); a.play().catch(() => { mediaTried = false; }); } catch (e) { mediaTried = false; }
}
// 触った瞬間に作る・再開する (iPhone は触った処理の中で resume しないと鳴らない)
const unlock = () => {
  const c = make();
  if (!c) return;
  playbackMode();
  if (c.state !== 'running') c.resume().catch(() => {});
};
if (typeof window !== 'undefined') for (const t of ['pointerdown', 'keydown', 'touchend', 'click']) window.addEventListener(t, unlock, { capture: true, passive: true });

export const audioOn = () => !!ctx && ctx.state === 'running';
// 音の準備ができていない (まだ触っていない・再開の途中) とき、もう一度頼む。触った処理の外なので効かない端末もある
export function wake() { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); return audioOn(); }

const LANE_F = [659, 784, 880, 1047, 1175, 1319];   // 6 本のレーンの音 (ミ ソ ラ ド レ ミ)

// ---- 曲のファイル (ゲームセンターのリズムゲーム) ----
export function ensure() { return make(); }
// mp3 などを読み込んで音のデータにする (触る前でも作れる。再生は触った後)
export function decode(arrayBuffer) {
  const c = make();
  if (!c) return Promise.resolve(null);
  return new Promise((res) => { try { const p = c.decodeAudioData(arrayBuffer, res, () => res(null)); if (p && p.catch) p.catch(() => res(null)); } catch (e) { res(null); } });
}
let songSrc = null, songGain = null;
// 曲を始める。t は now() の時計での開始時刻 (過ぎていれば途中から)。音が出せなければ false
export function startSong(buf, t, volume = 0.9) {
  stopSong(0);
  if (!audioOn() || !buf) return false;
  const src = ctx.createBufferSource(); src.buffer = buf;
  songGain = ctx.createGain(); songGain.gain.value = volume;
  src.connect(songGain); songGain.connect(ctx.destination);
  const when = sched(t);
  if (when >= ctx.currentTime) src.start(when); else src.start(ctx.currentTime, Math.min(buf.duration - 0.01, ctx.currentTime - when));
  songSrc = src;
  return true;
}
export function stopSong(fade = 0.2) {
  if (!songSrc) return;
  const s = songSrc, g = songGain; songSrc = songGain = null;
  try {
    if (fade > 0 && ctx) { g.gain.setValueAtTime(g.gain.value, ctx.currentTime); g.gain.linearRampToValueAtTime(0, ctx.currentTime + fade); s.stop(ctx.currentTime + fade + 0.02); }
    else s.stop();
  } catch (e) { /* もう止まっている */ }
}

// 今の時刻 (秒)。音が出ているときは「いま耳に届いている音」の時刻 (出力の遅れを含む) にそろえる
export function now() {
  if (!audioOn()) return performance.now() / 1000;
  if (ctx.getOutputTimestamp) {
    const ts = ctx.getOutputTimestamp();
    if (ts.performanceTime > 0 && ts.contextTime > 0) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
  }
  return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
}
// 入力のイベントの時刻 (ev.timeStamp。performance.now() と同じ基準) を、now() と同じ時計に直す
export function eventTime(stamp) { return now() - (performance.now() - stamp) / 1000; }
// now() の時刻 t を、音を予約するための時刻 (ctx.currentTime の基準) に直す
const sched = (t) => t - now() + ctx.currentTime;

function env(t, a, peak, dec, gainTo = master) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  g.connect(gainTo);
  return g;
}
function osc(type, f0, f1, t, dur, out) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
  o.connect(out); o.start(t); o.stop(t + dur + 0.05);
}
function noise(t, dur, filt, f, q, out) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const b = ctx.createBiquadFilter(); b.type = filt; b.frequency.value = f; b.Q.value = q;
  s.connect(b); b.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}

// 音を鳴らす。t は now() の時刻 (省略 = すぐ)。v = 音量の倍率
export function play(kind, t = null, v = 1, lane = 0) {
  if (!audioOn()) return;
  const T = Math.max(ctx.currentTime, t == null ? ctx.currentTime : sched(t));
  switch (kind) {
    case 'taiko': { // ドン: 低い音が下がる + 皮を打つ音
      osc('sine', 160, 62, T, 0.35, env(T, 0.004, 0.9 * v, 0.35));
      osc('triangle', 240, 90, T, 0.12, env(T, 0.002, 0.25 * v, 0.1));
      noise(T, 0.05, 'lowpass', 900, 0.7, env(T, 0.001, 0.35 * v, 0.05));
      break;
    }
    case 'fan': { // パン: うちわで打つ乾いた音
      noise(T, 0.07, 'bandpass', 2200, 1.4, env(T, 0.001, 0.8 * v, 0.07));
      osc('sine', 420, 220, T, 0.06, env(T, 0.002, 0.3 * v, 0.06));
      break;
    }
    case 'clap': { // 拍子木: カッ
      osc('square', 1850, 1800, T, 0.04, env(T, 0.001, 0.12 * v, 0.045));
      noise(T, 0.03, 'highpass', 3500, 0.8, env(T, 0.001, 0.12 * v, 0.03));
      break;
    }
    case 'bell': { // 鈴: 高い音の重なり
      for (const [f, a] of [[2637, 0.12], [3520, 0.08], [5274, 0.05]]) {
        for (let k = 0; k < 3; k++) osc('sine', f * (1 + k * 0.003), f, T + k * 0.03, 0.5, env(T + k * 0.03, 0.003, a * v, 0.5));
      }
      break;
    }
    case 'cue': { // 「はい！」の合図: 拍子木を 2 つ (カカッ)
      for (const k of [0, 0.09]) osc('square', 2300, 2250, T + k, 0.035, env(T + k, 0.001, 0.13 * v, 0.04));
      break;
    }
    case 'miss': { // ぽこ
      osc('triangle', 300, 150, T, 0.12, env(T, 0.003, 0.25 * v, 0.12));
      break;
    }
    case 'daikichi': { // 大吉: 鈴が上がっていく (ドミソド) + しゃん + 拍子木の「カッ」
      [1047, 1319, 1568, 2093].forEach((f, k) => {
        const t = T + k * 0.055;
        osc('sine', f, f, t, 0.55, env(t, 0.003, 0.2 * v, 0.55));
        osc('triangle', f * 2.01, f * 2.01, t, 0.3, env(t, 0.003, 0.06 * v, 0.3));
      });
      noise(T + 0.17, 0.5, 'highpass', 6000, 0.7, env(T + 0.17, 0.01, 0.1 * v, 0.5));
      osc('square', 1850, 1800, T, 0.04, env(T, 0.001, 0.1 * v, 0.045));
      break;
    }
    case 'kichi': { // 吉: 鈴を 2 つ (ちりん)
      for (const [f, k] of [[1568, 0], [2093, 0.07]]) osc('sine', f, f, T + k, 0.4, env(T + k, 0.003, 0.15 * v, 0.4));
      break;
    }
    case 'kyo': { // 凶: 低くにごった「ぼよん」と、下がる音
      osc('sawtooth', 220, 110, T, 0.35, env(T, 0.005, 0.18 * v, 0.35));
      osc('sine', 150, 70, T, 0.4, env(T, 0.004, 0.4 * v, 0.4));
      noise(T, 0.1, 'lowpass', 500, 0.7, env(T, 0.002, 0.2 * v, 0.1));
      break;
    }
    case 'bump': { // どすん: うな○ーの体当たり
      osc('sine', 140, 45, T, 0.25, env(T, 0.003, 0.7 * v, 0.25));
      noise(T, 0.12, 'lowpass', 700, 0.7, env(T, 0.001, 0.35 * v, 0.12));
      break;
    }
    // ---- ゲームセンターのリズムゲーム (arcade/event.js) の効果音。レーンごとにペンタトニックの高さ (ぽん)
    case 'pon': { // 木琴のような「ぽん」
      const f = LANE_F[lane % LANE_F.length];
      osc('sine', f, f, T, 0.2, env(T, 0.002, 0.3 * v, 0.2));
      osc('triangle', f * 2, f * 2, T, 0.09, env(T, 0.002, 0.1 * v, 0.09));
      noise(T, 0.015, 'highpass', 4000, 0.8, env(T, 0.001, 0.05 * v, 0.015));
      break;
    }
    case 'sparkle': { // perfect のきらっ
      const f = LANE_F[lane % LANE_F.length] * 3;
      osc('sine', f, f, T + 0.012, 0.14, env(T + 0.012, 0.003, 0.07 * v, 0.14));
      break;
    }
    case 'swish': { // フリック: 上へのしゅっ + 高い音
      osc('sine', 520, 1900, T, 0.13, env(T, 0.003, 0.16 * v, 0.13));
      noise(T, 0.1, 'bandpass', 3200, 1.2, env(T, 0.002, 0.12 * v, 0.1));
      const f = LANE_F[lane % LANE_F.length] * 2;
      osc('sine', f, f, T + 0.05, 0.25, env(T + 0.05, 0.003, 0.14 * v, 0.25));
      break;
    }
    case 'fanfare': { // 結果: 鈴が上がっていく (ドミソド) を 2 回
      [1047, 1319, 1568, 2093, 1568, 2093, 2637].forEach((f, k) => {
        const tt = T + k * 0.09;
        osc('sine', f, f, tt, 0.5, env(tt, 0.003, 0.17 * v, 0.5));
        osc('triangle', f * 2.01, f * 2.01, tt, 0.25, env(tt, 0.003, 0.05 * v, 0.25));
      });
      noise(T + 0.3, 0.6, 'highpass', 6000, 0.7, env(T + 0.3, 0.01, 0.08 * v, 0.6));
      break;
    }
    case 'cheer': { // わーっ: 帯域を絞った雑音を、ふくらませてから消す
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, T);
      g.gain.exponentialRampToValueAtTime(0.35 * v, T + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, T + 2.2);
      g.connect(master);
      noise(T, 2.2, 'bandpass', 1200, 0.6, g);
      noise(T, 2.2, 'bandpass', 2600, 0.9, g);
      break;
    }
  }
}
