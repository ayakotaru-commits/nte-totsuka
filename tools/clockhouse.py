"""グランシティの「時計のある門」を、今の public/data/city.json に適用する (build_city.py を通しで実行できない環境用)。

data/appearance.json の sites[].gate に clockhouse / wide / passage / clear_h がある敷地を対象に、
  - 門の建物 (_L / _R / _T) を正面 wide m に作り直す (通り抜ける幅は passage、高さは clear_h)
  - 奥に置いていた別のエントランス棟 (style hall) を消す
何度実行しても同じ結果。標準ライブラリのみ。
    python tools/clockhouse.py
その後 python tools/build_props.py で props.json を作り直す。
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
CITY = ROOT / "public" / "data" / "city.json"
APPEARANCE = ROOT / "data" / "appearance.json"


def main():
    conf = json.loads(APPEARANCE.read_text(encoding="utf-8"))
    city = json.loads(CITY.read_text(encoding="utf-8"))
    for st in conf["sites"]:
        gt = st.get("gate") or {}
        if not gt.get("clockhouse"):
            continue
        site = next((s for s in city["sites"] if s["name"] == st["area_name"]), None)
        if not site or not site.get("gate"):
            print("clockhouse: site/gate not found")
            continue
        sg = site["gate"]
        ux, uz = sg["axis"]
        bm = {b["id"]: b for b in city["buildings"]}
        ids = [i for i in site["buildings"] if bm.get(i, {}).get("style") == "gate"]
        parts = {i.rsplit("_", 1)[1]: bm[i] for i in ids}
        if set(parts) != {"L", "R", "T"}:
            print("clockhouse: gate parts not found", ids)
            continue
        pts = [p for b in parts.values() for p in b["outer"]]
        ss = [x * ux + z * uz for x, z in pts]
        ts = [-x * uz + z * ux for x, z in pts]
        s0, s1 = min(ss), max(ss)
        tc = (min(ts) + max(ts)) / 2   # 幅を広げても中心は動かさない
        t0, t1, w = tc - gt["wide"] / 2, tc + gt["wide"] / 2, gt["passage"] / 2

        def rect(a0, a1, b0, b1):
            return [[round(sv * ux - tv * uz, 2), round(sv * uz + tv * ux, 2)] for sv, tv in ((a0, b0), (a1, b0), (a1, b1), (a0, b1))]
        parts["L"]["outer"] = rect(s0, s1, t0, tc - w)
        parts["R"]["outer"] = rect(s0, s1, tc + w, t1)
        parts["T"]["outer"] = rect(s0, s1, tc - w, tc + w)
        parts["T"]["minH"] = gt["clear_h"]
        for b in parts.values():
            b["color"] = gt.get("color", b["color"])
        sg.update({"passage": gt["passage"], "clear_h": gt["clear_h"], "wide": round(t1 - t0, 2), "clockhouse": True, "color": gt.get("color", sg["color"])})
        sg["center"] = [round((s0 + s1) / 2 * ux - tc * uz, 2), round((s0 + s1) / 2 * uz + tc * ux, 2)]
        halls = [i for i in site["buildings"] if bm.get(i, {}).get("style") == "hall"]
        city["buildings"] = [b for b in city["buildings"] if b["id"] not in halls]
        site["buildings"] = [i for i in site["buildings"] if i not in halls]
        site.pop("hall", None)
        print(f"clockhouse: {st['area_name']}: wide {sg['wide']} m, passage {sg['passage']} m, removed {halls}")
    CITY.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
