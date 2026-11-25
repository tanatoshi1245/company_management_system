-- 目的: ③ 求人の AI 添削で、添削する求人（掲載中の求人から選んだもの = input.jobKey）の中身を読む。
--   その企業（@company_id）の求人であることを、SQL の中で確かめる（求人のプロファイルが、その企業のプロファイルであること）。
--   ほかの企業の求人キーを渡しても 0 行になる。日英のセットは、言語ごとに 1 行ずつ返す。
--   本文の中の企業名・URL・メールアドレス・電話番号は差し込みの記号に置き換える（目安）。
--
-- param: company_id INT64 required
-- param: job_key STRING required
-- param: months INT64 default=6 min=1 max=12
-- param: max_chars INT64 default=6000 min=200 max=6000
-- max_bytes: 3GB
--   （jobs_all の仕事内容・応募条件を 1 回読む = 約 1.3GB）
--
-- パラメータ:
--   company_id … 依頼の企業（context の company.id）
--   job_key    … 求人キー（context の input.jobKey。set_id、無ければ job_id の数字）
--   months     … 閲覧・応募を数える期間（当月 + 直近 N か月）
--   max_chars  … 仕事内容・応募条件を返す長さ（それぞれ先頭から）
--
-- 返す列（言語ごとに 1 行。その企業の求人でなければ 0 行）:
--   language          'ja'（仕事内容にかなを含む）/ 'en'
--   title / occupation / japanese_level / english_level   求人タイトル・職種・必要な語学レベル
--   salary / location                年収（表示の文字）・勤務地（都道府県、無ければエリア・国）
--   publish_status                   掲載の状態
--   description / requirements       仕事内容・応募条件（それぞれ先頭 max_chars 文字）
--   description_chars / requirements_chars   全体の文字数
--   period_from                      閲覧・応募を数えた最初の月（当月まで）
--   views / applications / rate_pct  期間の閲覧・応募・率（%・小数 1 桁。求人キー単位 = 日英の合計。記録が無ければ NULL）
WITH cfg AS (
  SELECT DATE_SUB(DATE_TRUNC(CURRENT_DATE('Asia/Tokyo'), MONTH), INTERVAL @months MONTH) AS from_month
),
own AS (
  SELECT m.company_id, pid AS profile_id,
         NULLIF(TRIM(m.company_name), '') AS full_name,
         NULLIF(TRIM(REGEXP_REPLACE(m.company_name, r'株式会社|有限会社|合同会社|㈱|\(株\)|（株）|[\s　]', '')), '') AS core_name
  FROM `bq-hgt.dwh.cms_company_master` m, UNNEST(m.profile_ids) AS pid
  WHERE m.company_id = @company_id
),
jl AS (
  SELECT job_id, set_id, profile_id, recorded_on, position_name, occupation, japanese_level, english_level, annual_income,
         work_location1_country, work_location1_area, work_location1_city, publish_status, job_description, application_condition
  FROM `bq-hgt.dwh.jobs_all`
  WHERE job_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY recorded_on DESC NULLS LAST) = 1
),
mine AS (
  SELECT j.*, o.full_name, o.core_name,
         IF(REGEXP_CONTAINS(IFNULL(j.job_description, ''), r'[ぁ-んァ-ヶ]'), 'ja', 'en') AS language
  FROM jl j
  JOIN own o USING (profile_id)
  WHERE CAST(COALESCE(j.set_id, j.job_id) AS STRING) = @job_key
  QUALIFY ROW_NUMBER() OVER (PARTITION BY IF(REGEXP_CONTAINS(IFNULL(j.job_description, ''), r'[ぁ-んァ-ヶ]'), 'ja', 'en') ORDER BY j.recorded_on DESC, j.job_id DESC) = 1
),
stat AS (
  SELECT SUM(j.job_views) AS views, SUM(j.applications) AS applications
  FROM `bq-hgt.dwh.cms_company_job_monthly` j
  CROSS JOIN cfg
  WHERE j.company_id = @company_id AND j.job_key = @job_key AND j.month >= cfg.from_month
)
SELECT m.language,
       REPLACE(REPLACE(IFNULL(m.position_name, ''), IFNULL(m.full_name, '\u0001'), '{{企業名}}'), IFNULL(IF(CHAR_LENGTH(m.core_name) >= 2, m.core_name, NULL), '\u0001'), '{{企業名}}') AS title,
       m.occupation, m.japanese_level, m.english_level, m.annual_income AS salary,
       COALESCE(NULLIF(TRIM(m.work_location1_city), ''), NULLIF(TRIM(m.work_location1_area), ''), NULLIF(TRIM(m.work_location1_country), '')) AS location,
       m.publish_status,
       SUBSTR(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
         REPLACE(REPLACE(IFNULL(m.job_description, ''), IFNULL(m.full_name, '\u0001'), '{{企業名}}'), IFNULL(IF(CHAR_LENGTH(m.core_name) >= 2, m.core_name, NULL), '\u0001'), '{{企業名}}'),
         r'https?://[^\s　<>"）)]+', '{{URL}}'),
         r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+', '{{メールアドレス}}'),
         r'(\+81[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4})|(\(?0\d{1,4}\)?[-\s]\d{1,4}[-\s]\d{3,4})', '{{電話番号}}'), 1, @max_chars) AS description,
       SUBSTR(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
         REPLACE(REPLACE(IFNULL(m.application_condition, ''), IFNULL(m.full_name, '\u0001'), '{{企業名}}'), IFNULL(IF(CHAR_LENGTH(m.core_name) >= 2, m.core_name, NULL), '\u0001'), '{{企業名}}'),
         r'https?://[^\s　<>"）)]+', '{{URL}}'),
         r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+', '{{メールアドレス}}'),
         r'(\+81[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4})|(\(?0\d{1,4}\)?[-\s]\d{1,4}[-\s]\d{3,4})', '{{電話番号}}'), 1, @max_chars) AS requirements,
       CHAR_LENGTH(IFNULL(m.job_description, '')) AS description_chars,
       CHAR_LENGTH(IFNULL(m.application_condition, '')) AS requirements_chars,
       cfg.from_month AS period_from,
       s.views, s.applications, ROUND(100 * SAFE_DIVIDE(s.applications, s.views), 1) AS rate_pct
FROM mine m
CROSS JOIN cfg
CROSS JOIN stat s
ORDER BY m.language DESC
