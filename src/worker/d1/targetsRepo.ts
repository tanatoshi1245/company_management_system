import type { D1Like } from './db';
import { EMPTY_TARGETS, STAGE_TARGET_KEYS, type TargetValues } from '../../shared/schema/targets';

export interface TargetRow {
  company_id: number;
  target_month: string;
  scout_sent_target: number | null;
  application_target: number | null;
  interested_target: number | null;
  view_target: number | null;
  hire_target: number | null;
  stage_targets_json: string;
  note: string | null;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
}

export function rowToValues(r: TargetRow): TargetValues {
  let stages: TargetValues['stages'] = {};
  try {
    const parsed = JSON.parse(r.stage_targets_json || '{}') as Record<string, unknown>;
    for (const k of STAGE_TARGET_KEYS) {
      const v = parsed[k];
      if (typeof v === 'number') stages = { ...stages, [k]: v };
    }
  } catch {
    stages = {};
  }
  return { ...EMPTY_TARGETS, scout_sent: r.scout_sent_target, applications: r.application_target, interested: r.interested_target, views: r.view_target, hires: r.hire_target, stages };
}

const COLS = 'company_id, target_month, scout_sent_target, application_target, interested_target, view_target, hire_target, stage_targets_json, note, created_by, created_at, updated_by, updated_at';

/** company_targets の読み取り（書き込みは M3 で追加）。すべて prepare().bind() */
export class TargetsRepo {
  constructor(private readonly db: D1Like) {}

  async byMonth(month: string): Promise<Map<string, TargetRow>> {
    const { results } = await this.db.prepare(`SELECT ${COLS} FROM company_targets WHERE target_month = ?1`).bind(month).all<TargetRow>();
    return new Map(results.map((r) => [String(r.company_id), r]));
  }

  async byCompany(companyId: string, from: string, to: string): Promise<TargetRow[]> {
    const { results } = await this.db.prepare(`SELECT ${COLS} FROM company_targets WHERE company_id = ?1 AND target_month BETWEEN ?2 AND ?3 ORDER BY target_month`).bind(Number(companyId), from, to).all<TargetRow>();
    return results;
  }

  async get(companyId: string, month: string): Promise<TargetRow | null> {
    return this.db.prepare(`SELECT ${COLS} FROM company_targets WHERE company_id = ?1 AND target_month = ?2`).bind(Number(companyId), month).first<TargetRow>();
  }
}
