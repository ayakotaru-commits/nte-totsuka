// タッチ操作 (public/src/touch.js) の確認。スマホの画面サイズ・タッチ有りのヘッドレスブラウザでゲームを開き、
// 指の動きを疑似的に送って、キャラ・カメラ・地図が反応するかを数字と画像で確かめる。
//
// 準備は shot.js と同じ (three.js を tools/dev/.cache に置く)。
// 使い方: node tools/dev/touchshot.js <出力フォルダ>
//   横向き (844x390) で: 開始 → スティックで前進 → 視点 → つまんでズーム → ジャンプ → ダッシュ → 地図 (ピン・ワープ)。最後に縦向きの画像も撮る。
// 描画はソフトウェアで遅いので、影なし・低解像度で開く。それでも全体で 10 分ほどかかる。実機での操作感と重さはここではわからない。
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(__dirname, '.cache', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };

(async () => {
  const out = process.argv[2];
  if (!out) { console.error('usage: node tools/dev/touchshot.js <出力フォルダ>'); process.exit(1); }
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    const p = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r =>
    r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
  await page.route('https://cdn.jsdelivr.net/npm/@pixiv/**', r => r.abort()); // VRM の部品は届かない → 組み立て式のキャラになる
  await page.route('**/src/main.js', async r => {
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, bigmap, input };\n  const qs = new URLSearchParams');
    r.fulfill({ body: t, contentType: 'application/javascript' });
  });
  page.on('pageerror', e => console.log('ERR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('LOG', m.text()); });
  await page.goto(base + '/?noshadow&noaa&pr=0.5', { timeout: 300000 });
  await page.waitForFunction(() => window.__g && document.getElementById('status').textContent === '準備完了', null, { timeout: 300000 });

  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const wait = (ms) => page.waitForTimeout(ms);
  const state = () => page.evaluate(() => { const g = window.__g; return { x: +g.player.pos.x.toFixed(2), y: +g.player.pos.y.toFixed(2), z: +g.player.pos.z.toFixed(2), speed: +g.player.vel.length().toFixed(2), yaw: +g.cam.yaw.toFixed(3), pitch: +g.cam.pitch.toFixed(3), dist: +g.cam.dist.toFixed(2), overlay: !document.getElementById('overlay').hidden, map: g.bigmap.open, target: g.bigmap.target, ax: g.input.ax, az: g.input.az }; });
  const shot = (n) => page.screenshot({ path: path.join(out, n + '.png') });
  const log = async (label) => console.log(label, JSON.stringify(await state()));
  const tapEl = async (sel) => { const b = await page.locator(sel).boundingBox(); const p = [[b.x + b.width / 2, b.y + b.height / 2]]; await touch('touchStart', p); await wait(80); await touch('touchEnd', []); };

  console.log('touch mode:', await page.evaluate(() => document.body.classList.contains('touch')));
  await shot('0_start'); await log('開始前');
  await page.touchscreen.tap(422, 195); await wait(500); await log('タップ後 (overlay=false のはず)');

  // スティック: 左下に触れて上へ深く倒す → 走り
  await touch('touchStart', [[140, 280]]);
  for (let i = 1; i <= 3; i++) { await touch('touchMove', [[140, 280 - i * 20]]); await wait(30); }
  await wait(2500); await shot('1_stick_run'); await log('スティック深く (走り 5.5 前後)');
  await touch('touchMove', [[140, 258]]); await wait(2500); await log('スティック浅く (歩き 1.6 前後)');

  // 走りながら、右側のドラッグで視点
  await touch('touchMove', [[140, 220]]); await wait(300);
  await touch('touchMove', [[140, 220], [600, 200]]); // 2 本目の指 (id=1) は touchStart 扱いにならないので下で送り直す
  await touch('touchEnd', []); await wait(300); await log('指を離す (ax=az=0・減速)');

  const before = await state();
  await touch('touchStart', [[600, 200]]);
  for (let i = 1; i <= 4; i++) { await touch('touchMove', [[600 + i * 30, 200 + i * 10]]); await wait(30); }
  await touch('touchEnd', []); await wait(200);
  const after = await state();
  console.log('視点: yaw', before.yaw, '→', after.yaw, ' pitch', before.pitch, '→', after.pitch);

  // 右側で 2 本指を広げる → 近づく
  await touch('touchStart', [[560, 200], [640, 200]]);
  for (let i = 1; i <= 4; i++) { await touch('touchMove', [[560 - i * 20, 200], [640 + i * 20, 200]]); await wait(30); }
  await touch('touchEnd', []); await wait(200); await log('指を広げた (dist が減る)');
  await touch('touchStart', [[480, 200], [720, 200]]);
  for (let i = 1; i <= 4; i++) { await touch('touchMove', [[480 + i * 25, 200], [720 - i * 25, 200]]); await wait(30); }
  await touch('touchEnd', []); await wait(200); await log('指を狭めた (dist が増える)');

  // ジャンプ
  const y0 = (await state()).y; await tapEl('#tb-jump'); await wait(250);
  console.log('ジャンプ: y', y0, '→', (await state()).y);
  await wait(1500);

  // スティック + ダッシュ (2 本同時)
  const d = await page.locator('#tb-dash').boundingBox(); const dp = [d.x + d.width / 2, d.y + d.height / 2];
  await touch('touchStart', [[140, 280]]); await touch('touchMove', [[140, 220]]); await wait(100);
  await touch('touchStart', [[140, 220], dp]); await wait(2500); await shot('2_dash'); await log('ダッシュ (10 前後)');
  await touch('touchEnd', []); await wait(800);

  // 時間帯
  await tapEl('#tb-top .tbtn[data-key=KeyT]'); await wait(1500);
  console.log('時間帯:', await page.evaluate(() => document.getElementById('hud-time').textContent));

  // 地図: 開く → つまんで拡大 → ドラッグ → タップでピン → ワープ
  await tapEl('#tb-top .tbtn[data-key=KeyM]'); await wait(1500); await log('地図を開く');
  const s0 = await page.evaluate(() => window.__g.bigmap.scale);
  await touch('touchStart', [[380, 180], [460, 180]]);
  for (let i = 1; i <= 4; i++) { await touch('touchMove', [[380 - i * 20, 180], [460 + i * 20, 180]]); await wait(30); }
  await touch('touchEnd', []); await wait(300);
  console.log('地図の倍率:', s0, '→', await page.evaluate(() => window.__g.bigmap.scale));
  const c0 = await page.evaluate(() => [window.__g.bigmap.cx, window.__g.bigmap.cz]);
  await touch('touchStart', [[400, 200]]);
  for (let i = 1; i <= 4; i++) { await touch('touchMove', [[400 + i * 20, 200]]); await wait(30); }
  await touch('touchEnd', []); await wait(300);
  console.log('地図のドラッグ: 中心', c0, '→', await page.evaluate(() => [window.__g.bigmap.cx, window.__g.bigmap.cz]), ' ピン (無しのはず):', (await state()).target);
  await page.touchscreen.tap(300, 150); await wait(800); await shot('3_map_pin'); await log('地図をタップ (target が入る)');
  await tapEl('#map-touch .tbtn[data-act=warp]'); await wait(1500); await shot('4_after_warp'); await log('ワープ後 (map=false・位置が変わる)');
  await tapEl('#minimap'); await wait(1000); await log('ミニマップをタップ (map=true)');
  await tapEl('#map-touch .tbtn[data-key=KeyM]'); await wait(1000); await log('閉じる (map=false)');

  // 縦向き
  await page.setViewportSize({ width: 390, height: 844 }); await wait(3000); await shot('5_portrait');
  await browser.close(); server.close();
})();
