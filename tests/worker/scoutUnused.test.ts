import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/worker/index';
import { baseEnv, ctx, googleEnv } from '../helpers/env';
import { jsonHeaders, sessionCookie } from '../helpers/login';
import { createFakeD1 } from '../helpers/fakeD1';
import { installFakeCache, uninstallFakeCache } from '../helpers/fakeCache';
import { BoardResponseSchema } from '../../src/shared/schema/board';
import { CompanyDetailResponseSchema } from '../../src/shared/schema/company';
import { ScoutUnusedMonthResponseSchema, ScoutUnusedSaveResponseSchema, ScoutUnusedSyncResponseSchema } from '../../src/shared/schema/scoutUnused';
import { SCOUT_UNUSED_REASONS } from '../../src/shared/labels';
import { addMonths, monthOf, todayJst } from '../../src/shared/calendar/periods';
import { ScoutUnusedRepo } from '../../src/worker/d1/scoutUnusedRepo';
import { overlayScoutUnused, syncOne } from '../../src/worker/services/scoutUnusedService';
import { scoutUnusedMergeQuery } from '../../src/worker/sql/scoutUnused';
import type { BqClient } from '../../src/worker/bq/client';
import type { Env } from '../../src/worker/env';

describe('/api/scout-unused（スカウト未利用の理由・補足）', () => {
  let env: Env;
  let d1: ReturnType<typeof createFakeD1>;
  let cookie: string;
  let id: string;
  const month = addMonths(monthOf(todayJst()), -1);
  beforeAll(async () => {
    installFakeCache();
    cookie = await sessionCookie('cs@daijob.com');
  });
  afterAll(() => uninstallFakeCache());
  beforeEach(async () => {
    d1 = createFakeD1();
    env = { ...googleEnv, CMS_DB: d1 as unknown as D1Database };
    const board = BoardResponseSchema.parse(await (await app.fetch(new Request(`http://x/api/board?month=${month}`, { headers: { cookie } }), env, ctx)).json());
    id = board.companies.find((c) => c.limits.scout)!.id;
  });
  const put = (path: string, body: unknown, c = cookie) => app.fetch(new Request(`http://x/api${path}`, { method: 'PUT', headers: jsonHeaders({ cookie: c }), body: JSON.stringify(body) }), env, ctx);
  const del = (path: string) => app.fetch(new Request(`http://x/api${path}`, { method: 'DELETE', headers: jsonHeaders({ cookie }) }), env, ctx);
  const post = (path: string) => app.fetch(new Request(`http://x/api${path}`, { method: 'POST', headers: jsonHeaders({ cookie }), body: '{}' }), env, ctx);
  const get = (path: string) => app.fetch(new Request(`http://x/api${path}`, { headers: { cookie } }), env, ctx);

  it('登録 → D1 の行 + 監査ログ、月の一覧、企業ページに即時反映（source = app）、削除で消える', async () => {
    const r = await put(`/scout-unused/${id}/${month}`, { reason: SCOUT_UNUSED_REASONS[1], remarks: ' 先方事情 ' });
    expect(r.status).toBe(201);
    const saved = ScoutUnusedSaveResponseSchema.parse(await r.json());
    expect(saved.entry).toMatchObject({ companyId: id, month, reason: '7. その他の理由', remarks: '先方事情', updatedBy: 'cs@daijob.com' });
    expect(saved.bq).toEqual({ synced: true, error: null });
    expect(saved.entry?.bqSyncedAt).toBeTruthy();
    expect(d1.raw.prepare('SELECT COUNT(*) AS n FROM scout_unused_entries').get()).toEqual({ n: 1 });
    expect(d1.raw.prepare("SELECT action, entity, entity_id FROM audit_log WHERE entity = 'scout_unused_entries'").all()).toEqual([{ action: 'create', entity: 'scout_unused_entries', entity_id: `${id}:${month}` }]);
    // 更新 → 200・update
    const r2 = await put(`/scout-unused/${id}/${month}`, { reason: SCOUT_UNUSED_REASONS[0], remarks: null });
    expect(r2.status).toBe(200);
    const list = ScoutUnusedMonthResponseSchema.parse(await (await get(`/scout-unused?month=${month}`)).json());
    expect(list.month).toBe(month);
    expect(list.entries).toHaveLength(1);
    expect(list.entries[0]).toMatchObject({ companyId: id, reason: '8. どうしても連絡つかず不明', remarks: null });
    // 企業ページ: マートの記録に D1 を重ねる（同じ月はアプリ優先）
    const detail = CompanyDetailResponseSchema.parse(await (await get(`/companies/${id}?month=${month}`)).json());
    const hit = detail.scoutUnused.find((x) => x.month === month);
    expect(hit).toEqual({ month, reason: '8. どうしても連絡つかず不明', remarks: null, source: 'app' });
    expect(detail.scoutUnused.filter((x) => x.month === month)).toHaveLength(1);
    // 削除 → 一覧から消え、監査に delete
    const r3 = await del(`/scout-unused/${id}/${month}`);
    expect(r3.status).toBe(200);
    expect(ScoutUnusedMonthResponseSchema.parse(await (await get(`/scout-unused?month=${month}`)).json()).entries).toHaveLength(0);
    expect(d1.raw.prepare("SELECT action FROM audit_log WHERE entity = 'scout_unused_entries' ORDER BY id").all().map((x) => (x as { action: string }).action)).toEqual(['create', 'update', 'delete']);
    expect((await del(`/scout-unused/${id}/${month}`)).status).toBe(404);
    const after = CompanyDetailResponseSchema.parse(await (await get(`/companies/${id}?month=${month}`)).json());
    expect(after.scoutUnused.some((x) => x.month === month && x.source === 'app')).toBe(false);
  });

  it('検証: 理由は 8 件の定型文だけ、補足は 500 文字まで、両方空は 400、未知のキーは 400、範囲外の月は 400、無い企業は 404', async () => {
    expect((await put(`/scout-unused/${id}/${month}`, { reason: '9. 自由入力', remarks: null })).status).toBe(400);
    expect((await put(`/scout-unused/${id}/${month}`, { reason: null, remarks: 'x'.repeat(501) })).status).toBe(400);
    const empty = await put(`/scout-unused/${id}/${month}`, { reason: null, remarks: '' });
    expect(empty.status).toBe(400);
    expect((await put(`/scout-unused/${id}/${month}`, { reason: null, remarks: 'a', companyId: '1' })).status).toBe(400);
    expect((await put(`/scout-unused/${id}/2020-01`, { reason: null, remarks: 'a' })).status).toBe(400);
    expect((await put(`/scout-unused/999999999/${month}`, { reason: null, remarks: 'a' })).status).toBe(404);
    expect((await put(`/scout-unused/abc/${month}`, { reason: null, remarks: 'a' })).status).toBe(404);
    expect(d1.raw.prepare('SELECT COUNT(*) AS n FROM scout_unused_entries').get()).toEqual({ n: 0 });
  });

  it('未ログイン / モック identity の書き込みは拒否、閲覧（GET）は通る。D1 無しの GET は空', async () => {
    expect((await app.fetch(new Request(`http://x/api/scout-unused/${id}/${month}`, { method: 'PUT', headers: jsonHeaders(), body: '{"remarks":"a"}' }), env, ctx)).status).toBe(401);
    const mockEnv: Env = { ...baseEnv, CMS_DB: d1 as unknown as D1Database };
    expect((await app.fetch(new Request(`http://x/api/scout-unused/${id}/${month}`, { method: 'PUT', headers: jsonHeaders(), body: '{"remarks":"a"}' }), mockEnv, ctx)).status).toBe(403);
    expect((await get(`/scout-unused?month=${month}`)).status).toBe(200);
    const noDb = await app.fetch(new Request(`http://x/api/scout-unused?month=${month}`, { headers: { cookie } }), googleEnv, ctx);
    expect(ScoutUnusedMonthResponseSchema.parse(await noDb.json()).entries).toEqual([]);
  });

  it('BQ への書き込みに失敗しても D1 は残り、未反映として再同期できる', async () => {
    await put(`/scout-unused/${id}/${month}`, { reason: null, remarks: '補足' });
    const repo = new ScoutUnusedRepo(d1);
    const row = (await repo.get(id, month))!;
    const failing = { mock: false, run: async () => { throw new Error('Access Denied: scout_unused_companies_monthly'); }, dryRun: async () => ({ bytesProcessed: 0 }) } as unknown as BqClient;
    const r = await syncOne(failing, d1, row, { salesRep: null, companyName: null });
    expect(r.synced).toBe(false);
    expect(r.error).toContain('Access Denied');
    expect((await repo.get(id, month))!.bq_error).toContain('Access Denied');
    // 未同期にする（同期後に更新された扱い）
    d1.raw.prepare('UPDATE scout_unused_entries SET bq_synced_at = NULL').run();
    expect(await repo.countUnsynced()).toBe(1);
    const sync = ScoutUnusedSyncResponseSchema.parse(await (await post('/scout-unused/sync')).json());
    expect(sync).toEqual({ synced: 1, failed: 0, pending: 0 });
    // 成功する擬似クライアントは MERGE を @param だけで組み立てた SQL を受け取る
    const seen: string[] = [];
    const ok = { mock: false, run: async (q: { sql: string; params: { name: string }[] }) => { seen.push(q.sql); expect(q.params.map((p) => p.name).sort()).toEqual(['companyName', 'deleted', 'id', 'month', 'reason', 'remarks', 'salesRep']); return { rows: [], bytesProcessed: 0, cacheHit: false, jobId: null }; }, dryRun: async () => ({ bytesProcessed: 0 }) } as unknown as BqClient;
    expect((await syncOne(ok, d1, (await repo.get(id, month))!, { salesRep: 'Tanabe Mami', companyName: 'X' })).synced).toBe(true);
    expect(seen[0]).toContain('MERGE `bq-hgt.dwh.scout_unused_companies_monthly`');
    expect(seen[0]).toContain("T.match_method = 'app'");
    expect(seen[0]).toContain('WHEN MATCHED AND @deleted THEN DELETE');
    expect(seen[0]).not.toMatch(/補足|Tanabe/);
    const q = scoutUnusedMergeQuery({ companyId: '1', month: '2026-09', reason: null, remarks: 'a', salesRep: null, companyName: null, updatedBy: 'x@daijob.com', deleted: false });
    expect(q.params.find((p) => p.name === 'month')?.parameterValue.value).toBe('2026-09-01');
  });

  it('overlayScoutUnused: 同じ月はアプリ優先、削除した月の古いアプリ行は隠す、シートの行は残る', () => {
    const mart = JSON.stringify([
      { month: '2026-09', reason: 'シートの理由', remarks: null, source: 'sheet' },
      { month: '2026-08', reason: '古いアプリ', remarks: null, source: 'app' },
      { month: '2026-07', reason: 'シート 7 月', remarks: 'r', source: 'sheet' },
    ]);
    const base = { created_by: 'a', created_at: 't', updated_by: 'a', updated_at: 't', bq_synced_at: null, bq_error: null };
    const rows = [
      { ...base, company_id: 1, target_month: '2026-09', reason: 'アプリの理由', remarks: '補足', deleted_at: null },
      { ...base, company_id: 1, target_month: '2026-08', reason: null, remarks: null, deleted_at: 't' },
    ];
    expect(overlayScoutUnused(mart, rows)).toEqual([
      { month: '2026-09', reason: 'アプリの理由', remarks: '補足', source: 'app' },
      { month: '2026-07', reason: 'シート 7 月', remarks: 'r', source: 'sheet' },
    ]);
  });
});
