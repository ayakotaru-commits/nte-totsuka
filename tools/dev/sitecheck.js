// 延ばした先の駅の駅舎・駅前 (rail_ext の stations[].site。舞浜) を、キャラを歩かせて確かめる (疑似入力。画面は撮らない)。
// 使い方: node tools/dev/sitecheck.js [--station 舞浜]   (10〜20 分)
// 確かめること: ホーム → 階段 → 改札の中 → 改札機の間 → 北口 → デッキ → 地上への階段 → 広場 (と逆)、ホームの穴・デッキの縁から落ちない、
// エスカレーターに入れない、地図の「舞浜駅（北口）」の印でワープすると広場に立つ、NaN が無い
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(__dirname, '.cache', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };

(async () => {
  const args = process.argv.slice(2);
  const si = args.indexOf('--station'), stationName = si >= 0 ? args[si + 1] : '舞浜';
  const server = http.createServer((req, res) => {
    const p = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  page.setDefaultTimeout(600000);
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r =>
    r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
  await page.route('**/src/main.js', async r => {
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, world, camera, warpTo, EVENTS };\n  const qs = new URLSearchParams');
    r.fulfill({ body: t, contentType: 'application/javascript' });
  });
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto(base + '/?shot&novrm', { timeout: 600000 });
  await page.waitForFunction(() => window.__g && window.__ride, null, { timeout: 600000 });
  const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const fn = () => (++k >= n ? r() : requestAnimationFrame(fn)); requestAnimationFrame(fn); }), n);
  const extIdle = async () => { for (let k = 0; k < 300; k++) { await frames(2); if (await page.evaluate(() => !window.__railext || window.__railext.stats.idle)) return; } console.log('区間の読み込みが終わらない'); };

  // 駅の向きの座標と、歩かせる関数をページに置く
  const site = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'rail_ext', 'index.json'))).stations.find((q) => q.name === stationName).site;
  const f = site.frame, G = f.gy, F = f.gy + site.floor, PY = f.py;
  await page.evaluate((f) => {
    window.__S = {
      f,
      xz: (s, t) => [f.cx + f.sx * s + f.nx * t, f.cz + f.sz * s + f.nz * t],
      st: (x, z) => [(x - f.cx) * f.sx + (z - f.cz) * f.sz, (x - f.cx) * f.nx + (z - f.cz) * f.nz],
    };
    // (s, t) の点を順にたどって歩く (歩き。1 点ごとに最大 maxT 秒)。戻り値: 各点に着いたか・高さ・止まった所
    window.__walk = (pts, opt = {}) => {
      const g = window.__g, pl = g.player, S = window.__S, dt = 1 / 30, out = [];
      const mk = (keys) => ({ pressed: () => false, held: (k) => keys.includes(k), ax: 0, az: 0, endFrame() {} });
      pl.walkMode = !!opt.walk;   // 歩き (C キー)。走り・ダッシュではパルクールで手すりを飛び越える (ゲームの決まり)
      for (const [s, t] of pts) {
        const [tx, tz] = S.xz(s, t);
        let ok = false, k = 0;
        for (; k < (opt.maxT || 20) / dt; k++) {
          const dx = tx - pl.pos.x, dz = tz - pl.pos.z, d = Math.hypot(dx, dz);
          if (d < (opt.tol || 0.35)) { ok = true; break; }
          g.cam.yaw = Math.atan2(dx, dz) + Math.PI;
          pl.update(dt, mk(['KeyW']), g.cam);
          if (!Number.isFinite(pl.pos.x + pl.pos.y + pl.pos.z)) return { nan: true, out };
        }
        for (let j = 0; j < 20; j++) pl.update(dt, mk([]), g.cam);   // 止まって落ち着く
        const [ss, tt] = S.st(pl.pos.x, pl.pos.z);
        out.push({ to: [s, t], ok, at: [+ss.toFixed(2), +tt.toFixed(2)], y: +pl.pos.y.toFixed(2), sec: +(k * dt).toFixed(1) });
        if (!ok && !opt.keepGoing) break;
      }
      pl.walkMode = false;
      return { out };
    };
    window.__put = (s, t, y) => { const [x, z] = window.__S.xz(s, t); window.__ride.place(x, y, z, 0); };
  }, f);
  const results = [];
  const check = (name, cond, info) => { results.push({ name, ok: !!cond }); console.log(cond ? 'OK ' : 'NG ', name, info ? JSON.stringify(info) : ''); };
  const near = (a, b, e = 0.25) => Math.abs(a - b) < e;

  // 1. ホーム → 階段 (3 番目: 上の端 16、+s へ下りる) → 改札の中 → 改札機の間 → 北口 → デッキ → 地上への階段 → 広場
  const [st3a, st3d] = site.stairs[2], [gs0, gs1, gt] = site.gates, [gst, gt0, gt1] = site.gstairs;
  await page.evaluate(([s, PY]) => window.__put(s, -0.8, PY), [st3a - 4, PY]);
  await frames(2); await extIdle();
  const down = await page.evaluate((a) => window.__walk(a), [
    [st3a - 1, -0.8], [st3a + st3d * 6, -0.8], [st3a + st3d * 13, -0.8], [st3a + st3d * 14.5, -0.8],   // 階段を下りる
    [(gs0 + gs1) / 2 + 0.5, gt - 3], [(gs0 + gs1) / 2 + 0.5, gt + 2],                                     // 改札機の間を通る
    [(gs0 + gs1) / 2, 30], [gst - 1, (gt0 + gt1) / 2], [gst + 12, (gt0 + gt1) / 2], [gst + 16, 26],       // デッキ → 地上への階段 → 広場
  ]);
  console.log(JSON.stringify(down));
  const o = down.out || [];
  check('ホームから階段を下りて改札の階に着く', o[3] && o[3].ok && near(o[3].y, F), o[3]);
  check('改札機の間を通って北口に出る', o[5] && o[5].ok && near(o[5].y, F), o[5]);
  check('デッキに出る', o[6] && o[6].ok && near(o[6].y, F), o[6]);
  check('地上への階段を下りて広場に着く', o[9] && o[9].ok && Math.abs(o[9].y - G) < 0.7, o[9]);
  check('NaN なし (下り)', !down.nan);

  // 2. 逆: 広場 → 階段を上る → デッキ → 北口 → 改札 → 階段 (2 番目: 上の端 -10、+s へ下りる。下の端から上る) → ホーム
  const [st2a, st2d] = site.stairs[1];
  const up = await page.evaluate((a) => window.__walk(a), [
    [gst + 12, (gt0 + gt1) / 2], [gst - 2, (gt0 + gt1) / 2], [(gs0 + gs1) / 2 + 0.5, 30], [(gs0 + gs1) / 2 + 0.5, gt + 2], [(gs0 + gs1) / 2 + 0.5, gt - 3],
    [st2a + st2d * 14.5, -0.8], [st2a + st2d * 12.5, -0.8], [st2a + st2d * 6, -0.8], [st2a - st2d * 1.5, -0.8], [st2a - st2d * 4, 3],
  ]);
  console.log(JSON.stringify(up));
  const u = up.out || [];
  check('広場から階段を上ってデッキに着く', u[1] && u[1].ok && near(u[1].y, F), u[1]);
  check('改札を通って改札の中に入る', u[4] && u[4].ok && near(u[4].y, F), u[4]);
  check('階段を上ってホームに着く', u[9] && u[9].ok && near(u[9].y, PY), u[9]);
  check('ホームにいる (ride の onPlatform)', await page.evaluate(() => !!window.__ride.onPlatform()));
  check('NaN なし (上り)', !up.nan);

  // 3. 落ちない・入れない (歩きで。走り・ダッシュではパルクールで手すりを飛び越えられる): ホームの穴を横切ろうとする、エスカレーターへ入ろうとする、デッキの縁・バルコニーの手すりを越えようとする
  await page.evaluate(([s, PY]) => window.__put(s, 3.8, PY), [st3a + 6, PY]);
  let r = await page.evaluate((s) => window.__walk([[s, -3.8]], { maxT: 6, keepGoing: true, walk: true }), st3a + 6);
  check('ホームの穴の手すりで止まり、ホームの上にいる', r.out[0] && !r.out[0].ok && near(r.out[0].y, PY) && r.out[0].at[1] > 2.2, r.out[0]);
  await page.evaluate(([s, PY]) => window.__put(s, 1.5, PY), [st3a - 3, PY]);
  r = await page.evaluate((s) => window.__walk([[s, 1.5]], { maxT: 6, keepGoing: true, walk: true }), st3a + 8);
  check('エスカレーターの口で止まる (ホームの上)', r.out[0] && !r.out[0].ok && near(r.out[0].y, PY), r.out[0]);
  await page.evaluate(([F]) => window.__put(40, 31, F), [F]);
  r = await page.evaluate(() => window.__walk([[40, 40]], { maxT: 6, keepGoing: true, walk: true }));
  check('デッキの北の縁の手すりで止まる', r.out[0] && !r.out[0].ok && near(r.out[0].y, F) && r.out[0].at[1] < 33.1, r.out[0]);
  const [bs, bt, br] = site.balcony;
  await page.evaluate(([s, t, F]) => window.__put(s, t, F), [bs - 2, bt, F]);
  r = await page.evaluate(([s, t]) => window.__walk([[s, t]], { maxT: 6, keepGoing: true, walk: true }), [bs - br - 5, bt]);
  check('丸いバルコニーの手すりで止まる', r.out[0] && !r.out[0].ok && near(r.out[0].y, F), r.out[0]);
  await page.evaluate(([F]) => window.__put(0, -6, F), [F]);
  r = await page.evaluate(() => window.__walk([[0, -16]], { maxT: 6, keepGoing: true, walk: true }));
  check('改札の中の南の壁で止まる', r.out[0] && !r.out[0].ok && near(r.out[0].y, F) && r.out[0].at[1] > -11, r.out[0]);
  // 地上から改札の階の下 (1 階の壁) に入れない
  await page.evaluate(([G]) => window.__put(30, 40, G + 0.2), [G]);
  r = await page.evaluate(() => window.__walk([[30, 20]], { maxT: 8, keepGoing: true, walk: true }));
  check('地上から北口の建物の 1 階の壁に入れない', r.out[0] && !r.out[0].ok && r.out[0].at[1] > 26.5 && r.out[0].y < G + 1, r.out[0]);

  // 3b. 南口 (site.south があれば): 改札の中 → 南の改札機の間 → デッキ → 東の階段を下りてロータリー → 上って戻る、デッキの南の縁・地上から 1 階の壁
  const SO = site.south;
  if (SO) {
    const [sx0, sx1] = [SO.gates[0], SO.gates[1]], sm = (sx0 + sx1) / 2, ds = SO.deck, [ss0, sdir, st0, st1] = SO.gstairs[SO.gstairs.length - 1], sty = (st0 + st1) / 2;
    await page.evaluate(([s, F]) => window.__put(s, -5.5, F), [sm, F]);
    await frames(2); await extIdle();
    const sd = await page.evaluate((a) => window.__walk(a), [[sm, -7], [sm, -9.5], [sm, -16], [ss0 - 3, sty], [ss0 + 2, sty], [ss0 + sdir * 6, sty], [ss0 + sdir * 11, sty], [ss0 + sdir * 14, sty]]);
    console.log(JSON.stringify(sd));
    const q = sd.out || [];
    check('南の改札機の間を通って南口のデッキに出る', q[2] && q[2].ok && near(q[2].y, F), q[2]);
    check('南のデッキから地上への階段を下りてロータリーに着く', q[7] && q[7].ok && Math.abs(q[7].y - G) < 0.7, q[7]);
    const su = await page.evaluate((a) => window.__walk(a), [[ss0 + sdir * 11, sty], [ss0 + sdir * 6, sty], [ss0 + 1, sty], [ss0 - 3, sty], [sm, -16], [sm, -7]]);
    const w = su.out || [];
    check('ロータリーから階段を上ってデッキに戻り、改札の中に入る', w[5] && w[5].ok && near(w[5].y, F), w[5]);
    await page.evaluate(([s, t, F]) => window.__put(s, t, F), [30, -22, F]);
    r = await page.evaluate(() => window.__walk([[30, -35]], { maxT: 6, keepGoing: true, walk: true }));
    check('南のデッキの縁の手すりで止まる', r.out[0] && !r.out[0].ok && near(r.out[0].y, F) && r.out[0].at[1] > -27.6, r.out[0]);
    await page.evaluate(([s, t, G]) => window.__put(s, t, G + 0.2), [25, -30, G]);
    r = await page.evaluate(() => window.__walk([[25, -5]], { maxT: 8, keepGoing: true, walk: true }));
    check('地上から南の壁の下 (1 階) に入れない', r.out[0] && !r.out[0].ok && r.out[0].at[1] < -10 && r.out[0].y < G + 1, r.out[0]);
    check('NaN なし (南口)', !sd.nan && !su.nan);
    const sp = await page.evaluate((name) => {
      const e = window.__g.EVENTS.find((q) => q.name === name + '駅（南口）');
      if (!e) return null;
      window.__g.warpTo(e.x, e.z);
      const p = window.__g.player.pos; return { d: Math.hypot(p.x - e.x, p.z - e.z), y: p.y, st: window.__S.st(p.x, p.z) };
    }, stationName);
    check('地図に「' + stationName + '駅（南口）」の印があり、選ぶとロータリーに立つ', sp && sp.d < 1 && Math.abs(sp.y - G) < 0.7, sp);
  }

  // 4. 地図の印「舞浜駅（北口）」でワープすると広場に立つ
  const spot = await page.evaluate((name) => {
    const e = window.__g.EVENTS.find((q) => q.name === name + '駅（北口）');
    if (!e) return null;
    window.__g.warpTo(e.x, e.z);
    const p = window.__g.player.pos; return { x: e.x, z: e.z, y: p.y, d: Math.hypot(p.x - e.x, p.z - e.z), st: window.__S.st(p.x, p.z) };
  }, stationName);
  check('地図に「' + stationName + '駅（北口）」の印があり、選ぶと広場に立つ', spot && spot.d < 1 && Math.abs(spot.y - G) < 0.7, spot);
  const pass = results.filter((q) => q.ok).length;
  console.log(`${pass}/${results.length}`);
  await browser.close();
  server.close();
})();
