// イベント「ゲームセンター リズムステージ」(public/src/arcade/) の、ゲーム本体での通しの確認 (ブラウザ)。
// 使い方: node tools/dev/arcadecheck.js <出力フォルダ> [--noshots]   (準備は shot.js と同じ。街の読み込みが 1 ページ 1〜2 分、全体で 5〜8 分)
//   1. 入口に立つと聞く表示が出る → N で閉じる → 出て入り直すとまた出る → Y で曲えらびへ (画面が全部おおわれ、キャラが歩かない)
//   2. 曲えらびの操作 (難易度・速さ・効果音・タイミング・ボタンでスタート) → 本物のキーを 1 回押す → 疑似キーで譜面どおり打つ (判定の数)
//   3. Esc で曲えらびへ戻る → もう一度 → 自動で最後まで (bot) → 結果の画面・ベストの記録
//   4. スマホの画面 (タッチ): タップで入る・スタート・レーンのタップ・長押し・上へのフリック (--touch-only でこの 4 だけ)
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(__dirname, '.cache', 'package');
const VRM_DIR = path.join(__dirname, '.cache', 'vrm', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg' };
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'OK  ' : 'NG  ') + msg); if (!c) fails++; };

(async () => {
  const [out] = process.argv.slice(2);
  const noShots = process.argv.includes('--noshots');
  if (!out) { console.error('usage: node tools/dev/arcadecheck.js <出力フォルダ> [--noshots]'); process.exit(1); }
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    const p = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const open = async (q, opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, ...opts });
    const page = await ctx.newPage();
    page.setDefaultTimeout(300000);
    await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r =>
      r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
    if (fs.existsSync(VRM_DIR)) await page.route('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.3.3/**', r =>
      r.fulfill({ path: path.join(VRM_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.3.3/', '')), contentType: 'application/javascript' }));
    await page.route('**/src/main.js', async r => {
      const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, world, input, look };\n  const qs = new URLSearchParams');
      r.fulfill({ body: t, contentType: 'application/javascript' });
    });
    page.on('pageerror', e => console.log('ERR', e.message));
    page.on('console', m => { if (/rror/.test(m.text()) && !/VRM/.test(m.text())) console.log('LOG', m.text()); });
    await page.goto(base + '/' + q, { timeout: 300000 });
    await page.waitForFunction(() => window.__g && window.__arcade, null, { timeout: 300000 });
    await page.addStyleTag({ content: '#help{display:none!important}' });
    return page;
  };
  const shot = async (page, name) => { if (!noShots) await page.screenshot({ path: path.join(out, name + '.png') }); };
  const st = (page) => page.evaluate(() => window.__arcade.state);
  const waitState = (page, s, ms = 60000) => page.waitForFunction((s) => window.__arcade.state === s, s, { timeout: ms });

  // ===== 1・2・3: PC =====
  if (!process.argv.includes('--touch-only')) {
  const page = await open('?shot&arcade=ask&x=-190.5&z=164.1&face=-1.5708&yaw=1.2&pitch=0.25&dist=7');
  await waitState(page, 'ask');
  ok(await page.evaluate(() => !document.getElementById('ar-ask').hidden), '入口に少し立つと、聞く表示が出る');
  await shot(page, '1_ask');
  await page.keyboard.press('KeyN');
  await page.waitForFunction(() => window.__arcade.state === 'idle');
  ok(await page.evaluate(() => document.getElementById('ar-ask').hidden), 'N で閉じる');
  await page.evaluate(() => { window.__g.player.teleport(-170, 150); });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { window.__g.player.teleport(-190.5, 164.1); });
  await waitState(page, 'ask');
  ok(true, '出て入り直すと、また聞く');
  await page.keyboard.press('KeyY');
  await waitState(page, 'select');
  ok(await page.evaluate(() => !document.getElementById('ar-root').hidden && !document.getElementById('ar-select').hidden), 'Y で曲えらびの画面 (全面) が出る');
  const p0 = await page.evaluate(() => { const p = window.__g.player.pos; return [p.x, p.z]; });
  await page.keyboard.down('KeyD'); await page.keyboard.down('KeyS'); await page.waitForTimeout(1500); await page.keyboard.up('KeyD'); await page.keyboard.up('KeyS');
  const p1 = await page.evaluate(() => { const p = window.__g.player.pos; return [p.x, p.z]; });
  ok(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 0.05, `ゲーム画面の間、S・D でキャラが歩かない (動いた距離 ${Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(3)} m)`);
  await page.waitForTimeout(500);
  await shot(page, '2_select');
  // 曲えらびの操作
  await page.click('[data-act="diff"][data-v="NORMAL"]');
  await page.click('[data-act="speed"][data-v="fast"]');
  await page.click('[data-act="off"][data-v="10"]');
  await page.click('[data-act="off"][data-v="10"]');
  await page.click('[data-act="sfx"]');
  await page.click('[data-act="sway"][data-v="big"]');
  ok(await page.evaluate(() => window.__arcade.cfg.sway) === 'big', 'レーンのうねりの設定ボタン (おおきく)');
  await page.click('[data-act="sway"][data-v="normal"]');
  let cfg = await page.evaluate(() => window.__arcade.cfg);
  ok(cfg.diff === 'NORMAL' && cfg.speed === 'fast' && cfg.offset === 20 && cfg.sfx === false, `設定ボタン: ${JSON.stringify({ diff: cfg.diff, speed: cfg.speed, offset: cfg.offset, sfx: cfg.sfx })}`);
  await page.keyboard.press('ArrowRight');
  ok(await page.evaluate(() => window.__arcade.cfg.diff) === 'HARD', '→ キーで HARD');
  await page.keyboard.press('ArrowLeft');
  await page.click('[data-act="sfx"]'); await page.click('[data-act="off"][data-v="-10"]'); await page.click('[data-act="off"][data-v="-10"]'); await page.click('[data-act="speed"][data-v="normal"]');
  // 曲えらび: 一覧・切り替え (譜面と音を読み直す)
  const songs = await page.evaluate(() => window.__arcade.songs.map(s => s.id));
  ok(songs.length >= 5 && songs[0] === 'pipipi' && songs.includes('pop1'), `曲の一覧: ${songs.join(', ')}`);
  ok(await page.evaluate(() => document.querySelectorAll('#ar-songs .ar-chip').length) === songs.length && await page.evaluate(() => window.__arcade.song.id) === 'pipipi', '最初の曲は 1 曲目 (歌入り)');
  await page.click('[data-act="song"][data-v="miraimirai"]');
  await page.waitForFunction(() => window.__arcade.chart && window.__arcade.chart.id === 'miraimirai' && !window.__arcade.picking);
  ok(await page.evaluate(() => !!window.__arcade.buf && !document.querySelector('[data-act="start"]').disabled && window.__arcade.chart.difficulties.HARD.stats.notes > 300),
     '曲を切り替えると、その曲の譜面と音が読み込まれる (ミライミライ)');
  ok((await page.evaluate(() => document.getElementById('ar-credit').textContent)).includes('NeWorld'), 'クレジットが曲えらびに出る');
  await shot(page, '2b_select_song');
  await page.click('[data-act="song"][data-v="pipipi"]');
  await page.waitForFunction(() => window.__arcade.chart && window.__arcade.chart.id === 'pipipi' && !window.__arcade.picking);
  // スタート
  await page.click('[data-act="start"]');
  await waitState(page, 'play');
  ok(await page.evaluate(() => window.__arcade.game.total) > 100, 'スタートで始まる (NORMAL の譜面)');
  await page.waitForFunction(() => window.__arcade.chartT(window.__arcade.now()) > 0.5);
  ok(await page.evaluate(() => window.__arcade.useAudio), `曲の音が鳴っている (autoplay 許可の環境)`);
  // 本物のキーを 1 回 (ノーツの無い所で押す = stray)
  await page.keyboard.down('KeyF'); await page.waitForTimeout(60);
  ok(await page.evaluate(() => window.__arcade.held[2] === true && window.__arcade.heldN[2] === 1), '本物のキー (F) を押している間、3 番目のレーンが押された扱いになる');
  await page.keyboard.up('KeyF'); await page.waitForTimeout(60);
  ok(await page.evaluate(() => window.__arcade.held[2] === false), '離すと戻る');
  // 疑似キーで、最初の 12 ノーツを譜面の時刻ぴったりに打つ
  const res = await page.evaluate(async () => {
    const A = window.__arcade, g = A.game;
    const keys = ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'];
    const first = g.notes.filter(n => n.type !== 'hold').slice(0, 12);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (const n of first) {
      const wait = (n.t - A.chartT(A.now())) * 1000;
      if (wait > 30) await sleep(wait - 15);
      while (A.chartT(A.now()) < n.t - 0.005) await new Promise(r => setTimeout(r, 1));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: keys[n.lane], bubbles: true }));
      await sleep(30);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: keys[n.lane], bubbles: true }));
    }
    await sleep(400);
    return { counts: { ...g.counts }, combo: g.combo, maxCombo: g.maxCombo, stray: g.stray, fast: g.fast, late: g.late };
  });
  const good = res.counts.perfect + res.counts.great;
  ok(good >= 10, `疑似キーで 12 ノーツを打つ: ${JSON.stringify(res.counts)} 最大コンボ ${res.maxCombo}`);
  // レーンのうねり: 判定線の位置は動かず、タップの判定 (レーンの当たり) もそのまま
  { const r = await page.evaluate(() => { const S = window.__arcade.stage; const out = { sw: S.swA, c0: Math.abs(S.cxAt(0) - S.L.cx), lanes: [], far: Math.abs(S.cxAt(1) - S.L.cx) };
      for (let i = 0; i < 6; i++) out.lanes.push(Math.abs(S.px(i, 0) - (S.L.cx + (i - 2.5) * S.L.wJ / 6)) < 1e-6 && S.laneAt(S.px(i, 0)) === i);
      return out; });
    ok(r.sw > 0 && r.c0 < 1e-9 && r.lanes.every(Boolean), `うねりの最中も、判定線は動かない (振れ幅 ${r.sw.toFixed(1)} px、判定線のずれ ${r.c0}、レーンの当たり ${r.lanes.every(Boolean)})`);
    ok(r.far > 0.5, `奥では実際に振れている (${r.far.toFixed(1)} px)`); }
  await shot(page, '3_play');
  // Esc で曲えらびへ
  await page.keyboard.press('Escape');
  await waitState(page, 'select');
  ok(await page.evaluate(() => window.__arcade.game === null), 'Esc で曲えらびに戻る (曲は止まる)');
  // 自動で最後まで (10% は打たない)。最後まで通すのは、短いほうの自作曲 (pop1。約 83 秒)
  await page.click('[data-act="song"][data-v="pop1"]');
  await page.waitForFunction(() => window.__arcade.chart && window.__arcade.chart.id === undefined && !window.__arcade.picking && window.__arcade.song.id === 'pop1');
  await page.evaluate(() => { const A = window.__arcade; A.autoPlay = true; A.botSkip = 0.1; A.cfg.diff = 'HARD'; });
  await page.click('[data-act="diff"][data-v="HARD"]');
  await page.click('[data-act="start"]');
  await waitState(page, 'play');
  await page.waitForFunction(() => window.__arcade.chartT(window.__arcade.now()) > 27, null, { timeout: 120000 });
  await shot(page, '4_chorus');
  await page.waitForFunction(() => window.__arcade.chartT(window.__arcade.now()) > 69, null, { timeout: 120000 });
  await shot(page, '5_big');
  await waitState(page, 'result', 120000);
  const sum = await page.evaluate(() => ({ ...window.__arcade.last, diff: window.__arcade.diff }));
  ok(sum.total === 352 && sum.counts.miss > 15 && sum.counts.miss < 60, `最後まで自動で通した (HARD): ${JSON.stringify({ score: sum.score, rank: sum.rank, miss: sum.counts.miss, maxCombo: sum.maxCombo })}`);
  await page.waitForTimeout(1200);
  await shot(page, '6_result');
  ok(await page.evaluate(() => !document.getElementById('ar-result').hidden), '結果の画面が出る');
  await page.click('[data-act="select"]');
  await waitState(page, 'select');
  await page.click('[data-act="exit"]');
  await waitState(page, 'idle');
  ok(await page.evaluate(() => document.getElementById('ar-root').hidden && !document.body.classList.contains('ar-on')), 'おしまいで、街に戻る');
  await page.close();
  }

  // ===== 4: スマホ (タッチ) =====
  const mob = await open('?shot&arcade=ask&x=-190.5&z=164.1&face=-1.5708&touch', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await waitState(mob, 'ask');
  await shot(mob, '7_ask_touch');
  await mob.touchscreen.tap(...(await mob.evaluate(() => { const r = document.getElementById('ar-yes').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })));
  await waitState(mob, 'select');
  await mob.waitForTimeout(600);
  await shot(mob, '8_select_touch');
  { const r = await mob.evaluate(() => { const b = document.getElementById('ar-select').getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: innerWidth, h: innerHeight }; });
    ok(r.l >= 0 && r.r <= r.w && r.t >= 0 && r.b <= r.h + 1, `スマホ横向き: 曲えらびのカードが画面に収まる ${JSON.stringify(r)}`); }
  { const r = await mob.evaluate(() => { const c = document.getElementById('ar-select'), b = document.querySelector('[data-act="start"]').getBoundingClientRect(); return { scroll: c.scrollHeight - c.clientHeight, startBottom: b.bottom, h: innerHeight }; });
    ok(r.scroll <= 1 && r.startBottom <= r.h, `スマホ横向き: 曲えらびの中身が全部見える (はみ出し ${r.scroll}px、スタートの下端 ${Math.round(r.startBottom)} / 画面 ${r.h})`); }
  await mob.evaluate(() => window.__arcade.cfg.diff = 'HARD');
  await mob.touchscreen.tap(...(await mob.evaluate(() => { const r = document.querySelector('[data-act="start"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })));
  await waitState(mob, 'play');
  const lanes = await mob.evaluate(() => { const S = window.__arcade.stage; return { x: [0, 1, 2, 3, 4, 5].map(i => S.px(i, 0)), y: S.L.yJ }; });
  // タップ・長押し・フリックを、実際のタッチ入力 (CDP) で
  const cdp = await mob.context().newCDPSession(mob);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const T = await mob.evaluate(() => {
    const g = window.__arcade.game;
    const tap = g.notes.find(n => n.type === 'tap'), flick = g.notes.find(n => n.type === 'flick'), hold = g.notes.find(n => n.type === 'hold');
    return { tap: [tap.t, tap.lane], flick: flick && [flick.t, flick.lane], hold: hold && [hold.t, hold.lane, hold.end] };
  });
  const waitChart = (t) => mob.waitForFunction((t) => window.__arcade.chartT(window.__arcade.now()) >= t, t, { polling: 'raf', timeout: 120000 });
  await waitChart(T.tap[0] - 0.02);
  await touch('touchStart', [{ x: lanes.x[T.tap[1]], y: lanes.y, id: 1 }]); await touch('touchEnd', []);
  await mob.waitForTimeout(150);
  const afterTap = await mob.evaluate(() => ({ ...window.__arcade.game.counts }));
  ok(afterTap.perfect + afterTap.great + afterTap.good >= 1, `タッチ: タップが判定される ${JSON.stringify(afterTap)}`);
  if (T.hold) {
    await waitChart(T.hold[0] - 0.02);
    await touch('touchStart', [{ x: lanes.x[T.hold[1]], y: lanes.y, id: 2 }]);
    await waitChart(T.hold[2] + 0.02);
    await touch('touchEnd', []);
    await mob.waitForTimeout(200);
    const h = await mob.evaluate((i) => window.__arcade.game.notes.find(n => n.type === 'hold').grade, 0);
    ok(h && h !== 'miss', `タッチ: 長押し (押し続けて離す) → ${h}`);
  }
  if (T.flick) {
    await waitChart(T.flick[0] - 0.03);
    await touch('touchStart', [{ x: lanes.x[T.flick[1]], y: lanes.y, id: 3 }]);
    await mob.waitForTimeout(40);
    await touch('touchMove', [{ x: lanes.x[T.flick[1]], y: lanes.y - 12, id: 3 }]);
    await touch('touchMove', [{ x: lanes.x[T.flick[1]], y: lanes.y - 40, id: 3 }]);
    await touch('touchEnd', []);
    await mob.waitForTimeout(200);
    const f = await mob.evaluate(() => window.__arcade.game.notes.find(n => n.type === 'flick').grade);
    ok(f === 'perfect' || f === 'great', `タッチ: 上へはじくフリック → ${f}`);
  }
  await shot(mob, '9_play_touch');
  await mob.close();

  await browser.close(); server.close();
  console.log(fails ? `\n失敗 ${fails} 件` : '\n全部 OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
