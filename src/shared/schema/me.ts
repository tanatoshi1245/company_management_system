import { z } from 'zod';
import { AuthModeSchema } from './common';

export const MeResponseSchema = z.object({
  email: z.string().nullable(),
  name: z.string().nullable(),
  /** Google ログインで確かめた本人（false = モックの仮の利用者。書き込み不可） */
  verified: z.boolean(),
  authMode: AuthModeSchema,
  mock: z.boolean(),
  /** ログインメールに一致する Salesforce ユーザー Id（担当=自分 の判定用。マスタの担当メールと突合） */
  ownerUserId: z.string().nullable(),
  /** D1 の担当上書きでこの人が担当になっている企業 ID */
  overrideCompanyIds: z.array(z.string()),
  canEdit: z.boolean(),
  loginUrl: z.string().optional(),
  logoutUrl: z.string().optional(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const CaveatSchema = z.object({
  id: z.string(),
  /** 画面の注記（短い文） */
  text: z.string(),
  /** 根拠の文書（claude_analysis 内の相対パス、または本リポジトリの docs） */
  doc: z.string(),
});
export type Caveat = z.infer<typeof CaveatSchema>;

export const MetaResponseSchema = z.object({
  /** マートの版 = 最新の成功した run_date */
  dataVersion: z.string(),
  /** イベントデータの最終日（run_date の前日） */
  dataDate: z.string(),
  refreshedAt: z.string().nullable(),
  refreshStatus: z.enum(['ok', 'error', 'unknown']),
  /** 今日（JST） */
  asOf: z.string(),
  /** 当月 */
  month: z.string(),
  bizDays: z.object({ total: z.number(), elapsed: z.number(), rate: z.number() }),
  ownerSource: z.string(),
  scoutLimitPeriodDefault: z.enum(['month', 'contract']),
  benchMinN: z.number(),
  login: z.object({ availableFrom: z.string() }),
  caveats: z.array(CaveatSchema),
  holidaysVersion: z.string(),
  dataSchemaVersion: z.number(),
  mock: z.boolean(),
});
export type MetaResponse = z.infer<typeof MetaResponseSchema>;

export interface HealthResponse {
  ok: boolean;
  asOf: string;
  mock: boolean;
  bqKeyConfigured: boolean;
  d1Configured: boolean;
  authMode: AuthMode;
  googleLoginConfigured: boolean;
  allowedDomains: string[];
  allowedEmailsCount: number;
  dataVersion: number;
}
type AuthMode = z.infer<typeof AuthModeSchema>;
