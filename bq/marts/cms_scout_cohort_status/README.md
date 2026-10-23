---
tags: [domain/company-behavior, layer/engineering, type/data-mart-spec, source/bq-internal, table/cms_scout_cohort_status, table/scouts, table/scout_histories]
related:
  - "[[bq/README]]"
  - "[[docs/指標定義]]"
status: active
---

# `bq-hgt.dwh.cms_scout_cohort_status` — 興味あり返信月 × 現ステータス（スカウト経路）

**粒度**: company_id × cohort_month（初回の興味あり返信月）× application_status。**更新**: 全件差し替え。ステータスは現在値（履歴なし）。

## 列定義

| 列 | 型 | 意味 |
|---|---|---|
| company_id / cohort_month | INT64 / DATE | |
| application_status | STRING | scouts.application_status（空は (未設定)） |
| scouts / members | INT64 | 件数（スカウト / 会員の distinct） |

## 元テーブル（依存するデータ）

scouts, scout_histories

## 更新
`bq/marts/scheduled_query.sql`（毎日 22:45 UTC = 07:45 JST）。生成ロジックの変更時は Worker の `src/worker/sql/` と `src/shared/schema/` を合わせ、`DATA_VERSION` を +1 する。
