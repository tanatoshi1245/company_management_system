import { z } from 'zod';
import { TargetValuesSchema } from './targets';

/** 1 企業の生の値（ボード用）。スコア・ヘルスは共用の metrics で計算する（Worker は生の値とベンチマーク表を返すだけ） */
export const BoardCompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  ind: z.string(),
  indSrc: z.string(),
  state: z.string(),
  plan: z.string().nullable(),
  planSrc: z.string(),
  owner: z.object({ email: z.string().nullable(), name: z.string().nullable(), src: z.string() }),
  sfOwnerName: z.string().nullable(),
  salesStaff: z.string().nullable(),
  contract: z.object({ from: z.string(), to: z.string().nullable(), daysToEnd: z.number().nullable(), daysSinceStart: z.number(), daysTotal: z.number().nullable() }),
  limits: z.object({ scout: z.number().nullable(), job: z.number().nullable(), period: z.enum(['month', 'contract']) }),
  signals: z.object({ dj: z.boolean(), sfActive: z.boolean(), sfWon: z.boolean(), da: z.boolean(), sfLinked: z.boolean(), noticeCheck: z.boolean() }),
  /** 当月（選択月）の実績 */
  m: z.object({
    contracted: z.boolean(),
    jobs: z.number(),
    newJobs: z.number(),
    sent: z.number(),
    sentManual: z.number(),
    sentAuto: z.number(),
    sentCtd: z.number(),
    int: z.number(),
    intReply: z.number(),
    apps: z.number(),
    views: z.number(),
    hires: z.number(),
    inSel: z.number(),
    noResp: z.number(),
    hired: z.number(),
    loginDays: z.number().nullable(),
  }),
  /** 前月 */
  prev: z.object({ jobs: z.number(), sent: z.number(), int: z.number(), apps: z.number(), views: z.number(), hires: z.number() }),
  login: z.object({ last: z.string().nullable(), daysSince: z.number().nullable(), days30: z.number(), daysMtd: z.number() }),
  /** 13 か月 + 当月（古い順）。KPI タイルのスパークライン用 */
  trend: z.object({ months: z.array(z.string()).optional(), sent: z.array(z.number()), int: z.array(z.number()), apps: z.array(z.number()), views: z.array(z.number()), jobs: z.array(z.number()), hires: z.array(z.number()) }),
  targets: TargetValuesSchema.nullable(),
  isMine: z.boolean(),
});
export type BoardCompany = z.infer<typeof BoardCompanySchema>;

export const BenchRowSchema = z.object({
  industry: z.string(),
  companyType: z.string(),
  metric: z.string(),
  n: z.number(),
  mean: z.number().nullable(),
  p25: z.number().nullable(),
  median: z.number().nullable(),
  p75: z.number().nullable(),
});
export type BenchRow = z.infer<typeof BenchRowSchema>;

export const BoardMetaSchema = z.object({
  month: z.string(),
  isCurrentMonth: z.boolean(),
  asOf: z.string(),
  dataDate: z.string(),
  /** 選択月の営業日。当月は data_date まで、過去月は全営業日（rate = 1） */
  bizDays: z.object({ total: z.number(), elapsed: z.number(), rate: z.number() }),
  months: z.array(z.string()),
  benchMinN: z.number(),
  dataVersion: z.string(),
  generatedAt: z.string(),
  cached: z.boolean().optional(),
  mock: z.boolean(),
  loginAvailableFrom: z.string(),
});
export type BoardMeta = z.infer<typeof BoardMetaSchema>;

export const BoardResponseSchema = z.object({
  meta: BoardMetaSchema,
  companies: z.array(BoardCompanySchema),
  benchmarks: z.array(BenchRowSchema),
});
export type BoardResponse = z.infer<typeof BoardResponseSchema>;
