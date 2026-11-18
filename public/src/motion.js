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

const _a = new THREE.Quaternion(), _b = new THREE.Quaternion();
// 時間 t (秒) の姿勢を out.q (骨の名前 → Quaternion) と out.hips ([x, y, z]) に入れて返す
export function sampleMotion(name, t, out) {
  const c = CLIPS[name];
  if (!c) return null;
  const f = Math.max(0, Math.min(c.frames - 1, t * c.fps)), i = Math.min(c.frames - 2, Math.floor(f)), u = f - i;
  out.q = out.q || {};
  for (const n in c.bones) {
    const B = c.bones[n];
    _a.fromArray(B, i * 4); _b.fromArray(B, i * 4 + 4);
    (out.q[n] = out.q[n] || new THREE.Quaternion()).slerpQuaternions(_a, _b, u);
  }
  const H = c.hips, k = (j) => H[i * 3 + j] + (H[i * 3 + 3 + j] - H[i * 3 + j]) * u;
  out.hips = [k(0), k(1), k(2)];
  return out;
}
