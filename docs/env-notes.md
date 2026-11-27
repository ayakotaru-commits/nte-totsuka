# 環境メモ・調べてわかっていること（CLAUDE.md から移した。内容は変えていない）

## 許可済みホストと Wikimedia の写真の取り方
- 環境「wachaGru2」に許可済みのホスト: `cyberjapandata.gsi.go.jp`、`assets.cms.plateau.reearth.io`、`www.geospatial.jp`、
  `gic-kanagawa.s3.ap-northeast-1.amazonaws.com`（索引）、`kanagawa-pointcloud.s3.ap-northeast-1.amazonaws.com`（点群・航空写真の本体）ほか。
  別のホストが要るときは、理由を一言添えて許可を申請する。
- 外観の写真は Wikimedia Commons から見られる（`ja.wikipedia.org`・`commons.wikimedia.org`・`upload.wikimedia.org` を許可済み）。
  やり方: `curl` でカテゴリのページ（例 `https://commons.wikimedia.org/wiki/Category:Totsukana`）を取り、`File:` の名前を拾う。
  画像は `https://upload.wikimedia.org/wikipedia/commons/thumb/<md5 の 1 文字>/<md5 の 2 文字>/<名前>/1280px-<名前>`（md5 は空白を `_` にしたファイル名）。
  API（`api.php`）と続けての取得は回数制限（429）に当たるので、1 枚ごとに 25 秒ほど空ける。`thumb.wikimedia.org` と WebFetch は使えない。
  写真は見て特徴を書き起こすだけで、保存・使用しない（作業用フォルダに置き、git には入れない）。

## 調べてわかっていること（調べ直さなくてよい）
- PLATEAU 横浜市 2024 の建物には、用途・階数・構造の属性が**無い**（高さと輪郭だけ）。戸塚は LOD2 も無い。
- 国土地理院の点群は有償。神奈川県の点群（令和3年度、約 10 点/㎡、CC BY 4.0）が戸塚を覆っていて、それを使っている。
- 点群の標高と地形データ（`terrain.json`）の高さの基準は合っている（差の中央値 3cm）。航空写真も輪郭とほぼずれない。
- ローカル座標は実際の距離より約 0.1〜0.3% 短い（`config.py` の 1 度あたりの m が概算のため）。点群・写真との対応はアフィン変換で吸収している（`fetch_lidar.py` の `plane_to_local`）。

## 未着手の提案
- 以前の提案で未着手: 戸塚駅などランドマークの作り込み（街路樹・庭木は点群の木で入った）、ミニマップの改善（高解像度でのぼやけ、ラベルの重なり、橋の重なり順、クリックで目的地）。

