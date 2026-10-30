import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/worker/index';
import { baseEnv, ctx } from '../helpers/env';
import { installFakeCache, uninstallFakeCache } from '../helpers/fakeCache';
import { parseScoutUnused } from '../../src/worker/services/companyService';
import { AttributesResponseSchema, CompanyDetailResponseSchema } from '../../src/shared/schema/company';
import { BoardResponseSchema } from '../../src/shared/schema/board';
import { addMonths, monthOf, todayJst } from '../../src/shared/calendar/periods';
import { ATTRIBUTE_TYPES } from '../../src/shared/labels';
import { parseAccounts, parseJobs } from '../../src/worker/services/companyService';

describe('/api/companies/:id（モック）', () => {
  beforeAll(() => installFakeCache());
  afterAll(() => uninstallFakeCache());
  const get = (path: string, env = baseEnv) => app.fetch(new Request(`http://x/api/companies/${path}`), env, ctx);

  it('存在する企業: マスタ・14 か月・日次累積・コホート・アカウント別月次・求人一覧・ベンチマーク系列。属性は含まない。2 回目はキャッシュ', async () => {
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
    // 属性の内訳は詳細本体に含めない（期間・アカウントごとに /attributes で取る）
    expect('attributes' in body).toBe(false);
    // アカウント種別（1 つ以上）とその月次、窓に掛かる求人の一覧
    expect(body.accounts.length).toBeGreaterThanOrEqual(1);
    for (const a of body.accounts) expect(a.profiles.length).toBeGreaterThan(0);
    expect(new Set(body.accountMonthly.map((r) => r.account))).toEqual(new Set(body.accounts.map((a) => a.type)));
    for (const ym of body.monthly.map((m) => m.month)) {
      const rows = body.accountMonthly.filter((r) => r.month === ym);
      const all = body.monthly.find((m) => m.month === ym)!;
      expect(rows.reduce((s, r) => s + r.sent, 0)).toBe(all.sent);
      expect(rows.reduce((s, r) => s + r.views, 0)).toBe(all.views);
    }
    expect(Array.isArray(body.jobs)).toBe(true);
    for (const j of body.jobs) expect(j.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof body.extra.jobsWindowDistinct).toBe('number');
    expect(new Set(body.jobs.map((j) => j.key)).size).toBe(body.extra.jobsWindowDistinct);
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

  it('/attributes: 期間とアカウント種別で集約した内訳。kind に scout / view / application、全体 = 各アカウントの合計。逆順・窓外・不明なアカウントは 400', async () => {
    const board = BoardResponseSchema.parse(await (await app.fetch(new Request('http://x/api/board'), baseEnv, ctx)).json());
    const multi = board.companies.find((c) => c.accountTypes.length > 1)!;
    expect(multi).toBeTruthy();
    const cur = monthOf(todayJst());
    const from = addMonths(cur, -2);
    const res = await get(`${multi.id}/attributes?from=${from}&to=${cur}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
    const all = AttributesResponseSchema.parse(await res.json());
    expect(all).toMatchObject({ from, to: cur, account: null });
    for (const t of ATTRIBUTE_TYPES) expect(all.rows.some((r) => r.type === t), t).toBe(true);
    for (const k of ['scout', 'view', 'application']) expect(all.rows.some((r) => r.kind === k), k).toBe(true);
    expect(all.rows.filter((r) => r.kind !== 'scout').every((r) => r.interested === 0)).toBe(true);
    const sum = (rows: typeof all.rows) => rows.reduce((s, r) => s + r.count, 0);
    const parts = await Promise.all(multi.accountTypes.map(async (a) => AttributesResponseSchema.parse(await (await get(`${multi.id}/attributes?from=${from}&to=${cur}&account=${encodeURIComponent(a)}`)).json())));
    expect(parts.map((p) => p.account)).toEqual(multi.accountTypes);
    expect(Math.abs(parts.reduce((s, p) => s + sum(p.rows), 0) - sum(all.rows))).toBeLessThanOrEqual(all.rows.length);
    expect(sum(parts[0].rows)).toBeGreaterThan(0);
    expect(sum(parts[0].rows)).toBeLessThan(sum(all.rows));
    // 期間を狭めると件数が減る
    const narrow = AttributesResponseSchema.parse(await (await get(`${multi.id}/attributes?from=${cur}&to=${cur}`)).json());
    expect(sum(narrow.rows)).toBeLessThan(sum(all.rows));
    expect((await get(`${multi.id}/attributes?from=${from}&to=${cur}`)).headers.get('x-cache')).toBe('HIT');
    expect((await get(`${multi.id}/attributes?from=${cur}&to=${from}`)).status).toBe(400);
    expect((await get(`${multi.id}/attributes?from=2020-01&to=${cur}`)).status).toBe(400);
    expect((await get(`${multi.id}/attributes?from=${from}&to=${cur}&account=DA`)).status).toBe(400);
    expect((await get(`${multi.id}/attributes?from=${from}`)).status).toBe(400);
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

describe('parseAccounts / parseJobs', () => {
  it('accounts_json を種別ごとにまとめ、jobs_json を求人の一覧にする。壊れた JSON は空', () => {
    expect(parseAccounts('[{"type":"直接","profile_id":1,"profile_name":"A","language":"日"},{"type":"直接","profile_id":2,"profile_name":"A EN","language":"英"},{"type":"紹介","profile_id":3,"profile_name":"A","language":"日"}]')).toEqual([
      { type: '直接', profiles: [{ id: '1', name: 'A', lang: '日' }, { id: '2', name: 'A EN', lang: '英' }] },
      { type: '紹介', profiles: [{ id: '3', name: 'A', lang: '日' }] },
    ]);
    expect(parseAccounts('[]')).toEqual([]);
    expect(parseAccounts('x')).toEqual([]);
    expect(parseJobs('[{"a":"直接","k":10,"s":"2026-01-05","e":null},{"a":"紹介","k":11,"s":"2025-12-01","e":"2026-02-28"}]')).toEqual([
      { account: '直接', key: '10', from: '2026-01-05', to: null },
      { account: '紹介', key: '11', from: '2025-12-01', to: '2026-02-28' },
    ]);
    expect(parseJobs(null)).toEqual([]);
    expect(parseJobs('[{"k":1}]')).toEqual([]);
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
