// 3. 建物の作り分け: 戸建て = 切妻/寄棟屋根、集合住宅 = ベランダ、店舗 = 看板と日よけ
import * as THREE from 'three';
import { Builder, hash, canvasTexture } from './util.js';

const HOUSE_KINDS = new Set(['house', 'detached', 'residential', 'semidetached_house', 'terrace']);
const NOT_APT = new Set(['commercial', 'retail', 'industrial', 'school', 'hospital', 'office', 'public', 'train_station', 'warehouse', 'garage', 'garages', 'shed', 'roof', 'university', 'kindergarten', 'temple', 'shrine', 'church']);

function signedArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}

// 最小外接長方形 (辺の向きを試す)
function obb(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.5) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const [x, z] of ring) {
      const s = x * ux + z * uz, t = -x * uz + z * ux;
      s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
    const area = (s1 - s0) * (t1 - t0);
    if (!best || area < best.area) best = { area, ux, uz, s0, s1, t0, t1 };
  }
  if (!best) return null;
  // 長辺方向を u (棟の向き) にそろえる
  let { ux, uz, s0, s1, t0, t1 } = best;
  if (t1 - t0 > s1 - s0) { [ux, uz] = [-uz, ux]; [s0, s1, t0, t1] = [t0, t1, -s1, -s0]; }
  const sc = (s0 + s1) / 2, tc = (t0 + t1) / 2;
  return { area: best.area, ux, uz, cx: sc * ux - tc * uz, cz: sc * uz + tc * ux, len: s1 - s0, wid: t1 - t0 };
}

export function buildShapes({ city, world, cx, cz, R }) {
  const group = new THREE.Group();
  group.name = 'detail_shapes';
  const emissive = [];
  const inR = (x, z) => (x - cx) ** 2 + (z - cz) ** 2 <= R * R;
  const cent = (r) => [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];

  const roofB = [new Builder(), new Builder(), new Builder()];
  const gableB = new Builder();
  const slabB = new Builder(), railB = new Builder(), darkRailB = new Builder();
  let houses = 0, apts = 0;

  for (const b of city.buildings) {
    if (b.minH) continue;
    const [bx, bz] = cent(b.outer);
    if (!inR(bx, bz)) continue;
    const area = Math.abs(signedArea(b.outer));
    const rnd = hash('shape' + b.id);
    const isHouse = HOUSE_KINDS.has(b.kind) || (!b.kind && b.h < 9.5 && area < 180);

    if (false && isHouse && area < 260) { // 屋根は city.js (自動分類の roof) で生成するようになったため無効
      const o = obb(b.outer);
      if (!o || area / o.area < 0.72 || o.wid < 3) continue;
      const E = 0.45, y0 = b.h + 0.02;
      const L = o.len / 2 + E, W = o.wid / 2 + E, rise = Math.min(3.2, (o.wid / 2) * 0.55);
      const hip = rnd() < 0.4 ? Math.min(W, L * 0.6) : 0; // 寄棟なら棟を短く
      const P = (s, t, y) => [o.cx + o.ux * s - o.uz * t, y, o.cz + o.uz * s + o.ux * t];
      const rb = roofB[Math.floor(rnd() * roofB.length)];
      const r0 = P(-L + hip, 0, y0 + rise), r1 = P(L - hip, 0, y0 + rise);
      const slope = Math.hypot(W, rise);
      const uv = (s, d) => [s / 2, d / 2];
      for (const side of [-1, 1]) {
        const e0 = P(-L, side * W, y0), e1 = P(L, side * W, y0);
        rb.quad(e0, e1, r1, r0, null, [uv(0, 0), uv(2 * L, 0), uv(2 * L - hip, slope), uv(hip, slope)]);
      }
      for (const end of [-1, 1]) {
        const a = P(end * L, -W, y0), c = P(end * L, W, y0), top = end < 0 ? r0 : r1;
        if (hip > 0) rb.tri(a, c, top, null, uv(0, 0), uv(2 * W, 0), uv(W, slope));
        else gableB.tri(a, c, top, null);
      }
      // 屋根の裏側 (下から見たとき用)
      const u0 = P(-L, -W, y0 - 0.01), u1 = P(L, -W, y0 - 0.01), u2 = P(L, W, y0 - 0.01), u3 = P(-L, W, y0 - 0.01);
      gableB.quad(u0, u1, u2, u3, [0, -1, 0]);
      houses++;
      continue;
    }

    // 集合住宅: 南寄りの長い壁にベランダ
    const isApt = b.style ? b.style === 'apartment' : (!isHouse && !b.name && !NOT_APT.has(b.kind) && b.h >= 7 && b.h <= 45 && area < 1500);
    if (isApt) {
      const ring = b.outer, s = signedArea(ring) > 0 ? 1 : -1;
      const floors = b.floors || Math.floor(b.h / 3.0);
      const fh = b.h / floors;
      if (floors < 2) continue;
      let made = false;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length];
        const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
        if (len < 7) continue;
        const nx = dz / len * s, nz = -dx / len * s; // 外向き法線
        if (b.balcony !== 'all' && nz < 0.55) continue; // 南向き (+Z) の面だけ (balcony=all なら全ての長い面)
        const RB = b.railing ? darkRailB : railB;
        const ux = dx / len, uz = dz / len, inset = 0.4, D = 1.1;
        const Q = (t, d, y) => [a[0] + ux * t + nx * d, y, a[1] + uz * t + nz * d];
        for (let k = 1; k < floors; k++) {
          const y = (b.y || 0) + k * fh;
          // 床スラブ
          slabB.quad(Q(inset, 0, y), Q(len - inset, 0, y), Q(len - inset, D, y), Q(inset, D, y), [0, 1, 0]);
          slabB.quad(Q(inset, 0, y - 0.15), Q(len - inset, 0, y - 0.15), Q(len - inset, D, y - 0.15), Q(inset, D, y - 0.15), [0, -1, 0]);
          slabB.quad(Q(inset, D, y - 0.15), Q(len - inset, D, y - 0.15), Q(len - inset, D, y), Q(inset, D, y), [nx, 0, nz]);
          // 手すり壁 (前面 + 両端)
          RB.quad(Q(inset, D, y), Q(len - inset, D, y), Q(len - inset, D, y + 1.1), Q(inset, D, y + 1.1), [nx, 0, nz]);
          for (const t of [inset, len - inset]) RB.quad(Q(t, 0, y), Q(t, D, y), Q(t, D, y + 1.1), Q(t, 0, y + 1.1), [ux, 0, uz]);
        }
        made = true;
      }
      if (made) apts++;
    }
  }

  const tiles = new THREE.TextureLoader().load('assets/detail/grey_roof_tiles_diff.jpg', (t) => { t.needsUpdate = true; });
  tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping; tiles.colorSpace = THREE.SRGBColorSpace; tiles.anisotropy = 8;
  const roofColors = ['#b9bec6', '#c09a82', '#97a8c0'];
  roofB.forEach((rb, i) => {
    const m = new THREE.Mesh(rb.geometry(), new THREE.MeshStandardMaterial({ map: tiles, color: roofColors[i], roughness: 0.8, side: THREE.DoubleSide }));
    m.castShadow = m.receiveShadow = true; m.name = 'pitched_roofs_' + i;
    group.add(m);
  });
  const gable = new THREE.Mesh(gableB.geometry(), new THREE.MeshStandardMaterial({ color: '#e4ded2', roughness: 0.9, side: THREE.DoubleSide }));
  gable.castShadow = gable.receiveShadow = true; gable.name = 'gables';
  const slabs = new THREE.Mesh(slabB.geometry(), new THREE.MeshStandardMaterial({ color: '#d9d6cf', roughness: 0.9 }));
  slabs.castShadow = slabs.receiveShadow = true; slabs.name = 'balcony_slabs';
  const darkRails = new THREE.Mesh(darkRailB.geometry(), new THREE.MeshStandardMaterial({ color: '#3b4148', roughness: 0.4, metalness: 0.5, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  darkRails.castShadow = true; darkRails.name = 'balcony_rails_dark';
  group.add(darkRails);
  const rails = new THREE.Mesh(railB.geometry(), new THREE.MeshStandardMaterial({ color: '#eef0f0', roughness: 0.6, transparent: true, opacity: 0.88, side: THREE.DoubleSide }));
  rails.castShadow = true; rails.name = 'balcony_rails';
  group.add(gable, slabs, rails);

  // ---------- 店の看板と日よけ ----------
  const SHOP = /^(shop:|amenity:(restaurant|cafe|fast_food|bar|pub|pharmacy|bank|clinic|dentist|ice_cream|hospital|public_building))/;
  const STYLE = (cat) => cat.includes('convenience') ? ['#ffffff', '#1d6f3c', '#e8423a']
    : /restaurant|fast_food|pub|bar/.test(cat) ? ['#b3261e', '#ffffff', '#f2c14e']
    : /cafe|ice_cream/.test(cat) ? ['#2f4a3a', '#f4ead5', '#c9a66b']
    : /bank/.test(cat) ? ['#1e3a6e', '#ffffff', '#9fb7e0']
    : /hospital/.test(cat) ? ['#ffffff', '#1f64b5', '#2aa36b']
    : /public_building/.test(cat) ? ['#2b4a3a', '#ffffff', '#c8b27a']
    : /pharmacy|clinic|dentist/.test(cat) ? ['#ffffff', '#1f64b5', '#3fa34d']
    : ['#3b3f46', '#ffffff', '#e0a43a'];
  let signs = 0;
  for (const p of city.pois) {
    if (!SHOP.test(p.cat) || !inR(p.x, p.z) || signs >= 200) continue;
    // POI に最も近い建物の壁
    let best = null;
    for (const b of world.query(p.x - 20, p.z - 20, p.x + 20, p.z + 20)) {
      if (b.minH > 0) continue;
      const c = world.closest(b, p.x, p.z);
      if (c.d < 20 && (!best || c.d < best.d)) best = { b, d: c.d };
    }
    if (!best) continue;
    const ring = best.b.rings[0], s = signedArea(ring) > 0 ? 1 : -1;
    let edge = null;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 3) continue;
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2, d = Math.hypot(mx - p.x, mz - p.z);
      if (!edge || d < edge.d) edge = { a, c, len, d };
    }
    if (!edge) continue;
    const { a, c, len } = edge;
    const ux = (c[0] - a[0]) / len, uz = (c[1] - a[1]) / len, nx = uz * s, nz = -ux * s;
    const w = Math.min(len - 0.6, 7), mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
    const [bg, fg, accent] = STYLE(p.cat);
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
    sign.position.set(mx + nx * 0.12, best.b.base + 3.35, mz + nz * 0.12);
    sign.rotation.y = Math.atan2(nx, nz);
    sign.castShadow = true;
    // 日よけ (ストライプ)
    const awTex = canvasTexture(256, 64, (g, W, H) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f4f1ea' : accent; g.fillRect(i * W / 8, 0, W / 8, H); } });
    awTex.wrapS = THREE.RepeatWrapping; awTex.repeat.set(Math.max(1, Math.round(w / 2.5)), 1);
    const aw = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.2), new THREE.MeshStandardMaterial({ map: awTex, side: THREE.DoubleSide, roughness: 0.8 }));
    aw.position.set(mx + nx * 0.55, best.b.base + 2.6, mz + nz * 0.55);
    aw.rotation.order = 'YXZ';
    aw.rotation.y = Math.atan2(nx, nz);
    aw.rotation.x = -1.05;
    aw.castShadow = true;
    group.add(sign, aw);
    signs++;
  }

  console.info(`[detail] pitched roofs=${houses} apartments=${apts} shop signs=${signs}`);
  return { group, emissive };
}
