// キャラメイク: 選んだ髪型・髪色・目の色の保存。端末のブラウザ (localStorage) にだけ保存する (服の wardrobe.js と同じ)。
// 髪の一覧は models/hairs/hairs.json (id・名前・合う体・tune)。髪のファイルは models/hairs/<id>.glb (tools/hairs.py で作る)。
// 髪色・目の色は '#rrggbb' (null = 元の色)。色見本は PALETTE (髪)・EYE_PALETTE (目)。
// 試すための URL: ?hair=<id> (その髪にする。保存はしない)、?hair=none (いつもの髪)、?haircolor=rrggbb (その髪色。保存はしない。none = 元の色)、?eyecolor=rrggbb (その目の色。同じ)、?skincolor=rrggbb (その肌の色。同じ)、?height=<cm> (その身長。145〜190 の 5 刻み。同じ)、?body=female|male (その体。同じ)、?resetsave (保存を消す。wardrobe.js と共通)
const KEY = 'totsuka.look.v1';

// 髪色の色見本 (メニュー)。自然な色から順に
export const PALETTE = [
  { hex: '#1c1c22', name: '黒' }, { hex: '#3a2a22', name: '焦げ茶' }, { hex: '#6b4630', name: '茶色' }, { hex: '#a8744a', name: '明るい茶色' },
  { hex: '#d9b26a', name: '金色' }, { hex: '#efe6c8', name: 'プラチナ' }, { hex: '#f2f2f2', name: '白' }, { hex: '#8a8d94', name: '灰色' },
  { hex: '#b3262d', name: '赤' }, { hex: '#e07a2f', name: '橙' }, { hex: '#e58aa8', name: '桃色' }, { hex: '#7d4fb0', name: '紫' },
  { hex: '#2f5fc4', name: '青' }, { hex: '#6cc3e6', name: '水色' }, { hex: '#3f9a5a', name: '緑' }, { hex: '#7fd1b0', name: '若草色' },
];
// 目の色の色見本 (メニュー)
export const EYE_PALETTE = [
  { hex: '#2b1d17', name: '黒茶' }, { hex: '#6b4630', name: '茶色' }, { hex: '#b87a2c', name: '琥珀' }, { hex: '#d9b26a', name: '金色' },
  { hex: '#8a8d94', name: '灰色' }, { hex: '#2f5fc4', name: '青' }, { hex: '#6cc3e6', name: '水色' }, { hex: '#3f9a5a', name: '緑' },
  { hex: '#7fd1b0', name: '若草色' }, { hex: '#7d4fb0', name: '紫' }, { hex: '#e58aa8', name: '桃色' }, { hex: '#b3262d', name: '赤' },
];
// 肌の色の色見本 (メニュー)。元の肌は明るいので、「元の色」より明るい色は入れない (色はリニアの比でかけるため)
export const SKIN_PALETTE = [
  { hex: '#f6dcc6', name: '色白' }, { hex: '#efc9a8', name: '明るい' }, { hex: '#e3b08a', name: '標準' }, { hex: '#d29a6a', name: '小麦色' },
  { hex: '#b87c4f', name: '日焼け' }, { hex: '#996039', name: '褐色' }, { hex: '#7a4528', name: '濃い褐色' }, { hex: '#59301c', name: '深い褐色' },
  { hex: '#e8b8b0', name: '桃色がかった' }, { hex: '#c9d6e0', name: '青白い' }, { hex: '#a9c98e', name: '緑がかった' }, { hex: '#9b8fc4', name: '薄紫' },
];
// 体 (キャラメイク): female = 今のキャラ (AvatarSample_A)、male = Base_Male (VRoid 公式 CC0)。モデルのファイルは models/player.vrm と models/bodies/male.vrm。
export const BODIES = [{ id: 'female', name: '女性の体', url: 'player.vrm' }, { id: 'male', name: '男性の体', url: 'bodies/male.vrm' }];
// 体ごとの元の身長 (cm)。どの体も、ゲームの中では同じ大きさに合わせて読み込む (character.js)。身長の倍率は cm / HEIGHT_BASE
export const BODY_HEIGHT = { female: 160, male: 172 };
export function savedBody() { // 起動時 (モデルを読み込む前) に、選んでいた体を知るため
  try {
    const q = new URLSearchParams(location.search).get('body');
    if (q && BODY_HEIGHT[q]) return q;
    const s = JSON.parse(localStorage.getItem('totsuka.look.v1') || 'null');
    if (s && BODY_HEIGHT[s.body]) return s.body;
  } catch (e) { /* 読めなければ今のキャラ */ }
  return 'female';
}
// 身長の選択肢 (cm)。範囲は大人 (145〜190 cm)。null = その体の元の身長
export const HEIGHT_BASE = 160;
export const HEIGHTS = [145, 150, 155, 160, 165, 170, 175, 180, 185, 190];
const isHex =(c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

export class HairStyle {
  constructor(catalog) {
    this.hairs = catalog.hairs || [];
    this.byId = new Map(this.hairs.map((h) => [h.id, h]));
    this.body = savedBody(); // 選んでいる体 ('female' | 'male')
    this.id = null;          // 選んでいる髪の id (null = いつもの髪)
    this.color = null;       // 髪色 ('#rrggbb')。null = 元の色
    this.eyeColor = null;    // 目の色 ('#rrggbb')。null = 元の色
    this.skinColor = null;   // 肌の色 ('#rrggbb')。null = 元の色
    this.height = null;      // 身長 (cm、HEIGHTS のどれか)。null = 元の身長 (HEIGHT_BASE)
    this.listeners = [];
    const q = new URLSearchParams(location.search);
    if (q.has('resetsave')) { try { localStorage.removeItem(KEY); } catch (e) { /* 保存できない環境 */ } }
    this.load();
    if (q.has('hair')) this.id = this.byId.has(q.get('hair')) ? q.get('hair') : null; // 試し用。保存はしない
    if (q.has('eyecolor')) this.eyeColor = isHex('#' + q.get('eyecolor')) ? '#' + q.get('eyecolor').toLowerCase() : null; // 試し用。保存はしない
    if (q.has('skincolor')) this.skinColor = isHex('#' + q.get('skincolor')) ? '#' + q.get('skincolor').toLowerCase() : null; // 試し用。保存はしない
    if (q.has('height')) this.height = HEIGHTS.includes(+q.get('height')) ? +q.get('height') : null; // 試し用。保存はしない
    if (q.has('haircolor')) this.color = isHex('#' + q.get('haircolor')) ? '#' + q.get('haircolor').toLowerCase() : null; // 試し用。保存はしない
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && this.byId.has(s.hair)) this.id = s.hair; // 一覧から消えた髪 (使わなくなったもの) は、いつもの髪に戻す
      if (s && isHex(s.color)) this.color = s.color.toLowerCase();
      if (s && isHex(s.eyeColor)) this.eyeColor = s.eyeColor.toLowerCase();
      if (s && isHex(s.skinColor)) this.skinColor = s.skinColor.toLowerCase();
      if (s && HEIGHTS.includes(s.height)) this.height = s.height;
    } catch (e) { /* 読めなければ最初から */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, body: this.body, hair: this.id, color: this.color, eyeColor: this.eyeColor, skinColor: this.skinColor, height: this.height })); } catch (e) { /* 保存できない環境 (プライベートモードなど) */ }
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

  // 髪色を選ぶ (hex = '#rrggbb'、null か 'none' なら元の色)
  setColor(hex) {
    const next = hex && hex !== 'none' ? hex : null;
    if (next && !isHex(next)) return false;
    this.color = next ? next.toLowerCase() : null; this.save();
    for (const f of this.listeners) f(this);
    return true;
  }

  // 目の色を選ぶ (hex = '#rrggbb'、null か 'none' なら元の色)
  setEyeColor(hex) {
    const next = hex && hex !== 'none' ? hex : null;
    if (next && !isHex(next)) return false;
    this.eyeColor = next ? next.toLowerCase() : null; this.save();
    for (const f of this.listeners) f(this);
    return true;
  }

  // 肌の色を選ぶ (hex = '#rrggbb'、null か 'none' なら元の色)
  setSkinColor(hex) {
    const next = hex && hex !== 'none' ? hex : null;
    if (next && !isHex(next)) return false;
    this.skinColor = next ? next.toLowerCase() : null; this.save();
    for (const f of this.listeners) f(this);
    return true;
  }

  // 身長を選ぶ (cm。null か 'none' なら元の身長)。HEIGHTS に無い値は何もしない
  setHeight(cm) {
    const next = cm && cm !== 'none' ? +cm : null;
    if (next !== null && !HEIGHTS.includes(next)) return false;
    this.height = next; this.save();
    for (const f of this.listeners) f(this);
    return true;
  }

  // 体を選ぶ ('female' | 'male')。一覧に無い値は何もしない
  setBody(id) {
    if (!BODY_HEIGHT[id]) return false;
    this.body = id; this.save();
    for (const f of this.listeners) f(this);
    return true;
  }

  // 選んでいる体の元の身長 (cm)
  naturalHeight() { return BODY_HEIGHT[this.body]; }

  // 身長の倍率 (今のキャラ = 1。男性の体の元の身長は 172 / 160)
  heightScale() { return (this.height || this.naturalHeight()) / HEIGHT_BASE; }

  // 髪のファイルの URL
  urlOf(entry) { return new URL('../models/hairs/' + entry.id + '.glb', import.meta.url).href; }
}

export async function loadHairStyle() {
  const cat = await fetch('models/hairs/hairs.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return new HairStyle(cat || { hairs: [] });
}
