// 川・池の水面 (city.js の water メッシュの材質)。
//   ・岸からの距離 (shore): 水の形を 1 枚の画像 (距離場) にして、画素ごとに「岸まで何 m か」を読む
//   ・浅い所 (岸) は薄く澄んだ緑がかった色、深い所 (中央) は濃い青。岸の縁は透けてなじむ
//   ・波: 向きと細かさの違う波を重ねた法線のゆれ (画像は使わない。時間で流れる)。遠くは平らに戻す (ちらつき防止)
//   ・岸の泡: 縁に沿って揺れる白い筋 (護岸に当たる波)
//   ・空の反射・太陽のきらめきは、標準材質 (scene.environment とライト) がそのまま担う。波で法線が揺れるので、反射もゆれる
// URL: ?watert=秒 で時刻を止める (確認用)、?nowater で以前の単色の水面。
import * as THREE from 'three';
import { TOUCH } from '../touch.js';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const MAXD = 8; // 距離場に入れる最大の距離 (m)
const FLOW = [-0.2, 0.98]; // 川の流れの向き (東, 南)。柏尾川は南へ流れる

// city の水 (面 + 線) を距離場の画像にする。戻り値: { tex, minX, minZ, w, h, cell } (範囲は水の外接矩形 + 余白)
function shoreField(city) {
  const areas = (city.areas || []).filter((a) => a.kind === 'water');
  const ways = city.waterways || [];
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const grow = (p, r) => { x0 = Math.min(x0, p[0] - r); x1 = Math.max(x1, p[0] + r); z0 = Math.min(z0, p[1] - r); z1 = Math.max(z1, p[1] + r); };
  for (const a of areas) for (const p of a.outer) grow(p, 0);
  for (const w of ways) for (const p of w.pts) grow(p, w.w / 2);
  if (!isFinite(x0)) return null;
  x0 -= 12; z0 -= 12; x1 += 12; z1 += 12;
  const cell = TOUCH ? 3 : 1.5;
  const W = Math.ceil((x1 - x0) / cell), Hh = Math.ceil((z1 - z0) / cell);
  if (W * Hh > 6e6) return null; // 想定外に広いときは使わない (メモリ)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, W, Hh);
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  const px = (p) => [(p[0] - x0) / cell, (p[1] - z0) / cell];
  for (const a of areas) {
    g.beginPath();
    for (const ring of [a.outer, ...(a.holes || [])]) { ring.forEach((p, i) => { const [x, y] = px(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); }
    g.fill('evenodd');
  }
  for (const w of ways) {
    g.lineWidth = Math.max(1, w.w / cell);
    g.beginPath(); w.pts.forEach((p, i) => { const [x, y] = px(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  }
  const img = g.getImageData(0, 0, W, Hh).data;
  // 距離変換 (チャンファー 2 パス)。水でない画素 = 0、水の画素 = 岸 (水でない画素) までの距離 (画素)
  const INF = 1e6, d = new Float32Array(W * Hh);
  for (let i = 0; i < W * Hh; i++) d[i] = img[i * 4] > 127 ? INF : 0;
  const S2 = Math.SQRT2;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let v = d[i]; if (!v) continue;
    if (x > 0) v = Math.min(v, d[i - 1] + 1);
    if (y > 0) { v = Math.min(v, d[i - W] + 1); if (x > 0) v = Math.min(v, d[i - W - 1] + S2); if (x < W - 1) v = Math.min(v, d[i - W + 1] + S2); }
    d[i] = v;
  }
  for (let y = Hh - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; let v = d[i]; if (!v) continue;
    if (x < W - 1) v = Math.min(v, d[i + 1] + 1);
    if (y < Hh - 1) { v = Math.min(v, d[i + W] + 1); if (x < W - 1) v = Math.min(v, d[i + W + 1] + S2); if (x > 0) v = Math.min(v, d[i + W - 1] + S2); }
    d[i] = v;
  }
  const out = new Uint8Array(W * Hh);
  for (let i = 0; i < W * Hh; i++) out[i] = d[i] ? Math.min(255, Math.round(Math.min(MAXD, (d[i] - 0.5) * cell) / MAXD * 255)) : 0;
  const tex = new THREE.DataTexture(out, W, Hh, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1; tex.needsUpdate = true;
  return { tex, minX: x0, minZ: z0, w: W * cell, h: Hh * cell };
}

const FRAG_HEAD = `
varying vec3 vDW;
uniform sampler2D uShore; uniform vec4 uBox; uniform float uWT, uAmp; uniform vec2 uFlow, uOrg; uniform vec3 uShallow; uniform vec4 uEl, uIs;
// 楕円の岸までの距離の近似 (内側が正)。円なら半径 - 中心からの距離に一致する
float wEll(vec2 p, vec4 e) { vec2 q = (p - e.xy) / e.zw; float rho = length(q); return (1.0 - rho) * rho / max(length(q / e.zw), 1e-4); }
float wHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y); }
// 波の傾き (水平方向の勾配)。向き・細かさ・速さの違う波の重ね合わせ
vec2 wWave(vec2 p, float t) {
  vec2 g = vec2(0.0);
  const vec4 W[5] = vec4[5](vec4(0.95, 0.31, 0.55, 0.9), vec4(-0.5, 0.87, 1.05, 1.3), vec4(0.2, -0.98, 1.9, 1.7), vec4(-0.9, -0.44, 2.9, 2.2), vec4(0.6, 0.8, 4.2, 2.8));
  for (int i = 0; i < 5; i++) { vec4 w = W[i]; vec2 d = w.xy;
    float ph = dot(d, p) * w.z + t * w.w;
    g += d * w.z * cos(ph) * (0.055 / (w.z * 0.9 + 0.4)); }
  return g;
}`;

// city = 川・池の地図データ。opts.ellipse = { cx, cz, rx, rz, island?: { cx, cz, rx, rz } } を渡すと、地図の代わりに楕円の湖 (島の岸にも泡) にする
//   (千葉ドリームランドのムーンレイク。opts.opaque で不透明のまま = 城の映り込みとの描く順を変えない、opts.calm = 波の強さ、opts.flow = 流れ)
export function makeWaterMaterial(city, opts = {}) {
  const el = opts.ellipse || null;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.0, transparent: !opts.opaque, depthWrite: true });
  if (Q.has('nowater')) { mat.roughness = 0.15; mat.metalness = 0.2; mat.transparent = false; return { mat, onRender: null }; }
  const sf = el ? null : shoreField(city);
  const I = el && el.island;
  const uniforms = {
    uShore: { value: sf ? sf.tex : null }, uBox: { value: new THREE.Vector4(sf ? sf.minX : 0, sf ? sf.minZ : 0, sf ? 1 / sf.w : 0, sf ? 1 / sf.h : 0) },
    uWT: { value: Q.has('watert') ? +Q.get('watert') : 0 }, uFlow: { value: new THREE.Vector2(...(opts.flow || FLOW)) },
    uAmp: { value: opts.calm ?? 1 }, uOrg: { value: new THREE.Vector2(el ? el.cx : 0, el ? el.cz : 0) },   // 座標が大きい (公園) ときは、中心を原点にしてノイズの精度を保つ
    uEl: { value: new THREE.Vector4(el ? el.cx : 0, el ? el.cz : 0, el ? el.rx : 1, el ? el.rz : 1) }, uIs: { value: new THREE.Vector4(I ? I.cx : 0, I ? I.cz : 0, I ? I.rx : 1, I ? I.rz : 1) },
    uShallow: { value: new THREE.Color('#5f8f86') },
  };
  const fixedT = Q.has('watert');
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <color_fragment>', `#include <color_fragment>
      vec2 wp = vDW.xz - uOrg;
      float wT = uWT;
      float wD = ${el ? `clamp(min(wEll(vDW.xz, uEl)${I ? ', -wEll(vDW.xz, uIs)' : ''}), 0.0, ${MAXD.toFixed(1)})` : `texture2D(uShore, (vDW.xz - uBox.xy) * uBox.zw).r * ${MAXD.toFixed(1)}`};   // 岸までの距離 (m)
      float wK = smoothstep(0.0, 4.5, wD);                                              // 0 = 岸、1 = 深い
      vec3 wDeep = diffuseColor.rgb * vec3(0.42, 0.55, 0.62);
      diffuseColor.rgb = mix(uShallow, wDeep, pow(wK, 0.8));
      diffuseColor.a = ${opts.opaque ? '1.0' : 'mix(0.5, 0.94, smoothstep(0.0, 2.2, wD))'};
      // 岸の泡: 縁に沿って揺れる筋 (流れとともにゆっくり動く)
      float wFn = wNoise(wp * 1.6 - uFlow * wT * 0.35) * 0.65 + wNoise(wp * 4.3 + uFlow * wT * 0.5) * 0.35;
      float wEdge = wD + (wFn - 0.5) * 0.9 + 0.12 * sin(wT * 1.4 + dot(wp, vec2(0.6, 0.5)));
      float wFoam = (1.0 - smoothstep(0.1, 0.75, wEdge)) * 0.55 + (1.0 - smoothstep(0.0, 0.1, abs(wEdge - 0.95))) * step(0.52, wFn) * 0.3;
      wFoam *= smoothstep(0.0, 0.35, wD + 0.35);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.9), clamp(wFoam, 0.0, 0.8));
      diffuseColor.a = max(diffuseColor.a, clamp(wFoam, 0.0, 0.8));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.85, clamp(wFoam * 1.4, 0.0, 1.0));`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);   // 水面は水平 (地形の傾きの面ごとの明暗を出さない)`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        float wFar = 1.0 / (1.0 + length(vViewPosition) / 55.0);                            // 遠くほど平らに (ちらつき防止)
        vec2 wg = wWave(wp, wT) + wWave(wp * 1.7 + 11.0, wT * 1.2) * 0.6;
        ${TOUCH ? '' : `float wE = 0.35;
        float wn0 = wNoise((wp - uFlow * wT * 0.8) * 5.0);
        wg += vec2(wNoise((wp - uFlow * wT * 0.8 + vec2(wE, 0.0)) * 5.0) - wn0, wNoise((wp - uFlow * wT * 0.8 + vec2(0.0, wE)) * 5.0) - wn0) * 0.25;`}
        wg *= uAmp * wFar * (0.4 + 0.6 * wK) * (1.0 - clamp(wFoam, 0.0, 0.8));
        normal = normalize(normal + (viewMatrix * vec4(wg.x, 0.0, wg.y, 0.0)).xyz * 0.9);
      }`);
  };
  mat.customProgramCacheKey = () => 'water-v4-' + (TOUCH ? 't' : 'd') + (el ? (I ? 'ei' : 'e') : 'm') + (opts.opaque ? 'o' : '');
  const onRender = fixedT ? null : () => { uniforms.uWT.value = performance.now() / 1000; };
  return { mat, onRender };
}
