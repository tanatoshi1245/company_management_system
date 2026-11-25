---
tags: [domain/scout, layer/application, type/workflow, source/bq-internal, table/messages, table/scouts, table/scout_histories, table/cms_company_master]
related:
  - "[[ai/README]]"
  - "[[ai/session]]"
  - "[[bq/README]]"
status: active
---

# ai/scout — ② スカウト文面の AI 添削 / テンプレート作成（セッションの手順と SQL）

## 役割
同じ業界で返信率（興味あり返信 ÷ 送信）の高い企業のスカウト文面の構成・特徴をふまえて、指定の文面を添削する / テンプレートを作る。
作り方は [`guide.md`](./guide.md)。結果の形は `src/shared/ai/scout.ts`（`ScoutResultSchema`）。

## 依存するデータ
| SQL | 読む表 | スキャン量 |
|---|---|---|
| [`sql/peer_templates.sql`](./sql/peer_templates.sql) | `cms_company_master`（企業 → プロファイル・業界・企業名（置き換え用））、`scouts`（送信・手動 / 自動）、`scout_histories`（興味あり返信）、`messages`（スカウトの最初の 1 通の件名・本文） | 約 18.4GB（上限 25GB。`messages` はパーティションが無く、件名と本文を読むと毎回この量） |

- 手動スカウトだけ（`scouts.is_auto_scout` でないもの）。RA（4928・14508）・RDS（7080）のプロファイルは除く。対象は `cms_company_master` に居る企業だけ（社内テストは入らない）
- 返信率 = 期間内に送ったスカウトのうち、興味あり返信（`from_status IN ('質問する','開封のみ') AND to_status = '興味あり'`）があった数 ÷ 送信数（送信月基準。直近に送った分は、まだ返信が来ていない分だけ低く出る）
- 文面 = スカウトの最初の 1 通（`scout_id` ごとに、企業からの最も早いメッセージ）。空白を除いて本文が同じものを 1 つにまとめる
- 同じ業界で比較に入る企業（`min_sent` 通以上）が `min_companies` 社に満たないときは、全業界で比べる（summary の `scope = 'all'`）。2026-11 時点で、50 通以上送った企業が 8 社以上ある業界は数業界だけ
- **企業名は返さない**。本文の中の企業名・URL・メールアドレス・電話番号は差し込みの記号に置き換えるが、置き換えは目安（マートの企業名と本文の表記が違えば残る。担当者名・サービス名も残りうる）

### パラメータ
| 名前 | 型 | 既定 | 内容 |
|---|---|---|---|
| `company_id` | INT64 | 必須 | 依頼の企業（比較から除く） |
| `industry` | STRING | NULL | 業界（`cms_company_master.industry` の表記）。無ければ全業界 |
| `months` | INT64 | 6 | 当月 + 直近 N か月（1〜12） |
| `min_sent` | INT64 | 50 | 比較に入れる企業の最低の送信数 |
| `min_companies` | INT64 | 8 | 同じ業界の企業がこの数に満たなければ全業界へ広げる |
| `top_companies` | INT64 | 5 | 文面を読む企業の数（1〜10） |
| `per_company` | INT64 | 3 | 企業ごとに返す文面の数（1〜5） |
| `min_uses` | INT64 | 3 | 文面として数える最低の通数 |
| `max_chars` | INT64 | 3000 | 本文を返す長さ |
| `include_own` | BOOL | true | 依頼の企業自身の文面（`row_type = 'own'`）も返すか |

## 編集の入口
- 観点・書き方 → `guide.md`。結果の形 → `src/shared/ai/scout.ts`
- SQL を変えたら `npm run ai:sql -- scout/peer_templates --param company_id=<ID> --dry` でスキャン量を確かめ、[bq/README.md](../../bq/README.md) に記録する（実行は 1 回 約 20GB。確かめる回数を絞る）

## テスト
`tests/repo/aiSql.test.ts`（SELECT だけ・宣言と `@param` の一致・読む表）
