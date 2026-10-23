import type { D1Like, D1StmtLike } from './db';
import type { ScoutUnusedEntry, ScoutUnusedInput } from '../../shared/schema/scoutUnused';

export interface ScoutUnusedRow {
  company_id: number;
  target_month: string;
  reason: string | null;
  remarks: string | null;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  deleted_at: string | null;
  bq_synced_at: string | null;
  bq_error: string | null;
}

const COLS = 'company_id, target_month, reason, remarks, created_by, created_at, updated_by, updated_at, deleted_at, bq_synced_at, bq_error';

export function scoutUnusedToEntry(r: ScoutUnusedRow): ScoutUnusedEntry {
  return { companyId: String(r.company_id), month: r.target_month, reason: r.reason, remarks: r.remarks, updatedBy: r.updated_by, updatedAt: r.updated_at, bqSyncedAt: r.bq_synced_at, bqError: r.bq_error };
}

/** scout_unused_entries（スカウト未利用の理由・補足。正は D1、BQ へは MERGE で写す）。すべて prepare().bind() */
export class ScoutUnusedRepo {
  constructor(private readonly db: D1Like) {}

  async get(companyId: string, month: string): Promise<ScoutUnusedRow | null> {
    return this.db.prepare(`SELECT ${COLS} FROM scout_unused_entries WHERE company_id = ?1 AND target_month = ?2`).bind(Number(companyId), month).first<ScoutUnusedRow>();
  }

  /** その月の登録（削除済みを除く） */
  async byMonth(month: string): Promise<ScoutUnusedRow[]> {
    const { results } = await this.db.prepare(`SELECT ${COLS} FROM scout_unused_entries WHERE target_month = ?1 AND deleted_at IS NULL ORDER BY company_id LIMIT 2000`).bind(month).all<ScoutUnusedRow>();
    return results;
  }

  /** 企業の登録（削除済みを除く。月の降順） */
  async byCompany(companyId: string): Promise<ScoutUnusedRow[]> {
    const { results } = await this.db.prepare(`SELECT ${COLS} FROM scout_unused_entries WHERE company_id = ?1 AND deleted_at IS NULL ORDER BY target_month DESC LIMIT 200`).bind(Number(companyId)).all<ScoutUnusedRow>();
    return results;
  }

  /** 企業の登録（削除済みも含む。企業ページでマートの古いアプリ行を隠すため） */
  async byCompanyIncludingDeleted(companyId: string): Promise<ScoutUnusedRow[]> {
    const { results } = await this.db.prepare(`SELECT ${COLS} FROM scout_unused_entries WHERE company_id = ?1 ORDER BY target_month DESC LIMIT 200`).bind(Number(companyId)).all<ScoutUnusedRow>();
    return results;
  }

  /** BQ 未反映（未同期、または同期後に更新された）行。削除も含む */
  async unsynced(limit = 200): Promise<ScoutUnusedRow[]> {
    const { results } = await this.db.prepare(`SELECT ${COLS} FROM scout_unused_entries WHERE bq_synced_at IS NULL OR bq_synced_at < updated_at ORDER BY updated_at LIMIT ?1`).bind(Math.min(Math.max(1, limit), 500)).all<ScoutUnusedRow>();
    return results;
  }

  async countUnsynced(): Promise<number> {
    const r = await this.db.prepare('SELECT COUNT(*) AS n FROM scout_unused_entries WHERE bq_synced_at IS NULL OR bq_synced_at < updated_at').first<{ n: number }>();
    return Number(r?.n ?? 0);
  }

  upsertStmt(companyId: string, month: string, s: ScoutUnusedInput, actor: string, nowIso: string): D1StmtLike {
    return this.db
      .prepare(
        `INSERT INTO scout_unused_entries (company_id, target_month, reason, remarks, created_by, created_at, updated_by, updated_at, deleted_at, bq_synced_at, bq_error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5, ?6, NULL, NULL, NULL)
         ON CONFLICT(company_id, target_month) DO UPDATE SET
           reason = excluded.reason, remarks = excluded.remarks, updated_by = excluded.updated_by, updated_at = excluded.updated_at, deleted_at = NULL, bq_error = NULL`,
      )
      .bind(Number(companyId), month, s.reason, s.remarks, actor, nowIso);
  }

  /** 画面での削除（BQ にも deleted = TRUE を写すまで行は残す） */
  softDeleteStmt(companyId: string, month: string, actor: string, nowIso: string): D1StmtLike {
    return this.db.prepare('UPDATE scout_unused_entries SET deleted_at = ?3, updated_by = ?4, updated_at = ?3, bq_error = NULL WHERE company_id = ?1 AND target_month = ?2').bind(Number(companyId), month, nowIso, actor);
  }

  async markSynced(companyId: string, month: string, nowIso: string): Promise<void> {
    await this.db.prepare('UPDATE scout_unused_entries SET bq_synced_at = ?3, bq_error = NULL WHERE company_id = ?1 AND target_month = ?2').bind(Number(companyId), month, nowIso).run();
  }

  async markError(companyId: string, month: string, message: string): Promise<void> {
    await this.db.prepare('UPDATE scout_unused_entries SET bq_error = ?3 WHERE company_id = ?1 AND target_month = ?2').bind(Number(companyId), month, message.slice(0, 300)).run();
  }
}
