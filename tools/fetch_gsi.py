"""国土地理院ベクトルタイル (optimal_bvmap-v1, z16) から建物の輪郭 (BldA) を取得する。

使い方: python tools/fetch_gsi.py
出力:   data/raw/gsi/16_x_y.pbf (キャッシュ), data/raw/gsi_bldg.json
出典:   国土地理院ベクトルタイル (基盤地図情報・電子国土基本図に基づく)
元に戻す: data/raw/gsi_bldg.json を削除すれば build_city.py は PLATEAU ベースに戻る
"""
import json
import math
import pathlib
import time
import urllib.request

from config import BBOX
from mvt import decode

Z = 16
URL = "https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/{z}/{x}/{y}.pbf"
ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "raw" / "gsi"
OUT = ROOT / "data" / "raw" / "gsi_bldg.json"
UA = {"User-Agent": "personal-city-viewer/0.1"}

# vt_code: 3101 普通建物 / 3102 堅ろう建物 / 3103 高層建物 / 3111 普通無壁舎 / 3112 堅ろう無壁舎
CODE_NAME = {3101: "normal", 3102: "solid", 3103: "highrise", 3111: "open_normal", 3112: "open_solid"}


def tile_xy(lat, lon, z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def to_latlon(gx, gy, z):
    n = 2 ** z
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy / n)))), gx / n * 360 - 180


def clip(ring, lo, hi):
    """軸平行の正方形 [lo,hi]^2 でポリゴンを切り取る (Sutherland-Hodgman)。タイルのバッファ部分の重複除去用"""
    def clip_edge(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia, ib = inside(a), inside(b)
            if ib:
                if not ia: out.append(inter(a, b))
                out.append(b)
            elif ia:
                out.append(inter(a, b))
        return out
    def ix(a, b, x): t = (x - a[0]) / (b[0] - a[0]); return (x, a[1] + (b[1] - a[1]) * t)
    def iy(a, b, y): t = (y - a[1]) / (b[1] - a[1]); return (a[0] + (b[0] - a[0]) * t, y)
    p = ring
    for inside, inter in (
        (lambda q: q[0] >= lo, lambda a, b: ix(a, b, lo)),
        (lambda q: q[0] <= hi, lambda a, b: ix(a, b, hi)),
        (lambda q: q[1] >= lo, lambda a, b: iy(a, b, lo)),
        (lambda q: q[1] <= hi, lambda a, b: iy(a, b, hi)),
    ):
        if not p: break
        p = clip_edge(p, inside, inter)
    return p


def area(r):
    return abs(sum(r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1] for i in range(len(r)))) / 2


def main():
    s, w, n, e = BBOX
    x0, y0 = tile_xy(n, w, Z)
    x1, y1 = tile_xy(s, e, Z)
    CACHE.mkdir(parents=True, exist_ok=True)
    out = []
    for ty in range(int(y0), int(y1) + 1):
        for tx in range(int(x0), int(x1) + 1):
            path = CACHE / f"{Z}_{tx}_{ty}.pbf"
            if not path.exists():
                with urllib.request.urlopen(urllib.request.Request(URL.format(z=Z, x=tx, y=ty), headers=UA), timeout=60) as r:
                    path.write_bytes(r.read())
                time.sleep(0.1)
            layer = decode(path.read_bytes()).get("BldA")
            if not layer:
                continue
            ext = layer["extent"]
            for f in layer["features"]:
                if f["type"] != 3:
                    continue
                rings = [clip(r, 0, ext) for r in f["geom"]]
                rings = [r for r in rings if len(r) >= 3 and area(r) > 0.5]
                if not rings:
                    continue
                # 先頭 (外周) と、それに続く穴に分ける。MVT は外周と穴を符号付き面積で区別する
                def sgn(r): return sum(r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1] for i in range(len(r)))
                polys = []
                for r in rings:
                    ll = [list(to_latlon(tx + px / ext, ty + py / ext, Z)) for px, py in r]
                    ll = [[round(a, 8), round(b, 8)] for a, b in ll]
                    if sgn(r) > 0 or not polys:
                        polys.append({"outer": ll, "holes": []})
                    else:
                        polys[-1]["holes"].append(ll)
                for p in polys:
                    p["code"] = CODE_NAME.get(f["props"].get("vt_code"), str(f["props"].get("vt_code")))
                    out.append(p)
    OUT.write_text(json.dumps({"source": "国土地理院ベクトルタイル optimal_bvmap-v1", "buildings": out}, ensure_ascii=False), encoding="utf-8")
    print(f"{len(out)} building polygons -> {OUT}")


if __name__ == "__main__":
    main()
