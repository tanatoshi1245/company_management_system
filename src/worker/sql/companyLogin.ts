import type { BuiltQuery } from '../bq/params';

export function companyLoginQuery(): BuiltQuery {
  return {
    label: 'company_login',
    sql: `
SELECT CAST(company_id AS STRING) AS company_id, CAST(last_login_date AS STRING) AS last_login_date,
       FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', last_login_at) AS last_login_at,
       days_since_login, login_days_mtd, login_days_30d, login_days_90d,
       CAST(data_available_from AS STRING) AS data_available_from, CAST(data_through_date AS STRING) AS data_through_date
FROM \`bq-hgt.dwh.cms_company_login\``,
    params: [],
  };
}
