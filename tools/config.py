"""共通設定。原点は戸塚駅付近。座標系: 1単位=1m, X=東, Y=上, Z=南 (Three.js / glTF 準拠)"""
import math

# 戸塚駅付近 (概算)
ORIGIN_LAT = 35.4010
ORIGIN_LON = 139.5340

# マップ範囲 (原点からのメートル)。南側は戸塚町455 (約1.4km南) まで含める
BOUNDS = {"minX": -650, "maxX": 650, "minZ": -650, "maxZ": 1650}

_M_LAT = 110574.0
_M_LON = 111320.0 * math.cos(math.radians(ORIGIN_LAT))
MARGIN = 100  # データ取得はマップ範囲より少し広く

# (south, west, north, east)
BBOX = (
    ORIGIN_LAT - (BOUNDS["maxZ"] + MARGIN) / _M_LAT,
    ORIGIN_LON + (BOUNDS["minX"] - MARGIN) / _M_LON,
    ORIGIN_LAT - (BOUNDS["minZ"] - MARGIN) / _M_LAT,
    ORIGIN_LON + (BOUNDS["maxX"] + MARGIN) / _M_LON,
)

# スタート地点: グランシティ パレ・ド・リヴァージュ西側の道路上、門の正面 (face_toward = 向く先)
START = {"lat": 35.3880984, "lon": 139.530627, "face_toward": (35.388048, 139.5306982)}

# 目的地 (国土地理院 住所検索で取得した座標)
WAYPOINTS = [
    {"name": "戸塚町455", "lat": 35.38818, "lon": 139.531464},
]
