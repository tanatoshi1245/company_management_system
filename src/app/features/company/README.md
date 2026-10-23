---
tags: [domain/company-behavior, domain/scout, domain/application, layer/application, type/app-spec, table/cms_company_monthly, table/cms_company_daily_usage, table/cms_scout_cohort_status, table/cms_application_cohort_status, table/cms_scout_member_attributes_monthly, table/cms_company_login]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# features/company — 企業詳細

## 役割
1 社の契約・担当・利用状況（ゲージとペース）・13 か月推移・スカウト対象の会員属性・コホート別の選考状況・目標との比較を見る。

## 依存するデータ（画面要素 → API → マート列 → BQ 元テーブル）
| 画面要素 | API | マート.列 | BQ 元テーブル |
|---|---|---|---|
| ヘッダ（企業名・状態・種別・業種・プラン・担当 CS・営業担当・SF 契約・最終ログイン・契約タイムライン） | `GET /api/companies/:id?month=` | `cms_company_master.*`, `cms_company_login.*` | companies, company_profiles, sf_contracts, sf_accounts, sf_users, active_companies, GA4 `get_ID` |
| 利用状況（求人枠 / スカウト枠のゲージ、期待値の印、▼ 業界中央値、月内累積） | 同上 | `cms_company_monthly.active_jobs_eom / scout_sent(_manual/_auto/_contract_to_date)`, `cms_company_master.job_posting_limit / scout_limit`, `cms_company_daily_usage.*_cum`, `cms_industry_benchmark_monthly.median` | job_publish_history, jobs_all, scouts, member_applications |
| 13 か月の推移（実数 6 本 + 目標の破線、消化率・返信率 + 業界 p25〜p75 の帯） | 同上 + D1 `company_targets` | `cms_company_monthly`（14 か月）, `cms_industry_benchmark_monthly.p25 / p75` | scouts, scout_histories, member_applications, member_job_detail_views |
| 誰にスカウトを送っているか（属性タブ、構成比、興味あり率） | 同上 | `cms_scout_member_attributes_monthly`（選択月を含む 3 か月） | scouts × member_details × member_profile_latest |
| 選考の状況（スカウト = 興味あり返信月 / 応募 = 応募月 × 現ステータス） | 同上 | `cms_scout_cohort_status`, `cms_application_cohort_status`（直近 6 か月） | scouts, scout_histories, member_applications.status |
| 契約時の目標との比較 | 同上（D1 `company_targets` の当月行） | 目標 × 営業日消化率 vs `cms_company_monthly` の当月列 | — |
| この画面の注意点 | `GET /api/meta` | `caveats` | — |

全体の表は [`docs/データ紐付け.md`](../../../../docs/データ紐付け.md)。

## URL 状態
`month=YYYY-MM`（既定は当月）、`tab=scout|application`（コホート）、`attr=<attribute_type>`（属性タブ）。ボードからの遷移は `month` を引き継ぎ、戻るとボードのフィルタが復元される（History API）。

## 編集するときの入口
CompanyPage.tsx（URL 状態・取得）→ companyModel.ts（スコア・パネル・コホート・属性の集計、注記の選択）→ components/（描画）。
チャート部品は `src/app/components/charts/`（Bullet / SmallMultiples / CumulativeChart / CohortMatrix / AttributeBars / TimelineBar）。
応答の形は `src/shared/schema/company.ts`、Worker 側は `routes/companies.ts` → `services/companyService.ts` → `sql/companyDetail.ts`。

## テスト
tests/app/company.test.tsx, tests/worker/companies.test.ts
