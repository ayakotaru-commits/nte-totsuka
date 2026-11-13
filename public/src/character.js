// 仮キャラクター (プリミティブ + トゥーン + アウトライン)。後で VRM に差し替える前提。
import * as THREE from 'three';

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
  };
  const outlineMat = new THREE.MeshBasicMaterial({ color: '#15151d', side: THREE.BackSide });

  const part = (geo, mat, pos, size = 0.1, outline = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.castShadow = true;
    if (outline) {
      const o = new THREE.Mesh(geo, outlineMat);
      o.scale.setScalar(1 + 0.005 / size);
      m.add(o);
    }
    return m;
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // 脚
  const legs = [-1, 1].map(s => {
    const g = new THREE.Group();
    g.position.set(0.085 * s, 0.86, 0);
    g.add(part(new THREE.CapsuleGeometry(0.068, 0.62, 4, 10), M.pants, [0, -0.39, 0], 0.07));
    g.add(part(new THREE.BoxGeometry(0.11, 0.08, 0.22), M.shoe, [0, -0.81, 0.035], 0.08));
    body.add(g);
    return g;
  });

  // 胴体
  const torso = part(new THREE.CapsuleGeometry(0.15, 0.28, 4, 12), M.jacket, [0, 1.1, 0], 0.15);
  torso.scale.set(1, 1, 0.72);
  body.add(torso);
  const collar = part(new THREE.ConeGeometry(0.07, 0.16, 3), M.shirt, [0, 1.25, 0.1], 0.05, false);
  collar.rotation.set(-0.15, 0, Math.PI);
  collar.scale.set(1, 1, 0.3);
  body.add(collar);
  body.add(part(new THREE.BoxGeometry(0.31, 0.035, 0.23), M.accent, [0, 0.92, 0], 0.05, false));
  body.add(part(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 8), M.skin, [0, 1.36, 0], 0.05, false));

  // 頭
  const head = new THREE.Group();
  head.position.set(0, 1.5, 0);
  head.add(part(new THREE.SphereGeometry(0.135, 20, 16), M.skin, [0, 0, 0], 0.135));
  head.add(part(new THREE.SphereGeometry(0.15, 20, 16), M.hair, [0, 0.04, -0.03], 0.15));
  const tail = part(new THREE.CapsuleGeometry(0.06, 0.22, 4, 8), M.hair, [0, -0.12, -0.13], 0.06);
  tail.rotation.x = 0.35;
  head.add(tail);
  for (const s of [-1, 1]) {
    const eye = part(new THREE.SphereGeometry(0.022, 10, 8), M.eye, [0.05 * s, -0.01, 0.125], 0.02, false);
    eye.scale.set(1, 1.5, 0.5);
    head.add(eye);
  }
  body.add(head);

  // 腕
  const arms = [-1, 1].map(s => {
    const g = new THREE.Group();
    g.position.set(0.2 * s, 1.3, 0);
    g.rotation.z = 0.1 * s;
    g.add(part(new THREE.CapsuleGeometry(0.05, 0.42, 4, 8), M.jacket, [0, -0.26, 0], 0.05));
    g.add(part(new THREE.SphereGeometry(0.045, 10, 8), M.skin, [0, -0.53, 0], 0.045));
    body.add(g);
    return g;
  });

  let phase = 0, t = 0;
  function update(dt, speed, onGround, vy) {
    t += dt;
    const lerp = 1 - Math.exp(-dt * 14);
    let legA = 0, armA = 0, bob = 0, lean = 0, armOut = 0;
    if (!onGround) {
      legA = vy > 0 ? 0.7 : 0.35; armOut = 0.7; lean = 0.05;
      legs[0].rotation.x += (-legA - legs[0].rotation.x) * lerp;
      legs[1].rotation.x += (legA * 0.3 - legs[1].rotation.x) * lerp;
      arms[0].rotation.x += (-0.4 - arms[0].rotation.x) * lerp;
      arms[1].rotation.x += (0.3 - arms[1].rotation.x) * lerp;
    } else if (speed > 0.15) {
      phase += dt * (4 + speed * 1.15);
      const amp = Math.min(1.0, 0.35 + speed * 0.07);
      const sw = Math.sin(phase);
      legs[0].rotation.x = sw * amp; legs[1].rotation.x = -sw * amp;
      arms[0].rotation.x = -sw * amp * 0.85; arms[1].rotation.x = sw * amp * 0.85;
      bob = Math.abs(Math.cos(phase)) * 0.05 * Math.min(1, speed / 4);
      lean = Math.min(0.22, speed * 0.02);
    } else {
      for (const l of [...legs, ...arms]) l.rotation.x *= 1 - lerp;
      bob = Math.sin(t * 2) * 0.006;
    }
    arms[0].rotation.z += (-(0.1 + armOut) - arms[0].rotation.z) * lerp;
    arms[1].rotation.z += ((0.1 + armOut) - arms[1].rotation.z) * lerp;
    body.position.y = bob;
    body.rotation.x += (lean - body.rotation.x) * lerp;
  }

  return { root, update };
}
