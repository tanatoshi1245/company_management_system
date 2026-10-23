---
tags: [domain/company-behavior, domain/scout, domain/application, layer/application, type/app-spec, table/cms_company_master, table/cms_company_monthly, table/cms_industry_benchmark_monthly]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# features/home — ホーム（契約企業ボード）

## 役割
ログイン直後の全体図。契約企業を KPI タイル → 注目レーン → マトリクス・ヒートマップで一覧し、`担当=自分` などの絞り込みと「業界比 / 目標比」の切替をクライアント側で行う。

## 依存するデータ（画面要素 → API → マート列 → BQ 元テーブル）
| 画面要素 | API | マート.列 | BQ 元テーブル |
|---|---|---|---|
| 企業名・種別・業種・プラン・契約状態・契約タイムライン | `GET /api/board?month=` | `cms_company_master.company_name / company_type / industry / plan_name / contract_state / active_from / active_to / days_*` | companies, company_profiles, sf_contracts, sf_accounts |
| 担当イニシャル・`担当=自分` | 同上 + D1 `company_settings` | `cs_owner_email_default / cs_owner_name_default` | sf_accounts.OwnerId → sf_users |
| 利用状況（求人枠消化率・スカウト消化ペース） | 同上 | `cms_company_monthly.active_jobs_eom / scout_sent`, `cms_company_master.job_posting_limit / scout_limit` | job_publish_history, jobs_all, scouts, companies |
| 反応（興味あり返信率・応募 / 求人・閲覧 / 求人） | 同上 | `interested_by_send_month / applications / job_views` | scouts × scout_histories, member_applications, member_job_detail_views |
| 選考（選考中・採用） | 同上 | `in_selection / hires` | member_applications.status, scouts |
| 接点（ログイン日数 30 日） | 同上 | `cms_company_login.login_days_30d / last_login_date` | GA4 `get_ID` |
| 業界比の色 | 同上 | `cms_industry_benchmark_monthly.median / n_companies` | cms_company_monthly |
| 目標比の色 | 同上（D1 `company_targets`） | 目標 × 営業日消化率 | — |
| KPI タイル・注目レーン・スパークライン | 同上 | クライアント集計（`src/shared/metrics/board.ts`）、`trend.*` | — |

全体の表は [`docs/データ紐付け.md`](../../../../docs/データ紐付け.md)。

## 編集するときの入口
HomePage.tsx → homeModel.ts（計算）→ components/（描画）。指標の式は `src/shared/metrics/`、ラベルは `src/shared/labels.ts`。

## テスト
tests/app/home.test.tsx, tests/shared/board.test.ts
