// スマホ・タブレット用のタッチ操作。
//   画面の左側をドラッグ: 移動 (触れた所にスティックが出る。浅く倒すと歩き、深く倒すと走り)
//   画面の右側をドラッグ: 視点 / 2 本指でつまむ: ズーム
//   ボタン: ジャンプ・ダッシュ (押している間)・地図・時間・戻る・写真 (ストリートビュー)
// ボタンはキーボードと同じキーを押した扱いにする (input.js の press / setHeld)。修正モード (E) と GLB 出力 (G) は PC 専用。
// タッチ専用の端末で自動で有効になる。URL に ?touch で強制的に有効、?touch=0 で無効 (PC での確認用)。

const Q = new URLSearchParams(location.search);
export const TOUCH = Q.has('touch') ? Q.get('touch') !== '0' : matchMedia('(hover: none) and (pointer: coarse)').matches;

const STICK_R = 56;      // スティックを倒しきるまでの距離 (px)
const STICK_AREA = 0.45; // 画面の左からこの割合までが移動、残りが視点
const LOOK = 0.006;      // 視点の速さ (rad/px)

export function setupTouch({ dom, input, cam, streetView, warp, photo }) {
  const $ = (id) => document.getElementById(id);
  document.body.classList.add('touch');
  $('touch-ui').hidden = false;
  $('start-hint').textContent = 'タップで開始（横向きがおすすめ）';
  addEventListener('contextmenu', (e) => e.preventDefault()); // 長押しのメニューを出さない

  // ---- スティックと視点 (街の画面の上) ----
  const stick = $('stick'), knob = $('stick-knob');
  let move = null;          // 移動に使っている指 { id, x, y }
  const look = new Map();   // 視点に使っている指 (pointerId → 位置)
  const spread = () => { const [a, b] = [...look.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  let pinch = 0;
  let tap = null;           // 撮影モードで、動かさずに離したら「終了ボタンを出す」ためのタップ判定

  dom.addEventListener('pointerdown', (e) => {
    dom.setPointerCapture?.(e.pointerId);
    if (photo?.active) { // 撮影モード: 画面のどこでも視点 (スティックは出さない)
      look.set(e.pointerId, { x: e.clientX, y: e.clientY });
      tap = look.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null; // 時間の長さは見ない (動かさずに離せばタップ。重くてイベントの時刻が開いても読める)
      if (look.size === 2) pinch = spread();
      return;
    }
    if (!move && e.clientX < innerWidth * STICK_AREA) {
      move = { id: e.pointerId, x: e.clientX, y: e.clientY };
      stick.style.left = e.clientX + 'px'; stick.style.top = e.clientY + 'px';
      knob.style.transform = '';
      stick.classList.add('on');
    } else {
      look.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (look.size === 2) pinch = spread();
    }
  });
  dom.addEventListener('pointermove', (e) => {
    if (move && e.pointerId === move.id) {
      let dx = (e.clientX - move.x) / STICK_R, dy = (e.clientY - move.y) / STICK_R;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      input.ax = dx; input.az = -dy;
      knob.style.transform = `translate(${dx * STICK_R}px, ${dy * STICK_R}px)`;
      return;
    }
    const p = look.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 12) tap = null;
    if (look.size >= 2) { const d = spread(); cam.zoom(pinch / d); pinch = d; }
    else cam.rotate(dx * LOOK, dy * LOOK);
  });
  const end = (e) => {
    if (move && e.pointerId === move.id) {
      move = null; input.ax = input.az = 0;
      stick.classList.remove('on');
    }
    if (tap && tap.id === e.pointerId && e.type === 'pointerup') photo?.showExit();
    if (tap && tap.id === e.pointerId) tap = null;
    look.delete(e.pointerId);
    if (look.size === 2) pinch = spread();
  };
  dom.addEventListener('pointerup', end);
  dom.addEventListener('pointercancel', end);

  // ---- ボタン ----
  const acts = { streetView, warp };
  for (const b of document.querySelectorAll('.tbtn')) {
    const { key, hold, act } = b.dataset;
    if (hold) {
      const set = (on) => { input.setHeld(hold, on); b.classList.toggle('on', on); };
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); set(true); });
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(t, () => set(false));
    } else if (key) {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); input.press(key); }); // 触れた瞬間に効く (click は離すまで待つ)
    } else if (act) {
      b.addEventListener('click', () => acts[act]()); // 別タブを開くものは click の中で (ポップアップの許可のため)
    }
  }
  // ミニマップをタップしても地図が開く
  $('minimap').addEventListener('pointerdown', () => input.press('KeyM'));
}
