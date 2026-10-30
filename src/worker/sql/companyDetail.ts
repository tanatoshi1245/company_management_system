import { p, type BuiltQuery } from '../bq/params';

/** 属性マート照会のスキャン上限（表全体の推定量 + 伸びしろ。実際の課金は読んだ分だけ） */
export const ATTRIBUTES_MAX_BYTES = 2 * 1024 ** 3;

/** 1 社分。企業 ID は INT64 パラメータで渡す（文字列連結しない） */
export function companyMasterByIdQuery(companyId: string): BuiltQuery {
  return {
    label: 'company_master_one',
    sql: `
SELECT CAST(company_id AS STRING) AS company_id, company_name, internal_name, company_type, dj_contract_type, profile_count,
       CAST(active_from AS STRING) AS active_from, CAST(active_to AS STRING) AS active_to,
       CAST(contract_from AS STRING) AS contract_from, CAST(contract_to AS STRING) AS contract_to,
       is_contracted_now, contract_state, days_to_contract_end, days_since_contract_start, contract_days_total,
       scout_limit, job_posting_limit, industry, industry_source, sf_link_status, sf_account_id, sf_account_name, sf_contract_status,
       CAST(sf_contract_start AS STRING) AS sf_contract_start, CAST(sf_contract_end AS STRING) AS sf_contract_end,
       plan_name, plan_source, sf_active_contract, sf_live_won_opp, da_active_profile, sf_notice_check,
       sf_account_owner_name, sf_account_owner_email, sf_account_owner_position,
       sf_contract_owner_name, sf_contract_owner_email, sf_contract_owner_position,
       sales_staff, cs_owner_email_default, cs_owner_name_default, owner_source, active_jobs_now, scout_unused_json, jobs_window_distinct,
       account_types, accounts_json, jobs_json
FROM \`bq-hgt.dwh.cms_company_master\`
WHERE company_id = @id`,
    params: [p.int('id', Number(companyId))],
  };
}

export function companyMonthlyByIdQuery(companyId: string): BuiltQuery {
  return {
    label: 'company_monthly_one',
    sql: `
SELECT month_ym, is_current_month, is_contracted_in_month, scout_limit, job_posting_limit, active_jobs_eom, new_jobs,
       scout_sent, scout_sent_manual, scout_sent_auto, scout_sent_contract_to_date,
       interested_by_send_month, interested_by_reply_month, applications, job_views, hires, hires_from_application, hires_from_scout, in_selection, login_days,
       st01_no_response, st02_contact_planned, st03_pass_planned, st04_contacted, st05_rejected, st06_interview_adjusting,
       st07_interview_1st, st08_interview_2nd, st09_interview_3rd, st10_interview_final, st11_hired, st12_declined
FROM \`bq-hgt.dwh.cms_company_monthly\`
WHERE company_id = @id AND account_type = '__ALL__'
ORDER BY month_ym`,
    params: [p.int('id', Number(companyId))],
  };
}

/** アカウント種別（直接 / 紹介 / 派遣）ごとの月次。企業ページの種別切替用 */
export function companyAccountMonthlyQuery(companyId: string): BuiltQuery {
  return {
    label: 'company_account_monthly_one',
    sql: `
SELECT account_type, month_ym, active_jobs_eom, scout_sent, interested_by_reply_month, applications, job_views,
       hires_from_application, hires_from_scout, in_selection, st06_interview_adjusting, st07_interview_1st, st08_interview_2nd, st09_interview_3rd, st10_interview_final, st11_hired
FROM \`bq-hgt.dwh.cms_company_monthly\`
WHERE company_id = @id AND account_type != '__ALL__'
ORDER BY account_type, month_ym`,
    params: [p.int('id', Number(companyId))],
  };
}

export function dailyUsageQuery(companyId: string): BuiltQuery {
  return {
    label: 'daily_usage',
    sql: `
SELECT CAST(usage_date AS STRING) AS usage_date, FORMAT_DATE('%Y-%m', month) AS month_ym, day_of_month,
       scout_sent, scout_sent_cum, applications, applications_cum, interested, interested_cum, job_views, job_views_cum, active_jobs, login_events
FROM \`bq-hgt.dwh.cms_company_daily_usage\`
WHERE company_id = @id
ORDER BY usage_date`,
    params: [p.int('id', Number(companyId))],
  };
}

export function scoutCohortQuery(companyId: string): BuiltQuery {
  return {
    label: 'scout_cohort',
    sql: `
SELECT FORMAT_DATE('%Y-%m', cohort_month) AS month_ym, application_status AS status, scouts AS cnt, members
FROM \`bq-hgt.dwh.cms_scout_cohort_status\`
WHERE company_id = @id
ORDER BY cohort_month, status`,
    params: [p.int('id', Number(companyId))],
  };
}

export function applicationCohortQuery(companyId: string): BuiltQuery {
  return {
    label: 'application_cohort',
    sql: `
SELECT FORMAT_DATE('%Y-%m', cohort_month) AS month_ym, status, applications AS cnt, members
FROM \`bq-hgt.dwh.cms_application_cohort_status\`
WHERE company_id = @id
ORDER BY cohort_month, status`,
    params: [p.int('id', Number(companyId))],
  };
}

/**
 * 会員属性の内訳（kind = scout / view / application × 属性種別 × 値）。期間（月初 from〜to）とアカウント種別（NULL = 全体）で BQ 側に集約させる。
 * members（会員の distinct）は月をまたいで足せないので返さない
 */
export function memberAttributesQuery(companyId: string, fromMonthFirstDay: string, toMonthFirstDay: string, accountType: string | null, jobKey: string | null = null): BuiltQuery {
  return {
    label: 'member_attributes',
    sql: `
SELECT kind, attribute_type, attribute_value, SUM(scouts) AS scouts, SUM(interested_scouts) AS interested_scouts
FROM \`bq-hgt.dwh.cms_scout_member_attributes_monthly\`
WHERE company_id = @id AND sent_month BETWEEN @from AND @to AND (@account IS NULL OR account_type = @account) AND (@job IS NULL OR job_key = @job)
GROUP BY 1, 2, 3
ORDER BY 1, 2, 4 DESC`,
    params: [p.int('id', Number(companyId)), p.date('from', fromMonthFirstDay), p.date('to', toMonthFirstDay), p.nullableStr('account', accountType), p.nullableStr('job', jobKey)],
    // 属性マートは求人の軸で約 4.3M 行・約 500 MB（2026-10-30）。推定スキャン量が表全体になるため既定の 200 MB では拒否される。
    // company_id でクラスタリングしているので実際の読み取りは 1 社 数十 MB。上限だけ 2 GB に緩める
    maxBytes: ATTRIBUTES_MAX_BYTES,
  };
}

/** 求人単位の集計（期間 from〜to の月、アカウント種別）。企業ページの求人の表・求人フィルタ用。閲覧数の多い順 */
export function companyJobsQuery(companyId: string, fromMonthFirstDay: string, toMonthFirstDay: string, accountType: string | null): BuiltQuery {
  return {
    label: 'company_jobs',
    sql: `
SELECT job_key, ANY_VALUE(job_title) AS job_title, ANY_VALUE(account_type) AS account_type, LOGICAL_OR(is_direct) AS is_direct,
       CAST(MIN(publish_from) AS STRING) AS publish_from,
       CAST(IF(LOGICAL_OR(publish_from IS NOT NULL AND publish_to IS NULL), NULL, MAX(publish_to)) AS STRING) AS publish_to,
       SUM(job_views) AS job_views, SUM(applications) AS applications, SUM(hires_from_application) AS hires_from_application,
       SUM(st06_interview_adjusting) AS st06_interview_adjusting, SUM(st07_interview_1st) AS st07_interview_1st, SUM(st08_interview_2nd) AS st08_interview_2nd,
       SUM(st09_interview_3rd) AS st09_interview_3rd, SUM(st10_interview_final) AS st10_interview_final, SUM(st11_hired) AS st11_hired
FROM \`bq-hgt.dwh.cms_company_job_monthly\`
WHERE company_id = @id AND month BETWEEN @from AND @to AND (@account IS NULL OR account_type = @account)
GROUP BY job_key
ORDER BY job_views DESC, applications DESC, job_key`,
    params: [p.int('id', Number(companyId)), p.date('from', fromMonthFirstDay), p.date('to', toMonthFirstDay), p.nullableStr('account', accountType)],
  };
}

/** 1 求人の月次（期間 from〜to）。求人フィルタ選択時の推移・数値用 */
export function companyJobMonthlyQuery(companyId: string, jobKey: string, fromMonthFirstDay: string, toMonthFirstDay: string, accountType: string | null): BuiltQuery {
  return {
    label: 'company_job_monthly_one',
    sql: `
SELECT month_ym, SUM(job_views) AS job_views, SUM(applications) AS applications, SUM(hires_from_application) AS hires_from_application,
       SUM(st06_interview_adjusting) AS st06_interview_adjusting, SUM(st07_interview_1st) AS st07_interview_1st, SUM(st08_interview_2nd) AS st08_interview_2nd,
       SUM(st09_interview_3rd) AS st09_interview_3rd, SUM(st10_interview_final) AS st10_interview_final, SUM(st11_hired) AS st11_hired
FROM \`bq-hgt.dwh.cms_company_job_monthly\`
WHERE company_id = @id AND job_key = @job AND month BETWEEN @from AND @to AND (@account IS NULL OR account_type = @account)
GROUP BY month_ym
ORDER BY month_ym`,
    params: [p.int('id', Number(companyId)), p.str('job', jobKey), p.date('from', fromMonthFirstDay), p.date('to', toMonthFirstDay), p.nullableStr('account', accountType)],
  };
}

/** 企業の群（業種 × 種別、各 __ALL__）の全期間のベンチマーク（推移の帯・月ごとのフォールバック用） */
export function benchSeriesQuery(industry: string, companyType: string): BuiltQuery {
  return {
    label: 'bench_series',
    sql: `
SELECT month_ym, industry, company_type, metric, n_companies, mean, p25, median, p75
FROM \`bq-hgt.dwh.cms_industry_benchmark_monthly\`
WHERE (industry = @industry OR industry = '__ALL__') AND (company_type = @company_type OR company_type = '__ALL__')
ORDER BY month_ym`,
    params: [p.str('industry', industry), p.str('company_type', companyType)],
  };
}

export function companyLoginByIdQuery(companyId: string): BuiltQuery {
  return {
    label: 'company_login_one',
    sql: `
SELECT CAST(last_login_date AS STRING) AS last_login_date, FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', last_login_at) AS last_login_at,
       days_since_login, login_days_mtd, login_days_30d, login_days_90d, CAST(data_through_date AS STRING) AS data_through_date
FROM \`bq-hgt.dwh.cms_company_login\`
WHERE company_id = @id`,
    params: [p.int('id', Number(companyId))],
  };
}
