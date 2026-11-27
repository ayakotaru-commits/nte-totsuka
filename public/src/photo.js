// 撮影モード。画面の UI (ミニマップ・メニュー・ボタン・案内・地名など) を全部消し、ズームと視点の操作だけにする。
// 撮影そのものは端末のスクリーンショットに任せる。人と車は止まる (main.js が更新を飛ばす)。
// 入る: I キー / メニューの「撮影モード」 / スマホの上の帯の「撮影」。
// 抜ける: 歩き出す (WASD・矢印・Space・Shift・スティック) / Esc / I キー。
//         スマホは画面を 1 回タップ (動かさずに離す) すると右上に「×」が 3 秒出る。そこを押す。
// 消す範囲は style.css の body.photo (#app と #photo-ui 以外の body 直下を全部消す)。
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'];
const MAX_DIST = 80;     // 撮影中のズームの上限 (ふだんは cam.maxDist = 30)
const HINT_SEC = 3.5;    // 入った直後の案内を出す秒数
const EXIT_SEC = 3;      // タップで出る「×」を出す秒数

export class PhotoMode {
  constructor({ cam, touch, canStart = () => true }) {
    this.cam = cam; this.touch = touch; this.canStart = canStart;
    this.active = false;
    this.armed = false;        // 入ってから一度、歩く操作が止まったら true (入る前から押していたキーで、すぐ抜けないように)
    this.savedMax = cam.maxDist;
    this.hintT = 0; this.exitT = 0;
    const $ = (id) => document.getElementById(id);
    this.hint = $('photo-hint'); this.exitBtn = $('photo-exit');
    this.exitBtn.addEventListener('click', () => this.exit());
    this.exitBtn.addEventListener('pointerdown', (e) => e.stopPropagation()); // 下の画面のタップ判定に渡さない
  }

  enter() {
    if (this.active || !this.canStart()) return false;
    this.active = true; this.armed = false;
    this.savedMax = this.cam.maxDist; this.cam.maxDist = MAX_DIST;
    document.body.classList.add('photo');
    this.hint.textContent = this.touch ? '画面をタップすると、終了ボタンが出ます' : 'W A S D・Esc・I で撮影モードを終わります';
    this.hintT = HINT_SEC; this.exitT = 0;
    this.render();
    return true;
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove('photo');
    this.cam.maxDist = this.savedMax;
    this.cam.dist = Math.min(this.cam.dist, this.savedMax);
    this.hintT = this.exitT = 0;
    this.render();
  }

  toggle() { this.active ? this.exit() : this.enter(); }

  // 画面を 1 回タップしたとき (touch.js から): 終了ボタンを一時的に出す
  showExit() { if (this.active) { this.exitT = EXIT_SEC; this.render(); } }

  // 毎コマ (main.js が、入力をキャラへ渡す前に呼ぶ)。歩き出し・Esc・I で抜ける。抜けたコマから、その入力はキャラに効く
  update(dt, input) {
    if (input.pressed('KeyI')) { this.toggle(); return; }
    if (!this.active) return;
    if (input.pressed('Escape')) { this.exit(); return; }
    const moving = MOVE_KEYS.some((k) => input.held(k)) || Math.hypot(input.ax, input.az) > 0.15;
    if (!this.armed) { if (!moving) this.armed = true; }
    else if (moving) { this.exit(); return; }
    if (this.hintT > 0 || this.exitT > 0) {
      this.hintT = Math.max(0, this.hintT - dt); this.exitT = Math.max(0, this.exitT - dt);
      if (this.hintT === 0 || this.exitT === 0) this.render();
    }
  }

  render() {
    this.hint.classList.toggle('show', this.active && this.hintT > 0);
    this.exitBtn.classList.toggle('show', this.active && this.exitT > 0);
  }
}
