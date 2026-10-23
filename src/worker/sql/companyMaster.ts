import type { BuiltQuery } from '../bq/params';

/** cms_company_master（全社）。DATE / TIMESTAMP は STRING にして返す（REST の TIMESTAMP は epoch 秒になるため） */
export function companyMasterQuery(): BuiltQuery {
  return {
    label: 'company_master',
    sql: `
SELECT CAST(company_id AS STRING) AS company_id, company_name, internal_name, company_type, dj_contract_type,
       CAST(active_from AS STRING) AS active_from, CAST(active_to AS STRING) AS active_to,
       is_contracted_now, contract_state, days_to_contract_end, days_since_contract_start, contract_days_total,
       scout_limit, job_posting_limit, scout_limit_period_default,
       industry, industry_source, sf_link_status, sf_account_id, sf_contract_status,
       CAST(sf_contract_start AS STRING) AS sf_contract_start, CAST(sf_contract_end AS STRING) AS sf_contract_end,
       plan_name, plan_source, sf_active_contract, sf_live_won_opp, da_active_profile, sf_notice_check,
       sf_account_owner_name, sf_account_owner_email, sf_account_owner_position,
       sf_contract_owner_name, sf_contract_owner_email, sf_contract_owner_position,
       sales_staff, cs_owner_email_default, cs_owner_name_default, owner_source, active_jobs_now,
       CAST(run_date AS STRING) AS run_date
FROM \`bq-hgt.dwh.cms_company_master\``,
    params: [],
  };
}
