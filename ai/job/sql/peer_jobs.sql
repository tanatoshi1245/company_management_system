-- 目的: ③ 求人の AI 添削 / 求人票の作成の参考。
--   同じ業界（cms_company_master.industry）・職種（cms_company_job_monthly.job_occupation）で、直近 @months か月の閲覧が
--   @min_views 以上の求人について「閲覧 → 応募」の率（応募 / 閲覧。求人ごとに期間の合計）を出し、上位 @top_jobs 件の
--   タイトル・職種・条件・仕事内容・応募条件を返す。対象の企業（@company_id）の求人は比較から除く。
--   条件に合う求人が @min_jobs 件に満たないときは、順に広げる（summary の scope）:
--     industry_occupation（同じ業界 × 同じ職種）→ occupation（同じ職種・全業界）→ occupation_major（同じ職種の大分類・全業界）
--     → industry（同じ業界・全職種）→ all（全体）
--   企業名・求人の ID は返さない（順位の番号だけ）。本文の中の企業名・URL・メールアドレス・電話番号は差し込みの記号に置き換える
--   （置き換えは目安。残りうるので、結果をそのまま写さない）。
--
-- param: company_id INT64 required
-- param: industry STRING nullable
-- param: occupations ARRAY<STRING> default=[]
-- param: months INT64 default=6 min=1 max=12
-- param: min_views INT64 default=50 min=1 max=100000
-- param: min_jobs INT64 default=20 min=1 max=10000
-- param: top_jobs INT64 default=8 min=1 max=15
-- param: max_chars INT64 default=2500 min=200 max=6000
-- max_bytes: 3GB
--   （jobs_all の仕事内容・応募条件を 1 回読む = 約 1.3GB。マートは数 MB）
--
-- パラメータ:
--   company_id  … 依頼の企業（context の company.id）。比較から除く
--   industry    … 業界（cms_company_master.industry と同じ表記）。渡さなければ業界で絞らない
--   occupations … 職種（何個でも --param occupations=… を並べる。「大分類 - 小分類」か、大分類だけ）。渡さなければ職種で絞らない
--   months      … 当月 + 直近 N か月
--   min_views   … 比較に入れる求人の最低の閲覧数（期間の合計）
--   min_jobs    … 条件に合う求人がこの数に満たなければ、条件を広げる
--   top_jobs    … 返す求人の数（率の高い順）
--   max_chars   … 仕事内容・応募条件を返す長さ（それぞれ先頭から）
--
-- 返す列（1 行目は必ず row_type = 'summary'）:
--   row_type          'summary' / 'peer'
--   scope             比べた範囲（上の 5 つのどれか）
--   scope_industry    渡した業界（NULL = 指定なし）
--   period_from       閲覧・応募を数えた最初の月（当月まで）
--   eligible_jobs / eligible_companies   比べた求人の数・その求人を出している企業の数   … summary だけ
--   overall_views / overall_applications / overall_rate_pct   比べた求人の合計と率（%・小数 1 桁）   … summary だけ
--   top_jobs / top_views / top_applications / top_rate_pct     上位の求人の数・合計・率   … summary だけ
--   job_rank          率の順位（1 = 最も高い）
--   title / occupation / japanese_level / english_level / location / salary_band   求人のタイトルと条件（マートの値）
--   views / applications / rate_pct   その求人の閲覧・応募・率
--   language          本文の言語（'ja' = かなを含む / 'en'）。日英のセットは日本語を優先
--   description / requirements        仕事内容・応募条件（それぞれ先頭 max_chars 文字）
--   description_chars / requirements_chars   全体の文字数
WITH cfg AS (
  SELECT DATE_SUB(DATE_TRUNC(CURRENT_DATE('Asia/Tokyo'), MONTH), INTERVAL @months MONTH) AS from_month
),
comp AS (
  SELECT company_id, IFNULL(industry = @industry, FALSE) AS same_industry,
         NULLIF(TRIM(company_name), '') AS full_name,
         NULLIF(TRIM(REGEXP_REPLACE(company_name, r'株式会社|有限会社|合同会社|㈱|\(株\)|（株）|[\s　]', '')), '') AS core_name
  FROM `bq-hgt.dwh.cms_company_master`
  WHERE company_id != @company_id
),
majors AS (
  SELECT DISTINCT TRIM(SPLIT(o, ' - ')[OFFSET(0)]) AS major FROM UNNEST(@occupations) AS o
),
-- 求人ごとの合計（アカウント種別をまたいで合算。企業への直接応募の行は求人ではないので除く）
agg AS (
  SELECT j.company_id, j.job_key,
         ARRAY_AGG(STRUCT(j.job_title, j.job_occupation, j.job_japanese_level, j.job_english_level, j.job_location, j.job_salary_band) ORDER BY j.month DESC LIMIT 1)[OFFSET(0)] AS a,
         SUM(j.job_views) AS views, SUM(j.applications) AS applications
  FROM `bq-hgt.dwh.cms_company_job_monthly` j
  CROSS JOIN cfg
  WHERE j.month >= cfg.from_month AND NOT j.is_direct
  GROUP BY 1, 2
  HAVING SUM(j.job_views) >= @min_views
),
flagged AS (
  SELECT g.*, c.same_industry, c.full_name, c.core_name,
         EXISTS (SELECT 1 FROM UNNEST(@occupations) AS o WHERE g.a.job_occupation = o OR STARTS_WITH(g.a.job_occupation, CONCAT(o, ' - '))) AS same_occ,
         TRIM(SPLIT(g.a.job_occupation, ' - ')[OFFSET(0)]) IN (SELECT major FROM majors) AS same_major
  FROM agg g
  JOIN comp c USING (company_id)
),
-- 広げ方の段（1 = 最も狭い）。件数が min_jobs 以上になる最初の段を使う
lv AS (
  SELECT CASE
           WHEN COUNTIF(same_industry AND same_occ) >= @min_jobs THEN 1
           WHEN COUNTIF(same_occ) >= @min_jobs THEN 2
           WHEN COUNTIF(same_major) >= @min_jobs THEN 3
           WHEN COUNTIF(same_industry) >= @min_jobs THEN 4
           ELSE 5
         END AS level
  FROM flagged
),
eligible AS (
  SELECT f.*,
         ROW_NUMBER() OVER (ORDER BY SAFE_DIVIDE(f.applications, f.views) DESC, f.views DESC, f.job_key) AS job_rank
  FROM flagged f CROSS JOIN lv
  WHERE CASE lv.level WHEN 1 THEN f.same_industry AND f.same_occ WHEN 2 THEN f.same_occ WHEN 3 THEN f.same_major WHEN 4 THEN f.same_industry ELSE TRUE END
),
top AS (
  SELECT * FROM eligible WHERE job_rank <= @top_jobs
),
-- 求人の本文（job_id ごとに最新のスナップショット → 求人キー（set_id、無ければ job_id）ごとに 1 件。日本語を優先）。jobs_all を読むのはここだけ
txt AS (
  SELECT job_key, job_description, application_condition, has_ja
  FROM (
    SELECT CAST(COALESCE(set_id, job_id) AS STRING) AS job_key, job_description, application_condition, recorded_on,
           REGEXP_CONTAINS(IFNULL(job_description, ''), r'[ぁ-んァ-ヶ]') AS has_ja
    FROM `bq-hgt.dwh.jobs_all`
    WHERE job_id IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY recorded_on DESC NULLS LAST) = 1
  )
  WHERE job_key IN (SELECT job_key FROM top)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY job_key ORDER BY has_ja DESC, recorded_on DESC) = 1
),
masked AS (
  SELECT t.job_rank, t.a, t.views, t.applications, x.has_ja,
         REPLACE(REPLACE(IFNULL(t.a.job_title, ''), IFNULL(t.full_name, '\u0001'), '{{企業名}}'), IFNULL(IF(CHAR_LENGTH(t.core_name) >= 2, t.core_name, NULL), '\u0001'), '{{企業名}}') AS title,
         REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
           REPLACE(REPLACE(IFNULL(x.job_description, ''), IFNULL(t.full_name, '\u0001'), '{{企業名}}'), IFNULL(IF(CHAR_LENGTH(t.core_name) >= 2, t.core_name, NULL), '\u0001'), '{{企業名}}'),
           r'https?://[^\s　<>"）)]+', '{{URL}}'),
           r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+', '{{メールアドレス}}'),
           r'(\+81[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4})|(\(?0\d{1,4}\)?[-\s]\d{1,4}[-\s]\d{3,4})', '{{電話番号}}') AS description,
         REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
           REPLACE(REPLACE(IFNULL(x.application_condition, ''), IFNULL(t.full_name, '\u0001'), '{{企業名}}'), IFNULL(IF(CHAR_LENGTH(t.core_name) >= 2, t.core_name, NULL), '\u0001'), '{{企業名}}'),
           r'https?://[^\s　<>"）)]+', '{{URL}}'),
           r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+', '{{メールアドレス}}'),
           r'(\+81[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4})|(\(?0\d{1,4}\)?[-\s]\d{1,4}[-\s]\d{3,4})', '{{電話番号}}') AS requirements
  FROM top t
  LEFT JOIN txt x USING (job_key)
)
SELECT 'summary' AS row_type,
       CASE lv.level WHEN 1 THEN 'industry_occupation' WHEN 2 THEN 'occupation' WHEN 3 THEN 'occupation_major' WHEN 4 THEN 'industry' ELSE 'all' END AS scope,
       @industry AS scope_industry, cfg.from_month AS period_from,
       (SELECT COUNT(*) FROM eligible) AS eligible_jobs,
       (SELECT COUNT(DISTINCT company_id) FROM eligible) AS eligible_companies,
       (SELECT SUM(views) FROM eligible) AS overall_views,
       (SELECT SUM(applications) FROM eligible) AS overall_applications,
       (SELECT ROUND(100 * SAFE_DIVIDE(SUM(applications), SUM(views)), 1) FROM eligible) AS overall_rate_pct,
       (SELECT COUNT(*) FROM top) AS top_jobs,
       (SELECT SUM(views) FROM top) AS top_views,
       (SELECT SUM(applications) FROM top) AS top_applications,
       (SELECT ROUND(100 * SAFE_DIVIDE(SUM(applications), SUM(views)), 1) FROM top) AS top_rate_pct,
       CAST(NULL AS INT64) AS job_rank, CAST(NULL AS STRING) AS title, CAST(NULL AS STRING) AS occupation,
       CAST(NULL AS STRING) AS japanese_level, CAST(NULL AS STRING) AS english_level, CAST(NULL AS STRING) AS location, CAST(NULL AS STRING) AS salary_band,
       CAST(NULL AS INT64) AS views, CAST(NULL AS INT64) AS applications, CAST(NULL AS FLOAT64) AS rate_pct,
       CAST(NULL AS STRING) AS language, CAST(NULL AS STRING) AS description, CAST(NULL AS STRING) AS requirements,
       CAST(NULL AS INT64) AS description_chars, CAST(NULL AS INT64) AS requirements_chars
FROM cfg CROSS JOIN lv
UNION ALL
SELECT 'peer',
       CASE lv.level WHEN 1 THEN 'industry_occupation' WHEN 2 THEN 'occupation' WHEN 3 THEN 'occupation_major' WHEN 4 THEN 'industry' ELSE 'all' END,
       @industry, cfg.from_month,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       m.job_rank, m.title, m.a.job_occupation, m.a.job_japanese_level, m.a.job_english_level, m.a.job_location, m.a.job_salary_band,
       m.views, m.applications, ROUND(100 * SAFE_DIVIDE(m.applications, m.views), 1),
       IF(m.has_ja IS NULL, NULL, IF(m.has_ja, 'ja', 'en')), SUBSTR(m.description, 1, @max_chars), SUBSTR(m.requirements, 1, @max_chars),
       CHAR_LENGTH(m.description), CHAR_LENGTH(m.requirements)
FROM masked m
CROSS JOIN cfg CROSS JOIN lv
ORDER BY (row_type = 'summary') DESC, job_rank
