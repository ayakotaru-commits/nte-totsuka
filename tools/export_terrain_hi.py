"""lidar_terrain.py の結果 (data/raw/terrain_hi.npz) を、ゲームが読める public/data/terrain_hi.json にする。
形式は terrain.json と同じ (step = 2 m, h = 標高 cm, z 行優先)。terrain.json に置き換えるときは、先に tools/retarget_terrain.py で city.json の高さを合わせる。"""
import json
import pathlib

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
z = np.load(ROOT / "data" / "raw" / "terrain_hi.npz")
dtm, res, minX, minZ = z["dtm"].astype(np.float64), float(z["res"]), float(z["minX"]), float(z["minZ"])
t = json.loads((ROOT / "public" / "data" / "terrain.json").read_text(encoding="utf-8"))
nzc, nxc = dtm.shape
# マスの中心 → 頂点 (マスの角) : 隣り合う 4 マスの平均
p = np.pad(dtm, 1, mode="edge")
v = (p[:-1, :-1] + p[:-1, 1:] + p[1:, :-1] + p[1:, 1:]) / 4
out = {"source": "神奈川県 点群 (最低点) + 国土地理院 DEM", "step": res, "minX": minX, "minZ": minZ,
       "nx": v.shape[1], "nz": v.shape[0], "ref": t["ref"], "h": np.round(v * 100).astype(int).ravel().tolist()}
(ROOT / "public" / "data" / "terrain_hi.json").write_text(json.dumps(out), encoding="utf-8")
print(out["nx"], out["nz"], "->", ROOT / "public" / "data" / "terrain_hi.json")
