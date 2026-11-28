"""着せ替えの服の「丈・幅」を変えて、別の形の服を作る (すでに作った glb から。新しい VRM は要らない)。

  python tools/outfit_reshape.py <元の id> <新しい id> [--hem Y0 K] [--up Y0 K] [--flare F] [--widen S [--cx 0.09]]
    例: python tools/outfit_reshape.py basef_bottoms long_skirt --hem 0.98 3.0 --flare 0.25    (ロングスカート)
        python tools/outfit_reshape.py basem_bottoms wide_pants --hem 0.80 1.0 --widen 0.9     (ワイドパンツ)
    入出力: public/models/outfits/<id>.glb

  --hem Y0 K   高さ Y0 (m。元の VRM の基準の姿勢。足の裏が 0、腰が約 0.91) より下を、下へ K 倍に伸ばす (K < 1 で縮める = 短くする)。
               位置の y だけを動かす。骨の重みは元のまま (伸ばした分は、元からその位置に付いていた骨に付いて動く)。
  --up Y0 K    高さ Y0 より上を、上へ K 倍に伸ばす (ブーツの筒を長くする)。
  --flare F    --hem で伸ばした分だけ、すそを広げる (すそで 1 + F 倍。A ライン)。
  --widen S    Y0 (--hem の Y0) から下へ向かって、脚ごとに太くする (すそで 1 + S 倍。ワイドパンツ)。--cx = 脚の中心の x。
模様 (UV) は動かさないので、伸ばすと模様も縦に伸びる。
"""
import argparse, array, json, os, struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_glb(path):
    d = open(path, 'rb').read()
    n = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + n])
    o = 20 + n
    bn = struct.unpack('<I', d[o:o + 4])[0]
    return j, bytearray(d[o + 8:o + 8 + bn])


def write_glb(path, j, binary):
    js = json.dumps(j, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    js += b' ' * (-len(js) % 4)
    binary = bytes(binary) + b'\0' * (-len(binary) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(b'glTF' + struct.pack('<II', 2, total))
        f.write(struct.pack('<I', len(js)) + b'JSON' + js)
        f.write(struct.pack('<I', len(binary)) + b'BIN\0' + binary)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('id')
    ap.add_argument('--hem', nargs=2, type=float, metavar=('Y0', 'K'))
    ap.add_argument('--up', nargs=2, type=float, metavar=('Y0', 'K'))
    ap.add_argument('--flare', type=float, default=0)
    ap.add_argument('--widen', type=float, default=0)
    ap.add_argument('--cx', type=float, default=0.09)
    a = ap.parse_args()
    d = os.path.join(ROOT, 'public', 'models', 'outfits')
    j, b = read_glb(os.path.join(d, a.src + '.glb'))
    done = set()
    for m in j['meshes']:
        for p in m['primitives']:
            pa = p['attributes']['POSITION']
            if pa in done: continue
            done.add(pa)
            ac = j['accessors'][pa]; bv = j['bufferViews'][ac['bufferView']]
            assert not bv.get('byteStride')
            off = bv.get('byteOffset', 0) + ac.get('byteOffset', 0)
            # 使っている頂点だけ動かす (材質で絞ったあとも、頂点の並びは元のまま)
            ia = j['accessors'][p['indices']]; ib = j['bufferViews'][ia['bufferView']]
            io = ib.get('byteOffset', 0) + ia.get('byteOffset', 0)
            idx = array.array({5123: 'H', 5125: 'I', 5121: 'B'}[ia['componentType']]); idx.frombytes(bytes(b[io:io + ia['count'] * idx.itemsize]))
            pos = array.array('f'); pos.frombytes(bytes(b[off:off + ac['count'] * 12]))
            for i in set(idx):
                x, y, z = pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]
                if a.hem and y < a.hem[0]:
                    y0, k = a.hem
                    t = (y0 - y) / 0.5                     # 腰から下へ何 m か (0.5 m で 1)
                    ny = y0 - (y0 - y) * k
                    if a.flare:
                        s = 1 + a.flare * min(1.0, (y0 - ny) / 0.75)
                        x, z = x * s, z * s
                    if a.widen:
                        s = 1 + a.widen * min(1.0, (y0 - y) / (y0 - 0.06))
                        cx = a.cx if x > 0 else -a.cx
                        if abs(x) > 0.02: x = cx + (x - cx) * s
                        z *= s
                    y = ny
                if a.up and y > a.up[0]:
                    y = a.up[0] + (y - a.up[0]) * a.up[1]
                pos[3 * i], pos[3 * i + 1], pos[3 * i + 2] = x, y, z
            b[off:off + ac['count'] * 12] = pos.tobytes()
            ac['min'] = [min(pos[k::3]) for k in range(3)]; ac['max'] = [max(pos[k::3]) for k in range(3)]
    dst = os.path.join(d, a.id + '.glb')
    write_glb(dst, j, b)
    print(f'{os.path.relpath(dst, ROOT)}  {os.path.getsize(dst) / 1e3:.0f} KB')


main()
