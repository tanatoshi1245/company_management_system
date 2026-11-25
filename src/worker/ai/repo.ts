import type { D1Like, D1StmtLike } from '../d1/db';
import { AI_HISTORY_LIST_MAX, type AiKind, type AiStatus } from '../../shared/ai/common';

export interface AiJobRow {
  id: string;
  kind: AiKind;
  company_id: number;
  status: AiStatus;
  title: string;
  input_json: string;
  result_json: string | null;
  edited_json: string | null;
  summary: string | null;
  error: string | null;
  sample: number;
  session_url: string | null;
  token_hash: string | null;
  token_expires_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  fired_at: string | null;
  completed_at: string | null;
  deleted_at: string | null;
}

const COLS = 'id, kind, company_id, status, title, input_json, result_json, edited_json, summary, error, sample, session_url, token_hash, token_expires_at, created_by, created_at, updated_at, fired_at, completed_at, deleted_at';
/** 一覧は結果の本体を読まない（edited は有無だけ） */
const LIST_COLS = "id, kind, company_id, status, title, '' AS input_json, NULL AS result_json, CASE WHEN edited_json IS NULL THEN NULL ELSE '1' END AS edited_json, summary, error, sample, NULL AS session_url, NULL AS token_hash, token_expires_at, created_by, created_at, updated_at, fired_at, completed_at, deleted_at";

/** ai_jobs（AI 機能の依頼と結果。docs/AI機能.md）。すべて prepare().bind()。更新は監査ログと同じ batch() に入れて使う */
export class AiJobsRepo {
  constructor(private readonly db: D1Like) {}

  /** 1 件（削除済みは返さない） */
  async get(id: string): Promise<AiJobRow | null> {
    return this.db.prepare(`SELECT ${COLS} FROM ai_jobs WHERE id = ?1 AND deleted_at IS NULL`).bind(id).first<AiJobRow>();
  }

  /** 企業 × 機能の履歴（新しい順。結果の本体は含めない） */
  async listByCompany(companyId: string, kind: AiKind, limit = AI_HISTORY_LIST_MAX): Promise<AiJobRow[]> {
    const n = Math.min(Math.max(1, limit), AI_HISTORY_LIST_MAX);
    const { results } = await this.db.prepare(`SELECT ${LIST_COLS} FROM ai_jobs WHERE company_id = ?1 AND kind = ?2 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ?3`).bind(Number(companyId), kind, n).all<AiJobRow>();
    return results;
  }

  /** セッションへ渡す過去の結果（同じ企業・同じ機能の done。見本と、いまのジョブは除く） */
  async recentDone(companyId: string, kind: AiKind, n: number, exceptId = ''): Promise<AiJobRow[]> {
    const { results } = await this.db
      .prepare(`SELECT ${COLS} FROM ai_jobs WHERE company_id = ?1 AND kind = ?2 AND status = 'done' AND sample = 0 AND deleted_at IS NULL AND id != ?4 ORDER BY created_at DESC, id DESC LIMIT ?3`)
      .bind(Number(companyId), kind, Math.min(Math.max(1, n), 10), exceptId)
      .all<AiJobRow>();
    return results;
  }

  insertStmt(r: Pick<AiJobRow, 'id' | 'kind' | 'status' | 'title' | 'input_json' | 'result_json' | 'summary' | 'created_by'> & { companyId: string; sample: boolean; at: string }): D1StmtLike {
    const done = r.status === 'done' ? r.at : null;
    return this.db
      .prepare(
        `INSERT INTO ai_jobs (id, kind, company_id, status, title, input_json, result_json, summary, sample, created_by, created_at, updated_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12)`,
      )
      .bind(r.id, r.kind, Number(r.companyId), r.status, r.title, r.input_json, r.result_json, r.summary, r.sample ? 1 : 0, r.created_by, r.at, done);
  }

  /** セッションを立ち上げた: running・セッションの URL・合言葉のハッシュと期限。前回の失敗の文は消す */
  markFiredStmt(id: string, f: { sessionUrl: string; tokenHash: string; tokenExpiresAt: string; at: string }): D1StmtLike {
    return this.db
      .prepare(`UPDATE ai_jobs SET status = 'running', session_url = ?2, token_hash = ?3, token_expires_at = ?4, fired_at = ?5, updated_at = ?5, error = NULL, completed_at = NULL WHERE id = ?1 AND deleted_at IS NULL AND status IN ('queued', 'failed')`)
      .bind(id, f.sessionUrl, f.tokenHash, f.tokenExpiresAt, f.at);
  }

  /** 発火の後: セッションの URL を入れる */
  setSessionUrlStmt(id: string, sessionUrl: string, at: string): D1StmtLike {
    return this.db.prepare(`UPDATE ai_jobs SET session_url = ?2, updated_at = ?3 WHERE id = ?1`).bind(id, sessionUrl, at);
  }

  /** 発火に失敗した: running にしたものを queued へ戻し、合言葉を失効させる */
  revertFiredStmt(id: string, at: string): D1StmtLike {
    return this.db.prepare(`UPDATE ai_jobs SET status = 'queued', session_url = NULL, token_hash = NULL, token_expires_at = NULL, fired_at = NULL, updated_at = ?2 WHERE id = ?1 AND status = 'running'`).bind(id, at);
  }

  /** 結果を受け取った: done。合言葉は失効させる（running のときだけ当たる） */
  completeStmt(id: string, resultJson: string, summary: string, at: string): D1StmtLike {
    return this.db.prepare(`UPDATE ai_jobs SET status = 'done', result_json = ?2, summary = ?3, error = NULL, completed_at = ?4, updated_at = ?4, token_hash = NULL, token_expires_at = NULL WHERE id = ?1 AND status = 'running'`).bind(id, resultJson, summary, at);
  }

  /** 失敗（セッションの報告・期限切れ）。合言葉は失効させる */
  failStmt(id: string, error: string, at: string): D1StmtLike {
    return this.db.prepare(`UPDATE ai_jobs SET status = 'failed', error = ?2, completed_at = ?3, updated_at = ?3, token_hash = NULL, token_expires_at = NULL WHERE id = ?1 AND status = 'running'`).bind(id, error.slice(0, 500), at);
  }

  /** 画面で直した版の保存（null = 取り消し） */
  setEditedStmt(id: string, editedJson: string | null, at: string): D1StmtLike {
    return this.db.prepare(`UPDATE ai_jobs SET edited_json = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL`).bind(id, editedJson, at);
  }

  /** 履歴から消す（行は残す。合言葉は失効させる） */
  softDeleteStmt(id: string, at: string): D1StmtLike {
    return this.db.prepare(`UPDATE ai_jobs SET deleted_at = ?2, updated_at = ?2, token_hash = NULL, token_expires_at = NULL WHERE id = ?1 AND deleted_at IS NULL`).bind(id, at);
  }
}
