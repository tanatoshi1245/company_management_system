---
tags: [domain/application, layer/application, type/data-dictionary]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# d1 — ユーザー入力データ（Cloudflare D1）

## 役割
BQ のデータは持たない。目標（company_targets）・企業設定（company_settings: 担当上書き・枠の期間/上書き・メモ）・監査ログ（audit_log）・app_meta（cache_epoch）・プラン別既定目標（plan_target_defaults）・スカウト未利用の理由・補足（scout_unused_entries。正はここ、BigQuery `scout_unused_companies_monthly`（`match_method = 'app'` の行）へは MERGE で写し `bq_synced_at` で反映状態を持つ。2026-10-23 の `0003_scout_unused.sql`）。

## 依存するデータ・スキーマ
`migrations/0001_init.sql`, `0002_plan_defaults.sql`。ソースは画面からの入力（編集者メールはセッションから）。

| テーブル | 書くルート | リポジトリ |
|---|---|---|
| company_targets | PUT/DELETE `/api/companies/:id/targets/:month`, POST `…/copy`, POST `/api/targets/bulk-defaults` | `src/worker/d1/targetsRepo.ts` |
| company_settings | PUT `/api/companies/:id/settings` | `settingsRepo.ts` |
| scout_unused_entries | PUT / DELETE `/api/scout-unused/:companyId/:month`、POST `/api/scout-unused/sync` | `scoutUnusedRepo.ts` |
| plan_target_defaults | PUT `/api/settings/plan-defaults` | `planDefaultsRepo.ts` |
| audit_log | 上記すべて（本体と同じ `db.batch()`） | `auditRepo.ts` |
| app_meta | POST `/api/admin/cache/bump` | `appMetaRepo.ts` |

すべて `prepare().bind()`。JSON 列（`stage_targets_json`）は許可キーだけを再シリアライズして保存する。`flags_json` は現状 `'{}'` 固定。

## 運用
- ローカル: `npm run d1:migrate:local`（wrangler dev 用）/ `npm run seed:local`
- 本番: D1 `company-management-system` を作って `wrangler.jsonc` に Database ID を書き、`npm run d1:migrate:remote`（docs/デプロイ手順.md）
- 監査ログは削除しない（who / when / what）

## テスト
tests/helpers/fakeD1.ts（node:sqlite に migrations を適用）
