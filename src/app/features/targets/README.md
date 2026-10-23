---
tags: [domain/sales, domain/company-behavior, layer/application, type/app-spec, table/cms_company_master]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# features/targets — 契約時の目標（登録・一覧）

## 役割
企業ごとの月別目標（スカウト送信・興味あり・応募・閲覧・採用・選考段階）を登録・編集し、達成率と変更履歴を見る。目標は D1 `company_targets` に保存し、ボードの「目標比」で使う。

## 依存するデータ（画面要素 → API → ソース）
| 画面要素 | API | ソース |
|---|---|---|
| 一覧: 企業名・プラン・担当・当月実績 | `GET /api/board?month=` | cms_company_master / cms_company_monthly（+ D1 の目標・設定を合成） |
| 一覧: 当月の目標 5 項目・達成率バー（期待 = 目標 × 営業日消化率）・最終更新 | `GET /api/targets?month=` | D1 company_targets |
| 一覧: 「プラン既定値で未設定を埋める」 | `POST /api/targets/bulk-defaults`（verified） | D1 plan_target_defaults → company_targets（空の (企業, 月) だけ）+ audit_log |
| フォーム: ヘッダ（企業名・プラン・担当・枠） | `GET /api/companies/:id?month=` | cms_company_master + D1 company_settings |
| フォーム: 12 か月 × 8 行のグリッド・備考 | `GET /api/companies/:id/targets?from=&to=` → `PUT/DELETE /api/companies/:id/targets/:month`（差分の月だけ） | D1 company_targets + audit_log（同一 batch） |
| フォーム: 前月からコピー / プラン既定値を適用 | クライアント側で空セルを埋める（保存は「差分を保存」） | `GET /api/settings/plan-defaults` |
| フォーム: 企業の設定（担当上書き・枠の期間・枠の上書き・メモ） | `PUT /api/companies/:id/settings`（verified） | D1 company_settings + audit_log |
| フォーム: 変更履歴 | `GET /api/companies/:id/targets/history` | D1 audit_log（company_id で絞る） |

## URL 状態
一覧 `/targets`: `month`, `mine=1`, `missing=1`, `q`, `sort=name|updated|progress`。フォーム `/targets/:id`: `from=YYYY-MM`（グリッドの開始月 − 1 か月から 12 か月）、`#settings` で企業の設定へスクロール。

## 編集するときの入口
TargetsListPage.tsx / TargetFormPage.tsx → targetsModel.ts（グリッドの状態・差分・コピー・既定値の適用）→ components/（MonthGridForm, TargetProgressBar, ChangeHistory, CompanySettingsForm, BulkDefaultsDialog）。
検証スキーマは `src/shared/schema/targets.ts` / `settings.ts`（Worker と共用。未知のキーは 400）。Worker 側は `routes/targets.ts` / `routes/settings.ts` → `d1/*Repo.ts`。

## 書き込みの規則（Worker で強制）
- `company_id` は URL パスからだけ。本文にあれば 400。マスタに無い企業は 404
- 書き込みは Google ログイン済み（`requireVerified`）+ 同一オリジン（`sameOriginGuard`）。モックの仮の利用者は 403 readOnly
- 更新と監査ログは 1 つの `db.batch()`。`stages` は許可キーだけを再シリアライズ
- コピー・一括既定値は目標の無い (企業, 月) だけに作る

## テスト
tests/app/targets.test.tsx, tests/worker/targets.test.ts
