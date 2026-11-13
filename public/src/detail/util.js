import * as THREE from 'three';

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

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

export const DRIVABLE = new Set(['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'busway']);
export const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const RANK = { trunk: 5, primary: 4, secondary: 3, tertiary: 2, trunk_link: 2, primary_link: 2, secondary_link: 2, tertiary_link: 2, unclassified: 1, residential: 1, living_street: 1, busway: 1, service: 0 };
export const rank = (k) => RANK[k] ?? 0;

// 交差点の抽出: 道路の頂点を共有している箇所
export function intersections(roads) {
  const map = new Map();
  const key = (p) => p[0].toFixed(1) + ',' + p[1].toFixed(1);
  for (const r of roads) {
    if (!DRIVABLE.has(r.kind) || r.ys) continue;
    r.pts.forEach((p, i) => {
      const k = key(p);
      let n = map.get(k);
      if (!n) map.set(k, n = { x: p[0], z: p[1], arms: [] });
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= r.pts.length) continue;
        const q = r.pts[j], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
        if (l > 0.5) n.arms.push({ road: r, dir: [dx / l, dz / l], len: l, fwd: j === i + 1 });
      }
    });
  }
  return [...map.values()].filter(n => n.arms.length >= 3);
}

// 実測の道幅 (build_city.py: half = 中心線から左/右の縁, sw = 歩道幅)
// edge(r, side): 中心線から side (+1=左, -1=右) 側の道路面の縁まで
export const edge = (r, side) => r.half ? r.half[side > 0 ? 0 : 1] : r.w / 2;
// 車道の幅と、車道の中心の中心線からのずれ (左が正)
export const carriage = (r) => {
  const sw = r.sw || 0;
  return r.half ? { w: r.half[0] + r.half[1] - 2 * sw, c: (r.half[0] - r.half[1]) / 2 } : { w: r.w - 2 * sw, c: 0 };
};

export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
