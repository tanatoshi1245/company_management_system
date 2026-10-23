import { describe, expect, it } from 'vitest';
import { scoreRatio, heatToken } from '../../src/shared/metrics/heatmap';
import { indexBenchmarks, lookupBenchmark, scoreVsBenchmark } from '../../src/shared/metrics/benchmark';
import { scoutPace, targetProgress } from '../../src/shared/metrics/pace';
import { companyHealth } from '../../src/shared/metrics/health';
import type { BenchRow } from '../../src/shared/schema/board';

describe('ヒートマップの 5 段階', () => {
  it('閾値 0.5 / 0.8 / 1.2 / 1.5、低いほど良い指標は反転、null は null', () => {
    expect(scoreRatio(0.49)).toBe(-2);
    expect(scoreRatio(0.5)).toBe(-1);
    expect(scoreRatio(0.8)).toBe(0);
    expect(scoreRatio(1.19)).toBe(0);
    expect(scoreRatio(1.2)).toBe(1);
    expect(scoreRatio(1.5)).toBe(2);
    expect(scoreRatio(0.3, 'lower')).toBe(2);
    expect(scoreRatio(null)).toBeNull();
    expect(scoreRatio(Number.NaN)).toBeNull();
    expect(heatToken(-2)).toBe('n2');
    expect(heatToken(1)).toBe('p1');
    expect(heatToken(null)).toBe('na');
  });
});

describe('業界ベンチマーク', () => {
  const rows: BenchRow[] = [
    { industry: 'IT', companyType: '直接', metric: 'reply_rate', n: 3, mean: 0.1, p25: 0.05, median: 0.1, p75: 0.2 },
    { industry: 'IT', companyType: '__ALL__', metric: 'reply_rate', n: 12, mean: 0.12, p25: 0.06, median: 0.12, p75: 0.2 },
    { industry: '__ALL__', companyType: '__ALL__', metric: 'reply_rate', n: 300, mean: 0.11, p25: 0.05, median: 0.1, p75: 0.18 },
    { industry: '__ALL__', companyType: '__ALL__', metric: 'hires', n: 300, mean: 0.1, p25: 0, median: 0, p75: 0 },
  ];
  const idx = indexBenchmarks(rows);
  it('5 社未満は上位の群へ落ちる（業種 × 種別 → 業種 → 種別 → 全体）', () => {
    expect(lookupBenchmark(idx, 'IT', '直接', 'reply_rate', 5)).toMatchObject({ level: 1, row: { n: 12 } });
    expect(lookupBenchmark(idx, 'IT', '直接', 'reply_rate', 3)).toMatchObject({ level: 0 });
    expect(lookupBenchmark(idx, '製造', 'RPO', 'reply_rate', 5)).toMatchObject({ level: 3 });
    expect(lookupBenchmark(idx, '製造', 'RPO', 'nope', 5)).toMatchObject({ level: -1, row: null });
  });
  it('実績 ÷ 中央値 → スコア。中央値 0 は実績 > 0 で +2', () => {
    const lk = lookupBenchmark(idx, 'IT', '直接', 'reply_rate', 5);
    expect(scoreVsBenchmark(0.24, lk)).toMatchObject({ ratio: 2, score: 2, median: 0.12, level: 1 });
    expect(scoreVsBenchmark(0.05, lk)).toMatchObject({ score: -2 });
    expect(scoreVsBenchmark(null, lk)).toMatchObject({ score: null, ratio: null });
    const zero = lookupBenchmark(idx, 'x', 'y', 'hires', 5);
    expect(scoreVsBenchmark(1, zero)).toMatchObject({ score: 2, ratio: null });
    expect(scoreVsBenchmark(0, zero)).toMatchObject({ score: 0 });
  });
});

describe('ペースと目標比', () => {
  it('消化率・期待値・ペース判定', () => {
    expect(scoutPace({ sent: 85, limit: 150, progressRate: 15 / 21, elapsedDays: 15 })).toMatchObject({ util: 85 / 150, expected: 150 * (15 / 21), status: 'behind' });
    expect(scoutPace({ sent: 110, limit: 150, progressRate: 0.714, elapsedDays: 15 }).status).toBe('on');
    expect(scoutPace({ sent: 140, limit: 150, progressRate: 0.714, elapsedDays: 15 }).status).toBe('ahead');
    expect(scoutPace({ sent: 100, limit: 150, progressRate: 0.714, elapsedDays: 15 }).status).toBe('watch');
    expect(scoutPace({ sent: 0, limit: 150, progressRate: 0.05, elapsedDays: 1 }).status).toBe('early');
    expect(scoutPace({ sent: 10, limit: null, progressRate: 0.5, elapsedDays: 10 })).toMatchObject({ util: null, status: 'na' });
    expect(scoutPace({ sent: 10, limit: 0, progressRate: 0.5, elapsedDays: 10 }).status).toBe('na');
  });
  it('目標比: 期待 = 目標 × 進捗率、達成率 = 実績 ÷ 期待。目標なし・期待 0 は null', () => {
    expect(targetProgress(7, 10, 0.714)).toEqual({ expected: 7.14, progress: 7 / 7.14 });
    expect(targetProgress(7, null, 0.714)).toEqual({ expected: null, progress: null });
    expect(targetProgress(0, 10, 0)).toEqual({ expected: 0, progress: null });
  });
});

describe('企業ヘルス', () => {
  it('重み付き平均と最低指標', () => {
    const h = companyHealth({ scout_utilization: -2, reply_rate: 0, apps_per_active_job: 1, views_per_active_job: null });
    // (-2*2 + 0*1 + 1*1) / 4 = -0.75 → -1 → 要注意
    expect(h).toMatchObject({ level: 'alert', s: -1, worst: 'scout_utilization', worstScore: -2 });
    expect(companyHealth({ scout_utilization: 0, reply_rate: -1 })).toMatchObject({ level: 'watch', s: 0, worst: 'reply_rate' });
    expect(companyHealth({ scout_utilization: 1, reply_rate: 0 })).toMatchObject({ level: 'good' });
    expect(companyHealth({})).toMatchObject({ level: 'none', s: null });
  });
});
