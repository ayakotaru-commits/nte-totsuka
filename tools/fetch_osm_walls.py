"""OSM から擁壁・崖・盛土の線だけを取る (fetch_osm.py とは別。osm.json は書き換えない)。
使い方: python tools/fetch_osm_walls.py   出力: data/raw/osm_walls.json
"""
import json
import pathlib
import urllib.parse
import urllib.request

from config import BBOX
import fetch_osm

s, w, n, e = BBOX
bbox = f"{s},{w},{n},{e}"
QUERY = f"""
[out:json][timeout:120];
(
  way["barrier"="retaining_wall"]({bbox});
  way["man_made"="embankment"]({bbox});
  way["natural"="cliff"]({bbox});
  way["embankment"="yes"]({bbox});
);
out geom;
"""

if __name__ == "__main__":
    out = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw" / "osm_walls.json"
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    for url in fetch_osm.ENDPOINTS:
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": "personal-city-viewer/0.1"})
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.loads(r.read())
            out.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            print(f"saved {len(data.get('elements', []))} elements from {url} -> {out}")
            break
        except Exception as ex:  # noqa: BLE001
            print("failed:", url, ex)
