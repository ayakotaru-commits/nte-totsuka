"""PLATEAU 横浜市 (2024年度) CityGML から戸塚駅周辺の建物 (LOD1) を取得・変換する。

使い方: python tools/fetch_plateau.py
出力:   data/raw/plateau/<mesh>_bldg.gml (キャッシュ), data/raw/plateau_bldg.json
出典:   国土交通省 Project PLATEAU 3D都市モデル 横浜市 (2024年度)
"""
import json
import pathlib
import xml.etree.ElementTree as ET

from config import BBOX
from remotezip import open_remote_zip

ZIP_URL = "https://assets.cms.plateau.reearth.io/assets/04/96d45a-a30b-4c9f-88c0-c1323b5a0f86/14100_yokohama-shi_city_2024_citygml_2_op.zip"
ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "plateau"
OUT = ROOT / "data" / "raw" / "plateau_bldg.json"
OUT_ROAD = ROOT / "data" / "raw" / "plateau_road.json"

NS = {
    "gml": "http://www.opengis.net/gml",
    "bldg": "http://www.opengis.net/citygml/building/2.0",
    "core": "http://www.opengis.net/citygml/2.0",
}


def mesh3(lat, lon):
    a = lat * 1.5; p = int(a); a2 = (a - p) * 8; q = int(a2); r = int((a2 - q) * 10)
    b = lon - 100; u = int(b); b2 = (b - u) * 8; v = int(b2); w = int((b2 - v) * 10)
    return f"{p}{u}{q}{v}{r}{w}"


def meshes_for_bbox():
    s, w, n, e = BBOX
    out = set()
    steps = 12
    for i in range(steps + 1):
        for j in range(steps + 1):
            out.add(mesh3(s + (n - s) * i / steps, w + (e - w) * j / steps))
    return sorted(out)


def download(meshes):
    RAW.mkdir(parents=True, exist_ok=True)
    need = [(m, k) for m in meshes for k in ("bldg", "tran") if not (RAW / f"{m}_{k}.gml").exists()]
    if not need:
        return
    print("opening remote zip ...")
    z = open_remote_zip(ZIP_URL)
    names = z.namelist()
    for m, k in need:
        hit = [n for n in names if n.endswith(f"{k}/{m}_{k}_6697_op.gml")]
        if not hit:
            print(f"  {m} {k}: not in archive")
            continue
        print(f"  downloading {m} {k} ...")
        (RAW / f"{m}_{k}.gml").write_bytes(z.read(hit[0]))


def parse_roads(path):
    """道路 (tran:Road) の LOD1 面。歩道・車道の区別は無い"""
    res = []
    s, w, n, e = BBOX
    for _, el in ET.iterparse(path, events=("end",)):
        if el.tag != "{http://www.opengis.net/citygml/transportation/2.0}Road":
            continue
        for poly in el.iterfind(".//gml:Polygon", NS):
            outer = ring(poly.find("gml:exterior//gml:posList", NS))
            holes = [ring(p) for p in poly.findall("gml:interior//gml:posList", NS)]
            if not any(s <= p[0] <= n and w <= p[1] <= e for p in outer):
                continue
            r = {"outer": [[p[0], p[1]] for p in outer]}
            if holes:
                r["holes"] = [[[p[0], p[1]] for p in h] for h in holes]
            res.append(r)
        el.clear()
    return res


def ring(poslist_el):
    v = [float(x) for x in poslist_el.text.split()]
    return [(v[i], v[i + 1], v[i + 2]) for i in range(0, len(v), 3)]


def parse(path):
    res = []
    s, w, n, e = BBOX
    for _, el in ET.iterparse(path, events=("end",)):
        if el.tag != f"{{{NS['bldg']}}}Building":
            continue
        fp = el.find("bldg:lod0FootPrint", NS)
        if fp is None:
            fp = el.find("bldg:lod0RoofEdge", NS)
        solid = el.find("bldg:lod1Solid", NS)
        if fp is None or solid is None:
            el.clear(); continue
        poly = fp.find(".//gml:Polygon", NS)
        outer = ring(poly.find("gml:exterior//gml:posList", NS))
        holes = [ring(p) for p in poly.findall("gml:interior//gml:posList", NS)]
        lat0 = sum(p[0] for p in outer) / len(outer)
        lon0 = sum(p[1] for p in outer) / len(outer)
        if not (s <= lat0 <= n and w <= lon0 <= e):
            el.clear(); continue
        zs = [float(x) for pl in solid.iterfind(".//gml:posList", NS) for x in pl.text.split()[2::3]]
        base, top = min(zs), max(zs)
        mh = el.find("bldg:measuredHeight", NS)
        h = float(mh.text) if mh is not None and mh.text and float(mh.text) > 0 else top - base
        name = el.find("gml:name", NS)
        b = {
            "id": el.get(f"{{{NS['gml']}}}id"),
            "outer": [[p[0], p[1]] for p in outer],
            "h": round(h, 2),
            "base": round(base, 2),
        }
        if holes:
            b["holes"] = [[[p[0], p[1]] for p in r] for r in holes]
        if name is not None and name.text:
            b["name"] = name.text
        res.append(b)
        el.clear()
    return res


def main():
    meshes = meshes_for_bbox()
    print("meshes:", meshes)
    download(meshes)
    allb = []
    for m in meshes:
        p = RAW / f"{m}_bldg.gml"
        if p.exists():
            bs = parse(p)
            print(f"  {m}: {len(bs)} buildings in bbox")
            allb += bs
    OUT.write_text(json.dumps({"source": "PLATEAU Yokohama 2024 (MLIT)", "buildings": allb}, ensure_ascii=False), encoding="utf-8")
    print(f"-> {OUT} ({len(allb)} buildings)")
    roads = []
    for m in meshes:
        p = RAW / f"{m}_tran.gml"
        if p.exists():
            roads += parse_roads(p)
    OUT_ROAD.write_text(json.dumps({"source": "PLATEAU Yokohama 2024 (MLIT) tran LOD1", "roads": roads}, ensure_ascii=False), encoding="utf-8")
    print(f"-> {OUT_ROAD} ({len(roads)} road polygons)")


if __name__ == "__main__":
    main()
