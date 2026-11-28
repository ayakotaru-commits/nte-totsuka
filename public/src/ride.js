// 電車に乗る (段階 1: 戸塚駅、段階 2: 東戸塚駅・保土ケ谷駅まで。線路の延長は rail_ext.json → railext.js・detail/trains.js)。
// - 駅の自由通路の、ホームへの階段の上 (改札) で F →「ホームへ降りる」。ホームの階段の下で F →「改札へ上がる」(階段は見た目だけなので、暗転して移す)
// - ホームで、止まっている旅客線 (東海道線・横須賀線) の横で F →「乗る」。乗っている間はキャラを隠し、カメラは電車を外から追う (Q で車内の視点)
// - 止まっている間は F で降りる (戸塚・東戸塚)。道筋の終わり (範囲の端) に着いたら、暗転して最後に通った駅 (無ければ乗った駅) のホームへ戻る
// - 延ばした先の駅 (東戸塚など。rail_ext.json の stations) はホームの上だけ (改札・駅舎は無い)。ホームが 2 面以上の駅 (横浜) は、
//   ホームの中央の「のりかえ」の案内板の前で F / Q → 同じ駅のほかのホームへ (暗転して移す)
// 電車の時刻と位置は detail/trains.js の api (実際の時計で決まる。だれが見ても同じ所を走る) から取る。
// 確認用: window.__ride (状態)、window.__trains.skew (時計をずらす秒)
import * as THREE from 'three';
import { siteSpot, siteSpotSouth } from './detail/stationsite.js';

const REACH_GATE = 2.2;   // 改札・階段の下で操作できる距離 (m)
const REACH_XFER = 2.5;   // 延ばした先の駅の「のりかえ」の案内板の前で操作できる距離 (m)
const REACH_CAR = 3.9;    // 電車の中心線からこの距離以内で乗れる (ホームの縁から約 2 m)
const RIDE_DIST = 16;     // 乗っている間のカメラの距離 (m)
const EYE = 2.65;         // 車内の視点の高さ (レールの上面から)
const LINE_NAME = { tokaido: '東海道線', yokosuka: '横須賀線' };
const DIR_NAME = { north: '上り 横浜・東京方面', south: '下り 大船方面' };
// 線の名前・行き先・色の札 (新しい線 = rail_ext の lines は、名前・行き先・帯の色を道筋 r が持つ)
const lineName = (r) => LINE_NAME[r.line] || r.L.name || r.line;
const dirName = (r) => r.dirName || DIR_NAME[r.dir] || '';
const lineTag = (r) => `<span class="tl ${r.line}"${LINE_NAME[r.line] ? '' : ` style="background:${r.L.band ? r.L.band[0] : '#666'}"`}>${lineName(r)}</span>`;

const inRing = (x, z, ring) => {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
};
const mmss = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

export class Ride {
  constructor({ trains, props, world, player, cam, camera, bridges, scene, ext }) {
    this.api = trains; this.world = world; this.player = player; this.cam = cam; this.camera = camera; this.scene = scene;
    this.riding = null;     // { r, k, view, dist, from: {x, y, z, face} }
    this.busy = false;      // 暗転中
    this.disabled = !trains || !props || !props.rail;
    window.__ride = this;
    if (this.disabled) return;
    if (trains) window.__trains = trains;
    const rail = props.rail;

    // ホーム: 輪郭 (左の縁 → 右の縁を逆に) と、縁の点ごとの高さ。ホームの横に止まる道筋
    // routes: [{ r (道筋), si (r.stops の何番目の駅か) }]
    // sub = 新しい線の駅のホーム (京葉線の東京など) の線の名前。同じ名前の駅 (東京) でも、地図の印は別にする
    const mkPlat = (pf, name, sub = '') => ({ ring: [...pf.left, ...pf.right.slice().reverse()], pf, name, sub, routes: [] });
    this.plats = rail.platforms.map((pf) => mkPlat(pf, '戸塚'));
    this.nHome = this.plats.length;   // 戸塚のホームの数 (この後ろが延ばした先の駅)
    for (const st of (ext && ext.stations) || []) for (const pf of st.platforms || [st.platform]) this.plats.push(mkPlat(pf, st.name, st.lineName || ''));   // 駅ごとに複数のホーム (横浜など)
    // 駅舎と駅前のある駅 (舞浜) の、北口の広場のワープ先 (stationSpots)
    this.siteSpots = ((ext && ext.stations) || []).filter((st) => st.site).flatMap((st) => [
      { name: st.name, label: `${st.name}駅（北口）`, ...siteSpot(st) },
      ...(st.site.south ? [{ name: st.name, label: `${st.name}駅（南口）`, ...siteSpotSouth(st) }] : []),
    ]);
    // 地下の駅から地上へ出る所 (設定の exits。九段下の 2 番出口・日本武道館の前など) のワープ先
    this.exitSpots = ((ext && ext.stations) || []).flatMap((st) => (st.exits || []).map((e) => ({ name: st.name, label: e.label, x: e.x, y: e.y, z: e.z, face: e.face })));
    const P = new THREE.Vector3();
    for (const r of trains.R) {
      r.stops.forEach((st, si) => {
        trains.pointAt(r, st.s - r.L.cars * trains.CAR / 2, P);
        let best = null, bd = 14;
        for (const pl of this.plats) {
          const pf = pl.pf, m = pf.left.length >> 1;
          const d = Math.hypot((pf.left[m][0] + pf.right[m][0]) / 2 - P.x, (pf.left[m][1] + pf.right[m][1]) / 2 - P.z);
          if (d < bd) { bd = d; best = pl; }
        }
        if (best) best.routes.push({ r, si });
      });
    }

    // 改札 (自由通路の上) と、ホームの階段の下。階段の上は駅舎 (建物) の中で歩いては入れないので、
    // 階段の上からいちばん近い、通路の上で立てる所 (= 自由通路が駅舎に入る所) を改札にする。近い改札はまとめる (1 つの改札から両方のホームへ)
    const freeAt = (x, z, y) => {
      const d = bridges && bridges.deckAt(x, z, 0.3);
      if (!d || Math.abs(d.y - y) > 2.5) return null;
      const yy = d.y + 0.05;
      return world.bodyBlocked(x, z, yy) ? null : { x, z, y: yy };
    };
    this.gates = [];   // { top, downs: [{ bottom, ux, uz, plat }] }
    this.stairs = [];  // ホームの階段の下: { bottom, gate }
    for (const st of rail.stairs || []) {
      const ux = Math.sin(st.yaw), uz = Math.cos(st.yaw);
      const tx = st.x + ux * st.len, tz = st.z + uz * st.len;
      let top = null;
      for (let r = 0; r <= 30 && !top; r += 0.5) {
        for (let a = 0; a < 32 && !top; a++) {
          const ang = a / 32 * Math.PI * 2;
          top = freeAt(tx + Math.cos(ang) * r, tz + Math.sin(ang) * r, st.y1);
          if (r === 0) break;
        }
      }
      if (!top) continue;
      const q = { ...top };   // 壁ぎわなら少し離す
      world.resolve(q, 0.5);
      if (freeAt(q.x, q.z, top.y)) Object.assign(top, freeAt(q.x, q.z, top.y));
      const bx = st.x - ux * 1.6, bz = st.z - uz * 1.6;
      const down = { bottom: { x: bx, z: bz, y: st.y0 }, ux, uz, plat: this.platAt(bx, bz) };
      let g = this.gates.find((g) => Math.hypot(g.top.x - top.x, g.top.z - top.z) < 4);
      if (!g) this.gates.push(g = { top, downs: [] });
      g.downs.push(down);
      this.stairs.push({ ...down, gate: g });
    }
    // 1 つの改札から 2 つのホームへ行くときは、上り (横浜・東京方面) を F、下り (大船方面) を Q にする
    const north = (d) => d.plat && d.plat.routes.some((x) => x.r.up) ? 0 : 1;
    for (const g of this.gates) g.downs.sort((a, b) => north(a) - north(b));

    // 延ばした先の駅で、ホームが 2 面以上ある所 (横浜): ホームの中央の「のりかえ」の場所 (railext.js の案内板と同じ所 = 縁の点の真ん中 + 1) から、
    // 同じ駅のほかのホームへ (暗転して移す。階段・コンコースは無い)。F = 1 つ目、Q = 2 つ目
    this.xfers = [];   // { pl, spot: {x, y, z}, face, label, targets: [xfer] }
    const byName = {};
    for (const pl of this.plats.slice(rail.platforms.length)) (byName[pl.name] = byName[pl.name] || []).push(pl);
    for (const group of Object.values(byName)) {
      if (group.length < 2) continue;
      const xs = group.map((pl) => {
        const pf = pl.pf, k = Math.min(pf.left.length - 2, (pf.left.length >> 1) + 1);
        const x = (pf.left[k][0] + pf.right[k][0]) / 2, z = (pf.left[k][1] + pf.right[k][1]) / 2;
        const lines = [...new Set(pl.routes.map((q) => lineName(q.r)))], dirs = new Set(pl.routes.map((q) => q.r.up));
        const label = lines.join('・') + (dirs.size === 1 ? (dirs.has(true) ? ' 上り' : ' 下り') : '') + 'ホーム';
        return { pl, spot: { x, y: pf.y[k], z }, face: Math.atan2(pf.left[k + 1][0] - pf.left[k][0], pf.left[k + 1][1] - pf.left[k][1]), label, targets: [] };
      });
      for (const a of xs) a.targets = xs.filter((b) => b !== a).slice(0, 2);
      this.xfers.push(...xs);
    }

    this.hint = document.getElementById('train-hint');
    this.btn = document.getElementById('tb-train');
    this.btn2 = document.getElementById('tb-train2');   // 2 つ目の行き先 (Q)
    this.viewBtn = document.getElementById('tb-view');
    this.info = document.getElementById('train-info');
    this.fade = document.getElementById('fade');
    this.toast = document.getElementById('train-toast');
    this.near = null;
    this.C = new THREE.Vector3(); this.Q = new THREE.Quaternion();
    this.interior = null;   // 車内 (車内の視点のときだけ。最初に使うときに作る)
  }

  // 車内: 窓のある壁・床・天井・ロングシート・握り棒・照明。局所座標は車両と同じ (y = 0 がレールの上面、+Z が進む向き)
  buildInterior() {
    const g = new THREE.Group();
    g.name = 'train_interior';
    const L = this.api.CAR - 0.6, W = 2.78, F = 1.17, Hc = 2.25, C0 = F + Hc;   // 長さ・幅・床・天井までの高さ
    const DOORS = [-7.2, -2.4, 2.4, 7.2];                                         // ドアの中心 (4 か所)
    const tex = (w, h, draw) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      draw(c.getContext('2d'), w, h);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
    };
    // 横の壁: クリーム色。窓とドアのガラスは抜く (外が見える)
    const side = tex(1024, 128, (c, w, h) => {
      c.fillStyle = '#e9e4d6'; c.fillRect(0, 0, w, h);
      const X = (z) => (z / L + 0.5) * w, Y = (y) => h - (y - F) / Hc * h;
      c.fillStyle = '#b9b6ad'; c.fillRect(0, Y(F + 0.5), w, 3);                                   // 腰の線
      for (let k = 0; k < DOORS.length + 1; k++) {                                                  // ドアの間の窓
        const a = k === 0 ? -L / 2 + 0.4 : DOORS[k - 1] + 0.95, b = k === DOORS.length ? L / 2 - 0.4 : DOORS[k] - 0.95;
        for (let z = a; z < b - 0.3; z += 1.6) c.clearRect(X(z), Y(F + 1.95), X(Math.min(b, z + 1.45)) - X(z), Y(F + 0.95) - Y(F + 1.95));
      }
      for (const d of DOORS) {                                                                       // ドア (銀色) と、その窓
        c.fillStyle = '#c2c5c8'; c.fillRect(X(d - 0.65), 0, X(d + 0.65) - X(d - 0.65), h);
        c.fillStyle = '#333'; c.fillRect(X(d) - 1, 0, 2, h);
        for (const e of [-0.42, 0.12]) c.clearRect(X(d + e), Y(F + 1.85), X(d + e + 0.3) - X(d + e), Y(F + 0.95) - Y(F + 1.85));
      }
    });
    const wallMat = new THREE.MeshLambertMaterial({ map: side, alphaTest: 0.5, side: THREE.DoubleSide });
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(L, Hc), wallMat);
      m.rotation.y = sx * Math.PI / 2; m.position.set(sx * W / 2, F + Hc / 2, 0);
      g.add(m);
    }
    const plane = (w, l, color, y, flip) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), new THREE.MeshLambertMaterial({ color })); m.rotation.x = flip ? Math.PI / 2 : -Math.PI / 2; m.position.y = y; g.add(m); return m; };
    plane(W, L, '#6f6a62', F, false);           // 床
    plane(W, L, '#f1f0ec', C0, true);           // 天井
    // 前後の壁 (貫通路のガラス)
    const endTex = tex(128, 128, (c, w, h) => { c.fillStyle = '#e9e4d6'; c.fillRect(0, 0, w, h); c.fillStyle = '#c2c5c8'; c.fillRect(w * 0.36, h * 0.12, w * 0.28, h * 0.88); c.clearRect(w * 0.41, h * 0.2, w * 0.18, h * 0.35); });
    for (const sz of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W, Hc), new THREE.MeshLambertMaterial({ map: endTex, alphaTest: 0.5, side: THREE.DoubleSide }));
      m.position.set(0, F + Hc / 2, sz * L / 2); g.add(m);
    }
    // ロングシート (青) と背もたれ、ドアの横の握り棒、天井の照明
    const seat = new THREE.MeshLambertMaterial({ color: '#2f4f9a' }), pole = new THREE.MeshLambertMaterial({ color: '#d8dadc' });
    const light = new THREE.MeshBasicMaterial({ color: '#fbfbf4' });
    const edges = [-L / 2 + 0.3, ...DOORS.flatMap((d) => [d - 0.75, d + 0.75]), L / 2 - 0.3];
    for (let k = 0; k + 1 < edges.length; k += 2) {
      const a = edges[k], b = edges[k + 1], len = b - a - 0.1, mz = (a + b) / 2;
      if (len < 0.8) continue;
      for (const sx of [-1, 1]) {
        const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, len), seat); s1.position.set(sx * (W / 2 - 0.3), F + 0.42, mz); g.add(s1);
        const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, len), seat); s2.position.set(sx * (W / 2 - 0.06), F + 0.72, mz); g.add(s2);
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.36, len), new THREE.MeshLambertMaterial({ color: '#8b8e92' })); base.position.set(sx * (W / 2 - 0.3), F + 0.18, mz); g.add(base);
      }
    }
    for (const d of DOORS) for (const sx of [-1, 1]) for (const e of [-0.8, 0.8]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, Hc, 6), pole); m.position.set(sx * (W / 2 - 0.55), F + Hc / 2, d + e); g.add(m);
    }
    for (const sx of [-0.55, 0.55]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, L - 1), light); m.position.set(sx, C0 - 0.02, 0); g.add(m); }
    for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, L - 1, 6), pole); m.rotation.x = Math.PI / 2; m.position.set(sx * 0.75, C0 - 0.35, 0); g.add(m); } // つり革の棒
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  // 延ばした先の駅の、地図のワープ先 (駅ごとに 1 つ): 最初のホーム (横浜は横須賀線の島式 = 上下とも止まる) の中央から 3 点 (12 m) ずらした、
  // ホームの中心線の上 (屋根の柱・駅名標・「のりかえ」の案内板と重ならない所)。{ name, x, y, z, face }
  stationSpots() {
    if (this.disabled) return [];
    const out = [], seen = new Set();
    for (const pl of this.plats.slice(this.nHome)) {
      if (seen.has(pl.name + '|' + pl.sub)) continue;
      seen.add(pl.name + '|' + pl.sub);
      const pf = pl.pf, k = Math.max(1, (pf.left.length >> 1) - 3);
      out.push({ name: pl.name, sub: pl.sub, x: (pf.left[k][0] + pf.right[k][0]) / 2, y: pf.y[k], z: (pf.left[k][1] + pf.right[k][1]) / 2,
        face: Math.atan2(pf.left[k + 1][0] - pf.left[k][0], pf.left[k + 1][1] - pf.left[k][1]) });
    }
    return out.concat(this.siteSpots || [], this.exitSpots || []);
  }

  // (x, z) があるホーム (無ければ null)
  platAt(x, z) {
    for (const pl of this.plats) if (inRing(x, z, pl.ring)) return pl;
    return null;
  }
  // ホームの上面の高さ (いちばん近い縁の点の高さ)
  platY(pl, x, z) {
    const pf = pl.pf;
    let bk = 0, bd = Infinity;
    for (let k = 0; k < pf.left.length; k++) {
      const d = Math.hypot(pf.left[k][0] - x, pf.left[k][1] - z);
      if (d < bd) { bd = d; bk = k; }
    }
    return pf.y[bk];
  }
  // 高さ y の面に立たせる (player.teleport は地面の高さに置くので、ホーム・通路の上には使えない)
  place(x, y, z, face) {
    const p = this.player;
    p.teleport(x, z);
    p.pos.y = this.world.groundAt(x, z, y + 0.3);
    if (face != null) { p.facing = face; this.cam.yaw = face + Math.PI; }
    this.cam.update(0, p.pos, true);
  }
  onPlatform() {
    const p = this.player.pos, pl = this.platAt(p.x, p.z);
    return pl && Math.abs(p.y - this.platY(pl, p.x, p.z)) < 0.6 ? pl : null;
  }

  // 道筋 r の上で (x, z) にいちばん近い点の距離 s と、中心線からの距離
  nearestOnRoute(r, x, z) {
    const p = r.p;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < p.length; i++) { const d = (p[i][0] - x) ** 2 + (p[i][2] - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    const i0 = Math.max(0, bi - 1), i1 = Math.min(p.length - 1, bi + 1);
    let best = { s: r.acc[bi], d: Math.sqrt(bd) };
    for (const [a, b] of [[i0, bi], [bi, i1]]) {
      if (a === b) continue;
      const ax = p[a][0], az = p[a][2], ex = p[b][0] - ax, ez = p[b][2] - az, l2 = ex * ex + ez * ez;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
      const d = Math.hypot(x - ax - ex * t, z - az - ez * t);
      if (d < best.d) best = { s: r.acc[a] + Math.sqrt(l2) * t, d };
    }
    return best;
  }
  // 道筋 r の電車が si 番目の駅に止まっているか: { left (発車までの秒), j (何本前の電車か) } か null
  dwellAt(r, si, now) {
    const ta = r.tArrs[si];
    for (let j = 0; j < r.m; j++) {
      const t = this.api.tOf(r, j, now);
      if (t >= ta && t < ta + this.api.DWELL) return { left: ta + this.api.DWELL - t, j };
    }
    return null;
  }
  // 次に si 番目の駅に着くまでの秒 (止まっている間は 0)
  nextArrive(r, si, now) {
    if (this.dwellAt(r, si, now)) return 0;
    const T = r.L.period, t = this.api.phase(r, now);
    return (((r.tArrs[si] - t) % T) + T) % T;
  }
  // 出発から t 秒の電車 (道筋 r) が止まっている駅: { si, left } か null
  dwellAny(r, t) {
    for (let si = 0; si < r.stops.length; si++) { const ta = r.tArrs[si]; if (t >= ta && t < ta + this.api.DWELL) return { si, left: ta + this.api.DWELL - t }; }
    return null;
  }

  // 暗転して fn を実行し、明るく戻す
  async blackout(fn, msg) {
    this.busy = true;
    if (this.fade) { this.fade.hidden = false; await new Promise((r) => requestAnimationFrame(() => { this.fade.classList.add('on'); r(); })); await new Promise((r) => setTimeout(r, 450)); }
    fn();
    if (msg) this.say(msg, 4);
    await new Promise((r) => setTimeout(r, 150));
    if (this.fade) { this.fade.classList.remove('on'); setTimeout(() => { if (!this.fade.classList.contains('on')) this.fade.hidden = true; }, 500); }
    this.busy = false;
  }
  say(msg, sec) {
    this.lastSay = msg;
    if (!this.toast) return;
    this.toast.textContent = msg; this.toast.hidden = false;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { this.toast.hidden = true; }, sec * 1000);
  }

  setHint(txt, btn, btn2) {
    const key = (txt || '') + '|' + (btn || '') + '|' + (btn2 || '');
    if (this._hintKey === key) return;
    this._hintKey = key;
    if (this.hint) { this.hint.hidden = !txt; if (txt) this.hint.innerHTML = txt; }
    if (this.btn) { this.btn.hidden = !btn; if (btn) this.btn.textContent = btn; }
    if (this.btn2) { this.btn2.hidden = !btn2; if (btn2) this.btn2.textContent = btn2; }
  }
  setInfo(html) {
    if (!this.info) return;
    if (this._info === html) return;
    this._info = html;
    this.info.hidden = !html;
    if (html) this.info.innerHTML = html;
  }

  // 毎コマ (キャラの更新の前)。F の押した瞬間をここで見る
  update(dt, input) {
    if (this.disabled) return;
    if (this.riding) return this.updateRiding(dt, input);
    if (this.busy) return;
    const p = this.player.pos, now = this.api.now();
    let act = null;

    // ホームで、止まっている電車の横
    const pl = this.onPlatform();
    if (pl) {
      for (const { r, si } of pl.routes) {
        const dw = this.dwellAt(r, si, now);
        if (!dw) continue;
        const n = this.nearestOnRoute(r, p.x, p.z);
        const k = Math.floor((r.S[si] - n.s) / this.api.CAR);
        if (n.d < REACH_CAR && k >= 0 && k < r.L.cars && (!act || n.d < act.d)) act = { type: 'board', r, j: dw.j, k, d: n.d, left: dw.left, pl };
      }
      // 次の電車の案内 (このホームに止まる線ごと)
      const rows = pl.routes.slice().sort((a, b) => this.nextArrive(a.r, a.si, now) - this.nextArrive(b.r, b.si, now)).map(({ r, si }) => {
        const dw = this.dwellAt(r, si, now), w = this.nextArrive(r, si, now);
        return `<div>${lineTag(r)} ${dirName(r)}　<b>${dw ? '停車中 発車まで ' + mmss(dw.left) : 'あと ' + mmss(w)}</b></div>`;
      });
      this.setInfo(`<div class="tt">${pl.name}駅 ${pl.sub ? pl.sub + ' ' : ''}ホーム</div>${rows.join('')}`);
    } else this.setInfo(null);

    // 改札 (自由通路) と、ホームの階段の下
    if (!act) for (const g of this.gates) {
      if (Math.hypot(p.x - g.top.x, p.z - g.top.z) < REACH_GATE && Math.abs(p.y - g.top.y) < 1.5) { act = { type: 'down', g }; break; }
    }
    if (!act) for (const sd of this.stairs) {
      if (Math.hypot(p.x - sd.bottom.x, p.z - sd.bottom.z) < REACH_GATE && Math.abs(p.y - sd.bottom.y) < 1.5) { act = { type: 'up', sd }; break; }
    }

    // 延ばした先の駅の「のりかえ」(ほかのホームへ)
    if (!act && pl) for (const xf of this.xfers) {
      if (xf.pl === pl && Math.hypot(p.x - xf.spot.x, p.z - xf.spot.z) < REACH_XFER) { act = { type: 'xfer', xf }; break; }
    }

    const platName = (d) => d.plat && d.plat.routes.length ? (d.plat.routes.some((x) => x.r.up) ? '上り' : '下り') + 'ホーム' : 'ホーム';
    if (!act) this.setHint(null);
    else if (act.type === 'board') this.setHint(`<b>F</b> 乗る　${lineTag(act.r)} ${dirName(act.r)}`, '乗る', null);
    else if (act.type === 'xfer') {
      const [t0, t1] = act.xf.targets;
      this.setHint(`のりかえ　<b>F</b> ${t0.label}へ` + (t1 ? `　<b>Q</b> ${t1.label}へ` : ''), t0.label + 'へ', t1 ? t1.label + 'へ' : null);
    } else if (act.type === 'down') {
      const [d0, d1] = act.g.downs;
      this.setHint(`改札　<b>F</b> ${platName(d0)}へ` + (d1 ? `　<b>Q</b> ${platName(d1)}へ` : ''), platName(d0) + 'へ', d1 ? platName(d1) + 'へ' : null);
    } else this.setHint('<b>F</b> 改札へ上がる', '改札へ', null);

    if (!act) return;
    const F = input.pressed('KeyF'), G = input.pressed('KeyQ');
    if (act.type === 'board') { if (F) this.board(act.r, act.j, act.k, act.pl); return; }
    if (act.type === 'xfer') {
      const t = F ? act.xf.targets[0] : G ? act.xf.targets[1] : null;
      // 案内板の少し先 (板にめり込まない所) に、ホームの向きで立たせる
      if (t) this.blackout(() => this.place(t.spot.x + Math.sin(t.face) * 1.5, t.spot.y, t.spot.z + Math.cos(t.face) * 1.5, t.face), `${t.pl.name}駅 ${t.label}に移りました`);
      return;
    }
    if (act.type === 'down') {
      const d = F ? act.g.downs[0] : G ? act.g.downs[1] : null;
      if (d) this.blackout(() => this.place(d.bottom.x, d.bottom.y, d.bottom.z, Math.atan2(-d.ux, -d.uz)));
      return;
    }
    const t = act.sd.gate.top;
    if (F) this.blackout(() => this.place(t.x, t.y, t.z, Math.atan2(act.sd.ux, act.sd.uz)));
  }

  board(r, j, k, pl) {
    const p = this.player;
    this.riding = { r, dep: this.api.now() - this.api.tOf(r, j, this.api.now()), k, view: 'out', dist: this.cam.dist, from: { x: p.pos.x, y: p.pos.y, z: p.pos.z, face: p.facing, plat: pl }, ended: false, last: null };
    p.vel.set(0, 0); p.vy = 0; p.act = null; p.atk = null;
    p.model.root.visible = false;
    this.cam.dist = RIDE_DIST;
    // カメラは電車の真横の、ホームと反対の側から (ホームの屋根にさえぎられないように)
    if (this.api.carPose(r, k, this.api.now(), this.C, this.Q, j)) {
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.Q);
      const s = (p.pos.x - this.C.x) * side.x + (p.pos.z - this.C.z) * side.z > 0 ? -1 : 1;
      this.cam.yaw = Math.atan2(side.x * s, side.z * s); this.cam.pitch = 0.32;
      this.cam.update(0, { x: this.C.x, y: this.C.y + 1.2, z: this.C.z }, true);
    }
    this.setHint(null);
    this.setInfo(null);
    if (this.viewBtn) this.viewBtn.hidden = false;
    this.say(`${lineName(r)} ${dirName(r)} に乗りました`, 3);
  }

  // 降りる: 車両の横の、ホームの側に立つ
  alight() {
    const rd = this.riding, C = this.C, Q = this.Q;
    if (!this.api.carPoseT(rd.r, rd.k, this.api.now() - rd.dep, C, Q)) return this.endRide();
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(Q);
    let spot = null;
    for (const s of [1, -1]) for (const d of [2.6, 3.2]) {
      const x = C.x + side.x * s * d, z = C.z + side.z * s * d, pl = this.platAt(x, z);
      if (pl && !spot) spot = { x, z, y: this.platY(pl, x, z), face: Math.atan2(side.x * s, side.z * s) };
    }
    if (!spot) return this.endRide();
    this.finish();
    this.place(spot.x, spot.y, spot.z, spot.face);
  }
  // 乗るのをやめた状態に戻す (キャラを出し、カメラの距離を戻す)
  finish() {
    const rd = this.riding;
    if (!rd) return;
    this.riding = null;
    this.player.model.root.visible = true;
    this.cam.dist = rd.dist;
    if (this.interior) this.interior.visible = false;
    if (this.viewBtn) this.viewBtn.hidden = true;
    this.setHint(null); this.setInfo(null);
  }
  // 道筋の終わり (範囲の端) に着いた: 最後に通った駅のホームへ戻る (無ければ乗ったホーム)
  endRide() {
    const rd = this.riding;
    if (!rd || rd.ended) return;
    rd.ended = true;
    const pl = rd.last != null ? this.plats.find((q) => q.routes.some((x) => x.r === rd.r && x.si === rd.last)) : null;
    this.blackout(() => {
      this.finish();
      if (pl && pl !== rd.from.plat) {
        const pf = pl.pf, m = pf.left.length >> 1, x = (pf.left[m][0] + pf.right[m][0]) / 2, z = (pf.left[m][1] + pf.right[m][1]) / 2;
        this.place(x, this.platY(pl, x, z), z, Math.atan2(pf.left[m + 1][0] - pf.left[m][0], pf.left[m + 1][1] - pf.left[m][1]));
      } else this.place(rd.from.x, rd.from.y, rd.from.z, rd.from.face);
    }, `この先は範囲の外です。${(pl || rd.from.plat || { name: '戸塚' }).name}駅のホームに戻りました`);
  }
  // ワープ・リスポーンのとき
  cancel() { if (this.riding) this.finish(); }

  updateRiding(dt, input) {
    const rd = this.riding, api = this.api, now = api.now(), r = rd.r;
    if (rd.ended) return;
    if (!api.carPoseT(r, rd.k, now - rd.dep, this.C, this.Q)) return this.endRide();
    // 先頭が道筋の終わりの 30 m 手前に来たら終わり (電車は端で消えるので)
    const t = now - rd.dep, front = api.front(r, t);
    for (let si = 0; si < r.stops.length; si++) if (r.S[si] <= front + 0.5) rd.last = si;   // 最後に通った (止まっている) 駅 (終点に止まっている間も、その駅)
    if (front > r.len - 30 && !r.term) return this.endRide();   // 終点に着く道筋 (新しい線) は、止まった後に電車が消えたら終わり (上の carPoseT)
    const p = this.player;
    p.pos.copy(this.C);
    p.model.root.position.copy(this.C);
    if (input.pressed('KeyQ')) rd.view = rd.view === 'out' ? 'in' : 'out';

    const dw = this.dwellAny(r, t), left = dw ? dw.left : null;
    const kmh = Math.round(api.speed(r, t) * 3.6);
    const nextSi = r.S.findIndex((s) => s > front + 1);
    const where = dw ? `${r.stops[dw.si].name} 停車中` : nextSi >= 0 ? (r.S[nextSi] - front < 700 ? 'まもなく ' : '次は ') + r.stops[nextSi].name
      : rd.last != null ? `${r.stops[rd.last].name}を出ました` : r.line === 'tokaido' ? '東戸塚は通過します' : '';
    this.setInfo(`<div class="tt">${lineTag(r)} ${dirName(r)}　${rd.k + 1} 号車</div>`
      + `<div>${where}　${left != null ? '発車まで <b>' + mmss(left) + '</b>' : '<b>' + kmh + '</b> km/h'}</div>`);
    this.setHint(`${left != null ? '<b>F</b> 降りる　' : ''}<b>Q</b> ${rd.view === 'out' ? '車内の視点' : '外からの視点'}`, left != null ? '降りる' : null);
    if (left != null && input.pressed('KeyF')) this.alight();
  }

  // カメラ (乗っている間。cam.update の代わり)
  view(dt) {
    const rd = this.riding;
    if (!rd) return;
    const cam = this.cam, C = this.C;
    if (rd.view === 'out') {
      if (this.interior) this.interior.visible = false;
      // トンネルの中 (新しい線の地下の区間): 外から回り込むとトンネルの壁の外 (土の中) に出るので、線路の上の、先頭の 14 m 前から電車の前面を見る
      // (後ろの車両の屋根の上からだと、画面が屋根だけになった)
      const api = this.api, r = rd.r, t = api.now() - rd.dep, sf = api.front(r, t), sc = sf - (rd.k + 0.5) * api.CAR;
      if (api.inTunnel(r, sc)) {
        const A = api.pointAt(r, Math.min(r.len, sf + 14), new THREE.Vector3()), F = api.pointAt(r, Math.max(0, sf - 14), new THREE.Vector3());
        this.camera.position.set(A.x, A.y + 2.7, A.z);
        this.camera.lookAt(F.x, F.y + 2.0, F.z);
        cam.target.set(C.x, C.y + 1.2, C.z);
        return;
      }
      cam.update(dt, { x: C.x, y: C.y + 1.2, z: C.z });
      return;
    }
    // 車内: 車両の中心、目の高さ。マウス・指の向き (cam.yaw / pitch) で見回す。車体の箱は外向きの面だけなので、内側からは車内 (buildInterior) の窓越しに外が見える
    if (!this.interior && this.scene) this.interior = this.buildInterior();
    if (this.interior) { this.interior.visible = true; this.interior.position.copy(C); this.interior.quaternion.copy(this.Q); }
    const cp = Math.cos(cam.pitch);
    const dir = new THREE.Vector3(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
    this.camera.position.set(C.x, C.y + EYE, C.z);
    this.camera.lookAt(C.x - dir.x, C.y + EYE - dir.y, C.z - dir.z);
    cam.target.set(C.x, C.y + EYE, C.z);
  }
}
