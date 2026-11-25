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

  await browser.close(); server.close();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} OK`);
  process.exit(bad.length ? 1 : 0);
})();
