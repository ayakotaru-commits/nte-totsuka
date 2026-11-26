// フェアリー・リールパーク 段階 5 (園内の人・地図の印とワープ・ショーの案内) を、ゲーム本体で確かめる。画面は撮らない (画面は parkshot.js の x*・m* の視点)。
// 使い方: node tools/dev/parkpeoplecheck.js   (約 5〜10 分。three.js は tools/dev/.cache/package に要る = CLAUDE.md の手順。node 単体の数字の確認は tools/dev/parkcrowdcheck.mjs)
// 確かめること: 地図の印 13 か所 (城の印を含む) が出ている / 大きい地図の印を選んでワープすると、その場所の道の上に立つ (建物・柵の中ではない・地面に立つ) /
//   縮小した大きい地図では細かい印が選べない / 園内に人が出る (敷地の中・建物の外・街の人は混ざらない) / ショーの案内 (開催前・開催中・遠くでは出ない) /
//   パレードの印が始まる 40 秒前から点滅する / パレード・花火の観客が増える・終わると消える / 地図の下絵 (園の絵) が描かれる / NaN なし
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(__dirname, '.cache', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };

(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const park = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'park.json')));
  const inPoly = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < (p[j][0] - p[i][0]) * (z - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };
  const inBuilding = (x, z) => park.gen.buildings.some((b) => { const dx = x - b.x, dz = z - b.z; if (Math.abs(dx) > 40 || Math.abs(dz) > 40) return false; const c = Math.cos(b.yaw), s = Math.sin(b.yaw), u = dx * c - dz * s, v = dx * s + dz * c; return Math.abs(u) < b.w / 2 && Math.abs(v) < b.d / 2; });

  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = [];
  const check = (name, cond, info) => { results.push({ name, ok: !!cond }); console.log(cond ? 'OK ' : 'NG ', name, info ? JSON.stringify(info) : ''); };

  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  page.setDefaultTimeout(600000);
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', (r) =>
    r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
  await page.route('**/src/main.js', async (r) => {
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, world, camera };\n  const qs = new URLSearchParams');
    r.fulfill({ body: t, contentType: 'application/javascript' });
  });
  page.on('pageerror', (e) => console.log('ERR', e.message));
  await page.goto(base + '/?shot&novrm', { timeout: 600000 });
  await page.waitForFunction(() => window.__g && window.__ride && window.__parkSpots, null, { timeout: 600000 });
  const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const fn = () => (++k >= n ? r() : requestAnimationFrame(fn)); requestAnimationFrame(fn); }), n);
  const extIdle = async () => { for (let k = 0; k < 400; k++) { await frames(2); if (await page.evaluate(() => !window.__railext || window.__railext.stats.idle)) return; } console.log('区間の読み込みが終わらない'); };
  const clock = (phase) => page.evaluate((ph) => { window.__showClock = () => 600 * 1000 + ph; }, phase);

  // ---- 1. 設定と地図の印 ----
  const spots = park.spots;
  check('設定に地図の印・園内の通り道がある', spots.length === 13 && park.crowd.lanes.length >= 80, { spots: spots.length, lanes: park.crowd.lanes.length });
  const evNames = await page.evaluate(() => window.__minimap.events.map((e) => e.name));
  check('ミニマップ・大きい地図の印の一覧に園の印が全部入っている', spots.every((s) => evNames.includes(s.name)), evNames.length);
  const hud0 = await page.evaluate(() => document.getElementById('hud-park').hidden);
  check('スタート (戸塚) ではショーの案内が出ていない', hud0 === true);

  // ---- 2. 縮小した大きい地図では細かい印は選べない / ゲートは選べる (遠くから) ----
  const pickAtCenter = (s, zoom) => page.evaluate(([s, zoom]) => { const b = window.__bigmap; b.show(window.__g.player.pos.x, window.__g.player.pos.z); b.cx = s.x; b.cz = s.z; b.scale = zoom; const r = b.canvas.getBoundingClientRect(); return b.pickAt(r.left + innerWidth / 2, r.top + innerHeight / 2); }, [s, zoom]);
  const gate = spots.find((s) => s.kind === 'gate'), ferris = spots.find((s) => s.kind === 'ferris');
  const farGate = await pickAtCenter(gate, 0.2), farFerris = await pickAtCenter(ferris, 0.2), nearFerris = await pickAtCenter(ferris, 1.2);
  check('縮小 (0.2) ではゲートの印は選べるが、観覧車・エリアの印は選べない', farGate.event === gate.name && !farFerris.event && nearFerris.event === ferris.name, { gate: farGate.event, ferrisFar: farFerris.event, ferrisNear: nearFerris.event });
  await page.evaluate(() => window.__bigmap.hide());

  // ---- 3. 印を選んでワープ (戸塚から遠くのゲートへ) ----
  let landed = null;
  const warp = async (s) => {
    const pick = await pickAtCenter(s, 1.6);
    await page.evaluate((pk) => { const b = window.__bigmap; b.target = pk; b.warp(); }, pick);
    const st = await page.evaluate(() => ({ x: window.__g.player.pos.x, y: window.__g.player.pos.y, z: window.__g.player.pos.z, f: window.__g.player.facing, open: window.__bigmap.open }));
    return { pick, st };
  };
  {
    const { pick, st } = await warp(gate);
    check('大きい地図でゲートの印を選ぶとその名前の印として選べる・ワープで地図が閉じ、印の位置に立つ', pick.event === gate.name && !st.open && Math.hypot(st.x - gate.x, st.z - gate.z) < 0.3 && Math.abs(st.f - gate.face) < 0.01, { pick: pick.event, err: +Math.hypot(st.x - gate.x, st.z - gate.z).toFixed(2), open: st.open });
    let built = false;
    for (let k = 0; k < 100 && !built; k++) { await frames(3); await extIdle(); built = await page.evaluate(() => !!window.__g.scene.getObjectByName('park')); }
    check('ワープ先の園内が読み込まれて、park のグループが出る', built);
    await frames(40);
    const now = await page.evaluate(async () => { const p = window.__g.player.pos, H = (await import('/src/terrain.js')).H; return { y: p.y, gh: H(p.x, p.z), x: p.x, z: p.z, nan: ![p.x, p.y, p.z].every(Number.isFinite) }; });
    landed = now;
    check('遠くから跳んでも、地形が読めたら地面に立つ (落ちたままにならない)', !now.nan && Math.abs(now.y - (now.gh + 0.18)) < 0.6 && now.y > -20, { y: +now.y.toFixed(2), ground: +now.gh.toFixed(2) });
  }

  // ---- 4. 13 か所の印を順にワープ: 印の位置に立つ・建物の中ではない・地面に立つ ----
  const bad = [];
  for (const s of spots) {
    const { pick, st } = await warp(s);
    await frames(6); await extIdle(); await frames(10);
    const r = await page.evaluate(async ([s]) => { const p = window.__g.player.pos, w = window.__g.world, H = (await import('/src/terrain.js')).H; return { x: p.x, y: p.y, z: p.z, gh: H(p.x, p.z), inside: w.insideAny ? w.insideAny(p.x, p.z) : false, nan: ![p.x, p.y, p.z].every(Number.isFinite) }; }, [s]);
    const err = Math.hypot(r.x - s.x, r.z - s.z);
    const good = pick.event === s.name && err < 0.6 && !r.inside && !r.nan && Math.abs(r.y - (r.gh + 0.18)) < 1.2;
    if (!good) bad.push({ name: s.name, pick: pick.event, err: +err.toFixed(2), inside: r.inside, dy: +(r.y - r.gh).toFixed(2) });
  }
  check('13 か所の印を選んでワープすると、どれもその場所の地面に立つ (建物の中ではない)', bad.length === 0, bad);

  // ---- 5. 園内の人 ----
  {
    const plaza = spots.find((s) => s.kind === 'plaza');
    await warp(plaza); await frames(6); await extIdle(); await clock(270);   // ショーの無い時刻 (パレードの観客が引いた 255 秒〜花火の観客が集まる前 285 秒)
    await frames(40);
    const c = await page.evaluate(() => { const cr = window.__crowd, sim = cr.sim; return { n: cr.count, view: cr.viewers, park: sim.people.filter((p) => sim.lanes[p.lane].park).length, ppl: sim.people.map((p) => [p.x, p.z, p.type, p.y]), nan: sim.people.some((p) => ![p.x, p.z, p.y, p.yaw].every(Number.isFinite)) }; });
    const outS = c.ppl.filter((p) => !inPoly(p[0], p[1], park.site)).length, inB = c.ppl.filter((p) => inBuilding(p[0], p[1])).length;
    console.log(`  園内の人 ${c.n} 人 (園内の道 ${c.park})  敷地の外 ${outS}  建物の中 ${inB}  観客 ${c.view}`);
    check('プラザに着くと園内の人が出る (15 人以上)・街の通り道の人は混ざらない', c.n >= 15 && c.park === c.n, { n: c.n, park: c.park });
    check('園内の人は敷地の中・建物の外・NaN なし', outS === 0 && inB === 0 && !c.nan, { outS, inB });
    const sel0 = await page.evaluate(() => window.__crowd.sim.viewSel.size);   // 描いている途中 (背が縮んでいる分) を除いた、立つ人の指定
    check('ショーの無い時刻には観客を立たせない (消えていく途中の人は除く)', sel0 === 0, { sel: sel0, view: c.view });
    // ミニマップの人数・時刻: 人数が目標どおり
    const placeTxt = await page.evaluate(() => ({ place: document.getElementById('place').textContent, area: document.getElementById('area').textContent }));
    check('左上の場所の名前が、園内のいちばん近い印の名前になる', /サンライズ・プラザ 付近/.test(placeTxt.place) && /フェアリー・リールパーク/.test(placeTxt.area), placeTxt);
    const hudShow = await page.evaluate(() => ({ hidden: document.getElementById('hud-park').hidden, text: document.getElementById('hud-park').textContent }));
    check('園の近くではショーの案内が出る (パレードまで・花火まで。この時刻 270 秒は城のライトアップ中 = 「城のライトアップ中！」)', !hudShow.hidden && (/城のライトアップ中/.test(hudShow.text) || (/パレードまで/.test(hudShow.text) && /花火まで/.test(hudShow.text))), hudShow);
  }

  // ---- 6. ショーの案内と観客 ----
  {
    const markActive = (kind) => page.evaluate((kind) => { const e = window.__minimap.events.find((q) => q.name.startsWith(kind)); return e ? e.active() : null; }, kind);
    check('ショーの無い時刻は、パレードの印も花火の印も点滅しない', (await markActive('パレード')) === false && (await markActive('ムーンレイク')) === false);
    await clock(10); await frames(8);   // パレードの 10 秒前 (開始は 20 秒)
    const t1 = await page.evaluate(() => ({ text: document.getElementById('hud-park').textContent, soon: document.getElementById('hud-park').classList.contains('soon') }));
    check('始まる前 (10 秒前) は「パレードまで 0:10」で目立つ (soon)・パレードの印が点滅', /パレードまで 0:10/.test(t1.text) && t1.soon && (await markActive('パレード')) === true, t1);
    await clock(20 + 80); await frames(40);
    const t2 = await page.evaluate(() => ({ text: document.getElementById('hud-park').textContent, view: window.__crowd.viewers, mode: window.__crowd.sim.viewerList().map((v) => v.mode), n: window.__crowd.count }));
    console.log(`  パレード中: 案内 ${t2.text}  観客 ${t2.view}  園内の人 ${t2.n}`);
    check('パレード中は「パレード開催中！」・観客が出て手を振る', /パレード開催中/.test(t2.text) && t2.view >= 10 && t2.mode.includes(2), t2);
    check('パレードの最中は印が点滅する', (await markActive('パレード')) === true);
    await clock(330 + 30); await frames(40);
    const t3 = await page.evaluate(() => ({ text: document.getElementById('hud-park').textContent, fwOn: window.__parkInfo.sch.fw.on, mode: window.__crowd.sim.viewerList().map((v) => v.mode) }));
    check('花火中は「花火 開催中！」・花火の印が点滅', /花火 開催中/.test(t3.text) && t3.fwOn && (await markActive('ムーンレイク')) === true, t3);
    await clock(520); await frames(60);
    const t4 = await page.evaluate(() => ({ view: window.__crowd.viewers, text: document.getElementById('hud-park').textContent }));
    check('ショーが終わると観客が消える (背が縮んで消える)', t4.view === 0 && /パレードまで/.test(t4.text), t4);
  }

  // ---- 7. 地図の下絵 (大きい地図に園の絵が描かれる) ----
  {
    const plaza = spots.find((s) => s.kind === 'plaza');
    const px = await page.evaluate((s) => { const b = window.__bigmap; b.show(s.x, s.z); b.cx = s.x; b.cz = s.z; b.scale = 0.35; return null; }, plaza);   // 0.35 px/m: プラザ半径 96 m = 34 px、湖の中心は南へ 208 m = 73 px、敷地の東の外 480 m = 168 px
    await frames(4);
    const col = await page.evaluate(() => { const b = window.__bigmap, c = b.ctx, d = b.dpr || 1, g = (x, y) => Array.from(c.getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data.slice(0, 3)); return { plaza: g(innerWidth / 2 + 12, innerHeight / 2 + 8), lake: g(innerWidth / 2 + 45, innerHeight / 2 + 70), outside: g(innerWidth / 2 + 168, innerHeight / 2) }; });
    const lum = (c) => c[0] + c[1] + c[2];
    check('大きい地図: プラザは明るい色・湖は青 (青が赤より強い)・敷地の外は別の色', lum(col.plaza) > 600 && col.lake[2] > col.lake[0] + 40 && JSON.stringify(col.outside) !== JSON.stringify(col.plaza), col);
    await page.evaluate(() => window.__bigmap.hide());
  }

  // ---- 8. 園から離れるとショーの案内は消える・NaN なし ----
  {
    await page.evaluate(() => { const p = window.__g.player; p.teleport(-306, 1426); });
    await frames(12);
    const far = await page.evaluate(() => ({ hidden: document.getElementById('hud-park').hidden, n: window.__crowd.count, view: window.__crowd.viewers, nan: window.__crowd.sim.people.some((p) => ![p.x, p.z, p.y].every(Number.isFinite)) }));
    check('園から離れる (戸塚へ戻る) とショーの案内が消え、観客はいない・NaN なし', far.hidden === true && far.view === 0 && !far.nan, far);
  }

  // ---- 9. ?nopark: 園の印・案内・観客・下絵が出ない (エラーも出ない) ----
  {
    const errs = [];
    const p2 = await browser.newPage({ viewport: { width: 480, height: 270 } });
    p2.setDefaultTimeout(600000);
    await p2.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', (r) => r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
    await p2.route('**/src/main.js', async (r) => { const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, world, camera };\n  const qs = new URLSearchParams'); r.fulfill({ body: t, contentType: 'application/javascript' }); });
    p2.on('pageerror', (e) => errs.push(e.message));
    await p2.goto(base + '/?shot&novrm&nopark', { timeout: 600000 });
    await p2.waitForFunction(() => window.__g && window.__ride, null, { timeout: 600000 });
    await p2.evaluate(() => new Promise((r) => { let k = 0; const fn = () => (++k >= 20 ? r() : requestAnimationFrame(fn)); requestAnimationFrame(fn); }));
    const np = await p2.evaluate(() => ({ spots: window.__parkSpots.length, info: window.__parkInfo, hud: document.getElementById('hud-park').hidden, ev: window.__minimap.events.some((e) => /ゲート$|パレード/.test(e.name)), park: !!window.__minimap.park, n: window.__crowd.count }));
    check('?nopark: 園の印・案内・下絵が無く、エラーも出ない (街の人は出る)', np.spots === 0 && np.info === null && np.hud === true && !np.ev && !np.park && errs.length === 0, { ...np, errs });
    await p2.close();
  }

  await browser.close(); server.close();
  const badR = results.filter((r) => !r.ok);
  console.log(`\n${results.length - badR.length}/${results.length} OK`);
  process.exit(badR.length ? 1 : 0);
})();
