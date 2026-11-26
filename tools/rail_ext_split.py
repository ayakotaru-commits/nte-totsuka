"""線路の延長 (rail_ext.py の結果) を、区間ごとのファイルに分ける (ブラウザは近くの区間だけを読む。舞浜までの計画の段階 1)。

使い方: python tools/rail_ext_split.py      (data/raw/rail_ext_full.json → public/data/rail_ext/。rail_ext.py も最後にこれを呼ぶ)
出力:   public/data/rail_ext/index.json   最初に読む小さいファイル
          source, chunk (区間の大きさ m), bounds (延長の範囲 {minX, maxX, minZ, maxZ}),
          routes, stations (rail_ext.py と同じ。電車の道筋・駅は全部を最初から持つ), lines (新しい線の設定。あれば),
          chunks: [[a, b, バイト数], ...] (区間 a_b = x が 1000a〜1000(a+1)、z が 1000b〜1000(b+1))
          overview: 大きい地図の下絵 {step, x0, z0, rows: [[j, i0, n, i0, n, ...], ...] (細かい地形のある所。25 m 升目), roads: 幅 8 m 以上の道路}
        public/data/rail_ext/c_<a>_<b>.json   区間ごと
          fine:   細かい地形 {own: 区間の升目の範囲 [i0, j0, i1, j1), rows: [[j, i0, h(cm), ...]]} (頂点は区間の升目 + まわり 1 升。法線を分ける前と同じに計算するため)
          coarse: 粗い地形 {i0, j0, ni, nj, h: [cm...], cells: 升目の有無 (base64 のビット列。まわり 1 升を含む窓)}
                  (細かい地形の下に隠れる升目・地図の範囲の升目は rail_ext.py の元の描き方と同じく除く)
          urban:  市街地 (建物の近く) の 10 m 升目 (base64 のビット列。区間 + まわり 2 升 = 104 × 104)
          buildings: [[輪郭, 足元の y, 高さ, 下端, 色の乱数の種 (位置から)], ...] (輪郭の外接矩形の中心で区間を決める)
          roads: 道路を区間の境目で切ったもの、trees: [[x, y, z, 大きさ, 番号 (位置から)]]、poles、portals、
          piers: 高架の橋脚 [[x, 上端, z, 向き, 下端, 幅], ...] (新しい線の高架。ある区間だけ)
区間に分けても、描いた結果が分ける前と同じになるようにしてある (法線・色・乱数の種。detail/railext.js)。
建物の色の種・木の番号は位置から決める (段階 2 で、通し番号から変えた。駅を足すと、通し番号ではほかの所の色が全部ずれたため)。
"""
import base64
import json
import math
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FULL = ROOT / "data" / "raw" / "rail_ext_full.json"
OUT_DIR = ROOT / "public" / "data" / "rail_ext"
CH = 1000.0          # 区間の大きさ (m)
UCELL = 10.0         # 市街地の升目 (railext.js の groundColor と同じ)
UPAD = 2             # 市街地の升目の、まわりの余分
MAIN = json.loads((ROOT / "public" / "data" / "city.json").read_text())["bounds"]


def ck(x, z):
    return int(math.floor(x / CH)), int(math.floor(z / CH))


def in_main(x, z):   # railext.js の inMain と同じ (境目は含まない)
    return MAIN["minX"] < x < MAIN["maxX"] and MAIN["minZ"] < z < MAIN["maxZ"]


def jround(v):       # JS の Math.round
    return int(math.floor(v + 0.5))


def pos_hash(x, z):
    """位置 (0.1 m 単位) から決まる整数 (0〜2^31)"""
    h = (jround(x * 10) * 73856093) ^ (jround(z * 10) * 19349663)
    h = (h ^ (h >> 13)) * 1274126177
    return (h ^ (h >> 16)) & 0x7FFFFFFF


def bits(flags):
    b = bytearray((len(flags) + 7) // 8)
    for k, f in enumerate(flags):
        if f:
            b[k >> 3] |= 1 << (k & 7)
    return base64.b64encode(bytes(b)).decode()


def cell_range(lo, step, n, a):
    """格子 (原点 lo・間隔 step・升目 n 個) の升目のうち、中心が [a CH, (a+1) CH) にあるものの番号の範囲 [i0, i1)"""
    i0 = max(0, math.ceil((a * CH - lo) / step - 0.5))
    i1 = min(n, math.ceil(((a + 1) * CH - lo) / step - 0.5))
    return i0, i1


def split(E):
    T, C = E["terrain"], E["coarse"]
    chunks = {}

    def chunk(k):
        if k not in chunks:
            chunks[k] = {"buildings": [], "roads": [], "trees": [], "poles": [], "portals": []}
        return chunks[k]

    # ---------- 細かい地形 ----------
    fine = {}
    for row in T["rows"]:
        j, i0 = row[0], row[1]
        for k, h in enumerate(row[2:]):
            fine[(i0 + k, j)] = h
    fi, fj = {i for i, _ in fine}, {j for _, j in fine}
    ka = range(ck(T["x0"], 0)[0], ck(T["x0"] + T["nx"] * T["step"], 0)[0] + 1)
    kb = range(ck(0, T["z0"])[1], ck(0, T["z0"] + T["nz"] * T["step"])[1] + 1)
    for a in ka:
        ci0, ci1 = cell_range(T["x0"], T["step"], T["nx"] - 1, a)
        for b in kb:
            cj0, cj1 = cell_range(T["z0"], T["step"], T["nz"] - 1, b)
            if ci0 >= ci1 or cj0 >= cj1:
                continue
            rows = []
            for j in range(cj0 - 1, cj1 + 2):     # 頂点の窓: 升目 [c0 - 1, c1 + 1) の頂点
                if j not in fj:
                    continue
                cur = None
                for i in range(ci0 - 1, ci1 + 2):
                    h = fine.get((i, j))
                    if h is None:
                        if cur:
                            rows.append(cur)
                        cur = None
                    else:
                        if cur is None:
                            cur = [j, i]
                        cur.append(h)
                if cur:
                    rows.append(cur)
            if rows:
                chunk((a, b))["fine"] = {"own": [ci0, cj0, ci1, cj1], "rows": rows}

    def fine_at(x, z):   # railext.js の fineAt と同じ
        return (jround((x - T["x0"]) / T["step"]), jround((z - T["z0"]) / T["step"])) in fine

    # ---------- 粗い地形 (元の描き方で描く升目だけ) ----------
    cs = C["step"]
    present = {}
    for j in range(C["nz"] - 1):
        for i in range(C["nx"] - 1):
            x, z = C["x0"] + (i + 0.5) * cs, C["z0"] + (j + 0.5) * cs
            if in_main(x, z):
                continue
            H = C["h"]
            if None in (H[j * C["nx"] + i], H[j * C["nx"] + i + 1], H[(j + 1) * C["nx"] + i], H[(j + 1) * C["nx"] + i + 1]):
                continue   # 線路から遠い所 (rail_ext.py が値を作っていない)
            if fine_at(x - cs / 2, z - cs / 2) and fine_at(x + cs / 2, z - cs / 2) and fine_at(x - cs / 2, z + cs / 2) and fine_at(x + cs / 2, z + cs / 2):
                continue
            present[(i, j)] = True
    for a in range(ck(C["x0"], 0)[0], ck(C["x0"] + C["nx"] * cs, 0)[0] + 1):
        ci0, ci1 = cell_range(C["x0"], cs, C["nx"] - 1, a)
        for b in range(ck(0, C["z0"])[1], ck(0, C["z0"] + C["nz"] * cs)[1] + 1):
            cj0, cj1 = cell_range(C["z0"], cs, C["nz"] - 1, b)
            if ci0 >= ci1 or cj0 >= cj1:
                continue
            if "fine" not in chunks.get((a, b), {}) and not any((i, j) in present for i in range(ci0, ci1) for j in range(cj0, cj1)):
                continue   # 地図の範囲の中だけ (延長の地形は要らない)
            wi0, wj0 = max(0, ci0 - 1), max(0, cj0 - 1)          # 升目の窓
            wi1, wj1 = min(C["nx"] - 1, ci1 + 1), min(C["nz"] - 1, cj1 + 1)
            ni, nj = wi1 - wi0 + 1, wj1 - wj0 + 1                 # 頂点の数
            h = [C["h"][j * C["nx"] + i] or 0 for j in range(wj0, wj1 + 1) for i in range(wi0, wi1 + 1)]
            cells = [(i, j) in present for j in range(wj0, wj1) for i in range(wi0, wi1)]
            chunk((a, b))["coarse"] = {"i0": wi0, "j0": wj0, "ni": ni, "nj": nj, "own": [ci0, cj0, ci1, cj1], "h": h, "cells": bits(cells)}

    # ---------- 市街地の升目 (railext.js の urban と同じ: 建物の外接矩形 ± 12 m) ----------
    urban = set()
    for b in E["buildings"]:
        xs, zs = [q[0] for q in b[0]], [q[1] for q in b[0]]
        for i in range(math.floor((min(xs) - 12) / UCELL), math.floor((max(xs) + 12) / UCELL) + 1):
            for j in range(math.floor((min(zs) - 12) / UCELL), math.floor((max(zs) + 12) / UCELL) + 1):
                urban.add((i, j))
    N = int(CH / UCELL)
    for (a, b), c in chunks.items():
        if "fine" not in c:
            continue
        i0, j0 = a * N - UPAD, b * N - UPAD
        c["urban"] = bits([(i0 + i, j0 + j) in urban for j in range(N + 2 * UPAD) for i in range(N + 2 * UPAD)])

    # ---------- 建物 (色の乱数の種は輪郭の位置から決める。駅を足しても、ほかの建物の色が変わらないように) ----------
    for bd in E["buildings"]:
        xs, zs = [q[0] for q in bd[0]], [q[1] for q in bd[0]]
        cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
        chunk(ck(cx, cz))["buildings"].append(bd + [pos_hash(cx, cz) % 2147483646 + 1])

    # ---------- 道路: 線分の中点の区間ごとに切る ----------
    for rd in E["roads"]:
        w, pts = rd[0], list(zip(rd[1::2], rd[2::2]))
        cur, key = None, None
        for p, q in zip(pts, pts[1:]):
            k = ck((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
            if k != key:
                if cur:
                    chunk(key)["roads"].append(cur)
                cur, key = [w, p[0], p[1]], k
            cur += [q[0], q[1]]
        if cur:
            chunk(key)["roads"].append(cur)

    for rd in E.get("walks", []):   # 歩道 (入園口へ歩く道): 道路と同じように区間ごとに切る
        w, pts = rd[0], list(zip(rd[1::2], rd[2::2]))
        cur, key = None, None
        for p, q in zip(pts, pts[1:]):
            k = ck((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
            if k != key:
                if cur:
                    chunk(key).setdefault("walks", []).append(cur)
                cur, key = [w, p[0], p[1]], k
            cur += [q[0], q[1]]
        if cur:
            chunk(key).setdefault("walks", []).append(cur)

    for t in E["trees"]:   # 色・形の番号も位置から (同上)
        chunk(ck(t[0], t[2]))["trees"].append(t + [pos_hash(t[0], t[2]) % 100003])
    for p in E["poles"]:
        chunk(ck(p[0], p[2]))["poles"].append(p)
    for p in E["portals"]:
        chunk(ck(p[0], p[2]))["portals"].append(p)
    for p in E.get("piers", ()):   # 高架の橋脚 (新しい線。段階 3b)。ある区間だけ
        chunk(ck(p[0], p[2])).setdefault("piers", []).append(p)
    return chunks


def overview(E):
    """大きい地図の下絵: 細かい地形のある所 (25 m 升目)・太い道路"""
    T, step = E["terrain"], 25.0
    cells = set()
    for row in E["terrain"]["rows"]:
        j, i0, n = row[0], row[1], len(row) - 2
        z = T["z0"] + j * T["step"]
        for i in range(i0, i0 + n):
            cells.add((math.floor((T["x0"] + i * T["step"] - T["x0"]) / step), math.floor((z - T["z0"]) / step)))
    rows = {}
    for i, j in sorted(cells, key=lambda q: (q[1], q[0])):
        r = rows.setdefault(j, [j])
        if len(r) > 1 and r[-2] + r[-1] == i:
            r[-1] += 1
        else:
            r += [i, 1]
    return {"step": step, "x0": T["x0"], "z0": T["z0"], "rows": list(rows.values()), "roads": [rd for rd in E["roads"] if rd[0] >= 8]}


def write(E):
    chunks = split(E)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("c_*.json"):
        old.unlink()
    lst = []
    for (a, b) in sorted(chunks):
        p = OUT_DIR / f"c_{a}_{b}.json"
        p.write_text(json.dumps(chunks[(a, b)], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        lst.append([a, b, p.stat().st_size])
    T = E["terrain"]
    index = {
        "source": E["source"], "chunk": CH,
        "bounds": {"minX": T["x0"], "maxX": T["x0"] + T["nx"] * T["step"], "minZ": T["z0"], "maxZ": T["z0"] + T["nz"] * T["step"]},
        "terrain": {k: T[k] for k in ("step", "x0", "z0", "nx", "nz")},
        "coarse": {k: E["coarse"][k] for k in ("step", "x0", "z0", "nx", "nz")},
        "routes": E["routes"], "stations": E["stations"], "chunks": lst, "overview": overview(E),
    }
    if E.get("lines"):   # 新しい線 (京葉線など) の名前・帯の色・両数・周期・向きの名前 (detail/trains.js・ride.js)
        index["lines"] = E["lines"]
    ip = OUT_DIR / "index.json"
    ip.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tot = sum(q[2] for q in lst)
    print(f"-> {OUT_DIR}: index {ip.stat().st_size / 1e6:.2f} MB、区間 {len(lst)} 個 計 {tot / 1e6:.2f} MB (最大 {max(q[2] for q in lst) / 1e6:.2f} MB)")


if __name__ == "__main__":
    src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else FULL
    write(json.loads(src.read_text(encoding="utf-8")))
