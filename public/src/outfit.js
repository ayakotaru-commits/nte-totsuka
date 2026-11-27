// 着せ替え: 別の VRM (同じ VRoid の体型) の服のパーツを、今のキャラの骨に付け替える。
//   const o = new Outfitter(vrm);  await o.set({ tops: url, bottoms: null, shoes: url, onepiece: null })  (null = いつもの)
//   服のファイルは tools/outfits.py で作る (public/models/outfits/*.glb)。
// 仕組み: 服の頂点は元の VRM の骨ごとの座標で持っている。骨を名前 (VRM の人型の骨) で対応づけ、
//   骨の関節の位置と長さの違いは、骨ごとの座標変換 M = T(今のキャラの関節) · R(元の骨の向き) · S(骨の長さの比 × 膨らみ) で吸収する。
//   合わせるのは基準の姿勢 (動かす前) で、キャラの置かれた位置・向き・大きさは関係しない (キャラの親の座標系で計算する)。
//   服は vrm.scene の子に置かれ、骨 (normalized) の動きにそのまま追従する。
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
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); // VRM 0.x の元の向きを直す回転
const OWN_PARTS = /Tops|Bottoms|Shoes/; // 今のキャラの服の材質 (服を着せるとき隠す)

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

// 材質名で服のパーツを選ぶ。parts は材質名にあてる正規表現 (既定は全部)。
// scale は服全体の膨らみ (1.04 = 4% 大きく。今のキャラの肩甲骨などが服から突き出るのを防ぐ)
// head は頭の骨につくもの (髪) だけの調整: { s: [x, y, z] 頭の骨の関節を中心にした倍率 (顔の幅・高さ・奥行きの違い), off: [x, y, z] ずらす量 (m。キャラの親の座標系。+z が前、+y が上) }
export async function fitOutfit(src, vrm, { parts = /./, scale = 1.04, head = null } = {}) {
  const hmap = await humanoidNames(src);
  // 基準の姿勢にして計算し、終わったら姿勢を戻す (動いている最中に呼ばれてもよい)
  const saved = vrm.humanoid.getNormalizedPose();
  vrm.humanoid.resetNormalizedPose();
  vrm.scene.parent?.updateWorldMatrix(true, false);
  vrm.scene.updateMatrixWorld(true);
  src.scene.updateMatrixWorld(true);
  try {
    // キャラの親の座標系 (位置・向きの影響を受けない)
    const Fi = (vrm.scene.parent ? vrm.scene.parent.matrixWorld.clone() : new THREE.Matrix4()).invert();
    const rel = (o) => Fi.clone().multiply(o.matrixWorld);
    const lpos = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    const ppos = (o) => new THREE.Vector3().setFromMatrixPosition(rel(o));
    // 元が VRM 0.x (前が -z) のときは、今のキャラ (前が +z。読み込み時に 180° 回してある) に向きをそろえる。VRM 1.0 の服は前が +z でそのまま
    const j0 = src.parser.json.extensions || {};
    const flip = !!j0.VRM && !j0.VRMC_vrm;
    const bonePlayer = (n) => vrm.humanoid.getNormalizedBoneNode(n);
    const boneLyla = new Map(); // 人型の名前 → 元の VRM の骨
    for (const [o, n] of hmap) boneLyla.set(n, o);

    const mats = new Map();
    const scaleOf = (n) => {
      const c = [CHILD[n], FALLBACK[n]].find(x => x && boneLyla.has(x) && bonePlayer(x));
      if (!c || !boneLyla.has(n) || !bonePlayer(n)) return null;
      const dl = lpos(boneLyla.get(c)).distanceTo(lpos(boneLyla.get(n)));
      const dp = ppos(bonePlayer(c)).distanceTo(ppos(bonePlayer(n)));
      return dl > 1e-4 ? dp / dl : null;
    };
    let last = 1;
    for (const [n, lo] of boneLyla) {
      const po = bonePlayer(n);
      if (!po) continue;
      const s = (scaleOf(n) ?? last) * scale; last = s / scale;
      const q = new THREE.Quaternion(); lo.matrixWorld.decompose(new THREE.Vector3(), q, new THREE.Vector3());
      if (flip) q.premultiply(FLIP);
      const hd = n === 'head' && head;
      const M = new THREE.Matrix4().compose(hd ? ppos(po).add(new THREE.Vector3(...(head.off || [0, 0, 0]))) : ppos(po), q,
        hd ? new THREE.Vector3(s * (head.s?.[0] ?? 1), s * (head.s?.[1] ?? 1), s * (head.s?.[2] ?? 1)) : new THREE.Vector3(s, s, s));
      mats.set(n, { M, inv: lo.matrixWorld.clone().invert(), rest: rel(po), po });
    }

    const group = new THREE.Group();
    group.name = 'outfit';
    const used = [];
    // 骨の値 = (基準の姿勢のその骨の座標の逆) · M · (元の骨の座標の逆)。姿勢が付くと 骨の動き (現在 · 基準の逆) が掛かる
    const boneInverse = (e) => e.rest.clone().invert().multiply(e.M).multiply(e.inv);
    src.scene.traverse((m) => {
      if (!m.isSkinnedMesh) return;
      const mt = Array.isArray(m.material) ? m.material : [m.material];
      const keep = [];
      // GLTFLoader は 1 つの材質ごとに別のメッシュにする (groups が無い)
      const gs = m.geometry.groups.length ? m.geometry.groups : [{ start: 0, count: m.geometry.index.count, materialIndex: 0 }];
      for (const g of gs) if (parts.test(mt[g.materialIndex].name)) keep.push(g);
      if (!keep.length) return;
      const idx = m.geometry.index.array, out = [], groups = [];
      for (const g of keep) {
        const start = out.length;
        for (let i = g.start; i < g.start + g.count; i++) out.push(idx[i]);
        groups.push({ start, count: out.length - start, materialIndex: groups.length });
      }
      const geo = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(m.geometry.attributes)) geo.setAttribute(k, a);
      geo.setIndex(out); geo.groups = groups; geo.morphAttributes = {};
      const materials = keep.map(g => { const o = mt[g.materialIndex]; used.push(o.name); return o.clone(); });
      // 骨: 元の骨 → いちばん近い人型の骨 (人型でない骨は、人型の親について動く) → 着る側の骨
      const bones = [], inverses = [];
      for (const b of m.skeleton.bones) {
        let h = b; while (h && !hmap.has(h)) h = h.parent;
        const e = (h && mats.get(hmap.get(h))) || mats.get('hips'); // 対応する骨が無いときは腰につける
        bones.push(e.po); inverses.push(boneInverse(e));
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
  } finally {
    vrm.humanoid.setNormalizedPose(saved);
    vrm.scene.updateMatrixWorld(true);
  }
}

// 服の切り替え (枠ごと)。読み込んだ服は覚えておき、2 回目からは表示を切り替えるだけ。
//   set({ tops, bottoms, shoes, onepiece }) 各値は 服のファイルの URL か null (= いつもの)。
//   今のキャラ自身の服は、枠ごとに「その枠に服がある」ときだけ隠す (ワンピースは トップスとボトムスの両方を隠す)。
const OWN_SLOT = { tops: /Tops/, bottoms: /Bottoms/, shoes: /Shoes/ };
export class Outfitter {
  constructor(vrm) {
    this.vrm = vrm;
    this.cache = new Map(); // url → group
    this.shown = [];
    this.own = { tops: [], bottoms: [], shoes: [] }; // 今のキャラの服の材質 (枠ごと)
    vrm.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        for (const [k, re] of Object.entries(OWN_SLOT)) if (re.test(m.name)) this.own[k].push(m);
    });
    this.loader = null;
    this.busy = Promise.resolve();
  }

  // 同時に呼ばれても順番に処理する
  set(slots) {
    this.busy = this.busy.then(() => this._set(slots || {})).catch((e) => console.warn('着替えに失敗:', e));
    return this.busy;
  }

  async _group(url) {
    let g = this.cache.get(url);
    if (g) return g;
    if (!this.loader) {
      const [{ GLTFLoader }, { VRMLoaderPlugin }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('@pixiv/three-vrm')]);
      this.loader = new GLTFLoader(); this.loader.register((p) => new VRMLoaderPlugin(p));
    }
    const src = await this.loader.loadAsync(url);
    g = (await fitOutfit(src, this.vrm)).group;
    this.vrm.scene.add(g);
    this.cache.set(url, g);
    return g;
  }

  async _set(slots) {
    const want = [];
    for (const k of ['tops', 'bottoms', 'shoes', 'onepiece']) if (slots[k]) want.push(await this._group(slots[k]));
    for (const g of this.shown) g.visible = false;
    for (const g of want) g.visible = true;
    this.shown = want;
    const cover = { tops: !!(slots.tops || slots.onepiece), bottoms: !!(slots.bottoms || slots.onepiece), shoes: !!slots.shoes };
    for (const k of Object.keys(this.own)) for (const m of this.own[k]) m.visible = !cover[k];
  }
}
