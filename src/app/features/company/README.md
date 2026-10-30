---
tags: [domain/company-behavior, domain/scout, domain/application, layer/application, type/app-spec, table/cms_company_master, table/cms_company_monthly, table/cms_scout_member_attributes_monthly, table/cms_company_login]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# features/company — 企業詳細

## 役割
1 社の契約（期間・残日数）・最終ログイン・選択期間の実績（求人関連 / スカウト関連）・閲覧と応募の推移・スカウト送信と興味あり返信の推移・会員属性の円グラフ（誰が求人を見ているか = 閲覧 / 応募、誰にスカウトを送っているか = 送信 / 興味あり）・スカウト未利用状況を見る。期間（開始月〜終了月）と、複数アカウント（直接 + 紹介 など）の企業はアカウント種別で、実績・推移・円グラフを切り替えられる（2026-10-30〜）。契約時の目標との比較は 2026-10-27 から非表示（`components/TargetVsActualPanel.tsx` は残す）。

## 依存するデータ（画面要素 → API → マート列 → BQ 元テーブル）
| 画面要素 | API | マート.列 | BQ 元テーブル |
|---|---|---|---|
| ヘッダ（企業名・状態・種別・業種・プラン）とカード（契約期間・契約終了まで・最終ログイン） | `GET /api/companies/:id?month=` | `cms_company_master.*`, `cms_company_login.last_login_date / days_since_login` | companies, company_profiles, sf_contracts, GA4 `get_ID` |
| 期間・アカウント種別の切替（ヘッダ） | 同上 | `meta.months`、`accounts`（`cms_company_master.accounts_json`）。種別を選ぶと実績・推移は `accountMonthly`（`cms_company_monthly` の `account_type != '__ALL__'`） | company_profiles_full.company_type |
| 求人の実績（選択期間。左列）: 掲載求人数（重複排除）/ 閲覧人数 / 応募人数 / 採用（応募経由） | 同上 | `jobs`（`cms_company_master.jobs_json` を期間・種別で distinct 集計）、Σ `cms_company_monthly.job_views / applications / hires_from_application`（期間のうち契約期間中の月） | job_publish_history, jobs_all, member_job_detail_views, member_applications |
| スカウトの実績（選択期間。右列）: 送信件数 / 興味あり返信 / 選考中（現在）/ 採用（スカウト経由） | 同上 | Σ `cms_company_monthly.scout_sent / interested_by_reply_month / hires_from_scout`、終了月の `in_selection` | scouts, scout_histories, member_applications.status |
| 閲覧と応募の推移（2 軸）・スカウト送信と興味あり返信の推移（2 軸） | 同上 | `cms_company_monthly`（選択期間・契約期間中。種別は `accountMonthly`） | 同上 |
| 誰が求人を見ているか（閲覧 / 応募）/ 誰にスカウトを送っているか（送信 / 興味あり）（属性タブ 8 種の円グラフ） | `GET /api/companies/:id/attributes?from&to&account` | `cms_scout_member_attributes_monthly`（`kind` = view / application / scout を期間・アカウント種別で SUM。語学レベルは番号の降順） | member_job_detail_views / member_applications / scouts × member_details × member_profile_latest |
| スカウト未利用状況（対象月・理由・補足・出所。「理由を登録する」→ `/scout-unused`） | 同上 + D1 `scout_unused_entries`（API が重ねる） | `cms_company_master.scout_unused_json` | scout_unused_companies_monthly |

全体の表は [`docs/データ紐付け.md`](../../../../docs/データ紐付け.md)。

## URL 状態
`from=YYYY-MM` / `to=YYYY-MM`（期間。既定は契約開始月（窓より前なら窓の先頭）〜当月）、`account=<直接|紹介|派遣>`（アカウント種別。空 = 全体。複数アカウント企業だけ）、`attr=<attribute_type>`（属性タブ）。詳細本体は `to` で取得し、期間・アカウントの切替は再取得しない（属性の内訳だけ別 API）。戻るとボードのフィルタが復元される（History API）。

## 編集するときの入口
CompanyPage.tsx（URL 状態・取得。詳細本体 + 属性 API）→ companyModel.ts（期間・アカウントの確定 `resolvePeriod`、スコア・累積と推移の系列、求人の期間集計 `countJobs`、属性の内訳 `buildBreakdown`）→ components/（CompanyHeader（期間・アカウント切替）/ SummaryPanel / ViewsAppsPanel / ScoutTrendPanel / AttributePiePanel / ScoutUnusedPanel。TargetVsActualPanel は未使用で保管）。
チャート部品は `src/app/components/charts/`（DualLineChart / PieChart。Bullet / AttributeBars / TimelineBar は未使用で保管）。
応答の形は `src/shared/schema/company.ts`、Worker 側は `routes/companies.ts` → `services/companyService.ts` → `sql/companyDetail.ts`。

## テスト
tests/app/company.test.tsx, tests/worker/companies.test.ts
