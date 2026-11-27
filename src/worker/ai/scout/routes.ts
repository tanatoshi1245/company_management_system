import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Ctx } from '../../types';
import { isMock } from '../../env';
import { requireVerified } from '../../auth/middleware';
import { parseJson, parseParam } from '../../lib/validate';
import { AppError } from '../../lib/errors';
import { cacheGet, cacheKey, cachePut } from '../../lib/cache';
import { asD1, type D1Like } from '../../d1/db';
import { actorOf, clientOf, requireDb } from '../../services/writeContext';
import { AiJobIdSchema, type AiJobDetail } from '../../../shared/ai/common';
import { ScoutChoiceInputSchema, ScoutModelIdSchema, ScoutUsageInputSchema, type ScoutModelsResponse, type ScoutOptionsResponse, type ScoutTuneResponse } from '../../../shared/ai/scout';
import { AiJobsRepo, type AiJobRow } from '../repo';
import { companyBrief, isAiAdmin, toDetail } from '../service';
import { vertexConfigured } from '../vertex';
import { makeScoutDataSource } from './bqDataSource';
import { AI_CONFIG_MESSAGE, rollbackScoutModel, scoutModelsResponse, setScoutChoice, setScoutUsage, withScoutFeedback } from './service';
import { runScoutTuning } from './tuning';

/** ② スカウトのフィードバック・条件の選択肢・モデルの成績とチューニング（/api の下。ai/routes.ts から束ねる） */
export const scoutRoutes = new Hono<AppEnv>();

const NO_STORE = { 'cache-control': 'private, no-store' } as const;
const OPTIONS_TTL_SEC = 600;
const dbOf = (c: Ctx): D1Like | null => (c.env.CMS_DB ? asD1(c.env.CMS_DB) : null);

async function jobOf(c: Ctx, db: D1Like): Promise<AiJobRow> {
  const id = parseParam(c.req.param('jobId'), AiJobIdSchema);
  const row = await new AiJobsRepo(db).get(id);
  if (!row) throw new AppError('notFound', 404, '依頼が見つかりません（削除された可能性があります）');
  return row;
}

async function detailOf(c: Ctx, db: D1Like, jobId: string, fallback: AiJobRow): Promise<AiJobDetail> {
  const row = (await new AiJobsRepo(db).get(jobId)) ?? fallback;
  const brief = await companyBrief(clientOf(c), String(row.company_id), c.executionCtx).catch(() => null);
  return withScoutFeedback(db, row, toDetail(row, brief?.name ?? ''));
}

/** 管理者だけ（AI_ADMIN_EMAILS）。requireVerified の後で呼ぶ */
function requireAdmin(c: Ctx): void {
  if (!isAiAdmin(c.env, c.get('identity'))) throw new AppError('forbidden', 403, 'この操作は、管理者だけが実行できます');
}

/** どの案を選んだか（draftId = null は「どれも使わない」）。選び直せる */
scoutRoutes.put('/ai/jobs/:jobId/scout/choice', requireVerified, async (c) => {
  const db = requireDb(c);
  const actor = actorOf(c);
  const row = await jobOf(c, db);
  const body = await parseJson(c, ScoutChoiceInputSchema);
  await setScoutChoice({ db, client: clientOf(c), actor, ctx: c.executionCtx }, row, body);
  return c.json(await detailOf(c, db, row.id, row), 200, NO_STORE);
});

/** 選んだ案を、企業が使ったか */
scoutRoutes.put('/ai/jobs/:jobId/scout/usage', requireVerified, async (c) => {
  const db = requireDb(c);
  const actor = actorOf(c);
  const row = await jobOf(c, db);
  const body = await parseJson(c, ScoutUsageInputSchema);
  await setScoutUsage({ db, client: clientOf(c), actor, ctx: c.executionCtx }, row, body.usedState);
  return c.json(await detailOf(c, db, row.id, row), 200, NO_STORE);
});

/** 受け取る人の条件の選択肢（マートにある値。10 分キャッシュ） */
scoutRoutes.get('/ai/scout/options', async (c) => {
  const key = await cacheKey('ai-scout-options', { mock: isMock(c.env) });
  const hit = await cacheGet<ScoutOptionsResponse>(key);
  if (hit) return c.json(hit, 200, NO_STORE);
  const body: ScoutOptionsResponse = await makeScoutDataSource(c.env).options();
  // マートがまだ無い（dataDate = null）ときは、キャッシュしない
  if (body.dataDate !== null) await cachePut(key, body, OPTIONS_TTL_SEC, c.executionCtx);
  return c.json(body, 200, NO_STORE);
});

/** 3 つのモデルと、版ごとの成績。プレイブックと生成モデルの ID は、管理者にだけ返す */
scoutRoutes.get('/ai/scout/models', async (c) => {
  const body: ScoutModelsResponse = await scoutModelsResponse(c.env, dbOf(c), isAiAdmin(c.env, c.get('identity')));
  return c.json(body, 200, NO_STORE);
});

/** 管理者: 検証・アップデート・チューニングを、いま実行する（週次の cron と同じ処理） */
scoutRoutes.post('/ai/scout/tune', requireVerified, async (c) => {
  requireAdmin(c);
  const db = requireDb(c);
  const actor = actorOf(c);
  if (isMock(c.env)) throw new AppError('conflict', 409, 'サンプルデータの表示中は、実行できません');
  if (!vertexConfigured(c.env)) throw new AppError('aiConfig', 503, AI_CONFIG_MESSAGE);
  const body: ScoutTuneResponse = await runScoutTuning({ env: c.env, db, ds: makeScoutDataSource(c.env), ranBy: actor.email, requestId: actor.requestId });
  return c.json(body, 200, NO_STORE);
});

const RollbackBodySchema = z.object({ version: z.number().int().min(1).max(100_000) }).strict();

/** 管理者: 指定の版の作り方へ戻す（その版のプレイブックを写した、新しい版を作って有効にする） */
scoutRoutes.post('/ai/scout/models/:id/rollback', requireVerified, async (c) => {
  requireAdmin(c);
  const db = requireDb(c);
  const actor = actorOf(c);
  const modelId = parseParam(c.req.param('id'), ScoutModelIdSchema);
  const body = await parseJson(c, RollbackBodySchema);
  await rollbackScoutModel(db, modelId, body.version, actor);
  const res: ScoutModelsResponse = await scoutModelsResponse(c.env, db, true);
  return c.json(res, 200, NO_STORE);
});
