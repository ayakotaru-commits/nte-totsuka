#!/usr/bin/env python3
"""録音された曲 (wav) から、リズムゲームの譜面 (NORMAL・HARD) を自動で作る。ゲームセンターのリズムゲーム (public/src/arcade/) 用。

  python tools/music/audio_chart.py <wav> --id pipipi --title "曲名" --credit "音楽：…" [--out public/arcade]
     -> <out>/<id>.mp3 (160 kbps)、<out>/<id>.chart.json
  pip install librosa soundfile (初回だけ。numpy・scipy も入る)

作り方 (楽譜が無いので、音から読む):
  1. 音の立ち上がり: スペクトルの変化 (n_fft 1024・hop 256 = 5.8 ms)。検出は実際の音より約 10 ms 遅れるので引く (自作曲 song_pop1 の
     キックの時刻で測った値。BIAS)
  2. 拍: librosa のビート検出 → 一定のテンポなら直線に当てはめて、きれいな拍の列にする (1 小節 = 4 拍。演出の拍・区間の見出しに使う)
  3. 歌の高さ: 調和成分に pyin (単音の高さ検出)。立ち上がりの直後の高さが、そのノーツのレーン (低い音 = 左。曲ごとに音の分布を 6 等分)。
     高さが取れない立ち上がり (ドラムなど) は、音の明るさ (スペクトル重心) でレーンを決める
  4. 選ぶ: 立ち上がりの強さ + 歌がある + 拍の上、の点が高い順に、間隔の決まりを守りながら、目標の密度 (NORMAL 約 2.6 個/秒、HARD 約 4.5 個/秒) まで
  5. 長押し: 歌の高さが 1 半音以内で続く長い音。フリック: 歌が上へ 5 半音以上跳ぶ所と、長押しの終わりで歌が途切れる所。同時押し: HARD の強い拍
  6. 区間: 小節ごとの音の大きさで、小さい = A、中 = B、大きい = chorus (背景の色と見出しに使う)
譜面の面白さは音から機械的に作った推定で、実際に遊んで直す前提 (耳では確かめられない)。確認は数字 (立ち上がりとの一致・間隔・密度) と一覧画像で行う。
"""
import argparse
import json
import os
import subprocess
import sys
import warnings

import numpy as np

warnings.filterwarnings('ignore')
import librosa  # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
import make_chart  # noqa: E402  (stats・draw を借りる)

SR = 44100
NFFT = 1024
HOP = 256
BIAS = 0.010            # 立ち上がりの検出が、実際の音より遅れる分 (秒)
LANES = 6
TARGET = {'NORMAL': dict(nps=2.6, gap_any=0.20, gap_lane=0.32, cap=4, min_hold=1.0, flick_max=0.02, dbl=0.015),
          'HARD': dict(nps=4.5, gap_any=0.085, gap_lane=0.14, cap=8, min_hold=0.7, flick_max=0.05, dbl=0.08)}


def onsets(y):
    env = librosa.onset.onset_strength(y=y, sr=SR, n_fft=NFFT, hop_length=HOP, lag=1, max_size=1)
    thr = 0.10 * np.percentile(env, 99.5)
    out = []
    for i in range(2, len(env) - 2):
        if env[i] >= env[i - 1] and env[i] > env[i + 1] and env[i] > thr:
            d = env[i - 1] - 2 * env[i] + env[i + 1]
            dt = 0.5 * (env[i - 1] - env[i + 1]) / d if abs(d) > 1e-9 else 0.0
            out.append(((i + dt) * HOP / SR - BIAS, float(env[i])))
    # 40 ms 以内は、強いほうだけ
    keep = []
    for t, s in sorted(out):
        if keep and t - keep[-1][0] < 0.04:
            if s > keep[-1][1]: keep[-1] = (t, s)
        else: keep.append((t, s))
    return env, keep


def beat_grid(env, dur):
    """ビート検出を、開始テンポを変えて何度か試す。テンポが同じになった回数の多数決 (3 拍子の取り違えで 2/3 のテンポになる回があるため) で決め、
    拍の位相は、検出した拍の時刻の円平均で決める。一定のテンポの曲を前提にした、きれいな拍の列を返す"""
    from collections import Counter
    runs = []
    for sb in (90, 110, 130, 150, 170, 190):
        tempo, fr = librosa.beat.beat_track(onset_envelope=env, sr=SR, hop_length=HOP, start_bpm=sb, tightness=400)
        bt = librosa.frames_to_time(fr, sr=SR, hop_length=HOP) - BIAS
        if len(bt) < 16: continue
        ibi = np.diff(bt)
        med = float(np.median(ibi))
        runs.append((int(round(60.0 / med)), med, float(np.median(np.abs(ibi - med))), bt))
    cnt = Counter(r[0] for r in runs)
    top = max(cnt.items(), key=lambda kv: (kv[1], kv[0]))[0]
    r = min([x for x in runs if abs(x[0] - top) <= 1], key=lambda x: x[2])
    period, bt = r[1], r[3]
    ang = 2 * np.pi * ((bt % period) / period)
    phase = float((np.angle(np.mean(np.exp(1j * ang))) / (2 * np.pi) * period) % period)
    # 周期 ±3% と位相を細かく振って、拍の列の上の立ち上がりの強さの平均がいちばん大きいものに合わせ直す
    sm = np.convolve(env, np.ones(3) / 3, mode='same')
    ft = HOP / SR
    best = (-1.0, period, phase)
    for p in np.arange(period * 0.97, period * 1.03, period * 0.0005):
        n = int((dur - 1) / p)
        k = np.arange(n) * p
        for ph in np.arange(0, p, 0.004):
            idx = np.round((ph + k + BIAS) / ft).astype(int)
            sc = float(sm[idx[idx < len(sm)]].mean())
            if sc > best[0]: best = (sc, float(p), float(ph))
    ratio = best[0] / float(np.mean(sm))
    period, phase = best[1], best[2]
    grid = np.arange(phase, dur + period, period)
    near = np.array([np.min(np.abs(grid - t)) for t in bt])
    return dict(bpm=float(60.0 / period), period=float(period), resid=float(np.std(near)), beats=grid, n_detected=len(bt), votes=dict(cnt), ratio=ratio)


def pitch_track(y):
    """歌の高さ。ベース・ドラムに引っぱられないよう、歌の帯域 (約 200〜2500 Hz) だけを残してから pyin にかける"""
    from scipy.signal import butter, sosfiltfilt
    y22 = librosa.resample(y, orig_sr=SR, target_sr=22050)
    y22 = sosfiltfilt(butter(4, [200, 2500], btype='band', fs=22050, output='sos'), y22)
    harm = librosa.effects.harmonic(y22, margin=2)
    f0, _, _ = librosa.pyin(harm, fmin=librosa.note_to_hz('A3'), fmax=librosa.note_to_hz('C6'), sr=22050, frame_length=2048, hop_length=128, fill_na=np.nan)
    tt = librosa.times_like(f0, sr=22050, hop_length=128)
    return tt, librosa.hz_to_midi(f0)


def sections(y, beats, dur):
    bars = beats[::4]
    rms = []
    for a, b in zip(bars[:-1], bars[1:]):
        seg = y[int(a * SR):int(b * SR)]
        rms.append(20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-6) if len(seg) else -90)
    rms = np.array(rms)
    sm = np.convolve(np.pad(rms, 1, mode='edge'), np.ones(3) / 3, mode='valid')
    lo, hi = np.percentile(sm, 35), np.percentile(sm, 70)
    cls = ['A' if v < lo else 'B' if v < hi else 'chorus' for v in sm]
    # 最初の小節が静かなら intro、最後が静かなら outro
    n = len(cls)
    i = 0
    while i < n - 1 and sm[i] < lo and i < 4: cls[i] = 'intro'; i += 1
    j = n - 1
    while j > i and sm[j] < lo and n - 1 - j < 3: cls[j] = 'outro'; j -= 1
    # 1 小節だけの区間は前に合わせる
    for k in range(1, n - 1):
        if cls[k] != cls[k - 1] and cls[k] != cls[k + 1] and cls[k - 1] == cls[k + 1]: cls[k] = cls[k - 1]
    out = []
    for k, c in enumerate(cls):
        a, b = float(bars[k]), float(bars[k + 1]) if k + 1 < len(bars) else dur
        if out and out[-1]['name'] == c: out[-1]['end'] = round(b, 4); out[-1]['bars'] += 1
        else: out.append({'name': c, 'start': round(a, 4), 'end': round(b, 4), 'bars': 1, 'shift': 0})
    out[0]['start'] = 0.0
    out[-1]['end'] = round(dur, 4)
    return out, rms


def build(y, ons, grid, tt, midi, centroid_at, level, dur, rng):
    P = TARGET[level]
    beats = grid['beats']
    half = np.sort(np.concatenate([beats, beats + grid['period'] / 2]))
    # 候補
    sref = np.percentile([s for _, s in ons], 95)
    cand = []
    for t, s in ons:
        m = (tt >= t + 0.02) & (tt <= t + 0.14)
        v = midi[m]
        v = v[~np.isnan(v)]
        pitch = float(np.median(v)) if len(v) >= 3 else None
        d = float(np.min(np.abs(half - t))) if len(half) else 1
        score = s / sref + (0.35 if pitch is not None else 0) + (0.25 if d < 0.025 else 0)
        cand.append(dict(t=t, s=s, pitch=pitch, cen=centroid_at(t), score=score, beat=d < 0.025))
    # 選ぶ (強い順)。間隔と、1 秒あたりの上限を守る (レーンは選んだあとで決める)
    import bisect
    target = int(P['nps'] * dur)
    cap = P['cap']
    sel, times = [], []
    for c in sorted(cand, key=lambda c: -c['score']):
        if len(sel) >= target: break
        i = bisect.bisect_left(times, c['t'])
        if (i > 0 and c['t'] - times[i - 1] < P['gap_any']) or (i < len(times) and times[i] - c['t'] < P['gap_any']): continue
        if bisect.bisect_right(times, c['t'] + 0.5) - bisect.bisect_left(times, c['t'] - 0.5) >= cap: continue
        bisect.insort(times, c['t']); sel.append(c)
    sel.sort(key=lambda c: c['t'])
    # レーン: 歌の高さがあるものは、選んだ音の高さの分布で 6 等分。高さが取れないもの (ドラムなど) は、音の明るさで 6 等分 → どのレーンもほぼ同じ回数使う
    def quant(vals, keyf, group):
        if len(group) < 6:
            for c in group: c['lane'] = LANES // 2
            return
        e = np.percentile([c[keyf] for c in group], [100 * k / LANES for k in range(1, LANES)])
        for c in group: c['lane'] = int(sum(c[keyf] >= x for x in e))
    quant(None, 'pitch', [c for c in sel if c['pitch'] is not None])
    quant(None, 'cen', [c for c in sel if c['pitch'] is None])
    # 同じレーンで近すぎるものは、弱いほうを除く
    keep = []
    last = {}
    for c in sel:
        l = c['lane']
        if l in last and c['t'] - last[l]['t'] < P['gap_lane']:
            if c['score'] > last[l]['score']:
                keep.remove(last[l]); keep.append(c); last[l] = c
            continue
        keep.append(c); last[l] = c
    sel = sorted(keep, key=lambda c: c['t'])
    # 3 連続で同じレーンは避ける
    for i in range(2, len(sel)):
        if sel[i]['lane'] == sel[i - 1]['lane'] == sel[i - 2]['lane']:
            sel[i]['lane'] = sel[i]['lane'] + 1 if sel[i]['lane'] < LANES - 1 else sel[i]['lane'] - 1
    # 長押し: 歌の高さが 1 半音以内で続く音
    notes = []
    prev_pitch = None
    flicks = 0
    for i, c in enumerate(sel):
        t = c['t']
        n = {'t': round(t, 4), 'lane': c['lane'], 'type': 'tap'}
        if c['pitch'] is not None:
            i0 = int(np.searchsorted(tt, t + 0.03))
            j = i0
            gap = 0
            while j < len(tt) and gap < 10:     # 10 コマ (約 58 ms) までの途切れは続きとみなす
                if np.isnan(midi[j]) or abs(midi[j] - c['pitch']) > 1.2: gap += 1
                else: gap = 0
                j += 1
            end = float(tt[max(i0, j - gap - 1)])
            nxt = sel[i + 1]['t'] if i + 1 < len(sel) else dur
            if end - t >= P['min_hold'] and (nxt - t > 0.5 or True):
                n = {'t': round(t, 4), 'lane': c['lane'], 'type': 'hold', 'end': round(min(end, dur - 0.2) * 0.98 + t * 0.02, 4)}
                # 次の同じレーンのノーツとぶつからない
                nl = next((s2['t'] for s2 in sel[i + 1:] if s2['lane'] == c['lane']), None)
                if nl is not None and n['end'] > nl - 0.15: n['end'] = round(nl - 0.15, 4)
                if n['end'] - t < 0.45: n = {'t': round(t, 4), 'lane': c['lane'], 'type': 'tap'}
                elif nxt - end > 0.35 and flicks < P['flick_max'] * len(sel): n['flickEnd'] = True; flicks += 1
        if n['type'] == 'tap' and c['pitch'] is not None and prev_pitch is not None and c['pitch'] - prev_pitch >= 5 and t - notes[-1]['t'] < 0.8 \
                and flicks < P['flick_max'] * len(sel):
            n['type'] = 'flick'; flicks += 1
        if c['pitch'] is not None: prev_pitch = c['pitch']
        notes.append(n)
    # 長押しの間の、同じレーンのノーツは除く
    out = []
    for n in notes:
        if any(h['type'] == 'hold' and h['lane'] == n['lane'] and h['t'] < n['t'] < h['end'] + 0.12 for h in out): continue
        out.append(n)
    notes = out
    # 同時押し (強い拍。長押しの最中は足さない)
    strong = sorted([c for c in sel if c['beat']], key=lambda c: -c['score'])[:max(1, int(P['dbl'] * len(sel)))]
    st = {round(c['t'], 4) for c in strong}
    for n in list(notes):
        if n['t'] in st and n['type'] != 'hold' and not any(h['type'] == 'hold' and h['t'] <= n['t'] <= h['end'] for h in notes):
            for cand_l in ((n['lane'] + 3) % LANES, n['lane'] + 2, n['lane'] - 2):
                if 0 <= cand_l < LANES and abs(cand_l - n['lane']) >= 2 and not any(m['lane'] == cand_l and abs(m['t'] - n['t']) < P['gap_lane'] and m is not n for m in notes) \
                        and not any(h['type'] == 'hold' and h['lane'] == cand_l and h['t'] <= n['t'] <= h['end'] + 0.12 for h in notes):
                    notes.append({'t': n['t'], 'lane': cand_l, 'type': 'tap'})
                    break
    notes.sort(key=lambda n: (n['t'], n['lane']))
    return notes


def times_near(times, t, w=0.3):
    return [x for x in times if abs(x - t) < w]   # 選んだ時刻のうち t に近いもの


def validate(notes, dur):
    problems = []
    for lane in range(LANES):
        prev_end = -9
        for n in [m for m in notes if m['lane'] == lane]:
            if n['t'] - prev_end < 0.07: problems.append(('同じレーンで近すぎ/重なり', n))
            prev_end = n.get('end', n['t'])
    ts = sorted({n['t'] for n in notes})
    for a, b in zip(ts, ts[1:]):
        if b - a < 0.07: problems.append(('押す時刻が近すぎ', {'t': a, 'next': b}))
    mt = 0
    for t in ts:
        mt = max(mt, sum(1 for n in notes if n['t'] <= t + 1e-6 <= n.get('end', n['t']) + 1e-6))
    for n in notes:
        if n['t'] < 0 or n.get('end', n['t']) > dur: problems.append(('曲の外', n))
        if n['type'] == 'hold' and n['end'] - n['t'] < 0.4: problems.append(('長押しが短い', n))
    return problems, mt


def mp3_lag_ms(wav, mp3):
    """mp3 に直した音が、wav から何 ms ずれるか (包絡どうしの相互相関。0 なら同じ)"""
    a, _ = librosa.load(wav, sr=8000, mono=True, duration=40)
    b, _ = librosa.load(mp3, sr=8000, mono=True, duration=40)
    ea = np.abs(a)[:len(a) // 8 * 8].reshape(-1, 8).max(1); eb = np.abs(b)[:len(b) // 8 * 8].reshape(-1, 8).max(1)
    ea -= ea.mean(); eb -= eb.mean()
    n = min(len(ea), len(eb))

    def corr(k):
        x, v = (ea[:n - k], eb[k:n]) if k >= 0 else (ea[-k:n], eb[:n + k])
        return float(np.dot(x, v))
    return max(range(-60, 120), key=corr)  # 1 コマ = 1 ms


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('wav'); ap.add_argument('--id', required=True); ap.add_argument('--title', required=True); ap.add_argument('--credit', default='')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'arcade'))
    ap.add_argument('--png', default=None); ap.add_argument('--skip-mp3', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    y, _ = librosa.load(a.wav, sr=SR, mono=True)
    dur = len(y) / SR
    print(f'[{a.id}] 長さ {dur:.1f} s')
    env, ons = onsets(y)
    grid = beat_grid(env, dur)
    print(f'[{a.id}] 立ち上がり {len(ons)} 個、テンポ {grid["bpm"]:.2f} BPM (多数決 {grid["votes"]}、拍の列の上の立ち上がりの強さは全体の平均の {grid["ratio"]:.2f} 倍、検出した拍とのずれ {grid["resid"] * 1000:.0f} ms)')
    tt, midi = pitch_track(y)
    print(f'[{a.id}] 歌の高さが取れた割合 {np.mean(~np.isnan(midi)) * 100:.0f}%')
    cen = librosa.feature.spectral_centroid(y=y, sr=SR, n_fft=NFFT, hop_length=HOP)[0]
    cen_at = lambda t: float(cen[min(len(cen) - 1, max(0, int(round((t + 0.02) * SR / HOP))))])  # noqa: E731
    secs, rms = sections(y, grid['beats'], dur)
    bars = grid['beats'][::4]
    bar_start = [round(float(b), 4) for b in bars if b < dur]
    bar_bpm = [round(240.0 / (bars[i + 1] - bars[i]), 3) if i + 1 < len(bars) else round(grid['bpm'], 3) for i in range(len(bar_start))]
    if bar_start[0] > 0.01:    # 最初の拍の前の部分も、同じテンポで 1 小節に数える
        bar_start.insert(0, 0.0); bar_bpm.insert(0, round(grid['bpm'], 3))
    rng = np.random.default_rng(7)
    info = {'duration': round(dur, 3), 'sections': secs, 'bar_start': bar_start, 'bar_bpm': bar_bpm}
    out = {'format': 'rhythm-chart/1', 'id': a.id, 'title': a.title, 'credit': a.credit, 'audio': f'{a.id}.mp3', 'duration': round(dur, 3), 'lanes': LANES, 'offset': 0.0,
           'bpm': round(grid['bpm'], 2), 'tempo': [{'bar': 0, 'start': bar_start[0], 'bpm': round(grid['bpm'], 2)}], 'sections': secs,
           'barStart': bar_start, 'barBpm': bar_bpm, 'banners': {'chorus': 'ここがサビだよ！', 'outro': 'ラスト！'}, 'difficulties': {}}   # 区間の見出しは、盛り上がる所と終わりだけ
    charts = {}
    for level in ('NORMAL', 'HARD'):
        notes = build(y, ons, grid, tt, midi, cen_at, level, dur, rng)
        problems, mt = validate(notes, dur)
        st = make_chart.stats(notes, info)
        st['maxTouch'] = mt
        out['difficulties'][level] = {'stats': st, 'notes': notes}
        charts[level] = notes
        print(f'[{a.id}] {level}: ノーツ {st["notes"]}（タップ {st["taps"]}・フリック {st["flicks"]}・長押し {st["holds"]}）同時押し {st["simultaneous"]} 最大 {st["maxPerSec"]}/秒 平均 {st["avgPerSec"]}/秒 レーン {st["lanes"]} 問題 {len(problems)} {problems[:3]}')
    path = os.path.join(a.out, f'{a.id}.chart.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'), default=lambda o: float(o) if isinstance(o, (np.floating, np.integer)) else str(o))
    if not a.skip_mp3:
        mp3 = os.path.join(a.out, f'{a.id}.mp3')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', a.wav, '-codec:a', 'libmp3lame', '-b:a', '160k', mp3], check=True)
        print(f'[{a.id}] mp3 {os.path.getsize(mp3) / 1e6:.1f} MB、wav との時間のずれ {mp3_lag_ms(a.wav, mp3)} ms')
    if a.png:
        info2 = dict(info); info2['bar_start'] = bar_start; info2['bar_bpm'] = bar_bpm
        make_chart.draw(charts, info2, a.png)
    print(f'[{a.id}] 書いた: {path}')


if __name__ == '__main__':
    main()
