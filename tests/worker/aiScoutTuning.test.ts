import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baseEnv, ctx } from '../helpers/env';
import { sessionCookie } from '../helpers/login';
import { createFakeD1 } from '../helpers/fakeD1';
import { installFakeCache, uninstallFakeCache } from '../helpers/fakeCache';
import { client, defaultVertex, ENGINES, prodEnv, scoutInput, stubVertex, vertexResponse } from '../helpers/ai';
import { fakeScoutDs } from '../helpers/scoutFake';
import { AiCompaniesResponseSchema, AiCreateResponseSchema, AiJobDetailSchema } from '../../src/shared/ai/common';
import { ScoutModelsResponseSchema, ScoutResultSchema, ScoutTuneResponseSchema, SCOUT_TUNE_MIN_JUDGED } from '../../src/shared/ai/scout';
import { _resetVertexAuth } from '../../src/worker/ai/vertex';
import { SCOUT_MODELS } from '../../src/worker/ai/scout/models';
import { ScoutRepo } from '../../src/worker/ai/scout/repo';
import { scheduledScoutTuning } from '../../src/worker/ai/scout/service';
import { runScoutTuning, SCORE_HIRE_FULL, SCORE_REPLY_FULL, SCORE_SHRINK_SENDS, SCORE_WEIGHTS, SCOUT_ROLLBACK_MARGIN, scoreOf, statsOf } from '../../src/worker/ai/scout/tuning';
import worker from '../../src/worker/index';
import type { Env } from '../../src/worker/env';

vi.mock('../../src/worker/services/clients', async () => {
  const { MockBqClient } = await import('../../src/worker/bq/mockClient');
  return { makeClient: () => new MockBqClient() };
});
vi.mock('../../src/worker/ai/scout/bqDataSource', async () => {
  const { fakeScoutDs } = await import('../helpers/scoutFake');
  return { makeScoutDataSource: () => fakeScoutDs };
});

describe('② スカウト: モデルの検証・アップデート・チューニングのループ', () => {
  let env: Env;
  let d1: ReturnType<typeof createFakeD1>;
  let cookie: string;
  let adminCookie: string;
  let id: string;
  let name: string;
  let seq = 0;
  const api = client(() => env, () => cookie);
  const rows = <T,>(sql: string, ...args: (string | number)[]) => d1.raw.prepare(sql).all(...args) as T[];
  const tune = async () => ScoutTuneResponseSchema.parse(await (await api.post('/api/ai/scout/tune', {}, adminCookie)).json());
  const models = async () => ScoutModelsResponseSchema.parse(await (await api.get('/api/ai/scout/models', adminCookie)).json());

  /** 判断済みの依頼を n 件、D1 に直接入れる（winner = 選ばれたモデル。null = どれも使わない） */
  function seedJudged(n: number, winner: 'a' | 'b' | 'c' | null, versions: Partial<Record<'a' | 'b' | 'c', number>> = {}, extra: { used?: boolean; sends?: number; replies?: number; hires?: number; comment?: string } = {}): void {
    for (let i = 0; i < n; i++) {
      const jobId = `seedjob${String(++seq).padStart(13, '0')}`;
      const at = new Date(Date.UTC(2026, 10, 1, 0, 0, seq)).toISOString();
      d1.raw.prepare("INSERT INTO ai_jobs (id, kind, company_id, status, title, input_json, result_json, created_by, created_at, updated_at) VALUES (?, 'scout', ?, 'done', 't', ?, '{}', 'cs@daijob.com', ?, ?)").run(jobId, Number(id), JSON.stringify(scoutInput({ positionName: `ポジション${seq}` })), at, at);
      for (const m of ['a', 'b', 'c'] as const) {
        const chosen = m === winner ? 1 : 0;
        d1.raw
          .prepare("INSERT INTO ai_scout_drafts (draft_id, job_id, company_id, model_id, model_version, engine, subject, body, created_at, judged, chosen, chosen_by, chosen_at, comment, used_state, used_source, out_sends, out_replies, out_hires) VALUES (?, ?, ?, ?, ?, 'e', ?, ?, ?, 1, ?, 'cs@daijob.com', ?, ?, ?, ?, ?, ?, ?)")
          .run(`${jobId}${m}`, jobId, Number(id), m, versions[m] ?? 1, `件名 ${m}${seq}`, `本文 ${m}${seq} `.repeat(40), at, chosen, at, extra.comment ?? '', chosen && extra.used ? 'used' : 'unknown', chosen && extra.used ? 'cs' : null, chosen ? (extra.sends ?? null) : null, chosen ? (extra.replies ?? null) : null, chosen ? (extra.hires ?? null) : null);
      }
    }
  }

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
    ({ id, name } = AiCompaniesResponseSchema.parse(await (await api.get('/api/ai/companies')).json()).companies[0]!);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('総合点: 選ばれた率 0.6 + 使われた率 0.2 + 返信 0.15 + 採用 0.05。返信・採用は、送信が少ないうちは 0 に寄る', () => {
    expect(SCORE_WEIGHTS).toEqual({ chosen: 0.6, used: 0.2, reply: 0.15, hire: 0.05 });
    expect(SCORE_WEIGHTS.chosen + SCORE_WEIGHTS.used + SCORE_WEIGHTS.reply + SCORE_WEIGHTS.hire).toBeCloseTo(1);
    expect([SCORE_SHRINK_SENDS, SCORE_REPLY_FULL, SCORE_HIRE_FULL, SCOUT_ROLLBACK_MARGIN, SCOUT_TUNE_MIN_JUDGED]).toEqual([200, 0.1, 0.01, 10, 8]);
    const base = { judged: 10, chosen: 5, used: 0, sends: 0, replies: 0, hires: 0 };
    expect(scoreOf({ ...base, judged: 0 })).toBeNull();
    expect(scoreOf(base)).toBe(30);
    expect(scoreOf({ ...base, used: 5 })).toBe(50);
    // 送信 10 通・返信 5 通（50%）でも、縮小推定で 5 / 210 = 2.4% → 返信の点は 0.24
    expect(scoreOf({ ...base, used: 5, sends: 10, replies: 5 })).toBe(53.6);
    // 送信が多ければ満点に近づく: 300 / 2200 = 13.6% ≥ 10% → 15 点、採用 30 / 2200 = 1.36% ≥ 1% → 5 点
    expect(scoreOf({ judged: 10, chosen: 10, used: 10, sends: 2000, replies: 300, hires: 30 })).toBe(100);
    expect(statsOf({ drafts: 12, judged: 10, chosen: 4, used: 2, sends: 100, replies: 9, hires: 0 })).toMatchObject({ chosenRatePct: 40, replyRatePct: 9, score: 38.5 });
    // README に同じ式と定数が書いてある
    const readme = readFileSync(join(process.cwd(), 'src/worker/ai/scout/README.md'), 'utf8');
    for (const w of ['0.6', '0.2', '0.15', '0.05', '200', '10 点']) expect(readme).toContain(w);
  });

  it('判断が足りない（8 件未満）モデルは据え置き。Vertex AI を呼ばない。実行は記録に残る', async () => {
    const v = stubVertex();
    seedJudged(SCOUT_TUNE_MIN_JUDGED - 1, 'a');
    const res = await tune();
    expect(res.results.map((r) => [r.modelId, r.action, r.fromVersion, r.toVersion])).toEqual([['a', 'kept', 1, 1], ['b', 'kept', 1, 1], ['c', 'kept', 1, 1]]);
    expect(res.results[0]!.note).toContain('判断が 7 件');
    expect(v.calls).toHaveLength(0);
    expect(rows('SELECT ran_by FROM ai_scout_tune_runs')).toEqual([{ ran_by: 'admin@daijob.com' }]);
    const m = await models();
    expect(m.lastTunedAt).toBe(res.ranAt);
    expect(m.lastTuneNote).toBe('実績の更新 0 件 / a: 据え置き / b: 据え置き / c: 据え置き');
    expect(m.models[0]!.versions[0]!.stats).toMatchObject({ drafts: 7, judged: 7, chosen: 7, chosenRatePct: 100, score: 60 });
    expect(m.models[1]!.versions[0]!.stats).toMatchObject({ judged: 7, chosen: 0, chosenRatePct: 0, score: 0 });
  });

  it('判断が足りたモデルはチューニング: プレイブックを直した新しい版を有効にする（Vertex AI は 1 モデル 1 回・最大 3 回）。プロンプトに企業名を入れない', async () => {
    const v = stubVertex();
    seedJudged(5, 'a', {}, { comment: '件名が分かりやすい' });
    seedJudged(2, 'b');
    seedJudged(1, null, {}, { comment: 'どれも長い' });
    const res = await tune();
    expect(res.results.map((r) => [r.modelId, r.action, r.fromVersion, r.toVersion])).toEqual([['a', 'tuned', 1, 2], ['b', 'tuned', 1, 2], ['c', 'tuned', 1, 2]]);
    expect(res.results[1]!.note).toBe('件名でポジション名を先頭に置くようにしました（b）。');
    expect(v.calls).toHaveLength(3);
    expect(v.calls.every((c) => c.engine === ENGINES.insight)).toBe(true);
    const b = v.calls[1]!;
    expect(b.system).toContain('このモデルの「持ち味」を保つ');
    expect(b.user).toContain(`# このモデル\nb「相手に合わせる」。持ち味: ${SCOUT_MODELS[1]!.trait}`);
    expect(b.user).toContain(SCOUT_MODELS[1]!.playbook);
    expect(b.user).toContain('a「実績の型」: 判断 8 件・選ばれた率 62.5%');
    expect(b.user).toContain('b「相手に合わせる」（このモデル）: 判断 8 件・選ばれた率 25%');
    // 選ばれなかった例は 5 件まで（選ばれた案・CS のコメントつき）、選ばれた例は 3 件まで
    expect(b.user.match(/このモデルの案: /g)).toHaveLength(5 + 2);
    expect(b.user).toContain('選ばれた案（モデル a）: 件名「件名 a');
    expect(b.user).toContain('選ばれた案: なし（どれも使わない）');
    expect(b.user).toContain('CS のコメント: どれも長い');
    expect(b.user).toContain('条件: 作成 / IT・通信 / ポジション');
    for (const c of v.calls) expect(c.system + c.user).not.toContain(name);
    // D1: 新しい版
    const m = await models();
    expect(m.models.map((x) => [x.id, x.activeVersion, x.versions.length])).toEqual([['a', 2, 2], ['b', 2, 2], ['c', 2, 2]]);
    expect(m.models[1]!.versions[1]).toMatchObject({ version: 2, origin: 'tuned', active: true, createdBy: 'admin@daijob.com', note: '件名でポジション名を先頭に置くようにしました（b）。' });
    expect(m.models[1]!.versions[1]!.playbook).toContain('【持ち味】b（直した版）');
    expect(m.models[1]!.versions[0]).toMatchObject({ active: false, playbook: SCOUT_MODELS[1]!.playbook });
    expect(rows("SELECT entity_id, actor_email FROM audit_log WHERE entity = 'ai_scout_models' ORDER BY id")).toEqual(['a', 'b', 'c'].map((x) => ({ entity_id: x, actor_email: 'admin@daijob.com' })));
    // 新しい版は、判断がたまるまで据え置き
    expect((await tune()).results.map((r) => r.action)).toEqual(['kept', 'kept', 'kept']);
    expect(v.calls).toHaveLength(3);
    // 次の作成は、新しい版のプレイブックで作る
    const job = AiCreateResponseSchema.parse(await (await api.post(`/api/companies/${id}/ai/jobs`, { kind: 'scout', input: scoutInput() })).json()).job;
    expect(ScoutResultSchema.parse(job.result).drafts.map((x) => x.modelVersion)).toEqual([2, 2, 2]);
    expect(v.calls.find((c) => c.engine === ENGINES.b)!.user).toContain('【持ち味】b（直した版）');
  });

  it('前の版より総合点が明らかに低い（10 点以上）ときは、前の版の作り方へ戻す（Vertex AI を呼ばない）', async () => {
    const v = stubVertex();
    const repo = new ScoutRepo(d1);
    await d1.batch([repo.insertVersionStmt({ modelId: 'a', version: 2, origin: 'tuned', note: '直した', playbook: 'y'.repeat(300), engine: null, at: '2026-11-20T00:00:00.000Z', by: 'cron' }), repo.setActiveStmt('a', 2, '2026-11-20T00:00:00.000Z')]);
    seedJudged(8, 'a', { a: 1 }); // 第 1 版: 8 / 8 = 60 点
    seedJudged(2, 'a', { a: 2 }); // 第 2 版: 2 / 8 = 15 点
    seedJudged(6, 'b', { a: 2 });
    const res = await tune();
    expect(res.results[0]).toMatchObject({ modelId: 'a', action: 'rolledBack', fromVersion: 2, toVersion: 3 });
    expect(res.results[0]!.note).toContain('第 1 版の作り方へ戻しました');
    expect(res.results.slice(1).map((r) => r.action)).toEqual(['tuned', 'tuned']);
    expect(v.calls).toHaveLength(2);
    const a = (await models()).models[0]!;
    expect(a.versions.map((x) => [x.version, x.origin, x.active])).toEqual([[1, 'initial', false], [2, 'tuned', false], [3, 'rollback', true]]);
    expect(a.versions[2]!.playbook).toBe(SCOUT_MODELS[0]!.playbook);
    expect((await models()).lastTuneNote).toContain('a: 前の版へ戻した（第 3 版）');
  });

  it('前の版との差が小さい・前の版の判断が足りないときは、戻さずにチューニングする。Vertex AI が失敗したら版を変えない', async () => {
    const repo = new ScoutRepo(d1);
    await d1.batch([repo.insertVersionStmt({ modelId: 'a', version: 2, origin: 'tuned', note: '直した', playbook: 'y'.repeat(300), engine: null, at: '2026-11-20T00:00:00.000Z', by: 'cron' }), repo.setActiveStmt('a', 2, '2026-11-20T00:00:00.000Z')]);
    seedJudged(4, 'a', { a: 1 }); // 前の版は判断 4 件（足りない）
    seedJudged(1, 'a', { a: 2 });
    seedJudged(7, 'b', { a: 2 });
    stubVertex((c) => (c.user.includes('# このモデル\na') ? new Response('x', { status: 500 }) : c.user.includes('# このモデル\nb') ? vertexResponse({ playbook: `${'長'.repeat(300)} 連絡は taro@example.com`, note: '直した' }) : defaultVertex(c)));
    const res = await runScoutTuning({ env, db: d1, ds: fakeScoutDs, ranBy: 'cron' });
    expect(res.results.map((r) => [r.modelId, r.action, r.toVersion])).toEqual([['a', 'failed', 2], ['b', 'failed', 1], ['c', 'tuned', 2]]);
    expect(res.results[0]!.note).toBe('Vertex AI がエラーを返しました（HTTP 500）');
    expect(res.results[1]!.note).toContain('連絡先が含まれていた');
    expect((await new ScoutRepo(d1).activeModels()).map((m) => m.version)).toEqual([2, 1, 2]);
    expect(rows('SELECT ran_by FROM ai_scout_tune_runs')).toEqual([{ ran_by: 'cron' }]);
  });

  it('実績の取り込み: 選ばれた案（直した版）を BigQuery へ写し、照合できた案は「使った（auto）」にして送信・返信・採用を入れる', async () => {
    stubVertex();
    const job = AiCreateResponseSchema.parse(await (await api.post(`/api/companies/${id}/ai/jobs`, { kind: 'scout', input: scoutInput() })).json()).job;
    const result = ScoutResultSchema.parse(job.result);
    const chosen = result.drafts[2]!;
    await api.put(`/api/ai/jobs/${job.id}/scout/choice`, { draftId: chosen.draftId });
    await api.put(`/api/ai/jobs/${job.id}/scout/usage`, { usedState: 'not_used' });
    await api.put(`/api/ai/jobs/${job.id}/edited`, { result: { ...result, drafts: result.drafts.map((x) => (x.draftId === chosen.draftId ? { ...x, body: '直した本文です。' } : x)) } });
    // 1 回目: 写す（照合結果はまだ無い）
    const first = await tune();
    expect(first.outcomesUpdated).toBe(0);
    expect(fakeScoutDs.calls.exported).toHaveLength(1);
    expect(fakeScoutDs.calls.exported[0]).toEqual([{ draftId: chosen.draftId, jobId: job.id, companyId: id, modelId: 'c', modelVersion: 1, subject: chosen.subject, body: '直した本文です。', chosenAt: expect.any(String) }]);
    expect(JSON.stringify(fakeScoutDs.calls.exported)).not.toContain(name);
    expect(fakeScoutDs.calls.outcomes).toEqual([[chosen.draftId]]);
    expect(rows<{ bq_synced_at: string | null }>('SELECT bq_synced_at FROM ai_scout_drafts WHERE chosen = 1')[0]!.bq_synced_at).toBe(first.ranAt);
    // 2 回目: 照合できた → used（auto）。CS が「使わなかった」と付けていても直す。写し直しはしない
    fakeScoutDs.state.outcomes = [{ draftId: chosen.draftId, matched: true, sends: 40, replies: 6, hires: 1, firstSentOn: '2026-11-28' }];
    const second = await tune();
    expect(second.outcomesUpdated).toBe(1);
    expect(fakeScoutDs.calls.exported).toHaveLength(1);
    expect(rows('SELECT used_state, used_source, out_sends, out_replies, out_hires, out_first_sent_on FROM ai_scout_drafts WHERE chosen = 1')).toEqual([{ used_state: 'used', used_source: 'auto', out_sends: 40, out_replies: 6, out_hires: 1, out_first_sent_on: '2026-11-28' }]);
    const detail = AiJobDetailSchema.parse(await (await api.get(`/api/ai/jobs/${job.id}`)).json());
    expect(ScoutResultSchema.parse(detail.result).drafts[2]!.feedback).toEqual({ chosen: true, usedState: 'used', usedSource: 'auto', sends: 40, replies: 6, hires: 1, outcomeAt: second.ranAt });
    expect((await models()).models[2]!.versions[0]!.stats).toMatchObject({ drafts: 1, judged: 1, chosen: 1, used: 1, sends: 40, replies: 6, hires: 1, replyRatePct: 15 });
    // 照合済みは、画面から変えられない。変わりが無ければ更新しない。照合できない（matched = false）ものは触らない
    expect((await api.put(`/api/ai/jobs/${job.id}/scout/usage`, { usedState: 'not_used' })).status).toBe(409);
    expect((await tune()).outcomesUpdated).toBe(0);
    // 文面を直すと、写し直す
    await api.del(`/api/ai/jobs/${job.id}/edited`);
    await tune();
    expect(fakeScoutDs.calls.exported).toHaveLength(2);
    expect(fakeScoutDs.calls.exported[1]![0]!.body).toBe(chosen.body);
    // BigQuery に書けないとき（false）は、写した印を付けない（次の回にもう一度）
    await api.put(`/api/ai/jobs/${job.id}/edited`, { result });
    fakeScoutDs.state.exportOk = false;
    await tune();
    expect(rows('SELECT bq_synced_at FROM ai_scout_drafts WHERE chosen = 1')).toEqual([{ bq_synced_at: null }]);
    expect(rows<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'ai_scout_drafts' AND entity_id IN ('bq-export', 'outcomes')")[0]!.n).toBe(3);
  });

  it('実行できるのは管理者だけ。サンプルデータでは実行しない', async () => {
    stubVertex();
    const res = await api.post('/api/ai/scout/tune', {});
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'forbidden' });
    expect(rows('SELECT id FROM ai_scout_tune_runs')).toEqual([]);
    env = { ...env, BQ_MOCK: '1' };
    expect((await api.post('/api/ai/scout/tune', {}, adminCookie)).status).toBe(409);
  });

  it('cron: default export に scheduled があり、週次で同じ処理を実行する。D1・Vertex AI の設定が無い・サンプルデータのときは何もしない', async () => {
    const v = stubVertex();
    const wrangler = JSON.parse(readFileSync(join(process.cwd(), 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '')) as { triggers: { crons: string[] }; env: { staging: { triggers: { crons: string[] } } }; vars: Record<string, string> };
    expect(wrangler.triggers.crons).toEqual(['0 20 * * 0']);
    expect(wrangler.env.staging.triggers.crons).toEqual(['0 20 * * 0']);
    expect(wrangler.vars).toMatchObject({ VERTEX_PROJECT: 'bq-hgt', VERTEX_LOCATION: 'global' });
    expect(typeof worker.fetch).toBe('function');
    seedJudged(8, 'c');
    const waits: Promise<unknown>[] = [];
    worker.scheduled({} as ScheduledController, env, { ...ctx, waitUntil: (p: Promise<unknown>) => waits.push(p) } as unknown as ExecutionContext);
    expect(waits).toHaveLength(1);
    await Promise.all(waits);
    expect(rows('SELECT ran_by FROM ai_scout_tune_runs')).toEqual([{ ran_by: 'cron' }]);
    expect(rows('SELECT created_by, origin FROM ai_scout_model_versions WHERE version = 2 ORDER BY model_id')).toEqual([{ created_by: 'cron', origin: 'tuned' }, { created_by: 'cron', origin: 'tuned' }, { created_by: 'cron', origin: 'tuned' }]);
    expect(v.calls).toHaveLength(3);
    expect(await scheduledScoutTuning({ ...env, BQ_MOCK: '1' }, () => fakeScoutDs)).toBeNull();
    expect(await scheduledScoutTuning({ ...env, CMS_DB: undefined }, () => fakeScoutDs)).toBeNull();
    expect(await scheduledScoutTuning({ ...env, AI_INSIGHT_ENGINE: undefined }, () => fakeScoutDs)).toBeNull();
    expect(await scheduledScoutTuning({ ...baseEnv }, () => fakeScoutDs)).toBeNull();
    expect(rows('SELECT id FROM ai_scout_tune_runs')).toHaveLength(1);
  });
});
