---
tags: [domain/company-behavior, domain/scout, domain/application, layer/application, type/app-spec, table/cms_company_master, table/cms_company_monthly, table/cms_scout_member_attributes_monthly, table/cms_company_login]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# features/company — 企業詳細

## 役割
1 社の契約（期間・残日数）・最終ログイン・直近 13 か月の実績（求人関連 / スカウト関連）・閲覧と応募の推移・スカウト送信と返信の推移・会員属性の円グラフ（誰が求人を見ているか / 誰にスカウトを送っているか）・スカウト未利用状況を見る。契約時の目標との比較は 2026-10-27 から非表示（`components/TargetVsActualPanel.tsx` は残す）。

## 依存するデータ（画面要素 → API → マート列 → BQ 元テーブル）
| 画面要素 | API | マート.列 | BQ 元テーブル |
|---|---|---|---|
| ヘッダ（企業名・状態・種別・業種・プラン）とカード（契約期間・契約終了まで・最終ログイン） | `GET /api/companies/:id?month=` | `cms_company_master.*`, `cms_company_login.last_login_date / days_since_login` | companies, company_profiles, sf_contracts, GA4 `get_ID` |
| 求人の実績（直近 13 か月。左列）: 掲載求人数（重複排除）/ 閲覧人数 / 応募人数 / 採用（応募経由） | 同上 | `cms_company_master.jobs_window_distinct`、Σ `cms_company_monthly.job_views / applications / hires_from_application`（契約期間中の月） | job_publish_history, jobs_all, member_job_detail_views, member_applications |
| スカウトの実績（直近 13 か月。右列）: 送信件数 / 返信件数 / 選考中（現在）/ 採用（スカウト経由） | 同上 | Σ `cms_company_monthly.scout_sent / interested_by_reply_month / hires_from_scout`、当月の `in_selection` | scouts, scout_histories, member_applications.status |
| 閲覧と応募の推移（2 軸）・スカウト送信と返信の推移（2 軸） | 同上 | `cms_company_monthly`（契約期間中・窓内） | 同上 |
| 誰が求人を見ているか / 誰にスカウトを送っているか（属性タブ 8 種の円グラフ。スカウトは 送信 / 返信 の切替） | 同上 | `cms_scout_member_attributes_monthly`（`kind` = view / scout。選択月を含む 3 か月。語学レベルは番号の降順） | member_job_detail_views / scouts × member_details × member_profile_latest |
| スカウト未利用状況（対象月・理由・補足・出所。「理由を登録する」→ `/scout-unused`） | 同上 + D1 `scout_unused_entries`（API が重ねる） | `cms_company_master.scout_unused_json` | scout_unused_companies_monthly |

全体の表は [`docs/データ紐付け.md`](../../../../docs/データ紐付け.md)。

## URL 状態
`month=YYYY-MM`（既定は当月）、`attr=<attribute_type>`（属性タブ）。ボードからの遷移は `month` を引き継ぎ、戻るとボードのフィルタが復元される（History API）。

## 編集するときの入口
CompanyPage.tsx（URL 状態・取得）→ companyModel.ts（スコア・累積と推移の系列・属性の集計、注記の選択）→ components/（CompanyHeader / SummaryPanel / ViewsAppsPanel / ScoutTrendPanel / AttributePiePanel / ScoutUnusedPanel。TargetVsActualPanel は未使用で保管）。
チャート部品は `src/app/components/charts/`（DualLineChart / PieChart。Bullet / AttributeBars / TimelineBar は未使用で保管）。
応答の形は `src/shared/schema/company.ts`、Worker 側は `routes/companies.ts` → `services/companyService.ts` → `sql/companyDetail.ts`。

## テスト
tests/app/company.test.tsx, tests/worker/companies.test.ts
