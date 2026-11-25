---
tags: [domain/company-behavior, layer/application, type/workflow, table/cms_company_monthly, table/cms_company_job_monthly, table/cms_industry_benchmark_monthly]
related:
  - "[[ai/README]]"
  - "[[ai/session]]"
  - "[[src/worker/ai/report/README]]"
status: active
---

# ai/report — ① AI 分析とレポート生成（セッションの手順）

## 役割
企業ページで表示している期間・企業の利用状況（スカウト・求人）を分析し、企業への提案までをまとめたスライドを作る。
作り方は [`guide.md`](./guide.md)。結果の形は `src/shared/ai/report.ts`（`ReportResultSchema`）。

## 依存するデータ
セッションは BigQuery を読まない。数値は、Worker が context の `company.data` に入れて渡す（`src/worker/ai/report/collect.ts`。項目とマートの列の対応は [src/worker/ai/report/README.md](../../src/worker/ai/report/README.md)）。
元のマート: `cms_company_master`・`cms_company_monthly`・`cms_company_job_monthly`・`cms_scout_member_attributes_monthly`・`cms_industry_benchmark_monthly`・`cms_scout_cohort_status`・`cms_application_cohort_status`。

## 編集の入口
- スライドの組み方・読み方 → `guide.md`
- スライドの形（layout・文字数）→ `src/shared/ai/report.ts`（画面の枠 `src/app/features/ai/report/slides` と合わせる）
- 渡す数値を足す → `src/worker/ai/report/collect.ts` と同 README、`guide.md` の「data の項目」

## テスト
`tests/repo/aiSql.test.ts`（手順書があること）。結果の形は `npm run ai:submit -- --kind report --file <JSON> --dry`。
