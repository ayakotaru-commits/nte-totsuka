"""神社の社殿 (data/appearance.json の shrines) を作るため、PLATEAU の建物 (灰色の箱) を描かない・当たらないようにする。

社殿の形と外観は public/src/shrine.js が描き、配置・地面の高さ・当たり判定は tools/build_props.py が props.json の shrines に書く。
ここでは、shrines[].hide に挙げた建物に "hide": "shrine" を付けるだけ (建物そのものは消さない。ミニマップには輪郭が残る)。
付けた建物は、ゲーム (main.js) では街の形と当たり判定から外し、build_props.py ではベランダ・看板などを付けない。

build_city.py から apply() が呼ばれる。単体でも動く:
    python tools/shrine.py          public/data/city.json に適用し、build_props.py を実行する (何度実行しても同じ結果)
    python tools/shrine.py --undo   付けた hide を外し、build_props.py を実行する
標準ライブラリのみ。
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CITY = ROOT / "public" / "data" / "city.json"
APPEARANCE = ROOT / "data" / "appearance.json"
TAG = "shrine"


def hidden_ids():
    ap = json.loads(APPEARANCE.read_text(encoding="utf-8"))
    return {i for s in ap.get("shrines", []) for i in s.get("hide", [])}


def undo(buildings):
    for b in buildings:
        if b.get("hide") == TAG:
            del b["hide"]


def apply(buildings):
    """buildings (city.json の建物の並び) に hide を付ける。付けた数を返す"""
    undo(buildings)
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
        undo(city["buildings"])
        print("shrine: hide を外した")
    else:
        print(f"shrine: {apply(city['buildings'])} 棟に hide を付けた")
    CITY.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    sys.path.insert(0, str(ROOT / "tools"))
    import build_props
    build_props.main()


if __name__ == "__main__":
    main()
