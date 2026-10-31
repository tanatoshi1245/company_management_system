import type { BuiltQuery } from '../bq/params';

/** cms_company_monthly（全社 × 14 か月、企業全体の行 = account_type '__ALL__' のみ）。ボードの当月・前月・13 か月推移をまとめて取る（約 13,000 行） */
export function companyMonthlyQuery(): BuiltQuery {
  return {
    label: 'company_monthly',
    sql: `
SELECT CAST(company_id AS STRING) AS company_id, month_ym, is_current_month, data_days, is_contracted_in_month,
       scout_limit, job_posting_limit, active_jobs_eom, jobs_in_month, new_jobs,
       scout_sent, scout_sent_manual, scout_sent_auto, scout_sent_contract_to_date,
       interested_by_send_month, interested_by_reply_month, applications, job_views, hires, in_selection,
       st01_no_response, st11_hired, login_days
FROM \`bq-hgt.dwh.cms_company_monthly\`
WHERE account_type = '__ALL__'
ORDER BY company_id, month_ym`,
    params: [],
  };
}
