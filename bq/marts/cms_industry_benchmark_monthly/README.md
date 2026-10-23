---
tags: [domain/company-behavior, layer/engineering, type/data-mart-spec, source/bq-internal, table/cms_industry_benchmark_monthly, table/cms_company_monthly, table/cms_company_master]
related:
  - "[[bq/README]]"
  - "[[docs/指標定義]]"
status: active
---

# `bq-hgt.dwh.cms_industry_benchmark_monthly` — 業界ベンチマーク（月 × 業種 × 企業種別 × 指標）

**粒度**: month × industry × company_type × metric（縦持ち）。industry / company_type に '__ALL__' のロールアップ行あり。母集団はその月に契約中（is_contracted_in_month）の企業。**更新**: 全件差し替え。Worker は n_companies ≥ 5（BENCH_MIN_N）の群だけ使い、足りなければ (業種, __ALL__) → (__ALL__, 種別) → (__ALL__, __ALL__) にフォールバックする。

## 列定義

| 列 | 型 | 意味 |
|---|---|---|
| month / month_ym / industry / company_type | — | |
| metric | STRING | scout_utilization（送信 ÷ 枠）/ job_utilization（掲載 ÷ 枠）/ reply_rate / apps_per_active_job / views_per_active_job / interested_per_100_scouts / hires / login_days |
| n_companies / mean / p25 / median / p75 | INT64 / FLOAT64 | 分布 |

## 元テーブル（依存するデータ）

cms_company_monthly, cms_company_master

## 更新
`bq/marts/scheduled_query.sql`（毎日 22:45 UTC = 07:45 JST）。生成ロジックの変更時は Worker の `src/worker/sql/` と `src/shared/schema/` を合わせ、`DATA_VERSION` を +1 する。
