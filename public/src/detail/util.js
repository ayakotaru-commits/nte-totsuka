import * as THREE from 'three';
import { LOW_MEM, releaseCanvasAfterUpload } from '../lowmem.js';

// 三角形を積んで BufferGeometry にする (法線は面法線、向きは n に合わせる)
export class Builder {
  constructor() { this.p = []; this.n = []; this.u = []; }
  tri(a, b, c, n, ua = [0, 0], ub = [0, 0], uc = [0, 0]) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (!n) { const l = Math.hypot(...cr) || 1; n = cr.map(v => v / l); }
    else if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; }
    this.p.push(...a, ...b, ...c); this.n.push(...n, ...n, ...n); this.u.push(...ua, ...ub, ...uc);
  }
  quad(a, b, c, d, n, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    this.tri(a, b, c, n, uv[0], uv[1], uv[2]);
    this.tri(a, c, d, n, uv[0], uv[2], uv[3]);
  }
  // 水平な長方形 (中心, 進行方向 dir, 長さ len, 幅 wid)
  flatRect(cx, cz, dir, len, wid, y, uv) {
    const [dx, dz] = dir, nx = -dz, nz = dx, l = len / 2, w = wid / 2;
    const P = (s, t) => [cx + dx * s + nx * t, y, cz + dz * s + nz * t];
    this.quad(P(-l, -w), P(l, -w), P(l, w), P(-l, w), [0, 1, 0], uv);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.computeBoundingSphere();
    return g;
  }
}

// 道路まわりの計算 (交差点・道幅など) は tools/build_props.py に移した

export function canvasTexture(w, h, draw) {
  // スマホ・タブレットでは、大きい模様 (看板の文字など) を半分の解像度で作る。draw には元の大きさ (w, h) の座標のまま描かせる
  const k = LOW_MEM && w * h >= 512 * 128 ? 0.5 : 1;
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext('2d'); g.scale(c.width / w, c.height / h);
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return releaseCanvasAfterUpload(t);
}
