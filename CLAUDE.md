# CLAUDE.md — company_management_system

契約企業マネジメントシステム（CS 向け。Cloudflare Workers + React + BigQuery マート + D1）。編集前に次を読む。

1. [`README.md`](./README.md)（全体像・API・セキュリティの前提）
2. 触る画面の `src/app/features/<feature>/README.md`、触るマートの `bq/marts/<table>/README.md`
3. 数字の式を変えるなら [`docs/指標定義.md`](./docs/指標定義.md) と `src/shared/metrics/definitions.ts`（同じ内容を両方に書く）。マートのロジック（結合・絞り込み・重複排除・期間）や元の列を変えたら [`docs/数値の出所.md`](./docs/数値の出所.md) も直す
4. BQ 接続・テーブル定義・ビジネス定義（RA/RDS 除外、興味あり判定、スナップショット重複排除）は `tanatoshi1245/claude_analysis` の `CLAUDE.md` を正とする

## AI 機能（左のレールの AI メニュー。2026-11-27 ユーザー指示で Vertex AI 方式に）

- **⛔ 本番は停止中（2026-11-27 ユーザー指示）**: 情報の漏えい・学習のおそれを確かめ終えるまで、本番では AI を動かさない（停止スイッチ `AI_ENABLED`。`src/worker/ai/enabled.ts`。既定は停止）。**テスト環境だけ `"1"`** で、使えるのは「条件を指定」「求人 ID」の 2 つ（同日ユーザー指示）。会員 ID から作る機能は、どの環境でも閉じる（`AI_SCOUT_MEMBER = "0"`）。**ユーザーが明示するまで、本番の `AI_ENABLED` を `"1"` にしない・`AI_SCOUT_MEMBER` を開けない・週次の cron を戻さない・`cms_ai_*` のスケジュールドクエリを有効にしない・実在の会員の情報を Vertex AI へ送る確認をしない**（`docs/AI機能.md` の「本番で動かす前に確かめること」）
- **候補者の職務経歴・自己PR（閲覧制限付きの `dwh_restricted`）は使わない**（2026-11-27 に取り外した。ユーザー指示）。Worker・SQL・日次スクリプトから `dwh_restricted` を読まない（`tests/worker/aiScoutData.test.ts` が検査）。戻すときは、ユーザーの指示と、利用目的・同意の確認が先
- 設計・設定・制約は [`docs/AI機能.md`](./docs/AI機能.md)。**Worker が Vertex AI を直接呼ぶ**（`src/worker/ai/vertex.ts`）。依頼のたびに Claude Code のセッションを立ち上げる方式は、やめた（戻さない。ログインの外の入口を作らない）
- **機能は 1 つずつ作って本番へ出す**（スカウト → 求人 → 分析レポート。前の機能を本番へ出すまで、次に取り掛からない）。求人・分析レポートの画面のコード（`src/app/features/ai/{job,report}/`）は残してあるが、メニュー・ルートから外してある
- スカウト: 分析対象の決まり（類似業界 × 直近 1 年 × 返信率 10% 超の上位 1000 件。無ければ返信率の高い順。条件を指定したら、その条件の送信で数え直す）は `src/shared/ai/scout.ts` の定数と `src/worker/sql/aiScout.ts`。マートは `bq/ai/scout_marts.sql`（日次の別スケジュールドクエリ。設定 ID は `bq/README.md`）。SQL を変えたら、スケジュールドクエリにも貼り替える
- スカウトは、**使う人が最初に「何をもとに作るか」（条件 / 求人 ID / 会員 ID / 両方）を選び、内容を確かめてから実行ボタンで AI を動かす**（2026-11-27 ユーザー指示）。確かめる API では Vertex AI を呼ばない。求人は選んだ企業のものだけ（`company_id` と `job_id` の両方で引く）。年齢層・年収帯は文面に書かせず、国籍・会員 ID・企業名は Vertex AI へ渡さない
- 会員 ID をもとに作った案は、ほかの依頼の参考にも BigQuery にも出さない（`repo.ts`）
- **3 つのモデル**（`src/worker/ai/scout/models.ts`）の作り方（プレイブック）は D1 で版を持ち、検証とチューニングのループ（`tuning.ts`。週次の cron + 管理者の手動）が書き換える。総合点の式・定数を変えたら `docs/AI機能.md` も直す
- **トークンを抑える**: 数値は SQL で出す・AI に渡す文面は上位 24 件まで・同じ条件の分析は 1 週間使い回す・思考トークンを使わない。プロンプトを足すときは、入力の大きさを確かめる
- Vertex AI へ企業名を渡さない。入力・作られた文面・プレイブックの社名と個人情報の確認（`src/shared/ai/pii.ts`）を外さない。生成モデルの ID は `wrangler.jsonc` の vars に置く（コードに直接書かない）
- **テスト環境**は [`docs/テスト環境.md`](./docs/テスト環境.md)。ユーザーが「テスト環境で確認したい」と言ったときは、作業ブランチを `git push origin HEAD:staging --force` で出し、確認の返事を待ってから `main` へマージする。`staging` は写しのブランチで、作業の元にしない・`main` へマージしない

## 守ること

- **SQL は `@param` だけ**（`src/worker/sql/*`）。文字列連結でクエリを組み立てない。テーブル名は `bq-hgt.dwh.cms_*` 固定。生テーブルを Worker から読まない（マートに列を足す）
- **D1 は `prepare().bind()`**。更新と監査ログ（`AuditRepo.insertStmt`）を同じ `db.batch()` に入れる。`company_id` は URL パスからだけ受け取る
- **書き込みルートは `requireVerified`** を付ける（`sameOriginGuard` は `/api/*` に掛かっている）。入力は `src/shared/schema/*` の zod（`.strict()`）で検証する
- **認証情報をコード・フロント・リポジトリに置かない**（Workers Secret のみ）。`git ls-files` で確認する。`/api/health` に値を出さない
- **応答の形・指標の式・ヒートマップの閾値を変えたら `DATA_VERSION`（`src/shared/schema/common.ts`）を +1** し、`docs/指標定義.md` と README を直す
- **チャート / ヒートセルを書く前に `dataviz` スキルをロード**し、パレットを変えたら `validate_palette.js` の結果を `src/app/components/charts/README.md` に記録する
- **新しいディレクトリには README**（YAML フロントマター `tags`（claude_analysis の `00_セマンティックレイヤー/タグ体系.md`）、役割、依存するデータ、編集の入口、テスト）。`tests/repo/readme-frontmatter.test.ts` が検証する
- 変更後は `npm run typecheck && npm test && npm run build && npx wrangler deploy --dry-run --outdir /tmp/wr` を通してからコミットする
- マートの SQL を変えたら dry run でスキャン量を確認し、`bq/README.md` に記録する。登録済みスケジュールドクエリ（設定 ID は `bq/README.md`）にも貼り替える
- コミットメッセージ・コード・ドキュメントにモデル名を書かない

## よく触る場所

| やりたいこと | 場所 |
|---|---|
| ボードの列・指標を足す | `src/shared/metrics/definitions.ts` → `bq/marts/scheduled_query.sql`（列）→ `src/worker/sql/companyMonthly.ts` → `src/shared/schema/board.ts` → `features/home/components/CompanyBoard.tsx` |
| 判定の閾値 | `src/shared/metrics/{pace,heatmap,health}.ts` |
| 画面の文言・ラベル | `src/shared/labels.ts`、注記は `src/shared/caveats.ts` |
| 目標の項目を増やす | `d1/migrations/`（新規ファイル）→ `src/shared/schema/targets.ts` → `src/worker/d1/targetsRepo.ts` → `features/targets/targetsModel.ts` |
| 祝日 | `npm run holidays:update <CSV>` |
