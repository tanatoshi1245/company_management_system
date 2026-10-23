---
tags: [domain/company-behavior, layer/engineering, type/data-mart-spec, source/bq-internal, table/cms_dim_industry_alias]
related:
  - "[[bq/README]]"
  - "[[docs/指標定義]]"
status: active
---

# `bq-hgt.dwh.cms_dim_industry_alias` — Salesforce 業種の表記ゆれ対応表

**粒度**: sf_value（SF 取引先の業種表記）。**更新**: 手動（init.sql。01_データ分析/Salesforce_分析/.../sf_industry_alias.json と同じ内容）。

## 列定義

| 列 | 型 | 意味 |
|---|---|---|
| sf_value / dj_industry / is_ignored | STRING / STRING / BOOL | SF の表記 → Daijob 業種名。is_ignored = 情報なしとして扱う（未分類） |

## 元テーブル（依存するデータ）

sf_industry_alias.json（claude_analysis）

## 更新
`bq/marts/scheduled_query.sql`（毎日 22:45 UTC = 07:45 JST）。生成ロジックの変更時は Worker の `src/worker/sql/` と `src/shared/schema/` を合わせ、`DATA_VERSION` を +1 する。
