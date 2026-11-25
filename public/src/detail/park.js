// フェアリー・リールパーク (舞浜の北側に作る架空のテーマパーク。計画は PARK_PLAN.md、設定は data/park.json → tools/park.py → data/park.json (public))。
// 段階 0 (土台の試作): (1) 敷地の中の実在の道路・木・橋脚・建物・歩道を、線路の延長 (detail/railext.js) の区間を読んだ後に省く仕組み (parkCut)、
// (2) 試作として、ゲートの看板と、サンライズ・プラザの円だけを置く (buildPark)。
// 区間のファイル (data/rail_ext/c_*.json) は書き換えない。省くのは読んだ後 (メモリの上)。省く対象は、敷地の中で、舞浜駅の駅舎・駅前の範囲 (protect) の外。
import * as THREE from 'three';
import { H } from '../terrain.js';
import { canvasTexture } from './util.js';

const bboxOf = (p) => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return [x0, z0, x1, z1];
};
function inPoly(x, z, p) {
  let ins = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}

// 敷地の中の実在のデータを省く。cfg = public/data/park.json
export function createParkCut(cfg) {
  const site = cfg.site, [bx0, bz0, bx1, bz1] = bboxOf(site);
  const prot = (cfg.protect || []).map((q) => ({ poly: q.poly, box: bboxOf(q.poly) }));
  const protectedAt = (x, z) => prot.some((q) => x >= q.box[0] && x <= q.box[2] && z >= q.box[1] && z <= q.box[3] && inPoly(x, z, q.poly));
  const hidden = (x, z) => x >= bx0 && x <= bx1 && z >= bz0 && z <= bz1 && inPoly(x, z, site) && !protectedAt(x, z);
  // 道・歩道 ([幅, x0, z0, x1, z1, ...]) を、4 m ずつの区切りの中点が省く範囲に入るものを除いて切り分ける。敷地にかからない線は元のまま
  function clipLine(rd) {
    let touch = false;
    for (let k = 1; k + 1 < rd.length; k += 2) if (rd[k] >= bx0 - 5 && rd[k] <= bx1 + 5 && rd[k + 1] >= bz0 - 5 && rd[k + 1] <= bz1 + 5) { touch = true; break; }
    if (!touch) return [rd];
    const out = []; let cur = null, any = false;
    for (let k = 1; k + 3 < rd.length; k += 2) {
      const ax = rd[k], az = rd[k + 1], bx = rd[k + 2], bz = rd[k + 3], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4));
      for (let t = 0; t < n; t++) {
        const x0 = ax + (bx - ax) * t / n, z0 = az + (bz - az) * t / n, x1 = ax + (bx - ax) * (t + 1) / n, z1 = az + (bz - az) * (t + 1) / n;
        if (hidden((x0 + x1) / 2, (z0 + z1) / 2)) { any = true; cur = null; continue; }
        if (!cur) { cur = [rd[0], x0, z0]; out.push(cur); }
        cur.push(x1, z1);
      }
    }
    return any ? out : [rd];
  }
  const clipLines = (list) => { const out = []; for (const rd of list || []) out.push(...clipLine(rd)); return out; };
  return {
    hidden, clipLines,
    // 区間 D (railext.js が読んだ JSON) から省く。省いた数を返す
    cutChunk(D) {
      const n0 = (D.trees || []).length + (D.piers || []).length + (D.buildings || []).length + (D.roads || []).length + (D.walks || []).length;
      if (D.trees) D.trees = D.trees.filter((t) => !hidden(t[0], t[2]));
      if (D.piers) D.piers = D.piers.filter((t) => !hidden(t[0], t[2]));
      if (D.buildings) D.buildings = D.buildings.filter((b) => { const r = b[0]; let cx = 0, cz = 0; for (const q of r) { cx += q[0]; cz += q[1]; } return !hidden(cx / r.length, cz / r.length); });
      if (D.roads) D.roads = clipLines(D.roads);
      if (D.walks) D.walks = clipLines(D.walks);
      return n0 - ((D.trees || []).length + (D.piers || []).length + (D.buildings || []).length + (D.roads || []).length + (D.walks || []).length);
    },
  };
}

// 試作: ゲートの看板 (柱 2 本 + 名前の板) と、サンライズ・プラザの円、駅からゲートへの道・ネオン・アベニューの帯。
// 区間 (地形) を読み込んだ後でないと地面の高さが分からないので、update(x, z) を毎コマ呼び、地形が読めたら 1 回だけ作る
export function buildPark(cfg, world) {
  const group = new THREE.Group();
  group.name = 'park';
  let built = false;
  const gate = cfg.gate, pz = cfg.ellipses['サンライズ・プラザ'];
  const ground = (x, z) => H(x, z);
  const ready = () => ground(gate.at[0], gate.at[1]) > -100 && ground(pz.center[0], pz.center[1]) > -100 && ground(pz.center[0] + pz.rx, pz.center[1]) > -100;

  // 地面に沿った帯 (道) と、楕円 (広場)。上面は地面 + lift (道路 0.12・歩道 0.15 のあいだに入らないよう、ここでは 0.2)
  function strip(pts, w, color, lift) {
    const pos = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 3));
      const nx = -(bz - az) / L * w / 2, nz = (bx - ax) / L * w / 2;
      for (let t = 0; t < n; t++) {
        const x0 = ax + (bx - ax) * t / n, z0 = az + (bz - az) * t / n, x1 = ax + (bx - ax) * (t + 1) / n, z1 = az + (bz - az) * (t + 1) / n;
        const q = [[x0 + nx, z0 + nz], [x0 - nx, z0 - nz], [x1 - nx, z1 - nz], [x1 + nx, z1 + nz]].map(([x, z]) => [x, ground(x, z) + lift, z]);
        for (const i2 of [0, 1, 2, 0, 2, 3]) pos.push(...q[i2]);
      }
    }
    return flat(pos, color);
  }
  function flat(pos, color) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    m.receiveShadow = true;
    return m;
  }
  function ellipse(c, rx, rz, color, lift) {
    const pos = [], R = 12, S = 72;
    const at = (r, a) => { const x = c[0] + rx * r * Math.cos(a), z = c[1] + rz * r * Math.sin(a); return [x, ground(x, z) + lift, z]; };
    for (let i = 0; i < R; i++) for (let k = 0; k < S; k++) {
      const a0 = k / S * Math.PI * 2, a1 = (k + 1) / S * Math.PI * 2, r0 = i / R, r1 = (i + 1) / R;
      const p00 = at(r0, a0), p01 = at(r0, a1), p10 = at(r1, a0), p11 = at(r1, a1);
      if (i === 0) pos.push(...p00, ...p11, ...p10); else pos.push(...p00, ...p01, ...p11, ...p00, ...p11, ...p10);
    }
    return flat(pos, color);
  }

  function signTexture() {
    return canvasTexture(1024, 256, (g) => {
      const grad = g.createLinearGradient(0, 0, 1024, 0);
      grad.addColorStop(0, '#ff7fb5'); grad.addColorStop(0.5, '#8f7bff'); grad.addColorStop(1, '#3fc8ff');
      g.fillStyle = grad; g.fillRect(0, 0, 1024, 256);
      g.strokeStyle = '#fff6c9'; g.lineWidth = 10; g.strokeRect(12, 12, 1000, 232);
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = 'rgba(60,20,110,0.6)'; g.shadowBlur = 8;
      g.font = 'bold 92px sans-serif'; g.fillText(cfg.name, 512, 100, 940);
      g.font = '600 46px sans-serif'; g.fillText(cfg.roman || '', 512, 198, 900);
    });
  }

  function build() {
    built = true;
    const [gx, gz] = gate.at, fx = gate.face[0], fz = gate.face[1], yaw = Math.atan2(fx, fz);   // 局所 +Z = 表の向き
    const rx = fz, rz = -fx;   // 局所 +X (柱の並ぶ向き)
    const half = gate.span / 2, H0 = gate.post;
    const gy = ground(gx, gz);
    const sg = new THREE.Group();
    sg.position.set(gx, gy, gz); sg.rotation.y = yaw;
    const post = new THREE.MeshStandardMaterial({ color: '#e9e2f5', roughness: 0.6 });
    const colliders = [];
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, H0 + 1, 12), post);
      m.position.set(s * half, (H0 + 1) / 2 - 1, 0); m.castShadow = true;
      sg.add(m);
      const px = gx + rx * s * half, pz2 = gz + rz * s * half;
      const y = ground(px, pz2);
      colliders.push([px, pz2, 0.65, y - 1, y + H0]);
    }
    const board = new THREE.Mesh(new THREE.BoxGeometry(gate.span + 1.6, 3.6, 0.5),
      [post, post, post, post, new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.55 }), new THREE.MeshStandardMaterial({ color: '#7f6ad9', roughness: 0.6 })]);
    board.position.set(0, H0 - 0.6, 0); board.castShadow = true;
    sg.add(board);
    group.add(sg);
    world.addColliders({ circle: colliders }, true);   // 柱の当たり判定 (V キーに関係なく。柱の間は通れる)
    for (const p of cfg.paths) group.add(strip(p.pts, p.width, p.name === 'ネオン・アベニュー' ? '#e3b9d0' : '#d8cdbd', 0.2));
    group.add(ellipse(pz.center, pz.rx, pz.rz, cfg.plaza.color, cfg.plaza.lift));
    console.info(`[park] ${cfg.name}: 試作を作った (ゲート ${gate.at}、広場 ${pz.center}、地面の高さ ${gy.toFixed(2)} m)`);
  }
  return {
    group,
    // カメラの位置。区間 (地形) を読み込めたら試作を作る。敷地の 1.2 km 以内のときだけ調べる
    update(x, z) {
      if (built || Math.hypot(x - gate.at[0], z - gate.at[1]) > 1200) return;
      if (ready()) build();
    },
    get built() { return built; },
  };
}
