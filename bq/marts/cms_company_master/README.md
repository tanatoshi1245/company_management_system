---
tags: [domain/company-behavior, layer/engineering, type/data-mart-spec, source/bq-internal, table/cms_company_master, table/companies, table/company_profiles, table/sf_contracts, table/sf_accounts, table/sf_users]
related:
  - "[[bq/README]]"
  - "[[docs/指標定義]]"
status: active
---

# `bq-hgt.dwh.cms_company_master` — 企業マスタ

**粒度**: 企業（`company_id` = `companies.id`）1 行。**更新**: 全件差し替え（CREATE OR REPLACE）。
**対象**: `companies.active_from` / `active_to` が「13 か月前〜今日 + 30 日」に重なる企業（契約中 + 直近終了 + 開始間近 + ベンチマーク用の過去契約企業）。RA（4928 / 14508）・RDS（7080）のプロファイルは除外。`companies.publishing_sites` に `WAWW` を含む企業と、Network 契約（別管理）の企業 = `dm_network_contract_candidates.company_id` に載る企業、社内用テストアカウント（5542 Daijob.com、8980 レジュメ更新自動リクエスト専用、7277 Daijob Resume Search (Working Abroad Scout)、7196 Daijob Resume Search (Potential Non-Japanese Scouting Service)）も除外（2026-10-23〜。ダッシュボードの対象外）。

## 列定義

| 列 | 型 | 意味 |
|---|---|---|
| company_id | INT64 | companies.id |
| company_name / internal_name | STRING | 主プロファイルの企業名（無ければ internal_name）/ companies.internal_name |
| profile_ids / profile_count | ARRAY<INT64> / INT64 | 企業のプロファイル（RA/RDS 除く） |
| company_type | STRING | DA / RPO / NW / 直接 / 紹介 / 派遣 / 不明。DA = 企業名に DaijobAgent またはプロファイル名で判定、NW = Network 契約（直接（プロファイル無しを含む）で DaijobAgent を含まず、求人枠 0 かつ当日の掲載 0、スカウト枠 0 かつ当月送信 0。2026-10-23〜。Worker のボード照会は NW を除く）、他は dmt_company_daily と同じ判定 |
| dj_contract_type | STRING | company_profiles.contract_type（登録なし は NULL） |
| active_from / active_to | DATE | 契約期間（Daijob。契約中判定の正） |
| contract_from / contract_to | DATE | companies の別列（参考） |
| is_contracted_now | BOOL | active_from ≤ 今日 ≤ COALESCE(active_to, 9999-12-31) |
| contract_state | STRING | active / ending_30d（終了まで ≤30 日）/ ended_recent（終了後 ≤90 日）/ ended / upcoming（開始まで ≤30 日） |
| days_to_contract_end / days_since_contract_start / contract_days_total | INT64 | 残日数（NULL = 無期限）/ 経過日数 / 契約日数 |
| scout_limit / job_posting_limit | INT64 | 枠数。`companies.resume_bank_scout_limit` / `companies.job_posting_limit`（企業単位の契約値）を優先し、NULL のときだけ company_profiles（最新）の MAX、無ければ company_profiles_all の MAX で補い、どこにも無ければ 0（2026-10-23〜。プロファイルが無い企業も枠数が出る。未設定 = 枠なし）。**SUM はしない** |
| scout_limit_period_default | STRING | 'month'（既定の枠の期間） |
| industry / industry_source / dj_industry / sf_industry_raw / sf_industry_norm | STRING | 業種。company_profiles.industry（主プロファイル、(未選択) は無視）→ SF industry0413__c（cms_dim_industry_alias で正規化）→ (未設定) |
| sf_link_status / sf_account_id / sf_account_name | STRING | sf_contracts.DJ_company_id__c で結合できたか、代表契約の取引先 |
| sf_contract_id / sf_contract_status / sf_contract_kind / sf_contract_start / sf_contract_end / sf_contract_term_months | — | 代表契約（有効かつ期間内 → 有効 → 開始日が新しい）。終了日は GREATEST(EndDate, EndDate2__c) |
| plan_name / plan_source | STRING | ServiceName__c（契約）→ 成立商談の ServiceName__c → dj_contract_type |
| sf_active_contract / sf_live_won_opp / sf_last_won_close_date / da_active_profile / contracted_signal_count | BOOL / DATE / INT64 | 用語集の 3 シグナル（有効契約 / 成立商談 + 契約月数 / DA プロファイル掲載中）と、Daijob 契約中を含めた成立数 |
| sf_notice_check | BOOL | sf_accounts.notice_check_company__c（接触中） |
| sf_account_owner_* / sf_contract_owner_* | STRING / BOOL | 取引先 / 契約の所有者（sf_users: 名前・メール・Position__c・IsActive） |
| sales_staff | STRING | active_companies.sales_staff（企業管理ツールの担当。ローマ字「姓 名」） |
| cs_owner_email_default / cs_owner_name_default / owner_source | STRING | 既定の CS 担当（owner_source = sales_staff。名前は sales_staff そのまま、メールは「名の頭文字-姓@daijob.com」の規則で導出。姓だけの値は NULL）。DA（企業名に DaijobAGENT を含む企業）は BQ の担当データによらず名前 `DA`・メール NULL に固定。アプリの上書き（D1）が優先 |
| active_jobs_now | INT64 | 当日の掲載求人（企業単位で set_id 重複排除） |
| scout_unused_json | STRING | スカウト未利用の記録。`scout_unused_companies_monthly`（シート取込の行と、アプリの登録ページが書く `match_method = 'app'` の行）から、同じ企業・月はアプリの行を優先。契約期間に入る月だけ。JSON 配列 `[{month: 'YYYY-MM', reason, remarks, source: 'app' \| 'sheet'}]` を月の降順。無ければ `[]`。Worker が JSON.parse し、D1 の最新を重ねて企業ページの「スカウト未利用状況」に出す |
| run_date / refreshed_at | DATE / TIMESTAMP | 生成日 |

## 元テーブル（依存するデータ）

companies, company_profiles（最新スナップショット）, company_profiles_all, active_jobs, active_companies, scout_unused_companies_monthly, sf_contracts, sf_accounts, sf_opportunities, sf_users, cms_dim_industry_alias

## 更新
`bq/marts/scheduled_query.sql`（毎日 22:45 UTC = 07:45 JST）。生成ロジックの変更時は Worker の `src/worker/sql/` と `src/shared/schema/` を合わせ、`DATA_VERSION` を +1 する。
