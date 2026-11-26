// 千葉ドリームランドの入口 (エントランス) の「寸法だけ」の計算。描かない (three を読まない)。
// 描画 (detail/parkentrance.js)・歩く人の障害物 (crowdsim.js)・確認用の道具 (tools/dev/entrancecheck.js) が、同じ数字を使うために分けてある。
// 局所座標: gate.at が原点、u = 入ってくる人から見て右 (face の右手 = (face.z, -face.x))、v = 外 (face の向き = 駅の側) へ + の m。園の内側は v が負。
//   板・箱の向き (yaw) = atan2(face.x, face.z)。局所の +z が v、+x が u になる (当たり判定 box の [x, z, yaw, 半幅 u, 半幅 v] と同じ向き)。

export function entranceFrame(cfg) {
  const [gx, gz] = cfg.gate.at, [fx, fz] = cfg.gate.face, rx = fz, rz = -fx;
  return {
    gx, gz, fx, fz, rx, rz, yaw: Math.atan2(fx, fz),
    W: (u, v) => [gx + rx * u + fx * v, gz + rz * u + fz * v],
    L: (x, z) => [(x - gx) * rx + (z - gz) * rz, (x - gx) * fx + (z - gz) * fz],
  };
}

function inPoly(x, z, p) {
  let ins = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
function segDist(px, pz, a, b) {
  const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * ex + (pz - a[1]) * ez) / l2));
  return Math.hypot(px - (a[0] + ex * t), pz - (a[1] + ez * t));
}

// 前庭の左右の壁。広間の端 (局所 u = ∓half, v = v0) から外へ、敷地の柵に届くまで。端は柵の外へ 0.6 m 出す (すき間を作らない)
// left = 真っすぐ外へ (v 方向)。right = 柵に直角に近い向き (wings.rightDir = [u, v])。返す = { left: [[x, z], [x, z]], right: [[x, z], [x, z]] } (ワールド)
export function wingWalls(cfg) {
  const E = cfg.entrance, F = entranceFrame(cfg), site = cfg.site, h = E.hall.half, v0 = E.wings.v0;
  const march = (u, v, du, dv) => {
    const n = Math.hypot(du, dv); du /= n; dv /= n;
    let last = [u, v];
    for (let s = 0; s < 400; s += 0.25) {
      const q = [u + du * s, v + dv * s], w = F.W(q[0], q[1]);
      if (!inPoly(w[0], w[1], site)) return [u + du * (s + 0.6), v + dv * (s + 0.6)];
      last = q;
    }
    return last;
  };
  const l1 = march(-h, v0, 0, 1), r1 = march(h, v0, E.wings.rightDir[0], E.wings.rightDir[1]);
  return { left: [F.W(-h, v0), F.W(l1[0], l1[1])], right: [F.W(h, v0), F.W(r1[0], r1[1])], leftL: [[-h, v0], l1], rightL: [[h, v0], r1] };
}

// 前庭の舗装の多角形 (局所 [u, v]。広間の前の縁 → 左の壁 → 敷地の柵 (頂点をたどる) → 右の壁 → 戻る)
export function forecourtPolygon(cfg) {
  const E = cfg.entrance, F = entranceFrame(cfg), site = cfg.site, ww = wingWalls(cfg), h = E.hall.half, v0 = E.wings.v0;
  const edgeOf = (q) => { let best = 0, bd = 1e9; for (let i = 0; i < site.length; i++) { const d = segDist(q[0], q[1], site[i], site[(i + 1) % site.length]); if (d < bd) { bd = d; best = i; } } return best; };
  const a = ww.left[1], b = ww.right[1], ia = edgeOf(a), ib = edgeOf(b);
  // 左の壁の端から右の壁の端まで、敷地の頂点をたどる (頂点の少ないほうの回り)
  const n = site.length, fwd = [], bwd = [];
  for (let i = (ia + 1) % n, k = 0; k < n; i = (i + 1) % n, k++) { fwd.push(i); if (i === ib) break; }          // 左の端の辺の次の頂点 → 右の端の辺の始まり (順回り)
  for (let i = ia, k = 0; k < n; i = (i + n - 1) % n, k++) { bwd.push(i); if (i === (ib + 1) % n) break; }    // 左の端の辺の始まり → 右の端の辺の次の頂点 (逆回り)
  const way = ia === ib ? [] : (fwd.length <= bwd.length ? fwd : bwd);
  const mid = way.map((i) => F.L(site[i][0], site[i][1]));
  return [[-h, v0], ww.leftL[1], ...mid, ww.rightL[1], [h, v0]];
}

// 配置 (ワールドではなく局所)
export function entranceLayout(cfg) {
  const E = cfg.entrance, H = E.hall, B = E.booths;
  const dividers = [], lanes = [];
  for (const s of [-1, 1]) {
    for (let d = 0; d <= H.lanes; d++) dividers.push(s * (H.laneFrom + d * H.pitch));
    for (let k = 0; k < H.lanes; k++) lanes.push(s * (H.laneFrom + (k + 0.5) * H.pitch));
  }
  const booths = [];
  for (const s of [-1, 1]) for (let i = 0; i < B.count; i++) booths.push({ u: s * (B.from + B.w / 2 + i * B.pitch), v: B.v, side: s });
  return { dividers, lanes, booths, v0: H.v - H.depth / 2, v1: H.v + H.depth / 2 };
}

// 歩く人 (園内) が重ならないよう、描く位置を外へ押し出す円 [[x, z, 半径]]。局所 (u, v) → ワールド
export function entranceObstacles(cfg) {
  if (!cfg || !cfg.entrance) return [];
  const E = cfg.entrance, F = entranceFrame(cfg), L = entranceLayout(cfg), H = E.hall, out = [];
  const c = (u, v, r) => { const w = F.W(u, v); out.push([w[0], w[1], r]); };
  for (const s of [-1, 1]) {
    c(s * ((H.open + H.pylon) / 2), H.v, 4.2); c(s * ((H.open + H.pylon) / 2), H.v - 4, 3.2); c(s * ((H.open + H.pylon) / 2), H.v + 4, 3.2);   // 大門の柱
    c(s * H.towerU, H.v, H.towerR + 0.4);                                                                                              // 塔
    for (let k = -1; k <= 1; k++) c(s * (H.half - 3), H.v + k * 4, 3.2);                                                                // 端の小屋
  }
  for (const b of L.booths) { c(b.u - 0.8, b.v, 1.8); c(b.u + 0.8, b.v, 1.8); }                                                           // 切符売り場
  for (const k of E.kiosks) { c(k.u - k.w / 4, k.v, k.d / 2 + 0.3); c(k.u + k.w / 4, k.v, k.d / 2 + 0.3); }                               // 案内所
  const m = E.berm; for (let i = -2; i <= 2; i++) c(i * m.rx / 2.4, m.v, m.rz + 0.8);                                                     // 花の築山
  return out;
}
