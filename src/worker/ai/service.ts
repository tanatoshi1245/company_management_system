import { z } from 'zod';
import type { Env } from '../env';
import { intVar, isMock } from '../env';
import type { Identity } from '../auth/middleware';
import { parseAllowList } from '../auth/allowlist';
import type { BqClient } from '../bq/client';
import type { D1Like } from '../d1/db';
import { AuditRepo } from '../d1/auditRepo';
import { AppError, type ErrorDetail } from '../lib/errors';
import { cacheGet, cacheKey, cachePut } from '../lib/cache';
import { logEvent } from '../lib/log';
import { getRefreshMeta } from '../services/refreshMeta';
import { MONTHS_IN_MART } from '../services/boardService';
import { loadJobs } from '../services/companyService';
import { companyMasterByIdQuery } from '../sql/companyDetail';
import { lastNMonths, monthOf } from '../../shared/calendar/periods';
import { AI_JOB_TTL_MIN, AI_RESULT_MAX_BYTES, AiKindSchema, type AiCreateResponse, type AiJobDetail, type AiJobSummary, type AiKind } from '../../shared/ai/common';
import { ReportInputSchema, ReportResultSchema, type ReportInput } from '../../shared/ai/report';
import { ScoutInputSchema, ScoutResultSchema, type ScoutInput } from '../../shared/ai/scout';
import { JobInputSchema, JobResultSchema, type JobInput } from '../../shared/ai/job';
import { findPii } from '../../shared/ai/pii';
import { buildAiFireText } from '../../shared/ai/fireText';
import { AiJobsRepo, type AiJobRow } from './repo';
import { aiFireConfigured, fireRoutine } from './fire';
import { hashToken, newJobId, newToken } from './token';
import { reportSample } from './report/sample';
import { scoutSample } from './scout/sample';
import { jobSample } from './job/sample';

/** AI 機能の本体（docs/AI機能.md）。ルート（routes.ts・hook.ts）から呼ぶ。Hono の Context には依存しない */

type WaitCtx = { waitUntil(p: Promise<unknown>): void };
export const EXPIRED_MESSAGE = '時間内に結果が返りませんでした（期限切れ）';
export const AI_SESSION_ACTOR = 'ai-session';

/** POST /api/companies/:id/ai/jobs の本文。input は kind ごとの型で読み直す */
export const AiCreateBodySchema = z.object({ kind: AiKindSchema, input: z.unknown() }).strict();

export type AiInput = { kind: 'report'; input: ReportInput } | { kind: 'scout'; input: ScoutInput } | { kind: 'job'; input: JobInput };

const issuesOf = (err: z.ZodError, prefix: string): ErrorDetail[] => err.issues.slice(0, 20).map((i) => ({ path: [prefix, ...i.path].filter((x) => x !== '').join('.') || '(root)', message: i.message }));

/** kind ごとの入力の検証（zod strict）。失敗は 400 と項目ごとの理由 */
export function parseAiInput(kind: AiKind, raw: unknown): AiInput {
  const r = kind === 'report' ? ReportInputSchema.safeParse(raw) : kind === 'scout' ? ScoutInputSchema.safeParse(raw) : JobInputSchema.safeParse(raw);
  if (!r.success) throw new AppError('badRequest', 400, '入力が不正です', issuesOf(r.error, 'input'));
  return { kind, input: r.data } as AiInput;
}

/** kind ごとの結果の検証（セッションが返す結果・画面で直した版）。失敗は details を返す */
export function parseAiResult(kind: AiKind, raw: unknown): { ok: true; data: { summary: string } & Record<string, unknown> } | { ok: false; details: ErrorDetail[] } {
  const r = kind === 'report' ? ReportResultSchema.safeParse(raw) : kind === 'scout' ? ScoutResultSchema.safeParse(raw) : JobResultSchema.safeParse(raw);
  return r.success ? { ok: true, data: r.data } : { ok: false, details: issuesOf(r.error, '') };
}

export const jsonBytes = (v: unknown): number => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v)).length;

/** 企業の条件（マスタ）。name / internalName は画面の表示と、入力の企業名の確認にだけ使う（セッションへは渡さない） */
export interface CompanyBrief {
  id: string;
  name: string;
  internalName: string | null;
  industry: string | null;
  companyType: string | null;
}

const BRIEF_TTL_SEC = 600;

/** 企業がマスタにあるか（URL の ID を信用しない）。画面のポーリングで毎回 BigQuery を読まないよう、10 分キャッシュする。無ければ null */
export async function companyBrief(client: BqClient, companyId: string, ctx?: WaitCtx): Promise<CompanyBrief | null> {
  const key = await cacheKey('ai-company-brief', { id: companyId, mock: client.mock });
  const hit = await cacheGet<CompanyBrief>(key);
  if (hit) return hit;
  const row = (await client.run(companyMasterByIdQuery(companyId))).rows[0];
  if (!row) return null;
  const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
  const brief: CompanyBrief = { id: companyId, name: String(row.company_name ?? row.internal_name ?? companyId), internalName: s(row.internal_name), industry: s(row.industry), companyType: s(row.company_type) };
  await cachePut(key, brief, BRIEF_TTL_SEC, ctx);
  return brief;
}

/** 管理者（セッションの URL を見られる人）= Google ログイン済みで AI_ADMIN_EMAILS に入っている人。モックの仮の利用者は管理者にしない */
export function isAiAdmin(env: Env, identity: Identity | null): boolean {
  if (!identity?.verified) return false;
  return parseAllowList(env.AI_ADMIN_EMAILS).emails.has(identity.email.toLowerCase());
}

function parse(s: string | null): unknown {
  if (s === null || s === '') return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** running のまま期限（token_expires_at）を過ぎたものは failed（期限切れ）として読む */
export function withExpiry(row: AiJobRow, now: Date): AiJobRow {
  if (row.status !== 'running' || !row.token_expires_at || row.token_expires_at > now.toISOString()) return row;
  return { ...row, status: 'failed', error: EXPIRED_MESSAGE, completed_at: row.token_expires_at, token_hash: null, token_expires_at: null };
}

export function toSummary(row: AiJobRow): AiJobSummary {
  return { id: row.id, kind: row.kind, companyId: String(row.company_id), status: row.status, title: row.title, summary: row.summary, error: row.error, createdBy: row.created_by, createdAt: row.created_at, completedAt: row.completed_at, edited: row.edited_json !== null, sample: row.sample === 1 };
}

export function toDetail(row: AiJobRow, companyName: string, admin: boolean): AiJobDetail {
  return { ...toSummary(row), input: parse(row.input_json), result: parse(row.result_json), editedResult: parse(row.edited_json), sessionUrl: admin ? row.session_url : null, companyName };
}

/** 一覧に出す 1 行の見出し */
export function titleOf(a: AiInput): string {
  const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n)}…` : s);
  if (a.kind === 'report') return `${a.input.from === a.input.to ? a.input.to : `${a.input.from}〜${a.input.to}`} の利用状況${a.input.account ? `（${a.input.account}）` : ''}`;
  if (a.kind === 'scout') return a.input.purpose === 'review' ? `添削: ${clip(a.input.subject)}` : `テンプレート: ${clip(a.input.positionName)}`;
  if (a.input.purpose === 'create') return `求人票: ${clip(a.input.positionName)}`;
  return `添削: ${clip(a.input.source === 'posted' ? a.input.positionName : a.input.title || a.input.positionName)}`;
}

/** サンプルデータのときに返す見本 */
export function sampleResultOf(a: AiInput): { summary: string } & Record<string, unknown> {
  return a.kind === 'report' ? reportSample(a.input) : a.kind === 'scout' ? scoutSample(a.input) : jobSample(a.input);
}

/** 入力の中の社名・個人情報（メールアドレス・電話番号・選んだ企業の名前）。あれば 400（保存しない） */
function assertNoPii(a: AiInput, brief: CompanyBrief): void {
  const names = [brief.name, brief.internalName];
  const details: ErrorDetail[] = [];
  for (const [field, value] of Object.entries(a.input as Record<string, unknown>)) {
    const texts = typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
    for (const t of texts) for (const f of findPii(t, names)) if (f.level === 'block') details.push({ path: `input.${field}`, message: f.message });
  }
  if (details.length) throw new AppError('badRequest', 400, '社名・個人情報が入っているため、保存できません。置き換えてからもう一度お試しください', details.slice(0, 20));
}

export interface AiDeps {
  env: Env;
  client: BqClient;
  /** D1（無ければ null） */
  db: D1Like | null;
  identity: Identity | null;
  requestId: string;
  /** Worker のオリジン（セッションが結果を返す先） */
  hookBase: string;
  now?: Date;
  ctx?: WaitCtx;
  fetchImpl?: typeof fetch;
}

/** kind ごとの、形の検証より後の確認（期間・求人の持ち主） */
async function assertInputForCompany(d: AiDeps, companyId: string, a: AiInput, now: Date): Promise<void> {
  if (a.kind === 'scout') return;
  const refresh = await getRefreshMeta(d.client, now, d.ctx);
  const months = lastNMonths(monthOf(refresh.dataVersion), MONTHS_IN_MART);
  if (a.kind === 'report') {
    const { from, to } = a.input;
    if (!months.includes(from) || !months.includes(to)) throw new AppError('badRequest', 400, '分析できるのは直近 13 か月と当月です', [{ path: 'input.from', message: `${from}〜${to} はマートの範囲外` }]);
    if (from > to) throw new AppError('badRequest', 400, '開始月は終了月以前にしてください', [{ path: 'input.from', message: `${from} > ${to}` }]);
    return;
  }
  // 掲載中の求人から選んだとき: その企業の求人であること（ほかの企業の求人を読ませない）
  if (a.input.purpose === 'review' && a.input.source === 'posted') {
    const jobs = await loadJobs(d.client, companyId, months[0]!, months[months.length - 1]!, null, null);
    if (!jobs.rows.some((j) => !j.direct && j.key === a.input.jobKey)) throw new AppError('badRequest', 400, '入力が不正です', [{ path: 'input.jobKey', message: 'この企業の求人ではありません' }]);
  }
}

/**
 * セッションを立ち上げる（queued / failed のジョブ）。合言葉を発行し、発火に成功したら running にする（監査ログと同じ batch）。
 * 失敗・設定なしのときは、ジョブはそのまま残る
 */
export async function launchAiJob(d: AiDeps, db: D1Like, row: AiJobRow, actor: string): Promise<{ fire: 'sent' | 'failed'; fireMessage: string | null }> {
  const now = d.now ?? new Date();
  if (!aiFireConfigured(d.env)) return { fire: 'failed', fireMessage: 'セッションを立ち上げる設定がありません。依頼は「未起動」で残っています（設定の後に、履歴から「もう一度立ち上げる」）' };
  const token = newToken();
  const at = now.toISOString();
  const expires = new Date(now.getTime() + AI_JOB_TTL_MIN * 60_000).toISOString();
  const repo = new AiJobsRepo(db);
  // 先に合言葉（ハッシュ）を保存してから発火する（立ち上がったセッションがすぐ context を読みに来ても通るように）
  await db.batch([
    repo.markFiredStmt(row.id, { sessionUrl: '', tokenHash: await hashToken(token), tokenExpiresAt: expires, at }),
    new AuditRepo(db).insertStmt({ at, actor, action: 'update', entity: 'ai_jobs', entityId: row.id, companyId: row.company_id, before: { status: row.status }, after: { status: 'running' }, requestId: d.requestId }),
  ]);
  const fired = await fireRoutine(d.env, buildAiFireText({ jobId: row.id, kind: row.kind, hookBase: d.hookBase, token, now }), d.fetchImpl);
  if (!fired.ok) {
    await db.batch([
      repo.revertFiredStmt(row.id, at),
      new AuditRepo(db).insertStmt({ at, actor, action: 'update', entity: 'ai_jobs', entityId: row.id, companyId: row.company_id, before: { status: 'running' }, after: { status: 'queued', fire: 'failed' }, requestId: d.requestId }),
    ]);
    logEvent('ai.fire', { reqId: d.requestId, actor, jobId: row.id, kind: row.kind, ok: false, status: fired.status });
    return { fire: 'failed', fireMessage: fired.message };
  }
  await repo.setSessionUrlStmt(row.id, fired.sessionUrl, at).run();
  logEvent('ai.fire', { reqId: d.requestId, actor, jobId: row.id, kind: row.kind, ok: true });
  return { fire: 'sent', fireMessage: null };
}

/**
 * 依頼を作る。
 *   サンプルデータ（BQ_MOCK=1）… セッションを立ち上げず、見本を done で返す。Google ログイン済みで D1 があれば保存し、
 *     モックの仮の利用者のときは保存せず、その場限りのジョブを返す（PR プレビューで画面を確かめられるように）
 *   それ以外 … Google ログイン済みの人だけ。D1 に保存（監査ログと同じ batch）→ 発火
 */
export async function createAiJob(d: AiDeps, companyId: string, body: z.infer<typeof AiCreateBodySchema>): Promise<AiCreateResponse> {
  const now = d.now ?? new Date();
  const mock = isMock(d.env);
  const verified = Boolean(d.identity?.verified);
  if (!mock && !verified) throw new AppError('readOnly', 403, '書き込みには Google ログインが必要です');
  const a = parseAiInput(body.kind, body.input);
  const brief = await companyBrief(d.client, companyId, d.ctx);
  if (!brief) throw new AppError('notFound', 404, '企業が見つかりません');
  assertNoPii(a, brief);
  await assertInputForCompany(d, companyId, a, now);

  const at = now.toISOString();
  const actor = (d.identity?.email ?? 'preview').toLowerCase();
  const admin = isAiAdmin(d.env, d.identity);
  const base: AiJobRow = { id: newJobId(now), kind: a.kind, company_id: Number(companyId), status: 'queued', title: titleOf(a), input_json: JSON.stringify(a.input), result_json: null, edited_json: null, summary: null, error: null, sample: 0, session_url: null, token_hash: null, token_expires_at: null, created_by: actor, created_at: at, updated_at: at, fired_at: null, completed_at: null, deleted_at: null };

  if (mock) {
    const result = sampleResultOf(a);
    const row: AiJobRow = { ...base, status: 'done', sample: 1, result_json: JSON.stringify(result), summary: result.summary, completed_at: at };
    if (verified && d.db) {
      await d.db.batch([
        new AiJobsRepo(d.db).insertStmt({ id: row.id, kind: row.kind, companyId, status: 'done', title: row.title, input_json: row.input_json, result_json: row.result_json, summary: row.summary, created_by: actor, sample: true, at }),
        new AuditRepo(d.db).insertStmt({ at, actor, action: 'create', entity: 'ai_jobs', entityId: row.id, companyId: Number(companyId), before: null, after: { kind: row.kind, title: row.title, status: 'done', sample: true }, requestId: d.requestId }),
      ]);
    }
    logEvent('ai.create', { reqId: d.requestId, actor, jobId: row.id, kind: row.kind, companyId, sample: true, saved: verified && Boolean(d.db) });
    return { job: toDetail(row, brief.name, admin), fire: 'sample', fireMessage: null };
  }

  if (!d.db) throw new AppError('storage', 503, '保存先（D1）が設定されていません。管理者に連絡してください');
  const repo = new AiJobsRepo(d.db);
  await d.db.batch([
    repo.insertStmt({ id: base.id, kind: base.kind, companyId, status: 'queued', title: base.title, input_json: base.input_json, result_json: null, summary: null, created_by: actor, sample: false, at }),
    new AuditRepo(d.db).insertStmt({ at, actor, action: 'create', entity: 'ai_jobs', entityId: base.id, companyId: Number(companyId), before: null, after: { kind: base.kind, title: base.title, status: 'queued', sample: false }, requestId: d.requestId }),
  ]);
  const launched = await launchAiJob({ ...d, now }, d.db, base, actor);
  logEvent('ai.create', { reqId: d.requestId, actor, jobId: base.id, kind: base.kind, companyId, sample: false, fire: launched.fire });
  const saved = (await repo.get(base.id)) ?? base;
  return { job: toDetail(saved, brief.name, admin), ...launched };
}

/** 1 件を読む。running で期限切れのものは failed にして返す（D1 も直す。監査ログと同じ batch） */
export async function readAiJob(db: D1Like, jobId: string, requestId: string, now: Date = new Date()): Promise<AiJobRow | null> {
  const repo = new AiJobsRepo(db);
  const row = await repo.get(jobId);
  if (!row) return null;
  const eff = withExpiry(row, now);
  if (eff !== row) {
    const at = now.toISOString();
    await db.batch([repo.failStmt(row.id, EXPIRED_MESSAGE, at), new AuditRepo(db).insertStmt({ at, actor: 'system', action: 'update', entity: 'ai_jobs', entityId: row.id, companyId: row.company_id, before: { status: 'running' }, after: { status: 'failed', error: EXPIRED_MESSAGE }, requestId })]);
    return (await repo.get(jobId)) ?? eff;
  }
  return row;
}

/** 結果（または画面で直した版）の大きさの確認。超えたら 413 */
export function assertResultSize(v: unknown): void {
  if (jsonBytes(v) > AI_RESULT_MAX_BYTES) throw new AppError('tooLarge', 413, `結果が大きすぎます（${Math.floor(AI_RESULT_MAX_BYTES / 1024)}KB まで）`);
}

export const benchMinNOf = (env: Env): number => intVar(env.BENCH_MIN_N, 5);
