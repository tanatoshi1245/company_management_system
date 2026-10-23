import { SESSION_COOKIE, signPayload, type SessionPayload } from '../../src/worker/auth/google';
import { SECRET } from './env';

/** 署名済みのセッション Cookie（ログイン済みの状態を作る） */
export async function sessionCookie(email = 'cs@daijob.com', opts: { secret?: string; exp?: number; name?: string } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const sess: SessionPayload = { kind: 'session', email, sub: 'sub-1', name: opts.name ?? 'テスト 太郎', iat: now, exp: opts.exp ?? now + 3600 };
  return `${SESSION_COOKIE}=${await signPayload(sess, opts.secret ?? SECRET)}`;
}

export function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...extra };
}
