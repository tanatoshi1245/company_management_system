import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { requireVerified } from '../auth/middleware';
import { parseJson, parseParam, parseQuery } from '../lib/validate';
import { AppError } from '../lib/errors';
import { logEvent } from '../lib/log';
import { nowIso } from '../d1/db';
import { SettingsRepo, settingsToRecord } from '../d1/settingsRepo';
import { AuditRepo } from '../d1/auditRepo';
import { PlanDefaultsRepo } from '../d1/planDefaultsRepo';
import { CompanyIdSchema } from '../../shared/schema/common';
import { SettingsInputSchema } from '../../shared/schema/settings';
import { PlanDefaultsInputSchema, type PlanDefaultsResponse } from '../../shared/schema/targets';
import { isEmailAllowed, parseAllowList } from '../auth/allowlist';
import { actorOf, assertCompanyExists, clientOf, requireDb } from '../services/writeContext';

export const settingsRoutes = new Hono<AppEnv>();

const ListSchema = z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) });

/** 担当上書き・枠の上書きがある企業の一覧 */
settingsRoutes.get('/settings/overrides', async (c) => {
  const q = parseQuery(c, ListSchema);
  const db = c.env.CMS_DB ? requireDb(c) : null;
  const rows = db ? (await new SettingsRepo(db).list(q.limit)).map(settingsToRecord) : [];
  return c.json({ rows }, 200, { 'cache-control': 'private, no-store' });
});

settingsRoutes.get('/companies/:id/settings', async (c) => {
  const id = parseParam(c.req.param('id'), CompanyIdSchema);
  const db = c.env.CMS_DB ? requireDb(c) : null;
  const row = db ? await new SettingsRepo(db).get(id) : null;
  return c.json({ companyId: id, settings: row ? settingsToRecord(row) : null }, 200, { 'cache-control': 'private, no-store' });
});

/** 企業設定の登録・更新。担当メールは許可リスト（@daijob.com）内だけ */
settingsRoutes.put('/companies/:id/settings', requireVerified, async (c) => {
  const id = parseParam(c.req.param('id'), CompanyIdSchema);
  const input = await parseJson(c, SettingsInputSchema);
  if (input.csOwnerEmail && !isEmailAllowed(input.csOwnerEmail, parseAllowList(c.env.ALLOWED_EMAILS, c.env.ALLOWED_EMAIL_DOMAINS))) {
    throw new AppError('badRequest', 400, '入力が不正です', [{ path: 'csOwnerEmail', message: '許可されたドメインのメールアドレスを指定してください' }]);
  }
  const db = requireDb(c);
  const actor = actorOf(c);
  await assertCompanyExists(clientOf(c), id);
  const repo = new SettingsRepo(db);
  const before = await repo.get(id);
  const at = nowIso();
  const isEmpty = !input.csOwnerEmail && !input.csOwnerName && input.scoutLimitPeriod === 'month' && input.scoutLimitOverride === null && input.jobLimitOverride === null && !input.memo;
  const audit = new AuditRepo(db);
  const beforeJson = before ? settingsToRecord(before) : null;
  if (isEmpty) {
    if (before) await db.batch([repo.deleteStmt(id), audit.insertStmt({ at, actor: actor.email, action: 'delete', entity: 'company_settings', entityId: id, companyId: Number(id), before: beforeJson, after: null, requestId: actor.requestId })]);
    logEvent('settings.put', { reqId: actor.requestId, actor: actor.email, companyId: id, action: 'delete' });
    return c.json({ companyId: id, settings: null });
  }
  await db.batch([repo.upsertStmt(id, input, actor.email, at), audit.insertStmt({ at, actor: actor.email, action: before ? 'update' : 'create', entity: 'company_settings', entityId: id, companyId: Number(id), before: beforeJson, after: input, requestId: actor.requestId })]);
  logEvent('settings.put', { reqId: actor.requestId, actor: actor.email, companyId: id, action: before ? 'update' : 'create' });
  const row = await repo.get(id);
  return c.json({ companyId: id, settings: row ? settingsToRecord(row) : null }, before ? 200 : 201);
});

settingsRoutes.get('/settings/plan-defaults', async (c) => {
  const db = c.env.CMS_DB ? requireDb(c) : null;
  const body: PlanDefaultsResponse = db ? await new PlanDefaultsRepo(db).all() : { plans: {}, updatedAt: null };
  return c.json(body, 200, { 'cache-control': 'private, no-store' });
});

/** プラン既定値を置き換える（指標ごとの null は削除） */
settingsRoutes.put('/settings/plan-defaults', requireVerified, async (c) => {
  const input = await parseJson(c, PlanDefaultsInputSchema);
  const db = requireDb(c);
  const actor = actorOf(c);
  const repo = new PlanDefaultsRepo(db);
  const before = await repo.byPlan(input.plan);
  const at = nowIso();
  await db.batch([...repo.replaceStmts(input.plan, input.values, actor.email, at), new AuditRepo(db).insertStmt({ at, actor: actor.email, action: Object.keys(before).length ? 'update' : 'create', entity: 'plan_target_defaults', entityId: input.plan, companyId: null, before: Object.keys(before).length ? before : null, after: input.values, requestId: actor.requestId })]);
  logEvent('planDefaults.put', { reqId: actor.requestId, actor: actor.email, plan: input.plan });
  const body: PlanDefaultsResponse = await repo.all();
  return c.json(body);
});
