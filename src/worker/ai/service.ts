import { z } from 'zod';
import type { Env } from '../env';
import type { Identity } from '../auth/middleware';
import { parseAllowList } from '../auth/allowlist';
import type { BqClient } from '../bq/client';
import type { D1Like } from '../d1/db';
import { AppError, type ErrorDetail } from '../lib/errors';
import { cacheGet, cacheKey, cachePut } from '../lib/cache';
import { companyMasterByIdQuery } from '../sql/companyDetail';
import { AI_JOB_TTL_MIN, AI_RESULT_MAX_BYTES, AiKindSchema, type AiJobDetail, type AiJobSummary, type AiKind } from '../../shared/ai/common';
import { ReportResultSchema } from '../../shared/ai/report';
import { ScoutResultSchema } from '../../shared/ai/scout';
import { JobResultSchema } from '../../shared/ai/job';
import { findPii } from '../../shared/ai/pii';
import type { AiJobRow } from './repo';

/** AI 機能で共通の部品（docs/AI機能.md）。機能ごとの本体は scout/service.ts。Hono の Context には依存しない */

export type WaitCtx = { waitUntil(p: Promise<unknown>): void };
export const EXPIRED_MESSAGE = '時間内に結果が返りませんでした（期限切れ）';

/** いま使える機能（② スカウトだけ。③ 求人・① 分析レポートは準備中 = 依頼を受け付けない） */
export const AI_FEATURES: Record<AiKind, boolean> = { scout: true, job: false, report: false };

/** POST /api/companies/:id/ai/jobs の本文。input は kind ごとの型で読み直す */
export const AiCreateBodySchema = z.object({ kind: AiKindSchema, input: z.unknown() }).strict();

export const issuesOf = (err: z.ZodError, prefix: string): ErrorDetail[] => err.issues.slice(0, 20).map((i) => ({ path: [prefix, ...i.path].filter((x) => x !== '').join('.') || '(root)', message: i.message }));

/** kind ごとの結果の検証（画面で直した版）。失敗は details を返す */
export function parseAiResult(kind: AiKind, raw: unknown): { ok: true; data: { summary: string } & Record<string, unknown> } | { ok: false; details: ErrorDetail[] } {
  const r = kind === 'report' ? ReportResultSchema.safeParse(raw) : kind === 'scout' ? ScoutResultSchema.safeParse(raw) : JobResultSchema.safeParse(raw);
  return r.success ? { ok: true, data: r.data } : { ok: false, details: issuesOf(r.error, '') };
}

export const jsonBytes = (v: unknown): number => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v)).length;

/** 企業の条件（マスタ）。name / internalName は画面の表示と、入力・出力の企業名の確認にだけ使う（Vertex AI へは渡さない） */
export interface CompanyBrief {
  id: string;
  name: string;
  internalName: string | null;
  industry: string | null;
  companyType: string | null;
}

const BRIEF_TTL_SEC = 600;

/** 企業がマスタにあるか（URL の ID を信用しない）。毎回 BigQuery を読まないよう、10 分キャッシュする。無ければ null */
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

/** 管理者（モデルの作り方を見て、検証・チューニングを実行できる人）= Google ログイン済みで AI_ADMIN_EMAILS に入っている人。モックの仮の利用者は管理者にしない */
export function isAiAdmin(env: Env, identity: Identity | null): boolean {
  if (!identity?.verified) return false;
  return parseAllowList(env.AI_ADMIN_EMAILS).emails.has(identity.email.toLowerCase());
}

export function parseJsonOrNull(s: string | null): unknown {
  if (s === null || s === '') return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * 以前のセッション方式で running のまま残った行は、failed（期限切れ）として読む（D1 は書き換えない）。
 * いまの方式（Worker がその場で作る）では、running の行はできない
 */
export function withExpiry(row: AiJobRow, now: Date): AiJobRow {
  if (row.status !== 'running' && row.status !== 'queued') return row;
  const limit = row.token_expires_at ?? new Date(new Date(row.created_at).getTime() + AI_JOB_TTL_MIN * 60_000).toISOString();
  if (limit > now.toISOString()) return row;
  return { ...row, status: 'failed', error: EXPIRED_MESSAGE, completed_at: limit };
}

export function toSummary(row: AiJobRow): AiJobSummary {
  return { id: row.id, kind: row.kind, companyId: String(row.company_id), status: row.status, title: row.title, summary: row.summary, error: row.error, createdBy: row.created_by, createdAt: row.created_at, completedAt: row.completed_at, edited: row.edited_json !== null, sample: row.sample === 1 };
}

/** sessionUrl は以前のセッション方式の項目（いまは常に null） */
export function toDetail(row: AiJobRow, companyName: string): AiJobDetail {
  return { ...toSummary(row), input: parseJsonOrNull(row.input_json), result: parseJsonOrNull(row.result_json), editedResult: parseJsonOrNull(row.edited_json), sessionUrl: null, companyName };
}

/** 文字列の中の社名・個人情報（メールアドレス・電話番号・選んだ企業の名前）。block のものだけを返す */
export function piiDetails(fields: Record<string, unknown>, brief: Pick<CompanyBrief, 'name' | 'internalName'>, prefix: string): ErrorDetail[] {
  const names = [brief.name, brief.internalName];
  const details: ErrorDetail[] = [];
  for (const [field, value] of Object.entries(fields)) {
    const texts = typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : value && typeof value === 'object' ? Object.values(value as Record<string, unknown>).flatMap((x) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string') : typeof x === 'string' ? [x] : [])) : [];
    for (const t of texts) for (const f of findPii(t, names)) if (f.level === 'block') details.push({ path: `${prefix}.${field}`, message: f.message });
  }
  return details.slice(0, 20);
}

export const PII_MESSAGE = '社名・個人情報が入っているため、保存できません。置き換えてからもう一度お試しください';

/** 結果（または画面で直した版）の大きさの確認。超えたら 413 */
export function assertResultSize(v: unknown): void {
  if (jsonBytes(v) > AI_RESULT_MAX_BYTES) throw new AppError('tooLarge', 413, `結果が大きすぎます（${Math.floor(AI_RESULT_MAX_BYTES / 1024)}KB まで）`);
}

/** 依頼の作成・更新で共通に渡すもの */
export interface AiDeps {
  env: Env;
  client: BqClient;
  /** D1（無ければ null） */
  db: D1Like | null;
  identity: Identity | null;
  requestId: string;
  now?: Date;
  ctx?: WaitCtx;
  /** Vertex AI の呼び出しの差し替え（テスト用。既定は lib/safeFetch.ts） */
  fetchImpl?: typeof fetch;
}
