import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/worker/index';
import { baseEnv, ctx } from '../helpers/env';
import { installFakeCache, uninstallFakeCache } from '../helpers/fakeCache';
import { parseScoutUnused } from '../../src/worker/services/companyService';
import { CompanyDetailResponseSchema } from '../../src/shared/schema/company';
import { BoardResponseSchema } from '../../src/shared/schema/board';
import { addMonths, monthOf, todayJst } from '../../src/shared/calendar/periods';
import { ATTRIBUTE_TYPES } from '../../src/shared/labels';

describe('/api/companies/:id（モック）', () => {
  beforeAll(() => installFakeCache());
  afterAll(() => uninstallFakeCache());
  const get = (path: string, env = baseEnv) => app.fetch(new Request(`http://x/api/companies/${path}`), env, ctx);

  it('存在する企業: マスタ・14 か月・日次累積・コホート・属性（3 か月）・ベンチマーク系列。2 回目はキャッシュ', async () => {
    const board = BoardResponseSchema.parse(await (await app.fetch(new Request('http://x/api/board'), baseEnv, ctx)).json());
    const id = board.companies[0].id;
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
    const text = await res.text();
    const body = CompanyDetailResponseSchema.parse(JSON.parse(text));
    expect(body.company.id).toBe(id);
    expect(body.company.name).toBe(board.companies[0].name);
    expect(body.monthly).toHaveLength(14);
    expect(body.monthly[13].month).toBe(monthOf(todayJst()));
    expect(Object.keys(body.monthly[0].st)).toHaveLength(12);
    const cur = monthOf(todayJst());
    const prev = addMonths(cur, -1);
    expect(body.daily.length).toBeGreaterThan(25);
    expect(new Set(body.daily.map((d) => d.month))).toEqual(new Set([prev, cur].filter((m, i) => i === 0 || body.daily.some((d) => d.month === m))));
    for (let i = 1; i < body.daily.length; i++) if (body.daily[i].month === body.daily[i - 1].month) expect(body.daily[i].sentCum).toBeGreaterThanOrEqual(body.daily[i - 1].sentCum);
    expect(body.cohorts.scout.length).toBeGreaterThan(5);
    expect(body.cohorts.application.length).toBeGreaterThan(5);
    const attrMonths = new Set(body.attributes.map((a) => a.month));
    expect(attrMonths.size).toBeLessThanOrEqual(3);
    for (const t of ATTRIBUTE_TYPES) expect(body.attributes.some((a) => a.type === t), t).toBe(true);
    // スカウトを送った会員と求人を閲覧した会員の両方（kind）。閲覧は興味あり 0
    expect(body.attributes.some((a) => a.kind === 'scout')).toBe(true);
    expect(body.attributes.some((a) => a.kind === 'view')).toBe(true);
    expect(body.attributes.filter((a) => a.kind === 'view').every((a) => a.interested === 0)).toBe(true);
    expect(typeof body.extra.jobsWindowDistinct).toBe('number');
    expect(body.monthly.every((m) => m.hiresApp + m.hiresScout >= m.hires || m.hires === 0 || m.hiresApp + m.hiresScout >= 1)).toBe(true);
    expect(body.benchSeries.some((b) => b.industry === '__ALL__' && b.companyType === '__ALL__')).toBe(true);
    // スカウト未利用の記録（マートの JSON 列を配列に。モックは 3 社に 1 社）
    expect(Array.isArray(body.scoutUnused)).toBe(true);
    for (const r of body.scoutUnused) expect(r.month).toMatch(/^\d{4}-\d{2}$/);
    const withUnused = await Promise.all(board.companies.slice(0, 6).map(async (c) => CompanyDetailResponseSchema.parse(await (await get(c.id)).json()).scoutUnused.length));
    expect(withUnused.some((n) => n > 0)).toBe(true);
    expect(body.settings).toBeNull();
    expect(body.targetsByMonth).toEqual({});
    expect(text.length).toBeLessThan(200_000);
    const again = await get(id);
    expect(again.headers.get('x-cache')).toBe('HIT');
  });

  it('存在しない ID・形式違いは 404、範囲外の月は 400', async () => {
    expect((await get('999999')).status).toBe(404);
    expect((await get('abc')).status).toBe(404);
    expect((await get('1001?month=2020-01')).status).toBe(400);
    expect((await get('1001?month=2026/10')).status).toBe(400);
  });

  it('担当=自分 がログイン者で決まる', async () => {
    const board = BoardResponseSchema.parse(await (await app.fetch(new Request('http://x/api/board'), { ...baseEnv, DEV_USER_EMAIL: 'preview@daijob.com' }, ctx)).json());
    const mine = board.companies.find((c) => c.isMine)!;
    const body = CompanyDetailResponseSchema.parse(await (await get(mine.id, { ...baseEnv, DEV_USER_EMAIL: 'preview@daijob.com' })).json());
    expect(body.company.isMine).toBe(true);
  });
});

describe('parseScoutUnused', () => {
  it('JSON 配列を行にし、壊れた JSON・形の違う要素・NULL は空にする', () => {
    expect(parseScoutUnused('[{"month":"2026-09","reason":"7. その他の理由","remarks":"運用開始直後"},{"month":"2026-08","reason":null,"remarks":null}]')).toEqual([
      { month: '2026-09', reason: '7. その他の理由', remarks: '運用開始直後', source: 'sheet' },
      { month: '2026-08', reason: null, remarks: null, source: 'sheet' },
    ]);
    expect(parseScoutUnused('[]')).toEqual([]);
    expect(parseScoutUnused(null)).toEqual([]);
    expect(parseScoutUnused('not json')).toEqual([]);
    expect(parseScoutUnused('[{"x":1}]')).toEqual([]);
  });
});
