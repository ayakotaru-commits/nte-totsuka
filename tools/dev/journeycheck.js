// 乗り継ぎの確認 (舞浜までの計画の段階 3b): 戸塚 → 東京 (東海道線) → 東京駅の「のりかえ」→ 京葉線 → 舞浜 → 京葉線で東京 → のりかえ → 東海道線で戸塚。
// 途中で、地下から地上へ出る所 (潮見の手前)・高架・高架の駅の画面も撮る。
// 使い方: node tools/dev/journeycheck.js <出力フォルダ> [--to 舞浜]   (準備は shot.js と同じ。40〜60 分)
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
  
  const toName = flag('--to') || '舞浜';   // 京葉線で行く駅
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
  const shot = async (name) => { await page.waitForTimeout(2500); await page.screenshot({ path: path.join(out, name), timeout: 240000 }); };
  const waitChunks = async () => { await frames(2); await page.waitForFunction(() => window.__railext && window.__railext.stats.idle, null, { timeout: 600000 }).catch(() => {}); await frames(2); };
  await page.evaluate(() => { window.__trains.hold = Date.now() / 1000; });
  // 道筋 (line・dir) の電車を from に止め (着いて 10 秒後)、3.5 両目の横 2.3 m のホームの上に立たせる
  const beside = (sel) => page.evaluate((sel) => {
    const R = window.__ride, T = window.__trains;
    const r = T.R.find((q) => q.line === sel.line && (!sel.dir || q.dir === sel.dir) && q.stops.some((x) => x.name === sel.from) && q.stops.some((x) => x.name === sel.to)
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
  // 乗っている電車を name の駅に止める (着いて 8 秒後)
  const arrive = (name, before = -8) => page.evaluate(([name, before]) => { const R = window.__ride, T = window.__trains, rd = R.riding, r = rd.r, si = r.stops.findIndex((x) => x.name === name);
    T.hold += r.tArrs[si] - before - (T.hold - rd.dep); }, [name, before]);
  // 乗っている電車を、道筋の距離 s (m) の所まで進める (先頭の位置)
  const runTo = (s) => page.evaluate((s) => { const R = window.__ride, r = R.riding.r, T = window.__trains, t = T.now() - R.riding.dep;
    for (let d = 0; d < 3000; d += 0.5) { if (T.front(r, t + d) >= s) { T.hold += d; return true; } } return false; }, s);
  // ホームの「のりかえ」の案内板の前に立ち、want (線名) のホームへ移る
  const xfer = async (from, want, dir) => {
    const xf = await page.evaluate(([want, dir]) => { const R = window.__ride, pl = R.onPlatform(), x = R.xfers.find((q) => q.pl === pl);
      if (!x) return null;
      const ki = x.targets.findIndex((t) => t.pl.routes.some((q) => q.r.line === want && (!dir || q.r.dir === dir)));
      R.place(x.spot.x - Math.sin(x.face) * 1.2, x.spot.y, x.spot.z - Math.cos(x.face) * 1.2, x.face);
      return { from: x.label, ki, to: x.targets.map((t) => t.label) }; }, [want, dir]);
    await frames(2);
    const s = await st();
    check(`${from}: 案内板の前で「のりかえ」の表示`, xf && xf.ki >= 0 && /のりかえ/.test(s.hint), { xf, hint: s.hint });
    if (!xf || xf.ki < 0) return;
    await press(xf.ki === 0 ? 'KeyF' : 'KeyQ');
    await page.waitForTimeout(1500); await frames(2);
    await waitChunks();
    const after = await page.evaluate(() => { const R = window.__ride, pl = R.onPlatform(), p = window.__g.player.pos, W = window.__g.world;
      return { pl: pl && pl.name, routes: pl ? pl.routes.map((x) => x.r.line + ':' + x.r.dir) : [], y: +p.y.toFixed(2), g: +W.groundAt(p.x, p.z, p.y + 0.3).toFixed(2) }; });
    check(`${from}: のりかえで ${want} のホームに立つ`, after.pl === from && after.routes.some((q) => q.startsWith(want + ':') && (!dir || q.endsWith(':' + dir))) && Math.abs(after.y - after.g) < 0.05, after);
  };
  let s;

  // 1. 戸塚 → 東京 (東海道線)
  const go = await beside({ line: 'tokaido', from: '戸塚', to: '東京' });
  await frames(2); await press('KeyF'); await frames(2);
  s = await st();
  check('戸塚で東京行き (東海道線) に乗る', go && s.riding, { go, info: s.info });
  await arrive('東京'); await waitChunks();
  s = await st();
  check('東京に止まる', s.riding && s.info.includes('東京 停車中'), s.info);
  await press('KeyF'); await frames(3);
  s = await st();
  check('東京で降りる (東海道線のホーム)', !s.riding && s.onPlat && /東京駅/.test(s.info), s);
  // 2. のりかえ → 京葉線のホーム
  await xfer('東京', 'keiyo');
  // 3. 京葉線 (下り) で舞浜へ。途中: 地下から地上へ出る所・高架・新木場
  const k1 = await beside({ line: 'keiyo', dir: 'out', from: '東京', to: toName });
  await frames(2); await press('KeyF'); await frames(2);
  s = await st();
  check(`東京で京葉線の${toName}方面に乗る`, k1 && s.riding && /京葉線/.test(s.info), { k1, info: s.info });
  const geo = await page.evaluate(() => { const r = window.__ride.riding.r, T = window.__trains;
    // トンネルの出口 (地下 → 地上) の距離、高架の駅の位置
    let exit = null; for (let s = 0; s < r.len; s += 5) if (T.inTunnel(r, s) && !T.inTunnel(r, s + 5)) { exit = s; break; }
    return { exit, stops: r.stops.map((q) => [q.name, Math.round(q.s)]), len: Math.round(r.len) }; });
  console.log('京葉線', JSON.stringify(geo));
  check('京葉線の下りにトンネルの出口がある (地上へ出る)', geo.exit !== null, geo);
  if (geo.exit !== null) {
    await runTo(geo.exit + 120); await waitChunks();
    s = await st();
    const at = await page.evaluate(() => { const p = window.__g.player.pos, c = window.__g.camera.position; return { y: +p.y.toFixed(1), surf: +window.__H(p.x, p.z).toFixed(1), camAbove: +(c.y - window.__H(c.x, c.z)).toFixed(1) }; });
    check('トンネルを出た: 電車が地上・カメラが地面より上', s.riding && at.camAbove > 0.5, at);
    await page.evaluate(() => { const c = window.__g.cam; c.yaw += 2.4; c.pitch = 0.25; });
    await shot('j1_portal.png');
  }
  // 高架 (新木場の手前 300 m)
  const sk = geo.stops.find((q) => q[0] === '新木場');
  if (sk) {
    await runTo(sk[1] - 300); await waitChunks();
    const el = await page.evaluate(() => { const R = window.__ride, r = R.riding.r, T = window.__trains, s = T.front(r, T.now() - R.riding.dep), V3 = window.__g.player.pos.constructor, q = T.pointAt(r, s, new V3());
      return { rail: +q.y.toFixed(1), ground: +window.__H(q.x, q.z).toFixed(1) }; });
    check('新木場の手前: 高架 (レールが地面より 5 m 以上高い)', el.rail - el.ground > 5, el);
    await page.evaluate(() => { const c = window.__g.cam; c.yaw += 1.4; c.pitch = 0.1; c.dist = 26; });
    await shot('j2_viaduct.png');
    await press('KeyQ'); await frames(2);
    await page.evaluate(() => { const c = window.__g.cam; c.yaw = window.__g.player.facing + Math.PI / 2; c.pitch = 0.0; });
    await shot('j3_viaduct_in.png');
    await press('KeyQ'); await frames(1);
  }
  // 途中の駅 (潮見・新木場・葛西臨海公園) に止まる
  for (const q of geo.stops.slice(1, -1)) {
    if (q[0] === toName) break;
    await arrive(q[0]); await frames(3);
    s = await st();
    check(`途中の${q[0]}に止まる`, s.riding && s.info.includes(q[0] + ' 停車中'), s.info);
  }
  await arrive(toName); await waitChunks();
  s = await st();
  check(`${toName}に止まる`, s.riding && s.info.includes(toName + ' 停車中'), s.info);
  await press('KeyF'); await frames(3);
  s = await st();
  const g1 = await page.evaluate(() => { const p = window.__g.player.pos, W = window.__g.world; return { y: +p.y.toFixed(2), g: +W.groundAt(p.x, p.z, p.y + 0.3).toFixed(2), surf: +window.__H(p.x, p.z).toFixed(2) }; });
  check(`${toName}で降りる (高架のホームの上・案内)`, !s.riding && s.onPlat && s.info.includes(toName + '駅') && Math.abs(g1.y - g1.g) < 0.05 && g1.y - g1.surf > 5, { s, g1 });
  const edge = await page.evaluate(() => { const R = window.__ride, g = window.__g, p = g.player.pos, pf = R.onPlatform().pf, m = pf.left.length >> 1;
    const ux = pf.left[m][0] - pf.right[m][0], uz = pf.left[m][1] - pf.right[m][1], l = Math.hypot(ux, uz);
    const q = { x: p.x, y: p.y, z: p.z }; for (let k = 0; k < 40; k++) { q.x += ux / l * 0.25; q.z += uz / l * 0.25; g.world.resolve(q, 0.35); }
    return { onPlat: !!R.platAt(q.x, q.z) }; });
  check(`${toName}のホームの縁から落ちない`, edge.onPlat, edge);
  const mark = await page.evaluate((n) => { const g = window.__g; return g.bigmap.events.filter((e) => e.name.startsWith(n + '駅')).map((e) => e.name); }, toName);
  check(`地図に「${toName}駅」の印`, mark.length > 0, mark);
  await page.evaluate(() => { const c = window.__g.cam; c.yaw = 0.4; c.pitch = 0.25; c.dist = 8; });
  await shot('j4_station.png');
  await page.evaluate(() => { const c = window.__g.cam; c.yaw = 1.7; c.pitch = 0.05; c.dist = 40; });
  await shot('j5_station_out.png');
  // 4. 京葉線 (上り) で東京へ
  const k2 = await beside({ line: 'keiyo', dir: 'in', from: toName, to: '東京' });
  await frames(2); await press('KeyF'); await frames(2);
  s = await st();
  check(`${toName}で東京行き (京葉線の上り) に乗る`, k2 && s.riding && /上り/.test(s.info), { k2, info: s.info });
  await arrive('東京'); await waitChunks();
  s = await st();
  check('東京 (京葉線ホーム) に止まる', s.riding && s.info.includes('東京 停車中'), s.info);
  await press('KeyF'); await frames(3);
  s = await st();
  check('東京で降りる (京葉線ホーム)', !s.riding && s.onPlat && /京葉線/.test(s.info), s);
  // 5. のりかえ → 東海道線 (下り = 戸塚方面) のホーム → 戸塚
  await xfer('東京', 'tokaido', 'south');
  const back = await beside({ line: 'tokaido', from: '東京', to: '戸塚' });
  await frames(2); await press('KeyF'); await frames(2);
  s = await st();
  check('東京で戸塚方面 (東海道線) に乗る', back && s.riding, { back, info: s.info });
  await arrive('戸塚'); await waitChunks();
  s = await st();
  check('戸塚に止まる', s.riding && /(^|\s|号車)戸塚 停車中/.test(s.info), s.info);
  await press('KeyF'); await frames(3);
  s = await st();
  check('戸塚で降りる', !s.riding && s.onPlat && /^戸塚駅 ホーム/.test(s.info), s.info);
  const nan = await page.evaluate(() => { const p = window.__g.player.pos; return [p.x, p.y, p.z].some((v) => !isFinite(v)); });
  check('NaN なし', !nan);
  console.log(`${ok.filter((o) => o[1]).length}/${ok.length} OK`);
  await browser.close();
  server.close();
})();
