"""フェアリー・リールパーク (舞浜の架空のテーマパーク。計画は PARK_PLAN.md) の設定を検証し、ブラウザ用の public/data/park.json を作る。

設定: data/park.json (名前・敷地・エリア・広場・湖・ゲート・道)。パークの名前は設定の 1 か所だけ。
使う側: public/src/detail/park.js
  - 敷地の中の実在の道路・木・橋脚・建物・歩道を、区間 (public/data/rail_ext/c_*.json) を読んだ後に省く (区間のファイルは書き換えない)。
    省かない所 = 舞浜駅の駅舎・駅前 (rail_ext の stations[].site の clear / clear2 / under の範囲)。
  - 試作: ゲートの看板と、サンライズ・プラザの円。

    python tools/park.py            設定を検証して public/data/park.json を書く (何度実行しても同じ結果)
    python tools/park.py --undo     public/data/park.json を消す (ゲームは元の舞浜に戻る)
    python tools/park.py --report   敷地の中の実在のデータの数・地形・駅舎との重なりを表示する (ファイルは書かない)
標準ライブラリのみ (--report の地形の統計だけ numpy)。
"""
import json
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import park_areas  # noqa: E402
import park_crowd  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "park.json"
OUT = ROOT / "public" / "data" / "park.json"
EXT = ROOT / "public" / "data" / "rail_ext"


def inpoly(x, z, p):
    ins = False
    for i in range(len(p)):
        a, b = p[i - 1], p[i]
        if (a[1] > z) != (b[1] > z) and x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]:
            ins = not ins
    return ins


def seg_dist(px, pz, a, b):
    ex, ez = b[0] - a[0], b[1] - a[1]
    l2 = ex * ex + ez * ez or 1e-9
    t = max(0.0, min(1.0, ((px - a[0]) * ex + (pz - a[1]) * ez) / l2))
    return math.hypot(px - a[0] - ex * t, pz - a[1] - ez * t)


def poly_area(p):
    return abs(sum(p[i - 1][0] * p[i][1] - p[i][0] * p[i - 1][1] for i in range(len(p)))) / 2


def station_protect(station):
    """舞浜駅の駅舎・駅前の範囲 (clear / clear2 / under。駅の向きの [s0, s1, t0, t1]) を、ゲームの座標の四角 (4 点) にして返す"""
    idx = json.loads((EXT / "index.json").read_text(encoding="utf-8"))
    st = next((s for s in idx["stations"] if s["name"] == station), None)
    if not st or "site" not in st or "frame" not in st["site"]:
        sys.exit(f"park: 駅 {station} の駅舎 (site.frame) が public/data/rail_ext/index.json に無い")
    f = st["site"]["frame"]
    out = []
    for key, r in sorted(f["rects"].items()):
        s0, s1, t0, t1 = r
        quad = [[round(f["cx"] + f["sx"] * s + f["nx"] * t, 2), round(f["cz"] + f["sz"] * s + f["nz"] * t, 2)] for s, t in ((s0, t0), (s1, t0), (s1, t1), (s0, t1))]
        out.append({"name": key, "poly": quad})
    return out


def check(cfg, protect):
    """設定の見落としを表示する (警告だけ。止めない)。エラー = 必須の項目が無いときだけ"""
    for k in ("name", "site", "areas", "ellipses", "points", "gate", "paths"):
        if k not in cfg:
            sys.exit(f"park: 設定に {k} が無い")
    site = cfg["site"]
    warn = []
    for n, a in cfg["areas"].items():
        if n.startswith("_"):
            continue
        out = [q for q in a if not inpoly(q[0], q[1], site)]
        if out:
            warn.append(f"エリア {n}: 敷地の外の頂点 {out}")
    for n, e in cfg["ellipses"].items():
        c, rx, rz = e["center"], e["rx"], e["rz"]
        out = [(round(c[0] + rx * math.cos(t / 24 * 2 * math.pi)), round(c[1] + rz * math.sin(t / 24 * 2 * math.pi))) for t in range(24)]
        out = [q for q in out if not inpoly(q[0], q[1], site)]
        if out:
            warn.append(f"{n}: 敷地の外の点 {out}")
    for n, q in cfg["points"].items():
        if not inpoly(q[0], q[1], site):
            warn.append(f"{n} {q}: 敷地の外")
    # 駅舎・駅前の範囲との重なり (敷地の頂点が入っていないか。重なる所は省かない)
    for pr in protect:
        inside = [q for q in site if inpoly(q[0], q[1], pr["poly"])]
        if inside:
            warn.append(f"敷地の頂点 {inside} が駅の範囲 {pr['name']} の中 (その範囲は省かず、駅の設定どおりに残す)")
    for w in warn:
        print("警告:", w)
    return warn


def build(cfg):
    protect = station_protect(cfg["station"])
    check(cfg, protect)
    out = {k: v for k, v in cfg.items() if not k.startswith("_")}
    out["areas"] = {k: v for k, v in cfg["areas"].items() if not k.startswith("_")}
    out["protect"] = protect
    out["gen"] = park_areas.generate(cfg)   # 段階 2: 各エリアの建物・内側の道・広場・木・看板・門 (tools/park_areas.py。決まった乱数)
    pc = park_crowd.generate(out)           # 段階 5: 園内を歩く人の通り道 (crowd) と、地図の印・ワープ先 (spots)。tools/park_crowd.py (乱数なし)
    out["crowd"] = pc["crowd"]
    out["spots"] = pc["spots"]
    return out


def report(cfg):
    protect = station_protect(cfg["station"])
    site = cfg["site"]
    print(f"敷地 {poly_area(site) / 10000:.1f} ha、頂点 {len(site)}")
    prot = lambda x, z: any(inpoly(x, z, pr["poly"]) for pr in protect)
    hid = lambda x, z: inpoly(x, z, site) and not prot(x, z)
    idx = json.loads((EXT / "index.json").read_text(encoding="utf-8"))
    tot = {}
    for a in range(29, 34):
        for b in range(-28, -23):
            p = EXT / f"c_{a}_{b}.json"
            if not p.exists():
                continue
            d = json.loads(p.read_text(encoding="utf-8"))
            n = {}
            for key, get in (("trees", lambda t: (t[0], t[2])), ("piers", lambda t: (t[0], t[2])), ("poles", lambda t: (t[0], t[2])),
                             ("buildings", lambda t: tuple(sum(q[i] for q in t[0]) / len(t[0]) for i in (0, 1)))):
                n[key] = sum(1 for t in d.get(key, []) if hid(*get(t)))
            for key in ("roads", "walks"):
                n[key] = sum(1 for r in d.get(key, []) if any(hid(r[i], r[i + 1]) for i in range(1, len(r) - 1, 2)))
            if any(n.values()):
                print(f"c_{a}_{b}:", n)
                for k, v in n.items():
                    tot[k] = tot.get(k, 0) + v
    print("省くもの (合計):", tot)
    # 橋脚・架線柱が線路 (京葉線の高架) の近くにないか: 省く対象の橋脚から線路までの最短距離
    routes = [r["p"] for r in idx["routes"] if r["line"] == "keiyo"]
    dmin = 1e9
    for a in range(29, 34):
        for b in range(-28, -23):
            p = EXT / f"c_{a}_{b}.json"
            if not p.exists():
                continue
            for t in json.loads(p.read_text(encoding="utf-8")).get("piers", []):
                if hid(t[0], t[2]):
                    for rt in routes:
                        for i in range(0, len(rt) - 1):
                            dmin = min(dmin, seg_dist(t[0], t[2], (rt[i][0], rt[i][2]), (rt[i + 1][0], rt[i + 1][2])))
    print("省く橋脚から京葉線までの最短距離:", "(橋脚なし)" if dmin > 1e8 else f"{dmin:.1f} m")
    # 敷地と、京葉線・駅の範囲との最短距離
    dl = min(seg_dist(q[0], q[2], site[i - 1], site[i]) for rt in routes for q in rt[::5] if 30000 < q[0] < 33000 for i in range(len(site)))
    print(f"敷地の辺から京葉線までの最短距離 {dl:.1f} m")
    for pr in protect:
        inside = [q for q in site if inpoly(q[0], q[1], pr["poly"])]
        # 重なる面積 (10 m 格子で数える)
        n = sum(1 for x in range(30900, 32100, 10) for z in range(-26100, -25200, 10) if inpoly(x, z, site) and inpoly(x, z, pr["poly"]))
        print(f"駅の範囲 {pr['name']}: 敷地と重なる面積 約 {n * 100} m²、敷地の頂点 {len(inside)} 個が中")
    # 地形 (粗い 25 m 格子 + 細かい 5 m 格子)
    try:
        import numpy as np
    except ImportError:
        print("numpy が無いので地形の統計は省く")
        return
    C, T = idx["coarse"], idx["terrain"]
    coarse, fine = {}, {}
    for a in range(29, 34):
        for b in range(-28, -23):
            p = EXT / f"c_{a}_{b}.json"
            if not p.exists():
                continue
            d = json.loads(p.read_text(encoding="utf-8"))
            K = d.get("coarse")
            if K:
                for jj in range(K["nj"]):
                    for ii in range(K["ni"]):
                        coarse[(K["i0"] + ii, K["j0"] + jj)] = K["h"][jj * K["ni"] + ii] / 100
            F = d.get("fine")
            if F:
                for row in F["rows"]:
                    for k, v in enumerate(row[2:]):
                        fine[(row[1] + k, row[0])] = v / 100
    inner = [(x, z) for x in range(30950, 32040, 25) for z in range(-26000, -25300, 25) if hid(x, z)]
    hs = np.array([coarse[(round((x - C["x0"]) / C["step"]), round((z - C["z0"]) / C["step"]))] for x, z in inner if (round((x - C["x0"]) / C["step"]), round((z - C["z0"]) / C["step"])) in coarse])
    print(f"地形 (粗い 25 m 格子。敷地の中 {len(hs)} 点): 最小 {hs.min():.2f} / 25% {np.percentile(hs, 25):.2f} / 中央値 {np.median(hs):.2f} / 75% {np.percentile(hs, 75):.2f} / 最大 {hs.max():.2f} m")
    print(f"  海面 (標高タイルに値の無い所 = -14.0 m) の点: {int((hs < -13.5).sum())}、中央値から 3 m 以上高い点 (実在の施設の出っ張り): {int((hs > np.median(hs) + 3).sum())}")
    core = hs[(hs > np.median(hs) - 2.5) & (hs < np.median(hs) + 2.5)]
    print(f"  外れ値を除くと: 中央値 {np.median(core):.2f} m、標準偏差 {core.std():.2f} m (点 {len(core)} / {len(hs)})")
    nf = sum(1 for x, z in inner if (round((x - T["x0"]) / T["step"]), round((z - T["z0"]) / T["step"])) in fine)
    print(f"  細かい 5 m 格子がある点: {nf} / {len(inner)} (残りは 25 m 格子だけ)")
    for name, e in cfg["ellipses"].items():
        c = e["center"]
        pts = [(c[0] + e["rx"] * r * math.cos(t / 16 * 2 * math.pi), c[1] + e["rz"] * r * math.sin(t / 16 * 2 * math.pi)) for r in (0.0, 0.5, 1.0) for t in range(16)]
        vv = [coarse[k] for k in (((round((x - C["x0"]) / C["step"]), round((z - C["z0"]) / C["step"]))) for x, z in pts) if k in coarse]
        print(f"  {name}: 実在の地形の高さ {min(vv):.2f}〜{max(vv):.2f} m (中央値 {np.median(vv):.2f})")


def main():
    cfg = json.loads(SRC.read_text(encoding="utf-8"))
    if "--undo" in sys.argv:
        if OUT.exists():
            OUT.unlink()
            print(f"park: {OUT.relative_to(ROOT)} を消した")
        else:
            print("park: public/data/park.json は無い")
        return
    if "--report" in sys.argv:
        report(cfg)
        return
    out = build(cfg)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"park: {OUT.relative_to(ROOT)} を書いた ({OUT.stat().st_size} バイト。名前 {out['name']}、エリア {len(out['areas'])}、駅の範囲 {len(out['protect'])})")
    print(park_areas.stats(out["gen"]))
    print(park_crowd.stats(out))


if __name__ == "__main__":
    main()
