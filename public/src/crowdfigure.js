// 街・園を歩く人の「人形」の形と描き方 (crowd.js が使う。issue #64)。
// 丸みのある体 (カプセル・楕円体) と、肘・膝が曲がる 2 節の腕と脚。全員を 1 つの InstancedMesh にまとめ、動きは頂点シェーダ。
// 髪型・スカート・上着の裾・帽子・リュックなどは「人ごとの style (ビット)」で出し入れする (使わない部品は頂点が 1 点につぶれる)。
// 細かさは 2 段 (near = 近く、far = 遠く)。形は同じで分割数だけ違うので、切り替わっても目立たない。
import * as THREE from 'three';

// 人ごとの style のビット (instance 属性 iAnim.w。シェーダの has(n) が n 番目のビットを見る)
export const STYLE = { skirt: 1, longHair: 2, bag: 4, jacket: 8, hat: 16, shorts: 32, sleeve: 64, stoop: 128, bigHead: 256, whiteShoe: 512 };

// 部品の番号 (aId.w): 0 = いつも出す、1〜5 = style のビット 0〜4 が立っているときだけ、6 = 頭 (bigHead で大きくする)
const FEAT = { skirt: 1, longHair: 2, bag: 3, jacket: 4, hat: 5, head: 6 };
// 色の枠 (aId.x): 0 肌 1 髪 2 上着 3 ズボン 4 くつ 5 すね (shorts なら肌) 6 前腕 (sleeve なら肌)
// 部分 (aId.y): 0 動かない 1 左脚 2 右脚 3 左腕 4 右腕、節 (aId.z): 0 付け根側 1 先の側 (膝・肘から先)
const KNEE_DROP = 0.42, ELBOW_DROP = 0.29;   // 腰から膝まで・肩から肘まで (m)

// 人形の形 (m。足元が原点、+Z が前、高さ約 1.65 m)
export function buildGeometry(near = true) {
  const D = near ? { rad: 7, cap: 2, sw: 8, sh: 5, hw: 10, hh: 6 } : { rad: 5, cap: 1, sw: 6, sh: 3, hw: 6, hh: 4 };
  const pos = [], nor = [], id = [], pivot = [];
  const put = (g, o) => {
    const at = o.at || [0, 0, 0], sc = o.s || [1, 1, 1], pv = o.pv || [0, 0, 0];
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.attributes.position, n = ng.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i) * sc[0] + at[0], p.getY(i) * sc[1] + at[1], p.getZ(i) * sc[2] + at[2]);
      let nx = n.getX(i) / sc[0], ny = n.getY(i) / sc[1], nz = n.getZ(i) / sc[2]; const l = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / l, ny / l, nz / l);
      id.push(o.slot || 0, o.part || 0, o.seg || 0, o.feat || 0);
      pivot.push(pv[0], pv[1], pv[2]);
    }
  };
  const capsule = (r, y0, y1, x, z, o) => put(new THREE.CapsuleGeometry(r, Math.abs(y0 - y1), D.cap, D.rad), { at: [x, (y0 + y1) / 2, z], ...o });
  const ball = (r, w, h, at, s, o) => put(new THREE.SphereGeometry(r, w, h), { at, s, ...o });
  for (const [side, leg, arm] of [[-1, 1, 3], [1, 2, 4]]) {
    const hip = [side * 0.09, 0.88, 0], sho = [side * 0.24, 1.38, 0];
    // 脚: 太もも・すね・くつ
    capsule(0.074, 0.88, 0.88 - KNEE_DROP, side * 0.09, 0, { slot: 3, part: leg, pv: hip });
    capsule(0.057, 0.88 - KNEE_DROP, 0.1, side * 0.09, 0, { slot: 5, part: leg, seg: 1, pv: hip });
    ball(1, D.sw, D.sh, [side * 0.09, 0.055, 0.05], [0.065, 0.055, 0.14], { slot: 4, part: leg, seg: 1, pv: hip });
    // 腕: 上腕・前腕・手
    capsule(0.047, 1.38, 1.38 - ELBOW_DROP, side * 0.24, 0, { slot: 2, part: arm, pv: sho });
    capsule(0.04, 1.38 - ELBOW_DROP, 0.83, side * 0.24, 0, { slot: 6, part: arm, seg: 1, pv: sho });
    ball(0.042, 6, 4, [side * 0.24, 0.78, 0], [1, 1.25, 0.9], { slot: 0, part: arm, seg: 1, pv: sho });
  }
  // 胴: 胸・腰まわり (上着)・骨盤 (ズボン)・首
  ball(1, D.sw, D.sh + 1, [0, 1.24, 0], [0.215, 0.235, 0.125], { slot: 2 });          // 胸 (肩から脇まで)
  ball(1, D.sw, D.sh, [0, 1.02, 0], [0.17, 0.15, 0.11], { slot: 2 });                // 腰まわり
  ball(1, D.sw, D.sh, [0, 0.89, 0], [0.175, 0.11, 0.12], { slot: 3 });               // 骨盤
  put(new THREE.CylinderGeometry(0.042, 0.046, 0.1, D.rad, 1, true), { at: [0, 1.47, 0], slot: 0 });
  // 頭・髪
  ball(1, D.hw, D.hh, [0, 1.57, 0.005], [0.095, 0.115, 0.105], { slot: 0, feat: FEAT.head });
  put(new THREE.SphereGeometry(1, D.hw, D.hh, 0, Math.PI * 2, 0, Math.PI * 0.5), { at: [0, 1.595, -0.018], s: [0.109, 0.128, 0.119], slot: 1, feat: FEAT.head });
  // 選べる部品
  ball(1, D.sw, D.sh, [0, 1.44, -0.075], [0.1, 0.17, 0.075], { slot: 1, feat: FEAT.longHair });                       // 長い髪
  put(new THREE.CylinderGeometry(0.16, 0.255, 0.3, D.rad + 1, 1, true), { at: [0, 0.73, 0], s: [1, 1, 0.9], slot: 3, feat: FEAT.skirt });    // スカート
  ball(1, D.sw, D.sh, [0, 0.9, 0], [0.19, 0.17, 0.135], { slot: 2, feat: FEAT.jacket });                                                     // 上着の裾
  put(new THREE.BoxGeometry(0.25, 0.32, 0.13), { at: [0, 1.21, -0.165], slot: 3, feat: FEAT.bag });                      // リュック
  put(new THREE.SphereGeometry(1, D.hw, D.hh, 0, Math.PI * 2, 0, Math.PI * 0.5), { at: [0, 1.6, 0.0], s: [0.112, 0.085, 0.12], slot: 2, feat: FEAT.hat }); // 帽子
  put(new THREE.CylinderGeometry(0.115, 0.125, 0.015, D.hw, 1), { at: [0, 1.6, 0.075], s: [1, 1, 1], slot: 2, feat: FEAT.hat });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(1), 3));
  g.setAttribute('aId', new THREE.Float32BufferAttribute(id, 4));
  g.setAttribute('aPivot', new THREE.Float32BufferAttribute(pivot, 3));
  return g;
}

const COMMON = `
  attribute vec4 aId; attribute vec3 aPivot;
  attribute vec3 iTop; attribute vec3 iBottom; attribute vec3 iHair; attribute vec3 iSkin;
  attribute vec4 iAnim;   // x = 歩きの位相, y = 振り幅, z = 行動 (0 歩く 1 スマホ 2 立ち話 3 待つ), w = style
  float has(float b) { return mod(floor(iAnim.w / exp2(b) + 0.01), 2.0); }
  vec3 rotX(vec3 v, float t) { float c = cos(t), s = sin(t); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
  // 付け根 (腰・肩) の振り a と、膝・肘の曲がり b (どちらも x 軸まわり。+ は足が後ろへ・手が後ろへ)
  void limb(out float a, out float b) {
    a = 0.0; b = 0.0;
    float pa = aId.y;
    if (pa < 0.5) return;
    float ph = iAnim.x, amp = iAnim.y, mode = iAnim.z;
    float sw = sin(ph) * amp, c = cos(ph);
    if (pa < 2.5) {                                    // 脚: 前へ振り出している間に膝を曲げる
      a = pa < 1.5 ? sw : -sw;
      float fw = pa < 1.5 ? max(0.0, -c) : max(0.0, c);
      b = 0.04 + 0.95 * fw * min(1.0, amp * 1.6);
    } else {                                           // 腕: 前へ振るほど肘が曲がる
      a = pa < 3.5 ? -sw * 0.8 : sw * 0.8;
      b = -(0.18 + 0.75 * max(0.0, -a));
      if (mode > 0.5 && mode < 1.5) { a = -0.55; b = -1.35; }                                              // スマホを見る
      else if (mode > 1.5 && mode < 2.5) { a = (pa < 3.5 ? -1.0 : 1.0) * sw * 1.4 - 0.5; b = -(0.8 + 0.4 * abs(sw)); }   // 立ち話
    }
  }
  vec3 animate(vec3 p0, out float on) {
    vec3 p = p0;
    float a, b; limb(a, b);
    float g = aId.w;
    on = (g > 0.5 && g < 5.5) ? has(g - 1.0) : 1.0;
    if (aId.y > 0.5) {
      if (aId.z > 0.5) { vec3 kn = aPivot - vec3(0.0, aId.y < 2.5 ? ${KNEE_DROP.toFixed(2)} : ${ELBOW_DROP.toFixed(2)}, 0.0); p = rotX(p - kn, b) + kn; }
      p = rotX(p - aPivot, a) + aPivot;
    }
    if (has(7.0) > 0.5) {                                // 背を丸める (高齢者)
      float k = aId.y > 2.5 ? 1.0 : clamp((position.y - 0.88) / 0.5, 0.0, 1.0);
      vec3 hp = vec3(0.0, 0.88, 0.0); p = rotX(p - hp, 0.2 * k) + hp;
    }
    if (g > 5.5 && has(8.0) > 0.5) { vec3 hc = vec3(0.0, 1.5, 0.0); p = (p - hc) * 1.32 + hc; }   // 頭を大きく (子ども)
    return p;
  }`;

// 影用 (customDepthMaterial)。見た目と同じ形・動きで落とす
export function buildDepthMaterial() {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n float on0; transformed = animate(transformed, on0) * on0;');
  };
  m.customProgramCacheKey = () => 'crowd-person-depth';
  return m;
}

export function buildMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON)
      .replace('#include <color_vertex>', `#include <color_vertex>
        float sl = aId.x;
        vec3 shoe = has(9.0) > 0.5 ? vec3(0.9) : vec3(0.13);
        vColor = sl < 0.5 ? iSkin : sl < 1.5 ? iHair : sl < 2.5 ? iTop : sl < 3.5 ? iBottom : sl < 4.5 ? shoe
               : sl < 5.5 ? (has(5.0) > 0.5 ? iSkin : iBottom) : (has(6.0) > 0.5 ? iSkin : iTop);`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        { float na, nb; limb(na, nb); objectNormal = rotX(objectNormal, na + (aId.z > 0.5 ? nb : 0.0)); }`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n float on0; transformed = animate(transformed, on0) * on0;');
  };
  m.customProgramCacheKey = () => 'crowd-person';
  return m;
}

// 種類 (0 学生 1 スーツ 2 私服 3 子ども 4 高齢者) と人 id から、髪型・服の形を決める (同じ人はいつも同じ)
export function styleFor(type, id) {
  let a = (Math.imul(id + 7, 0x9e3779b1) ^ 0x5bd1e995) >>> 0;
  const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const fem = r() < 0.5, S = STYLE;
  let s = 0;
  if (type === 0) {                      // 学生
    if (fem) { s |= S.longHair * (r() < 0.6); s |= S.skirt * (r() < 0.65); } else s |= S.shorts * (r() < 0.15);
    s |= S.bag * (r() < 0.6); s |= S.sleeve * (r() < 0.45);
  } else if (type === 1) {               // スーツ
    s |= S.jacket * (r() < 0.75); s |= S.bag * (r() < 0.2);
    if (fem) { s |= S.longHair * (r() < 0.45); s |= S.skirt * (r() < 0.25); }
  } else if (type === 2) {               // 私服
    if (fem) { s |= S.longHair * (r() < 0.55); s |= S.skirt * (r() < 0.3); } else s |= S.shorts * (r() < 0.25);
    s |= S.bag * (r() < 0.2); s |= S.hat * (r() < 0.15); s |= S.sleeve * (r() < 0.4);
  } else if (type === 3) {               // 子ども
    s |= S.bigHead | S.bag * (r() < 0.5) | S.hat * (r() < 0.25) | S.sleeve * (r() < 0.6);
    if (fem) s |= S.skirt * (r() < 0.4); else s |= S.shorts * (r() < 0.5);
  } else {                               // 高齢者
    s |= S.stoop | S.hat * (r() < 0.3) | S.jacket * (r() < 0.4);
    if (fem) s |= S.longHair * (r() < 0.1);
  }
  if (s & S.skirt) s |= S.shorts;        // スカートのときは足首まで肌 (ズボンの色にしない)
  s |= S.whiteShoe * (r() < (type === 2 || type === 3 ? 0.5 : 0.2));
  return s;
}

// 1 段 (細かさ) ぶんの InstancedMesh と、その instance 属性。put(i, matrix, colors, phase, amp, mode, style)
export function createTier(cap, near, shadow) {
  const geo = buildGeometry(near);
  const attr = (n, size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(n, a); return a; };
  const A = { top: attr('iTop', 3), bottom: attr('iBottom', 3), hair: attr('iHair', 3), skin: attr('iSkin', 3), anim: attr('iAnim', 4) };
  const mesh = new THREE.InstancedMesh(geo, buildMaterial(), cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = shadow;
  mesh.customDepthMaterial = buildDepthMaterial();
  mesh.count = 0;
  return {
    mesh, A, cap,
    put(i, m, cc, phase, amp, mode, style) {
      mesh.setMatrixAt(i, m);
      A.top.setXYZ(i, cc[0].r, cc[0].g, cc[0].b); A.bottom.setXYZ(i, cc[1].r, cc[1].g, cc[1].b);
      A.hair.setXYZ(i, cc[2].r, cc[2].g, cc[2].b); A.skin.setXYZ(i, cc[3].r, cc[3].g, cc[3].b);
      A.anim.setXYZW(i, phase, amp, mode, style);
    },
    finish(n) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      for (const k in A) A[k].needsUpdate = true;
    },
    dispose() { mesh.geometry.dispose(); mesh.material.dispose(); mesh.customDepthMaterial.dispose(); },
  };
}
