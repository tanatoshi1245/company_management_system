---
tags: [domain/application, layer/application, type/app-spec]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# features/settings — 設定・ヘルプ

## 役割
データの鮮度（マート更新・営業日）、Worker の設定の有無、担当上書きの一覧、プラン既定値、指標の定義（src/shared/metrics/definitions.ts から生成）。

## 依存するデータ（画面要素 → API → ソース）
| 画面要素 | API | ソース |
|---|---|---|
| 鮮度 | `GET /api/meta` | cms_refresh_log、祝日 JSON |
| 設定の有無 | `GET /api/health` | Worker の変数（値は出ない） |
| 担当上書き・プラン既定値 | `GET/PUT /api/settings/*`（M3） | D1 company_settings / plan_target_defaults |

## 編集するときの入口
SettingsPage.tsx / HelpPage.tsx → components/。

## テスト
tests/app/settings.test.tsx
