import { p, type BuiltQuery } from '../bq/params';

/**
 * AI 機能（docs/AI機能.md）の入力欄の選択肢: 期間内に掲載のあった求人の職種（重複なし）。
 * 読むのは求人のマートの 1 列だけ。fromMonthFirstDay = 月初の日付
 */
export function aiOccupationOptionsQuery(fromMonthFirstDay: string): BuiltQuery {
  return {
    label: 'ai_occupation_options',
    sql: `
SELECT DISTINCT job_occupation
FROM \`bq-hgt.dwh.cms_company_job_monthly\`
WHERE month >= @from AND job_occupation IS NOT NULL
ORDER BY job_occupation
LIMIT 3000`,
    params: [p.date('from', fromMonthFirstDay)],
  };
}
