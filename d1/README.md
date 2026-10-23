---
tags: [domain/application, layer/application, type/data-dictionary]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# d1 — ユーザー入力データ（Cloudflare D1）

## 役割
BQ のデータは持たない。目標（company_targets）・企業設定（company_settings: 担当上書き・枠の期間/上書き・メモ）・監査ログ（audit_log）・app_meta（cache_epoch）・プラン別既定目標（plan_target_defaults）。

## 依存するデータ・スキーマ
`migrations/0001_init.sql`, `0002_plan_defaults.sql`。ソースは画面からの入力（編集者メールはセッションから）。

## 運用
- ローカル: `npm run d1:migrate:local`（wrangler dev 用）/ `npm run seed:local`
- 本番: D1 `company-management-system` を作って `wrangler.jsonc` に Database ID を書き、`npm run d1:migrate:remote`（docs/デプロイ手順.md）
- 監査ログは削除しない（who / when / what）

## テスト
tests/helpers/fakeD1.ts（node:sqlite に migrations を適用）
