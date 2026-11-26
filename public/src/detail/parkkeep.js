// 千葉ドリームランド 段階 9 の改善 1: 主塔 (keep) の中に入れる。
// 正面の扉 (開け閉めできる。doors.js) → 大広間 (床の模様・絨毯・シャンデリア) → 壁ぞいのらせん階段 (1.5 周) → 屋上のテラス。
// 形は parkcastle.js の壁・飾りの形 (wall / trim / gold) にためるだけ (描画の呼び出しは増えない)。当たり判定は col。
// 座標は城の局所 (主塔の中心 cx, cz)。角度 a は +z (正面) から +x へ回る向き。
import * as THREE from 'three';
import { canvasTexture } from './util.js';
import { DOORS } from '../doors.js';

const TAU = Math.PI * 2;

export const KEEP = {
  RI: 11.4,          // 大広間の内壁の半径
  FLOOR: 0.4,        // 床の高さ
  CEIL: 22.4,        // 天井 (1 段目の壁の上端)
  TERRACE: 22.7,     // 屋上のテラスの床
  DOOR_W: 4.2, DOOR_H: 5.0,
  STAIR_IN: 9.5,     // 階段の内側の半径 (外側は内壁)
  STEPS: 60, STEP_ANG: 9,  // 段の数と 1 段の角度 (度)。1.5 周
  START: 180,        // 階段の始まりの角度 (度 = 裏側)。終わりは 180 + 540 = 720 = 0 度 (正面。扉の上のテラスへ出る)
  HOLE: [32, 40],    // 屋上のテラスの床を抜く扇形 (40 分割のうちの k = 32 〜 40 = 288〜360 度)
};

// 大広間の中を作る。K = parkcastle.js が渡す道具
export function buildKeepInterior(K) {
  const { Buf, NOUV, CELL, cellRect, tint, wall, trim, hall: hl, gold, col, W, y0, lamps, lampWarm, goldC, cream, stone, Cs, low, group, cx, cz } = K;
  const C = (s) => new THREE.Color(s);
  const shade = C(Cs.stoneShade), lav = C('#cfc3dc'), rose = C('#b9456f'), teal = C(Cs.teal), violet = C(Cs.violet), coral = C(Cs.coral);
  const P = (r, a, y) => [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
  const RI = KEEP.RI, FL = KEEP.FLOOR, CE = KEEP.CEIL, TE = KEEP.TERRACE;
  const out = { tris: 0 };
  const up = [0, 1, 0], down = [0, -1, 0];
  const radIn = (a) => [-Math.sin(a), 0, -Math.cos(a)];     // 中心を向く
  const radOut = (a) => [Math.sin(a), 0, Math.cos(a)];
  const tangent = (a) => [Math.cos(a), 0, -Math.sin(a)];    // a が増える向き
  const deg = Math.PI / 180;

  // ---------- 内壁 (窓の模様は外壁と同じ絵。夜は光る) ----------
  {
    const nb = 32, fl = [5.6, 5.6, 5.6, 5.6];
    let ya = FL;
    fl.forEach((fh, f) => {
      const cell = f === 0 ? CELL.PLAIN : CELL.WIN, rc = cellRect(cell), kA = 0.88 + 0.03 * f;
      for (let i = 0; i < nb; i++) {
        if (f === 0 && (i === 0 || i === nb - 1)) continue;            // 扉
        const a0 = i / nb * TAU, a1 = (i + 1) / nb * TAU, s = i % 2;
        const u0 = rc[0] + (rc[2] - rc[0]) * s / 2, u1 = rc[0] + (rc[2] - rc[0]) * (s + 1) / 2;
        const base = tint(stone, kA);
        wall.quad(P(RI, a0, ya), P(RI, a1, ya), P(RI, a1, ya + fh), P(RI, a0, ya + fh), [radIn(a0), radIn(a1), radIn(a1), radIn(a0)], [u0, rc[1], u1, rc[3]], base);
      }
      ya += fh;
    });
  }

  // ---------- 床 (タイル + 金の輪 + 中央の「リール」の円) ----------
  {
    const NS = 32, rings = [0, 2.2, 4.4, 6.6, 8.8, RI];
    for (let k = 0; k + 1 < rings.length; k++) {
      for (let i = 0; i < NS; i++) {
        const a0 = i / NS * TAU, a1 = (i + 1) / NS * TAU, c = ((i + k) & 1) ? tint(cream, 0.97) : tint(lav, 1.03);
        if (k === 0) hl.tri(P(0, a0, FL), P(rings[1], a1, FL), P(rings[1], a0, FL), up, [NOUV.slice(0, 2), NOUV.slice(0, 2), NOUV.slice(0, 2)], c);
        else hl.quad(P(rings[k], a0, FL), P(rings[k], a1, FL), P(rings[k + 1], a1, FL), P(rings[k + 1], a0, FL), up, NOUV, c);
      }
    }
    const ringBand = (r0, r1, y, color, buf = gold) => { for (let i = 0; i < NS; i++) { const a0 = i / NS * TAU, a1 = (i + 1) / NS * TAU; buf.quad(P(r0, a0, y), P(r0, a1, y), P(r1, a1, y), P(r1, a0, y), up, NOUV, color); } };
    ringBand(4.35, 4.55, FL + 0.01, goldC); ringBand(8.75, 8.95, FL + 0.01, goldC); ringBand(2.15, 2.3, FL + 0.01, goldC);
    // 中央の円: 6 つの穴 (リールの輪)
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * TAU, cxk = cx + Math.sin(a) * 1.15, czk = cz + Math.cos(a) * 1.15, pal = [rose, teal, goldC, violet, C('#7fe0b0'), coral][k];
      for (let j = 0; j < 10; j++) {
        const b0 = j / 10 * TAU, b1 = (j + 1) / 10 * TAU, r = 0.55;
        hl.tri([cxk, FL + 0.02, czk], [cxk + Math.sin(b0) * r, FL + 0.02, czk + Math.cos(b0) * r], [cxk + Math.sin(b1) * r, FL + 0.02, czk + Math.cos(b1) * r], up, [NOUV.slice(0, 2), NOUV.slice(0, 2), NOUV.slice(0, 2)], pal);
      }
    }
    // 絨毯 (扉から中央まで)
    const cw = 1.5, zA = cz + RI - 0.2, zB = cz + 3.0;
    hl.quad([cx - cw, FL + 0.03, zB], [cx + cw, FL + 0.03, zB], [cx + cw, FL + 0.03, zA], [cx - cw, FL + 0.03, zA], up, NOUV, rose);
    for (const sd of [-1, 1]) gold.quad([cx + sd * cw - 0.09, FL + 0.035, zB], [cx + sd * cw + 0.09, FL + 0.035, zB], [cx + sd * cw + 0.09, FL + 0.035, zA], [cx + sd * cw - 0.09, FL + 0.035, zA], up, NOUV, goldC);
    // 当たり判定: 円形の床 (足元が 0.18 m 低い地面から 0.22 m 上がる)
    const ring = []; for (let k = 0; k < 24; k++) { const a = k / 24 * TAU, [lx, , lz] = P(RI - 0.1, a, 0); ring.push(W(lx, lz)); }
    col.poly.push([ring, y0 - 1, y0 + FL]);
  }

  // ---------- 天井 (金の輪と、中央の大きな薔薇色の円。階段の抜け口は扇形に開ける) ----------
  {
    const N = 40, [h0, h1] = KEEP.HOLE;
    for (let i = 0; i < N; i++) {
      const a0 = i / N * TAU, a1 = (i + 1) / N * TAU, c = (i & 1) ? tint(cream, 0.9) : tint(cream, 0.85);
      hl.tri(P(0, a0, CE), P(9.4, a0, CE), P(9.4, a1, CE), down, [NOUV.slice(0, 2), NOUV.slice(0, 2), NOUV.slice(0, 2)], c);
      if (i >= h0 && i < h1) continue;
      hl.quad(P(9.4, a0, CE), P(RI, a0, CE), P(RI, a1, CE), P(9.4, a1, CE), down, NOUV, c);
    }
    // 金の輪と、中央の薔薇色の円
    for (const [r0, r1, color] of [[9.3, 9.5, goldC], [6.1, 6.25, goldC]]) for (let i = 0; i < N; i++) { if (r0 > 9 && i >= h0 && i < h1) continue; const a0 = i / N * TAU, a1 = (i + 1) / N * TAU; gold.quad(P(r0, a0, CE - 0.02), P(r1, a0, CE - 0.02), P(r1, a1, CE - 0.02), P(r0, a1, CE - 0.02), down, NOUV, color); }
    for (let i = 0; i < N; i++) { const a0 = i / N * TAU, a1 = (i + 1) / N * TAU; hl.quad(P(0.2, a0, CE - 0.03), P(3.6, a0, CE - 0.03), P(3.6, a1, CE - 0.03), P(0.2, a1, CE - 0.03), down, NOUV, (i & 1) ? rose : tint(rose, 0.88)); }
  }

  // ---------- シャンデリア (3 重の金の輪 + 電球) ----------
  {
    gold.box(cx, (CE + 17.2) / 2, cz, 0.14, CE - 17.2, 0.14, 0, goldC);
    const ringsC = [[3.4, 17.0, 24], [2.2, 16.0, 16], [1.0, 15.2, 8]];
    for (const [r, y, n] of ringsC) {
      const m = Math.max(12, Math.round(TAU * r / 0.7));
      for (let k = 0; k < m; k++) { const a = (k + 0.5) / m * TAU; gold.box(cx + Math.sin(a) * r, y, cz + Math.cos(a) * r, 0.12, 0.14, TAU * r / m + 0.02, a + Math.PI / 2 * 0, goldC); }
      const nl = low ? Math.round(n / 2) : n;
      for (let k = 0; k < nl; k++) { const a = (k + 0.5) / nl * TAU; lamps.push([cx + Math.sin(a) * r, y + 0.28, cz + Math.cos(a) * r, lampWarm, 0.24]); }
    }
    for (const a of [0, TAU / 3, TAU * 2 / 3]) gold.box(cx + Math.sin(a) * 2.0, (17.0 + 16.0) / 2 + 0.2, cz + Math.cos(a) * 2.0, 0.07, 1.4, 0.07, 0, goldC);
  }

  // ---------- らせん階段 (内壁ぞい。段は壁から出た石の板 = 下をくぐれる) ----------
  const NSTEP = KEEP.STEPS, da = KEEP.STEP_ANG * deg, A0 = KEEP.START * deg, rise = (TE - FL) / NSTEP, rIn = KEEP.STAIR_IN, rOut = RI + 0.02;
  const topAt = (j) => FL + (j + 1) * rise;     // j 番目の段の上面
  const railPts = [];
  for (let j = 0; j < NSTEP; j++) {
    const a0 = A0 + j * da, a1 = a0 + da, top = topAt(j), prev = j ? topAt(j - 1) : FL, bot = Math.max(top - 2, FL);
    const c = (j & 1) ? tint(cream, 0.97) : tint(cream, 0.93);
    hl.quad(P(rIn, a0, top), P(rIn, a1, top), P(rOut, a1, top), P(rOut, a0, top), up, NOUV, c);                       // 踏み面
    hl.quad(P(rIn, a0, prev), P(rOut, a0, prev), P(rOut, a0, top), P(rIn, a0, top), tangent(a0).map((v) => -v), NOUV, tint(lav, 0.98));   // 蹴上げ
    hl.quad(P(rIn, a0, bot), P(rIn, a1, bot), P(rIn, a1, top), P(rIn, a0, top), radIn(a0), NOUV, tint(shade, 0.98));   // 内側の面
    hl.quad(P(rIn, a0, bot), P(rOut, a0, bot), P(rOut, a1, bot), P(rIn, a1, bot), down, NOUV, tint(shade, 0.85));      // 裏
    if (j === NSTEP - 1) hl.quad(P(rIn, a1, bot), P(rIn, a1, top), P(rOut, a1, top), P(rOut, a1, bot), tangent(a1), NOUV, tint(lav, 0.98));
    // 手すり (内側のふち。傾いた低い壁 + 金の笠木)
    const rp = rIn + 0.06, rq = rIn - 0.06, hh = 1.05;
    hl.quad(P(rp, a0, prev), P(rp, a1, top), P(rp, a1, top + hh), P(rp, a0, prev + hh), radOut(a0), NOUV, tint(cream, 0.96));
    hl.quad(P(rq, a0, prev), P(rq, a1, top), P(rq, a1, top + hh), P(rq, a0, prev + hh), radIn(a0), NOUV, tint(cream, 0.9));
    gold.quad(P(rq - 0.02, a0, prev + hh), P(rq - 0.02, a1, top + hh), P(rp + 0.02, a1, top + hh), P(rp + 0.02, a0, prev + hh), up, NOUV, goldC);
    if (j % 6 === 2) {   // 手すりの柱と灯り
      const am = a0 + da * 0.5, [px, py, pz] = P(rIn, am, top + hh);
      gold.box(px, py + 0.25, pz, 0.14, 0.5, 0.14, am, goldC);
      lamps.push([px, py + 0.62, pz, lampWarm, 0.22]);
    }
    // 当たり判定: 段 = 扇形の箱 (下は、段の 2 m 下までふさぐ。扉の上を通る段も、扉 5.4 m より上)
    const ring = [P(rIn, a0, 0), P(rOut, a0, 0), P(rOut, a1, 0), P(rIn, a1, 0)].map(([x, , z]) => W(x, z));
    col.poly.push([ring, y0 + bot, y0 + top]);
    const [lx, , lz] = P(rIn - 0.02, a0, 0); railPts.push([lx, lz, y0 + prev]);
  }
  {
    const a = A0 + NSTEP * da, [lx, , lz] = P(rIn - 0.02, a, 0); railPts.push([lx, lz, y0 + TE]);
    const ln = [0.1, 1.0];
    for (const [x, z, y] of railPts) { const [wx, wz] = W(x, z); ln.push(wx, wz, y); }
    col.line.push(ln);
  }

  // ---------- 屋上のテラス: 床の当たり判定・手すり・階段の抜け口の柵 ----------
  {
    const N = 40, [h0, h1] = KEEP.HOLE, rin = 10.0, rout = 12.6;
    // 床 (抜け口の扇形のほかを 2 分割ずつ)
    for (let i = h1; i < N + h0; i += 2) {
      const i1 = Math.min(i + 2, N + h0), a0 = i / N * TAU, a1 = i1 / N * TAU, am = (a0 + a1) / 2, ring = [];
      for (const [r, a] of [[rin, a0], [rout, a0], [rout, am], [rout, a1], [rin, a1], [rin, am]]) { const [x, , z] = P(r, a, 0); ring.push(W(x, z)); }
      col.poly.push([ring, y0 + TE - 0.7, y0 + TE]);
    }
    // 外のふちの手すり (全周)
    const ln = [0.18, 1.0], M = 48;
    for (let k = 0; k <= M; k++) { const a = k / M * TAU, [x, , z] = P(12.35, a, 0), [wx, wz] = W(x, z); ln.push(wx, wz, y0 + TE); }
    col.line.push(ln);
    // 抜け口の端の柵 (a = 288 度。テラスを歩いてきた人が穴へ落ちない)
    const a = h0 / N * TAU;
    for (const r of [10.1, 11.3, 12.5]) { const [x, y, z] = P(r, a, TE + 0.5); trim.box(x, y, z, 0.16, 1.0, 0.16, a, cream, NOUV, false); }
    { const [x, y, z] = P(11.3, a, TE + 1.0); gold.box(x, y, z, 0.14, 0.1, 2.5, a, goldC); }
    { const [x, y, z] = P(11.3, a, TE + 0.45); trim.box(x, y, z, 0.1, 0.9, 2.3, a, tint(cream, 0.94), NOUV, false); }
    const [x0, , z0] = P(10.0, a, 0), [x1, , z1] = P(12.5, a, 0), [w0x, w0z] = W(x0, z0), [w1x, w1z] = W(x1, z1);
    col.line.push([0.12, 1.0, w0x, w0z, y0 + TE, w1x, w1z, y0 + TE]);
    lamps.push([...P(10.1, a, TE + 1.25), lampWarm, 0.26], [...P(12.5, a, TE + 1.25), lampWarm, 0.26]);
    {   // 階段の出口 (a = 0 度) の外のふちの帯 (r 11.4〜12.5)。ここから穴の側へ入り込めないようにする (階段のほうは開けておく)
      const [x0, , z0] = P(11.4, 0, 0), [x1, , z1] = P(12.5, 0, 0), [a0x, a0z] = W(x0, z0), [a1x, a1z] = W(x1, z1);
      col.line.push([0.12, 1.0, a0x, a0z, y0 + TE, a1x, a1z, y0 + TE]);
      for (const r of [11.5, 12.45]) { const [x, y, z] = P(r, 0, TE + 0.5); trim.box(x, y, z, 0.16, 1.0, 0.16, 0, cream, NOUV, false); }
      { const [x, y, z] = P(11.97, 0, TE + 1.0); gold.box(x, y, z, 0.14, 0.1, 1.1, 0, goldC); }
    }
  }

  // ---------- 正面の入口 (石の枠・両開きの扉・敷居) ----------
  {
    const zc = cz + 11.95, dw = KEEP.DOOR_W, dh = KEEP.DOOR_H;
    for (const sd of [-1, 1]) {
      trim.box(cx + sd * (dw / 2 + 0.3), FL + 2.75, zc, 0.6, 5.5, 1.5, 0, cream);
      trim.box(cx + sd * (dw / 2 + 0.78), FL + 2.0, zc + 0.5, 0.36, 4.0, 0.6, 0, tint(cream, 0.95));
      const [bx, bz] = W(cx + sd * (dw / 2 + 0.5), zc);
      col.box.push([bx, bz, K.yaw, 0.5, 0.85, y0 - 1, y0 + 22.7]);
    }
    trim.box(cx, FL + dh + 0.35, zc, dw + 1.2, 0.7, 1.5, 0, cream);                  // まぐさ
    gold.box(cx, FL + dh + 0.12, zc + 0.78, dw + 1.0, 0.14, 0.08, 0, goldC);           // 金の線
    trim.box(cx, FL - 0.02, zc, dw, 0.1, 1.5, 0, tint(lav, 1.0));                       // 敷居
    for (const sd of [-1, 1]) lamps.push([cx + sd * (dw / 2 + 0.78), FL + 4.3, zc + 0.95, lampWarm, 0.3]);
    // 扉 (木の板 + 金の帯。内側 (-z) へ開く。doors.js が動かす)
    const tex = canvasTexture(128, 256, (g, Wt, Ht) => {
      g.fillStyle = '#5a3a2e'; g.fillRect(0, 0, Wt, Ht);
      for (let x = 6; x < Wt; x += 16) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, 0, 2, Ht); }
      g.fillStyle = '#e6bf5a'; for (const y of [0.16, 0.5, 0.84]) g.fillRect(0, Ht * y, Wt, 7);
      g.fillStyle = '#e6bf5a'; g.fillRect(Wt - 12, Ht * 0.5, 5, 30);     // 取っ手
      g.fillStyle = '#2c3a66'; g.fillRect(14, 14, Wt - 28, 36);          // 上の明かり取り
    });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.1 });
    const leaves = [], lw = dw / 2 - 0.004;
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(cx + sx * dw / 2, FL, zc - 0.06);
      const m = new THREE.Mesh(new THREE.BoxGeometry(lw, dh, 0.1).translate(-sx * lw / 2, dh / 2, 0), mat); m.castShadow = true; pivot.add(m);
      group.add(pivot); leaves.push({ pivot, sign: -sx });
    }
    const [dx, dz] = W(cx, zc), [fx, fz] = W(cx, zc + 1), nl = Math.hypot(fx - dx, fz - dz);
    DOORS.push({ x: dx, z: dz, y: y0 + FL, nx: (fx - dx) / nl, nz: (fz - dz) / nl, w: dw, h: dh, leaves });
  }

  // 外のかべの当たり判定 (扉のところだけ開ける)。1 段目の上端 = テラスの床の高さまで
  {
    const ln = [0.75, 24.0], M = 57;
    for (let k = 0; k < M; k++) { const a = (12 + k * 6) * deg, [x, , z] = P(12.2, a, 0), [wx, wz] = W(x, z); ln.push(wx, wz, y0 - 1); }
    ln[1] = TE + 1;   // 上端 = (y0 - 1) + h = y0 + TE
    col.line.push(ln);
  }
  return out;
}
