// 加護: 体の部位に宿して、能力を上げる (服にはステータスの効果は付けない。持ち主の方針)。画面にも three.js にも依存しない部品。
//   ・部位 (SLOTS) は 6 つ、各部位に 1 つだけ宿せる。加護 = 部位 + 属性 + 段階 (tier 1〜3)。部位 6 × 属性 5 × 段階 3 = 90 種を式で作る (個別の定義は書かない)
//   ・効果 = 部位ごとの能力 (SLOT_MODS) × 段階 + その属性の攻撃力・耐性 (ELEM_ATK・ELEM_RES) × 段階
//       属性の攻撃力 = 特殊攻撃・必殺技の、その属性の攻撃のダメージ +%。属性の耐性 = その属性の敵から受けるダメージ -%
//   ・授かる: イベントの初クリア (EVENT_GRANTS) と、5 レベルごと (levelGrants)。順番どおりに決まっている (ランダムではない)
//   ・見た目 (部位が光る) は未実装

export const SLOTS = [
  { key: 'head', name: '頭' }, { key: 'chest', name: '胸' }, { key: 'armR', name: '右腕' },
  { key: 'armL', name: '左腕' }, { key: 'legs', name: '脚' }, { key: 'feet', name: '足' },
];
export const ELEMENT_KEYS = ['fire', 'water', 'wood', 'light', 'dark'];
export const TIER_NAME = ['', '小', '中', '大'];
export const ELEM_ATK = 0.06, ELEM_RES = 0.06;   // 段階 1 あたりの、属性の攻撃力・耐性

// 部位ごとの能力 (段階 1 あたり)。flat = 足し算、pct = 割合
export const SLOT_MODS = {
  head:  { crit: { flat: 0.02 }, critDmg: { flat: 0.05 } },
  chest: { hp: { pct: 0.05 }, def: { flat: 4 } },
  armR:  { atk: { pct: 0.05 } },
  armL:  { spAtk: { pct: 0.06 }, ultAtk: { pct: 0.06 } },
  legs:  { stamina: { pct: 0.05 }, speed: { pct: 0.02 } },
  feet:  { staRegen: { pct: 0.06 }, staSave: { flat: 0.02 } },
};

const ELEM_NAME = { fire: '火', water: '水', wood: '木', light: '光', dark: '闇' };
export const idOf = (slot, el, tier) => `${slot}:${el}:${tier}`;
export function parse(id) {
  const [slot, el, t] = String(id).split(':'), tier = +t;
  if (!SLOTS.some((s) => s.key === slot) || !ELEM_NAME[el] || !(tier >= 1 && tier <= 3)) return null;
  return { id, slot, el, tier, name: `${ELEM_NAME[el]}の加護（${SLOTS.find((s) => s.key === slot).name}・${TIER_NAME[tier]}）` };
}

// 加護の効果: { stat: { flat, pct } } (status.js の項目) と、属性の攻撃力・耐性 { el, atk, res }
export function effectOf(id) {
  const b = parse(id);
  if (!b) return null;
  const mods = {};
  for (const [k, m] of Object.entries(SLOT_MODS[b.slot])) mods[k] = { flat: (m.flat || 0) * b.tier, pct: (m.pct || 0) * b.tier };
  return { mods, el: b.el, atk: ELEM_ATK * b.tier, res: ELEM_RES * b.tier };
}

// 効果の説明 (画面用)
export function describe(id) {
  const b = parse(id), e = effectOf(id);
  if (!b) return '';
  const P = { hp: '最大HP', def: '防御力', atk: '攻撃力', crit: '会心率', critDmg: '会心ダメージ', stamina: '最大スタミナ', staRegen: '回復速度', staSave: '消費軽減', spAtk: '特殊攻撃力', ultAtk: '必殺技力', speed: '移動速度' };
  const parts = [];
  for (const [k, m] of Object.entries(e.mods)) {
    if (m.pct) parts.push(`${P[k]} +${Math.round(m.pct * 100)}%`);
    if (m.flat) parts.push(`${P[k]} +${k === 'def' ? m.flat : Math.round(m.flat * 1000) / 10 + '%'}`);
  }
  parts.push(`${ELEM_NAME[b.el]}属性の特殊攻撃・必殺技 +${Math.round(e.atk * 100)}%`, `${ELEM_NAME[b.el]}属性の敵から受けるダメージ -${Math.round(e.res * 100)}%`);
  return parts.join('、');
}

export const allBlessings = () => SLOTS.flatMap((s) => ELEMENT_KEYS.flatMap((el) => [1, 2, 3].map((t) => idOf(s.key, el, t))));

// イベントの初クリアで授かる加護 (段階 2)
export const EVENT_GRANTS = {
  swarm: idOf('armR', 'fire', 2),     // うな○ー: 右腕・火
  rhythm: idOf('chest', 'light', 2),  // リズム地獄 (八坂神社): 胸・光
  arcade: idOf('feet', 'wood', 2),    // ゲームセンター: 足・木
};

// レベルが上がったとき (5 の倍数) に授かる加護。部位を順にめぐり、属性も順にめぐる。レベル 25 から段階 2、45 から段階 3
export function levelGrant(lv) {
  if (lv < 5 || lv % 5) return null;
  const n = lv / 5 - 1;
  return idOf(SLOTS[n % SLOTS.length].key, ELEMENT_KEYS[(n * 2 + 1) % ELEMENT_KEYS.length], lv >= 45 ? 3 : lv >= 25 ? 2 : 1);
}
