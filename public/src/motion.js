// 動きのデータ (public/data/motions/*.json。作り方は tools/motion/export.js) を読み、時間で引く。
// 骨の向きは character.js の BONE と同じ基準 (腕は下ろした姿勢が 0)。腰の移動は「腰の高さ」を 1 とした値。
import * as THREE from 'three';

const CLIPS = {};
const loading = {};

// 読み込む (済んでいれば何もしない)。読み込みが終わるまで sampleMotion は null を返す
export function loadMotion(name) {
  if (CLIPS[name] || loading[name]) return loading[name];
  loading[name] = fetch(new URL(`../data/motions/${name}.json`, import.meta.url))
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((c) => { CLIPS[name] = c; })
    .catch((e) => console.warn('動きのデータを読めませんでした: ' + name, e));
  return loading[name];
}

// 時間 t (秒) の腰の位置 [x, y, z] (腰の高さを 1 とした値。T ポーズの腰からの差)。無ければ null
export function hipsAt(name, t) {
  const c = CLIPS[name];
  if (!c) return null;
  const f = Math.max(0, Math.min(c.frames - 1, t * c.fps)), i = Math.min(c.frames - 2, Math.floor(f)), u = f - i, H = c.hips;
  return [0, 1, 2].map((j) => H[i * 3 + j] + (H[i * 3 + 3 + j] - H[i * 3 + j]) * u);
}

// 読み込み済みのデータ (無ければ undefined)。speed・phaseL・dur などを見るのに使う
export const getMotion = (name) => CLIPS[name];

const _a = new THREE.Quaternion(), _b = new THREE.Quaternion();
// 左右反転: 骨の左右を入れ替え (shL ↔ shR など)、回転は左右 (x) の鏡に映す = (x, -y, -z, w)、腰の左右のずれは逆
const other = (n) => n.endsWith('L') ? n.slice(0, -1) + 'R' : n.endsWith('R') ? n.slice(0, -1) + 'L' : n;
// 時間 t (秒) の姿勢を out.q (骨の名前 → Quaternion) と out.hips ([x, y, z]) に入れて返す。mirror = 左右反転
export function sampleMotion(name, t, out, mirror = false) {
  const c = CLIPS[name];
  if (!c) return null;
  const f = Math.max(0, Math.min(c.frames - 1, t * c.fps)), i = Math.min(c.frames - 2, Math.floor(f)), u = f - i;
  out.q = out.q || {};
  for (const n in c.bones) {
    const B = c.bones[mirror ? other(n) : n];
    _a.fromArray(B, i * 4); _b.fromArray(B, i * 4 + 4);
    const q = (out.q[n] = out.q[n] || new THREE.Quaternion()).slerpQuaternions(_a, _b, u);
    if (mirror) { q.y = -q.y; q.z = -q.z; }
  }
  const H = c.hips, k = (j) => H[i * 3 + j] + (H[i * 3 + 3 + j] - H[i * 3 + j]) * u;
  out.hips = [mirror ? -k(0) : k(0), k(1), k(2)];
  return out;
}
