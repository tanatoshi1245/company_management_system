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

例外は無い: 2026-11-27 に、候補者の職務経歴・自己PR を使う機能を外し（ユーザー指示）、閲覧制限付きのデータセット `dwh_restricted` の表を読む照会（`aiScoutMemberResumeQuery`）を消した。Worker・スクリプト・日次マートの SQL のどこにも `dwh_restricted` が出てこないことを、`tests/worker/aiScoutData.test.ts` が検査する。

## 依存するデータ（ビルダー → マート → 元テーブル）
| ビルダー | マート | 元テーブル（マート README 参照） |
|---|---|---|
| refreshLog.ts | cms_refresh_log | （スクリプトの実行記録） |
| companyMaster.ts | cms_company_master | companies, company_profiles(_all), sf_contracts, sf_accounts, sf_opportunities, sf_users, active_companies, cms_dim_industry_alias |
| companyMonthly.ts | cms_company_monthly | scouts, scout_histories, member_applications, member_job_detail_views, job_publish_history, jobs_all, cms_company_login_daily |
| companyLogin.ts | cms_company_login | GA4 analytics_*（`get_ID`） |
| industryBenchmark.ts | cms_industry_benchmark_monthly | cms_company_monthly, cms_company_master |
| companyDetail.ts（8 ビルダー: company_master_one / company_monthly_one / daily_usage / scout_cohort / application_cohort / member_attributes / bench_series / company_login_one） | cms_company_master, cms_company_monthly, cms_company_daily_usage, cms_scout_cohort_status, cms_application_cohort_status, cms_scout_member_attributes_monthly, cms_industry_benchmark_monthly, cms_company_login | 各マート README |
| ai.ts（ai_occupation_options: AI 機能の職種の選択肢） | cms_company_job_monthly | 各マート README |
| aiScout.ts（6 ビルダー: ai_scout_benchmark / ai_scout_options / ai_scout_outcomes / ai_scout_drafts_merge（書き込み）/ ai_scout_job / ai_scout_member（会員 ID から作る機能が開いているときだけ呼ぶ）。② スカウト文面の AI 作成） | cms_ai_scout_sends, cms_ai_scout_templates, cms_ai_scout_draft_outcomes, cms_ai_scout_drafts, cms_ai_refresh_log, cms_ai_jobs, cms_ai_member_profiles | [bq/ai/README](../../../bq/ai/README.md)（messages, scouts, scout_histories, member_profile_latest, member_details, cms_company_master） |

## テスト
tests/worker/sql.test.ts（@param 以外のリテラルが無いこと）、tests/worker/aiScoutData.test.ts（AI のマート cms_ai_* の SQL）
