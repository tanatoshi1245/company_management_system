import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../types';
import { asD1, type D1Like } from '../d1/db';
import { AuditRepo } from '../d1/auditRepo';
import { AppError } from '../lib/errors';
import { logEvent } from '../lib/log';
import { makeClient } from '../services/clients';
import { getRefreshMeta } from '../services/refreshMeta';
import { AI_HISTORY_FOR_SESSION, AI_RESULT_MAX_BYTES, AiFailureSchema, AiJobIdSchema } from '../../shared/ai/common';
import { ReportInputSchema } from '../../shared/ai/report';
import { AiJobsRepo, type AiJobRow } from './repo';
import { tokenMatches } from './token';
import { AI_SESSION_ACTOR, benchMinNOf, companyBrief, jsonBytes, parseAiResult } from './service';
import { collectReportData } from './report/collect';

/**
 * セッションが使う入口（/hook/ai の下。docs/AI機能.md）。Google ログインの外にあり、代わりにジョブごとの合言葉を確かめる。
 *   - 合言葉は Authorization: Bearer。D1 のハッシュと定数時間で比べ、期限と状態（running だけ）を確かめる
 *   - 違うときは一律 401（理由を返さない = ジョブの有無・状態を外から確かめられない）
 *   - 合言葉で読めるのは、そのジョブ 1 件の内容だけ。企業名は返さない
 */
export const aiHookRoutes = new Hono<AppEnv>();

const NO_STORE = { 'cache-control': 'private, no-store' } as const;
const unauthorized = (c: Ctx) => c.json({ error: 'unauthorized', code: 'unauthorized' }, 401, NO_STORE);

/** 誰が（ai-session）・どのジョブ・結果を 1 行で残す。合言葉・本文は出さない */
aiHookRoutes.use('*', async (c, next) => {
  const t0 = Date.now();
  await next();
  const m = /\/jobs\/([a-z0-9]{16,40})\/(context|result)$/.exec(new URL(c.req.url).pathname);
  logEvent('ai.hook', { reqId: c.get('requestId'), actor: AI_SESSION_ACTOR, method: c.req.method, jobId: m?.[1] ?? null, what: m?.[2] ?? null, status: c.res.status, ms: Date.now() - t0 });
});

/** 合言葉を確かめて、ジョブを返す。合わなければ null（呼ぶ側は一律 401） */
async function authorize(c: Ctx): Promise<{ db: D1Like; row: AiJobRow } | null> {
  const id = AiJobIdSchema.safeParse(c.req.param('jobId'));
  const presented = /^Bearer\s+([0-9a-f]{64})$/.exec(c.req.header('authorization') ?? '')?.[1] ?? '';
  if (!c.env.CMS_DB) return null;
  const db = asD1(c.env.CMS_DB);
  const row = id.success ? await new AiJobsRepo(db).get(id.data) : null;
  // ジョブが無いときも同じ比較をする（有無で時間が変わらないように）
  const ok = await tokenMatches(presented, row?.token_hash ?? null);
  if (!row || !ok || row.status !== 'running' || !row.token_expires_at || row.token_expires_at <= new Date().toISOString()) return null;
  return { db, row };
}

function parse(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** セッションが受け取る内容: 入力・企業の条件・（①は）集計済みの数値・過去の結果 */
aiHookRoutes.get('/jobs/:jobId/context', async (c) => {
  const auth = await authorize(c);
  if (!auth) return unauthorized(c);
  const { db, row } = auth;
  const companyId = String(row.company_id);
  const client = makeClient(c.env);
  const brief = await companyBrief(client, companyId, c.executionCtx);
  if (!brief) throw new AppError('notFound', 404, '企業が見つかりません');
  const input = parse(row.input_json);
  let data: unknown = null;
  if (row.kind === 'report') {
    const parsed = ReportInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError('badRequest', 400, '保存された入力を読めません');
    const refresh = await getRefreshMeta(client, new Date(), c.executionCtx);
    data = await collectReportData(client, companyId, parsed.data, refresh, { db, benchMinN: benchMinNOf(c.env) });
  }
  const past = await new AiJobsRepo(db).recentDone(companyId, row.kind, AI_HISTORY_FOR_SESSION, row.id);
  const body = {
    jobId: row.id,
    kind: row.kind,
    input,
    // 企業名は渡さない（ID・業界・企業種別だけ）
    company: { id: companyId, industry: brief.industry, companyType: brief.companyType, ...(data === null ? {} : { data }) },
    history: past.map((p) => ({ createdAt: p.created_at, input: parse(p.input_json), result: parse(p.edited_json) ?? parse(p.result_json) })),
    resultSchema: `src/shared/ai/${row.kind}.ts`,
  };
  return c.json(body, 200, NO_STORE);
});

/** セッションが結果（または失敗）を返す。成功・失敗の報告を受け取ったら合言葉は失効。形が違うときは 400（直して送り直せるよう、合言葉は残す） */
aiHookRoutes.post('/jobs/:jobId/result', async (c) => {
  const auth = await authorize(c);
  if (!auth) return unauthorized(c);
  const { db, row } = auth;
  const tooLarge = () => c.json({ error: `結果が大きすぎます（${Math.floor(AI_RESULT_MAX_BYTES / 1024)}KB まで）`, code: 'tooLarge' }, 413, NO_STORE);
  if (Number(c.req.header('content-length') ?? 0) > AI_RESULT_MAX_BYTES) return tooLarge();
  const text = await c.req.text();
  if (jsonBytes(text) > AI_RESULT_MAX_BYTES) return tooLarge();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return c.json({ error: 'JSON 本文が必要です', code: 'badRequest' }, 400, NO_STORE);
  }
  const at = new Date().toISOString();
  const repo = new AiJobsRepo(db);
  const audit = new AuditRepo(db);
  const failure = AiFailureSchema.safeParse(raw);
  if (failure.success) {
    await db.batch([repo.failStmt(row.id, failure.data.error, at), audit.insertStmt({ at, actor: AI_SESSION_ACTOR, action: 'update', entity: 'ai_jobs', entityId: row.id, companyId: row.company_id, before: { status: 'running' }, after: { status: 'failed', error: failure.data.error }, requestId: c.get('requestId') })]);
    return c.json({ ok: true, status: 'failed' }, 200, NO_STORE);
  }
  const parsed = parseAiResult(row.kind, raw);
  if (!parsed.ok) return c.json({ error: `結果の形が違います（${`src/shared/ai/${row.kind}.ts`}）。直して送り直してください`, code: 'badRequest', details: parsed.details }, 400, NO_STORE);
  await db.batch([repo.completeStmt(row.id, JSON.stringify(parsed.data), parsed.data.summary, at), audit.insertStmt({ at, actor: AI_SESSION_ACTOR, action: 'update', entity: 'ai_jobs', entityId: row.id, companyId: row.company_id, before: { status: 'running' }, after: { status: 'done' }, requestId: c.get('requestId') })]);
  return c.json({ ok: true, status: 'done' }, 200, NO_STORE);
});

/** ほかのパスは何も返さない */
aiHookRoutes.all('*', (c) => c.json({ error: 'not found', code: 'notFound' }, 404, NO_STORE));
