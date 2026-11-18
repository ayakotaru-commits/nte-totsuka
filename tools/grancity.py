"""グランシティの住棟 (本棟) の高さの段を、点群の高さ (data/raw/lidar_dsm.bin) から作る。

住棟は 7 階建てだが、道路側・川の北の端などで 6 階・5 階・4 階と段々に低くなる。PLATEAU の建物データは 1 棟 1 つの高さ
(19.6 m) しか無く、外観設定の建物は lidar_shape.py が形を直さない (外観の柄が崩れるため) ので、ここで段を作る。
一般の建物の段 (lidar_shape.py) と違い、段の境目は棟の長い向きに直角な直線にする (点群の 0.5 m のマスのギザギザを出さない):
  1. 棟の向き = いちばん長い辺の向き。棟を長い向きに 1 m ずつ輪切りにして、各切りの屋根の高さ (75% 点) を読む
  2. 高さの近い切り (LEVEL_TOL 以内) を同じ段にまとめ、短すぎる区間 (MIN_RUN 未満) は隣にまとめる
  3. 低い段から順に「その高さ以上の区間」で輪郭を切り取り、上の段 (part、minH = 下の段の高さ) として積む。
     段の高さはマンサード屋根の帯 (city.js の addMansard、壁の上に 1.5 m) の分だけ下げ、階の高さ (FLOOR_H) の倍数にそろえる
  4. 地面に近い低い区間 (LOW_H 未満。道路ぎわの塀のような低い部分) は、窓の無い別の建物にする
data/appearance.json の sites[].wings で対象を決める: {"ids": [建物 id ...]}。元の値は建物の gc0 に持つので、何度実行しても同じ結果。
    python tools/grancity.py          public/data/city.json に適用し、landmarks.py と build_props.py を実行する
    python tools/grancity.py --undo   元に戻す
build_city.py からは apply() が呼ばれる (通しでは未確認)。標準ライブラリのみ。
"""
import copy
import json
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import lidar_shape  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
CITY = ROOT / "public" / "data" / "city.json"
APPEARANCE = ROOT / "data" / "appearance.json"
TERRAIN = ROOT / "public" / "data" / "terrain.json"

SLICE = 1.0        # 輪切りの幅 (m)
LEVEL_TOL = 1.3    # 段の高さの差がこれ未満なら同じ段 (m。1 階は約 2.8 m)
MIN_RUN = 3.0      # これより短い区間は隣の段にまとめる (m)
LOW_H = 6.0        # これより低い区間は窓の無い別の建物 (塀のような低い部分)
MANSARD_H = 1.5    # 段の高さから引く分 (city.js のマンサードの帯が壁の上に 1.5 m 乗るため)
FLOOR_H = 2.65     # 階の高さ (7 階 + 帯 = 20.05 m。点群の屋上 19.7〜20 m に合う)
TAG = "_gc"        # 作った建物の id の印


def clip(ring, ux, uz, lo, hi):
    """輪郭を、向き (ux, uz) の座標 s が lo..hi の範囲で切り取る"""
    def half(r, sign, v):
        out = []
        f = lambda p: sign * (p[0] * ux + p[1] * uz - v)
        for i in range(len(r)):
            a, b = r[i - 1], r[i]
            fa, fb = f(a), f(b)
            if fb >= 0:
                if fa < 0:
                    t = fa / (fa - fb)
                    out.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
                out.append(list(b))
            elif fa >= 0:
                t = fa / (fa - fb)
                out.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
        return out
    r = half(ring, 1, lo)
    r = half(r, -1, hi) if r else r
    return [[round(x, 2), round(z, 2)] for x, z in r] if len(r) >= 3 else None


def profile(b, dsm, ref):
    """棟の向きと、輪切りごとの屋根の高さ [(s0, s1, h)]"""
    o = b["outer"]
    i = max(range(len(o)), key=lambda k: math.hypot(o[(k + 1) % len(o)][0] - o[k][0], o[(k + 1) % len(o)][1] - o[k][1]))
    a, c = o[i], o[(i + 1) % len(o)]
    L = math.hypot(c[0] - a[0], c[1] - a[1])
    ux, uz = (c[0] - a[0]) / L, (c[1] - a[1]) / L
    ss = [x * ux + z * uz for x, z in o]
    ts = [-x * uz + z * ux for x, z in o]
    s0, s1, t0, t1 = min(ss), max(ss), min(ts), max(ts)
    base = b.get("y") or 0
    out, s = [], s0
    while s < s1 - 1e-6:
        hs, t = [], t0 + 0.25
        while t < t1:
            for ds in (0.25, 0.75):
                x, z = (s + ds * SLICE) * ux - t * uz, (s + ds * SLICE) * uz + t * ux
                if lidar_shape.point_in((x, z), o):
                    v = dsm.get(x, z)
                    if v is not None:
                        hs.append(v - ref - base)
            t += 0.5
        hs.sort()
        out.append([s, min(s + SLICE, s1), hs[int(len(hs) * 0.75)] if len(hs) >= 4 else None])
        s += SLICE
    return (ux, uz), out


def runs_of(prof):
    """輪切りを段の区間 [(s0, s1, 高さ)] にまとめる"""
    runs = []
    for s0, s1, h in prof:
        if h is None:
            if runs:
                runs[-1][1] = s1
            continue
        if runs and abs(runs[-1][2] - h) < LEVEL_TOL:
            r = runs[-1]
            r[3].append(h)
            r[1] = s1
            r[2] = sorted(r[3])[len(r[3]) // 2]
        else:
            runs.append([s0, s1, h, [h]])
    changed = True
    while changed and len(runs) > 1:   # 短い区間は高さの近い隣にまとめる
        changed = False
        for k, r in enumerate(runs):
            if r[1] - r[0] >= MIN_RUN:
                continue
            nb = [j for j in (k - 1, k + 1) if 0 <= j < len(runs)]
            j = min(nb, key=lambda j: abs(runs[j][2] - r[2]))
            q = runs[j]
            q[0], q[1] = min(q[0], r[0]), max(q[1], r[1])
            del runs[k]
            changed = True
            break
    # 隣どうしで高さが近くなったものをまとめる
    out = []
    for r in runs:
        if out and abs(out[-1][2] - r[2]) < LEVEL_TOL:
            out[-1][1] = r[1]
            out[-1][3] += r[3]
            out[-1][2] = sorted(out[-1][3])[len(out[-1][3]) // 2]
        else:
            out.append(r)
    return [(r[0], r[1], round(r[2], 2)) for r in out]


def undo(buildings):
    keep = []
    for b in buildings:
        if TAG in b["id"] and b.get("src") == "appearance":
            continue
        g = b.pop("gc0", None)
        if g:
            for k, v in g.items():
                if v is None:
                    b.pop(k, None)
                else:
                    b[k] = v
        keep.append(b)
    return keep


def apply(buildings, conf=None, dsm=None, ref=None):
    """buildings を直したリストを返す"""
    buildings = undo(buildings)
    if conf is None:
        conf = json.loads(APPEARANCE.read_text(encoding="utf-8"))
    if ref is None:
        ref = json.loads(TERRAIN.read_text(encoding="utf-8"))["ref"] if TERRAIN.exists() else 0.0
    dsm = dsm or lidar_shape.DSM()
    byid = {b["id"]: b for b in buildings}
    for st in conf.get("sites", []):
        for bid in (st.get("wings") or {}).get("ids", []):
            b = byid.get(bid)
            if not b:
                print(f"grancity: building not found: {bid}")
                continue
            (ux, uz), prof = profile(b, dsm, ref)
            runs = runs_of(prof)
            hi = [r for r in runs if r[2] >= LOW_H]
            if not hi:
                continue
            levels = sorted({r[2] for r in hi})
            b["gc0"] = {k: b.get(k) for k in ("outer", "h", "balcony_tiers", "floors", "floor_h")}
            # 段の高さは階の高さの倍数にそろえる (窓の段と、ベランダの床が上下の段でずれないように)
            nfl = lambda L: max(1, round((L - MANSARD_H) / FLOOR_H))
            top = lambda L: round(nfl(L) * FLOOR_H, 2)
            if len(runs) == 1:   # 段なし: 高さだけ、ほかの棟とそろえる
                b["h"], b["floors"], b["floor_h"] = top(levels[0]), nfl(levels[0]), FLOOR_H
                print(f"grancity: {bid}: 段なし ({levels[0]} m → 壁 {b['h']} m + 屋根の帯)")
                continue
            o0 = b["outer"]
            body_lo, body_hi = min(r[0] for r in hi), max(r[1] for r in hi)
            ring = clip(o0, ux, uz, body_lo - 1e-3, body_hi + 1e-3)
            b["outer"], b["h"] = ring, top(levels[0])
            b["balcony_tiers"] = True
            b["floors"], b["floor_h"] = nfl(levels[0]), FLOOR_H   # floors = この段の階数 (city.js の窓)、floor_h = ベランダの床の間隔
            n = 0
            common = {k: v for k, v in b.items() if k not in ("id", "outer", "h", "minH", "holes", "gc0", "lidar", "name", "look", "look0")}
            for k in range(1, len(levels)):
                spans = []   # この段以上の高さが続く区間
                for s0, s1, h in hi:
                    if h >= levels[k] - 1e-6:
                        if spans and abs(spans[-1][1] - s0) < 1e-6:
                            spans[-1][1] = s1
                        else:
                            spans.append([s0, s1])
                for s0, s1 in spans:
                    r = clip(o0, ux, uz, s0, s1)
                    if not r:
                        continue
                    n += 1
                    buildings.append({**copy.deepcopy(common), "id": f"{bid}{TAG}{n}", "part": bid, "src": "appearance",
                                      "outer": r, "minH": top(levels[k - 1]), "h": top(levels[k]), "floors": nfl(levels[k]) - nfl(levels[k - 1])})
            for s0, s1, h in runs:   # 低い区間 (道路ぎわの塀のような部分)
                if h >= LOW_H:
                    continue
                r = clip(o0, ux, uz, s0, s1)
                if r:
                    n += 1
                    buildings.append({"id": f"{bid}{TAG}{n}", "src": "appearance", "outer": r, "h": h, "y": b.get("y") or 0,
                                      "style": "wall", "facade": "euro", "plain": True, "color": b.get("color"), "floors": 1})
            print(f"grancity: {bid}: 段 {[round(r[2], 1) for r in runs]} (長さ {[round(r[1] - r[0], 1) for r in runs]} m) → 建物データ +{n}")
    return buildings


def main():
    city = json.loads(CITY.read_text(encoding="utf-8"))
    if "--undo" in sys.argv:
        city["buildings"] = undo(city["buildings"])
    else:
        city["buildings"] = apply(city["buildings"])
    # 敷地の建物の一覧 (site.buildings) を合わせる
    ids = {b["id"] for b in city["buildings"]}
    for s in city.get("sites") or []:   # 並びは保つ (消えた id を除き、新しい id を後ろに足す)
        s["buildings"] = [i for i in s["buildings"] if i in ids]
        have = set(s["buildings"])
        s["buildings"] += [b["id"] for b in city["buildings"] if TAG in b["id"] and b["id"] not in have and b["id"].split(TAG)[0] in have]
    CITY.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"-> {CITY}")
    import landmarks
    landmarks.main()   # 外観を付け直し、build_props も実行する


if __name__ == "__main__":
    main()
