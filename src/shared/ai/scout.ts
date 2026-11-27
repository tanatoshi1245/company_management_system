import { z } from 'zod';
import { shortText } from './common';

/**
 * ② スカウト文面の AI 作成 / 添削（2026-11-27 ユーザー指示で作り直し。Vertex AI。docs/AI機能.md）。
 *
 * 流れ（すべて Worker の中。1 回の依頼 = 十数秒で返る）:
 *   1. 分析対象を決める … 類似業界 × 直近 1 年の送信実績から、返信率（件数ベース = 興味あり返信 / 送信）が 10% を超える文面の上位 1000 件
 *      （1 件も無ければ、その中で返信率の高い順に上位 1000 件）。受け取った人の条件（年齢層・語学力など）を指定したときは、その条件の送信だけで数え直す。
 *      元は日次マート dwh.cms_ai_scout_templates / cms_ai_scout_sends（bq/ai/）。
 *   2. 分析 … 件名・構成・文章量・特徴を、数値（SQL）と要点（Vertex AI が上位の文面を読む）にまとめる。同じ条件の分析は 1 週間使い回す（D1 に保存）。
 *   3. 作成 … 3 つのモデル（作り方の違う 3 通り）が、それぞれ 1 案ずつ作る。
 *   4. 検証 … CS がどれを選んだか・企業が使ったか・返信・採用を集めて、モデルごとの成績を出し、作り方（プレイブック）を直す（週次 + 手動）。
 */

export const SCOUT_PURPOSES = ['template', 'review'] as const;
export type ScoutPurpose = (typeof SCOUT_PURPOSES)[number];
export const SCOUT_PURPOSE_LABEL: Record<ScoutPurpose, string> = { template: 'スカウト文面の作成', review: 'スカウト文面の添削' };

export const SCOUT_SUBJECT_MAX = 200;
export const SCOUT_BODY_MAX = 5000;
export const AI_OCCUPATIONS_MAX = 5;
/** 条件 1 種類あたりに選べる数 */
export const SCOUT_FILTER_MAX = 8;

/** 分析の決まり（ユーザー指定） */
export const SCOUT_RATE_THRESHOLD = 0.1;
export const SCOUT_TOP_TEMPLATES = 1000;
export const SCOUT_WINDOW_MONTHS = 12;
/** 返信率を出す文面の最小の送信数（1〜2 通だけの文面は、率が 0% か 100% に振れるため） */
export const SCOUT_MIN_SENDS = 5;
/** 分析に使う文面がこれより少ないときは、対象を広げる（同じ業界 → 類似業界 → 全業界。条件つきのときは条件を外すのは最後） */
export const SCOUT_MIN_TEMPLATES = 20;
/** 同じ条件の分析を使い回す日数 */
export const SCOUT_INSIGHT_TTL_DAYS = 7;

/** ②③ で共通の条件（③ 求人の画面が使う。② は下の ScoutInputSchema） */
export const TargetConditionShape = {
  industry: shortText(60).min(1, '業界を入れてください'),
  occupations: z.array(shortText(60).min(1)).min(1, '職種を 1 つ以上入れてください').max(AI_OCCUPATIONS_MAX),
  ageRange: shortText(40).default(''),
  nationality: shortText(40).default(''),
  language: shortText(80).default(''),
  location: shortText(60).default(''),
  positionName: shortText(80).min(1, 'ポジション名を入れてください'),
  note: shortText(500).default(''),
};

/**
 * 受け取る人の条件（絞り込み）。値はマートにある値だけ（選択肢は GET /api/ai/scout/options）。空 = 指定なし。
 * 指定すると、その条件の人に送ったスカウトだけで返信率を数え直して、分析対象の文面を選ぶ。
 */
const filterList = z.array(shortText(60).min(1)).max(SCOUT_FILTER_MAX).default([]);
export const ScoutFiltersSchema = z
  .object({
    /** 年齢層（例: 20代・30代） */
    ageGroups: filterList,
    /** 国籍の区分（例: 日本・日本以外） */
    nationalities: filterList,
    /** 日本語レベル */
    japaneseLevels: filterList,
    /** 英語レベル */
    englishLevels: filterList,
    /** 現住所（都道府県・日本以外） */
    residences: filterList,
    /** 最終経験職種（大分類） */
    occupations: filterList,
  })
  .strict();
export type ScoutFilters = z.infer<typeof ScoutFiltersSchema>;
export const SCOUT_FILTER_KEYS = ['ageGroups', 'nationalities', 'japaneseLevels', 'englishLevels', 'residences', 'occupations'] as const;
export type ScoutFilterKey = (typeof SCOUT_FILTER_KEYS)[number];
export const SCOUT_FILTER_LABEL: Record<ScoutFilterKey, string> = {
  ageGroups: '年齢層',
  nationalities: '国籍',
  japaneseLevels: '日本語力',
  englishLevels: '英語力',
  residences: '現住所',
  occupations: '経験職種',
};
export const EMPTY_SCOUT_FILTERS: ScoutFilters = { ageGroups: [], nationalities: [], japaneseLevels: [], englishLevels: [], residences: [], occupations: [] };
export const hasScoutFilters = (f: ScoutFilters): boolean => SCOUT_FILTER_KEYS.some((k) => f[k].length > 0);

/**
 * 何をもとに作るか（2026-11-27 ユーザー指示。**使う人が最初に選ぶ**。選んで、内容を確かめてから、実行ボタンで AI を動かす）。
 *   conditions … 条件を自分で入れる（ポジション名・送る相手の条件）
 *   job        … 求人 ID（その求人の内容に沿って作る。ポジション名・職種・勤務地・仕事内容・応募条件は求人から取る）
 *   member     … 会員 ID（その候補者の情報に沿って作る。求人の内容は自分で入れる）
 *   jobMember  … 求人 ID + 会員 ID（その求人を、その候補者向けに合わせて作る）
 * 求人は、選んだ企業の求人だけ（Worker が確かめる）。会員の情報は、BigQuery にある属性だけ（氏名・連絡先は無い）。
 */
export const SCOUT_BASES = ['conditions', 'job', 'member', 'jobMember'] as const;
export type ScoutBasisKind = (typeof SCOUT_BASES)[number];
export const SCOUT_BASIS_LABEL: Record<ScoutBasisKind, string> = {
  conditions: '条件を指定して作る',
  job: '求人 ID から作る',
  member: '会員 ID から作る',
  jobMember: '求人 ID + 会員 ID から作る',
};
export const SCOUT_BASIS_DESCRIPTION: Record<ScoutBasisKind, string> = {
  conditions: 'ポジション名と、送る相手の条件を自分で入れます',
  job: '求人の内容（仕事内容・応募条件・勤務地・年収など）に沿った文面を作ります',
  member: '候補者の情報（経験職種・語学力など）に沿った文面を作ります。求人の内容は自分で入れます',
  jobMember: '求人の内容をもとに、その候補者向けに合わせた文面を作ります',
};
export const scoutBasisUsesJob = (b: ScoutBasisKind): boolean => b === 'job' || b === 'jobMember';
export const scoutBasisUsesMember = (b: ScoutBasisKind): boolean => b === 'member' || b === 'jobMember';
/** 求人 ID（jobs の ID。求人ページの URL の数字）・会員 ID。数字だけ */
export const ScoutJobIdSchema = z.string().regex(/^\d{1,12}$/, '求人 ID は数字で入れてください');
export const ScoutMemberIdSchema = z.string().regex(/^\d{1,12}$/, '会員 ID は数字で入れてください');

export const SCOUT_LANGS = ['ja', 'en'] as const;
export type ScoutLang = (typeof SCOUT_LANGS)[number];
export const SCOUT_LANG_LABEL: Record<ScoutLang, string> = { ja: '日本語', en: '英語' };

/** POST /api/companies/:id/ai/jobs の input（kind = scout）。件名・本文・補足に、社名と個人情報を書かない（pii.ts） */
export const ScoutInputSchema = z
  .object({
    purpose: z.enum(SCOUT_PURPOSES),
    /** 何をもとに作るか。求人 ID / 会員 ID は、basis に応じて必須 */
    basis: z.enum(SCOUT_BASES).default('conditions'),
    jobId: ScoutJobIdSchema.nullable().default(null),
    memberId: ScoutMemberIdSchema.nullable().default(null),
    /** 添削する文面（purpose = review のとき必須） */
    subject: z.string().trim().max(SCOUT_SUBJECT_MAX).default(''),
    body: z.string().trim().max(SCOUT_BODY_MAX).default(''),
    /** 業界（企業を選ぶと自動で入る。直せる。分析対象の「類似業界」はこの値から決める） */
    industry: shortText(60).min(1, '業界を入れてください'),
    /** ポジション名（basis が job / jobMember のときは求人から取るので、空でよい。Worker が求人の値で置き換える） */
    positionName: shortText(80).default(''),
    /** 掲載職種（企業を選ぶと自動で入る。直せる。文面の中身に使う。0〜5 個） */
    jobOccupations: z.array(shortText(60).min(1)).max(AI_OCCUPATIONS_MAX).default([]),
    /** 勤務地（求人の勤務地。文面の中身に使う） */
    jobLocation: shortText(60).default(''),
    /** 受け取る人の条件（分析対象の絞り込み + 文面の向け先） */
    filters: ScoutFiltersSchema.default(EMPTY_SCOUT_FILTERS),
    /** 文面の言語 */
    lang: z.enum(SCOUT_LANGS).default('ja'),
    /** 補足（任意。訴求したい点など） */
    note: shortText(500).default(''),
  })
  .strict()
  .superRefine((v, ctx) => {
    const usesJob = v.basis === 'job' || v.basis === 'jobMember';
    const usesMember = v.basis === 'member' || v.basis === 'jobMember';
    if (usesJob && !v.jobId) ctx.addIssue({ code: 'custom', path: ['jobId'], message: '求人 ID を入れてください' });
    if (!usesJob && v.jobId) ctx.addIssue({ code: 'custom', path: ['jobId'], message: 'この作り方では、求人 ID を指定しません' });
    if (usesMember && !v.memberId) ctx.addIssue({ code: 'custom', path: ['memberId'], message: '会員 ID を入れてください' });
    if (!usesMember && v.memberId) ctx.addIssue({ code: 'custom', path: ['memberId'], message: 'この作り方では、会員 ID を指定しません' });
    if (!usesJob && !v.positionName) ctx.addIssue({ code: 'custom', path: ['positionName'], message: 'ポジション名を入れてください' });
    if (v.purpose === 'review') {
      if (!v.subject) ctx.addIssue({ code: 'custom', path: ['subject'], message: '添削する件名を入れてください' });
      if (!v.body) ctx.addIssue({ code: 'custom', path: ['body'], message: '添削する本文を入れてください' });
    }
  });
export type ScoutInput = z.infer<typeof ScoutInputSchema>;

const t = (max: number) => z.string().trim().min(1).max(max);
const tOpt = (max: number) => z.string().trim().max(max).default('');
const pct = z.number().min(0).max(100);

/** ③ 求人の結果が使う（② は ScoutBasisSchema） */
export const BenchmarkBasisSchema = z
  .object({ scope: t(160), companies: z.number().int().min(0), samples: z.number().int().min(0), topRatePct: pct.nullable(), overallRatePct: pct.nullable(), caveat: tOpt(200) })
  .strict();
export type BenchmarkBasis = z.infer<typeof BenchmarkBasisSchema>;

/** 上位の文面に共通する構成・特徴（2〜6 個） */
export const TraitSchema = z.object({ title: t(30), body: t(160) }).strict();
export type Trait = z.infer<typeof TraitSchema>;

/**
 * 分析対象（どの文面を、どう選んだか）。数値はすべてマートの集計（SQL）の結果。企業名は入れない。
 *   scope      … industry = 同じ業界 / group = 類似業界（業界のまとまり）/ all = 全業界
 *   threshold  … over10 = 返信率 10% 超の文面だけ / topBelow10 = 10% 超が無く、返信率の高い順に取った
 */
export const ScoutBasisSchema = z
  .object({
    scope: z.enum(['industry', 'group', 'all']),
    /** 画面に出す説明（例: 「IT・通信（類似業界 6 業種）」） */
    scopeLabel: t(120),
    threshold: z.enum(['over10', 'topBelow10']),
    /** 受け取る人の条件で数え直したか。外した条件があれば filtersRelaxed に（該当が少なくて外したもの） */
    filtersApplied: z.boolean(),
    filtersRelaxed: z.array(z.string().max(20)).max(6).default([]),
    /** 分析した文面の数（最大 1000）・その送信数・返信数・返信率（%） */
    templates: z.number().int().min(0),
    companies: z.number().int().min(0),
    sends: z.number().int().min(0),
    replies: z.number().int().min(0),
    ratePct: pct.nullable(),
    /** 同じ対象範囲・同じ条件の全体（選ぶ前）の返信率（%） */
    overallRatePct: pct.nullable(),
    /** マートの更新日（YYYY-MM-DD）と、送信の対象期間 */
    dataDate: z.string().max(10),
    periodFrom: z.string().max(10),
    periodTo: z.string().max(10),
  })
  .strict();
export type ScoutBasis = z.infer<typeof ScoutBasisSchema>;

/** 四分位（文字数など） */
const QuartileSchema = z.object({ p25: z.number(), median: z.number(), p75: z.number() }).strict();
/**
 * 分析対象の文面の数値（SQL の集計。文面の数で数える）。
 *   features … 特徴ごとの「その特徴を持つ文面の割合（%）」（例: 年収の記載あり・箇条書きあり・「なぜあなたか」に触れている・求人 URL あり）
 */
export const ScoutStatsSchema = z
  .object({
    subjectChars: QuartileSchema,
    bodyChars: QuartileSchema,
    lines: QuartileSchema,
    features: z.array(z.object({ key: z.string().max(40), label: t(40), sharePct: pct }).strict()).max(16),
    langs: z.array(z.object({ lang: z.string().max(8), sharePct: pct }).strict()).max(4),
  })
  .strict();
export type ScoutStats = z.infer<typeof ScoutStatsSchema>;

/** 分析の要点（Vertex AI が、上位の文面と数値を読んでまとめる。条件ごとに 1 週間使い回す） */
export const ScoutInsightSchema = z
  .object({
    /** 件名の型（2〜5 個。例: 「【年収・勤務地】+ ポジション名 + 一言の魅力」） */
    subjectPatterns: z.array(t(120)).min(1).max(5),
    /** 本文の構成（上から順に 3〜7 個。例: 「挨拶と名乗り」「なぜあなたに送ったか」…） */
    structure: z.array(t(80)).min(2).max(7),
    /** 文章量の目安（例: 「本文 600〜900 字。箇条書き 3〜5 行」） */
    volume: t(160),
    /** 特徴（2〜6 個） */
    traits: z.array(TraitSchema).min(2).max(6),
    /** 避けたいこと（0〜4 個。返信率の低い文面に多い点が読み取れたとき） */
    avoid: z.array(t(120)).max(4).default([]),
  })
  .strict();
export type ScoutInsight = z.infer<typeof ScoutInsightSchema>;

/**
 * 求人の内容（画面で確かめる用 + 結果に残す用）。GET /api/companies/:id/ai/scout/jobs/:jobId。
 * 仕事内容・応募条件の全文は返さない（先頭だけ）。企業名は {{企業名}} に置き換え済み。
 */
export const ScoutJobSummarySchema = z.object({
  jobId: z.string(),
  title: z.string(),
  occupation: z.string().nullable(),
  location: z.string().nullable(),
  salary: z.string().nullable(),
  japaneseLevel: z.string().nullable(),
  englishLevel: z.string().nullable(),
  /** 掲載中か（掲載が終わった求人でも作れるが、画面に注意を出す） */
  published: z.boolean(),
  /** 仕事内容・応募条件の先頭（確かめる用。各 200 字まで） */
  descriptionHead: z.string(),
  requirementsHead: z.string(),
});
export type ScoutJobSummary = z.infer<typeof ScoutJobSummarySchema>;

/**
 * 候補者の情報（画面で確かめる用 + 結果に残す用）。GET /api/ai/scout/members/:memberId。
 * BigQuery にある属性だけ（氏名・連絡先・レジュメの本文は無い）。属性は現在のプロフィール。
 */
export const ScoutMemberSummarySchema = z.object({
  memberId: z.string(),
  ageGroup: z.string().nullable(),
  nationality: z.string().nullable(),
  japaneseLevel: z.string().nullable(),
  englishLevel: z.string().nullable(),
  residence: z.string().nullable(),
  /** 最終経験職種（大分類）・最終経験業種・最終の役職レベル */
  occupation: z.string().nullable(),
  lastIndustry: z.string().nullable(),
  careerLevel: z.string().nullable(),
  /** 経験職種（複数）・希望職種（複数） */
  experiencedOccupations: z.array(z.string()).max(12),
  desiredOccupations: z.array(z.string()).max(12),
  incomeRange: z.string().nullable(),
  desiredIncomeRange: z.string().nullable(),
  /** 分析対象の絞り込みに使った条件（Worker が候補者の属性から決める。年齢層・経験職種） */
  filters: ScoutFiltersSchema,
});
export type ScoutMemberSummary = z.infer<typeof ScoutMemberSummarySchema>;

/** 何をもとに作ったか（結果に残す。画面の見出しと履歴に出す） */
export const ScoutTargetSchema = z
  .object({ basis: z.enum(SCOUT_BASES), job: ScoutJobSummarySchema.nullable().default(null), member: ScoutMemberSummarySchema.nullable().default(null) })
  .strict();
export type ScoutTarget = z.infer<typeof ScoutTargetSchema>;

/** 文面を作る 3 つのモデル（作り方の違う 3 通り。ID は固定。中身 = 使う生成モデルとプレイブックは D1 で版を持つ） */
export const SCOUT_MODEL_IDS = ['a', 'b', 'c'] as const;
export type ScoutModelId = (typeof SCOUT_MODEL_IDS)[number];
export const ScoutModelIdSchema = z.enum(SCOUT_MODEL_IDS);

/** 企業が使ったか: unknown = 未確認 / used = 使った / not_used = 使わなかった。source = 誰が付けたか（cs = 画面で / auto = 送信実績との照合） */
export const SCOUT_USED_STATES = ['unknown', 'used', 'not_used'] as const;
export type ScoutUsedState = (typeof SCOUT_USED_STATES)[number];

/** 1 案についてのフィードバックと実績（読み出しのときに Worker が付ける。保存する結果の本体には入れない） */
export const ScoutDraftFeedbackSchema = z
  .object({
    /** CS がこの案を選んだか */
    chosen: z.boolean(),
    usedState: z.enum(SCOUT_USED_STATES),
    usedSource: z.enum(['cs', 'auto']).nullable(),
    /** この案を使った送信の実績（照合できたもの。無ければ null） */
    sends: z.number().int().min(0).nullable(),
    replies: z.number().int().min(0).nullable(),
    hires: z.number().int().min(0).nullable(),
    outcomeAt: z.string().nullable(),
  })
  .strict();
export type ScoutDraftFeedback = z.infer<typeof ScoutDraftFeedbackSchema>;

/**
 * 文面の案（モデルごとに 1 つ）。本文の中の差し込みは {{候補者名}} {{企業名}} {{担当者名}} のように書く（実名を書かない）。
 * changes は添削のときの主な変更点（作成のときは空）。
 */
export const ScoutDraftSchema = z
  .object({
    draftId: z.string().regex(/^[a-z0-9]{8,48}$/),
    modelId: ScoutModelIdSchema,
    modelLabel: t(24),
    modelVersion: z.number().int().min(1),
    subject: t(SCOUT_SUBJECT_MAX),
    body: t(SCOUT_BODY_MAX),
    /** この案の狙い（分析のどの点を取り入れたか） */
    rationale: t(300),
    changes: z.array(t(160)).max(6).default([]),
    feedback: ScoutDraftFeedbackSchema.nullable().default(null),
  })
  .strict();
export type ScoutDraft = z.infer<typeof ScoutDraftSchema>;

/** 結果（D1 ai_jobs.result_json。画面で直した版 = edited も同じ形で、直せるのは drafts の subject / body だけ） */
export const ScoutResultSchema = z
  .object({
    ok: z.literal(true).default(true),
    summary: t(300),
    basis: ScoutBasisSchema,
    stats: ScoutStatsSchema,
    insight: ScoutInsightSchema,
    /** 何をもとに作ったか（求人・候補者の情報の要約）。以前の結果には無い（null = 条件を指定） */
    target: ScoutTargetSchema.nullable().default(null),
    /** 分析を使い回したか（true = 保存済みの分析を使った） */
    insightCached: z.boolean().default(false),
    drafts: z.array(ScoutDraftSchema).min(1).max(3),
    /**
     * この依頼での CS の判断（読み出しのときに Worker が付ける。保存する結果の本体には入れない）。
     * judged = 判断済み（どれかを選んだ / どれも使わない）、none = 「どれも使わない」、comment = 送ったコメント
     */
    choice: z.object({ judged: z.boolean(), none: z.boolean(), comment: z.string().max(300) }).strict().nullable().default(null),
    /** 作れなかったモデルがあれば、その理由（画面に注意として出す） */
    warnings: z.array(z.string().max(200)).max(4).default([]),
    /** かかった時間（ミリ秒）と、使ったトークン数（入力 + 出力。目安） */
    elapsedMs: z.number().int().min(0).default(0),
    tokens: z.number().int().min(0).default(0),
  })
  .strict();
export type ScoutResult = z.infer<typeof ScoutResultSchema>;

/* ---------- フィードバックの API ---------- */

/** PUT /api/ai/jobs/:jobId/scout/choice … どの案を選んだか（draftId = null は「どれも使わない」）。comment = 選んだ理由・直してほしい点（任意。チューニングに使う） */
export const ScoutChoiceInputSchema = z.object({ draftId: z.string().regex(/^[a-z0-9]{8,48}$/).nullable(), comment: shortText(300).default('') }).strict();
export type ScoutChoiceInput = z.infer<typeof ScoutChoiceInputSchema>;

/** PUT /api/ai/jobs/:jobId/scout/usage … 選んだ案を企業が使ったか（CS が付ける。送信実績との照合でも自動で付く） */
export const ScoutUsageInputSchema = z.object({ usedState: z.enum(SCOUT_USED_STATES) }).strict();
export type ScoutUsageInput = z.infer<typeof ScoutUsageInputSchema>;

/* ---------- 条件の選択肢 ---------- */

/** GET /api/ai/scout/options … 受け取る人の条件の選択肢（マートにある値。送信数の多い順） */
export const ScoutOptionsResponseSchema = z.object({
  ageGroups: z.array(z.string()),
  nationalities: z.array(z.string()),
  japaneseLevels: z.array(z.string()),
  englishLevels: z.array(z.string()),
  residences: z.array(z.string()),
  occupations: z.array(z.string()),
  /** マートの更新日。null = マートがまだ無い（選択肢は空） */
  dataDate: z.string().nullable(),
});
export type ScoutOptionsResponse = z.infer<typeof ScoutOptionsResponseSchema>;

/* ---------- モデルの成績とチューニング ---------- */

/** モデルの 1 つの版の成績（その版で作った案について） */
export const ScoutModelStatsSchema = z.object({
  /** 作った案の数・うち CS が判断した依頼（どれかを選んだ / どれも使わない）に含まれる数 */
  drafts: z.number().int().min(0),
  judged: z.number().int().min(0),
  /** 選ばれた数と率（判断された中で） */
  chosen: z.number().int().min(0),
  chosenRatePct: pct.nullable(),
  /** 企業が使った数 */
  used: z.number().int().min(0),
  /** 使われた案の送信・返信・採用と返信率 */
  sends: z.number().int().min(0),
  replies: z.number().int().min(0),
  hires: z.number().int().min(0),
  replyRatePct: pct.nullable(),
  /** 総合点（0〜100。選ばれた率を中心に、利用・返信・採用を足す。重みは src/worker/ai/scout/tuning.ts） */
  score: z.number().min(0).max(100).nullable(),
});
export type ScoutModelStats = z.infer<typeof ScoutModelStatsSchema>;

export const ScoutModelVersionSchema = z.object({
  version: z.number().int().min(1),
  /** この版にした理由（初版 / チューニング（何を直したか）/ 前の版へ戻した） */
  origin: z.enum(['initial', 'tuned', 'rollback', 'manual']),
  note: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  active: z.boolean(),
  stats: ScoutModelStatsSchema,
  /** 作り方（プレイブック）。管理者にだけ返す。ほかの人には null */
  playbook: z.string().nullable(),
});
export type ScoutModelVersion = z.infer<typeof ScoutModelVersionSchema>;

export const ScoutModelSchema = z.object({
  id: ScoutModelIdSchema,
  label: z.string(),
  /** どういう作り方か（1 行） */
  description: z.string(),
  /** 使っている生成モデルの ID（管理者にだけ返す。ほかの人には null） */
  engine: z.string().nullable(),
  activeVersion: z.number().int().min(1),
  versions: z.array(ScoutModelVersionSchema),
});
export type ScoutModel = z.infer<typeof ScoutModelSchema>;

/** GET /api/ai/scout/models */
export const ScoutModelsResponseSchema = z.object({
  models: z.array(ScoutModelSchema),
  /** 最後に検証・チューニングを実行した日時と、その結果の要約 */
  lastTunedAt: z.string().nullable(),
  lastTuneNote: z.string().nullable(),
  /** 次の自動実行（週次）の目安 */
  schedule: z.string(),
  admin: z.boolean(),
});
export type ScoutModelsResponse = z.infer<typeof ScoutModelsResponseSchema>;

/** POST /api/ai/scout/tune（管理者）の応答: モデルごとに何をしたか */
export const ScoutTuneResponseSchema = z.object({
  ranAt: z.string(),
  /** 実績の取り込み（BigQuery → D1）で更新した案の数 */
  outcomesUpdated: z.number().int().min(0),
  results: z.array(
    z.object({
      modelId: ScoutModelIdSchema,
      /** kept = 判断が足りないので据え置き / tuned = 作り方を直して新しい版に / rolledBack = 前の版より悪かったので戻した / failed = 失敗 */
      action: z.enum(['kept', 'tuned', 'rolledBack', 'failed']),
      fromVersion: z.number().int(),
      toVersion: z.number().int(),
      note: z.string(),
    }),
  ),
});
export type ScoutTuneResponse = z.infer<typeof ScoutTuneResponseSchema>;

/** チューニングに要る、最小の判断数（その版で作った案が、これだけの依頼で判断されるまでは据え置く） */
export const SCOUT_TUNE_MIN_JUDGED = 8;
