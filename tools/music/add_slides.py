#!/usr/bin/env python3
"""譜面の後処理: 長押しを少し増やし、レーンをまたぐ長押し (via) を足す。

  python tools/music/add_slides.py            # public/arcade/*.json の全譜面 (songs.json の chart) に適用
  python tools/music/add_slides.py --check    # 数だけ見る (書き換えない)

1. 長押しを増やす: 次のノーツまで 1 秒以上あいている「押す」ノーツのうち、間隔をあけて選んだものを、拍にそろえた長押し (0.6〜2 秒) にする。
   ノーツの数は変わらない (置き換えるだけ)。
2. レーンをまたぐ: 0.9 秒以上の長押しの一部に、途中で別のレーンへ移る指定 (via: [[時刻, レーン], ...]) を足す。
   移る先のレーンに、その間ほかのノーツが無いものだけ。
譜面に slides: true の印を付け、2 回目からは何もしない (譜面を作り直したら、また 1 回かける)。毎回同じ結果 (乱数は譜面ごとに固定)。
"""
import json, random, sys, os

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'arcade')
SPACING = {'NORMAL': 6.0, 'HARD': 4.0}      # 新しい長押しどうしの最短の間隔 (秒)
PICK = 0.85                                  # 候補のうち採る確率
SLIDE_P = 0.6                               # 長押しのうち、レーンをまたぐものの割合


def beats_of(c):
    out = []
    for i, (b0, bpm) in enumerate(zip(c['barStart'], c['barBpm'])):
        for k in range(4):
            out.append(b0 + k * 60.0 / bpm)
    return out


def snap_le(beats, t):      # t 以下でいちばん近い拍
    best = None
    for b in beats:
        if b <= t + 1e-9: best = b
        else: break
    return best


def snap_near(beats, t):
    return min(beats, key=lambda b: abs(b - t))


def segs(n):                # 長押しが 各レーンを占める区間 [(lane, t0, t1)]
    if n['type'] != 'hold': return [(n['lane'], n['t'], n['t'])]
    pts = [(n['t'], n['lane'])] + [(v[0], v[1]) for v in n.get('via', [])]
    out = []
    for i, (t, l) in enumerate(pts):
        t1 = pts[i + 1][0] if i + 1 < len(pts) else n['end']
        out.append((l, t, t1))
    return out


def process(c, diff, rng, beats):
    notes = c['difficulties'][diff]['notes']
    notes.sort(key=lambda n: (n['t'], n['lane']))
    # 1. 長押しを増やす
    last = -99.0
    added = 0
    for i, n in enumerate(notes):
        if n['type'] != 'tap': continue
        if any(abs(m['t'] - n['t']) < 0.02 for j, m in enumerate(notes) if j != i): continue       # 同時押しは対象外
        nxt = min((m['t'] for m in notes if m['t'] > n['t'] + 0.02), default=n['t'] + 9)
        # 終わりまでに、ほかの長押しの終わりもまたがない
        gap = nxt - n['t']
        if gap < 0.9 or n['t'] - last < SPACING[diff] or rng.random() > PICK: continue
        e = snap_le(beats, min(n['t'] + gap - 0.35, n['t'] + 2.0))
        if e is None or e - n['t'] < 0.55: continue
        if any(m is not n and m['type'] == 'hold' and m['t'] <= e + 0.1 and m['end'] >= n['t'] - 0.1 for m in notes): continue
        n['type'] = 'hold'; n['end'] = round(e, 4); last = n['t']; added += 1
    # 2. レーンをまたぐ
    slid = 0
    for i, n in enumerate(notes):
        if n['type'] != 'hold' or n.get('via'): continue
        d = n['end'] - n['t']
        if d < 0.8 or rng.random() > SLIDE_P: continue
        occ = [(l, a - 0.2, b + 0.2) for j, m in enumerate(notes) if j != i for (l, a, b) in segs(m)]
        via = []; lane = n['lane']; t0 = n['t']
        for _ in range(2):
            lo, hi = t0 + 0.3, n['end'] - 0.3
            if hi - lo < 0.01: break
            sw = snap_near(beats, rng.uniform(lo, hi) if not via else lo + (hi - lo) * 0.5)
            if not (lo - 1e-6 <= sw <= hi + 1e-6): break
            cands = [l for l in range(6) if 1 <= abs(l - lane) <= 3 and not any(ol == l and a < n['end'] + 0.2 and b > sw - 0.3 for ol, a, b in occ)]
            if not cands: break
            to = rng.choice(cands)
            via.append([round(sw, 4), to]); lane = to; t0 = sw
            if d < 1.9 or rng.random() > 0.4: break
        if via: n['via'] = via; slid += 1
    st = c['difficulties'][diff]['stats']
    st['holds'] = sum(1 for n in notes if n['type'] == 'hold'); st['taps'] = sum(1 for n in notes if n['type'] == 'tap'); st['slides'] = slid
    return added, slid


def main():
    check = '--check' in sys.argv
    songs = json.load(open(os.path.join(ROOT, 'songs.json'), encoding='utf-8'))['songs']
    for s in songs:
        p = os.path.join(ROOT, s['chart'])
        c = json.load(open(p, encoding='utf-8'))
        if c.get('slides'): print(s['id'], 'すでに適用済み'); continue
        beats = beats_of(c)
        for d in c['difficulties']:
            before = sum(1 for n in c['difficulties'][d]['notes'] if n['type'] == 'hold')
            rng = random.Random(f"{s['id']}-{d}")
            a, sl = process(c, d, rng, beats)
            print(f"{s['id']:11s} {d:6s} 長押し {before} → {before + a}  (うち、レーンをまたぐ {sl})")
        c['slides'] = True
        if not check: json.dump(c, open(p, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()
