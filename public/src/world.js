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
const EAVE = 0.45; // 勾配屋根の軒の出 (city.js の addPitched の E と同じ)

// 勾配屋根 1 つの、軒の高さからの高さ (city.js の addPitched / addSkelRoof と同じ形)。屋根の外は null
function roofPartH(r, ring, x, z) {
  if (r.t === 'skel') { // 輪郭に沿った寄棟: 勾配 × 輪郭までの距離
    let best = Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = ring[j][0], az = ring[j][1], ex = ring[i][0] - ax, ez = ring[i][1] - az, l2 = ex * ex + ez * ez;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
    }
    return r.k * best;
  }
  const [ux, uz] = r.u, dx = x - r.c[0], dz = z - r.c[1];
  const sl = dx * ux + dz * uz, t = -dx * uz + dz * ux; // 棟の向き / それと直角の向きの位置
  const L = r.len / 2 + EAVE, W = r.wid / 2 + EAVE;
  if (Math.abs(sl) > L + 0.01 || Math.abs(t) > W + 0.01) return null;
  if (r.t === 'shed') return r.rise / r.wid * (t * (r.up || 1) + r.wid / 2);
  const off = r.off || 0, side = t >= off ? 1 : -1;
  let h = r.rise * (1 - Math.abs(t - off) / (W - side * off));
  if (r.t === 'hip') h = Math.min(h, r.rise * (L - Math.abs(sl)) / Math.min(W, L * 0.6));
  return Math.max(0, h);
}

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
      // 勾配屋根: 壁は軒の高さまで。その上は屋根の斜面の高さで判定する (top() が使う)
      const roofs = b.roof ? [b.roof] : b.roofs && b.roofs.length ? b.roofs : null;
      if (roofs) {
        rec.roofs = roofs;
        rec.eaveY = base + (b.roof ? b.h - b.roof.rise : b.h);
        rec.topY = Math.max(rec.topY, rec.eaveY + Math.max(...roofs.map(r => r.rise || 0)));
      }
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

  // 開け閉めできる扉の当たり判定 (doors.js)。rec.door.open が true の間は通れる
  addDoor(x, z, yaw, hx, hz, y0, y1) {
    this.addColliders({ box: [[x, z, yaw, hx, hz, y0, y1]] }, true);
    const rec = this.props[this.props.length - 1];
    rec.door = { open: false };
    this.hasDoors = true;
    return rec;
  }

  // (x, z) での上面の高さ。勾配屋根は斜面の高さ、それ以外は上端
  top(b, x, z) {
    if (!b.roofs) return b.topY;
    let h = 0;
    for (const r of b.roofs) { const v = roofPartH(r, b.rings[0], x, z); if (v !== null && v > h) h = v; }
    return Math.min(b.topY, b.eaveY + h);
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
    let pr = this.query(minx, minz, maxx, maxz, this.propGrid);
    if (this.hasDoors) pr = pr.filter(r => !(r.door && r.door.open));   // 開いている扉は通れる
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
        // 勾配屋根: 屋根の上にいるなら斜面を歩ける。外からは、いちばん近い壁の上の屋根の高さが壁
        if (b.roofs && (inside ? this.top(b, pos.x, pos.z) : this.top(b, c.x, c.z)) <= pos.y + STEP) continue;
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
      if (b.topY > y + STEP && b.minY <= y + BODY_H && this.contains(b, x, z) && this.top(b, x, z) > y + STEP) return true;
    }
    return false;
  }

  // 進む向き (ux, uz) の先 reach m 以内にある、乗り越え・よじ登りの対象を調べる (player.js のパルクール用)。
  // 返り値: { t: 壁までの距離, top: 上端の高さ, nx, nz: 壁の外向きの法線, ex, ez: 壁に当たる点,
  //           (勾配屋根では縁 = 壁から張り出した軒先。t は負になりうる), sd: 縁から立つ所までの距離, standY: 立つ所の高さ,
  //           thick: 奥行き (m。薄い柵・塀だけ。厚いもの・奥がふさがっているものは null),
  //           stand: 上に立てるか, far: 向こう側に降りられる奥行き方向の距離 (降りられなければ null) }
  probeLedge(pos, ux, uz, r, reach) {
    const x0 = pos.x, z0 = pos.z, x1 = x0 + ux * reach, z1 = z0 + uz * reach;
    let best = null;
    for (const b of this.querySolid(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1))) {
      if (b.topY <= pos.y + STEP || b.minY > pos.y + BODY_H) continue; // 乗れる・くぐれるものは壁ではない
      if (b.roofs && this.contains(b, pos.x, pos.z) && this.top(b, pos.x, pos.z) <= pos.y + STEP) continue; // 今その屋根の上にいる
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
            best = { t, b, nx, nz };
          }
        }
      }
    }
    if (!best) return null;
    let ex = x0 + ux * best.t, ez = z0 + uz * best.t;
    // 勾配屋根: つかむ縁は、壁から張り出した軒先 (高さは軒先の屋根の高さ)。それ以外は壁の上端
    const hb = best.b;
    let over = 0, top = hb.topY;
    if (hb.roofs) {
      const ox = ex + best.nx * EAVE, oz = ez + best.nz * EAVE;
      let h = null;
      for (const r of hb.roofs) { if (r.t === 'skel') continue; const v = roofPartH(r, hb.rings[0], ox, oz); if (v !== null && (h === null || v > h)) h = v; }
      if (h !== null) { over = EAVE; top = Math.min(hb.topY, hb.eaveY + h); }
      else top = this.top(hb, ex + ux * 0.05, ez + uz * 0.05);
    }
    if (best.t - over > reach) return null;
    // 奥へ 0.1 m ずつ進み、上端より低くなる所 (= 薄い) か、さらに高いものにふさがれる所を探す
    let thick = null;
    for (let s = 0.05; s <= 1.25; s += 0.1) {
      const x = ex + ux * s, z = ez + uz * s;
      let hi = -Infinity, wall = false;
      for (const b of this.querySolid(x, z, x, z)) {
        if (!this.contains(b, x, z)) continue;
        const ty = this.top(b, x, z);
        if (ty > top + (b === hb && b.roofs ? 1.2 : STEP) && b.minY <= top + BODY_H) { wall = true; break; } // 自分の屋根の斜面は壁とみなさない
        if (b.minY <= top + 0.1) hi = Math.max(hi, ty);
      }
      if (wall) break;
      if (s < 0.2 && hi > top && !hb.roofs) top = hi; // 重なった少し高いもの (笠木など) は上端に含める
      if (hi < top - 0.35) { thick = s; break; }
    }
    const out = { t: best.t - over, sd: 0, standY: top, top, nx: best.nx, nz: best.nz, ex, ez, thick: thick !== null && thick <= 1.0 ? thick : null, stand: false, far: null };
    if (thick === null || thick >= 0.5) { // 厚いもの (自販機くらいの奥行きから): 縁から体ひとつ入った所に立てるか (奥がふさがっていれば bodyBlocked が弾く)
      const sd = Math.min(r + 0.05, (thick ?? 9) / 2), sx = ex + ux * sd, sz = ez + uz * sd;
      // 勾配屋根は、縁から入った所の屋根が軒先より高い。そこに立つ
      const gy = this.groundAt(sx, sz, top + (hb.roofs ? 1.2 : 0));
      out.stand = !this.bodyBlocked(sx, sz, gy) && gy >= top - STEP;
      out.sd = sd + over; out.standY = gy;
    }
    if (out.thick !== null) { // 薄いもの: 向こう側に体が入るか
      const d = out.thick + r + 0.2, fx = ex + ux * d, fz = ez + uz * d;
      const mx = ex + ux * (out.thick + r * 0.5), mz = ez + uz * (out.thick + r * 0.5);
      const gy = this.groundAt(fx, fz, top);
      if (!this.bodyBlocked(fx, fz, Math.min(gy, top)) && !this.bodyBlocked(mx, mz, top - 0.35) && !this.bodyBlocked(fx, fz, top - 0.35)) out.far = d;
    }
    if (over) { out.ex = ex + best.nx * over; out.ez = ez + best.nz * over; } // 縁の位置は軒先 (far・thick は壁からの距離のまま。屋根は薄くない)
    return out;
  }

  // 足元 y から見て乗れる最も高い面 (地面は、描画されている路面・敷地の高さに合わせて H より GROUND_LIFT 高い)
  groundAt(x, z, footY) {
    let g = H(x, z) + GROUND_LIFT;
    const br = getBridges();
    if (br) { // 橋・歩道橋・坂の路面 (足元より高すぎる所は、下をくぐっている)
      const d = br.deckAt(x, z, 0.3, (it) => !it.rail, footY + STEP - 0.05);
      if (d) g = Math.max(g, d.y + 0.05);
    }
    for (const b of this.querySolid(x, z, x, z)) {
      if (b.minY > footY + STEP || !this.contains(b, x, z)) continue;
      const ty = this.top(b, x, z);
      if (ty <= footY + STEP && ty > g) g = ty;
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
