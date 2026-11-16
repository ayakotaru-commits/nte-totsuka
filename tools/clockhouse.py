"""グランシティの「時計の棟」(エントランス棟) と、車寄せを囲む塀を作る。

路上写真 (持ち主提供、2025-05) の配置: 道路 → 車寄せの広場 (レンガ色のタイル・車止め・彫像) → 時計の棟 → 中庭。
車寄せの左右は、クリーム色の高い塀で囲まれていて、中庭は外から直接は見えない。入口は棟の中央のガラス扉 (奥はロビー)。
data/appearance.json の sites[].gate (clockhouse: true) で決める:
  origin   道路ぎわの基準点 [x, z]、axis  敷地の奥へ向かう向き
  setback  基準点から棟の正面までの距離 (m)、depth  棟の奥行き、wide  棟の正面の幅
  passage / clear_h  棟の中央の通り抜け (ガラス扉の幅・高さ)、wall_from  塀の道路側の端 (基準点からの距離。負 = 道路側)、wall_h  塀の高さ
  links    棟の横から隣の棟までつなぐ壁 [t0, t1, s0, s1] (t = 横方向、s = 奥行き方向。基準点からの m)
座標は基準点・軸から毎回作り直すので、何度実行しても同じ結果になる (一度作った座標からは作らない)。

build_city.py から make_parts() が呼ばれる。単体でも動く (build_city.py を通しで実行できない環境用):
    python tools/clockhouse.py       public/data/city.json に適用し、そのあと tools/landmarks.py と tools/build_props.py を実行する
標準ライブラリのみ。
"""
import json
import math
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
CITY = ROOT / "public" / "data" / "city.json"
APPEARANCE = ROOT / "data" / "appearance.json"


def make_parts(base_id, gt):
    """棟 (_L/_R/_T) と塀 (_WL/_WR) の建物データと、site.gate に入れる値を返す"""
    ux, uz = gt["axis"]
    n = math.hypot(ux, uz)   # 単位ベクトルにしてから使う (でないと座標が 1,400 m 付近で数十 cm ずれる)
    ux, uz = ux / n, uz / n
    ox, oz = gt["origin"]
    W, p, D = gt["wide"], gt["passage"], gt["depth"]
    s0 = gt["setback"]
    s1 = s0 + D
    h = gt.get("h", 6.9)

    def rect(a0, a1, b0, b1):   # s: a0..a1、t: b0..b1
        return [[round(ox + s * ux - t * uz, 2), round(oz + s * uz + t * ux, 2)] for s, t in ((a0, b0), (a1, b0), (a1, b1), (a0, b1))]
    common = {"style": "gate", "facade": "euro", "color": gt.get("color", "#e3d2b0"), "floors": 2, "mansard": None, "h": h}
    parts = [
        {"id": base_id + "_L", "outer": rect(s0, s1, -W / 2, -p / 2), **common},
        {"id": base_id + "_R", "outer": rect(s0, s1, p / 2, W / 2), **common},
        {"id": base_id + "_T", "outer": rect(s0, s1, -p / 2, p / 2), "minH": gt["clear_h"], **common},
    ]
    wh, w0, th = gt.get("wall_h", 4.6), gt.get("wall_from", -7.0), 0.6
    for tag, (b0, b1) in (("WL", (-W / 2 - th, -W / 2)), ("WR", (W / 2, W / 2 + th))):
        parts.append({"id": base_id + "_" + tag, "outer": rect(w0, s0, b0, b1), "style": "wall", "facade": "euro", "color": "#dccaa2", "floors": 1, "mansard": None, "h": wh})
    # 棟の横から隣の棟までつなぐ壁 (links: [t0, t1, s0, s1] の並び。外から中庭が見えないように、すき間をふさぐ)
    for k, (b0, b1, a0, a1) in enumerate(gt.get("links") or []):
        parts.append({"id": base_id + "_K" + str(k + 1), "outer": rect(a0, a1, b0, b1), "style": "wall", "facade": "euro", "color": "#dccaa2", "floors": 1, "mansard": None, "h": wh})
    cs = s0 + D / 2
    info = {"center": [round(ox + cs * ux, 2), round(oz + cs * uz, 2)], "length": D, "h": h}
    # 塀の中央の点 (landmarks の at に書く)
    mids = [((w0 + s0) / 2, -(W / 2 + th / 2)), ((w0 + s0) / 2, W / 2 + th / 2)] + [((a0 + a1) / 2, (b0 + b1) / 2) for b0, b1, a0, a1 in gt.get("links") or []]
    info["wall_at"] = [[round(ox + sm * ux - tm * uz, 2), round(oz + sm * uz + tm * ux, 2)] for sm, tm in mids]
    return parts, info


def terrain_height():
    """public/data/terrain.json の高さ (m)"""
    T = json.loads((ROOT / "public" / "data" / "terrain.json").read_text(encoding="utf-8"))

    def H(x, z):
        fx = max(0, min(T["nx"] - 1.0001, (x - T["minX"]) / T["step"]))
        fz = max(0, min(T["nz"] - 1.0001, (z - T["minZ"]) / T["step"]))
        i, j = int(fx), int(fz)
        u, v = fx - i, fz - j

        def g(a, b):
            return T["h"][b * T["nx"] + a] / 100
        h00, h10, h01, h11 = g(i, j), g(i + 1, j), g(i, j + 1), g(i + 1, j + 1)
        return h00 + u * (h10 - h00) + v * (h11 - h10) if u >= v else h00 + v * (h01 - h00) + u * (h11 - h01)
    return H


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
        old = [b["id"] for b in city["buildings"] if b["id"] in site["buildings"] and b.get("style") in ("gate", "wall", "hall")]
        base = next((i.rsplit("_", 1)[0] for i in old if i[-2:] in ("_L", "_R", "_T")), None)
        if not base:
            print("clockhouse: base building not found")
            continue
        parts, info = make_parts(base, gt)
        H = terrain_height()
        for b in parts:   # 基礎の高さ (build_city.py は最後に各建物へ入れる。単体で動かすときはここで入れる)
            b["y"] = round(min(H(x, z) for x, z in b["outer"]), 2)
        city["buildings"] = [b for b in city["buildings"] if b["id"] not in old] + parts
        site["buildings"] = [i for i in site["buildings"] if i not in old] + [q["id"] for q in parts]
        site.pop("hall", None)
        site["gate"].update({k: gt[k] for k in ("origin", "axis", "setback", "depth", "wide", "passage", "clear_h", "clockhouse", "color") if k in gt})
        site["gate"].update(info)
        print(f"clockhouse: {st['area_name']}: 正面 {gt['wide']} m, 道路から {gt['setback']} m 奥, 塀の中心 {info['wall_at']}")
    CITY.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    import landmarks
    import build_props
    landmarks.main()   # 塀に外観 (look) を付け、build_props も実行する
    del build_props


if __name__ == "__main__":
    main()
