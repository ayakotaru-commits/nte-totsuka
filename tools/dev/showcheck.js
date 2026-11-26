// 千葉ドリームランド 段階 4 (ショー・夜・音) の確認。ゲームを開き、ショーの更新を時計を差し替えて直接呼んで調べる (画面は撮らない)。
// 使い方: node tools/dev/showcheck.js   (3〜6 分。three.js は tools/dev/.cache/package に要る)
// 確かめること: ショーが作られる / 昼は見えず夜は見える / パレードの山車が道の上を進み、前後は隠れる / 花火が決まった時刻に出て、音の知らせが出る /
//   同じ時刻なら同じ形 / 窓が夜に光る / 曲 (mp3) が読めて長さが合う / 音量が距離で変わる / NaN が無い
const { chromium } = require('playwright');
const fs = require('fs'), http = require('http'), path = require('path');
const PUBLIC = path.resolve(__dirname, '..', '..', 'public'), THREE_DIR = path.join(__dirname, '.cache', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png' };
(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const park = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'park.json')));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const results = [];
  const check = (name, cond, info) => { results.push({ name, ok: !!cond }); console.log(cond ? 'OK ' : 'NG ', name, info ? JSON.stringify(info) : ''); };
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  page.setDefaultTimeout(600000);
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r => r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
  await page.route('**/src/main.js', async r => { const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, world, camera };\n  const qs = new URLSearchParams'); r.fulfill({ body: t, contentType: 'application/javascript' }); });
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto(base + '/?shot&novrm&t=2', { timeout: 600000 });
  await page.waitForFunction(() => window.__g && window.__ride, null, { timeout: 600000 });
  const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const fn = () => (++k >= n ? r() : requestAnimationFrame(fn)); requestAnimationFrame(fn); }), n);
  const [px, pz] = park.ellipses['サンライズ・プラザ'].center;
  await page.evaluate(([x, z]) => window.__ride.place(x, -11, z, 0), [px, pz]);
  for (let k = 0; k < 80; k++) { await frames(3); if (await page.evaluate(() => !!window.__pride.park.show)) break; }
  const S = await page.evaluate(() => { const s = window.__pride.park.show; return s && s.stats; });
  check('ショーが作られる (stats)', S && S.floats === 6 && S.bursts > 40 && S.jets === 12 && S.routeLen > 400 && S.routeLen < 900, S);
  const R = await page.evaluate(([px, pz, cfg]) => {
    const pk = window.__pride.park, s = pk.show, F = cfg.show.fireworks, P = cfg.show.parade, out = {};
    const at = (phase, win, x = px, z = pz) => { window.__showClock = () => 600000 + phase; s.update(600000 + phase, x, z, win); };
    const vis = () => s.floats.filter((f) => f.g.visible).length;
    const fwObj = () => s.group.children.find((o) => o.isPoints && o.material.size > 5);
    // パレード
    at(5, 1.3); out.paradeBefore = vis();
    at(P.start + 60, 1.3); out.paradeMid = vis(); out.paradeLead = s.paradeLead();
    const poss = s.floats.filter((f) => f.g.visible).map((f) => [f.g.position.x, f.g.position.z]);
    const R = s.route; out.maxDevFromRoute = Math.max(...poss.map(([x, z]) => Math.min(...R.map((r) => Math.hypot(r[0] - x, r[1] - z)))));
    out.finite = poss.every((p) => p.every(Number.isFinite));
    at(P.start + s.stats.paradeSeconds + 20, 1.3); out.paradeAfter = vis();
    // 昼は花火・噴水・湖のきらめきが見えない / 夜は見える
    const fwT = F.start + 12.5; at(fwT, 0); const fw = fwObj();
    out.dayFw = fw.material.opacity; const sheen = s.group.children.find((o) => o.isMesh && o.material.blending === 2 && o.geometry.type === 'PlaneGeometry');
    out.dayJets = s.group.children.filter((o) => o.isInstancedMesh && o.material.transparent)[0].visible;
    at(fwT, 1.3); out.nightFw = fw.material.opacity; out.fwVisible = fw.visible;
    out.nightJets = s.group.children.filter((o) => o.isInstancedMesh && o.material.transparent)[0].visible;
    // 花火: 打ち上がっている粒が地面より上にある・NaN なし
    const pos = fw.geometry.attributes.position.array; let up = 0, bad = 0; for (let i = 0; i < pos.length; i += 3) { if (!Number.isFinite(pos[i]) || !Number.isFinite(pos[i + 1])) bad++; else if (pos[i + 1] > -100 && pos[i + 1] > -9000) up++; }
    out.fwParticles = up; out.fwBad = bad;
    // 同じ時刻なら同じ形
    const a = Array.from(pos.slice(0, 600)); at(fwT, 1.3); const b = Array.from(fw.geometry.attributes.position.array.slice(0, 600)); out.same = JSON.stringify(a) === JSON.stringify(b);
    // 音の知らせ: 時計を進めて、爆発と打ち上げの時刻をまたぐ
    s.takeEvents(); at(F.start + 2.8, 1.3); s.takeEvents();
    let n = { launch: 0, burst: 0 }; for (let t = F.start + 2.8; t < F.start + 40; t += 0.1) { at(t, 1.3); for (const e of s.takeEvents()) n[e.kind]++; }
    out.events = n; out.planIn40 = s.plan.filter((b2) => b2.t < 40 && b2.t > 2.8).length;
    at(F.start + F.duration + 30, 1.3); out.fwAfter = fw.visible;
    return out;
  }, [px, pz, park]);
  check('パレード: 始まる前は山車が出ていない', R.paradeBefore === 0, R.paradeBefore);
  check('パレード: 途中は山車が 2 台以上出て、道の上 (1 m 以内) を進む', R.paradeMid >= 2 && R.maxDevFromRoute < 1.0 && R.finite, { n: R.paradeMid, dev: R.maxDevFromRoute });
  check('パレード: 先頭の山車の位置が取れる (音の追いかけ用)', R.paradeLead && Number.isFinite(R.paradeLead.x), R.paradeLead);
  check('パレード: 終わったあとは山車が出ていない', R.paradeAfter === 0, R.paradeAfter);
  check('昼は花火・噴水が見えない / 夜は見える', R.dayFw === 0 && R.dayJets === false && R.nightFw > 0.3 && R.fwVisible && R.nightJets === true, { dayFw: R.dayFw, nightFw: R.nightFw, dayJets: R.dayJets, nightJets: R.nightJets });
  check('花火: 粒が打ち上がっていて NaN が無い', R.fwParticles > 100 && R.fwBad === 0, { up: R.fwParticles, bad: R.fwBad });
  check('花火: 同じ時刻なら同じ形', R.same);
  check('花火: 音の知らせが、予定の発数どおり出る (打ち上げ・爆発)', R.events.launch === R.planIn40 && R.events.burst >= R.planIn40 - 2, { events: R.events, plan: R.planIn40 });
  check('花火: ショーが終わったら出ていない', R.fwAfter === false, R.fwAfter);
  // 窓の光 (夜): 材質を数える
  const W = await page.evaluate(() => { let lit = 0, tot = 0; window.__g.scene.getObjectByName('park').traverse((o) => { if (o.material && o.material.emissiveMap && o.material.userData.glow === 0.55) { tot++; if (o.material.emissiveIntensity > 0.3) lit++; } }); return { lit, tot }; });
  await frames(5);
  const W2 = await page.evaluate(() => { let lit = 0, tot = 0; window.__g.scene.getObjectByName('park').traverse((o) => { if (o.material && o.material.emissiveMap && o.material.userData.glow === 0.55) { tot++; if (o.material.emissiveIntensity > 0.3) lit++; } }); return { lit, tot }; });
  check('夜: 建物の窓が光る (壁の材質の emissiveIntensity)', W2.tot > 0 && W2.lit === W2.tot, W2);
  // 曲
  const pa = async () => page.evaluate(([px, pz]) => { const a = window.__parkaudio; a.update(px, pz, 600000); return { st: a.state, tracks: Object.fromEntries(Object.entries(a.tracks).map(([k, t]) => [k, { buf: t.buf ? t.buf.duration : null, failed: t.failed }])) }; }, [px, pz]);
  let A = await pa(); for (let k = 0; k < 40 && !(A.tracks.theme && A.tracks.theme.buf); k++) { await page.waitForTimeout(500); A = await pa(); }
  check('曲: ほしぞらワルツ (mp3) を読めて、長さが 69.2 秒 (±0.3)', A.tracks.theme && A.tracks.theme.buf && Math.abs(A.tracks.theme.buf - 69.23) < 0.3, A.tracks.theme);
  check('曲: プラザの中央では園内の曲の音量が 0 より大きい', A.st.theme > 0.2, A.st);
  const far = await page.evaluate(([px, pz]) => { const a = window.__parkaudio; a.update(px + 2000, pz, 600000); return a.state; }, [px, pz]);
  check('曲: 2 km 離れると園内の曲は 0', far.theme === 0, far);
  const nearP = await page.evaluate(([px, pz, cfg]) => { const s = window.__pride.park.show, a = window.__parkaudio; const P = cfg.show.parade; const t = 600000 + P.start + 60; window.__showClock = () => t; s.update(t, px, pz, 1); const l = s.paradeLead(); a.update(l.x, l.z, t); return a.state; }, [px, pz, park]);
  check('曲: パレードの先頭の山車のそばでは、パレードの曲が鳴り、園内の曲は小さくなる', nearP.parade > 0.2 && nearP.ducked < 0.5, nearP);
  let A2 = await pa(); for (let k = 0; k < 30 && !(A2.tracks.parade && A2.tracks.parade.buf); k++) { await page.evaluate(([cfg]) => { const s = window.__pride.park.show, t = 600000 + cfg.show.parade.start + 60, l = s.paradeLead(); window.__parkaudio.update(l.x, l.z, t); }, [park]); await page.waitForTimeout(500); A2 = await pa(); }
  check('曲: パレードのマーチ (mp3) を読めて、長さが 78.6 秒 (±0.3)', A2.tracks.parade && A2.tracks.parade.buf && Math.abs(A2.tracks.parade.buf - 78.62) < 0.3, A2.tracks.parade);
  await page.evaluate(() => { delete window.__showClock; });
  await browser.close(); server.close();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} OK`);
  process.exit(bad.length ? 1 : 0);
})();
