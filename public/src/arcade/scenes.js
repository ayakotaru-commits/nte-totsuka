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
    this.dr = P.drift ?? this.tm;   // 雲・キャンディの流れの進み (サビで速くなる)
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
      const y = ((c.y - this.dr * c.sp) % 1 + 1) % 1, x = c.x + Math.sin(this.tm * 0.7 + c.ph) * 0.03, z = c.size * m * (1 + pls * 0.14);
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
      const x = (((c.x + this.dr * c.sp / W) % 1.4) + 1.4) % 1.4 - 0.3, y = c.y * H + Math.sin(this.tm * 0.8 + c.x * 9) * H * 0.006 - pls * H * 0.004 * (layer + 1);
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


// ---------- 場面の共通部分 ----------
//   時計 (tm)・区間の熱さ (cf: サビで 1 へ)・拍の弾み (pls) を揃え、拍が来たら onBeat を呼ぶ。
class SceneBase {
  constructor(stage, beatSec = 0.43) { this.st = stage; this.tm = 0; this.cf = 0; this.lastBeat = -9; this.idleBeat = -1; this.beatSec = beatSec; this.S = null; this.beatN = 0; }
  ensure() { if (!this.S) this.S = this.build(); }
  begin(P) {
    this.ensure();
    const { dt, pulse, key, bi, mode } = P, st = this.st;
    this.tm += dt; this.dr = P.drift ?? this.tm; this.key = key;
    const hot = key === 'chorus' || key === 'big' || key === 'chorus2' ? 1 : 0;
    this.cf += (hot - this.cf) * clamp(dt * 1.6, 0, 1);
    const beat = mode === 'play' && bi.i >= 0 ? bi.i : -1, ib = Math.floor(this.tm / this.beatSec);
    if (mode === 'play') { if (beat >= 0 && beat !== this.lastBeat) { this.lastBeat = beat; this.beatN = beat; this.onBeat(beat, key); } }
    else if (ib !== this.idleBeat) { this.idleBeat = ib; this.beatN = ib; this.onBeat(ib, 'A'); }
    this.pls = mode === 'play' ? pulse : Math.pow(0.5 + 0.5 * Math.sin(this.tm * Math.PI * 2 / this.beatSec), 3);
    return { g: P.g, W: st.W, H: st.H, L: st.L, m: Math.min(st.W, st.H), dt, cf: this.cf, pls: this.pls };
  }
  build() { return {}; }
  onBeat() {}
}
const grad3 = (g, H, a, b, c) => { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, a); gr.addColorStop(0.55, b); gr.addColorStop(1, c); return gr; };
const fract = (x) => x - Math.floor(x);
const hash = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);

// ---------- 「ミライミライ」: 夜明けの空と、未来へのびる光の道 ----------
//   題から。地平線に昇る光の輪 (サビで大きく・金色に)、未来の街のシルエット、手前へ流れる光の道、のぼる光のかけら。
export class MiraiScene extends SceneBase {
  constructor(stage) {
    super(stage, 0.35);
    const r = (a, b) => a + Math.random() * (b - a);
    this.towers = []; for (let x = -0.02, i = 0; x < 1.02; i++) { const w = r(0.025, 0.06); this.towers.push({ x, w, h: r(0.04, 0.2), ant: Math.random() < 0.3, dome: Math.random() < 0.2, seed: i }); x += w * r(0.7, 1.05); }
    this.bits = Array.from({ length: 30 }, () => ({ x: Math.random(), y: Math.random(), sp: r(0.02, 0.06), s: r(0.012, 0.03), ph: r(0, 6.28), k: Math.floor(r(0, 3)) }));
    this.stars = Array.from({ length: 50 }, () => ({ x: Math.random(), y: Math.random() * 0.5, s: r(0.4, 1), ph: r(0, 6.28) }));
    this.rings = []; this.shoot = [];
  }
  build() { return { spark: sparkleSprite() }; }
  onBeat(i, key) {
    if (i % 2 === 0) this.rings.push({ age: 0 });
    if (i % (key === 'chorus' ? 8 : 16) === 0) this.shoot.push({ age: 0, x: 0.3 + Math.random() * 0.6, y: 0.03 + Math.random() * 0.2 });
    if (this.rings.length > 8) this.rings.shift();
  }
  draw(P) {
    const { g, W, H, L, m, dt, cf, pls } = this.begin(P), hy = H * 0.6, cx = L.cx;
    const A = ['#26306e', '#6a56c8', '#ffb08a'].map(hex), B = ['#3a2486', '#ff6aae', '#ffe27a'].map(hex);
    g.fillStyle = grad3(g, hy, rgb(mixc(A[0], B[0], cf)), rgb(mixc(A[1], B[1], cf)), rgb(mixc(A[2], B[2], cf))); g.fillRect(0, 0, W, hy + 2);
    for (const s of this.stars) { const k = 0.4 + 0.6 * Math.abs(Math.sin(this.tm * 1.4 + s.ph)), z = m * 0.016 * s.s * (0.6 + k); g.globalAlpha = (0.9 - s.y) * k; g.drawImage(this.S.spark, s.x * W - z, s.y * H - z, z * 2, z * 2); }
    g.globalAlpha = 1;
    // 光の輪 (地平線から昇る)
    const R = m * (0.15 + 0.05 * cf + pls * 0.01), sy = hy - R * 0.1;
    const gl = g.createRadialGradient(cx, sy, R * 0.2, cx, sy, R * 3.2); gl.addColorStop(0, `rgba(255,236,170,${0.55 + 0.2 * cf})`); gl.addColorStop(1, 'rgba(255,200,150,0)');
    g.fillStyle = gl; g.fillRect(0, 0, W, hy + 2);
    g.save(); g.beginPath(); g.rect(0, 0, W, hy); g.clip();
    this.rings = this.rings.filter((r) => (r.age += dt) < 2.2);
    for (const r of this.rings) { const k = r.age / 2.2; g.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`; g.lineWidth = Math.max(2, m * 0.01 * (1 - k)); g.beginPath(); g.arc(cx, sy, R * (1.05 + k * 2.4), 0, 7); g.stroke(); }
    g.fillStyle = '#fff6d6'; g.beginPath(); g.arc(cx, sy, R, 0, 7); g.fill();
    g.fillStyle = cf > 0.5 ? '#ffd45e' : '#ffe9a8'; g.beginPath(); g.arc(cx, sy, R * 0.86, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = Math.max(3, R * 0.07); g.beginPath(); g.arc(cx, sy, R * 1.12, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    g.restore();
    // 流れ星
    this.shoot = this.shoot.filter((s) => (s.age += dt) < 1.1);
    for (const s of this.shoot) { const k = s.age / 1.1, x = (s.x - k * 0.45) * W, y = (s.y + k * 0.3) * H, len = m * 0.3; g.save(); g.globalAlpha = 1 - k; g.lineCap = 'round'; g.strokeStyle = '#fff'; g.lineWidth = m * 0.008; g.beginPath(); g.moveTo(x, y); g.lineTo(x + len * 0.8, y - len * 0.45); g.stroke(); g.restore(); }
    // 未来の街 (遠くは淡く、手前は濃く)
    for (const layer of [0, 1]) {
      g.fillStyle = layer ? '#2b2670' : '#8a74d0'; g.globalAlpha = layer ? 1 : 0.6;
      for (const t of this.towers) {
        const o = layer ? 0 : 0.5 * t.w, x = (t.x + o) * W, w = t.w * W * (layer ? 1 : 1.2), h = t.h * H * (layer ? 1 : 0.7);
        g.fillRect(x, hy - h, w, h + 2);
        if (t.dome) { g.beginPath(); g.arc(x + w / 2, hy - h, w / 2, Math.PI, 0); g.fill(); }
        if (t.ant && layer) { g.fillRect(x + w / 2 - 1.5, hy - h - H * 0.04, 3, H * 0.04); }
        if (layer) { for (let k = 0; k < 6; k++) { const wy = hy - h + (k + 0.5) * h / 6.5, on = hash(t.seed * 7 + k + Math.floor(this.tm * 0.4)) < 0.35 + 0.3 * cf; if (on) { g.fillStyle = `rgba(255,236,160,${0.5 + 0.3 * pls})`; g.fillRect(x + w * 0.25, wy, w * 0.5, Math.max(2, h * 0.04)); g.fillStyle = '#2b2670'; } } }
      }
    }
    g.globalAlpha = 1;
    // 光の道 (消失点は光の輪のところ)
    g.fillStyle = '#1f1b57'; g.fillRect(0, hy, W, H - hy);
    const gl2 = g.createLinearGradient(0, hy, 0, H); gl2.addColorStop(0, `rgba(255,214,150,${0.5 + 0.3 * cf})`); gl2.addColorStop(1, 'rgba(255,214,150,0)'); g.fillStyle = gl2; g.fillRect(0, hy, W, H - hy);
    g.lineWidth = 2; g.strokeStyle = `rgba(160,230,255,${0.5 + 0.3 * pls})`;
    for (let i = -10; i <= 10; i++) { g.beginPath(); g.moveTo(cx + i * W * 0.012, hy); g.lineTo(cx + i * W * 0.22, H); g.stroke(); }
    for (let i = 0; i < 9; i++) { const k = fract(i / 9 + this.dr * 0.12), y = hy + (H - hy) * k * k; g.globalAlpha = 0.25 + 0.6 * k; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.globalAlpha = 1;
    // のぼる光のかけら (ひし形・星)
    for (const b of this.bits) {
      const y = ((b.y - this.dr * b.sp) % 1 + 1) % 1, x = b.x + Math.sin(this.tm * 0.8 + b.ph) * 0.02, z = b.s * m * (1 + pls * 0.25);
      g.save(); g.translate(x * W, y * H); g.rotate(this.tm * 0.5 + b.ph); g.globalAlpha = 0.5 + 0.4 * (1 - y);
      g.fillStyle = ['#aef0ff', '#fff2a8', '#ffc4ea'][b.k];
      if (b.k === 2) { starPath(g, 0, 0, z, z * 0.45, 4, 0); g.fill(); } else { g.beginPath(); g.moveTo(0, -z); g.lineTo(z * 0.7, 0); g.lineTo(0, z); g.lineTo(-z * 0.7, 0); g.closePath(); g.fill(); }
      g.restore();
    }
  }
}

// ---------- 「おかえり、ただいま」: 夕焼けの帰り道、明かりのともる家 ----------
//   題から。低い夕日 (サビで金色の光の筋)、家並みのシルエットで窓の明かりがともる (サビでほとんど全部)、カラスの群れ、ただよう灯りの粒。
export class OkaeriScene extends SceneBase {
  constructor(stage) {
    super(stage, 0.42);
    const r = (a, b) => a + Math.random() * (b - a);
    this.rows = [0, 1].map((layer) => { const a = []; for (let x = -0.03, i = 0; x < 1.03; i++) { const w = r(0.05, 0.1) * (layer ? 1.1 : 0.9); a.push({ x, w, h: r(0.06, 0.13) * (layer ? 1.15 : 0.8), roof: r(0.025, 0.05), chim: Math.random() < 0.3, seed: i + layer * 100, wins: Math.floor(r(1, 4)) }); x += w * r(0.95, 1.2); } return a; });
    this.birds = Array.from({ length: 6 }, (_, i) => ({ x: r(0, 1), y: 0.14 + r(0, 0.22), sp: r(0.02, 0.035), ph: r(0, 6), s: r(0.012, 0.022) }));
    this.clouds = Array.from({ length: 6 }, (_, i) => ({ x: r(0, 1), y: 0.1 + r(0, 0.3), w: r(0.2, 0.4), sp: r(4, 9), c: i % 3 }));
    this.motes = Array.from({ length: 26 }, () => ({ x: Math.random(), y: Math.random(), sp: r(0.015, 0.04), s: r(0.4, 1), ph: r(0, 6.28) }));
  }
  build() { return { spark: sparkleSprite(), cloud: ['#ffc8a8', '#ffb0b8', '#f3b8e0'].map((c) => cloudSprite(c, false)) }; }
  draw(P) {
    const { g, W, H, L, m, cf, pls } = this.begin(P), hy = H * 0.64;
    const A = ['#6a62c0', '#ff9a8c', '#ffd08a'].map(hex), B = ['#ff9a6a', '#ffcf86', '#fff2b8'].map(hex);
    g.fillStyle = grad3(g, hy, rgb(mixc(A[0], B[0], cf)), rgb(mixc(A[1], B[1], cf)), rgb(mixc(A[2], B[2], cf))); g.fillRect(0, 0, W, H);
    // 夕日
    const sx = W * 0.5, R = m * 0.13 * (1 + pls * 0.015 + cf * 0.1), sy = hy - R * 0.45;
    if (cf > 0.02) { g.save(); g.globalAlpha = 0.22 * cf; g.translate(sx, sy); g.rotate(this.tm * 0.05); for (let k = 0; k < 14; k++) { g.fillStyle = '#fff2b0'; g.beginPath(); g.moveTo(0, 0); const a = k / 14 * 6.283; g.arc(0, 0, Math.hypot(W, H), a, a + 0.18); g.fill(); } g.restore(); }
    const gl = g.createRadialGradient(sx, sy, R * 0.3, sx, sy, R * 3.4); gl.addColorStop(0, 'rgba(255,230,170,.7)'); gl.addColorStop(1, 'rgba(255,190,140,0)'); g.fillStyle = gl; g.fillRect(0, 0, W, hy + 4);
    g.fillStyle = '#fff2c4'; g.beginPath(); g.arc(sx, sy, R, 0, 7); g.fill(); g.fillStyle = '#ffd98a'; g.beginPath(); g.arc(sx, sy, R * 0.84, 0, 7); g.fill();
    // 雲 (ゆっくり)
    for (const c of this.clouds) { const w = c.w * W, im = this.S.cloud[c.c], x = (((c.x + this.dr * c.sp / W) % 1.4) + 1.4) % 1.4 - 0.3; g.globalAlpha = 0.8; g.drawImage(im, x * W, c.y * H, w, w * im.height / im.width); }
    g.globalAlpha = 1;
    // カラス
    for (const b of this.birds) {
      const x = (((b.x + this.dr * b.sp) % 1.2) + 1.2) % 1.2 - 0.1, y = (b.y + Math.sin(this.tm * 0.6 + b.ph) * 0.015) * H, z = b.s * m, f = Math.sin(this.tm * 7 + b.ph) * z * 0.55;
      g.strokeStyle = '#5a3a66'; g.lineWidth = Math.max(2, z * 0.18); g.lineCap = 'round'; g.beginPath(); g.moveTo(x * W - z, y - f); g.quadraticCurveTo(x * W - z * 0.4, y - z * 0.2, x * W, y); g.quadraticCurveTo(x * W + z * 0.4, y - z * 0.2, x * W + z, y - f); g.stroke();
    }
    // 家並み (遠い・近い)
    for (const layer of [0, 1]) {
      const base = hy + (layer ? H * 0.12 : H * 0.03), col = layer ? '#4a2f66' : '#9a6c9c';
      g.fillStyle = layer ? '#4a2f66' : '#a77aa6'; g.fillRect(0, base - 2, W, H - base + 2);
      for (const hse of this.rows[layer]) {
        const x = hse.x * W, w = hse.w * W, h = hse.h * H, rf = hse.roof * H;
        g.fillStyle = col; g.fillRect(x, base - h, w, h + 2);
        g.beginPath(); g.moveTo(x - w * 0.06, base - h); g.lineTo(x + w / 2, base - h - rf); g.lineTo(x + w * 1.06, base - h); g.closePath(); g.fill();
        if (hse.chim) g.fillRect(x + w * 0.7, base - h - rf * 1.05, w * 0.1, rf * 0.7);
        if (layer) for (let k = 0; k < hse.wins; k++) {
          const wx = x + w * (0.18 + (0.64 / hse.wins) * k), ww = w * 0.64 / hse.wins * 0.6, wy = base - h * 0.7, wh = h * 0.35;
          const lit = hash(hse.seed * 13 + k) < 0.3 + 0.65 * cf + 0.05 * Math.sin(this.tm * 0.5 + hse.seed);
          if (lit) { const a = 0.78 + 0.22 * pls; g.fillStyle = `rgba(255,222,140,${a})`; g.fillRect(wx, wy, ww, wh); const gg = g.createRadialGradient(wx + ww / 2, wy + wh / 2, 0, wx + ww / 2, wy + wh / 2, ww * 1.6); gg.addColorStop(0, `rgba(255,214,120,${0.35 * a})`); gg.addColorStop(1, 'rgba(255,214,120,0)'); g.fillStyle = gg; g.fillRect(wx - ww * 1.6, wy - ww * 1.2, ww * 4.2, ww * 3.6); }
          else { g.fillStyle = 'rgba(30,20,50,.5)'; g.fillRect(wx, wy, ww, wh); }
        }
      }
    }
    // ただよう灯りの粒
    for (const p of this.motes) {
      const y = ((p.y - this.dr * p.sp) % 1 + 1) % 1, x = p.x + Math.sin(this.tm * 0.5 + p.ph) * 0.03, z = m * 0.02 * p.s * (1 + pls * 0.3) * (0.6 + 0.4 * Math.sin(this.tm * 2 + p.ph));
      g.globalAlpha = 0.55 + 0.3 * cf; g.drawImage(this.S.spark, x * W - z, y * H - z, z * 2, z * 2);
    }
    g.globalAlpha = 1;
  }
}

// ---------- 「soap bubbles」: シャボン玉がのぼる水色の空 ----------
//   題から。虹色にきらめくシャボン玉が (横にゆれながら) のぼり、拍に合わせてぱちんと割れて きらきら。サビはシャボン玉がふえて光の筋がさす。
function bubbleSprite(h0) {
  const S = 240, c = mk(S, S), g = c.getContext('2d'), r = S / 2 - 6;
  const f = g.createRadialGradient(S / 2, S / 2, r * 0.55, S / 2, S / 2, r); f.addColorStop(0, 'rgba(255,255,255,0)'); f.addColorStop(0.8, 'rgba(255,255,255,.12)'); f.addColorStop(1, 'rgba(255,255,255,.32)');
  g.fillStyle = f; g.beginPath(); g.arc(S / 2, S / 2, r, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,.12)'; g.fill();
  const rim = g.createLinearGradient(0, 0, S, S); [0, 0.25, 0.5, 0.75, 1].forEach((p, i) => rim.addColorStop(p, `hsla(${(h0 + i * 70) % 360},95%,78%,.9)`));
  g.strokeStyle = rim; g.lineWidth = 10; g.beginPath(); g.arc(S / 2, S / 2, r, 0, 7); g.stroke();
  g.save(); g.beginPath(); g.arc(S / 2, S / 2, r - 3, 0, 7); g.clip(); g.lineWidth = 16; g.strokeStyle = `hsla(${(h0 + 200) % 360},95%,80%,.28)`; g.beginPath(); g.arc(S / 2 + 18, S / 2 + 18, r - 8, Math.PI * 0.1, Math.PI * 0.6); g.stroke(); g.restore();
  g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.ellipse(S * 0.32, S * 0.28, 22, 11, -0.7, 0, 7); g.fill();
  g.beginPath(); g.arc(S * 0.7, S * 0.72, 5, 0, 7); g.fill();
  return c;
}
export class SoapScene extends SceneBase {
  constructor(stage) {
    super(stage, 0.42);
    const r = (a, b) => a + Math.random() * (b - a);
    this.bub = Array.from({ length: 26 }, (_, i) => this.newBubble(i / 26, r));
    this.pops = []; this.rays = Array.from({ length: 5 }, (_, i) => ({ x: (i + 0.5) / 5 + r(-0.05, 0.05), w: r(0.05, 0.12), ph: r(0, 6.28) }));
    this.foam = Array.from({ length: 22 }, () => ({ x: Math.random(), r: r(0.015, 0.045), y: Math.random() }));
  }
  newBubble(y, r = (a, b) => a + Math.random() * (b - a)) { return { x: Math.random(), y, sp: r(0.03, 0.075), s: r(0.035, 0.14), ph: r(0, 6.28), h: Math.floor(r(0, 3)) }; }
  build() { return { bub: [0, 120, 240].map(bubbleSprite), spark: sparkleSprite() }; }
  onBeat(i, key) {
    if (i % (key === 'chorus' ? 1 : 2) === 0) {
      let b = this.bub[Math.floor(Math.random() * this.bub.length)]; if (b.y > 0.9) b = this.bub[(this.bub.indexOf(b) + 1) % this.bub.length];
      const m = Math.min(this.st.W, this.st.H);
      this.pops.push({ age: 0, x: b.x * this.st.W, y: b.y * this.st.H, r: b.s * m, h: b.h });
      b.y = 1.1; b.x = Math.random();
    }
    if (this.pops.length > 10) this.pops.shift();
  }
  draw(P) {
    const { g, W, H, m, dt, cf, pls } = this.begin(P);
    const A = ['#8fd8ff', '#b9c4ff', '#ffc4e6'].map(hex), B = ['#6cc8ff', '#c0a8ff', '#ffb0dc'].map(hex);
    g.fillStyle = grad3(g, H, rgb(mixc(A[0], B[0], cf)), rgb(mixc(A[1], B[1], cf)), rgb(mixc(A[2], B[2], cf))); g.fillRect(0, 0, W, H);
    // 光の筋 (水のなかのように、ゆらゆら)
    g.save();
    for (const r of this.rays) { const x = r.x * W + Math.sin(this.tm * 0.3 + r.ph) * W * 0.04, w = r.w * W * (1 + cf * 0.5); const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, `rgba(255,255,255,${0.16 + 0.1 * cf})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(x - w * 0.3, 0); g.lineTo(x + w * 0.3, 0); g.lineTo(x + w * 1.4, H); g.lineTo(x - w * 1.4, H); g.closePath(); g.fill(); }
    g.restore();
    // きらきら
    for (let i = 0; i < 30; i++) { const x = hash(i) * W, y = hash(i + 50) * H * 0.9, k = 0.3 + 0.7 * Math.abs(Math.sin(this.tm * 1.3 + i)), z = m * 0.014 * (0.6 + k); g.globalAlpha = 0.6 * k; g.drawImage(this.S.spark, x - z, y - z, z * 2, z * 2); }
    g.globalAlpha = 1;
    // シャボン玉 (大きいものほど手前でゆっくり)
    const n = Math.round(14 + 12 * cf);
    for (let i = 0; i < n; i++) {
      const b = this.bub[i]; b.y -= b.sp * (0.3 + 0.7 * (P.rush != null ? 1 + P.rush : 1)) * dt * (1 + cf * 0.4);
      if (b.y < -0.2) { b.y = 1.15; b.x = Math.random(); }
      const x = (b.x + Math.sin(this.tm * 0.9 + b.ph) * 0.03) * W, z = b.s * m * (1 + pls * 0.05), wob = 1 + 0.04 * Math.sin(this.tm * 3 + b.ph);
      g.globalAlpha = Math.min(1, 0.8 + b.s * 2); g.drawImage(this.S.bub[b.h], x - z * wob, b.y * H - z / wob, z * 2 * wob, z * 2 / wob);
    }
    g.globalAlpha = 1;
    // ぱちんと割れる
    this.pops = this.pops.filter((p) => (p.age += dt) < 0.6);
    for (const p of this.pops) {
      const k = p.age / 0.6; g.save(); g.globalAlpha = 1 - k; g.strokeStyle = `hsl(${p.h * 120 + 190},90%,80%)`; g.lineWidth = Math.max(2, p.r * 0.12 * (1 - k)); g.beginPath(); g.arc(p.x, p.y, p.r * (1 + k * 0.5), 0, 7); g.stroke();
      for (let d = 0; d < 8; d++) { const a = d / 8 * 6.283 + p.h, rr = p.r * (1 + k * 1.1), z = m * 0.012 * (1 - k * 0.6) + 2; g.fillStyle = '#fff'; g.beginPath(); g.arc(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr, z, 0, 7); g.fill(); }
      const z = p.r * 0.5 * (1 - k); g.drawImage(this.S.spark, p.x - z, p.y - z, z * 2, z * 2); g.restore();
    }
    // あわあわ (下のほう)
    for (const f of this.foam) { const x = f.x * W, y = H - f.y * H * 0.06, z = f.r * m * (1 + pls * 0.04); g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(x, y, z, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(x - z * 0.3, y - z * 0.3, z * 0.3, 0, 7); g.fill(); }
  }
}

// ---------- 自作のインスト曲 (ハイテンポ・ポップ): ネオンの夜、夕日のグリッドと イコライザー ----------
//   拍でイコライザーの棒がはね、地面のグリッドが手前へ流れる (サビは速く)。ネオンの太陽は しま状に切れる。
export class NeonScene extends SceneBase {
  constructor(stage) {
    super(stage, 0.35);
    this.stars = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random() * 0.5, s: Math.random(), ph: Math.random() * 6.28 }));
    this.bars = new Array(56).fill(0); this.notes = [];
  }
  build() { return { spark: sparkleSprite() }; }
  onBeat(i) { for (let k = 0; k < this.bars.length; k++) this.bars[k] = Math.max(this.bars[k], 0.35 + 0.65 * hash(i * 3.1 + k * 1.7)); if (i % 4 === 0) this.notes.push({ age: 0, x: 0.1 + Math.random() * 0.8, c: Math.floor(Math.random() * 3) }); if (this.notes.length > 6) this.notes.shift(); }
  draw(P) {
    const { g, W, H, L, m, dt, cf, pls } = this.begin(P), hy = H * 0.58, cx = L.cx;
    const A = ['#160d3c', '#3a1a74', '#ff4fa3'].map(hex), B = ['#240a50', '#7a1fae', '#ffb02e'].map(hex);
    g.fillStyle = grad3(g, hy, rgb(mixc(A[0], B[0], cf)), rgb(mixc(A[1], B[1], cf)), rgb(mixc(A[2], B[2], cf))); g.fillRect(0, 0, W, hy + 2);
    for (const s of this.stars) { const k = 0.4 + 0.6 * Math.abs(Math.sin(this.tm * 2 + s.ph)), z = m * 0.012 * (0.5 + s.s) * (0.6 + k); g.globalAlpha = 0.9 * k * (1 - s.y); g.drawImage(this.S.spark, s.x * W - z, s.y * H - z, z * 2, z * 2); }
    g.globalAlpha = 1;
    // ネオンの太陽 (下半分はしまに切れる)
    const R = m * 0.2 * (1 + pls * 0.02 + cf * 0.08), sy = hy - R * 0.55;
    g.save(); g.beginPath(); g.arc(cx, sy, R, 0, 7); g.clip();
    const sg = g.createLinearGradient(0, sy - R, 0, sy + R); sg.addColorStop(0, '#fff06a'); sg.addColorStop(0.55, '#ff8fb8'); sg.addColorStop(1, '#ff3fa0'); g.fillStyle = sg; g.fillRect(cx - R, sy - R, R * 2, R * 2);
    g.fillStyle = 'rgba(30,12,70,1)'; for (let k = 0; k < 6; k++) { const y = sy + R * (0.05 + k * 0.17), h = R * (0.02 + k * 0.018); g.fillRect(cx - R, y, R * 2, h); }
    g.restore();
    const gl = g.createRadialGradient(cx, sy, R, cx, sy, R * 2.4); gl.addColorStop(0, 'rgba(255,120,190,.4)'); gl.addColorStop(1, 'rgba(255,120,190,0)'); g.fillStyle = gl; g.fillRect(0, 0, W, hy);
    // イコライザー (地平線に沿って)
    const nb = this.bars.length, bw = W / nb;
    for (let k = 0; k < nb; k++) {
      this.bars[k] = Math.max(0.05, this.bars[k] - dt * 1.6); const v = this.bars[k] * (0.5 + 0.5 * Math.abs(Math.sin(k * 0.7 + this.tm * 2.4))) + 0.04, h = v * H * 0.22;
      const c = k / nb; g.fillStyle = `hsl(${180 + c * 140},100%,${62 + 8 * pls}%)`; g.fillRect(k * bw + bw * 0.12, hy - h, bw * 0.76, h);
    }
    // 地面 (グリッドが手前へ流れる)
    g.fillStyle = '#1a0b42'; g.fillRect(0, hy, W, H - hy);
    const gg = g.createLinearGradient(0, hy, 0, H); gg.addColorStop(0, 'rgba(255,79,163,.5)'); gg.addColorStop(0.3, 'rgba(255,79,163,0)'); g.fillStyle = gg; g.fillRect(0, hy, W, H - hy);
    const line = (x0, y0, x1, y1, a) => { g.strokeStyle = `rgba(255,70,190,${0.25 * a})`; g.lineWidth = 6; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.strokeStyle = `rgba(110,240,255,${a})`; g.lineWidth = 2; g.stroke(); };
    for (let i = -14; i <= 14; i++) line(cx + i * W * 0.01, hy, cx + i * W * 0.2, H, 0.7);
    for (let i = 0; i < 10; i++) { const k = fract(i / 10 + this.dr * (0.2 + 0.2 * cf)), y = hy + (H - hy) * k * k; line(0, y, W, y, 0.25 + 0.6 * k); }
    // ネオンの音符 (ふわっと浮かんで消える)
    this.notes = this.notes.filter((n) => (n.age += dt) < 2);
    for (const n of this.notes) { const k = n.age / 2, x = n.x * W, y = hy - H * 0.1 - k * H * 0.3, sz = m * 0.05; g.save(); g.globalAlpha = Math.sin(k * Math.PI); g.fillStyle = ['#6ef0ff', '#ff6ec8', '#fff06a'][n.c]; g.shadowColor = g.fillStyle; g.shadowBlur = 14; g.beginPath(); g.ellipse(x, y, sz * 0.4, sz * 0.3, -0.4, 0, 7); g.fill(); g.fillRect(x + sz * 0.3, y - sz * 1.1, sz * 0.1, sz * 1.1); g.restore(); }
  }
}

export const SCENES = { pipipi: PipipiScene, miraimirai: MiraiScene, okaeri: OkaeriScene, soap: SoapScene, pop1: NeonScene };
