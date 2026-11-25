-- 目的: ② スカウト文面の AI 添削 / テンプレート作成の参考。
--   同じ業界（cms_company_master.industry）で、直近 @months か月に手動スカウトを @min_sent 通以上送った企業の
--   返信率（興味あり返信 / 送信。送信月基準）を出し、上位 @top_companies 社について、よく使われた文面
--   （空白を除いて本文が同じものを 1 つにまとめ、通数の多い順に企業ごと上位 @per_company 個）を返す。
--   同じ業界で比較に入る企業が @min_companies 社に満たないときは、全業界へ広げる（summary の scope = 'all'。messages を読み直さずに済ませるため）。
--   対象の企業（@company_id）は比較から除く。@include_own = true のときは、その企業自身の文面も row_type = 'own' で返す。
--   企業名は返さない（順位の番号だけ）。本文の中の企業名・URL・メールアドレス・電話番号は差し込みの記号に置き換える
--   （置き換えは目安。担当者名などは残りうるので、結果をそのまま写さない）。
--
-- param: company_id INT64 required
-- param: industry STRING nullable
-- param: months INT64 default=6 min=1 max=12
-- param: min_sent INT64 default=50 min=1 max=100000
-- param: min_companies INT64 default=8 min=1 max=1000
-- param: top_companies INT64 default=5 min=1 max=10
-- param: per_company INT64 default=3 min=1 max=5
-- param: min_uses INT64 default=3 min=1 max=1000
-- param: max_chars INT64 default=3000 min=200 max=5000
-- param: include_own BOOL default=true
-- max_bytes: 25GB
--   （messages の subject・body を 1 回読む = 約 20GB。messages はパーティションが無いので、期間で絞っても量は変わらない）
--
-- パラメータ:
--   company_id    … 依頼の企業（context の company.id）。比較から除く
--   industry      … 業界（cms_company_master.industry と同じ表記）。渡さなければ全業界
--   months        … 当月 + 直近 N か月（送信日。JST）
--   min_sent      … 比較に入れる企業の最低の送信数（手動スカウト）
--   min_companies … 同じ業界で比較に入る企業がこの数に満たなければ、全業界へ広げる
--   top_companies … 文面を読む企業の数（返信率の高い順）
--   per_company   … 企業ごとに返す文面の数（通数の多い順）
--   min_uses      … 文面として数える最低の通数（1〜2 通だけの個別の文面を外す）
--   max_chars     … 本文を返す長さ（先頭から）
--   include_own   … 依頼の企業自身の文面も返すか
--
-- 返す列（1 行目は必ず row_type = 'summary'）:
--   row_type            'summary' / 'peer'（上位の企業の文面）/ 'own'（依頼の企業自身の文面）
--   scope               'industry'（同じ業界で比べた）/ 'all'（全業界で比べた。業界の指定なし、または同じ業界の企業が min_companies 未満）
--   scope_industry      渡した業界（NULL = 指定なし）
--   industry_eligible_companies   同じ業界で min_sent 以上送った企業数（依頼の企業を除く。業界の指定なしは NULL）   … summary だけ
--   period_from / period_to   送信日の範囲
--   eligible_companies  比較に入れた企業数（min_sent 以上。依頼の企業を除く）   … summary だけ
--   overall_sent / overall_interested / overall_rate_pct   比較に入れた企業の合計と返信率（%・小数 1 桁）   … summary だけ
--   top_companies / top_sent / top_interested / top_rate_pct   上位の企業の数・合計・返信率   … summary だけ
--   company_rank        返信率の順位（1 = 最も高い。own は 0）
--   company_sent / company_interested / company_rate_pct   その企業の送信・興味あり返信・返信率
--   template_rank       企業の中での文面の順位（通数の多い順）
--   template_sent / template_interested / template_rate_pct   その文面の通数・興味あり返信・返信率
--   subject / body / body_chars   件名（その文面で最も多い件名）・本文（先頭 max_chars 文字）・本文の全体の文字数
WITH cfg AS (
  SELECT DATE_SUB(DATE_TRUNC(CURRENT_DATE('Asia/Tokyo'), MONTH), INTERVAL @months MONTH) AS from_date,
         CURRENT_DATE('Asia/Tokyo') AS to_date
),
-- 企業 → プロファイル（マートに居る企業だけ = 社内テストは入らない。RA / RDS は除く）
prof AS (
  SELECT m.company_id, pid AS profile_id, (m.company_id = @company_id) AS is_own, IFNULL(m.industry = @industry, FALSE) AS same_industry
  FROM `bq-hgt.dwh.cms_company_master` m, UNNEST(m.profile_ids) AS pid
  WHERE pid NOT IN (4928, 14508) AND pid != 7080
),
names AS (
  SELECT company_id, NULLIF(TRIM(company_name), '') AS full_name,
         NULLIF(TRIM(REGEXP_REPLACE(company_name, r'株式会社|有限会社|合同会社|㈱|\(株\)|（株）|[\s　]', '')), '') AS core_name
  FROM `bq-hgt.dwh.cms_company_master`
),
first_interest AS (
  SELECT scout_id
  FROM `bq-hgt.dwh.scout_histories`
  WHERE from_status IN ('質問する', '開封のみ') AND to_status = '興味あり'
  GROUP BY 1
),
-- 手動スカウト（自動スカウトを除く）。送信月基準: 期間内に送ったスカウトのうち、興味あり返信があったもの
sc AS (
  SELECT s.scout_id, p.company_id, p.is_own, p.same_industry, (fi.scout_id IS NOT NULL) AS interested
  FROM `bq-hgt.dwh.scouts` s
  JOIN prof p USING (profile_id)
  LEFT JOIN first_interest fi USING (scout_id)
  CROSS JOIN cfg
  WHERE DATE(s.sent_at) BETWEEN cfg.from_date AND cfg.to_date
    AND NOT IFNULL(s.is_auto_scout, FALSE)
),
comp AS (
  SELECT company_id, is_own, same_industry, COUNT(*) AS sent, COUNTIF(interested) AS interested
  FROM sc GROUP BY 1, 2, 3
),
eligible AS (
  SELECT * FROM comp WHERE NOT is_own AND sent >= @min_sent
),
-- 同じ業界の企業が少ないときは全業界で比べる
scope AS (
  SELECT IF(@industry IS NULL, NULL, COUNTIF(same_industry)) AS industry_eligible,
         (@industry IS NULL OR COUNTIF(same_industry) < @min_companies) AS use_all
  FROM eligible
),
peers AS (
  SELECT e.company_id, e.sent, e.interested,
         ROW_NUMBER() OVER (ORDER BY SAFE_DIVIDE(e.interested, e.sent) DESC, e.sent DESC, e.company_id) AS company_rank
  FROM eligible e CROSS JOIN scope
  WHERE scope.use_all OR e.same_industry
),
picked AS (
  SELECT company_id, company_rank, sent, interested, FALSE AS is_own FROM peers WHERE company_rank <= @top_companies
  UNION ALL
  SELECT company_id, 0, sent, interested, TRUE FROM comp WHERE is_own AND @include_own
),
-- スカウトの最初の 1 通（企業から）。messages を読むのはここだけ
first_msg AS (
  SELECT m.scout_id, m.subject, m.body
  FROM `bq-hgt.dwh.messages` m
  WHERE m.scout_id IS NOT NULL AND m.is_from_company = 1
    AND m.scout_id IN (SELECT sc.scout_id FROM sc JOIN picked USING (company_id))
  QUALIFY ROW_NUMBER() OVER (PARTITION BY m.scout_id ORDER BY m.created_at, m.id) = 1
),
tmpl AS (
  SELECT sc.company_id,
         COUNT(*) AS template_sent, COUNTIF(sc.interested) AS template_interested,
         APPROX_TOP_COUNT(TRIM(f.subject), 1)[SAFE_OFFSET(0)].value AS subject,
         ANY_VALUE(f.body) AS body
  FROM sc
  JOIN picked USING (company_id)
  JOIN first_msg f USING (scout_id)
  WHERE NULLIF(TRIM(f.body), '') IS NOT NULL
  GROUP BY sc.company_id, REGEXP_REPLACE(f.body, r'[\s　]+', '')
  HAVING COUNT(*) >= @min_uses
),
tmpl_ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY template_sent DESC, template_interested DESC, subject) AS template_rank
  FROM tmpl
),
-- 企業名・URL・メールアドレス・電話番号を差し込みの記号へ（目安）
masked AS (
  SELECT t.company_id, t.template_rank, t.template_sent, t.template_interested,
         REPLACE(REPLACE(IFNULL(t.subject, ''), IFNULL(n.full_name, '\u0001'), '{{企業名}}'), IFNULL(IF(CHAR_LENGTH(n.core_name) >= 2, n.core_name, NULL), '\u0001'), '{{企業名}}') AS subject,
         REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
           REPLACE(REPLACE(t.body, IFNULL(n.full_name, '\u0001'), '{{企業名}}'), IFNULL(IF(CHAR_LENGTH(n.core_name) >= 2, n.core_name, NULL), '\u0001'), '{{企業名}}'),
           r'https?://[^\s　<>"）)]+', '{{URL}}'),
           r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+', '{{メールアドレス}}'),
           r'(\+81[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4})|(\(?0\d{1,4}\)?[-\s]\d{1,4}[-\s]\d{3,4})', '{{電話番号}}') AS body
  FROM tmpl_ranked t
  LEFT JOIN names n USING (company_id)
  WHERE t.template_rank <= @per_company
)
SELECT 'summary' AS row_type, IF(scope.use_all, 'all', 'industry') AS scope, @industry AS scope_industry, scope.industry_eligible AS industry_eligible_companies,
       cfg.from_date AS period_from, cfg.to_date AS period_to,
       (SELECT COUNT(*) FROM peers) AS eligible_companies,
       (SELECT SUM(sent) FROM peers) AS overall_sent,
       (SELECT SUM(interested) FROM peers) AS overall_interested,
       (SELECT ROUND(100 * SAFE_DIVIDE(SUM(interested), SUM(sent)), 1) FROM peers) AS overall_rate_pct,
       (SELECT COUNT(*) FROM picked WHERE NOT is_own) AS top_companies,
       (SELECT SUM(sent) FROM picked WHERE NOT is_own) AS top_sent,
       (SELECT SUM(interested) FROM picked WHERE NOT is_own) AS top_interested,
       (SELECT ROUND(100 * SAFE_DIVIDE(SUM(interested), SUM(sent)), 1) FROM picked WHERE NOT is_own) AS top_rate_pct,
       CAST(NULL AS INT64) AS company_rank, CAST(NULL AS INT64) AS company_sent, CAST(NULL AS INT64) AS company_interested, CAST(NULL AS FLOAT64) AS company_rate_pct,
       CAST(NULL AS INT64) AS template_rank, CAST(NULL AS INT64) AS template_sent, CAST(NULL AS INT64) AS template_interested, CAST(NULL AS FLOAT64) AS template_rate_pct,
       CAST(NULL AS STRING) AS subject, CAST(NULL AS STRING) AS body, CAST(NULL AS INT64) AS body_chars
FROM cfg CROSS JOIN scope
UNION ALL
SELECT IF(k.is_own, 'own', 'peer'), IF(scope.use_all, 'all', 'industry'), @industry, NULL, cfg.from_date, cfg.to_date,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       k.company_rank, k.sent, k.interested, ROUND(100 * SAFE_DIVIDE(k.interested, k.sent), 1),
       t.template_rank, t.template_sent, t.template_interested, ROUND(100 * SAFE_DIVIDE(t.template_interested, t.template_sent), 1),
       t.subject, SUBSTR(t.body, 1, @max_chars), CHAR_LENGTH(t.body)
FROM masked t
JOIN picked k USING (company_id)
CROSS JOIN cfg CROSS JOIN scope
ORDER BY (row_type = 'summary') DESC, (row_type = 'own'), company_rank, template_rank
