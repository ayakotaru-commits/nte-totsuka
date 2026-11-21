// キャラだけの確認用ページ (tools/dev/charview.html) をヘッドレスブラウザで撮る。街を読み込まないので 1 枚数秒〜十数秒。
//
// 準備 (1 回だけ): three.js と three-vrm をローカルに置く (ブラウザから配信元に届かない環境のため)
//   mkdir -p tools/dev/.cache && cd tools/dev/.cache && npm pack three@0.170.0 -q && tar xzf three-0.170.0.tgz
//   mkdir -p vrm && cd vrm && npm pack @pixiv/three-vrm@3.3.3 -q && tar xzf pixiv-three-vrm-3.3.3.tgz
//
// 使い方: node tools/dev/charshot.js <出力フォルダ> "<charview.html の ? より後ろ>" ...
//   例: node tools/dev/charshot.js out "act=vault&h=0.85&s=0.3" "act=vault&h=0.85&s=0.5" "act=climb&h=1.8&s=0.4"
//   出力は 000.png, 001.png, ... (指定した順)。--novrm を付けると VRM を読まず、組み立て式のキャラで撮る。
//   --page <名前> で tools/dev/<名前>.html を撮る (既定 charview。着せ替えは outfitview)。
//   --scale 3 で 3 倍の解像度 (細部を切り出して見るとき)。
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CACHE = path.join(__dirname, '.cache');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.vrm': 'model/gltf-binary' };

(async () => {
  const args = process.argv.slice(2);
  const novrm = args.includes('--novrm'); if (novrm) args.splice(args.indexOf('--novrm'), 1);
  const pi = args.indexOf('--page'); const pageName = pi < 0 ? 'charview' : args.splice(pi, 2)[1]; // --page outfitview で別の確認ページを撮る
  const si = args.indexOf('--scale'); const scale = si < 0 ? 1 : +args.splice(si, 2)[1]; // 細部を見るときの拡大率
  const [out, ...queries] = args;
  if (!out || !queries.length) { console.error('usage: node tools/dev/charshot.js <出力フォルダ> "<クエリ>" ...'); process.exit(1); }
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory() || (novrm && p.endsWith('.vrm'))) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/tools/dev/${pageName}.html?`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: scale });
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r =>
    r.fulfill({ path: path.join(CACHE, 'package', r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
  await page.route('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.3.3/**', r =>
    r.fulfill({ path: path.join(CACHE, 'vrm', 'package', r.request().url().replace('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.3.3/', '')), contentType: 'application/javascript' }));
  page.on('pageerror', e => console.log('ERR', e.message));
  page.on('console', m => { if (/rror|読み込め/.test(m.text())) console.log('LOG', m.text()); });
  for (let i = 0; i < queries.length; i++) {
    await page.goto(base + queries[i], { timeout: 120000 });
    await page.waitForFunction(() => document.title === 'done', null, { timeout: 120000 });
    const f = path.join(out, String(i).padStart(3, '0') + '.png');
    await page.screenshot({ path: f });
    console.log(f, queries[i]);
  }
  await browser.close();
  server.close();
})();
