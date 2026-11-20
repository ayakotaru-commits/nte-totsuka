// イベント「お札まき 合いの手」(public/src/rhythm/event.js) の確認。ゲーム本体を開き、時計を差し替えて疑似入力で遊ばせ、画面を撮る。
// 使い方: node tools/dev/rhythmcheck.js <出力フォルダ>   (準備は shot.js と同じ。5〜8 分)
//   1. 譜面: 返す拍の数・曲の長さ
//   2. 打ち方ごとの結果 (時計を 1/30 秒ずつ進め、拍の時刻 + ずれ で打つ): ちょうど / +0.05 / -0.1 / +0.1 / 打たない / 連打 / ±0.06 のばらつき
//   3. 結果の表示から Y でもう一回・N でやめる (その場から動けるようになる)
//   4. 本物のキー (Space) とタップ (pointerdown) が打つ扱いになるか、ボタンを押しても打つ扱いにならないか
//   5. 参加するか聞く表示: 境内に入ると出る・N で閉じる・出て入り直すとまた出る・Y で始まる
//   6. 画面: ?rhythm=auto (自動で打つ) で曲の途中を数枚と結果
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
  const noShots = process.argv.includes('--noshots');
  if (!out) { console.error('usage: node tools/dev/rhythmcheck.js <出力フォルダ> [--noshots]'); process.exit(1); }
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
  const open = async (q) => {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    page.setDefaultTimeout(300000);
    await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r =>
      r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
    if (fs.existsSync(VRM_DIR)) await page.route('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.3.3/**', r =>
      r.fulfill({ path: path.join(VRM_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.3.3/', '')), contentType: 'application/javascript' }));
    await page.route('**/src/main.js', async r => {
      const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, world, rhythm, input, look };\n  const qs = new URLSearchParams');
      r.fulfill({ body: t, contentType: 'application/javascript' });
    });
    page.on('pageerror', e => console.log('ERR', e.message));
    page.on('console', m => { if (/rror/.test(m.text())) console.log('LOG', m.text()); });
    await page.goto(base + '/' + q, { timeout: 300000 });
    await page.waitForFunction(() => window.__g, null, { timeout: 300000 });
    await page.addStyleTag({ content: '#help{display:none!important}' });
    return page;
  };

  // ---- 1〜5: 描画を止め、時計を差し替えて進める ----
  const page = await open('?shot&rhythm');
  await page.evaluate(() => { const g = window.__g; g.look.render = () => {}; });
  const res = await page.evaluate(async () => {
    const M = await import('/src/rhythm/event.js');
    const g = window.__g, R = g.rhythm, pl = g.player;
    let T = 1000; R.clock = () => T;                      // 差し替えた時計
    const mk = (press = []) => ({ pressed: (k) => press.includes(k), held: () => false, ax: 0, az: 0, endFrame() {} });
    const dt = 1 / 30;
    let nan = 0;
    const tick = (inp = mk()) => { T += dt; R.update(dt, inp); pl.update(dt, inp, g.cam); if (!Number.isFinite(pl.pos.x + pl.pos.y + pl.pos.z)) nan++; };
    const out = {};
    tick();
    out.autoStarted = R.state;
    out.nTargets = R.chart.targets.length;
    out.songSec = +(Math.max(...R.chart.targets.map(t => t.t))).toFixed(2);
    out.kinds = R.chart.targets.reduce((a, t) => (a[t.kind] = (a[t.kind] || 0) + 1, a), {});
    // 手本の小節の最後の打ちから、返す小節の 1 打目までの間 (秒)。いちばん短いもの
    { const bars = [...new Set(R.chart.calls.filter(c => c.kind !== 'final').map(c => c.bar))];
      const B = 4 * 60 / M.BPM, gaps = bars.map(b => { const last = Math.max(...R.chart.calls.filter(c => c.bar === b).map(c => c.t)); const first = Math.min(...R.chart.targets.filter(g => g.bar === b + 1).map(g => g.t)); return first - last; });
      out.minGapCallToResp = +Math.min(...gaps).toFixed(2); out.beatSec = +(B / 4).toFixed(3); }
    // 1 曲を、決まった打ち方で通す
    const run = (how) => {
      if (R.state !== 'play') { R.answer = 'yes'; tick(); }
      // 音の準備を待つ間 (この確認では音が出ないので AUDIO_WAIT 秒待って、音なしで始まる)
      let w = 0; while (R.t0 == null && w++ < 200) tick();
      out.waitSec = +(w * dt).toFixed(2);
      const tg = R.chart.targets, hits = [];
      if (how.mash) for (let t = 0; t < 31; t += how.mash) hits.push(t);
      else if (how.off != null || how.jit != null) for (const x of tg) hits.push(x.t + (how.off || 0) + (how.jit ? (Math.random() * 2 - 1) * how.jit : 0));
      hits.sort((a, b) => a - b);
      let i = 0, guard = 0;
      while (R.state === 'play' && guard++ < 3000) {
        tick();
        while (i < hits.length && R.t0 + hits[i] <= T) R.hit(R.t0 + hits[i++]);
      }
      const L = R.last || {};
      return { state: R.state, rank: L.rank, good: L.good, ok: L.ok, miss: L.miss, n: L.n, score: L.score && +L.score.toFixed(2),
        resultShown: !document.getElementById('rh-result').hidden, playerLocked: !!pl.perf };
    };
    out.exact = run({ off: 0 });
    out.late05 = run({ off: 0.05 });
    out.early10 = run({ off: -0.1 });
    out.late10 = run({ off: 0.1 });
    out.none = run({});
    out.mash = run({ mash: 0.09 });
    out.jitter06 = run({ off: 0, jit: 0.06 });
    // 3. 結果から N でやめる → 動ける
    R.answer = 'no'; tick();
    out.afterQuit = { state: R.state, perf: !!pl.perf, crowdVisible: R.crowd.some(c => c.root.visible), hud: !document.getElementById('rh-hud').hidden };
    const x0 = pl.pos.x, z0 = pl.pos.z; for (let k = 0; k < 15; k++) tick({ ...mk(), held: (k) => k === 'KeyW' });
    out.movedAfterQuit = +Math.hypot(pl.pos.x - x0, pl.pos.z - z0).toFixed(2);
    // 4. 本物のキー・タップ (時計は本物に戻す)
    delete R.clock;
    pl.teleport(...window.__rhythmSite.me);
    R.state = 'idle'; R.armed = true;
    const tick2 = (inp = mk()) => { R.update(dt, inp); pl.update(dt, inp, g.cam); };
    tick2(); // 境内 → 聞く
    out.askShown = R.state === 'ask' && !document.getElementById('rh-ask').hidden;
    tick2(mk(['KeyN']));
    out.afterN = R.state;
    tick2(); out.noReask = R.state;
    pl.teleport(-386, 590); tick2(); // 境内の外
    pl.teleport(...window.__rhythmSite.me); tick2();
    out.reask = R.state;
    tick2(mk(['KeyY']));
    out.afterY = R.state;
    const judged = () => R.chart.targets.filter(t => t.res).length;
    let j0 = judged(), lm0 = R.lastMe;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    out.spaceCounts = R.lastMe !== lm0;
    lm0 = R.lastMe;
    document.getElementById('rh-tap').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    out.tapCounts = R.lastMe !== lm0;
    lm0 = R.lastMe;
    document.getElementById('rh-again').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    out.buttonNotHit = R.lastMe === lm0;
    out.nan = nan;
    R.stop();
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(res, null, 1));
  await page.close();

  // ---- 6: 画面。描画が遅い (1 コマ 1〜2 秒) ので、時計を差し替えて曲の決まった瞬間で止めて撮る (自動で打つ) ----
  if (!noShots) {
    const p2 = await open('?shot&rhythm=auto');
    await p2.evaluate(() => { const R = window.__g.rhythm; window.__T = 5000; R.clock = () => window.__T; R.stop(); R.autoPlay = true; R.start();
      while (R.t0 == null) { window.__T += 0.05; R.update(0.05, null); } });
    // [名前, 曲の頭からの秒 (関数で譜面から決める)]
    const moments = [['01_call', 'c => c.calls.find(x => x.bar === 3).t + 0.03'], ['01b_cue', 'c => 3 * 4 * 60 / 107 + 6.6 * 60 / 214'], ['02_resp', 'c => c.targets.find(x => x.bar === 4).t + 0.03'],
      ['03_ofuda', 'c => c.targets.find(x => x.kind === "rush" && x.bar === 12).t + 0.25'], ['04_lift', 'c => 18 * 4 * 60 / 107 + 3.4 * 60 / 107'],
      ['05_final', 'c => 19 * 4 * 60 / 107 + 0.35'], ['06_result', 'c => 20 * 4 * 60 / 107 + 2']];
    for (const [n, f] of moments) {
      const st = await p2.evaluate((f) => {
        const R = window.__g.rhythm, at = eval(f)(R.chart);
        // 0.05 秒ずつ進めて (お札が舞う・判定が進む)、その瞬間で止める
        let T = window.__T;
        while (T < R.t0 + at) { T = Math.min(R.t0 + at, T + 0.05); window.__T = T; R.update(0.05, null); }
        return { state: R.state, t: +(T - R.t0).toFixed(2), judged: R.chart.targets.filter(t => t.res).length };
      }, f);
      await p2.waitForTimeout(6000); // 描画が追いつくまで
      await p2.screenshot({ path: path.join(out, `shot${n}.png`) });
      console.log('shot', n, JSON.stringify(st));
    }
    await p2.close();
  }
  await browser.close(); server.close();
})();
