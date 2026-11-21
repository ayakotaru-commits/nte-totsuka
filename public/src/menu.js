// メニュー画面 (Tab / 画面の「メニュー」ボタン)。着替え・地図・時間帯・ヘルプ。
// 開いている間は、キャラ・イベントへの操作を止める (main.js が menu.open を見る)。街は動き続ける。
// 着替えの画面では、カメラをキャラの正面へ寄せ、選ぶとすぐ着替える。服は買ってから (wardrobe.js)。
import { yen } from './wardrobe.js';

export class Menu {
  constructor({ wardrobe, player, cam, dom, lock, unlock, actions }) {
    Object.assign(this, { wardrobe, player, cam, lock, unlock, actions });
    this.open = false;
    this.screen = 'main';
    this.sel = 0;
    this.msg = '';
    this.saved = null;
    this.el = document.getElementById('menu');
    this.el.addEventListener('click', (e) => this.click(e));
    // 画面の外をクリックしても閉じない (誤タップ防止)。キーボード
    addEventListener('keydown', (e) => this.key(e));
    // 着替えの画面で、マウスのドラッグで キャラのまわりを回る (タッチは touch.js が視点を回す)
    dom.addEventListener('pointermove', (e) => { if (this.open && this.screen === 'wardrobe' && e.pointerType === 'mouse' && e.buttons) this.cam.rotate(e.movementX * 0.008, e.movementY * 0.006); });
    wardrobe.onChange(() => { if (this.open) this.render(); });
  }

  toggle() { this.open ? this.close() : this.show(); }

  show() {
    this.open = true; this.screen = 'main'; this.msg = '';
    this.unlock();
    this.el.hidden = false;
    this.render();
  }

  close() {
    if (!this.open) return;
    this.restoreCam();
    this.open = false;
    this.el.hidden = true;
    this.lock();
  }

  go(screen) {
    this.screen = screen; this.msg = ''; this.sel = 0;
    if (screen === 'wardrobe') {
      this.sel = Math.max(0, this.list().findIndex((o) => o.id === this.wardrobe.equipped));
      // カメラをキャラの正面・近くへ (戻すときのために今の値を覚える)
      if (!this.saved) this.saved = { yaw: this.cam.yaw, pitch: this.cam.pitch, dist: this.cam.dist };
      this.cam.yaw = this.player.facing + 0.35; this.cam.pitch = 0.12; this.cam.dist = 3.4;
      this.cam.idle = 0;
    } else this.restoreCam();
    this.render();
  }

  restoreCam() {
    if (!this.saved) return;
    Object.assign(this.cam, this.saved); this.saved = null;
  }

  list() { return [{ id: 'default', name: 'いつもの服' }, ...this.wardrobe.items]; }

  render() {
    const w = this.wardrobe;
    let h = `<div class="mn-head"><b>${this.screen === 'wardrobe' ? '着替え' : 'メニュー'}</b><span class="mn-money">所持金 ${yen(w.money)}</span></div>`;
    if (this.screen === 'main') {
      h += `<div class="mn-list">
        <button class="mn-item" data-do="wardrobe">着替え<small>持っている服に着替える</small></button>
        <button class="mn-item" data-do="map">地図<small>M</small></button>
        <button class="mn-item" data-do="time">時間帯を変える<small>T</small></button>
        <button class="mn-item" data-do="help">操作の説明を出す・隠す<small>H</small></button>
        <button class="mn-item mn-close" data-do="close">閉じる<small>Tab</small></button></div>`;
    } else {
      h += '<div class="mn-list">';
      this.list().forEach((o, i) => {
        const have = w.has(o.id), on = w.equipped === o.id;
        const sub = on ? '着ている' : have ? '持っている' : `${o.shop}で ${yen(o.price)}`;
        h += `<button class="mn-item${on ? ' on' : ''}${have ? '' : ' locked'}${i === this.sel ? ' sel' : ''}" data-wear="${o.id}">${o.name}<small>${sub}</small></button>`;
      });
      h += `</div><div class="mn-msg">${this.msg || (w.items.length ? '' : '服はまだありません')}</div><button class="mn-item mn-close" data-do="back">もどる<small>Esc</small></button>`;
    }
    this.el.innerHTML = h;
  }

  wear(id) {
    const w = this.wardrobe;
    if (!w.has(id)) {
      const o = w.byId.get(id);
      this.msg = `${o.shop} で買えます (${yen(o.price)})`; this.render(); return;
    }
    w.equip(id);
    this.player.model.setOutfit(w.urlOf(id));
    this.msg = '';
    this.render();
  }

  click(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.wear) { this.sel = this.list().findIndex((o) => o.id === b.dataset.wear); return this.wear(b.dataset.wear); }
    const d = b.dataset.do;
    if (d === 'wardrobe') this.go('wardrobe');
    else if (d === 'back') this.go('main');
    else if (d === 'close') this.close();
    else if (d === 'map') { this.close(); this.actions.map(); }
    else if (d === 'time') this.actions.time();
    else if (d === 'help') this.actions.help();
  }

  key(e) {
    if (e.code === 'Tab' && !(e.target && e.target.tagName === 'INPUT')) e.preventDefault(); // 画面の中のフォーカス移動を起こさない
    if (!this.open) return;
    if (e.code === 'Escape') { this.screen === 'wardrobe' ? this.go('main') : this.close(); return; }
    if (this.screen === 'wardrobe') {
      const n = this.list().length;
      if (e.code === 'ArrowDown') { this.sel = (this.sel + 1) % n; this.render(); e.preventDefault(); }
      else if (e.code === 'ArrowUp') { this.sel = (this.sel + n - 1) % n; this.render(); e.preventDefault(); }
      else if (e.code === 'Enter') this.wear(this.list()[this.sel].id);
    }
  }
}
