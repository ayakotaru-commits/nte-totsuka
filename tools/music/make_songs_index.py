#!/usr/bin/env python3
"""public/arcade/ の曲の一覧 songs.json を作る (ゲームの曲えらびが読む)。

  python tools/music/make_songs_index.py

曲 = public/arcade/<id>.chart.json と <id>.mp3 (tools/music/audio_chart.py が作る)。最初の自作曲だけは chart.json と song_pop1.mp3 (id = pop1)。
並びは ORDER。ここに無い曲 (新しく足した曲) は、最後に足される。
"""
import json
import os

HERE = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'arcade')
ORDER = ['pipipi', 'miraimirai', 'okaeri', 'soap', 'pop1']


def main():
    songs = {}
    for fn in sorted(os.listdir(HERE)):
        if fn.endswith('.chart.json'):
            c = json.load(open(os.path.join(HERE, fn), encoding='utf-8'))
            songs[c['id']] = {'id': c['id'], 'title': c['title'], 'credit': c.get('credit', ''), 'audio': c['audio'], 'chart': fn,
                              'bpm': str(int(round(c['bpm']))), 'duration': c['duration'], 'note': c.get('note', '歌入り')}
    if os.path.exists(os.path.join(HERE, 'chart.json')):
        c = json.load(open(os.path.join(HERE, 'chart.json'), encoding='utf-8'))
        songs['pop1'] = {'id': 'pop1', 'title': 'ハイテンポ・ポップ（インスト）', 'credit': '曲：オリジナル（歌なし）', 'audio': 'song_pop1.mp3', 'chart': 'chart.json',
                         'bpm': '172 → 200', 'duration': c['duration'], 'note': 'サビ前でテンポがゆれるよ'}
    order = [i for i in ORDER if i in songs] + [i for i in songs if i not in ORDER]
    out = {'songs': [songs[i] for i in order]}
    with open(os.path.join(HERE, 'songs.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    for s in out['songs']:
        print(s['id'], s['title'], s['bpm'], s['duration'])


if __name__ == '__main__':
    main()
