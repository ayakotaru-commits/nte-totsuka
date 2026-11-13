// 2. 素材テクスチャ (CC0 / Poly Haven)。既存マテリアルのシェーダに「範囲内だけ素材の質感を掛ける」処理を足す。
// 元の色は残し、素材画像を平均色で割った「明暗の模様」を掛け合わせる。
import * as THREE from 'three';

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

  patchWall(built.mats.office, { ...common, uWallTex: { value: ftile.diff }, uWallAvg: { value: ftile.avg }, uWallScale: { value: new THREE.Vector2(32 / 2.4, 28.8 / 2.4) }, uWallK: { value: 0.55 } }, 'office');
  patchWall(built.mats.house, { ...common, uWallTex: { value: plaster.diff }, uWallAvg: { value: plaster.avg }, uWallScale: { value: new THREE.Vector2(24 / 1.5, 23.2 / 1.5) }, uWallK: { value: 0.25 } }, 'house');
  patchRoof(built.mats.roof, { ...common, uRoofTex: { value: conc.diff }, uRoofAvg: { value: conc.avg } });

  return { set: (v) => { common.uDetOn.value = v ? 1 : 0; } };
}

const VERT = (s) => s
  .replace('#include <common>', '#include <common>\nvarying vec3 vDW;')
  .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDW = (modelMatrix * vec4(transformed, 1.0)).xyz;');

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
  vec3 a = mix(vec3(1.0), texture2D(uAsph, vDW.xz / 4.0).rgb / uAsphAvg, 0.75);
  vec3 p = texture2D(uPave, vDW.xz / 2.5).rgb / uPaveAvg;
  vec3 det = mix(vec3(1.0), a, dRoad) * mix(vec3(1.0), p, dPave);
  diffuseColor.rgb = mix(b, b * det, dDw);
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (dDw > 0.0) {
  vec3 ta = texture2D(uAsphN, vDW.xz / 4.0).xyz * 2.0 - 1.0;
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
    sh.vertexShader = VERT(sh.vertexShader);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${FRAG_HEAD}
uniform sampler2D uWallTex; uniform vec3 uWallAvg; uniform vec2 uWallScale; uniform float uWallK;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float w = detW();
  if (w > 0.0) {
    float wallMask = smoothstep(0.62, 0.75, sampledDiffuseColor.g); // 窓以外 (壁の明るい部分)
    vec3 det = texture2D(uWallTex, vMapUv * uWallScale).rgb / uWallAvg;
    diffuseColor.rgb *= mix(vec3(1.0), det, wallMask * w * uWallK);
  }
}`);
  };
  mat.customProgramCacheKey = () => 'detail-wall-' + key;
  mat.needsUpdate = true;
}

function patchRoof(mat, uniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = VERT(sh.vertexShader);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${FRAG_HEAD}
uniform sampler2D uRoofTex; uniform vec3 uRoofAvg;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float w = detW();
  if (w > 0.0) diffuseColor.rgb *= mix(vec3(1.0), texture2D(uRoofTex, vDW.xz / 3.0).rgb / uRoofAvg, w * 0.6);
}`);
  };
  mat.customProgramCacheKey = () => 'detail-roof';
  mat.needsUpdate = true;
}
