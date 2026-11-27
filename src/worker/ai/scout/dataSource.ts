import type { ScoutBasis, ScoutFilters, ScoutLang, ScoutOptionsResponse, ScoutStats } from '../../../shared/ai/scout';

/**
 * ② スカウト: 分析に使うデータの入口（BigQuery の日次マート dwh.cms_ai_scout_*。bq/ai/）。
 * 実装は bqDataSource.ts（マートを @param で読む）。サンプルデータ（BQ_MOCK=1）ではフィクスチャを返す。
 * 生成の側（service.ts）は、この型だけに依存する（SQL を知らない）。
 */

/** 分析対象を決める条件 */
export interface ScoutBenchmarkQuery {
  /** 依頼した企業（分析対象から除く） */
  companyId: string;
  /** 入力の業界（マートの industry の値。類似業界のまとまりは bq/ai の対応表で決まる） */
  industry: string;
  filters: ScoutFilters;
  /** 文面の言語（その言語の文面を優先して要点の材料にする。数える対象は絞らない） */
  lang: ScoutLang;
}

/** 要点の材料にする上位の文面（企業名・URL・メールアドレス・電話番号はマートの時点で置き換え済み） */
export interface ScoutDigestTemplate {
  /** 順位（返信率の高い順。1 始まり） */
  rank: number;
  subject: string;
  /** 本文（長いものは先頭だけ） */
  body: string;
  bodyChars: number;
  sends: number;
  replies: number;
  ratePct: number;
  lang: string;
}

export interface ScoutBenchmark {
  basis: ScoutBasis;
  stats: ScoutStats;
  /** 要点の材料（上位の文面。1 社あたりの数を抑えて、最大 DIGEST_MAX 件） */
  digest: ScoutDigestTemplate[];
  /** この分析対象を表すキー（対象範囲 + 条件 + マートの週。分析の使い回しに使う） */
  cacheKey: string;
}

/** 選ばれた案の、送信実績との照合結果（日次マート dwh.cms_ai_scout_draft_outcomes） */
export interface ScoutDraftOutcome {
  draftId: string;
  /** 照合できた文面があるか（= 企業が使った） */
  matched: boolean;
  sends: number;
  replies: number;
  hires: number;
  /** 最初に送られた日（YYYY-MM-DD） */
  firstSentOn: string | null;
}

/** BigQuery へ写す、選ばれた案（照合のため。企業名は入れない） */
export interface ScoutDraftExport {
  draftId: string;
  jobId: string;
  companyId: string;
  modelId: string;
  modelVersion: number;
  subject: string;
  body: string;
  /** 選ばれた日時（ISO） */
  chosenAt: string;
}

/** 求人の内容（マート dwh.cms_ai_jobs。企業名は {{企業名}} に置き換え済み。本文は長いものは先頭だけ） */
export interface ScoutJobInfo {
  jobId: string;
  title: string;
  occupation: string | null;
  industry: string | null;
  location: string | null;
  /** 年収の表示（例: 500万円〜800万円）。無ければ null */
  salary: string | null;
  japaneseLevel: string | null;
  englishLevel: string | null;
  published: boolean;
  /** 仕事内容・応募条件（先頭 JOB_TEXT_CHARS 文字） */
  description: string;
  requirements: string;
}

/** 候補者の属性（マート dwh.cms_ai_member_profiles。氏名・連絡先・レジュメの本文は無い） */
export interface ScoutMemberInfo {
  memberId: string;
  ageGroup: string | null;
  nationality: string | null;
  japaneseLevel: string | null;
  englishLevel: string | null;
  residence: string | null;
  occupation: string | null;
  lastIndustry: string | null;
  careerLevel: string | null;
  experiencedOccupations: string[];
  desiredOccupations: string[];
  incomeRange: string | null;
  desiredIncomeRange: string | null;
  /**
   * 職務経歴・自己PR のテキスト（マート dwh_restricted.cms_ai_member_resumes。2026-11-27 ユーザー指示で追加）。
   * ターゲット人材で、本文の登録がある会員だけ。無ければ null（属性だけで作る）。
   * メールアドレス・URL・電話番号は取り込みの時点で伏せてある。**勤務先の社名は持たない**。本文に氏名・社名が混ざっていることはある。
   */
  resume: ScoutMemberResume | null;
}

/** 職務経歴 1 社ぶん（新しい順）。社名は持たない */
export interface ScoutMemberWork {
  /** 役職・職種の名前（本人の入力） */
  title: string | null;
  /** 期間（YYYY-MM）。在職中は to = null */
  from: string | null;
  to: string | null;
  /** 職務内容（先頭 RESUME_WORK_CHARS 文字） */
  notes: string;
}

export interface ScoutMemberResume {
  /** 本文の言語（ja / en）。文面の言語に合うものを優先して 1 つ */
  lang: string;
  /** 自己PR（先頭 RESUME_APPEAL_CHARS 文字）。無ければ空 */
  appeal: string;
  appealChars: number;
  /** 職務経歴（新しい順に RESUME_WORK_MAX 社まで） */
  work: ScoutMemberWork[];
  /** 登録されている職務経歴の数・職務内容の合計の文字数 */
  workCount: number;
  workChars: number;
  /** マネジメント経験の年数・転職回数（登録があれば） */
  managementYears: number | null;
  jobChanges: number | null;
}

export const RESUME_WORK_MAX = 3;
export const RESUME_WORK_CHARS = 600;
export const RESUME_APPEAL_CHARS = 600;

export const JOB_TEXT_CHARS = 1500;

export const DIGEST_MAX = 24;
export const DIGEST_BODY_CHARS = 900;

export interface ScoutDataSource {
  /** 受け取る人の条件の選択肢（マートにある値） */
  options(): Promise<ScoutOptionsResponse>;
  /** 分析対象（上位 1000 件）の数値と、要点の材料。マートが無い・対象が 0 件のときは null */
  benchmark(q: ScoutBenchmarkQuery): Promise<ScoutBenchmark | null>;
  /** 求人の内容。**その企業の求人でなければ null**（ほかの企業の求人を読ませない）。無い ID も null */
  job(companyId: string, jobId: string): Promise<ScoutJobInfo | null>;
  /** 候補者の属性と、職務経歴・自己PR（あれば。lang = 文面の言語に合う本文を優先）。無い ID は null */
  member(memberId: string, lang?: ScoutLang): Promise<ScoutMemberInfo | null>;
  /** 選ばれた案を BigQuery へ写す（MERGE）。書き込めないとき（権限なし・サンプルデータ）は false */
  exportDrafts(rows: ScoutDraftExport[]): Promise<boolean>;
  /** 写した案の照合結果を読む */
  outcomes(draftIds: string[]): Promise<ScoutDraftOutcome[]>;
}
