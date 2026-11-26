// スマホ用の軽量化 (段階 6): 動かない小物のメッシュを、材質 × 区画 (cell m 四方) ごとに 1 つにまとめて、描画の呼び出しを減らす。
// 園の特別な物 (火山・灯台・船・岩・きのこ・棒つきキャンディ・墓石・噴水・門の柱) は 1 つずつの Mesh で、スマホでは呼び出しの数がコストになる (影の描画で 2 倍)。
// 対象 = Mesh のうち、InstancedMesh・Points でなく、材質が 1 つで、頂点属性が position・normal・uv だけのもの (primitive の形)。ほかは触らない。
// 区画ごとに分けるので、画面の外の区画は今までどおり描かれない。
import * as THREE from 'three';

export function mergeStaticMeshes(root, { cell = 160, skip = null } = {}) {
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), M = new THREE.Matrix4(), V = new THREE.Vector3();
  const groups = new Map(), merged = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || (skip && skip(o))) return;
    const g = o.geometry, names = Object.keys(g.attributes).sort().join(',');
    if (names !== 'normal,position,uv') return;
    V.setFromMatrixPosition(o.matrixWorld);
    const key = [o.material.uuid, Math.floor(V.x / cell), Math.floor(V.z / cell), o.castShadow ? 1 : 0, o.receiveShadow ? 1 : 0].join('|');
    let e = groups.get(key); if (!e) groups.set(key, e = { mat: o.material, cs: o.castShadow, rs: o.receiveShadow, list: [] });
    e.list.push(o);
  });
  for (const e of groups.values()) {
    if (e.list.length < 2) continue;
    let nv = 0; const geos = e.list.map((o) => { const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); M.multiplyMatrices(inv, o.matrixWorld); g.applyMatrix4(M); nv += g.attributes.position.count; return g; });
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2); let at = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, at * 3); nor.set(g.attributes.normal.array, at * 3); uv.set(g.attributes.uv.array, at * 2);
      at += g.attributes.position.count; g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, e.mat); m.name = 'park_merged'; m.castShadow = e.cs; m.receiveShadow = e.rs;
    root.add(m); merged.push(m);
    for (const o of e.list) { o.parent.remove(o); o.geometry.dispose(); }
  }
  // 空になったグループを取り除く
  const empty = [];
  root.traverse((o) => { if (o !== root && o.isGroup && o.children.length === 0) empty.push(o); });
  for (const o of empty) if (o.parent) o.parent.remove(o);
  return { before: [...groups.values()].reduce((s, e) => s + e.list.length, 0), after: merged.length };
}
