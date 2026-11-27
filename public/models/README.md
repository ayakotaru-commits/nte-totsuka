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

## 服のパーツ (2026-11、枠ごとの組み合わせ)
`public/models/outfits/` は、材質 (Tops / Bottoms / Shoes / Onepiece) ごとに 1 ファイル (13 点)。枠・店・値段は `public/data/outfits.json`。
作り直すときは `python tools/outfits.py data/raw/outfits/<元の VRM> <id> --parts <材質名の正規表現>`。

## 髪型 (`hairs/*.glb`、2026-11、キャラメイク用。まだゲームには組み込んでいない)
OpenGameArt の「VRoid Studio CC0 models」(https://opengameart.org/content/vroid-studio-cc0-models。VRoid が明示的に CC0 で出した、VRoid Studio のアルファ版のモデル。VRM 0.x) から、髪の材質 (名前に HAIR を含むもの。頭の後ろを覆う HairBack も含む) だけを `python tools/hairs.py <元の.vrm> <id>` で取り出したもの (元の 14〜21MB → 1 つ 0.6〜2MB)。髪の揺れの設定 (secondaryAnimation) も残してある。
- `hairsample_female`・`hairsample_male` (HairSample_Female / Male)、`avatar_d`・`avatar_d_darkness`・`avatar_e`・`avatar_f`・`avatar_g` (AvatarSample_D〜G。今の VRoid Studio の同名のものとは別物)、`sakurada` (Sakurada Fumiriya)、`shino` (Sendagaya Shino)。
- 条件: OpenGameArt の説明では CC0。出どころに挙げられた VRoid のヘルプ本文は、この環境から読めていない (未確認)。AvatarSample_A〜C (今のキャラ) は対象外。
- Base_Female / Base_Male (頭の殻だけの短髪) は、額が出てしまうので使わないことにした (2026-11-27、持ち主の判断)。一覧は `hairs/hairs.json`。

## 男性の体 (`bodies/male.vrm`、2026-11、キャラメイク用)
OpenGameArt の「VRoid Studio CC0 models」(https://opengameart.org/content/vroid-studio-cc0-models) の `Base_Male` (VRoid プロジェクト。VRM 0.x。VRM の利用条件にも licenseName = CC0、改変・再配布・商用 OK、クレジット不要と書いてある) を、`python tools/slim_vrm.py data/raw/bodies/Base_Male.vrm public/models/bodies/male.vrm` で軽くしたもの (17.9MB → 9.0MB)。
- 男性の体用の髪の合わせ (顔の数字) は `hairs/male_fit.json` (`python tools/hairs.py --player data/raw/bodies/Base_Male.vrm 0.55 male_fit.json`)。この体は頭皮の三角形がほとんど無いので、体自身の髪 (頭の殻 HairBack) を残したまま別の髪を重ねる (`keepOwn`)。
- 男性向きの服: `outfits/hairsample_male_tops.glb` (HairSample_Male = 同じ体の別の服。CC0)。`python tools/hairs.py data/raw/bodies/HairSample_Male.vrm hairsample_male_tops --parts Tops --outdir outfits`。一覧は `public/data/outfits.json` の `body` (female / male。無ければ female)。
