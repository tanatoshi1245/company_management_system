---
tags: [domain/company-behavior, layer/engineering, type/data-mart-spec, source/bq-internal, table/cms_application_cohort_status, table/member_applications]
related:
  - "[[bq/README]]"
  - "[[docs/指標定義]]"
status: active
---

# `bq-hgt.dwh.cms_application_cohort_status` — 応募月 × 現ステータス（応募経路）

**粒度**: company_id × cohort_month（応募月）× status。**更新**: 全件差し替え。ステータスは現在値。

## 列定義

| 列 | 型 | 意味 |
|---|---|---|
| company_id / cohort_month | INT64 / DATE | |
| status | STRING | member_applications.status（空は (未設定)） |
| applications / members | INT64 | |

## 元テーブル（依存するデータ）

member_applications

## 更新
`bq/marts/scheduled_query.sql`（毎日 22:45 UTC = 07:45 JST）。生成ロジックの変更時は Worker の `src/worker/sql/` と `src/shared/schema/` を合わせ、`DATA_VERSION` を +1 する。
