// 敷地の追加要素 (data/appearance.json): 門のアーチ・噴水のある円形広場・エントランス棟の正面・屋上の塔・1階の青い日よけ・庭の花壇/オベリスク/天窓
// 配置は tools/build_props.py が計算した data/props.json の sites[]。
import * as THREE from 'three';
import { canvasTexture } from './util.js';
import { drape } from '../terrain.js';
import { buildClockhouse, buildCourtArch, buildCarpark, polyGeometry } from './clockhouse.js';

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

  // ---------- エントランス棟の正面 (路上写真 2025-05 より: 白い石の柱の間に高いアーチ窓が 4 つと中央のアーチ扉、
  //            黒いガラスの庇、屋根の上の円形の時計、紺灰色のスレート屋根とアーチ形のドーマー窓) ----------
  const hl = site.hall;
  if (hl && hl.v === 2) buildClockhouse({ hl, group, shadow });   // 時計の棟 (clockhouse.js)
  if (site.arch) buildCourtArch({ ar: site.arch, group, shadow });   // 中庭の独立したアーチの門
  if (site.carpark) buildCarpark({ cp: site.carpark, group, shadow, drapeFn: drape });   // 立体駐車場の入口
  else if (hl) {
    const L = hl.width, H = hl.height, nx = Math.sin(hl.yaw), nz = Math.cos(hl.yaw);
    // 通り抜ける開口 (opening = { w, h }。時計のある門のとき)。開口の左右に、アーチ窓を 2.4 m おきに並べる
    const op = hl.opening, P0 = op ? op.w : 2.0, half = L / 2;
    const centers = [];
    for (let c = P0 / 2 + 1.5; c < half - 0.9; c += 2.4) centers.push(c, -c);
    const draw = (lit) => canvasTexture(1024, Math.round(1024 * H / L), (g, W, Hh) => {
      g.fillStyle = lit ? '#000' : hl.color; g.fillRect(0, 0, W, Hh);
      const px = W / L, my = Hh / H;                     // 1 m あたりの画素
      const X = (c) => (half + c) * px;                  // 中心からの位置 (m) → 画素
      const arch = (cx, ww, top, bottom, fill, rim) => {
        g.beginPath(); g.moveTo(cx - ww / 2, bottom); g.lineTo(cx - ww / 2, top + ww / 2);
        g.arc(cx, top + ww / 2, ww / 2, Math.PI, 0); g.lineTo(cx + ww / 2, bottom); g.closePath();
        if (rim) { g.lineWidth = 0.22 * px; g.strokeStyle = rim; g.stroke(); }
        g.fillStyle = fill; g.fill();
      };
      const top = Hh - 4.4 * my, bottom = Hh, ww = 1.7 * px;
      if (!lit) {
        // 上の帯: 軒のまわりの濃い線
        g.fillStyle = '#4b4137'; g.fillRect(0, Hh * 0.22, W, 0.18 * my);
        g.fillStyle = '#f1ead9'; g.fillRect(0, Hh * 0.22 + 0.18 * my, W, 0.3 * my);
        g.fillStyle = '#4b4137'; g.fillRect(0, Hh - 5.2 * my, W, 0.14 * my);
        // 白い石の柱: 両端、開口とアーチ窓の間、アーチ窓どうしの間
        g.fillStyle = '#f2ecdf';
        const pil = [-half, half];
        for (const sg of [-1, 1]) {
          pil.push(sg * (P0 / 2 + 0.33));
          const cs = centers.filter(c => c * sg > 0).map(c => Math.abs(c)).sort((u, v) => u - v);
          for (let i = 0; i + 1 < cs.length; i++) pil.push(sg * (cs[i] + cs[i + 1]) / 2);
        }
        for (const c of pil) g.fillRect(X(c) - (Math.abs(c) === half ? 0.4 : 0.3) * px, Hh - 5.0 * my, (Math.abs(c) === half ? 0.8 : 0.6) * px, 5.0 * my);
        g.fillStyle = 'rgba(0,0,0,.10)'; for (const c of pil) g.fillRect(X(c) + 0.3 * px, Hh - 5.0 * my, 3, 5.0 * my);
      }
      for (const c of centers) {
        const cx = X(c);
        if (lit) { arch(cx, ww, top, bottom, '#ffd9a0'); continue; }
        arch(cx, ww, top, bottom, '#2f3a43', '#f4eee1');
        g.strokeStyle = '#7d8a94'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(cx, top + ww * 0.4); g.lineTo(cx, bottom); g.stroke();
        g.beginPath(); g.moveTo(cx - ww / 2, top + ww / 2 + 0.2 * my); g.lineTo(cx + ww / 2, top + ww / 2 + 0.2 * my); g.stroke();
        g.fillStyle = 'rgba(180,200,215,.18)'; g.fillRect(cx - ww / 2 + 3, top + ww / 2, ww - 6, bottom - top - ww / 2);
        g.fillStyle = '#d9c9a6'; g.fillRect(cx - 0.18 * px, top - 0.55 * my, 0.36 * px, 0.4 * my);   // アーチの上の飾り
      }
      // 中央: 通り抜ける開口 (透明に抜く。まわりに白い枠と要石)、または開口が無いときは赤い扉のアーチ
      const cx0 = X(0);
      if (op) {
        // ガラス扉 (奥はロビー。外から中庭は見えない): 白い枠・要石、赤茶の枠のガラス扉 2 組、上に店名の銘板
        const oh = op.h * my, ot = Hh - oh;
        if (!lit) {
          arch(cx0, (P0 + 0.9) * px, ot - 0.45 * my, bottom, '#f4eee1');
          g.fillStyle = '#d9c9a6'; g.fillRect(cx0 - 0.3 * px, ot - 1.15 * my, 0.6 * px, 0.7 * my);
          arch(cx0, P0 * px, ot, bottom, '#26323b');
          g.strokeStyle = '#7a3a2c'; g.lineWidth = 0.14 * px;
          g.beginPath(); g.moveTo(cx0, ot + P0 * px * 0.3); g.lineTo(cx0, bottom); g.stroke();
          for (const sx of [-1, 1]) { g.strokeRect(cx0 + sx * P0 * px * 0.25 - P0 * px * 0.22, ot + 0.9 * my, P0 * px * 0.44, oh - 1.0 * my); }
          g.strokeStyle = 'rgba(122,58,44,.7)'; g.lineWidth = 0.05 * px;
          for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(cx0 - P0 * px * 0.47, ot + 0.9 * my + k * (oh - 1.0 * my) / 4); g.lineTo(cx0 + P0 * px * 0.47, ot + 0.9 * my + k * (oh - 1.0 * my) / 4); g.stroke(); }
          g.fillStyle = 'rgba(255,214,150,.30)'; g.fillRect(cx0 - P0 * px * 0.47, ot + 0.9 * my, P0 * px * 0.94, oh - 1.0 * my);
        } else {
          arch(cx0, P0 * px, ot, bottom, '#ffd9a0');
        }
      } else if (!op) {
        arch(cx0, 2.0 * px, top, bottom, lit ? '#ffd9a0' : '#5b2a22', lit ? null : '#f4eee1');
      }
      // 壁灯
      if (!lit) { g.fillStyle = '#26282b'; for (const c of centers) if (c > 0) g.fillRect(X(c) - (centers.indexOf(c) % 2 ? 0 : 0) + 1.1 * px, Hh - 3.3 * my, 0.2 * px, 1.0 * my); }
    });
    const tex = draw(false), lit = draw(true);
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: lit, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.8, alphaTest: 0 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(L, H), m);
    plane.position.set(hl.x + nx * 0.04, hl.y + H / 2, hl.z + nz * 0.04);
    plane.rotation.y = hl.yaw;
    plane.receiveShadow = true;
    group.add(plane);
    group.userData.emissive = (group.userData.emissive || []).concat(m);
    const here = new THREE.Group();                       // 正面の中心を原点に、+z が外向き
    here.position.set(hl.x, hl.y, hl.z);
    here.rotation.y = hl.yaw;
    group.add(here);
    // 黒いガラスの庇 (入口の上。前に傾けて、細い腕で吊る)
    const glassM = new THREE.MeshStandardMaterial({ color: '#1c2227', roughness: 0.25, metalness: 0.6, transparent: true, opacity: 0.88 });
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.1, 2.0), glassM);
    const cy = op ? op.h + 0.2 : 4.15;
    canopy.position.set(0, cy, 1.0); canopy.rotation.x = 0.16;
    const rim = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.16, 0.12), new THREE.MeshStandardMaterial({ color: '#15181b', roughness: 0.5 }));
    rim.position.set(0, cy - 0.25, 2.0);
    here.add(shadow(canopy), rim);
    for (const sx of [-2.1, 2.1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 2.0), new THREE.MeshStandardMaterial({ color: '#15181b' }));
      arm.position.set(sx, cy + 0.35, 1.0); arm.rotation.x = 0.22; here.add(arm);
    }
    // 紺灰色のスレート屋根 (手前に傾いた面) と、アーチ形のドーマー窓
    const slate = new THREE.MeshStandardMaterial({ color: '#4d535c', roughness: 0.7, side: THREE.DoubleSide });
    const roofP = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.8, 3.0), slate);
    roofP.position.set(0, H + 1.05, 0.25); roofP.rotation.x = -0.9; roofP.castShadow = true;
    here.add(roofP);
    for (const u of [0.18, 0.34, 0.66, 0.82]) {
      const dm = new THREE.Group(); dm.position.set((u - 0.5) * L, H + 0.35, 0.35);
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 0.7), new THREE.MeshStandardMaterial({ color: '#e0d0ac', roughness: 0.85 }));
      box.position.y = 0.55;
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.8), new THREE.MeshStandardMaterial({ map: canvasTexture(64, 72, (g, W, Hh) => {
        g.fillStyle = '#2f3a43'; g.beginPath(); g.moveTo(8, Hh); g.lineTo(8, 24); g.arc(W / 2, 24, W / 2 - 8, Math.PI, 0); g.lineTo(W - 8, Hh); g.fill(); }), transparent: true }));
      win.position.set(0, 0.55, 0.36);
      dm.add(shadow(box), win); here.add(dm);
    }
    // 屋根の上の円形の時計 (クリーム色の半円の枠 + 黒い文字盤)
    const clockBack = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.6, 32).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e3d3ae', roughness: 0.85 }));
    clockBack.position.set(0, H + 2.6, -0.3);
    const clockBase = new THREE.Mesh(new THREE.BoxGeometry(4.0, 2.4, 0.6), new THREE.MeshStandardMaterial({ color: '#e3d3ae', roughness: 0.85 }));
    clockBase.position.set(0, H + 1.2, -0.3);
    const dial = new THREE.Mesh(new THREE.CircleGeometry(1.45, 32), new THREE.MeshStandardMaterial({ map: canvasTexture(256, 256, (g, W) => {
      g.fillStyle = '#1b1e22'; g.beginPath(); g.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#d9d3c4'; g.lineWidth = 6;
      for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; g.beginPath(); g.moveTo(W / 2 + Math.sin(a) * W * 0.4, W / 2 - Math.cos(a) * W * 0.4); g.lineTo(W / 2 + Math.sin(a) * W * 0.46, W / 2 - Math.cos(a) * W * 0.46); g.stroke(); }
      g.lineWidth = 9; g.beginPath(); g.moveTo(W / 2, W / 2); g.lineTo(W / 2 + W * 0.2, W / 2 + W * 0.05); g.stroke();
      g.lineWidth = 6; g.beginPath(); g.moveTo(W / 2, W / 2); g.lineTo(W / 2 - W * 0.05, W / 2 - W * 0.34); g.stroke();
    }), roughness: 0.5 }));
    dial.position.set(0, H + 2.6, 0.02);
    here.add(shadow(clockBack), shadow(clockBase), dial);
  }

  // ---------- 正面の車寄せ: レンガ色のタイル・丸い石の車止め・白い彫像 ----------
  const ct = site.court;
  if (ct) {
    const tile = canvasTexture(256, 256, (g, W) => {
      g.fillStyle = '#c99d86'; g.fillRect(0, 0, W, W);
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const off = r % 2 ? W / 16 : 0;
        g.fillStyle = (r * 3 + c * 5) % 7 < 2 ? '#bb8e78' : '#d3a994';
        g.fillRect(c * W / 8 + off + 1, r * W / 8 + 1, W / 8 - 2, W / 8 - 2);
      }
    });
    tile.wrapS = tile.wrapT = THREE.RepeatWrapping; tile.repeat.set(ct.w / 3, ct.d / 3);
    let geo;
    if (ct.poly && ct.poly.length >= 3) {   // 道路の端で切った形 (build_props.py)。模様は長方形のときと同じ並び
      geo = polyGeometry(ct.poly, 0.08);
      tile.repeat.set(ct.w / 3, ct.d / 3);
    } else {
      geo = new THREE.PlaneGeometry(ct.w, ct.d, Math.ceil(ct.w / 2), Math.ceil(ct.d / 2)).rotateX(-Math.PI / 2);
      geo.rotateY(ct.yaw); geo.translate(ct.x, 0.08, ct.z);
    }
    const pave = new THREE.Mesh(drape(geo, 1.0), new THREE.MeshStandardMaterial({ map: tile, roughness: 0.85 }));
    pave.receiveShadow = true;
    group.add(pave);
    const ball = new THREE.SphereGeometry(0.34, 14, 10);
    const ballM = new THREE.MeshStandardMaterial({ color: '#c9c3b6', roughness: 0.8 });
    for (const [bx, bz, by] of ct.bollards) { const m = shadow(new THREE.Mesh(ball, ballM)); m.position.set(bx, by + 0.3, bz); m.scale.y = 0.85; group.add(m); }
    const st = ct.statue, sg = new THREE.Group();
    sg.position.set(st.x, st.y, st.z);
    const white = new THREE.MeshStandardMaterial({ color: '#ece9e1', roughness: 0.75 });
    sg.add(shadow(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 1.8).translate(0, 0.25, 0), stone)));
    sg.add(shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.7, 12).translate(0, 0.85, 0), stone)));
    sg.add(shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.38, 1.3, 12).translate(0, 1.85, 0), white)));
    sg.add(shadow(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10).translate(0, 2.65, 0), white)));
    group.add(sg);
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
  const obl = site.obelisk || (site.garden && site.garden.obelisk);   // garden.layout の円形の広場の中央
  if (obl) {
    const { x: ox, y: oy, z: oz } = obl;
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
