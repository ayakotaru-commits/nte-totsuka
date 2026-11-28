// 日本武道館の屋根 (八角形の建物の上に載せる): 国土地理院・PLATEAU の建物は平らな箱なので、輪郭から 2 段の緩い傾きの屋根と、
// 金色の擬宝珠 (ぎぼし。玉ねぎ形のてっぺん) を作る。形は写真からの目分量 (実物は高さ約 42 m・屋根は銀色・てっぺんに擬宝珠)。
// 使い方 (railext.js): 輪郭 ring ([x, z] の列) と屋根の下の高さ y1 から { roof: BufferGeometry, gold: BufferGeometry }
import * as THREE from 'three';

const K1 = 0.6, H1 = 4.2;     // 1 段目の屋根の終わり: 輪郭を 0.6 倍にした輪、下から 4.2 m
const K2 = 0.2, H2 = 6.6;     // 2 段目の屋根の終わり: 0.2 倍の輪、下から 6.6 m (平らなふた)
// 擬宝珠の断面 [半径, 高さ] (m)
const GIBOSHI = [[0, 0], [1.5, 0], [2.2, 0.7], [2.15, 1.6], [1.4, 2.6], [0.6, 3.5], [0.25, 4.4], [0, 5.4]];

export function budokanRoof(ring, y1) {
  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x; cz += z; }
  cx /= ring.length; cz /= ring.length;
  const at = (k, h) => ring.map(([x, z]) => [cx + (x - cx) * k, y1 + h, cz + (z - cz) * k]);
  const rings = [at(1, 0), at(K1, H1), at(K2, H2)];
  const pos = [];
  const n = ring.length;
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < n; i++) {
      const a = rings[s][i], b = rings[s][(i + 1) % n], c = rings[s + 1][(i + 1) % n], d = rings[s + 1][i];
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const top = rings[2];
  for (let i = 1; i < n - 1; i++) pos.push(...top[0], ...top[i + 1], ...top[i]);   // 平らなふた (上向き)
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roof.computeVertexNormals();
  const gold = new THREE.LatheGeometry(GIBOSHI.map(([r, h]) => new THREE.Vector2(r, h)), 16);
  gold.translate(cx, y1 + H2, cz);
  return { roof, gold };
}
