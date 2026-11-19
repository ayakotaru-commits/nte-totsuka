"""神社の社殿 (data/appearance.json の shrines) を作るため、PLATEAU の建物 (灰色の箱) を描かない・当たらないようにする。

社殿の形と外観は public/src/shrine.js が描き、配置・地面の高さ・当たり判定は tools/build_props.py が props.json の shrines に書く。
ここでは、shrines[].hide に挙げた建物と、shrines[].hide_roads に当たる道 (OSM の石段。位置がずれていた) に "hide": "shrine" を
付けるだけ (消さない。ミニマップには残る)。付けた建物・道は、ゲーム (main.js) では街の形・当たり判定・階段から外し、
build_props.py ではベランダ・看板・手すりなどを付けない。参道 (鳥居・石段・石垣) は shrine.js が描く。

build_city.py から apply() が呼ばれる。単体でも動く:
    python tools/shrine.py          public/data/city.json に適用し、build_props.py を実行する (何度実行しても同じ結果)
    python tools/shrine.py --undo   付けた hide を外し、build_props.py を実行する
標準ライブラリのみ。
"""
import json
import math
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CITY = ROOT / "public" / "data" / "city.json"
APPEARANCE = ROOT / "data" / "appearance.json"
TAG = "shrine"


def shrines():
    return json.loads(APPEARANCE.read_text(encoding="utf-8")).get("shrines", [])


def hidden_ids():
    return {i for s in shrines() for i in s.get("hide", [])}


def seg_dist(p, a, b):
    ax, az = a[0], a[1]
    ex, ez = b[0] - ax, b[1] - az
    l2 = ex * ex + ez * ez or 1e-9
    t = max(0, min(1, ((p[0] - ax) * ex + (p[1] - az) * ez) / l2))
    return math.hypot(p[0] - ax - ex * t, p[1] - az - ez * t)


def undo(buildings, roads=()):
    for b in list(buildings) + list(roads):
        if b.get("hide") == TAG:
            del b["hide"]


def apply_roads(roads):
    """shrines[].hide_roads ({kind, near}) に当たる道 (その種類で、near から 1.5 m 以内を通るもの) に hide を付ける"""
    n = 0
    for s in shrines():
        for h in s.get("hide_roads", []):
            for r in roads:
                if r["kind"] == h["kind"] and any(seg_dist(h["near"], r["pts"][i], r["pts"][i + 1]) < 1.5 for i in range(len(r["pts"]) - 1)):
                    r["hide"] = TAG
                    n += 1
    return n


def apply(buildings, roads=()):
    """buildings・roads (city.json の並び) に hide を付ける。付けた建物の数を返す"""
    undo(buildings, roads)
    apply_roads(roads)
    ids, n = hidden_ids(), 0
    for b in buildings:
        if b["id"] in ids:
            b["hide"] = TAG
            n += 1
    missing = ids - {b["id"] for b in buildings}
    if missing:
        print(f"shrine: 見つからない建物 {sorted(missing)} (PLATEAU を取り直して ID が変わったら appearance.json の hide を直す)")
    return n


def main():
    city = json.loads(CITY.read_text(encoding="utf-8"))
    if "--undo" in sys.argv:
        undo(city["buildings"], city["roads"])
        print("shrine: hide を外した")
    else:
        n = apply(city["buildings"], city["roads"])
        print(f"shrine: 建物 {n} 棟・道 {sum(1 for r in city['roads'] if r.get('hide') == TAG)} 本に hide を付けた")
    CITY.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    sys.path.insert(0, str(ROOT / "tools"))
    import build_props
    build_props.main()


if __name__ == "__main__":
    main()
