"""点群と航空写真から「地面が何で覆われているか」を読み、空き地を自動で埋めるデータを作る。

使い方: python tools/lidar_cover.py            (numpy が必要。先に fetch_lidar.py と fetch_ortho.py)
        python tools/lidar_cover.py --undo     出力を消して build_props.py をやり直す (元の見た目に戻る)
入力:   data/raw/lidar/<図郭>.zip   点群 (fetch_lidar.py)
        data/raw/ortho_rgb.bin      航空写真の色の格子 (fetch_ortho.py)。色は数値として読むだけで、写真は貼らない
        public/data/city.json, terrain.json
出力:   public/data/cover.json   地面の種類の格子 (terrain.json と同じ並び。ブラウザが地形の色に使う)
        data/lots.json           木の位置・広い舗装の範囲 (build_props.py が props.json の木・駐車場の線と車にする)
        data/raw/lidar_cover.npz 点群を 1 m の格子にまとめた途中結果 (作り直すときは消す)

読み方 (1 m のマスごと。建物・道路・水面の上は対象外):
  木     : 一番高い反射が地面より TREE_H m 以上高く、葉を通り抜けた反射 (反射が 2 回以上) が多いか、写真で緑
  草     : 写真で緑 (低い所)
  舗装   : 写真で色味の無い灰色 (アスファルト・コンクリート)
  土     : 写真で茶色〜黄土色 (校庭・造成地・畑)
  影になっていて色が読めないマスは、周りの多数決で埋める。
"""
import json
import pathlib
import struct
import sys
import zipfile

import numpy as np

import fetch_lidar as FL

ROOT = pathlib.Path(__file__).resolve().parent.parent
CITY = ROOT / "public" / "data" / "city.json"
TERRAIN = ROOT / "public" / "data" / "terrain.json"
ORTHO_BIN = ROOT / "data" / "raw" / "ortho_rgb.bin"
ORTHO_META = ROOT / "data" / "raw" / "ortho_rgb.json"
CACHE = ROOT / "data" / "raw" / "lidar_cover.npz"
OUT_COVER = ROOT / "public" / "data" / "cover.json"
OUT_LOTS = ROOT / "data" / "lots.json"

RES = 1.0          # 読み取りの格子 (m)
NODATA = -32768
# 地面の種類 (cover.json の数字)
NONE, GRASS, PAVED, SOIL = 0, 1, 2, 3


# ---------------------------------------------------------------- 点群 → 1 m の格子
def las_grid(zips, T, B):
    """各マスの: 一番高い反射 zmax・一番低い反射 zmin (cm)、点の数 n、反射が 2 回以上あったパルスの点の数 multi、
    反射 1 回の点の強度の合計 isum とその数 ns"""
    nx, nz = int((B["maxX"] - B["minX"]) / RES), int((B["maxZ"] - B["minZ"]) / RES)
    N = nx * nz
    zmax = np.full(N, NODATA, np.int16)
    zmin = np.full(N, 32767, np.int16)
    n_all, n_multi, n_single = np.zeros(N, np.int64), np.zeros(N, np.int64), np.zeros(N, np.int64)
    isum = np.zeros(N, np.float64)
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
                kxx, kxy, kx0 = a * sx * inv, b * sy * inv, (a * ox + b * oy + c - B["minX"]) * inv
                kzx, kzy, kz0 = d * sx * inv, e * sy * inv, (d * ox + e * oy + ff - B["minZ"]) * inv
                zk, zoff = sz * 100, oz * 100
                dt = np.dtype({"names": ["X", "Y", "Z", "I", "fl"], "formats": ["<i4", "<i4", "<i4", "<u2", "u1"],
                               "offsets": [0, 4, 8, 12, 14], "itemsize": reclen})
                left, used = npts, 0
                while left > 0:
                    n = min(left, 2_000_000)
                    buf = f.read(n * reclen)
                    n = len(buf) // reclen
                    if n == 0:
                        break
                    left -= n
                    rec = np.frombuffer(buf, dtype=dt, count=n)
                    X, Y = rec["X"].astype(np.float64), rec["Y"].astype(np.float64)
                    i = np.floor(X * kxx + Y * kxy + kx0).astype(np.int64)
                    j = np.floor(X * kzx + Y * kzy + kz0).astype(np.int64)
                    ok = (i >= 0) & (i < nx) & (j >= 0) & (j < nz)
                    idx = (j * nx + i)[ok]
                    zc = np.clip(np.floor(rec["Z"][ok] * zk + zoff + 0.5), -32000, 32000).astype(np.int16)
                    nr = (rec["fl"][ok] >> 3) & 7
                    np.maximum.at(zmax, idx, zc)
                    np.minimum.at(zmin, idx, zc)
                    n_all += np.bincount(idx, minlength=N)
                    n_multi += np.bincount(idx[nr >= 2], minlength=N)
                    s = nr <= 1
                    n_single += np.bincount(idx[s], minlength=N)
                    isum += np.bincount(idx[s], weights=rec["I"][ok][s].astype(np.float64), minlength=N)
                    used += int(ok.sum())
        print(f"  {zp.name}: 点 {npts:,} 個 (範囲内 {used:,})")
    sh = (nz, nx)
    return {"zmax": zmax.reshape(sh), "zmin": zmin.reshape(sh), "n": n_all.reshape(sh).astype(np.uint16), "multi": n_multi.reshape(sh).astype(np.uint16),
            "ns": n_single.reshape(sh).astype(np.uint16), "isum": isum.reshape(sh).astype(np.float32)}


def load_grid(B):
    if CACHE.exists():
        z = np.load(CACHE)
        if "zmin" in z.files and z["zmax"].shape == (int((B["maxZ"] - B["minZ"]) / RES), int((B["maxX"] - B["minX"]) / RES)):
            return {k: z[k] for k in z.files}
    zips = sorted(FL.CACHE.glob("*.zip"))
    if not zips:
        raise SystemExit("data/raw/lidar/ に点群がありません。先に python tools/fetch_lidar.py を実行してください")
    T, _ = FL.plane_to_local()
    print(f"点群 {len(zips)} 図郭を読む")
    g = las_grid(zips, T, B)
    np.savez_compressed(CACHE, **g)
    return g


# ---------------------------------------------------------------- city.json → 格子のマスク
def fill_poly(mask, B, poly, holes=None, val=True):
    """多角形の中のマス (中心で判定) に val を入れる"""
    nz, nx = mask.shape
    p = np.asarray(poly, float)
    i0, i1 = max(0, int((p[:, 0].min() - B["minX"]) / RES)), min(nx, int((p[:, 0].max() - B["minX"]) / RES) + 1)
    j0, j1 = max(0, int((p[:, 1].min() - B["minZ"]) / RES)), min(nz, int((p[:, 1].max() - B["minZ"]) / RES) + 1)
    if i0 >= i1 or j0 >= j1:
        return
    X = (B["minX"] + (np.arange(i0, i1) + 0.5) * RES)[None, :]
    Z = (B["minZ"] + (np.arange(j0, j1) + 0.5) * RES)[:, None]

    def inside(q):
        q = np.asarray(q, float)
        ins = np.zeros((j1 - j0, i1 - i0), bool)
        for k in range(len(q)):
            x1, z1 = q[k]
            x2, z2 = q[(k + 1) % len(q)]
            if z1 != z2:
                ins ^= ((z1 > Z) != (z2 > Z)) & (X < (x2 - x1) * (Z - z1) / (z2 - z1) + x1)
        return ins
    ins = inside(p)
    for h in holes or []:
        ins &= ~inside(h)
    mask[j0:j1, i0:i1][ins] = val


def fill_ribbon(mask, B, pts, w):
    p = np.asarray(pts, float)[:, :2]
    for k in range(len(p) - 1):
        (x1, z1), (x2, z2) = p[k], p[k + 1]
        d = float(np.hypot(x2 - x1, z2 - z1))
        if d < 1e-6:
            continue
        ex, ez = (x2 - x1) / d, (z2 - z1) / d
        nx_, nz_ = -ez * w / 2, ex * w / 2
        x1, z1, x2, z2 = x1 - ex * w / 2, z1 - ez * w / 2, x2 + ex * w / 2, z2 + ez * w / 2  # 折れ点のすき間を埋めるため少し伸ばす
        fill_poly(mask, B, [[x1 + nx_, z1 + nz_], [x2 + nx_, z2 + nz_], [x2 - nx_, z2 - nz_], [x1 - nx_, z1 - nz_]])


def city_masks(city, shape):
    """bld: 建物 / road: 道路・線路 / water: 水面・川 / kind: OSM のエリアの種類 (名前の配列 kinds の番号、無ければ -1)"""
    B = city["bounds"]
    bld, road, water = np.zeros(shape, bool), np.zeros(shape, bool), np.zeros(shape, bool)
    for b in city["buildings"]:
        fill_poly(bld, B, b["outer"])
    for a in city.get("roadAreas") or []:
        fill_poly(road, B, a["outer"], a.get("holes"))
    for r in city["roads"]:
        fill_ribbon(road, B, r["pts"], r.get("w", 4))
    for r in city["rails"]:
        fill_ribbon(road, B, r["pts"], 4.5)
    for w in city["waterways"]:
        fill_ribbon(water, B, w["pts"], w["w"])
    kinds = sorted({a["kind"] for a in city["areas"]})
    kind = np.full(shape, -1, np.int8)
    for a in city["areas"]:  # 面積の大きい順に並んでいる = 小さい面が後から上書きする (描画と同じ)
        m = np.zeros(shape, bool)
        fill_poly(m, B, a["outer"], a.get("holes"))
        kind[m] = kinds.index(a["kind"])
    water |= kind == (kinds.index("water") if "water" in kinds else -2)
    return bld, road, water, kind, kinds


def ground_abs(B, shape):
    """各マスの中心の地面の標高 (m)。terrain.json (相対標高) + 基準の標高 ref"""
    t = json.loads(TERRAIN.read_text(encoding="utf-8"))
    h = np.array(t["h"], np.float64).reshape(t["nz"], t["nx"]) / 100
    xs = B["minX"] + (np.arange(shape[1]) + 0.5) * RES
    zs = B["minZ"] + (np.arange(shape[0]) + 0.5) * RES
    fx = np.clip((xs - t["minX"]) / t["step"], 0, t["nx"] - 1.001)
    fz = np.clip((zs - t["minZ"]) / t["step"], 0, t["nz"] - 1.001)
    i, j = fx.astype(int), fz.astype(int)
    u, v = (fx - i)[None, :], (fz - j)[:, None]
    I, J = i[None, :], j[:, None]
    g = h[J, I] * (1 - u) * (1 - v) + h[J, I + 1] * u * (1 - v) + h[J + 1, I] * (1 - u) * v + h[J + 1, I + 1] * u * v
    return g + t.get("ref", 0.0), t


def ortho_grid(B, shape):
    """各マスの色 (r, g, b の平均, 0〜255)。写真の無いマスは 0"""
    m = json.loads(ORTHO_META.read_text(encoding="utf-8"))
    a = np.frombuffer(ORTHO_BIN.read_bytes(), np.uint8).reshape(m["nz"], m["nx"], 3)
    k = int(round(RES / m["res"]))
    i0, j0 = int(round((B["minX"] - m["minX"]) / m["res"])), int(round((B["minZ"] - m["minZ"]) / m["res"]))
    sub = a[j0:j0 + shape[0] * k, i0:i0 + shape[1] * k].astype(np.float32)
    return sub.reshape(shape[0], k, shape[1], k, 3).mean(axis=(1, 3))


# ---------------------------------------------------------------- 格子の小道具
def box(a, r):
    """(2r+1) 四方の合計"""
    k = 2 * r + 1
    c = np.cumsum(np.pad(a.astype(np.float64), ((r + 1, r), (r + 1, r))), axis=0)
    c = c[k:] - c[:-k]
    c = np.cumsum(c, axis=1)
    return c[:, k:] - c[:, :-k]


def dilate(m, n=1):
    o = m
    for _ in range(n):
        p = np.pad(o, 1)
        o = p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
    return o


def erode(m, n=1):
    return ~dilate(~m, n)


def label(mask):
    """4 近傍でつながったマスのかたまり。[(行の配列, 列の配列), ...] を返す"""
    nz, nx = mask.shape
    flat = mask.ravel()
    seen = np.zeros(flat.size, bool)
    out = []
    for start in np.flatnonzero(flat):
        if seen[start]:
            continue
        seen[start] = True
        stack, cells = [int(start)], []
        while stack:
            k = stack.pop()
            cells.append(k)
            i = k % nx
            for q in (k - nx, k + nx, k - 1 if i > 0 else -1, k + 1 if i < nx - 1 else -1):
                if 0 <= q < flat.size and flat[q] and not seen[q]:
                    seen[q] = True
                    stack.append(q)
        c = np.array(cells)
        out.append((c // nx, c % nx))
    return out


def mode_filter(cls, valid, r, k):
    """valid なマスの多数決 ((2r+1) 四方)。票が無いマスは -1"""
    best, bestn = np.full(cls.shape, -1, np.int8), np.zeros(cls.shape)
    for c in range(k):
        n = box(valid & (cls == c), r)
        better = n > bestn
        best[better], bestn[better] = c, n[better]
    return best


# ---------------------------------------------------------------- 地面の高さ (点群の最低点から)
def lidar_ground(g, B):
    """各マスの地面の標高 (m)。tools/lidar_terrain.py と同じ考え方: 地形データから大きく外れた点と、
    周りの最低点より高い点 (屋根・木・車) を捨て、残りと地形データの差を周りから補う"""
    from lidar_terrain import fill_residual
    D, _ = ground_abs(B, g["zmax"].shape)
    valid = g["n"] > 0
    d = np.where(valid, g["zmin"] / 100 - D, 0.0)
    valid &= (d > -3.0) & (d < 2.5)
    nz, nx = d.shape
    for _ in range(2):
        lmin = np.where(valid, d, 99.0)
        for ax in (0, 1):  # 11 x 11 マスの最低 (縦と横に分けて取る)
            p = np.pad(lmin, [(5, 5) if a == ax else (0, 0) for a in (0, 1)], constant_values=99.0)
            lmin = np.min([p[k:k + nz, :] if ax == 0 else p[:, k:k + nx] for k in range(11)], axis=0)
        valid &= d <= lmin + 0.7
    resid, known = fill_residual(np.where(valid, d, 0.0), valid)
    return np.where(known, D + resid, D)


# ---------------------------------------------------------------- 読み取り
TREE_H = 2.5        # これより高く、葉を通り抜けた反射が多いマスを木とみなす (m)
TREE_MULTI = 0.4    # 5 m 四方で、反射が 2 回以上あったパルスの点の割合
CLASS_NAMES = ["none", "grass", "paved", "soil", "woodfloor", "light"]
WOODFLOOR, LIGHT = 4, 5


def features(g, B):
    gnd = lidar_ground(g, B)
    has = g["n"] > 0
    hgt = np.where(has, g["zmax"] / 100 - gnd, 0.0)
    mf5 = box(g["multi"], 2) / np.maximum(box(g["n"], 2), 1)
    iv = g["ns"] > 0
    inten = box(np.where(iv, g["isum"] / np.maximum(g["ns"], 1), 0), 1) / np.maximum(box(iv, 1), 1)   # 3 m 四方でならした強度
    return gnd, hgt, mf5, inten


def classify(hgt, mf5, inten, rgb, free, near_bld):
    """1 m のマスごとの地面の種類 (-1 = 読めない) と、木のマス"""
    R, G, Bc = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    val = rgb.max(axis=2)
    sat = (val - rgb.min(axis=2)) / np.maximum(val, 1)
    s3 = np.maximum(R + G + Bc, 1)
    exg, rb = (2 * G - R - Bc) / s3, (R - Bc) / s3
    # 建物データに無い建物 (工事中の足場や屋上の設備は反射が複数回になる) を木と間違えないよう、
    # 周り 11 m 四方の高いマスの多くが「明るく色味の無い面」(屋根) なら木にしない
    tall = free & (hgt >= TREE_H)
    roofish = tall & (val >= 140) & (sat < 0.09)
    roof_frac = box(roofish, 5) / np.maximum(box(tall, 5), 1)
    tree = tall & ~near_bld & (mf5 >= TREE_MULTI) & (roof_frac < 0.4)
    tree = dilate(erode(tree, 1), 1) & tall                # 1 マスだけの点 (電線・電柱) を落とす
    low = free & (hgt < 0.7)
    coloured = (sat >= 0.09) & ((rb >= 0.02) | (exg >= 0.015))   # 冬の写真なので草も茶色い。色味があれば「舗装ではない」
    shadow = val < 70
    cls = np.full(hgt.shape, -1, np.int8)
    cls[low & ~coloured] = PAVED
    cls[low & ~coloured & (val >= 152)] = LIGHT            # 明るい灰色 (コンクリート・砂利・乾いた土)
    cls[low & coloured] = SOIL
    cls[low & coloured & (inten >= 1500)] = GRASS          # 草は近赤外の反射が強い
    cls[low & shadow] = np.where(inten >= 1800, GRASS, PAVED)[low & shadow]   # 影の中は色が読めないので強度だけで
    cls[tree] = WOODFLOOR
    return cls, tree, (val >= 140) & (sat < 0.09)


def smooth_cover(cls):
    """ばらつきを多数決でならし、読めなかったマス (車・塀・影) と建物・道路の下を周りから埋める"""
    k = len(CLASS_NAMES)
    known = cls >= 0
    m = mode_filter(cls, known, 2, k)                      # 5 m 四方の多数決
    out = np.where(known & (box(known, 2) >= 6), m, cls).astype(np.int8)
    for _ in range(6):                                     # 残りを外側へ広げる (建物・道路の縁の下に色をもぐり込ませる)
        miss = out < 0
        if not miss.any():
            break
        m = mode_filter(out, out >= 0, 1, k)
        out[miss] = m[miss]
    out[out < 0] = NONE
    return out


def pick_trees(hgt, tree, B, max_n=14000):
    """木のマスの中で、周りより高い所を高い順に拾う。間隔は木の高さに応じて広げる。[[x, z, 高さ], ...]"""
    h = np.where(tree, box(np.where(tree, hgt, 0), 1) / np.maximum(box(tree, 1), 1), 0)   # 3 m 四方の平均 (木のマスだけ)
    js, is_ = np.nonzero(tree)
    order = np.argsort(-h[js, is_], kind="stable")
    out = []
    for scale in (1.0, 1.15, 1.3, 1.5, 1.75, 2.0):         # 多すぎたら間隔を広げてやり直す
        cell, grid, out = 8.0, {}, []
        for k in order:
            j, i = int(js[k]), int(is_[k])
            hh = float(h[j, i])
            d = min(8.5, max(4.5, 0.5 * hh)) * scale
            x, z = B["minX"] + (i + 0.5) * RES, B["minZ"] + (j + 0.5) * RES
            ci, cj = int(x // cell), int(z // cell)
            r = int(d * 2 // cell) + 1
            if any((px - x) ** 2 + (pz - z) ** 2 < max(d, pd) ** 2
                   for a in range(ci - r, ci + r + 1) for b in range(cj - r, cj + r + 1) for px, pz, pd in grid.get((a, b), ())):
                continue
            grid.setdefault((ci, cj), []).append((x, z, d))
            out.append([round(x, 1), round(z, 1), round(hh, 1)])
        if len(out) <= max_n:
            break
    return out


def find_parking(cover, hgt, mf5, free, kind, kinds, B):
    """広い舗装のかたまりと、その上に写っている車。
    [{"rows": [[z, x0, x1], ...] (1 m 幅の帯), "angle": 並びの向き (ラジアン), "cars": [[x, z], ...], "area": m2}]"""
    paved = (cover == PAVED) | (cover == LIGHT)
    for name in ("school", "plaza", "platform", "pitch", "park", "water", "wood", "railway", "cemetery"):
        if name in kinds:
            paved &= kind != kinds.index(name)
    paved &= free
    core = dilate(erode(paved, 4), 4) & paved               # 幅 9 m 以上ある所だけ
    car = free & (hgt >= 0.9) & (hgt <= 2.3) & (mf5 < 0.3)  # 車らしい高さの物
    lots = []
    for jj, ii in label(core):
        if len(jj) < 400:
            continue
        m = np.zeros(core.shape, bool)
        m[jj, ii] = True
        j0, j1, i0, i1 = int(jj.min()), int(jj.max()) + 1, int(ii.min()), int(ii.max()) + 1
        sub = m[j0:j1, i0:i1]
        cars = []
        for cj, ci in label(car[j0:j1, i0:i1] & sub):
            if 4 <= len(cj) <= 16 and (cj.max() - cj.min()) <= 6 and (ci.max() - ci.min()) <= 6:
                cars.append([round(float(B["minX"] + (i0 + ci.mean() + 0.5) * RES), 1), round(float(B["minZ"] + (j0 + cj.mean() + 0.5) * RES), 1)])
        # 並びの向き: かたまりを囲む長方形が一番小さくなる角度
        x, z = ii.astype(np.float64), jj.astype(np.float64)
        best = (1e18, 0.0)
        for deg in range(0, 90, 3):
            a = np.radians(deg)
            u, v = x * np.cos(a) + z * np.sin(a), -x * np.sin(a) + z * np.cos(a)
            area = (u.max() - u.min()) * (v.max() - v.min())
            if area < best[0]:
                best = (area, float(a))
        rows = []
        for r in range(sub.shape[0]):
            line = np.flatnonzero(np.diff(np.concatenate(([0], sub[r].astype(np.int8), [0]))))
            for a, b in zip(line[0::2], line[1::2]):
                rows.append([int(B["minZ"] + j0 + r), int(B["minX"] + i0 + a), int(B["minX"] + i0 + b)])
        lots.append({"area": int(len(jj)), "angle": round(best[1], 3), "rows": rows, "cars": cars})
    return lots


# ---------------------------------------------------------------- 輪郭 (マスのかたまり → 多角形)
def trace_outline(m):
    """マスのかたまりの外周を、マスの角を結ぶ多角形 [(列, 行), ...] で返す (一番大きい輪。穴は無視)"""
    p = np.pad(m, 1)
    nxt = {}
    js, is_ = np.nonzero(m)
    for j, i in zip(js.tolist(), is_.tolist()):   # 外に面した辺を、かたまりを右手に見る向きで集める
        if not p[j, i + 1]:
            nxt.setdefault((i, j), []).append((i + 1, j))
        if not p[j + 1, i + 2]:
            nxt.setdefault((i + 1, j), []).append((i + 1, j + 1))
        if not p[j + 2, i + 1]:
            nxt.setdefault((i + 1, j + 1), []).append((i, j + 1))
        if not p[j + 1, i]:
            nxt.setdefault((i, j + 1), []).append((i, j))
    best, best_a = None, 0.0
    while nxt:
        start = next(iter(nxt))
        loop, cur, d = [start], start, None
        while True:
            outs = nxt[cur]
            if len(outs) > 1 and d:   # 角で 2 つのマスが接する所は、右へ曲がる方 (同じマスの次の辺) を選ぶ
                right = (cur[0] - d[1], cur[1] + d[0])
                e = right if right in outs else outs[0]
            else:
                e = outs[0]
            outs.remove(e)
            if not outs:
                del nxt[cur]
            d = (e[0] - cur[0], e[1] - cur[1])
            cur = e
            if cur == start:
                break
            loop.append(cur)
        a = abs(sum(loop[k][0] * loop[(k + 1) % len(loop)][1] - loop[(k + 1) % len(loop)][0] * loop[k][1] for k in range(len(loop)))) / 2
        if a > best_a:
            best, best_a = loop, a
    return best


def simplify(ring, tol):
    """閉じた折れ線を、ずれが tol 以内になるよう間引く (Douglas-Peucker)"""
    pts = np.asarray(ring, float)
    i0 = int(np.argmin(pts[:, 0] + pts[:, 1]))
    i1 = int(np.argmax(((pts - pts[i0]) ** 2).sum(axis=1)))

    def dp(seq):
        keep = [0, len(seq) - 1]
        stack = [(0, len(seq) - 1)]
        while stack:
            a, b = stack.pop()
            if b - a < 2:
                continue
            d = seq[b] - seq[a]
            L = float(np.hypot(*d)) or 1e-9
            dist = np.abs(d[0] * (seq[a + 1:b, 1] - seq[a, 1]) - d[1] * (seq[a + 1:b, 0] - seq[a, 0])) / L
            k = int(np.argmax(dist))
            if dist[k] > tol:
                keep.append(a + 1 + k)
                stack += [(a, a + 1 + k), (a + 1 + k, b)]
        return [seq[k] for k in sorted(keep)]
    n = len(pts)
    order = [(i0 + k) % n for k in range(n + 1)]
    cut = order.index(i1)
    half1, half2 = dp(pts[order[:cut + 1]]), dp(pts[order[cut:]])
    return [(float(x), float(z)) for x, z in half1[:-1] + half2[:-1]]


def blob_polygon(jj, ii, B, tol=1.2):
    """マスのかたまり → ローカル座標の多角形。長方形に近ければ、囲む一番小さい長方形にする"""
    x, z = ii + 0.5, jj + 0.5
    best = None
    for deg in range(0, 90, 2):
        a = np.radians(deg)
        u, v = x * np.cos(a) + z * np.sin(a), -x * np.sin(a) + z * np.cos(a)
        area = (u.max() - u.min() + 1) * (v.max() - v.min() + 1)
        if best is None or area < best[0]:
            best = (area, a, u.min() - 0.5, u.max() + 0.5, v.min() - 0.5, v.max() + 0.5)
    if len(jj) / best[0] >= 0.82:
        _, a, u0, u1, v0, v1 = best
        ring = [(u * np.cos(a) - v * np.sin(a), u * np.sin(a) + v * np.cos(a)) for u, v in ((u0, v0), (u1, v0), (u1, v1), (u0, v1))]
    else:
        m = np.zeros((int(jj.max() - jj.min()) + 1, int(ii.max() - ii.min()) + 1), bool)
        m[jj - jj.min(), ii - ii.min()] = True
        ring = [(i + ii.min(), j + jj.min()) for i, j in simplify(trace_outline(m), tol)]
    return [[round(float(B["minX"] + px * RES), 2), round(float(B["minZ"] + pz * RES), 2)] for px, pz in ring]


# ---------------------------------------------------------------- 建物データに無い建物・造成地
NEW_BLD_H = 4.5       # これより高い、木ではないかたまりを建物とみなす (m)。工事の仮囲い・コンテナ・トラック (3 m 前後) でかたまりどうしがつながらない高さ
NEW_BLD_AREA = 150    # これより小さいかたまりは足さない (m2)
SITE_AREA = 3000      # これより広い土の地面を造成地とみなす (m2)


def find_buildings(hgt, mf5, tree, roofish, flat, free, rail, kind, kinds, B):
    """点群には写っているが建物データに無い建物。[(行の配列, 列の配列, 高さ), ...]
    条件: 幅 5 m 以上・広さ NEW_BLD_AREA 以上、縁が切り立っている (周りの地面との段差がはっきりある = 盛り土や斜面ではない)、
    線路・ホーム・広場 (デッキ) の上ではない。葉を通り抜けたような反射が多いかたまりは、写真で屋根らしい色 (明るい灰色) のときだけ
    建物とする (工事中の足場は反射が複数回になる)。平らな所 (flat) がほとんど無いかたまりは鉄塔とみなして除く"""
    cand = free & (hgt >= NEW_BLD_H) & ~tree
    cand = erode(dilate(cand, 2), 2) & free & (hgt >= 3.0)   # 屋上の設備で木とみなされた小さな穴をふさぐ
    cand = dilate(erode(cand, 2), 2) & cand                  # 幅 5 m 未満の物 (塀・柱・架線) を落とす
    skip = np.zeros(hgt.shape, bool) | rail
    for name in ("platform", "plaza", "water", "wood"):
        if name in kinds:
            skip |= kind == kinds.index(name)
    out = []
    for jj, ii in label(cand):
        if len(jj) < NEW_BLD_AREA or skip[jj, ii].mean() > 0.2:
            continue
        if mf5[jj, ii].mean() > 0.55 and (roofish[jj, ii].mean() < 0.4 or flat[jj, ii].mean() < 0.1):
            continue
        h = float(np.median(hgt[jj, ii]))
        m = np.zeros(hgt.shape, bool)
        m[jj, ii] = True
        j0, j1, i0, i1 = max(0, jj.min() - 4), jj.max() + 5, max(0, ii.min() - 4), ii.max() + 5
        sub = m[j0:j1, i0:i1]
        ring = dilate(sub, 3) & ~dilate(sub, 2) & free[j0:j1, i0:i1]      # 外へ 3 マス目の輪
        # 周りの半分以上が、建物の高さの 1/3 より低い (高い建物は足場や隣の棟に囲まれやすいので少し甘くする)
        if ring.sum() >= 8 and (hgt[j0:j1, i0:i1][ring] < max(1.5, 0.35 * h)).mean() < (0.55 if h < 12 else 0.45):
            continue
        out.append((jj, ii, h))
    return out


def convex_hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def find_sites(cover, free, kind, kinds, B):
    """造成地・更地: 土の地面が周り 25 m 四方の 2 割以上を占める所のかたまり。
    土の輪郭は入り組むので、外周はかたまりを囲む凸多角形にする (仮囲いは敷地を大きく囲む)"""
    soil = free & (cover == SOIL)
    for name in ("school", "pitch", "park", "farm", "grass", "wood", "cemetery", "worship"):
        if name in kinds:
            soil &= kind != kinds.index(name)
    core = box(soil, 12) >= 0.2 * 625
    core = dilate(erode(core, 4), 4)                         # 細い所を落とす
    groups = []   # [縁の点のリスト, 面積]
    for jj, ii in label(core):
        if len(jj) < SITE_AREA or soil[jj, ii].sum() < SITE_AREA * 0.3:
            continue
        m = np.zeros(core.shape, bool)
        m[jj, ii] = True
        ej, ei = np.nonzero(m & ~erode(m, 1))                # 縁のマスだけで凸包を取る
        groups.append([list(zip((ei + 0.5).tolist(), (ej + 0.5).tolist())), int(len(jj))])

    def inside(pt, hull):
        return all((hull[(k + 1) % len(hull)][0] - hull[k][0]) * (pt[1] - hull[k][1])
                   - (hull[(k + 1) % len(hull)][1] - hull[k][1]) * (pt[0] - hull[k][0]) >= 0 for k in range(len(hull)))
    merged = True
    while merged:                                            # 囲みどうしが重なるかたまりは 1 つにまとめる (仮囲いが敷地の中を横切らないように)
        merged = False
        hulls = [convex_hull(g[0]) for g in groups]
        for a_ in range(len(groups)):
            for b_ in range(a_ + 1, len(groups)):
                if any(inside(q, hulls[a_]) for q in hulls[b_]) or any(inside(q, hulls[b_]) for q in hulls[a_]):
                    groups[a_] = [groups[a_][0] + groups[b_][0], groups[a_][1] + groups[b_][1]]
                    del groups[b_]
                    merged = True
                    break
            if merged:
                break
    return [{"kind": "construction", "area": area,
             "outer": [[round(B["minX"] + x * RES, 1), round(B["minZ"] + z * RES, 1)] for x, z in convex_hull(pts)]} for pts, area in groups]


def new_building_records(found, city, B):
    """見つけたかたまりを city.json の建物データにする (src = "lidar")。形の細部は lidar_shape.apply() が直す"""
    import build_props
    from lidar_shape import default_floors
    H = build_props.load_terrain()
    ind = [a for a in city["areas"] if a["kind"] == "industrial"]
    out = []
    for jj, ii, h in found:
        outer = blob_polygon(jj, ii, B)
        if len(outer) < 3:
            continue
        cx, cz = B["minX"] + (ii.mean() + 0.5) * RES, B["minZ"] + (jj.mean() + 0.5) * RES
        y = round(min(H(x, z) for x, z in outer), 2)
        style = "industrial" if any(build_props.pip(cx, cz, a["outer"]) for a in ind) else "commercial" if h >= 6.5 else "lowrise"
        out.append({"id": f"L{round(cx)}_{round(cz)}", "outer": outer, "src": "lidar", "code": "solid", "h": round(h, 1), "e": y,
                    "style": style, "floors": default_floors(style, h), "y": y})
    return out


# ---------------------------------------------------------------- 出力
def cover_at_vertices(cover, t, B):
    """1 m のマスの種類 → 地形の頂点 (terrain.json と同じ格子) の種類。頂点の周り 2 m 四方の多数決"""
    k = len(CLASS_NAMES)
    r = max(1, int(round(t["step"] / RES / 2)))
    xs = np.clip(np.round((t["minX"] + np.arange(t["nx"]) * t["step"] - B["minX"]) / RES).astype(int), 0, cover.shape[1] - 1)
    zs = np.clip(np.round((t["minZ"] + np.arange(t["nz"]) * t["step"] - B["minZ"]) / RES).astype(int), 0, cover.shape[0] - 1)
    votes = np.stack([box(cover == c, r)[zs[:, None], xs[None, :]] for c in range(k)])
    return np.argmax(votes, axis=0)


def run(city):
    B = city["bounds"]
    g = load_grid(B)
    shape = g["zmax"].shape
    bld, road, water, kind, kinds = city_masks(city, shape)
    rail = np.zeros(shape, bool)
    for r in city["rails"]:
        fill_ribbon(rail, B, r["pts"], 14)                 # 線路の両側 7 m (電車・架線・ホームの屋根)
    _, t = ground_abs(B, shape)
    gnd, hgt, mf5, inten = features(g, B)
    rgb = ortho_grid(B, shape)
    free = ~bld & ~road & ~water & (g["n"] > 0)
    cls, tree, roofish = classify(hgt, mf5, inten, rgb, free, dilate(bld, 2))
    # 建物データに無い建物。その上は地面でも木でもない
    zt = g["zmax"].astype(np.float32)
    pz = np.pad(zt, 1, mode="edge")
    win = [pz[a:a + shape[0], b:b + shape[1]] for a in range(3) for b in range(3)]
    flat = (np.max(win, axis=0) - np.min(win, axis=0)) < 100    # 3 m 四方の高さの差が 1 m 未満
    found = find_buildings(hgt, mf5, tree, roofish, flat, free, rail, kind, kinds, B)
    nb = np.zeros(shape, bool)
    for jj, ii, _ in found:
        nb[jj, ii] = True
    nb = dilate(nb, 2)
    free &= ~nb
    tree &= ~nb
    cls[nb] = -1
    cover = smooth_cover(cls)
    trees = pick_trees(hgt, tree, B)
    parking = find_parking(cover, hgt, mf5, free, kind, kinds, B)
    sites = find_sites(cover, free, kind, kinds, B)
    v = cover_at_vertices(cover, t, B)
    stat = {n: int((free & (cover == i)).sum()) for i, n in enumerate(CLASS_NAMES)}
    print(f"地面の種類 (建物・道路以外, m2): {stat}")
    print(f"木 {len(trees)} 本 / 広い舗装 {len(parking)} か所 ({sum(p['area'] for p in parking)} m2, 車 {sum(len(p['cars']) for p in parking)} 台)")
    print(f"建物データに無い建物 {len(found)} 棟 ({sum(len(f[0]) for f in found)} m2) / 造成地 {len(sites)} か所 ({sum(x['area'] for x in sites)} m2)")
    return {
        "cover": {"source": "神奈川県 令和3年度 3次元点群データ・オルソ画像 (CC BY 4.0) から読んだ地面の種類",
                  "step": t["step"], "minX": t["minX"], "minZ": t["minZ"], "nx": t["nx"], "nz": t["nz"],
                  "classes": CLASS_NAMES, "c": "".join(map(str, v.ravel().tolist()))},
        "lots": {"source": "tools/lidar_cover.py", "trees": trees, "parking": parking, "sites": sites},
        "buildings": new_building_records(found, city, B),
        "debug": {"cover": cover, "cls": cls, "tree": tree, "hgt": hgt, "bld": bld, "road": road, "water": water, "rgb": rgb, "mf5": mf5, "free": free, "nb": nb},
    }


def main():
    import build_props
    city = json.loads(CITY.read_text(encoding="utf-8"))
    n0 = len(city["buildings"])
    city["buildings"] = [b for b in city["buildings"] if b.get("src") != "lidar"]   # 前回足した建物 (上の段も src を引き継いでいる)
    if "--undo" in sys.argv:
        for p in (OUT_COVER, OUT_LOTS):
            if p.exists():
                p.unlink()
                print("削除:", p)
    else:
        if not ORTHO_BIN.exists():
            raise SystemExit("data/raw/ortho_rgb.bin がありません。先に python tools/fetch_ortho.py を実行してください")
        out = run(city)
        new = out["buildings"]
        import lidar_shape
        if new and lidar_shape.DSM_BIN.exists():   # 段・屋根・欠け・屋根の色を、ほかの建物と同じやり方で付ける
            new = lidar_shape.apply(new, json.loads(TERRAIN.read_text(encoding="utf-8"))["ref"])
        city["buildings"] += new
        OUT_COVER.write_text(json.dumps(out["cover"], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        OUT_LOTS.write_text(json.dumps(out["lots"], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"-> {OUT_COVER} ({OUT_COVER.stat().st_size // 1024} KB), {OUT_LOTS} ({OUT_LOTS.stat().st_size // 1024} KB)")
    if len(city["buildings"]) != n0 or "--undo" not in sys.argv:
        CITY.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"-> {CITY} (buildings {n0} -> {len(city['buildings'])})")
    build_props.main()


if __name__ == "__main__":
    main()
