---
tags: [domain/application, layer/application, type/data-dictionary]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# d1 — ユーザー入力データ（Cloudflare D1）

## 役割
BQ のデータは持たない。目標（company_targets）・企業設定（company_settings: 担当上書き・枠の期間/上書き・メモ）・監査ログ（audit_log）・app_meta（cache_epoch）・プラン別既定目標（plan_target_defaults）・スカウト未利用の理由・補足（scout_unused_entries。正はここ、BigQuery `scout_unused_companies_monthly`（`match_method = 'app'` の行）へは MERGE で写し `bq_synced_at` で反映状態を持つ。2026-10-23 の `0003_scout_unused.sql`）・AI 機能の依頼と結果（ai_jobs。企業 × 機能ごとの履歴。2026-11-25 の `0004_ai_jobs.sql`。[docs/AI機能.md](../docs/AI機能.md)）・② スカウトの分析の要点の使い回し（ai_scout_insights）、3 つのモデルとプレイブックの版（ai_scout_models・ai_scout_model_versions）、文面の案とフィードバック・実績（ai_scout_drafts。選ばれた案は BigQuery へ写し `bq_synced_at` で反映状態を持つ）、検証・チューニングの実行の記録（ai_scout_tune_runs）（2026-11-27 の `0005_ai_scout.sql`）。

## 依存するデータ・スキーマ
`migrations/0001_init.sql`, `0002_plan_defaults.sql`, `0003_scout_unused.sql`, `0004_ai_jobs.sql`, `0005_ai_scout.sql`（番号順に適用。0003・0004・0005 は audit_log の entity の CHECK を足すために audit_log を作り直す。0005 は 3 つのモデルの初版も入れる = `src/worker/ai/scout/models.ts` と同じ文）。ソースは画面からの入力（編集者メールはセッションから）。

| テーブル | 書くルート | リポジトリ |
|---|---|---|
| company_targets | PUT/DELETE `/api/companies/:id/targets/:month`, POST `…/copy`, POST `/api/targets/bulk-defaults` | `src/worker/d1/targetsRepo.ts` |
| company_settings | PUT `/api/companies/:id/settings` | `settingsRepo.ts` |
| scout_unused_entries | PUT / DELETE `/api/scout-unused/:companyId/:month`、POST `/api/scout-unused/sync` | `scoutUnusedRepo.ts` |
| ai_jobs | POST `/api/companies/:id/ai/jobs`、PUT / DELETE `/api/ai/jobs/:jobId/edited`、DELETE `/api/ai/jobs/:jobId` | `src/worker/ai/repo.ts` |
| ai_scout_drafts | POST `/api/companies/:id/ai/jobs`（案ごとに 1 行）、PUT `/api/ai/jobs/:jobId/scout/choice`・`…/scout/usage`、検証・チューニング（実績の取り込み。cron と POST `/api/ai/scout/tune`） | `src/worker/ai/scout/repo.ts` |
| ai_scout_insights | POST `/api/companies/:id/ai/jobs`（分析の要点を作ったとき。期限切れは一緒に消す） | 同上 |
| ai_scout_models・ai_scout_model_versions | 検証・チューニング（新しい版）、POST `/api/ai/scout/models/:id/rollback` | 同上 |
| ai_scout_tune_runs | 検証・チューニングの実行ごとに 1 行（監査ログの代わりに、この表が記録） | 同上 |
| plan_target_defaults | PUT `/api/settings/plan-defaults` | `planDefaultsRepo.ts` |
| audit_log | 上記すべて（本体と同じ `db.batch()`） | `auditRepo.ts` |
| app_meta | POST `/api/admin/cache/bump` | `appMetaRepo.ts` |

すべて `prepare().bind()`。JSON 列（`stage_targets_json`）は許可キーだけを再シリアライズして保存する。`flags_json` は現状 `'{}'` 固定。`ai_jobs` の `input_json`・`result_json`・`edited_json` は zod（`src/shared/ai/`）で検証した値だけを保存する（② の各案の `feedback`・結果の `choice` は読み出しのときに付けるもので、保存しない）。`session_url`・`token_hash`・`token_expires_at`・`fired_at` は以前のセッション方式の列で、いまは書かない。監査ログの actor は、ログインした人のメールか `cron`（週次の検証・チューニング）。

## 運用
- ローカル: `npm run d1:migrate:local`（wrangler dev 用）/ `npm run seed:local`
- 本番: D1 `company-management-system` を作って `wrangler.jsonc` に Database ID を書き、`npm run d1:migrate:remote`（docs/デプロイ手順.md）
- 監査ログは削除しない（who / when / what）

## テスト
tests/helpers/fakeD1.ts（node:sqlite に migrations を適用）
