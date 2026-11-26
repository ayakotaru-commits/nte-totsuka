// フェアリー・リールパーク: パレードの道。three.js に依存しない (parkshow.js・parkinfo.js・tools/dev/parkcrowdcheck.mjs が使う)
// パレードの道 (1 m おきの点の並び): ネオン・アベニューの入口 → プラザを半周 (入口の側から東の側を通って湖の側へ) → プラザから湖へ。角はなめらかにする。
// 山車 (buildShow)・観客の場所 (parkcrowd.js)・ショーの案内の所要時間 (parkinfo.js) が同じ道を使う
export function paradeRoute(cfg) {
  const S = cfg.show, P = S.parade, plazaE = cfg.ellipses[P.plaza];
  const pathPts = (n) => cfg.paths.find((p) => p.name === n).pts;
  let pts = pathPts(P.avenue).map((p) => [p[0], p[1]]);
  const [cx, cz] = plazaE.center, rx = plazaE.rx * P.ring, rz = plazaE.rz * P.ring;
  const start = -Math.PI / 2;
  for (let k = 0; k <= 22; k++) { const a = start + k / 22 * Math.PI; pts.push([cx + rx * Math.cos(a), cz + rz * Math.sin(a)]); }
  pts = pts.concat(pathPts(P.toLake).map((p) => [p[0], p[1]]));
  for (let it = 0; it < 3; it++) { const o = [pts[0]]; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } o.push(pts[pts.length - 1]); pts = o; }
  const out = [pts[0]], seg = [0]; let acc = 0;
  for (let i = 1; i < pts.length; i++) { const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); acc += L; seg.push(acc); }
  for (let s = 1; s < acc; s += 1) { let j = 1; while (seg[j] < s) j++; const w = (s - seg[j - 1]) / (seg[j] - seg[j - 1] || 1); out.push([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * w, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * w]); }
  return out;
}

// パレードが道を通りきるまでの時間 (秒)。先頭の山車が出てから、最後の山車と踊り手が消えるまで
export const paradeSeconds = (cfg, routeLen) => (routeLen + cfg.show.parade.gap * (cfg.show.parade.floats.length + 1)) / cfg.show.parade.speed + 14;

