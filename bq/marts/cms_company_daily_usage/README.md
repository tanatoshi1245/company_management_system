---
tags: [domain/company-behavior, layer/engineering, type/data-mart-spec, source/bq-internal, table/cms_company_daily_usage, table/scouts, table/member_applications, table/job_publish_history]
related:
  - "[[bq/README]]"
  - "[[docs/指標定義]]"
status: active
---

# `bq-hgt.dwh.cms_company_daily_usage` — 企業 × 日の利用状況（前月 + 当月、累積付き）

**粒度**: usage_date × company_id（前月初〜昨日）。**更新**: 全件差し替え。対象は contract_state が active / ending_30d / ended_recent / upcoming の企業。

## 列定義

| 列 | 型 | 意味 |
|---|---|---|
| usage_date / month / day_of_month / company_id | DATE / DATE / INT64 / INT64 | |
| scout_sent / scout_sent_cum / scout_sent_manual_cum | INT64 | その日の送信 / 月内累積（手動のみの累積） |
| applications / applications_cum / interested / interested_cum / job_views / job_views_cum | INT64 | 日次と月内累積（興味ありは初回返信日） |
| active_jobs | INT64 | その日に掲載中の求人（set_id 重複排除） |
| login_events | INT64 | CT ログイン回数 |
| scout_limit | INT64 | 現在の枠 |

## 元テーブル（依存するデータ）

scouts, scout_histories, member_applications, member_job_detail_views, job_publish_history, jobs_all, cms_company_login_daily

## 更新
`bq/marts/scheduled_query.sql`（毎日 22:45 UTC = 07:45 JST）。生成ロジックの変更時は Worker の `src/worker/sql/` と `src/shared/schema/` を合わせ、`DATA_VERSION` を +1 する。
