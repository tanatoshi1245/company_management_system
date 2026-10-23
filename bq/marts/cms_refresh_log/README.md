---
tags: [domain/company-behavior, layer/engineering, type/data-mart-spec, source/bq-internal, table/cms_refresh_log]
related:
  - "[[bq/README]]"
  - "[[docs/指標定義]]"
status: active
---

# `bq-hgt.dwh.cms_refresh_log` — マート更新スクリプトの実行記録

**粒度**: run_date × step。**更新**: 追記（成功: status = ok、失敗: error + note にエラー文）。Worker は最新の ok 行の run_date を dataVersion（キャッシュキー）にする。

## 列定義

| 列 | 型 | 意味 |
|---|---|---|
| run_date / step / started_at / finished_at / status / rows_master / rows_monthly / note | — | |

## 元テーブル（依存するデータ）

（scheduled_query.sql 自身）

## 更新
`bq/marts/scheduled_query.sql`（毎日 22:45 UTC = 07:45 JST）。生成ロジックの変更時は Worker の `src/worker/sql/` と `src/shared/schema/` を合わせ、`DATA_VERSION` を +1 する。
