---
tags: [domain/company-behavior, domain/scout, domain/job-posting, layer/application, type/app-spec]
related:
  - "[[docs/AI機能]]"
  - "[[src/worker/routes/README]]"
  - "[[d1/README]]"
status: active
---

# worker/ai — AI 機能の Worker 側

## 役割
画面の依頼を受け、Worker が Vertex AI を呼んで、その場で結果を作って返す（設計は [docs/AI機能.md](../../../docs/AI機能.md)。2026-11-27 に、依頼のたびにセッションを立ち上げる方式をやめた）。
いま使えるのは ② スカウトだけ。③ 求人・① 分析レポートは準備中で、依頼は 409（`notReady`）を返す（`service.ts` の `AI_FEATURES`）。
サンプルデータ（`BQ_MOCK=1`）のときは Vertex AI を呼ばず、決まった見本を返す。

| ファイル | 内容 |
|---|---|
| `routes.ts` | `/api/ai/*`・`POST /api/companies/:id/ai/jobs`（ログイン済みの画面から）。② のフィードバック・モデルは `scout/routes.ts` |
| `enabled.ts` | 停止スイッチ（`aiEnabled` = `AI_ENABLED`。既定は停止で、止まっている間は AI の API がすべて 503 `aiDisabled`）と、② の会員 ID から作る機能の開け閉め（`aiScoutMemberEnabled` = `AI_ENABLED` かつ `AI_SCOUT_MEMBER`。既定は閉じる） |
| `service.ts` | 共通の部品（企業の確認・管理者の判定・社名と個人情報の確認・応答への変換・機能ごとの可否） |
| `vertex.ts` | Vertex AI の呼び出し（`callVertexJson`: アクセストークンの使い回し・タイムアウト 40 秒・JSON と zod の検証・1 回だけやり直し）、設定の確認（`vertexConfigured`） |
| `repo.ts` | D1 `ai_jobs`（すべて `prepare().bind()`。更新は監査ログと同じ `db.batch()`） |
| `ids.ts` | ジョブ ID・案の ID |
| `defaults.ts` | 企業の選択肢、企業を選んだときに自動で入れる値、業界・職種の選択肢 |
| `scout/` | ② スカウト文面の AI 作成 / 添削（分析の要点・3 つのモデル・フィードバック・チューニング）。[scout/README.md](./scout/README.md) |
| `report/`・`job/` | ①③ の見本と、① に渡す数値の収集（`report/collect.ts`）。後の段階で使う（いまはルートから呼ばない） |

## 設定
| 名前 | 種類 | 内容 |
|---|---|---|
| `VERTEX_PROJECT`・`VERTEX_LOCATION` | vars | `bq-hgt`・`global`（global 以外の location は 404 だった） |
| `AI_SCOUT_ENGINES` | vars | ② の 3 つのモデルが使う生成モデルの ID（`a=…,b=…,c=…`） |
| `AI_INSIGHT_ENGINE` | vars | 分析の要点とチューニングに使う生成モデルの ID |
| `VERTEX_SA_KEY` | Secret | Vertex AI を呼ぶ SA の鍵 JSON。無ければ `BQ_SA_KEY` を使う。SA に `roles/aiplatform.user` が要る |
| `AI_ENABLED` | vars | 停止スイッチ。`"1"` のときだけ AI 機能が動く（既定は停止） |
| `AI_SCOUT_MEMBER` | vars | ② の、会員 ID から作る 2 つの作り方（`member`・`jobMember`）を開けるか。`"1"` のときだけ開く（**既定は閉じる**。候補者の属性 = 年齢層・語学力・経験職種などを Vertex AI へ渡すので、ユーザーの確認が済むまで閉じておく。2026-11-27）。閉じている間は、画面に出さず（`/api/ai/config` の `features.scoutMember = false`）、Worker も 403 `featureDisabled` で受け付けず、会員のデータを読まない |
| `AI_ADMIN_EMAILS` | Secret / vars | 管理者（プレイブックを見る・チューニングを実行する・前の版へ戻す） |

生成モデルの ID は、コード・文書に書かない（設定値。形は `^[a-z0-9.\-]{3,60}$` で確かめる）。

## 依存するデータ
| 使うもの | 出所 |
|---|---|
| 企業の存在・業界・企業種別・企業名（企業名は画面の表示と、入力・出力の確認だけ） | `cms_company_master`（`sql/companyDetail.ts` の `companyMasterByIdQuery`。10 分キャッシュ） |
| 企業の選択肢 | 当月のボードと同じ（`services/boardService.ts` の `getBoardCore`） |
| 掲載職種・求人の初期値 | `cms_company_job_monthly`（`services/companyService.ts` の `loadJobs`。直近 6 か月） |
| 職種の選択肢 | `cms_company_job_monthly.job_occupation`（`sql/ai.ts`。大分類にまとめる） |
| ② の分析対象・照合結果 | `dwh.cms_ai_scout_*`（`scout/README.md` の表） |
| 依頼・結果・履歴 | D1 `ai_jobs`（`0004_ai_jobs.sql`）、② のモデル・案・フィードバック（`0005_ai_scout.sql`）+ `audit_log` |

## 守ること
- 企業は URL（`/api/companies/:id/ai/jobs`）からだけ。ジョブ ID だけの操作は、D1 の行から企業を引く
- ログインの外の入口は無い（以前の `/hook/ai/*` は無くした。`/hook/` は 404）。合言葉なしで通るルートを足さない
- Vertex AI へ企業名を渡さない。入力の社名・個人情報の確認（`src/shared/ai/pii.ts`）を外さない。出力にも同じ確認を掛ける
- ログ・エラー文・`/api/health`・`/api/ai/config` に、鍵・トークン・Vertex AI の応答の本文を出さない（`vertex.ts` の `VertexError` は決まった文だけ）
- 書き込みは `requireVerified`。`POST /api/companies/:id/ai/jobs` だけは、サンプルデータのときに仮の利用者にも見本を返すため、自前で「サンプルデータ以外では verified 必須」を確かめる（保存はしない）
- **候補者の職務経歴・自己PR は使わない**（2026-11-27 ユーザー指示で外した）。閲覧制限付きのデータセット `dwh_restricted` を読むコードを足さない（`tests/worker/aiScoutData.test.ts` が検査する）
- 会員 ID から作る機能を、ユーザーの確認なしに開けない（`AI_SCOUT_MEMBER` を `"1"` にしない）。閉じている間に、会員のデータを読む道を足さない
- 外へ出る宛先は `lib/safeFetch.ts` の許可リスト（`aiplatform.googleapis.com`・`oauth2.googleapis.com`）

## 編集の入口
入力・結果の形 = `src/shared/ai/{common,report,scout,job}.ts` → 機能ごとの `service.ts`（検証・保存）→ `routes.ts`。機能を使えるようにするときは `service.ts` の `AI_FEATURES` と、`routes.ts` の作成の分岐。

## テスト
`tests/worker/aiDisabled.test.ts`（停止スイッチ）、`tests/worker/ai.test.ts`（設定・検証・準備中・見本・履歴・ログインの外の入口が無いこと・Vertex AI の呼び出し）、`tests/worker/aiScout.test.ts`・`aiScoutTuning.test.ts`（② スカウト）
