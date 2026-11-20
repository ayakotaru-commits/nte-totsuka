#!/usr/bin/env python3
"""曲(song_pop1.json)の旋律から、プロセカ風(落ちてくる形式)の譜面を作る。

  python tools/music/song_pop1.py <フォルダ>            # 先に曲を作る (song_pop1.json ができる)
  python tools/music/make_chart.py <フォルダ> [--png]   # <フォルダ>/song_pop1_chart.json (--png で一覧画像も)

レーンは 6 本（0 が左端）。ノーツは tap / flick（上へはじく）/ hold（長押し。flickEnd なら離す所ではじく）。
時刻はすべて曲の頭からの秒。難易度は NORMAL と HARD。

決まり:
  ・旋律の高さがレーンになる（低い音 = 左、高い音 = 右）。同じレーンに 3 連続は避ける。
  ・長い音(HARD は 6/16 以上、NORMAL は 8/16 以上)は長押し。
  ・フリックは、旋律の「フレーズの終わり」と、サビ・B で上へ 5 半音以上跳ぶ音。
  ・同時押しは、サビ・大サビの小節の頭など。長押しの最中には足さない。
  ・間奏の速い連打は、レーンを左右に駆け上がり・駆け下りる並べ方にする。
"""
import json
import math
import os
import sys

LANES = 6
GOOD_GAP = 0.07   # どの 2 つの押す時刻も、これ以上あける（秒）


def make_lane_of(info):
    """旋律の音の高さの分布を 6 等分して、低い音 = 左 ... 高い音 = 右 にする（どのレーンもほぼ同じ回数使う）。"""
    sh = {}
    for s in info['sections']:
        sh[s['name']] = s['shift']
    vals = sorted(n['midi'] - sh[n['sec']] for n in info['notes'] if n['kind'] == 'melody')
    edges = [vals[len(vals) * k // LANES] for k in range(1, LANES)]

    def lane_of(midi, shift):
        x = midi - shift
        return sum(1 for e in edges if x >= e)
    return lane_of, edges


def make(info, diff):
    hard = diff == 'HARD'
    lane_of, _edges = make_lane_of(info)
    bb, bs = info['bar_bpm'], info['bar_start']
    sec_of_bar = {}
    sec_first = {}
    shift_of = {}
    gi = 0
    for s in info['sections']:
        sec_first[s['name']] = gi
        for b in range(gi, gi + s['bars']):
            sec_of_bar[b] = s['name']
        shift_of[s['name']] = s['shift']
        gi += s['bars']

    notes = []
    holds = []   # (lane, start, end)

    def lane_busy(lane, t):
        return any(l == lane and a - 1e-6 <= t <= e + 1e-6 for l, a, e in holds)

    def add(t, lane, typ='tap', end=None, flick_end=False):
        n = {'t': round(t, 4), 'lane': lane, 'type': typ}
        if typ == 'hold':
            n['end'] = round(end, 4)
            if flick_end:
                n['flickEnd'] = True
            holds.append((lane, t, end))
        notes.append(n)

    def add_pair(t, lane):
        for cand in ((lane + 3) % LANES, lane + 2, lane - 2, lane + 4, lane - 4):
            if 0 <= cand < LANES and abs(cand - lane) >= 2 and not lane_busy(cand, t):
                add(t, cand)
                return

    # ─ 旋律 ─
    mel = [n for n in info['notes'] if n['kind'] == 'melody']
    mel.sort(key=lambda n: n['t'])
    prev = None
    last_lanes = []
    for i, n in enumerate(mel):
        bar = n['bar']
        sec = sec_of_bar[bar]
        blen = 240.0 / bb[bar]
        s16 = blen / 16
        pos = round((n['t'] - bs[bar]) / s16)
        d16 = round(n['dur'] / s16)
        shift = shift_of[sec]
        bar_in_sec = bar - sec_first[sec]
        is_chorus = sec in ('chorus', 'chorus2', 'big')
        gap_after = (mel[i + 1]['t'] - (n['t'] + n['dur'])) if i + 1 < len(mel) else 9.9
        phrase_end = gap_after >= 0.14 and d16 >= 4 and sec not in ('A', 'A2')
        keep = True
        if not hard:
            keep = (pos % 4 == 0) or d16 >= 3
        if not keep:
            continue
        lane = lane_of(n['midi'], shift)
        if len(last_lanes) >= 2 and last_lanes[-1] == lane and last_lanes[-2] == lane:
            lane = lane + 1 if lane < LANES - 1 else lane - 1
        t = n['t']
        end = n['t'] + n['dur'] * 0.92
        hold = d16 >= (6 if hard else 8)
        leap = (prev is not None and prev['sec'] == sec and n['midi'] - prev['midi'] >= 5
                and sec in ('B', 'B2', 'chorus', 'chorus2', 'big') and d16 >= 2)
        if hold:
            add(t, lane, 'hold', end, flick_end=phrase_end)
        elif phrase_end or (hard and leap):
            add(t, lane, 'flick')
        else:
            add(t, lane, 'tap')
        # 同時押し
        pair = False
        if hard:
            if is_chorus and pos == 0:
                pair = True
            if sec == 'A2' and pos == 0 and bar_in_sec % 2 == 0:
                pair = True
            if sec == 'outro' and pos == 0 and bar_in_sec in (0, 3):
                pair = True
        else:
            if sec in ('chorus', 'big') and pos == 0 and bar_in_sec == 0:
                pair = True
        if pair:
            add_pair(t, lane)
        last_lanes.append(lane)
        prev = {'sec': sec, 'midi': n['midi']}

    # ─ イントロ（キックが入る 3・4 小節目に、拍ごとの「準備」ノーツ） ─
    for b in (2, 3):
        blen = 240.0 / bb[b]
        for k in range(4):
            if b == 3 and k == 3:
                continue
            add(bs[b] + k * blen / 4, 2 if (b * 4 + k) % 2 == 0 else 3)

    # ─ 間奏（16 分の連打を、左右へ駆け上がり・駆け下りる並びに） ─
    inter = [b for b in range(len(bb)) if sec_of_bar[b] == 'interlude']
    for j, b in enumerate(inter):
        s16 = 240.0 / bb[b] / 16
        up = (j % 2 == 0)
        if hard:
            seq = [0, 1, 2, 3, 4, 5, 4, 3] if up else [5, 4, 3, 2, 1, 0, 1, 2]
            for k, ln in enumerate(seq):
                add(bs[b] + 2 * k * s16, ln)
        else:
            seq = [0, 2, 4, 5] if up else [5, 3, 1, 0]
            for k, ln in enumerate(seq):
                add(bs[b] + 4 * k * s16, ln)

    notes.sort(key=lambda n: (n['t'], n['lane']))
    return notes


def validate(notes, info):
    bb, bs = info['bar_bpm'], info['bar_start']
    problems = []
    # 1. 16 分の格子に乗っているか
    for n in notes:
        b = max(i for i in range(len(bb)) if bs[i] <= n['t'] + 1e-3)
        s16 = 240.0 / bb[b] / 16
        x = (n['t'] - bs[b]) / s16
        if abs(x - round(x)) > 0.02:
            problems.append(('格子から外れた', n))
    # 2. 同じレーンの重なり・近すぎ
    for lane in range(LANES):
        prev_end = -9
        for n in [m for m in notes if m['lane'] == lane]:
            if n['t'] - prev_end < GOOD_GAP:
                problems.append(('同じレーンで近すぎ/重なり', n))
            prev_end = n.get('end', n['t'])
    # 3. 同じ時刻に押す数・同時に触っている数
    ts = sorted({n['t'] for n in notes})
    for a, b in zip(ts, ts[1:]):
        if b - a < GOOD_GAP:
            problems.append(('押す時刻が近すぎ', {'t': a, 'next': b}))
    max_touch = 0
    for t in ts:
        touch = sum(1 for n in notes if n['t'] <= t + 1e-6 <= n.get('end', n['t']) + 1e-6)
        max_touch = max(max_touch, touch)
    # 4. 長押しが短すぎないか
    for n in notes:
        if n['type'] == 'hold' and n['end'] - n['t'] < 0.25:
            problems.append(('長押しが短い', n))
    return problems, max_touch


def stats(notes, info):
    ts = [n['t'] for n in notes]
    mx = 0
    for t in ts:
        mx = max(mx, sum(1 for u in ts if t <= u < t + 1.0))
    lane_count = [0] * LANES
    for n in notes:
        lane_count[n['lane']] += 1
    pairs = len(ts) - len(set(ts))
    sec = {}
    for s in info['sections']:
        c = sum(1 for n in notes if s['start'] <= n['t'] < s['end'])
        sec[s['name']] = {'notes': c, 'perSec': round(c / (s['end'] - s['start']), 2)}
    return {
        'notes': len(notes), 'combo': len(notes),
        'taps': sum(1 for n in notes if n['type'] == 'tap'),
        'flicks': sum(1 for n in notes if n['type'] == 'flick'),
        'holds': sum(1 for n in notes if n['type'] == 'hold'),
        'flickEnds': sum(1 for n in notes if n.get('flickEnd')),
        'simultaneous': pairs,
        'maxPerSec': mx,
        'avgPerSec': round(len(notes) / info['duration'], 2),
        'lanes': lane_count, 'sections': sec,
    }


def draw(charts, info, path):
    from PIL import Image, ImageDraw
    px = 22
    W = int(info['duration'] * px) + 60
    rowh = 26
    block = LANES * rowh + 40
    H = block * len(charts) + 40
    img = Image.new('RGB', (W, H), (18, 20, 34))
    d = ImageDraw.Draw(img)
    cols = {'tap': (110, 200, 255), 'flick': (255, 120, 170), 'hold': (120, 230, 160)}
    for ci, (name, notes) in enumerate(charts.items()):
        y0 = 30 + ci * block
        d.text((4, y0 - 20), name, fill=(255, 255, 255))
        for s in info['sections']:
            x = 30 + s['start'] * px
            d.line([(x, y0 - 4), (x, y0 + LANES * rowh)], fill=(90, 90, 130))
            d.text((x + 3, y0 - 16), s['name'], fill=(190, 190, 230))
        for ln in range(LANES + 1):
            y = y0 + ln * rowh
            d.line([(30, y), (W, y)], fill=(45, 48, 70))
        for n in notes:
            x = 30 + n['t'] * px
            y = y0 + n['lane'] * rowh + rowh // 2
            if n['type'] == 'hold':
                x2 = 30 + n['end'] * px
                d.rectangle([x, y - 6, x2, y + 6], fill=(60, 150, 100), outline=cols['hold'])
                if n.get('flickEnd'):
                    d.polygon([(x2, y - 8), (x2 + 8, y), (x2, y + 8)], fill=cols['flick'])
            c = cols[n['type']]
            d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=c)
    # テンポ変化
    bb, bs = info['bar_bpm'], info['bar_start']
    cur = None
    for i, b in enumerate(bb):
        if b != cur:
            cur = b
            x = 30 + bs[i] * px
            d.text((x + 3, H - 16), f'{b}', fill=(255, 210, 120))
    img.save(path)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    folder = args[0] if args else '.'
    info = json.load(open(os.path.join(folder, 'song_pop1.json'), encoding='utf-8'))
    charts = {d: make(info, d) for d in ('NORMAL', 'HARD')}
    out = {
        'format': 'rhythm-chart/1', 'title': info['title'], 'audio': 'song_pop1.mp3',
        'duration': info['duration'], 'lanes': LANES, 'offset': 0.0,
        'tempo': [{'bar': i, 'start': info['bar_start'][i], 'bpm': b}
                  for i, b in enumerate(info['bar_bpm']) if i == 0 or b != info['bar_bpm'][i - 1]],
        'sections': info['sections'],
        'difficulties': {},
    }
    for d, notes in charts.items():
        problems, max_touch = validate(notes, info)
        st = stats(notes, info)
        st['maxTouch'] = max_touch
        out['difficulties'][d] = {'stats': st, 'notes': notes}
        print(f'[{d}] ノーツ {st["notes"]}（タップ {st["taps"]}・フリック {st["flicks"]}・長押し {st["holds"]}）'
              f' 同時押し {st["simultaneous"]} 組  最大 {st["maxPerSec"]} 個/秒  平均 {st["avgPerSec"]} 個/秒'
              f'  同時に触る最大 {max_touch}  レーン別 {st["lanes"]}')
        print('   区間ごと:', {k: v['perSec'] for k, v in st['sections'].items()})
        print('   問題:', len(problems), problems[:6])
    path = os.path.join(folder, 'song_pop1_chart.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    if '--png' in sys.argv:
        draw(charts, info, os.path.join(folder, 'chart_overview.png'))
    print('書いた:', path, os.path.getsize(path), 'bytes')


if __name__ == '__main__':
    main()
