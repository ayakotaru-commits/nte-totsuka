// メモリの内訳を出す (スマホでタブが落ちる原因の切り分け用)。
// ゲームをヘッドレスブラウザで開き、メッシュごとの頂点データの大きさ・テクスチャの大きさ・JS のヒープを表示する。
// 使い方: node tools/dev/memcheck.js [URL に付ける文字列。例 "?touch"]   (準備は shot.js と同じ)
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), PUBLIC = path.join(ROOT, 'public'), THREE_DIR = path.join(__dirname, '.cache', 'package');
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
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, renderer };\n  const qs = new URLSearchParams');
    r.fulfill({ body: t, contentType: 'application/javascript' });
  });
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/` + (process.argv[2] || ''), { timeout: 300000 });
  await page.waitForFunction(() => window.__g && document.getElementById('status').textContent === '準備完了', null, { timeout: 300000 });
  await page.evaluate(() => window.__g.player.model.ready);
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
    return out.join('\n');
  }));
  await browser.close(); server.close();
})();
