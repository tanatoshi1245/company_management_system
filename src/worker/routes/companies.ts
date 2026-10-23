import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { intVar } from '../env';
import { makeClient } from '../services/clients';
import { getRefreshMeta } from '../services/refreshMeta';
import { getCompanyCore, mergeCompanyDetail } from '../services/companyService';
import { parseParam, parseQuery } from '../lib/validate';
import { AppError } from '../lib/errors';
import { CompanyIdSchema, MonthSchema } from '../../shared/schema/common';
import { addMonths, monthOf } from '../../shared/calendar/periods';
import { asD1 } from '../d1/db';
import { TargetsRepo } from '../d1/targetsRepo';
import { SettingsRepo } from '../d1/settingsRepo';
import { AppMetaRepo } from '../d1/appMetaRepo';
import type { CompanyDetailResponse } from '../../shared/schema/company';

export const companyRoutes = new Hono<AppEnv>();

const QuerySchema = z.object({ month: MonthSchema.optional(), refresh: z.enum(['0', '1']).optional() });

/** 企業詳細（マスタ・14 か月・日次・コホート・属性・ベンチマーク系列 + D1 の設定・目標）。存在しない ID は 404 */
companyRoutes.get('/companies/:id', async (c) => {
  const id = parseParam(c.req.param('id'), CompanyIdSchema);
  const q = parseQuery(c, QuerySchema);
  const now = new Date();
  const client = makeClient(c.env);
  const refresh = await getRefreshMeta(client, now, c.executionCtx, q.refresh === '1');
  const month = q.month ?? monthOf(refresh.dataVersion);
  const db = c.env.CMS_DB ? asD1(c.env.CMS_DB) : null;
  const epoch = db ? await new AppMetaRepo(db).cacheEpoch().catch(() => '1') : '1';
  let res;
  try {
    res = await getCompanyCore(client, id, month, refresh, epoch, { now, refresh: q.refresh === '1', capSec: intVar(c.env.CACHE_TTL_SEC, 0), ctx: c.executionCtx });
  } catch (e) {
    if (e instanceof Error && e.message.includes('outside the mart window')) throw new AppError('badRequest', 400, '表示できるのは直近 13 か月と当月です', [{ path: 'month', message: e.message }]);
    throw e;
  }
  if (!res.core) throw new AppError('notFound', 404, '企業が見つかりません');
  const [targets, settings] = db ? await Promise.all([new TargetsRepo(db).byCompany(id, addMonths(month, -13), addMonths(month, 3)), new SettingsRepo(db).get(id)]) : [[], null];
  const body: CompanyDetailResponse = mergeCompanyDetail(res.core, targets, settings, c.get('identity')?.email ?? null, intVar(c.env.BENCH_MIN_N, 5));
  body.meta.cached = res.hit;
  return c.json(body, 200, { 'x-cache': res.hit ? 'HIT' : 'MISS', 'cache-control': 'private, no-store' });
});
