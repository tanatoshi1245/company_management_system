---
tags: [domain/company-behavior, layer/engineering, type/data-mart-spec, source/bq-internal, table/cms_company_login, table/cms_company_login_daily]
related:
  - "[[bq/README]]"
  - "[[docs/指標定義]]"
status: active
---

# `bq-hgt.dwh.cms_company_login` — 企業ごとの CT ログイン要約

**粒度**: company_id（マスタの企業）。**更新**: 全件差し替え。

## 列定義

| 列 | 型 | 意味 |
|---|---|---|
| first_seen_date / last_login_at / last_login_date / days_since_login | — | 初回 / 最終ログイン（JST 変換はアプリ側）/ 昨日からの経過日数 |
| login_days_mtd / login_days_30d / login_days_90d / login_events_30d | INT64 | 期間内のログイン日数・回数 |
| data_available_from / data_through_date / sources | DATE / DATE / ARRAY | 2026-05-15 / 取り込めている最終日 / 出所データセット |

## 元テーブル（依存するデータ）

cms_company_login_daily, cms_company_master

## 更新
`bq/marts/scheduled_query.sql`（毎日 22:45 UTC = 07:45 JST）。生成ロジックの変更時は Worker の `src/worker/sql/` と `src/shared/schema/` を合わせ、`DATA_VERSION` を +1 する。
