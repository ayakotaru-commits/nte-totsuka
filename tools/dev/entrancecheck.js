// 千葉ドリームランドの入口 (エントランス。detail/parkentrance.js) を、キャラを歩かせて確かめる (疑似入力。画面は撮らない)。
// 使い方: node tools/dev/entrancecheck.js [--touch]   (約 3〜6 分。--touch = スマホの設定 = 軽い版)
// 確かめること: 入口の部品が出る・地面が平ら / 柵の隙間から前庭 → 中央の大門 → 内庭へ歩いて入れる / 改札のレーン (左右 4 本ずつ) を通れる /
//   仕切り・塔・端の小屋・切符売り場・案内所・築山・大門の柱にぶつかる (通り抜けない) / 前庭の壁を回って内側へ入れない (走っても) / 地図の「ゲート」のワープ先が前庭 / NaN なし
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
  const { entranceFrame, entranceLayout, wingWalls } = await import(path.join(PUBLIC, 'src', 'detail', 'parkentrancegeo.js'));
  const F = entranceFrame(park), LY = entranceLayout(park), WW = wingWalls(park), E = park.entrance, H = E.hall;
  const W = (u, v) => F.W(u, v);
  const touch = process.argv.includes('--touch');

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
  page.on('console', (m) => { if (/\[park\] 入口/.test(m.text())) console.log('LOG', m.text()); });
  await page.goto(base + '/?shot&novrm&nocrowd' + (touch ? '&touch' : ''), { timeout: 600000 });
  await page.waitForFunction(() => window.__g && window.__ride, null, { timeout: 600000 });
  const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const fn = () => (++k >= n ? r() : requestAnimationFrame(fn)); requestAnimationFrame(fn); }), n);
  const extIdle = async () => { for (let k = 0; k < 400; k++) { await frames(2); if (await page.evaluate(() => !window.__railext || window.__railext.stats.idle)) return; } console.log('区間の読み込みが終わらない'); };
  const hAt = (x, z) => page.evaluate(async ([x, z]) => (await import('/src/terrain.js')).H(x, z), [x, z]);
  await page.evaluate(() => {
    window.__walkXZ = (pts, opt = {}) => {
      const g = window.__g, pl = g.player, dt = 1 / 30, out = [];
      const mk = (keys) => ({ pressed: () => false, held: (k) => keys.includes(k), ax: 0, az: 0, endFrame() {} });
      pl.walkMode = !!opt.walk;
      for (const [tx, tz] of pts) {
        let ok = false, k = 0, minY = 1e9, maxY = -1e9;
        for (; k < (opt.maxT || 40) / dt; k++) {
          const dx = tx - pl.pos.x, dz = tz - pl.pos.z, d = Math.hypot(dx, dz);
          if (d < (opt.tol || 0.6)) { ok = true; break; }
          g.cam.yaw = Math.atan2(dx, dz) + Math.PI;
          pl.update(dt, mk(['KeyW']), g.cam);
          if (!Number.isFinite(pl.pos.x + pl.pos.y + pl.pos.z)) return { nan: true, out };
          if (pl.pos.y < minY) minY = pl.pos.y; if (pl.pos.y > maxY) maxY = pl.pos.y;
        }
        for (let j = 0; j < 20; j++) pl.update(dt, mk([]), g.cam);
        out.push({ ok, at: [+pl.pos.x.toFixed(2), +pl.pos.z.toFixed(2)], y: +pl.pos.y.toFixed(2), jump: +(maxY - minY).toFixed(2) });
        if (!ok && !opt.keepGoing) break;
      }
      pl.walkMode = false;
      return { out };
    };
  });
  // 局所座標で置く・歩く
  const place = async (u, v) => { const [x, z] = W(u, v), y = await hAt(x, z); await page.evaluate(([x, y, z]) => window.__ride.place(x, y + 0.12, z, 0), [x, y, z]); await frames(page, 2); await frames(2); };
  const walk = (pts, opt = {}) => page.evaluate(([p, o]) => window.__walkXZ(p, o), [pts.map(([u, v]) => W(u, v)), opt]);
  const dist = (o, u, v) => { const [x, z] = W(u, v); return Math.hypot(o.at[0] - x, o.at[1] - z); };
  const lv = (o) => F.L(o.at[0], o.at[1]);   // 止まった所の局所座標

  // 入口の近くに置いて、区間 (地形) の読み込みと入口の組み立てを待つ
  await place(0, 60);
  for (let k = 0; k < 80; k++) { await frames(3); await extIdle(); if (await page.evaluate(() => !!window.__g.scene.getObjectByName('park_entrance'))) break; }
  await frames(10);
  const info = await page.evaluate(() => { const g = window.__g.scene.getObjectByName('park_entrance'); if (!g) return null; let meshes = 0, tris = 0; g.traverse((o) => { if (o.isMesh) { meshes++; const gg = o.geometry; tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } }); return { meshes, tris: Math.round(tris) }; });
  check('入口の部品が出ている (park_entrance)', info && info.meshes >= 20, info);
  const gy = await hAt(...W(0, 0));
  const flat = [];
  for (const [u, v] of [[0, 60], [-50, 30], [50, 30], [0, -14], [56, 20], [-56, 40], [25, 80]]) flat.push(+(await hAt(...W(u, v)) - gy).toFixed(2));
  check('入口のまわりの地面が平ら (±0.25 m)', flat.every((d) => Math.abs(d) < 0.25), flat);

  // ---- 通れる ----
  const gapW = F.L(park.fence.gaps[0][0], park.fence.gaps[0][1]);
  await place(gapW[0], gapW[1] + 8);
  let r = await walk([[gapW[0], gapW[1] - 6], [-4, 44], [0, 31], [0, 18], [0, 6], [0, -2]], { maxT: 30, tol: 1.2 });
  check('柵の隙間から前庭へ入り、中央の大門を通って内庭まで歩ける', !r.nan && r.out.length === 6 && r.out.every((q) => q.ok), r.out.map((q) => q.ok));
  await place(0, 40);
  r = await walk([[0, 24], [0, 18], [0, 6]], { maxT: 20, tol: 1.0 });
  check('大門の開きの真ん中を、走って通り抜けられる', !r.nan && r.out.length === 3 && r.out.every((q) => q.ok && q.jump < 0.6), r.out);
  const laneIdx = [0, 5, 10, 15];
  for (const s of [-1, 1]) {
    for (const k of laneIdx) {
      const u = s * (H.laneFrom + (k + 0.5) * H.pitch);
      await place(u, 30);
      r = await walk([[u, 18], [u, 6]], { maxT: 15, tol: 0.8 });
      check(`改札のレーン ${s < 0 ? '左' : '右'} ${k + 1} 番を歩いて通れる (走っても)`, !r.nan && r.out.length === 2 && r.out.every((q) => q.ok && q.jump < 0.6), r.out.map((q) => [q.ok, q.at, q.jump]));
    }
  }

  // ---- ぶつかる ----
  // 仕切り (レーンの境) を横切ろうとすると止まる
  const u5 = H.laneFrom + 5.5 * H.pitch;
  await place(u5, 18);
  r = await walk([[u5 + H.pitch * 3, 18]], { maxT: 8, keepGoing: true, tol: 0.3, walk: true });
  check('改札の仕切りを横切ろうとすると止まる', !r.nan && !r.out[0].ok && Math.abs(lv(r.out[0])[0] - u5) < H.pitch, r.out[0]);
  // 走って仕切りに向かっても、飛び越えない
  await place(u5, 18);
  r = await walk([[u5 + H.pitch * 3, 18]], { maxT: 8, keepGoing: true, tol: 0.3 });
  check('走って仕切りに向かっても、飛び越えたりよじ登ったりしない', !r.nan && !r.out[0].ok && Math.abs(lv(r.out[0])[0] - u5) < H.pitch && r.out[0].jump < 1.0, r.out[0]);
  // 大門の左右の柱 (開きの外側)
  await place(H.open + 3, 32);
  r = await walk([[H.open + 3, 14]], { maxT: 12, keepGoing: true, tol: 0.3, walk: true });
  check('大門の柱 (開きの外側) にぶつかって止まる', !r.nan && !r.out[0].ok && lv(r.out[0])[1] > H.v + H.depth / 2 - 0.2, r.out[0]);
  // 塔
  await place(H.towerU, 36);
  r = await walk([[H.towerU, vc(H)]], { maxT: 12, keepGoing: true, tol: 0.3, walk: true });
  check('塔の根元で止まる (中に入れない)', !r.nan && !r.out[0].ok && dist(r.out[0], H.towerU, H.v) > H.towerR - 0.3 && dist(r.out[0], H.towerU, H.v) < H.towerR + 1.5, r.out[0]);
  // 端の小屋
  await place(H.half - 3, 40);
  r = await walk([[H.half - 3, 12]], { maxT: 12, keepGoing: true, tol: 0.3, walk: true });
  check('端の小屋 (右) の壁で止まる', !r.nan && !r.out[0].ok && lv(r.out[0])[1] > H.v + H.depth / 2 - 0.2, r.out[0]);
  // 切符売り場
  const bu = LY.booths[3];
  await place(bu.u, 44);
  r = await walk([[bu.u, 33]], { maxT: 12, keepGoing: true, tol: 0.3, walk: true });
  check('切符売り場の前で止まる (中に入れない)', !r.nan && !r.out[0].ok && lv(r.out[0])[1] > E.booths.v + E.booths.d / 2 - 0.1, r.out[0]);
  // 築山
  await place(0, 2);
  r = await walk([[0, E.berm.v]], { maxT: 12, keepGoing: true, tol: 0.3, walk: true });
  check('花の築山の縁で止まる (真ん中へは歩いて入れない)', !r.nan && !r.out[0].ok && lv(r.out[0])[1] > E.berm.v + E.berm.rz - 0.2, r.out[0]);
  // 案内所
  const k0 = E.kiosks[1];
  await place(k0.u, k0.v - 9);
  r = await walk([[k0.u, k0.v]], { maxT: 12, keepGoing: true, tol: 0.3, walk: true });
  check('案内所の壁で止まる', !r.nan && !r.out[0].ok && lv(r.out[0])[1] < k0.v - k0.d / 2 + 0.2, r.out[0]);

  // ---- 前庭を囲む壁: 広間の外側を回って内側へ入れない (歩いても、走っても) ----
  const tryAcross = async (name, from, to, walkMode) => {
    await place(...from);
    const q = await walk([to], { maxT: 25, keepGoing: true, tol: 1.0, walk: walkMode });
    check(name, !q.nan && !q.out[0].ok && q.out[0].jump < 1.2, { from, to, at: lv(q.out[0]), jump: q.out[0].jump });
  };
  const rw = WW.rightL, lw = WW.leftL;
  const midR = [(rw[0][0] + rw[1][0]) / 2, (rw[0][1] + rw[1][1]) / 2], midL = [(lw[0][0] + lw[1][0]) / 2, (lw[0][1] + lw[1][1]) / 2];
  const nR = [-(rw[1][1] - rw[0][1]), rw[1][0] - rw[0][0]], lR = Math.hypot(...nR);   // 右の壁の法線 (前庭の側が + になるよう後で向きを決める)
  const sideR = Math.sign(nR[0] * (0 - midR[0]) + nR[1] * (45 - midR[1]));              // 前庭 (0, 45) がある側
  const nr = [nR[0] / lR * sideR, nR[1] / lR * sideR];
  await tryAcross('右の壁を、前庭の側から内側へ歩いて越えられない', [midR[0] + nr[0] * 5, midR[1] + nr[1] * 5], [midR[0] - nr[0] * 12, midR[1] - nr[1] * 12], true);
  await tryAcross('右の壁を、前庭の側から内側へ走っても越えられない', [midR[0] + nr[0] * 5, midR[1] + nr[1] * 5], [midR[0] - nr[0] * 12, midR[1] - nr[1] * 12], false);
  await tryAcross('左の壁を、前庭の側から外へ歩いて越えられない', [midL[0] + 5, midL[1]], [midL[0] - 12, midL[1]], true);
  await tryAcross('左の壁を、前庭の側から外へ走っても越えられない', [midL[0] + 5, midL[1]], [midL[0] - 12, midL[1]], false);

  // ---- 地図 ----
  const sp = park.spots.find((q) => q.kind === 'gate');
  const spL = F.L(sp.x, sp.z);
  check('地図の「ゲート」のワープ先が前庭の中央 (改札の手前)', sp && Math.abs(spL[0]) < 2 && spL[1] > H.v + H.depth / 2 + 8 && spL[1] < 60, spL);
  check('NaN なし', !results.some((q) => q.nan));

  await browser.close(); server.close();
  const bad = results.filter((q) => !q.ok);
  console.log(`\n${results.length - bad.length}/${results.length} OK`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

function vc(H) { return H.v; }
