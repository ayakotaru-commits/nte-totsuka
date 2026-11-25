// 全画面マップ (M キー)。北が上。ホイール・2 本指でズーム、ドラッグで移動、F で現在地へ。
import { MAP_PX_PER_M } from './minimap.js';
import { drawEventMark } from './eventmarks.js';

const MIN_SCALE = 0.25, MAX_SCALE = 8;

export class BigMap {
  constructor({ minimap, city, pois, canvas, onWarp, touch = false }) {
    this.onWarp = onWarp;
    this.touch = touch; // タッチ操作のとき: ワープは画面のボタンから
    this.target = null; // クリックで選んだワープ先 {x, z}
    this.map = minimap.map;
    this.minimap = minimap;
    this.B = city.bounds;
    this.start = city.start;
    this.waypoints = city.waypoints || [];
    this.events = [];   // イベントの場所 ({ name, x, z, color, active() }。main.js が入れる)
    this.pois = pois;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.open = false;
    this.cx = 0; this.cz = 0; this.scale = 1;
    this.player = { x: 0, z: 0, facing: 0 };

    // マウスとタッチを同じ扱いにする (pointer イベント)。1 本でドラッグ、2 本でつまんで拡大縮小
    let drag = null, pinch = null;
    const pts = new Map(); // 触れている指 (pointerId → 位置)
    const startDrag = (p, moved) => { drag = { x: p.x, y: p.y, cx: this.cx, cz: this.cz, moved }; };
    const two = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; };
    canvas.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) startDrag(pts.get(e.pointerId), false);
      else if (pts.size === 2) { drag = null; pinch = two(); }
    });
    const up = (e) => {
      if (!pts.delete(e.pointerId)) return;
      // ほとんど動かさずに離したらクリック扱い: ワープ先のピンを立てる
      if (drag && !drag.moved && this.open && e.type === 'pointerup') this.target = this.pickAt(e.clientX, e.clientY);
      drag = null; pinch = null;
      if (pts.size === 1) startDrag([...pts.values()][0], true); // つまんだ後、残った指でそのまま動かせる
    };
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    canvas.addEventListener('dblclick', (e) => {
      this.target = this.pickAt(e.clientX, e.clientY);
      this.warp();
    });
    addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p || !this.open) return;
      p.x = e.clientX; p.y = e.clientY;
      if (pinch && pts.size === 2) {
        const n = two();
        this.cx -= (n.x - pinch.x) / this.scale; this.cz -= (n.y - pinch.y) / this.scale;
        this.zoomAt(n.x, n.y, n.d / pinch.d);
        pinch = n;
        return;
      }
      if (!drag) return;
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > (e.pointerType === 'touch' ? 10 : 4)) drag.moved = true;
      this.cx = drag.cx - (e.clientX - drag.x) / this.scale;
      this.cz = drag.cz - (e.clientY - drag.y) / this.scale;
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation(); // 3Dカメラのズームに伝えない
      this.zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 0.85 : 1.18);
    }, { passive: false });
  }

  // 画面上の点 (カーソル・指の中間) を中心に k 倍する
  zoomAt(clientX, clientY, k) {
    const r = this.canvas.getBoundingClientRect();
    const mx = clientX - r.left - r.width / 2, my = clientY - r.top - r.height / 2;
    const wx = this.cx + mx / this.scale, wz = this.cz + my / this.scale;
    this.scale = Math.max(this.minScale || MIN_SCALE, Math.min(MAX_SCALE, this.scale * k));
    this.cx = wx - mx / this.scale; this.cz = wz - my / this.scale;
  }

  show(px, pz) {
    this.open = true;
    this.canvas.hidden = false;
    this.resize();
    // 初回は全体が収まるズームで現在地中心
    const B = this.B;
    const fit = Math.min(innerWidth / (B.maxX - B.minX), innerHeight / (B.maxZ - B.minZ)) * 0.9;
    if (!this.zoomed) { this.scale = Math.max(fit, 0.6); this.zoomed = true; }
    // 線路の延長 (横浜など、地図の外の駅) まで 1 画面に収まるところまで縮小できる
    const E = this.minimap.ext;
    if (E) {
      const x0 = Math.min(B.minX, E.bounds.minX), x1 = Math.max(B.maxX, E.bounds.maxX), z0 = Math.min(B.minZ, E.bounds.minZ), z1 = Math.max(B.maxZ, E.bounds.maxZ);
      this.minScale = Math.min(MIN_SCALE, Math.min(innerWidth / (x1 - x0), innerHeight / (z1 - z0)) * 0.9);
    }
    this.cx = px; this.cz = pz;
  }

  hide() { this.open = false; this.canvas.hidden = true; this.target = null; }

  // 画面上の座標 → ワールド座標 (街の範囲内に収める)
  toWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect(), B = this.B;
    const x = this.cx + (clientX - r.left - r.width / 2) / this.scale;
    const z = this.cz + (clientY - r.top - r.height / 2) / this.scale;
    return { x: Math.max(B.minX, Math.min(B.maxX, x)), z: Math.max(B.minZ, Math.min(B.maxZ, z)) };
  }

  // クリック・タップした所: イベントの印の上ならその場所 (印の名前つき)、それ以外は地図の上の点
  pickAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect(), hit = this.touch ? 26 : 16;
    for (const e of this.events) {
      if (Math.hypot(this.sx(e.x) - (clientX - r.left), this.sy(e.z) - (clientY - r.top)) <= hit) return { x: e.x, z: e.z, event: e.name };
    }
    return this.toWorld(clientX, clientY);
  }

  // 選んだ場所へワープ (ピンが無ければ何もしない)
  warp() {
    if (!this.open || !this.target || !this.onWarp) return;
    const t = this.target;
    this.target = null;
    this.onWarp(t.x, t.z);
  }

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
    const E = this.minimap.ext;   // 線路の延長 (地図の範囲の外。minimap.js の setExt)
    if (E) E.draw(c, (x) => this.sx(x), (z) => this.sy(z), this.scale, [this.cx - W / 2 / this.scale, this.cz - H / 2 / this.scale, this.cx + W / 2 / this.scale, this.cz + H / 2 / this.scale]);
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

    // イベントの場所 (名前つき)
    for (const e of this.events) {
      const x = this.sx(e.x), y = this.sy(e.z);
      drawEventMark(c, x, y, 11, e.color, e.active(), e.glyph);
      c.font = 'bold 13px "Yu Gothic UI", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      halo(c, e.name, x, y + 24, e.color);
    }

    // ワープ先のピン
    if (this.target) {
      const x = this.sx(this.target.x), y = this.sy(this.target.z);
      c.fillStyle = '#e0436b'; c.strokeStyle = '#fff'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - 7, y - 14); c.arc(x, y - 18, 8, Math.PI * 0.8, Math.PI * 0.2); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y - 18, 3, 0, Math.PI * 2); c.fill();
      c.font = 'bold 13px "Yu Gothic UI", sans-serif';
      halo(c, this.touch ? '「ワープ」で移動' : 'ダブルクリック / Enter でワープ', x, y - 36, '#8a1d3a');
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
