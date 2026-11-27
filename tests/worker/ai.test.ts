import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { baseEnv, googleEnv, ctx } from '../helpers/env';
import { sessionCookie } from '../helpers/login';
import { createFakeD1 } from '../helpers/fakeD1';
import { installFakeCache, uninstallFakeCache } from '../helpers/fakeCache';
import { ACCESS_TOKEN, client, ENGINES, jobInput, prodEnv, scoutInput, scoutReviewInput, stubVertex, TEST_SA_KEY, vertexResponse } from '../helpers/ai';
import { fakeScoutDs } from '../helpers/scoutFake';
import { AI_HISTORY_LIST_MAX, AiCompaniesResponseSchema, AiCompanyDefaultsResponseSchema, AiConfigResponseSchema, AiCreateResponseSchema, AiJobDetailSchema, AiJobListResponseSchema } from '../../src/shared/ai/common';
import { ScoutResultSchema } from '../../src/shared/ai/scout';
import { addMonths, monthOf, todayJst } from '../../src/shared/calendar/periods';
import { collectReportData } from '../../src/worker/ai/report/collect';
import { reportSample } from '../../src/worker/ai/report/sample';
import { ReportResultSchema } from '../../src/shared/ai/report';
import { MockBqClient } from '../../src/worker/bq/mockClient';
import { getRefreshMeta } from '../../src/worker/services/refreshMeta';
import { aiOccupationOptionsQuery } from '../../src/worker/sql/ai';
import { _resetVertexAuth, callVertexJson, S, scoutEngines, VertexError, vertexConfigured } from '../../src/worker/ai/vertex';
import { ALLOWED_HOSTS } from '../../src/worker/lib/safeFetch';
import app from '../../src/worker/index';
import type { Env } from '../../src/worker/env';

// サンプルデータではない環境（BQ_MOCK=0）でも BigQuery を呼ばないよう、クライアントだけフィクスチャに差し替える
vi.mock('../../src/worker/services/clients', async () => {
  const { MockBqClient } = await import('../../src/worker/bq/mockClient');
  return { makeClient: () => new MockBqClient() };
});
// ② スカウトの分析データ（BigQuery のマート）は、偽物に差し替える
vi.mock('../../src/worker/ai/scout/bqDataSource', async () => {
  const { fakeScoutDs } = await import('../helpers/scoutFake');
  return { makeScoutDataSource: () => fakeScoutDs };
});

const month = monthOf(todayJst());

describe('AI 機能の API（/api/ai/*・/api/companies/:id/ai/jobs）', () => {
  let env: Env;
  let d1: ReturnType<typeof createFakeD1>;
  let cookie: string;
  let adminCookie: string;
  let id: string;
  let name: string;
  const api = client(() => env, () => cookie);
  const audit = () => d1.raw.prepare("SELECT actor_email, action, after_json FROM audit_log WHERE entity = 'ai_jobs' ORDER BY id").all() as { actor_email: string; action: string; after_json: string | null }[];
  const count = (table = 'ai_jobs') => (d1.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  beforeAll(async () => {
    installFakeCache();
    cookie = await sessionCookie('cs@daijob.com');
    adminCookie = await sessionCookie('admin@daijob.com');
  });
  afterAll(() => uninstallFakeCache());
  beforeEach(async () => {
    d1 = createFakeD1();
    fakeScoutDs.reset();
    _resetVertexAuth();
    env = prodEnv(d1, { AI_ADMIN_EMAILS: 'admin@daijob.com' });
    const list = AiCompaniesResponseSchema.parse(await (await api.get('/api/ai/companies')).json());
    expect(list.companies.length).toBeGreaterThan(5);
    ({ id, name } = list.companies[0]!);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('設定: 真偽値だけを返し、鍵の値を出さない。機能ごとの可否。health にも診断だけ', async () => {
    const res = await api.get('/api/ai/config');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const text = await res.text();
    expect(AiConfigResponseSchema.parse(JSON.parse(text))).toEqual({ fireConfigured: true, storeConfigured: true, sampleMode: false, canWrite: true, admin: false, features: { scout: true, job: false, report: false } });
    expect(text).not.toContain('private_key');
    expect(text).not.toContain(ENGINES.a);
    expect(AiConfigResponseSchema.parse(await (await api.get('/api/ai/config', adminCookie)).json()).admin).toBe(true);
    const health = await (await api.get('/api/health')).text();
    expect(JSON.parse(health).ai).toEqual({ vertex: true, store: true, admins: 1 });
    expect(health).not.toContain('PRIVATE KEY');
    expect(health).not.toContain(ENGINES.insight);
    // 鍵は BQ_SA_KEY でもよい。生成モデルの ID が 1 つでも欠ける・形が違うと「設定なし」
    expect(vertexConfigured({ ...env, VERTEX_SA_KEY: undefined, BQ_SA_KEY: TEST_SA_KEY })).toBe(true);
    expect(vertexConfigured({ ...env, VERTEX_SA_KEY: undefined })).toBe(false);
    expect(vertexConfigured({ ...env, AI_SCOUT_ENGINES: 'a=eng-a,b=eng-b' })).toBe(false);
    expect(vertexConfigured({ ...env, AI_SCOUT_ENGINES: 'a=eng-a,b=eng-b,c=../x' })).toBe(false);
    expect(vertexConfigured({ ...env, AI_INSIGHT_ENGINE: 'Bad Engine' })).toBe(false);
    expect(scoutEngines(env)).toEqual({ a: ENGINES.a, b: ENGINES.b, c: ENGINES.c });
    env = { ...baseEnv };
    expect(AiConfigResponseSchema.parse(await (await api.get('/api/ai/config', '')).json())).toMatchObject({ fireConfigured: false, storeConfigured: false, sampleMode: true, canWrite: false, admin: false });
    expect(JSON.parse(await (await api.get('/api/health', '')).text()).ai).toEqual({ vertex: false, store: false, admins: 0 });
  });

  it('企業の選択肢と、企業を選んだときの初期値（業界・掲載職種・求人・選択肢）。無い企業は 404', async () => {
    const d = AiCompanyDefaultsResponseSchema.parse(await (await api.get(`/api/ai/companies/${id}/defaults`)).json());
    expect(d.companyId).toBe(id);
    expect(d.industryOptions.length).toBeGreaterThan(1);
    expect(d.occupationOptions).toContain('営業');
    expect(new Set(d.occupationOptions).size).toBe(d.occupationOptions.length);
    expect(d.occupations.length).toBeLessThanOrEqual(5);
    for (const j of d.jobs) expect(j.jobKey).not.toBe('direct');
    expect((await api.get('/api/ai/companies/999999999/defaults')).status).toBe(404);
    expect((await api.get('/api/ai/companies/abc/defaults')).status).toBe(404);
  });

  it('職種の選択肢の SQL は cms_* だけを読み、値は @param', () => {
    const q = aiOccupationOptionsQuery('2026-06-01');
    expect(Array.from(q.sql.matchAll(/`bq-hgt\.dwh\.([a-z_]+)`/g)).map((m) => m[1])).toEqual(['cms_company_job_monthly']);
    expect(q.sql).not.toMatch(/'\d{4}-\d{2}/);
    expect(q.params.map((p) => p.name)).toEqual(['from']);
  });

  it('③ 求人・① 分析レポートは準備中: 409 notReady（サンプルデータでも）。保存しない・Vertex AI を呼ばない', async () => {
    const v = stubVertex();
    for (const body of [{ kind: 'job', input: jobInput() }, { kind: 'report', input: { from: month, to: month } }]) {
      const res = await api.post(`/api/companies/${id}/ai/jobs`, body);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'notReady', error: 'この機能は準備中です' });
    }
    env = { ...baseEnv, CMS_DB: d1 as unknown as D1Database };
    expect((await api.post(`/api/companies/${id}/ai/jobs`, { kind: 'job', input: jobInput() }, '')).status).toBe(409);
    expect(count()).toBe(0);
    expect(v.calls).toHaveLength(0);
    // 後の段階で使うコードは残してある（見本・① の数値の収集）
    expect(ReportResultSchema.safeParse(reportSample({ from: month, to: month, account: '直接', note: '' })).success).toBe(true);
    const mock = new MockBqClient();
    const refresh = await getRefreshMeta(mock);
    const all = (await collectReportData(mock, id, { from: month, to: month, account: null, note: '' }, refresh))!;
    const direct = (await collectReportData(mock, id, { from: month, to: month, account: '直接', note: '' }, refresh))!;
    expect(direct.totals.sent).toBeLessThanOrEqual(all.totals.sent);
    expect((await collectReportData(mock, id, { from: addMonths(month, -13), to: month, account: null, note: '' }, refresh))!.previous).toBeNull();
    expect(await collectReportData(mock, '999999999', { from: month, to: month, account: null, note: '' }, refresh)).toBeNull();
  });

  it('サンプルデータ: Vertex AI を呼ばず見本（3 案）を返す。Google ログイン済みは保存し、仮の利用者は保存しない。見本には記録できない', async () => {
    const v = stubVertex();
    env = { ...googleEnv, CMS_DB: d1 as unknown as D1Database };
    const saved = AiCreateResponseSchema.parse(await (await api.post(`/api/companies/${id}/ai/jobs`, { kind: 'scout', input: scoutReviewInput() })).json());
    expect(saved).toMatchObject({ fire: 'sample', fireMessage: null, job: { status: 'done', sample: true, kind: 'scout', sessionUrl: null } });
    const result = ScoutResultSchema.parse(saved.job.result);
    expect(result.drafts.map((x) => x.modelId)).toEqual(['a', 'b', 'c']);
    expect(result.drafts.every((x) => x.changes.length > 0 && x.feedback === null)).toBe(true);
    expect(result.summary).toContain('見本');
    expect(JSON.stringify(result)).not.toContain(name);
    expect(ScoutResultSchema.parse(AiCreateResponseSchema.parse(await (await api.post(`/api/companies/${id}/ai/jobs`, { kind: 'scout', input: scoutInput() })).json()).job.result).drafts.every((x) => x.changes.length === 0)).toBe(true);
    expect(count()).toBe(2);
    expect(count('ai_scout_drafts')).toBe(0);
    expect((await api.put(`/api/ai/jobs/${saved.job.id}/scout/choice`, { draftId: result.drafts[0]!.draftId })).status).toBe(409);
    // 仮の利用者（Google 未設定）→ 201 だが保存しない。ほかの書き込みはできない
    env = { ...baseEnv, CMS_DB: d1 as unknown as D1Database };
    const preview = AiCreateResponseSchema.parse(await (await api.post(`/api/companies/${id}/ai/jobs`, { kind: 'scout', input: scoutInput() }, '')).json());
    expect(preview).toMatchObject({ fire: 'sample', job: { status: 'done', sample: true } });
    expect(count()).toBe(2);
    expect((await api.get(`/api/ai/jobs/${preview.job.id}`, '')).status).toBe(404);
    expect((await api.del(`/api/ai/jobs/${saved.job.id}`, '')).status).toBe(403);
    expect((await api.put(`/api/ai/jobs/${saved.job.id}/scout/choice`, { draftId: null }, '')).status).toBe(403);
    expect((await api.post('/api/ai/scout/tune', {}, '')).status).toBe(403);
    expect(v.calls).toHaveLength(0);
    expect(fakeScoutDs.calls.benchmark).toHaveLength(0);
  });

  it('検証: 未知のキー・kind、社名と個人情報（400・保存しない）、無い企業（404）、同一オリジン、未ログイン', async () => {
    const v = stubVertex();
    const post = (body: unknown, company = id) => api.post(`/api/companies/${company}/ai/jobs`, body);
    expect((await post({ kind: 'scout', input: scoutInput(), companyId: '1' })).status).toBe(400);
    expect((await post({ kind: 'other', input: {} })).status).toBe(400);
    expect((await post({ kind: 'scout', input: scoutInput({ extra: 1 }) })).status).toBe(400);
    expect((await post({ kind: 'scout', input: scoutInput({ filters: { ageGroups: ['30代'], other: [] } }) })).status).toBe(400);
    const noBody = await post({ kind: 'scout', input: scoutReviewInput({ body: '' }) });
    expect(noBody.status).toBe(400);
    expect(((await noBody.json()) as { details: { path: string }[] }).details.map((d) => d.path)).toContain('input.body');
    const mail = await post({ kind: 'scout', input: scoutReviewInput({ body: '連絡先は taro@example.com です' }) });
    expect(mail.status).toBe(400);
    expect(((await mail.json()) as { details: { path: string }[] }).details[0]).toMatchObject({ path: 'input.body' });
    expect((await post({ kind: 'scout', input: scoutInput({ note: '電話は 03-1234-5678' }) })).status).toBe(400);
    const named = await post({ kind: 'scout', input: scoutInput({ note: `${name} の魅力を伝えたい` }) });
    expect(named.status).toBe(400);
    expect(JSON.stringify(await named.json())).toContain('企業名が入っています');
    expect((await post({ kind: 'scout', input: scoutInput() }, '999999999')).status).toBe(404);
    expect((await post({ kind: 'scout', input: scoutInput() }, 'abc')).status).toBe(404);
    expect(count()).toBe(0);
    expect(v.calls).toHaveLength(0);
    // 同一オリジンでなければ 403、未ログインは 401
    const cross = await app.fetch(new Request(`http://x/api/companies/${id}/ai/jobs`, { method: 'POST', headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'scout', input: scoutInput() }) }), env, ctx);
    expect(cross.status).toBe(403);
    expect((await post({ kind: 'scout', input: scoutInput() })).status).toBe(201);
    expect((await api.post(`/api/companies/${id}/ai/jobs`, { kind: 'scout', input: scoutInput() }, '')).status).toBe(401);
    for (const p of ['/api/ai/config', '/api/ai/companies', `/api/ai/jobs?company=${id}&kind=scout`, '/api/ai/jobs/zzzzzzzzzzzzzzzzzzzz', '/api/ai/scout/options', '/api/ai/scout/models']) expect((await api.get(p, '')).status, p).toBe(401);
    expect((await api.put('/api/ai/jobs/zzzzzzzzzzzzzzzzzzzz/scout/choice', { draftId: null }, '')).status).toBe(401);
    expect((await api.post('/api/ai/scout/tune', {}, '')).status).toBe(401);
  });

  it('ログインの外の入口が無い: /hook/ は未ログインで 401、ログイン済みでも 404（以前のセッション用の入口は無い）', async () => {
    const hook = (path: string, c: string, method = 'GET') => app.fetch(new Request(`http://x${path}`, { method, headers: { ...(c ? { cookie: c } : {}), authorization: `Bearer ${'f'.repeat(64)}`, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) }), env, ctx);
    expect((await hook('/hook/ai/jobs/abcdefghij0123456789/context', '')).status).toBe(401);
    expect((await hook('/hook/ai/jobs/abcdefghij0123456789/result', '', 'POST')).status).toBe(401);
    expect((await hook('/hook/ai/jobs/abcdefghij0123456789/context', cookie)).status).toBe(404);
    expect((await hook('/hook/ai/jobs/abcdefghij0123456789/result', cookie, 'POST')).status).toBe(404);
    expect((await api.post('/api/ai/jobs/abcdefghij0123456789/fire', {})).status).toBe(404);
    expect(ALLOWED_HOSTS.has('aiplatform.googleapis.com')).toBe(true);
    expect(ALLOWED_HOSTS.has('api.anthropic.com')).toBe(false);
  });

  it('D1 が無い: 作成は 503、一覧は空、1 件は 404、モデルは初版だけ', async () => {
    env = { ...env, CMS_DB: undefined };
    const res = await api.post(`/api/companies/${id}/ai/jobs`, { kind: 'scout', input: scoutInput() });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'storage' });
    expect(AiJobListResponseSchema.parse(await (await api.get(`/api/ai/jobs?company=${id}&kind=scout`)).json()).jobs).toEqual([]);
    expect((await api.get('/api/ai/jobs/zzzzzzzzzzzzzzzzzzzz')).status).toBe(404);
    expect(((await (await api.get('/api/ai/scout/models')).json()) as { models: unknown[] }).models).toHaveLength(3);
  });

  it('一覧（企業 × 機能・新しい順・結果の本体なし）、削除。以前のセッション方式で残った running は期限切れとして読む', async () => {
    stubVertex();
    const mk = async (input: unknown) => AiCreateResponseSchema.parse(await (await api.post(`/api/companies/${id}/ai/jobs`, { kind: 'scout', input })).json()).job;
    const a = await mk(scoutReviewInput());
    await new Promise((r) => setTimeout(r, 5));
    const b = await mk(scoutInput());
    const listText = await (await api.get(`/api/ai/jobs?company=${id}&kind=scout`)).text();
    const list = AiJobListResponseSchema.parse(JSON.parse(listText));
    expect(list.jobs.map((j) => j.id)).toEqual([b.id, a.id]);
    expect(list.jobs[0]).toMatchObject({ title: '作成: 法人営業', edited: false, sample: false, status: 'done' });
    expect(list.jobs[1]!.title).toBe('添削: 【営業職】ご経験を拝見しました');
    expect(list.jobs[0]!.summary).toContain('412 件');
    expect(listText).not.toContain('drafts');
    expect(AI_HISTORY_LIST_MAX).toBe(30);
    expect((await api.get(`/api/ai/jobs?company=${id}`)).status).toBe(400);
    expect((await api.get(`/api/ai/jobs?company=${id}&kind=scout&x=1`)).status).toBe(400);
    expect(AiJobListResponseSchema.parse(await (await api.get(`/api/ai/jobs?company=${id}&kind=job`)).json()).jobs).toEqual([]);
    expect((await api.del(`/api/ai/jobs/${a.id}`)).status).toBe(204);
    expect((await api.get(`/api/ai/jobs/${a.id}`)).status).toBe(404);
    expect((await api.del(`/api/ai/jobs/${a.id}`)).status).toBe(404);
    expect(audit().map((x) => x.action)).toEqual(['create', 'create', 'delete']);
    d1.raw.prepare("INSERT INTO ai_jobs (id, kind, company_id, status, title, input_json, created_by, created_at, updated_at, token_expires_at) VALUES ('oldrunningjob0000001', 'report', ?, 'running', '古い依頼', '{}', 'cs@daijob.com', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', '2026-11-20T01:00:00.000Z')").run(Number(id));
    expect(AiJobDetailSchema.parse(await (await api.get('/api/ai/jobs/oldrunningjob0000001')).json())).toMatchObject({ status: 'failed', error: '時間内に結果が返りませんでした（期限切れ）', sessionUrl: null });
  });
});

describe('Vertex AI の呼び出し（callVertexJson）', () => {
  const env = prodEnv(createFakeD1());
  const req = { engine: ENGINES.a, system: 's', user: 'u', schema: z.object({ x: z.string().min(1) }), responseSchema: S.obj({ x: S.str() }), maxOutputTokens: 100, temperature: 0 };
  beforeEach(() => _resetVertexAuth());
  afterEach(() => vi.unstubAllGlobals());

  it('宛先・認証・本文の形。アクセストークンは使い回す（取得は 1 回）。思考を抑える設定を付ける', async () => {
    const v = stubVertex(() => vertexResponse({ x: 'ok' }, { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 2 }));
    const out = await callVertexJson(env, req);
    expect(out.data).toEqual({ x: 'ok' });
    expect(out.tokens).toEqual({ in: 10, out: 5, think: 2 });
    await callVertexJson(env, { ...req, thinking: 'low' });
    expect(v.tokenCalls.n).toBe(1);
    expect(v.calls[0]).toMatchObject({ url: `https://aiplatform.googleapis.com/v1/projects/bq-hgt/locations/global/publishers/google/models/${ENGINES.a}:generateContent`, authorization: `Bearer ${ACCESS_TOKEN}`, system: 's', user: 'u' });
    expect(v.calls[0]!.config).toMatchObject({ maxOutputTokens: 100, temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } });
    expect(v.calls[1]!.config.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    expect(v.other).toEqual([]);
  });

  it('JSON として読めない・形が違うときは 1 回だけやり直す。それでも駄目ならエラー（鍵・トークン・応答の本文を出さない）', async () => {
    let n = 0;
    const v = stubVertex(() => (n++ === 0 ? vertexResponse('これは JSON ではありません') : vertexResponse('```json\n{"x":"2 回目"}\n```')));
    const out = await callVertexJson(env, req);
    expect(out.data).toEqual({ x: '2 回目' });
    expect(out.tokens.in).toBe(2000);
    expect(v.calls).toHaveLength(2);
    const bad = stubVertex(() => vertexResponse({ x: '' }));
    const err = await callVertexJson(env, req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VertexError);
    expect((err as VertexError).reason).toBe('parse');
    expect(bad.calls).toHaveLength(2);
    stubVertex(() => new Response(JSON.stringify({ error: { message: `denied ${ACCESS_TOKEN} PRIVATE KEY` } }), { status: 403 }));
    const denied = (await callVertexJson(env, req).catch((e: unknown) => e)) as VertexError;
    expect(denied).toMatchObject({ reason: 'http', status: 403 });
    expect(denied.message).toBe('Vertex AI がエラーを返しました（HTTP 403）');
    expect(JSON.stringify({ m: denied.message })).not.toContain(ACCESS_TOKEN);
  });

  it('429 / 5xx は 1 回だけやり直す。思考の設定を受け付けない（400）ときは、設定を外してやり直す。設定なしは呼ばない', async () => {
    let n = 0;
    const v = stubVertex(() => (n++ === 0 ? new Response('busy', { status: 503 }) : vertexResponse({ x: 'ok' })));
    expect((await callVertexJson(env, req)).data).toEqual({ x: 'ok' });
    expect(v.calls).toHaveLength(2);
    const t = stubVertex((c) => (c.config.thinkingConfig ? new Response('{}', { status: 400 }) : vertexResponse({ x: 'no-thinking' })));
    expect((await callVertexJson(env, req)).data).toEqual({ x: 'no-thinking' });
    expect(t.calls.map((c) => Boolean(c.config.thinkingConfig))).toEqual([true, false]);
    const none = stubVertex();
    await expect(callVertexJson({ ...env, VERTEX_SA_KEY: undefined }, req)).rejects.toMatchObject({ reason: 'config' });
    await expect(callVertexJson(env, { ...req, engine: 'Bad/Engine' })).rejects.toMatchObject({ reason: 'config' });
    await expect(callVertexJson({ ...env, VERTEX_SA_KEY: 'not json' }, req)).rejects.toMatchObject({ reason: 'config' });
    expect(none.calls).toHaveLength(0);
    // 許可リストの外へは出ない（location に別のホストを入れても、宛先は aiplatform.googleapis.com に固定）
    expect(vertexConfigured({ ...env, VERTEX_LOCATION: 'evil.example/x' })).toBe(false);
  });
});
