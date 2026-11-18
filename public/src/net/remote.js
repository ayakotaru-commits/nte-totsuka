// ほかのプレイヤーの表示。届いた状態を少し遅らせて (DELAY)、前後 2 つの間をなめらかにつないで見せる。
// 姿は軽い組み立て式のキャラ (VRM は読まない。スマホのメモリの節約)。服の色は人ごとに変える。
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { makeCharacter } from '../character.js';
import { STEPS } from '../attack.js';

const DELAY = 0.22;      // 見せるのを遅らせる時間 (秒)。届く間隔 (0.1〜0.2 秒) より長くして、途切れないようにする
const SHOW_DIST = 220;   // これより遠い人は描かない (m)
const NAME_DIST = 70;    // これより遠い人の名前は出さない (m)
const WARP_DIST = 15;    // 一度にこれ以上動いたら、間をつながずに飛ばす (地図からのワープ)
const ACT_NAME = [null, 'atk', 'vault', 'climb', 'hurt', 'down', 'door'];

const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

function colorsOf(id) {
  const h = (id * 0.381966) % 1;
  const c = (s, l) => '#' + new THREE.Color().setHSL(h, s, l).getHexString();
  return { jacket: c(0.5, 0.36), accent: c(0.85, 0.68), hair: '#' + new THREE.Color().setHSL((h + 0.45) % 1, 0.25, 0.2).getHexString() };
}

export class Remotes {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map(); // id → 相手
    this.hpMax = 100;
  }

  add({ id, name, pvp = false, hp = 100, k = 0, d = 0, s = null }, now) {
    this.remove(id);
    const model = makeCharacter({ vrm: false, colors: colorsOf(id) });
    model.root.visible = false;
    this.scene.add(model.root);
    const el = document.createElement('div');
    el.className = 'pname';
    el.innerHTML = '<span></span><div class="hp"><i></i></div>';
    el.firstChild.textContent = name;
    const label = new CSS2DObject(el);
    label.position.set(0, 2.0, 0); label.visible = false;
    model.root.add(label);
    const r = { id, name, pvp, hp, k, d, model, label, el, buf: [], x: 0, y: 0, z: 0, shown: false };
    this.map.set(id, r);
    this.style(r);
    if (s) this.push(id, s, now);
    return r;
  }

  remove(id) {
    const r = this.map.get(id);
    if (!r) return;
    r.label.removeFromParent(); r.el.remove();
    r.model.dispose();
    this.map.delete(id);
  }
  clear() { for (const id of [...this.map.keys()]) this.remove(id); }

  // 名前の札の見た目 (戦闘オンの人は赤く、体力を出す)
  style(r) {
    r.el.classList.toggle('pvp', r.pvp);
    r.el.querySelector('i').style.width = Math.max(0, Math.min(100, r.hp / this.hpMax * 100)) + '%';
  }

  // 状態が届いた (d = server/room.js の並び)
  push(id, d, now) {
    const r = this.map.get(id);
    if (!r) return;
    r.buf.push({ time: now, d });
    if (r.buf.length > 12) r.buf.shift();
  }

  // now: 秒。(px, pz) = 自分の位置
  update(dt, now, px, pz) {
    const rt = now - DELAY;
    for (const r of this.map.values()) {
      const B = r.buf;
      if (!B.length) continue;
      while (B.length > 2 && B[1].time <= rt) B.shift();
      const a = B[0], b = B[1];
      let u = 0, A = a.d, Bd = a.d, since = Math.max(0, rt - a.time);
      if (b && rt >= a.time) {
        u = Math.min(1, (rt - a.time) / Math.max(1e-3, b.time - a.time)); Bd = b.d;
        if (Math.hypot(Bd[0] - A[0], Bd[2] - A[2]) > WARP_DIST) { A = Bd; u = 0; since = 0; }
      }
      r.x = lerp(A[0], Bd[0], u); r.y = lerp(A[1], Bd[1], u); r.z = lerp(A[2], Bd[2], u);
      const dist = Math.hypot(r.x - px, r.z - pz);
      const show = dist < SHOW_DIST;
      r.model.root.visible = show; r.shown = show;
      r.label.visible = show && dist < NAME_DIST;
      if (!show) continue;
      const facing = lerpAngle(A[3], Bd[3], u), spin = lerpAngle(A[8], Bd[8], u);
      // 動き: 攻撃は時間を進める。パルクールは進み具合をつなぐ
      let act = null;
      const type = ACT_NAME[A[9]];
      if (type === 'atk') {
        const step = A[10], ph = A[11], S = STEPS[step];
        if (S && S.dur[ph] !== undefined) act = { type, step, ph, t: Math.min(A[12] + Math.min(since, 0.4), S.dur[ph] + 0.2) };
      } else if (type === 'vault' || type === 'climb') {
        const same = Bd[9] === A[9] && Bd[10] >= A[10];
        act = { type, s: same ? lerp(A[10], Bd[10], u) : A[10], ly: same ? lerp(A[11], Bd[11], u) : A[11], lz: same ? lerp(A[12], Bd[12], u) : A[12] };
      } else if (type === 'hurt' || type === 'down') {
        act = { type, s: Math.min(1, A[10] + Math.min(since, 0.4) / (type === 'hurt' ? 0.35 : 0.5)) };
      }
      r.model.root.position.set(r.x, r.y, r.z);
      r.model.root.rotation.y = facing + spin;
      r.model.update(dt, lerp(A[4], Bd[4], u), !!(A[5] & 1), lerp(A[6], Bd[6], u), A[7], act, !!(A[5] & 2));
    }
  }
}

// 当たったときの光 (相手の胸の高さで、ぱっと広がって消える)
export class Sparks {
  constructor(scene) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,180,.9)'); gr.addColorStop(1, 'rgba(255,160,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.pool = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, toneMapped: false, transparent: true }));
      s.visible = false; s.userData.t = 1; scene.add(s); this.pool.push(s);
    }
  }
  burst(x, y, z, big) {
    const s = this.pool.find((q) => !q.visible) || this.pool[0];
    s.position.set(x, y + 1.1, z); s.userData.t = 0; s.userData.k = big ? 1.6 : 1; s.visible = true;
  }
  update(dt) {
    for (const s of this.pool) {
      if (!s.visible) continue;
      const t = (s.userData.t += dt / 0.22);
      if (t >= 1) { s.visible = false; continue; }
      s.scale.setScalar((0.3 + 1.1 * t) * s.userData.k); s.material.opacity = 0.85 * (1 - t * t);
    }
  }
}
