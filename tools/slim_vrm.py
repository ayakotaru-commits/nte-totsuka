"""キャラのモデル (VRM = glTF のバイナリ) の模様を、画質を落とさずに軽くする。

  python tools/slim_vrm.py                      # public/models/player.vrm をその場で軽くする
  python tools/slim_vrm.py <入力.vrm> <出力.vrm>

やること (形・骨・表情・材質の設定と、模様の画素には触らない):
  - PNG の模様を WebP の可逆圧縮 (画素が元とまったく同じ) にする。glTF の拡張 EXT_texture_webp を使う
    (three.js の GLTFLoader が対応。主なブラウザは Safari 14 以降を含め WebP を読める)。
    最初は大きい模様を 1024 px に縮める案を試したが、近くで胸元のレースがぼやけたのでやめた。
  - ゲームで使わないサムネイル (VRM の meta.texture が指す画像。2048 px、1.7MB) を 8 px の画像に置き換える
    (消すと番号がずれるので、中身だけ小さくする)。
何度実行しても同じ結果になる (WebP にした画像はもう対象にならない)。元のファイルは git の履歴にある。
"""
import io
import json
import struct
import sys

from PIL import Image

EXT = 'EXT_texture_webp'


def read_glb(data):
    magic, ver, _ = struct.unpack('<4sII', data[:12])
    assert magic == b'glTF' and ver == 2, 'glTF 2.0 のバイナリではない'
    pos, js, bin_ = 12, None, b''
    while pos < len(data):
        n, kind = struct.unpack('<I4s', data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + n]
        if kind == b'JSON':
            js = json.loads(chunk)
        elif kind == b'BIN\0':
            bin_ = chunk
        pos += 8 + n
    return js, bin_


def write_glb(js, bin_):
    j = json.dumps(js, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    j += b' ' * (-len(j) % 4)
    bin_ += b'\0' * (-len(bin_) % 4)
    total = 12 + 8 + len(j) + 8 + len(bin_)
    return (struct.pack('<4sII', b'glTF', 2, total) + struct.pack('<I4s', len(j), b'JSON') + j
            + struct.pack('<I4s', len(bin_), b'BIN\0') + bin_)


def webp(img):
    out = io.BytesIO()
    img.save(out, 'WEBP', lossless=True, quality=100, method=6, exact=True)  # exact: 透明な画素の色も残す
    return out.getvalue()


def slim(js, bin_):
    views = js['bufferViews']
    images = js.get('images', [])
    meta_tex = (js.get('extensions', {}).get('VRM', {}).get('meta', {}) or {}).get('texture')
    thumb = js['textures'][meta_tex]['source'] if isinstance(meta_tex, int) and meta_tex >= 0 else None
    replace = {}  # 画像の番号 -> WebP の中身
    for i, im in enumerate(images):
        if 'bufferView' not in im or im.get('mimeType') != 'image/png':
            continue
        v = views[im['bufferView']]
        off = v.get('byteOffset', 0)
        png = bin_[off:off + v['byteLength']]
        img = Image.open(io.BytesIO(png))
        if i == thumb:
            img = Image.new('RGB', (8, 8), (200, 200, 200))
            print(f'  {im.get("name")}: サムネイル -> 8 px')
        w = webp(img)
        assert Image.open(io.BytesIO(w)).convert('RGBA').tobytes() == img.convert('RGBA').tobytes(), '可逆にならなかった'
        replace[i] = w
        if len(png) > 300_000:
            print(f'  {im.get("name")}: {len(png):,} -> {len(w):,} バイト')
    if not replace:
        return None
    for i in replace:
        images[i]['mimeType'] = 'image/webp'
    # WebP にした画像を使う模様に拡張を付ける (source はそのまま残す。three.js は拡張の方を使う)
    for t in js.get('textures', []):
        if t.get('source') in replace:
            t.setdefault('extensions', {})[EXT] = {'source': t['source']}
    for key in ('extensionsUsed', 'extensionsRequired'):
        js.setdefault(key, [])
        if EXT not in js[key]:
            js[key].append(EXT)
    # バイナリを詰め直す (画像以外の bufferView は中身をそのまま、4 バイト境界にそろえて並べ直す)
    new_view_data = {images[i]['bufferView']: d for i, d in replace.items()}
    out = bytearray()
    for vi, v in enumerate(views):
        assert v.get('buffer', 0) == 0, 'バッファが 2 つ以上ある VRM には未対応'
        off = v.get('byteOffset', 0)
        chunk = new_view_data.get(vi, bin_[off:off + v['byteLength']])
        out += b'\0' * (-len(out) % 4)
        v['byteOffset'] = len(out)
        v['byteLength'] = len(chunk)
        out += chunk
    js['buffers'][0]['byteLength'] = len(out)
    return bytes(out)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'public/models/player.vrm'
    dst = sys.argv[2] if len(sys.argv) > 2 else src
    data = open(src, 'rb').read()
    js, bin_ = read_glb(data)
    new_bin = slim(js, bin_)
    if new_bin is None:
        print('PNG の模様は無かった (変更なし)')
        if dst != src:
            open(dst, 'wb').write(data)
        return
    out = write_glb(js, new_bin)
    open(dst, 'wb').write(out)
    print(f'{src}: {len(data):,} -> {len(out):,} バイト ({dst})')


if __name__ == '__main__':
    main()
