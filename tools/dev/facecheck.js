// キャラメイクの顔 (src/face.js, menu.js の「顔」タブ, hairstyle.js の face) の確認: ゲーム本体を開き、メニュー → キャラメイク → 顔 → スライダー・元に戻す・保存・開き直し、を画面と値で確かめる。
// 使い方: node tools/dev/facecheck.js <出力フォルダ>   (準備は bodycheck.js と同じ。数分)
const { chromium } = require('playwright');
const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), PUBLIC = path.join(ROOT, 'public'), CACHE = path.join(__dirname, '.cache');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.vrm': 'model/gltf-binary' };
let bad = 0;
const ok = (c, m) => { console.log((c ? 'OK  ' : 'NG  ') + m); if (!c) bad++; };
(async () => {
  const [out] = process.argv.slice(2);
  if (!out) { console.error('usage: node tools/dev/facecheck.js <出力フォルダ>'); process.exit(1); }
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    const p = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
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
  const open = async (q) => { await page.goto(base + '/?shot&money=5000' + q, { timeout: 240000 }); await page.waitForFunction(() => window.__g, null, { timeout: 240000 }); await page.addStyleTag({ content: '#help{display:none!important}' }); await frames(3); };
  const frames = (n) => page.evaluate((n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('totsuka.look.v1') || 'null'));
  // 顔の頂点: 右目 (白目) の x 幅と、口の幅を測る (変わったかを見る)
  const eyeW = () => page.evaluate(() => { let w = 0; __g.player.model.root.traverse(o => { if (!o.isMesh || !(Array.isArray(o.material) ? o.material : [o.material]).some(m => /EyeWhite/.test(m.name))) return; const a = o.geometry.attributes.position; let lo = 1e9, hi = -1e9; for (let i = 0; i < a.count; i++) { const x = a.getX(i); if (x > 0) { lo = Math.min(lo, x); hi = Math.max(hi, x); } } w = hi - lo; }); return w; });
  await open('&resetsave'); await frames(3);
  const w0 = await eyeW();
  await page.keyboard.press('Tab'); await frames(3);
  await page.click('[data-do=charmake]'); await frames(4);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.mn-tab')].map(b => b.textContent).join());
  ok(tabs.includes('顔'), 'タブ: ' + tabs);
  await page.click('[data-cmtab=face]'); await frames(4);
  ok(await page.evaluate(() => document.querySelectorAll('input[data-face]').length) === 13, 'スライダー 13 本');
  ok(await page.evaluate(() => document.querySelector('[data-do=facereset]').classList.contains('locked')), '元の顔のとき、「元に戻す」は薄い');
  await page.screenshot({ path: path.join(out, 'a_tab.png') });
  // スライダー (ドラッグ相当: input イベント)。メニューが作り直されないこと
  await page.evaluate(() => { const el = document.querySelector('input[data-face=eyeSize]'); window.__el = el; el.value = '8'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await frames(4);
  ok(await page.evaluate(() => document.querySelector('input[data-face=eyeSize]') === window.__el), '動かしても、スライダーは作り直されない (つかんだまま動かせる)');
  ok(await page.evaluate(() => document.querySelector('[data-faceval="0"]').textContent) === '大きい 8', '値の文字: 大きい 8');
  const w1 = await eyeW();
  ok(w1 > w0 * 1.15, `目が大きくなった ${w0.toFixed(4)} → ${w1.toFixed(4)}`);
  ok((await saved()).face?.eyeSize === 0.8, '保存: ' + JSON.stringify((await saved()).face));
  await page.evaluate(() => { const el = document.querySelector('input[data-face=chin]'); el.value = '-5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await frames(4);
  await page.screenshot({ path: path.join(out, 'b_changed.png') });
  // キーボード: ↑↓ で行を移し、← → で値を変える (スライダーにフォーカスがある)
  await page.keyboard.press('ArrowDown'); await frames(3); // 末尾 (あごの長さ) の次は先頭の「元に戻す」
  await page.keyboard.press('ArrowDown'); await frames(3);
  const foc = await page.evaluate(() => document.activeElement?.dataset?.face);
  ok(!!foc, '↑↓ で行を移すとスライダーにフォーカス: ' + foc);
  const before = await page.evaluate(() => document.activeElement.value);
  await page.keyboard.press('ArrowRight'); await frames(3);
  ok(await page.evaluate(() => document.activeElement.value) !== before, '← → でスライダーが動く');
  // 元に戻す
  await page.click('[data-do=facereset]'); await frames(6);
  ok(Object.keys((await saved()).face || {}).length === 0, '元に戻す: 保存の face が空');
  const w2 = await eyeW();
  ok(Math.abs(w2 - w0) < 1e-5, `目の幅が元に戻った ${w2.toFixed(5)} (元 ${w0.toFixed(5)})`);
  ok(await page.evaluate(() => [...document.querySelectorAll('input[data-face]')].every(e => e.value === '0')), 'スライダーが全部 0');
  await page.screenshot({ path: path.join(out, 'c_reset.png') });
  // 保存 → 開き直し
  await page.evaluate(() => { const el = document.querySelector('input[data-face=noseSize]'); el.value = '6'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await frames(3);
  await open(''); await frames(3);
  ok(await page.evaluate(() => __g.menu.hairStyle.face.noseSize) === 0.6, '開き直すと保存した顔 (noseSize 0.6)');
  await open('&face=eyeSize:1,bogus:3,chin:9'); // 試し用 URL: 知らないキーは無視、範囲は -1〜1
  ok(JSON.stringify(await page.evaluate(() => __g.menu.hairStyle.face)) === '{"eyeSize":1,"chin":1}', '?face= の不正値を無視');
  await browser.close(); server.close();
  console.log(bad ? `NG ${bad} 件` : '全部 OK'); process.exit(bad ? 1 : 0);
})();
