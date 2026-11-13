// 建物フットプリントによる当たり判定 (XZ平面の2D判定 + 高さ) と地形
// rec.h / rec.minH は基礎からの高さ、rec.topY / rec.minY は絶対高さ (地形込み)
import { H } from './terrain.js';
import { getBridges } from './bridges.js';
export const STEP = 0.4;   // 乗り越えられる段差
const BODY_H = 1.7;

export class World {
  constructor(buildings, bounds, cell = 16) {
    this.bounds = bounds; // {minX, maxX, minZ, maxZ}
    this.cell = cell;
    this.grid = new Map();
    this.list = [];
    this._stamp = 0;
    for (const b of buildings) {
      const rings = [b.outer, ...(b.holes || [])];
      let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
      for (const [x, z] of b.outer) {
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (z < minz) minz = z; if (z > maxz) maxz = z;
      }
      const base = b.y || 0;
      const rec = { id: b.id, src: b.src, rings, h: b.h, minH: b.minH || 0, base, topY: base + b.h, minY: base + (b.minH || 0), minx, minz, maxx, maxz, name: b.name, _s: 0 };
      this.list.push(rec);
      for (let i = Math.floor(minx / cell); i <= Math.floor(maxx / cell); i++)
        for (let j = Math.floor(minz / cell); j <= Math.floor(maxz / cell); j++) {
          const k = this.key(i, j);
          let arr = this.grid.get(k);
          if (!arr) this.grid.set(k, arr = []);
          arr.push(rec);
        }
    }
  }

  key(i, j) { return (i + 10000) * 20000 + (j + 10000); }

  query(minx, minz, maxx, maxz) {
    const s = ++this._stamp, out = [];
    const c = this.cell;
    for (let i = Math.floor(minx / c); i <= Math.floor(maxx / c); i++)
      for (let j = Math.floor(minz / c); j <= Math.floor(maxz / c); j++) {
        const arr = this.grid.get(this.key(i, j));
        if (!arr) continue;
        for (const r of arr) {
          if (r._s === s) continue;
          r._s = s;
          if (r.maxx < minx || r.minx > maxx || r.maxz < minz || r.minz > maxz) continue;
          out.push(r);
        }
      }
    return out;
  }

  contains(b, x, z) {
    if (x < b.minx || x > b.maxx || z < b.minz || z > b.maxz) return false;
    let inside = false;
    for (const ring of b.rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
      }
    }
    return inside;
  }

  closest(b, x, z) {
    let best = Infinity, bx = 0, bz = 0;
    for (const ring of b.rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const ax = ring[j][0], az = ring[j][1], ex = ring[i][0] - ax, ez = ring[i][1] - az;
        const l2 = ex * ex + ez * ez;
        let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = ax + ex * t, cz = az + ez * t;
        const d2 = (x - cx) ** 2 + (z - cz) ** 2;
        if (d2 < best) { best = d2; bx = cx; bz = cz; }
      }
    }
    return { x: bx, z: bz, d: Math.sqrt(best) };
  }

  // 円 (半径 r) を建物から押し出す。pos は {x, y, z} (y = 足元)
  resolve(pos, r) {
    for (let it = 0; it < 4; it++) {
      let moved = false;
      for (const b of this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r)) {
        if (b.topY <= pos.y + STEP) continue;       // 上に乗れる
        if (b.minY > pos.y + BODY_H) continue;      // 下をくぐれる (庇・渡り廊下・門)
        const inside = this.contains(b, pos.x, pos.z);
        const c = this.closest(b, pos.x, pos.z);
        if (c.d < 1e-6) continue;
        if (inside) {
          const nx = (c.x - pos.x) / c.d, nz = (c.z - pos.z) / c.d;
          pos.x = c.x + nx * r; pos.z = c.z + nz * r; moved = true;
        } else if (c.d < r) {
          const nx = (pos.x - c.x) / c.d, nz = (pos.z - c.z) / c.d;
          pos.x = c.x + nx * r; pos.z = c.z + nz * r; moved = true;
        }
      }
      if (!moved) break;
    }
    const B = this.bounds, m = 5;
    pos.x = Math.max(B.minX + m, Math.min(B.maxX - m, pos.x));
    pos.z = Math.max(B.minZ + m, Math.min(B.maxZ - m, pos.z));
  }

  // 足元 y から見て乗れる最も高い面
  groundAt(x, z, footY) {
    let g = H(x, z);
    const br = getBridges();
    if (br) { // 橋・歩道橋・坂の路面 (足元より高すぎる所は、下をくぐっている)
      const d = br.deckAt(x, z, 0.3, (it) => !it.rail);
      if (d && d.y + 0.05 <= footY + STEP) g = Math.max(g, d.y + 0.05);
    }
    for (const b of this.query(x, z, x, z)) {
      if (b.topY > footY + STEP || b.topY <= g) continue;
      if (this.contains(b, x, z)) g = b.topY;
    }
    return g;
  }

  blockedAt(x, y, z) {
    if (y < H(x, z) + 0.15) return true; // 地面の下
    for (const b of this.query(x, z, x, z)) {
      if (y >= b.minY && y <= b.topY + 0.2 && this.contains(b, x, z)) return true;
    }
    return false;
  }

  insideAny(x, z) {
    for (const b of this.query(x, z, x, z)) if (this.contains(b, x, z)) return true;
    return false;
  }
}
