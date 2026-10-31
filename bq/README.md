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
companies / company_profiles_full / company_profiles_all / active_companies / active_jobs / scouts / scout_histories / member_applications / member_details / member_profile_latest / member_job_detail_views / job_publish_history / jobs_all / sf_contracts / sf_accounts / sf_opportunities / sf_users / company_users（CT ログインの社内メンバー `@daijob.com` の判定）/ htdb_applications_wo_FEE（働くDB の【0円】申込。Network 契約の判定）/ GA4 analytics_258261950（旧CT）・analytics_553479599（新CT）。各マートの列は `marts/<table>/README.md`。

| マート | 粒度 | 更新 |
|---|---|---|
| cms_company_master | 企業 | 全件差し替え |
| cms_contract_snapshot_daily | 企業 × 日 | 追記（当日分を入れ直し） |
| cms_company_monthly | 企業 × 月（13 か月 + 当月） | 全件差し替え |
| cms_company_daily_usage | 企業 × 日（前月 + 当月） | 全件差し替え |
| cms_scout_cohort_status / cms_application_cohort_status | 企業 × コホート月 × ステータス | 全件差し替え |
| cms_status_snapshot_daily | 日 × 上 2 表 | 追記 |
| cms_scout_member_attributes_monthly | 企業 × 送信月 × kind × アカウント種別 × 求人 × 属性 | 全件差し替え |
| cms_company_job_monthly | 企業 × アカウント種別 × 求人 × 月（閲覧・応募） | 全件差し替え（2026-10-30〜） |
| cms_company_login_daily / cms_company_login | 日 × 企業 / 企業 | 追記（直近 3 日取り直し）/ 全件差し替え |
| cms_industry_benchmark_monthly | 月 × 業種 × 種別 × 指標 | 全件差し替え |
| cms_dim_industry_alias | 表記ゆれ | 手動（init.sql） |
| cms_dim_network_partner | Network 契約の申込元 | 手動（init.sql。2026-10-30〜） |
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
| 2026-10-31 | **CT ログインから社内メンバー（`company_users.email` が `@daijob.com`）のログインを除外**（ステップ 10・`init.sql` ステップ 3）。CS が自分のアカウントで企業の画面に入ると企業の最終ログインが更新されるため。GA4 `get_ID` の `user_id` = `company_users.id`（旧 CT 全期間で `company_id` の不一致 0 件）。`user_id` なし（約 3%）・`company_users` に無い `user_id`（削除済み。約 1.4%）は判定できないので数える。`staging+…` のマスク値は社内扱いにしない。除外対象 2,489 ユーザー。ログインのある企業 588 → 478 社（社内ログインのみだった 110 社が記録なしに）、`cms_company_login_daily` 24,160 → 19,523 行、ログイン 1,495,417 → 1,202,073 件、最終ログインが変わった企業 170 社（master 結合で RPO 59・直接 48・DA 44・NW 2）。契約中のアクティブ企業数（30 日以内）は DA / RPO 51 → 9、既定の表示対象 206 → 204。`DATA_VERSION` 22。事前バックアップ `cms_company_login_daily_bak_20261031` / `cms_company_login_bak_20261031` | 事前検証（temp 表へ全期間）約 3 GB。手動実行（`login_backfill_days` を 200 にした一時版で全期間を取り直し）+ 通常版の再実行で各 1 分 30 秒前後 | 設定 `6aee95cf-…` に反映済み（登録 SQL = リポジトリの `scheduled_query.sql` と一致を確認）・手動実行 ok。**`@athuman.com` など他の社内ドメインは未除外** |
| 2026-10-31 | `cms_company_monthly` に **`jobs_in_month`**（月内に 1 日でも掲載期間が重なった求人数。`job_month` / `job_month_acct` で `active_jobs_eom` と並べて集計）。スカウト未利用の登録画面の対象を「前月に掲載あり・前月の送信 0・今日時点で契約中・DA / RPO / NW 以外」に変更（枠数で絞らない。契約終了で枠が 0 に戻り過去月の企業が落ちていた）。`DATA_VERSION` 20 → 21（#38 と同日のため） | 手動実行 1,695 MB | 設定 `6aee95cf-…` に反映済み・手動実行 ok（`jobs_in_month < active_jobs_eom` の行 0、`__ALL__` 12,362 行、2026-09 分の対象 58 社・2026-10 分 69 社、`scout_unused_companies_monthly` 2,711 行は不変） |
| 2026-10-30 | **Network 契約の除外の判定元を変更**。旧: `dm_network_contract_candidates`（SF の件名「NetworkWW」の行動 = 接触履歴。「3 ヶ月アプローチ不可」のメモで契約の有無を表さず、10 社中 3 社（ハーティング・ハリバートン・ネオヴィア）が Network 契約でないのに除外、逆に Network 契約の約 20 社が除外されていなかった）。新: 働くDB の【0円】申込 `htdb_applications_wo_FEE` の `customer_name`（申込元）が新設 `cms_dim_network_partner`（Totaljobs / StepStone / Appcast / Figaro / IrishJobs / Nexxt / Network eG）、またはサービス名に Network を含む申込の `publishing_company_name` を、`companies.internal_name`・`company_profiles_full` の企業名で突き合わせ、申込期間が契約期間に重なる企業をステップ 01b（`network_companies`）で除外。実行記録の `note` に `network_excluded`（除外社数）・`network_unmatched`（社名が結べなかった有効な Network 申込）・`htdb_loaded_at` を残し、働くDB 申込テーブルが 48 時間以上更新されていなければ WARN。master 881 → 863 社（契約中 364 → 356。ハーティング・ネオヴィアが契約中に戻り、Totaljobs 等の Network 契約 10 社が外れる）。事前バックアップ `cms_company_master_bak_20261030` / `cms_company_monthly_bak_20261030` / `cms_industry_benchmark_monthly_bak_20261030` | 手動実行 1.1 GB 程度（1 分 35 秒）。単体検証（新ステップのみ）は数 MB | スケジュールドクエリを PATCH で差し替え済み、転送ランの手動起動でも成功確認。`DATA_VERSION` 20 |
| 2026-10-30 | **障害対応**: 属性マートが約 500 MB になり、Worker の属性照会が「推定スキャン量 > maximumBytesBilled 200 MB」で拒否され、企業ページの円グラフが出なくなった（実際の読み取りは 35 MB）。`memberAttributesQuery` だけ上限を 2 GB に（`BuiltQuery.maxBytes`）。パーティション変更は `CREATE OR REPLACE` でできず、DROP は表の IAM を消すので見送り | — | Worker 側のみ（PR #34） |
| 2026-10-30 | **求人単位の軸を追加**。新表 `cms_company_job_monthly`（企業 × 種別 × 求人 × 月。タイトル・閲覧・応募・応募側の現ステータス st06〜st11・掲載期間。`(direct)` = 企業への直接応募）、`cms_scout_member_attributes_monthly` に `job_key`（view / application の行だけ。scout は NULL）。`jobs_all` は `jobs_latest` で 1 回だけ読み（`job_set` / `job_title`）、`jph` / `view_raw` / `app_fact` で共用。企業ページの「求人ごとの実績」の表と求人フィルタ用。**Worker 用 SA に新表の dataViewer 付与が要る**（README 作業 8）。`DATA_VERSION` 18 → 19 | 手動実行 1,694 MB | 設定 `6aee95cf-…` に反映済み・手動実行 ok（求人行 69,194・求人 22,169 件・直接応募の行 575・タイトル無し 36 行。企業 × 種別 × 月の閲覧・応募が `cms_company_monthly` の種別行と一致（差 0）。属性マート 4,310,184 行（90 万 → 430 万）。所要 約 9 分） |
| 2026-10-30 | **アカウント種別（`account_type` = プロファイルの 直接 / 紹介 / 派遣）の軸を追加**。`pcm` に `account_type`、`cms_company_master` に `account_types`（例 `直接,紹介`）/ `accounts_json`（プロファイル一覧）/ `jobs_json`（窓に掛かる求人の一覧。企業ページが任意の期間で重複排除して数える）、`cms_company_monthly` に `account_type` 列（`'__ALL__'` = 企業全体 + 種別ごとの行。全体だけ読むクエリは `WHERE account_type = '__ALL__'`）、`cms_scout_member_attributes_monthly` に `account_type` と `kind = 'application'`（応募した会員）。`view_raw` で `member_job_detail_views` を 1 回だけ読む。同じ会員が 2 種別で採用なら種別の行には両方に 1 ずつ（全体は 1）。Worker の属性照会は期間・種別で集約する形に変更（`DATA_VERSION` 17 → 18） | 手動実行 1,132 MB | 設定 `6aee95cf-…` に反映済み・手動実行 ok（`__ALL__` 12,334 行 + 直接 10,332 / 紹介 2,100 / 派遣 168 行。種別の合計 = 全体を送信・応募・閲覧・返信・選考中で確認、差 0。`jobs_json` 最大 161 KB） |
| 2026-10-29 | 企業情報の元を `company_profiles`（差分・求人掲載のあるプロファイルのみ）から **`company_profiles_full`（全プロファイル・日次全件洗い替え）** に変更（`pcm` / RA・RDS 除外 / `latest_profiles`）。求人未掲載の契約企業（A-Gold・FP GLOBAL・サイエンテックス等）の企業種別が「不明」になっていた問題を解消。1 企業に複数プロファイルがあり掲載数・日付が同点のときは `profile_id` 最小の行を採用（全件表は `recorded_on` が同一のため順序を固定） | 手動実行 920 MB 級 | 設定 `6aee95cf-…` に反映済み・手動実行 ok（master 880 行のまま、`company_type = '不明'` 12 → 0、契約中 5 → 0）。変更前の `cms_company_master` は `cms_company_master_bak_20261029` に保存 |
| 2026-10-27 | `cms_scout_member_attributes_monthly` に `kind`（scout / view）を追加し、求人を閲覧した会員の属性（`member_job_detail_views` × 会員属性）も同じ表に入れる（企業ページ「誰が求人を見ているか」）。`cms_company_master` に `jobs_window_distinct`（窓に掲載期間が重なる求人数。set_id 重複排除） | 手動実行 1,029 MB | スケジュールドクエリを PATCH で差し替え済み。`DATA_VERSION` 16 |
| 2026-10-27 | GA4 ログインの取り込みに速報表 `events_intraday_*`（前日分まで）を追加。確定表 `events_YYYYMMDD` は翌朝 09〜10 時台に作られ 07:45 の実行では前日分が無かったため。同じ (日, 企業) は確定表を優先、直近 3 日の取り直しはそのまま。速報表が無いデータセットは `INFORMATION_SCHEMA.TABLES` で確認して飛ばす | 手動実行（下記） | スケジュールドクエリを PATCH で差し替え済み。`DATA_VERSION` 15 |
| 2026-10-23 | 枠数（`scout_limit` / `job_posting_limit`）はどこにも値が無ければ 0 に（Equinix のように `companies` 側も NULL の企業）。NW 判定はプロファイルが無い企業（種別 不明）も対象に。ボードの照会（Worker）は NW を除く | 手動実行（下記） | スケジュールドクエリを PATCH で差し替え済み。`DATA_VERSION` 13 |
| 2026-10-23 | 企業種別に `NW`（Network 契約）を追加: 直接 で企業名に DaijobAgent を含まず、求人枠 0 かつ掲載 0、スカウト枠 0 かつ当月送信 0（`scouts` の当月分 26 MB を追加で読む）。契約中 7 社が該当 | 手動実行（下記） | スケジュールドクエリを PATCH で差し替え済み。`DATA_VERSION` 12 |
| 2026-10-23 | アプリの登録ページは既存の `scout_unused_companies_monthly` に `match_method = 'app'` の行を MERGE で書く（アプリ専用表 `cms_scout_unused_app` は同日中に廃止・削除）。`scout_unused_json` は同じ企業・月についてアプリの行を優先し、要素に `source`（app / sheet）を追加 | 手動実行 919.9 MB | スケジュールドクエリを PATCH で差し替え済み。`DATA_VERSION` 11 |
| 2026-10-23 | `cms_company_master` に `scout_unused_json`（`scout_unused_companies_monthly` の契約期間中の記録を JSON 配列で。(月, 理由, 補足) で重複排除）を追加。企業ページの「スカウト未利用状況」用 | 手動実行 919.9 MB | スケジュールドクエリを PATCH で差し替え済み。`DATA_VERSION` 10 |
| 2026-10-23 | 社内用テストアカウント 7196（Daijob Resume Search (Potential Non-Japanese Scouting Service)）を追加で除外 | 手動実行（下記） | スケジュールドクエリを PATCH で差し替え済み。`DATA_VERSION` 9 |
| 2026-10-23 | 社内用テストアカウント 7277（Daijob Resume Search (Working Abroad Scout)）を追加で除外 | 手動実行（下記） | スケジュールドクエリを PATCH で差し替え済み。`DATA_VERSION` 8 |
| 2026-10-23 | 社内用テストアカウント（5542 Daijob.com、8980 レジュメ更新自動リクエスト専用）を `companies_now` で除外。企業名に DaijobAGENT を含む企業は `company_type` を DA、CS 担当（`cs_owner_name_default`）を `DA`（メール NULL）に固定 | 手動実行（下記） | スケジュールドクエリを PATCH で差し替え済み。`DATA_VERSION` 7 |
| 2026-10-23 | 枠数（`scout_limit` / `job_posting_limit`）を `companies` の企業単位の値優先に変更（それまではプロファイル単位の MAX だけで、プロファイルが無い契約中 11 社が NULL、プロファイル側 0 の 8 社が 0 だった）。`dm_network_contract_candidates` の更新（`company_id` 付き 196 件）も同じ実行で反映 | 手動実行（下記） | スケジュールドクエリを PATCH で差し替え済み。`DATA_VERSION` 6 |
| 2026-10-23 | Network 契約（別管理）の企業を `companies_now` で除外（`dm_network_contract_candidates` の `company_id`（NULL 以外）に載る企業。契約中 5 社が対象外に） | 手動実行（下記） | スケジュールドクエリを PATCH で差し替え済み。`DATA_VERSION` 5 |
| 2026-10-23 | CS 担当の既定（`owner_source`）を `sf_account_owner` → `sales_staff`（企業管理ツール `active_companies.sales_staff`）に変更。メールは「名の頭文字-姓@daijob.com」の規則で導出（主要 CS 9 名は `sf_users` のメールと一致を確認） | 手動実行（下記） | スケジュールドクエリを PATCH で差し替え済み。`DATA_VERSION` 4 |
| 2026-10-23 | `companies` から `contract_from` / `contract_to` 列が消えた（ETL のスキーマ変更。同日 09:14 UTC の手動実行で `Unrecognized name: contract_from`）ため、`companies_now` で `CAST(NULL AS DATE)` に置換。マートの列 `contract_from` / `contract_to` は NULL になる（画面の SF 契約期間の表示には影響なし） | – | 同上 |
| 2026-10-23 | `companies.publishing_sites` に `WAWW` を含む企業を `companies_now` で除外（ボード・企業詳細・KPI・ベンチマーク母集団すべてから外れる） | 手動実行（下記） | スケジュールドクエリを PATCH で差し替え済み。`DATA_VERSION` 3 |
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
