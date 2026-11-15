"""高架の橋の下の地形を、周りの地面の高さに戻す。

使い方: python tools/terrain_bridges.py          # public/data/terrain.json を書き換える (numpy が必要。先に fetch_lidar.py)
        python tools/terrain_bridges.py --undo   # 元に戻す
最後に deck_heights.py (橋・階段の高さ。たもとは地面に固定するので、地面を直した後に決める) と build_props.py も実行する。

地形 (terrain.json) は点群の各マスの最低点から作ってあるので、幅の広い高架の下は「高架の路面」が地面として入り、
高架に沿って土手のように盛り上がる (下をくぐる道路や横断歩道が斜面に貼り付いて、うねって見える)。
- 橋 (bridge。車道・歩行者用) の路面の範囲 + 4 m を「橋の下」とする
- 橋の下の各頂点から、橋に直角な両方向へ範囲の外まで進み、そこの地面の高さを見る
- 両側とも低い所だけ、高い方の地面の高さまで下げる。片側が高い所 (橋が高台や、地形として入っている広場の縁に
  載っている所) は削らない
- 点群の表面 (= 橋の路面) が、下げた後の地面より 1.5 m 以上高い所だけ (地面と同じ高さの橋・川の上の橋は変わらない)
- 建物の基礎の高さ y は、輪郭の頂点の地面が下がった建物だけ、屋根の高さを保ったまま下げる
元の高さは terrain.json の patch に控えるので、何度実行しても同じ結果になり、--undo で戻せる。
橋の高さ (ys) には依らない (deck_heights.py とは互いに影響し合わない)。
"""
import json
import math
import pathlib
import sys

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
CITY = ROOT / "public" / "data" / "city.json"
TERRAIN = ROOT / "public" / "data" / "terrain.json"
MARGIN = 4.0     # 橋の縁から外へ広げる幅 (m)。地形のぼやけの分
CLEAR = 1.5      # 補った地面が橋の路面よりこれ以上低ければ、橋の下は空いているとみなす


def restore(T, city):
    p = T.pop("patch", None)
    if not p:
        return False
    for i, v in zip(p["idx"], p["h0"]):
        T["h"][i] = v
    by_id = {b["id"]: b for b in city["buildings"]}
    for bid, y0, h0 in p.get("buildings", []):
        b = by_id.get(bid)
        if b:
            b["y"], b["h"] = y0, h0
    return True


def sampler(T):
    nx, nz, st, x0, z0, h = T["nx"], T["nz"], T["step"], T["minX"], T["minZ"], T["h"]

    def H(x, z):
        fx = max(0.0, min(nx - 1.0001, (x - x0) / st)); fz = max(0.0, min(nz - 1.0001, (z - z0) / st))
        i, j = int(fx), int(fz); u, v = fx - i, fz - j
        g = lambda a, b: h[b * nx + a] / 100
        h00, h10, h01, h11 = g(i, j), g(i + 1, j), g(i, j + 1), g(i + 1, j + 1)
        return h00 + u * (h10 - h00) + v * (h11 - h10) if u >= v else h00 + v * (h01 - h00) + u * (h11 - h01)
    return H


def lower_buildings(T, city, patch):
    """輪郭の頂点の地面が下がった建物は、屋根の高さを保ったまま基礎を下げる (元の値は patch に控える)"""
    H = sampler(T)
    for b in city["buildings"]:
        if "y" not in b or b.get("minH"):
            continue
        g = min(H(x, z) for x, z in b["outer"])
        if g < b["y"] - 0.2:
            patch["buildings"].append([b["id"], b["y"], b["h"]])
            d = b["y"] - round(g, 2)
            b["y"], b["h"] = round(g, 2), round(b["h"] + d, 2)


def apply(T, city, dsm):
    nx, nz, st, x0, z0, ref = T["nx"], T["nz"], T["step"], T["minX"], T["minZ"], T.get("ref", 0.0)
    h = np.array(T["h"], dtype=np.float64).reshape(nz, nx) / 100
    mask = np.zeros((nz, nx), bool)
    cells = []   # (j, i, 橋に直角な向き nx, nz)
    for r in city["roads"]:
        if not r.get("bridge") or r.get("edge"):
            continue
        pts = [r["pts"][k] for k in r["base"]] if r.get("base") else r["pts"]  # deck_heights.py が足した頂点は使わない
        hl, hr = r["half"] if r.get("half") else ((r.get("w") or 3) / 2,) * 2
        for a, b in zip(pts, pts[1:]):
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            if L < 0.05:
                continue
            ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            m = max(hl, hr) + MARGIN + st
            i0, i1 = int((min(a[0], b[0]) - m - x0) / st), int((max(a[0], b[0]) + m - x0) / st) + 1
            j0, j1 = int((min(a[1], b[1]) - m - z0) / st), int((max(a[1], b[1]) + m - z0) / st) + 1
            i0, j0, i1, j1 = max(i0, 1), max(j0, 1), min(i1, nx - 2), min(j1, nz - 2)
            if i1 < i0 or j1 < j0:
                continue
            X, Z = np.meshgrid(x0 + np.arange(i0, i1 + 1) * st, z0 + np.arange(j0, j1 + 1) * st)
            t = np.clip(((X - a[0]) * ux + (Z - a[1]) * uz) / L, 0, 1)
            side = (X - a[0]) * -uz + (Z - a[1]) * ux          # 左が正 (half[0] の側)
            d = np.hypot(X - a[0] - ux * L * t, Z - a[1] - uz * L * t)
            inside = d <= np.where(side >= 0, hl, hr) + MARGIN
            mask[j0:j1 + 1, i0:i1 + 1] |= inside
            for jj, ii in zip(*np.nonzero(inside)):
                cells.append((j0 + int(jj), i0 + int(ii), -uz, ux))

    def at(x, z):
        i, j = int(round((x - x0) / st)), int(round((z - z0) / st))
        return (j, i) if 0 <= i < nx and 0 <= j < nz else None

    def outside(j, i, dx, dz):
        """(j, i) から (dx, dz) の向きへ進み、橋の範囲を出た所の地面の高さ。出られなければ None"""
        x, z = x0 + i * st, z0 + j * st
        for k in range(1, 40):
            q = at(x + dx * st * k, z + dz * st * k)
            if q is None:
                return None
            if not mask[q]:
                q2 = at(x + dx * st * (k + 1), z + dz * st * (k + 1))   # 境目のぼやけを避けて、もう 1 マス先も見る
                return min(h[q], h[q2]) if q2 is not None and not mask[q2] else h[q]
        return None

    # 橋の両側の地面がどちらも低い所だけ、高い方の地面の高さまで下げる
    # (片側が高い = 橋が高台や広場の縁に載っている所。そこは削らない)
    target = np.full((nz, nx), 1e9)
    seen = np.zeros((nz, nx), bool)
    for j, i, dx, dz in cells:
        a, b = outside(j, i, dx, dz), outside(j, i, -dx, -dz)
        v = 1e9 if a is None or b is None else max(a, b)
        target[j, i] = v if not seen[j, i] else min(target[j, i], v)   # 重なる橋は低い方
        seen[j, i] = True
    # 橋の路面 (点群の表面) が、下げた後の地面より CLEAR 以上高い所だけ
    surf = np.full((nz, nx), -1e9)
    for j, i in zip(*np.nonzero(seen)):
        vs = [v for v in (dsm.get(x0 + i * st + ox, z0 + j * st + oz) for ox in (-0.5, 0, 0.5) for oz in (-0.5, 0, 0.5)) if v is not None]
        if vs:
            surf[j, i] = sorted(vs)[len(vs) // 2] - ref
    drop = np.where(seen & (target < h - 0.3) & (surf - target >= CLEAR), h - target, 0.0)
    for _ in range(2):  # 下げ幅をならして、境目をなめらかに (下げない所は 0 のまま広げない)
        p = np.pad(drop, 1, mode="edge")
        sm = sum(p[1 + a:1 + a + nz, 1 + b:1 + b + nx] for a in (-1, 0, 1) for b in (-1, 0, 1)) / 9
        drop = np.where(mask, sm, 0.0)
    new = h - drop
    changed = np.nonzero(drop > 0.02)
    idx = (changed[0] * nx + changed[1]).tolist()
    patch = {"idx": idx, "h0": [T["h"][i] for i in idx], "buildings": []}
    for i, v in zip(idx, np.round(new[changed] * 100).astype(int).tolist()):
        T["h"][i] = v
    lower_buildings(T, city, patch)
    T["patch"] = patch
    return len(idx), (float(drop.max()) if len(idx) else 0.0), len(patch["buildings"])


def main():
    T = json.loads(TERRAIN.read_text(encoding="utf-8"))
    city = json.loads(CITY.read_text(encoding="utf-8"))
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import plaza_edges
    plaza_edges.restore(T, city)   # 後から足した分を先に戻す
    had = restore(T, city)
    if "--undo" in sys.argv:
        print("元に戻した" if had else "戻すものが無い")
    else:
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
        import lidar_shape
        if not lidar_shape.DSM_BIN.exists():
            raise SystemExit("data/raw/lidar_dsm.bin がありません。先に python tools/fetch_lidar.py を実行してください")
        dsm = lidar_shape.DSM()
        n, mx, nb = apply(T, city, dsm)
        print(f"terrain under bridges: {n} 頂点を下げた (最大 {mx:.1f} m)、基礎を下げた建物 {nb} 棟")
        ne, le = plaza_edges.apply(T, city, dsm, lower_buildings)
        print(f"plaza edges: 縁の床 {ne} 本 ({le:.0f} m)、地形 {len(T['patch_edges']['idx'])} 頂点")
    TERRAIN.write_text(json.dumps(T), encoding="utf-8")  # 書式は元のまま (差分を小さく)
    CITY.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # 地面が変わったので、橋・階段の高さ (たもとは地面に固定) と小物の高さを作り直す
    import deck_heights
    deck_heights.main()


if __name__ == "__main__":
    main()
