// フェアリー・リールパーク (舞浜の架空のテーマパーク。PARK_PLAN.md) の段階 0 の試作を、キャラを歩かせて確かめる (疑似入力。画面は撮らない)。
// 使い方: node tools/dev/parkcheck.js [--quick]   (--quick = 最初の ?nopark の確認を省く。3〜10 分。three.js は tools/dev/.cache/package に要る = CLAUDE.md の手順)
// 確かめること: 敷地の中の実在の道路・木が省かれ、駅の範囲は残る / 舞浜駅の南口の広場から歩いてゲートに着く / 柱の間を通れ、柱には止められる /
//   ゲートから広場の円の中心まで歩ける (地面に立つ) / 看板の板・広場の円が出ている / ?nopark で元に戻る / NaN が無い
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(__dirname, '.cache', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };

(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const park = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'park.json')));
  const idx = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'rail_ext', 'index.json')));
  const f = idx.stations.find((q) => q.name === park.station).site.frame;
  const so = idx.stations.find((q) => q.name === park.station).site.south;
  const XZ = (s, t) => [f.cx + f.sx * s + f.nx * t, f.cz + f.sz * s + f.nz * t];

  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = [];
  const check = (name, cond, info) => { results.push({ name, ok: !!cond }); console.log(cond ? 'OK ' : 'NG ', name, info ? JSON.stringify(info) : ''); };

  async function open(query) {
    const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
    page.setDefaultTimeout(600000);
    await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r =>
      r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
    await page.route('**/src/main.js', async r => {
      const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, world, camera };\n  const qs = new URLSearchParams');
      r.fulfill({ body: t, contentType: 'application/javascript' });
    });
    page.on('pageerror', e => console.log('ERR', e.message));
    await page.goto(base + '/?shot&novrm' + query, { timeout: 600000 });
    await page.waitForFunction(() => window.__g && window.__ride, null, { timeout: 600000 });
    return page;
  }
  const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const fn = () => (++k >= n ? r() : requestAnimationFrame(fn)); requestAnimationFrame(fn); }), n);
  const extIdle = async (page) => { for (let k = 0; k < 400; k++) { await frames(page, 2); if (await page.evaluate(() => !window.__railext || window.__railext.stats.idle)) return; } console.log('区間の読み込みが終わらない'); };

  // ---- 1. ?nopark: 試作が出ない (--quick で省く) ----
  const quick = process.argv.includes('--quick');
  let page;
  if (!quick) {
    page = await open('&nopark');
    const [x, z] = XZ(82, -21.5);
    await page.evaluate(([x, y, z]) => window.__ride.place(x, y, z, 0), [x, f.gy + 0.12, z]);
    await frames(page, 3); await extIdle(page); await frames(page, 6);
    check('?nopark では park のグループが無い', await page.evaluate(() => !window.__g.scene.getObjectByName('park')));
    await page.close();
  }

  // ---- 2. 通常: 省く仕組み (区間のデータで確かめる) ----
  page = await open('');
  const cut = await page.evaluate(async () => {
    const { createParkCut } = await import('/src/detail/park.js');
    const cfg = await (await fetch('/data/park.json')).json();
    const pc = createParkCut(cfg);
    const D = await (await fetch('/data/rail_ext/c_31_-26.json')).json();
    const before = { trees: D.trees.length, roads: D.roads.length, walks: D.walks.length, bld: D.buildings.length, piers: (D.piers || []).length };
    const removed = pc.cutChunk(D);
    const left = {
      trees: D.trees.filter((t) => pc.hidden(t[0], t[2])).length,
      roadPts: D.roads.reduce((n, r) => { for (let k = 1; k + 3 < r.length; k += 2) if (pc.hidden((r[k] + r[k + 2]) / 2, (r[k + 1] + r[k + 3]) / 2)) n++; return n; }, 0),
    };
    const w = D.walks[0], last = [w[w.length - 2], w[w.length - 1]];   // 歩道は敷地に入る所で終わる
    // 駅の範囲の中の木は残るか (範囲の中に実在の木があれば)
    return { before, removed, left, after: { trees: D.trees.length, roads: D.roads.length, walks: D.walks.length }, walkEnd: last, cfgName: cfg.name, hid: pc.hidden(31490, -25672), prot: pc.hidden(31701, -26023) };
  });
  console.log(JSON.stringify(cut));
  check('敷地の中の木が省かれる (686 本 → 0)', cut.removed > 600 && cut.left.trees === 0, { before: cut.before.trees, after: cut.after.trees });
  check('敷地の中の道路が省かれ、残りに敷地の中の区切りが無い', cut.left.roadPts === 0 && cut.after.roads !== cut.before.roads, { before: cut.before.roads, after: cut.after.roads });
  check('歩道の終わりが、敷地に入る所 (31306, -25986) の近く', cut.walkEnd && Math.hypot(cut.walkEnd[0] - 31306, cut.walkEnd[1] + 25986) < 8, cut.walkEnd);
  check('広場の位置は省く範囲、駅は省かない範囲', cut.hid === true && cut.prot === false);

  // ---- 3. 歩く ----
  await page.evaluate((f) => {
    window.__walkXZ = (pts, opt = {}) => {
      const g = window.__g, pl = g.player, dt = 1 / 30, out = [];
      const mk = (keys) => ({ pressed: () => false, held: (k) => keys.includes(k), ax: 0, az: 0, endFrame() {} });
      pl.walkMode = !!opt.walk;
      for (const [tx, tz] of pts) {
        let ok = false, k = 0;
        for (; k < (opt.maxT || 40) / dt; k++) {
          const dx = tx - pl.pos.x, dz = tz - pl.pos.z, d = Math.hypot(dx, dz);
          if (d < (opt.tol || 0.6)) { ok = true; break; }
          g.cam.yaw = Math.atan2(dx, dz) + Math.PI;
          pl.update(dt, mk(['KeyW']), g.cam);
          if (!Number.isFinite(pl.pos.x + pl.pos.y + pl.pos.z)) return { nan: true, out };
        }
        for (let j = 0; j < 20; j++) pl.update(dt, mk([]), g.cam);
        out.push({ to: [Math.round(tx), Math.round(tz)], ok, at: [+pl.pos.x.toFixed(1), +pl.pos.z.toFixed(1)], y: +pl.pos.y.toFixed(2), sec: +(k * dt).toFixed(1) });
        if (!ok && !opt.keepGoing) break;
      }
      pl.walkMode = false;
      return { out };
    };
    window.__groundH = async (x, z) => (await import('/src/terrain.js')).H(x, z);
  }, f);
  const [sx, sz] = XZ(82, -21.5);   // 南口の地上への階段の下 (地図の「舞浜駅（南口）」のワープ先とほぼ同じ)
  await page.evaluate(([x, y, z]) => window.__ride.place(x, y, z, 0), [sx, f.gy + 0.12, sz]);
  await frames(page, 3); await extIdle(page); await frames(page, 10);
  check('park のグループが出ている (地形を読んだ後)', await page.evaluate(() => !!window.__g.scene.getObjectByName('park')) && await page.evaluate(() => window.__g.scene.getObjectByName('park').children.length >= 4), null);
  // 実在の歩道 (南口の西の歩道。rail_ext の walks) をたどり、敷地に入る所から、駅からゲートへの道 → ゲートの手前
  const route = [];
  const wk = [];
  for (const key of ['31_-27', '31_-26']) {
    const D = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'rail_ext', `c_${key}.json`)));
    for (const w of D.walks || []) { const pts = []; for (let k = 1; k + 1 < w.length; k += 2) pts.push([w[k], w[k + 1]]); wk.push(pts); }
  }
  // 歩道を、東の端 (31613, -26035) から西へつなぐ。駅の南口の歩道 (site.south.promenade) の始まりは (-85, -26) = XZ
  const prom = [XZ(-85, -26), ...wk.flat().filter((p, i, a) => a.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1) === i).sort((a, b) => b[0] - a[0]).filter((p) => p[1] < -25985)];
  route.push(XZ(88, -33), XZ(40, -31), XZ(-30, -31), ...prom);   // 階段の下から、地上 (デッキの南の縁の外) を西へ
  const [px0, pz0] = park.paths[0].pts[0];
  const gateXZ = park.gate.at, g0 = [gateXZ[0], gateXZ[1]];
  const first = await page.evaluate((r) => window.__walkXZ(r, { maxT: 120, keepGoing: true, tol: 2.5 }), route);
  const oks = first.out.filter((q) => q.ok).length;
  console.log('駅から歩道:', oks, '/', route.length, JSON.stringify(first.out.filter((q) => !q.ok)));
  check('舞浜駅の南口から、実在の歩道の終わりまで歩ける', oks === route.length && !first.nan, { oks, n: route.length });
  const second = await page.evaluate((r) => window.__walkXZ(r, { maxT: 40, tol: 1.5 }), [...park.paths[0].pts.map((p) => [p[0], p[1]])]);
  console.log(JSON.stringify(second));
  const lastY = second.out.length ? second.out[second.out.length - 1].y : null;
  const gh = await page.evaluate(([x, z]) => window.__groundH(x, z), g0);
  check('敷地に入る所から、駅からゲートへの道を歩いてゲートの手前に着く', second.out.length === park.paths[0].pts.length && second.out.every((q) => q.ok) && Math.abs(lastY - gh) < 0.6, { y: lastY, ground: +gh.toFixed(2) });

  // 柱の間 (ゲートの中心を、道の向きに通る) と、柱にぶつかる
  const fx = park.gate.face[0], fz = park.gate.face[1], half = park.gate.span / 2;
  const rx = fz, rz = -fx;   // 柱の並ぶ向き
  const pass = await page.evaluate((a) => window.__walkXZ(a, { maxT: 20, tol: 1.2 }), [[g0[0] + fx * 4, g0[1] + fz * 4], g0, [g0[0] - fx * 6, g0[1] - fz * 6]]);
  console.log(JSON.stringify(pass));
  check('ゲートの柱の間を通り抜けられる', pass.out.length === 3 && pass.out.every((q) => q.ok), pass.out.map((q) => q.ok));
  const postX = g0[0] + rx * half, postZ = g0[1] + rz * half;
  const pgh = await page.evaluate(([x, z]) => window.__groundH(x, z), [postX, postZ]);
  await page.evaluate(([x, y, z]) => window.__ride.place(x, y, z, 0), [postX + fx * 4, pgh + 0.1, postZ + fz * 4]);
  await frames(page, 3);
  // 柱の中心に向かって歩く (円の柱は、斜めに当たると横へ滑って回り込める。中心へ向かえば、手前で止まるはず)
  const hit = await page.evaluate((a) => window.__walkXZ(a, { maxT: 10, walk: true, keepGoing: true, tol: 0.2 }), [[postX, postZ]]);
  console.log(JSON.stringify(hit));
  const stop = hit.out[0];
  check('柱の中心に向かって歩くと、柱の手前で止まる (通り抜けない)', stop && !stop.ok && Math.hypot(stop.at[0] - postX, stop.at[1] - postZ) > 0.5 && Math.hypot(stop.at[0] - postX, stop.at[1] - postZ) < 1.8, stop);

  // ゲートからネオン・アベニューを歩いて、広場の円の中心へ
  const pl = park.ellipses['サンライズ・プラザ'].center;
  const av = park.paths[1].pts;
  const third = await page.evaluate((r) => window.__walkXZ(r, { maxT: 40, tol: 2 }), [...av.map((p) => [p[0], p[1]]), [pl[0], pl[1]]]);
  console.log(JSON.stringify(third));
  const ph = await page.evaluate(([x, z]) => window.__groundH(x, z), pl);
  const ty = third.out.length ? third.out[third.out.length - 1].y : null;
  check('ゲートからネオン・アベニューを歩いて広場の中心に着く (地面の上に立つ)', third.out.length === av.length + 1 && third.out.every((q) => q.ok) && Math.abs(ty - ph) < 0.6, { y: ty, ground: +ph.toFixed(2) });
  check('NaN なし', !first.nan && !second.nan && !third.nan && !pass.nan);

  // ---- 段階 1: 地面・湖・塔・柵・案内 ----
  const lake = park.ellipses['ムーンレイク'], lc = lake.center, lv = park.ground.level;
  const hAt = (x, z) => page.evaluate(([x, z]) => window.__groundH(x, z), [x, z]);
  const gg = await hAt(g0[0], g0[1]), pp = await hAt(pl[0], pl[1]), lcH = await hAt(lc[0], lc[1] - 1), rimH = await hAt(lc[0], lc[1] - lake.rz - 6);
  check('パークの地面は平ら (ゲート・広場が level の ±0.1 m)', Math.abs(gg - lv) < 0.1 && Math.abs(pp - lv) < 0.1, { gate: +gg.toFixed(2), plaza: +pp.toFixed(2), level: lv });
  check('湖の中心が深さ分 (2.5 m) 掘れている', Math.abs((lv - lcH) - lake.lake.depth) < 0.3 && Math.abs(rimH - lv) < 0.1, { center: +lcH.toFixed(2), rim: +rimH.toFixed(2) });
  const names = await page.evaluate(() => window.__g.scene.getObjectByName('park').children.length);
  check('パークの部品が出ている (看板・道・広場・湖・柵・塔・街灯・案内)', names >= 12, names);
  // 広場 → 湖へ (道) → 湖のまわりの散歩道 (北の岸)。湖の中心へ向かうと岸の手前で止まり、湖に落ちない
  const toLake = await page.evaluate((r) => window.__walkXZ(r, { maxT: 40, tol: 2 }), [[pl[0], pl[1] + 70], [lc[0], lc[1] - lake.rz - 12]]);
  console.log(JSON.stringify(toLake));
  check('広場から湖の北の散歩道まで歩ける', toLake.out.length === 2 && toLake.out.every((q) => q.ok), toLake.out.map((q) => q.ok));
  const dive = await page.evaluate((a) => window.__walkXZ(a, { maxT: 20, walk: true, keepGoing: true, tol: 0.3 }), [[lc[0], lc[1]]]);
  console.log(JSON.stringify(dive));
  const dd = dive.out[0], dEdge = Math.hypot((dd.at[0] - lc[0]) / lake.rx, (dd.at[1] - lc[1]) / lake.rz);
  check('湖の中心へ向かって歩いても、岸の手前で止まる (落ちない)', dd && !dd.ok && dEdge > 1.0 && Math.abs(dd.y - lv) < 0.7, { rho: +dEdge.toFixed(3), y: dd && dd.y });
  // 塔: 中心へ向かうと根元で止まる (塔の半径 + α)
  const tw = park.tower, tdir = [pl[0] - tw.at[0], pl[1] - tw.at[1]], tl = Math.hypot(...tdir);
  await page.evaluate(([x, y, z]) => window.__ride.place(x, y, z, 0), [tw.at[0] + tdir[0] / tl * 25, lv + 0.2, tw.at[1] + tdir[1] / tl * 25]);
  await frames(page, 3);
  const tow = await page.evaluate((a) => window.__walkXZ(a, { maxT: 15, walk: true, keepGoing: true, tol: 0.3 }), [[tw.at[0], tw.at[1]]]);
  console.log(JSON.stringify(tow));
  const tt = tow.out[0], tr = Math.hypot(tt.at[0] - tw.at[0], tt.at[1] - tw.at[1]);
  check('サーチライト・タワーの根元まで歩けて、中には入れない', tt && !tt.ok && tr > 3.2 && tr < 6.5, { r: +tr.toFixed(2) });
  // 柵: 西の辺の中ほどで、内側から外へ歩くと止まる。辺から 6 m 内側に置く
  const S0 = park.site[park.site.length - 1], S1 = park.site[0];   // 西の辺 (最後の頂点 → 最初の頂点)
  const em = [(S0[0] + S1[0]) / 2, (S0[1] + S1[1]) / 2], el = Math.hypot(S1[0] - S0[0], S1[1] - S0[1]), nrm = [-(S1[1] - S0[1]) / el, (S1[0] - S0[0]) / el];
  const inw = park.site.length && (nrm[0] * (lc[0] - em[0]) + nrm[1] * (lc[1] - em[1]) > 0) ? 1 : -1;   // 内側へ向く向き
  const ex = em[0] + nrm[0] * inw * 6, ez = em[1] + nrm[1] * inw * 6, egh = await hAt(ex, ez);
  await page.evaluate(([x, y, z]) => window.__ride.place(x, y, z, 0), [ex, egh + 0.2, ez]);
  await frames(page, 3);
  const fence = await page.evaluate((a) => window.__walkXZ(a, { maxT: 12, walk: true, keepGoing: true, tol: 0.3 }), [[em[0] - nrm[0] * inw * 15, em[1] - nrm[1] * inw * 15]]);
  console.log(JSON.stringify(fence));
  const fo = fence.out[0], fd = Math.hypot(fo.at[0] - em[0], fo.at[1] - em[1]);
  check("外周の柵で止まる (外へ出られない)", fo && !fo.ok && fd < 3.2, { distToEdge: +fd.toFixed(2) });
  check('NaN なし (段階 1)', !toLake.nan && !dive.nan && !tow.nan && !fence.nan);

  // ---- 段階 2: 各エリア (建物・内側の道・広場・木・看板・門・特別な物) ----
  const gen = park.gen;
  check('設定に各エリアの建物がある (gen)', gen && gen.buildings.length > 300 && gen.areas.length === 7, gen && { buildings: gen.buildings.length, trees: gen.trees.length, signs: gen.signs.length });
  const parts = await page.evaluate(() => { const g = window.__g.scene.getObjectByName('park_areas'); if (!g) return null; const n = {}; g.traverse((o) => { if (o.isMesh) { const k = o.name.replace(/_\d+$/, '') || (o.isInstancedMesh ? 'inst' : 'mesh'); n[k] = (n[k] || 0) + 1; } }); return n; });
  console.log(JSON.stringify(parts));
  check('各エリアの壁・屋根・看板の面が出ている (7 エリア分)', parts && parts.park_walls === 7 && parts.park_trim >= 6 && parts.park_signs >= 6, parts);
  const walls = await page.evaluate(() => { let patched = 0, vis = 0, n = 0; window.__g.scene.traverse((o) => { if (o.isMesh && o.name.startsWith('park_walls_')) { n++; if (o.visible) vis++; if (o.material.onBeforeCompile && String(o.material.onBeforeCompile).length > 200) patched++; } }); return { n, vis, patched }; });
  check('壁の柄 (街の本体と同じ) が付き、壁が見えている', walls.n === 7 && walls.vis === 7 && walls.patched === 7, walls);
  const aName = gen.areas.map((q) => q.name);
  const approach = (b, d) => [b.x + Math.sin(b.yaw) * (b.d / 2 + d), b.z + Math.cos(b.yaw) * (b.d / 2 + d)];
  let allNaN = false;
  for (let ai = 0; ai < gen.areas.length; ai++) {
    // 主な通り (最も長い内側の道。アベニューは園の道) を歩き通す
    let route;
    if (gen.areas[ai].kind === 'avenue') route = park.paths[1].pts.map((p) => [p[0], p[1]]);
    else {
      const ps = gen.paths.filter((q) => q.a === ai).sort((p, q) => q.pts.length - p.pts.length);
      const mainP = ps.find((q) => q.pts.length > 3) || ps[0];
      const ar = gen.arches.find((q) => q.a === ai);
      route = [[ar.x, ar.z], ...mainP.pts.map((p) => [p[0], p[1]])];
      // 通りの終わりは遠い広場の中心。そこに火山・灯台・台座があれば根元までは行けないので、手前の点まで
      const fp = gen.plazas.find((q) => q.a === ai && q.far), ft = fp && gen.props.find((q) => q.a === ai && Math.hypot(q.x - fp.x, q.z - fp.z) < 1 && q.k !== 'pad');
      if (ft) route.pop();
    }
    const [sx0, sz0] = route[0], sy = await hAt(sx0, sz0);
    await page.evaluate(([x, y, z]) => window.__ride.place(x, y, z, 0), [sx0, sy + 0.2, sz0]);
    await frames(page, 3); await extIdle(page); await frames(page, 4);
    const r = await page.evaluate((rt) => window.__walkXZ(rt.slice(1), { maxT: 60, tol: 3.0, keepGoing: true }), route);
    allNaN = allNaN || !!r.nan;
    const okN = r.out.filter((q) => q.ok).length;
    check(`${aName[ai]}: 入口から主な通りを歩き通せる`, !r.nan && okN === r.out.length && r.out.length === route.length - 1, { ok: okN, of: route.length - 1, bad: r.out.filter((q) => !q.ok).slice(0, 2) });
    // 建物の前 3 m から中心へ向かうと、壁の手前で止まる (3 棟。通りに近い順)
    const bs = gen.buildings.filter((q) => q.a === ai && !q.lm).sort((p, q) => Math.hypot(p.x - route[1][0], p.z - route[1][1]) - Math.hypot(q.x - route[1][0], q.z - route[1][1])).slice(0, 3);
    let solid = 0, info = [];
    for (const b of bs) {
      const [bx, bz] = approach(b, 2.5), by = await hAt(bx, bz);
      await page.evaluate(([x, y, z]) => window.__ride.place(x, y, z, 0), [bx, by + 0.2, bz]);
      await frames(page, 2);
      const h = await page.evaluate((a) => window.__walkXZ(a, { maxT: 8, walk: true, keepGoing: true, tol: 0.3 }), [[b.x, b.z]]);
      const q = h.out[0], dd = q ? Math.hypot(q.at[0] - b.x, q.at[1] - b.z) : 0, hz = b.d / 2;
      if (q && !q.ok && dd > hz - 0.6 && dd < hz + 2.5) solid++;
      info.push(q && +dd.toFixed(1));
    }
    check(`${aName[ai]}: 建物の中には入れない (壁の手前で止まる)`, solid === bs.length, { solid, of: bs.length, dist: info });
  }
  // 特別な物: 火山・灯台は中心へ向かうと根元で止まる
  for (const pr of gen.props.filter((q) => q.k === 'volcano' || q.k === 'lighthouse')) {
    // 植え込みの輪などに当たることがあるので、4 方向から試して、どれかが根元で止まれば良い
    let best = null;
    for (const ang of [0.8, 2.4, 4.0, 5.5]) {
      const sx1 = pr.x + Math.cos(ang) * (pr.r + 14), sz1 = pr.z + Math.sin(ang) * (pr.r + 14), sy1 = await hAt(sx1, sz1);
      await page.evaluate(([x, y, z]) => window.__ride.place(x, y, z, 0), [sx1, sy1 + 0.2, sz1]);
      await frames(page, 3); await extIdle(page); await frames(page, 2);
      const h = await page.evaluate((a) => window.__walkXZ(a, { maxT: 12, walk: true, keepGoing: true, tol: 0.3 }), [[pr.x, pr.z]]);
      allNaN = allNaN || !!h.nan;
      const q = h.out[0], dd = q ? Math.hypot(q.at[0] - pr.x, q.at[1] - pr.z) : 99;
      if (!best || dd < best.dd) best = { dd, ok: q && q.ok };
      if (q && !q.ok && dd > pr.r * 0.6 && dd < pr.r + 3) break;
    }
    check(`${pr.k} (${aName[pr.a]}) の根元で止まる`, best && !best.ok && best.dd > pr.r * 0.6 && best.dd < pr.r + 3, { r: pr.r, dist: +best.dd.toFixed(1) });
  }
  check('NaN なし (段階 2)', !allNaN);

  await browser.close(); server.close();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} OK`);
  process.exit(bad.length ? 1 : 0);
})();
