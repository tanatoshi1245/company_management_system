---
tags: [domain/company-behavior, layer/engineering, type/data-mart-spec, source/bq-internal, table/cms_contract_snapshot_daily, table/cms_company_master]
related:
  - "[[bq/README]]"
  - "[[docs/指標定義]]"
status: active
---

# `bq-hgt.dwh.cms_contract_snapshot_daily` — 契約・枠数・担当の日次スナップショット

**粒度**: recorded_on × company_id。**更新**: 当日分を DELETE → INSERT（冪等）。companies は最新契約しか持たないため、契約期間・枠数・担当の履歴はこの表でしか追えない（稼働開始日から蓄積）。

## 列定義

| 列 | 型 | 意味 |
|---|---|---|
| recorded_on | DATE | 記録日（パーティション） |
| company_id, internal_name, company_name, active_from, active_to, is_contracted, contract_state, scout_limit, job_posting_limit, company_type, industry, plan_name, sf_contract_id, sf_contract_status, sf_contract_end, sf_active_contract, sf_live_won_opp, da_active_profile, cs_owner_email_default, cs_owner_name_default, sales_staff | — | cms_company_master の同名列のコピー |
| note | STRING | 種入れ等の出所（通常 NULL） |

## 元テーブル（依存するデータ）

cms_company_master（同日の company_base）

## 更新
`bq/marts/scheduled_query.sql`（毎日 22:45 UTC = 07:45 JST）。生成ロジックの変更時は Worker の `src/worker/sql/` と `src/shared/schema/` を合わせ、`DATA_VERSION` を +1 する。
