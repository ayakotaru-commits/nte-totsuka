// イベント「ミズタマンの襲来」(public/src/swarm/event.js) の確認。ゲーム本体を ?swarm で開き、疑似入力で遊ばせて数を集め、画面を撮る。
// 使い方: node tools/dev/swarmcheck.js <出力フォルダ>   (準備は shot.js と同じ。3〜6 分)
//   1. 落ちてくる所 (屋上の縁) の数と高さ、着地点が中庭の中か
//   2. 立ったまま何もしない: 敵が寄ってきて体当たりし、体力が 0 → 門の外へ戻るか
//   3. 近い敵の方を向いて攻撃を連打: 何体倒せるか、クリアまで行くか (時間は 1/30 秒刻みで進める。画面は描かない)
//   4. 画面: 屋上から落ちてくる所 (中庭から見上げる)・群れに囲まれた所・斬った瞬間
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(__dirname, '.cache', 'package');
const VRM_DIR = path.join(__dirname, '.cache', 'vrm', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };

(async () => {
  const [out] = process.argv.slice(2);
  if (!out) { console.error('usage: node tools/dev/swarmcheck.js <出力フォルダ>'); process.exit(1); }
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
  if (fs.existsSync(VRM_DIR)) await page.route('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.3.3/**', r =>
    r.fulfill({ path: path.join(VRM_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.3.3/', '')), contentType: 'application/javascript' }));
  // プレイヤー・カメラ・イベントを外から動かせるように、main.js に 1 行足して読ませる (リポジトリのファイルは変えない)
  await page.route('**/src/main.js', async r => {
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, world, swarm, input, look };\n  const qs = new URLSearchParams');
    r.fulfill({ body: t, contentType: 'application/javascript' });
  });
  page.on('pageerror', e => console.log('ERR', e.message));
  page.on('console', m => { if (/rror/.test(m.text())) console.log('LOG', m.text()); });
  await page.goto(base + '/?shot&swarm', { timeout: 300000 });
  await page.waitForFunction(() => window.__g, null, { timeout: 300000 });
  await page.addStyleTag({ content: '#help{display:none!important}' });
  // 描画を止める (疑似入力で進める間)
  await page.evaluate(() => { const g = window.__g; g.renderSave = g.look.render; g.look.render = () => {}; });

  const res = await page.evaluate(async () => {
    const { SITE, TOTAL } = await import('/src/swarm/event.js');
    const g = window.__g, S = g.swarm, pl = g.player, W = g.world;
    const inPoly = (poly, x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
    const out = {};
    out.spawns = S.spawns.length;
    out.roofY = [Math.min(...S.spawns.map(s => s.y)).toFixed(1), Math.max(...S.spawns.map(s => s.y)).toFixed(1)];
    out.groundY = W.groundAt(SITE.center[0], SITE.center[1], 0).toFixed(1);
    const mk = (keys = [], press = []) => ({ pressed: (k) => press.includes(k), held: (k) => keys.includes(k), ax: 0, az: 0, endFrame() {} });
    const dt = 1 / 30;
    const tick = (inp) => { pl.update(dt, inp, g.cam); S.update(dt); };
    let nan = 0;
    const chk = () => { for (const e of S.list) if (!Number.isFinite(e.x + e.y + e.z)) nan++; if (!Number.isFinite(pl.pos.x + pl.pos.y)) nan++; };

    // 1・2: 何もしない
    const p0 = { x: pl.pos.x, z: pl.pos.z };
    for (let k = 0; k < 2; k++) tick(mk());
    out.started = S.state;
    const landed = []; const seen = new Set();
    let t = 0, firstHit = null, maxAlive = 0;
    while (S.state !== 'idle' && t < 120) {
      tick(mk()); t += dt; chk();
      maxAlive = Math.max(maxAlive, S.list.length);
      for (const e of S.list) if (e.st === 'splat' && !seen.has(e)) { seen.add(e); landed.push([e.x, e.z, e.y, e.ring.x, e.ring.z]); }
      if (firstHit === null && S.hp < 100) firstHit = +t.toFixed(1);
    }
    out.idle = { endedAfter: +t.toFixed(1), firstHitAt: firstHit, maxAlive, landed: landed.length,
      landedInYard: landed.filter(l => inPoly(SITE.yard, l[0], l[1])).length,
      landedHigh: landed.filter(l => l[2] > +out.groundY + 1.2).length,
      ringErr: +(landed.map(l => Math.hypot(l[0] - l[3], l[1] - l[4])).sort((a, b) => a - b)[Math.floor(landed.length / 2)] || 0).toFixed(2),
      backAtGate: +Math.hypot(pl.pos.x - SITE.out[0], pl.pos.z - SITE.out[1]).toFixed(1), dead: pl.dead };

    // 3: 中庭に戻って、近い敵の方を向いて連打
    for (let k = 0; k < 5; k++) tick(mk()); // 門の外にいる (中庭の外に出たので、また始められる)
    pl.teleport(p0.x, p0.z);
    for (let k = 0; k < 3; k++) tick(mk());
    out.restarted = S.state;
    t = 0; let n = 0, maxKilled = 0;
    while (S.state === 'run' && t < 600) {
      // いちばん近い、地上の敵の方を向く
      let best = null, bd = 1e9;
      for (const e of S.list) { if (e.st === 'perch' || e.st === 'fall' || e.st === 'die') continue; const d = Math.hypot(e.x - pl.pos.x, e.z - pl.pos.z); if (d < bd) { bd = d; best = e; } }
      let inp = mk();
      if (best && bd < 2.6) { if (!pl.atk) pl.facing = Math.atan2(best.x - pl.pos.x, best.z - pl.pos.z); inp = mk([], n++ % 6 === 0 ? ['KeyJ'] : []); }
      else if (best) { // 寄っていく
        const a = Math.atan2(best.x - pl.pos.x, best.z - pl.pos.z); g.cam.yaw = a + Math.PI; inp = mk(['KeyW']);
      }
      tick(inp); t += dt; chk();
      maxKilled = Math.max(maxKilled, S.killed || 0);
    }
    out.fight = { state: S.state, secs: +t.toFixed(1), killed: maxKilled, total: TOTAL, hpLeft: S.hp, time: +(S.time || 0).toFixed(1), banner: document.getElementById('swarm-banner').textContent };
    out.nan = nan;
    return out;
  });
  console.log(JSON.stringify(res, null, 1));

  // 4: 画面
  const shots = [
    { name: 'fall', run: 2.2, cam: [-232, 1.5, 1452, -232, 9, 1440] },   // 中庭から南の棟の屋上を見上げる
    { name: 'swarm', run: 14, follow: true },
    { name: 'hit', run: 9, follow: true, atk: true },
  ];
  for (const s of shots) {
    await page.evaluate(async (s) => {
      const g = window.__g, S = g.swarm, pl = g.player;
      const { Swarm } = await import('/src/swarm/event.js');
      S.update = Swarm.prototype.update;                       // 前の撮影で止めたのを戻す
      g.cam.update = Object.getPrototypeOf(g.cam).update;
      S.stop(false); S.armed = true;
      const mk = (keys = [], press = []) => ({ pressed: (k) => press.includes(k), held: (k) => keys.includes(k), ax: 0, az: 0, endFrame() {} });
      pl.revive(); pl.teleport(-240, 1450); pl.facing = Math.PI / 2;
      pl.update(1 / 30, mk(), g.cam); S.update(1 / 30); // 始まる
      S.hp = 1e9;
      const n = Math.round(s.run * 30);
      for (let k = 0; k < n; k++) {
        let inp = mk();
        if (s.atk && k >= n - 40) {
          let best = null, bd = 1e9;
          for (const e of S.list) { if (e.st !== 'chase' && e.st !== 'wind') continue; const d = Math.hypot(e.x - pl.pos.x, e.z - pl.pos.z); if (d < bd) { bd = d; best = e; } }
          if (best && !pl.atk) pl.facing = Math.atan2(best.x - pl.pos.x, best.z - pl.pos.z);
          if (k === n - 40) inp = mk([], ['KeyJ']);
        }
        pl.update(1 / 30, inp, g.cam); S.update(1 / 30);
        if (s.atk && k > n - 40 && S.list.some(e => e.tint > 0.6)) break; // 斬った瞬間で止める
      }
      g.look.render = g.renderSave;
      if (s.cam) {
        g.cam.update = () => {};
        const c = g.cam.camera, gy = g.world.groundAt(s.cam[0], s.cam[2], 0);
        c.position.set(s.cam[0], gy + s.cam[1], s.cam[2]); c.lookAt(s.cam[3], gy + s.cam[4], s.cam[5]);
      } else {
        g.cam.yaw = pl.facing + Math.PI + 0.5; g.cam.pitch = 0.35; g.cam.dist = 7; g.cam.update(0, pl.pos, true);
      }
      // 撮影の間は止める (描画だけ続く)
      const pu = pl.update; pl.update = () => {}; g.restorePl = () => { pl.update = pu; };
      S.update = () => { S.herd.flush(); };
    }, s);
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(out, s.name + '.png'), timeout: 300000 });
    console.log('ok', path.join(out, s.name + '.png'));
    await page.evaluate(() => { const g = window.__g; g.look.render = () => {}; g.restorePl(); });
  }
  await browser.close();
  server.close();
})();
