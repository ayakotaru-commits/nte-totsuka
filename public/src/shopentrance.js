// 洋服屋の入口の見た目と「ここから入れます」の案内 (data/shops.json の entrances。入りかたは shop.js)。
//   ・door のある入口: 壁に、ガラスの自動ドア (両開き)・黒い枠・紫の庇 (下に明かり)・光る看板・足元のマットを置く
//   ・すべての入口: 足元の光の輪 (spotring.js。近づくと強くなり、立ち止まっている間は白い輪が一周する)、
//     近くに来たときの画面下の案内文
import * as THREE from 'three';

const COL = 0xd79bff;            // 光の色 (地図の「服」の印と同じ紫)
const NEAR = 14;                 // 看板・扉が明るくなり始める距離 (m)

// 看板の字 (canvas)。紫の地に白
function signTexture(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#34373a'; g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#8dbf3b'; g.fillRect(0, 118, 512, 10);
  g.fillStyle = '#fff'; g.font = 'bold 66px "Yu Gothic UI","Hiragino Sans",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 60, 480);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class ShopEntrances {
  // places: shops.json の places。trigger: ShopTrigger (list の各要素 t = { e, dwell, hold })
  constructor({ scene, places, world, player, trigger, menu, rings }) {
    this.player = player; this.trigger = trigger; this.menu = menu;
    this.items = [];
    this.root = new THREE.Group(); this.root.name = 'shop_entrances'; scene.add(this.root);
    const lit = new THREE.MeshBasicMaterial({ color: 0xfff1cf });
    this.mats = { lit };
    const sharedGlass = new THREE.MeshStandardMaterial({ color: 0x5d7480, roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.5, depthWrite: false });
    const frameM = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.5, metalness: 0.55 });   // 濃いブロンズ色の枠 (モディの写真のガラスの塔の桟)
    const canopyM = new THREE.MeshStandardMaterial({ color: 0xe3dccb, roughness: 0.8, metalness: 0.0 });   // 壁と同じクリーム色のタイル
    const matM = new THREE.MeshStandardMaterial({ color: 0x35383f, roughness: 0.95 });
    const inside = new THREE.MeshStandardMaterial({ color: 0x2c2a2e, roughness: 0.9, emissive: 0xffe9bd, emissiveIntensity: 0.4 });
    const stripM = new THREE.MeshBasicMaterial({ color: 0xffffff });

    for (const p of places) for (const e of p.entrances) {
      const t = trigger.list.find((q) => q.e === e);
      const gy = e.y === undefined || e.y === null ? world.groundAt(e.x, e.z, 3) : e.y - 0.17;   // 足元の高さ (入口の y はキャラの足元 + 持ち上げ)
      const it = { e, t, gy, mats: {} };
      // ---- 足元の輪 (反応する範囲。階が違うときは出さない) と、立ち止まった時間の輪 ----
      it.spot = rings.addCircle(e.x, e.z, e.r * 0.85, { color: COL, y: gy, level: e.y === undefined || e.y === null ? null : e.y });
      const prM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const pr = new THREE.Mesh(new THREE.RingGeometry(e.r * 0.9, e.r * 1.0, 48, 1, 0, 0.001), prM);   // 立ち止まった時間に合わせて伸ばす輪
      pr.rotation.x = -Math.PI / 2; pr.position.set(e.x, gy + 0.14, e.z); pr.renderOrder = 7;
      Object.assign(it, { pr, prM });
      this.root.add(pr);
      // ---- 扉・庇・看板 ----
      if (e.door) {
        const d = e.door, w = d.w, dy = d.y !== undefined ? d.y : gy;
        const g = new THREE.Group();
        g.position.set(d.x + d.nx * 0.04, dy, d.z + d.nz * 0.04); g.rotation.y = Math.atan2(d.nx, d.nz);
        const box = (mat, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); g.add(m); return m; };
        const dh = 2.6;
        box(inside, w, dh, 0.04, 0, dh / 2, 0.0);                         // 奥 (明るい店内)
        for (const s of [-1, 1]) {                                         // 両開きのガラス戸 (中央に合わせ目)
          box(sharedGlass, w / 2 - 0.08, dh - 0.12, 0.03, s * (w / 4), dh / 2 + 0.02, 0.1);
          box(frameM, 0.05, dh - 0.1, 0.06, s * 0.05, dh / 2, 0.1);          // 戸の合わせ目の縦枠
          box(frameM, 0.04, 0.5, 0.05, s * 0.2, 1.1, 0.14);                 // 取っ手
        }
        box(frameM, w / 2 - 0.08, 0.1, 0.06, -w / 4, 0.05, 0.1); box(frameM, w / 2 - 0.08, 0.1, 0.06, w / 4, 0.05, 0.1);   // 戸の下の枠
        for (const q of [-0.75, -0.25, 0.25, 0.75]) box(frameM, 0.04, dh - 0.1, 0.05, q * w / 2, dh / 2, 0.13);   // ガラスの縦の桟 (写真の塔と同じ細い縦線)
        box(frameM, 0.14, dh + 0.2, 0.24, -w / 2 - 0.06, (dh + 0.2) / 2, 0.1); box(frameM, 0.14, dh + 0.2, 0.24, w / 2 + 0.06, (dh + 0.2) / 2, 0.1);   // 柱
        box(frameM, w + 0.34, 0.24, 0.28, 0, dh + 0.12, 0.1);             // 上の枠 (センサーの箱)
        box(matM, w + 0.2, 0.03, 1.5, 0, 0.015, 0.85);                   // 足元のマット
        // 庇 (壁と同じクリーム色の厚い軒。下に細い明かり。壁から 1.7 m。1 階の角の写真の、へこんだ開口の上の軒に合わせた)
        box(canopyM, w + 1.6, 0.18, 1.7, 0, 3.4, 0.85);
        box(frameM, w + 1.6, 0.05, 0.05, 0, 3.27, 1.7);                   // 前の縁の細い黒線
        box(stripM, w + 0.6, 0.02, 0.18, 0, 3.3, 1.45);                   // 庇の下の明かり
        // 看板 (庇の上の壁。字は canvas)
        const sg = new THREE.Mesh(new THREE.BoxGeometry(w + 1.6, 0.8, 0.1));
        const stex = signTexture(d.sign || '洋服');
        const signM = new THREE.MeshStandardMaterial({ map: stex, emissive: 0xffffff, emissiveMap: stex, emissiveIntensity: 0.5, roughness: 0.5 });
        sg.material = [frameM, frameM, frameM, frameM, signM, signM];
        sg.position.set(0, 4.15, 0.06); g.add(sg);
        it.signM = signM; it.insideM = inside; it.stripM = stripM;
        this.root.add(g); it.door = g;
      }
      this.items.push(it);
    }

    // 画面下の案内文
    const hint = document.createElement('div');
    hint.id = 'shop-hint'; hint.hidden = true;
    hint.style.cssText = 'position:fixed;left:50%;bottom:130px;transform:translateX(-50%);z-index:20;padding:8px 16px;border-radius:999px;background:rgba(40,24,60,.82);color:#fff;font:600 14px "Yu Gothic UI","Hiragino Sans",sans-serif;border:1px solid #d79bff;pointer-events:none;white-space:nowrap;box-shadow:0 0 14px rgba(215,155,255,.55)';
    document.body.appendChild(hint); this.hint = hint;
    this.time = 0;
  }

  update(dt) {
    this.time += dt;
    const pl = this.player.pos;
    let msg = '', best = 1e9;
    const closed = this.menu.open;
    for (const it of this.items) {
      const { e, t } = it;
      const dh = Math.hypot(pl.x - e.x, pl.z - e.z);
      const dv = e.y === undefined || e.y === null ? 0 : Math.abs(pl.y - e.y);
      const sameLevel = e.y === undefined || e.y === null || dv <= 2.5;
      const dist = Math.hypot(dh, sameLevel ? 0 : dv + 4);   // 階が違うときは遠いものとして扱う
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 3);
      it.spot.enabled = !closed;
      // 立ち止まっている間に輪が埋まっていく (shop.js の dwell)
      const prog = t && !t.hold && dh <= e.r && sameLevel && !closed ? Math.min(1, t.dwell / 0.5) : 0;
      it.pr.visible = prog > 0;
      if (prog > 0) { it.pr.geometry.dispose(); it.pr.geometry = new THREE.RingGeometry(e.r * 0.9, e.r * 1.0, 48, 1, 0, prog * Math.PI * 2); it.prM.opacity = 0.95; }
      // 扉・看板は近づくと明るく
      if (it.door) {
        const q = Math.max(0, Math.min(1, 1 - (dist - NEAR) / 26));
        it.signM.emissiveIntensity = 0.5 + 0.9 * q + 0.25 * q * pulse;
        it.insideM.emissiveIntensity = 0.4 + 0.5 * q;
      }
      if (sameLevel && dist < best && dh < e.r + 9) { best = dist; msg = dh <= e.r ? (t && t.hold ? '' : '立ち止まったまま、少し待つと店に入れます') : '光の輪の中に入って、立ち止まると洋服屋に入れます'; }
    }
    if (closed) msg = '';
    this.hint.textContent = msg; this.hint.hidden = !msg;
  }
}
