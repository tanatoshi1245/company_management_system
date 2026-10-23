import type { BqClient } from '../bq/client';
import type { Row } from '../bq/parseRows';
import { cacheGet, cacheKey, cachePut } from '../lib/cache';
import { companyMasterQuery } from '../sql/companyMaster';
import { companyMonthlyQuery } from '../sql/companyMonthly';
import { companyLoginQuery } from '../sql/companyLogin';
import { industryBenchmarkQuery } from '../sql/industryBenchmark';
import { addMonths, lastNMonths, monthOf, todayJst } from '../../shared/calendar/periods';
import { monthProgress } from '../../shared/calendar/businessDays';
import { DATA_VERSION } from '../../shared/schema/common';
import type { BenchRow, BoardCompany, BoardMeta } from '../../shared/schema/board';
import { CURRENT_STATES } from '../../shared/metrics/board';
import { martTtlSec, type RefreshMeta } from './refreshMeta';
import type { TargetRow } from '../d1/targetsRepo';
import { rowToValues } from '../d1/targetsRepo';
import type { SettingsRow } from '../d1/settingsRepo';

export const MONTHS_IN_MART = 14;

export interface BoardCore {
  meta: BoardMeta;
  companies: BoardCompany[];
  benchmarks: BenchRow[];
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => v === true || v === 'true';

interface MonthlyRow {
  contracted: boolean;
  jobs: number;
  newJobs: number;
  sent: number;
  sentManual: number;
  sentAuto: number;
  sentCtd: number;
  int: number;
  intReply: number;
  apps: number;
  views: number;
  hires: number;
  inSel: number;
  noResp: number;
  hired: number;
  loginDays: number | null;
}

const ZERO: MonthlyRow = { contracted: false, jobs: 0, newJobs: 0, sent: 0, sentManual: 0, sentAuto: 0, sentCtd: 0, int: 0, intReply: 0, apps: 0, views: 0, hires: 0, inSel: 0, noResp: 0, hired: 0, loginDays: null };

/** マスタ 1 行 + 月次 + ログイン → ボードの企業 1 行（targets / isMine はあとで合成） */
export function buildBoardCompany(r: Row, mm: Map<string, MonthlyRow>, lg: Row | undefined, month: string, months: string[]): BoardCompany {
  const id = String(r.company_id);
  const m = mm.get(month) ?? ZERO;
  const prev = mm.get(addMonths(month, -1)) ?? ZERO;
  const state = String(r.contract_state ?? 'ended');
  const series = (k: keyof MonthlyRow): number[] => months.map((ym) => num(mm.get(ym)?.[k] ?? 0));
  const ownerEmail = str(r.cs_owner_email_default);
  const ownerName = str(r.cs_owner_name_default);
  return {
    id,
    name: String(r.company_name ?? r.internal_name ?? id),
    type: String(r.company_type ?? '不明'),
    ind: String(r.industry ?? '(未設定)'),
    indSrc: String(r.industry_source ?? 'none'),
    state,
    plan: str(r.plan_name),
    planSrc: String(r.plan_source ?? 'none'),
    owner: { email: ownerEmail, name: ownerName, src: ownerEmail || ownerName ? String(r.owner_source ?? 'none') : 'none' },
    sfOwnerName: str(r.sf_account_owner_name),
    salesStaff: str(r.sales_staff),
    contract: { from: String(r.active_from), to: str(r.active_to), daysToEnd: numOrNull(r.days_to_contract_end), daysSinceStart: num(r.days_since_contract_start), daysTotal: numOrNull(r.contract_days_total) },
    limits: { scout: numOrNull(r.scout_limit), job: numOrNull(r.job_posting_limit), period: 'month' },
    signals: { dj: bool(r.is_contracted_now), sfActive: bool(r.sf_active_contract), sfWon: bool(r.sf_live_won_opp), da: bool(r.da_active_profile), sfLinked: r.sf_link_status === 'linked', noticeCheck: bool(r.sf_notice_check) },
    m,
    prev: { jobs: prev.jobs, sent: prev.sent, int: prev.int, apps: prev.apps, views: prev.views, hires: prev.hires },
    login: { last: str(lg?.last_login_date), daysSince: numOrNull(lg?.days_since_login), days30: num(lg?.login_days_30d), daysMtd: num(lg?.login_days_mtd) },
    trend: { sent: series('sent'), int: series('int'), apps: series('apps'), views: series('views'), jobs: series('jobs'), hires: series('hires') },
    targets: null,
    isMine: false,
  };
}

export { toMonthly, ZERO as ZERO_MONTHLY, num, numOrNull, str, bool };
export type { MonthlyRow as MonthlyAgg };

function toMonthly(r: Row): MonthlyRow {
  return {
    contracted: bool(r.is_contracted_in_month),
    jobs: num(r.active_jobs_eom),
    newJobs: num(r.new_jobs),
    sent: num(r.scout_sent),
    sentManual: num(r.scout_sent_manual),
    sentAuto: num(r.scout_sent_auto),
    sentCtd: num(r.scout_sent_contract_to_date),
    int: num(r.interested_by_send_month),
    intReply: num(r.interested_by_reply_month),
    apps: num(r.applications),
    views: num(r.job_views),
    hires: num(r.hires),
    inSel: num(r.in_selection),
    noResp: num(r.st01_no_response),
    hired: num(r.st11_hired),
    loginDays: numOrNull(r.login_days),
  };
}

/** マートから選択月のボードの元データを組み立てる（D1・ログイン者は含めない。キャッシュ対象） */
export async function loadBoardCore(client: BqClient, month: string, refresh: RefreshMeta, now: Date = new Date()): Promise<BoardCore> {
  const [master, monthly, login, bench] = await Promise.all([client.run(companyMasterQuery()), client.run(companyMonthlyQuery()), client.run(companyLoginQuery()), client.run(industryBenchmarkQuery(month))]);
  const currentMonth = monthOf(refresh.dataVersion);
  const months = lastNMonths(currentMonth, MONTHS_IN_MART);
  if (!months.includes(month)) throw new Error(`month ${month} is outside the mart window`);
  const isCurrentMonth = month === currentMonth;
  const prevMonth = addMonths(month, -1);

  const byCompany = new Map<string, Map<string, MonthlyRow>>();
  for (const r of monthly.rows) {
    const id = String(r.company_id);
    const m = byCompany.get(id) ?? new Map<string, MonthlyRow>();
    m.set(String(r.month_ym), toMonthly(r));
    byCompany.set(id, m);
  }
  const loginById = new Map<string, Row>(login.rows.map((r) => [String(r.company_id), r]));

  const companies: BoardCompany[] = [];
  for (const r of master.rows) {
    const id = String(r.company_id);
    const mm = byCompany.get(id) ?? new Map<string, MonthlyRow>();
    const m = mm.get(month) ?? ZERO;
    const state = String(r.contract_state ?? 'ended');
    if (!CURRENT_STATES.has(state) && !m.contracted) continue;
    companies.push(buildBoardCompany(r, mm, loginById.get(id), month, months));
  }

  const benchmarks: BenchRow[] = bench.rows.map((b) => ({
    industry: String(b.industry),
    companyType: String(b.company_type),
    metric: String(b.metric),
    n: num(b.n_companies),
    mean: numOrNull(b.mean),
    p25: numOrNull(b.p25),
    median: numOrNull(b.median),
    p75: numOrNull(b.p75),
  }));

  const biz = isCurrentMonth ? monthProgress(month, refresh.dataDate < `${month}-01` ? `${month}-01` : refresh.dataDate) : (() => {
    const p = monthProgress(month, `${month}-31`);
    return { total: p.total, elapsed: p.total, rate: 1 };
  })();

  const meta: BoardMeta = {
    month,
    isCurrentMonth,
    asOf: todayJst(now),
    dataDate: refresh.dataDate,
    bizDays: biz,
    months,
    benchMinN: 5,
    dataVersion: refresh.dataVersion,
    generatedAt: now.toISOString(),
    mock: client.mock,
    loginAvailableFrom: '2026-05-15',
  };
  return { meta, companies, benchmarks };
}

/** Cache API 付き。キー = 月 + マートの版 + cache_epoch + 応答の版 */
export async function getBoardCore(client: BqClient, month: string, refresh: RefreshMeta, cacheEpoch: string, opts: { now?: Date; refresh?: boolean; capSec?: number; ctx?: { waitUntil(p: Promise<unknown>): void } } = {}): Promise<{ core: BoardCore; hit: boolean }> {
  const now = opts.now ?? new Date();
  const key = await cacheKey('board-core', { month, dv: refresh.dataVersion, epoch: cacheEpoch, v: DATA_VERSION, mock: client.mock });
  if (!opts.refresh) {
    const hit = await cacheGet<BoardCore>(key);
    if (hit) return { core: hit, hit: true };
  }
  const core = await loadBoardCore(client, month, refresh, now);
  await cachePut(key, core, martTtlSec(refresh, now, opts.capSec), opts.ctx);
  return { core, hit: false };
}

/** リクエストごとの合成: D1 の設定（担当上書き・枠）と目標、ログイン者の isMine */
export function mergeBoard(core: BoardCore, targets: Map<string, TargetRow>, settings: Map<string, SettingsRow>, viewerEmail: string | null, benchMinN: number): BoardCore {
  const me = viewerEmail?.trim().toLowerCase() ?? null;
  const companies = core.companies.map((c) => mergeCompany(c, settings.get(c.id) ?? null, targets.get(c.id) ?? null, me));
  return { meta: { ...core.meta, benchMinN }, companies, benchmarks: core.benchmarks };
}

/** 企業 1 行に D1 の設定（担当上書き・枠）と目標、ログイン者の isMine を合成 */
export function mergeCompany(c: BoardCompany, s: SettingsRow | null, t: TargetRow | null, viewerEmail: string | null): BoardCompany {
  const me = viewerEmail?.trim().toLowerCase() ?? null;
  const owner = s?.cs_owner_email ? { email: s.cs_owner_email.toLowerCase(), name: s.cs_owner_name ?? s.cs_owner_email, src: 'override' } : c.owner;
  const limits = { scout: s?.scout_limit_override ?? c.limits.scout, job: s?.job_limit_override ?? c.limits.job, period: (s?.scout_limit_period ?? 'month') as 'month' | 'contract' };
  return { ...c, owner, limits, targets: t ? rowToValues(t) : null, isMine: Boolean(me && owner.email && owner.email.toLowerCase() === me) };
}
