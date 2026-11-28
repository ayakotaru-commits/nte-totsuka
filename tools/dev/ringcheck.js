// 足元の光の輪 (src/spotring.js) の確認: イベントの区域・洋服屋の入口・電車の改札に輪があり、中に立つと強く光る。区域の中央で画面を撮る: 入口にとどまると「入りますか？」が出る・断ると離れるまで出ない・
// はい → 店の一覧 → 服を買う (お金が足りないと買えない) → 着る、保存。入口の足元の高さも表示する。
// 使い方: node tools/dev/ringcheck.js <出力フォルダ>   (準備は wardrobecheck.js と同じ。数分)
const { chromium } = require('playwright');
const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), PUBLIC = path.join(ROOT, 'public'), CACHE = path.join(__dirname, '.cache');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.vrm': 'model/gltf-binary' };
let bad = 0;
const ok = (c, m) => { console.log((c ? 'OK  ' : 'NG  ') + m); if (!c) bad++; };

(async () => {
  const [out] = process.argv.slice(2);
  if (!out) { console.error('usage: node tools/dev/ringcheck.js <出力フォルダ>'); process.exit(1); }
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
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.setDefaultTimeout(240000);
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r => r.fulfill({ path: path.join(CACHE, 'package', r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
  await page.route('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.3.3/**', r => r.fulfill({ path: path.join(CACHE, 'vrm', 'package', r.request().url().replace('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.3.3/', '')), contentType: 'application/javascript' }));
  await page.route('**/src/main.js', async r => {
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, wardrobe, get menu() { return menu; }, get shops() { return shops; } };\n  const qs = new URLSearchParams');
    r.fulfill({ body: t, contentType: 'application/javascript' });
  });
  page.on('pageerror', e => { console.log('ERR', e.message); bad++; });
  page.on('console', m => { if (/rror|失敗/.test(m.text())) console.log('LOG', m.text()); });
  await page.goto(base + '/?shot&arcade=ask&resetsave', { timeout: 240000 });
  await page.waitForFunction(() => window.__g, null, { timeout: 240000 });
  await page.addStyleTag({ content: '#help{display:none!important}' });
  const frames = (n) => page.evaluate((n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const st = () => page.evaluate(() => ({ open: __g.menu.open, screen: __g.menu.screen, money: __g.wardrobe.money, owned: [...__g.wardrobe.owned], y: +__g.player.pos.y.toFixed(2) }));
  // y を渡すと、その高さに立たせる (2 階のデッキ。teleport は地面に置くので、足元をデッキの高さに上げる)
  const goto = async (x, z, y) => { await page.evaluate(([x, z, y]) => { __g.player.teleport(x, z); if (y > 1) { __g.player.pos.y = y; __g.player.vy = 0; } __g.cam.update(0, __g.player.pos, true); }, [x, z, y ?? null]); };
  const waitAsk = async () => { for (let i = 0; i < 14; i++) { await frames(2); if ((await st()).open) return true; } return false; };
  const places = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'shops.json'), 'utf8')).places;
  const ent = {}; for (const p of places) p.entrances.forEach((e, i) => { ent[p.id + i] = e; });

  const info = () => page.evaluate(() => __spotRings.items.map((h, i) => ({ i, n: h.pts.length, visible: h.mesh.visible, op: +h.m.opacity.toFixed(2), inside: h.inside, dist: Math.round(h.dist), col: '#' + h.m.color.getHexString(), cx: h.poly.reduce((a, q) => a + q[0], 0) / h.poly.length, cz: h.poly.reduce((a, q) => a + q[1], 0) / h.poly.length, lv: h.level ?? null })));
  const list = await info();
  console.log('輪', list.length, '個:', list.map((h) => h.col).join(' '));
  ok(list.length === 6, '輪の数 (ゲームセンター・改札・洋服屋の入口 4 = 6。?shot ではうな○ー・リズムは止めてあるので出ない)');
  let k = 0;
  for (const h of list) {
    k++;
    await goto(0, 40); await frames(3);
    await goto(h.cx, h.cz, h.lv); await frames(6);
    const r = (await info())[h.i];
    ok(r.op >= 0.85, `輪 ${k} (${h.col}) の中に立つと強く光る (不透明度 ${r.op})`);
    await page.keyboard.press('Escape'); await frames(2);
    await page.screenshot({ path: path.join(out, `ring_${k}.png`) });
  }
  await goto(0, 40); await frames(3);
  const far = await info();
  ok(far.every((h) => !h.inside), '遠くでは中にいない');
  await browser.close(); server.close();
  console.log(bad ? `NG ${bad} 件` : '全部 OK');
  process.exit(bad ? 1 : 0);
})();
