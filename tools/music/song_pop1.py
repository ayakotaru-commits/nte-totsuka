#!/usr/bin/env python3
"""オリジナル曲「ハイテンポ・ポップ」(仮題) を、numpy だけで合成して WAV にする。

イベント（リズムゲーム）用の曲の試作。歌は無く、リードのシンセが旋律を受け持つ。
旋律・コード・ドラムはすべてこのファイルの中の数字で、既存の曲とは無関係に書いた。

  python tools/music/song_pop1.py <出力フォルダ>
    -> song_pop1.wav  (44.1kHz / 16bit / ステレオ)
       song_pop1.json (テンポ・各セクションの時刻・旋律の音符。譜面づくりに使う)

BPM 172・4/4・ニ長調(D)。約 84 秒。
  イントロ 4 / A 8 / B 4 / サビ 8 / 間奏 4 / A 8 / B 4 / サビ 8 / 大サビ(+2 半音) 8 / アウトロ 4  = 60 小節
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np

SR = 44100
BPM = 172
BEAT = 60.0 / BPM
S16 = BEAT / 4
BAR = BEAT * 4
rng = np.random.default_rng(20261120)


def mf(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=float) - 69) / 12)


# ───────── コード（ニ長調）。(ベースの音, 三和音) ─────────
CH = {
    'G': (43, (55, 59, 62)),
    'A': (45, (57, 61, 64)),
    'F#m': (42, (54, 57, 61)),
    'Bm': (47, (59, 62, 66)),
    'D': (50, (54, 57, 62)),
}
P_INTRO = ['G', 'A', 'F#m', 'Bm']
P_A = ['Bm', 'G', 'D', 'A', 'Bm', 'G', 'A', 'A']
P_B = ['G', 'A', 'Bm', 'A']
P_CH = ['G', 'A', 'F#m', 'Bm', 'G', 'A', 'D', 'D']
P_INTER = ['Bm', 'G', 'D', 'A']
P_OUT = ['G', 'A', 'D', 'D']

# ───────── 旋律（小節ごとに (16分の位置, 長さ, MIDI)） ─────────
MEL_A = [
    [(0, 2, 66), (2, 2, 71), (4, 2, 74), (6, 2, 71), (8, 4, 69), (12, 4, 66)],
    [(0, 2, 67), (2, 2, 71), (4, 2, 74), (6, 2, 71), (8, 4, 67), (12, 2, 71), (14, 2, 74)],
    [(0, 2, 69), (2, 2, 74), (4, 2, 78), (6, 2, 74), (8, 4, 69), (12, 4, 66)],
    [(0, 2, 69), (2, 2, 73), (4, 2, 76), (6, 2, 73), (8, 6, 69)],
    [(0, 2, 66), (2, 2, 71), (4, 2, 74), (6, 2, 78), (8, 4, 76), (12, 4, 74)],
    [(0, 2, 67), (2, 2, 71), (4, 2, 74), (6, 2, 71), (8, 4, 74), (12, 2, 71), (14, 2, 67)],
    [(0, 2, 73), (2, 2, 76), (4, 2, 73), (6, 2, 69), (8, 4, 73), (12, 4, 76)],
    [(0, 4, 73), (4, 4, 69)],
]
MEL_B = [
    [(0, 2, 74), (2, 2, 74), (4, 4, 76), (8, 2, 74), (10, 2, 71), (12, 4, 74)],
    [(0, 2, 76), (2, 2, 76), (4, 4, 78), (8, 2, 76), (10, 2, 73), (12, 4, 76)],
    [(0, 2, 78), (2, 2, 78), (4, 4, 79), (8, 2, 78), (10, 2, 74), (12, 4, 78)],
    [(0, 4, 76), (4, 4, 78), (8, 4, 79)],
]
MEL_CH = [
    [(0, 2, 71), (2, 2, 74), (4, 3, 79), (7, 1, 78), (8, 4, 74), (12, 2, 71), (14, 2, 74)],
    [(0, 2, 73), (2, 2, 76), (4, 3, 81), (7, 1, 79), (8, 4, 76), (12, 2, 73), (14, 2, 69)],
    [(0, 2, 73), (2, 2, 76), (4, 4, 78), (8, 2, 76), (10, 2, 73), (12, 4, 69)],
    [(0, 2, 71), (2, 2, 74), (4, 4, 78), (8, 2, 74), (10, 2, 71), (12, 4, 74)],
    [(0, 2, 71), (2, 2, 74), (4, 3, 79), (7, 1, 78), (8, 4, 74), (12, 4, 71)],
    [(0, 2, 73), (2, 2, 76), (4, 3, 81), (7, 1, 79), (8, 4, 76), (12, 2, 73), (14, 2, 76)],
    [(0, 4, 78), (4, 4, 74), (8, 4, 81), (12, 4, 78)],
    [(0, 8, 74)],
]
MEL_OUT = [MEL_CH[0], MEL_CH[1], MEL_CH[6], [(0, 16, 74)]]
INTER_PAT = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 2, 3]


# ───────── 部品 ─────────
def fft_filter(x, kind, fc, order=2):
    """なめらかな Butterworth 風の特性を周波数側で掛ける（零位相）。"""
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1.0 / SR)
    r = np.maximum(f, 1e-6) / fc
    if kind == 'hp':
        H = 1.0 / np.sqrt(1.0 + (1.0 / r) ** (2 * order))
    else:
        H = 1.0 / np.sqrt(1.0 + r ** (2 * order))
    return np.fft.irfft(X * H, n)


def env(n, gate, a=0.006, d=0.15, s=0.8, rel=0.06):
    t = np.arange(n) / SR
    e = np.minimum(t / a, 1.0) * (s + (1.0 - s) * np.exp(-t / d))
    r = np.clip(1.0 - (t - gate) / rel, 0.0, 1.0)
    return e * r


def saw_voice(freq_t, nh, detunes, power=1.0):
    fmax = float(np.max(freq_t))
    nh = max(1, min(nh, int(0.45 * SR / fmax)))
    out = np.zeros(len(freq_t))
    for d in detunes:
        ph = 2 * np.pi * np.cumsum(freq_t * 2.0 ** (d / 1200.0)) / SR
        for k in range(1, nh + 1):
            out += np.sin(k * ph) / k ** power
    return out / len(detunes) * (2 / np.pi)


def pan_lr(x, pan):
    a = (pan + 1.0) * np.pi / 4
    return x * np.cos(a), x * np.sin(a)


class Track:
    def __init__(self, total):
        self.L = np.zeros(total)
        self.R = np.zeros(total)

    def add(self, x, t, gain=1.0, pan=0.0):
        i = int(round(t * SR))
        if i >= len(self.L):
            return
        n = min(len(x), len(self.L) - i)
        l, r = pan_lr(x[:n] * gain, pan)
        self.L[i:i + n] += l
        self.R[i:i + n] += r


# ───────── 楽器 ─────────
def lead_note(m, dur, kind='bright', vib=True):
    gate = dur * 0.94
    n = int((gate + 0.08) * SR)
    t = np.arange(n) / SR
    f = mf(m) * np.ones(n)
    if vib and dur > 0.28:
        ramp = np.clip((t - 0.18) / 0.2, 0, 1)
        f = f * (1.0 + 0.004 * ramp * np.sin(2 * np.pi * 5.6 * t))
    if kind == 'bright':
        x = saw_voice(f, 18, (-9, 0, 9), 1.0)
        e = env(n, gate, 0.006, 0.2, 0.85, 0.07)
    elif kind == 'soft':
        x = saw_voice(f, 9, (-5, 5), 1.15)
        e = env(n, gate, 0.012, 0.15, 0.8, 0.07)
    else:  # run（間奏の速い連打）
        x = saw_voice(f, 14, (-8, 8), 1.0)
        e = env(n, gate, 0.003, 0.08, 0.7, 0.03)
    return x * e


def pluck_note(m, dur=0.26):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = mf(m) * np.ones(n)
    x = saw_voice(f, 10, (-6, 6), 1.1)
    return x * np.exp(-t / 0.11) * np.minimum(t / 0.002, 1.0)


def bass_note(m, dur):
    gate = dur * 0.86
    n = int((gate + 0.03) * SR)
    t = np.arange(n) / SR
    f = mf(m) * np.ones(n)
    x = saw_voice(f, 9, (0,), 1.3) * 0.8
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.75
    return (x + sub) * env(n, gate, 0.003, 0.12, 0.8, 0.025)


def pad_chord(notes, dur):
    n = int((dur + 0.2) * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for m in notes:
        f = mf(m) * np.ones(n)
        out += saw_voice(f, 6, (-12, 0, 12), 1.4)
    e = np.minimum(t / 0.04, 1.0) * np.clip(1.0 - (t - dur) / 0.2, 0, 1)
    return out / len(notes) * e


def make_kick():
    n = int(0.36 * SR)
    t = np.arange(n) / SR
    f = 46 + 120 * np.exp(-t / 0.035)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.14)
    click = fft_filter(rng.standard_normal(n), 'hp', 2500) * np.exp(-t / 0.004) * 0.25
    return np.tanh((body + click) * 1.6) / 1.2


def make_snare(vel=1.0):
    n = int(0.26 * SR)
    t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.055) * 0.55
    nz = fft_filter(rng.standard_normal(n), 'hp', 1400) * np.exp(-t / 0.075)
    return (tone + nz * 0.9) * vel


def make_clap():
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    nz = fft_filter(fft_filter(rng.standard_normal(n), 'hp', 900), 'lp', 5500)
    e = np.zeros(n)
    for k, d in enumerate((0.0, 0.011, 0.022)):
        i = int(d * SR)
        e[i:] += np.exp(-np.arange(n - i) / SR / 0.006) * 0.7
    e += np.exp(-t / 0.07) * 0.6
    return nz * e * 0.9


def make_hat(open_=False):
    ln = 0.30 if open_ else 0.07
    n = int(ln * SR)
    t = np.arange(n) / SR
    nz = fft_filter(rng.standard_normal(n), 'hp', 7500)
    return nz * np.exp(-t / (0.09 if open_ else 0.016))


def make_crash():
    n = int(2.6 * SR)
    t = np.arange(n) / SR
    nz = fft_filter(rng.standard_normal(n), 'hp', 4500)
    return nz * np.exp(-t / 0.7) * np.minimum(t / 0.002, 1.0)


def make_riser(dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    k = t / dur
    nz = fft_filter(rng.standard_normal(n), 'hp', 2500) * k ** 2.0
    f = 180.0 * (14.0 ** k)
    sweep = np.sin(2 * np.pi * np.cumsum(f) / SR) * k ** 2.5 * 0.25
    return (nz * 0.8 + sweep) * np.clip((dur - t) / 0.01, 0, 1)


# ───────── 全体を組み立てる ─────────
def build():
    secs = [
        ('intro', P_INTRO), ('A', P_A), ('B', P_B), ('chorus', P_CH), ('interlude', P_INTER),
        ('A2', P_A), ('B2', P_B), ('chorus2', P_CH), ('big', P_CH), ('outro', P_OUT),
    ]
    nbars = sum(len(p) for _, p in secs)
    total_s = nbars * BAR + 3.0
    N = int(total_s * SR)

    drums, bass, pad, arp, lead = (Track(N) for _ in range(5))
    kick_times = []
    sections_out = []
    notes_out = []

    kick = make_kick()
    snares = [make_snare() for _ in range(4)]
    claps = [make_clap() for _ in range(3)]
    hats = [make_hat() for _ in range(6)]
    ohats = [make_hat(True) for _ in range(3)]
    crash = make_crash()

    def dk(t, g=1.0):
        drums.add(kick, t, 0.95 * g)
        kick_times.append(t)

    def dsn(t, g=1.0, clap=True):
        drums.add(snares[int(rng.integers(4))], t, 0.55 * g, 0.0)
        if clap:
            drums.add(claps[int(rng.integers(3))], t, 0.35 * g, 0.1)

    def dh(t, g=1.0, op=False):
        if op:
            drums.add(ohats[int(rng.integers(3))], t, 0.22 * g, 0.25)
        else:
            drums.add(hats[int(rng.integers(6))], t, 0.16 * g, 0.25)

    bar_i = 0
    for name, prog in secs:
        shift = 2 if name == 'big' else 0
        sec_t = bar_i * BAR
        sections_out.append({'name': name, 'start': round(sec_t, 4), 'bars': len(prog), 'shift': shift})
        nb = len(prog)
        for bi, cname in enumerate(prog):
            t0 = (bar_i + bi) * BAR
            bs, tri = CH[cname]
            bs += shift
            tri = tuple(x + shift for x in tri)
            last = bi == nb - 1

            # ─ ドラム ─
            P = lambda p: t0 + p * S16  # noqa: E731
            full = name in ('chorus', 'chorus2', 'big', 'interlude') or (name == 'outro' and bi < 3)
            if name == 'intro':
                for p in range(0, 16, 2):
                    dh(P(p), 0.6 if bi < 2 else 0.8)
                if bi >= 2:
                    for p in (0, 4, 8, 12):
                        dk(P(p), 0.9)
                if bi == 3:
                    for k, p in enumerate((12, 13, 14, 15)):
                        dsn(P(p), 0.5 + 0.15 * k, clap=False)
            elif name in ('A', 'A2'):
                kicks = (0, 4, 8, 12) if not last else (0, 4, 8)
                for p in kicks:
                    dk(P(p))
                for p in ((4, 12) if not last else (4,)):
                    dsn(P(p), 0.85, clap=False)
                step = 2 if name == 'A' else 1
                for p in range(0, 16, step):
                    dh(P(p), 1.0 if p % 4 == 0 else 0.6)
                if last:
                    for k, p in enumerate((12, 13, 14, 15)):
                        dsn(P(p), 0.55 + 0.15 * k, clap=False)
            elif name in ('B', 'B2'):
                for p in (0, 4, 8, 12):
                    dk(P(p), 0.95)
                for p in range(0, 16):
                    dh(P(p), 0.9 if p % 4 == 0 else 0.5)
                if bi < 2:
                    for p in (4, 12):
                        dsn(P(p), 0.85)
                elif bi == 2:
                    for p in range(0, 16, 2):
                        dsn(P(p), 0.55 + 0.03 * p, clap=False)
                else:
                    for p in range(16):
                        dsn(P(p), 0.4 + 0.04 * p, clap=False)
                    drums.add(make_riser(BAR), t0, 0.5, 0.0)
            elif full:
                for p in (0, 4, 8, 12):
                    dk(P(p))
                if name in ('big', 'chorus2') and bi % 2 == 1:
                    dk(P(14), 0.8)
                for p in (4, 12):
                    dsn(P(p), 1.0)
                for p in range(16):
                    if p % 4 == 2:
                        dh(P(p), 0.9, op=True)
                    else:
                        dh(P(p), 1.0 if p % 4 == 0 else 0.5)
                if bi == 0 and name in ('chorus', 'chorus2', 'big', 'interlude'):
                    drums.add(crash, t0, 0.28, 0.1)
                if name == 'big' and bi == 4:
                    drums.add(crash, t0, 0.22, -0.1)
                if last and name != 'outro':
                    for k, p in enumerate((12, 13, 14, 15)):
                        dsn(P(p), 0.6 + 0.12 * k, clap=False)
            elif name == 'outro':  # 最後の 1 小節
                dk(P(0), 1.0)
                drums.add(crash, t0, 0.4, 0.0)

            # ─ ベース ─
            if name == 'intro' and bi < 2:
                pass
            elif name == 'outro' and bi == 3:
                bass.add(bass_note(bs, 2 * BEAT), t0, 0.9)
            else:
                for p in range(0, 16, 2):
                    oct_up = name in ('chorus', 'chorus2', 'big', 'interlude') and p in (6, 14)
                    bass.add(bass_note(bs + (12 if oct_up else 0), 2 * S16), P(p), 0.8)

            # ─ パッド ─
            padg = 0.22 if name == 'big' else 0.17
            if not (name == 'outro' and bi == 3):
                pad.add(pad_chord(tri, BAR), t0, padg, 0.0)
            else:
                pad.add(pad_chord(tri, 2.6 * BEAT), t0, padg, 0.0)

            # ─ アルペジオ（ぷにっとした音） ─
            if name in ('intro', 'outro', 'B', 'B2', 'chorus', 'chorus2', 'big'):
                g = 0.5 if name in ('intro', 'outro') else 0.22
                ext = [tri[0] + 12, tri[1] + 12, tri[2] + 12, tri[0] + 24, tri[1] + 24, tri[2] + 24]
                pat = (0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 4, 3, 2, 1, 2)
                if not (name == 'outro' and bi == 3):
                    for p in range(16):
                        arp.add(pluck_note(ext[pat[p]]), P(p), g, -0.35 if p % 2 == 0 else 0.35)

            # ─ リード（旋律） ─
            mel = None
            kind = 'bright'
            if name in ('A', 'A2'):
                mel, kind = MEL_A[bi], 'soft'
            elif name in ('B', 'B2'):
                mel = MEL_B[bi]
            elif name in ('chorus', 'chorus2', 'big'):
                mel = MEL_CH[bi]
            elif name == 'outro':
                mel = MEL_OUT[bi]
            if mel:
                for pos, ln, m in mel:
                    m2 = m + shift
                    d = ln * S16
                    g = 0.34 if kind == 'bright' else 0.30
                    lead.add(lead_note(m2, d, kind), P(pos), g, 0.0)
                    if name in ('chorus', 'chorus2', 'big'):
                        lead.add(lead_note(m2 - 12, d, 'soft', vib=False), P(pos), 0.16, -0.15)
                    if name == 'big':
                        lead.add(lead_note(m2 + 12, d, 'soft', vib=False), P(pos), 0.14, 0.15)
                    if name == 'outro' and bi == 3:
                        pass
                    notes_out.append({'sec': name, 'bar': bar_i + bi, 't': round(P(pos), 4),
                                      'dur': round(d, 4), 'midi': m2, 'kind': 'melody'})
            if name == 'interlude':
                ext = [tri[0] + 12, tri[1] + 12, tri[2] + 12, tri[0] + 24, tri[1] + 24]
                for p in range(16):
                    m = ext[INTER_PAT[p]]
                    lead.add(lead_note(m, S16, 'run', vib=False), P(p), 0.28, 0.0)
                    notes_out.append({'sec': name, 'bar': bar_i + bi, 't': round(P(p), 4),
                                      'dur': round(S16, 4), 'midi': m, 'kind': 'run'})
        bar_i += nb

    # ─ サイドチェイン（キックのたびに、ベース・パッド・アルペジオが引っこむ） ─
    sc = np.ones(N)
    for kt in kick_times:
        i = int(kt * SR)
        L = min(int(0.30 * SR), N - i)
        if L <= 0:
            continue
        t = np.arange(L) / SR
        seg = 1.0 - 0.62 * np.exp(-t / 0.11) * np.minimum(t / 0.0015, 1.0)
        sc[i:i + L] = np.minimum(sc[i:i + L], seg)
    for tr, depth in ((bass, 1.0), (pad, 1.0), (arp, 0.5)):
        g = 1.0 - (1.0 - sc) * depth
        tr.L *= g
        tr.R *= g

    # ─ 空間（リバーブ・エコー） ─
    def reverb(tr_list, amount):
        ir_n = int(1.3 * SR)
        t = np.arange(ir_n) / SR
        irs = []
        for _ in range(2):
            ir = rng.standard_normal(ir_n) * np.exp(-t / 0.30)
            ir = fft_filter(ir, 'lp', 5500, 1)
            ir[:int(0.012 * SR)] = 0
            ir /= np.sqrt(np.sum(ir ** 2))
            irs.append(ir)
        outs = []
        for ch, ir in zip(('L', 'R'), irs):
            x = sum(getattr(tr, ch) * a for tr, a in tr_list)
            n = len(x) + ir_n - 1
            nf = 1 << (n - 1).bit_length()
            y = np.fft.irfft(np.fft.rfft(x, nf) * np.fft.rfft(ir, nf), nf)[:len(x)]
            outs.append(y * amount)
        return outs

    rvL, rvR = reverb([(lead, 1.0), (arp, 0.7), (pad, 0.5)], 0.12)

    ed = int(round(3 * S16 * SR))
    echoL = np.zeros(N)
    echoR = np.zeros(N)
    srcL = lead.L * 0.5 + arp.L * 0.25
    srcR = lead.R * 0.5 + arp.R * 0.25
    for k in range(1, 4):
        sh = ed * k
        g = 0.38 ** k
        if k % 2 == 1:
            echoL[sh:] += srcR[:N - sh] * g
            echoR[sh:] += srcL[:N - sh] * g
        else:
            echoL[sh:] += srcL[:N - sh] * g
            echoR[sh:] += srcR[:N - sh] * g

    # 各パートの音量（サビの区間で測った RMS が、ドラム -17・リード -17・ベース -20・パッド/アルペジオ -26 dB くらいになる値）
    G = {'drums': 0.55, 'bass': 0.28, 'pad': 3.2, 'arp': 1.6, 'lead': 1.7}
    mixL = (drums.L * G['drums'] + bass.L * G['bass'] + pad.L * G['pad'] + arp.L * G['arp']
            + lead.L * G['lead'] + (rvL + echoL * 0.55) * 1.7)
    mixR = (drums.R * G['drums'] + bass.R * G['bass'] + pad.R * G['pad'] + arp.R * G['arp']
            + lead.R * G['lead'] + (rvR + echoR * 0.55) * 1.7)
    stems = {'drums': drums, 'bass': bass, 'pad': pad, 'arp': arp, 'lead': lead}

    # ─ マスター ─
    out = np.stack([mixL, mixR])
    out = np.stack([fft_filter(c, 'hp', 28, 2) for c in out])
    out = np.tanh(out * 0.9) / np.tanh(0.9)
    peak = np.max(np.abs(out))
    out = out / peak * 0.89
    # 終わりの余韻を切る
    end = int((nbars * BAR + 2.6) * SR)
    out = out[:, :end]
    fade = int(0.4 * SR)
    out[:, -fade:] *= np.linspace(1, 0, fade)
    info = {
        'title': 'ハイテンポ・ポップ (仮)', 'bpm': BPM, 'beat': round(BEAT, 6), 'bar': round(BAR, 6),
        'key': 'D major (サビは +2 半音)', 'bars': nbars, 'duration': round(out.shape[1] / SR, 3),
        'sections': sections_out, 'notes': notes_out,
        'kicks': [round(k, 4) for k in kick_times],
    }
    return out, info, stems


def write_wav(path, out):
    pcm = np.clip(out.T * 32767.0, -32768, 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main():
    outdir = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(outdir, exist_ok=True)
    out, info, _ = build()
    wav = os.path.join(outdir, 'song_pop1.wav')
    write_wav(wav, out)
    with open(os.path.join(outdir, 'song_pop1.json'), 'w', encoding='utf-8') as f:
        json.dump(info, f, ensure_ascii=False)
    try:
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame',
                        '-b:a', '192k', os.path.join(outdir, 'song_pop1.mp3')], check=True)
    except Exception as e:  # noqa: BLE001
        print('mp3 にできなかった:', e)
    print('done', info['duration'], 's', info['bars'], 'bars', len(info['notes']), 'notes')


if __name__ == '__main__':
    main()
