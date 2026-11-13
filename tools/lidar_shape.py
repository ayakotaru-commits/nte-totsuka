"""点群の高さ格子 (fetch_lidar.py が作る data/raw/lidar_dsm.bin) から、建物の形を実測に合わせて作り直す。

build_city.py から apply() が呼ばれる (高さ格子があるときだけ)。単体でも動く:
    python tools/lidar_shape.py          public/data/city.json にその場で適用 (何度実行しても同じ結果)
    python tools/lidar_shape.py --undo   適用前に戻す

建物1棟ごとの処理:
 1. 輪郭の中を、建物の向きにそろえた 0.5 m のマスに分け、各マスの屋根の高さを読む
 2. 高さがなだらかにつながるマスをまとめて「部分」に分ける (2階建ての母屋と平屋の下屋、ビルの低層部と高層部、塔屋など)
 3. 地面の高さしかない部分は建物から除く (中庭、輪郭が実際より大きい所)
 4. 部分ごとに屋根の形を当てはめる: 平ら / 切妻 / 寄棟 / 片流れ (向き・勾配・軒の高さ)
 5. 低い段から順に「その高さ以上の所」の輪郭を作って積み上げる。上の段は別の建物データ (part) として追加し、
    minH = 下の段の高さ にするので、壁は下から上まで1枚につながる
標準ライブラリのみ。
"""
import array
import json
import math
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DSM_BIN = ROOT / "data" / "raw" / "lidar_dsm.bin"
DSM_META = ROOT / "data" / "raw" / "lidar_dsm.json"
CITY = ROOT / "public" / "data" / "city.json"
TERRAIN = ROOT / "public" / "data" / "terrain.json"

STEP_TOL = 0.7      # 隣のマスとの高さの差がこれ以下ならつながっているとみなす (m)
MERGE_TOL = 1.0     # 隣り合う部分の高さの差がこれ未満なら1つにまとめる (m)
LEVEL_TOL = 0.8     # 段の高さがこれ未満の差なら同じ段にする (m)
VOID_H = 2.0        # これより低い部分は建物ではない (地面・中庭)
MIN_PART = 6.0      # これより小さい部分は隣にまとめる (m2)
SKIP_STYLES = {"carport", "gate", "hall"}


# ---------------------------------------------------------------- 高さ格子
class DSM:
    def __init__(self, bin_path=DSM_BIN, meta_path=DSM_META):
        m = json.loads(pathlib.Path(meta_path).read_text(encoding="utf-8"))
        self.res, self.x0, self.z0, self.nx, self.nz, self.nodata = m["res"], m["minX"], m["minZ"], m["nx"], m["nz"], m["nodata"]
        self.a = array.array("h")
        self.a.frombytes(pathlib.Path(bin_path).read_bytes())
        if sys.byteorder != "little":
            self.a.byteswap()

    def get(self, x, z):
        """(x, z) の標高 (m)。データ無しは None"""
        i, j = int((x - self.x0) / self.res), int((z - self.z0) / self.res)
        if i < 0 or j < 0 or i >= self.nx or j >= self.nz:
            return None
        v = self.a[j * self.nx + i]
        return None if v == self.nodata else v / 100


# ---------------------------------------------------------------- 幾何の小道具
def area2(r):
    return sum(r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1] for i in range(len(r)))


def point_in(p, ring):
    x, y = p
    c = False
    for i in range(len(ring)):
        (x1, y1), (x2, y2) = ring[i - 1], ring[i]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def median(v):
    s = sorted(v)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def clip_rect(ring, p0, p1, q0, q1):
    """多角形を長方形で切り取る (Sutherland-Hodgman)。へこんだ多角形では長方形の辺の上に
    行って戻る辺ができるが、あとの「辺の打ち消し」で消える"""
    for axis, lim, keep_ge in ((0, p0, True), (0, p1, False), (1, q0, True), (1, q1, False)):
        if not ring:
            return ring
        out = []
        for i in range(len(ring)):
            a, b = ring[i - 1], ring[i]
            ia = (a[axis] >= lim) if keep_ge else (a[axis] <= lim)
            ib = (b[axis] >= lim) if keep_ge else (b[axis] <= lim)
            if ia != ib:
                t = (lim - a[axis]) / (b[axis] - a[axis])
                m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
                m[axis] = lim
                out.append((m[0], m[1]))
            if ib:
                out.append(b)
        ring = out
    return ring


def dissolve(pieces, p0, q0, cs):
    """格子の線で切った多角形のかけらを、共有する辺を打ち消して1つの輪郭 (外周と穴) にまとめる。
    pieces: 向きのそろった輪 (外周は反時計回り, 穴は時計回り) のリスト。戻り値: 輪のリスト"""
    EPS = 1e-6
    lines = {}   # (軸, 格子線の番号) -> [(t0, t1)] 向き付き
    free = []    # 格子線に乗らない辺 (元の輪郭の辺)
    for ring in pieces:
        for i in range(len(ring)):
            a, b = ring[i - 1], ring[i]
            if abs(a[0] - b[0]) < EPS and abs(a[1] - b[1]) < EPS:
                continue
            done = False
            for axis, o in ((0, p0), (1, q0)):
                if abs(a[axis] - b[axis]) < EPS:
                    k = (a[axis] - o) / cs
                    if abs(k - round(k)) < 1e-5:
                        lines.setdefault((axis, round(k)), []).append((a[1 - axis], b[1 - axis]))
                        done = True
                        break
            if not done:
                free.append((a, b))
    edges = list(free)
    for (axis, k), segs in lines.items():
        c = (p0 if axis == 0 else q0) + k * cs
        ts = sorted({round(t, 5) for s in segs for t in s})
        for t0, t1 in zip(ts, ts[1:]):
            mid = (t0 + t1) / 2
            net = sum((1 if s[1] > s[0] else -1) for s in segs if min(s) - EPS < mid < max(s) + EPS)
            if net:
                lo, hi = (t0, t1) if net > 0 else (t1, t0)
                a, b = ((c, lo), (c, hi)) if axis == 0 else ((lo, c), (hi, c))
                edges.append((a, b))
    key = lambda p: (round(p[0], 4), round(p[1], 4))
    out_e = {}
    for a, b in edges:
        if key(a) != key(b):
            out_e.setdefault(key(a), []).append(b)
    rings = []
    while out_e:
        start = next(iter(out_e))
        ring, cur, prev = [], start, None
        for _ in range(100000):
            nxts = out_e.get(cur)
            if not nxts:
                break
            if len(nxts) == 1 or prev is None:
                nb = nxts.pop(0)
            else:  # 分かれ道では一番右に曲がる辺を選ぶ (輪が1点で接するとき、別々の輪に分ける)
                dx, dy = cur[0] - prev[0], cur[1] - prev[1]
                ang = lambda b: math.atan2(dx * (b[1] - cur[1]) - dy * (b[0] - cur[0]), dx * (b[0] - cur[0]) + dy * (b[1] - cur[1]))
                nb = min(nxts, key=ang)
                nxts.remove(nb)
            if not nxts:
                del out_e[cur]
            ring.append(cur)
            prev, cur = cur, key(nb)
            if cur == start:
                break
        if len(ring) >= 3 and cur == start:
            rings.append(ring)
    # 一直線上の頂点を除く
    res = []
    for ring in rings:
        r = []
        n = len(ring)
        for i in range(n):
            a, b, c = ring[i - 1], ring[i], ring[(i + 1) % n]
            if abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) > 1e-6:
                r.append(b)
        if len(r) >= 3:
            res.append(r)
    return res


# ---------------------------------------------------------------- 屋根の当てはめ
def fit_roof(cells, cs):
    """cells: [(p, q, h)] (建物の向きにそろえた座標, 基礎からの高さ)。長方形に近い部分に屋根の形を当てはめる。
    戻り値: None (平ら) または {"t", "rise", "eave", "axis" (棟の向き 0 = p 軸, 1 = q 軸), "pc", "qc", "lp", "lq", "up"}"""
    n = len(cells)
    if n < 12:
        return None
    ps, qs = [c[0] for c in cells], [c[1] for c in cells]
    pmin, pmax, qmin, qmax = min(ps) - cs / 2, max(ps) + cs / 2, min(qs) - cs / 2, max(qs) + cs / 2
    lp, lq = pmax - pmin, qmax - qmin
    if n * cs * cs < 0.78 * lp * lq or min(lp, lq) < 3.0:
        return None  # 長方形に近くない / 細すぎる
    pc, qc = (pmin + pmax) / 2, (qmin + qmax) / 2
    hs = [c[2] for c in cells]
    med = median(hs)
    # 輪郭の端のマスは地面や隣の屋根を拾うことがあるので、外れたマスを除きながら当てはめる
    keep0 = [i for i in range(n) if abs(hs[i] - med) <= 3.0]

    def lsq(ds):
        """h = e + k * d を当てはめる。戻り値 (e, k, rms, 使ったマスの割合)"""
        use = keep0
        res = None
        for it in range(3):
            m = len(use)
            if m < 0.6 * n:
                return None
            md = sum(ds[i] for i in use) / m
            mh = sum(hs[i] for i in use) / m
            sdd = sum((ds[i] - md) ** 2 for i in use)
            k = sum((ds[i] - md) * (hs[i] - mh) for i in use) / sdd if sdd > 1e-9 else 0.0
            e = mh - k * md
            rms = math.sqrt(sum((e + k * ds[i] - hs[i]) ** 2 for i in use) / m)
            res = (e, k, rms, m / n)
            if it < 2:
                lim = max(0.45, 2.0 * rms)
                use = [i for i in keep0 if abs(e + k * ds[i] - hs[i]) <= lim]
        return res

    flat = lsq([0.0] * n)
    if not flat:
        return None
    rms_flat = flat[2]
    dq = [lq / 2 - abs(q - qc) for q in qs]  # 長い辺 (p 方向の辺) までの距離
    dp = [lp / 2 - abs(p - pc) for p in ps]
    cands = []
    for t, axis, ds, dmax in (("gable", 0, dq, lq / 2), ("gable", 1, dp, lp / 2),
                              ("hip", 0 if lp >= lq else 1, [min(a, b) for a, b in zip(dp, dq)], min(lp, lq) / 2)):
        r = lsq(ds)
        if r and 0.1 <= r[1] <= 1.3 and r[3] >= 0.8:
            cands.append((r[2] * (1.0 if t == "gable" else 1.05), t, axis, r[0], r[1] * dmax, 0))
    # 棟が中心からずれた切妻 (両側の軒の高さは同じで、勾配が違う)。d = 軒から棟までを 0..1 にした値
    for axis, vs, lo, span in ((0, qs, qmin, lq), (1, ps, pmin, lp)):
        for off in (-0.3, -0.2, -0.1, 0.1, 0.2, 0.3):
            rg = lo + span * (0.5 + off / 2)   # 棟の位置
            ds = [(v - lo) / (rg - lo) if v < rg else (lo + span - v) / (lo + span - rg) for v in vs]
            r = lsq(ds)
            if r and r[3] >= 0.8 and 0.1 <= r[1] / (span / 2 * (1 + abs(off))) and r[1] / (span / 2 * (1 - abs(off))) <= 1.3:
                cands.append((r[2] * 1.04, "gable", axis, r[0], r[1], off * span / 2))
    for axis, ds, span in ((0, [q - qmin for q in qs], lq), (1, [p - pmin for p in ps], lp)):  # 片流れ (棟 = 高い側の辺)
        r = lsq(ds)
        if r and 0.06 <= abs(r[1]) <= 1.0 and r[3] >= 0.8:
            e, k = r[0], r[1]
            cands.append((r[2] * 1.02, "shed", axis, e if k > 0 else e + k * span, abs(k) * span, 1 if k > 0 else -1))
    if not cands:
        return None
    rms, t, axis, eave, rise, up = min(cands)
    if rise < 0.45 or rms > 0.4 or rms > 0.75 * rms_flat or eave < 1.8:
        return None
    off = 0.0
    if t == "gable" and up:   # up に棟のずれ (m) を入れてある
        off, up = up, 0
    return {"t": t, "rise": rise, "eave": eave, "axis": axis, "pc": pc, "qc": qc, "lp": lp, "lq": lq, "up": up, "off": off}


def split_rects(cells, cs, max_n=3, min_area=12.0, min_side=3.0):
    """L 字やコの字の部分を、大きい順に最大 max_n 個の長方形に分ける。戻り値: マスのリストのリスト"""
    p0, q0 = min(c[0] for c in cells), min(c[1] for c in cells)
    grid = {(round((c[0] - p0) / cs), round((c[1] - q0) / cs)): c for c in cells}
    nc = max(k[0] for k in grid) + 1
    nr = max(k[1] for k in grid) + 1
    out = []
    for _ in range(max_n):
        best = None  # (面積, i0, i1, j0, j1)。行ごとの「上に続くマス数」のヒストグラムから最大の長方形を探す
        hgt = [0] * nc
        for j in range(nr):
            for i in range(nc):
                hgt[i] = hgt[i] + 1 if (i, j) in grid else 0
            stack = []
            for i in range(nc + 1):
                cur = hgt[i] if i < nc else 0
                start = i
                while stack and stack[-1][1] >= cur:
                    start, hh = stack.pop()
                    a = hh * (i - start)
                    if best is None or a > best[0]:
                        best = (a, start, i, j - hh + 1, j + 1)
                stack.append((start, cur))
        if not best or best[0] * cs * cs < min_area or min(best[2] - best[1], best[4] - best[3]) * cs < min_side:
            break
        _, i0, i1, j0, j1 = best
        out.append([grid.pop((i, j)) for j in range(j0, j1) for i in range(i0, i1)])
        if not grid:
            break
    return out


# ---------------------------------------------------------------- 1棟の処理
def default_floors(style, h):
    if style == "house":
        return 1 if h < 5.5 else 2 if h < 9.5 else 3
    if style == "apartment":
        return max(1, round((h - 0.5) / 2.95))
    if style in ("commercial", "public"):
        return max(1, round(h / 3.8))
    if style in ("industrial", "lowrise"):
        return 1 if h < 10 else max(2, round(h / 4.5))
    if style == "parking":
        return max(1, round(h / 3.0))
    return 1


def shape_building(b, dsm, ref, floors_for=default_floors):
    """b を実測の形に直し、追加する建物データ (上の段など) のリストを返す。直せないときは None (b はそのまま)"""
    outer, holes = b["outer"], b.get("holes") or []
    area = abs(area2(outer)) / 2 - sum(abs(area2(h)) / 2 for h in holes)
    if area < 8:
        return None
    base = b.get("y", 0.0)
    # 建物の向き: 辺の向きを 90 度ごとに同一視して長さで重み付け平均
    sx = sy = 0.0
    for i in range(len(outer)):
        (x1, z1), (x2, z2) = outer[i - 1], outer[i]
        L = math.hypot(x2 - x1, z2 - z1)
        if L > 0:
            th = math.atan2(z2 - z1, x2 - x1)
            sx += L * math.cos(4 * th)
            sy += L * math.sin(4 * th)
    th = math.atan2(sy, sx) / 4
    c, s = math.cos(th), math.sin(th)
    fwd = lambda x, z: (x * c + z * s, -x * s + z * c)
    inv = lambda p, q: (p * c - q * s, p * s + q * c)
    rings = [[fwd(x, z) for x, z in r] for r in [outer] + holes]
    # 向きをそろえる: 外周 = 反時計回り (面積 > 0), 穴 = 時計回り
    rings = [(r if (area2(r) > 0) == (k == 0) else r[::-1]) for k, r in enumerate(rings)]
    cs = 0.5 if area < 1500 else 1.0 if area < 9000 else 1.5
    p0 = min(p for p, _ in rings[0]) - cs   # まわりに1マスの余白
    q0 = min(q for _, q in rings[0]) - cs
    nc = int(math.ceil((max(p for p, _ in rings[0]) - p0) / cs)) + 1
    nr = int(math.ceil((max(q for _, q in rings[0]) - q0) / cs)) + 1
    N = nc * nr
    inside = bytearray(N)
    for j in range(nr):  # 走査線で内外判定 (マスの中心)
        qc = q0 + (j + 0.5) * cs
        xs = []
        for r in rings:
            for i in range(len(r)):
                (p1, q1), (p2, q2) = r[i - 1], r[i]
                if (q1 > qc) != (q2 > qc):
                    xs.append(p1 + (p2 - p1) * (qc - q1) / (q2 - q1))
        xs.sort()
        for a, bb in zip(xs[0::2], xs[1::2]):
            for i in range(max(0, int(math.ceil((a - p0) / cs - 0.5))), min(nc, int(math.floor((bb - p0) / cs - 0.5)) + 1)):
                inside[j * nc + i] = 1
    idx = [k for k in range(N) if inside[k]]
    if len(idx) < 12:
        return None
    # 高さ (基礎から)
    h = [None] * N
    sub = [(0.5, 0.5)] if cs == 0.5 else [(a, bb) for a in (0.25, 0.75) for bb in (0.25, 0.75)]
    for k in idx:
        j, i = divmod(k, nc)
        best = None
        for a, bb in sub:
            x, z = inv(p0 + (i + a) * cs, q0 + (j + bb) * cs)
            v = dsm.get(x, z)
            if v is not None and (best is None or v > best):
                best = v
        if best is not None:
            h[k] = best - ref - base
    valid = [h[k] for k in idx if h[k] is not None]
    if len(valid) < 0.5 * len(idx):
        return None
    vs = sorted(valid)
    if vs[int(len(vs) * 0.8)] < 2.2:
        return None  # 測量の時点で建っていなかった (新築) か、取り壊し済み。元のデータのまま
    nb8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

    def around(k):
        j, i = divmod(k, nc)
        return [(j + dj) * nc + i + di for dj, di in nb8 if 0 <= j + dj < nr and 0 <= i + di < nc and inside[(j + dj) * nc + i + di]]

    for _ in range(8):  # データの無いマスをまわりの中央値で埋める
        todo = [k for k in idx if h[k] is None]
        if not todo:
            break
        fill = {}
        for k in todo:
            v = [h[m] for m in around(k) if h[m] is not None]
            if v:
                fill[k] = median(v)
        if not fill:
            break
        for k, v in fill.items():
            h[k] = v
    med_all = median(valid)
    for k in idx:
        if h[k] is None:
            h[k] = med_all
    sm = list(h)  # 3x3 の中央値 (アンテナや測り漏れを消す。段差の線は鈍らない)
    for k in idx:
        sm[k] = median([h[m] for m in around(k)] + [h[k]])
    h = sm

    # ---- なだらかにつながるマスをまとめる
    label = [-1] * N
    regs = []  # 各部分のマスの一覧
    for k in idx:
        if label[k] >= 0:
            continue
        r = len(regs)
        label[k] = r
        stack, cells = [k], []
        while stack:
            m = stack.pop()
            cells.append(m)
            j, i = divmod(m, nc)
            for mm in ((m - 1) if i > 0 else -1, (m + 1) if i < nc - 1 else -1, m - nc, m + nc):
                if 0 <= mm < N and inside[mm] and label[mm] < 0 and abs(h[mm] - h[m]) <= STEP_TOL:
                    label[mm] = r
                    stack.append(mm)
        regs.append(cells)

    def borders():
        bd = {}
        for k in idx:
            j, i = divmod(k, nc)
            for mm in ((k + 1) if i < nc - 1 else -1, k + nc):
                if 0 <= mm < N and inside[mm] and label[mm] != label[k]:
                    a, bb = label[k], label[mm]
                    bd.setdefault(a, {})[bb] = bd.get(a, {}).get(bb, 0) + 1
                    bd.setdefault(bb, {})[a] = bd.get(bb, {}).get(a, 0) + 1
        return bd

    def merge(a, into, bd):
        for m in regs[a]:
            label[m] = into
        regs[into].extend(regs[a])
        regs[a] = []
        for o, n in bd.pop(a, {}).items():
            bd[o].pop(a, None)
            if o != into:
                bd[o][into] = bd[o].get(into, 0) + n
                bd.setdefault(into, {})[o] = bd[into].get(o, 0) + n

    bd = borders()
    min_cells = min(max(MIN_PART, 0.015 * area), 25.0) / (cs * cs)
    while True:  # 小さい部分を、一番長く接している隣にまとめる
        small = [r for r in range(len(regs)) if regs[r] and len(regs[r]) < min_cells and bd.get(r)]
        if not small:
            break
        r = min(small, key=lambda r: len(regs[r]))
        merge(r, max(bd[r], key=bd[r].get), bd)
    hmed = {r: median([h[m] for m in regs[r]]) for r in range(len(regs)) if regs[r]}
    while True:  # 高さの近い隣どうしをまとめる
        best = None
        for a in bd:
            for o in bd[a]:
                if a < o and (hmed[a] >= VOID_H) == (hmed[o] >= VOID_H):
                    d = abs(hmed[a] - hmed[o])
                    if d < MERGE_TOL and (best is None or d < best[0]):
                        best = (d, a, o)
        if not best:
            break
        _, a, o = best
        na, no = len(regs[a]), len(regs[o])
        merge(o, a, bd)
        hmed[a] = (hmed[a] * na + hmed.pop(o) * no) / (na + no)

    live = [r for r in hmed if hmed[r] >= VOID_H]
    if not live:
        return None
    void = [r for r in hmed if hmed[r] < VOID_H]

    # ---- 部分ごとの屋根と段の高さ
    roofs = {}
    for r in live:
        cells = [(p0 + (m % nc + 0.5) * cs, q0 + (m // nc + 0.5) * cs, h[m]) for m in regs[r]]
        if 20 <= len(cells) * cs * cs <= 700:
            f = fit_roof(cells, cs)
            if f:
                roofs[r] = [f]
            else:  # L 字など: 長方形に分けて、それぞれに屋根を当てはめる
                ps_, qs_ = [c_[0] for c_ in cells], [c_[1] for c_ in cells]
                if len(cells) * cs * cs < 0.78 * (max(ps_) - min(ps_) + cs) * (max(qs_) - min(qs_) + cs):
                    fs = [f for f in (fit_roof(rc, cs) for rc in split_rects(cells, cs)) if f]
                    if fs:
                        roofs[r] = fs

    def eave_of(r):
        fs = roofs[r]
        return sum(f["eave"] * f["lp"] * f["lq"] for f in fs) / sum(f["lp"] * f["lq"] for f in fs)

    level = {r: (eave_of(r) if r in roofs else hmed[r]) for r in live}
    # 近い高さを同じ段にまとめる
    order = sorted(live, key=lambda r: level[r])
    groups = [[order[0]]]
    for r in order[1:]:
        if level[r] - level[groups[-1][0]] < LEVEL_TOL:
            groups[-1].append(r)
        else:
            groups.append([r])
    levels = []
    for g in groups:
        w = sum(len(regs[r]) for r in g)
        lv = round(sum(level[r] * len(regs[r]) for r in g) / w, 1)
        levels.append(lv)
        for r in g:
            level[r] = lv

    def roof_out(f, at_level):
        u = (c, s) if f["axis"] == 0 else (-s, c)
        cx, cz = inv(f["pc"], f["qc"])
        ln, wd = (f["lp"], f["lq"]) if f["axis"] == 0 else (f["lq"], f["lp"])
        o = {"t": f["t"], "rise": round(f["rise"], 2), "u": [round(u[0], 4), round(u[1], 4)], "c": [round(cx, 2), round(cz, 2)],
             "len": round(ln, 2), "wid": round(wd, 2)}
        # 描く側の横方向 t = (-uz, ux)。axis 0 では t = +q、axis 1 では t = -p
        if f["t"] == "shed":
            o["up"] = f["up"] if f["axis"] == 0 else -f["up"]
        if f.get("off"):
            o["off"] = round(f["off"] if f["axis"] == 0 else -f["off"], 2)
        return o

    old_h = b["h"]
    b["lidar"] = {"h0": old_h}
    if "roof" in b:
        b["lidar"]["roof0"] = b.pop("roof")
    style = b.get("style")

    # ---- 1つの部分だけ・欠けなし: 輪郭はそのまま、高さと屋根だけ直す
    if len(live) == 1 and not void:
        r = live[0]
        if r in roofs and len(roofs[r]) == 1:
            b["roof"] = roof_out(roofs[r][0], level[r])
            b["h"] = round(level[r] + roofs[r][0]["rise"], 1)
        elif r in roofs:  # L 字など: 壁は軒の高さまで、屋根は長方形ごと
            b["h"] = round(level[r], 1)
            b["roofs"] = [roof_out(f, level[r]) for f in roofs[r]]
        else:
            b["h"] = max(2.2, round(level[r], 1))
        if style:
            b["floors"] = floors_for(style, b["h"])
        return []

    # ---- 段ごとの輪郭 (その段の高さ以上の所)
    def polygons(mask_regs):
        mask = bytearray(N)
        for r in mask_regs:
            for m in regs[r]:
                mask[m] = 1
        # 輪郭の外のマスのうち、対象のマスに接するものも窓に含める (輪郭の端の切れ残りを拾う。輪郭で切り取るのではみ出さない)
        ext = bytearray(mask)
        for k in range(N):
            if not inside[k]:
                j, i = divmod(k, nc)
                for dj, di in nb8:
                    jj, ii = j + dj, i + di
                    if 0 <= jj < nr and 0 <= ii < nc and mask[jj * nc + ii]:
                        ext[k] = 1
                        break
        pieces = []
        for j in range(nr):
            i = 0
            while i < nc:
                if not ext[j * nc + i]:
                    i += 1
                    continue
                i0 = i
                while i < nc and ext[j * nc + i]:
                    i += 1
                for ring in rings:
                    cl = clip_rect(ring, p0 + i0 * cs, p0 + i * cs, q0 + j * cs, q0 + (j + 1) * cs)
                    if len(cl) >= 3:
                        pieces.append(cl)
        rs = dissolve(pieces, p0, q0, cs)
        outs = [r for r in rs if area2(r) > 0 and area2(r) / 2 >= 2.5]
        hls = [r for r in rs if area2(r) < 0 and -area2(r) / 2 >= 1.0]
        res = []
        for o in sorted(outs, key=lambda r: -area2(r)):
            mine = [hh for hh in hls if point_in(((hh[0][0] + hh[1][0]) / 2, (hh[0][1] + hh[1][1]) / 2), o)
                    and -area2(hh) < area2(o)]
            # 入れ子の外周 (穴の中の島) に取られないよう、いちばん小さい外周に属させる
            res.append([o, mine])
        for a in res:
            for bb in res:
                if a is not bb and area2(bb[0]) < area2(a[0]):
                    a[1] = [hh for hh in a[1] if hh not in bb[1]]
        to_world = lambda r: [[round(v, 2) for v in inv(p, q)] for p, q in r]
        return [(to_world(o), [to_world(hh) for hh in hl], o) for o, hl in res]

    new = []
    n_part = 0
    for li, lv in enumerate(levels):
        members = [r for r in live if level[r] >= lv - 1e-9]
        if li == 0 and not void:
            polys = [(outer, holes, rings[0])]
        else:
            polys = polygons(members)
        low = levels[li - 1] if li else 0.0
        here = [r for r in live if abs(level[r] - lv) < 1e-9 and r in roofs]
        for pi, (o, hl, o_pq) in enumerate(polys):
            if li == 0 and pi == 0:
                rec = b
            else:
                n_part += 1
                rec = {k: b[k] for k in ("src", "code", "kind", "style", "color", "y", "e") if k in b}
                rec["id"] = f'{b["id"]}#{n_part}'
                rec["part"] = b["id"]
                new.append(rec)
            rec["outer"] = o
            if hl:
                rec["holes"] = hl
            else:
                rec.pop("holes", None)
            rec["h"] = max(round(lv, 1), round(low + 0.3, 1))
            if li:
                rec["minH"] = round(low, 1)
                a_m2 = abs(area2(o_pq)) / 2
                if a_m2 < 30 or lv - low < 2.4:
                    rec["plain"] = True   # 塔屋・設備など: 窓なしの壁
            if style:
                rec["floors"] = floors_for(style, lv - low) if not (style == "house" and li) else 1
            # この輪郭の中にある屋根
            rf = [roof_out(f, lv) for r in here for f in roofs[r] if point_in((f["pc"], f["qc"]), o_pq)]
            if rf:
                rec["roofs"] = rf
            else:
                rec.pop("roofs", None)
    if not b.get("outer") or len(b["outer"]) < 3:
        return None
    b["lidar"]["outer0"] = outer
    if holes:
        b["lidar"]["holes0"] = holes
    return new


# ---------------------------------------------------------------- 全体
def restore(buildings):
    """前回の適用を元に戻す (単体実行を何度しても同じ結果になるように)"""
    out = []
    for b in buildings:
        if b.get("part"):
            continue
        l = b.pop("lidar", None)
        if l:
            b["h"] = l["h0"]
            b.pop("roof", None)
            b.pop("roofs", None)
            if "roof0" in l:
                b["roof"] = l["roof0"]
            if "outer0" in l:
                b["outer"] = l["outer0"]
                b.pop("holes", None)
                if "holes0" in l:
                    b["holes"] = l["holes0"]
            if "floors0" in l:
                b["floors"] = l["floors0"]
        out.append(b)
    return out


def apply(buildings, ref, floors_for=default_floors, dsm=None, only=None):
    """buildings (基礎の高さ y 付き) を直し、上の段を追加したリストを返す。ref = terrain.json の基準標高"""
    dsm = dsm or DSM()
    out, st = [], {"shaped": 0, "parts": 0, "pitched": 0, "kept": 0}
    for b in buildings:
        out.append(b)
        if (b.get("minH") or b.get("style") in SKIP_STYLES or b.get("facade") or b.get("src") == "appearance"
                or b.get("fixed") or (only and not only(b))):
            st["kept"] += 1
            continue
        f0 = b.get("floors")
        try:
            new = shape_building(b, dsm, ref, floors_for)
        except Exception as ex:  # noqa: BLE001  1棟の失敗で全体を止めない
            print(f"  lidar: {b.get('id')} skipped ({ex})")
            new = None
        if new is None:
            l = b.pop("lidar", None)
            if l and "roof0" in l:
                b["roof"] = l["roof0"]
            st["kept"] += 1
            continue
        if f0 is not None:
            b["lidar"]["floors0"] = f0
        st["shaped"] += 1
        st["parts"] += len(new)
        st["pitched"] += sum(1 for r in [b] + new if r.get("roof") or r.get("roofs"))
        out.extend(new)
    print(f"lidar: 形を直した建物 {st['shaped']} / 追加した段 {st['parts']} / 勾配屋根 {st['pitched']} / 元のまま {st['kept']}")
    return out


def main():
    city = json.loads(CITY.read_text(encoding="utf-8"))
    city["buildings"] = restore(city["buildings"])
    if "--undo" not in sys.argv:
        if not DSM_BIN.exists():
            raise SystemExit("data/raw/lidar_dsm.bin がありません。先に python tools/fetch_lidar.py を実行してください")
        ref = json.loads(TERRAIN.read_text(encoding="utf-8"))["ref"] if TERRAIN.exists() else 0.0
        city["buildings"] = apply(city["buildings"], ref)
        note = "建物の形: 神奈川県 3次元点群データ (CC BY 4.0)"
        if note not in city.get("attribution", ""):
            city["attribution"] = city.get("attribution", "") + " / " + note
    CITY.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"-> {CITY} ({CITY.stat().st_size // 1024} KB, buildings={len(city['buildings'])})")


if __name__ == "__main__":
    main()
