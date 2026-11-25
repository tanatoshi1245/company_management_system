import { z } from 'zod';
import { MonthSchema } from '../schema/common';

/**
 * AI 機能（docs/AI機能.md）で 3 機能が共有する型。
 *   report … AI 分析とレポート生成（企業ページの期間・企業の利用状況 → 編集できるスライド）
 *   scout  … スカウト文面の AI 添削 / テンプレート生成
 *   job    … 求人の AI 添削 / 求人票の作成
 * 流れ: 画面 → Worker（D1 ai_jobs に保存）→ Claude Code のセッションを発火 → セッションが BigQuery を読んで作成 →
 *       セッションが結果を Worker（/hook/ai/jobs/:id/result）へ返す → 画面がポーリングで受け取る。
 * 機能ごとの入力・結果は report.ts / scout.ts / job.ts（1 機能 = 1 ファイル）。
 */

export const AI_KINDS = ['report', 'scout', 'job'] as const;
export type AiKind = (typeof AI_KINDS)[number];
export const AiKindSchema = z.enum(AI_KINDS);

export const AI_KIND_LABEL: Record<AiKind, string> = {
  report: 'AI 分析とレポート生成',
  scout: 'スカウト文面の AI 添削',
  job: '求人の AI 添削',
};

/**
 * queued  … 保存した。セッションをまだ立ち上げていない（設定が無い・発火に失敗した）
 * running … セッションへ渡した。結果待ち
 * done    … 結果を受け取った
 * failed  … セッションが失敗を返した / 期限（AI_JOB_TTL_MIN）までに結果が来なかった
 */
export const AI_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type AiStatus = (typeof AI_STATUSES)[number];
export const AiStatusSchema = z.enum(AI_STATUSES);

/** ジョブ ID（Worker が発行。英小文字と数字） */
export const AiJobIdSchema = z.string().regex(/^[a-z0-9]{16,40}$/);

/** 結果を待つ長さ（分）。これを過ぎた running は failed（期限切れ）として返す。結果を返す合言葉の期限も同じ */
export const AI_JOB_TTL_MIN = 60;
/** 企業 × 機能ごとに、セッションへ渡す過去の結果の件数（2 回目以降の作成で参考にする） */
export const AI_HISTORY_FOR_SESSION = 3;
/** 画面に出す履歴の件数 */
export const AI_HISTORY_LIST_MAX = 30;
/** 結果（JSON）の大きさの上限（バイト） */
export const AI_RESULT_MAX_BYTES = 200 * 1024;

/** 1 行の短い文字列（入力欄）。前後の空白を落とす */
export const shortText = (max: number) => z.string().trim().max(max);

/** アカウント種別（企業ページの切替と同じ値） */
export const AI_ACCOUNT_TYPES = ['直接', '紹介', '派遣'] as const;
export const AiAccountSchema = z.enum(AI_ACCOUNT_TYPES);

/** 一覧の 1 行（結果の本体は含めない） */
export const AiJobSummarySchema = z.object({
  id: AiJobIdSchema,
  kind: AiKindSchema,
  companyId: z.string(),
  status: AiStatusSchema,
  /** 一覧に出す 1 行の見出し（機能ごとに Worker が作る。例: 「2026-09〜2026-11 の利用状況」「添削: 件名…」） */
  title: z.string(),
  /** 結果の要約（done のとき。機能ごとの result.summary） */
  summary: z.string().nullable(),
  error: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  /** 画面で直した後の保存があるか（report のスライド・文面の手直し） */
  edited: z.boolean(),
  /** サンプル（セッションを立ち上げずに作った見本）か */
  sample: z.boolean(),
});
export type AiJobSummary = z.infer<typeof AiJobSummarySchema>;

/** 1 件の全体。input / result / edited は kind ごとの型（report.ts / scout.ts / job.ts）で読む */
export const AiJobDetailSchema = AiJobSummarySchema.extend({
  input: z.unknown(),
  result: z.unknown().nullable(),
  /** 画面で直した版（result と同じ形）。無ければ null */
  editedResult: z.unknown().nullable(),
  /** セッションの URL（管理者 = AI_ADMIN_EMAILS にだけ返す。ほかの人には null） */
  sessionUrl: z.string().nullable(),
  /** 企業名（画面の表示用。セッションへは渡さない） */
  companyName: z.string(),
});
export type AiJobDetail = z.infer<typeof AiJobDetailSchema>;

export const AiJobListResponseSchema = z.object({ jobs: z.array(AiJobSummarySchema) });
export type AiJobListResponse = z.infer<typeof AiJobListResponseSchema>;

/** POST /api/companies/:id/ai/jobs の応答 */
export const AiCreateResponseSchema = z.object({
  job: AiJobDetailSchema,
  /** sent = セッションを立ち上げた / sample = 見本を返した（サンプルデータのとき） / failed = 発火に失敗・発火の設定なし（ジョブは queued で残る） */
  fire: z.enum(['sent', 'sample', 'failed']),
  fireMessage: z.string().nullable(),
});
export type AiCreateResponse = z.infer<typeof AiCreateResponseSchema>;

/** GET /api/ai/config */
export const AiConfigResponseSchema = z.object({
  /** セッションを立ち上げる設定（Secret）があるか */
  fireConfigured: z.boolean(),
  /** 保存先（D1）があるか */
  storeConfigured: z.boolean(),
  /** 見本で動くか（サンプルデータ中 = BQ_MOCK=1）。true の間はセッションを立ち上げず、決まった見本を返す（仮の利用者でも実行できる） */
  sampleMode: z.boolean(),
  /** 書き込める人か（Google ログイン済み） */
  canWrite: z.boolean(),
  admin: z.boolean(),
});
export type AiConfigResponse = z.infer<typeof AiConfigResponseSchema>;

/** GET /api/ai/companies … 企業の選択肢（ボードに出ている企業だけ） */
export const AiCompanyOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  industry: z.string().nullable(),
  companyType: z.string().nullable(),
});
export type AiCompanyOption = z.infer<typeof AiCompanyOptionSchema>;
export const AiCompaniesResponseSchema = z.object({ companies: z.array(AiCompanyOptionSchema) });
export type AiCompaniesResponse = z.infer<typeof AiCompaniesResponseSchema>;

/** GET /api/ai/companies/:id/defaults … 企業を選んだときに自動で入れる値（業界・掲載職種・掲載中の求人） */
export const AiCompanyJobSchema = z.object({
  jobKey: z.string(),
  title: z.string(),
  occupation: z.string().nullable(),
  location: z.string().nullable(),
  japaneseLevel: z.string().nullable(),
  englishLevel: z.string().nullable(),
  salaryBand: z.string().nullable(),
});
export type AiCompanyJob = z.infer<typeof AiCompanyJobSchema>;
export const AiCompanyDefaultsResponseSchema = z.object({
  companyId: z.string(),
  industry: z.string().nullable(),
  /** 直近の掲載求人の職種（多い順・重複なし） */
  occupations: z.array(z.string()),
  /** 直近の掲載求人（求人の添削で選ぶ。閲覧の多い順） */
  jobs: z.array(AiCompanyJobSchema),
  /** 選択肢（プルダウン + 予測変換）: 業界・職種の全体の一覧 */
  industryOptions: z.array(z.string()),
  occupationOptions: z.array(z.string()),
});
export type AiCompanyDefaultsResponse = z.infer<typeof AiCompanyDefaultsResponseSchema>;

/** 期間（月）。from <= to は Worker で確かめる */
export const AiPeriodSchema = z.object({ from: MonthSchema, to: MonthSchema });

/** セッションが失敗を返すときの本文 */
export const AiFailureSchema = z.object({ ok: z.literal(false), error: z.string().trim().min(1).max(500) }).strict();
