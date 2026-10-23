---
tags: [domain/company-behavior, domain/scout, domain/application, layer/application, type/app-spec, table/cms_company_master, table/cms_company_monthly, table/cms_industry_benchmark_monthly]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# features/home — ホーム（契約企業ボード）

## 役割
ログイン直後の全体図。契約企業を KPI タイル（契約企業数・スカウト消化率・スカウト利用率・ペース遅れ・ログインなし・契約終了間近）→ 企業 × 実績の表（基準がある列はヒートマップの色）で一覧し、`担当=自分`・CS 担当・業種・種別などの絞り込みと「業界比 / 目標比」の切替をクライアント側で行う。

## 依存するデータ（画面要素 → API → マート列 → BQ 元テーブル）
| 画面要素 | API | マート.列 | BQ 元テーブル |
|---|---|---|---|
| 企業名・種別・業種・プラン・契約状態・契約タイムライン | `GET /api/board?month=` | `cms_company_master.company_name / company_type / industry / plan_name / contract_state / active_from / active_to / days_*` | companies, company_profiles, sf_contracts, sf_accounts |
| 担当（苗字）・`担当=自分`・CS 担当フィルタ | 同上 + D1 `company_settings` | `cs_owner_email_default / cs_owner_name_default` | sf_accounts.OwnerId → sf_users |
| 掲載 / 枠、送信 / 枠（分数） | 同上 | `cms_company_monthly.active_jobs_eom / scout_sent`, `cms_company_master.job_posting_limit / scout_limit` | job_publish_history, jobs_all, scouts, companies |
| 閲覧・応募・返信（当月、返信月軸） | 同上 | `job_views / applications / interested_by_reply_month` | member_job_detail_views, member_applications, scouts × scout_histories |
| 選考中・採用 | 同上 | `in_selection / hires` | member_applications.status, scouts |
| 最終ログイン・契約残 | 同上 | `cms_company_login.last_login_date / days_since_login`, `cms_company_master.days_to_contract_end` | GA4 `get_ID`, companies |
| KPI: スカウト消化率・利用率 | 同上 | Σ`scout_sent` ÷ Σ`scout_limit`、`scout_sent > 0` の企業数 ÷ 契約中 | クライアント集計 |
| 業界比の色 | 同上 | `cms_industry_benchmark_monthly.median / n_companies` | cms_company_monthly |
| 目標比の色 | 同上（D1 `company_targets`） | 目標 × 営業日消化率 | — |
| KPI タイル・スパークライン | 同上 | クライアント集計（`src/shared/metrics/board.ts`）、`trend.*` | — |

全体の表は [`docs/データ紐付け.md`](../../../../docs/データ紐付け.md)。

## 編集するときの入口
HomePage.tsx → homeModel.ts（計算）→ components/（描画）。指標の式は `src/shared/metrics/`、ラベルは `src/shared/labels.ts`。

## テスト
tests/app/home.test.tsx, tests/shared/board.test.ts
