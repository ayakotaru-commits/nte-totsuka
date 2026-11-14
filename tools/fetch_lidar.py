"""神奈川県の航空レーザ測量の点群 (オリジナルデータ, LAS) を取得し、建物の形づくり用の高さ格子 (DSM) を作る。

使い方: python tools/fetch_lidar.py
出力:   data/raw/lidar/<図郭>.zip (キャッシュ, 1つ約100MB・全部で約800MB)
        data/raw/lidar_dsm.bin   高さ格子 (int16, 標高 cm, 行 = z, 列 = x。データ無し = -32768)
        data/raw/lidar_dsm.json  格子の原点・間隔・大きさ
出典:   神奈川県 令和3年度 横浜南部、湘南、横須賀三浦 3次元点群データ (CC BY 4.0, G空間情報センター)
        https://www.geospatial.jp/ckan/dataset/kanagawa-2021-pointcloud

点は 1 m2 あたり約 10 点。各マス (0.5 m) には、屋根や地面のような「反射が1回だけの点」の一番高い値を入れる
(木の葉は反射が複数回になるので、木に隠れた屋根を拾いやすい)。無ければ最後の反射の一番高い値。
標準ライブラリだけで動く (numpy があれば速い)。
"""
import array
import gzip
import json
import math
import pathlib
import struct
import sys
import urllib.request
import zipfile

import mvt
from config import BBOX, BOUNDS, ORIGIN_LAT, ORIGIN_LON, _M_LAT, _M_LON

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CACHE = RAW / "lidar"
OUT_BIN = RAW / "lidar_dsm.bin"
OUT_META = RAW / "lidar_dsm.json"

INDEX_URL = "https://gic-kanagawa.s3.ap-northeast-1.amazonaws.com/div/2021/Vectortile2025/orglas/{z}/{x}/{y}.pbf"
INDEX_Z = 13
RES = 0.5      # 格子の間隔 (m)
MARGIN = 20    # マップ範囲の外側に取る余白 (m)
NODATA = -32768
UA = {"User-Agent": "personal-city-viewer/0.1"}


# ---- 緯度経度 → 平面直角座標系 (JGD2011 第IX系)。LAS の座標はこの系 (X = 東, Y = 北) ----
def latlon_to_plane(lat, lon, lat0=36.0, lon0=139 + 50 / 60):
    a, f, m0 = 6378137.0, 1 / 298.257222101, 0.9999
    phi, lam, phi0, lam0 = map(math.radians, (lat, lon, lat0, lon0))
    n = f / (2 - f)
    A = [1 + n**2 / 4 + n**4 / 64, -3 / 2 * (n - n**3 / 8 - n**5 / 64), 15 / 16 * (n**2 - n**4 / 4),
         -35 / 48 * (n**3 - 5 / 16 * n**5), 315 / 512 * n**4, -693 / 1280 * n**5]
    al = [0, n / 2 - 2 / 3 * n**2 + 5 / 16 * n**3 + 41 / 180 * n**4 - 127 / 288 * n**5,
          13 / 48 * n**2 - 3 / 5 * n**3 + 557 / 1440 * n**4 + 281 / 630 * n**5,
          61 / 240 * n**3 - 103 / 140 * n**4 + 15061 / 26880 * n**5,
          49561 / 161280 * n**4 - 179 / 168 * n**5, 34729 / 80640 * n**5]
    ab = m0 * a / (1 + n) * A[0]
    s0 = m0 * a / (1 + n) * (A[0] * phi0 + sum(A[j] * math.sin(2 * j * phi0) for j in range(1, 6)))
    t = math.sinh(math.atanh(math.sin(phi)) - 2 * math.sqrt(n) / (1 + n) * math.atanh(2 * math.sqrt(n) / (1 + n) * math.sin(phi)))
    xi, eta = math.atan2(t, math.cos(lam - lam0)), math.atanh(math.sin(lam - lam0) / math.sqrt(1 + t * t))
    north = ab * (xi + sum(al[j] * math.sin(2 * j * xi) * math.cosh(2 * j * eta) for j in range(1, 6))) - s0
    east = ab * (eta + sum(al[j] * math.cos(2 * j * xi) * math.sinh(2 * j * eta) for j in range(1, 6)))
    return east, north


def solve3(m, v):
    """3x3 連立一次方程式 (ガウスの消去法)"""
    m = [row[:] + [v[i]] for i, row in enumerate(m)]
    for i in range(3):
        p = max(range(i, 3), key=lambda r: abs(m[r][i]))
        m[i], m[p] = m[p], m[i]
        for r in range(3):
            if r != i:
                k = m[r][i] / m[i][i]
                m[r] = [a - k * b for a, b in zip(m[r], m[i])]
    return [m[i][3] / m[i][i] for i in range(3)]


def plane_to_local():
    """平面直角 (E, N) → ゲームのローカル座標 (x = 東, z = 南) のアフィン変換 (a, b, c, d, e, f):
    x = a*E + b*N + c, z = d*E + e*N + f。マップ範囲で最小二乗 (誤差は 0.2 m 未満)"""
    pts = []
    for x in range(BOUNDS["minX"] - 200, BOUNDS["maxX"] + 201, 100):
        for z in range(BOUNDS["minZ"] - 200, BOUNDS["maxZ"] + 201, 100):
            e, n = latlon_to_plane(ORIGIN_LAT - z / _M_LAT, ORIGIN_LON + x / _M_LON)
            pts.append((e, n, x, z))
    e0, n0 = pts[0][0], pts[0][1]  # 桁落ちを避けるため原点をずらして解く
    rows = [(e - e0, n - n0, 1.0) for e, n, _, _ in pts]
    ata = [[sum(r[i] * r[j] for r in rows) for j in range(3)] for i in range(3)]
    out = []
    for k in (2, 3):
        a, b, c = solve3(ata, [sum(r[i] * p[k] for r, p in zip(rows, pts)) for i in range(3)])
        out += [a, b, c - a * e0 - b * n0]
    err = max(max(abs(out[0] * e + out[1] * n + out[2] - x), abs(out[3] * e + out[4] * n + out[5] - z)) for e, n, x, z in pts)
    return out, err


# ---- 図郭の一覧 (G空間情報センターの索引ベクトルタイル) ----
def mesh_list(index_url=None):
    """マップ範囲にかかる図郭の [(図郭名, zip の URL)]。index_url を変えると航空写真などほかの種類も引ける"""
    index_url = index_url or INDEX_URL
    s, w, n, e = BBOX
    k = 2 ** INDEX_Z

    def txy(lat, lon):
        return int((lon + 180) / 360 * k), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * k)

    x0, y1 = txy(s, w)
    x1, y0 = txy(n, e)
    found = {}
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            with urllib.request.urlopen(urllib.request.Request(index_url.format(z=INDEX_Z, x=x, y=y), headers=UA), timeout=60) as r:
                data = r.read()
            if data[:2] == b"\x1f\x8b":
                data = gzip.decompress(data)
            for layer in mvt.decode(data).values():
                ext = layer["extent"]
                for f in layer["features"]:
                    lons = [(x + px / ext) / k * 360 - 180 for px, _ in f["geom"][0]]
                    lats = [math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / ext) / k)))) for _, py in f["geom"][0]]
                    if max(lons) < w or min(lons) > e or max(lats) < s or min(lats) > n:
                        continue
                    found[f["props"]["MESH_NO"]] = f["props"]["URL"]
    return sorted(found.items())


def download(url, dst):
    if dst.exists() and dst.stat().st_size > 0:
        return
    tmp = dst.with_suffix(".part")
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r, open(tmp, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            print(f"\r    {done >> 20} / {total >> 20} MB", end="", flush=True)
    print()
    tmp.rename(dst)


# ---- LAS を読んで格子に入れる ----
def rasterize(f, grid, T):
    """f: LAS のファイルオブジェクト。grid = (single, last): 反射1回の点の最大 / 最後の反射の最大 (cm)"""
    single, last = grid["single"], grid["last"]
    nx, nz, gx0, gz0 = grid["nx"], grid["nz"], grid["minX"], grid["minZ"]
    h = f.read(227)
    if h[:4] != b"LASF":
        raise SystemExit("LAS ではありません")
    offset, = struct.unpack_from("<I", h, 96)
    fmt, reclen, npts = struct.unpack_from("<BHI", h, 104)
    sx, sy, sz, ox, oy, oz = struct.unpack_from("<6d", h, 131)
    if fmt > 5 or reclen < 20:
        raise SystemExit(f"未対応の LAS 点形式 {fmt}")
    f.read(offset - 227)
    a, b, c, d, e, ff = T
    inv = 1 / RES
    # X, Y (整数) → 格子の位置 (小数) の係数
    kxx, kxy, kx0 = a * sx * inv, b * sy * inv, (a * ox + b * oy + c - gx0) * inv
    kzx, kzy, kz0 = d * sx * inv, e * sy * inv, (d * ox + e * oy + ff - gz0) * inv
    zk, z0 = sz * 100, oz * 100
    try:
        import numpy as np
    except ImportError:
        np = None
    left, used = npts, 0
    while left > 0:
        n = min(left, 2_000_000)
        buf = f.read(n * reclen)
        n = len(buf) // reclen
        if n == 0:
            break
        left -= n
        if np is not None:
            rec = np.frombuffer(buf, dtype=np.dtype({"names": ["X", "Y", "Z", "fl"], "formats": ["<i4", "<i4", "<i4", "u1"],
                                                     "offsets": [0, 4, 8, 14], "itemsize": reclen}), count=n)
            i = np.floor(rec["X"] * kxx + rec["Y"] * kxy + kx0).astype(np.int64)
            j = np.floor(rec["X"] * kzx + rec["Y"] * kzy + kz0).astype(np.int64)
            ok = (i >= 0) & (i < nx) & (j >= 0) & (j < nz)
            idx = (j * nx + i)[ok]
            zc = np.clip(np.floor(rec["Z"][ok] * zk + z0 + 0.5), -32000, 32000).astype(np.int16)
            fl = rec["fl"][ok]
            rn, nr = fl & 7, (fl >> 3) & 7
            for arr, m in ((single, nr <= 1), (last, rn >= nr)):
                v = np.frombuffer(arr, dtype=np.int16)
                np.maximum.at(v, idx[m], zc[m])
            used += int(ok.sum())
        else:
            if reclen % 4 == 0:
                ints = array.array("i")
                ints.frombytes(buf[:n * reclen])
                if sys.byteorder != "little":
                    ints.byteswap()
                step = reclen // 4
                xs, ys, zs = ints[0::step], ints[1::step], ints[2::step]
            else:
                xs, ys, zs = zip(*(r[:3] for r in struct.iter_unpack(f"<iii{reclen - 12}x", buf[:n * reclen])))
            for X, Y, Z, fl in zip(xs, ys, zs, buf[14::reclen]):
                fi = X * kxx + Y * kxy + kx0
                fj = X * kzx + Y * kzy + kz0
                if fi < 0 or fj < 0 or fi >= nx or fj >= nz:
                    continue
                k = int(fj) * nx + int(fi)
                zc = math.floor(Z * zk + z0 + 0.5)
                nr = (fl >> 3) & 7
                if nr <= 1:
                    if zc > single[k]:
                        single[k] = zc
                elif (fl & 7) >= nr and zc > last[k]:
                    last[k] = zc
                used += 1
    return npts, used


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    T, err = plane_to_local()
    print(f"座標変換の最大誤差 {err:.2f} m")
    nx = int((BOUNDS["maxX"] - BOUNDS["minX"] + 2 * MARGIN) / RES)
    nz = int((BOUNDS["maxZ"] - BOUNDS["minZ"] + 2 * MARGIN) / RES)
    grid = {"nx": nx, "nz": nz, "minX": BOUNDS["minX"] - MARGIN, "minZ": BOUNDS["minZ"] - MARGIN,
            "single": array.array("h", [NODATA]) * (nx * nz), "last": array.array("h", [NODATA]) * (nx * nz)}
    meshes = mesh_list()
    print(f"図郭 {len(meshes)} 個: {' '.join(m for m, _ in meshes)}")
    for name, url in meshes:
        z = CACHE / f"{name}.zip"
        print(f"  {name}")
        download(url, z)
        with zipfile.ZipFile(z) as zf:
            las = next(i for i in zf.namelist() if i.lower().endswith(".las"))
            with zf.open(las) as f:
                npts, used = rasterize(f, grid, T)
        print(f"    点 {npts:,} 個 (範囲内 {used:,})")
    single, last = grid["single"], grid["last"]
    filled = 0
    for k in range(nx * nz):
        if single[k] == NODATA:
            single[k] = last[k]
        if single[k] != NODATA:
            filled += 1
    if sys.byteorder != "little":
        single.byteswap()
    OUT_BIN.write_bytes(single.tobytes())
    OUT_META.write_text(json.dumps({
        "source": "神奈川県 令和3年度 横浜南部、湘南、横須賀三浦 3次元点群データ (CC BY 4.0)",
        "res": RES, "minX": grid["minX"], "minZ": grid["minZ"], "nx": nx, "nz": nz, "unit": "cm (標高)", "nodata": NODATA,
    }, ensure_ascii=False), encoding="utf-8")
    print(f"格子 {nx}x{nz} ({RES} m), データのあるマス {100 * filled / (nx * nz):.1f}% -> {OUT_BIN}")


if __name__ == "__main__":
    main()
