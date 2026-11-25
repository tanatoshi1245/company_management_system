---
tags: [domain/company-behavior, layer/application, type/app-spec]
related:
  - "[[src/worker/ai/README]]"
  - "[[docs/AI機能]]"
  - "[[docs/指標定義]]"
status: active
---

# worker/ai/report — ① AI 分析とレポート生成（数値の収集と見本）

## 役割
- `collect.ts` … セッションへ渡す数値を、企業ページと同じサービスから集めて 1 つの JSON にまとめる（`collectReportData`）。新しい SQL は書かない。80KB を超えるときは、求人・属性・ベンチマークの明細から順に削る（月次と合計は削らない）。**企業名・担当者名は入れない**
- `sample.ts` … サンプルデータのときに返す見本（すべての layout を 1 枚ずつ。数値は固定の見本）

## 依存するデータ（JSON の項目 → 画面の要素 → 元の API → マートの列）
| JSON の項目 | 意味 | 企業ページの要素 | 元の API（サービス） | マートの列 |
|---|---|---|---|---|
| `company.industry`・`companyType`・`plan`・`contractKind`・`contractState`・`contract`・`limits`・`accountTypes` | 企業の条件（業界・企業種別・プラン・契約期間・スカウト枠 / 求人枠） | 企業の見出し・契約 | `GET /api/companies/:id`（`loadCompanyCore`） | `cms_company_master`（industry, company_type, plan_name, dj_contract_type, contract_state, active_from / active_to, scout_limit, job_posting_limit, account_types） |
| `company.activeJobsNow`・`company.login` | いまの掲載求人数、最終ログインからの日数・30 日 / 90 日のログイン日数 | 企業の見出し | 同上 | `cms_company_master.active_jobs_now`、`cms_company_login` |
| `monthly[].sent`・`sentManual`・`sentAuto` | スカウト送信（手動 / 自動は全体だけ） | スカウトの実績 | 同上（`monthly` / 種別は `accountMonthly`） | `cms_company_monthly.scout_sent`, `scout_sent_manual`, `scout_sent_auto` |
| `monthly[].interested` | 興味あり（送信月で数える。全体だけ） | スカウトの実績 | 同上 | `cms_company_monthly.interested_by_send_month` |
| `monthly[].interestedReply` | 興味あり返信（返信月で数える） | スカウトの実績 | 同上 | `cms_company_monthly.interested_by_reply_month` |
| `monthly[].replyRatePct` | 興味あり返信率（%）。全体 = `interested ÷ sent`（指標定義の `reply_rate`）、アカウント種別 = `interestedReply ÷ sent` | スカウトの実績 | Worker で計算 | 上の 2 列 ÷ `scout_sent` |
| `monthly[].views`・`apps`・`applyRatePct` | 求人閲覧・応募・閲覧 → 応募の率（% = apps ÷ views） | 求人の実績 | 同上 | `cms_company_monthly.job_views`, `applications` |
| `monthly[].jobs`・`newJobs` | 月末の掲載求人数・新規掲載（新規は全体だけ） | 求人の実績 | 同上 | `cms_company_monthly.active_jobs_eom`, `new_jobs` |
| `monthly[].hires`・`hiresApp`・`hiresScout`・`inSelection` | 採用（全体）・応募経由 / スカウト経由の採用・選考中 | 選考状況 | 同上 | `cms_company_monthly.hires`, `hires_from_application`, `hires_from_scout`, `in_selection` |
| `monthly[].loginDays` | ログイン日数（全体だけ） | 利用状況 | 同上 | `cms_company_monthly.login_days` |
| `totals`・`previous.totals` | 期間の合計と、直前の同じ長さの期間の合計（マートの窓の中にあるときだけ） | 期間の合計 | Worker で計算 | 上の列の合計 |
| `benchmarks[]` | 業界ベンチマーク（月 × 指標。企業数が `BENCH_MIN_N` 以上の、最も近い群を 1 つ） | 業界との比較 | 同上（`benchSeries`） | `cms_industry_benchmark_monthly`（metric, n_companies, median, p25, p75） |
| `attributes.{scout,view,application}` | 会員属性の上位 5（属性タイプ別。scout = スカウトを送った会員、view = 閲覧した会員、application = 応募した会員） | 会員属性の円グラフ | `GET /api/companies/:id/attributes`（`loadAttributes`） | `cms_scout_member_attributes_monthly`（kind, attribute_type, attribute_value, scouts, interested_scouts） |
| `jobs.rows[]` | 求人ごとの実績（閲覧の多い順・上位 15。タイトル・条件・閲覧・応募・応募経由の採用・Hot Job の有無） | 求人の表 | `GET /api/companies/:id/jobs`（`loadJobs`） | `cms_company_job_monthly` |
| `selection[]` | 選考状況（面接調整中 → 採用。期間の月のステータス別件数の合計） | 選考状況のカード | `GET /api/companies/:id`（`monthly[].st` / `accountMonthly[].st`） | `cms_company_monthly.st06_…`〜`st11_hired` |
| `cohorts` | スカウト・応募のいまのステータス（期間の月に送信・応募した分。全体だけ） | 送信月別 / 応募月別の状況 | 同上（`cohorts`） | `cms_scout_cohort_status`, `cms_application_cohort_status` |
| `scoutUnused[]` | スカウト未利用の記録（期間の月） | スカウト未利用の記録 | 同上 + D1 | `cms_company_master.scout_unused_json` + D1 `scout_unused_entries` |
| `notes[]` | 数値の読み方の注意（当月は途中の値、アカウント種別で出せない項目 など） | — | — | — |

アカウント種別（`input.account`）を選ぶと、月次・合計・属性・求人・選考状況はその種別の値になる。ログイン日数・新規掲載・手動 / 自動の内訳・`interested`・`hires`・ベンチマークは企業全体でしか出せない（`null`、ベンチマークは企業全体の値のまま）。

## 編集の入口
項目を足すときは `collect.ts` の `ReportData` と、この表、`ai/report/` のセッションの手順。式を変えるときは [docs/指標定義.md](../../../../docs/指標定義.md) と合わせる。

## テスト
`tests/worker/aiHook.test.ts`（context の `company.data`・企業名が入らないこと・大きさ）
