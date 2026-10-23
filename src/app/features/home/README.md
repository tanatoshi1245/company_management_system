---
tags: [domain/company-behavior, domain/scout, domain/application, layer/application, type/app-spec, table/cms_company_master, table/cms_company_monthly, table/cms_industry_benchmark_monthly]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# features/home — ホーム（契約企業ボード）

## 役割
ログイン直後の全体図。契約企業を KPI タイル → 注目レーン → マトリクス・ヒートマップで一覧し、`担当=自分` などの絞り込みと「業界比 / 目標比」の切替をクライアント側で行う。

## 依存するデータ（画面要素 → API → マート列 → BQ 元テーブル）
| 画面要素 | API | マート.列 | BQ 元テーブル |
|---|---|---|---|
| （M1 で記載） | `GET /api/board?month=` | cms_company_master / cms_company_monthly / cms_industry_benchmark_monthly / cms_company_login | companies, company_profiles, scouts, scout_histories, member_applications, member_job_detail_views, job_publish_history, sf_* |

## 編集するときの入口
HomePage.tsx → homeModel.ts（計算）→ components/（描画）。指標の式は `src/shared/metrics/`、ラベルは `src/shared/labels.ts`。

## テスト
tests/app/home.test.tsx, tests/shared/board.test.ts
