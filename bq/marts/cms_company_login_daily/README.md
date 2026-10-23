---
tags: [domain/company-behavior, layer/engineering, type/data-mart-spec, source/bq-internal, table/cms_company_login_daily, source/ga4]
related:
  - "[[bq/README]]"
  - "[[docs/指標定義]]"
status: active
---

# `bq-hgt.dwh.cms_company_login_daily` — CT ログインの日次集計（GA4 get_ID）

**粒度**: login_date × company_id × source_dataset。**更新**: 直近 3 日を取り直し（GA4 は 1〜2 日遅れる）。初回は init.sql で 2026-05-15（旧CT）/ 2026-10-14（新CT）から一括取込。

## 列定義

| 列 | 型 | 意味 |
|---|---|---|
| login_date / company_id | DATE / INT64 | JST の日付、event_params.company_id |
| login_events / last_event_ts | INT64 / TIMESTAMP | get_ID の回数 / 最後の時刻 |
| source_dataset | STRING | analytics_258261950（旧CT）/ analytics_553479599（新CT） |

## 元テーブル（依存するデータ）

GA4 BigQuery エクスポート analytics_258261950.events_*, analytics_553479599.events_*（event_name = 'get_ID'）

## 更新
`bq/marts/scheduled_query.sql`（毎日 22:45 UTC = 07:45 JST）。生成ロジックの変更時は Worker の `src/worker/sql/` と `src/shared/schema/` を合わせ、`DATA_VERSION` を +1 する。
