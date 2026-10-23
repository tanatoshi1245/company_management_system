import { p, type BuiltQuery } from '../bq/params';

/** cms_refresh_log の直近の実行（成功・失敗）。dataVersion（= 最新の ok 行の run_date）の算出に使う */
export function refreshLogQuery(sinceYmd: string): BuiltQuery {
  return {
    label: 'refresh_log',
    sql: `
SELECT CAST(run_date AS STRING) AS run_date, step, status,
       CAST(started_at AS STRING) AS started_at, CAST(finished_at AS STRING) AS finished_at, note
FROM \`bq-hgt.dwh.cms_refresh_log\`
WHERE run_date >= @since AND step = 'all'
ORDER BY run_date DESC, finished_at DESC
LIMIT 10`,
    params: [p.date('since', sinceYmd)],
  };
}
