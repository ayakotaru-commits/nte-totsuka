// 洋服屋の入口: 入口に少しとどまると「入りますか？」を出す (menu.js の 'ask' 画面)。はいで店の一覧 → 服を買う。
// 場所・店は data/shops.json。入口ごとに x, z, r (反応する半径 m)、y (その入口の足元の高さ。2 階のデッキの入口と、下の道路を区別する)。
// 通りがかりで出ないよう、ほぼ止まって 0.5 秒とどまったときだけ。「やめとく」の後は、入口から離れるまで聞かない。
const DWELL = 0.5;      // とどまる秒数
const MAX_SPEED = 1.5;  // これより速く動いているときは数えない (m/s)
const DY = 2.5;         // 入口の高さとの差の許容 (m)

export async function loadShops() {
  const d = await fetch('data/shops.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return (d && d.places) || [];
}

export class ShopTrigger {
  constructor({ places, player, menu }) {
    this.player = player; this.menu = menu;
    this.list = [];
    for (const p of places) for (const e of p.entrances) this.list.push({ place: p, e, dwell: 0, hold: false });
    menu.onDecline = () => { if (this.cur) this.cur.hold = true; };
    this.cur = null;
  }

  // 毎コマ呼ぶ (動かせる状態のときだけ)
  update(dt) {
    const pl = this.player;
    for (const t of this.list) {
      const { e } = t;
      const d = Math.hypot(pl.pos.x - e.x, pl.pos.z - e.z);
      const same = d <= e.r && (e.y === undefined || e.y === null || Math.abs(pl.pos.y - e.y) <= DY);
      if (!same) { if (d > e.r + 2) t.hold = false; t.dwell = 0; continue; }
      if (t.hold || this.menu.open) continue;
      if (pl.vel.length() > MAX_SPEED) { t.dwell = 0; continue; }
      t.dwell += dt;
      if (t.dwell >= DWELL) { t.dwell = 0; this.cur = t; this.menu.openAsk(t.place, e); }
    }
  }
}
