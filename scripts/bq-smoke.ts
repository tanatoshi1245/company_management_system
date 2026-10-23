/**
 * 実データで Worker の読み取りと同じクエリを 1 回ずつ実行し、行数と所要時間を表示する（デプロイ前の疎通確認）。
 *   BQ_SA_KEY または BQ_SA_KEY_FILE が必要。実行: npm run smoke
 */
import { readFileSync } from 'node:fs';
import { RestBqClient } from '../src/worker/bq/client';
import { refreshLogQuery } from '../src/worker/sql/refreshLog';
import { companyMasterQuery } from '../src/worker/sql/companyMaster';
import { companyMonthlyQuery } from '../src/worker/sql/companyMonthly';
import { companyLoginQuery } from '../src/worker/sql/companyLogin';
import { industryBenchmarkQuery } from '../src/worker/sql/industryBenchmark';
import { addDays, monthOf, todayJst } from '../src/shared/calendar/periods';

const key = process.env.BQ_SA_KEY ?? (process.env.BQ_SA_KEY_FILE ? readFileSync(process.env.BQ_SA_KEY_FILE, 'utf8') : '');
if (!key) {
  console.error('BQ_SA_KEY または BQ_SA_KEY_FILE を設定してください');
  process.exit(2);
}
const client = new RestBqClient({ saKey: key, project: process.env.BQ_PROJECT ?? 'bq-hgt', location: process.env.BQ_LOCATION ?? 'asia-northeast1', fetchImpl: (input, init) => globalThis.fetch(input, init) });
const today = todayJst();
for (const q of [refreshLogQuery(addDays(today, -14)), companyMasterQuery(), companyMonthlyQuery(), companyLoginQuery(), industryBenchmarkQuery(monthOf(today))]) {
  const t0 = Date.now();
  const r = await client.run(q);
  console.log(`${q.label.padEnd(24)} ${String(r.rows.length).padStart(7)} 行  ${(r.bytesProcessed / 1024 ** 2).toFixed(2).padStart(8)} MB  ${Date.now() - t0} ms`);
}
