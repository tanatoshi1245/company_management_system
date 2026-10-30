import { z } from 'zod';
import { BoardCompanySchema, BoardMetaSchema, BenchRowSchema } from './board';
import { TargetValuesSchema } from './targets';

export const MonthlyRowSchema = z.object({
  month: z.string(),
  contracted: z.boolean(),
  jobs: z.number(),
  newJobs: z.number(),
  sent: z.number(),
  sentManual: z.number(),
  sentAuto: z.number(),
  int: z.number(),
  intReply: z.number(),
  apps: z.number(),
  views: z.number(),
  hires: z.number(),
  /** 採用のうち応募経由 / スカウト経由（両方に立つことがある） */
  hiresApp: z.number().default(0),
  hiresScout: z.number().default(0),
  inSel: z.number(),
  loginDays: z.number().nullable(),
  /** ステータス別の現在件数（st01_no_response … st12_declined） */
  st: z.record(z.string(), z.number()),
});
export type MonthlyRow = z.infer<typeof MonthlyRowSchema>;

export const DailyPointSchema = z.object({
  date: z.string(),
  month: z.string(),
  day: z.number(),
  sent: z.number(),
  sentCum: z.number(),
  apps: z.number(),
  appsCum: z.number(),
  int: z.number(),
  intCum: z.number(),
  views: z.number(),
  viewsCum: z.number(),
  jobs: z.number(),
  login: z.number(),
});
export type DailyPoint = z.infer<typeof DailyPointSchema>;

export const CohortCellSchema = z.object({ month: z.string(), status: z.string(), count: z.number(), members: z.number() });
export type CohortCell = z.infer<typeof CohortCellSchema>;

/** アカウント種別（プロファイルの 直接 / 紹介 / 派遣）とそのプロファイル */
export const AccountSchema = z.object({ type: z.string(), profiles: z.array(z.object({ id: z.string(), name: z.string().nullable(), lang: z.string().nullable() })) });
export type Account = z.infer<typeof AccountSchema>;

/** アカウント種別ごとの月次（企業ページの種別切替用。全体は monthly） */
export const AccountMonthlyRowSchema = z.object({ account: z.string(), month: z.string(), jobs: z.number(), sent: z.number(), intReply: z.number(), apps: z.number(), views: z.number(), hiresApp: z.number(), hiresScout: z.number(), inSel: z.number() });
export type AccountMonthlyRow = z.infer<typeof AccountMonthlyRowSchema>;

/** 窓に掲載期間が重なる求人（set_id で日英重複排除）。任意の期間・アカウントで数えるための一覧 */
export const JobRangeSchema = z.object({ account: z.string(), key: z.string(), from: z.string(), to: z.string().nullable() });
export type JobRange = z.infer<typeof JobRangeSchema>;

export const ATTRIBUTE_KINDS = ['scout', 'view', 'application'] as const;
/** 属性の内訳 1 行。kind: scout = スカウトを送った会員（count = 送信数、interested = 興味あり返信）/ view = 閲覧した会員（count = 閲覧数）/ application = 応募した会員（count = 応募数） */
export const AttributeRowSchema = z.object({ kind: z.enum(ATTRIBUTE_KINDS), type: z.string(), value: z.string(), count: z.number(), interested: z.number() });
export type AttributeRow = z.infer<typeof AttributeRowSchema>;
/** GET /api/companies/:id/attributes の応答（期間 from〜to・アカウント種別で集約済み） */
export const AttributesResponseSchema = z.object({ from: z.string(), to: z.string(), account: z.string().nullable(), rows: z.array(AttributeRowSchema) });
export type AttributesResponse = z.infer<typeof AttributesResponseSchema>;

/** スカウト未利用の記録（cms_company_master.scout_unused_json。契約期間に入る月だけ、月の降順） */
export const ScoutUnusedRowSchema = z.object({ month: z.string(), reason: z.string().nullable(), remarks: z.string().nullable(), source: z.enum(['sheet', 'app']).default('sheet') });
export type ScoutUnusedRow = z.infer<typeof ScoutUnusedRowSchema>;

export const BenchSeriesRowSchema = BenchRowSchema.extend({ month: z.string() });
export type BenchSeriesRow = z.infer<typeof BenchSeriesRowSchema>;

export const CompanyExtraSchema = z.object({
  internalName: z.string().nullable(),
  djContractType: z.string().nullable(),
  contractFrom2: z.string().nullable(),
  contractTo2: z.string().nullable(),
  sfAccountName: z.string().nullable(),
  sfContractStatus: z.string().nullable(),
  sfContractStart: z.string().nullable(),
  sfContractEnd: z.string().nullable(),
  sfAccountOwner: z.object({ name: z.string().nullable(), position: z.string().nullable() }),
  sfContractOwner: z.object({ name: z.string().nullable(), position: z.string().nullable() }),
  profileCount: z.number(),
  activeJobsNow: z.number(),
  /** 直近 13 か月 + 当月の窓に掲載期間が重なる求人数（set_id で日英重複排除） */
  jobsWindowDistinct: z.number().nullable(),
  login: z.object({ last: z.string().nullable(), lastAt: z.string().nullable(), daysSince: z.number().nullable(), days30: z.number(), days90: z.number(), daysMtd: z.number(), throughDate: z.string().nullable() }),
});

export const CompanySettingsSchema = z.object({
  csOwnerEmail: z.string().nullable(),
  csOwnerName: z.string().nullable(),
  scoutLimitPeriod: z.enum(['month', 'contract']),
  scoutLimitOverride: z.number().nullable(),
  jobLimitOverride: z.number().nullable(),
  memo: z.string().nullable(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type CompanySettings = z.infer<typeof CompanySettingsSchema>;

export const CompanyDetailResponseSchema = z.object({
  meta: BoardMetaSchema,
  company: BoardCompanySchema,
  extra: CompanyExtraSchema,
  monthly: z.array(MonthlyRowSchema),
  daily: z.array(DailyPointSchema),
  cohorts: z.object({ scout: z.array(CohortCellSchema), application: z.array(CohortCellSchema) }),
  /** アカウント種別（複数アカウントを運用する企業は 2 つ以上） */
  accounts: z.array(AccountSchema),
  /** アカウント種別ごとの月次（窓の 14 か月 × 種別） */
  accountMonthly: z.array(AccountMonthlyRowSchema),
  /** 窓に掲載期間が重なる求人の一覧 */
  jobs: z.array(JobRangeSchema),
  /** 企業の群（業種 × 種別と __ALL__ の組み合わせ）の 14 か月分 */
  benchSeries: z.array(BenchSeriesRowSchema),
  /** スカウト未利用の記録（契約期間中。月の降順） */
  scoutUnused: z.array(ScoutUnusedRowSchema),
  settings: CompanySettingsSchema.nullable(),
  targetsByMonth: z.record(z.string(), TargetValuesSchema),
});
export type CompanyDetailResponse = z.infer<typeof CompanyDetailResponseSchema>;
