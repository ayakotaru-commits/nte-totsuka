// 空と時刻 (public/src/skyfx.js・time.js) の確認。ゲームをヘッドレスブラウザで開き、時刻を 0〜24 時で動かして
// 値が有限・なめらかにつながること、T (時間帯への移動)・時間の流れ (?tspeed) が働くこと、シェーダのエラーが無いことを調べる。
// 使い方: node tools/dev/skycheck.js   (準備は shot.js と同じ。1〜2 分)
const { chromium } = require('playwright');
const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), PUBLIC = path.join(ROOT, 'public'), THREE_DIR = path.join(__dirname, '.cache', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  page.setDefaultTimeout(300000);
  await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r => r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
  await page.route('https://cdn.jsdelivr.net/npm/@pixiv/**', r => r.abort());
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (/shader|WebGL|THREE\.WebGLProgram|ERROR/i.test(m.text()) && !/GPU stall|VRM を読み込めなかった|KHR_parallel_shader_compile/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  const port = server.address().port;
  let ok = 0, ng = 0;
  const t = (name, pass, extra = '') => { console.log(pass ? 'OK ' : 'NG ', name, extra); pass ? ok++ : ng++; };

  // 1. 値の連続・有限 (描画せず apply だけ)
  await page.goto(`http://127.0.0.1:${port}/?shot&noshadow&noaa&pr=0.3&nofollow&hour=12`);
  await page.waitForFunction(() => window.__tod, null, { timeout: 300000 });
  await page.waitForTimeout(3000);
  const r1 = await page.evaluate(() => {
    const tod = window.__tod, keys = ['skyElev', 'azim', 'lightElev', 'sunI', 'hemiI', 'exposure', 'win', 'rayleigh', 'envI', 'ao', 'bloom', 'sat', 'cloud'];
    let bad = [], prev = null, maxJump = {}, names = new Set();
    for (let h = 0; h < 24.001; h += 0.05) {
      tod.hour = tod.target = h % 24; tod.apply(); names.add(tod.name);
      const c = tod.cur;
      for (const k of keys) if (!Number.isFinite(c[k])) bad.push(k + '@' + h);
      for (const v of [tod.lightDir, tod.moonDir]) if (![v.x, v.y, v.z].every(Number.isFinite)) bad.push('dir@' + h);
      for (const col of [c.sunC, c.fogC]) if (![col.r, col.g, col.b].every(Number.isFinite)) bad.push('col@' + h);
      if (prev) for (const k of ['sunI', 'hemiI', 'exposure', 'win', 'envI', 'cloud']) maxJump[k] = Math.max(maxJump[k] || 0, Math.abs(c[k] - prev[k]));
      const ld = tod.lightDir.clone(); if (prev && prev.ld) maxJump.light = Math.max(maxJump.light || 0, ld.angleTo(prev.ld) * 57.3);
      prev = { ...Object.fromEntries(keys.map(k => [k, c[k]])), ld };
    }
    return { bad, maxJump, names: [...names] };
  });
  t('0〜24 時の全部の値が有限', r1.bad.length === 0, r1.bad.slice(0, 5).join());
  t('0.05 時間ごとの変化がなめらか (光の向き 15° 以内・明るさ 0.2 以内)', r1.maxJump.light < 15 && ['sunI', 'hemiI', 'exposure', 'win', 'envI', 'cloud'].every(k => r1.maxJump[k] < 0.2), JSON.stringify(r1.maxJump, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
  t('時間帯の名前が 4 つ出る', r1.names.length === 4, r1.names.join());

  // 2. T (次の時間帯) で時間が進んで向かう。夜 → 朝 は 0 時をまたぐ
  const r2 = await page.evaluate(async () => {
    const tod = window.__tod, log = [];
    tod.hour = tod.target = 12; tod.jumping = false;
    for (let i = 0; i < 4; i++) {
      tod.next(); const start = tod.hour; let maxSteps = 0, wrapped = false, last = tod.hour;
      for (let f = 0; f < 600 && tod.jumping; f++) { tod.update(1 / 30); if (tod.hour < last - 12) wrapped = true; last = tod.hour; maxSteps++; }
      log.push({ to: tod.name, hour: +tod.hour.toFixed(2), wrapped, steps: maxSteps, done: !tod.jumping });
    }
    return log;
  });
  t('T で 昼 → 夕方 → 夜 → 朝 → 昼 と進む', r2.map(x => x.to).join() === '夕方,夜,朝,昼', JSON.stringify(r2));
  t('どれも 600 コマ (20 秒) 以内に着く', r2.every(x => x.done));
  t('夜 → 朝 は 24 時をまたいで進む (逆戻りしない)', r2[2].wrapped);

  // 3. 時間の流れ (?tspeed)
  const r3 = await page.evaluate(() => {
    const tod = window.__tod; tod.speed = 60; tod.hour = tod.target = 17; tod.jumping = false;
    const h0 = tod.hour; for (let i = 0; i < 90; i++) tod.update(1 / 30);   // 3 秒 = 3 時間ぶん
    const adv = tod.hour - h0;
    tod.hour = tod.target = 23.9; for (let i = 0; i < 30; i++) tod.update(1 / 30);   // 24 時をまたぐ
    return { adv, wrap: tod.hour, label: tod.label() };
  });
  t('tspeed=60 で 3 秒に約 3 時間進む', Math.abs(r3.adv - 3) < 0.05, 'adv=' + r3.adv.toFixed(3));
  t('24 時をまたいで 0 時台に戻る', r3.wrap >= 0 && r3.wrap < 2, 'hour=' + r3.wrap.toFixed(2) + ' ' + r3.label);

  // 4. 月・星の向き
  const r4 = await page.evaluate(() => {
    const tod = window.__tod; tod.speed = 0; tod.phase = 0.5; tod.hour = tod.target = 0; tod.apply();
    const full0 = tod.moonDir.y; tod.hour = tod.target = 12; tod.apply(); const fullNoon = tod.moonDir.y;
    tod.phase = 0; tod.hour = tod.target = 12; tod.apply(); const newNoon = tod.moonDir.y;
    const sun = tod.sky.material.uniforms.sunPosition.value;
    return { full0, fullNoon, newNoon, sunY: sun.y };
  });
  t('満月は真夜中に高く、昼は地平線の下', r4.full0 > 0.8 && r4.fullNoon < 0, JSON.stringify(r4));
  t('新月は太陽と同じ向き', Math.abs(r4.newNoon - r4.sunY) < 0.01);

  t('シェーダ・JS のエラーが無い', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`\n${ok} 項目 OK、${ng} 項目 NG`);
  await browser.close(); server.close();
  process.exit(ng ? 1 : 0);
})();
