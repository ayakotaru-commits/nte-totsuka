// 最後にいた場所の保存と再開。端末のブラウザ (localStorage) にだけ保存する (服の wardrobe.js と同じ)。
// 保存するのは x・z・向き (facing)・カメラの向き (yaw)。高さは地面から決め直す (屋根の上で閉じても、地面から再開)。
// 保存しない: 電車・観覧車に乗っている間 / イベント・ゲームセンター・メニュー中 / 撮影・確認用の URL (?shot ?swarm ?rhythm ?noresume)。
// ?resetsave で保存を消す (共通)。?noresume で、保存は読まず・書かず、いつもの出発地点から始める。
const KEY = 'totsuka.lastpos.v1';
const SAVE_EVERY = 2; // 秒

export function loadLastPos(q) {
  try {
    if (q.has('resetsave')) localStorage.removeItem(KEY);
    if (q.has('noresume') || q.has('shot') || q.has('swarm') || q.has('rhythm')) return null;
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && [s.x, s.z, s.facing, s.yaw].every(Number.isFinite)) return s;
  } catch (e) { /* 読めなければいつもの出発地点 */ }
  return null;
}

// getState() は { x, z, facing, yaw } か、いま保存してはいけない時は null。tick(dt) を毎コマ呼ぶ
export function startLastPosSaver(q, getState) {
  if (q.has('noresume') || q.has('shot') || q.has('swarm') || q.has('rhythm')) return { tick() {} };
  let acc = 0, last = '';
  const save = () => {
    const s = getState();
    if (!s) return;
    const j = JSON.stringify({ x: +s.x.toFixed(2), z: +s.z.toFixed(2), facing: +s.facing.toFixed(3), yaw: +s.yaw.toFixed(3) });
    if (j === last) return;
    last = j;
    try { localStorage.setItem(KEY, j); } catch (e) { /* 保存できない環境 */ }
  };
  addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
  return { tick(dt) { acc += dt; if (acc >= SAVE_EVERY) { acc = 0; save(); } } };
}
