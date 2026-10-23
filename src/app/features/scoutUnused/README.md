---
tags: [domain/scout, domain/company-behavior, layer/application, type/app-spec, table/cms_company_master, table/cms_company_monthly, table/scout_unused_companies_monthly]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
  - "[[features/company/README]]"
status: active
---

# features/scoutUnused — スカウト未利用の理由・補足の登録

## 役割
月ごとに「スカウトを 1 件も送っていない契約中の企業（スカウト枠あり）」と営業担当（CS 担当）を並べ、右側のプルダウン（理由 8 件）と自由記述（補足 500 文字）で登録する。保存先は D1 `scout_unused_entries`（正）。保存のたびにシート取込と同じ表 BigQuery `dwh.scout_unused_companies_monthly` に `match_method = 'app'` の行として MERGE で写し（シートの行には触らない）、翌朝のマートで `cms_company_master.scout_unused_json` に統合される（同じ企業・月はアプリの行がシートの行より優先）。企業ページの「スカウト未利用状況」には D1 の最新を即時に重ねて表示する。

## 依存するデータ（画面要素 → API → マート列 → BQ 元テーブル）
| 画面要素 | API | マート.列 / D1 | BQ 元テーブル |
|---|---|---|---|
| 対象企業（契約中・送信 0・枠 > 0）、種別、営業担当、枠 | `GET /api/board?month=` | `cms_company_monthly.is_contracted_in_month / scout_sent`、`cms_company_master.scout_limit / cs_owner_name_default` | companies, scouts, active_companies |
| 登録済みの理由・補足・BQ 反映状態 | `GET /api/scout-unused?month=` | D1 `scout_unused_entries` | — |
| シートに既にある記録（参考・取り込み） | 同上 | `cms_company_master.scout_unused_json`（`source = 'sheet'`） | scout_unused_companies_monthly |
| 保存 / 削除 | `PUT / DELETE /api/scout-unused/:companyId/:month` | D1 + `audit_log` → BQ `scout_unused_companies_monthly`（`match_method = 'app'` の行を MERGE） | — |
| BQ に再同期 | `POST /api/scout-unused/sync` | D1 の `bq_synced_at` が無い / 古い行 | — |

## URL 状態
`month=YYYY-MM`（既定は前月）、`mine=1`（担当 = 自分）、`owner=a,b`（CS 担当のプルダウン。複数選択）、`q`（企業名・担当）。登録済みの行も同じ欄で編集でき、変更すると保存ボタンが有効になって PUT で更新する。

## 編集するときの入口
ScoutUnusedPage.tsx（一覧・行ごとの保存）→ `src/shared/schema/scoutUnused.ts`（入力・応答）→ Worker `routes/scoutUnused.ts` → `d1/scoutUnusedRepo.ts` / `services/scoutUnusedService.ts`（BQ MERGE・企業ページへの重ね合わせ）→ `sql/scoutUnused.ts`。理由の文言は `src/shared/labels.ts` の `SCOUT_UNUSED_REASONS`（シート取込と同じ文言を保つ）。

## テスト
tests/app/scoutUnused.test.tsx, tests/worker/scoutUnused.test.ts
