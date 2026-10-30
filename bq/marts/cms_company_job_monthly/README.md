---
tags: [domain/company-behavior, domain/application, layer/engineering, type/data-mart-spec, source/bq-internal, table/cms_company_job_monthly, table/member_job_detail_views, table/member_applications, table/jobs_all, table/job_publish_history]
related:
  - "[[bq/README]]"
  - "[[docs/指標定義]]"
  - "[[docs/数値の出所]]"
status: active
---

# `bq-hgt.dwh.cms_company_job_monthly` — 企業 × アカウント種別 × 求人 × 月の閲覧・応募

**粒度**: company_id × account_type × job_key × month（閲覧か応募が 1 件以上ある月だけ。約 7 万行）。**更新**: 全件差し替え（`scheduled_query.sql` ステップ 08c。2026-10-30 新設）。
企業ページの「求人ごとの実績」の表と求人フィルタ（求人を選ぶとカード・推移・選考状況がその求人の分になる）の元。

## 列定義

| 列 | 型 | 意味 |
|---|---|---|
| month / month_ym | DATE / STRING | 月初 / YYYY-MM |
| company_id | INT64 | 企業 ID |
| account_type | STRING | アカウント種別（閲覧 / 応募したプロファイルの company_type: 直接 / 紹介 / 派遣） |
| job_key | STRING | 求人キー。`jobs_all.set_id`（日英セットで 1 件）、無ければ `job_id`。`job_id` の無い応募（企業への直接応募）は `'(direct)'` |
| is_direct | BOOL | `'(direct)'` の行 |
| job_title | STRING | 求人タイトル（`jobs_all.position_name`。`job_id` ごとに最新のスナップショット、日英セットは日本語プロファイル側を優先）。`'(direct)'` は「企業への直接応募」、取れなければ `求人 <job_key>` |
| job_views | INT64 | 閲覧数（`member_job_detail_views` の `COUNT(DISTINCT view_id)`） |
| applications | INT64 | 応募数（`member_applications`） |
| hires_from_application | INT64 | `status = '11.採用'` の応募数 |
| st06_interview_adjusting … st11_hired | INT64 | 応募側の現ステータス別件数（面接調整中 / 1st / 2nd / 3rd / Final / 採用。応募月で集計。企業ページ「選考状況」の求人選択時に使う。スカウト経由は含まない） |
| publish_from / publish_to | DATE | 掲載期間（`job_publish_history` の MIN / MAX。NULL の終了があれば掲載中 = NULL。参考） |
| refreshed_at | TIMESTAMP | 更新時刻 |

## 元テーブルと整合

- `member_job_detail_views`（`job_id`）、`member_applications`（`job_id`。NULL は直接応募）、`jobs_all`（`set_id` / `position_name` / `profile_id`）、`job_publish_history`、`company_profiles_full`（`profile_id → company_id / company_type / language`）。
- 企業 × 種別 × 月の `SUM(job_views)` / `SUM(applications)` は `cms_company_monthly` の種別行の `job_views` / `applications` と一致する（初回実行で差 0 を確認）。

## Worker からの読み方

- `src/worker/sql/companyDetail.ts` の `companyJobsQuery`（期間・種別で `job_key` ごとに SUM。閲覧の多い順）と `companyJobMonthlyQuery`（1 求人の月次）。API は `GET /api/companies/:id/jobs?from&to&account&job`（`job` は `set_id` / `job_id` または `direct`）。
- **権限**: Worker 用 SA に表単位の `roles/bigquery.dataViewer` が要る（`docs/Google_Cloud認証情報の発行手順.md` §1 の一覧に追加済み）。付与前は企業ページの求人の表だけ「権限待ち」の注記になり、他は動く。

## 編集の入口・テスト

`bq/marts/scheduled_query.sql` ステップ 06a（`jobs_latest` / `job_set` / `job_title`）・07（`view_raw.job_key`）・08c。変更したら dry run → 手動実行 → 上の整合を確認 → スケジュールドクエリを差し替え、`DATA_VERSION` を +1。テストは `tests/worker/companies.test.ts`（`/jobs`）と `tests/worker/sql.test.ts`。
