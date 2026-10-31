-- =============================================================================
-- 契約企業マネジメントシステム: マート初期化（1 回だけ実行）
--   1. 追記型テーブル（履歴）を明示スキーマ・パーティションで作成
--   2. 業種の表記ゆれ対応表（cms_dim_industry_alias）、Network 申込元の一覧（cms_dim_network_partner）を作成・投入
--   3. GA4 の企業ログインを過去分まで一括取込（旧CT 2026-05-15〜、新CT 2026-10-14〜）
-- 実行: python3 scripts/bq_script.py run bq/marts/init.sql  または BigQuery Studio に貼り付け（asia-northeast1）
-- 以後の日次更新は scheduled_query.sql（毎日 22:45 UTC = 07:45 JST）
-- =============================================================================
BEGIN
  DECLARE run_date DATE DEFAULT CURRENT_DATE('Asia/Tokyo');
  -- データセット ID と取込開始日（GA4 の BigQuery リンク作成日以降しか events_* は無い）
  DECLARE ga4_sources ARRAY<STRUCT<ds STRING, from_date DATE>> DEFAULT [
    STRUCT('analytics_258261950', DATE '2026-05-15'),   -- 旧 CT 画面
    STRUCT('analytics_553479599', DATE '2026-10-14')    -- 新 CT 画面（2026-10 作成）
  ];

  -- 1. 追記型テーブル -------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS `bq-hgt.dwh.cms_refresh_log` (
    run_date DATE NOT NULL, step STRING NOT NULL, started_at TIMESTAMP, finished_at TIMESTAMP,
    status STRING NOT NULL, rows_master INT64, rows_monthly INT64, note STRING
  ) PARTITION BY run_date
  OPTIONS (description = '契約企業マネジメントシステム: マート更新スクリプトの実行記録。Worker は最新の ok 行の run_date をキャッシュキー（dataVersion）に使う');

  CREATE TABLE IF NOT EXISTS `bq-hgt.dwh.cms_contract_snapshot_daily` (
    recorded_on DATE NOT NULL, company_id INT64 NOT NULL, internal_name STRING, company_name STRING,
    active_from DATE, active_to DATE, is_contracted BOOL, contract_state STRING,
    scout_limit INT64, job_posting_limit INT64, company_type STRING, industry STRING, plan_name STRING,
    sf_contract_id STRING, sf_contract_status STRING, sf_contract_end DATE,
    sf_active_contract BOOL, sf_live_won_opp BOOL, da_active_profile BOOL,
    cs_owner_email_default STRING, cs_owner_name_default STRING, sales_staff STRING, note STRING
  ) PARTITION BY recorded_on CLUSTER BY company_id
  OPTIONS (description = '契約企業マネジメントシステム: 契約・枠数・担当の日次スナップショット（companies は最新契約しか持たないため、履歴はここで蓄積する）');

  CREATE TABLE IF NOT EXISTS `bq-hgt.dwh.cms_status_snapshot_daily` (
    recorded_on DATE NOT NULL, source STRING NOT NULL, company_id INT64 NOT NULL, cohort_month DATE, status STRING, cnt INT64
  ) PARTITION BY recorded_on CLUSTER BY company_id, source
  OPTIONS (description = '契約企業マネジメントシステム: コホート別の現ステータス件数の日次スナップショット（source = scout: 興味あり返信月、application: 応募月）。差分で状態の動きが分かる');

  CREATE TABLE IF NOT EXISTS `bq-hgt.dwh.cms_company_login_daily` (
    login_date DATE NOT NULL, company_id INT64 NOT NULL, login_events INT64, last_event_ts TIMESTAMP, source_dataset STRING, loaded_at TIMESTAMP
  ) PARTITION BY login_date CLUSTER BY company_id
  OPTIONS (description = '契約企業マネジメントシステム: 企業管理ツール（CT）へのログイン（GA4 get_ID）を日次・企業・データセットで集計');

  -- 2. 業種の表記ゆれ（01_データ分析/Salesforce_分析/.../sf_industry_alias.json と同じ内容） ---------
  CREATE TABLE IF NOT EXISTS `bq-hgt.dwh.cms_dim_industry_alias` (sf_value STRING NOT NULL, dj_industry STRING, is_ignored BOOL NOT NULL)
  OPTIONS (description = '契約企業マネジメントシステム: Salesforce 取引先の業種（industry0413__c）→ Daijob 業種名の対応。is_ignored = 情報なしとして扱う');
  MERGE `bq-hgt.dwh.cms_dim_industry_alias` t
  USING (
    SELECT * FROM UNNEST([
      STRUCT('その他IT' AS sf_value, 'その他IT関連' AS dj_industry, FALSE AS is_ignored),
      STRUCT('その他IT企業', 'その他IT関連', FALSE),
      STRUCT('インターネット・プロバイダ関連', 'インターネット・プロバイダー関連', FALSE),
      STRUCT('システムインタグレーター', 'システムインテグレーター', FALSE),
      STRUCT('システムインテグレータ', 'システムインテグレーター', FALSE),
      STRUCT('人材派遣', '派遣会社', FALSE),
      STRUCT('販売代理店', '商社・卸', FALSE),
      STRUCT('未分類', CAST(NULL AS STRING), TRUE)
    ])
  ) s ON t.sf_value = s.sf_value
  WHEN NOT MATCHED THEN INSERT (sf_value, dj_industry, is_ignored) VALUES (s.sf_value, s.dj_industry, s.is_ignored);

  -- 2b. Network 契約の申込元（働くDB の【0円】申込の customer_name がこの会社 = Network 経由の契約。2026-10-30） --------
  --   Network = 海外の求人サイト（Totaljobs / StepStone 等）が顧客企業の求人を Daijob に載せる契約。申込の customer_name が
  --   サイト運営会社、publishing_company_name が実際の掲載企業になる。商品名は通常の Daijob Single Job Posting と同じため、サービス名だけでは判定できない
  CREATE TABLE IF NOT EXISTS `bq-hgt.dwh.cms_dim_network_partner` (customer_name STRING NOT NULL, note STRING)
  OPTIONS (description = '契約企業マネジメントシステム: Network 契約の申込元（htdb_applications_wo_FEE.customer_name）。この会社が申込元の0円申込がある企業はマートから除外する。追加は手動（INSERT）');
  MERGE `bq-hgt.dwh.cms_dim_network_partner` t
  USING (
    SELECT * FROM UNNEST([
      STRUCT('Totaljobs Group Ltd.' AS customer_name, '英国。サービス名 Daijob.com（Network）の申込もここ' AS note),
      STRUCT('StepStone Deutschland GmbH', 'ドイツ'),
      STRUCT('StepStone Denmark', 'デンマーク（最終契約 2023-09）'),
      STRUCT('Appcast, Inc.', '米国'),
      STRUCT('Figaro Classifieds', 'フランス'),
      STRUCT('IrishJobs.ie', 'アイルランド'),
      STRUCT('Nexxt, Inc', '米国（最終契約 2021-03）'),
      STRUCT('Network eG.', 'ドイツ（最終契約 2024-08）')
    ])
  ) s ON t.customer_name = s.customer_name
  WHEN NOT MATCHED THEN INSERT (customer_name, note) VALUES (s.customer_name, s.note);

  -- 3. GA4 ログインの一括取込（既に入っている日は取り直す） -------------------------------------
  --   社内メンバー（company_users.email が @daijob.com。GA4 user_id = company_users.id）のログインは数えない（2026-10-31）。
  --   scheduled_query.sql のステップ 10 と同じ条件。user_id なし・company_users に無い user_id（削除済みアカウント）は数える
  CREATE TEMP TABLE internal_ct_users AS
  SELECT DISTINCT CAST(id AS STRING) AS user_id
  FROM `bq-hgt.dwh.company_users`
  WHERE id IS NOT NULL AND LOWER(email) LIKE '%@daijob.com' AND NOT STARTS_WITH(LOWER(email), 'staging+');

  FOR src IN (SELECT ds, from_date FROM UNNEST(ga4_sources)) DO
    EXECUTE IMMEDIATE FORMAT("""
      DELETE FROM `bq-hgt.dwh.cms_company_login_daily` WHERE source_dataset = '%s' AND login_date >= DATE '%t'
    """, src.ds, src.from_date);
    EXECUTE IMMEDIATE FORMAT("""
      INSERT INTO `bq-hgt.dwh.cms_company_login_daily` (login_date, company_id, login_events, last_event_ts, source_dataset, loaded_at)
      SELECT DATE(TIMESTAMP_MICROS(event_timestamp), 'Asia/Tokyo') AS login_date,
             COALESCE((SELECT ep.value.int_value FROM UNNEST(event_params) ep WHERE ep.key = 'company_id'),
                      SAFE_CAST((SELECT ep.value.string_value FROM UNNEST(event_params) ep WHERE ep.key = 'company_id') AS INT64)) AS company_id,
             COUNT(*) AS login_events,
             MAX(TIMESTAMP_MICROS(event_timestamp)) AS last_event_ts,
             '%s' AS source_dataset, CURRENT_TIMESTAMP() AS loaded_at
      FROM `bq-hgt.%s.events_*`
      WHERE _TABLE_SUFFIX BETWEEN '%s' AND '%s'
        AND event_name = 'get_ID'
        AND (user_id IS NULL OR user_id NOT IN (SELECT user_id FROM internal_ct_users))
      GROUP BY 1, 2
      HAVING company_id IS NOT NULL
    """, src.ds, src.ds, FORMAT_DATE('%Y%m%d', src.from_date), FORMAT_DATE('%Y%m%d', run_date));
  END FOR;
END;
