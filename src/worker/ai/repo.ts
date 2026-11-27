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

/** ai_jobs（AI 機能の依頼と結果。docs/AI機能.md）。session_url・token_hash・token_expires_at・fired_at は以前のセッション方式の列で、いまは書かない。すべて prepare().bind()。更新は監査ログと同じ batch() に入れて使う */
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

  /** 依頼の保存（done = 作成できた / failed = 作れなかった。理由は error） */
  insertStmt(r: Pick<AiJobRow, 'id' | 'kind' | 'status' | 'title' | 'input_json' | 'result_json' | 'summary' | 'created_by'> & { companyId: string; sample: boolean; at: string; error?: string | null }): D1StmtLike {
    const done = r.status === 'done' || r.status === 'failed' ? r.at : null;
    return this.db
      .prepare(
        `INSERT INTO ai_jobs (id, kind, company_id, status, title, input_json, result_json, summary, sample, created_by, created_at, updated_at, completed_at, error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12, ?13)`,
      )
      .bind(r.id, r.kind, Number(r.companyId), r.status, r.title, r.input_json, r.result_json, r.summary, r.sample ? 1 : 0, r.created_by, r.at, done, r.error ? r.error.slice(0, 500) : null);
  }

  /** 画面で直した版の保存（null = 取り消し） */
  setEditedStmt(id: string, editedJson: string | null, at: string): D1StmtLike {
    return this.db.prepare(`UPDATE ai_jobs SET edited_json = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL`).bind(id, editedJson, at);
  }

  /** 履歴から消す（行は残す） */
  softDeleteStmt(id: string, at: string): D1StmtLike {
    return this.db.prepare(`UPDATE ai_jobs SET deleted_at = ?2, updated_at = ?2, token_hash = NULL, token_expires_at = NULL WHERE id = ?1 AND deleted_at IS NULL`).bind(id, at);
  }
}
