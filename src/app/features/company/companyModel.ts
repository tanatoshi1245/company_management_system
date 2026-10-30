import { useMemo } from 'react';
import type { AttributesResponse, CompanyDetailResponse, JobRow, JobsResponse } from '../../../shared/schema/company';
import type { BenchRow } from '../../../shared/schema/board';
import { makeContext, scoreCompany, type ScoredCompany } from '../../../shared/metrics/score';
import { LEVEL_ATTRIBUTES, SELECTION_CARD_KEYS } from '../../../shared/labels';
import { endOfMonth, monthOf } from '../../../shared/calendar/periods';
import type { PieMode } from './components/AttributePiePanel';

export interface SeriesByMonth {
  months: string[];
  /** 表示期間の最初の月 */
  fromMonth: string;
  /** 契約開始がマートの窓（直近 13 か月 + 当月）より前で、表示の起点を窓の先頭にしている */
  truncated: boolean;
  /** 当月（最後の点）は途中経過 */
  partialLast: boolean;
}

/** 属性 1 値の件数（円グラフの 1 スライス） */
export interface AttributeBreakdown {
  value: string;
  count: number;
}

/** 選択期間（契約期間中・窓内の月）・選択アカウントの累積 */
export interface Totals {
  months: string[];
  fromMonth: string;
  truncated: boolean;
  /** 期間に掲載期間が重なる求人数（set_id で重複排除。jobs の一覧から数える） */
  jobsDistinct: number | null;
  views: number;
  apps: number;
  hiresApp: number;
  sent: number;
  intReply: number;
  hiresScout: number;
  /** 現在の選考中（期間の終了月に応募 / 興味あり返信した人の現ステータス件数） */
  inSel: number;
}

export interface CompanyModel {
  scored: ScoredCompany;
  months: string[];
  /** 表示期間（from〜to のうち契約期間に入る月） */
  period: string[];
  totals: Totals;
  /** 閲覧件数・応募件数の単月推移（求人選択時はその求人） */
  viewsApps: SeriesByMonth & { views: number[]; apps: number[] };
  /** スカウト送信数・興味あり返信数（返信月基準）の単月推移（求人フィルタは効かない） */
  scoutTrend: SeriesByMonth & { sent: number[]; intReply: number[] };
  /** 選考状況のカード: 期間中に応募 / 興味あり返信した人の、今のステータス別の人数（st06〜st11。求人選択時は応募側だけ） */
  selection: Record<string, number>;
  /** 選択中の求人（求人 API の集約行）。未選択・期間内にデータ無しは null */
  jobRow: JobRow | null;
}

export type CompanyTab = 'jobs' | 'scout' | 'selection';
export const COMPANY_TABS: { key: CompanyTab; label: string }[] = [
  { key: 'jobs', label: '求人の実績' },
  { key: 'scout', label: 'スカウトの実績' },
  { key: 'selection', label: '選考状況' },
];

export interface PeriodSelection {
  from: string;
  to: string;
  /** '' = 全体、それ以外はアカウント種別（直接 / 紹介 / 派遣） */
  account: string;
  /** '' = 全求人、それ以外は求人キー（set_id / job_id、または 'direct'） */
  job: string;
}

interface Agg {
  jobs: number;
  sent: number;
  intReply: number;
  apps: number;
  views: number;
  hiresApp: number;
  hiresScout: number;
  inSel: number;
}

/** 値の先頭の番号（"6. ネイティヴ" → 6）。無ければ null */
function levelNo(v: string): number | null {
  const m = /^(\d+)\./.exec(v);
  return m ? Number(m[1]) : null;
}

/** 属性の値を並べる: 語学レベルは番号の降順、他は件数順。(未入力) は末尾 */
function sortBreakdown(type: string, rows: AttributeBreakdown[]): AttributeBreakdown[] {
  return rows.sort((a, b) => {
    if (a.value === '(未入力)') return 1;
    if (b.value === '(未入力)') return -1;
    if (LEVEL_ATTRIBUTES.has(type)) return (levelNo(b.value) ?? -1) - (levelNo(a.value) ?? -1) || b.count - a.count;
    return b.count - a.count;
  });
}

/** 期間の既定: 開始 = 契約開始月（窓より前なら窓の先頭）、終了 = 当月（API の month） */
export function defaultPeriod(d: CompanyDetailResponse): { from: string; to: string } {
  const start = monthOf(d.company.contract.from);
  const first = d.meta.months[0];
  return { from: start > first ? (start > d.meta.month ? d.meta.month : start) : first, to: d.meta.month };
}

/** URL の from / to / account を検証して確定させる（窓の外・逆順・無いアカウントは既定に戻す） */
export function resolvePeriod(d: CompanyDetailResponse, url: { from: string; to: string; account: string; job?: string }): PeriodSelection {
  const def = defaultPeriod(d);
  const months = d.meta.months;
  const to = months.includes(url.to) ? url.to : def.to;
  let from = months.includes(url.from) ? url.from : def.from;
  if (from > to) from = to;
  const account = d.accounts.length > 1 && d.accounts.some((a) => a.type === url.account) ? url.account : '';
  const job = /^(\d{1,12}|direct)$/.test(url.job ?? '') ? (url.job as string) : '';
  return { from, to, account, job };
}

/** 属性 API の応答 → 円グラフ用の内訳（mode × 属性種別 → 値と件数） */
export function buildBreakdown(attrs: AttributesResponse | null): Record<PieMode, Record<string, AttributeBreakdown[]>> {
  const acc: Record<PieMode, Map<string, Map<string, number>>> = { sent: new Map(), replied: new Map(), viewed: new Map(), applied: new Map() };
  const add = (mode: PieMode, type: string, value: string, n: number) => {
    if (n <= 0) return;
    const t = acc[mode].get(type) ?? new Map<string, number>();
    t.set(value, (t.get(value) ?? 0) + n);
    acc[mode].set(type, t);
  };
  for (const a of attrs?.rows ?? []) {
    if (a.kind === 'view') add('viewed', a.type, a.value, a.count);
    else if (a.kind === 'application') add('applied', a.type, a.value, a.count);
    else {
      add('sent', a.type, a.value, a.count);
      add('replied', a.type, a.value, a.interested);
    }
  }
  const out = { sent: {}, replied: {}, viewed: {}, applied: {} } as Record<PieMode, Record<string, AttributeBreakdown[]>>;
  for (const mode of ['sent', 'replied', 'viewed', 'applied'] as PieMode[]) {
    for (const [type, vals] of acc[mode]) out[mode][type] = sortBreakdown(type, Array.from(vals, ([value, count]) => ({ value, count })));
  }
  return out;
}

/** 期間に掲載期間が重なる求人数（set_id で重複排除）。アカウント指定ならそのアカウントの求人だけ */
export function countJobs(jobs: CompanyDetailResponse['jobs'], from: string, to: string, account: string, asOf: string): number {
  const start = `${from}-01`;
  const end = to === monthOf(asOf) ? asOf : endOfMonth(`${to}-01`);
  const keys = new Set<string>();
  for (const j of jobs) {
    if (account && j.account !== account) continue;
    if (j.from <= end && (j.to === null || j.to >= start)) keys.add(j.key);
  }
  return keys.size;
}

export function useCompanyModel(d: CompanyDetailResponse | null, sel: PeriodSelection | null, jobs: JobsResponse | null = null): CompanyModel | null {
  return useMemo(() => {
    if (!d || !sel) return null;
    const month = d.meta.month;
    const benchForMonth: BenchRow[] = d.benchSeries.filter((b) => b.month === month);
    const ctx = makeContext(benchForMonth, d.meta.benchMinN, d.meta.bizDays.rate, d.meta.bizDays.elapsed, d.meta.isCurrentMonth);
    const scored = scoreCompany(d.company, ctx);
    const months = d.monthly.map((m) => m.month);
    // 契約期間に入る月だけ（開始月以降、終了月まで）。そのうち選択期間 from〜to
    const startMonth = monthOf(d.company.contract.from);
    const endMonth = d.company.contract.to ? monthOf(d.company.contract.to) : null;
    const period = months.filter((m) => m >= startMonth && (endMonth === null || m <= endMonth) && m >= sel.from && m <= sel.to);
    const truncated = startMonth < months[0] && sel.from === months[0];
    const partialLast = d.meta.isCurrentMonth && period[period.length - 1] === month;
    const base = { months: period, fromMonth: period[0] ?? sel.from, truncated, partialLast };
    // 値の元: 全体は monthly、アカウント指定は accountMonthly のその種別の行
    const byMonth = new Map<string, Agg>();
    if (sel.account) {
      for (const r of d.accountMonthly) if (r.account === sel.account) byMonth.set(r.month, r);
    } else {
      for (const r of d.monthly) byMonth.set(r.month, r);
    }
    const series = (k: keyof Agg) => period.map((m) => byMonth.get(m)?.[k] ?? 0);
    const sum = (xs: number[]) => xs.reduce((a, v) => a + v, 0);
    // 求人フィルタ: 求人 API の月次（応募側だけ）で閲覧・応募・採用（応募経由）・選考状況を差し替える。スカウトは求人に紐付かないのでそのまま
    const jobOn = sel.job !== '' && jobs !== null && jobs.job === sel.job;
    const jobRow = jobOn ? (jobs.rows.find((r) => r.key === sel.job) ?? null) : null;
    const jobByMonth = new Map<string, JobsResponse['monthly'][number]>();
    if (jobOn) for (const r of jobs.monthly) jobByMonth.set(r.month, r);
    const jobSeries = (k: 'views' | 'apps' | 'hiresApp') => period.map((m) => jobByMonth.get(m)?.[k] ?? 0);
    const stSource = (m: string): Record<string, number> => (jobOn ? jobByMonth.get(m)?.st : sel.account ? d.accountMonthly.find((r) => r.account === sel.account && r.month === m)?.st : d.monthly.find((r) => r.month === m)?.st) ?? {};
    const selection: Record<string, number> = {};
    for (const k of SELECTION_CARD_KEYS) selection[k] = period.reduce((a, m) => a + (stSource(m)[k] ?? 0), 0);
    const totals: Totals = {
      months: period,
      fromMonth: base.fromMonth,
      truncated,
      jobsDistinct: jobOn ? (jobRow ? 1 : 0) : countJobs(d.jobs, sel.from, sel.to, sel.account, d.meta.asOf),
      views: jobOn ? sum(jobSeries('views')) : sum(series('views')),
      apps: jobOn ? sum(jobSeries('apps')) : sum(series('apps')),
      hiresApp: jobOn ? sum(jobSeries('hiresApp')) : sum(series('hiresApp')),
      sent: sum(series('sent')),
      intReply: sum(series('intReply')),
      hiresScout: sum(series('hiresScout')),
      inSel: byMonth.get(sel.to)?.inSel ?? 0,
    };
    return {
      scored,
      months,
      period,
      totals,
      viewsApps: { ...base, views: jobOn ? jobSeries('views') : series('views'), apps: jobOn ? jobSeries('apps') : series('apps') },
      scoutTrend: { ...base, sent: series('sent'), intReply: series('intReply') },
      selection,
      jobRow,
    };
  }, [d, sel, jobs]);
}
