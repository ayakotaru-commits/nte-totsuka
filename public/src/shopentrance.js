// 洋服屋の入口の見た目と「ここから入れます」の案内 (data/shops.json の entrances。入りかたは shop.js)。
//   ・door のある入口: 壁に、ガラスの自動ドア (両開き)・黒い枠・紫の庇 (下に明かり)・光る看板・足元のマットを置く
//   ・すべての入口: 遠くから見える光の柱、足元の光の輪 (近づくと強くなり、立ち止まっている間は輪が埋まっていく)、
//     近くに来たときの画面下の案内文
// 光の柱・輪は半透明の色付き (昼でも見える)。三角形は入口 1 か所で 100 に満たない。
import * as THREE from 'three';

const COL = 0xd79bff;            // 光の色 (地図の「服」の印と同じ紫)
const FAR = 140;                 // 光の柱が見える距離 (m)
const NEAR = 14;                 // 看板・扉が明るくなり始める距離 (m)
const BEAM_H = 22;

// 看板の字 (canvas)。紫の地に白
function signTexture(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#5b3f78'; g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#8dbf3b'; g.fillRect(0, 118, 512, 10);
  g.fillStyle = '#fff'; g.font = 'bold 66px "Yu Gothic UI","Hiragino Sans",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 60, 480);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// 光の柱: 下が濃く上へ薄れる (頂点の y で決める)。距離で太さを変えて、遠くでも見えるようにする
function beamMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    uniforms: { uCol: { value: new THREE.Color(COL) }, uK: { value: 0 }, uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform vec3 uCol; uniform float uK, uT;
      void main(){
        float h = 1.0 - vUv.y;
        float a = pow(h, 1.6) * 0.62 * uK;
        a *= 0.8 + 0.2 * sin(uT * 2.4 + vUv.y * 9.0);
        gl_FragColor = vec4(mix(uCol, vec3(1.0), 0.35 * h), a);
      }`,
  });
}

export class ShopEntrances {
  // places: shops.json の places。trigger: ShopTrigger (list の各要素 t = { e, dwell, hold })
  constructor({ scene, places, world, player, trigger, menu }) {
    this.player = player; this.trigger = trigger; this.menu = menu;
    this.items = [];
    this.root = new THREE.Group(); this.root.name = 'shop_entrances'; scene.add(this.root);
    const lit = new THREE.MeshBasicMaterial({ color: 0xfff1cf });
    this.mats = { lit };
    const sharedGlass = new THREE.MeshStandardMaterial({ color: 0xaed4e2, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.38, depthWrite: false });
    const frameM = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.55, metalness: 0.5 });
    const canopyM = new THREE.MeshStandardMaterial({ color: 0x5b3f78, roughness: 0.6, metalness: 0.1 });
    const matM = new THREE.MeshStandardMaterial({ color: 0x35383f, roughness: 0.95 });
    const inside = new THREE.MeshStandardMaterial({ color: 0x2c2a2e, roughness: 0.9, emissive: 0xffe9bd, emissiveIntensity: 0.4 });
    const stripM = new THREE.MeshBasicMaterial({ color: 0xffffff });

    for (const p of places) for (const e of p.entrances) {
      const t = trigger.list.find((q) => q.e === e);
      const gy = e.y === undefined || e.y === null ? world.groundAt(e.x, e.z, 3) : e.y - 0.17;   // 足元の高さ (入口の y はキャラの足元 + 持ち上げ)
      const it = { e, t, gy, mats: {} };
      // ---- 光の柱と輪 ----
      const beamM = beamMaterial(); it.beamM = beamM;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, BEAM_H, 16, 1, true), beamM);
      beam.position.set(e.x, gy + BEAM_H / 2, e.z); beam.renderOrder = 6; beam.frustumCulled = false; it.beam = beam;
      const ringM = new THREE.MeshBasicMaterial({ color: COL, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(e.r * 0.78, e.r * 0.9, 48), ringM);
      ring.rotation.x = -Math.PI / 2; ring.position.set(e.x, gy + 0.06, e.z); ring.renderOrder = 6;
      const discM = new THREE.MeshBasicMaterial({ color: COL, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(e.r * 0.78, 48), discM);
      disc.rotation.x = -Math.PI / 2; disc.position.set(e.x, gy + 0.05, e.z); disc.renderOrder = 5;
      const prM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const pr = new THREE.Mesh(new THREE.RingGeometry(e.r * 0.9, e.r * 1.0, 48, 1, 0, 0.001), prM);   // 立ち止まった時間に合わせて伸ばす輪
      pr.rotation.x = -Math.PI / 2; pr.position.set(e.x, gy + 0.07, e.z); pr.renderOrder = 7;
      Object.assign(it, { ring, ringM, disc, discM, pr, prM });
      this.root.add(beam, ring, disc, pr);
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
        box(frameM, 0.14, dh + 0.2, 0.24, -w / 2 - 0.06, (dh + 0.2) / 2, 0.1); box(frameM, 0.14, dh + 0.2, 0.24, w / 2 + 0.06, (dh + 0.2) / 2, 0.1);   // 柱
        box(frameM, w + 0.34, 0.24, 0.28, 0, dh + 0.12, 0.1);             // 上の枠 (センサーの箱)
        box(matM, w + 0.2, 0.03, 1.5, 0, 0.015, 0.85);                   // 足元のマット
        // 庇 (濃い紫の板。下に細い明かり。壁から 1.7 m)
        box(canopyM, w + 1.6, 0.18, 1.7, 0, 3.4, 0.85);
        box(canopyM, w + 1.6, 0.34, 0.08, 0, 3.28, 1.66);                  // 前の縁の立ち上がり
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
      const k = Math.max(0, Math.min(1, 1 - (dist - 4) / FAR));   // 遠くほど 0 (ほんのり見える)
      it.beamM.uniforms.uT.value = this.time;
      it.beamM.uniforms.uK.value = 0.55 + 0.45 * k;
      const s = 1 + dist / 26;   // 遠いほど太く (見失わない)
      it.beam.scale.set(Math.min(s, 4), 1, Math.min(s, 4));
      it.beam.visible = dist < FAR && !closed;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 3);
      const near = dh < e.r + 10 && sameLevel;
      it.ringM.opacity = near ? 0.55 + 0.35 * pulse : 0;
      it.discM.opacity = near ? 0.1 + 0.1 * pulse : 0;
      it.ring.visible = it.disc.visible = near;
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
