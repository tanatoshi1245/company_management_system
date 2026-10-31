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

GA4 BigQuery エクスポート analytics_258261950.events_*, analytics_553479599.events_*（event_name = 'get_ID'）, company_users（社内メンバーの判定）

## 直接・紹介・派遣の企業では社内メンバーのログインを数えない（2026-10-31〜）

`company_users.email` が `@daijob.com` で、所属企業（`company_users.company_id`）の企業種別が 直接 / 紹介 / 派遣 のユーザー（GA4 の `user_id` = `company_users.id`）の `get_ID` は集計に入れない。DA / RPO は社内のコンサルタントが運営する企業なので社内メンバーのログインも数える。CS が自分のアカウントで企業の画面を開くと、企業の最終ログインが更新されてしまうため。`user_id` が無いイベント・`company_users` に無い `user_id`（削除済みアカウント）は判定できないので数える。`staging+…@daijob.com`（取り込み時のマスク値）は社内扱いにしない。`@athuman.com` など他の社内ドメインは対象外。ロジックは [`docs/数値の出所.md` §6.6](../../../docs/数値の出所.md)。

## 更新
`bq/marts/scheduled_query.sql`（毎日 22:45 UTC = 07:45 JST）。生成ロジックの変更時は Worker の `src/worker/sql/` と `src/shared/schema/` を合わせ、`DATA_VERSION` を +1 する。
