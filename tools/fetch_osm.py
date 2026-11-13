"""OpenStreetMap (Overpass API) から戸塚駅周辺のデータを取得する。

使い方: python tools/fetch_osm.py
出力:   data/raw/osm.json
データ: (c) OpenStreetMap contributors, ODbL
"""
import json
import pathlib
import urllib.parse
import urllib.request

from config import BBOX  # (south, west, north, east)

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

s, w, n, e = BBOX
bbox = f"{s},{w},{n},{e}"
QUERY = f"""
[out:json][timeout:120];
(
  way["building"]({bbox});
  relation["building"]({bbox});
  way["building:part"]({bbox});
  way["highway"]({bbox});
  way["railway"]({bbox});
  way["waterway"]({bbox});
  way["natural"]({bbox});
  relation["natural"="water"]({bbox});
  way["landuse"]({bbox});
  way["leisure"]({bbox});
  way["amenity"]({bbox});
  node["name"]({bbox});
  node["highway"~"^(traffic_signals|bus_stop)$"]({bbox});
  node["crossing"="traffic_signals"]({bbox});
);
out geom;
"""

def main():
    out = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw" / "osm.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    last_err = None
    for url in ENDPOINTS:
        try:
            print(f"fetching from {url} ...")
            req = urllib.request.Request(url, data=body, headers={"User-Agent": "personal-city-viewer/0.1"})
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.loads(r.read())
            out.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            print(f"saved {len(data.get('elements', []))} elements -> {out}")
            return
        except Exception as ex:  # noqa: BLE001
            print(f"  failed: {ex}")
            last_err = ex
    raise SystemExit(f"all endpoints failed: {last_err}")

if __name__ == "__main__":
    main()
