import type { BqClient } from '../bq/client';
import { refreshLogQuery } from '../sql/refreshLog';
import { addDays, todayJst } from '../../shared/calendar/periods';
import { cacheGet, cacheKey, cachePut } from '../lib/cache';
import { DATA_VERSION } from '../../shared/schema/common';

export interface RefreshMeta {
  /** マートの版 = 最新の成功した run_date（YYYY-MM-DD）。キャッシュキーに入れる */
  dataVersion: string;
  /** イベントデータの最終日（run_date の前日） */
  dataDate: string;
  refreshedAt: string | null;
  refreshStatus: 'ok' | 'error' | 'unknown';
  lastError: string | null;
}

const META_TTL_SEC = 300;

/** cms_refresh_log から当日のマート更新状況を得る（300 秒キャッシュ）。ログが無ければ unknown（今日の日付を版にする） */
export async function getRefreshMeta(client: BqClient, now: Date = new Date(), ctx?: { waitUntil(p: Promise<unknown>): void }, refresh = false): Promise<RefreshMeta> {
  const today = todayJst(now);
  const key = await cacheKey('refresh-meta', { today, mock: client.mock, v: DATA_VERSION });
  if (!refresh) {
    const hit = await cacheGet<RefreshMeta>(key);
    if (hit) return hit;
  }
  const rows = (await client.run(refreshLogQuery(addDays(today, -14)))).rows;
  const ok = rows.find((r) => r.status === 'ok');
  const latest = rows[0];
  let meta: RefreshMeta;
  if (!ok) {
    meta = { dataVersion: today, dataDate: addDays(today, -1), refreshedAt: null, refreshStatus: latest ? 'error' : 'unknown', lastError: latest ? String(latest.note ?? '') : null };
  } else {
    const okDate = String(ok.run_date);
    const failedLater = latest && latest.status !== 'ok' && String(latest.run_date) > okDate;
    meta = { dataVersion: okDate, dataDate: addDays(okDate, -1), refreshedAt: ok.finished_at ? String(ok.finished_at) : null, refreshStatus: failedLater ? 'error' : 'ok', lastError: failedLater ? String(latest.note ?? '') : null };
  }
  await cachePut(key, meta, META_TTL_SEC, ctx);
  return meta;
}

/**
 * マート応答のキャッシュ TTL（秒）: 当日の更新が成功していれば次の 08:30 JST まで、そうでなければ 300 秒。
 * CACHE_TTL_SEC があればその値を上限にする
 */
export function martTtlSec(meta: RefreshMeta, now: Date = new Date(), capSec?: number): number {
  const today = todayJst(now);
  let ttl: number;
  if (meta.refreshStatus === 'ok' && meta.dataVersion === today) ttl = secondsUntilJst(now, 8, 30);
  else ttl = META_TTL_SEC;
  if (capSec && capSec > 0) ttl = Math.min(ttl, capSec);
  return Math.max(60, Math.floor(ttl));
}

/** 次の JST hh:mm までの秒数 */
export function secondsUntilJst(now: Date, hour: number, minute: number): number {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const target = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), hour, minute, 0));
  if (target.getTime() <= jst.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  return Math.round((target.getTime() - jst.getTime()) / 1000);
}
