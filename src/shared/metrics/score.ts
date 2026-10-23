import type { BoardCompany } from '../schema/board';
import { TARGET_METRICS, type TargetMetric } from '../schema/targets';
import { indexBenchmarks, lookupBenchmark, scoreVsBenchmark, type BenchIndex, type BenchScore } from './benchmark';
import { METRICS, type MetricDef } from './definitions';
import { companyHealth, type Health } from './health';
import { scoreRatio, type HeatScore } from './heatmap';
import { scoutPace, targetProgress, type Pace } from './pace';
import { perActiveJob, rate } from './utilization';

export type BenchMode = 'industry' | 'target';

export interface ScoreContext {
  bench: BenchIndex;
  benchMinN: number;
  /** 選択月の営業日消化率（過去月は 1） */
  bizRate: number;
  bizElapsed: number;
  isCurrentMonth: boolean;
}

export interface TargetScore {
  target: number | null;
  expected: number | null;
  actual: number;
  progress: number | null;
  score: HeatScore | null;
}

export interface ScoredCompany {
  c: BoardCompany;
  /** 指標キー → 値 */
  values: Record<string, number | null>;
  pace: Pace;
  /** 枠の期間に応じた進捗率（月 = 営業日消化率、契約 = 契約経過率） */
  progressRate: number;
  bench: Record<string, BenchScore>;
  target: Record<string, TargetScore>;
  health: Record<BenchMode, Health>;
  /** 契約時目標が 1 つでもあるか */
  hasTargets: boolean;
}

export function makeContext(benchRows: Parameters<typeof indexBenchmarks>[0], benchMinN: number, bizRate: number, bizElapsed: number, isCurrentMonth: boolean): ScoreContext {
  return { bench: indexBenchmarks(benchRows), benchMinN, bizRate, bizElapsed, isCurrentMonth };
}

function actualFor(c: BoardCompany, key: TargetMetric): number {
  switch (key) {
    case 'scout_sent':
      return c.m.sent;
    case 'interested':
      return c.m.int;
    case 'applications':
      return c.m.apps;
    case 'views':
      return c.m.views;
    case 'hires':
      return c.m.hires;
  }
}

/** 契約期間ベースの枠なら契約経過率、そうでなければ営業日消化率 */
export function progressRateOf(c: BoardCompany, ctx: ScoreContext): number {
  if (!ctx.isCurrentMonth) return 1;
  if (c.limits.period === 'contract' && c.contract.daysTotal) return Math.max(0, Math.min(1, (c.contract.daysSinceStart + 1) / c.contract.daysTotal));
  return ctx.bizRate;
}

export function metricValue(key: string, c: BoardCompany, p: Pace): number | null {
  switch (key) {
    case 'job_utilization':
      return rate(c.m.jobs, c.limits.job);
    case 'scout_utilization':
      return p.util;
    case 'reply_rate':
      return rate(c.m.int, c.m.sent);
    case 'apps_per_active_job':
      return perActiveJob(c.m.apps, c.m.jobs);
    case 'views_per_active_job':
      return perActiveJob(c.m.views, c.m.jobs);
    case 'in_selection':
      return c.m.inSel;
    case 'hires':
      return c.m.hires;
    case 'login_days':
      return c.login.days30;
    default:
      return null;
  }
}

export function scoreCompany(c: BoardCompany, ctx: ScoreContext): ScoredCompany {
  const progressRate = progressRateOf(c, ctx);
  const pace = scoutPace({ sent: c.limits.period === 'contract' ? c.m.sentCtd : c.m.sent, limit: c.limits.scout, progressRate, elapsedDays: ctx.isCurrentMonth ? ctx.bizElapsed : 99 });
  const values: Record<string, number | null> = {};
  const bench: Record<string, BenchScore> = {};
  const target: Record<string, TargetScore> = {};
  const indScores: Record<string, HeatScore | null> = {};
  const tgtScores: Record<string, HeatScore | null> = {};
  for (const m of METRICS) {
    const v = metricValue(m.key, c, pace);
    values[m.key] = v;
    if (m.benchMetric) {
      const lk = lookupBenchmark(ctx.bench, c.ind, c.type, m.benchMetric, ctx.benchMinN);
      const b = scoreVsBenchmark(v, lk, m.polarity);
      bench[m.key] = b;
      indScores[m.key] = b.score;
    }
    if (m.targetKey) {
      const t = c.targets?.[m.targetKey] ?? null;
      const actual = actualFor(c, m.targetKey);
      const { expected, progress } = targetProgress(actual, t, progressRate);
      const ts: TargetScore = { target: t, expected, actual, progress, score: scoreRatio(progress) };
      target[m.key] = ts;
      tgtScores[m.key] = ts.score;
    }
  }
  const hasTargets = Boolean(c.targets && TARGET_METRICS.some((k) => c.targets?.[k] !== null && c.targets?.[k] !== undefined));
  return {
    c,
    values,
    pace,
    progressRate,
    bench,
    target,
    health: { industry: companyHealth(indScores), target: hasTargets ? companyHealth(tgtScores) : companyHealth({}) },
    hasTargets,
  };
}

/** セルのスコア（モード別）。目標比で目標が無い指標は null */
export function cellScore(s: ScoredCompany, key: string, mode: BenchMode): HeatScore | null {
  return mode === 'industry' ? (s.bench[key]?.score ?? null) : (s.target[key]?.score ?? null);
}

export function metricDef(key: string): MetricDef | undefined {
  return METRICS.find((m) => m.key === key);
}
