// 延ばした先の駅の駅舎・駅前 (rail_ext の stations[].site。舞浜) の画面を撮る。視点は駅の向きの座標 (s, t) で書く。
// 使い方: node tools/dev/siteshot.js <出力フォルダ> [--station 舞浜] [--only 名前,名前] [--night]   (1 枚 1〜2 分)
// 視点 (VIEWS): at = キャラの位置 [s, t]、y = 立つ高さ ('G' 地面 / 'F' 改札の階 / 'P' ホーム)、look = 見る向き [ds, dt]、pitch・dist = カメラ
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(__dirname, '.cache', 'package');
const VRM_DIR = path.join(__dirname, '.cache', 'vrm', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.vrm': 'model/gltf-binary', '.glb': 'model/gltf-binary', '.webp': 'image/webp' };

const VIEWS = [
  { name: 's4_deck', at: [30, -22], y: 'F', look: [0, -1], pitch: 0.08, dist: 9 },
  { name: 's5_gates', at: [25, -3], y: 'F', look: [0, -1], pitch: 0.05, dist: 5 },
  { name: 's6_front', at: [30, -50], y: 'G', look: [0, 1], pitch: 0.22, dist: 24 },
  { name: 's7_stairs', at: [86, -21.5], y: 'G', look: [-1, 0], pitch: 0.2, dist: 10 },
  { name: 's1_south_aerial', at: [20, -40], y: 'G', look: [0.2, 1], pitch: 0.6, dist: 90 },
  { name: 's2_rotary', at: [10, -30], y: 'G', look: [0.3, -1], pitch: 0.12, dist: 14 },
  { name: 's3_facade', at: [30, -60], y: 'G', look: [0, 1], pitch: 0.1, dist: 14 },
  { name: '1_north_aerial', at: [70, 30], y: 'G', look: [-0.6, -1], pitch: 0.55, dist: 75 },
  { name: '2_plaza', at: [80, 30], y: 'G', look: [-1, -0.35], pitch: 0.12, dist: 16 },
  { name: '3_terrace', at: [40, 31], y: 'F', look: [-0.2, -1], pitch: 0.1, dist: 8 },
  { name: '4_gates', at: [33, 24], y: 'F', look: [0.1, -1], pitch: 0.08, dist: 6 },
  { name: '5_concourse', at: [4, -6], y: 'F', look: [-1, 0.25], pitch: 0.12, dist: 7 },
  { name: '6_platform', at: [-14, 3.6], y: 'P', look: [1, -0.2], pitch: 0.3, dist: 8 },
  { name: '7_west', at: [-5, 37], y: 'G', look: [1, -0.45], pitch: 0.12, dist: 18 },
  { name: '8_facade', at: [48, 46], y: 'G', look: [-0.35, -1], pitch: 0.05, dist: 5 },
];

(async () => {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : (args.splice(i, 2)[1] || true); };
  const night = args.includes('--night'); if (night) args.splice(args.indexOf('--night'), 1);
  const stationName = flag('--station') || '舞浜';
  const only = flag('--only');
  const [out] = args;
  if (!out) { console.error('usage: node tools/dev/siteshot.js <出力フォルダ> [--station 舞浜] [--only 名前,..] [--night]'); process.exit(1); }
  fs.mkdirSync(out, { recursive: true });
  const idx = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'rail_ext', 'index.json')));
  const st = idx.stations.find((q) => q.name === stationName);
  // 駅の向きの座標。site が無い (修正前のデータ) ときは、ホームの中心線から同じ式で作る
  let f = st.site && st.site.frame;
  if (!f) {
    const pf = st.platforms[0], mid = pf.left.map((l, k) => [(l[0] + pf.right[k][0]) / 2, (l[1] + pf.right[k][1]) / 2]);
    const dx = mid[mid.length - 1][0] - mid[0][0], dz = mid[mid.length - 1][1] - mid[0][1], L = Math.hypot(dx, dz);
    f = { cx: mid[mid.length >> 1][0], cz: mid[mid.length >> 1][1], sx: dx / L, sz: dz / L, gy: -11.48, py: pf.y[pf.y.length >> 1] };
    f.nx = f.sz; f.nz = -f.sx;
  }
  const floor = st.site ? st.site.floor : 4.5;
  const XZ = (s, t) => [f.cx + f.sx * s + f.nx * t, f.cz + f.sz * s + f.nz * t];

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
  page.setDefaultTimeout(300000);
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r =>
    r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
  if (fs.existsSync(VRM_DIR)) await page.route('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.3.3/**', r =>
    r.fulfill({ path: path.join(VRM_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.3.3/', '')), contentType: 'application/javascript' }));
  await page.route('**/src/main.js', async r => {
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, world, camera };\n  const qs = new URLSearchParams');
    r.fulfill({ body: t, contentType: 'application/javascript' });
  });
  page.on('pageerror', e => console.log('ERR', e.message));
  page.on('console', m => { if (/rror/.test(m.text())) console.log('LOG', m.text()); });
  await page.goto(base + '/?shot' + (night ? '&t=2' : ''), { timeout: 300000 });
  await page.waitForFunction(() => window.__g && window.__ride, null, { timeout: 300000 });
  await page.addStyleTag({ content: '#help{display:none!important}' });
  await page.evaluate(() => { window.__trains.hold = Date.now() / 1000; });
  const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const fn = () => (++k >= n ? r() : requestAnimationFrame(fn)); requestAnimationFrame(fn); }), n);
  const extIdle = async () => { for (let k = 0; k < 200; k++) { await frames(2); if (await page.evaluate(() => !window.__railext || window.__railext.stats.idle)) return; } console.log('区間の読み込みが終わらない'); };
  for (const v of VIEWS) {
    if (only && !only.split(',').includes(v.name)) continue;
    const [x, z] = XZ(...v.at), y = v.y === 'P' ? f.py : v.y === 'F' ? f.gy + floor : f.gy;
    const [lx, lz] = [f.sx * v.look[0] + f.nx * v.look[1], f.sz * v.look[0] + f.nz * v.look[1]];
    const face = Math.atan2(lx, lz);
    await page.evaluate(([x, y, z, face]) => window.__ride.place(x, y, z, face), [x, y, z, face]);
    await frames(3); await extIdle();
    await page.evaluate(([x, y, z, face, v]) => { window.__ride.place(x, y, z, face); const c = window.__g.cam; c.yaw = face + Math.PI; c.pitch = v.pitch; c.dist = v.dist; }, [x, y, z, face, v]);
    await frames(3); await page.waitForTimeout(2000);
    const py = await page.evaluate(() => window.__g.player.pos.y);
    await page.screenshot({ path: path.join(out, v.name + '.png'), timeout: 300000 });
    console.log('shot', v.name, 'player y', py.toFixed(2), 'want', y.toFixed(2));
  }
  await browser.close();
  server.close();
})();
