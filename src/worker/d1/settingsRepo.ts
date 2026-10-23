import type { D1Like } from './db';

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

const COLS = 'company_id, cs_owner_email, cs_owner_name, scout_limit_period, scout_limit_override, job_limit_override, memo, flags_json, updated_by, updated_at';

/** company_settings の読み取り（書き込みは M3 で追加） */
export class SettingsRepo {
  constructor(private readonly db: D1Like) {}

  async all(): Promise<Map<string, SettingsRow>> {
    const { results } = await this.db.prepare(`SELECT ${COLS} FROM company_settings`).all<SettingsRow>();
    return new Map(results.map((r) => [String(r.company_id), r]));
  }

  async get(companyId: string): Promise<SettingsRow | null> {
    return this.db.prepare(`SELECT ${COLS} FROM company_settings WHERE company_id = ?1`).bind(Number(companyId)).first<SettingsRow>();
  }
}
