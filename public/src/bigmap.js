// 全画面マップ (M キー)。北が上。ホイールでズーム、ドラッグで移動、F で現在地へ。
import { MAP_PX_PER_M } from './minimap.js';

const MIN_SCALE = 0.25, MAX_SCALE = 8;

export class BigMap {
  constructor({ minimap, city, pois, canvas }) {
    this.map = minimap.map;
    this.B = city.bounds;
    this.start = city.start;
    this.waypoints = city.waypoints || [];
    this.pois = pois;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.open = false;
    this.cx = 0; this.cz = 0; this.scale = 1;
    this.player = { x: 0, z: 0, facing: 0 };

    let drag = null;
    canvas.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz }; });
    addEventListener('mouseup', () => { drag = null; });
    addEventListener('mousemove', (e) => {
      if (!drag || !this.open) return;
      this.cx = drag.cx - (e.clientX - drag.x) / this.scale;
      this.cz = drag.cz - (e.clientY - drag.y) / this.scale;
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation(); // 3Dカメラのズームに伝えない
      // カーソル位置を中心にズーム
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
      const wx = this.cx + mx / this.scale, wz = this.cz + my / this.scale;
      this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale * (e.deltaY > 0 ? 0.85 : 1.18)));
      this.cx = wx - mx / this.scale; this.cz = wz - my / this.scale;
    }, { passive: false });
  }

  show(px, pz) {
    this.open = true;
    this.canvas.hidden = false;
    this.resize();
    // 初回は全体が収まるズームで現在地中心
    const B = this.B;
    const fit = Math.min(innerWidth / (B.maxX - B.minX), innerHeight / (B.maxZ - B.minZ)) * 0.9;
    if (!this.zoomed) { this.scale = Math.max(fit, 0.6); this.zoomed = true; }
    this.cx = px; this.cz = pz;
  }

  hide() { this.open = false; this.canvas.hidden = true; }

  centerOnPlayer() { this.cx = this.player.x; this.cz = this.player.z; }

  resize() {
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = innerWidth * dpr;
    this.canvas.height = innerHeight * dpr;
    this.dpr = dpr;
  }

  sx(x) { return innerWidth / 2 + (x - this.cx) * this.scale; }
  sy(z) { return innerHeight / 2 + (z - this.cz) * this.scale; }

  draw(px, pz, facing) {
    if (!this.open) return;
    this.player = { x: px, z: pz, facing };
    const c = this.ctx, B = this.B, S = MAP_PX_PER_M, W = innerWidth, H = innerHeight;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#1a2130'; c.fillRect(0, 0, W, H);
    c.imageSmoothingEnabled = this.scale < S;
    c.drawImage(this.map, 0, 0, this.map.width, this.map.height,
      this.sx(B.minX), this.sy(B.minZ), this.map.width / S * this.scale, this.map.height / S * this.scale);

    // 施設名 (ズームに応じて量を増やす)
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const p of this.pois) {
      const station = p.cat === 'railway:station';
      if (!station) {
        if (p.cat === 'building' || p.cat.startsWith('area:')) { if (this.scale < 1.6) continue; }
        else if (this.scale < 3.5) continue;
      }
      const x = this.sx(p.x), y = this.sy(p.z);
      if (x < -100 || x > W + 100 || y < -20 || y > H + 20) continue;
      c.font = station ? 'bold 16px "Yu Gothic UI", sans-serif' : '12px "Yu Gothic UI", sans-serif';
      halo(c, p.label, x, y, station ? '#1d2a44' : '#3b3428');
    }

    // スタート地点
    if (this.start) {
      const x = this.sx(this.start.x), y = this.sy(this.start.z);
      c.fillStyle = '#2e9e5b'; c.strokeStyle = '#fff'; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, 8, 0, Math.PI * 2); c.fill(); c.stroke();
      c.font = 'bold 12px "Yu Gothic UI", sans-serif';
      halo(c, 'スタート', x, y - 18, '#1f6b3e');
    }
    // 目的地
    for (const w of this.waypoints) {
      const x = this.sx(w.x), y = this.sy(w.z);
      c.save(); c.translate(x, y);
      c.fillStyle = '#ffb02e'; c.strokeStyle = '#fff'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, -12); c.lineTo(9, 0); c.lineTo(0, 12); c.lineTo(-9, 0); c.closePath(); c.fill(); c.stroke();
      c.restore();
      c.font = 'bold 13px "Yu Gothic UI", sans-serif';
      halo(c, w.name, x, y + 22, '#7a4a00');
    }

    // 現在地 (点滅する輪 + 向きの矢印)
    const x = this.sx(px), y = this.sy(pz), t = performance.now() / 1000;
    c.strokeStyle = `rgba(26,167,224,${0.6 - (t % 1.2) / 2})`; c.lineWidth = 3;
    c.beginPath(); c.arc(x, y, 10 + (t % 1.2) * 18, 0, Math.PI * 2); c.stroke();
    c.save(); c.translate(x, y); c.rotate(Math.PI - facing);
    c.fillStyle = '#1aa7e0'; c.strokeStyle = '#fff'; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(0, -14); c.lineTo(10, 10); c.lineTo(0, 4); c.lineTo(-10, 10); c.closePath(); c.fill(); c.stroke();
    c.restore();
    c.font = 'bold 13px "Yu Gothic UI", sans-serif';
    halo(c, '現在地', x, y + 26, '#0b5a7a');

    // 方位・縮尺
    c.font = 'bold 18px sans-serif';
    halo(c, '▲N', W - 40, 40, '#a22');
    const meters = niceLen(120 / this.scale);
    const len = meters * this.scale;
    c.fillStyle = '#fff'; c.fillRect(W - 40 - len, H - 50, len, 4);
    c.font = '12px sans-serif'; c.textAlign = 'right';
    c.fillText(meters >= 1000 ? meters / 1000 + ' km' : meters + ' m', W - 40, H - 62);
  }
}

function halo(c, text, x, y, color) {
  c.lineWidth = 4; c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineJoin = 'round';
  c.strokeText(text, x, y);
  c.fillStyle = color; c.fillText(text, x, y);
}

function niceLen(m) {
  const p = Math.pow(10, Math.floor(Math.log10(m)));
  for (const k of [1, 2, 5, 10]) if (k * p >= m) return k * p;
  return 10 * p;
}
