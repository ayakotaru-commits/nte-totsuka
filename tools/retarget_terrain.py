"""地形を差し替えたとき、city.json の「地形に合わせた高さ」を新しい地形に合わせ直す。
build_city.py を通しで実行できない環境 (点群の格子が無い、など) 用。build_city.py が作った結果に差分だけを足す。

使い方: python tools/retarget_terrain.py <古い terrain.json> <新しい terrain.json>
 - 建物の基礎の高さ y: 輪郭で一番低い地面の差ぶんだけ、建物ごと平行に動かす (形はそのまま)
 - 道路・線路の ys のうち、地面にあった頂点 (|ys - 古い地形| < 0.3 m): 地面の差ぶんだけ動かす。橋の上の頂点はそのまま
 終わったら tools/build_props.py を実行する (小物の高さ)。
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CITY = ROOT / "public" / "data" / "city.json"


def sampler(path):
    T = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    nx, nz, st, x0, z0, h = T["nx"], T["nz"], T["step"], T["minX"], T["minZ"], T["h"]

    def H(x, z):
        fx = max(0.0, min(nx - 1.0001, (x - x0) / st)); fz = max(0.0, min(nz - 1.0001, (z - z0) / st))
        i, j = int(fx), int(fz); u, v = fx - i, fz - j
        g = lambda a, b: h[b * nx + a] / 100
        h00, h10, h01, h11 = g(i, j), g(i + 1, j), g(i, j + 1), g(i + 1, j + 1)
        return h00 + u * (h10 - h00) + v * (h11 - h10) if u >= v else h00 + v * (h01 - h00) + u * (h11 - h01)
    return H


def main():
    old, new = sampler(sys.argv[1]), sampler(sys.argv[2])
    city = json.loads(CITY.read_text(encoding="utf-8"))
    moved, mx = 0, 0.0
    for b in city["buildings"]:
        d = min(new(x, z) for x, z in b["outer"]) - min(old(x, z) for x, z in b["outer"])
        b["y"] = round(b.get("y", 0) + d, 2)
        moved += abs(d) > 0.05
        mx = max(mx, abs(d))
    print(f"建物 {len(city['buildings'])} 棟、0.05 m 超動いたもの {moved} 棟、最大 {mx:.2f} m")
    n = 0
    for kind in ("roads", "rails"):
        for r in city[kind]:
            if not r.get("ys"):
                continue
            for i, ((x, z), y) in enumerate(zip(r["pts"], r["ys"])):
                if abs(y - old(x, z)) < 0.3:
                    r["ys"][i] = round(y + new(x, z) - old(x, z), 2)
                    n += 1
    print(f"地面にあった ys の頂点 {n} 個を動かした")
    CITY.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
