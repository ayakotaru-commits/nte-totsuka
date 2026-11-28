// メニュー画面 (Tab / 画面の「メニュー」ボタン)。着替え・キャラメイク・地図・時間帯・ヘルプ。
// 洋服屋の入口 (shop.js) からも開く: 入りますか？ → 店の一覧 → 服を買う。
// 開いている間は、キャラ・イベントへの操作を止める (main.js が menu.open を見る)。街は動き続ける。
// 着替えの画面は 枠 (トップス・ボトムス・くつ・ワンピース) ごとのタブで、選ぶとすぐ着替える。服は買ってから (wardrobe.js)。
// キャラメイクの画面は、タブで 髪型の一覧・髪色・目の色の色見本 (hairstyle.js)。選ぶとすぐ変わる。
// カメラは、着替え・キャラメイクの画面で、キャラの正面へ寄せる。
import * as THREE from 'three';
import { yen, SLOTS } from './wardrobe.js';
import { PALETTE, EYE_PALETTE, SKIN_PALETTE, HEIGHTS, BODIES, FACE_ITEMS } from './hairstyle.js';
import { SLOTS as BSLOTS, parse as parseBless, describe as describeBless } from './blessing.js';
import { STATS, GROUPS, ELEMENTS, BONUS_EVENTS, BONUS_STEP, MAX_LV, SKILL, ULT, fmtStat } from './status.js';

export class Menu {
  constructor({ wardrobe, hairStyle, player, cam, status, dom, lock, unlock, actions }) {
    Object.assign(this, { wardrobe, hairStyle, player, cam, status, lock, unlock, actions });
    this.open = false;
    this.screen = 'main';
    this.slot = 'tops';    // 着替えで見ている枠
    this.bslot = 'head';   // 加護で見ている部位
    this.cmTab = 'style';  // キャラメイクで見ているタブ (style = 髪型、color = 髪色、eye = 目の色)
    this.quiet = false;    // true の間は、髪色の入力 (色の選択枠) を作り直さないよう、画面を描き直さない
    this.sel = 0;
    this.msg = '';
    this.saved = null;
    this.place = null;     // 洋服屋の入口から開いたとき: { name, entrances, shops }
    this.entrance = null;  // 入った入口 { label, ... }
    this.shop = null;      // 見ている店 { key, name, floor }
    this.onLeave = null;   // 洋服屋の画面を閉じたとき (断った・店を出た) に呼ぶ (shop.js が、入口を離れるまで聞かない印にする)
    this.el = document.getElementById('menu');
    this.el.addEventListener('click', (e) => this.click(e));
    // 画面の外をクリックしても閉じない (誤タップ防止)。キーボード
    addEventListener('keydown', (e) => this.key(e));
    // 着替え・キャラメイクの画面で、マウスのドラッグで キャラのまわりを回る (タッチは touch.js が視点を回す)
    dom.addEventListener('pointermove', (e) => { if (this.open && (this.screen === 'wardrobe' || this.screen === 'charmake') && e.pointerType === 'mouse' && e.buttons) this.cam.rotate(e.movementX * 0.008, e.movementY * 0.006); });
    wardrobe.onChange(() => { if (this.open) this.render(); });
    status?.onChange(() => { if (this.open && (this.screen === 'status' || this.screen === 'bless' || this.screen === 'main')) this.render(); });
    hairStyle?.onChange(() => { if (this.open && !this.quiet) this.render(); });
    // 好きな色 (色の選択枠): 動かしている間は、枠を作り直さずに髪色だけ変える。決めたら描き直す
    this.el.addEventListener('input', (e) => { if (e.target.id === 'mn-color') { this.quiet = true; this.pickColor(e.target.value); this.quiet = false; } });
    this.el.addEventListener('change', (e) => { if (e.target.id === 'mn-color') this.render(); });
    // 顔のスライダー: 動かしている間は作り直さず、値の文字だけ変える
    this.el.addEventListener('input', (e) => {
      const k = e.target.dataset?.face; if (!k) return;
      const i = FACE_ITEMS.findIndex((it) => it.key === k), v = +e.target.value / 10;
      this.quiet = true; this.pickFace(k, v); this.quiet = false;
      this.sel = i + 1; this.msg = '';
      const t = this.el.querySelector(`[data-faceval="${i}"]`); if (t) t.textContent = this.faceText(i, v);
      const rb = this.el.querySelector('[data-do=facereset]'); // 動かしたら「元に戻す」を有効に見せる
      if (rb) { const ch = FACE_ITEMS.some((it) => this.faceVal(it.key) !== 0); rb.classList.toggle('locked', !ch); rb.querySelector('small').textContent = ch ? 'すべての項目を 0 へ' : 'いまは元の顔です'; }
      this.el.querySelectorAll('.mn-slide').forEach((el, j) => el.classList.toggle('sel', j === i));
    });
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
    const fromShop = !!this.place;
    this.open = false;
    this.el.hidden = true;
    this.place = null;
    if (fromShop) this.onLeave?.();
    this.lock();
  }

  decline() { this.close(); }

  go(screen) {
    this.screen = screen; this.msg = ''; this.sel = 0;
    if (screen === 'wardrobe' || screen === 'charmake') {
      this.sel = screen === 'charmake' ? (this.cmIndex()) : this.selIndex();
      // カメラをキャラの正面・近くへ (戻すときのために今の値を覚える)
      if (!this.saved) this.saved = { yaw: this.cam.yaw, pitch: this.cam.pitch, dist: this.cam.dist };
      this.cam.yaw = this.player.facing + 0.35;
      this.cam.idle = 0;
      this.applyCmCam();
    } else this.restoreCam();
    this.render();
  }

  // キャラメイクのカメラ: 「顔」タブは顔のアップ (頭の高さ・近く。メニューに隠れない側へ顔を寄せる)、ほかは全身
  applyCmCam() {
    const c = this.cam;
    if (this.screen === 'charmake' && this.cmTab === 'face') {
      let head = null; this.player.model.root.traverse((o) => { if (!head && o.isBone && /head/i.test(o.name)) head = o; });
      const root = this.player.model.root, a = new THREE.Vector3(), b = new THREE.Vector3();
      c.targetY = head ? head.getWorldPosition(a).y - root.getWorldPosition(b).y + 0.04 : 1.5;
      const portrait = innerWidth <= 700 && innerHeight > innerWidth; // 縦長の画面では、メニューが下の 55% を覆う
      c.pitch = 0.05; c.dist = portrait ? 1.3 : 0.75;
      c.view = portrait ? { x: 0, y: 0.25 } : { x: Math.min(340, innerWidth) / 2 / innerWidth, y: 0 };
    } else { c.pitch = 0.12; c.dist = 3.4; c.targetY = null; c.view = null; }
  }

  restoreCam() {
    if (!this.saved) return;
    this.cam.targetY = null; this.cam.view = null;
    Object.assign(this.cam, this.saved); this.saved = null;
  }

  slotName(k) { return (this.wardrobe.slots.find((s) => s.key === k) || { name: k }).name; }

  // 着替えの一覧 (いまの枠): 先頭は「いつもの」(ワンピースは「着ない」)、続いて持っている服
  list() {
    const w = this.wardrobe, k = this.slot;
    return [{ id: 'none:' + k, name: k === 'onepiece' ? 'ワンピースを着ない' : 'いつもの' + this.slotName(k) }, ...w.items.filter((o) => o.slot === k && w.has(o.id) && w.fits(o))];
  }

  // 着ている服の位置 (一覧の何番目か)
  selIndex() {
    const id = this.wardrobe.worn[this.slot];
    return Math.max(0, this.list().findIndex((o) => o.id === id));
  }

  // キャラメイクの髪型の一覧: 先頭は「いつもの髪」、続いて hairs.json の髪
  hairList() {
    const b = this.hairStyle?.body, hs = this.hairStyle ? this.hairStyle.hairs : [];
    return [{ id: 'none', name: 'いつもの髪' }, ...hs.filter((h) => h.body === b), ...hs.filter((h) => h.body !== b)]; // 今の体に合う髪を先に
  }

  hairIndex() {
    const id = this.hairStyle?.id || 'none';
    return Math.max(0, this.hairList().findIndex((o) => o.id === id));
  }

  // 色のタブ (髪色・目の色) の見ている対象: 色見本の一覧 (先頭は「元の色」)・いまの色
  colorList() { return [{ hex: null, name: '元の色' }, ...(this.cmTab === 'eye' ? EYE_PALETTE : this.cmTab === 'skin' ? SKIN_PALETTE : PALETTE)]; }
  curColor() { return (this.cmTab === 'eye' ? this.hairStyle?.eyeColor : this.cmTab === 'skin' ? this.hairStyle?.skinColor : this.hairStyle?.color) || null; }

  colorIndex() {
    const c = this.curColor();
    return Math.max(0, this.colorList().findIndex((o) => o.hex === c));
  }

  // 色を選ぶ (hex = '#rrggbb'、null は元の色)。見ているタブが 目の色 なら目の色、髪色なら髪色
  pickColor(hex) {
    if (!this.hairStyle) return;
    if (this.cmTab === 'eye') {
      if (!this.hairStyle.setEyeColor(hex)) return;
      this.player.model.setEyeColor(this.hairStyle.eyeColor);
    } else if (this.cmTab === 'skin') {
      if (!this.hairStyle.setSkinColor(hex)) return;
      this.player.model.setSkinColor(this.hairStyle.skinColor);
    } else {
      if (!this.hairStyle.setColor(hex)) return;
      this.player.model.setHairColor(this.hairStyle.color);
    }
    this.msg = '';
  }

  // キャラメイクのタブを切り替える
  // 身長の一覧 (先頭は「元の身長」)・いまの位置
  heightList() { const n = this.hairStyle.naturalHeight(); return [{ cm: null, name: `元の身長（約 ${n} cm）` }, ...HEIGHTS.filter((c) => c !== n).map((c) => ({ cm: c, name: c + ' cm' }))]; }
  curHeight() { const c = this.hairStyle?.height || null; return c === this.hairStyle?.naturalHeight() ? null : c; }
  heightIndex() { const c = this.curHeight(); return Math.max(0, this.heightList().findIndex((o) => o.cm === c)); }
  cmIndex() { return this.cmTab === 'face' ? Math.min(this.sel || 0, FACE_ITEMS.length) : this.cmTab === 'body' ? Math.max(0, BODIES.findIndex((o) => o.id === this.hairStyle?.body)) : this.cmTab === 'style' ? this.hairIndex() : this.cmTab === 'height' ? this.heightIndex() : this.colorIndex(); }
  // 体を選ぶ (読み込みが済むまで少しかかる。髪・服・色・身長は引き継ぐ)
  pickBody(id) {
    if (!this.hairStyle || id === this.hairStyle.body || !this.hairStyle.setBody(id)) return;
    this.wardrobe.setBody(id);
    this.msg = '体を変えています…';
    this.sel = this.cmIndex(); this.render();
    const m = this.player.model;
    m.setBody(id).then(() => { // 読み込み後に、色・髪・服・身長を新しい体へ (character.js が覚えている値を付けるので、服の枠と身長だけ)
      m.setHeight(this.hairStyle.heightScale()); this.applyOutfit();
      if (this.hairStyle.body === id) { this.msg = ''; this.render(); }
    });
  }

  pickHeight(cm) {
    if (!this.hairStyle || !this.hairStyle.setHeight(cm)) return;
    this.player.model.setHeight(this.hairStyle.heightScale());
    this.msg = ''; this.sel = this.heightIndex(); this.render();
  }

  // 顔のパーツ: スライダー 1 本 = 1 項目 (sel 0 は「顔を元に戻す」、1〜 が項目)。ドラッグ中は作り直さない (つかんでいるスライダーが消えるため)
  faceVal(k) { return this.hairStyle?.face?.[k] || 0; }
  faceText(i, v) { const g = FACE_ITEMS[i]; return v === 0 ? '元' : (v > 0 ? (g.hi || '大きい') : (g.lo || '小さい')) + ' ' + Math.round(Math.abs(v) * 10); }
  pickFace(key, v) {
    if (!this.hairStyle || !this.hairStyle.setFace(key, v)) return;
    this.player.model.setFace(this.hairStyle.face);
  }
  resetFace() {
    if (!this.hairStyle) return;
    this.hairStyle.resetFace(); this.player.model.setFace(this.hairStyle.face);
    this.msg = '顔を元に戻しました'; this.sel = 0; this.render();
  }
  focusFace() { // 選んでいる行のスライダーへキーボードの操作を移す (← → で値を変えられる)
    const el = this.sel > 0 ? this.el.querySelector(`input[data-face="${FACE_ITEMS[this.sel - 1].key}"]`) : null;
    if (el) el.focus({ preventScroll: false });
  }

  setCmTab(t) { this.cmTab = t; this.applyCmCam(); this.sel = this.cmIndex(); this.msg = ''; this.render(); }

  // 髪型を選ぶ (すぐ髪が変わる)
  pickHair(id) {
    if (!this.hairStyle || !this.hairStyle.set(id)) return;
    this.player.model.setHair(this.hairStyle.entry());
    this.msg = '';
    this.sel = this.hairIndex();
    this.render();
  }

  // 店で売っている服 (outfits.json の shop が、店の key と同じもの)
  stock(shop) { return this.wardrobe.items.filter((o) => o.shop === shop.key && this.wardrobe.fits(o)); }

  title() {
    if (this.screen === 'wardrobe') return '着替え';
    if (this.screen === 'charmake') return 'キャラメイク';
    if (this.screen === 'status') return 'ステータス';
    if (this.screen === 'bless') return '加護';
    if (this.screen === 'ask' || this.screen === 'place') return this.place.name;
    if (this.screen === 'shop') return this.shop.name;
    return 'メニュー';
  }

  render() {
    const w = this.wardrobe;
    let h = `<div class="mn-head"><b>${this.title()}</b><span class="mn-money">所持金 ${yen(w.money)}</span></div>`;
    if (this.screen === 'main') {
      h += `<div class="mn-list">
        <button class="mn-item" data-do="wardrobe">着替え<small>持っている服に着替える</small></button>
        <button class="mn-item" data-do="charmake">キャラメイク<small>体・髪型・髪色・目の色・肌の色・身長</small></button>
        ${this.status ? `<button class="mn-item" data-do="bless">加護<small>体に宿して能力を上げる（${Object.keys(this.status.equip).length} / ${BSLOTS.length}）</small></button>
        <button class="mn-item" data-do="status">ステータス<small>Lv ${this.status.level}</small></button>` : ''}
        <button class="mn-item" data-do="map">地図<small>M</small></button>
        <button class="mn-item" data-do="time">時間帯を変える<small>T</small></button>
        <button class="mn-item" data-do="photo">撮影モード<small>I　画面の表示を消す</small></button>
        <button class="mn-item" data-do="help">操作の説明を出す・隠す<small>H</small></button>
        <button class="mn-item mn-close" data-do="close">閉じる<small>Tab</small></button></div>`;
    } else if (this.screen === 'bless') {
      h += this.blessHtml() + '<button class="mn-item mn-close" data-do="back">もどる<small>Esc</small></button>';
    } else if (this.screen === 'status') {
      h += this.statusHtml() + '<button class="mn-item mn-close" data-do="back">もどる<small>Esc</small></button>';
    } else if (this.screen === 'ask') {
      h += `<div class="mn-msg">${this.entrance.label}です。服の店に入りますか？</div>
        <div class="mn-list">
        <button class="mn-item sel" data-do="enter">入る<small>Y</small></button>
        <button class="mn-item" data-do="decline">やめとく<small>N</small></button></div>`;
    } else if (this.screen === 'place') {
      h += '<div class="mn-list">';
      this.place.shops.forEach((s, i) => {
        const n = this.stock(s).length;
        h += `<button class="mn-item${i === this.sel ? ' sel' : ''}" data-shop="${s.key}">${s.name}<small>${s.floor ? s.floor + '・' : ''}服 ${n} 点</small></button>`;
      });
      h += `</div><div class="mn-msg">${this.msg}</div><button class="mn-item mn-close" data-do="close">出る<small>Esc</small></button>`;
    } else if (this.screen === 'shop') {
      h += '<div class="mn-list">';
      const items = this.stock(this.shop);
      items.forEach((o, i) => {
        const have = w.has(o.id), on = w.isWorn(o.id);
        const sub = `${this.slotName(o.slot)}・${on ? '着ている' : have ? '持っている・着る' : '買う ' + yen(o.price)}`;
        h += `<button class="mn-item${on ? ' on' : ''}${i === this.sel ? ' sel' : ''}${have || w.money >= o.price ? '' : ' locked'}" data-item="${o.id}">${o.name}<small>${sub}</small></button>`;
      });
      h += `</div><div class="mn-msg">${this.msg || (items.length ? '' : 'いまは売っている服がありません')}</div><button class="mn-item mn-close" data-do="place">もどる<small>Esc</small></button>`;
    } else if (this.screen === 'charmake') {
      // キャラメイク: タブ (髪型 / 髪色) + 一覧
      const tabs = [['body', '体'], ['style', '髪型'], ['color', '髪色'], ['eye', '目の色'], ['skin', '肌の色'], ['face', '顔'], ['height', '身長']];
      h += '<div class="mn-tabs">' + tabs.map(([k, n]) => `<button class="mn-tab${k === this.cmTab ? ' on' : ''}" data-cmtab="${k}">${n}</button>`).join('') + '</div>';
      if (this.cmTab === 'body') {
        h += '<div class="mn-list">';
        BODIES.forEach((o, i) => {
          const on = o.id === this.hairStyle?.body;
          h += `<button class="mn-item${on ? ' on' : ''}${i === this.sel ? ' sel' : ''}" data-body="${o.id}">${o.name}<small>${on ? '選んでいる' : ''}</small></button>`;
        });
        h += `</div><div class="mn-msg">${this.msg || '体を変えると、髪・服・色は引き継がれます。合わない服は脱ぎます（体を戻すとまた着られます）'}</div>`;
      } else if (this.cmTab === 'face') {
        const changed = FACE_ITEMS.some((it) => this.faceVal(it.key) !== 0);
        h += `<div class="mn-list mn-faces"><button class="mn-item${this.sel === 0 ? ' sel' : ''}${changed ? '' : ' locked'}" data-do="facereset">顔を元に戻す<small>${changed ? 'すべての項目を 0 へ' : 'いまは元の顔です'}</small></button>`;
        let grp = '';
        FACE_ITEMS.forEach((it, i) => {
          if (it.grp !== grp) { grp = it.grp; h += `<div class="mn-grp">${grp}</div>`; }
          const v = this.faceVal(it.key);
          h += `<label class="mn-item mn-slide${i + 1 === this.sel ? ' sel' : ''}">${it.name}<small data-faceval="${i}">${this.faceText(i, v)}</small><input type="range" min="-10" max="10" step="1" value="${Math.round(v * 10)}" data-face="${it.key}" aria-label="${it.name}"></label>`;
        });
        h += `</div><div class="mn-msg">${this.msg || 'スライダーを動かすとすぐ顔が変わります（←→ でも動かせます。↑↓ で項目を移動）。ドラッグでキャラを回せます'}</div>`;
      } else if (this.cmTab === 'height') {
        const cur = this.curHeight();
        h += '<div class="mn-list">';
        this.heightList().forEach((o, i) => {
          const on = o.cm === cur;
          h += `<button class="mn-item${on ? ' on' : ''}${i === this.sel ? ' sel' : ''}" data-height="${o.cm || 'none'}">${o.name}<small>${on ? '選んでいる' : ''}</small></button>`;
        });
        h += `</div><div class="mn-msg">${this.msg || '選ぶとすぐ背の高さが変わります。ゲームの中の当たり判定・ジャンプ・速さは変わりません'}</div>`;
      } else if (this.cmTab !== 'style') {
        const cur = this.curColor();
        h += '<div class="mn-swatches">';
        this.colorList().forEach((o, i) => {
          const on = o.hex === cur;
          h += o.hex
            ? `<button class="mn-sw${on ? ' on' : ''}${i === this.sel ? ' sel' : ''}" data-color="${o.hex}" style="background:${o.hex}" title="${o.name}" aria-label="${o.name}"></button>`
            : `<button class="mn-sw mn-sw-orig${on ? ' on' : ''}${i === this.sel ? ' sel' : ''}" data-color="none" title="元の色" aria-label="元の色">元</button>`;
        });
        h += `</div><label class="mn-pick">好きな色 <input type="color" id="mn-color" value="${cur || '#6b4630'}"></label>`;
        h += `<div class="mn-msg">${this.msg || (cur ? '' : this.cmTab === 'eye' ? '元の色です。色を選ぶと、目の色が変わります' : this.cmTab === 'skin' ? '元の色です。色を選ぶと、肌の色が変わります' : '元の色です。色を選ぶと、髪の色が変わります')}</div>`;
      } else {
        const cur = this.hairStyle?.id || 'none', bodies = { female: '女性向き', male: '男性向き' };
        h += '<div class="mn-list">';
        this.hairList().forEach((o, i) => {
          const on = o.id === cur;
          h += `<button class="mn-item${on ? ' on' : ''}${i === this.sel ? ' sel' : ''}" data-hair="${o.id}">${o.name}<small>${on ? '選んでいる' : bodies[o.body] || ''}</small></button>`;
        });
        h += `</div><div class="mn-msg">${this.msg || '選ぶとすぐ髪が変わります。ドラッグでキャラを回せます'}</div>`;
      }
      h += '<button class="mn-item mn-close" data-do="back">もどる<small>Esc</small></button>';
    } else {
      // 着替え: 枠のタブ + その枠の服の一覧
      h += '<div class="mn-tabs">' + SLOTS.map((k) => `<button class="mn-tab${k === this.slot ? ' on' : ''}" data-slot="${k}">${this.slotName(k)}</button>`).join('') + '</div><div class="mn-list">';
      this.list().forEach((o, i) => {
        const cur = w.worn[this.slot];
        const on = o.id.startsWith('none:') ? !cur : cur === o.id;
        h += `<button class="mn-item${on ? ' on' : ''}${i === this.sel ? ' sel' : ''}" data-wear="${o.id}">${o.name}<small>${on ? '着ている' : ''}</small></button>`;
      });
      const note = w.worn.onepiece && (this.slot === 'tops' || this.slot === 'bottoms') ? 'ワンピースを着ています。選ぶとワンピースを脱ぎます'
        : this.slot === 'onepiece' ? 'ワンピースを着ると、トップス・ボトムスは外れます' : '';
      h += `</div><div class="mn-msg">${this.msg || note || (this.list().length > 1 ? '' : '買った服はここに並びます。洋服屋で買えます')}</div><button class="mn-item mn-close" data-do="back">もどる<small>Esc</small></button>`;
    }
    this.el.innerHTML = h;
    if (this.screen === 'charmake' && this.cmTab === 'face') this.focusFace();
  }

  // 加護の画面: 部位のタブ + その部位に宿せる (授かった) 加護の一覧。選ぶと宿す。宿している加護をもう一度選ぶと外す
  blessHtml() {
    const s = this.status;
    if (!s) return '<div class="mn-msg">加護は使えません</div>';
    let h = '<div class="mn-tabs">' + BSLOTS.map((b) => `<button class="mn-tab${b.key === this.bslot ? ' on' : ''}" data-bslot="${b.key}">${b.name}${s.equip[b.key] ? ' ●' : ''}</button>`).join('') + '</div><div class="mn-list">';
    const own = [...s.blessings].map(parseBless).filter((b) => b && b.slot === this.bslot).sort((a, b) => b.tier - a.tier || a.el.localeCompare(b.el));
    for (const b of own) {
      const on = s.equip[this.bslot] === b.id;
      h += `<button class="mn-item${on ? ' on' : ''}" data-bless="${b.id}"><span>${b.name}<br><small style="text-align:left;display:block">${describeBless(b.id)}</small></span><small>${on ? '宿している' : '宿す'}</small></button>`;
    }
    h += `</div><div class="mn-msg">${own.length ? '選ぶと宿ります。宿している加護をもう一度選ぶと外れます（部位ごとに 1 つ）。' : 'この部位の加護はまだ授かっていません。イベントを初めてクリアしたときと、5 レベルごとに授かります。'}</div>`;
    return h;
  }

  // ステータスの画面: レベル・経験値、項目の一覧 (ボーナスで足された分は緑)、属性の相性、イベントのボーナス
  statusHtml() {
    const s = this.status;
    if (!s) return '<div class="mn-msg">ステータスは使えません</div>';
    const li = s.levelInfo();
    let h = `<div class="mn-lv"><span><b>Lv ${li.lv}</b>${li.lv >= MAX_LV ? '　（最大）' : ''}</span>`;
    if (li.lv < MAX_LV) h += `<div class="mn-bar"><i style="width:${li.into / li.need * 100}%"></i></div><span class="mn-note">経験値 ${li.into} / ${li.need}（次のレベルまで）</span>`;
    h += '</div>';
    for (const g of GROUPS) {
      h += `<div class="mn-grp">${g}</div><div class="mn-stats">`;
      for (const [k, S] of Object.entries(STATS)) {
        if (S.group !== g) continue;
        const bn = s.bonus[k] || 0;
        h += `<div class="mn-stat"><span>${S.name}</span><span><b>${fmtStat(k, s.value(k))}</b>${bn > 0 ? `<small>ボーナス +${bn.toFixed(1)}</small>` : ''}</span></div>`;
      }
      h += '</div>';
    }
    const spName = (ELEMENTS.find((e) => e.key === s.spElement) || {}).name;
    h += `<div class="mn-grp">特殊攻撃・必殺技の属性（選ぶと変わります）</div><div class="mn-elems">` + ELEMENTS.map((e) => `<button class="mn-el${e.key === s.spElement ? ' on' : ''}" data-spel="${e.key}"><span class="ec" style="background:${e.color}">${e.name}</span></button>`).join('') + '</div>';
    h += `<div class="mn-note">特殊攻撃（K・スマホは「特殊」）: 技ゲージ ${SKILL.cost} を使って、跳び斬り → 急降下の十字斬り。いまの属性は「${spName}」。技ゲージ ${Math.floor(s.skill)} / ${Math.floor(s.value('spGauge'))}。<br>必殺技（U・スマホは「必殺」）: 必殺ゲージが満タンのとき、まわり全部へ回転斬りを ${ULT.spins} 回続けます（出している間は当たりません）。ゲージは攻撃を当てる・倒す・攻撃を受けると溜まります（いま ${Math.floor(s.ult)} / ${Math.floor(s.value('ultGauge'))}）。<br>火 → 木 → 水 → 火 に強い（2 倍）／逆は弱い（0.5 倍）。光と闇はたがいに強い。通常攻撃は無属性です。属性の攻撃・耐性は、加護で伸ばせるようになります（まだ宿していません）。</div>`;
    h += `<div class="mn-grp">イベントのボーナス（初めてクリアすると +${BONUS_STEP}）</div>`;
    for (const [id, ev] of Object.entries(BONUS_EVENTS)) {
      const got = !!s.done[id];
      h += `<div class="mn-bonus${got ? ' got' : ''}"><span>${ev.name}<small>${ev.how}でクリア</small></span><span>${STATS[ev.stat].name} +${BONUS_STEP}　${got ? '獲得済み' : '未獲得'}</span></div>`;
    }
    return h;
  }

  applyOutfit() { this.player.model.setOutfits(this.wardrobe.urls()); }

  // 着る (id が 'none:<枠>' なら、その枠を「いつもの」に戻す)
  wear(id) {
    const w = this.wardrobe;
    if (id.startsWith('none:')) w.unequip(id.slice(5));
    else if (!w.equip(id)) return; // 一覧には持っている服しか出ないが、念のため
    this.applyOutfit();
    this.msg = '';
    this.sel = this.screen === 'wardrobe' ? this.selIndex() : this.sel;
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

  setSlot(k) { this.slot = k; this.sel = this.selIndex(); this.msg = ''; this.render(); }

  click(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.spel) { this.status?.setSpElement(b.dataset.spel); return; }
    if (b.dataset.bslot) { this.bslot = b.dataset.bslot; return this.render(); }
    if (b.dataset.bless) { const id = b.dataset.bless, sl = parseBless(id).slot; this.status?.setEquip(sl, this.status.equip[sl] === id ? null : id); return this.render(); }
    if (b.dataset.slot) return this.setSlot(b.dataset.slot);
    if (b.dataset.cmtab) return this.setCmTab(b.dataset.cmtab);
    if (b.dataset.color) { this.sel = this.colorList().findIndex((o) => (o.hex || 'none') === b.dataset.color); this.pickColor(b.dataset.color); return this.render(); }
    if (b.dataset.body) { this.sel = BODIES.findIndex((o) => o.id === b.dataset.body); return this.pickBody(b.dataset.body); }
    if (b.dataset.height) { this.sel = this.heightList().findIndex((o) => (o.cm || 'none') == b.dataset.height); return this.pickHeight(b.dataset.height); }
    if (b.dataset.hair) { this.sel = this.hairList().findIndex((o) => o.id === b.dataset.hair); return this.pickHair(b.dataset.hair); }
    if (b.dataset.wear) { this.sel = this.list().findIndex((o) => o.id === b.dataset.wear); return this.wear(b.dataset.wear); }
    if (b.dataset.shop) { this.shop = this.place.shops.find((s) => s.key === b.dataset.shop); this.go('shop'); return; }
    if (b.dataset.item) { this.sel = this.stock(this.shop).findIndex((o) => o.id === b.dataset.item); return this.buy(b.dataset.item); }
    const d = b.dataset.do;
    if (d === 'wardrobe') this.go('wardrobe');
    else if (d === 'charmake') this.go('charmake');
    else if (d === 'status') this.go('status');
    else if (d === 'bless') this.go('bless');
    else if (d === 'facereset') this.resetFace();
    else if (d === 'back') this.go('main');
    else if (d === 'enter') this.enter();
    else if (d === 'decline') this.decline();
    else if (d === 'place') this.go('place');
    else if (d === 'close') this.close();
    else if (d === 'map') { this.close(); this.actions.map(); }
    else if (d === 'time') this.actions.time();
    else if (d === 'photo') { this.close(); this.actions.photo(); }
    else if (d === 'help') this.actions.help();
  }

  key(e) {
    if (e.code === 'Tab' && !(e.target && e.target.tagName === 'INPUT')) e.preventDefault(); // 画面の中のフォーカス移動を起こさない
    if (!this.open) return;
    const faceSlider = e.target && e.target.dataset && e.target.dataset.face && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.code); // 顔のスライダーは ← → をそのまま通し、↑↓・PageUp/Down はメニューが使う
    if (e.target && e.target.tagName === 'INPUT' && e.code !== 'Escape' && !faceSlider) return; // 色の選択枠の操作は、そのまま通す
    if (e.code === 'Escape') {
      if (this.screen === 'wardrobe' || this.screen === 'charmake' || this.screen === 'status' || this.screen === 'bless') this.go('main');
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
    // 着替えの枠は ← → で切り替える
    if (this.screen === 'wardrobe' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      const i = SLOTS.indexOf(this.slot), n = SLOTS.length;
      this.setSlot(SLOTS[(i + (e.code === 'ArrowRight' ? 1 : n - 1)) % n]); e.preventDefault(); return;
    }
    // キャラメイクのタブは ← → で切り替える
    if (this.screen === 'charmake' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) { const T = ['body', 'style', 'color', 'eye', 'skin', 'face', 'height'], n = T.length; this.setCmTab(T[(T.indexOf(this.cmTab) + (e.code === 'ArrowRight' ? 1 : n - 1)) % n]); e.preventDefault(); return; }
    if (this.screen === 'charmake' && (e.code === 'PageUp' || e.code === 'PageDown')) { const T = ['body', 'style', 'color', 'eye', 'skin', 'face', 'height'], n = T.length; this.setCmTab(T[(T.indexOf(this.cmTab) + (e.code === 'PageDown' ? 1 : n - 1)) % n]); e.preventDefault(); return; }
    if (this.screen === 'charmake' && this.cmTab === 'face') { // 顔のタブ: ↑↓ で行を移動 (0 = 元に戻す)、Enter は 0 の行のとき元に戻す
      const n = FACE_ITEMS.length + 1;
      if (e.code === 'ArrowDown') this.sel = (this.sel + 1) % n; else if (e.code === 'ArrowUp') this.sel = (this.sel + n - 1) % n;
      else if (e.code === 'Enter' && this.sel === 0) return this.resetFace();
      else return;
      e.preventDefault(); this.render(); return;
    }
    // 一覧 (着替え・店・服) の選び方: ↑↓ で動かし、Enter で決める
    const rows = this.screen === 'wardrobe' ? this.list() : this.screen === 'charmake' ? (this.cmTab === 'body' ? BODIES : this.cmTab === 'style' ? this.hairList() : this.cmTab === 'height' ? this.heightList() : this.colorList()) : this.screen === 'place' ? this.place.shops : this.screen === 'shop' ? this.stock(this.shop) : null;
    if (!rows || !rows.length) return;
    const n = rows.length;
    if (e.code === 'ArrowDown') { this.sel = (this.sel + 1) % n; this.render(); e.preventDefault(); }
    else if (e.code === 'ArrowUp') { this.sel = (this.sel + n - 1) % n; this.render(); e.preventDefault(); }
    else if (e.code === 'Enter') {
      if (this.screen === 'wardrobe') this.wear(rows[this.sel].id);
      else if (this.screen === 'charmake') { if (this.cmTab === 'body') this.pickBody(rows[this.sel].id); else if (this.cmTab === 'height') this.pickHeight(rows[this.sel].cm); else if (this.cmTab !== 'style') { this.pickColor(rows[this.sel].hex); this.render(); } else this.pickHair(rows[this.sel].id); }
      else if (this.screen === 'place') { this.shop = rows[this.sel]; this.go('shop'); }
      else this.buy(rows[this.sel].id);
    }
  }
}
