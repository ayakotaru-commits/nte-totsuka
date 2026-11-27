"""キャラメイク用の髪のファイルを作る: VRM (0.x) から髪のパーツだけを取り出して、小さな glb にする。

  python tools/hairs.py <元の.vrm> <id> [--parts 正規表現] [--max-tex 1024]
    例: python tools/hairs.py data/raw/hairs/HairSample_Female.vrm hairsample_female
    出力: public/models/hairs/<id>.glb

残すもの: 髪の材質 (既定は名前に HAIR を含むもの。頭の後ろを覆う HairBack も含む) の頂点 (位置・法線・UV・骨の重み)、
  骨のつながり (人型の骨の対応つき)、材質と模様 (WebP に縮める)、髪の揺れ (VRM の secondaryAnimation のうち髪の骨のもの)。
捨てるもの: 顔・体・服・表情・サムネイル・シェイプキー。VRM 0.x だけに対応 (1.0 の服は tools/outfits.py)。
読む側は public/src/outfit.js の fitOutfit (服と同じ方式で今のキャラの頭の骨に付ける)。
髪の出どころ・条件は public/models/README.md に残す (この道具は書かない)。
"""
import argparse, io, json, os, re, struct, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMP = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}
KEEP_ATTR = ('POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0')


def read_glb(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'glTF', 'glb ではない'
    n = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + n])
    o = 20 + n
    bn = struct.unpack('<I', d[o:o + 4])[0]
    return j, d[o + 8:o + 8 + bn]


def write_glb(path, j, binary):
    js = json.dumps(j, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    js += b' ' * (-len(js) % 4)
    binary += b'\0' * (-len(binary) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(b'glTF' + struct.pack('<II', 2, total))
        f.write(struct.pack('<I', len(js)) + b'JSON' + js)
        f.write(struct.pack('<I', len(binary)) + b'BIN\0' + binary)


def read_acc(j, b, idx):
    """アクセサーの中身を、タプルのリストで読む。"""
    a = j['accessors'][idx]; bv = j['bufferViews'][a['bufferView']]
    n = NCOMP[a['type']]; size = COMP[a['componentType']] * n
    stride = bv.get('byteStride') or size
    fmt = {5126: 'f', 5123: 'H', 5125: 'I', 5121: 'B'}[a['componentType']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return [struct.unpack_from('<' + fmt * n, b, off + i * stride) for i in range(a['count'])]


def node_y(j, idx):
    """基準の姿勢での、ノードの高さ (親の移動量の和。VRoid の骨は基準の姿勢で回転が無い)。"""
    par = {c: i for i, n in enumerate(j['nodes']) for c in n.get('children', [])}
    y = 0.0
    while idx is not None:
        y += j['nodes'][idx].get('translation', [0, 0, 0])[1]; idx = par.get(idx)
    return y


def prim_bounds(j, b, mesh_name, key):
    """名前が mesh_name のノードのメッシュのうち、材質名に key を含む面が使う頂点の範囲 (min3, max3)。
    (位置のアクセサーは全部の面で共有されているので、面の頂点番号で絞る)"""
    lo, hi = [9e9] * 3, [-9e9] * 3
    for n in [n for n in j['nodes'] if n.get('name') == mesh_name and 'mesh' in n]:
        for p in j['meshes'][n['mesh']]['primitives']:
            if key not in j['materials'][p['material']]['name']: continue
            pos = read_acc(j, b, p['attributes']['POSITION'])
            for k in {x[0] for x in read_acc(j, b, p['indices'])}:
                lo = [min(x, y) for x, y in zip(lo, pos[k])]; hi = [max(x, y) for x, y in zip(hi, pos[k])]
    return lo, hi


def face_metrics(j, b):
    """目の上端・頭頂・あご・顔の幅・顔の前と後ろ (z)。高さは頭の骨の関節から測る。元の座標 (VRM 0.x は前が -z)。"""
    head = next(b['node'] for b in j['extensions']['VRM']['humanoid']['humanBones'] if b['bone'] == 'head')
    hy = node_y(j, head)
    fl, fh = prim_bounds(j, b, 'Face', 'Face_00_SKIN')
    el, eh = prim_bounds(j, b, 'Face', 'EyeWhite')
    r = lambda x: round(x, 5)
    return {'eyeTop': r(eh[1] - hy), 'eyeBottom': r(el[1] - hy), 'top': r(fh[1] - hy), 'chin': r(fl[1] - hy),
            'width': r(fh[0] - fl[0]), 'front': r(fl[2]), 'back': r(fh[2])}


def image_mean(j, b, tex_index):
    """模様の平均の色 (透明でない画素だけ)。"""
    im = j['images'][j['textures'][tex_index]['source']]
    bv = j['bufferViews'][im['bufferView']]
    pic = Image.open(io.BytesIO(b[bv.get('byteOffset', 0):][:bv['byteLength']])).convert('RGBA'); pic.thumbnail((128, 128))
    px = [p for p in pic.getdata() if p[3] > 200]
    if not px: return [0.5, 0.5, 0.5]
    return [round(sum(p[i] for p in px) / len(px) / 255, 4) for i in range(3)]


class Pack:
    """新しいバッファ。アクセサーごとに、元の並びをつめて写す。"""
    def __init__(self, j, binary):
        self.j, self.b = j, binary
        self.out = bytearray(); self.views = []; self.accs = []; self.amap = {}

    def accessor(self, idx):
        if idx in self.amap: return self.amap[idx]
        a = self.j['accessors'][idx]
        bv = self.j['bufferViews'][a['bufferView']]
        size = COMP[a['componentType']] * NCOMP[a['type']]
        stride = bv.get('byteStride') or size
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        if stride == size:
            data = self.b[start:start + size * a['count']]
        else:
            data = b''.join(self.b[start + i * stride:start + i * stride + size] for i in range(a['count']))
        self.out += b'\0' * (-len(self.out) % 4)
        self.views.append({'buffer': 0, 'byteOffset': len(self.out), 'byteLength': len(data)})
        self.out += data
        na = {k: v for k, v in a.items() if k not in ('bufferView', 'byteOffset', 'sparse')}
        na['bufferView'] = len(self.views) - 1
        self.accs.append(na); self.amap[idx] = len(self.accs) - 1
        return self.amap[idx]

    def blob(self, data):
        self.out += b'\0' * (-len(self.out) % 4)
        self.views.append({'buffer': 0, 'byteOffset': len(self.out), 'byteLength': len(data)})
        self.out += data
        return len(self.views) - 1


def player_main(src, dark):
    """今のキャラの顔の数字と、頭皮 (髪の色で塗られた地肌) の三角形の一覧を public/models/hairs/player_fit.json に書く。
    頭皮 = 顔と体のメッシュの肌の面 (材質名に _SKIN) のうち、模様の色が暗い (髪色で塗られた) 三角形。
    頭の殻は体のメッシュにある (Body_00_SKIN の 4 番目の面) ので、顔だけでなく体も見る。髪の下に敷く殻の元になる (public/src/hair.js)。"""
    j, b = read_glb(src)
    v = j['extensions']['VRM']
    hy = node_y(j, next(x['node'] for x in v['humanoid']['humanBones'] if x['bone'] == 'head'))
    scalp = []
    for nd in [n for n in j['nodes'] if n.get('name') in ('Face', 'Body') and 'mesh' in n]:
        for prim in j['meshes'][nd['mesh']]['primitives']:
            mname = j['materials'][prim['material']]['name']
            if '_SKIN' not in mname: continue
            mp = next(p for p in v['materialProperties'] if p['name'] == mname)
            ti = mp['textureProperties']['_MainTex']
            im = j['images'][j['textures'][ti]['source']]; bv = j['bufferViews'][im['bufferView']]
            pic = Image.open(io.BytesIO(b[bv.get('byteOffset', 0):][:bv['byteLength']])).convert('RGBA')
            W, H = pic.size; px = pic.load()
            uv = read_acc(j, b, prim['attributes']['TEXCOORD_0']); idx = [x[0] for x in read_acc(j, b, prim['indices'])]
            pos = read_acc(j, b, prim['attributes']['POSITION'])
            keep = []
            for t in range(0, len(idx), 3):
                tri = idx[t:t + 3]
                u = sum(uv[k][0] for k in tri) / 3; w = sum(uv[k][1] for k in tri) / 3
                r, g, bl, al = px[min(W - 1, max(0, int(u * W))), min(H - 1, max(0, int(w * H)))]
                cy = sum(pos[k][1] for k in tri) / 3
                # 透明な画素は除く。頭の骨の関節より下 (首より下) は頭皮ではない
                if al > 200 and cy > hy - 0.07 and (0.299 * r + 0.587 * g + 0.114 * bl) / 255 < dark: keep += tri
            if keep: scalp.append({'material': mname, 'indexCount': len(idx), 'vertexCount': len(uv), 'index': keep})
    out = {'_note': 'tools/hairs.py --player が作る。顔の数字は頭の骨の関節からの相対 (元の座標。前が -z)。scalp は肌の面ごとの、頭皮の頂点番号 (3 つで 1 三角形)。面は 材質名 + 元の頂点番号の数 (indexCount) で見つける。',
           'metrics': face_metrics(j, b), 'scalp': scalp}
    dst = os.path.join(ROOT, 'public', 'models', 'hairs', 'player_fit.json')
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'{os.path.relpath(dst, ROOT)}  {os.path.getsize(dst) / 1e3:.0f} KB  頭皮の三角形', ' / '.join(f"{s['material'][-14:]} {len(s['index']) // 3}" for s in scalp))
    print('  顔の数字:', out['metrics'])


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--player':  # python tools/hairs.py --player <今のキャラの.vrm> [暗さのしきい値 0.55]
        return player_main(sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 0.55)
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('id')
    ap.add_argument('--parts', default='HAIR', help='取り出す材質名の正規表現')
    ap.add_argument('--max-tex', type=int, default=1024, help='模様の最大の大きさ (px)')
    ap.add_argument('--quality', type=int, default=88)
    a = ap.parse_args()
    j, b = read_glb(a.src)
    ext = j.get('extensions', {})
    if 'VRM' not in ext: sys.exit('VRM 0.x (extensions.VRM) だけに対応')
    v = ext['VRM']
    want = re.compile(a.parts)
    mats = j['materials']
    sel = {i for i, m in enumerate(mats) if want.search(m['name'])}
    if not sel: sys.exit('材質が 1 つも選ばれない: ' + ', '.join(m['name'] for m in mats))
    pk = Pack(j, b)

    # --- 材質と模様 ---
    new_mats, mmap = [], {}
    tex_map, img_map, new_tex, new_img = {}, {}, [], []
    smp_map, new_smp = {}, []

    def image(i):
        if i in img_map: return img_map[i]
        im = j['images'][i]
        bv = j['bufferViews'][im['bufferView']]
        raw = b[bv.get('byteOffset', 0):][:bv['byteLength']]
        pic = Image.open(io.BytesIO(raw)); pic.load()
        if max(pic.size) > a.max_tex:
            s = a.max_tex / max(pic.size); pic = pic.resize((max(1, round(pic.width * s)), max(1, round(pic.height * s))), Image.LANCZOS)
        if pic.mode not in ('RGB', 'RGBA'): pic = pic.convert('RGBA')
        buf = io.BytesIO(); pic.save(buf, 'WEBP', quality=a.quality, method=6)
        new_img.append({'bufferView': pk.blob(buf.getvalue()), 'mimeType': 'image/webp', 'name': im.get('name', '')})
        img_map[i] = len(new_img) - 1
        return img_map[i]

    def texture(i):
        if i in tex_map: return tex_map[i]
        t = dict(j['textures'][i]); t['source'] = image(t['source'])
        if 'sampler' in t:
            s = t['sampler']
            if s not in smp_map: new_smp.append(j['samplers'][s]); smp_map[s] = len(new_smp) - 1
            t['sampler'] = smp_map[s]
        t.pop('extensions', None)
        new_tex.append(t); tex_map[i] = len(new_tex) - 1
        return tex_map[i]

    def remap(o):
        if isinstance(o, dict):
            r = {}
            for k, x in o.items():
                if isinstance(x, dict) and 'index' in x and k.lower().endswith('texture'):
                    r[k] = {**x, 'index': texture(x['index'])}
                else:
                    r[k] = remap(x)
            return r
        if isinstance(o, list): return [remap(x) for x in o]
        return o

    for i in sorted(sel):
        mmap[i] = len(new_mats); new_mats.append(remap(mats[i]))

    # VRM 0.x の MToon の設定 (材質の名前で対応する。模様は番号で持つので付け替える)
    mprops = []
    names = {mats[i]['name'] for i in sel}
    for p in v.get('materialProperties', []):
        if p.get('name') not in names: continue
        q = dict(p)
        q['textureProperties'] = {k: texture(t) for k, t in p.get('textureProperties', {}).items() if isinstance(t, int) and t >= 0}
        mprops.append(q)

    # --- 形 (選んだ材質の面だけ。シェイプキーは捨てる) ---
    new_meshes, mesh_map = [], {}
    for mi, m in enumerate(j['meshes']):
        prims = []
        for p in m['primitives']:
            if p.get('material') not in sel: continue
            q = {'attributes': {k: pk.accessor(x) for k, x in p['attributes'].items() if k in KEEP_ATTR},
                 'material': mmap[p['material']], 'mode': p.get('mode', 4)}
            if 'indices' in p: q['indices'] = pk.accessor(p['indices'])
            prims.append(q)
        if prims:
            mesh_map[mi] = len(new_meshes); new_meshes.append({'name': m.get('name', ''), 'primitives': prims})
    nodes, skins, skin_map = [], [], {}
    for n in j['nodes']:
        n2 = {k: x for k, x in n.items() if k not in ('mesh', 'skin', 'extensions', 'extras')}
        if n.get('mesh') in mesh_map:
            n2['mesh'] = mesh_map[n['mesh']]
            sk = n['skin']
            if sk not in skin_map:
                s = dict(j['skins'][sk]); s['inverseBindMatrices'] = pk.accessor(s['inverseBindMatrices'])
                skin_map[sk] = len(skins); skins.append(s)
            n2['skin'] = skin_map[sk]
        nodes.append(n2)

    # --- 髪の揺れ: 髪の骨 (名前に Hair を含む) の下にある揺れもの。ノードの番号は元のまま (ノードは全部残す) ---
    sec = v.get('secondaryAnimation', {})
    def under_hair(idx):
        # 子から親へたどる必要は無く、元の VRM が揺れものを骨ごとに持つので、根の骨の名前で見る
        return 'hair' in (j['nodes'][idx].get('name', '').lower())
    groups = [g for g in sec.get('boneGroups', []) if g.get('bones') and all(under_hair(x) for x in g['bones'])]
    spring = {'boneGroups': groups, 'colliderGroups': sec.get('colliderGroups', [])}

    meta = {k: x for k, x in v.get('meta', {}).items() if k != 'texture'}
    out = {
        'asset': {'version': '2.0', 'generator': 'tools/hairs.py'},
        'extensionsUsed': ['VRM'],
        'extensions': {'VRM': {'exporterVersion': v.get('exporterVersion', ''), 'specVersion': '0.0', 'meta': meta,
                               'humanoid': v['humanoid'], 'firstPerson': {}, 'blendShapeMaster': {'blendShapeGroups': []},
                               'secondaryAnimation': spring, 'materialProperties': mprops}},
        'scene': j.get('scene', 0), 'scenes': j['scenes'], 'nodes': nodes, 'meshes': new_meshes, 'skins': skins,
        'materials': new_mats, 'accessors': pk.accs, 'bufferViews': pk.views,
        'buffers': [{'byteLength': len(pk.out)}],
    }
    if new_tex: out['textures'] = new_tex
    if new_img: out['images'] = new_img
    if new_smp: out['samplers'] = new_smp
    kh = sorted({e for m in new_mats for e in m.get('extensions', {})})
    if kh: out['extensionsUsed'] += kh
    # 今のキャラの顔に合わせるための数字 (髪の元の顔の寸法と、髪の平均の色)。読む側は public/src/hair.js
    main = next((p for p in v.get('materialProperties', []) if p.get('name') in names and '_MainTex' in p.get('textureProperties', {})
                 and 'HairBack' not in p['name']), None) or next((p for p in v.get('materialProperties', []) if p.get('name') in names and '_MainTex' in p.get('textureProperties', {})), None)
    fit = dict(face_metrics(j, b))
    if main: fit['color'] = image_mean(j, b, main['textureProperties']['_MainTex'])
    out['extras'] = {'fit': fit}
    dst = os.path.join(ROOT, 'public', 'models', 'hairs', a.id + '.glb')
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    write_glb(dst, out, bytes(pk.out))
    print(f'{os.path.relpath(dst, ROOT)}  {os.path.getsize(dst) / 1e3:.0f} KB  (元 {os.path.getsize(a.src) / 1e6:.1f} MB)  材質 {len(new_mats)}  模様 {len(new_img)}  面のある形 {len(new_meshes)}  揺れの組 {len(groups)}')
    print('  材質:', ', '.join(m['name'] for m in new_mats))


main()
