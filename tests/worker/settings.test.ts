import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/worker/index';
import { baseEnv, ctx, googleEnv } from '../helpers/env';
import { jsonHeaders, sessionCookie } from '../helpers/login';
import { createFakeD1 } from '../helpers/fakeD1';
import { installFakeCache, uninstallFakeCache } from '../helpers/fakeCache';
import { BoardResponseSchema } from '../../src/shared/schema/board';
import { CompanyDetailResponseSchema } from '../../src/shared/schema/company';
import { SettingsListResponseSchema, SettingsOneResponseSchema } from '../../src/shared/schema/settings';
import { MeResponseSchema } from '../../src/shared/schema/me';
import { PlanDefaultsResponseSchema } from '../../src/shared/schema/targets';
import type { Env } from '../../src/worker/env';

describe('/api/companies/:id/settings, /api/settings/*, /api/admin/*', () => {
  let env: Env;
  let d1: ReturnType<typeof createFakeD1>;
  let cookie: string;
  let id: string;
  beforeAll(async () => {
    installFakeCache();
    cookie = await sessionCookie('cs@daijob.com');
  });
  afterAll(() => uninstallFakeCache());
  beforeEach(async () => {
    d1 = createFakeD1();
    env = { ...googleEnv, CMS_DB: d1 as unknown as D1Database };
    const board = BoardResponseSchema.parse(await (await app.fetch(new Request('http://x/api/board', { headers: { cookie } }), env, ctx)).json());
    id = board.companies.find((c) => !c.isMine && c.limits.scout)!.id;
  });
  const put = (path: string, body: unknown) => app.fetch(new Request(`http://x/api${path}`, { method: 'PUT', headers: jsonHeaders({ cookie }), body: JSON.stringify(body) }), env, ctx);
  const post = (path: string) => app.fetch(new Request(`http://x/api${path}`, { method: 'POST', headers: jsonHeaders({ cookie }), body: '{}' }), env, ctx);
  const get = (path: string) => app.fetch(new Request(`http://x/api${path}`, { headers: { cookie } }), env, ctx);

  it('担当上書き → ボードで担当=自分・isMine、/api/me の overrideCompanyIds、詳細の limits と period、履歴。空で保存すると削除', async () => {
    const r = await put(`/companies/${id}/settings`, { csOwnerEmail: 'CS@daijob.com', csOwnerName: '佐藤', scoutLimitPeriod: 'contract', scoutLimitOverride: 300, jobLimitOverride: null, memo: '引き継ぎ' });
    expect(r.status).toBe(201);
    const one = SettingsOneResponseSchema.parse(await r.json());
    expect(one.settings?.csOwnerEmail).toBe('cs@daijob.com');
    expect(one.settings?.scoutLimitPeriod).toBe('contract');
    const board = BoardResponseSchema.parse(await (await get('/board')).json());
    const co = board.companies.find((c) => c.id === id)!;
    expect(co.isMine).toBe(true);
    expect(co.owner).toEqual({ email: 'cs@daijob.com', name: '佐藤', src: 'override' });
    expect(co.limits).toEqual({ scout: 300, job: co.limits.job, period: 'contract' });
    const me = MeResponseSchema.parse(await (await get('/me')).json());
    expect(me.overrideCompanyIds).toEqual([id]);
    expect(me.canEdit).toBe(true);
    const detail = CompanyDetailResponseSchema.parse(await (await get(`/companies/${id}`)).json());
    expect(detail.settings?.memo).toBe('引き継ぎ');
    expect(detail.company.limits.scout).toBe(300);
    const list = SettingsListResponseSchema.parse(await (await get('/settings/overrides')).json());
    expect(list.rows).toHaveLength(1);
    // 空で保存 → 削除
    const r2 = await put(`/companies/${id}/settings`, { csOwnerEmail: null, csOwnerName: null, scoutLimitPeriod: 'month', scoutLimitOverride: null, jobLimitOverride: null, memo: null });
    expect(r2.status).toBe(200);
    expect(SettingsOneResponseSchema.parse(await r2.json()).settings).toBeNull();
    expect(d1.raw.prepare('SELECT COUNT(*) AS n FROM company_settings').get()).toEqual({ n: 0 });
    expect(d1.raw.prepare("SELECT action FROM audit_log WHERE entity = 'company_settings' ORDER BY id").all().map((x) => (x as { action: string }).action)).toEqual(['create', 'delete']);
  });

  it('検証: 他ドメインの担当メール・不正な period・未知キー → 400。存在しない企業 → 404。モックは 403', async () => {
    const bad = await put(`/companies/${id}/settings`, { csOwnerEmail: 'x@gmail.com' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { details: { path: string }[] }).details[0].path).toBe('csOwnerEmail');
    expect((await put(`/companies/${id}/settings`, { scoutLimitPeriod: 'year' })).status).toBe(400);
    expect((await put(`/companies/${id}/settings`, { flags: { a: 1 } })).status).toBe(400);
    expect((await put(`/companies/999999999/settings`, { memo: 'x' })).status).toBe(404);
    const mock = await app.fetch(new Request(`http://x/api/companies/${id}/settings`, { method: 'PUT', headers: jsonHeaders(), body: '{}' }), { ...baseEnv, CMS_DB: d1 as unknown as D1Database }, ctx);
    expect(mock.status).toBe(403);
  });

  it('プラン既定値の置き換えと、cache bump（epoch が増えてボードのキャッシュが MISS に戻る）', async () => {
    const r = await put('/settings/plan-defaults', { plan: 'DJ', values: { scout_sent: 100, hires: 1, stage_offer: 2 } });
    expect(r.status).toBe(200);
    expect(PlanDefaultsResponseSchema.parse(await r.json()).plans).toEqual({ DJ: { scout_sent: 100, hires: 1, stage_offer: 2 } });
    const r2 = await put('/settings/plan-defaults', { plan: 'DJ', values: { scout_sent: 80 } });
    expect(PlanDefaultsResponseSchema.parse(await r2.json()).plans).toEqual({ DJ: { scout_sent: 80 } });
    expect((await put('/settings/plan-defaults', { plan: 'DJ', values: { bogus: 1 } })).status).toBe(400);
    expect((await put('/settings/plan-defaults', { plan: '', values: {} })).status).toBe(400);
    expect((await get('/board')).headers.get('x-cache')).toBe('HIT');
    const bump = await post('/admin/cache/bump');
    expect(bump.status).toBe(200);
    expect(await bump.json()).toEqual({ cacheEpoch: '2' });
    expect((await get('/board')).headers.get('x-cache')).toBe('MISS');
    expect((await get('/board')).headers.get('x-cache')).toBe('HIT');
  });
});
