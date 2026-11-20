// ゲームセンターのリズムゲームの画面 (draw.js) を、街を読み込まずに撮る (確認用)。
// 使い方: node tools/dev/arcadeshot.js <出力フォルダ> [名前=クエリ ...]
//   例: node tools/dev/arcadeshot.js out "a=t=10&diff=HARD" "chorus=t=26"   (画面の大きさは --size 1280x720 / 844x390 / 390x844)
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css' };
(async () => {
  const args = process.argv.slice(2);
  const out = args[0];
  const si = args.indexOf('--size');
  const [w, h] = (si >= 0 ? args[si + 1] : '1280x720').split('x').map(Number);
  const views = args.slice(1).filter((a, i, arr) => a.includes('=') && arr[i - 1] !== '--size');
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  for (const v of views) {
    const i = v.indexOf('='), name = v.slice(0, i), q = v.slice(i + 1);
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    page.on('pageerror', e => console.log('ERR', e.message));
    page.on('console', m => { if (/rror/.test(m.text())) console.log('LOG', m.text()); });
    await page.goto(`${base}/tools/dev/arcadeview.html?${q}`);
    await page.waitForFunction(() => window.__done, null, { timeout: 120000 });
    await page.screenshot({ path: path.join(out, name + '.png') });
    await page.close();
    console.log('撮った', name);
  }
  await browser.close(); server.close();
})();
