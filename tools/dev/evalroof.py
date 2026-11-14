"""屋根の形の確かさを測る (確認用): モデルの屋根の高さ と 点群の高さ の誤差を、家の輪郭内 0.5 m マスで比べる。

使い方: python tools/dev/evalroof.py [city.json] [ラベル]      (既定は public/data/city.json)
前提:   data/raw/lidar_dsm.bin (python tools/fetch_lidar.py)
出力例: 建物 4235 / 平らな屋根 2395 勾配屋根 3138 / RMSE 1.36 m / 誤差の中央値 0.14 m / 建物ごとのRMSE 中央値 0.48 上位10% 2.34
        - 誤差の中央値: 小さいほど実物に近い (乱数の屋根のとき 1.02 m、点群で直した後 0.14 m)
        - 上位10% が大きいのは、点群に写っていない建物 (測量後の新築など) が元のままだから
        - 各建物で誤差の大きい 10% のマスは除いている (輪郭の端は地面を拾うため)
lidar_shape.py の当てはめを変えたら、変える前後でこの数字を比べる。"""
import json
import math
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import lidar_shape as L  # noqa: E402


def pin(x, z, b):
    if not L.point_in((x, z), b['outer']): return False
    return not any(L.point_in((x, z), h) for h in b.get('holes', []))

def seg_d(x, z, a, b):
    ex, ez = b[0]-a[0], b[1]-a[1]; l2 = ex*ex+ez*ez
    t = max(0, min(1, ((x-a[0])*ex+(z-a[1])*ez)/l2)) if l2 else 0
    return math.hypot(x-a[0]-ex*t, z-a[1]-ez*t)

def roof_h(r, x, z, outer):
    """屋根 r の、壁の上端からの高さ。範囲外は None"""
    if r['t'] == 'skel':
        return min(r['rise'], r['k'] * min(seg_d(x, z, outer[i-1], outer[i]) for i in range(len(outer))))
    ux, uz = r['u']; dx, dz = x-r['c'][0], z-r['c'][1]
    s, t = dx*ux+dz*uz, -dx*uz+dz*ux
    L2, W = r['len']/2, r['wid']/2
    if abs(s) > L2+0.3 or abs(t) > W+0.3: return None
    if r['t'] == 'shed': return r['rise']*(t*r.get('up', 1)+W)/(2*W)
    off = r.get('off', 0)
    g = r['rise']*(1-(t-off)/(W-off)) if t > off else r['rise']*(1-(off-t)/(W+off))
    if r['t'] == 'hip':
        hip = min(W, L2*0.6)
        g = min(g, r['rise']*(L2-abs(s))/hip) if hip > 0 else g
    return max(0.0, g)

def model(b, x, z):
    y1 = b['h'] - (b['roof']['rise'] if 'roof' in b else 0)
    best = y1
    for r in ([b['roof']] if 'roof' in b else []) + b.get('roofs', []):
        v = roof_h(r, x, z, b['outer'])
        if v is not None: best = max(best, y1+v)
    return best

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else str(L.CITY)
    city = json.load(open(src, encoding="utf-8")); dsm = L.DSM()
    ref = json.loads(L.TERRAIN.read_text(encoding="utf-8"))["ref"]
    parts = {}
    for b in city['buildings']:
        if b.get('part'): parts.setdefault(b['part'], []).append(b)
    se = n = 0; ae = []; flat_recs = pitched_recs = 0; per = []
    for b in city['buildings']:
        if b.get('part') or b.get('style') not in ('house', 'small', 'lowrise') or b.get('minH'): continue
        recs = [b] + parts.get(b['id'], [])
        for r in recs:
            if r.get('roof') or r.get('roofs'): pitched_recs += 1
            else: flat_recs += 1
        o = b.get('lidar', {}).get('outer0', b['outer'])
        xs = [p[0] for p in o]; zs = [p[1] for p in o]
        errs = []
        x = math.floor(min(xs)*2)/2+0.25
        while x < max(xs):
            z = math.floor(min(zs)*2)/2+0.25
            while z < max(zs):
                if L.point_in((x, z), o):
                    d = dsm.get(x, z)
                    if d is not None:
                        m = max((model(r, x, z) for r in recs if pin(x, z, r)), default=0.0)
                        errs.append(m - (d - ref - b.get('y', 0)))
                z += 0.5
            x += 0.5
        if len(errs) > 20:
            # 輪郭の端の地面などの影響を減らすため、誤差の大きい 10% を除いた RMSE
            a = sorted(abs(e) for e in errs)[:int(len(errs)*0.9)]
            per.append(math.sqrt(sum(v*v for v in a)/len(a)))
            se += sum(v*v for v in a); n += len(a); ae += a
    ae.sort(); per.sort()
    print(f"{sys.argv[2] if len(sys.argv) > 2 else ''}: 建物 {len(per)} / 平らな屋根 {flat_recs} 勾配屋根 {pitched_recs} / "
          f"RMSE {math.sqrt(se/n):.2f} m / 誤差の中央値 {ae[len(ae)//2]:.2f} m / 建物ごとのRMSE 中央値 {per[len(per)//2]:.2f} 上位10% {per[int(len(per)*0.9)]:.2f}")

if __name__ == "__main__":
    main()
