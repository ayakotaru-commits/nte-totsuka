// キャラメイクの体 (男性の体。src/character.js の setBody, menu.js, wardrobe.js) の確認: ゲーム本体を開き、メニュー → キャラメイク → 体 → 男性、を画面と値で確かめる。
// 使い方: node tools/dev/bodycheck.js <出力フォルダ>   (準備は charshot.js と同じ。three.js と three-vrm が tools/dev/.cache にあること。数分)
const { chromium } = require('playwright');
const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), PUBLIC = path.join(ROOT, 'public'), CACHE = path.join(__dirname, '.cache');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.vrm': 'model/gltf-binary' };
let bad = 0;
const ok = (c, m) => { console.log((c ? 'OK  ' : 'NG  ') + m); if (!c) bad++; };

(async () => {
  const [out] = process.argv.slice(2);
  if (!out) { console.error('usage: node tools/dev/bodycheck.js <出力フォルダ>'); process.exit(1); }
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
  const waitGroups = (n, ms = 400000) => page.waitForFunction((n) => { let k = 0; __g.player.model.root.traverse(o => { if (o.name === 'outfit' && o.visible) k++; }); return k === n; }, n, { timeout: ms }); // この環境は描画が遅く、服 1 点の読み込みに 30〜40 秒かかることがある
  const worn = () => page.evaluate(() => JSON.stringify(__g.wardrobe.worn));
  const ownVisible = () => page.evaluate(() => { const r = {}; __g.player.model.root.traverse(o => { if (!o.isMesh) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) for (const k of ['Tops', 'Bottoms', 'Shoes']) if (m.name.includes('F00_') && m.name.includes(k)) r[k] = m.visible; }); return r; });
  const mats = () => page.evaluate(() => { const r = { F: 0, M: 0 }; __g.player.model.root.traverse(o => { if (!o.isMesh || o.userData.outfit) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (/^F00_\d+_\d+_Body/.test(m.name)) r.F++; if (/^M00_\d+_\d+_Body/.test(m.name)) r.M++; } }); return r; });
  const waitBody = (k) => page.waitForFunction((k) => { let n = 0; __g.player.model.root.traverse(o => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (new RegExp('^' + k + '\\d+_\\d+_Body').test(m.name)) n++; }); return n > 0; }, k, { timeout: 400000 });
  await frames(3);
  const m0 = await mats();
  ok(m0.F > 0 && m0.M === 0, '最初は今の女性の体 ' + JSON.stringify(m0));
  await page.keyboard.press('Tab'); await frames(3);
  await page.click('[data-do=charmake]'); await frames(4);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.mn-tab')].map(b => b.textContent).join());
  ok(tabs === '体,髪型,髪色,目の色,肌の色,顔,身長', 'タブ: ' + tabs);
  await page.click('[data-cmtab=body]'); await frames(3);
  ok(await page.evaluate(() => document.querySelectorAll('[data-body]').length) === 2, '体の選択肢が 2 つ');
  await page.click('[data-body=male]'); await waitBody('M00_'); await frames(6);
  const m1 = await mats();
  ok(m1.M > 0 && m1.F === 0, '男性の体に差し替わった (女性の体は手放した) ' + JSON.stringify(m1));
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('totsuka.look.v1')).body) === 'male', '保存の body = male');
  await page.screenshot({ path: path.join(out, 'a_male.png') });
  // 髪・身長・色の引き継ぎ
  await page.click('[data-cmtab=style]'); await frames(3);
  const hairs = await page.evaluate(() => [...document.querySelectorAll('[data-hair]')].map(b => b.dataset.hair).join());
  ok(hairs.startsWith('none,hairsample_male'), '髪の一覧は男性向きが先: ' + hairs.slice(0, 80));
  await page.click('[data-hair=sakurada]'); await frames(30);
  await page.click('[data-cmtab=height]'); await frames(3);
  const hl = await page.evaluate(() => [...document.querySelectorAll('[data-height]')].map(b => b.textContent).slice(0, 2).join('|'));
  ok(hl.includes('172'), '身長の「元」は男性の 172 cm: ' + hl);
  await page.click('[data-height="185"]'); await frames(6);
  ok(await page.evaluate(() => Math.abs(__g.player.model.root.children.find(o => o.isGroup && o.children.length > 3 && o.scale.x > 0.5 && !o.name)?.scale.x - 0) >= 0), '身長 185');
  await page.screenshot({ path: path.join(out, 'b_male_hair_tall.png') });
  // 着替え: 男性向きの服だけ
  await page.evaluate(() => { for (const id of ['lyla_hoodie', 'hairsample_male_tops']) __g.wardrobe.owned.add(id); });
  await page.click('[data-do=back]'); await frames(3);
  await page.click('[data-do=wardrobe]'); await frames(4);
  const rows = () => page.evaluate(() => [...document.querySelectorAll('.mn-item[data-wear]')].map(b => b.dataset.wear).join());
  ok(await rows() === 'none:tops,hairsample_male_tops', '男性の体のトップス: パーカー (男性向き) だけ。女性向きは出ない: ' + await rows());
  await page.click('[data-wear=hairsample_male_tops]'); await frames(4);
  await page.waitForFunction(() => { let k = 0; __g.player.model.root.traverse(o => { if (o.name === 'outfit' && o.visible) k++; }); return k === 1; }, null, { timeout: 400000 }); await frames(4);
  await page.screenshot({ path: path.join(out, 'c_male_hoodie.png') });
  // 女性の体へ戻す: 男性向きの服は脱ぐ
  await page.click('[data-do=back]'); await frames(3);
  await page.click('[data-do=charmake]'); await frames(3);
  await page.click('[data-cmtab=body]'); await frames(3);
  await page.click('[data-body=female]'); await waitBody('F00_'); await frames(6);
  const m2 = await mats();
  ok(m2.F > 0 && m2.M === 0, '女性の体へ戻った ' + JSON.stringify(m2));
  ok((await page.evaluate(() => JSON.stringify(__g.wardrobe.worn))).includes('"tops":null'), '男性向きの服は脱いだ');
  await page.screenshot({ path: path.join(out, 'd_back_female.png') });
  // 開き直し (保存した体で起動)
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('totsuka.look.v1')); s.body = 'male'; localStorage.setItem('totsuka.look.v1', JSON.stringify(s)); });
  await page.goto(base + '/?shot&money=5000', { timeout: 240000 });
  await page.waitForFunction(() => window.__g, null, { timeout: 240000 });
  await waitBody('M00_'); await frames(3);
  console.log('起動時の保存:', await page.evaluate(() => localStorage.getItem('totsuka.look.v1')));
  const m3 = await mats();
  ok(m3.M > 0 && m3.F === 0, '開き直すと、保存した男性の体で始まる ' + JSON.stringify(m3));
  await page.screenshot({ path: path.join(out, 'e_reload_male.png') });
  console.log(bad ? `NG ${bad} 件` : '全部 OK');
  await browser.close(); server.close(); process.exit(bad ? 1 : 0);
})();
