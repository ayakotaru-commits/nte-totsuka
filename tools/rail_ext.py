"""線路を地図の端から先の駅まで延ばす (電車で東戸塚などへ行けるようにする)。延ばす先と駅は data/rail_ext_config.json。

使い方: python tools/rail_ext.py            (初回は国土地理院のタイル・PLATEAU・標高タイルを取る。数分)
        python tools/rail_ext.py --find 保土ケ谷 35.4436,139.5960   (駅の位置を調べる: 目安の緯度経度のまわり 2 km の注記と「駅部分」。設定に書く lat/lon が分かる)
        python tools/rail_ext.py --plot out.png                    (今の data/raw/rail_ext_full.json の平面図: 道筋・ホーム・建物・道路・坑口。確かめる用)
        python tools/rail_ext.py --routes out.json                 (道筋と駅だけを作って書き出す。地形・建物は作らない。たどり方・ホームを確かめる用、1〜2 分)
出力:   data/raw/rail_ext_full.json (全部入り。git に入れない) → tools/rail_ext_split.py で public/data/rail_ext/ (index.json と 1 km 四方の区間ごとのファイル) に分ける。
        下の形は全部入りのもの (区間のファイルの形は rail_ext_split.py の先頭)
  routes:   [{route: props.json の rail.routes の番号, line, at: "end" (道筋の終わりに足す) | "start" (始めに足す),
              p: [[x, y, z], ...] (約 5 m おき。y = レールの上面。"start" は延長の先から地図の端へ向かう順 = そのまま前につなげる順),
              stops: [{s: 止まる位置 (先頭の、p の始点からの距離 m), name: 駅名}]}]
  stations: [{name, kana, roman, ward, platforms: [{left, right, y} (戸塚の rail.platforms と同じ形), ...], canopies: [同じ形, ...] (ホームごと), center: [x, z]}]
  terrain:  線路の近く (BAND m 以内) の細かい地形 {step, x0, z0, nx, nz, rows: [[j, i0, h(cm), ...], ...]}
  coarse:   その外の粗い地形 {step, x0, z0, nx, nz, h: [cm, ...]} (地図の範囲の中も含めて全部)
  buildings: 線路の近くの建物 [[[[x, z], ...] 輪郭, 足元の y, 高さ, 下端 (線路をまたぐ駅舎など。0 = 地面から)], ...]
  poles:    架線柱 [[x, y, z, 向き], ...]
  roads:    道路 [[幅 m, x0, z0, x1, z1, ...], ...] (国土地理院の道路中心線。高架は除く)
  trees:    木 [[x, y, z, 大きさ], ...] (建物・線路・道路から離れた所に、決まりで散らす。実物の位置ではない)
  portals:  トンネルの坑口 [[x, y (レールの下), z, 向き (トンネルの外へ), 幅], ...]
出典: 国土地理院ベクトルタイル (鉄道中心線・軌道の中心線・道路中心線)、国土地理院 標高タイル、国土交通省 PLATEAU 横浜市 (2024)・川崎市 (2022)・東京都 23 区 (2020)
線路の高さは標高タイル (地表) + 0.55 m を均したもの。橋・トンネルの区間 (鉄道中心線の種類) は両端を直線で結び、勾配は 2.5 % まで。
"""
import json
import math
import pathlib
import time
import urllib.error
import urllib.request

import numpy as np

import fetch_dem
from config import BOUNDS, ORIGIN_LAT, ORIGIN_LON, _M_LAT, _M_LON
from fetch_gsi import URL as GSI_URL, UA, tile_xy, to_latlon
from fetch_plateau import ZIP_URL, mesh3

# PLATEAU の建物 (市ごとの CityGML の zip。中のメッシュごとのファイルだけを読む)
PLATEAU_SRC = [
    ("yokohama", ZIP_URL),   # 横浜市 2024
    ("kawasaki", "https://assets.cms.plateau.reearth.io/assets/40/25bd0a-f174-4f55-a9bd-0e6868ece0ae/14130_kawasaki-shi_city_2022_citygml_4_op.zip"),   # 川崎市 2022
    ("tokyo23", "https://assets.cms.plateau.reearth.io/assets/ec/d51c64-a47f-4a56-aa64-340d1d3c720b/13100_tokyo23-ku_2020_citygml_4_2_op.zip"),   # 東京都 23 区 2020
]
from mvt import decode

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "raw" / "gsi_ext"
PCACHE = ROOT / "data" / "raw" / "plateau"
OUT = ROOT / "data" / "raw" / "rail_ext_full.json"   # 全部入り (git に入れない)。rail_ext_split.py が public/data/rail_ext/ に区間ごとに分ける

CONFIG = ROOT / "data" / "rail_ext_config.json"
MAX_LEN = 45000.0      # たどる長さの上限 (m)。東京まで約 41 km
LOOK = 2000.0          # 分かれ道で試しにたどる長さ (m)。行き止まりの留置線を選ばないため
MATCH_IN = 15.0        # 道筋の端から地図の内側へこの距離の点で、国土地理院の軌道と突き合わせる
TUNNEL_D = 7.0         # 地形がレールの下面よりこれ以上高い所をトンネルとみなす (坑口を置く)
STEP = 5.0             # 道筋の点の間隔
RAIL_TOP = 0.55        # 地面からのレールの上面 (build_props.py と同じ)
BLEND = 150.0          # 地図の端の道筋 (OSM) と国土地理院の線路の、位置のずれを均す長さ
BAND = 350.0           # 細かい地形・建物を作る、線路からの距離
T_STEP = 5.0           # 細かい地形の間隔
C_STEP = 25.0          # 粗い地形の間隔
C_PAD = 2500.0         # 粗い地形の、線路からの広さ (かすみで見えなくなる距離。look.js の far)
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


def dem0(x, z):
    """dem の値。標高タイルに値の無い所 (海) は海面 (標高 0 m)"""
    v = dem(x, z)
    return -REF if v is None else v


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


def bbox_tiles(bbox):
    LAT0, LON0, LAT1, LON1 = bbox
    x0, y0 = tile_xy(LAT1, LON0, 16)
    x1, y1 = tile_xy(LAT0, LON1, 16)
    return {(tx, ty) for ty in range(int(y0), int(y1) + 1) for tx in range(int(x0), int(x1) + 1)}


def load_gsi(bbox=None, tiles=None):
    """bbox = (南, 西, 北, 東) の範囲 (または tiles = {(tx, ty)}) のタイルから、軌道の中心線・鉄道中心線・道路中心線"""
    CACHE.mkdir(parents=True, exist_ok=True)
    if tiles is None:
        tiles = bbox_tiles(bbox)
    tracks, lines, roads = [], [], []
    for ty, tx in sorted((ty, tx) for tx, ty in tiles):
        p = CACHE / f"16_{tx}_{ty}.pbf"
        if not p.exists():
            for attempt in range(5):   # 通信が切れたら取り直す
                try:
                    with urllib.request.urlopen(urllib.request.Request(GSI_URL.format(z=16, x=tx, y=ty), headers=UA), timeout=60) as r:
                        p.write_bytes(r.read())
                    break
                except urllib.error.HTTPError as e:   # 海の上など、地物の無いタイルは 404
                    if e.code != 404:
                        raise
                    p.write_bytes(b"")
                    break
                except (ConnectionError, TimeoutError, urllib.error.URLError):
                    if attempt == 4:
                        raise
                    time.sleep(2 * (attempt + 1))
            time.sleep(0.05)
        raw = p.read_bytes()
        L = decode(raw) if raw else {}
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


def follow(tracks, grid, start_i, start_k, heading, look=LOOK, vias=()):
    """軌道 start_i の点 start_k から heading の向きへたどった点の列。線の終わりでは、終わりの点から 1 m 以内を通る別の線
    (向きのそろったもの) に乗り移る。分かれ道では、それぞれ look m 先まで試しにたどり、行き止まり (留置線など) にならない線のうち
    いちばんまっすぐなもの (品川駅の北で、下り線が札の辻の留置線に入って止まった)"""
    t = tracks[start_i]["pts"]
    a, b = t[start_k], t[min(start_k + 1, len(t) - 1)]
    fwd = (b[0] - a[0]) * heading[0] + (b[1] - a[1]) * heading[1] > 0
    path = list(t[start_k + 1:]) if fwd else list(reversed(t[:start_k + 1]))
    path.insert(0, a if fwd else b)
    return extend(tracks, grid, path, {start_i}, MAX_LEN, look, vias)


def path_len(path, i0=0):
    return sum(math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]) for i in range(i0, len(path) - 1))


def next_tracks(tracks, grid, path, used):
    """今の終わりから乗り移れる線の候補 [(点数, j, k, u, 向き)] (線ごとにいちばん点数の高い線分)。
    1 m 以内に無ければ、タイルの境目のすき間を越えた先の 1 本"""
    tail = path[-1]
    dx, dz = tail[0] - path[-2][0], tail[1] - path[-2][1]
    L = math.hypot(dx, dz) or 1
    cands = {}
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
        if j not in cands or score > cands[j][0]:
            cands[j] = (score, j, k, u, cos > 0)
    if cands:
        return sorted(cands.values(), key=lambda c: -c[0])
    # タイルの境目のすき間: 60 m 先までの、今の向きの延長線から 1.5 m (+ 先へ行くほど少し広く) 以内の線
    best = None
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
    return [best] if best else []


def take(tracks, path, used, cand):
    """候補 cand の線に乗り移る (path・used を書き換える)"""
    tail = path[-1]
    dx, dz = tail[0] - path[-2][0], tail[1] - path[-2][1]
    L = math.hypot(dx, dz) or 1
    _, j, k, u, f = cand
    used.add(j)
    P = tracks[j]["pts"]
    nxt = P[k + 1:] if f else list(reversed(P[:k + 1]))
    # 重なっている所は飛ばし、今の終わりより先の点だけを足す
    for q in nxt:
        if (q[0] - tail[0]) * dx + (q[1] - tail[1]) * dz > 0.5 * L:
            path.append(q)


def track_near(tracks, j, x, z, r):
    P = tracks[j]["pts"]
    for k in range(len(P) - 1):
        (ax, az), (bx, bz) = P[k], P[k + 1]
        ex, ez = bx - ax, bz - az
        l2 = ex * ex + ez * ez or 1
        u = max(0.0, min(1.0, ((x - ax) * ex + (z - az) * ez) / l2))
        if math.hypot(x - ax - ex * u, z - az - ez * u) < r:
            return True
    return False


def route_to(tracks, grid, path, used, target, max_d=4000.0, hop=30.0):
    """今の終わりから、target (x, z) の 3 m 以内を通る線まで、線路のつながりをたどる最短の道 (乗り移るたびに hop m を足す)。
    見つかれば path・used に足して True"""
    import heapq
    tx, tz = target
    heap, n = [], 0
    for c in next_tracks(tracks, grid, path, used):
        heap.append((0.0, n, c, None)); n += 1
    heapq.heapify(heap)
    seen = set()
    while heap:
        cost, _, c, back = heapq.heappop(heap)
        _, j, k, u, f = c
        if (j, f) in seen or cost > max_d:
            continue
        seen.add((j, f))
        chain = (c, back)
        if track_near(tracks, j, tx, tz, 3.0):
            seq = []
            while chain:
                seq.append(chain[0]); chain = chain[1]
            for q in reversed(seq):
                take(tracks, path, used, q)
            return True
        P = tracks[j]["pts"]
        seg = P[k:] if f else P[:k + 2][::-1]
        tail2 = [P[-2], P[-1]] if f else [P[1], P[0]]
        u2 = used | {j}
        for c2 in next_tracks(tracks, grid, tail2, u2):
            heapq.heappush(heap, (cost + path_len(seg) + hop, n, c2, chain)); n += 1
    return False


def extend(tracks, grid, path, used, max_len, look, vias=()):
    """vias = 通る点 [(x, z)]。終わりが 1.5 km 以内に来たら、最短のつながりでその点を通る線へ (品川駅の下り線が 12 番線を通るように)"""
    vias = list(vias)
    plen, counted = path_len(path), len(path) - 1
    while plen < max_len and len(path) >= 2:
        plen += path_len(path, counted)
        counted = len(path) - 1
        if vias and math.hypot(path[-1][0] - vias[0][0], path[-1][1] - vias[0][1]) < 1500:
            v = vias.pop(0)
            if not route_to(tracks, grid, path, used, v):
                print(f"  通る点 ({v[0]:.0f}, {v[1]:.0f}) へ線路がつながらない")
            continue
        cands = next_tracks(tracks, grid, path, used)
        if not cands:
            break
        best = cands[0]
        if look and len(cands) > 1:
            # 分かれ道: それぞれ look m 先まで (分かれ道ではいちばんまっすぐな線で) たどり、遠くまで行けるものを選ぶ (同じなら点数の高いもの)
            def reach(c):
                p2, u2 = path[-2:], set(used)
                base = path_len(p2)
                take(tracks, p2, u2, c)
                return min(look, path_len(extend(tracks, grid, p2, u2, base + look, 0)) - base)
            best = max(cands, key=lambda c: (reach(c), c[0]))
        take(tracks, path, used, best)
    return path


def near_mask(pts, x0, z0, step, nx, nz, r):
    """格子 (原点 x0, z0・間隔 step・nx × nz 点) の点のうち、pts のどれかとの距離が r 未満のもの (main の near_track と同じ判定)"""
    m = np.zeros((nz, nx), dtype=bool)
    r2 = r * r
    for px, pz in pts:
        i0, i1 = max(0, math.floor((px - r - x0) / step)), min(nx - 1, math.ceil((px + r - x0) / step))
        j0, j1 = max(0, math.floor((pz - r - z0) / step)), min(nz - 1, math.ceil((pz + r - z0) / step))
        if i0 > i1 or j0 > j1:
            continue
        xs = x0 + np.arange(i0, i1 + 1) * step
        zs = z0 + np.arange(j0, j1 + 1) * step
        m[j0:j1 + 1, i0:i1 + 1] |= ((px - xs) ** 2)[None, :] + ((pz - zs) ** 2)[:, None] < r2
    return m


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
    sgrid = {}   # 線分の索引 (50 m 四方。線分の外接矩形 ± 15 m にかかる升目)
    for s in seg:
        for i in range(len(s) - 1):
            (ax, az), (bx, bz) = s[i], s[i + 1]
            for gx in range(int((min(ax, bx) - 15) // 50), int((max(ax, bx) + 15) // 50) + 1):
                for gz in range(int((min(az, bz) - 15) // 50), int((max(az, bz) + 15) // 50) + 1):
                    sgrid.setdefault((gx, gz), []).append((ax, az, bx, bz))
    flag = []
    for x, z in P:
        f = False
        for ax, az, bx, bz in sgrid.get((int(x // 50), int(z // 50)), ()):
            ex, ez = bx - ax, bz - az
            l2 = ex * ex + ez * ez or 1
            t = max(0, min(1, ((x - ax) * ex + (z - az) * ez) / l2))
            if math.hypot(x - ax - ex * t, z - az - ez * t) < 15:
                f = True
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


def station_platforms(st):
    """設定の駅のホームの一覧。platforms が無ければ、昔の書き方 (lines[0] の上下線の間の島式 1 面)"""
    if st.get("platforms"):
        return st["platforms"]
    return [{"line": st["lines"][0], "type": st.get("platform", "island")}]


def build_station(st, ext_routes, tracks, grid):
    """駅 st (設定) のホーム (複数)。platforms の 1 つずつ:
    island = 線 line の上下線の間の島式 1 面 (東戸塚・保土ケ谷・横浜の横須賀線)
    outer  = 線 line の上下線それぞれの外側 (反対の向きの線と逆の側) の、隣の線路 (待避線など。電車は走らない) との間の島式 1 面ずつ
             (横浜の東海道線: 本線の 6・7 番線は隣り合い、ホームは 5・6 番線の間と 7・8 番線の間)"""
    cx, cz = to_local(st["lat"], st["lon"])
    plats = []
    for spec in station_platforms(st):
        px, pz = (to_local(spec["lat"], spec["lon"]) if "lat" in spec else (cx, cz))
        line = spec["line"]
        yk = [er for er in ext_routes if er["line"] == line and nearest_on(er["P"], px, pz)[0] < 80]
        if len(yk) != 2:
            print(f"  {st['name']}: {line} の上下線が 2 本見つからない ({len(yk)} 本)。このホームを作らない")
            continue
        typ = spec.get("type", "island")
        if typ == "island":
            pf = island_between(st, spec, yk[0], yk[1], px, pz)
            if pf:
                plats.append(pf)
        elif typ in ("outer", "inner"):
            for A, O in ((yk[0], yk[1]), (yk[1], yk[0])):
                if spec.get("only") and not side_is(spec["only"], A, O, px, pz):
                    continue
                pf = outer_platform(st, spec, A, O, px, pz, tracks, grid, inner=typ == "inner")
                if pf:
                    plats.append(pf)
        else:
            print(f"  {st['name']}: ホームの種類 {typ} は作れない (island / outer)")
    if not plats:
        print(f"  {st['name']}: ホームが 1 つもできない。駅を作らない")
        return None
    pc = plats[0]["center"]
    return {"name": st["name"], "kana": st.get("kana", ""), "roman": st.get("roman", ""), "ward": st.get("ward", ""), "city": st.get("city", "横浜市"),
            "center": [round(sum(q["center"][0] for q in plats) / len(plats), 2), round(sum(q["center"][1] for q in plats) / len(plats), 2)],
            "platforms": [q["platform"] for q in plats], "canopies": [q["canopy"] for q in plats],
            **({"site": dict(st["site"])} if st.get("site") else {})}


def make_platform(st, spec, A, ka, pairs, stop_routes):
    """A の点 ka のまわりの、縁の点の組 pairs = [(k (A の点の番号), a, b, y)] からホーム。a → b の向きに 1.62 m ずつ内側が縁"""
    left, right, ys = [], [], []
    for k, a, b, y in pairs:
        d = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
        ux, uz = (b[0] - a[0]) / d, (b[1] - a[1]) / d
        left.append([round(a[0] + ux * 1.62, 2), round(a[1] + uz * 1.62, 2)])
        right.append([round(b[0] - ux * 1.62, 2), round(b[1] - uz * 1.62, 2)])
        ys.append(round(y + PLAT_Y, 2))
    m = len(left) // 2
    c0, c1 = max(0, m - 20), min(len(left), m + 20)
    pc = [round((left[m][0] + right[m][0]) / 2, 2), round((left[m][1] + right[m][1]) / 2, 2)]
    for er in stop_routes:   # 止まる位置: 編成の中央がホームの中央に来る所 (先頭の位置。P の並び = 地図の端から外へ)
        _, k = nearest_on(er["P"], *pc)
        er.setdefault("stops_k", []).append((k, st["name"]))
    return {"center": pc, "platform": {"left": left, "right": right, "y": ys},
            "canopy": {"left": left[c0:c1], "right": right[c0:c1], "y": [v + 3.4 for v in ys[c0:c1]]}}


def island_between(st, spec, A, B, cx, cz):
    _, ka = nearest_on(A["P"], cx, cz)
    _, kb = nearest_on(B["P"], *A["P"][ka])
    gap = math.hypot(A["P"][ka][0] - B["P"][kb][0], A["P"][ka][1] - B["P"][kb][1])
    print(f"  {st['name']}駅: 中心の目安 ({cx:.0f}, {cz:.0f})、{spec['line']} の 2 本の間 {gap:.1f} m")
    if not 7 < gap < 20:
        print("    島式ホームにしては間が狭すぎる・広すぎる。このホームを作らない")
        return None
    pairs = []
    half = int(spec.get("length", st.get("length", PLAT_LEN)) / 2 / 4)
    for n in range(-half, half + 1):
        k = max(0, min(len(A["P"]) - 1, ka + round(n * 4 / STEP)))
        a = A["P"][k]
        _, kb2 = nearest_on(B["P"], *a)
        pairs.append((k, a, B["P"][kb2], (A["y"][k] + B["y"][kb2]) / 2))
    return make_platform(st, spec, A, ka, pairs, [A, B])


def side_track(tracks, grid, a, t, w, lo=5.0, hi=20.0):
    """点 a (線路の上) から、線路の向き t に直角な向き w の側の、lo〜hi m 先にある平行な軌道の点 (いちばん近いもの)。無ければ None"""
    best = None
    R = int(hi // 5) + 1
    for gx in range(int(a[0] // 5) - R, int(a[0] // 5) + R + 1):
        for gz in range(int(a[1] // 5) - R, int(a[1] // 5) + R + 1):
            for i, k in grid.get((gx, gz), ()):
                (ax, az), (bx, bz) = tracks[i]["pts"][k], tracks[i]["pts"][k + 1]
                ex, ez = bx - ax, bz - az
                l2 = ex * ex + ez * ez
                if l2 < 1e-6 or abs(ex * t[0] + ez * t[1]) / math.sqrt(l2) < 0.985:
                    continue
                u = max(0.0, min(1.0, ((a[0] - ax) * ex + (a[1] - az) * ez) / l2))
                qx, qz = ax + ex * u, az + ez * u
                along = (qx - a[0]) * t[0] + (qz - a[1]) * t[1]
                lat = (qx - a[0]) * w[0] + (qz - a[1]) * w[1]
                if abs(along) < 1.5 and lo <= lat <= hi and (best is None or lat < best[0]):
                    best = (lat, (qx, qz))
    return best


def side_is(only, A, O, cx, cz):
    """道筋 A が、もう 1 本の O より only (west / east / north / south) の側にあるか (駅の中心のそばで比べる)"""
    a = A["P"][nearest_on(A["P"], cx, cz)[1]]
    o = O["P"][nearest_on(O["P"], cx, cz)[1]]
    return {"west": a[0] < o[0], "east": a[0] > o[0], "north": a[1] < o[1], "south": a[1] > o[1]}[only]


def outer_platform(st, spec, A, O, cx, cz, tracks, grid, inner=False):
    """A (止まる線) と、A の外側 (O と逆の側。inner なら O の側) の隣の線路との間のホーム。隣の線路は国土地理院の軌道 (道筋ではない)"""
    _, ka = nearest_on(A["P"], cx, cz)
    half = int(spec.get("length", st.get("length", PLAT_LEN)) / 2 / 4)
    raw = []
    for n in range(-half, half + 1):
        k = max(1, min(len(A["P"]) - 2, ka + round(n * 4 / STEP)))
        a = A["P"][k]
        tx, tz = A["P"][k + 1][0] - A["P"][k - 1][0], A["P"][k + 1][1] - A["P"][k - 1][1]
        tl = math.hypot(tx, tz) or 1
        t = (tx / tl, tz / tl)
        _, ko = nearest_on(O["P"], *a)
        o = O["P"][ko]
        w = (-t[1], t[0])
        if ((o[0] - a[0]) * w[0] + (o[1] - a[1]) * w[1] > 0) != inner:   # O のある側の反対が外側 (inner なら O の側)
            w = (t[1], -t[0])
        raw.append((k, a, w, side_track(tracks, grid, a, t, w)))
    gaps = sorted(r[3][0] for r in raw if r[3])
    if len(gaps) < len(raw) * 0.6:
        print(f"  {st['name']}駅: {spec['line']} route {A['route']} の{'内' if inner else '外'}側に隣の線路が見つからない ({len(gaps)}/{len(raw)})。このホームを作らない")
        return None
    g = gaps[len(gaps) // 2]
    print(f"  {st['name']}駅: {spec['line']} route {A['route']} の{'内' if inner else '外'}側の隣の線路まで {g:.1f} m (見つかった点 {len(gaps)}/{len(raw)})")
    if not 7 < g < 20:
        print("    島式ホームにしては間が狭すぎる・広すぎる。このホームを作らない")
        return None
    pairs = []
    for k, a, w, hit in raw:
        lat = hit[0] if hit and abs(hit[0] - g) < 2.0 else g   # 見つからない・飛んだ所 (分かれ目) は間の中央値
        pairs.append((k, a, (a[0] + w[0] * lat, a[1] + w[1] * lat), A["y"][k]))
    return make_platform(st, spec, A, ka, pairs, [A])


# ---------- 新しい線 (設定の lines。地図の中の道筋の続きではなく、駅から始まる道筋。舞浜までの計画の段階 3a) ----------
UG_GRADE = 0.035       # 新しい線の勾配の上限 (地下鉄・京葉線の坑口の前後は 33 ‰)
UG_DEPTH = 20.0        # 地下の区間の、地面からレールの上面までの深さ (駅の depth が無い所)
UG_COVER = 5.5         # 地面がレールの上面よりこれ以上高い所はトンネルの中 (壁・天井を描く)
EL_MIN = 1.0           # 砕石の下面が地面よりこれ以上高い所は高架 (橋桁・橋脚を描く。段階 3b)
DECK_T = 1.2           # 高架の橋桁の厚さ (砕石の下面から)
PIER_EVERY = 4         # 橋脚の間隔 (道筋の点の数。5 m × 4 = 20 m)
CUT_W = 6.5            # 掘割で地形を下げる、線路からの距離


def own_tracks_at(tracks, grid, cx, cz, h):
    """点 (cx, cz) の 15 m 以内を通り、向き h (単位ベクトル) とそろった軌道のうち、h の左側・右側でいちばん近いもの。
    返り値 {"left": (j, k, t), "right": (j, k, t)} (t = 軌道の向きを h の側にそろえた単位ベクトル)"""
    best = {}
    for gx in range(int(cx // 5) - 3, int(cx // 5) + 4):
        for gz in range(int(cz // 5) - 3, int(cz // 5) + 4):
            for j, k in grid.get((gx, gz), ()):
                (ax, az), (bx, bz) = tracks[j]["pts"][k], tracks[j]["pts"][k + 1]
                ex, ez = bx - ax, bz - az
                l = math.hypot(ex, ez)
                if l < 1e-3:
                    continue
                c = (ex * h[0] + ez * h[1]) / l
                if abs(c) < 0.5:
                    continue
                t = (ex / l, ez / l) if c > 0 else (-ex / l, -ez / l)
                u = max(0.0, min(1.0, ((cx - ax) * ex + (cz - az) * ez) / (l * l)))
                qx, qz = ax + ex * u, az + ez * u
                d = math.hypot(qx - cx, qz - cz)
                if d > 15:
                    continue
                lat = (qx - cx) * t[1] - (qz - cz) * t[0]   # 左 (t を左へ 90°) が正
                side = "left" if lat > 0 else "right"
                if side not in best or abs(lat) < best[side][0]:
                    best[side] = (abs(lat), j, k, t)
    return {s: v[1:] for s, v in best.items()}


def own_path(tracks, grid, j, k, t, fwd_len, back_len, vias=()):
    """軌道 j の線分 k から、t の向きに fwd_len m、反対の向きに back_len m (行き止まりならそこまで) たどった点の列 (t の向きの順)。
    vias = t の向きにたどるときに通る点 [(x, z)]"""
    fw = follow_len(tracks, grid, j, k, t, fwd_len, vias)
    bw = follow_len(tracks, grid, j, k, (-t[0], -t[1]), back_len)
    rb = bw[::-1]
    # rb の終わりと fw の始めは同じ線分 (k) の両端 → rb の終わりの 2 点を落として fw をつなぐ
    return rb[:-2] + fw if len(rb) > 2 else fw


def follow_len(tracks, grid, i, k, heading, max_len, vias=()):
    t = tracks[i]["pts"]
    a, b = t[k], t[min(k + 1, len(t) - 1)]
    fwd = (b[0] - a[0]) * heading[0] + (b[1] - a[1]) * heading[1] > 0
    path = list(t[k + 1:]) if fwd else list(reversed(t[:k + 1]))
    path.insert(0, a if fwd else b)
    return extend(tracks, grid, path, {i}, max_len, LOOK, vias)


def state_flags(P, lines, rtcode, states):
    """点ごとに、鉄道中心線 (rtcode) のうち種類が states のどれかの線が 15 m 以内にあるか"""
    seg = [ln["pts"] for ln in lines if ln["props"].get("vt_railstate") in states and ln["props"].get("vt_rtcode") == rtcode]
    sgrid = {}
    for s in seg:
        for i in range(len(s) - 1):
            (ax, az), (bx, bz) = s[i], s[i + 1]
            for gx in range(int((min(ax, bx) - 15) // 50), int((max(ax, bx) + 15) // 50) + 1):
                for gz in range(int((min(az, bz) - 15) // 50), int((max(az, bz) + 15) // 50) + 1):
                    sgrid.setdefault((gx, gz), []).append((ax, az, bx, bz))
    out = []
    for x, z in P:
        f = False
        for ax, az, bx, bz in sgrid.get((int(x // 50), int(z // 50)), ()):
            ex, ez = bx - ax, bz - az
            l2 = ex * ex + ez * ez or 1
            t = max(0, min(1, ((x - ax) * ex + (z - az) * ez) / l2))
            if math.hypot(x - ax - ex * t, z - az - ez * t) < 15:
                f = True
                break
        out.append(f)
    return out


def own_profile(P, lines, depths, rtcode="JR", viaduct=0.0):
    """新しい線のレールの上面の高さと、トンネルの中か (点ごと)。鉄道中心線が「地下」の所は、地面から depths[k] m 下 (駅の depth を
    線路に沿って直線で補間)。それ以外は profile() と同じ (地形 + 0.55 m、橋は両端を直線で)。viaduct (m) があれば、「橋・高架」の所は
    さらにその高さだけ上げる (京葉線の高架。段階 3b)。最後に勾配を UG_GRADE までにする
    (下へ包む = 地下の深い所はそのまま、浅くなる所・高架の始まりは勾配の分だけ手前から上がる)"""
    surf, _ = profile(P, lines)
    ug = state_flags(P, lines, rtcode, ("地下",))
    if viaduct:
        hi = state_flags(P, lines, rtcode, ("橋・高架",))
        surf = [v + viaduct if hi[k] and not ug[k] else v for k, v in enumerate(surf)]
    y = [dem0(x, z) - depths[k] if ug[k] else surf[k] for k, (x, z) in enumerate(P)]
    # 地下の所を均す (平均 11 点)
    sm = [sum(y[max(0, k - 5):k + 6]) / len(y[max(0, k - 5):k + 6]) if ug[k] else y[k] for k in range(len(y))]
    for k in range(1, len(sm)):
        sm[k] = min(sm[k], sm[k - 1] + UG_GRADE * STEP)
    for k in range(len(sm) - 2, -1, -1):
        sm[k] = min(sm[k], sm[k + 1] + UG_GRADE * STEP)
    tun = [dem0(x, z) - sm[k] > UG_COVER for k, (x, z) in enumerate(P)]
    # 40 m 未満の「外」(地形の凹凸でかぶりが一瞬浅くなる所) はトンネルの中のまま、40 m 未満の「中」は外 (坑口の手前に短い筒が残らない)
    for want in (False, True):
        k = 0
        while k < len(tun):
            if tun[k] == want:
                j = k
                while j < len(tun) and tun[j] == want:
                    j += 1
                if 0 < k and j < len(tun) and (j - k) * STEP < 40:
                    for q in range(k, j):
                        tun[q] = not want
                k = j
            else:
                k += 1
    return sm, tun


def spread_apart(A, B, k_a, want, half):
    """駅のまわりで、2 本の道筋 A・B (点の列) の間を want m に広げる (地下の駅: 国土地理院の軌道は 2 本が約 5 m 間隔で描かれているが、
    島式ホームの駅では 10 m 以上離れる)。A の点 k_a を中心に、half m は全部、その先 150 m で 0 まで減らす。B は A に近い点を同じだけ逆へ"""
    _, k_b = nearest_on(B, *A[k_a])
    gap = math.hypot(A[k_a][0] - B[k_b][0], A[k_a][1] - B[k_b][1])
    if gap >= want:
        return gap
    d = (want - gap) / 2
    for P, kc, O, ko in ((A, k_a, B, k_b), (B, k_b, A, k_a)):
        new = []
        for k, (x, z) in enumerate(P):
            s = abs(k - kc) * STEP
            w = 1.0 if s <= half else (0.5 + 0.5 * math.cos(math.pi * min(1.0, (s - half) / 150.0)))
            if w <= 0.001 or k == 0 or k == len(P) - 1:
                new.append((x, z))
                continue
            tx, tz = P[k + 1][0] - P[k - 1][0], P[k + 1][1] - P[k - 1][1]
            tl = math.hypot(tx, tz) or 1
            nx, nz = -tz / tl, tx / tl
            o = O[min(len(O) - 1, max(0, ko + (k - kc)))]
            if (o[0] - x) * nx + (o[1] - z) * nz > 0:   # 相手のいる側の反対へ
                nx, nz = -nx, -nz
            new.append((x + nx * d * w, z + nz * d * w))
        P[:] = new
    return gap


def build_own_line(L, tracks, grid, lines):
    """設定の新しい線 L (lines の 1 つ) の道筋 2 本 (下り = 最初の駅から外へ、上り = その逆。左側通行) と駅。
    最初の駅が終点 (terminal) なら、道筋は軌道の行き止まりから始まり (下り)、そこで終わる (上り)。返り値 (道筋の一覧, 駅の一覧)"""
    sts = L["stations"]
    c0, c1 = to_local(sts[0]["lat"], sts[0]["lon"]), to_local(sts[1]["lat"], sts[1]["lon"])
    hl = math.hypot(c1[0] - c0[0], c1[1] - c0[1])
    h = ((c1[0] - c0[0]) / hl, (c1[1] - c0[1]) / hl)
    tk = own_tracks_at(tracks, grid, *c0, h)
    if "left" not in tk or "right" not in tk:
        print(f"  {L['name']}: {sts[0]['name']}の近くに上下線の軌道が見つからない ({list(tk)})")
        return [], []
    span = sum(math.hypot(to_local(b["lat"], b["lon"])[0] - to_local(a["lat"], a["lon"])[0],
                          to_local(b["lat"], b["lon"])[1] - to_local(a["lat"], a["lon"])[1]) for a, b in zip(sts, sts[1:]))
    fwd_len = span * 1.6 + L.get("beyond", 700) + 500
    back_len = 600.0 if sts[0].get("terminal") else L.get("before", 400)
    paths = {}
    for side in ("left", "right"):
        j, k, t = tk[side]
        vias = [to_local(v["lat"], v["lon"]) for v in L.get("via", []) if v["dir"] == ("out" if side == "left" else "in")]
        P = resample(own_path(tracks, grid, j, k, t, fwd_len, back_len, vias))
        _, k0 = nearest_on(P, *c0)
        if not sts[0].get("terminal"):
            P = P[max(0, k0 - int(back_len / STEP)):]
        paths[side] = P
    # 最後の駅の先 beyond m で切る
    cl = to_local(sts[-1]["lat"], sts[-1]["lon"])
    for side, P in paths.items():
        d, k = nearest_on(P, *cl)
        if d > 80:
            print(f"  {L['name']}: {side} の道筋が{sts[-1]['name']}の近くを通らない ({d:.0f} m)")
        paths[side] = P[:k + int(L.get("beyond", 700) / STEP)]
    A, B = paths["left"], paths["right"]   # A = 下り (h の向きに左側)、B は h の向きの順 (上りはこの逆)
    # 地下の島式ホーム: 駅のまわりで 2 本の間を広げる
    for st in sts:
        if st.get("spread"):
            cx, cz = to_local(st["lat"], st["lon"])
            _, ka = nearest_on(A, cx, cz)
            gap = spread_apart(A, B, ka, st["spread"], st.get("length", PLAT_LEN) / 2 + 20)
            print(f"  {L['name']} {st['name']}駅: 上下線の間 {gap:.1f} m → {st['spread']} m に広げた")
    # 深さ (駅の depth を線路に沿って補間)
    routes = []
    for side, P, d in (("left", A, "out"), ("right", B, "in")):
        ks = [(nearest_on(P, *to_local(st["lat"], st["lon"]))[1], st.get("depth", L.get("depth", UG_DEPTH))) for st in sts]
        ks.sort()
        dep = []
        for k in range(len(P)):
            if k <= ks[0][0]:
                dep.append(ks[0][1])
            elif k >= ks[-1][0]:
                dep.append(ks[-1][1])
            else:
                for (ka, da), (kb, db) in zip(ks, ks[1:]):
                    if ka <= k <= kb:
                        dep.append(da + (db - da) * (k - ka) / max(1, kb - ka))
                        break
        y, tun = own_profile(P, lines, dep, L.get("rtcode", "JR"), L.get("viaduct", 0.0))
        if d == "in":
            P, y, tun = P[::-1], y[::-1], tun[::-1]
        routes.append({"route": None, "own": L["id"], "line": L["id"], "dir": d, "at": "own", "P": P, "y": y, "tunnel": tun, "ug": tun})
    print(f"  {L['name']}: 道筋 {len(routes[0]['P']) * STEP:.0f} m・{len(routes[1]['P']) * STEP:.0f} m、"
          f"トンネルの中 {sum(routes[0]['ug']) * STEP:.0f} m、レールの高さ {min(routes[0]['y']):.1f}〜{max(routes[0]['y']):.1f} m")
    stations = []
    for st in sts:
        spec_st = dict(st)
        if not spec_st.get("platforms"):
            spec_st["platforms"] = [{"line": L["id"], "type": st.get("platform", "island")}]
        s_ = build_station(spec_st, routes, tracks, grid)
        if s_:
            cx, cz = s_["center"]
            s_["line"] = L["id"]
            s_["lineName"] = L["name"]
            r0 = routes[0]
            _, kc = nearest_on(r0["P"], cx, cz)
            if dem0(cx, cz) - r0["y"][kc] > UG_COVER:
                s_["underground"] = True
            stations.append(s_)
    # 終点の駅: 下りは行き止まりから編成の長さ + 3 m の所で止まって始まり、上りは行き止まりの 5 m 手前で止まって終わる
    n_cars = L.get("cars", 10)
    for er in routes:
        er["cars"] = n_cars
        er["first_rest"] = er["dir"] == "out" and bool(sts[0].get("terminal"))
        er["last_term"] = er["dir"] == "in" and bool(sts[0].get("terminal"))
    return routes, stations


def main(routes_only=None):
    fetch_dem.CACHE.mkdir(parents=True, exist_ok=True)
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    props = json.loads((ROOT / "public" / "data" / "props.json").read_text())
    routes = props["rail"]["routes"]
    # タイルの範囲: 地図の範囲と、地図の中心 → 駅 → 次の駅 … の 1 区間ずつの範囲 (まわり 1.5 km)。
    # (全部の駅を囲む 1 つの範囲にすると、東京まででは 4,000 枚を超える。線路は駅と駅を結ぶ線から大きくは離れない)
    pad = 0.014
    box = lambda la, lo: (min(la) - pad, min(lo) - pad * 1.2, max(la) + pad, max(lo) + pad * 1.2)
    tiles = bbox_tiles(box([to_ll(0, BOUNDS["minZ"])[0], to_ll(0, BOUNDS["maxZ"])[0]], [to_ll(BOUNDS["minX"], 0)[1], to_ll(BOUNDS["maxX"], 0)[1]]))
    for e in cfg["extensions"]:
        prev = to_ll(0, 0)
        for st in e["stations"]:
            tiles |= bbox_tiles(box([prev[0], st["lat"]], [prev[1], st["lon"]]))
            prev = (st["lat"], st["lon"])
    for L in cfg.get("lines", []):   # 新しい線: 駅 → 次の駅の 1 区間ずつ
        for a, b in zip(L["stations"], L["stations"][1:]):
            tiles |= bbox_tiles(box([a["lat"], b["lat"]], [a["lon"], b["lon"]]))
    tracks, lines, roads = load_gsi(tiles=tiles)
    print(f"gsi: タイル {len(tiles)} 枚")
    print(f"gsi: tracks={len(tracks)} rail lines={len(lines)} roads={len(roads)}")
    grid = join_tracks(tracks)

    ext_routes, stations = [], []
    for ext in cfg["extensions"]:
        edge = ext["edge"]
        near_edge = (lambda q: q[2] < BOUNDS["minZ"] + 80) if edge == "north" else (lambda q: q[2] > BOUNDS["maxZ"] - 80)
        mine, first = [], {}
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
                # 通る点 (設定の via): その線の上下線のうち side の側 (いったんたどった道筋どうしを、点のそばで比べる) の道筋だけ
                vias = []
                for v in ext.get("via", []):
                    if v["line"] != r["line"]:
                        continue
                    vx, vz = to_local(v["lat"], v["lon"])
                    vias.append((vx, vz, v["side"]))
                if vias:
                    first[ri] = (i, k, heading, path, vias, at_end, E)
                    continue
                P = resample(path)
                _, k0 = nearest_on(P, E[0], E[2])
                P = P[k0:]
                ox, oz = E[0] - P[0][0], E[2] - P[0][1]
                P = [(x + ox * max(0, 1 - n * STEP / BLEND), z + oz * max(0, 1 - n * STEP / BLEND)) for n, (x, z) in enumerate(P)][1:]
                mine.append({"route": ri, "line": r["line"], "at": "end" if at_end else "start", "P": P, "E": E, "off": math.hypot(ox, oz)})
        # 通る点のある線: 点のそばで、もう 1 本の同じ線の道筋と比べて side の側の道筋なら、点を通るようにたどり直す
        for ri, (i, k, heading, path, vias, at_end, E) in first.items():
            mine_v = []
            for vx, vz, side in vias:
                others = [q for rj, q in first.items() if rj != ri and routes[rj]["line"] == routes[ri]["line"]]
                if not others:
                    continue
                a = path[nearest_on(path, vx, vz)[1]]
                o = others[0][3][nearest_on(others[0][3], vx, vz)[1]]
                if {"west": a[0] < o[0], "east": a[0] > o[0], "north": a[1] < o[1], "south": a[1] > o[1]}[side]:
                    mine_v.append((vx, vz))
            if mine_v:
                path = follow(tracks, grid, i, k, heading, vias=mine_v)
                print(f"  route {ri} {routes[ri]['line']}: 通る点 {len(mine_v)} 個でたどり直した")
            r = routes[ri]
            P = resample(path)
            _, k0 = nearest_on(P, E[0], E[2])
            P = P[k0:]
            ox, oz = E[0] - P[0][0], E[2] - P[0][1]
            P = [(x + ox * max(0, 1 - n * STEP / BLEND), z + oz * max(0, 1 - n * STEP / BLEND)) for n, (x, z) in enumerate(P)][1:]
            mine.append({"route": ri, "line": r["line"], "at": "end" if at_end else "start", "P": P, "E": E, "off": math.hypot(ox, oz)})
        mine.sort(key=lambda er: er["route"])
        # 最後の駅の先 beyond m で切る (駅の近くを通らない線は、通る線と同じ長さ)
        # line_end = {線名: 駅名} の線は、その駅の先 beyond m で切る (例: 横須賀線は横浜の先で東海道線と分かれ、品川の先で地下に入る)
        last = ext["stations"][-1]
        byname = {st["name"]: st for st in ext["stations"]}
        cuts = []
        for er in mine:
            st = byname[ext.get("line_end", {}).get(er["line"], last["name"])]
            d, k = nearest_on(er["P"], *to_local(st["lat"], st["lon"]))
            er["cut"] = k + int(ext.get("beyond", 700) / STEP) if d < 80 else None
            if er["cut"] is not None:
                cuts.append(er["cut"])
        reach = [er for er in mine if er["cut"] is not None]
        for er in mine:
            if er["cut"] is None and reach:
                # 駅の近くを通らない線 (例: 東戸塚の先で横浜羽沢へ分かれる貨物線): 分かれた所から beyond m で切る
                # (分かれた先まで建物・地形を作ると重くなるだけなので)
                for k in range(0, len(er["P"]), 4):
                    if min(nearest_on(o["P"][:o["cut"]], *er["P"][k])[0] for o in reach) > 40:
                        er["cut"] = min(len(er["P"]), k + int(ext.get("beyond", 700) / STEP))
                        break
        for er in mine:
            c = er["cut"] if er["cut"] is not None else (max(cuts) if cuts else len(er["P"]))
            er["P"] = er["P"][:c]
            print(f"  route {er['route']} {er['line']} {er['at']}: +{len(er['P']) * STEP:.0f} m (端のずれ {er['off']:.1f} m)")
        for er in mine:
            hs, flag = profile(er["P"], lines)
            y0 = er["E"][1]
            er["y"] = [y0 + (h - y0) * min(1, (n + 1) * STEP / (BLEND + 50)) for n, h in enumerate(hs)]
        for st in ext["stations"]:
            s_ = build_station(st, mine, tracks, grid)
            if s_:
                stations.append(s_)
        ext_routes += mine
    # 新しい線 (地図の中の道筋の続きではない線。京葉線など)
    for L in cfg.get("lines", []):
        rs, ss = build_own_line(L, tracks, grid, lines)
        ext_routes += rs
        stations += ss

    # 新しい線の高架 (地面より上) と掘割 (地面より下で、トンネルの中ではない所) の点。高架の橋脚
    piers, cuts_pts = [], []
    for er in ext_routes:
        if er["at"] != "own":
            continue
        P, Y = er["P"], er["y"]
        er["el"] = [False] * len(P)
        for k, (x, z) in enumerate(P):
            if er["ug"][k]:
                continue
            bed, g = Y[k] - RAIL_TOP, dem0(x, z)
            if bed - g > EL_MIN:
                er["el"][k] = True
            elif g > bed + 0.2:
                cuts_pts.append((x, z, bed))
        for k in range(2, len(P) - 2, PIER_EVERY):
            if er["el"][k] and er["el"][k - 2] and er["el"][k + 2]:
                dx, dz = P[k + 1][0] - P[k - 1][0], P[k + 1][1] - P[k - 1][1]
                top = Y[k] - RAIL_TOP - DECK_T
                bot = dem0(*P[k]) - 0.5
                if top - bot > 0.5:
                    piers.append([round(P[k][0], 2), round(top, 2), round(P[k][1], 2), round(math.atan2(dx, dz), 3), round(bot, 2), 2.6])
    # 高架の駅: ホームの下 (ホームの中央の線) にも橋脚
    for st in stations:
        if st.get("underground") or not st.get("line"):
            continue
        for pf in st["platforms"]:
            n = len(pf["y"])
            m = n // 2
            cx, cz = (pf["left"][m][0] + pf["right"][m][0]) / 2, (pf["left"][m][1] + pf["right"][m][1]) / 2
            if pf["y"][m] - dem0(cx, cz) < PLAT_Y + EL_MIN + 2:
                continue
            st["elevated"] = True
            for k in range(2, n - 2, 5):
                x, z = (pf["left"][k][0] + pf["right"][k][0]) / 2, (pf["left"][k][1] + pf["right"][k][1]) / 2
                dx, dz = pf["left"][k + 1][0] - pf["left"][k - 1][0], pf["left"][k + 1][1] - pf["left"][k - 1][1]
                w = math.hypot(pf["left"][k][0] - pf["right"][k][0], pf["left"][k][1] - pf["right"][k][1])
                top = pf["y"][k] - PLAT_Y - RAIL_TOP - DECK_T
                piers.append([round(x, 2), round(top, 2), round(z, 2), round(math.atan2(dx, dz), 3), round(dem0(x, z) - 0.5, 2), round(max(1.5, w - 1.0), 2)])
    if piers or cuts_pts:
        print(f"  高架の橋脚 {len(piers)} 本、掘割の点 {len(cuts_pts)}")
    # 駅舎・駅前 (設定の site。舞浜): 駅の向きの座標 (frame) と地面の高さを決め、その範囲の橋脚を除く (駅舎の柱は railext の駅舎が描く)
    sites = site_frames(stations)
    if sites:
        n0 = len(piers)
        piers = [q for q in piers if not any(site_in(f, q[0], q[2], "under") for f in sites)]
        print(f"  駅舎の範囲の橋脚を除いた: {n0 - len(piers)} 本")

    if routes_only:   # 道筋と駅だけ (確かめる用)
        pathlib.Path(routes_only).write_text(json.dumps({"routes": [{"route": er["route"], "line": er["line"], "P": er["P"]} for er in ext_routes],
                                                         "stations": stations}, ensure_ascii=False))
        print(f"-> {routes_only}")
        return
    # 同じ軌道を 2 本の道筋が使っていないか
    for a in ext_routes:
        for b in ext_routes:
            if a is not b and ext_routes.index(a) < ext_routes.index(b) and a["P"] and b["P"]:
                d, _ = nearest_on(b["P"], *a["P"][len(a["P"]) // 2])
                if d < 1.5:
                    print(f"  注意: route {a['route'] if a['route'] is not None else a['line']} と {b['route'] if b['route'] is not None else b['line']} が同じ線路を通る")

    # ---------- 出力する道筋 ("start" は外の端から地図の端へ向かう順) ----------
    out_routes = []
    for er in ext_routes:
        pts = [[round(x, 2), round(y, 2), round(z, 2)] for (x, z), y in zip(er["P"], er["y"])]
        n = len(pts)
        stops = []
        for k, name in er.get("stops_k", []):
            kk = n - 1 - k if er["at"] == "start" else k
            stops.append({"s": round(kk * STEP + er.get("cars", CARS.get(er["line"], 10)) * CAR / 2, 1), "name": name})
        if er["at"] == "start":
            pts = pts[::-1]
        stops.sort(key=lambda q: q["s"])
        if er["at"] != "own":
            out_routes.append({"route": er["route"], "line": er["line"], "at": er["at"], "p": pts, "stops": stops})
            continue
        # 新しい線: 終点の駅では、行き止まりから編成の長さ + 3 m (下りの始まり) / 行き止まりの 5 m 手前 (上りの終わり) で止まる
        if er.get("first_rest") and stops:
            stops[0]["s"] = round(max(stops[0]["s"], er["cars"] * CAR + 3), 1)
        if er.get("last_term") and stops:
            stops[-1]["s"] = round(min(stops[-1]["s"], (n - 1) * STEP - 5), 1)
        ug, k = [], 0   # トンネルの中の区間 [[k0, k1], ...] (p の番号。k1 を含む)
        while k < n:
            if er["ug"][k]:
                j = k
                while j + 1 < n and er["ug"][j + 1]:
                    j += 1
                ug.append([k, j])
                k = j + 1
            else:
                k += 1
        el, k = [], 0   # 高架の区間 (同じ形)
        while k < n:
            if er["el"][k]:
                j = k
                while j + 1 < n and er["el"][j + 1]:
                    j += 1
                el.append([k, j])
                k = j + 1
            else:
                k += 1
        out_routes.append({"route": None, "line": er["line"], "at": "own", "dir": er["dir"], "p": pts, "stops": stops, "ug": ug,
                           **({"el": el} if el else {}),
                           "rest": er.get("first_rest", False), "term": er.get("last_term", False)})

    allP = [p for er in ext_routes for p in er["P"][::2]]
    trackP = [p for er in ext_routes for k, p in enumerate(er["P"]) if not er.get("ug", ())[k:k + 1] == [True]]   # 地下の線路は地上をふさがない
    grid100 = {}
    for x, z in allP:
        grid100.setdefault((int(x // 100), int(z // 100)), []).append((x, z))

    cand = {}   # 半径 R 升の中に線路の点のある 100 m 升目 (先にこれで外す。速くするだけで結果は同じ)

    def near_track(x, z, r):
        gx, gz = int(x // 100), int(z // 100)
        R = int(r // 100) + 1
        if R not in cand:
            cand[R] = {(i + a, j + b) for i, j in grid100 for a in range(-R, R + 1) for b in range(-R, R + 1)}
        if (gx, gz) not in cand[R]:
            return False
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
    near = near_mask(allP, x0, z0, T_STEP, nx, nz, BAND)
    xs = x0 + np.arange(nx) * T_STEP
    zs = z0 + np.arange(nz) * T_STEP
    inmap = ((BOUNDS["minX"] + 30 <= xs)[None, :] & (xs <= BOUNDS["maxX"] - 30)[None, :]
             & (BOUNDS["minZ"] + 30 <= zs)[:, None] & (zs <= BOUNDS["maxZ"] - 30)[:, None])
    near &= ~inmap
    # 掘割: 線路の CUT_W m 以内の地形の点を、線路の砕石の下面の高さまで下げる (新しい線のトンネルの出入口の前後)
    carve = {}
    for cx_, cz_, bed in cuts_pts:
        for i in range(int((cx_ - CUT_W - x0) // T_STEP), int((cx_ + CUT_W - x0) // T_STEP) + 2):
            for j in range(int((cz_ - CUT_W - z0) // T_STEP), int((cz_ + CUT_W - z0) // T_STEP) + 2):
                if math.hypot(x0 + i * T_STEP - cx_, z0 + j * T_STEP - cz_) <= CUT_W:
                    carve[(i, j)] = min(carve.get((i, j), 1e9), bed - 0.1)
    rows, cells = [], 0
    for j in np.nonzero(near.any(axis=1))[0]:
        j = int(j)
        z = z0 + j * T_STEP
        r = near[j]
        on = np.nonzero(r)[0]
        # 続いている所 (span) ごと
        brk = np.nonzero(np.diff(on) != 1)[0]
        for s0, s1 in zip(np.r_[0, brk + 1], np.r_[brk, len(on) - 1]):
            i0, i1 = int(on[s0]), int(on[s1])
            span = [j, i0]
            for i in range(i0, i1 + 1):
                v = dem0(x0 + i * T_STEP, z)
                c = carve.get((i, j))
                span.append(round((min(v, c) if c is not None else v) * 100))
            rows.append(span)
            cells += i1 - i0 + 1
    terrain = {"step": T_STEP, "x0": x0, "z0": z0, "nx": nx, "nz": nz, "rows": rows}
    print(f"細かい地形: {cells} 点")

    # 粗い地形: 線路から C_PAD m 以内 (と、地図のまわり C_PAD m 以内) の升目の頂点だけ。それ以外は null (描かない)
    cx0 = math.floor((min(p[0] for p in allP) - C_PAD) / C_STEP) * C_STEP
    cz0 = math.floor((min(p[1] for p in allP) - C_PAD) / C_STEP) * C_STEP
    cx1, cz1 = max(p[0] for p in allP) + C_PAD, max(p[1] for p in allP) + C_PAD
    cnx, cnz = int((cx1 - cx0) / C_STEP) + 1, int((cz1 - cz0) / C_STEP) + 1
    cm = near_mask(allP[::5], cx0, cz0, C_STEP, cnx, cnz, C_PAD + 2 * C_STEP)
    cxs, czs = cx0 + np.arange(cnx) * C_STEP, cz0 + np.arange(cnz) * C_STEP
    dx = np.maximum(0, np.maximum(BOUNDS["minX"] - cxs, cxs - BOUNDS["maxX"]))
    dz = np.maximum(0, np.maximum(BOUNDS["minZ"] - czs, czs - BOUNDS["maxZ"]))
    cm |= (dx[None, :] ** 2 + dz[:, None] ** 2) < (C_PAD + 2 * C_STEP) ** 2
    ch = []
    for j in range(cnz):
        for i in range(cnx):
            ch.append(round(dem0(cx0 + i * C_STEP, cz0 + j * C_STEP) * 100) if cm[j, i] else None)
    coarse = {"step": C_STEP, "x0": cx0, "z0": cz0, "nx": cnx, "nz": cnz, "h": ch}
    print(f"粗い地形: {cnx}x{cnz} (値のある点 {int(cm.sum())})")

    # ---------- 建物 (PLATEAU) ----------
    buildings = plateau_buildings(near_track, allP, ext_routes, stations, cfg.get("gsi_buildings", ()))
    if sites:
        n0 = len(buildings)
        buildings = [b for b in buildings if not any(site_in(f, sum(q[0] for q in b[0]) / len(b[0]), sum(q[1] for q in b[0]) / len(b[0]), "clear") for f in sites)]
        print(f"  駅舎・駅前の範囲の建物を除いた: {n0 - len(buildings)} 棟")
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
            if sites and any(site_in(f, x, z, "clear", 3.0) for f in sites):
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
        if "ug" in er:   # 新しい線は own_profile のトンネルの判定
            flags = list(er["ug"])
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
        "source": "国土地理院ベクトルタイル・標高タイル、国土交通省 PLATEAU 横浜市 (2024)・川崎市 (2022)・東京都 23 区 (2020)",
        "routes": out_routes, "stations": stations, "terrain": terrain, "coarse": coarse, "buildings": buildings,
        "poles": poles, "roads": out_roads, "trees": trees, "portals": portals, **({"piers": piers} if piers else {}),
        **({"lines": {L["id"]: {k: L[k] for k in ("name", "band", "cars", "period", "phase", "dirs") if k in L} for L in cfg["lines"]}} if cfg.get("lines") else {}),
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"-> {OUT} ({OUT.stat().st_size / 1e6:.2f} MB)")
    import rail_ext_split
    rail_ext_split.write(json.loads(OUT.read_text(encoding="utf-8")))


def plateau_buildings(near_track, allP, ext_routes, stations=(), gsi_areas=()):
    import xml.etree.ElementTree as ET
    from remotezip import open_remote_zip
    from fetch_plateau import NS, ring
    meshes = set()
    for x, z in allP:
        for dx in (-BAND, 0, BAND):
            for dz in (-BAND, 0, BAND):
                meshes.add(mesh3(*to_ll(x + dx, z + dz)))
    PCACHE.mkdir(parents=True, exist_ok=True)
    files = []   # 読む GML (市ごと・メッシュごと。市の境目のメッシュは、両方の市のファイルにそれぞれの市の建物が入っている)
    for city, url in PLATEAU_SRC:
        listing = PCACHE / f"{city}_names.json"     # zip の中のファイル名の一覧 (取り直さないように控える)
        z = None
        if not listing.exists():
            z = open_remote_zip(url)
            listing.write_text(json.dumps([n for n in z.namelist() if "/bldg/" in n and n.endswith(".gml")]))
        names = json.loads(listing.read_text())
        for m in sorted(meshes):
            # 横浜市は <メッシュ>_bldg_6697_op.gml。東京都 23 区 (2020) は <メッシュ>_bldg_6697_2_op.gml、
            # 大きいメッシュは 1/2 地域メッシュ (9 桁) に分かれていることがある
            hit = sorted(n for n in names if n.rsplit("/", 1)[-1].startswith(m) and "_bldg_" in n
                         and len(n.rsplit("/", 1)[-1].split("_")[0]) in (8, 9))
            for n in hit:
                base = n.rsplit("/", 1)[-1].split("_")[0]
                path = PCACHE / (f"{base}_bldg.gml" if city == "yokohama" else f"{city}_{base}_bldg.gml")
                if not path.exists():
                    if z is None:
                        z = open_remote_zip(url)
                    print(f"  PLATEAU {city} {base} を取得")
                    for attempt in range(5):   # 通信が切れたら開き直して取り直す
                        try:
                            data = z.read(n)
                            break
                        except (ConnectionError, OSError, EOFError) as e:
                            if attempt == 4:
                                raise
                            print(f"    取り直す ({e})")
                            time.sleep(3 * (attempt + 1))
                            z = open_remote_zip(url)
                    path.write_bytes(data)
                files.append(path)
    trackP = [(p, y) for er in ext_routes for k, (p, y) in enumerate(zip(er["P"], er["y"])) if not er.get("ug", ())[k:k + 1] == [True]]
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

    def over_track(ring_xz, h, gy):
        """線路にかかる建物の下端 (0 = 地面から)。使わない建物は None"""
        ty = track_near(ring_xz, 2.6)
        if ty is None:
            return 0.0
        if h < 9:
            return None      # 線路にかかる低い建物 (データのずれ) は使わない
        lift = round(max(0.0, ty - RAIL_TOP + 6.5 - gy), 2)   # 線路をまたぐ駅舎など: 線路の上 6 m から
        if lift >= h - 1:
            return None
        if h < 20 and platform_cover(ring_xz, stations) >= 100:
            return None      # ホームに沿って 100 m 以上かかる低いもの = ホームの屋根・高架の駅の構造 (東京・新橋・品川)。屋根は station.js が描く
                             # (ホームを横切る橋上駅舎 (東戸塚・保土ケ谷・川崎など。かかるのは 60 m まで) は残す)
        return lift

    out, seen = [], {}
    for path in files:
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
            lift = over_track(ring_xz, h, gy)
            if lift is None:
                continue
            key = (round(cx), round(cz), round(h))   # 市の境目で 2 つのファイルに入っている建物は 1 つに
            if seen.get(key, path) != path:
                continue
            seen[key] = path
            out.append([[list(p) for p in ring_xz], round(gy, 2), round(h, 2), lift])
    for area in gsi_areas:
        out += gsi_buildings(area, near_track, ext_routes, over_track)
    return out


GSI_BLD_H = {3101: 7.0, 3102: 15.0}   # 国土地理院の建物の種類 → 高さ (推定): 普通建物 = 2 階建ての家、堅ろう建物 = 5 階建てくらい。無壁舎 (3111・3112) は使わない


def gsi_buildings(area, near_track, ext_routes, over_track):
    """PLATEAU の無い所 (浦安市など。設定の gsi_buildings) の建物: 国土地理院ベクトルタイルの建物の輪郭 (BldA) に、種類から決めた高さ (推定)。
    area = {name, lon_min?, lon_max?, lat_min?, lat_max? (範囲), keep: {line, side: left / right} (その線の下りの道筋の、進む向きのその側だけ)}"""
    la0, la1 = area.get("lat_min", -90), area.get("lat_max", 90)
    lo0, lo1 = area.get("lon_min", -180), area.get("lon_max", 180)
    keep = area.get("keep")
    ref = None
    if keep:
        ref = next((er for er in ext_routes if er["line"] == keep["line"] and er.get("dir", "out") == "out"), None)
    pts_all = [p for er in ext_routes for p in er["P"]]
    lats = [to_ll(x, z)[0] for x, z in pts_all]
    lons = [to_ll(x, z)[1] for x, z in pts_all]
    pad = 0.005
    tiles = bbox_tiles((max(la0, min(lats) - pad), max(lo0, min(lons) - pad), min(la1, max(lats) + pad), min(lo1, max(lons) + pad)))
    load_gsi(tiles=tiles)   # タイルを取っておく (無ければ取る)
    out = []
    for tx, ty in sorted(tiles):
        raw = (CACHE / f"16_{tx}_{ty}.pbf").read_bytes()
        lay = (decode(raw) if raw else {}).get("BldA")
        if not lay:
            continue
        ext = lay["extent"]
        for f in lay["features"]:
            h = GSI_BLD_H.get(f["props"].get("vt_code"))
            if f["type"] != 3 or h is None:
                continue
            for r in f["geom"]:
                if len(r) < 4:
                    continue
                a2 = sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))
                if a2 >= 0:   # 外周は時計回り (y 下向き) = この式で負。穴は使わない
                    continue
                gx, gy_ = sum(q[0] for q in r) / len(r), sum(q[1] for q in r) / len(r)
                if not (0 <= gx < ext and 0 <= gy_ < ext):
                    continue   # タイルの境目をまたぐ建物は、中心のあるタイルのものだけ
                ll = [to_latlon(tx + a / ext, ty + b / ext, 16) for a, b in r]
                cla, clo = sum(q[0] for q in ll) / len(ll), sum(q[1] for q in ll) / len(ll)
                if not (la0 <= cla <= la1 and lo0 <= clo <= lo1):
                    continue
                pts = [to_local(*q) for q in ll]
                cx, cz = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
                if inside_map(cx, cz) or not near_track(cx, cz, BAND):
                    continue
                if ref is not None:
                    _, k = nearest_on(ref["P"], cx, cz)
                    k = min(k, len(ref["P"]) - 2)
                    (ax, az), (bx, bz) = ref["P"][k], ref["P"][k + 1]
                    left = (bx - ax) * (cz - az) - (bz - az) * (cx - ax) < 0   # 進む向きの左 (x = 東、z = 南)
                    if left != (keep["side"] == "left"):
                        continue
                ring_xz = simplify([(round(x, 2), round(z, 2)) for x, z in pts])
                if len(ring_xz) < 3:
                    continue
                gy = min(dem0(x, z) for x, z in ring_xz)
                lift = over_track(ring_xz, h, gy)
                if lift is None:
                    continue
                out.append([[list(p) for p in ring_xz], round(gy, 2), h, lift])
    print(f"  {area.get('name', '国土地理院の建物')}: {len(out)} 棟 (高さは種類からの推定)")
    return out


def site_frames(stations):
    """設定の site (駅舎・駅前。舞浜) のある駅: 駅の向きの座標を決めて st["site"]["frame"] に書く。
    s = ホームの中心線の始め → 終わりの向き (m)、t = それに直角で、進む向きの左 (m)。原点はホームの中央の点。
    gy = 駅前の地面の高さ (範囲 clear の中の標高の中央値。地図の基準の高さから)。戻り値は frame の一覧"""
    out = []
    for st in stations:
        site = st.get("site")
        if not site:
            continue
        pf = st["platforms"][0]
        mid = [((l[0] + r[0]) / 2, (l[1] + r[1]) / 2) for l, r in zip(pf["left"], pf["right"])]
        dx, dz = mid[-1][0] - mid[0][0], mid[-1][1] - mid[0][1]
        L = math.hypot(dx, dz)
        sx, sz = dx / L, dz / L
        cx, cz = mid[len(mid) // 2]
        f = {"cx": round(cx, 2), "cz": round(cz, 2), "sx": round(sx, 6), "sz": round(sz, 6), "nx": round(sz, 6), "nz": round(-sx, 6)}
        s0, s1, t0, t1 = site["clear"]
        hs = sorted(dem0(cx + sx * s + f["nx"] * t, cz + sz * s + f["nz"] * t)
                    for s in range(int(s0), int(s1) + 1, 5) for t in range(int(t0), int(t1) + 1, 5))
        f["gy"] = round(hs[len(hs) // 2], 2)
        f["py"] = pf["y"][len(pf["y"]) // 2]
        site["frame"] = f
        f["rects"] = {k: site[k] for k in ("clear", "clear2", "under") if k in site}
        out.append(f)
        print(f"  {st['name']}: 駅舎・駅前 (地面 {f['gy']} m、ホーム {f['py']} m)")
    return out


def site_in(f, x, z, key, pad=0.0):
    """(x, z) が駅の site の範囲 key ([s0, s1, t0, t1]、駅の向きの座標) の中か"""
    rs = [f["rects"][k] for k in ((key, "clear2") if key == "clear" else (key,)) if k in f["rects"]]   # clear = clear と clear2 (南口)
    s = (x - f["cx"]) * f["sx"] + (z - f["cz"]) * f["sz"]
    t = (x - f["cx"]) * f["nx"] + (z - f["cz"]) * f["nz"]
    return any(r[0] - pad <= s <= r[1] + pad and r[2] - pad <= t <= r[3] + pad for r in rs)


def platform_cover(ring_xz, stations):
    """輪郭の中に入るホームの縁 (4 m おきの点) の、ホームの長さの向きの広がり (m。どのホームのどちらの縁でもいちばん長いもの)"""
    xs, zs = [p[0] for p in ring_xz], [p[1] for p in ring_xz]
    best = 0
    for st in stations:
        for pf in st["platforms"]:
            for side in (pf["left"], pf["right"]):
                ins = [k for k, (x, z) in enumerate(side) if min(xs) <= x <= max(xs) and min(zs) <= z <= max(zs) and pip(x, z, ring_xz)]
                if ins:
                    best = max(best, (max(ins) - min(ins)) * 4)
    return best


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
        if ln["props"].get("vt_sngldbl") == "駅部分":   # 地下の駅 (京葉線の東京など) も出す (新しい線の駅を探すため)
            xs = [p[0] for p in ln["pts"]]; zs = [p[1] for p in ln["pts"]]
            cx, cz = sum(xs) / len(xs), sum(zs) / len(zs)
            la, lo = to_ll(cx, cz)
            print(f"駅部分 ({ln['props'].get('vt_rtcode')}{'・地下' if ln['props'].get('vt_railstate') == '地下' else ''}): 中央 lat {la:.6f} lon {lo:.6f} (x {cx:.0f}, z {cz:.0f})、長さ {sum(math.hypot(ln['pts'][i+1][0]-ln['pts'][i][0], ln['pts'][i+1][1]-ln['pts'][i][1]) for i in range(len(ln['pts'])-1)):.0f} m")


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
        for pf in st.get("platforms") or [st["platform"]]:
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
    elif a[:1] == ["--routes"]:
        main(routes_only=a[1])
    else:
        main()
