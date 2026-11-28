# TOTSUKA（個人用・戸塚駅周辺 3D 散策）

横浜市戸塚区・戸塚駅周辺を OpenStreetMap のデータから 3D で再現し、キャラクターで歩き回れるブラウザゲーム。


## 詳しい説明（節ごとに docs/readme/ へ移した）

- 「構成」→ `docs/readme/city.md`
- 「光と空気感（public/src/look.js）」→ `docs/readme/look.md`
- 「空と時刻（public/src/skyfx.js・time.js）」→ `docs/readme/look.md`
- 「座標系（Unity 移行時も共通）」→ `docs/readme/city.md`
- 「データ更新」→ `docs/readme/city.md`
- 「建物データの方針（国土地理院ベース）」→ `docs/readme/city.md`
- 「建物の形（点群から自動で作り直す）」→ `docs/readme/city.md`
- 「空き地を埋める（点群と航空写真から自動で）」→ `docs/readme/city.md`
- 「塀・生け垣・物置・室外機（点群から自動で）」→ `docs/readme/city.md`
- 「木の見た目（葉の板・樹形・葉の色。`public/src/trees.js`・`tools/tree_traits.py`）」→ `docs/readme/look.md`
- 「街を歩く人（public/src/crowd.js・crowdsim.js・tools/build_props.py の `build_crowd()`・issue #64）」→ `docs/readme/people.md`
- 「街を走る車（public/src/traffic.js・trafficsim.js・tools/build_props.py の `build_traffic()`・issue #64 第 3 段階）」→ `docs/readme/people.md`
- 「線路まわり（電車・線路・柵・駅の中）」→ `docs/readme/rail.md`
- 「千葉ドリームランド（舞浜の架空のテーマパーク。`PARK_PLAN.md`・`data/park.json`・`tools/park.py`・`public/src/detail/park.js`）」→ `docs/readme/park.md`
- 「敷地（工業用地・学校・墓地・寺社・病院）」→ `docs/readme/city.md`
- 「建物データの方針（旧: PLATEAU ベース）」→ `docs/readme/city.md`
- 「街並みディテール（お試し中・スタート地点の半径250m）」→ `docs/readme/look.md`
- 「小物の配置 (props.json)」→ `docs/readme/city.md`
- 「道路（PLATEAU の道路面）」→ `docs/readme/city.md`
- 「橋・歩道橋・デッキ」→ `docs/readme/city.md`
- 「地形（坂）」→ `docs/readme/city.md`
- 「撮影モード（public/src/photo.js・touch.js・style.css の `body.photo`）」→ `docs/readme/look.md`
- 「パルクール（public/src/parkour.js・player.js・world.js・character.js）」→ `docs/readme/people.md`
- 「攻撃（public/src/attack.js・player.js・character.js）」→ `docs/readme/people.md`
- 「ステータス（public/src/status.js・menu.js・player.js・swarm/event.js）」→ `docs/readme/people.md`
- 「イベント「うな○ー大量発生クエスト」（public/src/swarm/）」→ `docs/readme/events.md`
- 「神社の社殿（八坂神社。tools/shrine.py・public/src/shrine.js）」→ `docs/readme/events.md`
- 「イベント「リズム地獄(八坂神社)」（旧称: お札まき 合いの手。public/src/rhythm/）」→ `docs/readme/events.md`
- 「イベント「プロジェクトセマイ ワンルームステージ！」（旧称: ゲームセンター リズムステージ。public/src/arcade/・public/arcade/・tools/music/）」→ `docs/readme/events.md`
- 「イベントの場所の印（public/src/eventmarks.js）」→ `docs/readme/events.md`
- 「マルチプレイ（public/src/net/・server/）」→ `docs/readme/people.md`
- 「キャラクター（public/src/character.js）」→ `docs/readme/people.md`
- 「外観設定（data/appearance.json）」→ `docs/readme/city.md`
- 「スタート地点」→ `docs/readme/city.md`
- 「現地情報による修正」→ `docs/readme/city.md`
- 「目的地」→ `docs/readme/city.md`
- 「確認用の道具（tools/dev/）」→ `docs/readme/tools.md`

## 起動

`start.bat` をダブルクリック → ブラウザで http://localhost:8000/ が開く（Python が必要）。

## 操作

| キー | 動作 |
|---|---|
| WASD / 矢印 | 移動 |
| Shift | ダッシュ |
| C | 歩き / 走り切替（何も押さないと走り） |
| Space | ジャンプ（空中でもう一度押すと2段ジャンプ） |
| J / 左クリック / 画面の「攻撃」 | 攻撃（二刀の 3 連撃。続けて押すと次の手順へ。下の「攻撃」）。左クリックは、マウスを視点操作用につかんでいるときだけ |
| K / 画面の「特殊」 | 特殊攻撃（リキャスト 8 秒。ボタンに残り秒が出る。跳び斬り → 急降下の十字斬り。属性・特殊攻撃力が効く。下の「ステータス」） |
| U / 画面の「必殺」 | 必殺技（必殺ゲージが満タンのとき。全方位の回転斬りを 3 回。出している間は当たらない） |
| O / 画面の「みんなと遊ぶ」「1人に戻る」 | マルチプレイのサーバーが設定されているときだけ: 部屋に入る・抜ける（開いた直後は 1 人用） |
| B / 画面の「戦闘 OFF・ON」 | マルチプレイのときだけ: 戦闘オン・オフ（オンの人同士だけ攻撃が当たる。下の「マルチプレイ」） |
| L / 画面の「オンライン ○ 人」 | マルチプレイのときだけ: 参加者の一覧（撃破数） |
| （自動） | 走り・ダッシュで柵や塀に向かうと、飛び越える・よじ登る（下の「パルクール」。歩きでは発動しない） |
| マウス / ホイール | 視点 / ズーム（歩いている間、カメラはキャラの後ろ・少し上へ自動で回り込む） |
| E | 修正モード（建物の削除・高さ変更・追加。保存すると街を作り直す） |
| P | 現在地のストリートビューを Google マップで開く（別タブ） |
| M | 大きいマップ（ホイールで拡大縮小・ドラッグで移動・F で現在地へ・M / Esc で閉じる） |
| T | 時間帯（昼 → 夕方 → 夜 → 朝。時間が進んで向かう） |
| R | スポーン地点に戻る |
| G | 街のメッシュを GLB で書き出し（Unity 移行用） |
| H | ヘルプ表示切替 |
| I / メニューの「撮影モード」 | 撮影モード（画面の表示を全部消して、ズームと視点だけにする。下の「撮影モード」） |

### スマホ・タブレット（タッチ操作）

タッチ専用の端末で開くと、自動でタッチ操作になる（`public/src/touch.js`）。PC で試すときは URL に `?touch`。

| 操作 | 動作 |
|---|---|
| 画面の左側をドラッグ | 移動（触れた所にスティックが出る。浅く倒すと歩き、深く倒すと走り） |
| 画面の右側をドラッグ | 視点 |
| 2 本指でつまむ | ズーム |
| ジャンプ / ダッシュ | ジャンプ（2段）/ 押している間ダッシュ |
| 地図（ミニマップのタップでも可） | 大きいマップ（ドラッグで移動・つまんで拡大縮小・タップで行き先・「ワープ」で移動） |
| 時間 / 戻る / 写真 | 時間帯 / スタート地点に戻る / ストリートビュー |
| 撮影 | 撮影モード（画面をタップで「×」が出る。下の「撮影モード」） |

修正モード（E）と GLB 書き出し（G）は PC 専用。タッチ操作のときは軽くするため、解像度の倍率の上限を 1.5、影の解像度を半分にしている。
iPhone はタブが使えるメモリが少なく、超えるとページごと落ちる（「このページを開けません」）。そのためタッチ操作のときは `public/src/lowmem.js` でメモリを節約している:
頂点データの JS 側の控えを GPU に送った後に手放す、看板などの模様を半分の解像度で作って描画用のメモリを手放す、キャラ（VRM）の 2048 px の模様を 1024 px に縮める、地面の法線と色を小さい型で持つ。
重いときは URL に `?noshadow`（影なし）・`?pr=1`（解像度を下げる）・`?noaa`、フレームレートを画面に出すには `?perf`。

### スマホから開く（GitHub Pages）

`main` に入るたびに、`public/` が GitHub Pages に自動で公開される（`.github/workflows/pages.yml`）。
URL は `https://ayakotaru-commits.github.io/nte-totsuka/`。初回だけ、リポジトリの Settings → Pages → Source を「GitHub Actions」にする。
公開されるのはゲームの表示だけで、修正モードの保存（`tools/server.py` の API）は使えない。

## 出典
- 地図データ © OpenStreetMap contributors (ODbL)
- 建物の輪郭: 国土地理院ベクトルタイル／標高: 国土地理院 標高タイル
- 建物データ: 国土交通省 Project PLATEAU 3D都市モデル 横浜市 (2024年度)
- 建物の形・屋根の色: 神奈川県 令和3年度 横浜南部、湘南、横須賀三浦 3次元点群データ（点群・オルソ画像）(CC BY 4.0, G空間情報センター)
- 壁の色: Mapillary の路上写真から読んだ値 (CC BY-SA 4.0)
- 音楽（ゲームセンターのリズムステージの歌入りの 4 曲）: フリーボーカルMusic【NeWorld】 https://music.freegame-contest.com/ （作詞・作曲: R2、歌: aya）
