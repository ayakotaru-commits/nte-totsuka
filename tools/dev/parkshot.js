// フェアリー・リールパーク (舞浜の架空のテーマパーク。PARK_PLAN.md) の画面を撮る。視点はゲームの座標 (x, z) で書く。
// 使い方: node tools/dev/parkshot.js <出力フォルダ> [--nopark] [--only 名前,名前] [--night] [--probe]   (1 枚 1〜2 分。--probe = 壁の柄の確かめの箱だけを撮る。--nopark = 修正前 = 実在のままの舞浜)
// 視点 (VIEWS): at = キャラの位置 [x, z]、look = 見る向き [dx, dz]、pitch・dist = カメラ。キャラは地面に立つ (高さは地形から)
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(__dirname, '.cache', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };

const VIEWS = [
  { name: 'a1_site_aerial', at: [31480, -25760], look: [0, 1], pitch: 1.1, dist: 700 },        // 敷地の上から (北の駅の側から南へ)
  { name: 'a2_gate_aerial', at: [31330, -25919], look: [0.5, 0.866], pitch: 0.7, dist: 120 },  // ゲートとその前の道
  { name: 'a3_approach', at: [31306, -25986], look: [0.2, 1], pitch: 0.25, dist: 24 },          // 駅からの歩道が敷地に入る所から
  { name: 'a4_gate_front', at: [31310, -25950], look: [0.5, 0.866], pitch: 0.12, dist: 16 },    // ゲートの看板を正面から
  { name: 'a5_gate_close', at: [31330, -25919], look: [0.5, 0.866], pitch: 0.18, dist: 7 },     // 柱の間から
  { name: 'a6_plaza', at: [31440, -25760], look: [0.3, 1], pitch: 0.2, dist: 20 },              // ネオン・アベニューから広場の円へ
  { name: 'a7_plaza_aerial', at: [31490, -25672], look: [0, 1], pitch: 0.9, dist: 260 },        // 広場の円を上から
  { name: 'p1_walls_probe', at: [31262, -25905], look: [0.35, 1], pitch: 0.12, dist: 60, probe: true },   // 壁の柄の確かめ: 延長の建物の材質に、街の本体と同じ柄 (matId 0〜5) を付けた箱を並べる (--probe のときだけ)
  { name: 'p2_walls_close', at: [31246, -25892], look: [0.15, 1], pitch: 0.04, dist: 15, probe: true },   // 近くから (吹き付け・サイディング・タイル・打ち放しが見える距離)
  { name: 'a8_station_side', at: [31730, -25950], look: [-1, 0.2], pitch: 0.4, dist: 60 },      // 駅の南口のロータリー (敷地の縁。省いた所と残した所の境目)
];

(async () => {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : (args.splice(i, 2)[1] || true); };
  const night = args.includes('--night'); if (night) args.splice(args.indexOf('--night'), 1);
  const nopark = args.includes('--nopark'); if (nopark) args.splice(args.indexOf('--nopark'), 1);
  const only = flag('--only');
  const [out] = args;
  if (!out) { console.error('usage: node tools/dev/parkshot.js <出力フォルダ> [--nopark] [--only 名前,..] [--night]'); process.exit(1); }
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
  page.setDefaultTimeout(300000);
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r =>
    r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
  await page.route('**/src/main.js', async r => {
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, world, camera };\n  const qs = new URLSearchParams');
    r.fulfill({ body: t, contentType: 'application/javascript' });
  });
  page.on('pageerror', e => console.log('ERR', e.message));
  page.on('console', m => { if (/rror/.test(m.text())) console.log('LOG', m.text()); });
  await page.goto(base + '/?shot&novrm' + (night ? '&t=2' : '') + (nopark ? '&nopark' : ''), { timeout: 300000 });
  await page.waitForFunction(() => window.__g && window.__ride, null, { timeout: 300000 });
  await page.addStyleTag({ content: '#help{display:none!important}' });
  await page.evaluate(() => { window.__trains.hold = Date.now() / 1000; });
  const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const fn = () => (++k >= n ? r() : requestAnimationFrame(fn)); requestAnimationFrame(fn); }), n);
  const extIdle = async () => { for (let k = 0; k < 200; k++) { await frames(2); if (await page.evaluate(() => !window.__railext || window.__railext.stats.idle)) return; } console.log('区間の読み込みが終わらない'); };
  const probe = args.includes('--probe'); if (probe) args.splice(args.indexOf('--probe'), 1);
  let probed = false;
  for (const v of VIEWS) {
    if (only && !only.split(',').includes(v.name)) continue;
    if (v.probe && !probe) continue;
    if (!v.probe && probe && !only) continue;
    const [x, z] = v.at, face = Math.atan2(v.look[0], v.look[1]);
    // 区間 (地形) が読み込まれるまで、いったん駅の前に置く → 地面の高さを聞いて立つ
    await page.evaluate(([x, z, face]) => window.__ride.place(x, -11, z, face), [x, z, face]);
    await frames(3); await extIdle();
    const gy = await page.evaluate(async ([x, z]) => (await import('/src/terrain.js')).H(x, z), [x, z]);
    await page.evaluate(([x, y, z, face, v]) => { window.__ride.place(x, y, z, face); const c = window.__g.cam; c.yaw = face + Math.PI; c.pitch = v.pitch; c.dist = v.dist; }, [x, gy + 0.1, z, face, v]);
    if (v.probe && !probed) {   // 箱を並べる (左端 = 元の材質のまま、あとは matId 0〜5 = 吹き付け・サイディング・タイル・打ち放し・角波・ALC)
      probed = true;
      await page.evaluate(async () => {
        const THREE = await import('three'), T = await import('/src/terrain.js'), X = await import('/src/detail/textures.js');
        const patch = await X.makeWallPatcher(31330, -25919, 2000);
        const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');   // railext.js の窓の絵と同じ
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#5d6670'; g.fillRect(14, 16, 36, 26); g.fillStyle = '#d8d8d4'; g.fillRect(0, 56, 64, 8);
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        const grp = new THREE.Group(); grp.name = 'probe_walls';
        for (let i = 0; i < 7; i++) {
          const w = 12, h = 14, x = 31200 + i * 18, z = -25860, y = T.H(x, z);
          const geo = new THREE.BoxGeometry(w, h, w);
          const uv = geo.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 4, uv.getY(k) * 4.67);   // 3 m に窓 1 つ
          geo.setAttribute('matId', new THREE.Uint8BufferAttribute(new Uint8Array(geo.attributes.position.count).fill(Math.max(0, i - 1)), 1));
          const mat = new THREE.MeshStandardMaterial({ map: tex, color: '#d9cdb8', roughness: 0.85 });
          if (i > 0) patch(mat, 'probe');
          const m = new THREE.Mesh(geo, mat); m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; grp.add(m);
        }
        const sc = window.__g.scene; sc.add(grp);
      });
    }
    await frames(3); await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(out, v.name + '.png'), timeout: 300000 });
    console.log('shot', v.name, 'ground', gy.toFixed(2));
  }
  await browser.close();
  server.close();
})();
