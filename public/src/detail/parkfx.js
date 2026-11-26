// 千葉ドリームランド 段階 7: 旗の飾り (通りをまたぐ綱 + 三角旗。そよ風でゆれる) と煙突の煙 (近くの煙突だけ)。
// 旗の位置は tools/park_areas.py の bunting (data/park_areas.json のテーマの detail.bunting)、煙突の位置は parkfacade.js が建物ごとに知らせる。
// ゆれ・煙は頂点シェーダ / 毎コマの行列の更新 (update)。見た目だけで当たり判定は無い。
import * as THREE from 'three';

export function buildBunting({ gen, ground, group }) {
  const pos = [], nor = [], col = [], sway = [];
  const C = (s) => new THREE.Color(s);
  const push = (p, n, c, sw) => { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); col.push(c.r, c.g, c.b); sway.push(sw[0], sw[1]); };
  const cord = C('#4b4561'), lanterns = [];   // lanterns = ちょうちん [x, y, z, 色]
  (gen.bunting || []).forEach((st, si) => {
    const [x1, z1, x2, z2, y, ai] = st, colors = (gen.areas[ai] && gen.areas[ai].bunting || ['#ff7fb5', '#ffffff']).map(C);
    const A = [x1, ground(x1, z1) + y, z1], B = [x2, ground(x2, z2) + y, z2];
    const len = Math.hypot(B[0] - A[0], B[2] - A[2]), sag = Math.min(2.2, 0.055 * len), N = Math.max(4, Math.round(len / 1.0));
    const dx = (B[0] - A[0]) / len, dz = (B[2] - A[2]) / len, nx = -dz, nz = dx;   // 綱に直角 (旗の面の法線)
    const pt = (i) => { const u = i / N; return [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u - 4 * sag * u * (1 - u), A[2] + (B[2] - A[2]) * u]; };
    for (let i = 0; i < N; i++) {
      const p = pt(i), q = pt(i + 1), c = colors[(i + si) % colors.length], ph = i * 0.9 + si * 1.7;
      // 綱 (細い板を十字に)
      for (const [ox, oy, oz] of [[0, 0.025, 0], [nx * 0.025, 0, nz * 0.025]]) {
        const a = [p[0] - ox, p[1] - oy, p[2] - oz], b = [p[0] + ox, p[1] + oy, p[2] + oz], d = [q[0] - ox, q[1] - oy, q[2] - oz], e = [q[0] + ox, q[1] + oy, q[2] + oz];
        for (const v of [a, b, e, a, e, d]) push(v, [0, 1, 0], cord, [0, 0]);
      }
      if (i % 4 === 2) { lanterns.push([p[0], p[1] - 0.45, p[2], c]); continue; }   // 4 つめごとに旗のかわりにちょうちん
      // 三角旗 (綱から下へ)。先のとがりほどゆれる
      const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], g = 0.1;
      const t0 = [p[0] + (q[0] - p[0]) * g, p[1] + (q[1] - p[1]) * g - 0.02, p[2] + (q[2] - p[2]) * g], t1 = [q[0] - (q[0] - p[0]) * g, q[1] - (q[1] - p[1]) * g - 0.02, q[2] - (q[2] - p[2]) * g], tip = [m[0], m[1] - 0.78, m[2]];
      push(t0, [nx, 0, nz], c, [0.12, ph]); push(t1, [nx, 0, nz], c, [0.12, ph]); push(tip, [nx, 0, nz], c, [1, ph]);
    }
  });
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 2));
  g.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = { value: 0 }; mat.userData.sh = sh;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aSway;\nuniform float uTime;').replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normal * sin(uTime * 2.4 + aSway.y) * 0.17 * aSway.x;');
  };
  const mesh = new THREE.Mesh(g, mat); mesh.name = 'park_bunting'; mesh.castShadow = false; group.add(mesh);
  return { mesh, lanterns, strings: gen.bunting.length, tris: pos.length / 9, update: (t) => { if (mat.userData.sh) mat.userData.sh.uniforms.uTime.value = t; } };
}

// 煙突の煙: 近く (90 m 以内) の煙突のうち近い順に最大 N 本、それぞれ 3 つの丸い煙をゆっくり上へ流す。
export function buildSmoke({ chimneys, group, low }) {
  if (!chimneys.length) return null;
  const MAXN = low ? 12 : 36, PER = 3, R = 90;
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ color: '#dcd8e2', roughness: 1, transparent: true, opacity: 0.5, depthWrite: false }), MAXN * PER);
  mesh.name = 'park_smoke'; mesh.frustumCulled = false; mesh.castShadow = false; mesh.count = 0; group.add(mesh);
  const M = new THREE.Matrix4(), Pv = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3();
  return {
    mesh, count: chimneys.length,
    update(t, x, z) {
      const near = [];
      for (let i = 0; i < chimneys.length; i++) { const c = chimneys[i], d = (c[0] - x) * (c[0] - x) + (c[2] - z) * (c[2] - z); if (d < R * R) near.push([d, i]); }
      if (near.length > MAXN) { near.sort((a, b) => a[0] - b[0]); near.length = MAXN; }
      let n = 0;
      for (const [, i] of near) {
        const c = chimneys[i];
        for (let k = 0; k < PER; k++) {
          const u = (t * 0.2 + k / PER + i * 0.37) % 1, s = 0.12 + 0.95 * Math.pow(Math.sin(Math.PI * u), 0.7);
          Pv.set(c[0] + 0.9 * u * 3.4 + Math.sin(t + i + k) * 0.15, c[1] + u * 3.8, c[2] + 0.3 * u * 3.4);
          M.compose(Pv, Q, S.set(s, s * 0.9, s)); mesh.setMatrixAt(n++, M);
        }
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
