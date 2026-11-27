import type { AiCompanyJob, AiJobDetail } from '../../../../shared/ai/common';
import { hasBlockingPii, type PiiFinding } from '../../../../shared/ai/pii';
import { emptyTargetCondition, type TargetCondition } from '../../../../shared/ai/options';
import { JobInputSchema, JobResultSchema, type JobDraft, type JobInput, type JobPurpose, type JobResult, type JobSource } from '../../../../shared/ai/job';
import { fieldErrors, piiByField } from '../common/formModel';

/** ③ 求人の AI 添削: フォームの状態 → 入力（JobInput）、検証、社名・個人情報の確認、掲載中の求人からの自動入力、結果の読み取り、案の手直し */

export interface JobForm {
  /** 添削する求人の渡し方（目的 = 添削のときだけ使う） */
  source: JobSource;
  jobKey: string | null;
  /** 貼り付けた求人 */
  title: string;
  description: string;
  requirements: string;
  salary: string;
  cond: TargetCondition;
}

export const emptyJobForm = (): JobForm => ({ source: 'posted', jobKey: null, title: '', description: '', requirements: '', salary: '', cond: emptyTargetCondition() });

/** フォーム → API へ送る入力（検証の前の形）。使わない欄は送らない（求人票の作成・掲載中の求人を選んだとき） */
export function toJobInput(purpose: JobPurpose, form: JobForm): Record<string, unknown> {
  const pasted = purpose === 'review' && form.source === 'pasted';
  const posted = purpose === 'review' && form.source === 'posted';
  return {
    purpose,
    source: posted ? 'posted' : 'pasted',
    jobKey: posted ? form.jobKey : null,
    title: pasted ? form.title : '',
    description: pasted ? form.description : '',
    requirements: pasted ? form.requirements : '',
    salary: form.salary,
    ...form.cond,
  };
}

export type JobValidation = { ok: true; input: JobInput; errors: Record<string, never> } | { ok: false; input: null; errors: Record<string, string> };

export function validateJob(purpose: JobPurpose, form: JobForm): JobValidation {
  const r = JobInputSchema.safeParse(toJobInput(purpose, form));
  return r.success ? { ok: true, input: r.data, errors: {} } : { ok: false, input: null, errors: fieldErrors(r.error) };
}

/** 貼り付けた求人・ポジション名・補足に、社名・個人情報が入っていないか（block があれば実行できない） */
export function jobPii(purpose: JobPurpose, form: JobForm, companyNames: readonly (string | null | undefined)[]): PiiFinding[] {
  const pasted = purpose === 'review' && form.source === 'pasted';
  const fields = [
    ...(pasted
      ? [
          { label: '求人タイトル', text: form.title },
          { label: '仕事内容', text: form.description },
          { label: '応募条件', text: form.requirements },
        ]
      : []),
    { label: 'ポジション名', text: form.cond.positionName },
    { label: '補足', text: form.cond.note },
  ];
  return piiByField(fields, companyNames);
}
export { hasBlockingPii };

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

/** 掲載中の求人の語学レベル → 言語力の欄の文（「未設定」「なし」は書かない） */
export function languageOfJob(job: Pick<AiCompanyJob, 'japaneseLevel' | 'englishLevel'>): string {
  const ok = (v: string | null): v is string => Boolean(v) && v !== '未設定' && v !== 'なし';
  return clip([ok(job.japaneseLevel) ? `日本語: ${job.japaneseLevel}` : null, ok(job.englishLevel) ? `英語: ${job.englishLevel}` : null].filter(Boolean).join(' / '), 80);
}

/**
 * 掲載中の求人を選んだときに自動で入れる値（ポジション名・職種・勤務地・言語力・年収）。値のある項目だけ入れる（入力者が後から直せる）。
 */
export function patchFromPostedJob(job: AiCompanyJob): { cond: Partial<TargetCondition>; salary?: string } {
  const cond: Partial<TargetCondition> = { positionName: clip(job.title.trim(), 80) };
  if (job.occupation) cond.occupations = [clip(job.occupation, 60)];
  if (job.location && job.location !== '未設定') cond.location = clip(job.location, 60);
  const language = languageOfJob(job);
  if (language) cond.language = language;
  const salary = job.salaryBand && job.salaryBand !== '未設定' ? clip(job.salaryBand, 40) : undefined;
  return { cond, salary };
}

/** 保存済みのジョブの入力 → フォーム（履歴から開いたとき。読めなければ null） */
export function jobFormFromInput(input: unknown): { purpose: JobPurpose; form: JobForm } | null {
  const r = JobInputSchema.safeParse(input);
  if (!r.success) return null;
  const { purpose, source, jobKey, title, description, requirements, salary, ...cond } = r.data;
  return { purpose, form: { source: purpose === 'review' ? source : 'posted', jobKey, title, description, requirements, salary, cond } };
}

const parseResult = (v: unknown): JobResult | null => {
  if (v === null || v === undefined) return null;
  const r = JobResultSchema.safeParse(v);
  return r.success ? r.data : null;
};

export interface JobResultRead {
  result: JobResult | null;
  original: JobResult | null;
  edited: boolean;
  unreadable: boolean;
}

export function readJobResult(job: Pick<AiJobDetail, 'result' | 'editedResult'> | null): JobResultRead {
  const original = parseResult(job?.result);
  const editedResult = parseResult(job?.editedResult);
  return { result: editedResult ?? original, original, edited: editedResult !== null, unreadable: Boolean(job?.result) && original === null };
}

const DRAFT_ERROR: Record<string, string> = { title: '求人タイトルを入れてください（200 文字まで）', description: '仕事内容を入れてください（6,000 文字まで）', requirements: '応募条件を入れてください（6,000 文字まで）' };

/** 案のタイトル・仕事内容・応募条件を差し替えた結果を作り、結果と同じ形で確かめる */
export function withJobDraft(result: JobResult, patch: Pick<JobDraft, 'title' | 'description' | 'requirements'>): { ok: true; result: JobResult } | { ok: false; errors: Record<string, string> } {
  const r = JobResultSchema.safeParse({ ...result, draft: { ...result.draft, ...patch } });
  if (r.success) return { ok: true, result: r.data };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = String(issue.path[issue.path.length - 1] ?? '_');
    if (!(key in errors)) errors[key] = DRAFT_ERROR[key] ?? issue.message;
  }
  return { ok: false, errors };
}

/** コピー用の文（タイトル + 仕事内容 + 応募条件） */
export const jobDraftText = (d: Pick<JobDraft, 'title' | 'description' | 'requirements'>): string => `【求人タイトル】\n${d.title}\n\n【仕事内容】\n${d.description}\n\n【応募条件】\n${d.requirements}`;
