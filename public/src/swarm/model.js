// 敵キャラ「うな○ー」の見た目 (イベントは swarm/event.js)。
// 白いおもちのような体に水玉、太い灰色の線で描いた手足。紙を切り抜いた人形のように、平たい板を組み合わせて動かす。
// 絵はブラウザの canvas で描く (画像ファイルは使わない)。体の表・体の裏・手足の 3 種類の板を、それぞれ 1 つの InstancedMesh で
// まとめて描く (何体いても描画は 3 回 + 演出の 2 回)。
//
// 姿勢 (setPose の引数 p):
//   x, y, z    足元の位置           yaw   向き (+z が正面。atan2(dx, dz))
//   pitch      前へ倒れる角度 (π/2 = うつぶせ。足元を軸に倒れる)   roll  左右の傾き (よちよち歩き)
//   s          大きさ   sq  つぶれ (+ = 横に広がって縦に縮む)
//   arm, leg   手足を開く角度 (0 = 下へまっすぐ、π/2 = 真横、π に近いほど上へ。大の字は arm 2.3・leg 0.6)
//   armL, armR, legL, legR  左右それぞれに足す開き   swA, swL  腕・脚を前後に振る角度 (+ = 前へ。左右逆に振る)
//   reach      両腕を前へ出す角度   tint  色を混ぜる (0〜1、赤く光る)
import * as THREE from 'three';

export const BODY = { w: 0.95, h: 1.15, y: 0.88 };   // 体の板 (幅・高さ・中心の高さ m)
const ARM = { len: 0.52, w: 0.17, x: 0.36, y: 1.0 };  // 腕 (付け根の位置)
const LEG = { len: 0.48, w: 0.19, x: 0.17, y: 0.46 }; // 脚
const DOTS = ['#f2789f', '#f6d34a', '#9ccc3c', '#7cc4ea', '#e8434f', '#2fae95', '#b48ad8'];
const LINE = '#b9bcc0';

// 体の輪郭: 上が丸く、下が少し広い「おもち」の形
function bodyPath(g, W, H, m) {
  const l = m, r = W - m, t = m + 34, b = H - m;
  g.beginPath();
  g.moveTo(l + 30, b);
  g.bezierCurveTo(l - 6, b, l - 4, b - 70, l + 6, t + 120);
  g.bezierCurveTo(l + 14, t + 30, l + 50, t - 6, W / 2, t - 8);
  g.bezierCurveTo(r - 50, t - 6, r - 14, t + 30, r - 6, t + 120);
  g.bezierCurveTo(r + 4, b - 70, r + 6, b, r - 30, b);
  g.closePath();
}

function drawBody(front) {
  const W = 256, H = 310, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.lineJoin = g.lineCap = 'round';
  // 頭の芽 (ふた葉)
  g.strokeStyle = '#6aa83a'; g.lineWidth = 7;
  g.beginPath(); g.moveTo(W / 2, 48); g.quadraticCurveTo(W / 2 + 4, 26, W / 2 - 2, 14); g.stroke();
  g.fillStyle = '#8fd14f'; g.strokeStyle = '#5b9a2e'; g.lineWidth = 4;
  for (const sx of [-1, 1]) {
    g.beginPath(); g.ellipse(W / 2 + sx * 17, 15, 17, 9, sx * -0.45, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  // 体
  bodyPath(g, W, H, 9);
  g.fillStyle = '#fbfbf7'; g.fill();
  g.save(); g.clip();
  // 水玉 (体の下半分に多め。裏は少し別の並び)
  const spots = front
    ? [[60, 205, 20, 0], [190, 180, 17, 1], [118, 262, 22, 2], [205, 255, 15, 3], [40, 145, 13, 4], [150, 205, 12, 5], [80, 285, 13, 6], [222, 125, 12, 0]]
    : [[70, 120, 20, 3], [180, 150, 22, 0], [110, 210, 18, 1], [200, 245, 16, 5], [50, 255, 17, 4], [140, 95, 13, 6], [150, 280, 14, 2]];
  for (const [x, y, r, k] of spots) {
    g.fillStyle = DOTS[k];
    g.beginPath(); g.ellipse(x, y, r, r * 0.9, 0.3, 0, Math.PI * 2); g.fill();
  }
  // 体の下の方を少しだけ陰に (板っぽさを和らげる)
  const grd = g.createLinearGradient(0, H * 0.55, 0, H);
  grd.addColorStop(0, 'rgba(150,150,170,0)'); grd.addColorStop(1, 'rgba(150,150,170,0.22)');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.restore();
  bodyPath(g, W, H, 9);
  g.strokeStyle = LINE; g.lineWidth = 12; g.stroke();
  if (front) {
    // 目: 黒いまる目に白い光、少しつり上がった眉 (いたずらっぽい顔)
    for (const sx of [-1, 1]) {
      const ex = W / 2 + sx * 40, ey = 104;
      g.fillStyle = '#26232b';
      g.beginPath(); g.ellipse(ex, ey, 14, 17, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(ex + 4, ey - 6, 5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#26232b'; g.lineWidth = 6;
      g.beginPath(); g.moveTo(ex - sx * 18, ey - 34); g.lineTo(ex + sx * 12, ey - 26); g.stroke();
      // ほっぺ
      g.fillStyle = 'rgba(255,140,160,0.55)';
      g.beginPath(); g.ellipse(W / 2 + sx * 72, 132, 16, 9, 0, 0, Math.PI * 2); g.fill();
    }
    // 口: 横に広いにんまり口に、小さなとがった歯
    g.fillStyle = '#c9303e'; g.strokeStyle = '#26232b'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(W / 2 - 38, 134); g.quadraticCurveTo(W / 2, 176, W / 2 + 38, 134); g.quadraticCurveTo(W / 2, 146, W / 2 - 38, 134); g.fill(); g.stroke();
    g.fillStyle = '#fff';
    for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(W / 2 + sx * 22, 139); g.lineTo(W / 2 + sx * 13, 140); g.lineTo(W / 2 + sx * 18, 150); g.closePath(); g.fill(); }
  }
  return c;
}

// 手足: 太い灰色の線で縁取った白いひも。先はまるい手 (足)
function drawLimb() {
  const W = 48, H = 160, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.lineCap = 'round';
  g.strokeStyle = LINE; g.lineWidth = 30;
  g.beginPath(); g.moveTo(W / 2, 10); g.lineTo(W / 2, H - 26); g.stroke();
  g.beginPath(); g.arc(W / 2, H - 22, 18, 0, Math.PI * 2); g.fillStyle = LINE; g.fill();
  g.strokeStyle = '#fbfbf7'; g.lineWidth = 16;
  g.beginPath(); g.moveTo(W / 2, 4); g.lineTo(W / 2, H - 26); g.stroke();
  g.beginPath(); g.arc(W / 2, H - 22, 11, 0, Math.PI * 2); g.fillStyle = '#fbfbf7'; g.fill();
  return c;
}

function dotTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 29, 0, Math.PI * 2); g.fill();
  return c;
}
function ringTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 10, 64, 64, 62);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(0.7, 'rgba(0,0,0,0.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(230,40,60,0.9)'; g.lineWidth = 6;
  g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
  return c;
}

const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
// 白が灰色に沈まないよう、絵そのものを少し光らせる (影の中でも明るい紙の人形に見える)
const mat = (c, side = THREE.FrontSide) => { const t = tex(c); return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.32, alphaTest: 0.5, side, roughness: 0.85, metalness: 0 }); };

const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _p = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
const WHITE = new THREE.Color(1, 1, 1), RED = new THREE.Color(1, 0.35, 0.4);

export class Herd {
  constructor(scene, max = 40) {
    this.max = max;
    const plane = (w, h, top) => { const g = new THREE.PlaneGeometry(w, h); if (top) g.translate(0, -h / 2, 0); return g; };
    const mk = (geo, m, n) => {
      const im = new THREE.InstancedMesh(geo, m, n);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = true; im.frustumCulled = false;
      for (let i = 0; i < n; i++) { im.setMatrixAt(i, HIDE); im.setColorAt(i, WHITE); }
      scene.add(im); return im;
    };
    this.front = mk(plane(BODY.w, BODY.h), mat(drawBody(true)), max);
    this.back = mk(plane(BODY.w, BODY.h), mat(drawBody(false)), max);
    this.limbs = mk(plane(1, 1, true), mat(drawLimb(), THREE.DoubleSide), max * 4);
    this.group = [this.front, this.back, this.limbs];
  }

  hide(i) {
    this.front.setMatrixAt(i, HIDE); this.back.setMatrixAt(i, HIDE);
    for (let k = 0; k < 4; k++) this.limbs.setMatrixAt(i * 4 + k, HIDE);
    this.dirty = true;
  }

  setPose(i, p) {
    const s = p.s || 1, sq = p.sq || 0;
    // 足元 → 向き → 傾き (足元を軸に) → 大きさ・つぶれ
    _e.set(p.pitch || 0, p.yaw || 0, p.roll || 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.compose(_v.set(p.x, p.y, p.z), _q, _s.set(s * (1 + sq), s * (1 - sq * 0.8), s));
    // 体の表と裏
    this.front.setMatrixAt(i, _m.multiplyMatrices(_p, _r.makeTranslation(0, BODY.y, 0.012)));
    _r.makeRotationY(Math.PI).setPosition(0, BODY.y, -0.012);
    this.back.setMatrixAt(i, _m.multiplyMatrices(_p, _r));
    // 手足: 付け根を軸に、板の面の中で開き (z 軸)、前後に振る (x 軸)
    const arm = p.arm ?? 0.35, leg = p.leg ?? 0.12, swA = p.swA || 0, swL = p.swL || 0, reach = p.reach || 0;
    const limb = (k, side, D, open, swing) => {
      _e.set(-swing, 0, side * open, 'ZXY');
      _q.setFromEuler(_e);
      _r.compose(_v.set(side * D.x, D.y, 0), _q, _s.set(D.w, D.len, 1));
      this.limbs.setMatrixAt(i * 4 + k, _m.multiplyMatrices(_p, _r));
    };
    limb(0, 1, ARM, arm + (p.armL || 0), swA + reach);
    limb(1, -1, ARM, arm + (p.armR || 0), -swA + reach);
    limb(2, 1, LEG, leg + (p.legL || 0), -swL);
    limb(3, -1, LEG, leg + (p.legR || 0), swL);
    const t = p.tint || 0;
    _c.copy(WHITE).lerp(RED, t);
    this.front.setColorAt(i, _c); this.back.setColorAt(i, _c);
    for (let k = 0; k < 4; k++) this.limbs.setColorAt(i * 4 + k, _c);
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    for (const im of this.group) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    this.dirty = false;
  }
}

// 演出: 色の水玉が飛び散る・土ぼこり (いつもカメラの方を向く小さな円) と、落ちてくる所の印 (地面の赤い輪)
export class Fx {
  constructor(scene, max = 500, rings = 40) {
    this.max = max; this.parts = []; this.free = [];
    const m = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(dotTex()), alphaTest: 0.5, toneMapped: false });
    this.dots = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), m, max);
    this.dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.dots.frustumCulled = false;
    for (let i = 0; i < max; i++) { this.dots.setMatrixAt(i, HIDE); this.dots.setColorAt(i, WHITE); this.free.push(max - 1 - i); }
    scene.add(this.dots);
    const rm = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(ringTex()), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.rings = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), rm, rings);
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.rings.frustumCulled = false;
    for (let i = 0; i < rings; i++) this.rings.setMatrixAt(i, HIDE);
    scene.add(this.rings);
  }
  // 色の水玉 n 個を (x, y, z) から飛び散らせる
  burst(x, y, z, n = 14, colors = DOTS, speed = 5, size = 0.22, life = 0.9, grav = 14) {
    for (let k = 0; k < n; k++) {
      const i = this.free.pop(); if (i === undefined) return;
      const a = Math.random() * Math.PI * 2, u = Math.random() * 0.8 + 0.4, sp = speed * (0.5 + Math.random() * 0.7);
      this.parts.push({ i, x, y, z, vx: Math.cos(a) * sp * Math.sqrt(1 - u * u * 0.5), vy: speed * u, vz: Math.sin(a) * sp, t: 0, life: life * (0.7 + Math.random() * 0.6), size: size * (0.7 + Math.random() * 0.6), grav });
      this.dots.setColorAt(i, _c.set(colors[Math.floor(Math.random() * colors.length)]));
    }
    this.dots.instanceColor.needsUpdate = true;
  }
  // 土ぼこり (地面に沿って広がる白っぽい粒)
  dust(x, y, z, n = 10, r = 1) {
    for (let k = 0; k < n; k++) {
      const i = this.free.pop(); if (i === undefined) return;
      const a = k / n * Math.PI * 2 + Math.random() * 0.4, sp = (2 + Math.random() * 2) * r;
      this.parts.push({ i, x, y: y + 0.1, z, vx: Math.cos(a) * sp, vy: 0.6 + Math.random(), vz: Math.sin(a) * sp, t: 0, life: 0.5 + Math.random() * 0.3, size: 0.35 * r, grav: 2, drag: 4 });
      this.dots.setColorAt(i, _c.set('#d8d2c4'));
    }
    this.dots.instanceColor.needsUpdate = true;
  }
  update(dt, camera, rings = []) {
    const q = camera.quaternion;
    for (let k = this.parts.length - 1; k >= 0; k--) {
      const p = this.parts[k];
      p.t += dt;
      if (p.t >= p.life) { this.dots.setMatrixAt(p.i, HIDE); this.free.push(p.i); this.parts.splice(k, 1); continue; }
      if (p.drag) { const d = Math.exp(-p.drag * dt); p.vx *= d; p.vz *= d; }
      p.vy -= p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const sc = p.size * (1 - Math.pow(p.t / p.life, 3));
      this.dots.setMatrixAt(p.i, _m.compose(_v.set(p.x, p.y, p.z), q, _s.set(sc, sc, sc)));
    }
    this.dots.instanceMatrix.needsUpdate = true;
    // 落ちてくる所の印: rings = [{ x, y, z, r }]
    for (let i = 0; i < this.rings.count; i++) {
      const g = rings[i];
      this.rings.setMatrixAt(i, g ? _m.compose(_v.set(g.x, g.y + 0.06, g.z), _q.identity(), _s.set(g.r, 1, g.r)) : HIDE);
    }
    this.rings.instanceMatrix.needsUpdate = true;
  }
}
