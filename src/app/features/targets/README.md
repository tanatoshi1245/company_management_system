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
| （M3 で記載） | `GET /api/targets`, `GET/PUT/DELETE /api/companies/:id/targets/:month`, `POST …/targets/copy`, `POST /api/targets/bulk-defaults` | D1 company_targets / plan_target_defaults / audit_log、cms_company_master（企業名・プラン） |

## 編集するときの入口
TargetsListPage.tsx / TargetFormPage.tsx → targetsModel.ts → components/。検証スキーマは `src/shared/schema/targets.ts`。

## テスト
tests/app/targets.test.tsx, tests/worker/targets.test.ts
