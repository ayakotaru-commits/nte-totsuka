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
export function play(kind, t = null, v = 1) {
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
