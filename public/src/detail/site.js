// 敷地の外構 (data/appearance.json の sites): 中庭の庭園 (芝生・レンガの通路・噴水・円すい形の木) と、道路沿いのフェンス
import * as THREE from 'three';
import { Builder, canvasTexture } from './util.js';
import { buildSiteExtras } from './site_extras.js';
import { H, drape } from '../terrain.js';

function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function pip(x, z, r) {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
const area = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

export function buildSites({ city, world }) {
  const group = new THREE.Group();
  group.name = 'detail_sites';
  const byId = new Map(city.buildings.map(b => [b.id, b]));
  const clearOf = (x, z, r) => {
    for (const b of world.query(x - r, z - r, x + r, z + r)) {
      if (b.minH > 2) continue;
      if (world.contains(b, x, z) || world.closest(b, x, z).d < r) return false;
    }
    return true;
  };

  for (const site of city.sites || []) {
    let gardenInfo = null;
    // ---------- 中庭の庭園 ----------
    const g = site.garden;
    if (g) {
      const blds = site.buildings.map(id => byId.get(id)).filter(b => b && b.style === 'apartment');
      const main = blds.sort((a, b) => area(b.outer) - area(a.outer))[0];
      if (main) {
        const HULL = hull(main.outer);
        const C = 1.5;
        let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
        for (const [x, z] of HULL) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
        const cells = [];
        for (let x = minx + C / 2; x < maxx; x += C)
          for (let z = minz + C / 2; z < maxz; z += C)
            if (pip(x, z, HULL) && clearOf(x, z, 1.2)) cells.push([x, z]);
        if (cells.length > 20) {
          // 主軸 (PCA)
          const cx = cells.reduce((s, c) => s + c[0], 0) / cells.length, cz = cells.reduce((s, c) => s + c[1], 0) / cells.length;
          let sxx = 0, szz = 0, sxz = 0;
          for (const [x, z] of cells) { sxx += (x - cx) ** 2; szz += (z - cz) ** 2; sxz += (x - cx) * (z - cz); }
          const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(ang), uz = Math.sin(ang);
          const lawn = new Builder(), path = new Builder();
          const along = (x, z) => (x - cx) * ux + (z - cz) * uz, across = (x, z) => -(x - cx) * uz + (z - cz) * ux;
          for (const [x, z] of cells) lawn.flatRect(x, z, [1, 0], C, C, 0.07);
          // 通路: 主軸の通路・直交する通路・噴水を囲む円形の広場 (なめらかな形で芝生の上に重ねる)
          const ext = cells.map(([x, z]) => along(x, z)), extA = cells.map(([x, z]) => across(x, z));
          const lo = Math.min(...ext), hi = Math.max(...ext), loA = Math.min(...extA), hiA = Math.max(...extA);
          const P = (t, a) => [cx + ux * t - uz * a, cz + uz * t + ux * a];
          const strip = (t0, t1, w, dirAlong) => {
            const n = Math.max(1, Math.round((t1 - t0) / 1.0));
            for (let i = 0; i < n; i++) {
              const ta = t0 + (t1 - t0) * i / n, tb = t0 + (t1 - t0) * (i + 1) / n, tm = (ta + tb) / 2;
              const [mx, mz] = dirAlong ? P(tm, 0) : P(0, tm);
              if (!clearOf(mx, mz, 0.8)) continue;
              path.flatRect(mx, mz, dirAlong ? [ux, uz] : [-uz, ux], tb - ta + 0.02, w, 0.085,
                [[0, 0], [(tb - ta) / 2, 0], [(tb - ta) / 2, w / 2], [0, w / 2]].map(([u, v]) => [u + tm / 2, v]));
            }
          };
          strip(lo, hi, 3.0, true);
          strip(loA, hiA, 2.4, false);
          const ring = (r0, r1) => {
            const N = 48;
            for (let i = 0; i < N; i++) {
              const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
              const pt = (a, r) => [cx + Math.cos(a) * r, 0.09, cz + Math.sin(a) * r];
              const uv = (a, r) => [Math.cos(a) * r / 2, Math.sin(a) * r / 2];
              path.quad(pt(a0, r0), pt(a1, r0), pt(a1, r1), pt(a0, r1), [0, 1, 0], [uv(a0, r0), uv(a1, r0), uv(a1, r1), uv(a0, r1)]);
            }
          };
          ring(0, 6.5);
          const brick = canvasTexture(128, 128, (c, W) => {
            c.fillStyle = '#d9d0c8'; c.fillRect(0, 0, W, W);
            for (let r = 0; r < 8; r++) for (let k = -1; k < 4; k++) {
              const x = k * 32 + (r % 2) * 16, y = r * 16;
              c.fillStyle = ['#b46a4c', '#a85a3e', '#bd7656', '#9c533a'][(r * 3 + k + 4) % 4];
              c.fillRect(x + 1, y + 1, 30, 14);
            }
          });
          brick.wrapS = brick.wrapT = THREE.RepeatWrapping;
          const lawnM = new THREE.Mesh(drape(lawn.geometry()), new THREE.MeshStandardMaterial({ color: g.lawn || '#86a85e', roughness: 1 }));
          const pathM = new THREE.Mesh(drape(path.geometry()), new THREE.MeshStandardMaterial({ map: brick, roughness: 0.9 }));
          lawnM.receiveShadow = pathM.receiveShadow = true;
          group.add(lawnM, pathM);

          const stone = new THREE.MeshStandardMaterial({ color: '#efeae0', roughness: 0.7 });
          if (g.fountain) {
            const f = new THREE.Group();
            f.position.set(cx, H(cx, cz), cz);
            const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 0.5, 32), stone); basin.position.y = 0.25;
            const water = new THREE.Mesh(new THREE.CircleGeometry(2.35, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#7fb3cf', roughness: 0.1, metalness: 0.3 })); water.position.y = 0.46;
            const col = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 1.6, 16), stone); col.position.y = 1.0;
            const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.3, 0.3, 24), stone); bowl.position.y = 1.85;
            for (const m of [basin, col, bowl]) m.castShadow = m.receiveShadow = true;
            f.add(basin, water, col, bowl);
            group.add(f);
          }
          if (g.cypress) {
            const pos = [];
            for (let t = lo + 4; t < hi - 3; t += 6) {
              if (Math.abs(t) < 9) continue;
              for (const side of [-1, 1]) {
                const x = cx + ux * t - uz * side * 3.2, z = cz + uz * t + ux * side * 3.2;
                if (clearOf(x, z, 1.5)) pos.push([x, z]);
              }
            }
            const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(0.9, 5.5, 10).translate(0, 3.25, 0), new THREE.MeshStandardMaterial({ color: '#3f6b3a', roughness: 0.9, flatShading: true }), Math.max(1, pos.length));
            cone.count = pos.length;
            const M = new THREE.Matrix4();
            pos.forEach(([x, z], i) => cone.setMatrixAt(i, M.makeTranslation(x, H(x, z), z)));
            cone.castShadow = true;
            group.add(cone);
          }
          gardenInfo = { cx, cz, ux, uz, lo, hi, P, main, cells, clearOf };
        }
      }
    }

    buildSiteExtras({ site, group, world, city, gardenInfo, clearOf });

    // ---------- フェンス (敷地境界。建物に接する所は省く) ----------
    if (site.fence) {
      const gt = site.gate;
      const inGateway = (x, z) => {
        if (!gt || !gt.center) return false;
        const dx = x - gt.center[0], dz = z - gt.center[1];
        const along = dx * gt.axis[0] + dz * gt.axis[1], across = -dx * gt.axis[1] + dz * gt.axis[0];
        return Math.abs(across) < gt.passage / 2 + 0.8 && Math.abs(along) < gt.length / 2 + 12;
      };
      const ring = site.outer, posts = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length];
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        for (let t = 0; t <= L; t += 2.4) {
          const x = a[0] + (c[0] - a[0]) * t / L, z = a[1] + (c[1] - a[1]) * t / L;
          if (inGateway(x, z)) continue; // 門の前はフェンスを切る
          if (clearOf(x, z, 1.0)) posts.push({ x, z, dx: (c[0] - a[0]) / L, dz: (c[1] - a[1]) / L, seg: i, t });
        }
      }
      const mat = new THREE.MeshStandardMaterial({ color: site.fence, roughness: 0.5, metalness: 0.6 });
      const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 1.6, 0.06).translate(0, 0.8, 0), mat, Math.max(1, posts.length));
      pm.count = posts.length;
      const bars = [];
      for (let i = 0; i < posts.length - 1; i++) {
        const p = posts[i], q = posts[i + 1];
        if (p.seg === q.seg && Math.abs(q.t - p.t - 2.4) < 0.01) bars.push({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, ang: Math.atan2(p.dx, p.dz) });
      }
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), S = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3();
      posts.forEach((p, i) => pm.setMatrixAt(i, M.makeTranslation(p.x, H(p.x, p.z), p.z)));
      // 縦格子のパネル (上下の横桟 + 細い縦桟を1枚の板で表現)
      const panelTex = canvasTexture(128, 64, (c, W, Hh) => {
        c.clearRect(0, 0, W, Hh); c.fillStyle = '#ffffff';
        c.fillRect(0, 2, W, 4); c.fillRect(0, Hh - 6, W, 4);
        for (let x = 2; x < W; x += 8) c.fillRect(x, 2, 2, Hh - 4);
      });
      const panel = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.4, 1.5).translate(0, 0.8, 0),
        new THREE.MeshStandardMaterial({ color: site.fence, map: panelTex, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.5 }), Math.max(1, bars.length));
      panel.count = bars.length;
      bars.forEach((b, i) => { Q.setFromAxisAngle(Y, b.ang + Math.PI / 2); panel.setMatrixAt(i, M.compose(P.set(b.x, H(b.x, b.z), b.z), Q, S)); });
      pm.castShadow = panel.castShadow = true;
      group.add(pm, panel);
    }
  }
  return { group };
}
