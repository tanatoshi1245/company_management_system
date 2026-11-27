# CLAUDE.md — company_management_system

契約企業マネジメントシステム（CS 向け。Cloudflare Workers + React + BigQuery マート + D1）。編集前に次を読む。

1. [`README.md`](./README.md)（全体像・API・セキュリティの前提）
2. 触る画面の `src/app/features/<feature>/README.md`、触るマートの `bq/marts/<table>/README.md`
3. 数字の式を変えるなら [`docs/指標定義.md`](./docs/指標定義.md) と `src/shared/metrics/definitions.ts`（同じ内容を両方に書く）。マートのロジック（結合・絞り込み・重複排除・期間）や元の列を変えたら [`docs/数値の出所.md`](./docs/数値の出所.md) も直す
4. BQ 接続・テーブル定義・ビジネス定義（RA/RDS 除外、興味あり判定、スナップショット重複排除）は `tanatoshi1245/claude_analysis` の `CLAUDE.md` を正とする

## AI 機能（左のレールの AI メニュー。2026-11-27 ユーザー指示で Vertex AI 方式に）

- **⛔ 2026-11-27 から停止中（ユーザー指示）**: 情報の漏えい・学習のおそれを確かめ終えるまで、AI の実行（停止スイッチ `AI_ENABLED = "0"`。`src/worker/ai/enabled.ts`）・週次の cron・`cms_ai_*` の日次更新（スケジュールドクエリを無効）を止めてある。**ユーザーが「再開してよい」と明示するまで、`AI_ENABLED` を `"1"` にしない・cron を戻さない・スケジュールドクエリを有効にしない・`cms_ai_*` の表を作り直さない・Vertex AI を呼ぶ確認をしない**（`docs/AI機能.md` の「再開の前に確かめること」）
- 設計・設定・制約は [`docs/AI機能.md`](./docs/AI機能.md)。**Worker が Vertex AI を直接呼ぶ**（`src/worker/ai/vertex.ts`）。依頼のたびに Claude Code のセッションを立ち上げる方式は、やめた（戻さない。ログインの外の入口を作らない）
- **機能は 1 つずつ作って本番へ出す**（スカウト → 求人 → 分析レポート。前の機能を本番へ出すまで、次に取り掛からない）。求人・分析レポートの画面のコード（`src/app/features/ai/{job,report}/`）は残してあるが、メニュー・ルートから外してある
- スカウト: 分析対象の決まり（類似業界 × 直近 1 年 × 返信率 10% 超の上位 1000 件。無ければ返信率の高い順。条件を指定したら、その条件の送信で数え直す）は `src/shared/ai/scout.ts` の定数と `src/worker/sql/aiScout.ts`。マートは `bq/ai/scout_marts.sql`（日次の別スケジュールドクエリ。設定 ID は `bq/README.md`）。SQL を変えたら、スケジュールドクエリにも貼り替える
- スカウトは、**使う人が最初に「何をもとに作るか」（条件 / 求人 ID / 会員 ID / 両方）を選び、内容を確かめてから実行ボタンで AI を動かす**（2026-11-27 ユーザー指示）。確かめる API では Vertex AI を呼ばない。求人は選んだ企業のものだけ（`company_id` と `job_id` の両方で引く）。年齢層・年収帯は文面に書かせず、国籍・会員 ID・企業名・候補者の勤務先の社名は Vertex AI へ渡さない
- **候補者の職務経歴・自己PR**（閲覧制限付きの `dwh_restricted`）は、`dwh_restricted.cms_ai_member_resumes` の 1 表だけを読む（Worker が `dwh.cms_*` の外で読む、ただ 1 つの例外。ほかの `dwh_restricted` の表を読まない・本文を `dwh` へ写さない）。本文は Vertex AI へ渡すだけで、画面・API の応答・結果・D1・ログに出さない / 残さない。固有名詞を文面に写させない決まりと、丸写しの判定（`src/worker/ai/scout/target.ts`）を外さない。会員 ID をもとに作った案は、ほかの依頼の参考にも BigQuery にも出さない（`repo.ts`）
- **3 つのモデル**（`src/worker/ai/scout/models.ts`）の作り方（プレイブック）は D1 で版を持ち、検証とチューニングのループ（`tuning.ts`。週次の cron + 管理者の手動）が書き換える。総合点の式・定数を変えたら `docs/AI機能.md` も直す
- **トークンを抑える**: 数値は SQL で出す・AI に渡す文面は上位 24 件まで・同じ条件の分析は 1 週間使い回す・思考トークンを使わない。プロンプトを足すときは、入力の大きさを確かめる
- Vertex AI へ企業名を渡さない。入力・作られた文面・プレイブックの社名と個人情報の確認（`src/shared/ai/pii.ts`）を外さない。生成モデルの ID は `wrangler.jsonc` の vars に置く（コードに直接書かない）
- **テスト環境**は [`docs/テスト環境.md`](./docs/テスト環境.md)。ユーザーが「テスト環境で確認したい」と言ったときは、作業ブランチを `git push origin HEAD:staging --force` で出し、確認の返事を待ってから `main` へマージする。`staging` は写しのブランチで、作業の元にしない・`main` へマージしない

## 守ること

- **SQL は `@param` だけ**（`src/worker/sql/*`）。文字列連結でクエリを組み立てない。テーブル名は `bq-hgt.dwh.cms_*` 固定（例外は `bq-hgt.dwh_restricted.cms_ai_member_resumes` の 1 表だけ = AI 機能の節）。生テーブルを Worker から読まない（マートに列を足す）
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
