// キャラメイク: 肌の色。今のキャラの肌の材質 (名前に _SKIN: 顔・体) の色を付け替える。
//   髪・目 (tint.js) と違い、模様は灰色にしない。肌の模様 (ほおの赤み・影・関節の色) をそのまま残し、
//   材質の色で「元の肌の平均色 → 選んだ色」の比 (リニアの RGB ごと) をかける。口 (唇・歯) は変えない。
import * as THREE from 'three';

const FALLBACK = new THREE.Color().setRGB(0.955, 0.76, 0.58); // 平均を測れなかったときの元の肌のリニア値 (sRGB 約 250,226,203 より少し濃いめ)

// 模様 tex の肌の平均色 (リニア)。明るい画素 (頭皮・髪色で塗られた所を除く) だけで測り、1 枚ごとに 1 回だけ。測れなければ null
function skinMean(tex) {
  if (!tex) return null;
  if (tex.userData.skinMean !== undefined) return tex.userData.skinMean;
  let c = null;
  try {
    const img = tex.image, iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    const k = Math.min(1, 128 / Math.max(iw, ih)), w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200 || (d[i] + d[i + 1] + d[i + 2]) / 3 < 150) continue;
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    if (n > 50) c = new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch (e) { console.warn('肌の平均色を測れませんでした:', e); }
  tex.userData.skinMean = c;
  return c;
}

export class Skindresser {
  constructor(vrm) {
    this.mats = [];
    vrm.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.isMToonMaterial && /_SKIN$/.test(m.name) && !this.mats.includes(m)) this.mats.push(m);
    });
    this.color = null;
  }

  // 肌の色を変える ('#rrggbb'。null = 元の色)
  setColor(hex) {
    this.color = hex || null;
    const t = this.color ? new THREE.Color(this.color) : null;
    for (const m of this.mats) {
      const o = m.userData.skinOrig || (m.userData.skinOrig = { color: m.color.clone(), shade: m.shadeColorFactor?.clone() });
      if (!t) { m.color.copy(o.color); m.shadeColorFactor?.copy(o.shade); m.needsUpdate = true; continue; }
      const base = skinMean(m.map) || FALLBACK;
      const ratio = new THREE.Color(t.r / Math.max(1e-3, base.r), t.g / Math.max(1e-3, base.g), t.b / Math.max(1e-3, base.b));
      m.color.copy(o.color).multiply(ratio);
      m.shadeColorFactor?.copy(o.shade).multiply(ratio);
      m.needsUpdate = true;
    }
  }
}
