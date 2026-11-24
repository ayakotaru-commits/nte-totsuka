"""線路を地図の端から先の駅まで延ばす (電車で東戸塚などへ行けるようにする)。延ばす先と駅は data/rail_ext_config.json。

使い方: python tools/rail_ext.py            (初回は国土地理院のタイル・PLATEAU・標高タイルを取る。数分)
        python tools/rail_ext.py --find 保土ケ谷 35.4436,139.5960   (駅の位置を調べる: 目安の緯度経度のまわり 2 km の注記と「駅部分」。設定に書く lat/lon が分かる)
        python tools/rail_ext.py --plot out.png                    (今の rail_ext.json の平面図: 道筋・ホーム・建物・道路・坑口。確かめる用)
出力:   public/data/rail_ext.json
  routes:   [{route: props.json の rail.routes の番号, line, at: "end" (道筋の終わりに足す) | "start" (始めに足す),
              p: [[x, y, z], ...] (約 5 m おき。y = レールの上面。"start" は延長の先から地図の端へ向かう順 = そのまま前につなげる順),
              stops: [{s: 止まる位置 (先頭の、p の始点からの距離 m), name: 駅名}]}]
  stations: [{name, kana, roman, platform: {left, right, y} (戸塚の rail.platforms と同じ形), canopy: 同じ形, center: [x, z]}]
  terrain:  線路の近く (BAND m 以内) の細かい地形 {step, x0, z0, nx, nz, rows: [[j, i0, h(cm), ...], ...]}
  coarse:   その外の粗い地形 {step, x0, z0, nx, nz, h: [cm, ...]} (地図の範囲の中も含めて全部)
  buildings: 線路の近くの建物 [[[[x, z], ...] 輪郭, 足元の y, 高さ, 下端 (線路をまたぐ駅舎など。0 = 地面から)], ...]
  poles:    架線柱 [[x, y, z, 向き], ...]
  roads:    道路 [[幅 m, x0, z0, x1, z1, ...], ...] (国土地理院の道路中心線。高架は除く)
  trees:    木 [[x, y, z, 大きさ], ...] (建物・線路・道路から離れた所に、決まりで散らす。実物の位置ではない)
  portals:  トンネルの坑口 [[x, y (レールの下), z, 向き (トンネルの外へ), 幅], ...]
出典: 国土地理院ベクトルタイル (鉄道中心線・軌道の中心線・道路中心線)、国土地理院 標高タイル、国土交通省 PLATEAU 横浜市 (2024)
線路の高さは標高タイル (地表) + 0.55 m を均したもの。橋・トンネルの区間 (鉄道中心線の種類) は両端を直線で結び、勾配は 2.5 % まで。
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

CONFIG = ROOT / "data" / "rail_ext_config.json"
MAX_LEN = 12000.0      # たどる長さの上限 (m)
MATCH_IN = 15.0        # 道筋の端から地図の内側へこの距離の点で、国土地理院の軌道と突き合わせる
TUNNEL_D = 7.0         # 地形がレールの下面よりこれ以上高い所をトンネルとみなす (坑口を置く)
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


def load_gsi(bbox):
    """bbox = (南, 西, 北, 東) の範囲のタイルから、軌道の中心線・鉄道中心線・道路中心線"""
    LAT0, LON0, LAT1, LON1 = bbox
    CACHE.mkdir(parents=True, exist_ok=True)
    x0, y0 = tile_xy(LAT1, LON0, 16)
    x1, y1 = tile_xy(LAT0, LON1, 16)
    tracks, lines, roads = [], [], []
    for ty in range(int(y0), int(y1) + 1):
        for tx in range(int(x0), int(x1) + 1):
            p = CACHE / f"16_{tx}_{ty}.pbf"
            if not p.exists():
                with urllib.request.urlopen(urllib.request.Request(GSI_URL.format(z=16, x=tx, y=ty), headers=UA), timeout=60) as r:
                    p.write_bytes(r.read())
                time.sleep(0.05)
            L = decode(p.read_bytes())
            for name, dst in (("RailTrCL", tracks), ("RailCL", lines), ("RdCL", roads)):
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
    return tracks, lines, roads


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
    seg = lambda i: math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])
    plen, counted = sum(seg(i) for i in range(len(path) - 1)), len(path) - 1
    while plen < MAX_LEN and len(path) >= 2:
        plen += sum(seg(i) for i in range(counted, len(path) - 1))
        counted = len(path) - 1
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
def match_track(tracks, grid, p, at_end):
    """道筋 p の端 (at_end なら終わり) の MATCH_IN m 内側の点を通り、向きのそろった軌道。返り値 (軌道の番号, 線分の番号, 外向きの向き) か None"""
    q = p if at_end else p[::-1]
    acc, k = 0.0, len(q) - 1
    while k > 0 and acc < MATCH_IN:
        acc += math.hypot(q[k][0] - q[k - 1][0], q[k][2] - q[k - 1][2])
        k -= 1
    M, E = q[k], q[-1]
    hx, hz = E[0] - M[0], E[2] - M[2]
    hl = math.hypot(hx, hz) or 1
    heading = (hx / hl, hz / hl)
    best = None
    for i, kk in grid.get((int(M[0] // 5), int(M[2] // 5)), []):
        (ax, az), (bx, bz) = tracks[i]["pts"][kk], tracks[i]["pts"][kk + 1]
        ex, ez = bx - ax, bz - az
        l2 = ex * ex + ez * ez
        if l2 < 1e-6 or abs(ex * heading[0] + ez * heading[1]) / math.sqrt(l2) < 0.95:
            continue
        u = max(0.0, min(1.0, ((M[0] - ax) * ex + (M[2] - az) * ez) / l2))
        d = math.hypot(M[0] - ax - ex * u, M[2] - az - ez * u)
        if d < 1.5 and (best is None or d < best[0]):
            best = (d, i, kk)
    return (best[1], best[2], heading, E) if best else None


def build_station(st, ext_routes, lines):
    """駅 st (設定) のホーム。島式 = 止まる線 (lines[0]) の上下線の間"""
    cx, cz = to_local(st["lat"], st["lon"])
    yk = [er for er in ext_routes if er["line"] == st["lines"][0] and nearest_on(er["P"], cx, cz)[0] < 40]
    if len(yk) != 2:
        print(f"  {st['name']}: {st['lines'][0]} の上下線が 2 本見つからない ({len(yk)} 本)。駅を作らない")
        return None
    A, B = yk
    _, ka = nearest_on(A["P"], cx, cz)
    _, kb = nearest_on(B["P"], *A["P"][ka])
    gap = math.hypot(A["P"][ka][0] - B["P"][kb][0], A["P"][ka][1] - B["P"][kb][1])
    print(f"  {st['name']}駅: 中心の目安 ({cx:.0f}, {cz:.0f})、{st['lines'][0]} の 2 本の間 {gap:.1f} m")
    if not 7 < gap < 20:
        print("    島式ホームにしては間が狭すぎる・広すぎる。駅を作らない")
        return None
    left, right, ys = [], [], []
    half = int(st.get("length", PLAT_LEN) / 2 / 4)
    for n in range(-half, half + 1):
        k = max(0, min(len(A["P"]) - 1, ka + round(n * 4 / STEP)))
        a = A["P"][k]
        _, kb2 = nearest_on(B["P"], *a)
        b = B["P"][kb2]
        d = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
        ux, uz = (b[0] - a[0]) / d, (b[1] - a[1]) / d
        left.append([round(a[0] + ux * 1.62, 2), round(a[1] + uz * 1.62, 2)])
        right.append([round(b[0] - ux * 1.62, 2), round(b[1] - uz * 1.62, 2)])
        ys.append(round((A["y"][k] + B["y"][kb2]) / 2 + PLAT_Y, 2))
    m = len(left) // 2
    c0, c1 = max(0, m - 20), min(len(left), m + 20)
    pc = [round((left[m][0] + right[m][0]) / 2, 2), round((left[m][1] + right[m][1]) / 2, 2)]
    for er in yk:   # 止まる位置: 編成の中央がホームの中央に来る所 (先頭の位置。P の並び = 地図の端から外へ)
        _, k = nearest_on(er["P"], *pc)
        er.setdefault("stops_k", []).append((k, st["name"]))
    return {"name": st["name"], "kana": st.get("kana", ""), "roman": st.get("roman", ""), "center": pc,
            "platform": {"left": left, "right": right, "y": ys},
            "canopy": {"left": left[c0:c1], "right": right[c0:c1], "y": [v + 3.4 for v in ys[c0:c1]]}}


def main():
    fetch_dem.CACHE.mkdir(parents=True, exist_ok=True)
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    props = json.loads((ROOT / "public" / "data" / "props.json").read_text())
    routes = props["rail"]["routes"]
    # タイルの範囲: 地図の範囲と、設定の駅のまわり (1.5 km)
    lats = [to_ll(0, BOUNDS["minZ"])[0], to_ll(0, BOUNDS["maxZ"])[0]] + [st["lat"] for e in cfg["extensions"] for st in e["stations"]]
    lons = [to_ll(BOUNDS["minX"], 0)[1], to_ll(BOUNDS["maxX"], 0)[1]] + [st["lon"] for e in cfg["extensions"] for st in e["stations"]]
    pad = 0.014
    tracks, lines, roads = load_gsi((min(lats) - pad, min(lons) - pad * 1.2, max(lats) + pad, max(lons) + pad * 1.2))
    print(f"gsi: tracks={len(tracks)} rail lines={len(lines)} roads={len(roads)}")
    grid = join_tracks(tracks)

    ext_routes, stations = [], []
    for ext in cfg["extensions"]:
        edge = ext["edge"]
        near_edge = (lambda q: q[2] < BOUNDS["minZ"] + 80) if edge == "north" else (lambda q: q[2] > BOUNDS["maxZ"] - 80)
        mine = []
        for ri, r in enumerate(routes):
            p = r["p"]
            for at_end in (True, False):
                if not near_edge(p[-1] if at_end else p[0]):
                    continue
                m = match_track(tracks, grid, p, at_end)
                if not m:
                    print(f"  route {ri} {r['line']}: 続きの線路が見つからない")
                    continue
                i, k, heading, E = m
                path = follow(tracks, grid, i, k, heading)
                P = resample(path)
                _, k0 = nearest_on(P, E[0], E[2])
                P = P[k0:]
                ox, oz = E[0] - P[0][0], E[2] - P[0][1]
                P = [(x + ox * max(0, 1 - n * STEP / BLEND), z + oz * max(0, 1 - n * STEP / BLEND)) for n, (x, z) in enumerate(P)][1:]
                mine.append({"route": ri, "line": r["line"], "at": "end" if at_end else "start", "P": P, "E": E, "off": math.hypot(ox, oz)})
        # 最後の駅の先 beyond m で切る (駅の近くを通らない線は、通る線と同じ長さ)
        last = ext["stations"][-1]
        lx, lz = to_local(last["lat"], last["lon"])
        cuts = []
        for er in mine:
            d, k = nearest_on(er["P"], lx, lz)
            er["cut"] = k + int(ext.get("beyond", 700) / STEP) if d < 80 else None
            if er["cut"] is not None:
                cuts.append(er["cut"])
        for er in mine:
            c = er["cut"] if er["cut"] is not None else (max(cuts) if cuts else len(er["P"]))
            er["P"] = er["P"][:c]
            print(f"  route {er['route']} {er['line']} {er['at']}: +{len(er['P']) * STEP:.0f} m (端のずれ {er['off']:.1f} m)")
        for er in mine:
            hs, flag = profile(er["P"], lines)
            y0 = er["E"][1]
            er["y"] = [y0 + (h - y0) * min(1, (n + 1) * STEP / (BLEND + 50)) for n, h in enumerate(hs)]
        for st in ext["stations"]:
            s_ = build_station(st, mine, lines)
            if s_:
                stations.append(s_)
        ext_routes += mine

    # 同じ軌道を 2 本の道筋が使っていないか
    for a in ext_routes:
        for b in ext_routes:
            if a is not b and a["route"] < b["route"] and a["P"] and b["P"]:
                d, _ = nearest_on(b["P"], *a["P"][len(a["P"]) // 2])
                if d < 1.5:
                    print(f"  注意: route {a['route']} と {b['route']} が同じ線路を通る")

    # ---------- 出力する道筋 ("start" は外の端から地図の端へ向かう順) ----------
    out_routes = []
    for er in ext_routes:
        pts = [[round(x, 2), round(y, 2), round(z, 2)] for (x, z), y in zip(er["P"], er["y"])]
        n = len(pts)
        stops = []
        for k, name in er.get("stops_k", []):
            kk = n - 1 - k if er["at"] == "start" else k
            stops.append({"s": round(kk * STEP + CARS[er["line"]] * CAR / 2, 1), "name": name})
        if er["at"] == "start":
            pts = pts[::-1]
        stops.sort(key=lambda q: q["s"])
        out_routes.append({"route": er["route"], "line": er["line"], "at": er["at"], "p": pts, "stops": stops})

    allP = [p for er in ext_routes for p in er["P"][::2]]
    trackP = [p for er in ext_routes for p in er["P"]]
    grid100 = {}
    for x, z in allP:
        grid100.setdefault((int(x // 100), int(z // 100)), []).append((x, z))

    def near_track(x, z, r):
        gx, gz = int(x // 100), int(z // 100)
        R = int(r // 100) + 1
        r2 = r * r
        for i in range(gx - R, gx + R + 1):
            for j in range(gz - R, gz + R + 1):
                for px, pz in grid100.get((i, j), ()):
                    if (px - x) ** 2 + (pz - z) ** 2 < r2:
                        return True
        return False

    # ---------- 地形 ----------
    minx = min(p[0] for p in allP) - BAND - 20
    maxx = max(p[0] for p in allP) + BAND + 20
    minz = min(p[1] for p in allP) - BAND - 20
    maxz = max(p[1] for p in allP) + BAND + 20
    x0, z0 = math.floor(minx / T_STEP) * T_STEP, math.floor(minz / T_STEP) * T_STEP
    nx, nz = int((maxx - x0) / T_STEP) + 1, int((maxz - z0) / T_STEP) + 1
    rows, cells = [], 0
    for j in range(nz):
        z = z0 + j * T_STEP
        span = None
        for i in range(nx):
            x = x0 + i * T_STEP
            if near_track(x, z, BAND) and not inside_map(x, z, 30):
                v = dem(x, z)
                if span is None:
                    span = [j, i]
                    rows.append(span)
                span.append(round((0.0 if v is None else v) * 100))
                cells += 1
            else:
                span = None
    terrain = {"step": T_STEP, "x0": x0, "z0": z0, "nx": nx, "nz": nz, "rows": rows}
    print(f"細かい地形: {cells} 点")

    cx0 = math.floor((min(p[0] for p in allP) - C_PAD) / C_STEP) * C_STEP
    cz0 = math.floor((min(p[1] for p in allP) - C_PAD) / C_STEP) * C_STEP
    cx1, cz1 = max(p[0] for p in allP) + C_PAD, max(p[1] for p in allP) + C_PAD
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

    # ---------- 道路 (国土地理院の道路中心線。高架は除く。線路の近くで、地図の外だけ) ----------
    RANK_W = {"3m未満": 2.5, "3m-5.5m未満": 4.5, "5.5m-13m未満": 8.0, "13m-19.5m未満": 15.0, "19.5m以上": 22.0}
    out_roads = []
    for rd in roads:
        pr = rd["props"]
        if pr.get("vt_lvorder", 0) != 0 or pr.get("vt_motorway") == 1:
            continue
        w = (pr.get("vt_width") or 0) / 100 or RANK_W.get(pr.get("vt_rnkwidth"), 4.0)
        w = max(2.5, min(30.0, w))
        cur = []
        for x, z in rd["pts"]:
            if near_track(x, z, BAND - 10) and not inside_map(x, z, -5):
                cur += [round(x, 1), round(z, 1)]
            else:
                if len(cur) >= 4:
                    out_roads.append([round(w, 1)] + cur)
                cur = []
        if len(cur) >= 4:
            out_roads.append([round(w, 1)] + cur)
    print(f"道路: {len(out_roads)}")

    # ---------- 木: 建物・線路・道路から離れた所に、9 m 四方に 1 本くらい (決まりで散らす) ----------
    bgrid = set()
    for ring, _, _, _ in buildings:
        xs, zs = [q[0] for q in ring], [q[1] for q in ring]
        for i in range(int((min(xs) - 6) // 5), int((max(xs) + 6) // 5) + 1):
            for j in range(int((min(zs) - 6) // 5), int((max(zs) + 6) // 5) + 1):
                bgrid.add((i, j))
    rgrid = set()
    for rd in out_roads:
        w = rd[0]
        pts = list(zip(rd[1::2], rd[2::2]))
        for (ax, az), (bx, bz) in zip(pts, pts[1:]):
            L = math.hypot(bx - ax, bz - az)
            for t in range(int(L / 2) + 1):
                x, z = ax + (bx - ax) * t * 2 / max(L, 1e-6), az + (bz - az) * t * 2 / max(L, 1e-6)
                r = w / 2 + 2
                for i in range(int((x - r) // 5), int((x + r) // 5) + 1):
                    for j in range(int((z - r) // 5), int((z + r) // 5) + 1):
                        rgrid.add((i, j))
    tgrid = set()
    for x, z in trackP:
        for i in range(int((x - 10) // 5), int((x + 10) // 5) + 1):
            for j in range(int((z - 10) // 5), int((z + 10) // 5) + 1):
                tgrid.add((i, j))
    trees = []
    for row in rows:
        j, i0 = row[0], row[1]
        if j % 2:
            continue
        for k in range(0, len(row) - 2, 2):
            x, z = x0 + (i0 + k) * T_STEP, z0 + j * T_STEP
            hsh = (int(x * 73856093) ^ int(z * 19349663)) & 0xFFFF
            if hsh / 0xFFFF > 0.45:
                continue
            x += (hsh % 97) / 97 * 6 - 3
            z += (hsh % 89) / 89 * 6 - 3
            key = (int(x // 5), int(z // 5))
            if key in bgrid or key in rgrid or key in tgrid or inside_map(x, z, -10):
                continue
            v = dem(x, z)
            trees.append([round(x, 1), round(v or 0, 1), round(z, 1), round(0.75 + (hsh % 53) / 53 * 0.6, 2)])
    print(f"木: {len(trees)}")

    # ---------- トンネルの坑口: 地形がレールの下面より TUNNEL_D m 以上高くなる所 ----------
    portals = []
    for er in ext_routes:
        P, Y = er["P"], er["y"]
        flags = []
        for k in range(len(P)):
            g = dem(*P[k])
            flags.append(g is not None and g - (Y[k] - RAIL_TOP) > TUNNEL_D)
        # 40 m より短い「中」(陸橋・建物の跡などの、標高タイルの点の飛び) はトンネルとみなさない
        k = 0
        while k < len(flags):
            if flags[k]:
                j = k
                while j < len(flags) and flags[j]:
                    j += 1
                if (j - k) * STEP < 40:
                    for q in range(k, j):
                        flags[q] = False
                k = j
            else:
                k += 1
        er["tunnel"] = flags
        prev = None
        for k in range(len(P)):
            inside = flags[k]
            if prev is not None and inside != prev and 0 < k < len(P) - 1:
                dx, dz = P[k + 1][0] - P[k - 1][0], P[k + 1][1] - P[k - 1][1]
                yaw = math.atan2(dx, dz) + (math.pi if inside else 0.0)   # 坑口の面はトンネルの外を向く
                portals.append([P[k][0], Y[k] - RAIL_TOP, P[k][1], yaw, 5.5])
            prev = inside
    merged = []
    for q in portals:   # 近い坑口 (並んだ線路) は 1 つの広い坑口にまとめる
        for m in merged:
            if math.hypot(m[0] - q[0], m[2] - q[2]) < 12 and abs(math.atan2(math.sin(m[3] - q[3]), math.cos(m[3] - q[3]))) < 0.5:
                n = m[5]
                m[0], m[1], m[2] = (m[0] * n + q[0]) / (n + 1), min(m[1], q[1]), (m[2] * n + q[2]) / (n + 1)
                m[4] = max(m[4], 5.5 + math.hypot(m[0] - q[0], m[2] - q[2]) * 2)
                m[5] += 1
                break
        else:
            merged.append(q + [1])
    portals = [[round(m[0], 2), round(m[1], 2), round(m[2], 2), round(m[3], 3), round(m[4], 1)] for m in merged]
    print(f"坑口: {len(portals)}")

    # ---------- 架線柱: 道筋ごとに 50 m おき、進む向きの左 2.5 m (トンネルの中は除く) ----------
    poles = []
    for er in ext_routes:
        P, Y = er["P"], er["y"]
        for k in range(4, len(P) - 1, 10):
            if er["tunnel"][k]:
                continue
            dx, dz = P[k + 1][0] - P[k - 1][0], P[k + 1][1] - P[k - 1][1]
            L = math.hypot(dx, dz) or 1
            lx, lz = dz / L, -dx / L
            poles.append([round(P[k][0] + lx * 2.5, 2), round(Y[k] - RAIL_TOP, 2), round(P[k][1] + lz * 2.5, 2), round(math.atan2(dx, dz), 3)])

    OUT.write_text(json.dumps({
        "source": "国土地理院ベクトルタイル・標高タイル、国土交通省 PLATEAU 横浜市 (2024)",
        "routes": out_routes, "stations": stations, "terrain": terrain, "coarse": coarse, "buildings": buildings,
        "poles": poles, "roads": out_roads, "trees": trees, "portals": portals,
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


def find_station(name, lat, lon):
    """目安の緯度経度のまわり (約 2 km) のタイルから、名前を含む注記 (駅名など) と、JR・私鉄の「駅部分」の線を探して表示する"""
    pad = 0.012
    tracks, lines, _ = load_gsi((lat - pad, lon - pad * 1.2, lat + pad, lon + pad * 1.2))
    x0, y0 = tile_xy(lat + pad, lon - pad * 1.2, 16)
    x1, y1 = tile_xy(lat - pad, lon + pad * 1.2, 16)
    for ty in range(int(y0), int(y1) + 1):
        for tx in range(int(x0), int(x1) + 1):
            L = decode((CACHE / f"16_{tx}_{ty}.pbf").read_bytes())
            lay = L.get("Anno")
            if not lay:
                continue
            for f in lay["features"]:
                t = str(f["props"].get("vt_text", ""))
                if name in t:
                    g = f["geom"][0][0]
                    la, lo = to_latlon(tx + g[0] / lay["extent"], ty + g[1] / lay["extent"], 16)
                    x, z = to_local(la, lo)
                    print(f"注記 {t}: lat {la:.6f} lon {lo:.6f} (x {x:.0f}, z {z:.0f})")
    for ln in lines:
        if ln["props"].get("vt_sngldbl") == "駅部分" and ln["props"].get("vt_railstate") != "地下":
            xs = [p[0] for p in ln["pts"]]; zs = [p[1] for p in ln["pts"]]
            cx, cz = sum(xs) / len(xs), sum(zs) / len(zs)
            la, lo = to_ll(cx, cz)
            print(f"駅部分 ({ln['props'].get('vt_rtcode')}): 中央 lat {la:.6f} lon {lo:.6f} (x {cx:.0f}, z {cz:.0f})、長さ {sum(math.hypot(ln['pts'][i+1][0]-ln['pts'][i][0], ln['pts'][i+1][1]-ln['pts'][i][1]) for i in range(len(ln['pts'])-1)):.0f} m")


def plot(path):
    """rail_ext.json と地図の範囲の平面図 (線: 東海道 = 橙、横須賀 = 青、貨物 = 灰。ホーム = 赤。坑口 = 黒丸)"""
    from PIL import Image, ImageDraw
    E = json.loads(OUT.read_text())
    pts = [(q[0], q[2]) for r in E["routes"] for q in r["p"]]
    x0 = min(min(p[0] for p in pts), BOUNDS["minX"]) - 100; x1 = max(max(p[0] for p in pts), BOUNDS["maxX"]) + 100
    z0 = min(min(p[1] for p in pts), BOUNDS["minZ"]) - 100; z1 = max(max(p[1] for p in pts), BOUNDS["maxZ"]) + 100
    k = min(2000 / (x1 - x0), 2000 / (z1 - z0))
    im = Image.new("RGB", (int((x1 - x0) * k), int((z1 - z0) * k)), "white")
    d = ImageDraw.Draw(im)
    T = lambda x, z: ((x - x0) * k, (z - z0) * k)
    d.rectangle([T(BOUNDS["minX"], BOUNDS["minZ"]), T(BOUNDS["maxX"], BOUNDS["maxZ"])], outline=(160, 160, 160))
    for rd in E.get("roads", []):
        d.line([T(rd[i], rd[i + 1]) for i in range(1, len(rd) - 1, 2)], fill=(235, 220, 170), width=1)
    for b in E["buildings"]:
        d.polygon([T(*q) for q in b[0]], fill=(205, 205, 205) if not b[3] else (150, 150, 250))
    col = {"tokaido": (240, 138, 28), "yokosuka": (31, 95, 174), "freight": (110, 110, 110)}
    for r in E["routes"]:
        d.line([T(q[0], q[2]) for q in r["p"]], fill=col.get(r["line"], (0, 0, 0)), width=2)
    for st in E.get("stations", []):
        pf = st["platform"]
        d.polygon([T(*q) for q in pf["left"] + pf["right"][::-1]], fill=(230, 30, 30))
        d.text(T(*st["center"]), st["name"], fill=(0, 0, 0))
    for q in E.get("portals", []):
        x, z = T(q[0], q[2])
        d.ellipse([x - 4, z - 4, x + 4, z + 4], fill=(0, 0, 0))
    im.save(path)
    print(f"-> {path}")


if __name__ == "__main__":
    import sys
    a = sys.argv[1:]
    if a[:1] == ["--find"]:
        la, lo = (float(v) for v in a[2].split(","))
        find_station(a[1], la, lo)
    elif a[:1] == ["--plot"]:
        plot(a[1])
    else:
        main()
