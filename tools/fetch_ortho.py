"""神奈川県の航空写真 (オルソ画像, 25 cm) を取得し、屋根の色を読むための色の格子を作る。

使い方: python tools/fetch_ortho.py        (Pillow が必要: pip install pillow)
出力:   data/raw/ortho/<図郭>.zip (キャッシュ, 1つ約11MB・全部で約90MB)
        data/raw/ortho_rgb.bin   色の格子 (1マス 3 バイト RGB, 行 = z, 列 = x。写真の無い所は 0,0,0)
        data/raw/ortho_rgb.json  格子の原点・間隔・大きさ (fetch_lidar.py の高さ格子と同じ並び)
出典:   神奈川県 令和3年度 横浜南部、湘南、横須賀三浦 3次元点群データ (オルソ画像, CC BY 4.0, G空間情報センター)

写真はゲームには貼らない。build_city.py / lidar_shape.py が建物ごとの屋根の色 (数値) を読むのに使う。
"""
import json
import zipfile

from config import BOUNDS
from fetch_lidar import MARGIN, RAW, RES, download, mesh_list, plane_to_local

try:
    from PIL import Image
except ImportError:
    raise SystemExit("Pillow が必要です: pip install pillow")

Image.MAX_IMAGE_PIXELS = None
INDEX_URL = "https://gic-kanagawa.s3.ap-northeast-1.amazonaws.com/div/2021/Vectortile2025/ortjpeg/{z}/{x}/{y}.pbf"
CACHE = RAW / "ortho"
OUT_BIN = RAW / "ortho_rgb.bin"
OUT_META = RAW / "ortho_rgb.json"


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    (a, b, c, d, e, f), err = plane_to_local()   # 平面直角 (E, N) → ローカル (x, z)
    det = a * e - b * d
    # 逆変換: ローカル (x, z) → 平面直角 (E, N)
    ia, ib, id_, ie = e / det, -b / det, -d / det, a / det
    ic, if_ = -(ia * c + ib * f), -(id_ * c + ie * f)
    nx = int((BOUNDS["maxX"] - BOUNDS["minX"] + 2 * MARGIN) / RES)
    nz = int((BOUNDS["maxZ"] - BOUNDS["minZ"] + 2 * MARGIN) / RES)
    gx0, gz0 = BOUNDS["minX"] - MARGIN, BOUNDS["minZ"] - MARGIN
    canvas = Image.new("RGB", (nx, nz))
    meshes = mesh_list(INDEX_URL)
    print(f"図郭 {len(meshes)} 個: {' '.join(m for m, _ in meshes)}")
    for name, url in meshes:
        z = CACHE / f"{name}.zip"
        print(f"  {name}")
        download(url, z)
        with zipfile.ZipFile(z) as zf:
            jpg = next(i for i in zf.namelist() if i.lower().endswith((".jpg", ".jpeg")))
            jgw = next(i for i in zf.namelist() if i.lower().endswith((".jgw", ".jpgw", ".wld")))
            A, D, B, E, C, F = (float(v) for v in zf.read(jgw).split()[:6])   # ワールドファイル: E = A*列 + B*行 + C, N = D*列 + E*行 + F
            if abs(B) > 1e-9 or abs(D) > 1e-9:
                raise SystemExit("回転のあるワールドファイルには未対応です")
            with zf.open(jpg) as fh:
                im = Image.open(fh)
                im.load()
        im = im.convert("RGB")
        # 格子のマス (i, j) の中心 → ローカル → 平面直角 → 写真の画素。Pillow の AFFINE は「出力の座標 → 入力の座標」
        # 出力 X = i + 0.5 のとき x = gx0 + X * RES。入力の画素座標 = (E - C) / A + 0.5 (C は左上の画素の中心)
        kx = (ia * RES / A, ib * RES / A, (ia * gx0 + ib * gz0 + ic - C) / A + 0.5)
        ky = (id_ * RES / E, ie * RES / E, (id_ * gx0 + ie * gz0 + if_ - F) / E + 0.5)
        part = im.transform((nx, nz), Image.AFFINE, kx + ky, resample=Image.BILINEAR)
        mask = Image.new("L", im.size, 255).transform((nx, nz), Image.AFFINE, kx + ky, resample=Image.NEAREST)
        canvas.paste(part, (0, 0), mask)
    OUT_BIN.write_bytes(canvas.tobytes())
    OUT_META.write_text(json.dumps({
        "source": "神奈川県 令和3年度 横浜南部、湘南、横須賀三浦 3次元点群データ (オルソ画像, CC BY 4.0)",
        "res": RES, "minX": gx0, "minZ": gz0, "nx": nx, "nz": nz, "unit": "RGB (0,0,0 = データ無し)",
    }, ensure_ascii=False), encoding="utf-8")
    print(f"格子 {nx}x{nz} ({RES} m) -> {OUT_BIN}")


if __name__ == "__main__":
    main()
