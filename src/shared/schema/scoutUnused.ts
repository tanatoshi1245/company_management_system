import { z } from 'zod';
import { SCOUT_UNUSED_REASONS } from '../labels';
import { MonthSchema } from './common';

/** PUT /api/scout-unused/:companyId/:month の本文。company_id と月は URL からだけ */
export const ScoutUnusedInputSchema = z
  .object({
    reason: z.enum(SCOUT_UNUSED_REASONS).nullable().default(null),
    remarks: z.string().trim().max(500).nullable().default(null),
  })
  .strict()
  .transform((v) => ({ reason: v.reason, remarks: v.remarks ? v.remarks : null }));
export type ScoutUnusedInput = z.infer<typeof ScoutUnusedInputSchema>;

/** D1 scout_unused_entries の 1 行（アプリで登録したもの） */
export const ScoutUnusedEntrySchema = z.object({
  companyId: z.string(),
  month: MonthSchema,
  reason: z.string().nullable(),
  remarks: z.string().nullable(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  /** BigQuery（scout_unused_companies_monthly の match_method = 'app' の行）に反映した時刻。null = 未反映 */
  bqSyncedAt: z.string().nullable(),
  bqError: z.string().nullable(),
});
export type ScoutUnusedEntry = z.infer<typeof ScoutUnusedEntrySchema>;

/** シート取込（マート cms_company_master.scout_unused_json）にあるその月の記録（参考表示・取り込み用） */
export const ScoutUnusedSheetRowSchema = z.object({ companyId: z.string(), reason: z.string().nullable(), remarks: z.string().nullable() });
export type ScoutUnusedSheetRow = z.infer<typeof ScoutUnusedSheetRowSchema>;

export const ScoutUnusedMonthResponseSchema = z.object({ month: MonthSchema, entries: z.array(ScoutUnusedEntrySchema), sheet: z.array(ScoutUnusedSheetRowSchema) });
export type ScoutUnusedMonthResponse = z.infer<typeof ScoutUnusedMonthResponseSchema>;

export const ScoutUnusedSaveResponseSchema = z.object({ entry: ScoutUnusedEntrySchema.nullable(), bq: z.object({ synced: z.boolean(), error: z.string().nullable() }) });
export type ScoutUnusedSaveResponse = z.infer<typeof ScoutUnusedSaveResponseSchema>;

export const ScoutUnusedSyncResponseSchema = z.object({ synced: z.number(), failed: z.number(), pending: z.number() });
export type ScoutUnusedSyncResponse = z.infer<typeof ScoutUnusedSyncResponseSchema>;
