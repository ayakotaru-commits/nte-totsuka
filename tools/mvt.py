"""最小限の Mapbox Vector Tile (MVT) デコーダ。標準ライブラリのみ。

decode(data) -> {layer_name: {"extent": int, "features": [{"type": 1|2|3, "props": {...}, "geom": [[(x, y), ...], ...]}]}}
geom はタイル座標 (0..extent)。ポリゴンはリングのリスト (外周は時計回り、穴は反時計回り: y下向き座標系)。
"""
import struct


def _varint(b, i):
    r = s = 0
    while True:
        c = b[i]; i += 1
        r |= (c & 0x7F) << s
        if not c & 0x80:
            return r, i
        s += 7


def _fields(b):
    i, n = 0, len(b)
    while i < n:
        key, i = _varint(b, i)
        f, t = key >> 3, key & 7
        if t == 0:
            v, i = _varint(b, i)
        elif t == 1:
            v = b[i:i + 8]; i += 8
        elif t == 2:
            ln, i = _varint(b, i)
            v = b[i:i + ln]; i += ln
        elif t == 5:
            v = b[i:i + 4]; i += 4
        else:
            raise ValueError(f"wire type {t}")
        yield f, t, v


def _packed(b):
    out, i = [], 0
    while i < len(b):
        v, i = _varint(b, i)
        out.append(v)
    return out


def _value(b):
    for f, t, v in _fields(b):
        if f == 1: return v.decode("utf-8")
        if f == 2: return struct.unpack("<f", v)[0]
        if f == 3: return struct.unpack("<d", v)[0]
        if f in (4, 5): return v
        if f == 6: return (v >> 1) ^ -(v & 1)
        if f == 7: return bool(v)
    return None


def _zz(n):
    return (n >> 1) ^ -(n & 1)


def _geometry(cmds, gtype):
    rings, cur, x, y, i = [], [], 0, 0, 0
    while i < len(cmds):
        c = cmds[i]; i += 1
        cid, cnt = c & 7, c >> 3
        if cid in (1, 2):
            if cid == 1 and cur:
                rings.append(cur); cur = []
            for _ in range(cnt):
                x += _zz(cmds[i]); y += _zz(cmds[i + 1]); i += 2
                cur.append((x, y))
        elif cid == 7:
            if cur:
                rings.append(cur); cur = []
    if cur:
        rings.append(cur)
    return rings


def decode(data):
    layers = {}
    for f, t, v in _fields(data):
        if f != 3:
            continue
        name, extent, keys, vals, feats = None, 4096, [], [], []
        for lf, lt, lv in _fields(v):
            if lf == 1: name = lv.decode("utf-8")
            elif lf == 5: extent = lv
            elif lf == 3: keys.append(lv.decode("utf-8"))
            elif lf == 4: vals.append(_value(lv))
            elif lf == 2: feats.append(lv)
        out = []
        for fb in feats:
            tags, gtype, geom = [], 0, []
            for ff, ft, fv in _fields(fb):
                if ff == 2: tags = _packed(fv)
                elif ff == 3: gtype = fv
                elif ff == 4: geom = _packed(fv)
            props = {keys[tags[k]]: vals[tags[k + 1]] for k in range(0, len(tags) - 1, 2)}
            out.append({"type": gtype, "props": props, "geom": _geometry(geom, gtype)})
        layers[name] = {"extent": extent, "features": out}
    return layers
