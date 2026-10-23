---
tags: [domain/application, layer/application, type/code-index, table/cms_refresh_log]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# worker/sql — マート読み取り SQL（@param のみ）

## 役割
マートごとに 1 つの BuiltQuery ビルダー。利用者入力はすべて `p.*`（queryParameters）で渡し、SQL 本文に埋め込まない。テーブル名は `bq-hgt.dwh.cms_*` の固定リスト。

## 依存するデータ（ビルダー → マート → 元テーブル）
| ビルダー | マート | 元テーブル（マート README 参照） |
|---|---|---|
| refreshLog.ts | cms_refresh_log | （スクリプトの実行記録） |
| companyMaster.ts | cms_company_master | companies, company_profiles(_all), sf_contracts, sf_accounts, sf_opportunities, sf_users, active_companies, cms_dim_industry_alias |
| companyMonthly.ts | cms_company_monthly | scouts, scout_histories, member_applications, member_job_detail_views, job_publish_history, jobs_all, cms_company_login_daily |
| companyLogin.ts | cms_company_login | GA4 analytics_*（`get_ID`） |
| industryBenchmark.ts | cms_industry_benchmark_monthly | cms_company_monthly, cms_company_master |
| companyDetail.ts（8 ビルダー: company_master_one / company_monthly_one / daily_usage / scout_cohort / application_cohort / member_attributes / bench_series / company_login_one） | cms_company_master, cms_company_monthly, cms_company_daily_usage, cms_scout_cohort_status, cms_application_cohort_status, cms_scout_member_attributes_monthly, cms_industry_benchmark_monthly, cms_company_login | 各マート README |

## テスト
tests/worker/sql.test.ts（@param 以外のリテラルが無いこと）
