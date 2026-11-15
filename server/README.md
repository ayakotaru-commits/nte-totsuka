# マルチプレイのサーバー

同じ街に入った人どうしの位置と動きを中継し、戦いの当たり判定と体力を決める小さなサーバー。
ゲーム本体（`public/`）は今までどおり静的なページのままで、このサーバーの場所を `public/src/net/config.js` に書いたときだけマルチプレイが働く（空なら 1 人用のまま）。

| ファイル | 役割 |
|---|---|
| `room.js` | 1 部屋ぶんの処理（入退室・位置の中継・当たり判定・体力・復活）。通信の中身の説明は先頭のコメント |
| `worker.js` + `wrangler.toml` | Cloudflare Workers 用の入口（部屋ごとに Durable Object を 1 つ） |
| `local.js` | 手元で試すための Node 用の入口（中身は同じ `room.js`） |
| `test.js` | `room.js` の確認（通信なし）。`node test.js` |
| `test-net.js` | 動いているサーバーへ実際につないで確かめる。`node test-net.js <ws の URL> [Origin]` |

## お金について

- Cloudflare の **無料プラン（Workers Free）** で動く構成にしてある。無料プランのまま使うかぎり請求は発生しない。上限を超えると、その日はマルチプレイがつながらなくなるだけ（1 人での散策は動く。上限は毎日 UTC 0 時 = 日本時間 9 時に戻る）。
- **有料プラン（Workers Paid）に切り替えない・支払い方法を登録しない** こと。切り替えると、使った分だけ課金される。
- 無料枠の目安（記憶と検索の要約による。このセッションからは Cloudflare の公式ページを開けず、**数字は未確認**。公開の前に「Durable Objects pricing」のページで確かめる）:
  リクエスト 10 万回/日（WebSocket で受け取るメッセージは 20 通で 1 回と数える）、実行時間 13,000 GB 秒/日。
  1 人が動いている間は 1 秒に 8 通送るので、合わせて「のべ 60〜70 人・時間/日」ほど。部屋が開いている時間は、合計で 1 日 28 時間ぶんほど。
- 無駄づかいを減らす仕組み: 立ち止まっている間は 2 秒に 1 通だけ送る／画面を隠して 1 分たつと切断する（戻るとつなぎ直す）／2 分間なにも送らない接続はサーバーが切る／だれも居ない部屋は時計を止める／許可したページ以外からの接続は断る（`wrangler.toml` の `ALLOWED_ORIGINS`）。

## 公開のしかた（持ち主の作業）

どちらの方法でも、最初に <https://dash.cloudflare.com/sign-up> で無料のアカウントを作る（支払い方法は登録しない）。
画面の項目名は変わることがある（公式ページで確かめられていない）。

### 方法 A: Cloudflare の画面から GitHub のリポジトリをつなぐ（鍵の登録が要らない）

1. Cloudflare の画面で「Workers & Pages」→「Create」→ GitHub のリポジトリ（`nte-totsuka`）を選ぶ。
2. 設定: ルートのフォルダ（Root directory）を `server`、公開のコマンド（Deploy command）を `npx wrangler deploy`、ブランチはこの作業のブランチ（`main` に入れた後は `main`）。
3. 公開が済むと `https://totsuka-mp.<アカウント名>.workers.dev` のような URL が出る。開いて「TOTSUKA multiplayer server」と出れば動いている。

### 方法 B: GitHub Actions から公開する

1. Cloudflare の画面の「My Profile」→「API Tokens」で「Edit Cloudflare Workers」のひな形からトークンを作る。アカウント ID は「Workers & Pages」の画面の右側に出ている。
2. GitHub のリポジトリの「Settings」→「Secrets and variables」→「Actions」に、`CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録する（トークンはチャットやファイルには書かない）。
3. 「Actions」→「マルチプレイのサーバーを公開」→「Run workflow」。（この項目は、`.github/workflows/mp-server.yml` が `main` に入ってから出る。）

### 公開した後

1. まず試す: ゲームの URL の後ろに `?mp=wss://totsuka-mp.<アカウント名>.workers.dev` を付けて開く（PC の `http://localhost:8000/` からも試せる）。左上に「オンライン 1 人」と出ればつながっている。別のタブや別の端末でも開くと、お互いが見える。
2. 常に有効にする: `public/src/net/config.js` の `SERVER` にその URL（`wss://` で始める）を書く。
3. ゲームを公開する場所が `https://ayakotaru-commits.github.io` 以外なら、`wrangler.toml` の `ALLOWED_ORIGINS` に足す。
4. やめるとき: `SERVER` を空に戻す。サーバーごと消すなら Cloudflare の画面で Worker `totsuka-mp` を削除する。

## 手元で試す（Node が要る）

```
cd server && npm install
node test.js                      # room.js の確認
node local.js                     # ws://localhost:8787 で待つ
# ゲームを http://localhost:8000/?mp=ws://localhost:8787 で開く (タブを 2 つ開くと、お互いが見える)
npx wrangler@4 dev --local        # Cloudflare 用の入口を、手元の実行環境で動かす (公開はしない)
node test-net.js ws://localhost:8787 http://localhost:8000
```

ブラウザ 2 つでの通しの確認は `node tools/dev/mpcheck.js <出力フォルダ>`（お互いが見える・動きが伝わる・戦闘オン同士だけ当たる・倒れて復活する、を数字で確かめ、画面を撮る。約 5 分）。

## 決まり（`room.js` の先頭の定数）

- 部屋: だれでも入れる部屋が 8 つ（`pub1`〜`pub8`、ゲーム側の `PUBLIC_ROOMS`）。1 部屋 16 人で、満員なら次の部屋へ。URL に `?room=合言葉`（英小文字・数字・ハイフン）を付けると、同じ合言葉の人だけの部屋になる。
- 名前: サーバーが自動で付ける（「あおいタヌキ」など）。自由に入力する名前・チャットは無い（荒らし対策）。アカウントも無く、送るのは位置と動きだけ。
- 戦闘: 「戦闘オン」にした人同士だけ当たる。体力 100、ダメージは手順 1〜5 で 12・12・16・22・28。倒れると 3 秒後にスタート地点で復活し、その後 3 秒は当たらない。6 秒当てられないと体力が戻る（1 秒に 8）。当てた・当てられた後の 5 秒は戦闘オフにできない。
- 当たり判定: 攻撃している人の位置・向き・手順と時間（剣の軌跡が出ている間）から、サーバーが相手との距離・角度・高さの差で決める。同じ一振りは 1 回だけ当たる。
- ズルへの備え: 体力と当たりはサーバーが決める。位置は申告を信じる（地図からのワープがあるため）。1 秒 40 通を超えるメッセージは捨てる。
