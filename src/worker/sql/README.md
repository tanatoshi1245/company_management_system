---
tags: [domain/application, layer/application, type/code-index, table/cms_refresh_log]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# worker/sql — マート読み取り SQL（@param のみ）

## 役割
マートごとに 1 つの BuiltQuery ビルダー。利用者入力はすべて `p.*`（queryParameters）で渡し、SQL 本文に埋め込まない。テーブル名は `bq-hgt.dwh.cms_*` の固定リスト。

## 依存するデータ（ビルダー → マート → 元テーブル）
| ビルダー | マート | 元テーブル（マート README 参照） |
|---|---|---|
| refreshLog.ts | cms_refresh_log | （スクリプトの実行記録） |
| （M1〜M2 で追記） | | |

## テスト
tests/worker/sql.test.ts（@param 以外のリテラルが無いこと）
