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
画面の依頼を D1（`ai_jobs`）に保存し、セッションを立ち上げ、セッションが返した結果を受け取る（設計は [docs/AI機能.md](../../../docs/AI機能.md)）。
サンプルデータ（`BQ_MOCK=1`）のときはセッションを立ち上げず、決まった見本を返す。

| ファイル | 内容 |
|---|---|
| `routes.ts` | `/api/ai/*`・`POST /api/companies/:id/ai/jobs`（ログイン済みの画面から） |
| `hook.ts` | `/hook/ai/jobs/:jobId/{context,result}`（セッションから。Google ログインの外・ジョブごとの合言葉） |
| `service.ts` | 依頼の作成（入力の検証・社名と個人情報の確認・保存・発火・見本の分岐）、期限切れの扱い、応答への変換 |
| `repo.ts` | D1 `ai_jobs`（すべて `prepare().bind()`。更新は監査ログと同じ `db.batch()`） |
| `fire.ts` | セッションの発火（`api.anthropic.com` の routines/…/fire。Secret `AI_ROUTINE_ID`・`AI_ROUTINE_TOKEN`） |
| `token.ts` | 合言葉（32 バイトの乱数）・ハッシュ（SHA-256）・定数時間の比較・ジョブ ID |
| `defaults.ts` | 企業の選択肢、企業を選んだときに自動で入れる値、業界・職種の選択肢 |
| `report/` | ① セッションへ渡す数値の収集（`collect.ts`）と見本（`sample.ts`） |
| `scout/`・`job/` | ②③ の見本（`sample.ts`）。分析の SQL はセッション側（`ai/<機能>/sql/`） |

## 依存するデータ
| 使うもの | 出所 |
|---|---|
| 企業の存在・業界・企業種別・企業名（企業名は画面の表示と入力の確認だけ） | `cms_company_master`（`sql/companyDetail.ts` の `companyMasterByIdQuery`。10 分キャッシュ） |
| 企業の選択肢 | 当月のボードと同じ（`services/boardService.ts` の `getBoardCore`） |
| 掲載職種・求人の初期値 | `cms_company_job_monthly`（`services/companyService.ts` の `loadJobs`。直近 6 か月） |
| 職種の選択肢 | `cms_company_job_monthly.job_occupation`（`sql/ai.ts`。大分類にまとめる） |
| ① の数値 | `report/README.md` の表 |
| 依頼・結果・履歴 | D1 `ai_jobs`（`d1/migrations/0004_ai_jobs.sql`）+ `audit_log` |

## 守ること
- 企業は URL（`/api/companies/:id/ai/jobs`）からだけ。ジョブ ID だけの操作は、D1 の行から企業を引く
- セッションへ企業名を渡さない（`hook.ts` の context、`src/shared/ai/fireText.ts`）。発火の本文に、入力の本文・数値を入れない
- 合言葉は D1 にハッシュだけ。違うときは一律 401（理由を返さない）。ログ・エラー文に合言葉・トークンを出さない（`fire.ts` の `scrub`）
- 書き込みは `requireVerified`。`POST /api/companies/:id/ai/jobs` だけは、サンプルデータのときに仮の利用者にも見本を返すため、自前で「サンプルデータ以外では verified 必須」を確かめる（保存はしない）
- 外へ出る宛先は `lib/safeFetch.ts` の許可リスト

## 編集の入口
入力・結果の形 = `src/shared/ai/{common,report,scout,job}.ts` → `service.ts`（検証・保存）→ `routes.ts` / `hook.ts`。① に渡す数値を足すときは `report/collect.ts` と `report/README.md`。

## テスト
`tests/worker/ai.test.ts`（作成・発火・検証・履歴・直した版・削除・管理者）、`tests/worker/aiHook.test.ts`（合言葉・context・result・① の数値・選択肢）
