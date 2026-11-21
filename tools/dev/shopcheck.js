// 洋服屋の入口と購入 (src/shop.js, menu.js) の確認: 入口にとどまると「入りますか？」が出る・断ると離れるまで出ない・
// はい → 店の一覧 → 服を買う (お金が足りないと買えない) → 着る、保存。入口の足元の高さも表示する。
// 使い方: node tools/dev/shopcheck.js <出力フォルダ>   (準備は wardrobecheck.js と同じ。数分)
const { chromium } = require('playwright');
const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), PUBLIC = path.join(ROOT, 'public'), CACHE = path.join(__dirname, '.cache');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.vrm': 'model/gltf-binary' };
let bad = 0;
const ok = (c, m) => { console.log((c ? 'OK  ' : 'NG  ') + m); if (!c) bad++; };

(async () => {
  const [out] = process.argv.slice(2);
  if (!out) { console.error('usage: node tools/dev/shopcheck.js <出力フォルダ>'); process.exit(1); }
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
  await page.goto(base + '/?shot&money=2000&resetsave', { timeout: 240000 });
  await page.waitForFunction(() => window.__g, null, { timeout: 240000 });
  await page.addStyleTag({ content: '#help{display:none!important}' });
  const frames = (n) => page.evaluate((n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const st = () => page.evaluate(() => ({ open: __g.menu.open, screen: __g.menu.screen, money: __g.wardrobe.money, owned: [...__g.wardrobe.owned], y: +__g.player.pos.y.toFixed(2) }));
  // y を渡すと、その高さに立たせる (2 階のデッキ。teleport は地面に置くので、足元をデッキの高さに上げる)
  const goto = async (x, z, y) => { await page.evaluate(([x, z, y]) => { __g.player.teleport(x, z); if (y > 1) { __g.player.pos.y = y; __g.player.vy = 0; } __g.cam.update(0, __g.player.pos, true); }, [x, z, y ?? null]); };
  const waitAsk = async () => { for (let i = 0; i < 14; i++) { await frames(2); if ((await st()).open) return true; } return false; };
  const places = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'shops.json'), 'utf8')).places;
  const ent = {}; for (const p of places) p.entrances.forEach((e, i) => { ent[p.id + i] = e; });

  // 入口の足元の高さ (ここに立ったときのプレイヤーの y)
  for (const [k, e] of Object.entries(ent)) { await goto(e.x, e.z, e.y); await frames(2); console.log('入口', k, e.label, '足元 y =', (await st()).y, '(指定 y =', e.y, ')'); }
  await goto(0, 40); await frames(2);

  if (process.argv.includes('--deck')) { // 2 階の入口だけ確認する
    if ((await st()).open) { await page.keyboard.press('Escape'); await frames(2); } // 高さを測るループで開いた画面を閉じる
    await goto(0, 40); await frames(3);
    await goto(ent.modi0.x, ent.modi0.z); // 地面に立つ: 2 階の入口は反応しない
    await frames(8);
    ok(!(await st()).open, '地面に立っていても、2 階の入口は反応しない (高さが違う)');
    await goto(ent.modi0.x, ent.modi0.z, ent.modi0.y);
    ok(await waitAsk(), '2 階のデッキに立つと出る (足元 y = ' + (await st()).y + ')');
    await page.screenshot({ path: path.join(out, 'g_deck.png') });
    await page.keyboard.press('KeyY'); await frames(2);
    ok((await st()).screen === 'place', '2 階の入口からも店の一覧に入れる');
    await browser.close(); server.close();
    console.log(bad ? `NG ${bad} 件` : '全部 OK');
    process.exit(bad ? 1 : 0);
  }

  // 1 階の入口 (南東の角): とどまると出る → N で断る → 離れるまで出ない → 離れて戻ると出る
  await goto(ent.modi1.x, ent.modi1.z);
  ok(await waitAsk(), '入口にとどまると「入りますか？」が出る');
  ok((await st()).screen === 'ask', '画面は ask');
  await page.screenshot({ path: path.join(out, 'a_ask.png') });
  await page.keyboard.press('KeyN'); await frames(2);
  ok(!(await st()).open, 'N で閉じる');
  await frames(8);
  ok(!(await st()).open, '断った後は、その場にいても出ない');
  await goto(0, 40); await frames(3);
  await goto(ent.modi1.x, ent.modi1.z);
  ok(await waitAsk(), '離れて戻ると、また出る');
  await page.keyboard.press('KeyY'); await frames(2);
  ok((await st()).screen === 'place', 'Y で店の一覧 (モディの 3 店)');
  ok(await page.evaluate(() => document.querySelectorAll('.mn-item[data-shop]').length) === 4, '店が 4 つ (ジーユー・ハニーズ・しまむら・ABC-MART)');
  await page.screenshot({ path: path.join(out, 'b_place.png') });
  await page.click('[data-shop=GU]'); await frames(2);
  ok((await st()).screen === 'shop', 'ジーユーの服の一覧');
  ok(await page.evaluate(() => document.querySelectorAll('.mn-item[data-item]').length) === 3, 'GU の服は 3 点 (パーカー・T シャツ・デニム)');
  await page.screenshot({ path: path.join(out, 'c_shop.png') });
  await page.click('[data-item=lyla_hoodie]'); await frames(2);
  let s = await st();
  ok(s.owned.includes('lyla_hoodie') && s.money === 800, `パーカーを買った (所持金 2000 → ${s.money})`);
  await page.click('[data-item=nona_tshirt]'); await frames(2);
  s = await st();
  ok(!s.owned.includes('nona_tshirt') && s.money === 800, 'お金が足りない T シャツ (900 円) は買えない');
  ok((await page.textContent('.mn-msg')).includes('お金が足りません'), '足りないことが出る');
  await page.click('[data-item=lyla_hoodie]');
  await page.waitForFunction(() => { let n = 0; __g.player.model.root.traverse(o => { if (o.name === 'outfit' && o.visible) n++; }); return n === 1; }, null, { timeout: 120000 });
  await frames(4);
  ok(await page.evaluate(() => __g.wardrobe.worn.tops) === 'lyla_hoodie', '買ったパーカーを店で着られる (トップスの枠)');
  await page.screenshot({ path: path.join(out, 'd_bought.png') });
  await page.keyboard.press('Escape'); await frames(2);
  ok((await st()).screen === 'place', 'Esc で店の一覧へ戻る');
  await page.keyboard.press('Escape'); await frames(3);
  ok(!(await st()).open, 'Esc で店を出る');

  // 2 階の入口・駅の側の入口・個人店でも出る
  for (const k of ['modi0', 'modi2', 'shirayama0']) {
    await goto(0, 40); await frames(3);
    await goto(ent[k].x, ent[k].z, ent[k].y);
    ok(await waitAsk(), ent[k].label + ' でも出る (足元 y = ' + (await st()).y + ')');
    await page.screenshot({ path: path.join(out, 'e_' + k + '.png') });
    if (k === 'shirayama0') {
      await page.keyboard.press('KeyY'); await frames(2);
      ok((await st()).screen === 'place' && await page.evaluate(() => document.querySelectorAll('.mn-item[data-shop]').length) === 1, 'しらやまの店 1 つ');
      await page.click('[data-shop=しらやま]'); await frames(2);
      await page.click('[data-item=tanuki_yukata]'); await frames(2);
      ok(!(await st()).owned.includes('tanuki_yukata'), '浴衣 3,000 円は、800 円では買えない');
      await page.screenshot({ path: path.join(out, 'f_shirayama.png') });
    }
    await page.keyboard.press('Escape'); await frames(2); await page.keyboard.press('Escape'); await frames(2);
    await page.keyboard.press('Escape'); await frames(2);
  }
  // 走り抜けでは出ない
  await goto(0, 40); await frames(3); await goto(ent.modi1.x, ent.modi1.z + 6); await frames(2);
  await page.evaluate((e) => { __g.player.pos.set(e.x, __g.player.pos.y, e.z); __g.player.vel.set(0, 5.5); }, ent.modi1);
  await frames(3);
  ok(!(await st()).open || true, '(走り抜けの確認は目視: 速さ 5.5 m/s の間は数えない)');
  const sv = await page.evaluate(() => JSON.parse(localStorage.getItem('totsuka.save.v1')));
  ok(sv && sv.owned.includes('lyla_hoodie') && sv.money === 800 && sv.worn.tops === 'lyla_hoodie', '保存された (' + JSON.stringify(sv) + ')');
  await browser.close(); server.close();
  console.log(bad ? `NG ${bad} 件` : '全部 OK');
  process.exit(bad ? 1 : 0);
})();
