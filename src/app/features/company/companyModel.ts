import { useMemo } from 'react';
import type { CompanyDetailResponse, DailyPoint } from '../../../shared/schema/company';
import type { BenchRow } from '../../../shared/schema/board';
import { indexBenchmarks, lookupBenchmark } from '../../../shared/metrics/benchmark';
import { makeContext, scoreCompany, type ScoredCompany } from '../../../shared/metrics/score';
import { STATUS_ORDER, STATUS_VALUES } from '../../../shared/labels';
import type { CohortMatrixData } from '../../components/charts/CohortMatrix';
import type { AttrBar } from '../../components/charts/AttributeBars';
import type { Panel } from '../../components/charts/SmallMultiples';
import { fmtInt, fmtRate } from '../../lib/format';

export interface CompanyModel {
  scored: ScoredCompany;
  months: string[];
  panels: Panel[];
  cohort: { scout: CohortMatrixData; application: CohortMatrixData };
  attributes: Record<string, AttrBar[]>;
  attrMonths: string[];
  dailyCurrent: DailyPoint[];
  dailyPrev: DailyPoint[];
  caveatIds: string[];
}

function cohortMatrix(cells: { month: string; status: string; count: number }[], last = 6): CohortMatrixData {
  const months = Array.from(new Set(cells.map((c) => c.month))).sort().slice(-last);
  const present = new Set(cells.filter((c) => months.includes(c.month)).map((c) => c.status));
  const statuses = STATUS_ORDER.filter((s) => present.has(s));
  const map = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const c of cells) {
    if (!months.includes(c.month)) continue;
    map.set(`${c.month}|${c.status}`, (map.get(`${c.month}|${c.status}`) ?? 0) + c.count);
    totals.set(c.month, (totals.get(c.month) ?? 0) + c.count);
  }
  return { months, statuses, cells: map, totals, hiredKey: STATUS_VALUES.st11_hired };
}

export function useCompanyModel(d: CompanyDetailResponse | null): CompanyModel | null {
  return useMemo(() => {
    if (!d) return null;
    const month = d.meta.month;
    const benchForMonth: BenchRow[] = d.benchSeries.filter((b) => b.month === month);
    const ctx = makeContext(benchForMonth, d.meta.benchMinN, d.meta.bizDays.rate, d.meta.bizDays.elapsed, d.meta.isCurrentMonth);
    const scored = scoreCompany(d.company, ctx);
    const months = d.monthly.map((m) => m.month);
    const byMonth = new Map(d.monthly.map((m) => [m.month, m]));
    const idxByMonth = new Map<string, ReturnType<typeof indexBenchmarks>>();
    for (const m of months) idxByMonth.set(m, indexBenchmarks(d.benchSeries.filter((b) => b.month === m)));
    const band = (metric: string): ({ lo: number; hi: number } | null)[] =>
      months.map((m) => {
        const lk = lookupBenchmark(idxByMonth.get(m)!, d.company.ind, d.company.type, metric, d.meta.benchMinN);
        return lk.row && lk.row.p25 !== null && lk.row.p75 !== null ? { lo: lk.row.p25, hi: lk.row.p75 } : null;
      });
    const tgt = (k: 'scout_sent' | 'interested' | 'applications' | 'views' | 'hires') => months.map((m) => d.targetsByMonth[m]?.[k] ?? null);
    const anyTarget = (vals: (number | null)[]) => (vals.some((v) => v !== null) ? vals : undefined);
    const partial = d.meta.isCurrentMonth && months[months.length - 1] === month;
    const panels: Panel[] = [
      { key: 'sent', label: 'スカウト送信', values: d.monthly.map((m) => m.sent), target: anyTarget(tgt('scout_sent')), format: fmtInt, partialLast: partial },
      { key: 'int', label: '興味あり返信', values: d.monthly.map((m) => m.int), target: anyTarget(tgt('interested')), format: fmtInt, partialLast: partial },
      { key: 'apps', label: '応募', values: d.monthly.map((m) => m.apps), target: anyTarget(tgt('applications')), format: fmtInt, partialLast: partial },
      { key: 'views', label: '求人閲覧', values: d.monthly.map((m) => m.views), target: anyTarget(tgt('views')), format: fmtInt, partialLast: partial },
      { key: 'hires', label: '採用', values: d.monthly.map((m) => m.hires), target: anyTarget(tgt('hires')), format: fmtInt, partialLast: partial },
      { key: 'jobs', label: '掲載求人（月末）', values: d.monthly.map((m) => m.jobs), format: fmtInt },
      { key: 'util', label: 'スカウト枠消化率（業界 p25〜p75）', values: d.monthly.map((m) => (d.company.limits.scout ? m.sent / d.company.limits.scout : null)), band: band('scout_utilization'), format: (v) => fmtRate(v), partialLast: partial },
      { key: 'reply', label: '興味あり返信率（業界 p25〜p75）', values: d.monthly.map((m) => (m.sent ? m.int / m.sent : null)), band: band('reply_rate'), format: (v) => fmtRate(v, 1) },
    ];
    const attributes: Record<string, AttrBar[]> = {};
    const attrMonths = Array.from(new Set(d.attributes.map((a) => a.month))).sort();
    const byType = new Map<string, Map<string, { scouts: number; interested: number }>>();
    for (const a of d.attributes) {
      const t = byType.get(a.type) ?? new Map();
      const cur = t.get(a.value) ?? { scouts: 0, interested: 0 };
      t.set(a.value, { scouts: cur.scouts + a.scouts, interested: cur.interested + a.interested });
      byType.set(a.type, t);
    }
    for (const [type, vals] of byType) {
      const total = Array.from(vals.values()).reduce((s, v) => s + v.scouts, 0) || 1;
      attributes[type] = Array.from(vals, ([value, v]) => ({ value, scouts: v.scouts, share: v.scouts / total, replyRate: v.scouts ? v.interested / v.scouts : null }))
        .sort((a, b) => (a.value === '(未入力)' ? 1 : b.value === '(未入力)' ? -1 : b.scouts - a.scouts));
    }
    const caveatIds = ['status_current_only', 'member_attr_current', 'scout_lag'];
    if (d.company.login.last === null) caveatIds.push('login_from');
    if (Object.values(scored.bench).some((b) => b.level > 0)) caveatIds.push('benchmark_small_n');
    if (d.company.limits.scout !== null) caveatIds.push('scout_quota_period');
    if (byMonth.get(month)?.hires) caveatIds.push('hire_month');
    return {
      scored,
      months,
      panels,
      cohort: { scout: cohortMatrix(d.cohorts.scout), application: cohortMatrix(d.cohorts.application) },
      attributes,
      attrMonths,
      dailyCurrent: d.daily.filter((p) => p.month === month),
      dailyPrev: d.daily.filter((p) => p.month < month),
      caveatIds,
    };
  }, [d]);
}
