import { z } from 'zod';

/** 契約時に登録する月別の目標（D1 company_targets）。null = 未設定 */
export const TARGET_METRICS = ['scout_sent', 'interested', 'applications', 'views', 'hires'] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number];
export const TARGET_METRIC_LABEL: Record<TargetMetric, string> = { scout_sent: 'スカウト送信', interested: '興味あり返信', applications: '応募', views: '求人閲覧', hires: '採用' };

export const STAGE_TARGET_KEYS = ['screening', 'interview', 'offer'] as const;
export type StageTargetKey = (typeof STAGE_TARGET_KEYS)[number];
export const STAGE_TARGET_LABEL: Record<StageTargetKey, string> = { screening: '書類選考', interview: '面接', offer: '内定' };

const count = (max: number) => z.number().int().min(0).max(max).nullable();

export const TargetValuesSchema = z.object({
  scout_sent: count(1_000_000),
  interested: count(1_000_000),
  applications: count(1_000_000),
  views: count(10_000_000),
  hires: count(100_000),
  stages: z.object({ screening: count(100_000), interview: count(100_000), offer: count(100_000) }).partial().default({}),
});
export type TargetValues = z.infer<typeof TargetValuesSchema>;

export const EMPTY_TARGETS: TargetValues = { scout_sent: null, interested: null, applications: null, views: null, hires: null, stages: {} };

export function hasAnyTarget(t: TargetValues | null | undefined): boolean {
  if (!t) return false;
  return TARGET_METRICS.some((k) => t[k] !== null && t[k] !== undefined) || Object.values(t.stages ?? {}).some((v) => v !== null && v !== undefined);
}
