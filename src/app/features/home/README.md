---
tags: [domain/company-behavior, domain/scout, domain/application, layer/application, type/app-spec, table/cms_company_master, table/cms_company_monthly, table/cms_industry_benchmark_monthly]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# features/home — ホーム（契約企業ボード）

## 役割
ログイン直後の全体図。**契約中の企業だけ**（既定の種別フィルタは DA と RPO 以外。2026-10-30〜）を KPI タイル（契約企業数・アクティブ企業数（最終ログイン 30 日以内）・スカウト利用社数（利用率）・スカウト消化率。各タイルの下に契約体系（広告掲載 / 成功報酬）の内訳）→ 種別 / CS 担当 / 企業名 × 実績の表で一覧する。色は「0 件」と「30 日以上ログインなし」の赤だけ（業界比 / 目標比の色は企業詳細で見る）。`担当=自分`・CS 担当・企業種別・契約終了（30 / 60 日以内・90 日以上先）・求人掲載の有無・スカウト送信の有無の絞り込みはクライアント側。フィルタの選択肢と件数は互いに連動する（その項目以外のフィルタを通った企業から作る。`filterCompaniesExcept`。選択中の値は 0 件でも残す）。表示は当月のみ。

## 依存するデータ（画面要素 → API → マート列 → BQ 元テーブル）
| 画面要素 | API | マート.列 | BQ 元テーブル |
|---|---|---|---|
| 企業名・種別・業種・プラン・契約状態・契約タイムライン | `GET /api/board?month=` | `cms_company_master.company_name / company_type / industry / plan_name / contract_state / active_from / active_to / days_*` | companies, company_profiles, sf_contracts, sf_accounts |
| 担当（苗字）・`担当=自分`・CS 担当フィルタ | 同上 + D1 `company_settings` | `cs_owner_email_default / cs_owner_name_default`（既定は企業管理ツールの `sales_staff`） | active_companies.sales_staff |
| 掲載 / 枠、送信 / 枠（分数） | 同上 | `cms_company_monthly.active_jobs_eom / scout_sent`, `cms_company_master.job_posting_limit / scout_limit` | job_publish_history, jobs_all, scouts, companies |
| 閲覧・応募・興味あり返信（当月、返信月軸。興味あり以外の返信は数えない） | 同上 | `job_views / applications / interested_by_reply_month`（`account_type = '__ALL__'` の行） | member_job_detail_views, member_applications, scouts × scout_histories |
| 種別セルの `+紹介`（複数アカウント企業）と種別フィルタ（いずれかのアカウント種別が一致） | 同上 | `cms_company_master.account_types` | company_profiles_full.company_type |
| 選考中・採用 | 同上 | `in_selection / hires` | member_applications.status, scouts |
| 最終ログイン（30 日以上なしは赤）・契約残 | 同上 | `cms_company_login.last_login_date / days_since_login`, `cms_company_master.days_to_contract_end` | GA4 `get_ID`, companies |
| 契約中の判定 | 同上 | 当月: `contract_state ∈ {active, ending_30d}`、過去月: `cms_company_monthly.is_contracted_in_month` | companies |
| KPI: スカウト消化率・利用率 | 同上 | Σ`scout_sent` ÷ Σ`scout_limit`、`scout_sent > 0` の企業数 ÷ 契約中 | クライアント集計 |
| 業界比の色 | 同上 | `cms_industry_benchmark_monthly.median / n_companies` | cms_company_monthly |
| 目標比の色 | 同上（D1 `company_targets`） | 目標 × 営業日消化率 | — |
| KPI: アクティブ企業数 | 同上 | `login.daysSince < 30` の契約中企業数 | GA4 `get_ID` |

全体の表は [`docs/データ紐付け.md`](../../../../docs/データ紐付け.md)。

## 編集するときの入口
HomePage.tsx → homeModel.ts（計算）→ components/（描画）。指標の式は `src/shared/metrics/`、ラベルは `src/shared/labels.ts`。

## テスト
tests/app/home.test.tsx, tests/shared/board.test.ts
