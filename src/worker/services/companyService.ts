import type { BqClient } from '../bq/client';
import type { Row } from '../bq/parseRows';
import { cacheGet, cacheKey, cachePut } from '../lib/cache';
import { lastNMonths, monthOf, todayJst } from '../../shared/calendar/periods';
import { monthProgress } from '../../shared/calendar/businessDays';
import { DATA_VERSION } from '../../shared/schema/common';
import type { BoardMeta } from '../../shared/schema/board';
import { AccountSchema, AttributeRowSchema, JobRangeSchema, ScoutUnusedRowSchema, type Account, type AttributeRow, type AttributesResponse, type CompanyDetailResponse, type CompanySettings, type JobRange, type JobRow, type JobsResponse, type ScoutUnusedRow } from '../../shared/schema/company';
import { z } from 'zod';
import { SELECTION_CARD_KEYS, STATUS_KEYS } from '../../shared/labels';
import { martTtlSec, type RefreshMeta } from './refreshMeta';
import { bool, buildBoardCompany, mergeCompany, MONTHS_IN_MART, num, numOrNull, str, toMonthly, type MonthlyAgg } from './boardService';
import { applicationCohortQuery, benchSeriesQuery, companyAccountMonthlyQuery, companyJobMonthlyQuery, companyJobsQuery, companyLoginByIdQuery, companyMasterByIdQuery, companyMonthlyByIdQuery, dailyUsageQuery, memberAttributesQuery, scoutCohortQuery } from '../sql/companyDetail';
import { rowToValues, type TargetRow } from '../d1/targetsRepo';
import type { SettingsRow } from '../d1/settingsRepo';

export type CompanyCore = Omit<CompanyDetailResponse, 'settings' | 'targetsByMonth'>;

/** cms_company_master.scout_unused_json（JSON 配列の文字列）→ 行。壊れていれば空 */
export function parseScoutUnused(raw: unknown): ScoutUnusedRow[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = z.array(ScoutUnusedRowSchema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** cms_company_master.accounts_json（[{type, profile_id, profile_name, language}]）→ 種別ごとにまとめた一覧。壊れていれば空 */
export function parseAccounts(raw: unknown): Account[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = z.array(z.object({ type: z.string(), profile_id: z.union([z.number(), z.string()]), profile_name: z.string().nullable().optional(), language: z.string().nullable().optional() })).safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    const by = new Map<string, Account>();
    for (const p of parsed.data) {
      const a = by.get(p.type) ?? { type: p.type, profiles: [] };
      a.profiles.push({ id: String(p.profile_id), name: p.profile_name ?? null, lang: p.language ?? null });
      by.set(p.type, a);
    }
    return Array.from(by.values()).map((a) => AccountSchema.parse(a));
  } catch {
    return [];
  }
}

/** cms_company_master.jobs_json（[{a, k, s, e}]）→ 求人の一覧。壊れていれば空 */
export function parseJobs(raw: unknown): JobRange[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = z.array(z.object({ a: z.string(), k: z.union([z.number(), z.string()]), s: z.string(), e: z.string().nullable().optional() })).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.map((j) => JobRangeSchema.parse({ account: j.a, key: String(j.k), from: j.s, to: j.e ?? null })) : [];
  } catch {
    return [];
  }
}

/** 属性 API で指定できるアカウント種別 */
export const ACCOUNT_TYPES = ['直接', '紹介', '派遣'] as const;

/** API の求人キー（'direct' = 企業への直接応募）→ マートの job_key */
export function jobKeyToMart(job: string | null): string | null {
  return job === null ? null : job === 'direct' ? '(direct)' : job;
}
export function jobKeyFromMart(key: string): string {
  return key === '(direct)' ? 'direct' : key;
}

/** 選考状況のカード用: st06〜st11 を行から取り出す */
function stOf(r: Row): Record<string, number> {
  const st: Record<string, number> = {};
  for (const k of SELECTION_CARD_KEYS) st[k] = num(r[k]);
  return st;
}

export async function loadCompanyCore(client: BqClient, companyId: string, month: string, refresh: RefreshMeta, now: Date = new Date()): Promise<CompanyCore | null> {
  const currentMonth = monthOf(refresh.dataVersion);
  const months = lastNMonths(currentMonth, MONTHS_IN_MART);
  if (!months.includes(month)) throw new Error(`month ${month} is outside the mart window`);
  const master = (await client.run(companyMasterByIdQuery(companyId))).rows[0];
  if (!master) return null;
  const industry = String(master.industry ?? '(未設定)');
  const type = String(master.company_type ?? '不明');
  const [monthly, daily, scoutCohort, appCohort, acctMonthly, bench, login] = await Promise.all([
    client.run(companyMonthlyByIdQuery(companyId)),
    client.run(dailyUsageQuery(companyId)),
    client.run(scoutCohortQuery(companyId)),
    client.run(applicationCohortQuery(companyId)),
    client.run(companyAccountMonthlyQuery(companyId)),
    client.run(benchSeriesQuery(industry, type)),
    client.run(companyLoginByIdQuery(companyId)),
  ]);
  const mm = new Map<string, MonthlyAgg>();
  for (const r of monthly.rows) mm.set(String(r.month_ym), toMonthly(r));
  const lg = login.rows[0];
  const company = buildBoardCompany({ ...master, company_id: companyId }, mm, lg, month, months);
  const isCurrentMonth = month === currentMonth;
  const biz = isCurrentMonth
    ? monthProgress(month, refresh.dataDate < `${month}-01` ? `${month}-01` : refresh.dataDate)
    : (() => {
        const p = monthProgress(month, `${month}-31`);
        return { total: p.total, elapsed: p.total, rate: 1 };
      })();
  const meta: BoardMeta = { month, isCurrentMonth, asOf: todayJst(now), dataDate: refresh.dataDate, bizDays: biz, months, benchMinN: 5, dataVersion: refresh.dataVersion, generatedAt: now.toISOString(), mock: client.mock, loginAvailableFrom: '2026-05-15' };
  return {
    meta,
    company,
    extra: {
      internalName: str(master.internal_name),
      djContractType: str(master.dj_contract_type),
      contractFrom2: str(master.contract_from),
      contractTo2: str(master.contract_to),
      sfAccountName: str(master.sf_account_name),
      sfContractStatus: str(master.sf_contract_status),
      sfContractStart: str(master.sf_contract_start),
      sfContractEnd: str(master.sf_contract_end),
      sfAccountOwner: { name: str(master.sf_account_owner_name), position: str(master.sf_account_owner_position) },
      sfContractOwner: { name: str(master.sf_contract_owner_name), position: str(master.sf_contract_owner_position) },
      profileCount: num(master.profile_count),
      activeJobsNow: num(master.active_jobs_now),
      jobsWindowDistinct: numOrNull(master.jobs_window_distinct),
      login: { last: str(lg?.last_login_date), lastAt: str(lg?.last_login_at), daysSince: numOrNull(lg?.days_since_login), days30: num(lg?.login_days_30d), days90: num(lg?.login_days_90d), daysMtd: num(lg?.login_days_mtd), throughDate: str(lg?.data_through_date) },
    },
    monthly: months.map((ym) => {
      const r = monthly.rows.find((x) => String(x.month_ym) === ym);
      const a = r ? toMonthly(r) : null;
      const st: Record<string, number> = {};
      for (const k of STATUS_KEYS) st[k] = num(r?.[k]);
      return { month: ym, contracted: a?.contracted ?? false, jobs: a?.jobs ?? 0, newJobs: a?.newJobs ?? 0, sent: a?.sent ?? 0, sentManual: a?.sentManual ?? 0, sentAuto: a?.sentAuto ?? 0, int: a?.int ?? 0, intReply: a?.intReply ?? 0, apps: a?.apps ?? 0, views: a?.views ?? 0, hires: a?.hires ?? 0, hiresApp: num(r?.hires_from_application), hiresScout: num(r?.hires_from_scout), inSel: a?.inSel ?? 0, loginDays: a?.loginDays ?? null, st };
    }),
    daily: daily.rows.map((r) => ({ date: String(r.usage_date), month: String(r.month_ym), day: num(r.day_of_month), sent: num(r.scout_sent), sentCum: num(r.scout_sent_cum), apps: num(r.applications), appsCum: num(r.applications_cum), int: num(r.interested), intCum: num(r.interested_cum), views: num(r.job_views), viewsCum: num(r.job_views_cum), jobs: num(r.active_jobs), login: num(r.login_events) })),
    cohorts: {
      scout: scoutCohort.rows.map((r) => ({ month: String(r.month_ym), status: String(r.status), count: num(r.cnt), members: num(r.members) })),
      application: appCohort.rows.map((r) => ({ month: String(r.month_ym), status: String(r.status), count: num(r.cnt), members: num(r.members) })),
    },
    accounts: parseAccounts(master.accounts_json),
    accountMonthly: acctMonthly.rows
      .filter((r) => months.includes(String(r.month_ym)))
      .map((r) => ({ account: String(r.account_type), month: String(r.month_ym), jobs: num(r.active_jobs_eom), sent: num(r.scout_sent), intReply: num(r.interested_by_reply_month), apps: num(r.applications), views: num(r.job_views), hiresApp: num(r.hires_from_application), hiresScout: num(r.hires_from_scout), inSel: num(r.in_selection), st: stOf(r) })),
    jobs: parseJobs(master.jobs_json),
    scoutUnused: parseScoutUnused(master.scout_unused_json),
    benchSeries: bench.rows.map((b) => ({ month: String(b.month_ym), industry: String(b.industry), companyType: String(b.company_type), metric: String(b.metric), n: num(b.n_companies), mean: numOrNull(b.mean), p25: numOrNull(b.p25), median: numOrNull(b.median), p75: numOrNull(b.p75) })),
  };
}

export async function getCompanyCore(client: BqClient, companyId: string, month: string, refresh: RefreshMeta, cacheEpoch: string, opts: { now?: Date; refresh?: boolean; capSec?: number; ctx?: { waitUntil(p: Promise<unknown>): void } } = {}): Promise<{ core: CompanyCore | null; hit: boolean }> {
  const now = opts.now ?? new Date();
  const key = await cacheKey('company-core', { id: companyId, month, dv: refresh.dataVersion, epoch: cacheEpoch, v: DATA_VERSION, mock: client.mock });
  if (!opts.refresh) {
    const hit = await cacheGet<CompanyCore>(key);
    if (hit) return { core: hit, hit: true };
  }
  const core = await loadCompanyCore(client, companyId, month, refresh, now);
  if (core) await cachePut(key, core, martTtlSec(refresh, now, opts.capSec), opts.ctx);
  return { core, hit: false };
}

/** 属性の内訳（期間 from〜to の月、アカウント種別 or 全体、求人 or 全求人）。マート側で集約済みの行を返す。求人指定時は閲覧 / 応募だけ（スカウトは求人に紐付かない） */
export async function loadAttributes(client: BqClient, companyId: string, from: string, to: string, account: string | null, job: string | null = null): Promise<AttributesResponse> {
  const res = await client.run(memberAttributesQuery(companyId, `${from}-01`, `${to}-01`, account, jobKeyToMart(job)));
  const rows: AttributeRow[] = [];
  for (const r of res.rows) {
    const parsed = AttributeRowSchema.safeParse({ kind: String(r.kind), type: String(r.attribute_type), value: String(r.attribute_value), count: num(r.scouts), interested: num(r.interested_scouts) });
    if (parsed.success) rows.push(parsed.data);
  }
  return { from, to, account, job, rows };
}

type CacheOpts = { now?: Date; refresh?: boolean; capSec?: number; ctx?: { waitUntil(p: Promise<unknown>): void } };

export async function getAttributes(client: BqClient, companyId: string, from: string, to: string, account: string | null, refresh: RefreshMeta, cacheEpoch: string, opts: CacheOpts & { job?: string | null } = {}): Promise<{ body: AttributesResponse; hit: boolean }> {
  const now = opts.now ?? new Date();
  const job = opts.job ?? null;
  const key = await cacheKey('company-attributes', { id: companyId, from, to, account, job, dv: refresh.dataVersion, epoch: cacheEpoch, v: DATA_VERSION, mock: client.mock });
  if (!opts.refresh) {
    const hit = await cacheGet<AttributesResponse>(key);
    if (hit) return { body: hit, hit: true };
  }
  const body = await loadAttributes(client, companyId, from, to, account, job);
  await cachePut(key, body, martTtlSec(refresh, now, opts.capSec), opts.ctx);
  return { body, hit: false };
}

/** 求人単位の集計（期間・アカウント種別）と、求人指定時はその求人の月次。cms_company_job_monthly から */
export async function loadJobs(client: BqClient, companyId: string, from: string, to: string, account: string | null, job: string | null): Promise<JobsResponse> {
  const [agg, monthly] = await Promise.all([
    client.run(companyJobsQuery(companyId, `${from}-01`, `${to}-01`, account)),
    job === null ? Promise.resolve(null) : client.run(companyJobMonthlyQuery(companyId, jobKeyToMart(job) ?? job, `${from}-01`, `${to}-01`, account)),
  ]);
  const rows: JobRow[] = agg.rows.map((r) => ({
    key: jobKeyFromMart(String(r.job_key)),
    title: String(r.job_title ?? ''),
    account: String(r.account_type ?? ''),
    direct: bool(r.is_direct),
    publishFrom: str(r.publish_from),
    publishTo: str(r.publish_to),
    views: num(r.job_views),
    apps: num(r.applications),
    hiresApp: num(r.hires_from_application),
    st: stOf(r),
  }));
  return { from, to, account, job, rows, monthly: (monthly?.rows ?? []).map((r) => ({ month: String(r.month_ym), views: num(r.job_views), apps: num(r.applications), hiresApp: num(r.hires_from_application), st: stOf(r) })) };
}

export async function getJobs(client: BqClient, companyId: string, from: string, to: string, account: string | null, job: string | null, refresh: RefreshMeta, cacheEpoch: string, opts: CacheOpts = {}): Promise<{ body: JobsResponse; hit: boolean }> {
  const now = opts.now ?? new Date();
  const key = await cacheKey('company-jobs', { id: companyId, from, to, account, job, dv: refresh.dataVersion, epoch: cacheEpoch, v: DATA_VERSION, mock: client.mock });
  if (!opts.refresh) {
    const hit = await cacheGet<JobsResponse>(key);
    if (hit) return { body: hit, hit: true };
  }
  const body = await loadJobs(client, companyId, from, to, account, job);
  await cachePut(key, body, martTtlSec(refresh, now, opts.capSec), opts.ctx);
  return { body, hit: false };
}

export function settingsToApi(s: SettingsRow | null): CompanySettings | null {
  if (!s) return null;
  return { csOwnerEmail: s.cs_owner_email, csOwnerName: s.cs_owner_name, scoutLimitPeriod: s.scout_limit_period, scoutLimitOverride: s.scout_limit_override, jobLimitOverride: s.job_limit_override, memo: s.memo, updatedBy: s.updated_by, updatedAt: s.updated_at };
}

export function mergeCompanyDetail(core: CompanyCore, targets: TargetRow[], settings: SettingsRow | null, viewerEmail: string | null, benchMinN: number): CompanyDetailResponse {
  const forMonth = targets.find((t) => t.target_month === core.meta.month) ?? null;
  const targetsByMonth: Record<string, ReturnType<typeof rowToValues>> = {};
  for (const t of targets) targetsByMonth[t.target_month] = rowToValues(t);
  return { ...core, meta: { ...core.meta, benchMinN }, company: mergeCompany(core.company, settings, forMonth, viewerEmail), settings: settingsToApi(settings), targetsByMonth };
}
