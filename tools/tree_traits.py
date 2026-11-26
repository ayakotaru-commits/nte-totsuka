"""点群と航空写真から、木 1 本ごとの「葉の色・樹形・幅」を読む。

使い方: python tools/tree_traits.py            (numpy・Pillow が必要。先に fetch_lidar.py と fetch_ortho.py)
        python tools/tree_traits.py --undo     出力を消して build_props.py をやり直す (元の見た目に戻る)
        python tools/tree_traits.py --sheet <out.png> [kind]   種類ごとの見本 (航空写真の切り出し) を並べた画像 (確認用)
入力:   data/lots.json                 木の位置と高さ (tools/lidar_cover.py)
        data/raw/lidar_cover.npz       点群を 1 m の格子にしたもの (無ければ点群から作る。数分)
        data/raw/ortho_rgb.bin         航空写真の色の格子 (色を数値として読むだけ。写真は貼らない)
        public/data/city.json          建物 (木の高さの輪から外す)
出力:   data/tree_traits.json          [x, z, 種類, 葉の色 0xRRGGBB, 幅の倍率 x100] の列。build_props.py が props.json の trees にする

読み方:
  色    木の中心から半径 (樹冠の半径 x 0.55) の円の中の航空写真の画素のうち、緑が勝つもの (2g - r - b > 0。15% に満たなければ読まない) を残し、暗い側 30%・明るい側 10% を除いた
        中央値。元の写真は彩度がほぼ 0 (0.01〜0.12) なので、全体の 5〜95 パーセンタイルを、葉らしい色相・明るさ・彩度の範囲に引き伸ばす
        (木どうしの違いだけを使う。絶対値は写真から読めない)
  樹形  1 m の格子の高さ (地面から一番高い反射まで) を、木の中心から 1 m ごとの輪に分けて見る:
          樹冠の半径 rc = 高さが木の頂点の 40% を下回る最初の輪
          円すい度   = 半径 rc/2 の輪の高さ / 頂点 (丸い樹冠は 0.85 以上、円すいは 0.6 以下)
        種類: 3 低木 (頂点 3.2 m 未満)、2 細い木 (幅 / 高さ < 0.2、高さ 7〜16 m)、1 針葉樹 (円すい度 < 0.62・幅 / 高さ < 0.3)、0 それ以外 (広葉樹)
        点群の「木」には、建物の縁・屋根の上の物・車も混ざる (航空写真と並べて確かめた。緑でない所の約 3 割は日陰の濃い木)。
        木は除かず、種類だけ厳しめにして、細い・高い形 (高い建物の角) は広葉樹のままにした
  幅    (rc / 頂点) を、基準の木 (半径 1.7 m / 高さ 4.9 m = 0.35) との比にして 0.6〜1.5 に収める (密な林は隣の木の樹冠とつながって、幅が大きく出る)
"""
import json
import pathlib
import sys

import numpy as np

import lidar_cover as LC

ROOT = LC.ROOT
LOTS = ROOT / "data" / "lots.json"
OUT = ROOT / "data" / "tree_traits.json"
RES = 1.0

# 葉らしい色の範囲 (HLS)。写真の相対的な順位をここへ引き伸ばす
HUE = (0.19, 0.285)
LIT = (0.25, 0.48)
SAT = (0.30, 0.58)

SHRUB_H = 3.2
SLENDER_W = 0.20       # 幅 / 高さ がこれ未満で、高さ 7〜16 m なら細い木 (高い建物の角・縁を木と読んだものは 16 m を超える)
CONIFER_POINT = 0.62   # 円すい度がこれ未満
CONIFER_W = 0.30       # かつ 幅 / 高さ がこれ未満 (高さ 5〜25 m) なら針葉樹


def ortho_full():
    m = json.loads(LC.ORTHO_META.read_text(encoding="utf-8"))
    a = np.frombuffer(LC.ORTHO_BIN.read_bytes(), np.uint8).reshape(m["nz"], m["nx"], 3)
    return a, m


def leaf_rgb(a, m, x, z, r):
    """木の中心の周り r m の円の、葉の色 (r, g, b の 0〜255 の小数) と画素数。取れなければ None"""
    res = m["res"]
    i0, j0 = int((x - r - m["minX"]) / res), int((z - r - m["minZ"]) / res)
    n = int(2 * r / res) + 1
    if i0 < 0 or j0 < 0 or i0 + n > m["nx"] or j0 + n > m["nz"]:
        return None
    sub = a[j0:j0 + n, i0:i0 + n].astype(np.float32)
    ys, xs = np.mgrid[0:n, 0:n]
    inside = (xs - n / 2 + 0.5) ** 2 + (ys - n / 2 + 0.5) ** 2 <= (n / 2) ** 2
    px = sub[inside]
    px = px[px.max(axis=1) > 0]                                     # データ無し
    n_all = len(px)
    px = px[2 * px[:, 1] - px[:, 0] - px[:, 2] > 0]                 # 緑が勝つ画素だけ (屋根・舗装・土を除く)
    if n_all < 6 or len(px) < max(6, 0.15 * n_all):                 # 緑が 15% に満たなければ色は読まない
        return None
    lum = px.sum(axis=1)
    lo, hi = np.quantile(lum, [0.3, 0.9])
    px = px[(lum >= lo) & (lum <= hi)]
    if len(px) == 0:
        return None
    return np.median(px, axis=0)


def to_hls(c):
    import colorsys
    r, g, b = (float(v) / 255 for v in c)
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return h, l, s


def profile(hgt, bld, ci, cj, R):
    """木の中心 (格子 ci, cj) から 1 m ごとの輪の高さの平均 (m) と頂点の高さ。建物のマスは除く"""
    nz, nx = hgt.shape
    j0, j1, i0, i1 = max(0, cj - R - 1), min(nz, cj + R + 2), max(0, ci - R - 1), min(nx, ci + R + 2)
    sub, bsub = hgt[j0:j1, i0:i1], bld[j0:j1, i0:i1]
    ys, xs = np.mgrid[j0:j1, i0:i1]
    d = np.hypot(xs - ci, ys - cj)
    near = d <= 1.5
    top = float(np.max(sub[near & ~bsub])) if (near & ~bsub).any() else 0.0
    rings = []
    for k in range(R + 1):
        sel = (d >= k - 0.5) & (d < k + 0.5) & ~bsub
        rings.append(float(sub[sel].mean()) if sel.any() else None)
    return top, rings


def read_shape(top, rings, R):
    """(樹冠の半径 rc, 円すい度)"""
    rc = 0.0
    for k, v in enumerate(rings):
        if v is None or v < 0.4 * top:
            break
        rc = k + 0.5
    rc = max(rc, 1.0)
    half = min(len(rings) - 1, max(1, int(round(rc / 2))))
    v = rings[half] if rings[half] is not None else rings[0]
    point = (v or 0) / top if top > 0 else 1.0
    return rc, point


def classify(top, rc, point):
    w = rc / max(top, 1.0)
    if top < SHRUB_H:
        return 3, w
    if w < SLENDER_W and 7.0 <= top <= 16.0:
        return 2, w
    if point < CONIFER_POINT and w < CONIFER_W and 5.0 <= top <= 25.0:
        return 1, w
    return 0, w


def run():
    city = json.loads(LC.CITY.read_text(encoding="utf-8"))
    B = city["bounds"]
    g = LC.load_grid(B)
    shape = g["zmax"].shape
    bld = LC.city_masks(city, shape)[0]
    _, hgt, _, _ = LC.features(g, B)
    a, om = ortho_full()
    trees = json.loads(LOTS.read_text(encoding="utf-8"))["trees"]
    rows = []
    for x, z, h in trees:
        ci, cj = int((x - B["minX"]) / RES), int((z - B["minZ"]) / RES)
        R = int(min(5, max(3, 0.45 * h)))
        top, rings = profile(hgt, bld, ci, cj, R)
        if top < 1.0:
            top = h
            rings = [h] * (R + 1)
        rc, point = read_shape(top, rings, R)
        kind, w = classify(top, rc, point)
        col = leaf_rgb(a, om, x, z, max(0.8, rc * 0.55))
        rows.append([x, z, kind, w, point, top, rc, col])
    # 色: 全体の相対順位を葉らしい範囲に引き伸ばす
    hls = [to_hls(r[7]) if r[7] is not None else None for r in rows]
    ok = [v for v in hls if v is not None]
    q = {k: np.quantile([v[k] for v in ok], [0.05, 0.95]) for k in range(3)}
    out = []
    for r, v in zip(rows, hls):
        if v is None:
            rgb = -1
        else:
            import colorsys
            t = [float(np.clip((v[k] - q[k][0]) / max(q[k][1] - q[k][0], 1e-6), 0, 1)) for k in range(3)]
            hh = HUE[0] + (HUE[1] - HUE[0]) * t[0]
            ll = LIT[0] + (LIT[1] - LIT[0]) * t[1]
            ss = SAT[0] + (SAT[1] - SAT[0]) * t[2]
            R_, G_, B_ = colorsys.hls_to_rgb(hh, ll, ss)
            rgb = (int(R_ * 255 + 0.5) << 16) | (int(G_ * 255 + 0.5) << 8) | int(B_ * 255 + 0.5)
        wr = int(round(100 * float(np.clip(r[3] / 0.35, 0.6, 1.5))))
        out.append([r[0], r[1], r[2], rgb, wr])
    return out, rows


def main():
    if "--undo" in sys.argv:
        if OUT.exists():
            OUT.unlink()
            print("削除:", OUT)
        return
    out, rows = run()
    kinds = np.bincount([o[2] for o in out], minlength=4)
    print(f"木 {len(out)} 本 / 種類 広葉樹 {kinds[0]}・針葉樹 {kinds[1]}・細い木 {kinds[2]}・低木 {kinds[3]} / 色が読めた {sum(1 for o in out if o[3] >= 0)} 本")
    OUT.write_text(json.dumps({"source": "tools/tree_traits.py (神奈川県 令和3年度 3次元点群データ・オルソ画像 CC BY 4.0 から読んだ葉の色・樹形)",
                               "trees": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("書き出し:", OUT)
    if "--sheet" in sys.argv:
        sheet(rows, sys.argv[sys.argv.index("--sheet") + 1])


def sheet(rows, path):
    """種類ごとの見本: 航空写真の切り出し (木を中心に 16 m 四方) を 12 本ずつ並べる"""
    from PIL import Image, ImageDraw
    a, om = ortho_full()
    kinds = [int(v) for v in sys.argv[sys.argv.index("--sheet") + 2:] if v.isdigit()] or [0, 1, 2, 3]
    S, per = 128, 12
    img = Image.new("RGB", (S * per, S * len(kinds)), (30, 30, 30))
    d = ImageDraw.Draw(img)
    rng = np.random.RandomState(3)
    for row, k in enumerate(kinds):
        sel = [r for r in rows if r[2] == k]
        for col, r in enumerate(rng.permutation(len(sel))[:per]):
            x, z = sel[r][0], sel[r][1]
            i0, j0 = int((x - 8 - om["minX"]) / om["res"]), int((z - 8 - om["minZ"]) / om["res"])
            if i0 < 0 or j0 < 0 or i0 + 32 > om["nx"] or j0 + 32 > om["nz"]:
                continue
            tile = Image.fromarray(a[j0:j0 + 32, i0:i0 + 32]).resize((S, S), Image.LANCZOS)
            img.paste(tile, (col * S, row * S))
            d.text((col * S + 3, row * S + 3), f"h{sel[r][5]:.0f} r{sel[r][6]:.1f} p{sel[r][4]:.2f}", fill=(255, 255, 0))
    img.save(path)
    print("見本:", path)


if __name__ == "__main__":
    main()
