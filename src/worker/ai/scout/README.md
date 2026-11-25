---
tags: [domain/scout, layer/application, type/app-spec]
related:
  - "[[src/worker/ai/README]]"
  - "[[docs/AI機能]]"
status: active
---

# worker/ai/scout — ② スカウト文面の AI 添削（見本）

## 役割
`sample.ts` … サンプルデータ（`BQ_MOCK=1`）のときに返す見本の結果。セッションは立ち上げない。形は `src/shared/ai/scout.ts` の結果の型で、入力（業界・職種・ポジション名・勤務地・言語）を文に差し込む。実在の社名・個人名を書かない（差し込みは `{{企業名}}` など）。

## 依存するデータ
なし（固定の文。見本の件数・率は実際の集計ではなく、`basis.caveat` にその旨を書いている）。本番の分析は、セッションが `ai/scout/sql/` の SQL でマートを読む。

## 編集の入口
結果の形を変えたら `src/shared/ai/scout.ts` → この見本 → 画面（`src/app/features/ai/scout/`）。

## テスト
`tests/worker/ai.test.ts`（見本が結果の型を通ること）
