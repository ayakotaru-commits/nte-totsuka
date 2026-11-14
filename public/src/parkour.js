// パルクール (柵の飛び越え・よじ登り) の動きの道筋。three.js を使わない計算だけ (player.js と tools/dev/charview.html が使う)。
//   vault: 低くて薄いもの (ガードレール・柵・低い塀) を、片手をついて飛び越える
//   hop:   低い台に飛び乗る (手は使わない)
//   climb: 手が届く高さの縁に両手をかけ、体を引き上げて上に立つ。薄い塀なら、そのまま向こう側へ降りる
// 道筋は「始めた位置から進む向きへの距離 q」と「足元の高さ y」を、進み具合 s (0〜1) の関数で表す。
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

export const REACH_H = 2.3;  // 足元から手が届く高さ (m)。これより高い縁はつかめない
export const VAULT_H = 1.25; // 飛び越えられる高さ
export const HOP_H = 0.9;    // 手を使わずに飛び乗れる高さ
const HANG = 1.9;            // ぶら下がったときの、手から足先まで
const MANTLE = 0.8;          // 縁に腕を突っ張って腰まで上がったときの、縁から足先まで

// o: { y0: 始めの足元の高さ, top: 上端の高さ, tE: 壁までの距離, end: 壁から終点までの距離, thick: 奥行き (vault),
//      yEnd: 終点の足元の高さ, endAir: 終点が空中か, speed: 今の速さ }
export function plan(type, o) {
  const a = { type, ...o, D: o.tE + o.end, h: o.top - o.y0 };
  if (type === 'vault') {
    a.v = Math.max(o.speed, 5);
    a.dur = clamp(a.D / a.v, 0.34, 0.6);
    a.sC = clamp((o.tE + o.thick / 2) / a.D, 0.3, 0.7); // 柵の真上を通る時点
    a.bump = Math.max(0.25, o.top - 0.1 - (o.y0 + o.yEnd) / 2);
  } else if (type === 'hop') {
    a.dur = 0.3 + 0.12 * a.h;
  } else {
    a.dur = 0.62 + 0.38 * clamp((a.h - HOP_H) / (REACH_H - HOP_H), 0, 1);
    a.yH = Math.max(o.y0, o.top - HANG);
    a.yM = Math.max(a.yH, o.top - MANTLE);
  }
  return a;
}

// 返り値: { q, y, ps: 姿勢の進み具合 (vault は柵の真上が 0.5) }
export function sample(a, s) {
  if (a.type === 'vault') {
    const ps = s < a.sC ? 0.5 * s / a.sC : 0.5 + 0.5 * (s - a.sC) / (1 - a.sC);
    return { q: a.D * s, y: mix(a.y0, a.yEnd, sstep(0, 1, ps)) + a.bump * 4 * ps * (1 - ps), ps };
  }
  if (a.type === 'hop') {
    return { q: a.D * s, y: a.y0 + a.h * sstep(0, 0.6, s) + 0.8 * s * (1 - s), ps: s };
  }
  const q1 = Math.max(0, a.tE - 0.3), q2 = Math.max(q1, a.tE - 0.14);
  const q = mix(mix(mix(0, q1, sstep(0, 0.18, s)), q2, sstep(0.3, 0.62, s)), a.D, sstep(0.7, 1, s));
  const y = mix(mix(mix(a.y0, a.yH, sstep(0, 0.18, s)), a.yM, sstep(0.16, 0.62, s)), a.yEnd, sstep(0.58, 0.9, s));
  return { q, y, ps: s };
}
