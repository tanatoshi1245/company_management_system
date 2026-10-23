---
tags: [domain/company-behavior, layer/engineering, type/data-mart-spec, source/bq-internal, table/cms_status_snapshot_daily, table/cms_scout_cohort_status, table/cms_application_cohort_status]
related:
  - "[[bq/README]]"
  - "[[docs/指標定義]]"
status: active
---

# `bq-hgt.dwh.cms_status_snapshot_daily` — コホート別ステータスの日次スナップショット

**粒度**: recorded_on × source（scout / application）× company_id × cohort_month × status。**更新**: 当日分を DELETE → INSERT。連続する日の差分で「今日採用になった件数」などの状態の動きが分かる（稼働開始日から蓄積）。

## 列定義

| 列 | 型 | 意味 |
|---|---|---|
| recorded_on / source / company_id / cohort_month / status / cnt | — | 上 2 表のコピー |

## 元テーブル（依存するデータ）

cms_scout_cohort_status, cms_application_cohort_status

## 更新
`bq/marts/scheduled_query.sql`（毎日 22:45 UTC = 07:45 JST）。生成ロジックの変更時は Worker の `src/worker/sql/` と `src/shared/schema/` を合わせ、`DATA_VERSION` を +1 する。
