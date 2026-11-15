// 歩道橋・デッキ・階段を「歩いて通れるか」を、ゲームの当たり判定で調べる (描画はしない)。
// 歩行者用の橋・坂・階段の中心線を 0.25 m ごとにたどり、次を数える:
//   段差: 隣の点との足元の高さの差が、乗り越えられる段差 (0.4 m) を超える所
//   ふさがり: 体が小物の当たり判定 (手すりなど) や建物に重なる所
// 使い方: node tools/dev/walkcheck.js   (準備は shot.js と同じ)
const { chromium } = require('playwright');
const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), PUBLIC = path.join(ROOT, 'public'), THREE_DIR = path.join(__dirname, '.cache', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  page.setDefaultTimeout(300000);
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r => r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
  await page.route('https://cdn.jsdelivr.net/npm/@pixiv/**', r => r.abort());
  await page.route('**/src/main.js', async r => {
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, input, scene };\n  const qs = new URLSearchParams');
    r.fulfill({ body: t, contentType: 'application/javascript' });
  });
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?shot&noshadow&noaa&pr=0.3&nofollow`);
  await page.waitForFunction(() => window.__g);
  await page.waitForTimeout(8000); // 小物の当たり判定 (props.json) が入るまで
  const out = await page.evaluate(async () => {
    const W = window.__g.player.world;
    const city = await (await fetch('data/city.json')).json();
    const PED = new Set(['footway', 'pedestrian', 'path', 'cycleway', 'steps', 'corridor']);
    const res = [];
    for (const r of city.roads) {
      if (!PED.has(r.kind) || !(r.ys || r.kind === 'steps')) continue;
      let gap = 0, blocked = 0, n = 0, len = 0, y = null, worst = 0;
      const bad = [];
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], L = Math.hypot(bx - ax, bz - az);
        len += L;
        const m = Math.max(1, Math.ceil(L / 0.25));
        for (let j = 0; j <= m; j++) {
          const x = ax + (bx - ax) * j / m, z = az + (bz - az) * j / m;
          const foot = r.ys ? r.ys[i] + (r.ys[i + 1] - r.ys[i]) * j / m + 0.1 : (y ?? 1e9);
          const g = W.groundAt(x, z, r.ys ? foot : (y === null ? 1e9 : y));
          if (y !== null && Math.abs(g - y) > 0.4) { gap++; worst = Math.max(worst, Math.abs(g - y)); if (bad.length < 2) bad.push([Math.round(x), Math.round(z), +(g - y).toFixed(1)]); }
          if (W.bodyBlocked(x, z, g)) { blocked++; if (bad.length < 2) bad.push([Math.round(x), Math.round(z), 'blocked']); }
          y = g; n++;
        }
      }
      res.push({ kind: r.kind, deck: !!r.ys, x: Math.round(r.pts[0][0]), z: Math.round(r.pts[0][1]), len: Math.round(len), n, gap, blocked, worst: +worst.toFixed(1), bad });
    }
    return res;
  });
  const sum = (f) => out.filter(f).length;
  console.log(`通路 ${out.length} 本 (デッキ・橋・坂 ${sum(o => o.deck)} / 地面の階段 ${sum(o => !o.deck)})`);
  console.log(`段差なし・ふさがりなし: ${sum(o => !o.gap && !o.blocked)} 本`);
  for (const o of out.filter(o => o.gap || o.blocked).sort((a, b) => b.blocked + b.gap - a.blocked - a.gap))
    console.log(`  ${o.kind}${o.deck ? '(デッキ)' : ''} 始点 (${o.x}, ${o.z}) 長さ ${o.len} m: 段差 ${o.gap} か所 (最大 ${o.worst} m)、ふさがり ${o.blocked}/${o.n} 点  例 ${JSON.stringify(o.bad)}`);
  await browser.close(); server.close();
})();
