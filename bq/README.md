---
tags: [domain/company-behavior, domain/scout, domain/application, layer/engineering, type/data-mart-spec, source/bq-internal, table/cms_company_master, table/cms_company_monthly]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# bq — アプリ用データマート cms_*（BigQuery `bq-hgt.dwh`）

## 役割
Worker がリクエスト時に読む日次マート（`cms_*` 13 表）の SQL と定義。生テーブルは毎朝 1 本のスケジュールドスクリプトが 1 回ずつ走査し、**Worker は生テーブルを読まない**（各クエリ < 10 MB、上限 200 MB）。

## 依存するデータ（元テーブル）
companies / company_profiles(_all) / active_companies / active_jobs / scouts / scout_histories / member_applications / member_details / member_profile_latest / member_job_detail_views / job_publish_history / jobs_all / sf_contracts / sf_accounts / sf_opportunities / sf_users / GA4 analytics_258261950（旧CT）・analytics_553479599（新CT）。各マートの列は `marts/<table>/README.md`。

| マート | 粒度 | 更新 |
|---|---|---|
| cms_company_master | 企業 | 全件差し替え |
| cms_contract_snapshot_daily | 企業 × 日 | 追記（当日分を入れ直し） |
| cms_company_monthly | 企業 × 月（13 か月 + 当月） | 全件差し替え |
| cms_company_daily_usage | 企業 × 日（前月 + 当月） | 全件差し替え |
| cms_scout_cohort_status / cms_application_cohort_status | 企業 × コホート月 × ステータス | 全件差し替え |
| cms_status_snapshot_daily | 日 × 上 2 表 | 追記 |
| cms_scout_member_attributes_monthly | 企業 × 送信月 × 属性 | 全件差し替え |
| cms_company_login_daily / cms_company_login | 日 × 企業 / 企業 | 追記（直近 3 日取り直し）/ 全件差し替え |
| cms_industry_benchmark_monthly | 月 × 業種 × 種別 × 指標 | 全件差し替え |
| cms_dim_industry_alias | 表記ゆれ | 手動（init.sql） |
| cms_refresh_log | 実行記録 | 追記 |

## 更新スケジュール（登録済み）

| 項目 | 値 |
|---|---|
| スケジュールドクエリ名 | `cms_marts 日次更新（契約企業マネジメントシステム / 毎日JST07:45）` |
| 設定 ID | `6aee95cf-0000-22fe-be9d-d43a2ccd820f`（BigQuery Studio → スケジュールドクエリ） |
| スケジュール | 毎日 22:45 UTC（= JST 07:45。dmt_company_daily 07:30 の後） |
| SQL | `marts/scheduled_query.sql`（スクリプト。宛先テーブルなし） |
| 実行者 | `id-69-213@bq-hgt.iam.gserviceaccount.com`（既存のスケジュールドクエリと同じ） |
| 登録日 | 2026-10-23（Data Transfer API で登録） |

**SQL を変えたとき**: BigQuery Studio → スケジュールドクエリ → 上の設定 ID を開き、`marts/scheduled_query.sql` の全文に差し替えて保存する（またはスクラッチの `dts.py` 相当で `PATCH transferConfigs`）。Worker 側の `src/worker/sql/*.ts` と `src/shared/schema/*` を合わせ、`DATA_VERSION` を +1 する。

## 初回構築の記録（2026-10-23）

| 手順 | スキャン | 結果 |
|---|---|---|
| `init.sql`（追記表の作成・alias・GA4 ログイン一括取込 2026-05-15〜） | dry run 3,013 MB → 実行 3,022 MB・18 秒 | login_daily 23,174 行（旧CT 583 社）+ 70 行（新CT 37 社） |
| `scheduled_query.sql` 初回実行 | 920 MB・47 秒 | master 907（契約中 391）、monthly 12,698、daily 26,468、cohort 5,566 / 10,012、attrs 280,507、bench 12,406、login 907（記録あり 532） |
| 突合（`dmt_company_daily` 当月値） | 0.6 MB | 契約中 391 社のうち RA/RDS 2 社（本マートでは除外）以外は送信・興味あり・応募・閲覧が完全一致。掲載求人数は 29 社で ±数件（dmt の 07:30 時点と当日のジョブ更新差。同じ式で再計算すると一致） |
| データ品質 | – | SF 結合 330 / 391、既定の担当あり 330（CS 232）、業種なし 6、枠なし 13、プラン名あり 371 |

## 変更の記録

| 日付 | 変更 | スキャン | 反映 |
|---|---|---|---|
| 2026-10-23 | `cms_company_master.company_type` の `紹介（派遣含む）` を `紹介` / `派遣` に分割（`company_profiles.company_type = '派遣'` を独立）。ベンチマークの種別群も同じ値で再計算 | 手動実行 919.5 MB | スケジュールドクエリ（設定 ID 上記）を Data Transfer API の PATCH で差し替え済み。`DATA_VERSION` 2 |

## 手元での検証（claude_analysis の認証キーが必要）

```bash
cd /home/user/claude_analysis && python3 02_データエンジニアリング/scripts/fetch-bq-credentials.py   # /tmp/bq-key.json
# 構文確認（スクリプトはバイト数が出ない）
bq --location=asia-northeast1 query --use_legacy_sql=false --dry_run < bq/marts/scheduled_query.sql
# 手動実行（上限 6 GB）
bq --location=asia-northeast1 query --use_legacy_sql=false --maximum_bytes_billed=6000000000 < bq/marts/scheduled_query.sql
# 実行記録
bq query --use_legacy_sql=false 'SELECT * FROM `bq-hgt.dwh.cms_refresh_log` ORDER BY finished_at DESC LIMIT 5'
```

`bq` CLI がサンドボックスで認証できないときは REST（`jobs.query`）を直接叩く（鍵 JSON → google-auth → POST）。Worker と同じ方式。

## 失敗時
- スクリプトは `BEGIN … EXCEPTION` で `cms_refresh_log` に `error` 行を残す。Worker は前日の `dataVersion` で配信を続け、画面の左レールに「今朝の更新に失敗」と出る
- 再実行は冪等（全件差し替え / 当日分の DELETE → INSERT）。同じ日に何度実行してもよい
