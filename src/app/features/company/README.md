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
| （M2 で記載） | `GET /api/companies/:id`, `GET /api/companies/:id/attributes` | cms_company_* / cms_*_cohort_status / cms_scout_member_attributes_monthly | companies, scouts, scout_histories, member_applications, member_details, member_profile_latest, GA4 analytics_258261950 |

## 編集するときの入口
CompanyPage.tsx → companyModel.ts → components/。

## テスト
tests/app/company.test.tsx, tests/worker/companies.test.ts
