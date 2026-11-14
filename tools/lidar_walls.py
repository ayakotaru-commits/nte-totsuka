"""点群の「地面の点」(分類 2) から、擁壁・崖のような急な段差を自動で見つけ、壁の一覧 public/data/walls.json を作る。

使い方: python tools/lidar_walls.py [--window minX maxX minZ maxZ] [--min-drop 0.8]
前提:   tools/fetch_lidar.py が使う図郭 zip が data/raw/lidar/ にあること (numpy 必須)
出力:   public/data/walls.json = {"res", "walls": [[x0, z0, x1, z1, yLow, yHigh], ...]}  (ローカル座標・標高は terrain.json と同じ基準)

やり方:
  1. 地面の点だけを 0.5 m の格子に入れる (各マスの一番低い値)。建物の下は点が無いので「データ無し」になり、壁と見なされない
  2. 隣り合う 2 マスの高さの差が --min-drop (既定 0.8 m) 以上なら、その境目は壁 (斜面なら 0.5 m で 0.8 m も上がらない)
  3. 同じ高さで一直線に続く境目をつなげて 1 本の壁にする。短いもの (1.5 m 未満) は捨てる
  4. 壁の高さは低い側と高い側の地面の高さ。ほぼ垂直なものだけが拾われる
"""
import argparse
import json
import pathlib
import struct
import zipfile

import numpy as np

import fetch_lidar as FL

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "walls.json"
RES = 1.0
NODATA = 32000
CLASSES = (2,)  # 地面。--classes で変える (1 = 未分類も使う)


def ground_grid(win, T, zips):
    x0, x1, z0, z1 = win
    nx, nz = int((x1 - x0) / RES), int((z1 - z0) / RES)
    grid = np.full(nz * nx, NODATA, dtype=np.int16)
    a, b, c, d, e, ff = T
    inv = 1 / RES
    for zp in zips:
        with zipfile.ZipFile(zp) as zf:
            las = next(i for i in zf.namelist() if i.lower().endswith(".las"))
            with zf.open(las) as f:
                h = f.read(227)
                offset, = struct.unpack_from("<I", h, 96)
                fmt, reclen, npts = struct.unpack_from("<BHI", h, 104)
                sx, sy, sz, ox, oy, oz = struct.unpack_from("<6d", h, 131)
                f.read(offset - 227)
                kxx, kxy, kx0 = a * sx * inv, b * sy * inv, (a * ox + b * oy + c - x0) * inv
                kzx, kzy, kz0 = d * sx * inv, e * sy * inv, (d * ox + e * oy + ff - z0) * inv
                zk, zoff = sz * 100, oz * 100
                dt = np.dtype({"names": ["X", "Y", "Z", "cls"], "formats": ["<i4", "<i4", "<i4", "u1"],
                               "offsets": [0, 4, 8, 15], "itemsize": reclen})
                left = npts
                while left > 0:
                    n = min(left, 2_000_000)
                    buf = f.read(n * reclen)
                    n = len(buf) // reclen
                    if n == 0:
                        break
                    left -= n
                    rec = np.frombuffer(buf, dtype=dt, count=n)
                    m = np.isin(rec["cls"], CLASSES)
                    X, Y, Z = rec["X"][m].astype(np.float64), rec["Y"][m].astype(np.float64), rec["Z"][m]
                    i = np.floor(X * kxx + Y * kxy + kx0).astype(np.int64)
                    j = np.floor(X * kzx + Y * kzy + kz0).astype(np.int64)
                    ok = (i >= 0) & (i < nx) & (j >= 0) & (j < nz)
                    zc = np.clip(np.floor(Z[ok] * zk + zoff + 0.5), -30000, 30000).astype(np.int16)
                    np.minimum.at(grid, (j * nx + i)[ok], zc)
    return grid.reshape(nz, nx), nx, nz


def find_walls(g, x0, z0, min_drop_cm, min_len):
    nz, nx = g.shape
    valid = g != NODATA
    gi = g.astype(np.int32)
    walls = []
    # 縦の壁 (x 方向に隣り合う 2 マスの境目: 壁は z 方向に伸びる) と、横の壁 (z 方向に隣り合う境目)
    for axis in (0, 1):
        if axis == 0:
            a, b = gi[:, :-1], gi[:, 1:]
            va = valid[:, :-1] & valid[:, 1:]
        else:
            a, b = gi[:-1, :], gi[1:, :]
            va = valid[:-1, :] & valid[1:, :]
        diff = np.abs(a - b)
        edge = va & (diff >= min_drop_cm)
        lo, hi = np.minimum(a, b), np.maximum(a, b)
        # 走査方向 (壁が伸びる方向) に高さがほぼ同じ境目をつなげる
        # axis 0: 境目は列 i と i+1 の間、走査は j (行) に沿う。axis 1 はその逆
        E = edge if axis == 0 else edge.T
        LO = lo if axis == 0 else lo.T
        HI = hi if axis == 0 else hi.T
        rows, cols = E.shape  # rows = 走査方向, cols = 境目の位置
        for c in range(cols):
            col = E[:, c]
            if not col.any():
                continue
            r = 0
            idx = np.flatnonzero(col)
            start = prev = None
            slo = shi = 0
            for r in idx:
                if start is not None and r == prev + 1 and abs(int(LO[r, c]) - slo) <= 60 and abs(int(HI[r, c]) - shi) <= 60:
                    prev = r
                    continue
                if start is not None:
                    walls.append((axis, c, start, prev + 1, slo, shi))
                start, prev, slo, shi = r, r, int(LO[r, c]), int(HI[r, c])
            if start is not None:
                walls.append((axis, c, start, prev + 1, slo, shi))
    out = []
    for axis, c, s, e, lo, hi in walls:
        if (e - s) * RES < min_len:
            continue
        pos = (c + 1) * RES  # 境目の位置
        if axis == 0:
            out.append([x0 + pos, z0 + s * RES, x0 + pos, z0 + e * RES, lo / 100, hi / 100])
        else:
            out.append([x0 + s * RES, z0 + pos, x0 + e * RES, z0 + pos, lo / 100, hi / 100])
    return out


def building_mask(win, margin=1.5):
    """建物の輪郭 (city.json) を 0.5 m の格子に塗り、margin だけ広げた真偽値の格子を返す。点群の未分類には屋根・建物の壁が入るので、その縁を壁と間違えない"""
    x0, x1, z0, z1 = win
    r = 0.5
    nx, nz = int((x1 - x0) / r), int((z1 - z0) / r)
    m = np.zeros((nz, nx), dtype=bool)
    city = json.loads((ROOT / "public" / "data" / "city.json").read_text(encoding="utf-8"))
    mg = int(margin / r)
    for b in city["buildings"]:
        poly = np.array(b["outer"])
        if poly[:, 0].max() < x0 - margin or poly[:, 0].min() > x1 + margin or poly[:, 1].max() < z0 - margin or poly[:, 1].min() > z1 + margin:
            continue
        i0, i1 = max(0, int((poly[:, 0].min() - x0) / r) - mg), min(nx, int((poly[:, 0].max() - x0) / r) + mg + 2)
        j0, j1 = max(0, int((poly[:, 1].min() - z0) / r) - mg), min(nz, int((poly[:, 1].max() - z0) / r) + mg + 2)
        if i0 >= i1 or j0 >= j1:
            continue
        gx, gz = np.meshgrid(x0 + (np.arange(i0, i1) + 0.5) * r, z0 + (np.arange(j0, j1) + 0.5) * r)
        inside = np.zeros(gx.shape, dtype=bool)
        a, bq = poly, np.roll(poly, -1, axis=0)
        for (ax, az), (bx, bz) in zip(a, bq):
            if az == bz:
                continue
            cond = (az > gz) != (bz > gz)
            xi = ax + (gz - az) / (bz - az) * (bx - ax)
            inside ^= cond & (gx < xi)
        # 広げる (margin 内に建物があれば真)
        pad = np.pad(inside, mg)
        grown = np.zeros_like(inside)
        for dj in range(-mg, mg + 1):
            for di in range(-mg, mg + 1):
                grown |= pad[mg + dj: mg + dj + inside.shape[0], mg + di: mg + di + inside.shape[1]]
        m[j0:j1, i0:i1] |= grown
    return m


def terrain_h():
    t = json.loads((ROOT / "public" / "data" / "terrain.json").read_text(encoding="utf-8"))
    h = np.array(t["h"], dtype=np.float64).reshape(t["nz"], t["nx"]) / 100
    def H(x, z):
        fx = np.clip((x - t["minX"]) / t["step"], 0, t["nx"] - 1.001)
        fz = np.clip((z - t["minZ"]) / t["step"], 0, t["nz"] - 1.001)
        i, j = int(fx), int(fz)
        u, v = fx - i, fz - j
        return (h[j, i] * (1 - u) * (1 - v) + h[j, i + 1] * u * (1 - v) + h[j + 1, i] * (1 - u) * v + h[j + 1, i + 1] * u * v)
    return H


def filter_walls(walls, win, bmask):
    """建物のそば・地形から大きく外れた壁 (屋根・木の縁) を捨てる"""
    H = terrain_h()
    x0, z0 = win[0], win[2]
    keep = []
    for w in walls:
        mx, mz = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
        i, j = int((mx - x0) / 0.5), int((mz - z0) / 0.5)
        if 0 <= j < bmask.shape[0] and 0 <= i < bmask.shape[1] and bmask[j, i]:
            continue
        th = H(mx, mz)
        if not (w[4] - 3.5 <= th <= w[5] + 3.5):
            continue
        keep.append(w)
    return keep


def osm_walls(win, g_ground, g_all, min_len=3.0):
    """OSM の擁壁 (data/raw/osm_walls.json の barrier=retaining_wall) に、点群から測った高さを付ける。
    線に沿って 2 m おきに、線の両側 1.2〜3 m の地面の高さ (中央値) を測り、低い側〜高い側を壁の高さにする。
    両側の差が 0.5 m 未満の所は、低い壁 (地面から 0.6 m) にする。"""
    from config import ORIGIN_LAT, ORIGIN_LON, _M_LAT, _M_LON
    data = json.loads((ROOT / "data" / "raw" / "osm_walls.json").read_text(encoding="utf-8"))
    H = terrain_h()
    x0, z0 = win[0], win[2]
    nz, nx = g_ground.shape

    def side_h(x, z, nx_, nz_):
        vals = []
        for off in (1.2, 2.0, 3.0):
            for dd in (-1, 0, 1):
                px, pz = x + nx_ * off + dd * 0.0, z + nz_ * off
                i, j = int((px - x0) / RES), int((pz - z0) / RES)
                for gg in (g_ground, g_all):
                    sub = gg[max(0, j - 1): j + 2, max(0, i - 1): i + 2]
                    sub = sub[sub != NODATA]
                    if sub.size:
                        vals.append(float(np.min(sub)))
                        break
        return float(np.median(vals)) / 100 if vals else None

    ref = json.loads((ROOT / "public" / "data" / "terrain.json").read_text(encoding="utf-8"))["ref"]
    out, skipped = [], 0
    for el in data["elements"]:
        if el.get("tags", {}).get("barrier") != "retaining_wall":
            continue
        pts = [((g["lon"] - ORIGIN_LON) * _M_LON, (ORIGIN_LAT - g["lat"]) * _M_LAT) for g in el["geometry"]]
        first = len(out)
        for (ax, az), (bx, bz) in zip(pts, pts[1:]):
            L = float(np.hypot(bx - ax, bz - az))
            if L < 0.5:
                continue
            ux, uz = (bx - ax) / L, (bz - az) / L
            nxv, nzv = -uz, ux
            n = max(1, int(round(L / 2.0)))
            for k in range(n):
                t0, t1 = k / n, (k + 1) / n
                tm = (t0 + t1) / 2
                mx, mz = ax + (bx - ax) * tm, az + (bz - az) * tm
                if not (x0 <= mx < win[1] and z0 <= mz < win[3]):
                    skipped += 1
                    continue
                a, b = side_h(mx, mz, nxv, nzv), side_h(mx, mz, -nxv, -nzv)
                if a is None or b is None:
                    skipped += 1
                    continue
                lo, hi = min(a, b) - ref, max(a, b) - ref
                if hi - lo < 0.5:
                    hi = lo + 0.6
                if hi - lo > 8:
                    skipped += 1
                    continue
                out.append([round(v, 2) for v in (ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, lo, hi)])
        # 点群の誤差 (木・車など) で高さが跳ねるので、1 本の線の中で前後 2 区間ずつの中央値にならす
        seg = out[first:]
        if len(seg) >= 3:
            lo = [w[4] for w in seg]; hi = [w[5] for w in seg]
            for k, w in enumerate(seg):
                a, b = max(0, k - 2), min(len(seg), k + 3)
                w[4] = round(float(np.median(lo[a:b])), 2)
                w[5] = round(max(w[4] + 0.6, float(np.median(hi[a:b]))), 2)
    return out, skipped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--window", type=float, nargs=4, metavar=("MINX", "MAXX", "MINZ", "MAXZ"), default=None)
    ap.add_argument("--min-drop", type=float, default=0.8)
    ap.add_argument("--min-len", type=float, default=1.5)
    ap.add_argument("--classes", type=int, nargs="+", default=[2])
    ap.add_argument("--osm", action="store_true", help="OSM の擁壁に点群の高さを付ける (推奨。既定は点群だけで検出)")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()
    global CLASSES
    CLASSES = tuple(args.classes)
    B = FL.BOUNDS
    win = args.window or (B["minX"], B["maxX"], B["minZ"], B["maxZ"])
    T, err = FL.plane_to_local()
    zips = sorted(FL.CACHE.glob("*.zip"))
    print(f"図郭 {len(zips)} 個, 窓 {win}")
    if args.osm:
        CLASSES = (2,)
        g2, _, _ = ground_grid(win, T, zips)
        CLASSES = (1, 2)
        g12, _, _ = ground_grid(win, T, zips)
        walls, skipped = osm_walls(win, g2, g12)
        print(f"OSM の擁壁 -> 壁 {len(walls)} 区間 (2 m ごと), 高さを測れず除外 {skipped}")
        pathlib.Path(args.out).write_text(json.dumps({"res": RES, "walls": walls}), encoding="utf-8")
        return
    g, nx, nz = ground_grid(win, T, zips)
    print(f"格子 {nx}x{nz}, 地面の点があるマス {100 * np.mean(g != NODATA):.1f}%")
    walls = find_walls(g, win[0], win[2], round(args.min_drop * 100), args.min_len)
    # 標高の基準: terrain.json (戸塚駅付近 = 0 m の相対標高) に合わせる。点群との差は中央値 3 cm
    TERRAIN = ROOT / "public" / "data" / "terrain.json"
    ref = json.loads(TERRAIN.read_text(encoding="utf-8"))["ref"] if TERRAIN.exists() else 0.0
    for w in walls:
        w[4] -= ref
        w[5] -= ref
    n0 = len(walls)
    walls = filter_walls(walls, win, building_mask(win))
    print(f"建物のそば・地形から外れた壁を除外: {n0} -> {len(walls)}")
    print(f"壁 {len(walls)} 本, 合計の長さ {sum(abs(w[2]-w[0])+abs(w[3]-w[1]) for w in walls):.0f} m")
    pathlib.Path(args.out).write_text(json.dumps({"res": RES, "walls": [[round(v, 2) for v in w] for w in walls]}), encoding="utf-8")


if __name__ == "__main__":
    main()
