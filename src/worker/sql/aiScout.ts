import { p, type BuiltQuery } from '../bq/params';
import { SCOUT_MIN_SENDS, SCOUT_MIN_TEMPLATES, SCOUT_RATE_THRESHOLD, SCOUT_TOP_TEMPLATES, SCOUT_WINDOW_MONTHS, type ScoutFilters, type ScoutLang } from '../../shared/ai/scout';
import { DIGEST_BODY_CHARS, DIGEST_MAX, type ScoutDraftExport } from '../ai/scout/dataSource';

/**
 * ② スカウト文面の AI 作成: 日次マート dwh.cms_ai_*（bq/ai/scout_marts.sql）を読む・書く SQL。
 * 値はすべて @param（SQL の本文は固定の文字列。条件の有無で文を組み替えない）。配列の条件は ARRAY<STRING> の @param で渡し、空 = 指定なし。
 * 空の配列は REST では NULL の配列として届くので、IFNULL(ARRAY_LENGTH(@x), 0) = 0 で見る（ARRAY_LENGTH(@x) = 0 だけだと NULL になり、条件なしの送信が 1 通も数えられない）。
 * スキャン量（2026-11-27 実測）は bq/README.md。表が小さいので、どの照会も 1 回 約 100 MB 以下。
 */

/** 特徴のフラグ（マートの列 → 画面に出す名前）。列を足すときは、マート（bq/ai/scout_marts.sql）・下の SQL・ここを一緒に直す */
export const SCOUT_FEATURES = [
  { key: 'has_salary', label: '年収・給与の数字あり' },
  { key: 'has_location', label: '勤務地の記載あり' },
  { key: 'has_bullets', label: '箇条書きあり（3 行以上）' },
  { key: 'has_why_you', label: '「なぜあなたか」に触れている' },
  { key: 'has_job_url', label: 'URL あり（求人ページなど）' },
  { key: 'has_company_intro', label: '会社の紹介あり' },
  { key: 'has_cta', label: '行動の促しあり（返信・応募）' },
  { key: 'has_remote', label: 'リモート・在宅の記載あり' },
  { key: 'has_urgency', label: '急募・期限の表現あり' },
  { key: 'has_brackets_subject', label: '件名に【 】あり' },
  { key: 'has_benefits', label: '福利厚生・休日の記載あり' },
  { key: 'has_meeting_offer', label: '面談の提案あり' },
] as const;

/** 要点の材料で、1 社から取る文面の数 */
export const DIGEST_PER_COMPANY = 2;
/** 条件の選択肢に出す最小の送信数（直近 12 か月） */
export const OPTION_MIN_SENDS = 50;
/** 選択肢に出さない値 */
export const OPTION_EXCLUDED = ['(未入力)', '日本（都道府県不明）'];
/** 1 回の MERGE で写す案の数 */
export const EXPORT_MAX_ROWS = 50;
/** マートの実行記録（cms_ai_refresh_log）の step */
export const SCOUT_MART_STEP = 'scout_marts';

const MB = 1024 ** 2;

export interface AiScoutBenchmarkInput {
  /** 依頼した企業（分析対象から除く）。数字でなければ、どの企業も除かない */
  companyId: string;
  industry: string;
  /** 類似業界のまとまりの ID（src/shared/ai/industryGroups.ts）。無ければ '' */
  industryGroup: string;
  filters: ScoutFilters;
  lang: ScoutLang;
}

/**
 * 分析対象（上位の文面）の数値と、要点の材料を 1 回で返す（1 行）。
 *   level … 1 同じ業界 / 2 類似業界 / 3 全業界（ここまで条件つき）、4 同じ業界 / 5 類似業界 / 6 全業界（条件を外した）。
 *           「条件に合う送信が @min_sends 通以上ある文面」が @min_templates 件以上になる最初の範囲。条件の指定が無いときは 1〜3 のどれかになる
 *   any_over … 返信率が @threshold を超える文面があったか（無ければ、返信率の高い順に取っている）
 *   templates / companies / sends / replies … 分析対象（最大 @top_n 件）の合計
 *   overall_sends / overall_replies … 同じ範囲・同じ条件の、選ぶ前の全体
 *   digest_json … 要点の材料（JSON の配列。指定の言語の文面を優先し、1 社 @per_company 件まで、最大 @digest_max 件。本文は先頭 @digest_chars 文字）
 */
export function aiScoutBenchmarkQuery(i: AiScoutBenchmarkInput): BuiltQuery {
  const id = Number(i.companyId);
  return {
    label: 'ai_scout_benchmark',
    maxBytes: 400 * MB,
    sql: `
WITH meta AS (
  SELECT MAX(run_date) AS data_date
  FROM \`bq-hgt.dwh.cms_ai_refresh_log\`
  WHERE step = @step AND status = 'ok'
),
s AS (
  SELECT s.template_id, s.company_id, s.replied,
         s.industry = @industry AS same_ind,
         s.industry_group = @industry_group AS same_grp,
         ((IFNULL(ARRAY_LENGTH(@ages), 0) = 0 OR s.age_group IN UNNEST(@ages))
          AND (IFNULL(ARRAY_LENGTH(@nationalities), 0) = 0 OR s.nationality_category IN UNNEST(@nationalities))
          AND (IFNULL(ARRAY_LENGTH(@japanese_levels), 0) = 0 OR s.japanese_level IN UNNEST(@japanese_levels))
          AND (IFNULL(ARRAY_LENGTH(@english_levels), 0) = 0 OR s.english_level IN UNNEST(@english_levels))
          AND (IFNULL(ARRAY_LENGTH(@residences), 0) = 0 OR s.residence IN UNNEST(@residences))
          AND (IFNULL(ARRAY_LENGTH(@occupations), 0) = 0 OR s.occupation_group IN UNNEST(@occupations))) AS f
  FROM \`bq-hgt.dwh.cms_ai_scout_sends\` s
  CROSS JOIN meta
  WHERE s.sent_date > DATE_SUB(meta.data_date, INTERVAL @months MONTH) AND s.sent_date <= meta.data_date
    AND s.company_id != @company_id
),
t AS (
  SELECT template_id, ANY_VALUE(company_id) AS company_id, LOGICAL_OR(same_ind) AS same_ind, LOGICAL_OR(same_grp) AS same_grp,
         COUNT(*) AS n_all, COUNTIF(replied) AS r_all, COUNTIF(f) AS n_f, COUNTIF(f AND replied) AS r_f
  FROM s
  GROUP BY 1
),
-- 対象範囲: 類似業界（業界のまとまり）→ 全業界 の順（2026-11-27 ユーザー指示「類似業界内で」。同じ業界だけに絞る段（level 1・4）は使わない）。
-- 条件つきで足りないときは、条件を外して同じ順（level 5・6）
lv AS (
  SELECT CASE
           WHEN COUNTIF(same_grp AND n_f >= @min_sends) >= @min_templates THEN 2
           WHEN COUNTIF(n_f >= @min_sends) >= @min_templates THEN 3
           WHEN COUNTIF(same_grp AND n_all >= @min_sends) >= @min_templates THEN 5
           ELSE 6
         END AS level
  FROM t
),
c AS (
  SELECT t.template_id, t.company_id,
         IF(lv.level <= 3, t.n_f, t.n_all) AS n, IF(lv.level <= 3, t.r_f, t.r_all) AS r
  FROM t
  CROSS JOIN lv
  WHERE (lv.level IN (1, 4) AND t.same_ind) OR (lv.level IN (2, 5) AND t.same_grp) OR lv.level IN (3, 6)
),
elig AS (
  SELECT c.*, SAFE_DIVIDE(c.r, c.n) AS rate FROM c WHERE c.n >= @min_sends
),
flag AS (
  SELECT COUNTIF(rate > @threshold) > 0 AS any_over FROM elig
),
top AS (
  SELECT e.template_id, e.company_id, e.n, e.r, e.rate,
         ROW_NUMBER() OVER (ORDER BY e.rate DESC, e.n DESC, e.template_id) AS rk
  FROM elig e
  CROSS JOIN flag
  WHERE NOT flag.any_over OR e.rate > @threshold
  QUALIFY rk <= @top_n
),
tt AS (
  SELECT top.rk, top.company_id, top.n, top.r, top.rate, m.* EXCEPT (template_id, company_id)
  FROM top
  JOIN \`bq-hgt.dwh.cms_ai_scout_templates\` m USING (template_id)
),
dg AS (
  SELECT *
  FROM (SELECT tt.*, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY IF(lang = @lang, 0, 1), rk) AS per_co FROM tt)
  WHERE per_co <= @per_company
  QUALIFY ROW_NUMBER() OVER (ORDER BY IF(lang = @lang, 0, 1), rk) <= @digest_max
),
st AS (
  SELECT COUNT(*) AS templates, COUNT(DISTINCT company_id) AS companies, IFNULL(SUM(n), 0) AS sends, IFNULL(SUM(r), 0) AS replies,
         APPROX_QUANTILES(subject_chars, 4) AS q_subject, APPROX_QUANTILES(body_chars, 4) AS q_body, APPROX_QUANTILES(line_count, 4) AS q_lines,
         COUNTIF(has_salary) AS has_salary, COUNTIF(has_location) AS has_location, COUNTIF(has_bullets) AS has_bullets,
         COUNTIF(has_why_you) AS has_why_you, COUNTIF(has_job_url) AS has_job_url, COUNTIF(has_company_intro) AS has_company_intro,
         COUNTIF(has_cta) AS has_cta, COUNTIF(has_remote) AS has_remote, COUNTIF(has_urgency) AS has_urgency,
         COUNTIF(has_brackets_subject) AS has_brackets_subject, COUNTIF(has_benefits) AS has_benefits, COUNTIF(has_meeting_offer) AS has_meeting_offer,
         COUNTIF(lang = 'ja') AS lang_ja, COUNTIF(lang = 'en') AS lang_en
  FROM tt
)
SELECT lv.level, flag.any_over,
       CAST(meta.data_date AS STRING) AS data_date,
       CAST(DATE_ADD(DATE_SUB(meta.data_date, INTERVAL @months MONTH), INTERVAL 1 DAY) AS STRING) AS period_from,
       CAST(meta.data_date AS STRING) AS period_to,
       st.templates, st.companies, st.sends, st.replies,
       (SELECT IFNULL(SUM(n), 0) FROM c) AS overall_sends, (SELECT IFNULL(SUM(r), 0) FROM c) AS overall_replies,
       st.q_subject[SAFE_OFFSET(1)] AS subject_p25, st.q_subject[SAFE_OFFSET(2)] AS subject_median, st.q_subject[SAFE_OFFSET(3)] AS subject_p75,
       st.q_body[SAFE_OFFSET(1)] AS body_p25, st.q_body[SAFE_OFFSET(2)] AS body_median, st.q_body[SAFE_OFFSET(3)] AS body_p75,
       st.q_lines[SAFE_OFFSET(1)] AS lines_p25, st.q_lines[SAFE_OFFSET(2)] AS lines_median, st.q_lines[SAFE_OFFSET(3)] AS lines_p75,
       st.has_salary, st.has_location, st.has_bullets, st.has_why_you, st.has_job_url, st.has_company_intro,
       st.has_cta, st.has_remote, st.has_urgency, st.has_brackets_subject, st.has_benefits, st.has_meeting_offer,
       st.lang_ja, st.lang_en,
       (SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(rk AS rank, subject, SUBSTR(body, 1, @digest_chars) AS body, body_chars, n AS sends, r AS replies, lang) ORDER BY rk))
        FROM dg) AS digest_json
FROM meta
CROSS JOIN lv
CROSS JOIN flag
CROSS JOIN st`,
    params: [
      p.str('step', SCOUT_MART_STEP),
      p.int('company_id', Number.isSafeInteger(id) ? id : -1),
      p.str('industry', i.industry),
      p.str('industry_group', i.industryGroup),
      p.strArray('ages', i.filters.ageGroups),
      p.strArray('nationalities', i.filters.nationalities),
      p.strArray('japanese_levels', i.filters.japaneseLevels),
      p.strArray('english_levels', i.filters.englishLevels),
      p.strArray('residences', i.filters.residences),
      p.strArray('occupations', i.filters.occupations),
      p.str('lang', i.lang),
      p.int('months', SCOUT_WINDOW_MONTHS),
      p.int('min_sends', SCOUT_MIN_SENDS),
      p.int('min_templates', SCOUT_MIN_TEMPLATES),
      { name: 'threshold', parameterType: { type: 'FLOAT64' }, parameterValue: { value: String(SCOUT_RATE_THRESHOLD) } },
      p.int('top_n', SCOUT_TOP_TEMPLATES),
      p.int('per_company', DIGEST_PER_COMPANY),
      p.int('digest_max', DIGEST_MAX),
      p.int('digest_chars', DIGEST_BODY_CHARS),
    ],
  };
}

/**
 * 受け取る人の条件の選択肢: 属性ごとの値（直近 @months か月の送信数の多い順。未入力と、@min_n 通に満たない値は出さない）。
 * attr = 条件のキー（ScoutFilterKey）。最後の 1 行（attr = 'dataDate'）は、マートの更新日だけを持つ
 */
export function aiScoutOptionsQuery(): BuiltQuery {
  return {
    label: 'ai_scout_options',
    maxBytes: 200 * MB,
    sql: `
WITH meta AS (
  SELECT MAX(run_date) AS data_date
  FROM \`bq-hgt.dwh.cms_ai_refresh_log\`
  WHERE step = @step AND status = 'ok'
),
s AS (
  SELECT s.age_group, s.nationality_category, s.japanese_level, s.english_level, s.residence, s.occupation_group
  FROM \`bq-hgt.dwh.cms_ai_scout_sends\` s
  CROSS JOIN meta
  WHERE s.sent_date > DATE_SUB(meta.data_date, INTERVAL @months MONTH) AND s.sent_date <= meta.data_date
),
u AS (
  SELECT 'ageGroups' AS attr, age_group AS value, COUNT(*) AS n FROM s GROUP BY 1, 2
  UNION ALL SELECT 'nationalities', nationality_category, COUNT(*) FROM s GROUP BY 1, 2
  UNION ALL SELECT 'japaneseLevels', japanese_level, COUNT(*) FROM s GROUP BY 1, 2
  UNION ALL SELECT 'englishLevels', english_level, COUNT(*) FROM s GROUP BY 1, 2
  UNION ALL SELECT 'residences', residence, COUNT(*) FROM s GROUP BY 1, 2
  UNION ALL SELECT 'occupations', occupation_group, COUNT(*) FROM s GROUP BY 1, 2
)
SELECT u.attr, u.value, u.n, CAST(meta.data_date AS STRING) AS data_date
FROM u
CROSS JOIN meta
WHERE u.n >= @min_n AND u.value NOT IN UNNEST(@excluded)
UNION ALL
SELECT 'dataDate', CAST(NULL AS STRING), 0, CAST(meta.data_date AS STRING)
FROM meta
ORDER BY attr, n DESC, value`,
    params: [p.str('step', SCOUT_MART_STEP), p.int('months', SCOUT_WINDOW_MONTHS), p.int('min_n', OPTION_MIN_SENDS), p.strArray('excluded', OPTION_EXCLUDED)],
  };
}

/** 選ばれた案の、送信実績との照合結果（日次マートが毎朝作り直す） */
export function aiScoutOutcomesQuery(draftIds: string[]): BuiltQuery {
  return {
    label: 'ai_scout_outcomes',
    maxBytes: 50 * MB,
    sql: `
SELECT draft_id, matched, sends, replies, hires, CAST(first_sent_on AS STRING) AS first_sent_on
FROM \`bq-hgt.dwh.cms_ai_scout_draft_outcomes\`
WHERE draft_id IN UNNEST(@draft_ids)`,
    params: [p.strArray('draft_ids', draftIds)],
  };
}

/**
 * 選ばれた案を dwh.cms_ai_scout_drafts へ写す（draft_id で 1 行。同じ案をもう一度写すと上書き）。
 * 行は JSON の配列 1 つを @rows で渡す（SQL の本文に値を入れない）。1 回 EXPORT_MAX_ROWS 行まで（呼ぶ側で分ける）
 */
export function aiScoutDraftsMergeQuery(rows: ScoutDraftExport[]): BuiltQuery {
  if (rows.length > EXPORT_MAX_ROWS) throw new Error(`1 回に写せる案は ${EXPORT_MAX_ROWS} 行まで`);
  return {
    label: 'ai_scout_drafts_merge',
    maxBytes: 200 * MB,
    sql: `
MERGE \`bq-hgt.dwh.cms_ai_scout_drafts\` T
USING (
  SELECT JSON_VALUE(j, '$.draftId') AS draft_id,
         JSON_VALUE(j, '$.jobId') AS job_id,
         SAFE_CAST(JSON_VALUE(j, '$.companyId') AS INT64) AS company_id,
         JSON_VALUE(j, '$.modelId') AS model_id,
         SAFE_CAST(JSON_VALUE(j, '$.modelVersion') AS INT64) AS model_version,
         JSON_VALUE(j, '$.subject') AS subject,
         JSON_VALUE(j, '$.body') AS body,
         SAFE_CAST(JSON_VALUE(j, '$.chosenAt') AS TIMESTAMP) AS chosen_at
  FROM UNNEST(JSON_QUERY_ARRAY(@rows)) AS j
  WHERE JSON_VALUE(j, '$.draftId') IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY JSON_VALUE(j, '$.draftId') ORDER BY JSON_VALUE(j, '$.chosenAt') DESC) = 1
) S
ON T.draft_id = S.draft_id
WHEN MATCHED THEN UPDATE SET
  job_id = S.job_id, company_id = S.company_id, model_id = S.model_id, model_version = S.model_version,
  subject = S.subject, body = S.body, chosen_at = S.chosen_at, updated_at = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT (draft_id, job_id, company_id, model_id, model_version, subject, body, chosen_at, updated_at)
  VALUES (S.draft_id, S.job_id, S.company_id, S.model_id, S.model_version, S.subject, S.body, S.chosen_at, CURRENT_TIMESTAMP())`,
    params: [
      p.str(
        'rows',
        JSON.stringify(
          rows.map((r) => ({ draftId: r.draftId, jobId: r.jobId, companyId: r.companyId, modelId: r.modelId, modelVersion: r.modelVersion, subject: r.subject, body: r.body, chosenAt: r.chosenAt })),
        ),
      ),
    ],
  };
}
