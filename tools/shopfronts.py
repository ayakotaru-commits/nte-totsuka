"""路上写真 (Mapillary) を見て、個人店の店先 (日よけの色・のれん・提灯・看板の色) を判定するための道具 (半自動)。

チェーン店は build_props.py の CHAINS で自動。ここは、それ以外の店 (居酒屋・飲食店・美容室など) 用。
  1. sheet: 店ごとに、その店を向いた近い写真を選び、店の位置まわりを切り出した番号付きの一覧画像にする
  2. 一覧を見て (人か Claude が) 店ごとに特徴を付け、label で data/shopfronts.json に書く
  3. build_props.py が data/shopfronts.json を読み、看板の色・日よけの色・のれん・提灯に反映する

使い方:
  python tools/shopfronts.py sheet [--max 120]      一覧画像を data/raw/mapillary/shopsheets/ に作る (店の一覧は shops.json)
  python tools/shopfronts.py label "3:a=r,n=k,l 7:a=g 9:x"
      番号:特徴 (カンマ区切り)。a=日よけの色 / n=のれんの色 / l=赤ちょうちんあり / s=看板の地色/文字色 / x=写っていない・判断できない
      色の記号: r 赤  o 橙  y 黄  g 緑  b 青  k 黒・濃紺  w 白  n 茶  p ピンク  e 灰 (大文字小文字は区別しない)
      n は「のれんあり (色)」、l は提灯あり。書いた店は、同じ店 (位置が 3 m 以内) を上書きする
写真は data/raw/mapillary/ (mapillary_walls.py fetch で取る) にあるものだけを使う。numpy と Pillow が必要。
"""
import json
import math
import pathlib
import re
import sys
import urllib.request

import numpy as np

import mapillary_walls as M

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "shopfronts.json"
SHEETS = M.RAW / "shopsheets"
SHOPS = SHEETS / "shops.json"
SHOP = re.compile(r"shop:|amenity:(restaurant|cafe|fast_food|bar|pub|pharmacy|bank|bakery)")
CHAIN = re.compile(r"|".join(
    p for p in ("セブン", "ローソン", "ファミリーマート", "マクドナルド", "スターバックス", "吉野家", "松屋", "すき家", "ガスト",
                "サイゼリヤ", "ドトール", "ミスタードーナツ", "ダイソー", "三菱UFJ銀行", "三井住友銀行", "りそな銀行")))
COLORS = {"r": "#c8261c", "o": "#e8872a", "y": "#e8c13a", "g": "#2f7a4a", "b": "#2a5aa8", "k": "#23262b", "w": "#f2efe6",
          "n": "#6b4a32", "p": "#e58fa7", "e": "#8d9196"}
TILE = (400, 300)
PER_SHEET = 12


def candidates(city):
    for p in city["pois"]:
        if not SHOP.match(p["cat"]) or CHAIN.search(p.get("name") or ""):
            continue
        yield p


def best_photo(p, cg):
    best = None
    for i in range(math.floor((p["x"] - 32) / 50), math.floor((p["x"] + 32) / 50) + 1):
        for j in range(math.floor((p["z"] - 32) / 50), math.floor((p["z"] + 32) / 50) + 1):
            for cm in cg.get((i, j), []):
                d = math.hypot(cm.x - p["x"], cm.z - p["z"])
                if d > 32 or d < 4 or cm.type != "perspective":
                    continue
                f = cm.R.T @ np.array([0, 0, 1.0])
                be, bn = p["x"] - cm.x, -(p["z"] - cm.z)
                cs = (f[0] * be + f[1] * bn) / (math.hypot(f[0], f[1]) * math.hypot(be, bn) + 1e-9)
                if cs > 0.9 and (best is None or d < best[0]):
                    best = (d, cm)
    return best


def sheet(limit):
    from PIL import Image, ImageDraw
    city = json.loads(M.CITY.read_text(encoding="utf-8"))
    H = M.load_terrain()
    cams = M.load_cams(H)
    cg = {}
    for cm in cams:
        cg.setdefault((math.floor(cm.x / 50), math.floor(cm.z / 50)), []).append(cm)
    done = json.loads(OUT.read_text(encoding="utf-8"))["shops"] if OUT.exists() else []
    shops = []
    for p in candidates(city):
        if any(math.hypot(r["x"] - p["x"], r["z"] - p["z"]) < 3 for r in done):
            continue
        b = best_photo(p, cg)
        if not b:
            continue
        d, cm = b
        f = M.THUMBS / f"{cm.id}.jpg"
        if not f.exists():
            try:
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes(urllib.request.urlopen(cm.url, timeout=60).read())
            except Exception:  # noqa: BLE001
                continue
        im = Image.open(f).convert("RGB")
        w, h = im.size
        y0 = H(p["x"], p["z"])
        P = np.array([[p["x"], y0 + y, p["z"]] for y in (0.3, 2.0, 4.0)], float)
        u, v, ok = cm.project(P)
        if not ok.any():
            continue
        cx, cy, r = u[ok].mean() * w, v[ok].mean() * h, int(min(w, h) * 0.3)
        crop = im.crop((int(max(0, cx - r * 1.4)), int(max(0, cy - r)), int(min(w, cx + r * 1.4)), int(min(h, cy + r * 0.8))))
        crop.thumbnail(TILE)
        shops.append({"k": len(shops), "name": p.get("name") or "", "cat": p["cat"], "x": p["x"], "z": p["z"], "d": round(d), "img": cm.id, "_crop": crop})
        if len(shops) >= limit:
            break
    SHEETS.mkdir(parents=True, exist_ok=True)
    for f in SHEETS.glob("sheet_*.jpg"):
        f.unlink()
    for s0 in range(0, len(shops), PER_SHEET):
        cols = 4
        rows = math.ceil(min(PER_SHEET, len(shops) - s0) / cols)
        img = Image.new("RGB", (cols * TILE[0], rows * (TILE[1] + 18)), "white")
        dr = ImageDraw.Draw(img)
        for k, s in enumerate(shops[s0:s0 + PER_SHEET]):
            x0, y0 = (k % cols) * TILE[0], (k // cols) * (TILE[1] + 18)
            img.paste(s["_crop"], (x0, y0))
            dr.text((x0 + 3, y0 + TILE[1] + 2), f"[{s['k']}] {s['name']} ({s['cat'].split(':')[-1]}) {s['d']}m", fill="black")
        img.save(SHEETS / f"sheet_{s0 // PER_SHEET:02d}.jpg", quality=88)
    SHOPS.write_text(json.dumps([{k: v for k, v in s.items() if k != "_crop"} for s in shops], ensure_ascii=False))
    print(f"shopfronts: {len(shops)} shops -> {SHEETS} ({math.ceil(len(shops) / PER_SHEET)} sheets)")


def label(spec):
    shops = {s["k"]: s for s in json.loads(SHOPS.read_text(encoding="utf-8"))}
    data = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {
        "_note": "個人店の店先の判定 (tools/shopfronts.py)。a=日よけの色, n=のれんの色, l=提灯, s=[看板の地色, 文字色]。"
                 "x, z = 店の位置。Mapillary の路上写真 (CC BY-SA 4.0) を見て判定。build_props.py が読む",
        "shops": []}
    old = data["shops"]
    n = 0
    for tok in spec.split():
        k, _, feats = tok.partition(":")
        s = shops[int(k)]
        rec = {"name": s["name"], "x": s["x"], "z": s["z"], "img": s["img"]}
        for f in filter(None, feats.split(",")):
            key, _, val = f.partition("=")
            key, val = key.strip().lower(), val.strip().lower()
            if key == "a" and val[:1] in COLORS:
                rec["awning"] = COLORS[val[0]]
            elif key == "n":
                rec["noren"] = COLORS[val[:1]] if val[:1] in COLORS else COLORS["k"]
            elif key == "l":
                rec["lantern"] = True
            elif key == "s" and "/" in val:
                bg, fg = val.split("/")
                rec["sign"] = [COLORS[bg[0]], COLORS[fg[0]]]
            elif key == "x":
                rec["unseen"] = True
        old = [r for r in old if math.hypot(r["x"] - rec["x"], r["z"] - rec["z"]) > 3]
        old.append(rec)
        n += 1
    data["shops"] = sorted(old, key=lambda r: (r["x"], r["z"]))
    rows = ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in data["shops"])
    OUT.write_text('{\n "_note": ' + json.dumps(data["_note"], ensure_ascii=False) + ',\n "shops": [\n' + rows + "\n ]\n}\n", encoding="utf-8")
    print(f"shopfronts: {n} labels -> {OUT} (total {len(data['shops'])})")


def main():
    a = sys.argv[1:]
    if a[:1] == ["sheet"]:
        sheet(int(a[a.index("--max") + 1]) if "--max" in a else 120)
    elif a[:1] == ["label"]:
        label(" ".join(a[1:]))
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
