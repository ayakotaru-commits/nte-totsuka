// 千葉ドリームランド 段階 7: 通りの小物 (屋台のワゴン・案内標識・ごみ箱)。位置は tools/park_areas.py の furn (data/park_areas.json のテーマの detail.furn)。
// 1 つの BufferGeometry にまとめる (頂点色。エリアごとに色がちがうので InstancedMesh にしない。数は 50 個ほど)。当たり判定は col に足す。
import * as THREE from 'three';

export function buildFurn({ gen, ground, group, col }) {
  const pos = [], nor = [], cl = [];
  const C = (s) => new THREE.Color(s);
  // 向き yaw・位置 (ox, oy, oz) の局所座標 → 世界。局所 +Z = 前、+X = 右 (parkareas.js の P と同じ)
  const mk = (ox, oy, oz, yaw) => { const ux = Math.sin(yaw), uz = Math.cos(yaw), rx = uz, rz = -ux; return { p: (lx, y, lz) => [ox + rx * lx + ux * lz, oy + y, oz + rz * lx + uz * lz], n: (lx, lz) => [rx * lx + ux * lz, 0, rz * lx + uz * lz] }; };
  const tri = (a, b, c, n, color) => {   // 向きは n (外向き) に合わせる
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0) { const t = b; b = c; c = t; }
    for (const v of [a, b, c]) { pos.push(v[0], v[1], v[2]); nor.push(n[0], n[1], n[2]); cl.push(color.r, color.g, color.b); }
  };
  const quad = (a, b, c, d, n, color) => { tri(a, b, c, n, color); tri(a, c, d, n, color); };
  // 局所の箱 (中心 cx, cz・底 y0・高さ h・幅 w (x)・奥行き d (z))
  const box = (F, cx, cz, y0, h, w, d, color) => {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    quad(F.p(x0, y0, z1), F.p(x1, y0, z1), F.p(x1, y1, z1), F.p(x0, y1, z1), F.n(0, 1), color);
    quad(F.p(x1, y0, z0), F.p(x0, y0, z0), F.p(x0, y1, z0), F.p(x1, y1, z0), F.n(0, -1), color);
    quad(F.p(x1, y0, z1), F.p(x1, y0, z0), F.p(x1, y1, z0), F.p(x1, y1, z1), F.n(1, 0), color);
    quad(F.p(x0, y0, z0), F.p(x0, y0, z1), F.p(x0, y1, z1), F.p(x0, y1, z0), F.n(-1, 0), color);
    quad(F.p(x0, y1, z1), F.p(x1, y1, z1), F.p(x1, y1, z0), F.p(x0, y1, z0), [0, 1, 0], color);
  };
  // 縦の円柱 (8 角形。r0 = 下、r1 = 上)
  const cyl = (F, cx, cz, y0, h, r0, r1, color, N = 8) => {
    for (let i = 0; i < N; i++) {
      const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2, am = (a0 + a1) / 2;
      quad(F.p(cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0), F.p(cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0), F.p(cx + Math.cos(a1) * r1, y0 + h, cz + Math.sin(a1) * r1), F.p(cx + Math.cos(a0) * r1, y0 + h, cz + Math.sin(a0) * r1), F.n(Math.cos(am), Math.sin(am)), color);
      tri(F.p(cx, y0 + h, cz), F.p(cx + Math.cos(a0) * r1, y0 + h, cz + Math.sin(a0) * r1), F.p(cx + Math.cos(a1) * r1, y0 + h, cz + Math.sin(a1) * r1), [0, 1, 0], color);
    }
  };
  // 車輪 (x 軸まわりの円板。厚み t)
  const wheel = (F, cx, cy, cz, r, t, color, N = 8) => {
    for (let i = 0; i < N; i++) {
      const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
      for (const sd of [-1, 1]) tri(F.p(cx + sd * t / 2, cy, cz), F.p(cx + sd * t / 2, cy + Math.cos(a0) * r, cz + Math.sin(a0) * r), F.p(cx + sd * t / 2, cy + Math.cos(a1) * r, cz + Math.sin(a1) * r), F.n(sd, 0), color);
      const am = (a0 + a1) / 2, hn = F.n(0, Math.sin(am));   // 外周の法線 = 円の外向き (y 成分は cos、前後は sin)
      quad(F.p(cx - t / 2, cy + Math.cos(a0) * r, cz + Math.sin(a0) * r), F.p(cx + t / 2, cy + Math.cos(a0) * r, cz + Math.sin(a0) * r), F.p(cx + t / 2, cy + Math.cos(a1) * r, cz + Math.sin(a1) * r), F.p(cx - t / 2, cy + Math.cos(a1) * r, cz + Math.sin(a1) * r), [hn[0], Math.cos(am), hn[2]], color);
    }
  };
  const goods = ['#ff9ec8', '#8fd8ff', '#ffe08a', '#b9a4ff', '#9fe8c8', '#ffb98a'];
  const cnt = { wagon: 0, signpost: 0, bin: 0 };
  (gen.furn || []).forEach(([kind, x, z, yaw, ai], idx) => {
    const y = ground(x, z), F = mk(x, y, z, yaw), pal = (gen.areas[ai] && gen.areas[ai].bunting || ['#ff7fb5', '#ffffff']).map(C), kc = gen.areas[ai] ? gen.areas[ai].kind : '';
    cnt[kind]++;
    if (kind === 'wagon') {   // 2 輪の屋台 (台・商品・柱・しまの日よけ・車輪・取っ手)
      const wood = C(kc === 'night' ? '#4a3a55' : '#b07d4f'), dk = C('#4b4561');
      box(F, 0, 0, 0.35, 0.6, 1.3, 1.9, wood); box(F, 0, 0, 0.95, 0.06, 1.38, 1.98, C('#e8dcc8'));
      for (let i = 0; i < 6; i++) box(F, -0.45 + (i % 3) * 0.45, -0.5 + Math.floor(i / 3) * 0.7, 1.01, 0.22 + (i % 2) * 0.12, 0.3, 0.3, C(goods[(i + idx) % goods.length]));
      for (const sx of [-0.62, 0.62]) for (const sz of [-0.9, 0.9]) box(F, sx, sz, 0.95, 1.4, 0.06, 0.06, dk);
      const ns = 6;
      for (let i = 0; i < ns; i++) {
        const xa = -0.85 + 1.7 * i / ns, xb = -0.85 + 1.7 * (i + 1) / ns, c = pal[i % 2 ? 1 : 0] || C('#ffffff'), c2 = i % 2 ? C('#ffffff') : pal[0];
        quad(F.p(xa, 2.35, -1.0), F.p(xb, 2.35, -1.0), F.p(xb, 2.15, 1.05), F.p(xa, 2.15, 1.05), F.n(0, 1), c2);
        quad(F.p(xa, 2.15, 1.05), F.p(xb, 2.15, 1.05), F.p(xb, 1.97, 1.05), F.p(xa, 1.97, 1.05), F.n(0, 1), c2);
        tri(F.p(xa, 1.97, 1.05), F.p(xb, 1.97, 1.05), F.p((xa + xb) / 2, 1.83, 1.05), F.n(0, 1), c2);
        void c;
      }
      for (const sx of [-0.78, 0.78]) wheel(F, sx, 0.42, -0.1, 0.42, 0.1, dk);
      for (const sx of [-0.45, 0.45]) box(F, sx, 1.45, 0.55, 0.06, 0.06, 1.0, dk);
      if (col) col.box.push([x, z, yaw, 0.75, 1.1, y - 0.5, y + 1.3]);
    } else if (kind === 'signpost') {   // 柱 + 向きの板 2 枚 (先がとがる)
      box(F, 0, 0, 0, 3.1, 0.14, 0.14, C('#6b5238')); cyl(F, 0, 0, 3.1, 0.12, 0.12, 0.05, C('#4b4561'));
      for (const [i, sd] of [[0, 1], [1, -1]]) {
        const yy = 2.25 - i * 0.62, c = pal[(i + idx) % pal.length], w = 1.3, h = 0.4;
        const pts = sd > 0 ? [[0.08, yy], [w, yy], [w + 0.3, yy + h / 2], [w, yy + h], [0.08, yy + h]] : [[-0.08, yy], [-w, yy], [-w - 0.3, yy + h / 2], [-w, yy + h], [-0.08, yy + h]];
        for (const zz of [0.08, -0.08]) for (let k = 1; k < pts.length - 1; k++) tri(F.p(pts[0][0], pts[0][1], zz), F.p(pts[k][0], pts[k][1], zz), F.p(pts[k + 1][0], pts[k + 1][1], zz), F.n(0, zz > 0 ? 1 : -1), c);
        for (let k = 0; k < pts.length; k++) { const a = pts[k], b = pts[(k + 1) % pts.length]; const sn = F.n(b[1] - a[1], 0); quad(F.p(a[0], a[1], 0.08), F.p(b[0], b[1], 0.08), F.p(b[0], b[1], -0.08), F.p(a[0], a[1], -0.08), [sn[0], a[0] - b[0], sn[2]], c.clone().multiplyScalar(0.8)); }
        box(F, sd * (w - 0.1), 0.085, yy + 0.18, 0.04, 0.5, 0.01, C('#ffffff'));
      }
      if (col) col.circle.push([x, z, 0.2, y - 0.5, y + 3.2]);
    } else {   // ごみ箱 (しまの帯・ふた)
      cyl(F, 0, 0, 0, 0.8, 0.3, 0.34, C(kc === 'night' ? '#3b3350' : '#6f7d8c')); cyl(F, 0, 0, 0.42, 0.14, 0.325, 0.33, pal[idx % pal.length]); cyl(F, 0, 0, 0.8, 0.07, 0.37, 0.37, C('#4b4561'));
      if (col) col.circle.push([x, z, 0.34, y - 0.5, y + 0.9]);
    }
  });
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
  m.name = 'park_furn'; m.castShadow = true; m.receiveShadow = true; group.add(m);
  return { mesh: m, counts: cnt, tris: pos.length / 9 };
}
