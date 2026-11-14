// キャラクター (関節つきの人型 + トゥーン + アウトライン)。
// 骨格: hips → spine → chest → (neck → head / 左右の肩 → 肘 → 手) と hips → 左右の (股関節 → 膝 → 足首)。
// 歩き・走りは「足が着地している間は地面から浮かない・めり込まない」ように、
// 股関節の高さを脚の角度から毎フレーム計算して決める (本物の歩行の上下動はこれで自然に出る)。
// public/models/player.vrm があれば、その VRM キャラに差し替える (動きの角度は同じものを VRM の人型ボーンへ渡す)。
// 無い・読めないときは、下で作る組み立て式のキャラのまま動く。
import * as THREE from 'three';

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

export function makeCharacter() {
  const gm = gradientMap();
  // 暗所でも見えるよう、色の一部を自己発光させる (アニメ調の見え方)
  const toon = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: gm, emissive: new THREE.Color(c).multiplyScalar(0.22) });
  const M = {
    skin: toon('#f6d9c6'), hair: toon('#3a2a36'), jacket: toon('#26324d'), accent: toon('#5fd3ff'),
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
    lastYaw: 0, roll: 0, stair: 0, a1: 0.35, v1: 0, a2: 0.15, v2: 0,
    actW: 0, actPose: null, anchor: null,
  };

  // ---- パルクール (player.js が渡す act = { type, s, ly, lz }) ----
  //   s: 進み具合 0〜1、ly: 足元から見た縁の高さ、lz: 体の中心から縁までの前方向の距離 (越えた後は負)
  // 腕は、肩から縁へ届くように 2 本の骨の角度を計算で決める (体の前後の面の中だけ)。
  // 残った高さのずれは、手が縁の高さに来るよう腰の高さを動かして合わせる (st.anchor → applyAnchor)
  const SH_UP = 0.42, ARM_A = 0.27, ARM_B = 0.26; // 腰から肩までの高さ、上腕・前腕の長さ
  // 肩から (前 dz, 上 dy) にある点へ手を伸ばす。pitch = 胴の前傾。返り値は [上腕の x 回転, 肘の x 回転]
  function reach(dz, dy, pitch) {
    const d = clamp(Math.hypot(dz, dy), 0.14, ARM_A + ARM_B - 0.004);
    const dirA = Math.atan2(dz, -dy); // 0 = 真下、π/2 = 前、π = 真上
    const beta = Math.acos(clamp((ARM_A * ARM_A + d * d - ARM_B * ARM_B) / (2 * ARM_A * d), -1, 1));
    const gamma = Math.acos(clamp((ARM_A * ARM_A + ARM_B * ARM_B - d * d) / (2 * ARM_A * ARM_B), -1, 1));
    return [-(dirA - beta) - pitch, -(PI - gamma)];
  }
  function actPose(act, Aa) {
    const X = pose();
    const s = act.s, hy = IDLE_EXT + HIP_DROP;
    const leg = (th, kn, ft, h, k, side) => { X[th] = [-h, 0, side * 0.03]; X[kn] = [k, 0, 0]; X[ft] = [0.35, 0, 0]; };
    if (act.type === 'climb') {
      // 0〜0.18 縁をつかむ → 〜0.62 体を引き上げる (足は壁をかく) → 〜1 片膝を縁にかけて立つ
      const pu = sstep(0.18, 0.62, s), up = sstep(0.6, 0.95, s);
      const P = 0.06 + 0.5 * sstep(0.35, 0.66, s) * (1 - sstep(0.76, 1, s)); // 胴の前傾 (縁の上へ上体をかぶせる)
      X.hips[0] = P * 0.55; X.spine[0] = P * 0.2; X.chest[0] = P * 0.25;
      X.neck[0] = -0.3 * (1 - pu) - P * 0.2; X.head[0] = -0.35 * (1 - pu) - P * 0.25; // はじめは縁を見上げる
      const scr = sstep(0.08, 0.22, s) * (1 - up), kick = Math.sin(s * 22);
      let hL = 0.3 + 0.4 * kick * scr, kL = 0.65 + 0.45 * kick * scr, hR = 0.3 - 0.4 * kick * scr, kR = 0.65 - 0.45 * kick * scr;
      const inL = sstep(0, 0.4, up), outL = 1 - sstep(0.5, 1, up), inR = sstep(0.25, 0.65, up), outR = 1 - sstep(0.7, 1, up);
      hL = mix(hL, 1.75, inL) * outL; kL = mix(kL, 2.05, inL) * outL;
      hR = mix(hR, 1.0, inR) * outR; kR = mix(kR, 1.7, inR) * outR;
      leg('thL', 'knL', 'ftL', hL, kL, 1); leg('thR', 'knR', 'ftR', hR, kR, -1);
      const w = sstep(0, 0.14, s) * (1 - sstep(0.74, 0.92, s));
      const [sx, ex] = reach(act.lz + 0.06 - SH_UP * Math.sin(P), act.ly + 0.05 - (hy + SH_UP * Math.cos(P)), P);
      for (const [sh, el, ha, side] of [['shL', 'elL', 'haL', 1], ['shR', 'elR', 'haR', -1]]) {
        X[sh] = [mix(Aa[sh][0], sx, w), 0, mix(Aa[sh][2], side * 0.06, w)];
        X[el] = [mix(Aa[el][0], ex, w), 0, 0];
        X[ha] = [0, 0, side * 0.2];
      }
      st.anchor = { w, y: act.ly + 0.05, hands: ['haL', 'haR'], lim: 0.4 };
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

  function update(dt, speed, onGround, vy, stair = 0, act = null) {
    updateInner(dt, speed, onGround, vy, stair, act);
    if (vrmRig) applyVRM(dt);
  }

  function updateInner(dt, speed, onGround, vy, stair, act) {
    dt = Math.max(1e-4, Math.min(dt, 0.1));
    const sdt = Math.min(dt, 1 / 30); // ばね用 (大きすぎる dt で暴れないように)
    const sp = speed;
    st.t += dt;
    const rate = (r) => 1 - Math.exp(-dt * r);

    // --- 状態 ---
    if (!onGround) { st.lastVy = vy; st.wasAir = true; }
    else if (st.wasAir) { st.land = clamp(-st.lastVy / 14, 0.2, 1); st.wasAir = false; }
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

    // --- パルクールの姿勢 (終わった後は、最後の姿勢からふつうの姿勢へ戻す) ---
    st.anchor = null;
    if (act) st.actPose = actPose(act, Aa);
    st.actW += ((act ? 1 : 0) - st.actW) * rate(act ? 30 : 10);
    if (st.actW < 0.01 && !act) st.actPose = null;
    const X = st.actPose, xw = X ? st.actW : 0;

    // --- 反映 ---
    const k = rate(act ? 40 : onGround ? 28 : 14);
    for (const n of NAMES) {
      const b = BONE[n].rotation;
      const tg = G[n], ta = Aa[n];
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
  const Q = THREE.Quaternion, ZAX = new THREE.Vector3(0, 0, 1), YAX = new THREE.Vector3(0, 1, 0);
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
    // この VRM の足の実際の位置から、いちばん低い足裏が地面 (y=0) に来るよう腰の高さを直す (空中では直さない)
    const gnd = 1 - st.airW;
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

  async function loadVRM(url) {
    try {
      const head = await fetch(url, { method: 'HEAD' });
      if (!head.ok) return; // モデルが置かれていなければ何もしない
      const [{ GLTFLoader }, { VRMLoaderPlugin, VRMUtils }] = await Promise.all([
        import('three/addons/loaders/GLTFLoader.js'), import('@pixiv/three-vrm'),
      ]);
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      const gltf = await loader.loadAsync(url);
      const vrm = gltf.userData.vrm;
      if (!vrm) throw new Error('VRM ではないファイル');
      VRMUtils.removeUnnecessaryVertices?.(gltf.scene);
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
      vrmRig = { vrm, scale, nodes, minY, soles, fingers, flip: vrm.meta?.metaVersion === '0' }; // 腰の高さは、以後 applyVRM が毎フレーム決める
      body.visible = false;
      root.add(vrm.scene);
      console.info('VRM を読み込みました: ' + url);
    } catch (e) {
      console.warn('VRM を読み込めなかったので、組み立て式のキャラのままにします:', e);
    }
  }
  const ready = loadVRM(new URL('../models/player.vrm', import.meta.url).href); // VRM の読み込み (有無にかかわらず) が済むと解決する

  return { root, update, ready, bones: BONE };
}
