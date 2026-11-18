"""グランシティの「時計の棟」(エントランス棟) と、車寄せの横の低い棟を作る。

位置・大きさは点群 (令和3年度) の高さから測った (2026-11。それまでは路上写真からの推定で、約 14 m ずれていた):
  道路 → 車寄せ (奥行き約 5.5 m。レンガ色のタイル・車止め・彫像) → 時計の棟 (正面の幅 15 m・奥行き 7 m・軒 5 m・
  マンサード屋根の上端 7 m・時計の部分 約 9 m) → 後ろの平屋 (奥行き 4 m・高さ 4.4 m。中庭側にアーチ窓と赤い扉) → 中庭。
  車寄せの左は北西の棟の低い部分、右は高さ約 3.6 m の低い棟 (walls)。
外観 (アーチ窓・白い付け柱・赤い扉・黒いガラスの庇・スレートのマンサード屋根・丸窓のドーマー・黄土色の枠の時計) は
不動産サイトの公開写真を見て書き起こした (写真そのものは保存・使用していない)。描画は public/src/detail/site_extras.js。

data/appearance.json の sites[].gate (clockhouse: true) で決める:
  origin   道路ぎわの基準点 [x, z]、axis  敷地の奥へ向かう向き (t = 横方向、s = 奥行き方向)
  setback  基準点から棟の正面までの距離 (m)、depth  奥行き、wide  正面の幅、h  軒の高さ、roof_h  マンサード屋根の上端、roof_in  屋根の上端の引っ込み
  passage / clear_h  棟の中央の通り抜け (扉の幅・高さ。中庭まで歩いて通れる)
  back     後ろの平屋 {depth, inset (左右の引っ込み), h}
  walls    車寄せの横の低い棟 [t0, t1, s0, s1, h] の並び
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
TAGS = ("_L", "_R", "_T", "_M", "_BL", "_BR", "_BT")   # 時計の棟の部品 (このほか _W1.. = 横の低い棟)


def make_parts(base_id, gt):
    """棟の部品と横の低い棟の建物データと、site.gate に入れる値を返す"""
    ux, uz = gt["axis"]
    n = math.hypot(ux, uz)   # 単位ベクトルにしてから使う (でないと座標が 1,400 m 付近で数十 cm ずれる)
    ux, uz = ux / n, uz / n
    ox, oz = gt["origin"]
    W, p, D = gt["wide"], gt["passage"], gt["depth"]
    s0 = gt["setback"]
    s1 = s0 + D
    h, rh, ri = gt.get("h", 5.0), gt.get("roof_h", 7.0), gt.get("roof_in", 1.2)
    bk = gt.get("back") or {}
    bd, bi, bh = bk.get("depth", 0), bk.get("inset", 0.5), bk.get("h", 4.4)

    def rect(a0, a1, b0, b1):   # s: a0..a1、t: b0..b1
        return [[round(ox + s * ux - t * uz, 2), round(oz + s * uz + t * ux, 2)] for s, t in ((a0, b0), (a1, b0), (a1, b1), (a0, b1))]
    # 壁は窓の柄なし (plain)。アーチ窓・扉・付け柱は site_extras.js が壁の前に張る
    common = {"style": "gate", "facade": "euro", "plain": True, "color": gt.get("color", "#e9ddc1"), "floors": 1, "mansard": None}
    parts = [
        {"id": base_id + "_L", "outer": rect(s0, s1, -W / 2, -p / 2), "h": h, **common},
        {"id": base_id + "_R", "outer": rect(s0, s1, p / 2, W / 2), "h": h, **common},
        {"id": base_id + "_T", "outer": rect(s0, s1, -p / 2, p / 2), "h": h, "minH": gt["clear_h"], **common},
        # マンサード屋根の上の平らな面 (斜面は site_extras.js。当たり判定の高さを屋根に合わせる)
        {"id": base_id + "_M", "outer": rect(s0 + ri, s1 - ri, -W / 2 + ri, W / 2 - ri), "h": rh, "minH": h, **common, "color": "#59606b"},
    ]
    if bd > 0:
        a0, a1 = s1, s1 + bd
        parts += [
            {"id": base_id + "_BL", "outer": rect(a0, a1, -W / 2 + bi, -p / 2), "h": bh, **common},
            {"id": base_id + "_BR", "outer": rect(a0, a1, p / 2, W / 2 - bi), "h": bh, **common},
            {"id": base_id + "_BT", "outer": rect(a0, a1, -p / 2, p / 2), "h": bh, "minH": gt["clear_h"], **common},
        ]
    for k, (b0, b1, a0, a1, wh) in enumerate(gt.get("walls") or []):
        parts.append({"id": base_id + "_W" + str(k + 1), "outer": rect(a0, a1, b0, b1), "style": "wall", "facade": "euro", "color": "#dccaa2", "floors": 1, "mansard": None, "h": wh})
    cs = s0 + D / 2
    info = {"center": [round(ox + cs * ux, 2), round(oz + cs * uz, 2)], "length": D, "h": h}
    # 横の低い棟の中央の点 (landmarks の grancity_wall の at に書く)
    info["wall_at"] = [[round(ox + (a0 + a1) / 2 * ux - (b0 + b1) / 2 * uz, 2), round(oz + (a0 + a1) / 2 * uz + (b0 + b1) / 2 * ux, 2)]
                       for b0, b1, a0, a1, _ in gt.get("walls") or []]
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
        # この道具で作った部品だけ (tools/grancity.py が作った低い部分 "_gc" も style が wall なので除く)
        old = [b["id"] for b in city["buildings"] if b["id"] in site["buildings"] and b.get("style") in ("gate", "wall", "hall") and "_gc" not in b["id"]]
        base = next((i.rsplit("_", 1)[0] for i in old if i.endswith(("_L", "_R", "_T"))), None)
        if not base:
            print("clockhouse: base building not found")
            continue
        parts, info = make_parts(base, gt)
        H = terrain_height()
        # 基礎の高さ (build_city.py は最後に各建物へ入れる。単体で動かすときはここで入れる)。
        # 棟の部品は高さをそろえるため、全体でいちばん低い所に合わせる
        body = [b for b in parts if b["id"].endswith(TAGS)]
        yb = round(min(H(x, z) for b in body for x, z in b["outer"]), 2)
        for b in parts:
            b["y"] = yb if b in body else round(min(H(x, z) for x, z in b["outer"]), 2)
            if b not in body:   # landmarks.py が外して付け直す値は最後に置く (何度実行しても並びが同じになるように)
                b["color"] = b.pop("color")
        # 前の部品があった位置に入れ替える (何度実行しても並びが変わらないように)
        def swap(seq, key):
            k = next((n for n, v in enumerate(seq) if key(v) in old), len(seq))
            rest = [v for v in seq if key(v) not in old]
            k = sum(1 for v in seq[:k] if key(v) not in old)
            return rest[:k], rest[k:]
        a, b2 = swap(city["buildings"], lambda v: v["id"])
        city["buildings"] = a + parts + b2
        a, b2 = swap(site["buildings"], lambda v: v)
        site["buildings"] = a + [q["id"] for q in parts] + b2
        site.pop("hall", None)
        for k in ("wall_from", "wall_h", "links"):   # 以前の作りの値
            site["gate"].pop(k, None)
        site["gate"].update({k: gt[k] for k in ("origin", "axis", "setback", "depth", "wide", "h", "roof_h", "roof_in", "passage", "clear_h", "back", "walls", "arch", "clockhouse", "color") if k in gt})
        site["gate"].update(info)
        print(f"clockhouse: {st['area_name']}: 正面 {gt['wide']} m, 道路から {gt['setback']} m 奥, 横の低い棟の中心 {info['wall_at']}")
    CITY.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    import landmarks
    import build_props
    landmarks.main()   # 塀に外観 (look) を付け、build_props も実行する
    del build_props


if __name__ == "__main__":
    main()
