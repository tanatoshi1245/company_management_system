import type { MiddlewareHandler } from 'hono';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 書き込み（POST / PUT / PATCH / DELETE）は同一オリジンからだけ受け付ける（CSRF 対策。Cookie は SameSite=Lax でもあるが多層にする）。
 *   - Sec-Fetch-Site が same-origin / none、または Origin ヘッダがリクエストのオリジンと一致すること
 *   - DELETE 以外は Content-Type: application/json であること（フォーム送信を弾く）
 * curl で試すときは `-H "Origin: <公開URL>" -H "Content-Type: application/json"` を付ける
 */
export const sameOriginGuard: MiddlewareHandler = async (c, next) => {
  if (!MUTATING.has(c.req.method)) return next();
  const origin = new URL(c.req.url).origin;
  const site = c.req.header('sec-fetch-site');
  const reqOrigin = c.req.header('origin');
  const sameSite = site === 'same-origin' || site === 'none';
  const sameOrigin = reqOrigin !== undefined && reqOrigin === origin;
  if (!sameSite && !sameOrigin) return c.json({ error: '同一オリジンからのリクエストだけ受け付けます', code: 'csrf' }, 403);
  if (c.req.method !== 'DELETE') {
    const ct = (c.req.header('content-type') ?? '').toLowerCase();
    if (!ct.startsWith('application/json')) return c.json({ error: 'Content-Type は application/json にしてください', code: 'csrf' }, 415);
  }
  return next();
};
