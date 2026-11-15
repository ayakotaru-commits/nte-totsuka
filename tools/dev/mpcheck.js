// マルチプレイの確認。手元のサーバー (server/local.js) を立て、ヘッドレスブラウザ 2 つで同じ部屋に入り、
// 「お互いが見える・動きが伝わる・戦闘オン同士で当たる・倒れて復活する」を数字で確かめ、画面を 1 枚ずつ撮る。
// 使い方: (cd server && npm install) の後、 node tools/dev/mpcheck.js <出力フォルダ>   (準備は shot.js と同じ。約 6 分)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), PUBLIC = path.join(ROOT, 'public'), THREE_DIR = path.join(__dirname, '.cache', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
const OUT = process.argv[2] || '.', WS_PORT = 8791;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// cond が true になるまで待つ (最大 ms)。この環境の描画は 1 コマ 1〜2 秒なので、相手の画面に届いた値が反映されるまで時間がかかる
const until = async (cond, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return true; await sleep(500); } return false; };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = spawn('node', ['local.js', String(WS_PORT)], { cwd: path.join(ROOT, 'server'), stdio: 'inherit' });
  const server = http.createServer((req, res) => {
    const p = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  // 2 人それぞれに別のブラウザを使う (同じブラウザの 2 つ目のページは裏のタブ扱いになり、描画が 1 秒 1 コマ以下に絞られるため)
  const browsers = [];
  const launch = async () => { const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); browsers.push(b); return b; };
  const open = async (label) => {
    const page = await (await launch()).newPage({ viewport: { width: 960, height: 540 } });
    page.setDefaultTimeout(400000);
    await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r => r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
    await page.route('https://cdn.jsdelivr.net/npm/@pixiv/**', r => r.abort());
    await page.route('**/src/main.js', async r => {
      const t = (await (await r.fetch()).text()).replace('  // ---- UI ----', '  window.__g = { player, cam, input, scene, mp };\n  // ---- UI ----');
      r.fulfill({ body: t, contentType: 'application/javascript' });
    });
    page.on('pageerror', e => console.log(label, 'ERR', e.message));
    page.on('console', m => { if (m.type() === 'error') console.log(label, 'console:', m.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/?mp=ws://127.0.0.1:${WS_PORT}&room=check&join&noshadow&noaa&pr=0.5&nofollow`);
    await page.waitForFunction(() => window.__g && window.__g.mp && window.__g.mp.me.id);
    await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
    return page;
  };
  const [A, B] = await Promise.all([open('A'), open('B')]);
  // 描画を軽くする (当たり判定と地面の高さは残る)。mode: 'all' = 全部隠す (数字を測る間。ソフトウェア描画で 2 つ同時だと 1 fps になるため)、
  // 'city' = 街だけ隠し、空とキャラは見せる (撮影用)、'none' = 元どおり
  const hide = (page, mode) => page.evaluate((mode) => {
    const g = window.__g, keep = new Set([g.player.model.root, ...[...g.mp.remotes.map.values()].map((r) => r.model.root)]);
    for (const o of g.scene.children) {
      if (!(o.isGroup || o.isMesh)) continue;
      if (o.userData.__vis === undefined) o.userData.__vis = o.visible;
      const isChar = keep.has(o) || o.isSprite, isSky = o.isMesh && o.material && o.material.type === 'ShaderMaterial';
      o.visible = mode === 'none' ? o.userData.__vis : mode === 'all' ? false : (isChar || isSky);
    }
  }, mode);
  const info = (page) => page.evaluate(() => { const g = window.__g, m = g.mp; return { id: m.me.id, name: m.me.name, pvp: m.me.pvp, hp: m.me.hp, k: m.me.k, d: m.me.d, dead: g.player.dead, x: +g.player.pos.x.toFixed(2), z: +g.player.pos.z.toFixed(2),
    others: [...m.remotes.map.values()].map((r) => ({ id: r.id, name: r.name, pvp: r.pvp, hp: r.hp, k: r.k, x: +r.x.toFixed(2), z: +r.z.toFixed(2), shown: r.shown })) }; });
  const ok = (c, msg) => { console.log((c ? 'OK  ' : 'NG  ') + msg); if (!c) process.exitCode = 1; };

  let a = await info(A), b = await info(B);
  console.log('A', JSON.stringify(a)); console.log('B', JSON.stringify(b));
  ok(a.others.length === 1 && b.others.length === 1 && a.others[0].id === b.id, 'お互いが参加者として見える');
  ok(a.name !== b.name, `名前が自動で付く (${a.name} / ${b.name})`);

  // 街の描画を止めて軽くする (当たり判定と地面は残る)。A の 1.6 m 前に B を立たせる
  await hide(A, 'all'); await hide(B, 'all');
  await A.evaluate(() => { const g = window.__g; g.player.teleport(-300, 1432); g.player.facing = 0; });
  await B.evaluate(() => { const g = window.__g; g.player.teleport(-300, 1433.6); g.player.facing = Math.PI; });
  b = await info(B);
  await until(async () => { a = await info(A); return Math.hypot(a.others[0].x - b.x, a.others[0].z - b.z) < 0.3; });
  ok(Math.hypot(a.others[0].x - b.x, a.others[0].z - b.z) < 0.3, `B の位置が A に伝わる (ずれ ${Math.hypot(a.others[0].x - b.x, a.others[0].z - b.z).toFixed(2)} m)`);
  // B が走る → A から見て動く
  await B.evaluate(() => { window.__g.player.teleport(-300, 1432); }); await sleep(1000); b = await info(B);
  // この環境の描画は 1 コマ 1〜2 秒かかり、1 コマの上限 0.25 秒のため、待つだけではほとんど進まない。ゲームの更新を直接 2 秒ぶん進める
  await B.evaluate(() => { const g = window.__g; g.cam.yaw = 4.0 - 0.72; g.input.az = 1; for (let i = 0; i < 60; i++) g.player.update(1 / 30, g.input, g.cam); g.input.az = 0; }); // スタート近くの道を道なりに (speedcheck.js と同じ)
  const b2 = await info(B); let a2;
  await until(async () => { a2 = await info(A); return Math.hypot(a2.others[0].x - b2.x, a2.others[0].z - b2.z) < 0.5; });
  ok(Math.hypot(b2.x - b.x, b2.z - b.z) > 5 && Math.hypot(a2.others[0].x - b2.x, a2.others[0].z - b2.z) < 0.5, `B が走ると A の画面でも動く (B は ${Math.hypot(b2.x - b.x, b2.z - b.z).toFixed(1)} m 進んだ)`);

  // 戦闘オフのまま斬っても当たらない
  const face = async () => { await B.evaluate(() => { const g = window.__g; g.player.teleport(-300, 1433.6); }); await A.evaluate(() => { const g = window.__g; g.player.teleport(-300, 1432); g.player.facing = 0; }); await sleep(800); };
  const slash = async (n) => { for (let i = 0; i < n; i++) { await A.evaluate(() => window.__g.input.press('KeyJ')); await sleep(450); } };
  await face(); await slash(2); await sleep(1500);
  ok((await info(B)).hp === 100, '戦闘オフ同士は当たらない');
  // A だけオン → 当たらない
  await A.evaluate(() => window.__g.mp.togglePvp()); await sleep(2500);
  await face(); await slash(2); await sleep(1500);
  ok((await info(A)).pvp && (await info(B)).hp === 100 && !(await info(B)).pvp, '相手が戦闘オフなら当たらない');
  // 両方オン → 当たる
  await B.evaluate(() => window.__g.mp.togglePvp()); await sleep(2500);
  await face(); await slash(1); await sleep(1200);
  b = await info(B); a = await info(A);
  ok(b.pvp && b.hp < 100, `戦闘オン同士は当たる (B の体力 ${b.hp})`);
  ok(a.others[0].hp === b.hp && a.others[0].pvp, 'A の画面でも B の体力が減る');
  // 倒れるまで
  let n = 0;
  while (!(await info(B)).dead && n++ < 25) { await face(); await slash(3); }
  b = await info(B); a = await info(A);
  ok(b.dead && a.k === 1 && b.d === 1, `B が倒れる (A の撃破 ${a.k}、斬った回数 約 ${n * 3 + 1})`);
  await hide(A, 'city'); await hide(B, 'city');
  // 倒れた姿 (街は消したまま): A から見た B と、B 自身の画面
  await A.evaluate(() => { const g = window.__g; g.cam.yaw = 2.4; g.cam.pitch = 0.2; g.cam.dist = 4.5; });
  await B.evaluate(() => { const g = window.__g; g.cam.yaw = 0.9; g.cam.pitch = 0.2; g.cam.dist = 4; });
  await sleep(700);
  await A.screenshot({ path: path.join(OUT, 'mp_A_sees_down.png') });
  await B.screenshot({ path: path.join(OUT, 'mp_B_down.png') });
  await sleep(4000);
  b = await info(B);
  ok(!b.dead && b.hp === 100, `B が復活する (位置 ${b.x}, ${b.z})`);
  ok(await B.evaluate(() => document.querySelector('#mp-hp i').style.width === '100%' && document.getElementById('mp-down').hidden), '復活すると体力の表示が満タンに戻る');
  // 斬っている最中の姿を、B の画面で (A はほかの人として見える)
  await face();
  await hide(A, 'city'); await hide(B, 'city');
  await B.evaluate(() => { const g = window.__g; g.cam.yaw = 1.1; g.cam.pitch = 0.2; g.cam.dist = 4.5; });
  await sleep(4000); // 復活直後の保護が切れるまで
  for (const [i, wait] of [[1, 220], [2, 220], [3, 260]]) { await A.evaluate(() => window.__g.input.press('KeyJ')); await sleep(wait); await B.screenshot({ path: path.join(OUT, `mp_B_action${i}.png`) }); await sleep(380 - wait + 60); }
  await sleep(1500);
  await hide(A, 'none'); await hide(B, 'none');

  // 画面: 並んで立ち、A が斬っている所を B の横から
  await A.evaluate(() => { const g = window.__g; g.player.teleport(-300, 1432); g.player.facing = 0; g.cam.yaw = 2.2; g.cam.pitch = 0.25; g.cam.dist = 5; });
  await B.evaluate(() => { const g = window.__g; g.player.teleport(-300, 1434.2); g.player.facing = Math.PI; g.cam.yaw = 1.0; g.cam.pitch = 0.25; g.cam.dist = 5; });
  await sleep(6000);
  await A.screenshot({ path: path.join(OUT, 'mp_A.png') });
  await A.evaluate(() => window.__g.input.press('KeyJ'));
  await sleep(2500);
  await B.screenshot({ path: path.join(OUT, 'mp_B.png') });
  // 「1 人に戻る」→ 相手の画面から消える。もう一度「みんなと遊ぶ」→ また見える
  await B.evaluate(() => window.__g.mp.leave()); await sleep(3000);
  ok((await info(A)).others.length === 0 && await B.evaluate(() => !window.__g.mp.joined && window.__g.mp.remotes.map.size === 0 && !document.getElementById('mp-join').hidden),
    '「1 人に戻る」で抜けると、A の画面から消え、B は 1 人用に戻る');
  await sleep(3000);
  ok((await info(A)).others.length === 0, '抜けた後は、勝手につなぎ直さない');
  await B.evaluate(() => window.__g.mp.join()); await sleep(4000);
  ok((await info(A)).others.length === 1, '「みんなと遊ぶ」でまた入れる');
  // 退室
  await B.close(); await sleep(1500);
  ok((await info(A)).others.length === 0, 'B が閉じると A の画面から消える');
  for (const b of browsers) await b.close(); server.close(); srv.kill();
})().catch((e) => { console.error(e); process.exit(1); });
