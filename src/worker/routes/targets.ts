import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { requireVerified } from '../auth/middleware';
import { parseJson, parseParam, parseQuery } from '../lib/validate';
import { AppError } from '../lib/errors';
import { logEvent } from '../lib/log';
import { nowIso } from '../d1/db';
import { rowToRecord, rowToValues, TargetsRepo } from '../d1/targetsRepo';
import { AuditRepo } from '../d1/auditRepo';
import { PlanDefaultsRepo } from '../d1/planDefaultsRepo';
import { AppMetaRepo } from '../d1/appMetaRepo';
import { CompanyIdSchema, MonthSchema } from '../../shared/schema/common';
import { BulkDefaultsInputSchema, CopyTargetsInputSchema, hasAnyTarget, planDefaultsToTargets, TargetInputSchema, type AuditEntry, type CompanyTargetsResponse, type TargetRecord, type TargetsByMonthResponse } from '../../shared/schema/targets';
import { addMonths, monthOf, todayJst } from '../../shared/calendar/periods';
import { getRefreshMeta } from '../services/refreshMeta';
import { getBoardCore } from '../services/boardService';
import { actorOf, assertCompanyExists, clientOf, requireDb } from '../services/writeContext';

export const targetRoutes = new Hono<AppEnv>();

/** 月の範囲の既定: 当月の 13 か月前〜12 か月後 */
function defaultRange(now: Date): { from: string; to: string } {
  const cur = monthOf(todayJst(now));
  return { from: addMonths(cur, -13), to: addMonths(cur, 12) };
}

const RangeSchema = z.object({ from: MonthSchema.optional(), to: MonthSchema.optional() });
const HistorySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });
const ByMonthSchema = z.object({ month: MonthSchema });

/** 月の目標（全企業）: D1 だけを読む。企業名・実績はボード（/api/board）とブラウザ側で結合 */
targetRoutes.get('/targets', async (c) => {
  const q = parseQuery(c, ByMonthSchema);
  const db = c.env.CMS_DB ? requireDb(c) : null;
  const rows = db ? Array.from((await new TargetsRepo(db).byMonth(q.month)).values()).map(rowToRecord) : [];
  const body: TargetsByMonthResponse = { month: q.month, rows };
  return c.json(body, 200, { 'cache-control': 'private, no-store' });
});

/** 企業の目標（期間） */
targetRoutes.get('/companies/:id/targets', async (c) => {
  const id = parseParam(c.req.param('id'), CompanyIdSchema);
  const q = parseQuery(c, RangeSchema);
  const d = defaultRange(new Date());
  const from = q.from ?? d.from;
  const to = q.to ?? d.to;
  if (from > to) throw new AppError('badRequest', 400, '期間が不正です', [{ path: 'from', message: 'from は to 以前にしてください' }]);
  const db = c.env.CMS_DB ? requireDb(c) : null;
  const rows = db ? (await new TargetsRepo(db).byCompany(id, from, to)).map(rowToRecord) : [];
  const body: CompanyTargetsResponse = { companyId: id, from, to, rows };
  return c.json(body, 200, { 'cache-control': 'private, no-store' });
});

/** 変更履歴（監査ログ） */
targetRoutes.get('/companies/:id/targets/history', async (c) => {
  const id = parseParam(c.req.param('id'), CompanyIdSchema);
  const q = parseQuery(c, HistorySchema);
  const db = c.env.CMS_DB ? requireDb(c) : null;
  const rows: AuditEntry[] = db ? await new AuditRepo(db).byCompany(id, q.limit) : [];
  return c.json({ rows }, 200, { 'cache-control': 'private, no-store' });
});

/** 目標の登録・更新（更新 + 監査ログを 1 つの batch で） */
targetRoutes.put('/companies/:id/targets/:month', requireVerified, async (c) => {
  const id = parseParam(c.req.param('id'), CompanyIdSchema);
  const month = parseParam(c.req.param('month'), MonthSchema);
  const input = await parseJson(c, TargetInputSchema);
  const db = requireDb(c);
  const actor = actorOf(c);
  await assertCompanyExists(clientOf(c), id);
  const repo = new TargetsRepo(db);
  const audit = new AuditRepo(db);
  const before = await repo.get(id, month);
  const at = nowIso();
  const { note, ...values } = input;
  const after = { values, note };
  await db.batch([
    repo.upsertStmt(id, month, values, note, actor.email, at),
    audit.insertStmt({ at, actor: actor.email, action: before ? 'update' : 'create', entity: 'company_targets', entityId: `${id}/${month}`, companyId: Number(id), before: before ? { values: rowToValues(before), note: before.note } : null, after, requestId: actor.requestId }),
  ]);
  logEvent('targets.put', { reqId: actor.requestId, actor: actor.email, companyId: id, month, action: before ? 'update' : 'create' });
  const row = await repo.get(id, month);
  const body: TargetRecord = rowToRecord(row!);
  return c.json(body, before ? 200 : 201);
});

/** 目標の削除 */
targetRoutes.delete('/companies/:id/targets/:month', requireVerified, async (c) => {
  const id = parseParam(c.req.param('id'), CompanyIdSchema);
  const month = parseParam(c.req.param('month'), MonthSchema);
  const db = requireDb(c);
  const actor = actorOf(c);
  const repo = new TargetsRepo(db);
  const before = await repo.get(id, month);
  if (!before) throw new AppError('notFound', 404, 'この月の目標はありません');
  const at = nowIso();
  await db.batch([repo.deleteStmt(id, month), new AuditRepo(db).insertStmt({ at, actor: actor.email, action: 'delete', entity: 'company_targets', entityId: `${id}/${month}`, companyId: Number(id), before: { values: rowToValues(before), note: before.note }, after: null, requestId: actor.requestId })]);
  logEvent('targets.delete', { reqId: actor.requestId, actor: actor.email, companyId: id, month });
  return c.body(null, 204);
});

/** fromMonth の目標を、まだ目標の無い toMonths にだけ複製する */
targetRoutes.post('/companies/:id/targets/copy', requireVerified, async (c) => {
  const id = parseParam(c.req.param('id'), CompanyIdSchema);
  const input = await parseJson(c, CopyTargetsInputSchema);
  const db = requireDb(c);
  const actor = actorOf(c);
  await assertCompanyExists(clientOf(c), id);
  const repo = new TargetsRepo(db);
  const src = await repo.get(id, input.fromMonth);
  if (!src) throw new AppError('badRequest', 400, 'コピー元の月に目標がありません', [{ path: 'fromMonth', message: '目標なし' }]);
  const values = rowToValues(src);
  const at = nowIso();
  const audit = new AuditRepo(db);
  const created: string[] = [];
  const skipped: string[] = [];
  const stmts = [];
  for (const m of Array.from(new Set(input.toMonths))) {
    if (m === input.fromMonth || (await repo.get(id, m))) {
      skipped.push(m);
      continue;
    }
    created.push(m);
    stmts.push(repo.upsertStmt(id, m, values, src.note, actor.email, at));
    stmts.push(audit.insertStmt({ at, actor: actor.email, action: 'create', entity: 'company_targets', entityId: `${id}/${m}`, companyId: Number(id), before: null, after: { values, note: src.note, copiedFrom: input.fromMonth }, requestId: actor.requestId }));
  }
  if (stmts.length) await db.batch(stmts);
  logEvent('targets.copy', { reqId: actor.requestId, actor: actor.email, companyId: id, from: input.fromMonth, created: created.length, skipped: skipped.length });
  return c.json({ created, skipped });
});

/** プラン既定値で未設定の (企業, 月) を埋める。既に目標がある月は触らない */
targetRoutes.post('/targets/bulk-defaults', requireVerified, async (c) => {
  const input = await parseJson(c, BulkDefaultsInputSchema);
  const db = requireDb(c);
  const actor = actorOf(c);
  const client = clientOf(c);
  const now = new Date();
  const refresh = await getRefreshMeta(client, now, c.executionCtx);
  const epoch = await new AppMetaRepo(db).cacheEpoch().catch(() => '1');
  const { core } = await getBoardCore(client, monthOf(refresh.dataVersion), refresh, epoch, { now, ctx: c.executionCtx });
  const { plans } = await new PlanDefaultsRepo(db).all();
  const repo = new TargetsRepo(db);
  const audit = new AuditRepo(db);
  const months = Array.from(new Set(input.months));
  const existing = await repo.existing(months);
  const only = input.companyIds ? new Set(input.companyIds) : null;
  const at = nowIso();
  const stmts = [];
  let created = 0;
  let noPlan = 0;
  for (const co of core.companies) {
    if (only && !only.has(co.id)) continue;
    const def = co.plan ? plans[co.plan] : undefined;
    if (!def) {
      noPlan++;
      continue;
    }
    const values = planDefaultsToTargets(def);
    if (!hasAnyTarget(values)) continue;
    for (const m of months) {
      if (existing.has(`${co.id}|${m}`)) continue;
      created++;
      stmts.push(repo.upsertStmt(co.id, m, values, null, actor.email, at));
      stmts.push(audit.insertStmt({ at, actor: actor.email, action: 'create', entity: 'company_targets', entityId: `${co.id}/${m}`, companyId: Number(co.id), before: null, after: { values, note: null, fromPlan: co.plan }, requestId: actor.requestId }));
    }
  }
  // D1 の batch は大きすぎると失敗するので 100 文ずつ
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  logEvent('targets.bulkDefaults', { reqId: actor.requestId, actor: actor.email, months: months.length, created, noPlan });
  return c.json({ created, noPlan, months });
});
