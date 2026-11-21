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
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, wardrobe, get menu() { return menu; }, tod };\n  const qs = new URLSearchParams');
    r.fulfill({ body: t, contentType: 'application/javascript' });
  });
  page.on('pageerror', e => { console.log('ERR', e.message); bad++; });
  page.on('console', m => { if (/rror|失敗|警告/.test(m.text())) console.log('LOG', m.text()); });
  await page.goto(base + '/?shot&money=5000&resetsave', { timeout: 240000 });
  await page.waitForFunction(() => window.__g, null, { timeout: 240000 });
  await page.addStyleTag({ content: '#help{display:none!important}' });
  const frames = (n) => page.evaluate((n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const outfitOn = () => page.evaluate(() => { const g = []; __g.player.model.root.traverse(o => { if (o.name === 'outfit' && o.visible) g.push(o); }); return g.length; });
  const groups = () => page.evaluate(() => { let n = 0; __g.player.model.root.traverse(o => { if (o.name === 'outfit' && o.visible) n++; }); return n; });
  const waitGroups = (n) => page.waitForFunction((n) => { let k = 0; __g.player.model.root.traverse(o => { if (o.name === 'outfit' && o.visible) k++; }); return k === n; }, n, { timeout: 120000 });
  const worn = () => page.evaluate(() => JSON.stringify(__g.wardrobe.worn));
  const ownVisible = () => page.evaluate(() => { const r = {}; __g.player.model.root.traverse(o => { if (!o.isMesh) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) for (const k of ['Tops', 'Bottoms', 'Shoes']) if (m.name.includes('F00_') && m.name.includes(k)) r[k] = m.visible; }); return r; });
  await frames(3);
  await page.screenshot({ path: path.join(out, 'a_default.png') });
  ok(await groups() === 0, '最初はいつもの服 (服のパーツが出ていない)');

  await page.keyboard.press('Tab'); await frames(3);
  ok(await page.evaluate(() => __g.menu.open), 'Tab でメニューが開く');
  const t0 = await page.evaluate(() => document.getElementById('hud-time').textContent);
  await page.keyboard.press('KeyT'); await frames(3);
  ok(await page.evaluate((t0) => document.getElementById('hud-time').textContent === t0, t0), 'メニューの間は T (時間帯) が効かない');
  await page.click('[data-do=wardrobe]'); await frames(4);
  ok(await page.evaluate(() => document.querySelectorAll('.mn-tab').length) === 4, '枠のタブが 4 つ (トップス・ボトムス・くつ・ワンピース)');
  ok(await page.evaluate(() => document.querySelectorAll('.mn-item[data-wear]').length) === 1, '買っていないあいだは「いつもの」だけが並ぶ');
  ok((await page.textContent('.mn-msg')).includes('洋服屋'), '買った服はここに並ぶ、の案内が出る');
  await page.screenshot({ path: path.join(out, 'b_wardrobe.png') });

  // 持っている服にして、枠ごとに着る
  await page.evaluate(() => { for (const id of ['lyla_hoodie', 'nona_shorts', 'nishi_shoes', 'tanuki_yukata', 'nona_tshirt']) __g.wardrobe.owned.add(id); __g.menu.render(); });
  const rows = () => page.evaluate(() => [...document.querySelectorAll('.mn-item[data-wear]')].map(b => b.dataset.wear).join());
  ok(await rows() === 'none:tops,lyla_hoodie,nona_tshirt', 'トップスの枠: いつもの・パーカー・T シャツ (ほかの枠の服は出ない)');
  await page.click('[data-wear=lyla_hoodie]'); await waitGroups(1); await frames(3);
  ok((await worn()).includes('"tops":"lyla_hoodie"'), 'トップス: パーカーを着た');
  let ov = await ownVisible();
  ok(ov.Tops === false && ov.Bottoms === true && ov.Shoes === true, 'いつものトップスだけが隠れる (ボトムス・くつは そのまま) ' + JSON.stringify(ov));
  await page.click('[data-slot=bottoms]'); await frames(2);
  ok(await rows() === 'none:bottoms,nona_shorts', 'ボトムスの枠: いつもの・デニム');
  await page.click('[data-wear=nona_shorts]'); await waitGroups(2); await frames(2);
  await page.click('[data-slot=shoes]'); await frames(2);
  await page.click('[data-wear=nishi_shoes]'); await waitGroups(3); await frames(3);
  ov = await ownVisible();
  ok(ov.Tops === false && ov.Bottoms === false && ov.Shoes === false, '3 つそろえると、いつもの服は全部隠れる');
  await page.screenshot({ path: path.join(out, 'c_mix.png') });
  await page.click('[data-slot=onepiece]'); await frames(2);
  ok(await rows() === 'none:onepiece,tanuki_yukata', 'ワンピースの枠: 着ない・浴衣');
  await page.click('[data-wear=tanuki_yukata]'); await waitGroups(2); await frames(3);
  ok((await worn()) === '{"tops":null,"bottoms":null,"shoes":"nishi_shoes","onepiece":"tanuki_yukata"}', 'ワンピースを着ると、トップスとボトムスが外れる (くつは そのまま)');
  ok(await groups() === 2, '出ているパーツは ワンピースとくつの 2 つ');
  await page.screenshot({ path: path.join(out, 'd_yukata.png') });
  await page.click('[data-slot=tops]'); await frames(2);
  await page.click('[data-wear=nona_tshirt]'); await waitGroups(2); await frames(2);
  ok((await worn()) === '{"tops":"nona_tshirt","bottoms":null,"shoes":"nishi_shoes","onepiece":null}', 'トップスを着ると、ワンピースが外れる');
  await page.click('[data-slot=shoes]'); await frames(2);
  await page.click('[data-wear="none:shoes"]'); await waitGroups(1); await frames(2);
  ov = await ownVisible();
  ok((await worn()).includes('"shoes":null') && ov.Shoes === true, 'くつを「いつもの」に戻すと、いつものくつが出る');

  // 閉じる → 走りの姿勢で
  await page.keyboard.press('Escape'); await frames(2);
  await page.keyboard.press('Escape'); await frames(3);
  ok(await page.evaluate(() => !__g.menu.open), 'Esc で閉じる');
  await page.evaluate(() => { __g.player.poseSpeed = 5.5; });
  await frames(8);
  await page.screenshot({ path: path.join(out, 'e_run.png') });
  const sv = await page.evaluate(() => JSON.parse(localStorage.getItem('totsuka.save.v1')));
  ok(sv && sv.v === 2 && sv.worn.tops === 'nona_tshirt' && sv.owned.includes('tanuki_yukata'), '保存された (v2: ' + JSON.stringify(sv.worn) + ')');

  // 以前の保存 (v1: セットの id) を読むと、パーツに置き換わる
  await page.evaluate(() => localStorage.setItem('totsuka.save.v1', JSON.stringify({ v: 1, money: 700, owned: ['lyla_hoodie'], equipped: 'lyla_hoodie' })));
  await page.goto(base + '/?shot', { timeout: 240000 });
  await page.waitForFunction(() => window.__g, null, { timeout: 240000 });
  const m = await page.evaluate(() => ({ money: __g.wardrobe.money, owned: [...__g.wardrobe.owned].sort().join(), worn: JSON.stringify(__g.wardrobe.worn) }));
  ok(m.money === 700 && m.owned === 'lyla_boots,lyla_hoodie,lyla_shorts', '以前の保存 (セット) が パーツ 3 点に置き換わる: ' + m.owned);
  ok(m.worn === '{"tops":"lyla_hoodie","bottoms":"lyla_shorts","shoes":"lyla_boots","onepiece":null}', '着ていたセットは、枠ごとに着ている: ' + m.worn);
  await waitGroups(3);
  ok(await groups() === 3, '開き直すと 3 つのパーツを着ている');
  await browser.close(); server.close();
  console.log(bad ? `NG ${bad} 件` : '全部 OK');
  process.exit(bad ? 1 : 0);
})();
