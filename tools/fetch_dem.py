"""国土地理院 標高タイル (DEM5A, 無ければ DEM5B / DEM10B) からマップ範囲の標高グリッドを作る。

使い方: python tools/fetch_dem.py
出力:   data/raw/dem/<種類>_15_x_y.txt (キャッシュ), public/data/terrain.json
        terrain.json: step(m)・原点(minX,minZ)・格子数(nx,nz)・基準標高 ref(m, 原点=戸塚駅付近)・h(相対標高 cm, z 行優先)
出典:   国土地理院 標高タイル
元に戻す: public/data/terrain.json を削除すれば平らな地面に戻る
"""
import json
import math
import pathlib
import time
import urllib.request

from config import BOUNDS, ORIGIN_LAT, ORIGIN_LON

Z = 15
STEP = 4.0
KINDS = ["dem5a", "dem5b", "dem10b"]  # 優先順
URL = "https://cyberjapandata.gsi.go.jp/xyz/{k}/{z}/{x}/{y}.txt"
ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "raw" / "dem"
OUT = ROOT / "public" / "data" / "terrain.json"
UA = {"User-Agent": "personal-city-viewer/0.1"}
M_LAT = 110574.0
M_LON = 111320.0 * math.cos(math.radians(ORIGIN_LAT))

_tiles = {}


def tile(kind, tx, ty):
    key = (kind, tx, ty)
    if key in _tiles:
        return _tiles[key]
    path = CACHE / f"{kind}_{Z}_{tx}_{ty}.txt"
    if not path.exists():
        try:
            with urllib.request.urlopen(urllib.request.Request(URL.format(k=kind, z=Z, x=tx, y=ty), headers=UA), timeout=60) as r:
                path.write_bytes(r.read())
        except Exception:  # noqa: BLE001  (範囲外は 404)
            path.write_text("")
        time.sleep(0.05)
    rows = [l.strip().split(",") for l in path.read_text().splitlines() if l.strip()]
    grid = [[None if v == "e" else float(v) for v in row] for row in rows] if rows else None
    _tiles[key] = grid
    return grid


def elev(lat, lon):
    n = 2 ** Z
    gx = (lon + 180) / 360 * n * 256 - 0.5
    gy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n * 256 - 0.5
    x0, y0 = math.floor(gx), math.floor(gy)
    fx, fy = gx - x0, gy - y0
    for kind in KINDS:
        vals = []
        for dy in (0, 1):
            for dx in (0, 1):
                px, py = x0 + dx, y0 + dy
                g = tile(kind, px // 256, py // 256)
                vals.append(g[py % 256][px % 256] if g else None)
        if all(v is not None for v in vals):
            a, b, c, d = vals
            return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
        ok = [v for v in vals if v is not None]
        if ok and kind == KINDS[-1]:
            return sum(ok) / len(ok)
    return None


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    minX, maxX, minZ, maxZ = BOUNDS["minX"], BOUNDS["maxX"], BOUNDS["minZ"], BOUNDS["maxZ"]
    nx = int((maxX - minX) / STEP) + 1
    nz = int((maxZ - minZ) / STEP) + 1
    grid = []
    for j in range(nz):
        z = minZ + j * STEP
        row = []
        for i in range(nx):
            x = minX + i * STEP
            row.append(elev(ORIGIN_LAT - z / M_LAT, ORIGIN_LON + x / M_LON))
        grid.append(row)
        if j % 100 == 0:
            print(f"  row {j}/{nz}")
    # 欠損を周囲の平均で埋める
    missing = sum(v is None for r in grid for v in r)
    for _ in range(50):
        if not any(v is None for r in grid for v in r):
            break
        new = [r[:] for r in grid]
        for j in range(nz):
            for i in range(nx):
                if grid[j][i] is None:
                    nb = [grid[jj][ii] for jj, ii in ((j - 1, i), (j + 1, i), (j, i - 1), (j, i + 1))
                          if 0 <= jj < nz and 0 <= ii < nx and grid[jj][ii] is not None]
                    if nb:
                        new[j][i] = sum(nb) / len(nb)
        grid = new
    ref = elev(ORIGIN_LAT, ORIGIN_LON) or 0.0
    flat = [round(((v if v is not None else ref) - ref) * 100) for r in grid for v in r]
    OUT.write_text(json.dumps({"source": "国土地理院 標高タイル (DEM5A/5B/10B)", "step": STEP, "minX": minX, "minZ": minZ,
                               "nx": nx, "nz": nz, "ref": round(ref, 2), "h": flat}, separators=(",", ":")), encoding="utf-8")
    hs = [v / 100 for v in flat]
    print(f"grid {nx}x{nz}, missing filled {missing}, ref {ref:.1f} m, relative min {min(hs):.1f} / max {max(hs):.1f} m -> {OUT}")


if __name__ == "__main__":
    main()
