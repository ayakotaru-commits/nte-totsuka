// 敷地の外構 (data/appearance.json の sites): 中庭の庭園 (芝生・レンガの通路・噴水・円すい形の木) と、道路沿いのフェンス
// 配置は tools/build_props.py が計算した data/props.json の sites。ここでは形を作って置くだけ。
import * as THREE from 'three';
import { Builder, canvasTexture } from './util.js';
import { buildSiteExtras } from './site_extras.js';
import { drape } from '../terrain.js';

export function buildSites(props) {
  const group = new THREE.Group();
  group.name = 'detail_sites';
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), S = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3();

  for (const site of props.sites || []) {
    // ---------- 中庭の庭園 ----------
    const g = site.garden;
    if (g) {
      const C = g.cell;
      const lawn = new Builder(), path = new Builder();
      for (const [x, z] of g.cells) lawn.flatRect(x, z, [1, 0], C, C, 0.07);
      // 通路 [x, z, dx, dz, 長さ, 幅, 模様のずれ]
      for (const [x, z, dx, dz, len, w, u0] of g.paths) {
        path.flatRect(x, z, [dx, dz], len, w, 0.085, [[0, 0], [len / 2, 0], [len / 2, w / 2], [0, w / 2]].map(([u, v]) => [u + u0, v]));
      }
      // 円形の広場 (rings があれば、配置を指定した中庭: 石張り。無ければ噴水を囲むレンガの円 1 つ)
      const stoneB = new Builder();
      for (const rg of g.rings || [g.ring]) {
        const { x: rx, z: rz, r0, r1 } = rg, N = 48, B = rg.stone ? stoneB : path;
        for (let i = 0; i < N; i++) {
          const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
          const pt = (a, r) => [rx + Math.cos(a) * r, rg.stone ? 0.1 : 0.09, rz + Math.sin(a) * r];
          const uv = (a, r) => rg.stone ? [0.5 + Math.cos(a) * r / r1 / 2, 0.5 + Math.sin(a) * r / r1 / 2] : [Math.cos(a) * r / 2, Math.sin(a) * r / 2];
          B.quad(pt(a0, r0), pt(a1, r0), pt(a1, r1), pt(a0, r1), [0, 1, 0], [uv(a0, r0), uv(a1, r0), uv(a1, r1), uv(a0, r1)]);
        }
      }
      if (g.rings) {
        // 白い石の同心円の敷石 (中庭の写真の白い円形の広場)
        const ringTex = canvasTexture(256, 256, (c, W) => {
          c.fillStyle = '#ebe5d8'; c.fillRect(0, 0, W, W);
          c.strokeStyle = '#c9bfab'; c.lineWidth = 2;
          for (let k = 1; k < 10; k++) { c.beginPath(); c.arc(W / 2, W / 2, k * W / 20, 0, Math.PI * 2); c.stroke(); }
          for (let k = 0; k < 32; k++) { const a = k / 32 * Math.PI * 2; c.beginPath(); c.moveTo(W / 2 + Math.cos(a) * W / 10, W / 2 + Math.sin(a) * W / 10); c.lineTo(W / 2 + Math.cos(a) * W / 2, W / 2 + Math.sin(a) * W / 2); c.stroke(); }
          c.strokeStyle = '#b8ab92'; c.lineWidth = 6; c.beginPath(); c.arc(W / 2, W / 2, W / 2 - 3, 0, Math.PI * 2); c.stroke();
        });
        const sm = new THREE.Mesh(drape(stoneB.geometry()), new THREE.MeshStandardMaterial({ map: ringTex, roughness: 0.6 }));
        sm.receiveShadow = true;
        group.add(sm);
      }
      const brick = canvasTexture(128, 128, (c, W) => {
        c.fillStyle = '#d9d0c8'; c.fillRect(0, 0, W, W);
        for (let r = 0; r < 8; r++) for (let k = -1; k < 4; k++) {
          const x = k * 32 + (r % 2) * 16, y = r * 16;
          c.fillStyle = ['#b46a4c', '#a85a3e', '#bd7656', '#9c533a'][(r * 3 + k + 4) % 4];
          c.fillRect(x + 1, y + 1, 30, 14);
        }
      });
      brick.wrapS = brick.wrapT = THREE.RepeatWrapping;
      const lawnM = new THREE.Mesh(drape(lawn.geometry()), new THREE.MeshStandardMaterial({ color: g.lawn, roughness: 1 }));
      const pathM = new THREE.Mesh(drape(path.geometry()), new THREE.MeshStandardMaterial({ map: brick, roughness: 0.9 }));
      lawnM.receiveShadow = pathM.receiveShadow = true;
      group.add(lawnM, pathM);

      const stone = new THREE.MeshStandardMaterial({ color: '#efeae0', roughness: 0.7 });
      for (const fo of g.fountains || (g.fountain ? [g.fountain] : [])) {
        const f = new THREE.Group();
        f.position.set(fo.x, fo.y, fo.z);
        const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 0.5, 32), stone); basin.position.y = 0.25;
        const water = new THREE.Mesh(new THREE.CircleGeometry(2.35, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#7fb3cf', roughness: 0.1, metalness: 0.3 })); water.position.y = 0.46;
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 1.6, 16), stone); col.position.y = 1.0;
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.3, 0.3, 24), stone); bowl.position.y = 1.85;
        for (const m of [basin, col, bowl]) m.castShadow = m.receiveShadow = true;
        f.add(basin, water, col, bowl);
        group.add(f);
      }
      // 白い縁の芝の区画 (縁石 + 一段明るい芝)
      if (g.panels) {
        const curbM = new THREE.MeshStandardMaterial({ color: '#f1ece2', roughness: 0.7 });
        const turfM = new THREE.MeshStandardMaterial({ color: '#7fae5a', roughness: 1 });
        for (const p of g.panels) {
          const pg = new THREE.Group();
          pg.position.set(p.x, p.y, p.z); pg.rotation.y = Math.atan2(p.dz, p.dx) * -1;
          const L = p.len, Wd = p.wid, k = 0.25, hh = 0.3;
          for (const [w, d, x, z] of [[L, k, 0, Wd / 2 - k / 2], [L, k, 0, -Wd / 2 + k / 2], [k, Wd, L / 2 - k / 2, 0], [k, Wd, -L / 2 + k / 2, 0]]) {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d).translate(0, hh / 2, 0), curbM); m.position.set(x, 0, z); m.castShadow = m.receiveShadow = true; pg.add(m);
          }
          const turf = new THREE.Mesh(new THREE.BoxGeometry(L - 2 * k, 0.2, Wd - 2 * k).translate(0, 0.1, 0), turfM); turf.receiveShadow = true; pg.add(turf);
          group.add(pg);
        }
      }
      // 刈り込んだ生け垣
      if (g.hedges && g.hedges.length) {
        const hm = new THREE.MeshStandardMaterial({ color: '#3f6a35', roughness: 1 });
        for (const h of g.hedges) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(h.wid, h.h, h.len).translate(0, h.h / 2, 0), hm);
          m.position.set(h.x, h.y, h.z); m.rotation.y = h.yaw; m.castShadow = m.receiveShadow = true; group.add(m);
        }
      }
      // 丸い植え込み (白い縁 + 低木)
      for (const p of g.planters || []) {
        const curb = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, 0.45, 28).translate(0, 0.22, 0), stone);
        const bush = new THREE.Mesh(new THREE.SphereGeometry(p.r - 0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.4, 0), new THREE.MeshStandardMaterial({ color: '#4f7a3f', roughness: 0.95 }));
        bush.scale.y = 0.6;
        for (const m of [curb, bush]) { m.position.set(p.x, p.y, p.z); m.castShadow = m.receiveShadow = true; group.add(m); }
      }
      if (g.cypress) {
        const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(0.9, 5.5, 10).translate(0, 3.25, 0), new THREE.MeshStandardMaterial({ color: '#3f6b3a', roughness: 0.9, flatShading: true }), Math.max(1, g.cypress.length));
        cone.count = g.cypress.length;
        g.cypress.forEach(([x, z, y], i) => cone.setMatrixAt(i, M.makeTranslation(x, y, z)));
        cone.castShadow = true;
        group.add(cone);
      }
    }

    buildSiteExtras({ site, group });

    // ---------- フェンス (敷地境界) ----------
    const fc = site.fence;
    if (fc) {
      const mat = new THREE.MeshStandardMaterial({ color: fc.color, roughness: 0.5, metalness: 0.6 });
      const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 1.6, 0.06).translate(0, 0.8, 0), mat, Math.max(1, fc.posts.length));
      pm.count = fc.posts.length;
      fc.posts.forEach(([x, z, y], i) => pm.setMatrixAt(i, M.makeTranslation(x, y, z)));
      // 縦格子のパネル (上下の横桟 + 細い縦桟を1枚の板で表現)
      const panelTex = canvasTexture(128, 64, (c, W, Hh) => {
        c.clearRect(0, 0, W, Hh); c.fillStyle = '#ffffff';
        c.fillRect(0, 2, W, 4); c.fillRect(0, Hh - 6, W, 4);
        for (let x = 2; x < W; x += 8) c.fillRect(x, 2, 2, Hh - 4);
      });
      const panel = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.4, 1.5).translate(0, 0.8, 0),
        new THREE.MeshStandardMaterial({ color: fc.color, map: panelTex, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.5 }), Math.max(1, fc.panels.length));
      panel.count = fc.panels.length;
      // パネルの面はフェンスの向き (yaw) に沿う: 板の法線は yaw + 90°
      fc.panels.forEach((b, i) => { Q.setFromAxisAngle(Y, b.yaw + Math.PI / 2); panel.setMatrixAt(i, M.compose(P.set(b.x, b.y, b.z), Q, S)); });
      pm.castShadow = panel.castShadow = true;
      group.add(pm, panel);
    }
  }
  return { group };
}
