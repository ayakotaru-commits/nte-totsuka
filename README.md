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
  build_props.py       city.json → public/data/props.json (路上の小物・敷地の外構・ベランダ・看板・木の配置と当たり判定)
public/                ゲーム本体 (Three.js r170, CDN 読み込み・ビルド不要)
  data/city.json       街データ (建物・道路・線路・水域・エリア・POI)
  data/props.json      小物・建物の飾り・木の配置と当たり判定 (build_props.py が作る。手で編集しない)
  src/city.js          メッシュ生成 (建物押し出し・窓テクスチャ・道路・木。木の位置は props.json)
  src/world.js         当たり判定 (建物フットプリント + props.json の小物)
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
python tools/fetch_lidar.py    # 点群 (建物の形)。build_city.py より先に実行
python tools/fetch_ortho.py    # 航空写真 (屋根の色)。build_city.py より先に実行。Pillow が必要
python tools/build_city.py     # 最後に build_props.py も実行する
```
`python tools/lidar_shape.py`（`--undo` も）で `city.json` を書き換えたときも、続けて `build_props.py` が実行される。
小物だけを作り直すときは `python tools/build_props.py`（数秒）。

### 建物データの方針（国土地理院ベース）
- 建物の形・有無: 国土地理院ベクトルタイル（optimal_bvmap-v1 の BldA）。`tools/fetch_gsi.py`、デコーダは `tools/mvt.py`
- 高さ: 重なる PLATEAU 建物の実測高さ。無ければ種別（普通/堅ろう/無壁舎）と面積から推定
- PLATEAU にしか無い建物は使わない（取り壊し済みとみなす）
- `data/raw/gsi_bldg.json` を削除すると、下の PLATEAU ベースに戻る
- 自動分類（`build_city.py` の `classify`）: 国土地理院の種別（普通/堅ろう/無壁舎）・PLATEAU 実測高さ・面積・OSM の土地利用と店舗位置から
  `style`（house / apartment / commercial / industrial / lowrise / public / carport / parking / small）、`floors`（階数）、
  `roof`（戸建ての切妻/寄棟。実測高さ = 棟の高さとして壁を低くする）、`shops`（1階の店）を全建物に付ける

### 建物の形（点群から自動で作り直す）
神奈川県が公開している航空レーザ測量の点群（1㎡ あたり約 10 点、令和3年度測量、CC BY 4.0）から、建物 1 棟ごとの形を実測に合わせる。個別の指示は不要。
```
python tools/fetch_lidar.py     # 点群 8 図郭 (約 800MB) を取得 → data/raw/lidar_dsm.bin (0.5m の高さ格子)
python tools/fetch_ortho.py     # 航空写真 8 図郭 (約 90MB) を取得 → data/raw/ortho_rgb.bin (0.5m の色の格子)。Pillow が必要 (pip install pillow)
python tools/build_city.py      # 高さ格子があれば自動で適用
python tools/lidar_shape.py     # (build_city.py を通さず) 今の city.json にその場で適用。--undo で元に戻す
```
`tools/lidar_shape.py` が輪郭の中の屋根の高さを読み、次を行う:
- **段**: 高さがなだらかにつながる所を「部分」に分ける（2階建ての母屋と平屋の下屋、ビルの低層部と高層部、塔屋）。低い段から順に「その高さ以上の所」の輪郭を積み上げる。上の段は別の建物データ（`part` = 元の建物の id、`minH` = 下の段の高さ、小さいものは `plain` = 窓なしの壁）
- **欠け**: 輪郭の中で地面の高さしかない所（中庭、輪郭が実際より大きい所）を建物から除く
- **屋根**: 部分ごとに 平ら / 切妻 / 寄棟 / 片流れ を当てはめ、棟の向き・勾配・軒の高さ・棟のずれ（`off`）を実測から決める。L 字やコの字は長方形に分けてそれぞれに屋根を付ける（`roofs`）
  - 当てはめの順: ① 長方形の屋根 → ② 長方形に分けて屋根（7 割以上を覆えたとき）→ ③ 輪郭に沿った寄棟（`t: "skel"`、高さ = 勾配 `k` × 輪郭までの距離。曲がった形や L 字にも掛かる）→ ④ 形は合いきらないが勾配はある場合の近似（平らより誤差が減るときだけ）→ どれも合わなければ平ら
  - 地面の高さのマスは屋根とつなげない。輪郭の端のマスは屋根より低いことが多いので、合わないマスが 3 割までなら採用する（`MIN_INLIER`）
  - 調査用: `lidar_shape.STATS = []` を入れてから実行すると、部分ごとの（面積, 高さのばらつき, 屋根の種類, …）がたまる
- **高さ**: PLATEAU の値を点群の値で置き換える（元の値は `lidar.h0`）
- 点群に写っていない建物（測量後の新築）、外観設定（`appearance.json`）の建物、修正モードで高さを変えた建物（`fixed`）、車庫は元のまま
- **屋根の色**: 航空写真（同じ配布元のオルソ画像, 25cm）の、輪郭の中の画素から屋根の色を読んで `rc` に入れる（段ごと。上の段が載っている所は除く）。輪郭の線から 0.75m 以内と、影（暗い側 35%）・てかりや設備（明るい側 15%）を除いた中央値。家の屋根が緑のときは木がかぶさっているとみなして付けない。写真そのものはゲームに貼らない。ゲーム側（`city.js` の `roofColor`）で、白っぽく写る分を少し締めて使う
- 標準ライブラリだけで動く（numpy があれば取得が速い）。航空写真の取得（`fetch_ortho.py`）だけは JPEG を読むため Pillow が必要

### 建物データの方針（旧: PLATEAU ベース）
- 建物の形と高さは PLATEAU (LOD1, 実測高さ) を正とする。戸塚エリアは LOD2/テクスチャ未整備 (2020/2022/2024 年度版で確認)。
- 名前・種別 (house 等)・色は位置の重なる OSM 建物から引き継ぐ。
- PLATEAU に無い OSM 建物 (高架・庇など) は補完として残す。
- 各建物の `e` = 原点付近の地盤からの相対標高 (m)。地形対応時に使用。現状は平地として描画。

範囲を変えるときは `tools/config.py` の `BOUNDS`（原点からのメートル）を編集。

### 街並みディテール（お試し中・スタート地点の半径250m）
ゲーム内は V キーでまとめてオン/オフ。段階ごとの有効/無効は `public/src/detail/config.js`。
配置の計算はすべて `tools/build_props.py`（`props.json`）。`public/src/detail/` は形を作って置くだけ。
1. 路上の小物: 電柱・電線・街灯・横断歩道・停止線と「止まれ」・ガードパイプ・自販機・カーブミラー（道路データから自動配置）
   - 信号機・バス停（`public/src/detail/street.js`）: OSM の信号（`highway=traffic_signals`）の交差点に、横型3灯の車両用信号（左側・横断歩道の先・車道へ張り出す）と、横断歩道の両端に歩行者用信号を置く。青22秒→黄3秒→全赤2秒で縦横が交互に切り替わり、歩行者用は青の終わりに点滅。単路の押しボタン式（`crossing=traffic_signals`）は横断歩道も描く。バス停（`highway=bus_stop`）は最寄りの道路の縁に、丸い標識・停留所名の板・時刻表を置く
   - 位置は `city.json` の `streetNodes`。無い（古いデータの）場合は `pois` の名前付きの信号・バス停だけを使う。名前の無い信号も出すには `fetch_osm.py` → `build_city.py` を実行し直す
   - 配置の計算は `tools/build_props.py`（以前はブラウザで毎回計算していた）。ブラウザは `props.json` を読んで置くだけ。Unity でも同じデータを読む
2. 素材テクスチャ: Poly Haven の CC0 素材（`python tools/fetch_detail_textures.py` で取得）を道路・歩道・外壁・屋根に重ねる
3. 建物の作り分け: 戸建ての切妻/寄棟屋根、集合住宅の南向きベランダ、店舗・病院の看板と日よけ

完全に戻す手順:
- `public/src/detail/`、`public/assets/detail/`、`tools/fetch_detail_textures.py` を削除
- 木（`city.js`）も `props.json` の `trees` を読むので、`tools/build_props.py` と `public/data/props.json` は残す（ディテールだけ戻すなら `props.json` の小物の項目は使われなくなるだけ）
- `public/src/main.js` の `// detail (お試し)` と書かれた5行を削除
- `public/index.html` のヘルプから「V ディテール」を削除

### 小物の配置 (props.json)
`tools/build_props.py` が `city.json`・`terrain.json` から作る。座標は `city.json` と同じ（x = 東、y = 上、z = 南、1 = 1m）。
- `y` はその場所の地面の高さ（`terrain.json` と同じ補間）。`yaw` は Y 軸まわりの回転（ラジアン）で、物の正面（局所 +Z）が (sin yaw, cos yaw) を向く（three.js の `rotation.y` と同じ）
- `poles` 電柱（`transformer` 変圧器あり、`lamp` 街灯あり。正面が道路側）／`wires` 電線 `[ax, ay, az, bx, by, bz, たるみ]`（中央で たるみ m 下がる放物線）
- `paint` 横断歩道の縞・停止線、`tomare`「止まれ」の文字: 長方形 `[中心x, 中心z, 長さの向きdx, dz, 長さ, 幅]`。路面に沿わせて描く
- `guardRails` ガードパイプ: ひと続きの柵ごとの支柱の列 `[[x, z, y], ...]`。隣どうしを高さ 0.45m と 0.8m のパイプでつなぐ
- `vending` 自販機（`color` 0=赤 1=青 2=白、正面が道路側）／`mirrors` カーブミラー
- `signals` 車両用信号（`reach` 腕の長さ、`axis` 0=主方向 1=交差方向、`offset` 周期のずれ 秒。周期は 青22→黄3→全赤2 秒 × 2 方向）／`pedSignals` 歩行者用信号（正面が向かい側）／`busStops` バス停（`name`）
- `balconies` 集合住宅のベランダ（壁ごと）: 壁の始点 `x, z`、壁の向き `dx, dz`、外向き `nx, nz`、壁の長さ `len`、建物の基準の高さ `y`、1 階分の高さ `floorH`、階数 `floors`、`dark`（濃い色の手すり）、建物の id `b`。2 階から最上階まで、床の高さ `y + k × floorH`（k = 1 〜 floors−1）に、奥行き 1.1m・手すり壁 1.1m のベランダを付ける（壁の両端 0.4m は空ける）
- `signs` 店の看板と日よけ: 壁の中点 `x, z`、建物の基準の高さ `y`、正面 = 壁の外向き、幅 `w`、`name`、`cat`、`colors`（地・文字・帯と日よけの色）、建物の id `b`。看板は `y + 3.35`、日よけは `y + 2.6`
- `trees` 木（公園・森・草地）: `[x, z, y, 大きさの倍率, 0〜1 の乱数]`。乱数は向き（× 6.28 ラジアン）と葉の色の濃さに使う。基準の木は幹の高さ 2.2m、葉は高さ 3.2m を中心に半径 1.7m
- `sites` 敷地の外構（`data/appearance.json` の `sites` から）: 庭（芝生のマス・通路・噴水・円すいの木）、門のアーチ、円形広場、エントランス棟の正面、屋上の塔、日よけ、花壇、オベリスク、天窓、フェンス
- `colliders` 当たり判定。y0, y1 は下端・上端の絶対高さ
  - `circle` `[x, z, 半径, y0, y1]`（電柱・信号の柱・ミラー・噴水・木など）
  - `box` `[x, z, yaw, 局所Xの半幅, 局所Zの半幅, y0, y1]`（自販機・フェンス・花壇など）
  - `line` `[半幅, 高さ, x0, z0, y0, x1, z1, y1, ...]`（ガードパイプ。折れ線に沿った薄い壁）
  - `tree` `circle` と同じ形（木の幹）。木は V キーで消えないので、この判定も常に有効
  - ブラウザでは移動・着地・ワープ先の判定だけが使う（カメラは建物だけを見る）。V キーで小物を消すと当たり判定も外れる。看板・日よけ・ベランダなど頭より上の物と、電線には判定がない

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

### キャラクター（public/src/character.js）
- 標準では、関節のある人型（腰・背骨・胸・首・頭・肩・肘・股関節・膝・足首）を組み立てて動かす。歩き・走りは、足が地面に着いている間は滑らず浮かないように角度から腰の高さを計算している。
- `public/models/player.vrm` を置くと、そのキャラに差し替わる（VRoid Studio で作った VRM 0.x / 1.0 に対応。読み込みは `@pixiv/three-vrm`、`index.html` の importmap）。同じ角度をモデルの人型ボーンに渡すので、歩き・走り・ジャンプ・髪や服の揺れ・まばたきが動く。ファイルが無い・読めないときは標準のキャラのまま（コンソールに理由が出る）。
- 大きさは自動で合わせる（足裏が地面、腰の高さが標準と同じ）。モデルは配布・利用規約を確認してから置く。

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

### 確認用の道具（tools/dev/）
- `tools/dev/shot.js`: ゲームをヘッドレスブラウザで起動し、指定した視点のスクリーンショットを撮る（修正前後の見比べ用。使い方はファイル先頭のコメント、視点の例は `tools/dev/views.example.json`）
- `tools/dev/evalroof.py`: 屋根の形の確かさを数字で測る（モデルの屋根の高さと点群の高さの誤差）
- 作業の進め方とクラウド環境での注意点は `CLAUDE.md`

## 出典
- 地図データ © OpenStreetMap contributors (ODbL)
- 建物の輪郭: 国土地理院ベクトルタイル／標高: 国土地理院 標高タイル
- 建物データ: 国土交通省 Project PLATEAU 3D都市モデル 横浜市 (2024年度)
- 建物の形・屋根の色: 神奈川県 令和3年度 横浜南部、湘南、横須賀三浦 3次元点群データ（点群・オルソ画像）(CC BY 4.0, G空間情報センター)
