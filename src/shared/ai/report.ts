import { z } from 'zod';
import { MonthSchema } from '../schema/common';
import { AiAccountSchema, shortText } from './common';

/**
 * ① AI 分析とレポート生成。
 *   入力 … 企業ページで表示している期間・アカウント種別（企業は URL から）。数値は Worker がマートから集め直す（画面から数値を受け取らない）。
 *   結果 … スライドの並び（layout ごとに決まった形）。画面は slide_creator から移したスライドの枠（features/ai/report/slides）で描き、文字を直せる。
 */

export const ReportInputSchema = z
  .object({
    from: MonthSchema,
    to: MonthSchema,
    /** null = 全体 */
    account: AiAccountSchema.nullable().default(null),
    /** 重点的に見てほしいこと（任意）。社名・個人名を書かない */
    note: shortText(500).default(''),
  })
  .strict();
export type ReportInput = z.infer<typeof ReportInputSchema>;

const t = (max: number) => z.string().trim().min(1).max(max);
const tOpt = (max: number) => z.string().trim().max(max).default('');

/** 良し悪しの色分け（スライドの札・カードの縁） */
export const ToneSchema = z.enum(['good', 'warn', 'bad', 'neutral']);
export type Tone = z.infer<typeof ToneSchema>;

/** スライドに共通の頭: kicker = スライドタイトル（何のページか）、lead = リード文（結論の 1 文。です・ます） */
const head = { kicker: t(30), lead: t(80) };

/** 表紙。企業名は画面が差し込む（セッションは企業名を書かない） */
const CoverSlide = z.object({ layout: z.literal('cover'), title: t(40), subtitle: tOpt(60) }).strict();

/** 要約（最初に結論）。points は 2〜4 個 */
const SummarySlide = z.object({ layout: z.literal('summary'), ...head, points: z.array(z.object({ label: t(16), text: t(90) }).strict()).min(2).max(4) }).strict();

/** 主要な数値のカード（3〜6 枚）。value は表示する文字（「1,234」「12.3%」）。数値は渡されたデータにあるものだけ */
const KpiSlide = z
  .object({
    layout: z.literal('kpi'),
    ...head,
    cards: z.array(z.object({ label: t(20), value: t(14), unit: tOpt(8), note: tOpt(40), tone: ToneSchema.default('neutral') }).strict()).min(3).max(6),
    comment: tOpt(120),
  })
  .strict();

/** 月次の推移（折れ線。系列は 1〜3 本・同じ単位）。x は 'YYYY-MM' */
const TrendSlide = z
  .object({
    layout: z.literal('trend'),
    ...head,
    unit: tOpt(8),
    series: z.array(z.object({ name: t(20), points: z.array(z.object({ x: MonthSchema, y: z.number().finite() }).strict()).min(2).max(14) }).strict()).min(1).max(3),
    comment: tOpt(120),
  })
  .strict();

/** 横棒（項目の比較）。compare は比べる相手（業界の中央値・前の期間など）で、compareLabel に名前を書く */
const BarsSlide = z
  .object({
    layout: z.literal('bars'),
    ...head,
    unit: tOpt(8),
    valueLabel: tOpt(16),
    compareLabel: tOpt(16),
    items: z.array(z.object({ label: t(24), value: z.number().finite(), compare: z.number().finite().nullable().default(null) }).strict()).min(2).max(8),
    comment: tOpt(120),
  })
  .strict();

/** 表（参照用。列は 2〜6、行は 1〜8） */
const TableSlide = z
  .object({
    layout: z.literal('table'),
    ...head,
    columns: z.array(t(16)).min(2).max(6),
    rows: z.array(z.array(z.string().trim().max(40)).min(2).max(6)).min(1).max(8),
    comment: tOpt(120),
  })
  .strict();

/** 分かったこと（良い点・課題）。2〜4 個 */
const FindingsSlide = z
  .object({ layout: z.literal('findings'), ...head, items: z.array(z.object({ title: t(28), body: t(110), tone: ToneSchema.default('neutral') }).strict()).min(2).max(4) })
  .strict();

/** 企業へのご提案。2〜4 個。effect = 期待できる変化（数値を書くなら根拠のある値だけ。無ければ空） */
const ProposalSlide = z
  .object({ layout: z.literal('proposal'), ...head, actions: z.array(z.object({ title: t(28), body: t(110), effect: tOpt(50) }).strict()).min(2).max(4) })
  .strict();

/** 次の一歩（いつ・何を）。2〜4 個 */
const NextSlide = z.object({ layout: z.literal('next'), ...head, steps: z.array(z.object({ when: t(16), what: t(70) }).strict()).min(2).max(4) }).strict();

export const ReportSlideSchema = z.discriminatedUnion('layout', [CoverSlide, SummarySlide, KpiSlide, TrendSlide, BarsSlide, TableSlide, FindingsSlide, ProposalSlide, NextSlide]);
export type ReportSlide = z.infer<typeof ReportSlideSchema>;
export type ReportSlideLayout = ReportSlide['layout'];
export const REPORT_LAYOUT_LABEL: Record<ReportSlideLayout, string> = {
  cover: '表紙',
  summary: '要約',
  kpi: '主要な数値',
  trend: '推移',
  bars: '比較',
  table: '表',
  findings: '分かったこと',
  proposal: 'ご提案',
  next: '次の一歩',
};

export const REPORT_SLIDES_MIN = 4;
export const REPORT_SLIDES_MAX = 12;

/** セッションが返す結果（画面で直した版も同じ形） */
export const ReportResultSchema = z
  .object({
    ok: z.literal(true).default(true),
    /** 一覧に出す要約（2〜3 文） */
    summary: t(300),
    slides: z.array(ReportSlideSchema).min(REPORT_SLIDES_MIN).max(REPORT_SLIDES_MAX),
  })
  .strict();
export type ReportResult = z.infer<typeof ReportResultSchema>;
