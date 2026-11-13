// 敷地の追加要素 (data/appearance.json): 門のアーチ・噴水のある円形広場・エントランス棟の正面・屋上の塔・1階の青い日よけ・庭の花壇/オベリスク/天窓
import * as THREE from 'three';
import { canvasTexture } from './util.js';
import { H as TH, drape } from '../terrain.js';

const stoneMat = () => new THREE.MeshStandardMaterial({ color: '#f1ece2', roughness: 0.7 });

export function buildSiteExtras({ site, group, world, city, gardenInfo }) {
  const stone = stoneMat();
  const shadow = (m) => { m.castShadow = m.receiveShadow = true; return m; };

  // ---------- 門: 通路の両面にアーチ (開口の形をくり抜いた壁 + 白い縁取り + 要石) ----------
  const gt = site.gate;
  if (gt && gt.center) {
    const [ux, uz] = gt.axis, w = gt.passage, ch = gt.clear_h, r = w / 2;
    const wallColor = gt.color || '#dcc6a0';
    const gpart = city.buildings.find(b => site.buildings.includes(b.id) && b.style === 'gate');
    const gbase = gpart ? gpart.y || 0 : TH(gt.center[0], gt.center[1]);
    const tex = canvasTexture(256, 280, (g, W, H) => {
      g.fillStyle = wallColor; g.fillRect(0, 0, W, H);
      // 透明にする開口 (下は長方形・上は半円)
      g.globalCompositeOperation = 'destination-out';
      const sx = W / w, sy = H / ch, cy = (ch - r) * sy;
      g.beginPath();
      g.moveTo(0, H); g.lineTo(0, H - cy); g.ellipse(W / 2, H - cy, W / 2, r * sy, 0, Math.PI, 0); g.lineTo(W, H); g.closePath();
      g.fill();
      g.globalCompositeOperation = 'source-over';
      void sx;
    });
    const spandrel = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
    for (const side of [-1, 1]) {
      const fx = gt.center[0] + ux * side * (gt.length / 2 + 0.03), fz = gt.center[1] + uz * side * (gt.length / 2 + 0.03);
      const face = new THREE.Group();
      face.position.set(fx, gbase, fz);
      face.rotation.y = Math.atan2(ux, uz);
      const sp = new THREE.Mesh(new THREE.PlaneGeometry(w, ch).translate(0, ch / 2, 0), spandrel);
      const arch = new THREE.Mesh(new THREE.TorusGeometry(r, 0.22, 8, 32, Math.PI), stone);
      arch.position.y = ch - r;
      const key = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.35), stone);
      key.position.y = ch - 0.1;
      for (const s of [-1, 1]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.55, ch - r, 0.3).translate(0, (ch - r) / 2, 0), stone);
        col.position.x = s * (r + 0.05);
        face.add(shadow(col));
      }
      face.add(shadow(sp), shadow(arch), shadow(key));
      group.add(face);
    }
  }

  // ---------- 噴水のある円形広場 (タイル張り) ----------
  const pz = site.plaza;
  if (pz) {
    const tile = canvasTexture(256, 256, (g, W) => {
      g.fillStyle = '#efe6d6'; g.fillRect(0, 0, W, W);
      g.strokeStyle = '#cbbfa9'; g.lineWidth = 2;
      for (let k = 1; k < 9; k++) { g.beginPath(); g.arc(W / 2, W / 2, k * W / 18, 0, Math.PI * 2); g.stroke(); }
      for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; g.beginPath(); g.moveTo(W / 2 + Math.cos(a) * W / 18, W / 2 + Math.sin(a) * W / 18); g.lineTo(W / 2 + Math.cos(a) * W / 2, W / 2 + Math.sin(a) * W / 2); g.stroke(); }
    });
    const disc = new THREE.Mesh(drape(new THREE.CircleGeometry(pz.r, 48).rotateX(-Math.PI / 2).translate(pz.at[0], 0.1, pz.at[1]), 1.0), new THREE.MeshStandardMaterial({ map: tile, roughness: 0.6 }));
    disc.receiveShadow = true;
    const f = new THREE.Group();
    f.position.set(pz.at[0], TH(pz.at[0], pz.at[1]), pz.at[1]);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 0.45, 32), stone); basin.position.y = 0.3;
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.1, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#7fb3cf', roughness: 0.1, metalness: 0.3 })); water.position.y = 0.5;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.9, 12), stone); col.position.y = 0.9;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.15, 0.18, 20), stone); bowl.position.y = 1.4;
    f.add(shadow(basin), water, shadow(col), shadow(bowl));
    group.add(disc, f);
  }

  // ---------- エントランス棟の正面 (アーチ窓・赤い扉・上のバルコニー手すり) ----------
  const hl = site.hall;
  const hallB = hl && city.buildings.find(b => b.style === 'hall' && site.buildings.includes(b.id));
  if (hallB) {
    const ring = hallB.outer, n = ring.length;
    let s = 0;
    for (let i = 0; i < n; i++) { const a = ring[i], c = ring[(i + 1) % n]; s += a[0] * c[1] - c[0] * a[1]; }
    const sg = s > 0 ? 1 : -1;
    let best = null;
    for (let i = 0; i < n; i++) {
      const a = ring[i], c = ring[(i + 1) % n], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const nx = (c[1] - a[1]) / L * sg, nz = -(c[0] - a[0]) / L * sg;
      const d = nx * hl.front[0] + nz * hl.front[1];
      if (!best || d > best.d) best = { a, c, L, nx, nz, d };
    }
    const { a, c, L, nx, nz } = best;
    const H = hallB.h;
    const draw = (lit) => canvasTexture(512, Math.round(512 * H / L), (g, W, Hh) => {
      g.fillStyle = lit ? '#000' : (hallB.color || '#e3d2b0'); g.fillRect(0, 0, W, Hh);
      const px = W / L, floorY = Hh * (1 - 4.2 / H);
      if (!lit) {
        g.fillStyle = '#f4efe6'; g.fillRect(0, floorY - 10, W, 12);          // 2階の床の帯
        g.fillStyle = '#3b4148';                                          // 2階テラスの手すり
        for (let x = 6; x < W; x += 9) g.fillRect(x, floorY - 46, 2, 36);
        g.fillRect(0, floorY - 48, W, 4);
      }
      // 1階: アーチ窓 x2 + 中央のアーチの扉
      const unit = [L * 0.2, L * 0.5, L * 0.8];
      unit.forEach((ux0, k) => {
        const cx = ux0 * px, ww = (k === 1 ? 2.4 : 2.0) * px, top = Hh - 3.6 * Hh / H, bottom = Hh - (k === 1 ? 0 : 0.6 * Hh / H);
        g.beginPath();
        g.moveTo(cx - ww / 2, bottom); g.lineTo(cx - ww / 2, top + ww / 2);
        g.arc(cx, top + ww / 2, ww / 2, Math.PI, 0); g.lineTo(cx + ww / 2, bottom); g.closePath();
        if (lit) { g.fillStyle = '#ffd9a0'; g.fill(); return; }
        g.fillStyle = '#f7f3ec'; g.lineWidth = 8; g.strokeStyle = '#f7f3ec'; g.stroke();
        g.fillStyle = k === 1 ? '#6b2620' : '#5f7282'; g.fill();
        if (k === 1) { g.fillStyle = '#c9a75a'; g.fillRect(cx - 3, top + ww * 0.9, 6, 30); g.fillRect(cx - 1, top + ww / 2, 2, bottom - top - ww / 2); }
        else { g.strokeStyle = '#e8e2d6'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, top); g.lineTo(cx, bottom); g.stroke(); }
      });
      // 2階: 小さな窓
      if (!lit) for (const ux0 of unit) { g.fillStyle = '#6d8090'; g.fillRect(ux0 * px - 0.6 * px, Hh * (1 - 6.3 / H), 1.2 * px, 1.4 * Hh / H); }
    });
    const tex = draw(false), lit = draw(true);
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: lit, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.8 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(L, H), m);
    plane.position.set((a[0] + c[0]) / 2 + nx * 0.04, (hallB.y || 0) + H / 2, (a[1] + c[1]) / 2 + nz * 0.04);
    plane.rotation.y = Math.atan2(nx, nz);
    plane.receiveShadow = true;
    group.add(plane);
    group.userData.emissive = (group.userData.emissive || []).concat(m);
    // 庇 (入口の上の小さな屋根)
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.18, 1.6), stone);
    canopy.position.set((a[0] + c[0]) / 2 + nx * 0.8, (hallB.y || 0) + 3.9, (a[1] + c[1]) / 2 + nz * 0.8);
    canopy.rotation.y = Math.atan2(nx, nz);
    group.add(shadow(canopy));
  }

  // ---------- 屋上の塔 (八角形の胴 + グレーのドーム + 尖塔) ----------
  for (const t of site.turrets || []) {
    const [x, z] = t.at;
    const host = world.query(x, z, x, z).find(b => world.contains(b, x, z));
    if (!host) continue;
    const bd = city.buildings.find(b => b.id === host.id);
    const base = host.topY + (bd && bd.mansard ? 1.5 : 0);
    const tw = new THREE.Group();
    tw.position.set(x, base, z);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.4, 8).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ color: '#dcc6a0', roughness: 0.85 }));
    const winTex = canvasTexture(256, 64, (g, W, Hh) => {
      g.fillStyle = '#dcc6a0'; g.fillRect(0, 0, W, Hh);
      for (let k = 0; k < 8; k++) { const cx = (k + 0.5) * W / 8; g.fillStyle = '#4e5d6b'; g.beginPath(); g.moveTo(cx - 6, Hh - 10); g.lineTo(cx - 6, 24); g.arc(cx, 24, 6, Math.PI, 0); g.lineTo(cx + 6, Hh - 10); g.fill(); }
    });
    drum.material.map = winTex;
    const cornice = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.45, 0.3, 16).translate(0, 2.5, 0), stone);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.45, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 2.6, 0), new THREE.MeshStandardMaterial({ color: '#79838e', roughness: 0.5, metalness: 0.3 }));
    dome.scale.y = 1.25;
    const finial = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.0, 8).translate(0, 4.9, 0), stone);
    tw.add(shadow(drum), shadow(cornice), shadow(dome), finial);
    group.add(tw);
  }

  // ---------- 1階の青い日よけ (中庭に面した壁) ----------
  if (site.awnings && gardenInfo) {
    const { cx, cz, main } = gardenInfo;
    const every = site.awnings.every || 7.2;
    const tex = canvasTexture(128, 64, (g, W, Hh) => { g.fillStyle = site.awnings.color; g.fillRect(0, 0, W, Hh); g.fillStyle = '#f4f1ea'; g.fillRect(0, Hh - 8, W, 4); });
    const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.7 });
    const ring = main.outer, n = ring.length;
    let s = 0;
    for (let i = 0; i < n; i++) { const a = ring[i], c = ring[(i + 1) % n]; s += a[0] * c[1] - c[0] * a[1]; }
    const sg = s > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const a = ring[i], c = ring[(i + 1) % n], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (L < 20) continue;
      const ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L, nx = uz * sg, nz = -ux * sg;
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      const tc = Math.hypot(cx - mx, cz - mz);
      if ((cx - mx) * nx + (cz - mz) * nz < 0.6 * tc) continue; // 中庭側を向いた壁だけ
      for (let t = every / 2 + 1.8; t < L - 2; t += every) {
        const aw = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.0), mat);
        aw.position.set(a[0] + ux * t + nx * 0.45, (main.y || 0) + 2.55, a[1] + uz * t + nz * 0.45);
        aw.rotation.order = 'YXZ';
        aw.rotation.y = Math.atan2(nx, nz);
        aw.rotation.x = -1.0;
        aw.castShadow = true;
        group.add(aw);
      }
    }
  }

  // ---------- 庭: 白い縁の花壇・オベリスク・丸い天窓 ----------
  if (gardenInfo) {
    const { lo, hi, P, clearOf } = gardenInfo;
    const border = stone, shrub = new THREE.MeshStandardMaterial({ color: '#4f7a3f', roughness: 0.95 });
    for (let t = lo + 6; t < hi - 6; t += 12) {
      if (Math.abs(t) < 10) continue;
      for (const side of [-1, 1]) {
        const [x, z] = P(t, side * 6.5);
        if (!clearOf(x, z, 2.6)) continue;
        const bed = new THREE.Group();
        bed.position.set(x, TH(x, z), z);
        bed.rotation.y = Math.atan2(gardenInfo.ux, gardenInfo.uz);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.4, 4.2).translate(0, 0.2, 0), border);
        const fill = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.75, 3.8).translate(0, 0.38, 0), shrub);
        bed.add(shadow(frame), shadow(fill));
        group.add(bed);
      }
    }
    // オベリスク (エントランス側の端) と丸い天窓 (反対側の端)
    const hallC = hallB ? hallB.outer.reduce((q, p) => [q[0] + p[0] / hallB.outer.length, q[1] + p[1] / hallB.outer.length], [0, 0]) : null;
    const ends = [P(lo + 7, 0), P(hi - 7, 0)];
    const near = hallC ? (Math.hypot(ends[0][0] - hallC[0], ends[0][1] - hallC[1]) < Math.hypot(ends[1][0] - hallC[0], ends[1][1] - hallC[1]) ? 0 : 1) : 0;
    const [ox, oz] = ends[near];
    const ob = new THREE.Group();
    ob.position.set(ox, TH(ox, oz), oz);
    ob.add(shadow(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.4).translate(0, 0.4, 0), stone)));
    ob.add(shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, 4.2, 4).rotateY(Math.PI / 4).translate(0, 2.9, 0), stone)));
    ob.add(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 4).rotateY(Math.PI / 4).translate(0, 5.3, 0), stone));
    group.add(ob);
    const [sx, sz] = ends[1 - near];
    const sky = new THREE.Group();
    sky.position.set(sx, TH(sx, sz), sz);
    sky.add(shadow(new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.9, 40).translate(0, 0.45, 0), stone)));
    sky.add(shadow(new THREE.Mesh(new THREE.SphereGeometry(1.4, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.9, 0),
      new THREE.MeshStandardMaterial({ color: '#cfe0ea', roughness: 0.1, metalness: 0.4, transparent: true, opacity: 0.85 }))));
    group.add(sky);
  }
}
