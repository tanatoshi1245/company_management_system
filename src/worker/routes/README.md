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
| GET /api/ai/config | session | — | `AiConfigResponse`（発火の設定・保存先の有無、見本で動くか、書き込めるか、管理者か。真偽値だけ） | Worker の変数 |
| GET /api/ai/companies | session | — | `AiCompaniesResponse`（当月のボードに出ている企業） | ボードのマート（キャッシュ共用） |
| GET /api/ai/companies/:id/defaults | session | :id | `AiCompanyDefaultsResponse`（業界・掲載職種・直近 6 か月の求人、業界・職種の選択肢。無い企業は 404） | cms_company_master, cms_company_job_monthly |
| GET /api/ai/jobs | session | ?company=&kind=report\|scout\|job（strict） | `AiJobListResponse`（新しい順・30 件まで。結果の本体なし。D1 が無ければ空） | D1 ai_jobs |
| GET /api/ai/jobs/:jobId | session | :jobId `^[a-z0-9]{16,40}$` | `AiJobDetail`（入力・結果・直した版。期限切れの running は failed にして返す。sessionUrl は管理者だけ） | D1 ai_jobs, cms_company_master（企業名。10 分キャッシュ） |
| POST /api/companies/:id/ai/jobs | verified + 同一オリジン（サンプルデータのときだけ仮の利用者も可・保存しない） | `{kind, input}`（strict。input は kind ごとの型。社名・個人情報があれば 400） | 201 `AiCreateResponse`（fire = sent / sample / failed） | D1 ai_jobs + audit_log（1 batch）、発火（api.anthropic.com） |
| POST /api/ai/jobs/:jobId/fire | verified + 同一オリジン | — | `AiCreateResponse`（未起動・失敗のジョブだけ。それ以外は 409） | 同上 |
| PUT / DELETE /api/ai/jobs/:jobId/edited | verified + 同一オリジン | `{result}`（strict。結果と同じ型。done のジョブだけ） | `AiJobDetail` | D1 ai_jobs + audit_log |
| DELETE /api/ai/jobs/:jobId | verified + 同一オリジン | — | 204 | 同上（deleted_at） |

`/api` の外: `GET /hook/ai/jobs/:jobId/context`・`POST /hook/ai/jobs/:jobId/result`（`src/worker/ai/hook.ts`。AI 機能のセッションが使う。Google ログインの外で、ジョブごとの合言葉（`Authorization: Bearer`）を確かめる。違えば一律 401、`/hook/` のほかのパスは 404）。詳しくは [`src/worker/ai/README.md`](../ai/README.md)。

D1 が束ねられていない環境では書き込み系は 503 `storage`、読み取り系は空を返す。

## 編集するときの入口
routes/<resource>.ts → services/ → sql/ or d1/。応答の形は `src/shared/schema/`。
