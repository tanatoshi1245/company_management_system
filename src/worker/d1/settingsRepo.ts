import type { D1Like, D1StmtLike } from './db';
import type { SettingsInput, SettingsRecord } from '../../shared/schema/settings';

export interface SettingsRow {
  company_id: number;
  cs_owner_email: string | null;
  cs_owner_name: string | null;
  scout_limit_period: 'month' | 'contract';
  scout_limit_override: number | null;
  job_limit_override: number | null;
  memo: string | null;
  flags_json: string;
  updated_by: string;
  updated_at: string;
}

export function settingsToRecord(s: SettingsRow): SettingsRecord {
  return { companyId: String(s.company_id), csOwnerEmail: s.cs_owner_email, csOwnerName: s.cs_owner_name, scoutLimitPeriod: s.scout_limit_period, scoutLimitOverride: s.scout_limit_override, jobLimitOverride: s.job_limit_override, memo: s.memo, updatedBy: s.updated_by, updatedAt: s.updated_at };
}

const COLS = 'company_id, cs_owner_email, cs_owner_name, scout_limit_period, scout_limit_override, job_limit_override, memo, flags_json, updated_by, updated_at';

/** company_settings。flags_json は現状 '{}' 固定（将来の拡張用。任意 JSON は保存しない） */
export class SettingsRepo {
  constructor(private readonly db: D1Like) {}

  async all(): Promise<Map<string, SettingsRow>> {
    const { results } = await this.db.prepare(`SELECT ${COLS} FROM company_settings`).all<SettingsRow>();
    return new Map(results.map((r) => [String(r.company_id), r]));
  }

  async list(limit = 200): Promise<SettingsRow[]> {
    const { results } = await this.db.prepare(`SELECT ${COLS} FROM company_settings ORDER BY updated_at DESC LIMIT ?1`).bind(Math.min(Math.max(1, limit), 500)).all<SettingsRow>();
    return results;
  }

  async get(companyId: string): Promise<SettingsRow | null> {
    return this.db.prepare(`SELECT ${COLS} FROM company_settings WHERE company_id = ?1`).bind(Number(companyId)).first<SettingsRow>();
  }

  /** この人が担当に上書きされている企業 ID（/api/me） */
  async companyIdsOwnedBy(email: string): Promise<string[]> {
    const { results } = await this.db.prepare('SELECT company_id FROM company_settings WHERE cs_owner_email = ?1 LIMIT 500').bind(email.toLowerCase()).all<{ company_id: number }>();
    return results.map((r) => String(r.company_id));
  }

  upsertStmt(companyId: string, s: SettingsInput, actor: string, nowIso: string): D1StmtLike {
    return this.db
      .prepare(
        `INSERT INTO company_settings (company_id, cs_owner_email, cs_owner_name, scout_limit_period, scout_limit_override, job_limit_override, memo, flags_json, updated_by, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '{}', ?8, ?9)
         ON CONFLICT(company_id) DO UPDATE SET
           cs_owner_email = excluded.cs_owner_email, cs_owner_name = excluded.cs_owner_name, scout_limit_period = excluded.scout_limit_period,
           scout_limit_override = excluded.scout_limit_override, job_limit_override = excluded.job_limit_override, memo = excluded.memo,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .bind(Number(companyId), s.csOwnerEmail, s.csOwnerName, s.scoutLimitPeriod, s.scoutLimitOverride, s.jobLimitOverride, s.memo, actor, nowIso);
  }

  deleteStmt(companyId: string): D1StmtLike {
    return this.db.prepare('DELETE FROM company_settings WHERE company_id = ?1').bind(Number(companyId));
  }
}
