// 動きのデータを、キャラの骨の向きに直して public/data/motions/<名前>.json に書き出す (中身は export.html)。
//
// 元のデータ: Quaternius「Universal Animation Library」の無料版 (CC0 1.0)。glTF にしたものが GitHub にある:
//   git clone --depth 1 https://github.com/J-Ponzo/gltf-universal-animation-library.git data/raw/ual
// 準備 (1 回だけ): three.js をローカルに置く (tools/dev/shot.js と同じ)
//   mkdir -p tools/dev/.cache && cd tools/dev/.cache && npm pack three@0.170.0 -q && tar xzf three-0.170.0.tgz
// 使い方: node tools/motion/export.js            (下の CLIPS を全部書き出す。数十秒)
//
// 書き出す形: { name, source, license, fps, frames, dur, bones: { hips: [x,y,z,w, ...], ... }, hips: [x,y,z, ...] }
//   bones = キャラの骨 (character.js の BONE。腕は下ろした姿勢が基準) の、親から見た向き (コマごと)
//   hips = 腰の移動 (T ポーズからの差 ÷ 腰の高さ。正面 +z、左 +x)
//   speed = くり返しの動きで進む速さ (腰の高さ / 秒)、phaseL = 左足がいちばん前へ出る時 (0〜1)
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const THREE_DIR = path.join(ROOT, 'tools', 'dev', '.cache', 'package');
const UAL = path.join(ROOT, 'data', 'raw', 'ual', 'glTF', 'AnimationLibrary_Godot_Standard.gltf');
const OUT = path.join(ROOT, 'public', 'data', 'motions');

// 人形 (Quaternius の Mannequin) の骨 → キャラの骨
const UAL_MAP = {
  hips: 'DEF-hips', spine: 'DEF-spine.001', chest: 'DEF-spine.003', neck: 'DEF-neck', head: 'DEF-head',
  shL: 'DEF-upper_arm.L', elL: 'DEF-forearm.L', haL: 'DEF-hand.L', shR: 'DEF-upper_arm.R', elR: 'DEF-forearm.R', haR: 'DEF-hand.R',
  thL: 'DEF-thigh.L', knL: 'DEF-shin.L', ftL: 'DEF-foot.L', thR: 'DEF-thigh.R', knR: 'DEF-shin.R', ftR: 'DEF-foot.R',
};
// 書き出す動き: [元の名前, 書き出す名前]
const CLIPS = [['Sword_Attack', 'ual_sword_attack'],
  ['Idle_Loop', 'ual_idle'], ['Walk_Loop', 'ual_walk'], ['Jog_Fwd_Loop', 'ual_jog'], ['Sprint_Loop', 'ual_sprint'],
  ['Jump_Start', 'ual_jump_start'], ['Jump_Loop', 'ual_jump_loop'], ['Jump_Land', 'ual_jump_land']];

(async () => {
  if (!fs.existsSync(UAL)) { console.error('元のデータがありません。先に:\n  git clone --depth 1 https://github.com/J-Ponzo/gltf-universal-animation-library.git data/raw/ual'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const p = u.startsWith('/three/') ? path.join(THREE_DIR, u.slice(7)) : u.startsWith('/ual/') ? path.join(path.dirname(UAL), u.slice(5)) : path.join(__dirname, u);
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'application/javascript' : p.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('ERR', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/export.html`);
  await page.waitForFunction(() => window.ready);
  for (const [src, name] of CLIPS) {
    const r = await page.evaluate(([s, m, map]) => window.exportClip('/ual/' + s, m, 'A_TPose', map, 30), [path.basename(UAL), src, UAL_MAP]);
    const out = { name, source: 'Quaternius Universal Animation Library (Standard) / ' + src, license: 'CC0 1.0', ...r };
    fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(out));
    console.log(name, `${r.frames} コマ ${r.dur.toFixed(2)} 秒 速さ ${r.speed} 位相 ${r.phaseL}`);
  }
  await browser.close(); server.close();
})();
