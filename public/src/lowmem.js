// メモリの節約 (スマホ・タブレット用)。iPhone はタブが使えるメモリが少なく、超えるとページごと落ちる。
// タッチ操作の端末 (touch.js の TOUCH) のときだけ働く。PC では何もしない (修正モード・GLB 出力が元のデータを使うため)。
import { TOUCH } from './touch.js';

export const LOW_MEM = TOUCH;

// Canvas に描いた模様: GPU に送り終えたら、描画用のメモリを手放す。
// 1 枚の canvas を 1 つのテクスチャだけが使っているときに限る (送り直しはできなくなる)
export function releaseCanvasAfterUpload(tex) {
  if (!LOW_MEM) return tex;
  tex.onUpdate = () => { tex.onUpdate = null; const c = tex.image; if (c && c.getContext) c.width = c.height = 1; };
  return tex;
}

// 頂点データ: GPU に送り終えたら、JS 側の控えを手放す (大きいものだけ。同じ量が GPU にも載っているため)
export function releaseGeometryAfterUpload(root, minBytes = 262144) {
  if (!LOW_MEM) return;
  const drop = function () { this.array = null; };
  root.traverse((o) => {
    const g = o.geometry;
    if (!g || !o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || g.userData.released) return;
    let bytes = g.index ? g.index.array.byteLength : 0;
    for (const k in g.attributes) bytes += g.attributes[k].array.byteLength;
    if (bytes < minBytes) return;
    g.userData.released = true;
    if (!g.boundingSphere) g.computeBoundingSphere(); // 画面外の判定に使う。控えがあるうちに計算しておく
    if (!g.boundingBox) g.computeBoundingBox();
    for (const k in g.attributes) g.attributes[k].onUpload(drop);
    if (g.index) g.index.onUpload(drop);
  });
}

// 大きいテクスチャ (VRM のキャラなど) を max 以下に縮める
export function shrinkTextures(root, max = 1024) {
  if (!LOW_MEM) return;
  const done = new Set();
  const shrink = (t) => {
    if (!t || !t.isTexture || !t.image || done.has(t.source)) return;
    done.add(t.source);
    const im = t.image, w = im.width, h = im.height;
    if (!(w > max || h > max)) return;
    const k = max / Math.max(w, h);
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    t.source.data = c; t.source.needsUpdate = true;
    if (im.close) im.close(); // ImageBitmap は明示的に手放せる
  };
  root.traverse((o) => {
    for (const m of [].concat(o.material || [])) {
      for (const k in m) shrink(m[k]);
      for (const u in (m.uniforms || {})) shrink(m.uniforms[u].value);
    }
  });
}
