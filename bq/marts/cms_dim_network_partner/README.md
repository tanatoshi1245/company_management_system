---
tags: [domain/sales, layer/engineering, type/data-mart-spec, source/bq-internal, source/hatarakudb, table/cms_dim_network_partner, table/htdb_applications_wo_FEE]
related:
  - "[[bq/README]]"
  - "[[docs/指標定義]]"
  - "[[docs/数値の出所]]"
status: active
---

# `bq-hgt.dwh.cms_dim_network_partner` — Network 契約の申込元

**粒度**: 申込元（`customer_name`）1 行。**更新**: 手動（`bq/marts/init.sql` の 2b。追加は `INSERT`）。**読み手**: マート更新スクリプトのステップ 01b だけ（Worker は読まない）。

Network = 海外の求人サイト（Totaljobs・StepStone 等）が顧客企業の求人を Daijob に載せる契約。働くDB の【0円】申込では、申込元（`customer_name`）が
求人サイトの運営会社、実際に掲載する企業が `publishing_company_name` になる。商品名は通常の Daijob Single Job Posting と同じことが多く、
サービス名 `Daijob.com（Network）` が付くのは 2026-10 以降の一部だけなので、**申込元で判定する**。

## 列定義

| 列 | 型 | 意味 |
|---|---|---|
| customer_name | STRING | 働くDB `htdb_applications_wo_FEE.customer_name` と完全一致させる申込元名 |
| note | STRING | 国・最終契約など（参考） |

## 現在の中身（8 行）

Totaljobs Group Ltd. / StepStone Deutschland GmbH / StepStone Denmark / Appcast, Inc. / Figaro Classifieds / IrishJobs.ie / Nexxt, Inc / Network eG.
（2026-10-30 に `htdb_applications_wo_FEE` の「申込元 ≠ 掲載企業」の頻度から抜き出した。**正式な一覧は Network 事業の担当者に確認して更新する**）

## 新しい申込元が現れたとき

`cms_refresh_log.note` の `network_unmatched`（社名が `companies` に結べなかった有効な Network 申込）や、`htdb_applications_wo_FEE` で
`customer_name != publishing_company_name` の行を見て、Network 経由なら `INSERT INTO bq-hgt.dwh.cms_dim_network_partner VALUES ('<申込元名>', '<メモ>')` を実行する（翌朝のマート更新で除外に反映）。

## 元テーブル（依存するデータ）

`htdb_applications_wo_FEE`（働くDB の【0円】申込。`claude_analysis/02_データエンジニアリング/働くDB_ETL`）

## 更新
`bq/marts/scheduled_query.sql`（毎日 22:45 UTC = 07:45 JST）のステップ 01b が参照する。判定ロジックの変更時は Worker の `src/worker/sql/` と `src/shared/schema/` を合わせ、`DATA_VERSION` を +1 する。
