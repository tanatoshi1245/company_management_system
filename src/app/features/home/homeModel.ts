import { useMemo } from 'react';
import type { BoardResponse } from '../../../shared/schema/board';
import { boardAccountTypes, filterCompanies, filterCompaniesExcept, kpiStrip, ownerKey, sortCompanies, type BoardFilters, type KpiTile } from '../../../shared/metrics/board';
import { surname } from '../../../shared/labels';
import { makeContext, scoreCompany, type ScoredCompany } from '../../../shared/metrics/score';

export interface HomeModel {
  scored: ScoredCompany[];
  filtered: ScoredCompany[];
  sorted: ScoredCompany[];
  kpis: KpiTile[];
  /** CS 担当の一覧（key = ownerKey、label = 苗字、name = フルネーム） */
  owners: { key: string; label: string; name: string; count: number }[];
  types: { key: string; count: number }[];
  mineCount: number;
}

/** スコア → 絞り込み（契約中のみ）→ 並べ替え の 3 段で memo する（絞り込み・並べ替えで再取得しない）。選択肢（owners / types / mineCount）は他のフィルタと連動する */
export function useHomeModel(board: BoardResponse | null, filters: BoardFilters, sort: string): HomeModel | null {
  const scored = useMemo(() => {
    if (!board) return null;
    const ctx = makeContext(board.benchmarks, board.meta.benchMinN, board.meta.bizDays.rate, board.meta.bizDays.elapsed, board.meta.isCurrentMonth);
    return board.companies.map((c) => scoreCompany(c, ctx));
  }, [board]);
  const filtered = useMemo(() => (scored && board ? filterCompanies(scored, filters, board.meta) : null), [scored, filters, board]);
  const sorted = useMemo(() => (filtered ? sortCompanies(filtered, sort) : null), [filtered, sort]);
  return useMemo(() => {
    if (!board || !scored || !filtered || !sorted) return null;
    // 選択肢はフィルタ同士で連動させる: その項目以外のフィルタを通った契約中の企業から作る（選択中の値が 0 件になっても選択肢には残す）
    const ownerRows = filterCompaniesExcept(scored, filters, board.meta, 'owner');
    const typeRows = filterCompaniesExcept(scored, filters, board.meta, 'type');
    const mineRows = filterCompaniesExcept(scored, filters, board.meta, 'mine');
    const ownerInfo = (s: ScoredCompany) => ({ key: ownerKey(s.c), label: surname(s.c.owner.name) ?? s.c.owner.email ?? ownerKey(s.c), name: s.c.owner.name ?? s.c.owner.email ?? ownerKey(s.c) });
    return {
      scored,
      filtered,
      sorted,
      kpis: kpiStrip(filtered, board.meta),
      owners: (() => {
        const m = new Map<string, { key: string; label: string; name: string; count: number }>();
        for (const s of ownerRows) {
          const key = ownerKey(s.c);
          const cur = m.get(key);
          if (cur) cur.count += 1;
          else m.set(key, { ...ownerInfo(s), count: 1 });
        }
        for (const key of filters.owner) {
          if (m.has(key)) continue;
          const any = scored.find((s) => ownerKey(s.c) === key);
          m.set(key, any ? { ...ownerInfo(any), count: 0 } : { key, label: key, name: key, count: 0 });
        }
        return Array.from(m.values()).sort((a, b) => (a.key === '(未設定)' ? 1 : b.key === '(未設定)' ? -1 : b.count - a.count || a.label.localeCompare(b.label, 'ja')));
      })(),
      // 種別の件数は、副アカウントの種別（直接 + 紹介 の 紹介）にも数える（フィルタの判定と同じ）
      types: (() => {
        const m = new Map<string, number>();
        for (const s of typeRows) for (const t of boardAccountTypes(s.c)) m.set(t, (m.get(t) ?? 0) + 1);
        for (const t of filters.type) if (!m.has(t)) m.set(t, 0);
        return Array.from(m, ([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
      })(),
      mineCount: mineRows.filter((s) => s.c.isMine).length,
    };
  }, [board, scored, filtered, sorted, filters]);
}
