# TOTSUKA（個人用・戸塚駅周辺 3D 散策）

横浜市戸塚区・戸塚駅周辺を OpenStreetMap のデータから 3D で再現し、キャラクターで歩き回れるブラウザゲーム。

## 起動

`start.bat` をダブルクリック → ブラウザで http://localhost:8000/ が開く（Python が必要）。

## 操作

| キー | 動作 |
|---|---|
| WASD / 矢印 | 移動 |
| Shift | ダッシュ |
| C | 歩き / 走り切替 |
| Space | ジャンプ（空中でもう一度押すと2段ジャンプ） |
| マウス / ホイール | 視点 / ズーム |
| E | 修正モード（建物の削除・高さ変更・追加。保存すると街を作り直す） |
| P | 現在地のストリートビューを Google マップで開く（別タブ） |
| M | 大きいマップ（ホイールで拡大縮小・ドラッグで移動・F で現在地へ・M / Esc で閉じる） |
| T | 時間帯（昼 → 夕方 → 夜 → 朝） |
| R | スポーン地点に戻る |
| G | 街のメッシュを GLB で書き出し（Unity 移行用） |
| H | ヘルプ表示切替 |

## 構成

```
tools/                 データ変換ツール (Python, 標準ライブラリのみ)
  config.py            原点・取得範囲
  fetch_osm.py         Overpass API から OSM データ取得 → data/raw/osm.json
  fetch_plateau.py     PLATEAU 横浜市 2024 の CityGML (2GB の ZIP) から該当メッシュだけ部分取得 → data/raw/plateau_bldg.json
  remotezip.py         HTTP Range で巨大 ZIP の一部だけ読むヘルパー
  build_city.py        OSM + PLATEAU → public/data/city.json (ローカル座標)
public/                ゲーム本体 (Three.js r170, CDN 読み込み・ビルド不要)
  data/city.json       街データ (建物・道路・線路・水域・エリア・POI)
  src/city.js          メッシュ生成 (建物押し出し・窓テクスチャ・道路・木)
  src/world.js         当たり判定 (建物フットプリント)
  src/player.js        移動・ジャンプ
  src/character.js     仮キャラクター (VRM 差し替え予定)
  src/camera.js        三人称カメラ (壁めり込み回避)
  src/minimap.js       ミニマップ
  src/labels.js        施設名ラベル
  src/time.js          時間帯
```

### 座標系（Unity 移行時も共通）
- 1 単位 = 1 m、原点 = 戸塚駅付近 (35.4010, 139.5340)
- X = 東、Y = 上、Z = 南（北は -Z）。glTF/Three.js 準拠。Unity へは glTFast で読み込めば自動変換。

### データ更新
```
python tools/fetch_osm.py
python tools/fetch_plateau.py
python tools/fetch_gsi.py
python tools/fetch_dem.py      # 地形 (標高)。build_city.py より先に実行
python tools/build_city.py
```

### 建物データの方針（国土地理院ベース）
- 建物の形・有無: 国土地理院ベクトルタイル（optimal_bvmap-v1 の BldA）。`tools/fetch_gsi.py`、デコーダは `tools/mvt.py`
- 高さ: 重なる PLATEAU 建物の実測高さ。無ければ種別（普通/堅ろう/無壁舎）と面積から推定
- PLATEAU にしか無い建物は使わない（取り壊し済みとみなす）
- `data/raw/gsi_bldg.json` を削除すると、下の PLATEAU ベースに戻る
- 自動分類（`build_city.py` の `classify`）: 国土地理院の種別（普通/堅ろう/無壁舎）・PLATEAU 実測高さ・面積・OSM の土地利用と店舗位置から
  `style`（house / apartment / commercial / industrial / lowrise / public / carport / parking / small）、`floors`（階数）、
  `roof`（戸建ての切妻/寄棟。実測高さ = 棟の高さとして壁を低くする）、`shops`（1階の店）を全建物に付ける

### 建物データの方針（旧: PLATEAU ベース）
- 建物の形と高さは PLATEAU (LOD1, 実測高さ) を正とする。戸塚エリアは LOD2/テクスチャ未整備 (2020/2022/2024 年度版で確認)。
- 名前・種別 (house 等)・色は位置の重なる OSM 建物から引き継ぐ。
- PLATEAU に無い OSM 建物 (高架・庇など) は補完として残す。
- 各建物の `e` = 原点付近の地盤からの相対標高 (m)。地形対応時に使用。現状は平地として描画。

範囲を変えるときは `tools/config.py` の `BOUNDS`（原点からのメートル）を編集。

### 街並みディテール（お試し中・スタート地点の半径250m）
ゲーム内は V キーでまとめてオン/オフ。段階ごとの有効/無効は `public/src/detail/config.js`。
1. 路上の小物: 電柱・電線・街灯・横断歩道・停止線と「止まれ」・ガードパイプ・自販機・カーブミラー（道路データから自動配置）
2. 素材テクスチャ: Poly Haven の CC0 素材（`python tools/fetch_detail_textures.py` で取得）を道路・歩道・外壁・屋根に重ねる
3. 建物の作り分け: 戸建ての切妻/寄棟屋根、集合住宅の南向きベランダ、店舗・病院の看板と日よけ

完全に戻す手順:
- `public/src/detail/`、`public/assets/detail/`、`tools/fetch_detail_textures.py` を削除
- `public/src/main.js` の `// detail (お試し)` と書かれた4行を削除
- `public/index.html` のヘルプから「V ディテール」を削除

### 道路（PLATEAU の道路面）
`tools/fetch_plateau.py` が PLATEAU の道路 LOD1 面（測量に基づく道路の範囲。歩道・車道の区別なし）も取得し `data/raw/plateau_road.json` に保存。`build_city.py` の `process_roads` が:
- `roadAreas`: 道路面をそのまま描く（実際の道幅・交差点の形）
- OSM の各道路に `cov`（区間ごとに PLATEAU 面で覆われているか）、`w`（実測の幅。元の値は `w_osm`）、`half`（中心線から左右の縁まで）、`sw`（幹線の歩道幅の推定）を付ける
- 覆われた区間は OSM の帯を描かない。私道・遊歩道など PLATEAU に無い区間だけ OSM の中心線から描く
- 電柱・ガードパイプ・横断歩道・停止線・自販機は実測の縁と車道の中心に合わせる。歩道の帯は交差点の手前で切る

### 橋・歩道橋・デッキ
標高データは地面だけなので、橋はそのままだと川底や下の道路まで沈む。`build_city.py` の `compute_bridges` が橋（bridge=yes）の各頂点の高さ `ys` を計算する:
- つながった橋をまとめ、地面の道とつながる点（たもと）を地面の高さに固定して間をなめらかに補間
- 道路・線路の上を渡る所は下をくぐれる高さ（道路 5.3m・線路 6.8m）を確保し、勾配（車道 8%・歩道 12%・階段 70%）で下げる
- 持ち上がった歩道橋につながる地面側の歩道・階段は坂（`ramp`）にする
- ゲーム側 `public/src/bridges.js` が路面・側面・底面・手すり・橋脚を作り、`deckAt()` で上を歩ける。車道の橋の部分の PLATEAU 道路面は描かない

### 地形（坂）
`tools/fetch_dem.py` が国土地理院の標高タイル（DEM5A＝航空レーザー5mメッシュ、欠けは DEM5B/10B で補完）から 4m 間隔の標高グリッド `public/data/terrain.json` を作る（戸塚駅付近＝0m の相対標高）。
- ゲーム側 `public/src/terrain.js` の `H(x, z)` が地面の高さ。地形メッシュと同じ三角形補間なので、置いた物が浮いたり埋まったりしない
- 道路・川・公園などの平面は `drape()` で細かく割って地形に沿わせる
- 建物は `build_city.py` が基礎の高さ `y`（輪郭で一番低い地面）を付け、高さ `h` は基礎からの値のまま
- `terrain.json` を消すと平らな地面に戻る

### 外観設定（data/appearance.json）
敷地（OSM の名前付き住宅地エリア）ごとに、建物の外観と外構を設定する。物件情報の公開写真を見て特徴を書き起こしたもの（写真自体は保存・使用しない）。
- `buildings.set`: `floors`（階数）, `color`（外壁色）, `facade: "euro"`（ベージュ外壁＋奥まったバルコニー）, `mansard`（最上部の濃い色の帯）, `balcony: "all"`（全ての長い面にベランダ）, `railing`
- `garden`: 最大の棟のコの字の内側に芝生・レンガの通路・噴水・円すい形の木
- `fence`: 敷地境界の金属フェンス（建物に接する部分は省く）
- `gate`: 指定位置の建物を通り抜けられる門（両側の柱＋上の梁＋アーチ）に置き換える。門の前はフェンス・ガードパイプを切る
- `hall`: エントランス棟（アーチ窓・赤い扉の正面）、`plaza`: 噴水のある円形広場、`turrets`: 屋上の塔（ドーム）、`awnings`: 中庭側1階の日よけ
- 庭には花壇・オベリスク（エントランス側）・丸い天窓（反対側）も置く
- 門・エントランス棟・広場・塔の座標は、建物データの配置と写真の見え方からの推定（手置き）
- 現在はグランシティ パレ・ド・リヴァージュ（7階建・RC造・2005年築）のみ

### スタート地点
`tools/config.py` の `START`（緯度経度）と `face_toward`（向く先の緯度経度）。現在はグランシティ パレ・ド・リヴァージュ西側の道路上、門の正面でマンション側を向く。

### 現地情報による修正
`data/corrections.json` に、元データと現地が違う箇所を書く。`build_city.py` 実行時に反映。ゲーム内の修正モード（E）から保存すると自動で追記・再生成される（`start.bat` = `tools/server.py` で起動したときのみ）。
- `remove_buildings`: `{"at": [x, z]}`（その地点を含む建物を削除。データ源が変わっても有効）または `{"id": ...}`
- `set_height`: `{"id" または "at", "h"}`
- `add_buildings`: `{"id", "outer": [[x, z], ...], "h"}`
- 修正モードの「前回の保存を取り消す」で、最後に保存した分だけ戻せる
- ファイルを削除して `build_city.py` を再実行すれば元データに戻る

### 目的地
`tools/config.py` の `WAYPOINTS` に名前と緯度経度を追加 → `build_city.py` を再実行。
光の柱・ミニマップのマーカー・距離表示が出る。目的地が建物の中の場合は、その建物の外壁に着いた時点で「到着」になる。

## 出典
- 地図データ © OpenStreetMap contributors (ODbL)
- 建物の輪郭: 国土地理院ベクトルタイル／標高: 国土地理院 標高タイル
- 建物データ: 国土交通省 Project PLATEAU 3D都市モデル 横浜市 (2024年度)
