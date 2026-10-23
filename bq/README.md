---
tags: [domain/company-behavior, domain/scout, domain/application, layer/engineering, type/data-mart-spec, source/bq-internal]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# bq — アプリ用データマート cms_*（BigQuery）

## 役割
Worker がリクエスト時に読む日次マート（`bq-hgt.dwh.cms_*`）の SQL と定義。生テーブルは毎朝 1 本のスケジュールドスクリプトが 1 回ずつ走査し、Worker は生テーブルを読まない。

## 依存するデータ（元テーブル）
companies / company_profiles(_all) / active_companies / scouts / scout_histories / member_applications / member_details / member_profile_latest / member_job_detail_views / job_publish_history / jobs_all / sf_contracts / sf_accounts / sf_opportunities / sf_users / GA4 analytics_258261950。各マートの列は `marts/<mart>/README.md`。

## 更新
毎日 22:45 UTC（07:45 JST）に `marts/scheduled_query.sql`。初期化は `marts/init.sql`。登録・検証手順は M1 で追記。
