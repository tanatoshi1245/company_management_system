---
tags: [domain/application, layer/application, type/app-spec]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# worker/routes — API ルート一覧

## 役割
`/api/*` のルート。認証ミドルウェア（fail-closed）は `src/worker/index.ts` で先頭に掛けてあり、ここに来るリクエストはログイン済み。書き込みは `requireVerified` + `sameOriginGuard`。

## ルート表（依存するデータ）
| Method / path | 認証 | 入力（zod） | 返すもの | ソース |
|---|---|---|---|---|
| GET /api/health | session | — | 設定の有無 | Worker の変数 |
| GET /api/me | session | — | ログイン者 | セッション |
| GET /api/meta | session | ?refresh=1 | 鮮度・営業日・注記 | cms_refresh_log（300 秒キャッシュ）、祝日 JSON |
| （M1〜M3 で追記）| | | | |

## 編集するときの入口
routes/<resource>.ts → services/ → sql/ or d1/。応答の形は `src/shared/schema/`。
