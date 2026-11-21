// 着せ替え: 別の VRM (同じ VRoid の体型) の服のパーツを、今のキャラの骨に付け替える。
//   fitOutfit(src, vrm, { parts })  src = GLTFLoader で読んだ服の元の VRM (gltf)、vrm = 着る側 (three-vrm)
//   服の頂点は元の VRM の骨ごとの座標で持っているので、骨を名前 (VRM の人型の骨) で対応づけ、
//   骨の関節の位置と長さの違いは、骨ごとの座標変換 (位置 + 拡大率) で吸収する。
// 前提: 呼ぶとき、着る側は基準の姿勢 (動かす前)。服は vrm.scene の子に置かれ、骨に合わせて動く。
import * as THREE from 'three';

// 人型の骨 → 長さを測る子の骨 (骨の長さの比から、骨ごとの拡大率を決める)
const CHILD = {
  hips: 'spine', spine: 'chest', chest: 'upperChest', upperChest: 'neck', neck: 'head',
  leftShoulder: 'leftUpperArm', leftUpperArm: 'leftLowerArm', leftLowerArm: 'leftHand', leftHand: 'leftMiddleProximal',
  rightShoulder: 'rightUpperArm', rightUpperArm: 'rightLowerArm', rightLowerArm: 'rightHand', rightHand: 'rightMiddleProximal',
  leftUpperLeg: 'leftLowerLeg', leftLowerLeg: 'leftFoot', leftFoot: 'leftToes',
  rightUpperLeg: 'rightLowerLeg', rightLowerLeg: 'rightFoot', rightFoot: 'rightToes',
};
const FALLBACK = { chest: 'neck', upperChest: 'neck' };

function humanoidNames(src) {
  // 元の VRM (1.0 / 0.x) の 人型の骨の名前 → ノード
  const ext = src.parser.json.extensions || {};
  const map = new Map(); // Object3D → 人型の骨の名前
  const add = (name, idx) => src.parser.getDependency('node', idx).then(o => map.set(o, name));
  const jobs = [];
  if (ext.VRMC_vrm) for (const [k, v] of Object.entries(ext.VRMC_vrm.humanoid.humanBones)) jobs.push(add(k, v.node));
  else if (ext.VRM) for (const b of ext.VRM.humanoid.humanBones) jobs.push(add(b.bone, b.node));
  return Promise.all(jobs).then(() => map);
}

// 材質名で服のパーツを選ぶ。parts は材質名にあてる正規表現 (例: /Tops|Bottoms|Shoes/)
export async function fitOutfit(src, vrm, { parts, scale = 1 } = {}) {
  const hmap = await humanoidNames(src);
  src.scene.updateMatrixWorld(true);
  vrm.scene.updateMatrixWorld(true);
  const wpos = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
  const bonePlayer = (n) => vrm.humanoid.getNormalizedBoneNode(n);
  const boneLyla = new Map(); // 人型の名前 → 元の VRM の骨
  for (const [o, n] of hmap) boneLyla.set(n, o);

  // 骨ごとの変換 M = T(着る側の関節) · R(元の骨の向き) · S(拡大率)
  const mats = new Map();
  const scaleOf = (n) => {
    const c = [CHILD[n], FALLBACK[n]].find(x => x && boneLyla.has(x) && bonePlayer(x));
    if (!c || !boneLyla.has(n) || !bonePlayer(n)) return null;
    const dl = wpos(boneLyla.get(c)).distanceTo(wpos(boneLyla.get(n)));
    const dp = wpos(bonePlayer(c)).distanceTo(wpos(bonePlayer(n)));
    return dl > 1e-4 ? dp / dl : null;
  };
  let last = 1;
  for (const [n, lo] of boneLyla) {
    const po = bonePlayer(n);
    if (!po) continue;
    const s = (scaleOf(n) ?? last) * scale; last = s / scale;
    const q = new THREE.Quaternion(); lo.matrixWorld.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    const M = new THREE.Matrix4().compose(wpos(po), q, new THREE.Vector3(s, s, s));
    mats.set(n, { M, inv: lo.matrixWorld.clone().invert(), po });
  }

  const group = new THREE.Group();
  group.name = 'outfit';
  const used = [];
  src.scene.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const mt = Array.isArray(m.material) ? m.material : [m.material];
    const keep = []; // [グループ, 材質]
    // GLTFLoader は 1 つの材質ごとに別のメッシュにする (groups が無い)
    const gs = m.geometry.groups.length ? m.geometry.groups : [{ start: 0, count: m.geometry.index.count, materialIndex: 0 }];
    for (const g of gs) if (parts.test(mt[g.materialIndex].name)) keep.push(g);
    if (!keep.length) return;
    // 選んだ材質の三角形だけを集めた形
    const idx = m.geometry.index.array, out = [];
    const groups = [];
    for (const g of keep) {
      const start = out.length;
      for (let i = g.start; i < g.start + g.count; i++) out.push(idx[i]);
      groups.push({ start, count: out.length - start, materialIndex: groups.length });
    }
    const geo = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(m.geometry.attributes)) geo.setAttribute(k, a);
    geo.setIndex(out); geo.groups = groups;
    geo.morphAttributes = {};
    const materials = keep.map(g => {
      const o = mt[g.materialIndex], c = o.clone();
      used.push(o.name);
      return c;
    });
    // 骨: 元の骨 → いちばん近い人型の骨 (人型でない骨は、人型の親について動く) → 着る側の骨
    const bones = [], inverses = [];
    for (const b of m.skeleton.bones) {
      let h = b; while (h && !hmap.has(h)) h = h.parent;
      const e = h && mats.get(hmap.get(h));
      if (!e) { // 対応する骨が無い: 腰につける
        const hips = mats.get('hips'); bones.push(hips.po);
        inverses.push(hips.po.matrixWorld.clone().invert().multiply(hips.M).multiply(hips.inv)); continue;
      }
      bones.push(e.po);
      // 基準の姿勢で M · inv · v に置かれ、姿勢を付けると 骨の動き (現在 · 基準の逆) が掛かる
      inverses.push(e.po.matrixWorld.clone().invert().multiply(e.M).multiply(e.inv));
    }
    const mesh = new THREE.SkinnedMesh(geo, materials);
    mesh.name = 'outfit_' + m.name;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.skeleton = new THREE.Skeleton(bones, inverses);
    mesh.bind(mesh.skeleton, new THREE.Matrix4());
    group.add(mesh);
  });
  return { group, used };
}
