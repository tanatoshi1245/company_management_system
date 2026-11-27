import { EMPTY_SCOUT_FILTERS, scoutBasisUsesJob, scoutBasisUsesMember, type ScoutFilters, type ScoutInput, type ScoutJobSummary, type ScoutMemberSummary, type ScoutTarget } from '../../../shared/ai/scout';
import { companyNeedles, findPii, hasBlockingPii } from '../../../shared/ai/pii';
import type { ScoutJobInfo, ScoutMemberInfo } from './dataSource';

/**
 * ② スカウト: 何をもとに作るか（求人 ID・会員 ID。2026-11-27 ユーザー指示）の部品。
 *   - 求人の内容の後始末（企業名 → {{企業名}}。マートの時点で置き換えてあるが、Vertex AI へ渡す前にもう一度確かめる）
 *   - 画面で確かめる用・結果に残す用の要約（ScoutJobSummary / ScoutMemberSummary）
 *   - 候補者の属性から決める、分析対象の絞り込み条件
 *   - 求人・候補者の値で置き換えた入力
 * Vertex AI は呼ばない。
 */

/** 画面で確かめる用の、仕事内容・応募条件の先頭 */
export const JOB_HEAD_CHARS = 200;
/** プロンプトへ入れる、仕事内容・応募条件の先頭（トークンを抑える） */
export const JOB_PROMPT_DESCRIPTION_CHARS = 700;
export const JOB_PROMPT_REQUIREMENTS_CHARS = 500;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const URL_RE = /https?:\/\/[^\s<>"'）)」】]+/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g;
const PHONE_RE = /(\+81[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4})|(\(?0\d{1,4}\)?[-\s]\d{1,4}[-\s]\d{3,4})|(?<!\d)0[5789]0\d{8}(?!\d)/g;

/**
 * 求人の文（タイトル・仕事内容・応募条件など）を、Vertex AI へ渡せる形にする:
 * 企業名 → {{企業名}}、URL → {{URL}}、メールアドレス・電話番号 → {{連絡先}}。それでも残るときは、その文を使わない（空にする）
 */
export function maskJobText(text: string, companyNames: readonly (string | null | undefined)[]): string {
  if (!text) return '';
  let out = text;
  if (hasBlockingPii(findPii(out, companyNames))) {
    for (const n of companyNeedles(companyNames).sort((a, b) => b.length - a.length)) out = out.replace(new RegExp(esc(n), 'gi'), '{{企業名}}');
    out = out.replace(URL_RE, '{{URL}}').replace(EMAIL_RE, '{{連絡先}}').replace(PHONE_RE, '{{連絡先}}');
    if (hasBlockingPii(findPii(out, companyNames))) return '';
  }
  return out.trim();
}

const maskOpt = (v: string | null, names: readonly (string | null | undefined)[]): string | null => (v === null ? null : maskJobText(v, names) || null);

/** 求人のすべての文に maskJobText を掛けたもの（生成・要約は、これだけを使う） */
export function maskJob(job: ScoutJobInfo, companyNames: readonly (string | null | undefined)[]): ScoutJobInfo {
  return {
    ...job,
    title: maskJobText(job.title, companyNames),
    occupation: maskOpt(job.occupation, companyNames),
    location: maskOpt(job.location, companyNames),
    salary: maskOpt(job.salary, companyNames),
    description: maskJobText(job.description, companyNames),
    requirements: maskJobText(job.requirements, companyNames),
  };
}

const head = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 求人の要約（job は maskJob 済みのもの） */
export function jobSummaryOf(job: ScoutJobInfo): ScoutJobSummary {
  return {
    jobId: job.jobId,
    title: job.title,
    occupation: job.occupation,
    location: job.location,
    salary: job.salary,
    japaneseLevel: job.japaneseLevel,
    englishLevel: job.englishLevel,
    published: job.published,
    descriptionHead: head(job.description, JOB_HEAD_CHARS),
    requirementsHead: head(job.requirements, JOB_HEAD_CHARS),
  };
}

/**
 * 候補者から決める絞り込み条件: 年齢層と経験職種（最終経験職種の大分類）の 2 つ。値が無いものは付けない。
 * 条件に合う文面が足りないときは、マートの SQL の決まりどおり条件が外れる（結果の basis.filtersRelaxed）
 */
export function memberFiltersOf(m: ScoutMemberInfo): ScoutFilters {
  return { ...EMPTY_SCOUT_FILTERS, ageGroups: m.ageGroup ? [m.ageGroup] : [], occupations: m.occupation ? [m.occupation] : [] };
}

export function memberSummaryOf(m: ScoutMemberInfo): ScoutMemberSummary {
  return {
    memberId: m.memberId,
    ageGroup: m.ageGroup,
    nationality: m.nationality,
    japaneseLevel: m.japaneseLevel,
    englishLevel: m.englishLevel,
    residence: m.residence,
    occupation: m.occupation,
    lastIndustry: m.lastIndustry,
    careerLevel: m.careerLevel,
    experiencedOccupations: m.experiencedOccupations.slice(0, 12),
    desiredOccupations: m.desiredOccupations.slice(0, 12),
    incomeRange: m.incomeRange,
    desiredIncomeRange: m.desiredIncomeRange,
    filters: memberFiltersOf(m),
  };
}

/**
 * 求人・候補者の値で置き換えた入力:
 *   job / jobMember    … ポジション名・掲載職種・勤務地は、求人の値（入力に入っていても、求人を正とする）
 *   member / jobMember … 受け取る人の条件は、候補者の属性から決めたもの（入力の条件は使わない）
 */
export function effectiveInput(input: ScoutInput, job: ScoutJobInfo | null, member: ScoutMemberInfo | null): ScoutInput {
  let out = input;
  if (job && scoutBasisUsesJob(input.basis)) {
    out = { ...out, positionName: (job.title || `求人 ${job.jobId}`).slice(0, 80), jobOccupations: job.occupation ? [job.occupation.slice(0, 60)] : [], jobLocation: (job.location ?? '').slice(0, 60) };
  }
  if (member && scoutBasisUsesMember(input.basis)) out = { ...out, filters: memberFiltersOf(member) };
  return out;
}

export function targetOf(input: ScoutInput, job: ScoutJobInfo | null, member: ScoutMemberInfo | null): ScoutTarget {
  return { basis: input.basis, job: job ? jobSummaryOf(job) : null, member: member ? memberSummaryOf(member) : null };
}
