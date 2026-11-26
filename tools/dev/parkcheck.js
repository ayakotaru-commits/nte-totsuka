// フェアリー・リールパーク (舞浜の架空のテーマパーク。PARK_PLAN.md) の段階 0 の試作を、キャラを歩かせて確かめる (疑似入力。画面は撮らない)。
// 使い方: node tools/dev/parkcheck.js [--quick] [--rides]   (--quick = 最初の ?nopark の確認を省く。--rides = 段階 3 の乗り物の確認だけ (約 5 分)。全部で 3〜20 分。three.js は tools/dev/.cache/package に要る = CLAUDE.md の手順)
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
    await page.goto(base + '/?shot&novrm' + query + (process.env.PARK_QUERY || ''), { timeout: 600000 });   // PARK_QUERY = 追加の URL 引数 (例: &touch = スマホの設定)
    await page.waitForFunction(() => window.__g && window.__ride, null, { timeout: 600000 });
    return page;
  }
  const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const fn = () => (++k >= n ? r() : requestAnimationFrame(fn)); requestAnimationFrame(fn); }), n);
  const extIdle = async (page) => { for (let k = 0; k < 400; k++) { await frames(page, 2); if (await page.evaluate(() => !window.__railext || window.__railext.stats.idle)) return; } console.log('区間の読み込みが終わらない'); };

  const ridesOnly = process.argv.includes('--rides');

  // ---- 段階 3: 乗り物 (観覧車に乗って降りる・メリーゴーラウンドとコースターが動く・当たり判定) ----
  async function stage3(page) {
    const rd = park.gen.rides || {};
    check('設定に乗り物 3 つがある (gen.rides)', rd.ferris && rd.carousel && rd.coaster && rd.coaster.pts.length >= 10, rd.coaster && { pts: rd.coaster.pts.length });
    const g0 = park.gate.at, gh0 = await page.evaluate(async ([x, z]) => (await import('/src/terrain.js')).H(x, z), g0);
    await page.evaluate(([x, y, z]) => window.__ride.place(x, y, z, 0), [rd.ferris.x, gh0 + 0.2, rd.ferris.z + 30]);
    for (let k = 0; k < 60; k++) { await frames(page, 3); await extIdle(page); if (await page.evaluate(() => !!window.__g.scene.getObjectByName('park_rides'))) break; }
    const built = await page.evaluate(() => { const g = window.__g.scene.getObjectByName('park_rides'); if (!g) return null; let meshes = 0, inst = 0; g.traverse((o) => { if (o.isMesh) { meshes++; if (o.isInstancedMesh) inst++; } }); const r = window.__pride.park.areas.rides; return { meshes, inst, tris: r.stats.tris, coaster: r.stats }; });
    console.log(JSON.stringify(built));
    check('乗り物のグループが出ている (park_rides)', built && built.meshes >= 20 && built.inst >= 8, built);
    const T = await page.evaluate(() => { const r = window.__pride.park.areas.rides; return { period: r.coaster.period, length: r.coaster.length, top: r.coaster.cfg && null }; });
    check('コースターの一周は 20〜120 秒・長さ 250 m 以上', T.period > 20 && T.period < 120 && T.length > 250, T);

    // 動き: 時刻を進めて、観覧車の輪・メリーゴーラウンド・コースターの車両が動く (update を直接呼ぶ)
    const mv = await page.evaluate(() => {
      const r = window.__pride.park.areas.rides, F = r.ferris, K = r.coaster, grp = window.__g.scene.getObjectByName('park_rides');
      const insts = []; grp.traverse((o) => { if (o.isInstancedMesh) insts.push(o); });
      const snap = () => insts.map((o) => Array.from(o.instanceMatrix.array.slice(0, 16)).map((v) => +v.toFixed(3)).join(','));
      const cx = F.group.position.x, cz = F.group.position.z;
      r.update(1000, cx, cz); const a = snap();
      r.update(1007.3, cx, cz); const b = snap();
      const moved = a.map((v, i) => v !== b[i]).filter(Boolean).length;
      // 回る部分 (メリーゴーラウンドの spin) と輪
      const rot = []; grp.traverse((o) => { if (o.isGroup && Math.abs(o.rotation.y) > 1e-6 && o.children.some((c) => c.isInstancedMesh)) rot.push(+o.rotation.y.toFixed(3)); });
      let wz = null; grp.traverse((o) => { if (o.isGroup && o.position.y > 10 && o.children.some((c) => c.isTorus || (c.geometry && c.geometry.type === 'TorusGeometry'))) wz = +o.rotation.z.toFixed(3); });
      r.update(1000, cx, cz); const wz0 = (() => { let v = null; grp.traverse((o) => { if (o.isGroup && o.position.y > 10 && o.children.some((c) => c.geometry && c.geometry.type === 'TorusGeometry')) v = +o.rotation.z.toFixed(3); }); return v; })();
      // コースター: 0.1 秒ごとに先頭の位置を取って、速さの範囲と、とびの無さ
      const P = new (F.bottom.constructor)(), Q = new (F.bottom.constructor)();
      let vmin = 1e9, vmax = 0, bad = 0, jump = 0, ymax = -1e9, ymin = 1e9, base = K.h0;
      let prev = null;
      for (let t = 0; t < K.period * 1.02; t += 0.1) {
        K.carPos(0, 5000 + t, P);
        if (!Number.isFinite(P.x + P.y + P.z)) bad++;
        ymax = Math.max(ymax, P.y); ymin = Math.min(ymin, P.y);
        if (prev) { const d = P.distanceTo(prev), v = d / 0.1; vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); if (d > 3) jump++; }
        prev = P.clone();
      }
      K.carPos(0, 6000, P); K.carPos(1, 6000, Q);
      return { moved, nInst: insts.length, rot, wz, wz0, vmin: +vmin.toFixed(2), vmax: +vmax.toFixed(2), bad, jump, top: +(ymax - base).toFixed(1), low: +(ymin - base).toFixed(1), carGap: +P.distanceTo(Q).toFixed(2) };
    });
    console.log(JSON.stringify(mv));
    check('時刻を進めると、ゴンドラ・馬・コースターの車両が動く (InstancedMesh の行列が変わる)', mv.moved >= 4, { moved: mv.moved, of: mv.nInst });
    check('観覧車の輪とメリーゴーラウンドの回る部分が回る', mv.wz !== null && mv.wz !== mv.wz0 && mv.rot.length >= 1, { wz: mv.wz, wz0: mv.wz0, rot: mv.rot });
    check('コースターの車両: 速さ 3〜25 m/s・とびが無い・NaN なし・最高 25 m 以上・車両の間 約 3.2 m', mv.vmin > 1.5 && mv.vmax < 25 && mv.jump === 0 && mv.bad === 0 && mv.top > 25 && Math.abs(mv.carGap - 3.2) < 0.4, mv);

    // 当たり判定: 観覧車の脚・券売所、メリーゴーラウンド、コースターの柱・のりばの小屋
    const toward = async (x0, z0, x1, z1, label, rmin, rmax, cx, cz) => {
      const y0 = await page.evaluate(async ([x, z]) => (await import('/src/terrain.js')).H(x, z), [x0, z0]);
      await page.evaluate(([x, y, z]) => window.__ride.place(x, y, z, 0), [x0, y0 + 0.2, z0]);
      await frames(page, 2);
      const h = await page.evaluate((a) => window.__walkXZ(a, { maxT: 12, walk: true, keepGoing: true, tol: 0.3 }), [[x1, z1]]);
      const q = h.out[0], dd = q ? Math.hypot(q.at[0] - cx, q.at[1] - cz) : 99;
      check(label, q && !q.ok && dd > rmin && dd < rmax && !h.nan, { dist: +dd.toFixed(2) });
    };
    const W = (o, lx, lz) => [o.x + lx * Math.cos(o.yaw) + lz * Math.sin(o.yaw), o.z - lx * Math.sin(o.yaw) + lz * Math.cos(o.yaw)];
    const F = rd.ferris, C = rd.carousel;
    const bx = F.R * 0.6;
    {   // 観覧車の脚の根元 (横から中心へ向かう)
      const [lx, lz] = W(F, bx, 2.7 * 1.25), [ox, oz] = W(F, bx + 8, 2.7 * 1.25);
      await toward(ox, oz, lx, lz, '観覧車の脚の根元で止まる (通り抜けない)', 0.5, 2.2, lx, lz);
    }
    {   // メリーゴーラウンド: 外から中心へ
      const sx = C.x + 14 * Math.sin(C.yaw + 1.2), sz = C.z + 14 * Math.cos(C.yaw + 1.2);
      await toward(sx, sz, C.x, C.z, 'メリーゴーラウンドの台のふちで止まる (中には入れない)', C.R - 0.5, C.R + 2.2, C.x, C.z);
    }
    {   // コースターの柱: 柱のどれか 1 本の中心へ
      const post = await page.evaluate(() => { const r = window.__pride.park.areas.rides.coaster; return r.posts && r.posts[Math.floor(r.posts.length / 3)]; });
      if (post) await toward(post.x + 4, post.z, post.x, post.z, 'コースターの柱で止まる', 0.1, 1.6, post.x, post.z);
      else check('コースターの柱の位置が取れる', false);
    }

    // 観覧車に乗る・降りる (時計を差し替えて、ゴンドラ 0 が底に来た時刻から進める)
    const ride = await page.evaluate(async ({ F, gy }) => {
      const pr = window.__pride, fw = pr.ferris, pl = window.__g.player, out = {};
      const real = Date.now.bind(Date); let now = Math.ceil(real() / 1000 / F.rev) * F.rev;   // 輪の角度 0 (ゴンドラ 0 が底) の時刻
      Date.now = () => now * 1000;
      const K = (down) => ({ pressed: (k) => down.includes(k) });
      const step = (sec, down = []) => { const n = Math.round(sec * 30); for (let i = 0; i < n; i++) { now += 1 / 30; pr.update(1 / 30, K(down)); if (pr.riding) pr.view(1 / 30); } };
      // のりばへ置く
      window.__ride.place(fw.spot.x, fw.spot.y, fw.spot.z, 0); pl.pos.y = fw.spot.y + 0.05;
      step(0.2); out.hint = pr.hint && !pr.hint.hidden ? pr.hint.textContent : null;
      // 遠いとき (のりばから 12 m) は乗れない
      window.__ride.place(fw.spot.x + 12, fw.spot.y, fw.spot.z, 0); step(0.1, ['KeyF']); out.farRide = !!pr.riding;
      window.__ride.place(fw.spot.x, fw.spot.y, fw.spot.z, 0); pl.pos.y = fw.spot.y + 0.05;
      step(0.1, ['KeyF']); out.boarded = !!pr.riding; out.gond = pr.riding && pr.riding.i;
      step(1.5); const P = new fw.bottom.constructor(); fw.pos(pr.riding.i, fw.theta(now), P);
      out.seatErr = +Math.hypot(pl.pos.x - P.x, pl.pos.z - P.z, pl.pos.y + 0.93 - P.y).toFixed(3);
      out.modelVisible = pl.model.root.visible;
      // 半周 (75 秒) まで進めて、最高の高さ。途中で F を押しても降りない
      let hmax = 0, early = false; const t0 = now;
      for (let t = 0; t < F.rev * 0.5; t += 1 / 30) { step(1 / 30); hmax = Math.max(hmax, pl.pos.y - fw.gy); if (t > F.rev * 0.3 && t < F.rev * 0.31) { pr.update(1 / 30, K(['KeyF'])); if (!pr.riding) early = true; } }
      out.hmax = +hmax.toFixed(1); out.earlyAlight = early; out.info = pr.info && pr.info.textContent;
      // Q で中の視点: キャラが隠れ、カメラがゴンドラの中
      pr.update(1 / 30, K(['KeyQ'])); pr.view(1 / 30);
      const cp = window.__g.camera.position, dC = Math.hypot(cp.x - pl.pos.x, cp.y - (pl.pos.y + 1.5), cp.z - pl.pos.z);
      out.inView = { hidden: !pl.model.root.visible, cam: +dC.toFixed(2), finite: Number.isFinite(cp.x + cp.y + cp.z) };
      pr.update(1 / 30, K(['KeyQ'])); pr.view(1 / 30); out.backOut = pl.model.root.visible;
      // 一周 (150 秒) まで進めて、底に着いたら降りる
      let canAt = null;
      for (let t = 0; t < F.rev * 0.7; t += 1 / 30) { step(1 / 30); if (pr.riding && pr.riding.can) { canAt = +(now - t0 + 1.5).toFixed(1); break; } }
      out.canAt = canAt; out.heightWhenCan = pr.riding ? +(pl.pos.y - fw.gy).toFixed(2) : null;
      pr.update(1 / 30, K(['KeyF']));
      out.alighted = !pr.riding; out.after = { d: +Math.hypot(pl.pos.x - fw.spot.x, pl.pos.z - fw.spot.z).toFixed(2), dy: +(pl.pos.y - fw.gy).toFixed(2), visible: pl.model.root.visible };
      // ワープで降りる (cancel)
      step(0.5); pr.update(1 / 30, K(['KeyF'])); out.reboard = !!pr.riding; pr.cancel(); out.cancel = { riding: !!pr.riding, visible: pl.model.root.visible, dist: window.__g.cam.dist };
      Date.now = real;
      return out;
    }, { F, gy: gh0 });
    console.log(JSON.stringify(ride));
    check('のりばの近くで「観覧車に乗る」の案内が出る・遠いと乗れない', ride.hint && /観覧車/.test(ride.hint) && ride.farRide === false, { hint: ride.hint, far: ride.farRide });
    check('F で乗れて、キャラがゴンドラの床に立つ (誤差 5 cm 以内)', ride.boarded && ride.seatErr < 0.05 && ride.modelVisible, { err: ride.seatErr });
    check('半周で 20 m 以上まで上がる・途中では降りられない', ride.hmax > 20 && ride.earlyAlight === false, { hmax: ride.hmax, early: ride.earlyAlight });
    check('Q でゴンドラの中の視点 (キャラが隠れ、カメラがゴンドラの中) と、外からの視点へ戻る', ride.inView && ride.inView.hidden && ride.inView.cam < 0.2 && ride.inView.finite && ride.backOut, ride.inView);
    check('一周して底に着いたら降りられる (のりばの近く・地面の高さ)', ride.canAt && ride.canAt > 135 && ride.alighted && ride.after.d < 1.5 && Math.abs(ride.after.dy) < 0.6 && ride.after.visible, { canAt: ride.canAt, after: ride.after });
    check('ワープ・リスポーン (cancel) で降りてキャラが出る', ride.reboard && !ride.cancel.riding && ride.cancel.visible, ride.cancel);
  }

  // ---- 1. ?nopark: 試作が出ない (--quick で省く) ----
  const quick = process.argv.includes('--quick') || ridesOnly;
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
  if (ridesOnly) {   // 段階 3 の乗り物だけ
    await stage3(page);
    await browser.close(); server.close();
    const bad0 = results.filter((r) => !r.ok);
    console.log(`\n${results.length - bad0.length}/${results.length} OK`);
    process.exit(bad0.length ? 1 : 0);
  }
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
  // 段階 7: 建物の細部。アベニュー以外のエリアに細部のメッシュが出ていない・三角形の数 (壁・縁取り・看板 + 店の窓・壁灯・ネオン)
  const tris = await page.evaluate(() => { const g = window.__g.scene.getObjectByName('park_areas'), r = { detail: 0, other: 0, walls: 0, facade: 0 }; g.traverse((o) => { if (!o.isMesh || o.isInstancedMesh || !o.geometry) return; const t = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; if (/^park_facade_/.test(o.name)) { r.facade += t; r.detail++; } else if (/^park_(walls|trim|signs)_/.test(o.name)) r.walls += t; }); return r; });
  console.log(JSON.stringify({ tris }));
  check('建物の細部のメッシュがある (店の窓・壁灯・ネオン)', gen.areas.some((a) => a.detail) ? tris.detail >= 3 && tris.facade > 1000 : tris.detail === 0, tris);
  const walls = await page.evaluate(() => { let patched = 0, vis = 0, n = 0; window.__g.scene.traverse((o) => { if (o.isMesh && o.name.startsWith('park_walls_')) { n++; if (o.visible) vis++; if (o.material.onBeforeCompile && String(o.material.onBeforeCompile).length > 200) patched++; } }); return { n, vis, patched }; });
  check('壁の柄 (街の本体と同じ) が付き、壁が見えている', walls.n === 7 && walls.vis === 7 && walls.patched === 7, walls);
  const aName = gen.areas.map((q) => q.name);
  const approach = (b, d) => [b.x + Math.sin(b.yaw) * (b.d / 2 + d), b.z + Math.cos(b.yaw) * (b.d / 2 + d)];
  let allNaN = false;
  for (let ai = 0; ai < gen.areas.length; ai++) {
    if (process.env.PARK_AREA && aName[ai] !== process.env.PARK_AREA) continue;   // 1 つのエリアだけ確かめるとき (例: PARK_AREA=スイート・ヒル)
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
      // 段階 3: 通りが近い広場の中心を通るエリアは、メリーゴーラウンドの台 (中には入れない) を、横へ回り込む点に置き換える
      const cr = gen.rides && gen.rides.carousel;
      if (cr && cr.a === ai) route = route.map((p, k) => { if (k === 0 || Math.hypot(p[0] - cr.x, p[1] - cr.z) > cr.R + 3) return p; const q = route[k - 1], dx = p[0] - q[0], dz = p[1] - q[1], L = Math.hypot(dx, dz) || 1; return [cr.x - dz / L * (cr.R + 4), cr.z + dx / L * (cr.R + 4)]; });
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

  await stage3(page);

  await browser.close(); server.close();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} OK`);
  process.exit(bad.length ? 1 : 0);
})();
