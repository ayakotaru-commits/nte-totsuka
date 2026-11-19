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
// 触った瞬間に作る・再開する (iPhone は触った処理の中で resume しないと鳴らない)
const unlock = () => { const c = make(); if (c && c.state !== 'running') c.resume().catch(() => {}); };
if (typeof window !== 'undefined') for (const t of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(t, unlock, { capture: true, passive: true });

export const audioOn = () => !!ctx && ctx.state === 'running';

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
    case 'miss': { // ぽこ
      osc('triangle', 300, 150, T, 0.12, env(T, 0.003, 0.25 * v, 0.12));
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
