// ステータス (public/src/status.js) の、ゲーム本体での確認 (ブラウザ)。式そのものは node tools/dev/statuscheck.mjs。
// 使い方: node tools/dev/statusgame.js <出力フォルダ>   (準備は shot.js と同じ。ページの読み込みが 1〜2 分 × 3、全体で 6〜10 分)
//   ページ A (?lv=10 でうな○ー戦): レベル 10 の HP (160) で始まる・敵に体当たりされると 20 減る・ダッシュで約 12 秒で息切れ・息切れの間は走りに落ちる・
//                                    息切れの間は攻撃を始められない・クリアで経験値と初回のボーナス (攻撃力 +0.1)・2 回目のクリアではボーナスが増えない
//                                    特殊攻撃 (K): 技ゲージ 50 を使って 4 → 5 と続く・属性の相性 (有利は倒れる、不利は体力が残る)・ゲージ不足では出ない
//                                    必殺技 (U): ゲージ満タンで 3 回転・全方位 (前後横は倒れる、真横 9 m は届かない)・出している間は無敵・ゲージ不足では出ない
//   ページ B (同じブラウザで開き直す): 保存されている (レベル・ボーナス) → リズム地獄の「吉」以上でクリア → 体力 +0.1 → メニューのステータス画面を撮る
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(__dirname, '.cache', 'package');
const VRM_DIR = path.join(__dirname, '.cache', 'vrm', 'package');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg' };
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'OK  ' : 'NG  ') + msg); if (!c) fails++; };

(async () => {
  const [out] = process.argv.slice(2);
  if (!out) { console.error('usage: node tools/dev/statusgame.js <出力フォルダ>'); process.exit(1); }
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    const p = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } }); // 2 ページで同じ localStorage を使う
  const open = async (q) => {
    const page = await ctx.newPage();
    page.setDefaultTimeout(300000);
    await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', r =>
      r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/', '')), contentType: 'application/javascript' }));
    if (fs.existsSync(VRM_DIR)) await page.route('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.3.3/**', r =>
      r.fulfill({ path: path.join(VRM_DIR, r.request().url().replace('https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.3.3/', '')), contentType: 'application/javascript' }));
    await page.route('**/src/main.js', async r => {
      const t = (await (await r.fetch()).text()).replace('const qs = new URLSearchParams', 'window.__g = { player, cam, scene, world, swarm, input, look };\n  const qs = new URLSearchParams');
      r.fulfill({ body: t, contentType: 'application/javascript' });
    });
    page.on('pageerror', e => console.log('ERR', e.message));
    page.on('console', m => { if (/rror/.test(m.text()) && !/VRM/.test(m.text())) console.log('LOG', m.text()); });
    await page.goto(base + '/' + q, { timeout: 300000 });
    await page.waitForFunction(() => window.__g && window.__status, null, { timeout: 300000 });
    await page.addStyleTag({ content: '#help{display:none!important}' });
    return page;
  };

  // ===== ページ A =====
  const A = await open('?shot&swarm&lv=10&resetsave');
  await A.evaluate(() => { const g = window.__g; g.renderSave = g.look.render; g.look.render = () => {}; });
  const ra = await A.evaluate(async () => {
    const { TOTAL } = await import('/src/swarm/event.js');
    const g = window.__g, S = g.swarm, pl = g.player, st = window.__status;
    const mk = (keys = [], press = []) => ({ pressed: (k) => press.includes(k), held: (k) => keys.includes(k), ax: 0, az: 0, endFrame() {} });
    const dt = 1 / 30;
    const tick = (inp) => { S.update(dt, inp); pl.update(dt, inp, g.cam); };
    const o = {};
    // 1. ?lv=10 で始まる
    for (let k = 0; k < 3; k++) tick(mk());
    const cs = (id) => getComputedStyle(document.getElementById(id)).display;
    o.hud = { hp: cs('hp'), sta: cs('sta'), swarmHp: cs('swarm-hp'), hpText: document.getElementById('hp').lastChild.textContent, hpW: document.getElementById('hp').firstChild.style.width, staW: document.getElementById('sta').firstChild.style.width };
    o.combat = st.combat;
    o.level = st.level; o.state = S.state; o.hpMax = S.hpMax; o.hp = S.hp; o.bar = document.getElementById('swarm-hp').firstChild.style.width;
    // 2. 体当たり 1 回 (防御 = 2 × 9 = 18 → 20 × 100/118 ≈ 16.9)
    const e = { x: pl.pos.x + 0.6, z: pl.pos.z, y: pl.pos.y, yaw: Math.atan2(-1, 0), s: 1 };
    S.inv = 0; S.strike(e);
    o.afterStrike = +S.hp.toFixed(2); o.expectStrike = +(S.hpMax - 20 * 100 / (100 + st.value('def'))).toFixed(2); o.inv = S.inv; o.invWant = st.value('inv');
    o.taken = S.taken; o.hpDelay = st.hpDelay;
    // 3. 敵を消して、ダッシュで息切れまで
    S.stop(true); S.disabled = true; pl.revive?.();
    pl.teleport(-246, 1449); for (let k = 0; k < 5; k++) pl.update(dt, mk(), g.cam);
    st.refill(); g.cam.yaw = 0;
    const run = (keys, secs) => { let t = 0; const p0 = { x: pl.pos.x, z: pl.pos.z }; for (; t < secs; t += dt) { pl.update(dt, mk(keys), g.cam); } return Math.hypot(pl.pos.x - p0.x, pl.pos.z - p0.z) / secs; };
    // (建物にぶつからないよう、同じ場所を行ったり来たりはせず、向きを変えながら短く測る)
    const speedOf = (keys) => { pl.teleport(-246, 1449); for (let k = 0; k < 6; k++) pl.update(dt, mk(), g.cam); const p0 = { x: pl.pos.x, z: pl.pos.z }; for (let k = 0; k < 15; k++) pl.update(dt, mk(keys), g.cam); return Math.hypot(pl.pos.x - p0.x, pl.pos.z - p0.z) / (15 * dt); };
    o.speedRun = +speedOf(['KeyW']).toFixed(2);
    st.refill(); o.speedDash = +speedOf(['KeyW', 'ShiftLeft']).toFixed(2);
    st.refill(); st.delay = 0;
    let t = 0; pl.teleport(-246, 1449);
    while (!st.winded && t < 40) { pl.update(dt, mk(['KeyW', 'ShiftLeft']), g.cam); t += dt; if (Math.hypot(pl.pos.x + 246, pl.pos.z - 1449) > 30) pl.teleport(-246, 1449); }
    o.dashSecs = +t.toFixed(2);
    o.windedDash = st.winded && !st.canDash();
    pl.teleport(-246, 1449); for (let k = 0; k < 6; k++) pl.update(dt, mk(), g.cam);
    o.speedWinded = +speedOf(['KeyW', 'ShiftLeft']).toFixed(2);   // ダッシュを押し続けても走り (5.5 × 速さ 1)
    // 4. 息切れの間は攻撃を始められない → 回復すると始められる
    pl.atk = null; st.stamina = 0; st.winded = true; st.delay = 0;
    pl.teleport(-246, 1449); pl.update(dt, mk([], ['KeyJ']), g.cam);
    o.atkWhileWinded = !!pl.atk;
    st.stamina = 50; st.winded = false;
    pl.update(dt, mk([], ['KeyJ']), g.cam);
    o.atkWhenOk = !!pl.atk; o.staAfterAtk = +st.stamina.toFixed(1);
    // 攻撃のダメージ: 攻撃力 140 (Lv10)・会心なしで 1 → 1.4
    o.dmgL10 = +st.rollAttack(1, { rng: () => 0.99 }).dmg.toFixed(2);
    // 4b. HP の自然回復: 戦闘の外で、傷ついて 3 秒たつと毎秒 2%
    st.combat = false; st.setHp(50); const dly = st.hpDelay; st.hpDelay = 0;
    for (let k = 0; k < 30; k++) pl.update(dt, mk(), g.cam);
    o.regen = { delayAfterHit: dly, gain: +(st.hp - 50).toFixed(2), expect: +(st.value('hp') * 0.02).toFixed(2) };
    st.setHp(50); st.combat = true; for (let k = 0; k < 30; k++) { S.update(dt, mk()); pl.update(dt, mk(), g.cam); } // うな○ー戦の最中は回復しない (S.start 済みのときだけ combat になるので、下で別に確かめる)
    o.regenInCombat = st.hp;
    // 5. クリア: 経験値・初回のボーナス → もう一度クリアしてもボーナスは増えない
    for (let k = 0; k < 40; k++) pl.update(dt, mk(), g.cam);
    S.disabled = false; S.start(); S.killed = TOTAL;
    const e0 = st.exp, b0 = st.bonus.atk || 0, a0 = st.value('atk');
    S.update(dt, mk());
    o.clear = { state: S.state, expGain: st.exp - e0, done: !!st.done.swarm, bonus: st.bonus.atk || 0, atkBefore: a0, atkAfter: +st.value('atk').toFixed(3), toast: document.getElementById('toast').textContent };
    S.stop(false); S.state = 'idle'; S.disabled = true;
    S.disabled = false; S.start(); S.killed = TOTAL;
    const e1 = st.exp; S.update(dt, mk());
    o.clear2 = { expGain: st.exp - e1, bonus: st.bonus.atk || 0 };
    S.stop(false); S.state = 'idle'; S.disabled = true;
    // やられたときも、倒した数だけ経験値
    S.disabled = false; S.start(); S.killed = 7; S.hp = 1; S.inv = 0;
    const e2 = st.exp; S.strike({ x: pl.pos.x + 0.6, z: pl.pos.z, y: pl.pos.y, yaw: Math.atan2(-1, 0), s: 1 });
    o.defeat = { state: S.state, expGain: st.exp - e2 };
    S.stop(true); S.state = 'idle'; S.disabled = true;
    // 6. 特殊攻撃 (K): 敵 1 体を目の前に置いて出す。属性の相性 (火 → 木は有利、火 → 水は不利、火 → 光は相性なし) と、技ゲージ・4 → 5 の続き
    {
      const SP = {};
      S.disabled = false; S.start(); S.spawned = TOTAL; for (const e of S.list.splice(0)) S.herd.hide(e.slot);
      st.equip = {}; st.recalc(); st.setSpElement('fire'); // 加護 (うな○ーのクリアで授かった火の加護など) を外して、相性だけを見る
      const trial = (el, gauge = 100) => {
        st.cur.crit = 0; // 会心が出ると体力が変わるので 0 に
        for (const e of S.list.splice(0)) S.herd.hide(e.slot);
        S.hp = S.hpMax; S.inv = 99; S.killed = 0;
        st.refill(); st.skill = gauge; st.delay = 0;
        pl.revive?.(); pl.atk = null; pl.act = null; pl.comboGrace = 0;
        pl.teleport(-246, 1449); pl.facing = Math.PI / 2; g.cam.yaw = pl.facing + Math.PI;
        for (let k = 0; k < 8; k++) tick(mk());
        const e = { slot: S.freeSlot(), st: 'chase', t: 0, x: pl.pos.x + Math.sin(pl.facing) * 1.6, z: pl.pos.z + Math.cos(pl.facing) * 1.6, y: pl.pos.y, yaw: pl.facing + Math.PI, s: 1,
          el, hp: 2, speed: 0, seed: 0, ph: 0, cd: 99, tint: 0, hit: -1, dx: 0, dz: 0, vx: 0, vz: 0, vy: 0, ring: { x: 0, y: 0, z: 0, r: 0 } };
        S.list.push(e);
        const g0 = st.skill;
        tick(mk([], ['KeyK']));
        const r = { started: !!pl.atk, sp: !!(pl.atk && pl.atk.sp), step0: pl.atk ? pl.atk.step : 0, gaugeUsed: +(g0 - st.skill).toFixed(1), steps: new Set(), hpAfterFirst: null, died: false, state: null, trailTint: pl._trailEl };
        for (let k = 0; k < 120 && pl.atk; k++) {
          tick(mk());
          if (pl.atk) r.steps.add(pl.atk.step);
          if (r.hpAfterFirst === null && e.hit !== -1) r.hpAfterFirst = +e.hp.toFixed(2);
        }
        r.steps = [...r.steps].sort(); r.died = e.st === 'die' || !S.list.includes(e); r.state = e.st; r.hpEnd = +e.hp.toFixed(2); r.el = el;
        return r;
      };
      SP.adv = trial('wood'); SP.dis = trial('water'); SP.neu = trial('light');
      SP.empty = trial('wood', 30);
      SP.afterGauge = +st.skill.toFixed(1);
      // 通常攻撃 (J) は、属性・特殊攻撃力に関係なく、手順どおり (1 撃目のダメージ 1 × 攻撃力 1.36)
      S.list.splice(0).forEach((e) => S.herd.hide(e.slot));
      SP.tintFn = typeof pl.model.setTrailTint === 'function';
      S.stop(true); S.state = 'idle'; S.disabled = true;
      o.special = SP;
    }
    // 7. 必殺技 (U): 必殺ゲージが満タンのとき、まわり全部 (前・後ろ・横) へ 3 回転。遠い敵には届かない。出している間は当たらない。ゲージ不足では出ない
    {
      const UL = {};
      S.disabled = false; S.start(); S.spawned = TOTAL; for (const e of S.list.splice(0)) S.herd.hide(e.slot);
      st.equip = {}; st.recalc(); st.setSpElement('fire');
      const mkE = (dx, dz, el) => ({ slot: S.freeSlot(), st: 'chase', t: 0, x: pl.pos.x + dx, z: pl.pos.z + dz, y: pl.pos.y, yaw: 0, s: 1, el, hp: 2, speed: 0, seed: 0, ph: 0, cd: 99, tint: 0, hit: -1, dx: 0, dz: 0, vx: 0, vz: 0, vy: 0, ring: { x: 0, y: 0, z: 0, r: 0 } });
      const trial = (gauge) => {
        for (const e of S.list.splice(0)) S.herd.hide(e.slot);
        S.hp = S.hpMax; S.inv = 0; S.killed = 0;
        st.refill(); st.ult = gauge; st.skill = 100; st.delay = 0;
        pl.revive?.(); pl.atk = null; pl.act = null; pl.comboGrace = 0;
        pl.teleport(-246, 1449); pl.facing = Math.PI / 2; g.cam.yaw = pl.facing + Math.PI;
        for (let k = 0; k < 8; k++) tick(mk());
        const fx = Math.sin(pl.facing), fz = Math.cos(pl.facing);
        const E = { front: mkE(fx * 1.8, fz * 1.8, 'light'), back: mkE(-fx * 2.6, -fz * 2.6, 'light'), side: mkE(fz * 3.4, -fx * 3.4, 'light'), far: mkE(fz * 9, -fx * 9, 'light') }; // 遠い敵は真横 9 m (回転斬りは前へ滑るので、正面に置くと近づかれて届く)
        for (const e of Object.values(E)) S.list.push(e);
        const n0 = pl.atkN;
        tick(mk([], ['KeyU']));
        const r = { started: !!pl.atk, ult0: pl.atk ? pl.atk.ult : 0, gaugeAfter: st.ult, invMax: 0, spins: new Set(), tint: pl._trailEl };
        for (let k = 0; k < 150 && pl.atk; k++) { tick(mk()); if (pl.atk) r.spins.add(pl.atk.ult); r.invMax = Math.max(r.invMax, S.inv); }
        r.spins = [...r.spins].sort(); r.swings = pl.atkN - n0;
        r.died = {}; for (const [k, e] of Object.entries(E)) r.died[k] = e.st === 'die' || !S.list.includes(e);
        return r;
      };
      UL.full = trial(100); UL.low = trial(60);
      S.stop(true); S.state = 'idle'; S.disabled = true;
      o.ult = UL;
    }
    o.save = localStorage.getItem('totsuka.status.v1');
    return o;
  });
  console.log(JSON.stringify(ra, null, 1));
  ok(ra.level === 10, 'A: ?lv=10 でレベル 10');
  ok(ra.hud.hp !== 'none' && ra.hud.sta !== 'none' && /^HP \d+ \/ \d+$/.test(ra.hud.hpText) && ra.hud.swarmHp === 'none', `A: HP とスタミナの帯がいつも出ている (「${ra.hud.hpText}」。うな○ー戦の中の古い帯は消えた)`);
  ok(ra.combat === true, 'A: うな○ー戦の間は combat (HP が自然回復しない)');
  ok(ra.taken === 1 && ra.hpDelay > 2.9, `A: 被弾の回数が数えられる (${ra.taken}) と、回復までの待ちが入る (${ra.hpDelay.toFixed(1)} 秒)`);
  ok(Math.abs(ra.regen.delayAfterHit - 3) < 1e-9 && Math.abs(ra.regen.gain - ra.regen.expect) < 0.4, `A: 戦闘の外では HP が毎秒 2% 回復する (1 秒で +${ra.regen.gain}、期待 +${ra.regen.expect})`);
  ok(ra.regenInCombat === 50, 'A: 戦闘中は回復しない (50 のまま)');
  ok(ra.state === 'run' && Math.abs(ra.hpMax - 161.7) < 1e-6 && Math.abs(ra.hp - 161.7) < 1e-6 && ra.bar === '100%', 'A: うな○ー戦の HP が 161.7 (レベル 10 = 100 + 6 × 9 = 154 に、胸の加護・小 +5%)');
  ok(Math.abs(ra.afterStrike - ra.expectStrike) < 0.02 && ra.afterStrike > 130 && ra.afterStrike < 162, `A: 体当たりで防御ぶん軽くなる (${ra.afterStrike}、期待 ${ra.expectStrike})`);
  ok(Math.abs(ra.inv - ra.invWant) < 1e-9, 'A: 無敵時間はステータスの値');
  ok(ra.speedRun > 4 && ra.speedRun < 5.6 && ra.speedDash > ra.speedRun * 1.6 && ra.speedDash < 10.5, `A: 走り ${ra.speedRun} m/s・ダッシュ ${ra.speedDash} m/s (0.5 秒の加速の途中を測るので 5.5・10 より小さい)`);
  ok(ra.dashSecs > 13.5 && ra.dashSecs < 15, `A: ダッシュは ${ra.dashSecs} 秒で息切れ (レベル 10 の最大スタミナ 118 ÷ 毎秒 8.33 = 約 14.2 秒)`);
  ok(ra.windedDash && Math.abs(ra.speedWinded - ra.speedRun) < 0.3, `A: 息切れの間はダッシュを押し続けても走り (${ra.speedWinded} m/s)`);
  ok(!ra.atkWhileWinded && ra.atkWhenOk, 'A: 息切れの間は攻撃を始められず、回復すると始められる');
  ok(Math.abs(ra.staAfterAtk - 44.67) < 0.2, `A: 攻撃 1 回でスタミナ 6 (50 + 回復 0.67 - 6 = 44.67。結果 ${ra.staAfterAtk})`);
  ok(Math.abs(ra.dmgL10 - 1.36) < 0.01, `A: 攻撃力 136 → 1 ダメージが ${ra.dmgL10}`);
  ok(ra.clear.state === 'ending' && ra.clear.done && Math.abs(ra.clear.bonus - 0.1) < 1e-9 && ra.clear.expGain === 600, `A: クリアで経験値 +${ra.clear.expGain} (100 体 × 5 + 100) と攻撃力ボーナス +0.1`);
  ok(ra.clear.atkAfter > ra.clear.atkBefore, `A: 攻撃力 ${ra.clear.atkBefore} → ${ra.clear.atkAfter}`);
  ok(/経験値/.test(ra.clear.toast) && /ボーナス/.test(ra.clear.toast), `A: お知らせ「${ra.clear.toast}」`);
  ok(ra.clear2.expGain === 600 && Math.abs(ra.clear2.bonus - 0.1) < 1e-9, 'A: 2 回目のクリアは経験値だけ、ボーナスは増えない');
  ok(ra.defeat.state === 'down' && ra.defeat.expGain === 35, `A: やられても倒した 7 体ぶん経験値 +${ra.defeat.expGain}`);
  ok(!!ra.save && JSON.parse(ra.save).done.swarm === true, 'A: 保存された');
  ok(JSON.parse(ra.save).blessings.includes('armR:fire:2') && JSON.parse(ra.save).blessings.includes('head:water:1') && JSON.parse(ra.save).blessings.includes('chest:light:1'), 'A: 加護が保存された (Lv5・Lv10 の加護と、うな○ーの初クリアの加護)');
  const sp = ra.special;
  console.log(JSON.stringify(sp));
  ok(sp.adv.started && sp.adv.sp && sp.adv.step0 === 4 && sp.adv.steps.includes(5), 'A: K で特殊攻撃が始まり、4 (跳び斬り上げ) から 5 (急降下の十字斬り) へ続く');
  ok(Math.abs(sp.adv.gaugeUsed - 50) < 1, `A: 技ゲージを 50 使う (${sp.adv.gaugeUsed})`);
  ok(sp.adv.died && sp.adv.hpAfterFirst !== null && sp.adv.hpAfterFirst <= 0, `A: 有利 (火 → 木) は 1 撃目で倒れる (残り体力 ${sp.adv.hpAfterFirst})`);
  ok(sp.dis.hpAfterFirst !== null && sp.dis.hpAfterFirst > 0 && sp.dis.hpAfterFirst < 0.5, `A: 不利 (火 → 水) は 1 撃目では倒れず、体力が少し残る (${sp.dis.hpAfterFirst}。2 − 2×1.5×1.18×0.5)`);
  ok(sp.neu.hpAfterFirst !== null && sp.neu.hpAfterFirst <= 0 && sp.neu.died, `A: 相性なし (火 → 光) は 1 撃目で倒れる (${sp.neu.hpAfterFirst})`);
  ok(!sp.empty.started, 'A: 技ゲージが足りない (30) と、K を押しても始まらない');
  ok(sp.tintFn && sp.adv.trailTint === 'fire', 'A: 特殊攻撃の間、剣の軌跡の属性の色を切り替える');
  const ul = ra.ult;
  console.log(JSON.stringify(ul));
  ok(ul.full.started && ul.full.ult0 === 1 && ul.full.gaugeAfter === 0, 'A: U で必殺技が始まり、必殺ゲージが 0 になる');
  ok(ul.full.swings === 3 && ul.full.spins.includes(2) && ul.full.spins.includes(3), `A: 回転斬りが 3 回続く (${ul.full.swings} 回振る)`);
  ok(ul.full.died.front && ul.full.died.back && ul.full.died.side && !ul.full.died.far, `A: 前・後ろ・横の敵は倒れ、遠い敵 (真横 9 m) には届かない (${JSON.stringify(ul.full.died)})`);
  ok(ul.full.invMax >= 0.3, `A: 必殺技の間は当たらない (無敵 ${ul.full.invMax.toFixed(2)} 秒)`);
  ok(!ul.low.started, 'A: 必殺ゲージが 60 では出ない');
  ok(ul.full.tint === 'fire', 'A: 必殺技の剣の軌跡も属性の色');

  await A.close();

  // ===== ページ B (開き直し) =====
  const B = await open('?shot&rhythm');
  const rb = await B.evaluate(async () => {
    const st = window.__status, R = window.__rhythm;
    const o = { level: st.level, exp: st.exp, bonusAtk: st.bonus.atk, doneSwarm: !!st.done.swarm };
    await new Promise((res) => { const t = setInterval(() => { if (R.state === 'play') { clearInterval(t); res(); } }, 200); setTimeout(res, 60000); });
    o.rhythmState = R.state;
    R.autoPlay = false;
    const e0 = st.exp; const h0 = st.value('hp');
    for (const g of R.chart.targets) g.res = 'good';
    R.finish();
    o.rhythm = { expGain: st.exp - e0, done: !!st.done.rhythm, bonusHp: st.bonus.hp || 0, hpBefore: h0, hpAfter: st.value('hp') };
    // 凶 (吉に届かない) ではクリアにならない: 別の状態でもう一度は結果画面からなので、ここでは数式だけ
    return o;
  });
  console.log(JSON.stringify(rb, null, 1));
  ok(rb.exp === JSON.parse(ra.save).exp && rb.level === 12 && rb.doneSwarm && Math.abs(rb.bonusAtk - 0.1) < 1e-9, `B: 開き直しても、経験値 ${rb.exp}・レベル ${rb.level}・クリア済み・ボーナスが残っている (A で 600 × 2 入ってレベル 10 → 12)`);
  ok(rb.rhythmState === 'play' && rb.rhythm.done && rb.rhythm.expGain === 60 && Math.abs(rb.rhythm.bonusHp - 0.1) < 1e-9 && rb.rhythm.hpAfter > rb.rhythm.hpBefore, `B: リズム地獄で「吉」以上 → 経験値 +${rb.rhythm.expGain}・最大 HP ボーナス +0.1 (${rb.rhythm.hpBefore} → ${rb.rhythm.hpAfter})`);
  // メニューのステータス画面
  await B.evaluate(() => { window.__rhythm.stop?.(); });
  await B.screenshot({ path: path.join(out, 'hud.png') }); // 街の画面 (メニューを開く前)。HP とスタミナの帯が出ている
  await B.keyboard.press('Tab');
  await B.waitForFunction(() => !document.getElementById('menu').hidden);
  ok(await B.evaluate(() => !!document.querySelector('#menu [data-do=status]')), 'B: メニューに「ステータス」がある');
  await B.click('[data-do=status]');
  await B.waitForFunction(() => /ステータス/.test(document.querySelector('#menu .mn-head b').textContent));
  const txt = await B.evaluate(() => document.getElementById('menu').innerText);
  ok(/Lv 12/.test(txt) && /最大HP/.test(txt) && /防御力/.test(txt) && /会心率/.test(txt) && /回復速度/.test(txt) && /必殺ゲージ最大/.test(txt) && /移動速度/.test(txt) && /リズム地獄/.test(txt), 'B: ステータス画面に、レベル・各項目・イベントのボーナスが並ぶ');
  await B.screenshot({ path: path.join(out, 'status_menu.png') });
  await B.evaluate(() => { const m = document.getElementById('menu'); m.scrollTop = m.scrollHeight; });
  await B.screenshot({ path: path.join(out, 'status_menu_bottom.png') });
  await B.keyboard.press('Escape');
  ok(await B.evaluate(() => /メニュー/.test(document.querySelector('#menu .mn-head b').textContent)), 'B: Esc でメニューに戻る');
  // HP とスタミナの帯: いつも出ていて、撮影モードでは出ない
  const hudN = await B.evaluate(() => { const c = (id) => getComputedStyle(document.getElementById(id)).display; return { hp: c('hp'), sta: c('sta') }; });
  ok(hudN.hp !== 'none' && hudN.sta !== 'none', 'B: 街でも HP とスタミナの帯が出ている (満タンでも)');
  const hudP = await B.evaluate(() => { document.body.classList.add('photo'); const c = (id) => getComputedStyle(document.getElementById(id)).display; const r = { hp: c('hp'), sta: c('sta'), skl: c('skl') }; document.body.classList.remove('photo'); return r; });
  ok(hudP.hp === 'none' && hudP.sta === 'none', '撮影モードでは HP とスタミナの帯が消える'.replace('撮影', 'B: 撮影'));
  // 加護の画面: 部位のタブ・授かった加護の一覧・宿し替え・外す (Lv10 までの加護 2 つ + うな○ー・リズム地獄のクリアで 2 つ)
  await B.click('[data-do=bless]');
  await B.waitForFunction(() => /加護/.test(document.querySelector('#menu .mn-head b').textContent));
  ok(await B.evaluate(() => document.querySelectorAll('#menu .mn-tab').length === 6), 'B: 加護の画面に部位のタブが 6 つ (頭・胸・右腕・左腕・脚・足)');
  await B.click('[data-bslot=chest]');
  const ch = await B.evaluate(() => ({ n: document.querySelectorAll('#menu [data-bless]').length, text: document.getElementById('menu').innerText, eq: window.__status.equip.chest }));
  ok(ch.n === 2 && /光の加護（胸・中）/.test(ch.text) && /光の加護（胸・小）/.test(ch.text) && ch.eq === 'chest:light:1', `B: 胸に 2 つ授かっていて (中・小)、小を宿している (${ch.eq})`);
  await B.screenshot({ path: path.join(out, 'bless_menu.png') });
  await B.click('[data-bless="chest:light:2"]');
  const eq2 = await B.evaluate(() => ({ eq: window.__status.equip.chest, hp: window.__status.value('hp'), saved: JSON.parse(localStorage.getItem('totsuka.status.v1')).equip.chest }));
  ok(eq2.eq === 'chest:light:2' && eq2.saved === 'chest:light:2', `B: 中を選ぶと宿し替わり、保存される (最大 HP ${eq2.hp})`);
  await B.click('[data-bless="chest:light:2"]');
  ok(await B.evaluate(() => !window.__status.equip.chest), 'B: 宿している加護をもう一度選ぶと外れる');
  await B.keyboard.press('Escape');
  ok(await B.evaluate(() => /メニュー/.test(document.querySelector('#menu .mn-head b').textContent)), 'B: Esc でメニューに戻る (加護)');
  await browser.close(); server.close();
  console.log(fails ? `\n${fails} 件 NG` : '\nすべて OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
