/**
 * Worker がリクエスト時に発行する全クエリを dry run し、スキャン量を表示する（各 < 10 MB が予算）。
 *   BQ_SA_KEY（1 行 JSON）または BQ_SA_KEY_FILE（鍵ファイルのパス。claude_analysis の /tmp/bq-key.json 等）が必要。
 *   実行: npm run dryrun
 */
import { readFileSync } from 'node:fs';
import { RestBqClient } from '../src/worker/bq/client';
import { refreshLogQuery } from '../src/worker/sql/refreshLog';
import { companyMasterQuery } from '../src/worker/sql/companyMaster';
import { companyMonthlyQuery } from '../src/worker/sql/companyMonthly';
import { companyLoginQuery } from '../src/worker/sql/companyLogin';
import { industryBenchmarkQuery } from '../src/worker/sql/industryBenchmark';
import { applicationCohortQuery, benchSeriesQuery, companyLoginByIdQuery, companyMasterByIdQuery, companyMonthlyByIdQuery, dailyUsageQuery, memberAttributesQuery, scoutCohortQuery } from '../src/worker/sql/companyDetail';
import { addDays, addMonths, monthOf, todayJst } from '../src/shared/calendar/periods';

const key = process.env.BQ_SA_KEY ?? (process.env.BQ_SA_KEY_FILE ? readFileSync(process.env.BQ_SA_KEY_FILE, 'utf8') : '');
if (!key) {
  console.error('BQ_SA_KEY または BQ_SA_KEY_FILE を設定してください');
  process.exit(2);
}
const client = new RestBqClient({ saKey: key, project: process.env.BQ_PROJECT ?? 'bq-hgt', location: process.env.BQ_LOCATION ?? 'asia-northeast1', fetchImpl: (input, init) => globalThis.fetch(input, init) });
const today = todayJst();
const month = monthOf(today);
const sampleId = process.env.SAMPLE_COMPANY_ID ?? '1';
const queries = [
  refreshLogQuery(addDays(today, -14)),
  companyMasterQuery(),
  companyMonthlyQuery(),
  companyLoginQuery(),
  industryBenchmarkQuery(month),
  companyMasterByIdQuery(sampleId),
  companyMonthlyByIdQuery(sampleId),
  dailyUsageQuery(sampleId),
  scoutCohortQuery(sampleId),
  applicationCohortQuery(sampleId),
  memberAttributesQuery(sampleId, `${addMonths(month, -2)}-01`, `${month}-01`, null),
  benchSeriesQuery('IT・通信', 'DA'),
  companyLoginByIdQuery(sampleId),
];
const BUDGET = 10 * 1024 ** 2;
let bad = 0;
for (const q of queries) {
  const { bytesProcessed } = await client.dryRun(q);
  const mb = bytesProcessed / 1024 ** 2;
  const flag = bytesProcessed > BUDGET ? '  <-- 予算 10 MB 超過' : '';
  if (bytesProcessed > BUDGET) bad++;
  console.log(`${q.label.padEnd(24)} ${mb.toFixed(2).padStart(8)} MB${flag}`);
}
console.log(bad ? `\n${bad} 件が予算超過` : '\nすべて予算内（各 < 10 MB）');
process.exit(bad ? 1 : 0);
