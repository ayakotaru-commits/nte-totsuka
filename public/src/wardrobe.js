// 持ち物 (お金・買った服・着ている服) と保存。端末のブラウザ (localStorage) にだけ保存する。
// 服は パーツごと (data/outfits.json: id・名前・枠・店・値段・ファイル)。枠は tops / bottoms / shoes / onepiece。
//   着ている服 worn = { tops, bottoms, shoes, onepiece } (null = 「いつもの」。ワンピースの null = 着ていない)。
//   ワンピース (ドレス・浴衣) は トップスとボトムスの両方の枠を使う: 着ると 2 つを外し、トップス・ボトムスを着ると外す。
// 試すための URL: ?money=10000 (所持金をその額にする)、?own=all (全部持っている)、?outfit=<id>,<id> (その服を着る)、?resetsave (保存を消す)
const KEY = 'totsuka.save.v1';
export const START_MONEY = 3000; // はじめて遊ぶときの所持金
export const SLOTS = ['tops', 'bottoms', 'shoes', 'onepiece'];

// 以前の保存 (v1) は「セット」の id を持っていた → 今のパーツに置き換える
const V1_SETS = {
  lyla_hoodie: ['lyla_hoodie', 'lyla_shorts', 'lyla_boots'], lyla_tank: ['lyla_tank'],
  nona_tshirt: ['nona_tshirt', 'nona_shorts', 'nona_sandals'], nishi_dress: ['nishi_dress', 'nishi_shoes'],
  tanuki_yukata: ['tanuki_yukata', 'tanuki_geta'], celestia_dress: ['celestia_dress', 'celestia_boots'],
};

export class Wardrobe {
  constructor(catalog) {
    this.items = catalog.outfits;
    this.slots = catalog.slots || SLOTS.map((k) => ({ key: k, name: k }));
    this.byId = new Map(this.items.map((o) => [o.id, o]));
    this.money = START_MONEY;
    this.owned = new Set();   // 買った服の id (「いつもの」は数えない。いつでも着られる)
    this.worn = { tops: null, bottoms: null, shoes: null, onepiece: null };
    this.body = 'female';     // 今の体 (キャラメイク)。服の body (female / male。無ければ female) が合うものだけ、一覧・店に出て、着られる (女性の体は男性の服も可)
    this.listeners = [];
    const q = new URLSearchParams(location.search);
    if (q.has('resetsave')) { try { localStorage.removeItem(KEY); } catch (e) { /* 保存できない環境 */ } }
    this.load();
    if (q.has('money')) this.money = Math.max(0, +q.get('money') || 0);
    if (q.get('own') === 'all') for (const o of this.items) this.owned.add(o.id);
    if (q.has('outfit')) for (const id of q.get('outfit').split(',')) if (this.byId.has(id)) { this.owned.add(id); this.equip(id, false); }
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!s) return;
      if (Number.isFinite(s.money)) this.money = Math.max(0, Math.floor(s.money));
      const ids = (a) => (a || []).flatMap((id) => (V1_SETS[id] && s.v !== 2 ? V1_SETS[id] : [id])).filter((id) => this.byId.has(id));
      for (const id of ids(s.owned)) this.owned.add(id);
      const worn = s.v === 2 ? Object.values(s.worn || {}) : ids(s.equipped && s.equipped !== 'default' ? [s.equipped] : []);
      for (const id of worn) if (this.owned.has(id)) this.equip(id, false);
    } catch (e) { /* 読めなければ最初から */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 2, money: this.money, owned: [...this.owned], worn: this.worn })); } catch (e) { /* 保存できない環境 (プライベートモードなど) */ }
  }

  onChange(fn) { this.listeners.push(fn); }
  changed() { this.save(); for (const f of this.listeners) f(this); }

  has(id) { return this.owned.has(id); }
  isWorn(id) { return Object.values(this.worn).includes(id); }
  slotOf(id) { return this.byId.get(id)?.slot; }

  // 枠ごとの、服のファイルの URL (いつもの = null)
  urls() {
    const u = {};
    for (const k of SLOTS) u[k] = this.worn[k] && this.fits(this.byId.get(this.worn[k])) ? this.urlOf(this.worn[k]) : null;
    return u;
  }

  // 試着: その服を着たときの、枠ごとの URL (持っていなくてよい。worn・保存は変えない)。排他は equip() と同じ
  urlsWith(id) {
    const o = this.byId.get(id);
    if (!o || !this.fits(o)) return this.urls();
    const w = { ...this.worn };
    if (o.slot === 'onepiece') { w.onepiece = id; w.tops = null; w.bottoms = null; }
    else { w[o.slot] = id; if (o.slot !== 'shoes') w.onepiece = null; }
    const u = {};
    for (const k of SLOTS) u[k] = w[k] && this.fits(this.byId.get(w[k])) ? this.urlOf(w[k]) : null;
    return u;
  }

  // 服が今の体に合うか。女性の体は男性の服も着られる (持ち主の判断)。男性の体は男性の服だけ
  fits(o) { return !!o && (this.body === 'female' || (o.body || 'female') === this.body); }

  // 体が変わった (キャラメイク)。合わない服は脱ぐ (持ち物は残る。体を戻せばまた着られる)
  setBody(body, notify = true) {
    this.body = body;
    for (const k of SLOTS) if (this.worn[k] && !this.fits(this.byId.get(this.worn[k]))) this.worn[k] = null;
    if (notify) this.changed();
  }

  urlOf(id) {
    const o = this.byId.get(id);
    return o ? new URL('../models/outfits/' + o.file, import.meta.url).href : null;
  }

  addMoney(n) { this.money += Math.max(0, Math.floor(n)); this.changed(); }

  // 買う。成功すると { ok: true }。お金が足りない・もう持っている・無い服は { ok: false, reason }
  buy(id) {
    const o = this.byId.get(id);
    if (!o) return { ok: false, reason: 'ない服です' };
    if (this.owned.has(id)) return { ok: false, reason: 'もう持っています' };
    if (this.money < o.price) return { ok: false, reason: 'お金が足りません' };
    this.money -= o.price; this.owned.add(id); this.changed();
    return { ok: true };
  }

  // 着る (持っている服だけ)。ワンピースを着ると トップス・ボトムスを外し、トップス・ボトムスを着るとワンピースを外す
  equip(id, notify = true) {
    const o = this.byId.get(id);
    if (!o || !this.owned.has(id)) return false;
    if (o.slot === 'onepiece') { this.worn.onepiece = id; this.worn.tops = null; this.worn.bottoms = null; }
    else { this.worn[o.slot] = id; if (o.slot !== 'shoes') this.worn.onepiece = null; }
    if (notify) this.changed();
    return true;
  }

  // 枠を「いつもの」に戻す (ワンピースの枠は、脱ぐ)
  unequip(slot) {
    if (!(slot in this.worn)) return;
    this.worn[slot] = null;
    this.changed();
  }
}

export async function loadWardrobe() {
  const cat = await fetch('data/outfits.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return new Wardrobe(cat || { outfits: [] });
}

export const yen = (n) => n.toLocaleString('ja-JP') + ' 円';
