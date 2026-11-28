// 新しい線 (rail_ext の lines。段階 3a は京葉線の東京 → 八丁堀) の確認: 地図の印で地下のホームへ、終点に止まっている電車に乗る、トンネルの中のカメラ、
// 次の駅で降りる、上りで終点へ戻る (止まった後に電車が消えると、そのホームに戻る)、範囲の端、地下の駅の真上の地上、東京駅の「のりかえ」。画面も撮る。
// 使い方: node tools/dev/linecheck.js <出力フォルダ> [--line keiyo]   (準備は shot.js と同じ。20〜40 分)
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
  await page.evaluate(async () => { window.__H = (await import('/src/terrain.js')).H; });   // 地上の高さ (確認用)
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
  // ---------- ここから新しい線の確認 ----------
  const LINE = lineName || 'keiyo';
  // 線の名前・上りの言い方・最初の駅が終点か (設定から。京葉線以外の線でも通るように)
  const CFGL = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'rail_ext_config.json'), 'utf8')).lines.find((l) => l.id === LINE);
  const LN = CFGL.name, INW = CFGL.dirs.in.split(' ')[0], TERM0 = !!CFGL.stations[0].terminal;
  await page.evaluate(() => { window.__trains.hold = Date.now() / 1000; });
  const info = await page.evaluate((LINE) => {
    const R = window.__ride, T = window.__trains, rs = T.R.filter((r) => r.line === LINE);
    return { n: rs.length, routes: rs.map((r) => ({ dir: r.dir, name: r.dirName, rest: r.rest, term: r.term, len: Math.round(r.len), stops: r.stops.map((q) => q.name + '@' + Math.round(q.s)), run: Math.round(r.run), m: r.m, ug: r.ug.length })),
      plats: R.plats.filter((p) => p.routes.some((x) => x.r.line === LINE)).map((p) => p.name + '|' + p.sub + ' ' + p.routes.map((x) => x.r.dir).join(',')) };
  }, LINE);
  check(`${LINE}: 道筋が 2 本 (下り・上り)、駅ごとに両方が止まる`, info.n === 2 && info.plats.length >= 2 && info.plats.every((p) => /out/.test(p) && /in/.test(p)), info);
  const outStops = info.routes.find((r) => r.dir === 'out').stops.map((q) => q.split('@')[0]), [S0, S1] = outStops, SL = outStops[outStops.length - 1];
  // 1. 地図の印 → 最初の駅 (東京の京葉線ホーム) へワープ。地下のホームの上に立つ (地上へ飛び出さない)
  const warp = await page.evaluate(([S0, LINE]) => {
    const g = window.__g, R = window.__ride, e = g.bigmap.events.find((q) => q.name.startsWith(S0 + '駅（') && /京葉線|ホーム/.test(q.name) && q.name !== S0 + '駅（ホーム）');
    if (!e) return { names: g.bigmap.events.map((q) => q.name) };
    g.bigmap.show(0, 0); g.bigmap.onWarp(e.x, e.z);
    const p = g.player.pos, pl = R.onPlatform();
    return { name: e.name, mini: g.minimap.events.includes(e), on: pl && pl.name + '|' + pl.sub, y: +p.y.toFixed(2), surf: +window.__H(p.x, p.z).toFixed(2), ground: +g.world.groundAt(p.x, p.z, p.y + 0.3).toFixed(2) };
  }, [S0, LINE]);
  await frames(2); await page.waitForFunction(() => window.__railext && window.__railext.stats.idle, null, { timeout: 600000 }).catch(() => {});
  await frames(2);
  warp.surf = await page.evaluate(() => { const p = window.__g.player.pos; return +window.__H(p.x, p.z).toFixed(2); });   // 区間を読み終わってからの地上の高さ
  check(`地図の印「${S0}駅（京葉線ホーム）」で地下のホームの上に立つ`, warp.on && warp.on.startsWith(S0) && warp.surf - warp.y > 15 && Math.abs(warp.ground - warp.y) < 0.05, warp);
  // 数コマ動かしても地上へ飛び出さない (足元の高さ = ホーム)
  await page.evaluate(() => { const g = window.__g; for (let i = 0; i < 10; i++) g.player.update(1 / 30, { ax: 0, az: 0, pressed: () => false, held: () => false, endFrame() {} }, g.cam); });
  let s = await st();
  check('地下のホームで立ったまま (地上へ飛び出さない・落ちない)', s.onPlat, s);
  await page.evaluate(() => { const c = window.__g.cam; c.yaw = 1.2; c.pitch = 0.2; c.dist = 7; });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, 'l1_platform.png'), timeout: 240000 });
  // カメラが地下の駅の箱の中 (地上でも土の中でもない)
  const camIn = await page.evaluate(() => { const c = window.__g.camera.position, W = window.__g.world; return { y: +c.y.toFixed(2), ug: !!W.underAt(c.x, c.z, c.y), d: +window.__g.cam.curDist.toFixed(2) }; });
  check('カメラは地下の駅の中', camIn.ug && camIn.d > 3, camIn);

  // 2. 止まっている下りの電車 (最初の駅は終点 = 止まった状態で始まる) の 3 両目の横に立って乗る
  const beside = (sel) => page.evaluate((sel) => {
    const R = window.__ride, T = window.__trains;
    const r = T.R.find((q) => q.line === sel.line && q.dir === sel.dir);
    const si = r.stops.findIndex((x) => x.name === sel.from), P = r.L.period;
    T.hold += ((((r.tArrs[si] + 10 - T.phase(r, T.hold)) % P) + P) % P);
    const V3 = window.__g.player.pos.constructor, a = new V3(), b = new V3(); T.pointAt(r, r.S[si] - 2.5 * T.CAR, a); T.pointAt(r, r.S[si] - 2.5 * T.CAR + 1, b);
    const ux = b.x - a.x, uz = b.z - a.z, l = Math.hypot(ux, uz);
    // 10 両とも見えているか (道筋の外で消えていないか)
    const C = new V3(), Qq = new window.__g.camera.quaternion.constructor();
    let vis = 0; for (let k = 0; k < r.L.cars; k++) for (let j = 0; j < r.m; j++) if (T.carPose(r, k, T.hold, C, Qq, j) && Math.hypot(C.x - a.x, C.z - a.z) < 260) { vis++; break; }
    for (const sgn of [1, -1]) {
      const tx = a.x - uz / l * 2.3 * sgn, tz = a.z + ux / l * 2.3 * sgn, q = R.platAt(tx, tz);
      if (q) { R.place(tx, R.platY(q, tx, tz), tz, 0); const c = window.__g.cam; c.yaw = Math.atan2(-ux, -uz) + 0.35; c.pitch = 0.15; c.dist = 6; return { dir: r.dir, vis, cars: r.L.cars }; }
    }
    return { vis, cars: r.L.cars, fail: true };
  }, sel);
  const b1 = await beside({ line: LINE, dir: 'out', from: S0 });
  await frames(2);
  s = await st();
  check(`${S0}: 止まっている電車が ${b1.cars} 両とも見える・横で「乗る」`, b1.vis === b1.cars && !b1.fail && /乗る/.test(s.hint) && s.hint.includes(LN), { b1, hint: s.hint, info: s.info });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, 'l2_train.png'), timeout: 240000 });
  await press('KeyF'); await frames(2);
  s = await st();
  check('乗った', s.riding && !s.visible, s);
  // 3. 発車してトンネルの中を走る (40 秒後)。カメラはトンネルの中 (線路の上、電車の後ろ)
  const p0 = s;
  await page.evaluate(() => { window.__trains.hold += 40; });
  await frames(3);
  s = await st();
  const tun = await page.evaluate(() => {
    const R = window.__ride, T = window.__trains, rd = R.riding, c = window.__g.camera.position, r = rd.r;
    const n = R.nearestOnRoute(r, c.x, c.z), V3 = c.constructor, q = T.pointAt(r, n.s, new V3());
    return { d: +n.d.toFixed(2), dy: +(c.y - q.y).toFixed(2), inT: T.inTunnel(r, n.s), surf: +(window.__H(c.x, c.z) - c.y).toFixed(1) };
  });
  check('発車して電車と一緒に動く', s.riding && Math.hypot(s.x - p0.x, s.z - p0.z) > 50 && /km\/h/.test(s.info), { info: s.info });
  check('トンネルの中: カメラは線路の上 (トンネルの中) から追う', tun.inT && tun.d < 1 && tun.dy > 2 && tun.dy < 5.3 && tun.surf > 10, tun);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, 'l3_tunnel_out.png'), timeout: 240000 });
  await press('KeyQ'); await frames(2);
  await page.evaluate(() => { const c = window.__g.cam; c.yaw = window.__g.player.facing + Math.PI / 2; c.pitch = 0.0; });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, 'l4_tunnel_in.png'), timeout: 240000 });
  await press('KeyQ'); await frames(1);
  // 4. 次の駅 (八丁堀) に止まる・降りる
  await page.evaluate((name) => { const R = window.__ride, T = window.__trains, rd = R.riding, r = rd.r, si = r.stops.findIndex((x) => x.name === name); T.hold += r.tArrs[si] + 8 - (T.hold - rd.dep); }, S1);
  await frames(3);
  s = await st();
  check(`${S1}に止まる`, s.riding && s.info.includes(S1 + ' 停車中'), s.info);
  await press('KeyF'); await frames(3);
  s = await st();
  const g1 = await page.evaluate(() => { const p = window.__g.player.pos, W = window.__g.world; return { y: +p.y.toFixed(2), g: +W.groundAt(p.x, p.z, p.y + 0.3).toFixed(2), surf: +window.__H(p.x, p.z).toFixed(2) }; });
  check(`${S1}で降りる (地下のホームの上・案内)`, !s.riding && s.onPlat && s.info.includes(S1 + '駅 ' + LN + ' ホーム') && Math.abs(g1.y - g1.g) < 0.05 && g1.surf - g1.y > 10, { s, g1 });
  const edge = await page.evaluate(() => { const R = window.__ride, g = window.__g, p = g.player.pos, pf = R.onPlatform().pf, m = pf.left.length >> 1;
    const ux = pf.left[m][0] - pf.right[m][0], uz = pf.left[m][1] - pf.right[m][1], l = Math.hypot(ux, uz);
    const q = { x: p.x, y: p.y, z: p.z }; for (let k = 0; k < 40; k++) { q.x += ux / l * 0.25; q.z += uz / l * 0.25; g.world.resolve(q, 0.35); }
    return { onPlat: !!R.platAt(q.x, q.z) }; });
  check(`${S1}のホームの縁から落ちない`, edge.onPlat, edge);
  await page.evaluate(() => { const c = window.__g.cam; c.yaw = 0.4; c.pitch = 0.25; c.dist = 8; });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, 'l5_station2.png'), timeout: 240000 });
  // 5. 上りで最初の駅 (終点) へ戻る。終点に止まり、その後電車が消えると、そのホームに戻る
  const b2 = await beside({ line: LINE, dir: 'in', from: S1 });
  await frames(2);
  await press('KeyF'); await frames(2);
  s = await st();
  check(`${S1}で上りに乗る`, !b2.fail && s.riding && s.info.includes(INW), { b2, info: s.info });
  if (TERM0) {
  await page.evaluate((name) => { const R = window.__ride, T = window.__trains, rd = R.riding, r = rd.r, si = r.stops.findIndex((x) => x.name === name); T.hold += r.tArrs[si] + 8 - (T.hold - rd.dep); }, S0);
  await frames(3);
  s = await st();
  check(`終点の${S0}に止まる`, s.riding && s.info.includes(S0 + ' 停車中'), s.info);
  await page.evaluate(() => { window.__trains.hold += 30; });
  await frames(2); await page.waitForFunction(() => !window.__ride.busy); await frames(2);
  s = await st();
  check(`止まった後、電車が消えると${S0}のホームに戻る`, !s.riding && s.visible && s.onPlat && s.info.includes(S0 + '駅 ' + LN + ' ホーム'), s);
  } else {   // 最初の駅が終点でない線: 乗ったまま範囲の端まで行くと、最後に止まった駅のホームに戻る
    await page.evaluate(() => { const R = window.__ride, r = R.riding.r, T = window.__trains, t = T.now() - R.riding.dep;
      for (let d = 0; d < 6000; d += 1) { if (T.front(r, t + d) > r.len - 25) { T.hold += d; break; } } });
    await frames(2); await page.waitForFunction(() => !window.__ride.busy); await frames(2);
    s = await st();
    const lastIn = info.routes.find((r) => r.dir === 'in').stops.slice(-1)[0].split('@')[0];
    check(`上りで範囲の端まで乗ると、最後に止まった ${lastIn}のホームに戻る`, !s.riding && s.onPlat && s.info.includes(lastIn + '駅'), s);
  }
  // 6. 下りで範囲の端まで乗ると、最後に止まった駅 (段階 3b からは舞浜) のホームに戻る
  await beside({ line: LINE, dir: 'out', from: S0 }); await frames(2);
  await press('KeyF'); await frames(2);
  await page.evaluate(() => { const R = window.__ride, r = R.riding.r, T = window.__trains, t = T.now() - R.riding.dep;
    for (let d = 0; d < 6000; d += 1) { if (T.front(r, t + d) > r.len - 25) { T.hold += d; break; } } });
  await frames(2); await page.waitForFunction(() => !window.__ride.busy); await frames(2);
  s = await st();
  check(`範囲の端で ${SL}のホームに戻る`, !s.riding && s.onPlat && s.info.includes(SL + '駅'), s);
  // 7. 地上: 地下の駅の真上の道を歩いても落ちない
  const xz = await page.evaluate(() => { const R = window.__ride, g = window.__g, pl = R.plats.find((p) => p.sub && p.name === R.plats.find((q) => q.sub).name), pf = pl.pf, m = pf.left.length >> 1;
    const x = (pf.left[m][0] + pf.right[m][0]) / 2, z = (pf.left[m][1] + pf.right[m][1]) / 2;
    g.player.teleport(x, z); return [x, z]; });
  // ワープの先の区間を読み終わってから (読む前は地形が -200 m で、何もしなくても通ってしまう。段階 3b で、舞浜から戻ったときに起きた)
  await frames(2); await page.waitForFunction(() => window.__railext && window.__railext.stats.idle, null, { timeout: 600000 }).catch(() => {}); await frames(2);
  const above = await page.evaluate(([x, z]) => { const g = window.__g; g.player.teleport(x, z);
    for (let i = 0; i < 10; i++) g.player.update(1 / 30, { ax: 0, az: 0, pressed: () => false, held: () => false, endFrame() {} }, g.cam);
    return { y: +g.player.pos.y.toFixed(2), surf: +window.__H(x, z).toFixed(2) }; }, xz);
  check('地下の駅の真上の地上に立てる (落ちない)', Math.abs(above.y - above.surf) < 1 && above.surf > -150, above);
  // 8. 東京駅: 京葉線のホームと東海道線のホームの「のりかえ」(同じ名前の駅のホーム)
  const xf = await page.evaluate((S0) => { const R = window.__ride, x = R.xfers.find((q) => q.pl.name === S0 && q.pl.sub);
    if (!x) return null; R.place(x.spot.x - Math.sin(x.face) * 1.2, x.spot.y, x.spot.z - Math.cos(x.face) * 1.2, x.face);
    return { from: x.label, to: x.targets.map((t) => t.label) }; }, S0);
  if (xf) {
    await frames(2);
    s = await st();
    check(`${S0}の京葉線ホームで「のりかえ」の表示`, /のりかえ/.test(s.hint), { xf, hint: s.hint });
    await press('KeyF'); await page.waitForTimeout(1500); await frames(2);
    const after = await page.evaluate(() => { const pl = window.__ride.onPlatform(); return pl && pl.name + '|' + pl.sub + ' ' + pl.routes.map((x) => x.r.line).join(','); });
    check(`のりかえで${S0}の東海道線のホームへ`, after && /tokaido/.test(after), after);
  } else console.log('のりかえ: なし');
  const nan = await page.evaluate(() => { const p = window.__g.player.pos; return [p.x, p.y, p.z].some((v) => !isFinite(v)); });
  check('NaN なし', !nan);
  console.log(`${ok.filter((o) => o[1]).length}/${ok.length} OK`);
  await browser.close();
  server.close();
})();
