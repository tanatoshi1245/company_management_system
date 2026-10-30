import type { BuiltQuery } from '../params';
import type { Row } from '../parseRows';
import { todayJst } from '../../../shared/calendar/periods';
import { mockCompanyLogin, mockCompanyMaster, mockCompanyMonthly, mockIndustryBenchmark } from './board';
import { mockApplicationCohort, mockBenchSeries, mockCompanyAccountMonthlyOne, mockCompanyLoginOne, mockCompanyMasterOne, mockCompanyMonthlyOne, mockDailyUsage, mockMemberAttributes, mockScoutCohort } from './company';

export function paramValue(q: BuiltQuery, name: string): string | null {
  const v = q.params.find((x) => x.name === name)?.parameterValue.value;
  return v === undefined || v === null ? null : String(v);
}

/** cms_refresh_log: 今朝 07:52 JST に成功した 1 行 */
export function mockRefreshLog(now: Date = new Date()): Row[] {
  const run = todayJst(now);
  return [{ run_date: run, step: 'all', status: 'ok', started_at: `${run}T22:45:03Z`, finished_at: `${run}T22:52:10Z`, note: null }];
}

/** ラベル → フィクスチャ。マートを増やしたらここに足す（M1 以降） */
export function mockRows(q: BuiltQuery): Row[] {
  switch (q.label) {
    case 'refresh_log':
      return mockRefreshLog();
    case 'company_master':
      // NW（Network 契約）はボードに出さない（SQL の WHERE と同じ）
      return mockCompanyMaster().filter((r) => r.company_type !== 'NW');
    case 'company_monthly':
      return mockCompanyMonthly();
    case 'company_login':
      return mockCompanyLogin();
    case 'industry_benchmark':
      return mockIndustryBenchmark(paramValue(q, 'month') ?? '');
    case 'company_master_one':
      return mockCompanyMasterOne(paramValue(q, 'id') ?? '');
    case 'company_monthly_one':
      return mockCompanyMonthlyOne(paramValue(q, 'id') ?? '');
    case 'company_account_monthly_one':
      return mockCompanyAccountMonthlyOne(paramValue(q, 'id') ?? '');
    case 'company_login_one':
      return mockCompanyLoginOne(paramValue(q, 'id') ?? '');
    case 'daily_usage':
      return mockDailyUsage(paramValue(q, 'id') ?? '');
    case 'scout_cohort':
      return mockScoutCohort(paramValue(q, 'id') ?? '');
    case 'application_cohort':
      return mockApplicationCohort(paramValue(q, 'id') ?? '');
    case 'member_attributes':
      return mockMemberAttributes(paramValue(q, 'id') ?? '', paramValue(q, 'from') ?? '2000-01-01', paramValue(q, 'to') ?? '2999-12-01', paramValue(q, 'account'));
    case 'bench_series':
      return mockBenchSeries(paramValue(q, 'industry') ?? '', paramValue(q, 'company_type') ?? '');
    default:
      return [];
  }
}
