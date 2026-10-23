import { useMemo } from 'react';
import type { CompanyDetailResponse } from '../../../shared/schema/company';
import type { BenchRow } from '../../../shared/schema/board';
import { makeContext, scoreCompany, type ScoredCompany } from '../../../shared/metrics/score';
import { LEVEL_ATTRIBUTES } from '../../../shared/labels';
import { monthOf } from '../../../shared/calendar/periods';
import type { AttrBar } from '../../components/charts/AttributeBars';

export interface SeriesByMonth {
  months: string[];
  /** 契約開始月（マートの窓より前なら窓の先頭） */
  fromMonth: string;
  /** 契約開始がマートの窓（直近 13 か月 + 当月）より前で、累積の起点を窓の先頭にしている */
  truncated: boolean;
  /** 当月（最後の点）は途中経過 */
  partialLast: boolean;
}

export interface CompanyModel {
  scored: ScoredCompany;
  months: string[];
  /** 契約期間中（窓内）の累積: 閲覧人数・応募人数 */
  cumulative: SeriesByMonth & { views: number[]; apps: number[] };
  /** 契約期間中（窓内）の月次推移: スカウト送信数・返信数（返信月基準） */
  scoutTrend: SeriesByMonth & { sent: number[]; intReply: number[] };
  attributes: Record<string, AttrBar[]>;
  attrMonths: string[];
  caveatIds: string[];
}

/** 値の先頭の番号（"6. ネイティヴ" → 6）。無ければ null */
function levelNo(v: string): number | null {
  const m = /^(\d+)\./.exec(v);
  return m ? Number(m[1]) : null;
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
    // 契約期間に入る月だけ（開始月以降、終了月まで）。マートの窓より前の契約開始は窓の先頭から
    const startMonth = monthOf(d.company.contract.from);
    const endMonth = d.company.contract.to ? monthOf(d.company.contract.to) : null;
    const inContract = months.filter((m) => m >= startMonth && (endMonth === null || m <= endMonth));
    const truncated = startMonth < months[0];
    const partialLast = d.meta.isCurrentMonth && inContract[inContract.length - 1] === month;
    const base = { months: inContract, fromMonth: inContract[0] ?? months[0], truncated, partialLast };
    const cum = (k: 'views' | 'apps') => {
      let acc = 0;
      return inContract.map((m) => (acc += byMonth.get(m)?.[k] ?? 0));
    };
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
      const rows = Array.from(vals, ([value, v]) => ({ value, scouts: v.scouts, share: v.scouts / total, replyRate: v.scouts ? v.interested / v.scouts : null }));
      // 語学レベルは値の番号で降順（6. ネイティヴ → 1. なし）、他は件数順。(未入力) は末尾
      attributes[type] = rows.sort((a, b) => {
        if (a.value === '(未入力)') return 1;
        if (b.value === '(未入力)') return -1;
        if (LEVEL_ATTRIBUTES.has(type)) return (levelNo(b.value) ?? -1) - (levelNo(a.value) ?? -1) || b.scouts - a.scouts;
        return b.scouts - a.scouts;
      });
    }
    const caveatIds = ['status_current_only', 'member_attr_current', 'scout_lag'];
    if (d.company.login.last === null) caveatIds.push('login_from');
    if (Object.values(scored.bench).some((b) => b.level > 0)) caveatIds.push('benchmark_small_n');
    if (d.company.limits.scout !== null) caveatIds.push('scout_quota_period');
    if (byMonth.get(month)?.hires) caveatIds.push('hire_month');
    return {
      scored,
      months,
      cumulative: { ...base, views: cum('views'), apps: cum('apps') },
      scoutTrend: { ...base, sent: inContract.map((m) => byMonth.get(m)?.sent ?? 0), intReply: inContract.map((m) => byMonth.get(m)?.intReply ?? 0) },
      attributes,
      attrMonths,
      caveatIds,
    };
  }, [d]);
}
