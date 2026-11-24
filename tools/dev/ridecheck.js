// 電車の乗り降り (ride.js) の確認: 改札 → ホーム、案内、乗る、走る、車内の視点、地図の端で戻る、止まっている間に降りる、ホーム → 改札。画面も撮る。
// 使い方: node tools/dev/ridecheck.js <出力フォルダ> [--station 東戸塚] [--line tokaido]   (準備は shot.js と同じ。20 分ほど)
//   --line その駅で確かめる線 (横浜は横須賀線と東海道線が止まる。無ければその駅のホームに止まる最初の線)
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
  const lineName = flag('--line');         // 確かめる線 (tokaido など。無ければその駅のホームに止まる最初の線)
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
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, world, camera, bigmap, minimap };\n  const qs = new URLSearchParams');
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
  await page.addStyleTag({ content: '#hud,#minimap{display:none!important}' });
  const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const ok = [];
  const check = (name, cond, info) => { ok.push([name, !!cond]); console.log((cond ? 'OK  ' : 'NG  ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };
  const st = () => page.evaluate(() => {
    const R = window.__ride, p = window.__g.player.pos;
    return { riding: !!R.riding, k: R.riding && R.riding.k, view: R.riding && R.riding.view, busy: R.busy, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
      onPlat: !!R.onPlatform(), visible: window.__g.player.model.root.visible, hint: R.hint.hidden ? '' : R.hint.textContent, info: R.info.hidden ? '' : R.info.textContent,
      toast: R.lastSay || '' };
  });
  const press = (key) => page.evaluate((key) => window.__ride.update(0, { pressed: (k) => k === key }), key);
  const setup = await page.evaluate(() => {
    const R = window.__ride;
    window.__F = { pressed: (k) => k === 'KeyF' };
    return { disabled: R.disabled, gates: R.gates.length, tops: R.gates.map((g) => [g.top, g.downs.map((d) => R.plats.indexOf(d.plat))]), plats: R.plats.map((p) => p.name + ' ' + p.routes.map((x) => x.r.line + ':' + x.r.dir).join(',')) };
  });
  console.log('setup', JSON.stringify(setup));
  // 延ばした先の駅は、ホームが複数のことがある (横浜: 横須賀線の島式 1 面 + 東海道線の上り・下りの 1 面ずつ)。駅ごとに上下の両方が止まればよい
  const byName = {};
  for (const p of setup.plats.slice(2)) { const [n, ...rest] = p.split(' '); byName[n] = (byName[n] || '') + ' ' + rest.join(' '); }
  check('改札から戸塚の 2 面のホームへ行ける・延ばした先の駅ごとに上下 2 方向が止まる・どのホームにも電車が止まる', new Set(setup.tops.flatMap((t) => t[1])).size === 2 && setup.plats.length >= 3
    && Object.values(byName).every((v) => /:north/.test(v) && /:south/.test(v)) && setup.plats.slice(2).every((p) => /:/.test(p)), { setup, byName });
  // 東戸塚・保土ケ谷は横須賀線だけが止まる (東海道線・貨物線は通過)
  check('東戸塚・保土ケ谷には横須賀線だけが止まる', ['東戸塚', '保土ケ谷'].every((n) => !byName[n] || !/(tokaido|freight):/.test(byName[n])), byName);
  // 時計を止める (この環境は画面を撮るのに 1〜2 分かかり、その間に電車が動いてしまうため)
  await page.evaluate(() => { window.__trains.hold = Date.now() / 1000; });
  // 時計を、道筋 r の電車が止まって 10 秒の時刻にする
  const dwellAt = (line) => page.evaluate((line) => { const R = window.__ride, T = window.__trains, pl = R.onPlatform();
    const { r, si } = pl.routes.find((x) => !line || x.r.line === line), P = r.L.period;
    const t = T.phase(r, T.hold); T.hold += ((((r.tArrs[si] + 10 - t) % P) + P) % P); return { line: r.line, dir: r.dir, st: r.stops[si].name }; }, line);

  // 0. 地図の乗り場の印: ミニマップ・大きい地図に出る、選んでワープすると改札の前 (デッキの上) に立つ
  const mark = await page.evaluate(() => {
    const g = window.__g, e = g.bigmap.events.find((q) => q.glyph === '電');
    if (!e) return null;
    g.bigmap.show(-306, 1426);
    g.bigmap.onWarp(e.x, e.z);
    const p = g.player.pos, t = window.__ride.gates[0].top;
    return { name: e.name, mini: g.minimap.events.includes(e), open: g.bigmap.open, d: Math.hypot(p.x - t.x, p.z - t.z), dy: p.y - t.y };
  });
  await frames(2);
  const s0 = await st();
  check('地図に乗り場の印・選んでワープすると改札の前 (デッキの上) に立つ', mark && mark.mini && !mark.open && mark.d < 0.5 && Math.abs(mark.dy) < 0.5 && /改札/.test(s0.hint), { mark, hint: s0.hint });
  // 地図の画面 (乗り場の印のまわりを拡大)
  await page.evaluate(() => { const g = window.__g, t = window.__ride.gates[0].top; g.bigmap.show(t.x, t.z); g.bigmap.scale = 1.6; g.bigmap.cx = t.x; g.bigmap.cz = t.z + 60; });
  await frames(2); await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(out, '0_map.png'), timeout: 240000 });
  await page.evaluate(() => window.__g.bigmap.hide());

  // 1. 改札 → ホーム
  await page.evaluate(() => { const g = window.__ride.gates[0]; window.__ride.place(g.top.x, g.top.y, g.top.z, 0); });
  await frames(2);
  let s = await st();
  check('改札で「ホームへ」の表示', /ホームへ/.test(s.hint), s);
  await press('KeyF'); await page.waitForFunction(() => !window.__ride.busy); await frames(2);
  s = await st();
  check('ホームに降りた (ホームの上面に立つ)', s.onPlat && !s.busy, s);
  check('ホームで次の電車の案内', /戸塚駅 ホーム/.test(s.info) && /(あと|停車中)/.test(s.info), s.info);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(out, '1_platform.png'), timeout: 240000 });

  // 2. 止まっている電車の横に立つ (時計をずらして、発車の 20 秒前にする)
  const pos = await page.evaluate(() => {
    const R = window.__ride, T = window.__trains, pl = R.onPlatform(), { r, si } = pl.routes.find((x) => x.r.stops.length > 1) || pl.routes[0], P = r.L.period;
    T.hold += ((((r.tArrs[si] + 10 - T.phase(r, T.hold)) % P) + P) % P);
    // 3 両目の横、ホームの側へ 2.4 m
    const THREE_ = window.__g.player.pos.constructor;
    const a = new THREE_(), b = new THREE_();
    T.pointAt(r, r.S[si] - 2.5 * T.CAR, a); T.pointAt(r, r.S[si] - 2.5 * T.CAR + 1, b);
    const ux = b.x - a.x, uz = b.z - a.z, l = Math.hypot(ux, uz);
    for (const sgn of [1, -1]) {
      const x = a.x - uz / l * 2.4 * sgn, z = a.z + ux / l * 2.4 * sgn, q = R.platAt(x, z);
      if (q) { R.place(x, R.platY(q, x, z), z, Math.atan2(ux / l * 0 + uz / l * sgn, -ux / l * sgn)); return { line: r.line, dir: r.dir, x, z }; }
    }
    return null;
  });
  await frames(2);
  s = await st();
  check('止まっている電車の横で「乗る」の表示', pos && /乗る/.test(s.hint), { pos, hint: s.hint, info: s.info });
  await press('KeyF'); await frames(2);
  s = await st();
  check('乗った (キャラを隠す・3 号車)', s.riding && !s.visible && s.k === 2, s);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(out, '2_board_stopped.png'), timeout: 240000 });

  // 3. 発車して走る (時計を 40 秒進める)
  const p0 = s;
  await page.evaluate(() => { window.__trains.hold += 40; });
  await frames(3);
  s = await st();
  const moved = Math.hypot(s.x - p0.x, s.z - p0.z);
  check('発車して電車と一緒に動く', s.riding && moved > 50 && /km\/h/.test(s.info), { moved: +moved.toFixed(1), info: s.info });
  const camD = await page.evaluate(() => { const c = window.__g.camera.position, p = window.__g.player.pos; return +Math.hypot(c.x - p.x, c.z - p.z).toFixed(1); });
  check('カメラは電車を外から追う', camD > 5 && camD < 20, camD);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(out, '3_ride_out.png'), timeout: 240000 });
  await press('KeyQ'); await frames(3);
  s = await st();
  const camIn = await page.evaluate(() => { const c = window.__g.camera.position, p = window.__g.player.pos; return [+Math.hypot(c.x - p.x, c.z - p.z).toFixed(2), +(c.y - p.y).toFixed(2)]; });
  check('Q で車内の視点', s.view === 'in' && camIn[0] < 0.5 && camIn[1] > 2, camIn);
  await page.evaluate(() => { const c = window.__g.cam; c.yaw = window.__g.player.facing; c.pitch = 0.05; });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(out, '4_ride_in.png'), timeout: 240000 });
  await press('KeyF'); await frames(1);
  s = await st();
  check('走っている間は F で降りない', s.riding, s.riding);

  // 4. 地図の端に着くと、乗ったホームへ戻る
  await page.evaluate(() => {
    const R = window.__ride, r = R.riding.r, T = window.__trains, t = T.now() - R.riding.dep;
    for (let d = 0; d < 1200; d += 1) { if (T.front(r, t + d) > r.len - 25) { T.hold += d; break; } }
  });
  await frames(2); await page.waitForFunction(() => !window.__ride.busy); await frames(2);
  s = await st();
  check('範囲の端で、最後に止まった駅のホームへ戻る', !s.riding && s.visible && s.onPlat && /駅のホームに戻りました/.test(s.toast), s);
  // 戸塚のホームへ戻しておく
  await page.evaluate((p) => { const R = window.__ride, q = R.platAt(p.x, p.z); R.place(p.x, R.platY(q, p.x, p.z), p.z, 0); }, pos);
  await frames(2);

  // 5. もう一度乗って、止まっている間に降りる
  await dwellAt();
  await frames(2);
  await press('KeyF'); await frames(2);
  s = await st();
  check('もう一度乗る', s.riding, s);
  await press('KeyF'); await frames(2);
  s = await st();
  check('止まっている間に F で降りる (ホームの上・キャラが見える)', !s.riding && s.onPlat && s.visible, s);

  // 5b. 戸塚 → 延ばした先の駅 (ST。--station で選ぶ。無ければ最初の駅)。途中の画面、その駅で降りる、ホームの案内、戻りの電車で戸塚へ
  // 道筋 r の電車を si 番目の駅に止め (発車の 20 秒前)、k 両目の横 2.3 m のホームの上に立たせる
  const beside = (sel) => page.evaluate((sel) => {
    const R = window.__ride, T = window.__trains;
    const r = T.R.find((q) => q.line === sel.line && q.stops.some((x) => x.name === sel.from) && q.stops.some((x) => x.name === sel.to)
      && q.stops.findIndex((x) => x.name === sel.from) < q.stops.findIndex((x) => x.name === sel.to));
    if (!r) return null;
    const si = r.stops.findIndex((x) => x.name === sel.from), P = r.L.period;
    T.hold += ((((r.tArrs[si] + 10 - T.phase(r, T.hold)) % P) + P) % P);
    const V3 = window.__g.player.pos.constructor, a = new V3(), b = new V3(); T.pointAt(r, r.S[si] - 3.5 * T.CAR, a); T.pointAt(r, r.S[si] - 3.5 * T.CAR + 1, b);
    const ux = b.x - a.x, uz = b.z - a.z, l = Math.hypot(ux, uz);
    for (const sgn of [1, -1]) {
      const tx = a.x - uz / l * 2.3 * sgn, tz = a.z + ux / l * 2.3 * sgn, q = R.platAt(tx, tz);
      if (q) { R.place(tx, R.platY(q, tx, tz), tz, 0); return { dir: r.dir, line: r.line }; }
    }
    return null;
  }, sel);
  const ST = await page.evaluate(([want, line]) => { const R = window.__ride, pl = R.plats.slice(2).find((p) => (!want || p.name === want) && (!line || p.routes.some((x) => x.r.line === line)));
    return pl ? { name: pl.name, line: line || pl.routes[0].r.line, idx: R.plats.indexOf(pl) } : null; }, [stationName, lineName]);
  check('延ばした先の駅がある', !!ST, ST);
  const go = await beside({ line: ST.line, from: '戸塚', to: ST.name });
  await frames(2);
  await press('KeyF'); await frames(2);
  s = await st();
  check(`戸塚で ${ST.name} 行きに乗る`, go && s.riding, { go, info: s.info });
  // 途中 (着く 90 秒前)
  await page.evaluate((name) => { const R = window.__ride, T = window.__trains, rd = R.riding, r = rd.r, si = r.stops.findIndex((x) => x.name === name);
    T.hold += r.tArrs[si] - 90 - (T.hold - rd.dep); }, ST.name);
  await frames(3);
  s = await st();
  check(`途中: 「${ST.name}」の案内・電車と一緒に動く (地図の外)`, s.riding && s.info.includes(ST.name) && (s.z < -650 || s.z > 1650 || Math.abs(s.x) > 650), { info: s.info, x: s.x, z: s.z });
  await page.evaluate(() => { const c = window.__g.cam; c.pitch = 0.35; });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(out, '5_between.png'), timeout: 240000 });
  await press('KeyQ'); await frames(2);
  await page.evaluate(() => { const c = window.__g.cam; c.yaw += Math.PI / 2; c.pitch = 0.0; });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(out, '6_between_in.png'), timeout: 240000 });
  await press('KeyQ'); await frames(1);
  await page.evaluate((name) => { const R = window.__ride, T = window.__trains, rd = R.riding, r = rd.r, si = r.stops.findIndex((x) => x.name === name); T.hold += r.tArrs[si] + 8 - (T.hold - rd.dep); }, ST.name);
  await frames(3);
  s = await st();
  check(`${ST.name}に止まる`, s.riding && s.info.includes(ST.name + ' 停車中'), s.info);
  await press('KeyF'); await frames(3);
  s = await st();
  check(`${ST.name}で降りる (ホームの上・案内)`, !s.riding && s.onPlat && s.info.includes(ST.name + '駅 ホーム'), s);
  const htY = await page.evaluate(() => { const p = window.__g.player.pos, W = window.__g.world; return { y: p.y, g: W.groundAt(p.x, p.z, p.y + 0.3) }; });
  check(`${ST.name}のホームの上に立つ (地面の下に落ちない)`, Math.abs(htY.y - htY.g) < 0.05, htY);
  // ホームの縁の柵: 線路の側へ歩いても落ちない
  const edge = await page.evaluate((idx) => { const R = window.__ride, g = window.__g, p = g.player.pos, pf = R.plats[idx].pf, m = pf.left.length >> 1;
    const ux = pf.left[m][0] - pf.right[m][0], uz = pf.left[m][1] - pf.right[m][1], l = Math.hypot(ux, uz);
    const q = { x: p.x, y: p.y, z: p.z }; for (let k = 0; k < 40; k++) { q.x += ux / l * 0.25; q.z += uz / l * 0.25; g.world.resolve(q, 0.35); }
    return { onPlat: !!R.platAt(q.x, q.z), q }; }, ST.idx);
  check(`${ST.name}のホームの縁から落ちない`, edge.onPlat, edge);
  await page.evaluate(() => { const c = window.__g.cam; c.yaw = 0.4; c.pitch = 0.25; c.dist = 8; });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(out, '7_station.png'), timeout: 240000 });
  // 戻り
  const back = await beside({ line: ST.line, from: ST.name, to: '戸塚' });
  await frames(2);
  await press('KeyF'); await frames(2);
  s = await st();
  check(`${ST.name}で戸塚行きに乗る`, back && s.riding, { back, info: s.info });
  await page.evaluate(() => { const R = window.__ride, T = window.__trains, rd = R.riding, r = rd.r, si = r.stops.findIndex((x) => x.name === '戸塚'); T.hold += r.tArrs[si] + 8 - (T.hold - rd.dep); });
  await frames(3);
  s = await st();
  check('戸塚に止まる', s.riding && /(^|\s|号車)戸塚 停車中/.test(s.info), s.info);
  await press('KeyF'); await frames(3);
  s = await st();
  check('戸塚で降りる', !s.riding && s.onPlat && /^戸塚駅 ホーム/.test(s.info), s.info);

  // 6. ホームの階段の下 → 改札
  await page.evaluate(() => { const g = window.__ride.stairs[1]; window.__ride.place(g.bottom.x, g.bottom.y, g.bottom.z, 0); });
  await frames(2);
  s = await st();
  check('階段の下で「改札へ」の表示', /改札へ/.test(s.hint), s);
  await press('KeyF'); await page.waitForFunction(() => !window.__ride.busy); await frames(2);
  s = await st();
  const top = await page.evaluate(() => window.__ride.stairs[1].gate.top);
  check('改札 (自由通路の上) に上がった', !s.onPlat && Math.abs(s.y - top.y) < 0.6 && Math.hypot(s.x - top.x, s.z - top.z) < 0.5, { s, top });
  // 改札から、もう 1 つのホームへ (Q)
  await page.evaluate(() => { const g = window.__ride.gates[0]; window.__ride.place(g.top.x, g.top.y, g.top.z, 0); });
  await frames(2);
  const other = await page.evaluate(() => window.__ride.gates[0].downs.length > 1);
  if (other) {
    await press('KeyQ'); await page.waitForFunction(() => !window.__ride.busy); await frames(2);
    s = await st();
    const want = await page.evaluate(() => window.__ride.plats.indexOf(window.__ride.gates[0].downs[1].plat));
    const got = await page.evaluate(() => window.__ride.plats.indexOf(window.__ride.onPlatform()));
    check('改札で Q → もう 1 つのホーム', got === want && got >= 0, { got, want, info: s.info });
    await dwellAt(); await frames(2);
    s = await st();
    check('そのホームの案内 (下り)', /下り/.test(s.info), s.info);
  }
  const nan = await page.evaluate(() => { const p = window.__g.player.pos; return [p.x, p.y, p.z].some((v) => !isFinite(v)); });
  check('NaN なし', !nan);

  console.log(`${ok.filter((o) => o[1]).length}/${ok.length} OK`);
  await browser.close();
  server.close();
})();
