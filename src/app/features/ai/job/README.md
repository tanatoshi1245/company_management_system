---
tags: [domain/job-posting, domain/company-behavior, layer/application, type/app-spec]
related:
  - "[[docs/AI機能]]"
  - "[[features/ai/common/README]]"
status: active
---

# features/ai/job — ③ 求人の AI 添削（`/ai/job`）

## 役割
目的（求人の添削 / 求人票の作成）を選び、既存企業と条件を入れて実行すると、セッションが「同じ業界・職種で『閲覧 → 応募』の率が高い求人」をふまえて添削・作成し、結果がこの画面に出る。作りは ② と同じ（左 = 入力と履歴、右 = 結果）。

- 添削する求人は「掲載中の求人から選ぶ」（企業の直近の掲載求人。求人の本文はセッションが読む）か「文を貼る」（求人タイトル・仕事内容・応募条件。仕事内容が必須）。
- 掲載中の求人を選ぶと、ポジション名・職種・勤務地・言語力・年収が自動で入る（値のある項目だけ。直せる）。企業を変えると、選んだ求人は外れる。
- 貼った文・ポジション名・補足に、企業名・メールアドレス・電話番号が入っていると実行できない。
- 結果: 要約 → 参考にした母集団 → 応募率の高い求人に共通する構成・特徴 → 添削の指摘 → 求人票の案（タイトル・仕事内容・応募条件。コピー・手直しと保存）。

## 依存するデータ
API は [common/README](../common/README.md) の表のとおり（`kind = job`）。掲載中の求人は `GET /api/ai/companies/:id/defaults` の `jobs`（`cms_company_job_monthly`）。入力と結果の形は `src/shared/ai/job.ts`（`JobInputSchema`・`JobResultSchema`）。結果の率・件数は、セッションが BigQuery（`ai/job/sql/`）を読んで作った値で、画面は計算しない。

## URL 状態
`company`（企業 ID）、`job`（開いている結果のジョブ ID。見本は入れない）、`purpose`（`review` 既定 / `create`）。

## 編集するときの入口
`JobPage.tsx` → `jobModel.ts`（フォーム → 入力、検証、掲載中の求人からの自動入力 `patchFromPostedJob`、結果の読み取り、案の手直し）→ `components/JobForm.tsx`・`components/PostedJobPicker.tsx`・`components/JobResultView.tsx`。

## テスト
`tests/app/aiJob.test.tsx`
