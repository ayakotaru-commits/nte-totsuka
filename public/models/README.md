# キャラクターのモデル

`player.vrm` を置くと、ゲームのキャラがそのモデルに差し替わる（無ければ組み立て式のキャラ）。
別のモデルにするときは、VRM ファイルを同じ名前で上書きするだけでよい。

今の `player.vrm` は、VRoid Studio 公式のサンプルモデル「AvatarSample_A」（作者: VRoid / pixiv）。
CC0 ではなく、利用条件付きで自由に使えるモデル。条件は VRoid 公式のヘルプ
「VRoid Studio のサンプルモデルに利用条件はありますか」を参照。

ファイルを軽くするため、`python tools/slim_vrm.py` で模様を WebP の可逆圧縮（画素は元と同じ）にし、
使わないサムネイルを小さな画像に置き換えてある（15.1MB → 8.2MB。モデルの利用条件で改変は許可されている）。
別のモデルに差し替えたときも、同じ道具をかけるとよい。

## 着せ替えの服 (`outfits/*.glb`)

別の VRoid モデル (VRM 1.0) の服のパーツだけを `tools/outfits.py` で取り出したもの (元の 13〜26MB → 1 着 0.6〜0.8MB)。
今のキャラの骨に付け替えて着る (`public/src/outfit.js`)。一覧・値段・店・出どころは `public/data/outfits.json`。
どれも VRM に書かれた利用条件が「改変・再配布 OK、クレジット不要」。商用は、個人の利益までのものと商用 OK のものがある (一覧の `license`)。
作者名: Lyrik (Lyla)、Nishimiya (Nishi)、いさん (のなつー)、wayy (たぬき)、PEPE (celestia)。
配布ページの URL が分かっているのは Lyla だけ。あとの 4 つは、ダウンロードした VRM のページを確認して `outfits.json` の `source` に足す。
