import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionCookie } from '../helpers/login';
import { createFakeD1 } from '../helpers/fakeD1';
import { installFakeCache, uninstallFakeCache } from '../helpers/fakeCache';
import { client, jobInput, parseFireText, prodEnv, scoutInput, stubFire, type FireCall } from '../helpers/ai';
import { AI_HISTORY_FOR_SESSION, AI_RESULT_MAX_BYTES, AiCompaniesResponseSchema, AiCreateResponseSchema, AiJobDetailSchema, AiJobListResponseSchema } from '../../src/shared/ai/common';
import { addMonths, monthOf, todayJst } from '../../src/shared/calendar/periods';
import { scoutSample } from '../../src/worker/ai/scout/sample';
import { reportSample } from '../../src/worker/ai/report/sample';
import { jobSample } from '../../src/worker/ai/job/sample';
import { ScoutInputSchema } from '../../src/shared/ai/scout';
import { JobInputSchema } from '../../src/shared/ai/job';
import { collectReportData, REPORT_DATA_MAX_BYTES, type ReportData } from '../../src/worker/ai/report/collect';
import { MockBqClient } from '../../src/worker/bq/mockClient';
import { getRefreshMeta } from '../../src/worker/services/refreshMeta';
import { EXPIRED_MESSAGE } from '../../src/worker/ai/service';
import type { Env } from '../../src/worker/env';

// サンプルデータではない環境（BQ_MOCK=0）でも BigQuery を呼ばないよう、クライアントだけフィクスチャに差し替える
vi.mock('../../src/worker/services/clients', async () => {
  const { MockBqClient } = await import('../../src/worker/bq/mockClient');
  return { makeClient: () => new MockBqClient() };
});

const month = monthOf(todayJst());

describe('セッションの入口（/hook/ai/jobs/:jobId/{context,result}）', () => {
  let env: Env;
  let d1: ReturnType<typeof createFakeD1>;
  let cookie: string;
  let id: string;
  let name: string;
  let calls: FireCall[];
  const api = client(() => env, () => cookie);
  const create = async (kind: string, input: unknown) => {
    const before = calls.length;
    const job = AiCreateResponseSchema.parse(await (await api.post(`/api/companies/${id}/ai/jobs`, { kind, input })).json()).job;
    expect(job.status).toBe('running');
    return { job, ...parseFireText(calls[before]!.text) };
  };
  const scoutResult = () => scoutSample(ScoutInputSchema.parse(scoutInput()));

  beforeAll(async () => {
    installFakeCache();
    cookie = await sessionCookie('cs@daijob.com');
  });
  afterAll(() => uninstallFakeCache());
  beforeEach(async () => {
    d1 = createFakeD1();
    env = prodEnv(d1);
    calls = stubFire();
    ({ id, name } = AiCompaniesResponseSchema.parse(await (await api.get('/api/ai/companies')).json()).companies[0]!);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('未ログインでも合言葉で通る。違う合言葉・合言葉なし・ほかのジョブの合言葉・無いジョブは一律 401（理由なし）', async () => {
    const a = await create('scout', scoutInput());
    const b = await create('job', jobInput());
    const ok = await api.hookGet(a.context, a.token);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    expect(ok.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const bodies: string[] = [];
    for (const res of [
      await api.hookGet(a.context, null),
      await api.hookGet(a.context, 'f'.repeat(64)),
      await api.hookGet(a.context, 'short'),
      await api.hookGet(a.context, b.token),
      await api.hookGet('http://x/hook/ai/jobs/zzzzzzzzzzzzzzzzzzzz/context', a.token),
      await api.hookGet('http://x/hook/ai/jobs/BAD!/context', a.token),
      await api.hookPost(a.result, 'f'.repeat(64), scoutResult()),
      await api.hookPost(a.result, null, scoutResult()),
    ]) {
      expect(res.status).toBe(401);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toBe(JSON.stringify({ error: 'unauthorized', code: 'unauthorized' }));
    // セッションの Cookie では通らない（合言葉だけ）
    expect((await (await import('../../src/worker/index')).default.fetch(new Request(a.context, { headers: { cookie } }), env, (await import('../helpers/env')).ctx)).status).toBe(401);
    // D1 が無ければ 401
    const saved = env;
    env = { ...env, CMS_DB: undefined };
    expect((await api.hookGet(a.context, a.token)).status).toBe(401);
    env = saved;
  });

  it('/hook/ のほかのパスは 404 で何も返さない（静的アセットへ落とさない）。/api は未ログインで 401 のまま', async () => {
    for (const p of ['http://x/hook/', 'http://x/hook/ai', 'http://x/hook/ai/jobs', 'http://x/hook/ai/jobs/abc', 'http://x/hook/other/x', 'http://x/hook/ai/jobs/zzzzzzzzzzzzzzzzzzzz/input']) {
      const res = await api.hookGet(p, null);
      expect(res.status, p).toBe(404);
      const text = await res.text();
      expect(text, p).not.toContain('<html');
      expect(JSON.parse(text)).toEqual({ error: 'not found', code: 'notFound' });
    }
    expect((await api.get('/api/ai/config', '')).status).toBe(401);
    expect((await api.get('/hook', '')).status).toBe(401);
  });

  it('context: 入力・企業の条件（企業名なし）・過去の結果（直した版を優先・直近 3 件・見本は除く）', async () => {
    // 過去の結果を 4 件作る（結果を返して done に）
    const past: string[] = [];
    for (let i = 0; i < AI_HISTORY_FOR_SESSION + 1; i++) {
      const j = await create('scout', scoutInput({ positionName: `法人営業 ${i}` }));
      expect((await api.hookPost(j.result, j.token, { ...scoutResult(), summary: `要約 ${i}` })).status).toBe(200);
      past.push(j.job.id);
      await new Promise((r) => setTimeout(r, 3));
    }
    // 最新の 1 件は画面で直す
    const last = past[past.length - 1]!;
    expect((await api.put(`/api/ai/jobs/${last}/edited`, { result: { ...scoutResult(), summary: '直した要約' } })).status).toBe(200);
    const cur = await create('scout', scoutInput({ positionName: '今回のポジション' }));
    const res = await api.hookGet(cur.context, cur.token);
    const text = await res.text();
    const body = JSON.parse(text) as { jobId: string; kind: string; input: { positionName: string }; company: Record<string, unknown>; history: { createdAt: string; input: { positionName: string }; result: { summary: string } }[]; resultSchema: string };
    expect(body).toMatchObject({ jobId: cur.job.id, kind: 'scout', resultSchema: 'src/shared/ai/scout.ts', input: { positionName: '今回のポジション', purpose: 'review' } });
    expect(Object.keys(body.company).sort()).toEqual(['companyType', 'id', 'industry']);
    expect(body.company.id).toBe(id);
    expect(text).not.toContain(name);
    expect(text).not.toContain(cur.token);
    expect(body.history).toHaveLength(AI_HISTORY_FOR_SESSION);
    expect(body.history.map((h) => h.result.summary)).toEqual(['直した要約', '要約 2', '要約 1']);
    expect(body.history[0]!.input.positionName).toBe('法人営業 3');
    // ほかの機能の履歴は混ざらない
    const other = await create('job', jobInput());
    expect(((await (await api.hookGet(other.context, other.token)).json()) as { history: unknown[] }).history).toEqual([]);
  });

  it('context（①）: company.data に期間の数値が入り、企業名は入らない', async () => {
    const from = addMonths(month, -2);
    const cur = await create('report', { from, to: month, note: '返信率を重点的に' });
    const res = await api.hookGet(cur.context, cur.token);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { company: { id: string; data: ReportData }; input: { note: string } };
    const d = body.company.data;
    expect(d.period).toEqual({ from, to: month, months: [from, addMonths(month, -1), month] });
    expect(d.monthly.map((m) => m.month)).toEqual(d.period.months);
    expect(d.totals.sent).toBe(d.monthly.reduce((a, m) => a + m.sent, 0));
    expect(d.totals.apps).toBe(d.monthly.reduce((a, m) => a + m.apps, 0));
    expect(d.previous).toMatchObject({ from: addMonths(month, -5), to: addMonths(month, -3) });
    expect(d.company).toMatchObject({ id });
    expect(Object.keys(d.company)).not.toContain('name');
    expect(d.selection.map((s) => s.key)).toEqual(['st06_interview_adjusting', 'st07_interview_1st', 'st08_interview_2nd', 'st09_interview_3rd', 'st10_interview_final', 'st11_hired']);
    expect(d.jobs.rows.length).toBeLessThanOrEqual(15);
    for (const rows of Object.values(d.attributes.scout ?? {})) expect(rows.length).toBeLessThanOrEqual(5);
    expect(body.input.note).toBe('返信率を重点的に');
    expect(text).not.toContain(name);
    expect(new TextEncoder().encode(JSON.stringify(d)).length).toBeLessThanOrEqual(REPORT_DATA_MAX_BYTES);
  });

  it('collectReportData: アカウント種別を反映し、窓の端では直前の期間を出さない。無い企業は null', async () => {
    const mock = new MockBqClient();
    const refresh = await getRefreshMeta(mock);
    const all = (await collectReportData(mock, id, { from: month, to: month, account: null, note: '' }, refresh))!;
    const direct = (await collectReportData(mock, id, { from: month, to: month, account: '直接', note: '' }, refresh))!;
    expect(all.account).toBeNull();
    expect(all.cohorts).not.toBeNull();
    expect(direct.account).toBe('直接');
    expect(direct.cohorts).toBeNull();
    expect(direct.monthly[0]).toMatchObject({ loginDays: null, hires: null, interested: null });
    expect(direct.totals.sent).toBeLessThanOrEqual(all.totals.sent);
    expect(direct.notes.join('')).toContain('アカウント種別「直接」');
    const edge = (await collectReportData(mock, id, { from: addMonths(month, -13), to: month, account: null, note: '' }, refresh))!;
    expect(edge.monthly).toHaveLength(14);
    expect(edge.previous).toBeNull();
    expect(await collectReportData(mock, '999999999', { from: month, to: month, account: null, note: '' }, refresh)).toBeNull();
  });

  it('result: 形の違う結果は 400（合言葉は残る）→ 直して送ると done。受け取った後は合言葉が失効', async () => {
    const a = await create('scout', scoutInput());
    const bad = await api.hookPost(a.result, a.token, { ...scoutResult(), drafts: [] });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { details: { path: string }[] }).details.map((d) => d.path)).toContain('drafts');
    expect((await api.hookPost(a.result, a.token, 'not json')).status).toBe(400);
    // ほかの機能の形は通らない
    expect((await api.hookPost(a.result, a.token, reportSample({ from: month, to: month, account: null, note: '' }))).status).toBe(400);
    expect((await api.hookPost(a.result, a.token, jobSample(JobInputSchema.parse(jobInput())))).status).toBe(400);
    // 大きすぎる
    expect((await api.hookPost(a.result, a.token, { ...scoutResult(), pad: 'x'.repeat(AI_RESULT_MAX_BYTES) })).status).toBe(413);
    expect(d1.raw.prepare('SELECT status FROM ai_jobs').get()).toEqual({ status: 'running' });
    const ok = await api.hookPost(a.result, a.token, scoutResult());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, status: 'done' });
    const row = d1.raw.prepare('SELECT status, summary, token_hash, token_expires_at, completed_at FROM ai_jobs').get() as Record<string, unknown>;
    expect(row).toMatchObject({ status: 'done', summary: scoutResult().summary, token_hash: null, token_expires_at: null });
    expect(row.completed_at).toBeTruthy();
    // 失効: もう一度返せない・読めない
    expect((await api.hookPost(a.result, a.token, scoutResult())).status).toBe(401);
    expect((await api.hookGet(a.context, a.token)).status).toBe(401);
    const detail = AiJobDetailSchema.parse(await (await api.get(`/api/ai/jobs/${a.job.id}`)).json());
    expect(detail).toMatchObject({ status: 'done', sample: false, summary: scoutResult().summary });
    expect(detail.result).toMatchObject({ ok: true });
    const audit = d1.raw.prepare("SELECT actor_email, action, after_json FROM audit_log WHERE entity = 'ai_jobs' ORDER BY id").all() as { actor_email: string; action: string; after_json: string }[];
    expect(audit.map((x) => x.actor_email)).toEqual(['cs@daijob.com', 'cs@daijob.com', 'ai-session']);
    expect(JSON.parse(audit[2]!.after_json)).toEqual({ status: 'done' });
  });

  it('result: 失敗の報告は failed（理由つき）。そのあと画面から立ち上げ直せる', async () => {
    const a = await create('job', jobInput());
    const res = await api.hookPost(a.result, a.token, { ok: false, error: '比べられる求人が見つかりませんでした' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'failed' });
    const detail = AiJobDetailSchema.parse(await (await api.get(`/api/ai/jobs/${a.job.id}`)).json());
    expect(detail).toMatchObject({ status: 'failed', error: '比べられる求人が見つかりませんでした', result: null });
    expect((await api.hookPost(a.result, a.token, { ok: false, error: 'x' })).status).toBe(401);
    const again = AiCreateResponseSchema.parse(await (await api.post(`/api/ai/jobs/${a.job.id}/fire`, {})).json());
    expect(again).toMatchObject({ fire: 'sent', job: { status: 'running', error: null } });
    const next = parseFireText(calls[calls.length - 1]!.text);
    expect(next.token).not.toBe(a.token);
    expect((await api.hookGet(next.context, a.token)).status).toBe(401);
    expect((await api.hookGet(next.context, next.token)).status).toBe(200);
  });

  it('期限切れ: 合言葉は通らず、画面には failed（期限切れ）として返る', async () => {
    const a = await create('scout', scoutInput());
    d1.raw.prepare('UPDATE ai_jobs SET token_expires_at = ?').run(new Date(Date.now() - 1000).toISOString());
    expect((await api.hookGet(a.context, a.token)).status).toBe(401);
    expect((await api.hookPost(a.result, a.token, scoutResult())).status).toBe(401);
    const list = AiJobListResponseSchema.parse(await (await api.get(`/api/ai/jobs?company=${id}&kind=scout`)).json());
    expect(list.jobs[0]).toMatchObject({ status: 'failed', error: EXPIRED_MESSAGE });
    const detail = AiJobDetailSchema.parse(await (await api.get(`/api/ai/jobs/${a.job.id}`)).json());
    expect(detail).toMatchObject({ status: 'failed', error: EXPIRED_MESSAGE });
    expect(d1.raw.prepare('SELECT status, token_hash FROM ai_jobs').get()).toEqual({ status: 'failed', token_hash: null });
  });

  it('削除したジョブの合言葉は通らない', async () => {
    const a = await create('scout', scoutInput());
    expect((await api.del(`/api/ai/jobs/${a.job.id}`)).status).toBe(204);
    expect((await api.hookGet(a.context, a.token)).status).toBe(401);
    expect((await api.hookPost(a.result, a.token, scoutResult())).status).toBe(401);
  });

  it('ログに合言葉を出さない', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' ')));
    const a = await create('scout', scoutInput());
    await api.hookGet(a.context, a.token);
    await api.hookPost(a.result, a.token, scoutResult());
    spy.mockRestore();
    const hook = lines.filter((l) => l.includes('"ai.hook"')).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(hook.map((h) => [h.actor, h.jobId, h.what, h.status])).toEqual([['ai-session', a.job.id, 'context', 200], ['ai-session', a.job.id, 'result', 200]]);
    expect(lines.join('\n')).not.toContain(a.token);
  });
});
