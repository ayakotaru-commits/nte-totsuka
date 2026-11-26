// メモリの内訳を出す (スマホでタブが落ちる原因の切り分け用)。
// ゲームをヘッドレスブラウザで開き、メッシュごとの頂点データの大きさ・テクスチャの大きさ・JS のヒープを表示する。
// 使い方: node tools/dev/memcheck.js [URL に付ける文字列。例 "?touch"] [--at x,z,y] [--root <public の親のフォルダ>]   (準備は shot.js と同じ)
//   --at   プレイヤーをその場所に置いてから測る (例: 横浜駅のホーム 7987,-7151,-10)。線路の延長の区間を読み終わるまで待つ
//   --root 別のフォルダ (git worktree で作った修正前など) の public を開く。比べるとき用
//   最後に「線路の延長」の内訳 (rail_ext の下のメッシュ・地図の下絵の canvas) も出す
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');
const ARGS = process.argv.slice(2), opt = (k) => { const i = ARGS.indexOf(k); return i < 0 ? null : ARGS.splice(i, 2)[1]; };
const AT = opt('--at'), ROOT = path.resolve(opt('--root') || path.join(__dirname, '..', '..')), PUBLIC = path.join(ROOT, 'public'), THREE_DIR = path.join(__dirname, '.cache', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  const vrmLocal = path.join(__dirname, '.cache', 'three-vrm.module.min.js'); // あれば VRM も読む (npm pack @pixiv/three-vrm@3.3.3 の lib/ から置く)
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r =>
    r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
  await page.route('https://cdn.jsdelivr.net/npm/@pixiv/**', r => fs.existsSync(vrmLocal) ? r.fulfill({ path: vrmLocal, contentType: 'application/javascript' }) : r.abort());
  await page.route('**/src/main.js', async r => {
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, renderer, minimap };\n  const qs = new URLSearchParams');
    r.fulfill({ body: t, contentType: 'application/javascript' });
  });
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/` + (ARGS[0] || ''), { timeout: 300000 });
  await page.waitForFunction(() => window.__g && document.getElementById('status').textContent === '準備完了', null, { timeout: 300000 });
  await page.evaluate(() => window.__g.player.model.ready);
  if (AT) {
    const [x, z, y] = AT.split(',').map(Number);
    await page.evaluate(([x, z, y]) => { const p = window.__g.player; p.pos.set(x, y, z); if (p.vel) p.vel.set(0, 0, 0); }, [x, z, y]);
  }
  const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  for (let k = 0; k < 300; k++) { await frames(2); if (await page.evaluate(() => !window.__railext || window.__railext.stats.idle)) break; }
  await page.waitForTimeout(8000);
  await page.evaluate(() => { if (window.gc) { gc(); gc(); } });
  console.log(await page.evaluate(() => {
    const g = window.__g, MB = (n) => (n / 1048576).toFixed(1) + 'MB';
    const geos = new Map(), texs = new Map();
    g.scene.traverse((o) => {
      if (o.geometry && !geos.has(o.geometry)) {
        let b = 0, gpu = 0; const sz = (at) => { const n = at.array ? at.array.byteLength : 0; gpu += n || at.count * at.itemSize * 4; return n; }; // 手放した控え (array = null) は 0。GPU 側は 1 値 4 バイトで概算
        for (const k in o.geometry.attributes) b += sz(o.geometry.attributes[k]);
        if (o.geometry.index) b += sz(o.geometry.index);
        if (o.isInstancedMesh) b += o.instanceMatrix.array.byteLength + (o.instanceColor ? o.instanceColor.array.byteLength : 0);
        geos.set(o.geometry, { name: o.name || o.type, b, gpu, v: o.geometry.attributes.position.count, attrs: Object.keys(o.geometry.attributes).join(',') + (o.geometry.index ? ' +index' : '') });
      }
      for (const m of [].concat(o.material || [])) for (const k in m) { const t = m[k]; if (t && t.isTexture && t.image && !texs.has(t)) texs.set(t, { name: (o.name || o.type) + '.' + k, w: t.image.width, h: t.image.height, b: t.image.width * t.image.height * 4 * (t.generateMipmaps ? 1.33 : 1) }); }
      if (o.isSkinnedMesh) for (const m of [].concat(o.material)) for (const u in (m.uniforms || {})) { const t = m.uniforms[u].value; if (t && t.isTexture && t.image && !texs.has(t)) texs.set(t, { name: 'vrm.' + u, w: t.image.width, h: t.image.height, b: t.image.width * t.image.height * 4 * 1.33 }); }
    });
    const G = [...geos.values()].sort((a, b) => b.gpu - a.gpu), T = [...texs.values()].sort((a, b) => b.b - a.b);
    const out = ['== 頂点データ: JS 側の控え 合計 ' + MB(G.reduce((s, x) => s + x.b, 0)) + ' / GPU 側 (概算) 合計 ' + MB(G.reduce((s, x) => s + x.gpu, 0)) + ' / ' + G.length + ' 個'];
    for (const x of G.slice(0, 22)) out.push(`  ${MB(x.b).padStart(8)} / GPU ${MB(x.gpu).padStart(8)}  ${String(x.v).padStart(9)} 頂点  ${x.name}  [${x.attrs}]`);
    out.push('== テクスチャ 合計 ' + MB(T.reduce((s, x) => s + x.b, 0)) + ' / ' + T.length + ' 枚');
    const byName = {}; for (const x of T) { const k = x.name.replace(/_[0-9a-z]+\./, '.') + ' ' + x.w + 'x' + x.h; byName[k] = byName[k] || { n: 0, b: 0 }; byName[k].n++; byName[k].b += x.b; }
    for (const [k, v] of Object.entries(byName).sort((a, b) => b[1].b - a[1].b).slice(0, 16)) out.push('  ' + MB(v.b).padStart(8) + '  ' + v.n + ' 枚  ' + k);
    for (const x of T.slice(0, 0)) out.push(`  ${MB(x.b).padStart(8)}  ${x.w}x${x.h}  ${x.name}`);
    out.push('== three.js: ' + JSON.stringify(g.renderer.info.memory) + '  JS ヒープ: ' + MB(performance.memory.usedJSHeapSize) + ' (全体 ' + MB(performance.memory.totalJSHeapSize) + ')');
    const c = g.renderer.domElement; out.push(`== 画面: ${c.width}x${c.height}  影: ${g.renderer.shadowMap.enabled}`);
    // 線路の延長: rail_ext の下のメッシュの頂点データと、地図の下絵 (修正前は 1 枚の大きな canvas、修正後は全体の絵 + 区間の絵)
    const re = g.scene.getObjectByName('rail_ext');
    if (re) {
      let b = 0, gpu = 0, n = 0, inst = 0; const seen = new Set();
      re.traverse((o) => { if (o.isInstancedMesh) inst += o.count * 64; if (!o.geometry || seen.has(o.geometry)) return; seen.add(o.geometry); n++;
        for (const k in o.geometry.attributes) { const at = o.geometry.attributes[k]; b += at.array ? at.array.byteLength : 0; gpu += at.count * at.itemSize * 4; }
        if (o.geometry.index) { const at = o.geometry.index; b += at.array ? at.array.byteLength : 0; gpu += at.count * 4; }
      });
      const E = g.minimap && g.minimap.ext; let cv = 0;
      if (E && E.canvas) cv = E.canvas.width * E.canvas.height * 4;
      if (E && E.mem) cv = E.mem();
      const st = window.__railext ? window.__railext.stats : null;
      out.push(`== 線路の延長: メッシュ ${n} 個、頂点データ JS ${MB(b)} / GPU ${MB(gpu)}、インスタンス ${MB(inst)}、地図の下絵 ${MB(cv)}` + (st ? `、区間 ${st.loaded.length} 個 (読んだ計 ${MB(st.bytes)})` : ''));
      out.push(`== 位置 ${g.player.pos.x.toFixed(0)},${g.player.pos.z.toFixed(0)}`);
    }
    // フェアリー・リールパーク (group 名 'park'): 頂点・インスタンス・描画の数・テクスチャ・名前ごとの上位
    const pk = g.scene.getObjectByName('park');
    if (pk) {
      let gpu = 0, tri = 0, meshes = 0, inst = 0, pts = 0; const seen = new Set(), byName = {}, ptex = new Set(); let tb = 0;
      pk.traverse((o) => {
        if (o.isInstancedMesh) inst += o.count;
        if (!o.geometry) return;
        meshes++; const geo = o.geometry, gi = geo.index ? geo.index.count : geo.attributes.position.count, cnt = o.isInstancedMesh ? o.count : 1;
        if (o.isPoints) pts += geo.attributes.position.count; else tri += gi / 3 * cnt;
        if (seen.has(geo)) return; seen.add(geo);
        let b = 0; for (const k in geo.attributes) { const at = geo.attributes[k]; b += at.count * at.itemSize * 4; } if (geo.index) b += geo.index.count * 4;
        const nm = (o.name || (o.parent && o.parent.name ? o.parent.name + '/' : '') + o.type + '[' + Object.keys(geo.attributes).join(',') + ']').replace(/_\d+$/, '').replace(/[0-9]+/g, ''); byName[nm] = byName[nm] || { n: 0, b: 0 }; byName[nm].n++; byName[nm].b += b; gpu += b;
        for (const m of [].concat(o.material || [])) for (const k in m) { const t = m[k]; if (t && t.isTexture && t.image && !ptex.has(t)) { ptex.add(t); tb += t.image.width * t.image.height * 4 * 1.33; } }
      });
      out.push(`== パーク: メッシュ ${meshes} 個 (描画の呼び出しの上限)、頂点 GPU ${MB(gpu)}、三角形 ${(tri / 1000).toFixed(0)}k (インスタンス込み)、粒 ${pts}、インスタンス計 ${inst}、テクスチャ ${ptex.size} 枚 ${MB(tb)}`);
      for (const [k, v] of Object.entries(byName).sort((a, b) => b[1].b - a[1].b).slice(0, 14)) out.push('   ' + MB(v.b).padStart(8) + '  ' + String(v.n).padStart(4) + ' 個  ' + k);
      const ck = pk.getObjectByName('park_castle');   // 段階 9: 城だけの内訳 (描画の呼び出し = メッシュの数、三角形、頂点 GPU、テクスチャ)
      if (ck) {
        let m2 = 0, t2 = 0, b2 = 0, tb2 = 0; const sg = new Set(), st2 = new Set();
        ck.traverse((o) => { if (!o.geometry) return; m2++; const gi = o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count; t2 += gi / 3 * (o.isInstancedMesh ? o.count : 1); if (!sg.has(o.geometry)) { sg.add(o.geometry); for (const k in o.geometry.attributes) { const at = o.geometry.attributes[k]; b2 += at.count * at.itemSize * 4; } } for (const m of [].concat(o.material || [])) for (const k in m) { const t = m[k]; if (t && t.isTexture && t.image && !st2.has(t)) { st2.add(t); tb2 += t.image.width * t.image.height * 4 * 1.33; } } });
        out.push(`== 城 (park_castle): メッシュ ${m2} 個 (描画の呼び出し)、三角形 ${(t2 / 1000).toFixed(0)}k、頂点 GPU ${MB(b2)}、テクスチャ ${st2.size} 枚 ${MB(tb2)}`);
      }
      const cr = g.scene.getObjectByName('crowd'); if (cr) out.push(`== 人の InstancedMesh: count ${cr.count}`);
    } else out.push('== パーク: 見つからない');
    return out.join('\n');
  }));
  await browser.close(); server.close();
})();
