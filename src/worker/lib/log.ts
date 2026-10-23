import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

/** 1 リクエスト 1 行の JSON ログ（誰が・いつ・何を・結果）。本文や Secret は出さない。Workers Logs で検索する */
export const requestLog: MiddlewareHandler<AppEnv> = async (c, next) => {
  const t0 = Date.now();
  await next();
  // 所要時間（Server-Timing。ブラウザの DevTools で見える。README の性能予算の計測に使う）
  c.res.headers.set('server-timing', `total;dur=${Date.now() - t0}`);
  logEvent('request', {
    reqId: c.get('requestId'),
    actor: c.get('identity')?.email ?? null,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status: c.res.status,
    ms: Date.now() - t0,
    cache: c.res.headers.get('x-cache'),
  });
};

export function logEvent(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields }));
}
