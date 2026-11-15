"""高架の橋の下の地形を、周りの地面の高さに戻す。

使い方: python tools/terrain_bridges.py          # public/data/terrain.json を書き換える (numpy が必要)
        python tools/terrain_bridges.py --undo   # 元に戻す
先に python tools/deck_heights.py (橋の高さ ys を実測に合わせる)。最後に build_props.py も実行する。
deck_heights.py は「下げる前の地形」で測るので、どちらを何度実行しても同じ結果になる。

地形 (terrain.json) は点群の各マスの最低点から作ってあるので、幅の広い高架の下は「高架の路面」が地面として入り、
高架に沿って土手のように盛り上がる (下をくぐる道路や横断歩道が斜面に貼り付いて、うねって見える)。
- 橋 (bridge。車道・歩行者用) の路面の範囲 + 4 m を「橋の下」とする
- 橋の下の地形を、範囲の外の地面からなめらかに補う (ラプラス方程式)
- 補った地面が橋の路面より 1.5 m 以上低い所だけ、その高さに下げる (地面と同じ高さの橋・川の上の橋は変わらない)
- 建物の基礎の高さ y は、輪郭の頂点の地面が下がった建物だけ、屋根の高さを保ったまま下げる
元の高さは terrain.json の patch に控えるので、何度実行しても同じ結果になり、--undo で戻せる。
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


def apply(T, city):
    nx, nz, st, x0, z0 = T["nx"], T["nz"], T["step"], T["minX"], T["minZ"]
    h = np.array(T["h"], dtype=np.float64).reshape(nz, nx) / 100
    mask = np.zeros((nz, nx), bool)
    deck = np.full((nz, nx), -1e9)   # その頂点の上にある橋の路面の高さ (一番高いもの)
    for r in city["roads"]:
        if not r.get("bridge") or not r.get("ys"):
            continue
        hl, hr = r["half"] if r.get("half") else ((r.get("w") or 3) / 2,) * 2
        for (a, b, ya, yb) in zip(r["pts"], r["pts"][1:], r["ys"], r["ys"][1:]):
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            if L < 0.05:
                continue
            ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            m = max(hl, hr) + MARGIN + st
            i0, i1 = int((min(a[0], b[0]) - m - x0) / st), int((max(a[0], b[0]) + m - x0) / st) + 1
            j0, j1 = int((min(a[1], b[1]) - m - z0) / st), int((max(a[1], b[1]) + m - z0) / st) + 1
            i0, j0, i1, j1 = max(i0, 0), max(j0, 0), min(i1, nx - 1), min(j1, nz - 1)
            if i1 < i0 or j1 < j0:
                continue
            X, Z = np.meshgrid(x0 + np.arange(i0, i1 + 1) * st, z0 + np.arange(j0, j1 + 1) * st)
            t = np.clip(((X - a[0]) * ux + (Z - a[1]) * uz) / L, 0, 1)
            side = (X - a[0]) * -uz + (Z - a[1]) * ux          # 左が正 (half[0] の側)
            d = np.hypot(X - a[0] - ux * L * t, Z - a[1] - uz * L * t)
            inside = d <= np.where(side >= 0, hl, hr) + MARGIN
            sub = mask[j0:j1 + 1, i0:i1 + 1]
            sub |= inside
            dk = deck[j0:j1 + 1, i0:i1 + 1]
            np.maximum(dk, np.where(inside, ya + (yb - ya) * t, -1e9), out=dk)
    # 範囲の外の地面から補う: 橋の下の頂点だけを動かして、上下左右の平均に近づける (初期値は今の高さ)
    fill = h.copy()
    js, is_ = np.nonzero(mask)
    ok = (js > 0) & (js < nz - 1) & (is_ > 0) & (is_ < nx - 1)
    js, is_ = js[ok], is_[ok]
    red = (js + is_) % 2 == 0
    for _ in range(3000):
        for sel in (red, ~red):  # 赤黒の順に更新 (過緩和)
            j, i = js[sel], is_[sel]
            avg = (fill[j - 1, i] + fill[j + 1, i] + fill[j, i - 1] + fill[j, i + 1]) / 4
            fill[j, i] += 1.8 * (avg - fill[j, i])
    # 橋の路面より十分低い所だけ下げる (境目はなめらかに)
    k = np.clip((deck - fill - (CLEAR - 0.5)) / 0.5, 0, 1)
    new = np.where(mask, np.minimum(h, h + (fill - h) * k), h)
    changed = np.nonzero(np.abs(new - h) > 0.02)
    idx = (changed[0] * nx + changed[1]).tolist()
    patch = {"idx": idx, "h0": [T["h"][i] for i in idx], "buildings": []}
    for i, v in zip(idx, np.round(new[changed] * 100).astype(int).tolist()):
        T["h"][i] = v
    # 建物: 輪郭の頂点の地面が下がった建物は、屋根の高さを保ったまま基礎を下げる
    H = sampler(T)
    for b in city["buildings"]:
        if "y" not in b or b.get("minH"):
            continue
        g = min(H(x, z) for x, z in b["outer"])
        if g < b["y"] - 0.2:
            patch["buildings"].append([b["id"], b["y"], b["h"]])
            d = b["y"] - round(g, 2)
            b["y"], b["h"] = round(g, 2), round(b["h"] + d, 2)
    T["patch"] = patch
    drop = h[changed] - new[changed]
    return len(idx), (float(drop.max()) if len(idx) else 0.0), len(patch["buildings"])


def main():
    T = json.loads(TERRAIN.read_text(encoding="utf-8"))
    city = json.loads(CITY.read_text(encoding="utf-8"))
    had = restore(T, city)
    if "--undo" in sys.argv:
        print("元に戻した" if had else "戻すものが無い")
    else:
        n, mx, nb = apply(T, city)
        print(f"terrain under bridges: {n} 頂点を下げた (最大 {mx:.1f} m)、基礎を下げた建物 {nb} 棟")
    TERRAIN.write_text(json.dumps(T), encoding="utf-8")  # 書式は元のまま (差分を小さく)
    CITY.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    try:
        import build_props
        build_props.main()
    except Exception as e:  # noqa
        print("build_props.py は実行できなかった:", e)


if __name__ == "__main__":
    main()
