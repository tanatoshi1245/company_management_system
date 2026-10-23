import { describe, expect, it } from 'vitest';
import app from '../../src/worker/index';
import { baseEnv, ctx } from '../helpers/env';
import { MetaResponseSchema } from '../../src/shared/schema/me';
import { DATA_VERSION } from '../../src/shared/schema/common';
import { SECURITY_HEADERS } from '../../src/worker/lib/securityHeaders';

describe('Worker API（モック）', () => {
  it('/api/health は設定の有無だけを返し、値も変数名も返さない', async () => {
    const env = { ...baseEnv, BQ_SA_KEY: '{"client_email":"x","private_key":"SECRET-VALUE"}' };
    const res = await app.fetch(new Request('http://x/api/health'), env, ctx);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ ok: true, mock: true, bqKeyConfigured: true, d1Configured: false, authMode: 'mock', googleLoginConfigured: false, allowedDomains: ['daijob.com'], allowedEmailsCount: 0, dataVersion: DATA_VERSION });
    expect(text).not.toContain('SECRET-VALUE');
    expect(text).not.toContain('BQ_SA_KEY');
    expect(text).not.toContain('envNames');
  });

  it('/api/meta はマートの版・データ最終日・当月の営業日・注記を返す', async () => {
    const res = await app.fetch(new Request('http://x/api/meta'), baseEnv, ctx);
    expect(res.status).toBe(200);
    const body = MetaResponseSchema.parse(await res.json());
    expect(body.refreshStatus).toBe('ok');
    expect(body.dataVersion).toBe(body.asOf);
    expect(body.month).toBe(body.asOf.slice(0, 7));
    expect(body.bizDays.total).toBeGreaterThan(15);
    expect(body.bizDays.elapsed).toBeLessThanOrEqual(body.bizDays.total);
    expect(body.caveats.length).toBeGreaterThan(5);
    expect(body.caveats.map((c) => c.id)).toContain('status_current_only');
    expect(body.ownerSource).toBe('sales_staff');
    expect(body.mock).toBe(true);
  });

  it('存在しない /api/* は 404 の JSON、画面は SPA のアセット', async () => {
    const nf = await app.fetch(new Request('http://x/api/nope'), baseEnv, ctx);
    expect(nf.status).toBe(404);
    expect(await nf.json()).toMatchObject({ code: 'notFound' });
    const page = await app.fetch(new Request('http://x/companies/123', { headers: { accept: 'text/html' } }), baseEnv, ctx);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('spa');
  });

  it('セキュリティヘッダ（CSP / nosniff / Referrer / frame）が画面・API・エラー応答のすべてに付く', async () => {
    for (const url of ['http://x/', 'http://x/api/health', 'http://x/api/nope']) {
      const res = await app.fetch(new Request(url, { headers: { accept: 'text/html' } }), baseEnv, ctx);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k), `${url} ${k}`).toBe(v);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
    const denied = await app.fetch(new Request('http://x/api/health'), { ...baseEnv, BQ_MOCK: '0' }, ctx);
    expect(denied.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('書き込みは同一オリジンからだけ（Sec-Fetch-Site / Origin）、JSON 以外は 415', async () => {
    const noHdr = await app.fetch(new Request('http://x/api/anything', { method: 'POST', body: '{}' }), baseEnv, ctx);
    expect(noHdr.status).toBe(403);
    expect(await noHdr.json()).toMatchObject({ code: 'csrf' });
    const cross = await app.fetch(new Request('http://x/api/anything', { method: 'PUT', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' }), baseEnv, ctx);
    expect(cross.status).toBe(403);
    const form = await app.fetch(new Request('http://x/api/anything', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' }), baseEnv, ctx);
    expect(form.status).toBe(415);
    const ok = await app.fetch(new Request('http://x/api/anything', { method: 'POST', headers: { origin: 'http://x', 'content-type': 'application/json' }, body: '{}' }), baseEnv, ctx);
    expect(ok.status).toBe(404); // ガードを通って（まだ無い）ルートの 404
    const del = await app.fetch(new Request('http://x/api/anything', { method: 'DELETE', headers: { 'sec-fetch-site': 'same-origin' } }), baseEnv, ctx);
    expect(del.status).toBe(404);
  });

  it('鍵が無い実モードは noCredentials でダッシュボードの設定手順を案内する', async () => {
    const env = { ...baseEnv, BQ_MOCK: '0', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 's', SESSION_SECRET: 's'.repeat(40) };
    const { sessionCookie } = await import('../helpers/login');
    const res = await app.fetch(new Request('http://x/api/meta', { headers: { cookie: await sessionCookie('a@daijob.com', { secret: 's'.repeat(40) }) } }), env, ctx);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('noCredentials');
    expect(body.error).toContain('Variables and Secrets');
  });
});

describe('設定不足の例外を分かるメッセージにする', () => {
  it('D1 にマイグレーションが無いと 503 storage（SQL は出さない）、SA 鍵が壊れていると noCredentials', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createFakeD1 } = await import('../helpers/fakeD1');
    const { installFakeCache, uninstallFakeCache } = await import('../helpers/fakeCache');
    installFakeCache();
    try {
      const emptyDb = createFakeD1(mkdtempSync(join(tmpdir(), 'd1-empty-')));
      const res = await app.fetch(new Request('http://x/api/board'), { ...baseEnv, CMS_DB: emptyDb as unknown as D1Database }, ctx);
      expect(res.status).toBe(503);
      const body = (await res.json()) as { code: string; error: string };
      expect(body.code).toBe('storage');
      expect(body.error).toContain('0001_init.sql');
      expect(body.error).toMatch(/表 (company_targets|company_settings|app_meta) がありません/);
      expect(body.error).not.toMatch(/SELECT|FROM/);
      const bad = await app.fetch(new Request('http://x/api/board'), { ...baseEnv, BQ_MOCK: '0', GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', SESSION_SECRET: 's'.repeat(40), BQ_SA_KEY: '{"type":"service_account"}' }, ctx);
      // 未ログインなので 401（鍵の検査はログイン後）。ログイン済みの経路は board.test で担保
      expect(bad.status).toBe(401);
    } finally {
      uninstallFakeCache();
    }
  });
});
