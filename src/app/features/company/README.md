---
tags: [domain/company-behavior, domain/scout, domain/application, layer/application, type/app-spec, table/cms_company_master, table/cms_company_monthly, table/cms_scout_member_attributes_monthly, table/cms_company_login]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# features/company — 企業詳細

## 役割
1 社の契約・担当・当月の実績（数値タイルとゲージ）・契約期間中の累積（閲覧・応募）と推移（スカウト送信・返信）・スカウト対象の会員属性・スカウト未利用状況・目標との比較を見る。

## 依存するデータ（画面要素 → API → マート列 → BQ 元テーブル）
| 画面要素 | API | マート.列 | BQ 元テーブル |
|---|---|---|---|
| ヘッダ（企業名・状態・種別・業種・プラン・担当 CS・営業担当・SF 契約・最終ログイン・契約タイムライン） | `GET /api/companies/:id?month=` | `cms_company_master.*`, `cms_company_login.*` | companies, company_profiles, sf_contracts, sf_accounts, sf_users, active_companies, GA4 `get_ID` |
| 当月の実績（掲載 / 枠・閲覧・応募・送信 / 枠・返信・選考中・採用・最終ログイン の数値タイル + 求人枠 / スカウト枠のゲージ） | 同上 | ボードの行と同じ列（`cms_company_monthly` の当月行、`cms_company_master.job_posting_limit / scout_limit`、`cms_company_login.last_login_date`、`cms_industry_benchmark_monthly.median`） | job_publish_history, jobs_all, scouts, member_applications, GA4 `get_ID` |
| 契約期間中の累積（閲覧人数・応募人数。左列） | 同上 | `cms_company_monthly.job_views / applications` を契約開始月から累積（マートの窓 = 直近 13 か月 + 当月に限る） | member_job_detail_views, member_applications |
| スカウト送信と返信の推移（右列） | 同上 | `cms_company_monthly.scout_sent / interested_by_reply_month`（契約期間中・窓内） | scouts, scout_histories |
| 誰にスカウトを送っているか（属性タブ 8 種、構成比、興味あり率。右列） | 同上 | `cms_scout_member_attributes_monthly`（選択月を含む 3 か月。語学レベルは番号の降順） | scouts × member_details × member_profile_latest |
| スカウト未利用状況（対象月・理由・補足。契約期間中の全月） | 同上 | `cms_company_master.scout_unused_json` | scout_unused_companies_monthly |
| 契約時の目標との比較 | 同上（D1 `company_targets` の当月行） | 目標 × 営業日消化率 vs `cms_company_monthly` の当月列 | — |
| この画面の注意点 | `GET /api/meta` | `caveats` | — |

全体の表は [`docs/データ紐付け.md`](../../../../docs/データ紐付け.md)。

## URL 状態
`month=YYYY-MM`（既定は当月）、`attr=<attribute_type>`（属性タブ）。ボードからの遷移は `month` を引き継ぎ、戻るとボードのフィルタが復元される（History API）。

## 編集するときの入口
CompanyPage.tsx（URL 状態・取得）→ companyModel.ts（スコア・累積と推移の系列・属性の集計、注記の選択）→ components/（CurrentMonthPanel / CumulativePanel / ScoutTrendPanel / ScoutTargetPanel / ScoutUnusedPanel / TargetVsActualPanel）。
チャート部品は `src/app/components/charts/`（Bullet / DualLineChart / AttributeBars / TimelineBar）。
応答の形は `src/shared/schema/company.ts`、Worker 側は `routes/companies.ts` → `services/companyService.ts` → `sql/companyDetail.ts`。

## テスト
tests/app/company.test.tsx, tests/worker/companies.test.ts
