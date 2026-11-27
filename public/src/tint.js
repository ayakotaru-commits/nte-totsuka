// 色の付け替え (髪・目): MToon の材質の模様 (毛の筋・ハイライト・虹彩の陰影) を、明るさだけの灰色の模様にして残し、色だけを付け替える。
//   tintMaterial(m, '#rrggbb', kind) で付け替え、tintMaterial(m, null) で元に戻す。使うのは hair.js (髪・頭皮の殻) と eyes.js (目)。
import * as THREE from 'three';

// 髪の材質 (MToon) の模様 (毛の筋・ハイライト) を、明るさだけの灰色の模様にして残し、色は材質の色で付ける。
//   灰色の模様は、平均の明るさ (リニア) が GRAY_MEAN になるようにそろえる。そのぶん、色は target / GRAY_MEAN をかける (target = 選んだ色の平均になる)。
//   元に戻す (hex = null) ときは、材質の最初の状態 (userData.hairOrig に覚えてある) を返す。
const GRAY_MEAN = 0.6;
const S2L = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
const l2s = (l) => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055));

// 模様 tex の灰色版 (CanvasTexture)。1 枚ごとに 1 回だけ作って tex.userData.gray に覚える。作れなければ null
function grayTexture(tex) {
  if (tex.userData.gray !== undefined) return tex.userData.gray;
  let g = null;
  try {
    const img = tex.image;
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    const k = Math.min(1, 1024 / Math.max(iw, ih)); // 大きい模様は 1024 px に縮める (メモリ・時間の節約)
    const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, w, h);
    const id = cx.getImageData(0, 0, w, h), d = id.data;
    let sum = 0, n = 0;
    const lum = new Float32Array(w * h);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const l = 0.2126 * S2L[d[i]] + 0.7152 * S2L[d[i + 1]] + 0.0722 * S2L[d[i + 2]]; // リニアの明るさ
      lum[j] = l;
      if (d[i + 3] > 200) { sum += l; n++; }
    }
    const f = GRAY_MEAN / Math.max(1e-3, n ? sum / n : 0.5);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) { const v = l2s(Math.min(1, lum[j] * f)); d[i] = d[i + 1] = d[i + 2] = v; }
    cx.putImageData(id, 0, 0);
    g = new THREE.CanvasTexture(cv);
    g.colorSpace = THREE.SRGBColorSpace; g.flipY = tex.flipY; g.wrapS = tex.wrapS; g.wrapT = tex.wrapT; g.anisotropy = tex.anisotropy;
  } catch (e) { console.warn('髪の模様を灰色にできませんでした:', e); }
  tex.userData.gray = g;
  return g;
}

// 材質 m (MToon) の色を hex ('#rrggbb') にする。hex = null は元の色。
//   kind = 'hair' (髪: 影の色・縁・発光色も合わせる)、'cap' (模様の無い頭皮の殻: 髪は影・ハイライトで暗く見えるので、そのぶん少し暗くする)、'eye' (目: 影をつけず、縁・発光は元のまま)
export function tintMaterial(m, hex, kind = 'hair') {
  if (!m || !m.isMToonMaterial) return;
  const o = m.userData.hairOrig || (m.userData.hairOrig = {
    map: m.map, shade: m.shadeMultiplyTexture, color: m.color.clone(), shadeColor: m.shadeColorFactor?.clone(), outline: m.outlineColorFactor?.clone(), emissive: m.emissive?.clone(),
  });
  if (!hex) {
    m.map = o.map; m.shadeMultiplyTexture = o.shade; m.color.copy(o.color); m.shadeColorFactor?.copy(o.shadeColor); m.outlineColorFactor?.copy(o.outline); m.emissive?.copy(o.emissive);
  } else {
    const t = new THREE.Color(hex), flat = kind === 'cap', eye = kind === 'eye';
    const gm = o.map ? grayTexture(o.map) : null, gs = o.shade ? grayTexture(o.shade) : null;
    m.map = gm; m.color.copy(t).multiplyScalar((gm ? 1 / GRAY_MEAN : 1) * (flat ? 0.9 : 1));
    m.shadeMultiplyTexture = gs;
    m.shadeColorFactor?.copy(t).multiplyScalar((eye ? 1 : flat ? 0.62 : 0.7) * (gs ? 1 / GRAY_MEAN : 1));
    if (!eye) m.outlineColorFactor?.copy(t).multiplyScalar(0.25);
    // 発光色 (髪によっては、毛先が光る設定がある): 色相を選んだ色にそろえ、強さは元のまま
    if (o.emissive && !eye) m.emissive.copy(t).multiplyScalar(Math.max(o.emissive.r, o.emissive.g, o.emissive.b));
  }
  m.needsUpdate = true;
}

// 材質の模様 (GPU) を手放す。灰色版と、元の模様 (userData.hairOrig) も
export function disposeMaterial(m) {
  const texs = new Set();
  for (const v of Object.values(m)) if (v && v.isTexture) texs.add(v);
  const o = m.userData?.hairOrig;
  if (o) for (const v of [o.map, o.shade]) if (v && v.isTexture) texs.add(v);
  for (const t of texs) { t.userData?.gray?.dispose?.(); t.dispose(); }
  m.dispose?.();
}
