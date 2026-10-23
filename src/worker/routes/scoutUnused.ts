import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { requireVerified } from '../auth/middleware';
import { parseJson, parseParam, parseQuery } from '../lib/validate';
import { AppError } from '../lib/errors';
import { logEvent } from '../lib/log';
import { nowIso } from '../d1/db';
import { ScoutUnusedRepo, scoutUnusedToEntry } from '../d1/scoutUnusedRepo';
import { AuditRepo } from '../d1/auditRepo';
import { CompanyIdSchema, MonthSchema } from '../../shared/schema/common';
import { ScoutUnusedInputSchema, type ScoutUnusedMonthResponse, type ScoutUnusedSaveResponse, type ScoutUnusedSyncResponse } from '../../shared/schema/scoutUnused';
import { lastNMonths, monthOf } from '../../shared/calendar/periods';
import { getRefreshMeta } from '../services/refreshMeta';
import { MONTHS_IN_MART } from '../services/boardService';
import { parseScoutUnused } from '../services/companyService';
import { syncOne } from '../services/scoutUnusedService';
import { companyMasterByIdQuery } from '../sql/companyDetail';
import { scoutUnusedByMonthQuery } from '../sql/scoutUnused';
import { actorOf, clientOf, requireDb } from '../services/writeContext';
import type { BqClient } from '../bq/client';

export const scoutUnusedRoutes = new Hono<AppEnv>();

const MonthQuerySchema = z.object({ month: MonthSchema });

/** 月がマートの窓（直近 13 か月 + 当月）に入っているか */
async function assertMonthInWindow(client: BqClient, month: string, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
  const refresh = await getRefreshMeta(client, new Date(), ctx);
  const months = lastNMonths(monthOf(refresh.dataVersion), MONTHS_IN_MART);
  if (!months.includes(month)) throw new AppError('badRequest', 400, '登録できるのは直近 13 か月と当月です', [{ path: 'month', message: `${month} はマートの範囲外` }]);
}

/** 企業名と CS 担当（BQ への表示用列）。無ければ 404 */
async function displayOf(client: BqClient, companyId: string): Promise<{ companyName: string | null; salesRep: string | null }> {
  const row = (await client.run(companyMasterByIdQuery(companyId))).rows[0];
  if (!row) throw new AppError('notFound', 404, '企業が見つかりません');
  return { companyName: row.company_name === null || row.company_name === undefined ? null : String(row.company_name), salesRep: row.cs_owner_name_default === null || row.cs_owner_name_default === undefined ? null : String(row.cs_owner_name_default) };
}

/** その月の登録（D1）と、シート取込にあるその月の記録（マート） */
scoutUnusedRoutes.get('/scout-unused', async (c) => {
  const q = parseQuery(c, MonthQuerySchema);
  const client = clientOf(c);
  const db = c.env.CMS_DB ? requireDb(c) : null;
  const [rows, sheet] = await Promise.all([db ? new ScoutUnusedRepo(db).byMonth(q.month) : Promise.resolve([]), client.run(scoutUnusedByMonthQuery(q.month))]);
  const body: ScoutUnusedMonthResponse = {
    month: q.month,
    entries: rows.map(scoutUnusedToEntry),
    sheet: sheet.rows.flatMap((r) => {
      const hit = parseScoutUnused(r.scout_unused_json).find((x) => x.month === q.month && x.source === 'sheet');
      return hit ? [{ companyId: String(r.company_id), reason: hit.reason, remarks: hit.remarks }] : [];
    }),
  };
  return c.json(body, 200, { 'cache-control': 'private, no-store' });
});

/** 登録・更新。D1（監査ログと同じ batch）→ BigQuery MERGE（失敗しても D1 は残り、未反映として再同期できる） */
scoutUnusedRoutes.put('/scout-unused/:companyId/:month', requireVerified, async (c) => {
  const id = parseParam(c.req.param('companyId'), CompanyIdSchema);
  const month = parseParam(c.req.param('month'), MonthSchema);
  const input = await parseJson(c, ScoutUnusedInputSchema);
  if (input.reason === null && input.remarks === null) throw new AppError('badRequest', 400, '入力が不正です', [{ path: 'reason', message: '理由か補足のどちらかを入力してください' }]);
  const db = requireDb(c);
  const actor = actorOf(c);
  const client = clientOf(c);
  await assertMonthInWindow(client, month, c.executionCtx);
  const display = await displayOf(client, id);
  const repo = new ScoutUnusedRepo(db);
  const before = await repo.get(id, month);
  const at = nowIso();
  const audit = new AuditRepo(db);
  const beforeJson = before && before.deleted_at === null ? { reason: before.reason, remarks: before.remarks } : null;
  await db.batch([repo.upsertStmt(id, month, input, actor.email, at), audit.insertStmt({ at, actor: actor.email, action: beforeJson ? 'update' : 'create', entity: 'scout_unused_entries', entityId: `${id}:${month}`, companyId: Number(id), before: beforeJson, after: input, requestId: actor.requestId })]);
  const row = (await repo.get(id, month))!;
  const bq = await syncOne(client, db, row, display);
  logEvent('scout_unused.put', { reqId: actor.requestId, actor: actor.email, companyId: id, month, action: beforeJson ? 'update' : 'create', bqSynced: bq.synced });
  const body: ScoutUnusedSaveResponse = { entry: scoutUnusedToEntry((await repo.get(id, month))!), bq };
  return c.json(body, beforeJson ? 200 : 201);
});

/** 削除（D1 は deleted_at を立て、BQ は deleted = TRUE に） */
scoutUnusedRoutes.delete('/scout-unused/:companyId/:month', requireVerified, async (c) => {
  const id = parseParam(c.req.param('companyId'), CompanyIdSchema);
  const month = parseParam(c.req.param('month'), MonthSchema);
  const db = requireDb(c);
  const actor = actorOf(c);
  const client = clientOf(c);
  const repo = new ScoutUnusedRepo(db);
  const before = await repo.get(id, month);
  if (!before || before.deleted_at !== null) throw new AppError('notFound', 404, '登録がありません');
  const at = nowIso();
  const audit = new AuditRepo(db);
  await db.batch([repo.softDeleteStmt(id, month, actor.email, at), audit.insertStmt({ at, actor: actor.email, action: 'delete', entity: 'scout_unused_entries', entityId: `${id}:${month}`, companyId: Number(id), before: { reason: before.reason, remarks: before.remarks }, after: null, requestId: actor.requestId })]);
  const display = await displayOf(client, id).catch(() => ({ companyName: null, salesRep: null }));
  const bq = await syncOne(client, db, (await repo.get(id, month))!, display);
  logEvent('scout_unused.delete', { reqId: actor.requestId, actor: actor.email, companyId: id, month, bqSynced: bq.synced });
  const body: ScoutUnusedSaveResponse = { entry: null, bq };
  return c.json(body, 200);
});

/** BQ 未反映の行をまとめて再同期（最大 200 件） */
scoutUnusedRoutes.post('/scout-unused/sync', requireVerified, async (c) => {
  const db = requireDb(c);
  const actor = actorOf(c);
  const client = clientOf(c);
  const repo = new ScoutUnusedRepo(db);
  const rows = await repo.unsynced(200);
  let synced = 0;
  let failed = 0;
  for (const row of rows) {
    const display = await displayOf(client, String(row.company_id)).catch(() => ({ companyName: null, salesRep: null }));
    const r = await syncOne(client, db, row, display);
    if (r.synced) synced += 1;
    else failed += 1;
  }
  const pending = await repo.countUnsynced();
  logEvent('scout_unused.sync', { reqId: actor.requestId, actor: actor.email, synced, failed, pending });
  const body: ScoutUnusedSyncResponse = { synced, failed, pending };
  return c.json(body, 200);
});
