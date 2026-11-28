// 洋服屋の試着 (menu.js の shop 画面) とキャラメイクのカメラの確認:
// 店で服を選ぶと着替わる (買っていない・お金が足りなくても) → 買えない → 店を出ると元の服 → 保存は変わらない。
// 各タブ・試着の画面を、PC 幅とスマホ縦で撮る。 使い方: node tools/dev/tryoncheck.js <出力フォルダ>   (準備は shopcheck.js と同じ。数分)
const { chromium } = require('playwright');
const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), PUBLIC = path.join(ROOT, 'public'), CACHE = path.join(__dirname, '.cache');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.vrm': 'model/gltf-binary' };
let bad = 0;
const ok = (c, m) => { console.log((c ? 'OK  ' : 'NG  ') + m); if (!c) bad++; };
(async () => {
  const [out] = process.argv.slice(2);
  if (!out) { console.error('usage: node tools/dev/tryoncheck.js <出力フォルダ>'); process.exit(1); }
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    const p = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const places = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'shops.json'), 'utf8')).places;
  const e0 = places.find(p => p.id === 'tokyu_plaza').entrances[0];
  for (const [tag, vp, touch] of [['pc', { width: 960, height: 540 }, false], ['phone', { width: 390, height: 844 }, true]].filter(([k]) => !process.argv.includes('--pc') || k === 'pc')) {
    const page = await browser.newPage({ viewport: vp, hasTouch: touch });
    page.setDefaultTimeout(240000);
    await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r => r.fulfill({ path: path.join(CACHE, 'package', r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
    await page.route('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.3.3/**', r => r.fulfill({ path: path.join(CACHE, 'vrm', 'package', r.request().url().replace('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.3.3/', '')), contentType: 'application/javascript' }));
    await page.route('**/src/main.js', async r => {
      const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, wardrobe, get menu() { return menu; } };\n  const qs = new URLSearchParams');
      r.fulfill({ body: t, contentType: 'application/javascript' });
    });
    page.on('pageerror', e => { console.log('ERR', e.message); bad++; });
    const frames = (n) => page.evaluate((n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
    const shot = async (n) => { await frames(6); await page.screenshot({ path: path.join(out, `${tag}_${n}.png`) }); };
    await page.goto(base + '/?shot&money=100&resetsave', { timeout: 240000 });
    await page.waitForFunction(() => window.__g, null, { timeout: 240000 });
    await page.addStyleTag({ content: '#help{display:none!important}' });
    await frames(3);
    await page.evaluate(() => { const m = __g.player.model, f = m.setOutfits; window.__last = null; m.setOutfits = (u) => { window.__last = u; return f(u); }; });
    // 洋服屋 (所持金 100 円: どの服も買えない)
    await page.evaluate(([x, z, y]) => { __g.player.teleport(x, z); if (y > 1) { __g.player.pos.y = y; __g.player.vy = 0; } __g.cam.update(0, __g.player.pos, true); }, [e0.x, e0.z, e0.y ?? null]);
    for (let i = 0; i < 14 && !(await page.evaluate(() => __g.menu.open)); i++) await frames(2);
    await page.keyboard.press('KeyY'); await frames(2);
    await page.click('[data-shop=チュチュアンナ]'); await frames(3);
    ok(await page.evaluate(() => __g.menu.screen) === 'shop', `[${tag}] 店の画面`);
    await shot('shop0_before');
    const ids = await page.evaluate(() => [...document.querySelectorAll('.mn-item[data-item]')].map(b => b.dataset.item));
    await page.click(`[data-item=${ids[0]}]`); await frames(4);
    const s1 = await page.evaluate(() => ({ t: __g.menu.tryId, last: window.__last, owned: [...__g.wardrobe.owned], money: __g.wardrobe.money, worn: { ...__g.wardrobe.worn }, buy: document.querySelector('.mn-buy')?.textContent }));
    ok(s1.t === ids[0] && Object.values(s1.last || {}).some(u => u && u.includes(ids[0].split(':').pop().slice(0, 4))) || (s1.last && Object.values(s1.last).some(Boolean)), `[${tag}] 試着: ${ids[0]} が着替わった ${JSON.stringify(s1.last)}`);
    ok(!s1.owned.includes(ids[0]) && s1.money === 100 && Object.values(s1.worn).every(v => !v), `[${tag}] 試着では買わない・保存の服は変わらない`);
    ok(/買えない/.test(s1.buy || ''), `[${tag}] お金が足りないと「買えない」: ${s1.buy}`);
    await shot('shop1_tryon');
    await page.click('[data-do=buy]'); await frames(3);
    ok(!(await page.evaluate((id) => __g.wardrobe.has(id), ids[0])), `[${tag}] 買えない服は買えない`);
    ok(/お金が足りません/.test(await page.evaluate(() => document.querySelector('.mn-msg').textContent)), `[${tag}] 「お金が足りません」が出る`);
    // 2 着目 (↑↓ でも試着)
    await page.keyboard.press('ArrowDown'); await frames(3);
    ok(await page.evaluate(() => __g.menu.tryId) !== ids[0] || ids.length === 1, `[${tag}] ↓ で次の服を試着`);
    // 店を出ると元の服 (保存の服 = 何も着ていない)
    await page.keyboard.press('Escape'); await frames(3);
    const s2 = await page.evaluate(() => ({ t: __g.menu.tryId, last: window.__last }));
    ok(s2.t === null && Object.values(s2.last || {}).every(v => !v), `[${tag}] 店を出ると元の服へ ${JSON.stringify(s2.last)}`);
    await page.keyboard.press('Escape'); await frames(3);
    await page.evaluate(() => { __g.wardrobe.money = 99999; });
    // キャラメイク: 各タブ
    await page.keyboard.press('Tab'); await frames(3);
    await page.click('[data-do=charmake]'); await frames(4);
    const only = (process.argv.find(a => a.startsWith('--tabs=')) || '').slice(7).split(',').filter(Boolean);
    for (const t of only.length ? only : ['body', 'style', 'color', 'eye', 'skin', 'face', 'height']) { await page.click(`[data-cmtab=${t}]`); await frames(only.length ? 40 : 5); await shot('cm_' + t); } // 寄せるカメラは動いて近づくので、前のタブから動く途中の絵になることがある (--tabs= で、順に開いて待つ)
    await page.close();
  }
  await browser.close(); server.close();
  console.log(bad ? `NG ${bad} 件` : '全部 OK');
  process.exit(bad ? 1 : 0);
})();
