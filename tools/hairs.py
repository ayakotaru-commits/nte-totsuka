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


def main():
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
    dst = os.path.join(ROOT, 'public', 'models', 'hairs', a.id + '.glb')
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    write_glb(dst, out, bytes(pk.out))
    print(f'{os.path.relpath(dst, ROOT)}  {os.path.getsize(dst) / 1e3:.0f} KB  (元 {os.path.getsize(a.src) / 1e6:.1f} MB)  材質 {len(new_mats)}  模様 {len(new_img)}  面のある形 {len(new_meshes)}  揺れの組 {len(groups)}')
    print('  材質:', ', '.join(m['name'] for m in new_mats))


main()
