import type { BqClient } from '../bq/client';
import { cacheGet, cacheKey, cachePut } from '../lib/cache';
import { getBoardCore } from '../services/boardService';
import { loadJobs, occupationGroup } from '../services/companyService';
import { martTtlSec, type RefreshMeta } from '../services/refreshMeta';
import { companyMasterQuery } from '../sql/companyMaster';
import { aiOccupationOptionsQuery } from '../sql/ai';
import { addMonths, monthOf } from '../../shared/calendar/periods';
import { DATA_VERSION } from '../../shared/schema/common';
import type { AiCompaniesResponse, AiCompanyDefaultsResponse, AiCompanyJob } from '../../shared/ai/common';
import { AI_OCCUPATIONS_MAX } from '../../shared/ai/scout';
import type { CompanyBrief } from './service';

/** AI 機能の入力欄の初期値と選択肢（docs/AI機能.md の GET /api/ai/companies・/api/ai/companies/:id/defaults） */

type CacheOpts = { now?: Date; capSec?: number; ctx?: { waitUntil(p: Promise<unknown>): void } };
/** 自動で入れる値を作る期間（当月を含む直近 6 か月） */
export const AI_DEFAULTS_MONTHS = 6;
const JOBS_MAX = 50;
const UNSET = new Set(['', '未設定', '(未設定)', '不明']);
const orNull = (v: string | null | undefined): string | null => (v === null || v === undefined || UNSET.has(v.trim()) ? null : v.trim());
const uniqSorted = (xs: string[]): string[] => Array.from(new Set(xs)).sort((a, b) => a.localeCompare(b, 'ja'));

/** 企業の選択肢 = 当月のボードに出ている企業（NW を除く・契約中か当月に契約のあった企業。boardService と同じ絞り込み = 同じキャッシュ） */
export async function aiCompanies(client: BqClient, refresh: RefreshMeta, cacheEpoch: string, opts: CacheOpts = {}): Promise<AiCompaniesResponse> {
  const { core } = await getBoardCore(client, monthOf(refresh.dataVersion), refresh, cacheEpoch, opts);
  return { companies: core.companies.map((c) => ({ id: c.id, name: c.name, industry: orNull(c.ind), companyType: orNull(c.type) })).sort((a, b) => a.name.localeCompare(b.name, 'ja')) };
}

/** 業界・職種の選択肢（業界 = マスタ全体の industry、職種 = 直近 6 か月に掲載のあった求人の職種の大分類）。マートの版ごとにキャッシュ */
async function aiOptions(client: BqClient, refresh: RefreshMeta, from: string, opts: CacheOpts): Promise<{ industryOptions: string[]; occupationOptions: string[] }> {
  const now = opts.now ?? new Date();
  const key = await cacheKey('ai-options', { from, dv: refresh.dataVersion, v: DATA_VERSION, mock: client.mock });
  const hit = await cacheGet<{ industryOptions: string[]; occupationOptions: string[] }>(key);
  if (hit) return hit;
  const [master, occ] = await Promise.all([client.run(companyMasterQuery()), client.run(aiOccupationOptionsQuery(`${from}-01`))]);
  const body = {
    industryOptions: uniqSorted(master.rows.flatMap((r) => orNull(r.industry === null || r.industry === undefined ? null : String(r.industry)) ?? [])),
    occupationOptions: uniqSorted(occ.rows.flatMap((r) => orNull(occupationGroup(r.job_occupation === null || r.job_occupation === undefined ? null : String(r.job_occupation))) ?? [])),
  };
  await cachePut(key, body, martTtlSec(refresh, now, opts.capSec), opts.ctx);
  return body;
}

/** 企業を選んだときに自動で入れる値: 業界（マスタ）、掲載職種と求人（直近 6 か月の求人の実績。閲覧の多い順） */
export async function aiCompanyDefaults(client: BqClient, brief: CompanyBrief, refresh: RefreshMeta, opts: CacheOpts = {}): Promise<AiCompanyDefaultsResponse> {
  const to = monthOf(refresh.dataVersion);
  const from = addMonths(to, -(AI_DEFAULTS_MONTHS - 1));
  const [jobs, options] = await Promise.all([loadJobs(client, brief.id, from, to, null, null), aiOptions(client, refresh, from, opts)]);
  const posted = jobs.rows.filter((j) => !j.direct);
  const count = new Map<string, number>();
  for (const j of posted) {
    const o = orNull(j.cond?.occupation);
    if (o) count.set(o, (count.get(o) ?? 0) + 1);
  }
  const list: AiCompanyJob[] = posted.slice(0, JOBS_MAX).map((j) => ({ jobKey: j.key, title: j.title, occupation: orNull(j.cond?.occupation), location: orNull(j.cond?.location), japaneseLevel: orNull(j.cond?.japanese), englishLevel: orNull(j.cond?.english), salaryBand: orNull(j.cond?.salary) }));
  return {
    companyId: brief.id,
    industry: orNull(brief.industry),
    occupations: Array.from(count.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).slice(0, AI_OCCUPATIONS_MAX).map(([o]) => o),
    jobs: list,
    ...options,
  };
}
