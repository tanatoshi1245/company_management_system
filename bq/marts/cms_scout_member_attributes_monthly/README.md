---
tags: [domain/company-behavior, layer/engineering, type/data-mart-spec, source/bq-internal, table/cms_scout_member_attributes_monthly, table/scouts, table/member_details, table/member_profile_latest]
related:
  - "[[bq/README]]"
  - "[[docs/指標定義]]"
status: active
---

# `bq-hgt.dwh.cms_scout_member_attributes_monthly` — スカウト対象の会員属性（企業 × 送信月）

**粒度**: company_id × sent_month × attribute_type × attribute_value。**更新**: 全件差し替え（13 か月 + 当月）。属性は**現在**のプロフィール（送信時点ではない）。

## 列定義

| 列 | 型 | 意味 |
|---|---|---|
| attribute_type | STRING | japanese_level / english_level / residence_prefecture / last_occupation_group（12 区分）/ experienced_occupation（中分類、複数値を分割）/ desired_occupation（同）/ current_income_range / desired_income_range / member_category / target_flag（ターゲット = A/B/C/I）/ age_group |
| attribute_value | STRING | 値（空は (未入力)。居住地は都道府県、日本以外は '日本以外'） |
| account_type | STRING | アカウント種別（送信 / 閲覧 / 応募したプロファイルの company_type: 直接 / 紹介 / 派遣。2026-10-30〜）。Worker は期間と種別で SUM して返す |
| scouts / members / interested_scouts | INT64 | 送信数（view は閲覧数、application は応募数）/ 会員数 / 興味あり返信があった送信数 |

## 元テーブル（依存するデータ）

scouts, scout_histories, member_details（最新スナップショット）, member_profile_latest（語学・年収帯・年代・職種 12 区分の導出はこのビュー）

## 更新
`bq/marts/scheduled_query.sql`（毎日 22:45 UTC = 07:45 JST）。生成ロジックの変更時は Worker の `src/worker/sql/` と `src/shared/schema/` を合わせ、`DATA_VERSION` を +1 する。

## 2026-10-27 の変更: `kind` 列
`kind = 'scout'`（従来。企業 × 送信月。scouts = 送信数、interested_scouts = 興味あり返信）に加え、`kind = 'view'`（企業 × 閲覧月。`member_job_detail_views` の閲覧。scouts = 閲覧数、members = 閲覧した会員数、interested_scouts = 0）と `kind = 'application'`（企業 × 応募月。`member_applications` の応募。scouts = 応募数。2026-10-30〜）を同じ表に持つ。企業ページの「誰が求人を見ているか（閲覧 / 応募）」用。Worker の照会（`GET /api/companies/:id/attributes?from&to&account`）は期間とアカウント種別で `SUM` し、`kind` を返して画面側で分ける。
