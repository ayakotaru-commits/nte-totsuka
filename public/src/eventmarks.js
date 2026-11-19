// イベントの場所の印 (ミニマップ・大きい地図で共通)。色付きの丸に「！」。active (イベントの最中) のときは点滅する
// 一覧は main.js の EVENTS (各イベントの SITE から作る)。イベントを足すときは、そこに 1 行足す
export function drawEventMark(c, x, y, r, color, active = false) {
  const blink = active ? 0.5 + 0.5 * Math.sin(performance.now() / 1000 * Math.PI * 3) : 1; // 1 秒に 1.5 回
  c.save();
  c.globalAlpha = active ? 0.35 + 0.65 * blink : 1;
  if (active) { // 最中は外側に光の輪
    c.strokeStyle = color; c.lineWidth = 3; c.globalAlpha *= 0.6;
    c.beginPath(); c.arc(x, y, r + 4 + 3 * blink, 0, Math.PI * 2); c.stroke();
    c.globalAlpha = 0.35 + 0.65 * blink;
  }
  c.fillStyle = color; c.strokeStyle = '#fff'; c.lineWidth = 2;
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.stroke();
  c.fillStyle = '#fff'; c.font = `bold ${Math.round(r * 1.5)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('!', x, y + 1);
  c.restore();
}
