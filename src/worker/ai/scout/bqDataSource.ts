import { EMPTY_SCOUT_FILTERS, hasScoutFilters, SCOUT_FILTER_KEYS, SCOUT_FILTER_LABEL, type ScoutBasis, type ScoutFilters, type ScoutLang, type ScoutOptionsResponse, type ScoutStats } from '../../../shared/ai/scout';
import { industryGroupById, industryGroupOf } from '../../../shared/ai/industryGroups';
import { startOfWeek } from '../../../shared/calendar/periods';
import type { BqClient } from '../../bq/client';
import type { Row } from '../../bq/parseRows';
import type { Env } from '../../env';
import { makeClient } from '../../services/clients';
import { aiScoutBenchmarkQuery, aiScoutDraftsMergeQuery, aiScoutJobQuery, aiScoutMemberQuery, aiScoutMemberResumeQuery, aiScoutOptionsQuery, aiScoutOutcomesQuery, EXPORT_MAX_ROWS, SCOUT_FEATURES } from '../../sql/aiScout';
import {
  DIGEST_BODY_CHARS,
  DIGEST_MAX,
  JOB_TEXT_CHARS,
  RESUME_APPEAL_CHARS,
  RESUME_WORK_CHARS,
  RESUME_WORK_MAX,
  type ScoutBenchmark,
  type ScoutBenchmarkQuery,
  type ScoutDataSource,
  type ScoutDigestTemplate,
  type ScoutDraftExport,
  type ScoutDraftOutcome,
  type ScoutJobInfo,
  type ScoutMemberInfo,
  type ScoutMemberResume,
  type ScoutMemberWork,
} from './dataSource';

/**
 * ② スカウト: 分析に使うデータの入口の実装（日次マート dwh.cms_ai_*。SQL は src/worker/sql/aiScout.ts）。
 * 候補者の職務経歴・自己PR だけは、閲覧制限付きのデータセットのマート dwh_restricted.cms_ai_member_resumes（この 1 表だけ。読めなければ、属性だけで返す）。
 * サンプルデータ（BQ_MOCK=1）でも同じ道を通る（クライアントがフィクスチャを返す。書き込みだけはしない）。
 * マートが無い・権限が無い・鍵が無いときは、例外にせず「データなし」を返す（生成の側は、数値なしの案内に切り替える）。
 */

const num = (v: Row[string] | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v ?? 0) || 0);
const round1 = (v: number): number => Math.round(v * 10) / 10;
const pctOf = (part: number, whole: number): number | null => (whole > 0 ? Math.min(100, Math.max(0, round1((100 * part) / whole))) : null);
const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function logError(where: string, e: unknown): void {
  console.error(`[ai/scout] ${where}: ${e instanceof Error ? e.message : String(e)}`);
}

/** 条件を、順序と重複に依らない文字列にする（キーは決まった順、値は並べ替え） */
export function normalizeFilters(f: ScoutFilters): string {
  return SCOUT_FILTER_KEYS.map((k) => `${k}=${Array.from(new Set(f[k].map((v) => v.trim()).filter(Boolean))).sort().join(',')}`).join(';');
}

/**
 * 分析対象を表すキー: 範囲（+ 業界 / まとまり）+ 効いている条件 + 言語 + マートの更新日が属する週（月曜始まり）→ SHA-256 の先頭 32 文字。
 * 条件を外した（filtersApplied = false）ときは、条件なしと同じキーになる
 */
export async function scoutCacheKey(i: { scope: ScoutBasis['scope']; scopeValue: string; filters: ScoutFilters | null; lang: ScoutLang; dataDate: string }): Promise<string> {
  const filters = normalizeFilters(i.filters ?? EMPTY_SCOUT_FILTERS);
  const text = ['scout-insight-v1', i.scope, i.scopeValue, filters, i.lang, startOfWeek(i.dataDate)].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** 範囲の説明（画面に出す。例: 「同じ業界（人材紹介会社）」「類似業界: IT・通信（8 業種）」「全業界」） */
export function scopeLabelOf(scope: ScoutBasis['scope'], industry: string, groupId: string): string {
  if (scope === 'industry') return `同じ業界（${industry}）`.slice(0, 120);
  if (scope === 'group') {
    const g = industryGroupById(groupId);
    return g ? `類似業界: ${g.label}（${g.industries.length} 業種）` : '類似業界';
  }
  return '全業界';
}

function parseDigest(json: unknown): ScoutDigestTemplate[] {
  if (typeof json !== 'string' || !json) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: ScoutDigestTemplate[] = [];
  for (const x of arr as Record<string, unknown>[]) {
    const body = typeof x.body === 'string' ? x.body.slice(0, DIGEST_BODY_CHARS) : '';
    if (!body.trim()) continue;
    const sends = Number(x.sends) || 0;
    const replies = Number(x.replies) || 0;
    out.push({
      rank: Number(x.rank) || out.length + 1,
      subject: typeof x.subject === 'string' ? x.subject : '',
      body,
      bodyChars: Number(x.body_chars) || body.length,
      sends,
      replies,
      ratePct: pctOf(replies, sends) ?? 0,
      lang: typeof x.lang === 'string' ? x.lang : '',
    });
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, DIGEST_MAX);
}

/** マートの 1 行 → 契約の型。対象が 0 件・更新日なしのときは null */
export async function toBenchmark(row: Row | undefined, q: ScoutBenchmarkQuery, groupId: string): Promise<ScoutBenchmark | null> {
  if (!row || !isYmd(row.data_date)) return null;
  const templates = num(row.templates);
  if (templates <= 0) return null;
  const level = Math.min(6, Math.max(1, Math.trunc(num(row.level)) || 6));
  const scope: ScoutBasis['scope'] = level === 1 || level === 4 ? 'industry' : level === 2 || level === 5 ? 'group' : 'all';
  const asked = hasScoutFilters(q.filters);
  const filtersApplied = asked && level <= 3;
  const filtersRelaxed = asked && !filtersApplied ? SCOUT_FILTER_KEYS.filter((k) => q.filters[k].length > 0).map((k) => SCOUT_FILTER_LABEL[k]) : [];
  const sends = num(row.sends);
  const replies = num(row.replies);
  const basis: ScoutBasis = {
    scope,
    scopeLabel: scopeLabelOf(scope, q.industry, groupId),
    threshold: row.any_over === true ? 'over10' : 'topBelow10',
    filtersApplied,
    filtersRelaxed,
    templates,
    companies: num(row.companies),
    sends,
    replies,
    ratePct: pctOf(replies, sends),
    overallRatePct: pctOf(num(row.overall_replies), num(row.overall_sends)),
    dataDate: row.data_date,
    periodFrom: isYmd(row.period_from) ? row.period_from : '',
    periodTo: isYmd(row.period_to) ? row.period_to : row.data_date,
  };
  const quart = (k: string) => ({ p25: num(row[`${k}_p25`]), median: num(row[`${k}_median`]), p75: num(row[`${k}_p75`]) });
  const stats: ScoutStats = {
    subjectChars: quart('subject'),
    bodyChars: quart('body'),
    lines: quart('lines'),
    features: SCOUT_FEATURES.map((f) => ({ key: f.key, label: f.label, sharePct: pctOf(num(row[f.key]), templates) ?? 0 })),
    langs: (['ja', 'en'] as const).map((l) => ({ lang: l, sharePct: pctOf(num(row[`lang_${l}`]), templates) ?? 0 })).filter((l) => l.sharePct > 0),
  };
  const cacheKey = await scoutCacheKey({
    scope,
    scopeValue: scope === 'industry' ? q.industry.trim() : scope === 'group' ? groupId : '',
    filters: filtersApplied ? q.filters : null,
    lang: q.lang,
    dataDate: row.data_date,
  });
  return { basis, stats, digest: parseDigest(row.digest_json), cacheKey };
}

const EMPTY_OPTIONS: ScoutOptionsResponse = { ageGroups: [], nationalities: [], japaneseLevels: [], englishLevels: [], residences: [], occupations: [], dataDate: null };

export function toOptions(rows: Row[]): ScoutOptionsResponse {
  const out: ScoutOptionsResponse = { ...EMPTY_OPTIONS, ageGroups: [], nationalities: [], japaneseLevels: [], englishLevels: [], residences: [], occupations: [] };
  const keys = new Set<string>(SCOUT_FILTER_KEYS);
  // 送信数の多い順（SQL でも並べているが、ここでも保証する）
  const sorted = [...rows].sort((a, b) => num(b.n) - num(a.n));
  for (const r of sorted) {
    if (isYmd(r.data_date)) out.dataDate = r.data_date;
    const attr = String(r.attr ?? '');
    if (!keys.has(attr) || typeof r.value !== 'string' || !r.value) continue;
    const list = out[attr as (typeof SCOUT_FILTER_KEYS)[number]];
    if (!list.includes(r.value)) list.push(r.value);
  }
  return out;
}

/** マートの「値なし」の表し方（空・(未入力)・未設定・(未選択)）→ null */
const UNSET = new Set(['', '(未入力)', '未設定', '(未選択)']);
const text = (v: Row[string] | undefined): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return UNSET.has(t) ? null : t;
};
/** 数字だけの ID か（それ以外は、照会せずに「無い」として返す） */
const isId = (v: string): boolean => /^\d{1,15}$/.test(v.trim());

function parseStrings(json: Row[string] | undefined): string[] {
  if (typeof json !== 'string' || !json) return [];
  try {
    const arr: unknown = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return Array.from(new Set(arr.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter((x) => !UNSET.has(x)))).slice(0, 12);
  } catch {
    return [];
  }
}

/** マート cms_ai_jobs の 1 行 → 契約の型。行が無い・求人 ID が違うときは null */
export function toJobInfo(row: Row | undefined, jobId: string): ScoutJobInfo | null {
  if (!row || String(row.job_id ?? '') !== jobId.trim()) return null;
  const body = (v: Row[string] | undefined): string => (typeof v === 'string' ? v.slice(0, JOB_TEXT_CHARS).trim() : '');
  return {
    jobId: String(row.job_id),
    title: text(row.title) ?? '',
    occupation: text(row.occupation),
    industry: text(row.industry),
    location: text(row.location),
    salary: text(row.salary),
    japaneseLevel: text(row.japanese_level),
    englishLevel: text(row.english_level),
    published: row.published === true,
    description: body(row.description),
    requirements: body(row.requirements),
  };
}

const isYm = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v);

/**
 * マート dwh_restricted.cms_ai_member_resumes の 1 行 → 契約の型。
 * 行が無い・会員 ID が違う・本文が空（自己PR も、職務内容も無い）のときは null（属性だけで作る）。
 * マネジメント経験の年数は、元の列がコード値（0〜7）で意味を確かめられていないので、返さない（null）。
 * 転職回数は、元の列が「経験した会社の数」（職務経歴の数と一致。2026-11-27 実測）なので、1 を引く。
 */
export function toMemberResume(row: Row | undefined, memberId: string): ScoutMemberResume | null {
  if (!row || String(row.member_id ?? '') !== memberId.trim()) return null;
  const lang = row.lang === 'en' ? 'en' : row.lang === 'ja' ? 'ja' : null;
  if (!lang) return null;
  const appeal = typeof row.appeal === 'string' ? row.appeal.slice(0, RESUME_APPEAL_CHARS).trim() : '';
  const work: ScoutMemberWork[] = [];
  if (typeof row.work_json === 'string' && row.work_json) {
    try {
      const arr: unknown = JSON.parse(row.work_json);
      for (const x of Array.isArray(arr) ? (arr as Record<string, unknown>[]) : []) {
        if (!x || typeof x !== 'object') continue;
        const title = typeof x.title === 'string' && x.title.trim() ? x.title.trim().slice(0, 80) : null;
        const notes = typeof x.notes === 'string' ? x.notes.slice(0, RESUME_WORK_CHARS).trim() : '';
        if (!title && !notes) continue;
        work.push({ title, from: isYm(x.start_ym) ? x.start_ym : null, to: isYm(x.end_ym) ? x.end_ym : null, notes });
        if (work.length >= RESUME_WORK_MAX) break;
      }
    } catch {
      // 形が違うときは、職務経歴なしとして扱う
    }
  }
  if (!appeal && !work.some((w) => w.notes)) return null;
  const changes = row.job_change_times === null || row.job_change_times === undefined ? NaN : Number(row.job_change_times);
  return {
    lang,
    appeal,
    appealChars: Math.max(num(row.appeal_chars), appeal.length),
    work,
    workCount: Math.max(num(row.work_count), work.length),
    workChars: num(row.work_chars),
    managementYears: null,
    jobChanges: Number.isFinite(changes) && changes >= 1 && changes <= 60 ? Math.trunc(changes) - 1 : null,
  };
}

/** マート cms_ai_member_profiles の 1 行 → 契約の型（未入力は null。値は cms_ai_scout_sends の属性と同じ）。行が無いときは null。職務経歴・自己PR は別の表（resume） */
export function toMemberInfo(row: Row | undefined, memberId: string, resume: ScoutMemberResume | null = null): ScoutMemberInfo | null {
  if (!row || String(row.member_id ?? '') !== memberId.trim()) return null;
  return {
    memberId: String(row.member_id),
    ageGroup: text(row.age_group),
    nationality: text(row.nationality_category),
    japaneseLevel: text(row.japanese_level),
    englishLevel: text(row.english_level),
    residence: text(row.residence),
    occupation: text(row.occupation_group),
    lastIndustry: text(row.last_industry),
    careerLevel: text(row.career_level),
    experiencedOccupations: parseStrings(row.experienced_json),
    desiredOccupations: parseStrings(row.desired_json),
    incomeRange: text(row.income_range),
    desiredIncomeRange: text(row.desired_income_range),
    resume,
  };
}

class BqScoutDataSource implements ScoutDataSource {
  constructor(private readonly client: () => BqClient) {}

  async options(): Promise<ScoutOptionsResponse> {
    try {
      const res = await this.client().run(aiScoutOptionsQuery());
      return toOptions(res.rows);
    } catch (e) {
      logError('options（マートが無い・権限が無いときは、選択肢なしで返す）', e);
      return { ...EMPTY_OPTIONS };
    }
  }

  async benchmark(q: ScoutBenchmarkQuery): Promise<ScoutBenchmark | null> {
    try {
      const industry = q.industry.trim();
      const group = industryGroupOf(industry);
      // 対象範囲は 類似業界（業界のまとまり）→ 全業界 の順（まとまりに業界が 1 つだけのときは、類似業界 = その業界）
      const groupId = group?.id ?? '';
      const res = await this.client().run(aiScoutBenchmarkQuery({ companyId: q.companyId, industry, industryGroup: groupId, filters: q.filters, lang: q.lang }));
      return await toBenchmark(res.rows[0], { ...q, industry }, groupId);
    } catch (e) {
      logError('benchmark（マートが無い・権限が無いときは、分析なしで返す）', e);
      return null;
    }
  }

  async job(companyId: string, jobId: string): Promise<ScoutJobInfo | null> {
    // 企業と求人の両方で絞る（SQL の WHERE）。数字でない ID は照会しない
    if (!isId(companyId) || !isId(jobId)) return null;
    try {
      const res = await this.client().run(aiScoutJobQuery(companyId, jobId));
      return toJobInfo(res.rows[0], jobId);
    } catch (e) {
      logError('job（マートが無い・権限が無いときは、求人なしで返す）', e);
      return null;
    }
  }

  async member(memberId: string, lang: ScoutLang = 'ja'): Promise<ScoutMemberInfo | null> {
    if (!isId(memberId)) return null;
    try {
      const client = this.client();
      // 属性と、職務経歴・自己PR を並行して引く。レジュメの表を読めない（表が無い・権限が無い）ときは、属性だけで返す
      const [res, resume] = await Promise.all([client.run(aiScoutMemberQuery(memberId)), this.resume(client, memberId, lang)]);
      return toMemberInfo(res.rows[0], memberId, resume);
    } catch (e) {
      logError('member（マートが無い・権限が無いときは、候補者なしで返す）', e);
      return null;
    }
  }

  /** 職務経歴・自己PR（無い・読めないときは null。ログに出すのは理由だけで、本文は出さない） */
  private async resume(client: BqClient, memberId: string, lang: ScoutLang): Promise<ScoutMemberResume | null> {
    try {
      const res = await client.run(aiScoutMemberResumeQuery(memberId, lang));
      return toMemberResume(res.rows[0], memberId);
    } catch (e) {
      logError('member の resume（dwh_restricted.cms_ai_member_resumes が無い・権限が無いときは、属性だけで返す）', e);
      return null;
    }
  }

  async exportDrafts(rows: ScoutDraftExport[]): Promise<boolean> {
    if (rows.length === 0) return true;
    try {
      const client = this.client();
      // サンプルデータでは書かない
      if (client.mock) return false;
      for (let i = 0; i < rows.length; i += EXPORT_MAX_ROWS) {
        await client.run(aiScoutDraftsMergeQuery(rows.slice(i, i + EXPORT_MAX_ROWS)));
      }
      return true;
    } catch (e) {
      logError('exportDrafts（cms_ai_scout_drafts に書けない）', e);
      return false;
    }
  }

  async outcomes(draftIds: string[]): Promise<ScoutDraftOutcome[]> {
    const ids = Array.from(new Set(draftIds.filter(Boolean)));
    if (ids.length === 0) return [];
    try {
      const out: ScoutDraftOutcome[] = [];
      // 1 回の照会に渡す ID は 1,000 個まで
      for (let i = 0; i < ids.length; i += 1000) {
        const res = await this.client().run(aiScoutOutcomesQuery(ids.slice(i, i + 1000)));
        for (const r of res.rows) {
          if (typeof r.draft_id !== 'string') continue;
          out.push({ draftId: r.draft_id, matched: r.matched === true, sends: num(r.sends), replies: num(r.replies), hires: num(r.hires), firstSentOn: isYmd(r.first_sent_on) ? r.first_sent_on : null });
        }
      }
      return out;
    } catch (e) {
      logError('outcomes（照合結果を読めない）', e);
      return [];
    }
  }
}

/** Worker の環境から作る（BQ_MOCK=1 ならフィクスチャ。鍵が無いときは、呼んだ時点で「データなし」になる） */
export function makeScoutDataSource(env: Env): ScoutDataSource {
  let client: BqClient | null = null;
  return new BqScoutDataSource(() => (client ??= makeClient(env)));
}

/** クライアントを直接渡す版（テスト・手元の確認用） */
export function scoutDataSourceOf(client: BqClient): ScoutDataSource {
  return new BqScoutDataSource(() => client);
}
