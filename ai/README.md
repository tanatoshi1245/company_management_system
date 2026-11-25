---
tags: [domain/company-behavior, domain/scout, domain/job-posting, layer/application, type/workflow, table/cms_company_master, table/cms_company_job_monthly, table/messages, table/scouts, table/scout_histories, table/jobs_all]
related:
  - "[[docs/AI機能]]"
  - "[[scripts/ai/README]]"
  - "[[src/shared/ai]]"
status: active
---

# ai — AI 機能のセッションの手順と SQL

## 役割
アプリの画面（`/ai/report`・`/ai/scout`・`/ai/job`）の依頼で立ち上がった **Claude Code のセッション**が読む手順書と、セッションが実行してよい SQL。
設計と全体の流れは [docs/AI機能.md](../docs/AI機能.md)。アプリ（Worker・画面）はこのディレクトリを読まない。

| ファイル | 内容 |
|---|---|
| [`session.md`](./session.md) | **セッションが最初に読む手順**（守ること・手順・うまくいかないとき・過去の結果の使い方） |
| [`report/`](./report/README.md) | ① AI 分析とレポート生成（スライドの組み方。BigQuery は読まない） |
| [`scout/`](./scout/README.md) | ② スカウト文面の AI 添削 / テンプレート作成（`sql/peer_templates.sql`） |
| [`job/`](./job/README.md) | ③ 求人の AI 添削 / 求人票の作成（`sql/peer_jobs.sql`・`sql/target_job.sql`） |

## 依存するデータ
- ①: Worker が渡す `company.data`（`src/worker/ai/report/collect.ts`。マート `cms_company_monthly` ほか）。セッションは BigQuery を読まない
- ②: `bq-hgt.dwh.cms_company_master`（企業・業界・プロファイル）、`scouts`・`scout_histories`（送信と興味あり返信）、`messages`（スカウトの最初の 1 通の件名・本文）
- ③: `bq-hgt.dwh.cms_company_master`、`cms_company_job_monthly`（求人ごとの閲覧・応募・条件）、`jobs_all`（仕事内容・応募条件）
- 定義（RA / RDS の除外・興味あり返信・スナップショットの重複排除）は claude_analysis の `CLAUDE.md` が正

## SQL の決まり
- 置き場所は `ai/<機能>/sql/<名前>.sql`。セッションは `npm run ai:sql -- <機能>/<名前>` でしか実行しない（[scripts/ai](../scripts/ai/README.md)）
- **SELECT 1 文だけ**。読むのは `bq-hgt.dwh.*` だけ。値は `@param` だけ（文字列連結をしない）
- 先頭のコメントに、目的・`-- param: <名前> <型> <required | default=<値> | nullable> [min=] [max=]`・`-- max_bytes: <数>GB`・返す列を書く
- 企業名・求人の ID を返さない（順位の番号だけ）。本文の中の企業名・URL・メールアドレス・電話番号は SQL の中で差し込みの記号に置き換える（目安）
- SQL を変えたら dry run でスキャン量を確かめ、[bq/README.md](../bq/README.md) の「AI 機能の SQL」に記録する

## 編集の入口
- 手順・書き方を変える → `session.md`、各機能の `guide.md`
- 結果の形を変える → `src/shared/ai/<kind>.ts`（画面・Worker・`scripts/ai/submit.ts` が同じ型を使う）。変えたら `guide.md` の例も直す
- SQL を足す → `ai/<機能>/sql/` にファイルを足す（許可リスト = このディレクトリのファイル名）

## テスト
`tests/repo/aiSql.test.ts`（SQL が SELECT だけ・宣言と `@param` の一致・読む表・手順書があること）
