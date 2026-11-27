import { z } from 'zod';
import { shortText } from './common';
import { BenchmarkBasisSchema, TargetConditionShape, TraitSchema } from './scout';

/**
 * ③ 求人の AI 添削 / 求人票の作成。
 *   入力 … 目的（添削 / 新規作成）、添削なら対象の求人（掲載中の求人から選ぶ = jobKey、または本文を貼る）、共通の条件。企業は URL から。
 *   結果 … 同じ業界・職種で「閲覧 → 応募」の率が高い求人の構成・特徴、添削の指摘、求人票の案。
 * 貼り付ける文に、社名と個人情報を書かない（pii.ts）。
 */

export const JOB_PURPOSES = ['review', 'create'] as const;
export type JobPurpose = (typeof JOB_PURPOSES)[number];
export const JOB_PURPOSE_LABEL: Record<JobPurpose, string> = { review: '求人の添削', create: '求人票の作成' };

/** 添削する求人の渡し方: posted = 掲載中の求人から選ぶ（本文は セッションが BigQuery から読む） / pasted = 文を貼る */
export const JOB_SOURCES = ['posted', 'pasted'] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

export const JOB_TITLE_MAX = 200;
export const JOB_TEXT_MAX = 6000;

export const JobInputSchema = z
  .object({
    purpose: z.enum(JOB_PURPOSES),
    source: z.enum(JOB_SOURCES).default('pasted'),
    /** 掲載中の求人のキー（source = posted のとき。企業ページの求人フィルタと同じ値） */
    jobKey: z.string().regex(/^[A-Za-z0-9:_-]{1,40}$/).nullable().default(null),
    /** 貼り付けた求人（source = pasted のとき）: 求人タイトル・仕事内容・応募条件 */
    title: z.string().trim().max(JOB_TITLE_MAX).default(''),
    description: z.string().trim().max(JOB_TEXT_MAX).default(''),
    requirements: z.string().trim().max(JOB_TEXT_MAX).default(''),
    /** 年収（例: 500〜800 万円） */
    salary: shortText(40).default(''),
    ...TargetConditionShape,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.purpose !== 'review') return;
    if (v.source === 'posted' && !v.jobKey) ctx.addIssue({ code: 'custom', path: ['jobKey'], message: '添削する求人を選んでください' });
    if (v.source === 'pasted' && !v.description) ctx.addIssue({ code: 'custom', path: ['description'], message: '添削する求人の仕事内容を入れてください' });
  });
export type JobInput = z.infer<typeof JobInputSchema>;

const t = (max: number) => z.string().trim().min(1).max(max);

/** 添削の指摘（1〜8 個）。part = タイトル / 仕事内容 / 応募条件 / 条件・待遇 / 構成 など */
export const JobReviewItemSchema = z.object({ part: t(16), severity: z.enum(['high', 'mid', 'low']), issue: t(160), suggestion: t(200) }).strict();

/** 求人票の案。企業名は {{企業名}} と書く（実名を書かない） */
export const JobDraftSchema = z
  .object({
    title: t(JOB_TITLE_MAX),
    description: t(JOB_TEXT_MAX),
    requirements: t(JOB_TEXT_MAX),
    /** この案にした理由（上位の求人のどの特徴を取り入れたか） */
    rationale: t(300),
  })
  .strict();
export type JobDraft = z.infer<typeof JobDraftSchema>;

export const JobResultSchema = z
  .object({
    ok: z.literal(true).default(true),
    summary: t(300),
    basis: BenchmarkBasisSchema,
    traits: z.array(TraitSchema).min(2).max(6),
    /** 添削のときだけ（新規作成では空） */
    review: z.array(JobReviewItemSchema).max(8).default([]),
    draft: JobDraftSchema,
  })
  .strict();
export type JobResult = z.infer<typeof JobResultSchema>;
