export class Input {
  constructor() {
    this.down = new Set();
    this.pressedQ = new Set();
    this.ax = 0; this.az = 0; // タッチのスティックの傾き (右・前が正、長さ 0〜1。touch.js が書く)
    addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedQ.add(e.code);
      this.down.add(e.code);
    });
    // 左クリック = 攻撃 (視点操作でマウスをつかんでいるときだけ。最初のクリックは、つかむためのもの)
    addEventListener('mousedown', (e) => { if (e.button === 0 && document.pointerLockElement) this.pressedQ.add('Mouse0'); });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.ax = this.az = 0; });
  }
  // 画面のボタンから: 1 回押した扱い / 押している間の扱い
  press(code) { this.pressedQ.add(code); }
  setHeld(code, on) { if (on) this.down.add(code); else this.down.delete(code); }
  held(code) { return this.down.has(code); }
  // フレーム内で一度だけ true
  pressed(code) { return this.pressedQ.has(code); }
  endFrame() { this.pressedQ.clear(); }
}
