"""public/data/city.json -> public/data/props.json (路上の小物・敷地の外構・建物の飾り・木の配置 + 当たり判定)

以前はブラウザ (public/src/detail/*.js と city.js の木) が起動のたびに計算していた配置を、ここで計算してデータにする。
ブラウザ版も Unity 版も props.json を読んで置くだけにするため。

使い方: python tools/build_props.py
  build_city.py と lidar_shape.py は city.json を書いた後にこれを呼ぶ。

座標: city.json と同じ (1単位=1m, x=東, y=上, z=南)。
  y   = その場所の地面の高さ (terrain.json と同じ補間)。敷地の小物は基準の高さ。
  yaw = Y 軸まわりの回転 (ラジアン)。回転後の局所 +Z が (sin yaw, cos yaw) を向く (three.js の rotation.y と同じ)。
形式の詳細は README の「小物の配置 (props.json)」。
"""
import json
import math
import pathlib
import re
from decimal import Decimal, ROUND_HALF_UP

ROOT = pathlib.Path(__file__).resolve().parent.parent
CITY = ROOT / "public" / "data" / "city.json"
TERRAIN = ROOT / "public" / "data" / "terrain.json"
DST = ROOT / "public" / "data" / "props.json"
LOTS = ROOT / "data" / "lots.json"  # 点群から読んだ木の位置・広い舗装 (tools/lidar_cover.py が作る。無ければ使わない)

RADIUS = 3000  # スタート地点からの半径 (m)。3000 = マップ全体 (旧 detail/config.js の radius)
STEP = 0.4     # world.js の STEP (乗り越えられる段差)

POLE_ROADS = {"residential", "unclassified", "tertiary", "living_street", "secondary", "service"}
DRIVABLE = {"trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link",
            "unclassified", "residential", "living_street", "service", "busway"}
MAJOR = {"trunk", "primary", "secondary", "tertiary"}
RANK = {"trunk": 5, "primary": 4, "secondary": 3, "tertiary": 2, "trunk_link": 2, "primary_link": 2, "secondary_link": 2,
        "tertiary_link": 2, "unclassified": 1, "residential": 1, "living_street": 1, "busway": 1, "service": 0}
# 信号の 1 周期 (秒)。灯火の切り替えは描画側 (street.js) の仕事。ここでは各信号のずれ (offset) だけ決める
CYCLE = (22 + 3 + 2) * 2


def rank(k):
    return RANK.get(k, 0)


# ---------- JS と同じ結果にするための小道具 ----------
M32 = 0xFFFFFFFF


def imul(a, b):
    return (a * b) & M32


def hash_rng(s):
    """detail/util.js の hash() と同じ乱数列 (FNV-1a + 攪拌)"""
    h = 2166136261
    for ch in s:  # 使う文字列は ASCII だけ (JS の charCodeAt と同じ値)
        h ^= ord(ch)
        h = imul(h, 16777619)

    def rnd():
        nonlocal h
        h = imul(h ^ (h >> 15), 2246822507)
        h = imul(h ^ (h >> 13), 3266489909)
        h ^= h >> 16
        return h / 4294967296
    return rnd


def js_num(v):
    """JS の数値 → 文字列 (Array.join と同じ)"""
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e21:
        return str(int(v))
    return repr(v) if isinstance(v, float) else str(v)


def js_join(arr):
    return ",".join(js_num(v) for v in arr)


def to_fixed(v, n):
    """JS の Number.prototype.toFixed (ちょうど半分は 0 から遠い方へ)"""
    q = Decimal(1).scaleb(-n)
    s = str(Decimal(v).quantize(q, rounding=ROUND_HALF_UP))
    return s


def r2(v):
    return round(v, 2)


def r3(v):
    return round(v, 3)


# ---------- 地形 (terrain.js の H と同じ補間) ----------
def load_terrain():
    if not TERRAIN.exists():
        return lambda x, z: 0.0
    T = json.loads(TERRAIN.read_text(encoding="utf-8"))
    nx, nz, step, minX, minZ, h = T["nx"], T["nz"], T["step"], T["minX"], T["minZ"], T["h"]

    def H(x, z):
        fx = max(0, min(nx - 1.0001, (x - minX) / step))
        fz = max(0, min(nz - 1.0001, (z - minZ) / step))
        i, j = math.floor(fx), math.floor(fz)
        u, v = fx - i, fz - j
        g = lambda ii, jj: h[jj * nx + ii] / 100
        h00, h10, h01, h11 = g(i, j), g(i + 1, j), g(i, j + 1), g(i + 1, j + 1)
        return h00 + u * (h10 - h00) + v * (h11 - h10) if u >= v else h00 + v * (h01 - h00) + u * (h11 - h01)
    return H


# ---------- 建物の索引 (world.js の World と同じ判定) ----------
class World:
    def __init__(self, buildings, cell=16):
        self.cell = cell
        self.grid = {}
        self.list = []
        for b in buildings:
            rings = [b["outer"], *(b.get("holes") or [])]
            xs = [p[0] for p in b["outer"]]
            zs = [p[1] for p in b["outer"]]
            base = b.get("y") or 0
            minH = b.get("minH") or 0
            rec = {"id": b["id"], "rings": rings, "h": b["h"], "minH": minH, "base": base, "topY": base + b["h"],
                   "minY": base + minH, "minx": min(xs), "maxx": max(xs), "minz": min(zs), "maxz": max(zs), "idx": len(self.list)}
            self.list.append(rec)
            for i in range(math.floor(rec["minx"] / cell), math.floor(rec["maxx"] / cell) + 1):
                for j in range(math.floor(rec["minz"] / cell), math.floor(rec["maxz"] / cell) + 1):
                    self.grid.setdefault((i, j), []).append(rec)

    def query(self, minx, minz, maxx, maxz):
        seen, out, c = set(), [], self.cell
        for i in range(math.floor(minx / c), math.floor(maxx / c) + 1):
            for j in range(math.floor(minz / c), math.floor(maxz / c) + 1):
                for r in self.grid.get((i, j), ()):
                    if r["idx"] in seen:
                        continue
                    seen.add(r["idx"])
                    if r["maxx"] < minx or r["minx"] > maxx or r["maxz"] < minz or r["minz"] > maxz:
                        continue
                    out.append(r)
        out.sort(key=lambda r: r["idx"])  # JS はセルの順だが、結果を使う側は順序に依らない (find/some/最小値)
        return out

    @staticmethod
    def contains(b, x, z):
        if x < b["minx"] or x > b["maxx"] or z < b["minz"] or z > b["maxz"]:
            return False
        inside = False
        for ring in b["rings"]:
            j = len(ring) - 1
            for i in range(len(ring)):
                xi, zi = ring[i]
                xj, zj = ring[j]
                if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
                    inside = not inside
                j = i
        return inside

    @staticmethod
    def closest_d(b, x, z):
        best = math.inf
        for ring in b["rings"]:
            j = len(ring) - 1
            for i in range(len(ring)):
                ax, az = ring[j]
                ex, ez = ring[i][0] - ax, ring[i][1] - az
                l2 = ex * ex + ez * ez
                t = ((x - ax) * ex + (z - az) * ez) / l2 if l2 > 0 else 0
                t = 0 if t < 0 else 1 if t > 1 else t
                d2 = (x - ax - ex * t) ** 2 + (z - az - ez * t) ** 2
                if d2 < best:
                    best = d2
                j = i
        return math.sqrt(best)


class PointGrid:
    """「この点から d 以内に既にあるか」を速く調べる"""
    def __init__(self, cell=10):
        self.cell, self.g = cell, {}

    def add(self, x, z):
        self.g.setdefault((math.floor(x / self.cell), math.floor(z / self.cell)), []).append((x, z))

    def near(self, x, z, d):
        c = self.cell
        for i in range(math.floor((x - d) / c), math.floor((x + d) / c) + 1):
            for j in range(math.floor((z - d) / c), math.floor((z + d) / c) + 1):
                for px, pz in self.g.get((i, j), ()):
                    if (px - x) ** 2 + (pz - z) ** 2 < d * d:
                        return True
        return False


# ---------- 道路 (detail/util.js と同じ) ----------
def intersections(roads):
    m = {}
    key = lambda p: to_fixed(p[0], 1) + "," + to_fixed(p[1], 1)
    for r in roads:
        if r["kind"] not in DRIVABLE or r.get("ys"):
            continue
        pts = r["pts"]
        for i, p in enumerate(pts):
            k = key(p)
            n = m.get(k)
            if n is None:
                n = m[k] = {"x": p[0], "z": p[1], "arms": []}
            for j in (i - 1, i + 1):
                if j < 0 or j >= len(pts):
                    continue
                q = pts[j]
                dx, dz = q[0] - p[0], q[1] - p[1]
                L = math.hypot(dx, dz)
                if L > 0.5:
                    n["arms"].append({"road": r, "dir": (dx / L, dz / L), "len": L, "fwd": j == i + 1})
    return [n for n in m.values() if len(n["arms"]) >= 3]


def edge(r, side):
    """中心線から side (+1=左, -1=右) 側の道路面の縁まで"""
    return r["half"][0 if side > 0 else 1] if r.get("half") else r["w"] / 2


def carriage(r):
    sw = r.get("sw") or 0
    if r.get("half"):
        return r["half"][0] + r["half"][1] - 2 * sw, (r["half"][0] - r["half"][1]) / 2
    return r["w"] - 2 * sw, 0


def walk(pts, start, step, cb):
    """折れ線に沿って一定間隔の点を返す"""
    s, nxt = 0, start
    for i in range(len(pts) - 1):
        ax, az = pts[i]
        bx, bz = pts[i + 1]
        dx, dz = bx - ax, bz - az
        L = math.hypot(dx, dz)
        if L < 0.01:
            continue
        while nxt <= s + L:
            t = (nxt - s) / L
            cb(ax + dx * t, az + dz * t, dx / L, dz / L)
            nxt += step
        s += L


# ---------- 当たり判定の形 ----------
class Colliders:
    """circle: [x, z, r, y0, y1]
    box:    [x, z, yaw, hx, hz, y0, y1]  (hx = 局所 X の半幅, hz = 局所 Z の半幅)
    line:   [hw, h, x0, z0, y0, x1, z1, y1, ...]  折れ線に沿った厚さ 2*hw の壁。各区間の下端は両端の y の小さい方、高さ h
    tree:   circle と同じ形。木の幹 (木は小物の表示を切っても残るので、別にしてある)
    y0, y1 は絶対高さ (下端・上端)"""
    def __init__(self):
        self.circle, self.box, self.line, self.tree = [], [], [], []

    def add_line(self, pts, hw, h):
        self.line.append([hw, h] + [v for p in pts for v in p])

    def add_circle(self, x, z, r, y0, h):
        self.circle.append([r2(x), r2(z), r3(r), r2(y0), r2(y0 + h)])

    def add_box(self, x, z, yaw, hx, hz, y0, h):
        self.box.append([r2(x), r2(z), r3(yaw), r3(hx), r3(hz), r2(y0), r2(y0 + h)])


# =====================================================================
# 1. 路上の小物: 電柱・電線・街灯・路面標示・ガードパイプ・自販機・カーブミラー (旧 detail/props.js)
# =====================================================================
def build_street_props(city, world, H, cx, cz, R, col):
    inR = lambda x, z, m=0: (x - cx) ** 2 + (z - cz) ** 2 <= (R + m) ** 2
    roads = [r for r in city["roads"] if any(inR(p[0], p[1], 40) for p in r["pts"])]
    nodes = [n for n in intersections(roads) if inR(n["x"], n["z"])]
    node_grid = PointGrid(20)
    for n in nodes:
        node_grid.add(n["x"], n["z"])

    def clear(x, z, r):
        for b in world.query(x - r, z - r, x + r, z + r):
            if world.contains(b, x, z) or world.closest_d(b, x, z) < r:
                return False
        return True

    def near_building(x, z, r):
        return any(world.closest_d(b, x, z) < r for b in world.query(x - r, z - r, x + r, z + r))

    gates = [s["gate"] for s in city.get("sites") or [] if s.get("gate") and s["gate"].get("center")]

    def at_gate(x, z):
        for g in gates:
            dx, dz = x - g["center"][0], z - g["center"][1]
            if abs(-dx * g["axis"][1] + dz * g["axis"][0]) < g["passage"] / 2 + 1.0 and abs(dx * g["axis"][0] + dz * g["axis"][1]) < g["length"] / 2 + 15:
                return True
        return False

    # ---------- 電柱・電線・街灯 ----------
    poles, chains = [], []
    pole_grid = PointGrid(10)
    for r in roads:
        if r["kind"] not in POLE_ROADS or r["w"] < 4 or r.get("ys"):
            continue
        rnd = hash_rng("pole" + js_join(r["pts"][0]))
        side = 1 if rnd() < 0.5 else -1
        chain = []

        def cb(x, z, dx, dz, r=r, side=side, chain=chain):
            nx, nz = -dz * side, dx * side
            off = edge(r, side) - r["sw"] + 0.6 if r.get("sw") else edge(r, side) + 0.5
            px, pz = x + nx * off, z + nz * off
            if not inR(px, pz) or not clear(px, pz, 0.5) or pole_grid.near(px, pz, 9):
                if chain:
                    chains.append(chain[:])
                    chain.clear()
                return
            p = {"x": px, "z": pz, "tx": -nx, "tz": -nz, "i": len(poles)}
            poles.append(p)
            pole_grid.add(px, pz)
            chain.append(p)
        walk(r["pts"], 8 + rnd() * 10, 30, cb)
        if chain:
            chains.append(chain)

    out_poles = []
    for p in poles:
        y = H(p["x"], p["z"])
        p["y"] = y
        out_poles.append({"x": r2(p["x"]), "z": r2(p["z"]), "y": r2(y), "yaw": r3(math.atan2(p["tx"], p["tz"])),
                          "transformer": p["i"] % 3 == 1, "lamp": p["i"] % 2 == 0})
        col.add_circle(p["x"], p["z"], 0.2, y, 10.5)

    # 電線: 隣り合う電柱の間。腕金の 3 本 (高さ 9.68) + 通信線 2 本。たるみ sag (m) は中央での下がり
    wires = []
    for ch in chains:
        for i in range(len(ch) - 1):
            a, b = ch[i], ch[i + 1]
            if math.hypot(a["x"] - b["x"], a["z"] - b["z"]) > 45:
                continue
            for o in (-0.75, 0, 0.75):
                wires.append([r2(a["x"] + a["tz"] * o), r2(a["y"] + 9.68), r2(a["z"] - a["tx"] * o),
                              r2(b["x"] + b["tz"] * o), r2(b["y"] + 9.68), r2(b["z"] - b["tx"] * o), 0.35])
            wires.append([r2(a["x"]), r2(a["y"] + 7.2), r2(a["z"]), r2(b["x"]), r2(b["y"] + 7.2), r2(b["z"]), 0.5])
            wires.append([r2(a["x"]), r2(a["y"] + 6.9), r2(a["z"]), r2(b["x"]), r2(b["y"] + 6.9), r2(b["z"]), 0.55])

    # ---------- 路面標示 (横断歩道の縞・停止線・止まれ) ----------
    # 長方形 [中心x, 中心z, 長さ方向dx, dz, 長さ, 幅]。路面に沿わせる (drape) のは描画側
    paint, tomare = [], []

    def rect(lst, x, z, d, L, w):
        lst.append([r2(x), r2(z), r3(d[0]), r3(d[1]), r3(L), r3(w)])

    for n in nodes:
        max_rank = max(rank(a["road"]["kind"]) for a in n["arms"])
        has_major = any(a["road"]["kind"] in MAJOR for a in n["arms"])
        for a in n["arms"]:
            others = [o for o in n["arms"] if o is not a]
            half = max(o["road"]["w"] / 2 for o in others)
            dx, dz = a["dir"]
            nx, nz = -dz, dx
            w, cc = carriage(a["road"])
            c0 = cc if a["fwd"] else -cc
            if has_major and w >= 5 and a["len"] > half + 6:
                d = half + 2.2
                cnt = math.floor((w - 1) / 0.9)
                for i in range(cnt):
                    t = (i - (cnt - 1) / 2) * 0.9
                    rect(paint, n["x"] + dx * d + nx * (t + c0), n["z"] + dz * d + nz * (t + c0), (dx, dz), 3.0, 0.45)
            if rank(a["road"]["kind"]) < max_rank and a["road"]["kind"] in DRIVABLE and a["len"] > half + 9:
                d = half + (4.2 if has_major else 1.2)
                rect(paint, n["x"] + dx * d + nx * c0, n["z"] + dz * d + nz * c0, (nx, nz), w * 0.9, 0.35)
                if w >= 4:
                    # 文字の上が交差点側。左側通行なので、交差点へ向かう進行方向 (-dir) の左車線
                    dt, lane = d + 3.4, w / 4
                    left = (-dz, dx)
                    ox, oz = n["x"] + dx * dt + left[0] * (c0 + lane), n["z"] + dz * dt + left[1] * (c0 + lane)
                    rect(tomare, ox, oz, (-dx, -dz), 4.0, min(2.4, w * 0.45))

    # ---------- ガードパイプ (幹線の歩道側) ----------
    # ひと続きの柵ごとに支柱の点の列 [[x, z, y], ...]。支柱は約 2m おき、隣どうしをパイプ 2 段 (高さ 0.45, 0.8) でつなぐ
    guards = []
    for r in roads:
        if r["kind"] not in MAJOR or r.get("ys"):
            continue
        for side in (1, -1):
            run = [None]

            def cb(x, z, dx, dz, r=r, side=side, run=run):
                go = edge(r, side) - r["sw"] + 0.2 if r.get("sw") else edge(r, side) + 0.2
                px, pz = x - dz * side * go, z + dx * side * go
                ok = inR(px, pz) and not node_grid.near(x, z, r["w"] / 2 + 9) and clear(px, pz, 0.3) and not at_gate(px, pz)
                if not ok:
                    run[0] = None
                    return
                cur = run[0]
                if cur and math.hypot(cur[-1][0] - px, cur[-1][1] - pz) < 2.6:
                    cur.append((px, pz))
                else:
                    run[0] = [(px, pz)]
                    guards.append(run[0])
            walk(r["pts"], 1, 2, cb)
    out_guards = []
    for g in guards:
        pts = [[r2(x), r2(z), r2(H(x, z))] for x, z in g]
        out_guards.append(pts)
        if len(pts) >= 2:
            col.add_line(pts, 0.06, 0.85)
    n_posts = sum(len(g) for g in guards)

    # ---------- 自販機 ----------
    vending = []
    for r in roads:
        if r["kind"] not in ("residential", "unclassified", "tertiary", "living_street") or len(vending) >= 60 or r.get("ys"):
            continue
        rnd = hash_rng("vend" + js_join(r["pts"][0]))

        def cb(x, z, dx, dz, r=r, rnd=rnd):
            if len(vending) >= 60:
                return
            side = 1 if rnd() < 0.5 else -1
            nx, nz = -dz * side, dx * side
            for off in (edge(r, side) + 0.6, edge(r, side) + 1.2):
                px, pz = x + nx * off, z + nz * off
                if not inR(px, pz) or not clear(px, pz, 0.6) or not near_building(px, pz, 2.5) or pole_grid.near(px, pz, 2):
                    continue
                color = math.floor(rnd() * 3)
                y, yaw = H(px, pz), math.atan2(-nx, -nz)  # 正面 (+Z) を道路側へ
                vending.append({"x": r2(px), "z": r2(pz), "y": r2(y), "yaw": r3(yaw), "color": color})
                col.add_box(px, pz, yaw, 0.5, 0.375, y, 1.83)
                break
        walk(r["pts"], 15 + rnd() * 30, 80, cb)

    # ---------- カーブミラー (生活道路どうしの交差点) ----------
    mirrors = []
    for n in nodes:
        if len(mirrors) >= 150 or any(rank(a["road"]["kind"]) > 1 for a in n["arms"]):
            continue
        a, b = n["arms"][0], n["arms"][1]
        bx, bz = a["dir"][0] + b["dir"][0], a["dir"][1] + b["dir"][1]
        L = math.hypot(bx, bz)
        if L < 0.3:
            continue
        bx, bz = bx / L, bz / L
        half = max(o["road"]["w"] / 2 for o in n["arms"])
        px, pz = n["x"] + bx * (half + 1.3), n["z"] + bz * (half + 1.3)
        if not clear(px, pz, 0.3):
            continue
        y = H(px, pz)
        mirrors.append({"x": r2(px), "z": r2(pz), "y": r2(y), "yaw": r3(math.atan2(-bx, -bz))})
        col.add_circle(px, pz, 0.08, y, 3.3)

    print(f"poles={len(poles)} wires={len(wires)} paint={len(paint)} tomare={len(tomare)} guard runs={len(guards)} posts={n_posts} vending={len(vending)} mirrors={len(mirrors)}")
    return {"poles": out_poles, "wires": wires, "paint": paint, "tomare": tomare,
            "guardRails": out_guards, "vending": vending, "mirrors": mirrors}


# =====================================================================
# 2. 信号機・歩行者用信号・単路の横断歩道・バス停 (旧 detail/street.js)
# =====================================================================
def build_signals(city, world, H, cx, cz, R, col, paint):
    inR = lambda x, z, m=0: (x - cx) ** 2 + (z - cz) ** 2 <= (R + m) ** 2
    roads = [r for r in city["roads"] if not r.get("ys") and r["kind"] in DRIVABLE and any(inR(p[0], p[1], 60) for p in r["pts"])]
    nodes = intersections(roads)

    def clear(x, z, r):  # 地上の建物の中・壁際は不可。高架の建物の下は可
        for b in world.query(x - r, z - r, x + r, z + r):
            if b["minH"] > 2.5:
                continue
            if world.contains(b, x, z) or world.closest_d(b, x, z) < r:
                return False
        return True

    pts = city.get("streetNodes")
    if not pts:
        pts = []
        for p in city.get("pois") or []:
            if p["cat"] == "highway:traffic_signals":
                pts.append({"kind": "signal", "x": p["x"], "z": p["z"], "name": p.get("name")})
            elif p["cat"] == "highway:bus_stop":
                pts.append({"kind": "bus_stop", "x": p["x"], "z": p["z"], "name": p.get("name")})
    pts = [p for p in pts if inR(p["x"], p["z"])]

    def nearest_road(x, z, maxD):
        best = None
        for r in roads:
            P = r["pts"]
            for i in range(len(P) - 1):
                ax, az = P[i]
                bx, bz = P[i + 1]
                ex, ez = bx - ax, bz - az
                l2 = ex * ex + ez * ez
                if l2 < 0.01:
                    continue
                t = max(0, min(1, ((x - ax) * ex + (z - az) * ez) / l2))
                px, pz = ax + ex * t, az + ez * t
                d = math.hypot(x - px, z - pz)
                if d < maxD and (best is None or d < best["d"]):
                    L = math.sqrt(l2)
                    best = {"r": r, "x": px, "z": pz, "d": d, "dx": ex / L, "dz": ez / L}
        return best

    def mid_site(s):
        return {"x": s["x"], "z": s["z"], "mid": True, "arms": [
            {"road": s["r"], "dir": (s["dx"], s["dz"]), "len": 99, "fwd": True},
            {"road": s["r"], "dir": (-s["dx"], -s["dz"]), "len": 99, "fwd": False}]}

    sites, used = [], set()
    for p in [p for p in pts if p["kind"] == "signal"]:
        n, nd = None, 20
        for q in nodes:
            d = math.hypot(q["x"] - p["x"], q["z"] - p["z"])
            if d < nd:
                nd, n = d, q
        if n:
            if id(n) in used:
                continue
            used.add(id(n))
            sites.append({"x": n["x"], "z": n["z"], "arms": n["arms"], "mid": False})
        else:
            s = nearest_road(p["x"], p["z"], 15)
            if s:
                sites.append(mid_site(s))
    for p in [p for p in pts if p["kind"] == "crossing_signal"]:  # 単路の押しボタン式など
        if any(math.hypot(s["x"] - p["x"], s["z"] - p["z"]) < 30 for s in sites):
            continue
        s = nearest_road(p["x"], p["z"], 10)
        if s:
            sites.append(mid_site(s))

    vehicle, peds = [], []
    for site in sites:
        rnd = hash_rng("sig" + to_fixed(site["x"], 1) + to_fixed(site["z"], 1))
        offset = rnd() * CYCLE
        arms = [a for a in site["arms"] if not (a["road"]["kind"] == "service" and a["road"]["w"] < 5)]
        if len(arms) < 2:
            continue
        key = lambda a: rank(a["road"]["kind"]) * 100 + a["road"]["w"]
        m = arms[0]
        for a in arms[1:]:
            if key(a) > key(m):
                m = a
        ref = m["dir"]
        axis_of = lambda a: 0 if abs(a["dir"][0] * ref[0] + a["dir"][1] * ref[1]) > 0.7 else 1
        for a in arms:
            cross_half = 0 if site["mid"] else max([0] + [o["road"]["w"] / 2 for o in site["arms"] if o is not a])
            dx, dz = a["dir"]
            nx, nz = -dz, dx
            w, cc = carriage(a["road"])
            c0 = cc if a["fwd"] else -cc
            if w < 3:
                continue
            cwD = 0 if site["mid"] else cross_half + 2.2  # 横断歩道の中心 (路面標示と同じ位置)
            if site["mid"] and a["fwd"]:  # 単路の横断歩道の縞 (片方の腕だけ)
                cnt = math.floor((w - 1) / 0.9)
                for i in range(cnt):
                    t = (i - (cnt - 1) / 2) * 0.9
                    paint.append([r2(site["x"] + nx * (t + c0)), r2(site["z"] + nz * (t + c0)), r3(dx), r3(dz), 3.0, 0.45])
            # 車両用: この腕から出ていく車線の左側、横断歩道の先。灯器は交差点側 (-dir) を向き、車道の上に張り出す
            side = -1 if a["fwd"] else 1
            d = cwD + (4 if site["mid"] else 2.5)
            if a["len"] > d * 0.7 or site["mid"]:
                half_l = edge(a["road"], side)
                sw = a["road"].get("sw") or 0
                for off in ([half_l - sw + 0.5, half_l - sw + 1.0] if sw else [half_l + 0.4, half_l + 0.9, half_l]):
                    px, pz = site["x"] + dx * d - nx * off, site["z"] + dz * d - nz * off
                    if not clear(px, pz, 0.35):
                        continue
                    curbL = c0 - w / 2
                    reach = min(5.5, max(1.6, off + curbL + min(w / 2, 3.5) * 0.6))
                    y = H(px, pz)
                    vehicle.append({"x": r2(px), "z": r2(pz), "y": r2(y), "yaw": r3(math.atan2(-dx, -dz)), "reach": r3(reach),
                                    "axis": axis_of(a), "offset": r3(offset)})
                    col.add_circle(px, pz, 0.16, y, 6.2)
                    break
            # 歩行者用: 横断歩道の両端。向かい側の端を向く
            if not site["mid"] or a["fwd"]:
                if not site["mid"] and not (any(o["road"]["kind"] in MAJOR for o in arms) and w >= 5 and a["len"] > cross_half + 6):
                    continue
                ends = [c0 - w / 2 - 0.6, c0 + w / 2 + 0.6]
                pos = [(site["x"] + dx * cwD + nx * o, site["z"] + dz * cwD + nz * o) for o in ends]
                for k in range(2):
                    px, pz = pos[k]
                    qx, qz = pos[1 - k]
                    if not clear(px, pz, 0.3):
                        continue
                    L = math.hypot(qx - px, qz - pz) or 1
                    sx, sz = px + dx * 1.9, pz + dz * 1.9  # 柱は横断歩道の脇
                    y = H(sx, sz)
                    peds.append({"x": r2(sx), "z": r2(sz), "y": r2(y), "yaw": r3(math.atan2((qx - px) / L, (qz - pz) / L)),
                                 "axis": axis_of(a), "offset": r3(offset)})
                    col.add_circle(sx, sz, 0.1, y, 3.2)

    stops = []
    for p in [p for p in pts if p["kind"] == "bus_stop"]:
        s = nearest_road(p["x"], p["z"], 25)
        if not s or any(math.hypot(o["px"] - p["x"], o["pz"] - p["z"]) < 3 for o in stops):
            continue
        nx, nz = -s["dz"], s["dx"]
        side = 1 if (p["x"] - s["x"]) * nx + (p["z"] - s["z"]) * nz >= 0 else -1
        e, sw = edge(s["r"], side), s["r"].get("sw") or 0
        for off in ([e - sw + 0.6, e - sw + 1.2] if sw else [e + 0.5, e + 1.0, e, e - 0.4]):
            x, z = s["x"] + nx * side * off, s["z"] + nz * side * off
            if not clear(x, z, 0.35):
                continue
            y = H(x, z)
            # 正面 (+Z) を歩道側 (道路の外向き) に
            stops.append({"x": r2(x), "z": r2(z), "y": r2(y), "yaw": r3(math.atan2(nx * side, nz * side)),
                          "name": p.get("name") or "バス停", "px": p["x"], "pz": p["z"]})
            col.add_circle(x, z, 0.38, y, 0.28)
            col.add_circle(x, z, 0.06, y, 2.5)
            break
    for s in stops:
        del s["px"], s["pz"]

    print(f"signal sites={len(sites)} vehicle signals={len(vehicle)} ped signals={len(peds)} bus stops={len(stops)}")
    return {"signals": vehicle, "pedSignals": peds, "busStops": stops}


# =====================================================================
# 3. 敷地の外構 (data/appearance.json の sites) (旧 detail/site.js, site_extras.js)
# =====================================================================
def hull(pts):
    p = sorted(pts, key=lambda q: (q[0], q[1]))
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for q in p:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], q) <= 0:
            lo.pop()
        lo.append(q)
    for q in reversed(p):
        while len(up) >= 2 and cross(up[-2], up[-1], q) <= 0:
            up.pop()
        up.append(q)
    return lo[:-1] + up[:-1]


def pip(x, z, r):
    ins = False
    j = len(r) - 1
    for i in range(len(r)):
        xi, zi = r[i]
        xj, zj = r[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            ins = not ins
        j = i
    return ins


def signed_area(r):
    return sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r))) / 2


def build_sites(city, world, H, col):
    by_id = {b["id"]: b for b in city["buildings"]}

    def clear_of(x, z, r):
        for b in world.query(x - r, z - r, x + r, z + r):
            if b["minH"] > 2:
                continue
            if world.contains(b, x, z) or world.closest_d(b, x, z) < r:
                return False
        return True

    out = []
    for site in city.get("sites") or []:
        o = {"name": site.get("name")}
        gi = None
        # ---------- 中庭の庭園 ----------
        g = site.get("garden")
        if g:
            blds = [by_id[i] for i in site["buildings"] if i in by_id and by_id[i].get("style") == "apartment"]
            blds.sort(key=lambda b: -abs(signed_area(b["outer"])))
            main = blds[0] if blds else None
            if main:
                HULL = hull(main["outer"])
                C = 1.5
                minx, maxx = min(p[0] for p in HULL), max(p[0] for p in HULL)
                minz, maxz = min(p[1] for p in HULL), max(p[1] for p in HULL)
                cells = []
                x = minx + C / 2
                while x < maxx:
                    z = minz + C / 2
                    while z < maxz:
                        if pip(x, z, HULL) and clear_of(x, z, 1.2):
                            cells.append((x, z))
                        z += C
                    x += C
                if len(cells) > 20:
                    cx = sum(c[0] for c in cells) / len(cells)
                    cz = sum(c[1] for c in cells) / len(cells)
                    sxx = szz = sxz = 0
                    for x, z in cells:
                        sxx += (x - cx) ** 2
                        szz += (z - cz) ** 2
                        sxz += (x - cx) * (z - cz)
                    ang = 0.5 * math.atan2(2 * sxz, sxx - szz)
                    ux, uz = math.cos(ang), math.sin(ang)
                    along = lambda x, z: (x - cx) * ux + (z - cz) * uz
                    across = lambda x, z: -(x - cx) * uz + (z - cz) * ux
                    ext = [along(x, z) for x, z in cells]
                    extA = [across(x, z) for x, z in cells]
                    lo, hi, loA, hiA = min(ext), max(ext), min(extA), max(extA)
                    P = lambda t, a: (cx + ux * t - uz * a, cz + uz * t + ux * a)
                    # 通路: [中心x, 中心z, 向きdx, dz, 長さ, 幅, 模様のずれ]
                    paths = []

                    def strip(t0, t1, w, dir_along):
                        n = max(1, round((t1 - t0) / 1.0))
                        for i in range(n):
                            ta, tb = t0 + (t1 - t0) * i / n, t0 + (t1 - t0) * (i + 1) / n
                            tm = (ta + tb) / 2
                            mx, mz = P(tm, 0) if dir_along else P(0, tm)
                            if not clear_of(mx, mz, 0.8):
                                continue
                            d = (ux, uz) if dir_along else (-uz, ux)
                            paths.append([r2(mx), r2(mz), r3(d[0]), r3(d[1]), r3(tb - ta + 0.02), w, r3(tm / 2)])
                    strip(lo, hi, 3.0, True)
                    strip(loA, hiA, 2.4, False)
                    gy = H(cx, cz)
                    garden = {"lawn": g.get("lawn") or "#86a85e", "cell": C, "cells": [[r2(x), r2(z)] for x, z in cells],
                              "paths": paths, "ring": {"x": r2(cx), "z": r2(cz), "r0": 0, "r1": 6.5}}
                    if g.get("fountain"):
                        garden["fountain"] = {"x": r2(cx), "z": r2(cz), "y": r2(gy)}
                        col.add_circle(cx, cz, 2.8, gy, 0.5)
                        col.add_circle(cx, cz, 0.35, gy, 2.0)
                    if g.get("cypress"):
                        trees = []
                        t = lo + 4
                        while t < hi - 3:
                            if abs(t) >= 9:
                                for side in (-1, 1):
                                    x, z = cx + ux * t - uz * side * 3.2, cz + uz * t + ux * side * 3.2
                                    if clear_of(x, z, 1.5):
                                        y = H(x, z)
                                        trees.append([r2(x), r2(z), r2(y)])
                                        col.add_circle(x, z, 0.6, y, 5.5)
                            t += 6
                        garden["cypress"] = trees
                    o["garden"] = garden
                    gi = {"cx": cx, "cz": cz, "ux": ux, "uz": uz, "lo": lo, "hi": hi, "P": P, "main": main}

        build_site_extras(site, city, world, H, col, gi, clear_of, o)

        # ---------- フェンス (敷地境界。建物に接する所と門の前は省く) ----------
        if site.get("fence"):
            gt = site.get("gate")

            def in_gateway(x, z):
                if not gt or not gt.get("center"):
                    return False
                dx, dz = x - gt["center"][0], z - gt["center"][1]
                al, ac = dx * gt["axis"][0] + dz * gt["axis"][1], -dx * gt["axis"][1] + dz * gt["axis"][0]
                return abs(ac) < gt["passage"] / 2 + 0.8 and abs(al) < gt["length"] / 2 + 12
            ring, posts = site["outer"], []
            for i in range(len(ring)):
                a, c = ring[i], ring[(i + 1) % len(ring)]
                L = math.hypot(c[0] - a[0], c[1] - a[1])
                t = 0
                while t <= L:
                    x, z = a[0] + (c[0] - a[0]) * t / L, a[1] + (c[1] - a[1]) * t / L
                    if not in_gateway(x, z) and clear_of(x, z, 1.0):
                        posts.append({"x": x, "z": z, "dx": (c[0] - a[0]) / L, "dz": (c[1] - a[1]) / L, "seg": i, "t": t})
                    t += 2.4
            panels = []
            for i in range(len(posts) - 1):
                p, q = posts[i], posts[i + 1]
                if p["seg"] == q["seg"] and abs(q["t"] - p["t"] - 2.4) < 0.01:
                    x, z, yaw = (p["x"] + q["x"]) / 2, (p["z"] + q["z"]) / 2, math.atan2(p["dx"], p["dz"])
                    y = H(x, z)
                    panels.append({"x": r2(x), "z": r2(z), "y": r2(y), "yaw": r3(yaw)})
                    col.add_box(x, z, yaw, 0.05, 1.25, y, 1.6)
            o["fence"] = {"color": site["fence"], "posts": [[r2(p["x"]), r2(p["z"]), r2(H(p["x"], p["z"]))] for p in posts], "panels": panels}
        out.append(o)
    return out


def build_site_extras(site, city, world, H, col, gi, clear_of, o):
    # ---------- 門: 通路の両面にアーチ ----------
    gt = site.get("gate")
    if gt and gt.get("center"):
        ux, uz = gt["axis"]
        gpart = next((b for b in city["buildings"] if b["id"] in site["buildings"] and b.get("style") == "gate"), None)
        gbase = (gpart.get("y") or 0) if gpart else H(*gt["center"])
        faces = []
        for side in (-1, 1):
            fx = gt["center"][0] + ux * side * (gt["length"] / 2 + 0.03)
            fz = gt["center"][1] + uz * side * (gt["length"] / 2 + 0.03)
            faces.append({"x": r2(fx), "z": r2(fz), "y": r2(gbase), "yaw": r3(math.atan2(ux, uz))})
        o["gate"] = {"width": gt["passage"], "clear_h": gt["clear_h"], "color": gt.get("color") or "#dcc6a0", "faces": faces}

    # ---------- 噴水のある円形広場 ----------
    pz = site.get("plaza")
    if pz:
        y = H(*pz["at"])
        o["plaza"] = {"x": pz["at"][0], "z": pz["at"][1], "y": r2(y), "r": pz["r"]}
        col.add_circle(pz["at"][0], pz["at"][1], 1.35, y, 0.52)

    # ---------- エントランス棟の正面 (いちばん front を向いた壁) ----------
    hl = site.get("hall")
    hallB = next((b for b in city["buildings"] if b.get("style") == "hall" and b["id"] in site["buildings"]), None) if hl else None
    if hallB:
        ring, n = hallB["outer"], len(hallB["outer"])
        sg = 1 if sum(ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1] for i in range(n)) > 0 else -1
        best = None
        for i in range(n):
            a, c = ring[i], ring[(i + 1) % n]
            L = math.hypot(c[0] - a[0], c[1] - a[1])
            nx, nz = (c[1] - a[1]) / L * sg, -(c[0] - a[0]) / L * sg
            d = nx * hl["front"][0] + nz * hl["front"][1]
            if best is None or d > best[0]:
                best = (d, a, c, L, nx, nz)
        _, a, c, L, nx, nz = best
        o["hall"] = {"x": r2((a[0] + c[0]) / 2), "z": r2((a[1] + c[1]) / 2), "y": r2(hallB.get("y") or 0), "yaw": r3(math.atan2(nx, nz)),
                     "width": r3(L), "height": hallB["h"], "color": hallB.get("color") or "#e3d2b0"}

    # ---------- 屋上の塔 ----------
    turrets = []
    for t in site.get("turrets") or []:
        x, z = t["at"]
        host = next((b for b in world.query(x, z, x, z) if world.contains(b, x, z)), None)
        if not host:
            continue
        bd = next((b for b in city["buildings"] if b["id"] == host["id"]), None)
        base = host["topY"] + (1.5 if bd and bd.get("mansard") else 0)
        turrets.append({"x": x, "z": z, "y": r2(base)})
        col.add_circle(x, z, 1.45, base, 4.4)
    if turrets:
        o["turrets"] = turrets

    # ---------- 1階の青い日よけ (中庭に面した長い壁) ----------
    if site.get("awnings") and gi:
        every = site["awnings"].get("every") or 7.2
        main, cx, cz = gi["main"], gi["cx"], gi["cz"]
        ring, n = main["outer"], len(main["outer"])
        sg = 1 if sum(ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1] for i in range(n)) > 0 else -1
        aw = []
        for i in range(n):
            a, c = ring[i], ring[(i + 1) % n]
            L = math.hypot(c[0] - a[0], c[1] - a[1])
            if L < 20:
                continue
            ux, uz = (c[0] - a[0]) / L, (c[1] - a[1]) / L
            nx, nz = uz * sg, -ux * sg
            mx, mz = (a[0] + c[0]) / 2, (a[1] + c[1]) / 2
            tc = math.hypot(cx - mx, cz - mz)
            if (cx - mx) * nx + (cz - mz) * nz < 0.6 * tc:
                continue
            t = every / 2 + 1.8
            while t < L - 2:
                aw.append({"x": r2(a[0] + ux * t + nx * 0.45), "z": r2(a[1] + uz * t + nz * 0.45), "y": r2((main.get("y") or 0) + 2.55),
                           "yaw": r3(math.atan2(nx, nz))})
                t += every
        o["awnings"] = {"color": site["awnings"]["color"], "items": aw}

    # ---------- 庭: 花壇・オベリスク・丸い天窓 ----------
    if gi:
        lo, hi, P = gi["lo"], gi["hi"], gi["P"]
        yaw = math.atan2(gi["ux"], gi["uz"])
        beds = []
        t = lo + 6
        while t < hi - 6:
            if abs(t) >= 10:
                for side in (-1, 1):
                    x, z = P(t, side * 6.5)
                    if clear_of(x, z, 2.6):
                        y = H(x, z)
                        beds.append({"x": r2(x), "z": r2(z), "y": r2(y), "yaw": r3(yaw)})
                        col.add_box(x, z, yaw, 1.7, 2.1, y, 0.75)
            t += 12
        o["beds"] = beds
        hallC = None
        if hallB:
            hn = len(hallB["outer"])
            hallC = (sum(p[0] for p in hallB["outer"]) / hn, sum(p[1] for p in hallB["outer"]) / hn)
        ends = [P(lo + 7, 0), P(hi - 7, 0)]
        near = 0
        if hallC:
            near = 0 if math.hypot(ends[0][0] - hallC[0], ends[0][1] - hallC[1]) < math.hypot(ends[1][0] - hallC[0], ends[1][1] - hallC[1]) else 1
        ox, oz = ends[near]
        oy = H(ox, oz)
        o["obelisk"] = {"x": r2(ox), "z": r2(oz), "y": r2(oy)}
        col.add_box(ox, oz, 0, 0.7, 0.7, oy, 0.8)
        col.add_circle(ox, oz, 0.42, oy, 5.6)
        sx, sz = ends[1 - near]
        sy = H(sx, sz)
        o["skylight"] = {"x": r2(sx), "z": r2(sz), "y": r2(sy)}
        col.add_circle(sx, sz, 3.8, sy, 0.9)
        col.add_circle(sx, sz, 1.4, sy, 2.3)


# =====================================================================
# 4. 建物の飾り: 集合住宅のベランダ・店の看板と日よけ (旧 detail/shapes.js)
# =====================================================================
HOUSE_KINDS = {"house", "detached", "residential", "semidetached_house", "terrace"}
NOT_APT = {"commercial", "retail", "industrial", "school", "hospital", "office", "public", "train_station", "warehouse", "garage",
           "garages", "shed", "roof", "university", "kindergarten", "temple", "shrine", "church"}
SHOP = re.compile(r"^(shop:|amenity:(restaurant|cafe|fast_food|bar|pub|pharmacy|bank|clinic|dentist|ice_cream|hospital|public_building))")


def sign_colors(cat):
    """看板の [地の色, 文字の色, 帯と日よけの色]"""
    if "convenience" in cat:
        return ["#ffffff", "#1d6f3c", "#e8423a"]
    if re.search(r"restaurant|fast_food|pub|bar", cat):
        return ["#b3261e", "#ffffff", "#f2c14e"]
    if re.search(r"cafe|ice_cream", cat):
        return ["#2f4a3a", "#f4ead5", "#c9a66b"]
    if "bank" in cat:
        return ["#1e3a6e", "#ffffff", "#9fb7e0"]
    if "hospital" in cat:
        return ["#ffffff", "#1f64b5", "#2aa36b"]
    if "public_building" in cat:
        return ["#2b4a3a", "#ffffff", "#c8b27a"]
    if re.search(r"pharmacy|clinic|dentist", cat):
        return ["#ffffff", "#1f64b5", "#3fa34d"]
    return ["#3b3f46", "#ffffff", "#e0a43a"]


def js_signed_area(r):
    """city.js / shapes.js の signedArea (向きの符号がこちらの signed_area と逆)"""
    a, j = 0, len(r) - 1
    for i in range(len(r)):
        a += r[j][0] * r[i][1] - r[i][0] * r[j][1]
        j = i
    return a / 2


def build_shapes(city, world, cx, cz, R):
    inR = lambda x, z: (x - cx) ** 2 + (z - cz) ** 2 <= R * R

    # ---------- 集合住宅のベランダ (南寄りの長い壁。balcony=all なら全ての長い壁) ----------
    # 1 つの壁ごと: 壁の始点 (x, z)、壁の向き (dx, dz)、外向き (nx, nz)、壁の長さ len。
    # 2 階から最上階まで、床の高さ y + k * floorH (k = 1 から floors-1) に、奥行き 1.1m・手すり壁 1.1m のベランダ (両端 0.4m は空ける)
    balconies, apts = [], 0
    for b in city["buildings"]:
        if b.get("minH"):
            continue
        o = b["outer"]
        bx, bz = sum(p[0] for p in o) / len(o), sum(p[1] for p in o) / len(o)
        if not inR(bx, bz):
            continue
        sa = js_signed_area(o)
        area = abs(sa)
        kind = b.get("kind")
        is_house = kind in HOUSE_KINDS or (not kind and b["h"] < 9.5 and area < 180)
        if b.get("style"):
            is_apt = b["style"] == "apartment"
        else:
            is_apt = not is_house and not b.get("name") and kind not in NOT_APT and 7 <= b["h"] <= 45 and area < 1500
        if not is_apt:
            continue
        s = 1 if sa > 0 else -1
        floors = b.get("floors") or math.floor(b["h"] / 3.0)
        if floors < 2:
            continue
        fh = b["h"] / floors
        made = False
        for i in range(len(o)):
            a, c = o[i], o[(i + 1) % len(o)]
            dx, dz = c[0] - a[0], c[1] - a[1]
            L = math.hypot(dx, dz)
            if L < 7:
                continue
            nx, nz = dz / L * s, -dx / L * s
            if b.get("balcony") != "all" and nz < 0.55:
                continue
            balconies.append({"b": b["id"], "x": a[0], "z": a[1], "dx": round(dx / L, 4), "dz": round(dz / L, 4), "nx": round(nx, 4), "nz": round(nz, 4),
                              "len": r3(L), "y": b.get("y") or 0, "floorH": round(fh, 4), "floors": floors, **({"dark": True} if b.get("railing") else {})})
            made = True
        if made:
            apts += 1

    # ---------- 店の看板と日よけ (店の点にいちばん近い建物の、いちばん近い壁) ----------
    signs = []
    for p in city.get("pois") or []:
        if not SHOP.match(p["cat"]) or not inR(p["x"], p["z"]) or len(signs) >= 200:
            continue
        best = None
        for b in world.query(p["x"] - 20, p["z"] - 20, p["x"] + 20, p["z"] + 20):
            if b["minH"] > 0:
                continue
            d = world.closest_d(b, p["x"], p["z"])
            if d < 20 and (best is None or d < best[0]):
                best = (d, b)
        if not best:
            continue
        b = best[1]
        ring = b["rings"][0]
        s = 1 if js_signed_area(ring) > 0 else -1
        e = None
        for i in range(len(ring)):
            a, c = ring[i], ring[(i + 1) % len(ring)]
            L = math.hypot(c[0] - a[0], c[1] - a[1])
            if L < 3:
                continue
            mx, mz = (a[0] + c[0]) / 2, (a[1] + c[1]) / 2
            d = math.hypot(mx - p["x"], mz - p["z"])
            if e is None or d < e[0]:
                e = (d, a, c, L)
        if not e:
            continue
        _, a, c, L = e
        ux, uz = (c[0] - a[0]) / L, (c[1] - a[1]) / L
        nx, nz = uz * s, -ux * s
        # (x, z) = 壁の中点、y = 建物の基準の高さ、正面 (yaw) = 壁の外向き。看板は y + 3.35、日よけは y + 2.6
        signs.append({"b": b["id"], "x": r2((a[0] + c[0]) / 2), "z": r2((a[1] + c[1]) / 2), "y": r2(b["base"]), "yaw": round(math.atan2(nx, nz), 4),
                      "w": r3(min(L - 0.6, 7)), "name": p.get("name") or "", "cat": p["cat"], "colors": sign_colors(p["cat"])})
    # ---------- ランドマークの大きな壁面看板 (tools/landmarks.py の look に sign があるもの) ----------
    # 外向きの方角 (東西南北) ごとに、いちばん長い壁の中央に 1 枚。(x, z) = 壁の中点、y = 看板の中心の高さ、正面 (yaw) = 壁の外向き
    big = []
    looks = city.get("looks") or {}
    main = {}  # 外観ごとに、いちばん広い建物 (本体) にだけ付ける
    for b in city["buildings"]:
        if b.get("look") and not b.get("part"):
            if b["look"] not in main or abs(js_signed_area(b["outer"])) > abs(js_signed_area(main[b["look"]]["outer"])):
                main[b["look"]] = b
    for b in main.values():
        sg = (looks.get(b.get("look")) or {}).get("sign")
        if not sg:
            continue
        L0 = looks[b["look"]]
        o = b["outer"]
        s = 1 if js_signed_area(o) > 0 else -1
        best = {}
        for i in range(len(o)):
            a, c = o[i], o[(i + 1) % len(o)]
            dx, dz = c[0] - a[0], c[1] - a[1]
            L = math.hypot(dx, dz)
            if L < sg.get("min_len", 25):
                continue
            nx, nz = dz / L * s, -dx / L * s
            q = ("e" if nx > 0 else "w") if abs(nx) > abs(nz) else ("s" if nz > 0 else "n")
            if q not in best or L > best[q][0]:
                best[q] = (L, a, c, nx, nz)
        for q in sorted(best):
            L, a, c, nx, nz = best[q]
            w = min(L * 0.5, sg.get("max_w", 24))
            big.append({"b": b["id"], "x": r2((a[0] + c[0]) / 2), "z": r2((a[1] + c[1]) / 2), "y": r2(L0["y0"] + sg["floor"] * L0["floor_h"]),
                        "yaw": round(math.atan2(nx, nz), 4), "w": r3(w), "h": r3(w * sg.get("ratio", 0.12)), "text": sg["text"], "bg": sg["bg"], "fg": sg["fg"], **({"mark": sg["mark"]} if sg.get("mark") else {})})
    print(f"balcony walls={len(balconies)} (apartments={apts}) shop signs={len(signs)} big signs={len(big)}")
    return {"balconies": balconies, "signs": signs, "bigSigns": big}


# =====================================================================
# 5. 木 (公園・森・草地に散布) (旧 city.js の buildTrees)
# =====================================================================
def build_trees(city, world, H, col):
    density = {"wood": 1 / 60, "park": 1 / 220, "grass": 1 / 400}
    B = city["bounds"]
    trees = []
    for a in city["areas"]:
        d = density.get(a["kind"])
        if not d:
            continue
        o = a["outer"]
        minx, maxx = min(p[0] for p in o), max(p[0] for p in o)
        minz, maxz = min(p[1] for p in o), max(p[1] for p in o)
        rnd = hash_rng("tree" + js_join(o[0]))
        n = min(800, math.floor(abs(js_signed_area(o)) * d))
        i = 0
        while i < n * 2 and len(trees) < 5000:
            i += 1
            x = minx + rnd() * (maxx - minx)
            z = minz + rnd() * (maxz - minz)
            if x < B["minX"] or x > B["maxX"] or z < B["minZ"] or z > B["maxZ"]:
                continue
            if not pip(x, z, o) or any(pip(x, z, h) for h in a.get("holes") or []):
                continue
            if any(world.contains(b, x, z) for b in world.query(x, z, x, z)):
                continue
            sc = 0.7 + rnd() * 0.7
            r = rnd()
            y = H(x, z)
            # [x, z, y, 大きさの倍率, 0〜1 の乱数 (向き = r * 6.28、葉の色の濃さ)]。基準の木: 幹の高さ 2.2m、葉は高さ 3.2m を中心に半径 1.7m
            trees.append([r2(x), r2(z), r2(y), r3(sc), r3(r)])
            col.tree.append([r2(x), r2(z), r3(0.25 * sc), r2(y), r2(y + 4.9 * sc)])
    print(f"trees={len(trees)}")
    return trees


# =====================================================================
# =====================================================================
# 5. 駅と線路: ホーム・ホームの屋根と柱・架線柱・架線
# =====================================================================
PLAT_H = 1.1        # レール面 (地面) からホーム上面まで
CANOPY_H = 3.6      # ホーム上面から屋根の下面まで
CANOPY_END = 8.0    # ホームの両端で屋根を付けない長さ
WIRE_H = 5.0        # 地面から架線まで
MAST_H = 7.0        # 架線柱の高さ
GANTRY_STEP = 50.0  # 架線柱の間隔


def _resample(chain, n):
    """折れ線を、長さで等分した n 点に取り直す"""
    acc = [0.0]
    for a, b in zip(chain, chain[1:]):
        acc.append(acc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    out, j = [], 0
    for k in range(n):
        d = acc[-1] * k / (n - 1)
        while j < len(chain) - 2 and acc[j + 1] < d:
            j += 1
        seg = acc[j + 1] - acc[j]
        t = (d - acc[j]) / seg if seg > 0 else 0
        out.append((chain[j][0] + (chain[j + 1][0] - chain[j][0]) * t, chain[j][1] + (chain[j + 1][1] - chain[j][1]) * t))
    return out, acc[-1]


def build_rail(city, world, H, col):
    """ホーム (areas の platform) は細長い多角形。いちばん離れた 2 頂点を両端として、左右の縁を約 4 m ごとの点列に取り直す。
    platforms: left / right = 両縁の点 [x, z]、y = 各点のホーム上面の高さ
    canopies:  同じ形で、y = 屋根の下面の高さ (屋根の厚さ・形は描画側)
    columns:   屋根の柱 [x, z, 下端 y, 上端 y]
    gantries:  架線柱 (門形) [中心 x, 中心 z, 地面 y, 線路に直角な向き dx, dz, 半幅]。柱は中心 ± 半幅、高さ MAST_H
    catenary:  架線の線分 [ax, ay, az, bx, by, bz]"""
    def in_building(x, z, ground_only=False):
        return any(World.contains(b, x, z) and not (ground_only and b["minH"] > 0) for b in world.query(x, z, x, z))

    platforms, canopies, columns = [], [], []
    plat_rings = []
    for a in city.get("areas") or []:
        if a["kind"] != "platform":
            continue
        o = a["outer"]
        plat_rings.append(o)
        n = len(o)
        i0, j0 = max(((i, j) for i in range(n) for j in range(i + 1, n)), key=lambda ij: math.hypot(o[ij[0]][0] - o[ij[1]][0], o[ij[0]][1] - o[ij[1]][1]))
        ca = o[i0:j0 + 1]
        cb = (o[j0:] + o[:i0 + 1])[::-1]
        length = math.hypot(o[i0][0] - o[j0][0], o[i0][1] - o[j0][1])
        m = max(2, math.ceil(length / 4) + 1)
        L, _ = _resample(ca, m)
        R, _ = _resample(cb, m)
        # 高さ: 中心線の地面 + PLAT_H。川をまたぐ所など地面が大きく下がる所は全体の中央値で置き換え、前後 7 点でならす
        hs = [H((l[0] + r[0]) / 2, (l[1] + r[1]) / 2) for l, r in zip(L, R)]
        med = sorted(hs)[len(hs) // 2]
        hs = [h if abs(h - med) < 1.0 else med for h in hs]
        ys = [sum(hs[max(0, k - 3):k + 4]) / len(hs[max(0, k - 3):k + 4]) + PLAT_H for k in range(m)]
        platforms.append({"left": [[r2(x), r2(z)] for x, z in L], "right": [[r2(x), r2(z)] for x, z in R], "y": [r2(y) for y in ys]})
        ring = [[r2(x), r2(z), r2(y - PLAT_H)] for (x, z), y in zip(L, ys)] + [[r2(x), r2(z), r2(y - PLAT_H)] for (x, z), y in list(zip(R, ys))[::-1]]
        col.add_line(ring + [ring[0]], 0.1, PLAT_H)
        # 屋根: 両端 CANOPY_END を除き、幅が 3 m 以上ある範囲。縁から少し内側
        step = length / (m - 1)
        ks = [k for k in range(m) if CANOPY_END <= k * step <= length - CANOPY_END and math.hypot(L[k][0] - R[k][0], L[k][1] - R[k][1]) >= 3]
        if len(ks) >= 2:
            k0, k1 = ks[0], ks[-1]
            inset = lambda p, q: (p[0] + (q[0] - p[0]) * 0.04, p[1] + (q[1] - p[1]) * 0.04)
            canopies.append({"left": [[r2(v) for v in inset(L[k], R[k])] for k in range(k0, k1 + 1)],
                             "right": [[r2(v) for v in inset(R[k], L[k])] for k in range(k0, k1 + 1)],
                             "y": [r2(ys[k] + CANOPY_H) for k in range(k0, k1 + 1)]})
            for k in range(k0 + 1, k1, 2):  # 柱は約 8 m ごと。広いホームは 2 本
                w = math.hypot(L[k][0] - R[k][0], L[k][1] - R[k][1])
                for t in ((0.3, 0.7) if w > 7 else (0.5,)):
                    x, z = L[k][0] + (R[k][0] - L[k][0]) * t, L[k][1] + (R[k][1] - L[k][1]) * t
                    columns.append([r2(x), r2(z), r2(ys[k]), r2(ys[k] + CANOPY_H)])

    def in_platform(x, z):
        return any(pip(x, z, r) for r in plat_rings)

    # 架線: 線路の真上。橋 (ys) はその高さ、ほかは地面から
    rails = city.get("rails") or []
    catenary = []
    for r in rails:
        pts, ys = r["pts"], r.get("ys")
        prev = None
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            d = math.hypot(b[0] - a[0], b[1] - a[1])
            n = max(1, math.ceil(d / 12))
            for k in range(n + (1 if i == len(pts) - 2 else 0)):
                t = k / n
                x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                y = (ys[i] + (ys[i + 1] - ys[i]) * t if ys else H(x, z)) + WIRE_H
                cur = [r2(x), r2(y), r2(z)]
                if prev:
                    catenary.append(prev + cur)
                prev = cur

    # 架線柱: 各線路を GANTRY_STEP ごとに歩き、直角な線が横切る線路をまとめて 1 つの門形にする (近くに既にあれば作らない)
    segs = [(r["pts"][i], r["pts"][i + 1]) for r in rails if not r.get("ys") for i in range(len(r["pts"]) - 1)]
    gantries, placed = [], PointGrid(40)

    def gantry_at(x, z, dx, dz):
        nx, nz = -dz, dx
        ts = [0.0]
        for a, b in segs:
            ex, ez = b[0] - a[0], b[1] - a[1]
            den = nx * ez - nz * ex
            if abs(den) < 1e-9:
                continue
            t = ((a[0] - x) * ez - (a[1] - z) * ex) / den
            u = ((a[0] - x) * nz - (a[1] - z) * nx) / den
            if 0 <= u <= 1 and abs(t) < 45:
                ts.append(t)
        ts.sort()
        i = ts.index(0.0)
        lo = hi = i
        while lo > 0 and ts[lo] - ts[lo - 1] < 9:
            lo -= 1
        while hi < len(ts) - 1 and ts[hi + 1] - ts[hi] < 9:
            hi += 1
        t0, t1 = ts[lo] - 2.3, ts[hi] + 2.3
        cx, cz, half = x + nx * (t0 + t1) / 2, z + nz * (t0 + t1) / 2, (t1 - t0) / 2
        if placed.near(cx, cz, 34):
            return
        n = max(2, math.ceil(half * 2 / 2))
        for k in range(n + 1):  # 門の下にホーム・建物があれば作らない
            t = -half + 2 * half * k / n
            px, pz = cx + nx * t, cz + nz * t
            if in_platform(px, pz) or in_building(px, pz):
                return
        y = min(H(cx - nx * half, cz - nz * half), H(cx + nx * half, cz + nz * half))
        if abs(y - H(cx, cz)) > 2.5:  # 斜面・川岸
            return
        placed.add(cx, cz)
        gantries.append([r2(cx), r2(cz), r2(y), round(nx, 4), round(nz, 4), r2(half)])
        for sgn in (-1, 1):
            col.add_circle(cx + nx * half * sgn, cz + nz * half * sgn, 0.2, y, MAST_H)

    for r in rails:
        if r.get("ys"):
            continue
        state = {"next": GANTRY_STEP / 2, "run": 0.0}
        for a, b in zip(r["pts"], r["pts"][1:]):
            d = math.hypot(b[0] - a[0], b[1] - a[1])
            if d <= 0:
                continue
            dx, dz = (b[0] - a[0]) / d, (b[1] - a[1]) / d
            while state["next"] <= state["run"] + d:
                t = state["next"] - state["run"]
                gantry_at(a[0] + dx * t, a[1] + dz * t, dx, dz)
                state["next"] += GANTRY_STEP
            state["run"] += d
    print(f"platforms={len(platforms)} canopies={len(canopies)} columns={len(columns)} gantries={len(gantries)} catenary segs={len(catenary)}")
    return {"platforms": platforms, "canopies": canopies, "columns": columns, "gantries": gantries, "catenary": catenary,
            "dims": {"platH": PLAT_H, "mastH": MAST_H}}


# 5b. 歩道橋・デッキ・階段・スロープの手すり
# =====================================================================
WALK_PED = {"footway", "pedestrian", "path", "cycleway", "steps", "corridor"}
RAIL_H = 1.1        # デッキの高欄の高さ
HANDRAIL_H = 0.9    # 階段の手すりの高さ (段の先を結んだ線から)
STEEP = 0.22        # これより急な区間は階段として作る (stairs.js と同じ値)


def build_walk(city, world, H, col):
    """手すりを置く線 (rails) を作る。1 本 = {"k": 種類, "p": [[x, y, z], ...]} で、p は路面の縁の線 (y = 路面の高さ)。
    k: "deck" = デッキ・歩道橋の高欄 / "stair" = デッキへ上がる階段・急な坂の手すり / "ground" = 地面の階段の手すり
    - 路面の両縁に沿って置く。ほかの通路がつながる所 (同じ高さの路面の中)・建物に入る所・地面すれすれの所には置かない
    - どこにもつながらず宙で終わる端は、端をふさぐ
    - 幅 4 m 以上の階段は中央にも 1 本"""
    ways = []
    degree = {}
    nkey = lambda q: (round(q[0], 1), round(q[1], 1))
    for r in city["roads"]:
        for q in r["pts"]:
            degree[nkey(q)] = degree.get(nkey(q), 0) + 1
    for r in city["roads"]:
        if r["kind"] not in WALK_PED:
            continue
        if r.get("ys"):
            ways.append({"pts": r["pts"], "ys": [y + 0.05 for y in r["ys"]], "hw": (r.get("w") or 3) / 2, "ground": False, "steps": r["kind"] == "steps"})
        elif r["kind"] == "steps":
            ways.append({"pts": r["pts"], "ys": [H(q[0], q[1]) + 0.12 for q in r["pts"]], "hw": (r.get("w") or 2.5) / 2, "ground": True, "steps": True})
    segs, grid = [], {}
    for wi, w in enumerate(ways):
        for i in range(len(w["pts"]) - 1):
            a, b = w["pts"][i], w["pts"][i + 1]
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            if L < 0.05:
                continue
            s = {"w": wi, "i": i, "a": a, "b": b, "ya": w["ys"][i], "yb": w["ys"][i + 1], "L": L, "hw": w["hw"],
                 "ux": (b[0] - a[0]) / L, "uz": (b[1] - a[1]) / L, "ground": w["ground"]}
            s["grade"] = abs(s["yb"] - s["ya"]) / L
            m = w["hw"] + 0.5
            for gx in range(int((min(a[0], b[0]) - m) // 10), int((max(a[0], b[0]) + m) // 10) + 1):
                for gz in range(int((min(a[1], b[1]) - m) // 10), int((max(a[1], b[1]) + m) // 10) + 1):
                    grid.setdefault((gx, gz), []).append(len(segs))
            segs.append(s)

    def covered(x, z, y, me):
        """(x, z, y) が、ほかの区間の路面の中か (= 通路がつながっている所)"""
        for k in grid.get((int(x // 10), int(z // 10)), ()):
            if k == me:
                continue
            s = segs[k]
            t = ((x - s["a"][0]) * s["ux"] + (z - s["a"][1]) * s["uz"]) / s["L"]
            tc = max(0.0, min(1.0, t))
            d = math.hypot(x - s["a"][0] - s["ux"] * s["L"] * tc, z - s["a"][1] - s["uz"] * s["L"] * tc)
            if d < s["hw"] - 0.08 and abs(s["ya"] + (s["yb"] - s["ya"]) * tc - y) < 0.8:
                return True
        return False

    def in_building(x, z, y):
        for b in world.query(x, z, x, z):
            if b["topY"] > y + 0.5 and b["minY"] < y + 1.5 and world.contains(b, x, z):
                return True
        return False

    rails = []
    n_len = 0.0

    def emit(kind, pts):
        nonlocal n_len
        if len(pts) < 2:
            return
        L = sum(math.hypot(q[0] - p[0], q[2] - p[2]) for p, q in zip(pts, pts[1:]))
        if L < 0.6:
            return
        n_len += L
        rails.append({"k": kind, "p": [[r2(q[0]), r2(q[1]), r2(q[2])] for q in pts]})
        col.add_line([[r2(q[0]), r2(q[2]), r2(q[1])] for q in pts], 0.05, RAIL_H if kind == "deck" else HANDRAIL_H)

    kind_of = lambda s: "ground" if s["ground"] else "stair" if s["grade"] > STEEP else "deck"
    for wi, w in enumerate(ways):
        mine = [k for k, s in enumerate(segs) if s["w"] == wi]
        offsets = [1, -1] + ([0] if w["steps"] and w["hw"] >= 2.0 else [])
        for side in offsets:
            cur, cur_kind = [], None   # つながっている途中の線
            for k in mine:
                s = segs[k]
                off = side * (s["hw"] - 0.06)
                nx, nz = -s["uz"] * off, s["ux"] * off
                n = max(1, int(math.ceil(s["L"] / 0.5)))
                kd = kind_of(s)
                run = None
                for j in range(n + 1):
                    t = j / n
                    x, z = s["a"][0] + s["ux"] * s["L"] * t + nx, s["a"][1] + s["uz"] * s["L"] * t + nz
                    y = s["ya"] + (s["yb"] - s["ya"]) * t
                    ok = not covered(x, z, y, k) and not in_building(x, z, y)
                    if ok and not s["ground"] and y - H(x, z) < 0.45:
                        ok = False  # 地面すれすれ (たもと) には置かない
                    if ok and side == 0 and s["grade"] <= 0.1:
                        ok = False  # 中央の手すりは段のある所だけ
                    if ok:
                        if run is None:
                            run = [[x, y, z], [x, y, z]]
                            # 前の区間の線が終点まで届いていて、種類が同じなら続ける (角の外側をつなぐ)
                            if j == 0 and cur and cur_kind == kd and math.hypot(cur[-1][0] - x, cur[-1][2] - z) < 2 * s["hw"] + 0.5:
                                run = cur + [[x, y, z], [x, y, z]]
                            elif cur:
                                emit(cur_kind, cur)
                            cur = []
                        run[-1] = [x, y, z]
                    elif run is not None:
                        emit(kd, run)
                        run = None
                if run is not None:
                    cur, cur_kind = run, kd   # 終点まで届いた。次の区間へ続くかもしれない
                elif cur:
                    emit(cur_kind, cur); cur = []
            if cur:
                emit(cur_kind, cur)
        # 宙で終わる端をふさぐ
        if not w["ground"] and mine:
            for k, end in ((mine[0], 0), (mine[-1], 1)):
                s = segs[k]
                q = s["b"] if end else s["a"]
                y = s["yb"] if end else s["ya"]
                if degree[nkey(q)] > 1 or y - H(q[0], q[1]) < 0.6 or in_building(q[0], q[1], y) or covered(q[0], q[1], y, k):
                    continue
                o = s["hw"] - 0.06
                emit("deck", [[q[0] - s["uz"] * o, y, q[1] + s["ux"] * o], [q[0] + s["uz"] * o, y, q[1] - s["ux"] * o]])
    print(f"walkway rails={len(rails)} ({n_len:.0f} m)")
    return {"rails": rails, "dims": {"railH": RAIL_H, "handrailH": HANDRAIL_H}}


# 6. 点群から読んだ木と駐車場 (data/lots.json。tools/lidar_cover.py が作る)
# =====================================================================
def build_lidar_trees(lots, world, H, col):
    """木: 点群で周りより高かった所に、その高さの木を置く。建物に近い木は、葉が壁に入らない大きさに縮める"""
    trees = []
    for x, z, h in lots["trees"]:
        near = world.query(x - 5, z - 5, x + 5, z + 5)
        if any(world.contains(b, x, z) for b in near):
            continue
        sc = min(2.6, max(0.6, h / 4.9))                      # 基準の木の高さは 4.9 m
        d = min([world.closest_d(b, x, z) for b in near], default=9.0)
        sc = max(0.5, min(sc, (d + 0.6) / 1.7))               # 葉の半径 1.7 m × 倍率
        r = hash_rng(f"lt{x},{z}")()
        y = H(x, z)
        trees.append([r2(x), r2(z), r2(y), r3(sc), r3(r)])
        col.tree.append([r2(x), r2(z), r3(0.25 * sc), r2(y), r2(y + 4.9 * sc)])
    print(f"trees (lidar)={len(trees)}")
    return trees


STALL_W, STALL_D, AISLE = 2.5, 5.0, 6.0   # 駐車ますの幅・奥行き、車路の幅 (m)
CAR_COLORS = ["#f4f4f2", "#f4f4f2", "#c9ccd0", "#c9ccd0", "#2b2d31", "#2b2d31", "#6f7378", "#1f3a6b", "#8a1f24", "#b9a98a"]


def build_parking(lots, city, world, H, col, paint):
    """広い舗装のうち、車が写っていた所と OSM の駐車場に、駐車ますの白線を引く。車は点群に写っていたますに置く。
    ますの並びは、舗装のかたまりを囲む一番小さい長方形の長い辺に沿わせる (向きは推定)"""
    cars, n_lots = [], 0
    osm = [a for a in city["areas"] if a["kind"] == "parking"]
    sites = lots.get("sites") or []
    for lot in lots["parking"]:
        cells = {(x, z) for z, x0, x1 in lot["rows"] for x in range(x0, x1)}
        mx = sum(x for x, _ in cells) / len(cells) + 0.5
        mz = sum(z for _, z in cells) / len(cells) + 0.5
        if any(pip(mx, mz, s["outer"]) for s in sites):   # 造成地の中の舗装 (写っているのは工事の車) には引かない
            continue
        seen = lot["cars"]
        if not ((len(seen) >= 4 and len(seen) * 350 >= lot["area"]) or any(pip(mx, mz, a["outer"]) for a in osm)):
            continue
        n_lots += 1
        inside = lambda x, z: (math.floor(x), math.floor(z)) in cells
        a = lot["angle"]
        ux, uz = math.cos(a), math.sin(a)
        us = [(x + 0.5) * ux + (z + 0.5) * uz for x, z in cells]
        vs = [-(x + 0.5) * uz + (z + 0.5) * ux for x, z in cells]
        if max(us) - min(us) < max(vs) - min(vs):   # 車路は長い辺に沿わせる
            ux, uz = -uz, ux
            us, vs = vs, [-u for u in us]
        vx, vz = -uz, ux
        u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
        rnd = hash_rng(f"lot{lot['rows'][0][0]},{lot['rows'][0][1]}")
        lines = set()
        # 奥行き方向: [ます][車路][ます] のくり返し (ますは背中合わせ)
        nrow = 0
        v = v0 + 0.5
        while v + STALL_D <= v1:
            side = nrow % 2                        # 0 = 車路が +v 側, 1 = 車路が -v 側
            k, u = 0, u0 + 0.5
            while u + STALL_W <= u1:
                cu, cv = u + STALL_W / 2, v + STALL_D / 2
                P = lambda du, dv: (ux * (cu + du) + vx * (cv + dv), uz * (cu + du) + vz * (cv + dv))
                if all(inside(*P(du, dv)) for du, dv in ((0, 0), (-1.1, -2.3), (1.1, -2.3), (-1.1, 2.3), (1.1, 2.3))):
                    lines.add((nrow, k))
                    lines.add((nrow, k + 1))
                    x, z = P(0, 0)
                    if any((cx - x) ** 2 + (cz - z) ** 2 < 1.9 ** 2 for cx, cz in seen):
                        nose = (1 if side == 0 else -1) * (1 if rnd() < 0.7 else -1)   # 7 割は頭を車路と反対に向ける (前向き駐車)
                        dx, dz = -vx * nose, -vz * nose
                        j = (rnd() - 0.5) * 0.3
                        x, z = x + ux * j, z + uz * j
                        y = H(x, z)
                        yaw = math.atan2(dx, dz)
                        cars.append({"x": r2(x), "z": r2(z), "y": r2(y), "yaw": r3(yaw), "c": CAR_COLORS[int(rnd() * len(CAR_COLORS))]})
                        col.add_box(x, z, yaw, 0.88, 2.15, y, 1.45)
                k += 1
                u += STALL_W
            for row, kk in sorted(l for l in lines if l[0] == nrow):
                lu = u0 + 0.5 + kk * STALL_W
                cv = v + STALL_D / 2
                paint.append([r2(ux * lu + vx * cv), r2(uz * lu + vz * cv), r3(vx), r3(vz), STALL_D, 0.12])
            nrow += 1
            v += STALL_D if side == 1 else STALL_D + AISLE
    print(f"parking lots={n_lots} / {len(lots['parking'])} cars={len(cars)}")
    return cars


# =====================================================================
# 7. 敷地の外周の柵と、墓地の墓石 (OSM のエリア: 工業用地・学校・墓地。点群から読んだ造成地: 工事の仮囲い)
# =====================================================================
# 種類 → (色, 高さ m)。construction (仮囲い) は金網ではなく白い板
FENCES = {"industrial": ("#8f969b", 1.8), "school": ("#5f8468", 1.5), "cemetery": ("#9a968c", 1.2), "construction": ("#e9e8e2", 2.0)}
FENCE_STEP = 2.4


def build_area_extras(city, world, H, col, sites=()):
    B = city["bounds"]
    # 道路の上かどうか (中心線から幅の半分 + 余白以内、または PLATEAU の道路面の中)
    cell, sg, ag = 20, {}, {}
    for r in city["roads"]:
        hw = r.get("w", 4) / 2 + 1.5
        for (ax, az), (bx, bz) in zip(r["pts"], r["pts"][1:]):
            for i in range(math.floor((min(ax, bx) - hw) / cell), math.floor((max(ax, bx) + hw) / cell) + 1):
                for j in range(math.floor((min(az, bz) - hw) / cell), math.floor((max(az, bz) + hw) / cell) + 1):
                    sg.setdefault((i, j), []).append((ax, az, bx, bz, hw))
    for a in city.get("roadAreas") or []:
        xs, zs = [p[0] for p in a["outer"]], [p[1] for p in a["outer"]]
        for i in range(math.floor(min(xs) / cell), math.floor(max(xs) / cell) + 1):
            for j in range(math.floor(min(zs) / cell), math.floor(max(zs) / cell) + 1):
                ag.setdefault((i, j), []).append((min(xs), max(xs), min(zs), max(zs), a))

    def on_road(x, z):
        k = (math.floor(x / cell), math.floor(z / cell))
        for ax, az, bx, bz, hw in sg.get(k, ()):
            ex, ez = bx - ax, bz - az
            l2 = ex * ex + ez * ez
            t = max(0, min(1, ((x - ax) * ex + (z - az) * ez) / l2)) if l2 > 0 else 0
            if (x - ax - ex * t) ** 2 + (z - az - ez * t) ** 2 < hw * hw:
                return True
        for x0, x1, z0, z1, a in ag.get(k, ()):
            if x0 <= x <= x1 and z0 <= z <= z1 and pip(x, z, a["outer"]) and not any(pip(x, z, h) for h in a.get("holes") or []):
                return True
        return False

    def blocked(x, z):
        if x < B["minX"] or x > B["maxX"] or z < B["minZ"] or z > B["maxZ"] or on_road(x, z):
            return True
        return any(world.contains(b, x, z) or world.closest_d(b, x, z) < 0.8 for b in world.query(x - 0.8, z - 0.8, x + 0.8, z + 0.8))

    fences, graves = [], []
    for a in list(city["areas"]) + list(sites):
        f = FENCES.get(a["kind"])
        if not f:
            continue
        ring = a["outer"]
        sgn = 1 if signed_area(ring) > 0 else -1
        posts = []   # 外周を一定間隔で歩いた点。道路や建物に当たる所は内側へずらし、ずらしても当たる所 (門・出入口) は空ける
        for i in range(len(ring)):
            p, q = ring[i], ring[(i + 1) % len(ring)]
            L = math.hypot(q[0] - p[0], q[1] - p[1])
            if L < 0.5:
                continue
            dx, dz = (q[0] - p[0]) / L, (q[1] - p[1]) / L
            nx, nz = -dz * sgn, dx * sgn            # 内向き
            n = max(1, round(L / FENCE_STEP))
            for k in range(n):
                x, z = p[0] + dx * L * k / n, p[1] + dz * L * k / n
                for off in (0, 1, 2, 3, 4, 5, 6, 8, 10):
                    xx, zz = x + nx * off, z + nz * off
                    if not blocked(xx, zz) and (off == 0 or pip(xx, zz, ring)):   # 輪郭の線上 (off = 0) は内外の判定が不安定なので見ない
                        posts.append((xx, zz))
                        break
                else:
                    posts.append(None)
        out_posts, panels = [], []
        for i, p in enumerate(posts):
            if not p:
                continue
            out_posts.append([r2(p[0]), r2(p[1]), r2(H(p[0], p[1]))])
            q = posts[(i + 1) % len(posts)]
            if not q:
                continue
            L = math.hypot(q[0] - p[0], q[1] - p[1])
            mx, mz = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
            if L < 0.3 or L > FENCE_STEP * 1.6 or blocked(mx, mz):
                continue
            yaw = math.atan2(q[0] - p[0], q[1] - p[1])
            y = min(H(p[0], p[1]), H(q[0], q[1]))
            panels.append([r2(mx), r2(mz), r2(y), r3(yaw), r2(L)])
            col.add_box(mx, mz, yaw, 0.05, L / 2, y, f[1])
        if panels:
            fences.append({"kind": a["kind"], "color": f[0], "h": f[1], "posts": out_posts, "panels": panels})

        if a["kind"] == "cemetery":
            # 墓石: 一番長い辺の向きに 2 m × 3 m 間隔で並べる
            e = max(range(len(ring)), key=lambda i: math.hypot(ring[(i + 1) % len(ring)][0] - ring[i][0], ring[(i + 1) % len(ring)][1] - ring[i][1]))
            p, q = ring[e], ring[(e + 1) % len(ring)]
            L = math.hypot(q[0] - p[0], q[1] - p[1])
            ux, uz = (q[0] - p[0]) / L, (q[1] - p[1]) / L
            us = [x * ux + z * uz for x, z in ring]
            vs = [-x * uz + z * ux for x, z in ring]
            yaw = math.atan2(-uz, ux)
            v = min(vs) + 1.5
            while v < max(vs) - 1:
                u = min(us) + 1.5
                while u < max(us) - 1:
                    x, z = ux * u - uz * v, uz * u + ux * v
                    ok = pip(x, z, ring) and not any(pip(x, z, h) for h in a.get("holes") or []) and not blocked(x, z)
                    if ok and all(not blocked(x + ox, z + oz) for ox, oz in ((1.2, 0), (-1.2, 0), (0, 1.2), (0, -1.2))):
                        y = H(x, z)
                        graves.append({"x": r2(x), "z": r2(z), "y": r2(y), "yaw": r3(yaw)})
                        col.add_circle(x, z, 0.4, y, 1.3)
                    u += 2.0
                v += 3.0
    print(f"area fences={len(fences)} panels={sum(len(f['panels']) for f in fences)} graves={len(graves)}")
    return {"fences": fences, "graves": graves}


# =====================================================================
def build(city):
    H = load_terrain()
    world = World(city["buildings"])
    st = city.get("start") or {"x": 0, "z": 0}
    cx, cz = st["x"], st["z"]
    col = Colliders()
    street = build_street_props(city, world, H, cx, cz, RADIUS, col)
    sig = build_signals(city, world, H, cx, cz, RADIUS, col, street["paint"])
    sites = build_sites(city, world, H, col)
    shapes = build_shapes(city, world, cx, cz, RADIUS)
    lots = json.loads(LOTS.read_text(encoding="utf-8")) if LOTS.exists() else None
    # 木: 点群で見つけた位置があればそれを使う。無ければ公園・森・草地に散らす
    trees = build_lidar_trees(lots, world, H, col) if lots and lots.get("trees") else build_trees(city, world, H, col)
    cars = build_parking(lots, city, world, H, col, street["paint"]) if lots and lots.get("parking") else []
    rail = build_rail(city, world, H, col)
    walk = build_walk(city, world, H, col)
    print(f"colliders: circle={len(col.circle)} box={len(col.box)} line={len(col.line)}")
    return {
        "version": 1,
        "units": "meters; x=east, y=up, z=south; yaw: local +Z faces (sin yaw, cos yaw)",
        "generator": "tools/build_props.py",
        **street, **sig,
        "sites": sites,
        **shapes,
        "trees": trees,
        "rail": rail,
        "walk": walk,
        "cars": cars,
        **build_area_extras(city, world, H, col, (lots or {}).get("sites") or ()),
        "colliders": {"circle": col.circle, "box": col.box, "line": col.line, "tree": col.tree},
    }


def main():
    city = json.loads(CITY.read_text(encoding="utf-8"))
    out = build(city)
    DST.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"-> {DST} ({DST.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
