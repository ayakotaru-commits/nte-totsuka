"""フェアリー・リールパーク 段階 2・3: 各エリアの建物・内側の道・広場・木・看板・門と、乗り物の置き場所を、設定から決まった乱数で作る。

入力: data/park.json (敷地・エリア・広場・道) と data/park_areas.json (エリアごとのテーマ)。
出力: tools/park.py が public/data/park.json の gen に入れる (何度実行しても同じ結果)。描画は public/src/detail/parkareas.js。
実在のパークの建物・水路・園内の道の輪郭は使わない (配置は、エリアの外形・入口の道・中心線に沿った並びから決まった乱数で作る)。

    python tools/park_areas.py --plot out.png     配置の平面図を書く (確認用。ファイルは書かない)
"""
import json
import math
import pathlib
import random
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
AREAS = ROOT / "data" / "park_areas.json"


def inpoly(x, z, p):
    ins = False
    for i in range(len(p)):
        a, b = p[i - 1], p[i]
        if (a[1] > z) != (b[1] > z) and x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]:
            ins = not ins
    return ins


def seg_dist(px, pz, a, b):
    ex, ez = b[0] - a[0], b[1] - a[1]
    l2 = ex * ex + ez * ez or 1e-9
    t = max(0.0, min(1.0, ((px - a[0]) * ex + (pz - a[1]) * ez) / l2))
    return math.hypot(px - a[0] - ex * t, pz - a[1] - ez * t)


def poly_edge_dist(x, z, p):
    return min(seg_dist(x, z, p[i - 1], p[i]) for i in range(len(p)))


def inside(x, z, p, m):
    return inpoly(x, z, p) and poly_edge_dist(x, z, p) >= m


def poly_area(p):
    return abs(sum(p[i - 1][0] * p[i][1] - p[i][0] * p[i - 1][1] for i in range(len(p)))) / 2


def corners(x, z, yaw, hx, hz):
    ux, uz = math.sin(yaw), math.cos(yaw)
    rx, rz = uz, -ux
    return [(x + rx * hx * a + ux * hz * b, z + rz * hx * a + uz * hz * b) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


def obb_overlap(a, b, margin=0.0):
    """a, b = (x, z, yaw, hx, hz)。分離軸で、margin だけ広げて重なるか"""
    pa = corners(a[0], a[1], a[2], a[3] + margin, a[4] + margin)
    pb = corners(b[0], b[1], b[2], b[3], b[4])
    for yaw in (a[2], a[2] + math.pi / 2, b[2], b[2] + math.pi / 2):
        ax, az = math.sin(yaw), math.cos(yaw)
        pr = [p[0] * ax + p[1] * az for p in pa]
        qr = [p[0] * ax + p[1] * az for p in pb]
        if max(pr) < min(qr) or max(qr) < min(pr):
            return False
    return True


def polyline_len(pts):
    return sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))


def point_at(pts, s):
    """折れ線の上の、始点から s の位置と向き (単位ベクトル)"""
    for i in range(len(pts) - 1):
        L = math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        if L < 1e-9:
            continue
        if s <= L or i == len(pts) - 2:
            t = max(0.0, min(1.0, s / L))
            return (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t), ((pts[i + 1][0] - pts[i][0]) / L, (pts[i + 1][1] - pts[i][1]) / L)
        s -= L
    return pts[-1], (1.0, 0.0)


def pick(rng, weights):
    tot = sum(weights.values())
    r = rng.uniform(0, tot)
    for k, w in weights.items():
        r -= w
        if r <= 0:
            return k
    return k


def rl(v):
    return round(v, 2)


def generate(cfg):
    A = json.loads(AREAS.read_text(encoding="utf-8"))
    themes = A["themes"]
    short = {"short": A["short"], "shortRoman": A["shortRoman"]}
    site = cfg["site"]
    areas = {k: v for k, v in cfg["areas"].items() if not k.startswith("_")}
    ellipses = cfg["ellipses"]
    gate = cfg["gate"]["at"]
    tower = cfg["tower"]
    prom = cfg["promenade"]
    for n in areas:
        if n not in themes:
            sys.exit(f"park_areas: エリア {n} のテーマが data/park_areas.json に無い")

    out = {"short": A["short"], "areas": [], "paths": [], "plazas": [], "buildings": [], "trees": [], "lamps": [], "benches": [], "beds": [], "props": [], "arches": [], "signs": []}
    sign_idx = {}

    def sign(text, scheme):
        key = (text, scheme[0], scheme[1])
        if key not in sign_idx:
            sign_idx[key] = len(out["signs"])
            out["signs"].append({"text": text, "bg": scheme[0], "fg": scheme[1]})
        return sign_idx[key]

    # ---- 障害物 (すべてのエリアで共通) ----
    park_paths = [(p["pts"], p["width"] / 2) for p in cfg["paths"]]   # 園の道 (半幅つき)
    inner = []   # 内側の道 (pts, 半幅)
    circles = [(gate[0], gate[1], 15.0), (tower["at"][0], tower["at"][1], tower["radius"] + 10)]   # ゲートの看板・タワー
    placed = []   # 建物の長方形 (x, z, yaw, hx, hz)
    tree_pts = []

    def ell_hit(x, z, grow=0.0):
        for n, e in ellipses.items():
            g = grow + (prom["offset"] + prom["width"] + 6 if "lake" in e else 6)
            if ((x - e["center"][0]) / (e["rx"] + g)) ** 2 + ((z - e["center"][1]) / (e["rz"] + g)) ** 2 < 1:
                return True
        return False

    def path_clear(x, z, m, skip=None):
        for pts, hw in park_paths + inner:
            if skip is not None and pts is skip:
                continue
            for i in range(len(pts) - 1):
                if seg_dist(x, z, pts[i], pts[i + 1]) < hw + m:
                    return False
        return True

    def pt_ok(x, z, area_poly, inset, pm):
        if not inside(x, z, site, 6) or not inside(x, z, area_poly, inset):
            return False
        if ell_hit(x, z):
            return False
        for cx, cz, r in circles:
            if math.hypot(x - cx, z - cz) < r:
                return False
        return path_clear(x, z, pm)

    def rect_ok(r, area_poly, pm=2.0, margin=1.5, skip=None):
        x, z, yaw, hx, hz = r
        pts = [(x, z)]
        cs = corners(x, z, yaw, hx, hz)
        for i in range(4):
            a, b = cs[i], cs[(i + 1) % 4]
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            n = max(1, int(L / 2.5))
            for k in range(n):
                pts.append((a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n))
        for px, pz in pts:
            if not inside(px, pz, site, 6) or not inside(px, pz, area_poly, 2.0) or ell_hit(px, pz):
                return False
            for cx, cz, rr in circles:
                if math.hypot(px - cx, pz - cz) < rr:
                    return False
            if not path_clear(px, pz, pm, skip):
                return False
        for q in placed:
            if obb_overlap(r, q, margin):
                return False
        return True

    # ---- 各エリア: 内側の道・広場・特別な物 ----
    info = {}
    for ai, (name, poly) in enumerate(areas.items()):
        th = themes[name]
        out["areas"].append({"name": name, "kind": th["kind"], "lamp": th.get("lamp", "warm"), "trim": th.get("trim", "#ffffff")})
        rng = random.Random(f"{name}/{th['seed']}")
        inf = {"ai": ai, "name": name, "poly": poly, "th": th, "rng": rng, "paths": [], "plazas": [], "far": None}
        info[name] = inf
        if th["kind"] == "avenue":
            av = next(p for p in cfg["paths"] if p["name"] == name)
            inf["paths"].append({"pts": av["pts"], "w": av["width"], "main": True, "k": "pink", "exist": True})
            continue
        # 入口の道: 終わりがこのエリアの中にある園の道
        conn = None
        for p in cfg["paths"]:
            for end, other in ((p["pts"][-1], p["pts"][0]), (p["pts"][0], p["pts"][-1])):
                if inpoly(end[0], end[1], poly) and (conn is None or poly_edge_dist(end[0], end[1], poly) > poly_edge_dist(conn[1][0], conn[1][1], poly)):
                    conn = (p, end, other)   # 終わりがエリアの中にある道。縁から遠い方の端を、入口の道の終わりにする
        if conn is None:
            sys.exit(f"park_areas: エリア {name} に入る園の道が無い")
        E = conn[1]
        O = conn[2]   # 入口の道の、エリアの外の端 (広場の側)
        # 主な通り: 重心を通り、エリアの長い向き (主成分) に沿う線。エリアの内側 (縁から 8 m) に収まる範囲
        pts = [(x, z) for x in range(int(min(q[0] for q in poly)), int(max(q[0] for q in poly)), 6) for z in range(int(min(q[1] for q in poly)), int(max(q[1] for q in poly)), 6) if inpoly(x, z, poly)]
        cx, cz = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        sxx = sum((p[0] - cx) ** 2 for p in pts); szz = sum((p[1] - cz) ** 2 for p in pts); sxz = sum((p[0] - cx) * (p[1] - cz) for p in pts)
        ang = 0.5 * math.atan2(2 * sxz, sxx - szz)
        dx, dz = math.cos(ang), math.sin(ang)
        # 入口の道の終わりが主な通りの線に近い (35 m 以内) なら、通りを入口の道の終わりから始める (2 本の平行線にしない)
        if abs(-(E[0] - cx) * dz + (E[1] - cz) * dx) < 35 and inside(E[0], E[1], poly, 8):
            cx, cz = E
        # 重心が外 (凹んだ形) なら、入口に近い内側の点に寄せる
        if not inside(cx, cz, poly, 8):
            best = min((p for p in pts if inside(p[0], p[1], poly, 8)), key=lambda p: math.hypot(p[0] - cx, p[1] - cz))
            cx, cz = best
        def march(sign_):
            s = 0.0
            while s < 400:
                x, z = cx + dx * sign_ * (s + 2), cz + dz * sign_ * (s + 2)
                if not inside(x, z, poly, 8) or ell_hit(x, z) or any(math.hypot(x - c[0], z - c[1]) < c[2] for c in circles):
                    break
                s += 2
            return s
        sa, sb = march(1), march(-1)
        # 入口に近い方が「近い端」、遠い方が「遠い端」
        pa, pb = (cx + dx * sa, cz + dz * sa), (cx - dx * sb, cz - dz * sb)
        far_pos, far_len, far_dir = (pa, sa, (dx, dz)) if math.hypot(pa[0] - O[0], pa[1] - O[1]) > math.hypot(pb[0] - O[0], pb[1] - O[1]) else (pb, sb, (-dx, -dz))
        near_len = sb if far_len == sa else sa
        lm = th.get("landmark")
        pr = th.get("plaza", {}).get("r", 14)
        # 遠い端: 特別な建物 (landmark) があれば端に置き、その手前に広場。無ければ端の手前に広場
        fd = far_dir
        far_plaza = None
        lmrect = None
        if lm:
            ld = lm["d"]
            for back in (3, 6, 10, 16):
                L = (far_pos[0] - fd[0] * (ld / 2 + back), far_pos[1] - fd[1] * (ld / 2 + back))
                yaw = math.atan2(-fd[0], -fd[1])
                r = (L[0], L[1], yaw, lm["w"] / 2, ld / 2)
                if all(inside(c[0], c[1], poly, 2) for c in corners(*r)):
                    lmrect = r
                    far_plaza = (L[0] - fd[0] * (ld / 2 + pr + 3), L[1] - fd[1] * (ld / 2 + pr + 3))
                    break
        if far_plaza is None:
            far_plaza = (far_pos[0] - fd[0] * (pr + 3), far_pos[1] - fd[1] * (pr + 3))
        # 通りの折れ線 (wiggle: 振幅 m・波長 m)
        mw = th.get("mainW", 8)
        start = (cx - fd[0] * near_len, cz - fd[1] * near_len)
        total = math.hypot(far_plaza[0] - start[0], far_plaza[1] - start[1])
        wig = th.get("wiggle")
        line = []
        n = max(2, int(total / 10))
        for k in range(n + 1):
            t = k / n
            x, z = start[0] + (far_plaza[0] - start[0]) * t, start[1] + (far_plaza[1] - start[1]) * t
            if wig:
                off = wig[0] * math.sin(2 * math.pi * (total * t) / wig[1]) * math.sin(math.pi * t) ** 0.5
                x, z = x - fd[1] * off, z + fd[0] * off
            line.append((rl(x), rl(z)))
        # 入口の道の終わりから、主な通りまでの連絡路
        near = min(line, key=lambda p: math.hypot(p[0] - E[0], p[1] - E[1]))
        if math.hypot(near[0] - E[0], near[1] - E[1]) > 3:
            inf["paths"].append({"pts": [[rl(E[0]), rl(E[1])], [near[0], near[1]]], "w": mw, "main": False, "k": "stone", "exist": False})
        inf["paths"].append({"pts": [list(p) for p in line], "w": mw, "main": True, "k": "stone", "exist": False})
        inf["axis"] = (fd[0], fd[1])
        inf["far"] = far_plaza
        inf["lmrect"] = lmrect
        inf["lm"] = lm
        inf["plaza_r"] = pr
        inf["line"] = line
        inf["mid"] = min(line, key=lambda p: math.hypot(p[0] - cx, p[1] - cz))
        inf["conn"] = conn
        # 枝道: 主な通りの両側へ、branchEvery ごとに交互
        L0 = polyline_len(line)
        be = th.get("branchEvery", 60)
        s = be * 0.6
        side = 1
        while s < L0 - 30:
            P, T = point_at(line, s)
            if math.hypot(P[0] - inf["mid"][0], P[1] - inf["mid"][1]) < pr + 8:
                s += be * 0.5
                continue
            nx, nz = -T[1] * side, T[0] * side
            bp = [P]
            k = 3.0
            while k < 130:
                x, z = P[0] + nx * k, P[1] + nz * k
                if not inside(x, z, poly, 8) or ell_hit(x, z) or any(math.hypot(x - c[0], z - c[1]) < c[2] for c in circles):
                    break
                k += 3
            if k > 28:
                bp.append((P[0] + nx * (k - 3), P[1] + nz * (k - 3)))
                inf["paths"].append({"pts": [[rl(p[0]), rl(p[1])] for p in bp], "w": th.get("branchW", 6), "main": False, "k": "stone", "exist": False})
            s += be
            side = -side
        # 広場 (遠い端・中ほど)
        inf["plazas"].append({"x": rl(far_plaza[0]), "z": rl(far_plaza[1]), "r": pr, "far": True})
        if math.hypot(inf["mid"][0] - far_plaza[0], inf["mid"][1] - far_plaza[1]) > 2 * pr + 20:
            inf["plazas"].append({"x": rl(inf["mid"][0]), "z": rl(inf["mid"][1]), "r": round(pr * 0.7, 1), "far": False})
        # 門: 入口の道がエリアに入る所
        pp = conn[0]["pts"]
        ordered = pp if conn[1] == pp[-1] else pp[::-1]
        arch = None
        total_p = polyline_len(ordered)
        for k in range(0, int(total_p), 1):
            P, T = point_at(ordered, k)
            if inpoly(P[0], P[1], poly):
                arch = (P, T)
                break
        if arch is None:
            arch = (ordered[-1], (1.0, 0.0))
        inf["arch"] = arch
        inf["archw"] = conn[0]["width"]
        for pth in inf["paths"]:
            if not pth["exist"]:
                inner.append((pth["pts"], pth["w"] / 2))
        for pl in inf["plazas"]:
            circles.append((pl["x"], pl["z"], pl["r"] + 2))

    # ---- 特別な物 (広場の中心・脇): volcano など ----
    for name, inf in info.items():
        th = inf["th"]
        rng = inf["rng"]
        poly = inf["poly"]
        for f in th.get("features", []):
            at = f["at"]
            if at == "far" and inf["far"]:
                kind = f["kind"]
                r = {"volcano": 11.0, "lighthouse": 3.5, "pad": inf["plaza_r"] * 0.85}.get(kind, 6.0)
                out["props"].append({"k": kind, "x": rl(inf["far"][0]), "z": rl(inf["far"][1]), "r": r, "yaw": 0.0, "a": inf["ai"]})
                circles.append((inf["far"][0], inf["far"][1], r + 1))
            elif at == "side":
                kind = f["kind"]
                cnt = {"rocks": 4, "mushrooms": 4, "lollipops": 4, "graves": 1, "galleon": 1}.get(kind, 1)
                rad = {"rocks": 7.0, "mushrooms": 7.0, "lollipops": 8.0, "graves": 17.0, "galleon": 16.0}.get(kind, 8.0)
                got = 0
                for _ in range(400):
                    if got >= cnt:
                        break
                    x = rng.uniform(min(q[0] for q in poly), max(q[0] for q in poly)); z = rng.uniform(min(q[1] for q in poly), max(q[1] for q in poly))
                    if not pt_ok(x, z, poly, rad + 3, rad + 4):
                        continue
                    # 近くの道 (45 m 以内) に向ける
                    best = None
                    for pts, hw in inner + park_paths:
                        for i in range(len(pts) - 1):
                            d = seg_dist(x, z, pts[i], pts[i + 1])
                            if best is None or d < best[0]:
                                best = (d, pts[i], pts[i + 1])
                    if best is None or best[0] > 55:
                        continue
                    if any(math.hypot(x - c[0], z - c[1]) < rad + c[2] for c in circles):
                        continue
                    # 道の最も近い点
                    a, b = best[1], best[2]
                    ex, ez = b[0] - a[0], b[1] - a[1]
                    t = max(0, min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez or 1e-9)))
                    q = (a[0] + ex * t, a[1] + ez * t)
                    yaw = math.atan2(q[0] - x, q[1] - z)
                    out["props"].append({"k": kind, "x": rl(x), "z": rl(z), "r": rad, "yaw": rl(yaw), "a": inf["ai"], "n": rng.randint(0, 9999)})
                    circles.append((x, z, rad))
                    got += 1
                if got < cnt:
                    print(f"警告: {name} の {kind} が {got}/{cnt} しか置けなかった")

    # ---- 建物 ----
    def make_building(inf, x, z, yaw, w, d, h, wall=None, color=None, roof=None, rcol=None, rh=None, nm=None, shop=None, lm=None, rows_roof_sign=True):
        th, rng = inf["th"], inf["rng"]
        b = {"a": inf["ai"], "x": rl(x), "z": rl(z), "yaw": rl(yaw), "w": rl(w), "d": rl(d), "h": rl(h), "fh": th["fh"], "bay": th["bay"]}
        b["wall"] = wall if wall is not None else rng.choice(th["wall"])
        b["col"] = color or rng.choice(th["colors"])
        b["trim"] = th.get("trim", "#ffffff")
        rk = roof or pick(rng, th["roofs"])
        b["roof"] = rk
        b["rcol"] = rcol or rng.choice(th["roofColors"])
        pitch = {"flat": 0, "gable": 0.5, "gablefront": 0.85, "hip": 0.6, "cone": 0.9}[rk]
        b["rh"] = rl(rh if rh is not None else max(0.0, pitch * min(w, d) / 2 * (1.0 if rk != "cone" else 1.6)))
        if (shop if shop is not None else th.get("shop")):
            b["shop"] = True
            b["door"] = th.get("door", "#7f6ad9")
            if th.get("awning"):
                b["awn"] = [rng.choice(th["awning"]), th["awning"][(1 if len(th["awning"]) > 1 else 0)]]
                b["awn"] = list(th["awning"][:2]) if th["kind"] in ("harbor", "sweet") else [rng.choice(th["awning"]), "#ffffff"]
        names = th["names"]
        if nm is None:
            idx = rng.randrange(len(names))
            nm = names[idx]
            scheme = th["signs"][idx % len(th["signs"])]
        else:
            scheme = th["signs"][0]
        text = nm.format(**short)
        b["sign"] = sign(text, scheme)
        if rng.random() < th.get("roofSign", 0) and rk == "flat":
            b["roofSign"] = sign(rng.choice(names).format(**short), th["signs"][rng.randrange(len(th["signs"]))])
        if th.get("towerChance", 0) and rng.random() < th["towerChance"] and rk != "flat":
            b["tower"] = {"side": rng.choice([-1, 1]), "r": rl(min(w, d) * 0.28), "h": rl(h + rng.uniform(3, 6)), "rh": rl(min(w, d) * 0.4)}
        if lm:
            b.update({k: lm[k] for k in ("clock", "towers") if k in lm})
            b["sign"] = sign(lm["name"].format(**short), th["signs"][0])
            b["lm"] = True
            b["roofSign"] = b.get("roofSign") if lm.get("clock") else None
            if b["roofSign"] is None:
                del b["roofSign"]
        return b

    def add(b, inf):
        out["buildings"].append(b)
        placed.append((b["x"], b["z"], b["yaw"], b["w"] / 2, b["d"] / 2))

    for name, inf in info.items():
        th, rng, poly = inf["th"], inf["rng"], inf["poly"]
        lm = inf.get("lm")
        if lm and inf.get("lmrect"):
            r = inf["lmrect"]
            add(make_building(inf, r[0], r[1], r[2], lm["w"], lm["d"], lm["h"], lm["wall"], lm["color"], lm["roof"], lm["roofColor"], lm.get("roofH"), lm=lm, shop=False), inf)
        elif lm:
            print(f"警告: {name} の特別な建物 (landmark) が置けなかった")
        # 並び: 道の両側
        for pth in inf["paths"]:
            if pth["pts"] is None or (not pth["main"] and not th["kind"] in ("avenue",) and polyline_len(pth["pts"]) < 20):
                continue
            pts = pth["pts"]
            Ltot = polyline_len(pts)
            for side in (-1, 1):
                for row in range(th.get("rows", 1)):
                    s = 32.0 if th["kind"] == "avenue" else 6.0
                    while s < Ltot - 6:
                        w = rng.uniform(*th["w"]); d = rng.uniform(*th["d"]); h = rng.uniform(*th["h"])
                        w = round(w * 2) / 2; d = round(d * 2) / 2
                        h = round(h / th["fh"]) * th["fh"] if th["kind"] in ("avenue", "town") else h
                        P, T = point_at(pts, s + w / 2)
                        nx, nz = -T[1] * side, T[0] * side
                        off = pth["w"] / 2 + th["setback"] + (row * (th["d"][1] + th.get("rowGap", 6)))
                        c = (P[0] + nx * (off + d / 2), P[1] + nz * (off + d / 2))
                        yaw = math.atan2(-nx, -nz)
                        r = (c[0], c[1], yaw, w / 2, d / 2)
                        if rect_ok(r, poly, pm=min(2.0, th["setback"] - 1.0), margin=1.2, skip=None):
                            add(make_building(inf, c[0], c[1], yaw, w, d, h), inf)
                            s += w + rng.uniform(*th["gap"])
                        else:
                            s += 3.0
        # 散らし: 道に面して、空いている所に
        cnt = th.get("scatter", 0)
        got = 0
        allp = [(p["pts"], p["w"] / 2) for p in inf["paths"]]
        for _ in range(cnt * 25):
            if got >= cnt:
                break
            x = rng.uniform(min(q[0] for q in poly), max(q[0] for q in poly)); z = rng.uniform(min(q[1] for q in poly), max(q[1] for q in poly))
            if not inside(x, z, poly, 8):
                continue
            best = None
            for pts, hw in allp:
                for i in range(len(pts) - 1):
                    dd = seg_dist(x, z, pts[i], pts[i + 1])
                    if best is None or dd < best[0]:
                        a, b = pts[i], pts[i + 1]
                        ex, ez = b[0] - a[0], b[1] - a[1]
                        t = max(0, min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez or 1e-9)))
                        best = (dd, (a[0] + ex * t, a[1] + ez * t))
            if best is None or best[0] > 60 or best[0] < 12:
                continue
            w = round(rng.uniform(*th["scatterW"]) * 2) / 2; d = round(rng.uniform(*th["scatterD"]) * 2) / 2; h = rng.uniform(*th["scatterH"])
            yaw = math.atan2(best[1][0] - x, best[1][1] - z)
            r = (x, z, yaw, w / 2, d / 2)
            if rect_ok(r, poly, pm=3.0, margin=3.0):
                add(make_building(inf, x, z, yaw, w, d, h), inf)
                got += 1

    # ---- 広場の植え込み・街灯・ベンチ・門 ----
    for name, inf in info.items():
        th, rng, poly = inf["th"], inf["rng"], inf["poly"]
        for pl in inf["plazas"]:
            out["plazas"].append({"a": inf["ai"], "x": pl["x"], "z": pl["z"], "r": pl["r"], "far": pl["far"], "feat": any(p["k"] in ("volcano", "lighthouse", "pad") and abs(p["x"] - pl["x"]) < 1 and abs(p["z"] - pl["z"]) < 1 for p in out["props"])})
            if th["kind"] == "avenue":
                continue
            n = max(6, int(pl["r"] * 0.55))
            for k in range(n):
                a = k / n * 2 * math.pi
                R = pl["r"] * 0.86
                x, z = pl["x"] + math.cos(a) * R, pl["z"] + math.sin(a) * R
                if path_clear(x, z, 2.5) and not any(obb_overlap((x, z, 0, 1, 1), q, 0.5) for q in placed):
                    out["beds"].append([rl(x), rl(z), rl(a + math.pi / 2), 1.6, 0.7, rng.randrange(len(th["signs"])), inf["ai"]])
        for pth in inf["paths"]:
            if pth["exist"]:
                continue
            out["paths"].append({"a": inf["ai"], "w": pth["w"], "pts": pth["pts"], "k": pth["k"]})
        # 街灯・ベンチ (主な通り)
        for pth in inf["paths"]:
            if not pth["main"] or th["kind"] == "avenue":
                continue
            pts = pth["pts"]
            Lt = polyline_len(pts)
            s, side = 10.0, 1
            i = 0
            while s < Lt - 6:
                P, T = point_at(pts, s)
                x, z = P[0] - T[1] * side * (pth["w"] / 2 + 1.3), P[1] + T[0] * side * (pth["w"] / 2 + 1.3)
                if inside(x, z, poly, 3) and not any(obb_overlap((x, z, 0, 0.4, 0.4), q, 0.8) for q in placed) and not any(math.hypot(x - c[0], z - c[1]) < c[2] for c in circles if c[2] < 40 and False):
                    out["lamps"].append([rl(x), rl(z), inf["ai"]])
                    if i % 3 == 1:
                        bx, bz = P[0] + T[1] * side * (pth["w"] / 2 + 1.0), P[1] - T[0] * side * (pth["w"] / 2 + 1.0)
                        if inside(bx, bz, poly, 3) and not any(obb_overlap((bx, bz, 0, 1.2, 0.6), q, 0.5) for q in placed):
                            out["benches"].append([rl(bx), rl(bz), rl(math.atan2(T[1] * side, -T[0] * side)), inf["ai"]])
                side = -side
                s += 22.0
                i += 1
        # 門
        if "arch" in inf:
            P, T = inf["arch"]
            span = inf["archw"] + 6
            sg = sign(name, th["signs"][0])
            out["arches"].append({"a": inf["ai"], "x": rl(P[0]), "z": rl(P[1]), "yaw": rl(math.atan2(T[0], T[1])), "span": rl(span), "h": 7.5 if span < 18 else 8.5, "sign": sg})
        elif th["kind"] == "avenue":
            av = inf["paths"][0]["pts"]
            P, T = point_at(av, 26.0)
            sg = sign(name, th["signs"][0])
            out["arches"].append({"a": inf["ai"], "x": rl(P[0]), "z": rl(P[1]), "yaw": rl(math.atan2(T[0], T[1])), "span": rl(av_w(av, cfg) + 6), "h": 9.5, "sign": sg})

    # ---- 木 ----
    for name, inf in info.items():
        th, rng, poly = inf["th"], inf["rng"], inf["poly"]
        tr = th.get("trees", {})
        if not tr.get("perHa"):
            continue
        target = int(poly_area(poly) / 10000 * tr["perHa"])
        got = 0
        mn = min(q[0] for q in poly), min(q[1] for q in poly), max(q[0] for q in poly), max(q[1] for q in poly)
        for _ in range(target * 12):
            if got >= target:
                break
            x, z = rng.uniform(mn[0], mn[2]), rng.uniform(mn[1], mn[3])
            if not pt_ok(x, z, poly, 3, 2.0):
                continue
            if any(obb_overlap((x, z, 0, 0.6, 0.6), q, 1.6) for q in placed):
                continue
            if any(math.hypot(x - c[0], z - c[1]) < c[2] + 1 for c in circles) or any(math.hypot(x - t[0], z - t[1]) < 4.5 for t in tree_pts):
                continue
            tree_pts.append((x, z))
            out["trees"].append([rl(x), rl(z), pick(rng, tr["kinds"]), rl(rng.uniform(0.8, 1.3)), inf["ai"]])
            got += 1

    # ---- 乗り物 (段階 3)。乱数は使わない (ここより前の出力は変わらない) ----
    out["rides"] = make_rides(cfg, A.get("rides"), info, out, site, ellipses, circles, inner, park_paths, ell_hit, path_clear)
    return out


def make_rides(cfg, R, info, out, site, ellipses, circles, inner, park_paths, ell_hit, path_clear):
    """観覧車 (台座の上)・メリーゴーラウンド (近い広場)・コースター (エリアの外の空き地)。"""
    rides = {}
    if not R:
        return rides
    allpaths = park_paths + inner + [(p["pts"], p["w"] / 2) for inf in info.values() for p in inf["paths"]]

    def nearest_path_pt(x, z):
        best = None
        for pts, hw in allpaths:
            for i in range(len(pts) - 1):
                d = seg_dist(x, z, pts[i], pts[i + 1])
                if best is None or d < best[0]:
                    a, b = pts[i], pts[i + 1]
                    ex, ez = b[0] - a[0], b[1] - a[1]
                    t = max(0, min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez or 1e-9)))
                    best = (d, (a[0] + ex * t, a[1] + ez * t))
        return best

    # 観覧車: 台座 (pad) の上。のりばは近い道の側
    f = R.get("ferris")
    if f:
        pad = next((q for q in out["props"] if q["k"] == "pad" and out["areas"][q["a"]]["name"] == f["area"]), None)
        if pad is None:
            sys.exit("park_areas: 観覧車の台座 (pad) が無い")
        d, q = nearest_path_pt(pad["x"], pad["z"])
        yaw = math.atan2(q[0] - pad["x"], q[1] - pad["z"])
        rides["ferris"] = {"x": pad["x"], "z": pad["z"], "yaw": rl(yaw), "R": f["R"], "hub": f["hub"], "cars": f["cars"], "rev": f["rev"], "a": pad["a"]}

    # メリーゴーラウンド: そのエリアの、遠くない方の広場の中心
    c = R.get("carousel")
    if c:
        ai = next(i for i, a in enumerate(out["areas"]) if a["name"] == c["area"])
        pl = next((p for p in out["plazas"] if p["a"] == ai and not p["far"]), None)
        if pl is None:
            sys.exit("park_areas: メリーゴーラウンドの広場が無い")
        d, q = nearest_path_pt(pl["x"], pl["z"])
        rides["carousel"] = {"x": pl["x"], "z": pl["z"], "yaw": rl(math.atan2(q[0] - pl["x"], q[1] - pl["z"])), "R": c["R"], "a": ai}

    # コースター: 形の輪を、エリアの外・湖・道・敷地の縁から離れた空き地に置く。near の中心に近い順に、向きを変えて試す
    k = R.get("coaster")
    if k:
        shape, clear = k["shape"], k.get("clear", 7)
        dense = []
        for i in range(len(shape)):
            a, b = shape[i], shape[(i + 1) % len(shape)]
            n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / 4))
            for j in range(n):
                dense.append((a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n))
        near = cfg["areas"][k["near"]]
        ncx, ncz = sum(q[0] for q in near) / len(near), sum(q[1] for q in near) / len(near)
        area_polys = [a for n, a in cfg["areas"].items() if not n.startswith("_")]
        xs, zs = [q[0] for q in site], [q[1] for q in site]
        cands = []
        for cx in range(int(min(xs)), int(max(xs)), 6):
            for cz in range(int(min(zs)), int(max(zs)), 6):
                for deg in range(0, 180, 15):
                    cands.append((math.hypot(cx - ncx, cz - ncz), cx, cz, deg))
        cands.sort()
        chosen = None
        for dist, cx, cz, deg in cands:
            yaw = math.radians(deg)
            cs, sn = math.cos(yaw), math.sin(yaw)
            ok = True
            for u, v in dense:
                x, z = cx + u * cs + v * sn, cz - u * sn + v * cs
                if not inside(x, z, site, 12) or ell_hit(x, z, 4.0) or any(math.hypot(x - c0[0], z - c0[1]) < c0[2] + 4 for c0 in circles) or not path_clear(x, z, 5.0):
                    ok = False
                    break
                if any(inpoly(x, z, ap) or poly_edge_dist(x, z, ap) < clear for ap in area_polys):
                    ok = False
                    break
            if ok:
                chosen = (cx, cz, yaw)
                break
        if chosen is None:
            sys.exit("park_areas: コースターを置ける空き地が無い")
        cx, cz, yaw = chosen
        cs, sn = math.cos(yaw), math.sin(yaw)
        pts = [[rl(cx + u * cs + v * sn), rl(cz - u * sn + v * cs), h] for u, v, h in shape]
        rides["coaster"] = {"name": k["name"], "x": cx, "z": cz, "yaw": rl(yaw), "pts": pts, "liftIdx": k["liftIdx"], "stationIdx": k["stationIdx"], "near": k["near"]}
    return rides


def av_w(av, cfg):
    return next(p["width"] for p in cfg["paths"] if p["pts"] == av)


def stats(gen):
    names = [a["name"] for a in gen["areas"]]
    rows = []
    for i, n in enumerate(names):
        rows.append(f"  {n}: 建物 {sum(1 for b in gen['buildings'] if b['a'] == i)}・木 {sum(1 for t in gen['trees'] if t[4] == i)}・道 {sum(1 for p in gen['paths'] if p['a'] == i)}・広場 {sum(1 for p in gen['plazas'] if p['a'] == i)}・街灯 {sum(1 for p in gen['lamps'] if p[2] == i)}・植え込み {sum(1 for p in gen['beds'] if p[6] == i)}・特別な物 {sum(1 for p in gen['props'] if p['a'] == i)}")
    rd = gen.get("rides", {})
    if rd:
        k = rd.get("coaster")
        rows.append("  乗り物: " + "・".join(n for n in ("観覧車" if "ferris" in rd else "", "メリーゴーラウンド" if "carousel" in rd else "", f"コースター（{k['name']}、輪の中心 {k['x']:.0f}, {k['z']:.0f}、点 {len(k['pts'])}）" if k else "") if n))
    return f"建物 {len(gen['buildings'])}・木 {len(gen['trees'])}・看板 {len(gen['signs'])}・門 {len(gen['arches'])}\n" + "\n".join(rows)


def plot(cfg, gen, path):
    from PIL import Image, ImageDraw
    S = 1.6
    x0, z0 = 30900, -26050
    im = Image.new("RGB", (int(1200 * S), int(850 * S)), "white")
    g = ImageDraw.Draw(im)
    P = lambda p: ((p[0] - x0) * S, (p[1] - z0) * S)
    g.polygon([P(p) for p in cfg["site"]], outline="black")
    for n, a in cfg["areas"].items():
        if not n.startswith("_"):
            g.polygon([P(p) for p in a], outline="#bbb")
    for n, e in cfg["ellipses"].items():
        c = e["center"]
        g.ellipse([*P((c[0] - e["rx"], c[1] - e["rz"])), *P((c[0] + e["rx"], c[1] + e["rz"]))], outline="blue")
    for p in cfg["paths"]:
        g.line([P(q) for q in p["pts"]], fill="#999", width=max(2, int(p["width"] * S)))
    for p in gen["paths"]:
        g.line([P(q) for q in p["pts"]], fill="#bbb", width=max(2, int(p["w"] * S)))
    for p in gen["plazas"]:
        g.ellipse([*P((p["x"] - p["r"], p["z"] - p["r"])), *P((p["x"] + p["r"], p["z"] + p["r"]))], outline="orange", fill="#fed")
    cols = ["#e44", "#48e", "#2a2", "#a4a", "#0aa", "#e90", "#444"]
    for b in gen["buildings"]:
        cs = corners(b["x"], b["z"], b["yaw"], b["w"] / 2, b["d"] / 2)
        g.polygon([P(c) for c in cs], outline=cols[b["a"] % 7], fill=cols[b["a"] % 7])
        f = (b["x"] + math.sin(b["yaw"]) * b["d"] / 2, b["z"] + math.cos(b["yaw"]) * b["d"] / 2)
        g.line([P((b["x"], b["z"])), P(f)], fill="white", width=1)
    for t in gen["trees"]:
        g.ellipse([*P((t[0] - 1.5, t[1] - 1.5)), *P((t[0] + 1.5, t[1] + 1.5))], fill="#6a6")
    for p in gen["props"]:
        g.ellipse([*P((p["x"] - p["r"], p["z"] - p["r"])), *P((p["x"] + p["r"], p["z"] + p["r"]))], outline="red")
    for a in gen["arches"]:
        g.ellipse([*P((a["x"] - 3, a["z"] - 3)), *P((a["x"] + 3, a["z"] + 3))], fill="magenta")
    rd = gen.get("rides", {})
    if "coaster" in rd:
        pts = [P(q) for q in rd["coaster"]["pts"]]
        g.line(pts + [pts[0]], fill="#d00", width=3)
    for key, r in (("ferris", 13.5), ("carousel", 7.4)):
        if key in rd:
            g.ellipse([*P((rd[key]["x"] - r, rd[key]["z"] - r)), *P((rd[key]["x"] + r, rd[key]["z"] + r))], outline="#d00", width=3)
    im.save(path)


if __name__ == "__main__":
    cfg = json.loads((ROOT / "data" / "park.json").read_text(encoding="utf-8"))
    gen = generate(cfg)
    print(stats(gen))
    if "--plot" in sys.argv:
        plot(cfg, gen, sys.argv[sys.argv.index("--plot") + 1])
