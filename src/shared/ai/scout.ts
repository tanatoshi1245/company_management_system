import { z } from 'zod';
import { shortText } from './common';

/**
 * ② スカウト文面の AI 添削 / テンプレート生成。
 *   入力 … 目的（添削 / テンプレート生成）、添削なら件名と本文、共通の条件（業界・掲載職種・年齢層・国籍・言語力・勤務地・ポジション名）。企業は URL から。
 *   結果 … 同じ業界で返信率（興味あり返信 / 送信）の高い企業の文面の構成・特徴、添削の指摘、文面の案。
 * 件名・本文・条件に、社名と個人情報（氏名・メールアドレス・電話番号）を書かない（画面と Worker の両方で確かめる = pii.ts）。
 */

export const SCOUT_PURPOSES = ['review', 'template'] as const;
export type ScoutPurpose = (typeof SCOUT_PURPOSES)[number];
export const SCOUT_PURPOSE_LABEL: Record<ScoutPurpose, string> = { review: 'スカウト文面の添削', template: 'スカウトテンプレートの作成' };

export const SCOUT_SUBJECT_MAX = 200;
export const SCOUT_BODY_MAX = 5000;
export const AI_OCCUPATIONS_MAX = 5;

/** ②③ で共通の条件（どんな人に向けた文面・求人か） */
export const TargetConditionShape = {
  /** 業界（企業を選ぶと自動で入る。直せる） */
  industry: shortText(60).min(1, '業界を入れてください'),
  /** 掲載職種（企業を選ぶと自動で入る。直せる。1〜5 個） */
  occupations: z.array(shortText(60).min(1)).min(1, '職種を 1 つ以上入れてください').max(AI_OCCUPATIONS_MAX),
  /** 年齢層（例: 20 代後半〜30 代） */
  ageRange: shortText(40).default(''),
  /** 国籍（例: 日本国籍 / 外国籍 / 問わない） */
  nationality: shortText(40).default(''),
  /** 言語力（例: 英語ビジネスレベル以上・日本語ネイティブ） */
  language: shortText(80).default(''),
  /** 勤務地 */
  location: shortText(60).default(''),
  /** ポジション名 */
  positionName: shortText(80).min(1, 'ポジション名を入れてください'),
  /** 補足（任意） */
  note: shortText(500).default(''),
};

export const ScoutInputSchema = z
  .object({
    purpose: z.enum(SCOUT_PURPOSES),
    /** 添削する文面（purpose = review のとき必須） */
    subject: z.string().trim().max(SCOUT_SUBJECT_MAX).default(''),
    body: z.string().trim().max(SCOUT_BODY_MAX).default(''),
    ...TargetConditionShape,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.purpose === 'review') {
      if (!v.subject) ctx.addIssue({ code: 'custom', path: ['subject'], message: '添削する件名を入れてください' });
      if (!v.body) ctx.addIssue({ code: 'custom', path: ['body'], message: '添削する本文を入れてください' });
    }
  });
export type ScoutInput = z.infer<typeof ScoutInputSchema>;

const t = (max: number) => z.string().trim().min(1).max(max);
const tOpt = (max: number) => z.string().trim().max(max).default('');

/** 参考にした文面の母集団（どこから何件読んだか）。企業名は書かない */
export const BenchmarkBasisSchema = z
  .object({
    /** 対象にした条件の説明（例: 「IT・通信の直接採用企業。2026-06〜2026-11 に 30 通以上送信」） */
    scope: t(160),
    /** 比べた企業数・文面（求人）の数 */
    companies: z.number().int().min(0),
    samples: z.number().int().min(0),
    /** 上位の企業の率と、全体の率（%。小数 1 桁まで。出せないときは null） */
    topRatePct: z.number().min(0).max(100).nullable(),
    overallRatePct: z.number().min(0).max(100).nullable(),
    /** 母集団が小さい・業界を広げた などの注意（無ければ空） */
    caveat: tOpt(200),
  })
  .strict();
export type BenchmarkBasis = z.infer<typeof BenchmarkBasisSchema>;

/** 上位の文面に共通する構成・特徴（3〜6 個） */
export const TraitSchema = z.object({ title: t(30), body: t(160) }).strict();

/** 添削の指摘（1〜8 個）。part = 件名 / 冒頭 / 本文 / 条件の示し方 / 締め など */
export const ScoutReviewItemSchema = z
  .object({ part: t(16), severity: z.enum(['high', 'mid', 'low']), issue: t(160), suggestion: t(200) })
  .strict();

/** 文面の案（1〜3 個）。本文の中の差し込みは {{候補者名}} {{企業名}} {{担当者名}} のように書く（実名を書かない） */
export const ScoutDraftSchema = z.object({ label: t(24), subject: t(SCOUT_SUBJECT_MAX), body: t(SCOUT_BODY_MAX), rationale: t(240) }).strict();
export type ScoutDraft = z.infer<typeof ScoutDraftSchema>;

export const ScoutResultSchema = z
  .object({
    ok: z.literal(true).default(true),
    summary: t(300),
    basis: BenchmarkBasisSchema,
    traits: z.array(TraitSchema).min(2).max(6),
    /** 添削のときだけ（テンプレート生成では空） */
    review: z.array(ScoutReviewItemSchema).max(8).default([]),
    drafts: z.array(ScoutDraftSchema).min(1).max(3),
  })
  .strict();
export type ScoutResult = z.infer<typeof ScoutResultSchema>;
