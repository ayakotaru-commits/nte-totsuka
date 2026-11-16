"""路上写真 (Mapillary) を見て、壁ごとのベランダの有無を判定するための道具 (半自動)。

写真の位置ずれ (1〜3 m) があるので、窓・ベランダの並びは自動では確かに読めない。そこで:
  1. sheet: 集合住宅などの壁ごとに、いちばんよく写った写真を選び、その壁の輪郭を写真に枠で描いて、番号付きの一覧画像にする
  2. 一覧を見て (人か Claude が) 壁ごとに b (ベランダあり) / w (窓だけ・ベランダなし) / ? (判断できない) を付け、
     label で data/facades.json に書く (壁の中点と外向きで記録する。建物の輪郭が作り直されても、近い壁に当てはまる)
  3. build_props.py が data/facades.json を読み、判定のある壁はそれに従ってベランダを置く (無い壁は今までの決まり)

使い方:
  python tools/facades.py sheet [x0,z0,x1,z1] [--not x0,z0,x1,z1] [--max 60]
                                                           一覧画像を data/raw/mapillary/sheets/ に作る (壁の一覧は walls.json)。
                                                           判定済みの壁と --not の範囲 (前に見た範囲など) は除く
  python tools/facades.py label "0:b 1:w 2:? ..."            一覧の番号に判定を付けて data/facades.json に足す (同じ壁は上書き)
写真は data/raw/mapillary/ (mapillary_walls.py fetch で取る) にあるものだけを使う。numpy と Pillow が必要。
"""
import json
import math
import pathlib
import sys

import numpy as np

import mapillary_walls as M

ROOT = pathlib.Path(__file__).resolve().parent.parent
LABELS = ROOT / "data" / "facades.json"
SHEETS = M.RAW / "sheets"
WALLS = SHEETS / "walls.json"
STYLES = {"apartment", "commercial", "public", None}
MIN_LEN = 6.0
TILE = (320, 240)
PER_SHEET = 12


def candidates(city, area, skip=None):
    for b in city["buildings"]:
        if b.get("part") or b.get("look") or b.get("style") not in STYLES or b.get("src") == "appearance":
            continue
        if b["h"] < 6 or (b.get("floors") or 0) < 2:
            continue
        xs, zs = [q[0] for q in b["outer"]], [q[1] for q in b["outer"]]
        cx, cz = sum(xs) / len(xs), sum(zs) / len(zs)
        if area and not (area[0] <= cx <= area[2] and area[1] <= cz <= area[3]):
            continue
        if skip and skip[0] <= cx <= skip[2] and skip[1] <= cz <= skip[3]:
            continue
        yield b, (min(xs), min(zs), max(xs), max(zs))


def wall_grid(b, i, step=0.5):
    """壁 i の格子点 (壁から 0.15 m 外) と、外向き・長さ"""
    o = b["outer"]
    s = 1 if M.signed_area(o) > 0 else -1
    (x1, z1), (x2, z2) = o[i], o[(i + 1) % len(o)]
    L = math.hypot(x2 - x1, z2 - z1)
    if L < MIN_LEN:
        return np.zeros((0, 3)), None, (0, 0), L, None
    ux, uz = (x2 - x1) / L, (z2 - z1) / L
    nx, nz = uz * s, -ux * s
    g = b.get("y") or 0
    top = g + b["h"] - ((b.get("roof") or {}).get("rise") or 0)
    ts = np.arange(0.25, L - 0.2, step)
    ys = np.arange(g + 0.5, top - 0.1, step)
    T, Y = np.meshgrid(ts, ys)
    P = np.stack([x1 + ux * T + nx * 0.15, Y, z1 + uz * T + nz * 0.15], -1).reshape(-1, 3)
    edge = np.array([(x1 + ux * t + nx * 0.15, y, z1 + uz * t + nz * 0.15)
                     for t, y in [*[(t, g) for t in np.linspace(0, L, 24)], *[(L, y) for y in np.linspace(g, top, 12)],
                                  *[(t, top) for t in np.linspace(L, 0, 24)], *[(0, y) for y in np.linspace(top, g, 12)]]])
    return P, edge, (nx, nz), L, (x1 + ux * L / 2, z1 + uz * L / 2)


def sheet(area, limit, skip=None):
    from PIL import Image, ImageDraw
    city = json.loads(M.CITY.read_text(encoding="utf-8"))
    plan = json.loads(M.PLAN.read_text())
    H = M.load_terrain()
    cams = {c.id: c for c in M.load_cams(H)}
    surf = M.Surface() if M.DSM_BIN.exists() else None
    occ = M.Occluders(city["buildings"], json.loads(M.PROPS.read_text()).get("trees", []), H, surf)
    walls, n_b = [], 0
    done = json.loads(LABELS.read_text(encoding="utf-8"))["walls"] if LABELS.exists() else []
    for b, box in candidates(city, area, skip):
        if b["id"] not in plan:
            continue
        got = False
        for i in range(len(b["outer"])):
            P, edge, (nx, nz), L, mid = wall_grid(b, i)
            if L < MIN_LEN or not len(P):
                continue
            if any(math.hypot(r["x"] - mid[0], r["z"] - mid[1]) < 1.5 and r["nx"] * nx + r["nz"] * nz > 0.9 for r in done):
                continue  # 判定済み
            if surf is not None:  # その高さに建物があること
                inner = surf(P[:, 0] - nx * 0.9, P[:, 2] - nz * 0.9)
                P = P[np.nan_to_num(inner, nan=-1e9) >= P[:, 1] - 0.6]
                if len(P) < 20:
                    continue
            best = None
            for iid, _, _ in plan[b["id"]]:
                c = cams.get(iid)
                if c is None or not (M.THUMBS / f"{iid}.jpg").exists():
                    continue
                dx, dz = c.x - P[:, 0], c.z - P[:, 2]
                d = np.hypot(dx, dz)
                ok = (d < 40) & ((dx * nx + dz * nz) > 0.35 * d)
                u, v, ok2 = c.project(P)
                ok &= ok2
                if ok.sum() < 20:
                    continue
                ok[ok] = occ.visible(c, P[ok], box)
                frac = ok.mean()
                score = frac * float(np.median((dx * nx + dz * nz)[ok] / d[ok])) / (1 + float(np.median(d[ok])) / 25) if ok.any() else 0
                if frac > 0.45 and (best is None or score > best[0]):
                    best = (score, c)
            if best is None:
                continue
            walls.append({"k": len(walls), "b": b["id"], "i": i, "img": best[1].id, "x": round(mid[0], 2), "z": round(mid[1], 2),
                          "nx": round(nx, 3), "nz": round(nz, 3), "len": round(L, 1), "edge": edge.tolist()})
            got = True
        n_b += got
        if n_b >= limit:
            break
    SHEETS.mkdir(parents=True, exist_ok=True)
    for f in SHEETS.glob("sheet_*.jpg"):
        f.unlink()
    for s0 in range(0, len(walls), PER_SHEET):
        cols = 4
        img = Image.new("RGB", (cols * TILE[0], math.ceil(min(PER_SHEET, len(walls) - s0) / cols) * (TILE[1] + 18)), "white")
        dr = ImageDraw.Draw(img)
        for k, w in enumerate(walls[s0:s0 + PER_SHEET]):
            c = cams[w["img"]]
            im = Image.open(M.THUMBS / f"{w['img']}.jpg").convert("RGB")
            u, v, ok = c.project(np.array(w["edge"]))
            pts = [(a * im.width, bb * im.height) for a, bb in zip(u, v)]
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            if max(xs) - min(xs) > im.width * 0.6:  # 全天球で枠が画像の端をまたぐときは、そのまま全体を見せる
                crop = (0, 0, im.width, im.height)
            else:
                pw, ph = (max(xs) - min(xs)) * 0.35 + 30, (max(ys) - min(ys)) * 0.35 + 30
                crop = (max(0, min(xs) - pw), max(0, min(ys) - ph), min(im.width, max(xs) + pw), min(im.height, max(ys) + ph))
            d2 = ImageDraw.Draw(im)
            d2.line(pts + [pts[0]], fill=(255, 0, 255), width=3)
            t = im.crop(tuple(int(q) for q in crop))
            t.thumbnail(TILE)
            x0, y0 = (k % cols) * TILE[0], (k // cols) * (TILE[1] + 18)
            img.paste(t, (x0, y0))
            dr.text((x0 + 3, y0 + TILE[1] + 2), f"[{w['k']}] {w['len']} m", fill="black")
        img.save(SHEETS / f"sheet_{s0 // PER_SHEET:02d}.jpg", quality=88)
    WALLS.write_text(json.dumps([{k: v for k, v in w.items() if k != "edge"} for w in walls]))
    print(f"facades: {len(walls)} walls of {n_b} buildings -> {SHEETS} ({math.ceil(len(walls) / PER_SHEET)} sheets)")


def label(spec):
    walls = {w["k"]: w for w in json.loads(WALLS.read_text())}
    data = json.loads(LABELS.read_text(encoding="utf-8")) if LABELS.exists() else {
        "_note": "壁ごとのベランダの有無 (tools/facades.py)。b = ベランダあり、w = 窓だけ (ベランダなし)。"
                 "x, z = 壁の中点、nx, nz = 外向き。Mapillary の路上写真 (CC BY-SA 4.0) を見て判定。build_props.py が読む",
        "walls": []}
    old = data["walls"]
    n = 0
    for tok in spec.split():
        k, kind = tok.split(":")
        if kind not in ("b", "w"):
            continue
        w = walls[int(k)]
        rec = {"x": w["x"], "z": w["z"], "nx": w["nx"], "nz": w["nz"], "len": w["len"], "kind": kind, "img": w["img"]}
        old = [r for r in old if math.hypot(r["x"] - rec["x"], r["z"] - rec["z"]) > 1.5 or r["nx"] * rec["nx"] + r["nz"] * rec["nz"] < 0.9]
        old.append(rec)
        n += 1
    data["walls"] = sorted(old, key=lambda r: (r["x"], r["z"]))
    rows = ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in data["walls"])
    LABELS.write_text('{\n "_note": ' + json.dumps(data["_note"], ensure_ascii=False) + ',\n "walls": [\n' + rows + "\n ]\n}\n", encoding="utf-8")
    print(f"facades: {n} labels -> {LABELS} (total {len(data['walls'])})")


def main():
    a = sys.argv[1:]
    if a[:1] == ["sheet"]:
        box = lambda x: tuple(float(v) for v in x.split(","))
        skip = box(a[a.index("--not") + 1]) if "--not" in a else None
        area = next((box(x) for i, x in enumerate(a[1:], 1) if x.count(",") == 3 and a[i - 1] != "--not"), None)
        limit = int(a[a.index("--max") + 1]) if "--max" in a else 60
        sheet(area, limit, skip)
    elif a[:1] == ["label"]:
        label(" ".join(a[1:]))
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
