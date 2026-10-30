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
月ごとに「スカウトを 1 件も送っていない契約中の企業（スカウト枠あり、DA / RPO 以外）」と CS 担当を 種別 / CS 担当 / 企業名 / 理由 / 補足 / 登録 の列で並べ、プルダウン（理由 8 件）と自由記述（補足 500 文字）で登録する。広告掲載（`contractKind = 'ad'`）の企業は企業名を薄い黄色で強調する。フィルタは 担当 = 自分 / CS 担当 / 登録状況 / 企業種別 / 契約種別 / 検索で、選択肢の件数は他のフィルタに連動する（ボードと同じ）。保存先は D1 `scout_unused_entries`（正）。保存のたびにシート取込と同じ表 BigQuery `dwh.scout_unused_companies_monthly` に `match_method = 'app'` の行として MERGE で写し（シートの行には触らない）、翌朝のマートで `cms_company_master.scout_unused_json` に統合される（同じ企業・月はアプリの行がシートの行より優先）。企業ページの「スカウト未利用状況」には D1 の最新を即時に重ねて表示する。

## 依存するデータ（画面要素 → API → マート列 → BQ 元テーブル）
| 画面要素 | API | マート.列 / D1 | BQ 元テーブル |
|---|---|---|---|
| 対象企業（契約中・送信 0・枠 > 0）、種別、CS 担当、契約種別（広告掲載の強調・フィルタ） | `GET /api/board?month=` | `cms_company_monthly.is_contracted_in_month / scout_sent`、`cms_company_master.scout_limit / cs_owner_name_default / company_type / account_types / contract_kind` | companies, scouts, active_companies, company_profiles_full |
| 登録済みの理由・補足・BQ 反映状態 | `GET /api/scout-unused?month=` | D1 `scout_unused_entries` | — |
| BQ に既にある記録（シート取込。入力欄の初期値と「登録済み」の表示） | 同上 | `cms_company_master.scout_unused_json`（`source = 'sheet'`） | scout_unused_companies_monthly |
| 保存 / 削除 | `PUT / DELETE /api/scout-unused/:companyId/:month` | D1 + `audit_log` → BQ `scout_unused_companies_monthly`（`match_method = 'app'` の行を MERGE） | — |
| BQ に再同期 | `POST /api/scout-unused/sync` | D1 の `bq_synced_at` が無い / 古い行 | — |

## URL 状態
`month=YYYY-MM`（既定は前月）、`mine=1`（担当 = 自分）、`owner=a,b`（CS 担当。複数選択）、`status=none|done|unsynced`（登録状況: 未登録 / 登録済み（アプリ or シート）/ BQ 未反映）、`type=直接,紹介`（企業種別。副アカウントの種別でも一致）、`kind=ad,success`（契約種別）、`q`（企業名・担当）。クリアで全部消す。登録済みの行も同じ欄で編集でき、変更すると登録ボタンが有効になって PUT で更新する。

## 編集するときの入口
ScoutUnusedPage.tsx（一覧・行ごとの保存）→ `src/shared/schema/scoutUnused.ts`（入力・応答）→ Worker `routes/scoutUnused.ts` → `d1/scoutUnusedRepo.ts` / `services/scoutUnusedService.ts`（BQ MERGE・企業ページへの重ね合わせ）→ `sql/scoutUnused.ts`。理由の文言は `src/shared/labels.ts` の `SCOUT_UNUSED_REASONS`（シート取込と同じ文言を保つ）。

## テスト
tests/app/scoutUnused.test.tsx, tests/worker/scoutUnused.test.ts
