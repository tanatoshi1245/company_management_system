---
tags: [domain/company-behavior, layer/engineering, type/data-mart-spec, source/bq-internal, table/cms_company_monthly, table/scouts, table/scout_histories, table/member_applications, table/member_job_detail_views, table/job_publish_history, table/jobs_all]
related:
  - "[[bq/README]]"
  - "[[docs/指標定義]]"
status: active
---

# `bq-hgt.dwh.cms_company_monthly` — 企業 × 月の実績

**粒度**: company_id × month（13 か月 + 当月 MTD = 14 行 / 企業）。**更新**: 全件差し替え。対象企業は cms_company_master と同じ。

## 列定義

| 列 | 型 | 意味 |
|---|---|---|
| month / month_ym / is_current_month / as_of_date / data_days | DATE / STRING / BOOL / DATE / INT64 | 月初・YYYY-MM・当月か・掲載求人の基準日（過去月は月末、当月は今日）・データのある日数 |
| company_id | INT64 | |
| account_type | STRING | `'__ALL__'` = 企業全体（従来の行）。`直接` / `紹介` / `派遣` = アカウント種別（プロファイルの company_type）ごとの内訳の行（2026-10-30〜。企業ページの切替用）。**企業全体だけを読むクエリは `WHERE account_type = '__ALL__'` を付ける**（ボード・ベンチマーク）。種別の行では `scout_sent_contract_to_date` = 0、`login_days` = NULL。採用は会員 × 企業 × 種別で重複排除するため種別の合計が全体を上回ることがある |
| is_contracted_in_month / contracted_source | BOOL / STRING | companies の期間が月に重なる、または cms_contract_snapshot_daily に契約中の記録がある（companies / snapshot / none） |
| scout_limit / job_posting_limit | INT64 | 現在の枠数（履歴ではない） |
| active_jobs_eom / new_jobs | INT64 | as_of_date 時点の掲載求人（set_id 重複排除）/ 初掲載がその月の求人 |
| jobs_in_month | INT64 | 月内に 1 日でも掲載期間が重なった求人（set_id 重複排除。`active_jobs_eom` 以上）。スカウト未利用の登録画面の対象判定（2026-10-31〜） |
| scout_sent / scout_sent_manual / scout_sent_auto | INT64 | 送信月基準の送信数（手動 / 自動） |
| scout_sent_contract_to_date | INT64 | 契約開始〜月末（当月は昨日）までの累計送信（枠の期間 = 契約期間 のとき使う） |
| interested_by_send_month | INT64 | その月に送ったスカウトのうち興味あり返信があった数（dmt_company_daily と同じ） |
| interested_by_reply_month | INT64 | 初回の興味あり返信がその月のスカウト数 |
| interested_manual_by_send_month | INT64 | 手動スカウトのみ |
| reply_rate | FLOAT64 | interested_by_send_month ÷ scout_sent |
| applications / applications_job / applications_direct | INT64 | 応募月基準（求人応募 / 企業への直接応募） |
| job_views / job_view_members | INT64 | 求人閲覧（view_id / 会員の distinct） |
| hires / hires_from_application / hires_from_scout | INT64 | 11.採用 を会員 × 企業で重複排除し起点月（応募月 / 興味あり返信月）に帰属 |
| st01_no_response … st12_declined | INT64 | 現ステータス別件数（応募はその月の応募、スカウトはその月に興味あり返信があったもの。合算） |
| in_selection | INT64 | 6.面接調整中〜10.Final の合計 |
| login_days | INT64 | CT ログイン日数（2026-05 より前は NULL） |
| refreshed_at | TIMESTAMP | |

## 元テーブル（依存するデータ）

scouts, scout_histories, member_applications, member_job_detail_views, job_publish_history, jobs_all（set_id）, cms_company_login_daily, cms_contract_snapshot_daily, company_profiles（pcm）

## 更新
`bq/marts/scheduled_query.sql`（毎日 22:45 UTC = 07:45 JST）。生成ロジックの変更時は Worker の `src/worker/sql/` と `src/shared/schema/` を合わせ、`DATA_VERSION` を +1 する。
