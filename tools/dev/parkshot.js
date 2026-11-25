// フェアリー・リールパーク (舞浜の架空のテーマパーク。PARK_PLAN.md) の画面を撮る。視点はゲームの座標 (x, z) で書く。
// 使い方: node tools/dev/parkshot.js <出力フォルダ> [--nopark] [--only 名前,名前] [--night] [--probe]   (1 枚 1〜2 分。--probe = 壁の柄の確かめの箱だけを撮る。--nopark = 修正前 = 実在のままの舞浜)
// 視点 (VIEWS): at = キャラの位置 [x, z]、look = 見る向き [dx, dz]、pitch・dist = カメラ。キャラは地面に立つ (高さは地形から)
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(__dirname, '.cache', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };

const VIEWS = [
  { name: 'a1_site_aerial', at: [31480, -25760], look: [0, 1], pitch: 1.1, dist: 700 },        // 敷地の上から (北の駅の側から南へ)
  { name: 'a2_gate_aerial', at: [31330, -25919], look: [0.5, 0.866], pitch: 0.7, dist: 120 },  // ゲートとその前の道
  { name: 'a3_approach', at: [31306, -25986], look: [0.2, 1], pitch: 0.25, dist: 24 },          // 駅からの歩道が敷地に入る所から
  { name: 'a4_gate_front', at: [31310, -25950], look: [0.5, 0.866], pitch: 0.12, dist: 16 },    // ゲートの看板を正面から
  { name: 'a5_gate_close', at: [31330, -25919], look: [0.5, 0.866], pitch: 0.18, dist: 7 },     // 柱の間から
  { name: 'a6_plaza', at: [31440, -25760], look: [0.3, 1], pitch: 0.2, dist: 20 },              // ネオン・アベニューから広場の円へ
  { name: 'a7_plaza_aerial', at: [31490, -25672], look: [0, 1], pitch: 0.9, dist: 260 },        // 広場の円を上から
  { name: 'p1_walls_probe', at: [31262, -25905], look: [0.35, 1], pitch: 0.12, dist: 60, probe: true },   // 壁の柄の確かめ: 延長の建物の材質に、街の本体と同じ柄 (matId 0〜5) を付けた箱を並べる (--probe のときだけ)
  { name: 'p2_walls_close', at: [31246, -25892], look: [0.15, 1], pitch: 0.04, dist: 15, probe: true },   // 近くから (吹き付け・サイディング・タイル・打ち放しが見える距離)
  { name: 'b1_lake', at: [31510, -25548], look: [0, 1], pitch: 0.16, dist: 36 },             // 湖の北の散歩道から (水面・岸の縁石)
  { name: 'b2_lake_aerial', at: [31510, -25464], look: [0, 1], pitch: 1.1, dist: 480 },    // 湖と広場・塔・道を上から
  { name: 'b3_tower', at: [31560, -25662], look: [0.7, 0.7], pitch: 0.1, dist: 30 },        // サーチライト・タワー
  { name: 'b4_avenue', at: [31352, -25896], look: [0.66, 0.76], pitch: 0.1, dist: 14 },    // ネオン・アベニュー (街灯・ベンチ)
  { name: 'b5_fence', at: [30992, -25801], look: [-1, 0.05], pitch: 0.1, dist: 12 },       // 外周の柵 (西の辺)
  { name: 'b6_guide', at: [31612, -26047], look: [-0.95, -0.3], pitch: 0.08, dist: 9 },    // 駅からゲートへの案内板
  { name: 'b7_beams', at: [31470, -25760], look: [0.6, 0.8], pitch: 0.3, dist: 90 },       // 塔の光線 (夜)
  // 段階 4: ショー・夜の光 (show = 時計を差し替える: { parade: 先頭の山車の道のり m } / { fw: 'burst:N' (N 発目の爆発の直後) | 'finale' | 'end' | 秒 } / { idle: true } = ショーの無い時刻)。--night と合わせて使う
  { name: 'n1_plaza_lights', at: [31440, -25700], look: [0.3, 1], pitch: 0.3, dist: 30, show: { idle: true } },     // プラザの光の輪・アベニューの縁 (夜)
  { name: 'n2_lake_jets', at: [31510, -25548], look: [0, 1], pitch: 0.12, dist: 40, show: { idle: true } },      // 湖の水上ショー (噴水の光の柱・しぶき・岸の光)
  { name: 'n3_avenue_night', at: [31352, -25896], look: [0.66, 0.76], pitch: 0.1, dist: 16, show: { idle: true } },
  { name: 'n4_lake_aerial', at: [31510, -25464], look: [0, 1], pitch: 1.1, dist: 480, show: { idle: true } },
  { name: 'f1_fw_north', at: [31510, -25640], look: [0, 1], pitch: 0.02, dist: 150, show: { fw: 'burst:8' } },   // 花火 (プラザの側から湖の上を見る)
  { name: 'f2_fw_finale', at: [31510, -25640], look: [0, 1], pitch: 0.02, dist: 150, show: { fw: 'finale' } },
  { name: 'f3_fw_south', at: [31510, -25379], look: [0, -1], pitch: 0.03, dist: 260, show: { fw: 'finale' } },
  { name: 'f4_fw_end', at: [31510, -25640], look: [0, 1], pitch: 0.02, dist: 150, show: { fw: 'end' } },
  { name: 'f5_fw_lake', at: [31510, -25548], look: [0, 1], pitch: 0.2, dist: 70, show: { fw: 'burst:20' } },         // 湖のきらめき (花火の光が水に映る)
  { name: 'q1_parade_avenue', at: [31440, -25794], look: [-0.66, -0.76], pitch: 0.12, dist: 10, show: { parade: 154 } },   // パレード (アベニューで山車が来る)
  { name: 'q2_parade_avenue2', at: [31440, -25794], look: [-0.66, -0.76], pitch: 0.1, dist: 10, show: { parade: 190 } },
  { name: 'q3_parade_plaza', at: [31490, -25672], look: [1, 0], pitch: 0.25, dist: 80, show: { parade: 300 } },        // プラザを半周する山車
  { name: 'q4_parade_aerial', at: [31490, -25672], look: [0, 1], pitch: 1.0, dist: 200, show: { parade: 300 } },
  { name: 'q5_parade_lake', at: [31510, -25560], look: [0, -1], pitch: 0.15, dist: 40, show: { parade: 560 } },
  { name: 'q6_float_close', at: [31440, -25794], look: [-0.66, -0.76], pitch: 0.2, dist: 8, show: { parade: 160 } },
  { name: 'q7_parade_gate', at: [31330, -25919], look: [0.5, 0.866], pitch: 0.2, dist: 16, show: { parade: 40 } },
  { name: 'a8_station_side', at: [31730, -25950], look: [-1, 0.2], pitch: 0.4, dist: 60 },      // 駅の南口のロータリー (敷地の縁。省いた所と残した所の境目)
];

// 段階 2: 各エリアの視点を、設定 (public/data/park.json の gen) から作る。<n>_arch = 門の前から入る向き、<n>_aerial = 建物の中心を上から、<n>_street = 主な通りを歩く目の高さ
try {
  const park = JSON.parse(fs.readFileSync(process.env.PARK_JSON || path.join(PUBLIC, 'data', 'park.json')));   // PARK_JSON = 視点だけ別の設定から取る (修正前の作業コピーで撮るとき)
  if (park.gen) {
    const ROM = ['midnight', 'town', 'avenue', 'valley', 'sweet', 'forest', 'harbor'];
    park.gen.areas.forEach((a, i) => {
      const nm = 'c' + i + '_' + (a.kind || ROM[i]);
      const bs = park.gen.buildings.filter((b) => b.a === i);
      const arch = park.gen.arches.find((q) => q.a === i);
      if (arch) VIEWS.push({ name: nm + '_arch', at: [arch.x - Math.sin(arch.yaw) * 14, arch.z - Math.cos(arch.yaw) * 14], look: [Math.sin(arch.yaw), Math.cos(arch.yaw)], pitch: 0.12, dist: 14 });
      if (bs.length) {
        const cx = bs.reduce((s, b) => s + b.x, 0) / bs.length, cz = bs.reduce((s, b) => s + b.z, 0) / bs.length;
        VIEWS.push({ name: nm + '_aerial', at: [cx, cz], look: [0, 1], pitch: 0.95, dist: 170 });
      }
      const mp = park.gen.paths.find((p2) => p2.a === i);
      if (mp) { const q = mp.pts[Math.floor(mp.pts.length / 2)], r = mp.pts[Math.floor(mp.pts.length / 2) + 1] || mp.pts[0]; const d = Math.hypot(r[0] - q[0], r[1] - q[1]) || 1; VIEWS.push({ name: nm + '_street', at: [q[0], q[1]], look: [(r[0] - q[0]) / d, (r[1] - q[1]) / d], pitch: 0.1, dist: 10 }); }
    });
    // 段階 3: 乗り物 (観覧車 = のりばの側から・近くから、メリーゴーラウンド = 近く・上から、コースター = 上から・のりばの近く)
    const rd = park.gen.rides || {}, W = (o, lx, lz) => [o.x + lx * Math.cos(o.yaw) + lz * Math.sin(o.yaw), o.z - lx * Math.sin(o.yaw) + lz * Math.cos(o.yaw)];
    if (rd.ferris) {
      const f = rd.ferris, fl = [-Math.sin(f.yaw), -Math.cos(f.yaw)];
      VIEWS.push({ name: 'r1_ferris', at: W(f, 0, 14), look: fl, pitch: 0.2, dist: 55 });
      VIEWS.push({ name: 'r2_ferris_close', at: W(f, 0, 5), look: fl, pitch: 0.1, dist: 14 });
      VIEWS.push({ name: 'r3_ferris_side', at: W(f, 22, 0), look: [-Math.cos(f.yaw), Math.sin(f.yaw)], pitch: 0.12, dist: 50 });
    }
    if (rd.ferris) {   // 観覧車に乗った視点 (外から・ゴンドラの中から。時計を差し替えて、ゴンドラ 0 が底に来た時刻から 50 秒)
      const f = rd.ferris;
      VIEWS.push({ name: 'r9_ride_out', at: W(f, 0, 4.2), look: [-Math.sin(f.yaw), -Math.cos(f.yaw)], pitch: 0.18, dist: 13, board: { sec: 50, view: 'out', yawAdd: 0.7 } });
      VIEWS.push({ name: 'r10_ride_in', at: W(f, 0, 4.2), look: [-Math.sin(f.yaw), -Math.cos(f.yaw)], pitch: 0.18, dist: 13, board: { sec: 50, view: 'in', yawAdd: 0.5 } });
    }
    if (rd.carousel) {
      const c = rd.carousel;
      for (const [k, a] of [['e', 1.57], ['w', -1.57], ['n', 3.14]]) VIEWS.push({ name: 'r4_carousel_' + k, at: [c.x + Math.sin(c.yaw + a) * 11, c.z + Math.cos(c.yaw + a) * 11], look: [-Math.sin(c.yaw + a), -Math.cos(c.yaw + a)], pitch: 0.3, dist: 16 });
      VIEWS.push({ name: 'r4_carousel', at: W(c, 0, 11), look: [-Math.sin(c.yaw), -Math.cos(c.yaw)], pitch: 0.15, dist: 16 });
      VIEWS.push({ name: 'r5_carousel_aerial', at: [c.x, c.z], look: [0, 1], pitch: 1.0, dist: 40 });
    }
    if (rd.coaster) {
      const k = rd.coaster;
      VIEWS.push({ name: 'r6_coaster_aerial', at: [k.x, k.z], look: [0, 1], pitch: 1.0, dist: 150 });
      VIEWS.push({ name: 'r7_coaster_side', at: [k.x, k.z], look: [Math.sin(k.yaw), Math.cos(k.yaw)], pitch: 0.2, dist: 100 });
      const s = k.pts[k.stationIdx[1]];
      VIEWS.push({ name: 'r8_coaster_station', at: [s[0], s[1]], look: [Math.sin(k.yaw + 1.6), Math.cos(k.yaw + 1.6)], pitch: 0.12, dist: 22 });
    }
    for (const pr of park.gen.props) VIEWS.push({ name: 'p_' + pr.k + '_' + pr.a, at: [pr.x - Math.sin(pr.yaw || 0) * 0, pr.z], look: [0.3, 1], pitch: 0.2, dist: Math.max(30, pr.r * 3.5) });
  }
} catch (e) { /* 設定が無ければ段階 1 の視点だけ */ }

(async () => {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : (args.splice(i, 2)[1] || true); };
  const night = args.includes('--night'); if (night) args.splice(args.indexOf('--night'), 1);
  const dusk = args.includes('--dusk'); if (dusk) args.splice(args.indexOf('--dusk'), 1);
  const nopark = args.includes('--nopark'); if (nopark) args.splice(args.indexOf('--nopark'), 1);
  const only = flag('--only');
  const [out] = args;
  if (!out) { console.error('usage: node tools/dev/parkshot.js <出力フォルダ> [--nopark] [--only 名前,..] [--night]'); process.exit(1); }
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
  await page.route('**/src/main.js', async r => {
    const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, world, camera };\n  const qs = new URLSearchParams');
    r.fulfill({ body: t, contentType: 'application/javascript' });
  });
  page.on('pageerror', e => console.log('ERR', e.message));
  page.on('console', m => { if (/rror/.test(m.text())) console.log('LOG', m.text()); });
  await page.goto(base + '/?shot&novrm' + (night ? '&t=2' : dusk ? '&t=1' : '') + (nopark ? '&nopark' : ''), { timeout: 300000 });
  await page.waitForFunction(() => window.__g && window.__ride, null, { timeout: 300000 });
  await page.addStyleTag({ content: '#help{display:none!important}' });
  await page.evaluate(() => { window.__trains.hold = Date.now() / 1000; });
  const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const fn = () => (++k >= n ? r() : requestAnimationFrame(fn)); requestAnimationFrame(fn); }), n);
  const extIdle = async () => { for (let k = 0; k < 200; k++) { await frames(2); if (await page.evaluate(() => !window.__railext || window.__railext.stats.idle)) return; } console.log('区間の読み込みが終わらない'); };
  const probe = args.includes('--probe'); if (probe) args.splice(args.indexOf('--probe'), 1);
  let probed = false;
  for (const v of VIEWS) {
    if (only && !only.split(',').includes(v.name)) continue;
    if (v.probe && !probe) continue;
    if (!v.probe && probe && !only) continue;
    const [x, z] = v.at, face = Math.atan2(v.look[0], v.look[1]);
    // 区間 (地形) が読み込まれるまで、いったん駅の前に置く → 地面の高さを聞いて立つ
    await page.evaluate(([x, z, face]) => window.__ride.place(x, -11, z, face), [x, z, face]);
    await frames(3); await extIdle();
    const gy = await page.evaluate(async ([x, z]) => (await import('/src/terrain.js')).H(x, z), [x, z]);
    await page.evaluate(([x, y, z, face, v]) => { window.__ride.place(x, y, z, face); const c = window.__g.cam; c.yaw = face + Math.PI; c.pitch = v.pitch; c.dist = v.dist; }, [x, gy + 0.1, z, face, v]);
    if (v.probe && !probed) {   // 箱を並べる (左端 = 元の材質のまま、あとは matId 0〜5 = 吹き付け・サイディング・タイル・打ち放し・角波・ALC)
      probed = true;
      await page.evaluate(async () => {
        const THREE = await import('three'), T = await import('/src/terrain.js'), X = await import('/src/detail/textures.js');
        const patch = await X.makeWallPatcher(31330, -25919, 2000);
        const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');   // railext.js の窓の絵と同じ
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#5d6670'; g.fillRect(14, 16, 36, 26); g.fillStyle = '#d8d8d4'; g.fillRect(0, 56, 64, 8);
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        const grp = new THREE.Group(); grp.name = 'probe_walls';
        for (let i = 0; i < 7; i++) {
          const w = 12, h = 14, x = 31200 + i * 18, z = -25860, y = T.H(x, z);
          const geo = new THREE.BoxGeometry(w, h, w);
          const uv = geo.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 4, uv.getY(k) * 4.67);   // 3 m に窓 1 つ
          geo.setAttribute('matId', new THREE.Uint8BufferAttribute(new Uint8Array(geo.attributes.position.count).fill(Math.max(0, i - 1)), 1));
          const mat = new THREE.MeshStandardMaterial({ map: tex, color: '#d9cdb8', roughness: 0.85 });
          if (i > 0) patch(mat, 'probe');
          const m = new THREE.Mesh(geo, mat); m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; grp.add(m);
        }
        const sc = window.__g.scene; sc.add(grp);
      });
    }
    if (v.board) {   // 観覧車に乗る (時計を差し替える。撮ったあとで戻す)
      await page.evaluate((b) => {
        const pr = window.__pride, fw = pr.ferris, rev = fw.cfg.rev; window.__realNow = Date.now.bind(Date);
        let now = Math.ceil(window.__realNow() / 1000 / rev) * rev; Date.now = () => now * 1000;
        const K = (d) => ({ pressed: (k) => d.includes(k) });
        window.__ride.place(fw.spot.x, fw.spot.y, fw.spot.z, 0); window.__g.player.pos.y = fw.spot.y + 0.05;
        pr.update(1 / 30, K(['KeyF']));
        for (let t = 0; t < b.sec * 30; t++) { now += 1 / 30; pr.update(1 / 30, K([])); if (pr.riding) pr.view(1 / 30); }
        if (b.view === 'in') pr.update(1 / 30, K(['KeyQ']));
        const c = window.__g.cam; c.yaw = fw.cfg.yaw + (b.view === 'in' ? Math.PI : 0) + b.yawAdd; c.pitch = b.view === 'in' ? 0.05 : 0.2;
        pr.view(1 / 30);
      }, v.board);
    }
    if (v.show) {   // ショーの時計を差し替える (その時刻のまま止める)
      await page.evaluate((sh) => {
        const S = window.__pride.park.show, cfg = window.__pride.park.cfg?.show; if (!cfg) return;   // ショーの無い版 (修正前) は時計を替えない
        const F = cfg.fireworks, RISE = 1.8;
        let phase = 100;   // ショーの無い時刻 (パレード 20 秒〜のあと、花火の前)
        if (sh.parade !== undefined) phase = cfg.parade.start + sh.parade / cfg.parade.speed;
        else if (sh.fw !== undefined) {
          if (typeof sh.fw === 'number') phase = F.start + sh.fw;
          else if (sh.fw.startsWith('burst:')) phase = F.start + S.plan[+sh.fw.slice(6)].t + RISE + 1.0;
          else if (sh.fw === 'finale') { let best = 0, bt = 0; for (let t = F.duration * 0.74; t < F.duration; t += 0.2) { let n = 0; for (const b of S.plan) if (t >= b.t + RISE && t < b.t + RISE + 3.5) n++; if (n > best) { best = n; bt = t; } } phase = F.start + bt; }
          else if (sh.fw === 'end') phase = F.start + F.duration - 8 + RISE + 1.6;
        }
        window.__showClock = () => 600 * 1000 + phase;
      }, v.show);
    } else await page.evaluate(() => { window.__showClock = () => 600 * 1000 + 100; });
    await frames(3); await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(out, v.name + '.png'), timeout: 300000 });
    if (v.board) await page.evaluate(() => { window.__pride.cancel(); Date.now = window.__realNow; });
    console.log('shot', v.name, 'ground', gy.toFixed(2));
  }
  await browser.close();
  server.close();
})();
