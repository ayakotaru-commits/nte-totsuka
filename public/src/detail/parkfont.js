// 千葉ドリームランドの看板・ゲームの物の字体 (すべて SIL Open Font License 1.1。ライセンスは public/fonts/*-OFL.txt)。
// 看板・ゲームの物には英語の名前を、エリアと店の特徴ごとに字体を変えて描く。ミニマップや画面の文字は日本語のまま。
// 字体の名前 (key) は data/park_areas.json の font・fonts (tools/park_areas.py が看板に書く) で決める。
// 読み込みが終わるまで、公園の組み立て (detail/park.js の update) を待たせる (canvas の文字に使うため)。
export const FONTS = {
  logo:       { file: 'pacifico-latin.woff2',          family: 'Pacifico' },          // パークの名前 (ゲートの看板)
  marquee:    { file: 'limelight-latin.woff2',         family: 'Limelight' },         // 映画館・劇場 (アール・デコの電飾)
  pop:        { file: 'fredoka-latin.woff2',           family: 'Fredoka' },           // 軽食・雑貨 (丸くて親しみやすい)
  script:     { file: 'lobster-latin.woff2',           family: 'Lobster' },           // ダイナー・カフェ・パン屋 (筆記体)
  typewriter: { file: 'special-elite-latin.woff2',     family: 'Special Elite' },     // 写真館・新聞・切符 (タイプライター)
  stencil:    { file: 'stardos-stencil-latin.woff2',   family: 'Stardos Stencil' },   // 倉庫・工房・木箱 (ステンシル)
  victorian:  { file: 'rye-latin.woff2',               family: 'Rye' },               // 駅・蒸気機関 (ヴィクトリア調の看板)
  block:      { file: 'bungee-latin.woff2',            family: 'Bungee' },            // ガレージ・街の大きな看板
  storybook:  { file: 'almendra-latin.woff2',          family: 'Almendra' },          // おとぎ話の森 (絵本の書体)
  serif:      { file: 'cinzel-decorative-latin.woff2', family: 'Cinzel Decorative' }, // 銀行・薬屋・時計店 (装飾つきの古典)
  spooky:     { file: 'creepster-latin.woff2',         family: 'Creepster' },         // 幽霊屋敷
  ancient:    { file: 'uncial-antiqua-latin.woff2',    family: 'Uncial Antiqua' },    // 探検・化石 (古代文字ふう)
  nautical:   { file: 'sail-latin.woff2',              family: 'Sail' },              // 港 (帆船の書体)
  jungle:     { file: 'bangers-latin.woff2',           family: 'Bangers' },           // ジャングルの食堂 (コミック)
  candy:      { file: 'chewy-latin.woff2',             family: 'Chewy' },             // おかし (ぷっくりした字)
};
const fam = (k) => `"Park ${k}"`;
export const fontCss = (key, px) => `${px}px ${fam(FONTS[key] ? key : 'logo')}, ${FONTS[key] ? `"${FONTS[key].family}", ` : ''}sans-serif`;
export const LOGO_FONT = `${fam('logo')}, "Pacifico", cursive`;   // 以前の名前 (ゲートの看板)

export let logoFontReady = typeof FontFace === 'undefined' || typeof document === 'undefined';
if (!logoFontReady) {
  Promise.all(Object.entries(FONTS).map(([k, v]) => new FontFace(`Park ${k}`, `url(fonts/${v.file})`).load().then((ff) => { document.fonts.add(ff); }).catch(() => {})))
    .finally(() => { logoFontReady = true; });
}
