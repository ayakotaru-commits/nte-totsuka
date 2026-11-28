// 噴水の水: しぶき (放物線を描いて落ちる水の粒) と、水盤に広がる波紋・着水の泡。
//   ・粒の動きは全部シェーダーで計算する (毎フレームの CPU の仕事は無し)。粒は 1 つの Points にまとめ、波紋は 1 枚のメッシュにまとめる
//   ・使い方: const fx = new FountainFx(); fx.add({ x, z, y0, yw, R, up }); fx.build(parent, { low });
//       x, z = 噴き口の位置 / y0 = 噴き口の高さ / yw = 水盤の水面の高さ / R = 水面の半径 / up = 噴き口から吹き上がる高さ (m)。座標は parent の局所
//   ・明るさは scene.fog の色 (昼は明るく、夜は暗い) に合わせる。夜に白く光りすぎない
//   ・?nofountainfx で以前の (動かない) 噴水
import * as THREE from 'three';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const U = { uTime: { value: 0 }, uBright: { value: 1 } };   // 全部の噴水で共有。Points の onBeforeRender が更新する
const G = 9.8;
const _c = new THREE.Color();
function tick(renderer, scene) {
  U.uTime.value = performance.now() / 1000;
  const f = scene.fog;
  if (f) { _c.copy(f.color); const lum = 0.2126 * _c.r + 0.7152 * _c.g + 0.0722 * _c.b; U.uBright.value = 0.2 + 0.8 * THREE.MathUtils.smoothstep(lum, 0.02, 0.4); }
}

const DROP_VERT = `
uniform float uTime;
attribute vec4 aD;   // x = 向き (ラジアン), y = 広がり 0〜1, z = 位相 0〜1, w = 粒の大きさの倍率
attribute vec4 aF;   // x = 水面の高さ, y = 吹き上がる高さ, z = 水面の半径, w = 勢い (0.9〜1.1)
varying float vA;
void main() {
  float up = aF.y * aF.w;
  float vy = sqrt(2.0 * ${G.toFixed(1)} * up);
  float dy = position.y - aF.x;                                         // 噴き口から水面までの落差
  float T = (vy + sqrt(vy * vy + 2.0 * ${G.toFixed(1)} * max(dy, 0.0))) / ${G.toFixed(1)};   // 飛んでいる時間
  float u = fract(uTime / (T * 1.12) + aD.z);                            // 1.12 = 着水してから少し間を置く
  float tau = min(u * T * 1.12, T);
  float rl = aD.y * aD.y * aF.z * 0.82;                                  // 着水する半径 (中央に多く、外に少し)
  vec2 dir = vec2(cos(aD.x), sin(aD.x));
  vec3 p = position;
  p.xz += dir * (rl / T) * tau;
  p.y += vy * tau - 0.5 * ${G.toFixed(1)} * tau * tau;
  vA = u * 1.12 < 1.0 ? 1.0 : 0.0;                                       // 着水したら消える
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(0.085 * aD.w * 900.0 / max(-mv.z, 0.5), 1.5, 9.0);
}`;
const DROP_FRAG = `
uniform float uBright; varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.18, 0.5, d)) * 0.8 * vA;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vec3(0.82, 0.93, 1.0) * uBright, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const RING_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RING_FRAG = `
uniform float uTime, uBright; varying vec2 vUv;
float h(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = 0.0;
  // 着水の輪 (外へ広がって消える) を 3 組ずらして重ねる。中心からの輪はゆっくり、着水点 (r≈0.5) からの輪は速く
  for (int i = 0; i < 3; i++) {
    float f = float(i) / 3.0;
    float p = fract(uTime * 0.45 + f);
    float c1 = p * 0.95;
    a += (1.0 - smoothstep(0.0, 0.05, abs(r - c1))) * (1.0 - p) * 0.5;
    float q = fract(uTime * 0.8 + f * 1.7);
    float c2 = 0.5 + q * 0.4, w = 0.03 + 0.03 * q;
    a += (1.0 - smoothstep(0.0, w, abs(r - c2))) * (1.0 - q) * 0.4 * smoothstep(0.25, 0.5, r);
  }
  // 中央のあわ (噴き上げの根元) と、着水の帯のきらめき
  float foam = (1.0 - smoothstep(0.05, 0.3, r)) * (0.55 + 0.25 * sin(uTime * 7.0));
  float spark = step(0.86, h(floor(vUv.x * 40.0) + floor(vUv.y * 40.0) * 57.0 + floor(uTime * 6.0 + r * 9.0))) * smoothstep(0.25, 0.5, r) * (1.0 - smoothstep(0.55, 0.85, r)) * 0.5;
  a = clamp(a + foam + spark, 0.0, 0.8) * (1.0 - smoothstep(0.88, 1.0, r));
  if (a < 0.02) discard;
  gl_FragColor = vec4(vec3(0.95, 0.98, 1.0) * uBright, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class FountainFx {
  constructor() { this.list = []; }
  add(o) { this.list.push(o); return this; }
  build(parent, { low = false } = {}) {
    if (!this.list.length || Q.has('nofountainfx')) return null;
    const ND = low ? 70 : 170, N = this.list.length * ND;
    const pos = new Float32Array(N * 3), aD = new Float32Array(N * 4), aF = new Float32Array(N * 4);
    let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    let k = 0;
    for (const f of this.list) {
      for (let i = 0; i < ND; i++, k++) {
        pos.set([f.x, f.y0, f.z], k * 3);
        aD.set([rnd() * Math.PI * 2, i < ND * 0.35 ? rnd() * 0.25 : Math.sqrt(rnd()), rnd(), 0.7 + rnd() * 0.7], k * 4);   // 3 割強は中央の柱 (広がりが小さい)
        aF.set([f.yw, f.up, f.R, 0.9 + rnd() * 0.2], k * 4);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aD', new THREE.BufferAttribute(aD, 4)); g.setAttribute('aF', new THREE.BufferAttribute(aF, 4));
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: U, vertexShader: DROP_VERT, fragmentShader: DROP_FRAG, transparent: true, depthWrite: false }));
    pts.frustumCulled = false; pts.renderOrder = 5; pts.name = 'fountain_drops'; pts.onBeforeRender = tick;
    parent.add(pts);
    // 水盤の波紋: 全部の水面を 1 枚のメッシュにまとめる (uv = 円の中心が 0.5)
    const SEG = low ? 16 : 28, rp = [], ru = [];
    for (const f of this.list) {
      const y = f.yw + 0.02;
      for (let i = 0; i < SEG; i++) {
        const a0 = i / SEG * Math.PI * 2, a1 = (i + 1) / SEG * Math.PI * 2;
        rp.push(f.x, y, f.z, f.x + Math.cos(a0) * f.R, y, f.z + Math.sin(a0) * f.R, f.x + Math.cos(a1) * f.R, y, f.z + Math.sin(a1) * f.R);
        ru.push(0.5, 0.5, 0.5 + Math.cos(a0) * 0.5, 0.5 + Math.sin(a0) * 0.5, 0.5 + Math.cos(a1) * 0.5, 0.5 + Math.sin(a1) * 0.5);
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2));
    const rm = new THREE.Mesh(rg, new THREE.ShaderMaterial({ uniforms: U, vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    rm.frustumCulled = false; rm.renderOrder = 4; rm.name = 'fountain_ripples';
    parent.add(rm);
    return { pts, ripples: rm };
  }
}
