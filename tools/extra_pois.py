"""data/extra_pois.json の店を、街のデータ (pois と建物の shops) に足す。

OSM に無い店 (東急プラザ戸塚の衣料店など) を足すためのもの。同じ名前・同じ種類の店が既にあれば足さない (何度実行しても同じ結果)。
  python tools/extra_pois.py        public/data/city.json に直接足して、props.json (看板) を作り直す
  build_city.py は pois を集めた後に add_to_pois() を呼ぶ (classify の前。建物の shops へは classify が割り当てる)
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "extra_pois.json"
CITY = ROOT / "public" / "data" / "city.json"


def load():
    return json.loads(SRC.read_text(encoding="utf-8")) if SRC.exists() else {"pois": []}


def add_to_pois(pois):
    """pois (リスト) に足す。足した店の一覧を返す。"""
    have = {(p["name"], p["cat"]) for p in pois}
    new = []
    for e in load()["pois"]:
        if (e["name"], e["cat"]) in have:
            continue
        p = {"name": e["name"], "x": e["x"], "z": e["z"], "cat": e["cat"]}
        if e.get("floor", 1) >= 2:
            p["floor"] = e["floor"]   # 2 階以上の店。build_props.py は壁の看板を付けない (1 階の店の看板に重なるため)
        pois.append(p)
        new.append(p)
    return new


def main():
    city = json.loads(CITY.read_text(encoding="utf-8"))
    new = add_to_pois(city["pois"])
    bid = load().get("building")
    b = next((b for b in city["buildings"] if b["id"] == bid), None)
    if b is None:
        sys.exit(f"建物 {bid} が city.json に無い")
    have = {(s["name"], s["cat"]) for s in b.get("shops", [])}
    for p in new:
        if (p["name"], p["cat"]) not in have:
            b.setdefault("shops", []).append(dict(p))
    CITY.write_text(json.dumps(city, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"足した店: {len(new)} 軒 (建物 {bid} の店は {len(b.get('shops', []))} 軒)")
    subprocess.run([sys.executable, str(ROOT / "tools" / "build_props.py")], check=True)


if __name__ == "__main__":
    main()
