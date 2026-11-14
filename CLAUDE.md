# TOTSUKA（戸塚駅周辺 3D 散策）— 作業メモ

仕組み・データの方針・ツールの使い方は `README.md` に全部ある。ここには、README に無い「作業の進め方」と「この環境の注意点」だけを書く。

## 持ち主の方針
- 街並みを実物に近づけたい。建物は 5,600 棟以上あるので、**個別の指示なしに自動で**直す方法を優先する。
- 航空写真を地面に貼るのは「イマイチ」だったので**やらない**（色を数値として読むのは可。屋根の色はその方式）。
- 返事は日本語。提案は「効果が大きい順」に並べ、進める前に一言確認する。

## 変更を確認する手順（ここまでの作業で使ってきたやり方）
1. **見た目**: `tools/dev/shot.js` でスクリーンショットを撮って自分の目で見る。修正前後を並べた画像を持ち主に送る。
   ```
   mkdir -p tools/dev/.cache && cd tools/dev/.cache && npm pack three@0.170.0 -q && tar xzf three-0.170.0.tgz   # 初回だけ
   node tools/dev/shot.js <出力フォルダ> tools/dev/views.example.json                      # 今の状態
   node tools/dev/shot.js <出力フォルダ> <視点.json> --city <修正前の city.json>           # 修正前
   git show HEAD:public/data/city.json > <修正前の city.json>                              # 修正前のデータの作り方
   ```
   視点の書き方は `tools/dev/shot.js` の先頭のコメント。描画はソフトウェアなので **1 枚 1〜2 分**。数枚まとめて撮る。
2. **屋根の形の数字**: `python tools/dev/evalroof.py`（モデルと点群の高さの誤差）。`tools/lidar_shape.py` を変えたら前後で比べる。
   今の基準: 誤差の中央値 0.14 m / 建物ごとの RMSE 中央値 0.48 m / 平らな屋根 2395・勾配屋根 3138（乱数の屋根のころは誤差の中央値 1.02 m）。
3. **元に戻せること**: `python tools/lidar_shape.py --undo` の結果が適用前と一致し、もう一度適用すると同じ結果になること。
4. 確認できなかったことは、できなかったと持ち主に伝える。

## この環境（クラウドのセッション）の注意点
- `data/raw/`（約 1.1GB）は git に入っていない。新しいセッションでは取り直す（合わせて数分）:
  `python tools/fetch_plateau.py` / `fetch_gsi.py` / `fetch_dem.py` / `fetch_lidar.py` / `fetch_ortho.py`
- **OSM（overpass-api.de）には接続できない**（許可済みでも通信が切られる）。そのため `tools/fetch_osm.py` と `tools/build_city.py` の通し実行はここではできない。
  建物の形と色の変更は `python tools/lidar_shape.py` で `public/data/city.json` に直接かけて確かめる（`build_city.py` も同じ `lidar_shape.apply()` を呼ぶ）。
  `build_city.py` に手を入れたときは「通しでは未確認」と伝え、持ち主の PC で実行してもらう。
- `www.gsi.go.jp` は暗号方式が古くて読めない（TLS の設定を弱めて読むのは不可）。調べものは検索で。`cyberjapandata.gsi.go.jp`（タイル）は読める。
- ブラウザからは three.js の配信元（cdn.jsdelivr.net）に届かない。`shot.js` がローカルの three.js に差し替えている。
- 環境「wachaGru2」に許可済みのホスト: `cyberjapandata.gsi.go.jp`、`assets.cms.plateau.reearth.io`、`www.geospatial.jp`、
  `gic-kanagawa.s3.ap-northeast-1.amazonaws.com`（索引）、`kanagawa-pointcloud.s3.ap-northeast-1.amazonaws.com`（点群・航空写真の本体）ほか。
  別のホストが要るときは、理由を一言添えて許可を申請する。
- シェルのヒアドキュメントに `` ` `` を含む文章を書くときは、終端を引用符付き（`<<'EOF'`）にする（README を崩したことがある）。

## 調べてわかっていること（調べ直さなくてよい）
- PLATEAU 横浜市 2024 の建物には、用途・階数・構造の属性が**無い**（高さと輪郭だけ）。戸塚は LOD2 も無い。
- 国土地理院の点群は有償。神奈川県の点群（令和3年度、約 10 点/㎡、CC BY 4.0）が戸塚を覆っていて、それを使っている。
- 点群の標高と地形データ（`terrain.json`）の高さの基準は合っている（差の中央値 3cm）。航空写真も輪郭とほぼずれない。
- ローカル座標は実際の距離より約 0.1〜0.3% 短い（`config.py` の 1 度あたりの m が概算のため）。点群・写真との対応はアフィン変換で吸収している（`fetch_lidar.py` の `plane_to_local`）。

## 残っている課題・次の候補
- 小物・ベランダ・看板・木の配置は `tools/build_props.py` が `public/data/props.json` に書き出す（Unity 移行の準備。ブラウザは読んで置くだけ）。`city.json` を書き換える道具は最後にこれを呼ぶ。配置の決まりを変えるときは JS ではなくここを直す。
- 当たり判定が無いもの: 敷地の門のアーチの柱、電線、頭より上の看板・日よけ・ベランダ。
- 壁の色・壁の凹凸（ベランダ、玄関）は推定のまま。上空のデータからは見えない。街路写真（Mapillary、`tools/mapillary_check.py`）から読む案がある。
- 建物の向きに対して斜めの段差は 0.5 m 刻みのギザギザになる（`lidar_shape.py` の輪郭づくり）。
- 判定できず平らなままの家が約 250 棟（多くは実際に平らか、ごく緩い勾配）。
- 点群は令和3年度。それ以降の新築・建て替えは元の形のまま。
- 単路の押しボタン式信号（`crossing_signal`）の横断歩道を、幹線のガードパイプがふさぐ（`fetch_osm.py` でデータを取り直した後にだけ出る）。
- 名前の無い信号は、持ち主の PC で `fetch_osm.py` → `build_city.py` を実行するまで出ない。
- 駅前で低い角度から見ると、高架の建物の底面が茶色い板のように見える。
- `city.json` が 2.5MB → 5.1MB に増えた。読み込み時間は測っていない。
- キャラは `public/src/character.js`（関節のある人型。`public/models/player.vrm` を置くと VRM に差し替わる）。VRM を置いた状態のゲーム本体での見た目・腕のめり込みは未確認。次の候補: キャラの見た目を NTE 風に寄せる、歩き出し・階段の動き。
- 足元の高さは `world.js` の `GROUND_LIFT`（0.18 m）で、描画される路面に合わせた近似。道路の種類ごとには合わせていない。道路の面を高さの地図にする案がある。小物（街灯・柵など）は地形の高さに置かれ、道路上で少し埋まって見える可能性がある。
- 以前の提案で未着手: 街路樹・庭木、戸塚駅などランドマークの作り込み、線路まわり（架線柱・ホーム）、ミニマップの改善（高解像度でのぼやけ、ラベルの重なり、橋の重なり順、クリックで目的地）。

## ブランチ
ここまでの作業は `main` に入っている（プルリクエスト #1・#2 と、人型キャラの `feature/humanoid-character` をローカルでマージ）。`main` が最新。
クラウドのセッションでは作業ブランチ名が指定される。そのブランチのプルリクエストがマージ済みなら、`main` の最新から作り直して始める。
プルリクエストは頼まれたときだけ作る。
