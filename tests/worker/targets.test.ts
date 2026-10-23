import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/worker/index';
import { baseEnv, ctx, googleEnv } from '../helpers/env';
import { jsonHeaders, sessionCookie } from '../helpers/login';
import { createFakeD1 } from '../helpers/fakeD1';
import { installFakeCache, uninstallFakeCache } from '../helpers/fakeCache';
import { BoardResponseSchema } from '../../src/shared/schema/board';
import { AuditListResponseSchema, CompanyTargetsResponseSchema, TargetRecordSchema, TargetsByMonthResponseSchema } from '../../src/shared/schema/targets';
import { addMonths, monthOf, todayJst } from '../../src/shared/calendar/periods';
import type { Env } from '../../src/worker/env';

const cur = monthOf(todayJst());
const next = addMonths(cur, 1);

describe('/api/companies/:id/targets（D1 書き込み）', () => {
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
    id = board.companies[0].id;
  });
  const put = (path: string, body: unknown, e = env, headers: Record<string, string> = jsonHeaders({ cookie })) => app.fetch(new Request(`http://x/api${path}`, { method: 'PUT', headers, body: JSON.stringify(body) }), e, ctx);
  const post = (path: string, body: unknown) => app.fetch(new Request(`http://x/api${path}`, { method: 'POST', headers: jsonHeaders({ cookie }), body: JSON.stringify(body) }), env, ctx);
  const get = (path: string) => app.fetch(new Request(`http://x/api${path}`, { headers: { cookie } }), env, ctx);
  const VALID = { scout_sent: 100, interested: 20, applications: 10, views: null, hires: 1, stages: { interview: 3 }, note: '契約時合意' };

  it('登録（201）→ 更新（200）→ 一覧 → 削除（204）。更新と監査ログが同じ batch に入り、履歴に自分のメールが残る', async () => {
    const r1 = await put(`/companies/${id}/targets/${cur}`, VALID);
    expect(r1.status).toBe(201);
    const rec = TargetRecordSchema.parse(await r1.json());
    expect(rec.values.scout_sent).toBe(100);
    expect(rec.values.stages).toEqual({ interview: 3 });
    expect(rec.createdBy).toBe('cs@daijob.com');
    const r2 = await put(`/companies/${id}/targets/${cur}`, { ...VALID, scout_sent: 120 });
    expect(r2.status).toBe(200);
    expect(TargetRecordSchema.parse(await r2.json()).values.scout_sent).toBe(120);
    const list = TargetsByMonthResponseSchema.parse(await (await get(`/targets?month=${cur}`)).json());
    expect(list.rows).toHaveLength(1);
    const byCo = CompanyTargetsResponseSchema.parse(await (await get(`/companies/${id}/targets`)).json());
    expect(byCo.rows.map((r) => r.month)).toEqual([cur]);
    const hist = AuditListResponseSchema.parse(await (await get(`/companies/${id}/targets/history`)).json());
    expect(hist.rows.map((h) => h.action)).toEqual(['update', 'create']);
    expect(hist.rows[0].actor).toBe('cs@daijob.com');
    expect((hist.rows[0].before as { values: { scout_sent: number } }).values.scout_sent).toBe(100);
    // ボードに目標が載る
    const board = BoardResponseSchema.parse(await (await get(`/board?month=${cur}`)).json());
    expect(board.companies.find((c) => c.id === id)?.targets?.scout_sent).toBe(120);
    const del = await app.fetch(new Request(`http://x/api/companies/${id}/targets/${cur}`, { method: 'DELETE', headers: { cookie, 'sec-fetch-site': 'same-origin' } }), env, ctx);
    expect(del.status).toBe(204);
    expect(d1.raw.prepare('SELECT COUNT(*) AS n FROM company_targets').get()).toEqual({ n: 0 });
    expect(d1.raw.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 3 });
    expect((await app.fetch(new Request(`http://x/api/companies/${id}/targets/${cur}`, { method: 'DELETE', headers: { cookie, 'sec-fetch-site': 'same-origin' } }), env, ctx)).status).toBe(404);
  });

  it('検証: 負数・小数・上限超過・未知キー・company_id を本文に入れる → 400 details。存在しない企業 → 404。不正な月 → 404', async () => {
    for (const [body, path] of [
      [{ ...VALID, scout_sent: -1 }, 'scout_sent'],
      [{ ...VALID, applications: 1.5 }, 'applications'],
      [{ ...VALID, hires: 1_000_000 }, 'hires'],
      [{ ...VALID, foo: 1 }, '(root)'],
      [{ ...VALID, company_id: 1 }, '(root)'],
      [{ ...VALID, stages: { final: 1 } }, 'stages'],
      [{ ...VALID, note: 'x'.repeat(501) }, 'note'],
    ] as const) {
      const r = await put(`/companies/${id}/targets/${cur}`, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      const j = (await r.json()) as { code: string; details: { path: string }[] };
      expect(j.code).toBe('badRequest');
      expect(j.details.some((d) => d.path.startsWith(path)), JSON.stringify(j.details)).toBe(true);
    }
    expect((await put(`/companies/999999999/targets/${cur}`, VALID)).status).toBe(404);
    expect((await put(`/companies/${id}/targets/2026-13`, VALID)).status).toBe(404);
    expect((await put(`/companies/abc/targets/${cur}`, VALID)).status).toBe(404);
    expect(d1.raw.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 0 });
  });

  it('権限: モックの仮の利用者は 403 readOnly、CSRF（他オリジン / JSON でない）は 403 / 415、D1 無しは 503', async () => {
    const mock = await put(`/companies/${id}/targets/${cur}`, VALID, { ...baseEnv, CMS_DB: d1 as unknown as D1Database }, jsonHeaders());
    expect(mock.status).toBe(403);
    expect(((await mock.json()) as { code: string }).code).toBe('readOnly');
    const cross = await put(`/companies/${id}/targets/${cur}`, VALID, env, { cookie, 'content-type': 'application/json', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
    expect(cross.status).toBe(403);
    const form = await put(`/companies/${id}/targets/${cur}`, VALID, env, { cookie, 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' });
    expect(form.status).toBe(415);
    const noDb = await put(`/companies/${id}/targets/${cur}`, VALID, googleEnv);
    expect(noDb.status).toBe(503);
    expect(((await noDb.json()) as { code: string }).code).toBe('storage');
    const text = await (await put(`/companies/${id}/targets/${cur}`, VALID, env, { cookie, 'content-type': 'application/json', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).text();
    expect(text).not.toMatch(/at .*\.ts|SELECT|INSERT/);
  });

  it('コピーは目標の無い月にだけ。一括既定値は空の (企業, 月) だけ', async () => {
    expect((await put(`/companies/${id}/targets/${cur}`, VALID)).status).toBe(201);
    const m2 = addMonths(cur, 2);
    expect((await put(`/companies/${id}/targets/${m2}`, { ...VALID, scout_sent: 5 })).status).toBe(201);
    const copy = await post(`/companies/${id}/targets/copy`, { fromMonth: cur, toMonths: [next, m2, cur] });
    expect(copy.status).toBe(200);
    expect(await copy.json()).toEqual({ created: [next], skipped: [m2, cur] });
    const byCo = CompanyTargetsResponseSchema.parse(await (await get(`/companies/${id}/targets`)).json());
    expect(byCo.rows.find((r) => r.month === m2)?.values.scout_sent).toBe(5);
    expect(byCo.rows.find((r) => r.month === next)?.values.scout_sent).toBe(100);
    expect((await post(`/companies/${id}/targets/copy`, { fromMonth: addMonths(cur, 5), toMonths: [next] })).status).toBe(400);
    // プラン既定値
    const board = BoardResponseSchema.parse(await (await get(`/board?month=${cur}`)).json());
    const plan = board.companies.find((c) => c.id === id)!.plan!;
    const nPlan = board.companies.filter((c) => c.plan === plan).length;
    expect(nPlan).toBeGreaterThan(1);
    const pd = await put('/settings/plan-defaults', { plan, values: { scout_sent: 50, applications: 8 } });
    expect(pd.status).toBe(200);
    const bulk = await post('/targets/bulk-defaults', { months: [cur, next] });
    expect(bulk.status).toBe(200);
    const j = (await bulk.json()) as { created: number };
    // 自社の cur / next は既にあるので除かれる
    expect(j.created).toBe(nPlan * 2 - 2);
    const after = TargetsByMonthResponseSchema.parse(await (await get(`/targets?month=${cur}`)).json());
    expect(after.rows.find((r) => r.companyId === id)?.values.scout_sent).toBe(100);
    expect(after.rows.filter((r) => r.companyId !== id).every((r) => r.values.scout_sent === 50 && r.values.applications === 8)).toBe(true);
    // 2 回目は何も作らない
    expect(((await (await post('/targets/bulk-defaults', { months: [cur, next] })).json()) as { created: number }).created).toBe(0);
    // companyIds で絞る
    const other = board.companies.find((c) => c.plan === plan && c.id !== id)!.id;
    const m3 = addMonths(cur, 3);
    expect(((await (await post('/targets/bulk-defaults', { months: [m3], companyIds: [other] })).json()) as { created: number }).created).toBe(1);
  });
});
