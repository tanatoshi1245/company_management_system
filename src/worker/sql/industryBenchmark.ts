import { p, type BuiltQuery } from '../bq/params';

/** 指定月の業界ベンチマーク（業種 × 種別 × 指標。__ALL__ のロールアップ含む） */
export function industryBenchmarkQuery(monthYm: string): BuiltQuery {
  return {
    label: 'industry_benchmark',
    sql: `
SELECT industry, company_type, metric, n_companies, mean, p25, median, p75
FROM \`bq-hgt.dwh.cms_industry_benchmark_monthly\`
WHERE month_ym = @month`,
    params: [p.str('month', monthYm)],
  };
}
