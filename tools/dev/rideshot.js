// 線路の延長・駅の画面を撮る (data/rail_ext/。駅を足したときの見た目の確認用)。ridecheck.js と同じ準備で、ミニマップも写す。
// 撮るもの: 1_platform (駅のホーム。止まっている電車)、2_aerial (駅を上から)、3_ride (途中を走る電車を外から)、4_window (車窓)
// 使い方: node tools/dev/rideshot.js <出力フォルダ> [--station 東戸塚]   (5〜10 分)
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
  const props = flag('--props');
  const extraQ = flag('--q') || '';
  const stationName = flag('--station');   // 確かめる延長の駅 (無ければ最初の駅)
  const [out] = args; const viewsFile = 'x';
  if (!out) { console.error('usage: node tools/dev/shot.js <出力フォルダ> <視点.json> [--city <city.json>] [--dump]'); process.exit(1); }
  if (!fs.existsSync(path.join(THREE_DIR, 'build', 'three.module.js'))) {
    console.error('three.js がありません。次を実行してください:\n  mkdir -p tools/dev/.cache && cd tools/dev/.cache && npm pack three@0.170.0 -q && tar xzf three-0.170.0.tgz'); process.exit(1);
  }
  fs.mkdirSync(out, { recursive: true });
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
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, world, camera };\n  const qs = new URLSearchParams');
    r.fulfill({ body: t, contentType: 'application/javascript' });
  });
  if (city) await page.route('**/data/city.json', r => r.fulfill({ path: path.resolve(city), contentType: 'application/json' }));
  if (props) await page.route('**/data/props.json', r => r.fulfill({ path: path.resolve(props), contentType: 'application/json' }));
  page.on('pageerror', e => console.log('ERR', e.message));
  page.on('console', m => { if (/\[detail\]|rror/.test(m.text())) console.log('LOG', m.text()); });
  const tq = tod === '--night' ? '&t=2' : tod === '--dusk' ? '&t=1' : tod === '--morning' ? '&t=3' : '';
  await page.goto(base + '/?shot' + tq + extraQ, { timeout: 240000 });
  await page.waitForFunction(() => window.__g, null, { timeout: 240000 });
  await page.addStyleTag({ content: '#help{display:none!important}' }); // 操作説明は隠す
  const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  // 線路の延長の区間 (detail/railext.js) を読み終わるまで待つ (読み込みはコマごとに進むので、コマを進めながら)
  const extIdle = async () => { for (let k = 0; k < 200; k++) { await frames(2); if (await page.evaluate(() => !window.__railext || window.__railext.stats.idle)) return; } console.log('区間の読み込みが終わらない'); };
  const shot = async (name) => { await frames(3); await extIdle(); await page.waitForTimeout(3000); await page.screenshot({ path: path.join(out, name + '.png'), timeout: 240000 }); console.log('shot', name); };
  const ST = await page.evaluate((want) => { const R = window.__ride; window.__trains.hold = Date.now() / 1000;
    const pl = R.plats.slice(2).find((p) => !want || p.name === want); return pl ? { name: pl.name, idx: R.plats.indexOf(pl) } : null; }, stationName);
  if (!ST) { console.log('延ばした先の駅がありません (data/rail_ext/)'); await browser.close(); server.close(); return; }
  // 駅: 止まる電車 (戸塚から来る向き) が止まっている時刻にして、ホームの端寄りから中央へ向く
  await page.evaluate((idx) => {
    const R = window.__ride, T = window.__trains, pl = R.plats[idx], { r, si } = pl.routes.find((x) => x.r.stops.some((q) => q.name === '戸塚')) || pl.routes[0], P = r.L.period;
    T.hold += ((((r.tArrs[si] + 10 - T.phase(r, T.hold)) % P) + P) % P);
    const pf = pl.pf, k = pf.left.length - 14, x = (pf.left[k][0] + pf.right[k][0]) / 2, z = (pf.left[k][1] + pf.right[k][1]) / 2;
    const yaw = Math.atan2(pf.left[k - 5][0] - pf.left[k][0], pf.left[k - 5][1] - pf.left[k][1]);
    R.place(x, R.platY(pl, x, z), z, yaw);
    const c = window.__g.cam; c.yaw = yaw + Math.PI + 0.25; c.pitch = 0.22; c.dist = 9;
  }, ST.idx);
  await shot('1_platform');
  await page.evaluate(() => { const c = window.__g.cam; c.yaw += 1.3; c.pitch = 0.75; c.dist = 30; });
  await shot('2_aerial');
  // 途中: 戸塚からこの駅へ向かう電車に乗り、着く 150 秒前 (外から) と 90 秒前 (車窓)
  await page.evaluate((name) => {
    const R = window.__ride, T = window.__trains;
    const r = T.R.find((q) => q.stops.findIndex((x) => x.name === '戸塚') >= 0 && q.stops.findIndex((x) => x.name === '戸塚') < q.stops.findIndex((x) => x.name === name));
    const si = r.stops.findIndex((x) => x.name === '戸塚'), P = r.L.period, pl = R.plats.find((p) => p.routes.some((x) => x.r === r && x.si === si));
    T.hold += ((((r.tArrs[si] + 10 - T.phase(r, T.hold)) % P) + P) % P);
    R.board(r, R.dwellAt(r, si, T.hold).j, 4, pl);
    const sj = r.stops.findIndex((x) => x.name === name); T.hold += r.tArrs[sj] - 150 - (T.hold - R.riding.dep);
  }, ST.name);
  await frames(3);
  await page.evaluate(() => { const c = window.__g.cam; c.yaw = Math.PI * 0.75; c.pitch = 0.3; c.dist = 30; });
  await shot('3_ride');
  await page.evaluate(() => { const R = window.__ride, T = window.__trains; T.hold += 60; R.riding.view = 'in'; const c = window.__g.cam; c.yaw = window.__g.player.facing + Math.PI / 2; c.pitch = 0; });
  await shot('4_window');
  await browser.close();
  server.close();
})();
