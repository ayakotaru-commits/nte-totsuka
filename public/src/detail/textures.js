// 2. 素材テクスチャ (CC0 / Poly Haven)。既存マテリアルのシェーダに「範囲内だけ素材の質感を掛ける」処理を足す。
// 元の色は残し、素材画像を平均色で割った「明暗の模様」を掛け合わせる。
import * as THREE from 'three';
import { TOUCH } from '../touch.js';

const DIR = 'assets/detail/';
const loader = new THREE.TextureLoader();

async function load(id) {
  const [diff, nor] = await Promise.all([
    loader.loadAsync(DIR + id + '_diff.jpg'),
    loader.loadAsync(DIR + id + '_nor.jpg'),
  ]);
  for (const t of [diff, nor]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  diff.colorSpace = THREE.SRGBColorSpace;
  // 平均色 (線形) を求める
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d'); g.drawImage(diff.image, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data;
  const avg = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) avg[k] += Math.pow(d[i + k] / 255, 2.2);
  return { diff, nor, avg: new THREE.Vector3(...avg.map(v => v / (d.length / 4))) };
}

export async function applyTextures({ built, cx, cz, R }) {
  const [asph, pave, ftile, plaster, conc] = await Promise.all(
    ['asphalt_02', 'concrete_pavement', 'rectangular_facade_tiles', 'white_rough_plaster', 'concrete_wall_008'].map(load));
  const common = {
    uDetC: { value: new THREE.Vector2(cx, cz) },
    uDetR: { value: R },
    uDetOn: { value: 1 },
  };

  const groundUniforms = {
    ...common,
    uAsph: { value: asph.diff }, uAsphN: { value: asph.nor }, uAsphAvg: { value: asph.avg },
    uPave: { value: pave.diff }, uPaveN: { value: pave.nor }, uPaveAvg: { value: pave.avg },
  };
  const base = built.group.getObjectByName('base_ground');
  const terrain = built.group.getObjectByName('terrain');
  for (const m of [built.mats.ground, base && base.material, terrain && terrain.material].filter(Boolean)) patchGround(m, groundUniforms);

  // 壁: 建物ごとの材質 (city.js の matId) で、模様・凹凸・つや・目地を変える。窓はガラスとして空を映す
  const wallU = {
    ...common,
    uPl: { value: plaster.diff }, uPlN: { value: plaster.nor }, uPlAvg: { value: plaster.avg },
    uTi: { value: ftile.diff }, uTiN: { value: ftile.nor }, uTiAvg: { value: ftile.avg },
    uCo: { value: conc.diff }, uCoN: { value: conc.nor }, uCoAvg: { value: conc.avg },
    uGlass: { value: 6.0 }, // ガラスの映り込みの強さ (空の映り込み envI に掛ける倍率)
  };
  for (const k of ['office', 'house', 'euro']) patchWall(built.mats[k], wallU, k);
  patchRoof(built.mats.roof, { ...common, uRoofTex: { value: conc.diff }, uRoofAvg: { value: conc.avg }, uRoofN: { value: conc.nor } });
  patchPitched(built.mats.pitched, { ...common });

  return { set: (v) => { common.uDetOn.value = v ? 1 : 0; } };
}

const VERT = (s) => s
  .replace('#include <common>', '#include <common>\nvarying vec3 vDW;')
  .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
// 世界座標の法線と材質の番号も渡す (壁・屋根用)。flat = 三角形の中で補間しない (三角形の頂点はどれも同じ値なので、補間の誤差を避けるだけ)
const VERT_MAT = (s, mat = true) => VERT(s)
  .replace('#include <common>', '#include <common>\nflat varying vec3 vWN;' + (mat ? '\nattribute float matId; flat varying float vMat;' : ''))
  .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal);' + (mat ? '\nvMat = matId;' : ''));
// 細かい模様は、遠くで画素より細かくなるとちらつくので消す (周期 p に対する画素の大きさ)
// fwidth は分岐の外で求めて渡す (分岐の中では値が決まらず、画素ごとに白い点が出る)
// aaL: 細い線 (目地・継ぎ目) を画素の幅でぼかす。線が画素より細いと、線に当たった画素だけが点のように光る (d・w・fwp は周期に対する割合)
const FADE = `float detFade(float fw, float p) { return 1.0 - smoothstep(0.6, 1.5, fw / p); }
float aaL(float d, float w, float fwp) { float W = max(w, fwp); return (1.0 - smoothstep(0.0, W, d)) * (w / W); }`;
// 世界座標の法線 n を、接線方向 t・上 (または斜面の上り) 方向 b に (dx, dy) だけ傾け、描画用 (視点座標) の法線にする
const TILT = `vec3 detTilt(vec3 n, vec3 t, vec3 b, float dx, float dy) { return normalize((viewMatrix * vec4(normalize(n + t * dx + b * dy), 0.0)).xyz); }`;
const TEXN = !TOUCH; // 写真の凹凸 (法線の画像) はスマホでは使わない (メモリ。模様の色と目地・波などの形は使う)

const FRAG_HEAD = `
varying vec3 vDW;
uniform vec2 uDetC; uniform float uDetR; uniform float uDetOn;
float detW() { return uDetOn * (1.0 - smoothstep(uDetR * 0.8, uDetR, distance(vDW.xz, uDetC))); }
`;

function patchGround(mat, uniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = VERT(sh.vertexShader);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${FRAG_HEAD}
uniform sampler2D uAsph, uAsphN, uPave, uPaveN; uniform vec3 uAsphAvg, uPaveAvg;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float dDw = detW(), dRoad = 0.0, dPave = 0.0;
if (dDw > 0.0) {
  vec3 b = diffuseColor.rgb;
  float lum = dot(b, vec3(0.299, 0.587, 0.114));
  float sat = max(b.r, max(b.g, b.b)) - min(b.r, min(b.g, b.b));
  float gray = 1.0 - smoothstep(0.035, 0.08, sat);
  dRoad = (1.0 - smoothstep(0.14, 0.2, lum)) * gray;
  dPave = smoothstep(0.14, 0.2, lum) * gray;
  vec3 a = mix(vec3(1.0), max(texture2D(uAsph, vDW.xz / 4.0).rgb / uAsphAvg, vec3(0.95)), 0.75); // 暗い部分を下げ止め = ひび割れを消す (ざらつきは残す)
  vec3 p = texture2D(uPave, vDW.xz / 2.5).rgb / uPaveAvg;
  vec3 det = mix(vec3(1.0), a, dRoad) * mix(vec3(1.0), p, dPave);
  diffuseColor.rgb = mix(b, b * det, dDw);
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (dDw > 0.0) {
  vec3 ta = texture2D(uAsphN, vDW.xz / 4.0, 4.5).xyz * 2.0 - 1.0; // 少しぼかしてひび割れの段差を消す
  vec3 tp = texture2D(uPaveN, vDW.xz / 2.5).xyz * 2.0 - 1.0;
  vec2 txy = ta.xy * dRoad + tp.xy * dPave;
  vec3 wn = normalize(vec3(txy.x * 0.8, 1.0, -txy.y * 0.8)); // 地面は上向き前提
  normal = normalize(mix(normal, normalize((viewMatrix * vec4(wn, 0.0)).xyz), dDw));
}`);
  };
  mat.customProgramCacheKey = () => 'detail-ground';
  mat.needsUpdate = true;
}

function patchWall(mat, uniforms, key) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = VERT_MAT(sh.vertexShader);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${FRAG_HEAD}
flat varying vec3 vWN; flat varying float vMat;
uniform sampler2D uPl, uPlN, uTi, uTiN, uCo, uCoN; uniform vec3 uPlAvg, uTiAvg, uCoAvg; uniform float uGlass;
${FADE}
${TILT}
float dW, dWall, dGlass, dTx, dTy;
vec2 dUV; vec3 dT;
`)
      .replace('#include <color_fragment>', `#include <color_fragment>
// 壁の材質: 0 吹き付け / 1 サイディング / 2 タイル / 3 打ち放し / 4 角波の鋼板 / 5 ALC
dW = detW(); dTx = 0.0; dTy = 0.0;
dT = normalize(vec3(-vWN.z, 0.0, vWN.x));
dUV = vec2(dot(vDW.xz, dT.xz), vDW.y); // 壁の上の位置 (m): 横・高さ
dWall = smoothstep(0.62, 0.75, sampledDiffuseColor.g); // 窓以外 (壁の明るい部分)
dGlass = (1.0 - dWall) * smoothstep(0.02, 0.07, sampledDiffuseColor.b - sampledDiffuseColor.r); // 青みのある所 = ガラス
vec2 dFw = fwidth(dUV);
if (dW > 0.0) {
  int m = int(vMat + 0.5);
  vec3 det = vec3(1.0);
  if (m == 0) {
    det = mix(vec3(1.0), texture2D(uPl, dUV / 1.5).rgb / uPlAvg, 0.35);
  } else if (m == 1) { // 横張りのサイディング: 高さ 455 mm の板、3,030 mm ごとの縦の継ぎ目 (段ごとにずらす)
    float row = floor(dUV.y / 0.455), f = fract(dUV.y / 0.455), fd = detFade(dFw.y, 0.455);
    float seam = fract(dUV.x / 3.03 + row * 0.37);
    float edge = aaL(f, 0.05, dFw.y / 0.455);
    det *= 1.0 - fd * (0.22 * edge + 0.04 * f);
    det *= 1.0 - fd * 0.15 * aaL(min(seam, 1.0 - seam), 0.004, dFw.x / 3.03);
    det *= mix(1.0, 0.94 + 0.12 * fract(sin(row * 12.9898 + floor(dUV.x / 3.03 + row * 0.37) * 78.233) * 43758.5), fd); // 板ごとのわずかな色むら
    dTy = fd * (-0.1 + 0.5 * edge);
  } else if (m == 2) {
    det = mix(vec3(1.0), texture2D(uTi, dUV / 2.4).rgb / uTiAvg, 0.35);
  } else if (m == 3) { // 打ち放し: 型枠 1,800 x 900 mm の目地とセパ穴
    det = mix(vec3(1.0), texture2D(uCo, dUV / 2.0).rgb / uCoAvg, 0.5);
    vec2 q = dUV / vec2(1.8, 0.9), fq = fract(q), fd2 = vec2(detFade(dFw.x, 1.8), detFade(dFw.y, 0.9));
    float jx = aaL(min(fq.x, 1.0 - fq.x), 0.006, dFw.x / 1.8), jy = aaL(min(fq.y, 1.0 - fq.y), 0.012, dFw.y / 0.9);
    det *= 1.0 - 0.18 * max(jx * fd2.x, jy * fd2.y);
    vec2 h = fract(dUV / vec2(0.6, 0.45)) - 0.5; // セパ穴
    det *= 1.0 - 0.35 * fd2.x * fd2.y * clamp(0.012 / max(dFw.x, dFw.y), 0.0, 1.0) * (1.0 - smoothstep(0.012, max(0.02, 0.012 + max(dFw.x, dFw.y)), length(h * vec2(0.6, 0.45))));
  } else if (m == 4) { // 角波の鋼板: 縦のひだ 200 mm ごと
    float fd = detFade(dFw.x, 0.2), w = sin(dUV.x / 0.2 * 6.2832);
    dTx = fd * 0.35 * w;
    det *= 1.0 - fd * 0.06 * (1.0 - abs(w));
  } else if (m == 5) { // ALC: 横張りのパネル 600 mm ごとの目地
    float f = fract(dUV.y / 0.6), fd = detFade(dFw.y, 0.6), g = aaL(min(f, 1.0 - f), 0.02, dFw.y / 0.6);
    det *= 1.0 - fd * 0.25 * g;
    dTy = fd * 0.4 * g * (f < 0.5 ? 1.0 : -1.0);
    det *= mix(vec3(1.0), texture2D(uPl, dUV / 3.0).rgb / uPlAvg, 0.15);
  }
  diffuseColor.rgb *= mix(vec3(1.0), det, dWall * dW);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if (dW > 0.0) {
  int m = int(vMat + 0.5);
  float r = m == 2 ? 0.55 : m == 4 ? 0.45 : m == 1 ? 0.7 : roughnessFactor;
  roughnessFactor = mix(roughnessFactor, r, dWall * dW);
  roughnessFactor = mix(roughnessFactor, 0.05, dGlass * dW); // ガラスはつるつる
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (dW > 0.0 && abs(vWN.y) < 0.5) {
  int m = int(vMat + 0.5);
  #if ${TEXN ? 1 : 0}
  vec3 tn = vec3(0.0);
  if (m == 0) tn = (texture2D(uPlN, dUV / 1.5).xyz * 2.0 - 1.0) * 0.4;
  else if (m == 2) tn = (texture2D(uTiN, dUV / 2.4).xyz * 2.0 - 1.0) * 0.25;
  else if (m == 3) tn = (texture2D(uCoN, dUV / 2.0).xyz * 2.0 - 1.0) * 0.5;
  dTx += tn.x; dTy += tn.y;
  #endif
  normal = mix(normal, detTilt(vWN, dT, vec3(0.0, 1.0, 0.0), dTx * dWall, dTy * dWall), dW);
}`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
radiance *= 1.0 + (uGlass - 1.0) * dGlass * dW; // ガラスに空を強く映す (空の映り込みは日陰を明るくしすぎないよう全体では弱くしてある)
#endif`);
  };
  mat.customProgramCacheKey = () => 'detail-wall2-' + key;
  mat.needsUpdate = true;
}

// 勾配屋根: 材質 (city.js の matId) ごとに、段・波・はぜ を形 (凹凸) と陰で描く。0 スレート / 1 瓦 / 2 金属 (立平)
// 斜面の向きは法線から求めるので、切妻・寄棟・片流れ・輪郭に沿った屋根 (skel) のどれにも同じように掛かる
function patchPitched(mat, uniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = VERT_MAT(sh.vertexShader);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${FRAG_HEAD}
flat varying vec3 vWN; flat varying float vMat;
${FADE}
${TILT}
float pW, pTx, pTy; vec3 pD, pA;
`)
      .replace('#include <map_fragment>', `#include <map_fragment>
pW = detW() * step(0.15, abs(vWN.y)) * (1.0 - step(0.985, vWN.y)); // 斜面だけ (平らな面・壁は除く)
pTx = 0.0; pTy = 0.0;
pD = normalize(vec3(vWN.x, 0.0, vWN.z) + vec3(1e-4, 0.0, 0.0)); // 下り方向 (水平)
pA = vec3(-pD.z, 0.0, pD.x);                                   // 軒と平行
float across = dot(vDW.xz, pA.xz), along = -dot(vDW.xz, pD.xz) / max(abs(vWN.y), 0.3); // 斜面の上りの長さ (m)
float fAl = fwidth(along), fAc = fwidth(across);
if (pW > 0.0) {
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86), pW); // 元の瓦の絵 (段の向きが斜面と合わないことがある) の代わりに、下で形を描く
  int m = int(vMat + 0.5);
  float shade = 1.0;
  if (m == 0) { // スレート: 段 200 mm、継ぎ目 910 mm (段ごとにずらす)
    float f = fract(along / 0.2), fd = detFade(fAl, 0.2), row = floor(along / 0.2);
    float seam = fract(across / 0.91 + row * 0.5);
    float edge = aaL(f, 0.08, fAl / 0.2);
    shade -= fd * (0.3 * edge + 0.3 * smoothstep(0.5, 1.0, f)); // 上の段の下にできる影の帯 (遠くからも段に見えるよう、線ではなく帯で)
    shade -= fd * 0.2 * aaL(min(seam, 1.0 - seam), 0.006, fAc / 0.91);
    pTy = fd * (0.08 + 0.45 * edge);
  } else if (m == 1) { // 瓦: 波 305 mm、段 235 mm
    float f = fract(along / 0.235), fd = detFade(fAl, 0.235), fa = detFade(fAc, 0.305);
    float w = sin(across / 0.305 * 6.2832);
    float edge = aaL(f, 0.1, fAl / 0.235);
    shade -= fd * (0.3 * edge + 0.3 * smoothstep(0.45, 1.0, f)) + fa * 0.15 * (0.5 - 0.5 * w);
    pTx = fa * 0.4 * cos(across / 0.305 * 6.2832);
    pTy = fd * (0.08 + 0.4 * edge);
  } else { // 金属の立平: はぜ 455 mm ごと
    float g = fract(across / 0.455), fd = detFade(fAc, 0.455);
    float e = aaL(min(g, 1.0 - g), 0.04, fAc / 0.455);
    pTx = fd * (e * (g < 0.5 ? 0.5 : -0.5) + 0.12 * sin(g * 6.2832)); // はぜの立ち上がりと、板のわずかなたわみ
    shade -= fd * (0.22 * e + 0.05 * (0.5 + 0.5 * cos(g * 6.2832)));
  }
  diffuseColor.rgb *= mix(1.0, shade, pW);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if (pW > 0.0) { int m = int(vMat + 0.5); roughnessFactor = mix(roughnessFactor, m == 1 ? 0.5 : m == 2 ? 0.4 : 0.8, pW); }`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
if (pW > 0.0 && int(vMat + 0.5) == 2) metalnessFactor = mix(metalnessFactor, 0.45, pW);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (pW > 0.0) {
  vec3 up = normalize(cross(pA, vWN)); // 斜面の上り方向
  normal = mix(normal, detTilt(vWN * (gl_FrontFacing ? 1.0 : -1.0), pA, up, pTx, pTy), pW);
}`);
  };
  mat.customProgramCacheKey = () => 'detail-pitched';
  mat.needsUpdate = true;
}

function patchRoof(mat, uniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = VERT(sh.vertexShader);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${FRAG_HEAD}
uniform sampler2D uRoofTex, uRoofN; uniform vec3 uRoofAvg;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float w = detW();
  if (w > 0.0) diffuseColor.rgb *= mix(vec3(1.0), texture2D(uRoofTex, vDW.xz / 3.0).rgb / uRoofAvg, w * 0.6);
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#if ${TEXN ? 1 : 0}
if (detW() > 0.0) {
  vec3 wn0 = (vec4(normal, 0.0) * viewMatrix).xyz;
  if (wn0.y > 0.9) { // 上向きの面だけ (屋上)
    vec3 t = texture2D(uRoofN, vDW.xz / 3.0).xyz * 2.0 - 1.0;
    normal = normalize(mix(normal, normalize((viewMatrix * vec4(normalize(vec3(t.x * 0.5, 1.0, -t.y * 0.5)), 0.0)).xyz), detW()));
  }
}
#endif`);
  };
  mat.customProgramCacheKey = () => 'detail-roof';
  mat.needsUpdate = true;
}
