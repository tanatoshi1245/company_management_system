import type { BqClient } from '../../bq/client';
import type { D1Like } from '../../d1/db';
import { ScoutUnusedRepo } from '../../d1/scoutUnusedRepo';
import type { RefreshMeta } from '../../services/refreshMeta';
import { loadAttributes, loadCompanyCore, loadJobs, type CompanyCore } from '../../services/companyService';
import { overlayScoutUnused } from '../../services/scoutUnusedService';
import { addMonths } from '../../../shared/calendar/periods';
import { ATTRIBUTE_KINDS } from '../../../shared/schema/company';
import { SELECTION_CARD_KEYS, SELECTION_CARD_LABEL } from '../../../shared/labels';
import type { ReportInput } from '../../../shared/ai/report';

/**
 * ① AI 分析とレポート生成で、セッションへ渡す数値（企業ページで表示している指標を、期間とアカウント種別で集め直したもの）。
 * 新しい SQL は書かない: 企業ページと同じサービス（companyService の loadCompanyCore / loadAttributes / loadJobs）を呼ぶ。
 * **企業名・担当者名は入れない**（企業 ID・業界・企業種別・プランだけ）。求人タイトルはそのまま渡す。
 * 指標の名前と意味は ./README.md の表。
 */
export const REPORT_DATA_MAX_BYTES = 80 * 1024;
const JOBS_TOP = 15;
const ATTR_TOP = 5;

const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const bytes = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;

export interface ReportMonthly {
  month: string;
  /** 月末の掲載求人数 */
  jobs: number;
  newJobs: number | null;
  sent: number;
  sentManual: number | null;
  sentAuto: number | null;
  /** 興味あり（送信月で数える。全体だけ） */
  interested: number | null;
  /** 興味あり返信（返信月で数える） */
  interestedReply: number;
  /** 興味あり返信率（%）= 全体: interested / sent、アカウント種別: interestedReply / sent */
  replyRatePct: number | null;
  views: number;
  apps: number;
  /** 閲覧 → 応募の率（%）= apps / views */
  applyRatePct: number | null;
  /** 採用（全体だけ。アカウント種別を選んだときは null で、内訳の hiresApp / hiresScout だけ） */
  hires: number | null;
  hiresApp: number;
  hiresScout: number;
  inSelection: number;
  loginDays: number | null;
}

export interface ReportTotals {
  months: number;
  sent: number;
  interested: number | null;
  interestedReply: number;
  replyRatePct: number | null;
  views: number;
  apps: number;
  applyRatePct: number | null;
  hires: number | null;
  hiresApp: number;
  hiresScout: number;
  newJobs: number | null;
  /** 期間の最後の月の月末の掲載求人数 */
  jobsAtEnd: number;
  loginDays: number | null;
}

export interface ReportData {
  period: { from: string; to: string; months: string[] };
  /** null = 全体 */
  account: string | null;
  dataDate: string;
  /** サンプルデータ（フィクスチャ）か */
  mock: boolean;
  company: {
    id: string;
    industry: string;
    companyType: string;
    plan: string | null;
    contractKind: string;
    contractState: string;
    contract: { from: string; to: string | null; daysToEnd: number | null };
    limits: { scoutPerPeriod: number | null; jobPostings: number | null };
    accountTypes: string[];
    activeJobsNow: number;
    login: { daysSince: number | null; days30: number; days90: number };
  };
  monthly: ReportMonthly[];
  totals: ReportTotals;
  /** 直前の同じ長さの期間（マートの窓の中にあるときだけ） */
  previous: { from: string; to: string; totals: ReportTotals } | null;
  /** 業界ベンチマーク（企業全体の指標。企業数が少ない群は使わない） */
  benchmarks: { month: string; metric: string; scope: string; n: number; median: number | null; p25: number | null; p75: number | null }[];
  /** 会員属性の上位（scout = スカウトを送った会員 / view = 求人を閲覧した会員 / application = 応募した会員） */
  attributes: Record<string, Record<string, { value: string; count: number; interested: number | null; sharePct: number | null }[]>>;
  /** 求人ごとの実績（閲覧の多い順） */
  jobs: { total: number; rows: { key: string; title: string; account: string; direct: boolean; publishFrom: string | null; publishTo: string | null; views: number; apps: number; applyRatePct: number | null; hiresApp: number; cond: { japanese: string; english: string; occupation: string; location: string; salary: string } | null; hotJob: boolean }[] };
  /** 選考状況（期間に応募・スカウトのあった分の、いまのステータス別の件数） */
  selection: { key: string; label: string; count: number }[];
  /** スカウト・応募のいまのステータス（期間の月に送信・応募した分。全体のときだけ） */
  cohorts: { scout: { status: string; count: number }[]; application: { status: string; count: number }[] } | null;
  /** スカウト未利用の記録（期間の月） */
  scoutUnused: { month: string; reason: string | null; remarks: string | null }[];
  notes: string[];
}

function monthlyOf(core: CompanyCore, months: string[], account: string | null): ReportMonthly[] {
  if (account === null) {
    return months.map((ym) => {
      const r = core.monthly.find((x) => x.month === ym);
      const sent = r?.sent ?? 0;
      const views = r?.views ?? 0;
      const apps = r?.apps ?? 0;
      return { month: ym, jobs: r?.jobs ?? 0, newJobs: r?.newJobs ?? 0, sent, sentManual: r?.sentManual ?? 0, sentAuto: r?.sentAuto ?? 0, interested: r?.int ?? 0, interestedReply: r?.intReply ?? 0, replyRatePct: pct(r?.int ?? 0, sent), views, apps, applyRatePct: pct(apps, views), hires: r?.hires ?? 0, hiresApp: r?.hiresApp ?? 0, hiresScout: r?.hiresScout ?? 0, inSelection: r?.inSel ?? 0, loginDays: r?.loginDays ?? null };
    });
  }
  return months.map((ym) => {
    const r = core.accountMonthly.find((x) => x.month === ym && x.account === account);
    const sent = r?.sent ?? 0;
    const views = r?.views ?? 0;
    const apps = r?.apps ?? 0;
    return { month: ym, jobs: r?.jobs ?? 0, newJobs: null, sent, sentManual: null, sentAuto: null, interested: null, interestedReply: r?.intReply ?? 0, replyRatePct: pct(r?.intReply ?? 0, sent), views, apps, applyRatePct: pct(apps, views), hires: null, hiresApp: r?.hiresApp ?? 0, hiresScout: r?.hiresScout ?? 0, inSelection: r?.inSel ?? 0, loginDays: null };
  });
}

function totalsOf(rows: ReportMonthly[]): ReportTotals {
  const nullable = (pick: (r: ReportMonthly) => number | null): number | null => (rows.some((r) => pick(r) !== null) ? sum(rows.map((r) => pick(r) ?? 0)) : null);
  const sent = sum(rows.map((r) => r.sent));
  const views = sum(rows.map((r) => r.views));
  const apps = sum(rows.map((r) => r.apps));
  const interested = nullable((r) => r.interested);
  const interestedReply = sum(rows.map((r) => r.interestedReply));
  return { months: rows.length, sent, interested, interestedReply, replyRatePct: pct(interested ?? interestedReply, sent), views, apps, applyRatePct: pct(apps, views), hires: nullable((r) => r.hires), hiresApp: sum(rows.map((r) => r.hiresApp)), hiresScout: sum(rows.map((r) => r.hiresScout)), newJobs: nullable((r) => r.newJobs), jobsAtEnd: rows[rows.length - 1]?.jobs ?? 0, loginDays: nullable((r) => r.loginDays) };
}

/** 業界ベンチマーク: 月 × 指標ごとに、企業数が足りる最も近い群（同業種・同種別 → 同業種 → 同種別 → 全体）を 1 つ選ぶ */
function benchmarksOf(core: CompanyCore, months: string[], minN: number): ReportData['benchmarks'] {
  const ind = core.company.ind;
  const type = core.company.type;
  const rank = (b: { industry: string; companyType: string }): number => (b.industry === ind && b.companyType === type ? 0 : b.industry === ind && b.companyType === '__ALL__' ? 1 : b.industry === '__ALL__' && b.companyType === type ? 2 : b.industry === '__ALL__' && b.companyType === '__ALL__' ? 3 : 9);
  const scope = ['同じ業界・同じ企業種別', '同じ業界', '同じ企業種別', '全体'];
  const best = new Map<string, { r: number; row: (typeof core.benchSeries)[number] }>();
  for (const b of core.benchSeries) {
    if (!months.includes(b.month) || b.n < minN) continue;
    const r = rank(b);
    if (r > 3) continue;
    const key = `${b.month}|${b.metric}`;
    const cur = best.get(key);
    if (!cur || r < cur.r) best.set(key, { r, row: b });
  }
  return Array.from(best.values())
    .map(({ r, row }) => ({ month: row.month, metric: row.metric, scope: scope[r] ?? '全体', n: row.n, median: row.median, p25: row.p25, p75: row.p75 }))
    .sort((a, b) => a.metric.localeCompare(b.metric) || a.month.localeCompare(b.month));
}

function statusTotals(cells: { month: string; status: string; count: number }[], months: string[]): { status: string; count: number }[] {
  const by = new Map<string, number>();
  for (const c of cells) if (months.includes(c.month)) by.set(c.status, (by.get(c.status) ?? 0) + c.count);
  return Array.from(by, ([status, count]) => ({ status, count })).sort((a, b) => a.status.localeCompare(b.status, 'ja', { numeric: true }));
}

/** 大きすぎるときに、細かい部分から順に削る（数値の本体 = monthly・totals は削らない） */
function fit(data: ReportData): ReportData {
  const steps: ((d: ReportData) => void)[] = [
    (d) => (d.jobs.rows = d.jobs.rows.slice(0, 8)),
    (d) => {
      for (const kind of Object.keys(d.attributes)) for (const type of Object.keys(d.attributes[kind] ?? {})) d.attributes[kind]![type] = (d.attributes[kind]![type] ?? []).slice(0, 3);
    },
    (d) => (d.benchmarks = d.benchmarks.filter((b) => b.month === d.period.to)),
    (d) => (d.cohorts = null),
    (d) => (d.jobs.rows = d.jobs.rows.slice(0, 3).map((j) => ({ ...j, title: j.title.slice(0, 60) }))),
    (d) => (d.attributes = {}),
    (d) => (d.scoutUnused = d.scoutUnused.map((s) => ({ ...s, remarks: s.remarks ? s.remarks.slice(0, 80) : s.remarks }))),
    (d) => (d.benchmarks = []),
  ];
  for (const step of steps) {
    if (bytes(data) <= REPORT_DATA_MAX_BYTES) break;
    step(data);
    if (!data.notes.includes('データが大きいため、一部（求人・属性・ベンチマークの明細）を省いています。')) data.notes.push('データが大きいため、一部（求人・属性・ベンチマークの明細）を省いています。');
  }
  return data;
}

/**
 * 期間（input.from〜to）とアカウント種別（input.account）の数値を集める。企業が無ければ null。
 * 期間がマートの窓の外なら loadCompanyCore が例外を投げる（呼ぶ側で先に確かめる）
 */
export async function collectReportData(client: BqClient, companyId: string, input: ReportInput, refresh: RefreshMeta, opts: { db?: D1Like | null; benchMinN?: number; now?: Date } = {}): Promise<ReportData | null> {
  const core = await loadCompanyCore(client, companyId, input.to, refresh, opts.now ?? new Date());
  if (!core) return null;
  const account = input.account;
  const window = core.meta.months;
  const months = window.filter((m) => m >= input.from && m <= input.to);
  const [attrs, jobs, unusedRows] = await Promise.all([
    loadAttributes(client, companyId, input.from, input.to, account),
    loadJobs(client, companyId, input.from, input.to, account, null),
    opts.db ? new ScoutUnusedRepo(opts.db).byCompanyIncludingDeleted(companyId).catch(() => []) : Promise.resolve([]),
  ]);

  const monthly = monthlyOf(core, months, account);
  const prevFrom = addMonths(input.from, -months.length);
  const prevTo = addMonths(input.from, -1);
  const prevMonths = window.filter((m) => m >= prevFrom && m <= prevTo);
  const previous = months.length > 0 && prevMonths.length === months.length ? { from: prevFrom, to: prevTo, totals: totalsOf(monthlyOf(core, prevMonths, account)) } : null;

  const attributes: ReportData['attributes'] = {};
  for (const kind of ATTRIBUTE_KINDS) {
    const byType = new Map<string, typeof attrs.rows>();
    for (const r of attrs.rows) if (r.kind === kind) byType.set(r.type, [...(byType.get(r.type) ?? []), r]);
    const out: ReportData['attributes'][string] = {};
    for (const [type, rows] of byType) {
      const total = sum(rows.map((r) => r.count));
      out[type] = [...rows].sort((a, b) => b.count - a.count).slice(0, ATTR_TOP).map((r) => ({ value: r.value, count: r.count, interested: kind === 'scout' ? r.interested : null, sharePct: pct(r.count, total) }));
    }
    attributes[kind] = out;
  }

  // 選考状況: 期間の月のステータス別件数（面接調整中 → 採用）を足す
  const stRows = account === null ? core.monthly.filter((r) => months.includes(r.month)).map((r) => r.st) : core.accountMonthly.filter((r) => months.includes(r.month) && r.account === account).map((r) => r.st);
  const selection = SELECTION_CARD_KEYS.map((key) => ({ key, label: SELECTION_CARD_LABEL[key] ?? key, count: sum(stRows.map((st) => st[key] ?? 0)) }));

  const unused = unusedRows.length ? overlayScoutUnused(JSON.stringify(core.scoutUnused), unusedRows) : core.scoutUnused;
  const c = core.company;
  const notes = [
    '数値は、企業ページと同じマートから集めた値です。ここに無い数値をスライドに書かないでください。',
    '興味あり返信率 = 興味あり ÷ スカウト送信（全体は送信月で数えた興味あり、アカウント種別を選んだときは返信月で数えた興味あり返信）。',
    '閲覧 → 応募の率 = 応募 ÷ 求人閲覧。',
    '選考状況は、期間に応募・スカウトのあった分の、いまのステータス別の件数です。',
  ];
  if (account !== null) notes.push(`アカウント種別「${account}」の数値です。ログイン日数・新規掲載・手動 / 自動の内訳・業界ベンチマークは企業全体でしか出せません（ベンチマークは企業全体の値）。`);
  if (core.meta.months[core.meta.months.length - 1] === input.to) notes.push(`期間の最後の月（${input.to}）は当月で、${core.meta.dataDate} までの途中の値です。`);

  return fit({
    period: { from: input.from, to: input.to, months },
    account,
    dataDate: core.meta.dataDate,
    mock: client.mock,
    company: {
      id: companyId,
      industry: c.ind,
      companyType: c.type,
      plan: c.plan,
      contractKind: c.contractKind,
      contractState: c.state,
      contract: { from: c.contract.from, to: c.contract.to, daysToEnd: c.contract.daysToEnd },
      limits: { scoutPerPeriod: c.limits.scout, jobPostings: c.limits.job },
      accountTypes: c.accountTypes,
      activeJobsNow: core.extra.activeJobsNow,
      login: { daysSince: core.extra.login.daysSince, days30: core.extra.login.days30, days90: core.extra.login.days90 },
    },
    monthly,
    totals: totalsOf(monthly),
    previous,
    benchmarks: benchmarksOf(core, months, opts.benchMinN ?? 5),
    attributes,
    jobs: {
      total: jobs.rows.length,
      rows: jobs.rows.slice(0, JOBS_TOP).map((j) => ({ key: j.key, title: j.title.slice(0, 120), account: j.account, direct: j.direct, publishFrom: j.publishFrom, publishTo: j.publishTo, views: j.views, apps: j.apps, applyRatePct: pct(j.apps, j.views), hiresApp: j.hiresApp, cond: j.cond, hotJob: j.hot !== null })),
    },
    selection,
    cohorts: account === null ? { scout: statusTotals(core.cohorts.scout, months), application: statusTotals(core.cohorts.application, months) } : null,
    scoutUnused: unused.filter((u) => months.includes(u.month)).map((u) => ({ month: u.month, reason: u.reason, remarks: u.remarks })),
    notes,
  });
}
