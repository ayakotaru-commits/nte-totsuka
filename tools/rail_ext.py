"""線路を地図の北の端から東戸塚駅の先まで延ばす (電車で東戸塚まで行けるようにする。段階 2)。

使い方: python tools/rail_ext.py            (初回は国土地理院のタイル・PLATEAU を取る。数分)
出力:   public/data/rail_ext.json
  routes:   [{route: props.json の rail.routes の番号, line, at: "end" (北行きの終わりに足す) | "start" (南行きの始めに足す),
              p: [[x, y, z], ...] (約 5 m おき。y = レールの上面), stop: 東戸塚で止まる位置 (先頭の、p の始点からの距離 m) か null}]
            "start" の p は、北の端から地図の端へ向かう順 (そのまま道筋の前につなげる)
  station:  東戸塚駅 {name, platform: {left, right, y} (戸塚の rail.platforms と同じ形), canopy: 同じ形, center: [x, z]}
  terrain:  線路の近く (BAND m 以内) の細かい地形 {step, x0, z0, nx, nz, rows: [[j, i0, h(cm), ...], ...]}
  coarse:   その外の粗い地形 {step, x0, z0, nx, nz, h: [cm, ...]} (地図の範囲の中も含めて全部)
  buildings: 線路の近くの建物 [[[[x, z], ...] 輪郭, 足元の y, 高さ, 下端 (線路をまたぐ駅舎など。0 = 地面から)], ...]
  poles:    架線柱 [[x, y, z, 向き], ...]
出典: 国土地理院ベクトルタイル (鉄道中心線・軌道の中心線)、国土地理院 標高タイル、国土交通省 PLATEAU 横浜市 (2024)
線路の高さは標高タイル (地表) + 0.55 m を均したもの。橋・トンネルの区間 (鉄道中心線の種類) は両端を直線で結ぶ。
"""
import json
import math
import pathlib
import time
import urllib.request

import fetch_dem
from config import BOUNDS, ORIGIN_LAT, ORIGIN_LON, _M_LAT, _M_LON
from fetch_gsi import URL as GSI_URL, UA, tile_xy, to_latlon
from fetch_plateau import ZIP_URL, mesh3
from mvt import decode

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "raw" / "gsi_ext"
PCACHE = ROOT / "data" / "raw" / "plateau"
OUT = ROOT / "public" / "data" / "rail_ext.json"

Z_MATCH = -660          # 道筋と国土地理院の軌道を突き合わせる z (地図の北の端の少し内側)
Z_END = -3950          # 道筋の北の端 (東戸塚駅のホームの北の端 約 -3400 の 550 m 先。15 両が止まって出ていける長さ)
STEP = 5.0             # 道筋の点の間隔
RAIL_TOP = 0.55        # 地面からのレールの上面 (build_props.py と同じ)
BLEND = 150.0          # 地図の端の道筋 (OSM) と国土地理院の線路の、位置のずれを均す長さ
BAND = 350.0           # 細かい地形・建物を作る、線路からの距離
T_STEP = 5.0           # 細かい地形の間隔
C_STEP = 25.0          # 粗い地形の間隔
C_PAD = 1400.0         # 粗い地形の、線路からの広さ
PLAT_LEN = 310.0       # ホームの長さ (15 両)
PLAT_Y = 1.0           # ホームの上面 (レールの上面から)
GRADE = 0.025          # 線路の勾配の上限
CAR, CARS = 20.0, {"tokaido": 15, "yokosuka": 15, "freight": 20}
LAT0, LAT1, LON0, LON1 = 35.395, 35.440, 139.520, 139.580   # 取るタイルの範囲

REF = json.loads((ROOT / "public" / "data" / "terrain.json").read_text())["ref"]


def to_local(lat, lon):
    return (lon - ORIGIN_LON) * _M_LON, (ORIGIN_LAT - lat) * _M_LAT


def to_ll(x, z):
    return ORIGIN_LAT - z / _M_LAT, ORIGIN_LON + x / _M_LON


def dem(x, z):
    v = fetch_dem.elev(*to_ll(x, z))
    return None if v is None else v - REF


def inside_map(x, z, m=0.0):
    return BOUNDS["minX"] + m <= x <= BOUNDS["maxX"] - m and BOUNDS["minZ"] + m <= z <= BOUNDS["maxZ"] - m


# ---------- 国土地理院ベクトルタイル: 軌道の中心線 (RailTrCL) と鉄道中心線 (RailCL) ----------
def clip_line(pts, ext):
    """タイルの外 (のりしろ) を除いた線の部分の列"""
    out, cur = [], []
    ins = lambda p: 0 <= p[0] <= ext and 0 <= p[1] <= ext
    for i, p in enumerate(pts):
        if ins(p):
            if not cur and i > 0:
                cur.append(edge_cross(pts[i - 1], p, ext))
            cur.append(p)
        else:
            if cur:
                cur.append(edge_cross(p, pts[i - 1], ext))
                out.append(cur)
                cur = []
    if len(cur) >= 2:
        out.append(cur)
    return [c for c in out if len(c) >= 2]


def edge_cross(a, b, ext):
    """a (外) から b (中) へ進む線分が、タイルの枠と交わる点"""
    t = 0.0
    for k in (0, 1):
        for lim in (0, ext):
            d = b[k] - a[k]
            if d and (a[k] - lim) * (b[k] - lim) < 0:
                t = max(t, (lim - a[k]) / d)
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def load_gsi():
    CACHE.mkdir(parents=True, exist_ok=True)
    x0, y0 = tile_xy(LAT1, LON0, 16)
    x1, y1 = tile_xy(LAT0, LON1, 16)
    tracks, lines = [], []
    for ty in range(int(y0), int(y1) + 1):
        for tx in range(int(x0), int(x1) + 1):
            p = CACHE / f"16_{tx}_{ty}.pbf"
            if not p.exists():
                with urllib.request.urlopen(urllib.request.Request(GSI_URL.format(z=16, x=tx, y=ty), headers=UA), timeout=60) as r:
                    p.write_bytes(r.read())
                time.sleep(0.05)
            L = decode(p.read_bytes())
            for name, dst in (("RailTrCL", tracks), ("RailCL", lines)):
                lay = L.get(name)
                if not lay:
                    continue
                ext = lay["extent"]
                for f in lay["features"]:
                    if f["type"] != 2:
                        continue
                    for g in f["geom"]:
                        for part in clip_line(g, ext):
                            pts = [to_local(*to_latlon(tx + a / ext, ty + b / ext, 16)) for a, b in part]
                            dst.append({"props": f["props"], "pts": pts})
    return tracks, lines


def join_tracks(tracks):
    """線分の索引 (5 m 四方の升目)。タイルの境目では、隣のタイルの線と端点でつながらず 20 m ほど重なるので、端点ではなく線の近さでつなぐ"""
    grid = {}
    for i, t in enumerate(tracks):
        P = t["pts"]
        for k in range(len(P) - 1):
            (ax, az), (bx, bz) = P[k], P[k + 1]
            for gx in range(int(min(ax, bx) // 5) - 1, int(max(ax, bx) // 5) + 2):
                for gz in range(int(min(az, bz) // 5) - 1, int(max(az, bz) // 5) + 2):
                    grid.setdefault((gx, gz), []).append((i, k))
    return grid


def follow(tracks, grid, start_i, start_k, heading):
    """軌道 start_i の点 start_k から heading の向きへたどった点の列。線の終わりでは、終わりの点から 1 m 以内を通る別の線
    (向きのそろったもの。分かれ道ではいちばんまっすぐなもの) に乗り移る"""
    t = tracks[start_i]["pts"]
    a, b = t[start_k], t[min(start_k + 1, len(t) - 1)]
    fwd = (b[0] - a[0]) * heading[0] + (b[1] - a[1]) * heading[1] > 0
    path = list(t[start_k + 1:]) if fwd else list(reversed(t[:start_k + 1]))
    path.insert(0, a if fwd else b)
    used = {start_i}
    while path[-1][1] > Z_END and len(path) >= 2:
        tail = path[-1]
        dx, dz = tail[0] - path[-2][0], tail[1] - path[-2][1]
        L = math.hypot(dx, dz) or 1
        best = None
        for j, k in grid.get((int(tail[0] // 5), int(tail[1] // 5)), []):
            if j in used:
                continue
            P = tracks[j]["pts"]
            (ax, az), (bx, bz) = P[k], P[k + 1]
            ex, ez = bx - ax, bz - az
            l2 = ex * ex + ez * ez
            if l2 < 1e-6:
                continue
            u = max(0.0, min(1.0, ((tail[0] - ax) * ex + (tail[1] - az) * ez) / l2))
            d = math.hypot(tail[0] - ax - ex * u, tail[1] - az - ez * u)
            if d > 1.0:
                continue
            cos = (dx * ex + dz * ez) / L / math.sqrt(l2)
            if abs(cos) < math.cos(math.radians(20)):
                continue
            score = abs(cos) - d * 0.1
            if best is None or score > best[0]:
                best = (score, j, k, u, cos > 0)
        if not best:
            # タイルの境目のすき間: 60 m 先までの、今の向きの延長線から 1.5 m (+ 先へ行くほど少し広く) 以内の線
            ux, uz = dx / L, dz / L
            for gx in range(int(tail[0] // 5) - 12, int(tail[0] // 5) + 13):
                for gz in range(int(tail[1] // 5) - 12, int(tail[1] // 5) + 13):
                    for j, k in grid.get((gx, gz), []):
                        if j in used:
                            continue
                        P = tracks[j]["pts"]
                        for kk in (k, k + 1):
                            qx, qz = P[kk][0] - tail[0], P[kk][1] - tail[1]
                            along, lat = qx * ux + qz * uz, abs(-qx * uz + qz * ux)
                            if 0.5 < along < 60 and lat < 1.5 + along * 0.02:
                                ex, ez = P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]
                                el = math.hypot(ex, ez) or 1
                                c = (ex * ux + ez * uz) / el
                                if abs(c) > math.cos(math.radians(20)) and (best is None or lat + along * 0.01 < best[0]):
                                    best = (lat + along * 0.01, j, k, 0.0, c > 0)
            if not best:
                break
        _, j, k, u, f = best
        used.add(j)
        P = tracks[j]["pts"]
        nxt = P[k + 1:] if f else list(reversed(P[:k + 1]))
        # 重なっている所は飛ばし、今の終わりより先の点だけを足す
        for q in nxt:
            if (q[0] - tail[0]) * dx + (q[1] - tail[1]) * dz > 0.5 * L:
                path.append(q)
    return path


def resample(P, step=STEP):
    out, acc, nxt = [], 0.0, 0.0
    for n in range(len(P) - 1):
        (ax, az), (bx, bz) = P[n], P[n + 1]
        d = math.hypot(bx - ax, bz - az)
        if d <= 0:
            continue
        while nxt <= acc + d + 1e-9:
            t = (nxt - acc) / d
            out.append((ax + (bx - ax) * t, az + (bz - az) * t))
            nxt += step
        acc += d
    return out


def nearest_on(P, x, z):
    best = (1e18, 0)
    for i, p in enumerate(P):
        d = (p[0] - x) ** 2 + (p[1] - z) ** 2
        if d < best[0]:
            best = (d, i)
    return math.sqrt(best[0]), best[1]


# ---------- 高さ ----------
def profile(P, lines):
    """点ごとのレールの上面の高さ。橋・トンネルの区間は両端を直線で結び、全体を均す"""
    h = []
    for x, z in P:
        v = dem(x, z)
        h.append(v if v is not None else (h[-1] if h else 0.0))
    # 鉄道中心線 (JR) の種類: 点の近く (15 m 以内) の線の状態
    seg = []
    for ln in lines:
        if ln["props"].get("vt_rtcode") != "JR":
            continue
        st = ln["props"].get("vt_railstate", "")
        if "橋" in st or "トンネル" in st:
            seg.append(ln["pts"])
    flag = []
    for x, z in P:
        f = False
        for s in seg:
            for i in range(len(s) - 1):
                (ax, az), (bx, bz) = s[i], s[i + 1]
                ex, ez = bx - ax, bz - az
                l2 = ex * ex + ez * ez or 1
                t = max(0, min(1, ((x - ax) * ex + (z - az) * ez) / l2))
                if math.hypot(x - ax - ex * t, z - az - ez * t) < 15:
                    f = True
                    break
            if f:
                break
        flag.append(f)
    i = 0
    while i < len(P):
        if flag[i]:
            j = i
            while j < len(P) and flag[j]:
                j += 1
            a, b = max(0, i - 2), min(len(P) - 1, j + 1)
            for k in range(i, j):
                h[k] = h[a] + (h[b] - h[a]) * (k - a) / max(1, b - a)
            i = j
        else:
            i += 1
    # 均す (中央値 7 点 → 平均 11 点 = 約 55 m)
    med = [sorted(h[max(0, k - 3):k + 4])[len(h[max(0, k - 3):k + 4]) // 2] for k in range(len(h))]
    sm = [sum(med[max(0, k - 5):k + 6]) / len(med[max(0, k - 5):k + 6]) for k in range(len(med))]
    # 勾配を 2.5 % までにする (地図の端から順に)。トンネル (地形が高い所) は、線路が地形の下に入る
    for k in range(1, len(sm)):
        g = GRADE * math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1])
        sm[k] = max(sm[k - 1] - g, min(sm[k - 1] + g, sm[k]))
    return [v + RAIL_TOP for v in sm], flag


# ---------- 本体 ----------
def main():
    fetch_dem.CACHE.mkdir(parents=True, exist_ok=True)
    props = json.loads((ROOT / "public" / "data" / "props.json").read_text())
    routes = props["rail"]["routes"]
    tracks, lines = load_gsi()
    print(f"gsi: tracks={len(tracks)} rail lines={len(lines)}")
    grid = join_tracks(tracks)

    ext_routes = []
    for ri, r in enumerate(routes):
        p = r["p"]
        north_end = p[-1][2] < p[0][2]
        E, E2 = (p[-1], p[-2]) if north_end else (p[0], p[1])   # 北の端の点と、その 1 つ手前
        hx, hz = E[0] - E2[0], E[2] - E2[2]
        hl = math.hypot(hx, hz)
        heading = (hx / hl, hz / hl)
        # 地図の中の z = Z_MATCH で、道筋 (OSM) と同じ所 (1.5 m 以内) を横切る軌道
        zc = Z_MATCH
        rx = None
        for k in range(len(p) - 1):
            if (p[k][2] - zc) * (p[k + 1][2] - zc) <= 0 and p[k][2] != p[k + 1][2]:
                rx = p[k][0] + (p[k + 1][0] - p[k][0]) * (zc - p[k][2]) / (p[k + 1][2] - p[k][2])
        best = None
        if rx is not None:
            for i, t in enumerate(tracks):
                for k in range(len(t["pts"]) - 1):
                    (ax, az), (bx, bz) = t["pts"][k], t["pts"][k + 1]
                    if (az - zc) * (bz - zc) <= 0 and az != bz:
                        d = abs(ax + (bx - ax) * (zc - az) / (bz - az) - rx)
                        if d < 1.5 and (best is None or d < best[0]):
                            best = (d, i, k)
        path = follow(tracks, grid, best[1], best[2], heading)
        P = resample(path)
        # 地図の端の道筋の点から始め、ずれを BLEND m で 0 にする
        d0, k0 = nearest_on(P, E[0], E[2])
        P = P[k0:]
        ox, oz = E[0] - P[0][0], E[2] - P[0][1]
        P = [(x + ox * max(0, 1 - n * STEP / BLEND), z + oz * max(0, 1 - n * STEP / BLEND)) for n, (x, z) in enumerate(P)][1:]
        ext_routes.append({"route": ri, "line": r["line"], "at": "end" if north_end else "start", "P": P, "E": E, "off": math.hypot(ox, oz)})
        print(f"  route {ri} {r['line']} {'北行き' if north_end else '南行き'}: +{len(P) * STEP:.0f} m (北の端 z={P[-1][1]:.0f}, 端のずれ {math.hypot(ox, oz):.1f} m)")

    # 同じ軌道を 2 本の道筋が使っていないか
    for a in ext_routes:
        for b in ext_routes:
            if a is not b and a["route"] < b["route"]:
                m = len(a["P"]) // 2
                d, _ = nearest_on(b["P"], *a["P"][m])
                if d < 1.5:
                    print(f"  注意: route {a['route']} と {b['route']} が同じ線路を通る")

    # 高さ
    for er in ext_routes:
        hs, flag = profile(er["P"], lines)
        y0 = er["E"][1]
        er["y"] = [y0 + (h - y0) * min(1, (n + 1) * STEP / (BLEND + 50)) for n, h in enumerate(hs)]
        er["bridge"] = sum(flag) * STEP

    # ---------- 東戸塚駅 ----------
    st = [ln["pts"] for ln in lines if ln["props"].get("vt_rtcode") == "JR" and ln["props"].get("vt_sngldbl") == "駅部分"
          and any(p[1] < -2500 for p in ln["pts"])]
    zs = [p[1] for s in st for p in s]
    xs = [p[0] for s in st for p in s]
    cz, cx = (min(zs) + max(zs)) / 2, sum(xs) / len(xs)
    yk = [er for er in ext_routes if er["line"] == "yokosuka"]
    station = None
    if len(yk) == 2:
        A, B = yk
        # ホームの中心 = 2 本の線路の中央で、駅の中心にいちばん近い所
        _, ka = nearest_on(A["P"], cx, cz)
        _, kb = nearest_on(B["P"], *A["P"][ka])
        gap = math.hypot(A["P"][ka][0] - B["P"][kb][0], A["P"][ka][1] - B["P"][kb][1])
        print(f"東戸塚駅: 中心 ({cx:.0f}, {cz:.0f})、横須賀線の 2 本の間 {gap:.1f} m")
        left, right, ys = [], [], []
        half = int(PLAT_LEN / 2 / 4)
        dz = 1 if A["P"][-1][1] < A["P"][0][1] else -1   # A の進む向きは北 (z が減る) か
        for n in range(-half, half + 1):
            k = ka + round(n * 4 / STEP) * (1 if dz > 0 else -1)
            k = max(0, min(len(A["P"]) - 1, k))
            a = A["P"][k]
            _, kb2 = nearest_on(B["P"], *a)
            b = B["P"][kb2]
            d = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
            ux, uz = (b[0] - a[0]) / d, (b[1] - a[1]) / d
            off = 1.62
            left.append([round(a[0] + ux * off, 2), round(a[1] + uz * off, 2)])
            right.append([round(b[0] - ux * off, 2), round(b[1] - uz * off, 2)])
            ys.append(round((A["y"][k] + B["y"][kb2]) / 2 + PLAT_Y, 2))
        plat = {"left": left, "right": right, "y": ys}
        # 屋根: ホームの中ほど 160 m
        c0, c1 = len(left) // 2 - 20, len(left) // 2 + 20
        canopy = {"left": left[c0:c1], "right": right[c0:c1], "y": [v + 3.4 for v in ys[c0:c1]]}
        pc = [(left[len(left) // 2][0] + right[len(left) // 2][0]) / 2, (left[len(left) // 2][1] + right[len(left) // 2][1]) / 2]
        station = {"name": "東戸塚", "platform": plat, "canopy": canopy, "center": [round(pc[0], 2), round(pc[1], 2)]}
        # 止まる位置: 編成の中央がホームの中央に来る所 (先頭の位置)
        for er in yk:
            _, k = nearest_on(er["P"], *pc)
            # "start" (南行き) の p は北から南へ並べ直してから数える
            er["stop_k"] = k
    else:
        print("横須賀線の続きが 2 本見つからないので、東戸塚駅を作らない")

    # ---------- 出力する道筋 ("start" は北から地図の端へ向かう順) ----------
    out_routes = []
    for er in ext_routes:
        pts = [[round(x, 2), round(y, 2), round(z, 2)] for (x, z), y in zip(er["P"], er["y"])]
        stop = None
        if er["at"] == "start":
            pts = pts[::-1]
            if "stop_k" in er:
                k = len(pts) - 1 - er["stop_k"]
                stop = round(k * STEP + CARS[er["line"]] * CAR / 2, 1)
        elif "stop_k" in er:
            stop = round(er["stop_k"] * STEP + CARS[er["line"]] * CAR / 2, 1)
        out_routes.append({"route": er["route"], "line": er["line"], "at": er["at"], "p": pts, "stop": stop})

    # ---------- 地形 ----------
    allP = [p for er in ext_routes for p in er["P"][::2]]
    grid = {}
    for x, z in allP:
        grid.setdefault((int(x // 100), int(z // 100)), []).append((x, z))

    def near_track(x, z, r):
        gx, gz = int(x // 100), int(z // 100)
        R = int(r // 100) + 1
        r2 = r * r
        for i in range(gx - R, gx + R + 1):
            for j in range(gz - R, gz + R + 1):
                for px, pz in grid.get((i, j), ()):
                    if (px - x) ** 2 + (pz - z) ** 2 < r2:
                        return True
        return False

    minx = min(p[0] for p in allP) - BAND - 20
    maxx = max(p[0] for p in allP) + BAND + 20
    minz = min(p[1] for p in allP) - BAND - 20
    maxz = BOUNDS["minZ"] + 40
    x0, z0 = math.floor(minx / T_STEP) * T_STEP, math.floor(minz / T_STEP) * T_STEP
    nx, nz = int((maxx - x0) / T_STEP) + 1, int((maxz - z0) / T_STEP) + 1
    rows = []
    cells = 0
    for j in range(nz):
        z = z0 + j * T_STEP
        span = None
        for i in range(nx):
            x = x0 + i * T_STEP
            ok = near_track(x, z, BAND) and not inside_map(x, z, 30)
            if ok:
                v = dem(x, z)
                v = 0.0 if v is None else v
                if span is None:
                    span = [j, i]
                    rows.append(span)
                span.append(round(v * 100))
                cells += 1
            else:
                span = None
    terrain = {"step": T_STEP, "x0": x0, "z0": z0, "nx": nx, "nz": nz, "rows": rows}
    print(f"細かい地形: {cells} 点")

    cx0 = math.floor((min(p[0] for p in allP) - C_PAD) / C_STEP) * C_STEP
    cz0 = math.floor((min(p[1] for p in allP) - C_PAD) / C_STEP) * C_STEP
    cx1 = max(p[0] for p in allP) + C_PAD
    cz1 = BOUNDS["minZ"] + C_PAD * 0.6
    cnx, cnz = int((cx1 - cx0) / C_STEP) + 1, int((cz1 - cz0) / C_STEP) + 1
    ch = []
    for j in range(cnz):
        for i in range(cnx):
            v = dem(cx0 + i * C_STEP, cz0 + j * C_STEP)
            ch.append(round((v if v is not None else 0.0) * 100))
    coarse = {"step": C_STEP, "x0": cx0, "z0": cz0, "nx": cnx, "nz": cnz, "h": ch}
    print(f"粗い地形: {cnx}x{cnz}")

    # ---------- 建物 (PLATEAU) ----------
    buildings = plateau_buildings(near_track, allP, ext_routes)
    print(f"建物: {len(buildings)}")

    # ---------- 架線柱: 道筋ごとに 50 m おき、進む向きの左 2.5 m ----------
    poles = []
    for er in ext_routes:
        P, Y = er["P"], er["y"]
        for k in range(4, len(P) - 1, 10):
            dx, dz = P[k + 1][0] - P[k - 1][0], P[k + 1][1] - P[k - 1][1]
            L = math.hypot(dx, dz) or 1
            lx, lz = dz / L, -dx / L    # 進む向きの左 (x = 東, z = 南)
            poles.append([round(P[k][0] + lx * 2.5, 2), round(Y[k] - RAIL_TOP, 2), round(P[k][1] + lz * 2.5, 2), round(math.atan2(dx, dz), 3)])

    OUT.write_text(json.dumps({
        "source": "国土地理院ベクトルタイル・標高タイル、国土交通省 PLATEAU 横浜市 (2024)",
        "routes": out_routes, "station": station, "terrain": terrain, "coarse": coarse, "buildings": buildings, "poles": poles,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"-> {OUT} ({OUT.stat().st_size / 1e6:.2f} MB)")


def plateau_buildings(near_track, allP, ext_routes):
    import xml.etree.ElementTree as ET
    from remotezip import open_remote_zip
    from fetch_plateau import NS, ring
    meshes = set()
    for x, z in allP:
        for dx in (-BAND, 0, BAND):
            for dz in (-BAND, 0, BAND):
                meshes.add(mesh3(*to_ll(x + dx, z + dz)))
    PCACHE.mkdir(parents=True, exist_ok=True)
    need = [m for m in sorted(meshes) if not (PCACHE / f"{m}_bldg.gml").exists()]
    if need:
        z = open_remote_zip(ZIP_URL)
        names = z.namelist()
        for m in need:
            hit = [n for n in names if n.endswith(f"bldg/{m}_bldg_6697_op.gml")]
            if hit:
                print(f"  PLATEAU {m} を取得")
                (PCACHE / f"{m}_bldg.gml").write_bytes(z.read(hit[0]))
    trackP = [(p, y) for er in ext_routes for p, y in zip(er["P"], er["y"])]
    tgrid = {}
    for (x, z), y in trackP:
        tgrid.setdefault((int(x // 20), int(z // 20)), []).append((x, z, y))

    def track_near(ring_xz, r):
        """輪郭の近く (r m 以内) の線路の点の高さ (無ければ None)"""
        xs, zs = [p[0] for p in ring_xz], [p[1] for p in ring_xz]
        found = None
        for i in range(int((min(xs) - r) // 20), int((max(xs) + r) // 20) + 1):
            for j in range(int((min(zs) - r) // 20), int((max(zs) + r) // 20) + 1):
                for x, z, y in tgrid.get((i, j), ()):
                    if pip(x, z, ring_xz) or ring_dist(x, z, ring_xz) < r:
                        found = y if found is None else max(found, y)
        return found

    out = []
    for m in sorted(meshes):
        path = PCACHE / f"{m}_bldg.gml"
        if not path.exists():
            continue
        for _, el in ET.iterparse(path, events=("end",)):
            if el.tag != f"{{{NS['bldg']}}}Building":
                continue
            fp = el.find("bldg:lod0FootPrint", NS)
            if fp is None:
                fp = el.find("bldg:lod0RoofEdge", NS)
            solid = el.find("bldg:lod1Solid", NS)
            if fp is None or solid is None:
                el.clear()
                continue
            outer = ring(fp.find(".//gml:Polygon", NS).find("gml:exterior//gml:posList", NS))
            pts = [to_local(p[0], p[1]) for p in outer]
            cx, cz = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
            if inside_map(cx, cz) or not near_track(cx, cz, BAND):
                el.clear()
                continue
            zs = [float(v) for pl in solid.iterfind(".//gml:posList", NS) for v in pl.text.split()[2::3]]
            base, top = min(zs), max(zs)
            mh = el.find("bldg:measuredHeight", NS)
            h = float(mh.text) if mh is not None and mh.text and float(mh.text) > 0 else top - base
            el.clear()
            if h < 2:
                continue
            ring_xz = simplify([(round(x, 2), round(z, 2)) for x, z in pts])
            if len(ring_xz) < 3:
                continue
            gy = min((dem(x, z) or base - REF) for x, z in ring_xz)
            lift = 0.0
            ty = track_near(ring_xz, 2.6)
            if ty is not None:
                if h < 9:
                    continue      # 線路にかかる低い建物 (データのずれ) は使わない
                lift = round(max(0.0, ty - RAIL_TOP + 6.5 - gy), 2)   # 線路をまたぐ駅舎など: 線路の上 6 m から
                if lift >= h - 1:
                    continue
            out.append([[list(p) for p in ring_xz], round(gy, 2), round(h, 2), lift])
    return out


def simplify(r):
    if r[0] == r[-1]:
        r = r[:-1]
    out = []
    for p in r:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 0.3:
            out.append(p)
    return out


def pip(x, z, ring):
    ins = False
    for i in range(len(ring)):
        (xi, zi), (xj, zj) = ring[i], ring[i - 1]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            ins = not ins
    return ins


def ring_dist(x, z, ring):
    best = 1e9
    for i in range(len(ring)):
        (ax, az), (bx, bz) = ring[i - 1], ring[i]
        ex, ez = bx - ax, bz - az
        l2 = ex * ex + ez * ez or 1
        t = max(0, min(1, ((x - ax) * ex + (z - az) * ez) / l2))
        best = min(best, math.hypot(x - ax - ex * t, z - az - ez * t))
    return best


if __name__ == "__main__":
    main()
