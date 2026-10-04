# ランキングのCloudflare設定

1. D1データベース `waiwai-ranking` のConsoleで `schema.sql` を実行する。
2. Workers & PagesでWorker `waiwai-ranking-api` を作成する。
3. Workerのコードを `worker.js` の内容に置き換えてDeployする。
4. WorkerのBindingsでD1 databaseを追加する。Variable nameは `DB`、データベースは `waiwai-ranking` を選ぶ。
5. Worker URLの末尾に `/api/ranking` を付けて開く。未登録なら `{"ranking":[]}` が返る。

## ゲームへの反映

`ranking.js` にWorkerのURLを設定済み。ゲーム開始前にユーザー名を入力し、ゲーム終了時に
スコアを自動送信する。名前は端末に記憶する。画面下の「みんなのランキング」で上位10件を表示できる。
通信に失敗してもゲームは遊べる。一時停止の「スコアを登録して終了」から途中のスコアも登録できる。
保存完了の表示を確認してからページを閉じる。途中での再スタートやページを閉じた時点のスコアは送信しない。

GitHub Pagesの公開ファイルに、`index.html`・`style.css`・`game.js`・`music.js`・`ranking.js` と
`assets/` を反映する。使用中の画像は `assets/images/`、BGMは `assets/bgm/` に保存する。
Workerのコードはゲーム本体から独立してCloudflareに公開する。

ゲーム画面からは、Worker URLに対して次のリクエストを送る。

- `GET /api/ranking`：名前ごとの最高スコアを集計し、上位10件を取得。同点は最高点を先に登録した記録が上位。
- `POST /api/scores`：JSONで `{"username":"わいわい","score":1234}` を送って記録を保存。

名前は1〜12文字。ログイン不要で、同じ名前を複数人が使える。各プレイの記録を保存するが、
ランキングには同じ名前の最高点だけを表示する。過去の記録もそのまま集計する。
この変更を公開する際はCloudflareのWorkerコードも更新してDeployする。D1の再作成や記録の削除は不要。
本体のゲーム公開先はGitHub Pagesのままでよい。

任意でWorkerのVariablesに `ALLOWED_ORIGIN` を設定できる。値はゲーム公開URLのorigin
（例：`https://example.github.io`。末尾のスラッシュやリポジトリ名を含めない）。
未設定時はすべてのoriginからアクセスできる。
このAPIはブラウザから送られたスコアを保存する。ゲーム内容をサーバーで再現する検証は行わない。
