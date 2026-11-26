// 千葉ドリームランドのロゴの字体 (Pacifico。SIL Open Font License 1.1。public/fonts/Pacifico-OFL.txt)。
// 看板・ゲームの物には英語の名前 (park.json の roman) をこの字体で描く。ミニマップや画面の文字は日本語の名前のまま。
// 読み込みが終わるまで、公園の組み立て (detail/park.js の update) を待たせる (canvas の文字に使うため)。
export const LOGO_FONT = '"Park Logo", "Pacifico", cursive';
export let logoFontReady = typeof FontFace === 'undefined' || typeof document === 'undefined';
if (!logoFontReady) {
  const f = new FontFace('Park Logo', 'url(fonts/pacifico-latin-400.woff2)');
  f.load().then((ff) => { document.fonts.add(ff); }).catch(() => {}).finally(() => { logoFontReady = true; });
}
