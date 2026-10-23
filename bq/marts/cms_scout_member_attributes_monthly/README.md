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
| scouts / members / interested_scouts | INT64 | 送信数 / 会員数 / 興味あり返信があった送信数 |

## 元テーブル（依存するデータ）

scouts, scout_histories, member_details（最新スナップショット）, member_profile_latest（語学・年収帯・年代・職種 12 区分の導出はこのビュー）

## 更新
`bq/marts/scheduled_query.sql`（毎日 22:45 UTC = 07:45 JST）。生成ロジックの変更時は Worker の `src/worker/sql/` と `src/shared/schema/` を合わせ、`DATA_VERSION` を +1 する。
