"""目印になる大きな建物 (ランドマーク) の外観を、data/appearance.json の landmarks から city.json に設定する。

build_city.py から apply() が呼ばれる (点群で形を直した後)。lidar_shape.py を単体で実行したときも最後に呼ばれる。単体でも動く:
    python tools/landmarks.py          public/data/city.json にその場で適用 (何度実行しても同じ結果)
    python tools/landmarks.py --undo   適用前に戻す

1 つのランドマーク = 指定した地点 (at) を含む建物と、その上の段 (part) 全部。set で建物本体の値も変えられる (minH = 高架にする)。
  建物には look (外観の名前) を付け、外観の中身は city.json の looks に 1 つだけ書く。
  壁の柄は「地面からの階」で決まる (段ごとに柄がずれないよう、基準の高さ y0 を looks に持つ)。
  入口 (doors) は、建物に取り付く高架の歩道 (デッキ) の端から自動で決める。appearance.json の entrances で追加できる。
描画は public/src/city.js (壁) と public/src/detail/shapes.js (大きな看板。配置は build_props.py)。
標準ライブラリのみ。
"""
import json
import math
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CITY = ROOT / "public" / "data" / "city.json"
APPEARANCE = ROOT / "data" / "appearance.json"

DOOR_REACH = 6.0   # デッキの端が壁からこの距離以内なら入口とみなす (m)
DOOR_MERGE = 16.0  # これより近い入口は 1 つにまとめる (m)


def point_in(p, ring):
    x, z = p
    inside, j = False, len(ring) - 1
    for i in range(len(ring)):
        xi, zi = ring[i][0], ring[i][1]
        xj, zj = ring[j][0], ring[j][1]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            inside = not inside
        j = i
    return inside


def edge_dist(p, ring):
    best = 1e9
    for i in range(len(ring)):
        a, b = ring[i], ring[(i + 1) % len(ring)]
        dx, dz = b[0] - a[0], b[1] - a[1]
        l2 = dx * dx + dz * dz
        t = 0 if l2 == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2))
        best = min(best, math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t))
    return best


def undo(buildings, pois=None):
    """前回の適用を取り消す (look の付いた建物を元の名前・色に戻す)"""
    for b in buildings:
        if "look" not in b:
            continue
        old = b.pop("look0", {})   # 適用前の値 (無かったものは None)
        if old.get("name") is not None and pois is not None:
            for p in pois:
                if p.get("cat") == "building" and p.get("name") == b.get("name"):
                    p["name"] = old["name"]
        for k, v in old.items():
            b.pop(k, None)
            if v is not None:
                b[k] = v
        b.pop("look", None)


def find_doors(hosts, roads, extra):
    """高架の歩道の端で、建物の壁に届いているもの + 手で指定した入口。近いものは 1 つにまとめる"""
    pts = [list(p) for p in extra]
    for w in roads or []:
        ys = w.get("ys")
        if not ys or w.get("kind") == "steps":
            continue
        for p in (w["pts"][0], w["pts"][-1]):
            if any(edge_dist(p, h["outer"]) <= DOOR_REACH for h in hosts):
                pts.append([p[0], p[1]])
    doors = []
    for p in pts:
        near = next((d for d in doors if math.hypot(d[0] - p[0], d[1] - p[1]) < DOOR_MERGE), None)
        if near is None:
            doors.append([round(p[0], 1), round(p[1], 1)])
    return doors


def gap_fill(buildings, ids):
    """上の段の底と、その下の段の上端の間のすき間 (点群が格子越しに中を写した所など)。段の minH を下の段の上端まで下げる値 {id: minH}"""
    parts = [b for b in buildings if b["id"] in ids or b.get("part") in ids]
    out = {}
    for b in parts:
        lo = b.get("minH") or 0
        if lo <= 0:
            continue
        o = b["outer"]
        cx, cz = sum(p[0] for p in o) / len(o), sum(p[1] for p in o) / len(o)
        pts = [(cx, cz)] + [tuple(p) for p in o[:: max(1, len(o) // 8)]]
        below = [q["h"] for q in parts if q is not b and q["h"] <= lo + 0.01
                 and any(point_in(p, q["outer"]) for p in pts)]
        if below and lo - max(below) > 0.3:
            out[b["id"]] = round(max(below), 2)
    return out


def apply(buildings, roads=None, pois=None, conf=None):
    """buildings に look を付け、looks (外観の中身) を返す。pois があれば建物名の変更を地名にも反映する"""
    undo(buildings, pois)
    if conf is None:
        if not APPEARANCE.exists():
            return {}
        conf = json.loads(APPEARANCE.read_text(encoding="utf-8"))
    looks = {}
    for lm in conf.get("landmarks", []):
        # at は 1 地点 [x, z] か、その並び (重なった建物データをまとめて 1 つの外観にする)。最初の地点の建物が本体
        ats = lm["at"] if isinstance(lm["at"][0], list) else [lm["at"]]
        # 点群で輪郭を削る前の形 (lidar.outer0) でも探す: 中庭に当たる地点でも見つかるように
        hosts = []
        for at in ats:
            hosts += [b for b in buildings if not b.get("part") and b not in hosts
                      and (point_in(at, b["outer"]) or point_in(at, (b.get("lidar") or {}).get("outer0") or []))]
        if not hosts:
            print(f"landmarks: building not found at {ats}: {lm['name']}")
            continue
        host, ids = hosts[0], {h["id"] for h in hosts}
        key, look, extra = lm["key"], dict(lm["look"]), lm.get("set", {})
        # 壁の柄の基準の高さ。本体を高架にする (set.minH) ときは、その床から数える
        look["y0"] = round((host.get("y") or 0) + extra.get("minH", 0), 2)
        look["doors"] = find_doors(hosts, roads, lm.get("entrances", []))
        looks[key] = look
        fill = gap_fill(buildings, ids) if lm.get("fill_gaps") else {}
        n = 0
        for b in buildings:
            if b["id"] not in ids and b.get("part") not in ids:
                continue
            new = {"color": look["wall"], **(extra if b is host else {}), **({"minH": fill[b["id"]]} if b["id"] in fill else {})}
            if b is host and lm.get("rename"):
                new["name"] = lm["rename"]
            b["look0"] = {k: b.get(k) for k in new}
            b.update(new)
            b["look"] = key
            n += 1
        if lm.get("rename"):
            old = host["look0"].get("name")
            for p in pois or []:
                if old and p.get("cat") == "building" and p.get("name") == old:
                    p["name"] = lm["rename"]
        print(f"landmarks: {lm['name']}: {n} parts, doors {len(look['doors'])}")
    return looks


def main():
    city = json.loads(CITY.read_text(encoding="utf-8"))
    if "--undo" in sys.argv:
        undo(city["buildings"], city.get("pois"))
        city.pop("looks", None)
    else:
        city["looks"] = apply(city["buildings"], city.get("roads"), city.get("pois"))
    CITY.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"-> {CITY} ({CITY.stat().st_size // 1024} KB)")
    import build_props  # 看板の配置を作り直す
    build_props.main()


if __name__ == "__main__":
    main()
