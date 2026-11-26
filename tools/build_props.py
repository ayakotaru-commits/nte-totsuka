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
APPEARANCE = ROOT / "data" / "appearance.json"
SMALL = ROOT / "data" / "small.json"  # 点群から読んだ塀・生け垣・物置と、室外機の位置 (tools/lidar_small.py が作る。無ければ使わない)

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


def rdp(pts, tol):
    """折れ線を、ずれ tol 以内で間引く (Douglas-Peucker)"""
    if len(pts) < 3:
        return list(pts)
    (ax, az), (bx, bz) = pts[0], pts[-1]
    dx, dz = bx - ax, bz - az
    L = math.hypot(dx, dz) or 1e-9
    i, dmax = 0, -1
    for k in range(1, len(pts) - 1):
        d = abs((pts[k][0] - ax) * dz - (pts[k][1] - az) * dx) / L
        if d > dmax:
            i, dmax = k, d
    if dmax <= tol:
        return [pts[0], pts[-1]]
    return rdp(pts[:i + 1], tol)[:-1] + rdp(pts[i:], tol)


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
            if g.get("clockhouse"):
                if abs(-dx * g["axis"][1] + dz * g["axis"][0]) < g["wide"] / 2 + 2.0 and -24 < dx * g["axis"][0] + dz * g["axis"][1] < g["length"] / 2 + 3:
                    return True
                continue
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
    fronts = frontage_sites(city)
    # 歩行者の道 (歩道・階段・小道) が車道に出る所は、ガードパイプを切る (以前は八坂神社の石段の下などをふさいでいた)。
    # 道の端の点のうち、車道の中心線から (道幅の半分 + 6 m) 以内にあるもの。そこから WALK_GAP m 以内には支柱を立てない
    WALK_GAP = 2.0
    walk_ends = []
    for wr in roads:
        if wr["kind"] in ("footway", "steps", "path", "pedestrian") and not wr.get("ys") and len(wr["pts"]) >= 2:
            for e, f2 in ((wr["pts"][0], wr["pts"][1]), (wr["pts"][-1], wr["pts"][-2])):
                L = math.hypot(e[0] - f2[0], e[1] - f2[1]) or 1
                walk_ends.append((e[0], e[1], (e[0] - f2[0]) / L, (e[1] - f2[1]) / L))   # 端の点と、端へ向かう向き

    def near_walk_end(x, z, dx, dz, r, side):
        """(x, z) = 車道の中心線の点、(dx, dz) = 車道の向き、side = 縁の側。その側の真横に、歩行者の道の端が出ているか"""
        lim = r["w"] / 2 + 6
        for ex, ez, ux, uz in walk_ends:
            if abs(ux * dx + uz * dz) > 0.75:   # 車道に沿って走る歩道 (区切りの端) は切らない。横から出てくる道だけ
                continue
            ax, az = ex - x, ez - z
            if abs(ax) > lim + WALK_GAP or abs(az) > lim + WALK_GAP:
                continue
            c = -ax * dz + az * dx   # 縁の側 (side) への距離
            if abs(ax * dx + az * dz) < WALK_GAP and 0 < c * side < lim:
                return True
        return False
    for r in roads:
        if r["kind"] not in MAJOR or r.get("ys"):
            continue
        for side in (1, -1):
            run = [None]

            def cb(x, z, dx, dz, r=r, side=side, run=run):
                go = edge(r, side) - r["sw"] + 0.2 if r.get("sw") else edge(r, side) + 0.2
                px, pz = x - dz * side * go, z + dx * side * go
                ok = (inR(px, pz) and not node_grid.near(x, z, r["w"] / 2 + 9) and clear(px, pz, 0.3) and not at_gate(px, pz)
                      and not any(near_ring(px, pz, f, 3.0) for f in fronts) and not near_walk_end(x, z, dx, dz, r, side))
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

    # ---------- マンホール (車道の中、約 25 m おき) ----------
    # [x, z, 種類]。0 = 下水 (直径 0.64 m の丸い鉄蓋)、1 = 水道・ガスの小さな蓋 (直径 0.4 m)。路面に沿わせて貼るのは描画側
    manholes = []
    mh_grid = PointGrid(8)
    for r in roads:
        if r["kind"] not in DRIVABLE or r.get("ys") or r["w"] < 3.5:
            continue
        rnd = hash_rng("mh" + js_join(r["pts"][0]))
        wc, c0 = carriage(r)

        def cb(x, z, dx, dz, r=r, rnd=rnd, wc=wc, c0=c0):
            lat = c0 + (rnd() - 0.5) * min(1.6, wc * 0.4)
            px, pz = x - dz * lat, z + dx * lat
            kind = 0 if rnd() < 0.7 else 1
            if not inR(px, pz) or mh_grid.near(px, pz, 6) or not clear(px, pz, 0.5) or node_grid.near(px, pz, 2.5):
                return
            mh_grid.add(px, pz)
            manholes.append([r2(px), r2(pz), kind])
        walk(r["pts"], 6 + rnd() * 18, 25, cb)

    # ---------- 側溝 (歩道の無い生活道路の両端。コンクリートの蓋とグレーチング) ----------
    # 道路の縁から内側 0.35 m の帯。ひと続きの帯ごとに点の列 [[x, z], ...] (中心線)。交差点・建物の前で切る
    gutters = []
    for r in roads:
        if r["kind"] not in ("residential", "unclassified", "living_street") or r.get("ys") or r.get("sw") or r["w"] < 3:
            continue
        for side in (1, -1):
            run = [None]

            def cb(x, z, dx, dz, r=r, side=side, run=run):
                go = edge(r, side) - 0.2
                px, pz = x - dz * side * go, z + dx * side * go
                ok = inR(px, pz) and not node_grid.near(x, z, r["w"] / 2 + 3.5) and clear(px, pz, 0.15) and not at_gate(px, pz)
                if not ok:
                    run[0] = None
                    return
                cur = run[0]
                if cur and math.hypot(cur[-1][0] - px, cur[-1][1] - pz) < 1.6:
                    cur.append((px, pz))
                else:
                    run[0] = [(px, pz)]
                    gutters.append(run[0])
            walk(r["pts"], 0.5, 1, cb)
    out_gutters = []
    for g in gutters:
        g = rdp(g, 0.04)
        if len(g) >= 2 and sum(math.hypot(g[i + 1][0] - g[i][0], g[i + 1][1] - g[i][1]) for i in range(len(g) - 1)) >= 3:
            out_gutters.append([[r2(x), r2(z)] for x, z in g])

    print(f"poles={len(poles)} wires={len(wires)} paint={len(paint)} tomare={len(tomare)} guard runs={len(guards)} posts={n_posts} vending={len(vending)} mirrors={len(mirrors)}")
    print(f"manholes={len(manholes)} gutter runs={len(out_gutters)} ({sum(len(g) for g in out_gutters)} pts)")
    return {"poles": out_poles, "wires": wires, "paint": paint, "tomare": tomare,
            "guardRails": out_guards, "vending": vending, "mirrors": mirrors, "manholes": manholes, "gutters": out_gutters}


def build_yard(small, world, H, col):
    """塀・生け垣・物置・室外機 (tools/lidar_small.py が点群から見つけた位置)。
    yardWalls: {"k": "block" | "hedge", "p": [[x, y, z], [x, y, z]], "h": 高さ}  y = 両端の地面の高さ
    sheds:     {x, y, z, yaw, "l": 長さ, "w": 奥行き, "h": 高さ, "c": 色の番号}  長さの向きが yaw の局所 X
    acUnits:   {x, y, z, yaw}  正面 (局所 +Z) が壁の外を向く"""
    walls, sheds, acs = [], [], []
    for x0, z0, x1, z1, h, k in small.get("walls") or []:
        mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
        if any(world.contains(b, mx, mz) for b in world.query(mx - 1, mz - 1, mx + 1, mz + 1)):
            continue
        a, b = [x0, H(x0, z0), z0], [x1, H(x1, z1), z1]
        walls.append({"k": k, "p": [[r2(v) for v in a], [r2(v) for v in b]], "h": r2(h)})
        col.add_line([[r2(x0), r2(z0), r2(a[1])], [r2(x1), r2(z1), r2(b[1])]], 0.08 if k == "block" else 0.3, r2(h))
    for x, z, yaw, L, W, h in small.get("sheds") or []:
        y = H(x, z)
        c = math.floor(hash_rng(f"shed{x},{z}")() * 4)
        sheds.append({"x": r2(x), "y": r2(y), "z": r2(z), "yaw": r3(yaw - math.pi / 2), "l": r2(L), "w": r2(W), "h": r2(h), "c": c})
        col.add_box(x, z, yaw - math.pi / 2, L / 2, W / 2, y, h)
    for x, z, yaw in small.get("ac") or []:
        y = H(x, z)
        acs.append({"x": r2(x), "y": r2(y), "z": r2(z), "yaw": r3(yaw)})
        col.add_box(x, z, yaw, 0.4, 0.15, y, 0.62)
    print(f"yard walls={len(walls)} sheds={len(sheds)} ac units={len(acs)}")
    return {"yardWalls": walls, "sheds": sheds, "acUnits": acs}


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
def seg_d(px, pz, a, b):
    """点と線分の距離"""
    dx, dz = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dz * dz
    u = 0 if l2 == 0 else max(0.0, min(1.0, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2))
    return math.hypot(px - a[0] - dx * u, pz - a[1] - dz * u)


def frontage_sites(city):
    """道路側にガードパイプを置かない敷地 (appearance の frontage.guard = false。グランシティ: 道路ぎわはレンガ色の歩道と植え込みだけ)"""
    return [s["outer"] for s in city.get("sites") or [] if (s.get("frontage") or {}).get("guard") is False]


def near_ring(px, pz, ring, d):
    return pip(px, pz, ring) or any(seg_d(px, pz, ring[i - 1], ring[i]) < d for i in range(len(ring)))


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
                    lay = g.get("layout")
                    if not lay:
                        strip(lo, hi, 3.0, True)
                        strip(loA, hiA, 2.4, False)
                    gy = H(cx, cz)
                    garden = {"lawn": g.get("lawn") or "#86a85e", "cell": C, "cells": [[r2(x), r2(z)] for x, z in cells],
                              "paths": paths, "ring": {"x": r2(cx), "z": r2(cz), "r0": 0, "r1": 6.5}}
                    if lay:
                        garden_layout(garden, lay, H, col, clear_of)
                    elif g.get("fountain"):
                        garden["fountain"] = {"x": r2(cx), "z": r2(cz), "y": r2(gy)}
                        col.add_circle(cx, cz, 2.8, gy, 0.5)
                        col.add_circle(cx, cz, 0.35, gy, 2.0)
                    if g.get("cypress") and not lay:
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
                if gt.get("clockhouse"):   # 車寄せの幅 (左右の塀の外側まで)・道路ぎわまで
                    return abs(ac) < gt["wide"] / 2 + 1.0 and -22 < al < gt["length"] / 2
                return abs(ac) < gt["passage"] / 2 + 0.8 and abs(al) < gt["length"] / 2 + 12
            ring, posts = site["outer"], []
            # frontage.fence = false: 車の通る道路に面した所には置かない (道路の端から 3 m 以内)
            front_roads = []
            if (site.get("frontage") or {}).get("fence") is False:
                front_roads = [r for r in city["roads"] if r["kind"] in DRIVABLE and r["kind"] != "service" and not r.get("ys")
                               and any(near_ring(x, z, ring, 30) for x, z in r["pts"][:: max(1, len(r["pts"]) // 40)] + [r["pts"][-1]])]

            def by_road(x, z):
                for r in front_roads:
                    p = r["pts"]
                    if any(seg_d(x, z, p[k - 1], p[k]) < r["w"] / 2 + 3.0 for k in range(1, len(p))):
                        return True
                return False
            for i in range(len(ring)):
                a, c = ring[i], ring[(i + 1) % len(ring)]
                L = math.hypot(c[0] - a[0], c[1] - a[1])
                t = 0
                while t <= L:
                    x, z = a[0] + (c[0] - a[0]) * t / L, a[1] + (c[1] - a[1]) * t / L
                    if not in_gateway(x, z) and clear_of(x, z, 1.0) and not by_road(x, z):
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


def garden_layout(garden, lay, H, col, clear_of):
    """中庭の配置を data/appearance.json の garden.layout から作る (航空写真で測った位置。グランシティ)。
    paths: [[x0, z0], [x1, z1], 幅]、circles: 石張りの円形の広場 {at, r, feature: fountain | obelisk}、
    panels: 白い縁の芝の区画 {at, len, wid, yaw (度。長い向き)}、hedges: 刈り込んだ生け垣 {from, to, wid, h}、planters: 丸い植え込み {at, r}"""
    paths = []
    for (x0, z0), (x1, z1), w in lay.get("paths", []):
        L = math.hypot(x1 - x0, z1 - z0)
        dx, dz = (x1 - x0) / L, (z1 - z0) / L
        n = max(1, round(L / 1.0))
        for i in range(n):   # 1 m ごとの板 (地形に沿わせるため)
            tm = (i + 0.5) * L / n
            paths.append([r2(x0 + dx * tm), r2(z0 + dz * tm), r3(dx), r3(dz), r3(L / n + 0.02), w, r3(tm / 2)])
    garden["paths"] = paths
    garden["rings"], garden["fountains"] = [], []
    for c in lay.get("circles", []):
        x, z = c["at"]
        y = H(x, z)
        garden["rings"].append({"x": x, "z": z, "r0": 0, "r1": c["r"], "stone": True})
        if c.get("feature") == "fountain":
            garden["fountains"].append({"x": x, "z": z, "y": r2(y)})
            col.add_circle(x, z, 2.8, y, 0.5)
            col.add_circle(x, z, 0.35, y, 2.0)
        elif c.get("feature") == "obelisk":
            garden["obelisk"] = {"x": x, "z": z, "y": r2(y)}
            col.add_box(x, z, 0, 0.7, 0.7, y, 0.8)
            col.add_circle(x, z, 0.42, y, 5.6)
    panels, trees = [], []
    for p in lay.get("panels", []):
        x, z = p["at"]
        yaw = math.radians(p.get("yaw", 0))
        ux, uz = math.cos(yaw), math.sin(yaw)
        y = H(x, z)
        panels.append({"x": x, "z": z, "y": r2(y), "len": p["len"], "wid": p["wid"], "dx": r3(ux), "dz": r3(uz)})
        for sl in (-1, 1):   # 区画の四隅に円すい形の木
            for sw in (-1, 1):
                tx = x + ux * sl * (p["len"] / 2 - 0.9) - uz * sw * (p["wid"] / 2 - 0.9)
                tz = z + uz * sl * (p["len"] / 2 - 0.9) + ux * sw * (p["wid"] / 2 - 0.9)
                ty = H(tx, tz)
                trees.append([r2(tx), r2(tz), r2(ty)])
                col.add_circle(tx, tz, 0.6, ty, 5.5)
    garden["panels"], garden["cypress"] = panels, trees
    hedges = []
    for hd in lay.get("hedges", []):
        (x0, z0), (x1, z1) = hd["from"], hd["to"]
        L = math.hypot(x1 - x0, z1 - z0)
        mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
        y = H(mx, mz)
        yaw = math.atan2(x1 - x0, z1 - z0)
        hedges.append({"x": r2(mx), "z": r2(mz), "y": r2(min(H(x0, z0), H(x1, z1))), "yaw": r3(yaw), "len": r2(L), "wid": hd["wid"], "h": hd["h"]})
        col.add_box(mx, mz, yaw, hd["wid"] / 2, L / 2, y, hd["h"])
    garden["hedges"] = hedges
    planters = []
    for pl in lay.get("planters", []):
        x, z = pl["at"]
        y = H(x, z)
        planters.append({"x": x, "z": z, "y": r2(y), "r": pl["r"]})
        col.add_circle(x, z, pl["r"], y, 0.9)
    garden["planters"] = planters


def road_clipped(city, gx, gz, dx, dz, nx, nz, LL, DD):
    """(gx, gz) から外向き (nx, nz) へ DD m、壁に沿う向き (dx, dz) へ ±LL/2 の長方形を、車の通る道路の端で切った凸多角形。
    点は [x, z, u, v] (u, v = 長方形の中の位置 0〜1)。舗装の板が道路に重なって、路面と同じ高さでちらつかないようにする"""
    poly = [[-LL / 2, 0.0], [LL / 2, 0.0], [LL / 2, DD], [-LL / 2, DD]]   # (t = 壁に沿う向き, d = 壁から外へ)
    W2 = lambda tt, d: (gx + dx * tt + nx * d, gz + dz * tt + nz * d)
    lx, lz = W2(0, DD / 2)
    for r in city["roads"]:
        if r["kind"] not in DRIVABLE or r.get("ys"):
            continue
        pts = r["pts"]
        for k in range(1, len(pts)):
            a, b = pts[k - 1], pts[k]
            if seg_d(lx, lz, a, b) > DD + LL:
                continue
            L2 = math.hypot(b[0] - a[0], b[1] - a[1])
            if L2 < 1e-6:
                continue
            ex, ez = -(b[1] - a[1]) / L2, (b[0] - a[0]) / L2   # 道路の線の横向き
            off = r["w"] / 2 + 0.2                             # 道路の端 (少し余裕)
            if seg_d(*W2(0, 0), a, b) < off:
                continue   # 起点が道路の中 (この線は使わない)
            side = 1 if (gx - a[0]) * ex + (gz - a[1]) * ez > 0 else -1   # 起点のある側
            u = ((lx - a[0]) * (b[0] - a[0]) + (lz - a[1]) * (b[1] - a[1])) / (L2 * L2)
            if u < -0.5 or u > 1.5:
                continue   # 線分の先 (道路の端の先) では切らない
            f = lambda q: side * ((W2(*q)[0] - a[0]) * ex + (W2(*q)[1] - a[1]) * ez) - off
            out = []
            for i in range(len(poly)):
                P0, P1 = poly[i - 1], poly[i]
                f0, f1 = f(P0), f(P1)
                if f1 >= 0:
                    if f0 < 0:
                        s = f0 / (f0 - f1)
                        out.append([P0[0] + (P1[0] - P0[0]) * s, P0[1] + (P1[1] - P0[1]) * s])
                    out.append(P1)
                elif f0 >= 0:
                    s = f0 / (f0 - f1)
                    out.append([P0[0] + (P1[0] - P0[0]) * s, P0[1] + (P1[1] - P0[1]) * s])
            poly = out
    return [[r2(W2(tt, d)[0]), r2(W2(tt, d)[1]), r3((tt + LL / 2) / LL), r3(1 - d / DD)] for tt, d in poly]


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
        if gt.get("clockhouse"):
            # 時計の棟 (tools/clockhouse.py): 4 面の外観・マンサード屋根・ドーマー・時計・庇・後ろの平屋は site_extras.js が作る。
            # (x, z) = 正面の壁の中央、yaw = 正面の外向き (道路の側)
            nn = math.hypot(ux, uz)
            road = faces[0]
            bk = gt.get("back") or {}
            o["hall"] = {"x": road["x"], "z": road["z"], "y": r2(gbase), "yaw": r3(math.atan2(-ux / nn, -uz / nn)), "width": gt["wide"],
                         "depth": gt["length"], "height": gt["h"], "roof_h": gt.get("roof_h", gt["h"] + 2.0), "roof_in": gt.get("roof_in", 1.2),
                         "back": {"depth": bk.get("depth", 0), "inset": bk.get("inset", 0.5), "h": bk.get("h", 4.4)},
                         "color": gt.get("color") or "#e9ddc1", "opening": {"w": gt["passage"], "h": gt["clear_h"], "doors": True}, "v": 2}
            ar = gt.get("arch")
            if ar:
                # 中庭の独立したアーチの門 (時計の棟の裏の噴水の先。中庭側の写真より)。s = 基準点から奥への距離
                vx, vz = ux / nn, uz / nn
                ax, az = gt["origin"][0] + vx * ar["s"], gt["origin"][1] + vz * ar["s"]
                ay = H(ax, az)
                o["arch"] = {"x": r2(ax), "z": r2(az), "y": r2(ay), "yaw": r3(math.atan2(vx, vz)), "w": ar["w"], "open": ar["open"], "h": ar["h"]}
                pw = (ar["w"] - ar["open"]) / 2
                for sg in (-1, 1):
                    off = sg * (ar["open"] + pw) / 2
                    col.add_box(ax - vz * off, az + vx * off, math.atan2(vx, vz), pw / 2, 0.5, ay, ar["h"])
        else:
            o["gate"] = {"width": gt["passage"], "clear_h": gt["clear_h"], "color": gt.get("color") or "#dcc6a0", "faces": faces}

    # ---------- 立体駐車場の入口 (道路側の壁の 1 階に黒い鉄の門、前にレンガ色の舗装と駐車ます 2 台分) ----------
    cp = site.get("carpark")
    if cp:
        (ax, az), (bx, bz) = cp["a"], cp["b"]
        L = math.hypot(bx - ax, bz - az)
        dx, dz = (bx - ax) / L, (bz - az) / L
        nx, nz = cp.get("out", [dz, -dx])   # 外向き (道路の側)
        gx, gz = ax + dx * cp["t"], az + dz * cp["t"]
        gy = H(gx, gz)
        lot = cp.get("lot") or {}
        LL, DD = lot.get("len", 12), lot.get("dep", 10)
        lx, lz = gx + nx * DD / 2, gz + nz * DD / 2
        # 舗装の形: 門の前の長方形を、車の通る道路の端で切る (道路に重なると、路面と同じ高さで描かれてちらつく)
        pts_out = road_clipped(city, gx, gz, dx, dz, nx, nz, LL, DD)
        o["carpark"] = {"x": r2(gx), "z": r2(gz), "y": r2(gy), "yaw": r3(math.atan2(nx, nz)), "w": cp["w"], "h": cp["h"],
                        "lot": {"x": r2(lx), "z": r2(lz), "y": r2(H(lx, lz)), "len": LL, "dep": DD, "stalls": lot.get("stalls", 2), "poly": pts_out}}

    # ---------- 噴水のある円形広場 ----------
    pz = site.get("plaza")
    if pz:
        y = H(*pz["at"])
        o["plaza"] = {"x": pz["at"][0], "z": pz["at"][1], "y": r2(y), "r": pz["r"]}
        col.add_circle(pz["at"][0], pz["at"][1], 1.35, y, 0.52)

    def make_court(hx, hz, yw, L, depth=9.0):
        # 正面の車寄せ (路上写真より: ピンクがかったレンガ色のタイル、丸い石の車止めが 1 列、右手前に白い彫像)。
        # (hx, hz) = 正面の中心、yw = 外向き (道路の側)、L = 正面の幅 (左右の塀の間)、depth = 道路側へののび
        fx, fz, tx, tz = math.sin(yw), math.cos(yw), math.cos(yw), -math.sin(yw)
        at = lambda t, d: (hx + tx * t + fx * d, hz + tz * t + fz * d)
        bol = []
        for k in range(6):
            bx, bz = at(-(L / 2 - 1.3) + k * (L - 2.6) / 5, depth - 2.2 + (0.3 if k > 3 else 0))
            by = H(bx, bz)
            bol.append([r2(bx), r2(bz), r2(by)])
            col.add_circle(bx, bz, 0.35, by, 0.6)
        sx, sz = at(L / 2 - 1.6, 2.4)
        cx, cz = at(0, depth / 2)
        o["court"] = {"x": r2(cx), "z": r2(cz), "y": r2(H(cx, cz)), "yaw": yw, "w": r3(L - 0.8), "d": depth, "bollards": bol,
                      "statue": {"x": r2(sx), "z": r2(sz), "y": r2(H(sx, sz))},
                      "poly": road_clipped(city, hx, hz, tx, tz, fx, fz, L - 0.8, depth)}   # 道路に重ならないよう切った形
        col.add_circle(sx, sz, 0.8, H(sx, sz), 2.0)

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
        make_court(o["hall"]["x"], o["hall"]["z"], o["hall"]["yaw"], L)
    elif site.get("gate", {}).get("clockhouse") and o.get("hall"):
        # 時計の棟: 車寄せは棟の正面 (道路側) に、道路ぎわまで置く
        make_court(o["hall"]["x"], o["hall"]["z"], o["hall"]["yaw"], o["hall"]["width"], depth=site["gate"].get("setback", 9.0))

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
        # 川側 (東向き) の長い壁の 1 階にも (柏尾川側の写真: 1 階の窓の上に青い日よけが並ぶ)
        for b in city["buildings"]:
            if b["id"] not in site["buildings"] or not b.get("railing"):
                continue
            ro, rn = b["outer"], len(b["outer"])
            rs = 1 if sum(ro[i][0] * ro[(i + 1) % rn][1] - ro[(i + 1) % rn][0] * ro[i][1] for i in range(rn)) > 0 else -1
            for i in range(rn):
                a, c = ro[i], ro[(i + 1) % rn]
                L = math.hypot(c[0] - a[0], c[1] - a[1])
                if L < 20:
                    continue
                ux, uz = (c[0] - a[0]) / L, (c[1] - a[1]) / L
                nx, nz = uz * rs, -ux * rs
                if nx < 0.7:
                    continue
                t = every / 2 + 1.0
                while t < L - 2:
                    aw.append({"x": r2(a[0] + ux * t + nx * 0.45), "z": r2(a[1] + uz * t + nz * 0.45), "y": r2((b.get("y") or 0) + 2.55),
                               "yaw": r3(math.atan2(nx, nz))})
                    t += every
        o["awnings"] = {"color": site["awnings"]["color"], "items": aw}

    # ---------- 庭: 花壇・オベリスク・丸い天窓 (配置の指定 garden.layout が無いとき) ----------
    if gi and not (site.get("garden") or {}).get("layout"):
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


# チェーン店の決まった配色 (店名から自動で付ける)。[地の色, 文字の色, 帯・日よけの色の並び]。ロゴは使わず、色と帯と店名の文字だけ。
# 確認 = 路上写真 (Mapillary) で見て合わせたもの。それ以外は一般的な配色の推定 (実物と少し違うことがある)
CHAINS = [
    ("seven", r"セブン[-ー‐ー]?イレブン|7-?ELEVEN", ["#ffffff", "#00843d", ["#f47b20", "#00843d", "#e5262d"]], "確認"),
    ("lawson", r"ローソン|LAWSON", ["#0072bc", "#ffffff", ["#ffffff", "#0072bc"]], "推定"),
    ("familymart", r"ファミリーマート|FamilyMart", ["#ffffff", "#0068b7", ["#00a040", "#0068b7"]], "推定"),
    ("mcdonalds", r"マクドナルド|McDonald", ["#db0007", "#ffc72c", ["#ffc72c", "#db0007"]], "確認"),
    ("starbucks", r"スターバックス|Starbucks", ["#00704a", "#ffffff", ["#1e3932", "#00704a"]], "推定"),
    ("yoshinoya", r"吉野家", ["#f08300", "#ffffff", ["#ffffff", "#f08300"]], "推定"),
    ("matsuya", r"松屋", ["#f26b00", "#ffffff", ["#ffffff", "#f26b00"]], "推定"),
    ("sukiya", r"すき家", ["#e60012", "#ffffff", ["#ffffff", "#e60012"]], "推定"),
    ("gusto", r"ガスト", ["#e8380d", "#ffffff", ["#f6b73c", "#e8380d"]], "推定"),
    ("saizeriya", r"サイゼリヤ", ["#00793a", "#ffffff", ["#d0021b", "#ffffff"]], "推定"),
    ("doutor", r"ドトール", ["#5a3520", "#ffffff", ["#c8102e", "#5a3520"]], "推定"),
    ("misterdonut", r"ミスタードーナツ|ミスド", ["#d6182f", "#ffffff", ["#f5a9b8", "#d6182f"]], "推定"),
    ("daiso", r"ダイソー|DAISO", ["#e4002b", "#ffffff", ["#ffffff", "#e4002b"]], "推定"),
    ("mufg", r"三菱UFJ銀行", ["#ffffff", "#d7000f", ["#d7000f", "#ffffff"]], "推定"),
    ("smbc", r"三井住友銀行", ["#ffffff", "#006e3b", ["#006e3b", "#ffffff"]], "推定"),
    ("resona", r"りそな銀行", ["#ffffff", "#00753a", ["#00753a", "#e60012"]], "推定"),
]


SHOPFRONTS = pathlib.Path(__file__).resolve().parent.parent / "data" / "shopfronts.json"
IZAKAYA_NOREN = "#23262b"   # 居酒屋 (pub・bar) で、写真で判定していない店の標準: 濃紺のれん + 赤ちょうちん (推定)


def load_shopfronts():
    """路上写真を見て付けた個人店の店先 (tools/shopfronts.py)。[{x, z, awning, noren, lantern, sign, unseen}]"""
    if not SHOPFRONTS.exists():
        return []
    return json.loads(SHOPFRONTS.read_text(encoding="utf-8"))["shops"]


def shopfront_of(labels, p):
    for r in labels:
        if math.hypot(r["x"] - p["x"], r["z"] - p["z"]) <= 3:
            return r
    return None


def shopfront_fields(p, is_chain, labels):
    """個人店の店先 (写真で判定した値。居酒屋は、判定が無ければ標準ののれんと提灯)。チェーン店は CHAINS が優先。
    日よけの色は colors[2] (帯と日よけの色)、看板は colors[0:2]。のれん・提灯は noren・lantern"""
    if is_chain:
        return {}
    r = shopfront_of(labels, p)
    out = {}
    if r and not r.get("unseen"):
        colors = list(sign_colors(p["cat"]))
        if r.get("sign"):
            colors = [r["sign"][0], r["sign"][1], r["sign"][1]]
        if r.get("awning"):
            colors[2] = r["awning"]
        if colors != sign_colors(p["cat"]):
            out["colors"] = colors
        if r.get("noren"):
            out["noren"] = r["noren"]
        if r.get("lantern"):
            out["lantern"] = True
        out["front"] = "photo"
    elif re.fullmatch(r"amenity:(pub|bar)", p["cat"]) and not r:
        out.update({"noren": IZAKAYA_NOREN, "lantern": True, "front": "default"})
    return out


def chain_look(name):
    """店名から、チェーンの配色 (colors, bands, key)。無ければ None"""
    for key, pat, (bg, fg, bands), _ in CHAINS:
        if re.search(pat, name or "", re.I):
            return [bg, fg, bands[0]], bands, key
    return None


def js_signed_area(r):
    """city.js / shapes.js の signedArea (向きの符号がこちらの signed_area と逆)"""
    a, j = 0, len(r) - 1
    for i in range(len(r)):
        a += r[j][0] * r[i][1] - r[i][0] * r[j][1]
        j = i
    return a / 2


FACADES = pathlib.Path(__file__).resolve().parent.parent / "data" / "facades.json"


def load_facades():
    """路上写真を見て付けた壁ごとのベランダの有無 (tools/facades.py)。[(x, z, nx, nz, kind)]、kind = b (あり) / w (なし)"""
    if not FACADES.exists():
        return []
    return [(r["x"], r["z"], r["nx"], r["nz"], r["kind"]) for r in json.loads(FACADES.read_text(encoding="utf-8"))["walls"]]


def facade_of(labels, a, c, nx, nz):
    """壁 a→c (外向き nx, nz) に当てはまる判定。判定の中点が壁の線から 2.5 m 以内・壁の範囲内で、向きがそろうもの"""
    dx, dz = c[0] - a[0], c[1] - a[1]
    L2 = dx * dx + dz * dz
    if L2 < 1e-6:
        return None
    for x, z, lx, lz, kind in labels:
        if lx * nx + lz * nz < 0.9:
            continue
        t = ((x - a[0]) * dx + (z - a[1]) * dz) / L2
        if -0.1 <= t <= 1.1 and abs((x - a[0]) * dz - (z - a[1]) * dx) / math.sqrt(L2) < 2.5:
            return kind
    return None


def build_shapes(city, world, cx, cz, R):
    inR = lambda x, z: (x - cx) ** 2 + (z - cz) ** 2 <= R * R

    # ---------- 集合住宅のベランダ (南寄りの長い壁。balcony=all なら全ての長い壁) ----------
    # 路上写真で判定した壁 (data/facades.json) は、その判定に従う (b = 向き・建物の種類によらず置く、w = 置かない)
    # 1 つの壁ごと: 壁の始点 (x, z)、壁の向き (dx, dz)、外向き (nx, nz)、壁の長さ len。
    # 2 階から最上階まで、床の高さ y + k * floorH (k = 1 から floors-1) に、奥行き 1.1m・手すり壁 1.1m のベランダ (両端 0.4m は空ける)
    balconies, apts = [], 0
    labels = load_facades()
    parts_of = {}
    for p in city["buildings"]:
        if p.get("part"):
            parts_of.setdefault(p["part"], []).append(p)
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
        s = 1 if sa > 0 else -1
        seen = {}
        if labels:
            for i in range(len(o)):
                a, c = o[i], o[(i + 1) % len(o)]
                L = math.hypot(c[0] - a[0], c[1] - a[1])
                if L >= 1e-6:
                    k = facade_of(labels, a, c, (c[1] - a[1]) / L * s, -(c[0] - a[0]) / L * s)
                    if k:
                        seen[i] = k
        if not is_apt and "b" not in seen.values():
            continue
        # balcony_tiers: 段 (点群から作った上の段) の輪郭にも、その高さの範囲でベランダを付ける。
        # 段の高さは建物全体の高さ ÷ 階数で決める (本体だけの高さで割らない)
        tiers = [(o, b["h"], 0.0)]
        if b.get("balcony_tiers") and parts_of.get(b["id"]):
            ht = max([b["h"]] + [p["h"] for p in parts_of[b["id"]]])
            floors = b.get("floors") or math.floor(ht / 3.0)
            fh = b.get("floor_h") or ht / max(floors, 1)   # floor_h = 段ごとに階数を持つ建物 (tools/grancity.py)
            floors = round(ht / fh)
            tiers += [(p["outer"], p["h"], p.get("minH") or 0.0) for p in parts_of[b["id"]]]
        else:
            floors = b.get("floors") or math.floor(b["h"] / 3.0)
            fh = b["h"] / max(floors, 1)
            ht = b["h"]
        if floors < 2:
            continue
        made = False
        for ti, (ring, top_h, min_h) in enumerate(tiers):
            tier = b.get("balcony_tiers") and len(tiers) > 1
            rs = 1 if js_signed_area(ring) > 0 else -1
            # 段の高さの範囲に床がある階: k0 〜 (屋根の 0.1 m 下までの階)
            k0 = max(1, math.ceil(min_h / fh - 0.01)) if tier else 1
            nfl = (int((top_h - 0.1) / fh) + 1) if tier else floors
            if tier and k0 >= nfl:
                continue
            for i in range(len(ring)):
                a, c = ring[i], ring[(i + 1) % len(ring)]
                dx, dz = c[0] - a[0], c[1] - a[1]
                L = math.hypot(dx, dz)
                sn = seen.get(i) if ti == 0 else None
                if L < (5 if sn == "b" else 7):
                    continue
                nx, nz = dz / L * rs, -dx / L * rs
                if sn == "w":
                    continue
                if sn != "b" and (not is_apt or (b.get("balcony") != "all" and nz < 0.55)):
                    continue
                balconies.append({"b": b["id"], "x": a[0], "z": a[1], "dx": round(dx / L, 4), "dz": round(dz / L, 4), "nx": round(nx, 4), "nz": round(nz, 4),
                                  "len": r3(L), "y": b.get("y") or 0, "floorH": round(fh, 4), "floors": nfl, **({"k0": k0} if k0 > 1 else {}),
                                  **({"dark": True} if b.get("railing") else {}),
                                  # 川側 (東向き) の長い壁は、横に連続した廊下状のバルコニー (グランシティの写真より)
                                  **({"corr": True} if b.get("railing") and nx > 0.7 and L > 20 else {})})
                made = True
        if made:
            apts += 1

    # ---------- 店の看板と日よけ (店の点にいちばん近い建物の、いちばん近い壁) ----------
    signs = []
    sf_labels = load_shopfronts()
    look_ids = {b["id"] for b in city["buildings"] if b.get("look")} | {b.get("part") for b in city["buildings"] if b.get("look") and b.get("part")}
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
        # 店の点にいちばん近い壁 (壁の線との距離。向きが外向きの側にある壁を優先) と、その壁の上の入口の位置 (店の点を壁に投影した位置)
        e = None
        for i in range(len(ring)):
            a, c = ring[i], ring[(i + 1) % len(ring)]
            L = math.hypot(c[0] - a[0], c[1] - a[1])
            if L < 3:
                continue
            ux, uz = (c[0] - a[0]) / L, (c[1] - a[1]) / L
            t = max(0.0, min(L, (p["x"] - a[0]) * ux + (p["z"] - a[1]) * uz))
            d = math.hypot(a[0] + ux * t - p["x"], a[1] + uz * t - p["z"])
            nx_, nz_ = uz * s, -ux * s
            if (p["x"] - a[0]) * nx_ + (p["z"] - a[1]) * nz_ < -1.5:
                d += 6.0   # 店の点が壁の内側にある (壁の向きと逆) ときは、不利にする
            if e is None or d < e[0]:
                e = (d, a, c, L, t)
        if not e:
            continue
        _, a, c, L, t = e
        ux, uz = (c[0] - a[0]) / L, (c[1] - a[1]) / L
        nx, nz = uz * s, -ux * s
        sw = min(L - 0.6, 7)
        t = max(sw / 2 + 0.3, min(L - sw / 2 - 0.3, t)) if L > sw + 0.6 else L / 2   # 看板が壁からはみ出さない範囲に
        # (x, z) = 看板の中心の位置 (壁の上。店の点を壁に投影した位置)、y = 建物の基準の高さ、正面 (yaw) = 壁の外向き。看板は y + 3.35、日よけは y + 2.6
        signs.append({"b": b["id"], "x": r2(a[0] + ux * t), "z": r2(a[1] + uz * t), "y": r2(b["base"]), "yaw": round(math.atan2(nx, nz), 4),
                      "w": r3(sw), "name": p.get("name") or "", "cat": p["cat"], "colors": sign_colors(p["cat"]),
                      **({"colors": ch[0], "bands": ch[1], "chain": ch[2]} if (ch := chain_look(p.get("name"))) else {}),
                      **shopfront_fields(p, bool(ch), sf_labels),
                      # 店先の柄 (看板の下に貼る): 居酒屋は格子戸、ほかはガラスの店先。ランドマーク (自前の柄がある建物) と狭い壁には付けない
                      **({"face": ("lattice" if re.fullmatch(r"amenity:(pub|bar)", p["cat"]) else "glass")} if (b["id"] not in look_ids and sw >= 2.4) else {})})
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
        L0 = looks.get(b.get("look")) or {}
        sgs = L0.get("sign")
        sgs = sgs if isinstance(sgs, list) else [sgs] if sgs else []
        for sg in sgs:
            ys = L0["y0"] + sg["floor"] * L0["floor_h"]
            if sg.get("at"):
                # at: その地点にいちばん近い壁 (看板の高さに壁がある段から選ぶ) に 1 枚
                ax, az = sg["at"]
                cand = None
                for p in city["buildings"]:
                    if p.get("look") != b["look"]:
                        continue
                    lo = (p.get("y") or 0) + (p.get("minH") or 0)
                    if not (lo <= ys <= (p.get("y") or 0) + p["h"]):
                        continue
                    o = p["outer"]
                    s = 1 if js_signed_area(o) > 0 else -1
                    for i in range(len(o)):
                        a, c = o[i], o[(i + 1) % len(o)]
                        dx, dz = c[0] - a[0], c[1] - a[1]
                        L = math.hypot(dx, dz)
                        if L < sg.get("min_len", 4):
                            continue
                        t = max(0, min(1, ((ax - a[0]) * dx + (az - a[1]) * dz) / (L * L)))
                        d = math.hypot(a[0] + dx * t - ax, a[1] + dz * t - az)
                        if cand is None or d < cand[0]:
                            cand = (d, L, a, c, dz / L * s, -dx / L * s, t)
                best = {"at": cand[1:6]} if cand else {}
                tat = cand[6] if cand else 0.5
            else:
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
                w = min(L * 0.5, sg.get("max_w", 24)) if q != "at" else sg.get("w") or min(L * 0.9, sg.get("max_w", 24))
                f = 0.5 if q != "at" else max(w / 2 / L, min(1 - w / 2 / L, tat))  # at: 地点に近い所 (壁からはみ出さない範囲)
                big.append({"b": b["id"], "x": r2(a[0] + (c[0] - a[0]) * f), "z": r2(a[1] + (c[1] - a[1]) * f), "y": r2(ys),
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
    routes = build_train_routes(city, H, platforms)
    fixtures = build_station_fixtures(city, world, H, col, platforms)
    return {"platforms": platforms, "canopies": canopies, "columns": columns, "gantries": gantries, "catenary": catenary,
            "dims": {"platH": PLAT_H, "mastH": MAST_H}, "routes": routes, **fixtures}


def build_station_fixtures(city, world, H, col, platforms):
    """駅の中: 駅舎 (線路の上の建物) を支える柱、ホームから駅舎へ上がる階段、ホームのベンチ・駅名標・自販機。
    piers:    駅舎の柱 [x, z, 下端 y, 上端 y]。線路の中心から 2.4 m 以上離れた所に、約 9 m おき
    stairs:   階段 {"x", "z" (下端の中央), "yaw" (上る向き), "w" 幅, "y0" 下端 (ホームの上面), "y1" 上端 (駅舎の床), "len" 長さ}
    benches:  ベンチ {x, y, z, yaw}  正面 (局所 +Z) が線路を向く
    nameSigns: 駅名標 {x, y, z, yaw}  板の面が線路を向く (両面)
    platVending: ホームの自販機 {x, y, z, yaw}"""
    rails = [r["pts"] for r in city.get("rails") or []]
    rail_grid = PointGrid(5)
    for p in rails:
        for i in range(len(p) - 1):
            (ax, az), (bx, bz) = p[i][:2], p[i + 1][:2]
            n = max(1, int(math.hypot(bx - ax, bz - az) * 2))
            for k in range(n + 1):
                rail_grid.add(ax + (bx - ax) * k / n, az + (bz - az) * k / n)
    station = [b for b in city["buildings"] if b.get("look") == "totsuka_station" and (b.get("minH") or 0) > 0]
    under = lambda x, z: next((b for b in station if pip(x, z, b["outer"])), None)

    piers = []
    for b in station:
        xs, zs = [q[0] for q in b["outer"]], [q[1] for q in b["outer"]]
        y1 = (b.get("y") or 0) + b["minH"]
        x = min(xs) + 4.5
        while x < max(xs):
            z = min(zs) + 4.5
            while z < max(zs):
                if pip(x, z, b["outer"]) and not rail_grid.near(x, z, 2.4) and not any(math.hypot(x - q[0], z - q[1]) < 6 for q in piers):
                    y0 = H(x, z)
                    piers.append([r2(x), r2(z), r2(y0), r2(y1)])
                    col.add_circle(x, z, 0.45, y0, y1 - y0)
                z += 9
            x += 9

    stairs, benches, signs, vend = [], [], [], []
    for pf in platforms:
        L, R, Y = pf["left"], pf["right"], pf["y"]
        C = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, y, math.hypot(a[0] - b[0], a[1] - b[1])) for a, b, y in zip(L, R, Y)]
        n = len(C)
        # 駅舎の下にある所 (ホームの点の番号の範囲)
        inside = [i for i, c in enumerate(C) if under(c[0], c[1])]
        if inside:
            i0 = max(inside)                       # 駅舎の南の端 (番号の大きい側) から、南へ下りる階段
            j = min(n - 1, i0 + 3)
            (x0, z0), (x1, z1) = C[i0][:2], C[j][:2]
            d = math.hypot(x1 - x0, z1 - z0) or 1
            ux, uz = (x0 - x1) / d, (z0 - z1) / d     # 上る向き (駅舎の方へ)
            b = under(C[i0][0], C[i0][1])
            y1 = (b.get("y") or 0) + b["minH"]
            y0 = C[i0][2]                           # ホームの上面
            rise = y1 - y0
            ln = rise / 0.55                        # 勾配 約 29° (蹴上げ 16 cm・踏面 29 cm)
            sx, sz = C[i0][0] - ux * (ln - 2.0), C[i0][1] - uz * (ln - 2.0)   # 上端が駅舎の中へ 2 m 入るように
            w = min(3.0, max(1.8, C[i0][3] - 4.5))
            stairs.append({"x": r2(sx), "z": r2(sz), "yaw": r3(math.atan2(ux, uz)), "w": r2(w), "y0": r2(y0), "y1": r2(y1), "len": r2(ln)})
            col.add_box(sx + ux * ln / 2, sz + uz * ln / 2, math.atan2(ux, uz), w / 2 + 0.1, ln / 2, y0, rise)
            stair_zone = [(sx + ux * t, sz + uz * t) for t in range(0, int(ln) + 4, 2)]
        else:
            stair_zone = []
        busy = lambda x, z: under(x, z) or any(math.hypot(x - q[0], z - q[1]) < 3.5 for q in stair_zone)
        for i in range(2, n - 2):
            x, z, y, wd = C[i]
            if wd < 5 or busy(x, z):
                continue
            a, b2 = C[i - 1], C[i + 1]
            dx, dz = b2[0] - a[0], b2[1] - a[1]
            d = math.hypot(dx, dz) or 1
            nx, nz = -dz / d, dx / d                # ホームに直角 (左の線路の側)
            yaw_along = math.atan2(dx / d, dz / d)
            if i % 6 == 0:                          # ベンチ (約 24 m おき。背中合わせに 2 脚)
                for s_ in (1, -1):
                    bx, bz = x + nx * s_ * 0.45, z + nz * s_ * 0.45
                    benches.append({"x": r2(bx), "y": r2(y), "z": r2(bz), "yaw": r3(math.atan2(nx * s_, nz * s_))})
                col.add_box(x, z, yaw_along, 0.9, 0.9, y, 0.45)
            elif i % 15 == 3:                       # 駅名標 (約 60 m おき)
                signs.append({"x": r2(x), "y": r2(y), "z": r2(z), "yaw": r3(math.atan2(nx, nz))})
                col.add_circle(x, z, 0.1, y, 2.3)
            elif i % 40 == 10:                      # 自販機 (背中合わせ)
                for s_ in (1, -1):
                    vx, vz = x + nx * s_ * 0.45, z + nz * s_ * 0.45
                    vend.append({"x": r2(vx), "y": r2(y), "z": r2(vz), "yaw": r3(math.atan2(nx * s_, nz * s_)), "color": 0})
                col.add_box(x, z, yaw_along, 0.5, 0.8, y, 1.83)
    print(f"station: piers={len(piers)} stairs={len(stairs)} benches={len(benches)} name signs={len(signs)} vending={len(vend)}")
    return {"piers": piers, "stairs": stairs, "benches": benches, "nameSigns": signs, "platVending": vend}


RAIL_TOP = 0.55      # 地面の線路のレールの上面 (地形からの高さ。detail/trackbed.js と同じ)
RAIL_TOP_BRIDGE = 0.5  # 線路の橋のレールの上面 (ys からの高さ。bridges.js)
ROUTE_STEP = 5.0     # 走る道筋の点の間隔 (m)


def train_line(name):
    """線の名前 → 電車の種類 (None = 走らせない。側線・引き込み線など名前の無い線)"""
    if not name:
        return None
    if "貨物" in name:
        return "freight"
    if "横須賀" in name:
        return "yokosuka"
    if "東海道" in name or "Tokaido" in name:
        return "tokaido"
    return None


def build_train_routes(city, H, platforms):
    """電車が走る道筋。OSM の線路は線路 1 本ごと・区間ごとに分かれているので、端点でつないで、地図の端から端までの道筋にする。
    分かれ道では同じ種類の線を優先し、いちばんまっすぐ続く区間を選ぶ。左側通行なので、反対向きの線路が右にある向きだけを残す。
    routes: [{"line": 種類, "p": [[x, y, z], ...] (約 5 m おき。y = レールの上面), "stop": 駅で止まる位置 (先頭の、道筋の始点からの距離 m) か null}]"""
    segs = []
    for r in city.get("rails") or []:
        line = train_line(r.get("name"))
        if not line:
            continue
        pts = r["pts"]
        ys = [y + RAIL_TOP_BRIDGE for y in r["ys"]] if r.get("ys") else None
        segs.append({"line": line, "pts": [(p[0], p[1]) for p in pts], "ys": ys})
    key = lambda p: (round(p[0] * 2), round(p[1] * 2))   # 0.5 m で同じ点とみなす
    ends = {}
    for i, sg in enumerate(segs):
        ends.setdefault(key(sg["pts"][0]), []).append((i, 0))
        ends.setdefault(key(sg["pts"][-1]), []).append((i, 1))

    def oriented(i, rev):
        sg = segs[i]
        pts = sg["pts"][::-1] if rev else sg["pts"]
        ys = (sg["ys"][::-1] if rev else sg["ys"]) if sg["ys"] else None
        return pts, ys

    def walk_from(i, rev):
        path, used = [], set()
        line = segs[i]["line"]
        while True:
            used.add(i)
            pts, ys = oriented(i, rev)
            path.append((pts, ys))
            tail = pts[-1]
            dx, dz = pts[-1][0] - pts[-2][0], pts[-1][1] - pts[-2][1]
            L = math.hypot(dx, dz) or 1
            best = None
            for j, end in ends.get(key(tail), []):
                if j in used:
                    continue
                nrev = end == 1
                q, _ = oriented(j, nrev)
                ex, ez = q[1][0] - q[0][0], q[1][1] - q[0][1]
                M = math.hypot(ex, ez) or 1
                cos = (dx * ex + dz * ez) / L / M
                if cos < math.cos(math.radians(25)):
                    continue
                score = cos + (0.5 if segs[j]["line"] == line else 0)
                if best is None or score > best[0]:
                    best = (score, j, nrev)
            if not best:
                return path
            _, i, rev = best

    raw = []
    for k, lst in ends.items():
        if len(lst) != 1:
            continue
        i, end = lst[0]
        path = walk_from(i, end == 1)
        # 点の列 (重なる継ぎ目は 1 つに) と、点ごとの高さ (橋は ys、地面は地形)
        P = []
        for pts, ys in path:
            for n, (x, z) in enumerate(pts):
                if P and n == 0:
                    continue
                P.append((x, z, ys[n] if ys else None))
        L = sum(math.hypot(P[n + 1][0] - P[n][0], P[n + 1][1] - P[n][1]) for n in range(len(P) - 1))
        B = city["bounds"]
        edge = lambda x, z: x < B["minX"] + 40 or x > B["maxX"] - 40 or z < B["minZ"] + 40 or z > B["maxZ"] - 40
        if L >= 1000 and edge(P[0][0], P[0][1]) and edge(P[-1][0], P[-1][1]):   # 地図の端から端まで (途中から始まる側線は除く)
            raw.append((segs[i]["line"], P, L))

    def resample(P):
        out, acc = [], 0.0
        nxt = 0.0
        for n in range(len(P) - 1):
            (ax, az, ay), (bx, bz, by) = P[n], P[n + 1]
            d = math.hypot(bx - ax, bz - az)
            if d <= 0:
                continue
            while nxt <= acc + d + 1e-9:
                t = (nxt - acc) / d
                x, z = ax + (bx - ax) * t, az + (bz - az) * t
                if ay is not None and by is not None:
                    y = ay + (by - ay) * t
                else:
                    y = H(x, z) + RAIL_TOP
                out.append([r2(x), r2(y), r2(z)])
                nxt += ROUTE_STEP
            acc += d
        return out

    routes = [(line, resample(P), L) for line, P, L in raw]

    # 左側通行: 進む向きの右 3〜15 m に、同じ種類のほかの道筋 (= 反対向きの線路。間にホームがあることもある) がある向きだけを残す
    def right_side_score(pts, others):
        sc = 0
        for n in range(10, len(pts) - 10, 20):
            x, z = pts[n][0], pts[n][2]
            dx, dz = pts[n + 1][0] - pts[n - 1][0], pts[n + 1][2] - pts[n - 1][2]
            L = math.hypot(dx, dz) or 1
            for o in others:
                for q in o[::2]:
                    vx, vz = q[0] - x, q[2] - z
                    d = math.hypot(vx, vz)
                    if 3 <= d <= 15 and abs(vx * dx + vz * dz) / L < 1.5:
                        sc += 1 if (dx * vz - dz * vx) / L < 0 else -1   # 右 = 進む向きから時計回り (x = 東, z = 南)
        return sc

    kept = []
    seen = set()
    for line, pts, L in routes:
        sig = (line, round(pts[0][0] / 20), round(pts[0][2] / 20), round(pts[-1][0] / 20), round(pts[-1][2] / 20))
        if sig in seen:
            continue
        seen.add(sig)
        others = [p for l2, p, _ in routes if l2 == line and p is not pts]
        if right_side_score(pts, others) > 0:
            kept.append((line, pts))

    # 駅で止まる位置: ホームの横を通る旅客線は、編成の中央がホームの中央に来る所で止まる (先頭の位置で持つ)
    out = []
    for line, pts in kept:
        stop = None
        if line != "freight":
            for pf in platforms:
                mid = len(pf["left"]) // 2
                cx = (pf["left"][mid][0] + pf["right"][mid][0]) / 2
                cz = (pf["left"][mid][1] + pf["right"][mid][1]) / 2
                n, d = min(((n, math.hypot(p[0] - cx, p[2] - cz)) for n, p in enumerate(pts)), key=lambda t: t[1])
                if d < 12:
                    stop = r2(n * ROUTE_STEP + TRAIN_CARS[line] * CAR_LEN / 2)
        out.append({"line": line, "p": pts, "stop": stop})
    print("train routes: " + ", ".join(f"{r['line']} {len(r['p']) * ROUTE_STEP:.0f} m" + (" (停車)" if r["stop"] else "") for r in out))
    return out


TRAIN_CARS = {"tokaido": 15, "yokosuka": 15, "freight": 20}   # 両数 (貨物は機関車 + 貨車)
CAR_LEN = 20.0                                                  # 1 両の長さ (m)。貨車も同じとして扱う


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
            ways.append({"pts": r["pts"], "ys": [y + 0.05 for y in r["ys"]], "hw": (r.get("w") or 3) / 2, "ground": False, "steps": r["kind"] == "steps", "edge": bool(r.get("edge"))})
        elif r["kind"] == "steps":
            ways.append({"pts": r["pts"], "ys": [H(q[0], q[1]) + 0.12 for q in r["pts"]], "hw": (r.get("w") or 2.5) / 2, "ground": True, "steps": True})
    n_walk = len(ways)
    for r in city["roads"]:  # 車道の橋: 手すりは付けないが、歩道がその路面の中を通る所 (橋の上の歩道) には手すりを置かない
        if r["kind"] not in WALK_PED and r.get("bridge") and r.get("ys"):
            ways.append({"pts": r["pts"], "ys": [y + 0.05 for y in r["ys"]], "hw": max(r["half"]) if r.get("half") else (r.get("w") or 3) / 2, "ground": False, "steps": False})
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
    for wi, w in enumerate(ways[:n_walk]):
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
        if not w["ground"] and mine and not w.get("edge"):  # 広場の縁の床 (edge) は、端をふさがない
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
TRAITS = ROOT / "data" / "tree_traits.json"   # 木ごとの葉の色・樹形 (tools/tree_traits.py が作る。無ければ全部同じ種類)
TREE_BASE_H = (4.9, 5.0, 5.2, 1.7)    # 種類ごとの、倍率 1 の木の高さ (m)。public/src/trees.js の BASE_H と同じ
TREE_BASE_R = (1.7, 1.4, 0.95, 1.3)   # 同、葉の半径 (m)
TREE_MAX_SC = (3.2, 3.2, 3.2, 1.8)    # 高さの倍率の上限 (点群の高さが 16 m を超える木は 16 m で止める)


def build_lidar_trees(lots, world, H, col):
    """木: 点群で周りより高かった所に、その高さの木を置く。建物に近い木は、葉が壁に入らない大きさに縮める。
    data/tree_traits.json があれば、種類 (広葉樹・針葉樹・細い木・低木)・葉の色・幅も付ける。
    [x, z, y, 高さの倍率, 乱数, 葉の色 (0xRRGGBB か null), 種類, 幅の倍率]。無いときは先頭の 5 つだけ"""
    traits = {}
    if TRAITS.exists():
        for x, z, kind, rgb, wr in json.loads(TRAITS.read_text(encoding="utf-8"))["trees"]:
            traits[(x, z)] = (kind, rgb, wr / 100)
    trees = []
    for x, z, h in lots["trees"]:
        near = world.query(x - 5, z - 5, x + 5, z + 5)
        if any(world.contains(b, x, z) for b in near):
            continue
        d = min([world.closest_d(b, x, z) for b in near], default=9.0)
        r = hash_rng(f"lt{x},{z}")()
        y = H(x, z)
        tr = traits.get((x, z))
        if tr is None:
            sc = min(2.6, max(0.6, h / 4.9))                      # 基準の木の高さは 4.9 m
            sc = max(0.5, min(sc, (d + 0.6) / 1.7))               # 葉の半径 1.7 m × 倍率
            trees.append([r2(x), r2(z), r2(y), r3(sc), r3(r)])
        else:
            kind, rgb, wr = tr
            R = TREE_BASE_R[kind]
            sc = min(TREE_MAX_SC[kind], max(0.6 if kind != 3 else 0.5, h / TREE_BASE_H[kind]))
            wr = max(0.5, min(wr, (d + 0.6) / (R * sc)))          # 壁に近い木は横を細くし、それでも入るなら低くする
            if R * sc * wr > d + 0.6:
                sc = max(0.5, (d + 0.6) / (R * wr))
            trees.append([r2(x), r2(z), r2(y), r3(sc), r3(r), None if rgb < 0 else rgb, kind, r2(wr)])
        col.tree.append([r2(x), r2(z), r3(0.25 * sc), r2(y), r2(y + 4.9 * sc)])
    print(f"trees (lidar)={len(trees)}" + (f" (種類・色つき {sum(1 for t in trees if len(t) > 5)})" if traits else ""))
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
RAIL_FENCE = ("#7d877f", 1.8)   # 線路沿いの金網 (色, 高さ)
RAIL_FENCE_OFF = 3.2            # いちばん外側の線路の中心からの距離 (m)


def build_rail_fences(city, world, H, col):
    """線路沿いの柵: いちばん外側の線路の、外側 RAIL_FENCE_OFF m に金網を張る (fences と同じ形式。kind = "rail")。
    ほかの線路がそばにある所 (線路と線路の間)、道路・建物・ホームの所、線路の橋は空ける"""
    pts_all = []
    for r in city.get("rails") or []:
        p = r["pts"]
        for i in range(len(p) - 1):
            (ax, az), (bx, bz) = p[i][:2], p[i + 1][:2]
            n = max(1, int(math.hypot(bx - ax, bz - az)))
            for k in range(n + 1):
                pts_all.append((ax + (bx - ax) * k / n, az + (bz - az) * k / n))
    rail_grid = PointGrid(5)
    for x, z in pts_all:
        rail_grid.add(x, z)
    road_pts = PointGrid(5)
    road_w = {}
    for rd in city["roads"]:
        if rd.get("ys"):
            continue
        p = rd["pts"]
        for i in range(len(p) - 1):
            (ax, az), (bx, bz) = p[i][:2], p[i + 1][:2]
            n = max(1, int(math.hypot(bx - ax, bz - az)))
            for k in range(n + 1):
                x, z = ax + (bx - ax) * k / n, az + (bz - az) * k / n
                road_pts.add(x, z)
                road_w[(round(x, 1), round(z, 1))] = rd["w"]
    plats = [a["outer"] for a in city.get("areas") or [] if a["kind"] == "platform"]

    def near_road(x, z):
        for gx in range(int(math.floor(x / 5)) - 3, int(math.floor(x / 5)) + 4):
            for gz in range(int(math.floor(z / 5)) - 3, int(math.floor(z / 5)) + 4):
                for qx, qz in road_pts.g.get((gx, gz), ()):
                    w = road_w.get((round(qx, 1), round(qz, 1)), 6)
                    if math.hypot(qx - x, qz - z) < w / 2 + 1.0:
                        return True
        return False

    def blocked(x, z):
        if rail_grid.near(x, z, RAIL_FENCE_OFF - 0.4) or near_road(x, z):
            return True
        if any(World.contains(b, x, z) or world.closest_d(b, x, z) < 0.4 for b in world.query(x - 1, z - 1, x + 1, z + 1)):
            return True
        return any(pip(x, z, r) or ring_dist(x, z, r) < 8 for r in plats)   # ホームの縁から 8 m 以内 (駅の中) は張らない

    def ring_dist(x, z, ring):
        best = 1e9
        for i in range(len(ring)):
            (ax, az), (bx, bz) = ring[i][:2], ring[(i + 1) % len(ring)][:2]
            dx, dz = bx - ax, bz - az
            L2 = dx * dx + dz * dz or 1e-9
            t = max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / L2))
            best = min(best, math.hypot(x - ax - dx * t, z - az - dz * t))
        return best
    post_grid = PointGrid(5)   # 並行する線路から同じ所に二重に張らない

    out_posts, panels = [], []
    for r in city.get("rails") or []:
        if r.get("ys"):
            continue
        for side in (1, -1):
            prev = [None]

            def cb(x, z, dx, dz, side=side, prev=prev):
                px, pz = x - dz * side * RAIL_FENCE_OFF, z + dx * side * RAIL_FENCE_OFF
                beyond = any(rail_grid.near(x - dz * side * o, z + dx * side * o, 1.5) for o in range(5, 26, 3))   # 外側にまだ線路がある (線路の群れの間)
                if beyond or blocked(px, pz) or post_grid.near(px, pz, 1.5):
                    prev[0] = None
                    return
                post_grid.add(px, pz)
                out_posts.append([r2(px), r2(pz), r2(H(px, pz))])
                q = prev[0]
                if q and math.hypot(px - q[0], pz - q[1]) < FENCE_STEP * 1.6:
                    mx, mz = (px + q[0]) / 2, (pz + q[1]) / 2
                    L = math.hypot(px - q[0], pz - q[1])
                    yaw = math.atan2(px - q[0], pz - q[1])
                    y = min(H(px, pz), H(q[0], q[1]))
                    panels.append([r2(mx), r2(mz), r2(y), r3(yaw), r2(L)])
                    col.add_box(mx, mz, yaw, 0.05, L / 2, y, RAIL_FENCE[1])
                prev[0] = (px, pz)
            walk(r["pts"], 0, FENCE_STEP, cb)
    print(f"rail fences: posts={len(out_posts)} panels={len(panels)} ({len(panels) * FENCE_STEP:.0f} m)")
    return {"kind": "rail", "color": RAIL_FENCE[0], "h": RAIL_FENCE[1], "posts": out_posts, "panels": panels} if panels else None


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
def build_shrines(H, hidden):
    """神社の社殿の配置 (data/appearance.json の shrines。形は public/src/shrine.js)。地面の高さと当たり判定を足して返す。
    当たり判定は小物の表示 (V キー) に関係なく効くよう、colliders ではなく各社殿に持たせる (main.js が登録する)。
    hidden = city.json で hide の付いた建物の ID。PLATEAU の建物を隠していない社殿 (tools/shrine.py --undo の後) は出さない"""
    ap = json.loads(APPEARANCE.read_text(encoding="utf-8")) if APPEARANCE.exists() else {}
    out = []
    for s in ap.get("shrines", []):
        if not set(s.get("hide", [])) <= hidden:
            continue
        ox, oz = s["origin"]
        a = math.radians(s["facing"])
        fx, fz = math.cos(a), math.sin(a)            # 正面の向き (局所 +Z)
        yaw = math.atan2(fx, fz)
        rx, rz = fz, -fx                             # 局所 +X (正面に向かって右手)
        y = H(ox, oz)
        W = lambda lx, lz: (ox + rx * lx + fx * lz, oz + rz * lx + fz * lz)
        hl, box, circle = s["hall"], [], []
        def add_box(lx, lz, hx, hz, top):
            x, z = W(lx, lz)
            box.append([r2(x), r2(z), r3(yaw), r2(hx), r2(hz), r2(y - 1), r2(y + top)])
        rd, kh = hl["roof_d"], hl["kohai"]
        add_box(0, -0.35, 2.45, 2.6, hl["floor"] + 0.04)                     # 基壇と浜縁 (上に乗れる)
        add_box(0, hl["body_z"], hl["body_w"] / 2 + 0.05, hl["body_d"] / 2 + 0.05, hl["ridge"] - 0.3)  # 身舎 (屋根の中まで)
        add_box(0, rd / 2 + kh / 2 - 0.2, 1.45, kh / 2 + 0.35, 0.22)        # 向拝の下の基壇
        add_box(0, 2.75, 0.95, 0.5, 0.5)                                     # 階段 (1 段目の高さ)
        add_box(0, rd / 2 + 0.35, 0.6, 0.32, 0.82)                           # 賽銭箱
        for sx in (-1, 1):                                                   # 向拝の柱
            x, z = W(sx * 1.3, rd / 2 + kh - 0.45)
            circle.append([r2(x), r2(z), 0.16, r2(y - 1), r2(y + hl["eave"])])
        an = s.get("annex")
        if an:
            add_box(an["at"][0], an["at"][1], an["w"] / 2, an["d"] / 2, an["ridge"])
        ap = s.get("approach")
        if ap:  # 参道: 道路側の段・踊り場・石段 (段ごとに奥まで続く箱。上に乗れる)・上の石畳・石垣・鳥居の柱 (形は shrine.js の buildApproach と同じ寸法)
            x0, wl = ap["x"], ap["walls"]
            sw, (ol, orr) = wl["side"], wl["out"]
            xc, hxo = x0 + (orr - ol) / 2, (ol + orr) / 2
            def add_abs(lx, lz, hx, hz, top_abs, bottom_abs=None):
                x, z = W(lx, lz)
                box.append([r2(x), r2(z), r3(yaw), r2(hx), r2(hz), r2((bottom_abs if bottom_abs is not None else y - 4)), r2(top_abs)])
            frz, lz_, tz = ap["front_z"], ap["landing_z"], ap["top_z"]
            ys, yl, yt = ap["street_y"], ap["landing_y"], ap["top_y"]
            add_abs(xc, frz - 0.15, hxo, 0.15, ys + (yl - ys) / 3)                   # 道路側の段 (2 段)
            add_abs(xc, frz - 0.45, hxo, 0.15, ys + (yl - ys) * 2 / 3)
            add_abs(xc, (lz_ + frz - 0.6) / 2, hxo, (frz - 0.6 - lz_) / 2, yl)       # 踊り場
            n, run = ap["steps"], (lz_ - tz) / ap["steps"]
            for k in range(n):                                                         # 石段
                z0 = lz_ - k * run
                add_abs(x0, (z0 + tz) / 2, sw, (z0 - tz) / 2, yl + (yt - yl) * (k + 1) / n)
            add_abs(x0, (tz + ap["plate_to"]) / 2, sw, (tz - ap["plate_to"]) / 2, yt)  # 上の石畳
            for sx, o in ((-1, ol), (1, orr)):                                        # 石垣: 踊り場の奥 (道路側の面) と石段の脇
                add_abs(x0 + sx * (sw + o) / 2, lz_ - 0.2, (o - sw) / 2, 0.2, wl["top_y"])
                add_abs(x0 + sx * (sw + 0.2), (lz_ + tz) / 2, 0.2, (lz_ - tz) / 2, wl["top_y"])
            ti = ap["torii"]
            for sx in (-1, 1):
                x, z = W(x0 + sx * ti["span"] / 2, ti["z"])
                circle.append([r2(x), r2(z), 0.24, r2(yl - 1), r2(yl + ti["h"])])
        # 境内の小物: 位置 (世界)・高さ・向きを決め、当たり判定を足す (形は shrine.js の buildItem)
        items = []
        RAD = {"komainu": 0.45, "toro": 0.35, "monument": None, "sign": 0.12, "bollard": 0.13, "stones": 0.5, "board": 0.12}
        for it in s.get("items", []):
            if "world" in it:
                x, z = it["world"]
                dx, dz = x - ox, z - oz
                lx, lz = dx * rx + dz * rz, dx * fx + dz * fz
            else:
                lx, lz = it["at"]
                x, z = W(lx, lz)
            g_ = H(x, z)
            lv = it.get("level")
            iy = ap["landing_y"] if (ap and lv == "landing") else ap["top_y"] if (ap and lv == "top") else g_
            if "face" in it:
                fa = math.radians(it["face"])
                lyaw = math.atan2(math.sin(fa), math.cos(fa))
            else:   # 参道の筋 (x = approach.x、少し道路側) の方を向く
                tx, tz2 = ((ap["x"] if ap else 0) - lx, ((ap["top_z"] + 2) if ap else lz + 2) - lz)
                lyaw = math.atan2(tx, tz2)
            rec = {k: v for k, v in it.items() if k not in ("at", "world", "level")}
            rec.update({"lx": r2(lx), "lz": r2(lz), "y": r2(iy - y), "ground": r2(g_ - y), "lyaw": r3(lyaw)})
            items.append(rec)
            t = it["type"]
            if t == "chozuya":
                bx, bz = 1.3, 0.9
                cy, sy_ = math.cos(lyaw), math.sin(lyaw)
                box.append([r2(x), r2(z), r3(yaw + lyaw), bx, bz, r2(g_ - 1), r2(iy + 0.9)])
            elif t == "monument":
                box.append([r2(x), r2(z), r3(yaw + lyaw), r2(it["w"] / 2), r2(it.get("d", 0.4) / 2), r2(g_ - 1), r2(iy + it["h"])])
            else:
                top = {"komainu": 1.6, "toro": 2.2, "sign": 1.9, "bollard": 0.8, "stones": 0.5, "board": 2.0}[t]
                circle.append([r2(x), r2(z), RAD[t], r2(min(g_, iy) - 1), r2(iy + top)])
        # お祭りの飾り: 提灯の列の柱と幟の竿 (位置・高さ。形は shrine.js の buildFestival)
        fest = None
        fe = s.get("festival")
        if fe:
            def base(p):
                lx, lz = p[0], p[1]
                x, z = W(lx, lz)
                lv = p[2] if len(p) > 2 else None
                b_ = ap["landing_y"] if (ap and lv == "landing") else ap["top_y"] if (ap and lv == "top") else H(x, z)
                return x, z, b_
            lines = []
            for ln in fe.get("lines", []):
                pts = []
                for p in ln["pts"]:
                    x, z, b_ = base(p)
                    pts.append([p[0], p[1], r2(b_ - y)])
                    circle.append([r2(x), r2(z), 0.09, r2(b_ - 1), r2(b_ + ln["h"] + 0.3)])
                lines.append({"h": ln["h"], "pts": pts})
            nob = []
            for p in fe.get("nobori", []):
                x, z, b_ = base(p)
                nob.append([p[0], p[1], r2(b_ - y)])
                circle.append([r2(x), r2(z), 0.08, r2(b_ - 1), r2(b_ + 5)])
            fest = {"lines": lines, "nobori": nob}
        out.append({**{k: v for k, v in s.items() if not k.startswith("_") and k not in ("hide", "hide_roads", "items", "festival")}, "items": items, "festival": fest,
                    "yaw": r3(yaw), "y": r2(y), "colliders": {"box": box, "circle": circle}})
    return out



# =====================================================================
# 歩行者の通り道 (issue #64。public/src/crowd.js が読んで、人を歩かせる)
# =====================================================================
CROWD_STEP = 4.0           # 通り道の点の間隔 (m)
CROWD_MIN_RUN = 12.0       # これより短い通り道は捨てる (m)
CROWD_STREETS = {"residential", "unclassified", "living_street", "tertiary", "secondary", "primary", "trunk"}


def build_crowd(city, world, H):
    """歩行者が歩く線の一覧。地面の歩道・小道 (f) / 幹線の歩道 (s) / 歩道の無い道の端 (r)。
    橋・デッキ・階段・坂 (ys 付き。d = デッキ・坂・自由通路、t = 階段) は、点ごとの高さ y も書く (建物の中の切り取りはしない)。地面の通り道は建物の中に入る所を切る。
    lanes: [{k, w, p: [x, z, x, z, ...], y?: [高さ, ...]}]。歩く人は進行方向の右側へ少しずれる (日本の歩行者は右側通行) のはブラウザ側で付ける。
    hubs: 人が集まる所。st = 駅、pub = 居酒屋・バー (夜に人が増える)"""
    def clear(x, z, r=0.4):
        for b in world.query(x - r, z - r, x + r, z + r):
            if world.contains(b, x, z) or world.closest_d(b, x, z) < r:
                return False
        return True

    def offset(pts, off):
        """折れ線を左へ off ずらす (左 = (-dz, dx))"""
        out = []
        for i, (x, z) in enumerate(pts):
            a = pts[max(0, i - 1)]
            b = pts[min(len(pts) - 1, i + 1)]
            dx, dz = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dz) or 1
            out.append((x - dz / L * off, z + dx / L * off))
        return out

    lanes = []

    def add(kind, w, pts):
        pts = [tuple(p) for p in pts]
        samples = []
        walk(pts, 0.0, CROWD_STEP, lambda x, z, dx, dz: samples.append((x, z)))
        if len(pts) >= 2:
            samples.append(pts[-1])
        run = []
        for x, z in samples + [(None, None)]:
            if x is not None and clear(x, z):
                run.append((x, z))
                continue
            if len(run) * CROWD_STEP >= CROWD_MIN_RUN:
                lanes.append({"k": kind, "w": round(w, 2), "p": [r2(v) for q in run for v in q]})
            run = []

    def add_deck(kind, w, pts, ys):
        """橋・デッキ・階段・坂 (ys = 各点の高さ)。点ごとの高さ y も書く。高さが急に跳ぶ所 (OSM の線と実測のずれ) で切る"""
        L = [0.0]
        for i in range(1, len(pts)):
            L.append(L[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
        if L[-1] < CROWD_MIN_RUN:
            return
        samples, d = [], 0.0
        while d < L[-1]:
            samples.append(d)
            d += CROWD_STEP
        samples.append(L[-1])
        out, j = [], 0
        for d in samples:
            while j < len(pts) - 2 and L[j + 1] < d:
                j += 1
            t = (d - L[j]) / ((L[j + 1] - L[j]) or 1)
            out.append((pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t, ys[j] + (ys[j + 1] - ys[j]) * t, d))
        run = []
        for q in out + [None]:
            if q is not None and run and abs(q[2] - run[-1][2]) > 0.8 * max(0.5, q[3] - run[-1][3]):
                q_next = q
                q = None
            else:
                q_next = None
            if q is not None:
                run.append(q)
                continue
            if len(run) >= 3 and run[-1][3] - run[0][3] >= CROWD_MIN_RUN:
                lanes.append({"k": kind, "w": round(w, 2), "p": [r2(v) for a in run for v in a[:2]], "y": [r2(a[2]) for a in run]})
            run = [q_next] if q_next else []

    for r in city["roads"]:
        if r.get("hide") or len(r["pts"]) < 2:
            continue
        k = r["kind"]
        if r.get("ys"):
            if k in ("footway", "path", "pedestrian", "steps", "corridor") and len(r["ys"]) == len(r["pts"]):
                add_deck("t" if k == "steps" else "d", r["w"], r["pts"], r["ys"])
            continue
        if k in ("footway", "path", "pedestrian"):
            add("f", r["w"], r["pts"])
        elif k in CROWD_STREETS:
            if r.get("sw"):
                for side in (1, -1):
                    add("s", r["sw"], offset(r["pts"], side * (edge(r, side) - r["sw"] / 2)))
            elif r["w"] < 14:
                for side in (1, -1):
                    add("r", 1.2, offset(r["pts"], side * (edge(r, side) - 0.6)))
    st = [[p["x"], p["z"]] for p in city.get("pois", []) if p.get("cat") == "railway:station"]
    pub = [[p["x"], p["z"]] for p in city.get("pois", []) if p.get("cat") in ("amenity:pub", "amenity:bar")]
    n = sum(len(l["p"]) // 2 for l in lanes)
    print(f"crowd lanes={len(lanes)} (deck={sum(1 for l in lanes if l['k'] == 'd')} steps={sum(1 for l in lanes if l['k'] == 't')}) points={n} length={n * CROWD_STEP / 1000:.1f} km hubs st={len(st)} pub={len(pub)}")
    return {"lanes": lanes, "hubs": {"st": st, "pub": pub}}



# =====================================================================
# 走る車の道 (issue #64 第 3 段階。public/src/trafficsim.js が読んで、車を走らせる)
# =====================================================================
TRAFFIC_KINDS = {"trunk", "trunk_link", "primary", "secondary", "tertiary", "residential", "unclassified", "living_street"}
TRAFFIC_STEP = 4.0


def build_traffic(city):
    """車の通る道を、交差点 (複数の道が共有する点・行き止まり) で区切って、1 区間ごとに 2 本の車線 (往き・復り) にする。
    日本は左側通行: 進む向きの左へ、車の通る側の幅の半分だけずらした線。車線の向きは「始まりの交差点 a → 終わりの交差点 b」。
    lanes: [{k, w, a, b, p: [x, z, ...], y?: [...]}]。往きの車線 (2e) の逆向きが 2e + 1。nodes: [[x, z], ...]。橋 (ys) は高さ y も書く"""
    roads = [r for r in city["roads"] if r["kind"] in TRAFFIC_KINDS and not r.get("hide") and len(r["pts"]) >= 2]
    use = {}
    for i, r in enumerate(roads):
        for p in r["pts"]:
            use.setdefault((p[0], p[1]), set()).add(i)
    node_id, nodes = {}, []

    def node(p):
        key = (p[0], p[1])
        if key not in node_id:
            node_id[key] = len(nodes)
            nodes.append([r2(p[0]), r2(p[1])])
        return node_id[key]

    def offset(pts, off):
        """折れ線を進む向きの左へ off ずらす。x = 東・z = 南なので、東へ進むときの左 (北) は (dz, -dx)。(build_props.py の中の「左 = (-dz, dx)」は、
        地図で見ると進む向きの右なので注意。road["half"][0] もその側)。角は斜めに切って、ずれ過ぎないようにする"""
        out = []
        for i, (x, z) in enumerate(pts):
            nx = nz = 0.0
            for a, b in ((pts[i - 1], pts[i]) if i > 0 else (None, None), (pts[i], pts[i + 1]) if i < len(pts) - 1 else (None, None)):
                if a is None:
                    continue
                dx, dz = b[0] - a[0], b[1] - a[1]
                L = math.hypot(dx, dz) or 1
                nx += dz / L
                nz += -dx / L
            m = math.hypot(nx, nz) or 1
            k = min(1.6, 2.0 / m) if m < 2 else 1.0   # 2 つの法線の平均が短い (= 角が急) ほど長く
            out.append((x + nx / m * off * k, z + nz / m * off * k))
        return out

    def resample(pts, ys):
        """元の点を残して、TRAFFIC_STEP より長い区間は割る"""
        out, oy = [pts[0]], ([ys[0]] if ys else None)
        for i in range(1, len(pts)):
            a, b = pts[i - 1], pts[i]
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            n = max(1, int(math.ceil(L / TRAFFIC_STEP)))
            for k in range(1, n + 1):
                t = k / n
                out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
                if ys:
                    oy.append(ys[i - 1] + (ys[i] - ys[i - 1]) * t)
        return out, oy

    lanes = []
    for i, r in enumerate(roads):
        pts = [tuple(p) for p in r["pts"]]
        ys = r["ys"] if r.get("ys") and len(r["ys"]) == len(pts) else None
        cut = [0] + [k for k in range(1, len(pts) - 1) if len(use[pts[k]]) > 1] + [len(pts) - 1]
        half = r.get("half") or [r["w"] / 2, r["w"] / 2]
        sw = r.get("sw") or 0
        off_f = min(5.0, max(1.0, (half[1] - sw) / 2))   # 往き (点の並びの向き) の左側 = half[1] の側
        off_b = min(5.0, max(1.0, (half[0] - sw) / 2))   # 復り (逆向き) の左側 = half[0] の側
        for a, b in zip(cut, cut[1:]):
            seg = pts[a:b + 1]
            sy = ys[a:b + 1] if ys else None
            na, nb = node(seg[0]), node(seg[-1])
            if na == nb or sum(math.hypot(q[0] - p[0], q[1] - p[1]) for p, q in zip(seg, seg[1:])) < 3.0:
                continue
            for rev in (False, True):
                sp = seg[::-1] if rev else seg
                syy = (sy[::-1] if rev else sy) if sy else None
                q, qy = resample(offset(sp, off_b if rev else off_f), syy)
                lane = {"k": r["kind"], "w": round(r["w"], 1), "a": nb if rev else na, "b": na if rev else nb, "p": [r2(v) for c in q for v in c]}
                if qy:
                    lane["y"] = [r2(v) for v in qy]
                lanes.append(lane)
    km = sum(sum(math.hypot(l["p"][2 * k + 2] - l["p"][2 * k], l["p"][2 * k + 3] - l["p"][2 * k + 1]) for k in range(len(l["p"]) // 2 - 1)) for l in lanes) / 1000
    print(f"traffic lanes={len(lanes)} nodes={len(nodes)} length={km:.1f} km")
    return {"lanes": lanes, "nodes": nodes}


def build(city):
    H = load_terrain()
    # 外観を別に描く建物 (hide。神社の社殿 = tools/shrine.py) は無いものとして扱う (ベランダ・看板を付けない、道の当たりにも使わない)
    hidden = {b["id"] for b in city["buildings"] if b.get("hide")}
    city = {**city, "buildings": [b for b in city["buildings"] if not b.get("hide")]}
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
    walk = build_walk({**city, "roads": [r for r in city["roads"] if not r.get("hide")]}, world, H, col)  # 描かない道 (hide) には手すりを付けない
    extras = build_area_extras(city, world, H, col, (lots or {}).get("sites") or ())
    rf = build_rail_fences(city, world, H, col)
    if rf:
        extras["fences"].append(rf)
    small = json.loads(SMALL.read_text(encoding="utf-8")) if SMALL.exists() else None
    yard = build_yard(small, world, H, col) if small else {}
    crowd = build_crowd(city, world, H)
    traffic = build_traffic(city)
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
        "crowd": crowd,
        "traffic": traffic,
        "shrines": build_shrines(H, hidden),
        **yard,
        **extras,
        "colliders": {"circle": col.circle, "box": col.box, "line": col.line, "tree": col.tree},
    }


def main():
    city = json.loads(CITY.read_text(encoding="utf-8"))
    out = build(city)
    DST.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"-> {DST} ({DST.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
