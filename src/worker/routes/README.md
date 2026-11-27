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
| GET /api/board | session | ?month=YYYY-MM（直近 14 か月）, ?refresh=1 | 企業 × 当月の実績・契約・担当・ベンチマーク（`BoardResponse`） | cms_company_master, cms_company_monthly, cms_company_login, cms_industry_benchmark_monthly（マート部分をキャッシュ）+ D1 company_targets / company_settings |
| GET /api/companies/:id | session | :id `^\d{1,12}$`, ?month=, ?refresh=1 | 1 社の詳細（`CompanyDetailResponse`。アカウント種別ごとの月次・求人一覧を含む。無ければ 404） | 上記（cms_company_monthly は `account_type = '__ALL__'` と種別の行）+ cms_company_daily_usage, cms_scout_cohort_status, cms_application_cohort_status |
| GET /api/companies/:id/attributes | session | ?from=YYYY-MM&to=YYYY-MM（窓内、from <= to）, ?account=直接\|紹介\|派遣（許可リスト）, ?job=<set_id\|job_id\|direct>, ?refresh=1 | 会員属性の内訳（`AttributesResponse`。期間・アカウント種別・求人で BQ 側に集約。Cache API） | cms_scout_member_attributes_monthly |
| GET /api/companies/:id/jobs | session | ?from&to（同上）, ?account=, ?job=, ?refresh=1 | 求人ごとの期間集計（`JobsResponse`。閲覧の多い順。行に求人の条件 `cond` と Hot Job 期間 `hot`（直接応募は null）。job 指定でその求人の月次も。Cache API）。表への権限が無ければ 502（code: bq） | cms_company_job_monthly |
| GET /api/targets | session | ?month= | 月の目標（全企業、D1 のみ） | D1 company_targets |
| GET /api/companies/:id/targets | session | ?from=&to=（既定 −13〜+12 か月） | 企業の目標 | D1 company_targets |
| GET /api/companies/:id/targets/history | session | ?limit=（≤200） | 監査ログ | D1 audit_log |
| PUT /api/companies/:id/targets/:month | verified + 同一オリジン | `TargetInputSchema`（strict。company_id は本文不可） | 201 / 200 + 行 | D1 company_targets + audit_log（1 batch）。企業の存在は cms_company_master で確認 |
| DELETE /api/companies/:id/targets/:month | verified + 同一オリジン | — | 204（無ければ 404） | 同上 |
| POST /api/companies/:id/targets/copy | verified + 同一オリジン | `{fromMonth, toMonths[] ≤12}` | `{created[], skipped[]}`（目標の無い月だけ） | 同上 |
| POST /api/targets/bulk-defaults | verified + 同一オリジン | `{months[] ≤12, companyIds[]? ≤500}` | `{created, noPlan}`（空の (企業, 月) だけ） | D1 plan_target_defaults → company_targets + audit_log、ボードのマート（プラン名） |
| GET /api/companies/:id/settings | session | — | 企業設定 | D1 company_settings |
| PUT /api/companies/:id/settings | verified + 同一オリジン | `SettingsInputSchema`（担当メールは許可ドメイン内） | 行（全項目空なら削除） | D1 company_settings + audit_log |
| GET /api/settings/overrides | session | ?limit=（≤500） | 上書きのある企業 | D1 company_settings |
| GET / PUT /api/settings/plan-defaults | session / verified | `{plan, values}`（null の指標は削除） | `{plans, updatedAt}` | D1 plan_target_defaults + audit_log |
| POST /api/admin/cache/bump | verified + 同一オリジン | — | `{cacheEpoch}` | D1 app_meta + audit_log |
| `GET /api/scout-unused?month=` / `PUT`・`DELETE /api/scout-unused/:companyId/:month` / `POST /api/scout-unused/sync` | `scoutUnused.ts` | スカウト未利用の理由・補足（D1 が正 → BigQuery `scout_unused_companies_monthly` に `match_method = 'app'` の行を MERGE）。書き込みは `requireVerified` + 同一オリジン、strict zod、監査ログ同 batch |
| GET /api/ai/config | session | — | `AiConfigResponse`（Vertex AI を呼べる設定 = `fireConfigured`・保存先の有無、見本で動くか、書き込めるか、管理者か、機能ごとの可否 `features`（`scoutMember` = ② の会員 ID から作る機能が開いているか。既定は false）。真偽値だけ） | Worker の変数 |
| GET /api/ai/companies | session | — | `AiCompaniesResponse`（当月のボードに出ている企業） | ボードのマート（キャッシュ共用） |
| GET /api/ai/companies/:id/defaults | session | :id | `AiCompanyDefaultsResponse`（業界・掲載職種・直近 6 か月の求人、業界・職種の選択肢。無い企業は 404） | cms_company_master, cms_company_job_monthly |
| GET /api/ai/jobs | session | ?company=&kind=report\|scout\|job（strict） | `AiJobListResponse`（新しい順・30 件まで。結果の本体なし。D1 が無ければ空） | D1 ai_jobs |
| GET /api/ai/jobs/:jobId | session | :jobId `^[a-z0-9]{16,40}$` | `AiJobDetail`（入力・結果・直した版。② は、各案に `feedback`、結果に `choice` を付ける。sessionUrl は常に null） | D1 ai_jobs・ai_scout_drafts, cms_company_master（企業名。10 分キャッシュ） |
| POST /api/companies/:id/ai/jobs | verified + 同一オリジン（サンプルデータのときだけ仮の利用者も可・保存しない） | `{kind, input}`（strict。kind = scout だけ。job / report は 409 `notReady`。**`input.basis` が member / jobMember のとき、会員 ID から作る機能が閉じていれば（既定。`AI_SCOUT_MEMBER`）403 `featureDisabled`（保存しない・会員を引かない・Vertex AI を呼ばない）**。社名・個人情報があれば 400。`input.basis` = conditions / job / member / jobMember: 求人 ID・会員 ID との組み合わせが合わない・その企業の求人でない・会員が無いは 400（`details` に `input.jobId` / `input.memberId`）。求人のときはポジション名・掲載職種・勤務地を求人の値に、会員のときは `filters` を候補者の属性（年齢層・経験職種）に置き換える） | 201 `AiCreateResponse`（fire = done / sample / failed。failed の理由は fireMessage）。Vertex AI の設定が無い本番は 503 `aiConfig` | cms_ai_scout_*（分析対象）、求人・候補者のマート（`ScoutDataSource.job`・`.member`）、Vertex AI、D1 ai_jobs + ai_scout_drafts + audit_log（1 batch）、ai_scout_insights |
| PUT / DELETE /api/ai/jobs/:jobId/edited | verified + 同一オリジン | `{result}`（strict。done のジョブだけ。② で直せるのは各案の subject / body だけ = ほかは元の結果のまま保存。社名・連絡先は 400） | `AiJobDetail` | D1 ai_jobs + audit_log（② は、選ばれた案の bq_synced_at を戻す） |
| DELETE /api/ai/jobs/:jobId | verified + 同一オリジン | — | 204 | 同上（deleted_at） |
| PUT /api/ai/jobs/:jobId/scout/choice | verified + 同一オリジン | `ScoutChoiceInputSchema`（draftId = null は「どれも使わない」。選び直せる。コメントの社名・連絡先は 400。見本は 409） | `AiJobDetail` | D1 ai_scout_drafts + audit_log |
| PUT /api/ai/jobs/:jobId/scout/usage | verified + 同一オリジン | `ScoutUsageInputSchema`（選んだ案が無い・送信実績と照合済みは 409） | `AiJobDetail` | 同上 |
| GET /api/ai/scout/options | session | — | `ScoutOptionsResponse`（受け取る人の条件の選択肢。10 分キャッシュ） | cms_ai_scout_*（`ai/scout/bqDataSource.ts`） |
| GET /api/companies/:id/ai/scout/jobs/:jobId | session | :id、:jobId `^\d{1,12}$` | `ScoutJobSummary`（求人の内容を確かめる。仕事内容・応募条件は先頭 200 字。**その企業の求人でなければ 404**。Vertex AI は呼ばない。ログ `ai.scout.lookup`） | cms_company_master（企業の存在）、求人のマート（`ScoutDataSource.job`） |
| GET /api/ai/scout/members/:memberId | session | :memberId `^\d{1,12}$` | **会員 ID から作る機能が閉じている間（既定）は 403 `featureDisabled`（会員のデータを読まない）**。開いているとき: `ScoutMemberSummary`（候補者の属性と、そこから決めた絞り込み条件 `filters` = 年齢層・経験職種。無ければ 404。Vertex AI は呼ばない。**誰が・どの会員 ID を引いたかをログ `ai.scout.lookup` に残す**） | 候補者のマート（`ScoutDataSource.member`） |
| GET /api/ai/scout/models | session | — | `ScoutModelsResponse`（3 つのモデル・版ごとの成績・最後の実行。playbook・engine は管理者にだけ） | D1 ai_scout_models・ai_scout_model_versions・ai_scout_drafts・ai_scout_tune_runs |
| POST /api/ai/scout/tune | verified + 管理者 + 同一オリジン | — | `ScoutTuneResponse`（実績の取り込み → 検証 → 据え置き / チューニング / 前の版へ戻す。サンプルデータは 409、設定なしは 503） | cms_ai_scout_*、Vertex AI、D1（上の表 + audit_log） |
| POST /api/ai/scout/models/:id/rollback | verified + 管理者 + 同一オリジン | `{version}`（strict。無い版は 404、いまの版は 409） | `ScoutModelsResponse` | D1 ai_scout_models・ai_scout_model_versions + audit_log |

`/api` の外に AI 機能の入口は無い（以前の `/hook/ai/*` は 2026-11-27 に無くした。`/hook/` は未ログインで 401、ログイン済みでも 404）。週次の cron（`src/worker/index.ts` の `scheduled`。月曜 05:00 JST）が、`POST /api/ai/scout/tune` と同じ処理を実行する。詳しくは [`src/worker/ai/README.md`](../ai/README.md)。

D1 が束ねられていない環境では書き込み系は 503 `storage`、読み取り系は空を返す。

## 編集するときの入口
routes/<resource>.ts → services/ → sql/ or d1/。応答の形は `src/shared/schema/`。
