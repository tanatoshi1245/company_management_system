import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Ctx } from '../types';
import { intVar, isMock } from '../env';
import { requireVerified } from '../auth/middleware';
import { parseJson, parseParam, parseQuery } from '../lib/validate';
import { AppError } from '../lib/errors';
import { logEvent } from '../lib/log';
import { asD1, type D1Like } from '../d1/db';
import { AuditRepo } from '../d1/auditRepo';
import { AppMetaRepo } from '../d1/appMetaRepo';
import { getRefreshMeta } from '../services/refreshMeta';
import { actorOf, clientOf, requireDb } from '../services/writeContext';
import { CompanyIdSchema } from '../../shared/schema/common';
import { AiJobIdSchema, AiKindSchema, type AiConfigResponse, type AiCreateResponse, type AiJobDetail, type AiJobListResponse } from '../../shared/ai/common';
import { AiJobsRepo, type AiJobRow } from './repo';
import { aiFireConfigured } from './fire';
import { aiCompanies, aiCompanyDefaults } from './defaults';
import { AiCreateBodySchema, assertResultSize, companyBrief, createAiJob, isAiAdmin, launchAiJob, parseAiResult, readAiJob, toDetail, toSummary, withExpiry, type AiDeps } from './service';

/** AI 機能の API（/api の下。docs/AI機能.md の表）。認証と同一オリジンの確認は index.ts で先頭に掛けてある */
export const aiRoutes = new Hono<AppEnv>();

const NO_STORE = { 'cache-control': 'private, no-store' } as const;
const dbOf = (c: Ctx): D1Like | null => (c.env.CMS_DB ? asD1(c.env.CMS_DB) : null);
const depsOf = (c: Ctx): AiDeps => ({ env: c.env, client: clientOf(c), db: dbOf(c), identity: c.get('identity'), requestId: c.get('requestId'), hookBase: new URL(c.req.url).origin, now: new Date(), ctx: c.executionCtx });

/** ジョブ 1 件（ID の形 → D1。無ければ 404）。企業はここで引いた行からだけ決める */
async function jobOf(c: Ctx, db: D1Like | null): Promise<AiJobRow> {
  const id = parseParam(c.req.param('jobId'), AiJobIdSchema);
  const row = db ? await readAiJob(db, id, c.get('requestId')) : null;
  if (!row) throw new AppError('notFound', 404, '依頼が見つかりません（削除された可能性があります）');
  return row;
}

async function detailOf(c: Ctx, row: AiJobRow): Promise<AiJobDetail> {
  const brief = await companyBrief(clientOf(c), String(row.company_id), c.executionCtx).catch(() => null);
  return toDetail(row, brief?.name ?? '', isAiAdmin(c.env, c.get('identity')));
}

/** 設定の有無（真偽値だけ。Secret の値・名前は出さない） */
aiRoutes.get('/ai/config', (c) => {
  const id = c.get('identity');
  const body: AiConfigResponse = { fireConfigured: aiFireConfigured(c.env), storeConfigured: Boolean(c.env.CMS_DB), sampleMode: isMock(c.env), canWrite: Boolean(id?.verified), admin: isAiAdmin(c.env, id) };
  return c.json(body, 200, NO_STORE);
});

/** 企業の選択肢（ボードに出ている企業だけ） */
aiRoutes.get('/ai/companies', async (c) => {
  const client = clientOf(c);
  const now = new Date();
  const refresh = await getRefreshMeta(client, now, c.executionCtx);
  const db = dbOf(c);
  const epoch = db ? await new AppMetaRepo(db).cacheEpoch().catch(() => '1') : '1';
  return c.json(await aiCompanies(client, refresh, epoch, { now, capSec: intVar(c.env.CACHE_TTL_SEC, 0), ctx: c.executionCtx }), 200, NO_STORE);
});

/** 企業を選んだときに自動で入れる値と、業界・職種の選択肢 */
aiRoutes.get('/ai/companies/:id/defaults', async (c) => {
  const id = parseParam(c.req.param('id'), CompanyIdSchema);
  const client = clientOf(c);
  const now = new Date();
  const brief = await companyBrief(client, id, c.executionCtx);
  if (!brief) throw new AppError('notFound', 404, '企業が見つかりません');
  const refresh = await getRefreshMeta(client, now, c.executionCtx);
  return c.json(await aiCompanyDefaults(client, brief, refresh, { now, capSec: intVar(c.env.CACHE_TTL_SEC, 0), ctx: c.executionCtx }), 200, NO_STORE);
});

const ListQuerySchema = z.object({ company: CompanyIdSchema, kind: AiKindSchema }).strict();

/** その企業・機能の履歴（新しい順・30 件まで。結果の本体は含めない）。D1 が無ければ空 */
aiRoutes.get('/ai/jobs', async (c) => {
  const q = parseQuery(c, ListQuerySchema);
  const db = dbOf(c);
  const now = new Date();
  const rows = db ? await new AiJobsRepo(db).listByCompany(q.company, q.kind) : [];
  const body: AiJobListResponse = { jobs: rows.map((r) => toSummary(withExpiry(r, now))) };
  return c.json(body, 200, NO_STORE);
});

/** 1 件の全体（入力・結果・直した版）。画面のポーリング先 */
aiRoutes.get('/ai/jobs/:jobId', async (c) => {
  const row = await jobOf(c, dbOf(c));
  return c.json(await detailOf(c, row), 200, NO_STORE);
});

/**
 * 依頼を作ってセッションを立ち上げる。企業は URL からだけ。
 * ここだけは requireVerified を付けない: サンプルデータ（BQ_MOCK=1。PR プレビュー・ローカル）では、仮の利用者でも
 * 見本の結果で画面を確かめられるようにするため（そのときは D1 に保存せず、セッションも立ち上げない）。
 * サンプルデータ以外では、createAiJob の先頭で Google ログイン済み（verified）を必ず確かめる。同一オリジンの確認は /api/* に掛かっている
 */
aiRoutes.post('/companies/:id/ai/jobs', async (c) => {
  const id = parseParam(c.req.param('id'), CompanyIdSchema);
  if (!isMock(c.env) && !c.get('identity')?.verified) throw new AppError('readOnly', 403, '書き込みには Google ログインが必要です');
  const body = await parseJson(c, AiCreateBodySchema);
  const res: AiCreateResponse = await createAiJob(depsOf(c), id, body);
  return c.json(res, 201, NO_STORE);
});

/** 未起動・失敗のジョブをもう一度立ち上げる */
aiRoutes.post('/ai/jobs/:jobId/fire', requireVerified, async (c) => {
  const db = requireDb(c);
  const actor = actorOf(c);
  const row = await jobOf(c, db);
  if (row.sample === 1) throw new AppError('conflict', 409, '見本の結果は、立ち上げ直せません');
  if (row.status !== 'queued' && row.status !== 'failed') throw new AppError('conflict', 409, row.status === 'running' ? 'すでに立ち上げ済みです（結果を待っています）' : 'すでに結果を受け取っています');
  const launched = await launchAiJob(depsOf(c), db, row, actor.email);
  const after = (await new AiJobsRepo(db).get(row.id)) ?? row;
  const res: AiCreateResponse = { job: await detailOf(c, after), ...launched };
  return c.json(res, 200, NO_STORE);
});

const EditedBodySchema = z.object({ result: z.unknown() }).strict();

/** 画面で直した版の保存（結果と同じ形で検証）。done のジョブだけ */
aiRoutes.put('/ai/jobs/:jobId/edited', requireVerified, async (c) => {
  const db = requireDb(c);
  const actor = actorOf(c);
  const row = await jobOf(c, db);
  if (row.status !== 'done') throw new AppError('conflict', 409, '結果を受け取ってから保存してください');
  const body = await parseJson(c, EditedBodySchema);
  const parsed = parseAiResult(row.kind, body.result);
  if (!parsed.ok) throw new AppError('badRequest', 400, '入力が不正です', parsed.details.map((d) => ({ path: d.path === '(root)' ? 'result' : `result.${d.path}`, message: d.message })));
  assertResultSize(parsed.data);
  const at = new Date().toISOString();
  await db.batch([
    new AiJobsRepo(db).setEditedStmt(row.id, JSON.stringify(parsed.data), at),
    new AuditRepo(db).insertStmt({ at, actor: actor.email, action: 'update', entity: 'ai_jobs', entityId: row.id, companyId: row.company_id, before: { edited: row.edited_json !== null }, after: { edited: true }, requestId: actor.requestId }),
  ]);
  logEvent('ai.edited', { reqId: actor.requestId, actor: actor.email, jobId: row.id, action: 'save' });
  return c.json(await detailOf(c, (await new AiJobsRepo(db).get(row.id)) ?? row), 200, NO_STORE);
});

/** 直した版の取り消し（元の結果に戻る） */
aiRoutes.delete('/ai/jobs/:jobId/edited', requireVerified, async (c) => {
  const db = requireDb(c);
  const actor = actorOf(c);
  const row = await jobOf(c, db);
  const at = new Date().toISOString();
  if (row.edited_json !== null) {
    await db.batch([
      new AiJobsRepo(db).setEditedStmt(row.id, null, at),
      new AuditRepo(db).insertStmt({ at, actor: actor.email, action: 'update', entity: 'ai_jobs', entityId: row.id, companyId: row.company_id, before: { edited: true }, after: { edited: false }, requestId: actor.requestId }),
    ]);
    logEvent('ai.edited', { reqId: actor.requestId, actor: actor.email, jobId: row.id, action: 'clear' });
  }
  return c.json(await detailOf(c, (await new AiJobsRepo(db).get(row.id)) ?? row), 200, NO_STORE);
});

/** 履歴から消す（D1 は deleted_at を立てる。合言葉も失効） */
aiRoutes.delete('/ai/jobs/:jobId', requireVerified, async (c) => {
  const db = requireDb(c);
  const actor = actorOf(c);
  const row = await jobOf(c, db);
  const at = new Date().toISOString();
  await db.batch([
    new AiJobsRepo(db).softDeleteStmt(row.id, at),
    new AuditRepo(db).insertStmt({ at, actor: actor.email, action: 'delete', entity: 'ai_jobs', entityId: row.id, companyId: row.company_id, before: { kind: row.kind, title: row.title, status: row.status }, after: null, requestId: actor.requestId }),
  ]);
  logEvent('ai.delete', { reqId: actor.requestId, actor: actor.email, jobId: row.id });
  return c.body(null, 204);
});
