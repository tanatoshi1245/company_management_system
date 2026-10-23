// 複製元: sales_dashboard_IS-FS_ver2 の tests/worker/google.test.ts（import 先だけ変更）
import { describe, expect, it } from 'vitest';
import { buildAuthUrl, parseCookies, pkceChallenge, randomToken, safeReturnPath, serializeCookie, signPayload, verifyPayload, type SessionPayload, type StatePayload } from '../../src/worker/auth/google';

const NOW = 1_800_000_000;
const SECRET = 's'.repeat(32);

describe('Google ログインの部品', () => {
  it('セッションの署名と検証: 正しければ payload、改ざん・別の鍵・期限切れ・種類違いは null', async () => {
    const sess: SessionPayload = { kind: 'session', email: 'a@daijob.com', sub: '1', name: 'A', iat: NOW, exp: NOW + 600 };
    const token = await signPayload(sess, SECRET);
    expect(token.split('.')).toHaveLength(2);
    expect(await verifyPayload<SessionPayload>(token, SECRET, 'session', NOW)).toEqual(sess);
    expect(await verifyPayload<SessionPayload>(token, 'x'.repeat(32), 'session', NOW)).toBeNull();
    expect(await verifyPayload<SessionPayload>(token, SECRET, 'session', NOW + 601)).toBeNull();
    expect(await verifyPayload<StatePayload>(token, SECRET, 'state', NOW)).toBeNull();
    const [body, sig] = token.split('.');
    const tampered = `${body.slice(0, -2)}AA.${sig}`;
    expect(await verifyPayload<SessionPayload>(tampered, SECRET, 'session', NOW)).toBeNull();
    expect(await verifyPayload<SessionPayload>(`${body}.${sig.slice(0, -1)}A`, SECRET, 'session', NOW)).toBeNull();
    expect(await verifyPayload<SessionPayload>('', SECRET, 'session', NOW)).toBeNull();
    expect(await verifyPayload<SessionPayload>('garbage', SECRET, 'session', NOW)).toBeNull();
    expect(await verifyPayload<SessionPayload>(undefined, SECRET, 'session', NOW)).toBeNull();
  });

  it('PKCE: RFC 7636 の例と一致する。乱数は毎回違う', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('認可 URL: client_id / redirect_uri / state / PKCE を付ける（許可ドメインのヒントは付けない）', () => {
    const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'https://x.workers.dev/auth/callback', state: 'st', codeChallenge: 'ch' }));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: 'cid', redirect_uri: 'https://x.workers.dev/auth/callback', response_type: 'code', scope: 'openid email profile', state: 'st', code_challenge: 'ch', code_challenge_method: 'S256', prompt: 'select_account' });
  });

  it('Cookie の読み書き', () => {
    const c = parseCookies('a=1; sam_session=abc.def;  b=2');
    expect(c.get('sam_session')).toBe('abc.def');
    expect(c.get('b')).toBe('2');
    expect(parseCookies(undefined).size).toBe(0);
    expect(serializeCookie('sam_session', 'v', { maxAgeSec: 60, secure: true })).toBe('sam_session=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure');
    expect(serializeCookie('sam_session', '', { maxAgeSec: 0, secure: false })).toBe('sam_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  });

  it('戻り先は同一オリジンのパスだけ', () => {
    expect(safeReturnPath('/')).toBe('/');
    expect(safeReturnPath('/?x=1#summary')).toBe('/?x=1#summary');
    expect(safeReturnPath('//evil.example')).toBe('/');
    expect(safeReturnPath('https://evil.example/')).toBe('/');
    expect(safeReturnPath('/auth/login')).toBe('/');
    expect(safeReturnPath(null)).toBe('/');
  });
});
