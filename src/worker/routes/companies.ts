import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { intVar } from '../env';
import { makeClient } from '../services/clients';
import { getRefreshMeta } from '../services/refreshMeta';
import { ACCOUNT_TYPES, getAttributes, getCompanyCore, getJobs, mergeCompanyDetail } from '../services/companyService';
import { parseParam, parseQuery } from '../lib/validate';
import { AppError } from '../lib/errors';
import { CompanyIdSchema, MonthSchema } from '../../shared/schema/common';
import { addMonths, lastNMonths, monthOf } from '../../shared/calendar/periods';
import { asD1 } from '../d1/db';
import { TargetsRepo } from '../d1/targetsRepo';
import { SettingsRepo } from '../d1/settingsRepo';
import { ScoutUnusedRepo } from '../d1/scoutUnusedRepo';
import { overlayScoutUnused } from '../services/scoutUnusedService';
import { AppMetaRepo } from '../d1/appMetaRepo';
import { JobKeySchema, type CompanyDetailResponse } from '../../shared/schema/company';
import { MONTHS_IN_MART } from '../services/boardService';

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
  const [targets, settings, unused] = db ? await Promise.all([new TargetsRepo(db).byCompany(id, addMonths(month, -13), addMonths(month, 3)), new SettingsRepo(db).get(id), new ScoutUnusedRepo(db).byCompanyIncludingDeleted(id)]) : [[], null, []];
  const body: CompanyDetailResponse = mergeCompanyDetail(res.core, targets, settings, c.get('identity')?.email ?? null, intVar(c.env.BENCH_MIN_N, 5));
  if (unused.length) body.scoutUnused = overlayScoutUnused(JSON.stringify(res.core.scoutUnused), unused);
  body.meta.cached = res.hit;
  return c.json(body, 200, { 'x-cache': res.hit ? 'HIT' : 'MISS', 'cache-control': 'private, no-store' });
});

const AttrQuerySchema = z.object({ from: MonthSchema, to: MonthSchema, account: z.enum(ACCOUNT_TYPES).optional(), job: JobKeySchema.optional(), refresh: z.enum(['0', '1']).optional() });

/** 期間の検証（窓内・from <= to）。属性・求人の API で共用 */
function assertPeriod(months: string[], from: string, to: string): void {
  if (!months.includes(from) || !months.includes(to)) throw new AppError('badRequest', 400, '表示できるのは直近 13 か月と当月です', [{ path: 'from', message: `${from}〜${to} はマートの範囲外` }]);
  if (from > to) throw new AppError('badRequest', 400, '開始月は終了月以前にしてください', [{ path: 'from', message: `${from} > ${to}` }]);
}

/** 会員属性の内訳（期間 from〜to・アカウント種別で集約）。企業ページの円グラフ用。期間は窓（直近 13 か月 + 当月）内、from <= to */
companyRoutes.get('/companies/:id/attributes', async (c) => {
  const id = parseParam(c.req.param('id'), CompanyIdSchema);
  const q = parseQuery(c, AttrQuerySchema);
  const now = new Date();
  const client = makeClient(c.env);
  const refresh = await getRefreshMeta(client, now, c.executionCtx, q.refresh === '1');
  assertPeriod(lastNMonths(monthOf(refresh.dataVersion), MONTHS_IN_MART), q.from, q.to);
  const db = c.env.CMS_DB ? asD1(c.env.CMS_DB) : null;
  const epoch = db ? await new AppMetaRepo(db).cacheEpoch().catch(() => '1') : '1';
  const res = await getAttributes(client, id, q.from, q.to, q.account ?? null, refresh, epoch, { now, refresh: q.refresh === '1', capSec: intVar(c.env.CACHE_TTL_SEC, 0), ctx: c.executionCtx, job: q.job ?? null });
  return c.json(res.body, 200, { 'x-cache': res.hit ? 'HIT' : 'MISS', 'cache-control': 'private, no-store' });
});

/** 求人単位の集計（期間・アカウント種別）。job を付けるとその求人の月次も返す。企業ページの求人の表・求人フィルタ用。マート表への権限が無ければ 502（code: bq） */
companyRoutes.get('/companies/:id/jobs', async (c) => {
  const id = parseParam(c.req.param('id'), CompanyIdSchema);
  const q = parseQuery(c, AttrQuerySchema);
  const now = new Date();
  const client = makeClient(c.env);
  const refresh = await getRefreshMeta(client, now, c.executionCtx, q.refresh === '1');
  assertPeriod(lastNMonths(monthOf(refresh.dataVersion), MONTHS_IN_MART), q.from, q.to);
  const db = c.env.CMS_DB ? asD1(c.env.CMS_DB) : null;
  const epoch = db ? await new AppMetaRepo(db).cacheEpoch().catch(() => '1') : '1';
  const res = await getJobs(client, id, q.from, q.to, q.account ?? null, q.job ?? null, refresh, epoch, { now, refresh: q.refresh === '1', capSec: intVar(c.env.CACHE_TTL_SEC, 0), ctx: c.executionCtx });
  return c.json(res.body, 200, { 'x-cache': res.hit ? 'HIT' : 'MISS', 'cache-control': 'private, no-store' });
});
