import type { AiJobDetail } from '../../../../shared/ai/common';
import { hasBlockingPii, type PiiFinding } from '../../../../shared/ai/pii';
import { emptyTargetCondition, type TargetCondition } from '../../../../shared/ai/options';
import { ScoutInputSchema, ScoutResultSchema, type ScoutDraft, type ScoutInput, type ScoutPurpose, type ScoutResult } from '../../../../shared/ai/scout';
import { fieldErrors, piiByField } from '../common/formModel';

/** ② スカウト文面の AI 添削: フォームの状態 → 入力（ScoutInput）、検証、社名・個人情報の確認、結果の読み取り、案の手直し */

export interface ScoutForm {
  /** 添削する文面（目的 = 添削のときだけ使う） */
  subject: string;
  body: string;
  cond: TargetCondition;
}

export const emptyScoutForm = (): ScoutForm => ({ subject: '', body: '', cond: emptyTargetCondition() });

/** フォーム → API へ送る入力（検証の前の形）。テンプレートの作成では、件名と本文を送らない */
export function toScoutInput(purpose: ScoutPurpose, form: ScoutForm): Record<string, unknown> {
  const review = purpose === 'review';
  return { purpose, subject: review ? form.subject : '', body: review ? form.body : '', ...form.cond };
}

export type ScoutValidation = { ok: true; input: ScoutInput; errors: Record<string, never> } | { ok: false; input: null; errors: Record<string, string> };

export function validateScout(purpose: ScoutPurpose, form: ScoutForm): ScoutValidation {
  const r = ScoutInputSchema.safeParse(toScoutInput(purpose, form));
  return r.success ? { ok: true, input: r.data, errors: {} } : { ok: false, input: null, errors: fieldErrors(r.error) };
}

/** 件名・本文・ポジション名・補足に、社名・個人情報が入っていないか（block があれば実行できない） */
export function scoutPii(purpose: ScoutPurpose, form: ScoutForm, companyNames: readonly (string | null | undefined)[]): PiiFinding[] {
  const fields = [
    ...(purpose === 'review'
      ? [
          { label: '件名', text: form.subject },
          { label: '本文', text: form.body },
        ]
      : []),
    { label: 'ポジション名', text: form.cond.positionName },
    { label: '補足', text: form.cond.note },
  ];
  return piiByField(fields, companyNames);
}
export { hasBlockingPii };

/** 保存済みのジョブの入力 → フォーム（履歴から開いたとき。読めなければ null） */
export function scoutFormFromInput(input: unknown): { purpose: ScoutPurpose; form: ScoutForm } | null {
  const r = ScoutInputSchema.safeParse(input);
  if (!r.success) return null;
  const { purpose, subject, body, ...cond } = r.data;
  return { purpose, form: { subject, body, cond } };
}

const parseResult = (v: unknown): ScoutResult | null => {
  if (v === null || v === undefined) return null;
  const r = ScoutResultSchema.safeParse(v);
  return r.success ? r.data : null;
};

export interface ScoutResultRead {
  /** 画面に出す結果（直した版があればそれ） */
  result: ScoutResult | null;
  /** 元の結果（セッションが返したもの） */
  original: ScoutResult | null;
  edited: boolean;
  /** 結果はあるが、形が想定と違って読めない */
  unreadable: boolean;
}

export function readScoutResult(job: Pick<AiJobDetail, 'result' | 'editedResult'> | null): ScoutResultRead {
  const original = parseResult(job?.result);
  const editedResult = parseResult(job?.editedResult);
  return { result: editedResult ?? original, original, edited: editedResult !== null, unreadable: Boolean(job?.result) && original === null };
}

/** 案の件名・本文を差し替えた結果を作り、結果と同じ形で確かめる */
export function withScoutDraft(result: ScoutResult, index: number, patch: Pick<ScoutDraft, 'subject' | 'body'>): { ok: true; result: ScoutResult } | { ok: false; errors: Record<string, string> } {
  const drafts = result.drafts.map((d, i) => (i === index ? { ...d, ...patch } : d));
  const r = ScoutResultSchema.safeParse({ ...result, drafts });
  if (r.success) return { ok: true, result: r.data };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = String(issue.path[issue.path.length - 1] ?? '_');
    if (!(key in errors)) errors[key] = key === 'subject' ? '件名を入れてください（200 文字まで）' : key === 'body' ? '本文を入れてください（5,000 文字まで）' : issue.message;
  }
  return { ok: false, errors };
}

/** コピー用の文（件名 + 本文） */
export const scoutDraftText = (d: Pick<ScoutDraft, 'subject' | 'body'>): string => `件名: ${d.subject}\n\n${d.body}`;
