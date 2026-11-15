"""橋 (車道の橋・歩道橋・デッキ) と、そこへ上がる階段・スロープの高さ (roads の ys) を、点群の実測に合わせる。

使い方: python tools/deck_heights.py [--report]
入力:   public/data/city.json, public/data/terrain.json, data/raw/lidar_dsm.bin (fetch_lidar.py)
出力:   public/data/city.json (歩行者用の橋・坂の pts と ys を書き換える。高さが変わる所に頂点を足し、元の頂点の番号を base に控える)

build_city.py の compute_bridges() は「たもとを地面に固定して間をなめらかにつなぐ」推定なので、
実際は水平なデッキが全体に坂になり、階段の勾配もまちまちになる。ここで実測に置き換える。

やり方:
- 対象の道 (bridge = 橋。車道も含む / 歩行者用の ramp = 橋へ上がる坂) の中心線を 0.5 m ごとに測る (左右 ±1 m の中央値)
- 屋根・ひさし・建物を除く: 隣どうしで 1 m 以上飛ぶ所で面を分け、下の面より 1.8 m 以上高い面は屋根とみなす
- 橋の上で地面が写っている所 (細い橋と中心線のずれ) は「不明」にする。坂 (ramp) では地面とみなす
- 地面の道とつながる頂点は地面の高さに固定し、不明な所は両側からなめらかに補う
- 最後に、どの区間も勾配 0.8 以下になるよう高い側を削る (歩いて上れない段差を残さない)
- 測れなかった (屋根の下・建物の中) まとまりは、data/appearance.json の deck_levels で高さを指定できる
  {"x":, "z":, "r":, "y":}  (x, z) から r m 以内のデッキ (階段以外) の高さを y (ローカル座標の高さ) にする
同じ入力なら何度実行しても同じ結果になる (元の ys は使わない)。
"""
import json
import math
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CITY = ROOT / "public" / "data" / "city.json"
TERRAIN = ROOT / "public" / "data" / "terrain.json"
APPEARANCE = ROOT / "data" / "appearance.json"

PED = {"footway", "pedestrian", "path", "cycleway", "steps", "corridor"}
STEP = 0.5        # 測る間隔 (m)
LOW = 1.2         # 地面からこれ未満なら「地面が写っている」
BREAK = 1.0       # 隣の測点とこれ以上違えば別の面
ROOF = 1.8        # 下の面よりこれ以上高い面は屋根
TOO_HIGH = 16.0   # 地面からこれ以上は建物
TOL = 0.07        # 頂点を間引くときの高さの許容差 (m)
MAX_GRADE = 0.8   # 仕上がりの勾配の上限 (これより急だと、歩いて上れない段差になる)

key = lambda p: (round(p[0], 1), round(p[1], 1))


def terrain_sampler():
    T = json.loads(TERRAIN.read_text(encoding="utf-8"))
    nx, nz, step, x0, z0, h = T["nx"], T["nz"], T["step"], T["minX"], T["minZ"], T["h"]

    def H(x, z):
        fx = max(0, min(nx - 1.0001, (x - x0) / step)); fz = max(0, min(nz - 1.0001, (z - z0) / step))
        i, j = int(fx), int(fz); u, v = fx - i, fz - j
        g = lambda a, b: h[b * nx + a] / 100
        h00, h10, h01, h11 = g(i, j), g(i + 1, j), g(i, j + 1), g(i + 1, j + 1)
        return h00 + u * (h10 - h00) + v * (h11 - h10) if u >= v else h00 + v * (h01 - h00) + u * (h11 - h01)
    return H, T.get("ref", 0.0)


def median(v):
    s = sorted(v)
    return s[len(s) // 2] if len(s) % 2 else (s[len(s) // 2 - 1] + s[len(s) // 2]) / 2


def simplify(ds, ys, keep, tol):
    """(距離, 高さ) の折れ線を間引く。keep の番号は必ず残す"""
    out = set(keep) | {0, len(ds) - 1}
    stack = []
    ks = sorted(out)
    for a, b in zip(ks, ks[1:]):
        stack.append((a, b))
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        worst, wi = 0, None
        for i in range(a + 1, b):
            t = (ds[i] - ds[a]) / max(1e-9, ds[b] - ds[a])
            e = abs(ys[i] - (ys[a] + (ys[b] - ys[a]) * t))
            if e > worst:
                worst, wi = e, i
        if worst > tol:
            out.add(wi)
            stack.append((a, wi)); stack.append((wi, b))
    return sorted(out)


def inside_any(buildings):
    """(x, z) が建物の輪郭の中 (または 1.5 m 以内) かを返す関数"""
    boxes = []
    for b in buildings:
        o = b["outer"]
        boxes.append((min(p[0] for p in o) - 1.5, min(p[1] for p in o) - 1.5, max(p[0] for p in o) + 1.5, max(p[1] for p in o) + 1.5, o))

    def test(x, z):
        for x0, z0, x1, z1, o in boxes:
            if not (x0 <= x <= x1 and z0 <= z <= z1):
                continue
            ins = False
            for (ax, az), (bx, bz) in zip(o, o[1:] + o[:1]):
                if (az > z) != (bz > z) and x < ax + (bx - ax) * (z - az) / (bz - az):
                    ins = not ins
                ex, ez = bx - ax, bz - az
                t = max(0, min(1, ((x - ax) * ex + (z - az) * ez) / max(1e-9, ex * ex + ez * ez)))
                if math.hypot(x - ax - ex * t, z - az - ez * t) < 1.5:
                    return True
            if ins:
                return True
        return False
    return test


def apply(roads, H, ref, dsm, levels=(), report=False, in_building=lambda x, z: False):
    """roads を書き換える。戻り値は (直した道の数, 測れた測点の割合)"""
    # 対象: 橋 (車道も)、歩行者用の坂 (ramp)
    target = lambda r: r.get("bridge") or (r["kind"] in PED and r.get("ramp"))
    ways = [r for r in roads if target(r)]
    if not ways:
        return 0, 0.0
    ground_nodes = set()
    for r in roads:
        if not target(r):
            for p in r["pts"]:
                ground_nodes.add(key(p))
    bridge_nodes = set()
    for r in ways:
        if r.get("bridge"):
            for p in r["pts"]:
                bridge_nodes.add(key(p))

    def measure(x, z, ux, uz):
        vs = []
        for o in (-1.0, -0.5, 0.0, 0.5, 1.0):
            v = dsm.get(x - uz * o, z + ux * o)
            if v is not None:
                vs.append(v - ref)
        return median(vs) if vs else None

    # ---- 測点: 道ごとに (x, z, 道のり, 元の頂点か) を並べる。頂点を共有する道は同じ測点番号を使う
    S = []            # 測点: dict(x, z, g, v, fixed, steps)
    node_id = {}
    W = []            # 道ごと: dict(r, idx=[測点番号...], d=[道のり...], orig=[元の頂点の位置...])
    for r in ways:
        pts = r["pts"]
        idx, dd, orig = [], [], []
        d0 = 0.0
        for i, p in enumerate(pts):
            k = key(p)
            if k not in node_id:
                node_id[k] = len(S)
                S.append({"x": p[0], "z": p[1], "node": k, "vs": []})
            orig.append(len(idx)); idx.append(node_id[k]); dd.append(d0)
            if i == len(pts) - 1:
                break
            q = pts[i + 1]
            L = math.hypot(q[0] - p[0], q[1] - p[1])
            n = int(L / STEP)
            ux, uz = ((q[0] - p[0]) / L, (q[1] - p[1]) / L) if L > 1e-6 else (1, 0)
            for s in range(1, n + 1):
                t = s / (n + 1)
                x, z = p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t
                S.append({"x": x, "z": z, "node": None, "v": measure(x, z, ux, uz)})
                idx.append(len(S) - 1); dd.append(d0 + L * t)
            # 頂点そのものの測定は、両隣の向きで測って集める
            for k2, pp in ((k, p), (key(q), q)):
                v = measure(pp[0], pp[1], ux, uz)
                if k2 not in node_id:
                    node_id[k2] = len(S)
                    S.append({"x": pp[0], "z": pp[1], "node": k2, "vs": []})
                if v is not None:
                    S[node_id[k2]]["vs"].append(v)
            d0 += L
        W.append({"r": r, "idx": idx, "d": dd, "orig": orig, "steps": r["kind"] == "steps", "ramp": not r.get("bridge")})
    for s in S:
        s["g"] = H(s["x"], s["z"])
        if s["node"] is not None:
            s["v"] = median(s["vs"]) if s["vs"] else None
        s["raw"] = s["v"]
        s["nb"] = []
        s["nbA"] = []   # 橋の辺だけ
        s["on_bridge"] = False
        s["on_flat"] = False
    for w in W:
        for a, b, da, db in zip(w["idx"], w["idx"][1:], w["d"], w["d"][1:]):
            S[a]["nb"].append((b, max(0.05, db - da))); S[b]["nb"].append((a, max(0.05, db - da)))
            if not w["ramp"]:
                S[a]["nbA"].append((b, max(0.05, db - da))); S[b]["nbA"].append((a, max(0.05, db - da)))
        for i in w["idx"]:
            if not w["ramp"]:
                S[i]["on_bridge"] = True
            if not w["steps"]:
                S[i]["on_flat"] = True

    # ---- 外れ値を落とす (道に沿った 5 点の中央値)
    for w in W:
        vals = [S[i]["raw"] for i in w["idx"]]
        for n, i in enumerate(w["idx"]):
            if S[i]["node"] is not None:
                continue
            win = [v for v in vals[max(0, n - 2):n + 3] if v is not None]
            S[i]["v"] = median(win) if len(win) >= 3 and vals[n] is not None else vals[n]

    # ---- 状態: 建物 / 地面 / 高い所
    for s in S:
        v = s["v"]
        s["low"] = v is not None and v < s["g"] + LOW
        if v is not None and v > s["g"] + TOO_HIGH:
            s["v"] = None
    # 橋の上で地面が写っている所は不明。坂では地面
    for s in S:
        if s["low"]:
            s["v"] = None if s["on_bridge"] else s["g"]

    # ---- 坂 (ramp): 橋につながる頂点から、地面に下りきるまでだけを対象にする。その先は地面の高さ
    for w in W:
        w["active"] = [not w["ramp"]] * len(w["idx"])
        if not w["ramp"]:
            continue
        n = len(w["idx"])
        for start in [k for k, i in enumerate(w["idx"]) if S[i]["node"] in bridge_nodes]:
            for step in (1, -1):
                k, run = start, 0
                while 0 <= k < n:
                    w["active"][k] = True
                    s = S[w["idx"][k]]
                    if k != start and s["node"] in ground_nodes:
                        break
                    run = run + 1 if s["low"] else 0
                    if run >= 4:
                        break
                    k += step
    active = set()
    for w in W:
        for k, i in enumerate(w["idx"]):
            if w["active"][k]:
                active.add(i)

    # ---- 地面に固定する測点
    degree = {}
    for r in roads:
        for p in r["pts"]:
            degree[key(p)] = degree.get(key(p), 0) + 1
    for n, s in enumerate(S):
        s["fixed"] = None
        if n not in active:
            s["fixed"] = s["g"]
        elif s["node"] in ground_nodes:
            s["fixed"] = s["g"] + (0.1 if s["on_bridge"] else 0.0)
    for w in W:
        idx = w["idx"]
        if w["ramp"]:  # 坂の対象範囲の端 (その先は地面)
            for k, i in enumerate(idx):
                if w["active"][k] and ((k > 0 and not w["active"][k - 1]) or (k + 1 < len(idx) and not w["active"][k + 1])):
                    if S[i]["node"] not in bridge_nodes:
                        S[i]["fixed"] = S[i]["g"]
        if w["steps"]:  # どこにもつながらない階段の端は地面に下りる
            for i in (idx[0], idx[-1]):
                if degree[S[i]["node"]] == 1 and S[i]["fixed"] is None and not in_building(S[i]["x"], S[i]["z"]):
                    S[i]["fixed"] = S[i]["g"] + (0.0 if w["ramp"] else 0.1)

    # ---- 面に分ける (知っている測点どうしを、高さの差が小さい辺でつなぐ)
    known = lambda n: n in active and S[n]["v"] is not None and S[n]["fixed"] is None
    cont = lambda a, b, L: abs(S[b]["v"] - S[a]["v"]) <= BREAK * 0.6 * max(1.0, L / STEP)

    def surfaces():
        comp, size = {}, {}
        for n in range(len(S)):
            if not known(n) or n in comp:
                continue
            comp[n] = n
            stack = [n]
            while stack:
                a = stack.pop()
                for b, L in S[a]["nb"]:
                    if known(b) and b not in comp and cont(a, b, L):
                        comp[b] = n
                        stack.append(b)
        for c in comp.values():
            size[c] = size.get(c, 0) + 1
        return comp, size

    for s in S:
        s["v0"] = s["v"]
    # (1) 大きな面にあいた小さな穴・こぶ (下の物が写った・手すりや人) を落とす
    for _ in range(3):
        comp, size = surfaces()
        drop = set()
        flat_n = {}
        for a in comp:
            flat_n[comp[a]] = flat_n.get(comp[a], 0) + (1 if S[a]["on_flat"] else 0)
        for a in comp:
            for b, L in S[a]["nb"]:
                if b not in comp or comp[b] == comp[a]:
                    continue
                small = 12 if S[a]["v"] > S[b]["v"] else 6
                rel = flat_n[comp[a]] >= 0.8 * size[comp[a]] and size[comp[a]] < 0.1 * size[comp[b]]  # デッキの下の物 (バス停の屋根など) が見えた所
                if (size[comp[a]] < small or rel) and size[comp[b]] >= 3 * size[comp[a]]:
                    drop.add(comp[a])
        # デッキの途中の出っ張り・へこみ (両側とも段差で切れている 15 m 未満の面) も落とす
        side = {}
        for a in comp:
            for b, L in S[a]["nb"]:
                if b in comp and comp[b] != comp[a] and S[a]["on_flat"] and S[b]["on_flat"]:
                    side.setdefault(comp[a], set()).add((comp[b], S[a]["v"] > S[b]["v"]))
        for c, nbs in side.items():
            if size[c] < 30 and flat_n[c] >= 0.8 * size[c] and len(nbs) >= 2 and len({up for _, up in nbs}) == 1:
                drop.add(c)
        if not drop:
            break
        for n, c in comp.items():
            if c in drop:
                S[n]["v"] = None
    for s in S:
        s["v1"] = s["v"]
    # (2) 下の面より高い面は屋根。地面に固定した測点のすぐ上に浮いている面も屋根 (階段の屋根・建物の軒)
    comp, size = surfaces()
    roof = set()
    for a in comp:
        for b, L in S[a]["nb"]:
            # 下の面が上の面に比べてごく小さいとき (大きなデッキの下をくぐる階段など) は、上を屋根としない
            if b in comp and comp[b] != comp[a] and S[a]["v"] - S[b]["v"] >= ROOF and size[comp[b]] >= 0.1 * size[comp[a]]:
                roof.add(comp[a])
            if S[b]["fixed"] is not None and S[a]["v"] - S[b]["fixed"] >= 2.5 and L <= 1.0 and size[comp[a]] < 100:
                roof.add(comp[a])
    # (3) 近くの大きなデッキより 2.6 m 以上高い面も屋根 (屋根の下にデッキが 1 点も写っていない所)
    big = [(S[n]["x"], S[n]["z"], S[n]["v"]) for n, c in comp.items() if c not in roof and size[c] >= 100 and S[n]["on_flat"]][::4]
    members = {}
    for n, c in comp.items():
        members.setdefault(c, []).append(n)
    for c, ms in members.items():
        if c in roof:
            continue
        hit = sum(1 for n in ms[::2] if any(S[n]["v"] - v >= 2.6 and math.hypot(x - S[n]["x"], z - S[n]["z"]) < 25 for x, z, v in big))
        if hit >= 0.5 * len(ms[::2]):
            roof.add(c)
    for c, ms in members.items():  # 大きなデッキより 1 m 以上高い小さな面 (屋根のすき間から見えた物・デッキの上の小屋)
        if c in roof or size[c] >= 60 or not all(S[n]["on_flat"] for n in ms):
            continue
        hit = sum(1 for n in ms if any(S[n]["v"] - v >= 1.0 and math.hypot(x - S[n]["x"], z - S[n]["z"]) < 25 for x, z, v in big))
        if hit >= 0.5 * len(ms):
            roof.add(c)
    for a in comp:  # 屋根に接する小さな面 (屋根の切れ端・すき間から見えた物) も落とす
        for b, L in S[a]["nb"]:
            if b in comp and comp[b] in roof and comp[a] not in roof and size[comp[a]] < 20:
                S[a]["v"] = None
    # (4) 小さな切れ端は、近くの大きなデッキと同じ高さのときだけ残す
    for n, c in comp.items():
        if c in roof:
            S[n]["v"] = None
        elif size[c] <= 4 and S[n]["v"] is not None:
            s = S[n]
            if not (s["on_flat"] and any(abs(v - s["v"]) < 0.4 and math.hypot(x - s["x"], z - s["z"]) < 40 for x, z, v in big)):
                s["v"] = None

    for s in S:
        s["v2"] = s["v"]
    # ---- 指定された高さ (data/appearance.json の deck_levels)
    for lv in levels:
        for n, s in enumerate(S):
            if n in active and s["on_flat"] and s["fixed"] is None and math.hypot(s["x"] - lv["x"], s["z"] - lv["z"]) <= lv["r"]:
                s["v"] = lv["y"]

    # ---- 階段: 下から上へ単調に上がる測点だけを残す (横の物が写った測点を落とす)
    for w in W:
        if not w["steps"]:
            continue
        idx = w["idx"]
        val = lambda i: S[i]["fixed"] if S[i]["fixed"] is not None else S[i]["v"] if i in active else None
        meas = [i for i in idx if i in active and S[i]["fixed"] is None and S[i]["v"] is not None and S[i]["node"] is None]
        if len(meas) < 0.5 * len(idx):
            for i in meas:
                S[i]["v"] = None
            continue
        ks = [k for k, i in enumerate(idx) if val(i) is not None]
        if len(ks) < 3:
            continue
        vs = [val(idx[k]) for k in ks]
        fx = [S[idx[k]]["fixed"] is not None for k in ks]
        best = None
        for sign in (1, -1):  # 上り向き / 下り向き
            ln, prev = [1] * len(ks), [-1] * len(ks)
            for a in range(len(ks)):
                for b in range(a):
                    dd = w["d"][ks[a]] - w["d"][ks[b]]
                    rise = (vs[a] - vs[b]) * sign
                    if -0.15 <= rise <= 0.75 * dd + 0.3 and ln[b] + 1 + 3 * fx[a] > ln[a]:
                        ln[a], prev[a] = ln[b] + 1 + 3 * fx[a], b
            a = max(range(len(ks)), key=lambda q: ln[q])
            score, chain = ln[a], []
            while a >= 0:
                chain.append(a); a = prev[a]
            if best is None or score > best[0]:
                best = (score, set(chain))
        for q, k in enumerate(ks):
            if q not in best[1] and not fx[q]:
                S[idx[k]]["v"] = None

    # ---- 高さを決める (A) 橋: 固定 > 実測 > 補間 (不明な所は両側からなめらかに)
    y = [None] * len(S)
    A = [n for n in range(len(S)) if S[n]["on_bridge"]]
    for n in A:
        s = S[n]
        if s["fixed"] is not None:
            y[n] = s["fixed"]
        elif s["v"] is not None:
            y[n] = s["v"]
    # つながっているのに 1 つも分からないまとまりは触らない
    seen, untouched = set(), set()
    for n in A:
        if n in seen:
            continue
        group, stack = [], [n]
        seen.add(n)
        while stack:
            a = stack.pop(); group.append(a)
            for b, _ in S[a]["nbA"]:
                if b not in seen:
                    seen.add(b); stack.append(b)
        if all(y[a] is None for a in group):
            untouched.update(group)
    free = [n for n in A if y[n] is None and n not in untouched]
    if free:  # 共役勾配法で (グラフの) ラプラス方程式を解く
        pos = {n: i for i, n in enumerate(free)}
        rhs = [sum(y[b] / L for b, L in S[n]["nbA"] if b not in pos) for n in free]
        diag = [sum(1 / L for _, L in S[n]["nbA"]) for n in free]
        off = [[(pos[b], 1 / L) for b, L in S[n]["nbA"] if b in pos] for n in free]
        mul = lambda x: [diag[i] * x[i] - sum(c * x[j] for j, c in off[i]) for i in range(len(free))]
        x = [0.0] * len(free)
        res = rhs[:]
        z = [res[i] / diag[i] for i in range(len(free))]
        p = z[:]
        rz = sum(a * b for a, b in zip(res, z))
        for it in range(4 * len(free) + 50):
            if rz < 1e-12:
                break
            Ap = mul(p)
            al = rz / sum(a * b for a, b in zip(p, Ap))
            x = [a + al * b for a, b in zip(x, p)]
            res = [a - al * b for a, b in zip(res, Ap)]
            z = [res[i] / diag[i] for i in range(len(free))]
            rz2 = sum(a * b for a, b in zip(res, z))
            p = [a + rz2 / rz * b for a, b in zip(z, p)]
            rz = rz2
        for n, v in zip(free, x):
            y[n] = v

    # 地面に固定した点から離れるほど高くなれる上限 (歩道 1/8、階段 0.75)。たもとの段差をなだらかにする
    import heapq
    grade_of = {}
    for w in W:
        if w["ramp"]:
            continue
        g = 0.75 if w["steps"] else 0.125
        for a, b in zip(w["idx"], w["idx"][1:]):
            grade_of[(a, b)] = grade_of[(b, a)] = max(g, grade_of.get((a, b), 0))
    for sign in (1, -1):
        bound = {n: sign * S[n]["fixed"] for n in A if S[n]["fixed"] is not None}
        heap = [(v, n) for n, v in bound.items()]
        heapq.heapify(heap)
        while heap:
            v, a = heapq.heappop(heap)
            if v > bound.get(a, 1e9):
                continue
            for b, L in S[a]["nbA"]:
                nv = v + grade_of[(a, b)] * L
                if nv < bound.get(b, 1e9):
                    bound[b] = nv
                    heapq.heappush(heap, (nv, b))
        for n, v in bound.items():
            if y[n] is not None and sign * y[n] > v:
                y[n] = sign * v
    for n in A:  # 地面より下にはしない
        if y[n] is not None and S[n]["fixed"] is None:
            y[n] = max(y[n], S[n]["g"] + 0.1)

    # ---- (B) 坂: 橋につながる頂点の高さは (A) のまま。間は実測、無ければ直線で補う。
    #      橋から下りる勾配は 0.75 まで (それより急になるなら、下りきる位置を先へ延ばす)
    for w in W:
        if not w["ramp"]:
            continue
        idx, dd = w["idx"], w["d"]
        if any(S[i]["on_bridge"] and y[i] is None for i in idx):
            for i in idx:
                if not S[i]["on_bridge"]:
                    untouched.add(i)
            continue
        hard = {}
        for k, i in enumerate(idx):
            s = S[i]
            if s["on_bridge"]:
                hard[k] = y[i]
            elif s["fixed"] is not None:
                hard[k] = s["fixed"]
            elif i in active and s["v"] is not None:
                hard[k] = s["v"]
        if w["steps"]:
            tops = [y[i] for i in idx if S[i]["on_bridge"]]
            meas = [k for k, i in enumerate(idx) if not S[i]["on_bridge"] and S[i]["fixed"] is None and k in hard]
            if any(hard[k] > max(tops) + 0.3 for k in meas):  # デッキより高い = 階段の屋根が写っている
                for k in meas:
                    del hard[k]
            for k in (0, len(idx) - 1):  # 先が分からない階段は地面へ下ろす
                if not S[idx[k]]["on_bridge"] and not any(q in hard for q in (range(0, 3) if k == 0 else range(len(idx) - 3, len(idx)))):
                    hard[k] = S[idx[k]]["g"]
        ks = sorted(hard)
        vals = []
        for k in range(len(idx)):
            if k in hard:
                vals.append(hard[k]); continue
            lo = max((q for q in ks if q < k), default=None)
            hi = min((q for q in ks if q > k), default=None)
            if lo is None or hi is None:
                vals.append(hard[lo if hi is None else hi])
            else:
                t = (dd[k] - dd[lo]) / max(1e-9, dd[hi] - dd[lo])
                vals.append(hard[lo] + (hard[hi] - hard[lo]) * t)
        for kb, i in enumerate(idx):
            if not S[i]["on_bridge"]:
                continue
            for k in range(len(idx)):
                if not S[idx[k]]["on_bridge"]:
                    d = abs(dd[k] - dd[kb])
                    vals[k] = min(max(vals[k], y[i] - 0.75 * d), y[i] + 0.75 * d)
        for k, i in enumerate(idx):
            if not S[i]["on_bridge"]:
                y[i] = vals[k]

    # ---- 実測のふらつきをならす (階段以外。道に沿った 2.5 m の平均。固定点・補間の端は動かさない)
    for w in W:
        if w["steps"]:
            continue
        idx = w["idx"]
        sm = []
        for k, i in enumerate(idx):
            if y[i] is None or S[i]["fixed"] is not None or i in untouched or S[i]["node"] is not None and len(S[i]["nb"]) != 2:
                sm.append(y[i]); continue
            win = [y[j] for j in idx[max(0, k - 2):k + 3] if y[j] is not None and abs(y[j] - y[i]) < 0.25]
            sm.append(sum(win) / len(win))
        for i, v in zip(idx, sm):
            if S[i]["node"] is None and v is not None:
                y[i] = v

    # ---- 歩いて上れない段差を残さない: どの隣とも勾配 0.8 以下になるよう、高い側を削る
    heap = [(y[n], n) for n in range(len(S)) if y[n] is not None and n not in untouched]
    heapq.heapify(heap)
    while heap:
        v, a = heapq.heappop(heap)
        if v > y[a]:
            continue
        for b, L in S[a]["nb"]:
            if y[b] is not None and b not in untouched and S[b]["fixed"] is None and y[b] > v + MAX_GRADE * L:
                y[b] = v + MAX_GRADE * L
                heapq.heappush(heap, (y[b], b))

    # ---- 書き戻す (高さが折れる所だけ頂点を足す)
    n_changed = 0
    for w in W:
        r, idx, dd = w["r"], w["idx"], w["d"]
        if any(i in untouched for i in idx):
            continue
        if r["kind"] not in PED:
            # 車道の橋: たもとの地形と実測が 1.2 m 以上合わない橋 (川岸の地形が低すぎる所など) は、元の推定のままにする
            bad = False
            for end in (idx[:6], idx[-6:]):
                fx = [S[i]["fixed"] for i in end if S[i]["fixed"] is not None]
                raw = [S[i]["raw"] for i in end if S[i]["raw"] is not None and S[i]["raw"] < S[i]["g"] + TOO_HIGH]
                if fx and raw and abs(median(raw) - fx[0]) > 1.2:
                    bad = True
            if bad:
                continue
        ys = [y[i] for i in idx]
        keep = simplify(dd, ys, w["orig"], TOL)
        new_pts = [[round(S[idx[k]]["x"], 2), round(S[idx[k]]["z"], 2)] if k not in w["orig"] else r["pts"][w["orig"].index(k)] for k in keep]
        new_ys = [round(ys[k], 2) for k in keep]
        if report:
            raw = " ".join("  ." if S[i]["raw"] is None else f"{S[i]['raw']:.1f}" for i in idx[::4])
            fin = " ".join(f"{y[i]:.1f}" for i in idx[::4])
            mg = max((abs(y[b] - y[a]) / max(0.2, db - da) for a, b, da, db in zip(idx, idx[1:], dd, dd[1:])), default=0)
            if report == "debug":
                f = lambda q: " ".join("  ." if S[i][q] is None else f"{S[i][q]:.1f}" for i in idx[::4])
                print("   v0:", f("v0"), "\n   v1:", f("v1"), "\n   v2:", f("v2"), "\n   v :", f("v"), "\n   fx:", f("fixed"))
            print(f"{r['kind'][:5]:5s}{'R' if w['ramp'] else 'B'} x={r['pts'][0][0]:.0f} z={r['pts'][0][1]:.0f} L={dd[-1]:.0f} 最大勾配 {mg:.2f}\n   測: {raw}\n   決: {fin}")
        if new_pts != r["pts"] or new_ys != r.get("ys"):
            n_changed += 1
        r["pts"], r["ys"] = new_pts, new_ys
        if len(keep) > len(w["orig"]):
            r["base"] = [keep.index(k) for k in w["orig"]]
            if r.get("cov"):  # 区間ごとの値 (PLATEAU の道路面で覆われているか) は、元の区間の値を引き継ぐ
                seg_of = [sum(1 for o in w["orig"] if o <= k) - 1 for k in keep[:-1]]
                r["cov"] = [r["cov"][s] for s in seg_of]
    n_act = [n for n in active if S[n]["fixed"] is None]
    measured = sum(1 for n in n_act if S[n]["v"] is not None)
    return n_changed, measured / max(1, len(n_act))


def merge_points(roads):
    """前回足した頂点を取り除いて、元の頂点だけに戻す (元の頂点の番号は base に控えてある)"""
    for r in roads:
        if "base" in r:
            keep = r.pop("base")
            if r.get("cov"):
                r["cov"] = [r["cov"][i] for i in keep[:-1]]
            r["pts"] = [r["pts"][i] for i in keep]
            if r.get("ys"):
                r["ys"] = [r["ys"][i] for i in keep]


def run(city, report=False):
    import lidar_shape
    if not lidar_shape.DSM_BIN.exists() or not TERRAIN.exists():
        return None
    H, ref = terrain_sampler()
    levels = []
    if APPEARANCE.exists():
        levels = json.loads(APPEARANCE.read_text(encoding="utf-8")).get("deck_levels", [])
    merge_points(city["roads"])
    return apply(city["roads"], H, ref, lidar_shape.DSM(), levels, report, inside_any(city["buildings"]))


def main():
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    city = json.loads(CITY.read_text(encoding="utf-8"))
    res = run(city, "--report" in sys.argv)
    if res is None:
        raise SystemExit("data/raw/lidar_dsm.bin か terrain.json がありません。先に python tools/fetch_lidar.py を実行してください")
    CITY.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"deck heights: {res[0]} 本の高さを直した (実測できた測点 {res[1] * 100:.0f}%)")
    try:
        import build_props
        build_props.main()
    except Exception as e:  # noqa
        print("build_props.py は実行できなかった:", e)


if __name__ == "__main__":
    main()
