// 描画が遅くても、キャラの速さが実時間で変わらないことの確認。
// ヘッドレスブラウザでゲームを開き、前進を押し続けたときの「進んだ距離 ÷ 実際の時間」と描画の fps を出す。
// この環境の描画は 1 fps 前後と遅すぎる (1 コマの上限 0.25 秒を超える) ので、走り 5.5 m/s・ダッシュ 10 m/s にはならない。
// --old と比べて、同じ fps で約 7.5 倍 (0.25 秒 ÷ 1/30 秒) 進んでいればよい。
// 使い方: node tools/dev/speedcheck.js [--old]   (--old は以前の 1/30 秒で頭打ちの計算に戻して比べる。準備は shot.js と同じ)
const { chromium } = require('playwright');
const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), PUBLIC = path.join(ROOT, 'public'), THREE_DIR = path.join(__dirname, '.cache', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
(async () => {
  const old = process.argv.includes('--old');
  const server = http.createServer((req, res) => {
    const p = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  page.setDefaultTimeout(300000);
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r => r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
  await page.route('https://cdn.jsdelivr.net/npm/@pixiv/**', r => r.abort());
  await page.route('**/src/main.js', async r => {
    let t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, input, scene };\n  const qs = new URLSearchParams');
    if (old) t = t.replace('const dt = Math.min(clock.getDelta(), 0.25);', 'const dt = Math.min(clock.getDelta(), 1 / 30);');
    r.fulfill({ body: t, contentType: 'application/javascript' });
  });
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?shot&noshadow&noaa&pr=0.3&nofollow`);
  await page.waitForFunction(() => window.__g);
  await page.waitForTimeout(5000);
  await page.evaluate(() => { for (const o of window.__g.scene.children) if (o.isGroup || o.isMesh) o.visible = false; }); // 描画を軽くする (当たり判定と地面の高さは残る)
  for (const [label, dash, lag] of [['走り', false, 0], ['ダッシュ', true, 0]]) {
    const r = await page.evaluate(async ({ dash, lag }) => {
      const g = window.__g;
      const busy = () => { const t = performance.now(); while (performance.now() - t < lag); if (run && lag) requestAnimationFrame(busy); }; // 1 コマを lag ミリ秒ぶん遅くする
      g.player.teleport(-300, 1432); g.cam.yaw = 4.0 - 0.72; // スタート近くの道路を道なりに
      let frames = 0; const count = () => { frames++; if (run) requestAnimationFrame(count); }; let run = true; requestAnimationFrame(count); if (lag) requestAnimationFrame(busy);
      g.input.az = 1; g.input.setHeld('ShiftLeft', dash);
      await new Promise(r => setTimeout(r, 1500)); // 加速が終わるまで
      const x0 = g.player.pos.x, z0 = g.player.pos.z, t0 = performance.now(), f0 = frames;
      await new Promise(r => setTimeout(r, 4000));
      const sec = (performance.now() - t0) / 1000, d = Math.hypot(g.player.pos.x - x0, g.player.pos.z - z0);
      run = false; g.input.az = 0; g.input.setHeld('ShiftLeft', false);
      return { d, sec, fps: (frames - f0) / sec, vel: g.player.vel.length() };
    }, { dash, lag });
    console.log(`${old ? '[以前の計算] ' : ''}${label}: ${r.d.toFixed(1)} m を ${r.sec.toFixed(1)} 秒 = ${(r.d / r.sec).toFixed(2)} m/s  (描画 ${r.fps.toFixed(1)} fps、ゲーム内の速さ ${r.vel.toFixed(1)} m/s)`);
    await page.waitForTimeout(1500);
  }
  await browser.close(); server.close();
})();
