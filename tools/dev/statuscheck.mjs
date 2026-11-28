// ステータス (public/src/status.js) の式の確認。node tools/dev/statuscheck.mjs
import { Status, SKILL, ULT, elementRGB, elementMul, levelFromExp, expForLevel, expNeed, MAX_LV, COST, STATS, BONUS_EVENTS, ELEMENTS } from '../../public/src/status.js';

let bad = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('NG ', m); } else console.log('ok ', m); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// 1. 基準値 (レベル 1・ボーナス 0) は、以前の固定値と同じ
const s = new Status();
ok(s.level === 1 && s.value('hp') === 100, 'Lv1 の HP 100');
ok(s.hurtAmount(20) === 20, '防御 0 のとき体当たり 20');
ok(s.value('inv') === 1 && s.value('speed') === 1, '無敵 1.0 秒・速さ ×1');
ok(s.rollAttack(1, { rng: () => 0.99 }).dmg === 1 && s.rollAttack(2, { rng: () => 0.99 }).dmg === 2, '攻撃力 100 で手順どおりのダメージ (会心なし)');
ok(near(s.rollAttack(2, { rng: () => 0 }).dmg, 3), '会心 (×1.5)');

// 2. 属性 (パズドラ)
const E = (a, d) => elementMul(a, d);
ok(E('fire', 'wood') === 2 && E('wood', 'water') === 2 && E('water', 'fire') === 2, '火→木→水→火 は有利 ×2');
ok(E('wood', 'fire') === 0.5 && E('water', 'wood') === 0.5 && E('fire', 'water') === 0.5, '逆は不利 ×0.5');
ok(E('light', 'dark') === 2 && E('dark', 'light') === 2, '光⇄闇 は有利 ×2');
ok(E('light', 'fire') === 1 && E('fire', 'light') === 1 && E('dark', 'wood') === 1, '光闇とほかは相性なし');
ok(E(null, 'fire') === 1 && E('fire', null) === 1 && E('fire', 'fire') === 1, '無属性・同属性は ×1');
ok(ELEMENTS.length === 5, '属性は 5 つ');

// 3. レベル
ok(levelFromExp(0).lv === 1 && levelFromExp(99).lv === 1 && levelFromExp(100).lv === 2, '100 でレベル 2');
ok(levelFromExp(expForLevel(10)).lv === 10 && levelFromExp(expForLevel(10) - 1).lv === 9, 'expForLevel の往復');
ok(levelFromExp(1e9).lv === MAX_LV, '上限');
const l = levelFromExp(100 + 150 + 40);
ok(l.lv === 3 && l.into === 40 && l.need === expNeed(3), '途中の経験値 (Lv3 で 40/200)');
s.exp = expForLevel(11); s.recalc();
ok(s.value('hp') === 100 + 6 * 10 && s.value('atk') === 100 + 4 * 10, 'Lv11: HP 160・攻撃 140');
ok(near(s.hurtAmount(20), 20 * 100 / (100 + 20)), 'Lv11: 防御 20 で被ダメージが減る');

// 4. ボーナス: 初回だけ +0.1。1.0 = unit の 10%
const t = new Status();
const a = t.clearEvent('swarm'), b = t.clearEvent('swarm');
ok(a.first && a.stat === 'atk' && !b.first, '初回だけ・攻撃力に入る');
ok(near(t.bonus.atk, 0.1) && near(t.value('atk'), 101), 'ボーナス +0.1 → 攻撃力 100 + 100×10%×0.1 = 101');
ok(!t.clearEvent('nothing').first, '知らないイベントは何もしない');
for (const id of Object.keys(BONUS_EVENTS)) t.clearEvent(id);
ok(Object.keys(BONUS_EVENTS).every((k) => t.done[k]) && near(t.bonus.hp, 0.1) && near(t.bonus.stamina, 0.1), '3 イベントとも対応する項目へ');
ok(near(t.value('hp'), 101) && near(t.value('stamina'), 101), 'HP・スタミナ 101');
for (let i = 0; i < 12; i++) { t.bonus.crit = Math.round(((t.bonus.crit || 0) + 0.1) * 10) / 10; } t.recalc();
ok(near(t.bonus.crit, 1.2), '0.1 の足し算が浮動小数の誤差を持たない');

// 5. 加護の口
const g = new Status();
g.setSource('head', { atk: { flat: 20 }, hp: { pct: 0.1 } });
ok(near(g.value('atk'), 120) && near(g.value('hp'), 110), '加護: 足し算 +20・割合 +10%');
g.setSource('head', null);
ok(g.value('atk') === 100 && g.value('hp') === 100, '外すと戻る');

// 6. スタミナ
const p = new Status();
let dashed = 0;
while (p.canDash() && dashed < 60) { p.tick(1 / 60); p.drainDash(1 / 60); dashed += 1 / 60; }
ok(dashed > 11.5 && dashed < 12.5 && p.winded, `ダッシュは約 12 秒で息切れ (${dashed.toFixed(2)} 秒)`);
ok(!p.canDash() && !p.canSpend(), '息切れ中はダッシュ・パルクール・攻撃ができない');
let rec = 0;
while (p.winded && rec < 30) { p.tick(1 / 60); rec += 1 / 60; }
ok(rec > 0.7 && rec < 2, `息切れから約 ${rec.toFixed(2)} 秒で動ける (待ち 0.7 秒 + 20 まで回復)`);
let full = 0;
while (p.stamina < p.value('stamina') - 1e-6 && full < 30) { p.tick(1 / 60); full += 1 / 60; }
ok(full + rec > 4.5 && full + rec < 5.7, `0 から約 ${(full + rec).toFixed(2)} 秒で全快`);
const q = new Status();
q.spend(COST.parkour); q.spend(COST.atk);
ok(near(q.stamina, 100 - 10 - 6), 'パルクール 10・攻撃 6');
const before = q.stamina; q.tick(0.5);
ok(q.stamina === before, '使った直後 (0.7 秒) は回復しない');
q.bonus.staSave = 1; q.cur.staSave = 0.5; q.stamina = 100; q.spend(10);
ok(near(q.stamina, 95), '消費軽減 50% で消費が半分');
q.stamina = 1; q.spend(50);
ok(q.stamina === 0 && q.winded, '足りないときは 0 で息切れ');
const r = new Status(); r.exp = expForLevel(6); r.recalc();
ok(r.value('stamina') === 110, 'Lv6 で最大スタミナ 110');

// 7. 項目の表が揃っている
ok(Object.values(STATS).every((x) => x.name && x.group && 'base' in x && 'unit' in x), '全項目に名前・見出し・基本値・unit');

// 8. 経験値の通知
const n = new Status(); const log = []; n.onNotice = (m) => log.push(m);
ok(n.addExp(99) === 0 && n.addExp(1) === 2, '100 でレベルアップ (Lv 2 を返す)');
ok(log.length === 2 && log[1].includes('レベルアップ'), '通知に「レベルアップ」');
// 9. 特殊攻撃: 技ゲージ・属性
const k = new Status();
ok(k.skill === 100 && k.canSkill(), '技ゲージは満タンから始まり、撃てる');
k.useSkill(); ok(k.skill === 50 && k.canSkill(), '1 回で 50 減る (まだ 1 回撃てる)');
k.useSkill(); ok(k.skill === 0 && !k.canSkill(), '2 回で空・撃てない');
for (let i = 0; i < 600; i++) k.tick(1 / 60);
ok(near(k.skill, 50, 0.01) && k.canSkill(), `10 秒で 50 回復 (毎秒 5) → また撃てる (${k.skill.toFixed(2)})`);
k.winded = true; ok(!k.canSkill(), '息切れの間は撃てない');
const e1 = k.rollAttack(3, { power: 'spAtk', element: 'fire', target: 'wood', rng: () => 0.99 });
ok(near(e1.dmg, 6) && e1.mul === 2, '特殊攻撃力 100・火 → 木 (有利) は ×2');
const e2 = k.rollAttack(3, { power: 'spAtk', element: 'fire', target: 'water', rng: () => 0.99 });
ok(near(e2.dmg, 1.5) && e2.mul === 0.5, '火 → 水 (不利) は ×0.5');
const e3 = k.rollAttack(3, { power: 'spAtk', element: 'fire', target: 'light', rng: () => 0.99 });
ok(near(e3.dmg, 3) && e3.mul === 1, '火 → 光 は相性なし');
k.exp = expForLevel(11); k.recalc();
ok(near(k.rollAttack(3, { power: 'spAtk', rng: () => 0.99 }).dmg, 3 * 1.2), 'Lv11 の特殊攻撃力 120 が掛かる (通常の攻撃力 140 ではない)');
ok(k.spElement === 'fire' && k.setSpElement('water') && k.spElement === 'water' && !k.setSpElement('water') && !k.setSpElement('xxx') && k.spElement === 'water', '特殊攻撃の属性を選べる (同じ・知らない属性は変えない)');
ok(SKILL.cost === 50 && SKILL.mult[4] === 1.5 && SKILL.mult[5] === 2, '消費 50・倍率 4 → ×1.5、5 → ×2');
ok(elementRGB('fire').length === 3 && elementRGB('fire')[0] > 0.9 && elementRGB('nothing').every((v) => v === 1), '属性の RGB');

// 10. 必殺技: 必殺ゲージ
const u = new Status();
ok(u.ult === 0 && !u.canUlt(), '必殺ゲージは 0 から始まり、撃てない');
u.gainUlt(40); u.gainUlt(40); ok(u.ult === 80 && !u.canUlt(), '80 では撃てない');
u.gainUlt(40); ok(u.ult === 100 && u.canUlt(), '満タン (100 で止まる) で撃てる');
u.winded = true; ok(!u.canUlt(), '息切れの間は撃てない'); u.winded = false;
u.useUlt(); ok(u.ult === 0 && !u.canUlt(), '撃つと 0');
u.bonus.ultGain = 1; u.cur.ultGain = 1.5; u.gainUlt(10); ok(near(u.ult, 15), '溜まりやすさ ×1.5');
ok(ULT.spins === 3 && ULT.mult === 2.5 && ULT.reach > 5, '必殺技: 3 回転・×2.5・半径 5.5 m');
const w = new Status(); w.exp = expForLevel(11); w.recalc();
ok(near(w.rollAttack(2, { power: 'ultAtk', rng: () => 0.99 }).dmg, 2 * 1.3), 'Lv11 の必殺技力 130 が掛かる');

console.log(bad ? `\n${bad} 件 NG` : '\nすべて OK');
process.exit(bad ? 1 : 0);
