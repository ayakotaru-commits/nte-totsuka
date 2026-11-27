// 撮影モード (public/src/photo.js) の確認。PC (キー) とスマホ (タッチ) のヘッドレスブラウザで、
//   入る → 画面の部品が消える → ズーム・視点が効く → 歩き出す・Esc・I・×ボタンで抜ける、を数字と画像で確かめる。
// 準備は shot.js と同じ (three.js を tools/dev/.cache に置く)。
// 使い方: node tools/dev/photocheck.js <出力フォルダ>
// 描画はソフトウェアで 1 コマ 1〜2 秒かかるので、待ち時間は長い (全体で 5〜10 分)。実機の見え方・指の操作感はここではわからない。
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(__dirname, '.cache', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
let bad = 0, total = 0;
const ok = (name, cond, extra = '') => { total++; if (!cond) bad++; console.log((cond ? 'OK  ' : 'NG  ') + name + (extra ? '  ' + extra : '')); };

(async () => {
  const out = process.argv[2];
  if (!out) { console.error('usage: node tools/dev/photocheck.js <出力フォルダ>'); process.exit(1); }
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

  async function open(opts) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.setDefaultTimeout(300000);
    await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r =>
      r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
    await page.route('https://cdn.jsdelivr.net/npm/@pixiv/**', r => r.abort());
    await page.route('**/src/main.js', async r => {
      const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, input, menu: () => menu, crowd, traffic };\n  const qs = new URLSearchParams');
      r.fulfill({ body: t, contentType: 'application/javascript' });
    });
    page.on('pageerror', e => { bad++; console.log('NG  pageerror', e.message); });
    await page.goto(base + '/?noshadow&noaa&pr=0.5', { timeout: 300000 });
    await page.waitForFunction(() => window.__g && window.__photo && document.getElementById('status').textContent === '準備完了', null, { timeout: 300000 });
    return { ctx, page };
  }
  const active = (page) => page.evaluate(() => window.__photo.active);
  const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 120000 }).then(() => true).catch(() => false);
  // 画面の部品の表示 (display が none でないものの id)
  const visibleUi = (page) => page.evaluate(() => [...document.body.children].filter(e => e.id && !['app', 'photo-ui'].includes(e.id) && e.tagName !== 'SCRIPT' && getComputedStyle(e).display !== 'none').map(e => e.id));

  // ===== PC =====
  {
    const { ctx, page } = await open({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });
    await page.mouse.click(500, 300); // 開始
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, 'pc_0_normal.png') });
    const uiBefore = await visibleUi(page);
    ok('PC: ふだんは部品が見える (ミニマップ・メニューのボタンなど)', uiBefore.includes('minimap') && uiBefore.includes('menu-btn'), uiBefore.join(','));

    await page.keyboard.press('KeyI');
    ok('PC: I で撮影モードに入る', await until(page, () => window.__photo.active));
    const uiPhoto = await visibleUi(page);
    ok('PC: 入ると部品が全部消える', uiPhoto.length === 0, uiPhoto.join(','));
    ok('PC: 街の絵 (canvas) は残る', await page.evaluate(() => { const c = document.querySelector('#app canvas'); return !!c && getComputedStyle(c).display !== 'none'; }));
    ok('PC: 最初の案内が出る', await page.evaluate(() => document.getElementById('photo-hint').classList.contains('show')));
    await page.screenshot({ path: path.join(out, 'pc_1_photo.png') });
    ok('PC: 案内は数秒で消える', await until(page, () => !document.getElementById('photo-hint').classList.contains('show')));
    await page.screenshot({ path: path.join(out, 'pc_2_photo_clean.png') });

    // ズーム: ふだんの上限 (30) を超えて引ける
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 100);
    const d = await page.evaluate(() => window.__g.cam.dist);
    ok('PC: 撮影モード中は 30 m より遠くまで引ける', d > 30 && d <= 80.01, 'dist=' + d.toFixed(1));
    // 撮影中は人・車の更新が止まる (crowd.update・traffic.update が呼ばれない)
    const frozen = await page.evaluate(() => new Promise(res => {
      const g = window.__g; let n = 0; const c0 = g.crowd.update, t0 = g.traffic.update;
      g.crowd.update = function (...a) { n++; return c0.apply(this, a); }; g.traffic.update = function (...a) { n++; return t0.apply(this, a); };
      setTimeout(() => { g.crowd.update = c0; g.traffic.update = t0; res(n); }, 6000);
    }));
    ok('PC: 撮影中は人と車の更新が止まる', frozen === 0, 'calls=' + frozen);
    await page.screenshot({ path: path.join(out, 'pc_3_zoomed_out.png') });

    // J (攻撃)・F で歩き出さない / 抜けない
    const p0 = await page.evaluate(() => [window.__g.player.pos.x, window.__g.player.pos.z]);
    await page.keyboard.press('KeyJ'); await page.waitForTimeout(3000);
    ok('PC: 撮影中に J を押しても抜けず、キャラも動かない', (await active(page)) && (await page.evaluate(([x, z]) => Math.hypot(window.__g.player.pos.x - x, window.__g.player.pos.z - z), p0)) < 0.05);

    // T: 時間帯は変えられる
    const t0 = await page.evaluate(() => document.getElementById('hud-time').textContent);
    await page.keyboard.press('KeyT');
    ok('PC: 撮影中も T で時間帯を変えられる', await until(page, (t) => document.getElementById('hud-time').textContent !== t, t0));

    // 歩き出したら抜ける
    await page.keyboard.down('KeyW');
    ok('PC: W (歩き出し) で撮影モードを抜ける', await until(page, () => !window.__photo.active));
    await page.waitForTimeout(2500);
    const p1 = await page.evaluate(() => [window.__g.player.pos.x, window.__g.player.pos.z]);
    await page.keyboard.up('KeyW');
    ok('PC: 抜けたコマからキャラが歩く', Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 0.3, 'moved=' + Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(2));
    ok('PC: 抜けると部品が戻る・ズームの上限も戻る', (await visibleUi(page)).includes('minimap') && (await page.evaluate(() => window.__g.cam.maxDist)) === 30);
    ok('PC: 撮影モードを抜けると人と車の更新が再開する', await page.evaluate(() => new Promise(res => {
      const g = window.__g; let n = 0; const c0 = g.crowd.update; g.crowd.update = function (...a) { n++; return c0.apply(this, a); };
      setTimeout(() => { g.crowd.update = c0; res(n > 0); }, 6000);
    })));

    // I で入って、I で抜ける / Esc で抜ける
    await page.keyboard.press('KeyI'); await until(page, () => window.__photo.active);
    await page.keyboard.press('KeyI');
    ok('PC: もう一度 I で抜ける', await until(page, () => !window.__photo.active));
    await page.keyboard.press('KeyI'); await until(page, () => window.__photo.active);
    await page.keyboard.press('Escape');
    ok('PC: Esc で抜ける', await until(page, () => !window.__photo.active));

    // メニューから入る
    await page.keyboard.press('Tab');
    ok('PC: Tab でメニューが開く', await until(page, () => window.__g.menu()?.open));
    await page.evaluate(() => document.querySelector('#menu [data-do=photo]').click());
    ok('PC: メニューの「撮影モード」で入る (メニューは閉じる)', await until(page, () => window.__photo.active) && !(await page.evaluate(() => window.__g.menu().open)));
    // メニュー・地図が開いているときは、I で入れない
    await page.keyboard.press('KeyI'); await until(page, () => !window.__photo.active);
    await page.keyboard.press('Tab'); await until(page, () => window.__g.menu()?.open);
    await page.keyboard.press('KeyI'); await page.waitForTimeout(3000);
    ok('PC: メニューを開いている間は I で入らない', !(await active(page)));
    await ctx.close();
  }

  // ===== スマホ =====
  {
    const { ctx, page } = await open({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    const wait = (ms) => page.waitForTimeout(ms);
    const tapAt = async (x, y) => { await touch('touchStart', [[x, y]]); await wait(80); await touch('touchEnd', []); };
    const camState = () => page.evaluate(() => ({ yaw: window.__g.cam.yaw, dist: window.__g.cam.dist }));
    await page.touchscreen.tap(422, 195); await wait(1000);
    await page.screenshot({ path: path.join(out, 'touch_0_normal.png') });

    const b = await page.locator('#tb-top .tbtn[data-key=KeyI]').boundingBox();
    await tapAt(b.x + b.width / 2, b.y + b.height / 2);
    ok('スマホ: 上の帯の「撮影」で入る', await until(page, () => window.__photo.active));
    const ui = await visibleUi(page);
    ok('スマホ: 入ると部品 (スティック・ボタン類) が全部消える', ui.length === 0, ui.join(','));
    ok('スマホ: 入った直後の案内は「タップで終了ボタン」', await page.evaluate(() => /タップ/.test(document.getElementById('photo-hint').textContent)));
    await page.screenshot({ path: path.join(out, 'touch_1_photo_hint.png') });
    await until(page, () => !document.getElementById('photo-hint').classList.contains('show'));
    ok('スマホ: 何も触らなければ、終了ボタンは出ない', !(await page.evaluate(() => document.getElementById('photo-exit').classList.contains('show'))));
    await page.screenshot({ path: path.join(out, 'touch_2_photo_clean.png') });

    // 左側のドラッグでも視点が回る (スティックは出ない)
    const c0 = await camState();
    await touch('touchStart', [[140, 200]]);
    for (let i = 1; i <= 5; i++) { await touch('touchMove', [[140 + i * 25, 200]]); await wait(40); }
    await touch('touchEnd', []); await wait(400);
    const c1 = await camState();
    ok('スマホ: 左側のドラッグで視点が回る (歩き出さない・抜けない)', Math.abs(c1.yaw - c0.yaw) > 0.1 && (await active(page)), `yaw ${c0.yaw.toFixed(2)} → ${c1.yaw.toFixed(2)}`);
    ok('スマホ: ドラッグでは終了ボタンが出ない', !(await page.evaluate(() => document.getElementById('photo-exit').classList.contains('show'))));
    // つまんでズーム (上限 30 を超える)
    for (let k = 0; k < 6; k++) {
      await touch('touchStart', [[420, 200], [440, 200]]);
      for (let i = 1; i <= 4; i++) { await touch('touchMove', [[420 - i * 60, 200], [440 + i * 60, 200]]); await wait(30); }
      await touch('touchEnd', []); await wait(120);
    }
    // ↑は指を広げる = 近づく。狭める = 遠ざかる
    for (let k = 0; k < 10; k++) {
      await touch('touchStart', [[180, 200], [660, 200]]);
      for (let i = 1; i <= 4; i++) { await touch('touchMove', [[180 + i * 100, 200], [660 - i * 100, 200]]); await wait(30); }
      await touch('touchEnd', []); await wait(120);
    }
    const c2 = await camState();
    ok('スマホ: つまんで 30 m より遠くへ引ける', c2.dist > 30, 'dist=' + c2.dist.toFixed(1));

    // タップで終了ボタン
    await tapAt(500, 250);
    ok('スマホ: 画面を 1 回タップすると終了ボタンが出る', await until(page, () => document.getElementById('photo-exit').classList.contains('show')));
    await page.screenshot({ path: path.join(out, 'touch_3_exit_button.png') });
    ok('スマホ: 終了ボタンは数秒で消える', await until(page, () => !document.getElementById('photo-exit').classList.contains('show')));
    await tapAt(500, 250); await until(page, () => document.getElementById('photo-exit').classList.contains('show'));
    const eb = await page.locator('#photo-exit').boundingBox();
    await tapAt(eb.x + eb.width / 2, eb.y + eb.height / 2);
    ok('スマホ: 終了ボタンで抜ける', await until(page, () => !window.__photo.active));
    const ui2 = await visibleUi(page);
    ok('スマホ: 抜けると部品が戻る', ui2.includes('minimap') && ui2.includes('touch-ui'), ui2.join(','));
    await page.screenshot({ path: path.join(out, 'touch_4_back.png') });
    await ctx.close();
  }

  await browser.close(); server.close();
  console.log(`\n${total - bad}/${total} OK`);
  process.exit(bad ? 1 : 0);
})();
