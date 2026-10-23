import type { MiddlewareHandler, Next } from 'hono';
import type { Env } from '../env';
import { isMock } from '../env';
import type { AppEnv, AuthMode, Ctx } from '../types';
import { isEmailAllowed, notAllowedMessage, parseAllowList } from './allowlist';
import { DEFAULT_SESSION_TTL_SEC, parseCookies, SESSION_COOKIE, verifyPayload, type GoogleConfig, type SessionPayload } from './google';

/** ログインした人。verified = Google ログインで確かめた（モックの仮の利用者は false で、書き込み不可） */
export interface Identity {
  email: string;
  sub: string;
  name?: string;
  verified: boolean;
}

export const MOCK_EMAIL = 'preview@daijob.com';

/** Worker 内蔵の Google ログインの設定。GOOGLE_CLIENT_ID があればこの方式。足りない Secret があれば missing に名前 */
export function googleConfig(env: Env): { cfg: GoogleConfig | null; missing: string[] } {
  if (!env.GOOGLE_CLIENT_ID?.trim()) return { cfg: null, missing: [] };
  const missing = (['GOOGLE_CLIENT_SECRET', 'SESSION_SECRET'] as const).filter((k) => !env[k]?.trim());
  if (missing.length) return { cfg: null, missing };
  const ttl = Math.max(600, Number(env.SESSION_TTL_SEC ?? DEFAULT_SESSION_TTL_SEC) || DEFAULT_SESSION_TTL_SEC);
  return { cfg: { clientId: env.GOOGLE_CLIENT_ID.trim(), clientSecret: env.GOOGLE_CLIENT_SECRET!.trim(), sessionSecret: env.SESSION_SECRET!.trim(), sessionTtlSec: ttl }, missing: [] };
}

export function authModeOf(env: Env): AuthMode {
  if (env.GOOGLE_CLIENT_ID?.trim()) return 'google';
  if (isMock(env)) return 'mock';
  return 'none';
}

/**
 * 認証（すべてのパスに先頭で掛ける。セキュリティ要件 §2.2）
 *   google … GOOGLE_CLIENT_ID があるとき（本番の既定）: セッション Cookie を検証し、無ければ画面は /auth/login へ、API は 401
 *   mock   … BQ_MOCK=1 で Google 未設定のとき（ローカル開発・PR プレビュー）: 仮の利用者（DEV_USER_EMAIL）で閲覧のみ
 *   none   … どちらでもない: fail-closed。すべて 503（「URL を知っていれば誰でも」にはしない）
 * いずれもメールを許可リスト（ALLOWED_EMAIL_DOMAINS / ALLOWED_EMAILS）で確かめ、外れていれば 403。
 */
export async function authenticate(c: Ctx, next: Next): Promise<Response | void> {
  c.set('identity', null);
  c.set('requestId', c.req.header('cf-ray') ?? crypto.randomUUID());
  const mode = authModeOf(c.env);
  c.set('authMode', mode);
  if (c.req.path.startsWith('/auth/')) return next();

  const isApi = c.req.path.startsWith('/api/');
  const allowed = parseAllowList(c.env.ALLOWED_EMAILS, c.env.ALLOWED_EMAIL_DOMAINS);
  const deny = (status: 401 | 403 | 503, message: string, code: string) =>
    isApi ? c.json({ error: message, code }, status) : c.text(`${status} ${status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Service Unavailable'}: ${message}`, status);

  if (mode === 'google') {
    const g = googleConfig(c.env);
    if (!g.cfg) {
      console.error(`Google ログインの設定不足: ${g.missing.join(', ')}（docs/デプロイ手順.md）`);
      return deny(503, 'ログインの設定が完了していません。管理者に連絡してください', 'authConfig');
    }
    const sess = await verifyPayload<SessionPayload>(parseCookies(c.req.header('cookie')).get(SESSION_COOKIE), g.cfg.sessionSecret, 'session');
    if (!sess) {
      if (isApi) return c.json({ error: 'ログインしてください', code: 'noSession', login: '/auth/login' }, 401);
      const url = new URL(c.req.url);
      if (c.req.method === 'GET' && (c.req.header('accept') ?? '').includes('text/html')) return c.redirect(`/auth/login?return=${encodeURIComponent(url.pathname + url.search)}`, 302);
      return c.text('401 Unauthorized: ログインしてください', 401);
    }
    if (!isEmailAllowed(sess.email, allowed)) return deny(403, notAllowedMessage(), 'notAllowed');
    c.set('identity', { email: sess.email, sub: sess.sub, name: sess.name, verified: true });
    return next();
  }

  if (mode === 'mock') {
    const email = (c.env.DEV_USER_EMAIL?.trim() || MOCK_EMAIL).toLowerCase();
    if (!isEmailAllowed(email, allowed)) return deny(403, notAllowedMessage(), 'notAllowed');
    c.set('identity', { email, sub: 'mock', name: 'サンプル利用者', verified: false });
    return next();
  }

  console.error('認証が未設定（GOOGLE_CLIENT_ID が無く、BQ_MOCK も 1 ではない）。fail-closed で 503 を返す');
  return deny(503, 'ログインの設定が完了していません。管理者に連絡してください', 'authConfig');
}

/** 書き込み系 API: Google ログインで確かめた人だけ（モックの仮の利用者は読み取り専用） */
export const requireVerified: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = c.get('identity');
  if (!id?.verified) return c.json({ error: '書き込みには Google ログインが必要です（サンプルデータ表示中は読み取り専用）', code: 'readOnly' }, 403);
  await next();
};
