import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { intVar, isMock } from '../env';
import { makeClient } from '../services/clients';
import { getRefreshMeta } from '../services/refreshMeta';
import { monthOf, todayJst } from '../../shared/calendar/periods';
import { HOLIDAYS_VERSION, monthProgress } from '../../shared/calendar/businessDays';
import { DATA_VERSION } from '../../shared/schema/common';
import type { MetaResponse } from '../../shared/schema/me';
import { CAVEATS } from '../../shared/caveats';

export const metaRoutes = new Hono<AppEnv>();

/** データの鮮度（マート更新日・イベント最終日）、当月の営業日、注記。300 秒キャッシュ（?refresh=1 で取り直し） */
metaRoutes.get('/meta', async (c) => {
  const now = new Date();
  const meta = await getRefreshMeta(makeClient(c.env), now, c.executionCtx, c.req.query('refresh') === '1');
  const today = todayJst(now);
  const month = monthOf(today);
  const body: MetaResponse = {
    dataVersion: meta.dataVersion,
    dataDate: meta.dataDate,
    refreshedAt: meta.refreshedAt,
    refreshStatus: meta.refreshStatus,
    asOf: today,
    month,
    bizDays: monthProgress(month, meta.dataDate < `${month}-01` ? `${month}-01` : meta.dataDate),
    ownerSource: c.env.OWNER_SOURCE?.trim() || 'sales_staff',
    scoutLimitPeriodDefault: 'month',
    benchMinN: intVar(c.env.BENCH_MIN_N, 5),
    login: { availableFrom: '2026-05-15' },
    caveats: [...CAVEATS],
    holidaysVersion: HOLIDAYS_VERSION,
    dataSchemaVersion: DATA_VERSION,
    mock: isMock(c.env),
  };
  return c.json(body);
});
