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
import { aiScoutBenchmarkQuery, aiScoutDraftsMergeQuery, aiScoutJobQuery, aiScoutMemberQuery, aiScoutMemberResumeQuery, aiScoutOptionsQuery, aiScoutOutcomesQuery } from '../src/worker/sql/aiScout';
import { EMPTY_SCOUT_FILTERS } from '../src/shared/ai/scout';
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
  // ② スカウト文面の AI 作成（日次マート cms_ai_*。各クエリが maxBytes を持つ。書き込みの MERGE は dry run だけ）
  aiScoutBenchmarkQuery({ companyId: sampleId, industry: 'ITコンサルティング', industryGroup: 'it', filters: { ...EMPTY_SCOUT_FILTERS, ageGroups: ['25-34歳'] }, lang: 'ja' }),
  aiScoutOptionsQuery(),
  aiScoutOutcomesQuery(['dryrun0001']),
  // 求人 ID・会員 ID からの作成（1 行を引く。推定は表全体 = クラスタリング前の量で、実行は数 MB）
  aiScoutJobQuery(sampleId, '1'),
  aiScoutMemberQuery('1'),
  // 職務経歴・自己PR（閲覧制限付きの dwh_restricted.cms_ai_member_resumes。Worker が dwh の外で読む、ただ 1 つの表）
  aiScoutMemberResumeQuery('1', 'ja'),
  aiScoutDraftsMergeQuery([{ draftId: 'dryrun0001', jobId: 'dryrun', companyId: sampleId, modelId: 'a', modelVersion: 1, subject: 'dry run', body: 'dry run', chosenAt: new Date().toISOString() }]),
];
const BUDGET = 10 * 1024 ** 2;
let bad = 0;
for (const q of queries) {
  const { bytesProcessed } = await client.dryRun(q);
  const mb = bytesProcessed / 1024 ** 2;
  // 属性マートなど表全体が大きいマートは q.maxBytes で個別に上限を持つ（推定はクラスタリング前の表全体）
  const budget = q.maxBytes ?? BUDGET;
  const flag = bytesProcessed > budget ? `  <-- 予算 ${Math.round(budget / 1024 ** 2)} MB 超過` : '';
  if (bytesProcessed > budget) bad++;
  console.log(`${q.label.padEnd(24)} ${mb.toFixed(2).padStart(8)} MB${flag}`);
}
console.log(bad ? `\n${bad} 件が予算超過` : '\nすべて予算内（各 < 10 MB）');
process.exit(bad ? 1 : 0);
