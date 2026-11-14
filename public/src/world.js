// 建物フットプリントによる当たり判定 (XZ平面の2D判定 + 高さ) と地形
// rec.h / rec.minH は基礎からの高さ、rec.topY / rec.minY は絶対高さ (地形込み)
// 路上の小物 (電柱・柵など。data/props.json の colliders) は別の索引に入れ、移動・着地・ワープ先の判定だけが見る。
// query() / list は建物だけ (修正ツール・目的地・看板の配置が使う)。
import { H } from './terrain.js';
import { getBridges } from './bridges.js';
export const STEP = 0.4;   // 乗り越えられる段差
// 路面は地形メッシュより 0.12 m (drape の lift) + 0.07〜0.10 m (道路) 上に描かれる。敷地は約 0.13 m。その中間で、足が埋まらず浮いても見えない高さ
export const GROUND_LIFT = 0.18;
const BODY_H = 1.7;

export class World {
  constructor(buildings, bounds, cell = 16) {
    this.bounds = bounds; // {minX, maxX, minZ, maxZ}
    this.cell = cell;
    this.grid = new Map();
    this.propGrid = new Map();
    this.list = [];
    this.props = [];
    this.propsOn = true;
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
      this._insert(this.grid, rec);
    }
  }

  _insert(grid, rec) {
    const cell = this.cell;
    for (let i = Math.floor(rec.minx / cell); i <= Math.floor(rec.maxx / cell); i++)
      for (let j = Math.floor(rec.minz / cell); j <= Math.floor(rec.maxz / cell); j++) {
        const k = this.key(i, j);
        let arr = grid.get(k);
        if (!arr) grid.set(k, arr = []);
        arr.push(rec);
      }
  }

  // 小物の当たり判定 (props.json の colliders) を多角形にして登録する
  //   circle [x, z, r, y0, y1] / box [x, z, yaw, hx, hz, y0, y1] / line [hw, h, x0, z0, y0, x1, z1, y1, ...]
  // always = true のものは propsOn (V キー) に関係なく有効 (木の幹)
  addColliders(c, always = false) {
    if (!c) return;
    const add = (ring, minY, topY) => {
      let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
      for (const [x, z] of ring) {
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (z < minz) minz = z; if (z > maxz) maxz = z;
      }
      const rec = { prop: true, always, rings: [ring], minY, topY, minx, minz, maxx, maxz, _s: 0 };
      this.props.push(rec);
      this._insert(this.propGrid, rec);
    };
    // 中心 (x, z)、向き (ux, uz) = 局所 +Z、半幅 hx (局所 X)・hz (局所 Z) の長方形
    const rect = (x, z, ux, uz, hx, hz) => {
      const rx = uz, rz = -ux; // 局所 +X
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + rx * hx * a + ux * hz * b, z + rz * hx * a + uz * hz * b]);
    };
    for (const [x, z, r, y0, y1] of c.circle || []) {
      const ring = [];
      const R = r / Math.cos(Math.PI / 8); // 八角形の辺が円に接するように (円の内側に入り込まない)
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; ring.push([x + Math.cos(a) * R, z + Math.sin(a) * R]); }
      add(ring, y0, y1);
    }
    for (const [x, z, yaw, hx, hz, y0, y1] of c.box || []) add(rect(x, z, Math.sin(yaw), Math.cos(yaw), hx, hz), y0, y1);
    for (const ln of c.line || []) {
      const [hw, h] = ln;
      for (let k = 2; k + 5 < ln.length; k += 3) {
        const [x0, z0, y0, x1, z1, y1] = ln.slice(k, k + 6);
        const L = Math.hypot(x1 - x0, z1 - z0);
        if (L < 1e-3) continue;
        add(rect((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / L, (z1 - z0) / L, hw, L / 2 + hw), Math.min(y0, y1), Math.max(y0, y1) + h);
      }
    }
  }

  key(i, j) { return (i + 10000) * 20000 + (j + 10000); }

  query(minx, minz, maxx, maxz, grid = this.grid) {
    const s = ++this._stamp, out = [];
    const c = this.cell;
    for (let i = Math.floor(minx / c); i <= Math.floor(maxx / c); i++)
      for (let j = Math.floor(minz / c); j <= Math.floor(maxz / c); j++) {
        const arr = grid.get(this.key(i, j));
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

  // 建物 + 小物
  querySolid(minx, minz, maxx, maxz) {
    const out = this.query(minx, minz, maxx, maxz);
    if (!this.props.length) return out;
    const pr = this.query(minx, minz, maxx, maxz, this.propGrid);
    return out.concat(this.propsOn ? pr : pr.filter(r => r.always));
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
      for (const b of this.querySolid(pos.x - r, pos.z - r, pos.x + r, pos.z + r)) {
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

  // 体 (足元 y) がその点に立てないか: 足元より STEP 以上高く、頭より低い所から始まるものの中
  bodyBlocked(x, z, y) {
    for (const b of this.querySolid(x, z, x, z)) {
      if (b.topY > y + STEP && b.minY <= y + BODY_H && this.contains(b, x, z)) return true;
    }
    return false;
  }

  // 進む向き (ux, uz) の先 reach m 以内にある、乗り越え・よじ登りの対象を調べる (player.js のパルクール用)。
  // 返り値: { t: 壁までの距離, top: 上端の高さ, nx, nz: 壁の外向きの法線, ex, ez: 壁に当たる点,
  //           thick: 奥行き (m。薄い柵・塀だけ。厚いもの・奥がふさがっているものは null),
  //           stand: 上に立てるか, far: 向こう側に降りられる奥行き方向の距離 (降りられなければ null) }
  probeLedge(pos, ux, uz, r, reach) {
    const x0 = pos.x, z0 = pos.z, x1 = x0 + ux * reach, z1 = z0 + uz * reach;
    let best = null;
    for (const b of this.querySolid(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1))) {
      if (b.topY <= pos.y + STEP || b.minY > pos.y + BODY_H) continue; // 乗れる・くぐれるものは壁ではない
      for (const ring of b.rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const ax = ring[j][0], az = ring[j][1], ex = ring[i][0] - ax, ez = ring[i][1] - az;
          const den = ux * ez - uz * ex;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((ax - x0) * ez - (az - z0) * ex) / den, s = ((ax - x0) * uz - (az - z0) * ux) / den;
          if (t < 0 || t > reach || s < 0 || s > 1) continue;
          if (!best || t < best.t) {
            const L = Math.hypot(ex, ez) || 1;
            let nx = ez / L, nz = -ex / L;
            if (nx * ux + nz * uz > 0) { nx = -nx; nz = -nz; } // こちら向きの法線
            best = { t, top: b.topY, nx, nz };
          }
        }
      }
    }
    if (!best) return null;
    const ex = x0 + ux * best.t, ez = z0 + uz * best.t;
    let top = best.top;
    // 奥へ 0.1 m ずつ進み、上端より低くなる所 (= 薄い) か、さらに高いものにふさがれる所を探す
    let thick = null;
    for (let s = 0.05; s <= 1.25; s += 0.1) {
      const x = ex + ux * s, z = ez + uz * s;
      let hi = -Infinity, wall = false;
      for (const b of this.querySolid(x, z, x, z)) {
        if (!this.contains(b, x, z)) continue;
        if (b.topY > top + STEP && b.minY <= top + BODY_H) { wall = true; break; }
        if (b.minY <= top + 0.1) hi = Math.max(hi, b.topY);
      }
      if (wall) break;
      if (s < 0.2 && hi > top) top = hi; // 重なった少し高いもの (笠木など) は上端に含める
      if (hi < top - 0.35) { thick = s; break; }
    }
    const out = { t: best.t, top, nx: best.nx, nz: best.nz, ex, ez, thick: thick !== null && thick <= 1.0 ? thick : null, stand: false, far: null };
    if (thick === null || thick >= 0.5) { // 厚いもの (自販機くらいの奥行きから): 縁から体ひとつ入った所に立てるか (奥がふさがっていれば bodyBlocked が弾く)
      const sd = Math.min(r + 0.05, (thick ?? 9) / 2), sx = ex + ux * sd, sz = ez + uz * sd;
      out.stand = !this.bodyBlocked(sx, sz, top) && Math.abs(this.groundAt(sx, sz, top) - top) <= STEP;
    }
    if (out.thick !== null) { // 薄いもの: 向こう側に体が入るか
      const d = out.thick + r + 0.2, fx = ex + ux * d, fz = ez + uz * d;
      const mx = ex + ux * (out.thick + r * 0.5), mz = ez + uz * (out.thick + r * 0.5);
      const gy = this.groundAt(fx, fz, top);
      if (!this.bodyBlocked(fx, fz, Math.min(gy, top)) && !this.bodyBlocked(mx, mz, top - 0.35) && !this.bodyBlocked(fx, fz, top - 0.35)) out.far = d;
    }
    return out;
  }

  // 足元 y から見て乗れる最も高い面 (地面は、描画されている路面・敷地の高さに合わせて H より GROUND_LIFT 高い)
  groundAt(x, z, footY) {
    let g = H(x, z) + GROUND_LIFT;
    const br = getBridges();
    if (br) { // 橋・歩道橋・坂の路面 (足元より高すぎる所は、下をくぐっている)
      const d = br.deckAt(x, z, 0.3, (it) => !it.rail);
      if (d && d.y + 0.05 <= footY + STEP) g = Math.max(g, d.y + 0.05);
    }
    for (const b of this.querySolid(x, z, x, z)) {
      if (b.topY > footY + STEP || b.topY <= g) continue;
      if (this.contains(b, x, z)) g = b.topY;
    }
    return g;
  }

  // カメラ用。建物だけを見る (細い電柱や柵で視点が急に寄らないように)
  blockedAt(x, y, z) {
    if (y < H(x, z) + 0.15) return true; // 地面の下
    for (const b of this.query(x, z, x, z)) {
      if (y >= b.minY && y <= b.topY + 0.2 && this.contains(b, x, z)) return true;
    }
    return false;
  }

  insideAny(x, z) {
    for (const b of this.querySolid(x, z, x, z)) if (this.contains(b, x, z)) return true;
    return false;
  }
}
