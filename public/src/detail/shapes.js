// 3. 建物の飾り: 集合住宅のベランダ、店舗の看板と日よけ (屋根は city.js が city.json の roof から作る)
// 配置は tools/build_props.py が計算した data/props.json (balconies / signs)。ここでは形を作って置くだけ。
import * as THREE from 'three';
import { Builder, canvasTexture } from './util.js';

export function buildShapes(props) {
  const group = new THREE.Group();
  group.name = 'detail_shapes';
  const emissive = [];

  // ---------- ベランダ (壁ごと。2 階から上の各階に床スラブと手すり壁) ----------
  const slabB = new Builder(), railB = new Builder(), darkRailB = new Builder();
  for (const w of props.balconies) {
    const { x, z, dx: ux, dz: uz, nx, nz, len } = w;
    const RB = w.dark ? darkRailB : railB;
    const inset = 0.4, D = 1.1;
    const Q = (t, d, y) => [x + ux * t + nx * d, y, z + uz * t + nz * d];
    for (let k = 1; k < w.floors; k++) {
      const y = w.y + k * w.floorH;
      // 床スラブ
      slabB.quad(Q(inset, 0, y), Q(len - inset, 0, y), Q(len - inset, D, y), Q(inset, D, y), [0, 1, 0]);
      slabB.quad(Q(inset, 0, y - 0.15), Q(len - inset, 0, y - 0.15), Q(len - inset, D, y - 0.15), Q(inset, D, y - 0.15), [0, -1, 0]);
      slabB.quad(Q(inset, D, y - 0.15), Q(len - inset, D, y - 0.15), Q(len - inset, D, y), Q(inset, D, y), [nx, 0, nz]);
      // 手すり壁 (前面 + 両端)
      RB.quad(Q(inset, D, y), Q(len - inset, D, y), Q(len - inset, D, y + 1.1), Q(inset, D, y + 1.1), [nx, 0, nz]);
      for (const t of [inset, len - inset]) RB.quad(Q(t, 0, y), Q(t, D, y), Q(t, D, y + 1.1), Q(t, 0, y + 1.1), [ux, 0, uz]);
    }
  }
  const slabs = new THREE.Mesh(slabB.geometry(), new THREE.MeshStandardMaterial({ color: '#d9d6cf', roughness: 0.9 }));
  slabs.castShadow = slabs.receiveShadow = true; slabs.name = 'balcony_slabs';
  const darkRails = new THREE.Mesh(darkRailB.geometry(), new THREE.MeshStandardMaterial({ color: '#3b4148', roughness: 0.4, metalness: 0.5, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  darkRails.castShadow = true; darkRails.name = 'balcony_rails_dark';
  const rails = new THREE.Mesh(railB.geometry(), new THREE.MeshStandardMaterial({ color: '#eef0f0', roughness: 0.6, transparent: true, opacity: 0.88, side: THREE.DoubleSide }));
  rails.castShadow = true; rails.name = 'balcony_rails';
  group.add(darkRails, slabs, rails);

  // ---------- 店の看板と日よけ ----------
  for (const p of props.signs) {
    const [bg, fg, accent] = p.colors;
    const w = p.w, nx = Math.sin(p.yaw), nz = Math.cos(p.yaw);
    const tex = canvasTexture(1024, 160, (g, W, H) => {
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.fillStyle = accent; g.fillRect(0, H - 22, W, 22);
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      let fs = 96;
      g.font = `bold ${fs}px "Yu Gothic UI", "Meiryo", sans-serif`;
      while (g.measureText(p.name).width > W - 60 && fs > 30) { fs -= 6; g.font = `bold ${fs}px "Yu Gothic UI", "Meiryo", sans-serif`; }
      g.fillText(p.name, W / 2, (H - 22) / 2 + 4);
    });
    const signMat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.5 });
    emissive.push(signMat);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(w, w * 160 / 1024 * 1.0 + 0.3, 0.18), [null, null, null, null, signMat, null].map(m => m || new THREE.MeshStandardMaterial({ color: '#2b2e33' })));
    sign.position.set(p.x + nx * 0.12, p.y + 3.35, p.z + nz * 0.12);
    sign.rotation.y = p.yaw;
    sign.castShadow = true;
    // 日よけ (ストライプ)
    const awTex = canvasTexture(256, 64, (g, W, H) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f4f1ea' : accent; g.fillRect(i * W / 8, 0, W / 8, H); } });
    awTex.wrapS = THREE.RepeatWrapping; awTex.repeat.set(Math.max(1, Math.round(w / 2.5)), 1);
    const aw = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.2), new THREE.MeshStandardMaterial({ map: awTex, side: THREE.DoubleSide, roughness: 0.8 }));
    aw.position.set(p.x + nx * 0.55, p.y + 2.6, p.z + nz * 0.55);
    aw.rotation.order = 'YXZ';
    aw.rotation.y = p.yaw;
    aw.rotation.x = -1.05;
    aw.castShadow = true;
    group.add(sign, aw);
  }

  console.info(`[detail] balcony walls=${props.balconies.length} shop signs=${props.signs.length}`);
  return { group, emissive };
}
