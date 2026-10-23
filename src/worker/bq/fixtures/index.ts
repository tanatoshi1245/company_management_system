import type { BuiltQuery } from '../params';
import type { Row } from '../parseRows';
import { todayJst } from '../../../shared/calendar/periods';

export function paramValue(q: BuiltQuery, name: string): string | null {
  const v = q.params.find((x) => x.name === name)?.parameterValue.value;
  return v === undefined || v === null ? null : String(v);
}

/** cms_refresh_log: 今朝 07:52 JST に成功した 1 行 */
export function mockRefreshLog(now: Date = new Date()): Row[] {
  const run = todayJst(now);
  return [{ run_date: run, step: 'all', status: 'ok', started_at: `${run}T22:45:03Z`, finished_at: `${run}T22:52:10Z`, note: null }];
}

/** ラベル → フィクスチャ。マートを増やしたらここに足す（M1 以降） */
export function mockRows(q: BuiltQuery): Row[] {
  switch (q.label) {
    case 'refresh_log':
      return mockRefreshLog();
    default:
      return [];
  }
}
