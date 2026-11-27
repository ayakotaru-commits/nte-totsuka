# TOTSUKA（戸塚駅周辺 3D 散策）— 作業メモ

仕組み・データの方針・ツールの使い方は `README.md`（先頭に目次。各節は `docs/readme/` に分けてある）にある。ここには、README に無い「作業の進め方」と「この環境の注意点」だけを書く。

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
- 許可済みホスト（`cyberjapandata.gsi.go.jp`・PLATEAU・神奈川県の点群ほか）、Wikimedia Commons の写真の取り方（回数制限 429 に注意）は `docs/env-notes.md`。別のホストが要るときは、理由を一言添えて許可を申請する。
- シェルのヒアドキュメントに `` ` `` を含む文章を書くときは、終端を引用符付き（`<<'EOF'`）にする（README を崩したことがある）。

## 調べ済みの事実・未着手の提案 → `docs/env-notes.md`（PLATEAU に属性が無い、点群の出どころ、座標の縮み ほか。調べ直さなくてよい）

## 履歴と未確認（毎回は読まない。必要な機能のファイルだけ開く）

**規則: 作業の記録（確認したこと・未確認・気になる点）は CLAUDE.md に足さず、下の `docs/history/` の該当ファイルに書く。CLAUDE.md には方針・手順・環境の注意だけを置く。新しい機能は該当ファイルに項目を足し、無ければファイルを作ってここに 1 行足す。**

- `docs/history/city-data.md` — 街・建物・地形・点群・データ
- `docs/history/character.md` — キャラ・動き・パルクール・攻撃・起動・スマホ操作
- `docs/history/ui-look.md` — マルチプレイ・光・質感・地面・撮影モード
- `docs/history/rail.md` — 線路・電車に乗る・舞浜までの延長
- `docs/history/events.md` — イベント（うな○ー・お札まき・八坂神社・ゲームセンター音ゲー）
- `docs/history/shops-crowd.md` — 戸塚モディ・着せ替え・歩く人・車・ミニマップ
- `docs/history/park.md` — 千葉ドリームランド（旧フェアリー・リールパーク）
- `docs/history/trees-sky.md` — 木の見た目・空と時刻
- `docs/history/grancity.md` — グランシティ
- `docs/unverified.md` — 未確認の一覧（各項目の抜粋）

機能の仕組みは README の目次（`docs/readme/`）、園の計画は `PARK_PLAN.md`、駅を足す手順は `.claude/skills/rail-extension/SKILL.md`。

## ブランチ
ここまでの作業は `main` に入っている（プルリクエスト #1・#2 と、ローカルでマージした `feature/humanoid-character`・`feature/road-markings`・`feature/terrain-2m`）。`main` が最新。
クラウドのセッションでは作業ブランチ名が指定される。そのブランチのプルリクエストがマージ済みなら、`main` の最新から作り直して始める。
プルリクエストは頼まれたときだけ作る。
