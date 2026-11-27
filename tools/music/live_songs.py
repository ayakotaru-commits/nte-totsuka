"""千葉ドリームランドのライブ会場 (サンライズ・ライブステージ) で流す、歌入りの曲を集める。

    python tools/music/live_songs.py                  # 取得 (無ければ) → 音量をそろえて軽い mp3 に → public/audio/live/ に書く
    python tools/music/live_songs.py --cache DIR      # 元の wav の置き場を指定 (既定 data/raw/live_songs/ = git に入れない)
    python tools/music/live_songs.py --list           # 曲の一覧だけ出す

出どころ (2 つ。どちらも商用・ゲームでの利用 OK。クレジットを出すこと。音源の 2 次配布・再配布は禁止):
  - フリーボーカルMusic【NeWorld】 https://music.freegame-contest.com/ (規約 /rule。「可能な範囲で」クレジット)
  - 独り音 https://hitorioto.com/ (規約 /terms/。クレジット「音楽：独り音」必須)
選び方 (2026-11-27): 両サイトの歌もの全曲 (NeWorld 45・独り音 42) から、(1) 雰囲気が明るい・ポップ・エモい・軽いロック、(2) 歌詞に暴力・飲酒・悪口などが無い
  (NeWorld は曲のページに歌詞があるので読んだ。独り音も同じ)、(3) 暗い・不気味・戦闘・短すぎる曲は外す、で 30 曲。既に音ゲーで使っている 4 曲 (public/arcade/) は含めない。
軽くする: 音量を -16 LUFS にそろえ (loudnorm)、44.1 kHz・ステレオ・80 kbps の mp3 (1 曲 約 2 MB。30 曲で 約 60 MB)。
曲の一覧 (曲名・歌い手・クレジット・長さ・雰囲気・エネルギー) は public/audio/live/songs.json。ライブの曲順 (セットリスト) はこの一覧から作る。
"""
import argparse
import glob
import html
import json
import os
import re
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "public", "audio", "live")
NW = "https://music.freegame-contest.com"
HT = "https://hitorioto.com"

# (site, id, 曲名, 雰囲気メモ)。id = NeWorld は投稿の番号、独り音はページの名前
SONGS = [
    ("nw", "602", "今日がちょっと好きになる", ["明るい"]),
    ("nw", "470", "キセキのカウントダウン", ["明るい"]),
    ("nw", "460", "虹色スパーク", ["明るい"]),
    ("nw", "493", "Color me ! Love me !", ["明るい", "恋・愛"]),
    ("nw", "500", "こんにちは、ふしぎさん", ["明るい", "オシャレ・エモい"]),
    ("nw", "514", "大人のColor Pop Days", ["明るい", "オシャレ・エモい", "恋・愛"]),
    ("nw", "376", "Step with you , Step to you", ["明るい", "オシャレ・エモい"]),
    ("nw", "363", "あなたが来る前に", ["明るい", "恋・愛"]),
    ("nw", "25", "にゃぞ", ["明るい"]),
    ("nw", "34", "フリーゲームワールド", ["明るい"]),
    ("nw", "43", "START BUTTON", ["明るい"]),
    ("nw", "806", "青春Re:Start", ["オシャレ・エモい"]),
    ("nw", "799", "Neon Sigh", ["オシャレ・エモい"]),
    ("nw", "702", "Spark Tonight", ["オシャレ・エモい", "恋・愛"]),
    ("nw", "640", "星影ラテ", ["オシャレ・エモい", "恋・愛"]),
    ("nw", "819", "With You", ["恋・愛"]),
    ("nw", "605", "ボクラのマップ", ["オシャレ・エモい"]),
    ("nw", "649", "ボクがボクを救う歌", ["オシャレ・エモい"]),
    ("nw", "524", "もういちど、はじめまして", ["恋・愛"]),
    ("nw", "634", "Rise Ignition", ["ロック"]),
    ("nw", "519", "君が泣いた分だけ、僕は立ち上がる", ["ロック"]),
    ("nw", "811", "泣き虫ヒーロー", ["ロック"]),
    ("ht", "soranomukou", "ソラノムコウ", ["爽やか", "明るい", "ポップ"]),
    ("ht", "vocal-13", "隣で唄った夏の歌を", ["爽やか", "明るい", "ポップ"]),
    ("ht", "vocal-14", "飛行線", ["爽やか", "明るい", "ポップ"]),
    ("ht", "vocal-16", "トラックメイカーと踊る", ["楽しい", "かっこいい", "エレクトロニカ"]),
    ("ht", "vocal-17", "東京シティビュー", ["穏やか", "オシャレ", "エレクトロニカ"]),
    ("ht", "gamusixyarara", "ガムシャララ", ["かっこいい", "明るい", "ロック"]),
    ("ht", "vocal-31", "人生きっと", ["明るい", "優しい", "ポップ"]),
    ("ht", "vocal-32", "ずっと好き", ["明るい", "優しい", "ポップ"]),
]


def curl(url, out=None, timeout=900):
    cmd = ["curl", "-sL", "-m", str(timeout)] + (["-o", out, "-w", "%{http_code} %{size_download}"] if out else []) + [url]
    r = subprocess.run(cmd, capture_output=True)
    return r.stdout.decode("utf-8", "ignore")


def page_text(s):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", s, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "\n", t))
    return re.sub(r"\n\s*\n+", "\n", t)


def energy(tags):
    """曲順を作るための目安 (3 = にぎやか・2 = ふつう・1 = ゆったり)。"""
    if any(t in tags for t in ("ロック", "楽しい", "かっこいい")) or ("明るい" in tags and "オシャレ・エモい" not in tags):
        return 3
    if any(t in tags for t in ("オシャレ・エモい", "オシャレ", "爽やか", "ポップ")):
        return 2
    return 1


def nw_meta(pid):
    """NeWorld の曲のページから、クレジット (作詞・作曲・歌など) とダウンロードのリンクを読む。"""
    import time
    for _ in range(4):   # 混んでいると、クレジットの欄が無いページが返ることがある。「作詞」か「歌」が見つかるまで取り直す
        s = curl(f"{NW}/archives/{pid}", timeout=60)
        t = page_text(s)
        a, b = t.find("事前にご確認ください"), t.find("ダウンロードはこちら")
        lines = [x.strip() for x in t[a:b].split("\n")[2:] if x.strip()] if 0 <= a < b else []
        credit = [x for x in lines if re.match(r"(企画|音楽|作詞|作曲|編曲|歌)", x)]
        if any(x.startswith(("作詞", "作曲", "歌")) for x in credit):
            break
        time.sleep(10)
    else:
        sys.exit(f"NeWorld {pid}: クレジット (作詞・作曲・歌) が読めない")
    m = re.search(r"href='(" + re.escape(NW) + r"/download/[^']*wpdmdl=\d+[^']*)'", s)
    return credit, html.unescape(m.group(1)) if m else None


def fetch_nw(pid, cache):
    wav = os.path.join(cache, f"nw{pid}.wav")
    credit, link = nw_meta(pid)
    if not (os.path.exists(wav) and os.path.getsize(wav) > 5e6):
        if not link:
            sys.exit(f"NeWorld {pid}: ダウンロードのリンクが見つからない")
        for _ in range(4):   # 混んでいるとエラーのページ (十数 KB) が返る。待って取り直す
            subprocess.run(["curl", "-sL", "-m", "900", "-o", wav, link])
            if os.path.getsize(wav) > 5e6:
                break
            import time; time.sleep(20)
            credit, link = nw_meta(pid)
        else:
            sys.exit(f"NeWorld {pid}: 取得できなかった")
    src = wav
    with open(wav, "rb") as f:
        if f.read(2) == b"PK":   # 古い曲は zip (フル・ショート・インストの m4a)。インストでもショートでもない「フル」を使う
            d = os.path.join(cache, f"nw{pid}_zip")
            if not os.path.isdir(d):
                os.makedirs(d)
                zipfile.ZipFile(wav).extractall(d)
            fs = [x for x in glob.glob(os.path.join(d, "**", "*.m4a"), recursive=True) if "__MACOSX" not in x and not re.search(r"inst|short", os.path.basename(x), re.I)]
            if len(fs) != 1:
                sys.exit(f"NeWorld {pid}: zip の中のフル版が 1 つに決まらない {fs}")
            src = fs[0]
    return src, credit


def fetch_ht(slug, cache):
    s = curl(f"{HT}/{slug}/", timeout=60)
    paths = [p for p in sorted(set(re.findall(r'href="(/audio/downloads/[^"]+)"', s))) if "off-vocal" not in p]
    if not paths:
        sys.exit(f"独り音 {slug}: ダウンロードのリンクが見つからない (オフボーカル版しか無い?)")
    src = os.path.join(cache, f"ht_{slug}." + paths[0].rsplit(".", 1)[1])
    if not (os.path.exists(src) and os.path.getsize(src) > 5e5):
        subprocess.run(["curl", "-sL", "-m", "900", "-o", src, HT + paths[0]])
    return src


def encode(src, dst):
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "2", "-ar", "44100",
                        "-c:a", "libmp3lame", "-b:a", "80k", "-joint_stereo", "1", dst], capture_output=True)
    if r.returncode:
        sys.exit(f"ffmpeg: {src}: {r.stderr.decode()[:300]}")


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True)
    return round(float(r.stdout.decode().strip()), 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(ROOT, "data", "raw", "live_songs"))
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    if a.list:
        for site, i, title, tags in SONGS:
            print(site, i, title, tags)
        return
    os.makedirs(a.cache, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    out = []
    for site, i, title, tags in SONGS:
        sid = f"{site}{i}" if site == "nw" else f"ht-{i}"
        dst = os.path.join(OUT, sid + ".mp3")
        if site == "nw":
            src, credit = fetch_nw(i, a.cache)
            by = "フリーボーカルMusic【NeWorld】"
            cred = "音楽：NeWorld　" + "　".join(x for x in credit if not x.startswith("音楽"))
            url = f"{NW}/archives/{i}"
        else:
            src = fetch_ht(i, a.cache)
            by = "独り音"
            cred = "音楽：独り音"
            url = f"{HT}/{i}/"
        if not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src):
            encode(src, dst)
        out.append({"id": sid, "file": f"audio/live/{sid}.mp3", "title": title, "site": by, "credit": cred.strip(), "url": url,
                    "dur": duration(dst), "tags": tags, "energy": energy(tags), "bytes": os.path.getsize(dst)})
        print(f"{sid:18s} {title}  {out[-1]['dur']:.0f}s  {out[-1]['bytes'] / 1e6:.1f}MB  {cred[:50]}")
    with open(os.path.join(OUT, "songs.json"), "w", encoding="utf-8") as f:
        json.dump({"_doc": "ライブ会場で流す歌入りの曲 (tools/music/live_songs.py が作る)。credit = 曲の最中に画面へ出すクレジット。energy = 3 にぎやか・2 ふつう・1 ゆったり。曲の権利は各サイトにある。",
                   "songs": out}, f, ensure_ascii=False, indent=1)
    print(f"{len(out)} 曲・合計 {sum(s['bytes'] for s in out) / 1e6:.0f} MB・{sum(s['dur'] for s in out) / 60:.0f} 分 → {OUT}")


if __name__ == "__main__":
    main()
