// フェアリー・リールパーク 段階 9: 象徴の城 (リール・キャッスル) を、キャラを歩かせて確かめる (疑似入力。画面は撮らない)。
// 使い方: node tools/dev/castlecheck.js [--touch]   (約 3〜6 分。three.js は tools/dev/.cache/package。--touch = スマホの設定 = 軽い版)
// 確かめること: 城のグループが出る / 島と堤道は水の上に出ている (地面が level、堤道の脇は掘れている) / 前の堤道 → 門のトンネル → 中庭を歩いて通れる /
//   主塔・門塔の袖・城壁・塔の根元で止まる (めり込まない) / 中庭から塔の間を回って裏の門 → 裏の堤道 → 北の岸まで歩ける / 島の縁・堤道の手すりで水に落ちない /
//   ?nocastle で出ない / NaN が無い
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(__dirname, '.cache', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };

(async () => {
  const touch = process.argv.includes('--touch');
  const server = http.createServer((req, res) => {
    const p = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const park = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'park.json')));
  const C = park.castle, lv = park.ground.level;
  const W = (lx, lz) => [C.center[0] + lx * Math.cos(C.yaw) + lz * Math.sin(C.yaw), C.center[1] - lx * Math.sin(C.yaw) + lz * Math.cos(C.yaw)];   // 局所 → ワールド
  const L = (x, z) => { const dx = x - C.center[0], dz = z - C.center[1]; return [dx * Math.cos(C.yaw) - dz * Math.sin(C.yaw), dx * Math.sin(C.yaw) + dz * Math.cos(C.yaw)]; };

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
    const errs = [];
    page.on('pageerror', e => { errs.push(e.message); console.log('ERR', e.message); });
    page.on('console', m => { if (/\[park\] リール/.test(m.text())) console.log('LOG', m.text()); });
    await page.goto(base + '/?shot&novrm' + (touch ? '&touch' : '') + query, { timeout: 600000 });
    await page.waitForFunction(() => window.__g && window.__ride, null, { timeout: 600000 });
    page.errs = errs;
    return page;
  }
  const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const fn = () => (++k >= n ? r() : requestAnimationFrame(fn)); requestAnimationFrame(fn); }), n);
  const extIdle = async (page) => { for (let k = 0; k < 400; k++) { await frames(page, 2); if (await page.evaluate(() => !window.__railext || window.__railext.stats.idle)) return; } console.log('区間の読み込みが終わらない'); };

  // ---- 1. ?nocastle では出ない ----
  {
    const p0 = await open('&nocastle');
    const [x, z] = W(0, 90);
    await p0.evaluate(([x, y, z]) => window.__ride.place(x, y, z, 0), [x, lv + 0.2, z]);
    for (let k = 0; k < 40; k++) { await frames(p0, 3); await extIdle(p0); if (await p0.evaluate(() => !!window.__g.scene.getObjectByName('park'))) break; }
    check('?nocastle では城が出ない (park は出る)', await p0.evaluate(() => !!window.__g.scene.getObjectByName('park') && !window.__g.scene.getObjectByName('park_castle')));
    await p0.close();
  }

  const page = await open('');
  const [x0, z0] = W(0, 90);
  await page.evaluate(([x, y, z]) => window.__ride.place(x, y, z, 0), [x0, lv + 0.2, z0]);
  for (let k = 0; k < 60; k++) { await frames(page, 3); await extIdle(page); if (await page.evaluate(() => !!window.__g.scene.getObjectByName('park_castle'))) break; }
  await frames(page, 6);
  await page.evaluate(() => {
    window.__walkXZ = (pts, opt = {}) => {
      const g = window.__g, pl = g.player, dt = 1 / 30, out = [];
      const mk = (keys) => ({ pressed: () => false, held: (k) => keys.includes(k), ax: 0, az: 0, endFrame() {} });
      pl.walkMode = !!opt.walk;
      for (const [tx, tz] of pts) {
        let ok = false, k = 0, hmax = -1e9, hmin = 1e9;
        for (; k < (opt.maxT || 40) / dt; k++) {
          const dx = tx - pl.pos.x, dz = tz - pl.pos.z, d = Math.hypot(dx, dz);
          if (d < (opt.tol || 0.6)) { ok = true; break; }
          g.cam.yaw = Math.atan2(dx, dz) + Math.PI;
          pl.update(dt, mk(['KeyW']), g.cam);
          hmax = Math.max(hmax, pl.pos.y); hmin = Math.min(hmin, pl.pos.y);
          if (!Number.isFinite(pl.pos.x + pl.pos.y + pl.pos.z)) return { nan: true, out };
        }
        for (let j = 0; j < 20; j++) pl.update(dt, mk([]), g.cam);
        out.push({ to: [Math.round(tx), Math.round(tz)], ok, at: [+pl.pos.x.toFixed(1), +pl.pos.z.toFixed(1)], y: +pl.pos.y.toFixed(2), hmin: +hmin.toFixed(2), hmax: +hmax.toFixed(2), sec: +(k * dt).toFixed(1) });
        if (!ok && !opt.keepGoing) break;
      }
      pl.walkMode = false;
      return { out };
    };
    window.__groundH = async (x, z) => (await import('/src/terrain.js')).H(x, z);
  });
  const hAt = (x, z) => page.evaluate(([x, z]) => window.__groundH(x, z), [x, z]);
  const place = (lx, lz) => { const [x, z] = W(lx, lz); return page.evaluate(([x, y, z]) => window.__ride.place(x, y, z, 0), [x, lv + 0.2, z]); };
  const walkL = (pts, opt) => page.evaluate(([r, o]) => window.__walkXZ(r, o), [pts.map(([lx, lz]) => W(lx, lz)), opt]);

  const grp = await page.evaluate(() => { const g = window.__g.scene.getObjectByName('park_castle'); if (!g) return null; let meshes = 0, tris = 0; g.traverse((o) => { if (o.isMesh) { meshes++; const gg = o.geometry; tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3; } }); return { meshes, tris: Math.round(tris), maxY: (() => { let m = -1e9; g.updateMatrixWorld(true); g.traverse((o) => { if (o.isMesh && o.geometry.boundingSphere) { const b = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld); m = Math.max(m, b.center.y + b.radius); } }); return +m.toFixed(1); })() }; });
  check('城のグループ (park_castle) が出ている', grp && grp.meshes >= 6, grp);

  // ---- 2. 地形: 島と堤道は水の上に出る、脇は掘れている ----
  const hIsl = await hAt(...W(0, 0)), hIsl2 = await hAt(...W(40, -10)), hCw = await hAt(...W(0, 62)), hCw2 = await hAt(...W(0, -62)), hSide = await hAt(...W(24, 62)), hMoat = await hAt(...W(60, 56));
  check('島の上の地面が level (±0.1 m)', Math.abs(hIsl - lv) < 0.1 && Math.abs(hIsl2 - lv) < 0.1, { 中央: +hIsl.toFixed(2), 東: +hIsl2.toFixed(2), level: lv });
  check('堤道 (前・裏) の地面が level (±0.15 m)', Math.abs(hCw - lv) < 0.15 && Math.abs(hCw2 - lv) < 0.15, { 前: +hCw.toFixed(2), 裏: +hCw2.toFixed(2) });
  check('堤道の脇・島のまわりの水面は掘れている (1 m 以上低い)', lv - hSide > 1.0 && lv - hMoat > 1.0, { 堤道の脇: +hSide.toFixed(2), 堀: +hMoat.toFixed(2) });

  // ---- 3. 前の堤道 → 門のトンネル → 中庭 ----
  await place(0, 100);
  await frames(page, 3);
  const a = await walkL([[0, 62], [0, 44], [0, 27], [0, 12]], { maxT: 60, tol: 1.2 });
  console.log(JSON.stringify(a));
  check('前の堤道から門のトンネルを通って中庭まで歩ける', a.out && a.out.length === 4 && a.out.every((q) => q.ok), a.out && a.out.map((q) => q.ok));
  check('道の上の高さが一定 (堤道・トンネル・中庭で ±0.4 m)', a.out && a.out.every((q) => Math.abs(q.hmax - q.hmin) < 0.4 && Math.abs(q.y - lv) < 0.6), a.out && a.out.map((q) => [q.hmin, q.hmax]));

  // ---- 4. 止まる: 主塔・門塔の袖・城壁・塔の根元 ----
  const TW = (id) => C.towers.find((t) => t.id === id), tr = (id) => TW(id).tiers[0].r;   // 塔の位置・半径は設定から (右側の塔)
  const gt = TW('gatetower'), inn = TW('inner'), mid = TW('mid');
  const stops = [
    ['主塔の正面', [0, 12], [0, -4], (r) => r > 11 && r < 15.5, 'keep'],
    ['門塔の左の袖', [-12, 40], [-12, 27], (_, p) => p[1] > 33, 'gate wing'],
    ['門塔の右の袖', [12, 40], [12, 27], (_, p) => p[1] > 33, 'gate wing'],
    ['前の城壁 (外から)', [32, 40], [32, 18], (_, p) => p[1] > 20, 'wall'],
    ['門の塔 (小塔の根元)', [gt.x + 3.5, 44], [gt.x, gt.z], (_, p) => Math.hypot(p[0] - gt.x, p[1] - gt.z) > tr('gatetower') - 0.2, 'gatetower'],
    ['内側の塔 (中庭から)', [inn.x + 10, 14], [inn.x, inn.z], (_, p) => Math.hypot(p[0] - inn.x, p[1] - inn.z) > tr('inner') - 0.2, 'inner'],
    ['中の塔', [mid.x - 7, 4], [mid.x, mid.z], (_, p) => Math.hypot(p[0] - mid.x, p[1] - mid.z) > tr('mid') - 0.2, 'mid'],
  ];
  for (const [name, from, to, ok, tag] of stops) {
    await place(from[0], from[1]); await frames(page, 2);
    const r = await walkL([to], { maxT: 20, walk: true, keepGoing: true, tol: 0.3 });
    const q = r.out && r.out[0], lp = q && L(q.at[0], q.at[1]), kr = q && Math.hypot(lp[0], lp[1] + 4);
    check(`${name}: 中心へ向かうと手前で止まる (めり込まない)`, q && !q.ok && ok(kr, lp), q && { at: q.at, 局所: lp.map((v) => +v.toFixed(1)) });
  }

  // ---- 5. 中庭から塔の間を回って裏の門 → 裏の堤道 → 北の岸 ----
  await place(0, 12); await frames(page, 2);
  const b = await walkL([[25, 14], [25, -12], [10, -20], [0, -22], [0, -40], [0, -62], [0, -90]], { maxT: 60, tol: 1.4, keepGoing: true });
  console.log(JSON.stringify(b));
  check('中庭から塔の間を回って裏の門・裏の堤道・北の岸まで歩ける', b.out && b.out.length === 7 && b.out.every((q) => q.ok), b.out && b.out.map((q) => q.ok));
  const ne = b.out && b.out[b.out.length - 1];
  check('北の岸 (裏の堤道の先) の地面が level', ne && Math.abs(ne.y - lv) < 0.7, ne && ne.y);

  // ---- 6. 水に落ちない: 島の縁・堤道の手すり ----
  await place(30, 34); await frames(page, 2);
  const isl = await walkL([[30, 62]], { maxT: 12, walk: true, keepGoing: true, tol: 0.3 });
  const li = isl.out && isl.out[0] && L(...isl.out[0].at);
  check('前庭から島の縁 (堤道の外) へ歩いても水に入らない', li && !isl.out[0].ok && Math.hypot(li[0] / (C.island.rx + 1), li[1] / (C.island.rz + 1)) < 1.02 && Math.abs(isl.out[0].y - lv) < 0.7, isl.out && { at: isl.out[0].at, 局所: li.map((v) => +v.toFixed(1)), y: isl.out[0].y });
  await place(0, 66); await frames(page, 2);
  const rail = await walkL([[14, 66]], { maxT: 10, walk: true, keepGoing: true, tol: 0.3 });
  const lr = rail.out && rail.out[0] && L(...rail.out[0].at);
  check('堤道の手すりで止まる (堤道の外へ出られない)', lr && !rail.out[0].ok && Math.abs(lr[0]) < C.causeways[0].width / 2 + 0.2, lr && lr.map((v) => +v.toFixed(1)));
  await place(0, -66); await frames(page, 2);
  const rail2 = await walkL([[-14, -66]], { maxT: 10, walk: true, keepGoing: true, tol: 0.3 });
  const lr2 = rail2.out && rail2.out[0] && L(...rail2.out[0].at);
  check('裏の堤道の手すりでも止まる', lr2 && !rail2.out[0].ok && Math.abs(lr2[0]) < C.causeways[1].width / 2 + 0.2, lr2 && lr2.map((v) => +v.toFixed(1)));
  // 湖の北の散歩道 (堤道の軸から離れた所) から湖の中心へ歩くと岸で止まる (岸の柵は堤道の所だけ開いている)
  const lc = park.ellipses['ムーンレイク'].center, lake = park.ellipses['ムーンレイク'];
  await page.evaluate(([x, y, z]) => window.__ride.place(x, y, z, 0), [lc[0] + 80, lv + 0.2, lc[1] - lake.rz - 12]);
  await frames(page, 2);
  const dive = await page.evaluate((a) => window.__walkXZ(a, { maxT: 20, walk: true, keepGoing: true, tol: 0.3 }), [[lc[0] + 80, lc[1]]]);
  const dd = dive.out[0], dEdge = Math.hypot((dd.at[0] - lc[0]) / lake.rx, (dd.at[1] - lc[1]) / lake.rz);
  check('堤道から離れた所から湖へ歩いても、岸の手前で止まる (落ちない)', dd && !dd.ok && dEdge > 1.0 && Math.abs(dd.y - lv) < 0.7, { rho: +dEdge.toFixed(3), y: dd && dd.y });

  // ---- 7. 主塔の中 (改善 1): 扉 → 大広間 → らせん階段 → 屋上のテラス ----
  const KP = (aDeg, r) => [Math.sin(aDeg * Math.PI / 180) * r, -4 + Math.cos(aDeg * Math.PI / 180) * r];   // 主塔の極座標 → 城の局所
  {
    await place(0, 16); await frames(page, 3);
    const closed = await walkL([[0, 0]], { maxT: 10, walk: true, keepGoing: true, tol: 0.3 });
    const lq = closed.out[0] && L(...closed.out[0].at);
    check('扉が閉まっている間は、主塔の中へ入れない (扉の手前で止まる)', lq && !closed.out[0].ok && lq[1] > 7.9, lq && lq.map((v) => +v.toFixed(1)));
    await place(0, 9.8); await frames(page, 3);
    const hint = await page.evaluate(() => { const h = document.getElementById('door-hint'); return h && !h.hidden ? h.textContent : null; });
    check('扉の前で「扉を開ける」の案内が出る', hint && /扉を開ける/.test(hint), hint);
    await page.keyboard.press('KeyF'); await frames(page, 14);
    const open = await page.evaluate(async () => { const { DOORS } = await import('/src/doors.js'); return DOORS.map((d) => ({ amt: +d.amt.toFixed(2), open: d.rec && d.rec.door.open, y: d.y })); });
    check('F で主塔の扉が開く', open.some((d) => d.open && d.amt > 0.9), open);
    const inside = await walkL([[0, 4], [0, -4]], { maxT: 12, walk: true, tol: 0.6 });
    console.log(JSON.stringify(inside));
    check('扉から大広間の中心まで歩いて入れる', inside.out && inside.out.length === 2 && inside.out.every((q) => q.ok), inside.out && inside.out.map((q) => [q.ok, q.y]));
    check('大広間の床の高さに立つ (床 0.4 m の上。地面にめり込まない)', inside.out && Math.abs(inside.out[1].y - (lv + 0.4)) < 0.15, inside.out && inside.out[1].y);
    // らせん階段: 1.5 周。内壁ぞい r = 10.4 を、36 度から 216 + 360 度まで 9 度ずつたどる
    const spiral = [KP(168, 10.4)]; for (let k = 0; k <= 60; k++) spiral.push(KP(180 + k * 9 + 4.5, 10.4));
    await place(...KP(165, 9.0)); await frames(page, 3);
    const climb = await walkL(spiral, { maxT: 8, tol: 0.7, keepGoing: true });
    const lastQ = climb.out && climb.out[climb.out.length - 1], okN = climb.out ? climb.out.filter((q) => q.ok).length : 0;
    check('らせん階段を 1.5 周のぼって、屋上のテラスの高さ (22.7 m) に着く', lastQ && okN >= 60 && Math.abs(lastQ.y - (lv + 22.7)) < 0.8, lastQ && { 着いた点: okN, y: lastQ.y, 期待: +(lv + 22.7).toFixed(2) });
    check('階段の途中で足元が飛ばない (1 点ごとの上り下りが 1.2 m 以内)', climb.out && climb.out.every((q) => q.hmax - q.hmin < 1.2), climb.out && climb.out.map((q) => q.hmax - q.hmin).sort((a, b) => b - a).slice(0, 3));
    // テラス: 階段の出口 (正面 0 度) から右へ歩ける。出口の左 (0 度より手前) は階段の抜け口で、入れない (落ちない)
    const rim = []; for (let a = 9; a <= 63; a += 9) rim.push(KP(a, 11.6));
    const ter = await walkL(rim, { maxT: 8, tol: 0.8, keepGoing: true, walk: true });   // 走ると柵を飛び越える (パルクール)
    const t0 = ter.out;
    check('テラスの出口から右のふちを歩ける (高さ 22.7 m のまま)', t0 && t0.every((q) => q.ok && Math.abs(q.y - (lv + 22.7)) < 0.5), t0 && t0.map((q) => [q.ok, q.y]));
    const hole = await walkL([KP(-40, 11.6)], { maxT: 10, tol: 0.8, keepGoing: true, walk: true });
    const hq = hole.out && hole.out[0], hl = hq && L(...hq.at), hang = hl && Math.atan2(hl[0], hl[1] + 4) * 180 / Math.PI;
    check('抜け口 (出口の左) へは入れない = 穴に落ちない', hq && !hq.ok && hang > -20 && Math.abs(hq.y - (lv + 22.7)) < 0.5, hq && { 角度: +hang.toFixed(1), y: hq.y });
    // 外から: 壁ぞいは歩けない (壁の厚みで止まる)。主塔の裏へ向かう
    await place(0, -26); await frames(page, 2);
    const back = await walkL([[0, -4]], { maxT: 12, walk: true, keepGoing: true, tol: 0.3 });
    const lb = back.out[0] && L(...back.out[0].at);
    check('主塔の裏側 (扉の無い面) へ向かうと外壁で止まる', lb && !back.out[0].ok && Math.hypot(lb[0], lb[1] + 4) > 11.5, lb && lb.map((v) => +v.toFixed(1)));
  }

  // ---- 8. 動き・NaN ----
  const st = await page.evaluate(() => { const g = window.__g.scene.getObjectByName('park_castle'); const c = g.getObjectByName('castle_crown'); return { crown: !!c, rot: c ? c.rotation.y : null }; });
  check('冠 (castle_crown) が回る設定で出ている', st.crown, st);
  check('ページのエラーが無い', page.errs.length === 0, page.errs.slice(0, 3));

  await browser.close(); server.close();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} OK`);
  process.exit(bad.length ? 1 : 0);
})();
