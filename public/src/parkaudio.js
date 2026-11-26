// 千葉ドリームランド 段階 4: 音。園内の曲 (public/audio/park_theme.mp3 = ほしぞらワルツ)・パレードの曲 (park_parade.mp3)・花火の音 (ブラウザの中で合成)。
// 曲は tools/music/park_theme.py で作ったオリジナル (numpy だけで合成)。時計 (Date.now) で「今どこを流しているか」を決めるので、だれが聞いても同じ場所。
//   ・曲は、プラザから music.radius m 以内に入ったときに読み込む (入るまで通信しない)。距離でなめらかに音量を変える。出たら止める。
//   ・パレードの曲は、先頭の山車から music.paradeRadius m 以内で鳴る (園内の曲は、その間は小さくする)。
//   ・花火は、打ち上げ・爆発のたびに合成した音を、距離 ÷ 340 m/s だけ遅らせて鳴らす (遠いと小さく・低く)。
// ブラウザは、画面を触る前は音を出せない (rhythm/audio.js の unlock が、触ったら自動で使えるようにする)。出せない間は何もしない。URL の ?nosound で全部止める。
import { ensure, audioOn, decode } from './rhythm/audio.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export class ParkAudio {
  constructor({ park, enabled = true }) {
    this.park = park; this.enabled = enabled;
    this.tracks = {};   // name → { url, buf, loading, src, gain }
    this.state = { theme: 0, parade: 0, ducked: 1 };
    this.noise = null;
    window.__parkaudio = this;
  }

  cfg() { return this.park?.cfg || null; }

  // ---- 曲 ----
  track(name, url) { return this.tracks[name] || (this.tracks[name] = { url, buf: null, loading: false, src: null, gain: null, failed: false }); }
  load(t) {
    if (t.buf || t.loading || t.failed) return;
    t.loading = true;
    fetch(t.url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status)))).then((ab) => decode(ab)).then((buf) => { t.buf = buf; t.loading = false; if (!buf) t.failed = true; }).catch(() => { t.loading = false; t.failed = true; });
  }
  play(t, offset) {
    const ctx = ensure();
    if (!ctx || !t.buf || t.src) return;
    const src = ctx.createBufferSource(); src.buffer = t.buf; src.loop = true;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(g); g.connect(ctx.destination);
    src.start(0, offset % t.buf.duration);
    t.src = src; t.gain = g;
  }
  stop(t) {
    if (!t.src) return;
    const ctx = ensure(), s = t.src, g = t.gain; t.src = t.gain = null;
    try { g.gain.setTargetAtTime(0, ctx.currentTime, 0.15); s.stop(ctx.currentTime + 0.7); } catch (e) { /* もう止まっている */ }
  }
  setVol(t, v) { if (t.gain) { const ctx = ensure(); t.gain.gain.setTargetAtTime(v, ctx.currentTime, 0.35); } }

  // ---- 花火の音 (合成) ----
  noiseBuf(ctx) {
    if (this.noise) return this.noise;
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return (this.noise = b);
  }
  boom(ctx, when, vol, far, big) {
    const t0 = ctx.currentTime + when, out = ctx.createGain(); out.gain.value = vol; out.connect(ctx.destination);
    // 低い「ドン」: 周波数が落ちる正弦波 + 雑音のかたまり
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(big ? 95 : 120, t0); o.frequency.exponentialRampToValueAtTime(34, t0 + 0.5);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t0); og.gain.exponentialRampToValueAtTime(1, t0 + 0.012); og.gain.exponentialRampToValueAtTime(0.0001, t0 + (big ? 1.1 : 0.8));
    o.connect(og); og.connect(out); o.start(t0); o.stop(t0 + 1.2);
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf(ctx);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(far ? 500 : 1800, t0); lp.frequency.exponentialRampToValueAtTime(120, t0 + 0.7);
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, t0); ng.gain.exponentialRampToValueAtTime(0.7, t0 + 0.008); ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    n.connect(lp); lp.connect(ng); ng.connect(out); n.start(t0, Math.random() * 0.5); n.stop(t0 + 1.0);
    // パチパチ (細かい高い音が 1.5 秒ほど続く)
    if (!far) for (let k = 0; k < (big ? 26 : 14); k++) {
      const tc = t0 + 0.12 + Math.random() * 1.6, c = ctx.createBufferSource(); c.buffer = this.noiseBuf(ctx);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500 + Math.random() * 3000;
      const cg = ctx.createGain(); cg.gain.setValueAtTime(0.0001, tc); cg.gain.exponentialRampToValueAtTime(0.18 * (1 - (tc - t0) / 2), tc + 0.003); cg.gain.exponentialRampToValueAtTime(0.0001, tc + 0.05);
      c.connect(hp); hp.connect(cg); cg.connect(out); c.start(tc, Math.random()); c.stop(tc + 0.08);
    }
  }
  whoosh(ctx, when, vol) {
    const t0 = ctx.currentTime + when, n = ctx.createBufferSource(); n.buffer = this.noiseBuf(ctx);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.setValueAtTime(500, t0); bp.frequency.exponentialRampToValueAtTime(2400, t0 + 1.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol * 0.35, t0 + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.7);
    n.connect(bp); bp.connect(g); g.connect(ctx.destination); n.start(t0, Math.random()); n.stop(t0 + 1.8);
  }

  // 毎コマ。x, z = カメラ (聞く位置)、nowSec = 時計 (秒)
  update(x, z, nowSec) {
    if (!this.enabled || !this.park || !this.park.built) return;
    const cfg = this.park.cfg, M = cfg?.show?.music, show = this.park.show;
    if (!M || !show) return;
    const pl = cfg.ellipses[cfg.show.parade.plaza].center, d = Math.hypot(x - pl[0], z - pl[1]);
    const R = M.radius, near = d < R * 1.05;
    const theme = this.track('theme', M.theme), parade = this.track('parade', M.parade);
    const lead = show.paradeLead();
    const dl = lead ? Math.hypot(x - lead.x, z - lead.z) : Infinity;
    if (d < R * 1.5) this.load(theme);
    if (lead && dl < M.paradeRadius * 1.5) this.load(parade);
    const ok = audioOn();
    // 花火の音の知らせは、音が出せなくても受け取って捨てる (たまらないように)
    const ev = show.takeEvents();
    if (ok) {
      const ctx = ensure();
      for (const e of ev) {
        const dist = Math.hypot(e.x - x, e.z - z, (e.y - 20) * 0.5);
        if (dist > 1800) continue;
        const delay = Math.min(4.5, dist / 340), vol = clamp(1.6 - dist / 700, 0.05, 1.0) * (e.big ? 1.15 : 0.9);
        if (e.kind === 'burst') this.boom(ctx, delay, vol * 0.85, dist > 500, !!e.big);
        else if (dist < 900) this.whoosh(ctx, delay, vol * 0.6);
      }
    }
    // 曲の音量: 園内の曲 = 距離で、パレードの間は小さく / パレードの曲 = 先頭の山車からの距離で
    const fw = show.state().fireworks;
    const tv = near ? 0.5 * smooth((R * 1.05 - d) / (R * 0.55)) : 0;
    const pv = lead && dl < M.paradeRadius ? 0.55 * smooth((M.paradeRadius - dl) / (M.paradeRadius * 0.6)) : 0;
    const duck = (pv > 0.05 ? 0.35 : 1) * (fw ? 0.6 : 1);
    this.state = { theme: tv * duck, parade: pv, ducked: duck, d, dl };
    if (!ok) return;
    if (tv > 0.01) { if (!theme.src && theme.buf) this.play(theme, nowSec); this.setVol(theme, tv * duck); } else if (theme.src && !near) this.stop(theme);
    if (pv > 0.01) { if (!parade.src && parade.buf) this.play(parade, nowSec - (cfg.show.parade.start)); this.setVol(parade, pv); } else if (parade.src) this.stop(parade);
  }
}
