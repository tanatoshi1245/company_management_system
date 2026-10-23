import type { BenchRow } from '../schema/board';
import { scoreRatio, type HeatScore } from './heatmap';

export const ALL = '__ALL__';
export type BenchIndex = Map<string, BenchRow>;

const key = (industry: string, type: string, metric: string) => `${industry}|${type}|${metric}`;

export function indexBenchmarks(rows: BenchRow[]): BenchIndex {
  const idx: BenchIndex = new Map();
  for (const r of rows) idx.set(key(r.industry, r.companyType, r.metric), r);
  return idx;
}

export interface BenchLookup {
  row: BenchRow | null;
  /** 0 = 業種 × 種別、1 = 業種全体、2 = 種別全体、3 = 全体、-1 = 無し */
  level: -1 | 0 | 1 | 2 | 3;
  group: string;
}

export const BENCH_LEVEL_LABEL: Record<number, string> = { 0: '同業種・同種別', 1: '同業種（種別問わず）', 2: '同種別（業種問わず）', 3: '契約企業全体', [-1]: '基準なし' };

/** n_companies が minN 未満なら上位の群へ順に落とす */
export function lookupBenchmark(idx: BenchIndex, industry: string, type: string, metric: string, minN = 5): BenchLookup {
  const candidates: [string, string, 0 | 1 | 2 | 3][] = [
    [industry, type, 0],
    [industry, ALL, 1],
    [ALL, type, 2],
    [ALL, ALL, 3],
  ];
  for (const [ind, typ, level] of candidates) {
    const row = idx.get(key(ind, typ, metric));
    if (row && row.n >= minN && row.median !== null) return { row, level, group: `${ind === ALL ? '全業種' : ind} / ${typ === ALL ? '全種別' : typ}` };
  }
  return { row: null, level: -1, group: '基準なし' };
}

export interface BenchScore {
  median: number | null;
  ratio: number | null;
  score: HeatScore | null;
  level: BenchLookup['level'];
  group: string;
  n: number;
}

/** 実績 ÷ 中央値 → 5 段階。中央値 0 は比率を出せない（実績 > 0 なら +2、0 なら 0） */
export function scoreVsBenchmark(value: number | null, lookup: BenchLookup, polarity: 'higher' | 'lower' = 'higher'): BenchScore {
  const row = lookup.row;
  const base = { level: lookup.level, group: lookup.group, n: row?.n ?? 0 };
  if (!row || row.median === null || value === null) return { median: row?.median ?? null, ratio: null, score: null, ...base };
  if (row.median === 0) {
    const score: HeatScore | null = value > 0 ? (polarity === 'lower' ? -2 : 2) : 0;
    return { median: 0, ratio: null, score, ...base };
  }
  const ratio = value / row.median;
  return { median: row.median, ratio, score: scoreRatio(ratio, polarity), ...base };
}
