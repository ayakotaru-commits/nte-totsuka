#!/usr/bin/env python3
"""フェアリー・リールパーク用のオリジナル曲 2 つを、numpy だけで合成して WAV (と mp3) にする。

  python tools/music/park_theme.py <出力フォルダ> [--mp3 <mp3 を置くフォルダ>]
    -> park_theme.wav  ほしぞらワルツ (3/4・BPM 104・ハ長調。40 小節 = 約 69 秒。オルゴール・ベル・やわらかいパッド)。園内にずっと流れる曲
    -> park_parade.wav パレードのマーチ (4/4・BPM 116・ト長調。34 小節 = 約 70 秒。ブラス風・グロッケン・ドラム)。パレードの山車のそばで流れる曲
    -> park_music.json (長さ・テンポ・小節数。確認用)

どちらも頭と終わりがつながる (ループ再生用: 残響の尾を頭に重ねて、切れ目の無い長さに切る)。
旋律・和音・リズムはこのファイルの中の数字だけで決める (決まった乱数。何度実行しても同じ)。既存の曲とは無関係に書いた。
私 (作った側) は音を聞けない。確認したのは、テンポ・音量・音割れ・ループの継ぎ目・周波数の分布だけ。聞いて決める部分は持ち主に頼む。
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np

SR = 44100


# ------------------------------------------------------------------ 道具
def note_hz(n):  # n = MIDI 番号 (60 = 中央のド)
    return 440.0 * 2 ** ((n - 69) / 12)


def env_ad(n, a, d, floor=0.0):
    """立ち上がり a 秒・指数の減衰 (時定数 d 秒)"""
    t = np.arange(n) / SR
    e = np.exp(-t / d)
    if a > 0:
        e = e * np.minimum(1.0, t / a)
    return np.maximum(e, floor)


def lowpass(x, fc, order=2):
    """FFT の滑らかなローパス (1 / (1 + (f/fc)^2n))"""
    n = len(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    h = 1.0 / np.sqrt(1.0 + (f / fc) ** (2 * order))
    return np.fft.irfft(np.fft.rfft(x) * h, n)


def highpass(x, fc, order=2):
    n = len(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    h = 1.0 - 1.0 / np.sqrt(1.0 + (f / fc) ** (2 * order))
    return np.fft.irfft(np.fft.rfft(x) * h, n)


class Mix:
    def __init__(self, seconds):
        self.n = int(seconds * SR)
        self.L = np.zeros(self.n)
        self.R = np.zeros(self.n)

    def add(self, t, sig, vol=1.0, pan=0.0, send=0.0):
        i = int(t * SR)
        if i >= self.n:
            return
        j = min(self.n, i + len(sig))
        s = sig[: j - i]
        gl = vol * np.cos((pan + 1) * np.pi / 4)
        gr = vol * np.sin((pan + 1) * np.pi / 4)
        self.L[i:j] += s * gl
        self.R[i:j] += s * gr


def bell(hz, dur, bright=1.0, decay=1.1):
    """オルゴール・ベル。倍音は 1・2.0・3.0・4.2 (少しだけ非整数)、立ち上がりが速く、高い倍音ほど早く消える"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for k, (m, a, d) in enumerate([(1.0, 1.0, decay), (2.0, 0.6 * bright, decay * 0.6), (3.01, 0.32 * bright, decay * 0.45), (4.2, 0.2 * bright, decay * 0.3)]):
        s += a * np.sin(2 * np.pi * hz * m * t) * np.exp(-t / d)
    return s * np.minimum(1.0, t / 0.004)


def pad(hz, dur, detune=0.004):
    """やわらかいパッド: 3 つの少しずれたのこぎり波をローパス、ゆっくり立ち上がる"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for d in (-detune, 0.0, detune):
        f = hz * (1 + d)
        s += 2 * ((f * t) % 1.0) - 1
    s = lowpass(s / 3, min(1800.0, hz * 6))
    e = np.minimum(1.0, t / 0.35) * np.minimum(1.0, (dur - t) / 0.4)
    return s * np.maximum(e, 0)


def pluck(hz, dur, tone=0.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * hz * t) + tone * 0.5 * np.sin(2 * np.pi * hz * 2 * t) * np.exp(-t / 0.15)
    return s * np.exp(-t / (dur * 0.45)) * np.minimum(1.0, t / 0.006)


def brass(hz, dur, vel=1.0):
    """ブラス風: のこぎり + 矩形をローパス。ローパスの位置が立ち上がりで開く (簡易)"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = (2 * ((hz * t) % 1.0) - 1) * 0.7 + np.sign(np.sin(2 * np.pi * hz * t)) * 0.3
    bright = lowpass(s, min(5000.0, hz * 9))
    dull = lowpass(s, min(1400.0, hz * 3))
    k = np.minimum(1.0, t / 0.09)
    s = dull * (1 - k) + bright * k
    e = np.minimum(1.0, t / 0.025) * np.minimum(1.0, np.maximum(0, (dur - t)) / 0.05)
    return s * e * (0.6 + 0.4 * vel)


def kick(dur=0.28):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 50 + 90 * np.exp(-t / 0.03)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t / 0.09)


def snare(rng, dur=0.22):
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = highpass(rng.standard_normal(n), 1500) * np.exp(-t / 0.05)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.04) * 0.5
    return (noise + tone) * 0.8


def hat(rng, dur=0.06, open_=False):
    n = int((0.3 if open_ else dur) * SR)
    t = np.arange(n) / SR
    return highpass(rng.standard_normal(n), 6500) * np.exp(-t / (0.12 if open_ else 0.018))


def shaker(rng, dur=0.12):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return highpass(rng.standard_normal(n), 4000) * np.exp(-t / 0.035) * np.minimum(1.0, t / 0.01)


def crash(rng, dur=1.8):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return highpass(rng.standard_normal(n), 3000) * np.exp(-t / 0.55)


def reverb(L, R, rng, seconds=1.7, wet=0.22, damp=3500.0):
    """畳み込み残響: 指数で減衰する雑音 (ローパス) を、FFT でかける。左右で別の雑音"""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = []
    for x in (L, R):
        ir = lowpass(rng.standard_normal(n), damp, 1) * np.exp(-t / (seconds / 5.0))
        ir[0] = 0
        ir = ir / np.sqrt(np.sum(ir * ir))
        N = 1
        while N < len(x) + n:
            N *= 2
        y = np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[: len(x) + n]
        out.append(y)
    return out  # 尾つき (長さ len + n)


def finish(mix, rng, wet, seconds, damp, loop_len, peak=0.89):
    """残響を足して、尾を頭へ重ね (ループ用)、loop_len 秒に切って、音量をそろえる"""
    rl, rr = reverb(mix.L, mix.R, rng, seconds, damp=damp)
    n = len(rl)
    L = np.zeros(n)
    R = np.zeros(n)
    L[: len(mix.L)] += mix.L * (1 - wet * 0.5)
    R[: len(mix.R)] += mix.R * (1 - wet * 0.5)
    L += rl * wet
    R += rr * wet
    ln = int(loop_len * SR)
    # 尾 (ln 以降) を頭へ重ねる
    tail_l, tail_r = L[ln:], R[ln:]
    L, R = L[:ln].copy(), R[:ln].copy()
    L[: len(tail_l)] += tail_l[: ln]
    R[: len(tail_r)] += tail_r[: ln]
    st = np.stack([L, R], 1)
    st = st - st.mean(0)
    # 音量: RMS を -17 dBFS にそろえてから、やわらかいリミッター (tanh) で山を丸める。ピークは 0.95 以下
    rms = np.sqrt(np.mean(st ** 2))
    st = st * (10 ** (-17 / 20) / rms)
    st = np.tanh(st * 1.3) / 1.3
    st = st / max(1.0, np.max(np.abs(st)) / 0.95)
    return st


def write_wav(path, st):
    pcm = (np.clip(st, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# ------------------------------------------------------------------ 旋律 (コード音に寄せて、なめらかに歩く)
MAJOR = [0, 2, 4, 5, 7, 9, 11]


def scale_notes(tonic, lo, hi):
    out = []
    for n in range(lo, hi + 1):
        if (n - tonic) % 12 in MAJOR:
            out.append(n)
    return out


def walk(rng, notes, chord_pcs, start, target, steps, tonic, strong):
    """notes = 使える音 (音階)。strong[i] = その音が強拍か。強拍はコードの音へ、弱拍は音階の隣へ。target へゆるやかに向かう"""
    out = []
    cur = start
    idx = {n: i for i, n in enumerate(notes)}
    for k in range(steps):
        ci = idx[cur]
        want = 1 if target > cur else -1 if target < cur else 0
        r = rng.random()
        step = want if r < 0.6 else (-want if r < 0.75 else (1 if rng.random() < 0.5 else -1))
        if rng.random() < 0.18:
            step *= 2
        ni = int(np.clip(ci + step, 0, len(notes) - 1))
        n = notes[ni]
        if strong[k]:
            # コードの音のうち、いちばん近いもの
            cands = [m for m in notes if (m - tonic) % 12 in chord_pcs]
            n = min(cands, key=lambda m: abs(m - n) + (0.4 if m == cur else 0))
        out.append(n)
        cur = n
    return out


# ------------------------------------------------------------------ 曲 1: ほしぞらワルツ
def make_theme():
    rng = np.random.default_rng(20261125)
    BPM = 104
    BEAT = 60.0 / BPM
    BAR = BEAT * 3
    C = {"C": [0, 4, 7], "Am": [9, 0, 4], "F": [5, 9, 0], "G": [7, 11, 2], "Em": [4, 7, 11], "Dm": [2, 5, 9], "C/E": [0, 4, 7]}
    ROOT = {"C": 48, "Am": 45, "F": 41, "G": 43, "Em": 40, "Dm": 38, "C/E": 40}
    A1 = ["C", "Am", "F", "G", "C", "Em", "F", "G"]
    A2 = ["C", "Am", "F", "G", "C", "F", "G", "C"]
    Bp = ["F", "G", "Em", "Am", "F", "G", "C/E", "G"]
    A3 = ["C", "Am", "F", "G", "C", "F", "G", "C"]
    INTRO = ["C", "G", "Am", "F"]
    prog = INTRO + A1 + A2 + Bp + A3 + ["F", "G", "Am", "G"]  # 4+8+8+8+8+4 = 40 小節
    bars = len(prog)
    total = bars * BAR
    mix = Mix(total + 4.0)
    notes = scale_notes(60, 67, 86)  # 旋律の音域 (G4〜D6)
    rhy = [[1.5, 0.5, 1.0], [1.0, 1.0, 1.0], [2.0, 1.0], [0.5, 0.5, 1.0, 1.0], [1.0, 0.5, 0.5, 1.0], [3.0]]
    # セクションごとに、旋律の「山」(目標の高さ) を決める
    sect = [("intro", 0, 4), ("A", 4, 12), ("A2", 12, 20), ("B", 20, 28), ("A3", 28, 36), ("out", 36, 40)]
    cur = 72
    melody = []  # (時刻 s, 音, 長さ s)
    for name, b0, b1 in sect:
        for b in range(b0, b1):
            ch = prog[b]
            # 目標: 4 小節の頭で高く、終わりで低く
            ph = (b - b0) % 4
            hi = {"intro": 76, "A": 79, "A2": 79, "B": 83, "A3": 79, "out": 76}[name]
            target = hi - (2 if ph in (1, 3) else 0) - (3 if (b - b0) % 8 == 7 else 0)
            if name == "intro":
                continue  # イントロはアルペジオだけ
            if name == "out":
                pat = [3.0] if b == 39 else [1.0, 1.0, 1.0]
            else:
                pat = rhy[int(rng.integers(0, len(rhy)))] if ph != 3 else ([2.0, 1.0] if rng.random() < 0.6 else [1.0, 0.5, 0.5, 1.0])
                if ph == 0 and (b - b0) % 8 == 0 and name != "B":
                    pat = [1.5, 0.5, 1.0]
            strong = [True if i == 0 else (acc_ % 3 == 0) for i, acc_ in enumerate(np.cumsum([0] + pat[:-1]))]
            ns = walk(rng, notes, C[ch], cur, target, len(pat), 60, strong)
            t = b * BAR
            acc = 0.0
            for d, n in zip(pat, ns):
                melody.append((t + acc * BEAT, n, d * BEAT))
                acc += d
            cur = ns[-1]
    # 旋律: オルゴール (2 回目以降は 1 オクターブ上のベルを重ねる)
    for t, n, d in melody:
        sig = bell(note_hz(n), min(2.6, d + 1.4), 1.0, 1.0)
        bar = int(t / BAR)
        mix.add(t, sig, 0.32, pan=0.15)
        if bar >= 12:
            mix.add(t + 0.01, bell(note_hz(n + 12), 1.6, 0.8, 0.7), 0.10, pan=-0.3)
        if 20 <= bar < 28:  # B はハーモニー (3 度下)
            mix.add(t, bell(note_hz(n - 4 if (n - 4) % 12 in MAJOR else n - 3), min(2.0, d + 1.0), 0.8, 0.9), 0.13, pan=-0.2)
    # 伴奏: 1 拍目 = ベース、2・3 拍目 = 和音のはじき (ワルツ)。パッドは小節ごと
    for b, ch in enumerate(prog):
        t0 = b * BAR
        r = ROOT[ch]
        mix.add(t0, pluck(note_hz(r), BEAT * 1.6, 0.4), 0.30, pan=0.0)
        pcs = C[ch]
        voic = [60 + ((p - 60) % 12) for p in pcs]
        voic = [v if v >= 59 else v + 12 for v in voic]
        for beat in (1, 2):
            for k, v in enumerate(sorted(voic)):
                mix.add(t0 + beat * BEAT + k * 0.012, pluck(note_hz(v), BEAT * 0.9, 0.2), 0.075, pan=-0.2 + 0.2 * k)
        if b >= 4:
            for k, v in enumerate(sorted(voic)):
                mix.add(t0, pad(note_hz(v - 12 + 12), BAR + 0.5), 0.06, pan=-0.4 + 0.4 * k)
        mix.add(t0 + BEAT * 0.5, shaker(rng), 0.05, pan=0.3)
        mix.add(t0 + BEAT * 1.5, shaker(rng), 0.035, pan=-0.3)
        mix.add(t0 + BEAT * 2.5, shaker(rng), 0.035, pan=0.3)
    # イントロ・終わりのアルペジオ (きらきらと上る)
    for b in list(range(0, 4)) + list(range(36, 40)):
        ch = prog[b]
        pcs = sorted([60 + ((p - 60) % 12) + 12 for p in C[ch]])
        arp = pcs + [pcs[1] + 12, pcs[2] + 12, pcs[0] + 24]
        for k in range(6):
            mix.add(b * BAR + k * BEAT / 2, bell(note_hz(arp[k]), 1.8, 1.0, 0.9), 0.17 if b < 4 else 0.13, pan=-0.5 + 0.2 * k)
    st = finish(mix, rng, wet=0.30, seconds=2.0, damp=4200.0, loop_len=total)
    return st, dict(bpm=BPM, bars=bars, beats_per_bar=3, seconds=total, bar_seconds=BAR)


# ------------------------------------------------------------------ 曲 2: パレードのマーチ
def make_parade():
    rng = np.random.default_rng(20261126)
    BPM = 116
    BEAT = 60.0 / BPM
    BAR = BEAT * 4
    C = {"G": [7, 11, 2], "C": [0, 4, 7], "D": [2, 6, 9], "Em": [4, 7, 11], "Am": [9, 0, 4], "D7": [2, 6, 9, 0], "Bm": [11, 2, 6]}
    ROOT = {"G": 43, "C": 48, "D": 50, "Em": 40, "Am": 45, "D7": 50, "Bm": 47}
    INTRO = ["D", "D7"]
    A = ["G", "C", "D", "G", "G", "C", "D", "G"]
    B = ["Em", "Am", "D", "G", "Em", "C", "D", "D7"]
    prog = INTRO + A + A + B + A + A[:7] + ["G"]
    # 2 + 8 + 8 + 8 + 8 + 8 = 42 小節 (= 約 87 秒)。長いので 34 小節にそろえる: 最後の A を半分に
    prog = INTRO + A + A + B + A + ["G", "C", "D", "G"]  # 2 + 8 + 8 + 8 + 8 + 4 = 38 小節
    bars = len(prog)
    total = bars * BAR
    mix = Mix(total + 4.0)
    TON = 55  # ト (G3)
    notes = scale_notes(TON, 62, 86)
    # 旋律: 4 分と 8 分の組み合わせ (行進曲らしく、1・3 拍に強い音)
    rhy = [[1.0, 1.0, 1.0, 1.0], [1.5, 0.5, 1.0, 1.0], [1.0, 0.5, 0.5, 1.0, 1.0], [0.5, 0.5, 1.0, 0.5, 0.5, 1.0], [2.0, 1.0, 1.0], [1.0, 1.0, 2.0]]
    sect = [("intro", 0, 2), ("A", 2, 10), ("A", 10, 18), ("B", 18, 26), ("A", 26, 34), ("out", 34, 38)]
    cur = 74
    melody = []
    for name, b0, b1 in sect:
        for b in range(b0, b1):
            if name == "intro":
                continue
            ch = prog[b]
            ph = (b - b0) % 4
            hi = {"A": 79, "B": 83, "out": 79}[name]
            target = hi - (3 if ph in (1, 3) else 0) - (4 if (b - b0) % 8 == 7 else 0)
            pat = rhy[int(rng.integers(0, len(rhy)))] if ph != 3 else ([1.0, 1.0, 2.0] if rng.random() < 0.6 else [2.0, 2.0])
            if name == "out" and b == 37:
                pat = [4.0]
            if (b - b0) % 4 == 0:
                pat = [1.0, 0.5, 0.5, 1.0, 1.0]
            acc = list(np.cumsum([0] + pat[:-1]))
            strong = [(a_ % 2 == 0) for a_ in acc]
            ns = walk(rng, notes, C[ch], cur, target, len(pat), TON, strong)
            t = b * BAR
            a2 = 0.0
            for d, n in zip(pat, ns):
                melody.append((t + a2 * BEAT, n, d * BEAT))
                a2 += d
            cur = ns[-1]
    for t, n, d in melody:
        bar = int(t / BAR)
        vel = 1.0 if (t / BEAT) % 2 < 0.01 else 0.8
        mix.add(t, brass(note_hz(n), max(0.12, d * 0.92), vel), 0.20, pan=0.1)
        mix.add(t, bell(note_hz(n + 12), 0.9, 1.2, 0.35), 0.09, pan=-0.35)
        if 18 <= bar < 26:  # B: 3 度下の副旋律
            mix.add(t, brass(note_hz(n - 4 if (n - 4 - TON) % 12 in MAJOR else n - 3), max(0.12, d * 0.9), 0.7), 0.10, pan=-0.2)
    # 伴奏
    for b, ch in enumerate(prog):
        t0 = b * BAR
        r = ROOT[ch]
        fifth = r + 7
        # チューバ: 1 拍目 = 根音、3 拍目 = 5 度 (行進曲の「ブン・チャ」)
        mix.add(t0, pluck(note_hz(r), BEAT * 0.9, 0.3), 0.20)
        mix.add(t0 + 2 * BEAT, pluck(note_hz(fifth), BEAT * 0.9, 0.3), 0.17)
        # 2・4 拍目: 和音のスタッカート (ブラス)
        voic = sorted([60 + ((p - 60) % 12) for p in C[ch]])
        for beat in (1, 3):
            for k, v in enumerate(voic):
                mix.add(t0 + beat * BEAT, brass(note_hz(v), BEAT * 0.45, 0.6), 0.055, pan=-0.3 + 0.3 * k)
        # ドラム: キック 1・3、スネア 2・4 (4 小節目の終わりにロール)、ハット 8 分
        mix.add(t0, kick(), 0.30)
        mix.add(t0 + 2 * BEAT, kick(), 0.24)
        for beat in (1, 3):
            mix.add(t0 + beat * BEAT, snare(rng), 0.22, pan=0.1)
        for k in range(8):
            mix.add(t0 + k * BEAT / 2, hat(rng), 0.025 if k % 2 == 0 else 0.015, pan=0.4)
        if b >= 2 and (b - 2) % 4 == 3:  # ロール
            for k in range(6):
                mix.add(t0 + 3 * BEAT + k * BEAT / 6, snare(rng, 0.12), 0.16 + 0.03 * k, pan=0.1)
        if b in (2, 10, 18, 26, 34):
            mix.add(t0, crash(rng), 0.22)
    # イントロ: スネアのロールと和音
    for k in range(8):
        mix.add(k * BEAT / 2, snare(rng, 0.12), 0.14 + 0.02 * k, pan=0.1)
    st = finish(mix, rng, wet=0.14, seconds=1.2, damp=5000.0, loop_len=total)
    return st, dict(bpm=BPM, bars=bars, beats_per_bar=4, seconds=total, bar_seconds=BAR)


def analyze(name, st, info):
    L, R = st[:, 0], st[:, 1]
    rms = float(np.sqrt(np.mean(st ** 2)))
    peak = float(np.max(np.abs(st)))
    clip = int(np.sum(np.abs(st) >= 0.999))
    # ループの継ぎ目: 最後と最初のサンプルの差 (連続していれば小さい)
    seam = float(np.max(np.abs(st[-1] - st[0])))
    seam_step = float(np.mean(np.abs(np.diff(st[:2000], axis=0))))
    # 周波数の分布 (低・中・高の割合)
    sp = np.abs(np.fft.rfft(L)) ** 2
    f = np.fft.rfftfreq(len(L), 1 / SR)
    tot = sp.sum()
    bands = {"<200": sp[f < 200].sum() / tot, "200-2k": sp[(f >= 200) & (f < 2000)].sum() / tot, ">2k": sp[f >= 2000].sum() / tot}
    # 拍の周期 (1 拍ごとのエネルギーの自己相関でテンポを確かめる)
    env = np.abs(L)
    win = int(SR * 0.02)
    e = np.convolve(env, np.ones(win) / win, "same")[:: win // 2]
    e = e - e.mean()
    ac = np.correlate(e, e, "full")[len(e) - 1:]
    hop = (win // 2) / SR
    beat = 60.0 / info["bpm"]
    k0 = int(round(beat / hop))
    lag = beat
    info["beat_peak"] = round(float(ac[k0 - 1:k0 + 2].max() / ac[0]), 3)   # 拍の周期の自己相関 (1 に近いほど、拍がそろって鳴っている)
    info.update(rms_db=round(float(20 * np.log10(rms)), 1), peak=round(peak, 3), clipped=clip, seam=round(seam, 4), seam_step=round(seam_step, 4),
                bands={k: round(float(v), 3) for k, v in bands.items()}, samples=len(st))
    print(name, info)


def main():
    args = sys.argv[1:]
    mp3dir = None
    if "--mp3" in args:
        i = args.index("--mp3")
        mp3dir = args[i + 1]
        del args[i:i + 2]
    if not args:
        sys.exit(__doc__)
    out = args[0]
    os.makedirs(out, exist_ok=True)
    meta = {}
    for name, fn in (("park_theme", make_theme), ("park_parade", make_parade)):
        st, info = fn()
        analyze(name, st, info)
        path = os.path.join(out, name + ".wav")
        write_wav(path, st)
        meta[name] = info
        if mp3dir:
            os.makedirs(mp3dir, exist_ok=True)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-codec:a", "libmp3lame", "-b:a", "96k", "-ar", "44100", "-joint_stereo", "1", os.path.join(mp3dir, name + ".mp3")], check=True)
    with open(os.path.join(out, "park_music.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
