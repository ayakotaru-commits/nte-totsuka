// ゲームをヘッドレスブラウザで起動して、指定した視点のスクリーンショットを撮る (確認用)。
//
// 準備 (1 回だけ): three.js をローカルに置く。ブラウザから配信元 (cdn.jsdelivr.net) に届かない環境のため
//   mkdir -p tools/dev/.cache && cd tools/dev/.cache && npm pack three@0.170.0 -q && tar xzf three-0.170.0.tgz
//
// 使い方: node tools/dev/shot.js <出力フォルダ> <視点.json> [--city <city.json>] [--dump]
//   --city  public/data/city.json の代わりに別のファイルを読ませる (修正前後の比較用)
//   --dump  信号機・バス停などの位置を表示する
//   --night 夜の画面にする (URL に ?t=2。夕方は --dusk、朝は --morning)
//
// 視点.json は配列。1 つの視点は次のどれか:
//   {"n": "名前", "target": [x, z], "offset": [dx, dy, dz]}   地面の (x, z) を、そこから offset だけ離れた所から見る (dy = 地面からの高さ)
//   {"n": "名前", "eye": [x, y, z], "look": [x, y, z]}        カメラの位置と注視点をそのまま指定
//   {"n": "名前", "at": [x, z], "yaw": 0, "pitch": 0.3, "dist": 20}  プレイヤーをそこへ移し、ゲームのカメラで見る (建物に遮られると近づく)
//   どれにも "wait": ミリ秒 を付けられる (既定 4000)
// 座標は city.json と同じ (x = 東, z = 南, 原点 = 戸塚駅付近)。描画はソフトウェアなので 1 枚 1〜2 分かかる。
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(__dirname, '.cache', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };

function terrain() {
  const f = path.join(PUBLIC, 'data', 'terrain.json');
  if (!fs.existsSync(f)) return () => 0;
  const T = JSON.parse(fs.readFileSync(f));
  return (x, z) => {
    const fx = Math.max(0, Math.min(T.nx - 1.0001, (x - T.minX) / T.step)), fz = Math.max(0, Math.min(T.nz - 1.0001, (z - T.minZ) / T.step));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, g = (a, b) => T.h[b * T.nx + a] / 100;
    const h00 = g(i, j), h10 = g(i + 1, j), h01 = g(i, j + 1), h11 = g(i + 1, j + 1);
    return u >= v ? h00 + u * (h10 - h00) + v * (h11 - h10) : h00 + v * (h01 - h00) + u * (h11 - h01);
  };
}

(async () => {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : (args.splice(i, 2)[1] || true); };
  const dump = args.includes('--dump'); if (dump) args.splice(args.indexOf('--dump'), 1);
  const tod = ['--night', '--dusk', '--morning'].find(f => args.includes(f)); for (const f of ['--night', '--dusk', '--morning']) if (args.includes(f)) args.splice(args.indexOf(f), 1);
  const city = flag('--city');
  const [out, viewsFile] = args;
  if (!out || !viewsFile) { console.error('usage: node tools/dev/shot.js <出力フォルダ> <視点.json> [--city <city.json>] [--dump]'); process.exit(1); }
  if (!fs.existsSync(path.join(THREE_DIR, 'build', 'three.module.js'))) {
    console.error('three.js がありません。次を実行してください:\n  mkdir -p tools/dev/.cache && cd tools/dev/.cache && npm pack three@0.170.0 -q && tar xzf three-0.170.0.tgz'); process.exit(1);
  }
  fs.mkdirSync(out, { recursive: true });
  const views = JSON.parse(fs.readFileSync(viewsFile));
  const H = terrain();

  // public/ を配信する小さなサーバー (修正ツールの API は無い)
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
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r =>
    r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
  // プレイヤー・カメラ・シーンを外から動かせるように、main.js に 1 行足して読ませる (リポジトリのファイルは変えない)
  await page.route('**/src/main.js', async r => {
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene };\n  const qs = new URLSearchParams');
    r.fulfill({ body: t, contentType: 'application/javascript' });
  });
  if (city) await page.route('**/data/city.json', r => r.fulfill({ path: path.resolve(city), contentType: 'application/json' }));
  page.on('pageerror', e => console.log('ERR', e.message));
  page.on('console', m => { if (/\[detail\]|rror/.test(m.text())) console.log('LOG', m.text()); });
  const tq = tod === '--night' ? '&t=2' : tod === '--dusk' ? '&t=1' : tod === '--morning' ? '&t=3' : '';
  await page.goto(base + '/?shot' + tq, { timeout: 240000 });
  await page.waitForFunction(() => window.__g, null, { timeout: 240000 });
  await page.addStyleTag({ content: '#help{display:none!important}' }); // 操作説明は隠す

  if (dump) {
    console.log(await page.evaluate(() => {
      const o = {};
      window.__g.scene.traverse(m => {
        if (!['signal_poles', 'signal_heads', 'ped_heads', 'busstop_poles'].includes(m.name)) return;
        const a = [];
        for (let i = 0; i < m.count; i++) { const M = new m.matrix.constructor(); m.getMatrixAt(i, M); a.push([12, 13, 14].map(k => +M.elements[k].toFixed(1))); }
        o[m.name] = (o[m.name] || []).concat(a);
      });
      return JSON.stringify(o);
    }));
  }

  for (const v of views) {
    if (v.at) {
      await page.evaluate((v) => {
        const g = window.__g; g.player.teleport(v.at[0], v.at[1]);
        if (g.camUpdate) g.cam.update = g.camUpdate; // 直接指定の視点で止めたカメラを戻す
        Object.assign(g.cam, { yaw: v.yaw || 0, pitch: v.pitch ?? 0.25, dist: v.dist || 5.5, maxDist: 2000 }); g.cam.update(0, g.player.pos, true);
      }, v);
    } else {
      let eye = v.eye, look = v.look;
      if (v.target) {
        const [x, z] = v.target, [dx, dy, dz] = v.offset, y = H(x, z);
        eye = [x + dx, y + dy, z + dz]; look = [x, y + (v.lookUp ?? 4), z];
      }
      await page.evaluate(({ eye, look }) => {
        const g = window.__g; g.player.teleport(look[0], look[2]);
        if (!g.camUpdate) g.camUpdate = g.cam.update;
        g.cam.update = () => {}; // ゲームのカメラを止めて、位置を直接決める
        g.cam.camera.position.set(...eye); g.cam.camera.lookAt(...look);
      }, { eye, look });
    }
    await page.waitForTimeout(v.wait || 4000);
    await page.screenshot({ path: path.join(out, v.n + '.png'), timeout: 240000 });
    console.log('ok', path.join(out, v.n + '.png'));
  }
  await browser.close();
  server.close();
})();
