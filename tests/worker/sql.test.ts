import { describe, expect, it } from 'vitest';
import { companyMasterQuery } from '../../src/worker/sql/companyMaster';
import { companyMonthlyQuery } from '../../src/worker/sql/companyMonthly';
import { companyLoginQuery } from '../../src/worker/sql/companyLogin';
import { industryBenchmarkQuery } from '../../src/worker/sql/industryBenchmark';
import { refreshLogQuery } from '../../src/worker/sql/refreshLog';
import { applicationCohortQuery, benchSeriesQuery, companyAccountMonthlyQuery, companyJobMonthlyQuery, companyJobsQuery, companyLoginByIdQuery, companyMasterByIdQuery, companyMonthlyByIdQuery, dailyUsageQuery, memberAttributesQuery, scoutCohortQuery } from '../../src/worker/sql/companyDetail';
import type { BuiltQuery } from '../../src/worker/bq/params';

/** Worker が読んでよいテーブル（マートだけ。生テーブルは読まない） */
const ALLOWED_TABLES = ['cms_refresh_log', 'cms_company_master', 'cms_company_monthly', 'cms_company_login', 'cms_industry_benchmark_monthly', 'cms_company_daily_usage', 'cms_scout_cohort_status', 'cms_application_cohort_status', 'cms_scout_member_attributes_monthly', 'cms_company_job_monthly'];

const queries: BuiltQuery[] = [companyMasterQuery(), companyMonthlyQuery(), companyLoginQuery(), industryBenchmarkQuery('2026-10'), refreshLogQuery('2026-10-01'), companyMasterByIdQuery('1001'), companyMonthlyByIdQuery('1001'), dailyUsageQuery('1001'), scoutCohortQuery('1001'), applicationCohortQuery('1001'), memberAttributesQuery('1001', '2026-08-01', '2026-10-01', null), memberAttributesQuery('1001', '2026-08-01', '2026-10-01', '直接', '12345'), companyAccountMonthlyQuery('1001'), companyJobsQuery('1001', '2026-08-01', '2026-10-01', null), companyJobMonthlyQuery('1001', '12345', '2026-08-01', '2026-10-01', '直接'), benchSeriesQuery('IT', '直接'), companyLoginByIdQuery('1001')];

describe('マート読み取り SQL', () => {
  it.each(queries.map((q) => [q.label, q] as const))('%s: cms_* だけを読み、利用者入力は @param で渡す', (_label, q) => {
    const tables = Array.from(q.sql.matchAll(/`bq-hgt\.dwh\.([a-z_]+)`/g)).map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(ALLOWED_TABLES).toContain(t);
    // SQL 本文に日付・月の生の値を書かない（パラメータ化）
    expect(q.sql).not.toMatch(/'\d{4}-\d{2}(-\d{2})?'/);
    const refs = Array.from(q.sql.matchAll(/@([a-z_]+)/g)).map((m) => m[1]);
    for (const r of refs) expect(q.params.map((p) => p.name)).toContain(r);
    for (const p of q.params) expect(refs).toContain(p.name);
  });
});
