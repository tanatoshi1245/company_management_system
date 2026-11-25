---
tags: [domain/job-posting, domain/application, layer/application, type/workflow, source/bq-internal, table/jobs_all, table/cms_company_job_monthly, table/cms_company_master]
related:
  - "[[ai/README]]"
  - "[[ai/session]]"
  - "[[bq/marts/cms_company_job_monthly/README]]"
  - "[[bq/README]]"
status: active
---

# ai/job — ③ 求人の AI 添削 / 求人票の作成（セッションの手順と SQL）

## 役割
同じ業界・職種で「閲覧 → 応募」の率（応募 ÷ 閲覧）が高い求人の構成・特徴をふまえて、指定の求人を添削する / 求人票を作る。
作り方は [`guide.md`](./guide.md)。結果の形は `src/shared/ai/job.ts`（`JobResultSchema`）。

## 依存するデータ
| SQL | 読む表 | スキャン量 |
|---|---|---|
| [`sql/peer_jobs.sql`](./sql/peer_jobs.sql) | `cms_company_master`（業界・企業名（置き換え用））、`cms_company_job_monthly`（求人ごとの閲覧・応募・タイトル・職種・条件）、`jobs_all`（仕事内容・応募条件） | 約 1.23GB（上限 3GB） |
| [`sql/target_job.sql`](./sql/target_job.sql) | `cms_company_master`（その企業のプロファイル）、`jobs_all`（添削する求人の中身）、`cms_company_job_monthly`（閲覧・応募） | 約 1.57GB（上限 3GB） |

- 求人キー（`job_key`）= `jobs_all.set_id`（日英のセットで 1 件）、無ければ `job_id`（マートと同じ。[cms_company_job_monthly](../../bq/marts/cms_company_job_monthly/README.md)）。企業への直接応募（`'(direct)'`）は求人ではないので除く
- `jobs_all` はスナップショット。`job_id` ごとに `recorded_on` が最新の 1 行へ重複排除してから使う。日英のセットは、`peer_jobs` は日本語（仕事内容にかなを含む方）を優先して 1 件、`target_job` は言語ごとに 1 行
- 率 = 期間（当月 + 直近 N か月）の応募の合計 ÷ 閲覧の合計（求人ごと。アカウント種別をまたいで合算）。閲覧は会員の求人詳細の閲覧（`member_job_detail_views`）
- 業界は企業の業界（`cms_company_master.industry`）。人材紹介会社の求人は、求人の中身の業界ではなく「人材紹介会社」として数える
- 条件に合う求人が `min_jobs` 件に満たないときは、順に広げる（summary の `scope`）: `industry_occupation` → `occupation` → `occupation_major`（職種の大分類）→ `industry` → `all`。業界 × 職種で 20 件を超える組み合わせは少ない
- `target_job` は、**その企業の求人であること**を SQL の中で確かめる（求人のプロファイルが、`cms_company_master.profile_ids` のその企業のものであること）。ほかの企業の求人キーは 0 行
- **企業名・求人の ID は返さない**。本文の中の企業名・URL・メールアドレス・電話番号は差し込みの記号に置き換える（目安。残りうる）

### パラメータ
`peer_jobs`:

| 名前 | 型 | 既定 | 内容 |
|---|---|---|---|
| `company_id` | INT64 | 必須 | 依頼の企業（比較から除く） |
| `industry` | STRING | NULL | 業界（`cms_company_master.industry` の表記） |
| `occupations` | ARRAY<STRING> | 空 | 職種（`--param occupations=…` を並べる。「大分類 - 小分類」か大分類。10 個まで） |
| `months` | INT64 | 6 | 当月 + 直近 N か月（1〜12） |
| `min_views` | INT64 | 50 | 比較に入れる求人の最低の閲覧数 |
| `min_jobs` | INT64 | 20 | この件数に満たなければ条件を広げる |
| `top_jobs` | INT64 | 8 | 返す求人の数（1〜15） |
| `max_chars` | INT64 | 2500 | 仕事内容・応募条件を返す長さ |

`target_job`: `company_id`（INT64・必須）、`job_key`（STRING・必須）、`months`（INT64・既定 6）、`max_chars`（INT64・既定 6000）。

## 編集の入口
- 観点・書き方 → `guide.md`。結果の形 → `src/shared/ai/job.ts`
- SQL を変えたら `npm run ai:sql -- job/<名前> … --dry` でスキャン量を確かめ、[bq/README.md](../../bq/README.md) に記録する。求人キーの決め方を変えるときは、マート（`bq/marts/scheduled_query.sql` の `job_set`）と合わせる

## テスト
`tests/repo/aiSql.test.ts`（SELECT だけ・宣言と `@param` の一致・読む表）
