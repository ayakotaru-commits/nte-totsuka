// 持ち物 (お金・買った服・着ている服) と保存。端末のブラウザ (localStorage) にだけ保存する。
// 服の一覧は data/outfits.json (id・名前・店・値段・ファイル)。お金は円。
// 試すための URL: ?money=10000 (所持金をその額にする)、?own=all (全部持っている)、?outfit=<id> (その服を着る)、?resetsave (保存を消す)
const KEY = 'totsuka.save.v1';
export const START_MONEY = 3000; // はじめて遊ぶときの所持金

export class Wardrobe {
  constructor(catalog) {
    this.items = catalog.outfits;
    this.byId = new Map(this.items.map((o) => [o.id, o]));
    this.money = START_MONEY;
    this.owned = new Set();   // 買った服の id (「いつもの服」は数えない。いつでも着られる)
    this.equipped = 'default';
    this.listeners = [];
    const q = new URLSearchParams(location.search);
    if (q.has('resetsave')) { try { localStorage.removeItem(KEY); } catch (e) { /* 保存できない環境 */ } }
    this.load();
    if (q.has('money')) this.money = Math.max(0, +q.get('money') || 0);
    if (q.get('own') === 'all') for (const o of this.items) this.owned.add(o.id);
    if (q.has('outfit') && this.byId.has(q.get('outfit'))) { this.owned.add(q.get('outfit')); this.equipped = q.get('outfit'); }
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!s) return;
      if (Number.isFinite(s.money)) this.money = Math.max(0, Math.floor(s.money));
      for (const id of s.owned || []) if (this.byId.has(id)) this.owned.add(id);
      if (s.equipped === 'default' || this.owned.has(s.equipped)) this.equipped = s.equipped;
    } catch (e) { /* 読めなければ最初から */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, money: this.money, owned: [...this.owned], equipped: this.equipped })); } catch (e) { /* 保存できない環境 (プライベートモードなど) */ }
  }

  onChange(fn) { this.listeners.push(fn); }
  changed() { this.save(); for (const f of this.listeners) f(this); }

  has(id) { return id === 'default' || this.owned.has(id); }

  // 服のファイルの URL (いつもの服は null)
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

  equip(id) {
    if (!this.has(id)) return false;
    this.equipped = id; this.changed();
    return true;
  }
}

export async function loadWardrobe() {
  const cat = await fetch('data/outfits.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return new Wardrobe(cat || { outfits: [] });
}

export const yen = (n) => n.toLocaleString('ja-JP') + ' 円';
