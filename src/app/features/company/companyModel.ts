import { useMemo } from 'react';
import type { CompanyDetailResponse } from '../../../shared/schema/company';
import type { BenchRow } from '../../../shared/schema/board';
import { makeContext, scoreCompany, type ScoredCompany } from '../../../shared/metrics/score';
import { LEVEL_ATTRIBUTES } from '../../../shared/labels';
import { monthOf } from '../../../shared/calendar/periods';
import type { PieMode } from './components/AttributePiePanel';

export interface SeriesByMonth {
  months: string[];
  /** 契約開始月（マートの窓より前なら窓の先頭） */
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

/** 直近 13 か月 + 当月（契約期間中・窓内）の累積 */
export interface Totals {
  months: string[];
  fromMonth: string;
  truncated: boolean;
  /** 窓に掲載期間が重なる求人数（set_id で重複排除。マート計算） */
  jobsDistinct: number | null;
  views: number;
  apps: number;
  hiresApp: number;
  sent: number;
  intReply: number;
  hiresScout: number;
  /** 現在の選考中（当月の現ステータス件数） */
  inSel: number;
}

export interface CompanyModel {
  scored: ScoredCompany;
  months: string[];
  totals: Totals;
  /** 閲覧人数・応募人数の単月推移 */
  viewsApps: SeriesByMonth & { views: number[]; apps: number[] };
  /** スカウト送信数・返信数（返信月基準）の単月推移 */
  scoutTrend: SeriesByMonth & { sent: number[]; intReply: number[] };
  /** 属性の内訳: sent = スカウトを送った会員、replied = 興味あり返信した会員、viewed = 求人を閲覧した会員（各 属性種別 → 値と件数） */
  attributes: Record<PieMode, Record<string, AttributeBreakdown[]>>;
  attrMonths: string[];
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
    const monthly = (k: 'views' | 'apps' | 'sent' | 'intReply' | 'hiresApp' | 'hiresScout') => inContract.map((m) => byMonth.get(m)?.[k] ?? 0);
    const sum = (xs: number[]) => xs.reduce((a, v) => a + v, 0);
    const totals: Totals = {
      months: inContract,
      fromMonth: base.fromMonth,
      truncated,
      jobsDistinct: d.extra.jobsWindowDistinct,
      views: sum(monthly('views')),
      apps: sum(monthly('apps')),
      hiresApp: sum(monthly('hiresApp')),
      sent: sum(monthly('sent')),
      intReply: sum(monthly('intReply')),
      hiresScout: sum(monthly('hiresScout')),
      inSel: d.company.m.inSel,
    };
    // 属性: kind（scout / view）× 属性種別 × 値 で合算。replied は興味あり返信の件数
    const acc: Record<PieMode, Map<string, Map<string, number>>> = { sent: new Map(), replied: new Map(), viewed: new Map() };
    const add = (mode: PieMode, type: string, value: string, n: number) => {
      if (n <= 0) return;
      const t = acc[mode].get(type) ?? new Map<string, number>();
      t.set(value, (t.get(value) ?? 0) + n);
      acc[mode].set(type, t);
    };
    for (const a of d.attributes) {
      if (a.kind === 'view') add('viewed', a.type, a.value, a.scouts);
      else {
        add('sent', a.type, a.value, a.scouts);
        add('replied', a.type, a.value, a.interested);
      }
    }
    const attributes = { sent: {}, replied: {}, viewed: {} } as Record<PieMode, Record<string, AttributeBreakdown[]>>;
    for (const mode of ['sent', 'replied', 'viewed'] as PieMode[]) {
      for (const [type, vals] of acc[mode]) attributes[mode][type] = sortBreakdown(type, Array.from(vals, ([value, count]) => ({ value, count })));
    }
    const attrMonths = Array.from(new Set(d.attributes.map((a) => a.month))).sort();
    return {
      scored,
      months,
      totals,
      viewsApps: { ...base, views: monthly('views'), apps: monthly('apps') },
      scoutTrend: { ...base, sent: monthly('sent'), intReply: monthly('intReply') },
      attributes,
      attrMonths,
    };
  }, [d]);
}
