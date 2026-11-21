// メニュー・着替え (src/menu.js, wardrobe.js, outfit.js) の確認: ゲーム本体を開き、Tab でメニュー → 着替え → 服を選ぶ、までを画面と値で確かめる。
// 使い方: node tools/dev/wardrobecheck.js <出力フォルダ>   (準備は charshot.js と同じ。three.js と three-vrm が tools/dev/.cache にあること。数分)
const { chromium } = require('playwright');
const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), PUBLIC = path.join(ROOT, 'public'), CACHE = path.join(__dirname, '.cache');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.vrm': 'model/gltf-binary' };
let bad = 0;
const ok = (c, m) => { console.log((c ? 'OK  ' : 'NG  ') + m); if (!c) bad++; };

(async () => {
  const [out] = process.argv.slice(2);
  if (!out) { console.error('usage: node tools/dev/wardrobecheck.js <出力フォルダ>'); process.exit(1); }
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
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, wardrobe, menu, tod };\n  const qs = new URLSearchParams');
    r.fulfill({ body: t, contentType: 'application/javascript' });
  });
  page.on('pageerror', e => { console.log('ERR', e.message); bad++; });
  page.on('console', m => { if (/rror|失敗|警告/.test(m.text())) console.log('LOG', m.text()); });
  await page.goto(base + '/?shot&money=5000&resetsave', { timeout: 240000 });
  await page.waitForFunction(() => window.__g, null, { timeout: 240000 });
  await page.addStyleTag({ content: '#help{display:none!important}' });
  const frames = (n) => page.evaluate((n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const outfitOn = () => page.evaluate(() => { const g = []; __g.player.model.root.traverse(o => { if (o.name === 'outfit' && o.visible) g.push(o); }); return g.length; });
  await frames(3);
  await page.screenshot({ path: path.join(out, 'a_default.png') });
  ok(await outfitOn() === 0, '最初はいつもの服 (服のパーツが出ていない)');

  await page.keyboard.press('Tab'); await frames(3);
  ok(await page.evaluate(() => __g.menu.open), 'Tab でメニューが開く');
  const t0 = await page.evaluate(() => document.getElementById('hud-time').textContent);
  await page.keyboard.press('KeyT'); await frames(3);
  ok(await page.evaluate((t0) => document.getElementById('hud-time').textContent === t0, t0), 'メニューの間は T (時間帯) が効かない');
  await page.screenshot({ path: path.join(out, 'b_menu.png') });
  await page.click('[data-do=wardrobe]'); await frames(6);
  await page.screenshot({ path: path.join(out, 'c_wardrobe.png') });
  ok(await page.evaluate(() => document.querySelectorAll('.mn-item[data-wear]').length) >= 2, '着替えの一覧が出る');

  // 持っていない服は着られない → 持っている服にして着る
  await page.click('[data-wear=nishi_dress]'); await frames(3);
  ok(await outfitOn() === 0, '持っていない服は着られない');
  ok((await page.textContent('.mn-msg')).includes('買えます'), 'どこで買えるか出る');
  await page.evaluate(() => { __g.wardrobe.owned.add('nishi_dress'); __g.wardrobe.owned.add('tanuki_yukata'); __g.wardrobe.owned.add('lyla_hoodie'); __g.menu.render(); });
  for (const id of ['nishi_dress', 'tanuki_yukata', 'lyla_hoodie']) {
    await page.click(`[data-wear=${id}]`);
    await page.waitForFunction(() => { let n = 0; __g.player.model.root.traverse(o => { if (o.name === 'outfit' && o.visible) n++; }); return n === 1; }, null, { timeout: 120000 });
    await frames(4);
    ok(await page.evaluate((id) => __g.wardrobe.equipped === id, id), id + ' を着た (着ている服 = ' + id + ')');
    await page.screenshot({ path: path.join(out, 'd_' + id + '.png') });
  }
  await page.click('[data-wear=default]'); await frames(3);
  ok(await outfitOn() === 0, 'いつもの服に戻る');
  await page.click('[data-wear=tanuki_yukata]'); await page.waitForFunction(() => { let n = 0; __g.player.model.root.traverse(o => { if (o.name === 'outfit' && o.visible) n++; }); return n === 1; });

  // 閉じる → 走りの姿勢で
  await page.keyboard.press('Escape'); await frames(2); // 着替え → メニュー
  await page.keyboard.press('Escape'); await frames(3); // 閉じる
  ok(await page.evaluate(() => !__g.menu.open), 'Esc で閉じる');
  await page.evaluate(() => { __g.player.poseSpeed = 5.5; });
  await frames(8);
  await page.screenshot({ path: path.join(out, 'e_run.png') });
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('totsuka.save.v1')));
  ok(s && s.equipped === 'tanuki_yukata' && s.owned.includes('nishi_dress'), '保存された (' + JSON.stringify(s) + ')');
  await browser.close(); server.close();
  console.log(bad ? `NG ${bad} 件` : '全部 OK');
  process.exit(bad ? 1 : 0);
})();
