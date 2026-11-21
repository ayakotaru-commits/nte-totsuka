// 曲ごとの動く背景 (リズムゲームの画面。canvas 2D)。曲のイメージ (題・歌詞に出てくる言葉) を、コードで描いて動かす。
//   Stage (draw.js) が、譜面の id に合う場面があればそれを背景にする (無い曲は、いつもの水玉と星の背景)。
//   場面は draw({ g, t, dt, pulse, key, bi, mode, combo }) で毎コマ全面を描く。t = 曲の時刻、pulse = 拍からの弾み (1 → 0)、
//   key = 区間 (intro / A / B / chorus / outro)、bi = { i: 拍の番号, ph }、mode = play / bg / result、combo = 今のコンボ。
// 絵は最初に 1 度だけ作る (雲・キャンディ・星)。実物の素材 (イラスト・動画) は使わない。

const RAINBOW = ['#ff6b9a', '#ffa14a', '#ffe14a', '#5fe08a', '#4cc3ff', '#b58cff'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const easeOutBack = (x) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function heartPath(g, cx, cy, s) {
  g.beginPath(); g.moveTo(cx, cy + s * 0.9);
  g.bezierCurveTo(cx - s * 1.6, cy - s * 0.1, cx - s * 0.9, cy - s * 1.2, cx, cy - s * 0.4);
  g.bezierCurveTo(cx + s * 0.9, cy - s * 1.2, cx + s * 1.6, cy - s * 0.1, cx, cy + s * 0.9); g.closePath();
}
function starPath(g, cx, cy, ro, ri, n = 5, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) { const r = i % 2 ? ri : ro, a = rot + i * Math.PI / n; g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  g.closePath();
}

// ---------- 絵 ----------
const CLOUD_COLORS = ['#ffc9e3', '#c8f5df', '#fff3b8', '#e1d4ff', '#cfeaff'];
function cloudSprite(col, face) {
  const c = mk(440, 240), g = c.getContext('2d');
  const blobs = [[110, 150, 64], [190, 118, 86], [282, 124, 78], [352, 156, 58], [232, 164, 80], [146, 170, 52]];
  const base = hex(col);
  g.fillStyle = rgb(mixc(base, [150, 120, 190], 0.22)); for (const [x, y, r] of blobs) { g.beginPath(); g.arc(x, y + 9, r, 0, 7); g.fill(); }
  g.fillStyle = col; for (const [x, y, r] of blobs) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(255,255,255,.6)'; for (const [x, y, r] of blobs) { g.beginPath(); g.arc(x - r * 0.22, y - r * 0.3, r * 0.5, 0, 7); g.fill(); }
  g.globalCompositeOperation = 'destination-out'; g.fillRect(0, 214, 440, 40); g.globalCompositeOperation = 'source-over';   // 底は平ら
  if (face) {
    g.fillStyle = '#6a4a8a'; for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(232 + sx * 34, 150, 7, 10, 0, 0, 7); g.fill(); }
    g.fillStyle = '#fff'; for (const sx of [-1, 1]) { g.beginPath(); g.arc(232 + sx * 34 - 2, 146, 2.6, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(255,110,160,.5)'; for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(232 + sx * 56, 166, 13, 8, 0, 0, 7); g.fill(); }
    g.strokeStyle = '#6a4a8a'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.arc(232, 160, 13, Math.PI * 0.12, Math.PI * 0.88); g.stroke();
  }
  return c;
}
function lollipopSprite(col) {
  const c = mk(120, 170), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(55, 90, 10, 72);
  g.fillStyle = col; for (let y = 98; y < 160; y += 16) g.fillRect(55, y, 10, 8);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(60, 54, 50, 0, 7); g.fill();
  g.fillStyle = col; g.beginPath(); g.arc(60, 54, 44, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath();
  for (let a = 0; a < 13; a += 0.2) { const r = 3 + a * 3.1, x = 60 + Math.cos(a) * r, y = 54 + Math.sin(a) * r; if (a === 0) g.moveTo(x, y); else g.lineTo(x, y); }
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(42, 34, 14, 7, -0.6, 0, 7); g.fill();
  return c;
}
function wrappedSprite(col) {
  const c = mk(170, 100), g = c.getContext('2d'), base = hex(col), lt = rgb(mixc(base, [255, 255, 255], 0.5));
  for (const sx of [-1, 1]) { g.fillStyle = lt; g.beginPath(); g.moveTo(85 + sx * 24, 50); g.lineTo(85 + sx * 80, 14); g.lineTo(85 + sx * 80, 86); g.closePath(); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 4; g.stroke(); }
  g.fillStyle = '#fff'; g.beginPath(); g.arc(85, 50, 36, 0, 7); g.fill();
  g.fillStyle = col; g.beginPath(); g.arc(85, 50, 31, 0, 7); g.fill();
  g.save(); g.beginPath(); g.arc(85, 50, 31, 0, 7); g.clip(); g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 8;
  for (let x = 20; x < 150; x += 20) { g.beginPath(); g.moveTo(x, 90); g.lineTo(x + 30, 10); g.stroke(); } g.restore();
  g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.ellipse(72, 36, 11, 6, -0.6, 0, 7); g.fill();
  return c;
}
function heartSprite(col) {
  const c = mk(100, 100), g = c.getContext('2d');
  g.fillStyle = '#fff'; heartPath(g, 50, 52, 38); g.fill(); g.fillStyle = col; heartPath(g, 50, 52, 30); g.fill();
  g.fillStyle = 'rgba(255,255,255,.65)'; g.beginPath(); g.ellipse(34, 38, 9, 5, -0.6, 0, 7); g.fill();
  return c;
}
function starSprite(col) {
  const c = mk(100, 100), g = c.getContext('2d');
  g.fillStyle = '#fff'; starPath(g, 50, 54, 46, 22); g.fill(); g.fillStyle = col; starPath(g, 50, 54, 37, 18); g.fill();
  g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.ellipse(40, 40, 9, 5, -0.6, 0, 7); g.fill();
  return c;
}
function sparkleSprite() {
  const c = mk(64, 64), g = c.getContext('2d');
  g.fillStyle = '#fff'; starPath(g, 32, 32, 30, 5, 4, 0); g.fill();
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 20); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return c;
}

const WORDS = ['ぴぴぴ！', 'きゃきゃきゃ！', 'るるる♪', 'ぴこぴこ', 'きゅるるん', 'るんるん！', 'ぱぱぱ！', 'はっぴーちゅう！'];
const SKY = { calm: ['#ffd9ee', '#ead7ff', '#cfeeff'], hot: ['#fff1b0', '#ffc6e2', '#ffd9bd'] };

// ---------- 「ぴぴぴ☆受信ちゅう！」 ----------
//   歌詞の言葉から: アンテナ (電波・受信)・お星さま・ハートのチャンネル・キャンディスカイ (綿あめの雲・キャンディ)・レインボーモード (虹)・
//   世界がくるっとまわりだす (サビで渦巻き)・ドキドキメーター (コンボで振り切れる = オーバーヒート)
export class PipipiScene {
  constructor(stage) {
    this.st = stage; this.tm = 0; this.cf = 0; this.meter = 0; this.lastBeat = -9; this.idleBeat = -1;
    this.rings = []; this.bubbles = []; this.shooters = [];
    this.S = null;
    const r = (a, b) => a + Math.random() * (b - a);
    this.clouds = Array.from({ length: 9 }, (_, i) => ({ layer: i % 3, x: Math.random(), y: [0.12, 0.34, 0.6][i % 3] + r(-0.06, 0.1), sp: [6, 11, 20][i % 3] * r(0.8, 1.3), w: [0.22, 0.3, 0.42][i % 3] * r(0.85, 1.2), c: i % 5, face: i === 2 || i === 6 }));
    this.candies = Array.from({ length: 16 }, (_, i) => ({ k: i % 4, c: i % 6, x: Math.random(), y: Math.random(), sp: r(0.018, 0.045), size: r(0.05, 0.085), ph: r(0, 6.28), rot: r(-0.5, 0.5) }));
    this.twinkles = Array.from({ length: 46 }, () => ({ x: Math.random(), y: Math.random() * 0.62, s: r(0.4, 1), ph: r(0, 6.28) }));
  }
  ensure() {
    if (this.S) return;
    this.S = {
      cloud: CLOUD_COLORS.map((c, i) => cloudSprite(c, false)), cloudFace: CLOUD_COLORS.map((c) => cloudSprite(c, true)),
      lolli: RAINBOW.map(lollipopSprite), wrap: RAINBOW.map(wrappedSprite), heart: RAINBOW.map(heartSprite), star: RAINBOW.map(starSprite), spark: sparkleSprite(),
    };
  }

  onBeat(i, key) {
    const hot = key === 'chorus';
    if (i % (hot ? 1 : 2) === 0) this.rings.push({ age: 0, c: i % 6 });
    if (i % (hot ? 2 : 4) === 0) this.bubbles.push({ age: 0, w: WORDS[Math.floor(Math.random() * WORDS.length)], c: Math.floor(Math.random() * 6), dx: (this.bubN = (this.bubN || 0) + 1) % 2 ? 10 : -120 });
    if (i % (hot ? 8 : 16) === 0) this.shooters.push({ age: 0, x: 0.2 + Math.random() * 0.7, y: 0.02 + Math.random() * 0.25, c: Math.floor(Math.random() * 6) });
    if (this.rings.length > 12) this.rings.shift();
    if (this.bubbles.length > 3) this.bubbles.shift();
  }

  draw(P) {
    this.ensure();
    const { g, t, dt, pulse, key, bi, mode, combo } = P, st = this.st, { W, H, L } = st, m = Math.min(W, H);
    this.tm += dt;
    const hot = key === 'chorus' || key === 'big' ? 1 : 0;
    this.cf += (hot - this.cf) * clamp(dt * 1.6, 0, 1);
    const cf = this.cf;
    // 拍 (曲の最中は譜面の拍、それ以外は一定のテンポ)
    const beat = mode === 'play' && bi.i >= 0 ? bi.i : -1;
    const ib = Math.floor(this.tm / 0.43);
    if (mode === 'play') { if (beat >= 0 && beat !== this.lastBeat) { this.lastBeat = beat; this.onBeat(beat, key); } }
    else if (ib !== this.idleBeat) { this.idleBeat = ib; this.onBeat(ib, 'A'); }
    const pls = mode === 'play' ? pulse : Math.pow(0.5 + 0.5 * Math.sin(this.tm * Math.PI * 2 / 0.43), 3);

    // 1. キャンディスカイ
    const [a0, a1, a2] = SKY.calm.map(hex), [b0, b1, b2] = SKY.hot.map(hex);
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, rgb(mixc(a0, b0, cf))); gr.addColorStop(0.55, rgb(mixc(a1, b1, cf))); gr.addColorStop(1, rgb(mixc(a2, b2, cf)));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);

    // 2. サビは、世界がくるっとまわる渦巻き (虹色のしま)
    if (cf > 0.02) {
      g.save(); g.globalAlpha = 0.28 * cf; const cx = L.cx, cy = L.yJ - H * 0.35;
      if (g.createConicGradient) {
        const cg = g.createConicGradient(this.tm * 0.22, cx, cy);
        for (let k = 0; k <= 12; k++) cg.addColorStop(k / 12, RAINBOW[k % 6]);
        g.fillStyle = cg; g.fillRect(0, 0, W, H);
      } else {
        g.translate(cx, cy); g.rotate(this.tm * 0.22); const R = Math.hypot(W, H);
        for (let k = 0; k < 12; k++) { g.fillStyle = RAINBOW[k % 6]; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, k / 12 * 6.283, (k + 1) / 12 * 6.283); g.fill(); }
      }
      g.restore();
    }

    // 3. お星さま (またたく)
    for (const s of this.twinkles) {
      const k = 0.35 + 0.65 * Math.abs(Math.sin(this.tm * 1.6 + s.ph)), z = m * 0.022 * s.s * (0.6 + k) * (1 + pls * 0.4);
      g.globalAlpha = 0.5 + 0.5 * k * (0.7 + 0.3 * cf); g.drawImage(this.S.spark, s.x * W - z, s.y * H - z, z * 2, z * 2);
    }
    g.globalAlpha = 1;

    // 4. 虹 (レインボーモード)。サビで大きく濃く
    {
      const cx = L.cx, cy = H * 1.12, R = Math.min(W * 0.62, H * 1.0) * (1 + pls * 0.015 + cf * 0.06), bw = R * 0.05;
      g.save(); g.lineCap = 'butt'; g.lineWidth = bw + 1;
      RAINBOW.forEach((c, i) => { g.globalAlpha = 0.34 + 0.2 * cf + pls * 0.08; g.strokeStyle = c; g.beginPath(); g.arc(cx, cy, R - i * bw, Math.PI * 1.06, Math.PI * 1.94); g.stroke(); });
      g.restore();
    }

    // 5. 遠い雲・流れ星
    this.drawClouds(g, W, H, 0, pls);
    for (const s of this.shooters) {
      s.age += dt; const k = s.age / 1.2;
      if (k >= 1) continue;
      const x = (s.x - k * 0.5) * W, y = (s.y + k * 0.4) * H, len = m * 0.34;
      g.save(); g.globalAlpha = (1 - k) * 0.95; g.lineCap = 'round';
      const tr = g.createLinearGradient(x, y, x + len * 0.7, y - len * 0.56); tr.addColorStop(0, RAINBOW[s.c]); tr.addColorStop(1, 'rgba(255,255,255,0)');
      g.strokeStyle = tr; g.lineWidth = m * 0.014; g.beginPath(); g.moveTo(x, y); g.lineTo(x + len * 0.7, y - len * 0.56); g.stroke();
      const z = m * 0.04; g.drawImage(this.S.star[s.c], x - z, y - z, z * 2, z * 2); g.restore();
    }
    this.shooters = this.shooters.filter((s) => s.age < 1.2);

    // 6. アンテナ (電波を受信ちゅう)
    this.drawAntenna(g, W, H, L, m, pls, cf, dt);

    // 7. 中くらいの雲・キャンディ
    this.drawClouds(g, W, H, 1, pls);
    for (const c of this.candies) {
      const y = ((c.y - this.tm * c.sp) % 1 + 1) % 1, x = c.x + Math.sin(this.tm * 0.7 + c.ph) * 0.03, z = c.size * m * (1 + pls * 0.14);
      const im = c.k === 0 ? this.S.lolli[c.c] : c.k === 1 ? this.S.wrap[c.c] : c.k === 2 ? this.S.heart[c.c] : this.S.star[c.c];
      const ar = im.height / im.width;
      g.save(); g.globalAlpha = 0.92; g.translate(x * W, y * H); g.rotate(c.rot + Math.sin(this.tm * 0.9 + c.ph) * 0.25);
      g.drawImage(im, -z, -z * ar, z * 2, z * 2 * ar); g.restore();
    }

    // 8. 近い雲 (下のほう。アンテナの根もとをかくす)
    this.drawClouds(g, W, H, 2, pls);

    // 9. ことばのふきだし (ぴぴぴ！ など)
    this.drawBubbles(g, dt, m);
    // 10. ドキドキメーター (コンボで振り切れる)
    this.drawMeter(g, W, H, L, m, pls, combo, mode, dt);
  }

  drawClouds(g, W, H, layer, pls) {
    for (const c of this.clouds) {
      if (c.layer !== layer) continue;
      const w = c.w * W, im = (c.face ? this.S.cloudFace : this.S.cloud)[c.c], h = w * im.height / im.width;
      const x = (((c.x + this.tm * c.sp / W) % 1.4) + 1.4) % 1.4 - 0.3, y = c.y * H + Math.sin(this.tm * 0.8 + c.x * 9) * H * 0.006 - pls * H * 0.004 * (layer + 1);
      g.globalAlpha = [0.78, 0.9, 0.96][layer]; g.drawImage(im, x * W, y, w, h);
    }
    g.globalAlpha = 1;
  }

  // ハート玉つきのアンテナ。拍ごとに電波の輪が広がる
  drawAntenna(g, W, H, L, m, pls, cf, dt) {
    const right = W - (L.cx + L.wJ / 2);
    const ax = L.port ? W * 0.86 : L.cx + L.wJ / 2 + right * 0.5, base = H * 1.0, top = L.port ? H * 0.3 : H * 0.34, s = m * (L.port ? 0.6 : 1) / 720;
    const tx = ax, ty = top;
    // 電波の輪 (左右に広がる円弧)
    this.rings = this.rings.filter((r) => (r.age += dt) < 1.6);
    g.save(); g.lineCap = 'round';
    for (const r of this.rings) {
      const k = r.age / 1.6, rad = (30 + k * 190) * s * (L.port ? 1.0 : 1.15);
      g.strokeStyle = RAINBOW[r.c]; g.lineWidth = Math.max(3, 9 * s * (1 - k * 0.5));
      for (const sx of [-1, 1]) { g.globalAlpha = (1 - k) * (sx > 0 ? 0.85 : 0.4); g.beginPath(); g.arc(tx, ty, rad, sx > 0 ? -0.9 : Math.PI - 0.9 + 0.0, sx > 0 ? 0.9 : Math.PI + 0.9); g.stroke(); }
    }
    g.restore();
    // ポール・横棒 (キャンディ色)
    const pw = 12 * s * 1.5;
    g.save(); g.fillStyle = '#fff'; g.strokeStyle = '#f3a8d0'; g.lineWidth = 4 * s;
    g.beginPath(); g.roundRect ? g.roundRect(tx - pw / 2, ty, pw, base - ty, pw / 2) : g.rect(tx - pw / 2, ty, pw, base - ty); g.fill(); g.stroke();
    [[0.2, 120], [0.34, 90], [0.48, 62]].forEach(([f, w], i) => {
      const y = ty + (base - ty) * f * 0.7 + 30 * s, ww = Math.min(w * s * 1.4, Math.min(ax, W - ax) * 0.9);
      g.lineCap = 'round'; g.lineWidth = 9 * s * 1.2; g.strokeStyle = RAINBOW[(i * 2 + 1) % 6]; g.beginPath(); g.moveTo(tx - ww, y); g.lineTo(tx + ww, y); g.stroke();
      g.lineWidth = 3 * s; g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(tx - ww, y - 2 * s); g.lineTo(tx + ww, y - 2 * s); g.stroke();
    });
    g.restore();
    // 先っぽのハート玉 (拍で弾み、光る)
    const hz = (46 + pls * 12 + cf * 8) * s * 1.2;
    const gl = g.createRadialGradient(tx, ty, 0, tx, ty, hz * 3); gl.addColorStop(0, 'rgba(255,120,180,.55)'); gl.addColorStop(1, 'rgba(255,120,180,0)');
    g.fillStyle = gl; g.fillRect(tx - hz * 3, ty - hz * 3, hz * 6, hz * 6);
    g.drawImage(this.S.heart[0], tx - hz, ty - hz, hz * 2, hz * 2);
  }

  drawBubbles(g, dt, m) {
    const st = this.st, L = st.L, right = st.W - (L.cx + L.wJ / 2);
    if (L.port) return;   // 縦向きは、レーンの上に出てしまうので出さない
    const bx = L.port ? st.W * 0.7 : L.cx + L.wJ / 2 + right * 0.5, by = L.port ? st.H * 0.26 : st.H * 0.3;
    this.bubbles = this.bubbles.filter((b) => (b.age += dt) < 1.5);
    for (const b of this.bubbles) {
      const a = b.age, k = a < 0.25 ? easeOutBack(a / 0.25) : 1, alpha = a > 1.1 ? 1 - (a - 1.1) / 0.4 : 1, sz = m * 0.04 * k;
      const x = bx + b.dx - a * 24, y = Math.max(st.H * 0.2, by - 70 - a * 46);
      g.save(); g.globalAlpha = alpha; g.font = `800 ${Math.round(sz)}px "Hiragino Maru Gothic ProN","Yu Gothic UI","Meiryo",sans-serif`;
      const w = g.measureText(b.w).width + sz * 1.1, h = sz * 1.7;
      g.fillStyle = 'rgba(255,255,255,.92)'; g.strokeStyle = RAINBOW[b.c]; g.lineWidth = 4;
      g.beginPath(); g.roundRect ? g.roundRect(x - w / 2, y - h / 2, w, h, h / 2) : g.rect(x - w / 2, y - h / 2, w, h); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(x + w * 0.1, y + h / 2 - 1); g.lineTo(x + w * 0.28, y + h / 2 + sz * 0.6); g.lineTo(x + w * 0.22, y + h / 2 - 1); g.closePath(); g.fill();
      g.fillStyle = RAINBOW[b.c]; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(b.w, x, y + 1);
      g.restore();
    }
  }

  // ドキドキメーター: 虹色の半円。コンボでふえ、振り切れるとオーバーヒート (ふるえて、ハートがはずむ)
  drawMeter(g, W, H, L, m, pls, combo, mode, dt) {
    const left = L.cx - L.wJ / 2, r = Math.min(m * 0.12, left * 0.42);
    if (L.port || r < 38) return;
    const target = mode === 'play' ? clamp(combo / 50, 0, 1) : 0.5 + 0.45 * Math.sin(this.tm * 0.9);
    this.meter += (target - this.meter) * clamp(dt * 5, 0, 1);
    const v = this.meter, over = mode === 'play' && combo >= 50;
    const x = left * 0.5 + (over ? Math.sin(this.tm * 60) * 2 : 0), y = H * 0.34;
    g.save(); g.translate(x, y);
    g.fillStyle = 'rgba(255,255,255,.72)'; g.strokeStyle = '#ffb3da'; g.lineWidth = 4;
    g.beginPath(); g.arc(0, 0, r * 1.28, Math.PI, 0); g.lineTo(r * 1.28, r * 0.42); g.lineTo(-r * 1.28, r * 0.42); g.closePath(); g.fill(); g.stroke();
    const bw = r * 0.26;
    for (let i = 0; i < 6; i++) {
      const a0 = Math.PI + i * Math.PI / 6, a1 = a0 + Math.PI / 6 - 0.03;
      g.strokeStyle = RAINBOW[i]; g.globalAlpha = (i + 0.5) / 6 <= v + 0.001 ? 1 : 0.28; g.lineWidth = bw; g.beginPath(); g.arc(0, 0, r, a0, a1); g.stroke();
    }
    g.globalAlpha = 1;
    const ang = Math.PI + v * Math.PI;
    g.strokeStyle = '#7a5aa8'; g.lineWidth = Math.max(3, r * 0.06); g.lineCap = 'round'; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(ang) * r * 0.9, Math.sin(ang) * r * 0.9); g.stroke();
    const hz = r * (0.22 + (over ? pls * 0.1 : pls * 0.04));
    g.fillStyle = '#fff'; heartPath(g, 0, 0, hz * 1.2); g.fill(); g.fillStyle = over ? '#ff3d7a' : '#ff7eb6'; heartPath(g, 0, 0, hz); g.fill();
    g.restore();
    this.st.text(over ? 'オーバーヒート！' : 'ドキドキ', x, y + r * 0.62, Math.max(11, r * 0.24), { fill: over ? '#ff3d7a' : '#7a5aa8', stroke: '#fff', sw: 4 });
  }
}

export const SCENES = { pipipi: PipipiScene };
