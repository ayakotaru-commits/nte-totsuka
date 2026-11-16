// 3. 建物の飾り: 集合住宅のベランダ、店舗の看板と日よけ (屋根は city.js が city.json の roof から作る)
// 配置は tools/build_props.py が計算した data/props.json (balconies / signs)。ここでは形を作って置くだけ。
import * as THREE from 'three';
import { Builder, canvasTexture } from './util.js';

export function buildShapes(props) {
  const group = new THREE.Group();
  group.name = 'detail_shapes';
  const emissive = [];

  // ---------- ベランダ (壁ごと。2 階から上の各階に床スラブと手すり壁) ----------
  const slabB = new Builder(), railB = new Builder(), darkRailB = new Builder(), creamB = new Builder();
  for (const w of props.balconies) {
    const { x, z, dx: ux, dz: uz, nx, nz, len } = w;
    // dark = 敷地 (グランシティ) の壁。クリーム色の厚いスラブ + 薄い灰色の格子の手すり。corr = 川側の横に連続した廊下状 (白い縦格子)
    const RB = w.corr ? railB : w.dark ? darkRailB : railB, SB = w.dark ? creamB : slabB, T = w.dark ? 0.4 : 0.15;
    const inset = w.corr ? 0.1 : 0.4, D = w.corr ? 1.6 : w.dark ? 1.5 : 1.1;
    const Q = (t, d, y) => [x + ux * t + nx * d, y, z + uz * t + nz * d];
    // 敷地の壁 (corr 以外) は、写真のように張り出しの深さを部屋ごと・階ごとにずらす (段々になる)。
    // それ以外は壁全体で 1 枚
    const stag = w.dark && !w.corr;
    const BAY = 7.2, nseg = stag ? Math.max(1, Math.round((len - 2 * inset) / BAY)) : 1;
    const DEPTHS = [1.3, 2.4, 3.3, 1.9, 2.8];
    for (let k = 1; k < w.floors; k++) {
      const y = w.y + k * w.floorH;
      for (let i = 0; i < nseg; i++) {
        const t0 = inset + (len - 2 * inset) * i / nseg + (stag ? 0.5 : 0), t1 = inset + (len - 2 * inset) * (i + 1) / nseg - (stag ? 0.5 : 0);
        const D2 = stag ? DEPTHS[(((k * 2 + i * 3 + Math.round(w.x + w.z)) % DEPTHS.length) + DEPTHS.length) % DEPTHS.length] : D;
        const Q2 = (t, d, yy) => [x + ux * t + nx * d, yy, z + uz * t + nz * d];
        // 床スラブ
        SB.quad(Q2(t0, 0, y), Q2(t1, 0, y), Q2(t1, D2, y), Q2(t0, D2, y), [0, 1, 0]);
        SB.quad(Q2(t0, 0, y - T), Q2(t1, 0, y - T), Q2(t1, D2, y - T), Q2(t0, D2, y - T), [0, -1, 0]);
        SB.quad(Q2(t0, D2, y - T), Q2(t1, D2, y - T), Q2(t1, D2, y), Q2(t0, D2, y), [nx, 0, nz]);
        if (stag) for (const t of [t0, t1]) SB.quad(Q2(t, 0, y - T), Q2(t, D2, y - T), Q2(t, D2, y), Q2(t, 0, y), [ux, 0, uz]);
        // 手すり壁 (前面 + 両端)
        RB.quad(Q2(t0, D2, y), Q2(t1, D2, y), Q2(t1, D2, y + 1.1), Q2(t0, D2, y + 1.1), [nx, 0, nz]);
        for (const t of [t0, t1]) RB.quad(Q2(t, 0, y), Q2(t, D2, y), Q2(t, D2, y + 1.1), Q2(t, 0, y + 1.1), [ux, 0, uz]);
      }
    }
  }
  const slabs = new THREE.Mesh(slabB.geometry(), new THREE.MeshStandardMaterial({ color: '#d9d6cf', roughness: 0.9 }));
  slabs.castShadow = slabs.receiveShadow = true; slabs.name = 'balcony_slabs';
  const creams = new THREE.Mesh(creamB.geometry(), new THREE.MeshStandardMaterial({ color: '#e0d0aa', roughness: 0.9 }));
  creams.castShadow = creams.receiveShadow = true; creams.name = 'balcony_slabs_cream';
  const darkRails = new THREE.Mesh(darkRailB.geometry(), new THREE.MeshStandardMaterial({ color: '#8d959b', roughness: 0.4, metalness: 0.4, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
  darkRails.castShadow = true; darkRails.name = 'balcony_rails_dark';
  const rails = new THREE.Mesh(railB.geometry(), new THREE.MeshStandardMaterial({ color: '#eef0f0', roughness: 0.6, transparent: true, opacity: 0.88, side: THREE.DoubleSide }));
  rails.castShadow = true; rails.name = 'balcony_rails';
  group.add(darkRails, slabs, creams, rails);

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

  // ---------- ランドマークの大きな壁面看板 (文字だけ。実物のロゴではない) ----------
  for (const p of props.bigSigns || []) {
    const nx = Math.sin(p.yaw), nz = Math.cos(p.yaw);
    const tex = canvasTexture(1024, 128, (g, W, H) => {
      g.fillStyle = p.bg; g.fillRect(0, 0, W, H);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      let x0 = 0;
      if (p.mark) { // 左端の色つきの印 (文字だけ)
        x0 = W * 0.26;
        g.fillStyle = p.mark.bg; g.fillRect(0, 0, x0, H);
        g.fillStyle = p.mark.fg || '#ffffff'; g.font = 'bold 84px "Yu Gothic UI", "Meiryo", sans-serif';
        g.fillText(p.mark.text, x0 / 2, H / 2 + 4);
      }
      g.fillStyle = p.fg;
      let fs = 92;
      const font = () => { g.font = `bold ${fs}px "Yu Gothic UI", "Meiryo", sans-serif`; };
      font();
      if ('letterSpacing' in g) g.letterSpacing = '14px';
      while (g.measureText(p.text).width > W - x0 - 80 && fs > 30) { fs -= 4; font(); }
      g.fillText(p.text, x0 + (W - x0) / 2, H / 2 + 4);
    });
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.5 });
    emissive.push(mat);
    const side = new THREE.MeshStandardMaterial({ color: p.bg });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, 0.4), [side, side, side, side, mat, side]);
    sign.position.set(p.x + nx * 0.25, p.y, p.z + nz * 0.25);
    sign.rotation.y = p.yaw;
    sign.castShadow = true; sign.name = 'big_sign';
    group.add(sign);
  }

  console.info(`[detail] balcony walls=${props.balconies.length} shop signs=${props.signs.length}`);
  return { group, emissive };
}
