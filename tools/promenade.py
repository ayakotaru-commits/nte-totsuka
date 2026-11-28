"""中央プロムナードを通り道にする: トツカーナ (東急プラザ戸塚) の外形に溝を切り、3 階のデッキと階段を足す。

data/promenade.json の channel (多角形) を、建物 (building の id で始まる棟すべて) の外形から引く。
roads (3 階の連絡通路の続きと、地面へ下りる階段) を city.json の道に足す (印 "promenade": 1 を付けて、何度実行しても同じ結果)。
  python tools/promenade.py            city.json に直接かけて、props.json を作り直す
  python tools/promenade.py --undo     溝と足した道を元に戻す (元の外形は棟の "outer_pre_promenade" に控える)
lidar_shape.py と build_city.py が、形と道の高さが決まった後 (landmarks の前) に apply() を呼ぶ。
要る物: shapely (pip install shapely)
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CITY = ROOT / "public" / "data" / "city.json"
CONF = ROOT / "data" / "promenade.json"
KEEP = "outer_pre_promenade"   # 溝を切る前の外形・穴 (元に戻す用)


def _area(ring):
    return sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring))) / 2


def _same_dir(ring, ref):   # 元の外形と同じ向き (時計回りか反時計回りか) にそろえる
    return ring if (_area(ring) > 0) == (_area(ref) > 0) else ring[::-1]


def _clean(ring):
    r = [[round(x, 2), round(z, 2)] for x, z in ring]
    if r and r[0] == r[-1]:
        r = r[:-1]
    out = []
    for p in r:
        if not out or p != out[-1]:
            out.append(p)
    return out


def undo(buildings, roads=None):
    for b in buildings:
        if KEEP in b:
            b["outer"], h = b[KEEP]["outer"], b[KEEP].get("holes")
            if h is not None:
                b["holes"] = h
            else:
                b.pop("holes", None)
            del b[KEEP]
    if roads is not None:
        roads[:] = [r for r in roads if not r.get("promenade")]


def apply(buildings, roads):
    """buildings の外形から溝を引き、roads に道を足す。何度かけても同じ。"""
    if not CONF.exists():
        return
    try:
        from shapely.geometry import Polygon
    except ImportError:
        raise SystemExit("promenade.py には shapely が要ります: pip install shapely")
    conf = json.loads(CONF.read_text(encoding="utf-8"))
    undo(buildings, roads)
    ch = Polygon(conf["channel"])
    n = 0
    for b in buildings:
        if not (b["id"] == conf["building"] or b["id"].startswith(conf["building"] + "#")):
            continue
        poly = Polygon(b["outer"], b.get("holes") or [])
        if not poly.is_valid:
            poly = poly.buffer(0)
        if not poly.intersects(ch):
            continue
        cut = poly.difference(ch)
        if cut.geom_type == "MultiPolygon":   # 溝が棟を 2 つに分けるとき: 大きい方を残す (今回は起きない)
            cut = max(cut.geoms, key=lambda g: g.area)
        if cut.is_empty or cut.geom_type != "Polygon":
            continue
        b[KEEP] = {"outer": b["outer"], "holes": b.get("holes")}
        b["outer"] = _same_dir(_clean(list(cut.exterior.coords)), b["outer"])
        holes = [_same_dir(_clean(list(r.coords)), b["holes"][0] if b.get("holes") else b["outer"]) for r in cut.interiors]
        if holes:
            b["holes"] = holes
        else:
            b.pop("holes", None)
        n += 1
    for r in conf.get("roads", []):
        roads.append({**r, "promenade": 1})
    return n


def main():
    city = json.loads(CITY.read_text(encoding="utf-8"))
    if "--undo" in sys.argv:
        undo(city["buildings"], city["roads"])
        n = 0
    else:
        n = apply(city["buildings"], city["roads"])
    CITY.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"溝を切った棟: {n} / 道: {sum(1 for r in city['roads'] if r.get('promenade'))} 本")
    sys.path.insert(0, str(ROOT / "tools"))
    import build_props
    build_props.main()


if __name__ == "__main__":
    main()
