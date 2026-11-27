// キャラメイク: 髪型の付け替え。別の VRM (VRoid の CC0 のサンプル、VRM 0.x) の髪を、今のキャラの頭の骨に付ける。
//   const h = await fitHair(src, vrm, playerFit, entry.tune);  h.dispose() で外す  (entry = public/models/hairs/hairs.json の 1 件。tune は髪ごとの調整)
//   src = 髪のファイル (public/models/hairs/*.glb。tools/hairs.py で作る) を GLTFLoader + VRMLoaderPlugin で読んだもの。
//   playerFit = public/models/hairs/player_fit.json (tools/hairs.py --player で作る。今のキャラの顔の数字と、頭皮の三角形)。
// やること:
//   1. 向き・骨への付け方は outfit.js の fitOutfit (VRM 0.x の元は前が -z なので、向きを 180° 直す)。
//   2. 髪の元の顔 (glb の extras.fit) と今のキャラの顔の寸法 (幅・目の高さ・頭頂・前後) を比べて、頭の骨を中心に
//      髪を拡大縮小・ずらして合わせる (髪ごとの指定は要らない)。
//   3. 髪の下に、今のキャラ自身の頭皮 (髪の色で塗られた地肌の三角形) を少し膨らませて、髪の色で塗った殻を敷く。
//      髪の元の頭の形と今のキャラの頭の形が違っても、地肌 (茶色) が見えないようにする。
import * as THREE from 'three';
import { fitOutfit } from './outfit.js';

// 元の顔 (s) を今のキャラの顔 (p) に合わせる、頭の骨を中心にした倍率とずらし量。座標は元の座標 (前が -z)。
//   高さは 目の上端 → 目の上端、頭頂 → 頭頂 の 2 点で合わせる。前後は 顔の前 → 顔の前、顔の後ろ → 顔の後ろ。幅は顔の幅の比。
export function headAdjust(s, p, { width = 1, keepWidth = 0.5, puff = 1 } = {}) {
  const sy = (p.top - p.eyeTop) / (s.top - s.eyeTop);
  const sz = (p.back - p.front) / (s.back - s.front);
  // 幅は、顔の幅の比をそのまま使うと髪が痩せるので、keepWidth (0..1) だけ元の幅を残す
  const sw = (p.width / s.width) * (1 - keepWidth) + keepWidth;
  const oy = p.eyeTop - sy * s.eyeTop;
  const oz = p.front - sz * s.front; // 元の座標 (前が -z)
  // puff: 頭の中心から見て髪全体を少し膨らませる。今のキャラの頭の表面 + 頭皮の殻の厚みで、髪の殻や前髪が埋もれないように
  //   (中心 = 今のキャラの頭の高さ・前後の真ん中。膨らませる前の変換 y' = sy*y + oy、z' = sz*z + oz を、中心のまわりに P 倍する)
  const P = puff, cy = (p.top + p.chin) / 2, cz = (p.front + p.back) / 2;
  const fy = P * sy, fz = P * sz;
  return { s: [sw * width * P, fy, fz], off: [0, P * oy + (1 - P) * cy, -(P * oz + (1 - P) * cz)] };
  // 座標系は、今のキャラの親の座標系 (前が +z) なので、前後 (z) の向きは逆にしてある
}

// 頭皮の殻: 今のキャラの肌のメッシュ (顔・体) から、頭皮の三角形だけを取り出して、法線の向きに少し膨らませる。
//   scalps = player_fit.json の scalp (面ごと)。返すのは、できたメッシュの配列。
function makeScalp(vrm, scalps, material, lift) {
  const caps = [];
  for (const sc of scalps) {
    let orig = null;
    vrm.scene.traverse((o) => {
      if (orig || !o.isSkinnedMesh || !o.geometry.index) return;
      const mt = Array.isArray(o.material) ? o.material : [o.material];
      if (mt.some(m => m.name === sc.material) && o.geometry.index.count === sc.indexCount && o.geometry.attributes.position.count === sc.vertexCount) orig = o;
    });
    if (!orig) continue;
    const g0 = orig.geometry, geo = new THREE.BufferGeometry();
    const pos = g0.attributes.position, nor = g0.attributes.normal;
    const p = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      p[i * 3] = pos.getX(i) + nor.getX(i) * lift; p[i * 3 + 1] = pos.getY(i) + nor.getY(i) * lift; p[i * 3 + 2] = pos.getZ(i) + nor.getZ(i) * lift;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('normal', nor); geo.setAttribute('uv', g0.attributes.uv);
    geo.setAttribute('skinIndex', g0.attributes.skinIndex); geo.setAttribute('skinWeight', g0.attributes.skinWeight);
    geo.setIndex(sc.index);
    const cap = new THREE.SkinnedMesh(geo, material);
    cap.name = 'hair_scalp';
    cap.frustumCulled = false;
    cap.position.copy(orig.position); cap.quaternion.copy(orig.quaternion); cap.scale.copy(orig.scale);
    orig.parent.add(cap);
    cap.bind(orig.skeleton, orig.bindMatrix);
    caps.push(cap);
  }
  return caps;
}

// 髪の色の殻の材質: 髪の材質 (MToon) を写して、模様を外し、色だけにする。MToon でなければ普通の toon 材質。
function scalpMaterial(src, color) {
  let base = null;
  src.scene.traverse((o) => {
    if (base || !o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!base && /HAIR/.test(m.name) && !/HairBack/.test(m.name)) base = m;
  });
  if (!base) src.scene.traverse((o) => { // 頭の後ろの髪 (HairBack) しかない髪 (Base_Female / Male)
    if (base || !o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!base && /HAIR/.test(m.name)) base = m;
  });
  const c = new THREE.Color().setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace);
  if (base && base.isMToonMaterial) {
    const m = base.clone();
    m.map = null; m.shadeMultiplyTexture = null; m.matcapTexture = null; m.normalMap = null; m.emissiveMap = null; m.rimMultiplyTexture = null;
    // 髪の色 = 模様の平均 × 材質の色 (模様が灰色で、色は材質の色で付けている髪がある)
    m.color.copy(base.color).multiply(c);
    if (m.shadeColorFactor) m.shadeColorFactor.copy(base.shadeColorFactor).multiply(c);
    m.needsUpdate = true;
    return m;
  }
  return new THREE.MeshToonMaterial({ color: c });
}

export async function fitHair(src, vrm, playerFit, { scalp = true, scalpLift = 0.004, adjust = true, keepWidth = 0.5, puff = 1, forward = 0, width = 1 } = {}) {
  const sfit = src.parser.json.extras?.fit;
  const head = adjust && sfit && playerFit?.metrics ? headAdjust(sfit, playerFit.metrics, { keepWidth, puff, width }) : null;
  if (head) {
    // ずらす量は、キャラの元の大きさ (m) で測った値。ゲームの中ではキャラに縮尺がかかっている (character.js) ので、その倍率をかける
    const k = vrm.scene.scale.x;
    head.off[2] += forward; // 前 (+z) へずらす量 (m)。髪ごとの調整 (public/models/hairs/hairs.json の tune)
    head.off = head.off.map((v) => v * k);
  }
  const { group, used } = await fitOutfit(src, vrm, { parts: /./, scale: 1.04, head });
  vrm.scene.add(group);
  let caps = [], capMat = null;
  if (scalp && playerFit?.scalp && sfit?.color) { capMat = scalpMaterial(src, sfit.color); caps = makeScalp(vrm, playerFit.scalp, capMat, scalpLift); }
  return {
    group, caps, capMat, used,
    dispose() {
      vrm.scene.remove(group);
      const mats = new Set(capMat ? [capMat] : []);
      group.traverse((o) => { o.geometry?.dispose?.(); for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) mats.add(m); });
      for (const c of caps) { c.parent?.remove(c); c.geometry.dispose(); }
      for (const m of mats) { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose?.(); } // 模様 (GPU) も手放す
    },
  };
}

// 髪の付け替え (キャラメイクの髪型)。set(entry) の entry は models/hairs/hairs.json の 1 件。null = いつもの髪。
//   読み込んだ髪は覚えない (切り替えのたびに前の髪を手放す。スマホのメモリのため)。ブラウザが 2 回目からはキャッシュから読む。
//   今のキャラ自身の髪 (材質名に HAIR) は、髪を付けている間だけ隠す (Outfitter と同じく、材質ごとに見え方を切り替える)。
//   同時に呼ばれても順番に処理する。
export class Hairdresser {
  constructor(vrm) {
    this.vrm = vrm;
    this.cur = null;
    this.fit = null;        // player_fit.json (今のキャラの顔の数字と頭皮)
    this.loader = null;
    this.own = [];          // 今のキャラの髪の材質
    vrm.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (/HAIR/.test(m.name) && !this.own.includes(m)) this.own.push(m);
    });
    this.busy = Promise.resolve();
  }

  set(entry) {
    this.busy = this.busy.then(() => this._set(entry)).catch((e) => console.warn('髪型の変更に失敗:', e));
    return this.busy;
  }

  async _set(entry) {
    if (this.cur) { this.cur.dispose(); this.cur = null; }
    if (!entry) { for (const m of this.own) m.visible = true; return; }
    if (!this.loader) {
      const [{ GLTFLoader }, { VRMLoaderPlugin }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('@pixiv/three-vrm')]);
      this.loader = new GLTFLoader(); this.loader.register((p) => new VRMLoaderPlugin(p));
    }
    if (!this.fit) this.fit = await fetch(new URL('../models/hairs/player_fit.json', import.meta.url)).then((r) => r.json());
    const src = await this.loader.loadAsync(new URL('../models/hairs/' + entry.id + '.glb', import.meta.url).href);
    this.cur = await fitHair(src, this.vrm, this.fit, entry.tune || {});
    for (const m of this.own) m.visible = false;
  }
}
