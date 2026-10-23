import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { intVar } from '../env';
import { makeClient } from '../services/clients';
import { getRefreshMeta } from '../services/refreshMeta';
import { getBoardCore, mergeBoard } from '../services/boardService';
import { parseQuery } from '../lib/validate';
import { AppError } from '../lib/errors';
import { MonthSchema } from '../../shared/schema/common';
import { monthOf } from '../../shared/calendar/periods';
import { asD1 } from '../d1/db';
import { TargetsRepo } from '../d1/targetsRepo';
import { SettingsRepo } from '../d1/settingsRepo';
import { AppMetaRepo } from '../d1/appMetaRepo';
import type { BoardResponse } from '../../shared/schema/board';

export const boardRoutes = new Hono<AppEnv>();

const QuerySchema = z.object({ month: MonthSchema.optional(), refresh: z.enum(['0', '1']).optional() });

/**
 * ボード（契約企業 × 選択月）。マート部分はキャッシュ（次の 08:30 JST まで）、D1 の目標・設定とログイン者の isMine はリクエストごとに合成。
 * スコア・ヒートマップ・ヘルスはブラウザ側（src/shared/metrics）で計算する
 */
boardRoutes.get('/board', async (c) => {
  const q = parseQuery(c, QuerySchema);
  const now = new Date();
  const client = makeClient(c.env);
  const refresh = await getRefreshMeta(client, now, c.executionCtx, q.refresh === '1');
  const month = q.month ?? monthOf(refresh.dataVersion);
  const db = c.env.CMS_DB ? asD1(c.env.CMS_DB) : null;
  const epoch = db ? await new AppMetaRepo(db).cacheEpoch().catch(() => '1') : '1';
  let coreRes;
  try {
    coreRes = await getBoardCore(client, month, refresh, epoch, { now, refresh: q.refresh === '1', capSec: intVar(c.env.CACHE_TTL_SEC, 0), ctx: c.executionCtx });
  } catch (e) {
    if (e instanceof Error && e.message.includes('outside the mart window')) throw new AppError('badRequest', 400, '表示できるのは直近 13 か月と当月です', [{ path: 'month', message: e.message }]);
    throw e;
  }
  const [targets, settings] = db ? await Promise.all([new TargetsRepo(db).byMonth(month), new SettingsRepo(db).all()]) : [new Map(), new Map()];
  const merged = mergeBoard(coreRes.core, targets, settings, c.get('identity')?.email ?? null, intVar(c.env.BENCH_MIN_N, 5));
  const body: BoardResponse = { meta: { ...merged.meta, cached: coreRes.hit }, companies: merged.companies, benchmarks: merged.benchmarks };
  return c.json(body, 200, { 'x-cache': coreRes.hit ? 'HIT' : 'MISS', 'cache-control': 'private, no-store' });
});
