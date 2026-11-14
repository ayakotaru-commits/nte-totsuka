"""点群の地面の点 (分類 2) から高精細な地形 (DTM) を作る。国土地理院 DEM (terrain.json, 4 m 間隔) との差も調べる。

使い方: python tools/lidar_terrain.py [--res 2] [--out ../data/raw/terrain_hi.npz]
やり方:
  1. 地面の点を res m の格子に入れる (各マスの一番低い値)。建物の下・木の下は点が無い
  2. 点が無いマスは「DEM との差」を周りから補って埋める (DEM + 補った差)。差は滑らかに変わるので、これで建物の下も自然な地面になる
  3. 結果と DEM の差の統計を出す
"""
import argparse
import json
import pathlib

import numpy as np

import fetch_lidar as FL
import lidar_walls as LW

ROOT = pathlib.Path(__file__).resolve().parent.parent


def fill_residual(res, valid, iters=40):
    """valid なマスの値 res を、無いマスへ周りの平均で広げる (正規化畳み込みを粗い所から細かい所へ)"""
    val = np.where(valid, res, 0.0)
    w = valid.astype(np.float64)
    out = val.copy()
    known = valid.copy()
    for r in (16, 8, 4, 2, 1):
        k = 2 * r + 1
        def box(a):
            c = np.cumsum(np.pad(a, ((r + 1, r), (r + 1, r))), axis=0)
            c = c[k:] - c[:-k]
            c = np.cumsum(c, axis=1)
            return c[:, k:] - c[:, :-k]
        s, n = box(val * w), box(w)
        est = np.divide(s, n, out=np.zeros_like(s), where=n > 0)
        fillable = (~known) & (n > 0)
        out[fillable] = est[fillable]
        known |= fillable
        val, w = np.where(known, out, 0.0), known.astype(np.float64)
    return out, known


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--res", type=float, default=2.0)
    ap.add_argument("--out", default=str(ROOT / "data" / "raw" / "terrain_hi.npz"))
    args = ap.parse_args()
    LW.RES = args.res
    LW.CLASSES = tuple(range(256))  # この点群は分類が当てにならないので、全部の点の「各マスの最低点」を使う
    B = FL.BOUNDS
    win = (B["minX"], B["maxX"], B["minZ"], B["maxZ"])
    T, _ = FL.plane_to_local()
    zips = sorted(FL.CACHE.glob("*.zip"))
    g, nx, nz = LW.ground_grid(win, T, zips)
    t = json.loads((ROOT / "public" / "data" / "terrain.json").read_text(encoding="utf-8"))
    ref = t["ref"]
    dem = np.array(t["h"], dtype=np.float64).reshape(t["nz"], t["nx"]) / 100
    # 各マスの中心で DEM を補間
    xs = win[0] + (np.arange(nx) + 0.5) * args.res
    zs = win[2] + (np.arange(nz) + 0.5) * args.res
    fx = np.clip((xs - t["minX"]) / t["step"], 0, t["nx"] - 1.001)
    fz = np.clip((zs - t["minZ"]) / t["step"], 0, t["nz"] - 1.001)
    i, j = fx.astype(int), fz.astype(int)
    u, v = (fx - i)[None, :], (fz - j)[:, None]
    I, J = i[None, :], j[:, None]
    D = dem[J, I] * (1 - u) * (1 - v) + dem[J, I + 1] * u * (1 - v) + dem[J + 1, I] * (1 - u) * v + dem[J + 1, I + 1] * u * v
    valid = g != LW.NODATA
    lid = g.astype(np.float64) / 100 - ref
    inside = (xs[None, :] >= t["minX"]) & (xs[None, :] < t["minX"] + (t["nx"] - 1) * t["step"]) & (zs[:, None] >= t["minZ"]) & (zs[:, None] < t["minZ"] + (t["nz"] - 1) * t["step"])
    d = np.where(valid, lid - D, 0.0)
    # 屋根・木・車を除く。(1) DEM から大きく外れた点を捨てる (2) 周り 5x5 マスの最低の差より 0.7 m 以上高い点を捨てる (屋根の縁・低木)
    valid &= (d > -3.0) & (d < 2.5)
    for _ in range(2):
        big = np.where(valid, d, 99.0)
        p = np.pad(big, 2, constant_values=99.0)
        lmin = np.min([p[dj:dj + nz, di:di + nx] for dj in range(5) for di in range(5)], axis=0)
        valid &= d <= lmin + 0.7
    d = np.where(valid, d, 0.0)
    resid, known = fill_residual(d, valid)
    dtm = np.where(known, D + resid, D)
    print(f"格子 {nx}x{nz} ({args.res} m), 点のあるマス {100 * valid.mean():.1f}%, 補ったマス {100 * (known & ~valid).mean():.1f}%")
    dv = d[valid & inside]
    print(f"点群 - DEM: 中央値 {np.median(dv):+.2f} m, 絶対値の 90% 点 {np.percentile(np.abs(dv), 90):.2f} m, 1 m 超 {100 * np.mean(np.abs(dv) > 1):.1f}%, 2 m 超 {100 * np.mean(np.abs(dv) > 2):.1f}%")
    np.savez_compressed(args.out, dtm=dtm.astype(np.float32), valid=valid, minX=win[0], minZ=win[2], res=args.res)
    print("->", args.out)


if __name__ == "__main__":
    main()
