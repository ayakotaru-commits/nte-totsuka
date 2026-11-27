// 千葉ドリームランド: ライブ (サンライズ・ライブステージ) の時間割と曲順、音の聞こえ方。three.js・DOM に依存しない (tools/dev/livecheck.mjs が数字を確かめる)。
//   ・時計 (Date.now) の cycle 秒ごとに 1 公演。cycle の start 秒に開演し、曲を gap 秒の間 (MC) をあけて続ける。1 公演の長さは maxLen 秒以内。
//   ・曲は盛り上がりの流れ (energy: 3 にぎやか → 2 ふつう → 3 …。最後はにぎやか) に沿って、公演の番号 n から決まった並びで選ぶ (だれが見ても同じ。何度作っても同じ)。
//   ・曲の一覧 songs は public/audio/live/songs.json (tools/music/live_songs.py)。[{ id, file, title, credit, dur, energy, ... }]
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// 決まった乱数 (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const PATTERN = [3, 2, 3, 2, 3, 2, 3, 2];   // 曲ごとのにぎやかさ (3 = にぎやか)。最初と最後はにぎやか

const EPOCH = 30;   // 30 公演 (10 時間) ごとに、曲を同じくらいずつ流す (数え直す)

export function makeLive(cfg, songs) {
  const L = cfg.show.live;
  const dur = (s) => s.dur;
  const big = (s) => s.energy >= 3;   // にぎやか。それ以外 (ふつう・ゆったり) は「しっとり側」として同じ枠で選ぶ
  const cache = { e: null, progs: null };

  // 30 公演ぶんを、最初の公演から順に作る。曲は「流れた回数が少ない → 前に流れてから長い → 固定の乱数」の順に選ぶので、どの曲も同じくらい流れる。
  // 状態は epoch (30 公演) の頭から数え直すので、何番目の公演でも同じ結果になる (だれが見ても同じ)。
  function simulate(e) {
    const r = rng(e * 104729 + 7), order = new Map();
    const all = songs.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    all.forEach((s, i) => order.set(s.id, i));
    const count = new Map(), last = new Map(), progs = [];
    for (let m = 0; m < EPOCH; m++) {
      const used = new Set(), out = [];
      let total = 0;
      const pick = (wantBig, room, avoidBig) => {   // 条件に合う未使用の曲のうち、いちばん流れていないもの
        const ok = (s) => !used.has(s.id) && dur(s) <= room && (wantBig === null || big(s) === wantBig);
        let best = null, bk = null;
        for (const s of all) {
          if (!ok(s)) continue;
          const key = [count.get(s.id) || 0, last.has(s.id) ? last.get(s.id) : -1e9, order.get(s.id)];
          if (!bk || key[0] < bk[0] || (key[0] === bk[0] && (key[1] < bk[1] || (key[1] === bk[1] && key[2] < bk[2])))) { best = s; bk = key; }
        }
        return best;
      };
      for (let k = 0; k < PATTERN.length; k++) {
        const room = L.maxLen - total - (out.length ? L.gap : 0);
        const s = pick(PATTERN[k] >= 3, room) || pick(null, room);
        if (!s) break;
        used.add(s.id); out.push(s); total += dur(s) + (out.length > 1 ? L.gap : 0);
      }
      // 最後はにぎやかな曲で終わる (収まるなら入れ替える)
      if (out.length >= 3 && !big(out[out.length - 1])) {
        const lastS = out[out.length - 1];
        used.delete(lastS.id);
        const alt = pick(true, L.maxLen - (total - dur(lastS)));
        if (alt) { out[out.length - 1] = alt; used.add(alt.id); total += dur(alt) - dur(lastS); } else used.add(lastS.id);
      }
      const starts = []; let t = 0;
      out.forEach((s) => { starts.push(t); t += dur(s) + L.gap; });
      out.forEach((s) => { count.set(s.id, (count.get(s.id) || 0) + 1); last.set(s.id, m); });
      progs.push({ songs: out, starts, len: Math.max(0, t - L.gap) });
    }
    return progs;
  }

  // n 番目の公演: { songs: [曲...], starts: [開始秒...] (公演の始まりから), len: 公演の長さ秒 }
  function program(n) {
    const e = Math.floor(n / EPOCH);
    if (cache.e !== e) { cache.e = e; cache.progs = simulate(e); }
    return cache.progs[((n % EPOCH) + EPOCH) % EPOCH];
  }

  // 時計 nowSec (秒) のときの状態。
  // 戻り値: { n: 公演の番号, on: 公演中か, phase: 'wait' (開演前) | 'song' | 'gap' (曲と曲の間) | 'break' (終演後), startsIn: 次の開演まで (秒。公演中は 0),
  //   k: 何曲目か, song, t: 曲の頭から, left: 曲の残り, next: 次の曲, toNext: 次の曲まで, progLeft: 公演の残り, count: 今日の曲数 }
  function state(nowSec) {
    const cyc = L.cycle, ph = ((nowSec % cyc) + cyc) % cyc, n = Math.floor(nowSec / cyc), prog = program(n), off = ph - L.start;
    const base = { n, on: false, k: -1, song: null, t: 0, left: 0, next: null, toNext: 0, progLeft: 0, count: prog.songs.length, startsIn: 0, phase: 'wait', len: prog.len };
    if (off < 0) return { ...base, phase: 'wait', startsIn: -off, next: prog.songs[0] || null, toNext: -off };
    if (off >= prog.len) return { ...base, phase: 'break', startsIn: cyc - ph + L.start };
    let k = 0;
    while (k + 1 < prog.songs.length && off >= prog.starts[k + 1]) k++;
    const s = prog.songs[k], t = off - prog.starts[k], nextS = prog.songs[k + 1] || null;
    const inSong = t < dur(s);
    return { ...base, on: true, phase: inSong ? 'song' : 'gap', k, song: s, t: inSong ? t : dur(s), left: inSong ? dur(s) - t : 0, next: inSong ? nextS : nextS, toNext: nextS ? prog.starts[k + 1] - off : 0, progLeft: prog.len - off };
  }

  return { program, state, cfg: L, songs };
}

// 聞く位置とステージの距離 d (m) と、ライブの状態 st から、鳴らす曲・位置・音量を決める。
//   duck = 他のショー (パレード・花火) の間の小さくする倍率 (0〜1)。戻り値: { cur: { song, offset, vol } | null, preload: [曲...] (近づいたら先に読む曲) }
export function liveMix(L, st, d, duck = 1) {
  if (!st || !st.on) return { cur: null, preload: [], vol: 0 };
  const near = d < L.radius * 1.3;
  const vol = d >= L.radius ? 0 : d <= L.fullRadius ? 1 : smooth((L.radius - d) / (L.radius - L.fullRadius));
  const cur = st.phase === 'song' && st.song ? { song: st.song, offset: st.t, vol: 0.85 * vol * duck } : null;
  const pre = [];
  if (near) { if (st.song && st.phase === 'song') pre.push(st.song); if (st.next && (st.phase === 'gap' || st.left < 30)) pre.push(st.next); }
  return { cur, preload: pre, vol };
}

// 「ライブ」の観客の多さ (0〜1)。開演の pre 秒前から人が集まり (0 → 0.8)、公演中は 1、終わって post 秒かけて減る
export function liveDensity(L, st) {
  if (!st) return 0;
  if (st.on) return 1;
  if (st.phase === 'wait') return clamp(1 - st.startsIn / 60, 0, 1) * 0.8;
  if (st.phase === 'break') { const after = L.cycle - st.startsIn - st.len; return clamp(1 - after / 25, 0, 1); }   // 公演の終わりからの秒数 = (開演からの秒数 cycle - startsIn) - 公演の長さ
  return 0;
}
