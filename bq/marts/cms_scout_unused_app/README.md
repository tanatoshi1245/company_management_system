---
tags: [domain/scout, layer/engineering, type/data-mart-spec, source/bq-internal, table/cms_scout_unused_app, table/cms_company_master]
related:
  - "[[bq/README]]"
  - "[[features/scoutUnused/README]]"
status: active
---

# `bq-hgt.dwh.cms_scout_unused_app` — アプリで登録したスカウト未利用の理由・補足

**粒度**: 企業 × 対象月（`company_id`, `target_month` = 月初の日付）で 1 行。**更新**: 契約企業マネジメントシステムの登録ページ（`/scout-unused`）が保存のたびに Worker から `MERGE`（`src/worker/sql/scoutUnused.ts`、値はすべて `@param`）。スケジュールドクエリは読むだけ。表は `bq/marts/init.sql` の 4 で作成（2026-10-23）。

## 列
| 列 | 型 | 内容 |
|---|---|---|
| company_id | INT64 | companies.id |
| target_month | DATE | 対象月（月初） |
| unused_reason | STRING | 理由（8 件の定型文のどれか。`src/shared/labels.ts` の `SCOUT_UNUSED_REASONS`） |
| remarks | STRING | 補足（自由記述、500 文字まで） |
| sales_rep / company_name | STRING | 登録時点の CS 担当・企業名（表示用） |
| updated_by / updated_at | STRING / TIMESTAMP | 登録した人のメール・時刻 |
| deleted | BOOL | TRUE = 画面で削除（マートは無視） |

## 依存するデータ（元テーブル）
アプリの D1 `scout_unused_entries`（Worker が MERGE で写す）。BQ の生テーブルには依存しない。

## 使われ方
`scheduled_query.sql` の `scout_unused` CTE がシート取込 `scout_unused_companies_monthly` と統合し、同じ企業・月はこの表を優先して `cms_company_master.scout_unused_json` に入れる（`source = 'app'`）。正は D1 `scout_unused_entries`（`bq_synced_at` で反映状態を持つ）。

## 権限
Worker 用 SA `cms-bq-reader` にこの表だけ `roles/bigquery.dataEditor`（`docs/デプロイ手順.md` 8）。

## テスト
tests/worker/scoutUnused.test.ts（MERGE の SQL と @param の検証）
