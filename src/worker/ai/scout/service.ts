import { z } from 'zod';
import { isMock, type Env } from '../../env';
import type { D1Like } from '../../d1/db';
import { AuditRepo } from '../../d1/auditRepo';
import { AppError } from '../../lib/errors';
import { logEvent } from '../../lib/log';
import type { BqClient } from '../../bq/client';
import type { AiCreateResponse, AiJobDetail } from '../../../shared/ai/common';
import {
  ScoutInputSchema,
  ScoutResultSchema,
  SCOUT_BODY_MAX,
  SCOUT_SUBJECT_MAX,
  type ScoutChoiceInput,
  type ScoutDraftFeedback,
  type ScoutInput,
  type ScoutModel,
  type ScoutModelId,
  type ScoutModelsResponse,
  type ScoutResult,
  type ScoutTuneResponse,
  type ScoutUsedState,
} from '../../../shared/ai/scout';
import { AiJobsRepo, type AiJobRow } from '../repo';
import { newJobId } from '../ids';
import { companyBrief, isAiAdmin, issuesOf, PII_MESSAGE, piiDetails, toDetail, type AiDeps, type WaitCtx } from '../service';
import { scoutEngines, totalTokens, vertexConfigured, VertexError } from '../vertex';
import type { ScoutDataSource } from './dataSource';
import { generateScoutDrafts } from './generate';
import { getScoutInsight } from './insight';
import { SCOUT_MODELS } from './models';
import { ScoutRepo, type ScoutDraftRow } from './repo';
import { scoutSample } from './sample';
import { activateNewVersion, countsKey, runScoutTuning, statsByVersion, statsOf, TUNE_SCHEDULE_LABEL, tuneNoteOf } from './tuning';

/**
 * ② スカウト文面の AI 作成 / 添削の本体（docs/AI機能.md）。
 * 依頼 → 分析対象（BigQuery のマート = dataSource）→ 分析の要点（使い回し）→ 3 つのモデルで作成 → D1 に保存、までを 1 回のリクエストで行う。
 */

export interface ScoutDeps extends AiDeps {
  /** 分析に使うデータの入口（本番は bqDataSource.ts。テストでは偽物） */
  ds: ScoutDataSource;
}

export const NO_BENCHMARK_MESSAGE = '分析に使える送信実績がありません（業界・条件を変えて、もう一度お試しください）';
const DATA_ERROR_MESSAGE = '分析に使うデータの取得に失敗しました。時間をおいて、もう一度お試しください';
export const AI_CONFIG_MESSAGE = 'AI 機能の設定（Vertex AI）が完了していません。管理者に連絡してください';

const clipTitle = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n)}…` : s);
export const scoutTitleOf = (input: ScoutInput): string => (input.purpose === 'review' ? `添削: ${clipTitle(input.subject)}` : `作成: ${clipTitle(input.positionName)}`);

function summaryOf(input: ScoutInput, r: Pick<ScoutResult, 'basis' | 'drafts'>): string {
  const b = r.basis;
  const pick = b.threshold === 'over10' ? '返信率 10% 超の文面' : '返信率の高い順の文面（10% 超は無し）';
  return `${b.scopeLabel}の直近 1 年の送信実績から、${pick} ${b.templates} 件（返信率 ${b.ratePct ?? '-'}%。全体は ${b.overallRatePct ?? '-'}%）を分析し、${r.drafts.length} つのモデルで文面を${input.purpose === 'review' ? '添削' : '作成'}しました。`.slice(0, 300);
}

/** 依頼を作って、その場で文面を作る。失敗は ai_jobs に failed で残し、fire = failed と理由を返す */
export async function createScoutJob(d: ScoutDeps, companyId: string, rawInput: unknown): Promise<AiCreateResponse> {
  const now = d.now ?? new Date();
  const mock = isMock(d.env);
  const verified = Boolean(d.identity?.verified);
  if (!mock && !verified) throw new AppError('readOnly', 403, '書き込みには Google ログインが必要です');
  const parsed = ScoutInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError('badRequest', 400, '入力が不正です', issuesOf(parsed.error, 'input'));
  const input = parsed.data;
  const brief = await companyBrief(d.client, companyId, d.ctx);
  if (!brief) throw new AppError('notFound', 404, '企業が見つかりません');
  const pii = piiDetails(input, brief, 'input');
  if (pii.length) throw new AppError('badRequest', 400, PII_MESSAGE, pii);

  const at = now.toISOString();
  const actor = (d.identity?.email ?? 'preview').toLowerCase();
  const jobId = newJobId(now);
  const title = scoutTitleOf(input);
  const inputJson = JSON.stringify(input);
  const rowOf = (over: Partial<AiJobRow>): AiJobRow => ({ id: jobId, kind: 'scout', company_id: Number(companyId), status: 'done', title, input_json: inputJson, result_json: null, edited_json: null, summary: null, error: null, sample: 0, session_url: null, token_hash: null, token_expires_at: null, created_by: actor, created_at: at, updated_at: at, fired_at: null, completed_at: at, deleted_at: null, ...over });

  // サンプルデータ: Vertex AI を呼ばず、見本を返す。Google ログイン済みで D1 があれば保存する（仮の利用者は保存しない）
  if (mock) {
    const result = scoutSample(input, jobId);
    const row = rowOf({ sample: 1, result_json: JSON.stringify(result), summary: result.summary });
    const saved = verified && Boolean(d.db);
    if (verified && d.db) {
      await d.db.batch([
        new AiJobsRepo(d.db).insertStmt({ id: jobId, kind: 'scout', companyId, status: 'done', title, input_json: inputJson, result_json: row.result_json, summary: row.summary, created_by: actor, sample: true, at }),
        new AuditRepo(d.db).insertStmt({ at, actor, action: 'create', entity: 'ai_jobs', entityId: jobId, companyId: Number(companyId), before: null, after: { kind: 'scout', title, status: 'done', sample: true }, requestId: d.requestId }),
      ]);
    }
    logEvent('ai.create', { reqId: d.requestId, actor, jobId, kind: 'scout', companyId, sample: true, saved });
    return { job: toDetail(row, brief.name), fire: 'sample', fireMessage: null };
  }

  if (!d.db) throw new AppError('storage', 503, '保存先（D1）が設定されていません。管理者に連絡してください');
  if (!vertexConfigured(d.env)) throw new AppError('aiConfig', 503, AI_CONFIG_MESSAGE);
  const db = d.db;
  const repo = new ScoutRepo(db);
  const jobs = new AiJobsRepo(db);
  const t0 = Date.now();

  const fail = async (message: string, extra: Record<string, unknown> = {}): Promise<AiCreateResponse> => {
    await db.batch([
      jobs.insertStmt({ id: jobId, kind: 'scout', companyId, status: 'failed', title, input_json: inputJson, result_json: null, summary: null, created_by: actor, sample: false, at, error: message }),
      new AuditRepo(db).insertStmt({ at, actor, action: 'create', entity: 'ai_jobs', entityId: jobId, companyId: Number(companyId), before: null, after: { kind: 'scout', title, status: 'failed' }, requestId: d.requestId }),
    ]);
    logEvent('ai.create', { reqId: d.requestId, actor, jobId, kind: 'scout', companyId, sample: false, ok: false, ms: Date.now() - t0, ...extra });
    return { job: toDetail(rowOf({ status: 'failed', error: message.slice(0, 500) }), brief.name), fire: 'failed', fireMessage: message };
  };

  try {
    const benchmark = await d.ds.benchmark({ companyId, industry: input.industry, filters: input.filters, lang: input.lang });
    if (!benchmark) return await fail(NO_BENCHMARK_MESSAGE, { reason: 'noBenchmark' });
    const engines = scoutEngines(d.env)!;
    const [ins, models, previous] = await Promise.all([getScoutInsight(d.env, db, benchmark, { now, fetchImpl: d.fetchImpl }), repo.activeModels(), repo.lastChosen(companyId)]);
    if (models.length === 0) throw new AppError('storage', 503, 'モデルの設定（D1 の ai_scout_models）がありません。d1/migrations/0005_ai_scout.sql を適用してください');
    const gen = await generateScoutDrafts(d.env, { jobId, models, engines, companyNames: [brief.name, brief.internalName], input, insight: ins.insight, stats: benchmark.stats, templates: benchmark.basis.templates, previous, fetchImpl: d.fetchImpl });
    const tokens = totalTokens(ins.tokens) + totalTokens(gen.tokens);
    if (gen.drafts.length === 0) return await fail(`文面を作れませんでした。${gen.warnings[0] ?? ''}`.trim(), { reason: 'noDrafts', tokens, insightCached: ins.cached });

    const drafts = gen.drafts.map((g) => g.draft);
    const result = ScoutResultSchema.parse({ ok: true, summary: summaryOf(input, { basis: benchmark.basis, drafts }), basis: benchmark.basis, stats: benchmark.stats, insight: ins.insight, insightCached: ins.cached, drafts, warnings: gen.warnings.slice(0, 4), elapsedMs: Date.now() - t0, tokens });
    const resultJson = JSON.stringify(result);
    await db.batch([
      jobs.insertStmt({ id: jobId, kind: 'scout', companyId, status: 'done', title, input_json: inputJson, result_json: resultJson, summary: result.summary, created_by: actor, sample: false, at }),
      ...gen.drafts.map((g) => repo.insertDraftStmt({ draft_id: g.draft.draftId, job_id: jobId, companyId, model_id: g.draft.modelId, model_version: g.draft.modelVersion, engine: g.engine, subject: g.draft.subject, body: g.draft.body, tokens: totalTokens(g.tokens), at })),
      new AuditRepo(db).insertStmt({ at, actor, action: 'create', entity: 'ai_jobs', entityId: jobId, companyId: Number(companyId), before: null, after: { kind: 'scout', title, status: 'done', sample: false, drafts: drafts.map((x) => `${x.modelId}:${x.modelVersion}`) }, requestId: d.requestId }),
    ]);
    logEvent('ai.create', { reqId: d.requestId, actor, jobId, kind: 'scout', companyId, sample: false, ok: true, ms: result.elapsedMs, insightMs: ins.ms, generateMs: gen.ms, tokens, insightCached: ins.cached, drafts: drafts.length, warnings: gen.warnings.length });
    const row = rowOf({ result_json: resultJson, summary: result.summary });
    return { job: await withScoutFeedback(db, row, toDetail(row, brief.name)), fire: 'done', fireMessage: null };
  } catch (e) {
    if (e instanceof AppError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    // D1 の表が無い（マイグレーション未適用）は、設定の案内を返す（lib/errors.ts）
    if (/no such table/i.test(msg)) throw e;
    if (e instanceof VertexError) return await fail(`文面を作れませんでした。${e.message}`, { reason: e.reason });
    console.error(e);
    return await fail(DATA_ERROR_MESSAGE, { reason: 'data' });
  }
}

/* ---------- 読み出し: 各案にフィードバックを付ける ---------- */

export const feedbackOf = (r: ScoutDraftRow): ScoutDraftFeedback => ({ chosen: r.chosen === 1, usedState: r.used_state, usedSource: r.used_source, sends: r.out_sends, replies: r.out_replies, hires: r.out_hires, outcomeAt: r.out_updated_at });

function attach(result: unknown, byId: Map<string, ScoutDraftRow>): unknown {
  if (!result || typeof result !== 'object' || !Array.isArray((result as { drafts?: unknown }).drafts)) return result;
  const r = result as { drafts: unknown[] };
  return { ...r, drafts: r.drafts.map((x) => (x && typeof x === 'object' && typeof (x as { draftId?: unknown }).draftId === 'string' ? { ...x, feedback: byId.has((x as { draftId: string }).draftId) ? feedbackOf(byId.get((x as { draftId: string }).draftId)!) : null } : x)) };
}

/** ② の結果（と直した版）の各案に、D1（ai_scout_drafts）のフィードバックと実績を付ける。見本・以前の形の結果は、そのまま返す */
export async function withScoutFeedback(db: D1Like | null, row: AiJobRow, detail: AiJobDetail): Promise<AiJobDetail> {
  if (!db || row.kind !== 'scout' || row.status !== 'done' || row.sample === 1) return detail;
  const rows = await new ScoutRepo(db).draftsByJob(row.id).catch(() => [] as ScoutDraftRow[]);
  if (!rows.length) return detail;
  const byId = new Map(rows.map((r) => [r.draft_id, r]));
  return { ...detail, result: attach(detail.result, byId), editedResult: attach(detail.editedResult, byId) };
}

/* ---------- 画面で直した版 ---------- */

const EditedDraftsSchema = z.object({ drafts: z.array(z.object({ draftId: z.string(), subject: z.string().trim().min(1).max(SCOUT_SUBJECT_MAX), body: z.string().trim().min(1).max(SCOUT_BODY_MAX) }).passthrough()).min(1).max(3) }).passthrough();

/**
 * ② の直した版: 直せるのは、各案の subject / body だけ。ほかの項目（数値・要点・狙いなど）は、元の結果のまま保存する。
 * 社名・連絡先が入っていれば 400（BigQuery へ写すため）
 */
export function mergeScoutEdited(row: AiJobRow, submitted: unknown, brief: { name: string; internalName: string | null }): ScoutResult {
  let orig: ScoutResult;
  try {
    orig = ScoutResultSchema.parse(JSON.parse(row.result_json ?? 'null'));
  } catch {
    throw new AppError('conflict', 409, 'この結果は以前の形のため、直した版を保存できません。もう一度作成してください');
  }
  const r = EditedDraftsSchema.safeParse(submitted);
  if (!r.success) throw new AppError('badRequest', 400, '入力が不正です', issuesOf(r.error, 'result'));
  const byId = new Map(r.data.drafts.map((x) => [x.draftId, x]));
  if (byId.size !== orig.drafts.length || orig.drafts.some((x) => !byId.has(x.draftId))) throw new AppError('badRequest', 400, '入力が不正です', [{ path: 'result.drafts', message: '案の数・ID が、元の結果と合いません' }]);
  const drafts = orig.drafts.map((x) => ({ ...x, subject: byId.get(x.draftId)!.subject, body: byId.get(x.draftId)!.body, feedback: null }));
  const pii = drafts.flatMap((x, i) => piiDetails({ subject: x.subject, body: x.body }, brief, `result.drafts.${i}`));
  if (pii.length) throw new AppError('badRequest', 400, PII_MESSAGE, pii.slice(0, 20));
  return ScoutResultSchema.parse({ ...orig, drafts });
}

/* ---------- フィードバック（どれを選んだか・企業が使ったか） ---------- */

export interface FeedbackDeps {
  db: D1Like;
  client: BqClient;
  actor: { email: string; requestId: string };
  now?: Date;
  ctx?: WaitCtx;
}

async function draftsForFeedback(db: D1Like, row: AiJobRow): Promise<ScoutDraftRow[]> {
  if (row.kind !== 'scout') throw new AppError('conflict', 409, 'スカウト文面の依頼ではありません');
  if (row.sample === 1) throw new AppError('conflict', 409, '見本の結果には、記録できません');
  if (row.status !== 'done') throw new AppError('conflict', 409, '文面ができてから記録してください');
  const drafts = await new ScoutRepo(db).draftsByJob(row.id);
  if (!drafts.length) throw new AppError('conflict', 409, 'この結果は以前の形のため、記録できません');
  return drafts;
}

/** どの案を選んだか（draftId = null は「どれも使わない」）。その依頼の全案を判断済みにする。選び直せる */
export async function setScoutChoice(d: FeedbackDeps, row: AiJobRow, body: ScoutChoiceInput): Promise<void> {
  const drafts = await draftsForFeedback(d.db, row);
  const target = body.draftId === null ? null : drafts.find((x) => x.draft_id === body.draftId);
  if (target === undefined) throw new AppError('badRequest', 400, '入力が不正です', [{ path: 'draftId', message: 'この依頼の案ではありません' }]);
  if (body.comment) {
    const brief = await companyBrief(d.client, String(row.company_id), d.ctx).catch(() => null);
    const pii = piiDetails({ comment: body.comment }, brief ?? { name: '', internalName: null }, 'body');
    if (pii.length) throw new AppError('badRequest', 400, PII_MESSAGE, pii.map((p) => ({ ...p, path: 'comment' })));
  }
  const at = (d.now ?? new Date()).toISOString();
  const repo = new ScoutRepo(d.db);
  const before = drafts.find((x) => x.chosen === 1)?.draft_id ?? null;
  // 前と同じ案を選び直したとき・送信実績と照合済みのときは、利用の状態を保つ
  const keep = target && (target.chosen === 1 || target.used_source === 'auto') ? { usedState: target.used_state, usedSource: target.used_source, usedAt: target.used_at } : null;
  await d.db.batch([
    repo.judgeStmt(row.id, d.actor.email, body.comment, at),
    ...(target ? [repo.chooseStmt(target.draft_id, keep)] : []),
    new AuditRepo(d.db).insertStmt({ at, actor: d.actor.email, action: 'update', entity: 'ai_scout_drafts', entityId: row.id, companyId: row.company_id, before: { judged: drafts[0]!.judged === 1, chosen: before }, after: { judged: true, chosen: target?.draft_id ?? null, model: target ? `${target.model_id}:${target.model_version}` : null, comment: body.comment !== '' }, requestId: d.actor.requestId }),
  ]);
  logEvent('ai.scout.choice', { reqId: d.actor.requestId, actor: d.actor.email, jobId: row.id, model: target?.model_id ?? null });
}

/** 選んだ案を企業が使ったか（CS が付ける）。送信実績と照合済み（auto）のものは変えられない */
export async function setScoutUsage(d: FeedbackDeps, row: AiJobRow, usedState: ScoutUsedState): Promise<void> {
  const chosen = (await draftsForFeedback(d.db, row)).find((x) => x.chosen === 1);
  if (!chosen) throw new AppError('conflict', 409, '先に、使う案を選んでください');
  if (chosen.used_source === 'auto') throw new AppError('conflict', 409, '送信実績と照合済みのため、変更できません');
  const at = (d.now ?? new Date()).toISOString();
  await d.db.batch([
    new ScoutRepo(d.db).usageStmt(chosen.draft_id, usedState, at),
    new AuditRepo(d.db).insertStmt({ at, actor: d.actor.email, action: 'update', entity: 'ai_scout_drafts', entityId: chosen.draft_id, companyId: row.company_id, before: { usedState: chosen.used_state }, after: { usedState }, requestId: d.actor.requestId }),
  ]);
  logEvent('ai.scout.usage', { reqId: d.actor.requestId, actor: d.actor.email, jobId: row.id, usedState });
}

/* ---------- モデルの成績・チューニング・前の版へ戻す ---------- */

/** D1 が無い・表がまだ無い（サンプルデータ）ときの一覧: 初版だけ・成績は 0 */
function defaultModels(env: Env, admin: boolean): ScoutModel[] {
  const engines = scoutEngines(env);
  return SCOUT_MODELS.map((m) => ({ id: m.id, label: m.label, description: m.description, engine: admin ? (engines?.[m.id] ?? null) : null, activeVersion: 1, versions: [{ version: 1, origin: 'initial', note: '初版', createdAt: '', createdBy: 'system', active: true, stats: statsOf(undefined), playbook: admin ? m.playbook : null }] }));
}

export async function scoutModelsResponse(env: Env, db: D1Like | null, admin: boolean): Promise<ScoutModelsResponse> {
  const base = { schedule: TUNE_SCHEDULE_LABEL, admin };
  if (!db) return { models: defaultModels(env, admin), lastTunedAt: null, lastTuneNote: null, ...base };
  const repo = new ScoutRepo(db);
  try {
    const [models, versions, stats, last] = await Promise.all([repo.models(), repo.versions(), statsByVersion(repo), repo.lastRun()]);
    const engines = scoutEngines(env);
    let note: string | null = null;
    try {
      note = last ? tuneNoteOf(JSON.parse(last.report_json) as ScoutTuneResponse) : null;
    } catch {
      note = null;
    }
    return {
      models: models.map((m) => {
        const vs = versions.filter((v) => v.model_id === m.id);
        const active = vs.find((v) => v.version === m.active_version);
        return {
          id: m.id,
          label: m.label,
          description: m.description,
          engine: admin ? (active?.engine ?? engines?.[m.id] ?? null) : null,
          activeVersion: m.active_version,
          versions: vs.map((v) => ({ version: v.version, origin: v.origin, note: v.note, createdAt: v.created_at, createdBy: admin ? v.created_by : v.created_by === 'cron' || v.created_by === 'system' ? v.created_by : '管理者', active: v.version === m.active_version, stats: stats.get(countsKey(m.id, v.version)) ?? statsOf(undefined), playbook: admin ? v.playbook : null })),
        };
      }),
      lastTunedAt: last?.ran_at ?? null,
      lastTuneNote: note,
      ...base,
    };
  } catch (e) {
    if (isMock(env) && /no such table/i.test(e instanceof Error ? e.message : String(e))) return { models: defaultModels(env, admin), lastTunedAt: null, lastTuneNote: null, ...base };
    throw e;
  }
}

/** 管理者: 指定の版のプレイブックを写した、新しい版を作って有効にする */
export async function rollbackScoutModel(db: D1Like, modelId: ScoutModelId, version: number, actor: { email: string; requestId: string }, now: Date = new Date()): Promise<number> {
  const repo = new ScoutRepo(db);
  const model = (await repo.models()).find((m) => m.id === modelId);
  const target = await repo.version(modelId, version);
  if (!model || !target) throw new AppError('notFound', 404, 'その版はありません');
  if (model.active_version === version) throw new AppError('conflict', 409, 'すでに、その版を使っています');
  const to = await activateNewVersion(db, { modelId, fromVersion: model.active_version, origin: 'rollback', note: `管理者が、第 ${version} 版の作り方へ戻しました`, playbook: target.playbook, engine: target.engine, by: actor.email, at: now.toISOString(), requestId: actor.requestId });
  logEvent('ai.scout.rollback', { reqId: actor.requestId, actor: actor.email, modelId, from: model.active_version, copyOf: version, to });
  return to;
}

/** 週次の cron（index.ts の scheduled）。D1 か Vertex AI の設定が無い・サンプルデータのときは何もしない */
export async function scheduledScoutTuning(env: Env, makeDs: (env: Env) => ScoutDataSource): Promise<ScoutTuneResponse | null> {
  if (isMock(env) || !env.CMS_DB || !vertexConfigured(env)) return null;
  try {
    return await runScoutTuning({ env, db: env.CMS_DB as unknown as D1Like, ds: makeDs(env), ranBy: 'cron' });
  } catch (e) {
    console.error(`スカウトの検証・チューニング（cron）に失敗: ${e instanceof Error ? e.message.slice(0, 300) : ''}`);
    return null;
  }
}

export { isAiAdmin };
