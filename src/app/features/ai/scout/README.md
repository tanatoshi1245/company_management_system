---
tags: [domain/scout, domain/company-behavior, layer/application, type/app-spec]
related:
  - "[[docs/AI機能]]"
  - "[[features/ai/common/README]]"
status: active
---

# features/ai/scout — ② スカウト文面の AI 添削（`/ai/scout`）

## 役割
目的（スカウト文面の添削 / テンプレートの作成）を選び、既存企業（ボードに出ている企業だけ）と条件を入れて実行すると、セッションが「同じ業界で返信率の高い企業の文面」をふまえて添削・作成し、結果がこの画面に出る。左 = 入力と履歴、右 = 結果（狭い画面では縦）。

- 企業を選ぶと、業界と掲載職種（上位 3 つ）が自動で入る（直せる。直した項目は上書きしない）。
- 添削は件名と本文が必須。**件名・本文・ポジション名・補足に、企業名・メールアドレス・電話番号が入っていると実行できない**（`findPii` の block）。「株式会社」「〇〇様」は注意だけ。
- 結果: 要約 → 参考にした母集団 → 返信率の高い文面に共通する構成・特徴 → 添削の指摘（重要度の順）→ 文面の案（1〜3 個。コピー・手直しと保存）。
- 結果は企業ごとに残り、履歴から開ける（開くと、そのときの入力が欄に入る）。

## 依存するデータ
API は [common/README](../common/README.md) の表のとおり（`kind = scout`）。入力と結果の形は `src/shared/ai/scout.ts`（`ScoutInputSchema`・`ScoutResultSchema`）。結果の率・件数は、セッションが BigQuery（`ai/scout/sql/`）を読んで作った値で、画面は計算しない。

## URL 状態
`company`（企業 ID）、`job`（開いている結果のジョブ ID。見本は入れない）、`purpose`（`review` 既定 / `template`）。

## 編集するときの入口
`ScoutPage.tsx`（割り付けと動き）→ `scoutModel.ts`（フォーム → 入力、検証、社名・個人情報の確認、結果の読み取り、案の手直し）→ `components/ScoutForm.tsx`・`components/ScoutResultView.tsx`。共通の条件の欄は `common/TargetConditionFields.tsx`。

## テスト
`tests/app/aiScout.test.tsx`
