"""点群から、敷地まわりの小さな物 (塀・生け垣・物置) を見つけ、家の壁ぎわの空いた所に室外機を置く。

使い方: python tools/lidar_small.py            (numpy が必要。先に fetch_lidar.py と fetch_ortho.py)
        python tools/lidar_small.py --undo     出力を消して build_props.py をやり直す (元の見た目に戻る)
入力:   data/raw/lidar/<図郭>.zip   点群 (fetch_lidar.py)
        data/raw/ortho_rgb.bin      航空写真の色の格子 (生け垣の緑を見るだけ。写真は貼らない)
        public/data/city.json, terrain.json, data/lots.json (駐車場の車の位置)
出力:   data/small.json             build_props.py が props.json の yardWalls / sheds / acUnits にする
        data/raw/lidar_small.npz    点群を 0.5 m の格子にまとめた途中結果 (作り直すときは消す)

読み方 (0.5 m のマス。建物・道路・水面・駐車場・墓地などの上は対象外。地面の高さは lidar_cover.py と同じ推定):
  塀・生け垣: 地面から 0.8〜2.6 m の高さのマスが、幅 1 m 以下で 2.5 m 以上細長く続く所。
              葉を通り抜けた反射 (反射 2 回以上) が多いか、航空写真で緑なら生け垣、それ以外はブロック塀
  物置      : 上が平らで高さ 1.8〜2.7 m、長さ 3 m 以下・広さ 1〜6 ㎡ のかたまりで、建物から 4 m 以内のもの
              (軽自動車と見分けるため長さと高さを絞っている。駐車場で見つけた車の近くは除く)
  室外機    : 点群では小さすぎて読めない (約 10 点/㎡ で、0.8 x 0.3 m の箱には 2〜3 点しか当たらない)。
              戸建ての、道路を向いていない壁ぎわのうち、点群で何も無い (地面から 0.4 m 未満) 所に 1〜2 台置く (決まりによる推定)
"""
import json
import math
import pathlib
import sys

import numpy as np

import fetch_lidar as FL
import lidar_cover as LC

LC.RES = 0.5               # lidar_cover の格子の関数をこの間隔で使う
RES = 0.5
LC.CACHE = LC.ROOT / "data" / "raw" / "lidar_small.npz"
ROOT = LC.ROOT
OUT = ROOT / "data" / "small.json"
LOTS = ROOT / "data" / "lots.json"

WALL_H = (0.8, 2.6)        # 塀・生け垣の高さの範囲 (m)
WALL_W = 1.2               # これより幅が広いものは塀ではない (m。すき間をつないだ分だけ太く写る)
WALL_L = 2.5               # これより短いものは塀として使わない (m)
SKIP_KINDS = {"parking", "cemetery", "platform", "wood", "farm", "pitch", "water"}


def hash01(s):
    h = 2166136261
    for ch in s:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    h ^= h >> 15
    h = (h * 2246822507) & 0xFFFFFFFF
    h ^= h >> 13
    return h / 4294967296


def pca(xs, zs):
    m = np.array([xs.mean(), zs.mean()])
    c = np.cov(np.vstack([xs - m[0], zs - m[1]])) if len(xs) > 1 else np.eye(2)
    w, v = np.linalg.eigh(c)
    u = v[:, 1]
    return m, u, np.array([-u[1], u[0]])


def split_linear(xs, zs, depth=0):
    """細長いかたまりを、まっすぐな区間に分ける。[(中心, 向き, s0, s1, 幅)]"""
    if len(xs) < 5:
        return []
    m, u, v = pca(xs, zs)
    s = (xs - m[0]) * u[0] + (zs - m[1]) * u[1]
    t = (xs - m[0]) * v[0] + (zs - m[1]) * v[1]
    width = t.max() - t.min() + RES
    length = s.max() - s.min() + RES
    if width <= WALL_W:
        if length >= WALL_L:
            return [(m + v * float(np.median(t)), u, float(s.min()) - RES / 2, float(s.max()) + RES / 2, width)]
        return []
    if depth >= 5:
        return []
    # 幅が広い: L 字・コの字のときや、塀に物が接しているとき。主な向きで半分ずつに分けて見直す
    k = np.argsort(s)
    half = len(k) // 2
    a, b = k[:half], k[half:]
    return split_linear(xs[a], zs[a], depth + 1) + split_linear(xs[b], zs[b], depth + 1)


def merge_walls(walls, gap=1.5, ang=0.17, off=0.4):
    """同じ種類で、ほぼ一直線に並び、すき間が gap m 以下の区間をつなぐ (点の当たらなかった所で途切れた塀)"""
    ws = [list(w) for w in walls]
    changed = True
    while changed:
        changed = False
        for i in range(len(ws)):
            a = ws[i]
            if a is None:
                continue
            ax, az = a[2] - a[0], a[3] - a[1]
            la = math.hypot(ax, az)
            ux, uz = ax / la, az / la
            for j in range(i + 1, len(ws)):
                b = ws[j]
                if b is None or b[5] != a[5]:
                    continue
                bx, bz = b[2] - b[0], b[3] - b[1]
                lb = math.hypot(bx, bz)
                if abs(ux * bz / lb - uz * bx / lb) > math.sin(ang):
                    continue
                # b の両端の、a の線からのずれと、a の線に沿った位置
                ds = [abs((p[0] - a[0]) * -uz + (p[1] - a[1]) * ux) for p in ((b[0], b[1]), (b[2], b[3]))]
                if max(ds) > off:
                    continue
                ss = [(p[0] - a[0]) * ux + (p[1] - a[1]) * uz for p in ((b[0], b[1]), (b[2], b[3]))]
                lo, hi = min(ss), max(ss)
                if lo > la + gap or hi < -gap:
                    continue
                s0, s1 = min(0.0, lo), max(la, hi)
                ws[i] = a = [round(a[0] + ux * s0, 2), round(a[1] + uz * s0, 2), round(a[0] + ux * s1, 2), round(a[1] + uz * s1, 2),
                             round((a[4] * la + b[4] * lb) / (la + lb), 2), a[5]]
                ax, az = a[2] - a[0], a[3] - a[1]
                la = math.hypot(ax, az)
                ws[j] = None
                changed = True
    return [w for w in ws if w is not None]


def main():
    if "--undo" in sys.argv:
        if OUT.exists():
            OUT.unlink()
        print("data/small.json を消した")
        import build_props
        build_props.main()
        return
    city = json.loads(LC.CITY.read_text(encoding="utf-8"))
    B = city["bounds"]
    g = LC.load_grid(B)
    shape = g["zmax"].shape
    print(f"格子 {shape[1]} x {shape[0]} (0.5 m)")
    gnd = LC.lidar_ground(g, B)
    has = g["n"] > 0
    hgt = np.where(has, g["zmax"] / 100 - gnd, 0.0)
    veg = LC.box(g["multi"], 1) / np.maximum(LC.box(g["n"], 1), 1)   # 1.5 m 四方で、葉を通り抜けた反射の割合
    rgb = LC.ortho_grid(B, shape)
    green = (rgb[..., 1] > rgb[..., 0] + 6) & (rgb[..., 1] > rgb[..., 2] + 4)

    bld, road, water, kind, kinds = LC.city_masks(city, shape)
    skip = np.isin(kind, [kinds.index(k) for k in SKIP_KINDS if k in kinds])
    free = ~LC.dilate(bld, 1) & ~LC.erode(road, 1) & ~water & ~skip
    # 木の枝先 (低く写る) を塀と間違えない。屋根の縁も反射が 2 回になりやすいので、建物のそばは木とみなさない
    tree = LC.dilate((hgt > 3.0) & (veg > 0.3) & ~LC.dilate(bld, 3), 2)
    xs_all = B["minX"] + (np.arange(shape[1]) + 0.5) * RES
    zs_all = B["minZ"] + (np.arange(shape[0]) + 0.5) * RES

    # ---------------- 塀・生け垣 ----------------
    cand = free & ~tree & (hgt >= WALL_H[0]) & (hgt <= WALL_H[1])
    # 塀の上面は幅 10〜15 cm で、点は 1 m に 1〜2 個しか当たらない (点線のように写る)。1 m までのすき間をつなぐ
    cand = LC.erode(LC.dilate(cand, 2), 2) & free & ~tree
    walls = []
    blobs = []
    for jj, ii in LC.label(cand):
        if len(jj) < 4:
            continue
        xs, zs = xs_all[ii], zs_all[jj]
        segs = split_linear(xs, zs)
        if not segs:
            blobs.append((jj, ii))
            continue
        for c, u, s0, s1, w in segs:
            # 区間の中のマスの高さと、葉の割合・緑
            d = np.abs((xs - c[0]) * (-u[1]) + (zs - c[1]) * u[0])
            s = (xs - c[0]) * u[0] + (zs - c[1]) * u[1]
            sel = (d <= WALL_W / 2 + 0.01) & (s >= s0) & (s <= s1)
            if sel.sum() < 4:
                continue
            hh = hgt[jj[sel], ii[sel]]
            hh = hh[hh > 0.3]
            h = float(np.percentile(hh, 80)) if len(hh) else 1.2
            vg = float(g["multi"][jj[sel], ii[sel]].sum()) / max(1.0, float(g["n"][jj[sel], ii[sel]].sum()))   # その線のマスだけで (屋根の縁の反射を混ぜない)
            gr = float(green[jj[sel], ii[sel]].mean())
            hedge = vg > 0.3 or (gr > 0.6 and vg > 0.12)
            a, b = c + u * s0, c + u * s1
            walls.append([round(float(a[0]), 2), round(float(a[1]), 2), round(float(b[0]), 2), round(float(b[1]), 2),
                          round(min(h, WALL_H[1]), 2), "hedge" if hedge else "block"])

    walls = merge_walls(walls)

    # ---------------- 物置 ----------------
    cars = []
    if LOTS.exists():
        for lot in json.loads(LOTS.read_text(encoding="utf-8")).get("parking") or []:
            cars += lot.get("cars") or []
    car_grid = {}
    for x, z in cars:
        car_grid.setdefault((int(x // 10), int(z // 10)), []).append((x, z))

    def near_car(x, z, r):
        for gx in range(int(x // 10) - 1, int(x // 10) + 2):
            for gz in range(int(z // 10) - 1, int(z // 10) + 2):
                if any((cx - x) ** 2 + (cz - z) ** 2 < r * r for cx, cz in car_grid.get((gx, gz), ())):
                    return True
        return False

    near_bld = LC.dilate(bld, 8)   # 建物から 4 m 以内
    sheds = []
    tall = free & ~tree & (hgt >= 1.0) & (hgt <= 3.0)
    for jj, ii in LC.label(tall):
        area = len(jj) * RES * RES
        if not (1.0 <= area <= 6.0) or not near_bld[jj, ii].any():
            continue
        hh = hgt[jj, ii]
        if not (1.8 <= np.median(hh) <= 2.7) or hh.std() > 0.25 or veg[jj, ii].mean() > 0.2:
            continue
        xs, zs = xs_all[ii], zs_all[jj]
        m, u, v = pca(xs, zs)
        s = (xs - m[0]) * u[0] + (zs - m[1]) * u[1]
        t = (xs - m[0]) * v[0] + (zs - m[1]) * v[1]
        L, W = s.max() - s.min() + RES, t.max() - t.min() + RES
        if L > 3.0 or W > 2.2 or W < 0.7 or near_car(m[0], m[1], 3.0):
            continue
        sheds.append([round(float(m[0]), 2), round(float(m[1]), 2), round(math.atan2(u[0], u[1]), 3),
                      round(float(max(L, 1.2)), 2), round(float(max(W, 0.8)), 2), round(float(np.percentile(hh, 90)), 2)])

    # ---------------- 室外機 (決まりによる推定) ----------------
    occupied = (hgt > 0.4) | bld | LC.dilate(road, 1)
    for x0, z0, x1, z1, *_ in walls:   # 塀の線の上には置かない
        n = max(2, int(math.hypot(x1 - x0, z1 - z0) / RES))
        for k in range(n + 1):
            x, z = x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n
            i, j = int((x - B["minX"]) / RES), int((z - B["minZ"]) / RES)
            if 0 <= i < shape[1] and 0 <= j < shape[0]:
                occupied[j, i] = True
    road_near = LC.dilate(road, 10)    # 道路から 5 m 以内の壁は「道路を向いている」とみなす
    ac = []

    def cell(x, z):
        i, j = int((x - B["minX"]) / RES), int((z - B["minZ"]) / RES)
        return (j, i) if 0 <= i < shape[1] and 0 <= j < shape[0] else None

    for b in city["buildings"]:
        if b.get("style") not in ("house", "small") or b.get("src") == "lidar":
            continue
        ring = b["outer"]
        sa = sum(ring[k - 1][0] * ring[k][1] - ring[k][0] * ring[k - 1][1] for k in range(len(ring))) / 2
        sgn = 1 if sa > 0 else -1
        r = hash01("ac" + str(b.get("id")))
        want = 1 if r < 0.7 else 2
        cands = []
        for k in range(len(ring)):
            a, c = ring[k], ring[(k + 1) % len(ring)]
            dx, dz = c[0] - a[0], c[1] - a[1]
            L = math.hypot(dx, dz)
            if L < 2.0:
                continue
            nx, nz = dz / L * sgn, -dx / L * sgn          # 外向き (city.js の壁と同じ向き)
            for f in (0.3, 0.7):
                px, pz = a[0] + dx * f + nx * 0.45, a[1] + dz * f + nz * 0.45
                ok = True
                for q in ((0, 0), (dx / L * 0.45, dz / L * 0.45), (-dx / L * 0.45, -dz / L * 0.45), (nx * 0.45, nz * 0.45)):
                    cc = cell(px + q[0], pz + q[1])
                    if cc is None or occupied[cc] or road_near[cc]:
                        ok = False
                        break
                if ok:
                    cands.append((hash01(f"ac{b.get('id')}-{k}-{f}"), px, pz, math.atan2(nx, nz)))
        cands.sort()
        used = []
        for _, px, pz, yaw in cands:
            if len(used) >= want:
                break
            if any(math.hypot(px - ux, pz - uz) < 2.0 for ux, uz in used):
                continue
            used.append((px, pz))
            ac.append([round(px, 2), round(pz, 2), round(yaw, 3)])

    out = {"generator": "tools/lidar_small.py", "walls": walls, "sheds": sheds, "ac": ac}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    nb = sum(1 for w in walls if w[5] == "block")
    lb = sum(math.hypot(w[2] - w[0], w[3] - w[1]) for w in walls if w[5] == "block")
    lh = sum(math.hypot(w[2] - w[0], w[3] - w[1]) for w in walls if w[5] == "hedge")
    print(f"塀 {nb} 本 ({lb:.0f} m)、生け垣 {len(walls) - nb} 本 ({lh:.0f} m)、物置 {len(sheds)} 個、室外機 {len(ac)} 台 -> {OUT}")
    import build_props
    build_props.main()


if __name__ == "__main__":
    main()
