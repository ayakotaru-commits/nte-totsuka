<!-- README.md から移した節（確認用の道具）。内容は変えていない -->

### 確認用の道具（tools/dev/）
- `tools/dev/shot.js`: ゲームをヘッドレスブラウザで起動し、指定した視点のスクリーンショットを撮る（修正前後の見比べ用。使い方はファイル先頭のコメント、視点の例は `tools/dev/views.example.json`）
- `tools/dev/evalroof.py`: 屋根の形の確かさを数字で測る（モデルの屋根の高さと点群の高さの誤差）
- `tools/dev/touchshot.js`: タッチ操作の確認。スマホの画面サイズのヘッドレスブラウザに指の動きを疑似的に送り、キャラ・カメラ・地図の反応を数字と画像で出す（使い方は先頭のコメント。全体で 10 分ほど）
- `tools/dev/speedcheck.js`: 描画が遅くてもキャラの速さが実時間で落ちないことの確認（進んだ距離 ÷ 実際の時間。`--old` で以前の計算と比べる）
- `tools/dev/mpcheck.js`: マルチプレイの確認。手元のサーバー（`server/local.js`）とヘッドレスブラウザ 2 つで、お互いが見える・動きが伝わる・戦闘オン同士だけ当たる・倒れて復活する、を数字で確かめて画面を撮る（先に `cd server && npm install`。約 5 分）
- `tools/dev/memcheck.js`: メモリの内訳（メッシュごとの頂点データ・模様の大きさ・JS のヒープ）を出す。`node tools/dev/memcheck.js "?touch"` でスマホの設定、引数なしで PC の設定
- `tools/dev/charview.html`: キャラだけを 4 方向（正面・真後ろ・斜め後ろ・手元）から見るページ。街を読み込まないのですぐ開く。リポジトリの直下を配信して開く（`python -m http.server 8772 --bind 127.0.0.1` → `http://127.0.0.1:8772/tools/dev/charview.html?pose=5.5&live`）。`pose` は速さ（0 立ち / 1.6 歩き / 5.5 走り）、`face` を付けると手元の代わりに顔のアップ。詳しくはファイル先頭のコメント。ヘッドレスで撮るのは `tools/dev/charshot.js`（使い方は先頭のコメント）
- ゲーム本体の撮影用: `?shot&pose=5.5` で、その場で走りの姿勢になる
- `tools/dev/arcade_test.mjs`（リズムゲームの判定・点数。`node` だけで動く）/ `tools/dev/arcadeshot.js`（リズムゲームの画面だけを撮る。街を読み込まない）/ `tools/dev/arcadecheck.js`（ゲーム本体での通しの確認。ブラウザ）
- `tools/dev/walkcheck.js`: 歩道橋・デッキ・階段を歩いて通れるかを、ゲームの当たり判定で調べる（中心線を 0.25 m ごとにたどり、0.4 m を超える段差と、手すり・建物に体が重なる所を通路ごとに数える）。`node tools/dev/walkcheck.js`
- `tools/dev/parkcheck.js`（千葉ドリームランドの試作を歩いて確かめる）/ `tools/dev/parkshot.js`（その画面を撮る。`--nopark` で修正前）
- 作業の進め方とクラウド環境での注意点は `CLAUDE.md`

