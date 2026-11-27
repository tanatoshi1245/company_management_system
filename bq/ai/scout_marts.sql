-- =============================================================================
-- 契約企業マネジメントシステム: ② スカウト文面の AI 作成 — 日次マート（1 本のスクリプト）
--   スケジュール: 毎日 23:10 UTC（= JST 08:10。cms_marts 日次更新 07:45 JST の後。cms_company_master を読むため）
--   宛先テーブル: なし（スクリプト内で CREATE OR REPLACE。drafts だけ CREATE TABLE IF NOT EXISTS）
--   作る表: cms_ai_dim_industry_group / cms_ai_scout_templates / cms_ai_scout_sends / cms_ai_scout_drafts（枠だけ）/ cms_ai_scout_draft_outcomes
--           / cms_ai_jobs（求人の内容。求人 ID からの作成用）/ cms_ai_member_profiles（候補者の属性。会員 ID からの作成用）（2026-11-27 追加）
--   スキャン: 約 21 GB/日（messages の subject・body を 1 回 = 約 18.4 GB。messages はパーティションが無い。jobs_all の本文 2 列 = 約 1.3 GB）
--   失敗時は EXCEPTION で cms_ai_refresh_log に error 行を残し、前日の表がそのまま残る。再実行は冪等（全件差し替え）
--   設計・列定義・正規表現: company_management_system/bq/ai/README.md
-- 変更時の注意: Worker 側の読み取り SQL（src/worker/sql/aiScout.ts）・型（src/shared/ai/scout.ts）・業界の対応表（src/shared/ai/industryGroups.ts）を合わせる
-- =============================================================================
BEGIN
  DECLARE run_date DATE DEFAULT CURRENT_DATE('Asia/Tokyo');
  DECLARE t0 TIMESTAMP DEFAULT CURRENT_TIMESTAMP();
  DECLARE window_start DATE DEFAULT DATE_SUB(DATE_TRUNC(CURRENT_DATE('Asia/Tokyo'), MONTH), INTERVAL 13 MONTH);  -- 13 か月 + 当月
  -- 法人格（社名の前後に付く語）
  DECLARE corp_re STRING DEFAULT r'株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|学校法人|医療法人|㈱|\(株\)|（株）';

  BEGIN
    -- 00. アプリが書く表（枠だけ。中身は Worker が MERGE で書く。ここでは変えない） ---------------------------------
    CREATE TABLE IF NOT EXISTS `bq-hgt.dwh.cms_ai_scout_drafts` (
      draft_id STRING NOT NULL OPTIONS (description = '案の ID（アプリの D1 と同じ）'),
      job_id STRING OPTIONS (description = 'AI の依頼の ID（D1 ai_jobs.id）'),
      company_id INT64 OPTIONS (description = '依頼した企業'),
      model_id STRING OPTIONS (description = '文面を作ったモデル（a / b / c）'),
      model_version INT64 OPTIONS (description = 'モデルの版'),
      subject STRING OPTIONS (description = '件名（CS が選んだ時点。差し込みは {{…}}）'),
      body STRING OPTIONS (description = '本文（同上）'),
      chosen_at TIMESTAMP OPTIONS (description = 'CS が選んだ日時'),
      updated_at TIMESTAMP OPTIONS (description = 'アプリが最後に書いた日時')
    )
    CLUSTER BY company_id
    OPTIONS (description = '契約企業マネジメントシステム AI: CS が選んだスカウト文面の案（アプリが MERGE で写す。送信実績との照合用。企業名は入れない）');

    -- 01. 類似業界のまとまり（industry → industry_group）。src/shared/ai/industryGroups.ts と同じ対応（テストが突き合わせる） ----
    CREATE OR REPLACE TABLE `bq-hgt.dwh.cms_ai_dim_industry_group`
    OPTIONS (description = '契約企業マネジメントシステム AI: 業界（cms_company_master.industry）→ 類似業界のまとまり。毎朝 全件差し替え（対応は bq/ai/scout_marts.sql に固定）') AS
    SELECT industry, industry_group, group_label
    FROM UNNEST(ARRAY<STRUCT<industry STRING, industry_group STRING, group_label STRING>>[
      -- industry_groups:begin
      ('通信・情報サービス関連', 'it', 'IT・通信'),
      ('ITコンサルティング', 'it', 'IT・通信'),
      ('その他IT関連', 'it', 'IT・通信'),
      ('ソフトウェアベンダー', 'it', 'IT・通信'),
      ('システムインテグレーター', 'it', 'IT・通信'),
      ('ソフトウェア（受託開発）', 'it', 'IT・通信'),
      ('インターネット・プロバイダー関連', 'it', 'IT・通信'),
      ('ゲーム関連', 'it', 'IT・通信'),
      ('人材紹介会社', 'hr', '人材'),
      ('派遣会社', 'hr', '人材'),
      ('アウトソーシング', 'hr', '人材'),
      ('自動車・輸送機器メーカー', 'maker', 'メーカー'),
      ('機械メーカー', 'maker', 'メーカー'),
      ('半導体・電気・電子部品メーカー', 'maker', 'メーカー'),
      ('その他製造業', 'maker', 'メーカー'),
      ('産業機器・重電・設備メーカー', 'maker', 'メーカー'),
      ('電気・家電メーカー', 'maker', 'メーカー'),
      ('コンピュータ・OA・通信機器メーカー', 'maker', 'メーカー'),
      ('化学・石油メーカー', 'maker', 'メーカー'),
      ('精密・測定機器メーカー', 'maker', 'メーカー'),
      ('繊維メーカー', 'maker', 'メーカー'),
      ('鉄鋼・金属・非鉄', 'maker', 'メーカー'),
      ('食品メーカー', 'maker', 'メーカー'),
      ('ビジネスコンサルティング', 'consulting', 'コンサルティング'),
      ('その他コンサルティング', 'consulting', 'コンサルティング'),
      ('マーケットリサーチ・シンクタンク', 'consulting', 'コンサルティング'),
      ('その他金融', 'finance', '金融'),
      ('投資・ファンド関連', 'finance', '金融'),
      ('銀行・証券関連', 'finance', '金融'),
      ('生命保険・損害保険', 'finance', '金融'),
      ('旅行・ホテル・レジャー・外食', 'consumer', 'サービス・消費'),
      ('流通・小売', 'consumer', 'サービス・消費'),
      ('ファッション・アパレル・アクセサリー関連', 'consumer', 'サービス・消費'),
      ('化粧品メーカー', 'consumer', 'サービス・消費'),
      ('高級消費財', 'consumer', 'サービス・消費'),
      ('消費財/FMCGメーカー', 'consumer', 'サービス・消費'),
      ('商社・卸', 'trading', '商社・物流'),
      ('運輸・倉庫・物流', 'trading', '商社・物流'),
      ('教育・学校', 'public', '教育・公共'),
      ('官公庁・団体', 'public', '教育・公共'),
      ('マスコミ・広告・出版・印刷・放送', 'media', 'メディア'),
      ('住宅・不動産・施設関連', 'realestate', '不動産・建設・エネルギー'),
      ('プラント・建築・建設', 'realestate', '不動産・建設・エネルギー'),
      ('電力・ガス・石油・エネルギー関連', 'realestate', '不動産・建設・エネルギー'),
      ('医療・福祉関連', 'medical', '医療・ヘルスケア'),
      ('医療機器メーカー', 'medical', '医療・ヘルスケア'),
      ('製薬メーカー', 'medical', '医療・ヘルスケア'),
      ('その他', 'other', 'その他')
      -- industry_groups:end
    ]);

    -- 02. 企業 → プロファイル（マートに居る企業だけ = 社内テスト・Network 契約は入らない。RA 4928 / 14508・RDS 7080 は除く） ----
    --   業界が対応表に無い（新しい値・未設定）企業は、まとまり 'other'（その他）に入れる
    CREATE TEMP TABLE prof AS
    SELECT m.company_id, pid AS profile_id, IFNULL(m.industry, 'その他') AS industry, IFNULL(g.industry_group, 'other') AS industry_group, m.company_type
    FROM `bq-hgt.dwh.cms_company_master` m
    CROSS JOIN UNNEST(m.profile_ids) AS pid
    LEFT JOIN `bq-hgt.dwh.cms_ai_dim_industry_group` g ON g.industry = m.industry
    WHERE pid NOT IN (4928, 14508, 7080);

    -- 03. スカウト（直近 13 か月 + 当月。送信月基準）。興味あり返信 = 質問する / 開封のみ → 興味あり。採用 = application_status '11.採用' ----
    CREATE TEMP TABLE sc AS
    WITH first_interest AS (
      SELECT scout_id
      FROM `bq-hgt.dwh.scout_histories`
      WHERE from_status IN ('質問する', '開封のみ') AND to_status = '興味あり'
      GROUP BY 1
    )
    SELECT s.scout_id, s.member_id, p.company_id, p.industry, p.industry_group, p.company_type, s.profile_name,
           DATE(s.sent_at) AS sent_date, IFNULL(s.is_auto_scout, FALSE) AS is_auto,
           (fi.scout_id IS NOT NULL) AS replied, IFNULL(s.application_status = '11.採用', FALSE) AS hired
    FROM `bq-hgt.dwh.scouts` s
    JOIN prof p USING (profile_id)
    LEFT JOIN first_interest fi USING (scout_id)
    WHERE DATE(s.sent_at) >= window_start AND DATE(s.sent_at) <= run_date
    QUALIFY ROW_NUMBER() OVER (PARTITION BY s.scout_id ORDER BY s.recorded_on DESC NULLS LAST) = 1;

    -- 03b. 求人（cms_ai_jobs の元。jobs_all を読むのはここだけ）。対象 = マートに居る企業の求人のうち、直近 13 か月 + 当月に掲載があった求人 ----
    --   掲載の期間は job_publish_history（終了日が NULL = いま掲載中）。jobs_all.publish_status は使わない
    --   （差分更新のため、掲載が終わった求人にも「掲載」が残る。2026-11-27 実測: 「掲載」59,382 件のうち、いま掲載中は 19,052 件）
    --   求人 → 企業は、求人のプロファイル（jobs_all.profile_id）→ prof（既存マートの求人と同じ結び方。RA / RDS のプロファイルは入らない）
    CREATE TEMP TABLE jb AS
    WITH pub AS (
      SELECT job_id, LOGICAL_OR(job_publish_end_date IS NULL) AS published
      FROM `bq-hgt.dwh.job_publish_history`
      WHERE job_publish_start_date IS NOT NULL AND job_publish_start_date <= run_date
        AND (job_publish_end_date IS NULL OR job_publish_end_date >= window_start)
      GROUP BY 1
    )
    SELECT j.job_id, p.company_id, pub.published, j.profile_name, j.client_company_name, j.position_name, j.occupation, j.industry,
           j.japanese_level, j.english_level, j.annual_income, j.annual_income_min, j.annual_income_max,
           j.work_location1_area, j.work_location1_country, j.work_location1_city,
           j.job_description, j.application_condition,
           COALESCE(DATE(j.recruitment_updated_at), j.recorded_on) AS updated_on
    FROM `bq-hgt.dwh.jobs_all` j
    JOIN pub USING (job_id)
    JOIN prof p ON p.profile_id = j.profile_id
    WHERE j.job_id IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY j.job_id ORDER BY j.recorded_on DESC NULLS LAST, p.company_id) = 1;

    -- 04. 企業ごとの「社名の正規表現」（社名・内部名称・プロファイル名と、法人格・かっこ書きを除いた形。長い順） ----------------
    --   2 文字（英数字だけなら 3 文字）に満たない名前は使わない（ふつうの語を消さないため）
    CREATE TEMP TABLE co_names AS
    WITH raw_names AS (
      SELECT company_id, company_name AS nm FROM `bq-hgt.dwh.cms_company_master`
      UNION ALL SELECT company_id, internal_name FROM `bq-hgt.dwh.cms_company_master`
      UNION ALL SELECT DISTINCT company_id, profile_name FROM sc
      UNION ALL SELECT DISTINCT company_id, profile_name FROM jb
    ),
    variants AS (
      SELECT company_id, TRIM(v) AS v
      FROM raw_names,
           UNNEST([nm,
                   REGEXP_REPLACE(nm, r'[（(【\[][^）)】\]]*[）)】\]]', ''),
                   REGEXP_REPLACE(REGEXP_REPLACE(nm, r'[（(【\[][^）)】\]]*[）)】\]]', ''), CONCAT(corp_re, r'|(?i)[,\s]*\b(co\.?,?\s*ltd\.?|inc\.?|k\.k\.?|corporation|corp\.?|g\.k\.?|llc|ltd\.?|limited)$'), '')]) AS v
      WHERE nm IS NOT NULL
    ),
    cleaned AS (
      SELECT DISTINCT company_id, TRIM(REGEXP_REPLACE(v, r'^[\s　,、.]+|[\s　,、.]+$', '')) AS v FROM variants
    ),
    escaped AS (
      SELECT company_id, v,
             REGEXP_REPLACE(REGEXP_REPLACE(v, r'([\\.^$|?*+()\[\]{}\-])', r'\\\1'), r'[\s　]+', r'[\\s　]*') AS e
      FROM cleaned
      WHERE CHAR_LENGTH(v) >= IF(REGEXP_CONTAINS(v, r'[^\x00-\x7F]'), 2, 3)
        AND NOT REGEXP_CONTAINS(v, CONCAT('^(', corp_re, ')$'))
    )
    SELECT company_id, name_re, (SAFE.REGEXP_CONTAINS('', name_re) IS NOT NULL) AS name_re_ok
    FROM (
      SELECT company_id, CONCAT('(?i)(?:', STRING_AGG(e, '|' ORDER BY CHAR_LENGTH(v) DESC, v), ')') AS name_re
      FROM escaped
      GROUP BY 1
    );

    -- 05. スカウトの最初の 1 通（企業から）。messages を読むのはここだけ（1 回の実行で 1 回） -----------------------------
    --   norm = 文面をまとめるための形: 改行をそろえ、冒頭の宛名（「〇〇様」「ID様」「Dear 〇〇,」）を {{候補者名}}様 に置き換える
    --   （宛名だけが違う同じ文面を 1 つにまとめるため。これをしないと、会員 ID を宛名に入れた文面が 1 通ずつ別の文面になる）
    CREATE TEMP TABLE first_msg AS
    WITH f AS (
      SELECT m.scout_id, TRIM(m.subject) AS subject, TRIM(REGEXP_REPLACE(m.body, r'\r\n?', '\n')) AS b
      FROM `bq-hgt.dwh.messages` m
      WHERE m.scout_id IS NOT NULL AND m.is_from_company = 1
        AND m.scout_id IN (SELECT scout_id FROM sc)
      QUALIFY ROW_NUMBER() OVER (PARTITION BY m.scout_id ORDER BY m.created_at, m.id) = 1
    )
    SELECT scout_id, subject,
           REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
             b,
             -- 会員 ID + 様（どこにあっても）
             r'(?i)(?:会員)?(?:ID|No\.?|番号)?[\s　:：#]*[0-9０-９]{5,8}[\s　]*(?:様|さま|さん)', '{{候補者名}}様'),
             -- 本文の中の「ID: 123456」
             r'(?i)\bID[\s　:：#]*[0-9０-９]{5,8}\b', 'ID {{候補者ID}}'),
             -- 1 行目の「〇〇様」「〇〇さま、」「〇〇さん」
             r'^[^\n、。,，!！]{0,40}?(?:(?:様|さま)([ \t　、,，。\n]|$)|さん[ \t　]*[、,，。]?[ \t　]*(\n|$))', r'{{候補者名}}様\1\2'),
             -- 1 行目の「Dear 〇〇,」「Hi 〇〇,」
             r'^(?i:(Dear|Hi|Hello|Hey))[ \t]+[^\n,!:.]{1,40}?[ \t]*[,!:.]?[ \t]*(\n|$)', r'\1 {{候補者名}},\2') AS norm
    FROM f
    WHERE NULLIF(b, '') IS NOT NULL;

    -- 06. 文面 = 企業 × 空白を除いた本文（宛名をそろえた後）が同じもの ---------------------------------------------------
    CREATE TEMP TABLE sc_tmpl AS
    SELECT sc.scout_id, TO_HEX(MD5(CONCAT(CAST(sc.company_id AS STRING), ':', REGEXP_REPLACE(f.norm, r'[\s　]+', '')))) AS template_id
    FROM sc JOIN first_msg f USING (scout_id);

    CREATE TEMP TABLE tmpl_raw AS
    SELECT t.template_id, sc.company_id,
           ANY_VALUE(sc.industry) AS industry, ANY_VALUE(sc.industry_group) AS industry_group, ANY_VALUE(sc.company_type) AS company_type,
           APPROX_TOP_COUNT(f.subject, 1)[SAFE_OFFSET(0)].value AS subject,
           ANY_VALUE(f.norm HAVING MIN sc.scout_id) AS norm,
           MIN(sc.sent_date) AS first_sent_on, MAX(sc.sent_date) AS last_sent_on,
           COUNT(*) AS sends_total, COUNTIF(sc.replied) AS replies_total, COUNTIF(sc.hired) AS hires_total, COUNTIF(sc.is_auto) AS auto_sends
    FROM sc
    JOIN sc_tmpl t USING (scout_id)
    JOIN first_msg f USING (scout_id)
    GROUP BY 1, 2;

    -- 07. cms_ai_scout_templates: 置き換え（社名・URL・メールアドレス・電話番号・ほかの社名・担当者名の目安）と、特徴のフラグ ----------
    CREATE OR REPLACE TABLE `bq-hgt.dwh.cms_ai_scout_templates`
    CLUSTER BY industry_group, industry
    OPTIONS (description = '契約企業マネジメントシステム AI: スカウトの文面（企業 × 空白を除いた本文が同じもの。直近 13 か月 + 当月に送った最初の 1 通）。本文は社名・URL・メールアドレス・電話番号を記号に置き換え済み。毎朝 全件差し替え') AS
    WITH masked AS (
      SELECT r.* EXCEPT (subject, norm),
             -- 件名
             REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
               COALESCE(SAFE.REGEXP_REPLACE(IFNULL(r.subject, ''), n.name_re, '{{企業名}}'), IFNULL(r.subject, '')),
               CONCAT(r'(?:', corp_re, r')[\s　]*\{\{企業名\}\}|\{\{企業名\}\}[\s　]*(?:', corp_re, ')'), '{{企業名}}'),
               CONCAT(r'(?:', corp_re, r')[\s　]?[^\s　、。,，（()）「」『』【】・/\n]{1,20}|[\p{Han}\p{Katakana}ーA-Za-z0-9Ａ-Ｚａ-ｚ０-９＆&.]{1,20}[ 　]?(?:', corp_re, ')'), '{{社名}}'),
               r'[0-9０-９]{5,8}[\s　]*(?:様|さま)', '{{候補者名}}様') AS subject,
             -- 本文（順番: URL・メールアドレス・電話番号を先に置き換える。社名を先に置き換えると、社名を含むアドレスが残る）
             REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
               COALESCE(SAFE.REGEXP_REPLACE(
                 REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
                   r.norm,
                   -- URL（http・www。「∕」「․」などの似た記号で書いたものも）
                   r'(?i)(?:https?[:：][/∕／]{2}|www[.․])[^\s　<>"）)」』】]+', '{{URL}}'),
                   -- メールアドレス
                   r'[A-Za-z0-9._%+\-]+[ \t]?[@＠][ \t]?[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+', '{{メールアドレス}}'),
                   -- SNS などのアカウント名（@name）
                   r'[@＠][A-Za-z0-9_.\-]{3,}', '{{アカウント}}'),
                   -- 電話番号
                   r'(?:\+81[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4})|(?:\(?0\d{1,4}\)?[-\s‐－]\d{1,4}[-\s‐－]\d{3,4})', '{{電話番号}}'),
                 n.name_re, '{{企業名}}'),
                 REGEXP_REPLACE(REGEXP_REPLACE(r.norm, r'(?i)(?:https?[:：][/∕／]{2}|www[.․])[^\s　<>"）)」』】]+', '{{URL}}'), r'[A-Za-z0-9._%+\-]+[ \t]?[@＠][ \t]?[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+', '{{メールアドレス}}')),
               -- 「株式会社{{企業名}}」→「{{企業名}}」
               CONCAT(r'(?:', corp_re, r')[\s　]*\{\{企業名\}\}|\{\{企業名\}\}[\s　]*(?:', corp_re, ')'), '{{企業名}}'),
               -- ほかの社名（求人元・グループ会社など。法人格の前後の語）
               CONCAT(r'(?:', corp_re, r')[\s　]?[^\s　、。,，（()）「」『』【】・/\n]{1,20}|[\p{Han}\p{Katakana}ーA-Za-z0-9Ａ-Ｚａ-ｚ０-９＆&.]{1,20}[ 　]?(?:', corp_re, ')'), '{{社名}}'),
               r'(?:[A-Z][A-Za-z0-9&.\-]*[ \t]){1,4}(?:Co\.,?[ \t]?Ltd\.?|Inc\.|K\.K\.|Corporation|Corp\.|G\.K\.|LLC|Ltd\.)', '{{社名}}'),
               -- 残った法人格（前後の語を特定できなかったもの）
               corp_re, '{{社名}}'),
               -- 担当者名の目安（「担当: 〇〇」「〇〇と申します」「My name is 〇〇」）
               r'((?:担当者?|採用担当|人事担当|リクルーター|コンサルタント)[\s　]*[:：][\s　]*)[^\s　\n、。]{1,12}(?:[ 　][^\s　\n、。]{1,8})?', r'\1{{担当者名}}'),
               r'([のは、,\s　])[\p{Han}\p{Katakana}ー]{1,8}[ 　]?[\p{Han}\p{Katakana}ーA-Za-z]{0,8}((?:と|ともう)申します|ともうします|でございます。)', r'\1{{担当者名}}\2'),
               r'((?:[Mm]y name is|[Tt]his is)[ \t]+)[A-Z][A-Za-z\-]+(?:[ \t][A-Z][A-Za-z\-]+)?', r'\1{{担当者名}}') AS body
      FROM tmpl_raw r
      LEFT JOIN co_names n USING (company_id)
    )
    SELECT template_id, company_id, industry, industry_group, company_type, subject, body,
           IF(SAFE_DIVIDE(CHAR_LENGTH(REGEXP_REPLACE(body, r'[^\p{Hiragana}\p{Katakana}\p{Han}]', '')), NULLIF(CHAR_LENGTH(REGEXP_REPLACE(body, r'[\s　]+', '')), 0)) >= 0.2, 'ja', 'en') AS lang,
           CHAR_LENGTH(body) AS body_chars, CHAR_LENGTH(subject) AS subject_chars,
           ARRAY_LENGTH(REGEXP_EXTRACT_ALL(body, r'(?m)^[^\n]*\S[^\n]*$')) AS line_count,
           -- 特徴のフラグ（正規表現は README）
           REGEXP_CONTAINS(body, r'(?i)(?:年収|月給|月収|給与|時給|賞与|想定年俸|年俸)[^\n]{0,20}[0-9０-９]|[0-9０-９][0-9０-９,，.]*[ \t]*(?:万円|万|円|M[ \t]?JPY|million|JPY|yen)|[¥￥][ \t]?[0-9０-９]|JPY[ \t]?[0-9]|salary[^\n]{0,30}[0-9]') AS has_salary,
           REGEXP_CONTAINS(body, r'(?i)勤務地|就業場所|最寄|[\p{Han}]駅|東京|大阪|名古屋|福岡|横浜|京都|神戸|札幌|仙台|[都道府県市区]内|location|based in|Tokyo|Osaka|Yokohama|Nagoya|Fukuoka|Kyoto|Kobe|Sapporo') AS has_location,
           ARRAY_LENGTH(REGEXP_EXTRACT_ALL(body, r'(?m)^[ \t　]*(?:[・●○■□◆◇◎▼▶►✓✔※★☆*•–\-]|[0-9０-９]{1,2}[.)．）]|[①-⑳]|【)')) >= 3 AS has_bullets,
           REGEXP_CONTAINS(body, r'(?i)ご経歴|ご経験|レジュメ|履歴書|職務経歴|プロフィール|拝見|your (?:profile|experience|background|resume|résumé|cv|skills?|career)|came across|impressed') AS has_why_you,
           REGEXP_CONTAINS(body, r'\{\{URL\}\}') AS has_job_url,
           REGEXP_CONTAINS(body, r'(?i)弊社は|当社は|私たちは|私どもは|弊社について|会社概要|事業内容|設立|創業|従業員|we are an?|our company|about us|founded in|established in|headquartered') AS has_company_intro,
           REGEXP_CONTAINS(body, r'(?i)興味あり|ご興味|ご返信|お返事|お気軽に|ご連絡(?:を)?(?:お待ち|ください|下さい|いただけ)|ご応募|reply|interested|let (?:me|us) know|feel free|get in touch|look(?:ing)? forward to hearing|apply') AS has_cta,
           REGEXP_CONTAINS(body, r'(?i)リモート|在宅|テレワーク|ハイブリッド|フルフレックス|フレックス|remote|work(?:ing)? from home|\bWFH\b|hybrid|flex(?:ible)? (?:time|hours|work)') AS has_remote,
           REGEXP_CONTAINS(CONCAT(subject, '\n', body), r'(?i)急募|至急|早期|期間限定|限定|締切|締め切り|先着|urgent|immediate(?:ly)?|\bASAP\b|limited|deadline') AS has_urgency,
           REGEXP_CONTAINS(subject, r'【[^】]+】|\[[^\]]+\]|≪[^≫]+≫|＜[^＞]+＞') AS has_brackets_subject,
           REGEXP_CONTAINS(body, r'(?i)福利厚生|休日|休暇|残業|ビザ|手当|賞与|ボーナス|社会保険|visa|benefits?|bonus|allowance|paid leave|holidays?') AS has_benefits,
           REGEXP_CONTAINS(body, r'(?i)面談|面接確約|書類選考なし|カジュアル|オンラインで(?:お話|ご説明)|お話(?:し)?(?:できれば|させて)|interview|casual (?:chat|talk|meeting)|(?:quick|short|brief) (?:call|chat)|schedule a (?:call|meeting)') AS has_meeting_offer,
           first_sent_on, last_sent_on, sends_total, replies_total, hires_total,
           SAFE_DIVIDE(auto_sends, sends_total) AS auto_share,
           CURRENT_TIMESTAMP() AS refreshed_at
    FROM masked;

    -- 08a. 会員の最新のスナップショット（member_details を読むのはここだけ。08 と 11 で使う） -------------------------------------
    CREATE TEMP TABLE mem_raw AS
    SELECT member_id, country_of_residence, experienced_occupation, desired_occupation, desired_annual_income_yen, retired_on
    FROM `bq-hgt.dwh.member_details`
    QUALIFY ROW_NUMBER() OVER (PARTITION BY member_id ORDER BY recorded_on DESC NULLS LAST) = 1;

    -- 08. cms_ai_scout_sends: スカウト 1 通 = 1 行 + 受け取った人の属性（現在のプロフィール。既存マートと同じ決め方） ------------------
    CREATE OR REPLACE TABLE `bq-hgt.dwh.cms_ai_scout_sends`
    PARTITION BY DATE_TRUNC(sent_date, MONTH)
    CLUSTER BY industry_group, industry, template_id
    OPTIONS (description = '契約企業マネジメントシステム AI: スカウト 1 通 = 1 行（直近 13 か月 + 当月。文面 template_id・興味あり返信・採用・受け取った人の属性）。毎朝 全件差し替え') AS
    SELECT sc.scout_id, t.template_id, sc.company_id, sc.industry, sc.industry_group, sc.sent_date, sc.is_auto, sc.replied, sc.hired,
           IFNULL(v.age_group, '(未入力)') AS age_group,
           IFNULL(v.nationality_category, '(未入力)') AS nationality_category,
           IFNULL(v.japanese_level, '(未入力)') AS japanese_level,
           IFNULL(v.english_level, '(未入力)') AS english_level,
           CASE
             WHEN r.country_of_residence IS NULL OR TRIM(r.country_of_residence) = '' THEN '(未入力)'
             WHEN NOT STARTS_WITH(r.country_of_residence, '日本') THEN '日本以外'
             ELSE COALESCE(NULLIF(REGEXP_EXTRACT(r.country_of_residence, r'^日本[\s\x{3000}]+(\S+)'), ''), '日本（都道府県不明）')
           END AS residence,
           IFNULL(v.last_occupation, '(未入力)') AS occupation_group
    FROM sc
    JOIN sc_tmpl t USING (scout_id)
    LEFT JOIN `bq-hgt.dwh.member_profile_latest` v USING (member_id)
    LEFT JOIN mem_raw r USING (member_id);

    -- 09. cms_ai_scout_draft_outcomes: CS が選んだ案と、送信実績の照合 -------------------------------------------------------
    --   同じ企業が、選んだ日以降に初めて送った文面のうち、案の本文の「意味のある行」（空白を除いて 15 文字以上。差し込み {{…}} を含む行は除く）の
    --   50% 以上を、空白を除いた本文（置き換え前）の中にそのまま含むもの。その文面の、選んだ日以降の送信・返信・採用を合計する
    CREATE OR REPLACE TABLE `bq-hgt.dwh.cms_ai_scout_draft_outcomes`
    OPTIONS (description = '契約企業マネジメントシステム AI: CS が選んだ案（cms_ai_scout_drafts）と送信実績の照合（案 = 1 行）。毎朝 全件差し替え') AS
    WITH d AS (
      SELECT draft_id, company_id, DATE(chosen_at, 'Asia/Tokyo') AS chosen_on,
             ARRAY(SELECT k FROM (SELECT REGEXP_REPLACE(l, r'[\s　]+', '') AS k FROM UNNEST(SPLIT(IFNULL(body, ''), '\n')) AS l WHERE NOT REGEXP_CONTAINS(l, r'\{\{')) WHERE CHAR_LENGTH(k) >= 15) AS lines
      FROM `bq-hgt.dwh.cms_ai_scout_drafts`
      WHERE draft_id IS NOT NULL
      QUALIFY ROW_NUMBER() OVER (PARTITION BY draft_id ORDER BY updated_at DESC NULLS LAST) = 1
    ),
    cand AS (
      SELECT d.draft_id, d.chosen_on, t.template_id, ARRAY_LENGTH(d.lines) AS n_lines,
             (SELECT COUNTIF(STRPOS(REGEXP_REPLACE(t.norm, r'[\s　]+', ''), k) > 0) FROM UNNEST(d.lines) AS k) AS hit
      FROM d
      JOIN tmpl_raw t ON t.company_id = d.company_id AND t.first_sent_on >= d.chosen_on
    ),
    hit AS (
      SELECT draft_id, chosen_on, template_id FROM cand WHERE n_lines > 0 AND hit * 2 >= n_lines
    ),
    agg AS (
      SELECT h.draft_id, COUNT(DISTINCT h.template_id) AS matched_templates,
             COUNT(s.scout_id) AS sends, COUNTIF(s.replied) AS replies, COUNTIF(s.hired) AS hires, MIN(s.sent_date) AS first_sent_on
      FROM hit h
      JOIN `bq-hgt.dwh.cms_ai_scout_sends` s ON s.template_id = h.template_id AND s.sent_date >= h.chosen_on
      GROUP BY 1
    )
    SELECT d.draft_id, (a.draft_id IS NOT NULL) AS matched, IFNULL(a.matched_templates, 0) AS matched_templates,
           IFNULL(a.sends, 0) AS sends, IFNULL(a.replies, 0) AS replies, IFNULL(a.hires, 0) AS hires, a.first_sent_on,
           CURRENT_TIMESTAMP() AS refreshed_at
    FROM d
    LEFT JOIN agg a USING (draft_id);

    -- 10. cms_ai_jobs: 求人の内容（求人 = 1 行。求人 ID からの文面の作成用）。条件の列は既存マート cms_company_job_monthly と同じ決め方 ----
    --   タイトル・仕事内容・応募条件は、スカウトの文面（07）と同じ置き換え（URL・メールアドレス・電話番号 → 記号、その企業の社名 → {{企業名}}、
    --   求人元（client_company_name）・ほかの社名 → {{社名}}）。本文は先頭 3,000 文字まで（Worker が読むのは先頭 1,500 文字）
    CREATE OR REPLACE TABLE `bq-hgt.dwh.cms_ai_jobs`
    CLUSTER BY job_id
    OPTIONS (description = '契約企業マネジメントシステム AI: 求人の内容（求人 = 1 行。マートに居る企業の求人のうち、直近 13 か月 + 当月に掲載があったもの）。タイトル・仕事内容・応募条件は社名・URL・メールアドレス・電話番号を記号に置き換え済み。毎朝 全件差し替え') AS
    WITH txt AS (
      SELECT jb.job_id, jb.company_id, k.kind, TRIM(REGEXP_REPLACE(k.t, r'\r\n?', '\n')) AS t,
             -- 求人元の社名（かっこ書き・前後の法人格を除いた形）→ 正規表現。2 文字（英数字だけなら 3 文字）に満たないものは使わない
             (SELECT IF(CHAR_LENGTH(c) >= IF(REGEXP_CONTAINS(c, r'[^\x00-\x7F]'), 2, 3),
                        CONCAT('(?i)', REGEXP_REPLACE(REGEXP_REPLACE(c, r'([\\.^$|?*+()\[\]{}\-])', r'\\\1'), r'[\s　]+', r'[\\s　]*')), NULL)
              FROM (SELECT TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(IFNULL(jb.client_company_name, ''), r'[（(【\[][^）)】\]]*[）)】\]]', ''),
                                CONCAT(corp_re, r'|(?i)[,\s]*\b(co\.?,?\s*ltd\.?|inc\.?|k\.k\.?|corporation|corp\.?|g\.k\.?|llc|ltd\.?|limited)$'), ''), r'^[\s　,、.]+|[\s　,、.]+$', '')) AS c)) AS client_re
      FROM jb, UNNEST([STRUCT('title' AS kind, jb.position_name AS t), ('description', jb.job_description), ('requirements', jb.application_condition)]) AS k
      WHERE NULLIF(TRIM(k.t), '') IS NOT NULL
    ),
    m1 AS (
      -- URL・メールアドレス・アカウント名・電話番号（社名より先。社名を先に置き換えると、社名を含むアドレスが残る）
      SELECT x.job_id, x.company_id, x.kind, x.client_re,
             REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
               x.t,
               r'(?i)(?:https?[:：][/∕／]{2}|www[.․])[^\s　<>"）)」』】]+', '{{URL}}'),
               r'[A-Za-z0-9._%+\-]+[ \t]?[@＠][ \t]?[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+', '{{メールアドレス}}'),
               r'[@＠][A-Za-z0-9_.\-]{3,}', '{{アカウント}}'),
               r'(?:\+81[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4})|(?:\(?0\d{1,4}\)?[-\s‐－]\d{1,4}[-\s‐－]\d{3,4})', '{{電話番号}}') AS t
      FROM txt x
    ),
    m2 AS (
      -- その企業の社名 → {{企業名}}、求人元の社名 → {{社名}}（正規表現が壊れているときは、置き換えずに先へ進む）
      SELECT x.job_id, x.kind,
             COALESCE(SAFE.REGEXP_REPLACE(COALESCE(SAFE.REGEXP_REPLACE(x.t, n.name_re, '{{企業名}}'), x.t), x.client_re, '{{社名}}'),
                      COALESCE(SAFE.REGEXP_REPLACE(x.t, n.name_re, '{{企業名}}'), x.t)) AS t
      FROM m1 x
      LEFT JOIN co_names n USING (company_id)
    ),
    masked AS (
      SELECT job_id, kind,
             REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
               t,
               -- 「株式会社{{企業名}}」→「{{企業名}}」、「株式会社{{社名}}」→「{{社名}}」
               CONCAT(r'(?:', corp_re, r')[\s　]*\{\{企業名\}\}|\{\{企業名\}\}[\s　]*(?:', corp_re, ')'), '{{企業名}}'),
               CONCAT(r'(?:', corp_re, r')[\s　]*\{\{社名\}\}|\{\{社名\}\}[\s　]*(?:', corp_re, ')'), '{{社名}}'),
               -- ほかの社名（法人格の前後の語）
               CONCAT(r'(?:', corp_re, r')[\s　]?[^\s　、。,，（()）「」『』【】・/\n{}]{1,20}|[\p{Han}\p{Katakana}ーA-Za-z0-9Ａ-Ｚａ-ｚ０-９＆&.]{1,20}[ 　]?(?:', corp_re, ')'), '{{社名}}'),
               r'(?:[A-Z][A-Za-z0-9&.\-]*[ \t]){1,4}(?:Co\.,?[ \t]?Ltd\.?|Inc\.|K\.K\.|Corporation|Corp\.|G\.K\.|LLC|Ltd\.)', '{{社名}}'),
               -- 残った法人格
               corp_re, '{{社名}}'),
               -- 担当者名の目安（「担当: 〇〇」）
               r'((?:担当者?|採用担当|人事担当|リクルーター|コンサルタント)[\s　]*[:：][\s　]*)[^\s　\n、。]{1,12}(?:[ 　][^\s　\n、。]{1,8})?', r'\1{{担当者名}}') AS t
      FROM m2
    ),
    piv AS (
      SELECT job_id,
             MAX(IF(kind = 'title', t, NULL)) AS title,
             MAX(IF(kind = 'description', SUBSTR(t, 1, 3000), NULL)) AS description,
             MAX(IF(kind = 'requirements', SUBSTR(t, 1, 3000), NULL)) AS requirements
      FROM masked
      GROUP BY 1
    )
    SELECT jb.job_id, jb.company_id,
           IFNULL(p.title, '') AS title,
           -- 職種・業界・語学（既存マートの求人の条件と同じ値。未設定・(未選択) は NULL）
           NULLIF(TRIM(jb.occupation), '') AS occupation,
           NULLIF(TRIM(jb.industry), '') AS industry,
           -- 勤務地 = 国が 日本 なら都道府県（無ければエリア → '日本'）、日本以外なら国名
           CASE
             WHEN NULLIF(TRIM(jb.work_location1_country), '') IS NULL THEN NULL
             WHEN jb.work_location1_country = '日本' THEN COALESCE(NULLIF(TRIM(jb.work_location1_city), ''), NULLIF(TRIM(jb.work_location1_area), ''), '日本')
             ELSE TRIM(jb.work_location1_country)
           END AS location,
           -- 年収の表示。日本・円 は下限・上限（円）から「500万円〜800万円」「500万円以上」「〜800万円」。円以外の通貨は元の表記。
           -- 「経験と能力に基づく」・未選択・万円に満たない金額（時給など）は NULL
           CASE
             WHEN NULLIF(TRIM(jb.annual_income), '') IS NULL OR jb.annual_income = '(未選択)' OR STARTS_WITH(jb.annual_income, '経験と能力に基づく') THEN NULL
             WHEN NOT STARTS_WITH(jb.annual_income, '日本・円') THEN TRIM(REGEXP_REPLACE(jb.annual_income, r'[\s　]+', ' '))
             WHEN IFNULL(jb.annual_income_min, 0) >= 10000 AND IFNULL(jb.annual_income_max, 0) >= jb.annual_income_min AND jb.annual_income_max != jb.annual_income_min
               THEN CONCAT(CAST(DIV(jb.annual_income_min, 10000) AS STRING), '万円〜', CAST(DIV(jb.annual_income_max, 10000) AS STRING), '万円')
             WHEN IFNULL(jb.annual_income_min, 0) >= 10000 AND IFNULL(jb.annual_income_max, 0) = jb.annual_income_min
               THEN CONCAT(CAST(DIV(jb.annual_income_min, 10000) AS STRING), '万円')
             WHEN IFNULL(jb.annual_income_min, 0) >= 10000 THEN CONCAT(CAST(DIV(jb.annual_income_min, 10000) AS STRING), '万円以上')
             WHEN IFNULL(jb.annual_income_max, 0) >= 10000 THEN CONCAT('〜', CAST(DIV(jb.annual_income_max, 10000) AS STRING), '万円')
             ELSE NULL
           END AS salary,
           IF(NULLIF(TRIM(jb.japanese_level), '') IS NULL OR jb.japanese_level = '(未選択)', NULL, TRIM(jb.japanese_level)) AS japanese_level,
           IF(NULLIF(TRIM(jb.english_level), '') IS NULL OR jb.english_level = '(未選択)', NULL, TRIM(jb.english_level)) AS english_level,
           jb.published,
           IFNULL(p.description, '') AS description,
           IFNULL(p.requirements, '') AS requirements,
           jb.updated_on,
           CURRENT_TIMESTAMP() AS refreshed_at
    FROM jb
    LEFT JOIN piv p USING (job_id);

    -- 11. cms_ai_member_profiles: 候補者の属性（会員 = 1 行。会員 ID からの文面の作成用）。退会した会員（retired_on あり）は入れない ----
    --   年齢層・国籍の区分・語学・現住所・最終経験職種の大分類は cms_ai_scout_sends（08）と同じ値（候補者の属性から、分析対象の条件を作るため）。
    --   経験職種・希望職種・希望年収帯は cms_scout_member_attributes_monthly と同じ決め方。氏名・連絡先・自由記述（職務経歴・スキル）は入れない
    CREATE OR REPLACE TABLE `bq-hgt.dwh.cms_ai_member_profiles`
    CLUSTER BY member_id
    OPTIONS (description = '契約企業マネジメントシステム AI: 候補者の属性（会員 = 1 行。退会した会員は除く。現在のプロフィール）。値は cms_ai_scout_sends の属性と同じ。氏名・連絡先・自由記述は無い。毎朝 全件差し替え') AS
    SELECT v.member_id,
           IFNULL(v.age_group, '(未入力)') AS age_group,
           IFNULL(v.nationality_category, '(未入力)') AS nationality_category,
           IFNULL(v.japanese_level, '(未入力)') AS japanese_level,
           IFNULL(v.english_level, '(未入力)') AS english_level,
           CASE
             WHEN r.country_of_residence IS NULL OR TRIM(r.country_of_residence) = '' THEN '(未入力)'
             WHEN NOT STARTS_WITH(r.country_of_residence, '日本') THEN '日本以外'
             ELSE COALESCE(NULLIF(REGEXP_EXTRACT(r.country_of_residence, r'^日本[\s\x{3000}]+(\S+)'), ''), '日本（都道府県不明）')
           END AS residence,
           IFNULL(v.last_occupation, '(未入力)') AS occupation_group,
           IFNULL(v.last_industry, '(未入力)') AS last_industry,
           IFNULL(v.last_career_level, '(未入力)') AS career_level,
           -- 経験職種・希望職種の大分類（「大分類 - 小分類」をカンマでつないだ列の、大分類だけ。入力の順・重複なし・12 個まで）
           ARRAY(SELECT o FROM (SELECT TRIM(SPLIT(x, ' - ')[SAFE_OFFSET(0)]) AS o, MIN(i) AS i FROM UNNEST(SPLIT(IFNULL(r.experienced_occupation, ''), ',')) AS x WITH OFFSET i WHERE TRIM(x) != '' GROUP BY 1) WHERE o != '' ORDER BY i LIMIT 12) AS experienced_occupations,
           ARRAY(SELECT o FROM (SELECT TRIM(SPLIT(x, ' - ')[SAFE_OFFSET(0)]) AS o, MIN(i) AS i FROM UNNEST(SPLIT(IFNULL(r.desired_occupation, ''), ',')) AS x WITH OFFSET i WHERE TRIM(x) != '' GROUP BY 1) WHERE o != '' ORDER BY i LIMIT 12) AS desired_occupations,
           IFNULL(v.annual_income_range, '(未入力)') AS income_range,
           CASE WHEN SAFE_CAST(r.desired_annual_income_yen AS FLOAT64) IS NULL OR SAFE_CAST(r.desired_annual_income_yen AS FLOAT64) <= 0 THEN '(未入力)'
                WHEN SAFE_CAST(r.desired_annual_income_yen AS FLOAT64) <= 3000000 THEN '300万円以下'
                WHEN SAFE_CAST(r.desired_annual_income_yen AS FLOAT64) <= 5000000 THEN '301万円〜500万円'
                WHEN SAFE_CAST(r.desired_annual_income_yen AS FLOAT64) <= 8000000 THEN '501万円〜800万円'
                ELSE '801万円以上' END AS desired_income_range,
           CURRENT_TIMESTAMP() AS refreshed_at
    FROM `bq-hgt.dwh.member_profile_latest` v
    JOIN mem_raw r USING (member_id)
    WHERE r.retired_on IS NULL;

    -- 12. 実行記録 ---------------------------------------------------------------------------------------------------------
    INSERT INTO `bq-hgt.dwh.cms_ai_refresh_log` (run_date, step, status, message, started_at, finished_at)
    SELECT run_date, 'scout_marts', 'ok',
           CONCAT('templates=', CAST((SELECT COUNT(*) FROM `bq-hgt.dwh.cms_ai_scout_templates`) AS STRING),
                  '; sends=', CAST((SELECT COUNT(*) FROM `bq-hgt.dwh.cms_ai_scout_sends`) AS STRING),
                  '; scouts_without_body=', CAST((SELECT COUNT(*) FROM sc) - (SELECT COUNT(*) FROM sc_tmpl) AS STRING),
                  '; name_re_invalid=', CAST((SELECT COUNTIF(NOT name_re_ok) FROM co_names) AS STRING),
                  '; drafts=', CAST((SELECT COUNT(*) FROM `bq-hgt.dwh.cms_ai_scout_draft_outcomes`) AS STRING),
                  '; matched=', CAST((SELECT COUNTIF(matched) FROM `bq-hgt.dwh.cms_ai_scout_draft_outcomes`) AS STRING),
                  '; jobs=', CAST((SELECT COUNT(*) FROM `bq-hgt.dwh.cms_ai_jobs`) AS STRING),
                  '; members=', CAST((SELECT COUNT(*) FROM `bq-hgt.dwh.cms_ai_member_profiles`) AS STRING)),
           t0, CURRENT_TIMESTAMP();
  EXCEPTION WHEN ERROR THEN
    INSERT INTO `bq-hgt.dwh.cms_ai_refresh_log` (run_date, step, status, message, started_at, finished_at)
    VALUES (run_date, 'scout_marts', 'error', @@error.message, t0, CURRENT_TIMESTAMP());
    RAISE;
  END;
END;
