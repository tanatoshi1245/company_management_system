import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import app from '../../src/worker/index';
import { requireVerified } from '../../src/worker/auth/middleware';
import type { AppEnv } from '../../src/worker/types';
import { baseEnv, ctx, googleEnv, SECRET } from '../helpers/env';
import { sessionCookie } from '../helpers/login';

describe('認証（fail-closed・モック・Google セッション）', () => {
  it('Google 未設定かつ BQ_MOCK≠1 なら全パスが 503（誰でも閲覧できる状態にしない）', async () => {
    const env = { ...baseEnv, BQ_MOCK: '0' };
    const api = await app.fetch(new Request('http://x/api/health'), env, ctx);
    expect(api.status).toBe(503);
    expect(await api.json()).toMatchObject({ code: 'authConfig' });
    const page = await app.fetch(new Request('http://x/', { headers: { accept: 'text/html' } }), env, ctx);
    expect(page.status).toBe(503);
    const asset = await app.fetch(new Request('http://x/assets/app.js'), env, ctx);
    expect(asset.status).toBe(503);
  });

  it('GOOGLE_CLIENT_ID はあるが Secret が足りないと 503 authConfig（足りない名前は応答に出さない）', async () => {
    const env = { ...baseEnv, GOOGLE_CLIENT_ID: 'cid' };
    const res = await app.fetch(new Request('http://x/api/health'), env, ctx);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text).code).toBe('authConfig');
    expect(text).not.toContain('SESSION_SECRET');
    expect(text).not.toContain('GOOGLE_CLIENT_SECRET');
  });

  it('モック（BQ_MOCK=1・Google 未設定）は仮の利用者で閲覧できる（verified=false・読み取り専用）', async () => {
    const res = await app.fetch(new Request('http://x/api/me'), baseEnv, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: 'preview@daijob.com', verified: false, authMode: 'mock', mock: true, canEdit: false });
    const named = await app.fetch(new Request('http://x/api/me'), { ...baseEnv, DEV_USER_EMAIL: 'Me@Daijob.com' }, ctx);
    expect(await named.json()).toMatchObject({ email: 'me@daijob.com' });
  });

  it('モックでも許可ドメイン外の仮の利用者は 403', async () => {
    const res = await app.fetch(new Request('http://x/api/me'), { ...baseEnv, DEV_USER_EMAIL: 'x@gmail.com' }, ctx);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('notAllowed');
    expect(body.error).not.toContain('daijob.com');
  });

  it('Google ログイン: セッション無しは API 401（login 付き）、画面は /auth/login へ 302、アセットも配らない', async () => {
    const api = await app.fetch(new Request('http://x/api/health'), googleEnv, ctx);
    expect(api.status).toBe(401);
    expect(await api.json()).toMatchObject({ code: 'noSession', login: '/auth/login' });
    const page = await app.fetch(new Request('http://x/?month=2026-10', { headers: { accept: 'text/html' } }), googleEnv, ctx);
    expect(page.status).toBe(302);
    expect(page.headers.get('location')).toBe('/auth/login?return=%2F%3Fmonth%3D2026-10');
    const js = await app.fetch(new Request('http://x/assets/index.js'), googleEnv, ctx);
    expect(js.status).toBe(401);
  });

  it('Google ログイン: 正しいセッション Cookie なら通り、本人（verified）になる。改ざん・別鍵・期限切れは 401', async () => {
    const ok = await app.fetch(new Request('http://x/api/me', { headers: { cookie: await sessionCookie('Someone@Daijob.com') } }), googleEnv, ctx);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ email: 'Someone@Daijob.com', verified: true, authMode: 'google', loginUrl: '/auth/login', logoutUrl: '/auth/logout' });
    const cookie = await sessionCookie('a@daijob.com');
    const tampered = `${cookie.slice(0, -3)}AAA`;
    expect((await app.fetch(new Request('http://x/api/me', { headers: { cookie: tampered } }), googleEnv, ctx)).status).toBe(401);
    const otherKey = await sessionCookie('a@daijob.com', { secret: 'x'.repeat(40) });
    expect((await app.fetch(new Request('http://x/api/me', { headers: { cookie: otherKey } }), googleEnv, ctx)).status).toBe(401);
    const expired = await sessionCookie('a@daijob.com', { exp: Math.floor(Date.now() / 1000) - 10 });
    expect((await app.fetch(new Request('http://x/api/me', { headers: { cookie: expired } }), googleEnv, ctx)).status).toBe(401);
    expect(SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('Google ログイン: 許可ドメイン外（gmail）のセッションは 403 notAllowed', async () => {
    const res = await app.fetch(new Request('http://x/api/me', { headers: { cookie: await sessionCookie('x@gmail.com') } }), googleEnv, ctx);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'notAllowed' });
  });

  it('/auth/login は Google の認可画面へ 302 し、state Cookie を出す。/auth/logout はセッションを消す', async () => {
    const res = await app.fetch(new Request('https://x/auth/login?return=%2Ftargets'), googleEnv, ctx);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(loc.searchParams.get('redirect_uri')).toBe('https://x/auth/callback');
    expect(loc.searchParams.get('hd')).toBeNull();
    expect(res.headers.get('set-cookie')).toMatch(/^cms_oauth=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
    const out = await app.fetch(new Request('https://x/auth/logout'), googleEnv, ctx);
    expect(out.status).toBe(302);
    expect(out.headers.get('set-cookie')).toMatch(/^cms_session=; .*Max-Age=0/);
    // 未設定なら 503 のページ（Secret 名は出さない）
    const none = await app.fetch(new Request('https://x/auth/login'), baseEnv, ctx);
    expect(none.status).toBe(503);
    expect(await none.text()).not.toContain('GOOGLE_CLIENT_ID');
  });

  it('/auth/callback: state 不一致は 400、Google がエラーを返したら 401', async () => {
    const bad = await app.fetch(new Request('https://x/auth/callback?code=abc&state=zzz'), googleEnv, ctx);
    expect(bad.status).toBe(400);
    const err = await app.fetch(new Request('https://x/auth/callback?error=access_denied'), googleEnv, ctx);
    expect(err.status).toBe(401);
  });

  it('requireVerified: モックの仮の利用者の書き込みは 403 readOnly、本人なら通る', async () => {
    const t = new Hono<AppEnv>();
    t.use('*', async (c, next) => {
      c.set('identity', c.req.header('x-verified') === '1' ? { email: 'a@daijob.com', sub: '1', verified: true } : { email: 'p@daijob.com', sub: 'mock', verified: false });
      await next();
    });
    t.put('/w', requireVerified, (c) => c.json({ ok: true }));
    const deny = await t.fetch(new Request('http://x/w', { method: 'PUT' }), baseEnv, ctx);
    expect(deny.status).toBe(403);
    expect(await deny.json()).toMatchObject({ code: 'readOnly' });
    const ok = await t.fetch(new Request('http://x/w', { method: 'PUT', headers: { 'x-verified': '1' } }), baseEnv, ctx);
    expect(ok.status).toBe(200);
  });
});
