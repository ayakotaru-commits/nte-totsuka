// 扉 (doors.js) の確認: 閉じている間は通れない・F で開く・開くと通り抜けられる・離れると自動で閉まる。開いた扉の画面も撮る。
// 使い方: node tools/dev/doorcheck.js <出力フォルダ>   (準備は shot.js と同じ。1〜3 分)
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
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, doors, world };\n  const qs = new URLSearchParams');
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


  const res = await page.evaluate(async () => {
    const { DOORS } = await import('/src/doors.js');
    const g = window.__g, W = g.world, out = [];
    const none = { pressed: () => false }, F = { pressed: (k) => k === 'KeyF' };
    const P = (x, y, z) => ({ x, y, z });
    for (const [i, d] of DOORS.entries()) {
      const r = { door: i, w: d.w };
      // 閉じた扉の位置に立たせると、外へ押し出される
      let p = P(d.x, d.y, d.z); W.resolve(p, 0.3);
      r.closedPush = +Math.hypot(p.x - d.x, p.z - d.z).toFixed(2);
      // 外から中へ 0.1 m ずつ歩く (閉じている → 止まる)
      const walk = () => { const q = P(d.x + d.nx * 2, d.y, d.z + d.nz * 2); for (let k = 0; k < 40; k++) { q.x -= d.nx * 0.1; q.z -= d.nz * 0.1; W.resolve(q, 0.3); } return +((q.x - d.x) * d.nx + (q.z - d.z) * d.nz).toFixed(2); };
      r.closedWalkEnd = walk();          // 正 = 扉の外で止まった
      // F を押す → 1.5 秒で開く
      const me = { pos: P(d.x + d.nx * 1.2, d.y, d.z + d.nz * 1.2), facing: 0 };
      g.doors.update(0.016, me, F);
      for (let k = 0; k < 90; k++) g.doors.update(1 / 60, me, none);
      r.openAmt = +d.amt.toFixed(2); r.open = d.rec.door.open; r.leafAngle = +d.leaves[0].pivot.rotation.y.toFixed(2);
      r.facingToDoor = +me.facing.toFixed(2);
      r.openWalkEnd = walk();            // 負 = 扉を通り抜けて中に入れた
      // 扉の間に立っている間は閉まらない
      const inside = { pos: P(d.x, d.y, d.z), facing: 0 };
      g.doors.update(0.016, inside, F);
      for (let k = 0; k < 90; k++) g.doors.update(1 / 60, inside, none);
      r.staysOpenWhileInDoorway = d.amt > 0.5;
      // 離れると 4 秒で閉まる
      const far = { pos: P(d.x + d.nx * 12, d.y, d.z + d.nz * 12), facing: 0 };
      for (let k = 0; k < 60 * 6; k++) g.doors.update(1 / 60, far, none);
      r.autoClosed = d.amt === 0 && !d.rec.door.open;
      out.push(r);
    }
    return { n: DOORS.length, doors: out };
  });
  console.log(JSON.stringify(res, null, 1));
  // 本物のキャラで: F を押すと両手で押す動きが始まり、扉は少し遅れて開く。動きの最中も歩ける (止めない)
  const res2 = await page.evaluate(async () => {
    const { DOORS } = await import('/src/doors.js');
    const g = window.__g, d = DOORS[0], pl = g.player;
    pl.teleport(d.x + d.nx * 1.4, d.z + d.nz * 1.4);
    const mk = (keys = [], press = []) => ({ pressed: (k) => press.includes(k), held: (k) => keys.includes(k), ax: 0, az: 0, endFrame() {} });
    const r = {};
    g.doors.update(1 / 60, pl, mk([], ['KeyF']));
    r.doorT0 = pl.doorT;
    const amtAt = {};
    for (let k = 1; k <= 90; k++) {
      pl.update(1 / 60, mk(), g.cam); g.doors.update(1 / 60, pl, mk());
      if (k === 15 || k === 30 || k === 60 || k === 90) amtAt[k / 60] = +d.amt.toFixed(2);
    }
    r.doorAmtAt = amtAt; r.doorTafter = pl.doorT;
    // 動きの最中に歩けるか: F を押して、すぐ W を押し続ける (横へ)
    d.target = 0; d.amt = 0; for (const l of d.leaves) l.pivot.rotation.y = 0;
    pl.teleport(d.x + d.nx * 1.4, d.z + d.nz * 1.4);
    g.doors.update(1 / 60, pl, mk([], ['KeyF']));
    const p0 = { x: pl.pos.x, z: pl.pos.z };
    for (let k = 0; k < 30; k++) { pl.update(1 / 60, mk(['KeyA']), g.cam); g.doors.update(1 / 60, pl, mk(['KeyA'])); }
    r.movedWhilePushing = +Math.hypot(pl.pos.x - p0.x, pl.pos.z - p0.z).toFixed(2);
    r.stillPushing = pl.doorT >= 0;
    return r;
  });
  console.log(JSON.stringify(res2, null, 1));
  // 画面: 正面の扉を開けた所 (道路側から) と、中庭側の扉を開けた所
  const shots = await page.evaluate(async () => {
    const { DOORS } = await import('/src/doors.js');
    return DOORS.map(d => ({ x: d.x, y: d.y, z: d.z, nx: d.nx, nz: d.nz }));
  });
  // 押している途中のキャラ (正面の扉の前、横から)
  await page.evaluate(async () => {
    const { DOORS } = await import('/src/doors.js');
    const g = window.__g, d = DOORS[0], pl = g.player;
    d.target = 1; d.amt = 0.25; for (const l of d.leaves) l.pivot.rotation.y = l.sign * 1.5 * 0.16;
    d.wait = 0; d.target = 1;
    pl.teleport(d.x + d.nx * 1.1, d.z + d.nz * 1.1);
    pl.facing = Math.atan2(-d.nx, -d.nz);
    pl.update = () => pl.show(1 / 60, 0, { type: 'door', s: 0.5 });   // 撮影のため、この姿勢で止める
    if (!g.camUpdate) g.camUpdate = g.cam.update;
    g.cam.update = () => {};
    const sx = d.nz, sz = -d.nx;   // 扉に沿う向き
    g.cam.camera.position.set(d.x + d.nx * 3.2 + sx * 3.0, d.y + 1.7, d.z + d.nz * 3.2 + sz * 3.0);
    g.cam.camera.lookAt(d.x + d.nx * 0.8, d.y + 1.2, d.z + d.nz * 0.8);
    DOORS[0].leaves.forEach(l => l.pivot.rotation.y = l.sign * 0.25);
    g.doors.update = () => {};
  });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(out, 'push.png'), timeout: 240000 });
  console.log('ok', path.join(out, 'push.png'));
  for (const [i, d] of shots.entries()) {
    await page.evaluate(({ i, d }) => {
      const g = window.__g;
      import('/src/doors.js').then(({ DOORS }) => { DOORS[i].target = 1; DOORS[i].amt = 1; for (const l of DOORS[i].leaves) l.pivot.rotation.y = l.sign * 1.5; });
      g.player.teleport(d.x + d.nx * 3 + d.nz * 1.2, d.z + d.nz * 3 - d.nx * 1.2);
      if (!g.camUpdate) g.camUpdate = g.cam.update;
      g.cam.update = () => {};
      g.cam.camera.position.set(d.x + d.nx * 9 + d.nz * 2.5, d.y + 2.2, d.z + d.nz * 9 - d.nx * 2.5);
      g.cam.camera.lookAt(d.x, d.y + 1.6, d.z);
    }, { i, d });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(out, 'door' + i + '.png'), timeout: 240000 });
    console.log('ok', path.join(out, 'door' + i + '.png'));
  }
  await browser.close();
  server.close();
})();
