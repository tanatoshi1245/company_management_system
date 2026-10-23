import { z } from 'zod';

const count = (max: number) => z.number().int().min(0).max(max).nullable();

/** PUT /api/companies/:id/settings の本文。company_id は URL からだけ */
export const SettingsInputSchema = z
  .object({
    csOwnerEmail: z.string().trim().toLowerCase().email().max(200).nullable().default(null),
    csOwnerName: z.string().trim().max(100).nullable().default(null),
    scoutLimitPeriod: z.enum(['month', 'contract']).default('month'),
    scoutLimitOverride: count(1_000_000).default(null),
    jobLimitOverride: count(100_000).default(null),
    memo: z.string().max(500).nullable().default(null),
  })
  .strict();
export type SettingsInput = z.infer<typeof SettingsInputSchema>;

export const SettingsRecordSchema = z.object({
  companyId: z.string(),
  csOwnerEmail: z.string().nullable(),
  csOwnerName: z.string().nullable(),
  scoutLimitPeriod: z.enum(['month', 'contract']),
  scoutLimitOverride: z.number().nullable(),
  jobLimitOverride: z.number().nullable(),
  memo: z.string().nullable(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});
export type SettingsRecord = z.infer<typeof SettingsRecordSchema>;
export const SettingsListResponseSchema = z.object({ rows: z.array(SettingsRecordSchema) });
export const SettingsOneResponseSchema = z.object({ companyId: z.string(), settings: SettingsRecordSchema.nullable() });

export const CacheBumpResponseSchema = z.object({ cacheEpoch: z.string() });
