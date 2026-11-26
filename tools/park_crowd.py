"""千葉ドリームランド 段階 5: 園内を歩く人の通り道 (crowd) と、地図の印・ワープ先 (spots) を作る。tools/park.py が呼ぶ (public/data/park.json の crowd・spots)。

通り道 (crowd.lanes): 園内の道 (設定の paths・各エリアの内側の道 gen.paths)・湖のまわりの散歩道・サンライズ・プラザの輪と放射状の道を、
  道どうしの交わる所で切ってつなぐ (T 字・十字の交差で人が引き返さないように。切るのは「道の端が別の道の 6 m 以内」のとき)。
  輪は 2 本の半円にして、つなぎ目で人が引き返さないようにする。決まった乱数は使わない (設定だけから決まる)。
  使う側: public/src/crowdsim.js (街を歩く人の仕組みを流用。k = 'p' の通り道は園内用)、public/src/crowd.js。
地図の印・ワープ先 (spots): ゲート・サンライズ・プラザ・観覧車・コースター・ムーンレイク・7 エリア。位置は必ず通り道の上の点 (建物・木の上ではない。
  ワープ先は、遠くから跳んだときに園内がまだ読み込まれていなくても、建物の中に出ないように通り道の点にする)。
    python tools/park_crowd.py --plot 出力.png   平面図 (通り道・つなぎ目・印)
"""
import json
import math
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

TOL = 6.0      # 道の端が別の道の中にあるとき、その道を切ってつなぐ距離 (m)
TOL_RING = 16.0  # 相手が湖の散歩道・プラザの輪のとき (設計上、道は輪の手前の縁で終わる。湖の岸の傾斜 14 m + 道の幅の半分)
END_KEEP = 3.0  # 別の道の端から、これより近い所では切らない (端どうしのつなぎで足りる)


def rl(v):
    return round(v, 1)


def seg_proj(px, pz, a, b):
    ex, ez = b[0] - a[0], b[1] - a[1]
    l2 = ex * ex + ez * ez or 1e-9
    t = max(0.0, min(1.0, ((px - a[0]) * ex + (pz - a[1]) * ez) / l2))
    return t, (a[0] + ex * t, a[1] + ez * t)


def seg_dist(px, pz, a, b):
    q = seg_proj(px, pz, a, b)[1]
    return math.hypot(px - q[0], pz - q[1])


def poly_len(p):
    return sum(math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]) for i in range(len(p) - 1))


def ell(c, rx, rz, a0, a1, n):
    return [(c[0] + rx * math.cos(a0 + (a1 - a0) * k / n), c[1] + rz * math.sin(a0 + (a1 - a0) * k / n)) for k in range(n + 1)]


def weave(lanes):
    """道の端が別の道の中 (端から END_KEEP 以上離れた所) の TOL m 以内にあれば、その道を切って端をそこへそろえる。切って増えた道の端も調べる (全部を 1 回ずつ)"""
    ai = 0
    while ai < len(lanes):
        A = lanes[ai]
        for e in (0, -1):
            E = A["p"][e]
            best = None
            for bi, B in enumerate(lanes):
                if bi == ai:
                    continue
                tol = TOL_RING if B["n"] in ("promenade", "plaza") else TOL
                for i in range(len(B["p"]) - 1):
                    t, q = seg_proj(E[0], E[1], B["p"][i], B["p"][i + 1])
                    d = math.hypot(E[0] - q[0], E[1] - q[1])
                    if d < tol and (best is None or d < best[0]):
                        best = (d, bi, i, q)
            if best is None:
                continue
            d, bi, i, q = best
            B = lanes[bi]
            s_q = poly_len(B["p"][: i + 1]) + math.hypot(q[0] - B["p"][i][0], q[1] - B["p"][i][1])
            if s_q < END_KEEP or poly_len(B["p"]) - s_q < END_KEEP:
                continue     # B の端に近い = 端どうしでつながる (crowdsim の JOIN 9 m)
            A["p"][e] = q
            lanes[bi] = {**B, "p": B["p"][: i + 1] + [q]}
            lanes.append({**B, "p": [q] + B["p"][i + 1:]})
        ai += 1
    return lanes


def generate(out):
    """out = park.py が作った公開用の設定 (paths・ellipses・promenade・gen を持つ)。{ "crowd": {...}, "spots": [...] } を返す"""
    lanes = []
    add = lambda pts, w, name="": lanes.append({"p": [tuple(q) for q in pts], "w": w, "n": name})
    for p in out["paths"]:
        add(p["pts"], p["width"], p["name"])
    for p in out["gen"]["paths"]:
        add(p["pts"], p["w"], f"area{p['a']}")
    pl = out["ellipses"]["サンライズ・プラザ"]
    c, rx, rz = pl["center"], pl["rx"], pl["rz"]
    pr = out["promenade"]
    lk = out["ellipses"][pr["ellipse"]]
    # 湖のまわりの散歩道 (半円 2 本。南北の端で切る)
    for a0, a1 in ((0, math.pi), (math.pi, 2 * math.pi)):
        add(ell(lk["center"], lk["rx"] + pr["offset"], lk["rz"] + pr["offset"], a0, a1, 72), pr["width"], "promenade")
    # プラザの輪 (外側 0.9 と内側 0.58。半円 2 本ずつ) と、放射状の道 (道が入る所から中心の輪まで)
    for r in (0.9, 0.58):
        for a0, a1 in ((0, math.pi), (math.pi, 2 * math.pi)):
            add(ell(c, rx * r, rz * r, a0, a1, 40), 10, "plaza")
    for p in list(out["paths"]):
        for q in (p["pts"][0], p["pts"][-1]):
            rho = math.hypot((q[0] - c[0]) / rx, (q[1] - c[1]) / rz)
            if 0.85 < rho < 1.12:      # プラザの縁に入る道 → 外側の輪まで、内側の輪まで、延ばす
                a = math.atan2((q[1] - c[1]) / rz, (q[0] - c[0]) / rx)
                P = lambda r: (c[0] + rx * r * math.cos(a), c[1] + rz * r * math.sin(a))
                add([q, P(0.9)], 8, "spoke")
                add([P(0.9), P(0.58)], 8, "spoke")
    # 小さな広場 (各エリアの広場) の周りを回る輪。道の端は広場の中心で終わるので、輪の半径は TOL 未満 (5 m。端が輪へ寄ってつながる)
    for q in out["gen"]["plazas"]:
        if q["r"] >= 9.5:
            for a0, a1 in ((0, math.pi), (math.pi, 2 * math.pi)):
                add(ell((q["x"], q["z"]), 5.0, 5.0, a0, a1, 10), 6, "square")
    # 段階 9: 城 (リール・キャッスル)。堤道 → 門塔のトンネル → 中庭 → 裏の門 → 裏の堤道を歩ける。局所座標 (lx 右・lz 前) をワールドに直す
    cas = out.get("castle")
    if cas:
        cyaw, ccx, ccz = cas["yaw"], cas["center"][0], cas["center"][1]
        CW = lambda lx, lz: (ccx + lx * math.cos(cyaw) + lz * math.sin(cyaw), ccz - lx * math.sin(cyaw) + lz * math.cos(cyaw))
        add([CW(0, 86), CW(0, 60), CW(0, 40), CW(0, 28), CW(0, 14)], 8, "castle")        # 前の堤道 → 門のトンネル → 中庭
        add([CW(-36, 14), CW(0, 14), CW(36, 14)], 6, "castle")                           # 中庭を横切る道
        add([CW(0, -86), CW(0, -60), CW(0, -40), CW(0, -27)], 8, "castle")                # 裏の堤道 → 裏の門 (裏庭)
    # 入口 (entrance): 柵の隙間から前庭の中央の通路 (切符売り場の間) を通り、改札のレーンを通って内庭の入口の中心 (gate.at) へ。左右 3 レーンずつ。
    # 局所座標 (u = 右、v = 外) → ワールドは detail/parkentrancegeo.js と同じ。道が切符売り場・案内所・築山を通らないよう、waypoint を決めてある
    ent = out.get("entrance")
    EW = None
    if ent:
        gx0, gz0 = out["gate"]["at"]
        fx0, fz0 = out["gate"]["face"]
        EW = lambda u, v: (gx0 + fz0 * u + fx0 * v, gz0 - fx0 * u + fz0 * v)
        Hh = ent["hall"]
        gap = out["fence"]["gaps"][0]
        for s in (-1, 1):
            for k in (2, 7, 12):
                u = s * (Hh["laneFrom"] + (k + 0.5) * Hh["pitch"])
                add([tuple(gap), EW(-4, 44), EW(0, 31), EW(u, 29), EW(u, 20), EW(u, 8), EW(u * 0.5, 8), EW(0, 0)], 1.6, "entrance")
    lanes = weave(lanes)
    lanes = [L for L in lanes if poly_len(L["p"]) >= 3]
    lane_out = []
    for L in lanes:
        flat = []
        for x, z in L["p"]:
            flat += [rl(x), rl(z)]
        lane_out.append({"k": "p", "w": L["w"], "p": flat})

    # ---- 印・ワープ先 (通り道の点。2 m おきの点のうち、建物・木・植え込み・街灯・ベンチ・特別な物・乗り物・塔・湖から離れた所) ----
    gen = out["gen"]
    rd = gen.get("rides", {})
    lake_e = out["ellipses"][out["promenade"]["ellipse"]]

    def obb_in(b, x, z, m):
        dx, dz = x - b["x"], z - b["z"]
        c, sn = math.cos(b["yaw"]), math.sin(b["yaw"])
        return abs(dx * c - dz * sn) < b["w"] / 2 + m and abs(dx * sn + dz * c) < b["d"] / 2 + m

    def clear(x, z):
        if any(abs(b["x"] - x) < 45 and abs(b["z"] - z) < 45 and obb_in(b, x, z, 2.5) for b in gen["buildings"]):
            return False
        if any(math.hypot(t[0] - x, t[1] - z) < 2.5 for t in gen["trees"]):
            return False
        if any(math.hypot(q[0] - x, q[1] - z) < 3.0 for q in gen["beds"]) or any(math.hypot(q[0] - x, q[1] - z) < 1.6 for q in gen["lamps"]) or any(math.hypot(q[0] - x, q[1] - z) < 2.6 for q in gen["benches"]):
            return False
        if any(math.hypot(q["x"] - x, q["z"] - z) < q["r"] + 3 for q in gen["props"]):
            return False
        for key, extra in (("ferris", 6.0), ("carousel", 4.0)):
            if key in rd and math.hypot(rd[key]["x"] - x, rd[key]["z"] - z) < rd[key]["R"] + extra:
                return False
        if "coaster" in rd:
            cp = [q[:2] for q in rd["coaster"]["pts"]]
            if min(seg_dist(x, z, cp[i], cp[(i + 1) % len(cp)]) for i in range(len(cp))) < 8:    # コースターの柱・レール
                return False
        if math.hypot(x - out["tower"]["at"][0], z - out["tower"]["at"][1]) < out["tower"]["radius"] + 5:
            return False
        if math.hypot((x - lake_e["center"][0]) / lake_e["rx"], (z - lake_e["center"][1]) / lake_e["rz"]) < 1.04:
            return False
        return True

    def dense(poly, step=2.0):
        pts_ = []
        for i in range(len(poly) - 1):
            a_, b_ = poly[i], poly[i + 1]
            n_ = max(1, int(math.hypot(b_[0] - a_[0], b_[1] - a_[1]) / step))
            pts_ += [(a_[0] + (b_[0] - a_[0]) * k / n_, a_[1] + (b_[1] - a_[1]) * k / n_) for k in range(n_)]
        return pts_ + [poly[-1]]

    pts = [q for L in lanes for q in dense(L["p"]) if clear(*q)]
    near = lambda x, z, dmin=0.0: min((q for q in pts if math.hypot(q[0] - x, q[1] - z) >= dmin), key=lambda q: math.hypot(q[0] - x, q[1] - z))
    gate = out["gate"]["at"]
    fx, fz = out["gate"]["face"]
    face_to = lambda x, z, tx, tz: round(math.atan2(tx - x, tz - z), 3)
    spots = []

    def spot(name, kind, x, z, tx, tz, tier, glyph, color):
        spots.append({"name": name, "kind": kind, "x": rl(x), "z": rl(z), "face": face_to(x, z, tx, tz), "tier": tier, "glyph": glyph, "color": color})

    if EW:   # 入口: ワープ先は前庭の中央 (改札の手前。大門の名前の板を見上げる)
        spot("ゲート", "gate", *EW(0, 44), *EW(0, -30), 0, "門", "#9b5de5")
    else:
        spot("ゲート", "gate", gate[0] - fx * 6, gate[1] - fz * 6, gate[0] - fx * 60, gate[1] - fz * 60, 0, "門", "#9b5de5")
    spot("サンライズ・プラザ", "plaza", c[0], c[1], lk["center"][0], lk["center"][1], 1, "広", "#f15bb5")
    # パレード: ネオン・アベニューの中ほど (山車はここを通る。出発の少し前から地図の印が点滅する)
    av = next(p for p in out["paths"] if p["name"] == out["show"]["parade"]["avenue"])
    avm = ((av["pts"][0][0] + av["pts"][-1][0]) / 2, (av["pts"][0][1] + av["pts"][-1][1]) / 2)
    spot("パレード（ネオン・アベニュー）", "parade", avm[0], avm[1], c[0], c[1], 1, "行", "#ff5fa2")
    rd = out["gen"].get("rides", {})
    if "ferris" in rd:
        f = rd["ferris"]
        q = near(f["x"], f["z"], f["R"] + 12)
        spot("観覧車", "ferris", q[0], q[1], f["x"], f["z"], 1, "輪", "#00bbf9")
    if "coaster" in rd:
        k = rd["coaster"]
        sx, sz = k["pts"][k["stationIdx"][0]][:2]
        q = near(sx, sz, 12)
        spot(k["name"], "coaster", q[0], q[1], sx, sz, 1, "速", "#ff6b35")
    # 城: 前の堤道の入口 (門の前の前庭。湖の中なので歩ける点を直接決める)
    if cas:
        sx, sz = CW(0, 56)
        spot("リール・キャッスル", "castle", sx, sz, cas["center"][0], cas["center"][1], 1, "城", "#6a55b8")
    # 湖: 北の岸の散歩道 (プラザ側)
    ring = ell(lk["center"], lk["rx"] + pr["offset"], lk["rz"] + pr["offset"], 0, 2 * math.pi, 144)
    nq = min(ring, key=lambda q: q[1])
    spot(pr["ellipse"] + "（花火）", "lake", nq[0], nq[1], lk["center"][0], lk["center"][1], 1, "湖", "#3a86ff")
    # 各エリア: そのエリアの内側の道でいちばん長い道の中ほど
    for i, a in enumerate(out["gen"]["areas"]):
        mine = [p for p in out["gen"]["paths"] if p["a"] == i and len(p["pts"]) >= 2]
        if not mine:
            continue
        p = max(mine, key=lambda p: poly_len(p["pts"]))
        dp = dense(p["pts"])
        mid = len(dp) // 2
        order = sorted(range(len(dp)), key=lambda k: abs(k - mid))     # 中ほどに近い点から順に、きれいな (障害物のない) 点を探す
        x, z = next((dp[k] for k in order if clear(*dp[k])), dp[mid])
        spot(a["name"], "area", x, z, c[0], c[1], 2, "街", "#8338ec")
    hubs = [[rl(c[0]), rl(c[1])], [rl(gate[0]), rl(gate[1])], [rl(lk["center"][0]), rl(lk["center"][1])]]
    return {"crowd": {"lanes": lane_out, "hubs": hubs}, "spots": spots}


def stats(r):
    ls = r["crowd"]["lanes"]
    tot = sum(poly_len([(L["p"][i], L["p"][i + 1]) for i in range(0, len(L["p"]) - 1, 2)]) for L in ls)
    return f"園内の通り道 {len(ls)} 本 (合計 約 {tot:.0f} m)・地図の印 {len(r['spots'])} か所"


def plot(out, r, path):
    from PIL import Image, ImageDraw
    S = 1.6
    x0, z0 = 30900, -26050
    im = Image.new("RGB", (int(1200 * S), int(850 * S)), "white")
    g = ImageDraw.Draw(im)
    P = lambda p: ((p[0] - x0) * S, (p[1] - z0) * S)
    g.polygon([P(p) for p in out["site"]], outline="black")
    for b in out["gen"]["buildings"]:
        cs = [(b["x"] + math.cos(b["yaw"]) * sx * b["w"] / 2 + math.sin(b["yaw"]) * sz * b["d"] / 2, b["z"] - math.sin(b["yaw"]) * sx * b["w"] / 2 + math.cos(b["yaw"]) * sz * b["d"] / 2) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        g.polygon([P(c) for c in cs], fill="#ddd", outline="#bbb")
    for L in r["crowd"]["lanes"]:
        pts = [P((L["p"][i], L["p"][i + 1])) for i in range(0, len(L["p"]), 2)]
        g.line(pts, fill="#2a6", width=2)
        for q in (pts[0], pts[-1]):
            g.ellipse([q[0] - 3, q[1] - 3, q[0] + 3, q[1] + 3], fill="#e33")
    for s in r["spots"]:
        q = P((s["x"], s["z"]))
        g.ellipse([q[0] - 7, q[1] - 7, q[0] + 7, q[1] + 7], fill=s["color"], outline="white")
        g.text((q[0] + 9, q[1] - 6), s["name"], fill="black")
    im.save(path)


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT / "tools"))
    import park
    cfg = json.loads(park.SRC.read_text(encoding="utf-8"))
    out = park.build(cfg)
    print(stats({"crowd": out["crowd"], "spots": out["spots"]}))
    if "--plot" in sys.argv:
        plot(out, {"crowd": out["crowd"], "spots": out["spots"]}, sys.argv[sys.argv.index("--plot") + 1])
