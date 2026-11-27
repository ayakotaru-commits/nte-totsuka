// キャラメイク: 顔のパーツ。目・まゆ・鼻・口・耳・輪郭の大きさや位置を、顔のメッシュの頂点を動かして変える。
//   const f = new Facedresser(vrm);  f.set({ eyeSize: 0.5, noseSize: -0.3 });  (各値は -1〜+1。0 = 元の顔。null や未指定 = 0)
// 仕組み (頂点の移動):
//   顔は 1 つの Group (Face) で、肌・白目・虹彩・まつげ・まゆ・口・耳が、層ごとに別の Mesh (頂点の配列も別) として重なっている。
//   どの層の頂点も、元の位置 p だけから決まる 1 つの関数 p → p + D(p) で動かすので、層どうしがずれない (目の穴・まゆが肌の上に乗ったまま、継ぎ目も割れない)。
//   D(p) は、パーツごとに「中心のまわりの楕円の中は一様に動かし、外へ向かってなめらかに 0 へ戻す」重みの和。
//   パーツの中心・大きさは、顔のメッシュ自身から測る (白目・まゆ・口の層の頂点、鼻先 = 中心線でいちばん前の肌の頂点、耳 = モーフを持たないほうの肌の層)。
//   だから体 (女性・男性) が変わっても同じ式で動く (顔の寸法の数字を体ごとに持たない)。
//   表情・口の形・まばたき (モーフ) は、動かした後の顔に合わせて作り直す: 新しい差分 = D を足した (p + 差分) − D を足した p。
//   頭皮 (髪の殻に使う面) は動かさない (重みが前髪の生え際より上へ届かない) ので、髪の合わせ (hair.js) はそのまま。
//   値を変えたときだけ頂点を作り直す (1 回 約 5〜9 ms。毎フレームの費用は無い)。
import * as THREE from 'three';

// 各パラメータの最大の効き (値 ±1 のとき)
const K = {
  eyeSize: 0.30,   // 目の倍率 1 ± 0.30
  eyeY: 0.009,     // 目の上下 (m)
  eyeGap: 0.010,   // 目の左右の間隔 (m。片側)
  eyeTilt: 0.20,   // 目の傾き (rad。+ = 目尻が上がる = つり目)
  browY: 0.010,    // まゆの上下 (m)
  browTilt: 0.20,  // まゆの傾き (rad。+ = 外側が上がる)
  noseSize: 0.5,   // 鼻の高さ・大きさ 1 ± 0.5 (前へ出る量は元の出っぱりの 0.5 倍)
  noseY: 0.006,    // 鼻の上下 (m)
  mouthSize: 0.30, // 口の倍率 1 ± 0.30
  mouthY: 0.005,   // 口の上下 (m)
  earSize: 0.35,   // 耳の倍率 1 ± 0.35
  jawWidth: 0.15,  // 輪郭の幅 (下あごの横幅) の倍率 1 ± 0.15
  chin: 0.010,     // あごの長さ (m。+ = 長い)
};
export const FACE_KEYS = Object.keys(K);

const sstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
// 楕円 (中心 cx,cy、半径 rx,ry) の中で 1、外側 (半径の fade 倍) へなめらかに 0 になる重み
function ell(x, y, cx, cy, rx, ry, fade) {
  const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
  return d <= 1 ? 1 : 1 - sstep((d - 1) / (fade - 1));
}

export class Facedresser {
  constructor(vrm) {
    this.params = {};
    this.ok = false;
    const mats = (o) => (Array.isArray(o.material) ? o.material : [o.material]);
    let iris = null;
    vrm.scene.traverse((o) => { if (!iris && o.isMesh && mats(o).some((m) => /EyeIris/.test(m.name))) iris = o; });
    if (!iris) return;
    // 顔 = 虹彩と同じ親 (Face) の下のメッシュ。読み込み後は層ごとに別の Mesh で、頂点の配列も層ごとに別 (肌・白目・虹彩・まつげ・まゆ・口・耳)
    const kind = (o) => { const n = mats(o).map((m) => m.name).join('|'); return /_SKIN/.test(n) ? 'skin' : /EyeWhite/.test(n) ? 'white' : /FaceBrow/.test(n) ? 'brow' : /FaceMouth/.test(n) ? 'mouth' : /FaceEyeline/.test(n) ? 'line' : 'other'; };
    this.parts = []; // { mesh, kind, pos0, morphs: [{ attr, d0 }], ear: bool }
    iris.parent.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position || !mats(o).some((m) => /EyeIris|_FACE|_EYE|_SKIN/.test(m.name))) return;
      const g = o.geometry;
      this.parts.push({ mesh: o, kind: kind(o), pos: g.attributes.position, pos0: Float32Array.from(g.attributes.position.array),
        morphs: (g.morphAttributes?.position || []).map((attr) => ({ attr, d0: Float32Array.from(attr.array) })), ear: false });
    });
    const by = (k) => this.parts.filter((q) => q.kind === k);
    const skins = by('skin');
    if (!skins.length || !by('white').length) return;
    // 耳 = 肌のうち、表情のモーフを持たないほう (頭の横の別の面)。モーフを持つほうが顔の本体
    for (const q of skins) if (!q.morphs.length && skins.length > 1) q.ear = true;
    const bb = (list, filt) => {
      const b = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, z0: 1e9, z1: -1e9, sx: 0, sy: 0, n: 0 };
      for (const q of list) for (let i = 0; i < q.pos0.length; i += 3) {
        const x = q.pos0[i], y = q.pos0[i + 1], z = q.pos0[i + 2];
        if (filt && !filt(x, y, z)) continue;
        b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z); b.sx += x; b.sy += y; b.n++;
      }
      b.cx = b.sx / b.n; b.cy = b.sy / b.n; return b;
    };
    const pos = (x) => x > 0;
    const wR = bb(by('white'), pos), lR = bb(by('line'), pos), bR = bb(by('brow'), pos), mo = bb(by('mouth'));
    const eye = { x: Math.abs(wR.cx), y: wR.cy, z: wR.z0, rx: Math.max(wR.x1 - wR.x0, lR.n ? lR.x1 - lR.x0 : 0) / 2, ry: (wR.y1 - wR.y0) / 2 };
    const face = skins.filter((q) => !q.ear), skinBox = bb(face);
    // 鼻先: 中心線 (|x| < 1 cm) で、口と目のあいだにある、いちばん前 (z が小さい) の肌の頂点
    let nose = null;
    for (const q of face) for (let i = 0; i < q.pos0.length; i += 3) {
      const x = q.pos0[i], y = q.pos0[i + 1], z = q.pos0[i + 2];
      if (Math.abs(x) < 0.01 && y > mo.y1 - 0.004 && y < eye.y - eye.ry && (!nose || z < nose.z)) nose = { x: 0, y, z };
    }
    if (!nose) nose = { x: 0, y: (mo.y1 + eye.y) / 2, z: skinBox.z0 };
    // 耳の付け根: 頭に近い側の端
    const ears = by('skin').filter((q) => q.ear);
    const earOf = (right) => { const b = bb(ears, (x) => (right ? x > 0 : x < 0)); return b.n ? { x: right ? b.x0 : b.x1, y: (b.y0 + b.y1) / 2, z: (b.z0 + b.z1) / 2 } : { x: 0, y: 0, z: 0 }; };
    this.L = {
      eye, brow: { x: Math.abs(bR.cx), y: bR.cy, rx: (bR.x1 - bR.x0) / 2, ry: Math.max(0.006, (bR.y1 - bR.y0) / 2) },
      mouth: { x: mo.cx, y: mo.cy, rx: (mo.x1 - mo.x0) / 2, ry: (mo.y1 - mo.y0) / 2 }, nose,
      chinY: skinBox.y0, top: skinBox.y1, eyeTop: eye.y + eye.ry, ear: { L: earOf(false), R: earOf(true) },
    };
    for (const q of ears) q.pin = this._pinWeights(q.pos0, q.mesh.geometry.index);
    this.ok = true;
    this.set({});
  }

  // 耳の面の、頭につながる縁 (辺が 1 つの三角形にしか使われない所) からの距離 (辺をたどった数) に応じた重み 0〜1。
  //   縁は動かさない (耳を小さくしても、頭の穴をふさいだまま) → 縁から 3 つ内側で全部効く。位置が同じ頂点 (模様の継ぎ目) は同じ頂点として扱う
  _pinWeights(p0, idx) {
    const n = p0.length / 3, key = new Map(), id = new Int32Array(n);
    for (let i = 0; i < n; i++) { const k = Math.round(p0[i * 3] * 1e5) + ',' + Math.round(p0[i * 3 + 1] * 1e5) + ',' + Math.round(p0[i * 3 + 2] * 1e5); if (!key.has(k)) key.set(k, i); id[i] = key.get(k); }
    const edges = new Map(), adj = new Map();
    const add = (a, b) => { a = id[a]; b = id[b]; if (a === b) return; const k = a < b ? a * 65536 + b : b * 65536 + a; edges.set(k, (edges.get(k) || 0) + 1); (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); };
    const cnt = idx ? idx.count : n;
    for (let t = 0; t < cnt; t += 3) { const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2; add(a, b); add(b, c); add(c, a); }
    const hop = new Map(), queue = [];
    for (const [k, c] of edges) if (c === 1) for (const v of [Math.floor(k / 65536), k % 65536]) if (!hop.has(v)) { hop.set(v, 0); queue.push(v); }
    for (let h = 0; h < queue.length; h++) { const v = queue[h]; for (const u of adj.get(v) || []) if (!hop.has(u)) { hop.set(u, hop.get(v) + 1); queue.push(u); } }
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = hop.has(id[i]) ? Math.min(1, hop.get(id[i]) / 3) : 1;
    return w;
  }

  // 位置 (x,y,z) の変位 D を out に足す。ear = 耳の頂点なら 0〜1 の重み (縁 = 0)、耳でなければ 0
  _disp(x, y, z, q, ear, out) {
    const L = this.L, e = L.eye;
    let dx = 0, dy = 0, dz = 0;
    // 顔の前面 (目・まゆ・鼻・口がある側): 目の奥行きより後ろへは重みを出さない
    const front = 1 - sstep((z - (e.z + 0.035)) / 0.02); // z が小さい (前) ほど 1
    const ax = Math.abs(x), sx = x < 0 ? -1 : 1;
    // 左右の目・まゆを対称に動かすとき、顔の中心線 (x = 0) で左右が割れないよう、中心へ向けて 0 に戻す
    const cE = sstep(ax / (e.x * 0.7)), cB = sstep(ax / (L.brow.x * 0.6));
    // ---- 目 (左右対称。ax で見る): 中心 (e.x, e.y)。中は一様に動かし、外へなめらかに戻す
    if (front > 0 && (q.eyeSize || q.eyeY || q.eyeGap || q.eyeTilt)) {
      const w = ell(ax, y, e.x, e.y, e.rx * 1.25, e.ry * 1.6, 1.9) * front * cE;
      if (w > 0) {
        const s = q.eyeSize * K.eyeSize, th = q.eyeTilt * K.eyeTilt * w;
        let rx = ax - e.x, ry = y - e.y;
        // 傾き (目尻 = 外側が上がる): 中心まわりに回す。外側 (ax が大きい) が上がる向き
        const c = Math.cos(th), sn = Math.sin(th);
        const tx = rx * c - ry * sn, ty = rx * sn + ry * c;
        dx += sx * ((tx - rx) + rx * s * w + q.eyeGap * K.eyeGap * w); dy += (ty - ry) + ry * s * w + q.eyeY * K.eyeY * w;
      }
    }
    // ---- まゆ
    if (front > 0 && (q.browY || q.browTilt)) {
      const b = L.brow;
      const w = ell(ax, y, b.x, b.y, b.rx * 1.1, b.ry * 1.8, 1.7) * front * cB;
      if (w > 0) {
        const th = q.browTilt * K.browTilt * w, rx = ax - b.x, ry = y - b.y, c = Math.cos(th), sn = Math.sin(th);
        dy += q.browY * K.browY * w + (rx * sn + ry * c - ry); dx += sx * (rx * c - ry * sn - rx);
      }
    }
    // ---- 鼻: 鼻先 (nose) を中心に。前への出っぱり (z) を倍率で、上下を y で
    if (front > 0 && (q.noseSize || q.noseY)) {
      const n = L.nose, w = ell(x, y, n.x, n.y + 0.002, 0.022, 0.024, 1.8) * front;
      if (w > 0) {
        // 出っぱり = 鼻先の z からの深さ (顔の面 = 鼻先より 1.6 cm 後ろ)
        const depth = Math.max(0, (n.z + 0.016) - z) / 0.016; // 鼻先 1、顔の面 0 (z が小さいほど前)
        dz -= q.noseSize * K.noseSize * 0.016 * depth * w;
        dy += q.noseY * K.noseY * w;
        const s = q.noseSize * 0.25 * w; dx += (x - n.x) * s; dy += (y - n.y) * s * 0.6;
      }
    }
    // ---- 口
    if (front > 0 && (q.mouthSize || q.mouthY)) {
      const m = L.mouth, w = ell(x, y, m.x, m.y, m.rx * 1.2, m.ry * 1.9, 1.8) * front;
      if (w > 0) { const s = q.mouthSize * K.mouthSize * w; dx += (x - m.x) * s; dy += (y - m.y) * s + q.mouthY * K.mouthY * w; }
    }
    // ---- 輪郭: 目の下端より下の、顔の前から横にかけて。幅は x の倍率、あごは下へ伸ばす (首のつなぎ目 = 顔の下端へは 0 に戻す)
    if (q.jawWidth || q.chin) {
      const lowW = sstep((e.y - e.ry * 1.5 - y) / 0.045) * (1 - sstep((L.chinY + 0.012 - y) / 0.012)); // 目より下で 1、首のつなぎ目で 0
      if (lowW > 0) dx += x * q.jawWidth * K.jawWidth * lowW;
      if (q.chin) {
        const down = sstep((L.mouth.y - y) / 0.02 + 0.5) * (1 - sstep((L.chinY + 0.014 - y) / 0.014)); // 口より下 (あごの先 = 1)、首のつなぎ目 (y が下端) で 0
        dy -= q.chin * K.chin * down * (1 - sstep((z - (e.z + 0.02)) / 0.03));
      }
    }
    // ---- 耳: 付け根のまわりに拡大縮小 (耳の頂点だけ)
    if (ear > 0 && q.earSize) {
      const E = sx < 0 ? L.ear.L : L.ear.R, s = q.earSize * K.earSize * ear;
      dx += (x - E.x) * s; dy += (y - E.y) * s; dz += (z - E.z) * s;
    }
    out[0] += dx; out[1] += dy; out[2] += dz;
  }

  // 値を設定して、頂点を作り直す。q は FACE_KEYS の -1〜+1 (未指定 = 0)
  set(q) {
    this.params = { ...q };
    if (!this.ok) return;
    const Q = {}; for (const k of FACE_KEYS) Q[k] = Math.max(-1, Math.min(1, +this.params[k] || 0));
    this.Q = Q;
    const o = [0, 0, 0], d = [0, 0, 0];
    for (const part of this.parts) {
      const { pos, pos0, pin } = part, arr = pos.array;
      for (let i = 0; i < pos0.length; i += 3) {
        o[0] = o[1] = o[2] = 0;
        this._disp(pos0[i], pos0[i + 1], pos0[i + 2], Q, pin ? pin[i / 3] : 0, o);
        arr[i] = pos0[i] + o[0]; arr[i + 1] = pos0[i + 1] + o[1]; arr[i + 2] = pos0[i + 2] + o[2];
      }
      pos.needsUpdate = true;
      // モーフ (表情・口の形・まばたき): 差分を、動かした後の顔に合わせて作り直す (新しい差分 = D を足した (p + 差分) − D を足した p)。差分が 0 の頂点は 0 のまま
      for (const m of part.morphs) {
        const a = m.attr.array, m0 = m.d0;
        for (let i = 0; i < m0.length; i += 3) {
          const ox = m0[i], oy = m0[i + 1], oz = m0[i + 2];
          if (ox === 0 && oy === 0 && oz === 0) continue;
          const x = pos0[i], y = pos0[i + 1], z = pos0[i + 2];
          o[0] = o[1] = o[2] = 0; this._disp(x, y, z, Q, pin ? pin[i / 3] : 0, o);
          d[0] = d[1] = d[2] = 0; this._disp(x + ox, y + oy, z + oz, Q, pin ? pin[i / 3] : 0, d);
          a[i] = ox + d[0] - o[0]; a[i + 1] = oy + d[1] - o[1]; a[i + 2] = oz + d[2] - o[2];
        }
        m.attr.needsUpdate = true;
      }
      // three.js は、モーフの差分を 1 度だけ GPU の模様にして覚えるので、作り直してもらう (geometry の dispose で覚えが消える)
      if (part.morphs.length) part.mesh.geometry.dispose();
    }
  }
}
