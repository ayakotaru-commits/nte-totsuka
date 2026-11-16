"""Mapillary の路上写真から、建物の壁の色を読んで city.json に設定する (自動。建物ごとの指示は要らない)。

仕組み:
  1. 写真の位置・向き・画角 (Mapillary が写真どうしをつないで計算した値) から、建物の壁の上の点が写真のどこに写るかを計算する。
     手前の建物・点群の木・地形 (土手・擁壁) で隠れる点、斜めすぎる面、遠すぎる (35 m より先) 点は使わない。
  2. 建物ごとに、壁がよく見える写真を最大 8 枚選び、点の所の色を読む。
  3. 暗すぎる所 (窓・影)・緑 (植木)・空 (点から画像の上端まで明るく平ら)・写真の下の方 (車のボンネットなど) を除き、写真ごとに明るめの所の平均を取り、写真どうしの中央値にする。
     2 枚以上の写真で 30 点以上読めて、写真どうしで色がまとまっている建物だけに設定する (鮮やかな色は別々の撮影 2 回以上)。
  4. 写真は露出・日陰で暗く写るので、明るさは全建物の中の順位を外壁らしい明るさの範囲に当てはめ直す (calibrate)。
     日陰の青みがかった淡い色は無彩色に寄せる。
  屋根の色を航空写真から読むのと同じで、写真そのものはゲームに貼らない。数値 (色) だけを使う。

使い方:
  python tools/mapillary_walls.py fetch     写真の情報を集め、使う写真を選んで縮小画像を取る (data/raw/mapillary/)。
                                            写真の情報が取ってあれば使い回す (--refresh で取り直す)
  python tools/mapillary_walls.py           city.json に壁の色を設定 (何度実行しても同じ結果)
  python tools/mapillary_walls.py --undo    設定前に戻す
  python tools/mapillary_walls.py --debug <建物 id> [出力フォルダ]   写真に計算した点を打った画像を作る (確認用)
準備: Mapillary のクライアントトークン。data/mapillary_token.txt に 1 行で書く (クラウドのセッションでは、
      環境の設定に保存したトークンが graph.mapillary.com への通信に自動で付くので、ファイルは要らない)
出典: Mapillary (CC BY-SA 4.0)。写真は data/raw/ に置くだけで、git には入れない。
numpy と Pillow が必要。
"""
import concurrent.futures
import json
import math
import pathlib
import sys
import time
import urllib.parse
import urllib.request

import numpy as np

import config as C

ROOT = pathlib.Path(__file__).resolve().parent.parent
CITY = ROOT / "public" / "data" / "city.json"
PROPS = ROOT / "public" / "data" / "props.json"
TERRAIN = ROOT / "public" / "data" / "terrain.json"
RAW = ROOT / "data" / "raw" / "mapillary"
META = RAW / "meta.json"
PLAN = RAW / "plan.json"
THUMBS = RAW / "thumb"
TOKEN = ROOT / "data" / "mapillary_token.txt"
DSM_BIN = ROOT / "data" / "raw" / "lidar_dsm.bin"     # 点群の表面の高さ (fetch_lidar.py)。あれば隠れ・建物の有無の判定に使う
DSM_META = ROOT / "data" / "raw" / "lidar_dsm.json"

M_LAT = 110574.0
M_LON = 111320.0 * math.cos(math.radians(C.ORIGIN_LAT))
FIELDS = ("id,captured_at,is_pano,camera_type,camera_parameters,width,height,computed_geometry,"
          "computed_compass_angle,computed_rotation,sequence,thumb_1024_url")

CAM_H = 2.0        # カメラの地面からの高さ (m)。車の屋根・人の手の高さの間
MAX_D = 35.0       # これより遠い壁の点は使わない (m)
MIN_D = 2.0
MIN_FACING = 0.3   # 壁の向きと写真の方向の cos。斜めすぎる面は使わない
PER_BUILDING = 8   # 建物ごとに使う写真の数
MIN_VIS = 10       # 写真 1 枚で見える点がこれ未満なら使わない
MIN_PTS = 30       # 建物ごとに読めた点がこれ未満なら色を付けない
SKIP_STYLES = {"carport", "wall", "gate"}


def to_local(lat, lon):
    return (lon - C.ORIGIN_LON) * M_LON, (C.ORIGIN_LAT - lat) * M_LAT


def to_ll(x, z):
    return C.ORIGIN_LAT - z / M_LAT, C.ORIGIN_LON + x / M_LON


def api(url):
    if TOKEN.exists():
        url += "&access_token=" + urllib.parse.quote(TOKEN.read_text().strip())
    for k in range(5):
        try:
            return json.load(urllib.request.urlopen(url, timeout=120))
        except Exception as e:  # 回数制限・一時的な失敗
            print("  retry:", e)
            time.sleep(10 * (k + 1))
    raise SystemExit("Mapillary API に接続できません")


# ---------------------------------------------------------------- 写真の情報
def fetch_meta():
    """範囲内の全写真の位置・向き・画角 (200 m 四方ずつ。2000 件を超えたら 4 つに分ける)"""
    B, S, out = C.BOUNDS, 200, {}

    def get(x0, z0, x1, z1, depth=0):
        la0, lo0 = to_ll(x0, z1)
        la1, lo1 = to_ll(x1, z0)
        d = api(f"https://graph.mapillary.com/images?fields={FIELDS}&bbox={lo0:.6f},{la0:.6f},{lo1:.6f},{la1:.6f}&limit=2000")["data"]
        if len(d) >= 2000 and depth < 5:
            mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
            for a in [(x0, z0, mx, mz), (mx, z0, x1, mz), (x0, mz, mx, z1), (mx, mz, x1, z1)]:
                get(*a, depth=depth + 1)
            return
        for x in d:
            out[x["id"]] = x

    x = B["minX"]
    while x < B["maxX"]:
        z = B["minZ"]
        while z < B["maxZ"]:
            get(x, z, x + S, z + S)
            z += S
        x += S
    RAW.mkdir(parents=True, exist_ok=True)
    META.write_text(json.dumps(list(out.values())))
    print(f"meta: {len(out)} images")


def rot_matrix(v):
    v = np.asarray(v, float)
    th = np.linalg.norm(v)
    if th < 1e-12:
        return np.eye(3)
    k = v / th
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(th) * K + (1 - math.cos(th)) * K @ K


class Camera:
    """1 枚の写真。project() は壁の点 (ローカル座標 x 東・y 上・z 南) を、画像の正規化座標 (0〜1) にする"""

    def __init__(self, m, H):
        lon, lat = m["computed_geometry"]["coordinates"]
        self.id, self.x, self.z = m["id"], *to_local(lat, lon)
        self.y = H(self.x, self.z) + CAM_H
        self.R = rot_matrix(m["computed_rotation"])
        self.type = m.get("camera_type") or "perspective"
        p = m.get("camera_parameters") or [0.8, 0, 0]
        self.f, self.k1, self.k2 = (p + [0, 0, 0])[:3]
        self.W, self.H = m.get("width") or 1, m.get("height") or 1
        self.t = m.get("captured_at") or 0
        self.seq = m.get("sequence")
        self.url = m.get("thumb_1024_url")

    def project(self, P):
        """P: (n, 3) -> (u, v, ok)。u, v は 0〜1 (左上が 0)"""
        e, n, up = P[:, 0] - self.x, -(P[:, 2] - self.z), P[:, 1] - self.y
        c = self.R @ np.vstack([e, n, up])          # カメラの座標 (x 右、y 下、z 前)
        x, y, z = c
        if self.type in ("spherical", "equirectangular"):
            lon = np.arctan2(x, z)
            lat = np.arctan2(-y, np.hypot(x, z))
            return lon / (2 * np.pi) + 0.5, 0.5 - lat / np.pi, np.ones(len(x), bool)
        S = max(self.W, self.H)
        ok = z > 0.3
        zz = np.where(ok, z, 1)
        if self.type == "fisheye":
            r = np.hypot(x, y)
            th = np.arctan2(r, zz)
            d = th * (1 + self.k1 * th ** 2 + self.k2 * th ** 4)
            s = np.where(r > 1e-9, d / np.maximum(r, 1e-9), 0)
            xn, yn = x * s, y * s
        else:
            xn, yn = x / zz, y / zz
            r2 = xn ** 2 + yn ** 2
            dd = 1 + self.k1 * r2 + self.k2 * r2 ** 2
            xn, yn = xn * dd, yn * dd
        u = (self.W / 2 + self.f * xn * S) / self.W
        v = (self.H / 2 + self.f * yn * S) / self.H
        ok &= (u > 0.01) & (u < 0.99) & (v > 0.01) & (v < 0.99)
        return u, v, ok


# ---------------------------------------------------------------- 街の形 (隠れの判定)
def load_terrain():
    T = json.loads(TERRAIN.read_text())
    h = np.asarray(T["h"], float) / 100
    nx, nz, x0, z0, st = T["nx"], T["nz"], T["minX"], T["minZ"], T["step"]

    def H(x, z):  # x, z は数でも numpy の配列でもよい
        fx = np.clip((np.asarray(x, float) - x0) / st, 0, nx - 1.0001)
        fz = np.clip((np.asarray(z, float) - z0) / st, 0, nz - 1.0001)
        i, j = fx.astype(int), fz.astype(int)
        u, v = fx - i, fz - j
        g = lambda a, b: h[b * nx + a]
        r = (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v
        return float(r) if np.ndim(r) == 0 else r
    return H


class Surface:
    """点群の表面の高さ (0.5 m 格子、ローカルの y)。建物・塀・防音壁・看板・擁壁がすべて入っている (令和 3 年度)"""

    def __init__(self):
        m = json.loads(DSM_META.read_text(encoding="utf-8"))
        ref = json.loads(TERRAIN.read_text())["ref"]
        self.res, self.x0, self.z0, self.nx, self.nz = m["res"], m["minX"], m["minZ"], m["nx"], m["nz"]
        a = np.fromfile(DSM_BIN, dtype="<i2").reshape(self.nz, self.nx).astype(np.float32)
        a[a == m["nodata"]] = np.nan
        self.y = a / 100 - ref

    def __call__(self, x, z):
        i = np.clip(((np.asarray(x) - self.x0) / self.res).astype(int), 0, self.nx - 1)
        j = np.clip(((np.asarray(z) - self.z0) / self.res).astype(int), 0, self.nz - 1)
        return self.y[j, i]


def signed_area(r):
    a = 0
    for i in range(len(r)):
        x1, z1 = r[i - 1]
        x2, z2 = r[i]
        a += x1 * z2 - x2 * z1
    return a / 2


class Occluders:
    """建物の壁 (線分 + 下端・上端の高さ) と木 (円柱) を 16 m の格子で引けるようにする"""
    CELL = 16.0

    def __init__(self, buildings, trees, H, surf=None):
        self.H, self.surf = H, surf
        segs = []
        for b in buildings:
            yb = (b.get("y") or 0) + (b.get("minH") or 0)
            yt = (b.get("y") or 0) + b["h"]
            for ring in [b["outer"], *(b.get("holes") or [])]:
                for i in range(len(ring)):
                    (x1, z1), (x2, z2) = ring[i - 1], ring[i]
                    segs.append((x1, z1, x2, z2, yb, yt))
        self.seg = np.array(segs, float)
        self.tree = np.array([[t[0], t[1], 1.7 * t[3], t[2] + 1.0 * t[3], t[2] + 4.9 * t[3]] for t in trees] or [[0, 0, 0, 0, 0]], float)
        self.sg, self.tg = self._grid(self.seg[:, [0, 2]].min(1), self.seg[:, [1, 3]].min(1), self.seg[:, [0, 2]].max(1), self.seg[:, [1, 3]].max(1)), \
            self._grid(self.tree[:, 0] - self.tree[:, 2], self.tree[:, 1] - self.tree[:, 2], self.tree[:, 0] + self.tree[:, 2], self.tree[:, 1] + self.tree[:, 2])

    def _grid(self, x0, z0, x1, z1):
        g, c = {}, self.CELL
        for k in range(len(x0)):
            for i in range(math.floor(x0[k] / c), math.floor(x1[k] / c) + 1):
                for j in range(math.floor(z0[k] / c), math.floor(z1[k] / c) + 1):
                    g.setdefault((i, j), []).append(k)
        return g

    def near(self, g, x0, z0, x1, z1):
        c, s = self.CELL, set()
        for i in range(math.floor(x0 / c), math.floor(x1 / c) + 1):
            for j in range(math.floor(z0 / c), math.floor(z1 / c) + 1):
                s.update(g.get((i, j), ()))
        return np.fromiter(s, int, len(s))

    def visible(self, cam, P, box):
        """カメラから点 P (n, 3) までの線が、壁にも木にも当たらないか"""
        x0, z0, x1, z1 = min(box[0], cam.x), min(box[1], cam.z), max(box[2], cam.x), max(box[3], cam.z)
        ok = np.ones(len(P), bool)
        dx, dz = P[:, 0] - cam.x, P[:, 2] - cam.z
        S = self.seg[self.near(self.sg, x0, z0, x1, z1)]
        if len(S):
            ex, ez = S[:, 2] - S[:, 0], S[:, 3] - S[:, 1]
            den = dx[:, None] * ez[None] - dz[:, None] * ex[None]
            den = np.where(np.abs(den) < 1e-9, 1e-9, den)
            qx, qz = S[None, :, 0] - cam.x, S[None, :, 1] - cam.z
            s = (qx * ez[None] - qz * ex[None]) / den        # 線の上の位置 (0 = カメラ、1 = 点)
            u = (qx * dz[:, None] - qz * dx[:, None]) / den  # 壁の線分の上の位置
            yr = cam.y + s * (P[:, 1:2] - cam.y)
            hit = (s > 0.02) & (s < 0.995) & (u >= 0) & (u <= 1) & (yr >= S[None, :, 4] - 0.2) & (yr <= S[None, :, 5])
            ok &= ~hit.any(1)
        # 地形 (土手・擁壁・坂): 線の途中で地面が線より上に出たら隠れている
        if ok.any():
            ss = np.linspace(0.08, 0.92, 12)
            gx = cam.x + dx[ok, None] * ss[None]
            gz = cam.z + dz[ok, None] * ss[None]
            yr = cam.y + ss[None] * (P[ok, 1:2] - cam.y)
            ok[ok] = ~(self.H(gx, gz) > yr + 0.3).any(1)
        # 点群の表面 (塀・防音壁・看板・建物データに無い物): 壁の 2 m 手前までの線の上で、表面が線より 0.5 m 以上高ければ隠れている
        if self.surf is not None and ok.any():
            d = np.hypot(dx[ok], dz[ok])
            ss = np.linspace(0, 1, 40)[None] * np.maximum(0.05, 1 - 2.0 / d)[:, None]
            ss = np.maximum(ss, 1.0 / d[:, None])                # カメラのすぐ近く (車・人) は見ない
            gx, gz = cam.x + dx[ok, None] * ss, cam.z + dz[ok, None] * ss
            yr = cam.y + ss * (P[ok, 1:2] - cam.y)
            sy = self.surf(gx, gz)
            ok[ok] = ~np.nan_to_num(sy > yr + 0.5).any(1)
        T = self.tree[self.near(self.tg, x0, z0, x1, z1)]
        if len(T):
            L2 = np.maximum(dx ** 2 + dz ** 2, 1e-9)
            tx, tz = T[None, :, 0] - cam.x, T[None, :, 1] - cam.z
            s = (tx * dx[:, None] + tz * dz[:, None]) / L2[:, None]
            px, pz = dx[:, None] * s - tx, dz[:, None] * s - tz
            yr = cam.y + s * (P[:, 1:2] - cam.y)
            hit = (s > 0.02) & (s < 0.98) & (px ** 2 + pz ** 2 < T[None, :, 2] ** 2) & (yr >= T[None, :, 3]) & (yr <= T[None, :, 4])
            ok &= ~hit.any(1)
        return ok


def targets(buildings):
    """色を読む建物: 外観を個別に設定した建物 (ランドマーク・敷地の設定) と屋根だけの物は除く"""
    for b in buildings:
        if b.get("part") or b.get("look") or b.get("style") in SKIP_STYLES:
            continue
        if b.get("color") and not b.get("mly"):
            continue
        if b.get("src") == "appearance" or b.get("facade"):
            continue
        yield b


def wall_points(b):
    """壁の上の点 (1.5 m 間隔・高さ 1.2 m 間隔、壁から 0.15 m 外) と、その壁の外向き"""
    ring = b["outer"]
    s = 1 if signed_area(ring) > 0 else -1
    g = b.get("y") or 0
    top = g + b["h"] - ((b.get("roof") or {}).get("rise") or 0)
    hs = np.arange(g + 2.0, min(top - 0.3, g + 14) + 1e-6, 1.2)  # 2 m より下は車・柵・人が多い
    if len(hs) == 0:
        hs = np.array([g + min(1.3, max(0.5, (top - g) / 2))])
    P, N = [], []
    for i in range(len(ring)):
        (x1, z1), (x2, z2) = ring[i], ring[(i + 1) % len(ring)]
        L = math.hypot(x2 - x1, z2 - z1)
        if L < 2.0:
            continue
        ux, uz = (x2 - x1) / L, (z2 - z1) / L
        nx, nz = uz * s, -ux * s
        for t in np.arange(0.75, L - 0.5, 1.5):
            for y in hs:
                P.append((x1 + ux * t + nx * 0.15, y, z1 + uz * t + nz * 0.15))
                N.append((nx, nz))
    return np.array(P, float).reshape(-1, 3), np.array(N, float).reshape(-1, 2)


def make_plan(city, cams):
    """建物ごとに、壁がよく見える写真と、その写真の中の点の位置"""
    trees = (json.loads(PROPS.read_text()) if PROPS.exists() else {}).get("trees", [])
    surf = Surface() if DSM_BIN.exists() else None
    print("plan: 点群の表面で隠れ・建物の有無を判定" if surf is not None else "plan: 点群なし (建物データと木・地形だけで判定)")
    occ = Occluders(city["buildings"], trees, load_terrain(), surf)
    cg = {}
    for c in cams:
        cg.setdefault((math.floor(c.x / 50), math.floor(c.z / 50)), []).append(c)
    plan, n_b = {}, 0
    for b in targets(city["buildings"]):
        P, N = wall_points(b)
        if surf is not None and len(P):
            # 建物が本当にあるか: 壁の 0.75 m 内側の点群の表面が、その点の高さ近くまであること (取り壊し・空き地を除く)
            inner = surf(P[:, 0] - N[:, 0] * 0.9, P[:, 2] - N[:, 1] * 0.9)
            keep = np.nan_to_num(inner, nan=-1e9) >= P[:, 1] - 0.5
            P, N = P[keep], N[keep]
        if not len(P):
            continue
        xs, zs = [q[0] for q in b["outer"]], [q[1] for q in b["outer"]]
        box = (min(xs), min(zs), max(xs), max(zs))
        cand = []
        for i in range(math.floor((box[0] - MAX_D) / 50), math.floor((box[2] + MAX_D) / 50) + 1):
            for j in range(math.floor((box[1] - MAX_D) / 50), math.floor((box[3] + MAX_D) / 50) + 1):
                cand += cg.get((i, j), [])
        scored = []
        for c in cand:
            dx, dz = c.x - P[:, 0], c.z - P[:, 2]
            d = np.hypot(dx, dz)
            ok = (d > MIN_D) & (d < MAX_D) & ((dx * N[:, 0] + dz * N[:, 1]) > MIN_FACING * d)
            if ok.sum() < MIN_VIS:
                continue
            u, v, ok2 = c.project(P)
            ok &= ok2
            if ok.sum() < MIN_VIS:
                continue
            ok[ok] = occ.visible(c, P[ok], box)
            k = int(ok.sum())
            if k < MIN_VIS:
                continue
            recent = 1.5 if c.t >= 1577836800000 else 1.0  # 2020 年以降を優先
            scored.append((k * recent / (1 + float(np.median(d[ok])) / 20), c, u[ok], v[ok]))
        scored.sort(key=lambda t: -t[0])
        chosen, seqs = [], {}
        for sc, c, u, v in scored:  # 同じ撮影の続きばかりにならないよう、1 つの撮影から 2 枚まで
            if seqs.get(c.seq, 0) >= 2:
                continue
            seqs[c.seq] = seqs.get(c.seq, 0) + 1
            chosen.append([c.id, np.round(u, 4).tolist(), np.round(v, 4).tolist()])
            if len(chosen) >= PER_BUILDING:
                break
        if chosen:
            plan[b["id"]] = chosen
        n_b += 1
        if n_b % 500 == 0:
            print(f"  plan: {n_b} buildings, {len(plan)} with photos", flush=True)
    return plan


def load_cams(H):
    return [Camera(m, H) for m in json.loads(META.read_text()) if m.get("computed_rotation") and m.get("computed_geometry")]


def download(plan, cams):
    by = {c.id: c for c in cams}
    need = sorted({p[0] for v in plan.values() for p in v})
    THUMBS.mkdir(parents=True, exist_ok=True)
    todo = [i for i in need if not (THUMBS / f"{i}.jpg").exists()]
    print(f"thumbs: {len(need)} needed, {len(todo)} to download")

    def one(i):
        for k in range(4):
            try:
                data = urllib.request.urlopen(by[i].url, timeout=60).read()
                (THUMBS / f"{i}.jpg").write_bytes(data)
                return True
            except Exception:
                time.sleep(3 * (k + 1))
        return False
    done = 0
    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        for ok in ex.map(one, todo):
            done += 1
            if done % 500 == 0:
                print(f"  {done}/{len(todo)}", flush=True)
    print("thumbs: done")


def fetch(refresh=False):
    if refresh or not META.exists():
        fetch_meta()
    city = json.loads(CITY.read_text(encoding="utf-8"))
    undo(city["buildings"])  # 前回の色は使わない (対象の選び方を同じにする)
    cams = load_cams(load_terrain())
    plan = make_plan(city, cams)
    PLAN.write_text(json.dumps(plan))
    print(f"plan: {len(plan)} buildings")
    download(plan, cams)


# ---------------------------------------------------------------- 色を読む
SEQ = {}  # 写真 id -> 撮影 (sequence)。apply() が入れる


def wall_color(samples):
    """samples: [(写真 id, (n, 3) の色)]。写真での壁の色 (sRGB 0〜255) と点の数。読めない・写真どうしで食い違うときは None"""
    per, cnt, seqs = [], 0, []
    for iid, c in samples:
        r, g, b = c[:, 0], c[:, 1], c[:, 2]
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        green = (g > r + 10) & (g > b + 6)              # 植木
        sky = (b > r + 18) & (lum > 150)               # 空 (計算の誤差で屋根より上に出た点)
        ok = (lum > 45) & (lum < 250) & ~green & ~sky   # 暗い所 = 窓・影
        c = c[ok]
        if len(c) < 4:
            continue
        # 写真ごとに、色味は明るさが中くらい (25〜75%) の所の平均 (ベランダの白い床の縁だけに引っぱられないように)、
        # 明るさは明るめ (55〜90%) の所 (窓・影・ひさしの下より、日の当たった壁の面)
        lum = c @ [0.299, 0.587, 0.114]
        p25, p55, p75, p90 = np.percentile(lum, [25, 55, 75, 90])
        mid = c[(lum >= p25) & (lum <= p75)]
        br = lum[(lum >= p55) & (lum <= p90)]
        per.append([*(mid.mean(0) if len(mid) else c.mean(0)), br.mean() if len(br) else lum.mean()])
        seqs.append(SEQ.get(iid, iid))
        cnt += len(c)
    if len(per) < 2 or cnt < MIN_PTS:
        return None, 0
    per = np.array(per)                                  # [r, g, b, 明るさ]
    med = np.median(per, 0)
    # 写真どうしの食い違い: 中央値から遠い写真を外して、残りが 2 枚以上でまとまっていること
    d = np.abs(per[:, :3] - med[:3]).max(1)
    good = d <= max(30, np.percentile(d, 50) * 1.5)
    keep = per[good]
    if len(keep) < 2 or np.ptp(keep[:, 3]) > 70:
        return None, 0
    col = np.median(keep, 0)
    # 鮮やかな色は、別々の撮影 2 回以上でまとまること (前に停まった車・バスなど、その時だけの物を読まないように)
    import colorsys
    sat = colorsys.rgb_to_hls(*(np.clip(col[:3], 0, 255) / 255))[2]
    if sat >= 0.15 and len({q for q, g in zip(seqs, good) if g}) < 2:
        return None, 0
    return col, cnt


# 写真の明るさの順位を、外壁らしい明るさ (HSL の明度) に当てはめる: 一番暗い 0.50、中くらい 0.78、一番明るい 0.93
L_LO, L_MID, L_HI = 0.50, 0.78, 0.93


def calibrate(raw):
    """raw: {id: (r, g, b, 明るさ) 0〜255} -> {id: '#rrggbb'}。露出・日陰の暗さと、日陰の青みを直す"""
    import colorsys
    ids = sorted(raw)
    if not ids:
        return {}
    hls = {i: colorsys.rgb_to_hls(*(np.clip(raw[i][:3], 0, 255) / 255)) for i in ids}
    order = sorted(ids, key=lambda i: raw[i][3])
    out = {}
    for k, i in enumerate(order):
        h, l, s = hls[i]
        q = (k + 0.5) / len(order)                       # 明るさの順位 (0〜1)
        L = L_LO + (L_MID - L_LO) * (q / 0.5) ** 0.8 if q < 0.5 else L_MID + (L_HI - L_MID) * ((q - 0.5) / 0.5)
        if s > 0.2:                                      # 色のはっきりした壁 (レンガ・えんじ) は、持ち上げすぎない
            L = min(L, l + 0.25)
        deg = h * 360
        if 160 <= deg <= 260 and s < 0.35:               # 青〜青緑で淡い = 日陰の色かぶり。ほぼ無彩色に
            s = min(s, 0.04)
        elif (70 < deg < 160 or 260 < deg < 300) and s < 0.4:  # 緑・紫がかった淡い灰色 (植木・赤い舗装の照り返し) も無彩色に
            s = min(s, 0.04)
        elif 300 <= deg < 335 and s < 0.12:              # ごく淡い赤紫も。はっきりしたピンクの壁は残す
            s = min(s, 0.04)
        else:
            s = min(0.45, s * 1.15)                      # 暖色 (ベージュ・茶・レンガ) は少しだけ強める
        r, g, b = colorsys.hls_to_rgb(h, L, s)
        out[i] = "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))
    return out


CREDIT = " / 壁の色: Mapillary (CC BY-SA 4.0)"


def set_credit(city, on):
    a = (city.get("attribution") or "").replace(CREDIT, "")
    city["attribution"] = a + (CREDIT if on else "")


def undo(buildings):
    for b in buildings:
        m = b.pop("mly", None)
        if m is None:
            continue
        if m.get("color0") is None:
            b.pop("color", None)
        else:
            b["color"] = m["color0"]


def apply(city):
    from PIL import Image
    undo(city["buildings"])
    if not PLAN.exists():
        print("mapillary_walls: plan.json がありません (先に fetch)")
        return 0
    plan = json.loads(PLAN.read_text())
    by_img = {}
    for bid, lst in plan.items():
        for iid, u, v in lst:
            by_img.setdefault(iid, []).append((bid, u, v))
    meta = json.loads(META.read_text()) if META.exists() else []
    kinds = {m["id"]: m.get("camera_type") for m in meta}
    SEQ.update({m["id"]: m.get("sequence") or m["id"] for m in meta})
    got = {}
    for iid, lst in by_img.items():
        f = THUMBS / f"{iid}.jpg"
        if not f.exists():
            continue
        im = np.asarray(Image.open(f).convert("RGB"), float)
        h, w = im.shape[:2]
        lum_im = im @ [0.299, 0.587, 0.114]
        pano = kinds.get(iid) in ("spherical", "equirectangular")
        for bid, u, v in lst:
            u, v = np.array(u), np.array(v)
            # 写真の下の方 (車のボンネット・ダッシュボード、全天球なら撮った人や車) は使わない
            keep = v < (0.62 if pano else 0.75)
            px = np.clip((u[keep] * w).astype(int), 1, w - 2)
            py = np.clip((v[keep] * h).astype(int), 1, h - 2)
            if not len(px):
                continue
            c = sum(im[py + dy, px + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9  # 3x3 の平均
            # 空: その点から画像の上端まで、明るく平らな色が続く (曇り空は白っぽいので、色だけでは壁と区別できない)
            steps = np.linspace(0, 1, 8)[None] * py[:, None]
            col = lum_im[steps.astype(int), px[:, None]]
            sky = (col.min(1) > 150) & (np.ptp(col, 1) < 40)
            c = c[~sky]
            if len(c):
                got.setdefault(bid, []).append((iid, c))
    B = {b["id"]: b for b in city["buildings"]}
    parts = {}
    for b in city["buildings"]:
        if b.get("part"):
            parts.setdefault(b["part"], []).append(b)
    raw, cnts = {}, {}
    for bid in sorted(got):
        col, cnt = wall_color(got[bid])
        if col is not None and bid in B:
            raw[bid], cnts[bid] = col, cnt
    colors = calibrate(raw)
    n = 0
    for bid in sorted(colors):
        hexc, cnt = colors[bid], cnts[bid]
        for b in [B[bid], *parts.get(bid, [])]:  # 上の段も同じ色にする
            if b.get("look"):
                continue
            b["mly"] = {"color0": b.get("color"), "n": cnt, "raw": "#%02x%02x%02x" % tuple(int(round(min(255, max(0, v)))) for v in raw[bid][:3])} if b is B[bid] else {"color0": b.get("color")}
            b["color"] = hexc
        n += 1
    set_credit(city, n > 0)
    print(f"mapillary_walls: wall colors for {n} buildings (photos for {len(plan)})")
    return n


def debug(bid, out):
    """選んだ写真に、計算した壁の点を打つ (投影の確かめ)"""
    from PIL import Image, ImageDraw
    plan = json.loads(PLAN.read_text())
    out = pathlib.Path(out)
    out.mkdir(parents=True, exist_ok=True)
    for k, (iid, u, v) in enumerate(plan.get(bid, [])):
        im = Image.open(THUMBS / f"{iid}.jpg").convert("RGB")
        d = ImageDraw.Draw(im)
        for a, b in zip(u, v):
            x, y = a * im.width, b * im.height
            d.ellipse([x - 3, y - 3, x + 3, y + 3], outline=(255, 0, 255), width=2)
        im.save(out / f"{bid}_{k}.jpg")
        print(out / f"{bid}_{k}.jpg")


def main():
    a = sys.argv[1:]
    if a[:1] == ["fetch"]:
        fetch("--refresh" in a)
        return
    if a[:1] == ["--debug"]:
        debug(a[1], a[2] if len(a) > 2 else RAW / "debug")
        return
    city = json.loads(CITY.read_text(encoding="utf-8"))
    if "--undo" in a:
        undo(city["buildings"])
        set_credit(city, False)
    else:
        apply(city)
    CITY.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"-> {CITY} ({CITY.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
