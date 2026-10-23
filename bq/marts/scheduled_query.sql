-- =============================================================================
-- 契約企業マネジメントシステム: 日次マート更新（1 本のスクリプト）
--   スケジュール: 毎日 22:45 UTC（= JST 07:45。Aurora→BQ 05:00〜06:30、dmt_company_daily 07:30 の後）
--   宛先テーブル: なし（スクリプト内で CREATE OR REPLACE / DELETE→INSERT）
--   サービスアカウント: dwh の dataEditor + bigquery.jobUser
--   スキャン: 約 1.1 GB/日。失敗時は EXCEPTION で cms_refresh_log に error 行を残し、前日のマートがそのまま残る
--   設計: company_management_system/bq/README.md、列定義: bq/marts/<table>/README.md
-- 変更時の注意: Worker 側の読み取り SQL（src/worker/sql/*.ts）と zod スキーマ（src/shared/schema/*）を合わせ、DATA_VERSION を +1 する
-- =============================================================================
BEGIN
  DECLARE run_date DATE DEFAULT CURRENT_DATE('Asia/Tokyo');
  DECLARE data_date DATE DEFAULT DATE_SUB(CURRENT_DATE('Asia/Tokyo'), INTERVAL 1 DAY);
  DECLARE cur_month DATE DEFAULT DATE_TRUNC(CURRENT_DATE('Asia/Tokyo'), MONTH);
  DECLARE prev_month DATE DEFAULT DATE_SUB(DATE_TRUNC(CURRENT_DATE('Asia/Tokyo'), MONTH), INTERVAL 1 MONTH);
  DECLARE window_start DATE DEFAULT DATE_SUB(DATE_TRUNC(CURRENT_DATE('Asia/Tokyo'), MONTH), INTERVAL 13 MONTH);  -- 13 か月 + 当月
  DECLARE fact_start DATE DEFAULT DATE_SUB(DATE_TRUNC(CURRENT_DATE('Asia/Tokyo'), MONTH), INTERVAL 25 MONTH);    -- 契約累計スカウト用
  DECLARE owner_source STRING DEFAULT 'sales_staff';   -- 'sales_staff'（企業管理ツール active_companies.sales_staff。2026-10-23〜） | 'sf_account_owner' | 'sf_contract_owner'（Worker の OWNER_SOURCE と合わせる）
  DECLARE scout_limit_period STRING DEFAULT 'month';         -- スカウト枠の既定の期間（企業ごとの切替は D1 company_settings）
  DECLARE ga4_datasets ARRAY<STRING> DEFAULT ['analytics_258261950', 'analytics_553479599'];  -- 旧CT / 新CT
  DECLARE login_backfill_days INT64 DEFAULT 3;               -- GA4 は 1〜2 日遅れて届くので直近 3 日を取り直す
  DECLARE t0 TIMESTAMP DEFAULT CURRENT_TIMESTAMP();

  BEGIN
    -- 01. profile → company（RA 4928 / 14508・RDS 7080 は契約企業ではないので除外） ------------------------
    CREATE TEMP TABLE pcm AS
    SELECT DISTINCT profile_id, company_id
    FROM `bq-hgt.dwh.company_profiles`
    WHERE profile_id IS NOT NULL AND company_id IS NOT NULL AND profile_id NOT IN (4928, 14508, 7080);

    -- 02. company_base: 対象企業 + 企業情報 + 枠数 + Salesforce 結合 + 担当 + 業種 -------------------------
    --   対象: companies の契約期間（active_from / active_to）が「13 か月前〜今日 + 30 日」に重なる企業
    --   （契約中 + 直近に終了 + 開始間近。ベンチマークの母集団のため過去月の契約企業も持つ）
    CREATE TEMP TABLE company_base AS
    WITH companies_now AS (
      -- companies.contract_from / contract_to は 2026-10-23 のリロードで列が無くなった（ETL のスキーマ変更）。下流の列は残して NULL にする
      SELECT id AS company_id, internal_name, active_from, active_to, CAST(NULL AS DATE) AS contract_from, CAST(NULL AS DATE) AS contract_to,
             (active_from <= run_date AND run_date <= COALESCE(active_to, DATE '9999-12-31')) AS is_contracted_now,
             CASE
               WHEN active_from <= run_date AND run_date <= COALESCE(active_to, DATE '9999-12-31')
                    AND active_to IS NOT NULL AND DATE_DIFF(active_to, run_date, DAY) <= 30 THEN 'ending_30d'
               WHEN active_from <= run_date AND run_date <= COALESCE(active_to, DATE '9999-12-31') THEN 'active'
               WHEN active_to < run_date AND DATE_DIFF(run_date, active_to, DAY) <= 90 THEN 'ended_recent'
               WHEN active_to < run_date THEN 'ended'
               WHEN active_from > run_date THEN 'upcoming'
             END AS contract_state
      FROM `bq-hgt.dwh.companies`
      WHERE active_from IS NOT NULL
        -- 掲載サイトに WAWW を含む企業はダッシュボードの対象外（表示も集計もしない。2026-10-23）
        AND NOT REGEXP_CONTAINS(UPPER(IFNULL(publishing_sites, '')), 'WAWW')
        -- Network 契約（別管理）の企業はダッシュボードの対象外（dm_network_contract_candidates に company_id があるもの。2026-10-23）
        AND id NOT IN (SELECT company_id FROM `bq-hgt.dwh.dm_network_contract_candidates` WHERE company_id IS NOT NULL)
        AND active_from <= DATE_ADD(run_date, INTERVAL 30 DAY)
        AND COALESCE(active_to, DATE '9999-12-31') >= window_start
        -- RA（4928 / 14508）・RDS（7080）の企業は契約企業として扱わない（CLAUDE.md §3）
        AND id NOT IN (SELECT DISTINCT company_id FROM `bq-hgt.dwh.company_profiles` WHERE profile_id IN (4928, 14508, 7080) AND company_id IS NOT NULL)
    ),
    latest_profiles AS (
      SELECT * FROM `bq-hgt.dwh.company_profiles`
      QUALIFY ROW_NUMBER() OVER (PARTITION BY profile_id ORDER BY recorded_on DESC NULLS LAST) = 1
    ),
    profile_job_counts AS (
      SELECT profile_id, COUNT(DISTINCT COALESCE(set_id, job_id)) AS n FROM `bq-hgt.dwh.active_jobs` GROUP BY 1
    ),
    -- 企業情報（主プロファイル = 掲載求人が最多、同数なら最新のスナップショット）
    company_info AS (
      SELECT p.company_id,
             ARRAY_AGG(p.company_name IGNORE NULLS ORDER BY IFNULL(j.n, 0) DESC, p.recorded_on DESC LIMIT 1)[SAFE_OFFSET(0)] AS company_name,
             ARRAY_AGG(p.profile_id ORDER BY p.profile_id) AS profile_ids,
             COUNT(*) AS profile_count,
             CASE
               WHEN LOGICAL_OR(REGEXP_CONTAINS(LOWER(NORMALIZE(IFNULL(p.company_name, '') || IFNULL(p.profile_name, ''), NFKC)), r'daijob\s*agent')) THEN 'DA'
               WHEN LOGICAL_OR(p.rpo_contract = TRUE) THEN 'RPO'
               WHEN ARRAY_AGG(p.company_type ORDER BY IFNULL(j.n, 0) DESC, p.recorded_on DESC LIMIT 1)[SAFE_OFFSET(0)] = '直接' THEN '直接'
               WHEN ARRAY_AGG(p.company_type ORDER BY IFNULL(j.n, 0) DESC, p.recorded_on DESC LIMIT 1)[SAFE_OFFSET(0)] = '派遣' THEN '派遣'
               ELSE '紹介'
             END AS company_type,
             ARRAY_AGG(NULLIF(p.contract_type, '登録なし') IGNORE NULLS ORDER BY IFNULL(j.n, 0) DESC, p.recorded_on DESC LIMIT 1)[SAFE_OFFSET(0)] AS dj_contract_type,
             ARRAY_AGG(NULLIF(NULLIF(TRIM(p.industry), ''), '(未選択)') IGNORE NULLS ORDER BY IFNULL(j.n, 0) DESC, p.recorded_on DESC LIMIT 1)[SAFE_OFFSET(0)] AS dj_industry,
             MAX(p.resume_bank_scout_limit) AS scout_limit_profiles,
             MAX(p.job_postiong_limit) AS job_limit_profiles
      FROM latest_profiles p
      JOIN pcm USING (profile_id)
      LEFT JOIN profile_job_counts j USING (profile_id)
      GROUP BY p.company_id
    ),
    -- 枠数の予備（company_profiles_all）。SUM はしない（複数プロファイルに同じ値が載るため MAX）
    limits_all AS (
      SELECT pcm.company_id, MAX(cpa.resume_bank_scout_limit) AS scout_limit, MAX(cpa.job_postiong_limit) AS job_limit
      FROM `bq-hgt.dwh.company_profiles_all` cpa JOIN pcm USING (profile_id)
      GROUP BY 1
    ),
    -- 当日の掲載求人（企業単位で set_id 重複排除。日英プロファイルにまたがる）
    active_jobs_company AS (
      SELECT pcm.company_id, COUNT(DISTINCT COALESCE(a.set_id, a.job_id)) AS n
      FROM `bq-hgt.dwh.active_jobs` a JOIN pcm USING (profile_id)
      GROUP BY 1
    ),
    -- Salesforce 契約（Id で最新・削除除外・DJ の企業 ID で結合）
    sf_contracts_latest AS (
      SELECT Id, AccountId, OwnerId, Status, StartDate, ContractTerm, ServiceName__c, ContractKind__c, LastModifiedDate,
             IF(EndDate IS NULL AND EndDate2__c IS NULL, NULL,
                GREATEST(IFNULL(EndDate, DATE '1900-01-01'), IFNULL(EndDate2__c, DATE '1900-01-01'))) AS end_date,
             CAST(DJ_company_id__c AS INT64) AS company_id
      FROM `bq-hgt.dwh.sf_contracts`
      WHERE DJ_company_id__c IS NOT NULL AND IFNULL(IsDeleted, FALSE) = FALSE
      QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY LastModifiedDate DESC) = 1
    ),
    -- 代表契約: 有効かつ期間内 → 有効 → 開始日が新しい
    sf_contract_pick AS (
      SELECT * FROM sf_contracts_latest
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY company_id
        ORDER BY (Status = '有効' AND (end_date IS NULL OR end_date >= run_date)) DESC, (Status = '有効') DESC, StartDate DESC NULLS LAST, LastModifiedDate DESC
      ) = 1
    ),
    sf_signal1 AS (
      SELECT company_id, LOGICAL_OR(Status = '有効' AND (end_date IS NULL OR end_date >= run_date)) AS sf_active_contract
      FROM sf_contracts_latest GROUP BY 1
    ),
    sf_accounts_of_company AS (
      SELECT company_id, ARRAY_AGG(DISTINCT AccountId IGNORE NULLS) AS account_ids FROM sf_contracts_latest GROUP BY 1
    ),
    sf_opps AS (
      SELECT AccountId, CloseDate, ServiceName__c,
             SAFE_CAST(REGEXP_EXTRACT(NORMALIZE(IFNULL(Term_ABCs__c, ''), NFKC), r'(\d+)') AS INT64) AS term_months
      FROM `bq-hgt.dwh.sf_opportunities`
      WHERE StageName = '商談成立' AND CloseDate IS NOT NULL AND IFNULL(IsDeleted, FALSE) = FALSE
      QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY LastModifiedDate DESC) = 1
    ),
    -- シグナル 2: 成立商談の CloseDate + 契約月数（Term_ABCs__c を 1〜120 にクランプ、空は 12）が今日以降
    sf_signal2 AS (
      SELECT c.company_id,
             LOGICAL_OR(DATE_ADD(o.CloseDate, INTERVAL LEAST(GREATEST(IFNULL(o.term_months, 12), 1), 120) MONTH) >= run_date) AS sf_live_won_opp,
             MAX(o.CloseDate) AS sf_last_won_close_date,
             ARRAY_AGG(o.ServiceName__c IGNORE NULLS ORDER BY o.CloseDate DESC LIMIT 1)[SAFE_OFFSET(0)] AS last_won_service
      FROM sf_accounts_of_company c, UNNEST(c.account_ids) AS acc
      JOIN sf_opps o ON o.AccountId = acc
      GROUP BY 1
    ),
    -- シグナル 3: DaijobAGENT 名のプロファイルが掲載中
    da_signal AS (
      SELECT p.company_id, TRUE AS da_active_profile
      FROM latest_profiles p JOIN pcm USING (profile_id)
      JOIN (SELECT DISTINCT profile_id FROM `bq-hgt.dwh.active_jobs`) j USING (profile_id)
      WHERE REGEXP_CONTAINS(LOWER(NORMALIZE(IFNULL(p.company_name, '') || IFNULL(p.profile_name, ''), NFKC)), r'daijob\s*agent')
      GROUP BY 1
    ),
    sf_acc AS (
      SELECT Id, Name, OwnerId, industry0413__c, notice_check_company__c
      FROM `bq-hgt.dwh.sf_accounts`
      WHERE IFNULL(IsDeleted, FALSE) = FALSE
      QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY LastModifiedDate DESC) = 1
    ),
    -- Salesforce 側の業種を alias で正規化（NFKC・小文字・空白除去で突合）
    sf_acc_ind AS (
      SELECT a.*,
             CASE WHEN IFNULL(al.is_ignored, FALSE) THEN NULL
                  ELSE COALESCE(al.dj_industry, NULLIF(TRIM(a.industry0413__c), '')) END AS sf_industry_norm
      FROM sf_acc a
      LEFT JOIN `bq-hgt.dwh.cms_dim_industry_alias` al
        ON REGEXP_REPLACE(LOWER(NORMALIZE(IFNULL(a.industry0413__c, ''), NFKC)), r'\s+', '') = REGEXP_REPLACE(LOWER(NORMALIZE(al.sf_value, NFKC)), r'\s+', '')
    ),
    sf_users_latest AS (
      SELECT Id, Name, LOWER(Email) AS email, Position__c, IsActive
      FROM `bq-hgt.dwh.sf_users`
      QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY recorded_on DESC, LastModifiedDate DESC) = 1
    ),
    active_companies_latest AS (
      -- sales_staff はローマ字「姓 名」（例: Tanabe Mami）。社内メールの規則「名の頭文字-姓@daijob.com」でメールを導出し、
      -- 「担当=自分」（ログインメールとの一致）に使う。姓だけの値はメール NULL
      SELECT company_id, sales_staff,
             IF(ARRAY_LENGTH(name_parts) >= 2,
                SUBSTR(name_parts[OFFSET(1)], 1, 1) || '-' || name_parts[OFFSET(0)] || '@daijob.com', NULL) AS sales_staff_email
      FROM (
        SELECT company_id, NULLIF(TRIM(sales_staff), '') AS sales_staff,
               SPLIT(REGEXP_REPLACE(LOWER(TRIM(IFNULL(sales_staff, ''))), r'\s+', ' '), ' ') AS name_parts
        FROM `bq-hgt.dwh.active_companies`
        QUALIFY ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY recorded_on DESC NULLS LAST) = 1
      )
    )
    SELECT c.company_id,
           COALESCE(ci.company_name, c.internal_name) AS company_name,
           c.internal_name,
           ci.profile_ids,
           IFNULL(ci.profile_count, 0) AS profile_count,
           COALESCE(ci.company_type, '不明') AS company_type,
           ci.dj_contract_type,
           c.active_from, c.active_to, c.contract_from, c.contract_to,
           c.is_contracted_now, c.contract_state,
           IF(c.active_to IS NULL, NULL, DATE_DIFF(c.active_to, run_date, DAY)) AS days_to_contract_end,
           DATE_DIFF(run_date, c.active_from, DAY) AS days_since_contract_start,
           IF(c.active_to IS NULL, NULL, DATE_DIFF(c.active_to, c.active_from, DAY) + 1) AS contract_days_total,
           COALESCE(ci.scout_limit_profiles, la.scout_limit) AS scout_limit,
           COALESCE(ci.job_limit_profiles, la.job_limit) AS job_posting_limit,
           scout_limit_period AS scout_limit_period_default,
           COALESCE(ci.dj_industry, a.sf_industry_norm, '(未設定)') AS industry,
           CASE WHEN ci.dj_industry IS NOT NULL THEN 'company_profiles' WHEN a.sf_industry_norm IS NOT NULL THEN 'sf_accounts' ELSE 'none' END AS industry_source,
           ci.dj_industry,
           a.industry0413__c AS sf_industry_raw,
           a.sf_industry_norm,
           IF(sc.Id IS NULL, 'unlinked', 'linked') AS sf_link_status,
           sc.AccountId AS sf_account_id,
           a.Name AS sf_account_name,
           sc.Id AS sf_contract_id, sc.Status AS sf_contract_status, sc.ContractKind__c AS sf_contract_kind,
           sc.StartDate AS sf_contract_start, sc.end_date AS sf_contract_end, sc.ContractTerm AS sf_contract_term_months,
           COALESCE(sc.ServiceName__c, s2.last_won_service, ci.dj_contract_type) AS plan_name,
           CASE WHEN sc.ServiceName__c IS NOT NULL THEN 'sf_contract' WHEN s2.last_won_service IS NOT NULL THEN 'sf_opportunity'
                WHEN ci.dj_contract_type IS NOT NULL THEN 'company_profiles' ELSE 'none' END AS plan_source,
           IFNULL(s1.sf_active_contract, FALSE) AS sf_active_contract,
           IFNULL(s2.sf_live_won_opp, FALSE) AS sf_live_won_opp,
           s2.sf_last_won_close_date,
           IFNULL(da.da_active_profile, FALSE) AS da_active_profile,
           CAST(c.is_contracted_now AS INT64) + CAST(IFNULL(s1.sf_active_contract, FALSE) AS INT64)
             + CAST(IFNULL(s2.sf_live_won_opp, FALSE) AS INT64) + CAST(IFNULL(da.da_active_profile, FALSE) AS INT64) AS contracted_signal_count,
           IFNULL(a.notice_check_company__c, FALSE) AS sf_notice_check,
           ua.Name AS sf_account_owner_name, ua.email AS sf_account_owner_email, ua.Position__c AS sf_account_owner_position, ua.IsActive AS sf_account_owner_active,
           uc.Name AS sf_contract_owner_name, uc.email AS sf_contract_owner_email, uc.Position__c AS sf_contract_owner_position, uc.IsActive AS sf_contract_owner_active,
           ac.sales_staff,
           CASE owner_source WHEN 'sf_account_owner' THEN ua.email WHEN 'sf_contract_owner' THEN uc.email ELSE ac.sales_staff_email END AS cs_owner_email_default,
           CASE owner_source WHEN 'sf_account_owner' THEN ua.Name WHEN 'sf_contract_owner' THEN uc.Name ELSE ac.sales_staff END AS cs_owner_name_default,
           owner_source,
           IFNULL(aj.n, 0) AS active_jobs_now
    FROM companies_now c
    LEFT JOIN company_info ci USING (company_id)
    LEFT JOIN limits_all la USING (company_id)
    LEFT JOIN active_jobs_company aj USING (company_id)
    LEFT JOIN sf_contract_pick sc USING (company_id)
    LEFT JOIN sf_signal1 s1 USING (company_id)
    LEFT JOIN sf_signal2 s2 USING (company_id)
    LEFT JOIN da_signal da USING (company_id)
    LEFT JOIN sf_acc_ind a ON a.Id = sc.AccountId
    LEFT JOIN sf_users_latest ua ON ua.Id = a.OwnerId
    LEFT JOIN sf_users_latest uc ON uc.Id = sc.OwnerId
    LEFT JOIN active_companies_latest ac USING (company_id);

    -- 03. cms_company_master（全件差し替え） ------------------------------------------------------------
    CREATE OR REPLACE TABLE `bq-hgt.dwh.cms_company_master`
    CLUSTER BY company_id
    OPTIONS (description = '契約企業マネジメントシステム: 企業マスタ（契約期間・枠数・業種・プラン・Salesforce 3 シグナル・担当候補）。毎朝 07:45 JST に全件差し替え') AS
    SELECT *, run_date AS run_date, CURRENT_TIMESTAMP() AS refreshed_at FROM company_base;

    -- 04. cms_contract_snapshot_daily（当日分を入れ直す） -------------------------------------------------
    DELETE FROM `bq-hgt.dwh.cms_contract_snapshot_daily` WHERE recorded_on = run_date;
    INSERT INTO `bq-hgt.dwh.cms_contract_snapshot_daily`
      (recorded_on, company_id, internal_name, company_name, active_from, active_to, is_contracted, contract_state, scout_limit, job_posting_limit,
       company_type, industry, plan_name, sf_contract_id, sf_contract_status, sf_contract_end, sf_active_contract, sf_live_won_opp, da_active_profile,
       cs_owner_email_default, cs_owner_name_default, sales_staff, note)
    SELECT run_date, company_id, internal_name, company_name, active_from, active_to, is_contracted_now, contract_state, scout_limit, job_posting_limit,
           company_type, industry, plan_name, sf_contract_id, sf_contract_status, sf_contract_end, sf_active_contract, sf_live_won_opp, da_active_profile,
           cs_owner_email_default, cs_owner_name_default, sales_staff, NULL
    FROM company_base;

    -- 05. scout_fact: scouts × scout_histories を 1 回で（初回の興味あり返信 = MIN(message_sent_at)） -----------
    CREATE TEMP TABLE scout_fact AS
    WITH first_interest AS (
      SELECT scout_id, MIN(message_sent_at) AS interested_at
      FROM `bq-hgt.dwh.scout_histories`
      WHERE from_status IN ('質問する', '開封のみ') AND to_status = '興味あり'
      GROUP BY 1
    )
    SELECT s.scout_id, s.member_id, pcm.company_id, s.profile_id,
           DATE(s.sent_at) AS sent_date, DATE_TRUNC(DATE(s.sent_at), MONTH) AS sent_month,
           IFNULL(s.is_auto_scout, FALSE) AS is_auto,
           DATE(fi.interested_at) AS interested_date, DATE_TRUNC(DATE(fi.interested_at), MONTH) AS interested_month,
           IF(s.application_status IS NULL OR TRIM(s.application_status) = '', '(未設定)', s.application_status) AS application_status
    FROM `bq-hgt.dwh.scouts` s
    JOIN pcm USING (profile_id)
    LEFT JOIN first_interest fi USING (scout_id)
    WHERE DATE(s.sent_at) BETWEEN fact_start AND data_date;

    -- 06. app_fact: 応募 ----------------------------------------------------------------------------------------
    CREATE TEMP TABLE app_fact AS
    SELECT a.application_id, a.member_id, pcm.company_id, a.profile_id, a.job_id, a.application_type,
           DATE(a.applicated_at) AS app_date, DATE_TRUNC(DATE(a.applicated_at), MONTH) AS app_month,
           IF(a.status IS NULL OR TRIM(a.status) = '', '(未設定)', a.status) AS status
    FROM `bq-hgt.dwh.member_applications` a
    JOIN pcm USING (profile_id)
    WHERE DATE(a.applicated_at) BETWEEN window_start AND data_date;

    -- 07. view_day: 求人閲覧（企業 × 日） ------------------------------------------------------------------------
    CREATE TEMP TABLE view_day AS
    SELECT pcm.company_id, DATE(v.viewed_at) AS view_date,
           COUNT(DISTINCT v.view_id) AS job_views, COUNT(DISTINCT v.member_id) AS job_view_members
    FROM `bq-hgt.dwh.member_job_detail_views` v
    JOIN pcm USING (profile_id)
    WHERE DATE(v.viewed_at) BETWEEN window_start AND data_date
    GROUP BY 1, 2;

    -- 08. job_month: 月末（当月は今日）時点の掲載求人数と新規掲載数（set_id で日英重複排除） ----------------------
    CREATE TEMP TABLE job_month AS
    WITH months AS (
      SELECT m AS month, IF(m = cur_month, run_date, LAST_DAY(m)) AS as_of
      FROM UNNEST(GENERATE_DATE_ARRAY(window_start, cur_month, INTERVAL 1 MONTH)) AS m
    ),
    jph AS (
      SELECT pcm.company_id, COALESCE(ja.set_id, j.job_id) AS job_key, j.job_publish_start_date AS s, j.job_publish_end_date AS e
      FROM `bq-hgt.dwh.job_publish_history` j
      JOIN pcm USING (profile_id)
      LEFT JOIN (SELECT DISTINCT job_id, set_id FROM `bq-hgt.dwh.jobs_all`) ja USING (job_id)
      WHERE j.job_publish_start_date IS NOT NULL
        AND j.job_publish_start_date <= run_date
        AND (j.job_publish_end_date IS NULL OR j.job_publish_end_date >= window_start)
    ),
    active_m AS (
      SELECT mo.month, x.company_id,
             COUNT(DISTINCT IF(x.s <= mo.as_of AND (x.e IS NULL OR x.e >= mo.as_of), x.job_key, NULL)) AS active_jobs_eom
      FROM jph x CROSS JOIN months mo
      GROUP BY 1, 2
    ),
    first_pub AS (SELECT company_id, job_key, MIN(s) AS first_start FROM jph GROUP BY 1, 2),
    new_m AS (
      SELECT company_id, DATE_TRUNC(first_start, MONTH) AS month, COUNT(*) AS new_jobs
      FROM first_pub WHERE first_start >= window_start GROUP BY 1, 2
    )
    SELECT COALESCE(a.month, n.month) AS month, COALESCE(a.company_id, n.company_id) AS company_id,
           IFNULL(a.active_jobs_eom, 0) AS active_jobs_eom, IFNULL(n.new_jobs, 0) AS new_jobs
    FROM active_m a FULL OUTER JOIN new_m n USING (month, company_id);

    -- 09. hire_fact: 11.採用 を会員 × 企業で重複排除（応募経路・スカウト経路） ----------------------------------
    CREATE TEMP TABLE hire_fact AS
    SELECT member_id, company_id,
           MIN(origin_date) AS origin_date, DATE_TRUNC(MIN(origin_date), MONTH) AS origin_month,
           LOGICAL_OR(path = 'application') AS via_application, LOGICAL_OR(path = 'scout') AS via_scout
    FROM (
      SELECT member_id, company_id, 'application' AS path, app_date AS origin_date FROM app_fact WHERE status = '11.採用'
      UNION ALL
      SELECT member_id, company_id, 'scout', COALESCE(interested_date, sent_date) FROM scout_fact WHERE application_status = '11.採用'
    )
    WHERE member_id IS NOT NULL
    GROUP BY member_id, company_id;

    -- 10. GA4 ログイン（直近 N 日を取り直し）→ cms_company_login -------------------------------------------------
    DELETE FROM `bq-hgt.dwh.cms_company_login_daily` WHERE login_date >= DATE_SUB(run_date, INTERVAL login_backfill_days DAY);
    FOR ds IN (SELECT d FROM UNNEST(ga4_datasets) AS d) DO
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
        GROUP BY 1, 2
        HAVING company_id IS NOT NULL
      """, ds.d, ds.d, FORMAT_DATE('%Y%m%d', DATE_SUB(run_date, INTERVAL login_backfill_days DAY)), FORMAT_DATE('%Y%m%d', run_date));
    END FOR;

    CREATE OR REPLACE TABLE `bq-hgt.dwh.cms_company_login`
    OPTIONS (description = '契約企業マネジメントシステム: 企業ごとの CT ログイン要約（最終ログイン・MTD / 30 日 / 90 日のログイン日数）。データは 2026-05-15 以降') AS
    SELECT cb.company_id,
           MIN(l.login_date) AS first_seen_date,
           MAX(l.last_event_ts) AS last_login_at,
           MAX(l.login_date) AS last_login_date,
           DATE_DIFF(data_date, MAX(l.login_date), DAY) AS days_since_login,
           COUNT(DISTINCT IF(l.login_date >= cur_month, l.login_date, NULL)) AS login_days_mtd,
           COUNT(DISTINCT IF(l.login_date > DATE_SUB(data_date, INTERVAL 30 DAY), l.login_date, NULL)) AS login_days_30d,
           COUNT(DISTINCT IF(l.login_date > DATE_SUB(data_date, INTERVAL 90 DAY), l.login_date, NULL)) AS login_days_90d,
           SUM(IF(l.login_date > DATE_SUB(data_date, INTERVAL 30 DAY), l.login_events, 0)) AS login_events_30d,
           DATE '2026-05-15' AS data_available_from,
           (SELECT MAX(login_date) FROM `bq-hgt.dwh.cms_company_login_daily`) AS data_through_date,
           ARRAY_AGG(DISTINCT l.source_dataset IGNORE NULLS) AS sources,
           CURRENT_TIMESTAMP() AS refreshed_at
    FROM company_base cb
    LEFT JOIN `bq-hgt.dwh.cms_company_login_daily` l USING (company_id)
    GROUP BY cb.company_id;

    -- 11. cms_company_monthly（企業 × 月、13 か月 + 当月 MTD） -----------------------------------------------------
    CREATE OR REPLACE TABLE `bq-hgt.dwh.cms_company_monthly`
    PARTITION BY month CLUSTER BY company_id
    OPTIONS (description = '契約企業マネジメントシステム: 企業 × 月の実績（掲載求人・スカウト・興味あり・応募・閲覧・採用・現ステータス別件数）。13 か月 + 当月 MTD。毎朝 07:45 JST に全件差し替え') AS
    WITH months AS (SELECT m AS month FROM UNNEST(GENERATE_DATE_ARRAY(window_start, cur_month, INTERVAL 1 MONTH)) AS m),
    grid AS (SELECT cb.company_id, mo.month FROM company_base cb CROSS JOIN months mo),
    contracted_m AS (
      SELECT g.company_id, g.month,
             LOGICAL_OR(cb.active_from <= LAST_DAY(g.month) AND COALESCE(cb.active_to, DATE '9999-12-31') >= g.month) AS by_companies,
             LOGICAL_OR(IFNULL(sn.is_contracted, FALSE)) AS by_snapshot
      FROM grid g
      JOIN company_base cb USING (company_id)
      LEFT JOIN `bq-hgt.dwh.cms_contract_snapshot_daily` sn
             ON sn.company_id = g.company_id AND sn.recorded_on BETWEEN g.month AND LAST_DAY(g.month)
      GROUP BY 1, 2
    ),
    sc_send AS (
      SELECT company_id, sent_month AS month,
             COUNT(*) AS scout_sent, COUNTIF(NOT is_auto) AS scout_sent_manual, COUNTIF(is_auto) AS scout_sent_auto,
             COUNTIF(interested_date IS NOT NULL) AS interested_by_send_month,
             COUNTIF(interested_date IS NOT NULL AND NOT is_auto) AS interested_manual_by_send_month
      FROM scout_fact WHERE sent_month >= window_start GROUP BY 1, 2
    ),
    sc_reply AS (
      SELECT company_id, interested_month AS month, COUNT(*) AS interested_by_reply_month,
             COUNTIF(application_status = '1.未対応') AS s01, COUNTIF(application_status = '2.連絡予定') AS s02,
             COUNTIF(application_status = '3.見送り予定') AS s03, COUNTIF(application_status = '4.連絡済み') AS s04,
             COUNTIF(application_status = '5.不採用') AS s05, COUNTIF(application_status = '6.面接調整中') AS s06,
             COUNTIF(application_status = '7.1stインタビュー') AS s07, COUNTIF(application_status = '8.2ndインタビュー') AS s08,
             COUNTIF(application_status = '9.3rdインタビュー') AS s09, COUNTIF(application_status = '10.Finalインタビュー') AS s10,
             COUNTIF(application_status = '11.採用') AS s11, COUNTIF(application_status = '12.辞退') AS s12
      FROM scout_fact WHERE interested_month >= window_start GROUP BY 1, 2
    ),
    sc_ctd AS (
      SELECT g.company_id, g.month, COUNT(sf.scout_id) AS scout_sent_contract_to_date
      FROM grid g
      JOIN company_base cb USING (company_id)
      LEFT JOIN scout_fact sf
        ON sf.company_id = g.company_id
       AND sf.sent_date BETWEEN cb.active_from AND LEAST(IF(g.month = cur_month, data_date, LAST_DAY(g.month)), COALESCE(cb.active_to, DATE '9999-12-31'))
      GROUP BY 1, 2
    ),
    ap AS (
      SELECT company_id, app_month AS month, COUNT(*) AS applications,
             COUNTIF(application_type = '求人') AS applications_job, COUNTIF(application_type = '企業') AS applications_direct,
             COUNTIF(status = '1.未対応') AS a01, COUNTIF(status = '2.連絡予定') AS a02, COUNTIF(status = '3.見送り予定') AS a03,
             COUNTIF(status = '4.連絡済み') AS a04, COUNTIF(status = '5.不採用') AS a05, COUNTIF(status = '6.面接調整中') AS a06,
             COUNTIF(status = '7.1stインタビュー') AS a07, COUNTIF(status = '8.2ndインタビュー') AS a08, COUNTIF(status = '9.3rdインタビュー') AS a09,
             COUNTIF(status = '10.Finalインタビュー') AS a10, COUNTIF(status = '11.採用') AS a11, COUNTIF(status = '12.辞退') AS a12
      FROM app_fact GROUP BY 1, 2
    ),
    vw AS (SELECT company_id, DATE_TRUNC(view_date, MONTH) AS month, SUM(job_views) AS job_views, SUM(job_view_members) AS job_view_members FROM view_day GROUP BY 1, 2),
    hr AS (SELECT company_id, origin_month AS month, COUNT(*) AS hires, COUNTIF(via_application) AS hires_from_application, COUNTIF(via_scout) AS hires_from_scout
           FROM hire_fact WHERE origin_month >= window_start GROUP BY 1, 2),
    lg AS (SELECT company_id, DATE_TRUNC(login_date, MONTH) AS month, COUNT(DISTINCT login_date) AS login_days FROM `bq-hgt.dwh.cms_company_login_daily` GROUP BY 1, 2)
    SELECT g.month,
           FORMAT_DATE('%Y-%m', g.month) AS month_ym,
           g.month = cur_month AS is_current_month,
           IF(g.month = cur_month, run_date, LAST_DAY(g.month)) AS as_of_date,
           IF(g.month = cur_month, EXTRACT(DAY FROM data_date), EXTRACT(DAY FROM LAST_DAY(g.month))) AS data_days,
           g.company_id,
           IFNULL(cm.by_companies, FALSE) OR IFNULL(cm.by_snapshot, FALSE) AS is_contracted_in_month,
           CASE WHEN IFNULL(cm.by_snapshot, FALSE) THEN 'snapshot' WHEN IFNULL(cm.by_companies, FALSE) THEN 'companies' ELSE 'none' END AS contracted_source,
           cb.scout_limit, cb.job_posting_limit,
           IFNULL(jm.active_jobs_eom, 0) AS active_jobs_eom, IFNULL(jm.new_jobs, 0) AS new_jobs,
           IFNULL(ss.scout_sent, 0) AS scout_sent, IFNULL(ss.scout_sent_manual, 0) AS scout_sent_manual, IFNULL(ss.scout_sent_auto, 0) AS scout_sent_auto,
           IFNULL(sc.scout_sent_contract_to_date, 0) AS scout_sent_contract_to_date,
           IFNULL(ss.interested_by_send_month, 0) AS interested_by_send_month,
           IFNULL(sr.interested_by_reply_month, 0) AS interested_by_reply_month,
           IFNULL(ss.interested_manual_by_send_month, 0) AS interested_manual_by_send_month,
           SAFE_DIVIDE(ss.interested_by_send_month, ss.scout_sent) AS reply_rate,
           IFNULL(ap.applications, 0) AS applications, IFNULL(ap.applications_job, 0) AS applications_job, IFNULL(ap.applications_direct, 0) AS applications_direct,
           IFNULL(vw.job_views, 0) AS job_views, IFNULL(vw.job_view_members, 0) AS job_view_members,
           IFNULL(hr.hires, 0) AS hires, IFNULL(hr.hires_from_application, 0) AS hires_from_application, IFNULL(hr.hires_from_scout, 0) AS hires_from_scout,
           IFNULL(ap.a01, 0) + IFNULL(sr.s01, 0) AS st01_no_response,
           IFNULL(ap.a02, 0) + IFNULL(sr.s02, 0) AS st02_contact_planned,
           IFNULL(ap.a03, 0) + IFNULL(sr.s03, 0) AS st03_pass_planned,
           IFNULL(ap.a04, 0) + IFNULL(sr.s04, 0) AS st04_contacted,
           IFNULL(ap.a05, 0) + IFNULL(sr.s05, 0) AS st05_rejected,
           IFNULL(ap.a06, 0) + IFNULL(sr.s06, 0) AS st06_interview_adjusting,
           IFNULL(ap.a07, 0) + IFNULL(sr.s07, 0) AS st07_interview_1st,
           IFNULL(ap.a08, 0) + IFNULL(sr.s08, 0) AS st08_interview_2nd,
           IFNULL(ap.a09, 0) + IFNULL(sr.s09, 0) AS st09_interview_3rd,
           IFNULL(ap.a10, 0) + IFNULL(sr.s10, 0) AS st10_interview_final,
           IFNULL(ap.a11, 0) + IFNULL(sr.s11, 0) AS st11_hired,
           IFNULL(ap.a12, 0) + IFNULL(sr.s12, 0) AS st12_declined,
           IFNULL(ap.a06, 0) + IFNULL(ap.a07, 0) + IFNULL(ap.a08, 0) + IFNULL(ap.a09, 0) + IFNULL(ap.a10, 0)
             + IFNULL(sr.s06, 0) + IFNULL(sr.s07, 0) + IFNULL(sr.s08, 0) + IFNULL(sr.s09, 0) + IFNULL(sr.s10, 0) AS in_selection,
           IF(g.month < DATE '2026-05-01', NULL, IFNULL(lg.login_days, 0)) AS login_days,
           CURRENT_TIMESTAMP() AS refreshed_at
    FROM grid g
    JOIN company_base cb USING (company_id)
    LEFT JOIN contracted_m cm USING (company_id, month)
    LEFT JOIN job_month jm USING (company_id, month)
    LEFT JOIN sc_send ss USING (company_id, month)
    LEFT JOIN sc_reply sr USING (company_id, month)
    LEFT JOIN sc_ctd sc USING (company_id, month)
    LEFT JOIN ap USING (company_id, month)
    LEFT JOIN vw USING (company_id, month)
    LEFT JOIN hr USING (company_id, month)
    LEFT JOIN lg USING (company_id, month);

    -- 12. cms_company_daily_usage（企業 × 日、前月 + 当月。累積列でペース曲線） -------------------------------------
    CREATE OR REPLACE TABLE `bq-hgt.dwh.cms_company_daily_usage`
    PARTITION BY usage_date CLUSTER BY company_id
    OPTIONS (description = '契約企業マネジメントシステム: 企業 × 日（前月 + 当月）のスカウト・応募・興味あり・閲覧と月内累積。ペース曲線用') AS
    WITH days AS (SELECT d AS usage_date FROM UNNEST(GENERATE_DATE_ARRAY(prev_month, data_date)) AS d),
    base AS (SELECT company_id, scout_limit FROM company_base WHERE contract_state IN ('active', 'ending_30d', 'ended_recent', 'upcoming')),
    grid AS (SELECT b.company_id, d.usage_date, DATE_TRUNC(d.usage_date, MONTH) AS month FROM base b CROSS JOIN days d),
    sc AS (SELECT company_id, sent_date AS usage_date, COUNT(*) AS scout_sent, COUNTIF(NOT is_auto) AS scout_sent_manual FROM scout_fact WHERE sent_date >= prev_month GROUP BY 1, 2),
    ir AS (SELECT company_id, interested_date AS usage_date, COUNT(*) AS interested FROM scout_fact WHERE interested_date >= prev_month GROUP BY 1, 2),
    ap AS (SELECT company_id, app_date AS usage_date, COUNT(*) AS applications FROM app_fact WHERE app_date >= prev_month GROUP BY 1, 2),
    aj AS (
      SELECT pcm.company_id, d.usage_date, COUNT(DISTINCT COALESCE(ja.set_id, j.job_id)) AS active_jobs
      FROM `bq-hgt.dwh.job_publish_history` j
      JOIN pcm USING (profile_id)
      LEFT JOIN (SELECT DISTINCT job_id, set_id FROM `bq-hgt.dwh.jobs_all`) ja USING (job_id)
      JOIN days d ON j.job_publish_start_date <= d.usage_date AND (j.job_publish_end_date IS NULL OR j.job_publish_end_date >= d.usage_date)
      WHERE j.job_publish_start_date IS NOT NULL AND (j.job_publish_end_date IS NULL OR j.job_publish_end_date >= prev_month)
      GROUP BY 1, 2
    ),
    lg AS (SELECT company_id, login_date AS usage_date, SUM(login_events) AS login_events FROM `bq-hgt.dwh.cms_company_login_daily` WHERE login_date >= prev_month GROUP BY 1, 2)
    SELECT g.usage_date, g.month, EXTRACT(DAY FROM g.usage_date) AS day_of_month, g.company_id,
           IFNULL(sc.scout_sent, 0) AS scout_sent,
           SUM(IFNULL(sc.scout_sent, 0)) OVER w AS scout_sent_cum,
           SUM(IFNULL(sc.scout_sent_manual, 0)) OVER w AS scout_sent_manual_cum,
           IFNULL(ap.applications, 0) AS applications, SUM(IFNULL(ap.applications, 0)) OVER w AS applications_cum,
           IFNULL(ir.interested, 0) AS interested, SUM(IFNULL(ir.interested, 0)) OVER w AS interested_cum,
           IFNULL(vd.job_views, 0) AS job_views, SUM(IFNULL(vd.job_views, 0)) OVER w AS job_views_cum,
           IFNULL(aj.active_jobs, 0) AS active_jobs,
           IFNULL(lg.login_events, 0) AS login_events,
           b.scout_limit,
           CURRENT_TIMESTAMP() AS refreshed_at
    FROM grid g
    JOIN base b USING (company_id)
    LEFT JOIN sc USING (company_id, usage_date)
    LEFT JOIN ir USING (company_id, usage_date)
    LEFT JOIN ap USING (company_id, usage_date)
    LEFT JOIN aj USING (company_id, usage_date)
    LEFT JOIN lg USING (company_id, usage_date)
    LEFT JOIN view_day vd ON vd.company_id = g.company_id AND vd.view_date = g.usage_date
    WINDOW w AS (PARTITION BY g.company_id, g.month ORDER BY g.usage_date);

    -- 13. コホート（現ステータス）と日次スナップショット ---------------------------------------------------------
    CREATE OR REPLACE TABLE `bq-hgt.dwh.cms_scout_cohort_status`
    CLUSTER BY company_id
    OPTIONS (description = '契約企業マネジメントシステム: 興味あり返信月（初回返信）× 現在の選考ステータス × 件数（スカウト経路）') AS
    SELECT company_id, interested_month AS cohort_month, application_status,
           COUNT(DISTINCT scout_id) AS scouts, COUNT(DISTINCT member_id) AS members, CURRENT_TIMESTAMP() AS refreshed_at
    FROM scout_fact WHERE interested_month >= window_start
    GROUP BY 1, 2, 3;

    CREATE OR REPLACE TABLE `bq-hgt.dwh.cms_application_cohort_status`
    CLUSTER BY company_id
    OPTIONS (description = '契約企業マネジメントシステム: 応募月 × 現在の選考ステータス × 件数（応募経路）') AS
    SELECT company_id, app_month AS cohort_month, status,
           COUNT(DISTINCT application_id) AS applications, COUNT(DISTINCT member_id) AS members, CURRENT_TIMESTAMP() AS refreshed_at
    FROM app_fact
    GROUP BY 1, 2, 3;

    DELETE FROM `bq-hgt.dwh.cms_status_snapshot_daily` WHERE recorded_on = run_date;
    INSERT INTO `bq-hgt.dwh.cms_status_snapshot_daily` (recorded_on, source, company_id, cohort_month, status, cnt)
    SELECT run_date, 'scout', company_id, cohort_month, application_status, scouts FROM `bq-hgt.dwh.cms_scout_cohort_status`
    UNION ALL
    SELECT run_date, 'application', company_id, cohort_month, status, applications FROM `bq-hgt.dwh.cms_application_cohort_status`;

    -- 14. スカウト対象の会員属性（企業 × 送信月 × 属性種別 × 値） ------------------------------------------------
    --   語学・年収帯・年代・職種 12 区分はビュー member_profile_latest を流用（導出ロジックの唯一の定義場所）
    CREATE OR REPLACE TABLE `bq-hgt.dwh.cms_scout_member_attributes_monthly`
    CLUSTER BY company_id, attribute_type
    OPTIONS (description = '契約企業マネジメントシステム: スカウトを送った会員の属性の内訳（企業 × 送信月 × 属性種別 × 値）。属性は現在のプロフィール') AS
    WITH latest_raw AS (
      SELECT member_id, member_category, country_of_residence, experienced_occupation, desired_occupation, desired_annual_income_yen
      FROM `bq-hgt.dwh.member_details`
      QUALIFY ROW_NUMBER() OVER (PARTITION BY member_id ORDER BY recorded_on DESC NULLS LAST) = 1
    ),
    sm AS (
      SELECT sf.company_id, sf.sent_month, sf.scout_id, sf.member_id, sf.interested_date IS NOT NULL AS interested,
             v.japanese_level, v.english_level, v.last_occupation AS last_occupation_group, v.annual_income_range AS current_income_range, v.age_group,
             r.member_category, r.country_of_residence, r.experienced_occupation, r.desired_occupation, r.desired_annual_income_yen
      FROM scout_fact sf
      LEFT JOIN `bq-hgt.dwh.member_profile_latest` v USING (member_id)
      LEFT JOIN latest_raw r USING (member_id)
      WHERE sf.sent_month >= window_start
    ),
    long AS (
      SELECT company_id, sent_month, scout_id, member_id, interested, 'japanese_level' AS attribute_type, IFNULL(japanese_level, '(未入力)') AS attribute_value FROM sm
      UNION ALL SELECT company_id, sent_month, scout_id, member_id, interested, 'english_level', IFNULL(english_level, '(未入力)') FROM sm
      UNION ALL SELECT company_id, sent_month, scout_id, member_id, interested, 'residence_prefecture',
        CASE
          WHEN country_of_residence IS NULL OR TRIM(country_of_residence) = '' THEN '(未入力)'
          WHEN NOT STARTS_WITH(country_of_residence, '日本') THEN '日本以外'
          ELSE COALESCE(NULLIF(REGEXP_EXTRACT(country_of_residence, r'^日本[\s\x{3000}]+(\S+)'), ''), '日本（都道府県不明）')
        END FROM sm
      UNION ALL SELECT company_id, sent_month, scout_id, member_id, interested, 'last_occupation_group', IFNULL(last_occupation_group, '(未入力)') FROM sm
      UNION ALL SELECT company_id, sent_month, scout_id, member_id, interested, 'current_income_range', IFNULL(current_income_range, '(未入力)') FROM sm
      UNION ALL SELECT company_id, sent_month, scout_id, member_id, interested, 'desired_income_range',
        CASE WHEN SAFE_CAST(desired_annual_income_yen AS FLOAT64) IS NULL OR SAFE_CAST(desired_annual_income_yen AS FLOAT64) <= 0 THEN '(未入力)'
             WHEN SAFE_CAST(desired_annual_income_yen AS FLOAT64) <= 3000000 THEN '300万円以下'
             WHEN SAFE_CAST(desired_annual_income_yen AS FLOAT64) <= 5000000 THEN '301万円〜500万円'
             WHEN SAFE_CAST(desired_annual_income_yen AS FLOAT64) <= 8000000 THEN '501万円〜800万円'
             ELSE '801万円以上' END FROM sm
      UNION ALL SELECT company_id, sent_month, scout_id, member_id, interested, 'member_category', IFNULL(member_category, '(未入力)') FROM sm
      UNION ALL SELECT company_id, sent_month, scout_id, member_id, interested, 'target_flag',
        CASE WHEN member_category IN ('A', 'B', 'C', 'I') THEN 'ターゲット' WHEN member_category IS NULL OR member_category = '' THEN '(未入力)' ELSE 'ターゲット外' END FROM sm
      UNION ALL SELECT company_id, sent_month, scout_id, member_id, interested, 'age_group', IFNULL(age_group, '(未入力)') FROM sm
      UNION ALL SELECT company_id, sent_month, scout_id, member_id, interested, 'experienced_occupation', occ
        FROM sm, UNNEST(IF(experienced_occupation IS NULL OR TRIM(experienced_occupation) = '', ['(未入力)'],
          ARRAY(SELECT DISTINCT TRIM(SPLIT(x, ' - ')[SAFE_OFFSET(0)]) FROM UNNEST(SPLIT(experienced_occupation, ',')) x WHERE TRIM(x) != ''))) AS occ
      UNION ALL SELECT company_id, sent_month, scout_id, member_id, interested, 'desired_occupation', occ
        FROM sm, UNNEST(IF(desired_occupation IS NULL OR TRIM(desired_occupation) = '', ['(未入力)'],
          ARRAY(SELECT DISTINCT TRIM(SPLIT(x, ' - ')[SAFE_OFFSET(0)]) FROM UNNEST(SPLIT(desired_occupation, ',')) x WHERE TRIM(x) != ''))) AS occ
    )
    SELECT company_id, sent_month, attribute_type, attribute_value,
           COUNT(DISTINCT scout_id) AS scouts, COUNT(DISTINCT member_id) AS members,
           COUNT(DISTINCT IF(interested, scout_id, NULL)) AS interested_scouts, CURRENT_TIMESTAMP() AS refreshed_at
    FROM long
    GROUP BY 1, 2, 3, 4;

    -- 15. 業界ベンチマーク（月 × 業種 × 企業種別 × 指標。__ALL__ のロールアップ行付き） -----------------------------
    CREATE OR REPLACE TABLE `bq-hgt.dwh.cms_industry_benchmark_monthly`
    CLUSTER BY industry
    OPTIONS (description = '契約企業マネジメントシステム: 同業種・同種別の契約企業における指標の分布（平均・p25・中央値・p75）。__ALL__ は業種全体 / 種別全体') AS
    WITH base AS (
      SELECT m.month, m.company_id, cm.industry, cm.company_type,
             [STRUCT('scout_utilization' AS metric, SAFE_DIVIDE(m.scout_sent, NULLIF(m.scout_limit, 0)) AS v),
              STRUCT('job_utilization', SAFE_DIVIDE(m.active_jobs_eom, NULLIF(m.job_posting_limit, 0))),
              STRUCT('reply_rate', SAFE_DIVIDE(m.interested_by_send_month, NULLIF(m.scout_sent, 0))),
              STRUCT('apps_per_active_job', SAFE_DIVIDE(m.applications, NULLIF(m.active_jobs_eom, 0))),
              STRUCT('views_per_active_job', SAFE_DIVIDE(m.job_views, NULLIF(m.active_jobs_eom, 0))),
              STRUCT('interested_per_100_scouts', SAFE_DIVIDE(m.interested_by_send_month * 100, NULLIF(m.scout_sent, 0))),
              STRUCT('hires', CAST(m.hires AS FLOAT64)),
              STRUCT('login_days', CAST(m.login_days AS FLOAT64))] AS metrics
      FROM `bq-hgt.dwh.cms_company_monthly` m
      JOIN `bq-hgt.dwh.cms_company_master` cm USING (company_id)
      WHERE m.is_contracted_in_month
    ),
    long AS (
      SELECT b.month, b.company_id, ind, typ, x.metric, x.v
      FROM base b, UNNEST(b.metrics) x, UNNEST([b.industry, '__ALL__']) ind, UNNEST([b.company_type, '__ALL__']) typ
      WHERE x.v IS NOT NULL
    )
    SELECT month, FORMAT_DATE('%Y-%m', month) AS month_ym, ind AS industry, typ AS company_type, metric,
           COUNT(DISTINCT company_id) AS n_companies,
           AVG(v) AS mean,
           APPROX_QUANTILES(v, 4)[OFFSET(1)] AS p25,
           APPROX_QUANTILES(v, 4)[OFFSET(2)] AS median,
           APPROX_QUANTILES(v, 4)[OFFSET(3)] AS p75,
           CURRENT_TIMESTAMP() AS refreshed_at
    FROM long
    GROUP BY 1, 2, 3, 4, 5;

    -- 16. 実行記録 ----------------------------------------------------------------------------------------------
    INSERT INTO `bq-hgt.dwh.cms_refresh_log` (run_date, step, started_at, finished_at, status, rows_master, rows_monthly, note)
    SELECT run_date, 'all', t0, CURRENT_TIMESTAMP(), 'ok',
           (SELECT COUNT(*) FROM `bq-hgt.dwh.cms_company_master`),
           (SELECT COUNT(*) FROM `bq-hgt.dwh.cms_company_monthly`),
           NULL;
  EXCEPTION WHEN ERROR THEN
    INSERT INTO `bq-hgt.dwh.cms_refresh_log` (run_date, step, started_at, finished_at, status, note)
    VALUES (run_date, 'all', t0, CURRENT_TIMESTAMP(), 'error', @@error.message);
    RAISE;
  END;
END;
