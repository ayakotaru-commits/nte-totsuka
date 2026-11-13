"""グランシティ パレ・ド・リヴァージュ周辺に Mapillary の路上写真があるか確認し、確認用に縮小画像を保存する。

準備: Mapillary のクライアントトークン (MLY|...) を data/mapillary_token.txt に1行で保存
使い方: python tools/mapillary_check.py
出力:  件数・撮影日・全天球かどうか、data/raw/mapillary/*.jpg (建物に近い順に最大 12 枚)
ライセンス: Mapillary の画像は CC BY-SA 4.0
"""
import datetime
import json
import math
import pathlib
import urllib.parse
import urllib.request

from config import ORIGIN_LAT, ORIGIN_LON

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOKEN = ROOT / "data" / "mapillary_token.txt"
OUT = ROOT / "data" / "raw" / "mapillary"

# マンション敷地 (ローカル座標 m) + 周囲 60m
X0, X1, Z0, Z1, MARGIN = -310, -160, 1375, 1500, 60
M_LAT = 110574.0
M_LON = 111320.0 * math.cos(math.radians(ORIGIN_LAT))


def to_ll(x, z):
    return ORIGIN_LAT - z / M_LAT, ORIGIN_LON + x / M_LON


def to_xz(lat, lon):
    return (lon - ORIGIN_LON) * M_LON, -(lat - ORIGIN_LAT) * M_LAT


def main():
    if not TOKEN.exists():
        raise SystemExit(f"トークンがありません: {TOKEN}")
    token = TOKEN.read_text(encoding="utf-8").strip()
    s, w = to_ll(X0 - MARGIN, Z1 + MARGIN)
    n, e = to_ll(X1 + MARGIN, Z0 - MARGIN)
    q = urllib.parse.urlencode({
        "access_token": token,
        "bbox": f"{w:.6f},{s:.6f},{e:.6f},{n:.6f}",
        "fields": "id,captured_at,compass_angle,computed_compass_angle,computed_geometry,geometry,is_pano,thumb_1024_url,creator",
        "limit": 2000,
    })
    with urllib.request.urlopen(urllib.request.Request("https://graph.mapillary.com/images?" + q,
                                                       headers={"User-Agent": "personal-city-viewer/0.1"}), timeout=60) as r:
        data = json.loads(r.read()).get("data", [])
    print(f"写真: {len(data)} 枚 (範囲 約{X1 - X0 + 2 * MARGIN}m x {Z1 - Z0 + 2 * MARGIN}m)")
    if not data:
        return
    cx, cz = (X0 + X1) / 2, (Z0 + Z1) / 2
    rows = []
    for d in data:
        lon, lat = (d.get("computed_geometry") or d["geometry"])["coordinates"]
        x, z = to_xz(lat, lon)
        # 敷地の外周までの距離 (おおよそ)
        dx = max(X0 - x, 0, x - X1); dz = max(Z0 - z, 0, z - Z1)
        rows.append({
            "id": d["id"], "x": round(x, 1), "z": round(z, 1), "dist": round(math.hypot(dx, dz), 1),
            "date": datetime.datetime.fromtimestamp(d["captured_at"] / 1000).strftime("%Y-%m-%d"),
            "heading": round(d.get("computed_compass_angle") or d.get("compass_angle") or 0),
            "pano": d.get("is_pano", False), "url": d.get("thumb_1024_url"),
        })
    years = {}
    for r in rows:
        years[r["date"][:4]] = years.get(r["date"][:4], 0) + 1
    print("撮影年:", dict(sorted(years.items())))
    print("全天球:", sum(r["pano"] for r in rows), "枚")
    near = sorted(rows, key=lambda r: r["dist"])
    print("敷地から 15m 以内:", sum(r["dist"] <= 15 for r in rows), "枚")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.json").write_text(json.dumps(near, ensure_ascii=False, indent=1), encoding="utf-8")
    for r in near[:12]:
        if not r["url"]:
            continue
        p = OUT / f"{r['id']}.jpg"
        if not p.exists():
            with urllib.request.urlopen(r["url"], timeout=60) as resp:
                p.write_bytes(resp.read())
        print(f"  {p.name}  {r['date']}  位置({r['x']},{r['z']})  敷地まで{r['dist']}m  向き{r['heading']}°  {'全天球' if r['pano'] else ''}")


if __name__ == "__main__":
    main()
