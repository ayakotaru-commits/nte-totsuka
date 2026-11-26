// フェアリー・リールパークの地図の下絵 (ミニマップ・大きい地図)。線路の延長の下絵 (detail/railext.js の map) と同じ形: { bounds, draw(c, X, Z, scale, bbox) }。
// X(x)・Z(z) = ワールドの座標 → 画面の座標、scale = 1 m の画面上の長さ (px)、bbox = 見えている範囲 [x0, z0, x1, z1]。
// 描くもの: 敷地 (実在の舞浜の道・建物の絵の上に塗りつぶす)・エリアの色・湖・プラザ・園内の道・建物・観覧車・コースター。実在のパークの絵は使わない (この設定から描く)。
const AREA_TINT = ['#d9d2ea', '#e9e3d4', '#f4dbe8', '#e2d6c0', '#fbe0ee', '#cfe6c4', '#cfe1ef'];   // gen.areas の順 (ミッドナイト・ターボ・アベニュー・バレー・スイート・フォレスト・ハーバー)

export function createParkMap(cfg) {
  const site = cfg.site, xs = site.map((p) => p[0]), zs = site.map((p) => p[1]);
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  const names = Object.keys(cfg.areas || {}), ell = cfg.ellipses || {}, gen = cfg.gen || null;
  const draw = (c, X, Z, scale, bbox) => {
    if (bbox[2] < bounds.minX || bbox[0] > bounds.maxX || bbox[3] < bounds.minZ || bbox[1] > bounds.maxZ) return;
    c.save();
    c.lineCap = c.lineJoin = 'round';
    const poly = (ring) => { ring.forEach(([x, z], i) => (i ? c.lineTo(X(x), Z(z)) : c.moveTo(X(x), Z(z)))); c.closePath(); };
    // 敷地
    c.fillStyle = '#d6e9c4'; c.beginPath(); poly(site); c.fill();
    c.strokeStyle = '#9b7fd6'; c.lineWidth = Math.max(1.5, 2.5 * Math.min(1, scale * 3)); c.stroke();
    // エリア (うすい色)
    names.forEach((n, i) => { c.fillStyle = AREA_TINT[i % AREA_TINT.length]; c.globalAlpha = 0.7; c.beginPath(); poly(cfg.areas[n]); c.fill(); });
    c.globalAlpha = 1;
    const ellipse = (e, fill) => { c.fillStyle = fill; c.beginPath(); c.ellipse(X(e.center[0]), Z(e.center[1]), e.rx * scale, e.rz * scale, 0, 0, Math.PI * 2); c.fill(); };
    if (ell['サンライズ・プラザ']) ellipse(ell['サンライズ・プラザ'], '#f7eed9');
    if (ell['ムーンレイク']) { ellipse(ell['ムーンレイク'], '#8fc6ea'); }
    // 城 (段階 9): 島・堤道・城壁・塔 (屋根の色)
    if (cfg.castle) {
      const K = cfg.castle, cs = Math.cos(K.yaw), sn = Math.sin(K.yaw), toW = (lx, lz) => [K.center[0] + lx * cs + lz * sn, K.center[1] - lx * sn + lz * cs];
      c.fillStyle = '#a9d68c'; c.beginPath(); c.ellipse(X(K.center[0]), Z(K.center[1]), K.island.rx * scale, K.island.rz * scale, 0, 0, Math.PI * 2); c.fill();
      const ln = (pts, w, col) => { c.strokeStyle = col; c.lineWidth = Math.max(1.2, w * scale); c.lineCap = 'butt'; c.beginPath(); pts.forEach(([lx, lz], i) => { const [x, z] = toW(lx, lz); i ? c.lineTo(X(x), Z(z)) : c.moveTo(X(x), Z(z)); }); c.stroke(); c.lineCap = 'round'; };
      for (const cw of K.causeways) ln([[0, Math.sign(cw.to) * (Math.abs(cw.from) - 4)], [0, cw.to]], cw.width, '#ffffff');
      for (const w of K.walls) for (const sd of [1, -1]) ln(w.pts.map(([x, z]) => [sd * x, z]), w.t, '#a99fbd');
      for (const g of K.gates) ln([[-g.w, (g.z0 + g.z1) / 2], [g.w, (g.z0 + g.z1) / 2]], g.z1 - g.z0, '#cfc6dd');
      for (const T of K.towers) for (const sd of (T.mirror === false ? [1] : [1, -1])) {
        const [x, z] = toW(sd * T.x, T.z);
        c.fillStyle = K.colors[T.roof.color] || '#9b7fd6'; c.strokeStyle = '#ffffff'; c.lineWidth = 1;
        c.beginPath(); c.arc(X(x), Z(z), Math.max(1.5, T.tiers[0].r * scale), 0, Math.PI * 2); c.fill(); if (scale >= 0.3) c.stroke();
      }
    }
    // 道
    const line = (pts, w, col) => { c.strokeStyle = col; c.lineWidth = Math.max(1.5, w * scale); c.beginPath(); pts.forEach(([x, z], i) => (i ? c.lineTo(X(x), Z(z)) : c.moveTo(X(x), Z(z)))); c.stroke(); };
    if (cfg.promenade && ell[cfg.promenade.ellipse]) {
      const e = ell[cfg.promenade.ellipse], pts = [];
      for (let k = 0; k <= 96; k++) { const a = k / 96 * Math.PI * 2; pts.push([e.center[0] + (e.rx + cfg.promenade.offset) * Math.cos(a), e.center[1] + (e.rz + cfg.promenade.offset) * Math.sin(a)]); }
      line(pts, cfg.promenade.width, '#ffffff');
    }
    for (const p of cfg.paths || []) line(p.pts, p.width, p.name === 'ネオン・アベニュー' ? '#f6cfe2' : '#ffffff');
    if (gen) for (const p of gen.paths) line(p.pts, p.w, '#ffffff');
    // 建物 (拡大したときだけ)
    if (gen && scale >= 0.4) {
      c.fillStyle = '#c9bcd8'; c.strokeStyle = '#a89bbd'; c.lineWidth = 1;
      for (const b of gen.buildings) {
        if (b.x < bbox[0] - 30 || b.x > bbox[2] + 30 || b.z < bbox[1] - 30 || b.z > bbox[3] + 30) continue;
        c.save(); c.translate(X(b.x), Z(b.z)); c.rotate(-b.yaw);
        c.fillRect(-b.w / 2 * scale, -b.d / 2 * scale, b.w * scale, b.d * scale); c.restore();
      }
    }
    // 観覧車・コースター
    const rd = gen && gen.rides;
    if (rd) {
      c.strokeStyle = '#d94f3a'; c.lineWidth = Math.max(1.5, 2 * scale);
      if (rd.ferris) { c.beginPath(); c.arc(X(rd.ferris.x), Z(rd.ferris.z), Math.max(3, rd.ferris.R * scale), 0, Math.PI * 2); c.stroke(); }
      if (rd.coaster) { c.beginPath(); rd.coaster.pts.forEach(([x, z], i) => (i ? c.lineTo(X(x), Z(z)) : c.moveTo(X(x), Z(z)))); c.closePath(); c.stroke(); }
    }
    c.restore();
  };
  return { bounds, draw };
}
