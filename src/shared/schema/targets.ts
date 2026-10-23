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

/** 月の目標の値だけを比べる（stages は許可キーのみ） */
export function sameTargets(a: TargetValues, b: TargetValues): boolean {
  for (const k of TARGET_METRICS) if ((a[k] ?? null) !== (b[k] ?? null)) return false;
  for (const k of STAGE_TARGET_KEYS) if ((a.stages?.[k] ?? null) !== (b.stages?.[k] ?? null)) return false;
  return true;
}

/**
 * PUT /api/companies/:id/targets/:month の本文。company_id / month は URL からだけ受け取る（本文にあれば拒否）。
 * 未知のキーは 400（許可リスト方式）
 */
export const TargetInputSchema = TargetValuesSchema.extend({
  stages: z.object({ screening: count(100_000), interview: count(100_000), offer: count(100_000) }).strict().partial().default({}),
  note: z.string().max(500).nullable().default(null),
}).strict();
export type TargetInput = z.infer<typeof TargetInputSchema>;

export const TargetRecordSchema = z.object({
  companyId: z.string(),
  month: z.string(),
  values: TargetValuesSchema,
  note: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});
export type TargetRecord = z.infer<typeof TargetRecordSchema>;

export const TargetsByMonthResponseSchema = z.object({ month: z.string(), rows: z.array(TargetRecordSchema) });
export type TargetsByMonthResponse = z.infer<typeof TargetsByMonthResponseSchema>;

export const CompanyTargetsResponseSchema = z.object({ companyId: z.string(), from: z.string(), to: z.string(), rows: z.array(TargetRecordSchema) });
export type CompanyTargetsResponse = z.infer<typeof CompanyTargetsResponseSchema>;

const MonthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM で指定してください');

/** 目標のコピー: fromMonth の値を、まだ目標の無い toMonths にだけ複製する */
export const CopyTargetsInputSchema = z.object({ fromMonth: MonthStr, toMonths: z.array(MonthStr).min(1).max(12) }).strict();
export type CopyTargetsInput = z.infer<typeof CopyTargetsInputSchema>;

/** プラン既定値で未設定を埋める（空の月だけ） */
export const BulkDefaultsInputSchema = z.object({ months: z.array(MonthStr).min(1).max(12), companyIds: z.array(z.string().regex(/^\d{1,12}$/)).max(500).optional() }).strict();
export type BulkDefaultsInput = z.infer<typeof BulkDefaultsInputSchema>;

export const AuditEntrySchema = z.object({
  id: z.number(),
  at: z.string(),
  actor: z.string(),
  action: z.enum(['create', 'update', 'delete']),
  entity: z.string(),
  entityId: z.string(),
  companyId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
export const AuditListResponseSchema = z.object({ rows: z.array(AuditEntrySchema) });

/** プラン別の既定目標 */
export const PLAN_DEFAULT_METRICS = ['scout_sent', 'applications', 'interested', 'views', 'hires', 'stage_screening', 'stage_interview', 'stage_offer'] as const;
export type PlanDefaultMetric = (typeof PLAN_DEFAULT_METRICS)[number];
export const PLAN_DEFAULT_LABEL: Record<PlanDefaultMetric, string> = { scout_sent: 'スカウト送信', interested: '興味あり返信', applications: '応募', views: '求人閲覧', hires: '採用', stage_screening: '書類選考', stage_interview: '面接', stage_offer: '内定' };
export const PlanDefaultValuesSchema = z
  .object({ scout_sent: count(1_000_000), applications: count(1_000_000), interested: count(1_000_000), views: count(10_000_000), hires: count(100_000), stage_screening: count(100_000), stage_interview: count(100_000), stage_offer: count(100_000) })
  .partial()
  .strict();
export type PlanDefaultValues = z.infer<typeof PlanDefaultValuesSchema>;
export const PlanDefaultsInputSchema = z.object({ plan: z.string().trim().min(1).max(100), values: PlanDefaultValuesSchema }).strict();
export const PlanDefaultsResponseSchema = z.object({ plans: z.record(z.string(), PlanDefaultValuesSchema), updatedAt: z.string().nullable() });
export type PlanDefaultsResponse = z.infer<typeof PlanDefaultsResponseSchema>;

/** プラン既定値 → 月の目標値 */
export function planDefaultsToTargets(v: PlanDefaultValues): TargetValues {
  const stages: TargetValues['stages'] = {};
  if (v.stage_screening != null) stages.screening = v.stage_screening;
  if (v.stage_interview != null) stages.interview = v.stage_interview;
  if (v.stage_offer != null) stages.offer = v.stage_offer;
  return { scout_sent: v.scout_sent ?? null, interested: v.interested ?? null, applications: v.applications ?? null, views: v.views ?? null, hires: v.hires ?? null, stages };
}
