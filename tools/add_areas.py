"""OSM のエリアのうち、後から対応した種類 (工業用地・墓地・寺社・病院の敷地) だけを、今の city.json に足す。

使い方: python tools/add_areas.py          (data/raw/osm.json が必要)
        python tools/add_areas.py --undo   足した敷地を消す

build_city.py を通しで実行できない・したくないとき用 (通しで実行すれば同じ敷地が入るので、これは要らない)。
エリアの作り方は build_city.py の osm_areas() をそのまま使う。最後に build_props.py を実行する。
"""
import json
import sys

import build_city as BC

NEW_KINDS = {"industrial", "cemetery", "worship", "hospital"}


def main():
    city = json.loads(BC.DST.read_text(encoding="utf-8"))
    before = len(city["areas"])
    # 前回足した敷地を消す。別の種類から置き換えた敷地 (kind0 付き) は元の種類に戻す
    kept = []
    for a in city["areas"]:
        if a["kind"] in NEW_KINDS:
            if "kind0" not in a:
                continue
            a["kind"] = a.pop("kind0")
        kept.append(a)
    city["areas"] = kept
    city["pois"] = [p for p in city["pois"] if not (p.get("cat", "").startswith("area:") and p["cat"][5:] in NEW_KINDS)]
    added = []
    if "--undo" not in sys.argv:
        for el in json.loads(BC.SRC.read_text(encoding="utf-8"))["elements"]:
            t = el.get("tags", {})
            # build_city.py の main() で、エリアより先に別の物として扱われる要素は除く
            if "building" in t or "building:part" in t:
                continue
            if el["type"] == "way" and ("highway" in t or "railway" in t or "waterway" in t) and "geometry" in el:
                continue
            added += [a for a in BC.osm_areas(el, t) if a["kind"] in NEW_KINDS]
        # 以前は別の種類 (草地) として入っていた同じ形のエリアは置き換える (元の種類を kind0 に残す)
        old = {json.dumps(a["outer"]): a["kind"] for a in city["areas"]}
        for a in added:
            k = old.get(json.dumps(a["outer"]))
            if k:
                a["kind0"] = k
        same = {json.dumps(a["outer"]) for a in added}
        city["areas"] = [a for a in city["areas"] if json.dumps(a["outer"]) not in same] + added
        for a in added:
            if a.get("name") and a["kind"] in BC.POI_AREA_KINDS:
                c = BC.centroid(a["outer"])
                if BC.in_limit(c):
                    city["pois"].append({"name": a["name"], "x": round(c[0], 1), "z": round(c[1], 1), "cat": f"area:{a['kind']}"})
    city["areas"].sort(key=lambda a: -abs(BC.area2(a["outer"])))   # 面積の大きい順 (build_city.py と同じ。小さい面が上に描かれる)
    BC.DST.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    kinds = {}
    for a in added:
        kinds[a["kind"]] = kinds.get(a["kind"], 0) + 1
    print(f"areas {before} -> {len(city['areas'])} (足した敷地: {kinds})")
    import build_props
    build_props.main()


if __name__ == "__main__":
    main()
