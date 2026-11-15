"""駅前の人工地盤 (広場) の縁を、斜面ではなく「縁の床 + 手すり」にする。terrain_bridges.py から呼ばれる。

広場 (例: 戸塚駅西口のバスセンターの上、高さ約 3 m) は橋のデータに無く、地形の盛り上がりとして入っている。
地形は 2 m 間隔でぼやけているので、縁が斜面になり、明かり取りの穴がすり鉢状にへこむ。
- 点群の表面 (1 m 格子) から「高い面」(周りの低い地面より 2 m 以上高く、近くの地形の高さと同じ。建物・屋根・木・車は除く) を取る
- 歩行者用の橋・デッキから 6 m 以内に届く、150 m2 以上のかたまりだけを広場とみなす (駅前のデッキまわりに限る)
- かたまりの輪郭 (穴も) のうち、外側が 2 m 以上低い所を「縁」とし、直線にならす
- 縁に沿って、内側に幅 2.5 m の床 (歩行者用の橋と同じ形。roads に edge: 1 を付けて足す) を置く。手すりは build_props.py が付ける
- 縁の外側の地形を下の地面まで落とし、床の下だけで広場の高さへ上げる (斜面は床の下に隠れる)
元の地形は terrain.json の patch_edges に控える。足した床は roads の edge: 1 (作り直すたびに消してから足す)。
"""
import math

import numpy as np

RES = 1.0          # 作業用の格子 (m)
NEAR = 60.0        # 歩行者用の橋からこの距離までを調べる
DROP = 2.0         # 縁とみなす段差 (m)
MIN_AREA = 150     # 広場とみなす広さ (m2)
FLAT = 1.2         # 広場とみなす平らさ (かたまりの中の高さの 10%〜90% の幅, m)
MIN_RUN = 5.0      # 縁とみなす長さ (m)
HW = 1.25          # 縁の床の半幅 (m)
OUT = 6.0          # 縁の外側で地形を落とす幅 (m)
PED = {"footway", "pedestrian", "path", "cycleway", "corridor"}
DEBUG = None       # 調査用 (dict を入れると、途中の格子がたまる)


def restore(T, city):
    city["roads"] = [r for r in city["roads"] if not r.get("edge")]
    p = T.pop("patch_edges", None)
    if not p:
        return
    for i, v in zip(p["idx"], p["h0"]):
        T["h"][i] = v
    by_id = {b["id"]: b for b in city["buildings"]}
    for bid, y0, h0 in p.get("buildings", []):
        if bid in by_id:
            by_id[bid]["y"], by_id[bid]["h"] = y0, h0


def _filt(a, r, fn):
    """正方形 (2r+1) の最小・最大フィルター (縦横に分けて)"""
    out = a
    for axis in (0, 1):
        p = np.pad(out, [(r, r) if k == axis else (0, 0) for k in (0, 1)], mode="edge")
        acc = None
        for s in range(2 * r + 1):
            sl = p[s:s + out.shape[0], :] if axis == 0 else p[:, s:s + out.shape[1]]
            acc = sl.copy() if acc is None else fn(acc, sl)
        out = acc
    return out


def _median3(a):
    p = np.pad(a, 1, mode="edge")
    st = np.stack([p[1 + dj:1 + dj + a.shape[0], 1 + di:1 + di + a.shape[1]] for dj in (-1, 0, 1) for di in (-1, 0, 1)])
    return np.nanmedian(st, axis=0)


def _label(mask):
    lab = np.zeros(mask.shape, np.int32)
    n = 0
    for j0, i0 in zip(*np.nonzero(mask)):
        if lab[j0, i0]:
            continue
        n += 1
        stack = [(int(j0), int(i0))]
        lab[j0, i0] = n
        while stack:
            j, i = stack.pop()
            for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                a, b = j + dj, i + di
                if 0 <= a < mask.shape[0] and 0 <= b < mask.shape[1] and mask[a, b] and not lab[a, b]:
                    lab[a, b] = n
                    stack.append((a, b))
    return lab, n


def _loops(m):
    """かたまりの輪郭 (外周と穴) を、かたまりを右手に見る向きの輪 [(列, 行), ...] で全部返す"""
    p = np.pad(m, 1)
    nxt = {}
    for j, i in zip(*(a.tolist() for a in np.nonzero(m))):
        if not p[j, i + 1]:
            nxt.setdefault((i, j), []).append((i + 1, j))
        if not p[j + 1, i + 2]:
            nxt.setdefault((i + 1, j), []).append((i + 1, j + 1))
        if not p[j + 2, i + 1]:
            nxt.setdefault((i + 1, j + 1), []).append((i, j + 1))
        if not p[j + 1, i]:
            nxt.setdefault((i, j + 1), []).append((i, j))
    out = []
    while nxt:
        start = next(iter(nxt))
        loop, cur, d = [start], start, None
        while True:
            outs = nxt[cur]
            e = outs[0]
            if len(outs) > 1 and d:
                right = (cur[0] - d[1], cur[1] + d[0])
                if right in outs:
                    e = right
            outs.remove(e)
            if not outs:
                del nxt[cur]
            d = (e[0] - cur[0], e[1] - cur[1])
            cur = e
            if cur == start:
                break
            loop.append(cur)
        out.append(loop)
    return out


def _dp(pts, tol):
    keep = {0, len(pts) - 1}
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        ax, az = pts[a]; bx, bz = pts[b]
        L = math.hypot(bx - ax, bz - az) or 1e-9
        worst, wi = 0, None
        for k in range(a + 1, b):
            d = abs((bx - ax) * (pts[k][1] - az) - (bz - az) * (pts[k][0] - ax)) / L
            if d > worst:
                worst, wi = d, k
        if worst > tol:
            keep.add(wi)
            stack += [(a, wi), (wi, b)]
    return [pts[k] for k in sorted(keep)]


def apply(T, city, dsm, lower_buildings):
    nx, nz, st, tx0, tz0, ref = T["nx"], T["nz"], T["step"], T["minX"], T["minZ"], T.get("ref", 0.0)
    h = np.array(T["h"], dtype=np.float64).reshape(nz, nx) / 100
    decks = [r for r in city["roads"] if r.get("bridge") and r.get("ys") and r["kind"] in PED]
    bridges = [r for r in city["roads"] if r.get("bridge") and r.get("ys")]
    if not decks:
        return 0, 0
    xs = [p[0] for r in decks for p in r["pts"]]; zs = [p[1] for r in decks for p in r["pts"]]
    x0 = max(tx0 + 2, math.floor(min(xs) - NEAR)); x1 = min(tx0 + (nx - 2) * st, math.ceil(max(xs) + NEAR))
    z0 = max(tz0 + 2, math.floor(min(zs) - NEAR)); z1 = min(tz0 + (nz - 2) * st, math.ceil(max(zs) + NEAR))
    W, Hh = int((x1 - x0) / RES), int((z1 - z0) / RES)
    X, Z = np.meshgrid(x0 + (np.arange(W) + 0.5) * RES, z0 + (np.arange(Hh) + 0.5) * RES)   # マスの中心

    # 点群の表面 (1 m 格子 = 0.5 m の 4 マスの中央値)
    i0, j0 = int((x0 - dsm.x0) / dsm.res), int((z0 - dsm.z0) / dsm.res)
    k = int(round(RES / dsm.res))
    raw = np.frombuffer(dsm.a, dtype=np.int16).reshape(dsm.nz, dsm.nx)[j0:j0 + Hh * k, i0:i0 + W * k].astype(np.float64)
    raw[raw == dsm.nodata] = np.nan
    with np.errstate(all="ignore"):
        import warnings
        warnings.simplefilter("ignore")
        G = np.nanmedian(raw.reshape(Hh, k, W, k).transpose(0, 2, 1, 3).reshape(Hh, W, k * k), axis=2) / 100 - ref
        for _ in range(2):
            G = np.where(np.isnan(G), _median3(G), G)
        G = _median3(G)

    def terr(x, z):
        fx, fz = (x - tx0) / st, (z - tz0) / st
        i, j = np.clip(fx.astype(int), 0, nx - 2), np.clip(fz.astype(int), 0, nz - 2)
        u, v = fx - i, fz - j
        return h[j, i] * (1 - u) * (1 - v) + h[j, i + 1] * u * (1 - v) + h[j + 1, i] * (1 - u) * v + h[j + 1, i + 1] * u * v
    To = terr(X, Z)
    Lo = _filt(To, 10, np.minimum)      # 周り 10 m で一番低い地面
    Tmax = _filt(To, 4, np.maximum)     # 周り 4 m で一番高い地面

    def seg_dist(pts, hw_l, hw_r):
        d = np.full(X.shape, 1e9)
        for a, b in zip(pts, pts[1:]):
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            if L < 0.05:
                continue
            ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            t = np.clip(((X - a[0]) * ux + (Z - a[1]) * uz) / L, 0, 1)
            side = (X - a[0]) * -uz + (Z - a[1]) * ux
            d = np.minimum(d, np.hypot(X - a[0] - ux * L * t, Z - a[1] - uz * L * t) - np.where(side >= 0, hw_l, hw_r))
        return d
    near = np.zeros(X.shape, bool)
    link = np.zeros(X.shape, bool)       # 歩行者用の橋のそば (6 m 以内)。橋の高さ ys は使わない (ys は地形しだいなので、結果が実行の順に左右されないように)
    for r in decks:
        d = seg_dist(r["pts"], 0, 0)
        near |= d <= NEAR
        link |= d <= 6
    on_bridge = np.zeros(X.shape, bool)  # 既にある橋の路面の中 (+1 m)。縁は置かない
    for r in bridges:
        hl, hr = r["half"] if r.get("half") else ((r.get("w") or 3) / 2,) * 2
        on_bridge |= seg_dist(r["pts"], hl, hr) <= 1.0
    bld = np.zeros(X.shape, bool)
    for b in city["buildings"]:
        o = b["outer"]
        bx0, bx1 = min(p[0] for p in o) - 1.5, max(p[0] for p in o) + 1.5
        bz0, bz1 = min(p[1] for p in o) - 1.5, max(p[1] for p in o) + 1.5
        if bx1 < x0 or bx0 > x1 or bz1 < z0 or bz0 > z1:
            continue
        a0, a1 = max(0, int((bx0 - x0) / RES)), min(W, int((bx1 - x0) / RES) + 1)
        c0, c1 = max(0, int((bz0 - z0) / RES)), min(Hh, int((bz1 - z0) / RES) + 1)
        if a1 <= a0 or c1 <= c0:
            continue
        sx, sz = X[c0:c1, a0:a1], Z[c0:c1, a0:a1]
        ins = np.zeros(sx.shape, bool)
        dmin = np.full(sx.shape, 1e9)
        for (ax, az), (qx, qz) in zip(o, o[1:] + o[:1]):
            if az != qz:
                ins ^= ((az > sz) != (qz > sz)) & (sx < ax + (qx - ax) * (sz - az) / (qz - az))
            L2 = (qx - ax) ** 2 + (qz - az) ** 2 or 1e-9
            t = np.clip(((sx - ax) * (qx - ax) + (sz - az) * (qz - az)) / L2, 0, 1)
            dmin = np.minimum(dmin, np.hypot(sx - ax - (qx - ax) * t, sz - az - (qz - az) * t))
        bld[c0:c1, a0:a1] |= ins | (dmin < 1.0)

    high = near & ~bld & (G - Lo >= DROP) & (G - Tmax <= 0.6)
    # 屋根・デッキの下で点群に地面が写っていない所も、地形が低ければ「低い」とみなす (広場の縁がデッキの下にある所)
    roofed = ~bld & (G - Tmax > 2.0)
    # 川沿い (護岸) は対象外
    river = np.zeros(X.shape, bool)
    for w in city.get("waterways") or []:
        river |= seg_dist(w["pts"], 0, 0) <= (w.get("w") or 6) / 2 + 12
    # 細いひげを落とす (1 マス削って戻す)
    er = high & np.roll(high, 1, 0) & np.roll(high, -1, 0) & np.roll(high, 1, 1) & np.roll(high, -1, 1)
    high = (er | np.roll(er, 1, 0) | np.roll(er, -1, 0) | np.roll(er, 1, 1) | np.roll(er, -1, 1)) & high
    if DEBUG is not None:
        DEBUG.update(G=G, To=To, Lo=Lo, Tmax=Tmax, high=high, roofed=roofed, bld=bld, x0=x0, z0=z0, on_bridge=on_bridge)
    lab, n = _label(high)
    runs = []
    for c in range(1, n + 1):
        m = lab == c
        if m.sum() < MIN_AREA / RES ** 2 or not (m & link).any():
            continue
        gv = G[m]
        spread = float(np.nanpercentile(gv, 90) - np.nanpercentile(gv, 10))
        if DEBUG is not None:
            DEBUG.setdefault("comps", []).append((float(X[m].mean()), float(Z[m].mean()), int(m.sum()), round(spread, 2)))
        if spread > FLAT:   # 平らでないかたまり (斜面の段々・高台) は広場ではない
            continue
        for loop in _loops(m):
            L = len(loop)
            ok = []
            for q in range(L):
                (ax, az), (bx, bz) = loop[q], loop[(q + 1) % L]
                dx, dz = bx - ax, bz - az
                ox, oz = dz, -dx                       # 外向き (かたまりは右手 = (-dz, dx) の側)
                mx, mz = (ax + bx) / 2, (az + bz) / 2
                cnt = 0
                ii, ij = int(math.floor(mx - ox * 0.5)), int(math.floor(mz - oz * 0.5))   # 縁のすぐ内側のマス
                gi = G[min(max(ij, 0), Hh - 1), min(max(ii, 0), W - 1)]
                for s in (1, 2, 3, 4, 5):
                    ci, cj = int(math.floor(mx + ox * (s - 0.5))), int(math.floor(mz + oz * (s - 0.5)))
                    if not (0 <= ci < W and 0 <= cj < Hh) or bld[cj, ci]:
                        continue
                    # 外側が、縁のすぐ内側より DROP 近く低い (点群で見えている) か、屋根の下で地形が低い
                    if G[cj, ci] < gi - (DROP - 0.2) or (s >= 3 and roofed[cj, ci] and To[cj, ci] < gi - 1.2):
                        cnt += 1
                ok.append(cnt >= 3 and not river[min(max(ij, 0), Hh - 1), min(max(ii, 0), W - 1)])
            # 2 マス以下のすき間は埋める
            for q in range(L):
                if not ok[q] and ok[q - 1] and (ok[(q + 1) % L] or ok[(q + 2) % L]):
                    ok[q] = True
            if all(ok):
                runs.append((loop + [loop[0]], True))
                continue
            if not any(ok):
                continue
            s0 = next(q for q in range(L) if ok[q] and not ok[q - 1])
            cur = None
            for t in range(L + 1):
                q = (s0 + t) % L
                if t < L and ok[q]:
                    if cur is None:
                        cur = [loop[q]]
                    cur.append(loop[(q + 1) % L])
                elif cur is not None:
                    if len(cur) - 1 >= MIN_RUN / RES:
                        runs.append((cur, False))
                    cur = None

    # ---- 縁の線 (ローカル座標)。直線にならして、内側へ HW 寄せた線が床の中心
    edges = []
    for pts, closed in runs:
        P = [(x0 + i * RES, z0 + j * RES) for i, j in pts]
        if closed:
            far = max(range(len(P)), key=lambda q: (P[q][0] - P[0][0]) ** 2 + (P[q][1] - P[0][1]) ** 2)
            P = _dp(P[:far + 1], 0.75)[:-1] + _dp(P[far:], 0.75)
        else:
            P = _dp(P, 0.75)
        if len(P) >= 2:
            edges.append((P, closed))

    def g_at(x, z):
        i, j = int((x - x0) / RES), int((z - z0) / RES)
        return float(G[j, i]) if 0 <= i < W and 0 <= j < Hh and not np.isnan(G[j, i]) else None

    def bridged(x, z):
        i, j = int((x - x0) / RES), int((z - z0) / RES)
        return 0 <= i < W and 0 <= j < Hh and bool(on_bridge[j, i])

    added = []
    pieces = []   # 床を置く部分: 既にある橋の路面の中 (橋が縁に沿っている所) は除く。地形は全部の縁で直す
    for P, closed in edges:
        # 細かく刻む (高さを 4 m ごとに取る)
        D = [P[0]]
        for a, b in zip(P, P[1:]):
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            n = max(1, int(math.ceil(L / 4)))
            D += [(a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n) for t in range(1, n + 1)]
        flags = []
        for q, p in enumerate(D):
            a = D[q - 1] if q > 0 else p
            b = D[q + 1] if q + 1 < len(D) else p
            L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
            flags.append(bridged(p[0] - (b[1] - a[1]) / L * 0.7, p[1] + (b[0] - a[0]) / L * 0.7))
        if not any(flags):
            pieces.append((D, closed))
            continue
        cur = []
        for p, f in zip(D, flags):
            if not f:
                cur.append(p)
            else:
                if len(cur) >= 2:
                    pieces.append((cur, False))
                cur = []
        if len(cur) >= 2:
            pieces.append((cur, False))
    for D, closed in pieces:
        if sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(D, D[1:])) < 3.0:
            continue
        cen, ys = [], []
        for q, p in enumerate(D):
            a = D[q - 1] if q > 0 else (D[-2] if closed else p)
            b = D[q + 1] if q + 1 < len(D) else (D[1] if closed else p)
            dx, dz = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dz) or 1
            ix, iz = -dz / L, dx / L                   # 内向き (かたまりは右手)
            cen.append([round(p[0] + ix * HW, 2), round(p[1] + iz * HW, 2)])
            vs = [v for v in (g_at(p[0] + ix * s, p[1] + iz * s) for s in (1.5, 2.5, 3.5)) if v is not None]
            ys.append(sorted(vs)[len(vs) // 2] if vs else None)
        known = [v for v in ys if v is not None]
        if not known:
            continue
        med = sorted(known)[len(known) // 2]
        ys = [med if v is None or abs(v - med) > 0.8 else v for v in ys]
        ys = [round((ys[max(0, q - 1)] + ys[q] + ys[min(len(ys) - 1, q + 1)]) / 3, 2) for q in range(len(ys))]
        if closed:
            ys[-1] = ys[0]
        added.append({"kind": "pedestrian", "w": 2 * HW, "pts": cen, "ys": ys, "bridge": 1, "edge": 1})

    # ---- 地形: 縁の外側 OUT m は下の地面まで落とし、床の下 (内側 2*HW) で広場の高さへ上げる
    new = h.copy()
    for P, closed in edges:
        for a, b in zip(P, P[1:]):
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            if L < 0.05:
                continue
            ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            ox, oz = uz, -ux                           # 外向き
            # 下の地面の高さ: 縁から外へ 1〜6 m の、点群で縁より DROP 近く低いと出た所。屋根の下で見えなければ、外へ 4〜8 m の地形
            ins = [v for v in (g_at(a[0] + ux * t - ox * 1.5, a[1] + uz * t - oz * 1.5) for t in np.arange(0.5, L, 1.0)) if v is not None]
            if not ins:
                continue
            gi = sorted(ins)[len(ins) // 2]
            lows, far = [], []
            for t in np.arange(0.5, L, 1.0):
                for s in (1.5, 2.5, 3.5, 4.5, 5.5):
                    v = g_at(a[0] + ux * t + ox * s, a[1] + uz * t + oz * s)
                    if v is not None and v < gi - (DROP - 0.2):
                        lows.append(v)
                for s in (4.0, 6.0, 8.0):
                    far.append(float(terr(np.array(a[0] + ux * t + ox * s), np.array(a[1] + uz * t + oz * s))))
            if lows:
                lo = sorted(lows)[len(lows) // 4]
            elif far and min(far) < gi - 1.2:
                lo = min(far)
            else:
                continue
            m = OUT + st
            a0, a1 = int((min(a[0], b[0]) - m - tx0) / st), int((max(a[0], b[0]) + m - tx0) / st) + 1
            c0, c1 = int((min(a[1], b[1]) - m - tz0) / st), int((max(a[1], b[1]) + m - tz0) / st) + 1
            a0, c0, a1, c1 = max(a0, 0), max(c0, 0), min(a1, nx - 1), min(c1, nz - 1)
            VX, VZ = np.meshgrid(tx0 + np.arange(a0, a1 + 1) * st, tz0 + np.arange(c0, c1 + 1) * st)
            t = ((VX - a[0]) * ux + (VZ - a[1]) * uz) / L
            d = (VX - a[0]) * ox + (VZ - a[1]) * oz    # 外向きの距離
            along = (t >= -0.6 / L) & (t <= 1 + 0.6 / L)
            sub = new[c0:c1 + 1, a0:a1 + 1]
            cur = h[c0:c1 + 1, a0:a1 + 1]
            outside = along & (d >= 0) & (d <= OUT)
            inside = along & (d < 0) & (d >= -2 * HW)
            val = np.where(outside, lo, np.where(inside, lo + (-d / (2 * HW)) * (cur - lo), 1e9))
            np.minimum(sub, np.where(val < cur - 0.05, val, sub), out=sub)
    changed = np.nonzero(np.abs(new - h) > 0.02)
    idx = (changed[0] * nx + changed[1]).tolist()
    patch = {"idx": idx, "h0": [T["h"][i] for i in idx], "buildings": []}
    for i, v in zip(idx, np.round(new[changed] * 100).astype(int).tolist()):
        T["h"][i] = v
    lower_buildings(T, city, patch)
    T["patch_edges"] = patch
    city["roads"] += added
    return len(added), sum(math.hypot(b[0] - a[0], b[1] - a[1]) for r in added for a, b in zip(r["pts"], r["pts"][1:]))
