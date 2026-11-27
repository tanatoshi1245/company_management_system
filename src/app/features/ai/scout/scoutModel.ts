import type { AiJobDetail } from '../../../../shared/ai/common';
import { hasBlockingPii, type PiiFinding } from '../../../../shared/ai/pii';
import {
  EMPTY_SCOUT_FILTERS,
  SCOUT_FILTER_KEYS,
  SCOUT_FILTER_MAX,
  ScoutInputSchema,
  ScoutResultSchema,
  type ScoutBasis,
  type ScoutDraft,
  type ScoutDraftFeedback,
  type ScoutFilterKey,
  type ScoutFilters,
  type ScoutInput,
  type ScoutLang,
  type ScoutPurpose,
  type ScoutResult,
  type ScoutUsedState,
} from '../../../../shared/ai/scout';
import { fieldErrors, piiByField } from '../common/formModel';

/**
 * ② スカウト文面の AI 作成: フォームの状態 → 入力（ScoutInput）、検証、社名・個人情報の確認、
 * 結果の読み取り（直した版の重ね合わせ）、案の手直し、選択・利用の状態、画面に出す文。
 */

export interface ScoutForm {
  /** 添削する文面（目的 = 添削のときだけ使う） */
  subject: string;
  body: string;
  industry: string;
  positionName: string;
  jobOccupations: string[];
  jobLocation: string;
  lang: ScoutLang;
  note: string;
  filters: ScoutFilters;
}

const emptyFilters = (): ScoutFilters => ({ ageGroups: [], nationalities: [], japaneseLevels: [], englishLevels: [], residences: [], occupations: [] });
export const emptyScoutForm = (): ScoutForm => ({ subject: '', body: '', industry: '', positionName: '', jobOccupations: [], jobLocation: '', lang: 'ja', note: '', filters: emptyFilters() });

/** フォーム → API へ送る入力（検証の前の形）。作成では、件名と本文を送らない */
export function toScoutInput(purpose: ScoutPurpose, form: ScoutForm): Record<string, unknown> {
  const review = purpose === 'review';
  const { subject, body, ...rest } = form;
  return { purpose, subject: review ? subject : '', body: review ? body : '', ...rest };
}

export type ScoutValidation = { ok: true; input: ScoutInput; errors: Record<string, never> } | { ok: false; input: null; errors: Record<string, string> };

export function validateScout(purpose: ScoutPurpose, form: ScoutForm): ScoutValidation {
  const r = ScoutInputSchema.safeParse(toScoutInput(purpose, form));
  return r.success ? { ok: true, input: r.data, errors: {} } : { ok: false, input: null, errors: fieldErrors(r.error) };
}

/** 件名・本文・ポジション名・勤務地・補足に、社名・個人情報が入っていないか（block があれば実行できない） */
export function scoutPii(purpose: ScoutPurpose, form: ScoutForm, companyNames: readonly (string | null | undefined)[]): PiiFinding[] {
  const fields = [
    ...(purpose === 'review'
      ? [
          { label: '件名', text: form.subject },
          { label: '本文', text: form.body },
        ]
      : []),
    { label: 'ポジション名', text: form.positionName },
    { label: '勤務地', text: form.jobLocation },
    { label: '補足', text: form.note },
  ];
  return piiByField(fields, companyNames);
}
export { hasBlockingPii };

/** 保存済みのジョブの入力 → フォーム（履歴から開いたとき。読めなければ null） */
export function scoutFormFromInput(input: unknown): { purpose: ScoutPurpose; form: ScoutForm } | null {
  const r = ScoutInputSchema.safeParse(input);
  if (!r.success) return null;
  const { purpose, ...form } = r.data;
  return { purpose, form };
}

/** 条件を 1 つ選ぶ / 外す（上限 SCOUT_FILTER_MAX。上限のときは足さない） */
export function toggleFilter(filters: ScoutFilters, key: ScoutFilterKey, value: string): ScoutFilters {
  const cur = filters[key];
  if (cur.includes(value)) return { ...filters, [key]: cur.filter((v) => v !== value) };
  if (cur.length >= SCOUT_FILTER_MAX) return filters;
  return { ...filters, [key]: [...cur, value] };
}
export const countFilters = (f: ScoutFilters): number => SCOUT_FILTER_KEYS.reduce((n, k) => n + f[k].length, 0);
export { EMPTY_SCOUT_FILTERS };

const parseResult = (v: unknown): ScoutResult | null => {
  if (v === null || v === undefined) return null;
  const r = ScoutResultSchema.safeParse(v);
  return r.success ? r.data : null;
};

export interface ScoutResultRead {
  /** 画面に出す結果（元の結果に、直した版の件名・本文を重ねたもの。選択・実績 = feedback は元の結果のものを使う） */
  result: ScoutResult | null;
  /** 元の結果（Worker が作ったもの） */
  original: ScoutResult | null;
  edited: boolean;
  /** 結果はあるが、形が想定と違って読めない */
  unreadable: boolean;
}

export function readScoutResult(job: Pick<AiJobDetail, 'result' | 'editedResult'> | null): ScoutResultRead {
  const original = parseResult(job?.result);
  const editedResult = parseResult(job?.editedResult);
  let result = original;
  if (original && editedResult) {
    const byId = new Map(editedResult.drafts.map((d) => [d.draftId, d]));
    result = {
      ...original,
      drafts: original.drafts.map((d) => {
        const e = byId.get(d.draftId);
        return e ? { ...d, subject: e.subject, body: e.body, feedback: d.feedback ?? e.feedback } : d;
      }),
    };
  }
  return { result, original, edited: Boolean(original) && editedResult !== null, unreadable: Boolean(job?.result) && original === null };
}

/**
 * 案の件名・本文を差し替えた結果（保存する形）を作り、結果と同じ形で確かめる。
 * 選択・実績（feedback）は読み出しのときに Worker が付けるものなので、保存する形には入れない。
 */
export function withScoutDraft(result: ScoutResult, draftId: string, patch: Pick<ScoutDraft, 'subject' | 'body'>): { ok: true; result: ScoutResult } | { ok: false; errors: Record<string, string> } {
  const drafts = result.drafts.map((d) => ({ ...(d.draftId === draftId ? { ...d, ...patch } : d), feedback: null }));
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

/* ---------- 選択と利用 ---------- */

/** CS が選んだ案（無ければ null。「どれも使わない」と「まだ選んでいない」は、結果からは見分けられない） */
export const chosenDraft = (result: ScoutResult | null): ScoutDraft | null => result?.drafts.find((d) => d.feedback?.chosen) ?? null;

const EMPTY_FEEDBACK: ScoutDraftFeedback = { chosen: false, usedState: 'unknown', usedSource: null, sends: null, replies: null, hires: null, outcomeAt: null };

/** 手元で選択を書き換える（保存されない見本のとき。選び直すと、利用の記録は未確認に戻す） */
export function withLocalChoice(result: ScoutResult, draftId: string | null): ScoutResult {
  return { ...result, drafts: result.drafts.map((d) => ({ ...d, feedback: { ...EMPTY_FEEDBACK, ...(d.feedback?.chosen && d.draftId === draftId ? d.feedback : {}), chosen: d.draftId === draftId } })) };
}
/** 手元で利用の記録を書き換える（保存されない見本のとき） */
export function withLocalUsage(result: ScoutResult, usedState: ScoutUsedState): ScoutResult {
  return { ...result, drafts: result.drafts.map((d) => (d.feedback?.chosen ? { ...d, feedback: { ...d.feedback, usedState, usedSource: usedState === 'unknown' ? null : ('cs' as const) } } : d)) };
}

export const SCOUT_USED_LABEL: Record<ScoutUsedState, string> = { used: '使った', not_used: '使わなかった', unknown: '未確認' };

/* ---------- 画面に出す文 ---------- */

export const fmtPct = (v: number | null): string => (v === null ? '—' : `${v.toFixed(1)}%`);
export const fmtInt = (v: number): string => Math.round(v).toLocaleString('ja-JP');

const SCOPE_LABEL: Record<ScoutBasis['scope'], string> = { industry: '同じ業界', group: '類似業界', all: '全業界' };
export const scoutScopeKind = (b: ScoutBasis): string => SCOPE_LABEL[b.scope];

/** 分析する文面の選び方（返信率 10% 超の文面 n 件 / 10% 超が無いため返信率の高い順に n 件） */
export const scoutThresholdText = (b: ScoutBasis): string =>
  b.threshold === 'over10' ? `返信率 10% 超の文面 ${fmtInt(b.templates)} 件` : `返信率 10% 超の文面が無いため、返信率の高い順に ${fmtInt(b.templates)} 件`;

const LANG_LABEL: Record<string, string> = { ja: '日本語', en: '英語' };
export const scoutLangLabel = (lang: string): string => LANG_LABEL[lang] ?? (lang || 'そのほか');

/** かかった時間（「14.2 秒」）。0 は出さない */
export const elapsedSecLabel = (ms: number): string | null => (ms > 0 ? `${(ms / 1000).toFixed(1)} 秒` : null);
