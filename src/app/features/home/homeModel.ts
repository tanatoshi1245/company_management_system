import { useMemo } from 'react';
import type { BoardResponse } from '../../../shared/schema/board';
import { attentionLanes, filterCompanies, kpiStrip, sortCompanies, type BoardFilters, type KpiTile, type Lanes } from '../../../shared/metrics/board';
import { makeContext, scoreCompany, type BenchMode, type ScoredCompany } from '../../../shared/metrics/score';

export interface HomeModel {
  scored: ScoredCompany[];
  filtered: ScoredCompany[];
  sorted: ScoredCompany[];
  kpis: KpiTile[];
  lanes: Lanes;
  industries: { key: string; count: number }[];
  types: { key: string; count: number }[];
  mineCount: number;
}

/** スコア（ボード + モード）→ 絞り込み → 並べ替え の 3 段で memo する（モード切替・絞り込みで再取得しない） */
export function useHomeModel(board: BoardResponse | null, filters: BoardFilters, mode: BenchMode, sort: string): HomeModel | null {
  const scored = useMemo(() => {
    if (!board) return null;
    const ctx = makeContext(board.benchmarks, board.meta.benchMinN, board.meta.bizDays.rate, board.meta.bizDays.elapsed, board.meta.isCurrentMonth);
    return board.companies.map((c) => scoreCompany(c, ctx));
  }, [board]);
  const filtered = useMemo(() => (scored ? filterCompanies(scored, filters, mode) : null), [scored, filters, mode]);
  const sorted = useMemo(() => (filtered ? sortCompanies(filtered, sort, mode) : null), [filtered, sort, mode]);
  return useMemo(() => {
    if (!board || !scored || !filtered || !sorted) return null;
    const count = (f: (s: ScoredCompany) => string) => {
      const m = new Map<string, number>();
      for (const s of scored) m.set(f(s), (m.get(f(s)) ?? 0) + 1);
      return Array.from(m, ([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'ja'));
    };
    return {
      scored,
      filtered,
      sorted,
      kpis: kpiStrip(filtered, mode, board.meta),
      lanes: attentionLanes(filtered),
      industries: count((s) => s.c.ind),
      types: count((s) => s.c.type),
      mineCount: scored.filter((s) => s.c.isMine).length,
    };
  }, [board, scored, filtered, sorted, mode]);
}
