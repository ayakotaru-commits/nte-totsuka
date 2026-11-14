// 敷地の追加要素 (data/appearance.json): 門のアーチ・噴水のある円形広場・エントランス棟の正面・屋上の塔・1階の青い日よけ・庭の花壇/オベリスク/天窓
// 配置は tools/build_props.py が計算した data/props.json の sites[]。
import * as THREE from 'three';
import { canvasTexture } from './util.js';
import { drape } from '../terrain.js';

const stoneMat = () => new THREE.MeshStandardMaterial({ color: '#f1ece2', roughness: 0.7 });

export function buildSiteExtras({ site, group }) {
  const stone = stoneMat();
  const shadow = (m) => { m.castShadow = m.receiveShadow = true; return m; };

  // ---------- 門: 通路の両面にアーチ (開口の形をくり抜いた壁 + 白い縁取り + 要石) ----------
  const gt = site.gate;
  if (gt) {
    const w = gt.width, ch = gt.clear_h, r = w / 2;
    const wallColor = gt.color;
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
    for (const fc of gt.faces) {
      const face = new THREE.Group();
      face.position.set(fc.x, fc.y, fc.z);
      face.rotation.y = fc.yaw;
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
    const disc = new THREE.Mesh(drape(new THREE.CircleGeometry(pz.r, 48).rotateX(-Math.PI / 2).translate(pz.x, 0.1, pz.z), 1.0), new THREE.MeshStandardMaterial({ map: tile, roughness: 0.6 }));
    disc.receiveShadow = true;
    const f = new THREE.Group();
    f.position.set(pz.x, pz.y, pz.z);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 0.45, 32), stone); basin.position.y = 0.3;
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.1, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#7fb3cf', roughness: 0.1, metalness: 0.3 })); water.position.y = 0.5;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.9, 12), stone); col.position.y = 0.9;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.15, 0.18, 20), stone); bowl.position.y = 1.4;
    f.add(shadow(basin), water, shadow(col), shadow(bowl));
    group.add(disc, f);
  }

  // ---------- エントランス棟の正面 (アーチ窓・赤い扉・上のバルコニー手すり) ----------
  const hl = site.hall;
  if (hl) {
    const L = hl.width, H = hl.height, nx = Math.sin(hl.yaw), nz = Math.cos(hl.yaw);
    const draw = (lit) => canvasTexture(512, Math.round(512 * H / L), (g, W, Hh) => {
      g.fillStyle = lit ? '#000' : hl.color; g.fillRect(0, 0, W, Hh);
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
    plane.position.set(hl.x + nx * 0.04, hl.y + H / 2, hl.z + nz * 0.04);
    plane.rotation.y = hl.yaw;
    plane.receiveShadow = true;
    group.add(plane);
    group.userData.emissive = (group.userData.emissive || []).concat(m);
    // 庇 (入口の上の小さな屋根)
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.18, 1.6), stone);
    canopy.position.set(hl.x + nx * 0.8, hl.y + 3.9, hl.z + nz * 0.8);
    canopy.rotation.y = hl.yaw;
    group.add(shadow(canopy));
  }

  // ---------- 屋上の塔 (八角形の胴 + グレーのドーム + 尖塔) ----------
  for (const t of site.turrets || []) {
    const tw = new THREE.Group();
    tw.position.set(t.x, t.y, t.z);
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
  if (site.awnings) {
    const tex = canvasTexture(128, 64, (g, W, Hh) => { g.fillStyle = site.awnings.color; g.fillRect(0, 0, W, Hh); g.fillStyle = '#f4f1ea'; g.fillRect(0, Hh - 8, W, 4); });
    const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.7 });
    for (const it of site.awnings.items) {
      const aw = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.0), mat);
      aw.position.set(it.x, it.y, it.z);
      aw.rotation.order = 'YXZ';
      aw.rotation.y = it.yaw;
      aw.rotation.x = -1.0;
      aw.castShadow = true;
      group.add(aw);
    }
  }

  // ---------- 庭: 白い縁の花壇・オベリスク・丸い天窓 ----------
  if (site.beds) {
    const border = stone, shrub = new THREE.MeshStandardMaterial({ color: '#4f7a3f', roughness: 0.95 });
    for (const it of site.beds) {
      const bed = new THREE.Group();
      bed.position.set(it.x, it.y, it.z);
      bed.rotation.y = it.yaw;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.4, 4.2).translate(0, 0.2, 0), border);
      const fill = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.75, 3.8).translate(0, 0.38, 0), shrub);
      bed.add(shadow(frame), shadow(fill));
      group.add(bed);
    }
  }
  if (site.obelisk) {
    const { x: ox, y: oy, z: oz } = site.obelisk;
    const ob = new THREE.Group();
    ob.position.set(ox, oy, oz);
    ob.add(shadow(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.4).translate(0, 0.4, 0), stone)));
    ob.add(shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, 4.2, 4).rotateY(Math.PI / 4).translate(0, 2.9, 0), stone)));
    ob.add(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 4).rotateY(Math.PI / 4).translate(0, 5.3, 0), stone));
    group.add(ob);
  }
  if (site.skylight) {
    const sky = new THREE.Group();
    sky.position.set(site.skylight.x, site.skylight.y, site.skylight.z);
    sky.add(shadow(new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.9, 40).translate(0, 0.45, 0), stone)));
    sky.add(shadow(new THREE.Mesh(new THREE.SphereGeometry(1.4, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.9, 0),
      new THREE.MeshStandardMaterial({ color: '#cfe0ea', roughness: 0.1, metalness: 0.4, transparent: true, opacity: 0.85 }))));
    group.add(sky);
  }
}
