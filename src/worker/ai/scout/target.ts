import { EMPTY_SCOUT_FILTERS, scoutBasisUsesJob, scoutBasisUsesMember, type ScoutFilters, type ScoutInput, type ScoutJobSummary, type ScoutMemberSummary, type ScoutTarget } from '../../../shared/ai/scout';
import { companyNeedles, findPii, hasBlockingPii } from '../../../shared/ai/pii';
import { RESUME_APPEAL_CHARS, RESUME_WORK_CHARS, RESUME_WORK_MAX, type ScoutJobInfo, type ScoutMemberInfo, type ScoutMemberResume } from './dataSource';

/**
 * ② スカウト: 何をもとに作るか（求人 ID・会員 ID。2026-11-27 ユーザー指示）の部品。
 *   - 求人の内容の後始末（企業名 → {{企業名}}。マートの時点で置き換えてあるが、Vertex AI へ渡す前にもう一度確かめる）
 *   - 画面で確かめる用・結果に残す用の要約（ScoutJobSummary / ScoutMemberSummary）
 *   - 候補者の属性から決める、分析対象の絞り込み条件
 *   - 求人・候補者の値で置き換えた入力
 *   - 候補者の職務経歴・自己PR（2026-11-27）: Vertex AI へ渡す形（resumeForPrompt）、要約（件数・文字数・直近の役職名だけ）、
 *     作られた文面が本文を写していないかの判定（findResumeCopy・resumeCompanyNames）
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

/* ---------- 候補者の職務経歴・自己PR（本文は Vertex AI へ渡すだけ。画面・結果・D1・ログには出さない） ---------- */

const RESUME_TITLE_CHARS = 60;
const maskContacts = (s: string): string => s.replace(URL_RE, '[URL]').replace(EMAIL_RE, '[EMAIL]').replace(PHONE_RE, '[PHONE]');
/** 役職名（本人の入力）。長いものは先頭だけ。連絡先が入っているものは使わない */
const cleanTitle = (t: string | null): string | null => {
  const v = (t ?? '').replace(/\s+/g, ' ').trim().slice(0, RESUME_TITLE_CHARS);
  return v && !hasBlockingPii(findPii(v)) ? v : null;
};

/**
 * Vertex AI へ渡す、職務経歴・自己PR（最小限）: 自己PR の先頭 600 字、職務経歴の新しい順 3 社（役職名・期間・職務内容の先頭 600 字）、マネジメント経験の年数。
 * データの入口で切ってあるが、ここでもう一度切る（上限を、渡す側で保証する）。伏せ漏れの連絡先・URL は伏せる。本文が 1 つも無ければ null（= 属性だけで作る）
 */
export function resumeForPrompt(r: ScoutMemberResume | null): ScoutMemberResume | null {
  if (!r) return null;
  const appeal = maskContacts(r.appeal ?? '').trim().slice(0, RESUME_APPEAL_CHARS);
  const work = (r.work ?? [])
    .slice(0, RESUME_WORK_MAX)
    .map((w) => ({ title: cleanTitle(w.title), from: w.from, to: w.to, notes: maskContacts(w.notes ?? '').trim().slice(0, RESUME_WORK_CHARS) }))
    .filter((w) => w.notes || w.title);
  if (!appeal && !work.some((w) => w.notes)) return null;
  return { ...r, appeal, work };
}

/** 画面・結果に出す要約（本文は入れない）。Vertex AI へ渡せる本文が無いときは null（登録なしと同じ扱い） */
export function resumeSummaryOf(r: ScoutMemberResume | null): ScoutMemberSummary['resume'] {
  const p = resumeForPrompt(r);
  if (!p || !r) return null;
  const n = (v: number, min: number) => Math.max(min, Math.round(Number.isFinite(v) ? v : 0));
  return {
    lang: r.lang,
    workCount: n(r.workCount, p.work.length),
    workChars: n(r.workChars, 0),
    appealChars: n(r.appealChars, 0),
    latestTitle: p.work[0]?.title ?? null,
    managementYears: r.managementYears,
  };
}

/** Vertex AI へ渡した本文（丸写しの判定の元）。p は resumeForPrompt 済みのもの */
export const resumeTexts = (p: ScoutMemberResume | null): string[] => (p ? [p.appeal, ...p.work.map((w) => w.notes)].filter(Boolean) : []);

/** 丸写しとみなす、連続して同じ文字の数（空白・改行・全角半角・大文字小文字の違いは無視して数える） */
export const RESUME_COPY_MIN_CHARS = 30;
const squash = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/**
 * 丸写しの判定: sources（渡した本文）のどれかと、連続 minChars 文字以上が同じ部分が text にあれば、その部分（先頭 minChars 文字。正規化後）を返す。無ければ null。
 * 返す値は本文の一部なので、ログ・結果に出さない（判定とテストにだけ使う）
 */
export function findResumeCopy(text: string, sources: readonly string[], minChars = RESUME_COPY_MIN_CHARS): string | null {
  const t = squash(text);
  if (t.length < minChars) return null;
  const grams = new Set<string>();
  for (let i = 0; i + minChars <= t.length; i++) grams.add(t.slice(i, i + minChars));
  for (const src of sources) {
    const s = squash(src);
    for (let i = 0; i + minChars <= s.length; i++) {
      const g = s.slice(i, i + minChars);
      if (grams.has(g)) return g;
    }
  }
  return null;
}

const LEGAL_JA = '(?:株式会社|有限会社|合同会社|㈱|\\(株\\)|（株）)';
/** 名前の部分: カタカナ・漢字・英数字の続き（ひらがな・記号・空白で切れる）。3〜24 文字 */
const NAME_RUN = '([ァ-ヶー一-龠A-Za-z0-9&]{3,24})';
const COMPANY_AFTER = new RegExp(`${LEGAL_JA}\\s*${NAME_RUN}`, 'g');
const COMPANY_BEFORE = new RegExp(`${NAME_RUN}\\s*${LEGAL_JA}`, 'g');
const COMPANY_EN = /\b([A-Z][A-Za-z0-9&-]+(?: [A-Z][A-Za-z0-9&-]+){0,3}),? (?:Inc|Corp|Corporation|Co\.,? ?Ltd|Ltd|LLC|K\.K|GmbH)\b/g;

/**
 * 本文の中の、法人格つきで書かれた社名（「株式会社〇〇」「〇〇株式会社」「〇〇 Inc.」）の、名前の部分（3 文字以上）。
 * 作られた文面にこれが入っていたら、写したとみなす。目安の判定で、法人格なしで書かれた社名・製品名は拾えない（プロンプトの決まりで防ぐ）
 */
export function resumeCompanyNames(sources: readonly string[]): string[] {
  const out = new Set<string>();
  for (const src of sources) {
    const s = src.normalize('NFKC');
    for (const re of [COMPANY_AFTER, COMPANY_BEFORE, COMPANY_EN]) for (const m of s.matchAll(re)) if (m[1]) out.add(m[1]);
  }
  return [...out];
}

/** 作られた文面に、本文の丸写し（連続 30 文字）か、本文の中の社名が入っているか */
export function copiesResume(text: string, sources: readonly string[]): boolean {
  if (sources.length === 0) return false;
  if (findResumeCopy(text, sources)) return true;
  const t = text.normalize('NFKC').toLowerCase();
  return resumeCompanyNames(sources).some((n) => t.includes(n.toLowerCase()));
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
    resume: resumeSummaryOf(m.resume),
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
