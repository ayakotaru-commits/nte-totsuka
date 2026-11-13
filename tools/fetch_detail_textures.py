"""街並みディテール (お試し) 用の CC0 テクスチャを Poly Haven から取得する。

使い方: python tools/fetch_detail_textures.py
出力:   public/assets/detail/<id>_diff.jpg, <id>_nor.jpg
ライセンス: CC0 (Poly Haven)
元に戻す: public/assets/detail/ を削除
"""
import json
import pathlib
import urllib.request

IDS = {
    "asphalt_02": "道路",
    "concrete_pavement": "歩道・広場",
    "rectangular_facade_tiles": "ビル外壁",
    "white_rough_plaster": "住宅外壁",
    "concrete_wall_008": "陸屋根・地面",
    "grey_roof_tiles": "三角屋根",
}
RES = "1k"
UA = {"User-Agent": "personal-city-viewer/0.1"}
OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "assets" / "detail"


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for tid, label in IDS.items():
        files = json.loads(get(f"https://api.polyhaven.com/files/{tid}"))
        for key, suffix in (("Diffuse", "diff"), ("nor_gl", "nor")):
            path = OUT / f"{tid}_{suffix}.jpg"
            if path.exists():
                continue
            url = files[key][RES]["jpg"]["url"]
            path.write_bytes(get(url))
            print(f"{label}: {path.name} ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
