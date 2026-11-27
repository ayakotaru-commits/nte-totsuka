// キャラメイク: 選んだ髪型の保存。端末のブラウザ (localStorage) にだけ保存する (服の wardrobe.js と同じ)。
// 髪の一覧は models/hairs/hairs.json (id・名前・合う体・tune)。髪のファイルは models/hairs/<id>.glb (tools/hairs.py で作る)。
// 試すための URL: ?hair=<id> (その髪にする。保存はしない)、?hair=none (いつもの髪)、?resetsave (保存を消す。wardrobe.js と共通)
const KEY = 'totsuka.look.v1';

export class HairStyle {
  constructor(catalog) {
    this.hairs = catalog.hairs || [];
    this.byId = new Map(this.hairs.map((h) => [h.id, h]));
    this.id = null;          // 選んでいる髪の id (null = いつもの髪)
    this.listeners = [];
    const q = new URLSearchParams(location.search);
    if (q.has('resetsave')) { try { localStorage.removeItem(KEY); } catch (e) { /* 保存できない環境 */ } }
    this.load();
    if (q.has('hair')) this.id = this.byId.has(q.get('hair')) ? q.get('hair') : null; // 試し用。保存はしない
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && this.byId.has(s.hair)) this.id = s.hair; // 一覧から消えた髪 (使わなくなったもの) は、いつもの髪に戻す
    } catch (e) { /* 読めなければ最初から */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, hair: this.id })); } catch (e) { /* 保存できない環境 (プライベートモードなど) */ }
  }

  onChange(fn) { this.listeners.push(fn); }

  // 選んでいる髪の一覧の 1 件 (いつもの髪なら null)
  entry() { return this.id ? this.byId.get(this.id) : null; }

  // 髪を選ぶ (id が null か 'none' なら、いつもの髪)。一覧に無い id は何もしない
  set(id) {
    const next = id && id !== 'none' ? id : null;
    if (next && !this.byId.has(next)) return false;
    this.id = next; this.save();
    for (const f of this.listeners) f(this);
    return true;
  }

  // 髪のファイルの URL
  urlOf(entry) { return new URL('../models/hairs/' + entry.id + '.glb', import.meta.url).href; }
}

export async function loadHairStyle() {
  const cat = await fetch('models/hairs/hairs.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return new HairStyle(cat || { hairs: [] });
}
