// 中央プロムナード (tools/promenade.py) を歩いて通れるかの確認: 地面から入る・3 階のデッキを歩く・階段で上り下りする。
// 使い方: node tools/dev/promenadecheck.js <出力フォルダ>   (準備は shopcheck.js と同じ。数分)
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
  // 経路 (x, z) を W キーで歩く。カメラの向きを次の点へ合わせてから押す。点の 1.5 m 以内に着いたら次へ。着けなければ止まった所と高さを出す。
  const TRACE = process.argv.includes('--trace');
  const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
  const walk = async (name, start, pts, yEnd) => {
    if (ONLY && !name.startsWith(ONLY)) return;
    await goto(start[0], start[1], start[2]); await frames(6);
    if ((await st()).open) { await page.keyboard.press('Escape'); await frames(2); }
    const ys = [];
    for (const [tx, tz] of pts) {
      let n = 0;
      for (; n < 80; n++) {
        const s = await page.evaluate(([tx, tz]) => {
          const p = __g.player.pos; const dx = tx - p.x, dz = tz - p.z;
          __g.cam.yaw = Math.atan2(-dx, -dz);
          return { x: p.x, z: p.z, y: p.y, d: Math.hypot(dx, dz) };
        }, [tx, tz]);
        if (TRACE) console.log(`  ${name} ${n} (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) y=${s.y.toFixed(2)} -> (${tx}, ${tz}) d=${s.d.toFixed(1)}`);
        if (s.d < 2.5) break;
        if ((await st()).open) { await page.keyboard.press('Escape'); await frames(2); }
        await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await frames(3); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
        if (n % 10 === 9) ys.push(s.y.toFixed(1));
      }
      if (n >= 80) { const s = await st(); const p = await page.evaluate(() => ({ x: __g.player.pos.x.toFixed(1), z: __g.player.pos.z.toFixed(1) })); ok(false, `${name}: (${tx}, ${tz}) に着けない。止まった所 (${p.x}, ${p.z}) 高さ ${s.y}`); return; }
    }
    const s = await st();
    ok(Math.abs(s.y - yEnd) < 1.5, `${name}: 着いた (高さ ${s.y}、期待 ${yEnd})。途中の高さ ${ys.join(' ')}`);
    await page.screenshot({ path: path.join(out, name + '.png') });
    for (let i = 0; i < 3 && (await st()).open; i++) { await page.keyboard.press('Escape'); await frames(2); }
  };
  await walk('1_ground', [-30, 17, null], [[-45, 17], [-62, 17], [-76, 16]], -1.5);
  await walk('2_deck', [-46.4, 20.2, 8.1], [[-53, 16.6], [-62.2, 12.8]], 8.1);
  await walk('3_down', [-62.2, 12.5, 8.1], [[-66, 14.6], [-74, 17.4], [-77, 18.2]], -1.5);
  await walk('4_up', [-77, 18.4, null], [[-74, 17.4], [-66, 14.6], [-62.2, 12.8]], 8.1);
  await browser.close(); server.close();
  console.log(bad ? `NG ${bad} 件` : '全部 OK');
  process.exit(bad ? 1 : 0);
})();
