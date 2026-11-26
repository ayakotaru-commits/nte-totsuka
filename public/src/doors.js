// 開け閉めできる扉 (グランシティの時計の棟の正面の扉と、中庭側の扉)。開けるときは、キャラが両手で押す動き (character.js の doorPose)。
// 扉の形は detail/clockhouse.js が作って DOORS に登録する。ここでは、近くで F (スマホは「開ける」ボタン) を押すと
// 開く/閉まる動きと、当たり判定 (閉じている間だけ通れない) を受け持つ。
// 開いた扉は、プレイヤーが 6 m 以上離れて 4 秒たつと自動で閉まる。扉の間に人がいる間は閉まらない。

// 登録された扉: { x, z, y, nx, nz (外向き), w, h, leaves: [{ pivot (THREE.Object3D), sign }], rec, amt, target, away, wait }
export const DOORS = [];

const REACH = 2.4;     // 扉の中心からこの距離 (m) 以内で操作できる
const SPEED = 1.3;     // 開け閉めの速さ (1 秒あたりの割合。約 0.8 秒で開く)
const SWING = 1.5;     // 開いたときの角度 (rad、約 86°)
const AUTO_D = 6, AUTO_T = 4;

export class DoorControl {
  constructor(world) {
    this.world = world;
    for (const d of DOORS) this.init(d);
    this.hint = document.getElementById('door-hint');
    this.btn = document.getElementById('tb-door');
    this.near = null;
  }

  // 閉じた扉の当たり判定: 扉の幅で、厚さ 0.3 m の板 (向き = 外向きの法線)。あとから作られる扉 (城の主塔) も update が登録する
  init(d) {
    d.rec = this.world.addDoor(d.x - d.nx * 0.05, d.z - d.nz * 0.05, Math.atan2(d.nx, d.nz), d.w / 2, 0.15, d.y, d.y + d.h);
    d.amt = d.target = 0; d.away = 0;
  }

  // 扉の間 (開口の中) に人がいるか
  inDoorway(d, p) {
    const dx = p.x - d.x, dz = p.z - d.z;
    const along = Math.abs(-dx * d.nz + dz * d.nx), across = Math.abs(dx * d.nx + dz * d.nz);
    return along < d.w / 2 + 0.2 && across < 0.9;
  }

  update(dt, player, input) {
    if (!DOORS.length) return;
    for (const d of DOORS) if (!d.rec) this.init(d);
    const p = player.pos;
    let near = null, best = REACH;
    for (const d of DOORS) {
      const dist = Math.hypot(p.x - d.x, p.z - d.z);
      if (dist < best && Math.abs(p.y - d.y) < 2) { best = dist; near = d; }
      // 自動で閉める
      if (d.target === 1) {
        d.away = dist > AUTO_D ? d.away + dt : 0;
        if (d.away > AUTO_T) d.target = 0;
      }
    }
    if (near && input.pressed('KeyF')) {
      near.target = near.target ? 0 : 1;
      near.away = 0;
      if (near.target) {
        player.facing = Math.atan2(near.x - p.x, near.z - p.z);   // 扉の方を向いて、両手で押して開ける
        // 手が扉に届くころ (動きの 3 割ほど) に扉が動き出す。動きを始められないとき (攻撃中など) はすぐ開く
        near.wait = player.startDoor && player.startDoor() ? 0.3 : 0;
      }
    }
    for (const d of DOORS) {
      if (d.target === 0 && this.inDoorway(d, p)) d.target = d.amt > 0.5 ? 1 : d.target;   // 人がいる間は閉めない
      const step = SPEED * dt;
      if (d.wait > 0) { d.wait -= dt; continue; }
      d.amt = d.target ? Math.min(1, d.amt + step) : Math.max(0, d.amt - step);
      const e = d.amt * d.amt * (3 - 2 * d.amt);   // なめらかに
      for (const l of d.leaves) l.pivot.rotation.y = l.sign * SWING * e;
      d.rec.door.open = d.amt > 0.6;
    }
    if (near !== this.near) {
      this.near = near;
      if (this.hint) this.hint.hidden = !near;
      if (this.btn) this.btn.hidden = !near;
    }
    if (near && this.hint) {
      const txt = near.target ? '扉を閉める' : '扉を開ける';
      if (this.hint.dataset.t !== txt) { this.hint.dataset.t = txt; this.hint.innerHTML = `<b>F</b> ${txt}`; if (this.btn) this.btn.textContent = near.target ? '閉める' : '開ける'; }
    }
  }
}
