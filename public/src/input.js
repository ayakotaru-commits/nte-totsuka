export class Input {
  constructor() {
    this.down = new Set();
    this.pressedQ = new Set();
    addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedQ.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
  }
  held(code) { return this.down.has(code); }
  // フレーム内で一度だけ true
  pressed(code) { return this.pressedQ.has(code); }
  endFrame() { this.pressedQ.clear(); }
}
