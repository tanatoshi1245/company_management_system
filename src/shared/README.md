---
tags: [domain/application, layer/application, type/code-index]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# shared — Worker とブラウザで共用する純粋関数

## 役割
- `calendar/`: JST の日付・月・営業日（祝日 `jp-holidays.json`、年末年始）
- `schema/`: 応答の zod スキーマと DATA_VERSION
- `metrics/`: 消化率・ペース・ベンチマーク・ヒートマップ・ヘルス（M1）
- `caveats.ts`: データの注記、`labels.ts`: 日本語ラベル（M1）

## 依存するデータ
マートの列名は `schema/` の型に現れる。元テーブルは `bq/marts/*/README.md`。

## テスト
tests/shared/*.test.ts
