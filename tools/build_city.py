"""data/raw/osm.json -> public/data/city.json (ゲーム用ローカル座標)

座標系: 1単位=1m, 原点=config.ORIGIN, X=東, Z=南 (北は -Z)。Three.js / glTF / Unity(変換後) 共通。
使い方: python tools/build_city.py
"""
import hashlib
import json
import math
import pathlib
import zlib

from config import BOUNDS, ORIGIN_LAT, ORIGIN_LON, START, WAYPOINTS

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "raw" / "osm.json"
DST = ROOT / "public" / "data" / "city.json"
PLATEAU = ROOT / "data" / "raw" / "plateau_bldg.json"
CORRECTIONS = ROOT / "data" / "corrections.json"
GSI = ROOT / "data" / "raw" / "gsi_bldg.json"
APPEARANCE = ROOT / "data" / "appearance.json"
TERRAIN = ROOT / "public" / "data" / "terrain.json"
PLATEAU_ROAD = ROOT / "data" / "raw" / "plateau_road.json"
LIDAR_DSM = ROOT / "data" / "raw" / "lidar_dsm.bin"


M_LAT = 110574.0
M_LON = 111320.0 * math.cos(math.radians(ORIGIN_LAT))


def proj(lat, lon):
    return (round((lon - ORIGIN_LON) * M_LON, 2), round(-(lat - ORIGIN_LAT) * M_LAT, 2))


def geom_pts(g):
    return [proj(p["lat"], p["lon"]) for p in g if p]


def in_limit(p, m=0.0):
    return BOUNDS["minX"] - m <= p[0] <= BOUNDS["maxX"] + m and BOUNDS["minZ"] - m <= p[1] <= BOUNDS["maxZ"] + m


def area2(ring):
    a = 0.0
    for i in range(len(ring)):
        x1, z1 = ring[i]
        x2, z2 = ring[(i + 1) % len(ring)]
        a += x1 * z2 - x2 * z1
    return a / 2


def clean_ring(pts):
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    out = []
    for p in pts:
        if not out or out[-1] != p:
            out.append(p)
    return out if len(out) >= 3 else None


def stitch(segments):
    """マルチポリゴンの分割された way をつないでリングにする"""
    segs = [list(s) for s in segments if len(s) >= 2]
    rings = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]:
                    cur += s[1:]
                elif s[-1] == cur[-1]:
                    cur += s[::-1][1:]
                elif s[-1] == cur[0]:
                    cur = s + cur[1:]
                elif s[0] == cur[0]:
                    cur = s[::-1] + cur[1:]
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        r = clean_ring(cur)
        if r:
            rings.append(r)
    return rings


def polygons(el):
    """要素から [(outer, [holes])] を返す"""
    if el["type"] == "way" and "geometry" in el:
        r = clean_ring(geom_pts(el["geometry"]))
        return [(r, [])] if r else []
    if el["type"] == "relation":
        outers = stitch([geom_pts(m["geometry"]) for m in el.get("members", []) if m.get("role") == "outer" and "geometry" in m])
        inners = stitch([geom_pts(m["geometry"]) for m in el.get("members", []) if m.get("role") == "inner" and "geometry" in m])
        res = []
        for o in outers:
            holes = [h for h in inners if point_in(h[0], o)]
            res.append((o, holes))
        return res
    return []


def point_in(p, ring):
    x, z = p
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, zi = ring[i]
        xj, zj = ring[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def centroid(ring):
    return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))


def num(v):
    if v is None:
        return None
    try:
        return float(str(v).replace("m", "").strip().split(";")[0])
    except ValueError:
        return None


def rand01(seed):
    return (zlib.crc32(str(seed).encode()) % 10000) / 10000.0


DEFAULT_H = {
    "house": (6, 8), "detached": (6, 8), "residential": (7, 10), "apartments": (10, 25),
    "commercial": (10, 22), "retail": (6, 14), "office": (12, 30), "industrial": (6, 10),
    "school": (12, 16), "train_station": (10, 14), "roof": (4, 5), "garage": (3, 4),
    "shed": (2.5, 3), "temple": (8, 10), "shrine": (5, 7), "public": (10, 18), "hospital": (15, 25),
}


def building_height(t, eid):
    h = num(t.get("height"))
    if h is None:
        lv = num(t.get("building:levels"))
        if lv is not None:
            h = lv * 3.2 + (1.0 if lv > 0 else 0)
    if h is None:
        lo, hi = DEFAULT_H.get(t.get("building") or t.get("building:part"), (6, 10))
        h = lo + (hi - lo) * rand01(eid)
    mh = num(t.get("min_height"))
    if mh is None:
        ml = num(t.get("building:min_level"))
        mh = ml * 3.2 if ml else 0.0
    return round(max(h, mh + 1.0), 1), round(mh, 1)


ROAD_W = {
    "motorway": 16, "trunk": 14, "trunk_link": 7, "primary": 12, "primary_link": 7,
    "secondary": 10, "secondary_link": 6, "tertiary": 8, "tertiary_link": 6,
    "unclassified": 6, "residential": 5.5, "living_street": 5, "service": 4,
    "busway": 7, "pedestrian": 6, "footway": 2.5, "path": 2, "cycleway": 2.5,
    "steps": 2.5, "track": 3, "corridor": 2,
}

AREA_KIND = {
    ("natural", "water"): "water", ("natural", "wood"): "wood", ("natural", "grassland"): "grass",
    ("natural", "scrub"): "grass", ("landuse", "grass"): "grass", ("landuse", "forest"): "wood",
    ("landuse", "meadow"): "grass", ("landuse", "farmland"): "farm", ("landuse", "railway"): "railway",
    ("landuse", "cemetery"): "grass", ("landuse", "residential"): "residential",
    ("landuse", "commercial"): "commercial", ("landuse", "retail"): "commercial",
    ("leisure", "park"): "park", ("leisure", "pitch"): "pitch", ("leisure", "playground"): "park",
    ("leisure", "garden"): "park", ("amenity", "parking"): "parking", ("amenity", "school"): "school",
    ("amenity", "bus_station"): "plaza", ("highway", "pedestrian"): "plaza", ("amenity", "university"): "school",
    ("amenity", "kindergarten"): "school", ("place", "square"): "plaza",
    # 敷地 (中の地面は cover.json の色を見せ、外周の柵などは build_props.py が置く)
    ("landuse", "industrial"): "industrial", ("landuse", "cemetery"): "cemetery", ("amenity", "grave_yard"): "cemetery",
    ("amenity", "place_of_worship"): "worship", ("amenity", "hospital"): "hospital",
}
AREA_KEYS = ("natural", "landuse", "leisure", "amenity", "place")
POI_AREA_KINDS = ("park", "school", "plaza", "water", "residential", "industrial")  # 名前を施設名ラベルに出すエリア


def osm_areas(el, t):
    """OSM の要素 (way / relation) から、土地利用・施設のエリアを作る。対応していない種類は []"""
    kind = next((AREA_KIND[(k, t.get(k))] for k in AREA_KEYS if (k, t.get(k)) in AREA_KIND), None)
    out = []
    if kind and el["type"] in ("way", "relation"):
        for outer, holes in polygons(el):
            if not any(in_limit(p, 200) for p in outer):
                continue
            a = {"kind": kind, "outer": outer}
            if holes:
                a["holes"] = holes
            if t.get("name"):
                a["name"] = t["name"]
            out.append(a)
    return out


def clip_line(pts):
    """範囲外の連続点を落とし、範囲内の区間ごとに分割"""
    parts, cur = [], []
    for i, p in enumerate(pts):
        near = in_limit(p) or (i > 0 and in_limit(pts[i - 1])) or (i + 1 < len(pts) and in_limit(pts[i + 1]))
        if near:
            cur.append(p)
        elif cur:
            parts.append(cur)
            cur = []
    if cur:
        parts.append(cur)
    return [c for c in parts if len(c) >= 2]


class Grid:
    """ポリゴンの bbox 格子インデックス"""
    def __init__(self, items, key, cell=25.0):
        self.cell, self.g = cell, {}
        for it in items:
            ring = key(it)
            xs, zs = [p[0] for p in ring], [p[1] for p in ring]
            it["_bb"] = (min(xs), min(zs), max(xs), max(zs))
            for i in range(int(min(xs) // cell), int(max(xs) // cell) + 1):
                for j in range(int(min(zs) // cell), int(max(zs) // cell) + 1):
                    self.g.setdefault((i, j), []).append(it)

    def at(self, x, z):
        for it in self.g.get((int(x // self.cell), int(z // self.cell)), []):
            bb = it["_bb"]
            if bb[0] <= x <= bb[2] and bb[1] <= z <= bb[3]:
                yield it


def merge_plateau(osm_buildings):
    """PLATEAU LOD1 を建物の正とし、OSM から名前・種別を引き継ぐ。PLATEAU に無い OSM 建物は補完として残す。"""
    src = json.loads(PLATEAU.read_text(encoding="utf-8"))
    pl = []
    for b in src["buildings"]:
        outer = clean_ring([proj(lat, lon) for lat, lon in b["outer"]])
        if not outer or not in_limit(centroid(outer)):
            continue
        holes = [r for r in (clean_ring([proj(lat, lon) for lat, lon in h]) for h in b.get("holes", [])) if r]
        nb = {"id": "p" + b["id"][-12:], "outer": outer, "h": max(2.0, round(b["h"], 1)), "base": b["base"], "src": "plateau"}
        if holes:
            nb["holes"] = holes
        if b.get("name"):
            nb["name"] = b["name"]
        pl.append(nb)

    pgrid = Grid(pl, lambda b: b["outer"])
    ogrid = Grid([b for b in osm_buildings if not b.get("minH")], lambda b: b["outer"])

    # OSM の名前・種別・色を PLATEAU 側へ
    for b in pl:
        c = centroid(b["outer"])
        for o in ogrid.at(*c):
            if point_in(c, o["outer"]):
                for k in ("name", "kind", "color"):
                    if o.get(k) and not b.get(k):
                        b[k] = o[k]
                o["_matched"] = True
                break
    # 逆方向 (小さい OSM 建物の重心が PLATEAU 建物の中) も一致扱い
    extra = []
    for o in osm_buildings:
        if o.get("_matched"):
            continue
        c = centroid(o["outer"])
        host = next((b for b in pgrid.at(*c) if point_in(c, b["outer"])), None)
        if host:
            for k in ("name", "kind"):
                if o.get(k) and not host.get(k):
                    host[k] = o[k]
            # 高架・庇などの浮いた部分は PLATEAU に無いので残す
            if o.get("minH"):
                extra.append(o)
            continue
        extra.append(o)  # PLATEAU に無い建物 (範囲外・新築など)

    # 原点付近の地盤高を基準に相対標高 e を付与 (地形対応の準備)
    near = sorted(pl, key=lambda b: centroid(b["outer"])[0] ** 2 + centroid(b["outer"])[1] ** 2)[:30]
    ref = sorted(b["base"] for b in near)[len(near) // 2] if near else 0.0
    for b in pl:
        b["e"] = round(b.pop("base") - ref, 2)
    for b in pl + extra:
        b.pop("_bb", None); b.pop("_matched", None)
    print(f"PLATEAU: {len(pl)} buildings, OSM supplement: {len(extra)}, ref ground elev {ref:.1f} m")
    return pl + extra, "建物: 国土交通省 Project PLATEAU 横浜市 (2024)"


# ---------------- 建物の自動分類 (種類・階数・屋根・店舗) ----------------
KIND_STYLE = {
    "house": "house", "detached": "house", "semidetached_house": "house", "terrace": "house",
    "apartments": "apartment",
    "commercial": "commercial", "retail": "commercial", "office": "commercial", "supermarket": "commercial", "hotel": "commercial",
    "industrial": "industrial", "warehouse": "industrial", "factory": "industrial",
    "school": "public", "university": "public", "kindergarten": "public", "hospital": "public", "public": "public",
    "civic": "public", "government": "public", "train_station": "public", "temple": "public", "shrine": "public", "church": "public",
    "roof": "carport", "garage": "small", "garages": "small", "shed": "small", "hut": "small",
}
SHOP_CAT = ("shop:", "amenity:restaurant", "amenity:cafe", "amenity:fast_food", "amenity:bar", "amenity:pub",
            "amenity:pharmacy", "amenity:bank", "amenity:clinic", "amenity:dentist")


def obb(ring):
    """最小外接長方形。長辺方向 (ux,uz) と中心・長さ・幅"""
    best = None
    for i in range(len(ring)):
        a, b = ring[i], ring[(i + 1) % len(ring)]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 0.5:
            continue
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        ss = [x * ux + z * uz for x, z in ring]
        ts = [-x * uz + z * ux for x, z in ring]
        ar = (max(ss) - min(ss)) * (max(ts) - min(ts))
        if not best or ar < best[0]:
            best = (ar, ux, uz, min(ss), max(ss), min(ts), max(ts))
    if not best:
        return None
    ar, ux, uz, s0, s1, t0, t1 = best
    if t1 - t0 > s1 - s0:
        ux, uz, s0, s1, t0, t1 = -uz, ux, t0, t1, -s1, -s0
    sc, tc = (s0 + s1) / 2, (t0 + t1) / 2
    return {"area": ar, "u": [round(ux, 4), round(uz, 4)], "c": [round(sc * ux - tc * uz, 2), round(sc * uz + tc * ux, 2)],
            "len": round(s1 - s0, 2), "wid": round(t1 - t0, 2)}


def classify(buildings, elements, pois):
    # 土地利用 (OSM) の多角形
    land = []
    for el in elements:
        lu = el.get("tags", {}).get("landuse")
        if lu in ("industrial", "commercial", "retail", "residential") and el["type"] in ("way", "relation"):
            for outer, _ in polygons(el):
                land.append({"lu": lu, "outer": outer})
    lgrid = Grid(land, lambda a: a["outer"], cell=60.0)
    shops = [p for p in pois if p["cat"].startswith(SHOP_CAT)]
    sgrid = {}
    for p in shops:
        sgrid.setdefault((int(p["x"] // 25), int(p["z"] // 25)), []).append(p)

    stats = {}
    for b in buildings:
        if b.get("minH"):
            continue
        c = centroid(b["outer"])
        a = abs(area2(b["outer"]))
        h = b["h"]
        lu = next((l["lu"] for l in lgrid.at(*c) if point_in(c, l["outer"])), None)
        code = b.get("code", "")
        near_station = math.hypot(*c) < 350
        style = KIND_STYLE.get(b.get("kind"))
        if code.startswith("open"):
            style = "parking" if h > 4.5 else "carport"
        if not style:
            if code.startswith("open"):
                style = "parking" if h > 4.5 else "carport"
            elif code in ("solid", "highrise") or (code == "" and h >= 10):
                if h < 7:
                    style = "lowrise"
                elif lu == "industrial":
                    style = "industrial"
                elif lu in ("commercial", "retail") or (near_station and a > 150):
                    style = "commercial"
                else:
                    style = "apartment"
            else:  # 普通建物 (主に木造)
                if a < 300 and h < 12:
                    style = "small" if a < 20 else "house"
                elif h >= 12:
                    style = "apartment"
                elif lu == "industrial" or a > 600:
                    style = "industrial"
                else:
                    style = "lowrise"
        # 階数
        if style == "house":
            floors = 1 if h < 5.5 else 2 if h < 9.5 else 3
        elif style == "apartment":
            floors = max(2, round((h - 0.5) / 2.95))
        elif style in ("commercial", "public"):
            floors = max(1, round(h / 3.8))
        elif style in ("industrial", "lowrise"):
            floors = 1 if h < 10 else max(2, round(h / 4.5))
        elif style == "parking":
            floors = max(1, round(h / 3.0))
        else:
            floors = 1
        b["style"], b["floors"] = style, floors
        if style == "carport" and h > 2.2:
            b["minH"] = round(h - 0.2, 2)  # 屋根の下を歩けるように
        # 戸建ての屋根: 実測高さ = 棟の高さ。壁はその分低くする
        if style == "house":
            o = obb(b["outer"])
            if o and o["wid"] >= 3 and a / o["area"] >= 0.72 and h >= 4.5:
                rise = round(min(3.0, o["wid"] / 2 * 0.55, h - 2.6), 2)
                if rise > 0.8:
                    t = "hip" if int(hashlib.md5(b["id"].encode()).hexdigest()[:2], 16) < 102 else "gable"
                    b["roof"] = {"t": t, "rise": rise, **{k: o[k] for k in ("u", "c", "len", "wid")}}
        # 1階の店舗
        if style in ("commercial", "apartment", "lowrise", "house"):
            for i in range(int(c[0] // 25) - 1, int(c[0] // 25) + 2):
                for j in range(int(c[1] // 25) - 1, int(c[1] // 25) + 2):
                    for p in sgrid.get((i, j), []):
                        if point_in((p["x"], p["z"]), b["outer"]) or min(
                                seg_dist((p["x"], p["z"]), b["outer"][k], b["outer"][(k + 1) % len(b["outer"])]) for k in range(len(b["outer"]))) < 6:
                            b.setdefault("shops", []).append({"name": p["name"], "cat": p["cat"], "x": p["x"], "z": p["z"]})
        stats[style] = stats.get(style, 0) + 1
    print("styles:", dict(sorted(stats.items(), key=lambda kv: -kv[1])),
          "roofs:", sum(1 for b in buildings if "roof" in b), "with shops:", sum(1 for b in buildings if "shops" in b))


def seg_dist(p, a, b):
    ex, ez = b[0] - a[0], b[1] - a[1]
    l2 = ex * ex + ez * ez
    t = 0 if l2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / l2))
    return math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ez * t)


ROAD_DRIVE = {"trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link",
              "unclassified", "residential", "living_street", "service", "busway"}
ROAD_MAJOR = {"trunk", "primary", "secondary", "tertiary"}


def process_roads(roads):
    """PLATEAU の道路面 (実測の形) を読み、OSM の道路ごとに
    cov: 区間ごとに PLATEAU 面で覆われているか / w: 実測の道幅 / half: 中心線から左右の縁まで / sw: 歩道幅 (推定) を付ける"""
    if not PLATEAU_ROAD.exists():
        return []
    src = json.loads(PLATEAU_ROAD.read_text(encoding="utf-8"))["roads"]
    areas = []
    for r in src:
        outer = clean_ring([proj(lat, lon) for lat, lon in r["outer"]])
        if not outer or not any(in_limit(q, 60) for q in outer):
            continue
        a = {"outer": outer}
        holes = [h for h in (clean_ring([proj(lat, lon) for lat, lon in hh]) for hh in r.get("holes", [])) if h]
        if holes:
            a["holes"] = holes
        areas.append(a)
    grid = Grid(areas, lambda a: a["outer"], cell=20.0)

    def inside(x, z):
        for a in grid.at(x, z):
            if point_in((x, z), a["outer"]) and not any(point_in((x, z), h) for h in a.get("holes", [])):
                return True
        return False

    n_cov = n_w = n_sw = 0
    for r in roads:
        if r["kind"] not in ROAD_DRIVE:
            continue
        pts = r["pts"]
        cov, lefts, rights = [], [], []
        for i in range(len(pts) - 1):
            (ax, az), (bx, bz) = pts[i], pts[i + 1]
            L = math.hypot(bx - ax, bz - az)
            if L < 0.01:
                cov.append(0); continue
            dx, dz = (bx - ax) / L, (bz - az) / L
            nx, nz = -dz, dx
            k = max(1, int(L / 3))
            hit = 0
            for j in range(k):
                t = (j + 0.5) / k * L
                x, z = ax + dx * t, az + dz * t
                if not inside(x, z):
                    continue
                hit += 1
                if t < 7 or t > L - 7:
                    continue  # 交差点付近は幅が広く出るので測らない
                dl = dr = 0.0
                while dl < 20 and inside(x + nx * (dl + 0.25), z + nz * (dl + 0.25)):
                    dl += 0.25
                while dr < 20 and inside(x - nx * (dr + 0.25), z - nz * (dr + 0.25)):
                    dr += 0.25
                if dl < 20 and dr < 20:
                    lefts.append(dl); rights.append(dr)
            cov.append(1 if hit >= 0.6 * k else 0)
        if any(cov):
            r["cov"] = cov
            n_cov += 1
        if len(lefts) >= 3:
            lefts.sort(); rights.sort()
            hl, hr = lefts[len(lefts) // 2], rights[len(rights) // 2]
            w = hl + hr
            if 2.5 <= w <= 40:
                r["w_osm"], r["w"], r["half"] = r["w"], round(w, 1), [round(hl, 2), round(hr, 2)]
                n_w += 1
                if r["kind"] in ROAD_MAJOR:
                    sw = max(0.0, min(3.5, (w - 7.0) / 2))
                    if sw >= 1.2:
                        r["sw"] = round(sw, 1)
                        n_sw += 1
    print(f"roads: PLATEAU areas {len(areas)}, OSM roads covered {n_cov}, width measured {n_w}, sidewalks {n_sw}")
    return [{"outer": [[round(x, 2), round(z, 2)] for x, z in a["outer"]],
             **({"holes": [[[round(x, 2), round(z, 2)] for x, z in h] for h in a["holes"]]} if a.get("holes") else {})} for a in areas]


def terrain_sampler():
    """public/data/terrain.json の高さ関数 (ゲーム側 terrain.js の H() と同じ三角形補間)。無ければ None"""
    if not TERRAIN.exists():
        return None
    T = json.loads(TERRAIN.read_text(encoding="utf-8"))
    nx, nz, st, x0, z0, h = T["nx"], T["nz"], T["step"], T["minX"], T["minZ"], T["h"]
    def H(x, z):
        fx = max(0.0, min(nx - 1.0001, (x - x0) / st)); fz = max(0.0, min(nz - 1.0001, (z - z0) / st))
        i, j = int(fx), int(fz); u, v = fx - i, fz - j
        g = lambda a, b: h[b * nx + a] / 100
        h00, h10, h01, h11 = g(i, j), g(i + 1, j), g(i, j + 1), g(i + 1, j + 1)
        return h00 + u * (h10 - h00) + v * (h11 - h10) if u >= v else h00 + v * (h01 - h00) + u * (h11 - h01)
    return H


PED = {"footway", "pedestrian", "path", "cycleway", "steps", "corridor"}


def seg_intersect(a, b, c, d):
    """線分 ab と cd の交点 (ab 上の t, 交点) または None"""
    r = (b[0] - a[0], b[1] - a[1]); q = (d[0] - c[0], d[1] - c[1])
    den = r[0] * q[1] - r[1] * q[0]
    if abs(den) < 1e-9:
        return None
    t = ((c[0] - a[0]) * q[1] - (c[1] - a[1]) * q[0]) / den
    u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
    if 0 < t < 1 and 0 < u < 1:
        return t, (a[0] + r[0] * t, a[1] + r[1] * t)
    return None


def compute_bridges(roads, rails, H):
    """橋 (bridge=yes) の各頂点の高さ ys を計算する。
    - 橋のまとまりごとに、地面の道とつながる点 (たもと) を地面の高さに固定し、間はなめらかに補間
    - 道路・線路の上を渡る所は下をくぐれる高さ (道路 5.3m / 線路 6.8m) を確保し、そこから勾配 (車道 8% / 歩道 12% / 階段 70%) で下げる
    - 持ち上がった歩道橋につながる地面側の歩道・階段は、つながる頂点だけ持ち上げて坂にする"""
    key = lambda p: (round(p[0], 1), round(p[1], 1))
    ways = [(r, "road") for r in roads] + [(r, "rail") for r in rails]
    ground_nodes = set()
    for w, t in ways:
        if not w.get("bridge"):
            for p in w["pts"]:
                ground_nodes.add(key(p))
    bridges = [(w, t) for w, t in ways if w.get("bridge")]
    if not bridges:
        return
    # まとまり (共有する頂点でつながる橋)
    parent = list(range(len(bridges)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    owner = {}
    for i, (w, _) in enumerate(bridges):
        for p in w["pts"]:
            k = key(p)
            if k in owner:
                parent[find(i)] = find(owner[k])
            else:
                owner[k] = i
    comps = {}
    for i in range(len(bridges)):
        comps.setdefault(find(i), []).append(i)
    # くぐる対象: 橋でない車道・線路の区間
    under = []
    for w, t in ways:
        if w.get("bridge") or (t == "road" and w["kind"] not in ROAD_DRIVE):
            continue
        for a, b in zip(w["pts"], w["pts"][1:]):
            under.append((a, b, 6.8 if t == "rail" else 5.3))
    ug = {}
    for idx, (a, b, _) in enumerate(under):
        for i in range(int(min(a[0], b[0]) // 30), int(max(a[0], b[0]) // 30) + 1):
            for j in range(int(min(a[1], b[1]) // 30), int(max(a[1], b[1]) // 30) + 1):
                ug.setdefault((i, j), []).append(idx)
    elevated = {}
    n_ped = n_cross = 0
    for members in comps.values():
        nodes, edges = {}, []
        for i in members:
            w, t = bridges[i]
            grade = 0.7 if w.get("kind") == "steps" else 0.12 if w.get("kind") in PED else 0.08
            for a, b in zip(w["pts"], w["pts"][1:]):
                ka, kb = key(a), key(b)
                nodes[ka] = a; nodes[kb] = b
                edges.append((ka, kb, max(0.5, math.hypot(b[0] - a[0], b[1] - a[1])), grade, a, b))
        nb = {k: [] for k in nodes}
        for ka, kb, L, g, _, _ in edges:
            nb[ka].append((kb, L)); nb[kb].append((ka, L))
        fixed = {k for k in nodes if k in ground_nodes}
        if not fixed:
            fixed = {k for k in nodes if len(nb[k]) == 1}
        y = {k: H(*nodes[k]) for k in nodes}
        for _ in range(400):  # たもとを固定して間をなめらかに (調和補間)
            for k in nodes:
                if k in fixed or not nb[k]:
                    continue
                ws = sum(1 / L for _, L in nb[k])
                y[k] = sum(y[o] / L for o, L in nb[k]) / ws
        # 下をくぐる道路・線路との交差
        env = {k: -1e9 for k in nodes}
        for ka, kb, L, g, a, b in edges:
            for i in range(int(min(a[0], b[0]) // 30), int(max(a[0], b[0]) // 30) + 1):
                for j in range(int(min(a[1], b[1]) // 30), int(max(a[1], b[1]) // 30) + 1):
                    for idx in ug.get((i, j), []):
                        c, d, clear = under[idx]
                        hit = seg_intersect(a, b, c, d)
                        if hit:
                            t, pt = hit
                            req = H(*pt) + clear
                            env[ka] = max(env[ka], req - g * t * L)
                            env[kb] = max(env[kb], req - g * (1 - t) * L)
        if max(env.values()) > -1e8:
            n_cross += 1
            for _ in range(len(nodes) + 2):
                for ka, kb, L, g, _, _ in edges:
                    env[kb] = max(env[kb], env[ka] - g * L)
                    env[ka] = max(env[ka], env[kb] - g * L)
            for k in nodes:
                y[k] = max(y[k], env[k])
        for k in nodes:  # 地面より下にはしない (斜面に掛かる橋・建物に入るデッキ)
            y[k] = max(y[k], H(*nodes[k]) + 0.1)
        ped = all(bridges[i][0].get("kind") in PED for i in members)
        n_ped += ped
        for k in nodes:
            if y[k] - H(*nodes[k]) > 0.3:
                elevated[k] = y[k]
        for i in members:
            w, _ = bridges[i]
            w["ys"] = [round(y[key(p)], 2) for p in w["pts"]]
    # 持ち上がった橋につながる地面側の歩道・階段は坂にする
    n_ramp = 0
    for w, t in ways:
        if w.get("bridge") or t != "road" or w["kind"] not in PED:
            continue
        ks = [key(p) for p in w["pts"]]
        if any(k in elevated for k in ks):
            w["ys"] = [round(elevated.get(k, H(*p)), 2) for k, p in zip(ks, w["pts"])]
            w["ramp"] = 1
            n_ramp += 1
    print(f"bridges: {len(bridges)} ways in {len(comps)} groups, over roads/rails {n_cross}, pedestrian {n_ped}, ramps {n_ramp}")


def apply_appearance(buildings, areas):
    """data/appearance.json: 敷地 (名前付きエリア) 内の建物に外観を設定し、庭・柵の情報を sites として返す"""
    if not APPEARANCE.exists():
        return []
    conf = json.loads(APPEARANCE.read_text(encoding="utf-8"))
    sites = []
    for st in conf.get("sites", []):
        area = next((a for a in areas if a.get("name") == st["area_name"]), None)
        if not area:
            print(f"appearance: area not found: {st['area_name']}")
            continue
        rule = st.get("buildings", {})
        n = 0
        ids = []
        for b in buildings:
            if not point_in(centroid(b["outer"]), area["outer"]):
                continue
            ids.append(b["id"])
            if b.get("style") in rule.get("styles", []):
                b.update(rule.get("set", {}))
                n += 1
        # 門: 指定位置の建物を「通り抜けられる門」(両側の柱 + 上の梁) に置き換える
        if "gate" in st:
            gt = st["gate"]
            host = next((b for b in buildings if point_in(gt["at"], b["outer"])), None)
            if host:
                ux, uz = gt["axis"]
                nrm = math.hypot(ux, uz)   # 単位ベクトルにしてから使う (でないと座標変換でずれる)
                ux, uz = ux / nrm, uz / nrm
                ss = [x * ux + z * uz for x, z in host["outer"]]
                ts = [-x * uz + z * ux for x, z in host["outer"]]
                s0, s1, t0, t1 = min(ss), max(ss), min(ts), max(ts)
                tc, w = (t0 + t1) / 2, gt["passage"] / 2
                if gt.get("wide"):   # clockhouse: 時計のある門の建物は、正面を広げる (写真では約 13 m)
                    t0, t1 = tc - gt["wide"] / 2, tc + gt["wide"] / 2
                def rect(a0, a1, b0, b1):
                    return [[round(sv * ux - tv * uz, 2), round(sv * uz + tv * ux, 2)] for sv, tv in ((a0, b0), (a1, b0), (a1, b1), (a0, b1))]
                common = {"style": "gate", "facade": "euro", "color": gt.get("color", "#dcc6a0"), "floors": 2, "mansard": None}
                parts = [
                    {"id": host["id"] + "_L", "outer": rect(s0, s1, t0, tc - w), "h": host["h"], **common},
                    {"id": host["id"] + "_R", "outer": rect(s0, s1, tc + w, t1), "h": host["h"], **common},
                    {"id": host["id"] + "_T", "outer": rect(s0, s1, tc - w, tc + w), "h": host["h"], "minH": gt["clear_h"], **common},
                ]
                buildings.remove(host)
                buildings.extend(parts)
                ids = [i for i in ids if i != host["id"]] + [q["id"] for q in parts]
                gt["center"] = [round((s0 + s1) / 2 * ux - tc * uz, 2), round((s0 + s1) / 2 * uz + tc * ux, 2)]
                gt["length"], gt["h"] = round(s1 - s0, 2), host["h"]
                gt["wide"] = round(t1 - t0, 2)
        # エントランス棟
        if "hall" in st:
            hl = st["hall"]
            hb = {"id": "hall_" + str(len(sites)), "outer": hl["outer"], "h": hl["h"], "style": "hall", "facade": "euro",
                  "color": hl.get("color", "#e3d2b0"), "floors": 2, "src": "appearance"}
            buildings.append(hb)
            ids.append(hb["id"])
        site = {"name": st["area_name"], "outer": area["outer"], "buildings": ids}
        for k in ("garden", "fence", "gate", "hall", "plaza", "turrets", "awnings"):
            if k in st:
                site[k] = st[k]
        sites.append(site)
        print(f"appearance: {st['area_name']}: {n} buildings styled")
    return sites


def apply_corrections(buildings, corr):
    """remove_buildings: {"id"} または {"at": [x, z]} (その点を含む建物を削除。データ源が変わっても有効)
    set_height: {"id" or "at", "h"} / add_buildings: {"id", "outer": [[x, z], ...], "h"}"""
    def match(b, c):
        if c.get("id") and c["id"] == b["id"]:
            return True
        at = c.get("at")
        return bool(at) and point_in(at, b["outer"])
    rm = corr.get("remove_buildings", [])
    before = len(buildings)
    buildings = [b for b in buildings if not any(match(b, c) for c in rm)]
    nh = 0
    for c in corr.get("set_height", []):
        for b in buildings:
            if match(b, c):
                b["h"] = c["h"]; nh += 1
                b["fixed"] = True  # 手で直した高さは、点群による形の作り直しより優先する
    adds = [{"id": a["id"], "outer": a["outer"], "h": a["h"], "src": "user", "fixed": True, **({"kind": a["kind"]} if a.get("kind") else {})}
            for a in corr.get("add_buildings", [])]
    print(f"corrections: removed {before - len(buildings)}, height changed {nh}, added {len(adds)}")
    return buildings + adds


def merge_gsi(osm_buildings):
    """国土地理院の建物輪郭を形・有無の正とし、高さは PLATEAU の実測値、名前・種別は OSM から引き継ぐ。
    PLATEAU にしか無い建物は取り壊し済みとみなして使わない。"""
    src = json.loads(GSI.read_text(encoding="utf-8"))
    pl = []
    if PLATEAU.exists():
        for b in json.loads(PLATEAU.read_text(encoding="utf-8"))["buildings"]:
            outer = clean_ring([proj(lat, lon) for lat, lon in b["outer"]])
            if outer:
                pl.append({"outer": outer, "h": b["h"], "base": b["base"]})
    pgrid = Grid(pl, lambda b: b["outer"])

    gs = []
    for b in src["buildings"]:
        outer = clean_ring([proj(lat, lon) for lat, lon in b["outer"]])
        if not outer or abs(area2(outer)) < 2 or not in_limit(centroid(outer)):
            continue
        holes = [r for r in (clean_ring([proj(lat, lon) for lat, lon in h]) for h in b.get("holes", [])) if r]
        c = centroid(outer)
        gid = "g" + hashlib.md5(f"{c[0]:.1f},{c[1]:.1f}".encode()).hexdigest()[:10]
        nb = {"id": gid, "outer": outer, "src": "gsi", "code": b["code"]}
        if holes:
            nb["holes"] = holes
        # 高さ: 建物内部の数点で PLATEAU 建物に投票
        samples = [c] + [(c[0] + (x - c[0]) * 0.6, c[1] + (z - c[1]) * 0.6) for x, z in outer[:: max(1, len(outer) // 8)]]
        votes = {}
        for p in samples:
            if not point_in(p, outer):
                continue
            for q in pgrid.at(*p):
                if point_in(p, q["outer"]):
                    votes[id(q)] = (votes.get(id(q), (0, q))[0] + 1, q)
        if votes:
            q = max(votes.values(), key=lambda v: v[0])[1]
            nb["h"], nb["base"] = max(2.0, round(q["h"], 1)), q["base"]
        else:
            a = abs(area2(outer))
            nb["h"] = {"open_normal": 2.8, "open_solid": 4.0, "highrise": 30.0, "solid": 12.0}.get(b["code"], 6.5 if a < 150 else 9.0)
        gs.append(nb)

    ggrid = Grid(gs, lambda b: b["outer"])
    ogrid = Grid([b for b in osm_buildings if not b.get("minH")], lambda b: b["outer"])
    for b in gs:
        c = centroid(b["outer"])
        for o in ogrid.at(*c):
            if point_in(c, o["outer"]):
                for k in ("name", "kind", "color"):
                    if o.get(k) and not b.get(k):
                        b[k] = o[k]
                o["_matched"] = True
                break
    extra = []
    for o in osm_buildings:
        if o.get("_matched"):
            continue
        c = centroid(o["outer"])
        host = next((b for b in ggrid.at(*c) if point_in(c, b["outer"])), None)
        if host:
            for k in ("name", "kind"):
                if o.get(k) and not host.get(k):
                    host[k] = o[k]
            if o.get("minH"):
                extra.append(o)  # 高架・庇などの浮いた部分
            continue
        if o.get("minH"):
            extra.append(o)
    # 屋根だけの建物 (無壁舎) は種別で区別できるように
    for b in gs:
        if b["code"].startswith("open") and not b.get("kind"):
            b["kind"] = "roof"

    with_base = [b for b in gs if "base" in b]
    near = sorted(with_base, key=lambda b: centroid(b["outer"])[0] ** 2 + centroid(b["outer"])[1] ** 2)[:30]
    ref = sorted(b["base"] for b in near)[len(near) // 2] if near else 0.0
    for b in gs:
        if "base" in b:
            b["e"] = round(b.pop("base") - ref, 2)
    for b in gs + extra:
        b.pop("_bb", None); b.pop("_matched", None)
    print(f"GSI: {len(gs)} buildings ({len(with_base)} with PLATEAU height), OSM supplement: {len(extra)}")
    return gs + extra, "建物: 国土地理院ベクトルタイル / 高さ: 国土交通省 Project PLATEAU 横浜市 (2024)"


def main():
    data = json.loads(SRC.read_text(encoding="utf-8"))
    els = data["elements"]

    buildings, parts, roads, rails, areas, waterways, pois = [], [], [], [], [], [], []
    street_nodes = []  # 信号機・歩行者用信号・バス停 (名前の無いものも)

    for el in els:
        t = el.get("tags", {})
        eid = f"{el['type'][0]}{el['id']}"

        if "building" in t or "building:part" in t:
            if t.get("building") == "no" or t.get("location") == "underground":
                continue
            is_part = "building:part" in t and "building" not in t
            h, mh = building_height(t, eid)
            for outer, holes in polygons(el):
                if not in_limit(centroid(outer)):
                    continue
                b = {"id": eid, "outer": outer, "h": h}
                if holes:
                    b["holes"] = holes
                if mh:
                    b["minH"] = mh
                kind = t.get("building") if not is_part else t.get("building:part")
                if kind and kind != "yes":
                    b["kind"] = kind
                if t.get("name"):
                    b["name"] = t["name"]
                if t.get("building:colour"):
                    b["color"] = t["building:colour"]
                (parts if is_part else buildings).append(b)
            continue

        if el["type"] == "way" and "highway" in t and "geometry" in el:
            hw = t["highway"]
            if t.get("area") == "yes" or hw == "pedestrian" and el["geometry"][0] == el["geometry"][-1]:
                for outer, holes in polygons(el):
                    areas.append({"kind": "plaza", "outer": outer, **({"holes": holes} if holes else {})})
                continue
            if hw not in ROAD_W or t.get("tunnel") == "yes":
                continue
            w = num(t.get("width")) or ROAD_W[hw]
            if t.get("lanes") and hw in ("trunk", "primary", "secondary", "tertiary"):
                w = max(w, num(t["lanes"]) * 3.25 + 1)
            for seg in clip_line(geom_pts(el["geometry"])):
                r = {"kind": hw, "w": round(w, 1), "pts": seg}
                if t.get("name"):
                    r["name"] = t["name"]
                if t.get("bridge"):
                    r["bridge"] = 1
                if t.get("layer"):
                    r["layer"] = num(t["layer"])
                roads.append(r)
            continue

        if el["type"] == "way" and "railway" in t and "geometry" in el:
            rw = t["railway"]
            if t.get("tunnel") == "yes" or rw == "subway":
                continue
            if rw == "platform":
                for outer, holes in polygons(el):
                    areas.append({"kind": "platform", "outer": outer})
                continue
            if rw not in ("rail", "light_rail"):
                continue
            for seg in clip_line(geom_pts(el["geometry"])):
                r = {"kind": rw, "pts": seg}
                if t.get("name"):
                    r["name"] = t["name"]
                if t.get("bridge"):
                    r["bridge"] = 1
                rails.append(r)
            continue

        if el["type"] == "way" and "waterway" in t and "geometry" in el:
            ww = t["waterway"]
            w = {"river": 22, "stream": 3, "canal": 6, "drain": 2, "ditch": 1.5}.get(ww)
            if not w:
                continue
            w = num(t.get("width")) or w
            for seg in clip_line(geom_pts(el["geometry"])):
                waterways.append({"kind": ww, "w": w, "pts": seg, **({"name": t["name"]} if t.get("name") else {})})
            continue

        areas.extend(osm_areas(el, t))

        if el["type"] == "node":
            sk = ("signal" if t.get("highway") == "traffic_signals"
                  else "bus_stop" if t.get("highway") == "bus_stop"
                  else "crossing_signal" if t.get("crossing") == "traffic_signals" else None)
            if sk:
                p = proj(el["lat"], el["lon"])
                if in_limit(p, 30):
                    n = {"kind": sk, "x": p[0], "z": p[1]}
                    if t.get("name"):
                        n["name"] = t["name"]
                    street_nodes.append(n)

        if el["type"] == "node" and t.get("name"):
            p = proj(el["lat"], el["lon"])
            if in_limit(p):
                cat = next((f"{k}:{t[k]}" for k in ("railway", "amenity", "shop", "tourism", "leisure", "highway", "public_transport", "office") if k in t), "other")
                pois.append({"name": t["name"], "x": p[0], "z": p[1], "cat": cat})

    # building:part が乗っている外形は外形を消して part を使う (重なり防止)
    part_cents = [centroid(p["outer"]) for p in parts]
    kept = []
    for b in buildings:
        if any(point_in(c, b["outer"]) for c in part_cents):
            continue
        kept.append(b)
    buildings = kept + parts

    plateau_note = None
    if GSI.exists():
        buildings, plateau_note = merge_gsi(buildings)
    elif PLATEAU.exists():
        buildings, plateau_note = merge_plateau(buildings)

    # 現地情報による修正 (data/corrections.json)。ファイルを消せば元データのまま
    if CORRECTIONS.exists():
        buildings = apply_corrections(buildings, json.loads(CORRECTIONS.read_text(encoding="utf-8")))

    road_areas = process_roads(roads)
    classify(buildings, els, pois)
    sites = apply_appearance(buildings, areas)

    # 地形: 各建物の基礎の高さ y (輪郭の頂点で一番低い地面)。建物の高さ h は基礎からの高さのまま
    Ht = terrain_sampler()
    if Ht:
        compute_bridges(roads, rails, Ht)
        for b in buildings:
            b["y"] = round(min(Ht(x, z) for x, z in b["outer"]), 2)
        print("terrain: building bases set")

    # 点群 (fetch_lidar.py) があれば、建物の形 (段・屋根・欠け) を実測に合わせて作り直す
    lidar_note = None
    if LIDAR_DSM.exists() and Ht:
        import lidar_shape
        ref = json.loads(TERRAIN.read_text(encoding="utf-8"))["ref"]
        buildings = lidar_shape.apply(buildings, ref)
        lidar_note = "形と屋根の色: 神奈川県 点群・オルソ画像 (CC BY 4.0)"

        # 歩道橋・デッキ・そこへ上がる階段の高さも実測に合わせる (deck_heights.py)
        import deck_heights
        Hd, _ = deck_heights.terrain_sampler()
        levels = json.loads(APPEARANCE.read_text(encoding="utf-8")).get("deck_levels", []) if APPEARANCE.exists() else []
        n_deck, rate = deck_heights.apply(roads, Hd, ref, lidar_shape.DSM(), levels, False, deck_heights.inside_any(buildings))
        print(f"deck heights: {n_deck} ways (measured {rate * 100:.0f}%)")

    # 目印になる大きな建物の外観 (data/appearance.json の landmarks)。上の段にも付けるので、形を直した後に行う
    import landmarks
    looks = landmarks.apply(buildings, roads)

    # 名前付き建物を POI に追加
    for b in buildings:
        if b.get("name"):
            c = centroid(b["outer"])
            pois.append({"name": b["name"], "x": round(c[0], 1), "z": round(c[1], 1), "cat": "building", "h": b["h"]})
    for a in areas:
        if a.get("name") and a["kind"] in POI_AREA_KINDS:
            c = centroid(a["outer"])
            if in_limit(c):
                pois.append({"name": a["name"], "x": round(c[0], 1), "z": round(c[1], 1), "cat": f"area:{a['kind']}"})

    # 面積の大きい順に (小さい面が上に来るよう描画順に使う)
    areas.sort(key=lambda a: -abs(area2(a["outer"])))

    out = {
        "version": 1,
        "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
        "units": "meters; x=east, z=south",
        "bounds": BOUNDS,
        "sites": sites,
        "looks": looks,
        "start": {**dict(zip(("x", "z"), proj(START["lat"], START["lon"]))), **({"face": list(proj(*START["face_toward"]))} if START.get("face_toward") else {})},
        "waypoints": [{"name": w["name"], "x": proj(w["lat"], w["lon"])[0], "z": proj(w["lat"], w["lon"])[1]} for w in WAYPOINTS],
        "attribution": "(c) OpenStreetMap contributors (ODbL)" + (" / " + plateau_note if plateau_note else "") + (" / " + lidar_note if lidar_note else ""),
        "buildings": buildings,
        "roads": roads,
        "roadAreas": road_areas,
        "rails": rails,
        "waterways": waterways,
        "areas": areas,
        "pois": pois,
        "streetNodes": street_nodes,
    }
    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"buildings={len(buildings)} roads={len(roads)} rails={len(rails)} water={len(waterways)} areas={len(areas)} pois={len(pois)} street_nodes={len(street_nodes)}")
    print(f"-> {DST} ({DST.stat().st_size // 1024} KB)")

    # 点群と航空写真があれば、地面の種類・木・駐車場・建物データに無い建物も作る (lidar_cover.py。最後に build_props.py も実行する)
    try:
        import lidar_cover
        have = lidar_cover.ORTHO_BIN.exists() and (lidar_cover.CACHE.exists() or any(lidar_cover.FL.CACHE.glob("*.zip")))
    except ImportError:   # numpy が無い
        have = False
    if have:
        lidar_cover.main()
        return
    # 路上の小物・敷地の外構の配置と当たり判定 (public/data/props.json)
    import build_props
    build_props.main()


if __name__ == "__main__":
    main()
