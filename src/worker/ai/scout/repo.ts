import type { D1Like, D1StmtLike } from '../../d1/db';
import type { ScoutModelId, ScoutUsedState } from '../../../shared/ai/scout';

/** ② スカウトの D1（d1/migrations/0005_ai_scout.sql）。すべて prepare().bind()。更新は監査ログと同じ batch() に入れて使う */

export interface ScoutInsightRow {
  cache_key: string;
  insight_json: string;
  engine: string;
  tokens: number;
  created_at: string;
  expires_at: string;
}

export interface ScoutModelRow {
  id: ScoutModelId;
  label: string;
  description: string;
  active_version: number;
  updated_at: string;
}

export interface ScoutVersionRow {
  model_id: ScoutModelId;
  version: number;
  origin: 'initial' | 'tuned' | 'rollback' | 'manual';
  note: string;
  playbook: string;
  engine: string | null;
  created_at: string;
  created_by: string;
}

/** いま使う版（モデル + その版のプレイブック） */
export interface ScoutActiveModel {
  id: ScoutModelId;
  label: string;
  description: string;
  version: number;
  playbook: string;
  engine: string | null;
}

export interface ScoutDraftRow {
  draft_id: string;
  job_id: string;
  company_id: number;
  model_id: ScoutModelId;
  model_version: number;
  engine: string;
  subject: string;
  body: string;
  tokens: number;
  created_at: string;
  judged: number;
  chosen: number;
  chosen_by: string | null;
  chosen_at: string | null;
  comment: string;
  used_state: ScoutUsedState;
  used_source: 'cs' | 'auto' | null;
  used_at: string | null;
  out_sends: number | null;
  out_replies: number | null;
  out_hires: number | null;
  out_first_sent_on: string | null;
  out_updated_at: string | null;
  bq_synced_at: string | null;
}

/** モデル × 版ごとの集計（成績のもと） */
export interface ScoutVersionCounts {
  model_id: ScoutModelId;
  model_version: number;
  drafts: number;
  judged: number;
  chosen: number;
  used: number;
  sends: number;
  replies: number;
  hires: number;
}

/** チューニングの材料: このモデルの案（判断済み）と、その依頼・選ばれた案 */
export interface ScoutTuneExampleRow {
  job_id: string;
  input_json: string;
  subject: string;
  body: string;
  chosen: number;
  comment: string;
  winner_model: string | null;
  winner_subject: string | null;
  winner_body: string | null;
}

const DRAFT_COLS =
  'draft_id, job_id, company_id, model_id, model_version, engine, subject, body, tokens, created_at, judged, chosen, chosen_by, chosen_at, comment, used_state, used_source, used_at, out_sends, out_replies, out_hires, out_first_sent_on, out_updated_at, bq_synced_at';

export class ScoutRepo {
  constructor(private readonly db: D1Like) {}

  /* ---------- 分析の要点の使い回し ---------- */

  async insight(cacheKey: string, nowIso: string): Promise<ScoutInsightRow | null> {
    return this.db.prepare('SELECT cache_key, insight_json, engine, tokens, created_at, expires_at FROM ai_scout_insights WHERE cache_key = ?1 AND expires_at > ?2').bind(cacheKey, nowIso).first<ScoutInsightRow>();
  }

  putInsightStmt(r: { cacheKey: string; basisJson: string; statsJson: string; insightJson: string; engine: string; tokens: number; at: string; expiresAt: string }): D1StmtLike {
    return this.db
      .prepare('INSERT OR REPLACE INTO ai_scout_insights (cache_key, basis_json, stats_json, insight_json, engine, tokens, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
      .bind(r.cacheKey, r.basisJson, r.statsJson, r.insightJson, r.engine, r.tokens, r.at, r.expiresAt);
  }

  /** 期限の切れた分析を消す（保存のついでに） */
  purgeInsightsStmt(nowIso: string): D1StmtLike {
    return this.db.prepare('DELETE FROM ai_scout_insights WHERE expires_at <= ?1').bind(nowIso);
  }

  /* ---------- モデルと版 ---------- */

  async models(): Promise<ScoutModelRow[]> {
    return (await this.db.prepare('SELECT id, label, description, active_version, updated_at FROM ai_scout_models ORDER BY id').all<ScoutModelRow>()).results;
  }

  async versions(): Promise<ScoutVersionRow[]> {
    return (await this.db.prepare('SELECT model_id, version, origin, note, playbook, engine, created_at, created_by FROM ai_scout_model_versions ORDER BY model_id, version').all<ScoutVersionRow>()).results;
  }

  async version(modelId: string, version: number): Promise<ScoutVersionRow | null> {
    return this.db.prepare('SELECT model_id, version, origin, note, playbook, engine, created_at, created_by FROM ai_scout_model_versions WHERE model_id = ?1 AND version = ?2').bind(modelId, version).first<ScoutVersionRow>();
  }

  async activeModels(): Promise<ScoutActiveModel[]> {
    return (
      await this.db
        .prepare('SELECT m.id AS id, m.label AS label, m.description AS description, v.version AS version, v.playbook AS playbook, v.engine AS engine FROM ai_scout_models m JOIN ai_scout_model_versions v ON v.model_id = m.id AND v.version = m.active_version ORDER BY m.id')
        .all<ScoutActiveModel>()
    ).results;
  }

  async maxVersion(modelId: string): Promise<number> {
    return Number((await this.db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM ai_scout_model_versions WHERE model_id = ?1').bind(modelId).first<{ v: number }>())?.v ?? 0);
  }

  insertVersionStmt(r: { modelId: string; version: number; origin: ScoutVersionRow['origin']; note: string; playbook: string; engine: string | null; at: string; by: string }): D1StmtLike {
    return this.db
      .prepare('INSERT INTO ai_scout_model_versions (model_id, version, origin, note, playbook, engine, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
      .bind(r.modelId, r.version, r.origin, r.note.slice(0, 400), r.playbook, r.engine, r.at, r.by);
  }

  setActiveStmt(modelId: string, version: number, at: string): D1StmtLike {
    return this.db.prepare('UPDATE ai_scout_models SET active_version = ?2, updated_at = ?3 WHERE id = ?1').bind(modelId, version, at);
  }

  /* ---------- 文面の案 ---------- */

  insertDraftStmt(r: Pick<ScoutDraftRow, 'draft_id' | 'job_id' | 'model_id' | 'model_version' | 'engine' | 'subject' | 'body' | 'tokens'> & { companyId: string; at: string }): D1StmtLike {
    return this.db
      .prepare('INSERT INTO ai_scout_drafts (draft_id, job_id, company_id, model_id, model_version, engine, subject, body, tokens, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)')
      .bind(r.draft_id, r.job_id, Number(r.companyId), r.model_id, r.model_version, r.engine, r.subject, r.body, r.tokens, r.at);
  }

  async draftsByJob(jobId: string): Promise<ScoutDraftRow[]> {
    return (await this.db.prepare(`SELECT ${DRAFT_COLS} FROM ai_scout_drafts WHERE job_id = ?1 ORDER BY model_id`).bind(jobId).all<ScoutDraftRow>()).results;
  }

  /** その企業で、前に選ばれた案（直近 1 件） */
  async lastChosen(companyId: string): Promise<Pick<ScoutDraftRow, 'subject' | 'body'> | null> {
    return this.db.prepare('SELECT subject, body FROM ai_scout_drafts WHERE company_id = ?1 AND chosen = 1 ORDER BY chosen_at DESC LIMIT 1').bind(Number(companyId)).first<Pick<ScoutDraftRow, 'subject' | 'body'>>();
  }

  /**
   * その依頼の全案を「判断済み」にする（選ばれた印は外す。CS が付けた利用の状態も戻す。送信実績との照合 = auto は残す）。
   * 続けて chooseStmt で、選ばれた案に印を付ける
   */
  judgeStmt(jobId: string, by: string, comment: string, at: string): D1StmtLike {
    return this.db
      .prepare(
        `UPDATE ai_scout_drafts SET judged = 1, chosen = 0, chosen_by = ?2, chosen_at = ?4, comment = ?3,
           used_state = CASE WHEN used_source = 'auto' THEN used_state ELSE 'unknown' END,
           used_at = CASE WHEN used_source = 'auto' THEN used_at ELSE NULL END,
           used_source = CASE WHEN used_source = 'auto' THEN 'auto' ELSE NULL END
         WHERE job_id = ?1`,
      )
      .bind(jobId, by, comment, at);
  }

  /** 前と同じ案を選び直したときは、利用の状態を保つ（keepUsage） */
  chooseStmt(draftId: string, keep: { usedState: ScoutUsedState; usedSource: 'cs' | 'auto' | null; usedAt: string | null } | null): D1StmtLike {
    return this.db.prepare('UPDATE ai_scout_drafts SET chosen = 1, used_state = ?2, used_source = ?3, used_at = ?4 WHERE draft_id = ?1').bind(draftId, keep?.usedState ?? 'unknown', keep?.usedSource ?? null, keep?.usedAt ?? null);
  }

  usageStmt(draftId: string, state: ScoutUsedState, at: string): D1StmtLike {
    return this.db.prepare('UPDATE ai_scout_drafts SET used_state = ?2, used_source = ?3, used_at = ?4 WHERE draft_id = ?1 AND chosen = 1').bind(draftId, state, state === 'unknown' ? null : 'cs', state === 'unknown' ? null : at);
  }

  /** 文面を直した: BigQuery へ写し直す */
  resetSyncStmt(jobId: string): D1StmtLike {
    return this.db.prepare('UPDATE ai_scout_drafts SET bq_synced_at = NULL WHERE job_id = ?1 AND chosen = 1').bind(jobId);
  }

  /** 選ばれた案で、BigQuery にまだ写していないもの（直した版 = ai_jobs.edited_json も一緒に読む） */
  async pendingExport(limit: number): Promise<(ScoutDraftRow & { edited_json: string | null })[]> {
    return (
      await this.db
        .prepare(`SELECT ${DRAFT_COLS.split(', ').map((c) => `d.${c} AS ${c}`).join(', ')}, j.edited_json AS edited_json FROM ai_scout_drafts d LEFT JOIN ai_jobs j ON j.id = d.job_id WHERE d.chosen = 1 AND d.bq_synced_at IS NULL ORDER BY d.chosen_at LIMIT ?1`)
        .bind(limit)
        .all<ScoutDraftRow & { edited_json: string | null }>()
    ).results;
  }

  markSyncedStmt(draftId: string, at: string): D1StmtLike {
    return this.db.prepare('UPDATE ai_scout_drafts SET bq_synced_at = ?2 WHERE draft_id = ?1').bind(draftId, at);
  }

  /** BigQuery へ写した案（照合結果を読む対象。新しい順） */
  async syncedDrafts(limit: number): Promise<Pick<ScoutDraftRow, 'draft_id' | 'used_state' | 'used_source' | 'out_sends' | 'out_replies' | 'out_hires'>[]> {
    return (
      await this.db
        .prepare('SELECT draft_id, used_state, used_source, out_sends, out_replies, out_hires FROM ai_scout_drafts WHERE chosen = 1 AND bq_synced_at IS NOT NULL ORDER BY chosen_at DESC LIMIT ?1')
        .bind(limit)
        .all<Pick<ScoutDraftRow, 'draft_id' | 'used_state' | 'used_source' | 'out_sends' | 'out_replies' | 'out_hires'>>()
    ).results;
  }

  /** 照合できた案: 実績を入れ、「使った（auto）」にする */
  outcomeStmt(r: { draftId: string; sends: number; replies: number; hires: number; firstSentOn: string | null; at: string }): D1StmtLike {
    return this.db
      .prepare("UPDATE ai_scout_drafts SET out_sends = ?2, out_replies = ?3, out_hires = ?4, out_first_sent_on = ?5, out_updated_at = ?6, used_state = 'used', used_source = 'auto', used_at = COALESCE(CASE WHEN used_source = 'auto' THEN used_at END, ?6) WHERE draft_id = ?1")
      .bind(r.draftId, r.sends, r.replies, r.hires, r.firstSentOn, r.at);
  }

  async versionCounts(): Promise<ScoutVersionCounts[]> {
    return (
      await this.db
        .prepare(
          `SELECT model_id, model_version, COUNT(*) AS drafts, SUM(judged) AS judged, SUM(chosen) AS chosen,
             SUM(CASE WHEN chosen = 1 AND used_state = 'used' THEN 1 ELSE 0 END) AS used,
             SUM(CASE WHEN chosen = 1 AND used_state = 'used' THEN COALESCE(out_sends, 0) ELSE 0 END) AS sends,
             SUM(CASE WHEN chosen = 1 AND used_state = 'used' THEN COALESCE(out_replies, 0) ELSE 0 END) AS replies,
             SUM(CASE WHEN chosen = 1 AND used_state = 'used' THEN COALESCE(out_hires, 0) ELSE 0 END) AS hires
           FROM ai_scout_drafts GROUP BY model_id, model_version`,
        )
        .all<ScoutVersionCounts>()
    ).results;
  }

  /** チューニングの材料（その版の、判断済みの案。chosen = 0 / 1 を指定。新しい順） */
  async tuneExamples(modelId: string, version: number, chosen: 0 | 1, limit: number): Promise<ScoutTuneExampleRow[]> {
    return (
      await this.db
        .prepare(
          `SELECT d.job_id AS job_id, j.input_json AS input_json, d.subject AS subject, d.body AS body, d.chosen AS chosen, d.comment AS comment,
             w.model_id AS winner_model, w.subject AS winner_subject, w.body AS winner_body
           FROM ai_scout_drafts d JOIN ai_jobs j ON j.id = d.job_id
           LEFT JOIN ai_scout_drafts w ON w.job_id = d.job_id AND w.chosen = 1 AND w.draft_id != d.draft_id
           WHERE d.model_id = ?1 AND d.model_version = ?2 AND d.judged = 1 AND d.chosen = ?3
           ORDER BY d.chosen_at DESC LIMIT ?4`,
        )
        .bind(modelId, version, chosen, limit)
        .all<ScoutTuneExampleRow>()
    ).results;
  }

  /* ---------- 検証・チューニングの記録 ---------- */

  insertRunStmt(ranAt: string, ranBy: string, reportJson: string): D1StmtLike {
    return this.db.prepare('INSERT INTO ai_scout_tune_runs (ran_at, ran_by, report_json) VALUES (?1, ?2, ?3)').bind(ranAt, ranBy, reportJson);
  }

  async lastRun(): Promise<{ ran_at: string; ran_by: string; report_json: string } | null> {
    return this.db.prepare('SELECT ran_at, ran_by, report_json FROM ai_scout_tune_runs ORDER BY id DESC LIMIT 1').first<{ ran_at: string; ran_by: string; report_json: string }>();
  }
}
