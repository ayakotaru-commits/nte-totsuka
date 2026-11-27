// キャラクター (関節つきの人型 + トゥーン + アウトライン)。
// 骨格: hips → spine → chest → (neck → head / 左右の肩 → 肘 → 手) と hips → 左右の (股関節 → 膝 → 足首)。
// 歩き・走りは「足が着地している間は地面から浮かない・めり込まない」ように、
// 股関節の高さを脚の角度から毎フレーム計算して決める (本物の歩行の上下動はこれで自然に出る)。
// public/models/player.vrm があれば、その VRM キャラに差し替える (動きの角度は同じものを VRM の人型ボーンへ渡す)。
// 無い・読めないときは、下で作る組み立て式のキャラのまま動く。
import * as THREE from 'three';
import { shrinkTextures } from './lowmem.js';
import { samplePose, trailOn, LEGS, LEGS_UNTIL, TRAIL_STYLE, FX, TWIRL, MOCAP } from './attack.js';
import { sampleMotion, loadMotion, getMotion } from './motion.js';
import { Outfitter } from './outfit.js';
import { Hairdresser } from './hair.js';
import { Eyedresser } from './eyes.js';

// 歩き・走り・待機・空中・着地を、動きのデータ (Quaternius の Universal Animation Library、CC0) で動かす。
// URL に ?handmade で、以前の手作りの動きに戻す。階段は手作りのまま (データに階段の動きが無いため)
const DATA_ON = typeof location === 'undefined' || !new URLSearchParams(location.search).has('handmade');
const LOCO = { idle: 'ual_idle', walk: 'ual_walk', jog: 'ual_jog', sprint: 'ual_sprint', start: 'ual_jump_start', loop: 'ual_jump_loop', land: 'ual_jump_land' };
// データの「進む速さ」の補正 (人形とこのキャラの脚の長さの比が違うため)。地面に着いた足が滑らないよう、
// 足の速さを測って合わせた (足が後ろへ滑る = 速さを大きく)
const LOCO_K = { walk: 1.36, jog: 1, sprint: 1.35 };
// 前転 (高い所からの着地。player.js の ROLL) は ?handmade でも使う (手作りの前転は無い)
const locoLoading = Promise.all([...(DATA_ON ? Object.values(LOCO) : []), 'ual_roll'].map(loadMotion));

const PI = Math.PI;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// 体の寸法 (m)。身長 約 1.7 m
const THIGH = 0.41, SHIN = 0.41, ANKLE_H = 0.08, HIP_DROP = 0.04;
const IDLE_EXT = THIGH + SHIN + ANKLE_H; // 立っているときの、股関節から足裏までの距離

function gradientMap() {
  const data = new Uint8Array([90, 170, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

// VRM のファイルの取得と解読 (形を組み立てる前まで)。main.js がページを開いた直後に preloadVRM() で始めておき、
// 街を作っている間に済ませる (以前は街の生成の後に始まり、開始直後は組み立て式のキャラが出てから差し替わっていた)。
// 先読みした結果は 1 回だけ使う (2 体目からは読み直す。同じ形を 2 か所に置けないため)
const VRM_URL = new URL('../models/player.vrm', import.meta.url).href;
let vrmPreload = null;
async function fetchVRM(url) {
  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok) return null;
  const [{ GLTFLoader }, { VRMLoaderPlugin }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'), import('@pixiv/three-vrm'),
  ]);
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  return loader.loadAsync(url);
}
export function preloadVRM() {
  if (!vrmPreload) { vrmPreload = fetchVRM(VRM_URL); vrmPreload.catch(() => {}); }
  return vrmPreload;
}
function takeVRM(url) {
  if (url === VRM_URL && vrmPreload) { const p = vrmPreload; vrmPreload = false; return p; }
  return fetchVRM(url);
}

// opt.vrm = false で VRM を読まない (ほかのプレイヤー用。軽い組み立て式のまま)。opt.colors = { jacket, accent, hair } で服の色を変える
export function makeCharacter(opt = {}) {
  const gm = gradientMap();
  // 暗所でも見えるよう、色の一部を自己発光させる (アニメ調の見え方)
  const toon = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: gm, emissive: new THREE.Color(c).multiplyScalar(0.22) });
  const COL = { hair: '#3a2a36', jacket: '#26324d', accent: '#5fd3ff', ...opt.colors };
  const M = {
    skin: toon('#f6d9c6'), hair: toon(COL.hair), jacket: toon(COL.jacket), accent: toon(COL.accent),
    shirt: toon('#f2f2f2'), pants: toon('#23252c'), shoe: toon('#f4f4f4'), eye: toon('#3a2e5a'),
    white: toon('#ffffff'),
  };
  const outlineMat = new THREE.MeshBasicMaterial({ color: '#15151d', side: THREE.BackSide });

  // 形を 1 つ作る (輪郭線つき)。size は輪郭線の太さの目安に使う代表半径
  const shape = (geo, mat, pos, size = 0.05, outline = true, scale) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    if (scale) m.scale.set(...scale);
    m.castShadow = true;
    if (outline) {
      const o = new THREE.Mesh(geo, outlineMat);
      o.scale.setScalar(1 + 0.005 / size);
      m.add(o);
    }
    return m;
  };
  const ball = (r, mat, pos, scale, outline = true) => shape(new THREE.SphereGeometry(r, 18, 14), mat, pos, r, outline, scale);
  // 親の関節から真下 (-y) へ len だけ伸びる、先細りの筒
  const tube = (len, rTop, rBot, mat) => shape(new THREE.CylinderGeometry(rTop, rBot, len, 14, 1), mat, [0, -len / 2, 0], Math.min(rTop, rBot));
  const joint = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

  const root = new THREE.Group();
  const body = new THREE.Group(); // 旋回のかたむき用 (足元が支点)
  root.add(body);

  // ---- 骨 ----
  const hips = joint(body, 0, IDLE_EXT + HIP_DROP, 0);
  const spine = joint(hips, 0, 0.08, 0);
  const chest = joint(spine, 0, 0.18, 0);
  const neck = joint(chest, 0, 0.22, 0);
  const head = joint(neck, 0, 0.07, 0);

  // 骨盤・腰・胸
  hips.add(ball(0.12, M.pants, [0, 0.0, 0], [1.3, 0.9, 0.9]));
  hips.add(shape(new THREE.CylinderGeometry(0.128, 0.128, 0.03, 20), M.accent, [0, 0.05, 0], 0.1, false, [1, 1, 0.78]));
  spine.add(shape(new THREE.CylinderGeometry(0.125, 0.14, 0.2, 18), M.jacket, [0, 0.0, 0], 0.12, true, [1, 1, 0.78]));
  chest.add(ball(0.15, M.jacket, [0, 0.1, 0], [1.08, 1.2, 0.74]));
  const collar = shape(new THREE.ConeGeometry(0.07, 0.15, 3), M.shirt, [0, 0.2, 0.1], 0.05, false, [1, 1, 0.3]);
  collar.rotation.set(-0.15, 0, PI);
  chest.add(collar);
  neck.add(shape(new THREE.CylinderGeometry(0.04, 0.045, 0.12, 12), M.skin, [0, 0.03, 0], 0.04, false));

  // 頭 (原点は首のつけ根。顔は +z)
  const HC = 0.115; // 頭の中心の高さ
  head.add(ball(0.112, M.skin, [0, HC, 0], [0.92, 1.05, 0.98]));
  head.add(ball(0.13, M.hair, [0, HC + 0.045, -0.03]));
  head.add(ball(0.065, M.hair, [0, HC + 0.075, 0.075], [1.55, 0.6, 0.75], false)); // 前髪
  for (const s of [-1, 1]) {
    const white = ball(0.026, M.white, [0.042 * s, HC - 0.012, 0.099], [1, 1.45, 0.45], false);
    const iris = ball(0.018, M.eye, [0.042 * s, HC - 0.014, 0.106], [1, 1.5, 0.4], false);
    const shine = ball(0.006, M.white, [0.047 * s, HC - 0.004, 0.112], [1, 1, 0.5], false);
    head.add(white, iris, shine);
  }
  // ポニーテール (2 節。ばねで揺らす)
  const tail1 = joint(head, 0, HC + 0.05, -0.13);
  tail1.add(shape(new THREE.CapsuleGeometry(0.04, 0.1, 4, 8), M.hair, [0, -0.07, 0], 0.04));
  const tail2 = joint(tail1, 0, -0.15, 0);
  tail2.add(shape(new THREE.CapsuleGeometry(0.032, 0.12, 4, 8), M.hair, [0, -0.07, 0], 0.032));

  // 腕 (side: +1 = キャラの左 (x+), -1 = 右)
  const makeArm = (side) => {
    const sh = joint(chest, 0.185 * side, 0.16, 0);
    sh.add(ball(0.047, M.jacket, [0, 0, 0]));
    sh.add(tube(0.27, 0.046, 0.04, M.jacket)); // 上腕 (袖)
    const el = joint(sh, 0, -0.27, 0);
    el.add(ball(0.04, M.jacket, [0, 0, 0], undefined, false));
    el.add(tube(0.24, 0.037, 0.03, M.skin)); // 前腕 (袖まくり)
    const hand = joint(el, 0, -0.25, 0);
    hand.add(ball(0.037, M.skin, [0, -0.025, 0.005], [0.8, 1.15, 0.9]));
    return { sh, el, hand };
  };
  // 脚
  const makeLeg = (side) => {
    const th = joint(hips, 0.095 * side, -HIP_DROP, 0);
    th.add(ball(0.088, M.pants, [0, 0, 0], undefined, false));
    th.add(tube(THIGH, 0.092, 0.064, M.pants)); // 太もも
    const kn = joint(th, 0, -THIGH, 0);
    kn.add(ball(0.065, M.pants, [0, 0, 0], undefined, false));
    kn.add(tube(SHIN, 0.064, 0.047, M.pants)); // すね
    const ft = joint(kn, 0, -SHIN, 0);
    ft.add(ball(0.052, M.pants, [0, 0, 0], undefined, false));
    const shoe = shape(new THREE.CapsuleGeometry(0.05, 0.13, 4, 10), M.shoe, [0, -0.04, 0.05], 0.05, true, [1, 1, 0.8]);
    shoe.rotation.x = PI / 2; // カプセルを前後 (z) に寝かせる
    ft.add(shoe);
    ft.add(shape(new THREE.BoxGeometry(0.1, 0.012, 0.3), M.accent, [0, -0.077, 0.045], 0.05, false)); // 靴底のライン
    return { th, kn, ft };
  };
  const arms = [makeArm(1), makeArm(-1)];
  const legs = [makeLeg(1), makeLeg(-1)];

  // ---- 動き ----
  // 角度の目標をいったん書き出し、地上・空中の 2 つを混ぜてから骨に反映する
  const NAMES = ['hips', 'spine', 'chest', 'neck', 'head', 'shL', 'elL', 'haL', 'shR', 'elR', 'haR', 'thL', 'knL', 'ftL', 'thR', 'knR', 'ftR'];
  const BONE = { hips, spine, chest, neck, head, shL: arms[0].sh, elL: arms[0].el, haL: arms[0].hand, shR: arms[1].sh, elR: arms[1].el, haR: arms[1].hand,
    thL: legs[0].th, knL: legs[0].kn, ftL: legs[0].ft, thR: legs[1].th, knR: legs[1].kn, ftR: legs[1].ft };
  const pose = () => { const p = {}; for (const n of NAMES) p[n] = [0, 0, 0]; return p; };

  const st = {
    t: 0, phase: 0, gw: 0, airW: 0, land: 0, lastVy: 0, wasAir: false, prevSpeed: 0, lastHipsY: IDLE_EXT + HIP_DROP,
    lastYaw: 0, roll: 0, stair: 0, a1: 0.35, v1: 0, a2: 0.15, v2: 0, sword: 0, trail: false, atkId: -1, atkFrom: null, atkLast: null, atkP: null,
    actW: 0, actPose: null, anchor: null,
  };

  // ---- パルクール (player.js が渡す act = { type, s, ly, lz }) ----
  //   s: 進み具合 0〜1、ly: 足元から見た縁の高さ、lz: 体の中心から縁までの前方向の距離 (越えた後は負)
  // 腕は、肩から縁へ届くように 2 本の骨の角度を計算で決める (体の前後の面の中だけ)。
  // 残った高さのずれは、手が縁の高さに来るよう腰の高さを動かして合わせる (st.anchor → applyAnchor)
  let SH_UP = 0.42, ARM_A = 0.27, ARM_B = 0.26; // 腰から肩までの高さ、上腕・前腕の長さ (VRM を読み込んだら、そのモデルの寸法に置き換える)
  // 肩から (前 dz, 上 dy) にある点へ手を伸ばす。pitch = 胴の前傾。返り値は [上腕の x 回転, 肘の x 回転]
  function reach(dz, dy, pitch) {
    const d = clamp(Math.hypot(dz, dy), 0.14, ARM_A + ARM_B - 0.004);
    const dirA = Math.atan2(dz, -dy); // 0 = 真下、π/2 = 前、π = 真上
    const beta = Math.acos(clamp((ARM_A * ARM_A + d * d - ARM_B * ARM_B) / (2 * ARM_A * d), -1, 1));
    const gamma = Math.acos(clamp((ARM_A * ARM_A + ARM_B * ARM_B - d * d) / (2 * ARM_A * ARM_B), -1, 1));
    return [-(dirA - beta) - pitch, -(PI - gamma)];
  }
  // ---- 攻撃 (attack.js の姿勢の表 → 骨の角度) ----
  // 腕は、肩から見た手の位置 (胸の座標系) から 2 関節の IK で解く。肩の回転は 3 軸のオイラー角にすると腕を高く上げたときに
  // 不連続になるので、クォータニオンのまま骨へ渡す (X.q)。肘は 1 軸 (前へ曲がる) なのでオイラー角のまま
  const _v = new THREE.Vector3(), _al = new THREE.Vector3(), _pl = new THREE.Vector3(), _du = new THREE.Vector3(), _fo = new THREE.Vector3();
  const _gv = new THREE.Vector3(), _ax = new THREE.Vector3(), _ay = new THREE.Vector3(), _m4 = new THREE.Matrix4();
  const POLE = { 1: new THREE.Vector3(0.5, -0.7, -0.5), '-1': new THREE.Vector3(-0.5, -0.7, -0.5) }; // 肘が向く側 (外・下・後ろ)
  function armIK(tx, ty, tz, side, out) {
    _v.set(tx, ty, tz);
    const d = clamp(_v.length(), 0.12, ARM_A + ARM_B - 0.004);
    if (_v.lengthSq() < 1e-8) _v.set(0, -1, 0);
    _al.copy(_v).normalize();
    const cb = clamp((ARM_A * ARM_A + d * d - ARM_B * ARM_B) / (2 * ARM_A * d), -1, 1), sb = Math.sqrt(1 - cb * cb);
    _pl.copy(POLE[side]); _pl.addScaledVector(_al, -_pl.dot(_al));
    if (_pl.lengthSq() < 1e-6) _pl.set(0, 0, -1).addScaledVector(_al, _al.z);
    _pl.normalize();
    _du.copy(_al).multiplyScalar(cb).addScaledVector(_pl, sb);          // 上腕の向き
    _fo.copy(_al).multiplyScalar(d).addScaledVector(_du, -ARM_A).normalize(); // 前腕の向き
    const cf = clamp(_du.dot(_fo), -1, 1);
    _gv.copy(_fo).addScaledVector(_du, -cf);                              // 前腕が上腕からそれる向き (= 腕の局所 +Z)
    if (_gv.lengthSq() < 1e-8) _gv.copy(_pl).negate();
    _gv.normalize();
    _ay.copy(_du).negate();                                               // 局所 +Y = 上腕の反対
    _ax.crossVectors(_ay, _gv);                                           // 局所 +X
    _m4.makeBasis(_ax, _ay, _gv);
    out.setFromRotationMatrix(_m4);
    return Math.acos(cf);
  }
  const _eu = new THREE.Euler(), _qn = new THREE.Quaternion();
  const atkQ = { shL: new THREE.Quaternion(), shR: new THREE.Quaternion() };
  function atkPose(act) {
    // 動きのデータを使う手順 (attack.js の MOCAP): データの骨の向きをそのまま渡す。読み込み前は手作りの姿勢
    const mc = MOCAP[act.step + ':' + act.ph];
    if (mc) {
      const m = sampleMotion(mc.clip, act.t * mc.speed, st.mo || (st.mo = {}), !!mc.mirror);
      if (m) { const X = pose(); X.q = m.q; st.hipOff = m.hips; st.atkId = -1; st.atkLast = null; return X; }
    }
    const X = pose();
    st.atkP = samplePose(act.step, act.ph, act.t);
    // 前の手順の姿勢からなめらかにつなぐ (手順が変わった直後の短い間)
    const id = act.step * 10 + act.ph;
    if (st.atkId !== id) { st.atkId = id; st.atkFrom = st.atkLast ? st.atkLast.slice() : null; }
    const P = st.atkP;
    if (st.atkFrom) { const w = sstep(0, 0.1, act.t); for (let i = 0; i < P.length; i++) P[i] = st.atkFrom[i] + (P[i] - st.atkFrom[i]) * w; }
    st.atkLast = P;
    const [Hy, Cy, Lean, Roll, Lx, Ly, Lz, Rx, Ry, Rz, Stance, Crouch, LegYaw] = P;
    const lk = act.step + ':' + act.ph;
    const legMode = LEGS_UNTIL[lk] !== undefined && act.t > LEGS_UNTIL[lk] ? 0 : LEGS[lk] || 0;
    // 胴: 腰が回り、残りを背骨と胸が回す。頭は半分だけついていく
    X.hips = [Lean * (legMode === 2 ? 0.5 : 0.2), Hy, Roll * 0.5];
    X.spine = [Lean * 0.4, (Cy - Hy) * 0.4, Roll * 0.25];
    X.chest = [Lean * 0.6, (Cy - Hy) * 0.6, Roll * 0.25];
    X.neck = [-Lean * 0.3, -Cy * 0.25, 0]; X.head = [-Lean * 0.4, -Cy * 0.25, 0];
    // 腕
    const fl = armIK(Lx, Ly, Lz, 1, atkQ.shL), fr = armIK(Rx, Ry, Rz, -1, atkQ.shR);
    X.q = atkQ;
    X.shL = [0, 0, 0]; X.shR = [0, 0, 0];
    X.elL = [-fl, 0, 0]; X.elR = [-fr, 0, 0];
    X.haL = [0, 0, 0.15]; X.haR = [0, 0, -0.15];
    // 脚。足は地面に対して平らに着ける (足首 = -(太もも + 膝))。腰をひねっても足先は向きを保つ
    // (脚の向き LegYaw が 1 に近いほど、脚ごと腰の向きへ回る)
    const legYaw = -Hy * 0.9 * (1 - (LegYaw || 0));
    const leg = (th, kn, ft, side, tx, kx, fx) => {
      X[th] = [tx, legYaw, side * 0.09]; X[kn] = [kx, 0, 0]; X[ft] = [fx === undefined ? -(tx + kx) : fx, 0, 0];
    };
    if (legMode === 1) { leg('thL', 'knL', 'ftL', 1, -0.9, 1.3, 0.3); leg('thR', 'knR', 'ftR', -1, -0.55, 1.5, 0.4); } // 膝を抱える
    else if (legMode === 2) { leg('thL', 'knL', 'ftL', 1, 0.35, 0.5, 0.7); leg('thR', 'knR', 'ftR', -1, 0.5, 0.35, 0.7); } // 脚を後ろへ流す
    else if (legMode === 3) { // 滑る: 左脚を前へ伸ばし、右膝を折る
      leg('thL', 'knL', 'ftL', 1, -1.3, 0.05); leg('thR', 'knR', 'ftR', -1, 0.1, 2.0, 0.4); X.thR[2] = -0.2;
    } else {
      const a = Math.abs(Stance), lead = Stance >= 0 ? 'L' : 'R', back = Stance >= 0 ? 'R' : 'L', sg = (c) => c === 'L' ? 1 : -1;
      // しゃがみが 1 を超えた分 (〜1.3) は片膝立ちへ寄せる: 前の脚はすねを立て、後ろの脚は膝を地面近くへ
      const kn = clamp((Crouch - 1) / 0.3, 0, 1), c = Math.min(1, Crouch);
      leg('th' + lead, 'kn' + lead, 'ft' + lead, sg(lead), mix(-(0.1 + 0.6 * a + 0.35 * c), -1.55, kn), mix(0.1 + 0.55 * a + 0.5 * c, 1.6, kn));
      leg('th' + back, 'kn' + back, 'ft' + back, sg(back), mix(0.05 + 0.4 * a, -0.25, kn), mix(0.2 + 0.4 * a + 0.7 * c, 1.7, kn));
      X['th' + back][2] = sg(back) * 0.14; // 後ろ足は少し外へ開く
    }
    return X;
  }

  // ---- 剣 (握った手の先に出る。攻撃しなくなって少しすると消える) ----
  const bladeMats = [new THREE.MeshBasicMaterial({ color: '#c9f2ff' }), new THREE.MeshBasicMaterial({ color: '#e6d6ff' })];
  const trailCols = [[0.45, 0.88, 1.0], [0.72, 0.6, 1.0]]; // 左 (水色)・右 (薄紫)
  const swords = [0, 1].map((i) => {
    const g = new THREE.Group(), blade = new THREE.Group();
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.78, 0.014), bladeMats[i]);
    bl.position.y = 0.06 + 0.39; blade.add(bl);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0, 0.025, 0.1, 4), bladeMats[i]);
    tip.scale.z = 0.28; tip.position.y = 0.06 + 0.78 + 0.05; blade.add(tip);
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.74, 0.02), M.accent); // 刃の芯 (水色)
    line.position.y = 0.06 + 0.37; blade.add(line);
    g.add(blade);
    g.add(shape(new THREE.BoxGeometry(0.15, 0.022, 0.04), M.jacket, [0, 0.05, 0], 0.02, true));   // つば
    g.add(shape(new THREE.CylinderGeometry(0.02, 0.02, 0.15, 8), M.pants, [0, -0.03, 0], 0.02, true)); // 柄
    g.add(shape(new THREE.SphereGeometry(0.03, 8, 6), M.accent, [0, -0.11, 0], 0.03, false));          // 柄頭
    // 伝説のうな○ー刀 (うな○ー大量発生クエストのごほうび) にしたときだけ見える、刃の水玉
    const dots = new THREE.Group();
    [['#f2789f', 0.2], ['#f6d34a', 0.36], ['#7cc4ea', 0.52], ['#e8434f', 0.66], ['#9ccc3c', 0.78]].forEach(([c, y], k) => {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.024, 10).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: c }));
      d.position.set(k % 2 ? 0.008 : -0.008, 0.06 + y, 0); dots.add(d);
    });
    dots.visible = false; blade.add(dots);
    g.visible = false; root.add(g);
    return { g, blade, dots, bl, tip, line };
  });
  // 伝説のうな○ー刀に持ち替える (金色に光る刃・水玉・金色の軌跡)。on = false で元の剣に戻す
  const BLADE0 = bladeMats.map((m) => m.color.clone()), TRAIL0 = trailCols.map((c) => c.slice());
  const setLegend = (on) => {
    bladeMats.forEach((m, i) => m.color.copy(on ? new THREE.Color('#ffd84a') : BLADE0[i]));
    trailCols.forEach((c, i) => c.splice(0, 3, ...(on ? [1.0, 0.8, 0.25] : TRAIL0[i])));
    for (const sw of swords) { sw.dots.visible = on; sw.bl.scale.x = on ? 1.7 : 1; sw.tip.scale.x = on ? 1.7 : 1; sw.line.visible = !on; } // 金の刃は少し幅広に。水色の芯は消す (緑がかって見えるため)
    for (const sw of swords) sw.g.userData.legend = on;
  };
  // うちわ (お札まきのイベントで右手に持つ。act.type === 'fan' の間だけ見える)
  const fan = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    c.fillStyle = '#fbf6ea'; c.beginPath(); c.arc(32, 32, 31, 0, 7); c.fill();
    c.strokeStyle = 'rgba(150,120,80,.35)'; c.lineWidth = 1.2;
    for (let a = -1.2; a <= 1.21; a += 0.3) { c.beginPath(); c.moveTo(32, 62); c.lineTo(32 + Math.sin(a) * 30, 32 - Math.cos(a) * 30); c.stroke(); }
    c.fillStyle = '#c8282e'; c.beginPath(); c.arc(32, 30, 13, 0, 7); c.fill();
    c.strokeStyle = '#c8282e'; c.lineWidth = 3; c.beginPath(); c.arc(32, 32, 29.5, 0, 7); c.stroke();
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), new THREE.MeshToonMaterial({ map: tex, gradientMap: gm, side: THREE.DoubleSide }));
    face.position.y = 0.27; g.add(face);
    g.add(shape(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 6), M.hair, [0, 0.07, 0], 0.012, true)); // 柄
    g.visible = false; root.add(g);
    return g;
  })();
  function updateFan(act) {
    fan.visible = !!act && act.type === 'fan';
    if (!fan.visible) return;
    root.updateMatrixWorld(true);
    const J = vrmRig && vrmRig.nodes.haR ? vrmRig.nodes : BONE;
    J.haR.getWorldPosition(_hp); J.elR.getWorldPosition(_ep);
    root.worldToLocal(_hp); root.worldToLocal(_ep);
    _dir.subVectors(_hp, _ep).normalize();
    fan.position.copy(_hp).addScaledVector(_dir, 0.04);
    fan.quaternion.setFromUnitVectors(YAX, _dir);
  }
  // 軌跡: 刃の先と根もとの世界座標を残し、古いものほど薄くするリボン
  const TRAIL_LIFE = 0.18, TRAIL_MAX = 56;
  const fx = new THREE.Group(); fx.frustumCulled = false;
  const trails = [0, 1].map((i) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 2 * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 2 * 4), 4));
    const idx = []; for (let k = 0; k < TRAIL_MAX - 1; k++) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
    geo.setIndex(idx); geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
    mesh.frustumCulled = false; fx.add(mesh);
    return { geo, samples: [] };
  });
  const _hp = new THREE.Vector3(), _ep = new THREE.Vector3(), _dir = new THREE.Vector3(), _qs = new THREE.Quaternion(), _o = new THREE.Vector3(), _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();
  function updateSwords(dt, armed, trailing, style) {
    const life = style ? style.life : TRAIL_LIFE, alpha = style ? style.alpha : 0.5;
    const t0 = style ? style.from : 0.2, t1 = style ? style.to : 0.88;
    if (!fx.parent && root.parent) root.parent.add(fx);
    st.sword = clamp(st.sword + (armed ? dt / 0.14 : -dt / 0.28), 0, 1);
    const S = st.sword;
    root.updateMatrixWorld(true);
    const J = vrmRig && vrmRig.nodes.haL ? vrmRig.nodes : BONE;
    for (let i = 0; i < 2; i++) {
      const sw = swords[i], tr = trails[i], hand = i === 0 ? J.haL : J.haR, elb = i === 0 ? J.elL : J.elR;
      sw.g.visible = S > 0.001;
      if (sw.g.visible) {
        hand.getWorldPosition(_hp); elb.getWorldPosition(_ep);
        root.worldToLocal(_hp); root.worldToLocal(_ep);
        _dir.subVectors(_hp, _ep).normalize();
        _o.copy(_hp).addScaledVector(_dir, 0.05);
        sw.g.position.copy(_o);
        sw.g.quaternion.setFromUnitVectors(YAX, _dir);
        if (st.twirl > 0 && st.twirl < 2 * PI) sw.g.quaternion.multiply(_qs.setFromAxisAngle(XAX, i === 0 ? st.twirl : -st.twirl)); // 手首の向きの軸でまわす
        const e = sstep(0, 1, S);
        sw.blade.scale.set(1 + 2.5 * (1 - e), e, 1 + 2.5 * (1 - e)); // 出るときは、短く太い光が伸びる
        if (trailing) { // 刃の先と根もとを世界座標で残す
          _t1.copy(_o).addScaledVector(_dir, t1); _t2.copy(_o).addScaledVector(_dir, t0);
          root.localToWorld(_t1); root.localToWorld(_t2);
          tr.samples.unshift({ a: _t1.clone(), b: _t2.clone(), age: 0, life, alpha });
        }
      }
      // 古いものを消し、頂点を作り直す
      for (const sm of tr.samples) sm.age += dt;
      while (tr.samples.length && (tr.samples[tr.samples.length - 1].age > tr.samples[tr.samples.length - 1].life || tr.samples.length > TRAIL_MAX)) tr.samples.pop();
      const n = tr.samples.length, pos = tr.geo.attributes.position.array, col = tr.geo.attributes.color.array, c = trailCols[i];
      for (let k = 0; k < n; k++) {
        const sm = tr.samples[k], al = Math.pow(Math.max(0, 1 - sm.age / sm.life), 1.6) * sm.alpha;
        pos.set([sm.a.x, sm.a.y, sm.a.z, sm.b.x, sm.b.y, sm.b.z], k * 6);
        col.set([c[0], c[1], c[2], al, c[0], c[1], c[2], al * (sm.alpha > 0.5 ? 0.25 : 0.08)], k * 8);
      }
      tr.geo.attributes.position.needsUpdate = true; tr.geo.attributes.color.needsUpdate = true;
      tr.geo.setDrawRange(0, Math.max(0, n - 1) * 6);
    }
  }

  // ---- 攻撃の演出 (attack.js の FX): 土ぼこり (ぼかした丸の板)・十字の閃光・地面に広がる衝撃の輪 ----
  const DUST_N = 48;
  let dustTex = null, dustNext = 0, crossFx = null, shockFx = null;
  const dusts = [];
  function dustTexture() {
    if (dustTex) return dustTex;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    dustTex = new THREE.CanvasTexture(c); dustTex.colorSpace = THREE.SRGBColorSpace;
    return dustTex;
  }
  const _fp = new THREE.Vector3(), _fw = new THREE.Vector3(), _fq = new THREE.Quaternion(), _fd = new THREE.Vector3();
  // (cx, cz) のまわりに n 個。v = 外へ飛ぶ速さ、size = 大きさ、life = 消えるまでの秒数、r0 = 出る位置の半径
  function spawnDust(cx, cy, cz, n, v, size, life, r0 = 0.12) {
    if (!dusts.length) {
      for (let i = 0; i < DUST_N; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTexture(), color: '#9a8f80', transparent: true, depthWrite: false, opacity: 0 }));
        sp.visible = false; sp.frustumCulled = false; fx.add(sp);
        dusts.push({ sp, age: 1, life: 1, vx: 0, vy: 0, vz: 0, s0: 0 });
      }
    }
    for (let i = 0; i < n; i++) {
      const d = dusts[dustNext]; dustNext = (dustNext + 1) % DUST_N;
      const a = (i / n) * PI * 2 + Math.random() * 0.4, sp = v * (0.6 + Math.random() * 0.8);
      d.age = Math.random() * 0.06; d.life = life; d.vx = Math.cos(a) * sp; d.vz = Math.sin(a) * sp; d.vy = 0.6 + Math.random() * 0.9;
      d.s0 = size * (0.8 + Math.random() * 0.6);
      d.sp.position.set(cx + Math.cos(a) * r0, cy, cz + Math.sin(a) * r0);
      d.sp.visible = true;
    }
  }
  // 地面に寝かせた光の板 (衝撃の輪) と、胸の前の X 形の光 (十字の閃光)。最初に使うときに作る
  function makeFlash() {
    const mat = () => new THREE.MeshBasicMaterial({ color: '#dff4ff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
    const g = new THREE.Group(), m = mat(), m2 = mat(); // m = 細い芯、m2 = まわりのぼんやりした光
    for (const r of [PI / 4, -PI / 4]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.06), m); bar.rotation.z = r; g.add(bar);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.2), m2); glow.rotation.z = r; g.add(glow);
    }
    g.visible = false; g.frustumCulled = false; fx.add(g);
    crossFx = { g, m, m2, age: 1 };
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 56), mat());
    ring.rotation.x = -PI / 2; ring.visible = false; ring.frustumCulled = false; fx.add(ring);
    shockFx = { ring, age: 1 };
  }
  function runFx(kind, arg) {
    if (!root.parent || typeof document === 'undefined') return;
    if (!crossFx) makeFlash();
    root.updateMatrixWorld(true);
    root.getWorldPosition(_fw);
    const gy = _fw.y + 0.05; // 地面の高さ (キャラの足元)
    if (kind === 'dust') {
      const J = vrmRig && vrmRig.nodes.ftL ? vrmRig.nodes : BONE;
      (arg === 'L' ? J.ftL : J.ftR).getWorldPosition(_fp);
      spawnDust(_fp.x, gy, _fp.z, 14, 1.9, 0.25, 0.7);
    } else if (kind === 'ring') { // 体のまわりに輪の形に広がる
      spawnDust(_fw.x, gy, _fw.z, Math.round(14 + 8 * arg), 2.2 * arg, 0.24 + 0.06 * arg, 0.7 + 0.15 * arg, 0.35);
    } else if (kind === 'puff') { // 滑っている体の後ろ
      root.getWorldQuaternion(_fq); _fd.set(0, 0, -0.5).applyQuaternion(_fq);
      spawnDust(_fw.x + _fd.x, gy, _fw.z + _fd.z, 4, 0.6, 0.22, 0.6, 0.15);
    } else if (kind === 'cross') { // 胸の前
      root.getWorldQuaternion(_fq); _fd.set(0, 1.0, 1.0).applyQuaternion(_fq);
      crossFx.g.position.set(_fw.x + _fd.x, _fw.y + _fd.y, _fw.z + _fd.z);
      crossFx.g.quaternion.copy(_fq); crossFx.age = 0; crossFx.g.visible = true;
    } else if (kind === 'shock') {
      shockFx.ring.position.set(_fw.x, gy + 0.03, _fw.z); shockFx.age = 0; shockFx.ring.visible = true;
    }
  }
  function updateFx(dt, act) {
    // 決めた時間をまたいだら 1 回だけ出す (同じ局面で 2 回出さない。時間が戻ったら別の一振り)
    const key = act && act.type === 'atk' ? act.step + ':' + act.ph : null, L = key && FX[key];
    if (st.fxKey !== key || (act && act.t < st.fxT)) st.fxDone = 0;
    if (L) L.forEach(([t0, kind, arg], i) => { if (!(st.fxDone & (1 << i)) && act.t >= t0) { st.fxDone |= 1 << i; runFx(kind, arg); } });
    st.fxKey = key; st.fxT = act ? act.t : 0;
    for (const d of dusts) {
      if (!d.sp.visible) continue;
      d.age += dt;
      if (d.age >= d.life) { d.sp.visible = false; continue; }
      const k = Math.exp(-4 * dt);
      d.vx *= k; d.vz *= k; d.vy *= Math.exp(-2 * dt);
      d.sp.position.x += d.vx * dt; d.sp.position.y += d.vy * dt; d.sp.position.z += d.vz * dt;
      const u = d.age / d.life;
      d.sp.scale.setScalar(d.s0 * (1 + 1.8 * Math.sqrt(u)));
      d.sp.material.opacity = 0.5 * Math.min(1, u * 8) * (1 - u) * (1 - u);
    }
    if (crossFx && crossFx.g.visible) { // 0.35 秒で広がりながら消える
      crossFx.age += dt; const u = crossFx.age / 0.35;
      if (u >= 1) crossFx.g.visible = false;
      else { crossFx.g.scale.setScalar(0.7 + 0.6 * Math.sqrt(u)); crossFx.m.opacity = 0.85 * (1 - u) * (1 - u) * Math.min(1, u * 12); crossFx.m2.opacity = 0.35 * crossFx.m.opacity; }
    }
    if (shockFx && shockFx.ring.visible) { // 0.5 秒で半径 0.4 → 4 m に広がって消える
      shockFx.age += dt; const u = shockFx.age / 0.5;
      if (u >= 1) shockFx.ring.visible = false;
      else { shockFx.ring.scale.setScalar(0.4 + 3.6 * Math.sqrt(u)); shockFx.ring.material.opacity = 0.8 * (1 - u); }
    }
  }

  function actPose(act, Aa, G) {
    if (act.type === 'atk') return atkPose(act);
    if (act.type === 'hurt' || act.type === 'down') return hitPose(act);
    if (act.type === 'door') return doorPose(act, G);
    if (act.type === 'fan' || act.type === 'cheer') return festPose(act, G);
    if (act.type === 'roll') { // 前転: データの骨の向きと、腰の高さ・左右のずれ (前後はキャラごと動く)
      const m = sampleMotion('ual_roll', act.t, st.mo || (st.mo = {}));
      if (m) { const X = pose(); X.q = m.q; st.hipOff = [m.hips[0], m.hips[1], 0]; st.hipAbs = true; return X; }
    }
    const X = pose();
    const s = act.s, hy = IDLE_EXT + HIP_DROP;
    const leg = (th, kn, ft, h, k, side) => { X[th] = [-h, 0, side * 0.03]; X[kn] = [k, 0, 0]; X[ft] = [0.35, 0, 0]; };
    if (act.type === 'climb') {
      // 0〜0.18 縁をつかむ → 〜0.62 体を引き上げる (足は壁をかく) → 〜1 片膝を縁にかけて立つ
      const pu = sstep(0.18, 0.62, s), up = sstep(0.6, 0.95, s);
      const P = 0.06 + 0.5 * sstep(0.35, 0.66, s) * (1 - sstep(0.76, 1, s)); // 胴の前傾 (縁の上へ上体をかぶせる)
      X.hips[0] = P * 0.55; X.spine[0] = P * 0.2; X.chest[0] = P * 0.25;
      X.neck[0] = -0.08 * (1 - pu) - P * 0.2; X.head[0] = -0.12 * (1 - pu) - P * 0.25; // はじめは縁を少し見上げる (反らしすぎると壁・軒にめり込む)
      const scr = sstep(0.08, 0.22, s) * (1 - up), kick = Math.sin(s * 22);
      let hL = 0.3 + 0.4 * kick * scr, kL = 0.65 + 0.45 * kick * scr, hR = 0.3 - 0.4 * kick * scr, kR = 0.65 - 0.45 * kick * scr;
      const inL = sstep(0, 0.4, up), outL = 1 - sstep(0.5, 1, up), inR = sstep(0.25, 0.65, up), outR = 1 - sstep(0.7, 1, up);
      hL = mix(hL, 1.75, inL) * outL; kL = mix(kL, 2.05, inL) * outL;
      hR = mix(hR, 1.0, inR) * outR; kR = mix(kR, 1.7, inR) * outR;
      leg('thL', 'knL', 'ftL', hL, kL, 1); leg('thR', 'knR', 'ftR', hR, kR, -1);
      const w = sstep(0, 0.1, s) * (1 - sstep(0.74, 0.92, s));
      const [sx, ex] = reach(act.lz + 0.06 - SH_UP * Math.sin(P), act.ly + 0.05 - (hy + SH_UP * Math.cos(P)), P);
      for (const [sh, el, ha, side] of [['shL', 'elL', 'haL', 1], ['shR', 'elR', 'haR', -1]]) {
        X[sh] = [mix(Aa[sh][0], sx, w), 0, mix(Aa[sh][2], side * 0.12, w)];
        X[el] = [mix(Aa[el][0], ex, w), 0, 0];
        X[ha] = [0, 0, side * 0.2];
      }
      // 腰の高さ合わせは、腕が上がりきってから効かせる (早いと、腕の代わりに体が持ち上がって跳ねる)
      st.anchor = { w: sstep(0.14, 0.3, s) * (1 - sstep(0.74, 0.92, s)), y: act.ly + 0.05, hands: ['haL', 'haR'], lim: 0.25 };
    } else { // vault: 左手を柵につき、上体を左へ倒して、そろえた脚を右へ流して越える
      const m = sstep(0.04, 0.4, s) * (1 - sstep(0.6, 0.96, s));
      const tilt = 1.0 * m;
      X.hips = [0.12 * m, -0.3 * m, -tilt];
      X.spine[2] = 0.1 * m; X.chest[2] = 0.15 * m; X.neck[2] = 0.25 * m; X.head[2] = 0.25 * m; // 頭は起こしたまま
      X.head[1] = 0.15 * m;
      leg('thL', 'knL', 'ftL', 0.25 + 1.0 * m, 0.3 + 0.8 * m, 1); leg('thR', 'knR', 'ftR', 0.2 + 1.0 * m, 0.3 + 0.7 * m, -1);
      const fw = clamp(Math.atan2(act.lz, Math.max(0.2, hy + SH_UP * 0.6 - act.ly)), -1.1, 1.1); // 手をついた点へ腕を向ける (前 → 真下 → 後ろ)
      X.shL = [mix(-0.5, -fw, sstep(0.05, 0.3, s)), 0, 0.08 + 0.72 * m]; X.elL = [-0.12, 0, 0]; X.haL = [0, 0, 0.3];
      X.shR = [-0.5 * m + 0.2, 0, -(0.35 + 0.95 * m)]; X.elR = [-0.5, 0, 0]; X.haR = [0, 0, -0.4];
      st.anchor = { w: sstep(0.1, 0.36, s) * (1 - sstep(0.6, 0.85, s)), y: act.ly + 0.06, hands: ['haL'], lim: 0.7 };
    }
    return X;
  }
  // 扉を開ける (act = { type: 'door', s: 0〜1 })。上半身だけ: 両手を胸の高さに上げて、前へ押し出し、戻す。
  // 脚と腰はふつうの姿勢 (G) のまま (歩きながらでも開けられる。動きは止めない)
  function doorPose(act, G) {
    const X = pose(), s = act.s;
    for (const n of NAMES) X[n] = G[n].slice();
    const up = sstep(0, 0.3, s) * (1 - sstep(0.75, 1, s));   // 腕を上げている度合い
    const push = sstep(0.3, 0.55, s) * (1 - sstep(0.7, 0.95, s)); // 押し出している度合い
    X.spine[0] += 0.05 * up + 0.08 * push; X.chest[0] += 0.06 * up + 0.1 * push;
    X.head[0] += -0.05 * up;
    for (const [sh, el, ha, side] of [['shL', 'elL', 'haL', 1], ['shR', 'elR', 'haR', -1]]) {
      X[sh] = [mix(G[sh][0], -1.15 - 0.3 * push, up), mix(G[sh][1], 0, up), mix(G[sh][2], side * (0.22 - 0.08 * push), up)];
      X[el] = [mix(G[el][0], -1.15 + 1.0 * push, up), 0, 0];
      X[ha] = [mix(G[ha][0], -0.9 * push, up), 0, mix(G[ha][2], side * 0.1, up)];   // 手のひらを前へ (手首を反らす)
    }
    return X;
  }
  // お札まき (rhythm/event.js)。脚と腰はふつうの姿勢 (G) のまま、上半身だけ
  //   fan:   右手のうちわを頭の上に構え、打つ瞬間に前へ振り下ろす (act.u = 最後に打ってからの秒数。大きいほど構えに戻っている)
  //          act.lift = 最後の一打の前に、うちわを高く掲げる度合い (0〜1)
  //   cheer: 見物人。両手を上げて弾む (act.e = 盛り上がり 0〜1、act.ph = 弾む位相)
  function festPose(act, G) {
    const X = pose();
    for (const n of NAMES) X[n] = G[n].slice();
    if (act.type === 'fan') {
      const u = act.u ?? 9;
      const hit = u < 0.05 ? sstep(0, 0.05, u) : 1 - sstep(0.1, 0.42, u); // 振り下ろしている度合い
      const lift = act.lift || 0;
      X.spine[0] += 0.12 * hit; X.chest[0] += 0.1 * hit; X.head[0] += 0.05 * hit;
      X.shR = [mix(mix(-2.35, -2.85, lift), -0.75, hit), 0, mix(-0.32, -0.1, hit)];
      X.elR = [mix(-0.85 + 0.6 * lift, -0.2, hit), 0, 0];
      X.haR = [mix(0.35, -0.55, hit), 0, -0.1];
      X.shL = [-0.55 - 0.15 * hit, 0, 0.3]; X.elL = [-1.55, 0, 0]; X.haL = [0, 0, 0.2]; // 左手は胸の前
      // --- かわいい動き (リズム地獄。act: bt = 曲の拍の数、e = 盛り上がり、res/ju = 最後の判定とそこからの秒、bu = うな○ーにぶつかられてからの秒) ---
      const e = act.e ?? 0.5, bt = act.bt ?? 0, ju = act.ju ?? 9, bu = act.bu ?? 9;
      // 1. 拍に乗る: 拍の頭で膝を曲げ、体を左右に揺らし、首をかしげる (曲の外では動かない)
      if (act.bt != null) {
        const sq = (0.5 + 0.5 * Math.cos(2 * Math.PI * bt)) * (0.1 + 0.14 * e);
        for (const [t, k, f] of [['thL', 'knL', 'ftL'], ['thR', 'knR', 'ftR']]) { X[t][0] -= sq; X[k][0] += 2 * sq; X[f][0] -= sq; }
        const sw = Math.sin(Math.PI * bt) * (0.5 + 0.5 * e);
        X.hips[2] += 0.09 * sw; X.spine[2] -= 0.04 * sw; X.chest[2] -= 0.05 * sw; X.head[2] += 0.1 * Math.sin(Math.PI * bt + 0.8) * (0.5 + 0.5 * e);
        X.hips[1] += 0.05 * Math.sin(Math.PI * bt + 0.4);
        X.shL[2] += 0.06 * sw; X.shL[0] += 0.05 * Math.cos(2 * Math.PI * bt);
      }
      // 2. 打つ瞬間にぴょんと跳ぶ (高さと回転は rhythm/event.js が act.hop・act.twirl で渡す)。跳んでいる間は右足を後ろへ蹴り上げる
      if (act.hop > 0.005) {
        const hf = Math.min(1, act.hop / 0.3);
        X.thR[0] += 0.35 * hf; X.knR[0] += 1.0 * hf; X.ftR[0] += 0.3 * hf;
        X.thL[0] -= 0.1 * hf; X.knL[0] += 0.15 * hf;
        X.spine[0] += 0.05 * hf; X.hips[1] += 0.2 * hf * Math.sin(act.bt ?? 0);
      }
      // 3. 判定への反応
      if (act.res === 'good' && ju < 1.1) { // 大吉: 左手を高く上げて万歳、首を後ろへ反らして、にっこり
        const w = sstep(0, 0.08, ju) * (1 - sstep(0.7, 1.1, ju));
        X.shL = [mix(X.shL[0], -2.75, w), 0, mix(X.shL[2], 0.55, w)]; X.elL = [mix(X.elL[0], -0.2, w), 0, 0]; X.haL = [0, 0, 0.3 * w];
        X.head[0] += -0.18 * w; X.chest[0] += -0.1 * w;
      } else if (act.res === 'ok' && ju < 0.7) { // 吉: うなずいて、肩をすくめる
        const w = Math.sin(Math.PI * Math.min(1, ju / 0.5));
        X.head[0] += 0.2 * w; X.chest[2] += 0.05 * w;
      } else if (act.res === 'miss' && ju < 1.4) { // 凶: しょんぼり。肩を落として首を振り、膝を内側へ
        const w = sstep(0, 0.1, ju) * (1 - sstep(0.9, 1.4, ju));
        X.spine[0] += 0.28 * w; X.chest[0] += 0.2 * w; X.head[0] += 0.3 * w; X.head[1] += 0.28 * Math.sin(ju * 22) * w;
        X.shR[0] += 1.0 * w; X.shL[0] += 0.4 * w;
        X.thL[2] += 0.12 * w; X.thR[2] -= 0.12 * w; X.knL[0] += 0.2 * w; X.knR[0] += 0.2 * w; X.thL[0] -= 0.1 * w; X.thR[0] -= 0.1 * w;
      }
      // うな○ーにぶつかられた: のけぞって、両手をばたばたさせ、よろよろする
      if (bu < 1.0) {
        const w = (1 - sstep(0.4, 1.0, bu)) * sstep(0, 0.04, bu), osc = Math.sin(bu * 16);
        X.spine[0] += -0.4 * w; X.chest[0] += -0.3 * w; X.head[0] += -0.2 * w;
        X.hips[2] += 0.25 * osc * w; X.chest[2] -= 0.15 * osc * w;
        X.shL = [mix(X.shL[0], -1.3 + 0.3 * osc, w), 0, mix(X.shL[2], 0.9, w)]; X.elL = [mix(X.elL[0], -0.5, w), 0, 0];
        X.shR = [mix(X.shR[0], -1.3 - 0.3 * osc, w), 0, mix(X.shR[2], -0.9, w)];
        X.thL[0] -= 0.25 * w; X.thR[0] += 0.15 * w; X.knL[0] += 0.4 * w; X.knR[0] += 0.3 * w;
      }
    } else {
      // 両手を V の字に上げ、拍に合わせて交互に振る
      const e = act.e || 0, b = Math.sin(act.ph || 0);
      X.shL = [-2.9 - 0.15 * b * e, 0, 0.55 + 0.1 * e]; X.shR = [-2.9 + 0.15 * b * e, 0, -0.55 - 0.1 * e];
      X.elL = [-0.25 - 0.3 * Math.max(0, b) * e, 0, 0]; X.elR = [-0.25 - 0.3 * Math.max(0, -b) * e, 0, 0];
      X.haL = [0, 0, 0.3]; X.haR = [0, 0, -0.3];
      X.head[0] += -0.12 * e;
    }
    return X;
  }
  // 攻撃を受けたとき (act = { type: 'hurt' | 'down', s: 0〜1 })。hurt = のけぞる、down = 膝をついてうなだれる (倒された)
  function hitPose(act) {
    const X = pose(), s = act.s;
    const leg = (th, kn, ft, h, k, side) => { X[th] = [-h, 0, side * 0.04]; X[kn] = [k, 0, 0]; X[ft] = [h - k, 0, 0]; };
    if (act.type === 'hurt') {
      const m = 1 - sstep(0.45, 1, s);
      X.spine[0] = -0.22 * m; X.chest[0] = -0.3 * m; X.neck[0] = -0.12 * m; X.head[0] = -0.28 * m;
      X.chest[1] = 0.25 * m;
      X.shL = [-0.35 * m, 0, 0.2 + 0.75 * m]; X.shR = [0.3 * m, 0, -(0.2 + 0.6 * m)];
      X.elL = [-0.7 * m - 0.1, 0, 0]; X.elR = [-0.5 * m - 0.1, 0, 0];
      X.haL = [0, 0, 0.4]; X.haR = [0, 0, -0.4];
      leg('thL', 'knL', 'ftL', 0.3 * m, 0.25 * m + 0.05, 1); leg('thR', 'knR', 'ftR', -0.35 * m, 0.3 * m + 0.05, -1);
    } else {
      const w = sstep(0, 1, s);
      X.hips[0] = 0.1 * w; X.spine[0] = 0.4 * w; X.chest[0] = 0.45 * w; X.neck[0] = 0.25 * w; X.head[0] = 0.35 * w;
      X.shL = [-1.0 * w, 0, 0.12]; X.shR = [-1.0 * w, 0, -0.12];
      X.elL = [-0.25 * w, 0, 0]; X.elR = [-0.25 * w, 0, 0];
      X.haL = [0, 0, 0.3]; X.haR = [0, 0, -0.3];
      leg('thL', 'knL', 'ftL', 0.55 * w, 2.2 * w, 1); leg('thR', 'knR', 'ftR', 0.45 * w, 2.1 * w, -1);
      X.ftL[0] = X.ftR[0] = 0.5 * w; // つま先を伸ばして、すねを地面につける
    }
    return X;
  }
  // 手が縁の高さに来るよう、腰の高さをずらす量 (handY = 手の骨の、足元から見た高さを返す関数)
  function anchorShift(handY) {
    const a = st.anchor;
    if (!a || a.w < 0.01) return 0;
    let y = 0;
    for (const n of a.hands) y += handY(n) / a.hands.length;
    return clamp(a.y - y, -a.lim, a.lim) * a.w;
  }

  // 片脚の角度 (p = 歩行周期の位相。0 で踵が着く直前、π で爪先が離れる)
  // h: 太ももを前へ振る量, k: 膝の曲げ, fp: 足の地面に対する傾き (+ = 爪先が下)
  function legAngles(p, g) {
    const pm = ((p % (2 * PI)) + 2 * PI) % (2 * PI);
    const swing = Math.max(0, -Math.sin(p + 0.8)); // 遊脚期に膝を曲げる
    const load = pm < PI / 2 ? Math.sin(2 * pm) : 0; // 接地直後の膝のたわみ
    const h = g.A * (Math.cos(p) + 0.1) * g.gw + g.stLift * swing * g.gw; // 階段では遊脚を高く上げる
    const k = g.gw * (g.kSwing * swing + g.kLoad * load);
    let fp;
    if (pm < PI) fp = -0.2 * (1 - sstep(0, 0.3, pm)) + g.toeOff * sstep(0.55 * PI, PI, pm);
    else { const u = (pm - PI) / PI; fp = g.toeOff * (1 - sstep(0, 0.4, u)) - 0.2 * sstep(0.6, 1, u); }
    return { h, k, fp: fp * g.gw, swing };
  }

  // act: パルクール ({type, s, ly, lz}) か攻撃 ({type: 'atk', step, ph, t})。armed: 剣を出しているか
  function update(dt, speed, onGround, vy, stair = 0, act = null, armed = false) {
    updateInner(dt, speed, onGround, vy, stair, act);
    if (vrmRig) applyVRM(dt);
    updateSwords(Math.max(1e-4, Math.min(dt, 0.1)), armed, st.trail, st.trailStyle);
    updateFan(act);
    updateFx(Math.max(1e-4, Math.min(dt, 0.1)), act);
  }

  // 歩き・走り・待機 (地上 G) と、跳ぶ・落ちる (空中 Aa) の姿勢を、動きのデータに置き換える (dw = 置き換える度合い)
  //   地上: 速さで 歩き・ジョギング・全力疾走 の 3 つを混ぜ、足が滑らないよう「1 周で進む距離」に合わせて位相を進める
  //         (3 つは左足がいちばん前へ出る時をそろえてある)。止まると待機の動きへ。着地の直後は着地の動きを重ねる
  //   空中: 上がっている間は踏み切りの動きの後半、落ちている間は空中の動き
  const _lq = {}, _lt = new THREE.Quaternion(), _le = new THREE.Euler();
  const locoS = {};
  function locoSample(key, t) {
    const c = getMotion(LOCO[key]);
    return c ? sampleMotion(LOCO[key], t, locoS[key] || (locoS[key] = {})) : null;
  }
  function locoData(G, Aa, dt, sp, onGround, vy, dw) {
    const C = {}; for (const k in LOCO) { C[k] = getMotion(LOCO[k]); if (!C[k]) return; } // 読み込み前は手作り
    if (dw < 0.01) return;
    const hipH = IDLE_EXT + HIP_DROP, wrap = (x) => x - Math.floor(x);
    const keys = ['walk', 'jog', 'sprint'], v = keys.map((k) => C[k].speed * hipH * LOCO_K[k]);
    // 速さ → 混ぜる割合
    let w;
    if (sp <= v[0]) w = [1, 0, 0];
    else if (sp <= v[1]) { const u = (sp - v[0]) / (v[1] - v[0]); w = [1 - u, u, 0]; }
    else if (sp <= v[2]) { const u = (sp - v[1]) / (v[2] - v[1]); w = [0, 1 - u, u]; }
    else w = [0, 0, 1];
    st.lw = st.lw || [1, 0, 0];
    for (let i = 0; i < 3; i++) st.lw[i] += (w[i] - st.lw[i]) * (1 - Math.exp(-dt * 10));
    const ws = st.lw[0] + st.lw[1] + st.lw[2];
    let cyc = 0; keys.forEach((k, i) => { cyc += st.lw[i] / ws * v[i] * C[k].dur; }); // 1 周で進む距離 (m)
    if (onGround && sp > 0.05) st.lp = wrap((st.lp || 0) + dt * sp / cyc);
    // 地上: 歩き・走りを混ぜる
    let acc = 0, Q = null;
    keys.forEach((k, i) => {
      const wi = st.lw[i] / ws; if (wi < 0.01) return;
      const m = locoSample(k, wrap((st.lp || 0) + C[k].phaseL) * C[k].dur);
      acc += wi;
      if (!Q) { Q = {}; for (const n in m.q) Q[n] = (_lq[n] || (_lq[n] = new THREE.Quaternion())).copy(m.q[n]); }
      else for (const n in m.q) Q[n].slerp(m.q[n], wi / acc);
    });
    // 止まっているとき: 待機の動き (gw = 動いている度合い)
    const idle = locoSample('idle', st.t % C.idle.dur);
    for (const n in Q) { const tmp = _lt.copy(Q[n]); Q[n].copy(idle.q[n]).slerp(tmp, st.gw); }
    // 着地の直後: 着地の動き (しゃがんで起きる) を重ねる。強く落ちたほど深く、走っているときは浅く
    if (st.landT < 0.55) {
      const ld = locoSample('land', 0.1 + st.landT * 1.3);
      const lw = (st.landAmp || 0) * (1 - sstep(0.22, 0.55, st.landT)) * (1 - 0.65 * st.gw);
      for (const n in Q) Q[n].slerp(ld.q[n], lw);
    }
    // 空中: 上がっている間は踏み切りの後半 (脚を抱える)、落ちている間は空中の動き
    const up = locoSample('start', 0.45 + 0.4 * clamp(1 - vy / 8, 0, 1)), fall = locoSample('loop', st.t % C.loop.dur);
    const fw = sstep(1.5, -2, vy);
    for (const n in Q) {
      _lt.slerpQuaternions(up.q[n], fall.q[n], fw);
      for (const [P, q] of [[G, Q[n]], [Aa, _lt]]) {
        if (!P[n]) continue;
        const p = P[n];
        _le.set(p[0], p[1], p[2], 'XYZ');
        _lq.tmp = (_lq.tmp || new THREE.Quaternion()).setFromEuler(_le).slerp(q, dw);
        _le.setFromQuaternion(_lq.tmp, 'XYZ');
        P[n] = [_le.x, _le.y, _le.z];
      }
    }
  }

  function updateInner(dt, speed, onGround, vy, stair, act) {
    dt = Math.max(1e-4, Math.min(dt, 0.1));
    const sdt = Math.min(dt, 1 / 30); // ばね用 (大きすぎる dt で暴れないように)
    const sp = speed;
    st.t += dt;
    const rate = (r) => 1 - Math.exp(-dt * r);

    // --- 状態 ---
    if (!onGround) { st.lastVy = vy; st.wasAir = true; }
    else if (st.wasAir) { st.land = clamp(-st.lastVy / 14, 0.2, 1); st.landAmp = st.land; st.landT = 0; st.wasAir = false; }
    st.landT = (st.landT ?? 9) + dt;
    st.land *= Math.exp(-dt * 7);
    st.airW += ((onGround ? 0 : 1) - st.airW) * rate(onGround ? 14 : 18);
    st.gw += ((onGround ? sstep(0.08, 0.7, sp) : 0) - st.gw) * rate(12);
    const gw = st.gw;
    // 階段: 上り (+1) は腿を高く上げて前傾、下り (-1) は膝を曲げて小股でやや後ろ重心
    st.stair += (clamp(stair, -1, 1) - st.stair) * rate(8);
    const upK = Math.max(0, st.stair), dnK = Math.max(0, -st.stair), stK = Math.abs(st.stair);
    const runK = sstep(2.8, 5.5, sp);

    // 歩幅から位相の進み方を決める (足が地面を滑らないように、速さに比例して進める)
    const A = Math.min(1.15, 0.1 + 0.15 * sp) * (1 - 0.15 * stK);
    const stride = Math.max(0.7, 3.6 * Math.sin(A)) * (1 - 0.3 * stK); // 階段は 1 段ごとに足を出す小股 // 1 周期 (左右 2 歩) で進む距離
    if (onGround && sp > 0.05) st.phase += dt * sp / stride * 2 * PI;
    const pL = st.phase, pR = st.phase + PI;

    const g = { A, gw, stLift: 0.75 * upK + 0.3 * dnK, kSwing: Math.min(2.0, 0.45 + 0.2 * sp + 0.5 * upK + 0.25 * dnK + 0.3 * runK), kLoad: Math.min(0.45, 0.2 + 0.04 * sp), toeOff: Math.min(0.8, 0.5 + 0.03 * sp) };
    const legL = legAngles(pL, g), legR = legAngles(pR, g);

    // --- 地上の姿勢 ---
    const G = pose();
    const idleK = (1 - gw) * 0.03;
    const landH = st.land * 0.5, landK = st.land * 0.9;
    // 内股: 太ももを内へひねる。走りでは、後ろへ蹴り上げたすねが外へ流れる (ひねり + 膝の曲げ)。足は体の中心寄りに着く
    const setLeg = (L, th, kn, ft, side) => {
      G[th] = [-(L.h + landH), -side * (0.07 + 0.1 * L.swing * runK * gw), side * (0.02 - 0.04 * gw * (1 - 0.6 * runK))];
      G[kn] = [L.k + idleK + landK, 0, 0];
      G[ft] = [L.fp + (L.h + landH) - (L.k + idleK + landK), 0, 0];
    };
    setLeg(legL, 'thL', 'knL', 'ftL', 1);
    setLeg(legR, 'thR', 'knR', 'ftR', -1);

    const cL = Math.cos(pL), cR = Math.cos(pR);
    // 骨盤のひねりと、それを打ち消す胸のひねり
    const yawA = (0.1 + 0.12 * runK) * gw;
    G.hips[1] = -yawA * 0.6 * cL;
    G.spine[1] = yawA * 0.5 * cL;
    G.chest[1] = yawA * 0.7 * cL;
    const sway = Math.sin(st.t * 0.9) * 0.025 * (1 - gw); // 立っているときの、ゆっくりした体重移動
    G.hips[2] = 0.07 * gw * Math.sin(pL) + sway; // 骨盤の左右の傾き (腰を振る)
    G.chest[2] = -0.05 * gw * Math.sin(pL) - sway * 0.6;
    // 前傾 (速いほど深く) と着地のかがみ
    const lean = gw * (0.03 + 0.3 * sstep(1.5, 10, sp) + 0.08 * runK) + st.land * 0.18 + gw * (0.2 * upK - 0.08 * dnK);
    G.spine[0] = lean * 0.4; G.chest[0] = lean * 0.6;
    const breathe = Math.sin(st.t * 1.6) * 0.012 * (1 - gw);
    G.chest[0] += breathe;
    G.neck[0] = -lean * 0.35; G.head[0] = -lean * 0.45;
    G.head[1] = Math.sin(st.t * 0.5) * 0.06 * (1 - gw);
    G.head[2] = 0.04 * (1 - gw) - sway * 0.8 - 0.05 * gw * Math.sin(pL); // 首を少しかしげる。歩くと左右に小さく揺れる
    // 腕: 反対側の脚と逆に振る。
    // 歩き: 少し開いて振り、後ろへ引いたときに外へ流す。走り: 脇をしめて肘を曲げ、前腕を外へ開いて左右に振る (女の子走り)。
    // 手首は外へ反らす (後ろからも手の動きが見える)
    const armA = Math.min(1.1, 0.3 + 0.1 * sp) * gw;
    const rk = runK * gw;
    const armPose = (sh, el, ha, c, side) => {
      const fwd = Math.max(0, -c), back = Math.max(0, c); // 腕が前 / 後ろにあるほど 1
      G[sh] = [
        armA * c * mix(1, 0.6, runK) + 0.25 * rk + st.land * 0.3, // 走りは上腕を少し後ろへ引いたまま、前後にも振る
        side * (0.15 * gw * (1 - runK) + rk * (0.75 + 0.35 * c)), // 上腕のひねり = 前腕が外へ開く
        side * (mix(0.17, 0.1, rk) + (0.05 + 0.2 * back) * gw * (1 - runK)), // 歩きは腕を体から離し、後ろへ引くほど外へ流す
      ];
      const flex = 0.18 * (1 - gw) + gw * mix(0.2 + 0.2 * fwd, 1.5 + 0.15 * fwd, runK); // 歩きは腕を伸ばしぎみ、走りは肘を深く曲げてこぶしを胸の高さへ
      G[el] = [-flex, 0, 0];
      G[ha] = [0, 0, side * (0.45 + 0.15 * c * gw + 0.04 * Math.sin(st.t * 1.6) * (1 - gw))];
    };
    armPose('shL', 'elL', 'haL', cL, 1);
    armPose('shR', 'elR', 'haR', cR, -1);

    // --- 空中の姿勢 (上昇: 片脚を前に出して跳ぶ / 下降: 着地に備えて足を前へ) ---
    const Aa = pose();
    const rising = vy > 0;
    const lead = rising ? [0.7, 1.0] : [0.35, 0.35], trail = rising ? [-0.1, 1.2] : [0.2, 0.5];
    const setAir = (th, kn, ft, a) => { Aa[th] = [-a[0], 0, 0]; Aa[kn] = [a[1], 0, 0]; Aa[ft] = [0.2, 0, 0]; };
    setAir('thL', 'knL', 'ftL', lead); setAir('thR', 'knR', 'ftR', trail);
    Aa.thL[2] = 0.05; Aa.thR[2] = -0.08;
    Aa.spine[0] = 0.05; Aa.chest[0] = 0.05; Aa.head[0] = -0.05;
    const armUp = rising ? 0.55 : 0.8;
    Aa.shL = [-0.35, 0, armUp]; Aa.shR = [0.2, 0, -armUp];
    Aa.elL = [-0.5, 0, 0]; Aa.elR = [-0.5, 0, 0];
    Aa.haL = [0, 0, 0.5]; Aa.haR = [0, 0, -0.5];

    // --- 動きのデータで置き換える (階段では手作りのまま) ---
    if (DATA_ON) locoData(G, Aa, dt, sp, onGround, vy, 1 - sstep(0.1, 0.5, stK));

    // --- パルクールの姿勢 (終わった後は、最後の姿勢からふつうの姿勢へ戻す) ---
    st.anchor = null;
    st.hipOff = null; st.hipAbs = false;
    if (act) st.actPose = actPose(act, Aa, G);
    st.trail = !!act && act.type === 'atk' && trailOn(act.step, act.ph, act.t);
    st.trailStyle = st.trail ? TRAIL_STYLE[act.step + ':' + act.ph] || null : null;
    const tw = act && act.type === 'atk' && TWIRL[act.step + ':' + act.ph];
    st.twirl = tw ? 2 * PI * sstep(tw[0], tw[1], act.t) : 0; // 剣を手の中でまわす角度
    if (!act || act.type !== 'atk') { st.atkId = -1; st.atkLast = null; }
    st.actW += ((act ? 1 : 0) - st.actW) * rate(act ? 30 : 10);
    if (st.actW < 0.01 && !act) st.actPose = null;
    const X = st.actPose, xw = X ? st.actW : 0;

    // --- 反映 ---
    const k = rate(act ? 40 : onGround ? 28 : 14);
    for (const n of NAMES) {
      const b = BONE[n].rotation;
      const tg = G[n], ta = Aa[n];
      if (xw && X.q && X.q[n]) { // 肩 (攻撃): 角度の補間ではなく、向きそのものをなめらかに近づける
        _eu.set(mix(tg[0], ta[0], st.airW), mix(tg[1], ta[1], st.airW), mix(tg[2], ta[2], st.airW), 'XYZ');
        _qn.setFromEuler(_eu).slerp(X.q[n], xw);
        BONE[n].quaternion.slerp(_qn, k);
        continue;
      }
      for (let i = 0; i < 3; i++) {
        let v = mix(tg[i], ta[i], st.airW);
        if (xw) v = mix(v, X[n][i], xw);
        const c = i === 0 ? 'x' : i === 1 ? 'y' : 'z';
        b[c] += (v - b[c]) * k;
      }
    }

    // 腰の高さ: 着いている足が地面に届くように、脚の実際の角度から求める
    const ext = (l) => {
      const h = -l.th.rotation.x, kk = l.kn.rotation.x, fp = l.ft.rotation.x - h + kk;
      return THIGH * Math.cos(h) + SHIN * Math.cos(h - kk) + ANKLE_H * Math.cos(fp)
        + (fp > 0 ? 0.15 * Math.sin(fp) : 0.05 * Math.sin(-fp));
    };
    const planted = Math.max(ext(legs[0]), ext(legs[1])) + HIP_DROP;
    const runFloat = runK * gw * 0.08 * Math.abs(Math.sin(st.phase)); // 走りの浮き
    const airY = IDLE_EXT + HIP_DROP;
    hips.position.y = mix(planted + runFloat + Math.sin(st.t * 1.6) * 0.003 * (1 - gw), airY, st.airW);
    // 動きのデータの腰の前後・左右の移動 (踏み込みで腰が前へ出る)。足は地面に残る
    const ho = st.hipOff, hk = ho ? (IDLE_EXT + HIP_DROP) * xw : 0;
    // 前転: 腰の高さもデータのまま (転がっている間は足が地面から離れるので、脚から高さを決めない)
    st.absW = (st.absW || 0) + ((st.hipAbs ? 1 : 0) - (st.absW || 0)) * k;
    if (st.absW > 0.001) hips.position.y = mix(hips.position.y, (IDLE_EXT + HIP_DROP) * (1 + (st.hipAbs ? ho[1] : 0)), st.absW * xw);
    hips.position.x += ((ho ? ho[0] * hk : 0) - hips.position.x) * k;
    hips.position.z += ((ho ? ho[2] * hk : 0) - hips.position.z) * k;
    if (st.anchor && !vrmRig) { // 手を縁に合わせる (VRM のときは applyVRM が VRM の手で合わせる)
      root.updateMatrixWorld(true);
      const baseY = root.matrixWorld.elements[13];
      hips.position.y += anchorShift((n) => BONE[n].getWorldPosition(tmpV).y - baseY);
    }

    // 旋回で内側にかたむく
    const yaw = root.rotation.y;
    let dy = yaw - st.lastYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    st.lastYaw = yaw;
    const roll = clamp(-(dy / dt) * 0.035 * Math.min(1, sp / 5), -0.22, 0.22) * gw;
    st.roll += (roll - st.roll) * rate(8);
    body.rotation.z = st.roll;

    // ポニーテール: 加速と上下の揺れでばねが動く
    const accel = (sp - st.prevSpeed) / dt;
    const hv = (hips.position.y - st.lastHipsY) / dt;
    st.prevSpeed = sp; st.lastHipsY = hips.position.y;
    const eq1 = 0.3 + 0.08 * Math.min(sp, 8) + clamp(accel, -30, 30) * 0.008 - clamp(hv, -6, 6) * 0.05;
    st.v1 += (90 * (eq1 - st.a1) - 9 * st.v1) * sdt; st.a1 += st.v1 * sdt;
    const eq2 = 0.15 + 0.1 * Math.min(sp, 8) * 0.1 - st.v1 * 0.06;
    st.v2 += (110 * (eq2 - st.a2) - 8 * st.v2) * sdt; st.a2 += st.v2 * sdt;
    tail1.rotation.x = clamp(st.a1, -0.3, 1.4);
    tail2.rotation.x = clamp(st.a2, -0.5, 1.0);
  }


  // ---- VRM への差し替え ----
  let vrmRig = null;
  const Q = THREE.Quaternion, ZAX = new THREE.Vector3(0, 0, 1), YAX = new THREE.Vector3(0, 1, 0), XAX = new THREE.Vector3(1, 0, 0);
  // VRM は T ポーズ (腕が真横)。腕を下ろした姿勢を基準にするための回転
  const HL = new Q().setFromAxisAngle(ZAX, -PI / 2), HR = new Q().setFromAxisAngle(ZAX, PI / 2);
  const DIRECT = { hips: 'hips', spine: 'spine', chest: 'chest', neck: 'neck', head: 'head',
    thL: 'leftUpperLeg', knL: 'leftLowerLeg', ftL: 'leftFoot', thR: 'rightUpperLeg', knR: 'rightLowerLeg', ftR: 'rightFoot' };
  const tmpV = new THREE.Vector3();
  const SMILE = +(new URLSearchParams(location.search).get('smile') ?? 0.35); // 笑顔の強さ (0〜1)。URL の ?smile= で試せる
  const HIP_SMOOTH = 9; // 腰の高さをなまらせる強さ (1/秒)。小さいほど髪は落ち着くが、足が地面からわずかにずれる

  function applyVRM(dt) {
    const { vrm, scale, nodes } = vrmRig;
    for (const n in DIRECT) nodes[n].quaternion.copy(BONE[n].quaternion);
    // 上腕: 自分の回転 × 腕下ろし。前腕: 腕下ろしの座標系へ直した回転
    nodes.shL.quaternion.copy(BONE.shL.quaternion).multiply(HL);
    nodes.shR.quaternion.copy(BONE.shR.quaternion).multiply(HR);
    nodes.elL.quaternion.copy(HL).invert().multiply(BONE.elL.quaternion).multiply(HL);
    nodes.elR.quaternion.copy(HR).invert().multiply(BONE.elR.quaternion).multiply(HR);
    if (nodes.haL) nodes.haL.quaternion.copy(HL).invert().multiply(BONE.haL.quaternion).multiply(HL);
    if (nodes.haR) nodes.haR.quaternion.copy(HR).invert().multiply(BONE.haR.quaternion).multiply(HR);
    // 指: 軽く握る (走ると少し強く)。T ポーズの手で、4 本の指は前後の軸まわり、親指は上下の軸まわりに曲げる
    const curl = 0.6 + 0.25 * sstep(2.8, 5.5, st.prevSpeed) * st.gw;
    for (const f of vrmRig.fingers) {
      if (f.thumb) f.node.quaternion.setFromAxisAngle(YAX, f.side * curl * 0.5);
      else f.node.quaternion.setFromAxisAngle(ZAX, -f.side * curl * f.k);
      if (vrmRig.flip) { f.node.quaternion.x *= -1; f.node.quaternion.z *= -1; }
    }
    // VRM 0.x は骨の座標系が前後逆 (モデルごと 180° 回して前向きにしている) なので、前後・左右の軸まわりの回転を逆にする
    if (vrmRig.flip) for (const n in nodes) { const q = nodes[n].quaternion; q.x = -q.x; q.z = -q.z; }
    nodes.hips.position.y = hips.position.y / scale + vrmRig.minY;
    const fs = vrmRig.flip ? -1 : 1; // VRM 0.x は前後・左右が逆
    nodes.hips.position.x = vrmRig.hx0 + fs * hips.position.x / scale; nodes.hips.position.z = vrmRig.hz0 + fs * hips.position.z / scale;
    // この VRM の足の実際の位置から、いちばん低い足裏が地面 (y=0) に来るよう腰の高さを直す (空中では直さない)
    const gnd = (1 - st.airW) * (1 - (st.absW || 0)); // 前転中は足を地面に合わせない
    if (gnd > 0.01) {
      vrm.scene.updateMatrixWorld(true);
      const baseY = root.matrixWorld.elements[13]; // キャラの足元 (地形) の高さ。足の位置はここからの差で見る
      let low = Infinity;
      for (const f of vrmRig.soles) low = Math.min(low, f.node.getWorldPosition(tmpV).y - baseY - f.off * scale);
      nodes.hips.position.y -= low / scale * gnd;
    }
    // 腰の高さは足の入れ替わりで急に向きを変える。そのままだと髪の揺れ (ばね) が跳ね上がるので、少しなまらせる
    const hy = nodes.hips.position.y;
    vrmRig.hy = vrmRig.hy === undefined ? hy : vrmRig.hy + (hy - vrmRig.hy) * (1 - Math.exp(-Math.min(dt, 0.1) * HIP_SMOOTH));
    nodes.hips.position.y = vrmRig.hy;
    if (st.anchor && nodes.haL && nodes.haR) { // パルクール: 手が縁の高さに来るよう腰を動かす
      root.updateMatrixWorld(true);
      const baseY = root.matrixWorld.elements[13];
      nodes.hips.position.y += anchorShift((n) => nodes[n].getWorldPosition(tmpV).y - baseY) / scale;
    }
    // まばたき (約 4 秒おきに 0.15 秒)
    const bt = st.t % 4;
    vrm.expressionManager?.setValue('blink', bt < 0.15 ? Math.sin(bt / 0.15 * PI) : 0);
    vrm.expressionManager?.setValue('happy', SMILE); // 少しだけ笑顔
    vrm.update(Math.min(dt, 1 / 30));
  }

  // 着せ替え: setOutfits({ tops, bottoms, shoes, onepiece }) 各値は服のファイルの URL か null (= いつもの)。VRM の読み込み前に呼ばれたら、読み込み後に着る
  let outfitter = null, wantOutfits = null;
  const setOutfits = (slots) => { wantOutfits = slots; return outfitter ? outfitter.set(slots) : Promise.resolve(); };
  // 髪型 (キャラメイク): setHair(entry) entry は models/hairs/hairs.json の 1 件か null (= いつもの髪)。VRM の読み込み前に呼ばれたら、読み込み後に付ける
  let hairdresser = null, wantHair = null;
  const setHair = (entry) => { wantHair = entry || null; return hairdresser ? hairdresser.set(wantHair) : Promise.resolve(); };
  let wantHairColor = null;
  let eyedresser = null, wantEyeColor = null;
  const setEyeColor = (hex) => { wantEyeColor = hex || null; eyedresser?.setColor(wantEyeColor); }; // 目の色 ('#rrggbb'。null = 元の色)
  const setHairColor = (hex) => { wantHairColor = hex || null; hairdresser?.setColor(wantHairColor); }; // 髪色 ('#rrggbb'。null = 元の色)。いつもの髪にも効く

  async function loadVRM(url) {
    try {
      const gltf = await takeVRM(url);
      if (!gltf) return; // モデルが置かれていなければ何もしない
      const { VRMUtils } = await import('@pixiv/three-vrm');
      const vrm = gltf.userData.vrm;
      if (!vrm) throw new Error('VRM ではないファイル');
      VRMUtils.removeUnnecessaryVertices?.(gltf.scene);
      shrinkTextures(gltf.scene, 1024); // スマホ・タブレットだけ: 2048 px の模様を半分にする (メモリの節約)
      VRMUtils.rotateVRM0?.(vrm); // VRM 0.x は後ろ向きなので前向きに直す
      vrm.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      // 足裏が地面、腰が自分の骨格と同じ高さになるよう、大きさを合わせる
      vrm.scene.updateMatrixWorld(true);
      const nodes = {};
      for (const n in DIRECT) nodes[n] = vrm.humanoid.getNormalizedBoneNode(DIRECT[n]);
      nodes.shL = vrm.humanoid.getNormalizedBoneNode('leftUpperArm'); nodes.shR = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
      nodes.elL = vrm.humanoid.getNormalizedBoneNode('leftLowerArm'); nodes.elR = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
      nodes.haL = vrm.humanoid.getNormalizedBoneNode('leftHand'); nodes.haR = vrm.humanoid.getNormalizedBoneNode('rightHand');
      for (const n of ['haL', 'haR']) if (!nodes[n]) delete nodes[n];
      const fingers = [];
      for (const [lr, side] of [['left', 1], ['right', -1]]) {
        [['Index', 0.9], ['Middle', 1], ['Ring', 1.1], ['Little', 1.2]].forEach(([name, k]) => {
          for (const seg of ['Proximal', 'Intermediate', 'Distal']) {
            const node = vrm.humanoid.getNormalizedBoneNode(lr + name + seg);
            if (node) fingers.push({ node, side, k });
          }
        });
        for (const seg of ['Metacarpal', 'Proximal', 'Distal']) {
          const node = vrm.humanoid.getNormalizedBoneNode(lr + 'Thumb' + seg);
          if (node) fingers.push({ node, side, thumb: true });
        }
      }
      const restHips = nodes.hips.getWorldPosition(new THREE.Vector3()).y;
      const minY = new THREE.Box3().setFromObject(vrm.scene).min.y;
      // 足首・つま先の骨が、足裏からどれだけ上にあるか (大きさを変える前の値)
      const soles = ['leftFoot', 'rightFoot', 'leftToes', 'rightToes'].map((n) => vrm.humanoid.getNormalizedBoneNode(n))
        .filter(Boolean).map((node) => ({ node, off: node.getWorldPosition(new THREE.Vector3()).y - minY }));
      const scale = (IDLE_EXT + HIP_DROP) / (restHips - minY);
      vrm.scene.scale.setScalar(scale);
      // パルクールで腕を縁へ伸ばす計算に使う寸法 (腕が短いモデルで、体が浮いたり手が届かなかったりしないように)
      const wp = (n) => nodes[n].getWorldPosition(new THREE.Vector3());
      if (nodes.haL) {
        SH_UP = (wp('shL').y - wp('hips').y) * scale;
        ARM_A = wp('shL').distanceTo(wp('elL')) * scale; ARM_B = wp('elL').distanceTo(wp('haL')) * scale;
        console.info(`VRM の寸法: 腰→肩 ${SH_UP.toFixed(2)} m、上腕 ${ARM_A.toFixed(2)} m、前腕 ${ARM_B.toFixed(2)} m`);
      }
      vrmRig = { vrm, scale, nodes, minY, soles, fingers, flip: vrm.meta?.metaVersion === '0', hx0: nodes.hips.position.x, hz0: nodes.hips.position.z }; // 腰の高さは、以後 applyVRM が毎フレーム決める
      body.visible = false;
      root.add(vrm.scene);
      outfitter = new Outfitter(vrm); // 着せ替え (VRM のときだけ。ほかの人の組み立て式のキャラは対象外)
      if (wantOutfits) outfitter.set(wantOutfits);
      eyedresser = new Eyedresser(vrm);
      if (wantEyeColor) eyedresser.setColor(wantEyeColor);
      hairdresser = new Hairdresser(vrm);
      if (wantHairColor) hairdresser.setColor(wantHairColor);
      if (wantHair) hairdresser.set(wantHair);
      console.info('VRM を読み込みました: ' + url);
    } catch (e) {
      console.warn('VRM を読み込めなかったので、組み立て式のキャラのままにします:', e);
    }
  }
  const ready = Promise.all([opt.vrm === false ? Promise.resolve() : loadVRM(VRM_URL), locoLoading]); // VRM・動きのデータの読み込み (有無にかかわらず) が済むと解決する

  // 片づけ (ほかのプレイヤーが居なくなったとき)
  const dispose = () => {
    fx.removeFromParent(); root.removeFromParent();
    root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const t of trails) t.geo.dispose();
    for (const d of dusts) d.sp.material.dispose();
    if (dustTex) dustTex.dispose();
    if (crossFx) { crossFx.m.dispose(); crossFx.m2.dispose(); crossFx.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    if (shockFx) { shockFx.ring.geometry.dispose(); shockFx.ring.material.dispose(); }
    for (const m of [...Object.values(M), outlineMat, ...bladeMats]) m.dispose();
    gm.dispose();
  };
  return { root, update, ready, bones: BONE, dispose, setLegend, setOutfits, setHair, setHairColor, setEyeColor };
}
