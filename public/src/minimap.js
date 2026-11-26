import { ROAD_STYLE } from './city.js';
import { drawEventMark } from './eventmarks.js';

const S = 1.5; // 下絵の px/m
export const MAP_PX_PER_M = S;
const ZOOM = 1.1; // ミニマップ上の px/m

export class Minimap {
  constructor(city, canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.B = city.bounds;
    this.waypoints = city.waypoints || [];
    this.events = [];   // イベントの場所 ({ name, x, z, color, active() }。main.js が入れる)
    const B = this.B;
    const m = document.createElement('canvas');
    m.width = Math.ceil((B.maxX - B.minX) * S);
    m.height = Math.ceil((B.maxZ - B.minZ) * S);
    const g = m.getContext('2d');
    const X = (x) => (x - B.minX) * S, Z = (z) => (z - B.minZ) * S;
    const poly = (ring) => { ring.forEach(([x, z], i) => i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))); g.closePath(); };
    const line = (pts) => { g.beginPath(); pts.forEach(([x, z], i) => i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))); g.stroke(); };

    g.fillStyle = '#e9e6df'; g.fillRect(0, 0, m.width, m.height);
    const AREA = { grass: '#cfe3b5', wood: '#b4d29a', park: '#c6e2a6', pitch: '#b8dc98', school: '#ece3cd', water: '#9fc8e6', railway: '#dcd6cc', parking: '#dddddd', plaza: '#f3eee3',
      industrial: '#e3ddd6', cemetery: '#d6dac9', worship: '#e8e1cd', hospital: '#f0dfdf' };
    for (const a of city.areas) {
      if (!AREA[a.kind]) continue;
      g.fillStyle = AREA[a.kind];
      g.beginPath(); poly(a.outer); (a.holes || []).forEach(poly); g.fill('evenodd');
    }
    // PLATEAU の道路面 (実測の形)
    g.fillStyle = '#ffffff';
    for (const a of city.roadAreas || []) { g.beginPath(); poly(a.outer); (a.holes || []).forEach(poly); g.fill('evenodd'); }
    g.lineCap = g.lineJoin = 'round';
    g.strokeStyle = '#9fc8e6';
    for (const w of city.waterways) { g.lineWidth = w.w * S; line(w.pts); }
    for (const r of city.roads) {
      const st = ROAD_STYLE[r.kind];
      if (!st) continue;
      const major = st[2];
      g.strokeStyle = major ? '#f6c768' : (r.kind === 'footway' || r.kind === 'path' || r.kind === 'steps') ? '#f8f6f1' : '#ffffff';
      g.lineWidth = Math.max(1.5, r.w * S);
      line(r.pts);
    }
    g.strokeStyle = '#777'; g.lineWidth = 3 * S;
    for (const r of city.rails) line(r.pts);
    g.strokeStyle = '#fff'; g.lineWidth = 1.5 * S; g.setLineDash([6, 6]);
    for (const r of city.rails) line(r.pts);
    g.setLineDash([]);
    g.fillStyle = '#c9c1b3'; g.strokeStyle = '#ada492'; g.lineWidth = 1;
    for (const b of city.buildings) {
      if (b.minH > 2) continue;
      g.beginPath(); poly(b.outer); (b.holes || []).forEach(poly); g.fill('evenodd'); g.stroke();
    }
    this.map = m;
  }

  // 線路の延長 (data/rail_ext/) の下絵。地図の範囲の外 (東戸塚など) で自分の位置が分かるように。
  // E = detail/railext.js の map ({ bounds, draw })。全体の粗い絵と、読み込んだ区間の細かい絵 (建物・道路・線路・ホーム) を draw が描く。大きい地図 (bigmap.js) も this.ext を使う
  setExt(E) { this.ext = E || null; }
  // 千葉ドリームランドの下絵 (parkmap.js の createParkMap)。線路の延長の下絵の上に描く。大きい地図 (bigmap.js) も this.park を使う
  setPark(P) { this.park = P || null; }

  // ワールド上の相対ベクトル (dx, dz) → ミニマップ画面上の座標 (中心基準)
  toScreen(dx, dz, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [(dx * c - dz * s) * ZOOM, (dx * s + dz * c) * ZOOM];
  }

  // others: ほかのプレイヤー ({ x, z, pvp } の並び。マルチプレイのときだけ)
  // 常に北が上 (カメラの向き yaw では回さない。issue #63)。引数 yaw は呼び出し側との互換のため残してあるだけ
  update(px, pz, _yaw, facing, others = null) {
    const yaw = 0;
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height, R = W / 2, B = this.B;
    c.clearRect(0, 0, W, H);
    c.save();
    c.beginPath(); c.arc(R, R, R, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#d8d4cb'; c.fillRect(0, 0, W, H);
    c.translate(R, R);
    c.rotate(yaw);
    const E = this.ext, r = R / ZOOM;
    if (E) E.draw(c, (x) => (x - px) * ZOOM, (z) => (z - pz) * ZOOM, ZOOM, [px - r, pz - r, px + r, pz + r]);
    if (this.park) this.park.draw(c, (x) => (x - px) * ZOOM, (z) => (z - pz) * ZOOM, ZOOM, [px - r, pz - r, px + r, pz + r]);
    c.scale(ZOOM / S, ZOOM / S);
    c.drawImage(this.map, -(px - B.minX) * S, -(pz - B.minZ) * S);
    c.restore();

    // 目的地 (範囲外なら縁に貼り付け)
    for (const w of this.waypoints) {
      let [sx, sy] = this.toScreen(w.x - px, w.z - pz, yaw);
      const d = Math.hypot(sx, sy), lim = R - 12;
      if (d > lim) { sx *= lim / d; sy *= lim / d; }
      c.save();
      c.translate(R + sx, R + sy);
      c.fillStyle = '#ffb02e'; c.strokeStyle = '#fff'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, -9); c.lineTo(7, 0); c.lineTo(0, 9); c.lineTo(-7, 0); c.closePath();
      c.fill(); c.stroke();
      c.restore();
    }

    // イベントの場所 (見えている範囲にあるときだけ)
    for (const e of this.events) {
      const [sx, sy] = this.toScreen(e.x - px, e.z - pz, yaw);
      if (Math.hypot(sx, sy) > R - 9) continue;
      drawEventMark(c, R + sx, R + sy, 7, e.color, e.active(), e.glyph);
    }

    // ほかのプレイヤー (戦闘オンの人は赤)
    for (const o of others || []) {
      const [sx, sy] = this.toScreen(o.x - px, o.z - pz, yaw);
      if (Math.hypot(sx, sy) > R - 6) continue;
      c.fillStyle = o.pvp ? '#e5484d' : '#2fbf71'; c.strokeStyle = '#fff'; c.lineWidth = 2;
      c.beginPath(); c.arc(R + sx, R + sy, 5, 0, Math.PI * 2); c.fill(); c.stroke();
    }

    // プレイヤー矢印
    const wx = Math.sin(facing), wz = Math.cos(facing);
    const [ax, ay] = this.toScreen(wx, wz, yaw);
    c.save();
    c.translate(R, R);
    c.rotate(Math.atan2(ax, -ay));
    c.fillStyle = '#1aa7e0'; c.strokeStyle = '#fff'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -10); c.lineTo(7, 7); c.lineTo(0, 3); c.lineTo(-7, 7); c.closePath();
    c.fill(); c.stroke();
    c.restore();

    // 北
    const nx = R + (R - 14) * Math.sin(yaw), ny = R - (R - 14) * Math.cos(yaw);
    c.fillStyle = '#d33'; c.beginPath(); c.arc(nx, ny, 9, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.font = 'bold 12px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('N', nx, ny + 1);
  }
}
