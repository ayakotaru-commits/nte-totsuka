// フェアリー・リールパークの観覧車に乗る (段階 3)。のりば (輪の正面の地面) の近くで、ゴンドラが底に来ているとき F →「乗る」。
// 乗っている間はキャラがゴンドラの中に立ち、輪が回って視点が上がる (外からの視点・Q でゴンドラの中の視点)。
// 一周 (輪の 1 周ぶん) したあと、ゴンドラが底に着いたら F →「降りる」(のりばへ戻る)。ワープ・リスポーンでも降りる (cancel)。
// 形と動きは detail/parkrides.js (park.areas.rides.ferris)。動きは実際の時計で決まる。
// 確認用: window.__pride (状態)
import * as THREE from 'three';

const REACH = 5.2;       // のりばの立ち位置からこの距離 (m) 以内で乗れる
const BOARD_A = 0.5;     // ゴンドラが底からこの角度 (rad) 以内のとき乗れる
const OFF_A = 0.42;      // 降りられる角度
const BOARD_T = 0.9;     // 乗り込む動きの秒
const EYE = 1.5;         // ゴンドラの中の視点の高さ (床から)
const OUT_DIST = 13;     // 外からの視点の距離
const wrapPi = (a) => ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

export class ParkRide {
  constructor({ park, player, cam, camera, world }) {
    this.park = park; this.player = player; this.cam = cam; this.camera = camera; this.world = world;
    this.riding = null;   // { i, t, from: {x, y, z, face}, view, dist }
    this.P = new THREE.Vector3();
    this.hint = document.getElementById('pride-hint');
    this.btn = document.getElementById('tb-pride');
    this.info = document.getElementById('pride-info');
    this.viewBtn = document.getElementById('tb-view');
    this.toast = document.getElementById('train-toast');
    window.__pride = this;
  }
  get ferris() { const r = this.park && this.park.areas && this.park.areas.rides; return r && r.ferris || null; }

  setHint(txt, btn) {
    const key = (txt || '') + '|' + (btn || '');
    if (this._hk === key) return;
    this._hk = key;
    if (this.hint) { this.hint.hidden = !txt; if (txt) this.hint.innerHTML = txt; }
    if (this.btn) { this.btn.hidden = !btn; if (btn) this.btn.textContent = btn; }
  }
  setInfo(html) {
    if (!this.info || this._info === html) return;
    this._info = html; this.info.hidden = !html; if (html) this.info.innerHTML = html;
  }
  say(msg, sec) {
    this.lastSay = msg;
    if (!this.toast) return;
    this.toast.textContent = msg; this.toast.hidden = false;
    clearTimeout(this._tt); this._tt = setTimeout(() => { this.toast.hidden = true; }, sec * 1000);
  }

  // 毎コマ (キャラの更新の前)。F の押した瞬間をここで見る
  update(dt, input) {
    const fw = this.ferris;
    if (!fw) return;
    const now = Date.now() / 1000, th = fw.theta(now), p = this.player.pos;
    if (this.riding) return this.updateRiding(dt, input, fw, th, now);
    const d = Math.hypot(p.x - fw.spot.x, p.z - fw.spot.z);
    if (d > REACH + 2 || Math.abs(p.y - fw.gy) > 2.2) { this.setHint(null); return; }
    const low = fw.lowest(th);
    if (d <= REACH && Math.abs(low.a) <= BOARD_A) {
      this.setHint('<b>F</b> 観覧車に乗る', '乗る');
      if (input.pressed('KeyF')) this.board(fw, low.i, now);
    } else {
      this.setHint('観覧車　ゴンドラが来るまで少し待ってね', null);
    }
  }

  board(fw, i, now) {
    const p = this.player;
    this.riding = { i, t: 0, t0: now, from: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, view: 'out', dist: this.cam.dist };
    p.vel.set(0, 0); p.vy = 0; p.act = null; p.atk = null;
    this.cam.dist = OUT_DIST;
    this.cam.pitch = 0.18;
    if (this.viewBtn) this.viewBtn.hidden = false;
    this.setHint(null);
    this.say('観覧車に乗りました。ゆっくり一周します', 3);
  }

  // ゴンドラの床の上 (キャラが立つ所)
  seat(fw, i, th, out) {
    fw.pos(i, th, out);
    out.y -= 0.93;
    return out;
  }

  updateRiding(dt, input, fw, th, now) {
    const rd = this.riding, p = this.player, P = this.P;
    rd.t += dt;
    this.seat(fw, rd.i, th, P);
    const k = Math.min(1, rd.t / BOARD_T), e = k * k * (3 - 2 * k);
    if (k < 1) P.set(rd.from.x + (P.x - rd.from.x) * e, rd.from.y + (P.y - rd.from.y) * e, rd.from.z + (P.z - rd.from.z) * e);
    p.pos.copy(P);
    p.model.root.position.copy(P);
    p.facing = fw.cfg.yaw + Math.PI;   // 輪の中心 (のりばと反対) を向く
    p.model.root.rotation.y = p.facing;
    if (input.pressed('KeyQ')) { rd.view = rd.view === 'out' ? 'in' : 'out'; p.model.root.visible = rd.view === 'out'; }
    // 高さ・一周まで・降りられるか
    const h = Math.max(0, P.y - fw.gy), a = Math.abs(wrapPi(th + rd.i / fw.N * Math.PI * 2));
    const omega = Math.PI * 2 / fw.cfg.rev, ang = (now - rd.t0) * omega, left = Math.max(0, (Math.PI * 2 - ang) / omega);
    rd.h = h; rd.a = a; rd.can = ang > Math.PI * 1.9 && a < OFF_A;
    this.setInfo(`<div class="tt">観覧車</div><div>高さ <b>${Math.round(h)}</b> m　${left > 1 ? `一周まであと <b>${Math.ceil(left)}</b> 秒` : 'まもなく到着'}</div>`);
    this.setHint(`${rd.can ? '<b>F</b> 降りる　' : ''}<b>Q</b> ${rd.view === 'out' ? 'ゴンドラの中の視点' : '外からの視点'}`, rd.can ? '降りる' : null);
    if (rd.can && input.pressed('KeyF')) this.alight(fw);
  }

  alight(fw) {
    const s = fw.spot;
    this.finish();
    const pl = this.player;
    pl.teleport(s.x, s.z);
    pl.pos.y = this.world.groundAt(s.x, s.z, fw.gy + 0.3);
    pl.facing = fw.cfg.yaw; this.cam.yaw = pl.facing + Math.PI;
    this.cam.update(0, pl.pos, true);
    this.say('おつかれさま！ 降りました', 2.5);
  }
  // 乗るのをやめた状態に戻す (キャラを出し、カメラの距離を戻す)
  finish() {
    const rd = this.riding;
    if (!rd) return;
    this.riding = null;
    this.player.model.root.visible = true;
    this.cam.dist = rd.dist;
    if (this.viewBtn) this.viewBtn.hidden = true;
    this.setHint(null); this.setInfo(null);
  }
  // ワープ・リスポーンのとき
  cancel() { if (this.riding) this.finish(); }

  // カメラ (乗っている間。cam.update の代わり)
  view(dt) {
    const rd = this.riding, fw = this.ferris;
    if (!rd || !fw) return;
    const cam = this.cam, C = this.player.pos;
    if (rd.view === 'out') { cam.update(dt, { x: C.x, y: C.y + 1.2, z: C.z }); return; }
    const cp = Math.cos(cam.pitch), dir = new THREE.Vector3(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
    this.camera.position.set(C.x, C.y + EYE, C.z);
    this.camera.lookAt(C.x - dir.x, C.y + EYE - dir.y, C.z - dir.z);
    cam.target.set(C.x, C.y + EYE, C.z);
  }
}
