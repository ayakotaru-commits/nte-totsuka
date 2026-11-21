// メニュー画面 (Tab / 画面の「メニュー」ボタン)。着替え・地図・時間帯・ヘルプ。
// 洋服屋の入口 (shop.js) からも開く: 入りますか？ → 店の一覧 → 服を買う。
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
    this.place = null;     // 洋服屋の入口から開いたとき: { name, entrances, shops }
    this.entrance = null;  // 入った入口 { label, ... }
    this.shop = null;      // 見ている店 { key, name, floor }
    this.onDecline = null; // 「入りますか」を断ったときに呼ぶ (shop.js が、入口を離れるまで聞かない印にする)
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
    this.open = true; this.screen = 'main'; this.msg = ''; this.place = null;
    this.unlock();
    this.el.hidden = false;
    this.render();
  }

  // 洋服屋の入口で「入りますか？」を出す (shop.js から)
  openAsk(place, entrance) {
    if (this.open) return;
    this.open = true; this.screen = 'ask'; this.msg = ''; this.sel = 0;
    this.place = place; this.entrance = entrance; this.shop = null;
    this.unlock();
    this.el.hidden = false;
    this.render();
  }

  close() {
    if (!this.open) return;
    this.restoreCam();
    this.open = false;
    this.el.hidden = true;
    this.place = null;
    this.lock();
  }

  decline() { this.onDecline?.(); this.close(); }

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

  // 一覧に出すのは、持っている服だけ (買っていない服は洋服屋で見る)
  list() { return [{ id: 'default', name: 'いつもの服' }, ...this.wardrobe.items.filter((o) => this.wardrobe.has(o.id))]; }

  // 店で売っている服 (outfits.json の shop が、店の key と同じもの)
  stock(shop) { return this.wardrobe.items.filter((o) => o.shop === shop.key); }

  title() {
    if (this.screen === 'wardrobe') return '着替え';
    if (this.screen === 'ask') return this.place.name;
    if (this.screen === 'place') return this.place.name;
    if (this.screen === 'shop') return this.shop.name;
    return 'メニュー';
  }

  render() {
    const w = this.wardrobe;
    let h = `<div class="mn-head"><b>${this.title()}</b><span class="mn-money">所持金 ${yen(w.money)}</span></div>`;
    if (this.screen === 'main') {
      h += `<div class="mn-list">
        <button class="mn-item" data-do="wardrobe">着替え<small>持っている服に着替える</small></button>
        <button class="mn-item" data-do="map">地図<small>M</small></button>
        <button class="mn-item" data-do="time">時間帯を変える<small>T</small></button>
        <button class="mn-item" data-do="help">操作の説明を出す・隠す<small>H</small></button>
        <button class="mn-item mn-close" data-do="close">閉じる<small>Tab</small></button></div>`;
    } else if (this.screen === 'ask') {
      h += `<div class="mn-msg">${this.entrance.label}です。服の店に入りますか？</div>
        <div class="mn-list">
        <button class="mn-item sel" data-do="enter">入る<small>Y</small></button>
        <button class="mn-item" data-do="decline">やめとく<small>N</small></button></div>`;
    } else if (this.screen === 'place') {
      h += '<div class="mn-list">';
      this.place.shops.forEach((s, i) => {
        const n = this.stock(s).length;
        h += `<button class="mn-item${i === this.sel ? ' sel' : ''}" data-shop="${s.key}">${s.name}<small>${s.floor ? s.floor + '・' : ''}服 ${n} 着</small></button>`;
      });
      h += `</div><div class="mn-msg">${this.msg}</div><button class="mn-item mn-close" data-do="close">出る<small>Esc</small></button>`;
    } else if (this.screen === 'shop') {
      h += '<div class="mn-list">';
      const items = this.stock(this.shop);
      items.forEach((o, i) => {
        const have = w.has(o.id), on = w.equipped === o.id;
        const sub = on ? '着ている' : have ? '持っている・着る' : `買う ${yen(o.price)}`;
        h += `<button class="mn-item${on ? ' on' : ''}${i === this.sel ? ' sel' : ''}${have || w.money >= o.price ? '' : ' locked'}" data-item="${o.id}">${o.name}<small>${sub}</small></button>`;
      });
      h += `</div><div class="mn-msg">${this.msg || (items.length ? '' : 'いまは売っている服がありません')}</div><button class="mn-item mn-close" data-do="place">もどる<small>Esc</small></button>`;
    } else {
      h += '<div class="mn-list">';
      this.list().forEach((o, i) => {
        const on = w.equipped === o.id;
        h += `<button class="mn-item${on ? ' on' : ''}${i === this.sel ? ' sel' : ''}" data-wear="${o.id}">${o.name}<small>${on ? '着ている' : ''}</small></button>`;
      });
      h += `</div><div class="mn-msg">${this.msg || (this.list().length > 1 ? '' : '買った服はここに並びます。洋服屋で買えます')}</div><button class="mn-item mn-close" data-do="back">もどる<small>Esc</small></button>`;
    }
    this.el.innerHTML = h;
  }

  wear(id) {
    const w = this.wardrobe;
    if (!w.has(id)) return; // 一覧には持っている服しか出ないが、念のため
    w.equip(id);
    this.player.model.setOutfit(w.urlOf(id));
    this.msg = '';
    this.render();
  }

  // 店で服を買う。持っている服を押すと、その場で着る
  buy(id) {
    const w = this.wardrobe, o = w.byId.get(id);
    if (!o) return;
    if (w.has(id)) { this.wear(id); this.msg = `「${o.name}」を着ました`; this.render(); return; }
    const r = w.buy(id);
    if (r.ok) { this.msg = `「${o.name}」を買いました。もう一度押すと着られます (メニューの「着替え」からも)`; }
    else this.msg = r.reason === 'お金が足りません' ? `お金が足りません (あと ${yen(o.price - w.money)})` : r.reason;
    this.render();
  }

  enter() { this.go('place'); }

  click(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.wear) { this.sel = this.list().findIndex((o) => o.id === b.dataset.wear); return this.wear(b.dataset.wear); }
    if (b.dataset.shop) { this.shop = this.place.shops.find((s) => s.key === b.dataset.shop); this.go('shop'); return; }
    if (b.dataset.item) { this.sel = this.stock(this.shop).findIndex((o) => o.id === b.dataset.item); return this.buy(b.dataset.item); }
    const d = b.dataset.do;
    if (d === 'wardrobe') this.go('wardrobe');
    else if (d === 'back') this.go('main');
    else if (d === 'enter') this.enter();
    else if (d === 'decline') this.decline();
    else if (d === 'place') this.go('place');
    else if (d === 'close') this.close();
    else if (d === 'map') { this.close(); this.actions.map(); }
    else if (d === 'time') this.actions.time();
    else if (d === 'help') this.actions.help();
  }

  key(e) {
    if (e.code === 'Tab' && !(e.target && e.target.tagName === 'INPUT')) e.preventDefault(); // 画面の中のフォーカス移動を起こさない
    if (!this.open) return;
    if (e.code === 'Escape') {
      if (this.screen === 'wardrobe') this.go('main');
      else if (this.screen === 'ask') this.decline();
      else if (this.screen === 'shop') this.go('place');
      else this.close();
      return;
    }
    if (this.screen === 'ask') {
      if (e.code === 'KeyY' || e.code === 'Enter') this.enter();
      else if (e.code === 'KeyN') this.decline();
      return;
    }
    // 一覧 (着替え・店・服) の選び方: ↑↓ で動かし、Enter で決める
    const rows = this.screen === 'wardrobe' ? this.list() : this.screen === 'place' ? this.place.shops : this.screen === 'shop' ? this.stock(this.shop) : null;
    if (!rows || !rows.length) return;
    const n = rows.length;
    if (e.code === 'ArrowDown') { this.sel = (this.sel + 1) % n; this.render(); e.preventDefault(); }
    else if (e.code === 'ArrowUp') { this.sel = (this.sel + n - 1) % n; this.render(); e.preventDefault(); }
    else if (e.code === 'Enter') {
      if (this.screen === 'wardrobe') this.wear(rows[this.sel].id);
      else if (this.screen === 'place') { this.shop = rows[this.sel]; this.go('shop'); }
      else this.buy(rows[this.sel].id);
    }
  }
}
