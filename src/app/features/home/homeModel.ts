import { useMemo } from 'react';
import type { BoardResponse } from '../../../shared/schema/board';
import { filterCompanies, kpiStrip, ownerKey, sortCompanies, type BoardFilters, type KpiTile } from '../../../shared/metrics/board';
import { surname } from '../../../shared/labels';
import { makeContext, scoreCompany, type BenchMode, type ScoredCompany } from '../../../shared/metrics/score';

export interface HomeModel {
  scored: ScoredCompany[];
  filtered: ScoredCompany[];
  sorted: ScoredCompany[];
  kpis: KpiTile[];
  /** CS 担当の一覧（key = ownerKey、label = 苗字、name = フルネーム） */
  owners: { key: string; label: string; name: string; count: number }[];
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
      owners: (() => {
        const m = new Map<string, { key: string; label: string; name: string; count: number }>();
        for (const s of scored) {
          const key = ownerKey(s.c);
          const cur = m.get(key);
          if (cur) cur.count += 1;
          else m.set(key, { key, label: surname(s.c.owner.name) ?? s.c.owner.email ?? key, name: s.c.owner.name ?? s.c.owner.email ?? key, count: 1 });
        }
        return Array.from(m.values()).sort((a, b) => (a.key === '(未設定)' ? 1 : b.key === '(未設定)' ? -1 : b.count - a.count || a.label.localeCompare(b.label, 'ja')));
      })(),
      industries: count((s) => s.c.ind),
      types: count((s) => s.c.type),
      mineCount: scored.filter((s) => s.c.isMine).length,
    };
  }, [board, scored, filtered, sorted, mode]);
}
