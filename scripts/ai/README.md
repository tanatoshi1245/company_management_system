---
tags: [domain/company-behavior, domain/scout, domain/job-posting, layer/application, type/app-spec, source/bq-internal]
related:
  - "[[docs/AI機能]]"
  - "[[ai/README]]"
  - "[[ai/session]]"
status: active
---

# scripts/ai — AI 機能のセッションが使う道具

## 役割
アプリの依頼で立ち上がった Claude Code のセッションが、依頼を受け取り・BigQuery を読み・結果を返すための 3 つのコマンド（手順は [ai/session.md](../../ai/session.md)）。
**できることを狭くしてある**: 送る先は Worker の hook だけ、実行できる SQL は `ai/<機能>/sql/` のファイルだけ、BigQuery は読むだけ。

| コマンド | ファイル | 内容 |
|---|---|---|
| `npm run ai:context -- --url <context の URL> --token <合言葉> [--out <file>]` | `context.ts` | 依頼の内容（入力・企業の条件・集計済みの数値・過去の結果）を受け取る |
| `npm run ai:sql -- <機能>/<名前> --param key=value … [--out <file>] [--dry]`、`npm run ai:sql -- --list` | `sql.ts` | 決まった SQL を、dry run → 上限の確認 → 実行。結果は JSON（`{ sql, bytesProcessed, cacheHit, rowCount, rows }`） |
| `npm run ai:submit -- --kind <report\|scout\|job> --url <result の URL> --token <合言葉> --file <JSON> [--dry]`、`… --fail "<理由>"` | `submit.ts` | 結果の形と個人情報を確かめてから返す / 失敗を返す |

| ファイル | 内容 |
|---|---|
| `lib.ts` | 判定と組み立て（宛先の制限・SQL のファイルの制限・宣言の読み取り・SELECT だけの検査・パラメータの組み立て）。ネットワークを使わない |
| `bq.ts` | BigQuery の鍵の取得と `RestBqClient`（`src/worker/bq/client.ts`）の用意。プロキシのある環境で Node の fetch を通す（`NODE_USE_ENV_PROXY`） |

## 制限（`lib.ts`）
- **宛先**: `https://<何か>.workers.dev/hook/ai/jobs/<jobId>/context`（`ai:context`）と `…/result`（`ai:submit`）だけ。手元の確認用に `http://127.0.0.1`・`http://localhost` も可。クエリ・ハッシュ・ユーザー名・ポート（本番）は不可。リダイレクトには従わない
- **SQL**: `<機能>/<名前>` は `scout|job|report` と英小文字・数字・`_` だけ（`..`・`/`・拡張子は書けない）。`ai/<機能>/sql/` に実在するファイル名と一致するものだけ
- **SQL の中身**: `WITH` / `SELECT` で始まる 1 文だけ。`INSERT`・`UPDATE`・`DELETE`・`MERGE`・`CREATE`・`DROP`・`ALTER`・`TRUNCATE`・`EXPORT`・`LOAD`・`CALL`・`EXECUTE`・`DECLARE`・`SET`・`BEGIN`・`INTO` などを含むものは実行しない。読めるのは `` `bq-hgt.dwh.*` `` だけ
- **パラメータ**: SQL の先頭で宣言した名前・型（`INT64`・`STRING`・`BOOL`・`ARRAY<STRING>`）・範囲だけ。値は BigQuery の `@param` で渡す（SQL の文字に埋め込まない）。文字列は 200 文字まで、配列は 10 個まで
- **スキャン量**: 必ず先に dry run し、宣言した上限（`-- max_bytes`）を超えたら実行しない（終了コード 3）。`maximumBytesBilled` にも同じ値を渡す。宣言できる上限は 30GB まで
- **出力先**: `--out` はリポジトリの外だけ（結果に個人名が含まれうる。ファイルは所有者だけが読める権限で作る）
- **結果**: `src/shared/ai/<kind>.ts` の `…ResultSchema`（strict）で検証し、違えば項目ごとの理由を出して送らない（終了コード 4）。200KB まで。メールアドレス・電話番号（`findPii` の block）があれば送らない。社名らしい・個人名らしい書き方（warn）は「注意」として出す
- 合言葉は、引数（`--token`）か環境変数 `AI_HOOK_TOKEN` で渡す。出力・ファイルに書かない

## 依存するデータ
- BigQuery（`ai/<機能>/sql/*.sql` が読む表。[ai/README.md](../../ai/README.md)）
- 鍵: `BQ_SA_KEY`（1 行 JSON）→ `BQ_SA_KEY_FILE`（鍵ファイル）→ `BQ_ACCESSOR_KEY`（アクセサー SA の鍵。Secret Manager `bq-sa-key-for-claude` から BigQuery 用の鍵を取る。claude_analysis の `fetch-bq-credentials.py` と同じ経路を Node の crypto で行う）。鍵・トークンはメモリの中だけ（ファイル・出力に書かない）
- Worker の `/hook/ai/jobs/:jobId/{context,result}`（`src/worker/ai/hook.ts`）、結果の型（`src/shared/ai/`）

## 編集の入口
- 宛先・SQL の制限を変える → `lib.ts`（テストも直す）
- 結果の型が増えた → `submit.ts` の `RESULT_SCHEMAS`
- 依存パッケージは足さない（tsx・zod と Node の標準だけ）

## テスト
`tests/repo/aiSql.test.ts`（宛先の制限・パスの制限・SELECT だけ・宣言と `@param`・パラメータの型・結果の検証）。
手元で: `BQ_SA_KEY_FILE=/tmp/bq-key.json npm run ai:sql -- job/peer_jobs --param company_id=<ID> --dry`、`npm run ai:submit -- --kind scout --file /tmp/x.json --dry`。
